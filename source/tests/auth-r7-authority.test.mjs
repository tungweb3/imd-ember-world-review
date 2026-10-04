import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount} from './wallet-harness.mjs';
import {SESSION_COOKIE,FLOW_COOKIE} from '../server/auth.ts';

// Real Worker routes and migration SQL over node:sqlite. Harness keys/signatures/tokens stay in memory.
// Diagnostics deliberately contain only counts, statuses, cookie names/presence, and preservation booleans.
const rows=w=>({
  sessions:w.db.raw.prepare('SELECT rowid,created_at,expires_at,revoked_at FROM sessions ORDER BY rowid').all(),
  challenges:w.db.raw.prepare('SELECT rowid,issued_at,accept_until,used_at,invalidated_at FROM login_challenges ORDER BY rowid').all(),
});
const counts=w=>{
  const s=rows(w),now=w.clock.now();
  return {created:s.sessions.length,live:s.sessions.filter(x=>x.revoked_at===null&&x.expires_at>now).length,
    revoked:s.sessions.filter(x=>x.revoked_at!==null).length,expired:s.sessions.filter(x=>x.revoked_at===null&&x.expires_at<=now).length,
    pending:s.challenges.filter(x=>x.used_at===null&&x.invalidated_at===null&&x.accept_until>now).length,
    used:s.challenges.filter(x=>x.used_at!==null).length,invalidated:s.challenges.filter(x=>x.invalidated_at!==null).length};
};
const cookieNames=r=>r.headers.getSetCookie().map(x=>x.slice(0,x.indexOf('=')));
const cookies=b=>({session:b.jar.has(SESSION_COOKIE),flow:b.jar.has(FLOW_COOKIE)});
const sameJar=(a,b)=>a.size===b.size&&[...a].every(([k,v])=>b.get(k)===v);
const capture=(w,b)=>({rows:rows(w),counts:counts(w),jar:new Map(b.jar),cookies:cookies(b)});
function record(t,w,b,before,r,extra={}){
  t.diagnostic(JSON.stringify({schema:'imd.r7.server-authority-counts/v1',case:t.name,
    prompts:0,prompts_applicability:'N/A: server-only synthetic EOA signatures',client:{sessionKnown:'N/A',session:'N/A',phase:'N/A',cleanupResponsibility:'N/A'},
    before:before.counts,after:counts(w),cookiesBefore:before.cookies,cookiesAfter:cookies(b),
    cookieIdentityPreserved:sameJar(before.jar,b.jar),responseStatus:r.status,setCookieNames:cookieNames(r),...extra}));
}
async function signed(b,a){const x=await b.signIn(a);assert.equal(x.challenge.status,200);assert.equal(x.verify.status,200);return x;}
async function challenge(b,a){const r=await b.post('/api/auth/challenge',{address:a.address});assert.equal(r.status,200);return r.json();}
function kill(w,nonce,kind){
  const column=kind==='expired'?'expires_at':'revoked_at';
  w.db.raw.prepare(`UPDATE sessions SET ${column}=? WHERE nonce=?`).run(w.clock.now(),nonce);
}
async function refused(t,w,b,body,status=409,error='ACCOUNT_CONTEXT_CHANGED',options={}){
  const before=capture(w,b),r=await b.post('/api/auth/logout',body,options);
  record(t,w,b,before,r);
  assert.equal(r.status,status);assert.deepEqual(await r.json(),{error});
  assert.equal(cookieNames(r).length,0,'refusal emits no Set-Cookie');
  assert.equal(sameJar(before.jar,b.jar),true,'refusal preserves cookie identities');
  assert.deepEqual(rows(w),before.rows,'refusal changes neither sessions nor challenges');
  return r;
}

for(const kind of ['expired','revoked'])for(const pruned of [false,true]){
  test(`R7 authority: ${kind} exact nonce refuses with ${pruned?'pruned':'retained'} challenge and pending B`,async t=>{
    const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
    const a=await signed(b,A);await signed(other,B);kill(w,a.c.nonce,kind);
    const pending=await challenge(b,B);
    if(pruned)w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(a.c.nonce);
    await refused(t,w,b,{expectedNonce:a.c.nonce});
    const sig=await B.signMessage({message:pending.message});
    assert.equal((await b.post('/api/auth/verify',{nonce:pending.nonce,signature:sig})).status,200,'new pending B remains usable');
    assert.equal(counts(w).live,2,'existing B and pending B verification remain live');
  });
}

for(const kind of ['expired','revoked'])for(const sameWallet of [false,true]){
  test(`R7 authority: delayed ${kind} nonce response cannot clear newer ${sameWallet?'A2':'B'} cookie or pending flow`,async t=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=sameWallet?A:newAccount();
    const a=await signed(b,A);kill(w,a.c.nonce,kind);await challenge(b,B);
    const before=capture(w,b);
    // Produce the old response, but withhold applying its headers to the shared cookie jar.
    const r=await b.send(b.request('/api/auth/logout',{method:'POST',body:{expectedNonce:a.c.nonce}}));
    record(t,w,b,before,r,{ordering:'dead A request -> old response held -> newer session/pending -> old headers applied',stage:'authorityDecision'});
    const authorityRows=rows(w);
    await signed(b,B);await challenge(b,B);const newer=capture(w,b);
    b.keep(r);record(t,w,b,newer,r,{stage:'lateHeaderDelivery'});
    assert.equal(r.status,409);assert.equal(cookieNames(r).length,0);
    assert.deepEqual(authorityRows,before.rows,'dead authority changes zero rows before newer activity');
    assert.equal(sameJar(newer.jar,b.jar),true,'late refused response preserves newer cookie identities');
    assert.deepEqual(rows(w),newer.rows,'late response changes no newer session or pending challenge');
    const current=await (await b.get('/api/auth/session')).json();
    assert.equal(current.signedIn,true);assert.equal(current.address.toLowerCase(),B.address.toLowerCase());
    assert.equal(counts(w).live,1);assert.equal(counts(w).pending,1);
  });
}

for(const sameWallet of [false,true])for(const pruned of [false,true]){
  test(`R7 authority: newer ${sameWallet?'A2':'B'} token plus pending challenge refuses old ${pruned?'pruned':'retained'} nonce`,async t=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=sameWallet?A:newAccount();
    const a=await signed(b,A);await signed(b,B);await challenge(b,B);
    if(pruned)w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(a.c.nonce);
    await refused(t,w,b,{expectedNonce:a.c.nonce});
    assert.equal(counts(w).live,2);assert.equal(counts(w).pending,1);
  });
}

for(const pruned of [false,true]){
  test(`R7 authority: live matching A cleanup preserves pending B with ${pruned?'pruned':'retained'} original nonce`,async t=>{
    const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
    const a=await signed(b,A);await signed(other,B);const c=await challenge(b,B),flow=b.jar.get(FLOW_COOKIE);
    if(pruned)w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(a.c.nonce);
    const before=capture(w,b),r=await b.post('/api/auth/logout',{expectedNonce:a.c.nonce});record(t,w,b,before,r);
    assert.equal(r.status,204);assert.deepEqual(cookieNames(r),[SESSION_COOKIE]);assert.equal(b.jar.get(FLOW_COOKIE)===flow,true);
    assert.deepEqual(counts(w),{created:2,live:1,revoked:1,expired:0,pending:1,used:pruned?1:2,invalidated:0});
    const signature=await B.signMessage({message:c.message});
    assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature})).status,200);
  });
}

test('R7 authority: token-absent pending-only cleanup cancels exactly the original challenge',async t=>{
  const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
  const c=await challenge(b,A);await challenge(other,B);const before=capture(w,b);
  const r=await b.post('/api/auth/logout',{expectedNonce:c.nonce});record(t,w,b,before,r);
  assert.equal(r.status,204);assert.deepEqual(cookieNames(r),[FLOW_COOKIE]);
  assert.deepEqual(counts(w),{created:0,live:0,revoked:0,expired:0,pending:1,used:0,invalidated:1});
  assert.equal(b.jar.has(SESSION_COOKIE),false);assert.equal(b.jar.has(FLOW_COOKIE),false);
});

for(const mode of ['no-flow','newer-flow','expired','pruned','used']){
  test(`R7 authority: pending-only ${mode} refuses without any state mutation`,async t=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=newAccount();
    const c=await challenge(b,A),flow=b.jar.get(FLOW_COOKIE);
    if(mode==='no-flow')b.jar.delete(FLOW_COOKIE);
    if(mode==='newer-flow')await challenge(b,B);
    if(mode==='expired')w.db.raw.prepare('UPDATE login_challenges SET accept_until=? WHERE nonce=?').run(w.clock.now(),c.nonce);
    if(mode==='pruned')w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(c.nonce);
    if(mode==='used'){
      const signature=await A.signMessage({message:c.message});
      assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature})).status,200);
      b.jar.delete(SESSION_COOKIE);b.jar.set(FLOW_COOKIE,flow);
    }
    await refused(t,w,b,{expectedNonce:c.nonce});
  });
}

for(const tokenKind of ['empty','forged','malformed','expired','revoked','live-other-nonce']){
  test(`R7 authority: ${tokenKind} token forbids otherwise valid pending-only fallback`,async t=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=newAccount();
    if(['empty','forged','malformed'].includes(tokenKind))b.jar.set(SESSION_COOKIE,tokenKind==='empty'?'':tokenKind==='forged'?'X'.repeat(43):'bad-token');
    else {const a=await signed(b,A);if(tokenKind!=='live-other-nonce')kill(w,a.c.nonce,tokenKind);}
    const c=await challenge(b,B);await refused(t,w,b,{expectedNonce:c.nonce});
  });
}

for(const pendingOnly of [false,true]){
  test(`R7 authority: both assertions refuse with ${pendingOnly?'pending-only':'live'} context`,async t=>{
    const w=setup(),b=w.browser(),A=newAccount(),c=pendingOnly?await challenge(b,A):(await signed(b,A)).c;
    await refused(t,w,b,{expectedNonce:c.nonce,expectedAddress:A.address},400,'BAD_REQUEST');
  });
}

for(const kind of ['expired','revoked']){
  test(`R7 authority: existing expectedAddress ${kind} refusal remains 401 without cookies`,async t=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=newAccount();
    const a=await signed(b,A);kill(w,a.c.nonce,kind);await challenge(b,B);
    await refused(t,w,b,{expectedAddress:A.address},401,kind==='expired'?'SESSION_EXPIRED':'AUTH_REQUIRED');
  });
}

test('R7 authority: explicit logout remains current-cookie action',async t=>{
  const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
  await signed(b,A);await signed(other,B);await challenge(b,B);const before=capture(w,b);
  const r=await b.post('/api/auth/logout',{});record(t,w,b,before,r);
  assert.equal(r.status,204);assert.deepEqual(cookieNames(r).sort(),[SESSION_COOKIE,FLOW_COOKIE].sort());
  assert.deepEqual(counts(w),{created:2,live:1,revoked:1,expired:0,pending:0,used:2,invalidated:1});
});

test('R7 authority: explicit logout-all continues requiring live matching address',async t=>{
  const w=setup(),b=w.browser(),other=w.browser(),A=newAccount();
  await signed(b,A);await signed(other,A);await challenge(b,A);const before=capture(w,b);
  const r=await b.post('/api/auth/logout-all',{expectedAddress:A.address});record(t,w,b,before,r);
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{revoked:2});
  assert.deepEqual(cookieNames(r).sort(),[SESSION_COOKIE,FLOW_COOKIE].sort());
  assert.deepEqual(counts(w),{created:2,live:0,revoked:2,expired:0,pending:0,used:2,invalidated:1});
});
