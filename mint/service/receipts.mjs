import {ethers} from '../contract/tools/runtime.mjs';
const strings=value=>typeof value==='bigint'?value.toString():value;
function eventLog(log,contract,token){
 for(const iface of [contract,token].filter(c=>c.target.toLowerCase()===log.address.toLowerCase()).map(c=>c.interface)){
  try{const event=iface.parseLog(log);if(!event)continue;return {name:event.name,args:Object.fromEntries(event.fragment.inputs.map((input,index)=>[input.name||String(index),strings(event.args[index])]))};}catch{}
 }
 return null;
}
export async function receiptView(receipt,{action,wallet,contract,token,submissionId=null}){
 const logs=receipt.logs.map(log=>eventLog(log,contract,token)).filter(Boolean),mint=logs.find(log=>log.name==='GenesisMinted');
 const tokenId=mint?Number(mint.args.tokenId):null;
 return {scope:'LOCAL_EDR_TEST_ONLY',submissionId,action,wallet:wallet??null,from:receipt.from,hash:receipt.hash,transactionHash:receipt.hash,
  status:receipt.status,blockNumber:receipt.blockNumber,gasUsed:receipt.gasUsed.toString(),gasPrice:receipt.gasPrice.toString(),
  feeWei:(receipt.gasUsed*receipt.gasPrice).toString(),tokenId,owner:tokenId?await contract.ownerOf(tokenId):null,
  tokenURI:tokenId?await contract.tokenURI(tokenId):null,logs};
}
export function revertCode(error){
 const data=error?.data??error?.info?.error?.data?.data??error?.info?.error?.data;
 try{if(typeof data==='string'&&data.startsWith('0x08c379a0'))return ethers.AbiCoder.defaultAbiCoder().decode(['string'],'0x'+data.slice(10))[0];}catch{}
 const reason=error?.reason;
 return typeof reason==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/.test(reason)?reason:'TRANSACTION_REVERTED';
}
