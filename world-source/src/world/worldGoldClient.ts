import {economySession,economyRequestId,EconomyClientError} from './economyClient.ts';
import type {AuthState} from './auth.ts';
export function goldPriceInputAtomic(value:string):string|null{
 if(!/^(0|[1-9][0-9]{0,77})(?:\.[0-9]{1,18})?$/.test(value))return null;
 const [whole,fraction='']=value.split('.'),amount=BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
 return amount>0n&&amount<2n**256n?String(amount):null;
}
export type GoldOrder={id:string;product:string;currency:'GOLD'|'EMBEO';amount:string;status:'pending'|'paid';created_ms:number;expires_ms:number;kind:'topup'|'service';gold:string;delivery:string|null;result:string|null};
export type GoldState={wallet:string;book:string;reserved:string;available:string;asOf:number;isAdmin:boolean;products:{id:string;product:string;version:number;kind:'topup'|'service';title:string;gold:string;embeo:string|null;enabled:number}[];orders:GoldOrder[];history:{id:string;delta:string;kind:string;created_ms:number}[];campaign:{version:number;startsMs:number|null;endsMs:number|null;stopped:number;active:boolean;asOf:number};controls:{feature:string;enabled:number;version:number}[]};
export function parseWorldGold(value:unknown,address:string):GoldState{
 const v=value as GoldState;const uint=(s:unknown)=>typeof s==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(s);
 if(!v||v.wallet!==address.toLowerCase()||!uint(v.book)||!uint(v.available)||!uint(v.reserved)||BigInt(v.book)!==BigInt(v.available)+BigInt(v.reserved)||!Number.isSafeInteger(v.asOf)||v.asOf<=0||!Array.isArray(v.products)||!Array.isArray(v.orders)||!Array.isArray(v.history)||typeof v.isAdmin!=='boolean'||!v.campaign||!Array.isArray(v.controls))throw new EconomyClientError('INVALID_RESPONSE');
 return v;
}
export class WorldGoldClient{
 private deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number};
 constructor(deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number}){this.deps=deps;}
 private context(){const s=economySession(this.deps.auth(),(this.deps.now??Date.now)());if(!s)throw new EconomyClientError('AUTH_REQUIRED');return s;}
 async request(path:string,value?:Record<string,unknown>,signal?:AbortSignal){
  const session=this.context(),expected=session.address.toLowerCase(),started=(this.deps.now??Date.now)();
  const r=await (this.deps.fetch??fetch)(path+(value?'':(path.includes('?')?'&':'?')+'expected_address='+expected),{method:value?'POST':'GET',cache:'no-store',credentials:'same-origin',signal,...value?{headers:{'content-type':'application/json'},body:JSON.stringify({...value,expectedAddress:expected})}:{}});
  const data=await r.json();if(signal?.aborted||this.context()!==session||(this.deps.now??Date.now)()<started)throw new EconomyClientError('CONTEXT_CHANGED');
  if(!r.ok)throw new EconomyClientError(typeof data.error==='string'?data.error:'UNAVAILABLE');return data;
 }
 async state(signal?:AbortSignal){const session=this.context();return parseWorldGold(await this.request('/api/gold/state',undefined,signal),session.address);}
 quote(product:string,requestId=economyRequestId(),signal?:AbortSignal){return this.request('/api/gold/quote',{product,requestId},signal) as Promise<{orderId:string}>;}
 admin(command:Record<string,unknown>,reason:string,requestId=economyRequestId(),signal?:AbortSignal){return this.request('/api/gold/admin',{command,reason,requestId},signal);}
 reconcile(id:string,signal?:AbortSignal){if(!/^0x[0-9a-f]{64}$/.test(id))throw new EconomyClientError('INVALID_RESPONSE');return this.request('/api/gold/orders/'+id+'/reconcile',{},signal);}
}
