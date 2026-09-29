// Scratch-only: calls the REAL server/auth.ts handleAccountApi -> challenge() -> viem/siwe createSiweMessage with a
// synthetic key's address against the real migrations (0001 + 0002 + 0003) on node:sqlite, and the REAL page-side check
// src/world/siwe.ts checkSignInMessage on the message it returns.
// No network: the only "chain" is a local stub that answers eth_getCode with "0x" (no contract code). No production key;
// the synthetic keys live only in memory and no signature is written out.
// Usage (inside a copy of source/ after npm ci; see TESTS/README.md): cp ../TESTS/siwe-sample/generate-siwe-sample.mjs _tmp_siwe.mjs && node _tmp_siwe.mjs <output file>; rm _tmp_siwe.mjs
import {writeFileSync} from 'node:fs';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {parseSiweMessage} from 'viem/siwe';
import {handleAccountApi,FLOW_COOKIE,SESSION_COOKIE,NETWORK_CHALLENGE_BUDGET,WALLET_CHALLENGE_BUDGET} from './server/auth.ts';
import {checkSignInMessage,signInSummary} from './src/world/siwe.ts';
import {openD1} from './tests/d1-sqlite.mjs';
const out=process.argv[2];
const key=()=>privateKeyToAccount(generatePrivateKey());
const acct=key(),other=key();
const db=openD1();const T0=Date.parse('2026-09-29T12:00:00.000Z');let NOW=T0;
const rpcCalls=[],logs=[];
const noCode={key:'local-stub',fetch:async(_url,init)=>{const m=JSON.parse(init.body).method;rpcCalls.push(m);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x'}),{headers:{'content-type':'application/json'}});}};
// client: the network key worker/app.ts networkKey derives from cf-connecting-ip (here a documentation range, RFC 5737).
// log: the handler's one-line refusal log (evt auth_refused), captured instead of printed.
const deps={db,now:()=>NOW,chain:noCode,ownership:{},client:'net:203.0.113.0/24',colo:'TEST',noCode:new Map(),log:l=>logs.push(l)};
const H={origin:'https://imdember.com','content-type':'application/json'};
const post=(path,body,extra={},d=deps)=>handleAccountApi(new Request('https://imdember.com'+path,{method:'POST',headers:{...H,...extra},body:JSON.stringify(body)}),d);
const get=(path,extra={},d=deps)=>handleAccountApi(new Request('https://imdember.com'+path,{headers:extra}),d);
const cookieOf=(r,name)=>(new RegExp(name+'=([^;]*)').exec(r.headers.getSetCookie().join('\n'))??[])[1];
const show=async r=>'HTTP '+r.status+' '+(r.status===200||r.status===204?'':JSON.stringify(await r.json()))+(r.headers.get('retry-after')?' Retry-After: '+r.headers.get('retry-after'):'');
const r=await post('/api/auth/challenge',{address:acct.address.toLowerCase()});
const body=await r.json(),setCookie=r.headers.getSetCookie().join(', '),flow=cookieOf(r,FLOW_COOKIE);
// the page's own check (src/world/siwe.ts), as src/world/auth.ts runs it before personal_sign
const check=o=>checkSignInMessage(body.message,{origin:'https://imdember.com',account:acct.address,nonce:body.nonce,now:NOW,...o});
const pageChecks={asServed:check({}),otherOrigin:check({origin:'https://evil.example'}),otherAccount:check({account:other.address}),otherNonce:check({nonce:'0'.repeat(32)}),clockOff11min:check({now:NOW+11*60_000}),
  crlf:checkSignInMessage(body.message.replace(/\n/g,'\r\n'),{origin:'https://imdember.com',account:acct.address,nonce:body.nonce,now:NOW}),
  extraLine:checkSignInMessage(body.message+'\nResources:',{origin:'https://imdember.com',account:acct.address,nonce:body.nonce,now:NOW})};
const sig=await acct.signMessage({message:body.message});
const badOrigin=await post('/api/auth/verify',{nonce:body.nonce,signature:sig},{origin:'https://evil.example',cookie:FLOW_COOKIE+'='+flow});
const noFlow=await post('/api/auth/verify',{nonce:body.nonce,signature:sig});
const v=await post('/api/auth/verify',{nonce:body.nonce,signature:sig},{cookie:FLOW_COOKIE+'='+flow});
const vc=v.headers.getSetCookie().join(', '),vb=await v.json(),tokenA=cookieOf(v,SESSION_COOKIE);
const replay=await post('/api/auth/verify',{nonce:body.nonce,signature:sig},{cookie:FLOW_COOKIE+'='+flow});
// a second challenge, verified after its 5-minute window
const r2=await post('/api/auth/challenge',{address:acct.address});const b2=await r2.json(),f2=cookieOf(r2,FLOW_COOKIE);
const s2=await acct.signMessage({message:b2.message});NOW+=5*60_000;
const late=await post('/api/auth/verify',{nonce:b2.nonce,signature:s2},{cookie:FLOW_COOKIE+'='+f2});
// a third challenge: a signature by ANOTHER key (valid ECDSA, wrong signer) is refused and burns the challenge, so the
// right signature sent afterwards for the same nonce is refused as well
const r3=await post('/api/auth/challenge',{address:acct.address});const b3=await r3.json(),f3=cookieOf(r3,FLOW_COOKIE);
const before=rpcCalls.length;
const wrong=await post('/api/auth/verify',{nonce:b3.nonce,signature:await other.signMessage({message:b3.message})},{cookie:FLOW_COOKIE+'='+f3});
const afterBurn=await post('/api/auth/verify',{nonce:b3.nonce,signature:await acct.signMessage({message:b3.message})},{cookie:FLOW_COOKIE+'='+f3});
const wrongRpc=rpcCalls.slice(before);
const row3=db.raw.prepare('SELECT net,checked_at IS NOT NULL AS checked,invalidated_at IS NOT NULL AS burnt,used_at FROM login_challenges WHERE nonce=?').get(b3.nonce);
// the same wrong key again on a fresh challenge: the address's "no code" answer is cached, so no chain call at all
const r4=await post('/api/auth/challenge',{address:acct.address});const b4=await r4.json(),f4=cookieOf(r4,FLOW_COOKIE);
const before4=rpcCalls.length;
const wrong2=await post('/api/auth/verify',{nonce:b4.nonce,signature:await other.signMessage({message:b4.message})},{cookie:FLOW_COOKIE+'='+f4});
const wrong2Rpc=rpcCalls.slice(before4);
// the per-wallet cooldown (L2): one address from one network, WALLET_CHALLENGE_BUDGET a minute; the same address from
// another network is not affected
NOW+=60_000;const w=key(),wallet=[];
for(let i=0;i<=WALLET_CHALLENGE_BUDGET;i++)wallet.push(await show(await post('/api/auth/challenge',{address:w.address})));
const walletElsewhere=await post('/api/auth/challenge',{address:w.address},{},{...deps,client:'net:198.51.100.0/24'});
// the per-network challenge budget (L1): one minute later, one network asks NETWORK_CHALLENGE_BUDGET + 1 times, each for
// a different synthetic address (so the wallet cooldown never applies)
NOW+=60_000;const burst=[];
for(let i=0;i<NETWORK_CHALLENGE_BUDGET;i++)burst.push((await post('/api/auth/challenge',{address:key().address})).status);
const refused=await post('/api/auth/challenge',{address:key().address});
const elsewhere=await post('/api/auth/challenge',{address:key().address},{},{...deps,client:'net:198.51.100.0/24'});
// logout-all (F-4): a second browser of the same address signs in; the first asks /api/auth/logout-all
const r5=await post('/api/auth/challenge',{address:acct.address},{},{...deps,client:'net:198.51.100.0/24'});const b5=await r5.json(),f5=cookieOf(r5,FLOW_COOKIE);
const v5=await post('/api/auth/verify',{nonce:b5.nonce,signature:await acct.signMessage({message:b5.message})},{cookie:FLOW_COOKIE+'='+f5},{...deps,client:'net:198.51.100.0/24'});
const tokenB=cookieOf(v5,SESSION_COOKIE);
const sessionB1=await (await get('/api/auth/session',{cookie:SESSION_COOKIE+'='+tokenB})).json();
const noSession=await post('/api/auth/logout-all',{});
const all=await post('/api/auth/logout-all',{},{cookie:SESSION_COOKIE+'='+tokenA});const allBody=await all.json();
const sessionB2=await (await get('/api/auth/session',{cookie:SESSION_COOKIE+'='+tokenB})).json();
const rows=db.raw.prepare('SELECT token_hash,address,chain_id,created_at,expires_at,revoked_at,wallet_type,verification_method FROM sessions').all();
const redact=s=>s.replace(/(__Host-imd_(?:flow|session)=)[^;,]+/g,'$1<REDACTED>');
const p=parseSiweMessage(body.message);
const count=a=>Object.entries(a.reduce((m,s)=>(m[s]=(m[s]??0)+1,m),{})).map(([s,n])=>n+' x '+s).join(', ');
const lines=[
'# De-sensitized SIWE sample, IMD Ember World (source commit 2da46cdafcf8ad3fb3571ea0273ecc5d1ab5be1d, the commit of live Worker version 50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f)',
'# Produced by calling the real handler server/auth.ts handleAccountApi -> challenge() -> viem/siwe createSiweMessage (server/auth.ts:297-298)',
'# on this snapshot\'s source/, against migrations/0001 + 0002 + 0003 on node:sqlite (in-memory, tests/d1-sqlite.mjs).',
'# Address: a freshly generated SYNTHETIC local key (in memory only, discarded; controls no funds). Nonce: server-generated random (crypto.getRandomValues, 16 bytes hex), local DB only.',
'# Clock fixed at '+new Date(T0).toISOString()+'. No request was made to imdember.com or any network (the chain is a local stub answering eth_getCode "0x"); no signature is included in this file.',
'# The page checks the text line by line (src/world/siwe.ts checkSignInMessage) and only then sends it hex-encoded (UTF-8) as personal_sign params [hexUtf8(message), account] (src/world/auth.ts:203-207).',
'',
'----- BEGIN EXACT MESSAGE (as returned in POST /api/auth/challenge .message) -----',
body.message,
'----- END EXACT MESSAGE -----',
'',
'# Parsed fields (viem parseSiweMessage):',
...Object.entries(p).map(([k,val])=>'#   '+k+': '+(val instanceof Date?val.toISOString():JSON.stringify(val))),
'#   notBefore / requestId / resources: '+JSON.stringify({notBefore:p.notBefore??null,requestId:p.requestId??null,resources:p.resources??null}),
'# Page-side check (checkSignInMessage; true = the wallet is asked to sign): '+JSON.stringify(pageChecks),
'# Page-side summary shown while the wallet is open (signInSummary): '+JSON.stringify({...signInSummary(body.message),address:'<the synthetic address above>'}),
'',
'# challenge response: HTTP '+r.status+'  body keys: '+Object.keys(body).join(', ')+'  acceptUntil='+new Date(body.acceptUntil).toISOString(),
'# challenge Set-Cookie: '+redact(setCookie),
'# challenge Cache-Control: '+r.headers.get('cache-control')+'  Strict-Transport-Security: '+r.headers.get('strict-transport-security'),
'# verify with Origin https://evil.example: HTTP '+badOrigin.status+' '+JSON.stringify(await badOrigin.json()),
'# verify without the flow cookie: HTTP '+noFlow.status+' '+JSON.stringify(await noFlow.json()),
'# local verify with the synthetic key: HTTP '+v.status+'  body keys: '+Object.keys(vb).join(', ')+'  expiresAt='+new Date(vb.expiresAt).toISOString(),
'# verify Set-Cookie: '+redact(vc),
'# same nonce+signature replayed: HTTP '+replay.status+' '+JSON.stringify(await replay.json()),
'# a second challenge verified exactly 5 min after issue: HTTP '+late.status+' '+JSON.stringify(await late.json()),
'# a third challenge signed by another synthetic key: '+await show(wrong)+'  chain calls: '+(wrongRpc.join(',')||'none')+' (the ERC-1271 path: the address has no code, so no eth_call)',
'#   then the right signature for the same nonce: '+await show(afterBurn)+'  (the failed verify burnt the challenge)',
'#   that challenge row: '+JSON.stringify(row3),
'# a fourth challenge, again signed by the wrong key: '+await show(wrong2)+'  chain calls: '+(wrong2Rpc.join(',')||'none')+' (the "no code" answer is cached per address for 60 s)',
'# '+(WALLET_CHALLENGE_BUDGET+1)+' challenges for ONE address from one network within a minute: '+count(wallet),
'#   the same address from another network at the same moment: '+await show(walletElsewhere),
'# '+(NETWORK_CHALLENGE_BUDGET)+' challenges for different addresses from one network within a minute: '+count(burst)+'; the next one: '+await show(refused),
'#   a challenge from another network at the same moment: HTTP '+elsewhere.status,
'# logout-all: a second browser of the same address signed in ('+JSON.stringify({signedIn:sessionB1.signedIn})+'); logout-all without a session: '+await show(noSession),
'#   logout-all from the first browser: HTTP '+all.status+' '+JSON.stringify(allBody)+'; Set-Cookie: '+redact(all.headers.getSetCookie().join(', ')),
'#   the second browser afterwards: GET /api/auth/session -> '+JSON.stringify(sessionB2),
'# refusal log lines written by the handler (one JSON line per 429/503; no IP, address, cookie, token, signature or message):',
...logs.map(l=>'#   '+l),
'# sessions table after the run (token_hash is SHA-256 of the cookie token, 64 hex chars): '+JSON.stringify(rows.map(x=>({token_hash_len:String(x.token_hash).length,chain_id:x.chain_id,ttl_days:(x.expires_at-x.created_at)/86400000,revoked:x.revoked_at!==null,wallet_type:x.wallet_type,verification_method:x.verification_method}))),
];
writeFileSync(out,lines.join('\n')+'\n');
console.log(lines.join('\n'));
