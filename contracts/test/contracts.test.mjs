import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {ethers, root, sha, TX, SHARE, artifacts, tokenArtifact, mockArtifact, badMetadataArtifact, EMBEO_RUNTIME, createIsolatedProvider, deploy, runtimeEvidence} from './runtime.mjs';
import {bindRuntime} from '../tools/preflight.mjs';

const observations = {schema:'imd.world.economy-local-evm/v1',scope:'ISOLATED_IN_MEMORY_CHAIN_31337',
  publicRpcUsed:false,publicChainWrites:false,productionWalletsUsed:false,productionReady:false,
  compiler:runtimeEvidence.compiler,runtimeEvidence,executionHardfork:'cancun',
  tokenFixture:{source:'preserved exact mainnet EMBEO creation bytecode; newly instantiated local balances',runtimeKeccak256:EMBEO_RUNTIME},
  artifactInputs:Object.fromEntries(Object.keys(artifacts).map(name=>[name,sha(readFileSync(resolve(root,'artifacts',name+'.json')))])),cases:[],transactions:[]};
let rpc, provider, issuer, alice, bob, mallory, treasury, expectedCases=0;
const address = signer => signer.getAddress();
const view = receipt => ({hash:receipt.hash,status:receipt.status,blockNumber:receipt.blockNumber,gasUsed:String(receipt.gasUsed)});
const decimal = value => String(value);
const same = (a,b) => assert.equal(a.toLowerCase(),b.toLowerCase());
async function mined(promise) {const receipt=await (await promise).wait(); assert.equal(receipt.status,1); observations.transactions.push(view(receipt)); return receipt;}
async function reverted(factory) {
  let receipt;
  try {receipt=await (await factory()).wait();} catch (error) {receipt=error.receipt; if (!receipt) throw error;}
  assert.equal(receipt.status,0,'Expected an actual status-0 mined transaction');
  assert.equal(receipt.logs.length,0,'Failed effects/logs must roll back');
  observations.transactions.push(view(receipt)); return receipt;
}
function check(name, fn) {expectedCases++;test(name,async()=>{try{await fn();observations.cases.push({name,status:'PASS'});}catch(error){observations.cases.push({name,status:'FAIL',error:error.message});throw error;}});}
async function fixture(mock=false) {
  const token=await deploy(mock?mockArtifact:tokenArtifact,issuer);
  const vault=await deploy(artifacts.EmbeoStakingVault,issuer,token.target);
  const payments=await deploy(artifacts.EmbeoPayments,issuer,token.target,await address(treasury));
  await mined(token.transfer(await address(alice),100n*SHARE,TX));
  await mined(token.transfer(await address(bob),100n*SHARE,TX));
  return {token,vault,payments};
}
async function snap(f, who=alice, positionId=1n, order=ethers.ZeroHash) {
  const actor=await address(who),position=await f.vault.positions(positionId);
  return {
    actorBalance:decimal(await f.token.balanceOf(actor)), vaultBalance:decimal(await f.token.balanceOf(f.vault.target)),
    treasuryBalance:decimal(await f.token.balanceOf(await address(treasury))), paymentBalance:decimal(await f.token.balanceOf(f.payments.target)),
    allowanceVault:decimal(await f.token.allowance(actor,f.vault.target)), allowancePayment:decimal(await f.token.allowance(actor,f.payments.target)),
    totalSupply:decimal(await f.token.totalSupply()), totalShares:decimal(await f.vault.totalShares()), nextId:decimal(await f.vault.nextPositionId()),
    position:{player:position.player,shares:decimal(position.shares)},paid:await f.payments.paid(actor,order)
  };
}
function event(receipt, contract, name) {
  const matches=receipt.logs.filter(log=>log.address.toLowerCase()===contract.target.toLowerCase())
    .map(log=>contract.interface.parseLog(log)).filter(log=>log?.name===name);
  assert.equal(matches.length,1); return matches[0].args;
}
before(async()=>{
  rpc=await createIsolatedProvider();
  provider=new ethers.BrowserProvider(rpc,undefined,{cacheTimeout:-1}); provider.pollingInterval=5;
  [issuer,alice,bob,mallory,treasury]=await Promise.all([0,1,2,3,4].map(i=>provider.getSigner(i)));
  assert.equal((await provider.getNetwork()).chainId,31337n);
});
after(async()=>{
  observations.expectedCases=expectedCases;
  observations.status=observations.cases.length===expectedCases&&observations.cases.every(row=>row.status==='PASS')?'PASS':'FAIL';
  observations.passed=observations.cases.filter(row=>row.status==='PASS').length;
  observations.failed=observations.cases.filter(row=>row.status==='FAIL').length;
  observations.nativeReceiptCount=observations.transactions.length;
  observations.revertedReceiptCount=observations.transactions.filter(row=>row.status===0).length;
  writeFileSync(resolve(root,'evidence/local-evm.json'),JSON.stringify(observations,null,2)+'\n');
  if(rpc) await rpc.disconnect();
});

check('Exact preserved EMBEO runtime and immutable nonprivileged configuration',async()=>{
  const f=await fixture();
  assert.equal(ethers.keccak256(await provider.getCode(f.token.target)),EMBEO_RUNTIME);
  assert.equal(await f.token.decimals(),18n); assert.equal(await f.token.totalSupply(),10n**27n);
  for(const contract of [f.vault,f.payments]) {
    same(await contract.token(),f.token.target);assert.equal(await contract.tokenCodeHash(),EMBEO_RUNTIME);
    assert.equal(await contract.tokenSupply(),10n**27n);
    assert.equal(artifacts[contract===f.vault?'EmbeoStakingVault':'EmbeoPayments'].abi.filter(item=>item.type==='receive'||item.type==='fallback').length,0);
  }
  same(await f.payments.treasury(),await address(treasury));assert.equal(await f.vault.SHARE_SIZE(),SHARE);
  observations.immutableFixture={token:f.token.target,vault:f.vault.target,payments:f.payments.target,treasury:await address(treasury),chainId:31337};
});

check('Constructors reject missing code, wrong decimals, zero supply and invalid treasury',async()=>{
  const badDecimals=await deploy(badMetadataArtifact,issuer,6,10n**27n),zeroSupply=await deploy(badMetadataArtifact,issuer,18,0n);
  const valid=await deploy(tokenArtifact,issuer);
  const creation=async(artifact,args)=>{
    const tx=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,issuer).getDeployTransaction(...args);
    await reverted(()=>issuer.sendTransaction({...tx,...TX}));
  };
  for(const token of [ethers.ZeroAddress,await address(alice),badDecimals.target,zeroSupply.target]) {
    await creation(artifacts.EmbeoStakingVault,[token]);await creation(artifacts.EmbeoPayments,[token,await address(treasury)]);
  }
  await creation(artifacts.EmbeoPayments,[valid.target,ethers.ZeroAddress]);
  await creation(artifacts.EmbeoPayments,[valid.target,valid.target]);
  const nonce=await provider.getTransactionCount(await address(issuer));
  await creation(artifacts.EmbeoPayments,[valid.target,ethers.getCreateAddress({from:await address(issuer),nonce})]);
});

check('Deployed runtime matches every byte after binding compiler-declared immutable slots',async()=>{
  const f=await fixture();
  const values={token:f.token.target,tokenCodeHash:EMBEO_RUNTIME,tokenSupply:10n**27n,treasury:await address(treasury)};
  for(const [name,contract] of [['EmbeoStakingVault',f.vault],['EmbeoPayments',f.payments]]) {
    const actual=await provider.getCode(contract.target),expected=bindRuntime(artifacts[name],values);
    assert.equal(actual,expected);assert.notEqual(actual,artifacts[name].deployedBytecode);
  }
});

check('Every deposit creates a separate lot with exact shares, event and balance deltas',async()=>{
  const f=await fixture();await mined(f.token.connect(alice).approve(f.vault.target,3n*SHARE,TX));
  const receipts=[];
  receipts.push(await mined(f.vault.connect(alice).deposit(2n,TX)));
  receipts.push(await mined(f.vault.connect(alice).deposit(1n,TX)));
  for(let i=0;i<2;i++) {const args=event(receipts[i],f.vault,'Staked');same(args.player,await address(alice));assert.equal(args.positionId,BigInt(i+1));assert.equal(args.amount,args.shares*SHARE);}
  assert.equal((await f.vault.positions(1n)).shares,2n);assert.equal((await f.vault.positions(2n)).shares,1n);
  assert.equal(await f.vault.totalShares(),3n);assert.equal(await f.token.balanceOf(f.vault.target),3n*SHARE);
  assert.equal(await f.token.balanceOf(await address(alice)),97n*SHARE);assert.equal(await f.token.allowance(await address(alice),f.vault.target),0n);
  const stream=[];
  for(const receipt of receipts) {const block=await provider.getBlock(receipt.blockNumber);const args=event(receipt,f.vault,'Staked');stream.push({event:'Staked',player:args.player,positionId:String(args.positionId),shares:String(args.shares),amount:String(args.amount),blockNumber:receipt.blockNumber,blockHash:block.hash,timestamp:block.timestamp,transactionHash:receipt.hash,logIndex:receipt.logs.find(log=>log.address.toLowerCase()===f.vault.target.toLowerCase()).index});}
  observations.separatePositionEventFixture=stream;
});

check('Partial and full principal withdrawals are immediate and confined to their position',async()=>{
  const f=await fixture();await mined(f.token.connect(alice).approve(f.vault.target,3n*SHARE,TX));await mined(f.vault.connect(alice).deposit(3n,TX));
  const receipt=await mined(f.vault.connect(alice).withdraw(1n,1n,TX));
  const args=event(receipt,f.vault,'Withdrawn');assert.equal(args.positionId,1n);assert.equal(args.shares,1n);assert.equal(args.amount,SHARE);same(args.player,await address(alice));
  assert.equal((await f.vault.positions(1n)).shares,2n);assert.equal(await f.token.balanceOf(await address(alice)),98n*SHARE);
  await mined(f.vault.connect(alice).withdraw(1n,2n,TX));
  assert.equal((await f.vault.positions(1n)).shares,0n);assert.equal(await f.vault.totalShares(),0n);assert.equal(await f.token.balanceOf(await address(alice)),100n*SHARE);
});

check('Another wallet, issuer and nonexistent position cannot withdraw principal',async()=>{
  const f=await fixture();await mined(f.token.connect(alice).approve(f.vault.target,SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));
  const before=await snap(f);
  for(const signer of [bob,mallory,issuer]) await reverted(()=>f.vault.connect(signer).withdraw(1n,1n,TX));
  await reverted(()=>f.vault.connect(alice).withdraw(999n,1n,TX));assert.deepEqual(await snap(f),before);
});

check('Zero, overflow and insufficient position shares revert without effects',async()=>{
  const f=await fixture();await mined(f.token.connect(alice).approve(f.vault.target,SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));
  const before=await snap(f);
  await reverted(()=>f.vault.connect(alice).deposit(0n,TX));await reverted(()=>f.vault.connect(alice).deposit(ethers.MaxUint256,TX));
  await reverted(()=>f.vault.connect(alice).withdraw(1n,0n,TX));await reverted(()=>f.vault.connect(alice).withdraw(1n,2n,TX));
  assert.deepEqual(await snap(f),before);
});

check('Missing or insufficient approval reverts newly allocated lot and remains retryable',async()=>{
  const f=await fixture();const before=await snap(f);
  await reverted(()=>f.vault.connect(alice).deposit(1n,TX));assert.deepEqual(await snap(f),before);
  await mined(f.token.connect(alice).approve(f.vault.target,SHARE-1n,TX));const short=await snap(f);
  await reverted(()=>f.vault.connect(alice).deposit(1n,TX));assert.deepEqual(await snap(f),short);
  await mined(f.token.connect(alice).approve(f.vault.target,SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));assert.equal(await f.vault.nextPositionId(),2n);
});

check('Insufficient balance rolls back consumed allowance and lot state',async()=>{
  const f=await fixture();await mined(f.token.connect(mallory).approve(f.vault.target,SHARE,TX));const before=await snap(f,mallory);
  await reverted(()=>f.vault.connect(mallory).deposit(1n,TX));assert.deepEqual(await snap(f,mallory),before);
});

check('Direct donations create no shares and cannot be extracted as other principal',async()=>{
  const f=await fixture();await mined(f.token.connect(alice).transfer(f.vault.target,SHARE,TX));assert.equal(await f.vault.totalShares(),0n);
  await mined(f.token.connect(bob).approve(f.vault.target,SHARE,TX));await mined(f.vault.connect(bob).deposit(1n,TX));
  await mined(f.vault.connect(bob).withdraw(1n,1n,TX));assert.equal(await f.token.balanceOf(f.vault.target),SHARE);
  await reverted(()=>f.vault.connect(alice).withdraw(1n,1n,TX));assert.equal(await f.vault.totalShares(),0n);
});

check('Payment sends exact caller debit to immutable treasury with a complete Paid event',async()=>{
  const f=await fixture(),order=ethers.id('local-service-order-1'),amount=12345n;
  await mined(f.token.connect(alice).approve(f.payments.target,amount,TX));const before=await snap(f,alice,1n,order);
  const receipt=await mined(f.payments.connect(alice).pay(order,amount,TX));const args=event(receipt,f.payments,'Paid');
  assert.equal(args.orderId,order);same(args.payer,await address(alice));same(args.token,f.token.target);same(args.receiver,await address(treasury));assert.equal(args.amount,amount);
  const after=await snap(f,alice,1n,order);assert.equal(BigInt(before.actorBalance)-BigInt(after.actorBalance),amount);assert.equal(BigInt(after.treasuryBalance)-BigInt(before.treasuryBalance),amount);
  assert.equal(after.paymentBalance,'0');assert.equal(after.vaultBalance,'0');assert.equal(after.paid,true);assert.equal(after.allowancePayment,'0');
  observations.paymentEventFixture={event:'Paid',orderId:order,payer:args.payer,token:args.token,receiver:args.receiver,amount:String(amount),transactionHash:receipt.hash,blockNumber:receipt.blockNumber};
});

check('Successful payer-order pair cannot replay, while another payer is a distinct pair',async()=>{
  const f=await fixture(),order=ethers.id('same-order-id');
  for(const actor of [alice,bob]) await mined(f.token.connect(actor).approve(f.payments.target,2n*SHARE,TX));
  await mined(f.payments.connect(alice).pay(order,SHARE,TX));const before=await snap(f,alice,1n,order);
  await reverted(()=>f.payments.connect(alice).pay(order,SHARE,TX));await reverted(()=>f.payments.connect(alice).pay(order,SHARE+1n,TX));assert.deepEqual(await snap(f,alice,1n,order),before);
  await mined(f.payments.connect(bob).pay(order,SHARE,TX));assert.equal(await f.payments.paid(await address(bob),order),true);
});

check('Zero order, zero amount and self-payment cannot mark orders paid',async()=>{
  const f=await fixture(),order=ethers.id('invalid-payment');await mined(f.token.connect(alice).approve(f.payments.target,SHARE,TX));
  const before=await snap(f,alice,1n,order);await reverted(()=>f.payments.connect(alice).pay(ethers.ZeroHash,SHARE,TX));await reverted(()=>f.payments.connect(alice).pay(order,0n,TX));assert.deepEqual(await snap(f,alice,1n,order),before);
  await mined(f.token.transfer(await address(treasury),SHARE,TX));await mined(f.token.connect(treasury).approve(f.payments.target,SHARE,TX));const treasuryBefore=await snap(f,treasury,1n,order);
  await reverted(()=>f.payments.connect(treasury).pay(order,SHARE,TX));assert.deepEqual(await snap(f,treasury,1n,order),treasuryBefore);
});

check('Payment allowance or balance failure preserves unspent order for a valid retry',async()=>{
  const f=await fixture(),order=ethers.id('payment-retry');const before=await snap(f,alice,1n,order);
  await reverted(()=>f.payments.connect(alice).pay(order,SHARE,TX));assert.deepEqual(await snap(f,alice,1n,order),before);
  await mined(f.token.connect(alice).approve(f.payments.target,SHARE,TX));await mined(f.payments.connect(alice).pay(order,SHARE,TX));assert.equal(await f.payments.paid(await address(alice),order),true);
  await mined(f.token.connect(mallory).approve(f.payments.target,SHARE,TX));const empty=await snap(f,mallory,1n,order);await reverted(()=>f.payments.connect(mallory).pay(order,SHARE,TX));assert.deepEqual(await snap(f,mallory,1n,order),empty);
});

check('Staking approval grants payments no authority and payments cannot spend vault principal',async()=>{
  const f=await fixture(),order=ethers.id('separate-custody');await mined(f.token.connect(alice).approve(f.vault.target,2n*SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));
  const before=await snap(f,alice,1n,order);await reverted(()=>f.payments.connect(alice).pay(order,SHARE,TX));assert.deepEqual(await snap(f,alice,1n,order),before);
  await mined(f.token.connect(alice).approve(f.payments.target,SHARE,TX));await mined(f.payments.connect(alice).pay(order,SHARE,TX));assert.equal(await f.token.balanceOf(f.vault.target),SHARE);
  await mined(f.vault.connect(alice).withdraw(1n,1n,TX));assert.equal(await f.token.balanceOf(await address(treasury)),SHARE);
});

check('No owner, treasury setter, rescue, arbitrary-call or upgrade selector is reachable',async()=>{
  const f=await fixture();
  const forbidden=['owner()','setTreasury(address)','withdrawAll()','rescue(address,uint256)','upgradeTo(address)','transferOwnership(address)','execute(address,bytes)'];
  for(const contract of [f.vault,f.payments]) for(const signature of forbidden) {
    const iface=new ethers.Interface(['function '+signature]);const fragment=iface.fragments[0];
    const args=fragment.inputs.map(input=>input.type==='address'?f.token.target:input.type==='uint256'?1n:'0x');
    await reverted(()=>issuer.sendTransaction({to:contract.target,data:iface.encodeFunctionData(fragment,args),...TX}));
  }
});

check('Native currency and value attached to nonpayable entry points reject atomically',async()=>{
  const f=await fixture();await mined(f.token.connect(alice).approve(f.vault.target,SHARE,TX));const before=await snap(f);
  for(const contract of [f.vault,f.payments]) await reverted(()=>alice.sendTransaction({to:contract.target,value:1n,...TX}));
  await reverted(()=>f.vault.connect(alice).deposit(1n,{...TX,value:1n}));assert.deepEqual(await snap(f),before);
  assert.equal(await provider.getBalance(f.vault.target),0n);assert.equal(await provider.getBalance(f.payments.target),0n);
});

check('Fee-on-transfer, extra payer debit and in-transfer supply changes fail closed',async()=>{
  const f=await fixture(true),order=ethers.id('adversarial-payment');await mined(f.token.connect(alice).approve(f.vault.target,10n*SHARE,TX));await mined(f.token.connect(alice).approve(f.payments.target,10n*SHARE,TX));
  for(const mode of [1n,2n,3n,4n]) {
    await mined(f.token.setMode(mode,TX));const before=await snap(f,alice,1n,order);
    await reverted(()=>f.vault.connect(alice).deposit(1n,TX));await reverted(()=>f.payments.connect(alice).pay(order,SHARE,TX));assert.deepEqual(await snap(f,alice,1n,order),before);
  }
});

check('Failed taxed withdrawal preserves position, principal and contract accounting',async()=>{
  const f=await fixture(true);await mined(f.token.connect(alice).approve(f.vault.target,2n*SHARE,TX));await mined(f.vault.connect(alice).deposit(2n,TX));
  await mined(f.token.setMode(1n,TX));const before=await snap(f);await reverted(()=>f.vault.connect(alice).withdraw(1n,1n,TX));assert.deepEqual(await snap(f),before);
  await mined(f.token.setMode(0n,TX));await mined(f.vault.connect(alice).withdraw(1n,2n,TX));assert.equal(await f.vault.totalShares(),0n);
});

check('An unexpected preexisting supply change blocks deposit, withdrawal and payment',async()=>{
  const f=await fixture(true),order=ethers.id('supply-changed');await mined(f.token.connect(alice).approve(f.vault.target,2n*SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));await mined(f.token.connect(alice).approve(f.payments.target,SHARE,TX));await mined(f.token.changeSupply(TX));const before=await snap(f,alice,1n,order);
  await reverted(()=>f.vault.connect(alice).deposit(1n,TX));await reverted(()=>f.vault.connect(alice).withdraw(1n,1n,TX));await reverted(()=>f.payments.connect(alice).pay(order,SHARE,TX));assert.deepEqual(await snap(f,alice,1n,order),before);
});

check('Changed token bytecode is rejected before any token call or state mutation',async()=>{
  const f=await fixture(),order=ethers.id('changed-code');await mined(f.token.connect(alice).approve(f.vault.target,2n*SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));
  const code=await provider.getCode(f.token.target),before=await snap(f,alice,1n,order);
  await rpc.request({method:'hardhat_setCode',params:[f.token.target,'0x00']});
  await reverted(()=>f.vault.connect(alice).deposit(1n,TX));await reverted(()=>f.vault.connect(alice).withdraw(1n,1n,TX));await reverted(()=>f.payments.connect(alice).pay(order,SHARE,TX));
  await rpc.request({method:'hardhat_setCode',params:[f.token.target,code]});assert.deepEqual(await snap(f,alice,1n,order),before);
});

check('SafeERC20 accepts a legacy no-return token only when exact transfers hold',async()=>{
  const f=await fixture(true),order=ethers.id('legacy-no-return');await mined(f.token.setMode(5n,TX));await mined(f.token.connect(alice).approve(f.vault.target,SHARE,TX));await mined(f.vault.connect(alice).deposit(1n,TX));await mined(f.vault.connect(alice).withdraw(1n,1n,TX));
  await mined(f.token.connect(alice).approve(f.payments.target,SHARE,TX));await mined(f.payments.connect(alice).pay(order,SHARE,TX));assert.equal(await f.payments.paid(await address(alice),order),true);
});

check('Malicious token callbacks cannot reenter deposit, withdrawal or pay',async()=>{
  const f=await fixture(true),order=ethers.id('callback-payment');const selector=ethers.id('ReentrancyGuardReentrantCall()').slice(0,10);
  await mined(f.token.connect(alice).approve(f.vault.target,2n*SHARE,TX));
  await mined(f.token.configureCallback(f.vault.target,f.vault.interface.encodeFunctionData('deposit',[1n]),TX));await mined(f.vault.connect(alice).deposit(1n,TX));assert.equal(await f.token.callbackError(),selector);assert.equal(await f.vault.nextPositionId(),2n);
  await mined(f.token.configureCallback(f.vault.target,f.vault.interface.encodeFunctionData('withdraw',[1n,1n]),TX));await mined(f.vault.connect(alice).withdraw(1n,1n,TX));assert.equal(await f.token.callbackError(),selector);assert.equal(await f.vault.totalShares(),0n);
  await mined(f.token.connect(alice).approve(f.payments.target,SHARE,TX));await mined(f.token.configureCallback(f.payments.target,f.payments.interface.encodeFunctionData('pay',[order,SHARE]),TX));await mined(f.payments.connect(alice).pay(order,SHARE,TX));assert.equal(await f.token.callbackError(),selector);assert.equal(await f.token.balanceOf(await address(treasury)),SHARE);
});

check('Deterministic multi-wallet sequence conserves principal against an independent position model',async()=>{
  const f=await fixture(),actors=[alice,bob],model=new Map();let next=1n,total=0n;
  for(const actor of actors) await mined(f.token.connect(actor).approve(f.vault.target,50n*SHARE,TX));
  for(let step=0;step<36;step++) {
    const actor=actors[step%2],owner=await address(actor);const own=[...model.entries()].filter(([,value])=>value.owner===owner&&value.shares>0n);
    if(step%3!==2||own.length===0) {const shares=BigInt(1+step%3);await mined(f.vault.connect(actor).deposit(shares,TX));model.set(next++,{owner,shares});total+=shares;}
    else {const [id,position]=own[0];await mined(f.vault.connect(actor).withdraw(id,1n,TX));position.shares-=1n;total-=1n;}
    assert.equal(await f.vault.totalShares(),total);assert.equal(await f.token.balanceOf(f.vault.target),total*SHARE);
    for(const [id,expected] of model) {const actual=await f.vault.positions(id);same(actual.player,expected.owner);assert.equal(actual.shares,expected.shares);}
  }
  for(const [id,position] of model) if(position.shares>0n) {const actor=actors.find(asyncActor=>asyncActor.address===position.owner);await mined(f.vault.connect(actor).withdraw(id,position.shares,TX));}
  assert.equal(await f.vault.totalShares(),0n);assert.equal(await f.token.balanceOf(f.vault.target),0n);
  for(const actor of actors) assert.equal(await f.token.balanceOf(await address(actor)),100n*SHARE);
  observations.statefulSequence={operations:36,positions:Number(next-1n),actors:2,model:'independent JS owner/shares map, every step compared to real contract storage and token balances'};
});
