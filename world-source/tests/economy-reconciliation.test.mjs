import test from 'node:test';
import assert from 'node:assert/strict';
import {backup} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {runEconomyRecoveryTool,openEconomySqlite} from '../scripts/economy-recovery.mjs';
// Original standalone catalogue invariants; current shared route refusals are tested by Audit6.
import {openStandaloneEconomyD1 as openD1,migrationFiles} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy,economyWalletSnapshot,createEconomyOrder,createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import {prepareEconomyRecovery,applyEconomyRecovery} from '../server/economy-recovery.ts';
import {recordEconomyPaymentDisposition,reconcileEconomyPayments} from '../server/economy-reconciliation.ts';
import {stageEconomyBlock} from '../server/economy-staging.ts';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
const T=Date.UTC(2026,9,1),account=privateKeyToAccount(generatePrivateKey()),W=account.address.toLowerCase(),OTHER='0x'+'b'.repeat(40),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const cfg=patch=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'recovery-test',titleZh:'本機測試',titleEn:'Local fixture',gold:'1',embeo:String(10n**18n)}],...patch});
const stake=(position,block,time,shares=1)=>({kind:'stake',transactionHash:H(1000+position),logIndex:0,blockNumber:String(block),blockHash:H(block),timestamp:time,wallet:W,positionId:String(position),shares:String(shares),amount:String(SHARE*BigInt(shares))});
const payment=(orderId,amount,block=102,logIndex=0,wallet=W)=>({kind:'payment',transactionHash:H(2000+block*10+logIndex),logIndex,blockNumber:String(block),blockHash:H(block),timestamp:T+DAY+1000,wallet,orderId,amount:String(amount),token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY});
async function fixture(){
 const db=openD1(),rebuilt=openD1(),from=await cfg(),to=await cfg({deploymentBlock:'99'});
 await ingestEconomyEvents(db,from,{fromBlock:'100',toBlock:'101',toBlockHash:H(101),throughTimestamp:T+DAY,events:[stake(1,100,T)]});await settleEconomy(db,from,{nowMs:T+DAY});
 await ingestEconomyEvents(rebuilt,to,{fromBlock:'99',toBlock:'101',toBlockHash:H(101),throughTimestamp:T+DAY,events:[stake(2,99,T),stake(1,100,T)]});await settleEconomy(rebuilt,to,{nowMs:T+DAY});
 return {db,rebuilt,from,to,close(){db.raw.close();rebuilt.raw.close();}};
}
const dump=db=>JSON.stringify(db.raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'economy_%' ORDER BY name").all().map(({name})=>[name,db.raw.prepare('SELECT * FROM '+name).all()]));
test('historical recovery compares EARNED GOLD, preserves spent balances and old rows, applies once then continues future settlement',async()=>{
 const f=await fixture(),{db,rebuilt,from,to}=f;try{
  const order=await createEconomyOrder(db,from,{wallet:W,requestId:'recovery-spend-0001',serviceId:'recovery-test',currency:'GOLD',nowMs:T+DAY+1});
  const c=await createEconomyGoldChallenge(db,from,{wallet:W,orderId:order.id,requestId:'recovery-proof-0001',origin:'https://imdember.com',nowMs:T+DAY+2});
  await payEconomyOrderGold(db,from,{wallet:W,orderId:order.id,requestId:c.requestId,origin:c.origin,signature:await account.signMessage({message:c.message}),nowMs:T+DAY+3});
  assert.equal((await economyWalletSnapshot(db,from,W)).gold,'0');const oldJournal=db.raw.prepare('SELECT * FROM economy_gold_journal ORDER BY id').all();
  const plan=await prepareEconomyRecovery(db,rebuilt,from,to,{nowMs:T+DAY+10});assert.equal(plan.report.totalDelta,'1');assert.equal(plan.report.adjustments[0].creditedBefore,'1');assert.equal(plan.report.adjustments[0].entitlement,'2');
  const applied=await applyEconomyRecovery(db,rebuilt,from,to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash});assert.equal(applied.replayed,false);
  assert.equal((await economyWalletSnapshot(db,to,W)).gold,'1');for(const row of oldJournal)assert.deepEqual(db.raw.prepare('SELECT * FROM economy_gold_journal WHERE id=?').get(row.id),row);
  const before=dump(db);assert.equal((await applyEconomyRecovery(db,rebuilt,from,to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash})).replayed,true);assert.equal(dump(db),before);
  await settleEconomy(db,to,{nowMs:T+DAY+11});assert.equal((await economyWalletSnapshot(db,to,W)).gold,'1');
  await ingestEconomyEvents(db,to,{fromBlock:'102',toBlock:'102',toBlockHash:H(102),throughTimestamp:T+2*DAY,events:[]});await settleEconomy(db,to,{nowMs:T+2*DAY});assert.equal((await economyWalletSnapshot(db,to,W)).gold,'3');
  assert.ok((await economyWalletSnapshot(db,to,W)).journal.some(r=>r.kind==='historical-adjustment'&&r.delta==='1'));
  await assert.rejects(settleEconomy(db,from,{nowMs:T+2*DAY}),/ECONOMY_CONFIG_CONFLICT/);
  const retired=dump(db);await assert.rejects(createEconomyOrder(db,from,{wallet:W,requestId:'retired-config-0001',serviceId:'recovery-test',currency:'GOLD',nowMs:T+2*DAY}),/ECONOMY_CONFIG_REPLACED/);
  await assert.rejects(ingestEconomyEvents(db,from,{fromBlock:'102',toBlock:'102',toBlockHash:H(102),throughTimestamp:T+2*DAY,events:[]}));assert.equal(dump(db),retired);
  const separate=await cfg({stakingContract:'0x'+'4'.repeat(40)});await ingestEconomyEvents(db,separate,{fromBlock:'100',toBlock:'101',toBlockHash:H(101),throughTimestamp:T+DAY,events:[stake(1,100,T)]});await settleEconomy(db,separate,{nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,separate,W)).gold,'4');
 }finally{f.close();}
});
test('local plan/stage CLI creates an independently checked copy and exact private batch; both input SQLite exports stay byte-identical',async()=>{
 const f=await fixture(),folder=mkdtempSync(join(tmpdir(),'ember-recovery-cli-'));let staged;
 const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 try{
  const original=join(folder,'original.sqlite'),rebuilt=join(folder,'rebuilt.sqlite'),fromFile=join(folder,'from.json'),toFile=join(folder,'to.json');
  await backup(f.db.raw,original);await backup(f.rebuilt.raw,rebuilt);writeFileSync(fromFile,JSON.stringify(f.from));writeFileSync(toFile,JSON.stringify(f.to));const before=[hash(original),hash(rebuilt)];
  const common=['--original',original,'--rebuilt',rebuilt,'--from-config',fromFile,'--to-config',toFile,'--now-ms',String(T+DAY+10)];
  const plan=await runEconomyRecoveryTool(['plan',...common,'--out',join(folder,'plan')]);
  await runEconomyRecoveryTool(['stage',...common,'--expected-plan',plan.planHash,'--out',join(folder,'stage')]);
  assert.deepEqual([hash(original),hash(rebuilt)],before);staged=openEconomySqlite(join(folder,'stage/database.private.sqlite'),{readOnly:true});assert.equal((await economyWalletSnapshot(staged,f.to,W)).gold,'2');
  const batch=JSON.parse(readFileSync(join(folder,'stage/migration-batch.private.json'),'utf8'));assert.equal(batch.batches.length,1);assert.ok(batch.batches[0][0].sql.includes('INSERT INTO economy_recoveries'));assert.ok(!JSON.stringify(batch).includes('DELETE FROM'));
  await assert.rejects(runEconomyRecoveryTool(['stage',...common,'--expected-plan','0'.repeat(64),'--out',join(folder,'wrong-plan')]),/RECOVERY_PLAN_CHANGED/);assert.deepEqual([hash(original),hash(rebuilt)],before);
 }finally{staged?.raw.close();f.close();assert.ok(realpathSync(folder).toLowerCase().startsWith((realpathSync(tmpdir())+sep).toLowerCase()));assert.ok(folder.includes('ember-recovery-cli-'));rmSync(folder,{recursive:true,force:true});}
});
test('a second earlier rebuild includes ancestor rewards and prior adjustments, never re-credits an already corrected share-day',async()=>{
 const f=await fixture(),third=openD1();try{
  const p=await prepareEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10});await applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:p.hash});
  await ingestEconomyEvents(f.db,f.to,{fromBlock:'102',toBlock:'102',toBlockHash:H(102),throughTimestamp:T+2*DAY,events:[]});await settleEconomy(f.db,f.to,{nowMs:T+2*DAY});
  const c=await cfg({deploymentBlock:'98'});await ingestEconomyEvents(third,c,{fromBlock:'98',toBlock:'102',toBlockHash:H(102),throughTimestamp:T+2*DAY,events:[stake(3,98,T),stake(2,99,T),stake(1,100,T)]});await settleEconomy(third,c,{nowMs:T+2*DAY});
  const next=await prepareEconomyRecovery(f.db,third,f.to,c,{nowMs:T+2*DAY+10});assert.equal(next.report.totalDelta,'2');await applyEconomyRecovery(f.db,third,f.to,c,{nowMs:T+2*DAY+10,expectedPlanHash:next.hash});assert.equal((await economyWalletSnapshot(f.db,c,W)).gold,'6');
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_recoveries').get().n,2);
 }finally{third.raw.close();f.close();}
});
test('recovery refuses stale plans and wrong reviewed hashes without economic writes',async()=>{
 const f=await fixture();try{const plan=await prepareEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10});
  await createEconomyOrder(f.db,f.from,{wallet:W,requestId:'changed-order-00001',serviceId:'recovery-test',currency:'EMBEO',nowMs:T+DAY+1});const before=dump(f.db);
  await assert.rejects(applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash}),/RECOVERY_PLAN_CHANGED/);assert.equal(dump(f.db),before);
  const fresh=await prepareEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10});await assert.rejects(applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:'f'.repeat(64)}),/RECOVERY_PLAN_CHANGED/);assert.equal(fresh.report.totalDelta,'1');
 }finally{f.close();}
});
test('independent recovery includes partial withdrawals, midnight closure and separate midday deposits without inheriting eligibility',async()=>{
 const db=openD1(),rebuilt=openD1(),a=await cfg(),b=await cfg({deploymentBlock:'99'});try{
  await ingestEconomyEvents(db,a,{fromBlock:'100',toBlock:'104',toBlockHash:H(104),throughTimestamp:T+3*DAY,events:[stake(1,100,T)]});await settleEconomy(db,a,{nowMs:T+3*DAY});
  const withdraw=(block,time,shares)=>({...stake(2,block,time,shares),kind:'withdraw',transactionHash:H(5000+block)});
  await ingestEconomyEvents(rebuilt,b,{fromBlock:'99',toBlock:'104',toBlockHash:H(104),throughTimestamp:T+3*DAY,events:[stake(2,99,T,3),stake(1,100,T),stake(3,101,T+DAY/2),withdraw(102,T+DAY+DAY/2,1),withdraw(103,T+2*DAY,2)]});await settleEconomy(rebuilt,b,{nowMs:T+3*DAY});
  const plan=await prepareEconomyRecovery(db,rebuilt,a,b,{nowMs:T+3*DAY+1});assert.equal(plan.report.totalDelta,'7');assert.deepEqual(plan.report.adjustments.map(r=>r.delta),['3','3','1']);
  await applyEconomyRecovery(db,rebuilt,a,b,{nowMs:T+3*DAY+1,expectedPlanHash:plan.hash});assert.equal((await economyWalletSnapshot(db,b,W)).gold,'10');
 }finally{db.raw.close();rebuilt.raw.close();}
});
test('migration-copy upgrades a real pre0013 historical SQLite export without modifying the original or its reward journal',async()=>{
 const f=await fixture(),legacy=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<13)),folder=mkdtempSync(join(tmpdir(),'ember-recovery-migrate-'));let migrated;
 try{
  for(const table of ['economy_chain_state','economy_reward_bindings','economy_chain_events','economy_gold_journal','economy_day_progress','economy_gold_days']){
   const rows=f.db.raw.prepare('SELECT * FROM '+table).all();for(const row of rows){const columns=Object.keys(row);legacy.raw.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(row));}
  }
  const original=join(folder,'legacy.sqlite');await backup(legacy.raw,original);const before=readFileSync(original);
  await runEconomyRecoveryTool(['migrate-copy','--original',original,'--out',join(folder,'migration')]);assert.deepEqual(readFileSync(original),before);
  migrated=openEconomySqlite(join(folder,'migration/database.private.sqlite'),{readOnly:true});assert.equal((await prepareEconomyRecovery(migrated,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10})).report.totalDelta,'1');
  assert.deepEqual(migrated.raw.prepare('SELECT * FROM economy_gold_journal').all(),legacy.raw.prepare('SELECT * FROM economy_gold_journal').all());
 }finally{migrated?.raw.close();legacy.raw.close();f.close();assert.ok(realpathSync(folder).toLowerCase().startsWith((realpathSync(tmpdir())+sep).toLowerCase()));assert.ok(folder.includes('ember-recovery-migrate-'));rmSync(folder,{recursive:true,force:true});}
});
test('fault during recovery batch rolls back binding, journals, imported positions and receipt together; retry is safe',async()=>{
 const f=await fixture();try{const plan=await prepareEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10}),before=dump(f.db);
  f.db.raw.exec("CREATE TRIGGER recovery_fault BEFORE INSERT ON economy_gold_adjustments BEGIN SELECT RAISE(ABORT,'synthetic recovery failure'); END;");
  await assert.rejects(applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash}),/synthetic recovery failure/);assert.equal(dump(f.db),before);
  f.db.raw.exec('DROP TRIGGER recovery_fault');await applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash});assert.equal((await economyWalletSnapshot(f.db,f.to,W)).gold,'2');
 }finally{f.close();}
});
test('recovery final SQL snapshot guard catches a spend arriving AFTER planning reads and before batch',async()=>{
 const f=await fixture();try{const plan=await prepareEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10}),batch=f.db.batch;let injected=false;
  f.db.batch=async statements=>{if(!injected&&statements[0]?.sql.includes('INSERT INTO economy_recoveries')){injected=true;f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,-1,'service-payment',?,?)").run('synthetic-concurrent-spend',W,'synthetic-concurrent-spend',T+DAY+5);}return batch(statements);};
  await assert.rejects(applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash}));assert.equal(injected,true);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_recoveries').get().n,0);assert.equal((await economyWalletSnapshot(f.db,f.from,W)).gold,'0');
 }finally{f.close();}
});
test('operator prerequisites reject different vault/payment, incomplete or conflicting proofs and overissuance; no automatic clawback',async()=>{
 for(const mode of ['payment','vault','boundary','incomplete','missing-proof','overissued']){
  const f=await fixture();try{
   let to=f.to;if(mode==='payment')to=await cfg({deploymentBlock:'99',paymentContract:'0x'+'3'.repeat(40)});if(mode==='vault')to=await cfg({deploymentBlock:'99',stakingContract:'0x'+'3'.repeat(40)});
   if(mode==='boundary')f.rebuilt.raw.prepare('UPDATE economy_chain_state SET last_hash=?').run(H(999));
   if(mode==='incomplete')f.rebuilt.raw.exec('DELETE FROM economy_gold_days');
   if(mode==='missing-proof'){f.rebuilt.raw.exec('DROP TRIGGER economy_event_no_delete');f.rebuilt.raw.prepare('DELETE FROM economy_chain_events WHERE position_id=?').run('1');}
   if(mode==='overissued')f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,3,'utc-reward',?,?)").run('synthetic-extra',W,`${f.from.id}:${T-DAY}:${W}`,T+DAY);
   const before=dump(f.db);await assert.rejects(prepareEconomyRecovery(f.db,f.rebuilt,f.from,to,{nowMs:T+DAY+10}));assert.equal(dump(f.db),before);
  }finally{f.close();}
 }
});
test('same-payment-contract lineage preserves GOLD request identity and a pending old EMBEO quote fulfilled after recovery',async()=>{
 const f=await fixture();try{
  const original=await createEconomyOrder(f.db,f.from,{wallet:W,requestId:'old-quote-000000001',serviceId:'recovery-test',currency:'EMBEO',nowMs:T+DAY+1});
  const gold=await createEconomyOrder(f.db,f.from,{wallet:W,requestId:'old-gold-0000000001',serviceId:'recovery-test',currency:'GOLD',nowMs:T+DAY+1});
  const plan=await prepareEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10});await applyEconomyRecovery(f.db,f.rebuilt,f.from,f.to,{nowMs:T+DAY+10,expectedPlanHash:plan.hash});
  assert.deepEqual(await createEconomyOrder(f.db,f.to,{wallet:W,requestId:'old-gold-0000000001',serviceId:'recovery-test',currency:'GOLD',nowMs:T+DAY+20}),gold);
  const c=await createEconomyGoldChallenge(f.db,f.to,{wallet:W,orderId:gold.id,requestId:'old-gold-proof-0001',origin:'https://imdember.com',nowMs:T+DAY+20});
  assert.equal((await payEconomyOrderGold(f.db,f.to,{wallet:W,orderId:gold.id,requestId:c.requestId,origin:c.origin,signature:await account.signMessage({message:c.message}),nowMs:T+DAY+21})).status,'paid');
  await ingestEconomyEvents(f.db,f.to,{fromBlock:'102',toBlock:'102',toBlockHash:H(102),throughTimestamp:T+DAY+1000,events:[payment(original.id,10n**18n)]});
  assert.equal(f.db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(original.id).status,'paid');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments WHERE order_id=?').get(original.id).n,1);
 }finally{f.close();}
});
test('wrong/unknown/wrong-payer payments retain facts, never grant entitlement, and correct later payment stays linked once',async()=>{
 const db=openD1(),c=await cfg();try{
  const order=await createEconomyOrder(db,c,{wallet:W,requestId:'payment-case-000001',serviceId:'recovery-test',currency:'EMBEO',nowMs:T+DAY});
  await ingestEconomyEvents(db,c,{fromBlock:'100',toBlock:'102',toBlockHash:H(102),throughTimestamp:T+DAY+1000,events:[payment(order.id,1n,102,0),payment(order.id,10n**18n,102,1,OTHER),payment(H(444),1n,102,2)]});
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,0);let view=await economyWalletSnapshot(db,c,W);assert.equal(view.paymentCases.length,2);assert.equal(view.paymentCases.find(p=>p.classification==='wrong-amount').expectedAmount,String(10n**18n));
  const wrongPayer=(await economyWalletSnapshot(db,c,OTHER)).paymentCases[0];assert.equal(wrongPayer.expectedAmount,null);assert.equal(wrongPayer.correctPaymentEvent,null);
  const e=payment(order.id,10n**18n,103);await ingestEconomyEvents(db,c,{fromBlock:'103',toBlock:'103',toBlockHash:H(103),throughTimestamp:T+DAY+1000,events:[e]});
  view=await economyWalletSnapshot(db,c,W);assert.ok(view.paymentCases.find(p=>p.classification==='wrong-amount').correctPaymentEvent);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,1);
  const id=view.paymentCases.find(p=>p.classification==='wrong-amount').id,action={eventId:id,requestId:'case-disposition-001',action:'acknowledged-no-entitlement',note:'Reviewed: wrong amount has no service and no automatic refund.',nowMs:T+DAY+1001};
  const before=db.raw.prepare('SELECT * FROM economy_orders').all();assert.deepEqual(await recordEconomyPaymentDisposition(db,action),await recordEconomyPaymentDisposition(db,action));assert.deepEqual(db.raw.prepare('SELECT * FROM economy_orders').all(),before);
  await assert.rejects(recordEconomyPaymentDisposition(db,{...action,note:'Changed'}),/IDEMPOTENCY_CONFLICT/);assert.equal((await economyWalletSnapshot(db,c,W)).paymentCases.find(p=>p.id===id).disposition,'acknowledged-no-entitlement');
  for(const table of ['economy_payment_cases','economy_payment_case_actions'])assert.throws(()=>db.raw.exec('DELETE FROM '+table),/IMMUTABLE/);
 }finally{db.raw.close();}
});
test('staged payments have no visible case/entitlement before fold and all cases/cursor roll back on final failure',async()=>{
 const db=openD1(),c=await cfg();try{const events=Array.from({length:300},(_,i)=>payment(H(3000+i),1n,100,i));
  const page={number:'100',hash:H(100),parentHash:H(99),throughMs:T+DAY+1000,totalLogs:300,digest:'f'.repeat(64)};
  await stageEconomyBlock(db,c,{...page,offset:0,events:events.slice(0,128)});assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_payment_cases').get().n,0);
  await stageEconomyBlock(db,c,{...page,offset:128,events:events.slice(128,256)});assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_payment_cases').get().n,0);
  db.raw.exec("CREATE TRIGGER case_fault BEFORE INSERT ON economy_payment_cases BEGIN SELECT RAISE(ABORT,'synthetic case failure'); END;");
  await assert.rejects(stageEconomyBlock(db,c,{...page,offset:256,events:events.slice(256)}),/synthetic case failure/);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_chain_events').get().n,0);
  db.raw.exec('DROP TRIGGER case_fault');await stageEconomyBlock(db,c,{...page,offset:256,events:events.slice(256)});assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_payment_cases').get().n,300);
  assert.equal((await reconcileEconomyPayments(db,c)).remaining,0);
 }finally{db.raw.close();}
});
