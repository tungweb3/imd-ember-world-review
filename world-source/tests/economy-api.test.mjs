import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {API_HEADERS} from '../server/world-api.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {createEconomyOrder} from '../server/economy-ledger.ts';
const NOW=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),OTHER='0x'+'b'.repeat(40),WORLD='https://imdember.com',TOKEN='s'.repeat(43);
const raw={chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'local-fixture',titleZh:'本機測試',titleEn:'Local fixture',gold:'3',embeo:'1000000000000000000'}]};
let sequence=0;
async function fixture({method='ECDSA',walletType='EOA',expires=NOW+60000,revoked=null,address=W,db=openD1()}={}){
 const tokenHash=await sha256(TOKEN),config=await defineEconomyConfig(raw),clock={at:NOW};
 db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,revoked_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?,?)').run(tokenHash,address,1,NOW-1,expires,revoked,'economy-'+(++sequence),walletType,method);
 return {db,tokenHash,config,clock,deps:{db,config,now:()=>clock.at,allow:async()=>true,client:'synthetic'},close(){db.raw.close();}};
}
function request(path,{method='GET',body,headers={},base=WORLD,cookie=TOKEN,origin=base}={}){
 return new Request(base+path,{method,headers:{...cookie?{cookie:SESSION_COOKIE+'='+cookie}:{},...origin?{origin}:{},...body!==undefined?{'content-type':'application/json'}:{},...headers},...body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{}});
}
const me='/api/me/economy?expected_address='+W;
const orderBody={expectedAddress:W,requestId:'fixture-request-0001',serviceId:'local-fixture',currency:'GOLD'};
async function checked(response,status){response=await response;assert.equal(response.status,status,await response.clone().text());for(const [k,v] of Object.entries(API_HEADERS))assert.equal(response.headers.get(k),v);assert.deepEqual(response.headers.getSetCookie(),[]);for(const [k] of response.headers)assert.ok(!k.startsWith('access-control-'));return response;}
const count=(f,t)=>Number(f.db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);

test('public configuration defaults disabled without DB, authority, catalogue or state changes',async()=>{
 const response=await checked(handleEconomyApi(request('/api/economy/config',{cookie:null}),{}),200),value=await response.json();assert.equal(value.enabled,false);assert.deepEqual(value.catalogue,[]);assert.equal(value.shareTokens,'100000');
 assert.equal(await handleEconomyApi(request('/api/auth/session'),{}),null);
 await checked(handleEconomyApi(request('/api/economy/config?owner=true'),{}),400);
 await checked(handleEconomyApi(request('/api/economy/claim',{method:'POST',body:{earned:'1000'}}),{}),404);
});
test('read snapshot is wallet bound, no initial demo credit, strings throughout and no cookies or private credentials returned',async()=>{
 const f=await fixture(),response=await checked(handleEconomyApi(request(me),f.deps),200),text=await response.text(),value=JSON.parse(text);
 assert.equal(value.gold,'0');assert.equal(value.address,W);assert.deepEqual(value.positions,[]);assert.deepEqual(value.orders,[]);assert.deepEqual(value.journal,[]);assert.equal(value.chain.block,'99');
 for(const secret of [TOKEN,f.tokenHash,'ALCHEMY_API_KEY'])assert.equal(text.includes(secret),false);
 assert.equal(count(f,'economy_gold_accounts'),0);assert.equal(count(f,'economy_chain_events'),0);f.close();
});
test('write uses server catalogue and creates a pending order only; no browser amount, earned GOLD or fake transaction can authorize money',async()=>{
 const f=await fixture();
 for(const patch of [{amount:'0'},{earned:'999999'},{transactionHash:'0x'+'1'.repeat(64)},{wallet:OTHER},{owner:true}])await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:{...orderBody,...patch}}),f.deps),400);
 assert.equal(count(f,'economy_orders'),0);
 const response=await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody}),f.deps),200),value=await response.json();assert.equal(value.order.amount,'3');assert.equal(value.order.status,'pending');assert.equal(value.payment,undefined);
 assert.equal(count(f,'economy_gold_accounts'),0);assert.equal(count(f,'economy_fulfillments'),0);
 const embeo=await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:{...orderBody,currency:'EMBEO',requestId:'fixture-request-0002'}}),f.deps),200),e=await embeo.json();
 assert.deepEqual(e.payment,{chainId:1,contract:f.config.paymentContract,token:f.config.token,receiver:f.config.treasury,orderId:e.order.id,amount:'1000000000000000000'});f.close();
});
test('all missing, forged, revoked, expired and unknown proof sessions deny reads and writes without DB mutation',async()=>{
 for(const patch of [{revoked:NOW-1},{expires:NOW},{method:null},{method:'LEGACY'}]){
  const f=await fixture(patch);for(const req of [request(me),request('/api/economy/orders',{method:'POST',body:orderBody})])await checked(handleEconomyApi(req,f.deps),401);assert.equal(count(f,'economy_orders'),0);f.close();
 }
 const f=await fixture();for(const cookie of [null,'bad','f'.repeat(43)])await checked(handleEconomyApi(request(me,{cookie}),f.deps),401);
 await checked(handleEconomyApi(request(me,{cookie:null,headers:{authorization:'Bearer '+TOKEN,'x-wallet-address':W}}),f.deps),401);f.close();
});
test('ERC1271/contract sessions retain read access and cannot gain new persistent order/debit authority',async()=>{
 for(const patch of [{method:'ERC1271',walletType:'CONTRACT'},{method:'ECDSA',walletType:'CONTRACT'},{method:'ECDSA',walletType:null}]){
  const f=await fixture(patch);await checked(handleEconomyApi(request(me),f.deps),200);await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody}),f.deps),403);assert.equal(count(f,'economy_orders'),0);f.close();
 }
});
test('expected wallet cannot be swapped by query/body/header, and selectors reject duplicates or privilege fields',async()=>{
 const f=await fixture();
 await checked(handleEconomyApi(request('/api/me/economy?expected_address='+OTHER),f.deps),409);
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:{...orderBody,expectedAddress:OTHER}}),f.deps),409);
 for(const query of ['', '?expected_address=bad','?expected_address='+W+'&expected_address='+W,'?expected_address='+W+'&owner=true'])await checked(handleEconomyApi(request('/api/me/economy'+query),f.deps),400);
 await checked(handleEconomyApi(request(me,{headers:{'x-wallet-address':OTHER,'x-owner':'true'}}),f.deps),200);assert.equal(count(f,'economy_orders'),0);f.close();
});
test('strict origin, fetch site, verb and query policy protects both public configuration and money routes',async()=>{
 const f=await fixture();
 for(const path of ['/api/economy/config',me]){
  for(const origin of ['https://evil.test','https://research.imdember.com','null','http://localhost:8791'])await checked(handleEconomyApi(request(path,{origin}),f.deps),403);
  for(const base of ['https://evil.test','http://imdember.com','https://localhost:8791'])await checked(handleEconomyApi(request(path,{base}),f.deps),403);
  for(const site of ['cross-site','same-site'])await checked(handleEconomyApi(request(path,{headers:{'sec-fetch-site':site}}),f.deps),403);
  for(const method of ['POST','DELETE','HEAD','OPTIONS'])await checked(handleEconomyApi(request(path,{method}),f.deps),405);
 }
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody,origin:null}),f.deps),403);
 await checked(handleEconomyApi(request('/api/economy/orders?owner=1',{method:'POST',body:orderBody}),f.deps),400);
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'GET'}),f.deps),405);
 for(const base of ['http://localhost:8791','http://127.0.0.1:8791','http://[::1]:8791'])await checked(handleEconomyApi(request(me,{base}),f.deps),200);f.close();
});
test('missing config, missing migration, limiter failure and invalid clock fail closed without writes',async()=>{
 const f=await fixture();
 for(const patch of [{config:null},{db:undefined},{allow:undefined},{allow:async()=>{throw Error('broken limiter');}},{now:()=>NaN},{now:()=>-1},{now:()=>1.5}])await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody}),{...f.deps,...patch}),503);
 await checked(handleEconomyApi(request(me),{...f.deps,allow:async()=>false}),429);assert.equal(count(f,'economy_orders'),0);f.close();
 const old=await fixture({db:openD1(migrationFiles().filter(x=>x!=='0010_world_economy.sql'))});await checked(handleEconomyApi(request(me),old.deps),503);old.close();
});
test('body is bounded, valid UTF-8 JSON with a closed schema; arbitrary currencies/IDs cannot become services',async()=>{
 const f=await fixture();
 for(const body of ['{','null','[]','"string"',JSON.stringify({...orderBody,padding:'x'.repeat(3000)}),{...orderBody,requestId:'a'},{...orderBody,currency:'usd'},{...orderBody,currency:{value:'GOLD'}},{...orderBody,serviceId:'../admin'}])await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body}),f.deps),400);
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody,headers:{'content-type':'text/plain'}}),f.deps),400);
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody,headers:{'content-length':'999999'}}),f.deps),400);
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:{...orderBody,serviceId:'invented'}}),f.deps),409);assert.equal(count(f,'economy_orders'),0);f.close();
});
test('expiry or revocation while rate limit/body is awaited cannot create an order or debit GOLD',async()=>{
 const f=await fixture({expires:NOW+10});
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody}),{...f.deps,allow:async()=>{f.clock.at+=10;return true;}}),401);assert.equal(count(f,'economy_orders'),0);f.close();
 const g=await fixture();
 const stream=new ReadableStream({start(c){g.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(NOW,g.tokenHash);c.enqueue(new TextEncoder().encode(JSON.stringify(orderBody)));c.close();}});
 const r=new Request(WORLD+'/api/economy/orders',{method:'POST',headers:{origin:WORLD,cookie:SESSION_COOKIE+'='+TOKEN,'content-type':'application/json'},body:stream,duplex:'half'});
 await checked(handleEconomyApi(r,g.deps),401);assert.equal(count(g,'economy_orders'),0);g.close();
});
test('non-string JSON currencies are client errors and never become service orders',async()=>{
 const f=await fixture();
 try{
  for(const currency of [null,false,true,0,1,{},[],['GOLD'],['EMBEO'],{toString:null},{toString:'GOLD'},{valueOf:null,toString:null}]){
   const response=await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:{...orderBody,currency}}),f.deps),400);
   assert.deepEqual(await response.json(),{error:'BAD_REQUEST'});
  }
  for(const table of ['economy_orders','economy_gold_journal','economy_fulfillments'])assert.equal(count(f,table),0);
 }finally{f.close();}
});
test('session revocation immediately before SQL insert is guarded in the same statement',async()=>{
 const f=await fixture();
 const wrapper={...f.db,prepare(sql){const statement=f.db.prepare(sql);if(sql.includes('INSERT INTO economy_orders'))return {...statement,bind(...args){f.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(NOW,f.tokenHash);return statement.bind(...args);}};return statement;}};
 await checked(handleEconomyApi(request('/api/economy/orders',{method:'POST',body:orderBody}),{...f.deps,db:wrapper}),401);assert.equal(count(f,'economy_orders'),0);f.close();
});
test('GOLD route never accepts another wallet order, EMBEO order or fabricated earned balance',async()=>{
 const f=await fixture(),order=await createEconomyOrder(f.db,f.config,{wallet:OTHER,requestId:'fixture-request-0001',serviceId:'local-fixture',currency:'GOLD',nowMs:NOW});
 const post={method:'POST',body:{expectedAddress:W,requestId:'payment-request-0001',signature:'0x'+'00'.repeat(65)}};
 await checked(handleEconomyApi(request('/api/economy/orders/'+order.id+'/gold',post),f.deps),404);
 const own=await createEconomyOrder(f.db,f.config,{wallet:W,requestId:'fixture-request-0001',serviceId:'local-fixture',currency:'GOLD',nowMs:NOW});
 await checked(handleEconomyApi(request('/api/economy/orders/'+own.id+'/gold',{...post,body:{...post.body,balance:'999999'}}),f.deps),400);
 await checked(handleEconomyApi(request('/api/economy/orders/'+own.id+'/gold',post),f.deps),400);assert.equal(count(f,'economy_gold_journal'),0);assert.equal(count(f,'economy_fulfillments'),0);f.close();
});
test('complete authenticated GOLD challenge/sign/pay flow consumes exactly one nonce and rejects a login signature',async()=>{
 const account=privateKeyToAccount(generatePrivateKey()),address=account.address.toLowerCase(),f=await fixture({address,expires:NOW+1000000}),requestId='payment-request-0001';
 const send=(path,body)=>handleEconomyApi(request(path,{method:'POST',body}),f.deps);
 const created=await checked(send('/api/economy/orders',{...orderBody,expectedAddress:address}),200),{order}=await created.json(),path='/api/economy/orders/'+order.id+'/gold';
 f.db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run(address,9);
 const c=await checked(send(path+'/challenge',{expectedAddress:address,requestId}),200),{challenge}=await c.json();
 assert.equal(challenge.wallet,address);assert.equal(challenge.amount,'3');assert.equal(challenge.expiresMs-challenge.issuedMs,300000);assert.match(challenge.nonce,/^0x[0-9a-f]{64}$/);assert.ok(challenge.message.includes('does not authorize EMBEO'));
 assert.deepEqual((await (await checked(send(path+'/challenge',{expectedAddress:address,requestId}),200)).json()).challenge,challenge);
 await checked(send(path,{expectedAddress:address,requestId}),400);
 await checked(send(path,{expectedAddress:address,requestId,signature:await account.signMessage({message:'imdember.com wants you to sign in with your Ethereum account.'})}),403);
 assert.equal(count(f,'economy_gold_journal'),0);assert.equal(f.db.raw.prepare('SELECT consumed_ms at FROM economy_gold_challenges').get().at,null);
 const signature=await account.signMessage({message:challenge.message}),payload={expectedAddress:address,requestId,signature};
 assert.equal((await (await checked(send(path,payload),200)).json()).order.status,'paid');
 await checked(send(path,payload),200);assert.equal(count(f,'economy_gold_journal'),1);assert.equal(count(f,'economy_fulfillments'),1);
 assert.equal(f.db.raw.prepare('SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?').get(address).balance,'6');
 assert.equal(f.db.raw.prepare('SELECT consumed_ms at FROM economy_gold_challenges').get().at,NOW);
 f.clock.at=NOW+300000;await checked(send(path,payload),409);assert.equal(count(f,'economy_gold_journal'),1);f.close();
});
