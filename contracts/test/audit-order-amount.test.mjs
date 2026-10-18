import test from 'node:test';
import assert from 'node:assert/strict';
import {ethers,TX,artifacts,tokenArtifact,createIsolatedProvider,deploy} from './runtime.mjs';
test('a manual wrong amount cannot consume the exact quoted payment slot; exact replay and other-payer isolation remain enforced',async()=>{
 const rpc=await createIsolatedProvider(),provider=new ethers.BrowserProvider(rpc,undefined,{cacheTimeout:-1});provider.pollingInterval=5;
 try{const [issuer,payer,other,treasury]=await Promise.all([0,1,2,3].map(i=>provider.getSigner(i))),token=await deploy(tokenArtifact,issuer),pay=await deploy(artifacts.EmbeoPayments,issuer,token.target,await treasury.getAddress());
  const amount=10n**18n,order=ethers.id('isolated-audit-order');
  await(await token.transfer(await payer.getAddress(),3n*amount,TX)).wait();await(await token.connect(payer).approve(pay.target,3n*amount,TX)).wait();
  const mistaken=await(await pay.connect(payer).pay(order,1n,TX)).wait();assert.equal(mistaken.status,1);assert.equal(await token.balanceOf(await treasury.getAddress()),1n);
  const exact=await(await pay.connect(payer).pay(order,amount,TX)).wait();assert.equal(exact.status,1);assert.equal(await token.balanceOf(await treasury.getAddress()),amount+1n);
  await assert.rejects(pay.connect(payer).pay.staticCall(order,amount),/OrderAlreadyPaid/);
  await(await token.transfer(await other.getAddress(),amount,TX)).wait();await(await token.connect(other).approve(pay.target,amount,TX)).wait();assert.equal((await(await pay.connect(other).pay(order,amount,TX)).wait()).status,1);
  assert.equal(await token.balanceOf(await treasury.getAddress()),2n*amount+1n);
 }finally{provider.destroy();await rpc.disconnect();}
});
