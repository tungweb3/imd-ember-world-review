import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount} from './wallet-harness.mjs';
import {SESSION_COOKIE,FLOW_COOKIE} from '../server/auth.ts';

// Independent R5 authority checks use the actual Worker routes, production SQL and migrations.
// Wallet keys are ephemeral harness accounts; no external service or production cookie is used.
const state=w=>({
  sessions:w.db.raw.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),
  challenges:w.db.raw.prepare('SELECT * FROM login_challenges ORDER BY nonce').all(),
});
const pending=(w,nonce)=>w.db.raw.prepare('SELECT * FROM login_challenges WHERE nonce=?').get(nonce);
const live=w=>w.db.raw.prepare('SELECT address,nonce FROM sessions WHERE revoked_at IS NULL AND expires_at>? ORDER BY nonce').all(w.clock.now());
const cookieNames=r=>r.headers.getSetCookie().map(line=>line.slice(0,line.indexOf('=')));
async function signIn(b,account){
  const r=await b.signIn(account);
  assert.equal(r.challenge.status,200);
  assert.equal(r.verify.status,200);
  return r;
}
async function challenge(b,account){
  const r=await b.post('/api/auth/challenge',{address:account.address});
  assert.equal(r.status,200);
  return r.json();
}
async function unchangedRejection(w,b,path,body,status,error,options={}){
  const before=state(w),jar=[...b.jar];
  const r=await b.post(path,body,options);
  assert.equal(r.status,status);
  assert.deepEqual(await r.json(),{error});
  assert.deepEqual(r.headers.getSetCookie(),[],'rejection never writes either browser cookie');
  assert.deepEqual([...b.jar],jar,'the browser keeps its current cookie context');
  assert.deepEqual(state(w),before,'rejection changes no session or pending challenge');
}

test('R5 authority: explicit /logout {} keeps current-cookie semantics; /logout-all requires an address assertion',async()=>{
  const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
  await signIn(b,A);await signIn(other,B);
  const c=await challenge(b,B);
  await unchangedRejection(w,b,'/api/auth/logout-all',{},400,'BAD_REQUEST');
  const r=await b.post('/api/auth/logout',{});
  assert.equal(r.status,204);
  assert.deepEqual(cookieNames(r).sort(),[FLOW_COOKIE,SESSION_COOKIE].sort());
  assert.deepEqual(live(w).map(s=>s.address),[B.address.toLowerCase()]);
  assert.equal(pending(w,c.nonce).invalidated_at,w.clock.now());
});

for(const value of [null,'',17,{},'bad','0x'+'z'.repeat(40)]){
  test(`R5 authority: malformed expectedAddress ${JSON.stringify(value)} fails closed`,async()=>{
    const w=setup(),b=w.browser(),A=newAccount();
    await signIn(b,A);await challenge(b,A);
    await unchangedRejection(w,b,'/api/auth/logout',{expectedAddress:value},400,'BAD_REQUEST');
  });
}

for(const mode of ['absent','forged','malformed','revoked','expired']){
  test(`R5 authority: expectedAddress with ${mode} session cannot revoke or clear a newer pending flow`,async()=>{
    const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
    await signIn(other,B);
    if(mode==='revoked'||mode==='expired'){
      await signIn(b,A);
      if(mode==='revoked')w.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE address=?').run(w.clock.now(),A.address.toLowerCase());
      else w.db.raw.prepare('UPDATE sessions SET expires_at=? WHERE address=?').run(w.clock.now(),A.address.toLowerCase());
    }else if(mode!=='absent')b.jar.set(SESSION_COOKIE,mode==='forged'?'A'.repeat(43):'bad-token');
    await challenge(b,B);
    await unchangedRejection(w,b,'/api/auth/logout',{expectedAddress:A.address},401,mode==='expired'?'SESSION_EXPIRED':'AUTH_REQUIRED');
  });
}

test('R5 authority: expectedAddress A cannot end a request authenticated by B',async()=>{
  const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
  await signIn(other,A);await signIn(b,B);await challenge(b,A);
  await unchangedRejection(w,b,'/api/auth/logout',{expectedAddress:A.address},409,'ACCOUNT_CONTEXT_CHANGED');
});

for(const pruned of [false,true]){
  test(`R5 authority: matching expectedAddress A preserves pending B (${pruned?'pruned':'present'} original challenge)`,async()=>{
    const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
    const old=await signIn(b,A);await signIn(other,A);
    const c=await challenge(b,B),flow=b.jar.get(FLOW_COOKIE);
    if(pruned)w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(old.c.nonce);
    const before=pending(w,c.nonce);
    const r=await b.post('/api/auth/logout',{expectedAddress:A.address.toLowerCase()});
    assert.equal(r.status,204);
    assert.deepEqual(cookieNames(r),[SESSION_COOKIE]);
    assert.equal(b.jar.get(FLOW_COOKIE),flow);
    assert.deepEqual(pending(w,c.nonce),before);
    assert.equal(live(w).length,1,'a second A session remains live');
    const signature=await B.signMessage({message:c.message});
    const verified=await b.post('/api/auth/verify',{nonce:c.nonce,signature});
    assert.equal(verified.status,200,'pending B remains usable through the real verify route');
    assert.equal((await b.get('/api/auth/session')).status,200);
    assert.equal((await (await b.get('/api/auth/session')).json()).address.toLowerCase(),B.address.toLowerCase());
  });
}

for(const pruned of [false,true]){
  test(`R5 authority: matching expectedNonce A preserves pending B (${pruned?'pruned':'present'} original challenge)`,async()=>{
    const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
    const old=await signIn(b,A);await signIn(other,B);
    const c=await challenge(b,B),flow=b.jar.get(FLOW_COOKIE);
    if(pruned)w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(old.c.nonce);
    const before=pending(w,c.nonce);
    const r=await b.post('/api/auth/logout',{expectedNonce:old.c.nonce});
    assert.equal(r.status,204);
    assert.deepEqual(cookieNames(r),[SESSION_COOKIE]);
    assert.equal(b.jar.get(FLOW_COOKIE),flow);
    assert.deepEqual(pending(w,c.nonce),before);
    assert.deepEqual(live(w).map(s=>s.address),[B.address.toLowerCase()]);
    const signature=await B.signMessage({message:c.message});
    assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature})).status,200);
  });
}

for(const sameAccount of [false,true]){
  test(`R5 authority: old nonce cannot revoke a newer ${sameAccount?'A':'B'} session even after its original challenge is pruned`,async()=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=sameAccount?A:newAccount();
    const old=await signIn(b,A);await signIn(b,B);await challenge(b,B);
    w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(old.c.nonce);
    await unchangedRejection(w,b,'/api/auth/logout',{expectedNonce:old.c.nonce},409,'ACCOUNT_CONTEXT_CHANGED');
  });
}

test('R5 authority: pending-only original flow cancels exactly its own unexpired nonce and writes only the flow cookie',async()=>{
  const w=setup(),b=w.browser(),other=w.browser(),A=newAccount(),B=newAccount();
  const c=await challenge(b,A),flow=b.jar.get(FLOW_COOKIE),otherChallenge=await challenge(other,B);
  const untouched=pending(w,otherChallenge.nonce),signature=await A.signMessage({message:c.message});
  const r=await b.post('/api/auth/logout',{expectedNonce:c.nonce});
  assert.equal(r.status,204);
  assert.deepEqual(cookieNames(r),[FLOW_COOKIE]);
  assert.equal(b.jar.has(FLOW_COOKIE),false);
  assert.equal(pending(w,c.nonce).invalidated_at,w.clock.now());
  assert.deepEqual(pending(w,otherChallenge.nonce),untouched);
  assert.equal(state(w).sessions.length,0);
  b.jar.set(FLOW_COOKIE,flow);
  await unchangedRejection(w,b,'/api/auth/logout',{expectedNonce:c.nonce},409,'ACCOUNT_CONTEXT_CHANGED');
  const denied=await b.post('/api/auth/verify',{nonce:c.nonce,signature});
  assert.equal(denied.status,409,'cancelled nonce cannot create a session');
  assert.deepEqual(await denied.json(),{error:'CHALLENGE_USED'});
  assert.equal(state(w).sessions.length,0);
});

for(const mode of ['no-flow','forged-flow','newer-flow','wrong-nonce','expired','invalidated','pruned','used']){
  test(`R5 authority: pending-only cleanup refuses ${mode} context without writes or cookie clearing`,async()=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=newAccount();
    const c=await challenge(b,A),flow=b.jar.get(FLOW_COOKIE);
    let nonce=c.nonce;
    if(mode==='no-flow')b.jar.delete(FLOW_COOKIE);
    if(mode==='forged-flow')b.jar.set(FLOW_COOKIE,'f'.repeat(32));
    if(mode==='newer-flow')await challenge(b,B);
    if(mode==='wrong-nonce')nonce='f'.repeat(32);
    if(mode==='expired')w.db.raw.prepare('UPDATE login_challenges SET accept_until=? WHERE nonce=?').run(w.clock.now(),c.nonce);
    if(mode==='invalidated')w.db.raw.prepare('UPDATE login_challenges SET invalidated_at=? WHERE nonce=?').run(w.clock.now(),c.nonce);
    if(mode==='pruned')w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(c.nonce);
    if(mode==='used'){
      const signature=await A.signMessage({message:c.message});
      assert.equal((await b.post('/api/auth/verify',{nonce:c.nonce,signature})).status,200);
      b.jar.delete(SESSION_COOKIE);b.jar.set(FLOW_COOKIE,flow);
    }
    await unchangedRejection(w,b,'/api/auth/logout',{expectedNonce:nonce},409,'ACCOUNT_CONTEXT_CHANGED');
  });
}

for(const mode of ['forged','malformed','revoked','expired','live-mismatched']){
  test(`R5 authority: any ${mode} session token prevents fallback into an otherwise matching pending flow`,async()=>{
    const w=setup(),b=w.browser(),A=newAccount(),B=newAccount();
    if(mode==='forged'||mode==='malformed')b.jar.set(SESSION_COOKIE,mode==='forged'?'A'.repeat(43):'bad-token');
    else{
      await signIn(b,A);
      if(mode==='revoked')w.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE address=?').run(w.clock.now(),A.address.toLowerCase());
      if(mode==='expired')w.db.raw.prepare('UPDATE sessions SET expires_at=? WHERE address=?').run(w.clock.now(),A.address.toLowerCase());
    }
    const c=await challenge(b,B);
    await unchangedRejection(w,b,'/api/auth/logout',{expectedNonce:c.nonce},409,'ACCOUNT_CONTEXT_CHANGED');
  });
}

for(const pendingOnly of [false,true]){
  test(`R5 authority: both assertions are 400 with ${pendingOnly?'pending-only':'live session'} authority`,async()=>{
    const w=setup(),b=w.browser(),A=newAccount();
    const c=pendingOnly?await challenge(b,A):(await signIn(b,A)).c;
    await unchangedRejection(w,b,'/api/auth/logout',{expectedAddress:A.address,expectedNonce:c.nonce},400,'BAD_REQUEST');
    await unchangedRejection(w,b,'/api/auth/logout',{expectedAddress:null,expectedNonce:null},400,'BAD_REQUEST');
  });
}

test('R5 authority: pending-only cancellation retains the real route Origin gate',async()=>{
  const w=setup(),b=w.browser(),A=newAccount(),c=await challenge(b,A);
  await unchangedRejection(w,b,'/api/auth/logout',{expectedNonce:c.nonce},403,'ORIGIN_NOT_ALLOWED',{origin:'https://foreign.invalid'});
});
