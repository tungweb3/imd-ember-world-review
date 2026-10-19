import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,START} from './wallet-harness.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {API_HEADERS} from '../server/world-api.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS,AIMARKET_ACTIVITY_ADMIN_ROLE,handleAIMarketAdmin} from '../server/aimarket-admin.ts';
import {AIMARKET_PORTAL_CALLBACK,aimarketPkce} from '../server/aimarket-auth.ts';
import {handleAIMarketProxy,RESEARCH_ORIGIN} from '../server/aimarket-proxy.ts';

// Real Worker + SQLite + production migrations. The three owner addresses use
// synthetic database sessions: these tests neither possess nor exercise their
// real private keys or a real user's signature. A separate ordinary wallet does
// exercise the actual challenge/signature/verify flow below. No external calls.
const OWNERS=[
 '0x30e3e579e7eae086e6d53999f95fac5933e4d0aa',
 '0x18d85dbddf15b38dce122afffb3356424dfee653',
 '0x1c651928150daddda9c2c040a9d4901d862f8ec4'
];
const ROLE='aimarket:trial:manage',WORLD='https://imdember.com';
const ROUTE='/api/me/aimarket-admin',DAY=86_400_000;
let sessionSequence=0;
const path=(address=OWNERS[0])=>ROUTE+'?'+new URLSearchParams({expected_address:address});
function hardened(response){
 for(const [name,value] of Object.entries(API_HEADERS))assert.equal(response.headers.get(name),value,name);
 assert.deepEqual(response.headers.getSetCookie(),[],'role reads never create, clear or renew cookies');
 for(const [name] of response.headers)assert.ok(!name.startsWith('access-control-'),name);
}
async function checked(promise,status){const response=await promise;assert.equal(response.status,status);hardened(response);return response;}
const changes=w=>Number(w.db.raw.prepare('SELECT total_changes() n').get().n);
async function fixture({address=OWNERS[0],expiresAt=START+DAY,revokedAt=null,method='ECDSA',walletType='EOA',env={}}={}){
 const w=setup({env}),token=(++sessionSequence).toString(36).padStart(43,'S'),tokenHash=await sha256(token);
 w.db.raw.prepare(`INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,revoked_at,nonce,wallet_type,verification_method)
   VALUES(?,?,1,?,?,?,?,?,?)`).run(tokenHash,address,START,expiresAt,revokedAt,'synthetic-owner-'+sessionSequence,walletType,method);
 const b=w.browser();b.jar.set(SESSION_COOKIE,token);return {w,b,token,tokenHash,address,expiresAt};
}
function directRequest(f,{url=WORLD+path(f.address),method='GET',headers={}}={}){
 return new Request(url,{method,headers:{cookie:SESSION_COOKIE+'='+f.token,...headers}});
}
const directDeps=(f,patch={})=>({db:f.w.db,now:f.w.clock.now,allow:async()=>true,client:'ip:synthetic',...patch});

test('only the three explicitly authorized wallets are frozen into the narrow activity-management role',()=>{
 assert.deepEqual(AIMARKET_ACTIVITY_ADMIN_WALLETS,OWNERS);
 assert.equal(AIMARKET_ACTIVITY_ADMIN_ROLE,ROLE);
 assert.equal(Object.isFrozen(AIMARKET_ACTIVITY_ADMIN_WALLETS),true);
 assert.throws(()=>AIMARKET_ACTIVITY_ADMIN_WALLETS.push('0x'+'f'.repeat(40)),TypeError);
 assert.throws(()=>{AIMARKET_ACTIVITY_ADMIN_WALLETS[0]='0x'+'f'.repeat(40);},TypeError);
});

test('all three live World sessions resolve the role case-insensitively without writes, chain reads or renewed login',async()=>{
 for(const [index,address] of OWNERS.entries()){
  // Legacy mixed-case rows and an uppercase expected address resolve the same
  // identity; ownership is not inferred from a browser-supplied address.
  const stored=index===1?'0x'+address.slice(2).toUpperCase():address;
  const f=await fixture({address:stored}),before=changes(f.w);
  for(const expected of [address,'0x'+address.slice(2).toUpperCase()]){
   const response=await checked(f.b.get(path(expected)),200);
   assert.deepEqual(await response.json(),{address,expiresAt:f.expiresAt,role:ROLE,canManageFreeTrial:true});
  }
  assert.equal(changes(f.w),before,'reading the role must not mutate any database table');
  assert.equal(f.w.chain.state.calls.length,0);assert.equal(f.w.imd.state.calls,0);
  assert.equal(f.b.jar.get(SESSION_COOKIE),f.token);
 }
});

test('a real ordinary SIWE sign-in has no admin role even if browser headers claim an owner or huge holdings',async()=>{
 const w=setup(),a=newAccount(),b=w.browser(),signed=await b.signIn(a);
 assert.equal(signed.verify.status,200);
 const before=changes(w),chainCalls=w.chain.state.calls.length,imdCalls=w.imd.state.calls;
 const response=await checked(b.get(path(a.address),{headers:{'x-wallet-address':OWNERS[0],'x-owner':'true','x-role':ROLE,'x-embeo-balance':'999999999'}}),200);
 assert.deepEqual(await response.json(),{address:a.address.toLowerCase(),expiresAt:START+7*DAY,role:null,canManageFreeTrial:false});
 assert.equal(changes(w),before);assert.equal(w.chain.state.calls.length,chainCalls);assert.equal(w.imd.state.calls,imdCalls);
 assert.equal((await b.get(path(OWNERS[0]))).status,409,'the query cannot replace the signed-in identity');
});

test('missing, malformed and forged World cookies and unrelated research/bearer credentials cannot grant the role',async()=>{
 const f=await fixture(),before=changes(f.w);
 const cookies=[null,'bad','z'.repeat(43)];
 for(const value of cookies){
  const b=f.w.browser();if(value)b.jar.set(SESSION_COOKIE,value);
  await checked(b.get(path()),401);
 }
 for(const headers of [
  {cookie:'__Host-aim_world_holder='+f.token},
  {authorization:'Bearer '+f.token,'x-wallet-address':OWNERS[0]},
  {cookie:'aim_owner='+f.token,'x-role':ROLE}
 ])await checked(f.w.call(new Request(WORLD+path(),{headers})),401);
 assert.equal(changes(f.w),before);
});

test('revocation, expiry at the exact deadline and absent or unknown verification methods deny owner sessions',async()=>{
 for(const patch of [{revokedAt:START-1},{expiresAt:START},{expiresAt:START-1},{method:null},{method:'LEGACY'},{method:'ecdsa'}]){
  const f=await fixture(patch),before=changes(f.w);
  await checked(f.b.get(path()),401);assert.equal(changes(f.w),before);
 }
 const f=await fixture();await checked(f.b.get(path()),200);
 await f.b.post('/api/auth/logout');
 // Replaying the old HttpOnly cookie after genuine logout still fails.
 f.b.jar.set(SESSION_COOKIE,f.token);await checked(f.b.get(path()),401);
});

test('both existing ECDSA and ERC1271 proven sessions can read the scoped role without another chain check',async()=>{
 for(const [walletType,method] of [['EOA','ECDSA'],['CONTRACT','ERC1271']]){
  const f=await fixture({walletType,method}),before=changes(f.w);
  const response=await checked(f.b.get(path()),200);
  assert.equal((await response.json()).canManageFreeTrial,true);
  assert.equal(f.w.chain.state.calls.length,0);assert.equal(changes(f.w),before);
 }
});

test('mismatched expected wallet returns conflict and never discloses another owner identity or token',async()=>{
 const f=await fixture();const response=await checked(f.b.get(path(OWNERS[1])),409),text=await response.text();
 for(const secret of [f.token,f.tokenHash,OWNERS[0],OWNERS[2]])assert.equal(text.includes(secret),false);
 const success=await checked(f.b.get(path()),200),body=await success.text();
 for(const secret of [f.token,f.tokenHash,OWNERS[1],OWNERS[2]])assert.equal(body.includes(secret),false);
});

test('the one required expected-address query is closed against duplicate, omitted, malformed and privilege fields',async()=>{
 const f=await fixture(),before=changes(f.w);
 for(const suffix of ['', '?expected_address=', '?expected_address=0x1234', '?expected_address=not-a-wallet',
  '?expected_address='+OWNERS[0]+'&expected_address='+OWNERS[0],
  '?expected_address='+OWNERS[0]+'&owner=true', '?expected_address='+OWNERS[0]+'&role='+ROLE,
  '?wallet='+OWNERS[0], '?expected_address='+encodeURIComponent(' '+OWNERS[0])]){
  await checked(f.b.get(ROUTE+suffix),400);
 }
 assert.equal(changes(f.w),before);
});

test('only GET is available; no role write or new activity-setting endpoint is exposed',async()=>{
 const f=await fixture(),before=changes(f.w);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','HEAD']){
  const response=await checked(f.w.call(directRequest(f,{method})),405);
  assert.equal(response.headers.get('allow'),'GET');
 }
 assert.equal(await handleAIMarketAdmin(new Request(WORLD+'/api/me/profile'),directDeps(f)),null);
 assert.equal(await handleAIMarketAdmin(new Request(WORLD+ROUTE+'/settings'),directDeps(f)),null);
 assert.equal(changes(f.w),before);
});

test('the World host and exact same origin are required even when an owner cookie is supplied',async()=>{
 const f=await fixture();
 for(const origin of [undefined,WORLD])await checked(f.w.call(directRequest(f,{headers:origin?{origin}:{}})),200);
 for(const origin of ['https://research.imdember.com','https://aimarket.trade','https://evil.example','null','http://localhost:8791']){
  await checked(f.w.call(directRequest(f,{headers:{origin}})),403);
 }
 for(const base of ['https://research.imdember.com','https://aimarket.trade','https://evil.example','http://imdember.com','https://localhost:8791']){
  await checked(handleAIMarketAdmin(directRequest(f,{url:base+path()}),directDeps(f)),403);
 }
 for(const site of ['cross-site','same-site'])await checked(f.w.call(directRequest(f,{headers:{'sec-fetch-site':site}})),403);
 await checked(f.w.call(directRequest(f,{headers:{'sec-fetch-site':'same-origin'}})),200);
});

test('explicit loopback HTTP development uses its own exact origin and cannot authorize another local origin',async()=>{
 const f=await fixture();
 for(const base of ['http://localhost:8791','http://127.0.0.1:8791','http://[::1]:8791']){
  const request=directRequest(f,{url:base+path(),headers:{origin:base}});
  const response=await checked(handleAIMarketAdmin(request,directDeps(f)),200);
  assert.equal((await response.json()).role,ROLE);
  await checked(handleAIMarketAdmin(directRequest(f,{url:base+path(),headers:{origin:'http://localhost:1234'}}),directDeps(f)),403);
 }
});

test('missing database, database errors, absent or broken rate limits and invalid clocks fail closed',async()=>{
 const f=await fixture(),request=()=>directRequest(f),before=changes(f.w);
 await checked(f.w.call(request(),{...f.w.env,DB:undefined}),503);
 await checked(f.w.call(request(),{...f.w.env,AUTH_LIMITER:undefined}),503);
 await checked(f.w.call(request(),{...f.w.env,AUTH_LIMITER:{limit:async()=>{throw Error('synthetic binding failure');}}}),503);
 await checked(handleAIMarketAdmin(request(),directDeps(f,{db:{prepare(){throw Error('synthetic db failure');}}})),503);
 await checked(handleAIMarketAdmin(request(),directDeps(f,{allow:undefined})),503);
 await checked(handleAIMarketAdmin(request(),directDeps(f,{allow:async()=>{throw Error('synthetic limiter failure');}})),503);
 for(const now of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  await checked(handleAIMarketAdmin(request(),directDeps(f,{now:()=>now})),503);
 }
 await checked(handleAIMarketAdmin(request(),directDeps(f,{now:()=>{throw Error('synthetic clock failure');}})),503);
 assert.equal(changes(f.w),before);
});

test('a denied rate limit returns 429; expiry while the limiter is pending is evaluated at the current time',async()=>{
 const f=await fixture({expiresAt:START+10});
 await checked(f.w.call(directRequest(f),{...f.w.env,AUTH_LIMITER:{limit:async()=>({success:false})}}),429);
 const response=await checked(handleAIMarketAdmin(directRequest(f),directDeps(f,{allow:async()=>{f.w.clock.advance(10);return true;}})),401);
 assert.equal((await response.json()).role,undefined);
});

test('recognizing a known owner does not expand the existing research SSO or proxy capabilities',async()=>{
 const secret='synthetic-owner-boundary-secret-20261016-not-production',f=await fixture({env:{AIMARKET_BRIDGE_SECRET:secret}});
 assert.equal((await (await checked(f.b.get(path()),200)).json()).role,ROLE);
 const verifier='v'.repeat(43),state='s'.repeat(43),query=new URLSearchParams({client_id:'aimarket',redirect_uri:AIMARKET_PORTAL_CALLBACK,
  response_type:'code',code_challenge_method:'S256',code_challenge:await aimarketPkce(verifier),state,lang:'zh',expected_address:OWNERS[0]});
 const authorize=await f.b.get('/api/aimarket-auth/authorize?'+query);assert.equal(authorize.status,303);
 const code=new URL(authorize.headers.get('location')).searchParams.get('code');
 const token=await f.w.call(new Request(WORLD+'/api/aimarket-auth/token',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+secret},
  body:JSON.stringify({grant_type:'authorization_code',client_id:'aimarket',redirect_uri:AIMARKET_PORTAL_CALLBACK,code,code_verifier:verifier})}));
 assert.equal(token.status,200);const identity=await token.json();assert.equal(identity.scope,'research:read');
 assert.equal(identity.role,undefined);assert.equal(identity.canManageFreeTrial,undefined);assert.equal(identity.owner,undefined);
 let upstreamCalls=0;const deps={secret,allow:async()=>true,now:f.w.clock.now,fetcher:async()=>{upstreamCalls++;throw Error('owner route must not reach VPS');}};
 const status=await handleAIMarketProxy(new Request(RESEARCH_ORIGIN+'/api/owner/status',{headers:{cookie:SESSION_COOKIE+'='+f.token}}),deps);
 assert.equal(status.status,200);assert.deepEqual(await status.json(),{owner:false,configured:false,expires_at:null});
 for(const route of ['/api/owner/login','/api/payments/config','/api/new-tokens/ingest',path()]){
  assert.equal((await handleAIMarketProxy(new Request(RESEARCH_ORIGIN+route),deps)).status,404);
 }
 assert.equal(upstreamCalls,0);
});
