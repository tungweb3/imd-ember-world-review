import type {D1Database} from './d1.ts';
import type {EconomyConfig} from './economy-config.ts';
import {readCelestaoGrant} from './celestao-auth.ts';
import {sha256} from './auth.ts';
import {economySessionClock,readEconomySession,revalidateEconomySession,economySessionFailure} from './economy-session.ts';
import {goldQuote} from './world-gold.ts';
import {fortuneProduct} from '../src/shared/fortunePricing.ts';
import {API_HEADERS} from './world-api.ts';
import {CELESTAO_DELIVERY_SCHEMA,CELESTAO_PREPARE_PATH,celestaoSecret,celestaoSignature,verifyCelestaoSignature,celestaoBody} from './celestao-protocol.ts';
const HEADERS={...API_HEADERS,'Referrer-Policy':'no-referrer'};
const CELESTAO_LAPSE_GRACE_MS=300000;
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
type Deps={db?:D1Database;secret?:string;enabled?:boolean;ready?:boolean;config?:EconomyConfig|null;now?:()=>number;allow?:(key:string)=>Promise<boolean>;client?:string};
/** Server-prepared run only. No birth data, browser amounts, or debit endpoint. */
export async function handleCelestaoCheckout(request:Request,deps:Deps):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/celestao-checkout/'))return null;
 const prepare=url.pathname===CELESTAO_PREPARE_PATH,quote=url.pathname==='/api/celestao-checkout/quote',read=url.pathname==='/api/celestao-checkout/state';
 const bad=(s:number,e:string)=>reply(s,{error:e});
 if(!prepare&&!quote&&!read)return bad(404,'NOT_FOUND');
 if(request.method!==(read?'GET':'POST'))return bad(405,'METHOD_NOT_ALLOWED');
 const local=url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(url.origin!=='https://imdember.com'&&!local)return bad(403,'FORBIDDEN_ORIGIN');
 if(!deps.db||!deps.allow||!celestaoSecret(deps.secret)||!read&&deps.enabled!==true)return bad(503,'CELESTAO_PAYMENTS_UNAVAILABLE');
 const db=deps.db,clock=economySessionClock(deps.now??Date.now);let check:(()=>Promise<boolean>)|undefined;
 try{
  const start=clock(),budget=()=>deps.allow!('celestao-checkout:'+(deps.client??'unknown'));if(!prepare&&!await budget())return bad(429,'RATE_LIMITED');
  if(prepare){
   if(url.search||request.headers.has('origin'))return bad(await budget()?403:429,'BACKEND_REQUIRED');
   const {raw,value:b}=await celestaoBody(request).catch(async error=>{await budget();throw error;});
   if(!await verifyCelestaoSignature(deps.secret,'request',CELESTAO_PREPARE_PATH,request.headers.get('x-celestao-signature'),raw,clock()))return bad(await budget()?401:429,'BACKEND_REQUIRED');
   const product=fortuneProduct(b.system);
   if(!exact(b,['bridgeSession','runId','system','inputHash'])||!opaque(b.bridgeSession)||!opaque(b.runId)||!product||b.system!==product.system||typeof b.inputHash!=='string'||!/^([0-9a-f]{64})$/.test(b.inputHash))return bad(400,'BAD_REQUEST');
   // Every buyer arrives through Celestao's one relay address, so a signed call is budgeted per bridge session.
   if(!await deps.allow('celestao-checkout:prepare:'+(await sha256(b.bridgeSession)).slice(0,32)))return bad(429,'RATE_LIMITED');
   const identity=await readCelestaoGrant(db,b.bridgeSession,clock);if(!identity)return bad(401,'AUTH_REQUIRED');
   const now=clock(),bridgeHash=await sha256(b.bridgeSession);
   await db.prepare(`INSERT INTO celestao_checkouts(id,wallet,product,input_hash,created_ms,expires_ms)
    SELECT ?1,b.address,?2,?3,?4,?5 FROM celestao_bridge_sessions b JOIN sessions s ON s.token_hash=b.source_session_hash AND s.address=b.address
    WHERE b.bridge_hash=?6 AND b.address=?7 AND b.created_at<=?4 AND b.expires_at>?4 AND s.revoked_at IS NULL AND s.expires_at>?4 ON CONFLICT(id) DO UPDATE SET expires_ms=excluded.expires_ms
    WHERE celestao_checkouts.order_id IS NULL AND celestao_checkouts.expires_ms<=?4 AND celestao_checkouts.wallet=excluded.wallet AND celestao_checkouts.product=excluded.product AND celestao_checkouts.input_hash=excluded.input_hash`)
    .bind(b.runId,product.product,b.inputHash,now,now+900000,bridgeHash,identity.address).run();
   const row=await db.prepare('SELECT * FROM celestao_checkouts WHERE id=?').bind(b.runId).first<{wallet:string;product:string;input_hash:string;expires_ms:number;order_id:string|null}>();
   // The insert also requires a live session: no row and no grant means it lapsed between the two reads.
   if(!row&&!await readCelestaoGrant(db,b.bridgeSession,clock))return bad(401,'AUTH_REQUIRED');
   if(!row||row.wallet!==identity.address||row.product!==product.product||row.input_hash!==b.inputHash)return bad(409,'IDEMPOTENCY_CONFLICT');
   if(!await readCelestaoGrant(db,b.bridgeSession,clock))return bad(401,'AUTH_REQUIRED');
   // A quote that ran out unpaid can never be paid and this checkout cannot be quoted again: Celestao then opens a new run.
   // The ledger compares a clock read before its write, so a payment can land just after expiry: a new run must wait until none can be in flight.
   const order=row.order_id?await db.prepare('SELECT status,expires_ms FROM economy_orders WHERE id=?').bind(row.order_id).first<{status:string;expires_ms:number}>():null,lapsed=order?.status==='pending'&&order.expires_ms+CELESTAO_LAPSE_GRACE_MS<=clock();
   const body=JSON.stringify({schema:CELESTAO_DELIVERY_SCHEMA,runId:b.runId,wallet:row.wallet,product:row.product,inputHash:row.input_hash,expiresMs:row.expires_ms,lapsed});
   const timestamp=String(Math.floor(clock()/1000));return new Response(body,{status:200,headers:{...HEADERS,'x-celestao-signature':await celestaoSignature(deps.secret,'response',CELESTAO_PREPARE_PATH,timestamp,body)}});
  }
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if(origin!==null&&origin!==url.origin||!read&&(origin!==url.origin||url.search)||site!==null&&!['same-origin','none'].includes(site))return bad(403,'FORBIDDEN_ORIGIN');
  const b=read?Object.fromEntries(url.searchParams):(await celestaoBody(request)).value;
  if(!exact(b,['runId','expectedAddress'])||!opaque(b.runId)||typeof b.expectedAddress!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(b.expectedAddress)||read&&url.searchParams.size!==2)return bad(400,'BAD_REQUEST');
  const session=await readEconomySession(request,db,clock);if(typeof session==='string')return bad(401,'AUTH_REQUIRED');
  check=()=>revalidateEconomySession(request,db,session,clock);
  const guarded=async(v:unknown,status=200)=>await check!()?reply(status,v):bad(401,'AUTH_REQUIRED');
  if(session.address!==b.expectedAddress.toLowerCase())return guarded({error:'ACCOUNT_MISMATCH'},409);
  const row=await db.prepare('SELECT * FROM celestao_checkouts WHERE id=? AND wallet=?').bind(b.runId,session.address).first<{id:string;product:string;expires_ms:number;order_id:string|null}>();
  if(!row)return guarded({error:'NOT_FOUND'},404);
  const product=fortuneProduct(row.product)!;
  if(quote){
   if(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA')return guarded({error:'EOA_REQUIRED'},403);
   if(!deps.config||!deps.ready)return guarded({error:'SERVICE_DELIVERY_UNAVAILABLE'},503);
   const orderId=await goldQuote({db,config:deps.config,nowMs:clock(),now:clock,serviceReady:true},{wallet:session.address,requestId:'celestao_'+row.id,product:row.product,authorization:{tokenHash:session.tokenHash},fortuneCheckout:row.id});
   return guarded({orderId});
  }
  const order=row.order_id?await db.prepare('SELECT o.id,o.service_id serviceId,o.currency,o.amount,o.status,o.created_ms createdMs,o.expires_ms expiresMs,o.paid_ms paidMs,j.state delivery,j.result_json result,j.failure FROM economy_orders o LEFT JOIN world_gold_jobs j ON j.order_id=o.id WHERE o.id=? AND o.wallet=?').bind(row.order_id,session.address).first():null;
  if(clock()<start)throw Error('INVALID_CLOCK');
  return guarded({wallet:session.address,runId:row.id,product,expiresMs:row.expires_ms,order,ready:deps.enabled===true&&!!deps.ready&&!!deps.config});
 }catch(error){const cause=await economySessionFailure(error,check),code=cause instanceof Error?cause.message:'CHECKOUT_UNAVAILABLE';return bad(code==='AUTH_REQUIRED'?401:code==='BAD_REQUEST'?400:['IDEMPOTENCY_CONFLICT','FORTUNE_CHECKOUT_REQUIRED','FORTUNE_PRICE_UNAVAILABLE','ORDER_EXPIRED','FEATURE_PAUSED','PRODUCT_UNAVAILABLE'].includes(code)?409:503,/^[A-Z_]{3,80}$/.test(code)?code:'CHECKOUT_UNAVAILABLE');}
}
