import {getAddress,isAddressEqual,recoverMessageAddress,hashMessage,encodeFunctionData} from 'viem';
import {createSiweMessage,parseSiweMessage,validateSiweMessage} from 'viem/siwe';
import {secp256k1} from '@noble/curves/secp256k1';
import type {D1Database} from './d1.ts';
import type {WaitUntil} from './gateway.ts';
import {API_HEADERS,LimiterMissing} from './world-api.ts';
import {rpc,OwnershipUnavailable,type ChainAccess,type Ownership} from './ownership.ts';
import {SIWE_STATEMENT} from '../src/world/siwe.ts';
// Wallet sign-in (SIWE, EIP-4361), sessions, and the account routes (DESIGN_W1 §2–§5). The server builds and stores
// the exact message; the page checks it line for line before the wallet sees it (src/world/siwe.ts, F-7a) and then only
// personal_signs it, so nothing it sends back can change what was signed.
// Routes: POST /api/auth/challenge|verify|logout|logout-all, GET /api/auth/session, GET /api/me/home, GET /api/wallet/:a/assets.
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
/** Sign-in limits in layers (review F-5, 2026-09-29), each a share of the one below it, so no single place can close
 *  sign-in for everyone; availability first: a few networks must never lock ordinary players out of sign-in.
 *   L1 per network: NETWORK_CHALLENGE_BUDGET challenges and the ERC-1271 shares below per /24 (IPv6 /48).
 *   L2 per wallet: WALLET_CHALLENGE_BUDGET challenges per NETWORK_WINDOW_MS for one address from one network (a short
 *     cooldown; per (address, network), so nobody elsewhere can use it to lock the key holder out). One address asked
 *     for from many networks is not blocked: from the ADDRESS_SURGE-th challenge for it within a minute on, each writes
 *     an audit line (Workers Logs keep a 0.2 sample of invocations, so a surge must not rest on one line).
 *   L3 per challenge: a one-time nonce, burnt on any failed check, and at most one ERC-1271 check (the claim).
 *   L4 per location (Cloudflare rate-limit bindings, worker/app.ts): AUTH_LIMITER 20/min per IP (IPv6 /64) for
 *     challenges and, under separate 'verify:' keys, 20/min per IP for verifies, so a challenge flood from one place never
 *     starves its own or anyone's verify; CHAIN_LIMITER and 'chain:code' for the ERC-1271 path.
 *   L5 global: CHALLENGE_BUDGET per CHALLENGE_BUDGET_WINDOW_MS, the emergency ceiling only (600/min; real traffic is a few
 *     a minute), asked last.
 *  Every 429/503 of these routes, and every challenge of a surge, writes one JSON line (handleAccountApi: evt, route, reason, colo, net,
 *  walletType when known; never an IP, address, cookie, token, signature or message).
 *   NETWORK_CHALLENGE_BUDGET challenges per NETWORK_WINDOW_MS from one client network (IPv4 /24, IPv6 /48; worker/app.ts
 *     networkKey), the first check, so one network gets a small share and its refused requests read at most that many rows.
 *   CHALLENGE_BUDGET per CHALLENGE_BUDGET_WINDOW_MS across all clients (600/min in 6 s slices, so each count reads at most
 *     60 index entries): the runaway valve. Keeping it closed takes CHALLENGE_BUDGET_NETWORKS networks each spending its
 *     full share every minute; fewer can only close it for the seconds their bursts overlap, and otherwise a refusal lands
 *     only on the networks that spent their share. Real traffic is a few challenges a minute.
 *   The ERC-1271 path (a signature ECDSA cannot prove; verifySignature), each step before the keyed read it pays for, one
 *   check per challenge (the claim), any refusal 429 CHAIN_BUSY and the challenge burnt:
 *   - ERC1271_CODE_SHARE claims per NETWORK_WINDOW_MS from one network, each at most one eth_getCode, and then
 *     'chain:code' (CODE_CAP per minute per Cloudflare location, the API_LIMITER namespace, fails closed; a missing
 *     binding is 503): the cheap read that tells an EOA from a contract. "No code" is 401 and cached per address for
 *     NO_CODE_TTL_MS, and never reaches the two steps below, so garbage for EOAs or made-up addresses costs nothing there.
 *   - ERC1271_NETWORK_SHARE contract checks per minute from one network and ERC1271_ADDRESS_SHARE per contract address
 *     (all networks; CLAIM_CONTRACT), then the per-location CHAIN_LIMITER key: 'chain:erc1271:known' for an address that
 *     already signed in by ERC-1271 (a session of it is still kept: up to 8 days; it skips the code read and its share,
 *     since it had code), else 'chain:erc1271'. Then one eth_call.
 *   What that buys, per Cloudflare location (review F-3 and round-1 R-3, 2026-09-29): closing first-time smart-wallet
 *   sign-in through 'chain:erc1271' (20/min) takes >= 7 /24s at their full contract share aimed at >= 10 distinct contract
 *   addresses (before: 7 /24s, any one address). Garbage aimed at one address slows only that address: 2 checks a minute,
 *   from anywhere, hold that one contract at 429 while it lasts (accepted: ECDSA and every other wallet are untouched;
 *   the refusal is logged with reason 'address'). Returning smart wallets have a budget of their own: closing
 *   'chain:erc1271:known' takes >= 7 /24s aimed at >= 10 addresses that signed in here by ERC-1271 in the last 8 days.
 *   Those can be the attacker's own: a contract that accepts any signature (F-2) costs its gas and one first-time
 *   sign-in, and stays "known" for 8 days; the quantity of /24s and the limits above still apply.
 *   Closing 'chain:code' (180/min) takes >= 18 /24s of garbage and delays only first-time smart wallets. One /24's own
 *   garbage leaves its neighbours in it: garbage for EOAs spends only its 10 code reads, garbage at one contract only 2 of
 *   its 3 contract checks. Alchemy cost stays bounded: eth_getCode <= 10/min per /24, <= 180/min per location and never
 *   more than the challenge valve (600/min in all); eth_call <= 3/min per /24, <= 2/min per contract address and <= 40/min
 *   per location (both keys).
 *  Refusals are 429 SIGN_IN_BUSY (challenge) and 429 CHAIN_BUSY (ERC-1271), both Retry-After 60. The first flood guard is
 *  the zone's Cloudflare WAF rate-limiting rule "IMD API anti-flood" (URI path starts with /api/, 20 per 10 s per IP; set in
 *  the dashboard, not in this repository); these are the backstop behind it.
 *  D1 cost (rows as D1 bills them: every index entry a write changes is one more row written):
 *   challenge: 1 batch. INSERT…SELECT reads at most NETWORK_CHALLENGE_BUDGET + WALLET_CHALLENGE_BUDGET + CHALLENGE_BUDGET
 *     index entries (≤ 95; the wallet count scans the address's challenges of the last minute, so while one address is
 *     asked for from many networks, which the surge line reports, it reads that many) and writes 1 row + 5 index entries
 *     (nonce, flow, issued, net, address) = 6; the surge count reads ≤ 21. A refusal also reads ≤ 35 to name its reason. A
 *     browser that brings an earlier flow also supersedes its open challenges (reads its flow entries, writes 1 per open
 *     one, usually 0–1).
 *   verify (ECDSA): 1 SELECT by nonce (1 read); success is 1 batch: the challenge UPDATE (1 row + the flow entry, used_at
 *     is in it = 2) and the session INSERT…SELECT (reads 1, writes 1 row + 5 index entries = 6: token_hash, nonce, address,
 *     expires, live; an ERC-1271 session + sessions_erc1271 = 7). A failure writes 1 (burn).
 *   verify (ERC-1271): + at most 1 read (KNOWN_ERC1271: the partial index sessions_erc1271 holds only ERC-1271 sessions,
 *     so an address's ECDSA sessions, however many, are never read), the claim (1 write;
 *     reads the network's challenges of the last 6 min, ≤ 180), for a contract CLAIM_CONTRACT (1 row + up to 2 partial
 *     index entries = 3; reads ≤ 5), and on failure the burn (1).
 *   So a successful sign-in writes about 13 rows and reads about 5–95; the cron later deletes the challenge (5) and the
 *   expired session (6; 5 if it was revoked), and each cron run (96 a day) reads the challenges older than 10 min still kept (used ones, 1 day).
 *  Worst case at the valve, sustained for a whole 30-day month (600/min = 25.9 M challenges), on Workers Paid (50 M rows
 *  written included, then $1.00 per million; 25 bn rows read included, then $0.001 per million): challenges left unused
 *  cost 12 rows written each (issue + prune) = 311 M, about $261/month; if every one became a throwaway ECDSA session, 26
 *  each = 673 M, about $623/month. Revoking a session writes 1 row + 1 index entry (it leaves sessions_live). Reads stay within the included 25 bn: ≤ 117 per accepted challenge (3.0 bn) plus the
 *  cron's reads of a day of used challenges (≤ 864 k per run, 96 runs a day: 2.5 bn); a refused request reads ≤ 151
 *  (20,000 refused a minute all month would add about 130 bn, about $105 past the included reads). Sessions kept at that
 *  rate (8 days) are about 6.9 M rows, about 2 GB (5 GB included). None of this is reachable without
 *  CHALLENGE_BUDGET_NETWORKS /24s at their full share (and 60 IPs at AUTH_LIMITER's rate for the sessions). */
export const NETWORK_CHALLENGE_BUDGET=30,NETWORK_WINDOW_MS=60_000,CHALLENGE_BUDGET=60,CHALLENGE_BUDGET_WINDOW_MS=6_000;
export const WALLET_CHALLENGE_BUDGET=5,ADDRESS_SURGE=20;
export const ERC1271_CODE_SHARE=10,ERC1271_NETWORK_SHARE=3,ERC1271_ADDRESS_SHARE=2,CODE_CAP=180;
export const CHALLENGE_BUDGET_NETWORKS=Math.ceil(CHALLENGE_BUDGET*NETWORK_WINDOW_MS/CHALLENGE_BUDGET_WINDOW_MS/NETWORK_CHALLENGE_BUDGET);
/** The challenge row, written only within all three budgets: one statement, so the counts and the insert are one atomic
 *  step. ?9/?11 are the window starts; each inner LIMIT caps its matches at its budget; in order network (L1), wallet
 *  (L2: this address from this network, ?13), global (L5). */
export const INSERT_CHALLENGE=`INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net)
 SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?8 AND issued_at>?9 LIMIT ?10))<?10
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE address=?2 AND issued_at>?9 AND net=?8 LIMIT ?13))<?13
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE issued_at>?11 LIMIT ?12))<?12`;
/** After a refusal: was it the network (L1) or the wallet (L2)? Otherwise the global ceiling (L5). For the log line only. */
const REFUSAL_REASON=`SELECT (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?1 AND issued_at>?2 LIMIT ?3))>=?3 net,
 (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE address=?4 AND issued_at>?2 AND net=?1 LIMIT ?5))>=?5 wallet`;
/** How many challenges this address got in the last minute, from any network (at most ?3). */
const ADDRESS_COUNT='SELECT count(*) n FROM (SELECT 1 FROM login_challenges WHERE address=?1 AND issued_at>?2 LIMIT ?3)';
/** A verify that needs ERC-1271 claims its challenge before any keyed read (checked_at: at most one check per challenge,
 *  also when verifies race), only while the challenge's network made fewer than ?6 claims since ?5 (?4 bounds the index
 *  range: a challenge checked since ?5 was issued at most CHALLENGE_TTL_MS before), unless ?7 is 1 (a known smart wallet,
 *  which makes no code read). BURN_UNCLAIMED, in the same batch, burns it when the share refused, so a busy budget never
 *  leaves an open challenge behind. */
export const CLAIM_ERC1271=`UPDATE login_challenges SET checked_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL
 AND (?7=1 OR (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND issued_at>?4 AND checked_at>?5 LIMIT ?6))<?6)`;
/** A claimed challenge whose address has code (or is a known smart wallet) takes one contract check (called_at), only
 *  while its network made fewer than ?5 and its address fewer than ?7 since ?4 (partial indexes on called_at,
 *  migrations/0003, so each count reads at most its share). */
export const CLAIM_CONTRACT=`UPDATE login_challenges SET called_at=?1 WHERE nonce=?2 AND called_at IS NULL
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 LIMIT ?5))<?5
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE address=?6 AND called_at>?4 LIMIT ?7))<?7`;
/** After CLAIM_CONTRACT refused: was it the address's share? (Else the network's.) For the log line only. */
const ADDRESS_CONTRACT_CHECKS='SELECT count(*) n FROM (SELECT 1 FROM login_challenges WHERE address=?1 AND called_at>?2 LIMIT ?3)';
/** Is this address a known smart wallet (an ERC-1271 session of it is kept)? sessions_erc1271 (migrations/0003) is a
 *  partial index of ERC-1271 sessions only, so this reads at most one entry and never the address's ECDSA sessions (SR2-1:
 *  through sessions_address it visited every session of the address, once per racing verify). */
export const KNOWN_ERC1271="SELECT 1 k FROM sessions WHERE address=?1 AND verification_method='ERC1271' LIMIT 1";
/** logout-all's revocation: sessions_live (address, expires_at WHERE revoked_at IS NULL) holds only live sessions, so
 *  sessions already revoked are never visited. */
export const REVOKE_ALL_SESSIONS='UPDATE sessions SET revoked_at=?1 WHERE address=?2 AND revoked_at IS NULL AND expires_at>?1';
const BURN_UNCLAIMED='UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL';
/** The statement lives with the page's own message check (src/world/siwe.ts), so both read one text. New challenges
 *  always carry SIWE_STATEMENT; verify also accepts a stored challenge written with an earlier wording, because the server
 *  verifies the message it stored, and one issued by the build before a deploy is still open for up to CHALLENGE_TTL_MS.
 *  Drop an entry once a release has been live longer than that. */
export {SIWE_STATEMENT};
export const SIWE_PREVIOUS_STATEMENTS:readonly string[]=['Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers or transactions.'];
/** ERC-6492 wrapped signatures (undeployed smart accounts) end with this magic suffix; they are refused. */
export const ERC6492_SUFFIX='6492'.repeat(16);
/** ERC-1271's answer, ABI-encoded: bytes4 0x1626ba7e as exactly one 32-byte word (SEC-2: a prefix match let an address
 *  that echoes its calldata, like the identity precompile 0x…04, sign in with any signature). */
export const ERC1271_MAGIC_WORD='0x1626ba7e'+'0'.repeat(56);
const ERC1271=[{type:'function',name:'isValidSignature',stateMutability:'view',inputs:[{name:'hash',type:'bytes32'},{name:'signature',type:'bytes'}],outputs:[{name:'',type:'bytes4'}]}] as const;
/** 'auth': challenges per client IP; 'verify': verifies per client IP (the same binding, other keys); 'home': /api/me/home per session (key given); 'chain': the budgets of keyed Alchemy
 *  reads a session from any throwaway key can cause (constant keys, CHAIN_KEYS; per Cloudflare location, not global);
 *  'code': the ERC-1271 path's eth_getCode cap (CODE_CAP, CHAIN_KEYS.code, in the API_LIMITER namespace). These fail
 *  CLOSED; 'api' and 'seat' fail open. */
export type Bucket='auth'|'verify'|'api'|'seat'|'home'|'chain'|'code';
/** The CHAIN_LIMITER keys, one budget each (20/min per Cloudflare location): the ERC-1271 eth_call a sign-in with a
 *  non-ECDSA signature needs for an address that has code (erc1271) or already signed in that way (erc1271Known), every
 *  NFT index read /api/me/home makes (any throwaway key can sign in, so a session proves nothing about ownership; ownerOf
 *  is read only for candidates IMD's roster or the index named, which a throwaway address has none of), and the public
 *  assets route's character list. `code` is the 'code' bucket's key (API_LIMITER namespace, CODE_CAP). */
export const CHAIN_KEYS={erc1271:'chain:erc1271',erc1271Known:'chain:erc1271:known',index:'chain:index',assets:'chain:assets',code:'chain:code'} as const;
export type AccountDeps={
  /** D1 (absent in the Vite dev server: every auth and /api/me route answers 503 AUTH_UNAVAILABLE). */
  db?:D1Database;now?:()=>number;
  /** Rate-limit check, keyed by the client IP unless `key` is given. 'auth', 'home' and 'chain' fail CLOSED when the check
   *  throws; 'api' and 'seat' fail open like the read API. Logout is never limited (SEC-1: revoking must always work). */
  allow?:(bucket:Bucket,key?:string)=>boolean|Promise<boolean>;
  chain:ChainAccess;ownership:Ownership;waitUntil?:WaitUntil;
  /** The client's network (worker/app.ts networkKey) the D1 sign-in budgets count by; absent: 'net:unknown'. */
  client?:string;
  /** This isolate's "no code here" answers (verifySignature); absent: none are kept. */
  noCode?:NoCodeCache;
  /** The Cloudflare location (request.cf.colo) for the log lines, and where they go (default console.log). */
  colo?:string;log?:(line:string)=>void;
};
/** What a refusal was about, for its log line (handleAccountApi); kept beside the Response, never sent. */
type Note={reason:string;walletType?:'EOA'|'CONTRACT'};
const NOTES=new WeakMap<Response,Note>();
const noted=(r:Response,note:Note)=>{NOTES.set(r,note);return r;};

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

/** Addresses whose eth_getCode just answered "no code" (lowercase → until, ms), per isolate (createWorker makes one). A
 *  garbage signature for such an address is 401 with no D1 claim and no keyed read (F-3). NO_CODE_TTL_MS keeps it brief:
 *  an address that gains code meanwhile (a 7702 delegation, a counterfactual account deployed) waits at most that long. */
export type NoCodeCache=Map<string,number>;
export const NO_CODE_TTL_MS=60_000,NO_CODE_CACHE_MAX=4096;
export type SignatureGate={
  /** Did this address already sign in by ERC-1271 (a session of it is kept)? Then it had code: no code read is made. */
  known:()=>Promise<boolean>;
  /** The claim (CLAIM_ERC1271): one check per challenge, and the network's code share unless known; before any read. */
  share:(known:boolean)=>Promise<'ok'|'busy'|'used'>;
  /** The per-location 'chain:code' cap, asked before eth_getCode (not for a known address). */
  code:()=>Promise<boolean>;
  /** The contract check (CLAIM_CONTRACT): the network's and the address's shares, for an address with code. */
  contract:()=>Promise<boolean>;
  /** The per-location chain:erc1271 budget (known: chain:erc1271:known), asked last, before eth_call. */
  budget:(known:boolean)=>Promise<boolean>;noCode?:NoCodeCache;now:number};
/** How a signature was proven (F-2), kept on the session for audit and debugging only: 'ECDSA' is the address's own key
 *  (wallet_type 'EOA'; an EIP-7702 delegated EOA signs this way too, and no chain read is made), 'ERC1271' the contract at
 *  the address answered the magic word (wallet_type 'CONTRACT'). Ownership is always ownerOf, never this. */
export type Verification='ECDSA'|'ERC1271';
export const WALLET_TYPES:Readonly<Record<Verification,'EOA'|'CONTRACT'>>={ECDSA:'EOA',ERC1271:'CONTRACT'};
/** ECDSA first (EOAs, EIP-7702 delegated EOAs; no RPC), then ERC-1271 isValidSignature on mainnet at latest, only for
 *  an address with code (precompiles and plain EOAs have none; a 7702 delegation's 0xef0100… counts) or one that already
 *  signed in that way (it had code; if it has none now, eth_call answers 0x and that is 401), and only when the
 *  answer is exactly the magic word. 'unavailable': ERC-1271 was needed but there is no key or the node could not be read.
 *  Fail closed (F-2): no key, a node error, a refused or broken budget, or a missing binding is never a sign-in, and the
 *  address alone is never trusted: only 'ECDSA' or 'ERC1271' make a session.
 *  F-3 (swarm review 4bd31cfb): in order, a cached "no code" is 401 at once (absent gate: 'busy'); the claim (one check
 *  per challenge); for an address not known, 'chain:code' then eth_getCode, and no code is 401 (cached); the contract
 *  shares; the location budget; eth_call. Numbers: the NETWORK_CHALLENGE_BUDGET comment. */
export async function verifySignature(message:string,signature:`0x${string}`,address:`0x${string}`,chain:ChainAccess,
  gate?:SignatureGate):Promise<Verification|'invalid'|'unavailable'|'busy'|'used'>{
  try{if(isAddressEqual(await recoverMessageAddress({message,signature}),address))return 'ECDSA';}catch{/* not an ECDSA signature */}
  if(!gate)return 'busy';
  const key=address.toLowerCase(),cache=gate.noCode;
  if((cache?.get(key)??-Infinity)>gate.now)return 'invalid';
  const known=await gate.known(),go=await gate.share(known);if(go!=='ok')return go;
  if(!known){
    if(!await gate.code())return 'busy';                                             // LimiterMissing propagates (503)
    try{
      const code=await rpc(chain,'eth_getCode',[address,'latest']);
      if(code.error!==undefined||typeof code.result!=='string'||!/^0x(?:[\da-fA-F]{2})*$/.test(code.result))return 'unavailable';
      if(code.result.length<=2){
        if(cache){cache.delete(key);if(cache.size>=NO_CODE_CACHE_MAX)cache.delete(cache.keys().next().value!);cache.set(key,gate.now+NO_CODE_TTL_MS);}
        return 'invalid';}
    }catch(e){if(e instanceof OwnershipUnavailable)return 'unavailable';return 'invalid';}
  }
  if(!await gate.contract()||!await gate.budget(known))return 'busy';                // LimiterMissing propagates (503)
  try{
    const data=encodeFunctionData({abi:ERC1271,functionName:'isValidSignature',args:[hashMessage(message),signature]});
    const {result,error}=await rpc(chain,'eth_call',[{to:address,data},'latest']);
    return error===undefined&&typeof result==='string'&&result.toLowerCase()===ERC1271_MAGIC_WORD?'ERC1271':'invalid';
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
  const net=deps.client??'net:unknown',lower=address.toLowerCase();
  const [insert,surge]=await db.batch([
    db.prepare(INSERT_CHALLENGE).bind(nonce,lower,origin,flowHash,message,now,acceptUntil,net,
      now-NETWORK_WINDOW_MS,NETWORK_CHALLENGE_BUDGET,now-CHALLENGE_BUDGET_WINDOW_MS,CHALLENGE_BUDGET,WALLET_CHALLENGE_BUDGET),
    db.prepare(ADDRESS_COUNT).bind(lower,now-NETWORK_WINDOW_MS,ADDRESS_SURGE+1),
    ...kept&&/^[\da-f]{32}$/.test(kept)?[db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL AND EXISTS(SELECT 1 FROM login_challenges WHERE nonce=?3)')
      .bind(now,await sha256(kept),nonce)]:[]]);
  if(insert.meta.changes!==1){
    const why=await db.prepare(REFUSAL_REASON).bind(net,now-NETWORK_WINDOW_MS,NETWORK_CHALLENGE_BUDGET,lower,WALLET_CHALLENGE_BUDGET).first<{net:number;wallet:number}>();
    return noted(fail(429,'SIGN_IN_BUSY',[],{'Retry-After':'60'}),{reason:why?.net?'network':why?.wallet?'wallet':'global'});
  }
  // One address asked for from many networks (a key holder cannot be locked out from elsewhere, so this is only logged):
  // every challenge from the ADDRESS_SURGE-th on writes a line (the count reads at most ADDRESS_SURGE+1 entries).
  if(Number((surge.results[0] as {n?:number}|undefined)?.n)>=ADDRESS_SURGE)audit(deps,{evt:'auth_surge',route:'/api/auth/challenge',reason:'address_surge',addr:lower.slice(0,6)});
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
  // so one challenge buys at most one keyed check even when verifies race or a burn fails, and a refused share or
  // chain:erc1271 budget (429 CHAIN_BUSY; at most the one eth_getCode read) burns it too: the client always starts a fresh challenge, so nobody could use an open one.
  const why:Note={reason:''};
  const burn=async(status:number,code:string,extra:Record<string,string>={})=>{
    await db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,nonce).run();
    return noted(fail(status,code,[],extra),why);};
  if(signature.toLowerCase().endsWith(ERC6492_SUFFIX))return burn(400,'UNSUPPORTED_SIGNATURE');
  // The stored text is re-read as SIWE and checked against the row (domain, URI, chain, nonce, address, and its Issued
  // At / Expiration Time against issued_at / accept_until, so the message never claims a longer life than is accepted).
  const address=getAddress(row.address),parsed=parseSiweMessage(row.message);
  if(!validateSiweMessage({message:parsed,address,domain:new URL(row.origin).host,nonce:row.nonce,time:new Date(now)})||
    parsed.uri!==row.origin+'/'||parsed.chainId!==1||parsed.version!=='1'||parsed.statement!==SIWE_STATEMENT&&!SIWE_PREVIOUS_STATEMENTS.includes(parsed.statement??'')||
    parsed.issuedAt?.getTime()!==row.issued_at||parsed.expirationTime?.getTime()!==row.accept_until)return burn(401,'SIGNATURE_INVALID');
  const gate:SignatureGate={now,noCode:deps.noCode,
    known:async()=>!!await db.prepare(KNOWN_ERC1271).bind(row.address).first(),
    share:async known=>{
      const [claimed,burnt]=await db.batch([db.prepare(CLAIM_ERC1271).bind(now,nonce,row.net,now-NETWORK_WINDOW_MS-CHALLENGE_TTL_MS,now-NETWORK_WINDOW_MS,ERC1271_CODE_SHARE,known?1:0),
        db.prepare(BURN_UNCLAIMED).bind(now,nonce)]);
      why.reason='code_share';return claimed.meta.changes===1?'ok':burnt.meta.changes===1?'busy':'used';},
    code:async()=>{why.reason='code_cap';return permit(deps,'code',CHAIN_KEYS.code);},
    contract:async()=>{
      why.walletType='CONTRACT';
      if((await db.prepare(CLAIM_CONTRACT).bind(now,nonce,row.net,now-NETWORK_WINDOW_MS,ERC1271_NETWORK_SHARE,row.address,ERC1271_ADDRESS_SHARE).run()).meta.changes===1)return true;
      const held=await db.prepare(ADDRESS_CONTRACT_CHECKS).bind(row.address,now-NETWORK_WINDOW_MS,ERC1271_ADDRESS_SHARE).first<{n:number}>();
      why.reason=(held?.n??0)>=ERC1271_ADDRESS_SHARE?'address':'network_contract';return false;},
    budget:known=>{why.reason=known?'budget_known':'budget';return permit(deps,'chain',known?CHAIN_KEYS.erc1271Known:CHAIN_KEYS.erc1271);}};
  const check=await verifySignature(row.message,signature as `0x${string}`,address,deps.chain,gate);
  if(check==='used')return fail(409,'CHALLENGE_USED');
  if(check==='busy')return burn(429,'CHAIN_BUSY',{'Retry-After':'60'});
  if(check==='unavailable'){why.reason='rpc';return burn(503,'VERIFY_UNAVAILABLE');}
  if(check!=='ECDSA'&&check!=='ERC1271')return burn(401,'SIGNATURE_INVALID');   // 'invalid', or anything that is not a proof
  // Atomic consume: the session row exists only if this transaction took the challenge; concurrent verifies of one
  // signature all pass the checks above, but only one UPDATE matches (sessions.nonce UNIQUE is the second lock). The
  // clock is read again: an ERC-1271 check can take seconds, and a challenge that expired meanwhile is not consumed.
  const at=(deps.now??Date.now)(),token=base64url(random(32)),hash=await sha256(token),expiresAt=row.issued_at+SESSION_TTL_MS;
  let taken=false;
  try{
    const [, insert]=await db.batch([
      db.prepare('UPDATE login_challenges SET used_at=?1,session_hash=?2 WHERE nonce=?3 AND used_at IS NULL AND invalidated_at IS NULL AND accept_until>?1').bind(at,hash,nonce),
      db.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) SELECT session_hash,address,1,?1,?2,nonce,?5,?6 FROM login_challenges WHERE nonce=?3 AND session_hash=?4')
        .bind(at,expiresAt,nonce,hash,WALLET_TYPES[check],check)]);
    taken=insert.meta.changes===1;
  }catch(e){
    // Only a lost race is 409. Any other error (a schema without migrations/0003's columns, D1 down) is rethrown: the
    // batch rolled back, and the route answers a logged 503 AUTH_UNAVAILABLE, never a silent "press sign in again".
    if(!/UNIQUE constraint failed/i.test(String((e as {message?:unknown})?.message)))throw e;
  }
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
/** Sign out everywhere (F-4): this request's live session names the address; every live session of it is revoked, and
 *  every open challenge for it (its index range: only the last CHALLENGE_TTL_MS can still be open) and of this flow is
 *  invalidated. Only a valid session can ask, so nobody can end another address's sessions; a dead or forged cookie is
 *  401 and changes nothing. Never limited, like logout: it only ends the caller's own address. D1: reads the address's
 *  live sessions (sessions_live) and at most the challenges of the last 5 min; writes 1 + 1 index entry per session ended. */
async function logoutAll({request,db,now}:Ctx):Promise<Response>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return fail(400,'BAD_REQUEST');
  const s=await readSession(request,db,now),flow=readCookie(request,FLOW_COOKIE);
  if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s,s==='none'?[]:[clearSession()]);
  const [ended]=await db.batch([
    db.prepare(REVOKE_ALL_SESSIONS).bind(now,s.address),
    db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE issued_at>?3 AND address=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,s.address,now-CHALLENGE_TTL_MS),
    ...flow?[db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,await sha256(flow))]:[]]);
  return reply(200,{revoked:ended.meta.changes},[clearSession(),clearFlow()]);
}

export const ACCOUNT_PREFIXES:readonly string[]=['/api/auth/','/api/me/','/api/wallet/'];
const ASSETS_ROUTE=/^\/api\/wallet\/(0x[\da-fA-F]{40})\/assets$/;
const POSTS:Record<string,(ctx:Ctx)=>Promise<Response>>={'/api/auth/challenge':challenge,'/api/auth/verify':verify,'/api/auth/logout':logout,'/api/auth/logout-all':logoutAll};
/** One JSON line (F-5 monitoring): the event, the route, why, the Cloudflare location and the client's network key (a
 *  /24 or /48, never an IP); nothing else about the request. */
function audit(deps:AccountDeps,fields:Record<string,unknown>){
  try{(deps.log??console.log)(JSON.stringify({...fields,colo:deps.colo??null,net:deps.client??'net:unknown'}));}catch{/* logging never fails a request */}
}
/** Returns null when the path is not an account route (the caller continues with the read API or static assets). Every
 *  429 and 503 it answers is logged once (audit): reason is the refusing layer or bucket, walletType when known. */
export async function handleAccountApi(request:Request,deps:AccountDeps):Promise<Response|null>{
  const {pathname}=new URL(request.url);
  if(!ACCOUNT_PREFIXES.some(p=>pathname.startsWith(p)))return null;
  const r=await accountRoute(request,deps,pathname);
  if(r.status===429||r.status===503){
    const note=NOTES.get(r),error=await r.clone().json().then(b=>(b as {error?:string}).error,()=>undefined);
    audit(deps,{evt:'auth_refused',route:ASSETS_ROUTE.test(pathname)?'/api/wallet/:address/assets':pathname,status:r.status,error,
      reason:note?.reason||error,...note?.walletType?{walletType:note.walletType}:{}});
  }
  return r;
}
async function accountRoute(request:Request,deps:AccountDeps,pathname:string):Promise<Response>{
  const now=(deps.now??Date.now)(),db=deps.db;
  try{
    const post=POSTS[pathname];
    if(post){
      if(request.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED',[],{Allow:'POST'});
      if(!db)return fail(503,'AUTH_UNAVAILABLE');
      const origin=allowedOrigin(request);
      if(!origin)return fail(403,'ORIGIN_NOT_ALLOWED');
      // Logout (one or all) is never limited: it only ever revokes, and a limiter others can drain must not keep a session alive.
      // Challenge and verify spend separate keys (L4), so a challenge flood from one IP never starves its verifies.
      const bucket=post===verify?'verify':'auth';
      if(post!==logout&&post!==logoutAll&&!await permit(deps,bucket))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:bucket});
      return await post({request,deps,db,now,origin});
    }
    const assets=ASSETS_ROUTE.exec(pathname);
    if(pathname!=='/api/auth/session'&&pathname!=='/api/me/home'&&!assets)return fail(404,'UNKNOWN_ROUTE');
    if(request.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED',[],{Allow:'GET'});
    if(assets){
      if(!await permit(deps,'api')||!await permit(deps,'seat'))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'api'});
      const budget=()=>permit(deps,'chain',CHAIN_KEYS.assets);
      try{return reply(200,await deps.ownership.assets(assets[1],{chain:deps.chain,db,now,waitUntil:deps.waitUntil,budget}),[],{'Cache-Control':'public, max-age=300'});}
      catch(e){if(e instanceof LimiterMissing)throw e;return fail(503,'OWNERSHIP_UNAVAILABLE');}
    }
    if(!db)return fail(503,'AUTH_UNAVAILABLE');
    if(pathname==='/api/auth/session'){
      if(!await permit(deps,'api'))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'api'});
      return await session({request,deps,db,now});
    }
    // /api/me/home: the session first, so anonymous or cross-site reads (which carry no Lax cookie) spend only the
    // fail-open read bucket and never the sign-in bucket; a session's re-checks are limited per session, not per IP.
    if(!await permit(deps,'api'))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'api'});
    const s=await readSession(request,db,now);
    if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s,s==='none'?[]:[clearSession()]);
    if(!await permit(deps,'home','session:'+s.tokenHash.slice(0,32)))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'home'});
    const fresh=new URL(request.url).searchParams.get('fresh')==='1',budget=()=>permit(deps,'chain',CHAIN_KEYS.index);
    try{return reply(200,await deps.ownership.home(s.address,{chain:deps.chain,db,now,waitUntil:deps.waitUntil,budget},fresh));}
    catch(e){if(e instanceof LimiterMissing)throw e;return fail(503,'OWNERSHIP_UNAVAILABLE');}
  }catch(e){return e instanceof LimiterMissing?noted(fail(503,'LIMITER_UNAVAILABLE'),{reason:'missing:'+e.binding}):noted(fail(503,'AUTH_UNAVAILABLE'),{reason:'error'});}
}
