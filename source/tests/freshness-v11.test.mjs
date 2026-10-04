import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isFreshAge,PUBLIC_REMOTE_SKEW_MS} from '../src/shared/freshness.ts';
const root=process.env.R8_SOURCE?resolve(process.env.R8_SOURCE):resolve(import.meta.dirname,'..');
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {marketView,floorView,selectFloor,MARKET_URL,FLOOR_MAX_AGE_MS}=await load('src/world/market.ts');
const {ImdBridge,MARKET_EXTRAS_URL,EXTRAS_RETRY_MS}=await load('src/world/bridge.ts');
const {FRESH_MS,worldReadResult}=await load('src/world/cadence.ts');
const {publicName}=await load('src/world/member.ts');
const sample=(data,at=1000,floor)=>({state:'fresh',data,url:MARKET_URL,fetchedAt:at,...floor?{extras:{floorEnabled:true,floor}}:{}});
test('shared freshness fails closed on backward/nonfinite clocks and expires exactly at TTL',()=>{
 assert.equal(isFreshAge(1000,1000,30_000),true);assert.equal(isFreshAge(30_999,1000,30_000),true);
 for(const [n,s,t] of [[999,1000,30_000],[31_000,1000,30_000],[31_001,1000,30_000],[Infinity,1000,30_000],[1000,Infinity,30_000],[NaN,1000,30_000],[1000,NaN,30_000],[1000,1000,0],[1000,1000,Infinity]])assert.equal(isFreshAge(n,s,t),false);
});
test('Worker fallback quote sanitizes all optional numeric fields while preserving finite negative changes',()=>{
 const q=marketView(sample({priceUsd:8,priceNative:Infinity,change24h:-8,marketCap:Infinity,liquidityUsd:-1,
 change:{m5:NaN,h1:-6,h6:Infinity,h24:-8},volumeUsd:{h1:-1,h24:Infinity},txns:{h1:{buys:Infinity,sells:2},h24:{buys:0,sells:1}}}),1000).quote;
 assert.equal(q.priceUsd,8);assert.equal(q.change24h,-8);assert.equal(q.change.h1,-6);
 assert.equal(q.priceNative,null);assert.equal(q.marketCap,null);assert.equal(q.liquidityUsd,null);
 assert.deepEqual(q.volumeUsd,{h1:null,h24:null});assert.deepEqual(q.txns,{h1:null,h24:{buys:0,sells:1}});
 assert.equal(q.change.h6,null);assert.equal(q.change.m5,null);
});
test('wire overflowing exponent primary price is unavailable; valid price and optional negative change still render',()=>{
 const wire=JSON.parse('{"priceUsd":1e999,"change24h":-8}');assert.equal(marketView(sample(wire),1000).state,'unavailable');
 assert.equal(marketView(sample({priceUsd:8,change24h:-8}),1000).weather,'rain');
});
test('public market stamp beyond the formal skew bound cannot count as fresh, exact expiry suppresses weather',()=>{
 for(const at of [1000+PUBLIC_REMOTE_SKEW_MS+1,Infinity,NaN])assert.notEqual(marketView(sample({priceUsd:8,change24h:10},at),1000).state,'fresh');
 assert.equal(marketView(sample({priceUsd:8,change24h:10}),1000+FRESH_MS-1).state,'fresh');
 assert.equal(marketView(sample({priceUsd:8,change24h:10}),1000+FRESH_MS).weather,'unknown');
});
test('nonfinite floor, out-of-policy future age, invalid fallback USD cannot reach floor UI',()=>{
 const base={floorEth:2.5,marketplace:'OpenSea',fetchedAt:1000};
 for(const floorEth of [Infinity,NaN,-1,0])assert.equal(floorView(sample(null,1000,{...base,floorEth}),null,1000),null);
 for(const fetchedAt of [1000+PUBLIC_REMOTE_SKEW_MS+1,Infinity,NaN])assert.equal(floorView(sample(null,1000,{...base,fetchedAt}),null,1000),null);
 for(const floorUsd of [Infinity,NaN,-1,0])assert.equal(floorView(sample(null,1000,{...base,floorUsd}),null,1000).floorUsd,undefined);
 assert.equal(floorView(sample(null,1000,base),null,1000+FLOOR_MAX_AGE_MS),null);
 assert.equal(floorView(sample(null,1000,{...base,floorUsd:6800}),null,1000).floorUsd,6800);
});
test('extras success and failure retry reject negative age without inventing fetchedAt',async()=>{
 let now=1_000_000,calls=0,fail=false;
 const bridge=new ImdBridge('live',async url=>{assert.equal(url,MARKET_EXTRAS_URL);calls++;
  return fail?new Response('{}',{status:503}):Response.json({extras:{floorEnabled:true,floor:{floorEth:2,marketplace:'X',fetchedAt:900_000}}});},()=>now);
 const first=await bridge.getExtras();now-=1;await bridge.getExtras();assert.equal(calls,2,'clock rollback expires successful local cache');
 now+=1_000_000;fail=true;await bridge.getExtras();assert.equal(calls,3);assert.equal(bridge.withExtras(),null);
 now+=EXTRAS_RETRY_MS-1;assert.deepEqual(await bridge.getExtras(),first);assert.equal(calls,3);
 now-=EXTRAS_RETRY_MS;await bridge.getExtras();assert.equal(calls,4,'clock rollback expires failed backoff');
 now+=EXTRAS_RETRY_MS;await bridge.getExtras();assert.equal(calls,5,'failure retries at exact deadline');
});
test('future upstream floor retrieval time survives normalization and stays hidden',()=>{
 const now=Date.parse('2026-10-04T00:00:00Z'),future=Date.parse('2026-10-05T00:00:00Z');
 const floor=selectFloor({openSea:{floorPrice:2.5,priceCurrency:'ETH',retrievedAt:new Date(future).toISOString()}},now);
 assert.equal(floor.fetchedAt,future);assert.equal(floorView(sample(null,now,floor),null,now),null);
 for(const retrievedAt of [undefined,'bad date']){
  const observed=selectFloor({openSea:{floorPrice:2.5,priceCurrency:'ETH',retrievedAt}},now);
  assert.equal(observed.fetchedAt,now,'missing/unparseable upstream time uses initial observation, not cached merge time');
 }
});
test('remote cadence rejects out-of-policy future or nonfinite fetchedAt as a good read',()=>{
 const s=at=>({state:'fresh',data:{},url:'x',fetchedAt:at});
 for(const at of [1000+PUBLIC_REMOTE_SKEW_MS+1,Infinity,NaN,null])assert.equal(worldReadResult({swarm:s(at),workers:s(1000)},1000),false);
 assert.equal(worldReadResult({swarm:s(1000),workers:s(1000)},1000),true);
});
test('public-name cache expires on backward wall clock and at exact deadline',async()=>{
 let calls=0;const get=async()=>{calls++;return Response.json({name:'Cat'+calls});},a='0x'+'39'.repeat(20);
 assert.equal(await publicName(a,1000,get),'Cat1');assert.equal(await publicName(a,1001,get),'Cat1');
 assert.equal(await publicName(a,999,get),'Cat2');assert.equal(await publicName(a,60_999,get),'Cat3');assert.equal(calls,3);
});
