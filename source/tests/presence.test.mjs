import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setup,fakeImd,START} from './wallet-harness.mjs';
import {ReadGateway} from '../server/gateway.ts';
import {recordPresence,PRUNE_CHALLENGES,PRUNE_SESSIONS,PRUNE_INDEX_LANES} from '../server/presence.ts';
import {INSERT_CHALLENGE,INSERT_CHALLENGE_0004,CLAIM_ERC1271_0004,CLAIM_CONTRACT_0004,CLAIM_LANE_0004} from '../server/auth.ts';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {DatabaseSync} from 'node:sqlite';
// The presence recorder runs the real migration SQL (node:sqlite) through the Worker's scheduled handler, fed by a fake
// api.imd.fun. It must write only from a complete roster, keep the newest sighting, and fit easily in the CPU cap.
const MIN=60_000,DAY=86_400_000;
const rows=db=>db.raw.prepare('SELECT token_id,owner,last_online_at,updated_at FROM seat_presence ORDER BY token_id').all().map(r=>({...r}));
async function cron(w){const kept=[];await w.worker.scheduled({scheduledTime:w.clock.now(),cron:'*/15 * * * *'},w.env,{waitUntil:p=>kept.push(p)});await Promise.all(kept);}
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40);
const owners=map=>Object.assign(Array(2000).fill(null),map);

test('migrations: numbered files, applied in order, creating the tables and the sign-in budget columns and indexes',()=>{
  assert.deepEqual(migrationFiles(),['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql','0004_index_candidates.sql','0005_lanes_and_subnets.sql','0006_members.sql']);
  const db=openD1(),tables=db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
  assert.deepEqual(tables,['economy_accounts','index_candidates','index_lanes','life_state','login_challenges','member_profiles','members','nickname_claims','profile_history','profile_requests',
    'seat_presence','sessions','wallet_identities']);
  const indexes=t=>db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(t).map(r=>r.name);
  assert.deepEqual(indexes('login_challenges'),['login_challenges_address','login_challenges_called_address','login_challenges_called_net','login_challenges_flow','login_challenges_issued','login_challenges_net']);
  assert.deepEqual(indexes('sessions'),['sessions_address','sessions_erc1271','sessions_expires','sessions_live']);
  assert.deepEqual(indexes('index_lanes'),['index_lanes_at','index_lanes_net']);
  assert.deepEqual(indexes('nickname_claims'),['nickname_claims_member','nickname_claims_one_active']);
  assert.deepEqual(indexes('profile_requests'),['profile_requests_recent']);assert.deepEqual(indexes('profile_history'),['profile_history_member']);
  assert.deepEqual(db.raw.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid').all('login_challenges').map(r=>r.name).slice(-2),['sub','called_via']);
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

test('0003 is additive: on a live 0002 database every row stays as it was, the new columns are empty, and the old code’s writes still work',()=>{
  const db=new DatabaseSync(':memory:'),file=f=>readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8');
  db.exec(file('0001_wallet_login.sql'));db.exec(file('0002_sign_in_budgets.sql'));
  db.prepare("INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net,checked_at) VALUES('n','a','o','f','m',1,2,'net:x',1)").run();
  const oldSession="INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) SELECT ?,address,1,1,2,? FROM login_challenges WHERE nonce='n'";
  db.prepare(oldSession).run('h','n');
  const dump=()=>[db.prepare('SELECT nonce,address,origin,flow_hash,message,issued_at,accept_until,used_at,invalidated_at,session_hash,net,checked_at FROM login_challenges').all(),
    db.prepare('SELECT token_hash,address,chain_id,created_at,expires_at,revoked_at,nonce FROM sessions').all()].map(rows=>rows.map(r=>({...r})));
  const before=dump();db.exec(file('0003_sign_in_layers.sql'));
  assert.deepEqual(dump(),before);assert.deepEqual({...db.prepare('SELECT wallet_type,verification_method FROM sessions').get()},{wallet_type:null,verification_method:null});
  assert.equal(db.prepare('SELECT called_at FROM login_challenges').get().called_at,null);
  db.prepare(oldSession).run('h2','n2');assert.equal(db.prepare('SELECT count(*) n FROM sessions').get().n,2,'the deployed code (before 0003) keeps inserting sessions');
});

test('0004 is additive: on a live 0003 database every row of every table stays as it was, and index_candidates starts empty',()=>{
  const db=new DatabaseSync(':memory:'),file=f=>readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8');
  for(const f of ['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql'])db.exec(file(f));
  db.prepare("INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net,checked_at,called_at) VALUES('n','a','o','f','m',1,2,'net:x',1,1)").run();
  db.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES('h','a',1,1,2,'n','EOA','ECDSA')").run();
  db.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(1,null,1,1)').run();
  const dump=()=>['login_challenges','sessions','seat_presence'].map(t=>db.prepare('SELECT * FROM '+t).all().map(r=>({...r})));
  const before=dump();db.exec(file('0004_index_candidates.sql'));
  assert.deepEqual(dump(),before);assert.equal(db.prepare('SELECT count(*) n FROM index_candidates').get().n,0);
});

test('0005 is additive: on a live 0004 database every row of every table stays as it was, the new columns are empty, index_lanes starts empty, and the 0004 statements still run',()=>{
  const db=new DatabaseSync(':memory:'),file=f=>readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8');
  for(const f of ['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql','0004_index_candidates.sql'])db.exec(file(f));
  db.prepare("INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net,checked_at,called_at) VALUES('n','a','o','f','m',1,2,'net6:2001:db8:1::/48',1,1)").run();
  db.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES('h','a',1,1,2,'n','CONTRACT','ERC1271')").run();
  db.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(1,null,1,1)').run();
  db.prepare("INSERT INTO index_candidates(address,ids,read_at) VALUES('a','[\"1\"]',1)").run();
  const dump=()=>['login_challenges','sessions','seat_presence','index_candidates'].map(t=>db.prepare('SELECT * FROM '+t).all().map(({sub,called_via,...r})=>r));
  const before=dump();db.exec(file('0005_lanes_and_subnets.sql'));
  assert.deepEqual(dump(),before);assert.deepEqual({...db.prepare('SELECT sub,called_via FROM login_challenges').get()},{sub:null,called_via:null});
  assert.equal(db.prepare('SELECT count(*) n FROM index_lanes').get().n,0);
  // Code deployed before 0005 keeps working on it: its challenge INSERT and its three ERC-1271 claims.
  const t=100_000,changed=(sql,...v)=>Number(db.prepare(sql).run(...v).changes);
  assert.deepEqual([changed(INSERT_CHALLENGE_0004,'n2','b','o','f','m',t,t+1,'net:x',t-60_000,30,t-6_000,60,20),changed(INSERT_CHALLENGE_0004,'n3','c','o','f','m',t,t+1,'net:x',t-60_000,30,t-6_000,60,20),
    changed(CLAIM_ERC1271_0004,t,'n2','net:x',t-360_000,t-60_000,10,0),changed(CLAIM_CONTRACT_0004,t,'n2','net:x',t-60_000,3,'b',2),
    changed(CLAIM_ERC1271_0004,t,'n3','net:x',t-360_000,t-60_000,10,0),changed(CLAIM_LANE_0004,t,'n3','net:x',t-60_000,3,'c')],[1,1,1,1,1,1]);
});

test('0006 is additive: on a live 0005 database every row of every table stays as it was, the new tables start empty but for the seven system names, and the 0005 statements still run',()=>{
  const db=new DatabaseSync(':memory:'),file=f=>readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8');
  for(const f of ['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql','0004_index_candidates.sql','0005_lanes_and_subnets.sql'])db.exec(file(f));
  db.prepare("INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net,checked_at,called_at,sub,called_via) VALUES('n','a','o','f','m',1,2,'net:x',1,1,null,'pool')").run();
  db.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES('h','a',1,1,2,'n','EOA','ECDSA')").run();
  db.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(1,null,1,1)').run();
  db.prepare("INSERT INTO index_candidates(address,ids,read_at) VALUES('a','[\"1\"]',1)").run();
  db.prepare("INSERT INTO index_lanes(net,sub,at) VALUES('net:x',null,1)").run();
  const old=['login_challenges','sessions','seat_presence','index_candidates','index_lanes'],dump=()=>old.map(t=>db.prepare('SELECT * FROM '+t).all().map(r=>({...r})));
  const columns=()=>old.map(t=>db.prepare('SELECT name FROM pragma_table_info(?)').all(t).map(r=>r.name));
  const before=dump(),cols=columns();db.exec(file('0006_members.sql'));
  assert.deepEqual(dump(),before);assert.deepEqual(columns(),cols,'no column added to an existing table');
  for(const t of ['members','wallet_identities','member_profiles','profile_requests','profile_history','economy_accounts','life_state'])assert.equal(db.prepare('SELECT count(*) n FROM '+t).get().n,0,t);
  assert.deepEqual(db.prepare("SELECT claim_type,count(*) n FROM nickname_claims GROUP BY claim_type").all().map(r=>({...r})),[{claim_type:'system',n:7}]);
  const t=100_000,changed=(sql,...v)=>Number(db.prepare(sql).run(...v).changes);
  assert.equal(changed(INSERT_CHALLENGE,'n2','b','o','f','m',t,t+1,'net:x',t-60_000,30,t-6_000,60,20,null),1,'the current challenge INSERT');
});

// A-2 (Swarm audit 519db624), across instances: the NFT-index answers kept in D1 (server/ownership.ts) are deleted by the
// cron 8 days after the index read, whatever the roster's state; younger ones stay.
test('A-2: the cron deletes index answers read more than 8 days ago and keeps the rest, with a complete roster or not',async()=>{
  const w=setup({imd:fakeImd({seats:{1:'10'},owners:owners({1:A}),online:[1]})});
  const put=(address,at)=>w.db.raw.prepare('INSERT INTO index_candidates(address,ids,read_at) VALUES(?,?,?)').run(address,'["1"]',at);
  const kept=()=>w.db.raw.prepare('SELECT address FROM index_candidates ORDER BY address').all().map(r=>r.address);
  const C='0x'+'c'.repeat(40),now=w.clock.now();
  put(A,now-8*DAY-1);put(B,now-8*DAY);put(C,now-MIN);
  await cron(w);assert.deepEqual(kept(),[B,C]);assert.equal(rows(w.db).length,1,'the roster was recorded as well');
  w.clock.advance(15*MIN);w.imd.state.fail.add('/workers');                   // no complete roster: housekeeping still runs
  await cron(w);assert.deepEqual(kept(),[C]);
});

// N-6 (Swarm audit 8c3aea2e): an index lane (server/auth.ts INDEX_LANE) counts for a minute; the cron deletes older rows.
test('N-6: the cron deletes index-lane rows older than a minute and keeps the rest, by a range of index_lanes_at; a database before 0005 is left alone',async()=>{
  const w=setup({imd:fakeImd({seats:{1:'10'},owners:owners({1:A}),online:[1]})}),now=w.clock.now();
  for(const [net,at] of [['net:a',now-MIN-1],['net:b',now-MIN],['net6:2001:db8:1::/48',now-1]])w.db.raw.prepare('INSERT INTO index_lanes(net,sub,at) VALUES(?,NULL,?)').run(net,at);
  const run=await recordPresence(w.gateway,w.db,now);
  assert.deepEqual([run.written,run.lanesPruned,w.db.raw.prepare('SELECT net FROM index_lanes ORDER BY at').all().map(r=>r.net)],[1,1,['net:b','net6:2001:db8:1::/48']]);
  assert.match(w.db.raw.prepare('EXPLAIN QUERY PLAN '+PRUNE_INDEX_LANES).all(1).map(r=>r.detail).join(' | '),/^SEARCH index_lanes USING (?:COVERING )?INDEX index_lanes_at \(at<\?\)$/);
  // Before migrations/0005: the prune fails and is ignored; the roster is recorded and the other prunes run.
  const old=openD1(['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql','0004_index_candidates.sql']),before=await recordPresence(w.gateway,old,now);
  assert.deepEqual([before.written,before.indexPruned,before.lanesPruned,old.raw.prepare('SELECT count(*) n FROM seat_presence').get().n],[1,0,null,1]);
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
