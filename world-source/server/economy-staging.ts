import type {D1Database,D1PreparedStatement} from './d1.ts';
import {ECONOMY_HASH,ECONOMY_MAX_INTEGER,economyDigest,economyUint,type EconomyConfig} from './economy-config.ts';
import {economyChainState,normalizedEvent,type EconomyChainEvent} from './economy-ledger.ts';

export type PendingEconomyBlock={number:string;hash:string;parentHash:string;throughMs:number;totalLogs:number;digest:string;nextOffset:number};
export type EconomyStagePage=Omit<PendingEconomyBlock,'nextOffset'>&{offset:number;events:readonly EconomyChainEvent[]};
export type EconomyStageResult={complete:boolean;staged:number;eventCount:number;replayed:boolean};
const bind=(db:D1Database,sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
const validHash=(value:string)=>{if(!ECONOMY_HASH.test(value))throw Error('INVALID_STAGED_HASH');return value.toLowerCase();};
export async function pendingEconomyBlock(db:D1Database,config:EconomyConfig):Promise<PendingEconomyBlock|null>{
 return bind(db,`SELECT block_number number,block_hash hash,parent_hash parentHash,through_ms throughMs,total_logs totalLogs,digest,next_offset nextOffset FROM economy_pending_blocks WHERE config_id=?`,config.id).first<PendingEconomyBlock>();
}
/** Only the finalized, receipt-verifying indexer calls this internal function.
 * Each page commits its proof rows and offset atomically. The final page folds
 * the whole block with INSERT..SELECT in chain order in the same transaction;
 * only then may any position, fulfillment or confirmed cursor become visible. */
export async function stageEconomyBlock(db:D1Database,config:EconomyConfig,page:EconomyStagePage):Promise<EconomyStageResult>{
 const number=economyUint(page.number,ECONOMY_MAX_INTEGER),hash=validHash(page.hash),parentHash=validHash(page.parentHash);
 if(!Number.isSafeInteger(page.throughMs)||page.throughMs<0||!Number.isInteger(page.totalLogs)||page.totalLogs<1||page.totalLogs>10000||! /^[0-9a-f]{64}$/.test(page.digest)||!Number.isInteger(page.offset)||page.offset<0||!Array.isArray(page.events)||page.events.length<1||page.events.length>128||page.offset+page.events.length>page.totalLogs)throw Error('INVALID_STAGED_PAGE');
 const events=page.events.map(event=>normalizedEvent(config,event));
 for(let i=0;i<events.length;i++){const event=events[i];if(event.blockNumber!==number||event.blockHash!==hash||event.timestamp!==page.throughMs||(i>0&&event.logIndex<=events[i-1].logIndex))throw Error('INVALID_STAGED_EVENT_ORDER');}
 const ingestionId=await economyDigest(JSON.stringify(['staged-block-v1',config.id,number,hash,page.digest,page.totalLogs]));
 if(await bind(db,'SELECT id FROM economy_ingestions WHERE id=?',ingestionId).first())return {complete:true,staged:page.totalLogs,eventCount:page.totalLogs,replayed:true};
 const state=await economyChainState(db,config),pending=await pendingEconomyBlock(db,config),next=page.offset+events.length;
 if(state.haltedReason)throw Error('ECONOMY_HALTED');
 if(BigInt(number)!==BigInt(state.lastBlock)+1n||page.throughMs<state.throughMs||(state.lastHash&&parentHash!==state.lastHash))throw Error('NONCONTIGUOUS_STAGED_BLOCK');
 const same=(p:PendingEconomyBlock)=>p.number===number&&p.hash===hash&&p.parentHash===parentHash&&p.throughMs===page.throughMs&&p.totalLogs===page.totalLogs&&p.digest===page.digest;
 if(pending&&!same(pending))throw Error('STAGED_BLOCK_CONFLICT');
 const payloads=events.map(event=>JSON.stringify(event));
 const replayedPage=async()=>{
  const p=await pendingEconomyBlock(db,config);if(!p||!same(p)||p.nextOffset<next)return false;
  const saved=await bind(db,'SELECT ordinal,payload FROM economy_staged_events WHERE config_id=? AND ordinal>=? AND ordinal<? ORDER BY ordinal',config.id,page.offset,next).all<{ordinal:number;payload:string}>();
  return saved.results.length===payloads.length&&saved.results.every((row,i)=>row.ordinal===page.offset+i&&row.payload===payloads[i]);
 };
 if(page.offset!==(pending?.nextOffset??0)){
  if(await replayedPage())return {complete:false,staged:pending!.nextOffset,eventCount:events.length,replayed:true};
  throw Error('STAGED_OFFSET_CONFLICT');
 }
 if(page.offset>0){const previous=await bind(db,'SELECT payload FROM economy_staged_events WHERE config_id=? AND ordinal=?',config.id,page.offset-1).first<{payload:string}>();if(!previous||JSON.parse(previous.payload).logIndex>=events[0].logIndex)throw Error('INVALID_STAGED_EVENT_ORDER');}
 const pageId=await economyDigest(JSON.stringify([ingestionId,page.offset,payloads]));
 const statements:D1PreparedStatement[]=[
  bind(db,'INSERT INTO economy_chain_state(config_id,last_block,last_hash,through_ms) VALUES(?,?,?,?) ON CONFLICT(config_id) DO NOTHING',config.id,state.lastBlock,state.lastHash,state.throughMs),
  bind(db,`INSERT INTO economy_stage_batches(id,accepted) SELECT ?,CASE WHEN EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND last_block=CAST(? AS INTEGER) AND last_hash=? AND through_ms=? AND halted_reason IS NULL) AND (?=0 AND NOT EXISTS(SELECT 1 FROM economy_pending_blocks WHERE config_id=?) OR EXISTS(SELECT 1 FROM economy_pending_blocks WHERE config_id=? AND block_hash=? AND digest=? AND next_offset=?)) THEN 1 ELSE 0 END`,pageId,config.id,state.lastBlock,state.lastHash,state.throughMs,page.offset,config.id,config.id,hash,page.digest,page.offset),
  bind(db,`INSERT INTO economy_pending_blocks(config_id,block_number,block_hash,parent_hash,through_ms,total_logs,digest,next_offset) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(config_id) DO NOTHING`,config.id,number,hash,parentHash,page.throughMs,page.totalLogs,page.digest)
 ];
 payloads.forEach((payload,i)=>statements.push(bind(db,'INSERT INTO economy_staged_events(config_id,ordinal,payload) VALUES(?,?,?)',config.id,page.offset+i,payload)));
 statements.push(bind(db,'UPDATE economy_pending_blocks SET next_offset=? WHERE config_id=?',next,config.id));
 const complete=next===page.totalLogs;
 if(complete){
  statements.push(
   bind(db,`INSERT INTO economy_ingestions(id,config_id,accepted) SELECT ?,?,CASE WHEN (SELECT COUNT(*) FROM economy_staged_events WHERE config_id=?)=? AND EXISTS(SELECT 1 FROM economy_pending_blocks WHERE config_id=? AND next_offset=total_logs) THEN 1 ELSE 0 END`,ingestionId,config.id,config.id,page.totalLogs,config.id),
   bind(db,`INSERT INTO economy_chain_events(id,config_id,kind,tx_hash,log_index,block_number,block_hash,at_ms,wallet,position_id,shares,amount,order_id,token,receiver,payload)
    SELECT ?||':'||json_extract(payload,'$.transactionHash')||':'||json_extract(payload,'$.logIndex'),?,json_extract(payload,'$.kind'),json_extract(payload,'$.transactionHash'),json_extract(payload,'$.logIndex'),CAST(json_extract(payload,'$.blockNumber') AS INTEGER),json_extract(payload,'$.blockHash'),json_extract(payload,'$.timestamp'),json_extract(payload,'$.wallet'),json_extract(payload,'$.positionId'),CAST(json_extract(payload,'$.shares') AS INTEGER),json_extract(payload,'$.amount'),json_extract(payload,'$.orderId'),json_extract(payload,'$.token'),json_extract(payload,'$.receiver'),payload FROM economy_staged_events WHERE config_id=? ORDER BY ordinal`,config.id,config.id,config.id),
   bind(db,`UPDATE economy_orders SET status='paid',paid_ms=(SELECT e.at_ms FROM economy_chain_events e WHERE e.config_id=? AND e.kind='payment' AND e.order_id=economy_orders.id AND e.wallet=economy_orders.wallet AND e.amount=economy_orders.amount AND e.block_number=CAST(? AS INTEGER)),paid_event_id=(SELECT e.id FROM economy_chain_events e WHERE e.config_id=? AND e.kind='payment' AND e.order_id=economy_orders.id AND e.wallet=economy_orders.wallet AND e.amount=economy_orders.amount AND e.block_number=CAST(? AS INTEGER)) WHERE config_id=? AND currency='EMBEO' AND status='pending' AND EXISTS(SELECT 1 FROM economy_chain_events e WHERE e.config_id=? AND e.kind='payment' AND e.order_id=economy_orders.id AND e.wallet=economy_orders.wallet AND e.amount=economy_orders.amount AND e.block_number=CAST(? AS INTEGER))`,config.id,number,config.id,number,config.id,config.id,number),
   bind(db,'UPDATE economy_chain_state SET last_block=?,last_hash=?,through_ms=? WHERE config_id=?',number,hash,page.throughMs,config.id),
   bind(db,'DELETE FROM economy_pending_blocks WHERE config_id=?',config.id)
  );
 }
 try{await db.batch(statements);}
 catch(error){
  if(await bind(db,'SELECT id FROM economy_ingestions WHERE id=?',ingestionId).first())return {complete:true,staged:page.totalLogs,eventCount:page.totalLogs,replayed:true};
  if(await replayedPage()){const p=await pendingEconomyBlock(db,config);return {complete:false,staged:p!.nextOffset,eventCount:events.length,replayed:true};}
  throw error;
 }
 return {complete,staged:next,eventCount:complete?page.totalLogs:events.length,replayed:false};
}
