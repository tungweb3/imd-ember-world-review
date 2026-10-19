import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionResult,decodeFunctionData,multicall3Abi} from 'viem';
import {handleMemberBalances,readWalletEmbeo} from '../server/member-balances.ts';
import {ECONOMY_TOKEN,ECONOMY_SHARE_WEI} from '../server/economy-config.ts';
import {MULTICALL3,ALCHEMY_RPC_URL} from '../server/ownership.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {fixture,NOW,W,B} from './world-gold-audit5-fixture.mjs';
import {reserveMintGold} from '../server/world-gold.ts';
import {MemberBalancesClient,parseMemberBalances} from '../src/world/memberBalancesClient.ts';
import {createWorker} from '../worker/app.ts';
import {ReadGateway} from '../server/gateway.ts';

const TOKEN='b'.repeat(43),hex=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const chain=(amount=1234567890123456789000000n,chainId=1n,observer=()=>{})=>({key:'fixture-backend-only',fetch:async(url,init)=>{
 observer(url,init);return Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:[{success:true,returnData:hex(1000)},{success:true,returnData:hex(chainId)},{success:true,returnData:hex(amount)}]})});
}});
async function memberFixture(){const f=await fixture(),hash=await sha256(TOKEN);f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(hash,W,1,NOW-1,NOW+60000,'member-balance','EOA','ECDSA');return {...f,hash,deps:{db:f.db,config:async()=>f.config,chain:chain(),now:()=>NOW,allow:async()=>true,client:'fixture'}};}
const req=(address=W,patch={})=>new Request('https://imdember.com/api/me/balances?expected_address='+address,{headers:{cookie:SESSION_COOKIE+'='+TOKEN},...patch});

test('one fixed mainnet Multicall reads the complete precise wallet balance and block, with credentials only in the upstream header',async()=>{
 let calls=0;const c=chain(1234567890123456789000000n,1n,(url,init)=>{
  calls++;assert.equal(url,ALCHEMY_RPC_URL);assert.equal(init.headers.authorization,'Bearer fixture-backend-only');
  const body=JSON.parse(init.body);assert.equal(body.method,'eth_call');assert.equal(body.params[1],'latest');assert.equal(body.params[0].to,MULTICALL3);
  const call=decodeFunctionData({abi:multicall3Abi,data:body.params[0].data});assert.deepEqual(call.args[0].map(c=>c.target.toLowerCase()),[MULTICALL3.toLowerCase(),MULTICALL3.toLowerCase(),ECONOMY_TOKEN]);
 });
 assert.deepEqual(await readWalletEmbeo(c,W),{status:'ok',atomic:'1234567890123456789000000',block:'1000'});assert.equal(calls,1);
 await assert.rejects(readWalletEmbeo(chain(0n,31337n),W),/BALANCE_UNAVAILABLE/);
 await assert.rejects(readWalletEmbeo({key:'fixture',fetch:async()=>Response.json({error:{message:'secret provider details'}})},W));
});

test('member summary uses the shared held/available book and totals every stake beyond the positions UI page',async()=>{
 const f=await memberFixture();try{
  await f.topup();await reserveMintGold(f.db,f.mint(),NOW,()=>NOW);
  const insert=f.db.raw.prepare('INSERT INTO economy_positions(config_id,position_id,position_key,wallet,deposited_ms,initial_shares,remaining_shares) VALUES(?,?,?,?,?,?,?)');
  for(let i=1;i<=241;i++)insert.run(f.config.id,String(i),'member-position-'+i,W,NOW,2,2);
  const r=await handleMemberBalances(req(),f.deps),s=await r.json();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal(s.wallet,W);assert.equal(s.staked.atomic,String(482n*ECONOMY_SHARE_WEI));assert.deepEqual(s.gold,{status:'ok',available:'2',book:'10',reserved:'8'});
  assert.equal(JSON.stringify(s).includes(TOKEN),false);assert.equal(JSON.stringify(s).includes(f.hash),false);
 }finally{f.close();}
});

test('unknown index/config and independent RPC failures stay distinct from a confirmed zero',async()=>{
 const f=await memberFixture();try{
  let s=await (await handleMemberBalances(req(),f.deps)).json();assert.deepEqual(s.staked,{status:'indexing'});
  s=await (await handleMemberBalances(req(),{...f.deps,config:async()=>null})).json();assert.equal(s.embeo.status,'ok');assert.deepEqual(s.staked,{status:'not-configured'});assert.deepEqual(s.gold,{status:'ok',book:'0',reserved:'0',available:'0'});
  await f.topup();s=await (await handleMemberBalances(req(),{...f.deps,chain:chain(0n),allow:async bucket=>bucket!=='chain'})).json();assert.deepEqual(s.embeo,{status:'unavailable'});assert.equal(s.staked.atomic,'0');assert.equal(s.gold.available,'10');
 }finally{f.close();}
});

test('cross-wallet/origin/method/extra-query and missing sessions cannot trigger keyed reads',async()=>{
 const f=await memberFixture();try{let calls=0;const deps={...f.deps,chain:chain(0n,1n,()=>calls++)};
  for(const [r,status]of [[req(B),409],[req(W,{method:'POST'}),405],[req(W,{headers:{origin:'https://evil.invalid'}}),403],[new Request('https://imdember.com/api/me/balances?expected_address='+W+'&rpc=https://evil.invalid'),400],[req(W,{headers:{}}),401]]){assert.equal((await handleMemberBalances(r,deps)).status,status);}
  assert.equal(calls,0);
 }finally{f.close();}
});

test('logout or session expiry during a slow chain read discards all balance results',async()=>{
 for(const expired of [false,true]){const f=await memberFixture();try{let now=NOW;
  const deps={...f.deps,now:()=>now,chain:chain(1n,1n,()=>{if(expired)now=NOW+60000;else f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW+1);})};
  const r=await handleMemberBalances(req(),deps);assert.equal(r.status,401);assert.equal(Object.hasOwn(await r.json(),'embeo'),false);
 }finally{f.close();}}
});

test('deployed Worker route uses the same authenticated balance handler and release configuration',async()=>{
 const f=await memberFixture();try{
  const worker=createWorker(new ReadGateway(),chain().fetch,()=>NOW,undefined,()=>undefined,{config:async()=>f.config});
  const limiter={limit:async()=>({success:true})};
  const r=await worker.fetch(req(),{DB:f.db,ALCHEMY_API_KEY:'fixture',AUTH_LIMITER:limiter,CHAIN_LIMITER:limiter,ASSETS:{fetch:async()=>Response.json({wrong:'static fallback'})}},{waitUntil(){}});
  const s=await r.json();assert.equal(r.status,200);assert.equal(s.wallet,W);assert.equal(s.embeo.status,'ok');assert.equal(s.staked.status,'indexing');
 }finally{f.close();}
});

const auth=()=>({account:W,session:{address:W,expiresAt:NOW+60000},phase:'idle',home:null,expired:false,ended:null,sessionKnown:true,leaving:false,waiting:false});
const summary=()=>({wallet:W,asOf:NOW,embeo:{status:'ok',atomic:'0',block:'100'},staked:{status:'indexing'},gold:{status:'ok',available:'2',book:'10',reserved:'8'}});
test('balance client refuses late responses after account switching, logout, expiry or abort',async()=>{
 for(const mutation of ['switch','logout','expiry','abort']){let state=auth(),clock=NOW;const abort=new AbortController(),client=new MemberBalancesClient({auth:()=>state,now:()=>clock,fetch:async()=>{if(mutation==='switch')state={...state,account:B};if(mutation==='logout')state={...state,session:null};if(mutation==='expiry')clock=NOW+60000;if(mutation==='abort')abort.abort();return Response.json(summary());}});await assert.rejects(client.read(abort.signal),/CONTEXT_CHANGED/);}
});
test('client preserves integers without rounding and refuses inconsistent ledger or foreign-wallet responses',async()=>{
 assert.equal(parseMemberBalances(summary(),W).gold.available,'2');
 for(const edit of [s=>s.wallet=B,s=>s.embeo.atomic=0,s=>s.embeo.atomic='00',s=>s.gold.available='3',s=>s.staked={status:'unavailable',atomic:'0'}]){const s=summary();edit(s);assert.throws(()=>parseMemberBalances(s,W),/INVALID_RESPONSE/);}
 let request;const state=auth(),client=new MemberBalancesClient({auth:()=>state,now:()=>NOW,fetch:async(...args)=>{request=args;return Response.json(summary());}});await client.read();assert.match(request[0],new RegExp('expected_address='+W));assert.equal(request[1].cache,'no-store');assert.equal(request[1].credentials,'same-origin');
});
