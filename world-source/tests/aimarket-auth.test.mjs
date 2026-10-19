import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount} from './wallet-harness.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {AIMARKET_CALLBACK,AIMARKET_PORTAL_CALLBACK,AIMARKET_ISSUER,AIMARKET_CODE_TTL_MS,AIMARKET_SESSION_TTL_MS,aimarketPkce,handleAIMarketAuth,pruneAIMarketAuth} from '../server/aimarket-auth.ts';

// Real Worker, migrations and SQLite; synthetic wallet/chain/limiter responses. No external network or actual funds.
const SECRET='issuer-test-secret-abcdefghijklmnopqrstuvwxyz-0123456789';
const VERIFIER='v'.repeat(43),STATE='s'.repeat(43);
const count=(w,table)=>w.db.raw.prepare('SELECT count(*) n FROM '+table).get().n;
async function fixture(){const w=setup({env:{AIMARKET_BRIDGE_SECRET:SECRET}}),a=newAccount(),b=w.browser();
  await b.signIn(a);return {w,a,b};}
async function authorize(w,b,patch={},options={}){
  const q=new URLSearchParams({client_id:'aimarket',redirect_uri:AIMARKET_CALLBACK,response_type:'code',
    code_challenge_method:'S256',code_challenge:await aimarketPkce(VERIFIER),state:STATE,lang:'zh',...patch});
  return b.get('/api/aimarket-auth/authorize?'+q,options);
}
async function issue(w,b){const r=await authorize(w,b);assert.equal(r.status,303);return new URL(r.headers.get('location')).searchParams.get('code');}
function backend(w,path,body,options={}){
  return w.call(new Request(AIMARKET_ISSUER+'/api/aimarket-auth/'+path,{method:options.method??'POST',
    headers:{'content-type':'application/json',authorization:'Bearer '+(options.secret??SECRET),...options.headers},
    body:typeof body==='string'?body:JSON.stringify(body)}));
}
const tokenBody=code=>({grant_type:'authorization_code',client_id:'aimarket',redirect_uri:AIMARKET_CALLBACK,code,code_verifier:VERIFIER});
async function exchange(w,code,patch={},options={}){return backend(w,'token',{...tokenBody(code),...patch},options);}
const introspect=(w,bridge,patch={},options={})=>backend(w,'session',{client_id:'aimarket',bridge_session:bridge,...patch},options);

test('fixed research profile binds code to its callback, rejects cross-profile exchange, and reuses one World session',async()=>{
 const {w,b}=await fixture(),response=await authorize(w,b,{redirect_uri:AIMARKET_PORTAL_CALLBACK});assert.equal(response.status,303);
 const target=new URL(response.headers.get('location'));assert.equal(target.origin+target.pathname,AIMARKET_PORTAL_CALLBACK);
 const code=target.searchParams.get('code');assert.equal((await exchange(w,code)).status,401);
 const good=await exchange(w,code,{redirect_uri:AIMARKET_PORTAL_CALLBACK});assert.equal(good.status,200);assert.equal((await good.json()).scope,'research:read');
 assert.equal(count(w,'sessions'),1);assert.equal(count(w,'aimarket_bridge_sessions'),1);
 assert.equal((await authorize(w,b,{redirect_uri:'https://research.imdember.com/other'})).status,400);
});
function hardened(r){assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal(r.headers.get('x-frame-options'),'DENY');
  assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');assert.deepEqual(r.headers.getSetCookie(),[]);
  for(const [name] of r.headers)assert.ok(!name.startsWith('access-control-'));}

test('one existing World sign-in issues only a fixed-callback research identity, hashes codes/bridges, and keeps cookies untouched',async()=>{
  const {w,a,b}=await fixture(),sessionToken=b.jar.get(SESSION_COOKIE),response=await authorize(w,b,{expected_address:a.address},{origin:null});
  assert.equal(response.status,303);hardened(response);const location=new URL(response.headers.get('location')),code=location.searchParams.get('code');
  assert.equal(location.origin+location.pathname,AIMARKET_CALLBACK);assert.equal(location.searchParams.get('state'),STATE);assert.equal(location.searchParams.get('lang'),'zh');
  assert.match(code,/^[\w-]{43}$/);const stored=w.db.raw.prepare('SELECT * FROM aimarket_auth_codes').get();
  assert.equal(stored.code_hash,await sha256(code));assert.equal(stored.source_session_hash,await sha256(sessionToken));
  assert.equal(stored.expires_at,w.clock.now()+AIMARKET_CODE_TTL_MS);assert.ok(!JSON.stringify(stored).includes(code));
  const token=await exchange(w,code);assert.equal(token.status,200);hardened(token);const identity=await token.json();
  assert.deepEqual({...identity,bridge_session:'opaque'}, {issuer:AIMARKET_ISSUER,audience:'aimarket',scope:'research:read',
    address:a.address.toLowerCase(),expires_at:w.clock.now()+AIMARKET_SESSION_TTL_MS,bridge_session:'opaque'});
  assert.match(identity.bridge_session,/^[\w-]{43}$/);const bridge=w.db.raw.prepare('SELECT * FROM aimarket_bridge_sessions').get();
  assert.equal(bridge.bridge_hash,await sha256(identity.bridge_session));assert.ok(!JSON.stringify(bridge).includes(identity.bridge_session));
  const status=await introspect(w,identity.bridge_session);assert.equal(status.status,200);hardened(status);
  const expected={...identity};delete expected.bridge_session;assert.deepEqual(await status.json(),expected);
  assert.equal(b.jar.get(SESSION_COOKIE),sessionToken);assert.equal(count(w,'sessions'),1,'SSO neither re-signs nor creates another World session');
});

test('PKCE, wrong code, replay and concurrent exchange: exactly one bridge can be materialized',async()=>{
  const {w,b}=await fixture(),code=await issue(w,b);
  assert.equal((await exchange(w,code,{code_verifier:'x'.repeat(43)})).status,401);assert.equal(count(w,'aimarket_bridge_sessions'),0);
  assert.equal((await exchange(w,'z'.repeat(43))).status,401);
  const replies=await Promise.all([exchange(w,code),exchange(w,code)]);assert.deepEqual(replies.map(r=>r.status).sort(),[200,401]);
  assert.equal(count(w,'aimarket_bridge_sessions'),1);assert.equal((await exchange(w,code)).status,401);
});

test('exchange transaction rolls back consumption if bridge insertion fails, allowing the same safe retry',async()=>{
  const {w,b}=await fixture(),code=await issue(w,b);
  w.db.raw.exec("CREATE TRIGGER bridge_test_failure BEFORE INSERT ON aimarket_bridge_sessions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.equal((await exchange(w,code)).status,503);assert.equal(w.db.raw.prepare('SELECT consumed_at FROM aimarket_auth_codes').get().consumed_at,null);
  w.db.raw.exec('DROP TRIGGER bridge_test_failure');assert.equal((await exchange(w,code)).status,200);assert.equal(count(w,'aimarket_bridge_sessions'),1);
});

test('anonymous, forged, revoked and expired World cookies do not issue codes; front-end addresses have no authority',async()=>{
  const {w,a,b}=await fixture();for(const cookie of [undefined,'z'.repeat(43),'bad']){
    const anonymous=w.browser();if(cookie)anonymous.jar.set(SESSION_COOKIE,cookie);
    assert.equal((await authorize(w,anonymous,{expected_address:a.address})).status,401);
  }
  const mismatch=await authorize(w,b,{expected_address:newAccount().address});assert.equal(mismatch.status,409);assert.equal(count(w,'aimarket_auth_codes'),0);
  assert.equal((await authorize(w,b,{wallet:a.address,connected:'true'})).status,400);
  await b.post('/api/auth/logout');assert.equal((await authorize(w,b,{expected_address:a.address})).status,401);
  await b.signIn(a);w.clock.advance(7*86400000);assert.equal((await authorize(w,b)).status,401);assert.equal(count(w,'aimarket_auth_codes'),0);
});

test('unauthenticated browser navigation returns to World login without issuing codes; API denials stay JSON',async()=>{
  const {w,a,b}=await fixture(),anonymous=w.browser();
  const options={origin:'https://aimarket.trade',headers:{'sec-fetch-mode':'navigate',accept:'text/html,application/xhtml+xml'}};
  const navigation=await authorize(w,anonymous,{},options);assert.equal(navigation.status,303);hardened(navigation);
  assert.equal(navigation.headers.get('location'),'/aimarket/?lang=zh');assert.equal(count(w,'aimarket_auth_codes'),0);
  const mismatch=await authorize(w,b,{expected_address:newAccount().address},options);
  assert.equal(mismatch.status,303);assert.equal(mismatch.headers.get('location'),'/aimarket/?lang=zh');
  assert.equal(count(w,'aimarket_auth_codes'),0);
  const api=await authorize(w,anonymous,{expected_address:a.address});assert.equal(api.status,401);assert.equal((await api.json()).error,'AUTH_REQUIRED');
});

test('source revocation before issuance insert or exchange closes authority across async boundaries',async()=>{
  const {w,b}=await fixture();let revoke=true;const db={...w.db,prepare(sql){const statement=w.db.prepare(sql);
    return {...statement,bind(...args){const bound=statement.bind(...args);if(!sql.startsWith('SELECT address,expires_at,revoked_at'))return bound;
      return {...bound,async first(){const row=await bound.first();if(revoke){revoke=false;w.db.raw.exec('UPDATE sessions SET revoked_at=1');}return row;}};}};}};
  const request=b.request('/api/aimarket-auth/authorize?'+new URLSearchParams({client_id:'aimarket',redirect_uri:AIMARKET_CALLBACK,response_type:'code',
    code_challenge_method:'S256',code_challenge:await aimarketPkce(VERIFIER),state:STATE,lang:'en'}));
  assert.equal((await handleAIMarketAuth(request,{db,secret:SECRET,now:w.clock.now,allow:async()=>true})).status,401);
  assert.equal(count(w,'aimarket_auth_codes'),0);
  w.db.raw.exec('UPDATE sessions SET revoked_at=NULL');const code=await issue(w,b);await b.post('/api/auth/logout');
  assert.equal((await exchange(w,code)).status,401);assert.equal(count(w,'aimarket_bridge_sessions'),0);
});

test('World logout, logout-all, source expiry and bridge expiry invalidate introspection immediately',async()=>{
  for(const mode of ['logout','logout-all','source-expiry','bridge-expiry']){
    const {w,a,b}=await fixture();if(mode==='source-expiry')w.db.raw.prepare('UPDATE sessions SET expires_at=?').run(w.clock.now()+1000);
    const token=await (await exchange(w,await issue(w,b))).json();assert.equal((await introspect(w,token.bridge_session)).status,200);
    if(mode==='logout')await b.post('/api/auth/logout');
    if(mode==='logout-all')await b.post('/api/auth/logout-all',{expectedAddress:a.address});
    if(mode==='source-expiry')w.clock.advance(1000);
    if(mode==='bridge-expiry')w.clock.advance(AIMARKET_SESSION_TTL_MS);
    assert.equal((await introspect(w,token.bridge_session)).status,401,mode);
  }
});

test('code and bridge deadlines are absolute, capped by original source expiry, and never renewed by reads',async()=>{
  const {w,b}=await fixture();w.db.raw.prepare('UPDATE sessions SET expires_at=?').run(w.clock.now()+10000);
  const code=await issue(w,b);assert.equal(w.db.raw.prepare('SELECT expires_at FROM aimarket_auth_codes').get().expires_at,w.clock.now()+10000);
  const token=await (await exchange(w,code)).json();assert.equal(token.expires_at,w.clock.now()+10000);
  w.clock.advance(5000);assert.equal((await (await introspect(w,token.bridge_session)).json()).expires_at,token.expires_at);
  const next=await issue(w,b);w.clock.advance(5000);assert.equal((await exchange(w,next)).status,401);
  const fresh=await fixture(),old=await issue(fresh.w,fresh.b);fresh.w.clock.advance(AIMARKET_CODE_TTL_MS);
  assert.equal((await exchange(fresh.w,old)).status,401);
});

test('authorize is bounded and rejects unknown/duplicate query fields, client/callback/PKCE/state/language tampering',async()=>{
  const {w,b}=await fixture();for(const patch of [{client_id:'other'},{redirect_uri:'https://evil.example/callback'},
    {redirect_uri:AIMARKET_CALLBACK+'?x=1'},{response_type:'token'},{code_challenge_method:'plain'},{code_challenge:'a'},
    {state:'short'},{lang:'xx'},{expected_address:'bad'},{unexpected:'true'}])assert.equal((await authorize(w,b,patch)).status,400,JSON.stringify(patch));
  const valid=b.request('/api/aimarket-auth/authorize?'+new URLSearchParams({client_id:'aimarket',redirect_uri:AIMARKET_CALLBACK,response_type:'code',
    code_challenge_method:'S256',code_challenge:await aimarketPkce(VERIFIER),state:STATE,lang:'en'}));
  assert.equal((await w.call(new Request(valid.url+'&state='+STATE,{headers:valid.headers}))).status,400);
  assert.equal((await authorize(w,b,{state:'s'.repeat(3000)})).status,400);assert.equal(count(w,'aimarket_auth_codes'),0);
});

test('backend secret, fixed request origins, closed JSON and HTTP methods protect both backend routes',async()=>{
  const {w,b}=await fixture(),code=await issue(w,b);
  for(const secret of ['',SECRET+'x','short'])assert.equal((await exchange(w,code,{}, {secret})).status,401);
  for(const patch of [{client_id:'other'},{redirect_uri:'https://evil.example/callback'},{grant_type:'password'},
    {code:'a'},{code_verifier:'short'},{code_verifier:'v'.repeat(129)},{paid:true},{address:newAccount().address}])assert.equal((await exchange(w,code,patch)).status,400);
  for(const body of [[],null,'{bad json','{"extra":"'+ 'a'.repeat(2500)+'"}'])assert.equal((await backend(w,'token',body)).status,400);
  assert.equal((await exchange(w,code,{}, {headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await authorize(w,b,{}, {origin:'https://evil.example'})).status,403);
  assert.equal((await w.call(new Request('https://wrong.example/api/aimarket-auth/token',{method:'POST'}))).status,403);
  assert.equal((await w.call(new Request(AIMARKET_ISSUER+'/api/aimarket-auth/token',{method:'OPTIONS'}))).status,405);
  assert.equal((await w.call(new Request(AIMARKET_ISSUER+'/api/aimarket-auth/unknown'))).status,404);
  assert.equal((await backend(w,'token?code=x',tokenBody(code))).status,400);
  const result=await exchange(w,code);assert.equal(result.status,200);const bridge=(await result.json()).bridge_session;
  assert.equal((await introspect(w,bridge,{scope:'admin'})).status,400);
  assert.equal((await introspect(w,bridge,{}, {secret:'x'.repeat(32)})).status,401);
  assert.equal((await introspect(w,'z'.repeat(43))).status,401);
});

test('missing/weak secret, absent DB, schema or limiter, thrown limits and clock errors fail closed without codes',async()=>{
  const {w,b}=await fixture();for(const env of [{...w.env,AIMARKET_BRIDGE_SECRET:undefined},{...w.env,AIMARKET_BRIDGE_SECRET:'weak'},
    {...w.env,DB:undefined},{...w.env,AUTH_LIMITER:undefined},{...w.env,AUTH_LIMITER:{limit:async()=>{throw new Error('binding failed');}}}]){
    const request=b.request('/api/aimarket-auth/authorize?'+new URLSearchParams({client_id:'aimarket',redirect_uri:AIMARKET_CALLBACK,response_type:'code',
      code_challenge_method:'S256',code_challenge:await aimarketPkce(VERIFIER),state:STATE,lang:'en'}));
    const r=await w.call(request,env);assert.equal(r.status,503);hardened(r);
  }
  const denied={...w.env,AUTH_LIMITER:{limit:async()=>({success:false})}};
  const request=b.request('/api/aimarket-auth/authorize?'+new URLSearchParams({client_id:'aimarket',redirect_uri:AIMARKET_CALLBACK,response_type:'code',
    code_challenge_method:'S256',code_challenge:await aimarketPkce(VERIFIER),state:STATE,lang:'en'}));
  assert.equal((await w.call(request,denied)).status,429);
  assert.equal((await handleAIMarketAuth(request,{db:w.db,secret:SECRET,allow:async()=>true,now:()=>NaN})).status,503);
  w.db.raw.exec('DROP TABLE aimarket_auth_codes');assert.equal((await w.call(request)).status,503);
});

test('loopback is permitted only by explicit dependency config; cleanup is bounded and source profiles remain',async()=>{
  const {w,b}=await fixture(),q=new URLSearchParams({client_id:'aimarket',redirect_uri:'http://127.0.0.1:8080/api/holder/world/callback',response_type:'code',
    code_challenge_method:'S256',code_challenge:await aimarketPkce(VERIFIER),state:STATE,lang:'en'}),req=new Request('http://127.0.0.1:8081/api/aimarket-auth/authorize?'+q,{headers:{cookie:b.cookie()}});
  const deps={db:w.db,secret:SECRET,now:w.clock.now,allow:async()=>true};
  assert.equal((await handleAIMarketAuth(req,deps)).status,403);
  assert.equal((await handleAIMarketAuth(req,{...deps,testConfig:{issuer:'http://127.0.0.1:8081',callback:'http://127.0.0.1:8080/api/holder/world/callback'}})).status,303);
  assert.equal((await handleAIMarketAuth(req,{...deps,testConfig:{issuer:'https://evil.example',callback:'https://evil.example/api/holder/world/callback'}})).status,503);
  for(let i=0;i<205;i++)w.db.raw.prepare('INSERT INTO aimarket_auth_codes(code_hash,source_session_hash,address,code_challenge,redirect_uri,issued_at,expires_at) VALUES(?,?,?,?,?,?,?)')
    .run(String(i),'synthetic','0x'+'1'.repeat(40),'c',AIMARKET_CALLBACK,1,2);
  const source=count(w,'sessions'),first=await pruneAIMarketAuth(w.db,w.clock.now());assert.equal(first.codes,200);
  assert.equal((await pruneAIMarketAuth(w.db,w.clock.now())).codes,5);assert.equal(count(w,'sessions'),source);
  assert.equal(count(w,'aimarket_auth_codes'),1,'unexpired code remains');
});
