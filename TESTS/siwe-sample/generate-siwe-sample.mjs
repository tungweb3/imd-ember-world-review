// Scratch-only: calls the REAL server/auth.ts handleAccountApi -> challenge() -> viem/siwe createSiweMessage with a
// synthetic key's address against the real migrations (0001 + 0002) on node:sqlite.
// No network: the only "chain" is a local stub that answers eth_getCode with "0x" (no contract code). No production key;
// the synthetic keys live only in memory and no signature is written out.
// Usage (from the snapshot root): cp TESTS/siwe-sample/generate-siwe-sample.mjs source/_tmp_siwe.mjs && cd source && node _tmp_siwe.mjs <output file>; rm _tmp_siwe.mjs
import {writeFileSync} from 'node:fs';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {parseSiweMessage} from 'viem/siwe';
import {handleAccountApi,FLOW_COOKIE,NETWORK_CHALLENGE_BUDGET} from './server/auth.ts';
import {openD1} from './tests/d1-sqlite.mjs';
const out=process.argv[2];
const acct=privateKeyToAccount(generatePrivateKey()),other=privateKeyToAccount(generatePrivateKey());
const db=openD1();const T0=Date.parse('2026-09-28T12:00:00.000Z');let NOW=T0;
const rpcCalls=[];
const noCode={key:'local-stub',fetch:async(_url,init)=>{const m=JSON.parse(init.body).method;rpcCalls.push(m);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x'}),{headers:{'content-type':'application/json'}});}};
// client: the network key worker/app.ts networkKey derives from cf-connecting-ip (here a documentation range, RFC 5737)
const deps={db,now:()=>NOW,chain:noCode,ownership:{},client:'net:203.0.113.0/24'};
const H={origin:'https://imdember.com','content-type':'application/json'};
const post=(path,body,extra={},d=deps)=>handleAccountApi(new Request('https://imdember.com'+path,{method:'POST',headers:{...H,...extra},body:JSON.stringify(body)}),d);
const flowOf=r=>/__Host-imd_flow=([^;]*)/.exec(r.headers.get('set-cookie')??'')[1];
const show=async r=>'HTTP '+r.status+' '+(r.status===200?'':JSON.stringify(await r.json()))+(r.headers.get('retry-after')?' Retry-After: '+r.headers.get('retry-after'):'');
const r=await post('/api/auth/challenge',{address:acct.address.toLowerCase()});
const body=await r.json(),setCookie=r.headers.get('set-cookie')??'',flow=flowOf(r);
const sig=await acct.signMessage({message:body.message});
const badOrigin=await post('/api/auth/verify',{nonce:body.nonce,signature:sig},{origin:'https://evil.example',cookie:FLOW_COOKIE+'='+flow});
const noFlow=await post('/api/auth/verify',{nonce:body.nonce,signature:sig});
const v=await post('/api/auth/verify',{nonce:body.nonce,signature:sig},{cookie:FLOW_COOKIE+'='+flow});
const vc=v.headers.get('set-cookie')??'',vb=await v.json();
const replay=await post('/api/auth/verify',{nonce:body.nonce,signature:sig},{cookie:FLOW_COOKIE+'='+flow});
// a second challenge, verified after its 5-minute window
const r2=await post('/api/auth/challenge',{address:acct.address});const b2=await r2.json(),f2=flowOf(r2);
const s2=await acct.signMessage({message:b2.message});NOW+=5*60_000;
const late=await post('/api/auth/verify',{nonce:b2.nonce,signature:s2},{cookie:FLOW_COOKIE+'='+f2});
// a third challenge: a signature by ANOTHER key (valid ECDSA, wrong signer) is refused and burns the challenge, so the
// right signature sent afterwards for the same nonce is refused as well
const r3=await post('/api/auth/challenge',{address:acct.address});const b3=await r3.json(),f3=flowOf(r3);
const before=rpcCalls.length;
const wrong=await post('/api/auth/verify',{nonce:b3.nonce,signature:await other.signMessage({message:b3.message})},{cookie:FLOW_COOKIE+'='+f3});
const afterBurn=await post('/api/auth/verify',{nonce:b3.nonce,signature:await acct.signMessage({message:b3.message})},{cookie:FLOW_COOKIE+'='+f3});
const wrongRpc=rpcCalls.slice(before);
const row3=db.raw.prepare('SELECT net,checked_at IS NOT NULL AS checked,invalidated_at IS NOT NULL AS burnt,used_at FROM login_challenges WHERE nonce=?').get(b3.nonce);
// the per-network challenge budget: one minute later, the same network asks NETWORK_CHALLENGE_BUDGET + 1 times
NOW+=60_000;const burst=[];
for(let i=0;i<=NETWORK_CHALLENGE_BUDGET;i++)burst.push((await post('/api/auth/challenge',{address:acct.address})).status);
const refused=await post('/api/auth/challenge',{address:acct.address});
const elsewhere=await post('/api/auth/challenge',{address:acct.address},{},{...deps,client:'net:198.51.100.0/24'});
const rows=db.raw.prepare('SELECT token_hash,address,chain_id,created_at,expires_at,revoked_at FROM sessions').all();
const redact=s=>s.replace(/(__Host-imd_(?:flow|session)=)[^;,]+/g,'$1<REDACTED>');
const p=parseSiweMessage(body.message);
const count=a=>Object.entries(a.reduce((m,s)=>(m[s]=(m[s]??0)+1,m),{})).map(([s,n])=>n+' x '+s).join(', ');
const lines=[
'# De-sensitized SIWE sample, IMD Ember World (source commit 0def8cb5b80083d32545c59bc707fbbc92a4758d, the commit of live Worker version beac62be-27ff-40cd-9dc4-3cbbdc6add4b)',
'# Produced by calling the real handler server/auth.ts handleAccountApi -> challenge() -> viem/siwe createSiweMessage (server/auth.ts:177-178)',
'# on this snapshot\'s source/, against migrations/0001_wallet_login.sql + 0002_sign_in_budgets.sql on node:sqlite (in-memory, tests/d1-sqlite.mjs).',
'# Address: a freshly generated SYNTHETIC local key (in memory only, discarded; controls no funds). Nonce: server-generated random (crypto.getRandomValues, 16 bytes hex), local DB only.',
'# Clock fixed at '+new Date(T0).toISOString()+'. No request was made to imdember.com or any network (the chain is a local stub answering eth_getCode "0x"); no signature is included in this file.',
'# The wallet receives this text hex-encoded (UTF-8) as personal_sign params [hexUtf8(message), account] (src/world/auth.ts:196).',
'',
'----- BEGIN EXACT MESSAGE (as returned in POST /api/auth/challenge .message) -----',
body.message,
'----- END EXACT MESSAGE -----',
'',
'# Parsed fields (viem parseSiweMessage):',
...Object.entries(p).map(([k,val])=>'#   '+k+': '+(val instanceof Date?val.toISOString():JSON.stringify(val))),
'#   notBefore / requestId / resources: '+JSON.stringify({notBefore:p.notBefore??null,requestId:p.requestId??null,resources:p.resources??null}),
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
'# '+(NETWORK_CHALLENGE_BUDGET+1)+' challenges from one network within a minute: '+count(burst)+'; the next one: '+await show(refused),
'#   a challenge from another network at the same moment: HTTP '+elsewhere.status,
'# sessions table after the run (token_hash is SHA-256 of the cookie token, 64 hex chars): '+JSON.stringify(rows.map(x=>({token_hash_len:String(x.token_hash).length,chain_id:x.chain_id,ttl_days:(x.expires_at-T0)/86400000,revoked_at:x.revoked_at}))),
];
writeFileSync(out,lines.join('\n')+'\n');
console.log(lines.join('\n'));
