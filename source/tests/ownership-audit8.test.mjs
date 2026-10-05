import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';

// One unchanged evaluator can target the candidate or frozen 8a22 source. All chain/provider replies are offline
// fixtures; the Worker cases run the production routes and migrations against real SQLite, without an auth mock.
const root=process.env.AUDIT8_SOURCE?resolve(process.env.AUDIT8_SOURCE):fileURLToPath(new URL('../',import.meta.url));
const load=path=>import(pathToFileURL(resolve(root,path)).href);
const {Ownership,ALCHEMY_RPC_URL,ALCHEMY_NFTS_URL,MULTICALL3,OWNERSHIP_TTL_MS,CACHE_LIMIT}=await load('server/ownership.ts');
const {SEAT_COLLECTION}=await load('src/world/market.ts');
const {setup,newAccount,fakeImd,fakeChain}=await load('tests/wallet-harness.mjs');
const A='0x'+'1'.repeat(40),START=Date.UTC(2026,9,4,12),BLOCK=21_000_000n;
const OWNER_OF=[{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{name:'',type:'address'}]}];
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
const tick=()=>new Promise(r=>setImmediate(r));

for(const delay of [0,1,2])test(`Audit8 Low1: post-proof D1 delay ${delay}ms cannot return expired owner authority`,async t=>{
  const account=newAccount(),a=account.address.toLowerCase(),owners=[];owners[7]=a;
  const chain=fakeChain({owners:{7:a}}),w=setup({chain,imd:fakeImd({seats:{7:'707'},owners,online:[7]})}),browser=w.browser();
  let budget=0;w.env.CHAIN_LIMITER={limit:async({key})=>{if(key==='chain:index')budget++;return {success:true};}};
  assert.equal((await browser.signIn(account)).verify.status,200);
  const initial=await(await browser.get('/api/me/home')).json();assert.equal(initial.eligible,1);
  w.clock.advance(29999);const prepare=w.db.prepare.bind(w.db);let held=true;
  w.db.prepare=sql=>{const wrap=s=>({...s,bind:(...args)=>wrap(s.bind(...args)),all:async()=>{
    if(held&&sql.startsWith('SELECT token_id,last_online_at')){held=false;chain.state.owners[7]='0x'+'2'.repeat(40);w.clock.advance(delay);}
    return s.all();}});return wrap(prepare(sql));};
  const response=await browser.get('/api/me/home'),home=await response.json();
  const rpc=()=>chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length;
  const sessions=w.db.raw.prepare('SELECT count(*) created,sum(revoked_at IS NULL) live,sum(revoked_at IS NOT NULL) revoked FROM sessions').get();
  t.diagnostic(JSON.stringify({delay,age:w.clock.now()-initial.checkedAt,status:response.status,home,rpc:rpc(),budget,sessions}));
  assert.deepEqual({...sessions},{created:1,live:1,revoked:0});assert.equal(rpc(),1);assert.equal(budget,1);
  if(delay===0){assert.equal(response.status,200);assert.equal(home.eligible,1);assert.equal(home.checkedAt,initial.checkedAt);}
  else{assert.equal(response.status,503);assert.equal(home.error,'OWNERSHIP_UNAVAILABLE');assert.equal(home.eligible,undefined);
    const next=await(await browser.get('/api/me/home')).json();assert.equal(next.eligible,0);assert.equal(rpc(),2);
    assert.ok(next.checkedAt>=initial.checkedAt+OWNERSHIP_TTL_MS);assert.equal(budget,1,'fail closed adds no discovery amplification');}
});

for(const change of ['rollback','NaN','Infinity'])test(`Audit8 Low1: ${change} after enrichment fails closed`,async()=>{
  const f=advancingFixture();f.state.advanceClock=false;
  f.ownership.sightings=async()=>{f.state.live=change==='rollback'?START-1:change==='NaN'?NaN:Infinity;return new Map();};
  await assert.rejects(f.ownership.home(A,f.request(START)),{message:'OWNERSHIP_UNAVAILABLE'});
  assert.deepEqual([f.state.index,f.state.budget,f.state.rpc],[1,1,1]);
});

for(const admitted of [false,true])test(`Audit8 Low1: expired proof after ${admitted?'failed admitted':'refused'} lane is unavailable, never expired fallback`,async()=>{
  const f=advancingFixture();f.state.advanceClock=false;f.state.ownerById[7]='0x'+'2'.repeat(40);
  const req=f.request(START);req.budget=async()=>false;
  req.lane=async()=>{f.state.live+=OWNERSHIP_TTL_MS;f.state.failRpc=true;return admitted;};
  await assert.rejects(f.ownership.home(A,req),{message:'OWNERSHIP_UNAVAILABLE'});
  assert.equal(f.state.rpc,admitted?2:1);assert.equal(f.state.index,admitted?1:0);
  f.state.failRpc=false;const next=await f.ownership.home(A,f.request(f.state.live));
  assert.equal(next.eligible,0);assert.ok(next.checkedAt>=START+OWNERSHIP_TTL_MS);
});

for(const [fresh,pageMs,pages] of [[false,7500,4],[true,200,1],[true,7475,4],[true,7500,4]])
test(`Audit8 Low3: overlapping ${fresh?'fresh':'ordinary'}20 with ${pages} pages x ${pageMs}ms shares completed cohort`,async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.advanceClock=false;
  const original=f.request(START).chain.fetch;let indexCycles=0,pageFetches=0;
  const fetcher=async(input,init={})=>{
    if(String(input).startsWith(ALCHEMY_NFTS_URL+'?')){
      const page=Number(new URL(input).searchParams.get('pageKey')??0);
      if(page===0)indexCycles++;pageFetches++;f.state.live+=pageMs;
      if(pageFetches===1){gate.started.resolve();await gate.release.promise;}
      const reply=await(await original(input,init)).json();
      return Response.json({...reply,pageKey:page+1<pages?String(page+1):null});
    }
    f.state.live+=100;return original(input,init);
  };
  const request=i=>({...f.request(START+i),chain:{key:'offline-fixture-only',fetch:fetcher},
    budget:async()=>{f.state.budget++;f.state.live+=30;await tick();return true;}});
  const pending=Array.from({length:20},(_,i)=>f.ownership.home(A,request(i),fresh));
  await gate.started.promise;await tick();gate.release.resolve();
  const views=await Promise.all(pending),epochs=[...new Set(views.map(v=>v.checkedAt))];
  t.diagnostic(JSON.stringify({fresh,pageMs,pages,indexCycles,pageFetches,budget:f.state.budget,rpc:f.state.rpc,epochs,
    elapsed:f.state.live-START,eligible:views.map(v=>v.eligible)}));
  assert.deepEqual([f.state.budget,indexCycles,pageFetches,f.state.rpc,epochs.length],[1,1,pages,1,1]);
  assert.ok(views.every(v=>v.eligible===1&&!v.recheck));assert.equal(epochs[0],START+30+pageMs*pages);
});

function advancingFixture(){
  const state={live:START,index:0,budget:0,rpc:0,tags:[],advanceClock:true,holdIndex:null,holdRpc:null,holdAllRpc:null,failRpc:false,
    roster:['7'],indexIds:['7'],ownerById:{7:A,8:A}};
  const gateway={async source(name){const owners=[];for(const id of state.roster)owners[Number(id)]=A;
    const ids=[...new Set([...state.roster,...state.indexIds])];
    return {state:'fresh',fetchedAt:state.live,url:'fixture://'+name,
      data:name==='swarm'?{at:1,seats:Object.fromEntries(ids.map(id=>[id,{tokenId:Number(id),agentId:String(Number(id)+700)}])),owners}:
        {count:ids.length,workers:ids.map(id=>({seat:{tokenId:id,agentId:String(Number(id)+700)},working:0,runtimes:[],lastHeartbeatAt:'2026-10-04T11:59:00Z'}))}};}};
  const fetcher=async(input,init={})=>{
    if(String(input).startsWith(ALCHEMY_NFTS_URL+'?')){
      state.index++;if(state.advanceClock)state.live+=200;
      if(state.holdIndex){const gate=state.holdIndex;state.holdIndex=null;gate.started.resolve();await gate.release.promise;}
      return Response.json({ownedNfts:state.indexIds.map(tokenId=>({contract:{address:SEAT_COLLECTION},tokenId})),pageKey:null});
    }
    assert.equal(String(input),ALCHEMY_RPC_URL);state.rpc++;if(state.advanceClock)state.live+=100;
    const body=JSON.parse(init.body);state.tags.push(body.params[1]);
    const calls=decodeFunctionData({abi:multicall3Abi,data:body.params[0].data}).args[0],willFail=state.failRpc;
    if(state.holdRpc){const gate=state.holdRpc;state.holdRpc=null;gate.started.resolve();await gate.release.promise;}
    if(state.holdAllRpc){const gate=state.holdAllRpc;if(state.rpc===CACHE_LIMIT)gate.started.resolve();await gate.release.promise;}
    if(willFail)return new Response('{}',{status:502});
    return Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',
      result:calls.map(c=>c.target===MULTICALL3?{success:true,returnData:encodeAbiParameters([{type:'uint256'}],[BLOCK])}:
        (()=>{const id=String(decodeFunctionData({abi:OWNER_OF,data:c.callData}).args[0]),owner=state.ownerById[id];
          return owner?{success:true,returnData:encodeFunctionResult({abi:OWNER_OF,functionName:'ownerOf',result:owner})}:
            {success:false,returnData:'0x'};})())})});
  };
  const ownership=new Ownership(gateway,[]);
  const request=now=>({chain:{key:'offline-fixture-only',fetch:fetcher},now,clock:()=>state.live,
    budget:async()=>{state.budget++;if(state.advanceClock)state.live+=30;await tick();return true;}});
  return {state,ownership,request};
}

for(const context of ['changed-roster','fresh-intent'])test(`Audit8 Low3 control: successful predecessor does not coalesce independent ${context}`,async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
  const first=f.ownership.home(A,f.request(START),false);await gate.started.promise;
  if(context==='changed-roster')f.state.roster=['7','8'];
  const second=f.ownership.home(A,f.request(f.state.live),context==='fresh-intent');
  await tick();gate.release.resolve();const [one,two]=await Promise.all([first,second]);
  t.diagnostic(JSON.stringify({context,first:one.eligible,second:two.eligible,index:f.state.index,budget:f.state.budget,rpc:f.state.rpc,tags:f.state.tags}));
  assert.equal(one.eligible,1);assert.equal(two.eligible,context==='changed-roster'?2:1);
  assert.deepEqual([f.state.index,f.state.budget,f.state.rpc],[1,1,context==='changed-roster'?2:1]);
  assert.equal(two.checkedAt,one.checkedAt,'a missing delta never renews checkedAt');
  if(context==='changed-roster')assert.deepEqual(f.state.tags,['latest','0x'+BLOCK.toString(16)]);
});

for(const fresh of [false,true])test(`Audit2 exact: 20 overlapping ${fresh?'fresh':'ordinary'} home reads with advancing live clock share one index/budget/proof`,async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.holdIndex=gate;
  const replies=Array.from({length:20},(_,i)=>f.ownership.home(A,f.request(START+i),fresh));
  await gate.started.promise;await tick();gate.release.resolve();
  const views=await Promise.all(replies);
  const measured={budget:f.state.budget,index:f.state.index,rpc:f.state.rpc,eligible:views.map(v=>v.eligible),
    complete:views.every(v=>v.recheck===undefined),checkedAt:[...new Set(views.map(v=>v.checkedAt))],live:f.state.live};
  t.diagnostic(JSON.stringify(measured));
  assert.deepEqual([measured.budget,measured.index,measured.rpc],[1,1,1]);
  assert.deepEqual(measured.eligible,Array(20).fill(1));assert.equal(measured.complete,true);
  assert.equal(measured.checkedAt.length,1,'one fixed proof epoch serves the overlap cohort');
});

test('Audit2 exact Worker/SQLite: 20 overlapping due-index routes charge one budget and preserve the authenticated row',async t=>{
  const account=newAccount(),a=account.address.toLowerCase(),owners=[];owners[7]=a;
  const chain=fakeChain({owners:{7:a}}),baseFetch=chain.fetcher;let w,gate=null;
  chain.fetcher=async(input,init={})=>{
    if(String(input).startsWith(ALCHEMY_NFTS_URL+'?')){
      w.clock.advance(20);if(gate){const held=gate;gate=null;held.started.resolve();await held.release.promise;}
    }else if(init.body&&JSON.parse(init.body).method==='eth_call')w.clock.advance(20);
    return baseFetch(input,init);
  };
  w=setup({imd:fakeImd({seats:{7:'707'},owners,online:[7]}),chain});
  const budgetKeys=[];w.env.CHAIN_LIMITER={limit:async({key})=>{budgetKeys.push(key);if(key==='chain:index')w.clock.advance(5);return {success:true};}};
  const browser=w.browser();assert.equal((await browser.signIn(account)).verify.status,200);
  assert.equal((await browser.get('/api/me/home')).status,200);await Promise.all(w.kept);
  w.clock.advance(301_000);
  const before={index:chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL+'?')).length,
    budget:budgetKeys.filter(k=>k==='chain:index').length,
    rpc:chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length};
  const held={started:deferred(),release:deferred()};gate=held;
  const pending=Array.from({length:20},()=>browser.get('/api/me/home'));
  await held.started.promise;await tick();held.release.resolve();
  const responses=await Promise.all(pending),views=await Promise.all(responses.map(r=>r.json()));await Promise.all(w.kept);
  const after={index:chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL+'?')).length,
    budget:budgetKeys.filter(k=>k==='chain:index').length,
    rpc:chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length};
  const sessions=w.db.raw.prepare('SELECT count(*) created,sum(revoked_at IS NULL) live FROM sessions').get();
  t.diagnostic(JSON.stringify({before,after,statuses:responses.map(r=>r.status),sessions,eligible:views.map(v=>v.eligible)}));
  assert.deepEqual([after.index-before.index,after.budget-before.budget,after.rpc-before.rpc],[1,1,1]);
  assert.deepEqual(responses.map(r=>r.status),Array(20).fill(200));assert.deepEqual(views.map(v=>v.eligible),Array(20).fill(1));
  assert.ok(views.every(v=>v.recheck===undefined));assert.deepEqual({...sessions},{created:1,live:1});
  assert.equal((await (await browser.get('/api/auth/session')).json()).signedIn,true);
});

for(const context of ['changed-roster','fresh-intent'])test(`Audit5 exact: queued ${context} evaluates its own proof after the predecessor fails`,async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;f.state.failRpc=true;
  const first=f.ownership.home(A,f.request(START),false);
  // Attach handlers immediately: both paths are intentionally allowed to reject in the before-fix evaluator.
  const firstOutcome=first.then(value=>({value}),error=>({error}));await gate.started.promise;
  if(context==='changed-roster')f.state.roster=['7','8'];
  const secondOutcome=f.ownership.home(A,f.request(f.state.live),context==='fresh-intent').then(value=>({value}),error=>({error}));
  await tick();f.state.failRpc=false;gate.release.resolve();
  const [one,two]=await Promise.all([firstOutcome,secondOutcome]);
  t.diagnostic(JSON.stringify({context,first:one.error?.message??'ok',second:two.error?.message??'ok',
    budget:f.state.budget,index:f.state.index,rpc:f.state.rpc,eligible:two.value?.eligible}));
  assert.equal(one.error?.message,'OWNERSHIP_UNAVAILABLE');assert.equal(two.error,undefined,'independent queued work must evaluate after settlement');
  assert.equal(two.value.eligible,context==='changed-roster'?2:1);assert.deepEqual([f.state.index,f.state.budget,f.state.rpc],[1,1,2]);
});

test('Audit5 control: twenty identical in-flight callers share one controlled failure; a later request can retry',async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;f.state.failRpc=true;
  const calls=Array.from({length:20},(_,i)=>f.ownership.home(A,f.request(START+i),false).then(value=>({value}),error=>({error})));
  await gate.started.promise;await tick();f.state.failRpc=false;gate.release.resolve();
  const outcomes=await Promise.all(calls);
  assert.ok(outcomes.every(v=>v.error?.message==='OWNERSHIP_UNAVAILABLE'));assert.equal(f.state.rpc,1);
  const recovered=await f.ownership.home(A,f.request(f.state.live),false);
  t.diagnostic(JSON.stringify({failed:outcomes.length,recovered:recovered.eligible,budget:f.state.budget,index:f.state.index,rpc:f.state.rpc}));
  assert.deepEqual([recovered.eligible,f.state.index,f.state.budget,f.state.rpc],[1,1,1,2]);
});

test('Audit5 exact Worker/SQLite: queued fresh route survives a failed cold proof without changing auth rows',async t=>{
  const account=newAccount(),a=account.address.toLowerCase(),owners=[];owners[7]=a;
  const chain=fakeChain({owners:{7:a}}),gate={started:deferred(),release:deferred()};let firstProof=true;
  chain.state.intercept=async(method,params)=>{
    if(method==='eth_call'&&params[0].to===MULTICALL3&&firstProof){firstProof=false;gate.started.resolve();await gate.release.promise;return new Response('{}',{status:502});}
  };
  const w=setup({imd:fakeImd({seats:{7:'707'},owners,online:[7]}),chain}),budgetKeys=[];
  const queuedWorld=deferred(),readSource=w.gateway.source.bind(w.gateway);let homeWorlds=0;
  w.gateway.source=async(...args)=>{const value=await readSource(...args);if(args[0]==='swarm'&&++homeWorlds===2)queuedWorld.resolve();return value;};
  w.env.CHAIN_LIMITER={limit:async({key})=>{budgetKeys.push(key);return {success:true};}};
  const browser=w.browser();assert.equal((await browser.signIn(account)).verify.status,200);
  const first=browser.get('/api/me/home');await gate.started.promise;
  const second=browser.get('/api/me/home?fresh=1');await queuedWorld.promise;await tick();gate.release.resolve();
  const [one,two]=await Promise.all([first,second]),views=await Promise.all([one.clone().json(),two.clone().json()]);
  const rpc=chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length;
  const index=chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL+'?')).length;
  const sessions=w.db.raw.prepare('SELECT count(*) created,sum(revoked_at IS NULL) live FROM sessions').get();
  t.diagnostic(JSON.stringify({statuses:[one.status,two.status],errors:views.map(v=>v.error),eligible:views[1].eligible,
    rpc,index,budget:budgetKeys.filter(k=>k==='chain:index').length,sessions}));
  assert.equal(one.status,503);assert.equal(views[0].error,'OWNERSHIP_UNAVAILABLE');assert.equal(two.status,200);
  assert.deepEqual([views[1].eligible,index,budgetKeys.filter(k=>k==='chain:index').length,rpc],[1,1,1,2]);
  assert.deepEqual({...sessions},{created:1,live:1});assert.equal((await (await browser.get('/api/auth/session')).json()).signedIn,true);
});

test('Audit5 control: a later same-roster request after the pending epoch deadline proves latest and rejects a sold seat',async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.holdRpc=gate;
  const first=f.ownership.home(A,f.request(START),false).then(value=>({value}),error=>({error}));
  await gate.started.promise;f.state.live+=OWNERSHIP_TTL_MS;f.state.ownerById[7]='0x'+'2'.repeat(40);
  const second=f.ownership.home(A,f.request(f.state.live),false).then(value=>({value}),error=>({error}));
  await tick();gate.release.resolve();const [one,two]=await Promise.all([first,second]);
  t.diagnostic(JSON.stringify({first:one.error?.message,second:two.error?.message??'ok',eligible:two.value?.eligible,
    index:f.state.index,budget:f.state.budget,rpc:f.state.rpc,tags:f.state.tags}));
  assert.equal(one.error?.message,'OWNERSHIP_UNAVAILABLE');assert.equal(two.error,undefined);assert.equal(two.value.eligible,0);
  assert.deepEqual([f.state.index,f.state.budget,f.state.rpc],[1,1,2]);assert.deepEqual(f.state.tags,['latest','latest']);
});

test('Audit5 bounded-flight control: the existing 512-address cap rejects the next active key and clears on settlement',async t=>{
  const f=advancingFixture(),gate={started:deferred(),release:deferred()};f.state.advanceClock=false;f.state.holdAllRpc=gate;
  const addresses=Array.from({length:CACHE_LIMIT+1},(_,i)=>'0x'+BigInt(i+1).toString(16).padStart(40,'0'));
  const calls=addresses.map(a=>f.ownership.home(a,f.request(START),false).then(value=>({value}),error=>({error})));
  await gate.started.promise;gate.release.resolve();const outcomes=await Promise.all(calls);
  t.diagnostic(JSON.stringify({complete:outcomes.filter(v=>v.value).length,unavailable:outcomes.filter(v=>v.error).length,
    budget:f.state.budget,index:f.state.index,rpc:f.state.rpc}));
  assert.equal(outcomes.filter(v=>v.value).length,CACHE_LIMIT);assert.equal(outcomes.at(-1).error?.message,'OWNERSHIP_UNAVAILABLE');
  assert.deepEqual([f.state.index,f.state.budget,f.state.rpc],[CACHE_LIMIT,CACHE_LIMIT,CACHE_LIMIT]);
  f.state.holdAllRpc=null;const retry=await f.ownership.home(addresses.at(-1),f.request(START),false);
  assert.equal(retry.eligible,0,'the fixture chain does not own this address; retry availability cannot grant authority');
  assert.equal(f.state.rpc,CACHE_LIMIT+1);
});

test('Audit5 Worker/SQLite control: twenty identical routes share one unavailable proof and a later route recovers',async t=>{
  const account=newAccount(),a=account.address.toLowerCase(),owners=[];owners[7]=a;
  const chain=fakeChain({owners:{7:a}}),gate={started:deferred(),release:deferred()};let firstProof=true;
  chain.state.intercept=async(method,params)=>{
    if(method==='eth_call'&&params[0].to===MULTICALL3&&firstProof){firstProof=false;gate.started.resolve();await gate.release.promise;return new Response('{}',{status:502});}
  };
  const w=setup({imd:fakeImd({seats:{7:'707'},owners,online:[7]}),chain}),budgetKeys=[],allEntered=deferred();
  const readSource=w.gateway.source.bind(w.gateway);let worlds=0;
  w.gateway.source=async(...args)=>{const value=await readSource(...args);if(args[0]==='swarm'&&++worlds===20)allEntered.resolve();return value;};
  w.env.CHAIN_LIMITER={limit:async({key})=>{budgetKeys.push(key);return {success:true};}};
  const browser=w.browser();assert.equal((await browser.signIn(account)).verify.status,200);
  const pending=Array.from({length:20},()=>browser.get('/api/me/home'));
  await gate.started.promise;await allEntered.promise;await tick();gate.release.resolve();
  const responses=await Promise.all(pending),views=await Promise.all(responses.map(r=>r.json()));
  const proofCalls=()=>chain.state.calls.filter(c=>c.body&&JSON.parse(c.body).method==='eth_call'&&JSON.parse(c.body).params[0].to===MULTICALL3).length;
  assert.deepEqual(responses.map(r=>r.status),Array(20).fill(503));assert.ok(views.every(v=>v.error==='OWNERSHIP_UNAVAILABLE'));
  assert.equal(proofCalls(),1,'one shared failing upstream call, rather than one retry per current waiter');
  const retry=await browser.get('/api/me/home'),home=await retry.json();
  const index=chain.state.calls.filter(c=>c.url.startsWith(ALCHEMY_NFTS_URL+'?')).length;
  const sessions=w.db.raw.prepare('SELECT count(*) created,sum(revoked_at IS NULL) live FROM sessions').get();
  t.diagnostic(JSON.stringify({failures:responses.length,retry:retry.status,eligible:home.eligible,
    rpc:proofCalls(),index,budget:budgetKeys.filter(k=>k==='chain:index').length,sessions}));
  assert.deepEqual([retry.status,home.eligible,index,budgetKeys.filter(k=>k==='chain:index').length,proofCalls()],[200,1,1,1,2]);
  assert.deepEqual({...sessions},{created:1,live:1});
});
