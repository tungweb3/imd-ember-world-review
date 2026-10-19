import {readSession,sha256} from './auth.ts';
import {goldCampaign} from './world-gold.ts';
import type {D1Database} from './d1.ts';
import {API_HEADERS} from './world-api.ts';

// A new, narrowly scoped bridge. Existing World SIWE/cookie semantics remain in auth.ts.
// Only a live World session can issue a code; only AIMarket's backend secret + PKCE can consume it.
// The result proves identity for research reads, never EMBEO holdings, administrator authority or payment.
export const AIMARKET_AUTH_PREFIX='/api/aimarket-auth/';
export const AIMARKET_ISSUER='https://imdember.com';
export const AIMARKET_CALLBACK='https://aimarket.trade/api/holder/world/callback';
export const AIMARKET_PORTAL_CALLBACK='https://research.imdember.com/api/holder/world/callback';
export const AIMARKET_CODE_TTL_MS=60_000,AIMARKET_SESSION_TTL_MS=60*60_000;
const BODY_LIMIT=2048,URL_LIMIT=2048;
const OPAQUE=/^[A-Za-z0-9_-]{43}$/,VERIFIER=/^[A-Za-z0-9._~-]{43,128}$/;
const ADDRESS=/^0x[\da-fA-F]{40}$/,STATE=/^[A-Za-z0-9_-]{22,128}$/;
const HEADERS={...API_HEADERS,'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
type Config={issuer:string;callback:string;clientOrigin:string;portalCallback?:string};
export type AIMarketAuthDeps={db?:D1Database;secret?:string;now?:()=>number;client?:string;
  // Separate AUTH_LIMITER keys; absence or thrown binding is a service failure, never fail-open.
  allow?:(key:string)=>Promise<boolean>;
  // Explicit in-process tests only. No environment setting can change the production allowlist.
  testConfig?:{issuer:string;callback:string;portalCallback?:string}};

const reply=(status:number,body:unknown,extra:Record<string,string>={})=>
  new Response(body===null?null:JSON.stringify(body),{status,headers:{...HEADERS,...extra}});
const fail=(status:number,error:string)=>reply(status,{error});
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const opaque=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export async function aimarketPkce(verifier:string):Promise<string>{
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
}
function config(deps:AIMarketAuthDeps):Config|null{
  if(!deps.testConfig)return {issuer:AIMARKET_ISSUER,callback:AIMARKET_CALLBACK,clientOrigin:'https://aimarket.trade',portalCallback:AIMARKET_PORTAL_CALLBACK};
  try{
    const i=new URL(deps.testConfig.issuer),c=new URL(deps.testConfig.callback),hosts=new Set(['localhost','127.0.0.1','[::1]']);
    if(i.protocol!=='http:'||c.protocol!=='http:'||!hosts.has(i.hostname)||!hosts.has(c.hostname)||
      i.origin!==deps.testConfig.issuer||i.username||i.password||c.username||c.password||c.search||c.hash||
      c.pathname!=='/api/holder/world/callback')return null;
    let portalCallback:string|undefined;
    if(deps.testConfig.portalCallback){const portal=new URL(deps.testConfig.portalCallback);if(portal.protocol!=='http:'||!hosts.has(portal.hostname)||portal.username||portal.password||portal.search||portal.hash||portal.pathname!=='/api/holder/world/callback')return null;portalCallback=portal.href;}
    return {issuer:i.origin,callback:c.href,clientOrigin:c.origin,portalCallback};
  }catch{return null;}
}
function validSecret(secret:unknown):secret is string{
  return typeof secret==='string'&&secret.length>=32&&secret.length<=256&&!/\s/.test(secret);
}
const knownCallback=(value:unknown,cfg:Config):value is string=>typeof value==='string'&&(value===cfg.callback||value===cfg.portalCallback);
async function authenticatedBackend(request:Request,secret:string):Promise<boolean>{
  const header=request.headers.get('authorization');
  if(!header||header.length>263||!header.startsWith('Bearer '))return false;
  const supplied=header.slice(7);if(!validSecret(supplied))return false;
  // Compare fixed-size digests so secret comparison does not short-circuit on a differing character.
  const [expected,actual]=await Promise.all([sha256(secret),sha256(supplied)]);let difference=0;
  for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^actual.charCodeAt(i);
  return difference===0;
}
async function readBody(request:Request,keys:readonly string[]):Promise<Record<string,unknown>|null>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??'')||
    Number(request.headers.get('content-length'))>BODY_LIMIT||!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;
    if(size>BODY_LIMIT){await reader.cancel().catch(()=>{});return null;}chunks.push(r.value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  try{const body:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    return body!==null&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).every(k=>keys.includes(k))?
      body as Record<string,unknown>:null;
  }catch{return null;}
}
function query(url:URL,keys:readonly string[]):Record<string,string>|null{
  const params:Record<string,string>={};
  for(const [key,value] of url.searchParams){if(!keys.includes(key)||Object.hasOwn(params,key))return null;params[key]=value;}
  return params;
}
function identity(address:string,expiresAt:number,issuer:string){
  return {issuer,audience:'aimarket',scope:'research:read',address,expires_at:expiresAt};
}
function clock(deps:AIMarketAuthDeps):number{const now=(deps.now??Date.now)();
  if(!Number.isSafeInteger(now)||now<0)throw new Error('invalid clock');return now;}
async function limited(deps:AIMarketAuthDeps,key:string):Promise<Response|null>{
  if(!deps.allow)return fail(503,'BRIDGE_UNAVAILABLE');
  return await deps.allow(key)?null:reply(429,{error:'RATE_LIMITED'},{'Retry-After':'60'});
}
function loginRequired(request:Request,language:string,error:string,status:number,portalCallback?:string,state?:string):Response{
  // Real document navigation returns to the existing World wallet entry. API
  // clients keep their exact 401/409 contract; no code or identity is issued.
  if(request.headers.get('sec-fetch-mode')==='navigate'&&request.headers.get('accept')?.includes('text/html')){
    if(portalCallback&&state){const target=new URL(portalCallback);target.searchParams.set('error','login_required');target.searchParams.set('state',state);target.searchParams.set('lang',language);return reply(303,null,{Location:target.href});}
    return reply(303,null,{Location:'/aimarket/?lang='+language});
  }
  return fail(status,error);
}
async function authorize(request:Request,url:URL,deps:AIMarketAuthDeps,cfg:Config,db:D1Database):Promise<Response>{
  const q=query(url,['client_id','redirect_uri','response_type','code_challenge_method','code_challenge','state','lang','expected_address']);
  if(!q||q.client_id!=='aimarket'||!knownCallback(q.redirect_uri,cfg)||q.response_type!=='code'||q.code_challenge_method!=='S256'||
    !OPAQUE.test(q.code_challenge??'')||!STATE.test(q.state??'')||!['zh','en'].includes(q.lang??'')||
    (q.expected_address!==undefined&&!ADDRESS.test(q.expected_address)))return fail(400,'BAD_REQUEST');
  const denied=await limited(deps,'aimarket:authorize:'+String(deps.client??'ip:unknown'));if(denied)return denied;
  const now=clock(deps),session=await readSession(request,db,now);
  const portal=q.redirect_uri===cfg.portalCallback?cfg.portalCallback:undefined;
  if(typeof session==='string')return loginRequired(request,q.lang,session==='none'?'AUTH_REQUIRED':session,401,portal,q.state);
  if(q.expected_address!==undefined&&q.expected_address.toLowerCase()!==session.address.toLowerCase())return loginRequired(request,q.lang,'ACCOUNT_CONTEXT_CHANGED',409,portal,q.state);
  const code=opaque(),hash=await sha256(code),at=clock(deps);
  if(at<now)return fail(503,'BRIDGE_UNAVAILABLE');
  // Re-check authority in the insert, after asynchronous boundaries. A concurrent logout/expiry issues nothing.
  const inserted=await db.prepare(`INSERT INTO aimarket_auth_codes
    (code_hash,source_session_hash,address,code_challenge,redirect_uri,issued_at,expires_at)
    SELECT ?1,token_hash,address,?2,?3,?4,MIN(expires_at,?5) FROM sessions
    WHERE token_hash=?6 AND address=?7 AND revoked_at IS NULL AND expires_at>?4 RETURNING code_hash`)
    .bind(hash,q.code_challenge,q.redirect_uri,at,at+AIMARKET_CODE_TTL_MS,session.tokenHash,session.address).run();
  if(inserted.results.length!==1)return fail(401,'AUTH_REQUIRED');
  const target=new URL(q.redirect_uri);target.searchParams.set('code',code);target.searchParams.set('state',q.state);target.searchParams.set('lang',q.lang);
  return reply(303,null,{Location:target.href});
}
async function token(request:Request,deps:AIMarketAuthDeps,cfg:Config,db:D1Database):Promise<Response>{
  const body=await readBody(request,['grant_type','client_id','redirect_uri','code','code_verifier']);
  if(!body||body.grant_type!=='authorization_code'||body.client_id!=='aimarket'||!knownCallback(body.redirect_uri,cfg)||
    typeof body.code!=='string'||!OPAQUE.test(body.code)||typeof body.code_verifier!=='string'||!VERIFIER.test(body.code_verifier))return fail(400,'BAD_REQUEST');
  const denied=await limited(deps,'aimarket:token:'+String(deps.client??'ip:unknown'));if(denied)return denied;
  const [hash,challenge]=await Promise.all([sha256(body.code),aimarketPkce(body.code_verifier)]),bridge=opaque(),bridgeHash=await sha256(bridge),at=clock(deps);
  // Consume and materialize one bridge in a single D1 transaction. Only the atomic UPDATE winner sets its bridge_hash;
  // a losing/replayed request's INSERT matches nothing. Both steps recheck the live source session.
  const results=await db.batch([
    db.prepare(`UPDATE aimarket_auth_codes SET consumed_at=?1,bridge_hash=?2
      WHERE code_hash=?3 AND consumed_at IS NULL AND expires_at>?1 AND issued_at<=?1
      AND code_challenge=?4 AND redirect_uri=?5 AND EXISTS(SELECT 1 FROM sessions s
        WHERE s.token_hash=source_session_hash AND s.address=aimarket_auth_codes.address AND s.revoked_at IS NULL AND s.expires_at>?1)
      RETURNING address`)
      .bind(at,bridgeHash,hash,challenge,body.redirect_uri),
    db.prepare(`INSERT INTO aimarket_bridge_sessions(bridge_hash,source_session_hash,address,created_at,expires_at)
      SELECT c.bridge_hash,c.source_session_hash,c.address,?1,MIN(s.expires_at,?2)
      FROM aimarket_auth_codes c JOIN sessions s ON s.token_hash=c.source_session_hash AND s.address=c.address
      WHERE c.code_hash=?3 AND c.bridge_hash=?4 AND c.consumed_at=?1 AND s.revoked_at IS NULL AND s.expires_at>?1
      RETURNING address,expires_at`)
      .bind(at,at+AIMARKET_SESSION_TTL_MS,hash,bridgeHash)
  ]);
  const row=results[1]?.results[0] as {address:string;expires_at:number}|undefined;
  if(results[0]?.results.length!==1||!row)return fail(401,'INVALID_GRANT');
  return reply(200,{...identity(row.address,row.expires_at,cfg.issuer),bridge_session:bridge});
}
async function introspect(request:Request,deps:AIMarketAuthDeps,cfg:Config,db:D1Database):Promise<Response>{
  const body=await readBody(request,['client_id','bridge_session']);
  if(!body||body.client_id!=='aimarket'||typeof body.bridge_session!=='string'||!OPAQUE.test(body.bridge_session))return fail(400,'BAD_REQUEST');
  const hash=await sha256(body.bridge_session),denied=await limited(deps,'aimarket:session:'+hash.slice(0,32));if(denied)return denied;
  const at=clock(deps),row=await db.prepare(`SELECT b.address,MIN(b.expires_at,s.expires_at) expires_at
    FROM aimarket_bridge_sessions b JOIN sessions s ON s.token_hash=b.source_session_hash AND s.address=b.address
    WHERE b.bridge_hash=?1 AND b.created_at<=?2 AND b.expires_at>?2 AND s.revoked_at IS NULL AND s.expires_at>?2`)
    .bind(hash,at).first<{address:string;expires_at:number}>();
  if(!row)return fail(401,'AUTH_REQUIRED');
  let trial={active:false,endsMs:null as number|null,version:0};
  try{const campaign=await goldCampaign(db,at);trial={active:campaign.active,endsMs:campaign.endsMs,version:campaign.version};}catch{/* Older deployed databases grant no trial. */}
  return reply(200,{...identity(row.address,row.expires_at,cfg.issuer),...trial.version>0?{world_trial:trial}:{}});
}
/** Unknown unrelated paths return null. All bridge answers, redirects and failures are non-cacheable and have no CORS. */
export async function handleAIMarketAuth(request:Request,deps:AIMarketAuthDeps):Promise<Response|null>{
  const url=new URL(request.url);if(!url.pathname.startsWith(AIMARKET_AUTH_PREFIX))return null;
  if(request.url.length>URL_LIMIT)return fail(400,'BAD_REQUEST');
  const routes=new Map([['authorize','GET'],['token','POST'],['session','POST']]);
  const route=url.pathname.slice(AIMARKET_AUTH_PREFIX.length),method=routes.get(route);
  if(!method)return fail(404,'UNKNOWN_ROUTE');
  if(request.method!==method)return reply(405,{error:'METHOD_NOT_ALLOWED'},{Allow:method});
  const cfg=config(deps);if(!cfg||!validSecret(deps.secret)||!deps.db||!deps.allow)return fail(503,'BRIDGE_UNAVAILABLE');
  if(url.origin!==cfg.issuer)return fail(403,'ORIGIN_NOT_ALLOWED');
  const origin=request.headers.get('origin');
  // Navigation may legitimately omit Origin. If supplied, only the two fixed participants are accepted.
  if(origin!==null&&origin!==cfg.issuer&&origin!==cfg.clientOrigin&&origin!==(cfg.portalCallback?new URL(cfg.portalCallback).origin:undefined))return fail(403,'ORIGIN_NOT_ALLOWED');
  if(route!=='authorize'&&url.search)return fail(400,'BAD_REQUEST');
  try{
    if(route==='authorize')return await authorize(request,url,deps,cfg,deps.db);
    if(!await authenticatedBackend(request,deps.secret))return fail(401,'BRIDGE_CLIENT_REQUIRED');
    return route==='token'?await token(request,deps,cfg,deps.db):await introspect(request,deps,cfg,deps.db);
  }catch{return fail(503,'BRIDGE_UNAVAILABLE');}
}
/** Bounded housekeeping, independent of other World tables. Expiry is authority even if cleanup has a backlog. */
export async function pruneAIMarketAuth(db:D1Database,now:number):Promise<{codes:number;bridges:number}>{
  if(!Number.isSafeInteger(now)||now<0)throw new Error('invalid clock');
  const [codes,bridges]=await db.batch([
    db.prepare('DELETE FROM aimarket_auth_codes WHERE code_hash IN (SELECT code_hash FROM aimarket_auth_codes WHERE expires_at<=?1 ORDER BY expires_at LIMIT 200)').bind(now),
    db.prepare('DELETE FROM aimarket_bridge_sessions WHERE bridge_hash IN (SELECT bridge_hash FROM aimarket_bridge_sessions WHERE expires_at<=?1 ORDER BY expires_at LIMIT 200)').bind(now)
  ]);
  return {codes:Number(codes.meta.changes??0),bridges:Number(bridges.meta.changes??0)};
}
