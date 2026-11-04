import type {D1Database,D1PreparedStatement} from './d1.ts';
import {ECONOMY_HASH,economyAddress,type EconomyConfig} from './economy-config.ts';
import {economyChainState} from './economy-ledger.ts';
import {economyReceiptPayment,EconomyRpcError,type EconomyRpc} from './economy-rpc.ts';
import {goldBalanceStatement,goldBalanceView} from './world-gold.ts';

// GOLD fast credit (migrations/0021, owner decision 2026-10-26): an EMBEO top-up is credited when its Paid event is in
// a canonical block, about 12 s after payment, instead of after finality. The browser supplies only the order and the
// transaction hash its wallet returned; the server fetches and verifies the receipt itself, with the indexer's parser.
// The finalized indexer remains the only writer of economy_orders.status. reconcileWorldGold settles a fast credit
// when the order is paid (ordinary top-up entry + equal fast-settle, one batch); maintainFastGold reverts one whose
// block the finalized cursor has passed while the order is still unpaid. Nothing here can halt the economy.
export const WORLD_GOLD_FAST_TABLES=['world_gold_fast_credits','world_gold_fast_entries','world_gold_fast_debts'] as const;
const FAST_OBJECTS=[...WORLD_GOLD_FAST_TABLES.map(name=>['table',name]),['trigger','world_gold_fast_credit_insert'],['trigger','world_gold_fast_credit_update'],
 ['trigger','world_gold_fast_entry_authority'],['trigger','world_gold_fast_entry_apply'],['trigger','world_gold_fast_debt_update'],
 ['trigger','world_gold_fast_debt_blocks_payment'],['trigger','world_gold_fast_debt_blocks_hold']] as const;
/** At most this many fast credits / debts are examined per minute tick (each credit costs at most four RPC reads). */
export const FAST_GOLD_BATCH=16;
const st=(db:D1Database,sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
const check=(db:D1Database,predicate:string,...args:unknown[])=>st(db,`INSERT INTO world_gold_write_checks(id,accepted) SELECT ?,CASE WHEN ${predicate} THEN 1 ELSE 0 END`,crypto.randomUUID(),...args);
const writeGuardFailed=(e:unknown)=>e instanceof Error&&/CHECK constraint failed:\s*accepted\s*=\s*1/i.test(e.message);
const fail=(code:string):never=>{throw Error(code);};
/** An RPC outage or budget refusal says nothing about the payment: retry later, never revert or refuse on it. */
const transient=(e:unknown)=>e instanceof Error&&/^(ECONOMY_RPC_UNAVAILABLE|ECONOMY_RPC_RATE_LIMITED|ECONOMY_SYNC_TIMEOUT|RPC_RESULT_LIMIT)$/.test(e instanceof EconomyRpcError?e.code:e.message);
const DEFINITE_REFUSALS=['TRANSACTION_FAILED','NO_PAYMENT_FOR_ORDER','PAYMENT_DOES_NOT_MATCH_ORDER'];
/** D1 binds no BigInt (D1_TYPE_ERROR); every GOLD amount and block number here is a safe integer. */
const int=(n:bigint|string)=>{const v=Number(n);return Number.isSafeInteger(v)?v:fail('GOLD_INTEGER_LIMIT');};
const tx=(s:unknown)=>typeof s==='string'&&ECONOMY_HASH.test(s)?s.toLowerCase():fail('BAD_REQUEST');

/** The migration is applied (code may reach a database before it: then fast credit is simply unavailable). */
export async function fastGoldReady(db:D1Database){
 const row=await st(db,`SELECT COUNT(*) n FROM sqlite_master s,json_each(?) o WHERE s.type=json_extract(o.value,'$[0]') AND s.name=json_extract(o.value,'$[1]')`,JSON.stringify(FAST_OBJECTS)).first<{n:number}>();
 return row?.n===FAST_OBJECTS.length;
}
export type FastCreditOutcome={status:'credited'|'waiting'|'paid'|'reverted';gold?:string};
type OrderRow={status:string;wallet:string;amount:string;currency:string;kind:string;gold:string;fast:string|null};
const orderRow=(db:D1Database,config:EconomyConfig,orderId:string)=>st(db,`SELECT o.status,o.wallet,o.amount,o.currency,l.kind,CAST(l.gold AS TEXT) gold,f.state fast
 FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id LEFT JOIN world_gold_fast_credits f ON f.order_id=o.id
 WHERE o.id=? AND (o.config_id=? OR o.config_id IN (SELECT ancestor_id FROM economy_config_lineage WHERE config_id=?))`,orderId,config.id,config.id).first<OrderRow>();
const settledOutcome=(row:OrderRow):FastCreditOutcome|null=>row.fast==='credited'||row.fast==='settled'?{status:'credited',gold:row.gold}:row.fast==='reverted'?{status:'reverted'}:row.status==='paid'?{status:'paid',gold:row.gold}:null;
/** The verified payment of `order` in `transactionHash`, null while not mined or not canonical. Throws a code for a
 *  transaction that does not pay exactly this pending quote (the finalized path still handles whatever it is). */
async function verifiedPayment(config:EconomyConfig,rpc:EconomyRpc,transactionHash:string,orderId:string,row:OrderRow){
 const e=await economyReceiptPayment(config,rpc,transactionHash,orderId);if(!e)return null;
 if(e.wallet!==row.wallet||BigInt(e.amount)!==BigInt(row.amount))fail('PAYMENT_DOES_NOT_MATCH_ORDER');
 return e;
}

/** POST /api/gold/orders/{id}/fast-credit. Idempotent: a repeated call reports the existing credit. */
export async function fastCreditTopup(db:D1Database,config:EconomyConfig,rpc:EconomyRpc,args:{wallet:string;orderId:string;transactionHash:string;nowMs:number}):Promise<FastCreditOutcome>{
 const wallet=economyAddress(args.wallet),orderId=tx(args.orderId),hash=tx(args.transactionHash),now=args.nowMs;
 if(!Number.isSafeInteger(now)||now<=0)fail('INVALID_CLOCK');
 if(!await fastGoldReady(db))fail('FAST_CREDIT_UNAVAILABLE');
 const row=await orderRow(db,config,orderId);
 if(!row||row.wallet!==wallet)fail('ORDER_NOT_FOUND');
 if(row!.kind!=='topup'||row!.currency!=='EMBEO')fail('NOT_A_TOPUP');
 const done=settledOutcome(row!);if(done)return done;
 if(row!.status!=='pending')fail('ORDER_NOT_PENDING');
 let e;try{e=await verifiedPayment(config,rpc,hash,orderId,row!);}catch(error){if(transient(error))fail('CHAIN_UNAVAILABLE');throw error;}
 if(!e)return {status:'waiting'};
 try{await db.batch([
  check(db,`EXISTS(SELECT 1 FROM economy_orders WHERE id=? AND wallet=? AND status='pending') AND EXISTS(SELECT 1 FROM world_gold_controls WHERE feature='topup' AND enabled=1)
   AND NOT EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND halted_reason IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM economy_config_lineage WHERE ancestor_id=?)
   AND NOT EXISTS(SELECT 1 FROM world_gold_fast_credits WHERE order_id=? OR (tx_hash=? AND log_index=?))`,orderId,wallet,config.id,config.id,orderId,e.transactionHash,e.logIndex),
  st(db,`INSERT INTO world_gold_fast_credits(order_id,wallet,gold,tx_hash,log_index,block_number,block_hash,state,created_ms,updated_ms) VALUES(?,?,?,?,?,?,?,'credited',?,?)`,
   orderId,wallet,int(row!.gold),e.transactionHash,e.logIndex,int(e.blockNumber),e.blockHash,now,now),
  st(db,`INSERT INTO world_gold_fast_entries(id,wallet,delta,kind,reference,order_id,created_ms) VALUES(?,?,?,'fast-topup',?,?,?)`,'fast-topup:'+orderId,wallet,int(row!.gold),'fast-topup:'+orderId,orderId,now),
  st(db,'DELETE FROM world_gold_write_checks')
 ]);}catch(error){
  const again=await orderRow(db,config,orderId),settled=again&&settledOutcome(again);if(settled)return settled;
  if(writeGuardFailed(error)){
   if(await st(db,'SELECT 1 FROM economy_chain_state WHERE config_id=? AND halted_reason IS NOT NULL',config.id).first())fail('ECONOMY_HALTED');
   if(!await st(db,"SELECT 1 FROM world_gold_controls WHERE feature='topup' AND enabled=1").first())fail('FEATURE_PAUSED');
   if(await st(db,'SELECT 1 FROM world_gold_fast_credits WHERE tx_hash=? AND log_index=?',e.transactionHash,e.logIndex).first())fail('PAYMENT_ALREADY_USED');
  }
  throw error;
 }
 return {status:'credited',gold:row!.gold};
}

/** Statements reconcileWorldGold appends after the ordinary top-up credit of a paid order: a fast credit of that order
 *  becomes settled and its +gold is cancelled by fast-settle, so the order is credited exactly once. No-ops otherwise. */
export function fastSettleStatements(db:D1Database,orderId:string,nowMs:number):D1PreparedStatement[]{
 return [
  st(db,`UPDATE world_gold_fast_credits SET state='settled',updated_ms=MAX(updated_ms,?) WHERE order_id=? AND state='credited'`,nowMs,orderId),
  st(db,`INSERT INTO world_gold_fast_entries(id,wallet,delta,kind,reference,order_id,created_ms) SELECT 'fast-settle:'||order_id,wallet,-gold,'fast-settle','fast-settle:'||order_id,order_id,?
   FROM world_gold_fast_credits WHERE order_id=? AND state='settled' AND NOT EXISTS(SELECT 1 FROM world_gold_fast_entries WHERE reference='fast-settle:'||?)`,nowMs,orderId,orderId)
 ];
}

type CreditRow={order_id:string;wallet:string;gold:string;tx_hash:string;log_index:number;block_number:string;block_hash:string;status:string;amount:string;currency:string;kind:string};
export type FastGoldMaintenance={checked:number;moved:number;reverted:number;collected:number;failures:{orderId:string;code:string}[]};
/** Minute tick: follow each unsettled fast credit until the finalized indexer pays its order, revert one whose block
 *  the finalized cursor has passed unpaid (unless the same transaction is now mined later), and collect debts. */
export async function maintainFastGold(db:D1Database,config:EconomyConfig,rpc:EconomyRpc,nowMs:number):Promise<FastGoldMaintenance>{
 const out:FastGoldMaintenance={checked:0,moved:0,reverted:0,collected:0,failures:[]};
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||!await fastGoldReady(db))return out;
 const cursor=await economyChainState(db,config);
 const credits=(await st(db,`SELECT f.order_id,f.wallet,CAST(f.gold AS TEXT) gold,f.tx_hash,f.log_index,CAST(f.block_number AS TEXT) block_number,f.block_hash,o.status,o.amount,o.currency,l.kind
  FROM world_gold_fast_credits f JOIN economy_orders o ON o.id=f.order_id JOIN world_gold_links l ON l.order_id=f.order_id
  WHERE f.state='credited' AND o.status='pending' ORDER BY f.block_number,f.order_id LIMIT ?`,FAST_GOLD_BATCH).all<CreditRow>()).results;
 for(const c of credits){
  out.checked++;
  try{
   // The cursor was read before the order rows, so an order the indexer paid meanwhile shows as paid in the guards below.
   const passed=!cursor.haltedReason&&BigInt(cursor.lastBlock)>=BigInt(c.block_number);
   let e=null,refused:string|null=null;
   try{e=await verifiedPayment(config,rpc,c.tx_hash,c.order_id,{status:c.status,wallet:c.wallet,amount:c.amount,currency:c.currency,kind:c.kind,gold:c.gold,fast:'credited'});}
   // Only a definite answer about this transaction may lead to a revert; any other failure (outage, malformed
   // reply, budget) is retried next tick.
   catch(error){const code=error instanceof Error?error.message:'';if(!DEFINITE_REFUSALS.includes(code))throw error;refused=code;}
   if(e&&(e.blockHash!==c.block_hash||BigInt(e.blockNumber)!==BigInt(c.block_number)||e.logIndex!==c.log_index)&&BigInt(e.blockNumber)>BigInt(cursor.lastBlock)){
    // A reorg re-included the same payment in another block that the finalized cursor has not reached yet.
    await st(db,`UPDATE world_gold_fast_credits SET block_number=?,block_hash=?,log_index=?,updated_ms=MAX(updated_ms,?) WHERE order_id=? AND state='credited'`,int(e.blockNumber),e.blockHash,e.logIndex,nowMs,c.order_id).run();
    out.moved++;continue;
   }
   if(!passed)continue;   // not final yet: the indexer will pay the order (settled by reconcileWorldGold) or pass the block
   if(e&&BigInt(e.blockNumber)>BigInt(cursor.lastBlock))continue;
   // Still canonical at or below the finalized cursor, yet unpaid: the indexer saw this block and did not match the
   // order. Never guess against it; leave the credit for the owner to inspect (it is reported every tick).
   if(e){out.failures.push({orderId:c.order_id,code:'FAST_CREDIT_UNPAID_AT_FINALITY'});continue;}
   await revert(db,config,c,nowMs,cursor.lastBlock);out.reverted++;
   if(refused)out.failures.push({orderId:c.order_id,code:refused});
  }catch(error){out.failures.push({orderId:c.order_id,code:error instanceof EconomyRpcError?error.code:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)?error.message:'FAST_GOLD_RETRY'});}
 }
 const debts=(await st(db,'SELECT order_id,wallet,CAST(amount AS TEXT) amount FROM world_gold_fast_debts WHERE amount>0 ORDER BY created_ms,order_id LIMIT ?',FAST_GOLD_BATCH).all<{order_id:string;wallet:string;amount:string}>()).results;
 for(const d of debts){
  try{
   const view=goldBalanceView(await goldBalanceStatement(db,d.wallet).first<{book:string;reserved:string}>());
   const take=BigInt(view.available)<BigInt(d.amount)?BigInt(view.available):BigInt(d.amount);if(take<=0n)continue;
   const left=BigInt(d.amount)-take;
   await st(db,`INSERT INTO world_gold_fast_entries(id,wallet,delta,kind,reference,order_id,created_ms) VALUES(?,?,?,'fast-debt-collect',?,?,?)`,
    `fast-debt-collect:${d.order_id}:${left}`,d.wallet,int(-take),`fast-debt-collect:${d.order_id}:${left}`,d.order_id,nowMs).run();
   out.collected++;
  }catch(error){out.failures.push({orderId:d.order_id,code:error instanceof Error&&/^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)?error.message:'FAST_DEBT_RETRY'});}
 }
 return out;
}
/** Take back what is still available now; the rest becomes a debt that blocks GOLD spending until repaid. */
async function revert(db:D1Database,config:EconomyConfig,c:CreditRow,nowMs:number,lastBlock:string){
 const view=goldBalanceView(await goldBalanceStatement(db,c.wallet).first<{book:string;reserved:string}>());
 const gold=BigInt(c.gold),take=BigInt(view.available)<gold?BigInt(view.available):gold,owed=gold-take;
 try{await db.batch([
  check(db,`EXISTS(SELECT 1 FROM economy_orders WHERE id=? AND status='pending') AND EXISTS(SELECT 1 FROM world_gold_fast_credits WHERE order_id=? AND state='credited' AND block_number<=CAST(? AS INTEGER))
   AND EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND last_block>=CAST(? AS INTEGER) AND halted_reason IS NULL)`,c.order_id,c.order_id,lastBlock,config.id,c.block_number),
  st(db,`UPDATE world_gold_fast_credits SET state='reverted',updated_ms=MAX(updated_ms,?) WHERE order_id=? AND state='credited'`,nowMs,c.order_id),
  ...take>0n?[st(db,`INSERT INTO world_gold_fast_entries(id,wallet,delta,kind,reference,order_id,created_ms) VALUES(?,?,?,'fast-revert',?,?,?)`,'fast-revert:'+c.order_id,c.wallet,int(-take),'fast-revert:'+c.order_id,c.order_id,nowMs)]:[],
  ...owed>0n?[st(db,'INSERT INTO world_gold_fast_debts(order_id,wallet,amount,created_ms) VALUES(?,?,?,?)',c.order_id,c.wallet,int(owed),nowMs)]:[],
  st(db,'DELETE FROM world_gold_write_checks')
 ]);}catch(error){if(writeGuardFailed(error))fail('FAST_REVERT_SUPERSEDED');throw error;}
}
