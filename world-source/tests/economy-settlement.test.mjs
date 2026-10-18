import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy,economyWalletSnapshot,haltEconomyChain,ECONOMY_SETTLEMENT_POSITION_LIMIT,ECONOMY_SETTLEMENT_WALLET_LIMIT} from '../server/economy-ledger.ts';
const T=Date.UTC(2026,9,16),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),W=n=>'0x'+BigInt(n).toString(16).padStart(40,'0');
const config=()=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:W(10001),paymentContract:W(10002),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[]});
const count=(db,t)=>Number(db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);
async function seed(db,c,{positions=34,sameWallet=false,days=1}={}){
 const events=Array.from({length:positions},(_,i)=>({kind:'stake',transactionHash:H(2000+i),logIndex:i,blockNumber:'100',blockHash:H(100),timestamp:T,wallet:W(sameWallet?1:i+1),positionId:String(i+1),shares:'1',amount:String(SHARE)}));
 await ingestEconomyEvents(db,c,{fromBlock:'100',toBlock:'101',toBlockHash:H(101),throughTimestamp:T+days*DAY,events});
}
function metered(db){
 const state={queries:0,maxReturnedPositions:0,maxBatch:0,positionSql:null,positionArgs:null,returnedPositions:0};
 const tick=n=>{state.queries+=n;if(state.queries>999)throw Error('D1_QUERY_BUDGET');};
 const wrap=stmt=>({...stmt,bind(...args){return wrap(stmt.bind(...args));},async first(){tick(1);return stmt.first();},async run(){tick(1);return stmt.run();},async all(){tick(1);const result=await stmt.all();if(stmt.sql.includes('remaining_shares FROM economy_position_balances')){state.maxReturnedPositions=Math.max(state.maxReturnedPositions,result.results.length);state.positionSql=stmt.sql;state.positionArgs=stmt.args;state.returnedPositions+=result.results.length;}return result;}});
 return {state,db:{prepare:sql=>wrap(db.prepare(sql)),batch:async statements=>{tick(statements.length);state.maxBatch=Math.max(state.maxBatch,statements.length);return db.batch(statements);}}};
}
test('34 wallets settle in bounded 32+2 pages; incomplete day never claims all wallets were paid',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c);const first=metered(db),a=await settleEconomy(first.db,c,{nowMs:T+DAY,maxDays:31});
  assert.equal(ECONOMY_SETTLEMENT_WALLET_LIMIT,32);assert.equal(a.settledDays,0);assert.equal(count(db,'economy_gold_journal'),32);assert.equal(count(db,'economy_gold_days'),0);assert.ok(first.state.maxBatch<=35);assert.ok(first.state.queries<50);
  const second=metered(db),b=await settleEconomy(second.db,c,{nowMs:T+DAY,maxDays:31});assert.equal(b.settledDays,1);assert.equal(count(db,'economy_gold_journal'),34);assert.equal(count(db,'economy_gold_days'),1);
  for(let i=1;i<=34;i++)assert.equal((await economyWalletSnapshot(db,c,W(i))).gold,'1');
  await settleEconomy(db,c,{nowMs:T+DAY});assert.equal(count(db,'economy_gold_journal'),34);
 }finally{db.raw.close();}
});
test('a single wallet with 65 lots spans position pages and receives one combined exact daily journal only after its last lot',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c,{positions:65,sameWallet:true});const first=metered(db);await settleEconomy(first.db,c,{nowMs:T+DAY,maxDays:31});
  assert.equal(ECONOMY_SETTLEMENT_POSITION_LIMIT,64);assert.ok(first.state.maxReturnedPositions<=65);assert.equal(count(db,'economy_gold_journal'),0);assert.equal(count(db,'economy_gold_days'),0);
  const p=db.raw.prepare('SELECT carry_reward carry,CAST(version AS TEXT) version,completed FROM economy_day_progress').get();assert.equal(p.carry,'64');assert.equal(p.completed,0);
  await settleEconomy(db,c,{nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,c,W(1))).gold,'65');assert.equal(count(db,'economy_gold_journal'),1);assert.equal(count(db,'economy_gold_days'),1);
 }finally{db.raw.close();}
});
test('concurrent isolates cannot duplicate a page, daily wallet credit or completion marker',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c);await Promise.all([settleEconomy(db,c,{nowMs:T+DAY}),settleEconomy(db,c,{nowMs:T+DAY}),settleEconomy(db,c,{nowMs:T+DAY})]);
  if(count(db,'economy_gold_journal')!==34)assert.equal(count(db,'economy_gold_days'),0);
  await settleEconomy(db,c,{nowMs:T+DAY});assert.equal(count(db,'economy_gold_journal'),34);assert.equal(count(db,'economy_gold_days'),1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_journal GROUP BY reference HAVING COUNT(*)>1').get(),undefined);
 }finally{db.raw.close();}
});
test('a failed wallet credit rolls back the entire page and cursor, allowing an exact later retry',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c);db.raw.exec("CREATE TRIGGER synthetic_reward_failure BEFORE INSERT ON economy_gold_journal WHEN NEW.wallet='"+W(20)+"' BEGIN SELECT RAISE(ABORT,'synthetic reward page failure'); END;");
  await assert.rejects(settleEconomy(db,c,{nowMs:T+DAY}),/synthetic reward page failure/);assert.equal(count(db,'economy_gold_accounts'),0);assert.equal(count(db,'economy_gold_journal'),0);assert.equal(count(db,'economy_settlement_pages'),0);assert.equal(count(db,'economy_gold_days'),0);
  const p=db.raw.prepare('SELECT last_wallet wallet,carry_reward carry,version FROM economy_day_progress').get();assert.equal(p.wallet,'');assert.equal(p.carry,'0');assert.equal(p.version,0);
  db.raw.exec('DROP TRIGGER synthetic_reward_failure');await settleEconomy(db,c,{nowMs:T+DAY});await settleEconomy(db,c,{nowMs:T+DAY});assert.equal(count(db,'economy_gold_journal'),34);assert.equal(count(db,'economy_gold_days'),1);
 }finally{db.raw.close();}
});
test('maxDays cannot multiply per-invocation position/wallet work; old days resume in order until caught up',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c,{positions:5,days:10});const run=metered(db),r=await settleEconomy(run.db,c,{nowMs:T+10*DAY,maxDays:31});
  assert.equal(r.settledDays,6);assert.equal(count(db,'economy_gold_journal'),32);assert.equal(count(db,'economy_gold_days'),6);assert.ok(run.state.queries<150);assert.ok(run.state.maxReturnedPositions<=65);
  for(let i=0;i<3;i++)await settleEconomy(db,c,{nowMs:T+10*DAY,maxDays:31});assert.equal(count(db,'economy_gold_journal'),50);assert.equal(count(db,'economy_gold_days'),10);
  for(let i=1;i<=5;i++)assert.equal((await economyWalletSnapshot(db,c,W(i))).gold,'10');
 }finally{db.raw.close();}
});
test('halt while a page is prepared denies all credits and progress advancement atomically',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c);const raced={...db,batch:async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO economy_settlement_pages')))await haltEconomyChain(db,c,'LOCAL_TEST_FINALITY_HALT');return db.batch(statements);}};
  await assert.rejects(settleEconomy(raced,c,{nowMs:T+DAY}));assert.equal(count(db,'economy_gold_journal'),0);assert.equal(count(db,'economy_gold_days'),0);assert.equal(count(db,'economy_settlement_pages'),0);assert.equal(db.raw.prepare('SELECT version FROM economy_day_progress').get().version,0);
 }finally{db.raw.close();}
});
test('closed lots retain their earlier completed-day reward and retire from later pages using the closed-time range index',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c,{positions:65,sameWallet:true});
  const withdrawals=Array.from({length:65},(_,i)=>({kind:'withdraw',transactionHash:H(5000+i),logIndex:i,blockNumber:'102',blockHash:H(102),timestamp:T+DAY+3600000,wallet:W(1),positionId:String(i+1),shares:'1',amount:String(SHARE)}));
  await ingestEconomyEvents(db,c,{fromBlock:'102',toBlock:'103',toBlockHash:H(103),throughTimestamp:T+4*DAY,events:withdrawals});
  const closed=db.raw.prepare('SELECT MIN(closed_ms) first,MAX(closed_ms) last FROM economy_positions').get();assert.equal(closed.first,T+DAY+3600000);assert.equal(closed.last,closed.first);
  await settleEconomy(db,c,{nowMs:T+4*DAY,maxDays:31});const run=metered(db),result=await settleEconomy(run.db,c,{nowMs:T+4*DAY,maxDays:31});
  assert.equal(result.settledDays,4);assert.equal((await economyWalletSnapshot(db,c,W(1))).gold,'65');assert.equal(count(db,'economy_gold_journal'),1);assert.equal(count(db,'economy_gold_days'),4);
  assert.equal(run.state.returnedPositions,1,'only the one outstanding lot of the eligible earlier day is returned; all later closed-history pages are empty');
  const plan=db.raw.prepare('EXPLAIN QUERY PLAN '+run.state.positionSql).all(...run.state.positionArgs).map(r=>r.detail).join('\n');
  assert.match(plan,/SEARCH economy_positions USING.*economy_positions_closed_end.*closed_ms>/);assert.match(plan,/economy_positions_open_page/);assert.doesNotMatch(plan,/SCAN economy_positions/);
 }finally{db.raw.close();}
});
test('full withdrawal exactly at the UTC boundary keeps the previous complete day and excludes the following day',async()=>{
 const db=openD1(),c=await config();try{
  await seed(db,c,{positions:1,sameWallet:true});
  const withdrawal={kind:'withdraw',transactionHash:H(5000),logIndex:0,blockNumber:'102',blockHash:H(102),timestamp:T+DAY,wallet:W(1),positionId:'1',shares:'1',amount:String(SHARE)};
  await ingestEconomyEvents(db,c,{fromBlock:'102',toBlock:'103',toBlockHash:H(103),throughTimestamp:T+2*DAY,events:[withdrawal]});
  await settleEconomy(db,c,{nowMs:T+2*DAY});assert.equal((await economyWalletSnapshot(db,c,W(1))).gold,'1');assert.equal(count(db,'economy_gold_journal'),1);assert.equal(count(db,'economy_gold_days'),2);
 }finally{db.raw.close();}
});
