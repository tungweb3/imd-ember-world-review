import type {AuthState} from './auth.ts';
import {EconomyClientError,economySession,economyInteger,sameSession} from './economyClient.ts';
type Missing={status:'unavailable'|'not-configured'|'indexing'};
type TokenBalance=Missing|{status:'ok';atomic:string;block:string;throughMs?:number};
export type MemberBalances={wallet:string;asOf:number;embeo:TokenBalance;staked:TokenBalance;gold:Missing|{status:'ok';available:string;book:string;reserved:string}};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const time=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
export function parseMemberBalances(value:unknown,wallet:string):MemberBalances{
 if(!record(value)||typeof value.wallet!=='string'||value.wallet!==wallet.toLowerCase()||!time(value.asOf))throw new EconomyClientError('INVALID_RESPONSE');
 const missing=(v:Record<string,unknown>)=>['unavailable','not-configured','indexing'].includes(String(v.status))&&Object.keys(v).length===1;
 for(const field of ['embeo','staked']){const v=value[field];if(!record(v)||!missing(v)&&(v.status!=='ok'||!economyInteger(v.atomic)||!economyInteger(v.block,false)||v.throughMs!==undefined&&!time(v.throughMs)))throw new EconomyClientError('INVALID_RESPONSE');}
 const g=value.gold;if(!record(g)||!missing(g)&&(g.status!=='ok'||!economyInteger(g.available)||!economyInteger(g.book)||!economyInteger(g.reserved)||BigInt(g.book)!==BigInt(g.available)+BigInt(g.reserved)))throw new EconomyClientError('INVALID_RESPONSE');
 return value as MemberBalances;
}
export class MemberBalancesClient{
 private deps:{auth:()=>AuthState;now?:()=>number;fetch?:typeof fetch};
 constructor(deps:{auth:()=>AuthState;now?:()=>number;fetch?:typeof fetch}){this.deps=deps;}
 async read(signal?:AbortSignal){
  const now=this.deps.now??Date.now,started=now(),session=economySession(this.deps.auth(),started);if(!session)throw new EconomyClientError('AUTH_REQUIRED');
  const guard=()=>{if(signal?.aborted||now()<started||!sameSession(economySession(this.deps.auth(),now()),session))throw new EconomyClientError('CONTEXT_CHANGED');};
  const r=await (this.deps.fetch??fetch)('/api/me/balances?'+new URLSearchParams({expected_address:session.address}),{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});guard();
  const value:unknown=await r.json();guard();if(r.status!==200)throw new EconomyClientError('BALANCE_UNAVAILABLE');return parseMemberBalances(value,session.address);
 }
}
