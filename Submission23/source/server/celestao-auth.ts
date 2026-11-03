import {readSession,sha256} from './auth.ts';
import type {D1Database} from './d1.ts';
import {API_HEADERS} from './world-api.ts';
import {CELESTAO_AUTH_PREFIX,CELESTAO_CALLBACK,CELESTAO_ISSUER} from '../src/shared/celestaoProtocol.ts';
export {CELESTAO_AUTH_PREFIX,CELESTAO_CALLBACK,CELESTAO_ISSUER} from '../src/shared/celestaoProtocol.ts';

/** Celestao identity only. This grant cannot sign, debit GOLD or access another
 * partner's identity. Payment continues through World and its wallet signature. */
export const CELESTAO_CODE_TTL_MS=60_000,CELESTAO_SESSION_TTL_MS=60*60_000;
const OPAQUE=/^[A-Za-z0-9_-]{43}$/,STATE=/^[A-Za-z0-9_-]{22,128}$/;
const HEADERS={...API_HEADERS,'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
export type CelestaoAuthDeps={db?:D1Database;secret?:string;now?:()=>number;client?:string;allow?:(key:string)=>Promise<boolean>;
 testConfig?:{issuer:string;callback:string}};
type Config={issuer:string;callback:string;clientOrigin:string};
const reply=(status:number,value:unknown,extra:Record<string,string>={})=>new Response(value===null?null:JSON.stringify(value),{status,headers:{...HEADERS,...extra}});
const bad=(status:number,error:string)=>reply(status,{error});
const b64=(v:Uint8Array)=>btoa(String.fromCharCode(...v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const opaque=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
export async function celestaoPkce(verifier:string){return b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));}
function config(deps:CelestaoAuthDeps):Config|null{
 if(!deps.testConfig)return {issuer:CELESTAO_ISSUER,callback:CELESTAO_CALLBACK,clientOrigin:'https://celestao.com'};
 try{const i=new URL(deps.testConfig.issuer),c=new URL(deps.testConfig.callback),hosts=new Set(['localhost','127.0.0.1','[::1]']);
  if(i.protocol!=='http:'||c.protocol!=='http:'||!hosts.has(i.hostname)||!hosts.has(c.hostname)||i.origin!==deps.testConfig.issuer||i.username||i.password||c.username||c.password||c.search||c.hash||c.pathname!=='/api/holder/world/callback')return null;
  return {issuer:i.origin,callback:c.href,clientOrigin:c.origin};
 }catch{return null;}
}
const validSecret=(value:unknown):value is string=>typeof value==='string'&&value.length>=32&&value.length<=256&&!/\s/.test(value);
async function backend(request:Request,secret:string){
 const h=request.headers.get('authorization');if(!h||h.length>263||!h.startsWith('Bearer ')||!validSecret(h.slice(7)))return false;
 const [a,b]=await Promise.all([sha256(secret),sha256(h.slice(7))]);let different=0;for(let i=0;i<a.length;i++)different|=a.charCodeAt(i)^b.charCodeAt(i);return different===0;
}
async function body(request:Request,keys:readonly string[]):Promise<Record<string,unknown>|null>{
 if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??'')||Number(request.headers.get('content-length'))>2048||!request.body)return null;
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 for(;;){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>2048){await reader.cancel().catch(()=>{});return null;}chunks.push(r.value);}
 const bytes=new Uint8Array(length);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))?v:null;}catch{return null;}
}
function clock(deps:CelestaoAuthDeps){const n=(deps.now??Date.now)();if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_CLOCK');return n;}
const identity=(address:string,expires_at:number,cfg:Config)=>({issuer:cfg.issuer,audience:'celestao',scope:'fortune:account',address,expires_at});
async function limited(deps:CelestaoAuthDeps,key:string){return await deps.allow!(key)?null:reply(429,{error:'RATE_LIMITED'},{'Retry-After':'60'});}
async function authorize(request:Request,url:URL,deps:CelestaoAuthDeps,cfg:Config,db:D1Database){
 const q:Record<string,string>={},keys=['client_id','redirect_uri','response_type','code_challenge_method','code_challenge','state','lang'];
 for(const [k,v]of url.searchParams){if(!keys.includes(k)||Object.hasOwn(q,k))return bad(400,'BAD_REQUEST');q[k]=v;}
 if(q.client_id!=='celestao'||q.redirect_uri!==cfg.callback||q.response_type!=='code'||q.code_challenge_method!=='S256'||!OPAQUE.test(q.code_challenge??'')||!STATE.test(q.state??'')||!['zh','en'].includes(q.lang??''))return bad(400,'BAD_REQUEST');
 const denied=await limited(deps,'celestao:authorize:'+(deps.client??'unknown'));if(denied)return denied;
 const start=clock(deps),session=await readSession(request,db,start);
 if(typeof session==='string'){
  if(request.headers.get('sec-fetch-mode')==='navigate'&&request.headers.get('accept')?.includes('text/html'))return reply(303,null,{Location:'/fortune-connect/?next='+encodeURIComponent(url.pathname+url.search)+'&lang='+q.lang});
  return bad(401,'AUTH_REQUIRED');
 }
 const code=opaque(),hash=await sha256(code),now=clock(deps);if(now<start)return bad(503,'BRIDGE_UNAVAILABLE');
 const row=await db.prepare(`INSERT INTO celestao_auth_codes(code_hash,source_session_hash,address,code_challenge,redirect_uri,issued_at,expires_at)
  SELECT ?1,token_hash,address,?2,?3,?4,MIN(expires_at,?5) FROM sessions
  WHERE token_hash=?6 AND address=?7 AND revoked_at IS NULL AND expires_at>?4 RETURNING code_hash`)
  .bind(hash,q.code_challenge,cfg.callback,now,now+CELESTAO_CODE_TTL_MS,session.tokenHash,session.address).first();
 if(!row)return bad(401,'AUTH_REQUIRED');
 const target=new URL(cfg.callback);target.searchParams.set('code',code);target.searchParams.set('state',q.state);target.searchParams.set('lang',q.lang);return reply(303,null,{Location:target.href});
}
async function token(request:Request,deps:CelestaoAuthDeps,cfg:Config,db:D1Database){
 const b=await body(request,['grant_type','client_id','redirect_uri','code','code_verifier']);
 if(!b||b.grant_type!=='authorization_code'||b.client_id!=='celestao'||b.redirect_uri!==cfg.callback||typeof b.code!=='string'||!OPAQUE.test(b.code)||typeof b.code_verifier!=='string'||!OPAQUE.test(b.code_verifier))return bad(400,'BAD_REQUEST');
 const denied=await limited(deps,'celestao:token:'+(deps.client??'unknown'));if(denied)return denied;
 const [hash,challenge]=await Promise.all([sha256(b.code),celestaoPkce(b.code_verifier)]),bridge=opaque(),bridgeHash=await sha256(bridge),now=clock(deps);
 const rows=await db.batch([
  db.prepare(`UPDATE celestao_auth_codes SET consumed_at=?1,bridge_hash=?2
   WHERE code_hash=?3 AND consumed_at IS NULL AND issued_at<=?1 AND expires_at>?1 AND code_challenge=?4 AND redirect_uri=?5
   AND EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=source_session_hash AND s.address=celestao_auth_codes.address AND s.revoked_at IS NULL AND s.expires_at>?1) RETURNING address`)
   .bind(now,bridgeHash,hash,challenge,cfg.callback),
  db.prepare(`INSERT INTO celestao_bridge_sessions(bridge_hash,source_session_hash,address,created_at,expires_at)
   SELECT c.bridge_hash,c.source_session_hash,c.address,?1,MIN(s.expires_at,?2) FROM celestao_auth_codes c JOIN sessions s ON s.token_hash=c.source_session_hash AND s.address=c.address
   WHERE c.code_hash=?3 AND c.bridge_hash=?4 AND c.consumed_at=?1 AND s.revoked_at IS NULL AND s.expires_at>?1 RETURNING address,expires_at`)
   .bind(now,now+CELESTAO_SESSION_TTL_MS,hash,bridgeHash)
 ]);
 const row=rows[1]?.results[0] as {address:string;expires_at:number}|undefined;
 if(rows[0]?.results.length!==1||!row)return bad(401,'INVALID_GRANT');return reply(200,{...identity(row.address,row.expires_at,cfg),bridge_session:bridge});
}
async function introspect(request:Request,deps:CelestaoAuthDeps,cfg:Config,db:D1Database){
 const b=await body(request,['client_id','bridge_session']);if(!b||b.client_id!=='celestao'||typeof b.bridge_session!=='string'||!OPAQUE.test(b.bridge_session))return bad(400,'BAD_REQUEST');
 const hash=await sha256(b.bridge_session),denied=await limited(deps,'celestao:session:'+hash.slice(0,32));if(denied)return denied;
 const row=await readCelestaoGrant(db,b.bridge_session,()=>clock(deps));
 return row?reply(200,identity(row.address,row.expires_at,cfg)):bad(401,'AUTH_REQUIRED');
}
export async function readCelestaoGrant(db:D1Database,bridge:string,clock:()=>number){
 if(!OPAQUE.test(bridge))return null;
 const hash=await sha256(bridge),now=clock();if(!Number.isSafeInteger(now)||now<=0)throw Error('INVALID_CLOCK');
 const row=await db.prepare(`SELECT b.address,MIN(b.expires_at,s.expires_at) expires_at FROM celestao_bridge_sessions b JOIN sessions s ON s.token_hash=b.source_session_hash AND s.address=b.address
  WHERE b.bridge_hash=?1 AND b.created_at<=?2 AND b.expires_at>?2 AND s.revoked_at IS NULL AND s.expires_at>?2`).bind(hash,now).first<{address:string;expires_at:number}>();
 const fresh=clock();if(!Number.isSafeInteger(fresh)||fresh<now)throw Error('INVALID_CLOCK');return row&&row.expires_at>fresh?row:null;
}
export async function handleCelestaoAuth(request:Request,deps:CelestaoAuthDeps):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith(CELESTAO_AUTH_PREFIX))return null;if(request.url.length>2048)return bad(400,'BAD_REQUEST');
 const route=url.pathname.slice(CELESTAO_AUTH_PREFIX.length),method=new Map([['authorize','GET'],['token','POST'],['session','POST']]).get(route);
 if(!method)return bad(404,'UNKNOWN_ROUTE');if(request.method!==method)return reply(405,{error:'METHOD_NOT_ALLOWED'},{Allow:method});
 const cfg=config(deps);if(!cfg||!deps.db||!deps.allow||!validSecret(deps.secret))return bad(503,'BRIDGE_UNAVAILABLE');
 const origin=request.headers.get('origin');if(url.origin!==cfg.issuer||origin!==null&&origin!==cfg.issuer&&origin!==cfg.clientOrigin)return bad(403,'ORIGIN_NOT_ALLOWED');
 if(route!=='authorize'&&url.search)return bad(400,'BAD_REQUEST');
 try{if(route==='authorize')return await authorize(request,url,deps,cfg,deps.db);if(!await backend(request,deps.secret))return bad(401,'BRIDGE_CLIENT_REQUIRED');return route==='token'?await token(request,deps,cfg,deps.db):await introspect(request,deps,cfg,deps.db);}catch{return bad(503,'BRIDGE_UNAVAILABLE');}
}
export async function pruneCelestaoAuth(db:D1Database,now:number){
 if(!Number.isSafeInteger(now)||now<0)throw Error('INVALID_CLOCK');
 const [codes,bridges]=await db.batch([
  db.prepare('DELETE FROM celestao_auth_codes WHERE code_hash IN (SELECT code_hash FROM celestao_auth_codes WHERE expires_at<=?1 ORDER BY expires_at LIMIT 200)').bind(now),
  db.prepare('DELETE FROM celestao_bridge_sessions WHERE bridge_hash IN (SELECT bridge_hash FROM celestao_bridge_sessions WHERE expires_at<=?1 ORDER BY expires_at LIMIT 200)').bind(now)
 ]);return {codes:Number(codes.meta.changes??0),bridges:Number(bridges.meta.changes??0)};
}
