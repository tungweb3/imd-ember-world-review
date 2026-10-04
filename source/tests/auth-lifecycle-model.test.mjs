import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthLifecycle} from '../src/world/authLifecycle.ts';
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),session={address:A,expiresAt:2000};
function flow(){
  const m=new AuthLifecycle(),provider={};m.start();m.know({kind:'ABSENT'});
  const click=m.begin(provider,A,1,1);
  m.transition(click,'CHALLENGE_REQUESTED');m.challenge(click,'model-nonce');m.transition(click,'SIGNATURE_PROMPTING');
  const owner=m.verify(click,10);return {m,click,owner,provider};
}
test('model: verify requires checked live intent and cannot reuse a cancelled click or another flow owner',()=>{
  const {m,click,owner}=flow();m.cancel();
  assert.throws(()=>m.verify(click,12));assert.equal(m.accept(click,owner,session),false);
  const second=m.begin({},B,2,1);m.challenge(second,'second-nonce');
  assert.throws(()=>m.verify(second,12));assert.equal(m.accept(second,owner,{address:B,expiresAt:3000}),false);
  assert.equal(owner.status,'RETAINED');
});
test('model: initial provider discovery may pin once; provider and account substitutions never transfer a click',()=>{
  const m=new AuthLifecycle(),p={},q={};m.start();const c=m.begin(p,null,3,5);
  m.discovered(q,B);assert.equal(c.account,null);m.discovered(p,A);m.discovered(p,B);assert.equal(c.account,A);
  assert.equal(m.current(c,p,A,3,5),true);assert.equal(m.current(c,q,A,3,5),false);assert.equal(m.current(c,p,B,3,5),false);
  m.cancel();assert.equal(m.current(c,p,A,3,5),false);assert.equal(m.busy,false);
});
test('model: invalid transition and UNKNOWN knowledge cannot authorize a signature prompt or verify',()=>{
  const m=new AuthLifecycle();const c=m.begin({},A,1,1);
  assert.equal(m.transition(c,'SIGNATURE_PROMPTING'),false);
  m.transition(c,'CHALLENGE_REQUESTED');m.challenge(c,'checked-nonce');
  assert.equal(m.transition(c,'SIGNATURE_PROMPTING'),false);assert.throws(()=>m.verify(c,10));
  assert.equal(m.snapshot.retainedCount,0);m.know({kind:'ABSENT'});
  assert.equal(m.transition(c,'SIGNATURE_PROMPTING'),true);
});
for(const kind of ['ABSENT','PRESENT'])for(const readSeq of [10,11,12,13])test(`model causal reads: ${kind} read ${readSeq} versus observed fence 12`,()=>{
  const {m,owner}=flow();m.observe(owner,12);
  const result=m.read(kind==='PRESENT'?{kind,session}:{kind},readSeq,1,1);
  assert.equal(result,readSeq>12);assert.equal(owner.status,readSeq>12?'RELEASED':'RETAINED');
  assert.equal(m.knowledge.kind,readSeq>12?kind:'UNKNOWN');
});
test('model: UNKNOWN read after response retains responsibility and cannot become ABSENT',()=>{
  const {m,owner}=flow();m.observe(owner,12);m.read({kind:'UNKNOWN'},13,1,1);
  assert.equal(m.knowledge.kind,'UNKNOWN');assert.equal(m.snapshot.retainedCount,1);assert.equal(owner.status,'RETAINED');
});
test('model: refusal of cleanup dispatched before response, but delivered after it, drains exactly one later attempt',()=>{
  const {m,owner}=flow();m.cancel(true);assert.equal(m.abandon(owner),true);
  assert.equal(m.claimCleanup(owner),true);assert.equal(m.claimCleanup(owner),false);
  m.observe(owner,12);assert.equal(m.cleanupDone(owner,false),true);assert.equal(owner.status,'RETAINED');
  assert.equal(m.claimCleanup(owner),true);assert.equal(m.claimCleanup(owner),false);
  assert.equal(m.cleanupDone(owner,false),false);assert.equal(owner.status,'CONSUMED');assert.equal(m.claimCleanup(owner),false);
});
test('model: early successful pending cancellation consumes once; late response/body/stop never resurrect it',()=>{
  const {m,click,owner}=flow();m.abandon(owner);m.claimCleanup(owner);m.cleanupDone(owner,true);
  m.observe(owner,12);assert.equal(m.accept(click,owner,session),false);m.cancel(true);
  assert.equal(m.abandon(owner),false);assert.equal(m.snapshot.retainedCount,0);
});
test('model: valid verify acceptance is terminal before any house callback or stop/restart',()=>{
  const {m,click,owner}=flow();m.observe(owner,12);assert.equal(m.accept(click,owner,session),true);
  m.cancel(true);assert.equal(m.snapshot.state,'STOPPED');assert.equal(m.knowledge.kind,'PRESENT');
  m.start();assert.equal(m.abandon(owner),false);assert.equal(m.claimCleanup(owner),false);assert.equal(m.snapshot.retainedCount,0);
});
// Deterministic adversarial scheduler: independent event order, duplicated late callbacks and stop/restart.
// Assertion is monotonic terminality and one in-flight request, not an expected implementation trace.
for(let seed=1;seed<=64;seed++)test(`model property scheduler seed ${seed}: release is terminal, UNKNOWN cannot release, cleanup is single owner`,()=>{
  const {m,click,owner}=flow();let rng=seed,readSeq=10,inFlight=0,terminal=null;
  const next=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng%9;};
  for(let event=0;event<80;event++){
    switch(next()){
      case 0:m.observe(owner,readSeq);break;
      case 1:m.read({kind:'UNKNOWN'},++readSeq,1,1);break;
      case 2:m.read({kind:'PRESENT',session},++readSeq,1,1);break;
      case 3:m.read({kind:'ABSENT'},++readSeq,1,1);break;
      case 4:m.cancel(true);m.abandon(owner);break;
      case 5:if(m.claimCleanup(owner))inFlight++;break;
      case 6:if(owner.inFlight){m.cleanupDone(owner,false);inFlight--;}break;
      case 7:m.accept(click,owner,session);break;
      case 8:m.start();break;
    }
    assert.ok(inFlight<=1&&inFlight>=0);assert.equal(owner.inFlight,inFlight===1);
    if(terminal)assert.equal(owner.status,terminal,'no later callback revives authority');
    if(owner.status!=='RETAINED')terminal=owner.status;
    assert.equal(m.snapshot.retainedCount,owner.status==='RETAINED'?1:0);
  }
});
