import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W,B,H,rid,mintProof,account} from './world-gold-audit5-fixture.mjs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy,createEconomyOrder,createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import * as gold from '../server/world-gold.ts';

test('Audit6 M1: a capacity-bound staker preserves owed rewards without starving another wallet',async()=>{
 const f=await fixture();try{
  // Exact lawful historical journal boundary; the adversarial suite also reaches it through real topup orders.
  f.db.raw.prepare("INSERT INTO economy_gold_journal VALUES(?,?,9223372036854775807,'utc-reward',?,?)").run('historical-capacity',B,'historical-capacity',NOW);
  const events=[B,W].map((wallet,i)=>({kind:'stake',transactionHash:H(3000+i),logIndex:i,blockNumber:'100',blockHash:H(100),timestamp:NOW,wallet,amount:String(SHARE),positionId:String(i+1),shares:'1'}));
  await ingestEconomyEvents(f.db,f.config,{fromBlock:'100',toBlock:'101',toBlockHash:H(101),throughTimestamp:NOW+2*DAY,events});
  await settleEconomy(f.db,f.config,{nowMs:NOW+2*DAY});
  assert.equal((await f.snapshot(W)).book,'2');assert.equal((await f.snapshot(B)).book,'9223372036854775807');
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_days').get().n,2);
  const owed=f.db.raw.prepare("SELECT CAST(SUM(delta) AS TEXT) total FROM economy_gold_reward_entitlements WHERE wallet=? AND settled_ms IS NULL").get(B);assert.equal(owed.total,'2');
  await settleEconomy(f.db,f.config,{nowMs:NOW+30*DAY});assert.equal((await f.snapshot(W)).book,'2');
 }finally{f.close();}
});

test('Audit6 L2: legacy GOLD catalogue orders cannot debit outside shared jobs',async()=>{
 const f=await fixture();try{await f.topup();
  const c=await defineEconomyConfig({...f.config,catalogue:[{id:'legacy-research',titleZh:'研究',titleEn:'Research',gold:'3'}]});
  await f.admin({action:'control',feature:'service',enabled:false,version:0});
  await assert.rejects(async()=>{
   const o=await createEconomyOrder(f.db,c,{wallet:W,requestId:rid(),serviceId:'legacy-research',currency:'GOLD',nowMs:NOW});
   const req=rid(),ch=await createEconomyGoldChallenge(f.db,c,{wallet:W,orderId:o.id,requestId:req,origin:'https://imdember.com',nowMs:NOW,serviceReady:false});
   await payEconomyOrderGold(f.db,c,{wallet:W,orderId:o.id,requestId:req,origin:'https://imdember.com',nowMs:NOW,serviceReady:false,signature:await account.signMessage({message:ch.message})});
  },/LEGACY_GOLD_ORDER_UNSUPPORTED|FEATURE_PAUSED|SERVICE_DELIVERY_UNAVAILABLE/);
  assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_jobs').get().n,0);
 }finally{f.close();}
});

test('Audit6 L3: pre-0015 reconciliation returns coded schema refusal',async()=>{
 const db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<15));try{
  await assert.rejects(gold.reconcileWorldGold(db,NOW),/SCHEMA_INCOMPLETE/);
 }finally{db.raw.close();}
});

test('Audit6 L3: pre-0015 schema cannot create a new quote',async()=>{
 const f=await fixture(),db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<15));try{
  db.raw.prepare("INSERT INTO world_gold_products(id,product,version,kind,title,gold,embeo,enabled,created_ms) VALUES('pack:1','pack',1,'topup','Fixture',10,'7',1,?)").run(NOW);
  await assert.rejects(gold.goldQuote({db,config:f.config,nowMs:NOW},{wallet:W,requestId:rid(),product:'pack'}),/SCHEMA_INCOMPLETE/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_orders').get().n,0);
 }finally{f.close();db.raw.close();}
});

test('Audit6 L6: null provider result is unusable and refunds exactly once',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);
  await gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+1,outcome:{result:null}});
  assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'refunded');
  assert.equal((await f.snapshot()).book,'10');await gold.refundGold(f.db,id,NOW+2);assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}
});

test('Audit6 L7: private chain cannot persist a finalized public-chain mode',async()=>{
 const f=await fixture();try{await f.topup();const m={...f.mint(),chainId:31337};await gold.reserveMintGold(f.db,m,NOW,()=>NOW);
  await assert.rejects(gold.settleMintGold(f.db,{id:m.id,chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,state:'released',evidence:mintProof(m,'released',{mode:'finalized-chain'})},NOW+1),/MINT_EVIDENCE_REQUIRED/);
  assert.equal((await f.snapshot()).reserved,'8');
  assert.throws(()=>f.db.raw.prepare("UPDATE world_gold_mints SET state='released',evidence_json=? WHERE id=?").run(JSON.stringify(mintProof(m,'released',{mode:'finalized-chain'})),m.id),/MINT_EVIDENCE_REQUIRED/);
 }finally{f.close();}
});

test('Audit6 L8: unserializable auth rejects with a stable code and no hold',async()=>{
 const f=await fixture();try{await f.topup();for(const auth of [undefined,()=>1,Symbol('x'),1n]){
  await assert.rejects(gold.reserveMintGold(f.db,{...f.mint(),auth},NOW,()=>NOW),/^Error: INVALID_MINT_AUTH$/);
 }
 const cycle={};cycle.self=cycle;await assert.rejects(gold.reserveMintGold(f.db,{...f.mint(),auth:cycle},NOW,()=>NOW),/^Error: INVALID_MINT_AUTH$/);
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_mints').get().n,0);assert.equal((await f.snapshot()).reserved,'0');
 }finally{f.close();}
});

test('Audit6 L5: authorization at exact chain deadline is refused before gas or a duplicate hold',async()=>{
 const {createLocalService}=await import('../../mint/service/chain.mjs');const {initialLook}=await import('../../mint/shared-workbench/appearance.mjs');
 const mint=await createLocalService();try{
  await mint.transaction({wallet:'B',action:'approve',submissionId:rid()});
  const first=(await mint.approval({wallet:'B',look:initialLook(),route:'paid'})).packet;
  await mint.admin({action:'advance',seconds:first.goldAuthorization.deadline-await mint.time()});
  assert.equal(await mint.time(),first.goldAuthorization.deadline);
  const before=(await mint.gold.view('B')).reserved;
  await assert.rejects(mint.approval({wallet:'B',look:initialLook(),route:'paid'}),/PAID_AUTH_NOT_MINEABLE/);
  assert.equal((await mint.gold.view('B')).reserved,before);
 }finally{await mint.close();}
});

test('Audit6 I9: GOLD mint pause blocks paid holds but preserves fee-free free approval',async()=>{
 const {createGoldLocalRuntime}=await import('../scripts/world-gold-local-runtime.mjs');const {initialLook}=await import('../../mint/shared-workbench/appearance.mjs');
 const r=await createGoldLocalRuntime();try{
  await gold.goldAdminCommand(r.db,{wallet:(await import('../server/economy-config.ts')).ECONOMY_TREASURY,requestId:rid(),command:{action:'control',feature:'mint',enabled:false,version:0},reason:'Audit route-specific pause regression',nowMs:Date.now()});
  assert.equal((await r.mint.approval({wallet:'A',look:initialLook(),route:'free'})).packet.route,'free');
  await assert.rejects(r.mint.approval({wallet:'B',look:initialLook(),route:'paid'}),/FEATURE_PAUSED/);
 }finally{await r.close();}
});
