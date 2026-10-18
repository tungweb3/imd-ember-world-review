import {LocalGoldLedger,GOLD_TYPES} from './gold-ledger.mjs';
import {randomBytes} from 'node:crypto';
import {ethers,createTestProvider,testAuthority} from '../contract/tools/runtime.mjs';
import {buildSnapshot,verifySnapshot} from '../lib/snapshot.mjs';
import {appearanceIdentity,catalogueReport} from '../shared-workbench/catalogue.mjs';
import {buildMetadata} from '../shared-workbench/metadata.mjs';
import {recipeURI} from '../shared-workbench/approval.mjs';
import {LocalError,reject,walletId,equalJSON,approvalRequest,transactionRequest,adminRequest} from './schema.mjs';
import {receiptView,revertCode} from './receipts.mjs';
import {loadVerifiedArtifacts} from './artifacts.mjs';
export const GOLD_COST=1n; // Fixture only; formal GOLD/EMBEO prices remain unset.
export const COST=300000n*10n**18n;
export const APPEARANCE_TYPES={Appearance:[{name:'wallet',type:'address'},{name:'key',type:'bytes32'},{name:'uriHash',type:'bytes32'},{name:'deadline',type:'uint256'},{name:'signerEpoch',type:'uint256'}]};
const ACCEPTANCE_TYPES={SignerAcceptance:[{name:'signer',type:'address'},{name:'signerEpoch',type:'uint256'},{name:'proposalNonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
const TX={gasLimit:6000000n};
export class LocalChainService {
 constructor(){this.queue=Promise.resolve();this.closed=false;}
 serialize(operation){const result=this.queue.then(()=>{if(this.closed)reject('SERVICE_CLOSED');return operation();});this.queue=result.catch(()=>{});return result;}
 async initialize(){await this.resetChain();return this;}
 async close(){await this.queue;this.closed=true;await this.rpc?.disconnect();}
 domain(){return {name:'EmberEvoGenesisCandidate',version:'4',chainId:31337,verifyingContract:this.contractAddress};}
 async time(){return Number((await this.rpc.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);}
 async deploy(key,args){const artifact=this.artifacts[key];if(!artifact)reject('ARTIFACT_UNAVAILABLE');const contract=await new ethers.ContractFactory(artifact.abi,artifact.bytecode,this.signers[0]).deploy(...args,TX);await contract.waitForDeployment();return contract;}
 async mineSetup(transaction){return (await transaction).wait();}
 async resetChain(){
  // An injected persistent ledger belongs to its preserved chain namespace.
  // Refuse before disconnecting the provider or clearing any memory maps.
  if(this.gold&&!(this.gold instanceof LocalGoldLedger))reject('MINT_SHARED_RESET_FORBIDDEN');
  if(this.build)this.build.assertUnchanged();else this.build=loadVerifiedArtifacts();
  if(this.rpc)await this.rpc.disconnect();
  this.artifacts=this.build.artifacts;
  this.rpc=await createTestProvider(31337);this.provider=new ethers.BrowserProvider(this.rpc,undefined,{cacheTimeout:-1});this.provider.pollingInterval=10;
  this.signers=await Promise.all(Array.from({length:5},(_,i)=>this.provider.getSigner(i)));
  this.addresses=await Promise.all(this.signers.map(signer=>signer.getAddress()));
  this.authority=testAuthority(0);this.recipientIndex=4;this.runId=randomBytes(16).toString('hex');this.revision=0;
  this.gold=new LocalGoldLedger();this.orders=new Map();this.records=[];this.receipts=[];this.packets=new Map();this.submissions=new Set();
  this.accounts=[{id:'A',label:'錢包 A · 有免費資格',index:1},{id:'B',label:'錢包 B · 有免費資格',index:2},{id:'C',label:'錢包 C · 無免費資格',index:3}];
  this.token=await this.deploy('contracts/test/Fixtures.sol:FixtureToken',[this.addresses[1]]);
  this.tokenAddress=await this.token.getAddress();
  this.contract=await this.deploy('contracts/EmberEvoGenesisCandidate.sol:EmberEvoGenesisCandidate',[this.addresses[0],this.tokenAddress,this.addresses[4],this.addresses[0],COST,GOLD_COST,'LOCAL_R4']);
  this.contractAddress=await this.contract.getAddress();
  const [domain,max,goldCost,decimals,cost,paymentToken,mintCode,tokenCode]=await Promise.all([this.contract.eip712Domain(),this.contract.MAX_SUPPLY(),this.contract.paidGoldCost(),this.token.decimals(),this.contract.paidCost(),this.contract.paymentToken(),this.provider.getCode(this.contractAddress),this.provider.getCode(this.tokenAddress)]);
  if(domain.name!=='EmberEvoGenesisCandidate'||domain.version!=='4'||domain.chainId!==31337n||domain.verifyingContract!==this.contractAddress||max!==2222n||goldCost!==GOLD_COST||decimals!==18n||cost!==COST||paymentToken!==this.tokenAddress||mintCode==='0x'||tokenCode==='0x')reject('DEPLOYED_IDENTITY_INVALID');
  this.deployedCode={mintCodeKeccak256:ethers.keccak256(mintCode),tokenCodeKeccak256:ethers.keccak256(tokenCode)};
  await this.mineSetup(this.token.connect(this.signers[1]).transfer(this.addresses[2],900000n*10n**18n,TX));
  await this.mineSetup(this.token.connect(this.signers[1]).transfer(this.addresses[3],100000n*10n**18n,TX));
  this.snapshot=buildSnapshot(this.accounts.map(account=>({wallet:this.addresses[account.index],activeAgentCount:account.id==='C'?0:account.id==='B'?3:1})));
  verifySnapshot(this.snapshot);const now=await this.time();
  await this.mineSetup(this.contract.configureSnapshot(this.snapshot.root,this.snapshot.counts.eligibleWalletCount,now,now+20,TX));
  await this.mineSetup(this.contract.approvePaidPriceForLocalTest(TX));await this.mineSetup(this.contract.setMintPaused(false,TX));
  await this.rpc.request({method:'evm_setNextBlockTimestamp',params:[now+20]});await this.rpc.request({method:'evm_mine',params:[]});
 }
 account(id){walletId(id);return this.accounts.find(account=>account.id===id);}
 async readState(){
  await this.reconcileOrders();
  const now=await this.time(),[start,total,free,paid,paused,recipient,signer,epoch,reserved,available]=await Promise.all([
   this.contract.freeStartAt(),this.contract.totalMinted(),this.contract.freeMinted(),this.contract.paidMinted(),this.contract.mintPaused(),this.contract.paymentRecipient(),this.contract.appearanceSigner(),this.contract.signerEpoch(),this.contract.remainingFreeReservation(),this.contract.paidAvailability()]);
  const wallets=await Promise.all(this.accounts.map(async account=>{
   const address=this.addresses[account.index],[freeClaimed,balance,allowance,eth]=await Promise.all([this.contract.freeClaimed(address),this.token.balanceOf(address),this.token.allowance(address,this.contractAddress),this.provider.getBalance(address)]);
   return {id:account.id,label:account.label,address,gold:await this.gold.view(account.id),eligible:this.snapshot.proofs.some(p=>p.wallet===address.toLowerCase()),freeClaimed,tokenBalanceAtomic:balance.toString(),ethBalanceWei:eth.toString(),allowanceAtomic:allowance.toString()};
  }));
  const phase=total===2222n?'soldout':now<Number(start)?'before':'open';
  return {scope:'LOCAL_EDR_TEST_ONLY',build:{...structuredClone(this.build.identity),deployedCode:this.deployedCode},chainId:31337,runId:this.runId,revision:this.revision,now,freeStartAt:Number(start),saleStartAt:Number(start),phase,paused,
   contractAddress:this.contractAddress,tokenAddress:this.tokenAddress,priceAtomic:COST.toString(),goldPrice:GOLD_COST.toString(),priceStatus:'FIXTURE_ONLY_FORMAL_PRICES_UNSET',recipient,recipientBalanceAtomic:(await this.token.balanceOf(recipient)).toString(),signer,signerEpoch:epoch.toString(),
   totalMinted:total.toString(),freeMinted:free.toString(),paidMinted:paid.toString(),freeReserved:reserved.toString(),paidAvailable:available.toString(),
   snapshot:{scope:this.snapshot.scope,root:this.snapshot.root,eligibleWalletCount:this.snapshot.counts.eligibleWalletCount,sourceVerified:false,snapshotAt:null,freeStartAt:null},
   orders:[...this.orders.values()].map(o=>({orderId:o.auth.orderId,wallet:o.wallet,status:o.status,goldCost:o.auth.goldCost,deadline:o.auth.deadline,transactionHash:o.transactionHash??null,error:o.error??null})),catalogue:catalogueReport(),wallets,records:structuredClone(this.records),receipts:structuredClone(this.receipts)};
 }
 state(){return this.serialize(()=>this.readState());}
 approval(input){return this.serialize(async()=>{
  await this.beforeApproval?.();
  approvalRequest(input);const account=this.account(input.wallet);let identity;
  try{identity=appearanceIdentity(input.look);}catch(error){reject(/^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)?error.message:'LOOK_INVALID');}
  if(this.packets.size>=4096)reject('LOCAL_PACKET_LIMIT');if(await this.contract.mintPaused())reject('MINT_PAUSED');if(await this.contract.appearanceUsed(identity.key))reject('APPEARANCE_ALREADY_MINTED');
  const now=await this.time(),deadline=now+300,walletAddress=this.addresses[account.index],uri=recipeURI(identity.key),signerEpoch=(await this.contract.signerEpoch()).toString();
  const domain=this.domain(),value={wallet:walletAddress,key:identity.key,uriHash:ethers.keccak256(ethers.toUtf8Bytes(uri)),deadline,signerEpoch};
  const signature=await this.authority.signTypedData(domain,APPEARANCE_TYPES,value);
  if(ethers.verifyTypedData(domain,APPEARANCE_TYPES,value,signature)!==this.authority.address)reject('LOCAL_SIGNATURE_INVALID');
  const packet={route:input.route??'free',scope:'LOCAL_EDR_TEST_ONLY',packetId:randomBytes(16).toString('hex'),runId:this.runId,wallet:input.wallet,walletAddress,...identity,uri,deadline,signer:this.authority.address,signerEpoch,domain,value,signature,expectedRecipient:await this.contract.paymentRecipient(),expectedCost:COST.toString()};
  // identity.scope describes the concept catalogue; packet.scope describes actual local signing.
  packet.scope='LOCAL_EDR_TEST_ONLY';
  if(now<Number(await this.contract.freeStartAt()))reject('SALE_NOT_STARTED');
  if(await this.contract.totalMinted()>=2222n)reject('SOLD_OUT');
  if(packet.route==='free'){if(!this.snapshot.proofs.some(p=>p.wallet===walletAddress.toLowerCase()))reject('NOT_IN_SNAPSHOT');if(await this.contract.freeClaimed(walletAddress))reject('FREE_ALREADY_CLAIMED');}
  else {
   const existing=[...this.orders.values()].find(o=>o.status==='reserved'&&o.wallet===input.wallet&&o.auth.key===packet.key&&o.auth.deadline>=now&&o.auth.signerEpoch===signerEpoch&&o.auth.recipient===packet.expectedRecipient);
   if(existing)return {packet:structuredClone(existing.packet),state:await this.readState()};
   const auth={orderId:ethers.hexlify(randomBytes(32)),wallet:walletAddress,key:packet.key,uriHash:value.uriHash,recipient:packet.expectedRecipient,embeoCost:packet.expectedCost,goldCost:GOLD_COST.toString(),deadline,signerEpoch};
   if(await this.token.balanceOf(walletAddress)<COST)reject('EMBEO_INSUFFICIENT');
   await this.gold.reserve(auth.orderId,input.wallet,GOLD_COST,{auth,packet});
   const order={auth,wallet:input.wallet,packet,status:'reserved'};this.orders.set(auth.orderId,order);
   packet.goldAuthorization=auth;packet.goldSignature=await this.authority.signTypedData(domain,GOLD_TYPES,auth);
  }
  this.revision++;this.packets.set(packet.packetId,structuredClone(packet));
  return {packet,state:await this.readState()};
 });}
 validatePacket(packet,id){
  if(!packet||typeof packet!=='object'||packet.runId!==this.runId)reject('RUN_CHANGED');
  const issued=this.packets.get(packet.packetId);if(!issued||!equalJSON(packet,issued))reject('PACKET_CHANGED');
  if(issued.wallet!==id)reject('WALLET_CHANGED');return issued;
 }
 async send(action,wallet,operation,diagnose=null,submissionId=null){
  if(submissionId){if(this.submissions.has(submissionId))reject('SUBMISSION_ALREADY_SENT');if(this.submissions.size>=4096)reject('LOCAL_SUBMISSION_LIMIT');this.submissions.add(submissionId);}
  let transaction,receipt,code='TRANSACTION_REVERTED';
  try{transaction=await operation();receipt=await transaction.wait();}
  catch(error){receipt=error.receipt;code=revertCode(error);if(!receipt)throw new LocalError('TRANSACTION_OUTCOME_UNKNOWN','unknown',null,transaction?.hash??null);}
  if(receipt.status!==1&&diagnose){try{await diagnose();}catch(error){code=revertCode(error);}}
  let result;try{result=await receiptView(receipt,{action,wallet,contract:this.contract,token:this.token,submissionId});}catch{throw new LocalError('NFT_READBACK_REQUIRED','unknown',null,receipt.hash);}
  this.receipts.push(result);if(this.receipts.length>100)this.receipts.shift();this.revision++;
  if(receipt.status!==1)throw new LocalError(code,'reverted',result);
  return result;
 }
 transaction(input){return this.serialize(async()=>{
  transactionRequest(input);const account=this.account(input.wallet),signer=this.signers[account.index];let receipt,packet;
  if(input.action==='approve')receipt=await this.send(input.action,input.wallet,()=>this.token.connect(signer).approve(this.contractAddress,COST,TX),null,input.submissionId);
  else {
   packet=this.validatePacket(input.packet,input.wallet);
   if((input.action==='mintFree'?'free':'paid')!==packet.route)reject('MINT_ROUTE_CHANGED');
   if(packet.route==='paid'){
    await this.reconcileOrders();const order=this.orders.get(packet.goldAuthorization.orderId);
    if(!order||order.status!=='reserved')reject('PAID_ORDER_UNAVAILABLE');
    if(order.submissionId&&!this.receipts.some(r=>r.submissionId===order.submissionId&&r.action==='mintPaid'&&r.wallet===input.wallet&&r.status===0))reject('PAID_ORDER_PENDING');
    order.submissionId=input.submissionId;
   }
   const args=[packet.key,packet.uri,packet.deadline,packet.signature];
   if(input.action==='mintFree'){const proof=this.snapshot.proofs.find(p=>p.wallet===packet.walletAddress.toLowerCase())?.proof??[];receipt=await this.send(input.action,input.wallet,()=>this.contract.connect(signer).mintFree(...args,proof,TX),()=>this.contract.connect(signer).mintFree.staticCall(...args,proof,TX),input.submissionId);}
   else receipt=await this.send(input.action,input.wallet,()=>this.contract.connect(signer).mintPaid(...args,packet.expectedRecipient,packet.expectedCost,packet.goldAuthorization,packet.goldSignature,TX),()=>this.contract.connect(signer).mintPaid.staticCall(...args,packet.expectedRecipient,packet.expectedCost,packet.goldAuthorization,packet.goldSignature,TX),input.submissionId);
   if(packet.route==='paid')await this.reconcileOrders();
   const record={id:receipt.tokenId,key:packet.key,selection:packet.selection,owner:receipt.owner,uri:receipt.tokenURI,transactionHash:receipt.hash};record.metadata=buildMetadata(record);if(!this.records.some(r=>r.id===record.id))this.records.push(record);
  }
  return {receipt,state:await this.readState()};
 });}
 async advance(seconds){const target=(await this.time())+seconds;await this.rpc.request({method:'evm_setNextBlockTimestamp',params:[target]});await this.rpc.request({method:'evm_mine',params:[]});this.revision++;}
 async reconcileOrders(){
  for(const order of this.orders.values()){
   if(order.status!=='reserved')continue;
   try{
    const auth=order.auth,used=await this.contract.paidOrderTokenId(auth.orderId);
    if(used!==0n){
     const events=await this.contract.queryFilter(this.contract.filters.PaidOrderConsumed(auth.orderId),0,'latest');
     if(events.length!==1)throw Error('RECONCILIATION_EVIDENCE_CONFLICT');
     const event=events[0],receipt=await this.provider.getTransactionReceipt(event.transactionHash);
     if(!receipt||receipt.status!==1||receipt.to?.toLowerCase()!==this.contractAddress.toLowerCase())throw Error('CHAIN_READ_RETRY');
     const minted=receipt.logs.filter(l=>l.address.toLowerCase()===this.contractAddress.toLowerCase()).map(l=>{try{return this.contract.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='GenesisMinted');
     if(event.args.wallet.toLowerCase()!==auth.wallet.toLowerCase()||event.args.tokenId!==used||event.args.goldCost!==BigInt(auth.goldCost)||!minted||minted.args.wallet.toLowerCase()!==auth.wallet.toLowerCase()||minted.args.tokenId!==used||minted.args.key!==auth.key||!minted.args.paid||minted.args.cost!==BigInt(auth.embeoCost))throw Error('RECONCILIATION_EVIDENCE_CONFLICT');
     const view=await receiptView(receipt,{action:'mintPaid',wallet:order.wallet,contract:this.contract,token:this.token,submissionId:order.submissionId??null});
     const packet=order.packet,record={id:Number(used),key:packet.key,selection:packet.selection,owner:view.owner,uri:view.tokenURI,transactionHash:view.hash};record.metadata=buildMetadata(record);
     // Dedupe is the same for normal completion and later recovery.
     await this.gold.consume(auth.orderId);
     if(!this.records.some(r=>r.id===record.id))this.records.push(record);
     if(!this.receipts.some(r=>r.hash===view.hash))this.receipts.push(view);
     order.status='consumed';order.transactionHash=view.hash;order.error=null;this.revision++;
    }else if(await this.contract.paidOrderRevoked(auth.orderId)||(await this.time())>auth.deadline){
     // The read is from this exact private chain/contract/order. UI state is never evidence.
     await this.gold.release(auth.orderId);order.status='released';order.error=null;this.revision++;
    }else order.error=null;
   }catch(error){order.error=error.message==='RECONCILIATION_EVIDENCE_CONFLICT'?error.message:'CHAIN_READ_RETRY';}
  }
 }
 cancelOrder(input){return this.serialize(async()=>{
  if(!input||Object.keys(input).sort().join(',')!=='orderId,wallet'||!/^0x[0-9a-f]{64}$/.test(input.orderId))reject('REQUEST_SCHEMA_INVALID');
  walletId(input.wallet);const order=this.orders.get(input.orderId);if(!order||order.wallet!==input.wallet)reject('ORDER_NOT_FOUND');
  await this.reconcileOrders();
  if(order.status==='reserved')await this.send('revokePaidOrder',input.wallet,()=>this.contract.revokePaidOrder(order.auth.orderId,TX));
  await this.reconcileOrders();return {state:await this.readState()};
 });}
 admin(input){return this.serialize(async()=>{
  adminRequest(input);let receipt;
  if(input.action==='reset')await this.resetChain();
  else if(input.action==='advance')await this.advance(input.seconds);
  else if(input.action==='advanceThreeDays')await this.advance(259200);
  else if(input.action==='pause'||input.action==='resume')receipt=await this.send(input.action,null,()=>this.contract.setMintPaused(input.action==='pause',TX));
  else if(input.action==='changeRecipient'){this.recipientIndex=this.recipientIndex===4?0:4;receipt=await this.send(input.action,null,()=>this.contract.setPaymentRecipient(this.addresses[this.recipientIndex],TX));}
  else if(input.action==='rotateSigner')receipt=await this.rotateSigner();
  return {receipt:receipt??null,state:await this.readState()};
 });}
 async rotateSigner(){
  const wasPaused=await this.contract.mintPaused();if(!wasPaused)await this.send('pause',null,()=>this.contract.setMintPaused(true,TX));
  const next=testAuthority(this.authority.address===this.addresses[0]?4:0);
  await this.send('proposeSigner',null,()=>this.contract.proposeAppearanceSigner(next.address,TX));
  const deadline=(await this.time())+300,value={signer:next.address,signerEpoch:(await this.contract.signerEpoch()+1n).toString(),proposalNonce:(await this.contract.signerProposalNonce()).toString(),deadline};
  const signature=await next.signTypedData(this.domain(),ACCEPTANCE_TYPES,value);
  const receipt=await this.send('activateSigner',null,()=>this.contract.activateAppearanceSigner(deadline,signature,TX));this.authority=next;
  if(!wasPaused)await this.send('resume',null,()=>this.contract.setMintPaused(false,TX));return receipt;
 }
}
export async function createLocalService(){const service=new LocalChainService();try{return await service.initialize();}catch(error){await service.rpc?.disconnect();throw error;}}
