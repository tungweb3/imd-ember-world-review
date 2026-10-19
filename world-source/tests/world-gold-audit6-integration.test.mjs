import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {backup} from 'node:sqlite';
import {fixture,NOW,W,B,H,rid,OWNER,mintProof} from './world-gold-audit5-fixture.mjs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import * as gold from '../server/world-gold.ts';
import {defineEconomyConfig,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy} from '../server/economy-ledger.ts';
import {prepareEconomyRecovery,applyEconomyRecovery} from '../server/economy-recovery.ts';
import {reconcileRewardEntitlements} from '../server/economy-rewards.ts';
import {createWorker} from '../worker/app.ts';
import {initialLook} from '../../mint/shared-workbench/appearance.mjs';
const MAX=9223372036854775807n;
const stake=(wallet,id,block,time)=>({kind:'stake',transactionHash:H(20000+id),logIndex:id-1,blockNumber:String(block),blockHash:H(block),timestamp:time,wallet,positionId:String(id),shares:'1',amount:String(SHARE)});

test('Audit original M1 reproduction: 1025 lawful current-price orders reach capacity without starving staking',async()=>{
 const f=await fixture();try{
  await f.admin({action:'product',product:'maxp',kind:'topup',title:'Maximum technical fixture',gold:'9007199254740991',embeo:'1',enabled:true,version:1});
  await f.admin({action:'product',product:'tail',kind:'topup',title:'Fixture tail',gold:'1023',embeo:'1',enabled:true,version:1});
  for(let i=0;i<1024;i++){const id=await f.quote('maxp');await f.paid(id);if(i%128===127)assert.deepEqual((await gold.reconcileWorldGold(f.db,NOW)).failures,[]);}
  await f.paid(await f.quote('tail'));await gold.reconcileWorldGold(f.db,NOW);assert.equal((await f.snapshot()).book,String(MAX));
  await ingestEconomyEvents(f.db,f.config,{fromBlock:'1125',toBlock:'1126',toBlockHash:H(1126),throughTimestamp:NOW+3*DAY,events:[stake(W,1,1125,NOW+DAY),stake(B,2,1125,NOW+DAY)]});
  await settleEconomy(f.db,f.config,{nowMs:NOW+3*DAY});assert.equal((await f.snapshot(B)).book,'2');assert.equal((await f.snapshot()).pendingRewards.length,2);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_days').get().n,2);
 }finally{f.close();}
});

test('T02/T22: recovery and SQLite backup preserve owed share-days without compensating them twice',async()=>{
 const f=await fixture(),old=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<15)),shadow=openD1();
 const dir=mkdtempSync(join(tmpdir(),'ember-gold-audit6-'));let restored;
 try{
  const c=f.config,next=await defineEconomyConfig({...c,deploymentBlock:'99'}),id=H(90000),at=NOW-3*DAY;
  // Historical 0014 legitimately allowed a larger per-product amount. Prepare
  // that old immutable quote, then use the normal event indexer and forward SQL.
  old.raw.prepare("INSERT INTO world_gold_products VALUES('old-max:1','old-max',1,'topup','Historical fixture',?,'7',1,?)").run(String(MAX),at);
  old.raw.prepare("INSERT INTO economy_orders(id,config_id,wallet,request_id,service_id,currency,amount,request_payload,created_ms,expires_ms) VALUES(?,?,?,?,?,'EMBEO','7',?,?,?)").run(id,c.id,W,rid(),'old-max',JSON.stringify([c.id,'old-max','EMBEO']),at,at+900000);
  old.raw.prepare("INSERT INTO world_gold_links VALUES(?,'old-max:1','topup',?)").run(id,String(MAX));
  const payment={kind:'payment',transactionHash:H(10000),logIndex:0,blockNumber:'100',blockHash:H(100),timestamp:at,wallet:W,amount:'7',orderId:id,token:c.token,receiver:c.treasury};
  const events=[payment,stake(W,1,101,NOW-2*DAY),stake(B,2,101,NOW-2*DAY)];
  await ingestEconomyEvents(old,c,{fromBlock:'100',toBlock:'102',toBlockHash:H(102),throughTimestamp:NOW,events});
  for(const name of migrationFiles().filter(n=>Number(n.slice(0,4))>=15))old.raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  await gold.reconcileWorldGold(old,NOW);await settleEconomy(old,c,{nowMs:NOW});assert.equal((await gold.worldGoldSnapshot(old,W,NOW)).pendingRewards.length,2);
  assert.throws(()=>old.raw.prepare('INSERT INTO economy_recoveries(id,staking_key,from_config,to_config,horizon_ms,applied_ms,report_json,accepted) VALUES(?,?,?,?,?,?,?,1)').run('a'.repeat(64),`${c.chainId}:${c.token}:${c.stakingContract}`,c.id,next.id,NOW,NOW+1,'{}'),/RECOVERY_REWARD_SCHEMA_REQUIRED/);
  await ingestEconomyEvents(shadow,next,{fromBlock:'99',toBlock:'102',toBlockHash:H(102),throughTimestamp:NOW,events});await settleEconomy(shadow,next,{nowMs:NOW});
  const plan=await prepareEconomyRecovery(old,shadow,c,next,{nowMs:NOW+1});assert.equal(plan.report.totalDelta,'0');assert.equal(plan.report.pendingRewardsAccounted,true);
  await backup(old.raw,join(dir,'owed.sqlite'));restored=openD1([],join(dir,'owed.sqlite'));
  const restoredPlan=await prepareEconomyRecovery(restored,shadow,c,next,{nowMs:NOW+1});assert.equal(restoredPlan.hash,plan.hash);
  await applyEconomyRecovery(restored,shadow,c,next,{nowMs:NOW+1,expectedPlanHash:plan.hash});assert.equal((await gold.worldGoldSnapshot(restored,W,NOW)).pendingRewards.length,2);
  // A real authenticated GOLD service spend supplies room for the original
  // deferred rows. The old namespace stays in their immutable references.
  await gold.goldAdminCommand(restored,{wallet:OWNER,requestId:rid(),command:{action:'product',product:'research',kind:'service',title:'Fixture research',gold:'3',enabled:true,version:1},reason:'isolated historical recovery exercise',nowMs:NOW+2,serviceReady:true});
  const service=await gold.goldQuote({db:restored,config:next,nowMs:NOW+3,serviceReady:true},{wallet:W,requestId:rid(),product:'research'});
  const {createEconomyGoldChallenge,payEconomyOrderGold}=await import('../server/economy-ledger.ts'),{account}=await import('./world-gold-audit5-fixture.mjs'),requestId=rid();
  const ch=await createEconomyGoldChallenge(restored,next,{wallet:W,orderId:service,requestId,origin:'https://imdember.com',nowMs:NOW+4,serviceReady:true});
  await payEconomyOrderGold(restored,next,{wallet:W,orderId:service,requestId,origin:ch.origin,signature:await account.signMessage({message:ch.message}),nowMs:NOW+5,serviceReady:true});
  await reconcileRewardEntitlements(restored,NOW+6);await reconcileRewardEntitlements(restored,NOW+7);
  assert.equal((await gold.worldGoldSnapshot(restored,W,NOW)).book,String(MAX-1n));assert.equal((await gold.worldGoldSnapshot(restored,B,NOW)).book,'2');assert.equal((await gold.worldGoldSnapshot(restored,W,NOW)).pendingRewards.length,0);
  assert.equal((await applyEconomyRecovery(restored,shadow,c,next,{nowMs:NOW+1,expectedPlanHash:plan.hash})).replayed,true);
  assert.equal((await gold.worldGoldSnapshot(old,W,NOW)).book,String(MAX));assert.equal((await gold.worldGoldSnapshot(old,W,NOW)).pendingRewards.length,2);
 }finally{restored?.raw.close();f.close();old.raw.close();shadow.raw.close();const base=realpathSync(tmpdir())+sep,target=realpathSync(dir);assert.ok(target.toLowerCase().startsWith(base.toLowerCase())&&target.includes('ember-gold-audit6-'));rmSync(dir,{recursive:true,force:true});}
});

test('T10/T11: private latest time does not authorize release when the required proof is still pending',async()=>{
 const {createLocalService}=await import('../../mint/service/chain.mjs'),m=await createLocalService();try{
  const packet=(await m.approval({wallet:'B',look:initialLook(),route:'paid'})).packet,id=packet.goldAuthorization.orderId;
  const release=m.gold.release.bind(m.gold);m.gold.release=()=>{throw Error('MINT_AUTH_EXECUTABLE');};
  await m.admin({action:'advance',seconds:301});await assert.rejects(m.approval({wallet:'B',look:initialLook(),route:'paid'}),/PAID_AUTH_NOT_MINEABLE/);
  assert.equal(m.orders.get(id).status,'reserved');assert.equal(m.orders.size,1);
  m.gold.release=release;const fresh=(await m.approval({wallet:'B',look:initialLook(),route:'paid'})).packet;
  assert.notEqual(fresh.goldAuthorization.orderId,id);assert.equal(m.orders.get(id).status,'released');
 }finally{await m.close();}
});

test('T17: private paid pause preserves a free onchain Mint and settlement of an existing paid hold',async()=>{
 const {createGoldLocalRuntime}=await import('../scripts/world-gold-local-runtime.mjs'),r=await createGoldLocalRuntime();try{
  const A=r.mint.addresses[1].toLowerCase(),quote=await gold.goldQuote({db:r.db,config:r.config,nowMs:Date.now()},{wallet:A,requestId:rid(),product:'gold-pack'});await r.pay(quote,A);
  const paid=(await r.mint.approval({wallet:'A',look:initialLook(),route:'paid'})).packet;
  await gold.goldAdminCommand(r.db,{wallet:OWNER,requestId:rid(),command:{action:'control',feature:'mint',enabled:false,version:0},reason:'isolated paid-only pause',nowMs:Date.now()});
  const tokenBefore=await r.mint.token.balanceOf(r.mint.addresses[2]),free=(await r.mint.approval({wallet:'B',look:{...initialLook(),hat:'beanie'},route:'free'})).packet;
  await r.mint.transaction({wallet:'B',action:'mintFree',packet:free,submissionId:rid()});assert.equal(await r.mint.token.balanceOf(r.mint.addresses[2]),tokenBefore);
  assert.equal((await gold.worldGoldSnapshot(r.db,r.mint.addresses[2],Date.now())).book,'0');assert.equal((await gold.worldGoldSnapshot(r.db,A,Date.now())).reserved,'1');
  await r.mint.transaction({wallet:'A',action:'approve',submissionId:rid()});await r.mint.transaction({wallet:'A',action:'mintPaid',packet:paid,submissionId:rid()});assert.equal((await gold.worldGoldSnapshot(r.db,A,Date.now())).book,'9');
  await assert.rejects(r.mint.approval({wallet:'A',look:{...initialLook(),hat:'captain'},route:'paid'}),/FEATURE_PAUSED/);
 }finally{await r.close();}
});

test('T06: deployed World entry never falls back to standalone catalogue finance on a pre-0014 DB',async()=>{
 const f=await fixture(),db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<14));try{
  const config=await defineEconomyConfig({...f.config,catalogue:[{id:'legacy',gold:'1',titleZh:'測試',titleEn:'Fixture'}]}),worker=createWorker({},undefined,()=>NOW,[],undefined,{config:async()=>config});
  const r=await worker.fetch(new Request('https://imdember.com/api/economy/orders',{method:'POST',headers:{origin:'https://imdember.com','content-type':'application/json'},body:JSON.stringify({expectedAddress:W,requestId:rid(),serviceId:'legacy',currency:'GOLD'})}),{DB:db},{waitUntil(){}});
  assert.equal(r.status,503);assert.equal((await r.json()).error,'SCHEMA_INCOMPLETE');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_orders').get().n,0);
 }finally{f.close();db.raw.close();}
});

test('T10: private authorization just before deadline remains reusable and executes at the contract boundary',async()=>{
 const {createLocalService}=await import('../../mint/service/chain.mjs'),m=await createLocalService();try{
  await m.transaction({wallet:'B',action:'approve',submissionId:rid()});const first=(await m.approval({wallet:'B',look:initialLook(),route:'paid'})).packet;
  await m.admin({action:'advance',seconds:299});const second=(await m.approval({wallet:'B',look:initialLook(),route:'paid'})).packet;assert.equal(second.packetId,first.packetId);
  await m.transaction({wallet:'B',action:'mintPaid',packet:second,submissionId:rid()});assert.equal(m.orders.get(second.goldAuthorization.orderId).status,'consumed');
 }finally{await m.close();}
});
