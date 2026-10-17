import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,publicEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,economyChainState,economyWalletSnapshot,settleEconomy,createEconomyOrder,haltEconomyChain} from '../server/economy-ledger.ts';
import {stageEconomyBlock,pendingEconomyBlock} from '../server/economy-staging.ts';
import {prepareEconomyRecovery,applyEconomyRecovery} from '../server/economy-recovery.ts';
import {economyConfigStatement,reconcileEconomyPayments} from '../server/economy-reconciliation.ts';
import {handleEconomyApi} from '../server/economy.ts';
const T=Date.UTC(2026,9,1),W='0x'+'a'.repeat(40),OTHER='0x'+'b'.repeat(40),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),PRICE=10n**18n;
const cfg=patch=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'audit-local',titleZh:'本機測試',titleEn:'Local test',gold:'1',embeo:String(PRICE)}],...patch});
const stake=(id,block,time,shares=1)=>({kind:'stake',transactionHash:H(1000+id),logIndex:0,blockNumber:String(block),blockHash:H(block),timestamp:time,wallet:W,positionId:String(id),shares:String(shares),amount:String(SHARE*BigInt(shares))});
const withdrawal=(id=1)=>({...stake(id,102,T+DAY+1000),kind:'withdraw',transactionHash:H(2000)});
const payment=(orderId,patch={})=>({kind:'payment',transactionHash:H(3000),logIndex:1,blockNumber:'102',blockHash:H(102),timestamp:T+DAY+1000,wallet:W,orderId,amount:String(PRICE),token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY,...patch});
const order=(db,c,requestId,currency='EMBEO')=>createEconomyOrder(db,c,{wallet:W,requestId,serviceId:'audit-local',currency,nowMs:T+DAY+10});
const ingest=(db,c,events,from='102',to='102',through=T+DAY+1000)=>ingestEconomyEvents(db,c,{fromBlock:from,toBlock:to,toBlockHash:H(Number(to)),throughTimestamp:through,events});
const stage=(db,c,events,offset=0,totalLogs=events.length)=>stageEconomyBlock(db,c,{number:'102',hash:H(102),parentHash:H(101),throughMs:T+DAY+1000,totalLogs,digest:'d'.repeat(64),offset,events});
async function haltedFixture(mode){
 const db=openD1(),c=await cfg();
 await ingest(db,c,[stake(2,100,T)],'100','101',T+DAY);await settleEconomy(db,c,{nowMs:T+DAY});
 const quote=await order(db,c,'audit-halt-order-0001'),events=[withdrawal(),payment(quote.id)];
 if(mode==='staged')await stage(db,c,events.slice(0,1),0,2);
 const attempt=()=>mode==='staged'?stage(db,c,events.slice(1),1,2):ingest(db,c,events);
 return {db,c,quote,events,attempt};
}
for(const mode of ['direct','staged']){
 test(`Audit2 M1 ${mode}: unknown early position durably halts without advancing facts, cursor, payment or GOLD`,async()=>{
  const f=await haltedFixture(mode),{db,c}=f;try{
   for(let i=0;i<2;i++)await assert.rejects(f.attempt(),/ECONOMY_HALTED/);
   assert.deepEqual(await economyChainState(db,c),{lastBlock:'101',lastHash:H(101),throughMs:T+DAY,haltedReason:'INVALID_POSITION_WITHDRAWAL'});
   const view=await economyWalletSnapshot(db,c,W);assert.equal(view.gold,'1');assert.equal(view.paymentCases.length,0);assert.equal(view.orders[0].status,'pending');
   assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_chain_events').get().n,1);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,0);
   for(const currency of ['EMBEO','GOLD'])await assert.rejects(order(db,c,'audit-halted-'+currency+'-00001',currency),/ECONOMY_HALTED/);
   await assert.rejects(settleEconomy(db,c,{nowMs:T+2*DAY}),/ECONOMY_HALTED/);
   assert.equal((await pendingEconomyBlock(db,c))?.nextOffset,mode==='staged'?1:undefined);
  }finally{db.raw.close();}
 });
 test(`Audit2 M1 ${mode}: reviewed earlier-start recovery retains halt/staged evidence and resumes exact payment plus future GOLD once`,async()=>{
  const f=await haltedFixture(mode),shadow=openD1(),{db,c}=f;try{
   await assert.rejects(f.attempt(),/ECONOMY_HALTED/);
   const oldEvents=db.raw.prepare('SELECT * FROM economy_chain_events').all(),oldPending=await pendingEconomyBlock(db,c);
   const next=await cfg({deploymentBlock:'99'});
   await ingest(shadow,next,[stake(1,99,T,2),stake(2,100,T)],'99','101',T+DAY);await settleEconomy(shadow,next,{nowMs:T+DAY});
   const plan=await prepareEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001});assert.equal(plan.report.totalDelta,'2');
   await applyEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:plan.hash});
   assert.equal((await economyChainState(db,c)).haltedReason,'INVALID_POSITION_WITHDRAWAL');assert.equal((await economyChainState(db,next)).haltedReason,null);
   assert.deepEqual(await pendingEconomyBlock(db,c),oldPending);
   for(const e of oldEvents)assert.deepEqual(db.raw.prepare('SELECT * FROM economy_chain_events WHERE id=?').get(e.id),e);
   if(mode==='staged'){await stage(db,next,f.events.slice(0,1),0,2);await stage(db,next,f.events.slice(1),1,2);}else await ingest(db,next,f.events);
   assert.equal(db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(f.quote.id).status,'paid');
   assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,1);
   assert.deepEqual((await economyWalletSnapshot(db,next,W)).paymentCases,[]);
   assert.equal((await economyWalletSnapshot(db,next,W)).gold,'3');
   await ingest(db,next,[],'103','103',T+2*DAY);await settleEconomy(db,next,{nowMs:T+2*DAY});
   assert.equal((await economyWalletSnapshot(db,next,W)).gold,'5');
   assert.equal((await applyEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:plan.hash})).replayed,true);
   assert.equal((await economyWalletSnapshot(db,next,W)).gold,'5');
  }finally{db.raw.close();shadow.raw.close();}
 });
}
test('Audit2 M1: unrelated D1 failure rolls back but never invents a withdrawal halt',async()=>{
 const f=await haltedFixture('direct');try{
  f.db.raw.exec("CREATE TRIGGER unrelated_failure BEFORE INSERT ON economy_chain_events BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;");
  await assert.rejects(ingest(f.db,f.c,[payment(f.quote.id)]),/synthetic storage failure/);
  assert.equal((await economyChainState(f.db,f.c)).haltedReason,null);
 }finally{f.db.raw.close();}
});
test('Audit2 M1: finalized-reorg halt remains refused by historical recovery',async()=>{
 const f=await haltedFixture('direct'),shadow=openD1();try{
  await haltEconomyChain(f.db,f.c,'FINALIZED_REORG');const next=await cfg({deploymentBlock:'99'});
  await ingest(shadow,next,[stake(1,99,T,2),stake(2,100,T)],'99','101',T+DAY);await settleEconomy(shadow,next,{nowMs:T+DAY});
  await assert.rejects(prepareEconomyRecovery(f.db,shadow,f.c,next,{nowMs:T+DAY+1001}),/RECOVERY_FINALIZED_BOUNDARY_MISMATCH/);
  assert.equal((await economyChainState(f.db,f.c)).haltedReason,'FINALIZED_REORG');
 }finally{f.db.raw.close();shadow.raw.close();}
});
for(const mode of ['direct','staged'])for(const first of ['owner','other']){
 test(`Audit2 M2 ${mode}, ${first} first: shared payment-contract evidence matches the physical payment, independent of scanner`,async()=>{
  const db=openD1(),owner=await cfg(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
   for(const c of [owner,other])await ingest(db,c,[],'100','101',T+DAY);
   const quote=await order(db,owner,'audit-shared-contract-001'),e=payment(quote.id);
   for(const c of first==='owner'?[owner,other]:[other,owner]){if(mode==='staged')await stage(db,c,[e]);else await ingest(db,c,[e]);}
   assert.equal(db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(quote.id).status,'paid');
   assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments WHERE order_id=?').get(quote.id).n,1);
   const cases=db.raw.prepare('SELECT classification,tx_hash,log_index FROM economy_payment_cases').all();
   assert.equal(cases.length,1);assert.equal(cases[0].classification,'matched');assert.equal(cases[0].tx_hash,e.transactionHash);
   assert.deepEqual((await economyWalletSnapshot(db,owner,W)).paymentCases,[]);
   for(const c of [owner,other])assert.equal((await reconcileEconomyPayments(db,c)).remaining,0);
  }finally{db.raw.close();}
 });
}
test('Audit2 M2: wrong payment contract, payer, amount and GOLD currency remain exceptions without extra entitlement',async()=>{
 for(const kind of ['contract','payer','amount','currency']){
  const db=openD1(),owner=await cfg(),other=await cfg({stakingContract:'0x'+'4'.repeat(40),...(kind==='contract'?{paymentContract:'0x'+'5'.repeat(40)}:{})});try{
   for(const c of [owner,other])await ingest(db,c,[],'100','101',T+DAY);
   const quote=await order(db,owner,'audit-negative-'+kind+'-001',kind==='currency'?'GOLD':'EMBEO');
   const e=payment(quote.id,{...(kind==='payer'?{wallet:OTHER}:{}),...(kind==='amount'?{amount:'1'}:{})});
   await ingest(db,other,[e]);
   assert.equal(db.raw.prepare('SELECT classification FROM economy_payment_cases').get().classification,{'contract':'wrong-config','payer':'wrong-payer','amount':'wrong-amount','currency':'wrong-currency'}[kind]);
   assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,0);
   assert.equal((await economyWalletSnapshot(db,owner,W)).gold,'0');
  }finally{db.raw.close();}
 }
});
test('Audit2 M2: legacy backfill through a different scanner does not relabel the owning fulfilled physical event as extra',async()=>{
 const db=openD1(),owner=await cfg(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
  for(const c of [owner,other])await ingest(db,c,[],'100','101',T+DAY);
  const quote=await order(db,owner,'audit-backfill-owner-001'),e=payment(quote.id);
  await ingest(db,owner,[e]);await ingest(db,other,[e]);
  // Fixture-only projection removal models a pre-reconciliation export; production helpers never delete evidence.
  db.raw.exec('DROP TRIGGER economy_payment_case_no_delete;DELETE FROM economy_payment_cases;');
  await reconcileEconomyPayments(db,other);
  assert.equal(db.raw.prepare('SELECT classification FROM economy_payment_cases').get().classification,'matched');
  assert.deepEqual((await economyWalletSnapshot(db,owner,W)).paymentCases,[]);
 }finally{db.raw.close();}
});
test('Audit2 M1: multi-page retained proof ordinals survive recovery and a second earlier recovery',async()=>{
 const f=await haltedFixture('direct'),shadow=openD1(),third=openD1();try{
  const events=[withdrawal(),...Array.from({length:256},(_,i)=>payment(H(5000+i),{transactionHash:H(8000+i),logIndex:i+1}))];
  await stage(f.db,f.c,events.slice(0,128),0,257);await stage(f.db,f.c,events.slice(128,256),128,257);
  await assert.rejects(stage(f.db,f.c,events.slice(256),256,257),/ECONOMY_HALTED/);
  const pending=await pendingEconomyBlock(f.db,f.c);assert.equal(pending.nextOffset,256);
  const next=await cfg({deploymentBlock:'99'});
  await ingest(shadow,next,[stake(1,99,T,2),stake(2,100,T)],'99','101',T+DAY);await settleEconomy(shadow,next,{nowMs:T+DAY});
  const p=await prepareEconomyRecovery(f.db,shadow,f.c,next,{nowMs:T+DAY+1001});await applyEconomyRecovery(f.db,shadow,f.c,next,{nowMs:T+DAY+1001,expectedPlanHash:p.hash});
  const earlier=await cfg({deploymentBlock:'98'});
  await ingest(third,earlier,[stake(3,98,T),stake(1,99,T,2),stake(2,100,T)],'98','101',T+DAY);await settleEconomy(third,earlier,{nowMs:T+DAY});
  const p2=await prepareEconomyRecovery(f.db,third,next,earlier,{nowMs:T+DAY+1002});assert.equal(p2.report.totalDelta,'1');
  await applyEconomyRecovery(f.db,third,next,earlier,{nowMs:T+DAY+1002,expectedPlanHash:p2.hash});
  assert.deepEqual(await pendingEconomyBlock(f.db,f.c),pending);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_staged_events').get().n,256);
  assert.equal((await economyWalletSnapshot(f.db,earlier,W)).gold,'4');
 }finally{f.db.raw.close();shadow.raw.close();third.raw.close();}
});
test('Audit2 M1: a halted namespace does not admit missing or altered pending proof pages into recovery',async()=>{
 for(const fault of ['parent','ordinal']){
  const f=await haltedFixture('staged'),shadow=openD1();try{
   await assert.rejects(f.attempt(),/ECONOMY_HALTED/);const next=await cfg({deploymentBlock:'99'});
   await ingest(shadow,next,[stake(1,99,T,2),stake(2,100,T)],'99','101',T+DAY);await settleEconomy(shadow,next,{nowMs:T+DAY});
   if(fault==='parent')f.db.raw.prepare('UPDATE economy_pending_blocks SET parent_hash=? WHERE config_id=?').run(H(777),f.c.id);
   else f.db.raw.prepare('UPDATE economy_staged_events SET ordinal=2 WHERE config_id=?').run(f.c.id);
   await assert.rejects(prepareEconomyRecovery(f.db,shadow,f.c,next,{nowMs:T+DAY+1001}),/RECOVERY_NOT_CLEAN/);
   assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_recoveries').get().n,0);
  }finally{f.db.raw.close();shadow.raw.close();}
 }
});
test('Audit2 M1: wrapped D1 trigger errors halt, and a failed halt write is not reported as a durable halt',async()=>{
 const f=await haltedFixture('direct');try{
  const batch=f.db.batch;f.db.batch=async statements=>{try{return await batch(statements);}catch(error){throw new Error('D1_ERROR',{cause:error});}};
  const prepare=f.db.prepare;let fail=true;
  f.db.prepare=sql=>{if(fail&&sql.startsWith('INSERT INTO economy_chain_state')&&sql.includes('halted_reason')){fail=false;throw Error('synthetic halt-write failure');}return prepare(sql);};
  await assert.rejects(f.attempt(),/synthetic halt-write failure/);assert.equal((await economyChainState(f.db,f.c)).haltedReason,null);
  await assert.rejects(f.attempt(),/ECONOMY_HALTED/);assert.equal((await economyChainState(f.db,f.c)).haltedReason,'INVALID_POSITION_WITHDRAWAL');
 }finally{f.db.raw.close();}
});
test('Audit2 M2: missing legacy order registry defers classification explicitly, then a reviewed registry backfill completes once',async()=>{
 const db=openD1(),owner=await cfg(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
  for(const c of [owner,other])await ingest(db,c,[],'100','101',T+DAY);
  const quote=await order(db,owner,'audit-legacy-registry-01'),e=payment(quote.id);
  // Fixture-only removal models an upgraded legacy quote whose config has not been registered yet.
  db.raw.exec('DROP TRIGGER economy_registry_no_delete;');db.raw.prepare('DELETE FROM economy_config_registry WHERE config_id=?').run(owner.id);
  await ingest(db,other,[e]);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_payment_cases').get().n,0);
  assert.deepEqual(await reconcileEconomyPayments(db,other),{remaining:1,deferred:1});
  await db.batch([economyConfigStatement(db,owner)]);
  assert.deepEqual(await reconcileEconomyPayments(db,other),{remaining:0,deferred:0});
  await ingest(db,owner,[e]);assert.equal(db.raw.prepare('SELECT classification FROM economy_payment_cases').get().classification,'matched');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,1);
 }finally{db.raw.close();}
});
test('GOLD stays wallet-bound: separate service currencies expose no exchange or player-transfer endpoint',async()=>{
 const db=openD1(),c=await cfg();try{
  assert.equal(publicEconomyConfig(c).goldTransferable,false);assert.equal(publicEconomyConfig(null).goldTransferable,false);
  for(const path of ['swap','convert','gold/transfer']){
   const response=await handleEconomyApi(new Request('https://imdember.com/api/economy/'+path,{method:'POST',headers:{origin:'https://imdember.com','content-type':'application/json'},body:JSON.stringify({expectedAddress:W,to:OTHER,amount:'1'})}),{db,config:c});
   assert.equal(response.status,404);
  }
  await assert.rejects(order(db,c,'audit-not-a-trading-pair','EMBEO/GOLD'),/BAD_REQUEST/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_journal').get().n,0);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_orders').get().n,0);
 }finally{db.raw.close();}
});
