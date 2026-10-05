import test from 'node:test';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {setup,provider,tab,ready,defer,until,rows,logouts,prompts,connects,routeEvents,statusOf} from './auth-r7-fixtures.mjs';

// Public synthetic accounts; all requests run the real AuthClient, Worker, viem and migration-backed SQLite.
const A=privateKeyToAccount('0x'+'11'.repeat(32)),B=privateKeyToAccount('0x'+'22'.repeat(32));
const C=privateKeyToAccount('0x'+'33'.repeat(32)),D=privateKeyToAccount('0x'+'44'.repeat(32));
const address=account=>account.address.toLowerCase();
function observe(t,label,q,ps,extra={}){
  t.diagnostic('AUDIT10_AUTH '+JSON.stringify({label,rows:rows(q.w),lifecycle:q.c.lifecycleSnapshot,
    client:{account:q.c.state.account,session:q.c.state.session?.address??null,known:q.c.state.sessionKnown,
      status:statusOf(q.c.state,q.w.clock.now())},
    counts:{prompt:prompts(ps),connect:connects(ps),challenge:routeEvents(q,'/api/auth/challenge').length,
      verify:routeEvents(q,'/api/auth/verify').length,session:routeEvents(q,'/api/auth/session').length,
      home:routeEvents(q,'/api/me/home').length,nonceLogout:logouts(q).filter(e=>e.nonceAssertion).length,
      addressLogout:logouts(q).filter(e=>e.addressAssertion).length,
      index:q.w.chain.state.calls.filter(c=>!c.body).length,rpc:q.w.chain.state.calls.filter(c=>c.body).length},
    events:q.events.map(({assertedNonce,...event})=>event),broadcast:q.channels.flatMap(c=>c.messages),...extra}));
}

for(const mode of ['stop-B','stop-A','same-life-switch'])for(const discovery of [false,true]){
  test(`Audit10 L1 ${mode} failed first cleanup ${discovery?'with passive discovery':'without discovery control'}`,async t=>{
    const w=setup(),b=w.browser(),p=provider(B),next=provider(C),verify=defer();
    let chosen=p,committed=false,failed=false,flow,budget=0,hintWrites=0;
    w.env.CHAIN_LIMITER={limit:async({key})=>{if(key==='chain:index')budget++;return {success:true};}};
    const q=tab(w,b,p,{getProvider:()=>chosen,beforeSend:async(path,init)=>{
      if(path==='/api/auth/logout'&&JSON.parse(init.body).expectedNonce&&!failed){
        failed=true;throw new TypeError('synthetic first cleanup transport failure before Worker');
      }
    },intercept:async(path,r)=>{if(path==='/api/auth/verify'){committed=true;await verify.promise;}return r;}});
    const setHint=q.c.deps.hint.set;q.c.deps.hint.set=value=>{hintWrites++;setHint(value);};
    try{
      await ready(q);flow=q.signIn();await until(()=>committed,'B committed with verify response held');
      const committedRows=rows(w),nonce=committedRows.sessions.find(s=>s.address===address(B)).nonce;
      if(mode==='same-life-switch')p.switchTo(C);else q.stop();
      await until(()=>failed&&q.c.lifecycleSnapshot.cleanup?.status==='RETAINED'&&!q.c.lifecycleSnapshot.cleanup.inFlight,'failed first cleanup retained');
      const reason=mode==='same-life-switch'?'context-switch':'stop';
      assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,reason);
      assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].assertedNonce,nonce);
      assert.equal(logouts(q)[0].status,undefined,'first attempt never reached Worker');
      if(mode!=='same-life-switch'){
        p.switchTo(null);
        if(mode==='stop-A')assert.equal((await b.signIn(A)).verify.status,200);
        const reads=routeEvents(q,'/api/auth/session').length;q.restart();
        await until(()=>routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&
          !q.c.state.checking,'restart completed current cookie read');
        assert.equal(q.c.state.account,null);
        if(mode==='stop-A')assert.equal(q.c.state.session?.address,address(A));
      }
      const beforeDiscovery=q.c.lifecycleSnapshot,beforeRows=rows(w);
      if(discovery){chosen=next;q.observeProvider(next);q.notifyProvider('discovery');
        await until(()=>q.c.state.account===address(C),'replacement provider passively observed');}
      const afterDiscovery=q.c.lifecycleSnapshot;
      // Do not fail before releasing the verify: measure the lost retry and final database effects too.
      verify.resolve();await flow;
      await until(()=>q.c.lifecycleSnapshot.retainedCount===0,'late original verify responsibility settled');
      const last=logouts(q).at(-1);if(last?.status!==undefined)await until(()=>last.finished,'last nonce request completed');
      await until(()=>!q.c.state.checking&&routeEvents(q,'/api/auth/session').every(e=>e.finished),'canonical cookie reconciliation completed');
      observe(t,'retained cleanup after discovery '+mode,q,[p,next],{discovery,beforeDiscovery,afterDiscovery,beforeRows,budget,hintWrites});
      assert.equal(afterDiscovery.cleanup.cancellationReason,reason,'passive discovery cannot weaken an original revoking reason');
      assert.equal(logouts(q).length,2,'original operation performs its post-response nonce-specific retry');
      assert.ok(logouts(q).every(e=>e.nonceAssertion&&e.assertedNonce===nonce));
      assert.equal(logouts(q).filter(e=>e.addressAssertion).length,0,'no unrelated displayed-address authority');
      assert.equal(last.finished,true);assert.equal(last.status,mode==='stop-A'?409:204);
      assert.equal(q.c.lifecycleSnapshot.cleanup.status,'CONSUMED');
      const final=rows(w);
      assert.equal(final.sessions.find(s=>s.address===address(B)).revoked_at,mode==='stop-A'?null:w.clock.now());
      assert.deepEqual(final.challenges,beforeRows.challenges,'cleanup never creates, renews or invalidates another challenge');
      assert.equal(final.counts.created,mode==='stop-A'?2:1);
      if(mode==='stop-A')assert.equal(final.sessions.find(s=>s.address===address(A)).revoked_at,null,'the replacement A session remains live');
      assert.equal(prompts([p,next]),1);assert.equal(connects([p,next]),0);
      assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
      assert.equal(q.channels.flatMap(c=>c.messages).filter(v=>v==='signed-in').length,0,'cancelled verify cannot announce old B acceptance');
      const canonical=await(await b.get('/api/auth/session')).json();
      assert.equal(q.c.state.session?.address??null,canonical.signedIn?canonical.address.toLowerCase():null,'current UI follows canonical cookie, not late B body');
      if(mode==='stop-A')assert.equal(q.c.state.session?.address,address(A));
      else assert.equal(q.c.state.session,null);
    }finally{verify.resolve();await flow?.catch(()=>{});q.stop();}
  });
}

test('Audit10 L1 same-lifetime lock may promote to stop and still retry nonce cleanup after discovery',async t=>{
  const w=setup(),b=w.browser(),p=provider(B),next=provider(C),verify=defer();
  let chosen=p,committed=false,failed=false,flow;
  const q=tab(w,b,p,{getProvider:()=>chosen,beforeSend:async(path,init)=>{
    if(path==='/api/auth/logout'&&JSON.parse(init.body).expectedNonce&&!failed){failed=true;throw new TypeError('synthetic cleanup transport failure');}
  },intercept:async(path,r)=>{if(path==='/api/auth/verify'){committed=true;await verify.promise;}return r;}});
  try{
    await ready(q);flow=q.signIn();await until(()=>committed);
    p.switchTo(null);assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,'lock-reconcile');
    assert.equal(logouts(q).length,0,'a wallet lock cannot revoke its pending session');
    q.stop();await until(()=>failed&&!q.c.lifecycleSnapshot.cleanup.inFlight);
    assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,'stop','stronger cancellation can promote reconcile-only responsibility');
    const reads=routeEvents(q,'/api/auth/session').length;q.restart();
    await until(()=>routeEvents(q,'/api/auth/session').length>reads&&routeEvents(q,'/api/auth/session').at(-1).finished&&!q.c.state.checking);
    chosen=next;q.observeProvider(next);q.notifyProvider('discovery');await until(()=>q.c.state.account===address(C));
    verify.resolve();await flow;await until(()=>q.c.lifecycleSnapshot.retainedCount===0);
    const last=logouts(q).at(-1);if(last.status!==undefined)await until(()=>last.finished);
    await until(()=>!q.c.state.checking&&routeEvents(q,'/api/auth/session').every(e=>e.finished));
    observe(t,'lock-stop promotion retains nonce cleanup',q,[p,next]);
    assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,'stop');
    assert.equal(q.c.lifecycleSnapshot.cleanup.status,'CONSUMED');assert.equal(logouts(q).length,2);
    assert.ok(logouts(q).every(e=>e.nonceAssertion&&!e.addressAssertion));
    assert.equal(logouts(q).at(-1).status,204);assert.equal(rows(w).sessions[0].revoked_at,w.clock.now());
    assert.equal(q.c.state.session,null);assert.equal(prompts([p,next]),1);
  }finally{verify.resolve();await flow?.catch(()=>{});q.stop();}
});

test('Audit10 L1 passive first observation preserves A, then genuine current C-to-D switch cleans A once',async t=>{
  const w=setup(),b=w.browser(),p=provider(B),next=provider(C),verify=defer();
  let chosen=p,committed=false,failed=false,flow;
  const q=tab(w,b,p,{getProvider:()=>chosen,beforeSend:async(path,init)=>{
    if(path==='/api/auth/logout'&&JSON.parse(init.body).expectedNonce&&!failed){failed=true;throw new TypeError('synthetic first cleanup transport failure');}
  },intercept:async(path,r)=>{if(path==='/api/auth/verify'){committed=true;await verify.promise;}return r;}});
  try{
    await ready(q);flow=q.signIn();await until(()=>committed);q.stop();
    await until(()=>failed&&!q.c.lifecycleSnapshot.cleanup.inFlight);p.switchTo(null);
    assert.equal((await b.signIn(A)).verify.status,200);q.restart();
    await until(()=>q.c.state.session?.address===address(A)&&!q.c.state.checking);
    chosen=next;q.observeProvider(next);q.notifyProvider('discovery');await until(()=>q.c.state.account===address(C));
    assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,null);assert.equal(logouts(q).length,1);
    next.switchTo(D);await until(()=>logouts(q).some(e=>e.addressAssertion&&e.finished),'current-lifetime address cleanup finished');
    await until(()=>!q.c.state.checking&&routeEvents(q,'/api/auth/session').every(e=>e.finished));
    assert.equal(logouts(q).filter(e=>e.addressAssertion).length,1);
    assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,w.clock.now());
    assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,null);
    verify.resolve();await flow;await until(()=>q.c.lifecycleSnapshot.retainedCount===0);
    await until(()=>logouts(q).at(-1).finished&&!q.c.state.checking&&routeEvents(q,'/api/auth/session').every(e=>e.finished));
    observe(t,'genuine current C-D authority independent of old B nonce',q,[p,next]);
    assert.equal(logouts(q).filter(e=>e.nonceAssertion).length,2);
    assert.equal(logouts(q).filter(e=>e.addressAssertion).length,1);
    assert.equal(q.c.lifecycleSnapshot.cleanup.status,'CONSUMED');
    assert.equal(q.c.state.account,address(D));assert.equal(q.c.state.session,null);
    assert.equal(q.channels.flatMap(c=>c.messages).filter(v=>v==='signed-out').length,1);
    assert.equal(prompts([p,next]),1);assert.equal(connects([p,next]),0);
  }finally{verify.resolve();await flow?.catch(()=>{});q.stop();}
});

for(const failure of ['transport','503'])for(const cookie of ['B','foreign-A']){
  test(`Audit10 L1 uncertain post-fence ${failure} cleanup retains responsibility with ${cookie} cookie`,async t=>{
    const w=setup(),b=w.browser(),p=provider(B),verify=defer();
    let committed=false,flow,unavailable=true;const attempts=[];
    const q=tab(w,b,p,{intercept:async(path,r)=>{if(path==='/api/auth/verify'){committed=true;await verify.promise;}return r;}});
    const fetch=q.c.deps.fetch;q.c.deps.fetch=async(path,init={})=>{
      const nonce=path==='/api/auth/logout'&&JSON.parse(init.body??'{}').expectedNonce;
      if(nonce){const attempt={nonce,observed:q.c.lifecycleSnapshot.cleanup.responseObserved};attempts.push(attempt);
        if(unavailable){attempt.failure=failure;
          if(failure==='transport')throw new TypeError('synthetic repeated cleanup transport failure before Worker');
          return new Response('{}',{status:503,headers:{'content-type':'application/json'}});
        }
        const result=await fetch(path,init);attempt.status=result.status;return result;
      }
      return fetch(path,init);
    };
    try{
      await ready(q);flow=q.signIn();await until(()=>committed);const original=rows(w),nonce=original.sessions[0].nonce;
      q.stop();await until(()=>attempts.length===1&&!q.c.lifecycleSnapshot.cleanup.inFlight);
      if(cookie==='foreign-A')assert.equal((await b.signIn(A)).verify.status,200);
      const stoppedStates=q.states.length;verify.resolve();await flow;
      await until(()=>attempts.length===2&&!q.c.lifecycleSnapshot.cleanup.inFlight);
      assert.equal(q.states.length,stoppedStates,'old verify callback cannot install identity in the stopped UI');
      observe(t,'post-fence uncertainty before later trigger',q,[p],{failure,cookie,attempts});
      assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED','network/5xx uncertainty is not conclusive cleanup');
      assert.equal(q.c.lifecycleSnapshot.cleanup.cancellationReason,'stop');
      assert.equal(q.c.lifecycleSnapshot.retainedCount,1);assert.equal(rows(w).sessions[0].revoked_at,null);
      assert.deepEqual(attempts.map(e=>e.observed),[false,true]);assert.ok(attempts.every(e=>e.nonce===nonce));
      q.restart();await until(()=>attempts.length===3&&!q.c.lifecycleSnapshot.cleanup.inFlight&&q.c.state.restored&&!q.c.state.checking);
      await q.c.restore();assert.equal(attempts.length,3,'persistent uncertainty does not spin immediate or ordinary-read retry loops');
      assert.equal(q.c.lifecycleSnapshot.cleanup.status,'RETAINED');
      if(cookie==='B'){
        // The current lifetime's canonical read is authority independently of the retained old cleanup.
        // A pending nonce revocation is not falsely declared complete, and the old callback is never acceptance.
        assert.equal(q.c.state.session?.address,address(B));assert.equal(q.c.state.sessionKnown,true);
      }else{
        assert.equal(q.c.state.session?.address,address(A));assert.equal(q.c.state.sessionKnown,true);
        assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,null);
      }
      unavailable=false;q.stop();
      await until(()=>attempts.length===4&&q.c.lifecycleSnapshot.cleanup.status==='CONSUMED','later stop cleanup conclusively completed');
      q.restart();await q.c.restore();await until(()=>!q.c.state.checking);
      observe(t,'later causal trigger settles retained responsibility',q,[p],{failure,cookie,attempts});
      assert.equal(attempts.length,4);assert.equal(attempts[3].status,cookie==='B'?204:409);
      assert.equal(q.c.lifecycleSnapshot.retainedCount,0);assert.ok(attempts.every(e=>e.nonce===nonce));
      assert.equal(logouts(q).length,1);assert.equal(logouts(q)[0].nonceAssertion,true);assert.equal(logouts(q)[0].addressAssertion,false);
      assert.equal(rows(w).sessions.find(s=>s.address===address(B)).revoked_at,cookie==='B'?w.clock.now():null);
      if(cookie==='foreign-A'){
        assert.equal(rows(w).sessions.find(s=>s.address===address(A)).revoked_at,null);
        assert.equal(q.c.state.session?.address,address(A),'409 refuses B cleanup without revoking replacement A');
      }else assert.equal(q.c.state.session,null);
      assert.equal(prompts([p]),1);assert.equal(connects([p]),0);
      assert.equal(routeEvents(q,'/api/auth/challenge').length,1);assert.equal(routeEvents(q,'/api/auth/verify').length,1);
      assert.equal(q.channels.flatMap(c=>c.messages).filter(v=>v==='signed-in').length,0);
    }finally{verify.resolve();await flow?.catch(()=>{});q.stop();}
  });
}
