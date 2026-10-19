import type {D1Database} from './d1.ts';
import {claimGoldJob,finishGoldJob} from './world-gold.ts';
import {hasGoldResultContract} from './world-gold-result.ts';

/** Trusted server adapter only. Real upstream installation is a release gate.
 * A timeout/exception/pending response never authorizes a refund. A terminal
 * nondelivery assertion must carry the provider's auditable reference. */
export type GoldDeliveryProvider={id:string;products?:readonly string[];deliver:(order:{orderId:string;wallet:string;product:string;idempotencyKey:string})=>Promise<
 {kind:'delivered';result:unknown}|{kind:'pending'}|{kind:'terminal-failure';code:string;proof:{kind:'provider-confirmed-nondelivery';reference:string}}
>};
export function hasGoldDeliveryProvider(provider:GoldDeliveryProvider|undefined):provider is GoldDeliveryProvider{
 return !!provider&&typeof provider.id==='string'&&/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider.id)&&typeof provider.deliver==='function';
}
export async function runGoldServiceJobs(db:D1Database,provider:GoldDeliveryProvider,clock:()=>number){
 if(!hasGoldDeliveryProvider(provider))throw Error('SERVICE_DELIVERY_UNAVAILABLE');
 const now=clock();if(!Number.isSafeInteger(now)||now<=0)throw Error('INVALID_CLOCK');
 const jobs=await db.prepare(`SELECT j.order_id,j.wallet,p.product FROM world_gold_jobs j JOIN world_gold_links l ON l.order_id=j.order_id JOIN world_gold_products p ON p.id=l.product_id WHERE j.state='queued' OR (j.state='working' AND j.lease_ms<=?) ORDER BY j.updated_ms,j.order_id LIMIT 16`).bind(now).all<{order_id:string;wallet:string;product:string}>();
 const outcomes:{orderId:string;status:string}[]=[];
 for(const j of jobs.results){
  if(!hasGoldResultContract(j.product)){outcomes.push({orderId:j.order_id,status:'SERVICE_RESULT_SCHEMA_UNBOUND'});continue;}
  if(provider.products&&!provider.products.includes(j.product)){outcomes.push({orderId:j.order_id,status:'SERVICE_PROVIDER_UNBOUND'});continue;}
  const attempt=await claimGoldJob(db,j.order_id,clock(),clock);if(!attempt)continue;
  try{const outcome=await provider.deliver({orderId:j.order_id,wallet:j.wallet,product:j.product,idempotencyKey:j.order_id});
   if(outcome.kind==='delivered')await finishGoldJob(db,{orderId:j.order_id,attempt,nowMs:clock(),now:clock,outcome:{result:outcome.result}});
   else if(outcome.kind==='terminal-failure'&&outcome.proof?.kind==='provider-confirmed-nondelivery'&&typeof outcome.proof.reference==='string'&&/^[A-Za-z0-9._:/-]{1,80}$/.test(outcome.proof.reference)&&typeof outcome.code==='string'&&/^[A-Z0-9_]{1,32}$/.test(outcome.code)){
    await finishGoldJob(db,{orderId:j.order_id,attempt,nowMs:clock(),now:clock,outcome:{failure:outcome.code,evidence:{kind:'provider-confirmed-nondelivery',provider:provider.id,reference:outcome.proof.reference}}});
   }else {outcomes.push({orderId:j.order_id,status:'pending'});continue;}
   outcomes.push({orderId:j.order_id,status:'finished'});
  }catch{outcomes.push({orderId:j.order_id,status:'retry'});}
 }
 return outcomes;
}
