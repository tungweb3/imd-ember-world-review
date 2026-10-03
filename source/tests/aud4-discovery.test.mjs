import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain,Browser,windowLimiter} from './wallet-harness.mjs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {INDEX_LANE,INDEX_LANE_READY,INDEX_LANE_BUDGET,INDEX_LANE_WINDOW_MS,INDEX_PROBE,INDEX_PROBE_PRUNE,INDEX_PROBE_BACKOFF_MS,
  CHALLENGE_BUDGET_WINDOW_MS,NETWORK_WINDOW_MS} from '../server/auth.ts';
import {ALCHEMY_NFTS_URL} from '../server/ownership.ts';

// AUD4-03 / R4-09, real Worker + production SQL over node:sqlite. Fake colo-local limiters model two accounting
// assumptions; neither establishes Cloudflare's production scheduling/counting, D1 RETURNING, WAF or browser behavior.
const rows=w=>w.db.raw.prepare('SELECT count(*) n FROM index_lanes').get().n;
const reads=w=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length;
const body=r=>r.clone().json();
const owners=map=>Object.assign(Array(2000).fill('0x'+'0'.repeat(40)),map);
function buyerWorld(){const account=newAccount(),address=account.address.toLowerCase();
  return {account,w:setup({imd:fakeImd({seats:{361:'51320'},owners:owners({361:'0x'+'22'.repeat(20)}),online:[361]}),
    chain:fakeChain({owners:{361:address}})})};}
async function signedIn(w,account,ip,limiter,colo='A'){
  const b=new Browser(request=>{Object.defineProperty(request,'cf',{value:{colo}});
    return w.call(request,limiter?{...w.env,CHAIN_LIMITER:limiter}:w.env);},'https://imdember.com','https://imdember.com',ip);
  assert.equal((await b.signIn(account)).verify.status,200);return b;
}
function localModel(now,{countRefusals=false,limit=20}={}){
  const counted=new Map(),calls=[];
  return {calls,count:key=>(counted.get(key)??[]).filter(at=>at>now()-NETWORK_WINDOW_MS).length,
    async limit({key}){calls.push(key);if(key==='chain:index')return {success:false};
      const recent=(counted.get(key)??[]).filter(at=>at>now()-NETWORK_WINDOW_MS),success=recent.length<limit;
      if(success||countRefusals)recent.push(now());counted.set(key,recent);return {success};}};
}
const laneCalls=limiter=>limiter.calls.filter(k=>k==='chain:index:lane').length;
const openLane=calls=>({limit:async({key})=>{calls.push(key);return {success:key!=='chain:index'};}});

for(const countRefusals of [false,true])test(`AUD4-03 original 80-claim case: ${countRefusals?'denials counted':'denials free'} at A cannot poison B's admitted capacity`,async()=>{
  // Four authenticated EOAs issue 20 home reads each from 80 /24s at A after A's key is already spent. B has its own
  // local key and a legitimate buyer whose new seat the stale roster does not name. No extra signature is requested.
  const {account,w}=buyerWorld(),a=localModel(w.clock.now,{countRefusals}),b=localModel(w.clock.now,{countRefusals}),actors=[];
  for(let k=0;k<20;k++)assert.equal((await a.limit({key:'chain:index:lane'})).success,true);
  for(let k=0;k<4;k++)actors.push(await signedIn(w,newAccount(),'100.64.'+k+'.1',a,'A'));
  const buyer=await signedIn(w,account,'198.51.100.20',b,'B');w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const prepare=w.env.DB.prepare;let preflights=0,reservations=0,updates=0;
  w.env.DB.prepare=sql=>{if(sql===INDEX_LANE_READY)preflights++;if(sql===INDEX_LANE)reservations++;
    if(/^UPDATE index_lanes/.test(sql))updates++;return prepare(sql);};
  const sessionsBefore=w.db.raw.prepare('SELECT count(*) n FROM sessions').get().n;
  for(let k=0;k<80;k++){const r=await actors[Math.floor(k/20)].get('/api/me/home',{headers:{'cf-connecting-ip':'100.70.'+k+'.1'}});
    assert.equal(r.status,200);const h=await body(r);assert.deepEqual([h.seats,h.recheck],[[],'limited']);}
  assert.deepEqual([rows(w),reads(w),preflights,reservations,updates,laneCalls(a),a.count('chain:index:lane')],
    [0,0,80,0,0,100,countRefusals?100:20],'all 80 refusals write zero admitted rows; the two local accounting costs differ');
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM index_lane_probes').get().n,80,'refusals keep independent, expiring probe backoff');
  const r=await buyer.get('/api/me/home'),h=await body(r);
  assert.deepEqual([r.status,h.seats.map(s=>s.tokenId),h.eligible,h.recheck??null,rows(w),reads(w),laneCalls(b),reservations,updates],
    [200,['361'],1,null,1,1,1,1,0]);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions').get().n,sessionsBefore,'discovery creates no auth session');
});

test('AUD4-03 multiple-colo admitted work: 60 reservations fill the global 6 s ceiling; the 61st asks no local key and sends no index read',async()=>{
  const w=setup(),locations=Array.from({length:4},()=>localModel(w.clock.now)),tabs=[];
  for(let k=0;k<62;k++){if(k&&k%30===0)w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);
    tabs.push(await signedIn(w,newAccount(),'100.64.'+k+'.1',locations[Math.floor(k/20)],'C'+Math.floor(k/20)));}
  w.clock.advance(NETWORK_WINDOW_MS);
  for(const b of tabs.slice(0,60)){const r=await b.get('/api/me/home');assert.equal(r.status,200);assert.equal((await body(r)).recheck,undefined);}
  const callsBefore=locations.map(laneCalls),r=await tabs[60].get('/api/me/home');
  assert.deepEqual([r.status,(await body(r)).recheck,rows(w),reads(w),locations.map(laneCalls)],
    [200,'limited',INDEX_LANE_BUDGET,INDEX_LANE_BUDGET,callsBefore]);
  w.clock.advance(INDEX_LANE_WINDOW_MS);
  assert.equal((await body(await tabs[61].get('/api/me/home'))).recheck,undefined);
  assert.deepEqual([rows(w),reads(w),locations.map(laneCalls)],[61,61,[20,20,20,1]]);
});

for(const [label,ips,capacity] of [
  ['one IPv4 /24',['203.0.113.1','203.0.113.2','203.0.113.3','203.0.113.4','203.0.113.5'],1],
  ['one IPv6 /64',['2001:db8:7:1::1','2001:db8:7:1::2','2001:db8:7:1::3','2001:db8:7:1::4','2001:db8:7:1::5'],1],
  ['two IPv6 /48 slots',['2001:db8:7:1::1','2001:db8:7:2::1','2001:db8:7:3::1','2001:db8:7:4::1','2001:db8:7:5::1'],2]
])test(`AUD4-03 raced preflight: ${label} atomically limits probes before any local key is asked`,async()=>{
  // Hold the five advisory preflight results, then release them together. The independent atomic probe statement,
  // not scheduling or the local binding, prevents excess /24,/64,/48 probes before admitted reservation.
  const w=setup(),tabs=[];let release,n=0,preflights=0;const barrier=new Promise(r=>{release=r;});
  const local={limit:async({key})=>{if(key!=='chain:index:lane')return {success:key!=='chain:index'};
    n++;return {success:true};}};
  for(const ip of ips)tabs.push(await signedIn(w,newAccount(),ip,local));
  const prepare=w.env.DB.prepare,held=s=>({...s,bind:(...values)=>held(s.bind(...values)),first:async()=>{
    const result=await s.first();if(++preflights===ips.length)release();await barrier;return result;}});
  w.env.DB.prepare=sql=>sql===INDEX_LANE_READY?held(prepare(sql)):prepare(sql);
  const replies=await Promise.all(tabs.map(async b=>{const r=await b.get('/api/me/home');assert.equal(r.status,200);return body(r);}));
  assert.deepEqual([n,rows(w),reads(w),replies.filter(h=>h.recheck===undefined).length,replies.filter(h=>h.recheck==='limited').length],
    [capacity,capacity,capacity,capacity,ips.length-capacity]);
});

test('AUD4-03 raced global preflight: 61 local successes still produce exactly 60 reservations/index operations',async()=>{
  const w=setup(),tabs=[];let release,n=0;const barrier=new Promise(r=>{release=r;});
  const local={limit:async({key})=>{if(key!=='chain:index:lane')return {success:key!=='chain:index'};
    if(++n===61)release();await barrier;return {success:true};}};
  for(let k=0;k<61;k++){if(k&&k%30===0)w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);
    tabs.push(await signedIn(w,newAccount(),'100.64.'+k+'.1',local));}
  w.clock.advance(NETWORK_WINDOW_MS);
  const replies=await Promise.all(tabs.map(async b=>{const r=await b.get('/api/me/home');assert.equal(r.status,200);return body(r);}));
  assert.deepEqual([n,rows(w),reads(w),replies.filter(h=>h.recheck===undefined).length,replies.filter(h=>h.recheck==='limited').length],
    [61,60,60,60,1]);
});

test('AUD4-03 preflight failure: missing/failing D1 stops before the local key and sends no index read',async()=>{
  const {account,w}=buyerWorld(),keys=[],buyer=await signedIn(w,account,'198.51.100.20',openLane(keys));
  const prepare=w.env.DB.prepare;w.env.DB.prepare=sql=>{if(sql===INDEX_LANE_READY)throw new Error('D1 unavailable');return prepare(sql);};
  const r=await buyer.get('/api/me/home'),h=await body(r);
  assert.deepEqual([r.status,h.recheck,rows(w),reads(w),keys],[200,'limited',0,0,['chain:index']]);
});

test('AUD4-03 slow local admission dates the final reservation with a fresh clock',async()=>{
  const {account,w}=buyerWorld(),t0=w.clock.now();
  const local={limit:async({key})=>{if(key==='chain:index:lane')w.clock.advance(NETWORK_WINDOW_MS);return {success:key!=='chain:index'};}};
  const buyer=await signedIn(w,account,'198.51.100.20',local),r=await buyer.get('/api/me/home');
  assert.equal(r.status,200);assert.equal((await body(r)).eligible,1);
  assert.deepEqual([w.db.raw.prepare('SELECT at FROM index_lanes').get().at,reads(w)],[t0+NETWORK_WINDOW_MS,1]);
});

test('AUD4-03 conservative D1 result: an applied row without RETURNING or changes sends no index read and is not refunded',async()=>{
  const {account,w}=buyerWorld(),keys=[],buyer=await signedIn(w,account,'198.51.100.20',openLane(keys)),prepare=w.env.DB.prepare;
  const unconfirmed=s=>({...s,bind:(...values)=>unconfirmed(s.bind(...values)),run:async()=>{await s.run();return {results:[],meta:{changes:0}};}});
  w.env.DB.prepare=sql=>sql===INDEX_LANE?unconfirmed(prepare(sql)):prepare(sql);
  const r=await buyer.get('/api/me/home');
  assert.deepEqual([r.status,(await body(r)).recheck,rows(w),reads(w),keys.filter(k=>k==='chain:index:lane').length],[200,'limited',1,0,1]);
});

test('AUD4-03 old release rows remain compatible: their /64 waits but the neighbour can use the second /48 slot',async()=>{
  const w=setup(),keys=[],local=openLane(keys),one=await signedIn(w,newAccount(),'2001:db8:7:1::1',local),two=await signedIn(w,newAccount(),'2001:db8:7:2::1',local);
  w.db.raw.prepare('INSERT INTO index_lanes(net,sub,at) VALUES(?,?,?)').run('net6:2001:db8:7::/48','released:net6:2001:db8:7:1::/64',w.clock.now()-30_000);
  const first=await body(await one.get('/api/me/home')),second=await body(await two.get('/api/me/home'));
  assert.deepEqual([first.recheck,second.recheck??null,rows(w),reads(w),keys.filter(k=>k==='chain:index:lane').length],['limited',null,2,1,1]);
});

for(const countRefusals of [false,true])test(`AUD4-03 residual comparison: ${countRefusals?'denials counted':'denials free'} local model, global admitted rows never include refusal`,async()=>{
  // Twenty networks take the key at T. Ten other /24s read every second (their independent probe gate admits each
  // only every 30 s), and the buyer every 15 s. In the free-denial model the buyer discovers at 60 s; counted denials
  // leave the older documented same-location availability residual at its 10-network model cost.
  const {account,w}=buyerWorld(),local=localModel(w.clock.now,{countRefusals}),close=[],attackers=[];
  for(let k=0;k<20;k++)close.push(await signedIn(w,newAccount(),'100.64.'+k+'.1',local));
  w.clock.advance(CHALLENGE_BUDGET_WINDOW_MS);
  for(let k=0;k<10;k++)attackers.push(await signedIn(w,newAccount(),'100.65.'+k+'.1',local));
  const buyer=await signedIn(w,account,'198.51.100.20',local);
  w.clock.advance(NETWORK_WINDOW_MS);const t0=w.clock.now();
  for(const b of close)assert.equal((await b.get('/api/me/home')).status,200);
  const events=[];for(let k=0;k<attackers.length;k++)for(let at=1+k*100;at<180_000;at+=1000)events.push([at,attackers[k]]);
  for(let at=2;at<180_000;at+=15_000)events.push([at,buyer]);
  events.sort((a,b)=>a[0]-b[0]);let firstBuyer=null;
  for(const [at,b] of events){w.clock.set(t0+at);const r=await b.get('/api/me/home');assert.equal(r.status,200);
    const h=await body(r);if(b===buyer&&h.eligible){firstBuyer=at;break;}}
  assert.equal(firstBuyer,countRefusals?null:60_002);
  assert.deepEqual([rows(w),reads(w)],[countRefusals?20:22,countRefusals?20:22],
    'only the 20 closing reads, and when allowed one attacker/buyer read, appear in admitted accounting');
});

test('AUD4-03 refused same-network concurrency: 12 raced preflights ask the local key once, keep one probe, and retry exactly at 30 s',async()=>{
  const w=setup(),tabs=[];let release,preflights=0,localCalls=0;
  const gate=new Promise(r=>{release=r;}),local={limit:async({key})=>{if(key==='chain:index:lane')localCalls++;return {success:false};}};
  for(let k=1;k<=12;k++)tabs.push(await signedIn(w,newAccount(),'203.0.113.'+k,local));
  const prepare=w.env.DB.prepare,held=s=>({...s,bind:(...v)=>held(s.bind(...v)),first:async()=>{
    const result=await s.first();if(++preflights===tabs.length)release();await gate;return result;}});
  w.env.DB.prepare=sql=>sql===INDEX_LANE_READY?held(prepare(sql)):prepare(sql);
  const replies=await Promise.all(tabs.map(async b=>{const r=await b.get('/api/me/home');assert.equal(r.status,200);return body(r);}));
  assert.ok(replies.every(h=>h.recheck==='limited'));
  assert.deepEqual([preflights,localCalls,rows(w),reads(w),w.db.raw.prepare('SELECT count(*) n FROM index_lane_probes').get().n],[12,1,0,0,1]);
  w.env.DB.prepare=prepare;const t0=w.clock.now();w.clock.set(t0+INDEX_PROBE_BACKOFF_MS-1);
  assert.equal((await body(await tabs[0].get('/api/me/home?fresh=1'))).recheck,'limited');assert.equal(localCalls,1);
  w.clock.advance(1);assert.equal((await body(await tabs[0].get('/api/me/home?fresh=1'))).recheck,'limited');
  assert.deepEqual([localCalls,rows(w),reads(w),w.db.raw.prepare('SELECT count(*) n FROM index_lane_probes').get().n],[2,0,0,1]);
});

test('AUD4-03 opportunistic prune: each gate deletes at most two expired scopes and preserves unexpired markers',async()=>{
  const w=setup(),local={limit:async()=>({success:false})},b=await signedIn(w,newAccount(),'198.51.100.20',local),t=w.clock.now();
  const seed=w.db.raw.prepare('INSERT INTO index_lane_probes(scope_key,net,sub,probed_at,expires_at) VALUES(?,?,NULL,?,?)');
  for(let k=0;k<7;k++)seed.run('old:'+k,'net:100.80.'+k+'.0/24',t-INDEX_PROBE_BACKOFF_MS-1,t-1);
  seed.run('future','net:100.81.0.0/24',t,t+INDEX_PROBE_BACKOFF_MS);
  const batch=w.env.DB.batch,deleted=[];
  w.env.DB.batch=async statements=>{const results=await batch(statements);
    if(statements[0].sql===INDEX_PROBE_PRUNE)deleted.push(results[0].meta.changes);return results;};
  for(let k=0;k<4;k++){const r=await b.get('/api/me/home?fresh=1',{headers:{'cf-connecting-ip':'100.82.'+k+'.1'}});assert.equal(r.status,200);}
  assert.deepEqual(deleted,[2,2,2,1]);
  assert.deepEqual([w.db.raw.prepare('SELECT count(*) n FROM index_lane_probes WHERE expires_at<=?').get(t).n,
    w.db.raw.prepare("SELECT count(*) n FROM index_lane_probes WHERE scope_key='future'").get().n,
    w.db.raw.prepare('SELECT count(*) n FROM index_lane_probes').get().n,rows(w),reads(w)],[0,1,5,0,0]);
});

for(const missing of ['0008','index_lane_probes_net','index_lane_probes_expiry'])test(`AUD4-03 missing ${missing}: lane fails closed while EOA login and ordinary home proof remain available`,async()=>{
  const db=openD1(migrationFiles().filter(f=>!f.startsWith('0008_')));
  const w=missing==='0008'?setup({env:{DB:db}}):setup();
  if(missing!=='0008')w.db.raw.exec('DROP INDEX '+missing);
  const localKeys=[],local=openLane(localKeys),b=await signedIn(w,newAccount(),'198.51.100.20',local),r=await b.get('/api/me/home');
  assert.deepEqual([r.status,(await body(r)).recheck,reads(w),localKeys],[200,'limited',0,['chain:index']]);
  assert.equal((await b.get('/api/auth/session')).status,200,'login/session reads still work');
  // A configured normal key does not need the discovery schema. The first owner proof remains unchanged.
  const normal={limit:async()=>({success:true})},fresh=await signedIn(w,newAccount(),'198.51.101.20',normal),ordinary=await fresh.get('/api/me/home');
  assert.equal(ordinary.status,200);assert.equal((await body(ordinary)).recheck,undefined);assert.equal(reads(w),1);
});

test('AUD4-03 probe SQL cost guards: covering LIMITed net/expiry reads and PK expiry replacement after a two-row prune',()=>{
  const w=setup(),db=w.db.raw,plan=(sql,...v)=>db.prepare('EXPLAIN QUERY PLAN '+sql).all(...v).map(r=>r.detail).join(' | '),t=w.clock.now();
  assert.match(plan(INDEX_PROBE,'net:a|','net:a',null,t,t+INDEX_PROBE_BACKOFF_MS,1),
    /SEARCH index_lane_probes USING COVERING INDEX index_lane_probes_net \(net=\? AND expires_at>\?\)/);
  assert.match(plan(INDEX_PROBE_PRUNE,t,2),/SEARCH index_lane_probes USING COVERING INDEX index_lane_probes_expiry \(expires_at<\?\)/);
  const expired=t-1,seed=db.prepare('INSERT INTO index_lane_probes(scope_key,net,sub,probed_at,expires_at) VALUES(?,?,NULL,?,?)');
  seed.run('a','net:other',expired-INDEX_PROBE_BACKOFF_MS,expired);seed.run('b','net:other2',expired-INDEX_PROBE_BACKOFF_MS,expired);
  seed.run('net:a|','net:a',expired-INDEX_PROBE_BACKOFF_MS,expired);
  db.prepare(INDEX_PROBE_PRUNE).run(t,2);
  const result=db.prepare(INDEX_PROBE).all('net:a|','net:a',null,t,t+INDEX_PROBE_BACKOFF_MS,1);
  assert.equal(result[0].scope_key,'net:a|');assert.equal(db.prepare('SELECT expires_at FROM index_lane_probes').get().expires_at,t+INDEX_PROBE_BACKOFF_MS);
});
