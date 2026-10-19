import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W,rid} from './world-gold-audit5-fixture.mjs';
import {createEconomyOrder} from '../server/economy-ledger.ts';
import * as gold from '../server/world-gold.ts';
import {inspectWorldGoldExceptions} from '../server/world-gold-inspection.ts';
import {openStandaloneEconomyD1,migrationFiles} from './d1-sqlite.mjs';
import {readFileSync} from 'node:fs';

test('Audit7 M1: shared book refuses unlinked catalogue admission in both currencies even with a paused service',async()=>{
 const f=await fixture();try{
  await f.admin({action:'control',feature:'service',enabled:false,version:0});
  const config={...f.config,catalogue:[{id:'legacy-research',titleZh:'研究',titleEn:'Research',gold:'3',embeo:'5'}]};
  for(const currency of ['GOLD','EMBEO'])await assert.rejects(createEconomyOrder(f.db,config,{wallet:W,requestId:rid(),serviceId:'legacy-research',currency,nowMs:NOW}),/LEGACY_.*ORDER_UNSUPPORTED/);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_orders').get().n,0);
  // The linked topup path stays available when only new services are paused.
  await f.topup();assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}
});

test('Audit7 M2: bare upstream error text cannot be a delivered report and refunds the original amount once',async()=>{
 for(const result of ['error','Internal Server Error','{"error":"upstream failed"}','a plausible bare report']){
  const f=await fixture();try{
   await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);
   await gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+1,outcome:{result}});
   const job=f.db.raw.prepare('SELECT state,result_json,failure FROM world_gold_jobs WHERE order_id=?').get(id);
   assert.equal(job.state,'refunded');assert.equal(job.result_json,null);assert.equal(job.failure,'RESULT_UNUSABLE');
   await gold.refundGold(f.db,id,NOW+2);await f.admin({action:'refund-service',orderId:id});
   assert.equal((await f.snapshot()).book,'10');
  }finally{f.close();}
 }
});

test('Audit7 L1: Mint auth expiring during admission I/O creates neither a mint row nor a GOLD hold',async()=>{
 const f=await fixture();try{
  await f.topup();let clock=NOW;
  const slow={...f.db,prepare(sql){const s=f.db.prepare(sql);if(sql==='SELECT enabled FROM world_gold_controls WHERE feature=?')return {...s,bind(...args){const p=s.bind(...args);return {...p,async first(){const r=await p.first();clock=NOW+10;return r;}};}};return s;}};
  const m={...f.mint(),deadline:NOW+10};
  await assert.rejects(gold.reserveMintGold(slow,m,NOW,()=>clock),/INVALID_MINT_AUTH|MINT_AUTH_EXPIRED/);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_mints').get().n,0);
  assert.equal((await f.snapshot()).reserved,'0');assert.equal((await f.snapshot()).available,'10');
 }finally{f.close();}
});

test('Audit7 I1: retry refuses a pending quote at expiry while preserving an already-paid receipt',async()=>{
 const f=await fixture();try{
  const requestId=rid(),args={wallet:W,requestId,product:'pack'},ctx={db:f.db,config:f.config,nowMs:NOW};
  const id=await gold.goldQuote(ctx,args);
  assert.equal(await gold.goldQuote({...ctx,nowMs:NOW+899999},args),id);
  await assert.rejects(gold.goldQuote({...ctx,nowMs:NOW+900000},args),/ORDER_EXPIRED/);
  await assert.rejects(gold.goldQuote({...ctx,now:()=>NOW+900001},args),/ORDER_EXPIRED/);
  await f.paid(id);await gold.reconcileWorldGold(f.db,NOW+900002);
  assert.equal(await gold.goldQuote({...ctx,nowMs:NOW+900003},args),id);
  assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}
});

test('Audit7 M1: upgrading does not reopen an original pending unlinked legacy quote in either currency',async()=>{
 for(const currency of ['GOLD','EMBEO']){const f=await fixture(),db=openStandaloneEconomyD1();try{
  const config={...f.config,catalogue:[{id:'old-service',titleZh:'舊服務',titleEn:'Old service',gold:'3',embeo:'5'}]},args={wallet:W,requestId:rid(),serviceId:'old-service',currency,nowMs:NOW};
  const original=await createEconomyOrder(db,config,args);
  for(const name of migrationFiles().filter(n=>Number(n.slice(0,4))>=14))db.raw.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  await assert.rejects(createEconomyOrder(db,config,args),/LEGACY_.*ORDER_UNSUPPORTED/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_orders').get().n,1);assert.equal(db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(original.id).status,'pending');
 }finally{db.raw.close();f.close();}}
});

test('Audit7 L1: omitted clock uses real time, while a SQL deadline refusal rolls back both mint and hold',async()=>{
 const f=await fixture();try{
  await f.topup();await assert.rejects(gold.reserveMintGold(f.db,f.mint(),NOW),/MINT_AUTH_EXPIRED/);
  // The application sample is valid; force the final SQL sample to equality.
  // Removing the SQL predicate would make this test wrongly commit the hold.
  const db={...f.db,batch:async statements=>f.db.batch(statements.map(s=>s.sql.includes("?< ? AND EXISTS(SELECT 1 FROM world_gold_controls")?s.bind(s.args[0],f.mint().deadline,f.mint().deadline):s))};
  await assert.rejects(gold.reserveMintGold(db,f.mint(),NOW,()=>NOW),/CHECK constraint failed/);
  assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_mints').get().n,0);assert.equal((await f.snapshot()).reserved,'0');
 }finally{f.close();}
});
