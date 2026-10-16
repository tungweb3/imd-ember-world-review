import type {AuthState,Session} from './auth.ts';

export const ECONOMY_TOKEN='0x2b82cdeb8477415d541799abb0cc48044c8ea5f3';
export const ECONOMY_TREASURY='0x1c651928150daddda9c2c040a9d4901d862f8ec4';
export const SHARE_WEI=100_000n*10n**18n;
export type EconomyService={id:string;titleZh:string;titleEn:string;gold?:string;embeo?:string};
export type EconomyConfig={enabled:true;chainId:1;token:string;tokenDecimals:18;stakingContract:string;paymentContract:string;treasury:string;shareTokens:'100000';shareWei:string;rule:'utc-full-day-v1';goldTransferable:false;catalogue:EconomyService[]};
export type EconomyDisabled={enabled:false;reason:string;shareTokens:'100000';rule:'utc-full-day-v1';goldTransferable:false;catalogue:[]};
export type EconomyPosition={id:string;initialShares:string;shares:string;depositedMs:number};
export type EconomyOrder={id:string;wallet?:string;serviceId:string;currency:'GOLD'|'EMBEO';amount:string;status:'pending'|'paid';createdMs:number;expiresMs:number;paidMs:number|null};
export type EconomySnapshot={address:string;gold:string;positions:EconomyPosition[];positionsTruncated:boolean;journal:{id:string;delta:string;kind:string;createdMs:number}[];orders:EconomyOrder[];chain:{block:string;throughMs:number;haltedReason:string|null};settledThroughMs:number|null};
export type EconomyPayment={chainId:1;contract:string;token:string;receiver:string;orderId:string;amount:string};
export type EconomyGoldChallenge={orderId:string;requestId:string;wallet:string;nonce:string;origin:string;message:string;issuedMs:number;expiresMs:number;amount:string;serviceId:string};
type Requester=(path:string,init?:RequestInit)=>Promise<Response>;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,HASH=/^0x[0-9a-fA-F]{64}$/;
export const economyAddress=(value:unknown):value is string=>typeof value==='string'&&ADDRESS.test(value)&&!/^0x0{40}$/i.test(value);
export const economyInteger=(value:unknown,zero=true,max=(1n<<256n)-1n):value is string=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<=max&&(zero||BigInt(value)>0n);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const ms=(n:unknown):n is number=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export class EconomyClientError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
export function economySession(state:AuthState,now=Date.now()):Session|null{
 const session=state.session;
 return state.sessionKnown&&!state.leaving&&!state.waiting&&state.phase==='idle'&&session&&economyAddress(session.address)&&Number.isSafeInteger(session.expiresAt)&&Number.isSafeInteger(now)&&now>0&&session.expiresAt>now&&(!state.account||state.account.toLowerCase()===session.address.toLowerCase())?session:null;
}
export function parseEconomyConfig(value:unknown):EconomyConfig|EconomyDisabled{
 if(!record(value)||value.shareTokens!=='100000'||value.rule!=='utc-full-day-v1'||value.goldTransferable!==false||!Array.isArray(value.catalogue))throw new EconomyClientError('INVALID_RESPONSE');
 if(value.enabled===false&&typeof value.reason==='string'&&value.catalogue.length===0)return {enabled:false,reason:value.reason,shareTokens:'100000',rule:'utc-full-day-v1',goldTransferable:false,catalogue:[]};
 if(value.enabled!==true||value.chainId!==1||value.tokenDecimals!==18||typeof value.token!=='string'||value.token.toLowerCase()!==ECONOMY_TOKEN||typeof value.treasury!=='string'||value.treasury.toLowerCase()!==ECONOMY_TREASURY||!economyAddress(value.stakingContract)||!economyAddress(value.paymentContract)||value.shareWei!==String(SHARE_WEI)||new Set([value.token,value.treasury,value.stakingContract,value.paymentContract].map(v=>String(v).toLowerCase())).size!==4||value.catalogue.length>64)throw new EconomyClientError('INVALID_RESPONSE');
 const ids=new Set<string>(),catalogue=value.catalogue.map(row=>{
  if(!record(row)||typeof row.id!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(row.id)||ids.has(row.id)||typeof row.titleZh!=='string'||typeof row.titleEn!=='string'||!row.titleZh.length||!row.titleEn.length||row.titleZh.length>160||row.titleEn.length>160||(!row.gold&&!row.embeo)||(row.gold!==undefined&&!economyInteger(row.gold,false,9_223_372_036_854_775_807n))||(row.embeo!==undefined&&!economyInteger(row.embeo,false)))throw new EconomyClientError('INVALID_RESPONSE');
  ids.add(row.id);return {id:row.id,titleZh:row.titleZh,titleEn:row.titleEn,...row.gold?{gold:row.gold as string}:{},...row.embeo?{embeo:row.embeo as string}:{}};
 });
 return {enabled:true,chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:value.stakingContract.toLowerCase(),paymentContract:value.paymentContract.toLowerCase(),treasury:ECONOMY_TREASURY,shareTokens:'100000',shareWei:String(SHARE_WEI),rule:'utc-full-day-v1',goldTransferable:false,catalogue};
}
function order(value:unknown,address:string):EconomyOrder{
 // EMBEO timestamps come from validated blocks, whose whole-second slot can
 // precede the server quote's milliseconds. GOLD debits use the server clock.
 if(!record(value)||typeof value.id!=='string'||!HASH.test(value.id)||typeof value.serviceId!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(value.serviceId)||typeof value.currency!=='string'||!['GOLD','EMBEO'].includes(value.currency)||!economyInteger(value.amount,false)||typeof value.status!=='string'||!['pending','paid'].includes(value.status)||!ms(value.createdMs)||!ms(value.expiresMs)||value.expiresMs<=value.createdMs||(value.paidMs!==null&&!ms(value.paidMs))||(value.status==='paid'&&(value.paidMs===null||value.currency==='GOLD'&&(value.paidMs as number)<value.createdMs))||(value.status==='pending'&&value.paidMs!==null)||(value.wallet!==undefined&&(!economyAddress(value.wallet)||value.wallet.toLowerCase()!==address.toLowerCase())))throw new EconomyClientError('INVALID_RESPONSE');
 return {id:value.id.toLowerCase(),...(value.wallet?{wallet:address.toLowerCase()}:{}),serviceId:value.serviceId,currency:value.currency as 'GOLD'|'EMBEO',amount:value.amount,status:value.status as 'pending'|'paid',createdMs:value.createdMs,expiresMs:value.expiresMs,paidMs:value.paidMs as number|null};
}
export function parseEconomySnapshot(value:unknown,address:string):EconomySnapshot{
 if(!record(value)||!economyAddress(value.address)||value.address.toLowerCase()!==address.toLowerCase()||!economyInteger(value.gold,true,9_223_372_036_854_775_807n)||!Array.isArray(value.positions)||value.positions.length>200||typeof value.positionsTruncated!=='boolean'||!Array.isArray(value.journal)||value.journal.length>50||!Array.isArray(value.orders)||value.orders.length>50||!record(value.chain)||!economyInteger(value.chain.block)||!ms(value.chain.throughMs)||(value.chain.haltedReason!==null&&(typeof value.chain.haltedReason!=='string'||value.chain.haltedReason.length>128))||(value.settledThroughMs!==null&&!ms(value.settledThroughMs)))throw new EconomyClientError('INVALID_RESPONSE');
 const positions=value.positions.map(p=>{if(!record(p)||!economyInteger(p.id,false)||!economyInteger(p.initialShares,false)||!economyInteger(p.shares)||BigInt(p.shares)>BigInt(p.initialShares)||!ms(p.depositedMs))throw new EconomyClientError('INVALID_RESPONSE');return {id:p.id,initialShares:p.initialShares,shares:p.shares,depositedMs:p.depositedMs};});
 const journal=value.journal.map(p=>{if(!record(p)||typeof p.id!=='string'||p.id.length>128||typeof p.delta!=='string'||! /^-?(0|[1-9][0-9]{0,18})$/.test(p.delta)||typeof p.kind!=='string'||p.kind.length>64||!ms(p.createdMs))throw new EconomyClientError('INVALID_RESPONSE');return {id:p.id,delta:p.delta,kind:p.kind,createdMs:p.createdMs};});
 return {address:address.toLowerCase(),gold:value.gold,positions,positionsTruncated:value.positionsTruncated,journal,orders:value.orders.map(o=>order(o,address)),chain:{block:value.chain.block,throughMs:value.chain.throughMs,haltedReason:value.chain.haltedReason as string|null},settledThroughMs:value.settledThroughMs as number|null};
}
export function economyGoldMessage(challenge:Omit<EconomyGoldChallenge,'message'>){
 const c=challenge;return `IMD Ember World GOLD payment\n\nAuthorize one World service payment using nontransferable GOLD.\nThis signature does not authorize EMBEO, token allowances, or blockchain transfers.\n\nOrigin: ${c.origin}\nWallet: ${c.wallet}\nOrder: ${c.orderId}\nService: ${c.serviceId}\nAmount: ${c.amount} GOLD\nRequest: ${c.requestId}\nNonce: ${c.nonce}\nIssued at: ${new Date(c.issuedMs).toISOString()}\nExpires at: ${new Date(c.expiresMs).toISOString()}`;
}
export function validateGoldChallenge(value:unknown,selected:EconomyOrder,requestId:string,session:Session,origin:string,now:number):EconomyGoldChallenge{
 let validOrigin=false;try{const url=new URL(origin);validOrigin=url.origin===origin&&(origin==='https://imdember.com'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname));}catch{/* fail closed */}
 if(!validOrigin||!record(value)||!exact(value,['orderId','requestId','wallet','nonce','origin','message','issuedMs','expiresMs','amount','serviceId'])||selected.currency!=='GOLD'||selected.status!=='pending'||value.orderId!==selected.id||value.requestId!==requestId||! /^[A-Za-z0-9_-]{16,80}$/.test(requestId)||value.wallet!==session.address.toLowerCase()||value.origin!==origin||value.amount!==selected.amount||value.serviceId!==selected.serviceId||typeof value.nonce!=='string'||!/^0x[0-9a-f]{64}$/.test(value.nonce)||!ms(value.issuedMs)||!ms(value.expiresMs)||!ms(now)||session.expiresAt<=now||value.issuedMs>now+30_000||value.issuedMs<now-300_000||value.expiresMs<=now||value.expiresMs<=value.issuedMs||value.expiresMs>value.issuedMs+300_000||value.expiresMs>selected.expiresMs||typeof value.message!=='string')throw new EconomyClientError('INVALID_GOLD_CHALLENGE');
 const c=value as EconomyGoldChallenge;if(c.message!==economyGoldMessage(c))throw new EconomyClientError('INVALID_GOLD_CHALLENGE');return {...c};
}
export function economyRequestId(){return crypto.randomUUID().replaceAll('-','');}
export function economyTokenAmount(value:string){const n=BigInt(value),whole=n/10n**18n,fraction=(n%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return whole.toString()+(fraction?'.'+fraction:'');}
export class EconomyClient{
 private deps:{fetch?:Requester;auth:()=>AuthState;now?:()=>number;canSpend?:()=>boolean};
 constructor(deps:{fetch?:Requester;auth:()=>AuthState;now?:()=>number;canSpend?:()=>boolean}){this.deps=deps;}
 private now(){return (this.deps.now??Date.now)();}
 private current(){const s=economySession(this.deps.auth(),this.now());if(!s)throw new EconomyClientError('AUTH_REQUIRED');return s;}
 private guard(session:Session,started:number,signal?:AbortSignal){if(signal?.aborted||this.now()<started||economySession(this.deps.auth(),this.now())!==session)throw new EconomyClientError('CONTEXT_CHANGED');}
 private async json(path:string,init:RequestInit,guard:()=>void){
  guard();const r=await (this.deps.fetch??fetch)(path,{...init,credentials:'same-origin',cache:'no-store',redirect:'error'});guard();
  const value:unknown=await r.json();guard();
  if(r.status!==200)throw new EconomyClientError(record(value)&&typeof value.error==='string'?value.error:'UNAVAILABLE');return value;
 }
 async config(signal?:AbortSignal){const value=await this.json('/api/economy/config',{method:'GET',signal},()=>{if(signal?.aborted)throw new EconomyClientError('CONTEXT_CHANGED');});return parseEconomyConfig(value);}
 async snapshot(signal?:AbortSignal){const session=this.current(),started=this.now();return parseEconomySnapshot(await this.json('/api/me/economy?'+new URLSearchParams({expected_address:session.address}),{method:'GET',signal},()=>this.guard(session,started,signal)),session.address);}
 async verifySession(session:Session,signal?:AbortSignal){
  const started=this.now(),value=await this.json('/api/auth/session',{method:'GET',signal},()=>this.guard(session,started,signal));
  if(!record(value)||value.signedIn!==true||!economyAddress(value.address)||value.address.toLowerCase()!==session.address.toLowerCase()||value.expiresAt!==session.expiresAt)throw new EconomyClientError('AUTH_REQUIRED');
 }
 async createOrder(config:EconomyConfig,serviceId:string,currency:'EMBEO'|'GOLD',requestId:string,signal?:AbortSignal){
  const session=this.current(),started=this.now(),price=config.catalogue.find(s=>s.id===serviceId)?.[currency==='GOLD'?'gold':'embeo'];
  if(!price||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))throw new EconomyClientError('SERVICE_UNAVAILABLE');
  await this.verifySession(session,signal);this.guard(session,started,signal);
  const value=await this.json('/api/economy/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAddress:session.address,requestId,serviceId,currency}),signal},()=>this.guard(session,started,signal));
  if(!record(value))throw new EconomyClientError('INVALID_RESPONSE');const parsed=order(value.order,session.address);
  if(parsed.wallet!==session.address.toLowerCase()||parsed.serviceId!==serviceId||parsed.currency!==currency||parsed.amount!==price)throw new EconomyClientError('INVALID_RESPONSE');
  if(currency==='GOLD')return {order:parsed};
  const p=value.payment;
  if(!record(p)||!exact(p,['chainId','contract','token','receiver','orderId','amount'])||p.chainId!==config.chainId||String(p.contract).toLowerCase()!==config.paymentContract||String(p.token).toLowerCase()!==config.token||String(p.receiver).toLowerCase()!==config.treasury||p.orderId!==parsed.id||p.amount!==parsed.amount)throw new EconomyClientError('INVALID_RESPONSE');
  return {order:parsed,payment:{chainId:1,contract:config.paymentContract,token:config.token,receiver:config.treasury,orderId:parsed.id,amount:parsed.amount} as EconomyPayment};
 }
 async goldChallenge(selected:EconomyOrder,requestId:string,origin:string,signal?:AbortSignal){
  const session=this.current(),started=this.now();await this.verifySession(session,signal);this.guard(session,started,signal);
  const value=await this.json('/api/economy/orders/'+selected.id+'/gold/challenge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAddress:session.address,requestId}),signal},()=>this.guard(session,started,signal));
  if(!record(value)||!exact(value,['challenge']))throw new EconomyClientError('INVALID_RESPONSE');return validateGoldChallenge(value.challenge,selected,requestId,session,origin,this.now());
 }
 async payGold(selected:EconomyOrder,requestId:string,signature:string,signal?:AbortSignal){
  const session=this.current(),started=this.now();if(selected.currency!=='GOLD'||(selected.wallet&&selected.wallet!==session.address.toLowerCase())||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))throw new EconomyClientError('INVALID_ORDER');
  await this.verifySession(session,signal);this.guard(session,started,signal);
  if(!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new EconomyClientError('INVALID_SIGNATURE');
  // A halt observed while session verification awaited must stop the debit
  // before POST. A later halt must not hide an already completed payment.
  if(this.deps.canSpend&&!this.deps.canSpend())throw new EconomyClientError('ECONOMY_HALTED');
  const value=await this.json('/api/economy/orders/'+selected.id+'/gold',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAddress:session.address,requestId,signature}),signal},()=>this.guard(session,started,signal));
  if(!record(value))throw new EconomyClientError('INVALID_RESPONSE');const paid=order(value.order,session.address);
  if(paid.id!==selected.id||paid.amount!==selected.amount||paid.serviceId!==selected.serviceId||paid.currency!=='GOLD'||paid.status!=='paid')throw new EconomyClientError('INVALID_RESPONSE');return paid;
 }
}
