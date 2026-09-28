import {getAddress,isAddressEqual,recoverMessageAddress,hashMessage,encodeFunctionData} from 'viem';
import {createSiweMessage,parseSiweMessage,validateSiweMessage} from 'viem/siwe';
import {secp256k1} from '@noble/curves/secp256k1';
import type {D1Database} from './d1.ts';
import type {WaitUntil} from './gateway.ts';
import {API_HEADERS,LimiterMissing} from './world-api.ts';
import {rpc,OwnershipUnavailable,type ChainAccess,type Ownership} from './ownership.ts';
// Wallet sign-in (SIWE, EIP-4361), sessions, and the account routes (DESIGN_W1 §2–§5). The server builds and stores
// the exact message; the client only personal_signs it, so nothing it sends back can change what was signed.
// Routes: POST /api/auth/challenge|verify|logout, GET /api/auth/session, GET /api/me/home, GET /api/wallet/:a/assets.
// Every response carries API_HEADERS (no-store unless stated) and never an Access-Control-* header (same origin only).

// Cold start: noble builds the secp256k1 base-point table on the first recovery; its default window (8) costs ~45 ms,
// which a fresh isolate cannot afford under cpu_ms 50. Window 4 costs 4–6 ms and leaves a warm recovery unchanged.
// This must be the same @noble/curves instance viem uses (tests/auth.test.mjs pins that and the cold time).
secp256k1.ProjectivePoint.BASE._setWindowSize(4);

export const PRODUCTION_ORIGINS:readonly string[]=['https://imdember.com'];
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
export const FLOW_COOKIE='__Host-imd_flow',SESSION_COOKIE='__Host-imd_session';
/** A challenge is accepted this long after issue, and its SIWE Expiration Time says exactly that (the wallet shows it); a
 *  session lives SESSION_TTL_MS from the challenge's issue (absolute, no renewal), which the statement states in words. */
export const CHALLENGE_TTL_MS=5*60_000,SESSION_TTL_MS=7*86_400_000;
export const BODY_LIMIT=2048;
/** Sign-in budgets, counted in D1 (so across every Cloudflare location), on top of AUTH_LIMITER (20/min per IP or IPv6
 *  /64, per location). Availability first: a few networks must never lock ordinary players out of sign-in.
 *   NETWORK_CHALLENGE_BUDGET challenges per NETWORK_WINDOW_MS from one client network (IPv4 /24, IPv6 /48; worker/app.ts
 *     networkKey), the first check, so one network gets a small share and its refused requests read at most that many rows.
 *   CHALLENGE_BUDGET per CHALLENGE_BUDGET_WINDOW_MS across all clients (600/min in 6 s slices, so each count reads at most
 *     60 index entries): the runaway valve. Keeping it closed takes CHALLENGE_BUDGET_NETWORKS networks each spending its
 *     full share every minute; fewer can only close it for the seconds their bursts overlap, and otherwise a refusal lands
 *     only on the networks that spent their share. Real traffic is a few challenges a minute.
 *   ERC1271_NETWORK_SHARE ERC-1271 checks per NETWORK_WINDOW_MS from one network, before the per-location CHAIN_LIMITER
 *     budget (20/min), so one network cannot spend a location's smart-wallet sign-ins alone.
 *  Refusals are 429 SIGN_IN_BUSY (challenge) and 429 CHAIN_BUSY (ERC-1271), both Retry-After 60. The main flood guard is
 *  the owner's planned Cloudflare WAF rate-limiting rule at the edge; these are the backstop behind it.
 *  D1 cost (rows as D1 bills them: every index entry a write changes is one more row written):
 *   challenge: 1 batch. INSERT…SELECT reads at most NETWORK_CHALLENGE_BUDGET + CHALLENGE_BUDGET index entries (≤ 90) and
 *     writes 1 row + 4 index entries (nonce, flow, issued, net) = 5. A browser that brings an earlier flow also supersedes
 *     its open challenges (reads its flow entries, writes 1 per open one, usually 0–1).
 *   verify (ECDSA): 1 SELECT by nonce (1 read); success is 1 batch: the challenge UPDATE (1 row + the flow entry, used_at
 *     is in it = 2) and the session INSERT…SELECT (reads 1, writes 1 row + 4 index entries = 5). A failure writes 1 (burn).
 *   verify (ERC-1271): + the claim (1 write; reads the network's challenges of the last 6 min, ≤ 180) and on failure the burn (1).
 *   So a successful sign-in writes about 12 rows and reads about 5–95; the cron later deletes the challenge (5) and the
 *   expired session (5), and each cron run (96 a day) reads the challenges older than 10 min still kept (used ones, 1 day).
 *  Worst case at the valve, sustained for a whole 30-day month (600/min = 25.9 M challenges), on Workers Paid (50 M rows
 *  written included, then $1.00 per million; 25 bn rows read included, then $0.001 per million): challenges left unused
 *  cost 10 rows written each (issue + prune) = 259 M, about $209/month; if every one became a throwaway ECDSA session, 22
 *  each = 570 M, about $520/month. Reads stay within the included 25 bn: ≤ 91 per accepted challenge (2.4 bn) plus the
 *  cron's reads of a day of used challenges (≤ 864 k per run, 96 runs a day: 2.5 bn); a refused request reads ≤ 90
 *  (20,000 refused a minute all month would add about 78 bn, about $55 past the included reads). Sessions kept at that
 *  rate (8 days) are about 6.9 M rows, about 2 GB (5 GB included). None of this is reachable without
 *  CHALLENGE_BUDGET_NETWORKS /24s at their full share (and 60 IPs at AUTH_LIMITER's rate for the sessions). */
export const NETWORK_CHALLENGE_BUDGET=30,NETWORK_WINDOW_MS=60_000,CHALLENGE_BUDGET=60,CHALLENGE_BUDGET_WINDOW_MS=6_000,ERC1271_NETWORK_SHARE=3;
export const CHALLENGE_BUDGET_NETWORKS=Math.ceil(CHALLENGE_BUDGET*NETWORK_WINDOW_MS/CHALLENGE_BUDGET_WINDOW_MS/NETWORK_CHALLENGE_BUDGET);
/** The challenge row, written only within both budgets: one statement, so the counts and the insert are one atomic step.
 *  ?9/?11 are the window starts; each inner LIMIT caps its scan at its budget; the network count runs first. */
export const INSERT_CHALLENGE=`INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net)
 SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?8 AND issued_at>?9 LIMIT ?10))<?10
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE issued_at>?11 LIMIT ?12))<?12`;
/** A verify that needs ERC-1271 claims its challenge before any keyed read (checked_at: at most one check per challenge,
 *  also when verifies race), only while the challenge's network made fewer than ?6 checks since ?5 (?4 bounds the index
 *  range: a challenge checked since ?5 was issued at most CHALLENGE_TTL_MS before). BURN_UNCLAIMED, in the same batch,
 *  burns it when the share refused, so a busy budget never leaves an open challenge behind. */
export const CLAIM_ERC1271=`UPDATE login_challenges SET checked_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND issued_at>?4 AND checked_at>?5 LIMIT ?6))<?6`;
const BURN_UNCLAIMED='UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL';
export const SIWE_STATEMENT='Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers or transactions.';
/** ERC-6492 wrapped signatures (undeployed smart accounts) end with this magic suffix; they are refused. */
export const ERC6492_SUFFIX='6492'.repeat(16);
/** ERC-1271's answer, ABI-encoded: bytes4 0x1626ba7e as exactly one 32-byte word (SEC-2: a prefix match let an address
 *  that echoes its calldata, like the identity precompile 0x…04, sign in with any signature). */
export const ERC1271_MAGIC_WORD='0x1626ba7e'+'0'.repeat(56);
const ERC1271=[{type:'function',name:'isValidSignature',stateMutability:'view',inputs:[{name:'hash',type:'bytes32'},{name:'signature',type:'bytes'}],outputs:[{name:'',type:'bytes4'}]}] as const;
/** 'auth': sign-in per client IP; 'home': /api/me/home per session (key given); 'chain': the budgets of keyed Alchemy
 *  reads a session from any throwaway key can cause (constant keys, CHAIN_KEYS; per Cloudflare location, not global).
 *  These fail CLOSED; 'api' and 'seat' fail open. */
export type Bucket='auth'|'api'|'seat'|'home'|'chain';
/** The CHAIN_LIMITER keys, one budget each (20/min per Cloudflare location): the ERC-1271 check a sign-in with a
 *  non-ECDSA signature needs (eth_getCode + eth_call; after the network's ERC1271_NETWORK_SHARE), every NFT index read
 *  /api/me/home makes (any throwaway key can sign in, so a session proves nothing about ownership; ownerOf is read only
 *  for candidates IMD's roster or the index named, which a throwaway address has none of), and the public assets
 *  route's character list. */
export const CHAIN_KEYS={erc1271:'chain:erc1271',index:'chain:index',assets:'chain:assets'} as const;
export type AccountDeps={
  /** D1 (absent in the Vite dev server: every auth and /api/me route answers 503 AUTH_UNAVAILABLE). */
  db?:D1Database;now?:()=>number;
  /** Rate-limit check, keyed by the client IP unless `key` is given. 'auth', 'home' and 'chain' fail CLOSED when the check
   *  throws; 'api' and 'seat' fail open like the read API. Logout is never limited (SEC-1: revoking must always work). */
  allow?:(bucket:Bucket,key?:string)=>boolean|Promise<boolean>;
  chain:ChainAccess;ownership:Ownership;waitUntil?:WaitUntil;
  /** The client's network (worker/app.ts networkKey) the D1 sign-in budgets count by; absent: 'net:unknown'. */
  client?:string;
};

/** The request's Origin when it may sign in or write: https://imdember.com, or a loopback http origin when the request
 *  itself was made to a loopback host (local dev), so production can never accept a localhost origin. */
export function allowedOrigin(request:Request):string|null{
  const origin=request.headers.get('origin');
  if(!origin)return null;
  if(PRODUCTION_ORIGINS.includes(origin))return origin;
  try{
    const o=new URL(origin);
    return o.protocol==='http:'&&o.origin===origin&&LOOPBACK.has(o.hostname)&&LOOPBACK.has(new URL(request.url).hostname)?origin:null;
  }catch{return null;}
}
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function sha256(text:string):Promise<string>{return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))));}
export function readCookie(request:Request,name:string):string|null{
  for(const part of (request.headers.get('cookie')??'').split(';')){const at=part.indexOf('=');if(at>0&&part.slice(0,at).trim()===name)return part.slice(at+1).trim();}
  return null;
}
/** __Host- cookies: Secure, Path=/, no Domain. HttpOnly always. */
const setCookie=(name:string,value:string,maxAgeS:number,sameSite:'Strict'|'Lax')=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.max(0,Math.floor(maxAgeS))}`;
const clearFlow=()=>setCookie(FLOW_COOKIE,'',0,'Strict'),clearSession=()=>setCookie(SESSION_COOKIE,'',0,'Lax');
function reply(status:number,body:unknown,cookies:string[]=[],extra:Record<string,string>={}):Response{
  const headers=new Headers({...API_HEADERS,...extra});for(const c of cookies)headers.append('Set-Cookie',c);
  return new Response(body===null?null:JSON.stringify(body),{status,headers});
}
const fail=(status:number,code:string,cookies:string[]=[],extra:Record<string,string>={})=>reply(status,{error:code},cookies,extra);
/** A binding missing from a production deployment (LimiterMissing) is not a refusal: it propagates, and the route
 *  answers 503 LIMITER_UNAVAILABLE for every bucket (S2: a config slip must not leave sign-in unthrottled). */
async function permit(deps:AccountDeps,bucket:Bucket,key?:string):Promise<boolean>{
  if(!deps.allow)return true;
  try{return (await deps.allow(bucket,key))!==false;}catch(e){if(e instanceof LimiterMissing)throw e;return bucket==='api'||bucket==='seat';}
}
/** A JSON object body of at most BODY_LIMIT bytes with Content-Type application/json, else null. Reads no further. */
async function readJson(request:Request):Promise<Record<string,unknown>|null>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return null;
  if(Number(request.headers.get('content-length'))>BODY_LIMIT||!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>BODY_LIMIT){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}
  try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}
}

/** ECDSA first (EOAs, EIP-7702 delegated EOAs; no RPC), then ERC-1271 isValidSignature on mainnet at latest, only for
 *  an address with code (precompiles and plain EOAs have none; a 7702 delegation's 0xef0100… counts) and only when the
 *  answer is exactly the magic word. 'unavailable': ERC-1271 was needed but there is no key or the node could not be read.
 *  Before any keyed read `claim` (absent: 'busy') must answer 'ok'; its 'busy' or 'used' is returned with nothing read. */
export async function verifySignature(message:string,signature:`0x${string}`,address:`0x${string}`,chain:ChainAccess,
  claim?:()=>Promise<'ok'|'busy'|'used'>):Promise<'valid'|'invalid'|'unavailable'|'busy'|'used'>{
  try{if(isAddressEqual(await recoverMessageAddress({message,signature}),address))return 'valid';}catch{/* not an ECDSA signature */}
  const go=claim?await claim():'busy';if(go!=='ok')return go;
  try{
    const code=await rpc(chain,'eth_getCode',[address,'latest']);
    if(code.error!==undefined||typeof code.result!=='string'||!/^0x(?:[\da-fA-F]{2})*$/.test(code.result))return 'unavailable';
    if(code.result.length<=2)return 'invalid';
    const data=encodeFunctionData({abi:ERC1271,functionName:'isValidSignature',args:[hashMessage(message),signature]});
    const {result,error}=await rpc(chain,'eth_call',[{to:address,data},'latest']);
    return error===undefined&&typeof result==='string'&&result.toLowerCase()===ERC1271_MAGIC_WORD?'valid':'invalid';
  }catch(e){if(e instanceof OwnershipUnavailable)return 'unavailable';return 'invalid';}
}
export type Session={address:string;expiresAt:number;tokenHash:string};
/** The live session of this request, or why there is none ('none': no cookie). */
export async function readSession(request:Request,db:D1Database,now:number):Promise<Session|'none'|'AUTH_REQUIRED'|'SESSION_EXPIRED'>{
  const token=readCookie(request,SESSION_COOKIE);
  if(!token)return 'none';
  if(!/^[\w-]{43}$/.test(token))return 'AUTH_REQUIRED';
  const tokenHash=await sha256(token);
  const row=await db.prepare('SELECT address,expires_at,revoked_at FROM sessions WHERE token_hash=?1').bind(tokenHash).first<{address:string;expires_at:number;revoked_at:number|null}>();
  if(!row||row.revoked_at!==null)return 'AUTH_REQUIRED';
  if(row.expires_at<=now)return 'SESSION_EXPIRED';
  return {address:row.address,expiresAt:row.expires_at,tokenHash};
}

type Ctx={request:Request;deps:AccountDeps;db:D1Database;now:number;origin:string};
async function challenge({request,deps,db,now,origin}:Ctx):Promise<Response>{
  const body=await readJson(request),raw=body?.address;
  if(typeof raw!=='string'||!/^0x[\da-fA-F]{40}$/.test(raw))return fail(400,'BAD_REQUEST');
  // The flow value is always new (SEC-4: a value the client brings is never adopted); the one it brings, if any, only
  // names the open challenges this one supersedes, so a late signature for an earlier account is 409.
  const address=getAddress(raw),kept=readCookie(request,FLOW_COOKIE),flow=hex(random(16));
  const flowHash=await sha256(flow),nonce=hex(random(16)),acceptUntil=now+CHALLENGE_TTL_MS;
  const message=createSiweMessage({domain:new URL(origin).host,address,statement:SIWE_STATEMENT,uri:origin+'/',version:'1',chainId:1,
    nonce,issuedAt:new Date(now),expirationTime:new Date(acceptUntil)});
  // The earlier challenges of this flow are superseded only when this one was written (a refused request changes nothing).
  const [insert]=await db.batch([
    db.prepare(INSERT_CHALLENGE).bind(nonce,address.toLowerCase(),origin,flowHash,message,now,acceptUntil,deps.client??'net:unknown',
      now-NETWORK_WINDOW_MS,NETWORK_CHALLENGE_BUDGET,now-CHALLENGE_BUDGET_WINDOW_MS,CHALLENGE_BUDGET),
    ...kept&&/^[\da-f]{32}$/.test(kept)?[db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL AND EXISTS(SELECT 1 FROM login_challenges WHERE nonce=?3)')
      .bind(now,await sha256(kept),nonce)]:[]]);
  if(insert.meta.changes!==1)return fail(429,'SIGN_IN_BUSY',[],{'Retry-After':'60'});
  return reply(200,{nonce,message,acceptUntil},[setCookie(FLOW_COOKIE,flow,CHALLENGE_TTL_MS/1000,'Strict')]);
}
async function verify({request,deps,db,now,origin}:Ctx):Promise<Response>{
  const body=await readJson(request),nonce=body?.nonce,signature=body?.signature;
  if(typeof nonce!=='string'||!/^[\da-f]{32}$/.test(nonce)||typeof signature!=='string'||!/^0x(?:[\da-fA-F]{2})+$/.test(signature))return fail(400,'BAD_REQUEST');
  const row=await db.prepare('SELECT * FROM login_challenges WHERE nonce=?1').bind(nonce).first<{nonce:string;address:string;origin:string;flow_hash:string;message:string;
    issued_at:number;accept_until:number;used_at:number|null;invalidated_at:number|null;net:string|null}>();
  if(!row)return fail(409,'CHALLENGE_USED');
  const flow=readCookie(request,FLOW_COOKIE);
  if(!flow||await sha256(flow)!==row.flow_hash||row.origin!==origin)return fail(403,'FLOW_MISMATCH');
  if(row.used_at!==null||row.invalidated_at!==null)return fail(409,'CHALLENGE_USED');
  if(now>=row.accept_until)return fail(410,'CHALLENGE_EXPIRED');
  // From here only the browser holding this challenge's flow cookie gets an answer, and every failed check burns the
  // challenge (one write): a bad signature cannot be retried against it. The ERC-1271 path claims it first (CLAIM_ERC1271),
  // so one challenge buys at most one keyed check even when verifies race or a burn fails, and a refused budget (429
  // CHAIN_BUSY, nothing read) burns it too: the client always starts a fresh challenge, so nobody could use an open one.
  const burn=async(status:number,code:string,extra:Record<string,string>={})=>{
    await db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,nonce).run();
    return fail(status,code,[],extra);};
  if(signature.toLowerCase().endsWith(ERC6492_SUFFIX))return burn(400,'UNSUPPORTED_SIGNATURE');
  // The stored text is re-read as SIWE and checked against the row (domain, URI, chain, nonce, address, and its Issued
  // At / Expiration Time against issued_at / accept_until, so the message never claims a longer life than is accepted).
  const address=getAddress(row.address),parsed=parseSiweMessage(row.message);
  if(!validateSiweMessage({message:parsed,address,domain:new URL(row.origin).host,nonce:row.nonce,time:new Date(now)})||
    parsed.uri!==row.origin+'/'||parsed.chainId!==1||parsed.version!=='1'||parsed.statement!==SIWE_STATEMENT||
    parsed.issuedAt?.getTime()!==row.issued_at||parsed.expirationTime?.getTime()!==row.accept_until)return burn(401,'SIGNATURE_INVALID');
  const claim=async()=>{
    const [claimed,burnt]=await db.batch([db.prepare(CLAIM_ERC1271).bind(now,nonce,row.net,now-NETWORK_WINDOW_MS-CHALLENGE_TTL_MS,now-NETWORK_WINDOW_MS,ERC1271_NETWORK_SHARE),
      db.prepare(BURN_UNCLAIMED).bind(now,nonce)]);
    if(claimed.meta.changes!==1)return burnt.meta.changes===1?'busy' as const:'used' as const;
    return await permit(deps,'chain',CHAIN_KEYS.erc1271)?'ok' as const:'busy' as const;
  };
  const check=await verifySignature(row.message,signature as `0x${string}`,address,deps.chain,claim);
  if(check==='used')return fail(409,'CHALLENGE_USED');
  if(check==='busy')return burn(429,'CHAIN_BUSY',{'Retry-After':'60'});
  if(check==='unavailable')return burn(503,'VERIFY_UNAVAILABLE');
  if(check==='invalid')return burn(401,'SIGNATURE_INVALID');
  // Atomic consume: the session row exists only if this transaction took the challenge; concurrent verifies of one
  // signature all pass the checks above, but only one UPDATE matches (sessions.nonce UNIQUE is the second lock). The
  // clock is read again: an ERC-1271 check can take seconds, and a challenge that expired meanwhile is not consumed.
  const at=(deps.now??Date.now)(),token=base64url(random(32)),hash=await sha256(token),expiresAt=row.issued_at+SESSION_TTL_MS;
  let taken=false;
  try{
    const [, insert]=await db.batch([
      db.prepare('UPDATE login_challenges SET used_at=?1,session_hash=?2 WHERE nonce=?3 AND used_at IS NULL AND invalidated_at IS NULL AND accept_until>?1').bind(at,hash,nonce),
      db.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) SELECT session_hash,address,1,?1,?2,nonce FROM login_challenges WHERE nonce=?3 AND session_hash=?4')
        .bind(at,expiresAt,nonce,hash)]);
    taken=insert.meta.changes===1;
  }catch{taken=false;}
  if(!taken)return fail(409,'CHALLENGE_USED');
  return reply(200,{address,expiresAt},[setCookie(SESSION_COOKIE,token,(expiresAt-at)/1000,'Lax'),clearFlow()]);
}
async function session({request,db,now}:Omit<Ctx,'origin'>):Promise<Response>{
  const s=await readSession(request,db,now);
  if(s==='none')return reply(200,{signedIn:false});
  if(typeof s==='string')return reply(200,{signedIn:false},[clearSession()]);
  return reply(200,{signedIn:true,address:getAddress(s.address),expiresAt:s.expiresAt});
}
/** Revokes the session server-side and every open challenge of this browser flow; idempotent. */
async function logout({request,db,now}:Ctx):Promise<Response>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return fail(400,'BAD_REQUEST');
  const token=readCookie(request,SESSION_COOKIE),flow=readCookie(request,FLOW_COOKIE),writes=[];
  if(token)writes.push(db.prepare('UPDATE sessions SET revoked_at=?1 WHERE token_hash=?2 AND revoked_at IS NULL').bind(now,await sha256(token)));
  if(flow)writes.push(db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,await sha256(flow)));
  if(writes.length)await db.batch(writes);
  return reply(204,null,[clearSession(),clearFlow()]);
}

export const ACCOUNT_PREFIXES:readonly string[]=['/api/auth/','/api/me/','/api/wallet/'];
const ASSETS_ROUTE=/^\/api\/wallet\/(0x[\da-fA-F]{40})\/assets$/;
const POSTS:Record<string,(ctx:Ctx)=>Promise<Response>>={'/api/auth/challenge':challenge,'/api/auth/verify':verify,'/api/auth/logout':logout};
/** Returns null when the path is not an account route (the caller continues with the read API or static assets). */
export async function handleAccountApi(request:Request,deps:AccountDeps):Promise<Response|null>{
  const {pathname}=new URL(request.url);
  if(!ACCOUNT_PREFIXES.some(p=>pathname.startsWith(p)))return null;
  const now=(deps.now??Date.now)(),db=deps.db;
  try{
    const post=POSTS[pathname];
    if(post){
      if(request.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED',[],{Allow:'POST'});
      if(!db)return fail(503,'AUTH_UNAVAILABLE');
      const origin=allowedOrigin(request);
      if(!origin)return fail(403,'ORIGIN_NOT_ALLOWED');
      // Logout is never limited: it only ever revokes, and a limiter that others can drain must not keep a session alive.
      if(post!==logout&&!await permit(deps,'auth'))return fail(429,'RATE_LIMITED',[],{'Retry-After':'60'});
      return await post({request,deps,db,now,origin});
    }
    const assets=ASSETS_ROUTE.exec(pathname);
    if(pathname!=='/api/auth/session'&&pathname!=='/api/me/home'&&!assets)return fail(404,'UNKNOWN_ROUTE');
    if(request.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED',[],{Allow:'GET'});
    if(assets){
      if(!await permit(deps,'api')||!await permit(deps,'seat'))return fail(429,'RATE_LIMITED',[],{'Retry-After':'60'});
      const budget=()=>permit(deps,'chain',CHAIN_KEYS.assets);
      try{return reply(200,await deps.ownership.assets(assets[1],{chain:deps.chain,db,now,waitUntil:deps.waitUntil,budget}),[],{'Cache-Control':'public, max-age=300'});}
      catch(e){if(e instanceof LimiterMissing)throw e;return fail(503,'OWNERSHIP_UNAVAILABLE');}
    }
    if(!db)return fail(503,'AUTH_UNAVAILABLE');
    if(pathname==='/api/auth/session'){
      if(!await permit(deps,'api'))return fail(429,'RATE_LIMITED',[],{'Retry-After':'60'});
      return await session({request,deps,db,now});
    }
    // /api/me/home: the session first, so anonymous or cross-site reads (which carry no Lax cookie) spend only the
    // fail-open read bucket and never the sign-in bucket; a session's re-checks are limited per session, not per IP.
    if(!await permit(deps,'api'))return fail(429,'RATE_LIMITED',[],{'Retry-After':'60'});
    const s=await readSession(request,db,now);
    if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s,s==='none'?[]:[clearSession()]);
    if(!await permit(deps,'home','session:'+s.tokenHash.slice(0,32)))return fail(429,'RATE_LIMITED',[],{'Retry-After':'60'});
    const fresh=new URL(request.url).searchParams.get('fresh')==='1',budget=()=>permit(deps,'chain',CHAIN_KEYS.index);
    try{return reply(200,await deps.ownership.home(s.address,{chain:deps.chain,db,now,waitUntil:deps.waitUntil,budget},fresh));}
    catch(e){if(e instanceof LimiterMissing)throw e;return fail(503,'OWNERSHIP_UNAVAILABLE');}
  }catch(e){return fail(503,e instanceof LimiterMissing?'LIMITER_UNAVAILABLE':'AUTH_UNAVAILABLE');}
}
