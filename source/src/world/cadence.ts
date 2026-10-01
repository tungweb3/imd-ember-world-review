// How often the world re-reads IMD's public data. Owner decision (2026-09-27): the world does not need to be live to
// the second — one read every 15 minutes is enough — but a failed first read must not leave the page "awaiting data"
// for a whole cycle, so failures retry on a short, growing schedule until a read succeeds.
import type {SourceSample} from './model.ts';

/** Wait after a good read. */
export const REFRESH_MS=15*60_000;
/** Waits after the 1st, 2nd and 3rd+ consecutive failed (or empty) reads. */
export const RETRY_MS=[30_000,60_000,120_000] as const;
/** The world read's waits after its 1st and 2nd failed (or empty) reads while this page load has had no good read yet;
 *  RETRY_MS follows from its start (5 s, 15 s, 30 s, 60 s, 2 min…). Owner, 2026-09-30: a first read that failed, or ran
 *  out its 18 s, left the town without its homes for a minute, the next try 30 s away. The 5 s retry is for a failure
 *  between the page and the Worker (the 18 s timeout, a network error, the edge's 429, a busy Worker); when IMD itself
 *  failed, the isolate that asked holds that failure 10 s (server/gateway.ts load) and answers a 5 s retry that reaches
 *  it with the same failure, so the 15 s one is the first sure to ask IMD again. One read at a time as ever (a retry is
 *  set only once the read before it has ended), so this adds at most one /api/ request per 5 s, far inside the edge's
 *  20 per 10 s; the second comes 20 s after the first failure, past that rule's 10 s block. */
export const FIRST_RETRY_MS=[5_000,15_000] as const;
/** A sample still counts as current for one cycle plus a grace period for a slow or retried read. */
export const FRESH_MS=REFRESH_MS+5*60_000;
/** Server-side cache for every upstream IMD / DEX Screener read (gateway TTL and the Worker's edge cache). */
export const UPSTREAM_TTL_MS=5*60_000;
/** The seat NFT floor (Alchemy, Worker-only, needs the ALCHEMY_API_KEY secret) changes slowly: cache it for 10 min, and
 *  after a failed read wait at least 5 min before asking Alchemy again. */
export const FLOOR_TTL_MS=10*60_000;
export const FLOOR_RETRY_MS=5*60_000;
/** After Alchemy refuses the key (401/403), wait an hour before asking again. */
export const FLOOR_REFUSED_RETRY_MS=60*60_000;

/** The error the gateway (server/gateway.ts) gives a source it answered without waiting any longer for api.imd.fun: a
 *  cold server with nothing to show yet, whose read goes on in the background (and fills its location's shared copy). */
export const UPSTREAM_SLOW='IMD upstream slow';
/** After such an answer the next retry comes this soon instead of at RETRY_MS, for the first SOON_RETRIES such answers
 *  until a read succeeds: the gateway's read goes on (up to its 10 s upstream timeout), and the retry joins it or finds
 *  its result. These quick retries are not failures: the first real failure after them still waits RETRY_MS[0]. */
export const SOON_RETRY_MS=4_000;
export const SOON_RETRIES=2;
/** A sample the gateway answered without its data, whose upstream read is still going on (a cold server): the page
 *  shows it as loading, not as unavailable. */
export function stillReading(sample:SourceSample|null|undefined):boolean{return sample?.state==='unavailable'&&sample.error===UPSTREAM_SLOW;}
/** A sample the page shows as loading, not as unavailable: one still being read upstream, or one with nothing yet while
 *  the page's first load is on (startPoll's firstLoad: the first read and its quick retries). */
export function showLoading(sample:SourceSample|null|undefined,firstLoad:boolean):boolean{
  return stillReading(sample)||firstLoad&&(!sample||sample.state==='unavailable');
}
/** A good read of data older than the gateway's TTL (plus a minute for the edge cache's Age): the gateway answered what
 *  it held at once and is refreshing it in the background (server/gateway.ts, stale-while-revalidate). One more read
 *  this soon picks the refresh up, instead of a whole cycle later; at most one per cycle, so a client clock that is off
 *  costs at most one extra read per REFRESH_MS. */
export const FOLLOW_UP_MS=15_000;
export const BEHIND_MS=UPSTREAM_TTL_MS+60_000;
/** What a poll's read reports: true a good read, false a failed one, 'soon' a failed one worth asking again shortly,
 *  'behind' a good one worth asking again shortly (FOLLOW_UP_MS). */
export type ReadResult=boolean|'soon'|'behind';
/** The world read's result: good when swarm and workers are fresh ('behind' when either is older than BEHIND_MS by
 *  this clock); 'soon' when either is still being read upstream. */
export function worldReadResult(sources:{swarm:SourceSample;workers:SourceSample},now:number=Date.now()):ReadResult{
  const core=[sources.swarm,sources.workers];
  if(core.every(s=>s.state==='fresh'))return core.some(s=>s.fetchedAt!==null&&now-s.fetchedAt>BEHIND_MS)?'behind':true;
  return core.some(stillReading)?'soon':false;
}
/** The wait after a read: REFRESH_MS after a good one; after the nth failure in a row `first[n-1]` while there is one,
 *  then RETRY_MS from its start. */
export function nextDelay(ok:boolean,failures:number,first:readonly number[]=[]){
  if(ok)return REFRESH_MS;
  const n=Math.max(failures,1);
  return n<=first.length?first[n-1]:RETRY_MS[Math.min(n-first.length,RETRY_MS.length)-1];
}
/** A poll's first load (the world read): until its first good read, failures wait `retryMs` first (FIRST_RETRY_MS);
 *  `over` is told once when the first load ends: at the first good read, or at the failure after the last of them. */
export type FirstLoad={retryMs:readonly number[];over?:()=>void};

export type PollEnv={set:(fn:()=>void,ms:number)=>unknown;clear:(t:unknown)=>void;hidden:()=>boolean;now:()=>number;
  onVisible:(fn:()=>void)=>()=>void};
export const browserEnv=():PollEnv=>({set:(fn,ms)=>setTimeout(fn,ms),clear:t=>clearTimeout(t as ReturnType<typeof setTimeout>),hidden:()=>document.hidden,now:()=>Date.now(),
  onVisible:fn=>{const h=()=>{if(!document.hidden)fn();};document.addEventListener('visibilitychange',h);return()=>document.removeEventListener('visibilitychange',h);}});

/** Run `read` now (always, even in a background tab: a page must never open empty), then again REFRESH_MS after each
 *  success or on the RETRY_MS schedule after each failure (`read` resolving false or throwing). The first SOON_RETRIES
 *  'soon' results until a success are retried after SOON_RETRY_MS instead, without counting as failures (later ones
 *  do); a 'behind' result is a success followed by one read after FOLLOW_UP_MS (not after a follow-up itself). Later
 *  reads never run while the tab is hidden: one that comes due waits and runs as soon as the tab is visible. `poke()`
 *  reads now. With `first` (FirstLoad), failures before the first good read wait its retryMs first. */
export function startPoll(read:()=>Promise<ReadResult>,env:PollEnv=browserEnv(),first?:FirstLoad){
  let timer:unknown=null,failures=0,soons=0,followUp=false,stopped=false,inflight=false,due=false,everGood=false,firstLoad=true;
  const schedule=(ms:number)=>{env.clear(timer);timer=env.set(()=>{void tick();},ms);};
  async function tick(force=false){
    if(stopped||inflight)return;
    if(!force&&env.hidden()){due=true;return;}
    due=false;inflight=true;let result:ReadResult=false;
    try{result=await read();}catch{result=false;}finally{inflight=false;}
    if(stopped)return;
    const good=result===true||result==='behind',quick=result==='soon'&&soons<SOON_RETRIES,wasFollowUp=followUp;
    if(good){failures=0;soons=0;}else if(quick)soons++;else failures++;
    const fast=everGood?[]:first?.retryMs??[];everGood||=good;
    followUp=result==='behind'&&!wasFollowUp;
    schedule(followUp?FOLLOW_UP_MS:quick?SOON_RETRY_MS:nextDelay(good,failures,fast));
    if(firstLoad&&(good||failures>fast.length)){firstLoad=false;first?.over?.();}
  }
  const unlisten=env.onVisible(()=>{if(due)void tick();});
  void tick(true);
  return {poke:()=>{void tick(true);},stop:()=>{stopped=true;env.clear(timer);unlisten();},get failures(){return failures;},get firstLoad(){return firstLoad;}};
}
/** The world read's poll (WorldApp.tsx): its first load waits FIRST_RETRY_MS after a failure; `firstLoad` hears true
 *  now and false once that first load ends (what the page shows as loading, SourceNotes.tsx). */
export function startWorldPoll(read:()=>Promise<ReadResult>,firstLoad:(on:boolean)=>void,env:PollEnv=browserEnv()){
  firstLoad(true);
  return startPoll(read,env,{retryMs:FIRST_RETRY_MS,over:()=>firstLoad(false)});
}
