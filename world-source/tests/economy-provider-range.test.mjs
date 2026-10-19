import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {createEconomyRpc,syncEconomyChain,ECONOMY_EVENT_TOPICS} from '../server/economy-rpc.ts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_SHARE_WEI} from '../server/economy-config.ts';
import {createWorker} from '../worker/app.ts';
import {ReadGateway} from '../server/gateway.ts';
const T=Date.UTC(2026,9,19),W='0x'+'a'.repeat(40),V='0x'+'1'.repeat(40),P='0x'+'2'.repeat(40);
const Q=n=>'0x'+BigInt(n).toString(16),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),U=n=>BigInt(n).toString(16).padStart(64,'0');
const cfg=()=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,treasury:ECONOMY_TREASURY,stakingContract:V,paymentContract:P,deploymentBlock:'100',catalogue:[]});
const header=n=>({number:Q(n),hash:H(n),parentHash:H(n-1),timestamp:Q(T/1000+n-100),gasLimit:Q(96000000)});
const stake=n=>({address:V,topics:[ECONOMY_EVENT_TOPICS.stake,'0x'+W.slice(2).padStart(64,'0'),'0x'+U(n+1)],data:'0x'+U(2)+U(2n*ECONOMY_SHARE_WEI),transactionHash:H(10000+n),blockNumber:Q(n),blockHash:H(n),logIndex:'0x0',removed:false});
function provider({head=227,logs=[],patch}={}){
 const calls=[];
 const rpc=createEconomyRpc({key:'SYNTHETIC_PROVIDER_KEY_NOT_A_REAL_CREDENTIAL',fetch:async(_url,options)=>{
  const {method,params}=JSON.parse(options.body);calls.push({method,params});let value;
  if(method==='eth_chainId')value='0x1';
  else if(method==='eth_getBlockByNumber')value=header(params[0]==='finalized'?head:Number(BigInt(params[0])));
  else if(method==='eth_getLogs'){
   const f=params[0],from=Number(BigInt(f.fromBlock)),to=Number(BigInt(f.toBlock));
   if(to-from+1>10)return Response.json({error:{code:-32600,message:'Free tier block range restriction'}},{status:400});
   value=logs.filter(l=>BigInt(l.blockNumber)>=BigInt(from)&&BigInt(l.blockNumber)<=BigInt(to));
  }else if(method==='eth_getTransactionReceipt'){
   const l=logs.find(l=>l.transactionHash===params[0]);value=l?{status:'0x1',transactionHash:l.transactionHash,blockNumber:l.blockNumber,blockHash:l.blockHash,from:W,to:V,logs:[l]}:null;
  }else throw Error('Unexpected fixture RPC');
  return Response.json({result:patch?patch(method,params,value):value});
 }});return{rpc,calls};
}
const count=(db,table)=>db.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n;
test('reproduces the observed HTTP400/-32600 provider rejection of an unpaged128-block query',async()=>{
 const db=openD1(),f=provider();try{await assert.rejects(syncEconomyChain(db,await cfg(),{rpc:f.rpc,nowMs:T+900000}),/ECONOMY_RPC_UNAVAILABLE/);assert.equal(count(db,'economy_chain_events'),0);}finally{db.raw.close();}
});
test('ten-block RPC slices still advance a complete128-block canonical page',async()=>{
 const db=openD1(),f=provider();try{const r=await syncEconomyChain(db,await cfg(),{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange:10});assert.equal(r.toBlock,'227');const slices=f.calls.filter(c=>c.method==='eth_getLogs');assert.equal(slices.length,13);assert.equal(slices[0].params[0].fromBlock,Q(100));assert.equal(slices.at(-1).params[0].toBlock,Q(227));assert.ok(slices.every(c=>BigInt(c.params[0].toBlock)-BigInt(c.params[0].fromBlock)<10n));}finally{db.raw.close();}
});
test('logs at both sides of chunk boundaries keep exact receipts and commit once',async()=>{
 const db=openD1(),logs=[100,109,110,227].map(stake),f=provider({logs});try{const c=await cfg();await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange:10});await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange:10});assert.equal(count(db,'economy_chain_events'),4);assert.equal(count(db,'economy_positions'),4);assert.equal(f.calls.filter(c=>c.method==='eth_getTransactionReceipt').length,4);}finally{db.raw.close();}
});
test('combined log pressure narrows canonical pages without dropping later chunks',async()=>{
 const db=openD1(),logs=[100,109,110,127].map(stake),f=provider({head:127,logs});try{const c=await cfg();for(let i=0;i<8;i++)await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange:10,maxLogs:2});assert.equal(count(db,'economy_chain_events'),4);assert.equal(count(db,'economy_positions'),4);assert.equal(db.raw.prepare('SELECT last_block n FROM economy_chain_state').get().n,127);}finally{db.raw.close();}
});
test('a log returned for the wrong subrange cannot masquerade as complete coverage',async()=>{
 const db=openD1(),f=provider({head:127,patch:(m,p,v)=>m==='eth_getLogs'&&p[0].fromBlock===Q(100)?[stake(110)]:v});try{await assert.rejects(syncEconomyChain(db,await cfg(),{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange:10}),/LOG_OUTSIDE_FINALIZED_RANGE/);assert.equal(count(db,'economy_chain_events'),0);}finally{db.raw.close();}
});
test('failure in a later subrange commits no earlier partial positions or balance',async()=>{
 const db=openD1(),f=provider({head:127,logs:[stake(100)],patch:(m,p,v)=>m==='eth_getLogs'&&p[0].fromBlock===Q(110)?null:v});try{await assert.rejects(syncEconomyChain(db,await cfg(),{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange:10}),/MALFORMED_RPC_LOGS/);assert.equal(count(db,'economy_positions'),0);assert.equal(count(db,'economy_gold_journal'),0);}finally{db.raw.close();}
});
test('invalid transport spans reject before any provider read',async()=>{
 const db=openD1(),f=provider();try{for(const maxLogBlockRange of[0,129,1.5,NaN])await assert.rejects(syncEconomyChain(db,await cfg(),{rpc:f.rpc,nowMs:T+900000,maxLogBlockRange}),/INVALID_SYNC_LIMIT/);assert.equal(f.calls.length,0);}finally{db.raw.close();}
});
test('the production worker requests ten-block slices and budgets every physical RPC',async()=>{
 const db=openD1(),f=provider(),keys=[],noFetch=async()=>{throw Error('No public network in fixture');};try{
  const c=await cfg(),worker=createWorker(new ReadGateway(noFetch),noFetch,()=>T+900000,[],()=>undefined,{config:async()=>c,rpc:()=>f.rpc});const kept=[];
  await worker.scheduled({scheduledTime:T+900000,cron:'* * * * *'},{DB:db,ECONOMY_CHAIN_LIMITER:{limit:async({key})=>{keys.push(key);return{success:true};}}},{waitUntil:p=>kept.push(p)});await Promise.all(kept);
  assert.equal(db.raw.prepare('SELECT last_block n FROM economy_chain_state').get()?.n,227);assert.equal(keys.length,f.calls.length);assert.ok(keys.every(k=>k==='economy:rpc'));assert.equal(f.calls.filter(c=>c.method==='eth_getLogs').length,13);
 }finally{db.raw.close();}
});
