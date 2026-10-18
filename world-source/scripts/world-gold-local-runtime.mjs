import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LocalChainService} from '../../mint/service/chain.mjs';
import {ethers} from '../../mint/contract/tools/runtime.mjs';
import {defineLocalEconomyConfig,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {worldGoldSnapshot,reserveMintGold,settleMintGold,storedMintGold,reconcileHeldMintGold,goldAdminCommand,goldProducts,goldFeature,reconcileWorldGold,claimGoldJob,finishGoldJob} from '../server/world-gold.ts';
import {createPrivateMintReader} from './world-gold-mint-reader.mjs';
import {ingestEconomyEvents} from '../server/economy-ledger.ts';
import {openGoldDatabase} from './world-gold-local-db.mjs';
const paymentURL=new URL('../../contracts/artifacts/EmbeoPayments.json',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function createGoldLocalRuntime({filename=':memory:'}={}){
 let db=openGoldDatabase(filename,{privateChain:true});const mint=await new LocalChainService().initialize();
 try{
 const bytes=readFileSync(paymentURL),artifact=JSON.parse(bytes);
 // Exact fixed compiler artifact; no package installation or public-chain RPC.
 const expected='0036fc322657a31d318a230b1a173435823b25dfc2bbf84ca5ab0c82d44a876e';if(sha(bytes)!==expected)throw Error('PAYMENT_ARTIFACT_CHANGED');
 const payment=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,mint.signers[0]).deploy(mint.tokenAddress,mint.addresses[4]);await payment.waitForDeployment();
 const block=await mint.provider.getBlock('latest');
 const config=await defineLocalEconomyConfig({chainId:31337,token:mint.tokenAddress,tokenDecimals:18,stakingContract:'0x'+'9'.repeat(40),paymentContract:await payment.getAddress(),treasury:mint.addresses[4],deploymentBlock:String(block.number),catalogue:[]});
 const products=await goldProducts(db);if(!products.length){for(const c of [{action:'product',product:'gold-pack',kind:'topup',title:'本機測試購點',gold:'10',embeo:String(7n*10n**18n),enabled:true,version:1},{action:'product',product:'research',kind:'service',title:'AIMarket 本機交付測試',gold:'3',enabled:true,version:1},{action:'product',product:'fortune',kind:'service',title:'算命館本機交付測試',gold:'2',enabled:true,version:1}])await goldAdminCommand(db,{wallet:ECONOMY_TREASURY,requestId:crypto.randomUUID(),command:c,reason:'initialize isolated local fixture',nowMs:Date.now()});}
 const mintReader=await createPrivateMintReader(mint);
 mint.beforeApproval=route=>route==='paid'?goldFeature(db,'mint'):undefined;
 mint.gold={
  async view(id){const account=mint.account(id);const {book,reserved,available}=await worldGoldSnapshot(db,mint.addresses[account.index],Date.now());return {book,reserved,available};},
  async reserve(id,wallet,cost,{auth,packet}){await reserveMintGold(db,{id,wallet:auth.wallet,auth:{auth,packet,chainAnchor:mintReader.anchor},gold:String(cost),chainId:31337,contract:mint.contractAddress,chainInstance:mint.runId,deadline:auth.deadline*1000},(await mint.time())*1000);},
  async consume(id){const m=await storedMintGold(db,id),proof=await mintReader.read(m);await settleMintGold(db,{id,chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,state:'consumed',evidence:proof},Date.now());},
  async release(id){const m=await storedMintGold(db,id),proof=await mintReader.read(m);await settleMintGold(db,{id,chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,state:'released',evidence:proof},Date.now());}
 };
 let cursor=block.number-1;
 async function scan(){const latest=await mint.provider.getBlock('latest');if(latest.number<=cursor){await reconcileWorldGold(db,Date.now());return;}
  const logs=await payment.queryFilter(payment.filters.Paid(),cursor+1,latest.number),events=[];
  for(const log of logs){const receipt=await mint.provider.getTransactionReceipt(log.transactionHash),b=await mint.provider.getBlock(log.blockNumber);if(!receipt||receipt.status!==1||receipt.to.toLowerCase()!==config.paymentContract||b.hash!==log.blockHash)throw Error('FIXTURE_PAYMENT_RECEIPT_INVALID');events.push({kind:'payment',transactionHash:log.transactionHash,logIndex:log.index,blockNumber:String(log.blockNumber),blockHash:log.blockHash,timestamp:b.timestamp*1000,wallet:log.args.payer,amount:String(log.args.amount),orderId:log.args.orderId,token:log.args.token,receiver:log.args.receiver});}
  await ingestEconomyEvents(db,config,{fromBlock:String(cursor+1),toBlock:String(latest.number),toBlockHash:latest.hash,throughTimestamp:latest.timestamp*1000,events});cursor=latest.number;await reconcileWorldGold(db,Date.now());
 }
 async function pay(id,wallet){const order=await db.prepare('SELECT id,wallet,amount,currency FROM economy_orders WHERE id=?').bind(id).first();if(!order||order.wallet!==wallet.toLowerCase()||order.currency!=='EMBEO')throw Error('ORDER_NOT_FOUND');const i=mint.addresses.findIndex(a=>a.toLowerCase()===wallet.toLowerCase());if(i<1||i>3)throw Error('FIXTURE_WALLET_REQUIRED');
  await (await mint.token.connect(mint.signers[i]).approve(config.paymentContract,BigInt(order.amount))).wait();const receipt=await (await payment.connect(mint.signers[i]).pay(id,BigInt(order.amount))).wait();await scan();return {transactionHash:receipt.hash};
 }
 async function deliver(id,outcome='success'){await reconcileWorldGold(db,Date.now(),id);const attempt=await claimGoldJob(db,id,Date.now());if(!attempt)return;await finishGoldJob(db,{orderId:id,attempt,nowMs:Date.now(),outcome:outcome==='success'?{result:{scope:'LOCAL_FIXTURE_NOT_REAL_REPORT',orderId:id,title:'本機服務結果',content:'同一份結果可再次開啟，不重複扣點。'}}:{failure:'fixture-provider-confirmed-no-delivery',evidence:{kind:'provider-confirmed-nondelivery',provider:'local-fixture',reference:id}}});}
 return {mint,payment,config,mintReader,get db(){return db;},scan,pay,deliver,reconcileMintHolds:options=>reconcileHeldMintGold(db,mintReader,Date.now(),options),async reopen(){db.raw.close();db=openGoldDatabase(filename,{privateChain:true});await reconcileHeldMintGold(db,mintReader,Date.now());await mint.state();},async close(){await mint.close();db.raw.close();}};
 }catch(e){await mint.close();db.raw.close();throw e;}
}
