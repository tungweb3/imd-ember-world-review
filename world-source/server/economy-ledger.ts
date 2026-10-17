import type {D1Database,D1PreparedStatement} from './d1.ts';
import {recoverMessageAddress} from 'viem';
import {economyConfigStatement,economyPaymentEvidenceStatement,economyOrderScope,economyPaymentCases} from './economy-reconciliation.ts';
import {ECONOMY_DAY_MS,ECONOMY_HASH,ECONOMY_MAX_INTEGER,ECONOMY_SHARE_WEI,economyAddress,economyDigest,economyUint,type EconomyConfig} from './economy-config.ts';

/** Only a server RPC adapter may call ingestion. Browser transaction hashes,
 * client timestamps, balances and claimed rewards are never accepted here. */
export type EconomyChainEvent={kind:'stake'|'withdraw'|'payment';transactionHash:string;logIndex:number;blockNumber:string;blockHash:string;timestamp:number;wallet:string;amount:string;positionId?:string;shares?:string;orderId?:string;token?:string;receiver?:string};
export type EconomyEventBatch={fromBlock:string;toBlock:string;toBlockHash:string;throughTimestamp:number;events:readonly EconomyChainEvent[]};
type State={lastBlock:string;lastHash:string;throughMs:number;haltedReason:string|null};
const validMs=(n:number)=>Number.isSafeInteger(n)&&n>=0;
function hash(s:unknown):string{if(typeof s!=='string'||!ECONOMY_HASH.test(s))throw Error('INVALID_HASH');return s.toLowerCase();}
const bind=(db:D1Database,sql:string,...values:unknown[])=>db.prepare(sql).bind(...values);
export async function economyChainState(db:D1Database,config:EconomyConfig):Promise<State>{
  const row=await bind(db,'SELECT CAST(last_block AS TEXT) lastBlock,last_hash lastHash,through_ms throughMs,halted_reason haltedReason FROM economy_chain_state WHERE config_id=?',config.id).first<State>();
  return row??{lastBlock:String(BigInt(config.deploymentBlock)-1n),lastHash:'',throughMs:0,haltedReason:null};
}
export async function haltEconomyChain(db:D1Database,config:EconomyConfig,reason:string):Promise<void>{
  if(! /^[A-Z][A-Z0-9_]{1,79}$/.test(reason))throw Error('INVALID_HALT_REASON');
  await bind(db,`INSERT INTO economy_chain_state(config_id,last_block,last_hash,through_ms,halted_reason) VALUES(?,?,?,0,?) ON CONFLICT(config_id) DO UPDATE SET halted_reason=COALESCE(economy_chain_state.halted_reason,excluded.halted_reason)`,config.id,String(BigInt(config.deploymentBlock)-1n),'',reason).run();
}
export const INVALID_POSITION_WITHDRAWAL='INVALID_POSITION_WITHDRAWAL';
/** A rejected finalized position transition is a persistent integrity halt,
 * never a raw SQLite retry loop. Call only after the failed atomic batch and
 * its exact replay checks. D1 can wrap the SQLite trigger error in a cause. */
export async function haltInvalidEconomyWithdrawal(db:D1Database,config:EconomyConfig,error:unknown):Promise<void>{
  let cause:unknown=error;
  for(let depth=0;depth<4;depth++){
    const message=typeof cause==='string'?cause:cause&&typeof cause==='object'&&'message' in cause&&typeof cause.message==='string'?cause.message:'';
    if(/\bECONOMY_INVALID_WITHDRAWAL\b/.test(message)){
      await haltEconomyChain(db,config,INVALID_POSITION_WITHDRAWAL);
      throw new EconomyConflict('ECONOMY_HALTED');
    }
    cause=cause&&typeof cause==='object'&&'cause' in cause?cause.cause:undefined;
  }
}
// Halt authority is per config. GOLD accounts are wallet-global; this is not
// a cross-vault spending freeze. Production exposes one fixed reviewed config.
async function requireRunning(db:D1Database,config:EconomyConfig){if((await economyChainState(db,config)).haltedReason)throw new EconomyConflict('ECONOMY_HALTED');if(await bind(db,'SELECT ancestor_id FROM economy_config_lineage WHERE ancestor_id=? LIMIT 1',config.id).first())throw new EconomyConflict('ECONOMY_CONFIG_REPLACED');}
export function normalizedEvent(config:EconomyConfig,event:EconomyChainEvent){
  if(!['stake','withdraw','payment'].includes(event.kind)||!Number.isSafeInteger(event.logIndex)||event.logIndex<0||event.logIndex>2_147_483_647||!validMs(event.timestamp))throw Error('INVALID_EVENT');
  const common={kind:event.kind,transactionHash:hash(event.transactionHash),logIndex:event.logIndex,blockNumber:economyUint(event.blockNumber,ECONOMY_MAX_INTEGER,true),blockHash:hash(event.blockHash),timestamp:event.timestamp,wallet:economyAddress(event.wallet),amount:economyUint(event.amount)};
  if(event.kind==='payment'){
    const token=economyAddress(event.token),receiver=economyAddress(event.receiver);
    if(token!==config.token||receiver!==config.treasury||event.positionId!==undefined||event.shares!==undefined)throw Error('INVALID_PAYMENT_ASSET');
    return {...common,kind:'payment' as const,orderId:hash(event.orderId),token,receiver,positionId:null,shares:null};
  }
  const shares=economyUint(event.shares,ECONOMY_MAX_INTEGER),positionId=economyUint(event.positionId);
  if(BigInt(common.amount)!==BigInt(shares)*ECONOMY_SHARE_WEI||event.orderId!==undefined||event.token!==undefined||event.receiver!==undefined)throw Error('INVALID_STAKE_AMOUNT');
  return {...common,kind:event.kind as 'stake'|'withdraw',positionId,shares,orderId:null,token:null,receiver:null};
}
/** A contiguous finalized range commits events, materialized positions, order
 * fulfillment and cursor together. A stale concurrent writer aborts entirely.
 * Timestamp is milliseconds from the validated block, never request time. */
export async function ingestEconomyEvents(db:D1Database,config:EconomyConfig,batch:EconomyEventBatch):Promise<{replayed:boolean;eventCount:number}>{
  const from=economyUint(batch.fromBlock,ECONOMY_MAX_INTEGER),to=economyUint(batch.toBlock,ECONOMY_MAX_INTEGER),toHash=hash(batch.toBlockHash);
  if(BigInt(to)<BigInt(from)||!validMs(batch.throughTimestamp)||!Array.isArray(batch.events)||batch.events.length>1000)throw Error('INVALID_EVENT_BATCH');
  const events=batch.events.map(e=>normalizedEvent(config,e));
  let previousBlock=BigInt(from),previousLog=-1,previousTime=-1,previousHash='';
  for(const e of events){
    const block=BigInt(e.blockNumber);
    if(block<BigInt(from)||block>BigInt(to)||block<previousBlock||(block===previousBlock&&e.logIndex<=previousLog)||e.timestamp<previousTime||e.timestamp>batch.throughTimestamp||
      (block===previousBlock&&previousHash&&previousHash!==e.blockHash)||(block===BigInt(to)&&(e.blockHash!==toHash||e.timestamp!==batch.throughTimestamp)))throw Error('EVENT_ORDER_OR_RANGE');
    previousLog=block===previousBlock?e.logIndex:e.logIndex;previousBlock=block;previousTime=e.timestamp;previousHash=e.blockHash;
  }
  const ingestionId=await economyDigest(JSON.stringify([config.id,from,to,toHash,batch.throughTimestamp,events]));
  if(await bind(db,'SELECT id FROM economy_ingestions WHERE id=?',ingestionId).first())return {replayed:true,eventCount:events.length};
  const state=await economyChainState(db,config);
  if(state.haltedReason)throw new EconomyConflict('ECONOMY_HALTED');
  if(BigInt(from)!==BigInt(state.lastBlock)+1n||batch.throughTimestamp<state.throughMs||events.some(e=>e.timestamp<state.throughMs))throw Error('NONCONTIGUOUS_FINALIZED_RANGE');
  const statements:D1PreparedStatement[]=[
    economyConfigStatement(db,config),
    bind(db,'INSERT INTO economy_chain_state(config_id,last_block,last_hash,through_ms) VALUES(?,?,?,?) ON CONFLICT(config_id) DO NOTHING',config.id,state.lastBlock,state.lastHash,state.throughMs),
    bind(db,`INSERT INTO economy_ingestions(id,config_id,accepted) SELECT ?,?,CASE WHEN EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND last_block=CAST(? AS INTEGER) AND last_hash=? AND through_ms=? AND halted_reason IS NULL) AND NOT EXISTS(SELECT 1 FROM economy_pending_blocks WHERE config_id=?) AND NOT EXISTS(SELECT 1 FROM economy_config_lineage WHERE ancestor_id=?) THEN 1 ELSE 0 END`,ingestionId,config.id,config.id,state.lastBlock,state.lastHash,state.throughMs,config.id,config.id)
  ];
  for(const e of events){
    const id=`${config.id}:${e.transactionHash}:${e.logIndex}`,payload=JSON.stringify(e);
    statements.push(bind(db,`INSERT INTO economy_chain_events(id,config_id,kind,tx_hash,log_index,block_number,block_hash,at_ms,wallet,position_id,shares,amount,order_id,token,receiver,payload) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,id,config.id,e.kind,e.transactionHash,e.logIndex,e.blockNumber,e.blockHash,e.timestamp,e.wallet,e.positionId,e.shares,e.amount,e.orderId,e.token,e.receiver,payload));
    // An immutable EMBEO quote remains receivable after its display expiry:
    // a transaction mined late must not take real tokens without fulfillment.
    if(e.kind==='payment')statements.push(bind(db,`UPDATE economy_orders SET status='paid',paid_ms=?,paid_event_id=? WHERE id=? AND ${economyOrderScope} AND wallet=? AND currency='EMBEO' AND amount=? AND status='pending'`,e.timestamp,id,e.orderId,config.id,config.id,e.wallet,e.amount));
  }
  statements.push(economyPaymentEvidenceStatement(db,config,{from,to}));
  statements.push(bind(db,'UPDATE economy_chain_state SET last_block=?,last_hash=?,through_ms=? WHERE config_id=?',to,toHash,batch.throughTimestamp,config.id));
  try{await db.batch(statements);}
  catch(error){if(await bind(db,'SELECT id FROM economy_ingestions WHERE id=?',ingestionId).first())return {replayed:true,eventCount:events.length};await haltInvalidEconomyWithdrawal(db,config,error);throw error;}
  return {replayed:false,eventCount:events.length};
}

export const ECONOMY_SETTLEMENT_POSITION_LIMIT=64,ECONOMY_SETTLEMENT_WALLET_LIMIT=32;
type DayProgress={ceiling:string;wallet:string;position:string;carry:string;version:string;completed:number};
/** Bounded application work, even for a wallet with many old lots. Each page
 * returns at most 65 indexed candidates and looks up the day-end checkpoint;
 * no SUM reads its entire withdrawal history. Database index/range scan cost
 * still depends on the stored eligible intervals. A partial wallet's
 * reward is carried, not issued. Only a completed wallet receives its one daily
 * journal. Page CAS, journals and completion marker commit atomically. */
export async function settleEconomy(db:D1Database,config:EconomyConfig,{nowMs,maxDays=14}:{nowMs:number;maxDays?:number}):Promise<{settledDays:number;throughMs:number}>{
  if(!validMs(nowMs)||!Number.isInteger(maxDays)||maxDays<1||maxDays>31)throw Error('INVALID_SETTLEMENT_CLOCK');
  // The config digest scopes cursors, not the identity of staked principal.
  // Bind this stable onchain stream once, so a start-block/payment-config edit
  // cannot replay all historical rewards into the wallet-global GOLD balance.
  const stakingKey=`${config.chainId}:${config.token}:${config.stakingContract}`;
  const binding=await bind(db,'SELECT config_id id FROM economy_reward_bindings WHERE staking_key=?',stakingKey).first<{id:string}>();
  if(binding&&binding.id!==config.id)throw new EconomyConflict('ECONOMY_CONFIG_CONFLICT');
  const state=await economyChainState(db,config),horizon=Math.floor(Math.min(nowMs,state.throughMs)/ECONOMY_DAY_MS)*ECONOMY_DAY_MS;
  if(state.haltedReason)throw new EconomyConflict('ECONOMY_HALTED');
  const first=await bind(db,'SELECT MIN(deposited_ms) at FROM economy_positions WHERE config_id=?',config.id).first<{at:number|null}>();
  if(first?.at===null||first?.at===undefined)return {settledDays:0,throughMs:horizon};
  let day=Math.ceil(first.at/ECONOMY_DAY_MS)*ECONOMY_DAY_MS,count=0,positionsLeft=ECONOMY_SETTLEMENT_POSITION_LIMIT,walletsLeft=ECONOMY_SETTLEMENT_WALLET_LIMIT;
  const last=await bind(db,'SELECT MAX(day_start_ms) at FROM economy_gold_days WHERE config_id=?',config.id).first<{at:number|null}>();
  if(last?.at!==null&&last?.at!==undefined)day=last.at+ECONOMY_DAY_MS;
  while(day+ECONOMY_DAY_MS<=horizon&&count<maxDays&&positionsLeft>0&&walletsLeft>0){
    const end=day+ECONOMY_DAY_MS;
    // Capture the numeric position ceiling once. Deposits arriving during a
    // multi-page old day have later timestamps and cannot extend its workload.
    // Claim and progress creation are atomic. Unknown legacy progress from
    // another config needs an explicitly verified migration, never auto-adoption.
    try{await db.batch([
      bind(db,`INSERT INTO economy_reward_bindings(staking_key,config_id)
        SELECT ?,? WHERE EXISTS(SELECT 1 FROM economy_reward_bindings WHERE config_id=?)
        OR NOT EXISTS(SELECT 1 FROM economy_day_progress p WHERE p.config_id<>? AND NOT EXISTS(SELECT 1 FROM economy_reward_bindings b WHERE b.config_id=p.config_id) AND NOT EXISTS(SELECT 1 FROM economy_config_lineage l WHERE l.ancestor_id=p.config_id))
        ON CONFLICT(staking_key) DO UPDATE SET config_id=excluded.config_id`,stakingKey,config.id,config.id,config.id),
      bind(db,`INSERT INTO economy_day_progress(config_id,day_start_ms,position_ceiling)
        SELECT ?,?,COALESCE((SELECT MAX(position_key) FROM economy_positions WHERE config_id=?),'')
        ON CONFLICT(config_id,day_start_ms) DO NOTHING`,config.id,day,config.id)
    ]);}catch(error){if(String(error).includes('ECONOMY_CONFIG_CONFLICT'))throw new EconomyConflict('ECONOMY_CONFIG_CONFLICT');throw error;}
    const progress=await bind(db,`SELECT position_ceiling ceiling,last_wallet wallet,last_position position,carry_reward carry,CAST(version AS TEXT) version,completed FROM economy_day_progress WHERE config_id=? AND day_start_ms=?`,config.id,day).first<DayProgress>();
    if(!progress||progress.completed)break;
    const rows=await bind(db,`SELECT p.wallet,p.position_id position,p.deposited_ms depositedMs,
      CAST(COALESCE((SELECT b.remaining_shares FROM economy_position_balances b WHERE b.config_id=p.config_id AND b.position_id=p.position_id AND b.at_ms<? ORDER BY b.at_ms DESC,b.block_number DESC,b.log_index DESC LIMIT 1),0) AS TEXT) shares
      FROM (
        SELECT config_id,position_id,wallet,deposited_ms FROM economy_positions INDEXED BY economy_positions_open_page
          WHERE config_id=? AND closed_ms IS NULL AND deposited_ms<=? AND position_key<=? AND (wallet>? OR (wallet=? AND position_id>?))
        UNION ALL
        SELECT config_id,position_id,wallet,deposited_ms FROM economy_positions INDEXED BY economy_positions_closed_end
          WHERE config_id=? AND closed_ms>=? AND deposited_ms<=? AND position_key<=? AND (wallet>? OR (wallet=? AND position_id>?))
      ) p ORDER BY p.wallet,p.position_id LIMIT ?`,end,
      config.id,day,progress.ceiling,progress.wallet,progress.wallet,progress.position,
      config.id,end,day,progress.ceiling,progress.wallet,progress.wallet,progress.position,positionsLeft+1).all<{wallet:string;position:string;depositedMs:number;shares:string}>();
    let wallet=progress.wallet,position=progress.position,carry=BigInt(progress.carry),processed=0,completedWallets=0;
    const rewards=new Map<string,bigint>();
    while(processed<rows.results.length&&processed<positionsLeft&&completedWallets<walletsLeft){
      const row=rows.results[processed];
      if(row.wallet!==wallet){if(carry!==0n)throw Error('CORRUPT_SETTLEMENT_CARRY');wallet=row.wallet;}
      const contribution=row.depositedMs<=day?BigInt(row.shares):0n;
      carry+=contribution;if(carry>ECONOMY_MAX_INTEGER)throw Error('GOLD_INTEGER_LIMIT');
      position=row.position;processed++;
      const next=rows.results[processed];
      if(!next||next.wallet!==wallet){rewards.set(wallet,carry);carry=0n;completedWallets++;}
    }
    const complete=processed===rows.results.length;
    // Empty pages close the day, while a look-ahead row makes a partial page
    // explicit. A maximum of 32 journals and 64 processed positions is global
    // across every day handled by this invocation (maxDays cannot multiply it).
    const pageId=await economyDigest(JSON.stringify([config.id,day,progress.version,progress.wallet,progress.position,wallet,position,String(carry),complete,[...rewards].map(([w,n])=>[w,String(n)])]));
    const statements:D1PreparedStatement[]=[bind(db,`INSERT INTO economy_settlement_pages(id,config_id,day_start_ms,accepted)
      SELECT ?,?,?,CASE WHEN EXISTS(SELECT 1 FROM economy_day_progress WHERE config_id=? AND day_start_ms=? AND version=CAST(? AS INTEGER) AND completed=0)
      AND EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND through_ms>=? AND halted_reason IS NULL) AND EXISTS(SELECT 1 FROM economy_reward_bindings WHERE config_id=?) THEN 1 ELSE 0 END`,pageId,config.id,day,config.id,day,progress.version,config.id,end,config.id)];
    for(const [who,reward] of rewards){
      if(reward===0n)continue;const reference=`${config.id}:${day}:${who}`;
      statements.push(bind(db,'INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms) VALUES(?,?,?,?,?,?)',`reward:${reference}`,who,String(reward),'utc-reward',reference,nowMs));
    }
    statements.push(bind(db,`UPDATE economy_day_progress SET last_wallet=?,last_position=?,carry_reward=?,version=version+1,completed=? WHERE config_id=? AND day_start_ms=? AND version=CAST(? AS INTEGER)`,wallet,position,String(carry),complete?1:0,config.id,day,progress.version));
    if(complete)statements.push(bind(db,'INSERT INTO economy_gold_days(config_id,day_start_ms,completed_ms,accepted) VALUES(?,?,?,1)',config.id,day,nowMs));
    try{await db.batch(statements);}
    catch(error){
      const changed=await bind(db,'SELECT CAST(version AS TEXT) version FROM economy_day_progress WHERE config_id=? AND day_start_ms=?',config.id,day).first<{version:string}>();
      if(changed&&changed.version!==progress.version)return {settledDays:count,throughMs:horizon};
      throw error;
    }
    positionsLeft-=processed;walletsLeft-=completedWallets;
    if(!complete)break;count++;day=end;
  }
  return {settledDays:count,throughMs:horizon};
}

export async function economyWalletSnapshot(db:D1Database,config:EconomyConfig,wallet:string){
  wallet=economyAddress(wallet);
  const [account,positions,journal,orders,state,lastDay,paymentCases]=await Promise.all([
    bind(db,'SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?',wallet).first<{balance:string}>(),
    bind(db,'SELECT position_id id,CAST(initial_shares AS TEXT) initialShares,CAST(remaining_shares AS TEXT) shares,deposited_ms depositedMs FROM economy_positions WHERE config_id=? AND wallet=? ORDER BY (remaining_shares>0) DESC,deposited_ms,position_id LIMIT 201',config.id,wallet).all(),
    bind(db,`SELECT j.id,CAST(j.delta AS TEXT) delta,CASE WHEN EXISTS(SELECT 1 FROM economy_gold_adjustments a WHERE a.journal_id=j.id) THEN 'historical-adjustment' ELSE j.kind END kind,j.created_ms createdMs FROM economy_gold_journal j WHERE wallet=? ORDER BY created_ms DESC,id DESC LIMIT 50`,wallet).all(),
    bind(db,'SELECT id,service_id serviceId,currency,amount,status,created_ms createdMs,expires_ms expiresMs,paid_ms paidMs FROM economy_orders WHERE wallet=? ORDER BY created_ms DESC,id DESC LIMIT 50',wallet).all(),
    economyChainState(db,config),
    bind(db,'SELECT MAX(day_start_ms) day FROM economy_gold_days WHERE config_id=?',config.id).first<{day:number|null}>(),
    economyPaymentCases(db,wallet)
  ]);
  return {address:wallet,gold:account?.balance??'0',positions:positions.results.slice(0,200),positionsTruncated:positions.results.length>200,journal:journal.results,orders:orders.results,paymentCases,chain:{block:state.lastBlock,throughMs:state.throughMs,haltedReason:state.haltedReason},settledThroughMs:lastDay?.day===null||lastDay?.day===undefined?null:lastDay.day+ECONOMY_DAY_MS};
}

export type EconomyOrder={id:string;wallet:string;serviceId:string;currency:'GOLD'|'EMBEO';amount:string;status:'pending'|'paid';createdMs:number;expiresMs:number;paidMs:number|null};
export type EconomyAuthorization={tokenHash:string};
function authorizationSql(auth:EconomyAuthorization|undefined,wallet:string,now:number,config:EconomyConfig){
  const session=auth?{sql:`EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND LOWER(address)=? AND revoked_at IS NULL AND expires_at>? AND wallet_type='EOA' AND verification_method='ECDSA')`,values:[auth.tokenHash,wallet,now]}:{sql:'1',values:[]};
  return {sql:`(${session.sql}) AND NOT EXISTS(SELECT 1 FROM economy_config_lineage WHERE ancestor_id=?)`,values:[...session.values,config.id]};
}
export class EconomyConflict extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
const orderSelect='SELECT id,wallet,service_id serviceId,currency,amount,status,created_ms createdMs,expires_ms expiresMs,paid_ms paidMs,request_payload payload FROM economy_orders';
function freshEconomyClock(args:{nowMs:number;now?:()=>number}):number{const now=args.now?.()??args.nowMs;if(!validMs(now)||now<args.nowMs)throw Error('INVALID_SETTLEMENT_CLOCK');return now;}
function randomEconomyHash():string{let value:string;do{value='0x'+[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');}while(/^0x0{64}$/.test(value));return value;}
export type EconomyGoldChallenge={orderId:string;requestId:string;wallet:string;nonce:string;origin:string;message:string;issuedMs:number;expiresMs:number;amount:string;serviceId:string};
export function economyGoldMessage(c:Omit<EconomyGoldChallenge,'message'>):string{
  return `IMD Ember World GOLD payment\n\nAuthorize one World service payment using nontransferable GOLD.\nThis signature does not authorize EMBEO, token allowances, or blockchain transfers.\n\nOrigin: ${c.origin}\nWallet: ${c.wallet}\nOrder: ${c.orderId}\nService: ${c.serviceId}\nAmount: ${c.amount} GOLD\nRequest: ${c.requestId}\nNonce: ${c.nonce}\nIssued at: ${new Date(c.issuedMs).toISOString()}\nExpires at: ${new Date(c.expiresMs).toISOString()}`;
}
export async function createEconomyGoldChallenge(db:D1Database,config:EconomyConfig,args:{wallet:string;orderId:string;requestId:string;origin:string;nowMs:number;now?:()=>number;authorization?:EconomyAuthorization}):Promise<EconomyGoldChallenge>{
  await requireRunning(db,config);
  const wallet=economyAddress(args.wallet),id=hash(args.orderId);
  if(!validMs(args.nowMs)||! /^[A-Za-z0-9_-]{16,80}$/.test(args.requestId))throw new EconomyConflict('BAD_REQUEST');
  const origin=new URL(args.origin);if(origin.origin!==args.origin||(args.origin!=='https://imdember.com'&&!(origin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(origin.hostname))))throw new EconomyConflict('BAD_REQUEST');
  const order=await bind(db,orderSelect+` WHERE id=? AND ${economyOrderScope} AND wallet=?`,id,config.id,config.id,wallet).first<EconomyOrder>();
  if(!order||order.currency!=='GOLD')throw new EconomyConflict('ORDER_NOT_FOUND');
  if(order.status==='paid')throw new EconomyConflict('ORDER_ALREADY_PAID');
  const previous=await bind(db,`SELECT nonce,origin,message,issued_ms issuedMs,expires_ms expiresMs,consumed_ms consumedMs FROM economy_gold_challenges WHERE order_id=? AND request_id=?`,id,args.requestId).first<{nonce:string;origin:string;message:string;issuedMs:number;expiresMs:number;consumedMs:number|null}>();
  const now=freshEconomyClock(args);
  // A different request/worker can observe a clock earlier than the quote.
  // Reject before writing instead of inventing an issuance timestamp.
  if(now<order.createdMs)throw Error('INVALID_SETTLEMENT_CLOCK');
  if(order.expiresMs<=now)throw new EconomyConflict('ORDER_EXPIRED');
  if(previous){if(previous.origin!==args.origin)throw new EconomyConflict('IDEMPOTENCY_CONFLICT');if(previous.expiresMs<=now||previous.consumedMs!==null)throw new EconomyConflict('CHALLENGE_EXPIRED');const {consumedMs:_,...saved}=previous;return {...saved,orderId:id,requestId:args.requestId,wallet,amount:order.amount,serviceId:order.serviceId};}
  const nonce=randomEconomyHash(),issuedMs=now,expiresMs=Math.min(now+300_000,order.expiresMs);
  const fields={orderId:id,requestId:args.requestId,wallet,nonce,origin:args.origin,issuedMs,expiresMs,amount:order.amount,serviceId:order.serviceId},message=economyGoldMessage(fields),auth=authorizationSql(args.authorization,wallet,now,config);
  await bind(db,`INSERT INTO economy_gold_challenges(order_id,request_id,wallet,nonce,origin,message,issued_ms,expires_ms) SELECT ?,?,?,?,?,?,?,? WHERE ${auth.sql} AND EXISTS(SELECT 1 FROM economy_orders WHERE id=? AND ${economyOrderScope} AND wallet=? AND currency='GOLD' AND status='pending' AND expires_ms>?) AND NOT EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND halted_reason IS NOT NULL) ON CONFLICT(order_id,request_id) DO NOTHING`,id,args.requestId,wallet,nonce,args.origin,message,issuedMs,expiresMs,...auth.values,id,config.id,config.id,wallet,now,config.id).run();
  const saved=await bind(db,`SELECT nonce,origin,message,issued_ms issuedMs,expires_ms expiresMs FROM economy_gold_challenges WHERE order_id=? AND request_id=?`,id,args.requestId).first<{nonce:string;origin:string;message:string;issuedMs:number;expiresMs:number}>();
  if(!saved)throw new EconomyConflict('AUTH_REQUIRED');if(saved.origin!==args.origin)throw new EconomyConflict('IDEMPOTENCY_CONFLICT');
  return {...fields,...saved};
}
export async function createEconomyOrder(db:D1Database,config:EconomyConfig,args:{wallet:string;requestId:string;serviceId:string;currency:'GOLD'|'EMBEO';nowMs:number;now?:()=>number;authorization?:EconomyAuthorization}):Promise<EconomyOrder>{
  await requireRunning(db,config);
  const wallet=economyAddress(args.wallet);if(!validMs(args.nowMs)||! /^[A-Za-z0-9_-]{16,80}$/.test(args.requestId)||!['GOLD','EMBEO'].includes(args.currency))throw new EconomyConflict('BAD_REQUEST');
  const payload=JSON.stringify([config.id,args.serviceId,args.currency]);
  const samePayload=async(saved:string)=>{if(saved===payload)return true;let parts;try{parts=JSON.parse(saved);}catch{return false;}return Array.isArray(parts)&&parts.length===3&&parts[1]===args.serviceId&&parts[2]===args.currency&&typeof parts[0]==='string'&&!!await bind(db,'SELECT ancestor_id FROM economy_config_lineage WHERE config_id=? AND ancestor_id=?',config.id,parts[0]).first();};
  const previous=await bind(db,orderSelect+' WHERE wallet=? AND request_id=?',wallet,args.requestId).first<EconomyOrder&{payload:string}>();
  if(previous){if(!await samePayload(previous.payload))throw new EconomyConflict('IDEMPOTENCY_CONFLICT');const now=freshEconomyClock(args);if(now<previous.createdMs)throw Error('INVALID_SETTLEMENT_CLOCK');if(previous.status==='pending'&&previous.expiresMs<=now)throw new EconomyConflict('ORDER_EXPIRED');const {payload:_,...order}=previous;return order;}
  const service=config.catalogue.find(s=>s.id===args.serviceId),amount=args.currency==='GOLD'?service?.gold:service?.embeo;
  if(!amount)throw new EconomyConflict('SERVICE_UNAVAILABLE');
  // The opaque order cannot be guessed and paid before its quote exists. A real
  // payment mined in the same slot may have an earlier whole-second timestamp
  // than this server's milliseconds; temporal ordering is not its authorization.
  const id=randomEconomyHash(),now=freshEconomyClock(args),expiresMs=now+15*60_000;
  const auth=authorizationSql(args.authorization,wallet,now,config);
  await bind(db,`INSERT INTO economy_orders(id,config_id,wallet,request_id,service_id,currency,amount,request_payload,created_ms,expires_ms) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${auth.sql} AND NOT EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND halted_reason IS NOT NULL) ON CONFLICT(wallet,request_id) DO NOTHING`,id,config.id,wallet,args.requestId,args.serviceId,args.currency,amount,payload,now,expiresMs,...auth.values,config.id).run();
  const inserted=await bind(db,orderSelect+' WHERE wallet=? AND request_id=?',wallet,args.requestId).first<EconomyOrder&{payload:string}>();
  if(!inserted)throw new EconomyConflict('AUTH_REQUIRED');
  if(!await samePayload(inserted.payload))throw new EconomyConflict('IDEMPOTENCY_CONFLICT');
  const returnedAt=freshEconomyClock(args);if(returnedAt<inserted.createdMs)throw Error('INVALID_SETTLEMENT_CLOCK');
  if(inserted.status==='pending'&&inserted.expiresMs<=returnedAt)throw new EconomyConflict('ORDER_EXPIRED');
  const {payload:_,...order}=inserted;return order;
}
/** Debit, immutable journal, order and fulfillment are one D1 transaction.
 * Replayed completion never adds a second journal/entitlement. */
export async function payEconomyOrderGold(db:D1Database,config:EconomyConfig,args:{wallet:string;orderId:string;requestId:string;signature:string;origin:string;nowMs:number;now?:()=>number;authorization?:EconomyAuthorization}):Promise<EconomyOrder>{
  await requireRunning(db,config);
  const wallet=economyAddress(args.wallet),id=hash(args.orderId);
  if(!validMs(args.nowMs)||! /^[A-Za-z0-9_-]{16,80}$/.test(args.requestId))throw new EconomyConflict('BAD_REQUEST');
  const read=()=>bind(db,`SELECT id,wallet,service_id serviceId,currency,amount,status,created_ms createdMs,expires_ms expiresMs,paid_ms paidMs,request_payload payload,gold_request_id goldRequestId FROM economy_orders WHERE id=? AND ${economyOrderScope} AND wallet=?`,id,config.id,config.id,wallet).first<EconomyOrder&{payload:string;goldRequestId:string|null}>();
  const existing=await read();
  if(!existing||existing.currency!=='GOLD')throw new EconomyConflict('ORDER_NOT_FOUND');
  if(existing.status==='paid'&&existing.goldRequestId!==args.requestId)throw new EconomyConflict('IDEMPOTENCY_CONFLICT');
  const challenge=await bind(db,`SELECT nonce,origin,message,issued_ms issuedMs,expires_ms expiresMs,consumed_ms consumedMs FROM economy_gold_challenges WHERE order_id=? AND request_id=? AND wallet=?`,id,args.requestId,wallet).first<{nonce:string;origin:string;message:string;issuedMs:number;expiresMs:number;consumedMs:number|null}>();
  if(!challenge||challenge.origin!==args.origin)throw new EconomyConflict('GOLD_SIGNATURE_REQUIRED');
  const canonical=economyGoldMessage({orderId:id,requestId:args.requestId,wallet,nonce:challenge.nonce,origin:challenge.origin,issuedMs:challenge.issuedMs,expiresMs:challenge.expiresMs,amount:existing.amount,serviceId:existing.serviceId});
  if(challenge.message!==canonical||typeof args.signature!=='string'||! /^0x[0-9a-fA-F]{130}$/.test(args.signature))throw new EconomyConflict('INVALID_GOLD_SIGNATURE');
  let signer:string;try{signer=(await recoverMessageAddress({message:canonical,signature:args.signature as `0x${string}`})).toLowerCase();}catch{throw new EconomyConflict('INVALID_GOLD_SIGNATURE');}
  if(signer!==wallet)throw new EconomyConflict('INVALID_GOLD_SIGNATURE');
  const now=args.now?.()??args.nowMs;
  if(!validMs(now)||now<args.nowMs||now<existing.createdMs||now<challenge.issuedMs)throw Error('INVALID_SETTLEMENT_CLOCK');
  if(existing.status==='paid'){const {payload:_,goldRequestId:__,...order}=existing;return order;}
  if(challenge.expiresMs<=now)throw new EconomyConflict('CHALLENGE_EXPIRED');
  if(challenge.consumedMs!==null)throw new EconomyConflict('CHALLENGE_EXPIRED');
  if(existing.expiresMs<=now)throw new EconomyConflict('ORDER_EXPIRED');
  const reference='order:'+id;
  const auth=authorizationSql(args.authorization,wallet,now,config);
  try{
    await db.batch([
      bind(db,`INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms) SELECT ?,?,-CAST(? AS INTEGER),'service-payment',?,? WHERE EXISTS(SELECT 1 FROM economy_orders WHERE id=? AND wallet=? AND status='pending' AND expires_ms>?) AND EXISTS(SELECT 1 FROM economy_gold_challenges WHERE order_id=? AND request_id=? AND nonce=? AND consumed_ms IS NULL AND expires_ms>?) AND ${auth.sql} AND NOT EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND halted_reason IS NOT NULL)`,reference,wallet,existing.amount,reference,now,id,wallet,now,id,args.requestId,challenge.nonce,now,...auth.values,config.id),
      bind(db,`UPDATE economy_orders SET status='paid',paid_ms=?,gold_request_id=? WHERE id=? AND wallet=? AND status='pending' AND EXISTS(SELECT 1 FROM economy_gold_journal WHERE reference=?)`,now,args.requestId,id,wallet,reference),
      bind(db,`UPDATE economy_gold_challenges SET consumed_ms=? WHERE order_id=? AND request_id=? AND nonce=? AND consumed_ms IS NULL AND EXISTS(SELECT 1 FROM economy_orders WHERE id=? AND status='paid' AND gold_request_id=?)`,now,id,args.requestId,challenge.nonce,id,args.requestId)
    ]);
  }catch(error){
    const completed=await read();
    if(completed?.status!=='paid'){
      const balance=await bind(db,'SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?',wallet).first<{balance:string}>();
      if(BigInt(balance?.balance??'0')<BigInt(existing.amount))throw new EconomyConflict('INSUFFICIENT_GOLD');
      throw error;
    }
  }
  const completed=await read();
  if(completed?.status!=='paid')throw new EconomyConflict('PAYMENT_UNAVAILABLE');
  if(completed.goldRequestId!==args.requestId)throw new EconomyConflict('IDEMPOTENCY_CONFLICT');
  const {payload:_,goldRequestId:__,...order}=completed;return order;
}
