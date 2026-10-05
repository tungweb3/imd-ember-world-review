import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain} from './wallet-harness.mjs';
import {MULTICALL3,ONLINE_WINDOW_MS,OWNERSHIP_TTL_MS} from '../server/ownership.ts';

// Audit9 Low1: the real Worker and migration-backed SQLite run against offline chain/roster fixtures.
// The same test file is copied unchanged to the frozen baseline before the product fix is applied.
async function fixture({online=false,sightingAge=ONLINE_WINDOW_MS-1,wrongOwner=false,budget=true,lane=false,indexFailure=false}={}){
  const account=newAccount(),address=account.address.toLowerCase(),owners=[];owners[7]=address;
  const chain=fakeChain({owners:{7:address}}),w=setup({chain,imd:fakeImd({seats:{7:'707'},owners,online:online?[7]:[]})});
  const keys=[],routes=[],browser=w.browser(),send=browser.send;
  browser.send=request=>{routes.push(new URL(request.url).pathname);return send(request);};
  w.env.CHAIN_LIMITER={limit:async({key})=>{keys.push(key);return {success:key==='chain:index'?budget:key==='chain:index:lane'?lane:true};}};
  assert.equal((await browser.signIn(account)).verify.status,200);
  const at=w.clock.now(),seen=at-sightingAge;
  w.db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(7,?,?,?)')
    .run(wrongOwner?'0x'+'2'.repeat(40):address,seen,seen);
  if(indexFailure)chain.state.fail='index';
  const before=rows(w),presence=presenceRows(w),prepare=w.db.prepare.bind(w.db);let reads=0,afterRead=()=>{};
  w.db.prepare=sql=>{const wrap=s=>({...s,bind:(...args)=>wrap(s.bind(...args)),all:async()=>{
    const result=await s.all();
    if(sql.startsWith('SELECT token_id,last_online_at'))afterRead(++reads);
    return result;
  }});return wrap(prepare(sql));};
  return {w,browser,chain,address,at,seen,before,presence,keys,routes,
    afterRead:fn=>{afterRead=fn;},get reads(){return reads;},
    counts:()=>({index:chain.state.calls.filter(c=>!c.body).length,
      rpc:chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length,
      otherRpc:chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method!=='eth_call').length,
      budget:keys.filter(k=>k==='chain:index').length,lane:keys.filter(k=>k==='chain:index:lane').length,
      challenge:routes.filter(p=>p==='/api/auth/challenge').length,verify:routes.filter(p=>p==='/api/auth/verify').length,
      home:routes.filter(p=>p==='/api/me/home').length,logout:routes.filter(p=>p==='/api/auth/logout').length}),
    finish:async()=>{await Promise.all(w.kept);assert.deepEqual(rows(w),before,'eligibility reads do not change authenticated rows');
      assert.deepEqual(presenceRows(w),presence,'enrichment never rewrites a sighting as current');w.db.raw.close();}};
}
const rows=w=>({sessions:w.db.raw.prepare('SELECT nonce,address,expires_at,revoked_at FROM sessions ORDER BY rowid').all(),
  challenges:w.db.raw.prepare('SELECT nonce,used_at,invalidated_at FROM login_challenges ORDER BY rowid').all()});
const presenceRows=w=>w.db.raw.prepare('SELECT token_id,owner,last_online_at,updated_at FROM seat_presence ORDER BY token_id').all();
const indexRows=w=>w.db.raw.prepare('SELECT ids,read_at FROM index_candidates ORDER BY address').all();
const home=async f=>{const response=await f.browser.get('/api/me/home');return {status:response.status,body:await response.json()};};

for(const delay of [0,1,2,5000])test(`Audit9 Low1: D1 wait ${delay}ms counts the inclusive 24h sighting at the final clock`,async t=>{
  const f=await fixture();try{
    f.afterRead(n=>{if(n===1)f.w.clock.advance(delay);});
    const first=await home(f),next=await home(f);await Promise.all(f.w.kept);
    const expected=delay<=1?1:0;
    t.diagnostic(JSON.stringify({delay,sightingAge:f.w.clock.now()-f.seen,first,next,counts:f.counts(),
      presence:presenceRows(f.w),index:indexRows(f.w),auth:rows(f.w)}));
    assert.equal(first.status,200);assert.equal(next.status,200);
    assert.equal(first.body.eligible,expected,'post-D1 eligibility must agree with the live 24h boundary');
    assert.equal(first.body.seats[0].counts,!!expected);assert.equal(first.body.size,expected?'s':null);
    assert.equal(next.body.eligible,expected,'an immediate second read must give the same authority');
    assert.equal(first.body.checkedAt,f.at);assert.equal(next.body.checkedAt,f.at,'eligibility does not renew ownerOf');
    assert.equal(first.body.seats[0].lastOnlineAt,f.seen);assert.equal(first.body.block,21_000_000);
    assert.deepEqual(f.counts(),{index:1,rpc:1,otherRpc:0,budget:1,lane:0,challenge:1,verify:1,home:2,logout:0});
    assert.deepEqual(indexRows(f.w).map(r=>r.read_at),[f.at],'eligibility does not renew the NFT index');
  }finally{await f.finish();}
});

for(const age of [ONLINE_WINDOW_MS,ONLINE_WINDOW_MS+1])test(`Audit9 Low1 control: undelayed sighting age ${age}ms preserves the inclusive rule`,async()=>{
  const f=await fixture({sightingAge:age});try{
    const response=await home(f);assert.equal(response.status,200);
    assert.equal(response.body.eligible,age===ONLINE_WINDOW_MS?1:0);
    assert.equal(response.body.checkedAt,f.at);assert.equal(response.body.seats[0].lastOnlineAt,f.seen);
  }finally{await f.finish();}
});

test('Audit9 Low1 control: online roster still counts after enrichment and lastOnlineAt reflects the live clock',async()=>{
  const f=await fixture({online:true,sightingAge:ONLINE_WINDOW_MS+1});try{
    f.afterRead(n=>{if(n===1)f.w.clock.advance(5000);});const response=await home(f);
    assert.equal(response.status,200);assert.equal(response.body.eligible,1);assert.equal(response.body.seats[0].online,true);
    assert.equal(response.body.seats[0].lastOnlineAt,f.at+5000);assert.equal(response.body.checkedAt,f.at);
  }finally{await f.finish();}
});

test('Audit9 Low1 control: another owner recent sighting never counts for this household',async()=>{
  const f=await fixture({wrongOwner:true});try{
    f.afterRead(n=>{if(n===1)f.w.clock.advance(2);});const response=await home(f);
    assert.equal(response.status,200);assert.equal(response.body.eligible,0);
    assert.equal(response.body.seats[0].lastOnlineAt,null);assert.equal(response.body.seats[0].reason,'not-seen');
  }finally{await f.finish();}
});

for(const variant of ['refused','failed-index','successful-index'])test(`Audit9 Low1: expired sighting during D1 wait enters ${variant} lane using live eligibility`,async t=>{
  const f=await fixture({budget:false,lane:variant!=='refused',indexFailure:variant==='failed-index'});try{
    f.afterRead(n=>{if(n===1)f.w.clock.advance(2);});const response=await home(f);await Promise.all(f.w.kept);
    const laneRows=f.w.db.raw.prepare('SELECT net,sub,at FROM index_lanes').all();
    t.diagnostic(JSON.stringify({variant,response,counts:f.counts(),laneRows,presence:presenceRows(f.w),index:indexRows(f.w)}));
    assert.equal(response.status,200);assert.equal(response.body.eligible,0);assert.equal(response.body.size,null);
    assert.equal(response.body.seats[0].counts,false);assert.equal(response.body.seats[0].reason,'offline-24h');
    assert.equal(response.body.checkedAt,f.at,'lane discovery cannot date ownerOf as new');
    assert.equal(f.counts().lane,1,'a sighting expiring while D1 waits cannot suppress the no-eligible-seat lane');
    assert.equal(f.counts().budget,1);assert.equal(f.counts().rpc,1,'the young same-epoch proof remains bounded');
    assert.equal(f.counts().index,variant==='refused'?0:1);assert.equal(laneRows.length,variant==='refused'?0:1);
    assert.equal(response.body.recheck,variant==='successful-index'?undefined:'limited');
    assert.deepEqual(indexRows(f.w).map(r=>r.read_at),variant==='successful-index'?[f.at+2]:[]);
  }finally{await f.finish();}
});

test('Audit9 Low1: a sighting expiring during the second admitted-lane D1 read cannot regain eligibility',async t=>{
  const f=await fixture({budget:false,lane:true});try{
    // Seat 7 is expired, so the real lane discovers a different owned offline seat with a still-recent sighting.
    f.w.imd.state.seats[8]='808';f.chain.state.owners[8]=f.address;
    f.w.db.raw.prepare('UPDATE seat_presence SET last_online_at=?,updated_at=?').run(f.at-ONLINE_WINDOW_MS-1,f.at-ONLINE_WINDOW_MS-1);
    f.w.db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(8,?,?,?)')
      .run(f.address,f.seen,f.seen);
    f.presence.splice(0,f.presence.length,...presenceRows(f.w));
    f.afterRead(n=>{if(n===2)f.w.clock.advance(2);});const response=await home(f);
    t.diagnostic(JSON.stringify({response,reads:f.reads,counts:f.counts()}));
    assert.equal(f.reads,2);assert.equal(response.status,200);assert.equal(response.body.eligible,0);
    assert.deepEqual(response.body.seats.map(s=>[s.tokenId,s.counts]),[['7',false],['8',false]]);
    assert.equal(response.body.checkedAt,f.at);assert.equal(f.counts().rpc,2);assert.equal(f.counts().index,1);
  }finally{await f.finish();}
});

for(const change of ['rollback','NaN','Infinity'])test(`Audit9 Low1: final ${change} clock after real D1 read fails closed`,async t=>{
  const f=await fixture();try{
    f.afterRead(n=>{if(n===1)f.w.clock.set(change==='rollback'?f.at-1:change==='NaN'?NaN:Infinity);});
    const response=await home(f);t.diagnostic(JSON.stringify({change,response,counts:f.counts()}));
    assert.equal(response.status,503);assert.equal(response.body.error,'OWNERSHIP_UNAVAILABLE');assert.equal(response.body.eligible,undefined);
    assert.equal(f.counts().rpc,1);assert.equal(f.counts().index,1);assert.equal(f.counts().budget,1);
  }finally{await f.finish();}
});

for(const delay of [OWNERSHIP_TTL_MS-1,OWNERSHIP_TTL_MS,OWNERSHIP_TTL_MS+1])test(`Audit9 Low1 control: D1 wait ${delay}ms never renews the strict 30s ownerOf deadline`,async t=>{
  const f=await fixture();try{
    f.afterRead(n=>{if(n===1)f.w.clock.advance(delay);});const response=await home(f);
    t.diagnostic(JSON.stringify({delay,response,counts:f.counts()}));
    assert.equal(response.status,delay<OWNERSHIP_TTL_MS?200:503);
    if(delay<OWNERSHIP_TTL_MS){assert.equal(response.body.eligible,0);assert.equal(response.body.checkedAt,f.at);}
    else{assert.equal(response.body.error,'OWNERSHIP_UNAVAILABLE');assert.equal(response.body.eligible,undefined);}
    assert.equal(f.counts().rpc,1);assert.equal(f.counts().index,1);assert.equal(f.counts().budget,1);
  }finally{await f.finish();}
});

for(const lane of [false,true])for(const change of ['rollback','NaN','Infinity'])
test(`Audit9 Low1: ${change} after refused-index enrichment with ${lane?'admitted':'refused'} lane cannot become complete not-owned`,async t=>{
  const f=await fixture({budget:false,lane});try{
    f.afterRead(n=>{if(n===1)f.w.clock.set(change==='rollback'?f.at-1:change==='NaN'?NaN:Infinity);});
    const response=await home(f);t.diagnostic(JSON.stringify({change,lane,response,counts:f.counts()}));
    assert.equal(response.status,503);assert.deepEqual(response.body,{error:'OWNERSHIP_UNAVAILABLE'});
    assert.equal(f.counts().rpc,1);assert.equal(f.counts().index,0);assert.equal(f.counts().budget,1);
  }finally{await f.finish();}
});

test('Audit9 Low1 control: next latest valid request recovers after a post-D1 expired proof without renewing old evidence',async t=>{
  const f=await fixture();try{
    f.afterRead(n=>{if(n===1)f.w.clock.advance(OWNERSHIP_TTL_MS);});
    const unavailable=await home(f),next=await home(f);await Promise.all(f.w.kept);
    t.diagnostic(JSON.stringify({unavailable,next,counts:f.counts(),rpcTags:f.chain.state.calls.filter(c=>c.body).map(c=>JSON.parse(c.body).params[1]),index:indexRows(f.w)}));
    assert.equal(unavailable.status,503);assert.deepEqual(unavailable.body,{error:'OWNERSHIP_UNAVAILABLE'});
    assert.equal(next.status,200);assert.equal(next.body.checkedAt,f.at+OWNERSHIP_TTL_MS);
    assert.equal(next.body.eligible,0);assert.equal(next.body.seats[0].tokenId,'7');assert.equal(next.body.seats[0].reason,'offline-24h');
    assert.deepEqual(f.chain.state.calls.filter(c=>c.body).map(c=>JSON.parse(c.body).params[1]),['latest','latest']);
    assert.equal(f.counts().rpc,2);assert.equal(f.counts().index,1);assert.equal(f.counts().budget,1);
    assert.deepEqual(indexRows(f.w).map(r=>r.read_at),[f.at],'the next proof is latest while discovery keeps its original date');
  }finally{await f.finish();}
});
