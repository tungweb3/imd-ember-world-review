import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {economyChainState,ingestEconomyEvents,createEconomyOrder} from '../server/economy-ledger.ts';
import {stageEconomyBlock,pendingEconomyBlock} from '../server/economy-staging.ts';
const T=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const config=()=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'stage-fixture',titleZh:'本機',titleEn:'Fixture',embeo:'7',gold:'1'}]});
const stake=i=>({kind:'stake',wallet:W,positionId:String(i+1),shares:'1',amount:String(SHARE),transactionHash:H(i+1000),logIndex:i,blockNumber:'100',blockHash:H(100),timestamp:T});
const page=(events,offset=0,totalLogs=130)=>({number:'100',hash:H(100),parentHash:H(99),throughMs:T,totalLogs,digest:'a'.repeat(64),offset,events});
const count=(db,table)=>db.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n;

test('130-event block stages in bounded pages without partial positions, fulfillment or confirmed horizon',async()=>{
 const db=openD1(),c=await config();try{
  const events=Array.from({length:130},(_,i)=>stake(i));
  const first=await stageEconomyBlock(db,c,page(events.slice(0,128)));assert.equal(first.complete,false);assert.equal(first.staged,128);assert.equal((await pendingEconomyBlock(db,c)).nextOffset,128);
  for(const table of ['economy_positions','economy_chain_events','economy_gold_journal','economy_fulfillments'])assert.equal(count(db,table),0);
  assert.equal((await economyChainState(db,c)).lastBlock,'99');assert.equal((await economyChainState(db,c)).throughMs,0);
  await assert.rejects(ingestEconomyEvents(db,c,{fromBlock:'100',toBlock:'100',toBlockHash:H(100),throughTimestamp:T,events:[]}));assert.equal((await economyChainState(db,c)).lastBlock,'99');
  const done=await stageEconomyBlock(db,c,page(events.slice(128),128));assert.equal(done.complete,true);assert.equal(done.eventCount,130);assert.equal(count(db,'economy_positions'),130);assert.equal(count(db,'economy_chain_events'),130);assert.equal((await economyChainState(db,c)).lastBlock,'100');assert.equal((await economyChainState(db,c)).throughMs,T);assert.equal(await pendingEconomyBlock(db,c),null);assert.equal(count(db,'economy_staged_events'),0);
  const replay=await stageEconomyBlock(db,c,page(events.slice(128),128));assert.equal(replay.replayed,true);assert.equal(count(db,'economy_chain_events'),130);
 }finally{db.raw.close();}
});

test('same page concurrent isolates and exact retry advance once; conflicting payload and offset cannot replace it',async()=>{
 const db=openD1(),c=await config(),p=page([stake(0)],0,2);try{
  const results=await Promise.all([stageEconomyBlock(db,c,p),stageEconomyBlock(db,c,p)]);assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(count(db,'economy_staged_events'),1);assert.equal((await pendingEconomyBlock(db,c)).nextOffset,1);
  await assert.rejects(stageEconomyBlock(db,c,{...p,events:[{...stake(0),shares:'2',amount:String(2n*SHARE)}]}));
  await assert.rejects(stageEconomyBlock(db,c,{...p,offset:2}));
  await assert.rejects(stageEconomyBlock(db,c,{...p,offset:1,events:[stake(1)],digest:'b'.repeat(64)}),/STAGED_BLOCK_CONFLICT/);
  assert.equal((await pendingEconomyBlock(db,c)).nextOffset,1);assert.equal(count(db,'economy_positions'),0);
  await stageEconomyBlock(db,c,page([stake(1)],1,2));assert.equal(count(db,'economy_positions'),2);
 }finally{db.raw.close();}
});

test('final fold applies same-block stake then partial withdrawal in exact log order',async()=>{
 const db=openD1(),c=await config();try{
  const deposit={...stake(0),shares:'3',amount:String(3n*SHARE)},withdraw={...stake(1),kind:'withdraw',positionId:'1'};
  await stageEconomyBlock(db,c,page([deposit],0,2));await stageEconomyBlock(db,c,page([withdraw],1,2));
  assert.equal(db.raw.prepare('SELECT remaining_shares shares FROM economy_positions WHERE position_id=?').get('1').shares,2);assert.equal(count(db,'economy_chain_events'),2);
 }finally{db.raw.close();}
});

test('invalid last-page withdrawal rolls back final fold, page and cursor while preserving earlier verified proof rows',async()=>{
 const db=openD1(),c=await config();try{
  await stageEconomyBlock(db,c,page([stake(0)],0,2));
  const invalid={...stake(1),kind:'withdraw',positionId:'999'};
  await assert.rejects(stageEconomyBlock(db,c,page([invalid],1,2)),/ECONOMY_INVALID_WITHDRAWAL/);
  assert.equal((await pendingEconomyBlock(db,c)).nextOffset,1);assert.equal(count(db,'economy_staged_events'),1);assert.equal(count(db,'economy_chain_events'),0);assert.equal(count(db,'economy_positions'),0);assert.equal((await economyChainState(db,c)).lastBlock,'99');
 }finally{db.raw.close();}
});

test('canonical late EMBEO payment and fulfillment commit only at whole-block completion; failure rolls back everything',async()=>{
 const db=openD1(),c=await config();try{
  const order=await createEconomyOrder(db,c,{wallet:W,requestId:'stage-order-00000001',serviceId:'stage-fixture',currency:'EMBEO',nowMs:T-3600000});
  const payment={kind:'payment',wallet:W,orderId:order.id,token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY,amount:'7',transactionHash:H(2000),logIndex:1,blockNumber:'100',blockHash:H(100),timestamp:T};
  await stageEconomyBlock(db,c,page([stake(0)],0,2));assert.equal(count(db,'economy_fulfillments'),0);
  db.raw.exec("CREATE TRIGGER stage_reject_fulfillment BEFORE INSERT ON economy_fulfillments BEGIN SELECT RAISE(ABORT,'STAGE_OUTBOX_FAILURE'); END;");
  await assert.rejects(stageEconomyBlock(db,c,page([payment],1,2)),/STAGE_OUTBOX_FAILURE/);assert.equal(count(db,'economy_positions'),0);assert.equal(db.raw.prepare('SELECT status FROM economy_orders').get().status,'pending');assert.equal((await pendingEconomyBlock(db,c)).nextOffset,1);
  db.raw.exec('DROP TRIGGER stage_reject_fulfillment');await stageEconomyBlock(db,c,page([payment],1,2));assert.equal(db.raw.prepare('SELECT status FROM economy_orders').get().status,'paid');assert.equal(count(db,'economy_fulfillments'),1);
 }finally{db.raw.close();}
});

test('bad block identity, page size, event source, time, order and halt fail before visible changes',async()=>{
 const db=openD1(),c=await config(),good=page([stake(0)],0,1);try{
  for(const patch of [{events:[]},{totalLogs:10001},{offset:-1},{digest:'x'.repeat(64)},{hash:'bad'},{events:Array.from({length:129},(_,i)=>stake(i)),totalLogs:129},{events:[{...stake(0),timestamp:T+1}]},{events:[{...stake(0),amount:'1'}]}])await assert.rejects(stageEconomyBlock(db,c,{...good,...patch}));
  assert.equal(count(db,'economy_positions'),0);assert.equal(await pendingEconomyBlock(db,c),null);
  db.raw.prepare('INSERT INTO economy_chain_state(config_id,last_block,last_hash,through_ms,halted_reason) VALUES(?,99,?,0,?)').run(c.id,H(99),'TEST_HALT');
  await assert.rejects(stageEconomyBlock(db,c,good),/ECONOMY_HALTED/);assert.equal(await pendingEconomyBlock(db,c),null);
 }finally{db.raw.close();}
});
