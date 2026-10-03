import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount} from './wallet-harness.mjs';
import {AuthClient,noticeText} from '../src/world/auth.ts';
import {SESSION_COOKIE,FLOW_COOKIE} from '../server/auth.ts';

// Real Worker + real migrations + node:sqlite, synthetic EOA keys and fake upstreams only.
// The Browser keeps Set-Cookie BEFORE we corrupt a response body, as a real browser does.
const live=w=>w.db.raw.prepare('SELECT address FROM sessions WHERE revoked_at IS NULL AND expires_at>? ORDER BY address').all(w.clock.now()).map(r=>r.address);
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=()=>new Promise(r=>setTimeout(r,2));
const until=async f=>{for(let i=0;i<400&&!f();i++)await settle();assert.ok(f(),'ordering gate reached');};
function wallet(account){
  const events=new Map(),calls=[];let current=account;
  return {calls,request:async({method,params})=>{calls.push(method);
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [current.address];
    if(method==='personal_sign')return current.signMessage({message:{raw:params[0]}});
    throw new Error('unexpected wallet operation');},
    on:(event,fn)=>{if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);},
    removeListener:(event,fn)=>events.get(event)?.delete(fn),
    switchTo:a=>{current=a;for(const fn of events.get('accountsChanged')??[])fn([a.address]);}};
}
function client(w,b,p,intercept=async(_path,r)=>r,provider=()=>p,onProviderChange){
  const calls=[],hint={get:()=>null,set:()=>{}};
  const c=new AuthClient({provider,onProviderChange,now:w.clock.now,hint,origin:b.origin,
    fetch:async(path,init={})=>{calls.push({path,init});
      const r=b.keep(await b.send(b.request(path,{method:init.method??'GET',body:init.body,headers:init.headers})));
      return intercept(path,r);}});
  const stop=c.start();return {c,calls,stop};
}

test('AUD4-01: intended A + cookie A revokes only A, while intended A + cookie B changes no session or challenge',async()=>{
  const w=setup(),A=newAccount(),B=newAccount(),one=w.browser(),phone=w.browser(),other=w.browser();
  for(const [b,a] of [[one,A],[phone,A],[other,B]])assert.equal((await b.signIn(a)).verify.status,200);
  const pending=await (await other.post('/api/auth/challenge',{address:B.address})).json();
  const before=live(w);const mismatch=await other.post('/api/auth/logout-all',{expectedAddress:A.address});
  assert.deepEqual([mismatch.status,await mismatch.json(),mismatch.headers.getSetCookie()],[409,{error:'ACCOUNT_CONTEXT_CHANGED'},[]]);
  assert.deepEqual(live(w),before,'neither A nor B was revoked');
  assert.equal(w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(pending.nonce).invalidated_at,null);
  for(const body of [{},{expectedAddress:null},{expectedAddress:'bad'}]){
    const out=await one.post('/api/auth/logout-all',body);assert.equal(out.status,400);assert.deepEqual(live(w),before);
  }
  const out=await one.post('/api/auth/logout-all',{expectedAddress:A.address.toLowerCase()});
  assert.deepEqual([out.status,await out.json()],[200,{revoked:2}]);assert.deepEqual(live(w),[B.address.toLowerCase()]);
});

test('AUD4-01: absent/forged/dead cookie cannot turn expectedAddress into authority',async()=>{
  const w=setup(),A=newAccount(),victim=w.browser();await victim.signIn(A);
  for(const token of [undefined,'A'.repeat(43),'bad']){
    const b=w.browser();if(token)b.jar.set(SESSION_COOKIE,token);
    const r=await b.post('/api/auth/logout-all',{expectedAddress:A.address});assert.equal(r.status,401);assert.equal(live(w).length,1);
  }
  const dead=w.browser();await dead.signIn(A);await dead.post('/api/auth/logout');
  assert.equal((await dead.post('/api/auth/logout-all',{expectedAddress:A.address})).status,401);assert.equal(live(w).length,1);
});

for(const readFails of [false,true])test(`AUD4-01: stale page A never revokes shared cookie B; reconciliation ${readFails?'fails closed':'shows actual B'}`,async()=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),phone=w.browser(),p=wallet(A);let refuseRead=false;
  const t=client(w,b,p,async(path,r)=>refuseRead&&path==='/api/auth/session'?Response.json({error:'RATE_LIMITED'},{status:429}):r);
  await t.c.signIn();await phone.signIn(A);assert.equal(t.c.state.session.address,A.address.toLowerCase());
  await b.signIn(B);const before=live(w);refuseRead=readFails;
  await t.c.signOut(true);assert.deepEqual(live(w),before);
  assert.equal(JSON.parse(t.calls.findLast(x=>x.path==='/api/auth/logout-all').init.body).expectedAddress,A.address.toLowerCase());
  assert.equal(t.c.state.notice,'signout-all-context-changed');assert.equal(t.c.state.leaving,false);
  assert.equal(t.c.state.ended,null);assert.equal(t.c.state.sessionKnown,!readFails);
  assert.equal(t.c.state.session?.address??null,readFails?null:B.address.toLowerCase());
  assert.match(noticeText(t.c.state.notice,(_zh,en)=>en),/no devices were signed out/);t.stop();
});

for(const broken of ['truncated','malformed','invalid-fields','transport-after-commit'])test(`AUD4-06: committed verify + ${broken} reconciles, second click asks no second signature`,async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=wallet(A);let breakVerify=true;
  const t=client(w,b,p,async(path,r)=>{
    if(path!=='/api/auth/verify'||!r.ok||!breakVerify)return r;breakVerify=false;
    if(broken==='transport-after-commit')throw new TypeError('response transport lost after cookie');
    if(broken==='malformed')return new Response('{not json',{status:200});
    if(broken==='invalid-fields')return Response.json({address:A.address,expiresAt:'not-a-time'});
    return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"address":'));c.error(new Error('body interrupted'));}}),{status:200});
  });
  await t.c.signIn();assert.equal(t.c.state.session?.address,A.address.toLowerCase());assert.equal(t.c.state.sessionKnown,true);
  assert.equal(t.c.state.phase,'idle');assert.equal(t.c.state.notice,null);assert.equal(live(w).length,1);
  await t.c.signIn();assert.equal(p.calls.filter(x=>x==='personal_sign').length,1);assert.equal(live(w).length,1);
  assert.equal(t.calls.filter(x=>x.path==='/api/auth/verify').length,1);t.stop();
});

test('AUD4-06: failed reconciliation remains unknown; repeated click reconciles before any new prompt',async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=wallet(A);let unreadable=true,refuse=false;
  const t=client(w,b,p,async(path,r)=>{
    if(path==='/api/auth/verify'&&r.ok&&unreadable){unreadable=false;refuse=true;return new Response('{bad',{status:200});}
    return path==='/api/auth/session'&&refuse?new Response('down',{status:503}):r;
  });
  await t.c.signIn();assert.equal(t.c.state.sessionKnown,false);assert.equal(t.c.state.phase,'idle');assert.equal(live(w).length,1);
  await t.c.signIn();assert.equal(p.calls.filter(x=>x==='personal_sign').length,1,'unknown session prevents prompt');
  refuse=false;await t.c.signIn();assert.equal(t.c.state.session?.address,A.address.toLowerCase());
  assert.equal(p.calls.filter(x=>x==='personal_sign').length,1);assert.equal(live(w).length,1);t.stop();
});

test('AUD4-06: definite failed verify creates no session; uncertain delivery confirmed signed out permits one new flow',async()=>{
  for(const mode of ['definite-failure','never-reached-server']){
    const w=setup(),A=newAccount(),b=w.browser(),p=wallet(A);let fail=true;
    const real=b.send;b.send=async r=>{
      if(new URL(r.url).pathname==='/api/auth/verify'&&fail){fail=false;
        if(mode==='never-reached-server')throw new TypeError('connection lost before send');
        return Response.json({error:'SIGNATURE_INVALID'},{status:401});}
      return real(r);
    };
    const t=client(w,b,p);await t.c.signIn();assert.equal(live(w).length,0);assert.equal(t.c.state.session,null);
    assert.equal(t.c.state.phase,'idle');assert.equal(t.c.state.sessionKnown,true);
    await t.c.signIn();assert.equal(live(w).length,1);assert.equal(p.calls.filter(x=>x==='personal_sign').length,2);t.stop();
  }
});

for(const change of ['account','provider'])test(`AUD4-06: ${change} switch during uncertain-verify reconciliation cannot restore A or prompt again`,async()=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),pa=wallet(A),pb=wallet(B),gate=defer();let active=pa,changed=()=>{},held=false,afterVerify=false;
  const t=client(w,b,pa,async(path,r)=>{
    if(path==='/api/auth/verify'&&r.ok){afterVerify=true;return new Response('{bad',{status:200});}
    if(path==='/api/auth/session'&&afterVerify&&!held){held=true;await gate.promise;}return r;
  },()=>active,fn=>{changed=fn;return()=>{};});
  const flow=t.c.signIn();await until(()=>held);
  if(change==='account')pa.switchTo(B);else{active=pb;changed();}
  gate.resolve();await flow;await until(()=>live(w).length===0);await settle();
  assert.equal(t.c.state.session,null);assert.notEqual(t.c.state.account,A.address.toLowerCase());
  assert.equal(pa.calls.filter(x=>x==='personal_sign').length,1);assert.equal(pb.calls.filter(x=>x==='personal_sign').length,0);
  assert.equal(t.c.state.phase,'idle');t.stop();
});

for(const change of ['account','provider','teardown'])test(`AUD4-06: ${change} abandonment + first logout complete before late-cookie fetch failure still revokes only the abandoned session`,async()=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),pa=wallet(A),pb=wallet(B),gate=defer();
  let active=pa,changed=()=>{},held=false;const real=b.send;
  b.send=async request=>{const r=await real(request);
    if(new URL(request.url).pathname==='/api/auth/verify'&&r.ok&&!held){held=true;await gate.promise;
      b.keep(r);throw new TypeError('late headers installed cookie, then fetch failed');}return r;};
  const t=client(w,b,pa,async(_p,r)=>r,()=>active,fn=>{changed=fn;return()=>{};});
  const flow=t.c.signIn();await until(()=>held);assert.equal(live(w).length,1);assert.equal(b.jar.has(SESSION_COOKIE),false);
  if(change==='account')pa.switchTo(B);else if(change==='provider'){active=pb;changed();}else t.stop();
  if(change!=='teardown')await until(()=>t.calls.some(x=>x.path==='/api/auth/logout'));
  await settle();assert.equal(live(w).length,1,'early logout had no session cookie to revoke');
  gate.resolve();await flow;await until(()=>live(w).length===0);
  const cleanup=t.calls.findLast(x=>x.path==='/api/auth/logout');
  assert.match(JSON.parse(cleanup.init.body).expectedNonce,/^[\da-f]{32}$/);
  assert.equal(t.c.state.session,null);assert.equal(pa.calls.filter(x=>x==='personal_sign').length,1);
  assert.equal(pb.calls.filter(x=>x==='personal_sign').length,0);t.stop();
});

test('AUD4-06: conditional abandoned logout preserves a newer session of A or B and its cookie/flow',async()=>{
  for(const sameWallet of [true,false]){
    const w=setup(),A=newAccount(),B=sameWallet?A:newAccount(),b=w.browser();
    const old=await b.signIn(A);assert.equal(old.verify.status,200);const newer=await b.signIn(B);assert.equal(newer.verify.status,200);
    const before=live(w),cookie=b.cookie(),pending=await (await b.post('/api/auth/challenge',{address:B.address})).json();
    const r=await b.post('/api/auth/logout',{expectedNonce:old.c.nonce});
    assert.deepEqual([r.status,await r.json(),r.headers.getSetCookie()],[409,{error:'ACCOUNT_CONTEXT_CHANGED'},[]]);
    assert.deepEqual(live(w),before);assert.equal(b.jar.get(SESSION_COOKIE),cookie.match(/__Host-imd_session=([^;]+)/)[1]);
    assert.equal(w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(pending.nonce).invalidated_at,null);
    assert.equal((await b.post('/api/auth/logout',{expectedNonce:newer.c.nonce})).status,204);
    assert.equal(live(w).length,1,'only the session named by matching cookie + nonce was ended');
  }
});

test('AUD4-06: matching abandoned session cleanup preserves a newer pending challenge and its flow cookie',async()=>{
  for(const pruneOldChallenge of [false,true]){
    const w=setup(),A=newAccount(),B=newAccount(),b=w.browser();
    const old=await b.signIn(A);assert.equal(old.verify.status,200);
    const pending=await (await b.post('/api/auth/challenge',{address:B.address})).json(),flow=b.jar.get(FLOW_COOKIE);
    if(pruneOldChallenge)w.db.raw.prepare('DELETE FROM login_challenges WHERE nonce=?').run(old.c.nonce);
    const r=await b.post('/api/auth/logout',{expectedNonce:old.c.nonce});
    assert.equal(r.status,204);assert.equal(live(w).length,0,'abandoned A session revoked');
    assert.equal(b.jar.get(FLOW_COOKIE),flow,'new B challenge flow preserved');
    assert.equal(r.headers.getSetCookie().length,1,'clear session only, not a newer challenge cookie');
    assert.equal(w.db.raw.prepare('SELECT invalidated_at FROM login_challenges WHERE nonce=?').get(pending.nonce).invalidated_at,null);
    const signature=await B.signMessage({message:pending.message});
    assert.equal((await b.post('/api/auth/verify',{nonce:pending.nonce,signature})).status,200);
    assert.deepEqual(live(w),[B.address.toLowerCase()]);
  }
});
