import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parseSiweMessage} from 'viem/siwe';
import {getAddress} from 'viem';
import {checkSignInMessage} from '../src/world/siwe.ts';
import {setup,newAccount,Browser,START,windowLimiter} from './wallet-harness.mjs';
import {openD1} from './d1-sqlite.mjs';
import {readFileSync} from 'node:fs';
import {imdGatewayPlugin} from '../server/vite-plugin.ts';
import {sha256,SIWE_STATEMENT,ERC6492_SUFFIX,INSERT_CHALLENGE,NETWORK_CHALLENGE_BUDGET,NETWORK_WINDOW_MS,CHALLENGE_BUDGET,CHALLENGE_BUDGET_WINDOW_MS,
  CHALLENGE_BUDGET_NETWORKS,FRESH_NETWORK_RESERVE,FRESH_NETWORKS,ADDRESS_SURGE,CLAIM_CONTRACT,CLAIM_LANE,ERC1271_CODE_SHARE,ERC1271_NETWORK_SHARE,ERC1271_ADDRESS_SHARE,CODE_CAP,NO_CODE_TTL_MS,
  KNOWN_ERC1271,REVOKE_ALL_SESSIONS} from '../server/auth.ts';
import {ALCHEMY_RPC_URL} from '../server/ownership.ts';
// Every rule runs through the real Worker handler (createWorker → handleAccountApi) against the real migration SQL on
// node:sqlite, with keys generated per run. Nothing here re-derives what the server computes; it signs, sends and
// reads back what a browser and the database would see.
const MIN=60_000,DAY=86_400_000,NL=String.fromCharCode(10);
const body=r=>r.clone().json();
const sessionCount=db=>db.raw.prepare('SELECT count(*) n FROM sessions').get().n;
const randomSignature=()=>'0x'+Buffer.from(crypto.getRandomValues(new Uint8Array(65))).toString('hex');
/** A browser on a network of its own (a /24 per call), for tests that make more ERC-1271 checks than one network's
 *  per-minute share (ERC1271_NETWORK_SHARE) and are not about that share. */
let spreadAt=0;const spread=w=>w.browser(undefined,undefined,'198.18.'+(++spreadAt%250)+'.1');
function assertNoStoreNoCors(r,label){
  assert.equal(r.headers.get('cache-control'),'no-store',label);
  for(const [name] of r.headers)assert.ok(!name.toLowerCase().startsWith('access-control-'),label+': '+name);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff',label);
  assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains',label);
}

test('sign-in: server-built SIWE message, one session cookie with every flag, token stored only as its hash',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();
  const {challenge,c,verify}=await b.signIn(a);
  assert.equal(challenge.status,200);assert.equal(verify.status,200);
  const m=parseSiweMessage(c.message);
  assert.equal(m.domain,'imdember.com');assert.equal(m.uri,'https://imdember.com/');assert.equal(m.chainId,1);assert.equal(m.version,'1');
  assert.equal(m.address,a.address);assert.equal(m.nonce,c.nonce);assert.equal(m.statement,SIWE_STATEMENT);
  assert.match(c.nonce,/^[\da-f]{32}$/);
  assert.equal(m.issuedAt.getTime(),START);assert.equal(m.expirationTime.getTime(),START+5*MIN);assert.equal(c.acceptUntil,START+5*MIN);
  const flow=challenge.headers.getSetCookie();
  assert.deepEqual(flow.map(s=>s.replace(/=[\da-f]{32};/,'=X;')),['__Host-imd_flow=X; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300']);
  const set=verify.headers.getSetCookie(),session=set.find(s=>s.startsWith('__Host-imd_session='));
  const attrs=session.split(';').map(s=>s.trim()),token=attrs[0].slice('__Host-imd_session='.length);
  assert.match(token,/^[\w-]{43}$/);   // 32 random bytes, base64url
  assert.deepEqual(attrs.slice(1),['Path=/','Secure','HttpOnly','SameSite=Lax','Max-Age=604800']);
  assert.ok(!/domain=/i.test(session));
  assert.ok(set.includes('__Host-imd_flow=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'),'flow cookie cleared');
  assert.deepEqual(await body(verify),{address:a.address,expiresAt:START+7*DAY});
  const rows=w.db.raw.prepare('SELECT * FROM sessions').all();
  assert.equal(rows.length,1);assert.equal(rows[0].token_hash,await sha256(token));assert.equal(rows[0].address,a.address.toLowerCase());
  assert.ok(!JSON.stringify(w.db.raw.prepare('SELECT * FROM sessions, login_challenges').all()).includes(token),'the token itself is stored nowhere');
  const s=await b.get('/api/auth/session');
  assert.deepEqual(await body(s),{signedIn:true,address:a.address,expiresAt:START+7*DAY});
  // A second login makes a new token (no fixation) and the first stays valid until logout or expiry.
  const b2=w.browser();await b2.signIn(a);assert.notEqual(b2.jar.get('__Host-imd_session'),token);assert.equal(sessionCount(w.db),2);
});

test('every auth and /api/me response is no-store and carries no CORS header',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();
  const {challenge,verify}=await b.signIn(a);
  const responses={challenge,verify,session:await b.get('/api/auth/session'),home:await b.get('/api/me/home'),logout:await b.post('/api/auth/logout'),
    home401:await b.get('/api/me/home'),forbidden:await b.post('/api/auth/challenge',{address:a.address},{origin:'https://evil.example'}),
    preflight:await w.call(new Request('https://imdember.com/api/auth/verify',{method:'OPTIONS',headers:{origin:'https://evil.example','access-control-request-method':'POST'}}))};
  for(const [k,r] of Object.entries(responses))assertNoStoreNoCors(r,k);
  assert.equal(responses.preflight.status,405);assert.equal(responses.home401.status,401);
});

test('every Worker route answers with HSTS: success, errors, 429, 503, 204 logout and the wallet assets route',async()=>{
  const hsts='max-age=31536000; includeSubDomains',w=setup({env:{AUTH_LIMITER:{limit:async()=>({success:false})}}}),a=newAccount();
  const open=setup(),b=open.browser();await b.signIn(a);
  const noDb={...open.env};delete noDb.DB;
  const responses={home:await b.get('/api/me/home'),assets:await b.get('/api/wallet/'+a.address+'/assets'),logout:await b.post('/api/auth/logout'),
    unknown:await b.get('/api/auth/other'),badWallet:await b.get('/api/wallet/0x12/assets'),limited:await w.browser().post('/api/auth/challenge',{address:a.address}),
    noDb:await open.worker.fetch(new Request('https://imdember.com/api/auth/session'),noDb,{waitUntil(){}}),
    world404:await open.call(new Request('https://imdember.com/api/world/nope')),world405:await open.call(new Request('https://imdember.com/api/world/snapshot',{method:'POST'}))};
  assert.deepEqual(Object.fromEntries(Object.entries(responses).map(([k,r])=>[k,r.status])),{home:200,assets:200,logout:204,unknown:404,badWallet:404,limited:429,noDb:503,world404:404,world405:405});
  for(const [k,r] of Object.entries(responses))assert.equal(r.headers.get('strict-transport-security'),hsts,k);
});

test('forged signature, another key, and every altered message field are refused (401), with or without an RPC fallback',async()=>{
  const w=setup(),a=newAccount(),other=newAccount();
  const attempt=async(sign)=>{const b=spread(w),{verify}=await b.signIn(a,{sign});return [verify.status,(await body(verify)).error];};
  assert.deepEqual(await attempt(()=>randomSignature()),[401,'SIGNATURE_INVALID']);
  assert.deepEqual(await attempt(m=>other.signMessage({message:m})),[401,'SIGNATURE_INVALID']);
  for(const [from,to] of [['imdember.com wants','evil.example wants'],['URI: https://imdember.com/','URI: https://evil.example/'],['Chain ID: 1','Chain ID: 11155111'],
    [/Nonce: [\da-f]{32}/,'Nonce: '+'0'.repeat(32)],[/Expiration Time: .*/,'Expiration Time: 2099-01-01T00:00:00.000Z']]){
    const result=await attempt(m=>{const altered=m.replace(from,to);assert.notEqual(altered,m);return a.signMessage({message:altered});});
    assert.deepEqual(result,[401,'SIGNATURE_INVALID'],String(from));
  }
  // The ERC-1271 fallback was asked (the address is an EOA: empty return) and never turned a bad signature into a login.
  assert.ok(w.chain.state.calls.some(c=>c.url===ALCHEMY_RPC_URL));
  assert.equal(sessionCount(w.db),0);
  // Without an RPC key a signature ECDSA cannot prove is 503 VERIFY_UNAVAILABLE, never a login and never "invalid".
  const nokey=setup({key:null}),b=nokey.browser(),{verify}=await b.signIn(a,{sign:()=>randomSignature()});
  assert.equal(verify.status,503);assert.equal((await body(verify)).error,'VERIFY_UNAVAILABLE');assert.equal(sessionCount(nokey.db),0);
  // ...while a real EOA signature needs no RPC at all.
  const ok=await nokey.browser().signIn(a);assert.equal(ok.verify.status,200);
});

test('Origin: missing, foreign, and loopback-on-production are 403; loopback works only on a loopback URL; verify must match the challenge origin',async()=>{
  const w=setup(),a=newAccount();
  for(const origin of [null,'https://evil.example','https://imdember.com.evil.example','http://imdember.com','https://www.imdember.com','http://localhost:8792','http://127.0.0.1:5174','null']){
    for(const path of ['/api/auth/challenge','/api/auth/verify','/api/auth/logout']){
      const r=await w.browser(origin,'https://imdember.com').post(path,{address:a.address});
      assert.equal(r.status,403,origin+' '+path);assert.equal((await body(r)).error,'ORIGIN_NOT_ALLOWED');
    }
  }
  const local=w.browser('http://localhost:8792','http://localhost:8792'),{c,verify}=await local.signIn(a);
  assert.equal(verify.status,200);assert.equal(parseSiweMessage(c.message).domain,'localhost:8792');assert.equal(parseSiweMessage(c.message).uri,'http://localhost:8792/');
  // Same browser flow, another (allowed) origin at verify time: refused.
  const b=w.browser('http://localhost:8792','http://localhost:8792'),ch=await body(await b.post('/api/auth/challenge',{address:a.address}));
  b.origin='http://127.0.0.1:8792';
  const r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature:await a.signMessage({message:ch.message})});
  assert.equal(r.status,403);assert.equal((await body(r)).error,'FLOW_MISMATCH');
});

test('flow cookie: missing or another browser\'s flow cannot use a challenge (login CSRF, cross-browser replay)',async()=>{
  const w=setup(),victim=w.browser(),attacker=w.browser(),a=newAccount();
  const ch=await body(await attacker.post('/api/auth/challenge',{address:a.address})),signature=await a.signMessage({message:ch.message});
  await victim.post('/api/auth/challenge',{address:a.address});     // the victim has a flow cookie of its own
  const planted=await victim.post('/api/auth/verify',{nonce:ch.nonce,signature});
  assert.equal(planted.status,403);assert.equal((await body(planted)).error,'FLOW_MISMATCH');
  const bare=w.browser(),none=await bare.post('/api/auth/verify',{nonce:ch.nonce,signature});
  assert.equal(none.status,403);assert.equal((await body(none)).error,'FLOW_MISMATCH');
  assert.equal(sessionCount(w.db),0);
  assert.equal((await attacker.post('/api/auth/verify',{nonce:ch.nonce,signature})).status,200,'the owning flow still can');
});

test('challenge lifetime: expired 410, replayed 409, superseded 409, unknown 409',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();
  const ch=await body(await b.post('/api/auth/challenge',{address:a.address})),sig=await a.signMessage({message:ch.message}),flow=b.jar.get('__Host-imd_flow');
  w.clock.advance(5*MIN);
  let r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature:sig});assert.equal(r.status,410);assert.equal((await body(r)).error,'CHALLENGE_EXPIRED');
  w.clock.advance(-1);   // one ms inside the window
  r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature:sig});assert.equal(r.status,200);
  // Replay after success: the flow cookie was cleared, so the same browser is refused; with it restored, 409.
  r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature:sig});assert.equal(r.status,403);
  b.jar.set('__Host-imd_flow',flow);
  r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature:sig});assert.equal(r.status,409);assert.equal((await body(r)).error,'CHALLENGE_USED');
  assert.equal(sessionCount(w.db),1);
  // A→B in one browser: B's challenge supersedes A's (and moves the browser to a new flow value), so A's late signature
  // is refused — 403 with the flow the browser now holds, 409 even with the one A's challenge was issued under — and B's works.
  const A=newAccount(),B=newAccount(),d=w.browser();
  const ca=await body(await d.post('/api/auth/challenge',{address:A.address})),fa=d.jar.get('__Host-imd_flow'),cb=await body(await d.post('/api/auth/challenge',{address:B.address}));
  const late=await A.signMessage({message:ca.message});
  r=await d.post('/api/auth/verify',{nonce:ca.nonce,signature:late});assert.equal(r.status,403);
  const fb=d.jar.get('__Host-imd_flow');d.jar.set('__Host-imd_flow',fa);
  r=await d.post('/api/auth/verify',{nonce:ca.nonce,signature:late});assert.equal(r.status,409);d.jar.set('__Host-imd_flow',fb);
  r=await d.post('/api/auth/verify',{nonce:cb.nonce,signature:await B.signMessage({message:cb.message})});assert.equal(r.status,200);
  assert.equal((await body(r)).address,B.address);
  r=await d.post('/api/auth/verify',{nonce:'f'.repeat(32),signature:sig});assert.equal(r.status,409);
  assert.equal(sessionCount(w.db),2);
});

test('the SIWE Expiration Time is the challenge window (5 min), not the 7-day session, and the stored message must say so',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();
  const r=await b.post('/api/auth/challenge',{address:a.address}),c=await body(r),m=parseSiweMessage(c.message);
  assert.deepEqual({...m},{domain:'imdember.com',address:a.address,statement:SIWE_STATEMENT,uri:'https://imdember.com/',version:'1',chainId:1,
    nonce:c.nonce,issuedAt:new Date(START),expirationTime:new Date(START+5*MIN)},'every field, and nothing else (no Not Before, Request ID or Resources)');
  assert.equal(c.acceptUntil,START+5*MIN);assert.equal(m.expirationTime.getTime(),c.acceptUntil);
  assert.match(SIWE_STATEMENT,/for 7 days/,'the session lifetime is stated in words');
  const row=w.db.raw.prepare('SELECT message,issued_at,accept_until FROM login_challenges WHERE nonce=?').get(c.nonce);
  assert.equal(row.message,c.message);assert.equal(row.accept_until,START+5*MIN);assert.equal(row.issued_at,START);
  // Signed inside the window, presented at its end: 410 from the server's own accept_until, no session.
  const sig=await a.signMessage({message:c.message});w.clock.advance(5*MIN);
  let v=await b.post('/api/auth/verify',{nonce:c.nonce,signature:sig});
  assert.equal(v.status,410);assert.equal((await body(v)).error,'CHALLENGE_EXPIRED');assert.equal(sessionCount(w.db),0);
  // Inside the window the session still lasts 7 days from issue.
  const d=w.browser(),c2=await body(await d.post('/api/auth/challenge',{address:a.address}));w.clock.advance(5*MIN-1);
  v=await d.post('/api/auth/verify',{nonce:c2.nonce,signature:await a.signMessage({message:c2.message})});
  assert.equal(v.status,200);assert.equal((await body(v)).expiresAt,START+5*MIN+7*DAY);
  // A stored message whose Expiration Time outlives accept_until (e.g. issued by an older build) is refused.
  const e=w.browser(),c3=await body(await e.post('/api/auth/challenge',{address:a.address}));
  const long=c3.message.replace(/Expiration Time: .*/,'Expiration Time: '+new Date(w.clock.now()+7*DAY).toISOString());assert.notEqual(long,c3.message);
  w.db.raw.prepare('UPDATE login_challenges SET message=? WHERE nonce=?').run(long,c3.nonce);
  v=await e.post('/api/auth/verify',{nonce:c3.nonce,signature:await a.signMessage({message:long})});
  assert.equal(v.status,401);assert.equal((await body(v)).error,'SIGNATURE_INVALID');
  // So is one whose Issued At differs from issued_at while its Expiration Time still matches accept_until.
  const f=w.browser(),c4=await body(await f.post('/api/auth/challenge',{address:a.address}));
  const early=c4.message.replace(/Issued At: .*/,'Issued At: '+new Date(w.clock.now()-MIN).toISOString());assert.notEqual(early,c4.message);
  assert.equal(parseSiweMessage(early).expirationTime.getTime(),w.db.raw.prepare('SELECT accept_until FROM login_challenges WHERE nonce=?').get(c4.nonce).accept_until);
  w.db.raw.prepare('UPDATE login_challenges SET message=? WHERE nonce=?').run(early,c4.nonce);
  v=await f.post('/api/auth/verify',{nonce:c4.nonce,signature:await a.signMessage({message:early})});
  assert.equal(v.status,401);assert.equal((await body(v)).error,'SIGNATURE_INVALID');assert.equal(sessionCount(w.db),1,'only the in-window sign-in above');
});

// F-1 (swarm review 4bd31cfb): the statement did not say that signing grants no approvals.
test('F-1: the statement names transfers, token or NFT approvals and transactions, keeps the 7 days; only that text verifies, the retired wording and any other is 401',async()=>{
  assert.equal(SIWE_STATEMENT,'Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.');
  const auth=await import('../server/auth.ts');assert.equal('SIWE_PREVIOUS_STATEMENTS' in auth,false,'the transition allowance is gone');
  const w=setup(),a=newAccount(),at=w.clock.now();
  const fresh=await w.browser().signIn(a);assert.deepEqual([fresh.verify.status,parseSiweMessage(fresh.c.message).statement],[200,SIWE_STATEMENT]);
  assert.equal(checkSignInMessage(fresh.c.message,{origin:'https://imdember.com',account:a.address,nonce:fresh.c.nonce,now:at}),true,'the page accepts the new text');
  // A stored challenge whose text carries another statement, signed exactly as stored, is refused and burnt.
  const stored=async statement=>{const b=spread(w),c=await body(await b.post('/api/auth/challenge',{address:a.address}));
    const message=c.message.replace(SIWE_STATEMENT,statement);w.db.raw.prepare('UPDATE login_challenges SET message=? WHERE nonce=?').run(message,c.nonce);
    const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await a.signMessage({message})});return [message,r.status+' '+((await body(r)).error??'ok'),c.nonce];};
  // The wording before F-1 (accepted for one release while challenges issued before that deploy were still open).
  const retired='Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers or transactions.';
  const [old,status,nonce]=await stored(retired);assert.equal(status,'401 SIGNATURE_INVALID','the retired wording no longer verifies');
  assert.notEqual(w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(nonce).invalidated_at,null,'and its challenge is burnt');
  assert.equal(checkSignInMessage(old,{origin:'https://imdember.com',account:a.address,nonce:/Nonce: (\w+)/.exec(old)[1],now:at}),false,'the page signs only the current text');
  for(const statement of ['Sign in to IMD Ember World to access your home for 7 days.','Sign in to IMD Ember World. Approve all transfers.'])
    assert.equal((await stored(statement))[1],'401 SIGNATURE_INVALID',statement);
  // The same path with the current text still signs in (so the 401s above are the statement, not the rewrite).
  assert.equal((await stored(SIWE_STATEMENT))[1],'200 ok');
  assert.equal(sessionCount(w.db),2);
});

test('concurrent verifies of one signature create exactly one session',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();
  const ch=await body(await b.post('/api/auth/challenge',{address:a.address})),signature=await a.signMessage({message:ch.message});
  const results=await Promise.all(Array.from({length:8},()=>w.call(b.request('/api/auth/verify',{method:'POST',body:{nonce:ch.nonce,signature}}))));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409,409,409,409,409,409,409]);
  assert.equal(sessionCount(w.db),1);
  // The UNIQUE nonce is the second lock: a second session for the same challenge is refused by the schema itself.
  assert.throws(()=>w.db.raw.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) VALUES('x','y',1,0,1,?)").run(ch.nonce),/UNIQUE/);
});

test('logout revokes the session server-side, clears both cookies, invalidates open challenges, and is idempotent',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  const stolen=b.jar.get('__Host-imd_session');
  const pending=await body(await b.post('/api/auth/challenge',{address:a.address})),flow=b.jar.get('__Host-imd_flow');
  const out=await b.post('/api/auth/logout');
  assert.equal(out.status,204);
  assert.deepEqual(out.headers.getSetCookie().sort(),['__Host-imd_flow=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0','__Host-imd_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
  // The old cookie replayed by anyone is worthless now.
  const thief=w.browser();thief.jar.set('__Host-imd_session',stolen);
  let r=await thief.get('/api/me/home');assert.equal(r.status,401);assert.equal((await body(r)).error,'AUTH_REQUIRED');
  assert.deepEqual(await body(await thief.get('/api/auth/session')),{signedIn:false});
  thief.jar.set('__Host-imd_flow',flow);
  r=await thief.post('/api/auth/verify',{nonce:pending.nonce,signature:await a.signMessage({message:pending.message})});
  assert.equal(r.status,409,'the challenge open at logout is dead');
  assert.equal((await b.post('/api/auth/logout')).status,204,'idempotent');
  assert.equal((await w.browser().post('/api/auth/logout',{},{headers:{'content-type':'text/plain'}})).status,400,'JSON only (no simple cross-site form)');
});

// F-4 (swarm review 4bd31cfb): logout ended only this browser's session; a cookie left on another device lived 7 days.
test('logout-all: one browser ends every live session of its address on every device, and its open challenges; others are untouched',async()=>{
  const w=setup(),a=newAccount(),other=newAccount(),one=w.browser(),two=w.browser(),stranger=w.browser();
  await one.signIn(a);await two.signIn(a);await stranger.signIn(other);
  const kept=two.jar.get('__Host-imd_session'),pending=await body(await two.post('/api/auth/challenge',{address:a.address}));
  const elsewhere=w.browser(),late=await body(await elsewhere.post('/api/auth/challenge',{address:a.address}));   // a third device, mid sign-in
  const live=()=>w.db.raw.prepare('SELECT address FROM sessions WHERE revoked_at IS NULL').all().map(r=>r.address);
  const mine=await body(await one.post('/api/auth/challenge',{address:newAccount().address}));   // this browser, mid sign-in as someone else
  const open=n=>w.db.raw.prepare('SELECT invalidated_at IS NULL AND used_at IS NULL o FROM login_challenges WHERE nonce=?').get(n).o;
  assert.equal(open(mine.nonce),1);
  const out=await one.post('/api/auth/logout-all');
  assert.equal(open(mine.nonce),0,'this browser\'s own flow challenge, for another address, is cancelled too');
  assert.deepEqual([out.status,await body(out)],[200,{revoked:2}]);
  assert.deepEqual(out.headers.getSetCookie().sort(),['__Host-imd_flow=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0','__Host-imd_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0']);
  assertNoStoreNoCors(out,'logout-all');
  assert.deepEqual(live(),[other.address.toLowerCase()],'only the other address is still signed in');
  // The other device learns it on its next read: signed out, its dead cookie cleared.
  const s=await two.get('/api/auth/session');assert.deepEqual(await body(s),{signedIn:false});assert.equal(two.jar.has('__Host-imd_session'),false);
  const thief=w.browser();thief.jar.set('__Host-imd_session',kept);assert.equal((await thief.get('/api/me/home')).status,401);
  // Challenges for the address that were open at that moment are dead, whoever holds them.
  for(const [b,c] of [[two,pending],[elsewhere,late]]){const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await a.signMessage({message:c.message})});
    assert.deepEqual([r.status,(await body(r)).error],[409,'CHALLENGE_USED']);}
  assert.equal((await stranger.get('/api/me/home')).status,200,'another address is untouched');
  // Signing in again afterwards works, and a new logout-all only ends what is live then.
  assert.equal((await two.signIn(a)).verify.status,200);
  const again=await two.post('/api/auth/logout-all');assert.deepEqual(await body(again),{revoked:1});
});

test('logout-all needs a live session of its own: no, forged, revoked or expired cookies are 401 and end nobody; Origin, JSON and method rules hold; never rate limited',async()=>{
  const w=setup(),a=newAccount(),victim=w.browser();await victim.signIn(a);
  const live=()=>w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL AND expires_at>?').get(w.clock.now()).n;
  const old=w.browser();await old.signIn(a);const oldToken=old.jar.get('__Host-imd_session');await old.post('/api/auth/logout');
  const cases={none:[],forged:['A'.repeat(43)],malformed:['nope'],revoked:[oldToken]};
  for(const [name,[token]] of Object.entries(cases)){
    const b=w.browser();if(token)b.jar.set('__Host-imd_session',token);
    const r=await b.post('/api/auth/logout-all');assert.deepEqual([r.status,(await body(r)).error],[401,'AUTH_REQUIRED'],name);
    assert.equal(live(),1,name+': nobody signed out');
  }
  // A session that ran out cannot end the live one that came after it.
  const expired=w.browser();await expired.signIn(a);w.clock.advance(7*DAY);const fresh=w.browser();await fresh.signIn(a);
  const r=await expired.post('/api/auth/logout-all');assert.deepEqual([r.status,(await body(r)).error],[401,'SESSION_EXPIRED']);
  assert.equal(expired.jar.has('__Host-imd_session'),false,'the dead cookie is cleared');
  assert.equal((await fresh.get('/api/me/home')).status,200);
  // A valid cookie sent from a foreign or missing Origin, or as a simple form post, or with GET, ends nothing.
  for(const origin of [null,'https://evil.example','http://localhost:8792']){
    const x=await fresh.post('/api/auth/logout-all',{},{origin});assert.deepEqual([x.status,(await body(x)).error],[403,'ORIGIN_NOT_ALLOWED'],String(origin));}
  for(const type of ['text/plain','application/x-www-form-urlencoded']){
    const x=await fresh.post('/api/auth/logout-all','{}',{headers:{'content-type':type}});assert.deepEqual([x.status,(await body(x)).error],[400,'BAD_REQUEST'],type);}
  const g=await fresh.get('/api/auth/logout-all');assert.deepEqual([g.status,g.headers.get('allow')],[405,'POST']);
  assert.equal((await fresh.get('/api/me/home')).status,200,'still signed in after every refused attempt');
  // With the sign-in limiter refusing or down it still works.
  for(const binding of [{limit:async()=>({success:false})},{limit:async()=>{throw new Error('binding down');}}]){
    const b=w.browser();await b.signIn(a);w.env.AUTH_LIMITER=binding;
    const x=await b.post('/api/auth/logout-all');assert.equal(x.status,200);assert.equal(live(),0);
    w.env.AUTH_LIMITER={limit:async()=>({success:true})};
  }
});

test('sessions end at 7 days (absolute, no renewal); a dead cookie is cleared',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  w.clock.advance(7*DAY-1);
  assert.equal((await body(await b.get('/api/auth/session'))).signedIn,true);
  assert.equal((await b.get('/api/me/home')).status,200);
  w.clock.advance(1);
  const s=await b.get('/api/auth/session');
  assert.deepEqual(await body(s),{signedIn:false});
  assert.ok(s.headers.getSetCookie().includes('__Host-imd_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'));
  const expired=w.browser();await expired.signIn(a);w.clock.advance(7*DAY);
  const r=await expired.get('/api/me/home');assert.equal(r.status,401);assert.equal((await body(r)).error,'SESSION_EXPIRED');
});

test('only a session opens /api/me: a connected address, a forged cookie or a guessed token gets 401',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();
  assert.equal((await b.get('/api/me/home',{headers:{'x-wallet-address':a.address}})).status,401);
  b.jar.set('__Host-imd_session','A'.repeat(43));assert.equal((await b.get('/api/me/home')).status,401);
  b.jar.set('__Host-imd_session','not a token');assert.equal((await b.get('/api/me/home')).status,401);
});

test('rate limits: sign-in answers 429 when exhausted and fails CLOSED when the binding throws; the read buckets fail open',async()=>{
  const a=newAccount();
  const denied=setup({env:{AUTH_LIMITER:{limit:async()=>({success:false})}}});
  let r=await denied.browser().post('/api/auth/challenge',{address:a.address});assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');
  const broken=setup({env:{AUTH_LIMITER:{limit:async()=>{throw new Error('binding down');}}}});
  for(const path of ['/api/auth/challenge','/api/auth/verify']){r=await broken.browser().post(path,{address:a.address});assert.equal(r.status,429,path);}
  // A session's /api/me/home is limited per session and fails closed too; an anonymous read never reaches that bucket.
  const signedIn=setup(),s=signedIn.browser();await s.signIn(a);signedIn.env.AUTH_LIMITER={limit:async()=>{throw new Error('binding down');}};
  assert.equal((await s.get('/api/me/home')).status,429);assert.equal((await broken.browser().get('/api/me/home')).status,401);
  const keyed=[];const counted=setup({env:{AUTH_LIMITER:{limit:async({key})=>{keyed.push(key);return {success:true};}}}});
  await counted.call(new Request('https://imdember.com/api/auth/challenge',{method:'POST',headers:{origin:'https://imdember.com','content-type':'application/json','cf-connecting-ip':'2001:db8:1:2:3:4:5:6'},body:JSON.stringify({address:a.address})}));
  assert.deepEqual(keyed,['ip6:2001:db8:1:2::/64']);
  const readBroken=setup({env:{API_LIMITER:{limit:async()=>{throw new Error('down');}}}});
  assert.equal((await readBroken.browser().get('/api/auth/session')).status,200);
});

// S3 / M1: POST /api/auth/challenge writes a row without login. A single global budget (120/min) let six addresses of one
// network lock every other player out of sign-in; the budgets now give each network a small share and keep a high valve.
test('challenge budgets: a network gets NETWORK_CHALLENGE_BUDGET a minute, all clients CHALLENGE_BUDGET per 6 s; refusals are 429 SIGN_IN_BUSY and write nothing',async()=>{
  assert.deepEqual([NETWORK_CHALLENGE_BUDGET,NETWORK_WINDOW_MS,CHALLENGE_BUDGET,CHALLENGE_BUDGET_WINDOW_MS,CHALLENGE_BUDGET_NETWORKS],[30,60_000,60,6_000,14]);
  assert.deepEqual([FRESH_NETWORK_RESERVE,FRESH_NETWORKS],[20,200]);
  const w=setup(),a=newAccount();w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const rows=()=>w.db.raw.prepare('SELECT count(*) n FROM login_challenges').get().n;
  const ask=async(ip,b=w.browser())=>{const r=await b.post('/api/auth/challenge',{address:newAccount().address},{headers:{'cf-connecting-ip':ip}});return r.status===200?200:r.status+' '+(await body(r)).error+' '+r.headers.get('retry-after');};
  // (A new address each time.)
  const burst=async(ips,n)=>{const out=[];for(const ip of ips)for(let i=0;i<n;i++)out.push(await ask(ip));return out;};
  // Six addresses of one /24, each at its full AUTH_LIMITER rate: the network's share, not the valve.
  const attack=await burst([1,2,3,4,5,6].map(i=>'203.0.113.'+i),20);
  assert.deepEqual([attack.slice(0,30).every(s=>s===200),[...new Set(attack.slice(30))]],[true,['429 SIGN_IN_BUSY 60']]);assert.equal(rows(),30);
  assert.equal((await w.browser(undefined,undefined,'198.51.100.77').signIn(a)).verify.status,200,'a player elsewhere signs in');
  assert.equal(await ask('203.0.113.200'),'429 SIGN_IN_BUSY 60','the trade-off: a player inside that /24 waits for its minute');
  // IPv6 counts by /48 (in the next 6 s slice; this one already holds 31): another /64 of the same /48 shares it, another /48 does not.
  w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);for(let i=0;i<NETWORK_CHALLENGE_BUDGET;i++)await ask('2001:db8:1:'+(i%10)+'::1');
  assert.deepEqual([await ask('2001:db8:1:ff::9'),await ask('2001:db8:2::9')],['429 SIGN_IN_BUSY 60',200]);
  // The valve: past the minute, two networks bursting on top of one open challenge fill the regular 40: a network that
  // asked in the last minute, like the first browser, is refused, while networks that have not asked get the last 20;
  // then the valve is full for everyone. Nothing refused is written, and the first browser's challenge is not superseded.
  w.clock.advance(NETWORK_WINDOW_MS);
  const before0=rows(),first=w.browser(undefined,undefined,'192.0.2.9'),c0=await body(await first.post('/api/auth/challenge',{address:a.address}));
  const filled=[...await burst(['198.51.100.1','198.51.100.2'],15),...await burst(['203.0.113.1','203.0.113.2'],15)];
  assert.deepEqual([filled.length,filled.filter(s=>s===200).length,rows()-before0],[60,39,40]);
  const before=rows(),again=await first.post('/api/auth/challenge',{address:a.address});assert.deepEqual([again.status,again.headers.getSetCookie().length],[429,0]);
  assert.equal(rows(),before);assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NOT NULL').get().n,0);
  const fresh=[];for(let k=0;k<20;k++)fresh.push(await ask('100.64.'+k+'.1'));
  assert.deepEqual([[...new Set(fresh)],rows()-before0],[[200],60]);
  assert.deepEqual([await ask('100.64.20.1'),rows()-before0],['429 SIGN_IN_BUSY 60',60]);
  assert.equal((await first.post('/api/auth/verify',{nonce:c0.nonce,signature:await a.signMessage({message:c0.message})})).status,200,'sign-in with a challenge already held still works');
  // The valve reopens with the next slice; a network that spent its share still waits for its minute.
  w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);assert.deepEqual([await ask('100.64.0.1'),await ask('198.51.100.3')],[200,'429 SIGN_IN_BUSY 60']);
  // The three counts are range reads of an index (migrations/0002), each capped; the network count runs first.
  const plan=w.db.raw.prepare('EXPLAIN QUERY PLAN '+INSERT_CHALLENGE).all(...Array(8).fill('x'),0,NETWORK_CHALLENGE_BUDGET,0,CHALLENGE_BUDGET,FRESH_NETWORK_RESERVE).map(r=>r.detail).join(' | ');
  assert.match(plan,/SEARCH login_challenges USING COVERING INDEX login_challenges_net \(net=\? AND issued_at>\?\)[\s\S]*SEARCH login_challenges USING COVERING INDEX login_challenges_issued \(issued_at>\?\)[\s\S]*SEARCH login_challenges USING COVERING INDEX login_challenges_net \(net=\? AND issued_at>\?\)/,plan);
});

// F-5 (swarm review 4bd31cfb; remediation v1.0 §5): sign-in limits in layers, so no single place closes sign-in for
// everyone, and one JSON line per refusal or surge that names the layer, an IP-derived network key (IPv4 /24, IPv6 /48)
// and, on a surge, a 6-character address prefix: never a full IP or a full address.
test('F-5: a challenge flood starves neither its own verify nor anyone else; no neighbour can refuse a player\'s challenges; every refusal and surge is one line whose only client details are a network key and, on surges, a 6-character address prefix',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  assert.equal(ADDRESS_SURGE,20);
  const w=setup(),auth=windowLimiter(20,w.clock.now);w.env.AUTH_LIMITER=auth;
  const a=newAccount(),victim=newAccount(),owner=newAccount(),safe='0x'+'5a'.repeat(20);w.chain.state.contracts.set(safe,()=>'0x1626ba7e');
  const ask=async(ip,address)=>{const r=await w.browser(undefined,undefined,ip).post('/api/auth/challenge',{address});return r.status===200?200:r.status+' '+(await body(r)).error;};
  // L4: one IP takes a challenge, then floods past its 20 a minute. Its verify has keys of its own, so it still signs in.
  const flooder=w.browser(undefined,undefined,'203.0.113.7'),c=await body(await flooder.post('/api/auth/challenge',{address:a.address}));
  const flood=[];for(let i=0;i<25;i++)flood.push(await ask('203.0.113.7',newAccount().address));
  assert.deepEqual([flood.filter(x=>x===200).length,[...new Set(flood.filter(x=>x!==200))]],[19,['429 RATE_LIMITED']]);
  assert.equal((await flooder.post('/api/auth/verify',{nonce:c.nonce,signature:await a.signMessage({message:c.message})})).status,200,'verify is not starved');
  assert.ok(auth.keys.includes('verify:ip:203.0.113.7'));
  // L1: the rest of that /24 joins in; it gets its 30 a minute and no more, while players elsewhere sign in (EOA and Safe).
  const more=[];for(let i=1;i<=5;i++)for(let j=0;j<5;j++)more.push(await ask('203.0.113.'+(100+i),newAccount().address));
  assert.deepEqual([more.filter(x=>x===200).length,[...new Set(more.filter(x=>x!==200))]],[10,['429 SIGN_IN_BUSY']]);
  assert.equal((await w.browser(undefined,undefined,'198.51.100.1').signIn(newAccount())).verify.status,200);
  const sb=w.browser(undefined,undefined,'198.51.100.2'),sc=await body(await sb.post('/api/auth/challenge',{address:safe}));
  assert.equal((await sb.post('/api/auth/verify',{nonce:sc.nonce,signature:await owner.signMessage({message:sc.message})})).status,200);
  // No per-wallet cooldown (A-6): a neighbour on 192.0.2.x asking for the victim's address six times is admitted, and the
  // victim still signs in from its own network. (In the next 6 s slice: this one already holds 32 of the 40 that networks
  // which asked in the last minute share, A-7.)
  w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);
  const cool=[];for(let i=0;i<6;i++)cool.push(await ask('192.0.2.'+(i+1),victim.address));
  assert.deepEqual(cool,[200,200,200,200,200,200]);
  assert.equal((await w.browser(undefined,undefined,'198.51.100.3').signIn(victim)).verify.status,200,'the key holder, from another network');
  assert.equal(await ask('192.0.2.9',newAccount().address),200,'the network\'s own budget is not spent');
  // One address asked for from many networks is not blocked, only logged: from the 20th challenge in a minute on, each
  // writes a line (Workers Logs sample 0.2 of invocations, so one line alone would usually be lost).
  w.clock.advance(NETWORK_WINDOW_MS);const surge=[];
  for(let n=0;n<5;n++){w.clock.advance(1000);for(let i=0;i<(n<4?5:1);i++)surge.push(await ask('100.64.'+n+'.'+(i+1),victim.address));}
  assert.deepEqual([...new Set(surge)],[200],'21 challenges for one address from five networks: none refused');
  assert.equal((await w.browser(undefined,undefined,'100.65.0.1').signIn(victim)).verify.status,200);
  // Two checks of one contract a minute from anywhere, then each network's own one: past both, a check is refused, and its
  // line says why and that it is a contract.
  for(const ip of ['192.0.2.50','192.0.3.50','192.0.4.51']){const b=w.browser(undefined,undefined,ip),x=await body(await b.post('/api/auth/challenge',{address:safe}));
    await b.post('/api/auth/verify',{nonce:x.nonce,signature:randomSignature()});}
  const held=w.browser(undefined,undefined,'192.0.4.50'),hc=await body(await held.post('/api/auth/challenge',{address:safe}));
  const hr=held.request('/api/auth/verify',{method:'POST',body:{nonce:hc.nonce,signature:await owner.signMessage({message:hc.message})}});Object.defineProperty(hr,'cf',{value:{colo:'NRT'}});
  assert.equal((await held.keep(await w.call(hr))).status,429);
  w.clock.advance(NETWORK_WINDOW_MS);delete w.env.CHAIN_LIMITER;const gone=w.browser(undefined,undefined,'192.0.5.50'),gc=await body(await gone.post('/api/auth/challenge',{address:safe}));
  assert.equal((await gone.post('/api/auth/verify',{nonce:gc.nonce,signature:await owner.signMessage({message:gc.message})})).status,503);
  // The lines: one per refusal (6 + 15 + 1 + 1), one per surge challenge (the 20th, 21st and the victim's own 22nd);
  // only these fields: the IP-derived network key (never the full IP), the surge line's 6-character address prefix (never
  // the full address), and no token, signature or message.
  const logged=lines.map(l=>JSON.parse(l)),by=(evt,reason)=>logged.filter(l=>l.evt===evt&&l.reason===reason);
  for(const l of logged)assert.deepEqual(Object.keys(l).filter(k=>!['evt','route','status','error','reason','colo','net','walletType','addr'].includes(k)),[],JSON.stringify(l));
  assert.deepEqual(logged.map(l=>l.evt+' '+l.reason).sort(),[...Array(6).fill('auth_refused auth'),...Array(15).fill('auth_refused network'),
    'auth_refused address','auth_refused missing:CHAIN_LIMITER',...Array(3).fill('auth_surge address_surge')].sort());
  assert.deepEqual(by('auth_surge','address_surge').map(l=>l.net),['net:100.64.3.0/24','net:100.64.4.0/24','net:100.65.0.0/24']);
  assert.deepEqual(by('auth_refused','auth')[0],{evt:'auth_refused',route:'/api/auth/challenge',status:429,error:'RATE_LIMITED',reason:'auth',colo:null,net:'net:203.0.113.0/24'});
  assert.deepEqual(by('auth_surge','address_surge')[0],{evt:'auth_surge',route:'/api/auth/challenge',reason:'address_surge',addr:victim.address.toLowerCase().slice(0,6),colo:null,net:'net:100.64.3.0/24'});
  assert.deepEqual(by('auth_refused','address')[0],{evt:'auth_refused',route:'/api/auth/verify',status:429,error:'CHAIN_BUSY',reason:'address',walletType:'CONTRACT',colo:'NRT',net:'net:192.0.4.0/24'});
  assert.deepEqual(by('auth_refused','missing:CHAIN_LIMITER')[0],{evt:'auth_refused',route:'/api/auth/verify',status:503,error:'LIMITER_UNAVAILABLE',reason:'missing:CHAIN_LIMITER',colo:null,net:'net:192.0.5.0/24'});
  const text=lines.join('\n').toLowerCase();
  for(const secret of [a.address,victim.address,owner.address,safe,flooder.jar.get('__Host-imd_session'),'sign in to','nonce'])assert.ok(!text.includes(String(secret).toLowerCase()),'logged: '+secret);
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.(?!0\/24)\d{1,3}\b/.test(text),'a full IPv4 address was logged');
});

// W-2 (Swarm retest e48d0a96): what a refusal line says about the client, stated exactly in README, DESIGN_W1 §15 and the
// audit status: an IP-derived network key (IPv4 /24, IPv6 /48) and, on surge lines only, a 6-character address prefix.
test('W-2: an IPv6 client\'s refusal line carries its /48 network key and nothing longer of its IP; the surge prefix is 6 characters',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const w=setup();w.env.AUTH_LIMITER=windowLimiter(1,w.clock.now);
  const ip='2001:db8:1:2:3:4:5:6',b=w.browser(undefined,undefined,ip);
  assert.equal((await b.post('/api/auth/challenge',{address:newAccount().address})).status,200);
  assert.equal((await b.post('/api/auth/challenge',{address:newAccount().address})).status,429);
  assert.deepEqual(lines.map(l=>JSON.parse(l)),[{evt:'auth_refused',route:'/api/auth/challenge',status:429,error:'RATE_LIMITED',reason:'auth',colo:null,net:'net6:2001:db8:1::/48'}]);
  assert.ok(!lines.join('\n').includes('2001:db8:1:2'),'more than the /48 was logged');
  // A surge line: from the 20th challenge for one address within a minute (any networks), `addr` is its first 6 characters.
  w.env.AUTH_LIMITER={limit:async()=>({success:true})};const victim=newAccount().address;lines.length=0;
  for(let n=0;n<20;n++)assert.equal((await w.browser(undefined,undefined,'100.64.'+n+'.1').post('/api/auth/challenge',{address:victim})).status,200);
  const surge=lines.map(l=>JSON.parse(l)).filter(l=>l.evt==='auth_surge');
  assert.deepEqual(surge.map(l=>[l.addr,l.net]),[[victim.toLowerCase().slice(0,6),'net:100.64.19.0/24']]);assert.equal(surge[0].addr.length,6);
});

/** A POST whose body arrives in two parts: all but its last byte now, the last when the returned function is called
 *  (which resolves to the response). When this returns, the handler is waiting for the rest of the body. */
const held=async(b,path,obj)=>{let ctl;const stream=new ReadableStream({start(c){ctl=c;}}),text=JSON.stringify(obj),enc=new TextEncoder();
  ctl.enqueue(enc.encode(text.slice(0,-1)));const q=b.request(path,{method:'POST',body:obj});
  const done=b.send(new Request(q.url,{method:'POST',headers:q.headers,body:stream,duplex:'half'})).then(r=>b.keep(r));
  await new Promise(r=>setImmediate(r));
  return async()=>{ctl.enqueue(enc.encode('}'));ctl.close();return done;};};
// A-5 (Swarm audit 519db624): the clock was read when the request began, so bodies held open and finished together
// dated their D1 claims into earlier minutes, and a verify begun before its challenge's end passed the expiry check.
test('A-5: a challenge or verify whose body arrives late is counted when it arrives, and the contract check after its code read',async()=>{
  const said=async r=>r.status+' '+((await body(r)).error??'ok'),A='0x'+'22'.repeat(20),B='0x'+'33'.repeat(20);
  const reads=(x,m)=>x.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL&&JSON.parse(c.body).method===m).length;
  // (a) One /24 holds three contract verifies from T and three from T+60 s, and finishes all six at T+70 s: that is one
  // minute's three contract checks, not two minutes' six.
  const w=setup();for(const c of [A,B])w.chain.state.contracts.set(c,()=>'0xffffffff');
  const start=async()=>{const out=[];for(const address of [A,A,B]){const b=w.browser(undefined,undefined,'203.0.113.9'),c=await body(await b.post('/api/auth/challenge',{address}));
    out.push(await held(b,'/api/auth/verify',{nonce:c.nonce,signature:'0x00'}));}return out;};
  const pending=await start();w.clock.advance(NETWORK_WINDOW_MS);pending.push(...await start());w.clock.advance(10_000);
  const out=[];for(const finish of pending)out.push(await said(await finish()));
  assert.deepEqual([out,reads(w,'eth_call')],[[...Array(3).fill('401 SIGNATURE_INVALID'),...Array(3).fill('429 CHAIN_BUSY')],3]);
  assert.deepEqual(w.db.raw.prepare('SELECT checked_at,called_at FROM login_challenges ORDER BY rowid').all().map(r=>[r.checked_at,r.called_at]),
    [...Array(3).fill([START+70_000,START+70_000]),...Array(3).fill([START+70_000,null])],'every claim and check is dated when its body arrived');
  // (b) A verify begun a second before its challenge ends and finished 30 s after is expired: no chain read.
  const x=setup();x.chain.state.contracts.set(A,()=>'0xffffffff');
  const xb=x.browser(undefined,undefined,'198.51.100.9'),xc=await body(await xb.post('/api/auth/challenge',{address:A}));
  x.clock.advance(299_000);const late=await held(xb,'/api/auth/verify',{nonce:xc.nonce,signature:'0x00'});x.clock.advance(31_000);
  assert.deepEqual([await said(await late()),reads(x,'eth_getCode'),reads(x,'eth_call')],['410 CHALLENGE_EXPIRED',0,0]);
  // (c) Thirty challenges from one /24 held from T and finished at T+70 s are dated T+70 s (row and message alike), so
  // they are that minute's thirty and the next one from the /24 waits.
  const y=setup(),waiting=[];
  for(let i=0;i<NETWORK_CHALLENGE_BUDGET;i++)waiting.push(await held(y.browser(undefined,undefined,'203.0.113.'+(i+1)),'/api/auth/challenge',{address:newAccount().address}));
  y.clock.advance(70_000);const dated=[];
  for(const finish of waiting){const r=await finish(),c=await body(r);assert.equal(r.status,200);
    dated.push(y.db.raw.prepare('SELECT issued_at FROM login_challenges WHERE nonce=?').get(c.nonce).issued_at,parseSiweMessage(c.message).issuedAt.getTime());}
  assert.deepEqual([...new Set(dated)],[START+70_000]);
  assert.equal(await said(await y.browser(undefined,undefined,'203.0.113.99').post('/api/auth/challenge',{address:newAccount().address})),'429 SIGN_IN_BUSY');
  // (d) eth_getCode takes 10 s: the contract check is dated after it, not when the verify began.
  const z=setup(),owner=newAccount(),safe='0x'+'5a'.repeat(20);z.chain.state.contracts.set(safe,()=>'0x1626ba7e');
  z.chain.state.intercept=m=>{if(m==='eth_getCode')z.clock.advance(10_000);};
  const zb=z.browser(undefined,undefined,'192.0.2.9'),zc=await body(await zb.post('/api/auth/challenge',{address:safe}));
  assert.equal(await said(await zb.post('/api/auth/verify',{nonce:zc.nonce,signature:await owner.signMessage({message:zc.message})})),'200 ok');
  const row=z.db.raw.prepare('SELECT checked_at,called_at FROM login_challenges WHERE nonce=?').get(zc.nonce);
  assert.deepEqual([row.checked_at,row.called_at],[START,START+10_000]);
});

// A-1 (Swarm audit 519db624, Medium; the F-3 residual): a contract address's 2 checks a minute were shared by every
// network, so two garbage verifies a minute from anywhere held a chosen smart wallet at 429 CHAIN_BUSY.
test('A-1: garbage from a few other networks no longer holds a chosen smart wallet; its own network keeps one check of it a minute until the lane key (20 a minute per location) is spent, and the shared keys still see at most two checks per address',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const w=setup(),chain=windowLimiter(20,w.clock.now);w.env.CHAIN_LIMITER=chain;w.env.API_LIMITER=windowLimiter(180,w.clock.now);w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  // The contracts answer the magic word only for signatures their owner really made, 0xffffffff for anything else.
  const owner=newAccount(),genuine=new Set(),C='0x'+'5a'.repeat(20),C2='0x'+'5c'.repeat(20),S2='0x'+'5b'.repeat(20);
  for(const a of [C,C2,S2])w.chain.state.contracts.set(a,(hash,signature)=>genuine.has(signature.toLowerCase())?'0x1626ba7e':'0xffffffff');
  const signed=async m=>{const s=await owner.signMessage({message:m});genuine.add(s.toLowerCase());return s;};
  const attempt=async(ip,address,sign=()=>'0x12')=>{const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address}));
    lines.length=0;const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});
    return r.status+' '+((await body(r)).error??'ok')+(r.status===429?' '+JSON.parse(lines.at(-1)).reason:'');};
  const count=k=>chain.keys.filter(x=>x===k).length,next=()=>w.clock.advance(NETWORK_WINDOW_MS+1),no='401 SIGNATURE_INVALID';
  // (a) The judge's repro. C and S2 signed in before (both "known"). Every minute two garbage verifies from 203.0.113.9
  // spend C's two shared checks; the owner, on its own network, still signs in with that network's own check of C.
  assert.deepEqual([await attempt('198.51.100.20',C,signed),await attempt('198.51.100.30',S2,signed)],['200 ok','200 ok']);next();
  for(let i=0;i<3;i++){const lane=count('chain:erc1271:lane');
    assert.deepEqual([await attempt('203.0.113.9',C),await attempt('203.0.113.9',C),await attempt('198.51.100.20',C,signed),count('chain:erc1271:lane')-lane],[no,no,'200 ok',1],'minute '+i);next();}
  // The same for a contract signing in here for the first time.
  assert.deepEqual([await attempt('203.0.113.10',C2),await attempt('203.0.113.10',C2),await attempt('198.51.100.21',C2,signed)],[no,no,'200 ok']);next();
  // (b) Round 1's guard stands: ten /24s, two garbage verifies each at C, reach the shared key twice and the lane once
  // per network (nine), the rest wait (reason 'address'), and another returning smart wallet signs in.
  const known=count('chain:erc1271:known'),lanes=count('chain:erc1271:lane'),ten=[];
  for(let k=0;k<10;k++)for(let j=0;j<2;j++)ten.push(await attempt('100.64.'+k+'.9',C));
  assert.deepEqual([count('chain:erc1271:known')-known,count('chain:erc1271:lane')-lanes,ten.filter(x=>x===no).length,ten.filter(x=>x==='429 CHAIN_BUSY address').length],[2,9,11,9]);
  assert.equal(await attempt('192.0.2.30',S2,signed),'200 ok');next();
  // (c) The lanes share one per-location key (20 a minute): with C's shared checks spent, 20 /24s take it and the 21st
  // network waits (reason 'budget_lane'), the owner's too. The documented residual.
  assert.deepEqual([await attempt('203.0.113.9',C),await attempt('203.0.113.9',C)],[no,no]);
  const many=[];for(let k=0;k<21;k++)many.push(await attempt('100.65.'+k+'.9',C));
  assert.deepEqual([many.slice(0,20).every(x=>x===no),many[20],await attempt('198.51.100.20',C,signed)],[true,'429 CHAIN_BUSY budget_lane','429 CHAIN_BUSY budget_lane']);next();
  // (d) Garbage from the owner's own /24 spends that network's check of C: the owner waits (reason 'address').
  assert.deepEqual([await attempt('203.0.113.9',C),await attempt('203.0.113.9',C),await attempt('198.51.100.21',C),await attempt('198.51.100.20',C,signed)],
    [no,no,no,'429 CHAIN_BUSY address']);next();
  // (f) The lane is per (network, address): the owner's /24 checking another smart wallet this minute leaves its check of C.
  assert.deepEqual([await attempt('198.51.100.30',S2,signed),await attempt('203.0.113.9',C),await attempt('203.0.113.9',C),await attempt('198.51.100.20',C,signed)],
    ['200 ok',no,no,'200 ok']);
  // (e) The lane counts the network's checks of the minute on the partial index (at most ERC1271_NETWORK_SHARE entries)
  // and looks for the address only on those rows (+address), never through the address index.
  const plan=w.db.raw.prepare('EXPLAIN QUERY PLAN '+CLAIM_LANE).all(1,'n','net',0,3,'a').map(r=>r.detail).join(' | ');
  assert.match(plan,/COVERING INDEX login_challenges_called_net \(net=\? AND called_at>\?\)[\s\S]*SEARCH login_challenges USING INDEX login_challenges_called_net \(net=\? AND called_at>\?\)/,plan);
});

// A-1's residual at its stated cost (the site's A-1 line: "at least 9 /24s aimed at 3 or more addresses every minute at
// one location"), run as a schedule: each /24 aims one garbage verify at each target, with the shared shares and the
// location's lane key (20 a minute) as production has them.
test('A-1: the residual at its stated cost: 9 /24s aiming garbage at 3 smart wallets every minute keep one of them out at a location; 8 /24s, or 9 at 2 wallets, do not',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const w=setup();w.env.CHAIN_LIMITER=windowLimiter(20,w.clock.now);w.env.API_LIMITER=windowLimiter(180,w.clock.now);w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const owner=newAccount(),genuine=new Set(),[C,C2,S2]=['0x'+'5a'.repeat(20),'0x'+'5c'.repeat(20),'0x'+'5b'.repeat(20)];
  for(const a of [C,C2,S2])w.chain.state.contracts.set(a,(hash,signature)=>genuine.has(signature.toLowerCase())?'0x1626ba7e':'0xffffffff');
  const signed=async m=>{const s=await owner.signMessage({message:m});genuine.add(s.toLowerCase());return s;};
  const attempt=async(ip,address,sign=()=>'0x12')=>{const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address}));
    lines.length=0;const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});
    return r.status+' '+((await body(r)).error??'ok')+(r.status===429?' '+JSON.parse(lines.at(-1)).reason:'');};
  // The three wallets signed in here before (each is "known"); then, each minute, one schedule and the owner of C.
  for(const [ip,a] of [['198.51.100.20',C],['198.51.100.30',C2],['198.51.100.40',S2]])assert.equal(await attempt(ip,a,signed),'200 ok');
  const siege=async(nets,targets,prefix)=>{w.clock.advance(NETWORK_WINDOW_MS+1);const got=[];
    for(let k=0;k<nets;k++)for(const a of targets)got.push(await attempt(prefix+k+'.9',a));
    return [got.filter(x=>x==='401 SIGNATURE_INVALID').length,got.filter(x=>x==='429 CHAIN_BUSY budget_lane').length,got.length,await attempt('198.51.100.20',C,signed)];};
  // 9 /24s at 3 wallets: the first two spend the wallets' 6 shared checks, the next seven take the location's 20 lane
  // checks (the 21st waits), and C's owner, on its own network, waits too.
  assert.deepEqual(await siege(9,[C,C2,S2],'100.66.'),[26,1,27,'429 CHAIN_BUSY budget_lane'],'9 /24s at 3 wallets hold the owner');
  assert.deepEqual(await siege(8,[C,C2,S2],'100.67.'),[24,0,24,'200 ok'],'8 /24s leave the owner a lane check');
  assert.deepEqual(await siege(9,[C,C2],'100.68.'),[18,0,18,'200 ok'],'and so do 9 /24s at 2 wallets');
});

// A-6 (Swarm audit 519db624): the per-(address, network) cooldown counted every challenge naming the address from the
// /24, whoever asked, so a neighbour's five unsigned challenges a minute kept a player from starting a sign-in.
test('A-6: a neighbour\'s challenges for a player\'s address never refuse that player; the /24 share stays the only network limit',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const w=setup(),V=newAccount();w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const ask=async(ip,address)=>{lines.length=0;const r=await w.browser(undefined,undefined,ip).post('/api/auth/challenge',{address});
    return r.status===200?200:r.status+' '+(await body(r)).error+' '+JSON.parse(lines.at(-1)).reason;};
  // Every minute a neighbour on 203.0.113.x asks for V's address five times; V, on the same /24, still signs in.
  for(let i=0;i<3;i++){
    const junk=[];for(let j=0;j<5;j++)junk.push(await ask('203.0.113.5',V.address));
    const player=w.browser(undefined,undefined,'203.0.113.77'),r=await player.post('/api/auth/challenge',{address:V.address}),c=await body(r);
    const signedIn=r.status===200&&(await player.post('/api/auth/verify',{nonce:c.nonce,signature:await V.signMessage({message:c.message})})).status;
    assert.deepEqual([junk,r.status===200?200:r.status+' '+c.error+' '+JSON.parse(lines.at(-1)).reason,signedIn],[Array(5).fill(200),200,200],'minute '+i);
    w.clock.advance(NETWORK_WINDOW_MS+1);}
  // The residual: two IPs of one /24 spend its 30 a minute, and everyone else there waits for the minute (D1 counts by
  // network key only; no full IP is stored).
  const spent=[];for(const ip of ['192.0.2.5','192.0.2.6'])for(let j=0;j<15;j++)spent.push(await ask(ip,newAccount().address));
  assert.deepEqual([spent.every(x=>x===200),await ask('192.0.2.77',V.address)],[true,'429 SIGN_IN_BUSY network']);
});

// A-7 (Swarm audit 519db624): the valve (60 per 6 s) admitted first come first served, so 20 /24s at their full share
// (two IPs each) kept every new sign-in out, even from a network that had not asked at all.
test('A-7: while 20 networks keep the valve full, a network that has not asked in the last minute still gets its challenge',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const w=setup();w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const ask=async(ip,at)=>{w.clock.set(at);const address='0x'+Buffer.from(crypto.getRandomValues(new Uint8Array(20))).toString('hex');
    const r=await w.browser(undefined,undefined,ip).post('/api/auth/challenge',{address});return r.status===200?200:r.status+' '+(await body(r)).error+' '+r.headers.get('retry-after');};
  // The judge's schedule: 10 challenges a second for 90 s from 20 /24s (two IPs each, 15 a minute per IP, 30 per /24).
  // Every 5 s once the valve is full, a player from a /24 that has not asked; ten seconds after the first, a second
  // player from that first player's /24, which has asked within the minute now.
  const probes=[];let again,line;
  for(let i=0;i<900;i++){
    await ask('203.0.'+(i%20)+'.'+(1+Math.floor(i/20)%2),START+i*100);
    if(i>=60&&i%50===0)probes.push(await ask('198.51.'+(100+probes.length)+'.9',START+i*100+1));
    if(i===200){again=await ask('198.51.100.10',START+i*100+1);line=JSON.parse(lines.at(-1));}
  }
  assert.deepEqual([probes.length,[...new Set(probes)]],[16,[200]]);
  assert.equal(again,'429 SIGN_IN_BUSY 60','a network that already asked waits while the valve is full');
  // Its line names the valve, not its network's share (one challenge from that /24 so far): the attack's sign in the logs.
  assert.deepEqual(line,{evt:'auth_refused',route:'/api/auth/challenge',status:429,error:'SIGN_IN_BUSY',reason:'global',colo:null,net:'net:198.51.100.0/24'});
  // The valve still holds: no 6 s window holds more than 60 challenges.
  const most=w.db.raw.prepare('SELECT max((SELECT count(*) FROM login_challenges b WHERE b.issued_at>a.issued_at-6000 AND b.issued_at<=a.issued_at)) n FROM login_challenges a').get().n;
  assert.ok(most<=60,'at most 60 in a 6 s window: '+most);
  // The residual's stated cost (the site's A-7 line): 14 /24s at full share (two IPs each, 3 challenges a slice, at most 30
  // a minute) plus 20 networks asking once per 6 s slice (about 200 a minute), timed so the /24s fill the valve's regular 40
  // and the new networks its reserved 20, keep out a network that has not asked, for as long as they go on (11 slices,
  // over a minute). One /24 fewer, or one new network fewer a slice, and it gets its challenge.
  const siege=async(busy,fresh,slices)=>{const v=setup();v.env.AUTH_LIMITER=windowLimiter(20,v.clock.now);let n=0;
    const at=async(ip,ms)=>{v.clock.set(ms);const address='0x'+Buffer.from(crypto.getRandomValues(new Uint8Array(20))).toString('hex');
      const r=await v.browser(undefined,undefined,ip).post('/api/auth/challenge',{address});return r.status===200?200:r.status+' '+(await body(r)).error;};
    const probes=[];
    for(let s=0;s<slices;s++){const t0=START+s*6_200;
      for(let j=0;j<3*busy;j++)await at('203.0.'+(j+s)%busy+'.'+(1+s%2),t0+j);
      for(let j=0;j<fresh;j++,n++)await at('10.0.'+n+'.1',t0+50+j);
      if(s>0)probes.push(await at('198.51.'+(100+s)+'.9',t0+3_000));
    }
    return [...new Set(probes)];};
  assert.deepEqual(await siege(14,20,11),['429 SIGN_IN_BUSY'],'14 /24s and 20 new networks a slice keep it out');
  assert.deepEqual(await siege(13,20,4),[200],'13 /24s do not');
  assert.deepEqual(await siege(14,19,4),[200],'nor do 19 new networks a slice');
});

// M2: a refused ERC-1271 budget left the challenge open, so one challenge could ask the per-location budget again and
// again, and one or two IPs could hold a location's smart-wallet sign-ins at zero with garbage signatures. F-3 split the
// one per-network share into the steps below, each asked before the read it pays for.
test('ERC-1271 shares: a network gets ERC1271_CODE_SHARE claims and ERC1271_NETWORK_SHARE contract checks a minute, a contract address ERC1271_ADDRESS_SHARE and then one check per network; past any, 429 CHAIN_BUSY, nothing more read, the challenge burnt',async()=>{
  assert.deepEqual([ERC1271_CODE_SHARE,ERC1271_NETWORK_SHARE,ERC1271_ADDRESS_SHARE,CODE_CAP],[10,3,2,180]);
  const keys=[];const w=setup({env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}}}});
  const owner=newAccount(),contracts=Array.from({length:6},(_,i)=>'0x'+(0xa0+i).toString(16).repeat(20));
  for(const a of contracts)w.chain.state.contracts.set(a,()=>'0xffffffff');
  const reads=m=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL&&JSON.parse(c.body).method===m).length,signed=m=>owner.signMessage({message:m});
  const check=async(ip,address,sign=()=>randomSignature())=>{
    const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address}));
    const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});return {b,c,r:r.status+' '+((await body(r)).error??'ok')};};
  // The network's contract checks: three contracts from one /24, then the fourth waits (its code was read, nothing called).
  const out=[];for(let i=0;i<4;i++)out.push((await check('203.0.113.'+(i+1),contracts[i])).r);
  assert.deepEqual(out,['401 SIGNATURE_INVALID','401 SIGNATURE_INVALID','401 SIGNATURE_INVALID','429 CHAIN_BUSY']);
  assert.deepEqual([keys.length,reads('eth_getCode'),reads('eth_call')],[3,4,3]);
  w.chain.state.contracts.set(contracts[4],()=>'0x1626ba7e');const {b,c,r}=await check('203.0.113.5',contracts[4],signed);
  assert.equal(r,'429 CHAIN_BUSY','the share is per network, whatever the signature');
  const retry=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await signed(c.message)});
  assert.deepEqual([retry.status,(await body(retry)).error,keys.length,reads('eth_call')],[409,'CHALLENGE_USED',3,3],'burnt: no second try against the budget');
  assert.equal((await check('198.51.100.7',contracts[4],signed)).r,'200 ok','another network is untouched');
  // The address's contract checks, counted over every network: contracts[5] twice from two networks, then a third network
  // gets the one check of its own.
  for(const ip of ['192.0.2.1','192.0.3.1'])assert.equal((await check(ip,contracts[5])).r,'401 SIGNATURE_INVALID');
  w.chain.state.contracts.set(contracts[5],()=>'0x1626ba7e');
  assert.deepEqual([(await check('100.64.0.1',contracts[5],signed)).r,reads('eth_call')],['200 ok',7],'the owner of a contract under garbage from elsewhere keeps its own network\'s check');
  assert.equal((await check('100.64.0.2',contracts[4],signed)).r,'200 ok','another contract from the same network does not');
  // The network's claims: ten garbage verifies for EOAs from one /24 read ten codes; the eleventh reads nothing.
  const eoa=[];for(let i=0;i<11;i++)eoa.push((await check('198.18.0.'+(i+1),newAccount().address)).r);
  assert.deepEqual([eoa.slice(0,10).every(x=>x==='401 SIGNATURE_INVALID'),eoa[10],reads('eth_getCode')],[true,'429 CHAIN_BUSY',19]);
  // After their minute every share is back.
  w.clock.advance(NETWORK_WINDOW_MS);
  assert.deepEqual([(await check('203.0.113.6',contracts[5],signed)).r,(await check('198.18.0.99',newAccount().address)).r],['200 ok','401 SIGNATURE_INVALID']);
  // Both contract counts read only the partial indexes of checked contracts (migrations/0003), never the challenges at large.
  const plan=w.db.raw.prepare('EXPLAIN QUERY PLAN '+CLAIM_CONTRACT).all(1,'n','net',0,3,'a',2).map(r=>r.detail).join(' | ');
  assert.match(plan,/COVERING INDEX login_challenges_called_net \(net=\? AND called_at>\?\)[\s\S]*COVERING INDEX login_challenges_called_address \(address=\? AND called_at>\?\)/,plan);
});

// F-3 (swarm review 4bd31cfb, probe P3): any non-ECDSA signature, even for an EOA, spent the per-location chain:erc1271
// budget before eth_getCode, so 7 /24s x 3 garbage verifies (20 reached the limiter) left a real smart wallet 429 CHAIN_BUSY.
test('P3: garbage signatures for EOAs from 7 /24s never reach chain:erc1271, so a smart wallet still signs in; a no-code answer is cached briefly',async()=>{
  assert.equal(NO_CODE_TTL_MS,60_000,'brief: a newly delegated or deployed account waits at most a minute');
  const w=setup(),limiter=windowLimiter(20,w.clock.now);w.env.CHAIN_LIMITER=limiter;
  const owner=newAccount(),safe='0x'+'5a'.repeat(20);w.chain.state.contracts.set(safe,()=>'0x1626ba7e');
  const reads=m=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL&&JSON.parse(c.body).method===m).length;
  const attempt=async(ip,address,sign=()=>randomSignature())=>{const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address}));
    const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});return {nonce:c.nonce,r:r.status+' '+((await body(r)).error??'ok')};};
  const out=[];for(let n=1;n<=7;n++)for(let i=0;i<3;i++)out.push((await attempt('203.0.'+n+'.9',newAccount().address)).r);
  assert.deepEqual([...new Set(out)],['401 SIGNATURE_INVALID']);
  assert.deepEqual([limiter.keys.length,reads('eth_getCode'),reads('eth_call')],[0,21,0],'one code read per challenge, none of the location budget');
  assert.equal((await attempt('198.51.100.20',safe,m=>owner.signMessage({message:m}))).r,'200 ok','the smart wallet signs in');
  assert.deepEqual([limiter.keys,reads('eth_getCode')],[['chain:erc1271'],22]);
  // Hammering one EOA: its first answer is kept, so later garbage costs no keyed read and no claim of the network's share (four more).
  const eoa=newAccount().address,first=await attempt('192.0.2.9',eoa),later=[];for(let i=0;i<4;i++)later.push(await attempt('192.0.2.9',eoa));
  const claimed=nonce=>w.db.raw.prepare('SELECT checked_at FROM login_challenges WHERE nonce=?').get(nonce).checked_at;
  assert.deepEqual([first.r,claimed(first.nonce),reads('eth_getCode')],['401 SIGNATURE_INVALID',START,23]);
  assert.deepEqual([[...new Set(later.map(x=>x.r))],later.map(x=>claimed(x.nonce)).filter(v=>v!==null).length,reads('eth_getCode')],[['401 SIGNATURE_INVALID'],0,23]);
  // ...only briefly: past NO_CODE_TTL_MS the address is read again (it may have gained code: a 7702 delegation).
  w.clock.advance(NO_CODE_TTL_MS);assert.equal((await attempt('192.0.2.9',eoa)).r,'401 SIGNATURE_INVALID');assert.equal(reads('eth_getCode'),24);
  w.chain.state.contracts.set(eoa.toLowerCase(),()=>'0x1626ba7e');w.chain.state.code.set(eoa.toLowerCase(),'0xef0100'+'12'.repeat(20));
  w.clock.advance(NO_CODE_TTL_MS);assert.equal((await attempt('192.0.2.10',eoa,m=>owner.signMessage({message:m}))).r,'200 ok','delegated since: signs in');
});

// F-3 (swarm review 4bd31cfb; remediation v1.0 acceptance 1-4). Round 1 left open that garbage aimed at real contract
// addresses (any Safe) spends chain:erc1271, so 7 /24s closed every smart-wallet sign-in at a location for a minute.
test('F-3: a /24\'s garbage leaves its other wallets alone, fake addresses never reach the contract budget, returning smart wallets keep a budget of their own, EOAs never wait',async()=>{
  const w=setup(),chain=windowLimiter(20,w.clock.now),api=windowLimiter(180,w.clock.now);w.env.CHAIN_LIMITER=chain;w.env.API_LIMITER=api;
  const owner=newAccount(),safe='0x'+'5a'.repeat(20),baits=Array.from({length:11},(_,i)=>'0x'+(0xb0+i).toString(16).repeat(20));
  const firstTime=Array.from({length:4},(_,i)=>'0x'+(0xc0+i).toString(16).repeat(20));
  for(const a of [safe,...firstTime])w.chain.state.contracts.set(a,()=>'0x1626ba7e');for(const a of baits)w.chain.state.contracts.set(a,()=>'0xffffffff');
  const attempt=async(ip,address,sign=()=>randomSignature())=>{const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address}));
    const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});return r.status+' '+((await body(r)).error??'ok');};
  const signed=m=>owner.signMessage({message:m}),count=(keys,k)=>keys.filter(x=>x===k).length;
  const reads=m=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL&&JSON.parse(c.body).method===m).length;
  assert.equal(await attempt('192.0.2.1',safe,signed),'200 ok','the Safe signed in last week (its session is kept)');
  assert.deepEqual(chain.keys,['chain:erc1271']);w.clock.advance(NETWORK_WINDOW_MS);
  // (1) One /24's garbage leaves its other wallets alone. Garbage for EOAs (eight here) spends only its code reads: the
  // returning Safe and a first-time smart wallet from it still sign in.
  const eoaJunk=[];for(let i=0;i<8;i++)eoaJunk.push(await attempt('203.0.113.'+(10+i),newAccount().address));
  assert.deepEqual([[...new Set(eoaJunk)],await attempt('203.0.113.30',safe,signed),await attempt('203.0.113.31',firstTime[0],signed)],[['401 SIGNATURE_INVALID'],'200 ok','200 ok']);
  // Its ten code reads are spent now: a first-time smart wallet from it waits, the returning Safe (no code read) does not.
  assert.deepEqual([await attempt('203.0.113.40',firstTime[2],signed),await attempt('203.0.113.41',safe,signed)],['429 CHAIN_BUSY','200 ok']);
  // In another /24, garbage at one contract (four tries) is held at that contract's 2 a minute, so another smart wallet of it
  // still gets a check, and its EOAs never needed one.
  const oneBait=[];for(let i=0;i<4;i++)oneBait.push(await attempt('192.0.2.'+(20+i),baits[0]));
  assert.deepEqual(oneBait,['401 SIGNATURE_INVALID','401 SIGNATURE_INVALID','429 CHAIN_BUSY','429 CHAIN_BUSY']);
  assert.deepEqual([await attempt('192.0.2.31',firstTime[3],signed),(await w.browser(undefined,undefined,'192.0.2.32').signIn(newAccount())).verify.status],['200 ok',200]);
  // (2) Many made-up addresses from many networks: sixty garbage verifies (twenty /24s, over twenty seconds) read sixty
  // codes (the 'chain:code' cap) and never reach chain:erc1271.
  const before=[chain.keys.length,count(api.keys,'chain:code')],out=[];
  for(let n=0;n<20;n++){w.clock.advance(1000);for(let i=0;i<3;i++)out.push(await attempt('198.18.'+n+'.'+(i+1),newAccount().address));}   // under the valve
  assert.deepEqual([[...new Set(out)],chain.keys.length-before[0],count(api.keys,'chain:code')-before[1]],[['401 SIGNATURE_INVALID'],0,60]);
  // Real contracts as bait: 7 /24s x 3 garbage checks spread over 11 contracts close the first-time budget for the minute
  // (the residual, now needing 10+ contracts), but not the returning Safe's, and never an EOA.
  w.clock.advance(NETWORK_WINDOW_MS);const bait=[],codes=reads('eth_getCode');
  for(let k=0;k<21;k++)bait.push(await attempt('100.64.'+Math.floor(k/3)+'.9',baits[k%11]));
  assert.deepEqual([bait.slice(0,20).every(x=>x==='401 SIGNATURE_INVALID'),bait[20]],[true,'429 CHAIN_BUSY']);
  assert.deepEqual([await attempt('198.51.100.1',firstTime[1],signed),await attempt('198.51.100.2',safe,signed),(await w.browser(undefined,undefined,'198.51.100.3').signIn(newAccount())).verify.status],
    ['429 CHAIN_BUSY','200 ok',200]);
  assert.deepEqual([count(chain.keys,'chain:erc1271:known'),reads('eth_getCode')-codes],[3,21+1],'a returning Safe reads no code');
  w.clock.advance(NETWORK_WINDOW_MS);assert.equal(await attempt('198.51.100.1',firstTime[1],signed),'200 ok','the next minute');
  // (3) A broken or missing limiter fails closed: 'chain:code' (API_LIMITER) throwing is 429, missing is 503 for every
  // address that needs a code read; CHAIN_LIMITER missing is 503 for every contract, returning or not.
  const failing={limit:async()=>{throw new Error('down');}};
  const run=async(name,binding)=>{const x=setup();for(const a of [safe,firstTime[2]])x.chain.state.contracts.set(a,()=>'0x1626ba7e');
    const go=async(ip,address,sign=()=>randomSignature())=>{const b=x.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address}));
      const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});return r.status+' '+((await body(r)).error??'ok');};
    assert.equal(await go('192.0.2.2',safe,signed),'200 ok');x.clock.advance(NETWORK_WINDOW_MS);
    if(binding===undefined)delete x.env[name];else x.env[name]=binding;
    const res=[await go('192.0.2.3',newAccount().address),await go('192.0.2.4',firstTime[2],signed),await go('192.0.2.5',safe,signed),
      (await x.browser(undefined,undefined,'192.0.2.6').signIn(newAccount())).verify.status];
    assert.equal(x.db.raw.prepare('SELECT count(*) n FROM sessions').get().n,res.filter(v=>v==='200 ok'||v===200).length+1,name+': no other session');return res;};
  assert.deepEqual(await run('API_LIMITER',failing),['429 CHAIN_BUSY','429 CHAIN_BUSY','200 ok',200],'chain:code throws: nothing read, closed');
  assert.deepEqual(await run('API_LIMITER',undefined),['503 LIMITER_UNAVAILABLE','503 LIMITER_UNAVAILABLE','200 ok',200],'API_LIMITER missing');
  assert.deepEqual(await run('CHAIN_LIMITER',undefined),['401 SIGNATURE_INVALID','503 LIMITER_UNAVAILABLE','503 LIMITER_UNAVAILABLE',200],'CHAIN_LIMITER missing');
  assert.deepEqual(await run('CHAIN_LIMITER',failing),['401 SIGNATURE_INVALID','429 CHAIN_BUSY','429 CHAIN_BUSY',200],'CHAIN_LIMITER throws');
  // (4) EOA sign-in never asks either budget: both refusing, it signs in, and neither limiter hears of it.
  const e=setup(),asked=[];e.env.CHAIN_LIMITER={limit:async({key})=>{asked.push(key);return {success:false};}};
  e.env.API_LIMITER={limit:async({key})=>{asked.push(key);return {success:key!=='chain:code'};}};
  assert.equal((await e.browser(undefined,undefined,'192.0.2.7').signIn(newAccount())).verify.status,200);
  assert.deepEqual(asked.filter(k=>k.startsWith('chain:')),[]);
});

// L1 / L2: the row was checked, the chain read, and only then the challenge burnt, so verifies sent at once each made a
// keyed read, and a failed burn left the challenge open for another one.
test('ERC-1271: the challenge is claimed before any read, so garbage retries, racing verifies and a failed burn all read the chain once',async()=>{
  const keys=[];const w=setup({env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}}}});
  const wallet='0x'+'ab'.repeat(20);w.chain.state.contracts.set(wallet,()=>'0xffffffff');
  const reads=()=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL).map(c=>JSON.parse(c.body).method).join(',');
  const start=async ip=>{const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address:wallet}));return {b,c};};
  // One challenge, nineteen garbage signatures: one check, then 409.
  let {b,c}=await start('203.0.113.1');const st=[];
  for(let i=0;i<19;i++)st.push((await b.post('/api/auth/verify',{nonce:c.nonce,signature:randomSignature()})).status);
  assert.deepEqual([st[0],[...new Set(st.slice(1))],keys.length,reads()],[401,[409],1,'eth_getCode,eth_call']);
  // Ten verifies of one challenge at once: one claim wins, one read.
  ({b,c}=await start('198.51.100.1'));
  const rs=await Promise.all(Array.from({length:10},()=>b.post('/api/auth/verify',{nonce:c.nonce,signature:randomSignature()})));
  assert.deepEqual([rs.map(r=>r.status).sort().join(','),keys.length,reads()],['401,409,409,409,409,409,409,409,409,409',2,'eth_getCode,eth_call,eth_getCode,eth_call']);
  // The burn after a failed check throws (D1 overloaded): 503, and the claimed challenge still gets no second read. (A
  // minute later: the wallet has had its ERC1271_ADDRESS_SHARE of checks this minute.)
  w.clock.advance(NETWORK_WINDOW_MS);const real=w.env.DB;
  w.env.DB={...real,prepare:sql=>{const s=real.prepare(sql);if(!/SET invalidated_at=\?1 WHERE nonce=\?2 AND used_at IS NULL AND invalidated_at IS NULL$/.test(sql))return s;
    return {...s,bind:(...v)=>({...s.bind(...v),run:async()=>{throw new Error('D1 overloaded');}})};}};
  ({b,c}=await start('192.0.2.1'));
  const r1=await b.post('/api/auth/verify',{nonce:c.nonce,signature:randomSignature()}),r2=await b.post('/api/auth/verify',{nonce:c.nonce,signature:randomSignature()});
  assert.deepEqual([r1.status,(await body(r1)).error,r2.status,(await body(r2)).error,keys.length],[503,'AUTH_UNAVAILABLE',409,'CHALLENGE_USED',3]);
  assert.equal(reads().split(',').length,6);
});

// S2: an absent binding used to allow (all but CHAIN_LIMITER), so a renamed or dropped binding left sign-in unthrottled.
// F-3: the first-time smart wallet's code read now spends 'chain:code' in API_LIMITER, so that binding missing is 503 there too.
test('on imdember.com a missing AUTH, API, SEAT or CHAIN limiter binding makes exactly the routes that need it answer 503; loopback stays open',async()=>{
  const pepe='0x'+'5e'.repeat(20),collections=[{id:'pepe',name:{zh:'Pepe',en:'Pepe'},chainId:1,contract:pepe}];
  const run=async name=>{
    const w=setup({collections}),a=newAccount(),owner=newAccount(),smart='0x'+'ab'.repeat(20);w.chain.state.contracts.set(smart,()=>'0x1626ba7e');
    const s=w.browser();await s.signIn(a);await s.get('/api/me/home');
    const eoa=w.browser(),ce=await body(await eoa.post('/api/auth/challenge',{address:a.address})),se=await a.signMessage({message:ce.message});
    const sm=w.browser(),cs=await body(await sm.post('/api/auth/challenge',{address:smart})),ss=await owner.signMessage({message:cs.message});
    w.clock.advance(31_000);delete w.env[name];const rpc=w.chain.state.calls.length;
    const r={challenge:await w.browser().post('/api/auth/challenge',{address:a.address}),verify:await eoa.post('/api/auth/verify',{nonce:ce.nonce,signature:se}),
      verify1271:await sm.post('/api/auth/verify',{nonce:cs.nonce,signature:ss}),session:await s.get('/api/auth/session'),home:await s.get('/api/me/home'),
      fresh:await s.get('/api/me/home?fresh=1'),assets:await s.get('/api/wallet/'+a.address+'/assets'),
      snapshot:await w.call(new Request('https://imdember.com/api/world/snapshot')),seat:await w.call(new Request('https://imdember.com/api/world/seats/361')),
      logout:await s.post('/api/auth/logout')};
    for(const [k,v] of Object.entries(r))if(v.status===503)assert.equal((await body(v)).error,k==='snapshot'||k==='seat'?'limiter_unavailable':'LIMITER_UNAVAILABLE',name+' '+k);
    if(name==='CHAIN_LIMITER')assert.ok(!w.chain.state.calls.slice(rpc).some(c=>{const q=JSON.parse(c.body??'{}');return q.method==='eth_call'&&q.params[0].to.toLowerCase()===smart;}),'no isValidSignature call without the budget');
    return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.status]));
  };
  const all={challenge:200,verify:200,verify1271:200,session:200,home:200,fresh:200,assets:200,snapshot:200,seat:200,logout:204};
  assert.deepEqual(await run('AUTH_LIMITER'),{...all,challenge:503,verify:503,verify1271:503,home:503,fresh:503});
  assert.deepEqual(await run('API_LIMITER'),{...all,verify1271:503,session:503,home:503,fresh:503,assets:503,snapshot:503,seat:503});
  assert.deepEqual(await run('SEAT_LIMITER'),{...all,assets:503,seat:503});
  assert.deepEqual(await run('CHAIN_LIMITER'),{...all,verify1271:503,fresh:503,assets:503});
  // Loopback (wrangler dev, local E2E) with no binding at all: sign-in and the reads work; CHAIN still allows nothing.
  const w=setup({env:{API_LIMITER:undefined,SEAT_LIMITER:undefined,AUTH_LIMITER:undefined,CHAIN_LIMITER:undefined}}),a=newAccount();
  const local=w.browser('http://localhost:8792','http://localhost:8792');
  assert.equal((await local.signIn(a)).verify.status,200);assert.equal((await local.get('/api/me/home')).status,200);
  assert.equal((await w.call(new Request('http://127.0.0.1:8792/api/world/snapshot'))).status,200);
  const smart='0x'+'cd'.repeat(20);w.chain.state.contracts.set(smart,()=>'0x1626ba7e');
  const sb=w.browser('http://localhost:8792','http://localhost:8792'),c=await body(await sb.post('/api/auth/challenge',{address:smart}));
  const v=await sb.post('/api/auth/verify',{nonce:c.nonce,signature:await a.signMessage({message:c.message})});assert.deepEqual([v.status,(await body(v)).error],[429,'CHAIN_BUSY']);
});

// SEC-1 / CORR-01: a cross-site page could drain the per-IP sign-in bucket with anonymous GET /api/me/home (an <img> carries
// no SameSite=Lax cookie), after which logout answered 429 and the session stayed valid for 7 days.
test('logout is never rate limited: after anonymous reads drain the bucket, or with the limiter refusing or down, it still revokes',async()=>{
  const a=newAccount(),w=setup(),limiter=windowLimiter(20,w.clock.now);w.env.AUTH_LIMITER=limiter;
  const victim=w.browser();assert.equal((await victim.signIn(a)).verify.status,200);
  const token=victim.jar.get('__Host-imd_session');
  // 40 cross-site image loads: no cookie, a foreign page, the same client IP.
  const drained=[];for(let i=0;i<40;i++)drained.push((await w.call(new Request('https://imdember.com/api/me/home',{headers:{referer:'https://evil.example/'}}))).status);
  assert.deepEqual([...new Set(drained)],[401],'anonymous reads are 401, never 429, and spend no sign-in budget');
  assert.deepEqual([limiter.keys.filter(k=>k.startsWith('ip:')).length,limiter.keys.filter(k=>k.startsWith('verify:ip:')).length],[1,1],'only challenge and verify spent the per-IP sign-in keys');
  // Same IP, same minute: the owner can still check the house and sign in again from another tab.
  assert.equal((await victim.get('/api/me/home')).status,200);assert.equal((await w.browser().signIn(a)).verify.status,200);
  const out=await victim.post('/api/auth/logout');
  assert.equal(out.status,204);assert.equal(victim.jar.has('__Host-imd_session'),false);
  const thief=w.browser();thief.jar.set('__Host-imd_session',token);
  assert.equal((await thief.get('/api/me/home')).status,401);assert.deepEqual(await body(await thief.get('/api/auth/session')),{signedIn:false});
  for(const binding of [{limit:async()=>({success:false})},{limit:async()=>{throw new Error('binding down');}}]){
    const v=setup(),b=v.browser();await b.signIn(a);v.env.AUTH_LIMITER=binding;
    const r=await b.post('/api/auth/logout');assert.equal(r.status,204);
    assert.equal(v.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,0,'revoked at the server');
  }
});

test('/api/me/home is limited per session: one session re-checking too often does not starve another on the same IP, nor sign-in',async()=>{
  const a=newAccount(),b=newAccount(),w=setup(),limiter=windowLimiter(20,w.clock.now);w.env.AUTH_LIMITER=limiter;
  const one=w.browser(),two=w.browser();await one.signIn(a);await two.signIn(b);
  const statuses=[];for(let i=0;i<21;i++)statuses.push((await one.get('/api/me/home')).status);
  assert.deepEqual([statuses.slice(0,20).every(s=>s===200),statuses[20]],[true,429]);
  assert.equal((await two.get('/api/me/home')).status,200,'another session on the same IP');
  assert.equal((await w.browser().signIn(newAccount())).verify.status,200,'sign-in on the same IP');
  w.clock.advance(60_000);assert.equal((await one.get('/api/me/home')).status,200,'the next window');
  assert.ok(limiter.keys.some(k=>/^session:[\da-f]{32}$/.test(k)),'keyed by (a prefix of) the session hash, never the token');
  assert.ok(!limiter.keys.some(k=>k.includes(one.jar.get('__Host-imd_session'))));
});

test('ERC-1271 smart wallets: magic value signs in, anything else is 401, no key is 503; ERC-6492 wrappers are 400',async()=>{
  const w=setup(),owner=newAccount(),wallet='0x'+'ab'.repeat(20);
  // The fake contract answers the magic value while `accepted`, another bytes4 otherwise, and reverts when set to null.
  let accepted;w.chain.state.contracts.set(wallet,()=>accepted?'0x1626ba7e':'0xffffffff');
  const send=async(sign)=>{w.clock.advance(MIN);const b=spread(w),ch=await body(await b.post('/api/auth/challenge',{address:wallet}));return b.post('/api/auth/verify',{nonce:ch.nonce,signature:await sign(ch.message)});};
  accepted=true;let r=await send(m=>owner.signMessage({message:m}));assert.equal(r.status,200);assert.equal((await body(r)).address.toLowerCase(),wallet);
  const call=w.chain.state.calls.findLast(c=>c.url===ALCHEMY_RPC_URL);
  assert.equal(call.headers.get('authorization'),'Bearer test-alchemy-key');assert.ok(!call.url.includes('test-alchemy-key'));
  accepted=false;r=await send(m=>owner.signMessage({message:m}));assert.equal(r.status,401);
  w.chain.state.contracts.set(wallet,()=>null);r=await send(m=>owner.signMessage({message:m}));assert.equal(r.status,401,'revert');
  w.chain.state.fail='http';r=await send(m=>owner.signMessage({message:m}));assert.equal(r.status,503);assert.equal((await body(r)).error,'VERIFY_UNAVAILABLE');
  w.chain.state.fail=null;
  r=await send(m=>owner.signMessage({message:m}).then(s=>s+'00'.repeat(32)+ERC6492_SUFFIX));assert.equal(r.status,400);assert.equal((await body(r)).error,'UNSUPPORTED_SIGNATURE');
  // The contract call is slow: the challenge expires while its signature is being checked, so it is not consumed.
  w.chain.state.contracts.set(wallet,()=>{w.clock.advance(5*MIN);return '0x1626ba7e';});
  r=await send(m=>owner.signMessage({message:m}));assert.equal(r.status,409);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions').get().n,1,'only the first smart-wallet login made a session');
});

// W-3 (Swarm retest e48d0a96): a JSON-RPC error from eth_call was taken as a bad signature (401, challenge burnt), but
// only a revert or an EVM halt the contract's code causes (out of gas, invalid opcode, ...) is the contract's answer.
// Every other way the node can fail is 503, burns the challenge like every 503 of verify (invalidated_at is set in that
// same request, not only by the later retry), and makes no session; a revert, a halt or any answer but the magic word stays 401.
test('W-3: a contract wallet\'s eth_call failing at the node is 503 VERIFY_UNAVAILABLE with no session; a revert or a non-magic answer is 401',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const w=setup(),owner=newAccount(),wallet='0x'+'ab'.repeat(20);w.chain.state.contracts.set(wallet,()=>'0x1626ba7e');
  const json=v=>Response.json({jsonrpc:'2.0',id:1,...v}),err=(code,message)=>()=>json({error:{code,message}});
  const cases={nodeError:err(-32000,'header not found'),limit:err(-32005,'limit exceeded'),internal:err(-32603,'internal error'),otherCode:err(-32603,'execution reverted'),noCode:()=>json({error:{message:'boom'}}),
    string:()=>json({error:'boom'}),network:()=>{throw new TypeError('network down');},http:()=>new Response('{}',{status:500}),nullResult:()=>json({result:null}),
    notHex:()=>json({result:'0xzz'}),revert3:err(3,'execution reverted'),revertNoData:err(-32000,'execution reverted'),
    outOfGas:err(-32000,'out of gas'),badOpcode:err(-32000,'invalid opcode: INVALID'),badJump:err(-32000,'invalid jump destination'),
    stackUnder:err(-32000,'stack underflow (0 <=> 1)'),stackLimit:err(-32000,'stack limit reached 1024 (1023)'),writeProt:err(-32000,'write protection'),
    returnOOB:err(-32000,'return data out of bounds'),haltOtherCode:err(-32603,'out of gas'),haltMidMessage:err(-32000,'node says out of gas'),
    nonMagic:()=>json({result:'0xffffffff'+'0'.repeat(56)}),empty:()=>json({result:'0x'}),magic:null};
  const seen={};
  for(const [name,answer] of Object.entries(cases)){
    w.clock.advance(MIN);const b=spread(w),ch=await body(await b.post('/api/auth/challenge',{address:wallet})),signature=await owner.signMessage({message:ch.message});
    w.chain.state.intercept=answer&&(method=>method==='eth_call'?answer():undefined);lines.length=0;
    const r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature});w.chain.state.intercept=null;
    seen[name]=r.status+' '+((await body(r)).error??'ok');
    if(r.status===200)continue;
    assert.notEqual(w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(ch.nonce).invalidated_at,null,name+': burnt in the same request');
    assert.equal(b.jar.has('__Host-imd_session'),false,name);
    const again=await b.post('/api/auth/verify',{nonce:ch.nonce,signature});assert.equal(again.status,409,name+': the challenge is burnt');
    if(r.status===503)assert.equal(JSON.parse(lines[0]).reason,'rpc',name);
  }
  const down='503 VERIFY_UNAVAILABLE',no='401 SIGNATURE_INVALID';
  assert.deepEqual(seen,{nodeError:down,limit:down,internal:down,otherCode:down,noCode:down,string:down,network:down,http:down,nullResult:down,notHex:down,
    revert3:no,revertNoData:no,outOfGas:no,badOpcode:no,badJump:no,stackUnder:no,stackLimit:no,writeProt:no,returnOOB:no,haltOtherCode:down,haltMidMessage:down,nonMagic:no,empty:no,magic:'200 ok'});
  assert.equal(sessionCount(w.db),1,'only the magic answer made a session');
});

// S1: a 401 used to leave the challenge open for its 5 minutes, and every retry of a bad signature was another keyed
// eth_getCode (plus eth_call for a contract) on the Alchemy key, bounded only per IP per location.
test('any failed signature check burns the challenge: its own flow cannot retry it, so one challenge buys at most one ERC-1271 read',async()=>{
  const w=setup(),a=newAccount(),owner=newAccount(),wallet='0x'+'ab'.repeat(20);w.chain.state.contracts.set(wallet,()=>'0xffffffff');
  const rpc=()=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL).length,open=nonce=>w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(nonce).invalidated_at;
  const start=async address=>{const b=spread(w),c=await body(await b.post('/api/auth/challenge',{address}));return {b,c};};
  const retry=async(b,c,signature,n=5)=>{const out=[];for(let i=0;i<n;i++){const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature});out.push(r.status+' '+(await body(r)).error);}return [...new Set(out)];};
  // A contract wallet answering "no": eth_getCode + eth_call once, then 409 with no chain read, even with a valid signature.
  let {b,c}=await start(wallet);const bad=randomSignature();
  let r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:bad});assert.deepEqual([r.status,(await body(r)).error,rpc()],[401,'SIGNATURE_INVALID',2]);
  assert.equal(open(c.nonce),START,'burnt in the same request');
  assert.deepEqual(await retry(b,c,bad),['409 CHALLENGE_USED']);w.chain.state.contracts.set(wallet,()=>'0x1626ba7e');
  assert.deepEqual(await retry(b,c,await owner.signMessage({message:c.message}),1),['409 CHALLENGE_USED']);assert.equal(rpc(),2);
  // An EOA with a forged signature: one eth_getCode, then burnt.
  ({b,c}=await start(a.address));r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:bad});assert.equal(r.status,401);assert.equal(rpc(),3);
  assert.deepEqual(await retry(b,c,await a.signMessage({message:c.message})),['409 CHALLENGE_USED']);assert.equal(rpc(),3);
  // An ERC-6492 wrapper (400) and a stored message that no longer checks out (401) burn it too, before any chain read.
  ({b,c}=await start(a.address));const good=await a.signMessage({message:c.message});
  r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:good+'00'.repeat(32)+ERC6492_SUFFIX});assert.equal(r.status,400);
  assert.deepEqual(await retry(b,c,good,1),['409 CHALLENGE_USED']);
  ({b,c}=await start(a.address));w.db.raw.prepare('UPDATE login_challenges SET message=? WHERE nonce=?').run(c.message.replace('Chain ID: 1','Chain ID: 5'),c.nonce);
  r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await a.signMessage({message:c.message})});assert.equal(r.status,401);
  assert.equal(open(c.nonce),START);assert.equal(rpc(),3);
  // The node failing (503) spent a read too: burnt.
  ({b,c}=await start(wallet));w.chain.state.fail='http';
  r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:bad});assert.deepEqual([r.status,(await body(r)).error],[503,'VERIFY_UNAVAILABLE']);
  assert.equal(open(c.nonce),START,'burnt in the same request');w.chain.state.fail=null;assert.deepEqual(await retry(b,c,await owner.signMessage({message:c.message}),1),['409 CHALLENGE_USED']);
  // Nobody else can burn it: without the flow cookie, or from another origin, the answer is 403 and the challenge stays open.
  ({b,c}=await start(a.address));const calls=rpc();
  r=await w.browser().post('/api/auth/verify',{nonce:c.nonce,signature:bad});assert.deepEqual([r.status,(await body(r)).error],[403,'FLOW_MISMATCH']);
  const stranger=w.browser();stranger.jar.set('__Host-imd_flow',b.jar.get('__Host-imd_flow'));stranger.origin='https://evil.example';
  r=await stranger.post('/api/auth/verify',{nonce:c.nonce,signature:bad});assert.equal(r.status,403);
  assert.equal(open(c.nonce),null);assert.equal(rpc(),calls);
  assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature:await a.signMessage({message:c.message})})).status,200,'the owner still signs in');
  // A fresh challenge is the way on, and a smart wallet still signs in with it.
  ({b,c}=await start(wallet));r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await owner.signMessage({message:c.message})});
  assert.deepEqual([r.status,(await body(r)).address.toLowerCase()],[200,wallet]);
  assert.equal(sessionCount(w.db),2);
});

test('ERC-1271 checks spend the per-location CHAIN_LIMITER (chain:erc1271) before eth_call and fail closed; ECDSA sign-ins never touch it',async()=>{
  const keys=[];let allowed=true;
  const w=setup({env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);if(allowed===null)throw new Error('down');return {success:allowed};}}}});
  const owner=newAccount(),wallet='0x'+'cd'.repeat(20);w.chain.state.contracts.set(wallet,()=>'0x1626ba7e');
  const rpc=(method='eth_call')=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL&&JSON.parse(c.body).method===method).length;
  allowed=false;assert.equal((await w.browser().signIn(newAccount())).verify.status,200,'an EOA needs no budget');assert.deepEqual(keys,[]);
  for(const refusal of [false,null]){
    const b=w.browser(),c=await body(await b.post('/api/auth/challenge',{address:wallet})),signature=await owner.signMessage({message:c.message});
    allowed=refusal;const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature});
    assert.deepEqual([r.status,(await body(r)).error,r.headers.get('retry-after'),rpc()],[429,'CHAIN_BUSY','60',0],refusal===null?'limiter down':'refused');
    assert.equal(w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(c.nonce).invalidated_at,START,'burnt, not only claimed');
    // M2: nothing was read, and the challenge is burnt all the same: the client starts a fresh one on the next click, so an
    // open one could only serve someone replaying it against the budget.
    allowed=true;const again=await b.post('/api/auth/verify',{nonce:c.nonce,signature});
    assert.deepEqual([again.status,(await body(again)).error,rpc()],[409,'CHALLENGE_USED',0]);
    assert.equal(rpc('eth_getCode'),refusal===false?1:2,'F-3: the code is read (one read per challenge) before the budget is asked');
  }
  w.clock.advance(NETWORK_WINDOW_MS);const b=w.browser(),c=await body(await b.post('/api/auth/challenge',{address:wallet}));
  assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature:await owner.signMessage({message:c.message})})).status,200,'a fresh challenge (a minute later) signs in');
  assert.deepEqual([rpc(),rpc('eth_getCode')],[1,3]);
  assert.deepEqual(keys,['chain:erc1271','chain:erc1271','chain:erc1271']);
});

// F-2 (swarm review 4bd31cfb): a session did not say how it was proven, and the ERC-1271 path must never fall back to
// trusting the address when it cannot run.
test('F-2: each session records EOA/ECDSA or CONTRACT/ERC1271; every way the ERC-1271 path can be unavailable is refused and makes no session',async()=>{
  const w=setup(),a=newAccount(),owner=newAccount(),safe='0x'+'5a'.repeat(20),delegated=newAccount();
  w.chain.state.contracts.set(safe,()=>'0x1626ba7e');
  w.chain.state.contracts.set(delegated.address.toLowerCase(),()=>'0x1626ba7e');w.chain.state.code.set(delegated.address.toLowerCase(),'0xef0100'+'12'.repeat(20));
  const how=()=>w.db.raw.prepare('SELECT address,wallet_type,verification_method FROM sessions ORDER BY created_at,rowid').all().map(r=>[r.address,r.wallet_type,r.verification_method]);
  assert.equal((await spread(w).signIn(a)).verify.status,200);
  const b=spread(w),c=await body(await b.post('/api/auth/challenge',{address:safe}));
  assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature:await owner.signMessage({message:c.message})})).status,200);
  assert.equal((await spread(w).signIn(delegated)).verify.status,200,'a 7702-delegated EOA signing with its own key');
  assert.deepEqual(how(),[[a.address.toLowerCase(),'EOA','ECDSA'],[safe,'CONTRACT','ERC1271'],[delegated.address.toLowerCase(),'EOA','ECDSA']]);
  assert.deepEqual(await body(await b.get('/api/auth/session')),{signedIn:true,address:getAddress(safe),expiresAt:START+7*DAY},'audit only: never sent to the page');
  // Fail closed: no key, the node down or erroring, the budget refused or broken, the binding missing. The signature
  // would be valid; the address is never trusted without the check.
  const modes={noKey:[setup({key:null}),()=>{}],http:[setup(),x=>{x.chain.state.fail='http';}],network:[setup(),x=>{x.chain.state.fail='network';}],
    rpcError:[setup(),x=>{x.chain.state.fail='rpc-error';}],refused:[setup(),x=>{x.env.CHAIN_LIMITER={limit:async()=>({success:false})};}],
    broken:[setup(),x=>{x.env.CHAIN_LIMITER={limit:async()=>{throw new Error('down');}};}],missing:[setup(),x=>{delete x.env.CHAIN_LIMITER;}]};
  const seen={};
  for(const [name,[x,breakIt]] of Object.entries(modes)){
    x.chain.state.contracts.set(safe,()=>'0x1626ba7e');
    const d=x.browser(),ch=await body(await d.post('/api/auth/challenge',{address:safe}));breakIt(x);
    const r=await d.post('/api/auth/verify',{nonce:ch.nonce,signature:await owner.signMessage({message:ch.message})});
    seen[name]=r.status+' '+(await body(r)).error;
    assert.deepEqual([sessionCount(x.db),d.jar.has('__Host-imd_session')],[0,false],name);
  }
  assert.deepEqual(seen,{noKey:'503 VERIFY_UNAVAILABLE',http:'503 VERIFY_UNAVAILABLE',network:'503 VERIFY_UNAVAILABLE',rpcError:'503 VERIFY_UNAVAILABLE',
    refused:'429 CHAIN_BUSY',broken:'429 CHAIN_BUSY',missing:'503 LIMITER_UNAVAILABLE'});
});

// SEC-2: the answer was matched on its first 4 bytes, so the identity precompile 0x…04 (which returns its calldata, and the
// calldata starts with the isValidSignature selector) signed in with any signature.
test('ERC-1271 needs code at the address and exactly the magic word: echoes, precompiles and padded answers are 401',async()=>{
  const w=setup(),owner=newAccount(),identity='0x0000000000000000000000000000000000000004',echoing='0x'+'ec'.repeat(20),padded='0x'+'bd'.repeat(20);
  const send=async(address,sign=()=>'0x'+'11'.repeat(65))=>{const b=spread(w),ch=await body(await b.post('/api/auth/challenge',{address}));
    const r=await b.post('/api/auth/verify',{nonce:ch.nonce,signature:await sign(ch.message)});return [r.status,(await body(r)).error??'ok'];};
  const echo=data=>data;
  w.chain.state.raw.set(identity,echo);                                                   // no code, echoes: the precompile
  w.chain.state.raw.set(echoing,echo);w.chain.state.code.set(echoing,'0x3660008037');      // a contract whose fallback echoes
  w.chain.state.raw.set(padded,()=>'0x1626ba7e'+'0'.repeat(56)+'ff'.repeat(32));w.chain.state.code.set(padded,'0x60ff');
  assert.equal(w.chain.state.raw.get(identity)('0x1626ba7e00').slice(0,10),'0x1626ba7e','the fake echoes the selector back');
  assert.deepEqual(await send(identity),[401,'SIGNATURE_INVALID']);
  assert.deepEqual(await send(echoing),[401,'SIGNATURE_INVALID']);
  assert.deepEqual(await send(padded),[401,'SIGNATURE_INVALID']);
  const calls=w.chain.state.calls.map(c=>c.body&&JSON.parse(c.body)).filter(Boolean);
  assert.equal(calls.filter(c=>c.method==='eth_call'&&c.params[0].to===identity).length,0,'no code: isValidSignature is never called');
  // A 7702-delegated EOA's code (0xef0100 + delegate) counts as code; its contract answering the exact word signs in.
  const delegated='0x'+'77'.repeat(20);w.chain.state.contracts.set(delegated,()=>'0x1626ba7e');w.chain.state.code.set(delegated,'0xef0100'+'12'.repeat(20));
  assert.deepEqual(await send(delegated,m=>owner.signMessage({message:m})),[200,'ok']);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions').get().n,1);
});

// SEC-4: a client-chosen flow value was adopted as the login-CSRF binding.
test('challenge always issues a new flow value; the one the browser brings only names the challenges it supersedes',async()=>{
  const w=setup(),a=newAccount(),b=w.browser(),planted='0'.repeat(32);
  const first=await body(await b.post('/api/auth/challenge',{address:a.address})),issued=b.jar.get('__Host-imd_flow');
  b.jar.set('__Host-imd_flow',planted);
  const r=await b.post('/api/auth/challenge',{address:a.address});
  assert.notEqual(b.jar.get('__Host-imd_flow'),planted);assert.match(b.jar.get('__Host-imd_flow'),/^[\da-f]{32}$/);
  assert.ok(!r.headers.getSetCookie().some(c=>c.includes(planted)),'the planted value is never echoed back');
  // The planted value named no challenge, so the first one (under the value the server issued) is still open.
  const again=w.browser();again.jar.set('__Host-imd_flow',issued);
  assert.equal((await again.post('/api/auth/verify',{nonce:first.nonce,signature:await a.signMessage({message:first.message})})).status,200);
  // Superseding still works when the browser brings its real value: that earlier challenge is dead.
  const c=w.browser(),x=await body(await c.post('/api/auth/challenge',{address:a.address})),f1=c.jar.get('__Host-imd_flow');
  await c.post('/api/auth/challenge',{address:a.address});assert.notEqual(c.jar.get('__Host-imd_flow'),f1);
  c.jar.set('__Host-imd_flow',f1);                                  // even with the flow it was issued under
  const stale=await c.post('/api/auth/verify',{nonce:x.nonce,signature:await a.signMessage({message:x.message})});
  assert.equal(stale.status,409);assert.equal((await body(stale)).error,'CHALLENGE_USED');
});

test('malformed input is 400 and wrong methods 405; unknown account routes 404; the read API is untouched',async()=>{
  const w=setup(),b=w.browser(),a=newAccount();
  for(const payload of [{},{address:'0x123'},{address:a.address.slice(0,41)},[a.address],'not json',JSON.stringify({address:a.address,pad:'x'.repeat(2100)})]){
    const r=await b.post('/api/auth/challenge',payload);assert.equal(r.status,400,JSON.stringify(payload).slice(0,40));
  }
  assert.equal((await b.post('/api/auth/challenge',{address:a.address},{headers:{'content-type':'text/plain'}})).status,400);
  assert.equal((await b.post('/api/auth/verify',{nonce:'x',signature:'0x00'})).status,400);
  const get=await b.get('/api/auth/challenge');assert.equal(get.status,405);assert.equal(get.headers.get('allow'),'POST');
  const post=await b.post('/api/auth/session');assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET');
  assert.equal((await b.get('/api/auth/other')).status,404);assert.equal((await b.get('/api/me/other')).status,404);
  assert.equal((await b.get('/api/wallet/0x12/assets')).status,404);
  assert.equal((await w.call(new Request('https://imdember.com/api/world/snapshot',{method:'POST'}))).status,405);
  assert.equal(await (await w.call(new Request('https://imdember.com/index.html'))).text(),'asset');
});

// Review round 2 (SR2-1): the known-smart-wallet lookup ran before the claim, once per racing verify, and through
// sessions_address visited every session of the address; logout-all visited every revoked one. Partial indexes in 0003.
test('the known-smart-wallet lookup and logout-all read through partial indexes: an address’s ECDSA or revoked sessions, however many, are never visited',()=>{
  const db=openD1(),addr='0x'+'11'.repeat(20),safe='0x'+'5a'.repeat(20);let visited=0;db.raw.function('visit',()=>{visited++;return 1;});
  const ins=db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,revoked_at,wallet_type,verification_method) VALUES(?,?,1,1,?,?,?,?,?)');
  db.raw.exec('BEGIN');for(let i=0;i<3000;i++)ins.run('h'+i,addr,9e15,'n'+i,i<2990?5:null,'EOA','ECDSA');ins.run('hs',safe,9e15,'ns',null,'CONTRACT','ERC1271');db.raw.exec('COMMIT');
  const plan=(sql,...a)=>db.raw.prepare('EXPLAIN QUERY PLAN '+sql).all(...a).map(r=>r.detail).join(' | ');
  assert.equal(plan(KNOWN_ERC1271,addr),'SEARCH sessions USING COVERING INDEX sessions_erc1271 (address=?)');
  assert.equal(plan(REVOKE_ALL_SESSIONS,10,addr),'SEARCH sessions USING INDEX sessions_live (address=? AND expires_at>?)');
  const known=a=>{visited=0;const r=db.raw.prepare(KNOWN_ERC1271.replace(' LIMIT',' AND visit()=1 LIMIT')).get(a);return [!!r,visited];};
  assert.deepEqual(known(addr),[false,0],'3000 ECDSA sessions: none read');assert.deepEqual(known(safe),[true,1]);
  visited=0;const r=db.raw.prepare(REVOKE_ALL_SESSIONS+' AND visit()=1').run(10,addr);
  assert.deepEqual([Number(r.changes),visited],[10,10],'only the 10 live sessions are visited, not the 2990 revoked');
  assert.equal(db.raw.prepare('SELECT count(*) n FROM sessions').get().n,3001,'revoking deletes nothing');
});

// SR2-4: a deploy that ran ahead of migrations/0003 must not look like a lost race (409, unlogged) but a logged 503.
test('deployed before migrations/0003: sign-in is a logged 503 AUTH_UNAVAILABLE with no session and the challenge kept; once 0003 is applied it signs in',async t=>{
  const lines=[];t.mock.method(console,'log',line=>{lines.push(line);});
  const old=openD1(['0001_wallet_login.sql','0002_sign_in_budgets.sql']),w=setup({env:{DB:old}}),a=newAccount(),b=w.browser();
  const c=await body(await b.post('/api/auth/challenge',{address:a.address})),signature=await a.signMessage({message:c.message});
  const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature});
  assert.deepEqual([r.status,(await body(r)).error],[503,'AUTH_UNAVAILABLE']);
  assert.equal(sessionCount(old),0);assert.equal(old.raw.prepare('SELECT used_at FROM login_challenges').get().used_at,null,'the batch rolled back');
  assert.deepEqual(lines.map(l=>JSON.parse(l)),[{evt:'auth_refused',route:'/api/auth/verify',status:503,error:'AUTH_UNAVAILABLE',reason:'error',colo:null,net:'net:unknown'}]);
  old.raw.exec(readFileSync(new URL('../migrations/0003_sign_in_layers.sql',import.meta.url),'utf8'));
  assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature})).status,200);assert.equal(sessionCount(old),1);
});

test('without D1 (the Vite dev server, a missing binding) sign-in and /api/me answer 503 AUTH_UNAVAILABLE',async()=>{
  const w=setup(),a=newAccount(),env={...w.env};delete env.DB;
  const b=new Browser(r=>w.worker.fetch(r,env,{waitUntil(){}}));
  for(const [method,path] of [['POST','/api/auth/challenge'],['POST','/api/auth/verify'],['POST','/api/auth/logout'],['GET','/api/auth/session'],['GET','/api/me/home']]){
    const r=method==='POST'?await b.post(path,{address:a.address}):await b.get(path);
    assert.equal(r.status,503,path);assert.equal((await body(r)).error,'AUTH_UNAVAILABLE');
  }
  let middleware;imdGatewayPlugin().configureServer({middlewares:{use:m=>{middleware=m;}}});
  for(const [method,url] of [['POST','/api/auth/challenge'],['GET','/api/auth/session'],['GET','/api/me/home']]){
    const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(text){this.body=text;}};
    await new Promise((resolve,reject)=>{res.end=text=>{res.body=text;resolve();};middleware({method,url},res,()=>reject(new Error('fell through to the SPA')));});
    assert.equal(res.statusCode,503,url);assert.equal(JSON.parse(res.body).error,'AUTH_UNAVAILABLE');assert.equal(res.headers['cache-control'],'no-store');
  }
});

// The cold-start guard (DESIGN_W1 §4): one @noble/curves copy for viem and the server, the window hook exists, and the
// first verify in a fresh process stays well inside the Worker's 50 ms CPU cap. Each child process creates the
// challenges and times POST /api/auth/verify; the signatures are made in this (already warm) process, so the child's
// first secp256k1 use is the recovery inside the handler. The whole cold handler must cost less than building noble's
// default window-8 table alone, timed afterwards in the same process (same load); without the window call it cannot.
// The other test files run in parallel and only ever add time, so up to five fresh processes are tried, until one meets
// both bounds (the deploy runs this suite as its gate, where one loaded run failed only the warm bound). Measured idle
// on 2026-09-28: cold handler 8–9 ms with window 4, 23–25 ms with window 8. Every bound is relative to that yardstick
// (INT-3: an absolute 25 ms ceiling failed at random once the canal's tests joined the parallel run).
async function coldVerify(){
  const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/cold-verify.mjs',import.meta.url))],{stdio:['pipe','pipe','inherit']});
  const lines=[];let buffered='',wake=()=>{};
  child.stdout.on('data',d=>{buffered+=d;const parts=buffered.split(NL);buffered=parts.pop();lines.push(...parts);wake();});
  const next=()=>new Promise(resolve=>{const take=()=>lines.length?resolve(lines.shift()):(wake=take);take();});
  const account=newAccount();child.stdin.write(account.address+NL);
  for(let i=0;i<2;i++){const message=JSON.parse(await next());child.stdin.write(await account.signMessage({message})+NL);}
  const result=JSON.parse(await next());child.kill();return result;
}
test('one @noble/curves copy, _setWindowSize exists, and a cold verify in a fresh process stays far below the 50 ms CPU cap',async()=>{
  const here=createRequire(import.meta.url),viem=createRequire(here.resolve('viem'));
  assert.equal(viem.resolve('@noble/curves/secp256k1'),here.resolve('@noble/curves/secp256k1'));
  const {secp256k1}=await import('@noble/curves/secp256k1');assert.equal(typeof secp256k1.ProjectivePoint.BASE._setWindowSize,'function');
  const good=r=>r.coldMs<r.tableMs&&r.warmMs<r.tableMs/2,runs=[];for(let i=0;i<5&&!runs.some(good);i++)runs.push(await coldVerify());
  for(const r of runs)assert.equal(r.status,200);
  const f=v=>v.toFixed(1);
  console.log(`verify handler: cold ${runs.map(r=>f(r.coldMs)+' (window-8 table alone '+f(r.tableMs)+')').join(' / ')} ms, warm ${runs.map(r=>f(r.warmMs)).join(' / ')} ms`);
  assert.ok(runs.some(good),'cold verify never beat the window-8 table: '+JSON.stringify(runs));
  assert.ok(runs.some(r=>r.warmMs<r.tableMs/2),'a warm verify costs well under the table: '+JSON.stringify(runs));
});
