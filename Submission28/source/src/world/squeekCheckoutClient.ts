import {squeekBySku,SQUEEK_REQUEST_KEY,type SqueekItem} from '../shared/squeekCatalog.ts';
import {economySession,sameSession,EconomyClientError,type EconomyOrder} from './economyClient.ts';
import type {AuthState} from './auth.ts';

export type SqueekOrder={orderId:string;requestKey:string|null;subjectId:string;sku:string;status:'pending'|'expired'|'paid'|'refund_pending'|'refunded';amountGold:string;createdAt:number;expiresAt:number;paidAt:number|null};
export type SqueekCheckoutState={wallet:string;item:SqueekItem;owned:boolean;balanceGold:string;order:SqueekOrder|null;ready:boolean};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ms=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
/** Every field is checked against the built-in catalogue: the page never shows a price the server did not send for this item. */
export function parseSqueekCheckout(v:unknown,sku:string,requestKey:string,wallet:string):SqueekCheckoutState{
 const bad=()=>{throw new EconomyClientError('INVALID_RESPONSE');};
 const it=squeekBySku(sku);if(!it)return bad();
 if(!object(v)||v.wallet!==wallet.toLowerCase()||!object(v.item)||typeof v.owned!=='boolean'||typeof v.ready!=='boolean'||typeof v.balanceGold!=='string'||!/^(0|[1-9][0-9]{0,77})$/.test(v.balanceGold))return bad();
 const i=v.item;if(i.sku!==it.sku||i.amountGold!==it.gold||i.kind!==it.kind||i.nameZh!==it.nameZh||i.nameEn!==it.nameEn)return bad();
 if(v.order!==null){const o=v.order;
  if(!object(o)||typeof o.orderId!=='string'||!/^0x[0-9a-f]{64}$/.test(o.orderId)||o.requestKey!==requestKey||o.sku!==it.sku||o.amountGold!==it.gold||!['pending','expired','paid','refund_pending','refunded'].includes(String(o.status))||!ms(o.createdAt)||!ms(o.expiresAt)||o.expiresAt<=o.createdAt||o.paidAt!==null&&!ms(o.paidAt)||typeof o.subjectId!=='string')return bad();
 }
 return {wallet:v.wallet,item:it,owned:v.owned,balanceGold:v.balanceGold,order:v.order as SqueekOrder|null,ready:v.ready};
}
/** The shape the shared wallet payment controller signs: one pending World GOLD order. */
export function squeekEconomyOrder(o:SqueekOrder,it:SqueekItem):EconomyOrder{
 return {id:o.orderId,serviceId:it.product,currency:'GOLD',amount:o.amountGold,status:o.status==='pending'?'pending':'paid',createdMs:o.createdAt,expiresMs:o.expiresAt,paidMs:o.paidAt};
}
export class SqueekCheckoutClient{
 private deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number};
 constructor(deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number}){this.deps=deps;}
 async request(sku:string,requestKey:string,quote=false,signal?:AbortSignal):Promise<SqueekCheckoutState>{
  if(!squeekBySku(sku)||!SQUEEK_REQUEST_KEY.test(requestKey))throw new EconomyClientError('INVALID_REQUEST');
  const now=this.deps.now??Date.now,session=economySession(this.deps.auth(),now()),started=now();if(!session)throw new EconomyClientError('AUTH_REQUIRED');
  const guard=()=>{if(signal?.aborted||now()<started||!sameSession(economySession(this.deps.auth(),now()),session))throw new EconomyClientError('CONTEXT_CHANGED');};
  guard();const value={sku,requestKey,expectedAddress:session.address.toLowerCase()},path='/api/squeek/checkout/'+(quote?'quote':'state');
  const response=await (this.deps.fetch??fetch)(path+(quote?'':'?'+new URLSearchParams(value)),{method:quote?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal,...quote?{headers:{'content-type':'application/json'},body:JSON.stringify(value)}:{}});
  guard();const data:unknown=await response.json();guard();
  if(!response.ok)throw new EconomyClientError(object(data)&&typeof data.error==='string'?data.error:'UNAVAILABLE');
  return parseSqueekCheckout(data,sku,requestKey,session.address);
 }
 state(sku:string,requestKey:string,signal?:AbortSignal){return this.request(sku,requestKey,false,signal);}
 quote(sku:string,requestKey:string,signal?:AbortSignal){return this.request(sku,requestKey,true,signal);}
}
