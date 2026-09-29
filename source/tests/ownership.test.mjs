import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain,START} from './wallet-harness.mjs';
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
  for(const fail of ['network','http','rpc-error','index']){
    w.chain.state.fail=fail;
    if(fail==='index')w.clock.advance(5*60_000);                     // the index answer from the rpc-error round has expired
    const r=await b.get('/api/me/home');
    assert.equal(r.status,503,fail);assert.deepEqual(await body(r),{error:'OWNERSHIP_UNAVAILABLE'});
  }
  w.chain.state.fail=null;
  const ok=await body(await b.get('/api/me/home'));assert.equal(ok.eligible,1,'the failure was not remembered');
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
  assert.equal(home.seats.length,ids.length);
  const calls=big.chain.state.calls.filter(c=>c.url===ALCHEMY_RPC_URL).map(c=>JSON.parse(c.body).params[1]);
  assert.deepEqual(calls,['latest','0x'+(21_000_000).toString(16)]);
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
