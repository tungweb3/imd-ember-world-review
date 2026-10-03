import {getAddress} from 'viem';
import {API_HEADERS,LimiterMissing} from './world-api.ts';
import {allowedOrigin,readSession,sha256,BODY_LIMIT} from './auth.ts';
import type {D1Database,D1PreparedStatement} from './d1.ts';
import {checkName,isReservedName,RENAME_COOLDOWN_MS,OLD_NAME_KEPT_MS,type ProfileState} from '../src/world/memberName.ts';
// The Web2 account layer, M1 [REDACTED]: a member per
// verified login wallet, and the member's public player name. Sign-in itself is server/auth.ts and is not changed: these
// routes only read its session (readSession) and never write or clear its cookie (AUD3-06).
//   POST /api/me/bootstrap      the session's member, created on first use (idempotent; never from an unsigned wallet)
//   GET  /api/me/profile        the session's member, never created here (404 MEMBER_NOT_FOUND); the page's first read
//   PUT  /api/me/profile        set or change the name
//   GET  /api/world/names/:addr a wallet's public name, for its house panel (the owner's 2026-09-30 decision (a): the
//                               name is shown with the wallet's house; the naming form says it is public and tied to it)
export const MEMBER_PATHS={bootstrap:'/api/me/bootstrap',profile:'/api/me/profile'} as const;
const NAMES_ROUTE=/^\/api\/world\/names\/([^/]*)$/;
export type MemberBucket='member'|'api';
export type MemberDeps={
  /** D1 (absent in the Vite dev server, or before migrations/0006: every route answers 503 PROFILE_UNAVAILABLE). */
  db?:D1Database;now?:()=>number;
  /** worker/app.ts limiter: 'member' (AUTH_LIMITER, key 'member:'+client IP; fails CLOSED when it throws) for the two
   *  writes, 'api' (fails open, as every read) for the reads. A binding missing in production throws LimiterMissing: 503. */
  allow?:(bucket:MemberBucket)=>boolean|Promise<boolean>;
  /** The client's network (worker/app.ts networkKey) and Cloudflare location, for the refusal log lines only. */
  client?:string;colo?:string;log?:(line:string)=>void;
};
/** Profile writes that reached the database, per member per minute (5/min). [REDACTED] */
export const PROFILE_WRITES_PER_MINUTE=5;
export const REQUEST_KEPT_MS=86_400_000,HISTORY_KEPT_MS=180*86_400_000,LOGIN_TOUCH_MS=3_600_000;
export const MEMBER_CLEANUP_MAX_ROWS=200,MEMBER_CLEANUP_OPPORTUNISTIC_ROWS=10;
const HARDENING_OBJECTS=['profile_requests_write_budget','profile_requests_expiry','profile_history_expiry'];
/** Only a server-verified EOA session may currently persist the Web2 member. Contract and legacy/unknown sessions
 *  still sign in and read: ERC-1271 validity can depend on what is signed and is not continuing write authority. */
const mayWriteMember=(s:{walletType:string|null;verificationMethod:string|null})=>s.walletType==='EOA'&&s.verificationMethod==='ECDSA';
async function hardeningReady(db:D1Database):Promise<boolean>{
  const r=await db.prepare("SELECT name,type FROM sqlite_master WHERE name IN (?1,?2,?3)").bind(...HARDENING_OBJECTS)
    .all<{name:string;type:string}>();
  return HARDENING_OBJECTS.every((name,i)=>r.results.some(x=>x.name===name&&x.type===(i===0?'trigger':'index')));
}
export type MemberCleanupResult={status:'cleaned';requests:number;history:number}|{status:'schema_unavailable'};
/** Expiry is eligibility for deletion, not a hard deletion deadline: each invocation scans an expiry index and
 *  deletes at most `limit` rows per table. A backlog drains over subsequent cron/opportunistic invocations. */
export async function pruneMemberRecords(db:D1Database,now:number,limit=MEMBER_CLEANUP_MAX_ROWS):Promise<MemberCleanupResult>{
  if(!await hardeningReady(db))return {status:'schema_unavailable'};
  const bounded=Number.isSafeInteger(limit)?Math.max(1,Math.min(MEMBER_CLEANUP_MAX_ROWS,limit)):MEMBER_CLEANUP_MAX_ROWS;
  const r=await db.batch([
    db.prepare(`DELETE FROM profile_requests WHERE rowid IN (SELECT rowid FROM profile_requests INDEXED BY profile_requests_expiry
      WHERE expires_at<=?1 ORDER BY expires_at,member_id,request_id LIMIT ?2)`).bind(now,bounded),
    db.prepare(`DELETE FROM profile_history WHERE history_id IN (SELECT history_id FROM profile_history INDEXED BY profile_history_expiry
      WHERE expires_at<=?1 ORDER BY expires_at,history_id LIMIT ?2)`).bind(now,bounded)]);
  return {status:'cleaned',requests:r[0]?.meta.changes??0,history:r[1]?.meta.changes??0};
}
const rateLimited=()=>fail(429,'NAME_RATE_LIMITED',{retryAfterSeconds:60},{'Retry-After':'60'});
function budgetExceeded(error:unknown):boolean{
  // D1 may wrap SQLite's constraint message in `cause`. Only this literal identifies the quota refusal.
  for(let n=0;n<4&&error&&typeof error==='object';n++){
    const e=error as {message?:unknown;cause?:unknown};
    if(typeof e.message==='string'&&e.message.includes('MEMBER_WRITE_RATE_LIMIT'))return true;
    error=e.cause;
  }
  return false;
}
/** The canonical login identity: never taken from the client. [REDACTED] */
export const identityKey=(address:string)=>'eip155:1:'+address.toLowerCase();
const PUBLIC_ID=/^u_[a-z2-9]{20}$/,REQUEST_ID=/^[A-Za-z0-9_-]{8,64}$/;
const ALPHABET='abcdefghijkmnpqrstuvwxyz23456789';     // 32 symbols: no l, o, 0, 1
const random=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
const hex=(b:Uint8Array)=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
export const newMemberId=()=>'m_'+hex(random(16));
export const newPublicId=()=>'u_'+Array.from(random(20),x=>ALPHABET[x&31]).join('');
const newWalletIdentityId=()=>'w_'+hex(random(16));

function reply(status:number,body:unknown,extra:Record<string,string>={}):Response{
  return new Response(JSON.stringify(body),{status,headers:{...API_HEADERS,...extra}});
}
const fail=(status:number,error:string,more:Record<string,unknown>={},extra:Record<string,string>={})=>reply(status,{error,...more},extra);
async function permit(deps:MemberDeps,bucket:MemberBucket):Promise<boolean>{
  if(!deps.allow)return true;
  try{return (await deps.allow(bucket))!==false;}catch(e){if(e instanceof LimiterMissing)throw e;return bucket==='api';}
}
/** A JSON object body of at most BODY_LIMIT bytes with Content-Type application/json, else null (as server/auth.ts). */
async function readJson(request:Request):Promise<Record<string,unknown>|null>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return null;
  if(Number(request.headers.get('content-length'))>BODY_LIMIT||!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>BODY_LIMIT){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}
  try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}
}

type MemberRow={member_id:string;public_member_id:string;normalized_address:string;last_login_at:number;display_name:string|null;
  active_name_key:string|null;profile_state:ProfileState;version:number;name_changed_at:number|null;next_name_change_at:number|null;
  available_balance:number|null;reserved_balance:number|null;life:string|null;life_number:number|null};
const MEMBER_BY_IDENTITY=`SELECT m.member_id,m.public_member_id,w.normalized_address,w.last_login_at,p.display_name,p.active_name_key,
  p.profile_state,p.version,p.name_changed_at,p.next_name_change_at,e.available_balance,e.reserved_balance,l.state life,l.life_number
  FROM wallet_identities w JOIN members m ON m.member_id=w.member_id JOIN member_profiles p ON p.member_id=w.member_id
  LEFT JOIN economy_accounts e ON e.member_id=w.member_id LEFT JOIN life_state l ON l.member_id=w.member_id WHERE w.identity_key=?1`;
const readMember=(db:D1Database,key:string)=>db.prepare(MEMBER_BY_IDENTITY).bind(key).first<MemberRow>();
/** What the client sees of its own member. [REDACTED]
 *  Never the internal member_id, name key or claims. nextNameChangeAt only while a cooldown applies (null: may rename now). */
export function memberView(r:MemberRow,now:number){
  const cooling=r.profile_state==='ready'&&r.next_name_change_at!==null&&r.next_name_change_at>now;
  return {member:{publicMemberId:r.public_member_id,displayName:r.display_name,profileState:r.profile_state,version:r.version,
      nameChangedAt:r.name_changed_at,nextNameChangeAt:cooling?r.next_name_change_at:null},
    loginWallet:{chainId:1,address:getAddress(r.normalized_address)},
    economy:{available:r.available_balance??0,reserved:r.reserved_balance??0},
    life:{state:r.life??'not_started',lifeNumber:r.life_number??1},serverTime:now};
}

/** One JSON line per 429/503 (as server/auth.ts audit): the route, why, location and network key; nothing else. */
function audit(deps:MemberDeps,fields:Record<string,unknown>){
  try{(deps.log??console.log)(JSON.stringify({evt:'member_refused',...fields,colo:deps.colo??null,net:deps.client??'net:unknown'}));}catch{/* never fails a request */}
}
/** Null when the path is none of the member routes (the caller goes on to server/auth.ts and the read API). */
export async function handleMemberApi(request:Request,deps:MemberDeps):Promise<Response|null>{
  const {pathname}=new URL(request.url),names=NAMES_ROUTE.exec(pathname);
  if(pathname!==MEMBER_PATHS.bootstrap&&pathname!==MEMBER_PATHS.profile&&!names)return null;
  const r=await route(request,deps,pathname,names?.[1]);
  if(r.status===429||r.status===503){
    const error=await r.clone().json().then(b=>(b as {error?:string}).error,()=>undefined);
    audit(deps,{route:names?'/api/world/names/:address':pathname,status:r.status,error});
  }
  return r;
}
async function route(request:Request,deps:MemberDeps,pathname:string,address:string|undefined):Promise<Response>{
  const db=deps.db;
  try{
    if(address!==undefined){
      if(request.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED',{},{Allow:'GET'});
      if(!/^0x[\da-fA-F]{40}$/.test(address))return fail(400,'BAD_ADDRESS');
      if(!await permit(deps,'api'))return fail(429,'RATE_LIMITED',{},{'Retry-After':'60'});
      if(!db)return fail(503,'PROFILE_UNAVAILABLE');
      return await publicName(db,address.toLowerCase());
    }
    const bootstrap=pathname===MEMBER_PATHS.bootstrap,allowed=bootstrap?['POST']:['GET','PUT'];
    if(!allowed.includes(request.method))return fail(405,'METHOD_NOT_ALLOWED',{},{Allow:allowed.join(', ')});
    if(request.method==='GET'){
      if(!await permit(deps,'api'))return fail(429,'RATE_LIMITED',{},{'Retry-After':'60'});
      if(!db)return fail(503,'PROFILE_UNAVAILABLE');
      const now=(deps.now??Date.now)(),s=await readSession(request,db,now);
      if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
      const m=await readMember(db,identityKey(s.address));
      if(!m)return fail(404,'MEMBER_NOT_FOUND');
      if(mayWriteMember(s))await hardeningReady(db).then(ready=>ready?touchLogin(db,m,now):undefined).catch(()=>{});
      return reply(200,memberView(m,now));
    }
    // The writes (as server/auth.ts's): Origin (another site: 403), then the limiter, then the body and the session; only
    // then D1 writes.
    if(!db)return fail(503,'PROFILE_UNAVAILABLE');
    if(!allowedOrigin(request))return fail(403,'ORIGIN_NOT_ALLOWED');
    if(!await permit(deps,'member'))return bootstrap?fail(429,'RATE_LIMITED',{},{'Retry-After':'60'}):fail(429,'NAME_RATE_LIMITED',{retryAfterSeconds:60},{'Retry-After':'60'});
    return bootstrap?await bootstrapMember(request,db,deps):await putProfile(request,db,deps);
  }catch(e){return e instanceof LimiterMissing?fail(503,'LIMITER_UNAVAILABLE'):fail(503,'PROFILE_UNAVAILABLE');}
}

async function publicName(db:D1Database,address:string):Promise<Response>{
  const row=await db.prepare(`SELECT p.display_name FROM wallet_identities w JOIN member_profiles p ON p.member_id=w.member_id
    WHERE w.identity_key=?1 AND p.profile_state='ready'`).bind(identityKey(address)).first<{display_name:string}>();
  // The same answer for "no member" and "no name yet": whether a wallet ever signed in here is not public.
  return reply(200,{name:row?.display_name??null});
}

/** Last login, at most hourly per wallet: the only write a read makes (the page reads with GET first, so the 'member'
 *  bucket is spent only to create a member). A failure here never fails the read. */
async function touchLogin(db:D1Database,m:MemberRow,now:number){
  if(now-m.last_login_at<LOGIN_TOUCH_MS)return;
  await db.prepare('UPDATE wallet_identities SET last_login_at=?1 WHERE identity_key=?2 AND last_login_at<?3').bind(now,identityKey(m.normalized_address),now-LOGIN_TOUCH_MS+1).run().catch(()=>{});
}
/** The session's member; created (with its profile, a zero economy cache and a not-started life) on the first call. Two
 *  first calls racing: identity_key is UNIQUE, so one batch commits and the other rolls back whole and reads the winner's. */
async function bootstrapMember(request:Request,db:D1Database,deps:MemberDeps):Promise<Response>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return fail(400,'BAD_REQUEST');
  const now=(deps.now??Date.now)(),s=await readSession(request,db,now);
  if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
  if(!mayWriteMember(s))return fail(403,'CONTRACT_WRITE_NOT_ENABLED');
  if(!await hardeningReady(db))return fail(503,'PROFILE_UNAVAILABLE');
  await pruneMemberRecords(db,now,MEMBER_CLEANUP_OPPORTUNISTIC_ROWS);
  const address=s.address.toLowerCase(),key=identityKey(address),found=await readMember(db,key);
  if(found){await touchLogin(db,found,now);return reply(200,memberView(found,now));}
  const id=newMemberId();
  try{
    await db.batch([
      db.prepare("INSERT INTO members(member_id,public_member_id,state,created_at,updated_at) VALUES(?1,?2,'active',?3,?3)").bind(id,newPublicId(),now),
      db.prepare(`INSERT INTO wallet_identities(wallet_identity_id,member_id,identity_key,chain_namespace,chain_id,normalized_address,verified_at,last_login_at,status,created_at)
        VALUES(?1,?2,?3,'eip155',1,?4,?5,?5,'active',?5)`).bind(newWalletIdentityId(),id,key,address,now),
      db.prepare("INSERT INTO member_profiles(member_id,profile_state,version,created_at,updated_at) VALUES(?1,'needs_name',0,?2,?2)").bind(id,now),
      db.prepare('INSERT INTO economy_accounts(member_id,updated_at) VALUES(?1,?2)').bind(id,now),
      db.prepare('INSERT INTO life_state(member_id,updated_at) VALUES(?1,?2)').bind(id,now)]);
  }catch{/* lost the race (or D1 failed): read what is there */}
  const made=await readMember(db,key);
  return made?reply(200,memberView(made,now)):fail(503,'PROFILE_UNAVAILABLE');
}

const FIELDS=new Set(['displayName','expectedActorPublicId','expectedProfileVersion','requestId']);
const REFUSALS:Record<string,number>={NAME_UNAVAILABLE:409,NAME_CHANGE_COOLDOWN:409,PROFILE_VERSION_CONFLICT:409,PROFILE_LOCKED:403};
/** A refusal, with nextNameChangeAt when it is the cooldown. */
const refuse=(error:string,m:MemberRow|null,now:number)=>error==='NAME_CHANGE_COOLDOWN'&&m?
  fail(409,error,{nextNameChangeAt:memberView(m,now).member.nextNameChangeAt??m.next_name_change_at}):fail(REFUSALS[error]??409,error);

/** Set or change the name. The body names the member it was written for (expectedActorPublicId: a tab whose cookie now
 *  belongs to another wallet is refused, never applied to it), the profile version it saw, and a request id (a retry
 *  of the same request gets the same answer and spends no second cooldown). Nothing else is accepted: no wallet, role,
 *  admin flag, name key, cooldown or member id. */
async function putProfile(request:Request,db:D1Database,deps:MemberDeps):Promise<Response>{
  const body=await readJson(request);
  if(!body)return fail(400,'BAD_REQUEST');
  if(Object.keys(body).some(k=>!FIELDS.has(k)))return fail(400,'FIELD_NOT_ALLOWED');
  const {displayName,expectedActorPublicId:actor,expectedProfileVersion:version,requestId}=body;
  if(typeof actor!=='string'||!PUBLIC_ID.test(actor)||typeof requestId!=='string'||!REQUEST_ID.test(requestId)||
    !Number.isSafeInteger(version)||(version as number)<0)return fail(400,'BAD_REQUEST');
  const now=(deps.now??Date.now)(),s=await readSession(request,db,now);
  if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
  if(!mayWriteMember(s))return fail(403,'CONTRACT_WRITE_NOT_ENABLED');
  if(!await hardeningReady(db))return fail(503,'PROFILE_UNAVAILABLE');
  await pruneMemberRecords(db,now,MEMBER_CLEANUP_OPPORTUNISTIC_ROWS);
  const m=await readMember(db,identityKey(s.address));
  if(!m||m.public_member_id!==actor)return fail(409,'ACCOUNT_CONTEXT_CHANGED');
  const name=checkName(displayName);
  if(!name.ok)return fail(400,'NAME_FORMAT_INVALID',{reason:name.reason});
  const hash=await sha256(JSON.stringify([name.display,version])),member=m.member_id;
  const readRequest=()=>db.prepare('SELECT payload_hash,outcome FROM profile_requests WHERE member_id=?1 AND request_id=?2').bind(member,requestId)
    .first<{payload_hash:string;outcome:string}>();
  const existingReply=async(seen:{payload_hash:string;outcome:string},current:MemberRow|null=null)=>{
    if(seen.payload_hash!==hash)return fail(409,'IDEMPOTENCY_CONFLICT');
    const latest=current??await readMember(db,identityKey(s.address));
    return seen.outcome==='ok'?(latest?reply(200,memberView(latest,now)):fail(503,'PROFILE_UNAVAILABLE')):refuse(seen.outcome,latest,now);
  };
  // The same request again: its first answer (a success shows the profile as it is now).
  const seen=await readRequest();
  if(seen)return existingReply(seen,m);
  const refused=async(error:string)=>{
    try{
      await db.prepare(`INSERT OR IGNORE INTO profile_requests(member_id,request_id,payload_hash,outcome,result_version,created_at,expires_at)
        VALUES(?1,?2,?3,?4,NULL,?5,?6)`).bind(member,requestId,hash,error,now,now+REQUEST_KEPT_MS).run();
    }catch(e){
      const won=await readRequest();
      if(won)return existingReply(won);
      return budgetExceeded(e)?rateLimited():fail(503,'PROFILE_UNAVAILABLE');
    }
    // OR IGNORE may have lost to a different payload using this same key. Return the winner, not this local refusal.
    const recorded=await readRequest();
    return recorded?existingReply(recorded):fail(503,'PROFILE_UNAVAILABLE');
  };
  if(m.profile_state==='locked')return refused('PROFILE_LOCKED');
  if(m.version!==version)return refused('PROFILE_VERSION_CONFLICT');
  // A fresh no-op still reserves a logical-attempt slot. It changes no profile version, cooldown or history.
  if(m.profile_state==='ready'&&m.display_name===name.display){
    try{
      await db.prepare(`INSERT INTO profile_requests(member_id,request_id,payload_hash,outcome,result_version,created_at,expires_at)
        VALUES(?1,?2,?3,'ok',(SELECT version FROM member_profiles WHERE member_id=?1 AND version=?4
          AND profile_state='ready' AND display_name=?5),?6,?7)`).bind(member,requestId,hash,version,name.display,now,now+REQUEST_KEPT_MS).run();
    }catch(e){
      const won=await readRequest();
      if(won)return existingReply(won);
      if(budgetExceeded(e))return rateLimited();
      const changed=await readMember(db,identityKey(s.address));
      return changed&&(changed.version!==version||changed.profile_state==='locked')?
        refused(changed.profile_state==='locked'?'PROFILE_LOCKED':'PROFILE_VERSION_CONFLICT'):fail(503,'PROFILE_UNAVAILABLE');
    }
    const done=await readRequest();
    return done?existingReply(done):fail(503,'PROFILE_UNAVAILABLE');
  }
  if(m.profile_state==='ready'&&m.next_name_change_at!==null&&m.next_name_change_at>now)return refused('NAME_CHANGE_COOLDOWN');
  if(isReservedName(name.key))return refused('NAME_UNAVAILABLE');
  const old=m.active_name_key,same=old===name.key;
  if(!same&&!await claimable(db,name.key,member,now))return refused('NAME_UNAVAILABLE');
  const writes:D1PreparedStatement[]=[
    // First, the guard: 'ok' needs the version this write produces, read only if the profile is still the one checked
    // above (same version, not locked, no cooldown); otherwise NULL fails the table's CHECK and the whole batch rolls back.
    db.prepare(`INSERT INTO profile_requests(member_id,request_id,payload_hash,outcome,result_version,created_at,expires_at)
      VALUES(?1,?2,?3,'ok',(SELECT version+1 FROM member_profiles WHERE member_id=?1 AND version=?4 AND profile_state IN ('needs_name','ready','needs_rename')
        AND (profile_state<>'ready' OR next_name_change_at IS NULL OR next_name_change_at<=?5)),?5,?6)`).bind(member,requestId,hash,version,now,now+REQUEST_KEPT_MS)];
  if(!same){
    // An expired reservation (anyone's) or this member's own is cleared; the current name becomes this member's
    // reservation for 30 days; the new key is inserted plainly, so a key taken meanwhile fails UNIQUE and rolls back.
    writes.push(db.prepare("DELETE FROM nickname_claims WHERE name_key=?1 AND claim_type='reserved' AND (member_id=?2 OR reserved_until<=?3)").bind(name.key,member,now));
    if(old)writes.push(db.prepare("UPDATE nickname_claims SET claim_type='reserved',reserved_until=?3,updated_at=?4 WHERE name_key=?1 AND member_id=?2 AND claim_type='active'")
      .bind(old,member,now+OLD_NAME_KEPT_MS,now));
    writes.push(db.prepare("INSERT INTO nickname_claims(name_key,claim_type,member_id,created_at,updated_at) VALUES(?1,'active',?2,?3,?3)").bind(name.key,member,now));
  }
  writes.push(
    db.prepare(`INSERT INTO profile_history(member_id,actor,kind,old_name,new_name,version,at,expires_at)
      SELECT ?1,'self',?2,display_name,?3,version+1,?4,?5 FROM member_profiles WHERE member_id=?1`)
      .bind(member,m.profile_state==='needs_name'?'initial':'rename',name.display,now,now+HISTORY_KEPT_MS),
    db.prepare(`UPDATE member_profiles SET display_name=?2,active_name_key=?3,profile_state='ready',version=version+1,name_changed_at=?4,
      next_name_change_at=?5,updated_at=?4 WHERE member_id=?1`).bind(member,name.display,name.key,now,now+RENAME_COOLDOWN_MS));
  try{await db.batch(writes);}
  catch(e){
    // Rolled back. Say why from what is there now: this same request committed by another tab, the profile moved on,
    // or the name was taken meanwhile; anything else is the database failing.
    const again=await readRequest();
    const now2=await readMember(db,identityKey(s.address));
    if(again)return existingReply(again,now2);
    if(budgetExceeded(e))return rateLimited();
    if(now2&&(now2.version!==version||now2.profile_state==='locked'))return refused(now2.profile_state==='locked'?'PROFILE_LOCKED':'PROFILE_VERSION_CONFLICT');
    if(now2&&!same&&!await claimable(db,name.key,member,now))return refused('NAME_UNAVAILABLE');
    return fail(503,'PROFILE_UNAVAILABLE');
  }
  const saved=await readMember(db,identityKey(s.address));
  return saved?reply(200,memberView(saved,now)):fail(503,'PROFILE_UNAVAILABLE');
}
/** Whether `key` is free for `member`: no claim, this member's own reservation, or anyone's expired reservation.
 *  Another member's active name, a system name and a quarantined name (this member's own included) are not. */
async function claimable(db:D1Database,key:string,member:string,now:number):Promise<boolean>{
  const c=await db.prepare('SELECT claim_type,member_id,reserved_until FROM nickname_claims WHERE name_key=?1').bind(key)
    .first<{claim_type:string;member_id:string|null;reserved_until:number|null}>();
  if(!c)return true;
  return c.claim_type==='reserved'&&(c.member_id===member||(c.reserved_until??0)<=now);
}
