import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain} from './wallet-harness.mjs';
import {AuthClient,statusOf} from '../src/world/auth.ts';
import {SESSION_COOKIE,FLOW_COOKIE} from '../server/auth.ts';

// R5 LOW-1..3: unchanged real Worker/routes/migrations over node:sqlite. EOA test keys are
// generated in memory and actually sign the exact server SIWE message. Upstreams/providers
// are local fixtures, not a browser or production/real-wallet verification. No tokens/keys
// are written to the evidence output; only cookie presence/equality and row counts appear.
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const settle=()=>new Promise(r=>setTimeout(r,2));
async function until(f){for(let i=0;i<300&&!f();i++)await settle();assert.ok(f(),'event ordering gate reached');}
const signatures=p=>p.calls.filter(c=>c==='personal_sign').length;
function provider(account){
  let current=account;const events=new Map(),calls=[];
  return {calls,async request({method,params}){calls.push(method);
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [current.address];
    if(method==='personal_sign'){assert.equal(params[1],current.address.toLowerCase());return current.signMessage({message:{raw:params[0]}});}
    throw new Error('unexpected wallet operation '+method);},
    on:(event,fn)=>{if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);},
    removeListener:(event,fn)=>events.get(event)?.delete(fn),
    switchTo:account=>{current=account;for(const fn of events.get('accountsChanged')??[])fn([account.address]);}};
}
function tab(w,b,p,{intercept=async(_path,r)=>r,beforeSend=async()=>{},getProvider=()=>p,onProviderChange,env,channel}={}){
  const events=[],states=[];let hint=null;
  const c=new AuthClient({provider:getProvider,onProviderChange,now:w.clock.now,origin:b.origin,env,channel,
    hint:{get:()=>hint,set:v=>{hint=v;}},
    fetch:async(path,init={})=>{
      const event={order:events.length+1,at:w.clock.now(),path,method:init.method??'GET',
        body:init.body?JSON.parse(init.body):null};events.push(event);
      await beforeSend(path,init);
      // The jar consumes Set-Cookie before response corruption/delay, as browser headers do.
      const r=b.keep(await b.send(b.request(path,{method:event.method,body:init.body,headers:init.headers})));
      event.status=r.status;event.setCookieCount=r.headers.getSetCookie().length;
      const out=await intercept(path,r,init);event.finished=true;return out;
    }});
  c.subscribe(()=>states.push({phase:c.state.phase,known:c.state.sessionKnown,address:c.state.session?.address??null}));
  return {c,events,states,stop:c.start()};
}
function rows(w){
  const sessions=w.db.raw.prepare('SELECT nonce,address,expires_at,revoked_at FROM sessions ORDER BY rowid').all();
  const challenges=w.db.raw.prepare('SELECT nonce,used_at,invalidated_at FROM login_challenges ORDER BY rowid').all();
  return {sessions,challenges,counts:{created:sessions.length,
    live:sessions.filter(s=>s.revoked_at===null&&s.expires_at>w.clock.now()).length,
    revoked:sessions.filter(s=>s.revoked_at!==null).length,
    pending:challenges.filter(c=>c.used_at===null&&c.invalidated_at===null).length,
    invalidated:challenges.filter(c=>c.invalidated_at!==null).length}};
}
function evidence(t,label,w,b,tab,ps,extra={}){
  const {counts}=rows(w);t.diagnostic('R5_EVIDENCE '+JSON.stringify({label,at:w.clock.now(),counts,
    prompts:ps.map(signatures),cookie:{session:b.jar.has(SESSION_COOKIE),flow:b.jar.has(FLOW_COOKIE)},
    client:{phase:tab.c.state.phase,known:tab.c.state.sessionKnown,session:!!tab.c.state.session},
    events:tab.events.map(e=>({order:e.order,path:e.path,status:e.status,finished:!!e.finished,
      expectedNonce:e.body?.expectedNonce??null,expectedAddress:e.body?.expectedAddress??null,setCookieCount:e.setCookieCount})),
    states:tab.states.map(s=>({phase:s.phase,known:s.known,session:!!s.address})),...extra}));
}
async function uncertain(){
  const w=setup(),A=newAccount(),B=newAccount(),C=newAccount(),b=w.browser(),pa=provider(A),pb=provider(B),gate=defer();
  let current=pa,notify=()=>{},afterVerify=false,held=false;
  const t=tab(w,b,pa,{getProvider:()=>current,onProviderChange:fn=>{notify=fn;return()=>{};},
    intercept:async(path,r)=>{
      if(path==='/api/auth/verify'&&r.ok){afterVerify=true;return new Response('{',{status:200});}
      if(path==='/api/auth/session'&&afterVerify&&!held){held=true;await gate.promise;}return r;
    }});
  const signIn=t.c.signIn();await until(()=>held);
  const old=rows(w).sessions[0];assert.ok(old);assert.equal(signatures(pa),1);assert.equal(t.c.state.phase,'verifying');
  return {w,A,B,C,b,pa,pb,t,gate,signIn,old,change:(kind,target=B)=>{
    if(kind==='account')pa.switchTo(target);else{current=provider(target);notify();}
  }};
}

for(const kind of ['account','provider'])for(const replacement of ['newer-B','same-wallet-newer','pending-only'])
test(`R5 LOW-1: ${kind} switch during held uncertain read preserves ${replacement} and its pending challenge`,async T=>{
  const q=await uncertain(),{w,A,B,C,b,pa,pb,t,gate,signIn,old}=q;
  try{
    const next=replacement==='same-wallet-newer'?A:B;
    if(replacement!=='pending-only')assert.equal((await b.signIn(next)).verify.status,200);
    const pending=await (await b.post('/api/auth/challenge',{address:next.address})).json();
    const cookies=new Map(b.jar);
    q.change(kind,replacement==='same-wallet-newer'?C:B);
    await until(()=>t.events.some(e=>e.path==='/api/auth/logout'&&e.finished));
    gate.resolve();await signIn;await until(()=>t.events.filter(e=>e.path==='/api/auth/logout').every(e=>e.finished));
    const out=rows(w);evidence(T,`${kind}/${replacement}`,w,b,t,[pa,pb],{
      newerSessionCookiePreserved:b.jar.get(SESSION_COOKIE)===cookies.get(SESSION_COOKIE),
      newerFlowCookiePreserved:b.jar.get(FLOW_COOKIE)===cookies.get(FLOW_COOKIE)});
    assert.equal(out.challenges.find(c=>c.nonce===pending.nonce).invalidated_at,null,'newer challenge remains usable');
    assert.equal(b.jar.get(FLOW_COOKIE),cookies.get(FLOW_COOKIE),'newer flow cookie preserved');
    const cleanups=t.events.filter(e=>e.path==='/api/auth/logout');assert.ok(cleanups.length>=1);
    assert.ok(cleanups.every(e=>e.body.expectedNonce===old.nonce),'automatic cleanup is bound to original nonce');
    if(replacement==='pending-only'){
      assert.equal(out.sessions[0].revoked_at,w.clock.now());assert.equal(out.counts.live,0);
      assert.equal(b.jar.has(SESSION_COOKIE),false,'matching abandoned A cookie cleared');
      // The protected pending challenge really remains verifiable, not merely an untouched DB field.
      const signature=await next.signMessage({message:pending.message});
      assert.equal((await b.post('/api/auth/verify',{nonce:pending.nonce,signature})).status,200);
      assert.deepEqual(rows(w).counts,{created:2,live:1,revoked:1,pending:0,invalidated:0});
    }else{
      assert.equal(out.sessions[1].revoked_at,null,'newer shared-cookie session retained');
      assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));
      assert.equal(out.counts.created,2);assert.equal(out.counts.live,2);assert.equal(out.counts.revoked,0);
      assert.ok(cleanups.every(e=>e.status===409),'nonce/cookie mismatch changes no cookie or row');
    }
    assert.equal(signatures(pa),1,'cancelled old flow never prompts again');
    assert.equal(signatures(pb),0);
  }finally{gate.resolve();await signIn;t.stop();}
});

test('R5 LOW-1: stale A display + failed read + switch to C cannot revoke cookie B or its new challenge',async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),C=newAccount(),b=w.browser(),p=provider(A);let failRead=false;
  const t=tab(w,b,p,{intercept:async(path,r)=>path==='/api/auth/session'&&failRead?Response.json({error:'RATE_LIMITED'},{status:429}):r});
  try{
    await t.c.signIn();await b.signIn(B);
    const pending=await (await b.post('/api/auth/challenge',{address:B.address})).json(),cookies=new Map(b.jar);
    failRead=true;await t.c.restore();assert.equal(t.c.state.session.address,A.address.toLowerCase());assert.equal(t.c.state.sessionKnown,false);
    p.switchTo(C);await until(()=>t.events.some(e=>e.path==='/api/auth/logout'&&e.finished));await settle();
    evidence(T,'stale-display/failed-read/switch-C',w,b,t,[p]);
    assert.deepEqual(rows(w).counts,{created:2,live:2,revoked:0,pending:1,invalidated:0});
    assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));assert.equal(b.jar.get(FLOW_COOKIE),cookies.get(FLOW_COOKIE));
    assert.equal(rows(w).challenges.find(c=>c.nonce===pending.nonce).invalidated_at,null);
    const cleanup=t.events.find(e=>e.path==='/api/auth/logout');assert.equal(cleanup.status,409);
    assert.equal(cleanup.body.expectedAddress,A.address.toLowerCase(),'displayed address is consistency assertion only');
    assert.equal(signatures(p),1);
  }finally{t.stop();}
});

for(const replacement of ['matching-A','newer-B'])test(`R5 LOW-2: teardown of held recovery conditionally cleans ${replacement}, without post-stop UI updates`,async T=>{
  const q=await uncertain(),{w,B,b,pa,t,gate,signIn}=q;
  try{
    let pending,cookies;
    if(replacement==='newer-B'){
      assert.equal((await b.signIn(B)).verify.status,200);
      pending=await (await b.post('/api/auth/challenge',{address:B.address})).json();cookies=new Map(b.jar);
    }
    t.stop();const notifications=t.states.length;
    gate.resolve();await signIn;for(let i=0;i<20;i++)await settle();
    evidence(T,`teardown/${replacement}`,w,b,t,[pa],{postStopNotifications:t.states.length-notifications});
    assert.ok(t.events.some(e=>e.path==='/api/auth/logout'&&e.finished),'abandoned flow still sends conditional security cleanup');
    assert.equal(t.states.length,notifications,'cleanup completion cannot notify a disposed UI');
    if(replacement==='matching-A'){
      assert.deepEqual(rows(w).counts,{created:1,live:0,revoked:1,pending:0,invalidated:0});
      assert.equal(b.jar.has(SESSION_COOKIE),false);assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
    }else{
      assert.deepEqual(rows(w).counts,{created:2,live:2,revoked:0,pending:1,invalidated:0});
      assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));assert.equal(b.jar.get(FLOW_COOKIE),cookies.get(FLOW_COOKIE));
      assert.equal(rows(w).challenges.find(c=>c.nonce===pending.nonce).invalidated_at,null);
      assert.equal((await b.get('/api/auth/session').then(r=>r.json())).address.toLowerCase(),B.address.toLowerCase());
    }
    assert.equal(signatures(pa),1);
  }finally{gate.resolve();await signIn;}
});

for(const action of ['account','provider','stop'])for(const replacement of ['matching-A','newer-B'])
test(`R5 LOW-1/2: ${action} after failed read returned to UNKNOWN idle cleans only ${replacement}`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),pa=provider(A),pb=provider(B);
  let current=pa,notify=()=>{},broken=false;
  const t=tab(w,b,pa,{getProvider:()=>current,onProviderChange:fn=>{notify=fn;return()=>{};},intercept:async(path,r)=>{
    if(path==='/api/auth/verify'&&r.ok){broken=true;return new Response('{',{status:200});}
    return broken&&path==='/api/auth/session'?Response.json({error:'AUTH_UNAVAILABLE'},{status:503}):r;
  }});
  try{
    await t.c.signIn();assert.equal(t.c.state.phase,'idle');assert.equal(t.c.state.sessionKnown,false);
    const nonce=rows(w).sessions[0].nonce;let pending,cookies;
    if(replacement==='newer-B'){
      await b.signIn(B);pending=await (await b.post('/api/auth/challenge',{address:B.address})).json();cookies=new Map(b.jar);
    }
    if(action==='account')pa.switchTo(B);else if(action==='provider'){current=pb;notify();}else t.stop();
    const afterStop=t.states.length;
    await until(()=>t.events.some(e=>e.path==='/api/auth/logout'&&e.finished));for(let i=0;i<4;i++)await settle();
    evidence(T,`unknown-idle/${action}/${replacement}`,w,b,t,[pa,pb],{postStopNotifications:t.states.length-afterStop});
    assert.ok(t.events.filter(e=>e.path==='/api/auth/logout').every(e=>e.body.expectedNonce===nonce));
    if(action==='stop')assert.equal(t.states.length,afterStop,'disposed UNKNOWN client stays quiet');
    if(replacement==='matching-A'){
      assert.deepEqual(rows(w).counts,{created:1,live:0,revoked:1,pending:0,invalidated:0});assert.equal(b.jar.has(SESSION_COOKIE),false);
    }else{
      assert.deepEqual(rows(w).counts,{created:2,live:2,revoked:0,pending:1,invalidated:0});
      assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));assert.equal(b.jar.get(FLOW_COOKIE),cookies.get(FLOW_COOKIE));
      assert.equal(rows(w).challenges.find(c=>c.nonce===pending.nonce).invalidated_at,null);
    }
    assert.equal(signatures(pa),1);assert.equal(signatures(pb),0);
  }finally{t.stop();}
});

for(const sameWallet of [false,true])test(`R5 LOW-2 / R8 LOW-4: stop/restart preserves ${sameWallet?'same-wallet':'other-wallet'} newer session; old cleanup requests only a current-life canonical read`,async T=>{
  const w=setup(),A=newAccount(),B=sameWallet?A:newAccount(),b=w.browser(),p=provider(A),readGate=defer(),cleanupGate=defer();
  let afterVerify=false,readHeld=false,holdCleanup=true;
  const t=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/logout'&&holdCleanup)await cleanupGate.promise;},
    intercept:async(path,r)=>{
      if(path==='/api/auth/verify'&&r.ok){afterVerify=true;return new Response('{',{status:200});}
      if(path==='/api/auth/session'&&afterVerify&&!readHeld){readHeld=true;await readGate.promise;}return r;
    }});
  const flow=t.c.signIn();let stopAgain=()=>{};
  try{
    await until(()=>readHeld);t.stop();
    await b.signIn(B);const pending=await (await b.post('/api/auth/challenge',{address:B.address})).json(),cookies=new Map(b.jar);
    stopAgain=t.c.start();
    await until(()=>t.c.state.session?.address===B.address.toLowerCase()&&!t.c.state.checking);
    const notifications=t.states.length,reads=t.events.filter(e=>e.path==='/api/auth/session').length;
    // R8 LOW-4 deliberately replaces the old blanket "no read after restart" expectation. The old GET body still
    // cannot install a view; detached cleanup completion asks the active lifetime for fresh canonical knowledge.
    readGate.resolve();await flow;
    assert.equal(t.states.length,notifications,'the stopped read/body cannot directly update the restarted UI');
    holdCleanup=false;cleanupGate.resolve();
    await until(()=>t.events.filter(e=>e.path==='/api/auth/logout').every(e=>e.finished)
      &&t.events.filter(e=>e.path==='/api/auth/session').length===reads+1
      &&t.events.filter(e=>e.path==='/api/auth/session').every(e=>e.finished)
      &&t.c.state.sessionKnown&&!t.c.state.checking);
    evidence(T,`stop-restart/${sameWallet?'same-wallet':'other-wallet'}`,w,b,t,[p],{
      postRestartNotifications:t.states.length-notifications,currentLifeCanonicalReads:t.events.filter(e=>e.path==='/api/auth/session').length-reads});
    assert.equal(t.events.filter(e=>e.path==='/api/auth/session').length,reads+1,'one active-lifetime canonical read reconciles the old refusal');
    assert.ok(t.states.slice(notifications).every(s=>s.address===B.address.toLowerCase()),'reconciliation never installs the stopped session');
    assert.equal(t.c.state.session.address,B.address.toLowerCase());
    assert.deepEqual(rows(w).counts,{created:2,live:2,revoked:0,pending:1,invalidated:0});
    assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));assert.equal(b.jar.get(FLOW_COOKIE),cookies.get(FLOW_COOKIE));
    assert.equal(rows(w).challenges.find(c=>c.nonce===pending.nonce).invalidated_at,null);assert.equal(signatures(p),1);
  }finally{holdCleanup=false;readGate.resolve();cleanupGate.resolve();await flow;stopAgain();t.stop();}
});

// Wire JSON cannot represent NaN; the NaN literal is malformed. 1e400/-1e400 are valid
// JSON number literals parsed as +/-Infinity, so these exercise finite-number validation.
const invalidReplies=[
  ['empty-object',()=>Response.json({})],['array',()=>Response.json([])],['null',()=>Response.json(null)],
  ['missing-fields',()=>Response.json({signedIn:true})],
  ['invalid-address',(_a,exp)=>Response.json({signedIn:true,address:'bad',expiresAt:exp})],
  ['null-address',(_a,exp)=>Response.json({signedIn:true,address:null,expiresAt:exp})],
  ['string-expiry',(a,exp)=>Response.json({signedIn:true,address:a,expiresAt:String(exp)})],
  ['missing-expiry',a=>Response.json({signedIn:true,address:a})],
  ['null-expiry',a=>Response.json({signedIn:true,address:a,expiresAt:null})],
  ['zero-expiry',a=>Response.json({signedIn:true,address:a,expiresAt:0})],
  ['negative-expiry',a=>Response.json({signedIn:true,address:a,expiresAt:-1})],
  ['fractional-expiry',a=>Response.json({signedIn:true,address:a,expiresAt:1.5})],
  ['unsafe-integer-expiry',a=>Response.json({signedIn:true,address:a,expiresAt:9007199254740992})],
  ['positive-infinity',a=>new Response(`{"signedIn":true,"address":"${a}","expiresAt":1e400}`)],
  ['negative-infinity',a=>new Response(`{"signedIn":true,"address":"${a}","expiresAt":-1e400}`)],
  ['NaN-literal',a=>new Response(`{"signedIn":true,"address":"${a}","expiresAt":NaN}`)],
  ['signedIn-string',(a,exp)=>Response.json({signedIn:'true',address:a,expiresAt:exp})],
  ['signedOut-string',()=>Response.json({signedIn:'false'})],
  ['signedIn-number',(a,exp)=>Response.json({signedIn:1,address:a,expiresAt:exp})],
  ['signedIn-null',()=>Response.json({signedIn:null})],
  ['missing-signedIn',(a,exp)=>Response.json({address:a,expiresAt:exp})],
  ['malformed',()=>new Response('{bad')],
  ['truncated',()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"signedIn":'));c.error(new Error('body interrupted'));}}))],
  ['http-503',()=>Response.json({error:'AUTH_UNAVAILABLE'},{status:503})],
  ['transport-timeout',()=>{throw new DOMException('synthetic transport timeout','TimeoutError');}],
];
for(const [label,reply] of invalidReplies)test(`R5 LOW-3: ${label} recovery stays UNKNOWN; repeated click reads first and creates no duplicate`,async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let breakVerify=true,corrupt=false;
  const t=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'&&breakVerify&&r.ok){breakVerify=false;corrupt=true;return new Response('{',{status:200});}
    return path==='/api/auth/session'&&corrupt?reply(A.address,w.clock.now()+604800000):r;
  }});
  try{
    await t.c.signIn();const first={known:t.c.state.sessionKnown,session:t.c.state.session,phase:t.c.state.phase,prompts:signatures(p),counts:rows(w).counts};
    evidence(T,`schema/${label}/first`,w,b,t,[p]);
    const before=t.events.length;await t.c.signIn();
    evidence(T,`schema/${label}/second-click`,w,b,t,[p]);
    assert.equal(first.known,false,'invalid response cannot prove absence or presence');
    assert.equal(first.session,null);assert.equal(first.phase,'idle');assert.equal(first.prompts,1);
    assert.equal(first.counts.live,1);
    assert.equal(t.c.state.sessionKnown,false,'second failed read remains unknown');
    assert.equal(t.events[before].path,'/api/auth/session','next click reads before considering a prompt');
    assert.equal(signatures(p),1);assert.equal(rows(w).counts.created,1);
    corrupt=false;const recoveredAt=t.events.length;await t.c.signIn();
    evidence(T,`schema/${label}/recovered`,w,b,t,[p]);
    assert.equal(t.events[recoveredAt].path,'/api/auth/session');assert.equal(t.c.state.sessionKnown,true);
    assert.equal(t.c.state.session.address,A.address.toLowerCase());assert.equal(signatures(p),1);
    assert.deepEqual(rows(w).counts,{created:1,live:1,revoked:0,pending:0,invalidated:0});
    assert.equal(t.events.filter(e=>e.path==='/api/auth/challenge').length,1);
    assert.equal(t.events.filter(e=>e.path==='/api/auth/verify').length,1);
  }finally{t.stop();}
});

test('R5 LOW-3 controls: explicit signedIn:false permits one flow; valid signedIn:true restores the cookie without a new prompt',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),t=tab(w,b,p);
  try{
    await t.c.restore();assert.equal(t.c.state.sessionKnown,true);assert.equal(t.c.state.session,null);
    await t.c.signIn();assert.equal(signatures(p),1);await t.c.restore();
    evidence(T,'schema/valid-controls',w,b,t,[p]);
    assert.equal(t.c.state.sessionKnown,true);assert.equal(t.c.state.session.address,A.address.toLowerCase());
    await t.c.signIn();assert.equal(signatures(p),1);assert.equal(rows(w).counts.created,1);
  }finally{t.stop();}
});

for(const confirmed of ['PRESENT','ABSENT'])test(`R5 retained UNKNOWN flow: two failed reads then confirmed ${confirmed}; normal stop never revokes an accepted session`,async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let corruptVerify=true,failRead=false;
  const t=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'&&r.ok&&corruptVerify){corruptVerify=false;failRead=true;return new Response('{',{status:200});}
    return path==='/api/auth/session'&&failRead?Response.json({error:'AUTH_UNAVAILABLE'},{status:503}):r;
  }});
  try{
    await t.c.signIn();assert.equal(t.c.state.sessionKnown,false);
    await t.c.signIn();assert.equal(t.c.state.sessionKnown,false);assert.equal(signatures(p),1);
    assert.equal(t.events.filter(e=>e.path==='/api/auth/session'&&e.status===200).length,4,'v1.1 initial, own click preflight, then two failed actual recovery/click routes');
    if(confirmed==='ABSENT')assert.equal((await b.post('/api/auth/logout',{})).status,204,'explicit fixture logout proves absence without automatic cleanup');
    failRead=false;await t.c.signIn();
    assert.equal(t.c.state.sessionKnown,true);assert.equal(t.c.state.session.address,A.address.toLowerCase());
    assert.equal(signatures(p),confirmed==='PRESENT'?1:2,'only proven absence permits one new signature');
    const cookies=new Map(b.jar),logoutCount=t.events.filter(e=>e.path==='/api/auth/logout').length;
    t.stop();const stoppedNotifications=t.states.length;for(let i=0;i<12;i++)await settle();
    evidence(T,`retained-unknown/confirmed-${confirmed}/stop`,w,b,t,[p],{postStopNotifications:t.states.length-stoppedNotifications});
    assert.equal(t.events.filter(e=>e.path==='/api/auth/logout').length,logoutCount,'accepted flow no longer carries abandonment cleanup responsibility');
    assert.equal(t.states.length,stoppedNotifications);
    assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));
    assert.deepEqual(rows(w).counts,confirmed==='PRESENT'?{created:1,live:1,revoked:0,pending:0,invalidated:0}:{created:2,live:1,revoked:1,pending:0,invalidated:0});
    assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,true,'normal stop leaves accepted session usable');
  }finally{t.stop();}
});

test('R5 v1.1 preflight logout: late 204 after restart schedules current-life canonical reconciliation and preserves newer same-address row',async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(B),gate=defer(),channels=[];
  let held=false,arms=0,clears=0;
  const env={set:(fn,ms)=>{arms++;return {fn,ms};},clear:()=>{clears++;},onVisible:()=>()=>{}};
  const channel=()=>{const ch={messages:[],closed:false,postMessage(v){this.messages.push(v);},close(){this.closed=true;},addEventListener(){}};channels.push(ch);return ch;};
  await b.signIn(A);
  const t=tab(w,b,p,{env,channel,intercept:async(path,r)=>{
    if(path==='/api/auth/logout'&&!held){assert.equal(r.status,204);held=true;await gate.promise;}return r;
  }});
  let stopAgain=()=>{},flow=Promise.resolve();
  try{
    await until(()=>t.c.state.session?.address===A.address.toLowerCase()&&t.c.state.account===B.address.toLowerCase()&&!t.c.state.checking);
    flow=t.c.signIn();await until(()=>held);
    const preflight=t.events.find(e=>e.path==='/api/auth/logout');assert.equal(preflight.body.expectedAddress,A.address.toLowerCase());
    assert.deepEqual(rows(w).counts,{created:1,live:0,revoked:1,pending:0,invalidated:0},'old A was conditionally revoked before response gate');
    t.stop();assert.equal(channels[0].closed,true);
    await b.signIn(A);const cookie=b.jar.get(SESSION_COOKIE);
    const oldView=t.c.state.session;
    stopAgain=t.c.start();await until(()=>t.c.state.session!==oldView&&t.c.state.session?.address===A.address.toLowerCase()&&!t.c.state.checking);
    assert.equal(channels.length,2);assert.equal(channels[1].closed,false);
    const accepted=t.c.state.session,notifications=t.states.length,armed=arms,cleared=clears;
    const reads=t.events.filter(e=>e.path==='/api/auth/session').length,newMessages=channels[1].messages.length;
    gate.resolve();await flow;
    await until(()=>t.events.filter(e=>e.path==='/api/auth/session').length>reads&&t.c.state.sessionKnown&&!t.c.state.checking);
    evidence(T,'preflight-204/stop-restart/same-address',w,b,t,[p],{
      postRestartNotifications:t.states.length-notifications,newChannelBroadcasts:channels[1].messages.length-newMessages,
      timerArms:arms-armed,timerClears:clears-cleared});
    // v1.1 AUTH-I7 requires a current-life reread after detached cleanup completion. A newly read object is allowed;
    // its authority must come from the current cookie, never the old address/expiry tuple or old completion closure.
    assert.deepEqual(t.c.state.session,accepted,'canonical current-cookie session remains the newer same-address session');
    assert.ok(t.states.length>notifications);assert.equal(channels[1].messages.length,newMessages);
    assert.equal(t.events.filter(e=>e.path==='/api/auth/session').length,reads+1,'one current-life canonical reconciliation');
    assert.equal(b.jar.get(SESSION_COOKIE),cookie);
    assert.deepEqual(rows(w).counts,{created:2,live:1,revoked:1,pending:0,invalidated:0});
    assert.equal(signatures(p),0,'cancelled preflight never asks wallet B to sign');
    assert.equal(t.events.filter(e=>e.path==='/api/auth/challenge').length,0);
  }finally{gate.resolve();await flow;stopAgain();t.stop();}
});

for(const temporarilyUnknown of [false,true])test(`R5 automatic cleanup same generation: early 204 headers + new same-address/expiry A2 cookie is reconciled ${temporarilyUnknown?'through UNKNOWN':'as owner'}`,async T=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),owners=Array(2000).fill('0x'+'0'.repeat(40));owners[361]=a;
  const w=setup({imd:fakeImd({seats:{361:'51320'},owners,online:[361]}),chain:fakeChain({owners:{361:a}})}),b=w.browser(),p=provider(A),gate=defer();
  let held=false,failRead=false;
  const t=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/logout'&&!held){assert.equal(r.status,204);held=true;await gate.promise;}
    return path==='/api/auth/session'&&failRead?Response.json({error:'AUTH_UNAVAILABLE'},{status:503}):r;
  }});
  try{
    await t.c.signIn();assert.equal(statusOf(t.c.state,w.clock.now()),'owner');
    const firstExpiry=t.c.state.session.expiresAt;
    p.switchTo(B);await until(()=>held);assert.equal(b.jar.has(SESSION_COOKIE),false,'old 204 headers were already consumed before A2 exists');
    await b.signIn(A);const cookie=b.jar.get(SESSION_COOKIE);await t.c.restore();p.switchTo(A);
    assert.equal(statusOf(t.c.state,w.clock.now()),'owner');assert.equal(t.c.state.session.expiresAt,firstExpiry,'same address AND same expiry cannot identify a session token');
    const reads=t.events.filter(e=>e.path==='/api/auth/session').length;
    failRead=temporarilyUnknown;gate.resolve();
    await until(()=>t.events.filter(e=>e.path==='/api/auth/session').length>reads);
    await until(()=>t.events.filter(e=>e.path==='/api/auth/session').at(-1).finished);for(let i=0;i<4;i++)await settle();
    if(temporarilyUnknown){
      assert.equal(t.c.state.sessionKnown,false);assert.notEqual(statusOf(t.c.state,w.clock.now()),'owner','failed reconciliation withdraws the stale owner view');
      const before=t.events.length;await t.c.signIn();assert.equal(t.events[before].path,'/api/auth/session');
      assert.equal(t.c.state.sessionKnown,false);assert.equal(signatures(p),1,'failed read cannot prompt again despite retained address');
      failRead=false;await t.c.signIn();
    }
    await until(()=>t.c.state.sessionKnown&&!t.c.state.checking);
    evidence(T,`same-gen-204/early-headers/new-A2/${temporarilyUnknown?'UNKNOWN-then-owner':'owner'}`,w,b,t,[p]);
    assert.equal(statusOf(t.c.state,w.clock.now()),'owner');assert.equal(t.c.state.session.address,a);
    assert.equal(b.jar.get(SESSION_COOKIE),cookie,'new A2 cookie is unchanged by the old completion');
    assert.deepEqual(rows(w).counts,{created:2,live:1,revoked:1,pending:0,invalidated:0});assert.equal(signatures(p),1);
    assert.equal(t.events.filter(e=>e.path==='/api/auth/challenge').length,1,'only the original client flow asked for a challenge');
    assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,true);
  }finally{gate.resolve();t.stop();}
});

test('R5 revokeAbandoned same generation: mismatched verify body + early logout headers never clear a newer accepted same-address/expiry session',async T=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),owners=Array(2000).fill('0x'+'0'.repeat(40));owners[361]=a;
  const w=setup({imd:fakeImd({seats:{361:'51320'},owners,online:[361]}),chain:fakeChain({owners:{361:a}})}),b=w.browser(),p=provider(A),gate=defer();
  let corruptVerify=true,held=false,originalExpiry;
  const t=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'&&r.ok&&corruptVerify){
      corruptVerify=false;const original=await r.json();originalExpiry=original.expiresAt;
      // Real verify already consumed A's actual SIWE signature and installed A's cookie.
      // Substitute only the otherwise-valid address field to exercise this rejection path.
      return Response.json({...original,address:B.address});
    }
    if(path==='/api/auth/logout'&&!held){assert.equal(r.status,204);held=true;await gate.promise;}return r;
  }});
  try{
    await t.c.signIn();await until(()=>held);
    assert.equal(signatures(p),1);assert.equal(b.jar.has(SESSION_COOKIE),false,'abandoned A cleanup headers precede the newer login');
    assert.deepEqual(rows(w).counts,{created:1,live:0,revoked:1,pending:0,invalidated:0});
    const oldNonce=rows(w).sessions[0].nonce,cleanup=t.events.find(e=>e.path==='/api/auth/logout');
    assert.equal(cleanup.body.expectedNonce,oldNonce,'mismatched body address is never cleanup authority');
    await b.signIn(A);const cookie=b.jar.get(SESSION_COOKIE);await t.c.restore();
    assert.equal(statusOf(t.c.state,w.clock.now()),'owner');assert.equal(t.c.state.session.expiresAt,originalExpiry);
    const reads=t.events.filter(e=>e.path==='/api/auth/session').length;
    gate.resolve();await until(()=>t.events.filter(e=>e.path==='/api/auth/session').length>reads);
    await until(()=>t.c.state.sessionKnown&&!t.c.state.checking&&statusOf(t.c.state,w.clock.now())==='owner');
    evidence(T,'revokeAbandoned/same-gen/early-headers/new-A2',w,b,t,[p]);
    assert.equal(t.c.state.session.address,a);assert.equal(t.c.state.session.expiresAt,originalExpiry);
    assert.equal(b.jar.get(SESSION_COOKIE),cookie);assert.equal(signatures(p),1);
    assert.deepEqual(rows(w).counts,{created:2,live:1,revoked:1,pending:0,invalidated:0});
    assert.equal(t.events.filter(e=>e.path==='/api/auth/challenge').length,1);assert.equal(t.events.filter(e=>e.path==='/api/auth/verify').length,1);
    assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,true);
  }finally{gate.resolve();t.stop();}
});
