import type {FastCreditReply} from './worldGoldClient.ts';
import {EconomyClientError} from './economyClient.ts';

/** GOLD fast credit (server/world-gold-fast.ts). Once the wallet returns the payment hash, the server is asked to
 *  verify the mined receipt and credit the top-up, about 12 s after payment (one Ethereum block). The follower lives
 *  outside the GOLD panel, so the player can go back to the World while the top bar shows "crediting". A refusal, an
 *  outage or the end of the schedule falls back to the finalized path, which still credits the order. */
export const FAST_CREDIT_SCHEDULE_MS=[1_500,3_000,5_000,7_000,10_000,13_000,17_000,22_000,28_000,35_000,45_000,60_000,90_000] as const;
export type FastFollow={orderId:string;gold:string;transactionHash:string;status:'crediting'|'credited'|'fallback';code?:string};
export type FastFollowDeps={fastCredit:(orderId:string,transactionHash:string)=>Promise<FastCreditReply>;
  set?:(fn:()=>void,ms:number)=>unknown;emit?:(name:string,detail?:unknown)=>void};
/** Transient: try again at the next step of the schedule. Anything else ends fast credit for this order. */
const RETRY=new Set(['RATE_LIMITED','CHAIN_UNAVAILABLE','UNAVAILABLE','GOLD_UNAVAILABLE']);
const follows=new Map<string,FastFollow>(),listeners=new Set<()=>void>();
const defaultEmit=(name:string,detail?:unknown)=>{if(typeof window!=='undefined')window.dispatchEvent(detail===undefined?new Event(name):new CustomEvent(name,{detail}));};
export function fastFollow(orderId:string|null|undefined){return orderId?follows.get(orderId)??null:null;}
export function subscribeFastFollow(fn:()=>void){listeners.add(fn);return()=>{listeners.delete(fn);};}
/** The GOLD still being credited across all followed orders (the top bar's "+N crediting"). */
export function fastCrediting(){let n=0n;for(const f of follows.values())if(f.status==='crediting')n+=BigInt(f.gold);return n;}
export function resetFastFollows(){follows.clear();for(const fn of listeners)fn();}
/** Start following one order's payment. A repeat call is ignored while it is crediting or credited; after a fallback
 *  (the "check original credit" button) it starts the schedule again. */
export function followFastCredit(deps:FastFollowDeps,orderId:string,transactionHash:string,gold:string){
  const prior=follows.get(orderId);if(prior&&prior.status!=='fallback'||!/^[1-9][0-9]*$/.test(gold))return;
  const set=deps.set??((fn,ms)=>setTimeout(fn,ms)),emit=deps.emit??defaultEmit;
  const update=(next:FastFollow)=>{follows.set(orderId,next);emit('world:gold-crediting',{gold:String(fastCrediting())});for(const fn of listeners)fn();};
  update({orderId,gold,transactionHash,status:'crediting'});
  let step=0,elapsed=0,last:string|undefined;
  const end=(status:'credited'|'fallback',code?:string)=>{update({orderId,gold,transactionHash,status,...code?{code}:{}});if(status==='credited')emit('world:gold-changed');};
  const attempt=async()=>{
    if(follows.get(orderId)?.status!=='crediting')return;
    try{
      const r=await deps.fastCredit(orderId,transactionHash);
      if(r.status==='credited'||r.status==='paid')return end('credited');
      if(r.status==='reverted')return end('fallback','REVERTED');
      last='WAITING';
    }catch(e){const code=e instanceof EconomyClientError?e.code:'UNAVAILABLE';if(!RETRY.has(code))return end('fallback',code);last=code;}
    // The last transient answer says why the schedule ran out (still not mined, rate limited, chain unavailable).
    if(step>=FAST_CREDIT_SCHEDULE_MS.length)return end('fallback','TIMEOUT_'+last);
    const at=FAST_CREDIT_SCHEDULE_MS[step++];set(()=>void attempt(),at-elapsed);elapsed=at;
  };
  const first=FAST_CREDIT_SCHEDULE_MS[step++];elapsed=first;set(()=>void attempt(),first);
}
