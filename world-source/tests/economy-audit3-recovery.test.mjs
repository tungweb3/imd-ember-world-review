import test from 'node:test';
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {runEconomyRecoveryTool} from '../scripts/economy-recovery.mjs';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,economyChainState,economyWalletSnapshot,settleEconomy,createEconomyOrder,haltEconomyChain} from '../server/economy-ledger.ts';
import {stageEconomyBlock,pendingEconomyBlock} from '../server/economy-staging.ts';
import {prepareEconomyRecovery,applyEconomyRecovery} from '../server/economy-recovery.ts';
import {reconcileEconomyPayments,recordEconomyPaymentDisposition} from '../server/economy-reconciliation.ts';
import {parseEconomySnapshot} from '../src/world/economyClient.ts';
const T=Date.UTC(2026,9,1),W='0x'+'a'.repeat(40),X='0x'+'b'.repeat(40),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),PRICE=10n**18n;
const cfg=patch=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'audit-local',titleZh:'本機測試',titleEn:'Local test',gold:'1',embeo:String(PRICE)}],...patch});
const stake=(id,block,time,shares=1,wallet=W,logIndex=0)=>({kind:'stake',transactionHash:H(1000+id),logIndex,blockNumber:String(block),blockHash:H(block),timestamp:time,wallet,positionId:String(id),shares:String(shares),amount:String(SHARE*BigInt(shares))});
const withdraw=(block=102,time=T+DAY+1000)=>({...stake(1,block,time),kind:'withdraw',transactionHash:H(2000)});
const payment=(orderId,patch={})=>({kind:'payment',transactionHash:H(3000),logIndex:1,blockNumber:'102',blockHash:H(102),timestamp:T+DAY+1000,wallet:W,orderId,amount:String(PRICE),token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY,...patch});
const order=(db,c,id,currency='EMBEO',nowMs=T+DAY+10)=>createEconomyOrder(db,c,{wallet:W,requestId:id,serviceId:'audit-local',currency,nowMs});
const ingest=(db,c,events,from='102',to=from,through=T+DAY+1000)=>ingestEconomyEvents(db,c,{fromBlock:from,toBlock:to,toBlockHash:H(Number(to)),throughTimestamp:through,events});
const stage=(db,c,events,offset=0,totalLogs=events.length,block=102,time=T+DAY+1000)=>stageEconomyBlock(db,c,{number:String(block),hash:H(block),parentHash:H(block-1),throughMs:time,totalLogs,digest:'d'.repeat(64),offset,events});
const sum=db=>Number(db.raw.prepare('SELECT COALESCE(SUM(balance),0) n FROM economy_gold_accounts').get().n);
const rows=(db,table)=>db.raw.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
const dump=db=>JSON.stringify(db.raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'economy_%' ORDER BY name").all().map(({name})=>[name,rows(db,name)]));
async function complete(db,c,time){for(let i=0;i<12;i++)await settleEconomy(db,c,{nowMs:time});}
async function haltFixture(kind,mode='direct'){
 const db=openD1(),shadow=openD1(),c=await cfg(),next=await cfg({deploymentBlock:'99'});
 const count=kind.startsWith('wallet')?Number(kind.slice(6)):kind.startsWith('position')?Number(kind.slice(8)):1;
 const events=Array.from({length:count},(_,i)=>stake(i+2,100,T,1,kind.startsWith('wallet')?'0x'+BigInt(i+1).toString(16).padStart(40,'0'):W,i));
 await ingest(db,c,events,'100','101',T+DAY);
 if(kind!=='none')await settleEconomy(db,c,{nowMs:T+DAY});
 const quote=await order(db,c,'audit3-halted-order-0001'),failed=[withdraw(),payment(quote.id)];
 if(mode==='staged'){await stage(db,c,failed.slice(0,1),0,2);await assert.rejects(stage(db,c,failed.slice(1),1,2),/ECONOMY_HALTED/);}
 else await assert.rejects(ingest(db,c,failed),/ECONOMY_HALTED/);
 await ingest(shadow,next,[stake(1,99,T,2),...events],'99','101',T+DAY);await complete(shadow,next,T+DAY);
 return {db,shadow,c,next,count,quote,failed,close(){db.raw.close();shadow.raw.close();}};
}

for(const mode of ['direct','staged'])for(const kind of ['none','wallet32','wallet33','position64','position65','settled']){
 test(`Audit3 B01 ${mode}/${kind}: halted incomplete UTC journals recover actual shortfall once, then late payment and future days resume`,async()=>{
  const f=await haltFixture(kind,mode),{db,shadow,c,next}=f;try{
   const before=sum(db),journal=rows(db,'economy_gold_journal'),progress=rows(db,'economy_day_progress'),pending=await pendingEconomyBlock(db,c);
   if(kind==='wallet33'||kind==='position65')assert.equal(progress[0].completed,0);
   await assert.rejects(settleEconomy(db,c,{nowMs:T+DAY+1001}),/ECONOMY_HALTED/);
   const plan=await prepareEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001});
   assert.equal(plan.report.totalDelta,String(f.count+2-before));
   await applyEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:plan.hash});
   assert.equal(sum(db),f.count+2);
   for(const j of journal)assert.deepEqual(db.raw.prepare('SELECT * FROM economy_gold_journal WHERE id=?').get(j.id),j);
   assert.deepEqual(rows(db,'economy_day_progress').filter(r=>r.config_id===c.id),progress);
   assert.deepEqual(await pendingEconomyBlock(db,c),pending);
   assert.equal((await economyChainState(db,c)).haltedReason,'INVALID_POSITION_WITHDRAWAL');
   const after=dump(db);assert.equal((await applyEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:plan.hash})).replayed,true);assert.equal(dump(db),after);
   if(mode==='staged')await stage(db,next,f.failed);else await ingest(db,next,f.failed);
   assert.equal(db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(f.quote.id).status,'paid');
   assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,1);
   await ingest(db,next,[],'103','103',T+2*DAY);await complete(db,next,T+2*DAY);
   assert.equal(sum(db),2*f.count+3);await complete(db,next,T+2*DAY);assert.equal(sum(db),2*f.count+3);
   await assert.rejects(order(db,c,'audit3-retired-order-01'),/ECONOMY_HALTED|ECONOMY_CONFIG_REPLACED/);
  }finally{f.close();}
 });
}

for(const mode of ['direct','staged'])for(const first of ['owner','other'])for(const count of [1,2]){
 test(`Audit3 B02 ${mode}/${first}/${count} physical payment(s): pending is visible/deferred; classification follows actual fulfillment`,async()=>{
  // Two identical exact payments are defensive indexer input, not a claim
  // that EmbeoPayments can emit them. Its actual EVM replay guard is separate.
  const db=openD1(),owner=await cfg(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
   for(const c of [owner,other])await ingest(db,c,[],'100','101',T+DAY);
   const q=await order(db,owner,'audit3-shared-order-001'),events=Array.from({length:count},(_,i)=>payment(q.id,{transactionHash:H(3000+i),logIndex:i+1}));
   for(const c of first==='owner'?[owner,other]:[other,owner]){
    if(mode==='staged')await stage(db,c,events);else await ingest(db,c,events);
    if(c.id===other.id&&first==='other'){
     assert.equal(rows(db,'economy_payment_cases').length,0,'an unfulfilled exact payment has no final immutable classification');
     const pending=await reconcileEconomyPayments(db,other);assert.equal(pending.remaining,count);assert.equal(pending.deferred,count);assert.equal(pending.awaitingFulfillment,count);
     const snapshot=await economyWalletSnapshot(db,owner,W);assert.equal(snapshot.orders[0].status,'pending');assert.equal(snapshot.paymentCases.length,count);
     assert.ok(snapshot.paymentCases.every(r=>r.classification==='pending-fulfillment'&&r.correctPaymentEvent===null));
     assert.equal(parseEconomySnapshot(snapshot,W).paymentCases.length,count);assert.deepEqual((await economyWalletSnapshot(db,owner,X)).paymentCases,[]);
    }
   }
   assert.equal(rows(db,'economy_fulfillments').length,1);
   const cases=rows(db,'economy_payment_cases');assert.equal(cases.filter(r=>r.classification==='matched').length,1);assert.equal(cases.filter(r=>r.classification==='extra-payment').length,count-1);
   const visible=(await economyWalletSnapshot(db,owner,W)).paymentCases;assert.equal(visible.length,count-1);
   if(count===2){const extra=visible[0];assert.equal(extra.classification,'extra-payment');await recordEconomyPaymentDisposition(db,{eventId:extra.id,requestId:'audit3-extra-note-0001',action:'note',note:'Retain the extra payment; no automatic refund.',nowMs:T+DAY+1001});}
   for(const c of [owner,other]){const result=await reconcileEconomyPayments(db,c);assert.equal(result.remaining,0);assert.equal(result.deferred,0);}
  }finally{db.raw.close();}
 });
}

for(const mode of ['direct','staged'])test(`Audit3 B02 ${mode}: a halted owner and real single payment stay pending until controlled lineage recovery`,async()=>{
 const f=await haltFixture('none'),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
  await ingest(f.db,other,[],'100','101',T+DAY);const e=payment(f.quote.id);
  if(mode==='staged')await stage(f.db,other,[e]);else await ingest(f.db,other,[e]);
  const waiting=await reconcileEconomyPayments(f.db,other);assert.equal(waiting.deferred,1);assert.equal(waiting.awaitingFulfillment,1);
  assert.equal((await economyWalletSnapshot(f.db,f.c,W)).paymentCases[0].classification,'pending-fulfillment');
  const plan=await prepareEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:T+DAY+1001});await applyEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:T+DAY+1001,expectedPlanHash:plan.hash});
  if(mode==='staged')await stage(f.db,f.next,f.failed);else await ingest(f.db,f.next,f.failed);
  assert.equal(rows(f.db,'economy_fulfillments').length,1);assert.deepEqual((await economyWalletSnapshot(f.db,f.next,W)).paymentCases,[]);
  assert.equal((await reconcileEconomyPayments(f.db,other)).remaining,0);
 }finally{f.close();}
});

async function bootstrap(mode='direct'){
 const db=openD1(),shadow=openD1(),c=await cfg(),next=await cfg({deploymentBlock:'99'});
 const quote=await order(db,c,'audit3-first-batch-0001','EMBEO',T+1),failed=[withdraw(100,T+DAY+1000),payment(quote.id,{blockNumber:'100',blockHash:H(100)})];
 if(mode==='prefix'){await stage(db,c,failed.slice(0,1),0,2,100);await assert.rejects(stage(db,c,failed.slice(1),1,2,100),/ECONOMY_HALTED/);}
 else if(mode==='staged')await assert.rejects(stage(db,c,failed,0,2,100),/ECONOMY_HALTED/);
 else await assert.rejects(ingest(db,c,failed,'100'),/ECONOMY_HALTED/);
 await ingest(shadow,next,[stake(1,99,T,2)],'99','99',T);
 return {db,shadow,c,next,quote,failed,close(){db.raw.close();shadow.raw.close();}};
}
for(const mode of ['direct','staged','prefix'])test(`Audit3 B03 ${mode}: empty sentinel recovery uses verified predecessor and carries original pending quote`,async()=>{
 const f=await bootstrap(mode),{db,shadow,c,next}=f;try{
  assert.deepEqual(await economyChainState(db,c),{lastBlock:'99',lastHash:'',throughMs:0,haltedReason:'INVALID_POSITION_WITHDRAWAL'});
  const q=rows(db,'economy_orders')[0],pending=await pendingEconomyBlock(db,c);
  const plan=await prepareEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001});assert.equal(plan.report.totalDelta,'0');
  await applyEconomyRecovery(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:plan.hash});
  assert.deepEqual(rows(db,'economy_orders')[0],q);assert.deepEqual(await pendingEconomyBlock(db,c),pending);assert.equal(sum(db),0);
  if(mode==='direct')await ingest(db,next,f.failed,'100');else await stage(db,next,f.failed,0,2,100);
  assert.equal(rows(db,'economy_fulfillments').length,1);assert.equal(rows(db,'economy_orders')[0].id,f.quote.id);assert.equal(rows(db,'economy_orders')[0].status,'paid');
  await complete(db,next,T+DAY+1001);assert.equal(sum(db),2);await complete(db,next,T+DAY+1001);assert.equal(sum(db),2);
  await assert.rejects(ingest(db,c,[],'100'),/ECONOMY_HALTED/);
 }finally{f.close();}
});

test('Audit3 B03: a sentinel is not permission to accept a different height, malformed shadow, prior economic state or another halt',async()=>{
 for(const fault of ['height','hash','clock','events','binding','progress','journal','paid-order','other-halt']){
  const f=await bootstrap();try{
   if(fault==='height')await ingest(f.shadow,f.next,[],'100','100',T+DAY);
   if(fault==='hash')f.shadow.raw.exec("UPDATE economy_chain_state SET last_hash=''");
   if(fault==='clock')f.db.raw.exec('UPDATE economy_chain_state SET through_ms=1');
   if(fault==='events')f.db.raw.exec('UPDATE economy_chain_state SET last_block=100');
   if(fault==='binding')f.db.raw.prepare('INSERT INTO economy_reward_bindings VALUES(?,?)').run(`${f.c.chainId}:${f.c.token}:${f.c.stakingContract}`,f.c.id);
   if(fault==='progress'){f.db.raw.prepare('INSERT INTO economy_reward_bindings VALUES(?,?)').run(`${f.c.chainId}:${f.c.token}:${f.c.stakingContract}`,f.c.id);f.db.raw.prepare('INSERT INTO economy_day_progress(config_id,day_start_ms,position_ceiling) VALUES(?,?,?)').run(f.c.id,T,'');}
   if(fault==='journal')f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,1,'utc-reward',?,?)").run('audit3-forged-reward',W,`${f.c.id}:${T}:${W}`,T+DAY);
   if(fault==='paid-order')f.db.raw.prepare("UPDATE economy_orders SET status='paid',paid_ms=?,paid_event_id=? WHERE id=?").run(T+2,'forged-paid-event',f.quote.id);
   if(fault==='other-halt')f.db.raw.exec("UPDATE economy_chain_state SET halted_reason='FINALIZED_REORG'");
   const before=dump(f.db);await assert.rejects(prepareEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:T+DAY+1001}));assert.equal(dump(f.db),before);
  }finally{f.close();}
 }
});

test('Audit3 B01: partial-day plan still refuses stale snapshots, rolls back batch faults and never repeats a correction',async()=>{
 for(const fault of ['stale','batch']){
  const f=await haltFixture('wallet33');try{
   const nowMs=T+DAY+1001,p=await prepareEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs});
   if(fault==='stale')f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,-1,'service-payment',?,?)").run('audit3-concurrent-spend','0x'+(1n).toString(16).padStart(40,'0'),'audit3-concurrent-spend',nowMs);
   else f.db.raw.exec("CREATE TRIGGER audit3_fault BEFORE INSERT ON economy_gold_adjustments BEGIN SELECT RAISE(ABORT,'audit3 recovery fault'); END;");
   const before=dump(f.db);await assert.rejects(applyEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs,expectedPlanHash:p.hash}));assert.equal(dump(f.db),before);assert.equal(rows(f.db,'economy_recoveries').length,0);
   if(fault==='batch')f.db.raw.exec('DROP TRIGGER audit3_fault');
   const fresh=await prepareEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs});await applyEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs,expectedPlanHash:fresh.hash});assert.equal(sum(f.db),fault==='stale'?34:35);
  }finally{f.close();}
 }
});

test('Audit3 B01: an incomplete NORMAL config or unsupported halt cannot use halted credited-so-far recovery',async()=>{
 for(const halt of [null,'FINALIZED_REORG','FINALIZED_CURSOR_CHANGED']){
  const f=await haltFixture('none');try{
   f.db.raw.prepare('UPDATE economy_chain_state SET halted_reason=? WHERE config_id=?').run(halt,f.c.id);
   const before=dump(f.db);await assert.rejects(prepareEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:T+DAY+1001}));assert.equal(dump(f.db),before);
  }finally{f.close();}
 }
});

test('Audit3 B04: halt is per config; another legitimate vault retains its independently authorized GOLD scope',async()=>{
 const f=await haltFixture('settled'),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
  await ingest(f.db,other,[],'100','101',T+DAY);await assert.rejects(order(f.db,f.c,'audit3-halted-gold-0001','GOLD'),/ECONOMY_HALTED/);
  assert.equal((await order(f.db,other,'audit3-separate-gold-01','GOLD')).status,'pending');
  assert.equal((await economyChainState(f.db,other)).haltedReason,null);assert.equal((await economyWalletSnapshot(f.db,other,W)).gold,'1');
 }finally{f.close();}
});

test('Audit3 B01: a second earlier recovery after a partial-day correction counts ancestor journals and corrections once',async()=>{
 const f=await haltFixture('wallet33'),third=openD1();try{
  const nowMs=T+DAY+1001,p=await prepareEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs});await applyEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs,expectedPlanHash:p.hash});
  const earlier=await cfg({deploymentBlock:'98'}),events=rows(f.shadow,'economy_chain_events').map(e=>Object.fromEntries(Object.entries(JSON.parse(e.payload)).filter(([,v])=>v!==null)));
  await ingest(third,earlier,[stake(70,98,T),...events],'98','101',T+DAY);await complete(third,earlier,T+DAY);
  const again=await prepareEconomyRecovery(f.db,third,f.next,earlier,{nowMs:nowMs+1});assert.equal(again.report.totalDelta,'1');
  await applyEconomyRecovery(f.db,third,f.next,earlier,{nowMs:nowMs+1,expectedPlanHash:again.hash});assert.equal(sum(f.db),36);
  await complete(f.db,earlier,T+DAY);assert.equal(sum(f.db),36);assert.equal(rows(f.db,'economy_recoveries').length,2);
 }finally{third.raw.close();f.close();}
});

test('Audit3 B02 CLI: unresolved owner fulfillment fails explicitly without changing either input; after real indexing, metadata reconciliation completes',async()=>{
 const db=openD1(),owner=await cfg(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)}),folder=mkdtempSync(join(tmpdir(),'ember-audit3-cli-'));
 const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
 try{
  for(const c of [owner,other])await ingest(db,c,[],'100','101',T+DAY);
  const q=await order(db,owner,'audit3-cli-order-00001'),event=payment(q.id);await ingest(db,other,[event]);
  const original=join(folder,'pending.sqlite'),config=join(folder,'other.json');await backup(db.raw,original);writeFileSync(config,JSON.stringify(other));const before=hash(original);
  const args=file=>['reconcile-copy','--original',file,'--from-config',config,'--now-ms',String(T+DAY+1001)];
  await assert.rejects(runEconomyRecoveryTool([...args(original),'--out',join(folder,'deferred')]),/RECONCILIATION_ORDER_FULFILLMENT_REQUIRED/);
  assert.equal(hash(original),before);assert.equal(rows(db,'economy_fulfillments').length,0);assert.equal(JSON.parse(readFileSync(join(folder,'deferred/receipt.private.json'))).status,'FAIL');
  await ingest(db,owner,[event]);const paid=join(folder,'paid.sqlite');await backup(db.raw,paid);const paidHash=hash(paid);
  const receipt=await runEconomyRecoveryTool([...args(paid),'--out',join(folder,'completed')]);assert.equal(receipt.status,'PASS');assert.equal(receipt.remaining,0);assert.equal(hash(paid),paidHash);assert.equal(hash(original),before);
  assert.equal(rows(db,'economy_fulfillments').length,1);assert.equal(sum(db),0);
 }finally{db.raw.close();const absolute=realpathSync(folder),temporary=realpathSync(tmpdir());assert.ok(absolute.toLowerCase().startsWith((temporary+sep).toLowerCase()));assert.ok(absolute.includes('ember-audit3-cli-'));rmSync(absolute,{recursive:true,force:true});}
});
