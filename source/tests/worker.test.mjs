import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as entry from '../worker/index.ts';
import {createWorker,rateLimitKey,networkKey,subnetKey,USER_AGENT,edgeCopy,SHARED_COPY_PATH} from '../worker/app.ts';
import {SHARED_SHAPE} from '../server/gateway.ts';
const worker=entry.default;
import {ReadGateway,ACTIVITY_URL} from '../server/gateway.ts';
import {HSTS} from '../server/world-api.ts';
import {imdGatewayPlugin} from '../server/vite-plugin.ts';
import {openLimiters} from './wallet-harness.mjs';
import {IMD_TOKEN,MARKET_URL} from '../src/world/market.ts';
import {UPSTREAM_TTL_MS as TTL} from '../src/world/cadence.ts';

const swarm=JSON.parse(readFileSync(new URL('./fixtures/swarm-2026-09-27.json',import.meta.url),'utf8'));
const activity=JSON.parse(readFileSync(new URL('./fixtures/activity-0759z.json',import.meta.url),'utf8'));
const API='https://api.imd.fun';
// A fake api.imd.fun + Explorer activity + DEX Screener. `data` can be replaced per path to simulate upstream changes.
function upstream(){
  const calls=[];const data={
    '/swarm':swarm,
    '/workers':{count:1,workers:[{deviceKey:'secret-device-key',seat:{tokenId:'1'},working:1,paused:false,daemonVersion:'1.2.3',runtimes:['codex'],platform:'linux',connectedAt:'x',lastHeartbeatAt:'2026-09-27T00:00:00Z'}]},
    '/jobs?limit=50':{count:1,jobs:[{id:'job-1',objective:'first objective',status:'open'}]},
    '/oracle/requests?limit=8':{count:0,requests:[]},
    '/publications?pageSize=8':{count:0,items:[]},
    '/launches?limit=8':{count:0,launches:[]}
  };
  const fail=new Set();
  const fetcher=async(url)=>{
    calls.push(url);
    if(url===ACTIVITY_URL)return fail.has('activity')?new Response('{}',{status:502}):Response.json(activity);
    if(url===MARKET_URL)return Response.json([{chainId:'ethereum',baseToken:{address:IMD_TOKEN},priceUsd:'8.19',priceChange:{h24:1},liquidity:{usd:3e6},marketCap:3e7,url:'https://dexscreener.com/ethereum/x'}]);
    const path=url.slice(API.length),seat=path.match(/^\/seats\/(\d+)\?work=5&reviews=0$/);
    if(seat)return Response.json({tokenId:seat[1],agentId:'5',owner:'0x'+'1'.repeat(40),work:[],collaboratorJobs:2,collaborators:[{tokenId:'9'}],devices:3,reviews:[{by:'x'}]});
    if(fail.has(path))return new Response('{}',{status:502});
    if(!(path in data))return new Response('{}',{status:404});
    return Response.json(data[path]);
  };
  return {calls,data,fail,fetcher};
}
function assetsEnv(extra={}){
  const seen=[];return {seen,env:{ASSETS:{fetch:async(request)=>{seen.push(request);return new Response('asset '+new URL(request.url).pathname,{headers:{'x-served-by':'assets'}});}},...openLimiters(),...extra}};
}
const ctx=(kept=[])=>({kept,waitUntil:p=>kept.push(p)});
const get=(path,init)=>new Request('https://imdember.com'+path,init);
function assertApiHeaders(response){
  assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');
  assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains');assert.equal(HSTS,'max-age=31536000; includeSubDomains');
}

test('worker answers the three read routes with JSON, API headers and no sensitive fields',async()=>{
  const up=upstream(),{seen,env}=assetsEnv(),w=createWorker(new ReadGateway(up.fetcher,()=>1000));
  const snapshot=await w.fetch(get('/api/world/snapshot'),env,ctx());
  assert.equal(snapshot.status,200);assertApiHeaders(snapshot);
  const body=await snapshot.json();assert.equal(body.mode,'live');
  assert.deepEqual(Object.keys(body.sources),['swarm','workers','jobs','oracle','publications','launches','activity']);
  for(const s of Object.values(body.sources))assert.equal(s.state,'fresh');
  assert.equal(body.sources.swarm.data.owners.length,swarm.owners.length);
  assert.deepEqual(Object.keys(body.sources.workers.data.workers[0]).sort(),['daemonVersion','lastHeartbeatAt','runtimes','seat','working']);
  const market=await w.fetch(get('/api/world/market'),env,ctx());
  assert.equal(market.status,200);assertApiHeaders(market);
  const quote=await market.json();assert.equal(quote.url,MARKET_URL);assert.equal(quote.data.priceUsd,8.19);
  assert.deepEqual(quote.extras,{floorEnabled:false},'no ALCHEMY_API_KEY: no floor, and the client is told not to ask again');
  const seat=await w.fetch(get('/api/world/seats/42'),env,ctx());
  assert.equal(seat.status,200);assertApiHeaders(seat);
  const detail=await seat.json();assert.equal(detail.data.tokenId,'42');assert.equal(detail.data.collaboratorJobs,2);
  for(const field of ['collaborators','devices','reviews'])assert.equal(field in detail.data,false);
  assert.ok(up.calls.includes(API+'/seats/42?work=5&reviews=0'));
  const raw=JSON.stringify([body,quote,detail]);
  for(const secret of ['secret-device-key','"deviceKey"','"collaborators"','"reviews"'])assert.equal(raw.includes(secret),false,secret);
  assert.equal(seen.length,0);
});

test('worker rejects writes with 405, unknown API paths with 404 and gateway failures with 503',async()=>{
  const up=upstream(),{seen,env}=assetsEnv(),w=createWorker(new ReadGateway(up.fetcher,()=>1000));
  for(const method of ['POST','PUT','DELETE','HEAD','OPTIONS']){
    const r=await w.fetch(get('/api/world/snapshot',{method}),env,ctx());
    assert.equal(r.status,405,method);assert.equal(r.headers.get('allow'),'GET');assertApiHeaders(r);
    if(method!=='HEAD')assert.deepEqual(await r.json(),{error:'read_only'});
  }
  for(const path of ['/api/world/','/api/world/nope','/api/world/seats/01','/api/world/seats/-1','/api/world/seats/1/x','/api/world/seats/'+'9'.repeat(81)]){
    const r=await w.fetch(get(path),env,ctx());
    assert.equal(r.status,404,path);assertApiHeaders(r);assert.deepEqual(await r.json(),{error:'unknown_route'});
  }
  assert.equal(up.calls.length,0);assert.equal(seen.length,0);
  const routed=[],stub=createWorker({snapshotBody:async()=>'{}',market:async()=>({}),seat:async id=>{routed.push(id);return {state:'unavailable'};}});
  for(const id of ['0','7','9'.repeat(80)])assert.equal((await stub.fetch(get('/api/world/seats/'+id),env,ctx())).status,200,id);
  assert.deepEqual(routed,['0','7','9'.repeat(80)],'decimal ids up to 80 digits reach the gateway');
  const broken=createWorker({snapshotBody:async()=>{throw new Error('x');},market:async()=>{throw new Error('x');},seat:async()=>{throw new Error('x');}});
  for(const path of ['/api/world/snapshot','/api/world/market','/api/world/seats/1']){
    const r=await broken.fetch(get(path),env,ctx());
    assert.equal(r.status,503,path);assertApiHeaders(r);assert.deepEqual(await r.json(),{error:'gateway_unavailable'});
  }
});

test('everything outside /api/world/ goes to the ASSETS binding untouched',async()=>{
  const up=upstream(),{seen,env}=assetsEnv(),w=createWorker(new ReadGateway(up.fetcher,()=>1000));
  for(const path of ['/','/models/houses/house_timber_l.glb','/favicon.svg','/api','/api/world','/API/world/snapshot','/api/other']){
    const request=get(path),r=await w.fetch(request,env,ctx());
    assert.equal(r.headers.get('x-served-by'),'assets',path);assert.equal(await r.text(),'asset '+path);
    assert.equal(seen.at(-1),request);
  }
  assert.equal(up.calls.length,0);
});

test('seat details are bounded to 256 per isolate, least recently read dropped first',async()=>{
  const up=upstream(),{env}=assetsEnv(),w=createWorker(new ReadGateway(up.fetcher,()=>1000));
  assert.equal((await w.fetch(get('/api/world/snapshot'),env,ctx())).status,200);// the swarm (owners for ids 0-1999) is cached
  const seat=async id=>{const before=up.calls.length;const r=await w.fetch(get('/api/world/seats/'+id),env,ctx());assert.equal(r.status,200);await r.json();return up.calls.length-before;};
  for(let id=0;id<256;id++)assert.equal(await seat(id),1);
  assert.equal(await seat(0),0,'still cached; now most recently read');
  assert.equal(await seat(256),1);
  assert.equal(await seat(0),0,'kept because it was read recently');
  assert.equal(await seat(1),1,'least recently read, so it was dropped');
  for(let id=1000;id<2000;id++)await seat(id);
  let refetched=0;for(let id=1744;id<2000;id++)refetched+=await seat(id);assert.equal(refetched,0,'the newest 256 stay cached');
  assert.equal(await seat(1743),1,'anything older was dropped');
});

test('the snapshot body is serialised once per data change and rebuilt when any source changes',async()=>{
  let at=1000;const up=upstream(),{env}=assetsEnv(),w=createWorker(new ReadGateway(up.fetcher,()=>at));
  const original=JSON.stringify;let serialised=0;
  JSON.stringify=function(value,...rest){if(value&&typeof value==='object'&&value.mode==='live'&&value.sources)serialised++;return original.call(this,value,...rest);};
  try {
    const kept=[],read=async()=>{const r=await w.fetch(get('/api/world/snapshot'),env,ctx(kept));assert.equal(r.status,200);return r.text();};
    const settled=()=>Promise.all(kept.splice(0));
    const first=await read(),second=await read();
    assert.equal(serialised,1);assert.equal(second,first);
    const reads=path=>up.calls.filter(u=>u===API+path).length;
    at=TTL;assert.equal(await read(),first);assert.equal(serialised,1);assert.equal(reads('/swarm'),1,'nothing is re-read within the upstream TTL');
    // Past the TTL the reader is answered at once with what the isolate holds (the same body), while every source is
    // re-read in the background (new fetchedAt); the next reader gets the body rebuilt exactly once, with the new job.
    up.data['/jobs?limit=50']={count:1,jobs:[{id:'job-2',objective:'second objective',status:'open'}]};
    at=1001+TTL;assert.equal(await read(),first);assert.equal(serialised,1);await settled();
    const changed=await read();assert.equal(serialised,2);assert.equal(reads('/swarm'),2);assert.equal(reads('/workers'),2);
    assert.ok(changed.includes('second objective'));assert.ok(!changed.includes('first objective'));
    assert.equal(await read(),changed);assert.equal(serialised,2);
    // A failed refresh is a change too: the swarm source turns stale in the body.
    up.fail.add('/swarm');at=2002+2*TTL;assert.equal(await read(),changed);await settled();
    const failed=JSON.parse(await read());assert.equal(serialised,3);
    assert.equal(failed.sources.swarm.state,'stale');assert.equal(failed.sources.swarm.error,'IMD HTTP 502');
    assert.equal(failed.sources.jobs.data.jobs[0].id,'job-2');
  } finally {JSON.stringify=original;}
});

test('per-IP rate limits: 429 JSON when a limiter refuses, open when it fails, 503 when production lacks the binding',async()=>{
  const up=upstream(),w=createWorker(new ReadGateway(up.fetcher,()=>1000));
  const keys=[];const limiter=success=>({limit:async({key})=>{keys.push(key);return {success};}});
  const ip={headers:{'cf-connecting-ip':'203.0.113.9'}};
  const blocked=assetsEnv({API_LIMITER:limiter(false)}).env;
  const refused=await w.fetch(get('/api/world/snapshot',ip),blocked,ctx());
  assert.equal(refused.status,429);assertApiHeaders(refused);assert.equal(refused.headers.get('retry-after'),'60');
  assert.deepEqual(await refused.json(),{error:'rate_limited'});assert.deepEqual(keys,['ip:203.0.113.9']);
  assert.equal(up.calls.length,0,'a refused request never reaches upstream');
  assert.equal((await w.fetch(get('/api/world/snapshot',{method:'POST'}),blocked,ctx())).status,405);
  const apiRefuses=assetsEnv({API_LIMITER:limiter(false),SEAT_LIMITER:limiter(true)}).env;
  assert.equal((await w.fetch(get('/api/world/seats/3',ip),apiRefuses,ctx())).status,429,'seat lookups count against API_LIMITER too');
  const seatsOnly=assetsEnv({API_LIMITER:limiter(true),SEAT_LIMITER:limiter(false)}).env;
  assert.equal((await w.fetch(get('/api/world/seats/3',ip),seatsOnly,ctx())).status,429);
  assert.equal((await w.fetch(get('/api/world/market',ip),seatsOnly,ctx())).status,200);
  assert.ok(!up.calls.some(u=>u.includes('/seats/3')));
  const failing=assetsEnv({API_LIMITER:{limit:async()=>{throw new Error('binding down');}},SEAT_LIMITER:{limit:()=>{throw new Error('sync');}}}).env;
  assert.equal((await w.fetch(get('/api/world/seats/4',ip),failing,ctx())).status,200);
  const bare=assetsEnv({API_LIMITER:undefined,SEAT_LIMITER:undefined}).env,missing=await w.fetch(get('/api/world/seats/5'),bare,ctx());
  assert.equal(missing.status,503,'no bindings on imdember.com: closed');assertApiHeaders(missing);assert.deepEqual(await missing.json(),{error:'limiter_unavailable'});
  assert.equal((await w.fetch(new Request('http://127.0.0.1:8791/api/world/seats/5'),bare,ctx())).status,200,'no bindings on loopback (wrangler dev): open');
});

test('the deployed worker sends upstream reads with edge-cache TTLs and an identifying User-Agent, kept alive by waitUntil',async()=>{
  const real=globalThis.fetch,sent=[];
  globalThis.fetch=async(input,init)=>{sent.push({input,init});return Response.json(input===API+'/swarm'?swarm:{tokenId:'7',work:[],devices:1,collaborators:[],reviews:[]});};
  try {
    const c=ctx(),r=await worker.fetch(get('/api/world/seats/7'),assetsEnv().env,c);
    assert.equal(r.status,200);const detail=await r.json();assert.equal(detail.state,'fresh');assert.equal('devices' in detail.data,false);
    assert.deepEqual(sent.map(x=>x.input),[API+'/swarm',API+'/seats/7?work=5&reviews=0'],'a cold isolate checks the id against the swarm first');
    for(const {init} of sent){
      // cacheEverything: Cloudflare caches no extensionless JSON without it, and cacheTtlByStatus does not imply it.
      assert.deepEqual(init.cf,{cacheEverything:true,cacheTtlByStatus:{'200-299':TTL/1000,'300-399':-1,'400-403':-1,'404':10,'405-499':-1,'500-599':-1}});
      assert.equal(new Headers(init.headers).get('user-agent'),USER_AGENT);assert.equal(new Headers(init.headers).get('accept'),'application/json');
      assert.ok(init.signal instanceof AbortSignal);
    }
    assert.equal(c.kept.length,2,'both upstream reads are kept alive past the response');
    for(const kept of c.kept)assert.equal((await kept).state,'fresh');
  } finally {globalThis.fetch=real;}
});

test('the Worker entry module exports only its default handler (workerd rejects any other export)',()=>{
  assert.deepEqual(Object.keys(entry),['default']);assert.equal(typeof entry.default.fetch,'function');
});

test('the Vite dev adapter runs the same handler and passes other paths on',async()=>{
  let middleware,preview;const plugin=imdGatewayPlugin();
  plugin.configureServer({middlewares:{use:fn=>{middleware=fn;}}});plugin.configurePreviewServer({middlewares:{use:fn=>{preview=fn;}}});
  assert.equal(preview,middleware,'`vite preview` serves the same API as `vite dev`');
  const run=(method,url)=>new Promise(resolve=>{
    const headers={};const res={statusCode:200,setHeader:(k,v)=>{headers[k.toLowerCase()]=v;},end:body=>resolve({status:res.statusCode,headers,body})};
    middleware({method,url},res,()=>resolve('next'));
  });
  const notFound=await run('GET','/api/world/nope');
  assert.equal(notFound.status,404);assert.equal(notFound.headers['content-type'],'application/json; charset=utf-8');
  assert.equal(notFound.headers['cache-control'],'no-store');assert.equal(notFound.body,'{"error":"unknown_route"}');
  const write=await run('POST','/api/world/snapshot');
  assert.equal(write.status,405);assert.equal(write.headers.allow,'GET');assert.equal(write.body,'{"error":"read_only"}');
  for(const url of ['/','/src/main.tsx','/api/world','/models/houses/house_timber_l.glb'])assert.equal(await run('GET',url),'next',url);
});

test('rate limits key IPv6 clients by their /64, so rotating host bits within one block gains nothing',async()=>{
  assert.equal(rateLimitKey('203.0.113.9'),'ip:203.0.113.9');assert.equal(rateLimitKey(null),'ip:unknown');
  assert.equal(rateLimitKey('::ffff:192.0.2.1'),'ip:192.0.2.1');
  for(const ip of ['2001:db8:1:2::1','2001:DB8:1:2:0:0:0:1f4','2001:0db8:0001:0002:ffff:ffff:ffff:ffff','2001:db8:1:2::'])
    assert.equal(rateLimitKey(ip),'ip6:2001:db8:1:2::/64',ip);
  assert.equal(rateLimitKey('2001:db8:1:3::1'),'ip6:2001:db8:1:3::/64');
  assert.equal(rateLimitKey('2001:db8::1:2:3:4:5'),'ip6:2001:db8:0:1::/64');
  assert.equal(rateLimitKey('::1'),'ip6:0:0:0:0::/64');
  // Through the Worker, with a fixed-window limiter of 60 per key like SEAT_LIMITER, from 100 addresses of one /64.
  const counts=new Map(),seatLimiter={limit:async({key})=>{counts.set(key,(counts.get(key)??0)+1);return {success:counts.get(key)<=60};}};
  const up=upstream(),w=createWorker(new ReadGateway(up.fetcher,()=>1000)),{env}=assetsEnv({SEAT_LIMITER:seatLimiter}),statuses={};
  for(let i=1;i<=100;i++){
    const r=await w.fetch(get('/api/world/seats/'+(1000+i),{headers:{'cf-connecting-ip':'2001:db8:1:2::'+i.toString(16)}}),env,ctx());
    statuses[r.status]=(statuses[r.status]??0)+1;
  }
  assert.deepEqual(statuses,{200:60,429:40});assert.deepEqual([...counts.keys()],['ip6:2001:db8:1:2::/64']);
  assert.equal(up.calls.filter(u=>u.includes('/seats/')).length,60,'refused requests never reach upstream');
});

// M1: the D1 sign-in budgets count per network, so one party rotating addresses inside its allocation spends one share.
test('the sign-in budgets key a client by its network: IPv4 /24, IPv6 /48, IPv4-mapped IPv6 as IPv4',()=>{
  for(const ip of ['203.0.113.9','203.0.113.250','::ffff:203.0.113.1'])assert.equal(networkKey(ip),'net:203.0.113.0/24',ip);
  assert.equal(networkKey('203.0.114.9'),'net:203.0.114.0/24');assert.equal(networkKey(null),'net:unknown');
  for(const ip of ['2001:db8:1:2::1','2001:db8:1:ffff::9','2001:0DB8:0001:0:0:0:0:1','2001:db8:1::'])assert.equal(networkKey(ip),'net6:2001:db8:1::/48',ip);
  assert.equal(networkKey('2001:db8:2::1'),'net6:2001:db8:2::/48');assert.equal(networkKey('::1'),'net6:0:0:0::/48');
});
// N-5 (Swarm audit 8c3aea2e): inside an IPv6 /48 network key, the subscriber is its /64 (the per-IP limiter's unit);
// the sign-in budgets give each /64 at most one /24's share (server/auth.ts). IPv4 has one level.
test('N-5: the subscriber key is the IPv6 /64 inside the /48 network key; IPv4, IPv4-mapped and unknown clients have none',()=>{
  for(const ip of ['2001:db8:1:a::1','2001:DB8:1:A:0:0:0:1f4','2001:db8:1:a::','2001:0db8:0001:000a:ffff:ffff:ffff:ffff'])assert.equal(subnetKey(ip),'net6:2001:db8:1:a::/64',ip);
  assert.equal(subnetKey('2001:db8:1:b::2'),'net6:2001:db8:1:b::/64');
  for(const ip of ['203.0.113.9','::ffff:192.0.2.1',null])assert.equal(subnetKey(ip),null,String(ip));
  for(const ip of ['2001:db8:1:a::1','2001:db8:1:b::2'])assert.equal(networkKey(ip),'net6:2001:db8:1::/48','the network key is unchanged: '+ip);
});

// The Cache API as workerd has it, in miniature: one store per location, keyed by URL, honouring max-age.
function fakeEdgeCache(clock){
  const store=new Map(),log=[];
  return {store,log,
    match:async url=>{log.push('match '+url);const e=store.get(url);if(!e||clock()>e.expires)return undefined;return new Response(e.body,{headers:e.headers});},
    put:async(url,response)=>{log.push('put '+url);const cc=response.headers.get('cache-control')??'',age=/max-age=(\d+)/.exec(cc);
      if(!age||/no-store|private/.test(cc))return;store.set(url,{body:await response.text(),headers:[...response.headers],expires:clock()+Number(age[1])*1000});}};
}
test('the Worker keeps a per-location shared copy of the snapshot, and a cold isolate answers from it at once',async()=>{
  let at=1_000_000;const cache=fakeEdgeCache(()=>at),up=upstream(),{seen,env}=assetsEnv();
  const w1=createWorker(new ReadGateway(up.fetcher,()=>at),undefined,()=>at,undefined,()=>cache),kept=[];
  const first=await w1.fetch(get('/api/world/snapshot'),env,ctx(kept));assert.equal(first.status,200);assertApiHeaders(first);
  const body=await first.json();await Promise.all(kept);
  const keys=['swarm','workers','jobs','oracle','publications','launches','activity'];
  assert.deepEqual([...cache.store.keys()].sort(),keys.map(k=>'https://imdember.com'+SHARED_COPY_PATH+SHARED_SHAPE+'/'+k).sort(),'same-origin keys under /api/world/_shared/v1/<shape>/');
  assert.match(SHARED_SHAPE,/^[0-9a-z]{1,7}$/);
  for(const [url,e] of cache.store){
    assert.equal(new Headers(e.headers).get('cache-control'),'public, max-age=3600');
    const record=JSON.parse(e.body),key=url.split('/').pop();
    assert.equal(record.fetchedAt,at);assert.equal(record.shape,SHARED_SHAPE);assert.equal(JSON.stringify(record.data),JSON.stringify(body.sources[key].data));
  }
  assert.equal(JSON.stringify([...cache.store.values()]).includes('secret-device-key'),false,'only the public, trimmed data');
  // No client request is ever answered from the copy: its path is an unknown route of the Worker, and nothing is looked up.
  const before=cache.log.length;
  for(const path of [SHARED_COPY_PATH+'swarm',SHARED_COPY_PATH+SHARED_SHAPE+'/swarm',SHARED_COPY_PATH+'workers?x=1',SHARED_COPY_PATH]){
    const r=await w1.fetch(get(path),env,ctx());assert.equal(r.status,404,path);assertApiHeaders(r);assert.deepEqual(await r.json(),{error:'unknown_route'});
  }
  assert.equal(cache.log.length,before);assert.equal(seen.length,0);
  // Another isolate in the same location, 2 min later, with api.imd.fun hanging: the snapshot comes from the copy.
  at+=120_000;const hung=createWorker(new ReadGateway(()=>new Promise(()=>{}),()=>at),undefined,()=>at,undefined,()=>cache),started=Date.now();
  const second=await hung.fetch(get('/api/world/snapshot'),env,ctx());assert.equal(second.status,200);assertApiHeaders(second);
  const served=await second.json();assert.ok(Date.now()-started<1000);
  for(const key of keys){assert.equal(served.sources[key].state,'fresh',key);assert.equal(served.sources[key].fetchedAt,at-120_000,key);}
  assert.equal(JSON.stringify(served.sources.swarm.data),JSON.stringify(body.sources.swarm.data));
  // An hour and more later the Cache API has dropped it (max-age), and the gateway would ignore it anyway.
  at+=3600_000;const later=createWorker(new ReadGateway(()=>new Promise(()=>{}),()=>at,{coldWaitMs:30}),undefined,()=>at,undefined,()=>cache);
  const gone=await (await later.fetch(get('/api/world/snapshot'),env,ctx())).json();assert.equal(gone.sources.swarm.state,'unavailable');
});
test('edgeCopy keys by the request origin, and a copy the Cache API does not have is undefined',async()=>{
  const cache=fakeEdgeCache(()=>0),copy=edgeCopy(cache,'http://127.0.0.1:8791');
  assert.equal(await copy.get('swarm'),undefined);
  await copy.put('swarm',{v:1,shape:SHARED_SHAPE,key:'swarm',data:{seats:{}},fetchedAt:5});
  assert.deepEqual([...cache.store.keys()],['http://127.0.0.1:8791/api/world/_shared/v1/'+SHARED_SHAPE+'/swarm']);
  assert.deepEqual(await copy.get('swarm'),{v:1,shape:SHARED_SHAPE,key:'swarm',data:{seats:{}},fetchedAt:5});
});
