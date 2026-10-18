import type {D1Database,D1PreparedStatement} from './d1.ts';
import {WORLD_GOLD_TABLES,WORLD_GOLD_AUDIT_TABLES} from './world-gold.ts';
import {defineEconomyConfig,economyDigest,ECONOMY_DAY_MS as DAY,ECONOMY_MAX_INTEGER,ECONOMY_SHARE_WEI,type EconomyConfig} from './economy-config.ts';
import {economyConfigStatement,economyPaymentEvidenceStatement} from './economy-reconciliation.ts';
import {INVALID_POSITION_WITHDRAWAL,normalizedEvent,type EconomyChainEvent} from './economy-ledger.ts';

/** Explicit INTERNAL maintenance workflow. No HTTP route, administrator wallet,
 * arbitrary credit amount, transaction sender or automatic production switch.
 * Inputs are controlled database exports: the rebuilt DB must come from the
 * existing finalized receipt-verifying indexer, not a player event upload.
 * The operator reviews the deterministic plan hash before applying one batch.
 */
export const RECOVERY_LIMITS=Object.freeze({events:5000,days:366,ancestors:16,statements:64,boundValueBytes:524288,planBytes:4194304,snapshotPageRows:128,guardParameters:100});
const TABLES=['economy_chain_state','economy_ingestions','economy_positions','economy_position_balances','economy_chain_events','economy_gold_accounts','economy_gold_journal','economy_gold_days','economy_day_progress','economy_settlement_pages','economy_orders','economy_gold_challenges','economy_fulfillments','economy_pending_blocks','economy_staged_events','economy_stage_batches','economy_reward_bindings','economy_config_registry','economy_recoveries','economy_config_lineage','economy_gold_adjustments','economy_payment_cases','economy_payment_case_actions','economy_gold_reward_entitlements',...WORLD_GOLD_TABLES.filter(t=>t!=='world_gold_write_checks'),...WORLD_GOLD_AUDIT_TABLES] as const;
type Cell=string|null;type Row=Record<string,Cell>;
type Snapshot={table:string;columns:string[];chunks:{json:string;query:string}[];rows:Row[]};
const fail=(code:string):never=>{throw Error(code);};
const encode=(s:string)=>new TextEncoder().encode(s).length;
type CapacityFailure={metric:string;actual:number;limit:number;table?:string;side?:string};
class RecoveryCapacityError extends Error{readonly details:CapacityFailure;constructor(details:CapacityFailure){super('RECOVERY_REQUIRES_LARGER_REVIEWED_PLAN');this.details=details;}}
function capacity(metric:keyof typeof RECOVERY_LIMITS,actual:number,context:{table?:string;side?:string}={}){if(actual>RECOVERY_LIMITS[metric])throw new RecoveryCapacityError({metric,actual,limit:RECOVERY_LIMITS[metric],...context});}
const integer=(v:Cell|undefined)=>typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)?BigInt(v):fail('RECOVERY_INVALID_INTEGER');
function clock(v:Cell|undefined){const n=integer(v);if(n>BigInt(Number.MAX_SAFE_INTEGER))return fail('RECOVERY_INVALID_CLOCK');return Number(n);}
async function snapshot(db:D1Database,table:string,side:string,budget:{bytes:number}):Promise<Snapshot>{
 if(!(TABLES as readonly string[]).includes(table))return fail('RECOVERY_TABLE_NOT_ALLOWED');
 const info=await db.prepare(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`).all<{name:string}>();
 const columns=info.results.map(r=>r.name);if(!columns.length||columns.some(c=>! /^[a-z_]+$/.test(c)))return fail('RECOVERY_SCHEMA_MISSING');
 const rows:Row[]=[],chunks:Snapshot['chunks']=[];
 for(let offset=0;;offset+=RECOVERY_LIMITS.snapshotPageRows){
  const query=`SELECT COALESCE(json_group_array(row),'[]') value FROM (SELECT json_array(${columns.map(c=>`CAST(${c} AS TEXT)`).join(',')}) row FROM ${table} ORDER BY row LIMIT ${RECOVERY_LIMITS.snapshotPageRows} OFFSET ${offset})`;
  const value=await db.prepare(query).first<{value:string}>();if(!value)return fail('RECOVERY_SCHEMA_MISSING');
  const bytes=encode(value.value);capacity('boundValueBytes',bytes,{table,side});budget.bytes+=bytes;capacity('planBytes',budget.bytes,{table,side});
  const page=JSON.parse(value.value) as string[];
  chunks.push({json:value.value,query});
  rows.push(...page.map(s=>Object.fromEntries((JSON.parse(s) as Cell[]).map((v,i)=>[columns[i],v]))));
  if(page.length<RECOVERY_LIMITS.snapshotPageRows)break;
 }
 return {table,columns,chunks,rows};
}
async function snapshots(db:D1Database,side:string,budget:{bytes:number}){const result:Snapshot[]=[];for(const t of TABLES){
 if(t==='economy_gold_reward_entitlements'&&!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(t).first()){
  if(await db.prepare("SELECT name FROM sqlite_master WHERE name IN ('economy_gold_credit_capacity','world_gold_mint_proof_mode') LIMIT 1").first())return fail('RECOVERY_SCHEMA_MISSING');continue;
 }
 if((WORLD_GOLD_AUDIT_TABLES as readonly string[]).includes(t)&&!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").bind(t).first()){
  const audit=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('world_gold_reconcile_errors','world_gold_mint_settlements') LIMIT 1").first();if(audit)return fail('RECOVERY_SCHEMA_MISSING');continue;
 }
 if((WORLD_GOLD_TABLES as readonly string[]).includes(t)&&!await db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=?').bind(t).first()){
  const present=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'world_gold_%' LIMIT 1").first();if(present)return fail('RECOVERY_SCHEMA_MISSING');continue;
 }
 result.push(await snapshot(db,t,side,budget));}return result;}
const at=(s:Snapshot[],name:string)=>s.find(t=>t.table===name)?.rows??fail('RECOVERY_SCHEMA_MISSING');
const domain=(c:EconomyConfig)=>`${c.chainId}:${c.token}:${c.stakingContract}`;
const key=(day:number,wallet:string)=>`${day}:${wallet}`;
type Reward={day:number;wallet:string;amount:string};
/** Independent event replay: no candidate account/journal/balance is trusted as
 * entitlement. Monotone whole-share withdrawals determine day-end survivors.
 */
function replay(events:Row[],horizon:number):{rewards:Map<string,bigint>;firstDay:number|null}{
 capacity('events',events.length);
 const ordered=[...events].sort((a,b)=>integer(a.block_number)<integer(b.block_number)?-1:integer(a.block_number)>integer(b.block_number)?1:Number(integer(a.log_index)-integer(b.log_index)));
 const positions=new Map<string,{wallet:string;at:number;shares:bigint;changes:{at:number;left:bigint}[]}>();let priorTime=0;const seen=new Set<string>();
 for(const e of ordered){
  const time=clock(e.at_ms),identity=`${e.tx_hash}:${e.log_index}`;
  if(time<priorTime||time>horizon+DAY||seen.has(identity))return fail('RECOVERY_EVENT_CONFLICT');priorTime=time;seen.add(identity);
  if(e.kind==='payment')continue;
  if(!e.position_id||!e.wallet||!/^0x[0-9a-f]{40}$/.test(e.wallet))return fail('RECOVERY_EVENT_CONFLICT');
  const shares=integer(e.shares);if(shares<1n||integer(e.amount)!==shares*ECONOMY_SHARE_WEI)return fail('RECOVERY_EVENT_CONFLICT');
  if(e.kind==='stake'){
   if(positions.has(e.position_id))return fail('RECOVERY_EVENT_CONFLICT');
   positions.set(e.position_id,{wallet:e.wallet,at:time,shares,changes:[{at:time,left:shares}]});
  }else if(e.kind==='withdraw'){
   const p=positions.get(e.position_id);if(!p||p.wallet!==e.wallet||p.shares<shares||time<p.at)return fail('RECOVERY_EVENT_CONFLICT');
   p.shares-=shares;p.changes.push({at:time,left:p.shares});
  }else return fail('RECOVERY_EVENT_CONFLICT');
 }
 const firstDay=positions.size?Math.min(...[...positions.values()].map(p=>Math.ceil(p.at/DAY)*DAY)):null;
 if(firstDay!==null)capacity('days',(horizon-firstDay)/DAY);
 const rewards=new Map<string,bigint>();
 if(firstDay!==null)for(let day=firstDay;day<horizon;day+=DAY)for(const p of positions.values()){
  if(p.at>day)continue;let left=0n;for(const change of p.changes){if(change.at>=day+DAY)break;left=change.left;}
  if(left)rewards.set(key(day,p.wallet),(rewards.get(key(day,p.wallet))??0n)+left);
 }
 for(const amount of rewards.values())if(amount>ECONOMY_MAX_INTEGER)return fail('GOLD_INTEGER_LIMIT');
 return {rewards,firstDay};
}
export type EconomyRecoveryReport={fromConfig:string;toConfig:string;stakingKey:string;horizonMs:number;eventCount:number;boundary:{mode:'matching-finalized'|'bootstrap-predecessor';block:string;hash:string;throughMs:number};oldSettlementIncomplete:boolean;pendingRewardsAccounted?:true;adjustments:{day:number;wallet:string;creditedBefore:string;owedBefore?:string;entitlement:string;delta:string}[];totalDelta:string;preservesSpentGold:true;paymentContractChanged:false;oldHistoryPreserved:true;limits:typeof RECOVERY_LIMITS;capacity?:{snapshotBytes:number;guardParameters:number;tables:{side:string;table:string;rows:number;pages:number;bytes:number}[]}};
export type EconomyRecoveryPlan={hash:string;report:EconomyRecoveryReport};
/** A first-batch halt may have pending promises, but no finalized economics.
 * Inventory the namespace, not the wallet-global balance of unrelated vaults.
 * The rebuilt anchor is specifically the predecessor of the rejected batch,
 * verified by the existing indexer; never an arbitrary later shadow boundary. */
function emptyBootstrap(old:Snapshot[],from:EconomyConfig){
 if(old.find(s=>s.table==='economy_gold_reward_entitlements')?.rows.some(r=>r.config_id===from.id))return false;
 const tables=['economy_ingestions','economy_positions','economy_position_balances','economy_chain_events','economy_gold_days','economy_day_progress','economy_settlement_pages'];
 if(tables.some(t=>at(old,t).some(r=>r.config_id===from.id)))return false;
 if(at(old,'economy_reward_bindings').some(r=>r.staking_key===domain(from))||at(old,'economy_config_lineage').some(r=>r.config_id===from.id||r.ancestor_id===from.id)
  ||at(old,'economy_recoveries').some(r=>r.staking_key===domain(from))||at(old,'economy_gold_adjustments').some(r=>r.staking_key===domain(from)))return false;
 const orders=at(old,'economy_orders').filter(r=>r.config_id===from.id),ids=new Set(orders.map(r=>r.id));
 if(orders.some(r=>r.status!=='pending'||r.paid_ms!==null||r.paid_event_id!==null||r.gold_request_id!==null)
  ||at(old,'economy_fulfillments').some(r=>ids.has(r.order_id))||at(old,'economy_gold_challenges').some(r=>ids.has(r.order_id)&&r.consumed_ms!==null)
  ||at(old,'economy_gold_journal').some(r=>r.reference?.startsWith(from.id+':')||orders.some(o=>r.reference==='order:'+o.id))
  ||at(old,'economy_payment_cases').some(r=>r.config_id===from.id))return false;
 return true;
}
/** Only provably empty sync metadata may be ignored. Pending orders/challenges,
 * staged pages, payments, journals and reviewed lineage are economic footprint. */
function emptySync(old:Snapshot[],c:EconomyConfig){
 if(old.find(s=>s.table==='economy_gold_reward_entitlements')?.rows.some(r=>r.config_id===c.id))return false;
 const state=at(old,'economy_chain_state').find(r=>r.config_id===c.id);
 if(!state||state.halted_reason)return false;
 const tables=['economy_positions','economy_position_balances','economy_chain_events','economy_gold_days','economy_day_progress','economy_settlement_pages','economy_orders','economy_pending_blocks','economy_staged_events','economy_reward_bindings','economy_payment_cases'];
 if(tables.some(t=>at(old,t).some(r=>r.config_id===c.id))||at(old,'economy_gold_journal').some(r=>r.reference?.startsWith(c.id+':'))
  ||at(old,'economy_config_lineage').some(r=>r.config_id===c.id||r.ancestor_id===c.id)
  ||at(old,'economy_recoveries').some(r=>r.from_config===c.id||r.to_config===c.id))return false;
 const ingestions=at(old,'economy_ingestions').filter(r=>r.config_id===c.id);
 return state.last_hash===''?integer(state.last_block)===BigInt(c.deploymentBlock)-1n&&state.through_ms==='0'&&!ingestions.length:
  /^0x[0-9a-f]{64}$/.test(state.last_hash!)&&integer(state.last_block)>=BigInt(c.deploymentBlock)&&clock(state.through_ms)>=0&&ingestions.length>0&&ingestions.every(r=>r.accepted==='1');
}
async function build(db:D1Database,rebuilt:D1Database,fromInput:EconomyConfig,toInput:EconomyConfig,nowMs:number){
 const from=await defineEconomyConfig(fromInput),to=await defineEconomyConfig(toInput);
 if(from.id!==fromInput.id||to.id!==toInput.id||from.id===to.id||domain(from)!==domain(to)||from.paymentContract!==to.paymentContract||from.treasury!==to.treasury||BigInt(to.deploymentBlock)>=BigInt(from.deploymentBlock))return fail('RECOVERY_UNSUPPORTED_CONFIG_CHANGE');
 const budget={bytes:0},old=await snapshots(db,'original',budget),shadow=await snapshots(rebuilt,'rebuilt',budget);
 const registry=at(old,'economy_config_registry'),known=new Map<string,EconomyConfig>();
 for(const r of registry){
  let c:EconomyConfig;try{const v=JSON.parse(r.config_json!);if(!Array.isArray(v)||v.length!==6)return fail('RECOVERY_REGISTRY_CONFLICT');c=await defineEconomyConfig({chainId:v[0],token:v[1],stakingContract:v[2],paymentContract:v[3],treasury:v[4],deploymentBlock:v[5],tokenDecimals:18,catalogue:[]});}catch{return fail('RECOVERY_REGISTRY_CONFLICT');}
  if(c.id!==r.config_id||String(c.chainId)!==r.chain_id||c.token!==r.token||c.stakingContract!==r.staking_contract||c.paymentContract!==r.payment_contract||c.treasury!==r.treasury)return fail('RECOVERY_REGISTRY_CONFLICT');known.set(c.id,c);
 }
 // A controlled pre-0013 export can lack a registry row for the source itself.
 // Its supplied config was independently canonicalized above. Do not infer
 // any other unregistered namespace from this one explicitly reviewed input.
 if(!known.has(from.id))known.set(from.id,from);
 const receipts=at(old,'economy_recoveries'),lineage=at(old,'economy_config_lineage');
 const verifiedReceipt=(r:Row|undefined)=>{
  if(!r)return null;let report:EconomyRecoveryReport;try{report=JSON.parse(r.report_json!);}catch{return null;}
  const x=known.get(r.from_config!),y=known.get(r.to_config!),s=at(old,'economy_chain_state').find(s=>s.config_id===r.from_config),b=report?.boundary;
  if(!x||!y||!s||domain(x)!==domain(y)||r.staking_key!==domain(x)||x.paymentContract!==y.paymentContract||x.treasury!==y.treasury||BigInt(y.deploymentBlock)>=BigInt(x.deploymentBlock)
   ||r.accepted!=='1'||report.fromConfig!==x.id||report.toConfig!==y.id||report.stakingKey!==r.staking_key||!b||!/^0x[0-9a-f]{64}$/.test(b.hash)||b.block!==s.last_block
   ||!Number.isSafeInteger(b.throughMs)||b.throughMs<0||String(report.horizonMs)!==r.horizon_ms||report.horizonMs!==Math.floor(b.throughMs/DAY)*DAY)return null;
  if(s.last_hash===''?b.mode!=='bootstrap-predecessor'||s.last_block!==String(BigInt(x.deploymentBlock)-1n)||s.through_ms!=='0':b.mode!=='matching-finalized'||b.hash!==s.last_hash||String(b.throughMs)!==s.through_ms)return null;
  return report;
 };
 const validAncestor=(ancestor:string,target:string,seen=new Set<string>()):boolean=>{
  if(seen.has(target)||seen.size>=RECOVERY_LIMITS.ancestors)return false;seen.add(target);
  const l=lineage.find(l=>l.ancestor_id===ancestor&&l.config_id===target),r=l&&receipts.find(r=>r.id===l.recovery_id);
  if(!r||r.to_config!==target||!verifiedReceipt(r))return false;
  return r.from_config===ancestor||validAncestor(ancestor,r.from_config!,seen);
 };
 const states=at(old,'economy_chain_state'),a=states.find(r=>r.config_id===from.id),b=at(shadow,'economy_chain_state').find(r=>r.config_id===to.id);
 if(!a||!b||(a.halted_reason&&a.halted_reason!==INVALID_POSITION_WITHDRAWAL)||b.halted_reason||!/^0x[0-9a-f]{64}$/.test(b.last_hash??''))return fail('RECOVERY_FINALIZED_BOUNDARY_MISMATCH');
 const bootstrap=a.halted_reason===INVALID_POSITION_WITHDRAWAL&&a.last_hash===''&&a.through_ms==='0'&&a.last_block===String(BigInt(from.deploymentBlock)-1n)
  &&b.last_block===a.last_block&&emptyBootstrap(old,from);
 if(!bootstrap&&(a.last_block!==b.last_block||a.last_hash!==b.last_hash||a.through_ms!==b.through_ms))return fail('RECOVERY_FINALIZED_BOUNDARY_MISMATCH');
 const links=lineage.filter(r=>r.config_id===from.id);if(links.some(l=>!validAncestor(l.ancestor_id!,from.id)))return fail('RECOVERY_AMBIGUOUS_HISTORY');
 const ancestors=new Set([from.id,...links.map(r=>r.ancestor_id!)]);
 // A failed staged fold may leave already committed proof pages. Preserve
 // those rows under their halted, then retired namespace; never import them
 // as finalized events or delete them to make a plan pass. Later recoveries
 // may retain the same forensic prefix under a reviewed ancestor.
 const retainedPending=(p:Row)=>{
  const s=states.find(r=>r.config_id===p.config_id),rows=at(old,'economy_staged_events').filter(r=>r.config_id===p.config_id).sort((x,y)=>Number(integer(x.ordinal)-integer(y.ordinal)));
  let predecessor=bootstrap&&p.config_id===from.id?b:s;
  if(s?.last_hash===''&&p.config_id!==from.id){
   const rs=receipts.filter(r=>r.from_config===p.config_id),report=rs.length===1?verifiedReceipt(rs[0]):null;
   predecessor=report&&validAncestor(p.config_id!,from.id)?{last_hash:report.boundary.hash,through_ms:String(report.boundary.throughMs)}:undefined;
  }
  return !!s&&!!predecessor&&ancestors.has(p.config_id!)&&s.halted_reason===INVALID_POSITION_WITHDRAWAL&&integer(p.block_number)===integer(s.last_block)+1n&&p.parent_hash===predecessor.last_hash&&clock(p.through_ms)>=clock(predecessor.through_ms)
   &&integer(p.next_offset)>0n&&integer(p.next_offset)<integer(p.total_logs)&&BigInt(rows.length)===integer(p.next_offset)
   &&rows.every((r,i)=>integer(r.ordinal)===BigInt(i));
 };
 if(states.some(r=>r.config_id===to.id)||at(old,'economy_pending_blocks').some(p=>{const c=known.get(p.config_id!);return !c||domain(c)===domain(from)&&!retainedPending(p);})||at(shadow,'economy_pending_blocks').length||at(shadow,'economy_chain_state').length!==1||at(shadow,'economy_recoveries').length||at(shadow,'economy_orders').length)return fail('RECOVERY_NOT_CLEAN');
 const horizon=Math.floor(clock(b.through_ms)/DAY)*DAY;
 if(!Number.isSafeInteger(nowMs)||nowMs<clock(b.through_ms))return fail('RECOVERY_INVALID_CLOCK');
 const binding=at(old,'economy_reward_bindings').find(r=>r.staking_key===domain(from));
 if(binding&&binding.config_id!==from.id)return fail('ECONOMY_CONFIG_CONFLICT');
 capacity('ancestors',ancestors.size);
 for(const c of known.values())if(domain(c)===domain(from)&&!ancestors.has(c.id)&&!emptySync(old,c))return fail('RECOVERY_AMBIGUOUS_HISTORY');
 for(const r of at(old,'economy_day_progress'))if(!ancestors.has(r.config_id!)){
  const c=known.get(r.config_id!),binding=c&&at(old,'economy_reward_bindings').find(b=>b.staking_key===domain(c));
  if(!c||domain(c)===domain(from)||!binding||binding.config_id!==c.id&&!validAncestor(c.id,binding.config_id!))return fail('RECOVERY_AMBIGUOUS_HISTORY');
 }
 const oldEvents=at(old,'economy_chain_events').filter(r=>r.config_id===from.id),events=at(shadow,'economy_chain_events');
 if(events.some(e=>e.config_id!==to.id))return fail('RECOVERY_EVENT_CONFLICT');
 for(const e of events){
  if(integer(e.block_number)<BigInt(to.deploymentBlock)||integer(e.block_number)>integer(b.last_block)||clock(e.at_ms)>clock(b.through_ms))return fail('RECOVERY_EVENT_CONFLICT');
  if(e.block_number===b.last_block&&(e.block_hash!==b.last_hash||e.at_ms!==b.through_ms))return fail('RECOVERY_EVENT_CONFLICT');
  const payload=JSON.parse(e.payload!) as Record<string,unknown>;
  const parsed=normalizedEvent(to,Object.fromEntries(Object.entries(payload).filter(([,v])=>v!==null)) as EconomyChainEvent);
  if(JSON.stringify(parsed)!==e.payload||Object.entries({kind:'kind',transactionHash:'tx_hash',logIndex:'log_index',blockNumber:'block_number',blockHash:'block_hash',timestamp:'at_ms',wallet:'wallet',amount:'amount',positionId:'position_id',shares:'shares',orderId:'order_id',token:'token',receiver:'receiver'}).some(([field,column])=>{const v=(parsed as unknown as Record<string,unknown>)[field];return (v===null?null:String(v))!==e[column];}))return fail('RECOVERY_EVENT_CONFLICT');
 }
 const proofs=new Map(events.map(e=>[`${e.tx_hash}:${e.log_index}`,e]));
 for(const e of oldEvents){const candidate=proofs.get(`${e.tx_hash}:${e.log_index}`);if(!candidate)return fail('RECOVERY_OLD_PROOF_MISSING');
  for(const p of ['kind','tx_hash','log_index','block_number','block_hash','at_ms','wallet','position_id','shares','amount','order_id','token','receiver','payload'])if(e[p]!==candidate[p])return fail('RECOVERY_OLD_PROOF_CHANGED');}
 const model=replay(events,horizon),previous=replay(oldEvents,horizon);
 let oldSettlementIncomplete=at(old,'economy_day_progress').some(r=>r.config_id===from.id&&r.completed!=='1');
 if(previous.firstDay!==null)for(let day=previous.firstDay;day<horizon;day+=DAY)if(!at(old,'economy_gold_days').some(r=>r.config_id===from.id&&r.day_start_ms===String(day)))oldSettlementIncomplete=true;
 // Under this one integrity halt, journals are the credited-so-far truth.
 // A partial wallet carry is not an issued journal. Preserve the old pages,
 // retire that namespace atomically, and close the rebuilt historical days
 // with only positive entitlement-minus-issued adjustments below.
 if(oldSettlementIncomplete&&a.halted_reason!==INVALID_POSITION_WITHDRAWAL)return fail('RECOVERY_SETTLEMENT_INCOMPLETE');
 if(at(shadow,'economy_day_progress').some(r=>r.completed!=='1'))return fail('RECOVERY_REBUILD_INCOMPLETE');
 if(model.firstDay!==null)for(let day=model.firstDay;day<horizon;day+=DAY)if(!at(shadow,'economy_gold_days').some(r=>r.config_id===to.id&&r.day_start_ms===String(day)))return fail('RECOVERY_REBUILD_INCOMPLETE');
 const journal=at(old,'economy_gold_journal'),adjusted=new Set(at(old,'economy_gold_adjustments').map(r=>r.journal_id));
 const paid=new Map<string,bigint>();
 for(const j of journal){
  if(j.kind!=='utc-reward'||adjusted.has(j.id))continue;
  const match=/^([0-9a-f]{64}):(\d+):(0x[0-9a-f]{40})$/.exec(j.reference??'');
  if(!match)return fail('RECOVERY_JOURNAL_CONFLICT');
  if(ancestors.has(match[1])){if(j.wallet!==match[3]||BigInt(j.delta!)<=0n||!Number.isSafeInteger(Number(match[2]))||Number(match[2])%DAY!==0)return fail('RECOVERY_JOURNAL_CONFLICT');const k=key(Number(match[2]),match[3]);paid.set(k,(paid.get(k)??0n)+BigInt(j.delta!));}
 }
 for(const j of at(old,'economy_gold_adjustments'))if(j.staking_key===domain(from)){const k=key(clock(j.day_start_ms),j.wallet!);paid.set(k,(paid.get(k)??0n)+integer(j.delta));}
 // Owed is not issued/book GOLD, but it is already a durable day entitlement.
 // Preserve its original namespace and include it in correction arithmetic so
 // recovery cannot issue the same share-day again while a retry is pending.
 const owed=new Map<string,bigint>();
 for(const r of old.find(s=>s.table==='economy_gold_reward_entitlements')?.rows??[]){
  const j=journal.find(j=>j.id===r.id);
  if(r.settled_ms!==null){if(!j||j.wallet!==r.wallet||j.reference!==r.reference||j.delta!==r.delta)return fail('RECOVERY_REWARD_ENTITLEMENT_CONFLICT');continue;}
  if(j)return fail('RECOVERY_REWARD_ENTITLEMENT_CONFLICT');
  if(ancestors.has(r.config_id!)){const k=key(clock(r.day_start_ms),r.wallet!);owed.set(k,(owed.get(k)??0n)+integer(r.delta));}
 }
 const sharedEntries=old.find(s=>s.table==='world_gold_entries')?.rows??[];
 const totals=new Map<string,bigint>();for(const j of [...journal,...sharedEntries])totals.set(j.wallet!,(totals.get(j.wallet!)??0n)+BigInt(j.delta!));
 for(const account of at(old,'economy_gold_accounts')){if(BigInt(account.balance!)!==(totals.get(account.wallet!)??0n))return fail('RECOVERY_BALANCE_JOURNAL_MISMATCH');totals.delete(account.wallet!);}
 if([...totals.values()].some(n=>n!==0n))return fail('RECOVERY_BALANCE_JOURNAL_MISMATCH');
 const adjustments:EconomyRecoveryReport['adjustments']=[];
 for(const k of new Set([...model.rewards.keys(),...paid.keys(),...owed.keys()])){
  const entitlement=model.rewards.get(k)??0n,credited=paid.get(k)??0n,pending=owed.get(k)??0n;
  if(credited+pending>entitlement)return fail('RECOVERY_OVERISSUANCE_REQUIRES_REVIEW');
  if(entitlement>credited+pending){const split=k.indexOf(':'),day=Number(k.slice(0,split)),wallet=k.slice(split+1);adjustments.push({day,wallet,creditedBefore:String(credited),...pending?{owedBefore:String(pending)}:{},entitlement:String(entitlement),delta:String(entitlement-credited-pending)});}
 }
 adjustments.sort((a,b)=>a.day-b.day||a.wallet.localeCompare(b.wallet));
 const walletDeltas=new Map<string,bigint>();for(const r of adjustments)walletDeltas.set(r.wallet,(walletDeltas.get(r.wallet)??0n)+BigInt(r.delta));
 for(const [wallet,delta]of walletDeltas){const current=at(old,'economy_gold_accounts').find(r=>r.wallet===wallet);if(BigInt(current?.balance??'0')+delta>ECONOMY_MAX_INTEGER)return fail('GOLD_INTEGER_LIMIT');}
 const report:EconomyRecoveryReport={fromConfig:from.id,toConfig:to.id,stakingKey:domain(from),horizonMs:horizon,eventCount:events.length,boundary:{mode:bootstrap?'bootstrap-predecessor':'matching-finalized',block:b.last_block!,hash:b.last_hash!,throughMs:clock(b.through_ms)},oldSettlementIncomplete,pendingRewardsAccounted:true,adjustments,totalDelta:String(adjustments.reduce((n,r)=>n+BigInt(r.delta),0n)),preservesSpentGold:true,paymentContractChanged:false,oldHistoryPreserved:true,limits:RECOVERY_LIMITS};
 const guardChunks=old.flatMap(s=>s.chunks),guardParameters=7+guardChunks.length;capacity('guardParameters',guardParameters);
 report.capacity={snapshotBytes:budget.bytes,guardParameters,tables:[...old.map(s=>({side:'original',...s})),...shadow.map(s=>({side:'rebuilt',...s}))].map(s=>({side:s.side,table:s.table,rows:s.rows.length,pages:s.chunks.length,bytes:s.chunks.reduce((n,c)=>n+encode(c.json),0)}))};
 const reportJson=()=>JSON.stringify(report);
 const statements:D1PreparedStatement[]=[];
 let hash='';
 // Compare every original financial table INSIDE the transaction. An in-flight
 // spend/indexer/page/disposition after planning must abort the entire batch.
 // Placeholder receipt is bound after all bounded statements have been built.
 const guardSql=`INSERT INTO economy_recoveries(id,staking_key,from_config,to_config,horizon_ms,applied_ms,report_json,accepted) SELECT ?,?,?,?,?,?,?,CASE WHEN ${old.map(s=>`(SELECT COUNT(*) FROM ${s.table})=${s.rows.length}`).concat(guardChunks.map(c=>`(${c.query})=?`)).join(' AND ')} THEN 1 ELSE 0 END`;
 // Freeze plan identity before IDs used by the remaining statements are derived.
 hash=await economyDigest(JSON.stringify(['historical-recovery-v2',from.id,to.id,nowMs,old.map(s=>[s.table,s.chunks.map(c=>c.json)]),shadow.map(s=>[s.table,s.chunks.map(c=>c.json)]),report]));
 statements.push(db.prepare(guardSql));
 statements.push(economyConfigStatement(db,from),economyConfigStatement(db,to));
 for(const ancestor of ancestors)statements.push(db.prepare('INSERT INTO economy_config_lineage(ancestor_id,config_id,recovery_id) VALUES(?,?,?)').bind(ancestor,to.id,hash));
 statements.push(db.prepare('INSERT INTO economy_reward_bindings(staking_key,config_id) VALUES(?,?) ON CONFLICT(staking_key) DO UPDATE SET config_id=excluded.config_id').bind(domain(from),to.id));
 function bulk(table:string,columns:string[],rows:Cell[][],order=''){
  if(!rows.length)return;
  let chunk:Cell[][]=[],size=2;
  const flush=()=>{if(chunk.length)statements.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?) ${order}`).bind(JSON.stringify(chunk)));chunk=[];size=2;};
  for(const row of rows){const bytes=encode(JSON.stringify(row));capacity('boundValueBytes',bytes+2,{table});if(size+bytes+(chunk.length?1:0)>RECOVERY_LIMITS.boundValueBytes)flush();size+=bytes+(chunk.length?1:0);chunk.push(row);}flush();
 }
 for(const name of ['economy_chain_state','economy_ingestions','economy_chain_events']){
  const source=shadow.find(s=>s.table===name)!;
  if(name==='economy_chain_events')source.rows.sort((a,b)=>integer(a.block_number)<integer(b.block_number)?-1:integer(a.block_number)>integer(b.block_number)?1:Number(integer(a.log_index)-integer(b.log_index)));
  bulk(name,source.columns,source.rows.map(r=>source.columns.map(c=>r[c])),name==='economy_chain_events'?`ORDER BY CAST(json_extract(value,'$[${source.columns.indexOf('block_number')}]') AS INTEGER),CAST(json_extract(value,'$[${source.columns.indexOf('log_index')}]') AS INTEGER)`:'');
 }
 const dayRows:Cell[][]=[],progressRows:Cell[][]=[];
 const ceiling=events.filter(r=>r.kind==='stake').reduce((m,r)=>integer(r.position_id)>BigInt(m)?r.position_id!:m,'0').padStart(78,'0');
 if(model.firstDay!==null)for(let day=model.firstDay;day<horizon;day+=DAY){dayRows.push([to.id,String(day),String(nowMs),'1']);progressRows.push([to.id,String(day),ceiling,'1']);}
 bulk('economy_gold_days',['config_id','day_start_ms','completed_ms','accepted'],dayRows);
 bulk('economy_day_progress',['config_id','day_start_ms','position_ceiling','completed'],progressRows);
 const credits:Cell[][]=[],adjustmentRows:Cell[][]=[];
 for(const r of adjustments){const identity=await economyDigest(JSON.stringify([hash,r.day,r.wallet])),id='adjust:'+identity;
  credits.push([id,r.wallet,r.delta,'utc-reward','adjustment:'+identity,String(nowMs)]);
  adjustmentRows.push([id,hash,domain(from),String(r.day),r.wallet,r.creditedBefore,r.entitlement,r.delta]);}
 bulk('economy_gold_journal',['id','wallet','delta','kind','reference','created_ms'],credits);
 bulk('economy_gold_adjustments',['journal_id','recovery_id','staking_key','day_start_ms','wallet','credited_before','entitlement','delta'],adjustmentRows);
 // Original immutable quotes are not changed. Same-contract late payments can
 // match their reviewed ancestors; a payment-contract change is rejected above.
 statements.push(db.prepare(`UPDATE economy_orders SET status='paid',paid_ms=(SELECT e.at_ms FROM economy_chain_events e WHERE e.config_id=? AND e.kind='payment' AND e.order_id=economy_orders.id AND e.wallet=economy_orders.wallet AND e.amount=economy_orders.amount ORDER BY e.block_number,e.log_index LIMIT 1),paid_event_id=(SELECT e.id FROM economy_chain_events e WHERE e.config_id=? AND e.kind='payment' AND e.order_id=economy_orders.id AND e.wallet=economy_orders.wallet AND e.amount=economy_orders.amount ORDER BY e.block_number,e.log_index LIMIT 1) WHERE (config_id=? OR config_id IN(SELECT ancestor_id FROM economy_config_lineage WHERE config_id=?)) AND currency='EMBEO' AND status='pending' AND EXISTS(SELECT 1 FROM economy_chain_events e WHERE e.config_id=? AND e.kind='payment' AND e.order_id=economy_orders.id AND e.wallet=economy_orders.wallet AND e.amount=economy_orders.amount)`).bind(to.id,to.id,to.id,to.id,to.id));
 statements.push(economyPaymentEvidenceStatement(db,to,{from:to.deploymentBlock,to:String(a.last_block)}));
 capacity('statements',statements.length);capacity('boundValueBytes',encode(reportJson()),{table:'economy_recoveries'});
 statements[0]=db.prepare(guardSql).bind(hash,domain(from),from.id,to.id,horizon,nowMs,reportJson(),...guardChunks.map(c=>c.json));
 return {plan:{hash,report} satisfies EconomyRecoveryPlan,statements};
}
export async function prepareEconomyRecovery(db:D1Database,rebuilt:D1Database,from:EconomyConfig,to:EconomyConfig,{nowMs}:{nowMs:number}):Promise<EconomyRecoveryPlan>{return (await build(db,rebuilt,from,to,nowMs)).plan;}
/** Read-only diagnostic: uses the exact planner and all its real limits. */
export async function preflightEconomyRecovery(db:D1Database,rebuilt:D1Database,from:EconomyConfig,to:EconomyConfig,options:{nowMs:number}){
 try{const built=await build(db,rebuilt,from,to,options.nowMs);return {status:'ready' as const,plan:built.plan,statements:built.statements.length};}
 catch(error){if(error instanceof RecoveryCapacityError)return {status:'blocked' as const,capacityFailure:error.details,limits:RECOVERY_LIMITS};throw error;}
}
export async function applyEconomyRecovery(db:D1Database,rebuilt:D1Database,from:EconomyConfig,to:EconomyConfig,{nowMs,expectedPlanHash}:{nowMs:number;expectedPlanHash:string}){
 if(! /^[0-9a-f]{64}$/.test(expectedPlanHash))return fail('RECOVERY_PLAN_REQUIRED');
 const prior=await db.prepare('SELECT from_config fromConfig,to_config toConfig,report_json report FROM economy_recoveries WHERE id=?').bind(expectedPlanHash).first<{fromConfig:string;toConfig:string;report:string}>();
 if(prior){if(prior.fromConfig!==from.id||prior.toConfig!==to.id)return fail('RECOVERY_PLAN_CONFLICT');return {hash:expectedPlanHash,report:JSON.parse(prior.report) as EconomyRecoveryReport,replayed:true};}
 const built=await build(db,rebuilt,from,to,nowMs);if(built.plan.hash!==expectedPlanHash)return fail('RECOVERY_PLAN_CHANGED');
 try{await db.batch(built.statements);}catch(error){
  const complete=await db.prepare('SELECT id FROM economy_recoveries WHERE id=?').bind(expectedPlanHash).first();
  if(complete)return {hash:expectedPlanHash,report:built.plan.report,replayed:true};throw error;
 }
 return {...built.plan,replayed:false};
}
