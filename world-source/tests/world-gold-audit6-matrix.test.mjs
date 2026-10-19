import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,NOW,W,B,H,rid,OWNER,account,mintProof} from './world-gold-audit5-fixture.mjs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import * as gold from '../server/world-gold.ts';
import {worldGoldSchemaReady,GOLD_SCHEMA_OBJECTS,GOLD_SCHEMA_COLUMNS} from '../server/world-gold-schema.ts';
import {reconcileRewardEntitlements} from '../server/economy-rewards.ts';
import {inspectWorldGoldExceptions} from '../server/world-gold-inspection.ts';
import {ingestEconomyEvents,settleEconomy,createEconomyOrder,payEconomyOrderGold,createEconomyGoldChallenge} from '../server/economy-ledger.ts';
import {ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE,defineEconomyConfig} from '../server/economy-config.ts';
import {prepareEconomyRecovery,applyEconomyRecovery} from '../server/economy-recovery.ts';
import {runGoldServiceJobs} from '../server/world-gold-delivery.ts';
import {createWorker} from '../worker/app.ts';
const MAX=9223372036854775807n;
const count=(db,table)=>Number(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const oldMax=(db,wallet,amount=MAX)=>db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,?,'utc-reward',?,?)").run('historical-cap:'+wallet,wallet,String(amount),'historical-cap:'+wallet,NOW-3*DAY);
async function stakes(f,{wallets=[W,B],at=NOW-2*DAY,horizon=NOW}={}){
 await ingestEconomyEvents(f.db,f.config,{fromBlock:'100',toBlock:'101',toBlockHash:H(101),throughTimestamp:horizon,events:wallets.map((wallet,i)=>({kind:'stake',transactionHash:H(2000+i),logIndex:i,blockNumber:'100',blockHash:H(100),timestamp:at,wallet,positionId:String(i+1),shares:'1',amount:String(SHARE)}))});
}
async function finalizePayment(f,id,at=NOW+100){
 const old=await f.db.prepare('SELECT last_block FROM economy_chain_state WHERE config_id=?').bind(f.config.id).first(),n=Number(old?.last_block??99)+1;
 const order=f.db.raw.prepare('SELECT * FROM economy_orders WHERE id=?').get(id);
 await ingestEconomyEvents(f.db,f.config,{fromBlock:String(n),toBlock:String(n),toBlockHash:H(n),throughTimestamp:at,events:[{kind:'payment',transactionHash:H(10000+n),logIndex:0,blockNumber:String(n),blockHash:H(n),timestamp:at,wallet:order.wallet,amount:order.amount,orderId:id,token:f.config.token,receiver:f.config.treasury}]});
}

test('T01/T02: owed UTC rewards survive capacity, cooldown, duplicate workers, spending and replay',async()=>{
 const f=await fixture();try{oldMax(f.db,W);await stakes(f);await settleEconomy(f.db,f.config,{nowMs:NOW});
  assert.equal((await f.snapshot(B)).book,'2');assert.equal((await f.snapshot()).pendingRewards.length,2);
  const first=await reconcileRewardEntitlements(f.db,NOW);assert.equal(first.length,2);assert.ok(first.every(x=>x.status==='GOLD_BALANCE_CAPACITY'));
  assert.equal((await reconcileRewardEntitlements(f.db,NOW+1)).length,0);
  const id=await f.service();assert.equal((await f.snapshot()).book,String(MAX-3n));
  await Promise.all([reconcileRewardEntitlements(f.db,NOW+300001),reconcileRewardEntitlements(f.db,NOW+300001)]);
  assert.equal((await f.snapshot()).book,String(MAX-1n));assert.equal((await f.snapshot()).pendingRewards.length,0);
  await settleEconomy(f.db,f.config,{nowMs:NOW});await reconcileRewardEntitlements(f.db,NOW+600001);assert.equal((await f.snapshot()).book,String(MAX-1n));
  assert.equal(count(f.db,'economy_gold_reward_entitlements'),4);assert.equal(f.db.raw.prepare("SELECT state FROM world_gold_jobs WHERE order_id=?").get(id).state,'queued');
  assert.throws(()=>f.db.raw.exec('DELETE FROM economy_gold_reward_entitlements'),/IMMUTABLE_REWARD_ENTITLEMENT/);
 }finally{f.close();}
});

test('T03/T21: refilled capacity defers the original-price refund; later room credits it only once',async()=>{
 const f=await fixture();try{oldMax(f.db,W);const service=await f.service();
  await f.admin({action:'product',product:'tail',kind:'topup',title:'Fixture tail',gold:'3',embeo:'1',enabled:true,version:1});
  const topup=await f.quote('tail');await f.paid(topup);await gold.reconcileWorldGold(f.db,NOW);assert.equal((await f.snapshot()).book,String(MAX));
  await f.admin({action:'product',product:'research',kind:'service',title:'New fixture price',gold:'9',enabled:true,version:2});
  const a=await gold.claimGoldJob(f.db,service,NOW);
  await assert.rejects(gold.finishGoldJob(f.db,{orderId:service,attempt:a,nowMs:NOW+1,outcome:{result:null}}),/GOLD_BALANCE_CAPACITY/);
  assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(service).state,'failed');
  const r=await gold.reconcileWorldGold(f.db,NOW+2);assert.ok(r.failures.some(x=>x.code==='GOLD_BALANCE_CAPACITY'));
  await f.admin({action:'product',product:'research',kind:'service',title:'Another price',gold:'3',enabled:true,version:3});
  await f.service();assert.equal((await f.snapshot()).book,String(MAX-3n));
  await gold.reconcileWorldGold(f.db,NOW+3,service);await gold.reconcileWorldGold(f.db,NOW+4,service);
  assert.equal((await f.snapshot()).book,String(MAX));assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(service).state,'refunded');
  assert.equal(f.db.raw.prepare("SELECT CAST(SUM(delta) AS TEXT) n FROM world_gold_entries WHERE order_id=? AND kind='service-refund'").get(service).n,'3');
 }finally{f.close();}
});

test('T01: all positive journal writers have an exact int64 boundary guard',async()=>{
 for(const before of [MAX-1n,MAX]){const f=await fixture();try{oldMax(f.db,W,before);
  const insert=n=>f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,?,'utc-reward',?,?)").run('boundary:'+n,W,String(n),'boundary:'+n,NOW);
  if(before===MAX-1n){insert(1);assert.equal((await f.snapshot()).book,String(MAX));}
  assert.throws(()=>insert(2),/GOLD_BALANCE_CAPACITY/);assert.equal((await f.snapshot()).book,String(before===MAX-1n?MAX:before));
 }finally{f.close();}}
});

test('T01: a target journal storage fault is isolated with durable reward retry metadata',async()=>{
 const f=await fixture();try{oldMax(f.db,W);await stakes(f);await settleEconomy(f.db,f.config,{nowMs:NOW});await f.pay(await f.quote('research'));
  f.db.raw.exec(`CREATE TRIGGER audit6_target_fault BEFORE INSERT ON economy_gold_journal WHEN NEW.wallet='${W}' AND NEW.delta>0 BEGIN SELECT RAISE(ABORT,'SIMULATED_TARGET_IO'); END`);
  const outcomes=await reconcileRewardEntitlements(f.db,NOW);assert.ok(outcomes.every(o=>o.status==='GOLD_REWARD_RETRY'));
  assert.equal((await f.snapshot(B)).book,'2');assert.equal((await f.snapshot()).pendingRewards.length,2);
  f.db.raw.exec('DROP TRIGGER audit6_target_fault');await reconcileRewardEntitlements(f.db,NOW+300001);assert.equal((await f.snapshot()).book,String(MAX-1n));
 }finally{f.close();}
});

test('T06/T07: pre-0014/0015/0016 refuse new shared operations, then migrations reopen the same DB',async()=>{
 const f=await fixture();try{for(const ceiling of [14,15,16]){const db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<ceiling));try{
  assert.equal(await worldGoldSchemaReady(db),false);
  await assert.rejects(gold.goldQuote({db,config:f.config,nowMs:NOW},{wallet:W,requestId:rid(),product:'pack'}),/SCHEMA_INCOMPLETE/);
  await assert.rejects(gold.reserveMintGold(db,f.mint(),NOW,()=>NOW),/SCHEMA_INCOMPLETE/);
  await assert.rejects(gold.reconcileWorldGold(db,NOW),/SCHEMA_INCOMPLETE/);
  for(const name of migrationFiles().filter(n=>Number(n.slice(0,4))>=ceiling))db.raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  assert.equal(await worldGoldSchemaReady(db),true);
  await gold.goldAdminCommand(db,{wallet:OWNER,requestId:rid(),command:{action:'product',product:'pack',kind:'topup',title:'Fixture',gold:'10',embeo:'7',enabled:true,version:1},reason:'isolated migration test',nowMs:NOW});
  assert.match(await gold.goldQuote({db,config:f.config,nowMs:NOW},{wallet:W,requestId:rid(),product:'pack'}),/^0x[0-9a-f]{64}$/);
 }finally{db.raw.close();}}}finally{f.close();}
});

test('T06: readiness checks columns, indexes and every required financial trigger without caching',async()=>{
 const f=await fixture();try{
  for(const obj of GOLD_SCHEMA_OBJECTS.filter(o=>o.type==='trigger'||o.type==='index')){
   const saved=f.db.raw.prepare('SELECT sql FROM sqlite_master WHERE name=?').get(obj.name).sql;
   f.db.raw.exec(`DROP ${obj.type.toUpperCase()} ${obj.name}`);assert.equal(await worldGoldSchemaReady(f.db),false,obj.name);
   f.db.raw.exec(saved);assert.equal(await worldGoldSchemaReady(f.db),true,obj.name);
  }
  // Keep a same-name trigger present so this refusal specifically exercises
  // the required-column inventory rather than merely the object-name guard.
  f.db.raw.exec('DROP TRIGGER world_gold_delivery_evidence_immutable; ALTER TABLE world_gold_jobs DROP COLUMN delivery_evidence_json; CREATE TRIGGER world_gold_delivery_evidence_immutable BEFORE UPDATE ON world_gold_jobs BEGIN SELECT 1; END;');
  assert.equal(await worldGoldSchemaReady(f.db),false);
  await assert.rejects(f.quote(),/SCHEMA_INCOMPLETE/);assert.equal(count(f.db,'economy_orders'),0);
 }finally{f.close();}
});

test('T07: a paid pre-0015 topup is preserved through refusal and credits once after forward migration',async()=>{
 const f=await fixture();try{const id=await f.quote();await f.paid(id);
  // Reproduce the old deployment by copying only the immutable business rows.
  const db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<15));try{
   for(const table of ['economy_chain_state','economy_config_registry','world_gold_products','economy_orders','world_gold_links']){
    const rows=f.db.raw.prepare('SELECT * FROM '+table).all();for(const row of rows){const cols=Object.keys(row),values=cols.map(c=>row[c]);db.raw.prepare(`INSERT INTO ${table}(${cols}) VALUES(${cols.map(()=>'?')})`).run(...values);}
   }
   await assert.rejects(gold.reconcileWorldGold(db,NOW),/SCHEMA_INCOMPLETE/);assert.equal(db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(id).status,'paid');
   for(const name of migrationFiles().filter(n=>Number(n.slice(0,4))>=15))db.raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
   await gold.reconcileWorldGold(db,NOW);await gold.reconcileWorldGold(db,NOW);assert.equal((await gold.worldGoldSnapshot(db,W,NOW)).book,'10');
  }finally{db.raw.close();}
 }finally{f.close();}
});

test('T12/T13: result contracts reject empty/corrupt documents but accept explained zero and no-signal results',async()=>{
 const invalid=[null,'','   ',{},[],undefined,'\ud800',(()=>{const v={};v.self=v;return v;})(),'燼'.repeat(6000)];
 for(const result of invalid){const f=await fixture();try{await f.topup();const id=await f.service(),a=await gold.claimGoldJob(f.db,id,NOW);await gold.finishGoldJob(f.db,{orderId:id,attempt:a,nowMs:NOW+1,outcome:{result}});assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'refunded');}finally{f.close();}}
 for(const result of [{status:'ok',value:0,explanation:'Measured zero'},{status:'ok',value:false,explanation:'No match'},{status:'no-signal',signals:[],explanation:'No criteria matched'},{report:'usable fixture research'}]){
  const f=await fixture();try{await f.topup();const id=await f.service(),a=await gold.claimGoldJob(f.db,id,NOW);await gold.finishGoldJob(f.db,{orderId:id,attempt:a,nowMs:NOW+1,outcome:{result}});assert.equal((await f.snapshot()).book,'7');assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'delivered');}finally{f.close();}
 }
});

test('T14/T19: provider empty output refunds once; unknown timeout retains the original idempotency key',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.service(),seen=[];let now=NOW;
  const p={id:'fixture',deliver:async o=>{seen.push(o.idempotencyKey);if(seen.length===1)throw Error('UNKNOWN_NETWORK_TIMEOUT');return {kind:'delivered',result:null};}};
  await runGoldServiceJobs(f.db,p,()=>now);assert.equal((await f.snapshot()).book,'7');assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'working');
  now+=60001;await runGoldServiceJobs(f.db,p,()=>now);assert.equal((await f.snapshot()).book,'10');await runGoldServiceJobs(f.db,p,()=>now);assert.deepEqual(seen,[id,id]);
 }finally{f.close();}
});

test('T15: removal calibration proves the SQL mode guard independently rejects both namespace directions',async()=>{
 for(const remove of [false,true]){const f=await fixture();try{await f.topup();const m={...f.mint(),chainId:31337};await gold.reserveMintGold(f.db,m,NOW,()=>NOW);if(remove)f.db.raw.exec('DROP TRIGGER world_gold_mint_proof_mode');
  const write=()=>f.db.raw.prepare("UPDATE world_gold_mints SET state='released',evidence_json=? WHERE id=?").run(JSON.stringify(mintProof(m,'released',{mode:'finalized-chain'})),m.id);
  if(remove){write();assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_mints WHERE id=?').get(m.id).state,'released');}
  else {assert.throws(write,/MINT_EVIDENCE_REQUIRED/);assert.equal((await f.snapshot()).reserved,'8');assert.equal(count(f.db,'world_gold_mint_settlements'),0);}
 }finally{f.close();}}
});

test('T16: lossless auth input is byte-bounded, coded and has no financial side effects',async()=>{
 const f=await fixture();try{await f.topup();const symbolKey={[Symbol('x')]:1},sparse=new Array(2),bad=[null,[],{},{wrong:'structure'},{id:H(2),wallet:W},{id:f.mint().id,wallet:B},()=>1,Symbol('x'),{nested:undefined},{nested:Infinity},{nested:1n},symbolKey,sparse,{payload:'燼'.repeat(6000)},{get unsafe(){throw Error('getter');}}];
  for(const auth of bad)await assert.rejects(gold.reserveMintGold(f.db,{...f.mint(),auth},NOW,()=>NOW),/^Error: INVALID_MINT_AUTH$/);
  assert.equal(count(f.db,'world_gold_mints'),0);assert.equal((await f.snapshot()).reserved,'0');
  await gold.reserveMintGold(f.db,f.mint(),NOW,()=>NOW);await gold.reserveMintGold(f.db,f.mint(),NOW,()=>NOW);assert.equal(count(f.db,'world_gold_mints'),1);
 }finally{f.close();}
});

test('T06: a missing required table refuses both inspection and new quotes with a coded diagnostic',async()=>{
 const f=await fixture();try{f.db.raw.exec('DROP TABLE world_gold_products');assert.equal(await worldGoldSchemaReady(f.db),false);
  await assert.rejects(f.quote(),/SCHEMA_INCOMPLETE/);const result=await inspectWorldGoldExceptions(f.db);assert.equal(result.diagnostic,'SCHEMA_INCOMPLETE');assert.equal(result.issues.length,0);assert.equal(count(f.db,'economy_orders'),0);
 }finally{f.close();}
});

test('T12: deep valid JSON cannot crash result validation or strand a paid service',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);let nested=0;for(let i=0;i<2000;i++)nested=[nested];
  await gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+1,outcome:{result:{report:'usable fixture report',nested}}});
  assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'delivered');assert.equal((await f.snapshot()).book,'7');
 }finally{f.close();}
});

test('T06/T12: unbound service result contracts refuse new charges',async()=>{
 const f=await fixture();try{await f.topup();await f.admin({action:'product',product:'unbound-service',kind:'service',title:'Unbound fixture',gold:'3',enabled:true,version:1});
  await assert.rejects(f.quote('unbound-service'),/SERVICE_RESULT_SCHEMA_UNBOUND/);assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}
});

test('T04/T22: old pending signatures cannot bypass the new gate; old paid catalogue rights stay inventoried',async()=>{
 const f=await fixture(),db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<14));try{
  const config=await defineEconomyConfig({...f.config,catalogue:[{id:'legacy',titleZh:'歷史測試',titleEn:'Historical fixture',gold:'3'}]});
  db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,10,'utc-reward',?,?)").run('old-earned',W,'old-earned',NOW-1);
  const create=()=>createEconomyOrder(db,config,{wallet:W,requestId:rid(),serviceId:'legacy',currency:'GOLD',nowMs:NOW});
  const sign=async order=>{const requestId=rid(),c=await createEconomyGoldChallenge(db,config,{wallet:W,orderId:order.id,requestId,origin:'https://imdember.com',nowMs:NOW});return {wallet:W,orderId:order.id,requestId,origin:c.origin,nowMs:NOW,signature:await account.signMessage({message:c.message})};};
  const pending=await create(),oldSigned=await sign(pending),paid=await create();await payEconomyOrderGold(db,config,await sign(paid));
  for(const name of migrationFiles().filter(n=>Number(n.slice(0,4))>=14))db.raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  await assert.rejects(payEconomyOrderGold(db,config,{...oldSigned,serviceReady:true}),/LEGACY_GOLD_ORDER_UNSUPPORTED/);
  await gold.reconcileWorldGold(db,NOW);assert.equal((await gold.worldGoldSnapshot(db,W,NOW)).book,'7');
  assert.equal(db.raw.prepare('SELECT consumed_ms FROM economy_gold_challenges WHERE order_id=?').get(pending.id).consumed_ms,null);
  const list=await inspectWorldGoldExceptions(db);assert.equal(list.issues.find(x=>x.kind==='legacy-paid-without-job').rows[0].id,paid.id);assert.equal(count(db,'world_gold_jobs'),0);
 }finally{db.raw.close();f.close();}
});

test('T14: a lease expiring during result validation cannot finalize through a stale timestamp',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);let clock=NOW,once=false;const prepare=f.db.prepare;
  f.db.prepare=sql=>{const s=prepare(sql);if(!sql.includes('SELECT p.product FROM world_gold_jobs'))return s;return {...s,bind:(...v)=>{const b=s.bind(...v);return {...b,first:async()=>{const result=await b.first();if(!once){clock=NOW+60000;once=true;}return result;}};}};};
  await assert.rejects(gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW,now:()=>clock,outcome:{result:{report:'late'}}}),/STALE_DELIVERY/);
  assert.equal((await f.snapshot()).book,'7');assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'working');
 }finally{f.close();}
});

test('T18: partial schema emits a stable maintenance diagnostic instead of raw SQLite errors',async()=>{
 const db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<15)),logs=[],waits=[],before=console.log;
 try{console.log=(...v)=>logs.push(v.join(' '));const worker=createWorker({},undefined,()=>NOW,[],undefined,{config:async()=>{throw Error('CONFIG_OUTAGE');}});
  await worker.scheduled({cron:'* * * * *'},{DB:db},{waitUntil:p=>waits.push(p)});await Promise.all(waits);
  assert.ok(logs.some(x=>x.includes('SCHEMA_INCOMPLETE')));assert.ok(logs.every(x=>!x.includes('no such table')));
 }finally{console.log=before;db.raw.close();}
});

test('T22: exception inventory is read-only, bounded and distinguishes unpaid refunds and held authority',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.service();f.db.raw.prepare("UPDATE world_gold_jobs SET state='failed',failure='historical-provider-proof' WHERE order_id=?").run(id);
  await gold.reserveMintGold(f.db,{...f.mint(),gold:'1'},NOW,()=>NOW);const before=f.db.raw.prepare('SELECT total_changes() n').get().n;
  const result=await inspectWorldGoldExceptions(f.db,{limit:1});assert.equal(result.readOnly,true);assert.equal(result.schemaReady,true);assert.equal(f.db.raw.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(result.issues.find(x=>x.kind==='failed-refund-pending').rows[0].id,id);assert.equal(result.issues.find(x=>x.kind==='held-requires-original-reader').rows.length,1);assert.equal((await f.snapshot()).reserved,'1');
 }finally{f.close();}
});

test('expanded inspection: signature-time success cannot debit after a shared readiness await crosses expiry',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.quote('research'),signed=await f.challenge(id);let clock=NOW,once=false;const prepare=f.db.prepare;
  f.db.prepare=sql=>{const s=prepare(sql);if(!sql.includes('json_each(?) o'))return s;return {...s,bind:(...v)=>{const b=s.bind(...v);return {...b,first:async()=>{const result=await b.first();if(!once){clock=NOW+300001;once=true;}return result;}};}};};
  await assert.rejects(payEconomyOrderGold(f.db,f.config,{...signed,now:()=>clock}),/CHALLENGE_EXPIRED/);
  assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(id).status,'pending');assert.equal(count(f.db,'world_gold_jobs'),0);
 }finally{f.close();}
});
