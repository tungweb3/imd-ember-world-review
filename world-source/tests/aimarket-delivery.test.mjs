import test from 'node:test';
import assert from 'node:assert/strict';
import {createAIMarketDelivery,deliverySignature,deliveryDigest} from '../server/aimarket-delivery.ts';
import {handleWorldGoldReport} from '../server/world-gold-report.ts';
import {runGoldServiceJobs} from '../server/world-gold-delivery.ts';
import {fixture,NOW,W,B} from './world-gold-audit5-fixture.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
const SECRET='local-cross-service-fixture-secret-32',SCHEMA='ember-world-research-delivery/v1',TOKEN='s'.repeat(43);
const order={orderId:'0x'+'1'.repeat(64),wallet:W,product:'research'};
async function reply(path,order,patch={},invalid=false){const raw=JSON.stringify({schema:SCHEMA,orderId:order.orderId,wallet:order.wallet,product:order.product,kind:'delivered',result:{provider:'aimarket-vps-v1',report:'Published research document',reportId:'a'.repeat(64),reportDate:'2026-10-19',documentHash:'a'.repeat(64)},...patch});return new Response(raw,{headers:{'content-type':'application/json','x-ember-gold-signature':invalid?'invalid':await deliverySignature(SECRET,'response',path,String(Math.floor(NOW/1000)),raw)}});}
test('fixed HTTPS endpoint signs exact order binding and accepts only authenticated structured replies',async()=>{
 let calls=0;const p=createAIMarketDelivery(SECRET,async(url,init)=>{calls++;assert.equal(url,'https://aimarket.trade/api/internal/world-gold/deliver');assert.equal(init.redirect,'error');assert.equal(JSON.stringify(init).includes('Bearer '),false);const body=JSON.parse(init.body);assert.deepEqual(body,order);assert.equal(init.headers['x-ember-gold-signature'],await deliverySignature(SECRET,'request','/api/internal/world-gold/deliver',String(Math.floor(NOW/1000)),init.body));return reply('/api/internal/world-gold/deliver',body);},()=>NOW);
 assert.deepEqual(p.products,['research']);assert.equal((await p.deliver({...order,idempotencyKey:order.orderId})).kind,'delivered');assert.equal(calls,1);
 await assert.rejects(p.deliver({...order,idempotencyKey:'forged'}),/INVALID_IDEMPOTENCY_KEY/);assert.equal(createAIMarketDelivery(undefined),undefined);
});
test('HTTP errors, bad signatures, wallet/order mismatches and backward clocks never produce success or refund',async()=>{
 for(const response of [async()=>new Response('Internal Server Error',{status:500}),async()=>reply('/api/internal/world-gold/deliver',order,{},true),async()=>reply('/api/internal/world-gold/deliver',order,{wallet:B}),async()=>reply('/api/internal/world-gold/deliver',order,{orderId:'0x'+'2'.repeat(64)})]){const p=createAIMarketDelivery(SECRET,response,()=>NOW);await assert.rejects(p.deliver({...order,idempotencyKey:order.orderId}));}
 let now=NOW;const p=createAIMarketDelivery(SECRET,async()=>{const r=await reply('/api/internal/world-gold/deliver',order);now--;return r;},()=>now);await assert.rejects(p.deliver({...order,idempotencyKey:order.orderId}));
});
test('document read verifies its bound frozen hash and never substitutes the latest report',async()=>{
 const canonical='{"report_date":"2026-10-19","value":0}\n',reference=await deliveryDigest(canonical),document={report_date:'2026-10-19',value:0,report_id:reference};
 const p=createAIMarketDelivery(SECRET,async(url,init)=>reply('/api/internal/world-gold/read',JSON.parse(init.body),{reference,document,canonical}),()=>NOW);
 assert.deepEqual(await p.readReport({...order,reference}),document);
 const bad=createAIMarketDelivery(SECRET,async(url,init)=>reply('/api/internal/world-gold/read',JSON.parse(init.body),{reference,document:{...document,value:1},canonical}),()=>NOW);await assert.rejects(bad.readReport({...order,reference}));
});
test('real service-job worker persists verified delivery once and original-order nondelivery refunds once',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service();const p=createAIMarketDelivery(SECRET,async(url,init)=>reply('/api/internal/world-gold/deliver',JSON.parse(init.body)),()=>NOW);
 await runGoldServiceJobs(f.db,p,()=>NOW);assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_jobs WHERE order_id=?').get(id).state,'delivered');await runGoldServiceJobs(f.db,p,()=>NOW);assert.equal((await f.snapshot()).available,'7');
 const failed=await f.service();const fail=createAIMarketDelivery(SECRET,async(url,init)=>{const o=JSON.parse(init.body);return reply('/api/internal/world-gold/deliver',o,{kind:'terminal-failure',code:'REPORT_TOO_LARGE',proof:{kind:'provider-confirmed-nondelivery',reference:o.orderId}});},()=>NOW);
 await runGoldServiceJobs(f.db,fail,()=>NOW);await runGoldServiceJobs(f.db,fail,()=>NOW);assert.equal((await f.snapshot()).available,'7');assert.equal(f.db.raw.prepare("SELECT count(*) n FROM world_gold_entries WHERE order_id=? AND kind='service-refund'").get(failed).n,1);
}finally{f.close();}});
test('full report endpoint authenticates its original payer and revalidates logout after upstream I/O',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service();await runGoldServiceJobs(f.db,createAIMarketDelivery(SECRET,async(url,init)=>reply('/api/internal/world-gold/deliver',JSON.parse(init.body)),()=>NOW),()=>NOW);
 f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(await sha256(TOKEN),W,1,NOW-1,NOW+60000,'report','EOA','ECDSA');let calls=0;
 const deps={db:f.db,now:()=>NOW,allow:async()=>true,provider:{readReport:async o=>{calls++;assert.equal(o.orderId,id);return {report_date:'2026-10-19'};}}};const req=w=>new Request('https://imdember.com/api/gold/orders/'+id+'/report?expected_address='+w,{headers:{cookie:SESSION_COOKIE+'='+TOKEN}});
 assert.equal((await handleWorldGoldReport(req(B),deps)).status,409);assert.equal(calls,0);assert.equal((await handleWorldGoldReport(req(W),deps)).status,200);
 deps.provider.readReport=async()=>{f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);return {private:'original report'};};const r=await handleWorldGoldReport(req(W),deps);assert.equal(r.status,401);assert.equal((await r.json()).document,undefined);
}finally{f.close();}});
