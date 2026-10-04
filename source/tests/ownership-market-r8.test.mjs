import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';
import {openD1} from './d1-sqlite.mjs';

// One unchanged evaluator loads either the frozen e48 source or the candidate. All upstreams/clocks are local.
const root=process.env.R8_SOURCE?resolve(process.env.R8_SOURCE):fileURLToPath(new URL('../',import.meta.url));
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {Ownership,ALCHEMY_RPC_URL,ALCHEMY_NFTS_URL,MULTICALL3,OWNERSHIP_TTL_MS}=await load('server/ownership.ts');
const {ReadGateway}=await load('server/gateway.ts');
const {selectMarket,ethUsd,withUsd,marketView,floorView,SEAT_COLLECTION,IMD_TOKEN,MARKET_URL,FLOOR_MAX_AGE_MS}=await load('src/world/market.ts');
const A='0x'+'1'.repeat(40),B='0x'+'2'.repeat(40),START=Date.UTC(2026,9,4,12);
const OWNER_OF=[{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{name:'',type:'address'}]}];

function fixture({roster=true,index=['7'],online=true,db}={}){
  const state={now:START,admit:false,failIndex:false,failRpc:false,owners:{7:A},index:[...index],asks:0,indexReads:0,ethCalls:0,lanes:0};
  const upstream=async input=>{
    const path=new URL(String(input)).pathname,owners=Array(9).fill(null);if(roster)owners[7]=A;
    return Response.json(path==='/swarm'?{at:1,seats:{7:{tokenId:7,agentId:'700'},8:{tokenId:8,agentId:'800'}},owners}:
      {count:online?2:0,workers:online?[7,8].map(id=>({seat:{tokenId:String(id),agentId:String(id)+'00'},working:0,runtimes:[],lastHeartbeatAt:'2026-10-04T11:59:00Z'})):[]});
  };
  const fetcher=async(input,init={})=>{
    const url=String(input);
    if(url.startsWith(ALCHEMY_NFTS_URL+'?')){state.indexReads++;return state.failIndex?new Response('{}',{status:502}):Response.json({ownedNfts:state.index.map(tokenId=>({contract:{address:SEAT_COLLECTION},tokenId})),pageKey:null});}
    assert.equal(url,ALCHEMY_RPC_URL);state.ethCalls++;
    if(state.failRpc)return new Response('{}',{status:502});
    const body=JSON.parse(init.body);assert.equal(body.method,'eth_call');
    const calls=decodeFunctionData({abi:multicall3Abi,data:body.params[0].data}).args[0];
    const result=calls.map(c=>c.target===MULTICALL3?{success:true,returnData:encodeAbiParameters([{type:'uint256'}],[21_000_000n])}:(()=>{
      const id=String(decodeFunctionData({abi:OWNER_OF,data:c.callData}).args[0]),owner=state.owners[id];
      return owner?{success:true,returnData:encodeFunctionResult({abi:OWNER_OF,functionName:'ownerOf',result:owner})}:{success:false,returnData:'0x'};
    })());
    return Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result})});
  };
  const o=new Ownership(new ReadGateway(upstream,()=>state.now),[]),kept=[];
  const req=()=>({chain:{key:'synthetic-test-only',fetch:fetcher},db,now:state.now,clock:()=>state.now,
    waitUntil:p=>kept.push(p),budget:async()=>{state.asks++;return state.admit;}});
  const home=(fresh=true,extra={},address=A)=>o.home(address,{...req(),...extra},fresh);
  return {state,home,settle:()=>Promise.all(kept)};
}
const counts=s=>({asks:s.asks,indexReads:s.indexReads,ethCalls:s.ethCalls,lanes:s.lanes});
async function twenty(t,f,{fresh=true}={}){
  const views=[];for(let i=0;i<20;i++){f.state.now=START+i*1000;views.push(await f.home(fresh));}
  t.diagnostic(JSON.stringify({calls:counts(f.state),checkedAt:views.map(h=>h.checkedAt),eligible:views.map(h=>h.eligible),recheck:views.map(h=>h.recheck??null)}));return views;
}

test('R8-L5 original: twenty refused fresh reads inside 30s share one ownerOf proof and one budget ask',async t=>{
  const f=fixture(),views=await twenty(t,f);assert.deepEqual(counts(f.state),{asks:1,indexReads:0,ethCalls:1,lanes:0});
  assert.ok(views.every(h=>h.eligible===1&&h.recheck==='limited'&&h.checkedAt===START));
});
test('R8-L5 control: refused ordinary reads already share the 30s proof',async t=>{
  const f=fixture();await twenty(t,f,{fresh:false});assert.equal(f.state.ethCalls,1);assert.equal(f.state.asks,1);
});
test('R8-L5 control: admitted fresh reads keep the young index and proof',async t=>{
  const f=fixture();f.state.admit=true;const views=await twenty(t,f);assert.deepEqual(counts(f.state),{asks:1,indexReads:1,ethCalls:1,lanes:0});assert.ok(views.every(h=>h.recheck===undefined));
});
test('R8-L5 empty refused candidates still cache the refusal without a keyed RPC',async t=>{
  const f=fixture({roster:false,index:[]}),views=await twenty(t,f);assert.deepEqual(counts(f.state),{asks:1,indexReads:0,ethCalls:0,lanes:0});assert.ok(views.every(h=>h.eligible===0&&h.recheck==='limited'));
});
test('R8-L5 a stale D1 index is a candidate source, not the refused proof timestamp',async t=>{
  const db=openD1();try{db.raw.prepare('INSERT INTO index_candidates(address,ids,read_at) VALUES(?,?,?)').run(A,JSON.stringify(['7']),START-300_001);
    const f=fixture({roster:false,db}),views=await twenty(t,f);assert.deepEqual(counts(f.state),{asks:1,indexReads:0,ethCalls:1,lanes:0});assert.ok(views.every(h=>h.eligible===1&&h.recheck==='limited'));
  }finally{db.raw.close();}
});
test('R8-L5 a failed index with retained candidates caches its newly checked limited proof too',async t=>{
  const f=fixture({roster:false});f.state.admit=true;await f.home();f.state.now=START+31_000;f.state.failIndex=true;
  const before=counts(f.state);for(let i=0;i<20;i++){f.state.now=START+31_000+i*1000;assert.equal((await f.home()).recheck,'limited');}
  t.diagnostic(JSON.stringify({before,after:counts(f.state)}));assert.equal(f.state.indexReads-before.indexReads,1);assert.equal(f.state.ethCalls-before.ethCalls,1);assert.equal(f.state.asks-before.asks,1);
});
test('R8-L5 exact 30s boundary re-proves a sold seat; 29999ms remains cached',async t=>{
  const f=fixture();await f.home();f.state.owners[7]=B;f.state.now=START+29_999;assert.equal((await f.home()).eligible,1);
  f.state.now=START+OWNERSHIP_TTL_MS;const h=await f.home();t.diagnostic(JSON.stringify({calls:counts(f.state),eligible:h.eligible,recheck:h.recheck}));
  assert.equal(h.eligible,0);assert.equal(h.checkedAt,f.state.now);assert.equal(f.state.ethCalls,2);assert.equal(f.state.asks,2);
});
test('R8 v1.1: admitted fresh discovery preserves a newer ordinary ownerOf proof',async t=>{
  const f=fixture();f.state.admit=true;await f.home();f.state.now=START+31_000;await f.home(false);
  assert.equal(f.state.indexReads,1);assert.equal(f.state.ethCalls,2);f.state.now=START+32_000;await f.home(true);
  t.diagnostic(JSON.stringify(counts(f.state)));assert.equal(f.state.indexReads,2);assert.equal(f.state.ethCalls,2);
});
for(const fresh of [false,true])test('R8-L5 a negative limited-proof age forces a new proof (fresh='+fresh+')',async t=>{
  const f=fixture();await f.home(fresh);f.state.owners[7]=B;f.state.now=START-1;
  const h=await f.home(fresh);t.diagnostic(JSON.stringify({calls:counts(f.state),checkedAt:h.checkedAt,now:f.state.now,eligible:h.eligible}));
  assert.equal(h.eligible,0);assert.equal(h.checkedAt,f.state.now);assert.equal(f.state.ethCalls,2);
  await f.home(fresh);assert.equal(f.state.ethCalls,2,'the newly dated proof is reused at age zero');
});
test('R8-L5 ordinary admitted reads retain the 5 minute index cadence',async()=>{
  const f=fixture();f.state.admit=true;await f.home(false);for(const age of [30_000,60_000,270_000]){f.state.now=START+age;await f.home(false);}
  assert.equal(f.state.indexReads,1);f.state.now=START+300_000;await f.home(false);assert.equal(f.state.indexReads,2);
});
test('R8-L5 an admitted lane explicitly rebuilds a young refused proof and ownerOf rejects false candidates',async t=>{
  const f=fixture({roster:true,index:['7','8']});f.state.owners={7:B,8:A};const lane=async()=>{f.state.lanes++;return true;};
  const h=await f.home(true,{lane});t.diagnostic(JSON.stringify({calls:counts(f.state),seats:h.seats.map(s=>s.tokenId),eligible:h.eligible}));
  assert.deepEqual(h.seats.map(s=>s.tokenId),['8']);assert.equal(h.eligible,1);assert.equal(h.recheck,undefined);
  assert.deepEqual(counts(f.state),{asks:1,indexReads:1,ethCalls:2,lanes:1});
});
test('R8-L5 refused lane cannot cause a second ownerOf proof inside the TTL',async t=>{
  const f=fixture({online:false});for(let i=0;i<20;i++){f.state.now=START+i*1000;const h=await f.home(true,{lane:async()=>{f.state.lanes++;return false;}});assert.equal(h.recheck,'limited');}
  t.diagnostic(JSON.stringify(counts(f.state)));assert.equal(f.state.asks,1);assert.equal(f.state.ethCalls,1);assert.equal(f.state.indexReads,0);
});
test('R8-L5 concurrent refused fresh reads share the actual in-flight proof',async()=>{
  const f=fixture(),views=await Promise.all(Array.from({length:20},()=>f.home()));assert.equal(f.state.ethCalls,1);assert.equal(f.state.asks,1);assert.ok(views.every(h=>h.eligible===1));
});
test('R8-L5 a failed first ownerOf remains unavailable and is not cached as an empty home',async()=>{
  const f=fixture();f.state.failRpc=true;for(let i=0;i<2;i++)await assert.rejects(f.home(),/OWNERSHIP_UNAVAILABLE/);assert.equal(f.state.ethCalls,2);
});
test('R8-L5 proof reuse is per address; it never grants a candidate to a different owner',async()=>{
  const f=fixture();assert.equal((await f.home()).eligible,1);assert.equal((await f.home(true,{},B)).eligible,0);assert.equal(f.state.asks,2);
});
test('R8-L5 an absent index budget is refused, with the same bounded proof reuse',async()=>{
  const f=fixture();for(let i=0;i<20;i++){f.state.now=START+i*1000;assert.equal((await f.home(true,{budget:undefined})).recheck,'limited');}assert.equal(f.state.ethCalls,1);assert.equal(f.state.asks,0);
});

const floor={floorEth:2.5,marketplace:'OpenSea',fetchedAt:START};
const quote=(priceUsd='8',priceNative='0.004')=>selectMarket([{chainId:'ethereum',baseToken:{address:IMD_TOKEN},priceUsd,priceNative,liquidity:{usd:1}}]);
const sample=(q,f=floor,state='fresh')=>({state,data:q,url:MARKET_URL,fetchedAt:START,extras:{floorEnabled:true,floor:f}});
const finiteUsd=f=>f.floorUsd===undefined||(typeof f.floorUsd==='number'&&Number.isFinite(f.floorUsd)&&f.floorUsd>0);
test('R8-I8 original: denormal native price never yields Infinity before or after a JSON wire roundtrip',t=>{
  const q=quote('8','1e-320'),priced=withUsd(floor,q),wire=JSON.parse(JSON.stringify(sample(q,priced))),shown=marketView(wire,START).floor;
  t.diagnostic(JSON.stringify({rate:String(ethUsd(q)),derivedUsd:String(priced.floorUsd),wireUsd:wire.extras.floor.floorUsd,clientUsd:String(shown.floorUsd)}));
  assert.equal(ethUsd(q),null);assert.ok(finiteUsd(priced));assert.ok(finiteUsd(shown));assert.equal(priced.floorUsd,undefined);assert.equal(shown.floorUsd,undefined);
});
test('R8-I8 finite ETH/USD rate with an overflowing floor product omits derived USD',()=>{
  const q=quote(String(Number.MAX_VALUE/2),'1');assert.ok(Number.isFinite(ethUsd(q)));const f=withUsd({...floor,floorEth:5},q);assert.equal(f.floorUsd,undefined);
  assert.equal(floorView(sample(q,{...floor,floorEth:5,floorUsd:6800}),q,START).floorUsd,6800,'a valid Worker fallback is preserved');
});
test('R8-I8 underflow to zero is not a positive ETH/USD rate',()=>{
  const q=quote(String(Number.MIN_VALUE),String(Number.MAX_VALUE));assert.equal(ethUsd(q),null);assert.equal(withUsd(floor,q).floorUsd,undefined);
});
test('R8-I8 a positive finite rate cannot publish a zero-underflow or nonfinite floor product',()=>{
  const q=quote(String(Number.MIN_VALUE),'1');assert.equal(ethUsd(q),Number.MIN_VALUE);
  for(const floorEth of [Number.MIN_VALUE,Infinity,-Infinity,NaN])assert.equal(withUsd({...floor,floorEth},q).floorUsd,undefined);
});
for(const [label,p,n] of [['NaN USD',NaN,1],['infinite USD',Infinity,1],['negative USD',-1,1],['zero USD',0,1],['NaN native',8,NaN],['infinite native',8,Infinity],['negative native',8,-1],['zero native',8,0]]){
  test('R8-I8 rejects '+label+' even when a caller bypasses the upstream selector',()=>{assert.equal(ethUsd({priceUsd:p,priceNative:n}),null);assert.equal(withUsd(floor,{priceUsd:p,priceNative:n}).floorUsd,undefined);});
}
test('R8-I8 missing native quote preserves the finite Worker fallback; fresh viewer quote still wins',()=>{
  const f={...floor,floorUsd:6800};assert.equal(floorView(sample(null,f),null,START).floorUsd,6800);
  assert.equal(floorView(sample(quote(),f),quote(),START).floorUsd,5000);
  assert.equal(marketView(sample(quote(),f,'stale'),START).floor.floorUsd,6800);
  assert.equal(withUsd(f,null).floorUsd,6800,'the helper preserves a previously finite fallback');
});
test('R8-I8 invalid existing USD values are omitted instead of escaping through helper or fallback',()=>{
  for(const floorUsd of [Infinity,-Infinity,NaN,null]){const f={...floor,floorUsd};assert.equal(withUsd(f,null).floorUsd,undefined);assert.equal(floorView(sample(null,f),null,START).floorUsd,undefined);}
});
test('R8-I8 normal ETH/USD and floor age/absence fallbacks retain their behavior',()=>{
  assert.equal(ethUsd(quote()),2000);assert.equal(withUsd(floor,quote()).floorUsd,5000);assert.equal(ethUsd(null),null);
  assert.equal(floorView(sample(quote(),{...floor,fetchedAt:START-FLOOR_MAX_AGE_MS-1}),quote(),START),null);assert.equal(marketView(null,START).floor,null);
});
