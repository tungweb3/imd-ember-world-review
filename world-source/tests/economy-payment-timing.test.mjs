import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {ethers,createIsolatedProvider,deploy,artifacts,tokenArtifact,TX,EMBEO_RUNTIME} from '../../contracts/test/runtime.mjs';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,economyDigest} from '../server/economy-config.ts';
import {createEconomyOrder,economyWalletSnapshot} from '../server/economy-ledger.ts';
import {syncEconomyChain,ECONOMY_EVENT_TOPICS} from '../server/economy-rpc.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';

// Local EDR only. Its exact EMBEO runtime is installed at the canonical token
// address; eth_chainId and finalized are explicitly adapted for the mainnet-only
// production RPC adapter. There is no public RPC or chain write.
const NOW=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),TOKEN='t'.repeat(43),ORIGIN='https://imdember.com';
const raw={chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'timing-fixture',titleZh:'本機測試',titleEn:'Local fixture',gold:'3',embeo:'7'}]};
const count=(db,t)=>Number(db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);

async function realPaidTiming(mode){
 let rpc,provider,db;
 const proof={mode,executionChainId:31337,rpcFixtureChainId:1,publicRpcUsed:false,publicChainWrites:false,fixtureOverrides:['local exact EMBEO runtime/storage at canonical address','eth_chainId -> 1','finalized -> local latest'],status:'RUNNING',transactions:[]};
 try{
  rpc=await createIsolatedProvider();provider=new ethers.BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=5;
  const issuer=await provider.getSigner(0),player=await provider.getSigner(1),wallet=(await player.getAddress()).toLowerCase();
  const original=await deploy(tokenArtifact,issuer),code=await provider.getCode(original.target);assert.equal(ethers.keccak256(code),EMBEO_RUNTIME);
  await rpc.request({method:'hardhat_setCode',params:[ECONOMY_TOKEN,code]});
  for(const slot of [2,3,4])await rpc.request({method:'hardhat_setStorageAt',params:[ECONOMY_TOKEN,'0x'+slot.toString(16),await rpc.request({method:'eth_getStorageAt',params:[original.target,'0x'+slot.toString(16),'latest']})]});
  const slot=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address','uint256'],[await issuer.getAddress(),0]));
  await rpc.request({method:'hardhat_setStorageAt',params:[ECONOMY_TOKEN,slot,await rpc.request({method:'eth_getStorageAt',params:[original.target,slot,'latest']})]});
  const token=new ethers.Contract(ECONOMY_TOKEN,tokenArtifact.abi,issuer),vault=await deploy(artifacts.EmbeoStakingVault,issuer,ECONOMY_TOKEN),payments=await deploy(artifacts.EmbeoPayments,issuer,ECONOMY_TOKEN,ECONOMY_TREASURY);
  await(await token.transfer(wallet,100n,TX)).wait();await(await token.connect(player).approve(payments.target,100n,TX)).wait();
  const c=await defineEconomyConfig({...raw,stakingContract:vault.target,paymentContract:payments.target,deploymentBlock:String((await vault.deploymentTransaction().wait()).blockNumber)});
  const latest=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]}),blockSeconds=Number(BigInt(latest.timestamp))+12,serverCreatedMs=blockSeconds*1000+750;
  db=openD1();const orders=[];
  for(let i=0;i<3;i++)orders.push(await createEconomyOrder(db,c,{wallet,requestId:`timing-${mode}-order-000${i}`,serviceId:'timing-fixture',currency:'EMBEO',nowMs:serverCreatedMs}));
  await rpc.request({method:'evm_setAutomine',params:[false]});
  const nonce=await provider.getTransactionCount(wallet),sent=[];
  for(let i=0;i<orders.length;i++)sent.push(await payments.connect(player).pay(orders[i].id,7n,{...TX,nonce:nonce+i}));
  await rpc.request({method:'evm_setNextBlockTimestamp',params:[blockSeconds]});await rpc.request({method:'evm_mine',params:[]});await rpc.request({method:'evm_setAutomine',params:[true]});
  for(const transaction of sent){
   const receipt=await transaction.wait(),rawReceipt=await rpc.request({method:'eth_getTransactionReceipt',params:[transaction.hash]});assert.equal(receipt.status,1);
   const paid=rawReceipt.logs.find(log=>log.address.toLowerCase()===payments.target.toLowerCase()&&log.topics[0]===ECONOMY_EVENT_TOPICS.payment);assert.ok(paid);
   const header=await rpc.request({method:'eth_getBlockByNumber',params:[rawReceipt.blockNumber,false]});assert.equal(Number(BigInt(header.timestamp))*1000,serverCreatedMs-750);
   proof.transactions.push({hash:transaction.hash,blockNumber:receipt.blockNumber,blockTimestampMs:Number(BigInt(header.timestamp))*1000,orderCreatedMs:serverCreatedMs,logIndex:paid.logIndex,status:receipt.status});
  }
  const fixtureRpc=async(method,params)=>method==='eth_chainId'?'0x1':rpc.request({method,params:method==='eth_getBlockByNumber'&&params[0]==='finalized'?['latest',false]:params});
  let staged=false,done=false;
  for(let i=0;i<30;i++){const result=await syncEconomyChain(db,c,{rpc:fixtureRpc,nowMs:serverCreatedMs+1000,maxLogs:mode==='staging'?1:256});if(result.status==='staging')staged=true;if(result.status==='caught-up'){done=true;break;}}
  assert.equal(done,true);assert.equal(staged,mode==='staging');
  proof.observedOrders=(await economyWalletSnapshot(db,c,wallet)).orders;proof.fulfillments=count(db,'economy_fulfillments');
  assert.ok(proof.observedOrders.every(order=>order.status==='paid'),'a real Paid event mined 750ms before server-created milliseconds must fulfill its unpredictable exact order');
  assert.equal(proof.fulfillments,3);await syncEconomyChain(db,c,{rpc:fixtureRpc,nowMs:serverCreatedMs+2000,maxLogs:mode==='staging'?1:256});assert.equal(count(db,'economy_fulfillments'),3);
  assert.equal(await token.balanceOf(ECONOMY_TREASURY),21n);proof.status='PASS';
 }catch(error){proof.status='FAIL';proof.error=error.message;throw error;}
 finally{writeFileSync(new URL(`../../.rd/recheck-2026-10-16/ledger/payment-timing-${mode}-latest.private.json`,import.meta.url),JSON.stringify(proof,null,2)+'\n');db?.raw.close();provider?.destroy();if(rpc)await rpc.disconnect();}
}
test('real local EDR Paid before server milliseconds fulfills exactly once via ordinary ingestion',()=>realPaidTiming('ordinary'));
test('real local EDR Paid before server milliseconds fulfills exactly once via staged block folding',()=>realPaidTiming('staging'));

async function apiFixture(){
 const db=openD1(),config=await defineEconomyConfig(raw),clock={at:NOW},tokenHash=await sha256(TOKEN);
 db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(tokenHash,W,1,NOW-1,NOW+60000,'payment-timing-fixture','EOA','ECDSA');
 return {db,config,clock,tokenHash};
}
function afterRead(db,match,callback){
 let fired=false;
 const wrap=stmt=>({...stmt,bind(...args){return wrap(stmt.bind(...args));},async first(){const result=await stmt.first();if(!fired&&match(stmt.sql)){fired=true;callback();}return result;}});
 return {prepare:sql=>wrap(db.prepare(sql)),batch:statements=>db.batch(statements)};
}
const post=async(f,path,body,db=f.db)=>{
 const response=await handleEconomyApi(new Request(ORIGIN+path,{method:'POST',headers:{origin:ORIGIN,cookie:SESSION_COOKIE+'='+TOKEN,'content-type':'application/json'},body:JSON.stringify({expectedAddress:W,...body})}),{db,config:f.config,now:()=>f.clock.at,allow:async()=>true});
 return {status:response.status,body:await response.json()};
};
const orderBody={requestId:'timing-api-order-0001',serviceId:'timing-fixture',currency:'GOLD'};
const orderLookup=sql=>sql.includes('FROM economy_orders WHERE wallet=? AND request_id=?');
const challengeLookup=sql=>sql.includes('FROM economy_gold_challenges WHERE order_id=? AND request_id=?');

test('new order IDs are unpredictable and concurrent identical requests retain one exact quoted order',async()=>{
 const f=await apiFixture();try{
  const args={wallet:W,...orderBody,nowMs:NOW};
  const results=await Promise.all(Array.from({length:8},()=>createEconomyOrder(f.db,f.config,args)));
  assert.ok(results.every(order=>order.id===results[0].id));assert.equal(count(f.db,'economy_orders'),1);
  assert.notEqual(results[0].id,'0x'+await economyDigest(JSON.stringify([f.config.id,W,args.requestId])),'the public config/wallet/request tuple must not predict a payable order ID');
  const repriced=await defineEconomyConfig({...raw,catalogue:[{...raw.catalogue[0],gold:'9'}]});
  const retried=await createEconomyOrder(f.db,repriced,args);assert.equal(retried.id,results[0].id);assert.equal(retried.amount,'3','retry retains the winning immutable price');
  const other=await createEconomyOrder(f.db,repriced,{...args,requestId:'timing-api-order-0002'});assert.notEqual(other.id,results[0].id);assert.equal(other.amount,'9');assert.equal(count(f.db,'economy_orders'),2);
  await assert.rejects(createEconomyOrder(f.db,f.config,{...args,currency:'EMBEO'}),/IDEMPOTENCY_CONFLICT/);
 }finally{f.db.raw.close();}
});
test('actual API rejects session expiry during ledger order awaits without creating a quote',async()=>{
 const f=await apiFixture();try{const raced=afterRead(f.db,orderLookup,()=>{f.clock.at=NOW+60000;});const result=await post(f,'/api/economy/orders',orderBody,raced);assert.equal(result.status,401);assert.equal(count(f.db,'economy_orders'),0);}finally{f.db.raw.close();}
});
test('actual API creates fresh quote timestamps after ledger awaits rather than consuming quote lifetime',async()=>{
 const f=await apiFixture();try{const raced=afterRead(f.db,orderLookup,()=>{f.clock.at=NOW+5000;});const result=await post(f,'/api/economy/orders',orderBody,raced);assert.equal(result.status,200);assert.equal(result.body.order.createdMs,NOW+5000);assert.equal(result.body.order.expiresMs,NOW+5000+900000);}finally{f.db.raw.close();}
});
test('actual API rejects order/session expiry during challenge ledger awaits and writes no stale nonce',async()=>{
 for(const mode of ['order','session']){
  const f=await apiFixture();try{
   const order=await createEconomyOrder(f.db,f.config,{wallet:W,...orderBody,nowMs:NOW});
   const raced=afterRead(f.db,challengeLookup,()=>{f.clock.at=mode==='order'?order.expiresMs:NOW+60000;});
   const result=await post(f,`/api/economy/orders/${order.id}/gold/challenge`,{requestId:'timing-api-challenge-0001'},raced);
   assert.equal(result.status,mode==='order'?409:401,mode);assert.equal(count(f.db,'economy_gold_challenges'),0,mode);
  }finally{f.db.raw.close();}
 }
});
test('actual API challenge issued/expiry timestamps use fresh time after ledger awaits',async()=>{
 const f=await apiFixture();try{
  const order=await createEconomyOrder(f.db,f.config,{wallet:W,...orderBody,nowMs:NOW}),raced=afterRead(f.db,challengeLookup,()=>{f.clock.at=NOW+5000;});
  const result=await post(f,`/api/economy/orders/${order.id}/gold/challenge`,{requestId:'timing-api-challenge-0001'},raced);assert.equal(result.status,200);assert.equal(result.body.challenge.issuedMs,NOW+5000);assert.equal(result.body.challenge.expiresMs,NOW+305000);
 }finally{f.db.raw.close();}
});
test('actual API rejects backward clock and retains final-SQL session revocation guards for quote and challenge creation',async()=>{
 for(const route of ['order','challenge'])for(const mode of ['backward','revoked']){
  const f=await apiFixture();try{
   const order=route==='challenge'?await createEconomyOrder(f.db,f.config,{wallet:W,...orderBody,nowMs:NOW}):null;
   const raced=afterRead(f.db,route==='order'?orderLookup:challengeLookup,()=>{if(mode==='backward')f.clock.at=NOW-1;else f.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(NOW,f.tokenHash);});
   const result=await post(f,route==='order'?'/api/economy/orders':`/api/economy/orders/${order.id}/gold/challenge`,route==='order'?orderBody:{requestId:'timing-api-challenge-0001'},raced);
   assert.equal(result.status,mode==='backward'?503:401,route+':'+mode);assert.equal(count(f.db,route==='order'?'economy_orders':'economy_gold_challenges'),0);
  }finally{f.db.raw.close();}
 }
});
