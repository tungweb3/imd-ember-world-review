import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Test-only same-evaluator baseline selection. The supported runner clears this
// selector; every selected module is the actual Worker/harness from that source.
const source=process.env.SCHEDULED_AUDIT11_SOURCE
  ?pathToFileURL(resolve(process.env.SCHEDULED_AUDIT11_SOURCE)+'/'):new URL('../',import.meta.url);
const from=path=>import(new URL(path,source).href);
const [{setup,newAccount,fakeImd,fakeChain},{createWorker},{ReadGateway},presence,member,auth,ownership]=await Promise.all([
  from('tests/wallet-harness.mjs'),from('worker/app.ts'),from('server/gateway.ts'),
  from('server/presence.ts'),from('server/member.ts'),from('server/auth.ts'),from('server/ownership.ts')]);
const T=Date.UTC(2026,8,28,12),TABLES=['sessions','login_challenges','seat_presence','profile_requests','profile_history','index_lane_probes','index_lanes','index_candidates'];
const rows=(w,table)=>w.db.raw.prepare(`SELECT rowid AS fixture_rowid,* FROM ${table} ORDER BY rowid`).all();
const snapshot=w=>Object.fromEntries(TABLES.map(table=>[table,rows(w,table)]));
const changes=w=>w.db.raw.prepare('SELECT total_changes() AS n').get().n;
const count=(w,table)=>w.db.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const liveProbe=w=>{const row=w.db.raw.prepare('SELECT scope_key,net,sub,probed_at,expires_at FROM index_lane_probes WHERE scope_key=?').get('net:unknown|');return row?{...row}:undefined;};
function copyRow(w,table,row,overrides){
  const value={...row,...overrides},columns=Object.keys(value);
  w.db.raw.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(value));
}
function requestRow(w,id,expiry,created=T-120_000){
  const mid=w.db.raw.prepare('SELECT member_id FROM members').get().member_id;
  w.db.raw.prepare("INSERT INTO profile_requests(member_id,request_id,payload_hash,outcome,created_at,expires_at) VALUES(?,?,?,'NAME_UNAVAILABLE',?,?)")
    .run(mid,id,'fixture-'+id,created,expiry);
}
function historyRow(w,expiry){
  const mid=w.db.raw.prepare('SELECT member_id FROM members').get().member_id;
  w.db.raw.prepare("INSERT INTO profile_history(member_id,actor,kind,version,at,expires_at) VALUES(?,'self','initial',1,?,?)").run(mid,T-120_000,expiry);
}
function probeRow(w,key,expiry){
  w.db.raw.prepare('INSERT INTO index_lane_probes(scope_key,net,sub,probed_at,expires_at) VALUES(?,?,NULL,?,?)')
    .run(key,'net:'+key,expiry-auth.INDEX_PROBE_BACKOFF_MS,expiry);
}
const work=f=>({index:f.w.chain.state.calls.filter(c=>!c.body).length,
  rpc:f.w.chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===ownership.MULTICALL3).length,
  budget:f.keys.filter(k=>k==='chain:index').length,lane:f.keys.filter(k=>k==='chain:index:lane').length});
async function home(f){const r=await f.browser.get('/api/me/home');await Promise.all(f.w.kept);return {status:r.status,body:await r.json()};}
async function signedSession(f){const r=await f.browser.get('/api/auth/session');return {status:r.status,body:await r.json()};}
async function fixture(){
  const account=newAccount(),address=account.address.toLowerCase(),owners=[];owners[7]=address;
  const w=setup({imd:fakeImd({seats:{7:'707'},owners,online:[]}),chain:fakeChain({owners:{7:address}}),collections:[]});
  w.clock.set(T);const browser=w.browser(),signed=await browser.signIn(account);
  assert.equal(signed.challenge.status,200);assert.equal(signed.verify.status,200,'real synthetic viem EOA sign-in');
  assert.equal((await browser.post('/api/me/bootstrap')).status,200);
  w.db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(?,?,?,?)')
    .run(7,address,T-ownership.ONLINE_WINDOW_MS-1,T-ownership.ONLINE_WINDOW_MS-1);
  const keys=[];w.env.CHAIN_LIMITER={limit:async({key})=>{keys.push(key);return {success:false};}};
  const f={w,browser,address,keys},first=await home(f);
  assert.equal(first.status,200);assert.equal(first.body.recheck,'limited');
  assert.deepEqual(work(f),{index:0,rpc:1,budget:1,lane:1});
  assert.deepEqual({...liveProbe(w)},{scope_key:'net:unknown|',net:'net:unknown',sub:null,probed_at:T,expires_at:T+30_000});
  assert.deepEqual(rows(w,'index_lanes'),[],'refused limiter reserves no admitted lane');
  const session=w.db.raw.prepare('SELECT * FROM sessions').get(),challenge=w.db.raw.prepare('SELECT * FROM login_challenges').get();
  copyRow(w,'sessions',session,{token_hash:'11'.repeat(32),nonce:'11'.repeat(16),expires_at:T-presence.DAY_MS-2});
  copyRow(w,'login_challenges',challenge,{nonce:'22'.repeat(16),issued_at:T-presence.UNUSED_CHALLENGE_KEEP_MS-2,used_at:null,session_hash:null});
  requestRow(w,'expired-request',T-1);requestRow(w,'live-request',T+presence.DAY_MS,T);
  historyRow(w,T-1);historyRow(w,T+30*presence.DAY_MS);probeRow(w,'expired-probe',T-1);
  w.db.raw.prepare('INSERT INTO index_lanes(net,sub,at) VALUES(?,NULL,?)').run('net:fixture',T-presence.INDEX_LANE_KEEP_MS-2);
  w.db.raw.prepare('INSERT INTO index_candidates(address,ids,read_at) VALUES(?,?,?)').run('0x'+'ab'.repeat(20),'[8]',T-presence.INDEX_KEEP_MS-2);
  return f;
}
async function cron(f,samples,env=f.w.env){
  const {w}=f,tasks=[],logs=[],sql=[],saved=console.log;let sampled=0,batches=0;
  const db=env.DB?{...env.DB,prepare:statement=>{sql.push(statement);return env.DB.prepare(statement);},batch:statements=>{batches++;return env.DB.batch(statements);}}:undefined;
  const worker=createWorker(new ReadGateway(w.imd.fetcher,w.clock.now),w.chain.fetcher,()=>{
    assert.ok(sampled<samples.length,'scheduled must not add another clock sample');return samples[sampled++];},[]);
  console.log=(...args)=>logs.push(args.join(' '));
  try{
    await worker.scheduled({scheduledTime:w.clock.now(),cron:'*/15 * * * *'},{...env,DB:db},{waitUntil:p=>tasks.push(p)});
    const settled=[];let taken=0;
    while(taken<tasks.length){const batch=tasks.slice(taken);taken=tasks.length;settled.push(...await Promise.allSettled(batch));}
    return {sampled,tasks:tasks.length,sql:sql.length,batches,logs,rejected:settled.filter(r=>r.status==='rejected').length};
  }finally{console.log=saved;}
}
async function close(f){await Promise.allSettled(f.w.kept);f.w.db.raw.close();}

for(const position of [0,1,2])for(const [name,invalid] of [['NaN',NaN],['Infinity',Infinity],['-Infinity',-Infinity]])
test(`Audit11 scheduled: ${name} at sample ${position+1} leaves all housekeeping rows and actual 30s backoff unchanged`,async t=>{
  const f=await fixture();try{
    f.w.imd.state.online=[7]; // A fresh real scheduled gateway would materialize online presence.
    const samples=[T+1,T+2,T+3];samples[position]=invalid;
    const before=snapshot(f.w),beforeChanges=changes(f.w),beforeWork=work(f),beforeUpstream=f.w.imd.state.calls;
    const cycle=await cron(f,samples),after=snapshot(f.w),mutationCount=changes(f.w)-beforeChanges;
    const upstream=f.w.imd.state.calls-beforeUpstream,session=await signedSession(f);
    f.w.clock.set(T+1);const second=await home(f),probeAfterRequest=liveProbe(f.w),afterWork=work(f);
    t.diagnostic(JSON.stringify({position:position+1,invalid:name,cycle,mutationCount,upstream,
      beforeCounts:Object.fromEntries(TABLES.map(k=>[k,before[k].length])),afterCounts:Object.fromEntries(TABLES.map(k=>[k,after[k].length])),
      sessionAfter:{status:session.status,signedIn:session.body.signedIn},second:{status:second.status,recheck:second.body.recheck},
      probeAfterCron:after.index_lane_probes.map(({scope_key,probed_at,expires_at})=>({scope_key,probed_at,expires_at})),probeAfterRequest,beforeWork,afterWork}));
    assert.deepEqual(after,before,'an invalid sample anywhere forbids every durable housekeeping mutation');
    assert.equal(mutationCount,0);assert.equal(cycle.sampled,3,'validate all three original samples before starting helpers');
    assert.equal(cycle.tasks,0,'invalid cycle registers no housekeeping or upstream task');
    assert.equal(cycle.sql,0,'invalid cycle does not prepare any SQL');assert.equal(cycle.batches,0);assert.equal(cycle.rejected,0);
    assert.deepEqual(cycle.logs,['scheduled {"status":"invalid_clock"}'],'fixed invalid-clock status without raw data');
    assert.equal(upstream,0);assert.deepEqual(work(f),beforeWork,'invalid cron and +1ms request add no upstream/budget/lane work');
    assert.equal(session.status,200);assert.equal(session.body.signedIn,true);assert.equal(session.body.address.toLowerCase(),f.address);
    assert.equal(second.status,200);assert.equal(second.body.recheck,'limited');
    assert.deepEqual(probeAfterRequest,liveProbeFrom(before),'the actual finite probe is neither refunded nor timestamp-refreshed');
    f.w.imd.state.online=[];
    for(const later of [T+600_000,T+3_600_000]){
      f.w.clock.set(later);const recovery=await cron(f,[later+1,later+2,later+3]);
      assert.equal(recovery.sampled,3);assert.equal(recovery.rejected,0);assert.ok(recovery.sql>0);assert.equal(liveProbe(f.w),undefined);
      assert.equal((await signedSession(f)).body.signedIn,true);assert.equal((await home(f)).status,200);
      assert.equal(liveProbe(f.w).probed_at,later);assert.equal(liveProbe(f.w).expires_at,later+30_000);
    }
    assert.deepEqual(work(f),{index:0,rpc:3,budget:3,lane:3},'finite recovery resumes one refused probe per later request');
    assert.equal(count(f.w,'profile_requests'),1);assert.equal(count(f.w,'profile_history'),1);
    for(const table of ['seat_presence','index_lane_probes','index_lanes'])for(const row of rows(f.w,table))
      for(const key of ['last_online_at','updated_at','probed_at','expires_at','at'])if(key in row)assert.equal(Number.isFinite(row[key]),true);
  }finally{await close(f);}
});
const liveProbeFrom=snapshot=>{
  const {scope_key,net,sub,probed_at,expires_at}=snapshot.index_lane_probes.find(p=>p.scope_key==='net:unknown|');
  return {scope_key,net,sub,probed_at,expires_at};
};

test('Audit11 scheduled finite control preserves distinct helper times, strict presence cutoffs and inclusive member/probe expiry',async t=>{
  const f=await fixture();try{
    const session=f.w.db.raw.prepare('SELECT * FROM sessions WHERE revoked_at IS NULL ORDER BY expires_at DESC LIMIT 1').get();
    copyRow(f.w,'sessions',session,{token_hash:'33'.repeat(32),nonce:'33'.repeat(16),expires_at:T+10-presence.DAY_MS});
    const challenge=f.w.db.raw.prepare('SELECT * FROM login_challenges WHERE used_at IS NOT NULL').get();
    copyRow(f.w,'login_challenges',challenge,{nonce:'44'.repeat(16),issued_at:T+10-presence.UNUSED_CHALLENGE_KEEP_MS,used_at:null,session_hash:null});
    requestRow(f.w,'member-before',T+15,T-30*presence.DAY_MS);requestRow(f.w,'member-exact',T+20,T-30*presence.DAY_MS+61_000);requestRow(f.w,'member-after',T+21,T-30*presence.DAY_MS+122_000);
    historyRow(f.w,T+15);historyRow(f.w,T+20);historyRow(f.w,T+21);
    probeRow(f.w,'probe-before',T+25);probeRow(f.w,'probe-exact',T+30);probeRow(f.w,'probe-after',T+31);
    f.w.imd.state.online=[7];const cycle=await cron(f,[T+10,T+20,T+30]);
    assert.equal(cycle.sampled,3);assert.equal(cycle.rejected,0);assert.ok(cycle.tasks>=3);
    assert.equal(count(f.w,'sessions'),2,'strict first-sample cutoff retains the exact-boundary session');
    assert.equal(count(f.w,'login_challenges'),2,'strict first-sample cutoff retains exact unused challenge boundary');
    const seen=rows(f.w,'seat_presence')[0];assert.equal(seen.last_online_at,T,'roster producer timestamp stays separate');assert.equal(seen.updated_at,T+10);
    assert.deepEqual(rows(f.w,'profile_requests').map(r=>r.request_id).sort(),['live-request','member-after']);
    assert.deepEqual(rows(f.w,'profile_history').map(r=>r.expires_at).sort((a,b)=>a-b),[T+21,T+30*presence.DAY_MS]);
    assert.deepEqual(rows(f.w,'index_lane_probes').map(r=>r.scope_key).sort(),['net:unknown|','probe-after']);
    assert.deepEqual(rows(f.w,'index_lanes'),[]);assert.deepEqual(rows(f.w,'index_candidates'),[]);
    assert.equal((await signedSession(f)).body.signedIn,true);assert.deepEqual(work(f),{index:0,rpc:1,budget:1,lane:1});
    t.diagnostic(JSON.stringify({samples:[T+10,T+20,T+30],cycle,remaining:Object.fromEntries(TABLES.map(k=>[k,count(f.w,k)]))}));
  }finally{await close(f);}
});

test('Audit11 scheduled finite control retains independent 200-row cleanup caps and drains only expired backlog',async()=>{
  const f=await fixture();try{
    for(let i=0;i<201;i++){requestRow(f.w,'backlog-'+i,T-1,T-30*presence.DAY_MS+i*61_000);historyRow(f.w,T-1);probeRow(f.w,'backlog-'+i,T-1);}
    assert.equal(member.MEMBER_CLEANUP_MAX_ROWS,200);assert.equal(auth.INDEX_PROBE_CRON_PRUNE,200);
    const first=await cron(f,[T,T,T]);assert.equal(first.rejected,0);
    assert.equal(count(f.w,'profile_requests'),3);assert.equal(count(f.w,'profile_history'),3);assert.equal(count(f.w,'index_lane_probes'),3);
    const second=await cron(f,[T,T,T]);assert.equal(second.rejected,0);
    assert.equal(count(f.w,'profile_requests'),1);assert.equal(count(f.w,'profile_history'),1);assert.equal(count(f.w,'index_lane_probes'),1);
    assert.equal(liveProbe(f.w).expires_at,T+30_000);assert.equal((await signedSession(f)).body.signedIn,true);
  }finally{await close(f);}
});

test('Audit11 scheduled finite control keeps presence/member/probe jobs independent across missing cleanup schema',async()=>{
  for(const missing of ['member','probe']){
    const f=await fixture();try{
      f.w.imd.state.online=[7];
      if(missing==='member')f.w.db.raw.exec('DROP TRIGGER profile_requests_write_budget; DROP INDEX profile_requests_expiry; DROP INDEX profile_history_expiry;');
      else f.w.db.raw.exec('DROP TABLE index_lane_probes;');
      const cycle=await cron(f,[T+1,T+2,T+3]);assert.equal(cycle.rejected,0);assert.equal(rows(f.w,'seat_presence')[0].updated_at,T+1);
      assert.equal((await signedSession(f)).body.signedIn,true);
      if(missing==='member'){
        assert.equal(count(f.w,'profile_requests'),2);assert.equal(count(f.w,'profile_history'),2);assert.equal(count(f.w,'index_lane_probes'),1);
        assert.ok(cycle.logs.includes('member_cleanup {"status":"schema_unavailable"}'));
      }else{
        assert.equal(count(f.w,'profile_requests'),1);assert.equal(count(f.w,'profile_history'),1);
        assert.ok(cycle.logs.includes('index_probe_cleanup {"status":"schema_unavailable"}'));
      }
    }finally{await close(f);}
  }
});

test('Audit11 scheduled no-DB control skips clock sampling, SQL and tasks',async()=>{
  const w=setup({collections:[]}),f={w};try{
    const upstream=w.imd.state.calls,cycle=await cron(f,[],{...w.env,DB:undefined});
    assert.equal(cycle.sampled,0);assert.equal(cycle.sql,0);assert.equal(cycle.tasks,0);assert.equal(cycle.batches,0);
    assert.equal(w.imd.state.calls,upstream);
  }finally{await close(f);}
});
