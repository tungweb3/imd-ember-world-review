import type {SourceSample,FeedKey,OptionalFeedKey,Sources} from '../src/world/model.ts';
import {MARKET_URL,SEAT_COLLECTION,selectMarket,selectFloor} from '../src/world/market.ts';
// Clients read every 15 min (src/world/cadence.ts); upstream reads are cached for 5 min per isolate and at the edge.
import {UPSTREAM_TTL_MS,FLOOR_TTL_MS,FLOOR_RETRY_MS,FLOOR_REFUSED_RETRY_MS} from '../src/world/cadence.ts';
import {stageText} from '../src/world/status.ts';
// Runtime-agnostic: used by the Vite dev server (server/vite-plugin.ts) and the Cloudflare Worker (worker/index.ts).
export const API='https://api.imd.fun';
/** Explorer's footer counts and 24 hourly step buckets. No CORS header, so only the Worker can read it. Optional: a
 *  snapshot without it is still complete. */
export const ACTIVITY_URL='https://explorer.imd.fun/api/activity';
/** Alchemy NFT API v3; the key goes in the Authorization header, never in the URL. */
export const FLOOR_URL='https://eth-mainnet.g.alchemy.com/nft/v3/getFloorPrice?contractAddress='+SEAT_COLLECTION;
/** Oracle questions are jobs too (template skill:oracle-assess), and so are a workflow's stages (status.ts stageText);
 *  Explorer's Jobs tab leaves both out (it lists the parent workflow), and so does the Forge. /jobs ignores ?template=,
 *  so 50 rows are read (about 20–26 KB) and filtered here, keeping the 12 newest. */
export const ORACLE_TEMPLATE='skill:oracle-assess';
export const JOBS_KEPT=12;
/** Swarm events: the fields the recent-activity digest reads. Objectives are cut: a few 5 KB objectives made the events
 *  about 130 KB of a 300 KB swarm body on 2026-09-27, and the digest shows a one-line title. */
export const EVENT_FIELDS=['kind','at','tokenId','step','role','state','jobId','objective','reason','steps','failure','launchNumber','chainId','token','ensName','cid','label'] as const;
export const EVENT_TEXT_MAX=240;
const SWARM_FIELDS=['at','health','counts','seats','events','owners','chain'] as const;

type Json=Record<string,unknown>;
const plain=(v:unknown):v is Json=>v!==null&&typeof v==='object'&&!Array.isArray(v);
// Whitespace is collapsed on a bounded prefix only, so an oversized objective costs no more CPU than a short one.
const cut=(v:unknown)=>{if(typeof v!=='string')return v;const t=v.slice(0,EVENT_TEXT_MAX*4).replace(/\s+/g,' ').trim();return t.length>EVENT_TEXT_MAX?t.slice(0,EVENT_TEXT_MAX-1)+'…':t;};
function trimEvent(e:unknown):Json|null {
  if(!plain(e))return null;
  const out:Json={};
  for(const k of EVENT_FIELDS){
    if(!(k in e))continue;const v=e[k];
    if(k==='token'){if(v===null||typeof v!=='object'||JSON.stringify(v).length<=300)out[k]=v;continue;}   // launch token {symbol,…}: small or dropped
    out[k]=k==='objective'||k==='reason'||k==='failure'?cut(v):v;
  }
  return out;
}
/** /swarm: known top-level fields only, and trimmed events. health.reachable false means IMD's own summary failed. */
export function selectSwarm(data:Json):Json {
  if(!plain(data.seats))throw new Error('IMD swarm schema changed');
  if(plain(data.health)&&data.health.reachable===false)throw new Error('IMD summary health unavailable');
  const out:Json={};
  for(const k of SWARM_FIELDS)if(k in data)out[k]=data[k];
  if(Array.isArray(data.events))out.events=data.events.map(trimEvent).filter(e=>e!==null);
  return out;
}
/** /jobs?limit=50 → the 12 newest jobs that are neither oracle questions nor workflow stages, in upstream order, and
 *  the ids of the stage jobs among the 50 (`stages`), so the recent-activity digest never links an event to a stage's
 *  missing page (happenings.ts). */
export function selectJobs(data:Json):Json {
  if(!Array.isArray(data.jobs))throw new Error('IMD jobs schema changed');
  const rows=data.jobs.filter(plain),stage=(j:Json)=>stageText(j.objective);
  const jobs=rows.filter(j=>j.template!==ORACLE_TEMPLATE&&!stage(j)).slice(0,JOBS_KEPT);
  return {count:jobs.length,jobs,stages:rows.filter(stage).map(j=>j.id).filter(id=>typeof id==='string')};
}
export function selectActivity(data:Json):Json {
  if(data.reachable===false)throw new Error('Explorer activity unavailable');
  const steps=data.steps,n=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  if(!Array.isArray(steps)||steps.length<1||steps.length>48||steps.some(v=>n(v)===null))throw new Error('Explorer activity schema changed');
  return {at:n(data.at),reachable:data.reachable===true,workflows:n(data.workflows),jobs:n(data.jobs),oracle:n(data.oracle),working:n(data.working),total:n(data.total),steps};
}

type Route={url:string;ttl:number;field:string;select?:(data:Json)=>Json};
// Every snapshot source, required and optional. The optional ones never fail the snapshot (bridge.ts checks FeedKeys only).
const routes:Record<FeedKey|OptionalFeedKey,Route>={
  swarm:{url:API+'/swarm',ttl:UPSTREAM_TTL_MS,field:'seats',select:selectSwarm},
  // /workers is the largest payload (~490 KB); only the fields the world reads are kept.
  workers:{url:API+'/workers',ttl:UPSTREAM_TTL_MS,field:'workers',select:d=>{if(!Array.isArray(d.workers))throw new Error('IMD workers schema changed');
    return {count:d.count,workers:d.workers.map((x:Json)=>({seat:x.seat,working:x.working,daemonVersion:x.daemonVersion,runtimes:x.runtimes,lastHeartbeatAt:x.lastHeartbeatAt}))};}},
  jobs:{url:API+'/jobs?limit=50',ttl:UPSTREAM_TTL_MS,field:'jobs',select:selectJobs},
  oracle:{url:API+'/oracle/requests?limit=8',ttl:UPSTREAM_TTL_MS,field:'requests'},
  publications:{url:API+'/publications?pageSize=8',ttl:UPSTREAM_TTL_MS,field:'items'},
  launches:{url:API+'/launches?limit=8',ttl:UPSTREAM_TTL_MS,field:'launches'},
  activity:{url:ACTIVITY_URL,ttl:UPSTREAM_TTL_MS,field:'steps',select:selectActivity}
};
export const SNAPSHOT_ROUTES:Readonly<Record<string,{url:string;ttl:number}>>=routes;
/** Keeps a shared upstream read alive after the request that started it has answered (Workers: ctx.waitUntil). */
export type WaitUntil=(promise:Promise<unknown>)=>void;
export type GatewayOptions={
  /** Longest any request waits on an upstream read before answering with what the cache already holds (ms). */
  waitMs?:number;
  /** A shared read older than this is presumed lost (its request context ended) and a new one replaces it (ms). */
  inflightMaxAgeMs?:number;
  /** Seat details kept per gateway; the least recently read are dropped first. */
  seatLimit?:number;
};
/** Every upstream read is aborted after this long (ms). */
export const UPSTREAM_TIMEOUT_MS=10000;
// waitMs sits above the upstream timeout and below the client's 14 s (seat, market) and 18 s (snapshot) timeouts
// (CLIENT_TIMEOUT_MS in src/world/bridge.ts); inflightMaxAgeMs above both. tests/gateway.test.mjs pins the order.
export const GATEWAY_DEFAULTS:Required<GatewayOptions>={waitMs:12000,inflightMaxAgeMs:15000,seatLimit:256};
// Seat ids that can have details: the swarm's paired seats and every minted seat (owners[] is indexed by token id).
// undefined until a swarm sample with seat data exists.
function seatKnown(sample:SourceSample|undefined,id:string):boolean|undefined {
  const data=sample?.data as {seats?:unknown;owners?:unknown}|null|undefined;
  if(!data||!data.seats||typeof data.seats!=='object')return undefined;
  return Object.hasOwn(data.seats,id)||Array.isArray(data.owners)&&BigInt(id)<BigInt(data.owners.length);
}
/** One cached upstream read. `url` is what is fetched; `publicUrl` is what samples report (never a secret);
 *  `headers` are added to the request; errors from a route with `opaqueErrors` are reported generically. */
type ReadSpec={url:string;publicUrl?:string;ttl:number;field?:string;select?:(data:Json)=>Json;headers?:Record<string,string>;retryMinMs?:number;
  /** Wait after an upstream 401/403 (the key was refused), instead of the usual retry schedule. */
  refusedRetryMs?:number;opaqueErrors?:string};
type CacheEntry={sample:SourceSample;validUntil:number;failures:number;inflight?:Promise<SourceSample>;inflightStartedAt:number;generation:number;
  /** The HTTP status of the last settled read (0: no response). */
  status?:number};
export class ReadGateway {
  private cache=new Map<string,CacheEntry>();
  private seats=new Map<string,CacheEntry>();
  private fetcher:typeof fetch;private now:()=>number;private options:Required<GatewayOptions>;
  private snapshotMemo?:{samples:SourceSample[];body:string};
  constructor(fetcher:typeof fetch=fetch,now=Date.now,options:GatewayOptions={}){this.fetcher=fetcher;this.now=now;this.options={...GATEWAY_DEFAULTS,...options};}
  /** A read by key: a path on api.imd.fun (or a full https URL), the market, or a seat ('seat:<id>'). */
  read(key:string,path:string,ttl:number,field?:string,waitUntil?:WaitUntil):Promise<SourceSample> {
    const route=(routes as Record<string,Route|undefined>)[key];
    const url=key==='market'?MARKET_URL:path.startsWith('https://')?path:API+path;
    const select:ReadSpec['select']=key==='market'?undefined:route?.select??(key.startsWith('seat:')?
      d=>{const {collaborators,devices,reviews,...publicDetail}=d;void collaborators;void devices;void reviews;return publicDetail;}:undefined);
    return this.load(key,{url,ttl,field,select},waitUntil);
  }
  private async load(key:string,spec:ReadSpec,waitUntil?:WaitUntil):Promise<SourceSample> {
    const at=this.now(),map=key.startsWith('seat:')?this.seats:this.cache;let entry=map.get(key);
    if(entry&&map===this.seats){map.delete(key);map.set(key,entry);}
    if(entry?.inflight){if(at-entry.inflightStartedAt<=this.options.inflightMaxAgeMs)return this.bounded(entry,entry.inflight);}
    else if(entry && entry.validUntil>at)return entry.sample;
    if(!entry){
      entry={sample:{state:'unavailable',data:null,url:spec.publicUrl??spec.url,fetchedAt:null},validUntil:0,failures:0,inflightStartedAt:0,generation:0};map.set(key,entry);
      if(map===this.seats)while(map.size>this.options.seatLimit)map.delete(map.keys().next().value!);
    }
    const current=entry,generation=++current.generation;
    const run=(async()=>{
      await undefined; // never settle synchronously: the finally below must run after `inflight` is assigned
      let status=0;
      try {
        const r=await this.fetcher(spec.url,{signal:AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),headers:{accept:'application/json',...spec.headers}});
        status=r.status;
        if(!r.ok)throw new Error('IMD HTTP '+r.status);
        let data=await r.json();
        if(key==='market')data=selectMarket(data);
        if(!data||typeof data!=='object'||Array.isArray(data)||data.error||spec.field&&!(spec.field in data))throw new Error('IMD response schema changed');
        if(spec.select)data=spec.select(data);
        // A shared HTTP cache may answer with an older copy; date the data by its Age, in dev as in the Worker. DEX
        // Screener's own CDN sends Age (up to its max-age=30), so the market sample is typically 0-30 s older than
        // the moment it was read; api.imd.fun sends Age only when it comes from the Worker's edge cache.
        const age=Number(r.headers.get('age')),ageMs=Number.isFinite(age)&&age>0?Math.min(age,300)*1000:0;
        if(current.generation!==generation)return current.sample;
        current.failures=0;current.status=status;current.validUntil=this.now()+spec.ttl;
        current.sample={state:'fresh',data,url:current.sample.url,fetchedAt:this.now()-ageMs};
      } catch(error) {
        if(current.generation!==generation)return current.sample;
        current.failures++;current.status=status;
        current.validUntil=this.now()+(spec.refusedRetryMs&&(status===401||status===403)?spec.refusedRetryMs:Math.max(spec.retryMinMs??0,Math.min(60000,10000*2**Math.min(current.failures-1,3))));
        const message=spec.opaqueErrors?spec.opaqueErrors+(status?' (HTTP '+status+')':''):error instanceof Error?error.message:'IMD unavailable';
        current.sample={...current.sample,state:current.sample.data?'stale':'unavailable',retryAt:current.validUntil,error:message};
      } finally {if(current.generation===generation)current.inflight=undefined;}
      return current.sample;
    })();
    current.inflight=run;current.inflightStartedAt=at;
    waitUntil?.(run);
    return this.bounded(current,run);
  }
  /** Every reader, the one that started the read included, answers within waitMs even if the upstream read never settles. */
  private bounded(entry:CacheEntry,run:Promise<SourceSample>):Promise<SourceSample> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    const overdue=new Promise<SourceSample>(resolve=>{timer=setTimeout(()=>resolve({...entry.sample,state:entry.sample.data?'stale':'unavailable',error:'IMD upstream slow'}),this.options.waitMs);});
    return Promise.race([run,overdue]).finally(()=>clearTimeout(timer));
  }
  async snapshot(waitUntil?:WaitUntil){
    const pairs=await Promise.all(Object.entries(routes).map(async([key,r])=>[key,await this.load(key,r,waitUntil)]));
    return {mode:'live',sources:Object.fromEntries(pairs)} as {mode:'live';sources:Sources};
  }
  /** JSON of snapshot(). Samples are replaced, never mutated, so unchanged sample objects mean an unchanged body. */
  async snapshotBody(waitUntil?:WaitUntil):Promise<string>{
    const snapshot=await this.snapshot(waitUntil),samples=Object.values(snapshot.sources),memo=this.snapshotMemo;
    if(memo&&memo.samples.length===samples.length&&memo.samples.every((s,i)=>s===samples[i]))return memo.body;
    const body=JSON.stringify(snapshot);this.snapshotMemo={samples,body};return body;
  }
  /** Seat detail. An id no minted seat has is answered here, without an upstream read or a cache entry, so arbitrary
   *  ids cannot fan out to api.imd.fun or push real seats out of the LRU. An id missing from the cached swarm refreshes
   *  the swarm first (at most once per swarm TTL) so new seats are found; with no swarm data at all it goes upstream. */
  async seat(id:string,waitUntil?:WaitUntil):Promise<SourceSample>{
    const path='/seats/'+id+'?work=5&reviews=0',swarm=routes.swarm;
    if(seatKnown(this.cache.get('swarm')?.sample,id)!==true&&seatKnown(await this.load('swarm',swarm,waitUntil),id)===false)
      return {state:'unavailable',data:null,url:API+path,fetchedAt:null,error:'Unknown seat'};
    return this.read('seat:'+id,path,UPSTREAM_TTL_MS,'tokenId',waitUntil);
  }
  market(waitUntil?:WaitUntil){return this.read('market','',UPSTREAM_TTL_MS,undefined,waitUntil);}
  /** One snapshot source through the same cache (the wallet routes and the presence recorder read swarm and workers). */
  source(key:FeedKey|OptionalFeedKey,waitUntil?:WaitUntil):Promise<SourceSample>{return this.load(key,routes[key],waitUntil);}
  /** The seat NFT floor through Alchemy, or an 'unavailable' sample without any upstream read when no key is set. The
   *  key only ever travels in the Authorization header: samples carry FLOOR_URL (no key) and generic error text. */
  floor(apiKey:string|undefined,waitUntil?:WaitUntil):Promise<SourceSample>{
    if(!apiKey)return Promise.resolve({state:'unavailable',data:null,url:FLOOR_URL,fetchedAt:null,error:'Seat floor not configured'});
    return this.load('floor',{url:FLOOR_URL,ttl:FLOOR_TTL_MS,retryMinMs:FLOOR_RETRY_MS,refusedRetryMs:FLOOR_REFUSED_RETRY_MS,headers:{authorization:'Bearer '+apiKey},
      opaqueErrors:'Seat floor unavailable',select:d=>selectFloor(d,this.now())},waitUntil);
  }
  /** The floor as the cache holds it now, never waiting on Alchemy: an expired or missing entry starts a read in the
   *  background (kept alive by waitUntil) that the next request sees. For the market route, whose quote must not wait. */
  floorNow(apiKey:string|undefined,waitUntil?:WaitUntil):SourceSample|undefined{
    if(!apiKey)return undefined;
    const entry=this.cache.get('floor');
    if(!entry||!entry.inflight&&entry.validUntil<=this.now())void this.floor(apiKey,waitUntil).catch(()=>{});
    return this.cache.get('floor')?.sample;
  }
  /** Alchemy refused the key on the last read (401/403): the Worker tells clients it has no floor source, so they stop
   *  asking for the session; it asks Alchemy again only after FLOOR_REFUSED_RETRY_MS. */
  floorRefused():boolean{const s=this.cache.get('floor')?.status;return s===401||s===403;}
}
