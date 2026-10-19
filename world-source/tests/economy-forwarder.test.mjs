import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {solc,ethers,createIsolatedProvider,deploy,artifacts,tokenArtifact,SHARE,TX,EMBEO_RUNTIME} from '../../contracts/test/runtime.mjs';
// Historical standalone catalogue/receipt assertions. Shared admission and
// linked topup processing have separate current-schema Audit7 tests.
import {openStandaloneEconomyD1 as openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY} from '../server/economy-config.ts';
import {createEconomyOrder,economyWalletSnapshot,economyChainState} from '../server/economy-ledger.ts';
import {syncEconomyChain,ECONOMY_EVENT_TOPICS} from '../server/economy-rpc.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';

// Only this new fixture is compiled. The production Solidity/bytecode is unchanged.
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;
interface Token {function approve(address,uint256) external returns(bool);}
interface Vault {function deposit(uint256) external returns(uint256);function withdraw(uint256,uint256) external;}
interface Payments {function pay(bytes32,uint256) external;}
contract Forwarder {
 address public immutable token;address public immutable vault;address public immutable payments;
 event Staked(address indexed player,uint256 indexed positionId,uint256 shares,uint256 amount);
 constructor(address t,address v,address p,uint256 initialShares){token=t;vault=v;payments=p;if(initialShares>0){Token(t).approve(v,initialShares*100000 ether);Vault(v).deposit(initialShares);assembly{log0(0,0)}}}
 function batchDeposit(uint256 count,uint256 noise) external {Token(token).approve(vault,count*100000 ether);for(uint256 i=0;i<noise;i++){assembly{log0(0,0)}}for(uint256 i=0;i<count;i++)Vault(vault).deposit(1);}
 function withdraw(uint256 positionId,uint256 shares) external {Vault(vault).withdraw(positionId,shares);}
 function pay(bytes32 orderId,uint256 amount) external {Token(token).approve(payments,amount);Payments(payments).pay(orderId,amount);}
 function fakeStake(address player) external {emit Staked(player,999999,1,100000 ether);}
}`;
const input={language:'Solidity',sources:{'Forwarder.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:false,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const compiled=JSON.parse(solc.compile(JSON.stringify(input)));assert.ok(!(compiled.errors??[]).some(error=>error.severity==='error'));
const forwarderArtifact={abi:compiled.contracts['Forwarder.sol'].Forwarder.abi,bytecode:'0x'+compiled.contracts['Forwarder.sol'].Forwarder.evm.bytecode.object};

test('real forwarder, constructor and batched/LOG0 receipts cannot block EOA indexing or spoof event-bound wallet payments',async()=>{
 let rpc,provider,db,badDb;
 const proof={schema:'imd.world.economy-forwarder-evm-regression/v1',status:'RUNNING',executionChainId:31337,rpcFixtureChainId:1,
   fixtureOverrides:['eth_chainId -> 1','finalized -> local latest','local exact EMBEO runtime/storage at canonical address'],
   publicRpcUsed:false,publicChainWrites:false,productionContractsChanged:false,productionReady:false,milestones:[],transactions:[]};
 const pass=name=>proof.milestones.push({name,status:'PASS'});
 try{
  rpc=await createIsolatedProvider();provider=new ethers.BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=5;
  const issuer=await provider.getSigner(0),player=await provider.getSigner(1),wallet=(await player.getAddress()).toLowerCase();
  const send=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);proof.transactions.push({hash:receipt.hash,status:receipt.status,blockNumber:receipt.blockNumber,to:receipt.to});return receipt;};
  const original=await deploy(tokenArtifact,issuer),code=await provider.getCode(original.target);assert.equal(ethers.keccak256(code),EMBEO_RUNTIME);
  await rpc.request({method:'hardhat_setCode',params:[ECONOMY_TOKEN,code]});
  for(const slot of [2,3,4]){const value=await rpc.request({method:'eth_getStorageAt',params:[original.target,'0x'+slot.toString(16),'latest']});await rpc.request({method:'hardhat_setStorageAt',params:[ECONOMY_TOKEN,'0x'+slot.toString(16),value]});}
  const balanceSlot=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address','uint256'],[await issuer.getAddress(),0]));
  await rpc.request({method:'hardhat_setStorageAt',params:[ECONOMY_TOKEN,balanceSlot,await rpc.request({method:'eth_getStorageAt',params:[original.target,balanceSlot,'latest']})]});
  const token=new ethers.Contract(ECONOMY_TOKEN,tokenArtifact.abi,issuer),vault=await deploy(artifacts.EmbeoStakingVault,issuer,ECONOMY_TOKEN),payments=await deploy(artifacts.EmbeoPayments,issuer,ECONOMY_TOKEN,ECONOMY_TREASURY);
  const deploymentBlock=String((await vault.deploymentTransaction().wait()).blockNumber),forwarder=await deploy(forwarderArtifact,issuer,ECONOMY_TOKEN,vault.target,payments.target,0),contractWallet=forwarder.target.toLowerCase();
  await send(token.transfer(wallet,20n*SHARE,TX));await send(token.transfer(forwarder.target,20n*SHARE,TX));
  const c=await defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:vault.target,paymentContract:payments.target,treasury:ECONOMY_TREASURY,deploymentBlock,catalogue:[{id:'forwarder-fixture',titleZh:'僅供本機',titleEn:'Local fixture',gold:'1',embeo:'7'}]});
  const fixtureRpc=async(method,params)=>{if(method==='eth_chainId')return '0x1';if(method==='eth_getBlockByNumber'&&params[0]==='finalized')return rpc.request({method,params:['latest',false]});return rpc.request({method,params});};
  db=openD1();const sync=async()=>{const header=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]});return syncEconomyChain(db,c,{rpc:fixtureRpc,nowMs:Number(BigInt(header.timestamp))*1000});};
  const last=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]}),start=(Math.floor(Number(BigInt(last.timestamp))*1000/DAY)+1)*DAY;
  await rpc.request({method:'evm_setNextBlockTimestamp',params:[(start+DAY/2)/1000]});
  const batch=await send(forwarder.batchDeposit(2n,1025n,TX));const rawBatch=await rpc.request({method:'eth_getTransactionReceipt',params:[batch.hash]});
  assert.ok(rawBatch.logs.length>1024);assert.ok(rawBatch.logs.some(log=>log.topics.length===0));assert.equal(rawBatch.to.toLowerCase(),contractWallet);assert.notEqual(rawBatch.from.toLowerCase(),contractWallet);
  const batchPositions=batch.logs.filter(log=>log.address.toLowerCase()===vault.target.toLowerCase()).map(log=>vault.interface.parseLog(log)).filter(log=>log?.name==='Staked').map(log=>log.args.positionId);assert.equal(batchPositions.length,2);
  await send(token.connect(player).approve(vault.target,2n*SHARE,TX));const direct=await send(vault.connect(player).deposit(2n,TX));
  const directPosition=direct.logs.filter(log=>log.address.toLowerCase()===vault.target.toLowerCase()).map(log=>vault.interface.parseLog(log)).find(log=>log?.name==='Staked').args.positionId;
  const predicted=ethers.getCreateAddress({from:await issuer.getAddress(),nonce:await provider.getTransactionCount(await issuer.getAddress())});
  await send(token.connect(player).transfer(predicted,SHARE,TX));const constructor=await deploy(forwarderArtifact,issuer,ECONOMY_TOKEN,vault.target,payments.target,1n),creation=await constructor.deploymentTransaction().wait();
  assert.equal(constructor.target.toLowerCase(),predicted.toLowerCase());assert.equal(creation.to,null);
  await sync();assert.equal((await economyWalletSnapshot(db,c,contractWallet)).positions.length,2);assert.equal((await economyWalletSnapshot(db,c,wallet)).positions[0].shares,'2');assert.equal((await economyWalletSnapshot(db,c,constructor.target)).positions[0].shares,'1');
  pass('True forwarded/batched deposit with >1024 unrelated LOG0 receipt logs and constructor to=null both index; later EOA deposit remains live');
  const fake=await send(forwarder.fakeStake(wallet,TX));await sync();assert.equal((await economyWalletSnapshot(db,c,wallet)).positions.length,1);
  pass('A same-signature event emitted by the forwarder itself is outside the pinned emitter filter and creates no position');
  await rpc.request({method:'evm_setNextBlockTimestamp',params:[(start+2*DAY)/1000]});await rpc.request({method:'evm_mine',params:[]});await sync();
  assert.equal((await economyWalletSnapshot(db,c,contractWallet)).gold,'2');assert.equal((await economyWalletSnapshot(db,c,wallet)).gold,'2');assert.equal((await economyWalletSnapshot(db,c,constructor.target)).gold,'1');
  const session='f'.repeat(43),tokenHash=await sha256(session),now=start+2*DAY;
  db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(tokenHash,contractWallet,1,start,now+DAY,'forwarder-contract-read-only-session','CONTRACT','ERC1271');
  const response=await handleEconomyApi(new Request('https://imdember.com/api/economy/orders',{method:'POST',headers:{origin:'https://imdember.com',cookie:SESSION_COOKIE+'='+session,'content-type':'application/json'},body:JSON.stringify({expectedAddress:contractWallet,requestId:'forwarder-contract-gold-0001',serviceId:'forwarder-fixture',currency:'GOLD'})}),{db,config:c,now:()=>now,allow:async()=>true,client:'local-forwarder-fixture'});
  assert.equal(response.status,403);assert.equal((await economyWalletSnapshot(db,c,contractWallet)).gold,'2');
  pass('Contract-wallet GOLD accrual does not bypass the existing EOA-only order/spend authorization boundary');
  const order=await createEconomyOrder(db,c,{wallet,requestId:'forwarder-eoa-order-0001',serviceId:'forwarder-fixture',currency:'EMBEO',nowMs:now});
  await send(forwarder.pay(order.id,BigInt(order.amount),TX));await sync();assert.equal((await economyWalletSnapshot(db,c,wallet)).orders.find(o=>o.id===order.id).status,'pending');
  await send(token.connect(player).approve(payments.target,BigInt(order.amount),TX));await send(payments.connect(player).pay(order.id,BigInt(order.amount),TX));await sync();assert.equal((await economyWalletSnapshot(db,c,wallet)).orders.find(o=>o.id===order.id).status,'paid');
  const contractOrder=await createEconomyOrder(db,c,{wallet:contractWallet,requestId:'forwarder-own-order-0001',serviceId:'forwarder-fixture',currency:'EMBEO',nowMs:now});await send(forwarder.pay(contractOrder.id,BigInt(contractOrder.amount),TX));await sync();assert.equal((await economyWalletSnapshot(db,c,contractWallet)).orders.find(o=>o.id===contractOrder.id).status,'paid');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,2);assert.equal(await token.balanceOf(ECONOMY_TREASURY),21n);
  pass('Forwarded Paid uses event payer: cannot fulfill another EOA order; direct EOA retry and exact contract-payer order fulfill once');
  for(const position of batchPositions)await send(forwarder.withdraw(position,1n,TX));await send(vault.connect(player).withdraw(directPosition,2n,TX));await sync();
  assert.ok((await economyWalletSnapshot(db,c,contractWallet)).positions.every(p=>p.shares==='0'));assert.equal((await economyWalletSnapshot(db,c,wallet)).positions[0].shares,'0');assert.equal(await vault.totalShares(),1n);
  pass('Real forwarded withdrawals index correctly and cannot block a subsequent direct EOA principal withdrawal');
  // The provider cannot replace the event player: exact receipt log equality
  // still rejects the altered topic before any event or reward is committed.
  badDb=openD1();const spoofed=async(method,params)=>{const result=await fixtureRpc(method,params);if(method==='eth_getLogs')return result.map(log=>log.transactionHash===batch.hash&&log.topics[0]===ECONOMY_EVENT_TOPICS.stake?{...log,topics:[log.topics[0],'0x'+wallet.slice(2).padStart(64,'0'),...log.topics.slice(2)]}:log);return result;};
  await assert.rejects(syncEconomyChain(badDb,c,{rpc:spoofed,nowMs:now+DAY}),/RECEIPT_LOG_MISMATCH/);assert.equal(badDb.raw.prepare('SELECT COUNT(*) n FROM economy_chain_events').get().n,0);assert.equal((await economyChainState(badDb,c)).lastBlock,String(BigInt(deploymentBlock)-1n));
  const fakeRaw=await rpc.request({method:'eth_getTransactionReceipt',params:[fake.hash]}),fakeLog=fakeRaw.logs.find(log=>log.topics[0]===ECONOMY_EVENT_TOPICS.stake);
  const wrongEmitter=async(method,params)=>method==='eth_getLogs'?[fakeLog]:fixtureRpc(method,params);
  await assert.rejects(syncEconomyChain(badDb,c,{rpc:wrongEmitter,nowMs:now+DAY}),/UNEXPECTED_EVENT_SOURCE/);assert.equal(badDb.raw.prepare('SELECT COUNT(*) n FROM economy_positions').get().n,0);
  pass('Tampered player topic and a fake same-signature log from a noncanonical emitter both fail closed with no cursor or credit');
  proof.status='PASS';proof.batchReceiptLogCount=rawBatch.logs.length;proof.constructorReceiptTo=creation.to;proof.fulfillments=2;
 }catch(error){proof.status='FAIL';proof.error=error.message;throw error;}
 finally{writeFileSync(new URL('../../release/economy-forwarder-native.private.json',import.meta.url),JSON.stringify(proof,null,2)+'\n');db?.raw.close();badDb?.raw.close();if(provider)provider.destroy();if(rpc)await rpc.disconnect();}
});
