import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,newAccount,START,windowLimiter} from './wallet-harness.mjs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {pruneMemberRecords,MEMBER_CLEANUP_MAX_ROWS,MEMBER_CLEANUP_OPPORTUNISTIC_ROWS} from '../server/member.ts';
import {pruneIndexProbes,INDEX_PROBE_PRUNE,INDEX_PROBE_CRON_PRUNE,INDEX_PROBE_OPPORTUNISTIC_PRUNE,INDEX_PROBE_BACKOFF_MS} from '../server/auth.ts';

// Real Worker + real additive 0001–0006/0008 SQL, no Coin 0007, network calls or persisted signing keys.
const DAY=86_400_000,MIN=60_000,json=r=>r.clone().json();
const count=(w,t)=>w.db.raw.prepare(`SELECT count(*) n FROM ${t}`).get().n;
const mid=w=>w.db.raw.prepare('SELECT member_id FROM members LIMIT 1').get().member_id;
const view=w=>({...w.db.raw.prepare('SELECT * FROM member_profiles LIMIT 1').get()});
let id=0;
async function signed(w,a=newAccount(),ip){const b=w.browser(undefined,undefined,ip);assert.equal((await b.signIn(a)).verify.status,200);return {b,a};}
async function bootstrap(b){const r=await b.post('/api/me/bootstrap');assert.equal(r.status,200,JSON.stringify(await json(r)));return json(r);}
const payload=(me,name='admin',requestId='aud4-'+String(++id).padStart(8,'0'),version=me.member.version)=>({displayName:name,
  expectedActorPublicId:me.member.publicMemberId,expectedProfileVersion:version,requestId});
const put=(b,p)=>b.send(b.request('/api/me/profile',{method:'PUT',body:p}));
const addRequest=(w,member,key,at,expiry=at+DAY)=>w.db.raw.prepare(`INSERT INTO profile_requests
  (member_id,request_id,payload_hash,outcome,created_at,expires_at) VALUES(?,?,?,'NAME_UNAVAILABLE',?,?)`).run(member,key,'fixture-'+key,at,expiry);
function seedExpired(w,n){
  const member=mid(w);
  for(let i=0;i<n;i++){
    const at=START-30*DAY+i*(MIN+1);
    addRequest(w,member,'expired-'+i,at,at+DAY);
    w.db.raw.prepare(`INSERT INTO profile_history(member_id,actor,kind,old_name,new_name,version,at,expires_at)
      VALUES(?,'self','rename','Before','After',1,?,?)`).run(member,START-200*DAY+i,START-20*DAY+i);
  }
}
function substitute(w,wrap){const old=w.env.DB;w.env.DB=wrap(w.db);return ()=>{w.env.DB=old;};}

test('AUD4-02: permissive ERC-1271 may log in/read but cannot bootstrap; no member or cookie is written',async()=>{
  const w=setup(),a=newAccount();w.chain.state.contracts.set(a.address.toLowerCase(),()=> '0x1626ba7e');
  const b=w.browser(),result=await b.signIn(a,{sign:async()=> '0x'+'aa'.repeat(65)});
  assert.equal(result.verify.status,200,'fixture accepts any signature through the actual contract-login branch');
  const session=w.db.raw.prepare('SELECT wallet_type,verification_method FROM sessions').get();
  assert.deepEqual({...session},{wallet_type:'CONTRACT',verification_method:'ERC1271'});
  assert.equal((await b.get('/api/auth/session')).status,200);
  assert.equal((await b.get('/api/me/home')).status,200);
  const read=await b.get('/api/me/profile');assert.equal(read.status,404);assert.deepEqual(await json(read),{error:'MEMBER_NOT_FOUND'});
  const r=await b.post('/api/me/bootstrap');assert.equal(r.status,403);assert.deepEqual(await json(r),{error:'CONTRACT_WRITE_NOT_ENABLED'});
  assert.deepEqual(r.headers.getSetCookie(),[]);assert.equal(count(w,'members'),0);
});

test('AUD4-02: existing contract/unknown identities read without last_login writes; bootstrap/PUT fail closed',async()=>{
  const w=setup(),{b,a}=await signed(w),me=await bootstrap(b);const initial=view(w);
  w.clock.advance(2*60*MIN);
  for(const [type,method] of [['CONTRACT','ERC1271'],[null,null],['EOA',null],['CONTRACT','ECDSA'],['other','other']]){
    w.db.raw.prepare('UPDATE sessions SET wallet_type=?,verification_method=?').run(type,method);
    const g=await b.get('/api/me/profile');assert.equal(g.status,200);
    assert.equal((await json(g)).member.publicMemberId,me.member.publicMemberId);
    assert.equal(w.db.raw.prepare('SELECT last_login_at FROM wallet_identities').get().last_login_at,START);
    assert.equal((await b.get('/api/world/names/'+a.address)).status,200);
    for(const r of [await b.post('/api/me/bootstrap'),await put(b,payload(me,'AllowedName'))]){
      assert.equal(r.status,403);assert.deepEqual(await json(r),{error:'CONTRACT_WRITE_NOT_ENABLED'});
      assert.deepEqual(r.headers.getSetCookie(),[]);
    }
    assert.deepEqual(view(w),initial);assert.equal(count(w,'profile_requests'),0);assert.equal(count(w,'profile_history'),0);
  }
  w.db.raw.prepare("UPDATE sessions SET wallet_type='EOA',verification_method='ECDSA'").run();
  assert.equal((await b.get('/api/me/profile')).status,200);
  assert.equal(w.db.raw.prepare('SELECT last_login_at FROM wallet_identities').get().last_login_at,w.clock.now());
  assert.equal((await put(b,payload(me,'AllowedName'))).status,200);
});

test('AUD4-02/04/05: missing 0008 fails persistent writes closed, keeps sign-in/profile reads, skips cron safely',async()=>{
  const w=setup();w.env.DB=openD1(migrationFiles().filter(f=>f<'0008'));
  const {b}=await signed(w);assert.equal((await b.get('/api/auth/session')).status,200);
  const first=await b.post('/api/me/bootstrap');assert.equal(first.status,503);assert.deepEqual(await json(first),{error:'PROFILE_UNAVAILABLE'});
  assert.equal((await b.get('/api/me/profile')).status,404);
  assert.equal(w.env.DB.raw.prepare('SELECT count(*) n FROM members').get().n,0);
  // Existing M1 data created before migration is still readable; do not let an hourly GET mutate it.
  const old=w.env.DB;
  for(const row of old.raw.prepare('SELECT * FROM sessions').all()){
    const keys=Object.keys(row);w.db.raw.prepare(`INSERT INTO sessions(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
  }
  w.env.DB=w.db;const me=await bootstrap(b);
  const copyTables=['sessions','members','wallet_identities','member_profiles','economy_accounts','life_state'];
  for(const table of copyTables){
    old.raw.exec('DELETE FROM '+table);
    for(const row of w.db.raw.prepare('SELECT * FROM '+table).all()){
      const keys=Object.keys(row);old.raw.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
    }
  }
  w.env.DB=old;w.clock.advance(2*60*MIN);
  assert.equal((await b.get('/api/me/profile')).status,200);
  assert.equal(old.raw.prepare('SELECT last_login_at FROM wallet_identities').get().last_login_at,START);
  assert.equal((await put(b,payload(me,'Name'))).status,503);
  assert.deepEqual(await pruneMemberRecords(old,w.clock.now()),{status:'schema_unavailable'});
  const logs=[],saved=console.log;console.log=(...args)=>logs.push(args.join(' '));
  try{await w.worker.scheduled({scheduledTime:w.clock.now(),cron:'*/15 * * * *'},w.env,{waitUntil:p=>w.kept.push(p)});await Promise.all(w.kept);}
  finally{console.log=saved;}
  assert.ok(logs.some(x=>x==='member_cleanup {"status":"schema_unavailable"}'));
  assert.ok(!logs.some(x=>x.includes(aSafeSecret())));
  const tables=old.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
  const dump=()=>Object.fromEntries(tables.map(t=>[t,old.raw.prepare('SELECT * FROM '+t).all().map(r=>({...r}))]));
  const before=dump();old.raw.exec(readFileSync(new URL('../migrations/0008_member_hardening.sql',import.meta.url),'utf8'));
  assert.deepEqual(dump(),before,'0008 adds only trigger/indexes and changes no existing row');
  assert.equal((await put(b,payload(me,'AfterMigration'))).status,200);
});
const aSafeSecret=()=> 'test-alchemy-key';
function seedProbes(w,n){
  const insert=w.db.raw.prepare('INSERT INTO index_lane_probes(scope_key,net,sub,probed_at,expires_at) VALUES(?,?,NULL,?,?)');
  for(let i=0;i<n;i++)insert.run('expired-probe-'+i,'net:198.18.'+i+'.0/24',START-INDEX_PROBE_BACKOFF_MS-i,START-i);
  insert.run('live-probe','net:203.0.113.0/24',START,START+INDEX_PROBE_BACKOFF_MS);
}
async function scheduled(w,env=w.env){const tasks=[];
  await w.worker.scheduled({scheduledTime:START,cron:'*/15 * * * *'},env,{waitUntil:p=>tasks.push(p)});
  const results=await Promise.allSettled(tasks);assert.ok(results.every(r=>r.status==='fulfilled'),'independent cron promises all settle safely');return results;}

test('AUD4-03/04 probe cron: each run deletes at most 200 expired markers, retains live backoff, and does not change member/admitted rows',async()=>{
  const w=setup(),{b}=await signed(w);await bootstrap(b);const before=view(w);seedProbes(w,450);
  w.db.raw.prepare('INSERT INTO index_lanes(net,sub,at) VALUES(?,NULL,?)').run('net:192.0.2.0/24',START);
  const logs=[],saved=console.log;console.log=(...args)=>logs.push(args.join(' '));
  try{
    await scheduled(w);assert.equal(count(w,'index_lane_probes'),251);assert.equal(count(w,'index_lanes'),1);assert.deepEqual(view(w),before);
    await scheduled(w);assert.equal(count(w,'index_lane_probes'),51);
    await scheduled(w);assert.equal(count(w,'index_lane_probes'),1);
  }finally{console.log=saved;}
  assert.ok(logs.some(x=>x==='index_probe_cleanup {"status":"cleaned","deleted":200}'));
  assert.equal(w.db.raw.prepare('SELECT scope_key FROM index_lane_probes').get().scope_key,'live-probe');
  const plan=w.db.raw.prepare('EXPLAIN QUERY PLAN '+INDEX_PROBE_PRUNE).all(START,200).map(r=>r.detail).join('\n');
  assert.match(plan,/index_lane_probes_expiry/);assert.doesNotMatch(plan,/SCAN index_lane_probes(?:$|\s)/);
});

test('AUD4-03/04 probe cleanup remains independent when either probe or M1 hardening schema is missing',async()=>{
  const w=setup(),{b}=await signed(w);await bootstrap(b);seedExpired(w,3);seedProbes(w,3);
  w.db.raw.exec('DROP TRIGGER profile_requests_write_budget; DROP INDEX profile_requests_expiry; DROP INDEX profile_history_expiry;');
  const logs=[],saved=console.log;console.log=(...args)=>logs.push(args.join(' '));
  try{
    await scheduled(w);assert.equal(count(w,'index_lane_probes'),1);assert.equal(count(w,'profile_requests'),3);assert.equal(count(w,'profile_history'),3);
    const other=setup(),s=await signed(other);await bootstrap(s.b);seedExpired(other,3);other.db.raw.exec('DROP TABLE index_lane_probes;');
    await scheduled(other);assert.equal(count(other,'profile_requests'),0);assert.equal(count(other,'profile_history'),0);
    assert.deepEqual(await pruneIndexProbes(other.db,START),{status:'schema_unavailable'});
    const noIndex=setup();seedProbes(noIndex,3);noIndex.db.raw.exec('DROP INDEX index_lane_probes_expiry;');
    assert.deepEqual(await pruneIndexProbes(noIndex.db,START),{status:'schema_unavailable'});assert.equal(count(noIndex,'index_lane_probes'),4);
    const noAdmissionIndex=setup();seedProbes(noAdmissionIndex,3);noAdmissionIndex.db.raw.exec('DROP INDEX index_lane_probes_net;');
    assert.deepEqual(await pruneIndexProbes(noAdmissionIndex.db,START),{status:'cleaned',deleted:3},'cron needs only its own expiry index');
  }finally{console.log=saved;}
  assert.ok(logs.some(x=>x==='member_cleanup {"status":"schema_unavailable"}'));
  assert.ok(logs.some(x=>x==='index_probe_cleanup {"status":"schema_unavailable"}'));
});

test('AUD4-03/04 probe cleanup caps oversized/non-finite limits and supports the two-row opportunistic bound',async()=>{
  for(const limit of [999999,Infinity,NaN]){
    const w=setup();seedProbes(w,250);const r=await pruneIndexProbes(w.db,START,limit);
    assert.deepEqual(r,{status:'cleaned',deleted:INDEX_PROBE_CRON_PRUNE});assert.equal(count(w,'index_lane_probes'),51);
  }
  const w=setup();seedProbes(w,5);
  assert.deepEqual(await pruneIndexProbes(w.db,START,INDEX_PROBE_OPPORTUNISTIC_PRUNE),{status:'cleaned',deleted:2});
  assert.equal(count(w,'index_lane_probes'),4);assert.equal(INDEX_PROBE_CRON_PRUNE,200);assert.equal(INDEX_PROBE_OPPORTUNISTIC_PRUNE,2);
  for(const limit of [-1,0,0.5]){
    assert.deepEqual(await pruneIndexProbes(w.db,START,limit),{status:'cleaned',deleted:0});assert.equal(count(w,'index_lane_probes'),4);
  }
});

test('AUD4-03/04 probe prune storage failure cannot cancel member cleanup or expose SQL/secret log text',async()=>{
  const w=setup(),{b}=await signed(w);await bootstrap(b);seedExpired(w,3);seedProbes(w,3);
  const db={...w.db,prepare:sql=>{
    const st=w.db.prepare(sql),wrap=s=>({...s,bind:(...args)=>wrap(s.bind(...args)),run:async()=>{
      if(sql===INDEX_PROBE_PRUNE)throw new Error('private SQL '+aSafeSecret());return s.run();}});return wrap(st);
  }},logs=[],saved=console.log;console.log=(...args)=>logs.push(args.join(' '));
  try{await scheduled(w,{...w.env,DB:db});}finally{console.log=saved;}
  assert.equal(count(w,'profile_requests'),0);assert.equal(count(w,'profile_history'),0);assert.equal(count(w,'index_lane_probes'),4);
  assert.ok(logs.some(x=>x==='index_probe_cleanup {"status":"unavailable"}'));
  assert.ok(!logs.some(x=>x.includes('private SQL')||x.includes(aSafeSecret())));
});

for(const n of [6,12,20])test(`AUD4-05: ${n} simultaneous distinct valid refusal attempts commit exactly five quota rows`,async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),before=view(w);
  const responses=await Promise.all(Array.from({length:n},()=>put(b,payload(me))));
  assert.equal(responses.filter(r=>r.status===409).length,5);
  assert.equal(responses.filter(r=>r.status===429).length,n-5);
  for(const r of responses.filter(r=>r.status===429)){
    assert.deepEqual(await json(r),{error:'NAME_RATE_LIMITED',retryAfterSeconds:60});assert.equal(r.headers.get('Retry-After'),'60');
  }
  assert.equal(count(w,'profile_requests'),5);assert.deepEqual(view(w),before);assert.equal(count(w,'profile_history'),0);
});

test('AUD4-05: success, stale version, cooldown, locked and unavailable refusals share one rolling budget',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b);
  const successful=await put(b,payload(me,'FirstName'));assert.equal(successful.status,200);const current=await json(successful);
  assert.equal((await put(b,payload(me,'OldForm'))).status,409);
  assert.equal((await put(b,payload(current,'TooSoon'))).status,409);
  w.db.raw.prepare("UPDATE member_profiles SET profile_state='locked'").run();
  assert.equal((await put(b,payload(current,'Locked'))).status,403);
  w.db.raw.prepare("UPDATE member_profiles SET profile_state='needs_rename',next_name_change_at=NULL").run();
  assert.equal((await put(b,payload(current))).status,409);
  const sixth=await put(b,payload(current,'NextName'));assert.equal(sixth.status,429);
  assert.equal(count(w,'profile_requests'),5);assert.equal(view(w).version,1);assert.equal(count(w,'profile_history'),1);
  w.clock.advance(MIN);assert.equal((await put(b,payload(current,'NextName'))).status,200,'exact minute boundary opens a slot');
});

for(const n of [6,12,20])test(`AUD4-05: ${n} parallel fresh names cannot overspend while optimistic-version batches race`,async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b);
  const rs=await Promise.all(Array.from({length:n},(_,i)=>put(b,payload(me,'FreshName'+i))));
  assert.equal(rs.filter(r=>r.status===200).length,1);assert.equal(rs.filter(r=>r.status===409).length,4);assert.equal(rs.filter(r=>r.status===429).length,n-5);
  assert.equal(count(w,'profile_requests'),5);assert.equal(count(w,'profile_history'),1);assert.equal(view(w).version,1);
  assert.equal(w.db.raw.prepare("SELECT count(*) n FROM nickname_claims WHERE claim_type='active'").get().n,1);
});

test('AUD4-05: concurrent same key/payload has one mutation and slot; retry works at a full budget',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),p=payload(me,'SameName','same-key-0001');
  const responses=await Promise.all(Array.from({length:20},()=>put(b,p)));
  assert.ok(responses.every(r=>r.status===200));assert.equal(count(w,'profile_requests'),1);
  assert.equal(view(w).version,1);assert.equal(count(w,'profile_history'),1);
  for(let i=0;i<4;i++)assert.equal((await put(b,payload(me,'StaleName'))).status,409);
  assert.equal((await put(b,p)).status,200);assert.equal(count(w,'profile_requests'),5);
  assert.equal((await put(b,{...p,displayName:'OtherName'})).status,409);
  assert.equal((await put(b,payload(me))).status,429);
});

test('AUD4-05: concurrent same new key/different payload returns the committed winner even for INSERT OR IGNORE refusals',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),key='collision-0001';
  const requests=Array.from({length:12},(_,i)=>payload(me,i%2?'administrator':'admin',key));
  const responses=await Promise.all(requests.map(p=>put(b,p)));
  const row=w.db.raw.prepare('SELECT outcome FROM profile_requests').get();assert.equal(row.outcome,'NAME_UNAVAILABLE');
  assert.equal(count(w,'profile_requests'),1);assert.equal(responses.filter(r=>r.status===409).length,12);
  const errors=await Promise.all(responses.map(json));
  assert.equal(errors.filter(x=>x.error==='NAME_UNAVAILABLE').length,6);
  assert.equal(errors.filter(x=>x.error==='IDEMPOTENCY_CONFLICT').length,6);
  assert.equal(view(w).version,0);assert.equal(count(w,'profile_history'),0);
});

test('AUD4-05: same-key success vs refusal cannot return an uncommitted local answer',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),key='mixed-key-0001';
  const [a,c]=await Promise.all([put(b,payload(me,'WinnerName',key)),put(b,payload(me,'admin',key))]);
  const row=w.db.raw.prepare('SELECT outcome FROM profile_requests').get();assert.equal(count(w,'profile_requests'),1);
  const results=await Promise.all([json(a),json(c)]);
  assert.ok(results.some(r=>r.error==='IDEMPOTENCY_CONFLICT'));
  if(row.outcome==='ok'){assert.ok([a,c].some(r=>r.status===200));assert.equal(view(w).version,1);assert.equal(count(w,'profile_history'),1);}
  else {assert.ok(results.some(r=>r.error==='NAME_UNAVAILABLE'));assert.equal(view(w).version,0);assert.equal(count(w,'profile_history'),0);}
});

test('AUD4-05: same-name no-op spends a fresh slot but never changes version, cooldown or history',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b);const named=await json(await put(b,payload(me,'NoOpName'))),before=view(w);
  const ps=Array.from({length:6},()=>payload(named,'NoOpName'));
  const rs=await Promise.all(ps.map(p=>put(b,p)));assert.equal(rs.filter(r=>r.status===200).length,4);assert.equal(rs.filter(r=>r.status===429).length,2);
  assert.equal(count(w,'profile_requests'),5);assert.deepEqual(view(w),before);assert.equal(count(w,'profile_history'),1);
  const winner=rs.findIndex(r=>r.status===200);assert.equal((await put(b,ps[winner])).status,200);assert.equal(count(w,'profile_requests'),5);
});

test('AUD4-05: a no-op observed before moderation cannot be recorded as successful after its atomic guard fails',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),named=await json(await put(b,payload(me,'NoOpGuard')));
  let inject=true;
  const undo=substitute(w,db=>({...db,prepare:sql=>{
    const st=db.prepare(sql),wrap=s=>({...s,bind:(...args)=>wrap(s.bind(...args)),run:async()=>{
      if(inject&&sql.includes("AND profile_state='ready' AND display_name=?5")){
        inject=false;w.db.raw.prepare("UPDATE member_profiles SET profile_state='needs_rename',version=version+1,display_name='Moderated',active_name_key=NULL").run();
      }
      return s.run();
    }});return wrap(st);
  }}));
  const p=payload(named,'NoOpGuard','noop-stale-0001'),r=await put(b,p);undo();
  assert.equal(r.status,409);assert.deepEqual(await json(r),{error:'PROFILE_VERSION_CONFLICT'});
  assert.equal(w.db.raw.prepare('SELECT outcome FROM profile_requests WHERE request_id=?').get(p.requestId).outcome,'PROFILE_VERSION_CONFLICT');
  assert.equal(view(w).version,2);assert.equal(view(w).display_name,'Moderated');assert.equal(count(w,'profile_history'),1);
});

test('AUD4-05: per-member quotas remain independent while the existing per-IP cap still applies',async()=>{
  const w=setup(),s1=await signed(w,newAccount(),'203.0.113.10'),s2=await signed(w,newAccount(),'203.0.113.10');
  const m1=await bootstrap(s1.b),m2=await bootstrap(s2.b);
  for(const [b,m] of [[s1.b,m1],[s2.b,m2]]){
    const rs=await Promise.all(Array.from({length:6},()=>put(b,payload(m))));assert.equal(rs.filter(r=>r.status===409).length,5);assert.equal(rs.filter(r=>r.status===429).length,1);
  }
  assert.equal(count(w,'profile_requests'),10);
  w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  for(let i=0;i<20;i++)assert.equal((await s1.b.post('/api/me/bootstrap')).status,200);
  assert.equal((await s2.b.post('/api/me/bootstrap')).status,429);
  const otherIp=w.browser(undefined,undefined,'198.51.100.10');otherIp.jar=new Map(s2.b.jar);assert.equal((await otherIp.post('/api/me/bootstrap')).status,200);
});

test('AUD4-05: rolled-back success guard cannot hide quota refusal in fallback outcome recording',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),member=mid(w);
  for(let i=0;i<4;i++)await put(b,payload(me));
  let inject=true;
  const undo=substitute(w,db=>({...db,batch:async statements=>{
    if(inject&&statements[0]?.sql.includes("'ok'")){
      inject=false;w.db.raw.prepare('UPDATE member_profiles SET version=1').run();
      try{return await db.batch(statements);}catch(error){addRequest(w,member,'intervening-0001',START);throw error;}
    }
    return db.batch(statements);
  }}));
  const r=await put(b,payload(me,'GuardedName'));undo();assert.equal(r.status,429);assert.equal((await json(r)).error,'NAME_RATE_LIMITED');
  assert.equal(count(w,'profile_requests'),5);assert.equal(count(w,'profile_history'),0);assert.equal(view(w).display_name,null);
});

test('AUD4-05: storage failure recording a refusal answers 503 and cannot falsely claim it was recorded',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b);
  const undo=substitute(w,db=>({...db,prepare:sql=>{
    const st=db.prepare(sql);const wrap=s=>({...s,bind:(...args)=>wrap(s.bind(...args)),run:async()=>{
      if(sql.startsWith('INSERT OR IGNORE INTO profile_requests'))throw new Error('simulated unavailable storage');return s.run();}});return wrap(st);
  }}));
  const r=await put(b,payload(me));undo();assert.equal(r.status,503);assert.deepEqual(await json(r),{error:'PROFILE_UNAVAILABLE'});assert.equal(count(w,'profile_requests'),0);
});

test('AUD4-04: indexed cleanup has a per-table hard bound, drains backlog, preserves unexpired retries/current profile',async()=>{
  const w=setup(),{b}=await signed(w),me=await bootstrap(b),before=view(w);seedExpired(w,450);
  const kept=payload(me,'admin','retained-key-0001');assert.equal((await put(b,kept)).status,409,'opportunistic cleanup also drains ten rows per table');
  assert.equal(count(w,'profile_requests'),441);assert.equal(count(w,'profile_history'),440);
  const result=await pruneMemberRecords(w.db,START,999999);assert.deepEqual(result,{status:'cleaned',requests:MEMBER_CLEANUP_MAX_ROWS,history:MEMBER_CLEANUP_MAX_ROWS});
  assert.equal(count(w,'profile_requests'),241);assert.equal(count(w,'profile_history'),240);
  const query=w.db.raw.prepare('EXPLAIN QUERY PLAN SELECT rowid FROM profile_requests INDEXED BY profile_requests_expiry WHERE expires_at<=? ORDER BY expires_at,member_id,request_id LIMIT ?').all(START,200);
  assert.ok(query.some(x=>x.detail.includes('profile_requests_expiry')));
  await pruneMemberRecords(w.db,START);await pruneMemberRecords(w.db,START);
  assert.equal(count(w,'profile_requests'),1);assert.equal(count(w,'profile_history'),0);assert.deepEqual(view(w),before);
  assert.equal((await put(b,kept)).status,409);assert.equal(count(w,'profile_requests'),1,'retained idempotency row survives');
});

test('AUD4-04: a member who never renames still gets cron cleanup; no DB skips and failures reveal no raw errors',async()=>{
  const w=setup(),{b}=await signed(w);await bootstrap(b);seedExpired(w,3);const before=view(w),logs=[],saved=console.log;
  console.log=(...args)=>logs.push(args.join(' '));
  try{
    await w.worker.scheduled({scheduledTime:START,cron:'*/15 * * * *'},w.env,{waitUntil:p=>w.kept.push(p)});await Promise.all(w.kept);
    assert.equal(count(w,'profile_requests'),0);assert.equal(count(w,'profile_history'),0);assert.deepEqual(view(w),before);
    let waited=0;await w.worker.scheduled({scheduledTime:START,cron:'*/15 * * * *'},{...w.env,DB:undefined},{waitUntil:()=>waited++});assert.equal(waited,0);
    const failed={...w.env,DB:{...w.db,batch:async()=>{throw new Error('secret raw SQL error '+aSafeSecret());}}},tasks=[];
    await w.worker.scheduled({scheduledTime:START,cron:'*/15 * * * *'},failed,{waitUntil:p=>tasks.push(p)});
    await Promise.allSettled(tasks);
  }finally{console.log=saved;}
  assert.ok(logs.some(x=>x==='member_cleanup {"status":"cleaned","requests":3,"history":3}'));
  assert.ok(logs.some(x=>x==='member_cleanup {"status":"unavailable"}'));assert.ok(!logs.some(x=>x.includes('secret raw SQL')||x.includes(aSafeSecret())));
  assert.equal(MEMBER_CLEANUP_OPPORTUNISTIC_ROWS,10);
});
