import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W} from './world-gold-audit5-fixture.mjs';
import {reconcileWorldGold} from '../server/world-gold.ts';
import {runGoldServiceJobs} from '../server/world-gold-delivery.ts';
import {createAIMarketDelivery,deliveryDigest,deliverySignature} from '../server/aimarket-delivery.ts';

test('eligible research delivery is not starved by sixteen older jobs for another provider',async()=>{
 const f=await fixture();try{
  for(let i=0;i<3;i++)await f.topup();
  await f.admin({action:'product',product:'fortune',kind:'service',title:'Former provider',gold:'1',enabled:true,version:1});
  const older=[];
  for(let i=0;i<16;i++){const id=await f.quote('fortune');await f.pay(id);older.push(id);}
  await reconcileWorldGold(f.db,NOW);
  const id=await f.service();
  f.db.raw.prepare('UPDATE world_gold_jobs SET updated_ms=? WHERE order_id=?').run(NOW+1,id);
  const seen=[];
  const provider={id:'research-only',products:['research'],deliver:async o=>{seen.push(o.orderId);return {kind:'delivered',result:{report:'Original research'}};}};
  await runGoldServiceJobs(f.db,provider,()=>NOW+2);
  assert.deepEqual(seen,[id]);
  assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'delivered');
  assert.equal(f.db.raw.prepare("SELECT COUNT(*) n FROM world_gold_jobs WHERE state='queued'").get().n,16);
  assert.equal((await f.snapshot()).book,'11'); // Original debits; no extra charge or refund.
  provider.products=['fortune'];seen.length=0;
  await runGoldServiceJobs(f.db,provider,()=>NOW+3);
  assert.equal(seen.length,16); // Deferred jobs remain intact for their own provider.
  assert.equal((await f.snapshot()).book,'11');
 }finally{f.close();}
});

test('an empty provider product list does not claim unrelated queued jobs',async()=>{
 const f=await fixture();try{
  await f.topup();const id=await f.service();let calls=0;
  await runGoldServiceJobs(f.db,{id:'disabled',products:[],deliver:async()=>{calls++;return {kind:'pending'};}},()=>NOW);
  assert.equal(calls,0);
  assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'queued');
 }finally{f.close();}
});

test('research delivery drains at most sixteen eligible jobs and preserves every original charge',async()=>{
 const f=await fixture();try{
  for(let i=0;i<7;i++)await f.topup();
  for(let i=0;i<21;i++)await f.service();
  const seen=[],provider={id:'research-only',products:['research'],deliver:async o=>{seen.push(o.orderId);return {kind:'delivered',result:{report:'Original report'}};}};
  await runGoldServiceJobs(f.db,provider,()=>NOW);assert.equal(seen.length,16);
  await runGoldServiceJobs(f.db,provider,()=>NOW);assert.equal(seen.length,21);
  await runGoldServiceJobs(f.db,provider,()=>NOW);assert.equal(seen.length,21);
  assert.equal(new Set(seen).size,21);assert.equal((await f.snapshot()).book,'7');
 }finally{f.close();}
});

test('research leases cannot be reclaimed before expiry and are retried with the same order key',async()=>{
 const f=await fixture();try{
  await f.topup();const id=await f.service();const seen=[];
  const provider={id:'research-only',products:['research'],deliver:async o=>{seen.push(o.idempotencyKey);return {kind:'pending'};}};
  await runGoldServiceJobs(f.db,provider,()=>NOW);
  await runGoldServiceJobs(f.db,provider,()=>NOW+59999);assert.deepEqual(seen,[id]);
  await runGoldServiceJobs(f.db,provider,()=>NOW+60000);assert.deepEqual(seen,[id,id]);
  assert.equal((await f.snapshot()).book,'7');
 }finally{f.close();}
});

const secret='local-resilience-fixture-secret-32',path='/api/internal/world-gold/read';
const order={orderId:'0x'+'1'.repeat(64),wallet:W,product:'research'};
async function signed(raw){return new Response(raw,{headers:{'content-type':'application/json','x-ember-gold-signature':await deliverySignature(secret,'response',path,String(Math.floor(NOW/1000)),raw)}});}

test('every supported 900KB report remains readable after JSON escaping the canonical copy',async()=>{
 // Python stores both the report object and its exact canonical JSON string.
 // Escaping that string a second time may exceed 2.1MB even below its 900KB limit.
 const canonical=JSON.stringify({content:'\\'.repeat(400000),report_date:'2026-10-19'})+'\n';
 const reference=await deliveryDigest(canonical),document={...JSON.parse(canonical),report_id:reference};
 assert.ok(Buffer.byteLength(JSON.stringify(document))<900000);
 const raw=JSON.stringify({schema:'ember-world-research-delivery/v1',...order,kind:'delivered',reference,document,canonical});
 assert.ok(Buffer.byteLength(raw)>2100000);
 const provider=createAIMarketDelivery(secret,async()=>signed(raw),()=>NOW);
 assert.deepEqual(await provider.readReport({...order,reference}),document);
});

test('oversized report responses stay bounded and their response stream is cancelled',async()=>{
 let cancelled=false;
 const provider=createAIMarketDelivery(secret,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(2800000));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}),()=>NOW);
 await assert.rejects(provider.readReport({...order,reference:'a'.repeat(64)}),/DELIVERY_UNAVAILABLE/);
 assert.equal(cancelled,true);
});
