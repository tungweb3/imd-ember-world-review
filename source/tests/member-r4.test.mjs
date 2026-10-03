import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,START} from './wallet-harness.mjs';
import {MemberClient,PROFILE_WRITE_TIMEOUT_MS} from '../src/world/member.ts';
const DAY=86_400_000;
function session(address){
  const listeners=new Set(),s={state:{session:address?{address}:null},subscribe:f=>{listeners.add(f);return ()=>listeners.delete(f);},
    set(address){s.state={session:address?{address}:null};for(const f of listeners)f();}};return s;
}
function pageFetch(b,hold){return async(path,init={})=>{
  const headers=new Headers(init.headers);headers.set('origin',b.origin);if(b.jar.size)headers.set('cookie',b.cookie());
  const run=async()=>b.keep(await b.send(new Request(b.base+path,{method:init.method??'GET',headers,body:init.body,signal:init.signal})));
  return hold?hold(path,init,run):run();
};}
async function until(f,label){const end=Date.now()+10_000;while(Date.now()<end){if(f())return;await new Promise(r=>setTimeout(r,1));}assert.fail('timed out: '+label);}
const settle=()=>new Promise(r=>setTimeout(r,0));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function clockTimers(){
  let time=START;const jobs=new Set();return {now:()=>time,jobs,
    timers:{set:(f,ms)=>{const job={f,at:time+ms};jobs.add(job);return job;},clear:job=>jobs.delete(job)},
    tick(ms){time+=ms;for(const job of [...jobs])if(job.at<=time){jobs.delete(job);job.f();}}};
}
const truncated=r=>new Response(new ReadableStream({start(c){c.error(new TypeError('body stream was reset'));}}),{status:r.status,headers:r.headers});
async function fixture(hold,deps={}){
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);const auth=session(a.address);
  const c=new MemberClient(auth,{fetch:pageFetch(b,hold),wait:async()=>{},...deps});const stop=c.start();
  await until(()=>c.state.phase==='ready','member loaded');return {w,a,b,auth,c,stop};
}
async function rename(b,v,name,id){return pageFetch(b)('/api/me/profile',{method:'PUT',headers:{'content-type':'application/json'},
  body:JSON.stringify({displayName:name,expectedActorPublicId:v.member.publicMemberId,expectedProfileVersion:v.member.version,requestId:id})});}

test('M1-R2: pre-save GET(v0) cannot replace the saved v1 or its cooldown',async()=>{
  let holdRead=false,held=false;const g=gate();
  const f=await fixture(async(p,i,run)=>{const r=await run();if(holdRead&&!i.method){holdRead=false;held=true;await g.promise;}return r;});
  holdRead=true;const old=f.c.load();await until(()=>held,'old v0 GET held');
  assert.equal(await f.c.save('OrderCat'),true);assert.equal(f.c.state.view.member.version,1);g.resolve();await old;
  assert.deepEqual([f.c.state.view.member.version,f.c.state.view.member.displayName,f.c.state.cooling],[1,'OrderCat',true]);
  assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);f.stop();
});

test('M1-R2: GET2 returns before GET1, and latest GET may not roll back an already accepted version',async()=>{
  let holdRead=false,held=false,oldBody,replay=false;const g=gate();
  const f=await fixture(async(p,i,run)=>{if(replay&&!i.method)return Response.json(oldBody);
    const r=await run();if(holdRead&&!i.method){holdRead=false;held=true;oldBody=await r.clone().json();await g.promise;}return r;});
  holdRead=true;const first=f.c.load();await until(()=>held,'GET1 held');
  assert.equal((await rename(f.b,f.c.state.view,'NewReadCat','r-other-tab')).status,200);
  await f.c.load();assert.equal(f.c.state.view.member.version,1);g.resolve();await first;
  assert.equal(f.c.state.view.member.displayName,'NewReadCat');
  // A later read returned from an obsolete cache is latest by sequence, but still lower by profile version.
  replay=true;await f.c.load();
  assert.equal(f.c.state.view.member.version,1);assert.equal(f.c.state.view.member.displayName,'NewReadCat');f.stop();
});

test('M1-R2: late GET1 401/error cannot clear the profile accepted from GET2',async()=>{
  for(const failure of ['401','stream']){
    let holdRead=false,held=false;const g=gate();
    const f=await fixture(async(p,i,run)=>{const r=await run();if(holdRead&&!i.method){holdRead=false;held=true;await g.promise;
      return failure==='401'?Response.json({error:'AUTH_REQUIRED'},{status:401}):truncated(r);}return r;});
    holdRead=true;const first=f.c.load();await until(()=>held,'old read held');await f.c.load();
    g.resolve();await first;assert.equal(f.c.state.phase,'ready');assert.equal(f.c.state.view.loginWallet.address,f.a.address);f.stop();
  }
});

test('M1-R2: a newer GET(v2) remains after an earlier successful PUT(v1) body arrives',async()=>{
  let holdPut=true,held=false;const g=gate();
  const f=await fixture(async(p,i,run)=>{const r=await run();if(i.method==='PUT'&&holdPut){holdPut=false;held=true;await g.promise;}return r;});
  const save=f.c.save('FirstCat');await until(()=>held,'committed PUT held');
  f.w.clock.advance(7*DAY);await f.b.signIn(f.a);
  const v=await (await f.b.get('/api/me/profile')).json();assert.equal((await rename(f.b,v,'SecondCat','r-another-tab')).status,200);
  await f.c.load();assert.equal(f.c.state.view.member.version,2);g.resolve();assert.equal(await save,true);
  assert.deepEqual([f.c.state.view.member.version,f.c.state.view.member.displayName],[2,'SecondCat']);f.stop();
});

test('AUD4-07: committed PUT with a truncated or malformed body retries the exact original id once',async()=>{
  for(const failure of ['stream','json','shape']){
    let fail=true,ids=[],payloads=[],generated=0;
    const f=await fixture(async(p,i,run)=>{if(i.method==='PUT'){ids.push(JSON.parse(i.body).requestId);payloads.push(i.body);}
      const r=await run();if(i.method==='PUT'&&fail){fail=false;
        return failure==='stream'?truncated(r):new Response(failure==='json'?'{': '{}',{status:200});}return r;},
      {newId:()=>{generated++;return 'r-body-failure-'+failure;}});
    assert.equal(await f.c.save('RecoveredCat'),true);assert.equal(generated,1);assert.equal(ids.length,2);assert.equal(payloads[0],payloads[1]);
    assert.deepEqual([f.c.state.saving,f.c.state.pendingSave,f.c.state.view.member.version],[false,false,1]);
    assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);
    assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_requests').get().n,1);f.stop();
  }
});

test('AUD4-07: two lost bodies read back the committed profile, release saving, and block a new logical name',async()=>{
  let failBodies=2,generated=0;const ids=[];
  const f=await fixture(async(p,i,run)=>{if(i.method==='PUT')ids.push(JSON.parse(i.body).requestId);const r=await run();
    if(i.method==='PUT'&&failBodies-->0)return truncated(r);return r;},{newId:()=>{generated++;return 'r-uncertain-name';}});
  assert.equal(await f.c.save('SavedCat'),false);assert.equal(f.c.state.saving,false);assert.equal(f.c.state.pendingSave,true);
  await until(()=>f.c.state.view.member.version===1,'GET exposes committed v1');
  assert.equal(f.c.state.view.member.displayName,'SavedCat');assert.equal(await f.c.save('DifferentCat'),false);
  assert.equal(ids.length,2);assert.equal(generated,1,'an unknown result must not allocate another request id');
  assert.equal(await f.c.retrySave(),true);assert.equal(f.c.state.pendingSave,false);assert.equal(f.c.state.saving,false);
  assert.equal(ids.length,3);assert.equal(new Set(ids).size,1);
  assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);f.stop();
});

test('AUD4-07: retry blocked before idempotency lookup cannot declare an earlier PUT refused',async()=>{
  let puts=0;const ids=[];
  const f=await fixture(async(p,i,run)=>{if(i.method==='PUT'){ids.push(JSON.parse(i.body).requestId);puts++;
      if(puts===2)return Response.json({error:'NAME_RATE_LIMITED'},{status:429});}
    const r=await run();return i.method==='PUT'&&puts===1?truncated(r):r;});
  assert.equal(await f.c.save('AlreadySaved'),false);assert.equal(f.c.state.pendingSave,true);
  await until(()=>f.c.state.view.member.version===1,'readback');assert.equal(await f.c.save('BlindNewName'),false);
  assert.equal(await f.c.retrySave(),true);assert.equal(new Set(ids).size,1);
  assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);f.stop();
});

test('AUD4-07: attempts that never reached the server keep the same request id when connectivity returns',async()=>{
  let offline=true,generated=0;const ids=[];
  const f=await fixture(async(p,i,run)=>{if(i.method==='PUT'){ids.push(JSON.parse(i.body).requestId);if(offline)throw new TypeError('offline');}return run();},
    {newId:()=>{generated++;return 'r-offline-profile';}});
  assert.equal(await f.c.save('OfflineCat'),false);assert.equal(f.c.state.saving,false);assert.equal(f.c.state.pendingSave,true);
  assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,0);
  offline=false;assert.equal(await f.c.retrySave(),true);assert.equal(generated,1);assert.equal(new Set(ids).size,1);
  assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);f.stop();
});

test('AUD4-07: a never-ending success body has bounded waiting and readback does not issue a new PUT',async()=>{
  const clock=clockTimers();let puts=0;const ids=[],signals=[];
  const f=await fixture(async(p,i,run)=>{const r=await run();if(i.method==='PUT'){puts++;ids.push(JSON.parse(i.body).requestId);signals.push(i.signal);
      return new Response(new ReadableStream({start(){}}),{status:200});}return r;},{now:clock.now,timers:clock.timers});
  const saving=f.c.save('SlowBodyCat');await until(()=>puts===1,'first body pending');clock.tick(PROFILE_WRITE_TIMEOUT_MS);
  await until(()=>puts===2,'same-id retry');clock.tick(PROFILE_WRITE_TIMEOUT_MS);assert.equal(await saving,false);
  assert.equal(f.c.state.saving,false);assert.equal(f.c.state.pendingSave,true);assert.equal(new Set(ids).size,1);
  assert.ok(signals.every(s=>s.aborted));await until(()=>f.c.state.view.member.version===1,'readback of committed name');
  assert.equal(puts,2);assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);f.stop();
});

test('AUD4-07: retry-delay exceptions still release saving and preserve the original operation',async()=>{
  let fail=true;const f=await fixture(async(p,i,run)=>{if(i.method==='PUT'&&fail)throw new Error('network');return run();},
    {wait:async()=>{throw new Error('retry timer failed');}});
  assert.equal(await f.c.save('WaitingCat'),false);assert.equal(f.c.state.saving,false);assert.equal(f.c.state.pendingSave,true);
  fail=false;assert.equal(await f.c.retrySave(),true);f.stop();
});

test('AUD4-07/M1-R2: an old wallet save cannot clear a newer wallet saving state or restore its name',async()=>{
  const aGate=gate(),bGate=gate();let heldA=false,heldB=false,mode='A';
  const f=await fixture(async(p,i,run)=>{const r=await run();if(i.method==='PUT'){
    if(mode==='A'){heldA=true;await aGate.promise;}else{heldB=true;await bGate.promise;}}return r;});
  const saveA=f.c.save('WalletAlpha');await until(()=>heldA,'A save held');
  const b=newAccount();await f.b.signIn(b);f.auth.set(b.address);await until(()=>f.c.state.phase==='ready','B profile');
  mode='B';const saveB=f.c.save('WalletBeta');await until(()=>heldB,'B save held');aGate.resolve();assert.equal(await saveA,false);
  assert.equal(f.c.state.saving,true,'A finally must not release B');assert.equal(f.c.state.view.loginWallet.address,b.address);
  bGate.resolve();assert.equal(await saveB,true);assert.equal(f.c.state.view.member.displayName,'WalletBeta');f.stop();
});

test('AUD4-07: returning to the same wallet resumes its uncertain request rather than creating a new id',async()=>{
  let lose=true,generated=0;const ids=[];
  const f=await fixture(async(p,i,run)=>{if(i.method==='PUT')ids.push(JSON.parse(i.body).requestId);const r=await run();
    if(i.method==='PUT'&&lose)return truncated(r);return r;},{newId:()=>{generated++;return 'r-wallet-return';}});
  assert.equal(await f.c.save('ReturnCat'),false);f.auth.set(null);f.auth.set(f.a.address);
  await until(()=>f.c.state.phase==='ready','same wallet returned');assert.equal(f.c.state.pendingSave,true);
  lose=false;assert.equal(await f.c.retrySave(),true);assert.equal(generated,1);assert.equal(new Set(ids).size,1);f.stop();
});

test('AUD4-08: before, exactly at and after the server deadline, the store rerenders and GET refreshes cooldown',async()=>{
  const clock=clockTimers();let gets=0;const f=await fixture(async(p,i,run)=>{if(!i.method)gets++;return run();},{now:clock.now,timers:clock.timers});
  assert.equal(await f.c.save('TimerCat'),true);assert.equal(f.c.state.cooling,true);
  // Renew the browser session before its seven-day expiry: the cooldown has its own independent deadline.
  f.w.clock.advance(6*DAY);clock.tick(6*DAY);await f.b.signIn(f.a);
  let updates=0;const off=f.c.subscribe(()=>updates++),before=gets;
  f.w.clock.advance(DAY-1);clock.tick(DAY-1);assert.equal(f.c.state.cooling,true);assert.equal(gets,before);
  f.w.clock.advance(1);clock.tick(1);assert.equal(f.c.state.cooling,false);assert.ok(updates>0,'deadline emitted a store update');
  await until(()=>f.c.state.view.member.nextNameChangeAt===null,'fresh server cooldown');assert.equal(gets,before+1);
  assert.equal(await f.c.save('AfterTimer'),true);assert.equal(f.c.state.view.member.version,2);off();f.stop();
});

test('AUD4-08: moving the client clock beyond the deadline cannot bypass the server cooldown',async()=>{
  const clock=clockTimers();const f=await fixture(null,{now:clock.now,timers:clock.timers});assert.equal(await f.c.save('ClockCat'),true);
  clock.tick(7*DAY);assert.equal(f.c.state.cooling,false,'only the local hint reaches the deadline');
  assert.equal(await f.c.save('TooEarlyCat'),false);assert.equal(f.c.state.error.code,'NAME_CHANGE_COOLDOWN');
  await until(()=>f.c.state.cooling,'fresh serverTime recalibrates the deadline');
  assert.equal(f.c.state.view.member.version,1);assert.equal(f.w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);f.stop();
});

test('AUD4-08: teardown cancels the deadline and late reads, without another profile GET',async()=>{
  const clock=clockTimers();let gets=0;const f=await fixture(async(p,i,run)=>{if(!i.method)gets++;return run();},{now:clock.now,timers:clock.timers});
  assert.equal(await f.c.save('StopTimerCat'),true);assert.equal(clock.jobs.size,1);f.stop();assert.equal(clock.jobs.size,0);
  const before=gets;clock.tick(8*DAY);await settle();assert.equal(gets,before);
});

test('AUD4-02 client: bootstrap write-policy refusal is explicit and does not request another wallet signature',async()=>{
  const address='0x'+'c3'.repeat(20),seen=[];const c=new MemberClient(session(address),{fetch:async(p,i={})=>{
    seen.push((i.method??'GET')+' '+p);return i.method==='POST'?Response.json({error:'CONTRACT_WRITE_NOT_ENABLED'},{status:403}):Response.json({error:'MEMBER_NOT_FOUND'},{status:404});}});
  const stop=c.start();await until(()=>c.state.phase==='unavailable','policy refusal');
  assert.equal(c.state.error.code,'CONTRACT_WRITE_NOT_ENABLED');assert.equal(c.state.view,null);
  assert.deepEqual(seen,['GET /api/me/profile','POST /api/me/bootstrap']);assert.equal(c.state.saving,false);stop();
});
