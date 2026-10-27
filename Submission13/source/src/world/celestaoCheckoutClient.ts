import {fortuneProduct,type FortuneProduct} from '../shared/fortunePricing.ts';
import {economySession,sameSession,EconomyClientError,type EconomyOrder} from './economyClient.ts';
import type {AuthState} from './auth.ts';
export type CelestaoCheckoutState={wallet:string;runId:string;product:FortuneProduct;expiresMs:number;ready:boolean;order:(EconomyOrder&{delivery:string|null;result:string|null;failure:string|null})|null};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ms=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
export function parseCelestaoCheckout(v:unknown,runId:string,wallet:string):CelestaoCheckoutState{
 const bad=()=>{throw new EconomyClientError('INVALID_RESPONSE');};
 if(!object(v)||v.wallet!==wallet.toLowerCase()||v.runId!==runId||!object(v.product)||typeof v.ready!=='boolean'||!ms(v.expiresMs))return bad();
 const supplied=v.product,p=fortuneProduct(supplied.product);if(!p||Object.entries(p).some(([k,x])=>supplied[k]!==x))return bad();
 if(v.order!==null){const o=v.order;
  if(!object(o)||typeof o.id!=='string'||!/^0x[0-9a-f]{64}$/.test(o.id)||o.serviceId!==p.product||o.amount!==p.gold||o.currency!=='GOLD'||!['pending','paid'].includes(String(o.status))||!ms(o.createdMs)||!ms(o.expiresMs)||o.expiresMs<=o.createdMs||o.paidMs!==null&&!ms(o.paidMs)||o.delivery!==null&&!['queued','working','delivered','failed','refunded'].includes(String(o.delivery))||o.result!==null&&typeof o.result!=='string'||o.failure!==null&&typeof o.failure!=='string')return bad();
 }
 return {...v,product:p} as CelestaoCheckoutState;
}
export class CelestaoCheckoutClient{
 private deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number};
 constructor(deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number}){this.deps=deps;}
 async request(runId:string,quote=false,signal?:AbortSignal){
  if(!/^[A-Za-z0-9_-]{43}$/.test(runId))throw new EconomyClientError('INVALID_REQUEST');
  const now=this.deps.now??Date.now,session=economySession(this.deps.auth(),now()),started=now();if(!session)throw new EconomyClientError('AUTH_REQUIRED');
  const guard=()=>{if(signal?.aborted||now()<started||!sameSession(economySession(this.deps.auth(),now()),session))throw new EconomyClientError('CONTEXT_CHANGED');};
  guard();const value={runId,expectedAddress:session.address.toLowerCase()},path='/api/celestao-checkout/'+(quote?'quote':'state');
  const response=await (this.deps.fetch??fetch)(path+(quote?'':'?'+new URLSearchParams(value)),{method:quote?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,...quote?{headers:{'content-type':'application/json'},body:JSON.stringify(value)}:{}});
  guard();const data:unknown=await response.json();guard();
  if(!response.ok)throw new EconomyClientError(object(data)&&typeof data.error==='string'?data.error:'UNAVAILABLE');
  if(quote){if(!object(data)||typeof data.orderId!=='string'||!/^0x[0-9a-f]{64}$/.test(data.orderId))throw new EconomyClientError('INVALID_RESPONSE');return data.orderId;}
  return parseCelestaoCheckout(data,runId,session.address);
 }
 async state(runId:string,signal?:AbortSignal){return await this.request(runId,false,signal) as CelestaoCheckoutState;}
 async quote(runId:string,signal?:AbortSignal){return await this.request(runId,true,signal) as string;}
}
