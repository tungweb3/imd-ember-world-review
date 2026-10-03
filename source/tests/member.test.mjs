import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,START,windowLimiter} from './wallet-harness.mjs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {moderationSql} from '../scripts/member-moderate.mjs';
import {sha256} from '../server/auth.ts';
// The member layer (server/member.ts, migrations/0006) through the real Worker (createWorker → handleMemberApi) on the
// real migrations, signed in with real SIWE sessions (tests/wallet-harness.mjs). Every expectation is what a browser or
// the database sees; nothing re-derives the server's rules. Numbers in the titles refer to test cases [REDACTED].
// [REDACTED] Existing case identifiers in test titles are retained.
const DAY=86_400_000,MIN=60_000;
const body=r=>r.clone().json();
const rows=(w,sql,...a)=>w.db.raw.prepare(sql).all(...a).map(r=>({...r}));
const count=(w,table)=>w.db.raw.prepare(`SELECT count(*) n FROM ${table}`).get().n;
const SET_COOKIE=r=>r.headers.getSetCookie();
let rid=0;const nextId=()=>'req-'+String(++rid).padStart(6,'0');
async function put(b,payload,options={}){return b.keep(await b.send(b.request('/api/me/profile',{...options,method:'PUT',body:payload})));}
async function signedIn(w,account=newAccount(),ip){const b=w.browser(undefined,undefined,ip);const {verify}=await b.signIn(account);assert.equal(verify.status,200);return {b,account};}
/** Bootstrap and return the member view. */
async function member(b){const r=await b.post('/api/me/bootstrap');assert.equal(r.status,200,JSON.stringify(await body(r)));return body(r);}
/** A name write as the current form would send it: the member and version it last saw, a fresh request id. */
async function rename(b,me,displayName,extra={}){
  return put(b,{displayName,expectedActorPublicId:me.member.publicMemberId,expectedProfileVersion:me.member.version,requestId:nextId(),...extra});
}
function assertApiHeaders(r,label){
  assert.equal(r.headers.get('cache-control'),'no-store',label);
  assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000; includeSubDomains',label);
  assert.equal(r.headers.get('x-content-type-options'),'nosniff',label);
  for(const [name] of r.headers)assert.ok(!name.toLowerCase().startsWith('access-control-'),label+': '+name);
}
/** The same database with some reads answered stale (a replica behind, or the other tab's write landing between the
 *  check and the batch): `member` rewrites the member read, `claim` the name-claim read. Writes are untouched. */
function stale(w,{member:m,claim}={}){
  const db=w.db,wrap=(st,sql)=>({...st,bind:(...v)=>wrap(st.bind(...v),sql),first:async()=>{const r=await st.first();
    if(m&&sql.includes('JOIN members m'))return m(r);if(claim&&sql.includes('FROM nickname_claims WHERE name_key'))return claim(r);return r;}});
  w.env.DB={...db,prepare:sql=>wrap(db.prepare(sql),sql)};
  return ()=>{w.env.DB=db;};
}

test('E1 E3 E21 N01: a signed-in wallet gets exactly one member on first bootstrap, the same one after, from the session alone',async()=>{
  const w=setup(),{b,account}=await signedIn(w);
  const first=await b.post('/api/me/bootstrap');
  assert.equal(first.status,200);assertApiHeaders(first,'bootstrap');
  assert.deepEqual(SET_COOKIE(first),[],'the session cookie is only read');
  const me=await body(first);
  assert.match(me.member.publicMemberId,/^u_[a-z2-9]{20}$/);
  assert.deepEqual({...me,member:{...me.member,publicMemberId:'x'}},{member:{publicMemberId:'x',displayName:null,profileState:'needs_name',version:0,nameChangedAt:null,nextNameChangeAt:null},
    loginWallet:{chainId:1,address:account.address},economy:{available:0,reserved:0},life:{state:'not_started',lifeNumber:1},serverTime:START});
  const lower=account.address.toLowerCase();
  const [wi]=rows(w,'SELECT * FROM wallet_identities');
  assert.equal(wi.identity_key,'eip155:1:'+lower);assert.equal(wi.normalized_address,lower);assert.equal(wi.chain_namespace,'eip155');assert.equal(wi.chain_id,1);
  assert.ok(!JSON.stringify(me).includes(wi.member_id),'the internal member id is never sent');
  assert.ok(!me.member.publicMemberId.includes(lower.slice(2,8)),'the public id carries nothing of the address');
  // The sessions table is not changed by the member layer. [REDACTED]
  assert.deepEqual(rows(w,'PRAGMA table_info(sessions)').map(c=>c.name),['token_hash','address','chain_id','created_at','expires_at','revoked_at','nonce','wallet_type','verification_method']);
  for(const t of ['members','wallet_identities','member_profiles','economy_accounts','life_state'])assert.equal(count(w,t),1,t);
  assert.deepEqual(rows(w,'SELECT state,life_number,started_at,death_at FROM life_state'),[{state:'not_started',life_number:1,started_at:null,death_at:null}]);
  // Again, from this tab and from another browser signed in with the same wallet: the same member, nothing new.
  assert.deepEqual(await member(b),me);
  const other=await signedIn(w,account);
  assert.equal((await member(other.b)).member.publicMemberId,me.member.publicMemberId);
  for(const t of ['members','wallet_identities','member_profiles','economy_accounts','life_state'])assert.equal(count(w,t),1,t);
  // GET reads it and never creates one.
  const g=await b.get('/api/me/profile');assert.equal(g.status,200);assert.deepEqual(await body(g),me);
});

test('E2 E15 E48 N02: no member without a live session; dead sessions are 401 and the cookie is left alone',async()=>{
  const w=setup(),a=newAccount();
  const anon=w.browser();
  for(const r of [await anon.post('/api/me/bootstrap'),await anon.get('/api/me/profile')]){assert.equal(r.status,401);assert.deepEqual(await body(r),{error:'AUTH_REQUIRED'});}
  // A connected wallet that asked for a challenge but never signed: still no member.
  await anon.post('/api/auth/challenge',{address:a.address});
  assert.equal((await anon.post('/api/me/bootstrap')).status,401);
  const forged=w.browser();forged.jar.set('__Host-imd_session','x'.repeat(43));
  const r=await forged.post('/api/me/bootstrap');assert.equal(r.status,401);assert.deepEqual(await body(r),{error:'AUTH_REQUIRED'});assert.deepEqual(SET_COOKIE(r),[]);
  const {b}=await signedIn(w,a);w.clock.advance(7*DAY);
  const expired=await b.post('/api/me/bootstrap');
  assert.equal(expired.status,401);assert.deepEqual(await body(expired),{error:'SESSION_EXPIRED'});assert.deepEqual(SET_COOKIE(expired),[],'AUD3-06: not cleared');
  assert.equal(count(w,'members'),0);
  // Logged out: refused, and the member made before stays.
  const s2=await signedIn(w,a);await member(s2.b);await s2.b.post('/api/auth/logout');
  assert.equal((await s2.b.post('/api/me/bootstrap')).status,401);assert.equal(count(w,'members'),1);
});

test('writes need this site as Origin and a JSON request; refusals change nothing',async()=>{
  const w=setup(),{b}=await signedIn(w);
  const evil=await b.post('/api/me/bootstrap',{},{origin:'https://evil.example'});
  assert.equal(evil.status,403);assert.deepEqual(await body(evil),{error:'ORIGIN_NOT_ALLOWED'});assertApiHeaders(evil,'403');
  assert.equal((await b.post('/api/me/bootstrap',{},{origin:null})).status,403,'no Origin');
  assert.equal((await b.post('/api/me/bootstrap','{}',{headers:{'content-type':'text/plain'}})).status,400);
  assert.equal(count(w,'members'),0);
  const me=await member(b);
  const p=await put(b,{displayName:'EmberCat',expectedActorPublicId:me.member.publicMemberId,expectedProfileVersion:0,requestId:nextId()},{origin:'http://localhost:5173'});
  assert.equal(p.status,403,'a loopback origin is refused on the production host');
  assert.equal((await b.get('/api/me/bootstrap')).status,405);assert.equal((await b.post('/api/me/profile')).status,405);
  assert.equal(rows(w,'SELECT version FROM member_profiles')[0].version,0);
});

test('E4 N12: two first bootstraps racing make one member; the loser rolls back whole and answers with the winner',async()=>{
  const w=setup(),{account}=await signedIn(w),x=await signedIn(w,account),y=await signedIn(w,account);
  const [p,q]=await Promise.all([x.b.post('/api/me/bootstrap'),y.b.post('/api/me/bootstrap')]);
  assert.equal(p.status,200);assert.equal(q.status,200);
  assert.equal((await body(p)).member.publicMemberId,(await body(q)).member.publicMemberId);
  // Forced: a read that still says "no member" when one exists (the other tab committed in between).
  let first=true;const undo=stale(w,{member:r=>{if(first){first=false;return null;}return r;}});
  const r=await x.b.post('/api/me/bootstrap');undo();
  assert.equal(r.status,200);assert.equal((await body(r)).member.publicMemberId,(await body(p)).member.publicMemberId);
  for(const t of ['members','wallet_identities','member_profiles','economy_accounts','life_state'])assert.equal(count(w,t),1,t);
});

test('a session row holding a mixed-case address (as an older row might) still resolves to the lowercase identity',async()=>{
  const w=setup(),a=newAccount(),token='T'.repeat(43);
  w.db.raw.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,'legacy','EOA','ECDSA')").run(await sha256(token),a.address,START,START+DAY);
  const b=w.browser();b.jar.set('__Host-imd_session',token);
  const me=await member(b);assert.equal(me.loginWallet.address,a.address);
  assert.equal((await b.get('/api/me/profile')).status,200,'GET finds it too');
  assert.equal((await rename(b,me,'Legacy')).status,200,'and so does a name write');
  assert.deepEqual(rows(w,'SELECT identity_key,normalized_address FROM wallet_identities'),[{identity_key:'eip155:1:'+a.address.toLowerCase(),normalized_address:a.address.toLowerCase()}]);
  const {b:signed}=await signedIn(w,a);assert.equal((await member(signed)).member.publicMemberId,me.member.publicMemberId,'the same member through a normal sign-in');
});

test('E5 E11 E117: identities are eip155:1 only and canonical; another wallet gets another member',async()=>{
  const w=setup(),a=await signedIn(w),b2=await signedIn(w);
  const ma=await member(a.b),mb=await member(b2.b);
  assert.notEqual(ma.member.publicMemberId,mb.member.publicMemberId);
  const id=rows(w,'SELECT member_id FROM members')[0].member_id,addr='0x'+'ab'.repeat(20);
  const insert=(ns,chain,key,address=addr)=>()=>w.db.raw.prepare(`INSERT INTO wallet_identities(wallet_identity_id,member_id,identity_key,chain_namespace,chain_id,normalized_address,verified_at,last_login_at,created_at)
    VALUES('w_x',?,?,?,?,?,0,0,0)`).run(id+'-none',key,ns,chain,address);
  assert.throws(insert('eip155',8453,'eip155:8453:'+addr),/CHECK|FOREIGN/);
  assert.throws(insert('eip155',1,'eip155:1:'+addr.toUpperCase().replace('0X','0x'),addr.toUpperCase().replace('0X','0x')),/CHECK|FOREIGN/);
  assert.throws(insert('eip155',1,'eip155:1:0x'+'cd'.repeat(20)),/CHECK|FOREIGN/,'identity_key must be its own parts');
});

test('N03 N04 N05 E6: first name, public lookup, cooldown from the first name, and the member id never changes',async()=>{
  const w=setup(),{b,account}=await signedIn(w),me=await member(b);
  const ok=await rename(b,me,'  Ember貓_01  ');
  assert.equal(ok.status,200);assertApiHeaders(ok,'put');
  const after=await body(ok);
  assert.deepEqual(after.member,{publicMemberId:me.member.publicMemberId,displayName:'Ember貓_01',profileState:'ready',version:1,nameChangedAt:START,nextNameChangeAt:START+7*DAY});
  assert.deepEqual(rows(w,'SELECT name_key,claim_type FROM nickname_claims WHERE member_id IS NOT NULL'),[{name_key:'ember貓_01',claim_type:'active'}]);
  assert.deepEqual(rows(w,'SELECT actor,kind,old_name,new_name,version FROM profile_history'),[{actor:'self',kind:'initial',old_name:null,new_name:'Ember貓_01',version:1}]);
  const anon=w.browser();
  for(const a of [account.address,account.address.toLowerCase(),account.address.toUpperCase().replace('0X','0x')]){
    const n=await anon.get('/api/world/names/'+a);assert.equal(n.status,200);assertApiHeaders(n,'names');assert.deepEqual(await body(n),{name:'Ember貓_01'});}
  assert.deepEqual(await body(await anon.get('/api/world/names/0x'+'1'.repeat(40))),{name:null},'no member: the same answer as no name');
  for(const bad of ['0x12','zz','0x'+'g'.repeat(40),'0x'+'1'.repeat(40)+'/x'])assert.ok([400,404].includes((await anon.get('/api/world/names/'+bad)).status),bad);
  assert.equal((await anon.get('/api/world/names/0x12')).status,400);
  // A second change inside 7 days: 409 with the time, not a 429.
  const soon=await rename(b,after,'EmberMoon');
  assert.equal(soon.status,409);assert.deepEqual(await body(soon),{error:'NAME_CHANGE_COOLDOWN',nextNameChangeAt:START+7*DAY});
  // The member row is the same throughout.
  assert.equal(count(w,'members'),1);assert.equal(rows(w,'SELECT public_member_id FROM members')[0].public_member_id,me.member.publicMemberId);
});

test('N06 N07: names are unique site-wide by NFKC + ASCII case; the loser learns nothing about the holder',async()=>{
  const w=setup(),a=await signedIn(w),c=await signedIn(w);
  const ma=await member(a.b),mc=await member(c.b);
  assert.equal((await rename(a.b,ma,'EmberCat')).status,200);
  for(const n of ['embercat','EMBERCAT','ＥｍｂｅｒＣａｔ']){
    const r=await rename(c.b,mc,n);assert.equal(r.status,409,n);assert.deepEqual(await body(r),{error:'NAME_UNAVAILABLE'},n);}
  assert.equal((await rename(c.b,mc,'Ember_Cat')).status,200,'an underscore makes another name');
});

test('N08 N09: same value is a no-op; a case-only change is a change; the old name is kept 30 days for its member',async()=>{
  const w=setup(),a=await signedIn(w),c=await signedIn(w);
  let ma=await body(await rename(a.b,await member(a.b),'EmberCat'));const mc=await member(c.b);
  const same=await rename(a.b,ma,'EmberCat');
  assert.equal(same.status,200);assert.deepEqual((await body(same)).member,ma.member,'no version, no cooldown change');
  assert.equal((await rename(a.b,ma,'EMBERCAT')).status,409,'case-only: still inside the cooldown');
  w.clock.advance(7*DAY);
  const a2=await signedIn(w,a.account);ma=await member(a2.b);
  const moon=await rename(a2.b,ma,'EmberMoon');assert.equal(moon.status,200);ma=await body(moon);
  assert.deepEqual(rows(w,"SELECT name_key,claim_type,reserved_until FROM nickname_claims WHERE member_id IS NOT NULL ORDER BY name_key"),
    [{name_key:'embercat',claim_type:'reserved',reserved_until:START+7*DAY+30*DAY},{name_key:'embermoon',claim_type:'active',reserved_until:null}]);
  const c2=await signedIn(w,c.account);
  assert.equal((await rename(c2.b,mc,'EmberCat')).status,409,'held for its member');
  // Back to the old name: allowed for its member, after the cooldown.
  w.clock.advance(7*DAY);const a3=await signedIn(w,a.account);ma=await member(a3.b);
  const back=await rename(a3.b,ma,'EmberCat');assert.equal(back.status,200);ma=await body(back);
  assert.deepEqual(rows(w,"SELECT name_key,claim_type FROM nickname_claims WHERE member_id IS NOT NULL ORDER BY name_key"),
    [{name_key:'embercat',claim_type:'active'},{name_key:'embermoon',claim_type:'reserved'}]);
  // Past 30 days anyone may take a released name; the expired reservation is replaced in the same batch.
  w.clock.advance(31*DAY);const c3=await signedIn(w,c.account);
  const take=await rename(c3.b,await member(c3.b),'embermoon');assert.equal(take.status,200);
  assert.deepEqual(rows(w,"SELECT claim_type FROM nickname_claims WHERE name_key='embermoon'"),[{claim_type:'active'}]);
  assert.equal(rows(w,"SELECT count(*) n FROM nickname_claims WHERE claim_type='active' GROUP BY member_id HAVING n>1").length,0);
});

test('N10 N11 E14: a form written for another member, or for an older profile, is refused and changes nothing',async()=>{
  const w=setup(),{b}=await signedIn(w),other=newAccount();
  const a=await member(b);
  // The tab's cookie now belongs to wallet B (another tab signed in as B): the form still names A.
  await b.signIn(other);const mb=await member(b);
  const r=await put(b,{displayName:'FromTabA',expectedActorPublicId:a.member.publicMemberId,expectedProfileVersion:0,requestId:nextId()});
  assert.equal(r.status,409);assert.deepEqual(await body(r),{error:'ACCOUNT_CONTEXT_CHANGED'});
  assert.deepEqual(rows(w,'SELECT display_name FROM member_profiles'),[{display_name:null},{display_name:null}]);
  // Version: two tabs of B; the second still holds version 0.
  assert.equal((await rename(b,mb,'FirstTab')).status,200);
  const late=await rename(b,mb,'SecondTab');
  assert.equal(late.status,409);assert.deepEqual(await body(late),{error:'PROFILE_VERSION_CONFLICT'});
  assert.equal(rows(w,"SELECT display_name FROM member_profiles WHERE display_name IS NOT NULL")[0].display_name,'FirstTab');
});

test('N13 N14: a retried request gets its first answer once; the same id with other content is a conflict',async()=>{
  const w=setup(),{b}=await signedIn(w),me=await member(b);
  const payload={displayName:'EmberCat',expectedActorPublicId:me.member.publicMemberId,expectedProfileVersion:0,requestId:'retry-0001'};
  const first=await put(b,payload),again=await put(b,payload);
  assert.equal(first.status,200);assert.equal(again.status,200);
  assert.deepEqual((await body(again)).member,(await body(first)).member);
  assert.equal(count(w,'profile_history'),1,'one change, one history row');
  assert.equal(rows(w,'SELECT version FROM member_profiles')[0].version,1);
  const changed=await put(b,{...payload,displayName:'EmberDog'});
  assert.equal(changed.status,409);assert.deepEqual(await body(changed),{error:'IDEMPOTENCY_CONFLICT'});
  // A refusal is replayed too.
  const r1=await put(b,{...payload,requestId:'retry-0002',expectedProfileVersion:1,displayName:'Other'}),r2=await put(b,{...payload,requestId:'retry-0002',expectedProfileVersion:1,displayName:'Other'});
  assert.deepEqual([r1.status,await body(r1)],[409,{error:'NAME_CHANGE_COOLDOWN',nextNameChangeAt:START+7*DAY}]);
  assert.deepEqual([r2.status,await body(r2)],[409,{error:'NAME_CHANGE_COOLDOWN',nextNameChangeAt:START+7*DAY}]);
});

test('N15 E13: only the four fields are accepted; a member id, wallet, role or cooldown in the body is refused',async()=>{
  const w=setup(),{b}=await signedIn(w),me=await member(b);
  for(const extra of [{memberId:'m_x'},{wallet:'0x'+'1'.repeat(40)},{role:'admin'},{isAdmin:true},{nameKey:'x'},{nextNameChangeAt:0},{avatarKey:'a'}]){
    const r=await rename(b,me,'EmberCat',extra);assert.equal(r.status,400,JSON.stringify(extra));assert.deepEqual(await body(r),{error:'FIELD_NOT_ALLOWED'});}
  for(const bad of [{expectedActorPublicId:'u_short'},{expectedProfileVersion:-1},{expectedProfileVersion:'0'},{requestId:'x'},{requestId:'has space 123'}]){
    const r=await put(b,{displayName:'EmberCat',expectedActorPublicId:me.member.publicMemberId,expectedProfileVersion:0,requestId:nextId(),...bad});
    assert.equal(r.status,400,JSON.stringify(bad));}
  assert.equal((await put(b,'not json')).status,400);
  assert.equal((await put(b,{displayName:'x'.repeat(3000)})).status,400,'over the body limit');
  assert.equal(rows(w,'SELECT version FROM member_profiles')[0].version,0);
});

test('N16 N17: format and reserved names are refused before any claim; the database holds the reserved names too',async()=>{
  const w=setup(),{b}=await signedIn(w),me=await member(b);
  for(const [n,reason] of [['a','length'],['Ember Cat','chars'],['x​x','controls'],['ab\u{1F600}','chars'],['a@b.com','chars'],['<b>hi</b>','chars'],['__','shape'],['A'.repeat(21),'length']]){
    const r=await rename(b,me,n);assert.equal(r.status,400,n);assert.deepEqual(await body(r),{error:'NAME_FORMAT_INVALID',reason},n);}
  for(const n of ['Admin','ADMIN_01','Ａｄｍｉｎ','Adm1n','IMDEmber_Official','管理员','官方_客服','Moderator','ImdEmber']){
    w.clock.advance(13_000);const r=await rename(b,me,n);   /* refusals count toward 5 a minute */assert.equal(r.status,409,n);assert.deepEqual(await body(r),{error:'NAME_UNAVAILABLE'},n);}
  assert.deepEqual(rows(w,"SELECT name_key FROM nickname_claims WHERE claim_type='system' ORDER BY name_key").map(r=>r.name_key),
    ['administrator','admin','imdember','imdemberofficial','moderator','官方客服','管理員'].sort());
  assert.equal(count(w,'profile_history'),0);
  w.clock.advance(MIN);assert.equal((await rename(b,me,'Badminton')).status,200,'not a substring rule');
});

test('N18: five name writes a minute per member reach the database; then 429 with Retry-After, refusals counted',async()=>{
  const w=setup(),{b}=await signedIn(w);let me=await member(b);
  me=await body(await rename(b,me,'EmberCat'));
  for(let i=0;i<4;i++)assert.equal((await rename(b,me,'Other'+i)).status,409,'cooldown refusals count');
  const r=await rename(b,me,'Other9');
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.deepEqual(await body(r),{error:'NAME_RATE_LIMITED',retryAfterSeconds:60});
  assert.equal(count(w,'profile_requests'),5,'the refused sixth wrote nothing');
  w.clock.advance(MIN+1);
  assert.equal((await rename(b,me,'Other9')).status,409,'a minute later: allowed again (and still cooling)');
});

test('the per-IP limit: member:<ip> keys on AUTH_LIMITER, checked before the session; a missing binding is 503',async()=>{
  const w=setup(),{b}=await signedIn(w,newAccount(),'203.0.113.7');
  const seen=windowLimiter(100,()=>START);w.env.AUTH_LIMITER=seen;
  await member(b);assert.ok(seen.keys.includes('member:ip:203.0.113.7'),seen.keys.join());
  w.env.AUTH_LIMITER={limit:async()=>({success:false})};
  const r=await b.post('/api/me/bootstrap');assert.equal(r.status,429);assert.deepEqual(await body(r),{error:'RATE_LIMITED'});assertApiHeaders(r,'429');
  const anon=w.browser();assert.equal((await anon.post('/api/me/bootstrap')).status,429,'refused before the session is read');
  const p=await put(b,{displayName:'EmberCat',expectedActorPublicId:'u_'+'a'.repeat(20),expectedProfileVersion:0,requestId:nextId()});
  assert.equal(p.status,429);assert.deepEqual(await body(p),{error:'NAME_RATE_LIMITED',retryAfterSeconds:60});
  w.env.AUTH_LIMITER={limit:async()=>{throw new Error('down');}};
  assert.equal((await b.post('/api/me/bootstrap')).status,429,'a failing limiter refuses (fails closed)');
  delete w.env.AUTH_LIMITER;
  const missing=await b.post('/api/me/bootstrap');assert.equal(missing.status,503);assert.deepEqual(await body(missing),{error:'LIMITER_UNAVAILABLE'});assertApiHeaders(missing,'503');
  const local=w.browser('http://localhost:8787','http://localhost:8787');
  assert.equal((await local.post('/api/me/bootstrap')).status,401,'loopback dev without the binding: open, then the session check');
  // Reads spend the fail-open read bucket.
  w.env.API_LIMITER={limit:async()=>{throw new Error('down');}};
  assert.equal((await w.browser().get('/api/world/names/0x'+'1'.repeat(40))).status,200);
});

test('N19 N20: moderation renames to 會員-<code>, quarantines the name, and lets the member rename without the cooldown',async()=>{
  const w=setup(),{b,account}=await signedIn(w),c=await signedIn(w);
  let me=await body(await rename(b,await member(b),'BadName'));
  w.db.raw.exec(moderationSql('rename',me.member.publicMemberId,'offensive',START+MIN));
  me=await member(b);
  assert.equal(me.member.displayName,'會員-'+me.member.publicMemberId.slice(2,8));
  assert.equal(me.member.profileState,'needs_rename');assert.equal(me.member.nextNameChangeAt,null);
  assert.deepEqual(await body(await w.browser().get('/api/world/names/'+account.address)),{name:null});
  assert.deepEqual(rows(w,"SELECT claim_type,reason FROM nickname_claims WHERE name_key='badname'"),[{claim_type:'quarantined',reason:'offensive'}]);
  assert.deepEqual(rows(w,"SELECT actor,kind,old_name,reason FROM profile_history ORDER BY history_id DESC LIMIT 1"),[{actor:'admin',kind:'moderation',old_name:'BadName',reason:'offensive'}]);
  // Nobody takes the quarantined name, its member included; a new name is allowed at once (inside the old cooldown).
  assert.equal((await rename(c.b,await member(c.b),'badname')).status,409);
  assert.equal((await rename(b,me,'BadName')).status,409);
  me=await member(b);
  const fixed=await rename(b,me,'GoodName');assert.equal(fixed.status,200);assert.equal((await body(fixed)).member.profileState,'ready');
  // Lock and unlock.
  me=await body(fixed);w.db.raw.exec(moderationSql('lock',me.member.publicMemberId,'spam',START+2*MIN));
  me=await member(b);assert.equal(me.member.profileState,'locked');assert.equal(me.member.nextNameChangeAt,null,'no cooldown is shown while locked');
  // Locked comes first: even a name someone holds answers PROFILE_LOCKED, not NAME_UNAVAILABLE.
  const held=await body(await rename(c.b,await member(c.b),'HeldName'));assert.equal(held.member.displayName,'HeldName');
  const first=await rename(b,me,'HeldName');assert.equal(first.status,403);assert.deepEqual(await body(first),{error:'PROFILE_LOCKED'});
  w.clock.advance(8*DAY);const b2=(await signedIn(w,account)).b;me=await member(b2);
  const locked=await rename(b2,me,'Another');assert.equal(locked.status,403);assert.deepEqual(await body(locked),{error:'PROFILE_LOCKED'});
  w.db.raw.exec(moderationSql('unlock',me.member.publicMemberId,'other',START+8*DAY));
  me=await member(b2);assert.equal(me.member.profileState,'ready');assert.equal((await rename(b2,me,'Another')).status,200);
  assert.throws(()=>moderationSql('rename',"u_x'; DROP TABLE members; --",'other'),/public member id/);
  assert.throws(()=>moderationSql('rename','u_'+'a'.repeat(20),"x'--"),/reason/);
});

test('races inside the write: a name taken, or a version moved, after the checks rolls the whole batch back',async()=>{
  const w=setup(),a=await signedIn(w),c=await signedIn(w);
  let ma=await body(await rename(a.b,await member(a.b),'EmberCat'));
  const mc=await body(await rename(c.b,await member(c.b),'Rival'));
  w.clock.advance(7*DAY);const a2=await signedIn(w,a.account),c2=await signedIn(w,c.account);ma=await member(a2.b);
  // The claim check reads "free" for a name Rival holds: the INSERT fails UNIQUE and EmberCat stays A's active name.
  const once=f=>{let used=false;return r=>{if(used)return r;used=true;return f(r);};};
  let undo=stale(w,{claim:once(()=>null)});
  const taken=await rename(a2.b,ma,'Rival');undo();
  assert.equal(taken.status,409);assert.deepEqual(await body(taken),{error:'NAME_UNAVAILABLE'});
  assert.deepEqual(rows(w,"SELECT name_key,claim_type FROM nickname_claims WHERE member_id IS NOT NULL ORDER BY name_key"),
    [{name_key:'embercat',claim_type:'active'},{name_key:'rival',claim_type:'active'}],'no reservation left behind');
  assert.equal((await member(a2.b)).member.version,ma.member.version);
  // Two members asking for one free name at once: exactly one gets it.
  w.clock.advance(7*DAY);const a3=await signedIn(w,a.account),c3=await signedIn(w,c.account);
  const [x,y]=await Promise.all([rename(a3.b,await member(a3.b),'OnlyOne'),rename(c3.b,await member(c3.b),'OnlyOne')]);
  assert.deepEqual([x.status,y.status].sort(),[200,409]);
  assert.equal(rows(w,"SELECT count(*) n FROM nickname_claims WHERE name_key='onlyone'")[0].n,1);
  // A stale read of the version (another tab saved meanwhile): the guard row fails its CHECK; nothing moves.
  const now=await member(a3.b),before=rows(w,'SELECT * FROM nickname_claims ORDER BY name_key');
  w.clock.advance(7*DAY);const a4=await signedIn(w,a.account);const cur=await member(a4.b);
  undo=stale(w,{member:once(r=>r&&{...r,version:r.version-1})});
  const moved=await put(a4.b,{displayName:'Later',expectedActorPublicId:cur.member.publicMemberId,expectedProfileVersion:cur.member.version-1,requestId:nextId()});undo();
  assert.equal(moved.status,409);assert.deepEqual(await body(moved),{error:'PROFILE_VERSION_CONFLICT'});
  assert.deepEqual(rows(w,'SELECT * FROM nickname_claims ORDER BY name_key'),before);
  assert.equal(now.member.publicMemberId,cur.member.publicMemberId);
});

test('E7 E49: logout and session expiry end nothing of the member: same member, coins and life after signing in again',async()=>{
  const w=setup(),{b,account}=await signedIn(w),me=await body(await rename(b,await member(b),'EmberCat'));
  await b.post('/api/auth/logout');w.clock.advance(8*DAY);
  const again=await signedIn(w,account),back=await member(again.b);
  assert.equal(back.member.publicMemberId,me.member.publicMemberId);assert.equal(back.member.displayName,'EmberCat');
  assert.deepEqual([back.economy,back.life],[{available:0,reserved:0},{state:'not_started',lifeNumber:1}]);
  assert.equal(rows(w,'SELECT last_login_at FROM wallet_identities')[0].last_login_at,START+8*DAY,'last login, hourly');
  // The page's own read (GET) keeps it too, at most hourly.
  w.clock.advance(30*60_000);assert.equal((await again.b.get('/api/me/profile')).status,200);
  assert.equal(rows(w,'SELECT last_login_at FROM wallet_identities')[0].last_login_at,START+8*DAY,'not within the hour');
  w.clock.advance(31*60_000);assert.equal((await again.b.get('/api/me/profile')).status,200);
  assert.equal(rows(w,'SELECT last_login_at FROM wallet_identities')[0].last_login_at,START+8*DAY+61*60_000);
});

test('503, not "new member": no database, or a database before migrations/0006; sign-in itself still works',async()=>{
  const files=migrationFiles().filter(f=>f<'0006');
  const w=setup();w.env.DB=openD1(files);
  const {b}=await signedIn(w);
  for(const r of [await b.post('/api/me/bootstrap'),await b.get('/api/me/profile'),await w.browser().get('/api/world/names/0x'+'1'.repeat(40))]){
    assert.equal(r.status,503);assert.deepEqual(await body(r),{error:'PROFILE_UNAVAILABLE'});assertApiHeaders(r,'503');}
  delete w.env.DB;
  assert.equal((await b.post('/api/me/bootstrap')).status,503);
  const fresh=setup(),s=await signedIn(fresh);
  const nf=await s.b.get('/api/me/profile');assert.equal(nf.status,404);assert.deepEqual(await body(nf),{error:'MEMBER_NOT_FOUND'});
  assert.equal(count(fresh,'members'),0,'GET never creates');
});

test('the member routes leave the account routes as they were',async()=>{
  const w=setup(),{b}=await signedIn(w);
  assert.equal((await b.get('/api/me/other')).status,404,'other /api/me paths: still server/auth.ts');
  assert.equal((await b.get('/api/me/home')).status,200);
  assert.equal((await b.get('/api/world/names')).status,404,'only /names/<address>');
});
