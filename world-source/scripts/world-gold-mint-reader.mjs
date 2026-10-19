import {ethers} from '../../mint/contract/tools/runtime.mjs';

/** PRIVATE EDR ONLY. Production needs its own finalized, deployment-pinned
 * reader/registry. Capturing an old runId against a new EVM is not recovery. */
export async function createPrivateMintReader(mint){
 const chainInstance=mint.runId,contract=mint.contractAddress.toLowerCase();
 const anchor=Object.freeze({genesisHash:(await mint.provider.getBlock(0)).hash,codeHash:ethers.keccak256(await mint.provider.getCode(contract))});
 return Object.freeze({chainId:31337,contract,chainInstance,anchor,async read(m){
  if(m.chainId!==31337||m.contract!==contract||m.chainInstance!==chainInstance||mint.runId!==chainInstance||Number(BigInt(await mint.rpc.request({method:'eth_chainId',params:[]})))!==31337)throw Error('MINT_SCOPE_MISMATCH');
  const stored=m.auth,auth=stored?.auth;
  if(!auth||auth.orderId!==m.id||auth.wallet.toLowerCase()!==m.wallet||String(auth.goldCost)!==m.gold||auth.deadline*1000!==m.deadline)throw Error('MINT_PROOF_CONFLICT');
  if(stored.chainAnchor&&(stored.chainAnchor.genesisHash!==anchor.genesisHash||stored.chainAnchor.codeHash!==anchor.codeHash))throw Error('MINT_SCOPE_MISMATCH');
  const block=await mint.provider.getBlock('latest');
  if((await mint.provider.getBlock(0)).hash!==anchor.genesisHash||ethers.keccak256(await mint.provider.getCode(contract,block.number))!==anchor.codeHash)throw Error('MINT_SCOPE_MISMATCH');
  const tokenId=await mint.contract.paidOrderTokenId(m.id,{blockTag:block.number}),revoked=await mint.contract.paidOrderRevoked(m.id,{blockTag:block.number});
  let transactionHash;
  if(tokenId!==0n){
   const logs=await mint.contract.queryFilter(mint.contract.filters.PaidOrderConsumed(m.id),0,block.number);if(logs.length!==1)throw Error('MINT_PROOF_CONFLICT');
   const event=logs[0],receipt=await mint.provider.getTransactionReceipt(event.transactionHash),canonical=await mint.provider.getBlock(event.blockNumber);
   if(!receipt||receipt.status!==1||receipt.to?.toLowerCase()!==contract||receipt.blockHash!==canonical.hash||event.blockHash!==canonical.hash)throw Error('MINT_PROOF_CONFLICT');
   const minted=receipt.logs.filter(l=>l.address.toLowerCase()===contract).map(l=>{try{return mint.contract.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='GenesisMinted');
   if(event.args.wallet.toLowerCase()!==m.wallet||event.args.tokenId!==tokenId||event.args.goldCost!==BigInt(m.gold)||!minted||minted.args.wallet.toLowerCase()!==m.wallet||minted.args.tokenId!==tokenId||minted.args.key!==auth.key||!minted.args.paid||minted.args.cost!==BigInt(auth.embeoCost))throw Error('MINT_PROOF_CONFLICT');
   transactionHash=receipt.hash;
  }
  if((await mint.provider.getBlock(block.number)).hash!==block.hash)throw Error('MINT_CHAIN_UNAVAILABLE');
  return {schema:'ember-mint-proof-v1',mode:'private-chain-fixture',orderId:m.id,wallet:m.wallet,gold:m.gold,chainId:31337,contract,chainInstance,blockHash:block.hash,blockNumber:String(block.number),chainTimeMs:block.timestamp*1000,tokenId:String(tokenId),revoked,...transactionHash?{transactionHash}:{}};
 }});
}
