import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,provider,tab,ready,defer,until,flush,rows,prompts,connects,routeEvents,logouts,
  stallBody,evidence,invariant,terminal,clientKnowledge,SESSION_COOKIE,FLOW_COOKIE} from './auth-r7-fixtures.mjs';

// Frozen acceptance expectations are identical on parent and candidate. Every scenario uses real Worker handlers.
// Gates distinguish dispatch, database commit/headers, body consumption, read acceptance and later home completion.
const count=(q,path)=>routeEvents(q,path).length;
const sessionAddress=async b=>(await (await b.get('/api/auth/session')).json()).address?.toLowerCase();
const cancelledClick=q=>{
  assert.equal(count(q,'/api/auth/challenge'),0,'cancelled preflight creates no challenge');
  assert.equal(rows(q.w).counts.created,0,'cancelled preflight creates no session');
};

for(const body of ['malformed','valid'])for(const navigation of ['stop-only','stop-restart'])
test(`R7-A ${body} verify accepted PRESENT / held home / ${navigation} / late home never revokes`,async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),home=defer();let held=false,flow;
  const q=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'&&body==='malformed')return new Response('{',{status:r.status});
    if(path.startsWith('/api/me/home')&&!held){held=true;q.mark('HOME_HELD');await home.promise;}return r;
  }});
  try{
    await ready(q);flow=q.signIn();await until(()=>held,'accepted PRESENT before held home');
    assert.equal(q.c.state.sessionKnown,true);assert.equal(q.c.state.session.address,A.address.toLowerCase());
    terminal(q,'RELEASED');const cookie=b.jar.get(SESSION_COOKIE);
    assert.equal(rows(w).counts.live,1);q.mark('STOP');q.stop();assert.equal(logouts(q).length,0);
    if(navigation==='stop-restart'){
      const reads=count(q,'/api/auth/session');q.restart();
      await until(()=>count(q,'/api/auth/session')>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&q.c.state.sessionKnown&&!q.c.state.checking,'new lifetime accepted session');await flush();
    }
    const notifications=q.states.length,arms=q.arms,broadcasts=q.channels.map(c=>c.messages.length);
    home.resolve();await flow;await flush();evidence(T,'A/late-home',q,[p],{body,navigation});
    assert.equal(logouts(q).length,0,'terminal release cannot be reopened by a late home closure');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(b.jar.get(SESSION_COOKIE),cookie);assert.equal(await sessionAddress(b),A.address.toLowerCase());
    assert.equal(prompts([p]),1);assert.equal(q.states.length,notifications,'old lifetime has no new UI writes');
    assert.equal(q.arms,arms,'old lifetime does not rearm expiry');
    assert.deepEqual(q.channels.map(c=>c.messages.length),broadcasts,'old lifetime broadcasts nothing');
    terminal(q,'RELEASED');
  }finally{evidence(T,'A/final',q,[p],{body,navigation});home.resolve();await flow?.catch(()=>{});q.stop();}
});

for(const overlap of ['ABSENT','PRESENT','INVALID'])for(const navigation of ['stop-only','stop-restart'])
test(`R7-B pre-commit ${overlap} read arrives after verify headers / stalled body / ${navigation} retains cleanup`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),verify=defer(),read=defer();
  let verifyHeld=false,readHeld=false,body,flow;
  const q=tab(w,b,p,{beforeSend:async path=>{
    if(path==='/api/auth/verify'&&!verifyHeld){verifyHeld=true;q.mark('VERIFY_BEFORE_COMMIT');await verify.promise;}
  },intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){body=await stallBody(r);q.mark('VERIFY_HEADERS_OBSERVED');return body.response;}
    if(path==='/api/auth/session'&&verifyHeld&&!readHeld){
      readHeld=true;assert.equal((await r.clone().json()).signedIn,overlap==='PRESENT');
      q.mark('PRE_COMMIT_READ_GENERATED',{variant:overlap});await read.promise;
      return overlap==='INVALID'?new Response('{',{status:200}):r;
    }return r;
  }});
  try{
    await ready(q);flow=q.signIn();await until(()=>verifyHeld,'verify dispatched but not committed');
    if(overlap==='PRESENT'){
      const other=w.browser(),signed=await other.signIn(B);assert.equal(signed.verify.status,200);
      // Copy only B's session token: A's captured original flow remains valid for its in-flight request.
      b.jar.set(SESSION_COOKIE,other.jar.get(SESSION_COOKIE));q.mark('OLDER_PRESENT_COOKIE_INSTALLED');
    }
    q.channels.at(-1).message();await until(()=>readHeld,'session reply generated before verify commit');
    verify.resolve();await until(()=>body,'committed verify headers installed cookie');assert.equal(rows(w).counts.used,overlap==='PRESENT'?2:1);
    read.resolve();await until(()=>routeEvents(q,'/api/auth/session').at(-1).finished,'pre-commit response delivered');await flush();
    evidence(T,'B/pre-stop',q,[p],{overlap,navigation});
    const preStopKnowledge=clientKnowledge(q),preStopSnapshot=q.c.lifecycleSnapshot?structuredClone(q.c.lifecycleSnapshot):null;
    q.mark('STOP');q.stop();await until(()=>logouts(q).every(e=>e.finished),'teardown cleanup settles');await flush();
    evidence(T,'B/body-still-stalled',q,[p],{overlap,navigation});
    assert.equal(logouts(q).length,1,'stop sends exactly one conditional cleanup while body is still stalled');
    assert.ok(logouts(q)[0].nonceAssertion);assert.equal(logouts(q)[0].addressAssertion,false);
    const Arows=rows(w).sessions.filter(s=>s.address===A.address.toLowerCase());assert.equal(Arows.length,1);
    assert.ok(Arows.every(s=>s.revoked_at!==null),'no live A remains despite stalled body');
    assert.equal(preStopKnowledge,'UNKNOWN','pre-commit evidence cannot settle uncertain verify knowledge');
    if(preStopSnapshot){assert.equal(preStopSnapshot.cleanup.status,'RETAINED');assert.equal(preStopSnapshot.retainedCount,1);}
    assert.equal(b.jar.has(SESSION_COOKIE),false);terminal(q,'CONSUMED');
    if(navigation==='stop-restart'){
      const reads=count(q,'/api/auth/session');q.restart();
      await until(()=>count(q,'/api/auth/session')>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&q.c.state.restored&&!q.c.state.checking,'new lifetime read resolved');await flush();
    }
    const notifications=q.states.length,arms=q.arms,broadcasts=q.channels.map(c=>c.messages.length);
    body.finish();await flow;await flush();evidence(T,'B/late-body',q,[p],{overlap,navigation});
    assert.equal(logouts(q).length,1,'consumed owner cannot issue a duplicate late cleanup');
    assert.equal(q.states.length,notifications);assert.equal(q.arms,arms);assert.deepEqual(q.channels.map(c=>c.messages.length),broadcasts);
    assert.equal(prompts([p]),1);invariant(q);
  }finally{evidence(T,'B/final',q,[p],{overlap,navigation});verify.resolve();read.resolve();body?.finish();q.stop();await flow?.catch(()=>{});}
});

for(const old of ['ABSENT','PRESENT'])test(`R7 read ordering: old pre-commit ${old} arrives after accepted new PRESENT and cannot overwrite it`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),verify=defer(),read=defer(),home=defer();
  let verifyHeld=false,readHeld=false,homeHeld=false,flow;
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/verify'&&!verifyHeld){verifyHeld=true;await verify.promise;}},
    intercept:async(path,r)=>{
      if(path==='/api/auth/session'&&verifyHeld&&!readHeld){readHeld=true;await read.promise;}
      if(path.startsWith('/api/me/home')&&!homeHeld){homeHeld=true;await home.promise;}return r;
    }});
  try{
    await ready(q);flow=q.signIn();await until(()=>verifyHeld);
    if(old==='PRESENT'){const other=w.browser();assert.equal((await other.signIn(B)).verify.status,200);b.jar.set(SESSION_COOKIE,other.jar.get(SESSION_COOKIE));}
    q.channels.at(-1).message();await until(()=>readHeld);verify.resolve();await until(()=>homeHeld&&q.c.state.sessionKnown);
    assert.equal(q.c.state.session.address,A.address.toLowerCase());terminal(q,'RELEASED');
    read.resolve();await flush();evidence(T,'read-order/old-after-new',q,[p],{old});
    assert.equal(q.c.state.sessionKnown,true);assert.equal(q.c.state.session.address,A.address.toLowerCase());terminal(q,'RELEASED');
    q.stop();home.resolve();await flow;await flush();assert.equal(logouts(q).length,0);assert.equal(await sessionAddress(b),A.address.toLowerCase());
    assert.equal(prompts([p]),1);assert.equal(rows(w).counts.live,old==='PRESENT'?2:1);
  }finally{evidence(T,'read-order/final',q,[p],{old});verify.resolve();read.resolve();home.resolve();await flow?.catch(()=>{});q.stop();}
});

test('R7-B control: no overlapping read, stop cleans a stalled verified body once and late body cannot reopen owner',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let body,flow;
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/verify'){body=await stallBody(r);return body.response;}return r;}});
  try{
    await ready(q);flow=q.signIn();await until(()=>body);q.stop();
    await until(()=>logouts(q).length>=1&&logouts(q).every(e=>e.finished)&&(!q.c.lifecycleSnapshot||!q.c.lifecycleSnapshot.cleanup?.inFlight),'stalled-body teardown route and owner settled');await flush();
    evidence(T,'B/no-overlap-stop',q,[p]);assert.equal(logouts(q).length,1);assert.equal(rows(w).counts.live,0);
    terminal(q,'CONSUMED');body.finish();await flow;await flush();
    evidence(T,'B/no-overlap-late-body',q,[p]);assert.equal(logouts(q).length,1);assert.equal(prompts([p]),1);
  }finally{evidence(T,'B/no-overlap-final',q,[p]);body?.finish();q.stop();await flow?.catch(()=>{});}
});

for(const action of ['account','provider','lock','stop','stop-restart'])
test(`R7-C held initial session read / click A / ${action} cancels click; explicit fresh click recovers`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),pa=provider(A),pb=provider(B),initial=defer();
  let selected=pa,held=false,flow;const ps=[pa,pb];
  const q=tab(w,b,pa,{getProvider:()=>selected,intercept:async(path,r)=>{
    if(path==='/api/auth/session'&&!held){held=true;await initial.promise;}return r;
  }});q.observeProvider(pb);
  try{
    await until(()=>held&&q.c.state.account===A.address.toLowerCase(),'initial read held with account A');
    flow=q.signIn();await flush();q.mark(action.toUpperCase());
    if(action==='account')pa.switchTo(B);
    if(action==='provider'){selected=pb;q.notifyProvider();}
    if(action==='lock')pa.switchTo(null);
    if(action.startsWith('stop'))q.stop();
    if(action==='stop-restart')q.restart();
    initial.resolve();await flow;await flush();evidence(T,'C/cancelled',q,ps,{action});
    cancelledClick(q);assert.equal(prompts(ps),0,'old click may not prompt the new wallet');
    assert.equal(connects(ps),0,'a lock must not transfer an old click into a connection prompt');
    assert.equal(logouts(q).length,0,'no automatic logout without a nonce or displayed session');invariant(q);
    if(action==='stop')q.restart();if(action==='lock')pa.switchTo(B);
    await until(()=>q.c.state.account&&!q.c.state.checking,'new account ready');
    await q.signIn();await flush();evidence(T,'C/fresh-click',q,ps,{action});
    assert.equal(prompts(ps),1);assert.equal(count(q,'/api/auth/challenge'),1);assert.equal(rows(w).counts.created,1);
    assert.equal(q.c.state.session.address,(action==='account'||action==='provider'||action==='lock'?B:A).address.toLowerCase());
    q.stop();assert.equal(rows(w).counts.live,1,'fresh accepted session remains live on normal stop');
  }finally{evidence(T,'C/final',q,ps,{action});initial.resolve();await flow?.catch(()=>{});q.stop();}
});

test('R7-C control: same-account announcement during preflight keeps the original explicit click',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),initial=defer();let held=false,flow;
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/session'&&!held){held=true;await initial.promise;}return r;}});
  try{
    await until(()=>held&&q.c.state.account);flow=q.signIn();await flush();p.switchTo(A);initial.resolve();await flow;
    evidence(T,'C/same-account-control',q,[p]);assert.equal(prompts([p]),1);assert.equal(rows(w).counts.live,1);
    assert.equal(q.c.state.session.address,A.address.toLowerCase());terminal(q,'RELEASED');
  }finally{evidence(T,'C/same-account-final',q,[p]);initial.resolve();await flow?.catch(()=>{});q.stop();}
});

for(const replacement of ['B','A2'])for(const action of ['account','provider','stop'])
test(`R7-E uncertain A / newer ${replacement} cookie + pending / ${action} preserves both through late read`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),C=newAccount(),b=w.browser(),pa=provider(A),pb=provider(C),read=defer();
  let selected=pa,afterVerify=false,held=false,flow;const next=replacement==='A2'?A:B,ps=[pa,pb];
  const q=tab(w,b,pa,{getProvider:()=>selected,intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){afterVerify=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&afterVerify&&!held){held=true;await read.promise;}return r;
  }});q.observeProvider(pb);
  try{
    await ready(q);flow=q.signIn();await until(()=>held,'uncertain recovery held');const oldNonce=rows(w).sessions[0].nonce;
    assert.equal((await b.signIn(next)).verify.status,200);q.mark('NEWER_SESSION_INSTALLED',{sameAddress:replacement==='A2'});
    const pending=await (await b.post('/api/auth/challenge',{address:next.address})).json();q.mark('NEWER_PENDING_CHALLENGE');
    const cookies=new Map(b.jar);q.mark(action.toUpperCase());
    if(action==='account')pa.switchTo(C);if(action==='provider'){selected=pb;q.notifyProvider();}if(action==='stop')q.stop();
    await flush();read.resolve();await flow;
    await until(()=>logouts(q).length>=1&&logouts(q).every(e=>e.finished)&&(!q.c.lifecycleSnapshot||!q.c.lifecycleSnapshot.cleanup?.inFlight),'replacement protection route and owner settled');await flush();evidence(T,'E/late-read',q,ps,{replacement,action});
    assert.equal(logouts(q).length,1,'one observed owner has one cleanup attempt');
    assert.ok(logouts(q).every(e=>e.assertedNonce===oldNonce&&e.status===409));
    assert.equal(rows(w).counts.created,2);assert.equal(rows(w).counts.live,2);assert.equal(rows(w).counts.revoked,0);
    assert.equal(rows(w).challenges.find(c=>c.nonce===pending.nonce).invalidated_at,null);
    assert.equal(b.jar.get(SESSION_COOKIE),cookies.get(SESSION_COOKIE));assert.equal(b.jar.get(FLOW_COOKIE),cookies.get(FLOW_COOKIE));
    assert.equal(prompts(ps),1);terminal(q,'CONSUMED');
    const signature=await next.signMessage({message:pending.message});assert.equal((await b.post('/api/auth/verify',{nonce:pending.nonce,signature})).status,200);
    assert.equal(rows(w).counts.live,3,'preserved pending challenge really verifies');assert.equal(rows(w).counts.pending,0);
  }finally{evidence(T,'E/final',q,ps,{replacement,action});read.resolve();await flow?.catch(()=>{});q.stop();}
});

for(const stage of ['challenge','prompt'])for(const action of ['account','provider','lock','stop'])
test(`R7 click lease: ${stage} response held / ${action} / old response late cannot verify`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),gate=defer();let held=false,flow,selected;
  const pa=provider(A,{beforePrompt:async()=>{if(stage==='prompt'){held=true;await gate.promise;}}}),pb=provider(B);selected=pa;
  const q=tab(w,b,pa,{getProvider:()=>selected,intercept:async(path,r)=>{
    if(stage==='challenge'&&path==='/api/auth/challenge'){held=true;await gate.promise;}return r;
  }});q.observeProvider(pb);
  try{
    await ready(q);flow=q.signIn();await until(()=>held,stage+' gate');q.mark(action.toUpperCase());
    if(action==='account')pa.switchTo(B);if(action==='provider'){selected=pb;q.notifyProvider();}
    if(action==='lock')pa.switchTo(null);if(action==='stop')q.stop();gate.resolve();await flow;await flush();
    evidence(T,'lease/late-response',q,[pa,pb],{stage,action});
    assert.equal(prompts([pa,pb]),stage==='prompt'?1:0,'only an already opened prompt may finish');
    assert.equal(count(q,'/api/auth/verify'),0,'stale signature never reaches verify');assert.equal(rows(w).counts.created,0);
    assert.ok(logouts(q).every(e=>e.nonceAssertion||e.addressAssertion),'no plain automatic logout');invariant(q);
  }finally{evidence(T,'lease/final',q,[pa,pb],{stage,action});gate.resolve();await flow?.catch(()=>{});q.stop();}
});

const badReads=[['malformed',()=>new Response('{')],['empty',()=>Response.json({})],['array',()=>Response.json([])],
  ['invalid-positive',()=>Response.json({signedIn:true,address:'bad',expiresAt:17})],
  ['unsafe-expiry',()=>Response.json({signedIn:true,address:'0x'+'1'.repeat(40),expiresAt:9007199254740992})],
  ['429',()=>Response.json({error:'LIMITED'},{status:429})],['503',()=>Response.json({error:'UNAVAILABLE'},{status:503})],
  ['transport',()=>{throw new TypeError('synthetic network failure');}]];
for(const [mode,bad] of badReads)test(`R7 knowledge property: ${mode} stays UNKNOWN with zero prompts; fresh valid read permits one click`,async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let corrupt=true;
  const q=tab(w,b,p,{intercept:async(path,r)=>path==='/api/auth/session'&&corrupt?bad():r});
  try{
    await ready(q);for(let i=0;i<2;i++){await q.signIn();evidence(T,'UNKNOWN/click-'+i,q,[p],{mode});
      assert.equal(clientKnowledge(q),'UNKNOWN');assert.equal(q.c.state.sessionKnown,false);assert.equal(prompts([p]),0);assert.equal(rows(w).counts.created,0);}
    corrupt=false;const reads=count(q,'/api/auth/session');await q.signIn();await flush();evidence(T,'UNKNOWN/fresh-resolution',q,[p],{mode});
    assert.ok(count(q,'/api/auth/session')>reads);assert.equal(prompts([p]),1);assert.equal(rows(w).counts.live,1);terminal(q,'RELEASED');
    assert.ok(q.events.filter(e=>e.name==='WALLET_personal_sign').every(e=>e.knowledge!=='UNKNOWN'),'UNKNOWN never permits personal_sign');
    q.stop();assert.equal(rows(w).counts.live,1);assert.equal(logouts(q).length,0);
  }finally{evidence(T,'UNKNOWN/final',q,[p],{mode});q.stop();}
});

for(const completion of ['before-headers','after-headers'])
test(`R7 cleanup ownership: early refused attempt completes ${completion}; same owner retries once after verify observation`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),verify=defer(),early=defer();
  let held=false,earlyHeld=false,body,flow;
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/verify'&&!held){held=true;await verify.promise;}},
    intercept:async(path,r)=>{
      if(path==='/api/auth/logout'&&!earlyHeld){earlyHeld=true;assert.equal(r.status,409);await early.promise;}
      if(path==='/api/auth/verify'){body=await stallBody(r);return body.response;}return r;
    }});
  try{
    await ready(q);flow=q.signIn();await until(()=>held);
    const other=w.browser();assert.equal((await other.signIn(B)).verify.status,200);
    // A's already-dispatched verify retains its original flow cookie. The early cleanup currently sees unrelated B.
    b.jar.set(SESSION_COOKIE,other.jar.get(SESSION_COOKIE));q.mark('OTHER_TOKEN_BEFORE_VERIFY');q.stop();await until(()=>earlyHeld);
    const first=q.c.lifecycleSnapshot?.cleanup?.flowId;
    assert.equal(logouts(q).length,1);assert.equal(rows(w).counts.revoked,0);
    if(completion==='before-headers'){
      early.resolve();await until(()=>logouts(q)[0].finished);await flush();
      const s=q.c.lifecycleSnapshot;if(s){assert.equal(s.cleanup.status,'RETAINED');assert.equal(s.retainedCount,1);assert.equal(s.cleanup.responseObserved,false);}
    }
    verify.resolve();await until(()=>body);await flush();
    if(completion==='after-headers'){assert.equal(logouts(q).length,1,'pre-fence attempt remains the sole in-flight cleanup');early.resolve();}
    await until(()=>logouts(q).length===2&&logouts(q).every(e=>e.finished),'post-observation cleanup completes');await flush();
    evidence(T,'cleanup/early-refusal-then-observed',q,[p],{completion});
    assert.deepEqual(logouts(q).map(e=>e.status),[409,204]);assert.ok(logouts(q).every(e=>e.nonceAssertion&&!e.addressAssertion));
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[2,1,1]);
    assert.equal(rows(w).sessions.find(s=>s.address===B.address.toLowerCase()).revoked_at,null);assert.equal(b.jar.has(SESSION_COOKIE),false);
    if(first!==undefined)assert.equal(q.c.lifecycleSnapshot.cleanup.flowId,first,'retry uses the original cleanup owner');terminal(q,'CONSUMED');
    body.finish();await flow;await flush();assert.equal(logouts(q).length,2,'late body cannot create a third attempt');assert.equal(prompts([p]),1);
  }finally{evidence(T,'cleanup/early-final',q,[p],{completion});verify.resolve();early.resolve();body?.finish();q.stop();await flow?.catch(()=>{});}
});

for(const order of [['account','provider','stop'],['stop','account','provider']])
test(`R7 cleanup ownership: ${order.join(' -> ')} while cleanup response held has one observed attempt`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),C=newAccount(),b=w.browser(),pa=provider(A),pb=provider(C),cleanup=defer();
  let selected=pa,body,held=false,flow;
  const q=tab(w,b,pa,{getProvider:()=>selected,intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){body=await stallBody(r);return body.response;}
    if(path==='/api/auth/logout'){held=true;await cleanup.promise;}return r;
  }});q.observeProvider(pb);
  try{
    await ready(q);flow=q.signIn();await until(()=>body);
    for(const action of order){q.mark('CANCEL_'+action);if(action==='account')pa.switchTo(B);if(action==='provider'){selected=pb;q.notifyProvider();}if(action==='stop')q.stop();await flush();}
    await until(()=>held);evidence(T,'cleanup/multiple-cancel-inflight',q,[pa,pb],{order});
    assert.equal(logouts(q).length,1);const s=q.c.lifecycleSnapshot;if(s){assert.equal(s.retainedCount,1);assert.equal(s.cleanup.inFlight,true);}
    cleanup.resolve();await until(()=>logouts(q)[0].finished);await flush();terminal(q,'CONSUMED');
    body.finish();await flow;await flush();evidence(T,'cleanup/multiple-cancel-finished',q,[pa,pb],{order});
    assert.equal(logouts(q).length,1);assert.equal(rows(w).counts.live,0);assert.equal(rows(w).counts.revoked,1);assert.equal(prompts([pa,pb]),1);
  }finally{evidence(T,'cleanup/multiple-final',q,[pa,pb],{order});cleanup.resolve();body?.finish();q.stop();await flow?.catch(()=>{});}
});

for(const restart of [false,true])test(`R7 callback lifetime: queued old channel listener after stop${restart?' and restart':''} does no read or UI write`,async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),q=tab(w,b,p);
  try{
    await ready(q);await q.signIn();await flush();terminal(q,'RELEASED');const oldChannel=q.channels.at(-1);
    q.stop();
    if(restart){const reads=count(q,'/api/auth/session');q.restart();await until(()=>count(q,'/api/auth/session')>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&!q.c.state.checking);await flush();}
    const reads=count(q,'/api/auth/session'),notifications=q.states.length,arms=q.arms;
    oldChannel.message();await flush();evidence(T,'callback/old-channel',q,[p],{restart});
    assert.equal(count(q,'/api/auth/session'),reads,'queued old listener cannot start a read in another lifetime');
    assert.equal(q.states.length,notifications);assert.equal(q.arms,arms);assert.equal(logouts(q).length,0);assert.equal(rows(w).counts.live,1);
  }finally{evidence(T,'callback/final',q,[p],{restart});q.stop();}
});

for(const [mode,bad] of badReads.filter(([m])=>['malformed','429','503','transport'].includes(m)))for(const settled of ['PRESENT','ABSENT'])
test(`R7 uncertain verify: ${mode} read retains owner without extra prompts until ordered ${settled}`,async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let verified=false,corrupt=true;
  const q=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){verified=true;return new Response('{',{status:r.status});}
    return path==='/api/auth/session'&&verified&&corrupt?bad():r;
  }});
  try{
    await ready(q);await q.signIn();await flush();
    for(let i=0;i<2;i++){
      evidence(T,'uncertain/unknown-'+i,q,[p],{mode,settled});assert.equal(clientKnowledge(q),'UNKNOWN');
      const s=q.c.lifecycleSnapshot;if(s){assert.equal(s.retainedCount,1);assert.equal(s.cleanup.status,'RETAINED');}
      assert.equal(rows(w).counts.live,1);assert.equal(rows(w).counts.used,1);assert.equal(prompts([p]),1);assert.equal(logouts(q).length,0);
      await q.signIn();await flush();assert.equal(prompts([p]),1,'UNKNOWN cannot prompt again after a committed verify');assert.equal(count(q,'/api/auth/challenge'),1);
    }
    if(settled==='ABSENT'){assert.equal((await b.post('/api/auth/logout',{})).status,204);q.mark('FIXTURE_EXTERNAL_LOGOUT');}
    corrupt=false;await q.c.restore();await flush();evidence(T,'uncertain/ordered-read-release',q,[p],{mode,settled});
    assert.equal(clientKnowledge(q),settled);terminal(q,'RELEASED');assert.equal(logouts(q).length,0);
    await q.signIn();await flush();evidence(T,'uncertain/fresh-resolved-click',q,[p],{mode,settled});
    assert.equal(prompts([p]),settled==='PRESENT'?1:2);assert.equal(rows(w).counts.created,settled==='PRESENT'?1:2);assert.equal(rows(w).counts.live,1);
    q.stop();assert.equal(logouts(q).length,0,'released responsibility cannot be resurrected by teardown');terminal(q,'RELEASED');
  }finally{evidence(T,'uncertain/final',q,[p],{mode,settled});q.stop();}
});
