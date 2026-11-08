import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,W,B,NOW,H} from './world-gold-audit5-fixture.mjs';
import {SESSION_COOKIE,sha256} from '../server/auth.ts';
import {goldQuote,reconcileWorldGold} from '../server/world-gold.ts';
import {parseCelestaoCheckout} from '../src/world/celestaoCheckoutClient.ts';
import {pruneCelestaoAuth} from '../server/celestao-auth.ts';
import {handleCelestaoCheckout} from '../server/celestao-checkout.ts';
import {createCelestaoDelivery} from '../server/celestao-delivery.ts';
import {CELESTAO_PREPARE_PATH as PATH,CELESTAO_DELIVERY_PATH as DELIVERY,CELESTAO_DELIVERY_SCHEMA as SCHEMA,celestaoSignature,verifyCelestaoSignature} from '../server/celestao-protocol.ts';
import {encodeGoldResult} from '../server/world-gold-result.ts';
import {combineGoldProviders,runGoldServiceJobs} from '../server/world-gold-delivery.ts';
const ORIGIN='https://imdember.com',SECRET='dedicated-celestao-fixture-secret-0123456789',TOKEN='t'.repeat(43),BRIDGE='g'.repeat(43),RUN='r'.repeat(43),INPUT='1'.repeat(64);
async function setup(t){const f=await fixture();t.after(f.close);
 await f.admin({action:'product',product:'fortune-bazi',kind:'service',title:'四柱八字',gold:'1000',enabled:true,version:1});
 await f.admin({action:'product',product:'pack',kind:'topup',title:'Fixture funding',gold:'10000',embeo:'7',enabled:true,version:2});await f.topup();
 const hash=await sha256(TOKEN);
 f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(hash,W,NOW-1,NOW+3600000,'celestao-fixture','EOA','ECDSA');
 f.db.raw.prepare('INSERT INTO celestao_bridge_sessions(bridge_hash,source_session_hash,address,created_at,expires_at) VALUES(?,?,?,?,?)').run(await sha256(BRIDGE),hash,W,NOW-1,NOW+3600000);
 return {...f,deps:{db:f.db,secret:SECRET,enabled:true,ready:true,config:f.config,now:()=>NOW,allow:async()=>true}};
}
const value=(patch={})=>({bridgeSession:BRIDGE,runId:RUN,system:'bazi',inputHash:INPUT,...patch});
async function prepare(f,patch={},options={}){const body=JSON.stringify(value(patch)),signature=await celestaoSignature(SECRET,'request',PATH,String(NOW/1000),body);
 return handleCelestaoCheckout(new Request(ORIGIN+PATH,{method:'POST',headers:{'content-type':'application/json','x-celestao-signature':signature,...options.headers},body}),{...f.deps,...options.deps});}
function browser(f,route='state',{wallet=W,patch={},method=route==='state'?'GET':'POST',cookie=TOKEN}={}){
 const b={runId:RUN,expectedAddress:wallet,...patch};return handleCelestaoCheckout(new Request(ORIGIN+'/api/celestao-checkout/'+route+(method==='GET'?'?'+new URLSearchParams(b):''),{method,headers:{origin:ORIGIN,cookie:SESSION_COOKIE+'='+cookie,'content-type':'application/json'},...method==='GET'?{}:{body:JSON.stringify(b)}}),f.deps);
}
test('server-only preparation is signed, grant-bound and idempotent without birth data or payment authority',async t=>{const f=await setup(t);
 assert.equal((await prepare(f,{}, {headers:{origin:'https://celestao.com'}})).status,403);
 assert.equal((await prepare(f,{}, {headers:{'x-celestao-signature':'invalid'}})).status,401);
 assert.equal((await prepare(f,{bridgeSession:'x'.repeat(43)})).status,401);
 assert.equal((await prepare(f,{amount:'1'})).status,400);
 const response=await prepare(f),raw=await response.text();assert.equal(response.status,200);
 assert.equal(await verifyCelestaoSignature(SECRET,'response',PATH,response.headers.get('x-celestao-signature'),raw,NOW),true);
 assert.deepEqual(JSON.parse(raw),{schema:SCHEMA,runId:RUN,wallet:W,product:'fortune-bazi',inputHash:INPUT,expiresMs:NOW+900000,lapsed:false});
 assert.equal((await prepare(f)).status,200);assert.equal((await prepare(f,{inputHash:'2'.repeat(64)})).status,409);
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM celestao_checkouts').get().n,1);
 assert.equal(f.db.raw.prepare("SELECT count(*) n FROM economy_orders WHERE service_id='fortune-bazi'").get().n,0);
 f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);
 assert.equal((await prepare(f)).status,401);
});
test('one consented run atomically binds one authoritative quote; generic quote cannot bypass it',async t=>{const f=await setup(t);await prepare(f);
 await assert.rejects(()=>f.quote('fortune-bazi'),/FORTUNE_CHECKOUT_REQUIRED/);
 assert.equal((await browser(f,'quote',{patch:{amount:'1'}})).status,400);
 assert.equal((await browser(f,'quote',{wallet:B})).status,409);
 const r=await browser(f,'quote'),id=(await r.json()).orderId;assert.equal(r.status,200);
 assert.equal((await (await browser(f,'quote')).json()).orderId,id);
 const state=await (await browser(f)).json();assert.equal(state.order.id,id);assert.equal(state.order.amount,'1000');assert.equal(state.order.currency,'GOLD');
 assert.equal(f.db.raw.prepare('SELECT order_id FROM celestao_checkouts').get().order_id,id);
 await f.pay(id);assert.equal((await f.snapshot()).available,'9000');
 assert.equal((await (await browser(f,'quote')).json()).orderId,id);
 assert.equal(f.db.raw.prepare("SELECT count(*) n FROM economy_orders WHERE service_id='fortune-bazi'").get().n,1);
 assert.equal((await f.snapshot()).available,'9000');
});
test('logout during quote transaction creates neither a charge nor an unbound order',async t=>{const f=await setup(t);await prepare(f);const batch=f.db.batch;
 f.db.batch=async list=>{f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);return batch(list);};
 assert.equal((await browser(f,'quote')).status,401);
 assert.equal(f.db.raw.prepare("SELECT count(*) n FROM economy_orders WHERE service_id='fortune-bazi'").get().n,0);
 assert.equal(f.db.raw.prepare('SELECT order_id FROM celestao_checkouts').get().order_id,null);
 assert.equal((await f.snapshot()).available,'10000');
});
test('pausing admissions preserves authenticated original-order reads without allowing another quote',async t=>{const f=await setup(t);await prepare(f);await browser(f,'quote');f.deps.enabled=false;
 const state=await browser(f);assert.equal(state.status,200);assert.equal((await state.json()).ready,false);
 assert.equal((await browser(f,'quote')).status,503);assert.equal((await prepare(f)).status,503);
});
test('delivery only sends a paid bound order and accepts a signed matching private receipt',async t=>{const f=await setup(t);await prepare(f);const id=(await (await browser(f,'quote')).json()).orderId;
 let calls=0,mode='ok';const receipt={schema:'celestao-receipt/v1',provider:'celestao-v1',system:'bazi',recordId:'d'.repeat(43),documentHash:'a'.repeat(64),createdMs:NOW};
 const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://celestao.com'+DELIVERY);assert.equal(init.redirect,'manual');assert.equal(init.headers.origin,undefined);
  assert.equal(await verifyCelestaoSignature(SECRET,'request',DELIVERY,init.headers['x-celestao-signature'],init.body,NOW),true);
  const b=JSON.parse(init.body);assert.deepEqual(b,{schema:SCHEMA,orderId:id,wallet:W,product:'fortune-bazi',runId:RUN,inputHash:INPUT});
  const raw=JSON.stringify({...b,kind:'delivered',result:receipt,...mode==='wrong-wallet'?{wallet:B}:{}});
  return new Response(raw,{headers:{'content-type':'application/json','x-celestao-signature':mode==='unsigned'?'invalid':await celestaoSignature(SECRET,'response',DELIVERY,String(NOW/1000),raw)}});
 };
 const provider=createCelestaoDelivery(f.db,SECRET,fetcher,()=>NOW),order={orderId:id,wallet:W,product:'fortune-bazi',idempotencyKey:id};
 await assert.rejects(()=>provider.deliver(order),/DELIVERY_UNAVAILABLE/);assert.equal(calls,0);
 await f.pay(id);assert.deepEqual(await provider.deliver(order),{kind:'delivered',result:receipt});
 for(mode of ['wrong-wallet','unsigned'])await assert.rejects(()=>provider.deliver(order),/DELIVERY_UNAVAILABLE/);
 assert.equal(encodeGoldResult('fortune-bazi',receipt).failure,null);
 for(const bad of [{report:'unverified'}, {...receipt,system:'western'},{...receipt,report:'birth data must stay upstream'}])assert.equal(encodeGoldResult('fortune-bazi',bad).failure,'RESULT_UNUSABLE');
 assert.equal(createCelestaoDelivery(f.db,undefined),undefined);
});
test('dedicated signature cannot be replayed for a different path, direction, body or stale time',async()=>{
 const raw='{}',time=String(NOW/1000),signature=await celestaoSignature(SECRET,'request',PATH,time,raw);
 for(const [direction,path,body,now] of [['response',PATH,raw,NOW],['request',DELIVERY,raw,NOW],['request',PATH,'{"gold":1}',NOW],['request',PATH,raw,NOW+31000]])assert.equal(await verifyCelestaoSignature(SECRET,direction,path,signature,body,now),false);
 const a={id:'a',products:['research'],deliver:async()=>({kind:'pending'})},b={id:'b',products:['fortune-bazi'],deliver:async()=>({kind:'pending'})};
 assert.deepEqual(combineGoldProviders(a,b).products,['research','fortune-bazi']);assert.throws(()=>combineGoldProviders(a,a),/AMBIGUOUS/);
});

test('the browser accepts real SQL delivery and refund states and retains the original paid order and correct balance',async t=>{
 for(const delivered of [true,false]){
  const f=await setup(t);await prepare(f);const id=(await (await browser(f,'quote')).json()).orderId;await f.pay(id);await reconcileWorldGold(f.db,NOW);
  const receipt={schema:'celestao-receipt/v1',provider:'celestao-v1',system:'bazi',recordId:'d'.repeat(43),documentHash:'a'.repeat(64),createdMs:NOW};
  await runGoldServiceJobs(f.db,{id:'celestao-v1',products:['fortune-bazi'],deliver:async()=>delivered?{kind:'delivered',result:receipt}:{kind:'terminal-failure',code:'CHART_NOT_GENERATED',proof:{kind:'provider-confirmed-nondelivery',reference:id}}},()=>NOW);
  await reconcileWorldGold(f.db,NOW);
  const state=parseCelestaoCheckout(await (await browser(f)).json(),RUN,W);
  assert.equal(state.order.id,id);assert.equal(state.order.status,'paid');assert.equal(state.order.delivery,delivered?'delivered':'refunded');
  assert.equal((await f.snapshot()).available,delivered?'9000':'10000');
  assert.equal((await (await browser(f,'quote')).json()).orderId,id);
 }
});

test('the annual reading binds, charges and delivers as its own product under a World-valid id',async t=>{const f=await setup(t);
 await f.admin({action:'product',product:'fortune-annual-ziwei',kind:'service',title:'流年運勢',gold:'1000',enabled:true,version:1});
 const response=await prepare(f,{system:'annual_ziwei'});assert.equal(response.status,200);
 assert.equal(JSON.parse(await response.text()).product,'fortune-annual-ziwei');
 assert.equal(f.db.raw.prepare('SELECT product FROM celestao_checkouts').get().product,'fortune-annual-ziwei');
 await assert.rejects(()=>f.quote('fortune-annual-ziwei'),/FORTUNE_CHECKOUT_REQUIRED/);
 const r=await browser(f,'quote'),id=(await r.json()).orderId;assert.equal(r.status,200);
 const state=await (await browser(f)).json();assert.equal(state.product.system,'annual_ziwei');assert.equal(state.order.amount,'1000');
 await f.pay(id);assert.equal((await f.snapshot()).available,'9000');
 const receipt={schema:'celestao-receipt/v1',provider:'celestao-v1',system:'annual_ziwei',recordId:'r'.repeat(43),documentHash:'a'.repeat(64),createdMs:NOW};
 assert.equal(encodeGoldResult('fortune-annual-ziwei',receipt).failure,null);
 assert.notEqual(encodeGoldResult('fortune-annual-ziwei',{...receipt,system:'ziwei'}).failure,null);
});

test('the annual reading stays closed until its product is published, without charging or binding an order',async t=>{const f=await setup(t);
 assert.equal((await prepare(f,{system:'annual_ziwei'})).status,200);
 assert.notEqual((await browser(f,'quote')).status,200);
 assert.equal(f.db.raw.prepare('SELECT order_id FROM celestao_checkouts').get().order_id,null);
 assert.equal((await f.snapshot()).available,'10000');
 await f.admin({action:'product',product:'fortune-annual-ziwei',kind:'service',title:'流年運勢',gold:'999',enabled:true,version:1});
 assert.notEqual((await browser(f,'quote')).status,200);
 assert.equal((await f.snapshot()).available,'10000');
});

test('the rebuilt checkout table keeps its index and still refuses any other product',async t=>{const f=await setup(t);await prepare(f);
 assert.equal(f.db.raw.prepare('SELECT product FROM celestao_checkouts').get().product,'fortune-bazi');
 for(const product of ['fortune-annual_ziwei','research'])assert.throws(()=>f.db.raw.prepare('INSERT INTO celestao_checkouts(id,wallet,product,input_hash,created_ms,expires_ms) VALUES(?,?,?,?,?,?)').run('z'.repeat(43),W,product,'1'.repeat(64),1,2),/CHECK/);
 assert.ok(f.db.raw.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='celestao_checkouts_expiry'").get());
});

async function prepareAt(f,at){const body=JSON.stringify(value()),signature=await celestaoSignature(SECRET,'request',PATH,String(at/1000),body);
 return handleCelestaoCheckout(new Request(ORIGIN+PATH,{method:'POST',headers:{'content-type':'application/json','x-celestao-signature':signature},body}),{...f.deps,now:()=>at});}
test('a signed prepare spends a budget per bridge session, so one buyer cannot close checkout for the others',async t=>{const f=await setup(t),keys=[];
 const deps={client:'ip:shared-relay',allow:async k=>{keys.push(k);return true;}};
 assert.equal((await prepare(f,{},{deps})).status,200);
 assert.equal(keys.length,1);assert.match(keys[0],/^celestao-checkout:prepare:[0-9a-f]{32}$/);
 keys.length=0;assert.equal((await prepare(f,{},{deps,headers:{'x-celestao-signature':'invalid'}})).status,401);assert.deepEqual(keys,['celestao-checkout:ip:shared-relay']);
 const refuse={...deps,allow:async()=>false};
 assert.equal((await prepare(f,{},{deps:refuse,headers:{'x-celestao-signature':'invalid'}})).status,429);
 assert.equal((await prepare(f,{},{deps:refuse})).status,429);
 keys.length=0;
 const malformed=await handleCelestaoCheckout(new Request(ORIGIN+PATH,{method:'POST',headers:{'content-type':'application/json'},body:'[]'}),{...f.deps,...deps});
 assert.equal(malformed.status,400);assert.deepEqual(keys,['celestao-checkout:ip:shared-relay']);
 keys.length=0;assert.equal((await prepare(f,{},{deps,headers:{origin:'https://celestao.com'}})).status,403);assert.deepEqual(keys,['celestao-checkout:ip:shared-relay']);
});
test('an expired checkout kept for its open tab cannot be quoted',async t=>{const f=await setup(t);await prepare(f);
 f.deps.now=()=>NOW+900000;
 const response=await browser(f,'quote');assert.equal(response.status,409);assert.equal((await response.json()).error,'FORTUNE_CHECKOUT_REQUIRED');
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_links').get().n,1);
});
test('prepare says lapsed only for a quote that ran out unpaid, which the ledger can no longer take payment for',async t=>{
 const answer=async(f,at)=>JSON.parse(await (await prepareAt(f,at)).text()).lapsed,exp=NOW+900000;
 const open=await setup(t);assert.equal(await answer(open,NOW+1000),false);assert.equal(await answer(open,exp+1000),false);
 const f=await setup(t);await prepare(f);const id=(await (await browser(f,'quote')).json()).orderId;
 assert.equal(f.db.raw.prepare('SELECT expires_ms FROM economy_orders WHERE id=?').get(id).expires_ms,exp);
 assert.equal(await answer(f,exp-1000),false);assert.equal(await answer(f,exp),false);assert.equal(await answer(f,exp+299000),false);assert.equal(await answer(f,exp+300000),true);assert.equal(await answer(f,exp+301000),true);
 const paid=await setup(t);await prepare(paid);const order=(await (await browser(paid,'quote')).json()).orderId;await paid.pay(order);assert.equal(await answer(paid,exp+1000000),false);
});
test('a repeated prepare after the window reopens an unbound checkout and leaves a bound one alone',async t=>{const f=await setup(t),later=NOW+1000000;
 await prepare(f);const row=()=>f.db.raw.prepare('SELECT expires_ms,order_id FROM celestao_checkouts').get();
 assert.equal(row().expires_ms,NOW+900000);
 assert.equal(JSON.parse(await (await prepareAt(f,NOW+1000)).text()).expiresMs,NOW+900000);assert.equal(row().expires_ms,NOW+900000);
 const again=await prepareAt(f,later);assert.equal(again.status,200);assert.equal(JSON.parse(await again.text()).expiresMs,later+900000);assert.equal(row().expires_ms,later+900000);
 const g=await setup(t);await prepare(g);const id=(await (await browser(g,'quote')).json()).orderId;
 const bound=await prepareAt(g,later);assert.equal(bound.status,200);assert.equal(JSON.parse(await bound.text()).expiresMs,NOW+900000);
 const kept=g.db.raw.prepare('SELECT expires_ms,order_id FROM celestao_checkouts').get();assert.equal(kept.expires_ms,NOW+900000);assert.equal(kept.order_id,id);
});
test('housekeeping removes only expired checkouts that no order is bound to',async t=>{const f=await setup(t);await prepare(f);
 assert.equal((await pruneCelestaoAuth(f.db,NOW+900000+86400000-1)).checkouts,0);
 assert.equal((await pruneCelestaoAuth(f.db,NOW+900000+86400000)).checkouts,1);
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM celestao_checkouts').get().n,0);
 const g=await setup(t);await prepare(g);const id=(await (await browser(g,'quote')).json()).orderId;
 assert.equal((await pruneCelestaoAuth(g.db,NOW+99000000)).checkouts,0);
 assert.equal(g.db.raw.prepare('SELECT order_id FROM celestao_checkouts').get().order_id,id);
});

test('a session that lapses between the two reads is a sign-in problem, not a conflict',async t=>{const f=await setup(t);
 f.db.raw.prepare('UPDATE celestao_bridge_sessions SET expires_at=?').run(NOW+1);
 // Find the read that starts the lapse from the outside: whichever call it is, the buyer is never told about a conflict.
 const seen=[];
 for(const k of [1,2,3,4,5,6,7,8]){f.db.raw.prepare('DELETE FROM celestao_checkouts').run();let calls=0;const r=await prepare(f,{},{deps:{now:()=>++calls<=k?NOW:NOW+1}});seen.push(r.status);const body=await r.text();assert.doesNotMatch(body,/IDEMPOTENCY_CONFLICT/,'lapse after call '+k);}
 assert.ok(seen.includes(401));
 // A real conflict stays one.
 const fresh=await setup(t);assert.equal((await prepare(fresh)).status,200);assert.equal((await prepare(fresh,{inputHash:'2'.repeat(64)})).status,409);
});
