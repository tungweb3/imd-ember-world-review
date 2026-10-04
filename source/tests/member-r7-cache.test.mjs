import test from 'node:test';
import assert from 'node:assert/strict';
import {publicName,lookupName,NAME_LOOKUP_DELAY_MS} from '../src/world/member.ts';

// Cache-only tests inject wall times and timers; no auth session, wallet prompt, save, or cooldown is exercised.
let index=0;
const address=()=> '0x'+(++index).toString(16).padStart(40,'0');
const settle=()=>new Promise(r=>setTimeout(r,0));
function metrics(t,calls,before,extra={}){
  t.diagnostic(JSON.stringify({schema:'imd.r7.public-name-cache-counts/v1',case:t.name,
    requestsBefore:before,requestsAfter:calls.length,prompts:0,created:0,live:0,revoked:0,pending:0,used:0,invalidated:0,
    cookies:{session:false,flow:false},client:{sessionKnown:'N/A',session:'N/A',phase:'N/A',cleanupResponsibility:'N/A'},...extra}));
}
function fixture(){
  const a=address(),calls=[];
  const get=async p=>{calls.push(p);return Response.json({name:'Name'+calls.length});};
  return {a,calls,get};
}
function timers(){const jobs=new Set();return {jobs,set(f,delay){const job={f,delay};jobs.add(job);return job;},clear(job){jobs.delete(job);},fire(){for(const job of [...jobs]){jobs.delete(job);job.f();}}};}

test('R7 cache: one millisecond backward age expires the public name',async t=>{
  const f=fixture();assert.equal(await publicName(f.a,100_000,f.get),'Name1');const before=f.calls.length;
  const result=await publicName(f.a,99_999,f.get);metrics(t,f.calls,before,{clockDeltaMs:-1});
  assert.equal(result,'Name2');assert.equal(f.calls.length,2);
});

test('R7 cache: repeated backward jumps cannot pin the first name',async t=>{
  const f=fixture();await publicName(f.a,200_000,f.get);const before=f.calls.length;
  const got=[];for(const at of [150_000,100_000,50_000])got.push(await publicName(f.a,at,f.get));
  metrics(t,f.calls,before,{clockDeltaMs:-150_000});assert.deepEqual(got,['Name2','Name3','Name4']);assert.equal(f.calls.length,4);
});

test('R7 cache: zero and positive age retain the existing exact TTL boundary',async t=>{
  const f=fixture();const first=publicName(f.a,100_000,f.get);await first;const before=f.calls.length;
  assert.equal(publicName(f.a,100_000,f.get),first);assert.equal(publicName(f.a.toUpperCase().replace('0X','0x'),159_999,f.get),first);
  assert.equal(await publicName(f.a,160_000,f.get),'Name2');metrics(t,f.calls,before,{ttlMs:60_000});assert.equal(f.calls.length,2);
});

test('R7 cache: backward expiry also replaces a still-pending cache request',async t=>{
  const a=address(),calls=[];let resolve;
  const held=new Promise(r=>resolve=r),get=async p=>{calls.push(p);return calls.length===1?held:Response.json({name:'Fresh'});};
  const first=publicName(a,100_000,get),before=calls.length,second=publicName(a,90_000,get);
  metrics(t,calls,before,{firstResponseHeld:true});
  // Resolve before asserting so a baseline failure leaves no unresolved test work.
  resolve(Response.json({name:'Old'}));assert.notEqual(second,first);assert.equal(await second,'Fresh');assert.equal(await first,'Old');
  assert.equal(await publicName(a,90_001,get),'Fresh');assert.equal(calls.length,2);
});

test('R7 cache: backward lookup is delayed and then refreshes the public name',async t=>{
  const f=fixture(),clock=timers(),got=[];await publicName(f.a,100_000,f.get);const before=f.calls.length;
  const cancel=lookupName(f.a,n=>got.push(n),{timers:clock,now:()=>99_999,get:f.get});
  await settle();metrics(t,f.calls,before,{stage:'beforeDelay',pendingTimers:clock.jobs.size,callbacks:got.length});
  assert.equal(f.calls.length,before);assert.equal(got.length,0);assert.equal(clock.jobs.size,1);
  assert.equal([...clock.jobs][0].delay,NAME_LOOKUP_DELAY_MS);clock.fire();await settle();
  metrics(t,f.calls,before,{stage:'afterDelay',pendingTimers:clock.jobs.size,callbacks:got.length});
  assert.equal(f.calls.length,before+1);assert.deepEqual(got,['Name2']);cancel();
});

test('R7 cache: closing a backward-expired lookup before its delay sends no request',async t=>{
  const f=fixture(),clock=timers(),got=[];await publicName(f.a,100_000,f.get);const before=f.calls.length;
  const cancel=lookupName(f.a,n=>got.push(n),{timers:clock,now:()=>50_000,get:f.get});cancel();clock.fire();await settle();
  metrics(t,f.calls,before,{cancelled:true,pendingTimers:clock.jobs.size,callbacks:got.length});
  assert.equal(f.calls.length,before);assert.equal(got.length,0);assert.equal(clock.jobs.size,0);
});

test('R7 cache: a fresh lookup remains immediate without a timer or extra read',async t=>{
  const f=fixture(),clock=timers(),got=[];await publicName(f.a,100_000,f.get);const before=f.calls.length;
  const cancel=lookupName(f.a,n=>got.push(n),{timers:clock,now:()=>100_001,get:f.get});await settle();
  metrics(t,f.calls,before,{pendingTimers:clock.jobs.size,callbacks:got.length});
  assert.deepEqual(got,['Name1']);assert.equal(f.calls.length,before);assert.equal(clock.jobs.size,0);cancel();
});

test('R7 cache: backward-expired refresh failure returns no name instead of indefinitely retaining the old name',async t=>{
  const f=fixture();await publicName(f.a,100_000,f.get);const before=f.calls.length;
  const result=await publicName(f.a,10_000,async p=>{f.calls.push(p);return new Response(null,{status:503});});
  metrics(t,f.calls,before,{refreshStatus:503});assert.equal(result,null);assert.equal(f.calls.length,2);
});
