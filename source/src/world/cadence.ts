// How often the world re-reads IMD's public data. Owner decision (2026-09-27): the world does not need to be live to
// the second — one read every 15 minutes is enough — but a failed first read must not leave the page "awaiting data"
// for a whole cycle, so failures retry on a short, growing schedule until a read succeeds.

/** Wait after a good read. */
export const REFRESH_MS=15*60_000;
/** Waits after the 1st, 2nd and 3rd+ consecutive failed (or empty) reads. */
export const RETRY_MS=[30_000,60_000,120_000] as const;
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

export function nextDelay(ok:boolean,failures:number){return ok?REFRESH_MS:RETRY_MS[Math.min(Math.max(failures,1),RETRY_MS.length)-1];}

export type PollEnv={set:(fn:()=>void,ms:number)=>unknown;clear:(t:unknown)=>void;hidden:()=>boolean;now:()=>number;
  onVisible:(fn:()=>void)=>()=>void};
export const browserEnv=():PollEnv=>({set:(fn,ms)=>setTimeout(fn,ms),clear:t=>clearTimeout(t as ReturnType<typeof setTimeout>),hidden:()=>document.hidden,now:()=>Date.now(),
  onVisible:fn=>{const h=()=>{if(!document.hidden)fn();};document.addEventListener('visibilitychange',h);return()=>document.removeEventListener('visibilitychange',h);}});

/** Run `read` now (always, even in a background tab: a page must never open empty), then again REFRESH_MS after each
 *  success or on the RETRY_MS schedule after each failure (`read` resolving false or throwing). Later reads never run
 *  while the tab is hidden: one that comes due waits and runs as soon as the tab is visible. `poke()` reads now. */
export function startPoll(read:()=>Promise<boolean>,env:PollEnv=browserEnv()){
  let timer:unknown=null,failures=0,stopped=false,inflight=false,due=false;
  const schedule=(ms:number)=>{env.clear(timer);timer=env.set(()=>{void tick();},ms);};
  async function tick(force=false){
    if(stopped||inflight)return;
    if(!force&&env.hidden()){due=true;return;}
    due=false;inflight=true;let ok=false;
    try{ok=await read();}catch{ok=false;}finally{inflight=false;}
    if(stopped)return;
    failures=ok?0:failures+1;schedule(nextDelay(ok,failures));
  }
  const unlisten=env.onVisible(()=>{if(due)void tick();});
  void tick(true);
  return {poke:()=>{void tick(true);},stop:()=>{stopped=true;env.clear(timer);unlisten();},get failures(){return failures;}};
}
