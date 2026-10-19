import type {D1Database} from './d1.ts';
import {worldGoldSchemaReady} from './world-gold-schema.ts';
import {encodeGoldResult} from './world-gold-result.ts';

/** Read-only bounded exception inventory. No HTTP route, signing, refunds,
 * mutations or automatic historical rewriting. Complete inventories use the
 * returned cursor; an empty page alone is not proof the entire DB is clean. */
export async function inspectWorldGoldExceptions(db:D1Database,{after='',limit=100}:{after?:string;limit?:number}={}){
 if(typeof after!=='string'||after.length>256||!Number.isInteger(limit)||limit<1||limit>100)throw Error('INVALID_INSPECTION_LIMIT');
 const has=async(table:string)=>!!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
 const query=async(sql:string)=> (await db.prepare(sql).bind(after,limit).all<Record<string,unknown>>()).results;
 const ready=await worldGoldSchemaReady(db),issues:{kind:string;rows:Record<string,unknown>[];next:string|null}[]=[];
 if(!ready)return {schemaReady:false,diagnostic:'SCHEMA_INCOMPLETE',readOnly:true,issues};
 const add=(kind:string,rows:Record<string,unknown>[])=>issues.push({kind,rows,next:rows.length===limit?String(rows.at(-1)!.id):null});
 if(await has('economy_gold_reward_entitlements'))add('owed-staking-reward',await query(`SELECT id,wallet,config_id,day_start_ms,CAST(delta AS TEXT) gold,retry_ms,attempts FROM economy_gold_reward_entitlements WHERE settled_ms IS NULL AND id>? ORDER BY id LIMIT ?`));
 if(await has('economy_orders')&&await has('world_gold_links')&&await has('world_gold_jobs')){
  add('legacy-paid-without-job',await query(`SELECT o.id,o.wallet,o.service_id,CAST(o.amount AS TEXT) gold,o.paid_ms FROM economy_orders o WHERE o.currency='GOLD' AND o.status='paid' AND o.id>? AND NOT EXISTS(SELECT 1 FROM world_gold_jobs j WHERE j.order_id=o.id) ORDER BY o.id LIMIT ?`));
  add('failed-refund-pending',await query(`SELECT o.id,o.wallet,CAST(l.gold AS TEXT) originalGold,j.failure FROM world_gold_jobs j JOIN economy_orders o ON o.id=j.order_id JOIN world_gold_links l ON l.order_id=o.id WHERE j.state='failed' AND o.id>? ORDER BY o.id LIMIT ?`));
  const delivered=await query(`SELECT j.order_id id,j.wallet,p.product,j.result_json FROM world_gold_jobs j JOIN world_gold_links l ON l.order_id=j.order_id JOIN world_gold_products p ON p.id=l.product_id WHERE j.state='delivered' AND j.order_id>? ORDER BY j.order_id LIMIT ?`);
  const invalid=delivered.flatMap(r=>{try{const result=encodeGoldResult(String(r.product),JSON.parse(String(r.result_json)));return result.failure?[{id:r.id,wallet:r.wallet,reason:result.failure}]:[];}catch{return [{id:r.id,wallet:r.wallet,reason:'RESULT_NOT_SERIALIZABLE'}];}});
  issues.push({kind:'delivered-result-needs-review',rows:invalid,next:delivered.length===limit?String(delivered.at(-1)!.id):null});
 }
 if(await has('world_gold_mints')){
  const ended=await query(`SELECT id,wallet,chain_id,evidence_json FROM world_gold_mints WHERE state<>'held' AND id>? ORDER BY id LIMIT ?`);
  const invalid=ended.flatMap(r=>{let mode:unknown;try{mode=JSON.parse(String(r.evidence_json)).mode;}catch{/* Invalid evidence needs review too. */}
   return mode!==(r.chain_id===31337?'private-chain-fixture':'finalized-chain')?[{id:r.id,wallet:r.wallet,chainId:r.chain_id,mode:mode??null}]:[];});
  issues.push({kind:'historical-proof-mode-needs-review',rows:invalid,next:ended.length===limit?String(ended.at(-1)!.id):null});
  add('held-requires-original-reader',await query(`SELECT id,wallet,chain_id,contract,chain_instance,deadline FROM world_gold_mints WHERE state='held' AND id>? ORDER BY id LIMIT ?`));
 }
 return {schemaReady:ready,diagnostic:ready?'READY':'SCHEMA_INCOMPLETE',readOnly:true,issues};
}
