import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,START} from './wallet-harness.mjs';
import {MemberClient} from '../src/world/member.ts';

const DAY=86_400_000,RETRY=60_000;
function session(address){
  const listeners=new Set(),auth={state:{session:address?{address}:null},
    subscribe:f=>{listeners.add(f);return ()=>listeners.delete(f);},
    set(address){auth.state={session:address?{address}:null};for(const f of listeners)f();}};
  return auth;
}
function clocks(){
  let wall=START,monotonic=1_000;const jobs=new Set();
  const fire=job=>{jobs.delete(job);job.f();};
  return {jobs,wallNow:()=>wall,monotonicNow:()=>monotonic,
    timers:{set:(f,ms)=>{const job={f,at:monotonic+ms,delay:ms};jobs.add(job);return job;},clear:job=>jobs.delete(job)},
    jumpWall(ms){wall+=ms;},
    advance(ms){wall+=ms;monotonic+=ms;},
    flush(){for(const job of [...jobs])if(job.at<=monotonic)fire(job);},
    tick(ms){this.advance(ms);this.flush();},
    fireEarly(){assert.equal(jobs.size,1);fire([...jobs][0]);}};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(fn,label){
  const end=performance.now()+5_000;
  while(performance.now()<end){if(fn())return;await settle();}
  assert.fail('timed out: '+label);
}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(hold,{defaultMonotonic=false}={}){
  const w=setup(),a=newAccount(),b=w.browser(),clock=clocks(),seen=[];
  await b.signIn(a);const auth=session(a.address);
  const fetch=async(path,init={})=>{
    seen.push({path,method:init.method??'GET'});
    const headers=new Headers(init.headers);headers.set('origin',b.origin);if(b.jar.size)headers.set('cookie',b.cookie());
    const run=async()=>b.keep(await b.send(new Request(b.base+path,{method:init.method??'GET',headers,body:init.body,signal:init.signal})));
    return hold?hold(path,init,run):run();
  };
  const c=new MemberClient(auth,{fetch,wait:async()=>{},now:clock.wallNow,
    ...defaultMonotonic?{}:{monotonicNow:clock.monotonicNow},timers:clock.timers});
  const stop=c.start();await until(()=>c.state.phase==='ready','profile loaded');
  assert.equal(await c.save('MonotonicCat'),true);
  assert.equal(c.state.cooling,true);assert.equal(clock.jobs.size,1);
  const gets=()=>seen.filter(x=>x.method==='GET'&&x.path==='/api/me/profile').length;
  // Keep the real Worker session live through the seven-day rename deadline.
  const expireOnServer=async()=>{w.clock.advance(6*DAY);await b.signIn(a);w.clock.advance(DAY);};
  return {w,a,b,auth,c,clock,seen,gets,stop,expireOnServer};
}

test('R5-08 LOW-4: backward wall clock cannot extend the real server cooldown',async()=>{
  const f=await fixture();try{
    f.clock.jumpWall(-3*DAY);await f.expireOnServer();const before=f.gets();
    f.clock.tick(7*DAY-1);assert.equal(f.c.state.cooling,true);assert.equal(f.gets(),before);
    f.clock.tick(1);assert.equal(f.gets(),before+1,'monotonic deadline must read back even after wall-clock rollback');
    await until(()=>f.c.state.view.member.nextNameChangeAt===null,'server confirms expiry');
    assert.equal(f.c.state.cooling,false);assert.equal(f.clock.jobs.size,0);
    assert.equal(await f.c.save('AfterBackwardClock'),true);
    assert.equal(f.c.state.view.member.version,2);
  }finally{f.stop();}
});

test('R5-08 LOW-4: forward wall jump and an early timer cannot unlock or refresh before elapsed deadline',async()=>{
  const f=await fixture();try{
    const before=f.gets();f.clock.jumpWall(30*DAY);f.clock.advance(DAY);f.clock.fireEarly();
    assert.equal(f.c.state.cooling,true);assert.equal(f.gets(),before,'early timer is rearmed without a profile request');
    assert.equal(f.clock.jobs.size,1);assert.equal([...f.clock.jobs][0].delay,6*DAY);
    assert.equal(await f.c.save('PrematureClockCat'),false);
    assert.equal(f.c.state.error.code,'NAME_CHANGE_COOLDOWN');
    assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);
  }finally{f.stop();}
});

test('R5-09 LOW-4: normal deadline refresh keeps cooling until the server response is consumed',async()=>{
  let holdRead=false,held=false;const g=gate();
  const f=await fixture(async(p,i,run)=>{const r=await run();if(holdRead&&!i.method){holdRead=false;held=true;await g.promise;}return r;});
  try{
    await f.expireOnServer();const before=f.gets();let updates=0;const off=f.c.subscribe(()=>updates++);
    holdRead=true;f.clock.tick(7*DAY);assert.equal(f.gets(),before+1);
    await until(()=>held,'deadline response held');assert.equal(f.c.state.cooling,true,'an estimate is not server confirmation');
    g.resolve();await until(()=>!f.c.state.cooling,'server confirmation unlocks');
    assert.equal(f.c.state.view.member.nextNameChangeAt,null);assert.equal(f.clock.jobs.size,0);assert.ok(updates>0);off();
  }finally{g.resolve();f.stop();}
});

test('R5-09 LOW-4: failed expiry read stays cooling and retries at stable positive backoff',async()=>{
  for(const failure of ['503','429','network','body']){
    let fail=false;
    const f=await fixture(async(p,i,run)=>{
      if(fail&&!i.method){
        if(failure==='network')throw new TypeError('offline');
        if(failure==='body')return new Response('{',{status:200});
        return Response.json({error:'PROFILE_UNAVAILABLE'},{status:Number(failure)});
      }
      return run();
    });
    try{
      await f.expireOnServer();const before=f.gets();fail=true;f.clock.tick(7*DAY);
      await until(()=>f.clock.jobs.size===1,'retry armed after '+failure);
      assert.equal(f.c.state.cooling,true);assert.equal(f.gets(),before+1);
      assert.equal([...f.clock.jobs][0].delay,RETRY,'no immediate/zero-duration retry');
      f.clock.flush();await settle();assert.equal(f.gets(),before+1);
      f.clock.tick(RETRY-1);assert.equal(f.gets(),before+1);
      fail=false;f.clock.tick(1);await until(()=>!f.c.state.cooling,'recovered '+failure);
      assert.equal(f.gets(),before+2);assert.equal(f.clock.jobs.size,0);
    }finally{f.stop();}
  }
});

test('R5-09 LOW-4: a late background timer reconciles once without replaying elapsed intervals',async()=>{
  const f=await fixture();try{
    await f.expireOnServer();f.w.clock.advance(2*DAY);await f.b.signIn(f.a);
    const before=f.gets();f.clock.jumpWall(-20*DAY);f.clock.advance(9*DAY);
    assert.equal(f.gets(),before,'throttled timer has not executed');f.clock.flush();
    assert.equal(f.gets(),before+1);await until(()=>!f.c.state.cooling,'late timer server confirmation');
    f.clock.flush();await settle();assert.equal(f.gets(),before+1);assert.equal(f.clock.jobs.size,0);
  }finally{f.stop();}
});

test('R5-09 LOW-4: a server still cooling reanchors a full future deadline',async()=>{
  const f=await fixture();try{
    const before=f.gets();f.clock.tick(7*DAY);
    assert.equal(f.c.state.cooling,true,'the local elapsed estimate cannot unlock while GET is pending');
    await until(()=>f.clock.jobs.size===1,'fresh server deadline armed');
    assert.equal(f.gets(),before+1);assert.equal([...f.clock.jobs][0].delay,7*DAY);
    assert.equal(f.c.state.view.member.nextNameChangeAt,START+7*DAY);assert.equal(f.c.state.cooling,true);
    await f.expireOnServer();f.clock.tick(7*DAY);await until(()=>!f.c.state.cooling,'server eventually expires');
    assert.equal(f.gets(),before+2);
  }finally{f.stop();}
});

test('R5-09 LOW-4: teardown cancels timer and an already queued callback cannot fetch',async()=>{
  const f=await fixture(),queued=[...f.clock.jobs][0];f.stop();
  const before=f.gets();assert.equal(f.clock.jobs.size,0);f.clock.tick(8*DAY);queued.f();await settle();
  assert.equal(f.gets(),before);assert.equal(f.clock.jobs.size,0);
});

test('R5-09 LOW-4: switching accounts before the deadline cancels the scheduled callback',async()=>{
  const f=await fixture();try{
    const queued=[...f.clock.jobs][0],b=newAccount();await f.b.signIn(b);f.auth.set(b.address);
    await until(()=>f.c.state.phase==='ready','B profile loaded');const before=f.gets();
    assert.equal(f.clock.jobs.size,0);queued.f();f.clock.tick(8*DAY);await settle();
    assert.equal(f.gets(),before);assert.equal(f.c.state.view.loginWallet.address,b.address);
    assert.equal(f.c.state.cooling,false);assert.equal(f.clock.jobs.size,0);
  }finally{f.stop();}
});

test('R5-09 LOW-4: account switch cancels old timer and drops the held expiry response',async()=>{
  let holdRead=false,held=false;const g=gate();
  const f=await fixture(async(p,i,run)=>{const r=await run();if(holdRead&&!i.method){holdRead=false;held=true;await g.promise;}return r;});
  try{
    await f.expireOnServer();holdRead=true;f.clock.tick(7*DAY);await until(()=>held,'A expiry response held');
    const b=newAccount();await f.b.signIn(b);f.auth.set(b.address);await until(()=>f.c.state.phase==='ready','B profile loaded');
    assert.equal(f.c.state.view.loginWallet.address,b.address);assert.equal(f.c.state.cooling,false);
    g.resolve();await settle();await settle();assert.equal(f.c.state.view.loginWallet.address,b.address);
    assert.equal(f.c.state.view.member.profileState,'needs_name');assert.equal(f.clock.jobs.size,0);
  }finally{g.resolve();f.stop();}
});

test('R5-09 LOW-4: refreshing the profile cancels an already queued older timer in the same account',async()=>{
  const f=await fixture();try{
    const queued=[...f.clock.jobs][0];await f.c.load();const before=f.gets(),fresh=[...f.clock.jobs][0];
    assert.notEqual(fresh,queued);queued.f();await settle();
    assert.equal(f.gets(),before);assert.equal(f.clock.jobs.size,1);assert.ok(f.clock.jobs.has(fresh));
  }finally{f.stop();}
});

test('R5-08 LOW-4: the default elapsed source ignores both Date.now and the legacy now injection',async()=>{
  const f=await fixture(undefined,{defaultMonotonic:true}),originalNow=Date.now;
  try{
    const before=f.gets();f.clock.jumpWall(30*DAY);Date.now=f.clock.wallNow;f.clock.fireEarly();
    assert.equal(f.gets(),before);assert.equal(f.c.state.cooling,true);assert.equal(f.clock.jobs.size,1);
    assert.ok([...f.clock.jobs][0].delay>6*DAY,'native monotonic clock did not jump thirty days');
    f.clock.jumpWall(-60*DAY);f.clock.fireEarly();assert.equal(f.gets(),before);assert.equal(f.c.state.cooling,true);
    assert.ok([...f.clock.jobs][0].delay>6*DAY);
  }finally{Date.now=originalNow;f.stop();}
});
