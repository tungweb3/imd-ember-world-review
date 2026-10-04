import { deriveWorld, type DataMode, type Snapshot, type WorldState, type SourceSample, type FeedKey, type OptionalFeedKey } from './model.ts';
import {mockSnapshot} from './mock.ts';
import {demoMarket,MARKET_URL,selectMarket,type MarketExtras,type MarketSample} from './market.ts';
import {REFRESH_MS} from './cadence.ts';
import {isFreshAge} from '../shared/freshness.ts';
/** Required snapshot sources: a snapshot missing any of these is rejected. */
const KEYS:FeedKey[]=['swarm','workers','jobs','oracle','publications','launches'];
/** Optional sources: kept when present and well-formed, never required. */
const OPTIONAL:OptionalFeedKey[]=['activity'];
const isSample=(s:unknown):s is SourceSample=>!!s&&typeof s==='object'&&['fresh','stale','unavailable'].includes((s as SourceSample).state);
/** How long the client waits for each world API route; the gateway answers sooner (GATEWAY_DEFAULTS.waitMs in server/gateway.ts). */
export const CLIENT_TIMEOUT_MS={snapshot:18000,seat:14000,market:14000} as const;
/** The Worker's market route, asked only for what it alone can read (the seat floor). */
export const MARKET_EXTRAS_URL='/api/world/market?only=extras';
/** After a failed extras read, the next drawer opening may ask again this much later. */
export const EXTRAS_RETRY_MS=60_000;
function extrasOf(value:unknown):MarketExtras|null {
  const x=value as MarketExtras|null|undefined;
  if(!x||typeof x!=='object'||typeof x.floorEnabled!=='boolean')return null;
  const f=x.floor;
  return f&&typeof f==='object'&&typeof f.floorEth==='number'&&typeof f.fetchedAt==='number'&&typeof f.marketplace==='string'?
    {floorEnabled:x.floorEnabled,floor:{floorEth:f.floorEth,marketplace:f.marketplace,fetchedAt:f.fetchedAt,...(typeof f.floorUsd==='number'?{floorUsd:f.floorUsd}:{})}}:{floorEnabled:x.floorEnabled};
}
/** The page's first snapshot read, started by main.tsx as soon as the bundle runs: before React mounts and the 3D scene
 *  is built (seconds on a phone), so the data no longer waits for the scene, nor shares the link with its model
 *  downloads. The first live refresh() takes it instead of asking again, if it is younger than EARLY_READ_MAX_AGE_MS
 *  (a page opened in a background tab reads again rather than show what it read then). Taken once, then gone. */
export const EARLY_READ_MAX_AGE_MS=60_000;
let early:{at:number;response:Promise<Response>}|null=null;
/** Start the early read. Does nothing where the browser lacks AbortSignal.timeout (Safari before 16): the page must
 *  still mount there, and refresh() reads on its own. */
export function startEarlyRead(fetcher:typeof fetch=(input,init)=>fetch(input,init),now:()=>number=Date.now):void {
  if(typeof AbortSignal==='undefined'||typeof AbortSignal.timeout!=='function')return;
  const response=fetcher('/api/world/snapshot',{signal:AbortSignal.timeout(CLIENT_TIMEOUT_MS.snapshot)});
  response.catch(()=>{});   // a failed early read is not an error on its own: refresh() reads again
  early={at:now(),response};
}
/** What main.tsx runs before React mounts: the early read in live mode only, and never a throw (the page must mount). */
export function bootRead(mode:DataMode,start:()=>void=()=>startEarlyRead()):boolean {
  if(mode!=='live')return false;
  try{start();return true;}catch{return false;}
}
function takeEarlyRead(now:number):{at:number;response:Promise<Response>}|null {const e=early;early=null;return e&&isFreshAge(now,e.at,EARLY_READ_MAX_AGE_MS)?e:null;}
/** `promise`, or a rejection as soon as `signal` aborts (the early read has its own timeout, not the caller's signal). */
function unlessAborted<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T> {
  if(!signal)return promise;
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(signal.reason??new DOMException('Aborted','AbortError'));
    if(signal.aborted){abort();return;}
    signal.addEventListener('abort',abort,{once:true});
    promise.then(v=>{signal.removeEventListener('abort',abort);resolve(v);},e=>{signal.removeEventListener('abort',abort);reject(e);});
  });
}
export class ImdBridge {
  private world?:WorldState; private tick=0;
  private marketSample:SourceSample|null=null;
  /** The Worker's latest market extras; `wantExtras` turns false once the Worker says it has no floor source;
   *  `extrasAt` is when they were last asked for (or arrived with a fallback quote). */
  private extras:MarketExtras|null=null; private wantExtras=true; private extrasAt=-Infinity; private extrasTtl=REFRESH_MS;
  readonly mode:DataMode; private fetcher:typeof fetch; private now:()=>number;
  constructor(mode:DataMode, fetcher:typeof fetch=(input,init)=>fetch(input,init), now:()=>number=Date.now) {this.mode=mode;this.fetcher=fetcher;this.now=now;}
  private signal(route:keyof typeof CLIENT_TIMEOUT_MS,signal?:AbortSignal,ms:number=CLIENT_TIMEOUT_MS[route]){return signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);}
  async refresh(signal?:AbortSignal):Promise<WorldState> {
    if(this.mode==='mock') {this.world=deriveWorld(mockSnapshot(128,this.tick++),this.world);return this.world;}
    try {
      // The early read if there is one, else a read of its own. A failed early read is read again here, within what is
      // left of the early read's time budget (the page waits no longer for its first data than it did before the early
      // read existed); one that used it all up reports the data unavailable and the poll tries again at its cadence.
      const pre=takeEarlyRead(this.now()),first=pre?await unlessAborted(pre.response.catch(()=>null),signal):null;
      let r=first;
      if(!r){
        const left=pre?CLIENT_TIMEOUT_MS.snapshot-(this.now()-pre.at):CLIENT_TIMEOUT_MS.snapshot;
        if(left<=0)throw new Error('資料服務逾時');
        r=await this.fetcher('/api/world/snapshot',{signal:this.signal('snapshot',signal,left)});
      }
      if(!r.ok)throw new Error('資料服務 HTTP '+r.status);
      const snapshot=await unlessAborted(r.json(),signal) as Snapshot;
      if(snapshot.mode!=='live'||!snapshot.sources||KEYS.some(k=>!snapshot.sources[k]))throw new Error('資料格式不相符');
      for(const k of OPTIONAL)if(k in snapshot.sources&&!isSample(snapshot.sources[k]))delete snapshot.sources[k];
      this.world=deriveWorld(snapshot,this.world);
    } catch(error) {
      if(signal?.aborted)throw error;
      const keep=(k:FeedKey|OptionalFeedKey):SourceSample=>{const prior=this.world?.sources[k];return {state:prior?.data?'stale':'unavailable',data:prior?.data??null,url:prior?.url??'https://api.imd.fun',fetchedAt:prior?.fetchedAt??null,error:'目前連不上資料服務'};};
      const sources=Object.fromEntries([...KEYS.map(k=>[k,keep(k)]),...OPTIONAL.filter(k=>this.world?.sources[k]).map(k=>[k,keep(k)])]) as Snapshot['sources'];
      this.world=deriveWorld({mode:'live',sources},this.world);
    }
    return this.world;
  }
  async getSeat(tokenId:string,signal?:AbortSignal):Promise<SourceSample> {
    if(this.mode==='mock')return {state:'fresh',data:this.world?.agents.find(a=>a.tokenId===tokenId)??null,url:'mock://seat/'+tokenId,fetchedAt:Date.now()};
    const response=await this.fetcher('/api/world/seats/'+encodeURIComponent(tokenId),{signal:this.signal('seat',signal)});
    if(!response.ok)throw new Error('席位資料暫不可用');return response.json();
  }
  /** One market read per cadence tick. DEX Screener answers browsers directly (Access-Control-Allow-Origin: *) but
   *  rate-limits Cloudflare's shared egress IPs, so the viewer's own read comes first and is returned at once; the
   *  Worker's /api/world/market is only the fallback (it carries the extras too, from its cache). The quote never waits
   *  on the Worker-only extras: those are read by getExtras() when the Observatory drawer opens. Extras already known
   *  are merged into what this returns. */
  async getMarket(signal?:AbortSignal):Promise<MarketSample> {
    if(this.mode==='mock')return demoMarket();
    try {
      const r=await this.fetcher(MARKET_URL,{headers:{accept:'application/json'},signal:this.signal('market',signal)});
      if(!r.ok)throw new Error('DEX Screener HTTP '+r.status);
      this.marketSample={state:'fresh',data:selectMarket(await r.json()),url:MARKET_URL,fetchedAt:this.now()};
      return this.merged();
    }catch(error){if(signal?.aborted)throw error;}
    try {
      const r=await this.fetcher('/api/world/market',{signal:this.signal('market',signal)});
      if(!r.ok)throw new Error('Market unavailable');
      const s=await r.json() as MarketSample;
      if(!['fresh','stale','unavailable'].includes(s.state)||s.url!==MARKET_URL)throw new Error('Market schema changed');
      this.takeExtras(s.extras);
      this.marketSample={state:s.state,data:s.data,url:s.url,fetchedAt:s.fetchedAt,...(s.error?{error:s.error}:{})};
    }catch(error){
      if(signal?.aborted)throw error;
      this.marketSample={state:this.marketSample?.data?'stale':'unavailable',data:this.marketSample?.data??null,url:MARKET_URL,fetchedAt:this.marketSample?.fetchedAt??null};
    }
    return this.merged();
  }
  /** The Worker-only extras (the seat floor), read only when they are needed — the Observatory drawer opening — at most
   *  once per REFRESH_MS (a failed read may retry after EXTRAS_RETRY_MS), and never again in this session once the
   *  Worker says it has no floor source. Returns what is known (null before any read); a failed read keeps it. */
  async getExtras(signal?:AbortSignal):Promise<MarketExtras|null> {
    if(this.mode==='mock')return demoMarket().extras??null;
    const now=this.now(),prior=this.extrasAt,priorTtl=this.extrasTtl;
    if(!this.wantExtras||isFreshAge(now,this.extrasAt,this.extrasTtl))return this.extras;
    this.extrasAt=now;this.extrasTtl=REFRESH_MS;
    try {
      const r=await this.fetcher(MARKET_EXTRAS_URL,{signal:this.signal('market',signal)});
      if(!r.ok)throw new Error('Market extras unavailable');
      if(!this.takeExtras((await r.json() as {extras?:unknown}).extras))throw new Error('Market extras schema changed');
    }catch(error){
      if(signal?.aborted){this.extrasAt=prior;this.extrasTtl=priorTtl;throw error;}
      this.extrasAt=now;this.extrasTtl=EXTRAS_RETRY_MS;
    }
    return this.extras;
  }
  /** The latest market sample with the known extras merged in (null before the first market read). */
  withExtras():MarketSample|null {return this.marketSample?this.merged():null;}
  private takeExtras(value:unknown):boolean {
    const extras=extrasOf(value);if(!extras)return false;
    this.extras=extras;this.wantExtras=extras.floorEnabled;this.extrasAt=this.now();this.extrasTtl=REFRESH_MS;return true;
  }
  private merged():MarketSample {return this.extras?{...this.marketSample!,extras:this.extras}:this.marketSample!;}
}
