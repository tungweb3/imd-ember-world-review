import {readSession,sha256} from './auth.ts';
import type {D1Database} from './d1.ts';
import type {EconomyConfig} from './economy-config.ts';
import {API_HEADERS} from './world-api.ts';
import {goldBalanceStatement,goldBalanceView,goldQuote} from './world-gold.ts';
import type {GoldDeliveryProvider} from './world-gold-delivery.ts';
import {SQUEEK_ONE_TIME_SQL,SQUEEK_PRODUCTS_JSON,squeekOwnedElsewhere} from './squeek-ownership.ts';
import {economySessionClock,readEconomySession,revalidateEconomySession,economySessionFailure} from './economy-session.ts';
import {SQUEEK_API_PREFIX,SQUEEK_CATALOG_VERSION,SQUEEK_CLIENT_ID,SQUEEK_ISSUER,SQUEEK_ITEMS,SQUEEK_ORIGIN,SQUEEK_PRODUCTS,SQUEEK_REDIRECT,SQUEEK_REQUEST_KEY,
 squeekByProduct,squeekBySku,squeekRequestId,type SqueekItem} from '../src/shared/squeekCatalog.ts';

/** 鼠道修仙 (Squeek Ascension) on World GOLD.
 * - Identity: authorization code + PKCE for a public client (the game has no server). The grant is
 *   read-only: it shows the wallet's GOLD and cosmetics and can never debit GOLD.
 * - Purchase: the player opens /squeek-checkout/ on imdember.com, which creates a World GOLD order and
 *   asks for the wallet's own signature of that single amount (the shared economy payment).
 * - Ownership: derived from the wallet's paid order whose delivery has not failed or been refunded, as
 *   the research day pass is. A refund therefore removes the cosmetic in the same ledger state.
 * - No birth data, game save or Celestao record is asked for, stored or linked here. */
export const SQUEEK_CODE_TTL_MS=60_000,SQUEEK_TOKEN_TTL_MS=60*60_000;
const OPAQUE=/^[A-Za-z0-9_-]{43}$/,STATE=/^[A-Za-z0-9_-]{22,128}$/,ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const BASE={...API_HEADERS,'Referrer-Policy':'no-referrer'};
const reply=(status:number,value:unknown,extra:Record<string,string>={})=>new Response(value===null?null:JSON.stringify(value),{status,headers:{...BASE,...extra}});
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const opaque=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export async function squeekPkce(verifier:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));}
export type SqueekDeps={db?:D1Database;config?:EconomyConfig|null;enabled?:boolean;ready?:boolean;now?:()=>number;client?:string;allow?:(key:string)=>Promise<boolean>;
 testConfig?:{issuer:string;redirect:string}};
type Config={issuer:string;redirect:string;clientOrigin:string};
function config(deps:SqueekDeps):Config|null{
 if(!deps.testConfig)return {issuer:SQUEEK_ISSUER,redirect:SQUEEK_REDIRECT,clientOrigin:SQUEEK_ORIGIN};
 // Local test runs only: plain-HTTP loopback for both sides, never a public host.
 try{const i=new URL(deps.testConfig.issuer),r=new URL(deps.testConfig.redirect),hosts=new Set(['localhost','127.0.0.1','[::1]']);
  if(i.protocol!=='http:'||r.protocol!=='http:'||!hosts.has(i.hostname)||!hosts.has(r.hostname)||i.origin!==deps.testConfig.issuer||i.username||i.password||r.username||r.password||r.search||r.hash||r.pathname!=='/')return null;
  return {issuer:i.origin,redirect:r.href,clientOrigin:r.origin};
 }catch{return null;}
}
function clock(deps:SqueekDeps){const n=(deps.now??Date.now)();if(!Number.isSafeInteger(n)||n<=0)throw Error('INVALID_CLOCK');return n;}
async function body(request:Request,keys:readonly string[]):Promise<Record<string,unknown>|null>{
 if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??'')||Number(request.headers.get('content-length'))>2048||!request.body)return null;
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>2048){await reader.cancel().catch(()=>{});return null;}chunks.push(r.value);}
 const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k))?v:null;}catch{return null;}
}
/** The game sees a stable pseudonym, not the wallet address. */
export async function squeekSubject(address:string){return 'sq_'+(await sha256('squeek-subject-v1:'+address.toLowerCase())).slice(0,40);}
const walletHint=(a:string)=>a.slice(0,6)+'…'+a.slice(-4);

// ---- Ownership and receipts (shared ledger, no copy of its state) ----
const ORDERS=`FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id JOIN world_gold_products p ON p.id=l.product_id LEFT JOIN world_gold_jobs j ON j.order_id=o.id
 WHERE o.wallet=? AND l.kind='service' AND o.currency='GOLD' AND p.product IN (SELECT value FROM json_each(?))`;
const LIVE=`o.status='paid' AND COALESCE(j.state,'queued') NOT IN ('failed','refunded')`;
const PRODUCTS_JSON=SQUEEK_PRODUCTS_JSON;
export {SQUEEK_ONE_TIME_SQL,squeekOwnedElsewhere};
export async function squeekEntitlements(db:D1Database,wallet:string){
 const rows=(await db.prepare(`SELECT DISTINCT p.product product ${ORDERS} AND ${LIVE}`).bind(wallet.toLowerCase(),PRODUCTS_JSON).all<{product:string}>()).results;
 return SQUEEK_ITEMS.filter(i=>rows.some(r=>r.product===i.product)).map(i=>i.sku);
}
type Row={id:string;request_id:string;product:string;amount:string;status:string;created_ms:number;expires_ms:number;paid_ms:number|null;delivery:string|null;updated_ms:number|null};
const SELECT=`SELECT o.id,o.request_id,p.product,o.amount,o.status,o.created_ms,o.expires_ms,o.paid_ms,j.state delivery,j.updated_ms ${ORDERS}`;
export type SqueekReceipt={orderId:string;requestKey:string|null;subjectId:string;sku:string;status:'pending'|'expired'|'paid'|'refund_pending'|'refunded';amountGold:string;createdAt:number;expiresAt:number;paidAt:number|null};
function receipt(row:Row,subjectId:string,now:number):SqueekReceipt|null{
 const item=squeekByProduct(row.product);if(!item)return null;
 const status=row.status==='paid'?row.delivery==='refunded'?'refunded':row.delivery==='failed'?'refund_pending':'paid':row.expires_ms<=now?'expired':'pending';
 return {orderId:row.id,requestKey:row.request_id.startsWith('sq_')?row.request_id.slice(3):null,subjectId,sku:item.sku,status,amountGold:String(row.amount),createdAt:row.created_ms,expiresAt:row.expires_ms,paidAt:row.paid_ms};
}
async function revision(db:D1Database,wallet:string){
 const r=await db.prepare(`SELECT MAX(MAX(o.created_ms,COALESCE(o.paid_ms,0),COALESCE(j.updated_ms,0))) r ${ORDERS}`).bind(wallet,PRODUCTS_JSON).first<{r:number|null}>();
 return Number(r?.r??0);
}

// ---- Delivery: nothing external is called, so a paid cosmetic cannot be "paid but undelivered" ----
export function createSqueekDelivery():GoldDeliveryProvider{
 return {id:'squeek-store-v1',products:SQUEEK_PRODUCTS,async deliver(order){
  const item=squeekByProduct(order.product);
  if(!item||order.idempotencyKey!==order.orderId||!/^0x[0-9a-f]{64}$/.test(order.orderId)||!/^0x[0-9a-f]{40}$/.test(order.wallet))throw Error('UNSUPPORTED_SERVICE');
  return {kind:'delivered',result:{status:'ok',explanation:`鼠道修仙 cosmetic ${item.sku} (${item.nameEn}). Ownership follows this paid order; it changes only how the game looks.`,value:true}};
 }};
}

// ---- Read-only grant ----
export async function readSqueekGrant(db:D1Database,token:string,clock:()=>number){
 if(!OPAQUE.test(token))return null;
 const hash=await sha256(token),now=clock();
 const row=await db.prepare(`SELECT t.address,MIN(t.expires_at,s.expires_at) expires_at FROM squeek_tokens t JOIN sessions s ON s.token_hash=t.source_session_hash AND s.address=t.address
  WHERE t.token_hash=?1 AND t.revoked_at IS NULL AND t.created_at<=?2 AND t.expires_at>?2 AND s.revoked_at IS NULL AND s.expires_at>?2`).bind(hash,now).first<{address:string;expires_at:number}>();
 const fresh=clock();if(fresh<now)throw Error('INVALID_CLOCK');return row&&row.expires_at>fresh?{...row,hash}:null;
}
const bearer=(request:Request)=>{const h=request.headers.get('authorization');return h&&h.length<=60&&h.startsWith('Bearer ')&&OPAQUE.test(h.slice(7))?h.slice(7):null;};
async function salesOpen(db:D1Database,deps:SqueekDeps){
 if(deps.enabled!==true||deps.ready!==true||!deps.config)return false;
 const r=await db.prepare(`SELECT (SELECT COUNT(*) FROM world_gold_products p WHERE p.product IN (SELECT value FROM json_each(?1)) AND p.enabled=1 AND p.kind='service' AND CAST(p.gold AS TEXT)='200'
  AND p.version=(SELECT MAX(version) FROM world_gold_products WHERE product=p.product)) n,(SELECT enabled FROM world_gold_controls WHERE feature='service') service`).bind(PRODUCTS_JSON).first<{n:number;service:number|null}>();
 return Number(r?.n)===SQUEEK_ITEMS.length&&r?.service===1;
}
const item=(i:SqueekItem)=>({sku:i.sku,amountGold:i.gold,kind:i.kind,nameZh:i.nameZh,nameEn:i.nameEn});

async function authorize(request:Request,url:URL,deps:SqueekDeps,cfg:Config,db:D1Database){
 const q:Record<string,string>={},keys=['client_id','redirect_uri','response_type','code_challenge_method','code_challenge','state','lang'];
 for(const [k,v]of url.searchParams){if(!keys.includes(k)||Object.hasOwn(q,k))return reply(400,{error:'BAD_REQUEST'});q[k]=v;}
 if(q.client_id!==SQUEEK_CLIENT_ID||q.redirect_uri!==cfg.redirect||q.response_type!=='code'||q.code_challenge_method!=='S256'||!OPAQUE.test(q.code_challenge??'')||!STATE.test(q.state??'')||!['zh','en'].includes(q.lang??''))return reply(400,{error:'BAD_REQUEST'});
 if(!await deps.allow!('squeek:authorize:'+(deps.client??'unknown')))return reply(429,{error:'RATE_LIMITED'},{'Retry-After':'60'});
 const start=clock(deps),session=await readSession(request,db,start);
 if(typeof session==='string'){
  if(request.headers.get('sec-fetch-mode')==='navigate'&&request.headers.get('accept')?.includes('text/html'))return reply(303,null,{Location:'/squeek-connect/?next='+encodeURIComponent(url.pathname+url.search)+'&lang='+q.lang});
  return reply(401,{error:'AUTH_REQUIRED'});
 }
 const code=opaque(),hash=await sha256(code),now=clock(deps);if(now<start)return reply(503,{error:'SQUEEK_UNAVAILABLE'});
 const row=await db.prepare(`INSERT INTO squeek_auth_codes(code_hash,source_session_hash,address,code_challenge,redirect_uri,issued_at,expires_at)
  SELECT ?1,token_hash,address,?2,?3,?4,MIN(expires_at,?5) FROM sessions WHERE token_hash=?6 AND address=?7 AND revoked_at IS NULL AND expires_at>?4 RETURNING code_hash`)
  .bind(hash,q.code_challenge,cfg.redirect,now,now+SQUEEK_CODE_TTL_MS,session.tokenHash,session.address).first();
 if(!row)return reply(401,{error:'AUTH_REQUIRED'});
 const target=new URL(cfg.redirect);target.searchParams.set('world_code',code);target.searchParams.set('world_state',q.state);return reply(303,null,{Location:target.href});
}
async function token(request:Request,deps:SqueekDeps,cfg:Config,db:D1Database,headers:Record<string,string>){
 const b=await body(request,['grant_type','client_id','redirect_uri','code','code_verifier']);
 if(!b||b.grant_type!=='authorization_code'||b.client_id!==SQUEEK_CLIENT_ID||b.redirect_uri!==cfg.redirect||typeof b.code!=='string'||!OPAQUE.test(b.code)||typeof b.code_verifier!=='string'||!OPAQUE.test(b.code_verifier))return reply(400,{error:'BAD_REQUEST'},headers);
 const [hash,challenge]=await Promise.all([sha256(b.code),squeekPkce(b.code_verifier)]);
 if(!await deps.allow!('squeek:token:'+hash.slice(0,32)))return reply(429,{error:'RATE_LIMITED'},{...headers,'Retry-After':'60'});
 const grant=opaque(),grantHash=await sha256(grant),now=clock(deps);
 const rows=await db.batch([
  db.prepare(`UPDATE squeek_auth_codes SET consumed_at=?1,token_hash=?2
   WHERE code_hash=?3 AND consumed_at IS NULL AND issued_at<=?1 AND expires_at>?1 AND code_challenge=?4 AND redirect_uri=?5
   AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=source_session_hash AND s.address=squeek_auth_codes.address AND s.revoked_at IS NULL AND s.expires_at>?1) RETURNING address`)
   .bind(now,grantHash,hash,challenge,cfg.redirect),
  db.prepare(`INSERT INTO squeek_tokens(token_hash,source_session_hash,address,created_at,expires_at)
   SELECT c.token_hash,c.source_session_hash,c.address,?1,MIN(s.expires_at,?2) FROM squeek_auth_codes c JOIN sessions s ON s.token_hash=c.source_session_hash AND s.address=c.address
   WHERE c.code_hash=?3 AND c.token_hash=?4 AND c.consumed_at=?1 AND s.revoked_at IS NULL AND s.expires_at>?1 RETURNING address,expires_at`)
   .bind(now,now+SQUEEK_TOKEN_TTL_MS,hash,grantHash)
 ]);
 const row=rows[1]?.results[0] as {address:string;expires_at:number}|undefined;
 if(rows[0]?.results.length!==1||!row)return reply(401,{error:'INVALID_GRANT'},headers);
 return reply(200,{token_type:'Bearer',access_token:grant,scope:'squeek:read',expires_at:row.expires_at,subject_id:await squeekSubject(row.address)},headers);
}
async function snapshot(db:D1Database,deps:SqueekDeps,address:string,expires:number){
 const subjectId=await squeekSubject(address),[balance]=await db.batch([goldBalanceStatement(db,address)]);
 const view=goldBalanceView(balance.results[0] as {book:string;reserved:string}|undefined);
 return {subjectId,walletHint:walletHint(address),balanceGold:view.available,entitlements:await squeekEntitlements(db,address),revision:await revision(db,address),
  catalogVersion:SQUEEK_CATALOG_VERSION,salesEnabled:await salesOpen(db,deps),expiresAt:expires};
}

// ---- Checkout support for the World page (same origin, cookie session) ----
async function checkout(request:Request,url:URL,route:string,deps:SqueekDeps,db:D1Database){
 const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site'),read=route==='checkout/state';
 if(origin!==null&&origin!==url.origin||!read&&(origin!==url.origin||url.search)||site!==null&&!['same-origin','none'].includes(site))return reply(403,{error:'FORBIDDEN_ORIGIN'});
 const sclock=economySessionClock(deps.now??Date.now);let check:(()=>Promise<boolean>)|undefined;
 try{
  if(!await deps.allow!('squeek-checkout:'+(deps.client??'unknown')))return reply(429,{error:'RATE_LIMITED'});
  const b=read?Object.fromEntries(url.searchParams):await body(request,['sku','requestKey','expectedAddress']);
  if(!b||Object.keys(b).length!==3||!squeekBySku(b.sku)||typeof b.requestKey!=='string'||!SQUEEK_REQUEST_KEY.test(b.requestKey)||typeof b.expectedAddress!=='string'||!ADDRESS.test(b.expectedAddress))return reply(400,{error:'BAD_REQUEST'});
  const it=squeekBySku(b.sku)!,start=sclock();
  const session=await readEconomySession(request,db,sclock);if(typeof session==='string')return reply(401,{error:'AUTH_REQUIRED'});
  check=()=>revalidateEconomySession(request,db,session,sclock);
  const guarded=async(v:unknown,status=200)=>await check!()?reply(status,v):reply(401,{error:'AUTH_REQUIRED'});
  if(session.address.toLowerCase()!==b.expectedAddress.toLowerCase())return guarded({error:'ACCOUNT_MISMATCH'},409);
  const wallet=session.address.toLowerCase(),rid=squeekRequestId(b.requestKey);
  const find=()=>db.prepare(`${SELECT} AND o.request_id=?`).bind(wallet,PRODUCTS_JSON,rid).first<Row>();
  let existing=await find();
  if(existing&&existing.product!==it.product)return guarded({error:'IDEMPOTENCY_CONFLICT'},409);
  if(!read&&!existing){
   if(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA')return guarded({error:'EOA_REQUIRED'},403);
   if(!await salesOpen(db,deps))return guarded({error:'SALES_CLOSED'},503);
   if((await squeekEntitlements(db,wallet)).includes(it.sku))return guarded({error:'ALREADY_OWNED'},409);
   await goldQuote({db,config:deps.config!,nowMs:sclock(),now:sclock,serviceReady:true},{wallet,requestId:rid,product:it.product,authorization:{tokenHash:session.tokenHash}});
   existing=await find();
  }
  const subjectId=await squeekSubject(wallet),now=sclock();if(now<start)throw Error('INVALID_CLOCK');
  const owned=(await squeekEntitlements(db,wallet)).includes(it.sku);
  const [balance]=await db.batch([goldBalanceStatement(db,wallet)]);const available=goldBalanceView(balance.results[0] as {book:string;reserved:string}|undefined).available;
  return guarded({wallet,item:item(it),owned,balanceGold:available,order:existing?receipt(existing,subjectId,now):null,ready:await salesOpen(db,deps)});
 }catch(error){const cause=await economySessionFailure(error,check),code=cause instanceof Error?cause.message:'CHECKOUT_UNAVAILABLE';
  return reply(code==='AUTH_REQUIRED'?401:code==='BAD_REQUEST'?400:['IDEMPOTENCY_CONFLICT','ORDER_EXPIRED','FEATURE_PAUSED','PRODUCT_UNAVAILABLE','ALREADY_OWNED'].includes(code)?409:503,{error:/^[A-Z_]{3,80}$/.test(code)?code:'CHECKOUT_UNAVAILABLE'});}
}

const PUBLIC=new Map([['catalog','GET'],['token','POST'],['snapshot','GET'],['orders','GET'],['order','GET'],['quote','GET'],['logout','POST']]);
export async function handleSqueek(request:Request,deps:SqueekDeps):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith(SQUEEK_API_PREFIX))return null;
 if(request.url.length>2048)return reply(400,{error:'BAD_REQUEST'});
 const route=url.pathname.slice(SQUEEK_API_PREFIX.length),cfg=config(deps);
 if(!cfg||!deps.db||!deps.allow)return reply(503,{error:'SQUEEK_UNAVAILABLE'});
 if(url.origin!==cfg.issuer)return reply(403,{error:'ORIGIN_NOT_ALLOWED'});
 const db=deps.db;
 if(route==='authorize'){if(request.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'},{Allow:'GET'});
  const origin=request.headers.get('origin');if(origin!==null&&origin!==cfg.issuer&&origin!==cfg.clientOrigin)return reply(403,{error:'ORIGIN_NOT_ALLOWED'});
  try{return await authorize(request,url,deps,cfg,db);}catch{return reply(503,{error:'SQUEEK_UNAVAILABLE'});}}
 if(route==='checkout/state'||route==='checkout/quote'){if(request.method!==(route==='checkout/state'?'GET':'POST'))return reply(405,{error:'METHOD_NOT_ALLOWED'});return checkout(request,url,route,deps,db);}
 const method=PUBLIC.get(route);if(!method)return reply(404,{error:'UNKNOWN_ROUTE'});
 // Cross-origin calls come only from the game. Bearer grants are not ambient, so no cookie is read or set here.
 const origin=request.headers.get('origin');if(origin!==null&&origin!==cfg.clientOrigin)return reply(403,{error:'ORIGIN_NOT_ALLOWED'});
 const cors:Record<string,string>={'Access-Control-Allow-Origin':cfg.clientOrigin,Vary:'Origin','Cross-Origin-Resource-Policy':'cross-origin'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...BASE,...cors,'Access-Control-Allow-Methods':method,'Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Max-Age':'600'}});
 if(request.method!==method)return reply(405,{error:'METHOD_NOT_ALLOWED'},{...cors,Allow:method});
 try{
  if(route==='catalog'){if(url.search)return reply(400,{error:'BAD_REQUEST'},cors);if(!await deps.allow('squeek:catalog:'+(deps.client??'unknown')))return reply(429,{error:'RATE_LIMITED'},cors);
   return reply(200,{catalogVersion:SQUEEK_CATALOG_VERSION,salesEnabled:await salesOpen(db,deps),items:SQUEEK_ITEMS.map(item)},cors);}
  if(route==='token'){if(url.search)return reply(400,{error:'BAD_REQUEST'},cors);return await token(request,deps,cfg,db,cors);}
  const tokenValue=bearer(request);if(!tokenValue)return reply(401,{error:'AUTH_REQUIRED'},{...cors,'WWW-Authenticate':'Bearer'});
  const tclock=()=>clock(deps),grant=await readSqueekGrant(db,tokenValue,tclock);
  if(!await deps.allow('squeek:api:'+(await sha256(tokenValue)).slice(0,32)))return reply(429,{error:'RATE_LIMITED'},cors);
  if(route==='logout'){if(url.search)return reply(400,{error:'BAD_REQUEST'},cors);
   if(grant)await db.prepare('UPDATE squeek_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL').bind(clock(deps),grant.hash).run();return reply(204,null,cors);}
  if(!grant)return reply(401,{error:'AUTH_REQUIRED'},{...cors,'WWW-Authenticate':'Bearer'});
  const wallet=grant.address.toLowerCase(),subjectId=await squeekSubject(wallet);
  if(route==='snapshot'){if(url.search)return reply(400,{error:'BAD_REQUEST'},cors);return reply(200,await snapshot(db,deps,wallet,grant.expires_at),cors);}
  if(route==='orders'){if(url.search)return reply(400,{error:'BAD_REQUEST'},cors);const now=clock(deps);
   const rows=(await db.prepare(`${SELECT} ORDER BY o.created_ms DESC,o.id DESC LIMIT 100`).bind(wallet,PRODUCTS_JSON).all<Row>()).results;
   return reply(200,{subjectId,orders:rows.map(r=>receipt(r,subjectId,now)).filter(Boolean)},cors);}
  if(route==='order'){const key=url.searchParams.get('requestKey');if(url.searchParams.size!==1||!key||!SQUEEK_REQUEST_KEY.test(key))return reply(400,{error:'BAD_REQUEST'},cors);
   const row=await db.prepare(`${SELECT} AND o.request_id=?`).bind(wallet,PRODUCTS_JSON,squeekRequestId(key)).first<Row>();
   return row?reply(200,{order:receipt(row,subjectId,clock(deps))},cors):reply(404,{error:'NOT_FOUND'},cors);}
  // quote: what the World checkout page will ask the player to sign. Nothing is reserved or charged.
  const it=squeekBySku(url.searchParams.get('sku'));if(url.searchParams.size!==1||!it)return reply(400,{error:'BAD_REQUEST'},cors);
  const snap=await snapshot(db,deps,wallet,grant.expires_at),owned=snap.entitlements.includes(it.sku);
  return reply(200,{...item(it),subjectId,owned,affordable:BigInt(snap.balanceGold)>=BigInt(it.gold),balanceGold:snap.balanceGold,catalogVersion:SQUEEK_CATALOG_VERSION,salesEnabled:snap.salesEnabled,
   checkoutUrl:cfg.issuer+'/squeek-checkout/?sku='+encodeURIComponent(it.sku)},cors);
 }catch{return reply(503,{error:'SQUEEK_UNAVAILABLE'},cors);}
}
export async function pruneSqueekAuth(db:D1Database,now:number){
 if(!Number.isSafeInteger(now)||now<0)throw Error('INVALID_CLOCK');
 const [codes,tokens]=await db.batch([
  db.prepare('DELETE FROM squeek_auth_codes WHERE code_hash IN (SELECT code_hash FROM squeek_auth_codes WHERE expires_at<=?1 ORDER BY expires_at LIMIT 200)').bind(now),
  db.prepare('DELETE FROM squeek_tokens WHERE token_hash IN (SELECT token_hash FROM squeek_tokens WHERE expires_at<=?1 ORDER BY expires_at LIMIT 200)').bind(now)
 ]);return {codes:Number(codes.meta.changes??0),tokens:Number(tokens.meta.changes??0)};
}
