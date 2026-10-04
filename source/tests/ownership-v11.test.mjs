import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';
import {openD1} from './d1-sqlite.mjs';

// Fixed normative controls load either the candidate or a frozen source using one unchanged evaluator.
// All addresses, times, blocks, index rows and RPC replies are fixtures; no upstream/wallet requests occur.
const root=process.env.V11_SOURCE?resolve(process.env.V11_SOURCE):fileURLToPath(new URL('../',import.meta.url));
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {Ownership,ALCHEMY_RPC_URL,ALCHEMY_NFTS_URL,MULTICALL3,CANDIDATE_CAP,OWNERSHIP_TTL_MS,FAILED_LIST_MS}=await load('server/ownership.ts');
const {SEAT_COLLECTION}=await load('src/world/market.ts');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),START=Date.UTC(2026,9,4,12),BLOCK=21_000_000;
const OWNER_OF=[{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{name:'',type:'address'}]}];
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};

function fixture({roster=['7'],index=['7'],owners={7:A},db,collections=[]}={}){
  const state={now:START,block:BLOCK,admit:true,index:[...index],roster:[...roster],online:null,owners:{...owners},history:new Map(),
    budget:0,indexPages:0,rpc:0,ids:[],tags:[],lanes:0,failIndex:false,failRpc:false,holdRpc:null,holdIndex:null};
  const gateway={async source(name){
    const list=[...new Set([...state.roster,...state.index])],swarmOwners=[];
    for(const id of state.roster)swarmOwners[Number(id)]=A;
    const online=state.online??list;
    return {state:'fresh',fetchedAt:state.now,url:'fixture://'+name,data:name==='swarm'?
      {at:1,seats:Object.fromEntries(list.map(id=>[id,{tokenId:Number(id),agentId:String(Number(id)+700)}])),owners:swarmOwners}:
      {count:online.length,workers:online.map(id=>({seat:{tokenId:id,agentId:String(Number(id)+700)},working:0,runtimes:[],lastHeartbeatAt:'2026-10-04T11:59:00Z'}))}};
  }};
  const fetcher=async(input,init={})=>{
    const url=String(input);
    if(url.startsWith(ALCHEMY_NFTS_URL+'?')){
      state.indexPages++;if(state.holdIndex){const gate=state.holdIndex;state.holdIndex=null;gate.started.resolve();await gate.release.promise;}
      return state.failIndex?new Response('{}',{status:502}):Response.json({ownedNfts:state.index.map(tokenId=>({contract:{address:SEAT_COLLECTION},tokenId})),pageKey:null});
    }
    assert.equal(url,ALCHEMY_RPC_URL);state.rpc++;
    const body=JSON.parse(init.body);assert.equal(body.method,'eth_call');
    const tag=body.params[1],calls=decodeFunctionData({abi:multicall3Abi,data:body.params[0].data}).args[0],asked=[];
    const block=tag==='latest'?state.block:Number(BigInt(tag));
    if(tag==='latest'&&!state.history.has(block))state.history.set(block,{...state.owners});
    const at=state.history.get(block)??state.owners;
    const result=calls.map(c=>c.target===MULTICALL3?{success:true,returnData:encodeAbiParameters([{type:'uint256'}],[BigInt(block)])}:(()=>{
      const id=String(decodeFunctionData({abi:OWNER_OF,data:c.callData}).args[0]);asked.push(id);const owner=at[id];
      return owner?{success:true,returnData:encodeFunctionResult({abi:OWNER_OF,functionName:'ownerOf',result:owner})}:{success:false,returnData:'0x'};
    })());
    state.ids.push(asked);state.tags.push(tag);
    if(state.holdRpc){const gate=state.holdRpc;state.holdRpc=null;gate.started.resolve();await gate.release.promise;}
    if(state.failRpc)return new Response('{}',{status:502});
    return Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result})});
  };
  const ownership=new Ownership(gateway,collections),kept=[];
  const req=()=>({chain:{key:'synthetic-only',fetch:fetcher},db,now:state.now,clock:()=>state.now,waitUntil:p=>kept.push(p),
    budget:async()=>{state.budget++;return state.admit;}});
  const home=(fresh=true,extra={})=>ownership.home(A,{...req(),...extra},fresh);
  const assets=(extra={})=>ownership.assets(A,{...req(),...extra});
  const lane=async()=>{state.lanes++;return true;};
  return {state,home,assets,lane,settle:()=>Promise.all(kept)};
}
const projection=f=>({budget:f.state.budget,indexPages:f.state.indexPages,rpc:f.state.rpc,ownerIds:f.state.ids,blockTags:f.state.tags,lanes:f.state.lanes});
const seatIds=h=>h.seats.map(s=>s.tokenId);

test('OWN-I1/I3: index at 0s, ordinary proof at 31s, fresh at 32s uses two RPCs rather than three',async t=>{
  const f=fixture();await f.home(false);f.state.now=START+31_000;const proof=await f.home(false);
  f.state.now=START+32_000;const fresh=await f.home(true);
  assert.equal(f.state.indexPages,2);assert.equal(f.state.rpc,2);assert.equal(fresh.checkedAt,proof.checkedAt);assert.equal(fresh.block,proof.block);
  assert.deepEqual(seatIds(fresh),['7']);t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I3: twenty refused fresh reads retain one budget attempt and one proof RPC',async t=>{
  const f=fixture();f.state.admit=false;
  for(let i=0;i<20;i++){f.state.now=START+i*1000;const h=await f.home();assert.equal(h.checkedAt,START);assert.equal(h.recheck,'limited');}
  assert.deepEqual([f.state.budget,f.state.indexPages,f.state.rpc],[1,0,1]);t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1: fresh discovery verifies only unseen candidates at the existing epoch block/deadline',async t=>{
  const f=fixture({owners:{7:A,8:A,9:B}});await f.home(false);f.state.now=START+31_000;const ordinary=await f.home(false);
  f.state.now=START+32_000;f.state.block=BLOCK+1;f.state.owners[8]=B;f.state.index=['7','8','9','10'];
  const h=await f.home();assert.deepEqual(seatIds(h),['7','8']);assert.equal(h.checkedAt,ordinary.checkedAt);assert.equal(h.block,BLOCK);
  assert.deepEqual(f.state.ids,[['7'],['7'],['8','9','10']]);assert.deepEqual(f.state.tags,['latest','latest','0x'+BLOCK.toString(16)]);
  // #9 is wrong-owner; #10 reverts. A repeated hint/lane cannot turn either into ownership or re-prove them.
  f.state.now=START+33_000;await f.home(true,{lane:f.lane});assert.equal(f.state.rpc,3);t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1: repeated admitted lanes reuse positive, negative and reverting candidate evidence',async t=>{
  const f=fixture({roster:['7','9','10'],index:['7','9','10'],owners:{7:B,9:B}});f.state.admit=false;
  for(let i=0;i<20;i++){f.state.now=START+i*1000;const h=await f.home(true,{lane:f.lane});assert.deepEqual(h.seats,[]);}
  assert.equal(f.state.rpc,1);assert.deepEqual(f.state.ids,[['7','9','10']]);assert.equal(f.state.lanes,1);assert.equal(f.state.indexPages,1);
  t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1: refused lane sends no extra ownerOf; admitted buyer lane proves only its new candidate',async t=>{
  const f=fixture({roster:['7'],index:['7','8'],owners:{7:B,8:A}});f.state.admit=false;
  const first=await f.home(true,{lane:async()=>{f.state.lanes++;return false;}});assert.equal(first.recheck,'limited');assert.equal(f.state.rpc,1);
  f.state.now=START+1;const buyer=await f.home(true,{lane:f.lane});assert.deepEqual(seatIds(buyer),['8']);assert.equal(buyer.eligible,1);
  assert.deepEqual(f.state.ids,[['7'],['8']]);assert.equal(buyer.checkedAt,first.checkedAt);assert.equal(buyer.block,first.block);
  t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1: concurrent fresh discovery and a held delta share the index and RPC once',async t=>{
  const f=fixture({owners:{7:A,8:A}});await f.home(false);f.state.now=START+31_000;await f.home(false);
  f.state.now=START+32_000;f.state.index=['7','8'];const gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
  const first=f.home();await gate.started.promise;const rest=Array.from({length:19},()=>f.home());gate.release.resolve();
  const homes=await Promise.all([first,...rest]);assert.ok(homes.every(h=>seatIds(h).join(',')==='7,8'));
  assert.deepEqual([f.state.budget,f.state.indexPages,f.state.rpc],[2,2,3]);assert.deepEqual(f.state.ids,[['7'],['7'],['8']]);
  t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1/I3: discovery held across the proof deadline starts a latest epoch and drops a sold seat',async t=>{
  const f=fixture();await f.home(false);f.state.now=START+31_000;const ordinary=await f.home(false);
  f.state.now=START+32_000;const gate={started:deferred(),release:deferred()};f.state.holdIndex=gate;
  const reading=f.home();await gate.started.promise;
  f.state.now=START+62_000;f.state.block=BLOCK+1;f.state.owners[7]=B;gate.release.resolve();
  const h=await reading;assert.deepEqual(seatIds(h),[]);assert.equal(h.eligible,0);assert.equal(h.recheck,undefined);
  assert.equal(h.checkedAt,START+62_000);assert.notEqual(h.checkedAt,ordinary.checkedAt);assert.equal(h.block,BLOCK+1);
  assert.deepEqual(f.state.tags,['latest','latest','latest']);assert.deepEqual([f.state.indexPages,f.state.rpc],[2,3]);
  t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1: a request with a changed roster during held proof receives its own verified delta',async t=>{
  const f=fixture({owners:{7:A,8:A}}),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
  const first=f.home();await gate.started.promise;f.state.roster=['7','8'];const second=f.home();gate.release.resolve();
  const [a,b]=await Promise.all([first,second]);assert.deepEqual(seatIds(a),['7']);assert.deepEqual(seatIds(b),['7','8']);assert.equal(b.recheck,undefined);
  assert.deepEqual(f.state.ids,[['7'],['8']]);assert.equal(f.state.budget,1);assert.equal(f.state.rpc,2);assert.equal(a.checkedAt,b.checkedAt);
  t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I1: the entire epoch examines at most 256 IDs across arbitrarily many discoveries',async t=>{
  const first=Array.from({length:CANDIDATE_CAP-1},(_,i)=>String(i)),owners=Object.fromEntries([...first,'1000','1001'].map(id=>[id,A]));
  const f=fixture({roster:first,index:first,owners});await f.home(false);f.state.now=START+31_000;const epoch=await f.home(false);
  f.state.now=START+32_000;f.state.index=[...first,'1000','1001'];const h=await f.home();
  assert.equal(h.checkedAt,epoch.checkedAt);assert.equal(h.seats.length,CANDIDATE_CAP);assert.equal(h.recheck,'partial');
  assert.deepEqual(f.state.ids.at(-1),['1000']);assert.equal(f.state.ids.slice(2).flat().length,CANDIDATE_CAP);
  f.state.now=START+33_000;await f.home();assert.equal(f.state.rpc,5,'2 initial chunks, 2 new-epoch chunks, one delta');
  t.diagnostic(JSON.stringify({counts:projection(f),checkedAt:h.checkedAt,checkedCandidates:256,recheck:h.recheck}));
});

test('OWN-I1: the last delta slot ranks an owner-specific recent sighting ahead of an older offline candidate',async()=>{
  const db=openD1();try{
    const first=Array.from({length:CANDIDATE_CAP-1},(_,i)=>String(i)),owners=Object.fromEntries([...first,'1000','1001'].map(id=>[id,A]));
    const f=fixture({roster:first,index:first,owners,db});f.state.online=[];await f.home(false);f.state.now=START+31_000;await f.home(false);
    db.raw.prepare('INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at) VALUES(?,?,?,?)').run(1001,A,START,START);
    f.state.now=START+32_000;f.state.index=[...first,'1000','1001'];const h=await f.home();assert.deepEqual(f.state.ids.at(-1),['1001']);
    assert.equal(h.eligible,1);assert.equal(h.recheck,'partial');assert.equal(h.seats.some(s=>s.tokenId==='1000'),false);
    await f.settle();
  }finally{db.raw.close();}
});

test('OWN-I1: failed delta IDs also consume the epoch cap, preventing a stream of failed new candidates',async()=>{
  const first=Array.from({length:CANDIDATE_CAP-1},(_,i)=>String(i)),owners=Object.fromEntries([...first,'1000','1001'].map(id=>[id,A]));
  const f=fixture({roster:first,index:first,owners});await f.home(false);f.state.now=START+31_000;await f.home(false);
  f.state.now=START+32_000;f.state.index=[...first,'1000'];f.state.failRpc=true;assert.equal((await f.home()).recheck,'limited');assert.equal(f.state.rpc,5);
  f.state.now=START+33_000;f.state.roster=[...first,'1001'];f.state.failRpc=false;const h=await f.home();assert.equal(f.state.rpc,5);
  assert.equal(h.recheck,'limited');assert.equal(h.seats.length,CANDIDATE_CAP-1);assert.ok(!h.seats.some(s=>s.tokenId==='1000'||s.tokenId==='1001'));
});

for(const age of [OWNERSHIP_TTL_MS-1,OWNERSHIP_TTL_MS,OWNERSHIP_TTL_MS+1])test('OWN-I1/I3: sold-seat boundary at '+age+' ms',async()=>{
  const f=fixture();const initial=await f.home();f.state.now=START+age;f.state.block=BLOCK+1;f.state.owners[7]=B;
  const h=await f.home();const valid=age<OWNERSHIP_TTL_MS;assert.equal(h.eligible,valid?1:0);assert.equal(f.state.rpc,valid?1:2);
  assert.equal(h.checkedAt,valid?initial.checkedAt:START+age);assert.equal(h.block,valid?BLOCK:BLOCK+1);
});

for(const fresh of [false,true])test('OWN-I2: admitted index and owner evidence expire on backwards clock (fresh='+fresh+')',async t=>{
  const f=fixture();await f.home(fresh);f.state.now=START-1;f.state.block=BLOCK+1;f.state.owners[7]=B;
  const h=await f.home(fresh);assert.equal(h.eligible,0);assert.equal(h.checkedAt,START-1);assert.equal(f.state.rpc,2);assert.equal(f.state.indexPages,2);
  t.diagnostic(JSON.stringify(projection(f)));
});

for(const now of [NaN,Infinity,-Infinity])test('OWN-I2: non-finite request time '+String(now)+' cannot return cached authority',async()=>{
  const f=fixture();await f.home();f.state.now=now;await assert.rejects(f.home(),/OWNERSHIP_UNAVAILABLE/);assert.equal(f.state.rpc,1);
});

test('OWN-I2: a backwards clock while a first RPC is held cannot install future evidence',async()=>{
  const f=fixture(),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
  const held=f.home();await gate.started.promise;f.state.now=START-1;gate.release.resolve();await assert.rejects(held,/OWNERSHIP_UNAVAILABLE/);
  f.state.block=BLOCK+1;f.state.owners[7]=B;assert.equal((await f.home()).eligible,0);assert.equal(f.state.rpc,2);
});

test('OWN-I2: a held RPC completing at the epoch deadline cannot install an already-expired proof',async()=>{
  const f=fixture(),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
  const held=f.home();await gate.started.promise;f.state.now=START+OWNERSHIP_TTL_MS;gate.release.resolve();await assert.rejects(held,/OWNERSHIP_UNAVAILABLE/);
  f.state.block=BLOCK+1;f.state.owners[7]=B;assert.equal((await f.home()).eligible,0);assert.equal(f.state.rpc,2);
});

test('OWN-I2: a future D1 timestamp neither overrides a valid local index nor becomes fresh authority',async()=>{
  const db=openD1();try{
    const f=fixture({roster:[],db});await f.home();await f.settle();db.raw.prepare('UPDATE index_candidates SET ids=?,read_at=? WHERE address=?').run(JSON.stringify(['8']),START+999_999,A);
    f.state.now=START+31_000;f.state.admit=false;const h=await f.home();assert.deepEqual(seatIds(h),['7']);assert.equal(h.recheck,'limited');
    assert.deepEqual(f.state.ids,[['7'],['7']]);
  }finally{db.raw.close();}
});

test('OWN-I1: twenty failed-delta refreshes keep prior limited evidence and retry only at the original deadline',async t=>{
  const f=fixture({owners:{7:A,8:A}});await f.home(false);f.state.now=START+31_000;const previous=await f.home(false);
  f.state.now=START+32_000;f.state.index=['7','8'];f.state.failRpc=true;const h=await f.home();
  assert.deepEqual(seatIds(h),['7']);assert.equal(h.recheck,'limited');assert.equal(h.checkedAt,previous.checkedAt);assert.equal(h.block,previous.block);
  f.state.failRpc=false;for(let i=1;i<20;i++){f.state.now=START+32_000+i*1000;const cached=await f.home();assert.deepEqual(seatIds(cached),['7']);assert.equal(cached.recheck,'limited');}
  assert.equal(f.state.rpc,3);assert.equal(f.state.ids.flat().filter(id=>id==='8').length,1);
  f.state.now=START+61_000;const retry=await f.home();assert.deepEqual(seatIds(retry),['7','8']);assert.equal(retry.checkedAt,START+61_000);
  assert.deepEqual(f.state.ids,[['7'],['7'],['8'],['7','8']]);t.diagnostic(JSON.stringify(projection(f)));
});

test('OWN-I2: failed held delta cannot return old authority after rollback or expiry',async()=>{
  for(const done of [START+30_999,START+61_000]){
    const f=fixture({owners:{7:A,8:A}});await f.home(false);f.state.now=START+31_000;await f.home(false);
    f.state.now=START+32_000;f.state.index=['7','8'];f.state.failRpc=true;const gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
    const held=f.home();await gate.started.promise;f.state.now=done;gate.release.resolve();await assert.rejects(held,/OWNERSHIP_UNAVAILABLE/);
  }
});

test('OWN-I1: first/expired RPC failure remains unavailable and is not cached as an empty complete home',async()=>{
  const f=fixture();f.state.failRpc=true;await assert.rejects(f.home(),/OWNERSHIP_UNAVAILABLE/);f.state.failRpc=false;await f.home();
  f.state.now=START+OWNERSHIP_TTL_MS;f.state.failRpc=true;await assert.rejects(f.home(),/OWNERSHIP_UNAVAILABLE/);assert.equal(f.state.rpc,3);
});

test('OWN-I1: index failure preserves existing fallback candidates as limited; no retained index is unavailable',async()=>{
  const f=fixture();await f.home();f.state.now=START+31_000;f.state.failIndex=true;const h=await f.home();assert.equal(h.recheck,'limited');assert.deepEqual(seatIds(h),['7']);
  const cold=fixture({roster:[]});cold.state.failIndex=true;await assert.rejects(cold.home(),/OWNERSHIP_UNAVAILABLE/);assert.equal(cold.state.rpc,0);
});

test('OWN-I2: character success-cache and failure-backoff both reject negative age',async()=>{
  const collections=[{id:'fixture',name:{zh:'測試',en:'Test'},contract:SEAT_COLLECTION}];
  const good=fixture({collections});await good.assets();good.state.now=START-1;await good.assets();assert.equal(good.state.indexPages,2);
  const failed=fixture({collections});failed.state.failIndex=true;assert.equal((await failed.assets()).characters.state,'unavailable');
  failed.state.now=START+FAILED_LIST_MS-1;failed.state.failIndex=false;assert.equal((await failed.assets()).characters.state,'unavailable');assert.equal(failed.state.indexPages,1);
  failed.state.now=START-1;assert.equal((await failed.assets()).characters.state,'ok');assert.equal(failed.state.indexPages,2);
});

test('OWN-I2: character failure-backoff expires at exact TTL and later',async()=>{
  for(const age of [FAILED_LIST_MS,FAILED_LIST_MS+1]){const f=fixture({collections:[{id:'fixture',name:{zh:'測試',en:'Test'},contract:SEAT_COLLECTION}]});
    f.state.failIndex=true;await f.assets();f.state.now=START+age;f.state.failIndex=false;assert.equal((await f.assets()).characters.state,'ok');assert.equal(f.state.indexPages,2);}
});
