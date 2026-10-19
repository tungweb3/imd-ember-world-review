import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/app.ts';
import {ReadGateway} from '../server/gateway.ts';
import {reviewedEconomyConfig} from '../server/economy-deployment.ts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {openD1} from './d1-sqlite.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';

const NOW=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),cookie='w'.repeat(43),origin='https://imdember.com';
const noFetch=async()=>{throw Error('No public network permitted in worker tests');};
const context=()=>({kept:[],waitUntil(p){this.kept.push(p);}});
const request=(path,init={})=>new Request(origin+path,{...init,headers:{origin,cookie:SESSION_COOKIE+'='+cookie,...init.headers}});
const assets={fetch:async()=>new Response('asset')};
const candidate=()=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[]});
const worker=(economy)=>createWorker(new ReadGateway(noFetch),noFetch,()=>NOW,[],()=>undefined,economy);

test('deployed entry pins owner-signed mainnet contracts; environment/query cannot replace the release configuration',async()=>{
 const actual=await reviewedEconomyConfig();const {id,...binding}=actual;
 assert.deepEqual(binding,{chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0xf110043728e6338e19d41f1d02f02a575070eda9',paymentContract:'0x0b9653941b0dbf967f2ef27b7563a0fed303bac6',treasury:ECONOMY_TREASURY,deploymentBlock:'26222887',catalogue:[]});
 assert.match(id,/^[0-9a-f]{64}$/);assert.notEqual(id,(await candidate()).id);
 const f=worker(),env={ASSETS:assets,ECONOMY_ENABLED:'true',ECONOMY_REVIEWED:'true',ECONOMY_CONFIG:await candidate()};
 const cfg=await f.fetch(request('/api/economy/config'),env,context());assert.equal(cfg.status,200);const publicConfig=await cfg.json();assert.equal(publicConfig.enabled,true);assert.equal(publicConfig.stakingContract,binding.stakingContract);assert.equal(publicConfig.paymentContract,binding.paymentContract);assert.deepEqual(publicConfig.catalogue,[]);assert.equal(cfg.headers.get('cache-control'),'no-store');
 for(const path of ['/api/me/economy?expected_address='+W,'/api/economy/orders']){const r=await f.fetch(request(path),env,context());assert.equal(r.status,path.includes('/orders')?405:503);}
 assert.equal((await f.fetch(request('/api/economy/config?enabled=1'),env,context())).status,400);
 assert.equal((await f.fetch(request('/api/economy/config',{headers:{origin:'https://evil.example'}}),env,context())).status,403);
 assert.equal((await f.fetch(request('/api/economy/credit',{method:'POST'}),env,context())).status,404);
});

test('a closed release adapter cannot be activated by old wallet review flags or environment values',async()=>{
 const f=worker({config:async()=>null}),env={ASSETS:assets,ECONOMY_ENABLED:'true',ECONOMY_REVIEWED:'true',ECONOMY_CONFIG:await candidate()};
 assert.equal((await(await f.fetch(request('/api/economy/config'),env,context())).json()).enabled,false);
 assert.equal((await f.fetch(request('/api/me/economy?expected_address='+W),env,context())).status,503);
});

test('economy HTTP route uses only its own required budget and never identity/NFT buckets',async()=>{
 const db=openD1();try{
  const tokenHash=await sha256(cookie);db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(tokenHash,W,1,NOW-1,NOW+60000,'worker-economy-session','EOA','ECDSA');
  const config=await candidate(),f=worker({config:async()=>config}),keys=[];
  const forbidden={limit:async()=>{throw Error('Original identity budget was touched');}},env={DB:db,ASSETS:assets,API_LIMITER:forbidden,AUTH_LIMITER:forbidden,CHAIN_LIMITER:forbidden,ECONOMY_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}}};
  const path='/api/me/economy?expected_address='+W,r=await f.fetch(request(path),env,context());assert.equal(r.status,200);assert.equal((await r.json()).gold,'0');assert.deepEqual(keys,['economy:ip:unknown']);
  delete env.ECONOMY_LIMITER;assert.equal((await f.fetch(request(path),env,context())).status,503);
  env.ECONOMY_LIMITER={limit:async()=>({success:false})};assert.equal((await f.fetch(request(path),env,context())).status,429);
 }finally{db.raw.close();}
});

test('failed release configuration remains disabled without exposing private error details',async()=>{
 const f=worker({config:async()=>{throw Error('private deployment evidence path');}}),r=await f.fetch(request('/api/economy/config'),{ASSETS:assets},context());
 assert.equal(r.status,200);const text=await r.text();assert.equal(JSON.parse(text).enabled,false);assert.equal(text.includes('private deployment'),false);
});

test('minute economy cron has an independent RPC budget and leaves presence and original housekeeping untouched',async()=>{
 const db=openD1(),config=await candidate(),calls=[],H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),Q=n=>'0x'+BigInt(n).toString(16);
 try{
  const rpc=async(method,params)=>{calls.push(method);if(method==='eth_chainId')return '0x1';if(method==='eth_getLogs')return [];if(method==='eth_getBlockByNumber'){const n=params[0]==='finalized'?100:Number(BigInt(params[0]));return {number:Q(n),hash:H(n),parentHash:H(n-1),timestamp:Q(NOW/1000+(n-100)),gasLimit:Q(30000000)};}throw Error('Unexpected financial RPC');};
  const f=worker({config:async()=>config,rpc:()=>rpc}),ctx=context(),keys=[],forbidden={limit:async()=>{throw Error('Identity budget used');}},env={DB:db,ASSETS:assets,AUTH_LIMITER:forbidden,CHAIN_LIMITER:forbidden,API_LIMITER:forbidden,ECONOMY_CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);return {success:true};}}};
  await f.scheduled({scheduledTime:NOW,cron:'* * * * *'},env,ctx);await Promise.all(ctx.kept);assert.equal(ctx.kept.length,1);assert.ok(calls.length>3);assert.equal(keys.length,calls.length);assert.ok(keys.every(k=>k==='economy:rpc'));assert.equal(db.raw.prepare('SELECT last_block n FROM economy_chain_state').get().n,100);
  for(const table of ['sessions','seat_presence','profile_history','index_lane_probes'])assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  const paused=worker({config:async()=>null,rpc:()=>{throw Error('Disabled gate reached provider');}}),closed=context();await paused.scheduled({scheduledTime:NOW,cron:'* * * * *'},env,closed);await Promise.all(closed.kept);assert.equal(keys.length,calls.length);
 }finally{db.raw.close();}
});
