import test from 'node:test';
import assert from 'node:assert/strict';
import {WalletRegistry} from '../src/world/wallet.ts';
import {setup,newAccount,provider,tab,ready,defer,until,flush,rows,prompts,logouts,routeEvents} from './auth-r7-fixtures.mjs';

function registry(injected){
  const listeners=new Map();
  const win={ethereum:injected,addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),dispatchEvent:()=>true};
  const r=new WalletRegistry(win,null),stop=r.start();
  return {r,stop,announce(p,id='one'){
    for(const fn of listeners.get('eip6963:announceProvider')??[])fn({detail:{provider:p,
      info:{uuid:id,name:'Test wallet '+id,rdns:'io.example.'+id,icon:null}}});
  }};
}
function record(t,label,q,ps){
  t.diagnostic('AUDIT8 '+JSON.stringify({label,counts:rows(q.w).counts,prompts:prompts(ps),
    challenges:routeEvents(q,'/api/auth/challenge').length,verifies:routeEvents(q,'/api/auth/verify').length,
    cleanups:logouts(q).map(e=>({nonce:e.nonceAssertion,address:e.addressAssertion,status:e.status})),
    plans:q.c.lifecycleSnapshot.cleanupPlans,
    knowledge:q.c.lifecycleSnapshot.knowledge.kind,owner:q.c.lifecycleSnapshot.cleanup?{
      status:q.c.lifecycleSnapshot.cleanup.status,reason:q.c.lifecycleSnapshot.cleanup.cancellationReason}:null,
    events:q.events.map(({assertedNonce,...safe})=>safe)}));
}

for(const mode of ['late-announcement','second-wallet','same-address-object'])test(`Audit1 passive ${mode} must preserve accepted session`,async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),first=provider(A),second=provider(mode==='second-wallet'?B:A),reg=registry(first);
  let chosen=first;
  if(mode==='second-wallet')reg.announce(first);
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,first,{getProvider:()=>mode==='same-address-object'?chosen:reg.r.current()});
  const off=reg.r.subscribeProvider(reason=>q.notifyProvider(reason));
  try{
    await ready(q);assert.equal(rows(w).counts.live,1);const accepted=q.c.state.session;
    if(mode==='same-address-object'){chosen=second;q.observeProvider(second);q.notifyProvider('discovery');}
    else reg.announce(second,mode==='second-wallet'?'two':'one');
    await flush(20);record(t,mode,q,[first,second]);
    assert.equal(logouts(q).length,0,'passive discovery/object changes have no cleanup authority');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(q.c.state.session?.address,accepted.address);
    assert.equal(q.c.state.account,accepted.address,'passive announcements retain the authenticated wallet address');
    if(mode!=='same-address-object')assert.equal(reg.r.current(),first,'discovered wallets cannot replace a page-used provider');
    assert.equal((await (await b.get('/api/auth/session')).json()).signedIn,true);
    assert.equal(prompts([first,second]),0);assert.equal(routeEvents(q,'/api/auth/challenge').length,0);
    assert.equal(routeEvents(q,'/api/auth/verify').length,0);
  }finally{off();reg.stop();q.stop();}
});

for(const mode of ['same-address','different-address'])test(`Audit1 explicit ${mode} wallet selection owns cleanup; old provider callback cannot restore`,async t=>{
  const w=setup(),A=newAccount(),B=mode==='same-address'?A:newAccount(),b=w.browser(),first=provider(A),second=provider(B),reg=registry(null);
  let oldCallback;const on=first.on;first.on=(name,fn)=>{if(name==='accountsChanged')oldCallback=fn;on(name,fn);};
  reg.announce(first);reg.announce(second,'two');reg.r.choose(reg.r.state.options[0]);
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,first,{getProvider:()=>reg.r.current()}),off=reg.r.subscribeProvider(reason=>q.notifyProvider(reason));
  try{
    await ready(q);reg.r.choose(reg.r.state.options.find(o=>o.provider===second));
    await until(()=>rows(w).counts.revoked===1&&!q.c.state.session&&q.c.state.account===B.address.toLowerCase());
    assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].addressAssertion,true);assert.equal(logouts(q)[0].nonceAssertion,false);
    assert.equal(q.c.lifecycleSnapshot.cleanupPlans.at(-1).reason,'provider-switch');
    await q.signIn();await flush();oldCallback([A.address]);await flush();record(t,mode,q,[first,second]);
    assert.equal(q.c.state.account,B.address.toLowerCase());assert.equal(q.c.state.session.address,B.address.toLowerCase());
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[2,1,1]);
    assert.equal(prompts([first,second]),1);assert.equal(logouts(q).length,1);
  }finally{off();reg.stop();q.stop();}
});

test('Audit1 passive first provider with a different account cannot revoke a cookie-restored session without an established wallet account',async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(B),reg=registry(null);
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,p,{getProvider:()=>reg.r.current()}),off=reg.r.subscribeProvider(reason=>q.notifyProvider(reason));
  try{
    await until(()=>q.c.state.restored&&q.c.state.session&&!q.c.state.checking);
    assert.equal(q.c.state.account,null);assert.equal(reg.r.current(),null);
    reg.announce(p);await until(()=>q.c.state.account===B.address.toLowerCase());await flush(30);
    record(t,'late first provider without prior wallet account',q,[p]);
    assert.equal(logouts(q).length,0,'a restored cookie is not proof of a prior wallet identity');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(q.c.state.session.address,A.address.toLowerCase());assert.equal(q.c.state.account,B.address.toLowerCase());
    assert.equal(prompts([p]),0);assert.equal(routeEvents(q,'/api/auth/challenge').length,0);assert.equal(routeEvents(q,'/api/auth/verify').length,0);
  }finally{off();reg.stop();q.stop();}
});

for(const mode of ['unlock-first','same-account-first-unlock','discovery-first','observed-switch','observed-lock-switch','observed-lock-same','mismatch-lock-same','observed-lock-discovery-switch','mismatch-lock-discovery-same','fresh-page','same-client-restart'])test(`Audit8 LOW2 ${mode}: only established identity changes own session cleanup`,async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser();
  const observed=['observed-switch','observed-lock-switch','observed-lock-same','observed-lock-discovery-switch','fresh-page','same-client-restart'].includes(mode);
  const mismatch=mode.startsWith('mismatch-lock-'),p=provider(observed?A:mismatch?B:null);
  assert.equal((await b.signIn(A)).verify.status,200);
  let chosen=mode==='discovery-first'?null:p,q=tab(w,b,p,{getProvider:()=>chosen});
  try{
    await until(()=>q.c.state.restored&&q.c.state.session&&!q.c.state.checking);
    await flush();
    if(observed||mismatch)assert.equal(q.c.state.account,(mismatch?B:A).address.toLowerCase());
    else assert.equal(q.c.state.account,null);
    if(mode==='fresh-page'){
      q.stop();p.switchTo(null);q=tab(w,b,p);
      await until(()=>q.c.state.restored&&q.c.state.session&&!q.c.state.checking);await flush();
      assert.equal(q.c.state.account,null,'another page observation gives this page no switch authority');
    }
    if(mode==='same-client-restart'){
      q.stop();p.switchTo(null);q.restart();await flush(20);p.switchTo(null);await flush();
      assert.equal(q.c.state.account,null,'a previous lifetime observation gives this lifetime no switch authority');
    }
    const before=rows(w).counts,upstreamBefore=w.chain.state.calls.length;
    if(mode.startsWith('observed-lock-')||mismatch){
      p.switchTo(null);await flush();
      assert.equal(q.c.state.account,null);assert.equal(rows(w).counts.live,1);
      assert.equal(logouts(q).length,0,'locking alone cannot revoke the restored session');
    }
    const next=['same-account-first-unlock','observed-lock-same'].includes(mode)?A:B;
    if(['discovery-first','observed-lock-discovery-switch','mismatch-lock-discovery-same'].includes(mode)){chosen=provider(next);q.observeProvider(chosen);q.notifyProvider('discovery');}
    else p.switchTo(next);
    const switched=['observed-switch','observed-lock-switch','observed-lock-discovery-switch'].includes(mode);
    if(switched)await until(()=>logouts(q).some(e=>e.finished)&&q.channels.some(c=>c.messages.includes('signed-out')),
      'account-switch cleanup response and callback settled');
    else await flush(40);
    record(t,'LOW2 '+mode,q,[p,...chosen&&chosen!==p?[chosen]:[]]);
    t.diagnostic('LOW2_EFFECTS '+JSON.stringify({mode,before,after:rows(w).counts,
      broadcast:q.channels.flatMap(c=>c.messages),upstreamBefore,upstreamAfter:w.chain.state.calls.length}));
    assert.deepEqual(rows(w).counts,{created:1,live:switched?0:1,revoked:switched?1:0,challenges:1,used:1,pending:0,invalidated:0});
    assert.equal(logouts(q).length,switched?1:0);
    assert.equal(q.channels.flatMap(c=>c.messages).length,switched?1:0);
    assert.equal(q.c.state.account,next.address.toLowerCase());
    assert.equal(q.c.state.session?.address,switched?undefined:A.address.toLowerCase());
    assert.equal(prompts([p]),0);assert.equal(p.calls.filter(method=>method==='eth_requestAccounts').length,0);
    assert.equal(routeEvents(q,'/api/auth/challenge').length,0);assert.equal(routeEvents(q,'/api/auth/verify').length,0);
    assert.equal(w.chain.state.calls.length,upstreamBefore,'account observation does not add ownership work');
    if(switched){
      assert.equal(logouts(q)[0].addressAssertion,true);assert.equal(logouts(q)[0].nonceAssertion,false);
      assert.equal(logouts(q)[0].status,204);assert.equal(q.c.lifecycleSnapshot.cleanupPlans.at(-1).reason,'account-switch');
    }else assert.equal((await (await b.get('/api/auth/session')).json()).signedIn,true);
  }finally{q.stop();}
});

test('Audit8 LOW2 an explicit initial wallet grant establishes identity for later account-switch cleanup',async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A),request=p.request;
  p.request=async args=>args.method==='eth_accounts'?[]:request(args);
  const q=tab(w,b,p);
  try{
    await until(()=>q.c.state.restored&&!q.c.state.checking);assert.equal(q.c.state.account,null);
    await q.signIn();assert.equal(rows(w).counts.live,1);assert.equal(prompts([p]),1);
    assert.equal(p.calls.filter(method=>method==='eth_requestAccounts').length,1);
    p.switchTo(B);
    await until(()=>logouts(q).some(e=>e.finished)&&q.channels.some(c=>c.messages.includes('signed-out')),
      'explicit-grant account-switch cleanup response and callback settled');
    record(t,'LOW2 explicit initial grant then account switch',q,[p]);
    assert.deepEqual(rows(w).counts,{created:1,live:0,revoked:1,challenges:1,used:1,pending:0,invalidated:0});
    assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].addressAssertion,true);
    assert.equal(logouts(q)[0].nonceAssertion,false);assert.equal(logouts(q)[0].status,204);
    assert.equal(q.c.state.account,B.address.toLowerCase());assert.equal(q.c.state.session,null);
    assert.equal(prompts([p]),1,'a genuine account switch never automatically signs the new account');
    assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
  }finally{q.stop();}
});

for(const mode of ['accountsChanged','passive-different-account'])test(`Audit1 real identity change via ${mode} cleans old displayed authority`,async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),first=provider(A),second=provider(B);let chosen=first;
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,first,{getProvider:()=>chosen});
  try{
    await ready(q);
    if(mode==='accountsChanged')first.switchTo(B);
    else{chosen=second;q.observeProvider(second);q.notifyProvider('discovery');}
    await until(()=>rows(w).counts.revoked===1&&q.c.state.account===B.address.toLowerCase());await flush();record(t,mode,q,[first,second]);
    assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].addressAssertion,true);assert.equal(logouts(q)[0].nonceAssertion,false);
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,0,1]);
    assert.equal(prompts([first,second]),0);assert.equal(q.c.lifecycleSnapshot.cleanupPlans.at(-1).reason,'account-switch');
  }finally{q.stop();}
});

for(const mode of ['held-verify','invalid-verify-body'])test(`Audit3 ${mode} lock503 then same-account unlock preserves committed row`,async t=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),gate=defer();let bad=false,held=false,flow;
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/verify'&&mode==='held-verify'){held=true;await gate.promise;}},
    intercept:async(path,r,_init,e)=>{
      if(path==='/api/auth/verify'&&mode==='invalid-verify-body'){bad=true;return new Response('{',{status:r.status});}
      if(path==='/api/auth/session'&&bad){e.visibleStatus=503;return new Response('{"error":"AUTH_UNAVAILABLE"}',{status:503});}return r;
    }});
  try{
    await ready(q);flow=q.signIn();
    if(mode==='held-verify'){await until(()=>held);p.switchTo(null);bad=true;gate.resolve();await flow;}
    else{await flow;p.switchTo(null);}
    await until(()=>q.c.lifecycleSnapshot.cleanup?.status==='RETAINED'&&!q.c.lifecycleSnapshot.cleanup.reconciling);
    await flush(20);assert.equal(rows(w).counts.live,1);assert.equal(logouts(q).length,0);
    assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,'lock-reconcile');
    const before=rows(w).counts;
    bad=false;p.switchTo(A);await flush(20);record(t,mode,q,[p]);
    assert.equal(logouts(q).length,0,'same-account unlock retains reconciliation-only authority');
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[before.created,1,0]);
    assert.equal(prompts([p]),1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
    assert.equal((await (await b.get('/api/auth/session')).json()).signedIn,true);
    await q.c.restore();assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RELEASED');
  }finally{gate.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit3 old lock503 callback after same-account unlock and newer accepted generation cannot change or revoke either row',async t=>{
  const w=setup(),A=newAccount(),b=w.browser(),p=provider(A),gate=defer();let bad=false,hold=false,held=false,flow;
  const q=tab(w,b,p,{intercept:async(path,r,_init,e)=>{
    if(path==='/api/auth/verify'){bad=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&bad){e.visibleStatus=503;if(hold&&!held){held=true;await gate.promise;}
      return new Response('{}',{status:503});}return r;
  }});
  try{
    await ready(q);flow=q.signIn();await flow;hold=true;p.switchTo(null);await until(()=>held);
    assert.equal(rows(w).counts.live,1);bad=false;p.switchTo(A);
    await until(()=>q.c.state.sessionKnown&&q.c.state.session&&q.c.lifecycleSnapshot.cleanup.status==='RELEASED');
    assert.equal((await b.signIn(A)).verify.status,200);await q.signIn();
    assert.equal(q.c.state.sessionKnown,true);const accepted=q.c.state.session;
    gate.resolve();await flush(20);record(t,'stale lock callback/newer accepted generation',q,[p]);
    assert.equal(q.c.state.sessionKnown,true);assert.deepEqual(q.c.state.session,accepted);
    assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RELEASED');assert.equal(q.c.lifecycleSnapshot.retainedCount,0);
    assert.equal(logouts(q).length,0);assert.equal(prompts([p]),1);
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[2,2,0]);
  }finally{gate.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit3 real different-account unlock keeps old nonce cleanup authority and does not automatically sign the new account',async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),p=provider(A);let bad=false;
  const q=tab(w,b,p,{intercept:async(path,r,_init,e)=>{
    if(path==='/api/auth/verify'){bad=true;return new Response('{',{status:r.status});}
    if(path==='/api/auth/session'&&bad){e.visibleStatus=503;return new Response('{}',{status:503});}return r;
  }});
  try{
    await ready(q);await q.signIn();p.switchTo(null);await until(()=>q.c.lifecycleSnapshot.cleanup.cancellationReason==='lock-reconcile');
    bad=false;p.switchTo(B);await until(()=>rows(w).counts.revoked===1);await flush();record(t,'different account unlock',q,[p]);
    assert.equal(q.c.state.account,B.address.toLowerCase());assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].nonceAssertion,true);
    assert.equal(prompts([p]),1);assert.equal(rows(w).counts.live,0);assert.equal(q.c.lifecycleSnapshot.cleanup.status,'CONSUMED');
  }finally{q.stop();}
});

for(const mode of ['ABSENT','PRESENT-same','PRESENT-other','UNKNOWN','UNKNOWN-then-ABSENT','PRESENT-then-ABSENT','expired','exact-deadline','clock-rollback','invalid-clock','account-switch'])test(`Audit4 held signature plus ordinary canonical ${mode} keeps correct receipt and authority fences`,async t=>{
  const w=setup(),A=newAccount(),B=newAccount(),b=w.browser(),prompt=defer(),opened=defer();let bad=false,flow;
  const p=provider(A,{beforePrompt:async()=>{opened.resolve();await prompt.promise;}});
  const q=tab(w,b,p,{intercept:async(path,r,_init,e)=>{
    if(path==='/api/auth/session'&&bad){e.visibleStatus=503;return new Response('{}',{status:503});}return r;
  }});
  try{
    await ready(q);flow=q.signIn();await opened.promise;
    if(mode.startsWith('PRESENT'))assert.equal((await b.signIn(mode==='PRESENT-other'?B:A)).verify.status,200);
    if(mode.startsWith('UNKNOWN'))bad=true;
    if(mode==='expired')w.clock.advance(300_001);
    if(mode==='account-switch')p.switchTo(B);
    const reads=routeEvents(q,'/api/auth/session').length;q.channels.at(-1).message();
    await until(()=>routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished);await flush();
    if(mode==='exact-deadline')w.clock.advance(300_000);
    if(mode==='clock-rollback')w.clock.set(w.clock.now()-1);
    if(mode==='invalid-clock')w.clock.set(Infinity);
    if(mode.endsWith('then-ABSENT')){
      if(mode.startsWith('PRESENT'))assert.equal((await b.post('/api/auth/logout',{})).status,204);
      bad=false;await q.c.restore();assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'ABSENT');
    }
    prompt.resolve();await flow;await flush();record(t,'held signature/'+mode,q,[p]);
    assert.equal(prompts([p]),1);
    if(mode==='ABSENT'){
      assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
      assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
      assert.equal(q.c.state.session.address,A.address.toLowerCase());assert.equal(q.c.state.notice,null);
    }else{
      assert.equal(routeEvents(q,'/api/auth/verify').length,0,'changed or unknown authority/expiry cannot reuse signature');
      assert.equal(logouts(q).length,0);
      if(mode.startsWith('PRESENT')){assert.equal(rows(w).counts.live,mode.endsWith('then-ABSENT')?0:1);assert.equal(rows(w).counts.created,1);}
      else assert.equal(rows(w).counts.created,0);
      if(mode==='UNKNOWN')assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'UNKNOWN');
    }
  }finally{prompt.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit4 repeated ordinary ABSENT before and during prompt advances receipt ordering without another signature/challenge',async t=>{
  const w=setup(),A=newAccount(),b=w.browser(),challenge=defer(),prompt=defer(),opened=defer();let held=false,flow;
  const p=provider(A,{beforePrompt:async()=>{opened.resolve();await prompt.promise;}});
  const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/challenge'){held=true;await challenge.promise;}return r;}});
  try{
    await ready(q);flow=q.signIn();await until(()=>held);
    q.channels.at(-1).message();await until(()=>routeEvents(q,'/api/auth/session').at(-1).finished);await flush();challenge.resolve();await opened.promise;
    for(let i=0;i<4;i++){await q.c.restore();assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'ABSENT');}
    prompt.resolve();await flow;await flush();record(t,'repeated ordinary ABSENT',q,[p]);
    assert.equal(prompts([p]),1);assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(q.c.state.session.address,A.address.toLowerCase());assert.equal(q.c.state.notice,null);
    assert.equal(routeEvents(q,'/api/auth/session').length,8,'initial, initial click, five ordinary reads and one same-click recheck');
  }finally{challenge.resolve();prompt.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit4 pending ordinary old-cookie ABSENT is awaited then own recheck observes a sibling accepted session without another prompt',async t=>{
  const w=setup(),A=newAccount(),b=w.browser(),prompt=defer(),opened=defer(),read=defer();let hold=false,held=false,flow;
  const p=provider(A,{beforePrompt:async()=>{opened.resolve();await prompt.promise;}});
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/session'&&hold&&!held){held=true;await read.promise;}}});
  try{
    await ready(q);flow=q.signIn();await opened.promise;hold=true;q.channels.at(-1).message();await until(()=>held);
    assert.equal((await b.signIn(A)).verify.status,200);prompt.resolve();await flush();
    assert.equal(routeEvents(q,'/api/auth/verify').length,0,'held ordinary receipt cannot authorize a verify');
    read.resolve();await flow;await flush();record(t,'held old-cookie ordinary read/sibling accepted',q,[p]);
    assert.equal(routeEvents(q,'/api/auth/verify').length,0);assert.equal(prompts([p]),1);
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(q.c.state.session.address,A.address.toLowerCase());
  }finally{read.resolve();prompt.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit4 a valid newer ordinary ABSENT during the one same-click recheck keeps the original signature',async t=>{
  const w=setup(),A=newAccount(),b=w.browser(),prompt=defer(),opened=defer(),read=defer();let hold=false,held=false,flow;
  const p=provider(A,{beforePrompt:async()=>{opened.resolve();await prompt.promise;}});
  const q=tab(w,b,p,{beforeSend:async path=>{if(path==='/api/auth/session'&&hold&&!held){held=true;await read.promise;}}});
  try{
    await ready(q);flow=q.signIn();await opened.promise;await q.c.restore();
    hold=true;prompt.resolve();await until(()=>held);await q.c.restore();
    assert.equal(q.c.lifecycleSnapshot.knowledge.kind,'ABSENT');read.resolve();await flow;await flush();
    record(t,'ordinary ABSENT supersedes one same-click recheck',q,[p]);
    assert.equal(prompts([p]),1);assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
    assert.deepEqual([rows(w).counts.created,rows(w).counts.live,rows(w).counts.revoked],[1,1,0]);
    assert.equal(q.c.state.session.address,A.address.toLowerCase());assert.equal(q.c.state.notice,null);
  }finally{read.resolve();prompt.resolve();await flow?.catch(()=>{});q.stop();}
});
