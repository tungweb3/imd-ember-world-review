import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,W,B,NOW} from './world-gold-audit5-fixture.mjs';
import {SESSION_COOKIE,sha256} from '../server/auth.ts';
import {reconcileWorldGold} from '../server/world-gold.ts';
import {payEconomyOrderGold} from '../server/economy-ledger.ts';
import {runGoldServiceJobs} from '../server/world-gold-delivery.ts';
import {createSqueekDelivery,handleSqueek,pruneSqueekAuth,squeekPkce,squeekSubject,squeekEntitlements} from '../server/squeek-store.ts';
import {SQUEEK_ITEMS,SQUEEK_PRODUCTS,squeekRequestId} from '../src/shared/squeekCatalog.ts';
import {squeekResume,squeekCheckoutParams,squeekReturnUrl} from '../src/world/squeekEntry.ts';
import {parseSqueekCheckout,squeekEconomyOrder} from '../src/world/squeekCheckoutClient.ts';

// Maps to the game's acceptance list (鼠道修仙-GOLD商店原企劃與測試.md, adjusted to single items on 2026-11-07).
const ISSUER='https://imdember.com',GAME='https://squeekascension.celestao.com',REDIRECT=GAME+'/';
const TOKEN='t'.repeat(43),TOKEN_B='u'.repeat(43),VERIFIER='v'.repeat(43),STATE='s'.repeat(32);
const FROST=SQUEEK_ITEMS[0],SNOW=SQUEEK_ITEMS.find(i=>i.sku==='sky.first_snow.v1');
const KEY='k'.repeat(30),KEY2='m'.repeat(30);
async function setup(t,{release=true,deps={}}={}){const f=await fixture();t.after(f.close);
 await f.admin({action:'product',product:'pack',kind:'topup',title:'Fixture funding',gold:'1000',embeo:'7',enabled:true,version:2});await f.topup();
 const session=async(token,wallet)=>f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(await sha256(token),wallet,NOW-1,NOW+3600000,'squeek-'+wallet,'EOA','ECDSA');
 await session(TOKEN,W);await session(TOKEN_B,B);
 if(release)f.db.raw.prepare("INSERT INTO squeek_release_actions(id,actor,catalogue,created_ms) VALUES('release-1','authorized-deployment','squeek-world-1',?)").run(NOW);
 const d={db:f.db,config:f.config,enabled:true,ready:true,now:()=>NOW,allow:async()=>true,...deps};
 const call=(path,{method='GET',headers={},body,deps:extra={}}={})=>handleSqueek(new Request(ISSUER+'/api/squeek/'+path,{method,headers:{...body!==undefined?{'content-type':'application/json'}:{},...headers},...body!==undefined?{body:JSON.stringify(body)}:{}}),{...d,...extra});
 const page=(route,value,{cookie=TOKEN,method=route==='state'?'GET':'POST'}={})=>call('checkout/'+route+(method==='GET'?'?'+new URLSearchParams(value):''),{method,headers:{origin:ISSUER,cookie:SESSION_COOKIE+'='+cookie},...method==='GET'?{}:{body:value}});
 const login=async(cookie=TOKEN)=>{
  const q=new URLSearchParams({client_id:'squeek-ascension',redirect_uri:REDIRECT,response_type:'code',code_challenge_method:'S256',code_challenge:await squeekPkce(VERIFIER),state:STATE,lang:'zh'});
  const r=await call('authorize?'+q,{headers:{cookie:SESSION_COOKIE+'='+cookie}});assert.equal(r.status,303);
  const to=new URL(r.headers.get('location'));assert.equal(to.origin+to.pathname,REDIRECT);assert.equal(to.searchParams.get('world_state'),STATE);
  const tok=await call('token',{method:'POST',headers:{origin:GAME},body:{grant_type:'authorization_code',client_id:'squeek-ascension',redirect_uri:REDIRECT,code:to.searchParams.get('world_code'),code_verifier:VERIFIER}});
  assert.equal(tok.status,200);assert.equal(tok.headers.get('access-control-allow-origin'),GAME);return (await tok.json()).access_token;
 };
 const api=async(grant,path,init={})=>{const r=await call(path,{...init,headers:{origin:GAME,authorization:'Bearer '+grant,...init.headers}});return {status:r.status,body:r.status===204?null:await r.json()};};
 const buy=async(sku=FROST.sku,key=KEY)=>{const r=await page('quote',{sku,requestKey:key,expectedAddress:W});return {status:r.status,body:await r.json()};};
 const deliver=()=>runGoldServiceJobs(f.db,createSqueekDelivery(),()=>NOW);
 const debits=()=>f.db.raw.prepare("SELECT count(*) n FROM economy_gold_journal WHERE kind='service-payment'").get().n;
 return {...f,deps:d,call,page,login,api,buy,deliver,debits};
}

test('login is PKCE-bound, single-use and read-only; it never accepts another redirect or client',async t=>{const f=await setup(t);
 const q=async(patch={})=>new URLSearchParams({client_id:'squeek-ascension',redirect_uri:REDIRECT,response_type:'code',code_challenge_method:'S256',code_challenge:await squeekPkce(VERIFIER),state:STATE,lang:'en',...patch});
 assert.equal((await f.call('authorize?'+await q({redirect_uri:'https://evil.example/'}),{headers:{cookie:SESSION_COOKIE+'='+TOKEN}})).status,400);
 assert.equal((await f.call('authorize?'+await q({client_id:'celestao'}),{headers:{cookie:SESSION_COOKIE+'='+TOKEN}})).status,400);
 assert.equal((await f.call('authorize?'+await q())).status,401);
 const nav=await f.call('authorize?'+await q(),{headers:{'sec-fetch-mode':'navigate',accept:'text/html'}});assert.equal(nav.status,303);
 const resume=new URL(nav.headers.get('location'),ISSUER);assert.equal(resume.pathname,'/squeek-connect/');assert.equal(squeekResume(resume.searchParams.get('next')),resume.searchParams.get('next'));
 const r=await f.call('authorize?'+await q(),{headers:{cookie:SESSION_COOKIE+'='+TOKEN}}),code=new URL(r.headers.get('location')).searchParams.get('world_code');
 const exchange=(patch={})=>f.call('token',{method:'POST',headers:{origin:GAME},body:{grant_type:'authorization_code',client_id:'squeek-ascension',redirect_uri:REDIRECT,code,code_verifier:VERIFIER,...patch}});
 assert.equal((await f.call('token',{method:'POST',headers:{origin:'https://evil.example'},body:{}})).status,403);
 assert.equal((await exchange({code_verifier:'w'.repeat(43)})).status,401);
 const ok=await exchange();assert.equal(ok.status,200);const grant=await ok.json();
 assert.equal(grant.scope,'squeek:read');assert.equal(grant.subject_id,await squeekSubject(W));assert.ok(!JSON.stringify(grant).includes(W.slice(2)));
 assert.equal((await exchange()).status,401,'a code is single-use');
 // The read-only grant cannot reach any payment route.
 const pay=await f.call('checkout/quote',{method:'POST',headers:{origin:ISSUER,authorization:'Bearer '+grant.access_token},body:{sku:FROST.sku,requestKey:KEY,expectedAddress:W}});assert.equal(pay.status,401);
 const pre=await f.call('snapshot',{method:'OPTIONS',headers:{origin:GAME}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-credentials'),null);
});

test('catalogue: 11 cosmetics at 200 GOLD; closed until released and switched on',async t=>{
 const closed=await setup(t,{release:false});
 let c=await (await closed.call('catalog',{headers:{origin:GAME}})).json();
 assert.equal(c.items.length,11);assert.ok(c.items.every(i=>i.amountGold==='200'));assert.equal(c.salesEnabled,false);
 assert.equal((await closed.buy()).body.error,'SALES_CLOSED');
 const off=await setup(t,{deps:{enabled:false}});c=await (await off.call('catalog')).json();assert.equal(c.salesEnabled,false);assert.equal((await off.buy()).body.error,'SALES_CLOSED');
 const open=await setup(t);c=await (await open.call('catalog')).json();assert.equal(c.salesEnabled,true);
 assert.deepEqual(open.db.raw.prepare("SELECT product,gold FROM world_gold_products WHERE product LIKE 'squeek-%' ORDER BY product").all().map(r=>r.product),[...SQUEEK_PRODUCTS].sort());
 assert.throws(()=>open.db.raw.prepare("INSERT INTO squeek_release_actions(id,actor,catalogue,created_ms) VALUES('release-2','authorized-deployment','squeek-world-1',?)").run(NOW),/SQUEEK_RELEASE_BASELINE_CHANGED/);
});

test('PAY-01, PAY-06: one purchase takes 200 once; receipt, balance and cosmetic agree, and the order can be looked up',async t=>{const f=await setup(t);const grant=await f.login();
 const before=(await f.api(grant,'snapshot')).body;assert.equal(before.balanceGold,'1000');assert.deepEqual(before.entitlements,[]);
 const q=await f.buy();assert.equal(q.status,200);assert.equal(q.body.order.status,'pending');assert.equal(q.body.order.amountGold,'200');
 assert.equal((await f.api(grant,'order?requestKey='+KEY)).body.order.status,'pending');
 await f.pay(q.body.order.orderId);await f.deliver();
 const after=(await f.api(grant,'snapshot')).body;assert.equal(after.balanceGold,'800');assert.deepEqual(after.entitlements,[FROST.sku]);assert.ok(after.revision>=before.revision);
 const receipt=(await f.api(grant,'order?requestKey='+KEY)).body.order;assert.equal(receipt.status,'paid');assert.equal(receipt.requestKey,KEY);assert.equal(receipt.sku,FROST.sku);assert.equal(receipt.subjectId,after.subjectId);
 assert.equal(f.debits(),1);assert.equal((await f.api(grant,'orders')).body.orders.length,1);
 assert.equal((await f.api(grant,'order?requestKey='+KEY2)).status,404);
});

test('PAY-02: an owned cosmetic cannot be bought again and takes no GOLD, even through the generic World quote',async t=>{const f=await setup(t);
 const q=await f.buy();await f.pay(q.body.order.orderId);await f.deliver();
 const again=await f.buy(FROST.sku,KEY2);assert.equal(again.status,409);assert.equal(again.body.error,'ALREADY_OWNED');
 const generic=await f.quote(FROST.product);await assert.rejects(()=>f.pay(generic),/ALREADY_OWNED/);
 assert.equal(f.debits(),1);assert.equal((await f.snapshot()).available,'800');
});

test('PAY-04: two tabs buying the same cosmetic are charged once; the other order is refused inside the debit transaction',async t=>{const f=await setup(t);
 const a=(await f.buy(FROST.sku,KEY)).body.order.orderId,b=(await f.buy(FROST.sku,KEY2)).body.order.orderId;assert.notEqual(a,b);
 const second=await f.challenge(b),batch=f.db.batch;
 // Tab A pays between tab B's pre-check and tab B's debit.
 f.db.batch=async list=>{f.db.batch=batch;await f.pay(a);return batch(list);};
 await assert.rejects(()=>payEconomyOrderGold(f.db,f.config,second),/ALREADY_OWNED/);
 assert.equal(f.debits(),1);assert.equal((await f.snapshot()).available,'800');
 assert.equal(f.db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(b).status,'pending');
});

test('PAY-05: retries reuse one order; a replayed signature charges once; a key cannot be reused for another cosmetic',async t=>{const f=await setup(t);
 const ids=new Set();for(let i=0;i<20;i++)ids.add((await f.buy()).body.order.orderId);assert.equal(ids.size,1);const [id]=ids;
 const signed=await f.challenge(id);for(let i=0;i<20;i++)await payEconomyOrderGold(f.db,f.config,signed);
 assert.equal(f.debits(),1);assert.equal((await f.snapshot()).available,'800');
 const other=await f.buy(SNOW.sku,KEY);assert.equal(other.status,409);assert.equal(other.body.error,'IDEMPOTENCY_CONFLICT');
 const otherOrder=(await f.buy(SNOW.sku,KEY2)).body.order.orderId;
 await assert.rejects(()=>payEconomyOrderGold(f.db,f.config,{...signed,orderId:otherOrder}),/GOLD_SIGNATURE_REQUIRED|INVALID_GOLD_SIGNATURE/);
 assert.equal(f.debits(),1);
});

test('PAY-07, PAY-10: a failed delivery refunds once and removes the cosmetic; buying again charges once more',async t=>{const f=await setup(t);const grant=await f.login();
 const id=(await f.buy()).body.order.orderId;await f.pay(id);
 await runGoldServiceJobs(f.db,{id:'squeek-test-failure',products:SQUEEK_PRODUCTS,deliver:async()=>({kind:'terminal-failure',code:'TEST_FAILURE',proof:{kind:'provider-confirmed-nondelivery',reference:'test:squeek:1'}})},()=>NOW);
 await reconcileWorldGold(f.db,NOW);
 const snap=(await f.api(grant,'snapshot')).body;assert.equal(snap.balanceGold,'1000');assert.deepEqual(snap.entitlements,[]);
 assert.ok(['refund_pending','refunded'].includes((await f.api(grant,'order?requestKey='+KEY)).body.order.status));
 assert.equal(f.db.raw.prepare("SELECT count(*) n FROM world_gold_entries WHERE kind='service-refund'").get().n,1);
 await reconcileWorldGold(f.db,NOW);assert.equal(f.db.raw.prepare("SELECT count(*) n FROM world_gold_entries WHERE kind='service-refund'").get().n,1);
 const again=(await f.buy(FROST.sku,KEY2)).body.order.orderId;await f.pay(again);await f.deliver();
 assert.equal((await f.snapshot()).available,'800');assert.deepEqual(await squeekEntitlements(f.db,W),[FROST.sku]);
});

test('PAY-08: the browser cannot set price, quantity or identity',async t=>{const f=await setup(t);
 assert.equal((await f.page('quote',{sku:FROST.sku,requestKey:KEY,expectedAddress:W,amountGold:'1'})).status,400);
 assert.equal((await f.page('quote',{sku:'aura.unknown.v1',requestKey:KEY,expectedAddress:W})).status,400);
 const other=await f.page('quote',{sku:FROST.sku,requestKey:KEY,expectedAddress:B});assert.equal(other.status,409);assert.equal((await other.json()).error,'ACCOUNT_MISMATCH');
 assert.equal((await f.call('checkout/quote',{method:'POST',headers:{origin:GAME,cookie:SESSION_COOKIE+'='+TOKEN},body:{sku:FROST.sku,requestKey:KEY,expectedAddress:W}})).status,403);
 assert.equal(f.db.raw.prepare("SELECT count(*) n FROM economy_orders WHERE service_id LIKE 'squeek-%'").get().n,0);
 const q=await f.buy();assert.equal(q.body.order.amountGold,'200');
});

test('PAY-09: an expired order or a short balance never charges and never goes negative',async t=>{const f=await setup(t);
 const id=(await f.buy()).body.order.orderId;
 await assert.rejects(async()=>payEconomyOrderGold(f.db,f.config,{...await f.challenge(id),nowMs:NOW+900001}),/ORDER_EXPIRED|CHALLENGE_EXPIRED/);
 // Spend the balance down to 100 GOLD, then try a 200 GOLD cosmetic.
 const keys=['a','b','c','d'].map(c=>c.repeat(30));
 for(const [i,item] of SQUEEK_ITEMS.slice(1,5).entries()){const o=(await f.buy(item.sku,keys[i])).body.order.orderId;await f.pay(o);}
 assert.equal((await f.snapshot()).available,'200');
 const fifth=(await f.buy(SQUEEK_ITEMS[5].sku,'e'.repeat(30))).body.order.orderId;await f.pay(fifth);assert.equal((await f.snapshot()).available,'0');
 const short=(await f.buy(SQUEEK_ITEMS[6].sku,'f'.repeat(30))).body.order.orderId;
 await assert.rejects(()=>f.pay(short),/INSUFFICIENT_GOLD/);assert.equal((await f.snapshot()).available,'0');
});

test('DATA-02: a grant shows only its own wallet and ends with the World session',async t=>{const f=await setup(t);
 const a=await f.login(),b=await f.login(TOKEN_B);
 const q=await f.buy();await f.pay(q.body.order.orderId);await f.deliver();
 assert.deepEqual((await f.api(a,'snapshot')).body.entitlements,[FROST.sku]);
 const sb=(await f.api(b,'snapshot')).body;assert.deepEqual(sb.entitlements,[]);assert.notEqual(sb.subjectId,(await f.api(a,'snapshot')).body.subjectId);
 assert.equal((await f.api(b,'order?requestKey='+KEY)).status,404);
 assert.equal((await f.api(a,'logout',{method:'POST'})).status,204);assert.equal((await f.api(a,'snapshot')).status,401);
 f.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE address=?').run(NOW,B);assert.equal((await f.api(b,'snapshot')).status,401);
 assert.deepEqual(await pruneSqueekAuth(f.db,NOW+3600001),{codes:2,tokens:2});
});

test('delivery is in-World and only for 鼠道修仙 cosmetics',async t=>{
 const p=createSqueekDelivery(),id='0x'+'1'.repeat(64);
 assert.equal((await p.deliver({orderId:id,wallet:W,product:FROST.product,idempotencyKey:id})).kind,'delivered');
 await assert.rejects(()=>p.deliver({orderId:id,wallet:W,product:'fortune-bazi',idempotencyKey:id}),/UNSUPPORTED_SERVICE/);
 assert.equal(squeekRequestId(KEY),'sq_'+KEY);
});

test('page helpers accept only bounded links and server data that matches the catalogue',()=>{
 assert.equal(squeekResume('/api/squeek/authorize?client_id=x'),null);assert.equal(squeekResume('https://evil.example/api/squeek/authorize'),null);
 assert.equal(squeekCheckoutParams('?sku='+FROST.sku+'&request='+KEY).valid,true);assert.equal(squeekCheckoutParams('?sku=x&request='+KEY).valid,false);
 assert.equal(squeekReturnUrl(KEY),REDIRECT+'?world_order='+KEY);assert.equal(squeekReturnUrl('<bad>'),REDIRECT);
 const order={orderId:'0x'+'a'.repeat(64),requestKey:KEY,subjectId:'sq_x',sku:FROST.sku,status:'pending',amountGold:'200',createdAt:NOW,expiresAt:NOW+900000,paidAt:null};
 const good={wallet:W,item:{sku:FROST.sku,amountGold:'200',kind:FROST.kind,nameZh:FROST.nameZh,nameEn:FROST.nameEn},owned:false,balanceGold:'1000',order,ready:true};
 assert.equal(parseSqueekCheckout(good,FROST.sku,KEY,W).item.product,FROST.product);
 assert.throws(()=>parseSqueekCheckout({...good,item:{...good.item,amountGold:'1'}},FROST.sku,KEY,W),/INVALID_RESPONSE/);
 assert.throws(()=>parseSqueekCheckout({...good,order:{...order,amountGold:'1'}},FROST.sku,KEY,W),/INVALID_RESPONSE/);
 assert.equal(squeekEconomyOrder(order,FROST).serviceId,FROST.product);
});
