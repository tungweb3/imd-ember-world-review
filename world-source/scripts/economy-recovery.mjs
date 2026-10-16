// Local controlled-maintenance tool. Node24; SQLite copies only. No HTTP/RPC,
// credential loading, wallet, remote D1 command or deployment is implemented.
import {DatabaseSync,backup} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {defineEconomyConfig} from '../server/economy-config.ts';
import {prepareEconomyRecovery,applyEconomyRecovery} from '../server/economy-recovery.ts';
import {reconcileEconomyPayments,recordEconomyPaymentDisposition} from '../server/economy-reconciliation.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const write=(p,x)=>writeFileSync(p,JSON.stringify(x,null,2)+'\n',{flag:'wx'});
export function openEconomySqlite(path,{readOnly=false,trace=[]}={}){
 const raw=new DatabaseSync(path,{readOnly});raw.exec('PRAGMA foreign_keys=ON');
 const exec=(sql,args,first=false)=>{
  const statement=raw.prepare(sql);statement.setReadBigInts(true);
  const normalize=row=>row?Object.fromEntries(Object.entries(row).map(([k,v])=>{if(typeof v==='bigint'){if(v>BigInt(Number.MAX_SAFE_INTEGER)||v<BigInt(Number.MIN_SAFE_INTEGER))throw Error('UNCAST_SQLITE_INTEGER');v=Number(v);}return [k,v];})):null;
  if(/^\s*(select|with)\b/i.test(sql)||/\breturning\b/i.test(sql))return first?normalize(statement.get(...args)):{results:statement.all(...args).map(normalize),success:true,meta:{}};
  const value=statement.run(...args);return {results:[],success:true,meta:{changes:Number(value.changes)}};
 };
 const prepare=(sql,args=[])=>({sql,args,bind:(...values)=>prepare(sql,values),first:async()=>exec(sql,args,true),all:async()=>exec(sql,args),run:async()=>exec(sql,args)});
 return {raw,prepare,batch:async statements=>{
  raw.exec('BEGIN');try{const result=statements.map(s=>exec(s.sql,s.args));raw.exec('COMMIT');trace.push(statements.map(s=>({sql:s.sql,params:s.args})));return result;}catch(error){raw.exec('ROLLBACK');throw error;}
 }};
}
export async function runEconomyRecoveryTool(argv){
 if(Number(process.versions.node.split('.')[0])!==24)throw Error('NODE24_REQUIRED');
 const [command,...flags]=argv,options={};
 if(!['migrate-copy','plan','stage','reconcile-copy','disposition-copy','cases'].includes(command))throw Error('COMMAND_REQUIRED');
 const allowed=new Set(['original','rebuilt','from-config','to-config','now-ms','out','expected-plan','case','request','action','note-file']);
 for(let i=0;i<flags.length;i+=2){const key=flags[i]?.slice(2);if(!flags[i]?.startsWith('--')||!allowed.has(key)||options[key]!==undefined||typeof flags[i+1]!=='string')throw Error('INVALID_ARGUMENTS');options[key]=flags[i+1];}
 const original=resolve(options.original??''),source=lstatSync(original);if(!options.original||!source.isFile()||source.isSymbolicLink()||realpathSync(original).toLowerCase()!==original.toLowerCase())throw Error('REGULAR_SOURCE_REQUIRED');
 if(existsSync(original+'-wal'))throw Error('CHECKPOINTED_OFFLINE_EXPORT_REQUIRED');
 const originalSha=sha(readFileSync(original)),out=resolve(options.out??'');
 if(!options.out||existsSync(out)||!existsSync(dirname(out)))throw Error('FRESH_OUTPUT_DIRECTORY_REQUIRED');mkdirSync(out);
 const manifest={schema:'imd.world.local-recovery-tool/v1',command,started:new Date().toISOString(),originalSha256:originalSha,remoteDatabaseUsed:false,originalModified:false,publicChainWrites:false,privateOutput:true};
 let db,rebuilt,sourceRead;const trace=[];
 try{
  const read=sourceRead=openEconomySqlite(original,{readOnly:true});
  if(read.raw.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SOURCE_INTEGRITY_FAILED');
  if(command==='plan'||command==='cases')db=read;
  else{const filename=join(out,'database.private.sqlite');await backup(read.raw,filename);read.raw.close();sourceRead=null;db=openEconomySqlite(filename,{trace});manifest.stagedDatabase=filename;}
  if(command==='migrate-copy'){
   if(!db.raw.prepare("SELECT name FROM sqlite_schema WHERE name='economy_gold_journal'").get())throw Error('EXISTING_ECONOMY_SCHEMA_REQUIRED');
   db.raw.exec('BEGIN');try{
    if(!db.raw.prepare("SELECT name FROM sqlite_schema WHERE name='economy_reward_bindings'").get())db.raw.exec(readFileSync(new URL('../migrations/0012_economy_reward_bindings.sql',import.meta.url),'utf8'));
    if(!db.raw.prepare("SELECT name FROM sqlite_schema WHERE name='economy_config_registry'").get())db.raw.exec(readFileSync(new URL('../migrations/0013_economy_reconciliation.sql',import.meta.url),'utf8'));
    db.raw.exec('COMMIT');
   }catch(error){db.raw.exec('ROLLBACK');throw error;}
  }else if(command==='cases'){
   const rows=db.raw.prepare('SELECT * FROM economy_payment_cases ORDER BY at_ms,event_id LIMIT 501').all();
   if(rows.length>500)throw Error('CASE_EXPORT_REQUIRES_PAGING');
   const actions=db.raw.prepare('SELECT * FROM economy_payment_case_actions ORDER BY created_ms,id').all();
   write(join(out,'payment-cases.private.json'),{cases:rows,actions,policy:'No automatic refund or transfer. No-entitlement disposition does not prove a treasury refund.'});manifest.cases=rows.length;
  }else{
   const from=await defineEconomyConfig(readJson(options['from-config'])),nowMs=Number(options['now-ms']);
   if(!Number.isSafeInteger(nowMs)||nowMs<0)throw Error('EXPLICIT_CLOCK_REQUIRED');
   if(command==='reconcile-copy'){
    let result;for(let page=0;page<32;page++){result=await reconcileEconomyPayments(db,from);if(!result.remaining)break;}
    if(result.remaining)throw Error('RECONCILIATION_REQUIRES_MORE_PAGES');manifest.remaining=0;
   }else if(command==='disposition-copy'){
    const result=await recordEconomyPaymentDisposition(db,{eventId:options.case,requestId:options.request,action:options.action,note:readFileSync(options['note-file'],'utf8').trim(),nowMs});
    manifest.dispositionId=result.id;
   }else{
    const to=await defineEconomyConfig(readJson(options['to-config'])),rebuiltPath=resolve(options.rebuilt??'');
    if(!options.rebuilt||rebuiltPath===original||existsSync(rebuiltPath+'-wal')||lstatSync(rebuiltPath).isSymbolicLink())throw Error('OFFLINE_REBUILT_EXPORT_REQUIRED');
    manifest.rebuiltSha256=sha(readFileSync(rebuiltPath));rebuilt=openEconomySqlite(rebuiltPath,{readOnly:true});
    const result=command==='plan'?await prepareEconomyRecovery(db,rebuilt,from,to,{nowMs}):await applyEconomyRecovery(db,rebuilt,from,to,{nowMs,expectedPlanHash:options['expected-plan']??''});
    write(join(out,'recovery-plan.private.json'),result);manifest.planHash=result.hash;manifest.totalDelta=result.report.totalDelta;manifest.adjustments=result.report.adjustments.length;
    if(sha(readFileSync(rebuiltPath))!==manifest.rebuiltSha256)throw Error('REBUILT_SOURCE_CHANGED');
   }
  }
  if(trace.length)write(join(out,'migration-batch.private.json'),{scope:'INTERNAL_REVIEWED_D1_BATCH_ONLY; NEVER_UPLOAD_WITH_PUBLIC_AUDIT',batches:trace});
  if(db.raw.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('STAGED_INTEGRITY_FAILED');
  manifest.status='PASS';
 }catch(error){manifest.status='FAIL';manifest.error=String(error);throw error;}
 finally{db?.raw.close();if(sourceRead&&sourceRead!==db)sourceRead.raw.close();rebuilt?.raw.close();manifest.finished=new Date().toISOString();manifest.originalModified=sha(readFileSync(original))!==originalSha;write(join(out,'receipt.private.json'),manifest);if(manifest.originalModified)throw Error('ORIGINAL_SOURCE_CHANGED');}
 console.log(JSON.stringify({status:manifest.status,command,planHash:manifest.planHash,totalDelta:manifest.totalDelta,cases:manifest.cases,originalModified:false,remoteDatabaseUsed:false,publicChainWrites:false}));return manifest;
}
if(process.argv[1]&&resolve(process.argv[1]).toLowerCase()===fileURLToPath(import.meta.url).toLowerCase())await runEconomyRecoveryTool(process.argv.slice(2));
