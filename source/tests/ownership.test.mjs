import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain,Browser,START} from './wallet-harness.mjs';
import {createWorker} from '../worker/app.ts';
import {ReadGateway} from '../server/gateway.ts';
import {ALCHEMY_RPC_URL,ALCHEMY_NFTS_URL,MULTICALL_CHUNK} from '../server/ownership.ts';
import {houseSize} from '../src/world/households.ts';
// Ownership and eligibility through GET /api/me/home and GET /api/wallet/:address/assets on the real Worker. The fake
// chain answers ownerOf from `owners` and the NFT index from `index` (which may lie or lag), so each case states what
// the chain says and checks what the route lets the owner do.
const HOUR=3_600_000,DAY=24*HOUR,NL=String.fromCharCode(10);
const body=r=>r.clone().json();
const owners=(n,map)=>Object.assign(Array(n).fill('0x'+'0'.repeat(40)),map);
async function signedIn(w,account){const b=w.browser();const {verify}=await b.signIn(account);assert.equal(verify.status,200);return b;}
function world({seats={361:'51320',921:'51311',77:'50001',78:'50002'},swarmOwners={},online=[],chain={}}={}){
  return setup({imd:fakeImd({seats,owners:owners(2000,swarmOwners),online}),chain:fakeChain({owners:chain})});
}
const rpcCalls=w=>w.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL).length;

test('an owner of #361 and #921 (both online) gets one house of size ms, verified by ownerOf at a block, no second signature',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),w=world({swarmOwners:{361:me,921:me},online:[361,921],chain:{361:me,921:me}});
  const b=await signedIn(w,a),r=await b.get('/api/me/home'),home=await body(r);
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
  assert.equal(home.address,a.address);assert.equal(home.eligible,2);assert.equal(home.size,'ms');assert.equal(home.block,21_000_000);
  assert.deepEqual(home.seats.map(s=>[s.tokenId,s.agentId,s.online,s.counts]),[['361','51320',true,true],['921','51311',true,true]]);
  assert.equal(home.checkedAt,START);assert.equal(home.presence,'fresh');
  // The key never leaves the Authorization header; the owner address is the only thing in the index URL.
  for(const c of w.chain.state.calls){assert.equal(c.headers.get('authorization'),'Bearer test-alchemy-key');assert.ok(!c.url.includes('test-alchemy-key'));}
});

// Remediation 2026-09-29 §7A item 7: the wallet /api/me/home answers for comes from the server session only. Whatever
// else the request names (a query parameter, a header, a body) is ignored, and nothing is read on chain for it.
test('/api/me/home answers for the session’s wallet only: an address in the query, a header or a body changes nothing',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),other=newAccount(),them=other.address.toLowerCase();
  const w=world({swarmOwners:{361:them,921:me},online:[361,921],chain:{361:them,921:me}});
  const b=await signedIn(w,a);
  for(const [path,init] of [['/api/me/home',{}],['/api/me/home?address='+other.address,{}],['/api/me/home?wallet='+them+'&fresh=1',{}],
    ['/api/me/home',{headers:{'x-wallet-address':other.address,'x-address':them}}],['/api/me/home?owner='+them,{headers:{'content-type':'application/json'}}]]){
    const r=await b.get(path,init),home=await body(r);
    assert.equal(r.status,200,path);assert.equal(home.address.toLowerCase(),me,path);
    assert.deepEqual(home.seats.map(s=>s.tokenId),['921'],path+': only the session wallet’s seat');
  }
  assert.equal((await b.send(b.request('/api/me/home',{method:'POST',body:JSON.stringify({address:other.address}),headers:{'content-type':'application/json'}}))).status,405,'no write form at all');
  const asked=w.chain.state.calls.map(c=>c.url.toLowerCase()+' '+(c.body??'')).join(NL);
  assert.ok(asked.includes(me.slice(2)),'the session wallet was looked up');assert.ok(!asked.includes(them.slice(2)),'nothing was asked on chain about the other wallet');
  const stranger=w.browser();
  assert.equal((await stranger.get('/api/me/home?address='+other.address,{headers:{'x-wallet-address':other.address}})).status,401,'and without a session no address opens it');
});

test('forged candidates are rejected by ownerOf: an index or swarm entry is only a candidate',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),other='0x'+'9'.repeat(40);
  const w=world({swarmOwners:{77:me},online:[361,921,77],chain:{361:me,921:other,77:other}});
  w.chain.state.index={[me]:['361','921','5000']};    // the index claims #921 and a never-minted #5000
  const home=await body(await (await signedIn(w,a)).get('/api/me/home'));
  assert.deepEqual(home.seats.map(s=>s.tokenId),['361']);assert.equal(home.eligible,1);assert.equal(home.size,'s');
});

test('a sold seat drops within 30 s; the second-hand buyer counts it once it is online, even before IMD indexes the sale',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase();
  const w=world({swarmOwners:{361:a,921:a},online:[361,921],chain:{361:a,921:a}});
  const sa=await signedIn(w,A),sb=await signedIn(w,B);
  assert.equal((await body(await sa.get('/api/me/home'))).eligible,2);
  assert.equal((await body(await sb.get('/api/me/home'))).size,null);
  w.chain.state.owners[361]=bAddr;w.chain.state.block=21_000_010n;     // A sells #361 to B; IMD's swarm still says A
  w.clock.advance(29_000);
  assert.equal((await body(await sa.get('/api/me/home'))).eligible,2,'inside the 30 s ownership cache');
  w.clock.advance(1_001);
  const ha=await body(await sa.get('/api/me/home'));
  assert.deepEqual(ha.seats.map(s=>s.tokenId),['921']);assert.equal(ha.size,'s');assert.equal(ha.block,21_000_010);
  // Discovery is slower than loss: B's index answer (5 min) does not know #361 yet, until B presses "Check again" (fresh:
  // the index is re-asked when its answer is older than 30 s) or 5 minutes pass.
  assert.deepEqual((await body(await sb.get('/api/me/home'))).seats,[],'the buyer’s plain re-check within 5 min');
  const hb=await body(await sb.get('/api/me/home?fresh=1'));
  assert.deepEqual(hb.seats.map(s=>[s.tokenId,s.counts]),[['361',true]]);assert.equal(hb.size,'s');
  const C=newAccount(),c=C.address.toLowerCase(),sc=await signedIn(w,C);
  assert.deepEqual((await body(await sc.get('/api/me/home'))).seats,[]);
  w.chain.state.owners[921]=c;w.clock.advance(5*60_000);                // A sells #921 to C: C sees it after 5 min unasked
  assert.deepEqual((await body(await sc.get('/api/me/home'))).seats.map(s=>s.tokenId),['921']);
  assert.equal((await body(await sa.get('/api/me/home'))).size,null,'A holds nothing now');
});

// S1 / H1: any throwaway key can sign in, so a session proves nothing, and every NFT index read it caused (a first read,
// one every 5 min, the extra one of fresh) was keyed Alchemy traffic outside any budget. Each spends chain:index first.
test('/api/me/home: every NFT index read spends CHAIN_LIMITER (chain:index); refused, throwaway sessions cause no keyed read at all',async()=>{
  const keys=[];let allowed=false;
  const w=setup({env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);if(allowed===null)throw new Error('down');return {success:allowed};}}}});
  const index=()=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length;
  const sessions=[];for(let i=0;i<10;i++)sessions.push(await signedIn(w,newAccount()));
  const round=async path=>{for(const b of sessions){const h=await body(await b.get(path));assert.deepEqual([h.seats,h.recheck],[[],'limited'],path);}};
  for(const path of ['/api/me/home?fresh=1','/api/me/home']){
    await round(path);w.clock.advance(300_001);await round(path);
    assert.deepEqual([index(),rpcCalls(w)],[0,0],path+': refused, nothing is read');
  }
  allowed=null;await round('/api/me/home?fresh=1');assert.deepEqual([index(),rpcCalls(w)],[0,0],'limiter down: nothing is read');
  assert.ok(keys.length>=40&&keys.every(k=>k==='chain:index'));
  // Allowed, each read spends exactly one unit and is then kept 5 min per address (INT-1): nothing more to spend.
  allowed=true;keys.length=0;w.clock.advance(31_000);
  for(const b of sessions)assert.equal((await body(await b.get('/api/me/home'))).recheck,undefined);
  assert.deepEqual([index(),keys.length,rpcCalls(w)],[10,10,0],'a throwaway address has no candidate, so no ownerOf read either');
  w.clock.advance(31_000);for(const b of sessions)await b.get('/api/me/home');assert.deepEqual([index(),keys.length],[10,10]);
});

test('home?fresh=1 and a refused budget: the stored index answer and IMD’s roster name the candidates, ownerOf proves them, and the view says limited',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),keys=[];let allowed=true;
  const w=setup({imd:fakeImd({seats:{361:'51320',921:'51311'},owners:owners(2000,{361:a,921:bAddr}),online:[361,921]}),chain:fakeChain({owners:{361:a,921:bAddr}}),
    env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);if(allowed===null)throw new Error('down');return {success:allowed};}}}});
  const index=()=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length;
  const sb=await signedIn(w,B);
  assert.deepEqual((await body(await sb.get('/api/me/home?fresh=1'))).seats.map(s=>s.tokenId),['921'],'a first read spends the budget too');
  assert.deepEqual([index(),keys],[1,['chain:index']]);
  assert.equal((await body(await sb.get('/api/me/home?fresh=1'))).recheck,undefined,'the stored answer is under 30 s old: nothing to spend');
  assert.deepEqual([index(),keys.length],[1,1]);
  w.chain.state.owners[361]=bAddr;w.clock.advance(31_000);             // A sells #361 to B; IMD's roster still says A
  for(const refusal of [false,null]){
    allowed=refusal;const h=await body(await sb.get('/api/me/home?fresh=1'));
    assert.deepEqual([h.seats.map(s=>s.tokenId),h.recheck,index()],[['921'],'limited',1],'refused'+(refusal===null?' (limiter down)':'')+': the roster seat is still proven, no index read');
    w.clock.advance(31_000);
  }
  allowed=true;const h=await body(await sb.get('/api/me/home?fresh=1'));
  assert.deepEqual([h.seats.map(s=>s.tokenId),h.recheck,index()],[['361','921'],undefined,2]);
  assert.deepEqual(keys,['chain:index','chain:index','chain:index','chain:index']);
  // A roster-listed owner keeps owner mode while the budget is spent (the seller A now owns nothing on-chain).
  allowed=false;const sa=await signedIn(w,A);w.chain.state.owners[361]=a;
  const ha=await body(await sa.get('/api/me/home'));assert.deepEqual([ha.seats.map(s=>s.tokenId),ha.size,ha.recheck,index()],[['361'],'s','limited',2]);
});

// A-2 (Swarm audit 519db624): a refused reload deleted the stored index answer, so a seat only the index named (bought
// after IMD's roster last listed it) dropped out of the house while the budget was spent. The answer is kept and
// re-proved; the proof itself is never reused.
test('A-2: a refused index reload keeps the last index answer as candidates, and ownerOf re-proves them each time (fresh and after 5 min)',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),keys=[];let allowed=true;
  const w=setup({imd:fakeImd({seats:{361:'51320'},owners:owners(2000,{}),online:[361]}),chain:fakeChain({owners:{361:a}}),
    env:{CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);return {success:allowed};}}}});
  const index=()=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length,view=h=>[h.seats.map(s=>s.tokenId),h.eligible,h.size,h.recheck];
  const sa=await signedIn(w,A);
  assert.deepEqual(view(await body(await sa.get('/api/me/home?fresh=1'))),[['361'],1,'s',undefined],'only the index names #361');
  assert.deepEqual([index(),rpcCalls(w)],[1,1]);
  allowed=false;w.clock.advance(31_000);
  assert.deepEqual(view(await body(await sa.get('/api/me/home?fresh=1'))),[['361'],1,'s','limited'],'fresh=1, refused: the stored answer still names it');
  assert.deepEqual([index(),rpcCalls(w)],[1,2],'no index read; ownerOf read again');
  w.chain.state.owners[361]='0x'+'9'.repeat(40);w.clock.advance(31_000);   // sold: the stored candidate is re-proved, not trusted
  assert.deepEqual(view(await body(await sa.get('/api/me/home?fresh=1'))),[[],0,null,'limited']);assert.equal(rpcCalls(w),3);
  w.chain.state.owners[361]=a;w.clock.advance(300_001);                     // bought back; the 5-minute path, no Check again
  assert.deepEqual(view(await body(await sa.get('/api/me/home'))),[['361'],1,'s','limited']);
  assert.deepEqual([index(),rpcCalls(w)],[1,4]);
  // The kept answer keeps its own age: allowed again, the next plain re-check (no Check again) reads the index.
  allowed=true;w.clock.advance(31_000);
  assert.deepEqual(view(await body(await sa.get('/api/me/home'))),[['361'],1,'s',undefined],'allowed again: a new index read');
  assert.deepEqual([index(),keys.filter(k=>k==='chain:index').length],[2,5]);
});

// A-2, across instances: the kept answer lived only in the isolate that read it, so a read another isolate (or location)
// served with chain:index refused lost a seat only the index named. Every index read now keeps its answer in D1
// (migrations/0004), read only when an index read is refused or fails; ownerOf still proves each seat it names.
test('A-2: another server instance, with an empty cache and chain:index refused or the index failing, still proves a seat only the index named, from the answer kept in D1',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),other='0x'+'9'.repeat(40);
  const w=setup({imd:fakeImd({seats:{361:'51320',921:'51311'},owners:owners(2000,{}),online:[361,921]}),chain:fakeChain({owners:{361:a}})});
  const index=()=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length,view=h=>[h.seats.map(s=>s.tokenId),h.eligible,h.size,h.recheck];
  // Another isolate: its own Worker (empty caches) over the same D1, upstreams and clock (`lag`: its requests began that much earlier).
  const instance=(env={},lag=0)=>{const now=()=>w.clock.now()-lag,worker=createWorker(new ReadGateway(w.imd.fetcher,now),w.chain.fetcher,now);
    const b=new Browser(r=>worker.fetch(r,{...w.env,...env},{waitUntil:p=>w.kept.push(p)}));b.jar=new Map(sa.jar);return b;};
  const refused={CHAIN_LIMITER:{limit:async()=>({success:false})}},settle=()=>Promise.all(w.kept);
  const sa=await signedIn(w,A);
  assert.deepEqual(view(await body(await sa.get('/api/me/home?fresh=1'))),[['361'],1,'s',undefined],'only the index names #361');
  await settle();assert.deepEqual([index(),rpcCalls(w)],[1,1]);
  const two=instance(refused);
  assert.deepEqual(view(await body(await two.get('/api/me/home'))),[['361'],1,'s','limited'],'another instance, refused: the kept answer names #361');
  assert.deepEqual([index(),rpcCalls(w)],[1,2],'no index read there; ownerOf read again');
  w.chain.state.fail='index';
  assert.deepEqual(view(await body(await instance().get('/api/me/home'))),[['361'],1,'s','limited'],'another instance, the index failing: the same');
  w.chain.state.fail=null;assert.deepEqual([index(),rpcCalls(w)],[2,3]);
  w.chain.state.owners[361]=other;w.clock.advance(31_000);              // sold: the kept candidate is re-proved, not trusted
  assert.deepEqual(view(await body(await two.get('/api/me/home'))),[[],0,null,'limited']);assert.equal(rpcCalls(w),4);
  // An answer read earlier never replaces a newer one: the index lists #921 as well at t; an instance whose read began
  // 10 s before t, answering only #361, finishes after it. Refused later, that instance takes the newer answer in D1
  // over its own.
  Object.assign(w.chain.state.owners,{361:a,921:a});w.clock.advance(31_000);
  assert.deepEqual(view(await body(await sa.get('/api/me/home?fresh=1'))),[['361','921'],2,'ms',undefined]);await settle();
  let lagAllowed=true;const lag=instance({CHAIN_LIMITER:{limit:async()=>({success:lagAllowed})}},10_000);
  w.chain.state.index={[a]:['361']};
  assert.deepEqual(view(await body(await lag.get('/api/me/home?fresh=1'))),[['361'],1,'s',undefined]);await settle();
  w.chain.state.index=null;
  assert.deepEqual(view(await body(await instance(refused).get('/api/me/home'))),[['361','921'],2,'ms','limited'],'the newer answer is the one kept');
  lagAllowed=false;w.clock.advance(31_000);
  assert.deepEqual(view(await body(await lag.get('/api/me/home?fresh=1'))),[['361','921'],2,'ms','limited'],'and preferred to the instance’s own older one');
  // Sold both: the next index read answers nothing and removes the kept answer, so an instance with the index failing
  // has nothing to re-prove (503, as before), and a refused one has only IMD's roster (nothing, limited, no chain read).
  Object.assign(w.chain.state.owners,{361:other,921:other});w.clock.advance(31_000);
  assert.deepEqual(view(await body(await sa.get('/api/me/home?fresh=1'))),[[],0,null,undefined]);await settle();
  w.chain.state.fail='index';const r=await instance().get('/api/me/home');w.chain.state.fail=null;
  assert.deepEqual([r.status,await body(r)],[503,{error:'OWNERSHIP_UNAVAILABLE'}]);
  const calls=rpcCalls(w);
  assert.deepEqual(view(await body(await instance(refused).get('/api/me/home'))),[[],0,null,'limited']);assert.equal(rpcCalls(w),calls);
  // At most 256 ids are kept, chosen like the candidates themselves (A-4): 299 unregistered low ids and #1000, online.
  const B=newAccount(),bAddr=B.address.toLowerCase(),mine=Object.fromEntries([...Array.from({length:299},(_,i)=>String(i)),'1000'].map(id=>[id,bAddr]));
  const big=setup({imd:fakeImd({seats:{1000:'77777'},owners:owners(2000,{}),online:[1000]}),chain:fakeChain({owners:mine})});
  const sb=await signedIn(big,B);assert.equal((await body(await sb.get('/api/me/home'))).eligible,1);await Promise.all(big.kept);
  const far=createWorker(new ReadGateway(big.imd.fetcher,big.clock.now),big.chain.fetcher,big.clock.now),fb=new Browser(q=>far.fetch(q,{...big.env,...refused},{waitUntil:p=>big.kept.push(p)}));
  fb.jar=new Map(sb.jar);const h=await body(await fb.get('/api/me/home'));
  assert.deepEqual([h.seats.length,h.eligible,h.seats.filter(s=>s.counts).map(s=>s.tokenId),h.recheck],[256,1,['1000'],'limited']);
});

// A-2, the date of a kept answer (Codex crosscheck review A2-R1): it was when the request began, so a request held before
// its index read (a slow IMD roster read, say) dated its later answer before one read meanwhile on another instance, the
// guard kept that older answer, and a refused read anywhere lost a seat only the later one named.
test('A-2: a kept index answer is dated when its index read began, not its request: a request held before the index keeps its later answer over one read meanwhile',async()=>{
  const A=newAccount(),a=A.address.toLowerCase();
  const w=setup({imd:fakeImd({seats:{361:'51320',921:'51311'},owners:owners(2000,{}),online:[361,921]}),chain:fakeChain({owners:{361:a}})});
  const view=h=>[h.seats.map(s=>s.tokenId),h.eligible,h.size,h.recheck],settle=()=>Promise.all(w.kept);
  const sa=await signedIn(w,A);
  // An instance: its own Worker (empty caches) over the same D1, chain and clock, with its own IMD fetch, chain:index
  // answer and waitUntil list.
  const instance=({imd=w.imd.fetcher,allowed=()=>true,kept=w.kept}={})=>{const worker=createWorker(new ReadGateway(imd,w.clock.now),w.chain.fetcher,w.clock.now);
    const b=new Browser(r=>worker.fetch(r,{...w.env,CHAIN_LIMITER:{limit:async()=>({success:allowed()})}},{waitUntil:p=>kept.push(p)}));b.jar=new Map(sa.jar);return b;};
  // X's request begins at t0 and waits for IMD's roster.
  let open,reached,xAllowed=true;const gate=new Promise(r=>open=r),waiting=new Promise(r=>reached=r),xKept=[];
  const x=instance({imd:async url=>{reached();await gate;return w.imd.fetcher(url);},allowed:()=>xAllowed,kept:xKept});
  const t0=w.clock.now(),held=x.get('/api/me/home');await waiting;
  // t0 + 3 s: Y reads the index, which names #361 only.
  w.clock.advance(3_000);
  assert.deepEqual(view(await body(await instance().get('/api/me/home'))),[['361'],1,'s',undefined]);await settle();
  // t0 + 5 s: #921 is bought (IMD's roster does not list it). t0 + 6 s: X goes on and reads the index, which names both.
  w.clock.advance(2_000);w.chain.state.owners[921]=a;w.clock.advance(1_000);open();
  assert.deepEqual(view(await body(await held)),[['361','921'],2,'ms',undefined]);await Promise.all(xKept);
  const row=w.db.raw.prepare('SELECT ids,read_at FROM index_candidates WHERE address=?').get(a);
  assert.deepEqual([JSON.parse(row.ids),row.read_at],[['361','921'],t0+6_000],'X’s later answer is the one kept, dated when its index read began');
  // Z, with chain:index refused: the kept answer names #921 too, and ownerOf proves it.
  assert.deepEqual(view(await body(await instance({allowed:()=>false}).get('/api/me/home'))),[['361','921'],2,'ms','limited'],'another instance, refused');
  // X itself, refused after 5 min: its own answer is that same one.
  xAllowed=false;w.clock.advance(300_001);
  assert.deepEqual(view(await body(await x.get('/api/me/home'))),[['361','921'],2,'ms','limited'],'X, refused');
});

// A deploy that ran ahead of migrations/0004 cannot keep index answers in D1: each instance keeps its own, as before,
// and neither the house read nor the cron fails for it.
test('deployed before migrations/0004: house reads, refused or failing index reads and the cron work as before the table',async()=>{
  const {openD1}=await import('./d1-sqlite.mjs');
  const A=newAccount(),a=A.address.toLowerCase(),old=openD1(['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql']);let allowed=true;
  const w=setup({imd:fakeImd({seats:{361:'51320'},owners:owners(2000,{}),online:[361]}),chain:fakeChain({owners:{361:a}}),env:{DB:old,CHAIN_LIMITER:{limit:async()=>({success:allowed})}}});
  const sa=await signedIn(w,A),home=async()=>{const r=await sa.get('/api/me/home?fresh=1'),h=await body(r);return [r.status,h.seats?.map(s=>s.tokenId),h.eligible,h.recheck];};
  assert.deepEqual(await home(),[200,['361'],1,undefined]);await Promise.all(w.kept);
  allowed=false;w.clock.advance(31_000);
  assert.deepEqual(await home(),[200,['361'],1,'limited'],'refused: this instance’s own answer');
  allowed=true;w.chain.state.fail='index';w.clock.advance(31_000);
  assert.deepEqual(await home(),[200,['361'],1,'limited'],'failing: the same');
  w.chain.state.fail=null;
  await w.worker.scheduled({scheduledTime:w.clock.now(),cron:'*/15 * * * *'},w.env,{waitUntil:p=>w.kept.push(p)});await Promise.all(w.kept);
  assert.equal(old.raw.prepare('SELECT count(*) n FROM seat_presence').get().n,1,'the roster is recorded; only the index prune fails');
});

// INT-1: an owner tab re-checks every 60 s; the ownership proof lives 30 s, so each re-check used to cost an NFT API call and
// an eth_call. The index answer is now kept 5 min per address; ownerOf is still proven on every re-check.
test('an hour of owner re-checks at 60 s costs 60 eth_calls but only 12 NFT index calls, and a sale still shows within one re-check',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),w=world({swarmOwners:{361:me},online:[361,921],chain:{361:me,921:me}});
  const b=await signedIn(w,a),index=()=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length;
  const eligible=[];
  for(let i=0;i<60;i++){
    if(i===45)w.chain.state.owners[921]='0x'+'9'.repeat(40);           // sold at minute 45
    const r=await b.get('/api/me/home');assert.equal(r.status,200);eligible.push((await body(r)).eligible);w.clock.advance(60_000);
  }
  assert.equal(rpcCalls(w),60);assert.equal(index(),12);
  assert.deepEqual([eligible[44],eligible[45]],[2,1],'the sale shows on the very next re-check');
});

test('eligibility: a registered agent online now or within 24 h counts; offline longer or not an agent does not',async()=>{
  // #3 is online but has no agent id (a seat that never registered an IMD agent).
  const a=newAccount(),me=a.address.toLowerCase(),w=world({online:[361,3],chain:{361:me,921:me,77:me,3:me}});
  const seen=(id,at)=>w.db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(?,?,?,?)').run(id,me,at,at);
  seen(921,START-23*HOUR);seen(77,START-DAY-1);
  const home=await body(await (await signedIn(w,a)).get('/api/me/home'));
  assert.deepEqual(home.seats.map(s=>[s.tokenId,s.counts,s.reason??null,s.lastOnlineAt]),
    [['3',false,'not-agent',START],['77',false,'offline-24h',START-DAY-1],['361',true,null,START],['921',true,null,START-23*HOUR]]);
  assert.equal(home.eligible,2);assert.equal(home.size,houseSize(2));
});

// CORR-03: sightings were keyed by seat only, so a buyer inherited the seller's last sighting. CORR-07: a seat never seen
// online (recording starts at deploy) was reported as "offline 24h+".
test('a buyer never inherits the seller’s sighting: the seat counts once it is online under the buyer; never seen is its own reason',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase();
  const w=world({swarmOwners:{361:a},online:[],chain:{361:bAddr}});   // A sold #361 to B; it was last online under A
  w.db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(361,?,?,?)').run(a,START-2*HOUR,START-2*HOUR);
  const sb=await signedIn(w,B);
  let hb=await body(await sb.get('/api/me/home?fresh=1'));
  assert.deepEqual(hb.seats.map(s=>[s.tokenId,s.online,s.counts,s.lastOnlineAt,s.reason]),[['361',false,false,null,'not-seen']]);
  assert.equal(hb.size,null);
  // B brings it online: it counts at once from the live roster; once the cron records it under B, it keeps counting offline.
  w.imd.state.online=[361];w.imd.state.owners=owners(2000,{361:bAddr});w.clock.advance(5*60_000+1);
  hb=await body(await sb.get('/api/me/home'));assert.deepEqual(hb.seats.map(s=>[s.online,s.counts]),[[true,true]]);
  await w.worker.scheduled({scheduledTime:w.clock.now(),cron:'*/15 * * * *'},w.env,{waitUntil:p=>w.kept.push(p)});await Promise.all(w.kept);
  w.imd.state.online=[];w.clock.advance(5*60_000+1);
  hb=await body(await sb.get('/api/me/home'));
  assert.deepEqual(hb.seats.map(s=>[s.online,s.counts,s.reason??null]),[[false,true,null]]);assert.equal(hb.size,'s');
  // The same public view for anyone: the seller's old row does not make the seat count for the seller either (A holds nothing).
  const pub=await body(await w.call(new Request('https://imdember.com/api/wallet/'+bAddr+'/assets')));
  assert.deepEqual(pub.seats.map(s=>[s.tokenId,s.counts]),[['361',true]]);
});

test('house size follows the eligible count (1 s, 2–3 ms, 4–6 m, 7–9 l, 10+ xl); zero eligible is signed in without a house',async()=>{
  const seats=Object.fromEntries(Array.from({length:12},(_,i)=>[String(100+i),String(60000+i)]));
  for(const [n,size] of [[0,null],[1,'s'],[3,'ms'],[4,'m'],[6,'m'],[7,'l'],[9,'l'],[10,'xl'],[12,'xl']]){
    const a=newAccount(),me=a.address.toLowerCase(),ids=Object.keys(seats);
    const w=setup({imd:fakeImd({seats,owners:owners(2000,{}),online:ids.slice(0,n)}),chain:fakeChain({owners:Object.fromEntries(ids.map(id=>[id,me]))})});
    const home=await body(await (await signedIn(w,a)).get('/api/me/home'));
    assert.equal(home.eligible,n);assert.equal(home.size,size,String(n));assert.equal(home.seats.length,12);
  }
});

test('chain failures are 503 OWNERSHIP_UNAVAILABLE, never an empty house, and are not cached',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),w=world({online:[361],chain:{361:me}});
  const b=await signedIn(w,a);
  for(const fail of ['network','http','rpc-error']){
    w.chain.state.fail=fail;
    const r=await b.get('/api/me/home');
    assert.equal(r.status,503,fail);assert.deepEqual(await body(r),{error:'OWNERSHIP_UNAVAILABLE'});
  }
  // A failing index read with an answer kept from an earlier one (the rpc-error round's) is treated like a refused one
  // (A-2): that answer, proven by ownerOf, marked limited. With none kept it is 503 (the A-2 test across instances).
  w.chain.state.fail='index';w.clock.advance(5*60_000);                // the index answer from the rpc-error round has expired
  const kept=await body(await b.get('/api/me/home'));assert.deepEqual([kept.eligible,kept.recheck],[1,'limited']);
  w.chain.state.fail=null;w.clock.advance(30_001);
  const ok=await body(await b.get('/api/me/home'));assert.deepEqual([ok.eligible,ok.recheck],[1,undefined],'the failure was not remembered');
  // No key (local runs, or a missing secret) is the same 503, with no request to Alchemy at all.
  const nokey=setup({key:null,imd:fakeImd({seats:{361:'1'},owners:owners(2000,{}),online:[361]}),chain:fakeChain({owners:{361:me}})});
  const r=await (await signedIn(nokey,a)).get('/api/me/home');
  assert.equal(r.status,503);assert.equal(nokey.chain.state.calls.length,0);
  // IMD's swarm unavailable (agent ids unknown) is 503 as well.
  const noSwarm=world({online:[361],chain:{361:me}});noSwarm.imd.state.fail.add('/swarm');
  assert.equal((await (await signedIn(noSwarm,a)).get('/api/me/home')).status,503);
});

test('one address: ownership is read once per 30 s (in-flight shared); more than 200 candidates are split and pinned to one block',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),w=world({online:[361],chain:{361:me}});
  const b=await signedIn(w,a);
  await Promise.all([b.get('/api/me/home'),b.get('/api/me/home'),b.get('/api/me/home')]);
  assert.equal(rpcCalls(w),1);
  w.clock.advance(30_001);await b.get('/api/me/home');assert.equal(rpcCalls(w),2);
  const many=newAccount(),m=many.address.toLowerCase(),ids=Array.from({length:MULTICALL_CHUNK+30},(_,i)=>String(1000+i));
  const big=setup({imd:fakeImd({seats:{},owners:owners(2000,{}),online:[]}),chain:fakeChain({owners:Object.fromEntries(ids.map(id=>[id,m]))})});
  const home=await body(await (await signedIn(big,many)).get('/api/me/home'));
  assert.equal(home.seats.length,ids.length);assert.equal(home.recheck,undefined,'230 candidates, all checked: a complete answer');
  const calls=big.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL).map(c=>JSON.parse(c.body).params[1]);
  assert.deepEqual(calls,['latest','0x'+(21_000_000).toString(16)]);
});

// A-4 (Swarm audit 519db624): the 256-candidate cap cut by token id before eligibility, so one more low-id seat sent to a
// large holder pushed the only counting seat out, and the answer read as a complete "no house".
const low=n=>Array.from({length:n},(_,i)=>String(i));
/** A holder of `ids` (the roster and the index both name them; `seats`: id → agent id, `online` by default all of them):
 *  its first house read and the eth_calls it cost. */
const holder=async(ids,seats,online=Object.keys(seats),env)=>{const A=newAccount(),a=A.address.toLowerCase(),mine=Object.fromEntries(ids.map(id=>[id,a]));
  const w=setup({imd:fakeImd({seats,owners:owners(2000,mine),online}),chain:fakeChain({owners:mine}),env});
  const b=await signedIn(w,A),h=await body(await b.get('/api/me/home'));return {h,rpc:rpcCalls(w)};};
test('A-4: past the 256-candidate cap, seats whose agent can count are checked first, and a cut list says partial, never a complete zero',async()=>{
  // 255 unregistered low ids and #1000, the one registered seat, online: 256 candidates, all checked.
  let {h,rpc}=await holder([...low(255),'1000'],{1000:'77777'});
  assert.deepEqual([h.eligible,h.size,h.recheck,h.seats.length,h.seats.at(-1).tokenId,rpc],[1,'s',undefined,256,'1000',2]);
  // One more unregistered low id (#255): 257 candidates. #1000 is still checked and counts; #255 is the one left out.
  ({h,rpc}=await holder([...low(256),'1000'],{1000:'77777'}));
  assert.deepEqual(h.seats.map(s=>s.tokenId),[...low(255),'1000'],'checked and listed by id');
  assert.deepEqual([h.eligible,h.size,h.recheck,rpc],[1,'s','partial',2],'still two eth_calls');
  // Registered seats that are offline (they can count through a recent sighting) outrank unregistered ones too.
  ({h}=await holder([...low(256),'1500','1600'],{1500:'77778',1600:'77779'},[]));
  assert.deepEqual([h.seats.slice(-2).map(s=>s.tokenId),h.seats.length,h.recheck],[['1500','1600'],256,'partial']);
  // Nothing counts among 257 unregistered seats: eligible 0, but partial, not a complete zero.
  ({h}=await holder(low(257),{}));
  assert.deepEqual([h.eligible,h.size,h.recheck,h.seats.length],[0,null,'partial',256]);
  // Online seats outrank registered offline ones: 256 registered seats, none seen online, and #1000, online, is kept.
  const all=[...low(256),'1000'];
  ({h}=await holder(all,Object.fromEntries(all.map((id,i)=>[id,String(50000+i)])),['1000']));
  assert.deepEqual([h.eligible,h.recheck,h.seats.length,h.seats.filter(s=>s.counts).map(s=>s.tokenId)],[1,'partial',256,['1000']]);
  // Both apply (the index refused, and the roster alone names 257): 'limited' is named.
  ({h}=await holder(low(257),{},[],{CHAIN_LIMITER:{limit:async()=>({success:false})}}));
  assert.deepEqual([h.recheck,h.seats.length],['limited',256]);
  // The index stopped at its page cap (NFT_PAGE_CAP, 5 pages) with more pages left: under 256 ids, yet not the whole list,
  // so partial too; the seats it did name are proven as always.
  const E=newAccount(),e=E.address.toLowerCase(),we=setup({imd:fakeImd({seats:{1000:'77777'},owners:owners(2000,{}),online:[1000]}),chain:fakeChain({owners:{7:e,1000:e}})});
  we.chain.state.endlessPages=true;
  const he=await body(await (await signedIn(we,E)).get('/api/me/home'));
  assert.deepEqual([he.seats.map(s=>s.tokenId),he.eligible,he.recheck,we.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL)).length],[['7','1000'],1,'partial',5]);
  // Each page named the same two ids again: the answer kept in D1 names each once.
  await Promise.all(we.kept);
  assert.deepEqual(JSON.parse(we.db.raw.prepare('SELECT ids FROM index_candidates WHERE address=?').get(e).ids),['1000','7']);
});

// A-4, the other sizes (Codex plan, patch C): under the cap the answer is complete; far past it the seat that counts is
// still found and the cost stays at most 256 ownerOf in two eth_calls.
test('A-4: under the cap a read is complete; far past it (600 or 301 candidates) the seat that counts is still found and the cost stays two eth_calls',async()=>{
  // 100 unregistered seats: every one checked in one eth_call, a complete answer (no recheck).
  let {h,rpc}=await holder(low(100),{});
  assert.deepEqual([h.eligible,h.size,h.recheck,h.seats.length,rpc],[0,null,undefined,100,1]);
  // 599 unregistered low ids and #1999, the one registered seat, online: #1999 is checked and counts.
  ({h,rpc}=await holder([...low(599),'1999'],{1999:'77777'}));
  assert.deepEqual([h.eligible,h.size,h.recheck,h.seats.length,h.seats.filter(s=>s.counts).map(s=>s.tokenId),rpc],[1,'s','partial',256,['1999'],2]);
  // 301 registered seats, all online: 256 of them are checked and count, the rest are not listed; still two eth_calls.
  const all=[...low(300),'1999'];
  ({h,rpc}=await holder(all,Object.fromEntries(all.map((id,i)=>[id,String(60000+i)]))));
  assert.deepEqual([h.eligible,h.size,h.recheck,h.seats.length,rpc],[256,'xl','partial',256,2]);
});

// SEC-3 / INT-2: the public route made one keyed getNFTsForOwner(withMetadata) per distinct address, for anyone.
test('public assets: no session, 5-minute public cache, seats from IMD’s roster with no keyed read at all, characters empty until configured',async()=>{
  const a=newAccount(),me=a.address.toLowerCase(),w=world({swarmOwners:{361:me,921:me},online:[361],chain:{361:me,921:me}});
  const r=await w.call(new Request('https://imdember.com/api/wallet/'+a.address+'/assets'));
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'public, max-age=300');
  for(const [name] of r.headers)assert.ok(!name.startsWith('access-control-'));
  const v=await body(r);
  assert.equal(v.address,a.address);assert.equal(v.source,'imd');
  assert.deepEqual(v.seats.map(s=>[s.tokenId,s.image,s.online,s.counts,s.reason??null]),[['361',null,true,true,null],['921',null,false,false,'not-seen']]);
  assert.deepEqual(v.characters,{collections:[],items:[],state:'ok'});
  // 100 distinct addresses (a scan) from one client: every one answered, not one Alchemy request.
  for(let i=0;i<100;i++)assert.equal((await w.call(new Request('https://imdember.com/api/wallet/'+newAccount().address+'/assets'))).status,200);
  assert.equal(w.chain.state.calls.length,0,'no keyed call from the public route');
  // No key is no different (nothing to ask); IMD's swarm unavailable is 503 (no-store), never an empty wallet.
  const nokey=setup({key:null,imd:fakeImd({seats:{361:'1'},owners:owners(2000,{361:me}),online:[]})});
  assert.deepEqual((await body(await nokey.call(new Request('https://imdember.com/api/wallet/'+me+'/assets')))).seats.map(s=>s.tokenId),['361']);
  const noSwarm=world({swarmOwners:{361:me}});noSwarm.imd.state.fail.add('/swarm');
  const n=await noSwarm.call(new Request('https://imdember.com/api/wallet/'+me+'/assets'));
  assert.equal(n.status,503);assert.equal(n.headers.get('cache-control'),'no-store');assert.deepEqual(await body(n),{error:'OWNERSHIP_UNAVAILABLE'});
});

test('character NFTs, once configured: keyed reads only within the global budget (fail closed), cached 5 min, a failure not re-asked for 60 s',async()=>{
  const pepe='0x'+'5e'.repeat(20),collections=[{id:'pepe',name:{zh:'Pepe',en:'Pepe'},chainId:1,contract:pepe}];
  const a=newAccount(),me=a.address.toLowerCase(),budget=[];let allowed=true;
  const w=setup({collections,imd:fakeImd({seats:{361:'1'},owners:owners(2000,{361:me}),online:[361]}),
    env:{CHAIN_LIMITER:{limit:async({key})=>{budget.push(key);return {success:allowed};}}}});
  w.chain.state.characters[me]=[{contract:pepe,tokenId:'7'}];
  const get=async(addr=me)=>body(await w.call(new Request('https://imdember.com/api/wallet/'+addr+'/assets')));
  const index=()=>w.chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL));
  let v=await get();
  assert.deepEqual(v.characters.items.map(n=>[n.contract,n.tokenId]),[[pepe,'7']]);assert.equal(v.characters.state,'ok');
  assert.deepEqual(new URL(index()[0].url).searchParams.getAll('contractAddresses[]'),[pepe],'only the character contracts');
  assert.deepEqual(budget,['chain:assets'],'one constant key: a global (per-location) budget');
  await get();assert.equal(index().length,1,'cached 5 min');
  // Budget refused: no keyed read, the seats still answer, the list says unavailable (never "no Pepe") and is not re-asked for 60 s.
  allowed=false;const other=newAccount().address;v=await get(other);
  assert.equal(v.characters.state,'unavailable');assert.equal(index().length,1);
  allowed=true;await get(other);assert.equal(budget.length,2,'within 60 s of a failure the budget is not even asked');
  w.clock.advance(60_000);v=await get(other);assert.equal(v.characters.state,'ok');assert.equal(index().length,2);
  // Without the binding (a production deployment: 503) or with it down there is no keyed read at all.
  const bare=setup({collections,env:{CHAIN_LIMITER:undefined}}),u=await bare.call(new Request('https://imdember.com/api/wallet/'+me+'/assets'));
  assert.deepEqual([u.status,(await body(u)).error],[503,'LIMITER_UNAVAILABLE']);assert.equal(bare.chain.state.calls.length,0);
  const down=setup({collections,env:{CHAIN_LIMITER:{limit:async()=>{throw new Error('down');}}}});
  assert.equal((await body(await down.call(new Request('https://imdember.com/api/wallet/'+me+'/assets')))).characters.state,'unavailable');
  assert.equal(down.chain.state.calls.length,0);
});

test('CHAIN_MOCK_OWNERS (local E2E) acts only on a loopback URL, never on imdember.com',async()=>{
  const a=newAccount(),me=a.address.toLowerCase();
  const w=setup({key:null,imd:fakeImd({seats:{361:'51320'},owners:owners(2000,{}),online:[361]}),env:{CHAIN_MOCK_OWNERS:JSON.stringify({361:a.address})}});
  const prod=w.browser();assert.equal((await prod.signIn(a)).verify.status,200);
  assert.equal((await prod.get('/api/me/home')).status,503,'production host ignores the mock (no key: nothing to ask)');
  const b=w.browser('http://localhost:8792','http://localhost:8792');assert.equal((await b.signIn(a)).verify.status,200);
  const home=await body(await b.get('/api/me/home'));assert.equal(home.eligible,1);assert.equal(home.address.toLowerCase(),me);
});

// INT-5: the heaviest wallet request is a cold /api/me/home (parse both rosters, derive the world, prove the seats), not
// verify. A fresh process times it for a 20-seat holder with production-shaped upstreams (fixtures/cold-home.mjs), against
// noble's window-8 table built afterwards under the same load. Measured idle on 2026-09-28: home 17–19 ms, table 18 ms.
test('a cold /api/me/home for a 20-seat holder costs less than two window-8 tables built under the same load',async()=>{
  const {upstreams,HOLDER_SEATS}=await import('./fixtures/cold-home.mjs');
  const {owner,text}=upstreams(),swarm=JSON.parse(text['/swarm']),recorded={};
  // Alchemy's two answers for this owner, recorded here (warm), replayed as text in the child.
  const chain=fakeChain({owners:Object.fromEntries(swarm.owners.map((o,i)=>[String(i),o.toLowerCase()]))});
  const w=setup({imd:{state:{},fetcher:async url=>new Response(text[String(url).replace('https://api.imd.fun','')])},
    chain:{state:chain.state,fetcher:async(url,init)=>{const r=await chain.fetcher(url,init);recorded[String(url).startsWith(ALCHEMY_NFTS_URL)?'index':'rpc']=await r.clone().text();return r;}}});
  const {sha256}=await import('../server/auth.ts'),token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  w.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) VALUES(?,?,1,?,?,?)').run(await sha256(token),owner,START,START+DAY,'rec');
  const warm=await body(await w.call(new Request('https://imdember.com/api/me/home',{headers:{cookie:'__Host-imd_session='+token}})));
  assert.equal(warm.eligible,HOLDER_SEATS);assert.ok(recorded.index&&recorded.rpc);
  const {spawn}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
  const run=()=>new Promise((resolve,reject)=>{const c=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/cold-home.mjs',import.meta.url))],{stdio:['pipe','pipe','inherit']});
    let out='';c.stdout.on('data',d=>out+=d);c.on('exit',()=>{try{resolve(JSON.parse(out));}catch(e){reject(e);}});c.stdin.end(JSON.stringify(recorded));});
  const good=r=>r.status===200&&r.eligible===HOLDER_SEATS&&r.homeMs<2*r.tableMs,runs=[];
  for(let i=0;i<5&&!runs.some(good);i++)runs.push(await run());
  console.log('cold /api/me/home (20 seats):',runs.map(r=>r.homeMs.toFixed(1)+' ms (window-8 table '+r.tableMs.toFixed(1)+')').join(' / '));
  assert.ok(runs.some(good),JSON.stringify(runs));
});

// INT-4: the Worker used houseSize through households.ts, so every cold isolate evaluated layout.ts (and, after the canal
// merge, its geometry). A fresh process imports the Worker entry with a resolve hook and lists every module it loads.
test('the Worker entry never loads layout.ts or households.ts; the client’s houseSize is the same function',async()=>{
  const {execFileSync}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
  const entry=new URL('../worker/index.ts',import.meta.url).href;
  const out=execFileSync(process.execPath,['--input-type=module','-e',`import {registerHooks} from 'node:module';const seen=new Set();
    registerHooks({resolve(s,c,next){const r=next(s,c);if(r.url.startsWith('file:')&&!r.url.includes('/node_modules/'))seen.add(r.url);return r;}});
    await import(${JSON.stringify(entry)});console.log(JSON.stringify([...seen]));`],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
  const loaded=JSON.parse(out);                                        // file: URLs of the repo's own modules
  assert.ok(loaded.some(u=>u.endsWith('server/ownership.ts'))&&loaded.some(u=>u.endsWith('src/world/houseSize.ts')),loaded.join(' '));
  for(const f of ['src/world/layout.ts','src/world/households.ts'])assert.ok(!loaded.some(u=>u.endsWith(f)),f+' is in the Worker: '+loaded.join(' '));
  assert.equal(houseSize,(await import('../src/world/houseSize.ts')).houseSize);
});
