import type {D1Database,D1PreparedStatement} from './d1.ts';
import {defineEconomyConfig,economyAddress,economyDigest,type EconomyConfig} from './economy-config.ts';

// Internal indexer/operator helpers only. No new HTTP route or wallet role.
export function economyConfigStatement(db:D1Database,c:EconomyConfig):D1PreparedStatement{
 const identity=JSON.stringify([c.chainId,c.token,c.stakingContract,c.paymentContract,c.treasury,c.deploymentBlock]);
 return db.prepare(`INSERT INTO economy_config_registry(config_id,config_json,chain_id,token,staking_contract,payment_contract,treasury) VALUES(?,?,?,?,?,?,?) ON CONFLICT(config_id) DO UPDATE SET config_json=excluded.config_json`).bind(c.id,identity,c.chainId,c.token,c.stakingContract,c.paymentContract,c.treasury);
}
export const economyOrderScope=`(config_id=? OR config_id IN (SELECT ancestor_id FROM economy_config_lineage WHERE config_id=?))`;
/** One bounded INSERT..SELECT records original facts even when no quote matches.
 * This runs in the SAME ingestion batch as events/cursor/fulfillment. A staged
 * block records nothing until its complete fold commits. */
export function economyPaymentEvidenceStatement(db:D1Database,c:EconomyConfig,range?:{from:string;to:string}):D1PreparedStatement{
 return db.prepare(`INSERT INTO economy_payment_cases(event_id,config_id,chain_id,payment_contract,tx_hash,log_index,block_hash,block_number,payer,order_id,expected_wallet,expected_amount,actual_amount,receiver,token,classification,at_ms)
 SELECT e.id,e.config_id,r.chain_id,r.payment_contract,e.tx_hash,e.log_index,e.block_hash,e.block_number,e.wallet,e.order_id,o.wallet,o.amount,e.amount,e.receiver,e.token,
 CASE WHEN o.id IS NULL THEN 'unknown-order' WHEN o.wallet<>e.wallet THEN 'wrong-payer'
 WHEN o.config_id<>e.config_id AND NOT EXISTS(SELECT 1 FROM economy_config_lineage l WHERE l.config_id=e.config_id AND l.ancestor_id=o.config_id) THEN 'wrong-config'
 WHEN o.currency<>'EMBEO' THEN 'wrong-currency' WHEN o.amount<>e.amount THEN 'wrong-amount'
 WHEN o.status='paid' AND o.paid_event_id<>e.id THEN 'extra-payment' ELSE 'matched' END,e.at_ms
 FROM economy_chain_events e JOIN economy_config_registry r ON r.config_id=e.config_id
 LEFT JOIN economy_orders o ON o.id=e.order_id WHERE e.config_id=? AND e.kind='payment'
 AND NOT EXISTS(SELECT 1 FROM economy_payment_cases p WHERE p.chain_id=r.chain_id AND p.payment_contract=r.payment_contract AND p.tx_hash=e.tx_hash AND p.log_index=e.log_index)
 ${range?'AND e.block_number BETWEEN CAST(? AS INTEGER) AND CAST(? AS INTEGER)':''}
 ORDER BY e.block_number,e.log_index LIMIT ${range?'10000':'256'} ON CONFLICT DO NOTHING`).bind(c.id,...range?[range.from,range.to]:[]);
}
/** Backfill legacy evidence without moving money or modifying original events. */
export async function reconcileEconomyPayments(db:D1Database,config:EconomyConfig){
 const c=await defineEconomyConfig(config);if(c.id!==config.id)throw Error('INVALID_RECOVERY_CONFIG');
 await db.batch([economyConfigStatement(db,c),economyPaymentEvidenceStatement(db,c)]);
 const row=await db.prepare(`SELECT COUNT(*) remaining FROM economy_chain_events e WHERE config_id=? AND kind='payment' AND NOT EXISTS(SELECT 1 FROM economy_payment_cases p WHERE p.chain_id=? AND p.payment_contract=? AND p.tx_hash=e.tx_hash AND p.log_index=e.log_index)`).bind(c.id,c.chainId,c.paymentContract).first<{remaining:number}>();
 return {remaining:row?.remaining??0};
}
export async function economyPaymentCases(db:D1Database,wallet:string){
 wallet=economyAddress(wallet);
 const rows=await db.prepare(`SELECT p.event_id id,p.tx_hash transactionHash,p.order_id orderId,p.actual_amount actualAmount,
 CASE WHEN p.expected_wallet=p.payer AND o.currency='EMBEO' THEN p.expected_amount ELSE NULL END expectedAmount,
 p.classification, p.at_ms createdMs,
 CASE WHEN o.wallet=p.payer AND o.status='paid' THEN o.paid_event_id ELSE NULL END correctPaymentEvent,
 COALESCE((SELECT a.action FROM economy_payment_case_actions a WHERE a.event_id=p.event_id AND a.action='acknowledged-no-entitlement' LIMIT 1),'unreviewed') disposition
 FROM economy_payment_cases p LEFT JOIN economy_orders o ON o.id=p.order_id
 WHERE p.payer=? AND p.classification<>'matched' ORDER BY p.at_ms DESC,p.event_id DESC LIMIT 50`).bind(wallet).all();
 return rows.results;
}
/** Operator note/disposition is append-only evidence, never a refund command or
 * a mint/debit/fulfillment authority. No supplied tx hash is called a refund. */
export async function recordEconomyPaymentDisposition(db:D1Database,args:{eventId:string;requestId:string;action:'note'|'acknowledged-no-entitlement';note:string;nowMs:number}){
 if(typeof args.eventId!=='string'||args.eventId.length>160||typeof args.requestId!=='string'||! /^[A-Za-z0-9_-]{16,80}$/.test(args.requestId)||!['note','acknowledged-no-entitlement'].includes(args.action)||typeof args.note!=='string'||args.note.length<1||args.note.length>1000||!Number.isSafeInteger(args.nowMs)||args.nowMs<0)throw Error('INVALID_PAYMENT_DISPOSITION');
 const id=await economyDigest(JSON.stringify([args.eventId,args.requestId])),read=()=>db.prepare('SELECT id,event_id eventId,action,note,created_ms createdMs FROM economy_payment_case_actions WHERE id=?').bind(id).first<{id:string;eventId:string;action:string;note:string;createdMs:number}>();
 const existing=await read();if(existing){if(existing.action!==args.action||existing.note!==args.note)throw Error('IDEMPOTENCY_CONFLICT');return existing;}
 await db.prepare(`INSERT INTO economy_payment_case_actions(id,event_id,request_id,action,note,created_ms) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM economy_payment_cases WHERE event_id=? AND classification<>'matched' AND at_ms<=?) ON CONFLICT(id) DO NOTHING`).bind(id,args.eventId,args.requestId,args.action,args.note,args.nowMs,args.eventId,args.nowMs).run();
 const saved=await read();if(!saved)throw Error('PAYMENT_CASE_NOT_FOUND');if(saved.action!==args.action||saved.note!==args.note)throw Error('IDEMPOTENCY_CONFLICT');return saved;
}
