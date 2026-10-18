import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {defineEconomyConfig} from '../server/economy-config.ts';
import {ingestEconomyEvents,payEconomyOrderGold,createEconomyGoldChallenge} from '../server/economy-ledger.ts';
import {prepareEconomyRecovery,preflightEconomyRecovery} from '../server/economy-recovery.ts';
import {createWorker} from '../worker/app.ts';
import * as gold from '../server/world-gold.ts';
import {fixture,NOW,OWNER,W,B,H,rid,mintProof} from './world-gold-audit5-fixture.mjs';

test('Audit M2: pre-0014 historical planner and preflight remain usable',async()=>{
 const f=await fixture(),files=migrationFiles().filter(n=>Number(n.slice(0,4))<14),db=openD1(files),shadow=openD1(files);
 try{const next=await defineEconomyConfig({...f.config,deploymentBlock:'99'});for(const [target,c,from] of [[db,f.config,'100'],[shadow,next,'99']])await ingestEconomyEvents(target,c,{fromBlock:from,toBlock:'102',toBlockHash:H(102),throughTimestamp:NOW+2*86400000,events:[]});
 const args={nowMs:NOW+2*86400000+1},plan=await prepareEconomyRecovery(db,shadow,f.config,next,args);assert.equal(plan.report.totalDelta,'0');assert.equal((await preflightEconomyRecovery(db,shadow,f.config,next,args)).status,'ready');
 }finally{f.close();db.raw.close();shadow.raw.close();}
});
test('Audit L3: pause rejects both fresh challenge and pre-signed service debit; resume pays once',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.quote('research'),signed=await f.challenge(id);await f.admin({action:'control',feature:'service',enabled:false,version:0});
 await assert.rejects(createEconomyGoldChallenge(f.db,f.config,{wallet:W,orderId:id,requestId:rid(),origin:'https://imdember.com',nowMs:NOW,serviceReady:true}),/FEATURE_PAUSED/);
 await assert.rejects(payEconomyOrderGold(f.db,f.config,signed),/FEATURE_PAUSED/);assert.equal((await f.snapshot()).book,'10');
 await f.admin({action:'control',feature:'service',enabled:true,version:1});await payEconomyOrderGold(f.db,f.config,signed);await payEconomyOrderGold(f.db,f.config,signed);assert.equal((await f.snapshot()).book,'7');
 }finally{f.close();}});
test('Audit L4: oversized result is terminal and refunds once; stale completion cannot alter it',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);await gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+1,outcome:{result:'x'.repeat(16001)}});
 assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'refunded');assert.equal((await f.snapshot()).book,'10');await gold.refundGold(f.db,id,NOW+2);await assert.rejects(gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+3,outcome:{result:'late'}}),/STALE_DELIVERY/);
 }finally{f.close();}});
test('Audit L5: one pre-existing overflowing credit cannot stop other wallets or future reconciliation',async()=>{const f=await fixture();try{
 f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,9223372036854775807,'utc-reward',?,?)").run('old-max-reward',B,'old-max-reward',NOW);
 const poisoned=await f.quote('pack',B);await f.paid(poisoned);const normal=await f.quote();await f.paid(normal);await gold.reconcileWorldGold(f.db,NOW);assert.equal((await f.snapshot()).book,'10');
 const again=await f.quote();await f.paid(again);await gold.reconcileWorldGold(f.db,NOW+1);assert.equal((await f.snapshot()).book,'20');
 assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM world_gold_entries WHERE order_id=?").get(poisoned).n,0);
 await assert.rejects(f.admin({action:'product',product:'unsafe',kind:'topup',title:'Unsafe',gold:'9223372036854775807',embeo:'1',enabled:true,version:1}));
 }finally{f.close();}});
test('Audit L6: timeout-shaped evidence cannot release an executable Mint through API or raw SQL',async()=>{const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);await assert.rejects(gold.settleMintGold(f.db,{id:m.id,chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,state:'released',evidence:{timeout:true}},NOW+1),/MINT_.*(PROOF|EVIDENCE|EXECUTABLE)/);
 assert.throws(()=>f.db.raw.prepare("UPDATE world_gold_mints SET state='released',evidence_json=? WHERE id=?").run('{"timeout":true}',m.id));assert.equal((await f.snapshot()).reserved,'8');
 }finally{f.close();}});
test('Audit L7: persisted-scope recovery settles an original held order without a memory order map',async()=>{const f=await fixture();try{await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);const r=await gold.reconcileHeldMintGold(f.db,{chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,read:async stored=>{assert.equal(stored.id,m.id);assert.deepEqual(stored.auth,m.auth);return mintProof(stored);}},NOW);assert.equal(r.outcomes[0].status,'released');assert.equal((await f.snapshot()).available,'10');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_mint_settlements').get().n,1);}finally{f.close();}});
test('Audit L8: shared Mint service refuses a chain reset before any chain or ledger identity changes',async()=>{
 const {createGoldLocalRuntime}=await import('../scripts/world-gold-local-runtime.mjs');const r=await createGoldLocalRuntime();try{const ledger=r.mint.gold,run=r.mint.runId,contract=r.mint.contractAddress;
 await assert.rejects(r.mint.admin({action:'reset'}),/MINT_SHARED_RESET_FORBIDDEN/);assert.equal(r.mint.gold,ledger);assert.equal(r.mint.runId,run);assert.equal(r.mint.contractAddress,contract);
 }finally{await r.close();}
});
test('Audit L9a: successful service payment returns with a durable queued job',async()=>{const f=await fixture();try{await f.topup();const id=await f.quote('research');await f.pay(id);assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id)?.state,'queued');}finally{f.close();}});
test('Audit L9b: chain RPC failure does not prevent already-entitled service refunds',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service();f.db.raw.prepare("UPDATE world_gold_jobs SET state='failed',failure='provider-confirmed' WHERE order_id=?").run(id);
 const waits=[],worker=createWorker({},undefined,()=>NOW,undefined,undefined,{config:async()=>f.config,rpc:()=>async()=>{throw Error('fixture_rpc_outage');}});
 await worker.scheduled({cron:'* * * * *'},{DB:f.db,ECONOMY_CHAIN_LIMITER:{limit:async()=>({success:true})}},{waitUntil:p=>waits.push(p)});await Promise.all(waits);assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}});
test('Audit I10: quote predicates do not accumulate scratch rows; administrator evidence remains durable',async()=>{const f=await fixture();try{
 const before=f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_write_checks').get().n;for(let i=0;i<20;i++)await f.quote();assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_write_checks').get().n,before);
 const a=f.db.raw.prepare('SELECT before_json,after_json FROM world_gold_admin_actions LIMIT 1').get();assert.ok(a.before_json&&a.after_json);
 }finally{f.close();}});
test('Audit I11: missing runtime delivery capability refuses service quote and pending service payment',async()=>{const f=await fixture();try{
 await f.topup();await assert.rejects(gold.goldQuote({db:f.db,config:f.config,nowMs:NOW},{wallet:W,requestId:rid(),product:'research'}),/SERVICE_DELIVERY_UNAVAILABLE/);
 const id=await f.quote('research'),signed=await f.challenge(id);delete signed.serviceReady;await assert.rejects(payEconomyOrderGold(f.db,f.config,signed),/SERVICE_DELIVERY_UNAVAILABLE/);assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}});
