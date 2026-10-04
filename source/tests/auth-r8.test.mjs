import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setup,newAccount,provider,tab,ready,defer,until,flush,rows,prompts,routeEvents,logouts,
  stallBody,evidence,terminal,SESSION_COOKIE,fakeChain,fakeImd} from './auth-r7-fixtures.mjs';

// Same evaluator selects frozen e48 baseline via ../baseline or this candidate. Keys/tokens stay in memory.
const selected=process.env.AUTH_R7_SOURCE?resolve(process.cwd(),process.env.AUTH_R7_SOURCE):resolve(import.meta.dirname,'..');
const {watchOwner,statusOf}=await import(pathToFileURL(resolve(selected,'src/world/auth.ts')).href);
const count=(q,path)=>routeEvents(q,path).length;
const session=async b=>(await (await b.get('/api/auth/session')).json());

for(const variant of ['malformed-account','malformed-provider','valid-account'])
test(`R8-1 RELEASED while click live: ${variant} switch cleans displayed address`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),next=provider(B),home=defer();
  let chosen=p,held=false,body,flow;
  const q=tab(w,b,p,{getProvider:()=>chosen,intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){
      if(variant==='valid-account'){body=await stallBody(r);return body.response;}
      return new Response('{',{status:r.status});
    }
    if(path.startsWith('/api/me/home')&&!held){held=true;await home.promise;}return r;
  }});
  try{
    await ready(q);flow=q.signIn();
    if(variant==='valid-account'){await until(()=>body);q.channels.at(-1).message();}
    await until(()=>held&&q.c.state.sessionKnown&&q.c.state.session,'trusted PRESENT before home/body completes');
    terminal(q,'RELEASED');
    if(variant==='malformed-provider'){chosen=next;q.observeProvider(next);q.notifyProvider();}else p.switchTo(B);
    home.resolve();body?.finish(true);await flow;
    assert.equal(logouts(q).filter(e=>e.addressAssertion).length,1,'displayed session has its own address cleanup');
    assert.equal(logouts(q).filter(e=>e.nonceAssertion).length,0,'released verify nonce is never revived');
    // The click can settle before the independent switch cleanup reaches Worker. Await the nonvacuous route and
    // its client acknowledgement, rather than treating a fixed number of event-loop turns as transport completion.
    await until(()=>logouts(q).length===1&&logouts(q)[0].finished
      &&q.c.state.phase==='idle'&&q.c.state.session===null,
      'displayed-address logout response completes with no displayed session');
    evidence(T,'R8-1/after-switch',q,[p,next],{variant});
    assert.equal(rows(w).counts.live,0);assert.equal(rows(w).counts.revoked,1);
    assert.equal((await session(b)).signedIn,false);assert.equal(b.jar.has(SESSION_COOKIE),false);
    assert.equal(prompts([p,next]),1);terminal(q,'RELEASED');
  }finally{home.resolve();body?.finish(true);await flow?.catch(()=>{});evidence(T,'R8-1/final',q,[p,next],{variant});q.stop();}
});

test('R8-2 post-fence PRESENT during valid stalled body broadcasts once, sibling avoids duplicate sign-in',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),p2=provider(A);let body,flow;
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/verify'){body=await stallBody(r);return body.response;}return r;}});
  const sibling=tab(w,b,p2);
  try{
    await ready(q);await ready(sibling);flow=q.signIn();await until(()=>body);
    q.channels.at(-1).message();await until(()=>q.c.state.sessionKnown&&q.c.state.session&&!q.c.state.checking);
    terminal(q,'RELEASED');body.finish(true);await flow;await flush();
    const posts=q.channels.at(-1).messages.filter(x=>x==='signed-in');
    for(const _ of posts)sibling.channels.at(-1).message();await flush();await sibling.signIn();await flush();
    evidence(T,'R8-2/accepted',q,[p,p2],{posts,siblingPrompts:prompts([p2])});
    assert.equal(posts.length,1,'one accepted operation sends one signed-in notification');
    assert.equal(prompts([p2]),0,'sibling reads canonical PRESENT instead of asking again');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(logouts(q).length,0);assert.equal(logouts(sibling).length,0);
  }finally{body?.finish(true);await flow?.catch(()=>{});q.stop();sibling.stop();}
});

for(const switchKind of ['account','provider'])
test(`R8-3 displayed PRESENT supersedes stale pending nonce on ${switchKind} switch`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),next=provider(B),challenge=defer(),home=defer();
  let chosen=p,chHeld=false,flow;
  const q=tab(w,b,p,{getProvider:()=>chosen,intercept:async(path,r)=>{
    if(path==='/api/auth/challenge'&&!chHeld){chHeld=true;await challenge.promise;}
    if(path.startsWith('/api/me/home'))await home.promise;return r;
  }});
  try{
    await ready(q);flow=q.signIn();await until(()=>chHeld);
    assert.equal((await b.signIn(A)).verify.status,200);q.channels.at(-1).message();
    await until(()=>q.c.state.sessionKnown&&q.c.state.session,'other tab PRESENT installed');
    challenge.resolve();await until(()=>q.c.lifecycleSnapshot.click?.state==='CHALLENGE_READY'&&q.c.state.phase==='idle');
    if(switchKind==='provider'){chosen=next;q.observeProvider(next);q.notifyProvider();}else p.switchTo(B);
    await flush();home.resolve();await flow;await until(()=>logouts(q).every(e=>e.finished),'all switch cleanup routes settle');await flush();evidence(T,'R8-3/after-switch',q,[p,next],{switchKind});
    assert.equal(logouts(q).filter(e=>e.addressAssertion).length,1,'pending nonce cannot suppress displayed-address cleanup');
    assert.equal(logouts(q).filter(e=>e.nonceAssertion).length,0,'v1.1 pending cancellation cannot race the displayed-session primary');
    assert.equal(rows(w).counts.live,0);assert.equal(rows(w).counts.revoked,1);assert.equal((await session(b)).signedIn,false);
    assert.equal(prompts([p,next]),0,'held challenge never opens a prompt');
    assert.equal(rows(w).counts.pending,0,'older invalidated challenge does not revive');
  }finally{challenge.resolve();home.resolve();await flow?.catch(()=>{});q.stop();}
});

for(const result of ['matching-A','newer-B'])
test(`R8-4 stopped owner cleanup completes after restart: canonical current-life ${result}`,async T=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),logout=defer();let corrupt=false,held=false;
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/logout'){held=true;await logout.promise;}},
    intercept:async(path,r)=>{if(path==='/api/auth/verify'){corrupt=true;return new Response('{',{status:r.status});}
      if(path==='/api/auth/session'&&corrupt)return new Response('{}',{status:429});return r;}});
  try{
    await ready(q);await q.signIn();assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');
    corrupt=false;q.stop();await until(()=>held);q.restart();
    await until(()=>q.c.state.sessionKnown&&q.c.state.session&&!q.c.state.checking,'new lifetime accepts pre-cleanup PRESENT');
    if(result==='newer-B'){assert.equal((await b.signIn(B)).verify.status,200);q.channels.at(-1).message();await until(()=>q.c.state.session?.address===B.address.toLowerCase()&&!q.c.state.checking);}
    const reads=count(q,'/api/auth/session');logout.resolve();await until(()=>logouts(q).at(-1).finished);await flush();
    evidence(T,'R8-4/current-life',q,[p],{result});
    assert.ok(count(q,'/api/auth/session')>reads,'completion invalidates stale current evidence and schedules a current-life read');
    assert.equal(q.c.state.sessionKnown,true);assert.equal(q.c.state.session,null);assert.equal((await session(b)).signedIn,false);
    assert.equal(rows(w).counts.live,result==='newer-B'?1:0,'late headers may clear B cookie, never revoke B row');
    assert.equal(prompts([p]),1);assert.equal(q.channels[0].messages.length,0,'old closed channel is never written');
  }finally{logout.resolve();q.stop();}
});

test('R8-4 control: stopped-only cleanup has no subsequent UI/channel/timer writes',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),logout=defer();let corrupt=false,held=false;
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/logout'){held=true;await logout.promise;}},intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){corrupt=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&corrupt)return new Response('{}',{status:429});return r;}});
  try{
    await ready(q);await q.signIn();q.stop();await until(()=>held);
    const n=q.states.length,reads=count(q,'/api/auth/session'),arms=q.arms;logout.resolve();await until(()=>logouts(q).at(-1).finished);await flush();
    evidence(T,'R8-4/stopped-only',q,[p]);assert.equal(q.states.length,n);assert.equal(count(q,'/api/auth/session'),reads);
    assert.equal(q.arms,arms);assert.equal(q.channels[0].messages.length,0);assert.equal(rows(w).counts.live,0);
  }finally{logout.resolve();q.stop();}
});

test('R8-4 busy restart drains detached cleanup after fresh acceptance, peer converges without another prompt',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),p2=provider(A),logout=defer(),read=defer();
  let corrupt=false,verifyCount=0,holdRestart=false,readHeld=false,logoutHeld=false,flow;
  const peer=tab(w,b,p2);
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/logout'&&!logoutHeld){logoutHeld=true;await logout.promise;}},
    intercept:async(path,r)=>{
      if(path==='/api/auth/verify'&&verifyCount++===0){corrupt=true;return new Response('{',{status:r.status});}
      if(path==='/api/auth/session'&&corrupt)return new Response('{}',{status:429});
      if(path==='/api/auth/session'&&holdRestart&&!readHeld){readHeld=true;await read.promise;}return r;
    }});
  try{
    await ready(peer);await ready(q);await q.signIn();assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');
    corrupt=false;q.stop();await until(()=>logoutHeld);holdRestart=true;q.restart();await until(()=>readHeld);
    flow=q.signIn();await flush();assert.ok(q.c.lifecycleSnapshot.click,'new explicit click busy in preflight');
    logout.resolve();await until(()=>logouts(q).at(-1).finished);await flush();
    read.resolve();await flow;await flush();
    const posts=q.channels.at(-1).messages.filter(x=>x==='signed-in');
    for(const _ of posts)peer.channels.at(-1).message();await flush();await peer.signIn();await flush();
    evidence(T,'R8-4/busy-restart',q,[p,p2],{posts,peerPrompts:prompts([p2])});
    assert.equal(posts.length,1,'valid new acceptance is coherently announced before pending canonical reread');
    assert.equal(prompts([p]),2,'only two explicit clicks sign: old uncertain and new accepted');
    assert.equal(prompts([p2]),0,'peer converges by canonical read, no extra signature');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[2,1,1]);
    assert.equal(q.c.state.sessionKnown,true);assert.equal(peer.c.state.sessionKnown,true);
    assert.equal(q.c.state.session?.address,A.address.toLowerCase());assert.equal(peer.c.state.session?.address,A.address.toLowerCase());
    assert.equal((await session(b)).signedIn,true);terminal(q,'RELEASED');
    assert.equal(q.channels[0].messages.length,0,'old channel remains untouched');
  }finally{logout.resolve();read.resolve();await flow?.catch(()=>{});q.stop();peer.stop();}
});

for(const jump of [0,3_600_000])for(const mode of ['sold','revoked','refused'])
test(`R8-6 owner poll ${mode}, backwards clock ${jump} cannot retain owner indefinitely`,async T=>{
  const A=newAccount(),B=newAccount(),chain=fakeChain({owners:{361:A.address.toLowerCase()}}),
    imd=fakeImd({seats:{361:'51320'},online:[361]}),w=setup({chain,imd}),b=w.browser(),p=provider(A);
  assert.equal((await b.signIn(A)).verify.status,200);let clientNow=w.clock.now(),refused=false;
  const q=tab(w,b,p,{intercept:async(path,r)=>path.startsWith('/api/me/home')&&refused?new Response('{}',{status:429}):r});
  // Clock is an explicit client-only fixture; Worker clock continues forward independently.
  q.c.deps.now=()=>clientNow;const jobs=new Set();
  const env={set:(fn,ms)=>{const j={fn,ms};jobs.add(j);return j;},clear:j=>jobs.delete(j),hidden:()=>false,onVisible:()=>()=>{}};
  let stop;
  try{
    await ready(q);assert.equal(statusOf(q.c.state,clientNow),'owner');const reads=routeEvents(q,'/api/me/home').length;
    clientNow-=jump;chain.state.owners[361]=B.address.toLowerCase();
    if(mode==='revoked')w.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(w.clock.now());
    if(mode==='refused')refused=true;
    stop=watchOwner(q.c,env);
    for(let i=0;i<4;i++){
      w.clock.advance(60_000);clientNow+=60_000;const j=[...jobs][0];jobs.delete(j);j.fn();await flush();
      if(q.c.state.checking)await until(()=>!q.c.state.checking,'poll body and response applied');
    }
    evidence(T,'R8-6/owner-refresh',q,[p],{jump,mode});
    assert.ok(routeEvents(q,'/api/me/home').length>reads,'negative age is expired, never suppresses polling');
    assert.notEqual(statusOf(q.c.state,clientNow),'owner','sold/revoked/unconfirmed proof cannot remain owner');
    if(mode==='sold')assert.equal(statusOf(q.c.state,clientNow),'signedInNoHouse');
    if(mode==='revoked')assert.equal(q.c.state.session,null);
    assert.equal(prompts([p]),0);assert.equal(logouts(q).length,0);
  }finally{stop?.();q.stop();}
});

test('R8-6 visible: negative session-read age triggers canonical refresh',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,p);let clientNow=w.clock.now();q.c.deps.now=()=>clientNow;
  try{await ready(q);const n=count(q,'/api/auth/session');clientNow-=3_600_000;q.c.visible();await flush();
    evidence(T,'R8-6/visible',q,[p]);assert.equal(count(q,'/api/auth/session'),n+1);assert.equal(prompts([p]),0);
  }finally{q.stop();}
});

// v1.1 deliberately changes fail-closed lock cleanup to post-fence canonical reconciliation. The original failing
// policy expectation is retained in ../evidence/auth-first.log; the live-token server authority is unchanged.
test('R8-7 v1.1 lock reconciles retained uncertain owner and preserves committed session, no new prompt',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let corrupt=false;
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/verify'){corrupt=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&corrupt)return new Response('{}',{status:429});return r;}});
  try{await ready(q);await q.signIn();assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');
    corrupt=false;p.switchTo(null);
    await until(()=>q.c.lifecycleSnapshot.cleanup?.status==='RELEASED'&&q.c.state.sessionKnown&&q.c.state.session,
      'post-fence lock reconciliation releases original owner on canonical PRESENT');
    evidence(T,'R8-7/retained-lock',q,[p]);
    assert.equal(logouts(q).length,0);terminal(q,'RELEASED');
    assert.equal(rows(w).counts.live,1);assert.equal(rows(w).counts.revoked,0);assert.equal(prompts([p]),1);
    assert.equal((await session(b)).signedIn,true);
  }finally{q.stop();}
});

test('R8-7 control: accepted PRESENT lock preserves session, no abandoned logout',async T=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),home=defer();let held=false,flow;
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/verify')return new Response('{',{status:r.status});
    if(path.startsWith('/api/me/home')&&!held){held=true;await home.promise;}return r;}});
  try{await ready(q);flow=q.signIn();await until(()=>held&&q.c.state.sessionKnown&&q.c.state.session);terminal(q,'RELEASED');
    p.switchTo(null);home.resolve();await flow;await flush();evidence(T,'R8-7/accepted-lock',q,[p]);
    assert.equal(logouts(q).length,0);assert.equal(rows(w).counts.live,1);assert.equal((await session(b)).signedIn,true);terminal(q,'RELEASED');
  }finally{home.resolve();await flow?.catch(()=>{});q.stop();}
});
