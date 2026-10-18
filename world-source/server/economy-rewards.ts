import type {D1Database} from './d1.ts';
import {requireWorldGoldSchema} from './world-gold-schema.ts';

/** Idempotent original UTC-day entitlement, atomically routed by migration0016
 * to a journal or to an owed row. A day marker means scanning is accounted for,
 * not that every capacity-bound wallet has received spendable GOLD. */
export function rewardEntitlementStatement(db:D1Database,args:{configId:string;day:number;wallet:string;reward:bigint;nowMs:number}){
 const reference=`${args.configId}:${args.day}:${args.wallet}`;
 return db.prepare(`INSERT INTO economy_gold_reward_entitlements(id,config_id,day_start_ms,wallet,delta,reference,created_ms) VALUES(?,?,?,?,?,?,?)`)
  .bind('reward:'+reference,args.configId,args.day,args.wallet,String(args.reward),reference,args.nowMs);
}
/** Server maintenance only. At most32 original entitlements per call. The
 * journal and settled marker commit together; capacity cannot abort another
 * wallet, and unknown storage faults remain visible as retryable obligations. */
export async function reconcileRewardEntitlements(db:D1Database,nowMs:number){
 if(!Number.isSafeInteger(nowMs)||nowMs<=0)throw Error('INVALID_CLOCK');
 await requireWorldGoldSchema(db);
 const rows=await db.prepare(`SELECT id,wallet FROM economy_gold_reward_entitlements WHERE settled_ms IS NULL AND retry_ms<=? ORDER BY retry_ms,id LIMIT 32`).bind(nowMs).all<{id:string;wallet:string}>();
 const outcomes:{id:string;wallet:string;status:string}[]=[];
 for(const row of rows.results){
  try{await db.batch([
   db.prepare(`INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms)
    SELECT id,wallet,delta,'utc-reward',reference,? FROM economy_gold_reward_entitlements e
    WHERE id=? AND settled_ms IS NULL AND NOT EXISTS(SELECT 1 FROM economy_gold_journal j WHERE j.reference=e.reference)
    AND COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=e.wallet),0)<=9223372036854775807-e.delta`).bind(nowMs,row.id),
   db.prepare(`UPDATE economy_gold_reward_entitlements SET settled_ms=CASE WHEN EXISTS(SELECT 1 FROM economy_gold_journal j WHERE j.id=economy_gold_reward_entitlements.id AND j.reference=economy_gold_reward_entitlements.reference AND j.wallet=economy_gold_reward_entitlements.wallet AND j.delta=economy_gold_reward_entitlements.delta AND j.kind='utc-reward') THEN ? ELSE NULL END,
    retry_ms=?,attempts=attempts+1 WHERE id=? AND settled_ms IS NULL`).bind(nowMs,nowMs+300000,row.id)
  ]);
  const state=await db.prepare('SELECT settled_ms FROM economy_gold_reward_entitlements WHERE id=?').bind(row.id).first<{settled_ms:number|null}>();
  outcomes.push({...row,status:state?.settled_ms!==null&&state?.settled_ms!==undefined?'credited':'GOLD_BALANCE_CAPACITY'});
  }catch{
   // A single target's storage fault must not occupy every maintenance page.
   // The original immutable entitlement remains even if diagnostics also fail.
   try{await db.prepare('UPDATE economy_gold_reward_entitlements SET retry_ms=?,attempts=attempts+1 WHERE id=? AND settled_ms IS NULL').bind(nowMs+300000,row.id).run();}catch{/* Storage outage is reported, never mistaken for credit. */}
   outcomes.push({...row,status:'GOLD_REWARD_RETRY'});
  }
 }
 return outcomes;
}
