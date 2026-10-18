import type {D1Database,D1PreparedStatement} from './d1.ts';
import {economyAddress,economyDigest,economyUint,ECONOMY_MAX_INTEGER,type EconomyConfig} from './economy-config.ts';
import {economyConfigStatement} from './economy-reconciliation.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from './aimarket-admin.ts';

export const WORLD_GOLD_TABLES=['world_gold_products','world_gold_links','world_gold_mints','world_gold_holds','world_gold_jobs','world_gold_entries','world_gold_admin_actions','world_gold_campaigns','world_gold_controls','world_gold_write_checks'] as const;
const st=(db:D1Database,sql:string,...args:unknown[])=>db.prepare(sql).bind(...args);
const check=(db:D1Database,predicate:string,...args:unknown[])=>st(db,`INSERT INTO world_gold_write_checks(id,accepted) SELECT ?,CASE WHEN ${predicate} THEN 1 ELSE 0 END`,crypto.randomUUID(),...args);
const authCheck=(db:D1Database,wallet:string,now:number,auth?:{tokenHash:string})=>check(db,auth?`EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND address=? AND revoked_at IS NULL AND expires_at>? AND wallet_type='EOA' AND verification_method='ECDSA')`:'1',...auth?[auth.tokenHash,wallet,now]:[]);
const fail=(s:string):never=>{throw Error(s);};
const at=(n:number)=>Number.isSafeInteger(n)&&n>0?n:fail('INVALID_CLOCK');
const ident=(s:string)=>typeof s==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(s)?s:fail('INVALID_PRODUCT');
export const requestId=(s:string)=>typeof s==='string'&&/^[A-Za-z0-9_-]{16,80}$/.test(s)?s:fail('INVALID_REQUEST_ID');
type Product={id:string;product:string;version:number;kind:'topup'|'service';title:string;gold:string;embeo:string|null;enabled:number};
const productSelect='id,product,version,kind,title,CAST(gold AS TEXT) gold,embeo,enabled';
export type WorldGoldContext={db:D1Database;config:EconomyConfig;nowMs:number;now?:()=>number};
export async function goldProducts(db:D1Database){return (await db.prepare(`SELECT ${productSelect} FROM world_gold_products p WHERE version=(SELECT MAX(version) FROM world_gold_products WHERE product=p.product) ORDER BY product`).all<Product>()).results;}
export async function goldFeature(db:D1Database,feature:'topup'|'service'|'mint'){
 if(!(await st(db,'SELECT enabled FROM world_gold_controls WHERE feature=?',feature).first<{enabled:number}>())?.enabled)fail('FEATURE_PAUSED');
}
export async function worldGoldSnapshot(db:D1Database,wallet:string,nowMs:number){
 wallet=economyAddress(wallet);at(nowMs);
 const [balance,history,orders,mints]=await db.batch([
  st(db,`SELECT CAST(COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=?),0) AS TEXT) book, CAST(COALESCE((SELECT SUM(amount) FROM world_gold_holds WHERE wallet=? AND state='held'),0) AS TEXT) reserved`,wallet,wallet),
  st(db,'SELECT id,delta,kind,reference,created_ms FROM world_gold_history WHERE wallet=? ORDER BY created_ms DESC,id DESC LIMIT 100',wallet),
  st(db,`SELECT o.id,o.service_id product,o.currency,o.amount,o.status,o.created_ms,o.expires_ms,l.kind,CAST(l.gold AS TEXT) gold,j.state delivery,j.result_json result FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id LEFT JOIN world_gold_jobs j ON j.order_id=o.id WHERE o.wallet=? ORDER BY o.created_ms DESC,o.id DESC LIMIT 100`,wallet),
  st(db,`SELECT id,state,CAST(amount AS TEXT) gold,deadline FROM world_gold_mints WHERE wallet=? ORDER BY created_ms DESC,id DESC LIMIT 100`,wallet)
 ]);
 const row=balance.results[0] as {book:string;reserved:string}|undefined;if(!row)fail('LEDGER_UNAVAILABLE');
 const available=BigInt(row!.book)-BigInt(row!.reserved);if(available<0n)fail('LEDGER_INTEGRITY');
 return {wallet,book:row!.book,reserved:row!.reserved,available:String(available),asOf:nowMs,history:history.results,orders:orders.results,mints:mints.results,historyLimit:100,goldTransferable:false};
}
export async function goldQuote(ctx:WorldGoldContext,args:{wallet:string;requestId:string;product:string;authorization?:{tokenHash:string}}){
 const {db,config,nowMs}=ctx;at(nowMs);const wallet=economyAddress(args.wallet),rid=requestId(args.requestId);ident(args.product);
 // Retrying an old request uses the original quote, even after disabling/repricing.
 const old=await st(db,'SELECT id,service_id FROM economy_orders WHERE wallet=? AND request_id=?',wallet,rid).first<{id:string;service_id:string}>();
 if(old){const link=await st(db,'SELECT p.product FROM world_gold_links l JOIN world_gold_products p ON p.id=l.product_id WHERE l.order_id=?',old.id).first<{product:string}>();if(link?.product!==args.product)fail('IDEMPOTENCY_CONFLICT');return old.id;}
 const p=(await goldProducts(db)).find(p=>p.product===args.product);if(!p?.enabled)fail('PRODUCT_UNAVAILABLE');
 await goldFeature(db,p!.kind);
 const freshNow=at(ctx.now?.()??nowMs);if(freshNow<nowMs)fail('INVALID_CLOCK');
 const id='0x'+[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join(''),currency=p!.kind==='topup'?'EMBEO':'GOLD';
 try{await db.batch([
  authCheck(db,wallet,freshNow,args.authorization),economyConfigStatement(db,config),
  check(db,`EXISTS(SELECT 1 FROM world_gold_controls WHERE feature=? AND enabled=1) AND EXISTS(SELECT 1 FROM world_gold_products WHERE id=? AND enabled=1 AND version=(SELECT MAX(version) FROM world_gold_products WHERE product=?)) AND NOT EXISTS(SELECT 1 FROM economy_chain_state WHERE config_id=? AND halted_reason IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM economy_config_lineage WHERE ancestor_id=?)`,p!.kind,p!.id,p!.product,config.id,config.id),
  st(db,`INSERT INTO economy_orders(id,config_id,wallet,request_id,service_id,currency,amount,request_payload,created_ms,expires_ms) VALUES(?,?,?,?,?,?,?,?,?,?)`,id,config.id,wallet,rid,p!.product,currency,p!.kind==='topup'?p!.embeo:p!.gold,JSON.stringify([config.id,p!.product,currency]),freshNow,freshNow+900000),
  st(db,'INSERT INTO world_gold_links(order_id,product_id,kind,gold) VALUES(?,?,?,?)',id,p!.id,p!.kind,p!.gold)
 ]);}catch(error){const retry=await st(db,'SELECT o.id,p.product FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id JOIN world_gold_products p ON p.id=l.product_id WHERE o.wallet=? AND o.request_id=?',wallet,rid).first<{id:string;product:string}>();if(retry?.product===args.product)return retry.id;throw error;}
 return id;
}
const credit=(db:D1Database,orderId:string,kind:'topup'|'service-refund',nowMs:number)=>st(db,`INSERT INTO world_gold_entries(id,wallet,delta,kind,reference,order_id,created_ms)
 SELECT ?||':'||CAST(l.gold AS TEXT),o.wallet,l.gold-COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=o.id AND kind=?),0),?,?||':'||CAST(l.gold AS TEXT),o.id,? FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id WHERE o.id=? AND o.status='paid' AND l.gold>COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=o.id AND kind=?),0)
 ${kind==='topup'?"AND l.kind='topup' AND o.currency='EMBEO'":"AND l.kind='service' AND o.currency='GOLD' AND EXISTS(SELECT 1 FROM world_gold_jobs WHERE order_id=o.id AND state='failed')"}
 ON CONFLICT(reference) DO NOTHING`,kind+':'+orderId,kind,kind,kind+':'+orderId,nowMs,orderId,kind);
/** Shared by automatic retry and admin repair. No caller-supplied credit amount. */
export async function reconcileWorldGold(db:D1Database,nowMs:number,orderId?:string){
 at(nowMs);
 const pending=await db.prepare(`SELECT o.id,l.kind FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id WHERE o.status='paid' AND ((l.kind='topup' AND l.gold>COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=o.id AND kind='topup'),0)) OR (l.kind='service' AND NOT EXISTS(SELECT 1 FROM world_gold_jobs WHERE order_id=o.id))) ${orderId?'AND o.id=?':''} ORDER BY o.created_ms,o.id LIMIT 128`).bind(...orderId?[orderId]:[]).all<{id:string;kind:string}>();
 const statements:D1PreparedStatement[]=[];
 for(const o of pending.results){
  if(o.kind==='topup')statements.push(credit(db,o.id,'topup',nowMs));
  else statements.push(st(db,`INSERT INTO world_gold_jobs(order_id,wallet,state,updated_ms) SELECT id,wallet,'queued',? FROM economy_orders WHERE id=? ON CONFLICT(order_id) DO NOTHING`,nowMs,o.id));
 }
 if(statements.length)await db.batch(statements);
 const failed=await db.prepare(`SELECT order_id FROM world_gold_jobs WHERE state='failed' ${orderId?'AND order_id=?':''} ORDER BY order_id LIMIT 128`).bind(...orderId?[orderId]:[]).all<{order_id:string}>();
 for(const j of failed.results)await refundGold(db,j.order_id,nowMs);
 return {processed:pending.results.length};
}
export async function refundGold(db:D1Database,orderId:string,nowMs:number){
 at(nowMs);await db.batch([credit(db,orderId,'service-refund',nowMs),st(db,`UPDATE world_gold_jobs SET state='refunded',updated_ms=? WHERE order_id=? AND state='failed' AND EXISTS(SELECT 1 FROM world_gold_entries e JOIN world_gold_links l ON l.order_id=e.order_id WHERE e.order_id=world_gold_jobs.order_id AND e.reference='service-refund:'||l.order_id||':'||CAST(l.gold AS TEXT))`,nowMs,orderId)]);
 const j=await st(db,'SELECT state FROM world_gold_jobs WHERE order_id=?',orderId).first<{state:string}>();if(j?.state!=='refunded')fail('REFUND_NOT_ENTITLED');
}
/** An adapter must use orderId as its provider idempotency key. A timeout is
 * unknown, not failed. After lease expiry, retry QUERY/DELIVER of the same key. */
export async function claimGoldJob(db:D1Database,orderId:string,nowMs:number){
 at(nowMs);const token=crypto.randomUUID();
 const result=await st(db,`UPDATE world_gold_jobs SET state='working',attempt=?,lease_ms=?,updated_ms=? WHERE order_id=? AND (state='queued' OR (state='working' AND lease_ms<=?)) RETURNING wallet`,token,nowMs+60000,nowMs,orderId,nowMs).run();
 return result.results.length?token:null;
}
export async function finishGoldJob(db:D1Database,args:{orderId:string;attempt:string;nowMs:number;outcome:{result:unknown}|{failure:string}}){
 at(args.nowMs);const json=JSON.stringify('result' in args.outcome?args.outcome.result:null);if(json.length>16000)fail('RESULT_TOO_LARGE');
 const done='result' in args.outcome;
 const changed=await st(db,`UPDATE world_gold_jobs SET state=?,result_json=?,failure=?,lease_ms=NULL,updated_ms=? WHERE order_id=? AND state='working' AND attempt=? AND lease_ms>? RETURNING order_id`,done?'delivered':'failed',done?json:null,done?null:(args.outcome as {failure:string}).failure.slice(0,120),args.nowMs,args.orderId,args.attempt,args.nowMs).run();
 if(!changed.results.length)fail('STALE_DELIVERY');if(!done)await refundGold(db,args.orderId,args.nowMs);
}
export type MintBinding={id:string;wallet:string;auth:unknown;gold:string;chainId:number;contract:string;chainInstance:string;deadline:number};
export async function reserveMintGold(db:D1Database,m:MintBinding,nowMs:number){
 at(nowMs);const wallet=economyAddress(m.wallet),contract=economyAddress(m.contract),gold=economyUint(m.gold,ECONOMY_MAX_INTEGER);
 if(!/^0x[0-9a-f]{64}$/.test(m.id)||!Number.isSafeInteger(m.deadline)||m.deadline<=nowMs||!Number.isSafeInteger(m.chainId)||m.chainId<1||!m.chainInstance||m.chainInstance.length>128)fail('INVALID_MINT_AUTH');
 const encoded=JSON.stringify(m.auth);if(encoded.length>16000)fail('INVALID_MINT_AUTH');
 const old=await st(db,'SELECT auth_json,state FROM world_gold_mints WHERE id=?',m.id).first<{auth_json:string;state:string}>();
 if(old){if(old.auth_json!==encoded||old.state!=='held')fail('MINT_ORDER_CONFLICT');return;}
 await goldFeature(db,'mint');
 await db.batch([
  check(db,"EXISTS(SELECT 1 FROM world_gold_controls WHERE feature='mint' AND enabled=1)"),
  st(db,`INSERT INTO world_gold_mints(id,wallet,auth_json,amount,chain_id,contract,chain_instance,deadline,created_ms,state) VALUES(?,?,?,?,?,?,?,?,?,'held')`,m.id,wallet,encoded,gold,m.chainId,contract,m.chainInstance,m.deadline,nowMs),
  st(db,"INSERT INTO world_gold_holds(id,wallet,amount,state) VALUES(?,?,?,'held')",m.id,wallet,gold)
 ]);
}
/** Server verifier only; HTTP never accepts these facts from a browser. */
export type MintOutcome={id:string;chainId:number;contract:string;chainInstance:string;state:'consumed'|'released';evidence:Record<string,unknown>};
export async function settleMintGold(db:D1Database,o:MintOutcome,nowMs:number){
 at(nowMs);const row=await st(db,'SELECT * FROM world_gold_mints WHERE id=?',o.id).first<{state:string;chain_id:number;contract:string;chain_instance:string;wallet:string;amount:number}>();
 if(!row||row.chain_id!==o.chainId||row.contract!==economyAddress(o.contract)||row.chain_instance!==o.chainInstance)fail('MINT_SCOPE_MISMATCH');
 if(row!.state===o.state)return;if(row!.state!=='held')fail('MINT_STATE_CONFLICT');
 if(!o.evidence||!Object.keys(o.evidence).length)fail('MINT_EVIDENCE_REQUIRED');
 const statements=[st(db,"UPDATE world_gold_mints SET state=?,evidence_json=? WHERE id=? AND state='held'",o.state,JSON.stringify(o.evidence),o.id),st(db,"UPDATE world_gold_holds SET state=? WHERE id=? AND state='held'",o.state,o.id)];
 if(o.state==='consumed')statements.push(st(db,`INSERT INTO world_gold_entries(id,wallet,delta,kind,reference,order_id,created_ms) SELECT ?,wallet,-amount,'mint-payment',?,id,? FROM world_gold_mints WHERE id=? AND state='consumed' ON CONFLICT(reference) DO NOTHING`,'mint-payment:'+o.id,'mint-payment:'+o.id,nowMs,o.id));
 await db.batch(statements);
}
export async function goldCampaign(db:D1Database,nowMs:number){
 at(nowMs);const c=await db.prepare('SELECT version,starts_ms startsMs,ends_ms endsMs,stopped FROM world_gold_campaigns ORDER BY version DESC LIMIT 1').first<{version:number;startsMs:number;endsMs:number;stopped:number}>();
 return c?{...c,active:!c.stopped&&nowMs>=c.startsMs&&nowMs<c.endsMs,asOf:nowMs}:{version:0,startsMs:null,endsMs:null,stopped:0,active:false,asOf:nowMs};
}
type AdminCommand={action:'product';product:string;kind:'topup'|'service';title:string;gold:string;embeo?:string;enabled:boolean;version:number}|{action:'campaign';version:number;startsMs:number;endsMs:number;stopped:boolean}|{action:'control';feature:'topup'|'service'|'mint';enabled:boolean;version:number}|{action:'repair-topup'|'refund-service';orderId:string};
export async function goldAdminCommand(db:D1Database,args:{wallet:string;requestId:string;command:AdminCommand;reason:string;nowMs:number;now?:()=>number;authorization?:{tokenHash:string}}){
 const wallet=economyAddress(args.wallet),rid=requestId(args.requestId),started=at(args.nowMs),cmd=args.command;
 if(!AIMARKET_ACTIVITY_ADMIN_WALLETS.includes(wallet))fail('ADMIN_REQUIRED');
 if(typeof args.reason!=='string'||args.reason.trim().length<3||args.reason.length>500)fail('REASON_REQUIRED');
 const id=await economyDigest(wallet+':'+rid),payload=JSON.stringify([cmd,args.reason]);
 const old=await st(db,'SELECT payload FROM world_gold_admin_actions WHERE id=?',id).first<{payload:string}>();if(old){if(old.payload!==payload)fail('IDEMPOTENCY_CONFLICT');return;}
 const now=at(args.now?.()??started);if(now<started)fail('INVALID_CLOCK');
 const auditState=`json_object('productVersion',(SELECT MAX(version) FROM world_gold_products WHERE product=?),'campaignVersion',(SELECT MAX(version) FROM world_gold_campaigns),'feature',(SELECT json_object('enabled',enabled,'version',version) FROM world_gold_controls WHERE feature=?),'order',(SELECT json_object('id',o.id,'wallet',o.wallet,'status',o.status,'book',CAST(COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=o.wallet),0) AS TEXT),'credited',CAST(COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=o.id AND kind='topup'),0) AS TEXT),'refunded',CAST(COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=o.id AND kind='service-refund'),0) AS TEXT),'delivery',(SELECT state FROM world_gold_jobs WHERE order_id=o.id)) FROM economy_orders o WHERE id=?))`;
 const auditArgs=['product' in cmd?cmd.product:'','feature' in cmd?cmd.feature:'','orderId' in cmd?cmd.orderId:''];
 const beforeId='admin-before:'+id;
 const audit=st(db,`INSERT INTO world_gold_admin_actions(id,wallet,request_id,action,payload,created_ms,before_json,after_json) SELECT ?,?,?,?,?,?,before_json,${auditState} FROM world_gold_write_checks WHERE id=?`,id,wallet,rid,cmd.action,payload,now,...auditArgs,beforeId);
 const list:D1PreparedStatement[]=[authCheck(db,wallet,now,args.authorization),st(db,`INSERT INTO world_gold_write_checks(id,accepted,before_json) SELECT ?,1,${auditState}`,beforeId,...auditArgs)];
 if(cmd.action==='product'){
  ident(cmd.product);if(!['topup','service'].includes(cmd.kind)||typeof cmd.enabled!=='boolean'||typeof cmd.title!=='string'||!cmd.title.trim()||cmd.title.length>120||!Number.isSafeInteger(cmd.version)||cmd.version<1)fail('INVALID_PRODUCT');
  const gold=economyUint(cmd.gold,ECONOMY_MAX_INTEGER),embeo=cmd.kind==='topup'?economyUint(cmd.embeo):null;
  const pid=cmd.product+':'+cmd.version;
  list.push(check(db,'?=COALESCE((SELECT MAX(version) FROM world_gold_products WHERE product=?),0)+1',cmd.version,cmd.product),st(db,`INSERT INTO world_gold_products(id,product,version,kind,title,gold,embeo,enabled,created_ms) VALUES(?,?,?,?,?,?,?,?,?)`,pid,cmd.product,cmd.version,cmd.kind,cmd.title,gold,embeo,Number(cmd.enabled),now));
 }else if(cmd.action==='campaign'){
  at(cmd.startsMs);at(cmd.endsMs);if(cmd.endsMs<=cmd.startsMs||!Number.isSafeInteger(cmd.version)||cmd.version<1||typeof cmd.stopped!=='boolean')fail('INVALID_CAMPAIGN');
  list.push(check(db,'?=COALESCE((SELECT MAX(version) FROM world_gold_campaigns),0)+1',cmd.version),st(db,`INSERT INTO world_gold_campaigns(version,starts_ms,ends_ms,stopped,created_ms,actor) VALUES(?,?,?,?,?,?)`,cmd.version,cmd.startsMs,cmd.endsMs,Number(cmd.stopped),now,wallet));
 }else if(cmd.action==='control'){
  if(!['topup','service','mint'].includes(cmd.feature)||typeof cmd.enabled!=='boolean'||!Number.isSafeInteger(cmd.version))fail('INVALID_CONTROL');
  list.push(check(db,'EXISTS(SELECT 1 FROM world_gold_controls WHERE feature=? AND version=?)',cmd.feature,cmd.version),st(db,'UPDATE world_gold_controls SET enabled=?,version=version+1 WHERE feature=? AND version=? RETURNING feature',Number(cmd.enabled),cmd.feature,cmd.version));
 }else if(cmd.action==='repair-topup'){list.push(check(db,"EXISTS(SELECT 1 FROM world_gold_links l JOIN economy_orders o ON o.id=l.order_id WHERE o.id=? AND l.kind='topup' AND o.status='paid')",cmd.orderId),credit(db,cmd.orderId,'topup',now));}
 else if(cmd.action==='refund-service'){list.push(check(db,"EXISTS(SELECT 1 FROM world_gold_jobs WHERE order_id=? AND state IN ('failed','refunded'))",cmd.orderId),credit(db,cmd.orderId,'service-refund',now),st(db,`UPDATE world_gold_jobs SET state='refunded',updated_ms=? WHERE order_id=? AND state='failed' AND EXISTS(SELECT 1 FROM world_gold_entries e JOIN world_gold_links l ON l.order_id=e.order_id WHERE e.order_id=world_gold_jobs.order_id AND e.reference='service-refund:'||l.order_id||':'||CAST(l.gold AS TEXT))`,now,cmd.orderId));}
 else fail('UNKNOWN_ACTION');
 list.push(audit);const results=await db.batch(list);
 return {id,results:results.map(r=>r.meta.changes??0)};
}
