import test from 'node:test';
import assert from 'node:assert/strict';
import {worldReadResult,startPoll,REFRESH_MS,FRESH_MS,UPSTREAM_TTL_MS} from '../src/world/cadence.ts';
import {marketView,floorView,FLOOR_MAX_AGE_MS} from '../src/world/market.ts';
import {ReadGateway,SHARED_SHAPE,GATEWAY_DEFAULTS} from '../server/gateway.ts';
import {isFreshAge} from '../src/shared/freshness.ts';

// Existing gateway shared-copy skew policy: 60 s inclusive. This is display/public transport only.
const SKEW=60_000,now=2_000_000;
const source=stamp=>({state:'fresh',data:{priceUsd:8,change24h:10},url:'https://api.imd.fun/workers',fetchedAt:stamp});
test('Audit6 small Worker/browser skew preserves cadence and public display without rewriting stamps',()=>{
 for(const offset of [1_000,5_000,SKEW]){
  const s=source(now+offset),original=s.fetchedAt;
  assert.equal(worldReadResult({swarm:s,workers:s},now),true);
  assert.equal(marketView(s,now).state,'fresh');
  assert.equal(marketView(s,now).weather,'brilliant');
  const floor={floorEth:2,marketplace:'OpenSea',fetchedAt:original};
  assert.equal(floorView({...s,extras:{floorEnabled:true,floor}},null,now).fetchedAt,original);
  assert.equal(s.fetchedAt,original,'raw epoch provenance retained');
 }
});
test('Audit6 skew beyond formal bound, malformed values and exact TTL remain rejected',()=>{
 for(const stamp of [now+SKEW+1,Infinity,NaN,null]){
  const s=source(stamp);
  assert.equal(worldReadResult({swarm:s,workers:source(now)},now),false);
  assert.notEqual(marketView(s,now).state,'fresh');
 }
 assert.equal(marketView(source(now),now+FRESH_MS).weather,'unknown');
 assert.equal(floorView({...source(now),extras:{floorEnabled:true,floor:{floorEth:2,marketplace:'OpenSea',fetchedAt:now}}},null,now+FLOOR_MAX_AGE_MS),null);
 assert.equal(isFreshAge(now,now+1,30_000),false,'no authority skew tolerance');
});
test('Audit6 repeated clock skew gets 15-minute polling, never the persistent failure ladder',async()=>{
 let clock=now,pending,reads=0;
 const env={set:(fn,ms)=>{pending={fn,ms};return pending;},clear:()=>{},hidden:()=>false,now:()=>clock,onVisible:()=>()=>{}};
 const poll=startPoll(async()=>{reads++;const s=source(clock+2_000);return worldReadResult({swarm:s,workers:s},clock);},env);
 await new Promise(r=>setTimeout(r,0));
 for(let i=0;i<4;i++){assert.equal(pending.ms,REFRESH_MS);clock+=pending.ms;await pending.fn();await new Promise(r=>setTimeout(r,0));}
 assert.equal(reads,5);assert.equal(poll.failures,0);poll.stop();
});
test('Audit7 shared warm retains original future timestamp and never grants extra TTL from rebasing',async()=>{
 for(const offset of [1_000,5_000,SKEW]){
  let clock=now,calls=0;
  const copy={get:async key=>({v:1,shape:SHARED_SHAPE,key,data:key==='swarm'?{seats:{},tag:'copy'}:key==='workers'?{workers:[],tag:'copy'}:{},fetchedAt:now+offset}),put:async()=>{}};
  const g=new ReadGateway(async()=>{calls++;return Response.json({seats:{probe:'upstream'},workers:[]});},()=>clock);
  const s=(await g.snapshot(undefined,copy)).sources.swarm;
  assert.equal(s.fetchedAt,now+offset);assert.equal(s.data.tag,'copy');
  assert.equal(worldReadResult({swarm:s,workers:s},clock),true);
  calls=0;clock=now+offset+UPSTREAM_TTL_MS-1;
  const kept=(await g.source('swarm')).fetchedAt;
  assert.equal(kept,now+offset);assert.equal(calls,0,'producer TTL-minus-one reuses without rebasing');
  clock++;const refreshed=await g.source('swarm');
  assert.equal(calls,1,'exact producer TTL refreshes');assert.equal(refreshed.data.seats.probe,'upstream');
 }
});
test('Audit7 shared records past skew and stale boundary are rejected rather than redated',async()=>{
 for(const stamp of [now+SKEW+1,Infinity,NaN,now-GATEWAY_DEFAULTS.staleMaxAgeMs-1]){
  const copy={get:async key=>({v:1,shape:SHARED_SHAPE,key,data:{seats:{},workers:[],tag:'copy'},fetchedAt:stamp}),put:async()=>{}};
  const g=new ReadGateway(async()=>Response.json({seats:{probe:'upstream'},workers:[],jobs:[],requests:[],items:[],launches:[],steps:[1]}),()=>now);
  assert.equal((await g.snapshot(undefined,copy)).sources.swarm.data.seats.probe,'upstream');
 }
});
