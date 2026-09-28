import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parseSiweMessage} from 'viem/siwe';
import {setup,newAccount,Browser,START,windowLimiter} from './wallet-harness.mjs';
import {imdGatewayPlugin} from '../server/vite-plugin.ts';
import {sha256,SIWE_STATEMENT,ERC6492_SUFFIX,INSERT_CHALLENGE,NETWORK_CHALLENGE_BUDGET,NETWORK_WINDOW_MS,CHALLENGE_BUDGET,CHALLENGE_BUDGET_WINDOW_MS,
  CHALLENGE_BUDGET_NETWORKS,ERC1271_NETWORK_SHARE} from '../server/auth.ts';
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
  assert.deepEqual([NETWORK_CHALLENGE_BUDGET,NETWORK_WINDOW_MS,CHALLENGE_BUDGET,CHALLENGE_BUDGET_WINDOW_MS,CHALLENGE_BUDGET_NETWORKS],[30,60_000,60,6_000,20]);
  const w=setup(),a=newAccount();w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const rows=()=>w.db.raw.prepare('SELECT count(*) n FROM login_challenges').get().n;
  const ask=async(ip,b=w.browser())=>{const r=await b.post('/api/auth/challenge',{address:a.address},{headers:{'cf-connecting-ip':ip}});return r.status===200?200:r.status+' '+(await body(r)).error+' '+r.headers.get('retry-after');};
  const burst=async(ips,n)=>{const out=[];for(const ip of ips)for(let i=0;i<n;i++)out.push(await ask(ip));return out;};
  // Six addresses of one /24, each at its full AUTH_LIMITER rate: the network's share, not the valve.
  const attack=await burst([1,2,3,4,5,6].map(i=>'203.0.113.'+i),20);
  assert.deepEqual([attack.slice(0,30).every(s=>s===200),[...new Set(attack.slice(30))]],[true,['429 SIGN_IN_BUSY 60']]);assert.equal(rows(),30);
  assert.equal((await w.browser(undefined,undefined,'198.51.100.77').signIn(a)).verify.status,200,'a player elsewhere signs in');
  assert.equal(await ask('203.0.113.200'),'429 SIGN_IN_BUSY 60','the trade-off: a player inside that /24 waits for its minute');
  // IPv6 counts by /48 (in the next 6 s slice; this one already holds 31): another /64 of the same /48 shares it, another /48 does not.
  w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);for(let i=0;i<NETWORK_CHALLENGE_BUDGET;i++)await ask('2001:db8:1:'+(i%10)+'::1');
  assert.deepEqual([await ask('2001:db8:1:ff::9'),await ask('2001:db8:2::9')],['429 SIGN_IN_BUSY 60',200]);
  // The valve: past the minute, two networks bursting 30 + 29 on top of one open challenge fill the 6 s slice; a third
  // network and the first browser alike are refused, nothing is written, and the first browser's challenge is not superseded.
  w.clock.advance(NETWORK_WINDOW_MS);
  const first=w.browser(undefined,undefined,'192.0.2.9'),c0=await body(await first.post('/api/auth/challenge',{address:a.address}));
  const filled=[...await burst(['198.51.100.1','198.51.100.2'],15),...await burst(['203.0.113.1','203.0.113.2'],15)].slice(0,59);
  assert.equal(filled.filter(s=>s===200).length,59);const before=rows();
  assert.equal(await ask('100.64.0.1'),'429 SIGN_IN_BUSY 60');
  const again=await first.post('/api/auth/challenge',{address:a.address});assert.deepEqual([again.status,again.headers.getSetCookie().length],[429,0]);
  assert.equal(rows(),before);assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NOT NULL').get().n,0);
  assert.equal((await first.post('/api/auth/verify',{nonce:c0.nonce,signature:await a.signMessage({message:c0.message})})).status,200,'sign-in with a challenge already held still works');
  // The valve reopens with the next slice; a network that spent its share still waits for its minute.
  w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);assert.deepEqual([await ask('100.64.0.1'),await ask('198.51.100.3')],[200,'429 SIGN_IN_BUSY 60']);
  // Both counts are range reads of an index (migrations/0002), each capped at its budget; the network count runs first.
  const plan=w.db.raw.prepare('EXPLAIN QUERY PLAN '+INSERT_CHALLENGE).all(...Array(8).fill('x'),0,NETWORK_CHALLENGE_BUDGET,0,CHALLENGE_BUDGET).map(r=>r.detail).join(' | ');
  assert.match(plan,/SEARCH login_challenges USING COVERING INDEX login_challenges_net \(net=\? AND issued_at>\?\)[\s\S]*SEARCH login_challenges USING COVERING INDEX login_challenges_issued \(issued_at>\?\)/,plan);
});

// M2: a refused ERC-1271 budget left the challenge open, so one challenge could ask the per-location budget again and
// again, and one or two IPs could hold a location's smart-wallet sign-ins at zero with garbage signatures.
test('ERC-1271: each network gets ERC1271_NETWORK_SHARE checks a minute before the location budget; past it 429 CHAIN_BUSY, nothing asked or read, and the challenge is burnt',async()=>{
  assert.equal(ERC1271_NETWORK_SHARE,3);
  const keys=[];const w=setup({env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}}}});
  const owner=newAccount(),wallet='0x'+'ab'.repeat(20);let answer='0xffffffff';w.chain.state.contracts.set(wallet,()=>answer);
  const getCode=()=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL&&JSON.parse(c.body).method==='eth_getCode').length;
  const check=async(ip,sign=()=>randomSignature())=>{
    const b=w.browser(undefined,undefined,ip),c=await body(await b.post('/api/auth/challenge',{address:wallet}));
    const r=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await sign(c.message)});return {b,c,r:r.status+' '+((await body(r)).error??'ok')};};
  const out=[];for(let i=1;i<=4;i++)out.push((await check('203.0.113.'+i)).r);
  assert.deepEqual(out,['401 SIGNATURE_INVALID','401 SIGNATURE_INVALID','401 SIGNATURE_INVALID','429 CHAIN_BUSY']);assert.deepEqual([keys.length,getCode()],[3,3]);
  answer='0x1626ba7e';const {b,c,r}=await check('203.0.113.5',m=>owner.signMessage({message:m}));
  assert.equal(r,'429 CHAIN_BUSY','the share is per network, whatever the signature');
  const retry=await b.post('/api/auth/verify',{nonce:c.nonce,signature:await owner.signMessage({message:c.message})});
  assert.deepEqual([retry.status,(await body(retry)).error,keys.length,getCode()],[409,'CHALLENGE_USED',3,3],'burnt: no second try against the budget');
  // Another network is untouched, and after its minute the first one has its share again.
  assert.equal((await check('198.51.100.7',m=>owner.signMessage({message:m}))).r,'200 ok');
  w.clock.advance(NETWORK_WINDOW_MS);assert.equal((await check('203.0.113.6',m=>owner.signMessage({message:m}))).r,'200 ok');
  assert.deepEqual([keys.length,getCode()],[5,5]);
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
  // The burn after a failed check throws (D1 overloaded): 503, and the claimed challenge still gets no second read.
  const real=w.env.DB;
  w.env.DB={...real,prepare:sql=>{const s=real.prepare(sql);if(!/SET invalidated_at=\?1 WHERE nonce=\?2 AND used_at IS NULL AND invalidated_at IS NULL$/.test(sql))return s;
    return {...s,bind:(...v)=>({...s.bind(...v),run:async()=>{throw new Error('D1 overloaded');}})};}};
  ({b,c}=await start('192.0.2.1'));
  const r1=await b.post('/api/auth/verify',{nonce:c.nonce,signature:randomSignature()}),r2=await b.post('/api/auth/verify',{nonce:c.nonce,signature:randomSignature()});
  assert.deepEqual([r1.status,(await body(r1)).error,r2.status,(await body(r2)).error,keys.length],[503,'AUTH_UNAVAILABLE',409,'CHALLENGE_USED',3]);
  assert.equal(reads().split(',').length,6);
});

// S2: an absent binding used to allow (all but CHAIN_LIMITER), so a renamed or dropped binding left sign-in unthrottled.
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
    if(name==='CHAIN_LIMITER')assert.ok(!w.chain.state.calls.slice(rpc).some(c=>JSON.parse(c.body??'{}').method==='eth_getCode'),'no ERC-1271 read without the budget');
    return Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v.status]));
  };
  const all={challenge:200,verify:200,verify1271:200,session:200,home:200,fresh:200,assets:200,snapshot:200,seat:200,logout:204};
  assert.deepEqual(await run('AUTH_LIMITER'),{...all,challenge:503,verify:503,verify1271:503,home:503,fresh:503});
  assert.deepEqual(await run('API_LIMITER'),{...all,session:503,home:503,fresh:503,assets:503,snapshot:503,seat:503});
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
  assert.equal(limiter.keys.filter(k=>k.startsWith('ip:')).length,2,'only challenge and verify spent the per-IP sign-in bucket');
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
  const send=async(sign)=>{const b=spread(w),ch=await body(await b.post('/api/auth/challenge',{address:wallet}));return b.post('/api/auth/verify',{nonce:ch.nonce,signature:await sign(ch.message)});};
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
  w.chain.state.fail=null;assert.deepEqual(await retry(b,c,await owner.signMessage({message:c.message}),1),['409 CHALLENGE_USED']);
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

test('ERC-1271 checks spend the per-location CHAIN_LIMITER (chain:erc1271) first and fail closed; ECDSA sign-ins never touch it',async()=>{
  const keys=[];let allowed=true;
  const w=setup({env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);if(allowed===null)throw new Error('down');return {success:allowed};}}}});
  const owner=newAccount(),wallet='0x'+'cd'.repeat(20);w.chain.state.contracts.set(wallet,()=>'0x1626ba7e');
  const rpc=()=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL).length;
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
  }
  const b=w.browser(),c=await body(await b.post('/api/auth/challenge',{address:wallet}));
  assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature:await owner.signMessage({message:c.message})})).status,200,'a fresh challenge signs in');
  assert.equal(rpc(),2);
  assert.deepEqual(keys,['chain:erc1271','chain:erc1271','chain:erc1271']);
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
