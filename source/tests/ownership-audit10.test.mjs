import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain} from './wallet-harness.mjs';
import {MULTICALL3,ALCHEMY_NFTS_URL,ONLINE_WINDOW_MS,CANDIDATE_CAP} from '../server/ownership.ts';
import {INDEX_LANE_READY,INDEX_PROBE_BACKOFF_MS} from '../server/auth.ts';

// Exact Audit10/Report10 temporal regressions. The real Worker, viem and migration-backed SQLite run offline.
// This evaluator is copied byte-for-byte onto the untouched candidate baseline before any product change.
const authRows=w=>({sessions:w.db.raw.prepare('SELECT nonce,address,expires_at,revoked_at FROM sessions ORDER BY rowid').all(),
  challenges:w.db.raw.prepare('SELECT nonce,used_at,invalidated_at FROM login_challenges ORDER BY rowid').all()});
const presenceRows=w=>w.db.raw.prepare('SELECT token_id,owner,last_online_at,updated_at FROM seat_presence ORDER BY token_id').all();
const reservations=w=>({lanes:w.db.raw.prepare('SELECT net,sub,at FROM index_lanes ORDER BY rowid').all(),
  probes:w.db.raw.prepare('SELECT scope_key,net,sub,probed_at,expires_at FROM index_lane_probes ORDER BY scope_key').all()});
const indexRows=w=>w.db.raw.prepare('SELECT address,ids,read_at FROM index_candidates ORDER BY address').all();
async function fixture({count=1,age=ONLINE_WINDOW_MS-1,budget=true,characters=false,online=false,signIn=true}={}){
  const account=newAccount(),address=account.address.toLowerCase(),owners=[],seats={},onchain={};
  for(let id=1;id<=count;id++){owners[id]=address;seats[id]=String(id+700);onchain[id]=address;}
  const contract='0x'+'5e'.repeat(20),chain=fakeChain({owners:onchain});
  if(characters)chain.state.characters[address]=[{contract,tokenId:'17'}];
  let onCharacter=()=>{};const chainFetch=chain.fetcher;
  chain.fetcher=async(input,init)=>{const r=await chainFetch(input,init);
    if(String(input).startsWith(ALCHEMY_NFTS_URL+'?')&&new URL(String(input)).searchParams.get('withMetadata')==='true')onCharacter();
    return r;};
  const w=setup({chain,imd:fakeImd({seats,owners,online:online?[1]:[]}),
    collections:characters?[{id:'fixture',name:{zh:'測試',en:'Fixture'},chainId:1,contract}]:[]}),browser=w.browser(),keys=[];
  let onLane=()=>{};
  w.env.CHAIN_LIMITER={limit:async({key})=>{keys.push(key);if(key==='chain:index:lane')onLane();return {success:key==='chain:index'?budget:true};}};
  if(signIn)assert.equal((await browser.signIn(account)).verify.status,200);
  const at=w.clock.now(),insert=w.db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(?,?,?,?)');
  for(let id=1;id<=count;id++){const seen=id===257?at-1000:at-age;insert.run(id,address,seen,seen);}
  const beforeAuth=authRows(w),beforePresence=presenceRows(w),prepare=w.db.prepare.bind(w.db);
  let reads=0,onSighting=()=>{},onPreflight=()=>{},onProbe=()=>{};
  w.db.prepare=sql=>{const wrap=s=>({...s,bind:(...args)=>wrap(s.bind(...args)),
    first:async()=>{const r=await s.first();if(sql===INDEX_LANE_READY)onPreflight();return r;},
    all:async()=>{const r=await s.all();if(sql.startsWith('SELECT token_id,last_online_at'))onSighting(++reads);return r;}});return wrap(prepare(sql));};
  const batch=w.db.batch.bind(w.db);
  w.db.batch=async statements=>{const r=await batch(statements);if(statements.some(s=>s.sql.startsWith('INSERT INTO index_lane_probes')))onProbe();return r;};
  return {w,browser,chain,address,at,keys,get reads(){return reads;},
    afterSighting:fn=>{onSighting=fn;},afterPreflight:fn=>{onPreflight=fn;},afterProbe:fn=>{onProbe=fn;},afterLane:fn=>{onLane=fn;},
    afterCharacter:fn=>{onCharacter=fn;},
    work:()=>({index:chain.state.calls.filter(c=>!c.body).length,
      rpc:chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length,
      otherRpc:chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method!=='eth_call').length,
      budget:keys.filter(k=>k==='chain:index').length,lane:keys.filter(k=>k==='chain:index:lane').length,
      assets:keys.filter(k=>k==='chain:assets').length}),
    finish:async()=>{await Promise.all(w.kept);assert.deepEqual(authRows(w),beforeAuth);assert.deepEqual(presenceRows(w),beforePresence,
      'evaluation must not renew the producer sighting');w.db.raw.close();}};
}
const read=async(f,path='/api/me/home')=>{const r=await f.browser.get(path),body=await r.json();await Promise.all(f.w.kept);return {status:r.status,body};};
const invalidAt=(change,t)=>change==='rollback'?t-1:change==='NaN'?NaN:change==='Infinity'?Infinity:-Infinity;

for(const change of ['Infinity','NaN','-Infinity','rollback'])
test(`Report10 N1: ${change} after sightings persists no lane/probe and recovers at +10m/+60m`,async t=>{
  const f=await fixture({budget:false});try{
    f.afterSighting(n=>{if(n===1)f.w.clock.set(invalidAt(change,f.at));});
    const first=await read(f),stored=reservations(f.w),firstWork=f.work();
    f.w.clock.set(f.at+600_000);const later10m=await read(f);
    f.w.clock.set(f.at+3_600_000);const later60m=await read(f);
    t.diagnostic(JSON.stringify({change,first,stored,firstWork,later10m,later60m,work:f.work(),reservations:reservations(f.w)}));
    assert.equal(first.status,503);assert.deepEqual(first.body,{error:'OWNERSHIP_UNAVAILABLE'});
    assert.deepEqual(stored,{lanes:[],probes:[]},'invalid evaluation time must never become a persistent reservation');
    assert.deepEqual(firstWork,{index:0,rpc:1,otherRpc:0,budget:1,lane:0,assets:0});
    for(const later of [later10m,later60m]){assert.equal(later.status,200);assert.equal(later.body.recheck,undefined);
      assert.equal(later.body.eligible,0);assert.equal(later.body.seats[0].reason,'offline-24h');}
    assert.deepEqual(f.work(),{index:2,rpc:3,otherRpc:0,budget:3,lane:2,assets:0});
    for(const r of reservations(f.w).lanes)assert.equal(Number.isFinite(r.at),true);
    for(const r of reservations(f.w).probes){assert.equal(Number.isFinite(r.probed_at),true);assert.equal(r.expires_at-r.probed_at,INDEX_PROBE_BACKOFF_MS);}
    assert.equal(later10m.body.checkedAt,f.at+600_000);assert.equal(later60m.body.checkedAt,f.at+3_600_000);
  }finally{await f.finish();}
});

for(const phase of ['preflight','probe','limiter'])for(const change of ['Infinity','NaN','-Infinity','rollback'])
test(`Report10 N1 adjacent: ${change} after lane ${phase} cannot enter persistence or poison recovery`,async t=>{
  const f=await fixture({budget:false,age:ONLINE_WINDOW_MS+1});try{
    let once=true;const changeClock=()=>{if(once){once=false;f.w.clock.set(invalidAt(change,f.at));}};
    if(phase==='preflight')f.afterPreflight(changeClock);else if(phase==='probe')f.afterProbe(changeClock);else f.afterLane(changeClock);
    const first=await read(f),stored=reservations(f.w),firstWork=f.work();
    f.w.clock.set(f.at+600_000);const later10m=await read(f);f.w.clock.set(f.at+3_600_000);const later60m=await read(f);
    t.diagnostic(JSON.stringify({phase,change,first,stored,firstWork,later10m,later60m,work:f.work()}));
    assert.equal(first.status,503);assert.deepEqual(first.body,{error:'OWNERSHIP_UNAVAILABLE'});
    assert.deepEqual(stored.lanes,[],'no invalid admitted-lane timestamp');
    assert.equal(stored.probes.length,phase==='preflight'?0:1,
      'an already finite probe keeps its fixed conservative backoff; an invalid pre-reservation sample writes nothing');
    for(const p of stored.probes){assert.equal(p.probed_at,f.at);assert.equal(p.expires_at,f.at+INDEX_PROBE_BACKOFF_MS);}
    assert.equal(firstWork.index,0);assert.equal(firstWork.rpc,1);assert.equal(firstWork.budget,1);
    assert.equal(firstWork.lane,phase==='limiter'?1:0,'invalid time does not amplify local limiter work');
    for(const later of [later10m,later60m]){assert.equal(later.status,200);assert.equal(later.body.recheck,undefined);}
    assert.equal(f.work().index,2);assert.equal(f.work().rpc,3);assert.equal(f.work().budget,3);
    assert.equal(f.work().lane,phase==='limiter'?3:2);
  }finally{await f.finish();}
});

test('Report10 N1 finite control: expired seat admits one bounded lane and later finite requests recover',async()=>{
  const f=await fixture({budget:false});try{
    f.afterSighting(n=>{if(n===1)f.w.clock.advance(2);});const first=await read(f),stored=reservations(f.w);
    assert.equal(first.status,200);assert.equal(first.body.recheck,undefined);assert.equal(first.body.checkedAt,f.at);
    assert.equal(stored.lanes.length,1);assert.equal(stored.lanes[0].at,f.at+2);assert.equal(stored.probes[0].probed_at,f.at+2);
    f.w.clock.set(f.at+600_000);assert.equal((await read(f)).body.recheck,undefined);
    f.w.clock.set(f.at+3_600_000);assert.equal((await read(f)).body.recheck,undefined);
    assert.deepEqual(f.work(),{index:3,rpc:3,otherRpc:0,budget:3,lane:3,assets:0});
  }finally{await f.finish();}
});

for(const delay of [0,1,2,5000])
test(`Audit10 I1: 257-seat cap ranks after ${delay}ms D1 wait without renewing index producer time`,async t=>{
  const f=await fixture({count:257,age:ONLINE_WINDOW_MS});try{
    f.afterSighting(n=>{if(n===1)f.w.clock.advance(delay);});const first=await read(f),index=indexRows(f.w);
    t.diagnostic(JSON.stringify({delay,first,index,work:f.work(),reads:f.reads}));
    assert.equal(first.status,200);assert.equal(first.body.seats.length,CANDIDATE_CAP);assert.equal(first.body.recheck,'partial');
    assert.equal(first.body.seats.some(s=>s.tokenId==='257'),delay>0,'the only unexpired offline seat must survive the cap');
    assert.equal(first.body.eligible,delay?1:CANDIDATE_CAP);assert.equal(first.body.size,delay?'s':'xl');
    assert.equal(first.body.checkedAt,f.at+delay);assert.equal(index.length,1);assert.equal(index[0].read_at,f.at);
    assert.equal(JSON.parse(index[0].ids).includes('257'),delay>0,'kept index and proof cuts follow the same live ranking');
    assert.equal(JSON.parse(index[0].ids).length,CANDIDATE_CAP);assert.equal(f.reads,2);
    assert.deepEqual(f.work(),{index:1,rpc:2,otherRpc:0,budget:1,lane:0,assets:0});
  }finally{await f.finish();}
});

for(const delay of [0,1,2,5000])for(const phase of ['sightings','characters'])
test(`Audit10 I2: public assets ${phase} wait ${delay}ms uses final display clock and keeps producer dates`,async t=>{
  const f=await fixture({signIn:false,characters:phase==='characters'});try{
    if(phase==='sightings')f.afterSighting(n=>{if(n===1)f.w.clock.advance(delay);});
    else f.afterCharacter(()=>f.w.clock.advance(delay));
    const path='/api/wallet/'+f.address+'/assets',first=await read(f,path),next=await read(f,path),expected=delay<=1;
    t.diagnostic(JSON.stringify({phase,delay,first,next,work:f.work(),presence:presenceRows(f.w)}));
    assert.equal(first.status,200);assert.equal(next.status,200);assert.equal(first.body.seats[0].counts,expected);
    assert.equal(next.body.seats[0].counts,expected);assert.equal(first.body.fetchedAt,f.at);assert.equal(first.body.seats[0].lastOnlineAt,f.at-ONLINE_WINDOW_MS+1);
    assert.equal(first.body.characters.state,'ok');assert.equal(first.body.characters.items.length,phase==='characters'?1:0);
    assert.deepEqual(f.work(),{index:phase==='characters'?1:0,rpc:0,otherRpc:0,budget:0,lane:0,assets:phase==='characters'?1:0});
    assert.deepEqual(reservations(f.w),{lanes:[],probes:[]});assert.deepEqual(indexRows(f.w),[]);assert.equal(f.reads,2);
  }finally{await f.finish();}
});

for(const age of [ONLINE_WINDOW_MS-1,ONLINE_WINDOW_MS,ONLINE_WINDOW_MS+1])
test(`Audit10 I2 control: undelayed public assets preserve inclusive 24h age ${age}`,async()=>{
  const f=await fixture({signIn:false,age});try{const r=await read(f,'/api/wallet/'+f.address+'/assets');
    assert.equal(r.status,200);assert.equal(r.body.seats[0].counts,age<=ONLINE_WINDOW_MS);assert.equal(r.body.fetchedAt,f.at);
    assert.deepEqual(f.work(),{index:0,rpc:0,otherRpc:0,budget:0,lane:0,assets:0});
  }finally{await f.finish();}
});

for(const change of ['Infinity','NaN','-Infinity','rollback'])
test(`Audit10 I2 adjacent: ${change} after public enrichment is unavailable without persistent side effects`,async()=>{
  const f=await fixture({signIn:false});try{f.afterSighting(n=>{if(n===1)f.w.clock.set(invalidAt(change,f.at));});
    const r=await read(f,'/api/wallet/'+f.address+'/assets');assert.equal(r.status,503);assert.deepEqual(r.body,{error:'OWNERSHIP_UNAVAILABLE'});
    assert.deepEqual(reservations(f.w),{lanes:[],probes:[]});assert.deepEqual(f.work(),{index:0,rpc:0,otherRpc:0,budget:0,lane:0,assets:0});
  }finally{await f.finish();}
});
