import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,fakeImd,START} from './wallet-harness.mjs';
import {ReadGateway} from '../server/gateway.ts';
import {recordPresence,PRUNE_CHALLENGES,PRUNE_SESSIONS} from '../server/presence.ts';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {DatabaseSync} from 'node:sqlite';
// The presence recorder runs the real migration SQL (node:sqlite) through the Worker's scheduled handler, fed by a fake
// api.imd.fun. It must write only from a complete roster, keep the newest sighting, and fit easily in the CPU cap.
const MIN=60_000,DAY=86_400_000;
const rows=db=>db.raw.prepare('SELECT token_id,owner,last_online_at,updated_at FROM seat_presence ORDER BY token_id').all().map(r=>({...r}));
async function cron(w){const kept=[];await w.worker.scheduled({scheduledTime:w.clock.now(),cron:'*/15 * * * *'},w.env,{waitUntil:p=>kept.push(p)});await Promise.all(kept);}
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const owners=map=>Object.assign(Array(2000).fill(null),map);

test('migrations: numbered files, applied in order, creating the three tables and the sign-in budget columns and indexes',()=>{
  assert.deepEqual(migrationFiles(),['0001_wallet_login.sql','0002_sign_in_budgets.sql']);
  const db=openD1(),tables=db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
  assert.deepEqual(tables,['login_challenges','seat_presence','sessions']);
  const indexes=t=>db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(t).map(r=>r.name);
  assert.deepEqual(indexes('login_challenges'),['login_challenges_flow','login_challenges_issued','login_challenges_net']);
  assert.deepEqual(indexes('sessions'),['sessions_address','sessions_expires']);
});

test('0002 is additive: on a live 0001 database every row stays as it was, new columns are empty, and the old code’s writes still work',()=>{
  const db=new DatabaseSync(':memory:'),file=f=>readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8');
  db.exec(file('0001_wallet_login.sql'));
  const oldInsert="INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until) VALUES(?,'a','o','f','m',1,2)";
  db.prepare(oldInsert).run('n');
  db.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) VALUES('h','a',1,1,2,'n')").run();
  db.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(1,null,1,1)').run();
  const dump=()=>[db.prepare('SELECT nonce,address,origin,flow_hash,message,issued_at,accept_until,used_at,invalidated_at,session_hash FROM login_challenges').all(),
    db.prepare('SELECT * FROM sessions').all(),db.prepare('SELECT * FROM seat_presence').all()].map(rows=>rows.map(r=>({...r})));
  const before=dump();db.exec(file('0002_sign_in_budgets.sql'));
  assert.deepEqual(dump(),before);assert.deepEqual({...db.prepare('SELECT net,checked_at FROM login_challenges').get()},{net:null,checked_at:null});
  db.prepare(oldInsert).run('n2');assert.equal(db.prepare('SELECT count(*) n FROM login_challenges').get().n,2,'the deployed code (before 0002) keeps inserting');
});

test('a complete roster records every listed seat at the roster time, with the swarm owner; nothing else is touched',async()=>{
  const w=setup({imd:fakeImd({seats:{1:'10',2:'20',3:'30'},owners:owners({1:A,2:B}),online:[1,2]})});
  await cron(w);
  assert.deepEqual(rows(w.db),[{token_id:1,owner:A,last_online_at:START,updated_at:START},{token_id:2,owner:B,last_online_at:START,updated_at:START}]);
  // 15 minutes later #2 is gone and #3 came online: #2 keeps its last sighting, #3 is added, #1 moves forward.
  w.clock.advance(15*MIN);w.imd.state.online=[1,3];
  await cron(w);
  const t=START+15*MIN;
  assert.deepEqual(rows(w.db).map(r=>[r.token_id,r.last_online_at]),[[1,t],[2,START],[3,t]]);
  assert.equal(rows(w.db)[2].owner,null);
});

test('a partial, failed or stale roster writes nothing (never "offline"), but housekeeping still runs',async()=>{
  const w=setup({imd:fakeImd({seats:{1:'10',2:'20'},owners:owners({1:A}),online:[1,2]})});
  await cron(w);const before=rows(w.db);
  w.clock.advance(15*MIN);w.imd.state.online=[1];w.imd.state.count=5;          // count says 5, one row came back
  await cron(w);assert.deepEqual(rows(w.db),before,'partial roster');
  w.clock.advance(15*MIN);w.imd.state.count=undefined;w.imd.state.fail.add('/workers');
  await cron(w);assert.deepEqual(rows(w.db),before,'failed roster (stale cache)');
  // Housekeeping: used challenges and sessions that ended more than a day ago are deleted, newer ones stay; a challenge
  // never used (expired, superseded or burnt) goes 10 minutes after issue (S3).
  const now=w.clock.now(),ins=(n,issued,used=null,invalidated=null)=>w.db.raw.prepare("INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,used_at,invalidated_at) VALUES(?,'a','o','f','m',?,?,?,?)")
    .run(n,issued,issued+5*MIN,used,invalidated);
  ins('old',now-DAY-5*MIN-1,now-DAY-5*MIN);ins('recent',now-DAY-4*MIN,now-DAY-4*MIN);
  ins('unused-11m',now-11*MIN);ins('burnt-11m',now-11*MIN,null,now-11*MIN);ins('unused-10m',now-10*MIN);ins('unused-9m',now-9*MIN);ins('burnt-1m',now-MIN,null,now-MIN);
  w.db.raw.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) VALUES('h1','a',1,0,?,'old'),('h2','a',1,0,?,'recent')").run(now-DAY-1,now-MIN);
  await cron(w);
  assert.deepEqual(w.db.raw.prepare('SELECT nonce FROM login_challenges ORDER BY issued_at').all().map(r=>r.nonce),['recent','unused-10m','unused-9m','burnt-1m']);
  assert.deepEqual(w.db.raw.prepare('SELECT nonce FROM sessions').all().map(r=>r.nonce),['recent']);
  // L3: both prunes are range reads of an index (migrations/0002), never a scan of the table.
  const plan=sql=>w.db.raw.prepare('EXPLAIN QUERY PLAN '+sql).all(...(sql.includes('?2')?[1,2]:[1])).map(r=>r.detail).join(' | ');
  assert.match(plan(PRUNE_CHALLENGES),/^SEARCH login_challenges USING INDEX login_challenges_issued \(issued_at<\?\)$/,plan(PRUNE_CHALLENGES));
  assert.match(plan(PRUNE_SESSIONS),/^SEARCH sessions USING INDEX sessions_expires \(expires_at<\?\)$/,plan(PRUNE_SESSIONS));
});

test('an older (edge-cached) roster never moves a sighting backwards; an unknown owner keeps the last known one',async()=>{
  const db=openD1(),w=setup({imd:fakeImd({seats:{1:'10'},owners:owners({1:A}),online:[1]})});
  await recordPresence(w.gateway,db,START);
  db.raw.prepare('UPDATE seat_presence SET last_online_at=?').run(START+MIN);
  w.imd.state.fail.add('/swarm');
  const g=new ReadGateway(w.imd.fetcher,()=>START+2*MIN);      // a fresh isolate: swarm unavailable, workers fine
  await recordPresence(g,db,START+2*MIN);
  assert.deepEqual(rows(db),[{token_id:1,owner:A,last_online_at:START+2*MIN,updated_at:START+2*MIN}]);
  db.raw.prepare('UPDATE seat_presence SET last_online_at=?').run(START+10*MIN);
  await recordPresence(g,db,START+3*MIN);
  assert.equal(rows(db)[0].last_online_at,START+10*MIN);
});

test('an edge-cached roster is dated by its Age, not by the time the cron read it',async()=>{
  const w=setup({imd:fakeImd({seats:{1:'10'},owners:owners({}),online:[1]})});w.imd.state.age=240;
  await cron(w);
  assert.deepEqual(rows(w.db).map(r=>[r.last_online_at,r.updated_at]),[[START-240_000,START]]);
});

test('no database: the cron does nothing and makes no upstream read',async()=>{
  const w=setup(),env={...w.env};delete env.DB;const kept=[];
  await w.worker.scheduled({scheduledTime:0,cron:'*/15 * * * *'},env,{waitUntil:p=>kept.push(p)});
  assert.equal(kept.length,0);assert.equal(w.imd.state.calls,0);
});

// CPU: a production-sized roster (430 rows, ~460 KB, like /workers on 2026-09-27) and the real 2026-09-27 swarm,
// parsed and recorded end to end in a fresh gateway. Wall time on in-memory SQLite bounds the CPU the cron spends.
test('recording a production-sized roster costs a few ms, far below the 50 ms CPU cap',async()=>{
  const swarm=JSON.parse(readFileSync(new URL('./fixtures/swarm-2026-09-27.json',import.meta.url),'utf8'));
  const ids=Object.keys(swarm.seats).slice(0,430),pad='x'.repeat(700);
  const workers={count:ids.length,workers:ids.map(id=>({deviceKey:pad,seat:{tokenId:id,agentId:swarm.seats[id].agentId},working:0,paused:false,daemonVersion:'1.4.2',
    runtimes:[{id:'codex',premiumModel:{model:'gpt-5'}},{id:'claude'}],platform:'linux',connectedAt:'2026-09-27T00:00:00Z',lastHeartbeatAt:'2026-09-27T12:00:00Z'}))};
  const text={'/swarm':JSON.stringify(swarm),'/workers':JSON.stringify(workers)};
  assert.ok(text['/workers'].length>400_000,'roster body '+text['/workers'].length);
  const fetcher=async url=>new Response(text[String(url).replace('https://api.imd.fun','')]??'{}',{headers:{'content-type':'application/json'}});
  const times=[];
  for(let i=0;i<5;i++){
    const db=openD1(),g=new ReadGateway(fetcher,()=>START),t=performance.now();
    const run=await recordPresence(g,db,START);times.push(performance.now()-t);
    assert.equal(run.written,430);assert.equal(db.raw.prepare('SELECT count(*) n FROM seat_presence').get().n,430);
  }
  console.log('presence run (parse 2 bodies + derive + 1 upsert):',times.map(t=>t.toFixed(1)).join(' / '),'ms');
  assert.ok(Math.min(...times)<25,'presence run '+Math.min(...times)+' ms');
});
