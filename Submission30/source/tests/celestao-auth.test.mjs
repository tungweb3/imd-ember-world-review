import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount} from './wallet-harness.mjs';
import {sha256} from '../server/auth.ts';
import {handleAIMarketAuth} from '../server/aimarket-auth.ts';
import {CELESTAO_CALLBACK,CELESTAO_CODE_TTL_MS,celestaoPkce,handleCelestaoAuth} from '../server/celestao-auth.ts';

// Real identity implementation, schema, SQLite transactions and World sign-in;
// all accounts/chains are generated fixtures, with no external IO or real GOLD.
const SECRET='celestao-fixture-secret-abcdefghijklmnopqrstuvwxyz-0123456789';
const VERIFIER='v'.repeat(43),STATE='s'.repeat(43),ORIGIN='https://imdember.com';
async function fixture(t){const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);t.after(()=>w.db.raw.close());
 const deps={db:w.db,secret:SECRET,now:w.clock.now,client:'fixture',allow:async()=>true};return {w,a,b,deps};}
async function authorize(f,patch={},headers={}){
 const q=new URLSearchParams({client_id:'celestao',redirect_uri:CELESTAO_CALLBACK,response_type:'code',code_challenge_method:'S256',code_challenge:await celestaoPkce(VERIFIER),state:STATE,lang:'zh',...patch});
 return handleCelestaoAuth(new Request(ORIGIN+'/api/celestao-auth/authorize?'+q,{headers:{cookie:f.b.cookie(),...headers}}),f.deps);
}
async function issue(f){const r=await authorize(f);assert.equal(r.status,303);return new URL(r.headers.get('location')).searchParams.get('code');}
function call(f,route,value,{secret=SECRET,headers={},method='POST',deps=f.deps}={}){
 return handleCelestaoAuth(new Request(ORIGIN+'/api/celestao-auth/'+route,{method,headers:{'content-type':'application/json',authorization:'Bearer '+secret,...headers},body:JSON.stringify(value)}),deps);
}
const token=code=>({grant_type:'authorization_code',client_id:'celestao',redirect_uri:CELESTAO_CALLBACK,code,code_verifier:VERIFIER});
const session=bridge=>({client_id:'celestao',bridge_session:bridge});

test('Celestao issues a hashed, fixed-callback identity grant without exposing the World session or authorizing payments',async t=>{
 const f=await fixture(t),before=f.b.cookie(),r=await authorize(f);assert.equal(r.status,303);
 assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.deepEqual(r.headers.getSetCookie(),[]);
 for(const [name]of r.headers)assert.ok(!name.startsWith('access-control-'));
 const target=new URL(r.headers.get('location'));assert.equal(target.origin+target.pathname,CELESTAO_CALLBACK);assert.equal(target.searchParams.get('state'),STATE);assert.equal(target.searchParams.get('lang'),'zh');
 const code=target.searchParams.get('code'),stored=f.w.db.raw.prepare('SELECT * FROM celestao_auth_codes').get();assert.equal(stored.code_hash,await sha256(code));assert.notEqual(stored.source_session_hash,before);
 const exchanged=await call(f,'token',token(code));assert.equal(exchanged.status,200);const value=await exchanged.json();
 assert.deepEqual(Object.keys(value).sort(),['issuer','audience','scope','address','expires_at','bridge_session'].sort());assert.equal(value.audience,'celestao');assert.equal(value.scope,'fortune:account');assert.equal(value.address,f.a.address.toLowerCase());
 assert.equal(f.w.db.raw.prepare('SELECT bridge_hash FROM celestao_bridge_sessions').get().bridge_hash,await sha256(value.bridge_session));assert.equal(f.b.cookie(),before);
 const introspected=await call(f,'session',session(value.bridge_session));assert.equal(introspected.status,200);assert.equal((await introspected.json()).scope,'fortune:account');
 assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM economy_orders').get().n,0);assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM aimarket_bridge_sessions').get().n,0);
});

test('wrong client, callback, origin, secret or PKCE cannot consume the valid code; racing replays have one winner',async t=>{
 const f=await fixture(t);
 for(const redirect_uri of ['https://celestao.com.evil.test/api/holder/world/callback','https://celestao.com/other','https://celestao.com/api/holder/world/callback?x=1','javascript:alert(1)'])assert.equal((await authorize(f,{redirect_uri})).status,400);
 assert.equal((await authorize(f,{}, {origin:'https://evil.test'})).status,403);
 const code=await issue(f);
 assert.equal((await call(f,'token',token(code),{secret:'wrong-secret-abcdefghijklmnopqrstuvwxyz-0123456789'})).status,401);
 assert.equal((await call(f,'token',{...token(code),code_verifier:'x'.repeat(43)})).status,401);
 assert.equal((await call(f,'token',{...token(code),client_id:'aimarket'})).status,400);
 assert.equal((await call(f,'token',{...token(code),address:f.a.address})).status,400);
 const raced=await Promise.all([call(f,'token',token(code)),call(f,'token',token(code))]);assert.deepEqual(raced.map(r=>r.status).sort(),[200,401]);
 assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM celestao_bridge_sessions').get().n,1);
});

test('expired codes and source-session revocation deny exchange and invalidate an already exchanged Celestao identity',async t=>{
 const f=await fixture(t),expired=await issue(f);f.w.clock.advance(CELESTAO_CODE_TTL_MS);assert.equal((await call(f,'token',token(expired))).status,401);
 const code=await issue(f),value=await (await call(f,'token',token(code))).json();const pending=await issue(f);
 f.w.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE address=?').run(f.w.clock.now(),f.a.address.toLowerCase());
 assert.equal((await call(f,'session',session(value.bridge_session))).status,401);assert.equal((await call(f,'token',token(pending))).status,401);
});

test('Celestao grants cannot be used as AIMarket identities or with an unrelated browser origin',async t=>{
 const f=await fixture(t),code=await issue(f),value=await (await call(f,'token',token(code))).json();
 const r=await handleAIMarketAuth(new Request(ORIGIN+'/api/aimarket-auth/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+SECRET},body:JSON.stringify({client_id:'aimarket',bridge_session:value.bridge_session})}),f.deps);
 assert.equal(r.status,401);assert.equal((await call(f,'session',session(value.bridge_session),{headers:{origin:'https://evil.test'}})).status,403);
});

test('closed route/schema limits and missing infrastructure fail without issuing codes or changing the ledger',async t=>{
 const f=await fixture(t);
 for(const route of ['toString','__proto__','constructor','unknown'])assert.equal((await call(f,route,{})).status,404);
 assert.equal((await call(f,'token',{...token('a'.repeat(43)),extra:'x'.repeat(2100)})).status,400);
 assert.equal((await authorize({...f,deps:{...f.deps,secret:undefined}})).status,503);
 assert.equal((await authorize({...f,deps:{...f.deps,allow:async()=>false}})).status,429);
 assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM celestao_auth_codes').get().n,0);assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM economy_orders').get().n,0);
 const invalid=await call(f,'session',session('a'.repeat(43)),{deps:{...f.deps,testConfig:{issuer:'https://evil.test',callback:'https://evil.test/api/holder/world/callback'}}});assert.equal(invalid.status,503);
});

test('the real Worker dispatches only the dedicated Celestao bridge and still fails closed when its independent secret is absent',async t=>{
 const w=setup({env:{CELESTAO_BRIDGE_SECRET:SECRET}}),a=newAccount(),b=w.browser();t.after(()=>w.db.raw.close());await b.signIn(a);
 const q=new URLSearchParams({client_id:'celestao',redirect_uri:CELESTAO_CALLBACK,response_type:'code',code_challenge_method:'S256',code_challenge:await celestaoPkce(VERIFIER),state:STATE,lang:'en'});
 const r=await b.get('/api/celestao-auth/authorize?'+q);assert.equal(r.status,303);const code=new URL(r.headers.get('location')).searchParams.get('code');
 const request=()=>new Request(ORIGIN+'/api/celestao-auth/token',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+SECRET},body:JSON.stringify(token(code))});
 assert.equal((await w.call(request(),{...w.env,CELESTAO_BRIDGE_SECRET:undefined})).status,503);
 const exchanged=await w.call(request());assert.equal(exchanged.status,200);assert.equal((await exchanged.json()).scope,'fortune:account');
 assert.equal(w.db.raw.prepare('SELECT count(*) n FROM economy_orders').get().n,0);
});

test('the Worker gives Celestao session checks the bridge budget',async t=>{
 const limiter=success=>({limit:async()=>({success})});
 const w=setup({env:{CELESTAO_BRIDGE_SECRET:SECRET,AUTH_LIMITER:limiter(false),BRIDGE_LIMITER:limiter(true)}});t.after(()=>w.db.raw.close());
 const response=await w.call(new Request(ORIGIN+'/api/celestao-auth/session',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+SECRET},body:JSON.stringify({client_id:'celestao',bridge_session:'x'.repeat(43)})}));
 assert.equal(response.status,401);
});
test('the token budget follows the login code, not the shared relay address',async t=>{const f=await fixture(t),keys=[];
 const r=await authorize(f);const code=new URL(r.headers.get('location')).searchParams.get('code');
 const response=await handleCelestaoAuth(new Request(ORIGIN+'/api/celestao-auth/token',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+SECRET},body:JSON.stringify(token(code))}),{...f.deps,client:'ip:shared-relay',allow:async k=>{keys.push(k);return true;}});
 assert.equal(response.status,200);assert.equal(keys.length,1);assert.match(keys[0],/^celestao:token:[0-9a-f]{32}$/);
});
