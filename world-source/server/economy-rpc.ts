import {keccak256,stringToHex} from 'viem';
import type {D1Database} from './d1.ts';
import {rpc as ownershipRpc,type ChainAccess} from './ownership.ts';
import {defineEconomyConfig,ECONOMY_HASH,ECONOMY_MAX_INTEGER,ECONOMY_MAX_UINT256,ECONOMY_SHARE_WEI,economyAddress,economyDigest,type EconomyConfig} from './economy-config.ts';
import {economyChainState,haltEconomyChain,ingestEconomyEvents,settleEconomy,type EconomyChainEvent} from './economy-ledger.ts';
import {pendingEconomyBlock,stageEconomyBlock} from './economy-staging.ts';

/** Result-only RPC, injected for tests. No browser URL, transaction or balance is an input. */
export type EconomyRpc=(method:string,params:unknown[])=>Promise<unknown>;
export const ECONOMY_MAX_BLOCKS=128,ECONOMY_MAX_LOGS=256,ECONOMY_SYNC_TIMEOUT_MS=25_000;
export const ECONOMY_EVENT_TOPICS=Object.freeze({
  stake:keccak256(stringToHex('Staked(address,uint256,uint256,uint256)')),
  withdraw:keccak256(stringToHex('Withdrawn(address,uint256,uint256,uint256)')),
  payment:keccak256(stringToHex('Paid(bytes32,address,address,address,uint256)'))
});
export class EconomyRpcError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
const fail=(code:string):never=>{throw new EconomyRpcError(code);};
const methods=new Set(['eth_chainId','eth_getBlockByNumber','eth_getLogs','eth_getTransactionReceipt']);
/** Reuses the existing fixed Alchemy endpoint and header-only credential flow. */
export function createEconomyRpc(chain:ChainAccess):EconomyRpc{return async(method,params)=>{
  if(!methods.has(method))return fail('RPC_METHOD_NOT_ALLOWED');
  let reply;try{reply=await ownershipRpc(chain,method,params);}catch{return fail('ECONOMY_RPC_UNAVAILABLE');}
  if(reply.error!==undefined){
    if(method==='eth_getLogs'&&reply.error!==null&&typeof reply.error==='object'&&(reply.error as {code?:unknown}).code===-32005)return fail('RPC_RESULT_LIMIT');
    return fail('ECONOMY_RPC_UNAVAILABLE');
  }
  if(reply.result===undefined)return fail('ECONOMY_RPC_UNAVAILABLE');return reply.result;
};}
type Json=Record<string,unknown>;
const object=(value:unknown):Json=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Json:fail('MALFORMED_RPC_OBJECT');
function quantity(value:unknown,max=ECONOMY_MAX_INTEGER):bigint{
  if(typeof value!=='string'||! /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value))return fail('MALFORMED_RPC_QUANTITY');
  const result=BigInt(value);if(result>max)return fail('RPC_INTEGER_RANGE');return result;
}
const hex=(value:bigint)=>'0x'+value.toString(16);
function hash(value:unknown):string{if(typeof value!=='string'||!ECONOMY_HASH.test(value))return fail('MALFORMED_RPC_HASH');return value.toLowerCase();}
function address(value:unknown):string{try{return economyAddress(value);}catch{return fail('MALFORMED_RPC_ADDRESS');}}
function word(value:unknown):string{if(typeof value!=='string'||! /^0x[0-9a-fA-F]{64}$/.test(value))return fail('MALFORMED_ABI_WORD');return value.slice(2).toLowerCase();}
function addressWord(value:unknown):string{const w=word(value);if(!/^0{24}/.test(w))return fail('NONCANONICAL_ABI_ADDRESS');return address('0x'+w.slice(24));}
function uintWord(value:unknown,max=ECONOMY_MAX_UINT256):string{const n=BigInt('0x'+word(value));if(n===0n||n>max)return fail('INVALID_EVENT_INTEGER');return String(n);}
type Block={number:bigint;hash:string;parentHash:string;timestamp:number;gasLimit?:bigint};
const sameBlockIdentity=(a:Block,b:Block)=>a.number===b.number&&a.hash===b.hash&&a.parentHash===b.parentHash&&a.timestamp===b.timestamp&&(a.gasLimit===undefined||b.gasLimit===undefined||a.gasLimit===b.gasLimit);
function block(value:unknown,expected?:bigint):Block{
  const b=object(value),number=quantity(b.number),seconds=quantity(b.timestamp,BigInt(Math.floor(Number.MAX_SAFE_INTEGER/1000)));
  if(expected!==undefined&&number!==expected)return fail('WRONG_RPC_BLOCK');
  return {number,hash:hash(b.hash),parentHash:hash(b.parentHash),timestamp:Number(seconds)*1000,...b.gasLimit!==undefined?{gasLimit:quantity(b.gasLimit)}:{}};
}
type Log={address:string;topics:string[];data:string;transactionHash:string;logIndex:number;blockNumber:bigint;blockHash:string};
function log(value:unknown):Log{
  const l=object(value);if(l.removed!==false)return fail('REMOVED_OR_UNCONFIRMED_LOG');
  if(!Array.isArray(l.topics)||l.topics.length<1||l.topics.length>4||typeof l.data!=='string'||!/^0x[0-9a-fA-F]*$/.test(l.data))return fail('MALFORMED_RPC_LOG');
  return {address:address(l.address),topics:l.topics.map(hash),data:l.data.toLowerCase(),transactionHash:hash(l.transactionHash),
    logIndex:Number(quantity(l.logIndex,2_147_483_647n)),blockNumber:quantity(l.blockNumber),blockHash:hash(l.blockHash)};
}
function decode(config:EconomyConfig,l:Log,timestamp:number):EconomyChainEvent{
  const base={transactionHash:l.transactionHash,logIndex:l.logIndex,blockNumber:String(l.blockNumber),blockHash:l.blockHash,timestamp};
  if(l.data.length!==130)return fail('NONCANONICAL_EVENT_DATA');
  const a='0x'+l.data.slice(2,66),b='0x'+l.data.slice(66,130);
  if(l.address===config.stakingContract&&(l.topics[0]===ECONOMY_EVENT_TOPICS.stake||l.topics[0]===ECONOMY_EVENT_TOPICS.withdraw)){
    if(l.topics.length!==3)return fail('NONCANONICAL_EVENT_TOPICS');
    const shares=uintWord(a,ECONOMY_MAX_INTEGER),amount=uintWord(b);
    if(BigInt(amount)!==BigInt(shares)*ECONOMY_SHARE_WEI)return fail('INVALID_EVENT_SHARE_AMOUNT');
    return {...base,kind:l.topics[0]===ECONOMY_EVENT_TOPICS.stake?'stake':'withdraw',wallet:addressWord(l.topics[1]),positionId:uintWord(l.topics[2]),shares,amount};
  }
  if(l.address===config.paymentContract&&l.topics[0]===ECONOMY_EVENT_TOPICS.payment){
    if(l.topics.length!==4||/^0x0{64}$/.test(l.topics[1]))return fail('NONCANONICAL_EVENT_TOPICS');
    const token=addressWord(l.topics[3]),receiver=addressWord(a);
    if(token!==config.token||receiver!==config.treasury)return fail('INVALID_EVENT_PAYMENT_ASSET');
    return {...base,kind:'payment',wallet:addressWord(l.topics[2]),orderId:l.topics[1],token,receiver,amount:uintWord(b)};
  }
  return fail('UNEXPECTED_EVENT_SOURCE');
}
const equalLog=(a:Log,b:Log)=>a.address===b.address&&a.data===b.data&&a.transactionHash===b.transactionHash&&a.logIndex===b.logIndex&&a.blockNumber===b.blockNumber&&a.blockHash===b.blockHash&&JSON.stringify(a.topics)===JSON.stringify(b.topics);
export type EconomySyncOptions={rpc:EconomyRpc;nowMs:number;maxBlocks?:number;maxLogs?:number;settleMaxDays?:number;witnessRpc?:EconomyRpc};
export type EconomySyncResult={status:'indexed'|'caught-up'|'staging';fromBlock:string;toBlock:string;eventCount:number;replayed:boolean;settledDays:number;throughMs:number;staged?:number;pendingBlock?:string};
const flights=new WeakMap<D1Database,Map<string,Promise<EconomySyncResult>>>();
/** Per-isolate serialization reduces duplicate reads. D1 ingestion CAS/unique keys
 * remain authoritative across distinct Worker isolates and concurrent schedules. */
export function syncEconomyChain(db:D1Database,config:EconomyConfig,options:EconomySyncOptions):Promise<EconomySyncResult>{
  let map=flights.get(db);if(!map){map=new Map();flights.set(db,map);}
  const previous=map.get(config.id),flight=(previous?previous.catch(()=>undefined):Promise.resolve()).then(()=>synchronize(db,config,options));
  map.set(config.id,flight);void flight.finally(()=>{if(map!.get(config.id)===flight)map!.delete(config.id);}).catch(()=>{});return flight;
}
async function synchronize(db:D1Database,config:EconomyConfig,options:EconomySyncOptions):Promise<EconomySyncResult>{
  const checked=await defineEconomyConfig(config);
  if(checked.id!==config.id||!Number.isSafeInteger(options.nowMs)||options.nowMs<0)return fail('INVALID_SYNC_CONFIG');
  const maxBlocks=options.maxBlocks??ECONOMY_MAX_BLOCKS,maxLogs=options.maxLogs??ECONOMY_MAX_LOGS,maxDays=options.settleMaxDays??14;
  if(!Number.isInteger(maxBlocks)||maxBlocks<1||maxBlocks>128||!Number.isInteger(maxLogs)||maxLogs<1||maxLogs>256||!Number.isInteger(maxDays)||maxDays<1||maxDays>31)return fail('INVALID_SYNC_LIMIT');
  const state=await economyChainState(db,config);if(state.haltedReason)return fail('ECONOMY_HALTED');
  const pending=await pendingEconomyBlock(db,config);
  const deadline=Date.now()+ECONOMY_SYNC_TIMEOUT_MS;
  const bounded=(source:EconomyRpc):EconomyRpc=>async(method,params)=>{
    const remaining=deadline-Date.now();if(remaining<=0)return fail('ECONOMY_SYNC_TIMEOUT');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(()=>source(method,params)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new EconomyRpcError('ECONOMY_SYNC_TIMEOUT')),remaining);})]);}
    finally{if(timer!==undefined)clearTimeout(timer);}
  };
  const rpc=bounded(options.rpc),witness=options.witnessRpc?bounded(options.witnessRpc):undefined;
  if(quantity(await rpc('eth_chainId',[]))!==1n)return fail('WRONG_CHAIN');
  if(witness&&quantity(await witness('eth_chainId',[]))!==1n)return fail('WRONG_CHAIN');
  const head=block(await rpc('eth_getBlockByNumber',['finalized',false]));
  const witnessHead=witness?block(await witness('eth_getBlockByNumber',['finalized',false])):undefined;
  // A finalized tag is a block identity, not only an upper block number. Bind
  // every already-fetched matching-height header (including a caught-up anchor)
  // to both announced heads. Optional gasLimit may be omitted by an adapter.
  // A bounded page ending below both heads still trusts the provider's ancestry;
  // this check does not supply a separate finality/ancestor proof for that page.
  const finalizedHeads=witnessHead?[head,witnessHead]:[head];
  const verifyFinalizedIdentity=(header:Block)=>{for(const finalized of finalizedHeads)if(header.number===finalized.number&&!sameBlockIdentity(header,finalized))return fail('RPC_FINALIZED_HEADER_MISMATCH');};
  verifyFinalizedIdentity(head);
  const upper=witnessHead&&witnessHead.number<head.number?witnessHead.number:head.number;
  const last=BigInt(state.lastBlock),from=last+1n;
  if(pending&&BigInt(pending.number)!==from)return fail('PENDING_CURSOR_MISMATCH');
  if(upper<last)return fail('FINALITY_BEHIND_CURSOR');
  if(pending&&upper<from)return fail('FINALITY_BEHIND_PENDING');
  const anchor=block(await rpc('eth_getBlockByNumber',[hex(last),false]),last);
  if((state.lastHash&&anchor.hash!==state.lastHash)||(pending&&anchor.hash!==pending.parentHash)){await haltEconomyChain(db,config,'FINALIZED_REORG');return fail('FINALIZED_REORG');}
  verifyFinalizedIdentity(anchor);
  const verifyAnchor=async()=>{
    const again=block(await rpc('eth_getBlockByNumber',[hex(last),false]),last);
    if((state.lastHash&&again.hash!==state.lastHash)||(pending&&again.hash!==pending.parentHash)){await haltEconomyChain(db,config,'FINALIZED_REORG');return fail('FINALIZED_REORG');}
    if(again.hash!==anchor.hash||again.timestamp!==anchor.timestamp||again.parentHash!==anchor.parentHash||again.gasLimit!==anchor.gasLimit)return fail('RPC_ANCHOR_CHANGED');
  };
  if(from>upper){
    await verifyAnchor();const settled=await settleEconomy(db,config,{nowMs:options.nowMs,maxDays});
    return {status:'caught-up',fromBlock:String(from),toBlock:String(last),eventCount:0,replayed:false,...settled};
  }
  let to=pending?from:from+BigInt(maxBlocks)-1n<upper?from+BigInt(maxBlocks)-1n:upper;
  let rawLogs:unknown;
  for(;;){
    try{rawLogs=await rpc('eth_getLogs',[{fromBlock:hex(from),toBlock:hex(to),address:[config.stakingContract,config.paymentContract],topics:[Object.values(ECONOMY_EVENT_TOPICS)]}]);}
    catch(error){if(error instanceof EconomyRpcError&&error.code==='RPC_RESULT_LIMIT'&&from<to){to=from+(to-from)/2n;continue;}throw error;}
    if(!Array.isArray(rawLogs))return fail('MALFORMED_RPC_LOGS');
    if(rawLogs.length<=maxLogs||from===to)break;
    to=from+(to-from)/2n;
  }
  // A bounded range is a chain, not two independently plausible end points.
  // Fetch every header (eight reads in flight), then require every visible link.
  const blocks=new Map<string,Block>();
  for(let start=from;start<=to;start+=8n){
    const numbers:bigint[]=[];for(let n=start;n<=to&&n<start+8n;n++)numbers.push(n);
    const headers=await Promise.all(numbers.map(async n=>block(await rpc('eth_getBlockByNumber',[hex(n),false]),n)));
    for(const header of headers)blocks.set(String(header.number),header);
  }
  if(pending&&pending.hash!==blocks.get(String(to))!.hash){await haltEconomyChain(db,config,'FINALIZED_REORG');return fail('FINALIZED_REORG');}
  let previous=anchor;
  for(let n=from;n<=to;n++){
    const header=blocks.get(String(n))!;
    verifyFinalizedIdentity(header);
    if(header.parentHash!==previous.hash||header.timestamp<previous.timestamp)return fail('NONCONTIGUOUS_RPC_RANGE');
    previous=header;
  }
  const first=blocks.get(String(from))!,end=blocks.get(String(to))!;
  if(witness){const other=block(await witness('eth_getBlockByNumber',[hex(to),false]),to);if(!sameBlockIdentity(other,end))return fail('RPC_WITNESS_MISMATCH');}
  const rawArray=rawLogs as unknown[],staging=Boolean(pending)||(from===to&&rawArray.length>maxLogs);
  if(staging&&rawArray.length>10_000)return fail('RPC_BLOCK_LOG_BOUND');
  const logs=rawArray.map(log).sort((a,b)=>a.blockNumber<b.blockNumber?-1:a.blockNumber>b.blockNumber?1:a.logIndex-b.logIndex);
  let digest='';
  if(staging){
    // Contract callers may batch multiple deposits/withdrawals/payments in one
    // transaction. A per-transaction base-gas estimate is not an event bound.
    // This is an explicit engineering capacity ceiling, not proof of impossibility.
    digest=await economyDigest(JSON.stringify(logs.map(l=>({...l,blockNumber:String(l.blockNumber)}))));
    if(pending&&(pending.totalLogs!==logs.length||pending.digest!==digest||pending.parentHash!==end.parentHash||pending.throughMs!==end.timestamp))return fail('RPC_STAGED_LOG_MISMATCH');
  }
  const seen=new Set<string>(),receipts=new Map<string,Json>();
  const events:EconomyChainEvent[]=[];
  for(const l of logs){
    if(l.blockNumber<from||l.blockNumber>to)return fail('LOG_OUTSIDE_FINALIZED_RANGE');
    const key=String(l.blockNumber)+':'+l.logIndex;if(seen.has(key))return fail('DUPLICATE_RPC_LOG');seen.add(key);
  }
  const offset=pending?.nextOffset??0,page=staging?logs.slice(offset,offset+Math.min(maxLogs,128)):logs;
  if(staging&&(!Number.isInteger(offset)||offset<0||offset>=logs.length))return fail('INVALID_STAGING_OFFSET');
  for(const l of page){
    const canonical=blocks.get(String(l.blockNumber))!;
    if(canonical.hash!==l.blockHash||canonical.timestamp<first.timestamp||canonical.timestamp>end.timestamp)return fail('LOG_BLOCK_MISMATCH');
    const e=decode(config,l,canonical.timestamp);
    events.push(e);
  }
  const transactions=[...new Set(page.map(l=>l.transactionHash))];
  for(let i=0;i<transactions.length;i+=8){
    await Promise.all(transactions.slice(i,i+8).map(async transactionHash=>{receipts.set(transactionHash,object(await rpc('eth_getTransactionReceipt',[transactionHash])));}));
  }
  const receiptIndices=new Map<string,Map<number,unknown|null>>();
  for(const [transactionHash,receipt] of receipts){
    if(!Array.isArray(receipt.logs))return fail('MALFORMED_RECEIPT_LOGS');
    const indices=new Map<number,unknown|null>();
    for(const candidate of receipt.logs){const index=Number(quantity(object(candidate).logIndex,2_147_483_647n));indices.set(index,indices.has(index)?null:candidate);}
    receiptIndices.set(transactionHash,indices);
  }
  for(let i=0;i<page.length;i++){
    const l=page[i],receipt=receipts.get(l.transactionHash)!;
    if(quantity(receipt.status)!==1n||hash(receipt.transactionHash)!==l.transactionHash||quantity(receipt.blockNumber)!==l.blockNumber||hash(receipt.blockHash)!==l.blockHash)return fail('RECEIPT_SOURCE_MISMATCH');
    // The reviewed emitting contract binds player/payer to msg.sender. That
    // sender can be a forwarder; receipt.from/to describe the outer transaction,
    // and to=null is a valid constructor that calls the vault/payment contract.
    address(receipt.from);if(receipt.to!==null)address(receipt.to);
    // Unrelated receipt logs can be LOG0, arbitrary data, or numerous. Inspect
    // only the unique index supplied by the canonical emitter-filtered getLogs.
    // Build each receipt's index once so a large batch does not repeatedly scan it.
    const candidate=receiptIndices.get(l.transactionHash)!.get(l.logIndex);
    if(candidate===null||candidate===undefined||!equalLog(l,log(candidate)))return fail('RECEIPT_LOG_MISMATCH');
  }
  const endAgain=block(await rpc('eth_getBlockByNumber',[hex(to),false]),to);
  if(endAgain.hash!==end.hash||endAgain.timestamp!==end.timestamp||endAgain.parentHash!==end.parentHash||endAgain.gasLimit!==end.gasLimit)return fail('RPC_RANGE_CHANGED');
  await verifyAnchor();
  if(staging){
    const staged=await stageEconomyBlock(db,config,{number:String(from),hash:end.hash,parentHash:end.parentHash,throughMs:end.timestamp,totalLogs:logs.length,digest,offset,events});
    if(!staged.complete)return {status:'staging',fromBlock:String(from),toBlock:String(from),eventCount:0,replayed:Boolean(staged.replayed),settledDays:0,throughMs:state.throughMs,staged:staged.staged,pendingBlock:String(from)};
    const settled=await settleEconomy(db,config,{nowMs:options.nowMs,maxDays});
    return {status:'indexed',fromBlock:String(from),toBlock:String(from),eventCount:staged.eventCount,replayed:Boolean(staged.replayed),...settled};
  }
  const ingested=await ingestEconomyEvents(db,config,{fromBlock:String(from),toBlock:String(to),toBlockHash:end.hash,throughTimestamp:end.timestamp,events});
  const settled=await settleEconomy(db,config,{nowMs:options.nowMs,maxDays});
  return {status:'indexed',fromBlock:String(from),toBlock:String(to),eventCount:ingested.eventCount,replayed:ingested.replayed,...settled};
}
