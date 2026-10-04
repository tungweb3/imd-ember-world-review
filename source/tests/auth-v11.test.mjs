import test from 'node:test';
import assert from 'node:assert/strict';
import {planCleanup} from '../src/world/authCleanup.ts';
import {setup,newAccount,provider,tab,ready,defer,until,flush,rows,prompts,routeEvents,logouts,stallBody,terminal} from './auth-r7-fixtures.mjs';
const count=(q,path)=>routeEvents(q,path).length;
const canonical=async b=>(await (await b.get('/api/auth/session')).json());

for(const hint of ['dropped','delayed','unavailable'])test(`v1.1 every click owns canonical read: ${hint} hint cannot reuse stale ABSENT`,async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),q=tab(w,b,p);
  try{
    await ready(q);assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'ABSENT');
    assert.equal((await b.signIn(A)).verify.status,200);
    if(hint==='unavailable'){q.c.channel?.close();q.c.channel=null;}
    const reads=count(q,'/api/auth/session');await q.signIn();
    assert.equal(count(q,'/api/auth/session'),reads+1);
    assert.equal(prompts([p]),0);assert.equal(count(q,'/api/auth/challenge'),0);
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    if(hint==='delayed'){q.channels.at(-1).message();await flush();assert.equal(prompts([p]),0);}
  }finally{q.stop();}
});

test('v1.1 initial in-flight ABSENT cannot count as a later click preflight',async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),gate=defer();let held=false,flow;
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/session'&&!held){held=true;await gate.promise;}return r;}});
  try{
    await until(()=>held&&q.c.state.account);flow=q.signIn();
    assert.equal((await b.signIn(A)).verify.status,200);gate.resolve();await flow;
    assert.equal(count(q,'/api/auth/session'),2,'initial request plus distinct click request');
    assert.equal(prompts([p]),0);assert.equal(rows(w).counts.created,1);
  }finally{gate.resolve();await flow?.catch(()=>{});q.stop();}
});

for(const mode of ['malformed','429','503'])test(`v1.1 stale local ABSENT plus ${mode} new preflight remains UNKNOWN and never prompts`,async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let bad=false;
  const q=tab(w,b,p,{intercept:async(path,r)=>path==='/api/auth/session'&&bad?mode==='malformed'?new Response('{'):
    new Response('{}',{status:Number(mode)}):r});
  try{await ready(q);bad=true;await q.signIn();
    assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'UNKNOWN');assert.equal(prompts([p]),0);
    assert.equal(count(q,'/api/auth/challenge'),0);assert.equal(rows(w).counts.created,0);
  }finally{q.stop();}
});

for(const action of ['account','provider','lock','stop','restart'])test(`v1.1 click-specific held GET then ${action} cannot migrate lease`,async()=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),next=provider(B),gate=defer();
  let chosen=p,hold=false,held=false,flow;
  const q=tab(w,b,p,{getProvider:()=>chosen,intercept:async(path,r)=>{
    if(path==='/api/auth/session'&&hold&&!held){held=true;await gate.promise;}return r;}});
  try{await ready(q);hold=true;flow=q.signIn();await until(()=>held);
    if(action==='account')p.switchTo(B);
    if(action==='provider'){chosen=next;q.observeProvider(next);q.notifyProvider();}
    if(action==='lock')p.switchTo(null);
    if(action==='stop'||action==='restart'){q.stop();if(action==='restart')q.restart();}
    gate.resolve();await flow;await flush();
    assert.equal(prompts([p,next]),0);assert.equal(count(q,'/api/auth/challenge'),0);assert.equal(rows(w).counts.created,0);
  }finally{gate.resolve();await flow?.catch(()=>{});q.stop();}
});

test('v1.1 mismatching PRESENT cleanup 204 requires another canonical ABSENT before signing',async()=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A);assert.equal((await b.signIn(B)).verify.status,200);
  let cleanup=false;
  const q=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/logout')cleanup=true;
    if(path==='/api/auth/session'&&cleanup)return new Response('{}',{status:503});return r;}});
  try{await ready(q);const reads=count(q,'/api/auth/session');await q.signIn();
    assert.equal(count(q,'/api/auth/session'),reads+2,'click PRESENT plus post-cleanup read');
    assert.equal(logouts(q).length,1);assert.ok(logouts(q)[0].addressAssertion);
    assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'UNKNOWN');assert.equal(count(q,'/api/auth/challenge'),0);assert.equal(prompts([p]),0);
  }finally{q.stop();}
});

for(const timing of ['before-response','stalled-body'])test(`v1.1 wallet lock ${timing}: late verify preserves committed session and original responsibility reconciles`,async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),gate=defer();let held=false,body,flow;
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/verify'&&timing==='before-response'){held=true;await gate.promise;}},
    intercept:async(path,r)=>{if(path==='/api/auth/verify'){body=await stallBody(r);held=true;return body.response;}return r;}});
  try{await ready(q);flow=q.signIn();await until(()=>held);p.switchTo(null);
    assert.equal(logouts(q).length,0);
    if(timing==='before-response'){assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');gate.resolve();await until(()=>body);}
    await until(()=>q.c.lifecycleSnapshot.cleanup.status==='RELEASED'&&q.c.state.sessionKnown&&q.c.state.session);
    body.finish(true);await flow;await flush();
    assert.equal(logouts(q).length,0);assert.equal(prompts([p]),1);assert.equal(q.c.state.account,null);terminal(q,'RELEASED');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal((await canonical(b)).signedIn,true);
  }finally{gate.resolve();body?.finish(true);await flow?.catch(()=>{});q.stop();}
});

test('v1.1 lock UNKNOWN cannot release retained owner; later stop supersedes reconciliation with original nonce',async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let after=false,bad=true;
  const q=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){after=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&after&&bad)return new Response('{}',{status:503});return r;}});
  try{await ready(q);await q.signIn();p.switchTo(null);await flush();
    assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');assert.equal(logouts(q).length,0);assert.equal(rows(w).counts.live,1);
    bad=false;q.stop();await until(()=>logouts(q).length===1&&logouts(q)[0].finished&&!q.c.lifecycleSnapshot.cleanup.inFlight);
    assert.ok(logouts(q)[0].nonceAssertion);assert.equal(rows(w).counts.live,0);terminal(q,'CONSUMED');
  }finally{q.stop();}
});

test('v1.1 lock read 503 then ordinary current-generation PRESENT releases original owner before later stop',async()=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A);let after=false,bad=true;
  const q=tab(w,b,p,{intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){after=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&after&&bad)return new Response('{}',{status:503});return r;}});
  try{await ready(q);await q.signIn();p.switchTo(null);await flush();assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');
    bad=false;await q.c.restore();terminal(q,'RELEASED');assert.equal(q.c.state.sessionKnown,true);
    q.stop();await flush();assert.equal(logouts(q).length,0);assert.equal(rows(w).counts.live,1);assert.equal(rows(w).counts.revoked,0);
  }finally{q.stop();}
});

test('v1.1 planner displayed B takes precedence over retained old A and pending flow without mutating snapshot',()=>{
  const snapshot=Object.freeze({displayedAddress:'B',owner:Object.freeze({status:'RETAINED',nonce:'old-A',cancellationReason:'context-switch'}),pending:true});
  for(const reason of ['account-switch','provider-switch'])assert.deepEqual(planCleanup(reason,snapshot),{kind:'displayed-session',expectedAddress:'B'});
  assert.deepEqual(planCleanup('stop',snapshot),{kind:'verify-owner',expectedNonce:'old-A'});
  assert.deepEqual(planCleanup('lock',snapshot),{kind:'reconcile'});
  assert.deepEqual(planCleanup('explicit-signout',snapshot),{kind:'explicit'});
  for(const status of ['RELEASED','CONSUMED'])assert.deepEqual(planCleanup('account-switch',{...snapshot,owner:{...snapshot.owner,status}}),
    {kind:'displayed-session',expectedAddress:'B'});
  assert.deepEqual(planCleanup('account-switch',{pending:true}),{kind:'pending-flow-local-cancel'});
});

for(const replacement of ['different-address','same-address'])test(`v1.1 retained old A plus newer ${replacement} displayed session: switch C selects displayed primary, never dispatches A twice`,async()=>{
  const w=setup(),A=newAccount(),B=replacement==='same-address'?A:newAccount(),C=newAccount(),b=w.browser(),p=provider(A),oldCleanup=defer();
  let bad=false,held=false;
  const q=tab(w,b,p,{beforeSend:async(path,init)=>{
    if(path==='/api/auth/logout'&&JSON.parse(init.body).expectedNonce){held=true;await oldCleanup.promise;}
  },intercept:async(path,r)=>{
    if(path==='/api/auth/verify'){bad=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&bad)return new Response('{}',{status:503});return r;
  }});
  try{await ready(q);await q.signIn();assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');bad=false;
    q.stop();await until(()=>held);q.restart();await until(()=>q.c.state.sessionKnown&&q.c.state.session&&!q.c.state.checking);
    assert.equal((await b.signIn(B)).verify.status,200);await q.c.restore();assert.equal(q.c.state.session.address,B.address.toLowerCase());
    assert.equal(q.c.lifecycleSnapshot.retainedCount,1);const before=q.c.lifecycleSnapshot.cleanupPlans.at(-1).eventId;
    p.switchTo(C);await until(()=>logouts(q).filter(e=>e.addressAssertion).length===1&&logouts(q).find(e=>e.addressAssertion).finished);
    const plans=q.c.lifecycleSnapshot.cleanupPlans.filter(e=>e.eventId>before&&e.reason==='account-switch');
    assert.deepEqual(plans.map(e=>e.kind),['displayed-session']);
    assert.equal(logouts(q).filter(e=>e.nonceAssertion).length,1,'only A original already-in-flight responsibility');
    assert.equal(rows(w).sessions[1].revoked_at!==null,true,'switch C cleanup targets newer displayed session, even for equal address/expiry');
    assert.equal(rows(w).sessions[0].revoked_at,null,'held original A cleanup has not been replaced');
    oldCleanup.resolve();await until(()=>logouts(q).every(e=>e.finished));await flush();
    assert.equal(logouts(q).filter(e=>e.nonceAssertion).length,1);assert.equal(prompts([p]),1);
  }finally{oldCleanup.resolve();q.stop();}
});
