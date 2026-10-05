import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {setup,provider,tab,ready,defer,until,flush,rows,logouts,prompts,routeEvents,fakeChain,fakeImd,statusOf} from './auth-r7-fixtures.mjs';

// Public synthetic identities, never production wallets. These are the actual AuthClient, Worker and SQLite fixtures.
const A=privateKeyToAccount('0x'+'11'.repeat(32)),B=privateKeyToAccount('0x'+'22'.repeat(32));
const C=privateKeyToAccount('0x'+'33'.repeat(32)),D=privateKeyToAccount('0x'+'44'.repeat(32));
const address=account=>account.address.toLowerCase();
function observe(t,label,q,p,extra={}){
  t.diagnostic('AUDIT9_AUTH '+JSON.stringify({label,rows:rows(q.w),client:{account:q.c.state.account,
    session:q.c.state.session?.address??null,status:statusOf(q.c.state,q.w.clock.now()),known:q.c.state.sessionKnown},
    counts:{prompt:prompts([p]),connect:p.calls.filter(method=>method==='eth_requestAccounts').length,
      challenge:routeEvents(q,'/api/auth/challenge').length,verify:routeEvents(q,'/api/auth/verify').length,
      session:routeEvents(q,'/api/auth/session').length,home:routeEvents(q,'/api/me/home').length,
      logout:logouts(q).length,index:q.w.chain.state.calls.filter(c=>!c.body).length,
      rpc:q.w.chain.state.calls.filter(c=>c.body).length},
    events:q.events.map(({assertedNonce,...event})=>event),broadcast:q.channels.flatMap(c=>c.messages),
    lifecycle:q.c.lifecycleSnapshot,...extra}));
}

for(const mode of ['different-account','locked','no-provider'])test(`Audit9 LOW2 same-client restart ${mode} adopts the first binding reply without cleanup`,async t=>{
  const owners=[];owners[7]=address(A);
  const w=setup({chain:fakeChain({owners:{7:address(A)}}),imd:fakeImd({seats:{7:'707'},owners,online:[7]})});
  const b=w.browser(),p=provider(A);let chosen=p,budget=0,hintWrites=0;
  w.env.CHAIN_LIMITER={limit:async({key})=>{if(key==='chain:index')budget++;return {success:true};}};
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,p,{getProvider:()=>chosen}),setHint=q.c.deps.hint.set;
  q.c.deps.hint.set=value=>{hintWrites++;setHint(value);};
  try{
    await ready(q);assert.equal(statusOf(q.c.state,w.clock.now()),'owner');
    const before=rows(w),reads=routeEvents(q,'/api/auth/session').length;
    q.stop();p.switchTo(mode==='different-account'?B:null);if(mode==='no-provider')chosen=null;
    q.restart();await until(()=>routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&!q.c.state.checking);
    await flush(20);observe(t,'LOW2 restart '+mode,q,p,{before,budget,hintWrites});
    assert.equal(q.c.state.account,mode==='different-account'?address(B):null,'the first binding reply reconciles public account even when the old lifetime held A');
    assert.equal(q.c.state.session?.address,address(A));assert.deepEqual(rows(w),before);
    assert.equal(statusOf(q.c.state,w.clock.now()),mode==='different-account'?'mismatch':'owner');
    assert.equal(logouts(q).length,0);assert.equal(prompts([p]),0);
    assert.equal(routeEvents(q,'/api/auth/challenge').length,0);assert.equal(routeEvents(q,'/api/auth/verify').length,0);
    assert.equal(q.channels.flatMap(c=>c.messages).length,0);
    assert.equal(budget,1);assert.equal(w.chain.state.calls.filter(c=>c.body).length,1);
    assert.equal(p.calls.filter(method=>method==='eth_requestAccounts').length,0);
    if(mode==='different-account'){
      // Only the following explicit click may replace cookie A; the old same-session fast path must not win.
      await q.signIn();await flush(20);observe(t,'LOW2 explicit B after restart',q,p,{budget,hintWrites});
      assert.equal(q.c.state.account,address(B));assert.equal(q.c.state.session?.address,address(B));
      assert.equal(prompts([p]),1);assert.equal(routeEvents(q,'/api/auth/challenge').length,1);
      assert.equal(routeEvents(q,'/api/auth/verify').length,1);assert.equal(logouts(q).length,1);
      assert.equal(logouts(q)[0].addressAssertion,true);assert.equal(logouts(q)[0].nonceAssertion,false);
      assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,w.clock.now());
      assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,null);
    }
  }finally{q.stop();}
});

test('Audit9 LOW2 restart observing B followed by genuine B-to-A change cleans displayed cookie B once',async t=>{
  const w=setup(),b=w.browser(),p=provider(A);assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,p);
  try{
    await ready(q);q.stop();p.switchTo(B);assert.equal((await b.signIn(B)).verify.status,200);
    const reads=routeEvents(q,'/api/auth/session').length;q.restart();
    await until(()=>routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&!q.c.state.checking);
    await flush(20);const bindingAccount=q.c.state.account,preSwitch=rows(w);
    p.switchTo(A);await flush(40);observe(t,'LOW2 genuine B-to-A after restart',q,p,{bindingAccount,preSwitch});
    assert.equal(bindingAccount,address(B),'public and observed accounts must agree before the later event');
    assert.equal(q.c.state.account,address(A));assert.equal(logouts(q).length,1);
    assert.equal(logouts(q)[0].addressAssertion,true);assert.equal(logouts(q)[0].nonceAssertion,false);
    assert.equal(logouts(q)[0].status,204);assert.equal(logouts(q)[0].finished,true);
    assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,w.clock.now());
    assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,null);
    assert.equal(q.channels.flatMap(c=>c.messages).filter(v=>v==='signed-out').length,1);
    assert.equal(prompts([p]),0);assert.equal(routeEvents(q,'/api/auth/challenge').length,0);
    assert.equal(routeEvents(q,'/api/auth/verify').length,0);
  }finally{q.stop();}
});

for(const mode of ['no-event','first-observation','current-switch'])test(`Audit9 LOW3 detached old owner ${mode} retains nonce responsibility without first-observation revocation`,async t=>{
  const w=setup(),b=w.browser(),p=provider(B),verify=defer(),cleanup=defer();
  let committed=false,held=false,flow,budget=0,hintWrites=0;
  w.env.CHAIN_LIMITER={limit:async({key})=>{if(key==='chain:index')budget++;return {success:true};}};
  const q=tab(w,b,p,{beforeSend:async(path,init)=>{
    if(path==='/api/auth/logout'&&JSON.parse(init.body).expectedNonce){held=true;await cleanup.promise;}
  },intercept:async(path,r)=>{if(path==='/api/auth/verify'){committed=true;await verify.promise;}return r;}});
  const setHint=q.c.deps.hint.set;q.c.deps.hint.set=value=>{hintWrites++;setHint(value);};
  try{
    await ready(q);flow=q.signIn();await until(()=>committed);
    p.switchTo(null);q.stop();await until(()=>held);
    assert.equal((await b.signIn(A)).verify.status,200);
    q.restart();await until(()=>q.c.state.session?.address===address(A)&&!q.c.state.checking);await flush();
    assert.equal(q.c.state.account,null);
    const before=rows(w),beforeHints=hintWrites,chainCalls=w.chain.state.calls.length;
    const oldNonce=before.sessions.find(s=>s.address===address(B)).nonce;
    assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].assertedNonce,oldNonce);
    assert.equal(logouts(q)[0].finished,undefined);
    if(mode!=='no-event'){
      p.switchTo(C);await flush(20);
      // Observe a vulnerable dispatch to completion before capturing rows; the fixed path dispatches none.
      if(logouts(q).some(e=>e.addressAssertion))await until(()=>logouts(q).filter(e=>e.addressAssertion).every(e=>e.finished));
      await flush(20);
    }
    observe(t,'LOW3 protected replacement '+mode,q,p,{before,budget,hintWrites,beforeHints});
    assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,null,'old-lifetime ownership cannot authorize a new-lifetime address logout');
    assert.deepEqual(rows(w),before);assert.equal(logouts(q).length,1);
    assert.equal(logouts(q).filter(e=>e.addressAssertion).length,0);
    assert.equal(hintWrites,beforeHints);assert.equal(q.channels.flatMap(c=>c.messages).length,0);
    assert.equal(q.c.state.session?.address,address(A));
    assert.equal(q.c.state.account,mode==='no-event'?null:address(C));
    if(mode!=='no-event')assert.equal(statusOf(q.c.state,w.clock.now()),'mismatch');
    assert.equal(w.chain.state.calls.length,chainCalls);
    assert.equal(prompts([p]),1);assert.equal(routeEvents(q,'/api/auth/challenge').length,1);
    assert.equal(routeEvents(q,'/api/auth/verify').length,1);
    assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');
    assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,'stop');
    if(mode==='current-switch'){
      // C was genuinely observed in this life. A subsequent C-to-D switch keeps its own authority.
      p.switchTo(D);await until(()=>logouts(q).some(e=>e.addressAssertion&&e.finished));await flush(20);
      assert.equal(logouts(q).filter(e=>e.addressAssertion).length,1);
      assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,w.clock.now());
      assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,null);
    }
    cleanup.resolve();await until(()=>logouts(q)[0].finished);verify.resolve();await flow;await flush(40);
    observe(t,'LOW3 detached nonce settled '+mode,q,p,{budget,hintWrites});
    assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,w.clock.now());
    assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,mode==='current-switch'?w.clock.now():null);
    assert.equal(logouts(q).filter(e=>e.nonceAssertion).length,1);
    assert.equal(logouts(q).filter(e=>e.addressAssertion).length,mode==='current-switch'?1:0);
    assert.equal(q.c.lifecycleSnapshot.cleanup.status,'CONSUMED');assert.equal(q.c.lifecycleSnapshot.retainedCount,0);
    assert.equal(q.c.state.account,mode==='no-event'?null:address(mode==='current-switch'?D:C));
    // Late old-cookie-clear headers may clear the shared cookie; the active life must read it, not install old B.
    const canonical=await(await b.get('/api/auth/session')).json();
    assert.equal(q.c.state.session?.address??null,canonical.signedIn?canonical.address:null);
    assert.equal(prompts([p]),1);assert.equal(routeEvents(q,'/api/auth/challenge').length,1);
    assert.equal(routeEvents(q,'/api/auth/verify').length,1);
  }finally{cleanup.resolve();verify.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit9 LOW2 late initial empty reply cannot overwrite a newer explicit wallet grant',async t=>{
  const w=setup(),b=w.browser(),p=provider(A),initial=defer(),request=p.request;let held=false;
  p.request=async args=>{if(args.method==='eth_accounts'){held=true;await initial.promise;return [];}return request(args);};
  const q=tab(w,b,p);
  try{
    await until(()=>held&&q.c.state.restored&&!q.c.state.checking);
    await q.signIn();assert.equal(q.c.state.account,address(A));assert.equal(q.c.state.session?.address,address(A));
    initial.resolve();await flush(20);observe(t,'LOW2 late empty reply after explicit grant',q,p);
    assert.equal(q.c.state.account,address(A));assert.equal(q.c.state.session?.address,address(A));
    assert.equal(prompts([p]),1);assert.equal(p.calls.filter(method=>method==='eth_requestAccounts').length,1);
    assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
    assert.equal(logouts(q).length,0);assert.equal(rows(w).counts.live,1);
  }finally{initial.resolve();q.stop();}
});

for(const mode of ['different-account','locked'])test(`Audit9 LOW2 early click during restarted ${mode} binding never uses the prior lifetime account`,async t=>{
  const w=setup(),b=w.browser(),p=provider(A),initial=defer(),request=p.request;
  let delay=false,held=false;
  p.request=async args=>{
    const reply=await request(args);
    if(args.method==='eth_accounts'&&delay){held=true;await initial.promise;}
    return reply;
  };
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,p);
  try{
    await ready(q);q.stop();p.switchTo(mode==='different-account'?B:null);delay=true;
    const reads=routeEvents(q,'/api/auth/session').length;q.restart();
    await until(()=>held&&routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&!q.c.state.checking);
    await flush(10);const before=rows(w),beforeClickAccount=q.c.state.account;
    assert.equal(q.c.state.session?.address,address(A));assert.equal(logouts(q).length,0);
    await q.signIn();const early={account:q.c.state.account,session:q.c.state.session?.address??null};
    initial.resolve();await flush(20);observe(t,'LOW2 early click on restarted '+mode,q,p,{before,beforeClickAccount,early});
    assert.equal(p.calls.filter(method=>method==='eth_requestAccounts').length,1,'new-life explicit click obtains its actual wallet grant, never the prior-life fast path');
    assert.equal(beforeClickAccount,null,'binding starts with no public wallet observation in this lifetime');
    assert.equal(q.c.state.account,mode==='different-account'?address(B):null);
    assert.equal(q.c.state.session?.address,mode==='different-account'?address(B):address(A));
    assert.equal(prompts([p]),mode==='different-account'?1:0);
    assert.equal(routeEvents(q,'/api/auth/challenge').length,mode==='different-account'?1:0);
    assert.equal(routeEvents(q,'/api/auth/verify').length,mode==='different-account'?1:0);
    assert.equal(logouts(q).length,mode==='different-account'?1:0);
    if(mode==='different-account'){
      assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,w.clock.now());
      assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,null);
    }else assert.deepEqual(rows(w),before,'an explicit failed grant and late empty reply preserve cookie A');
  }finally{initial.resolve();q.stop();}
});

test('Audit9 LOW2 passive replacement during restarted initial binding has no prior-life switch authority',async t=>{
  const w=setup(),b=w.browser(),p=provider(A),next=provider(B),initial=defer(),request=p.request;
  let delay=false,held=false,chosen=p;
  p.request=async args=>{const reply=await request(args);if(args.method==='eth_accounts'&&delay){held=true;await initial.promise;}return reply;};
  assert.equal((await b.signIn(A)).verify.status,200);
  const q=tab(w,b,p,{getProvider:()=>chosen});
  try{
    await ready(q);q.stop();delay=true;const reads=routeEvents(q,'/api/auth/session').length;q.restart();
    await until(()=>held&&routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&!q.c.state.checking);
    const before=rows(w);chosen=next;q.observeProvider(next);q.notifyProvider('discovery');await flush(20);
    initial.resolve();await flush(20);observe(t,'LOW2 passive replacement before initial observation',q,p,{before,newProviderCalls:next.calls});
    assert.equal(q.c.state.account,address(B));assert.equal(q.c.state.session?.address,address(A));
    assert.equal(statusOf(q.c.state,w.clock.now()),'mismatch');assert.deepEqual(rows(w),before);
    assert.equal(logouts(q).length,0);assert.equal(prompts([p,next]),0);
    assert.equal(routeEvents(q,'/api/auth/challenge').length,0);assert.equal(routeEvents(q,'/api/auth/verify').length,0);
    assert.equal(q.channels.flatMap(c=>c.messages).length,0);
  }finally{initial.resolve();q.stop();}
});
