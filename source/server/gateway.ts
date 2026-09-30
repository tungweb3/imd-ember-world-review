import type {SourceSample,FeedKey,OptionalFeedKey,Sources} from '../src/world/model.ts';
import {MARKET_URL,SEAT_COLLECTION,selectMarket,selectFloor} from '../src/world/market.ts';
// Clients read every 15 min (src/world/cadence.ts); upstream reads are cached for 5 min per isolate and at the edge.
// Past those 5 min a reader is answered at once from what the isolate holds while one read refreshes it in the
// background (stale-while-revalidate); a cold isolate starts from the per-colo shared copy (SharedCopy, below).
import {UPSTREAM_TTL_MS,FLOOR_TTL_MS,FLOOR_RETRY_MS,FLOOR_REFUSED_RETRY_MS,FRESH_MS,UPSTREAM_SLOW} from '../src/world/cadence.ts';
import {stageText,STAGE_TEXT} from '../src/world/status.ts';
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
/** Bump when the snapshot data changes shape in a way sharedShape cannot see (a helper the selects call, say). */
const SHARED_VERSION=1;
/** A short hash of what decides the shape of the data the shared copy holds: every snapshot route's url, field and
 *  select, the select functions and helpers themselves (their source text, as the running bundle has it) and their
 *  limits. It goes into the shared copy's key and into every record, so right after a deploy that changes a select
 *  no isolate answers with data the previous version shaped: that copy is simply not found. Pure; exported for tests. */
export function sharedShape(parts:readonly unknown[]):string{
  let h=0x811c9dc5;const text=JSON.stringify(parts.map(p=>typeof p==='function'||p instanceof RegExp?String(p):p));
  for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;}
  return h.toString(36);
}
export const SHARED_SHAPE_PARTS:readonly unknown[]=[SHARED_VERSION,...Object.entries(routes).flatMap(([k,r])=>[k,r.url,r.field,r.select??null]),
  selectSwarm,selectJobs,selectActivity,trimEvent,cut,plain,stageText,STAGE_TEXT,EVENT_FIELDS,EVENT_TEXT_MAX,SWARM_FIELDS,JOBS_KEPT,ORACLE_TEMPLATE];
export const SHARED_SHAPE=sharedShape(SHARED_SHAPE_PARTS);
/** Keeps a shared upstream read alive after the request that started it has answered (Workers: ctx.waitUntil). */
export type WaitUntil=(promise:Promise<unknown>)=>void;
/** The last good sample of one snapshot source, as kept in the shared copy. Public data only: exactly what the snapshot
 *  route answers with (after each route's select), never a header, key or seat detail. */
export type SharedRecord={v:1;shape:string;key:string;data:unknown;fetchedAt:number};
/** A copy of each snapshot source shared by every isolate of one Cloudflare location (worker/app.ts edgeCopy: the Cache
 *  API under a synthetic same-origin key that no client request is ever answered from). A cold isolate answers from it
 *  at once instead of waiting on api.imd.fun; every successful upstream read of a snapshot source writes it. */
export type SharedCopy={get(key:string):Promise<unknown>;put(key:string,record:SharedRecord):Promise<unknown>};
export type GatewayOptions={
  /** Longest a request that must wait (the wallet routes' and the cron's reads) waits on an upstream read before
   *  answering with what the cache already holds (ms). */
  waitMs?:number;
  /** Longest a snapshot, market or seat request waits when there is nothing to answer with yet (a cold isolate with no
   *  shared copy), before answering 'unavailable' while the read goes on in the background (ms). */
  coldWaitMs?:number;
  /** Longest a cold isolate waits on the shared copy before reading upstream itself (ms). */
  sharedWaitMs?:number;
  /** Data older than this is not answered at once as current data, from the shared copy or the isolate's own cache: a
   *  reader waits for the refresh (up to coldWaitMs). A refresh that fails keeps the last good data, labelled stale,
   *  whatever its age, as before (ms). */
  staleMaxAgeMs?:number;
  /** A shared read older than this is presumed lost (its request context ended) and a new one replaces it (ms). */
  inflightMaxAgeMs?:number;
  /** Seat details kept per gateway; the least recently read are dropped first. */
  seatLimit?:number;
};
/** Every upstream read is aborted after this long (ms). */
export const UPSTREAM_TIMEOUT_MS=10000;
// waitMs sits above the upstream timeout and below the client's 14 s (seat, market) and 18 s (snapshot) timeouts
// (CLIENT_TIMEOUT_MS in src/world/bridge.ts); inflightMaxAgeMs above both. tests/gateway.test.mjs pins the order.
// coldWaitMs: the live snapshot's first byte came after about 3.5 s in 3 of 5 cold samples (2026-09-29) and after
// 7.2 s once. 4 s lets the usual slow read land; past that the page is better served by an honest 'unavailable' and
// the client's quick retry (SOON_RETRY_MS, src/world/cadence.ts) than by a longer blank wait.
export const GATEWAY_DEFAULTS:Required<GatewayOptions>={waitMs:12000,coldWaitMs:4000,sharedWaitMs:500,staleMaxAgeMs:60*60_000,inflightMaxAgeMs:15000,seatLimit:256};
/** The keys the shared copy holds: the snapshot's sources. */
const SHARED_KEYS:ReadonlySet<string>=new Set(Object.keys(routes));
/** How a read may answer. `swr`: answer at once with data the isolate holds (up to staleMaxAgeMs old) while it is
 *  refreshed in the background, and wait at most coldWaitMs when there is none. Without it (the wallet routes and the
 *  cron) a read waits for the refresh, up to waitMs, as before. `shared`: the per-colo copy for a cold isolate. */
type LoadMode={swr?:boolean;shared?:SharedCopy;warmed?:boolean};
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
  /** The shared-copy lookup in progress for this key (a cold isolate's concurrent readers share it). */
  warming?:Promise<void>;
  /** The HTTP status of the last settled read (0: no response). */
  status?:number};
export class ReadGateway {
  private cache=new Map<string,CacheEntry>();
  private seats=new Map<string,CacheEntry>();
  private fetcher:typeof fetch;private now:()=>number;private options:Required<GatewayOptions>;
  private snapshotMemo?:{samples:SourceSample[];body:string};
  /** The shared copy the latest request brought: a read started by a caller without one (the wallet routes) writes it too. */
  private shared?:SharedCopy;
  constructor(fetcher:typeof fetch=fetch,now=Date.now,options:GatewayOptions={}){this.fetcher=fetcher;this.now=now;this.options={...GATEWAY_DEFAULTS,...options};}
  /** A read by key: a path on api.imd.fun (or a full https URL), the market, or a seat ('seat:<id>'). */
  read(key:string,path:string,ttl:number,field?:string,waitUntil?:WaitUntil):Promise<SourceSample> {
    const route=(routes as Record<string,Route|undefined>)[key];
    const url=key==='market'?MARKET_URL:path.startsWith('https://')?path:API+path;
    const select:ReadSpec['select']=key==='market'?undefined:route?.select??(key.startsWith('seat:')?
      d=>{const {collaborators,devices,reviews,...publicDetail}=d;void collaborators;void devices;void reviews;return publicDetail;}:undefined);
    return this.load(key,{url,ttl,field,select},waitUntil,{swr:true});
  }
  private async load(key:string,spec:ReadSpec,waitUntil?:WaitUntil,mode:LoadMode={}):Promise<SourceSample> {
    if(mode.shared)this.shared=mode.shared;
    const at=this.now(),map=key.startsWith('seat:')?this.seats:this.cache,swr=mode.swr===true;let entry=map.get(key);
    if(entry&&map===this.seats){map.delete(key);map.set(key,entry);}
    // Nothing to answer with (a cold isolate, or one whose own reads have not landed yet): look in the location's shared
    // copy first, one lookup shared by concurrent readers, then start over holding whatever it found. Another isolate's
    // read may have filled it since this one started its own.
    // The lookup is shared, so each reader bounds its own wait on its own timer (sharedWaitMs), and the lookup is kept
    // alive by the waitUntil of the request that started it. A lookup still pending when a reader's own timer runs out
    // outlived its own bound: its request context ended (workerd cancels that request's timers and I/O) and it may
    // never settle, so that reader drops it and the next reader starts a new one. Without this one lost lookup would
    // hold every later reader of the key on this isolate, and no upstream read would ever start.
    if(swr&&mode.shared&&!mode.warmed&&SHARED_KEYS.has(key)&&!(entry&&this.servable(entry.sample,at))){
      const cold=entry??this.blank(map,key,spec);
      if(!cold.warming){const warming=this.warm(cold,key,spec,mode.shared).finally(()=>{if(cold.warming===warming)cold.warming=undefined;});cold.warming=warming;waitUntil?.(warming);}
      const lookup=cold.warming;
      if(!await this.settlesWithin(lookup,this.options.sharedWaitMs)&&cold.warming===lookup)cold.warming=undefined;
      return this.load(key,spec,waitUntil,{...mode,warmed:true});
    }
    if(entry?.inflight){
      if(at-entry.inflightStartedAt<=this.options.inflightMaxAgeMs){
        if(swr&&this.servable(entry.sample,at))return this.label(entry.sample,at);
        return this.bounded(entry,entry.inflight,swr?this.options.coldWaitMs:this.options.waitMs);
      }
    }
    else if(entry && entry.validUntil>at)return swr?this.label(entry.sample,at):entry.sample;
    entry??=this.blank(map,key,spec);
    const current=entry,generation=++current.generation,copy=SHARED_KEYS.has(key)?mode.shared??this.shared:undefined;
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
        const fetchedAt=this.now()-ageMs;
        current.sample={state:'fresh',data,url:current.sample.url,fetchedAt};
        // Kept alive by the same waitUntil as this read; a failed write only means the next cold isolate reads upstream.
        if(copy)waitUntil?.(Promise.resolve().then(()=>copy.put(key,{v:1,shape:SHARED_SHAPE,key,data,fetchedAt})).catch(()=>{}));
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
    if(swr&&this.servable(current.sample,at))return this.label(current.sample,at);
    return this.bounded(current,run,swr?this.options.coldWaitMs:this.options.waitMs);
  }
  private blank(map:Map<string,CacheEntry>,key:string,spec:ReadSpec):CacheEntry{
    const entry:CacheEntry={sample:{state:'unavailable',data:null,url:spec.publicUrl??spec.url,fetchedAt:null},validUntil:0,failures:0,inflightStartedAt:0,generation:0};map.set(key,entry);
    if(map===this.seats)while(map.size>this.options.seatLimit)map.delete(map.keys().next().value!);
    return entry;
  }
  /** Data a reader may be answered with at once: present and no older than staleMaxAgeMs. */
  private servable(sample:SourceSample,at:number):boolean{return sample.data!==null&&sample.fetchedAt!==null&&at-sample.fetchedAt<=this.options.staleMaxAgeMs;}
  /** 'fresh' only while the data is as current as the client counts as current (FRESH_MS, src/world/cadence.ts: one
   *  cycle plus grace); older data answered at once is 'stale'. The data keeps its own fetchedAt either way. */
  private label(sample:SourceSample,at:number):SourceSample{
    return sample.state==='fresh'&&sample.fetchedAt!==null&&at-sample.fetchedAt>FRESH_MS?{...sample,state:'stale'}:sample;
  }
  /** Seed an entry from the shared copy, if the copy holds this key's data in this build's shape (SHARED_SHAPE), no
   *  older than staleMaxAgeMs and newer than what the entry holds (none, data too old to answer with, or data an older
   *  read left). The seeded data counts as read at its own fetchedAt: within the TTL no upstream read follows, past it
   *  one refreshes it. Never throws, never waits past sharedWaitMs, and never replaces data at least as new, such as
   *  an upstream read that landed during the lookup. */
  private async warm(entry:CacheEntry,key:string,spec:ReadSpec,shared:SharedCopy):Promise<void>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const late=new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),this.options.sharedWaitMs);});
      const record=await Promise.race([Promise.resolve().then(()=>shared.get(key)),late]) as Partial<SharedRecord>|null|undefined;
      if(!record||typeof record!=='object'||record.v!==1||record.shape!==SHARED_SHAPE||record.key!==key||!plain(record.data)||typeof record.fetchedAt!=='number')return;
      const at=this.now(),age=at-record.fetchedAt;
      if(!(age>=-60_000&&age<=this.options.staleMaxAgeMs))return;   // too old, or dated in the future
      if(spec.field&&!(spec.field in record.data))return;
      const fetchedAt=Math.min(record.fetchedAt,at);
      if(entry.sample.data!==null&&(entry.sample.fetchedAt===null||entry.sample.fetchedAt>=fetchedAt))return;
      entry.sample={state:'fresh',data:record.data,url:entry.sample.url,fetchedAt};
      entry.failures=0;entry.validUntil=Math.max(entry.validUntil,fetchedAt+spec.ttl);
    } catch {/* no usable shared copy: read upstream */} finally {clearTimeout(timer);}
  }
  /** Whether `promise` settles within `ms`, timed by the caller's own timer (never throws). */
  private settlesWithin(promise:Promise<unknown>,ms:number):Promise<boolean>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const late=new Promise<boolean>(resolve=>{timer=setTimeout(()=>resolve(false),ms);});
    return Promise.race([promise.then(()=>true,()=>true),late]).finally(()=>clearTimeout(timer));
  }
  /** Every reader, the one that started the read included, answers within waitMs even if the upstream read never settles. */
  private bounded(entry:CacheEntry,run:Promise<SourceSample>,ms:number):Promise<SourceSample> {
    let timer:ReturnType<typeof setTimeout>|undefined;
    const overdue=new Promise<SourceSample>(resolve=>{timer=setTimeout(()=>resolve({...entry.sample,state:entry.sample.data?'stale':'unavailable',error:UPSTREAM_SLOW}),ms);});
    return Promise.race([run,overdue]).finally(()=>clearTimeout(timer));
  }
  /** Every source answered at once when the isolate (or, cold, the shared copy) has data for it, refreshed in the
   *  background past its TTL; only a source with no data anywhere waits, up to coldWaitMs. */
  async snapshot(waitUntil?:WaitUntil,shared?:SharedCopy){
    const pairs=await Promise.all(Object.entries(routes).map(async([key,r])=>[key,await this.load(key,r,waitUntil,{swr:true,shared})]));
    return {mode:'live',sources:Object.fromEntries(pairs)} as {mode:'live';sources:Sources};
  }
  /** JSON of snapshot(). Samples are replaced, never mutated, so unchanged sample objects mean an unchanged body. */
  async snapshotBody(waitUntil?:WaitUntil,shared?:SharedCopy):Promise<string>{
    const snapshot=await this.snapshot(waitUntil,shared),samples=Object.values(snapshot.sources),memo=this.snapshotMemo;
    if(memo&&memo.samples.length===samples.length&&memo.samples.every((s,i)=>s===samples[i]))return memo.body;
    const body=JSON.stringify(snapshot);this.snapshotMemo={samples,body};return body;
  }
  /** Seat detail. An id no minted seat has is answered here, without an upstream read or a cache entry, so arbitrary
   *  ids cannot fan out to api.imd.fun or push real seats out of the LRU. An id missing from the cached swarm refreshes
   *  the swarm first (at most once per swarm TTL) so new seats are found; with no swarm data at all it goes upstream.
   *  That refresh is waited for (up to waitMs), not answered from the old swarm: the old one is what lacks the id. */
  async seat(id:string,waitUntil?:WaitUntil):Promise<SourceSample>{
    const path='/seats/'+id+'?work=5&reviews=0',swarm=routes.swarm;
    if(seatKnown(this.cache.get('swarm')?.sample,id)!==true&&seatKnown(await this.load('swarm',swarm,waitUntil),id)===false)
      return {state:'unavailable',data:null,url:API+path,fetchedAt:null,error:'Unknown seat'};
    return this.read('seat:'+id,path,UPSTREAM_TTL_MS,'tokenId',waitUntil);
  }
  market(waitUntil?:WaitUntil){return this.read('market','',UPSTREAM_TTL_MS,undefined,waitUntil);}
  /** One snapshot source through the same cache (the wallet routes and the presence recorder read swarm and workers).
   *  These wait for an expired entry's refresh (up to waitMs), as they always have: ownership and presence are decided
   *  on the newest roster the gateway can get, not on the one it happens to hold. */
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
