import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {ethers,createIsolatedProvider,deploy,artifacts,tokenArtifact,SHARE,TX,EMBEO_RUNTIME} from '../../contracts/test/runtime.mjs';
import {openD1} from './d1-sqlite.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY} from '../server/economy-config.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {syncEconomyChain} from '../server/economy-rpc.ts';
import {haltEconomyChain} from '../server/economy-ledger.ts';

// One real in-process EDR chain, exact preserved EMBEO bytecode and candidate
// contracts, real receipts/logs, real SQLite migrations and personal signatures.
// ONLY this fixture maps chain-id/finalized reads to its isolated local chain.
// No socket, public RPC, production wallet, real token or formal database is used.
test('isolated EVM receipts → finalized RPC index → UTC GOLD → explicit signed service payment → independent principal withdrawal',async()=>{
 const evidence={schema:'imd.world.economy-complete-local-journey/v1',status:'RUNNING',executionChainId:31337,rpcFixtureChainId:1,
   fixtureOverrides:['eth_chainId response 0x1','finalized tag maps to local latest','preserved EMBEO runtime/storage instantiated at canonical token address'],
   publicRpcUsed:false,publicChainWrites:false,productionWalletsUsed:false,productionDatabaseUsed:false,productionReady:false,milestones:[],transactions:[]};
 let rpc,db,provider;
 const pass=name=>evidence.milestones.push({name,status:'PASS'});
 try{
  rpc=await createIsolatedProvider();provider=new ethers.BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=5;
  assert.equal((await provider.getNetwork()).chainId,31337n);
  const issuer=await provider.getSigner(0),player=await provider.getSigner(1),wallet=(await player.getAddress()).toLowerCase();
  const send=async promise=>{const receipt=await(await promise).wait();assert.equal(receipt.status,1);evidence.transactions.push({hash:receipt.hash,status:receipt.status,blockNumber:receipt.blockNumber});return receipt;};
  const original=await deploy(tokenArtifact,issuer),originalCode=await provider.getCode(original.target);
  assert.equal(ethers.keccak256(originalCode),EMBEO_RUNTIME);
  // Copy only the constructor-created local supply/metadata and issuer balance.
  // Storage layout is OpenZeppelin ERC20: mapping balances=0, allowances=1,
  // totalSupply=2, name=3, symbol=4. No mainnet state is fetched or imported.
  await rpc.request({method:'hardhat_setCode',params:[ECONOMY_TOKEN,originalCode]});
  for(const slot of [2,3,4]){
    const value=await rpc.request({method:'eth_getStorageAt',params:[original.target,'0x'+slot.toString(16),'latest']});
    await rpc.request({method:'hardhat_setStorageAt',params:[ECONOMY_TOKEN,'0x'+slot.toString(16),value]});
  }
  const balanceSlot=ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['address','uint256'],[await issuer.getAddress(),0]));
  const balance=await rpc.request({method:'eth_getStorageAt',params:[original.target,balanceSlot,'latest']});
  await rpc.request({method:'hardhat_setStorageAt',params:[ECONOMY_TOKEN,balanceSlot,balance]});
  const token=new ethers.Contract(ECONOMY_TOKEN,tokenArtifact.abi,issuer);
  assert.equal(await token.totalSupply(),10n**27n);assert.equal(await token.decimals(),18n);assert.equal(ethers.keccak256(await provider.getCode(ECONOMY_TOKEN)),EMBEO_RUNTIME);
  const vault=await deploy(artifacts.EmbeoStakingVault,issuer,ECONOMY_TOKEN),payments=await deploy(artifacts.EmbeoPayments,issuer,ECONOMY_TOKEN,ECONOMY_TREASURY);
  const deploymentBlock=String((await vault.deploymentTransaction().wait()).blockNumber);
  await send(token.transfer(wallet,100n*SHARE,TX));
  assert.equal(await token.balanceOf(ECONOMY_TREASURY),0n);pass('Exact EMBEO and both immutable candidate contracts run only on isolated EDR 31337');
  const config=await defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:vault.target,paymentContract:payments.target,treasury:ECONOMY_TREASURY,deploymentBlock,
   catalogue:[{id:'journey-fixture',titleZh:'僅供本機旅程',titleEn:'Local journey fixture',gold:'3',embeo:String(7n*10n**18n)}]});
  const last=await rpc.request({method:'eth_getBlockByNumber',params:['latest',false]}),start=(Math.floor(Number(BigInt(last.timestamp))*1000/DAY)+1)*DAY;
  let now=start+DAY/2;
  const advance=async(ms,mine=true)=>{assert.equal(ms%1000,0);now=ms;await rpc.request({method:'evm_setNextBlockTimestamp',params:[ms/1000]});if(mine)await rpc.request({method:'evm_mine',params:[]});};
  const fixtureRpc=async(method,params)=>{
   if(method==='eth_chainId')return '0x1';
   if(method==='eth_getBlockByNumber'&&params[0]==='finalized')return rpc.request({method,params:['latest',false]});
   return rpc.request({method,params});
  };
  db=openD1();const session='j'.repeat(43),tokenHash=await sha256(session),sessionExpiry=start+7*DAY;
  db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,revoked_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,NULL,?,?,?)').run(tokenHash,wallet,1,start,sessionExpiry,'isolated-journey-session','EOA','ECDSA');
  const deps={db,config,now:()=>now,allow:async()=>true,client:'isolated-journey'},WORLD='https://imdember.com';
  const api=async(path,{method='GET',body,origin=WORLD,status=200}={})=>{
   const response=await handleEconomyApi(new Request(WORLD+path,{method,headers:{origin,cookie:SESSION_COOKIE+'='+session,...body!==undefined?{'content-type':'application/json'}:{}},...body!==undefined?{body:JSON.stringify(body)}:{}}),deps);
   assert.equal(response.status,status,await response.clone().text());return response.json();
  };
  const snapshot=()=>api('/api/me/economy?expected_address='+wallet);
  const sync=()=>syncEconomyChain(db,config,{rpc:fixtureRpc,nowMs:now,maxBlocks:128,maxLogs:64,settleMaxDays:31});
  await send(token.connect(player).approve(vault.target,10n*SHARE,TX));
  await advance(start+DAY/2,false);await send(vault.connect(player).deposit(10n,TX));
  await advance(start+DAY);await sync();assert.equal((await snapshot()).gold,'0');assert.equal((await snapshot()).positions[0].shares,'10');
  await advance(start+DAY+DAY/2,false);await send(vault.connect(player).withdraw(1n,3n,TX));await sync();
  assert.equal((await snapshot()).gold,'0');assert.equal((await snapshot()).positions[0].shares,'7');
  await advance(start+2*DAY);await sync();assert.equal((await snapshot()).gold,'7');
  assert.equal(await token.balanceOf(vault.target),7n*SHARE);assert.equal(await token.balanceOf(ECONOMY_TREASURY),0n);
  pass('Noon deposit waits for first complete UTC day; partial withdrawal cancels only 3/10 shares for that day, issuing exactly 7 GOLD');
  const goldOrder=(await api('/api/economy/orders',{method:'POST',body:{expectedAddress:wallet,requestId:'journey-order-gold-0001',serviceId:'journey-fixture',currency:'GOLD'}})).order;
  const goldPath='/api/economy/orders/'+goldOrder.id+'/gold',payRequest='journey-payment-gold-0001';
  const challenge=(await api(goldPath+'/challenge',{method:'POST',body:{expectedAddress:wallet,requestId:payRequest}})).challenge;
  const oldLogin=await player.signMessage('imdember.com wants you to sign in with your Ethereum account.');
  await api(goldPath,{method:'POST',body:{expectedAddress:wallet,requestId:payRequest,signature:oldLogin},status:403});
  assert.equal((await snapshot()).gold,'7');
  const signature=await player.signMessage(challenge.message),signedBody={expectedAddress:wallet,requestId:payRequest,signature};
  assert.equal((await api(goldPath,{method:'POST',body:signedBody})).order.status,'paid');await api(goldPath,{method:'POST',body:signedBody});
  assert.equal((await snapshot()).gold,'4');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,1);
  assert.equal(db.raw.prepare('SELECT consumed_ms t FROM economy_gold_challenges').get().t,now);
  pass('Fresh exact GOLD personal signature authorizes one atomic debit/fulfillment; old login signature fails and retry never double-spends');
  const paymentResult=await api('/api/economy/orders',{method:'POST',body:{expectedAddress:wallet,requestId:'journey-order-embeo-0001',serviceId:'journey-fixture',currency:'EMBEO'}}),paidQuote=paymentResult.order;
  assert.equal(paymentResult.payment.amount,paidQuote.amount);assert.equal(paymentResult.payment.token,ECONOMY_TOKEN);assert.equal(paymentResult.payment.receiver,ECONOMY_TREASURY);
  await advance(start+2*DAY+16*60000,false);await send(token.connect(player).approve(payments.target,BigInt(paidQuote.amount),TX));
  const principalBefore=await token.balanceOf(vault.target),playerBefore=await token.balanceOf(wallet);
  await send(payments.connect(player).pay(paidQuote.id,BigInt(paidQuote.amount),TX));
  assert.equal(await token.balanceOf(vault.target),principalBefore);assert.equal(await token.balanceOf(wallet),playerBefore-BigInt(paidQuote.amount));
  assert.equal(await token.balanceOf(ECONOMY_TREASURY),BigInt(paidQuote.amount));assert.equal(await token.balanceOf(payments.target),0n);
  now+=1000;await sync();const embeoPaid=(await snapshot()).orders.find(o=>o.id===paidQuote.id);
  assert.ok(now>paidQuote.expiresMs);assert.equal(embeoPaid.status,'paid');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,2);
  pass('Canonical EMBEO order paid after display expiry still fulfills from real receipt; treasury revenue and refundable vault principal stay separate');
  await advance(start+2*DAY+DAY/2,false);await send(vault.connect(player).withdraw(1n,2n,TX));
  await send(token.connect(player).approve(vault.target,SHARE,TX));await send(vault.connect(player).deposit(1n,TX));
  await advance(start+3*DAY);await sync();assert.equal((await snapshot()).gold,'9');
  assert.equal((await snapshot()).positions.find(p=>p.id==='1').shares,'5');assert.equal((await snapshot()).positions.find(p=>p.id==='2').shares,'1');
  assert.equal(await token.balanceOf(vault.target),6n*SHARE);
  pass('Second complete day rewards only surviving original 5 shares; midday new lot waits and previously posted GOLD is retained');
  await api('/api/economy/orders',{method:'POST',origin:'https://evil.example',body:{expectedAddress:wallet,requestId:'journey-csrf-order-0001',serviceId:'journey-fixture',currency:'GOLD'},status:403});
  db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(now,tokenHash);
  await api('/api/economy/orders',{method:'POST',body:{expectedAddress:wallet,requestId:'journey-revoked-order-0001',serviceId:'journey-fixture',currency:'GOLD'},status:401});
  await haltEconomyChain(db,config,'LOCAL_JOURNEY_FINALITY_HALT');
  const treasuryBefore=await token.balanceOf(ECONOMY_TREASURY),walletBefore=await token.balanceOf(wallet);
  await advance(start+3*DAY+3600000,false);await send(vault.connect(player).withdraw(1n,5n,TX));await send(vault.connect(player).withdraw(2n,1n,TX));
  assert.equal(await token.balanceOf(vault.target),0n);assert.equal(await vault.totalShares(),0n);assert.equal(await token.balanceOf(wallet),walletBefore+6n*SHARE);assert.equal(await token.balanceOf(ECONOMY_TREASURY),treasuryBefore);
  assert.equal(db.raw.prepare('SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?').get(wallet).balance,'9');
  pass('CSRF and revoked login cannot spend GOLD; principal withdrawals work directly on immutable contract even during backend halt and without active World session');
  evidence.status='PASS';evidence.postedGold='12';evidence.spentGold='3';evidence.remainingGold='9';evidence.fulfillments=2;evidence.remainingPrincipal='0';
 }catch(error){evidence.status='FAIL';evidence.error=error.message;throw error;}
 finally{
  writeFileSync(new URL('../../release/economy-journey-native.private.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  db?.raw.close();if(provider)provider.destroy();if(rpc)await rpc.disconnect();
 }
});
