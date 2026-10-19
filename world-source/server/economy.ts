import {economySessionClock,readEconomySession,revalidateEconomySession} from './economy-session.ts';
import type {D1Database} from './d1.ts';
import {API_HEADERS} from './world-api.ts';
import {ECONOMY_ADDRESS,ECONOMY_HASH,publicEconomyConfig,type EconomyConfig} from './economy-config.ts';
import {EconomyConflict,createEconomyOrder,createEconomyGoldChallenge,economyWalletSnapshot,payEconomyOrderGold} from './economy-ledger.ts';

export type EconomyDeps={db?:D1Database;config?:EconomyConfig|null;now?:()=>number;client?:string;allow?:(key:string)=>boolean|Promise<boolean>;serviceReady?:boolean;serviceProducts?:readonly string[]};
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
const reply=(status:number,value:unknown,extra:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{...API_HEADERS,...extra}});
const error=(status:number,code:string,extra?:Record<string,string>)=>reply(status,{error:code},extra);
const validClock=(n:number)=>Number.isSafeInteger(n)&&n>0;
async function body(request:Request):Promise<Record<string,unknown>>{
  if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new EconomyConflict('BAD_REQUEST');
  const size=request.headers.get('content-length');if(size!==null&&(!/^\d+$/.test(size)||Number(size)>2048))throw new EconomyConflict('BAD_REQUEST');
  if(!request.body)throw new EconomyConflict('BAD_REQUEST');
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let n=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;n+=chunk.value.byteLength;if(n>2048){await reader.cancel();throw new EconomyConflict('BAD_REQUEST');}parts.push(chunk.value);}}
  finally{reader.releaseLock();}
  const all=new Uint8Array(n);let at=0;for(const p of parts){all.set(p,at);at+=p.byteLength;}
  let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));}catch{throw new EconomyConflict('BAD_REQUEST');}
  if(value===null||typeof value!=='object'||Array.isArray(value))throw new EconomyConflict('BAD_REQUEST');return value as Record<string,unknown>;
}
function keys(value:Record<string,unknown>,expected:string[]){return Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));}
/** Narrow, same-origin money endpoints. SIWE authenticates identity only; this
 * server cannot sign a token allowance/transfer or move staked principal. */
export async function handleEconomyApi(request:Request,deps:EconomyDeps={}):Promise<Response|null>{
  const url=new URL(request.url),path=url.pathname;
  if(path!=='/api/me/economy'&&!path.startsWith('/api/economy/'))return null;
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site'),local=url.protocol==='http:'&&LOOPBACK.has(url.hostname);
  if((url.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==url.origin)||(site!==null&&site!=='same-origin'&&site!=='none'))return error(403,'FORBIDDEN_ORIGIN');
  const goldMatch=/^\/api\/economy\/orders\/(0x[0-9a-fA-F]{64})\/gold(\/challenge)?$/.exec(path),challengeRoute=!!goldMatch?.[2],configRoute=path==='/api/economy/config',meRoute=path==='/api/me/economy',ordersRoute=path==='/api/economy/orders';
  if(!configRoute&&!meRoute&&!ordersRoute&&!goldMatch)return error(404,'NOT_FOUND');
  const method=configRoute||meRoute?'GET':'POST';
  if(request.method!==method)return error(405,'METHOD_NOT_ALLOWED',{Allow:method});
  if(method==='POST'&&origin!==url.origin)return error(403,'FORBIDDEN_ORIGIN');
  if(configRoute){if(url.search)return error(400,'BAD_REQUEST');return reply(200,publicEconomyConfig(deps.config));}
  if(!deps.db||!deps.allow||!deps.config)return error(503,'ECONOMY_UNAVAILABLE');
  try{
    const clock=economySessionClock(deps.now??Date.now),started=clock();if(!validClock(started))return error(503,'ECONOMY_UNAVAILABLE');
    if(!await deps.allow('economy:'+(deps.client??'unknown')))return error(429,'RATE_LIMITED',{'Retry-After':'60'});
    const session=await readEconomySession(request,deps.db,clock);
    if(typeof session==='string')return error(401,session==='SESSION_EXPIRED'?'SESSION_EXPIRED':'AUTH_REQUIRED');
    let now=clock();
    if(!validClock(now)||now<started)return error(503,'ECONOMY_UNAVAILABLE');
    if(!ECONOMY_ADDRESS.test(session.address)||session.expiresAt<=now||!Number.isSafeInteger(session.expiresAt)||!['ECDSA','ERC1271'].includes(session.verificationMethod??''))return error(401,'AUTH_REQUIRED');
    const wallet=session.address.toLowerCase();
    let expected:unknown,value:Record<string,unknown>|undefined;
    if(meRoute){if(url.search.length>256||url.searchParams.size!==1)return error(400,'BAD_REQUEST');expected=url.searchParams.get('expected_address');}
    else{
      if(url.search)return error(400,'BAD_REQUEST');
      value=await body(request);
      if(!keys(value,ordersRoute?['expectedAddress','requestId','serviceId','currency']:challengeRoute?['expectedAddress','requestId']:['expectedAddress','requestId','signature']))return error(400,'BAD_REQUEST');
      expected=value.expectedAddress;
    }
    if(typeof expected!=='string'||!ECONOMY_ADDRESS.test(expected))return error(400,'BAD_REQUEST');
    if(expected.toLowerCase()!==wallet)return error(409,'ACCOUNT_MISMATCH');
    const authReply=async(value:unknown)=>await revalidateEconomySession(request,deps.db!,session,clock)?reply(200,value):error(401,'AUTH_REQUIRED');
    if(meRoute){
      const snapshot=await economyWalletSnapshot(deps.db,deps.config,wallet),finished=clock();
      if(!validClock(finished)||finished<now)return error(503,'ECONOMY_UNAVAILABLE');
      // The legacy private view needs the same late-logout boundary as balances
      // and the shared GOLD view; never return a completed stale wallet read.
      if(!await revalidateEconomySession(request,deps.db,session,clock))return error(401,'AUTH_REQUIRED');
      return reply(200,snapshot);
    }
    // Retain the existing persistent-write boundary. ERC-1271 identity can read,
    // but does not silently gain this new order/debit authority.
    if(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA')return error(403,'EOA_REQUIRED');
    now=clock();if(!validClock(now)||now<started)return error(503,'ECONOMY_UNAVAILABLE');
    if(!await revalidateEconomySession(request,deps.db,session,clock))return error(401,'AUTH_REQUIRED');
    const fresh=session;
    if(typeof value!.requestId!=='string'||! /^[A-Za-z0-9_-]{16,80}$/.test(value!.requestId))return error(400,'BAD_REQUEST');
    try{
    if(ordersRoute){
      if(typeof value!.serviceId!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(value!.serviceId)||typeof value!.currency!=='string'||!['GOLD','EMBEO'].includes(value!.currency))return error(400,'BAD_REQUEST');
      const order=await createEconomyOrder(deps.db,deps.config,{wallet,requestId:value!.requestId,serviceId:value!.serviceId,currency:value!.currency as 'GOLD'|'EMBEO',nowMs:now,now:clock,authorization:{tokenHash:fresh.tokenHash}});
      return await authReply({order,...order.currency==='EMBEO'?{payment:{chainId:deps.config.chainId,contract:deps.config.paymentContract,token:deps.config.token,receiver:deps.config.treasury,orderId:order.id,amount:order.amount}}:{}});
    }
    if(!ECONOMY_HASH.test(goldMatch![1]))return error(400,'BAD_REQUEST');
    if(challengeRoute)return await authReply({challenge:await createEconomyGoldChallenge(deps.db,deps.config,{wallet,orderId:goldMatch![1],requestId:value!.requestId,origin:url.origin,nowMs:now,now:clock,authorization:{tokenHash:fresh.tokenHash},serviceReady:deps.serviceReady,serviceProducts:deps.serviceProducts})});
    if(typeof value!.signature!=='string'||! /^0x[0-9a-fA-F]{130}$/.test(value!.signature))return error(400,'BAD_REQUEST');
    return await authReply({order:await payEconomyOrderGold(deps.db,deps.config,{wallet,orderId:goldMatch![1],requestId:value!.requestId,signature:value!.signature,origin:url.origin,nowMs:now,now:clock,authorization:{tokenHash:fresh.tokenHash},serviceReady:deps.serviceReady,serviceProducts:deps.serviceProducts})});
    }catch(cause){if(cause instanceof Error&&cause.message==='INVALID_CLOCK')throw cause;if(!await revalidateEconomySession(request,deps.db,session,clock))return error(401,'AUTH_REQUIRED');throw cause;}
  }catch(cause){
    if(cause instanceof EconomyConflict){const code=cause.code;return error(code==='SERVICE_DELIVERY_UNAVAILABLE'?503:code==='BAD_REQUEST'||code==='GOLD_SIGNATURE_REQUIRED'?400:code==='AUTH_REQUIRED'?401:code==='INVALID_GOLD_SIGNATURE'?403:code==='ORDER_NOT_FOUND'?404:409,code);}
    return error(503,'ECONOMY_UNAVAILABLE');
  }
}
