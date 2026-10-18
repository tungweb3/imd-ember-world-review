import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy,createEconomyOrder,economyWalletSnapshot} from '../server/economy-ledger.ts';
import {stageEconomyBlock,pendingEconomyBlock} from '../server/economy-staging.ts';
import * as recovery from '../server/economy-recovery.ts';
import {backup} from 'node:sqlite';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {runEconomyRecoveryTool} from '../scripts/economy-recovery.mjs';
const {prepareEconomyRecovery:prepare,applyEconomyRecovery:apply}=recovery;
const T=Date.UTC(2026,9,1),W='0x'+'a'.repeat(40),H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const cfg=patch=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'audit-local',titleZh:'本機測試',titleEn:'Local test',gold:'1',embeo:String(10n**18n)}],...patch});
const stake=(id,block=100,time=T,shares=1,wallet=W,logIndex=0)=>({kind:'stake',transactionHash:H(1000+id),logIndex,blockNumber:String(block),blockHash:H(block),timestamp:time,wallet,positionId:String(id),shares:String(shares),amount:String(SHARE*BigInt(shares))});
const bad=(block=102,time=T+DAY+1000)=>({...stake(1,block,time),kind:'withdraw',transactionHash:H(99999)});
const ingest=(db,c,events,from=102,to=from,through=T+DAY+1000)=>ingestEconomyEvents(db,c,{fromBlock:String(from),toBlock:String(to),toBlockHash:H(to),throughTimestamp:through,events});
const stage=(db,c,events,offset,totalLogs,block=102,time=T+DAY+1000)=>stageEconomyBlock(db,c,{number:String(block),hash:H(block),parentHash:H(block-1),throughMs:time,totalLogs,digest:'d'.repeat(64),offset,events});
const rows=(db,t)=>db.raw.prepare('SELECT * FROM '+t+' ORDER BY rowid').all();
const dump=db=>JSON.stringify(db.raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE 'economy_%' ORDER BY name").all().map(({name})=>[name,rows(db,name)]));
const sum=db=>Number(db.raw.prepare('SELECT COALESCE(SUM(balance),0) n FROM economy_gold_accounts').get().n);
async function complete(db,c,time=T+DAY){for(let i=0;i<128;i++){const r=await settleEconomy(db,c,{nowMs:time});if(r.settledDays)break;}}
async function fixture({db=openD1(),patch={},count=1}={}){
 const shadow=openD1(),c=await cfg(patch),next=await cfg({...patch,deploymentBlock:'99'});
 const events=Array.from({length:count},(_,i)=>stake(i+2,100,T,1,count===1?W:'0x'+BigInt(i+1).toString(16).padStart(40,'0'),i));
 await ingest(db,c,events,100,101,T+DAY);await complete(db,c);
 await assert.rejects(ingest(db,c,[bad()]),/ECONOMY_HALTED/);
 await ingest(shadow,next,[stake(1,99,T,2),...events],99,101,T+DAY);await complete(shadow,next);
 return {db,shadow,c,next,events,nowMs:T+DAY+1001,close(){db.raw.close();shadow.raw.close();}};
}
async function recover(f){const p=await prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});await apply(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs,expectedPlanHash:p.hash});return p;}
async function twicePrefix(){
 const db=openD1(),shadow=openD1(),third=openD1(),c=await cfg(),next=await cfg({deploymentBlock:'99'}),earlier=await cfg({deploymentBlock:'98'});
 await stage(db,c,[bad(100,T+DAY+1000)],0,2,100);
 // A second real log completes the invalid fold and leaves the committed prefix.
 await assert.rejects(stage(db,c,[stake(90,100,T+DAY+1000,1,W,1)],1,2,100),/ECONOMY_HALTED/);
 await ingest(shadow,next,[stake(1,99,T,2)],99,99,T);
 const p=await prepare(db,shadow,c,next,{nowMs:T+DAY+1001});await apply(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:p.hash});
 await ingest(db,next,[bad(100,T+DAY+1000),stake(90,100,T+DAY+1000,1,W,1)],100,100,T+DAY+1000);
 await ingest(db,next,[],101,101,T+DAY+2000);await complete(db,next,T+DAY+2000);
 await ingest(third,earlier,[stake(70,98,T),stake(1,99,T,2)],98,99,T);
 await ingest(third,earlier,[bad(100,T+DAY+1000),stake(90,100,T+DAY+1000,1,W,1)],100,100,T+DAY+1000);
 await ingest(third,earlier,[],101,101,T+DAY+2000);await complete(third,earlier,T+DAY+2000);
 return {db,third,c,next,earlier,p,nowMs:T+DAY+2002,close(){db.raw.close();shadow.raw.close();third.raw.close();}};
}
test('Audit4 C01 C04 compatibility: reviewed source without a legacy registry row still retains its bootstrap prefix',async()=>{
 const db=openD1(),shadow=openD1(),c=await cfg(),next=await cfg({deploymentBlock:'99'});try{
  await stage(db,c,[bad(100,T+DAY+1000)],0,2,100);
  await assert.rejects(stage(db,c,[stake(90,100,T+DAY+1000,1,W,1)],1,2,100),/ECONOMY_HALTED/);
  // Simulate the registry state immediately after upgrading a pre-0013 export.
  // Ordinary current-source writes can never delete this protected row.
  db.raw.exec('DROP TRIGGER economy_registry_no_delete');db.raw.prepare('DELETE FROM economy_config_registry WHERE config_id=?').run(c.id);
  const prefix=await pendingEconomyBlock(db,c);await ingest(shadow,next,[stake(1,99,T,2)],99,99,T);
  const p=await prepare(db,shadow,c,next,{nowMs:T+DAY+1001});await apply(db,shadow,c,next,{nowMs:T+DAY+1001,expectedPlanHash:p.hash});
  assert.deepEqual(await pendingEconomyBlock(db,c),prefix);assert.ok(db.raw.prepare('SELECT config_id FROM economy_config_registry WHERE config_id=?').get(c.id));assert.equal(sum(db),0);
 }finally{db.raw.close();shadow.raw.close();}
});

test('Audit4 C01: retained bootstrap prefix survives a second recovery, replay and future settlement',async()=>{
 const f=await twicePrefix();try{
  const prefix=await pendingEconomyBlock(f.db,f.c),journal=rows(f.db,'economy_gold_journal');
  const p=await prepare(f.db,f.third,f.next,f.earlier,{nowMs:f.nowMs});assert.equal(p.report.totalDelta,'1');
  await apply(f.db,f.third,f.next,f.earlier,{nowMs:f.nowMs,expectedPlanHash:p.hash});assert.equal(sum(f.db),3);
  assert.deepEqual(await pendingEconomyBlock(f.db,f.c),prefix);
  for(const j of journal)assert.deepEqual(f.db.raw.prepare('SELECT * FROM economy_gold_journal WHERE id=?').get(j.id),j);
  const after=dump(f.db);assert.equal((await apply(f.db,f.third,f.next,f.earlier,{nowMs:f.nowMs,expectedPlanHash:p.hash})).replayed,true);assert.equal(dump(f.db),after);
  await ingest(f.db,f.earlier,[],102,102,T+2*DAY);await complete(f.db,f.earlier,T+2*DAY);assert.equal(sum(f.db),5);
 }finally{f.close();}
});
for(const kind of ['hash','domain','from','missing'])test('Audit4 C01 negative: reject corrupted ancestor receipt '+kind+' without writes',async()=>{
 const f=await twicePrefix();try{
  f.db.raw.exec('DROP TRIGGER economy_recovery_no_change');
  const r=JSON.parse(f.db.raw.prepare('SELECT report_json FROM economy_recoveries WHERE id=?').get(f.p.hash).report_json);
  if(kind==='hash')r.boundary.hash=H(555);if(kind==='domain')r.stakingKey='1:wrong:vault';if(kind==='from')r.fromConfig='f'.repeat(64);if(kind==='missing')r.boundary=null;
  f.db.raw.prepare('UPDATE economy_recoveries SET report_json=? WHERE id=?').run(JSON.stringify(r),f.p.hash);
  const before=dump(f.db);await assert.rejects(prepare(f.db,f.third,f.next,f.earlier,{nowMs:f.nowMs}),/RECOVERY_/);assert.equal(dump(f.db),before);
 }finally{f.close();}
});
test('Audit4 C02: 600 finalized events use paged snapshots and bounded imports, then apply atomically',async()=>{
 const f=await fixture({count:600});try{
  const p=await prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});assert.equal(p.report.eventCount,601);assert.equal(p.report.totalDelta,'2');
  const batches=[],wrap={...f.db,batch:async s=>{batches.push(s);return f.db.batch(s);}};
  await apply(wrap,f.shadow,f.c,f.next,{nowMs:f.nowMs,expectedPlanHash:p.hash});assert.equal(sum(f.db),602);assert.equal(batches.length,1);
  for(const s of batches[0]){assert.ok(s.args.length<=100);for(const v of s.args)if(typeof v==='string')assert.ok(Buffer.byteLength(v)<=524288);}
 }finally{f.close();}
});
for(const mode of ['retired','healthy-prefix','halted-prefix'])test('Audit4 C03 C04: unrelated vault '+mode+' does not block or change during recovery',async()=>{
 const f=await fixture(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});let bs;try{
  if(mode==='retired'){
   const b=await fixture({db:f.db,patch:{stakingContract:other.stakingContract}});bs=b.shadow;await recover(b);
  }else{
   await ingest(f.db,other,[],100,101,T+DAY);
   await stage(f.db,other,mode==='healthy-prefix'?[stake(88,102,T+DAY+1000)]:[bad()],0,2);
   if(mode==='halted-prefix')await assert.rejects(stage(f.db,other,[stake(90,102,T+DAY+1000,1,W,1)],1,2),/ECONOMY_HALTED/);
  }
  const foreign=()=>JSON.stringify(['economy_chain_state','economy_pending_blocks','economy_staged_events','economy_day_progress'].map(t=>[t,rows(f.db,t).filter(r=>r.config_id!==f.c.id&&r.config_id!==f.next.id)]));
  const before=foreign();await recover(f);assert.equal(foreign(),before);assert.equal((await economyWalletSnapshot(f.db,f.next,W)).gold,mode==='retired'?'6':'3');
 }finally{bs?.raw.close();f.close();}
});
test('Audit4 C04: foreign staging change at final batch invalidates the plan and rolls back all recovery writes',async()=>{
 const f=await fixture(),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
  await ingest(f.db,other,[],100,101,T+DAY);const p=await prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});let after;
  const race={...f.db,batch:async s=>{await stage(f.db,other,[stake(88,102,T+DAY+1000)],0,2);after=dump(f.db);return f.db.batch(s);}};
  await assert.rejects(apply(race,f.shadow,f.c,f.next,{nowMs:f.nowMs,expectedPlanHash:p.hash}),/constraint|CHECK/i);assert.equal(dump(f.db),after);
 }finally{f.close();}
});
test('Audit4 C03 negative: foreign retired progress requires coherent receipt lineage, not merely a retired label',async()=>{
 const f=await fixture();let b;try{
  b=await fixture({db:f.db,patch:{stakingContract:'0x'+'4'.repeat(40)}});const p=await recover(b);
  f.db.raw.exec('DROP TRIGGER economy_recovery_no_change');const report=JSON.parse(f.db.raw.prepare('SELECT report_json FROM economy_recoveries WHERE id=?').get(p.hash).report_json);report.stakingKey='1:wrong:vault';
  f.db.raw.prepare('UPDATE economy_recoveries SET report_json=? WHERE id=?').run(JSON.stringify(report),p.hash);
  const before=dump(f.db);await assert.rejects(prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs}),/RECOVERY_AMBIGUOUS_HISTORY/);assert.equal(dump(f.db),before);
 }finally{b?.shadow.raw.close();f.close();}
});
test('Audit4 C05: accepted empty same-vault sync remains preserved and no longer blocks recovery',async()=>{
 const f=await fixture(),stray=await cfg({deploymentBlock:'150'});try{
  await ingest(f.db,stray,[],150,150,T+DAY+5000);const before=rows(f.db,'economy_chain_state').find(r=>r.config_id===stray.id);
  await recover(f);assert.deepEqual(rows(f.db,'economy_chain_state').find(r=>r.config_id===stray.id),before);assert.equal(sum(f.db),3);
 }finally{f.close();}
});
for(const footprint of ['event','order','progress','pending'])test('Audit4 C05 negative: same-vault '+footprint+' is not treated as an empty sync',async()=>{
 const f=await fixture(),stray=await cfg({deploymentBlock:'150'});try{
  await ingest(f.db,stray,footprint==='event'?[stake(80,150,T+DAY+5000)]:[],150,150,T+DAY+5000);
  if(footprint==='order')await createEconomyOrder(f.db,stray,{wallet:W,requestId:'audit4-stray-order-001',serviceId:'audit-local',currency:'EMBEO',nowMs:T+DAY+5001});
  // Defensive legacy/corrupt-backup input; current live writes already reject
  // unbound progress. The planner must not call such input an empty sync.
  if(footprint==='progress'){f.db.raw.exec('DROP TRIGGER economy_reward_progress_binding');f.db.raw.prepare('INSERT INTO economy_day_progress(config_id,day_start_ms,position_ceiling) VALUES(?,?,?)').run(stray.id,T,'');}
  if(footprint==='pending')await stage(f.db,stray,[stake(81,151,T+DAY+5001)],0,2,151,T+DAY+5001);
  const before=dump(f.db);await assert.rejects(prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs}),/RECOVERY_|ECONOMY_CONFIG_CONFLICT/);assert.equal(dump(f.db),before);
 }finally{f.close();}
});
test('Audit4 C02: capacity preflight explains oversize values without changing either input',async()=>{
 const f=await fixture();try{
  f.db.raw.prepare('INSERT INTO economy_stage_batches(id,accepted) VALUES(?,1)').run('x'.repeat(524288));
  const before=dump(f.db),shadow=dump(f.shadow);assert.equal(typeof recovery.preflightEconomyRecovery,'function');
  const result=await recovery.preflightEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});assert.equal(result.status,'blocked');
  assert.equal(result.capacityFailure.table,'economy_stage_batches');assert.equal(result.capacityFailure.metric,'boundValueBytes');
  assert.equal(dump(f.db),before);assert.equal(dump(f.shadow),shadow);
 }finally{f.close();}
});
for(const excess of [0,1])test('Audit4 C02: exact UTF8 snapshot bound '+(excess?'plus one is refused':'is accepted'),async()=>{
 const f=await fixture();try{
  const q=`SELECT COALESCE(json_group_array(row),'[]') value FROM (SELECT json_array(CAST(id AS TEXT),CAST(accepted AS TEXT)) row FROM economy_stage_batches ORDER BY row LIMIT 128 OFFSET 0)`;
  f.db.raw.prepare('INSERT INTO economy_stage_batches(id,accepted) VALUES(?,1)').run('x');
  const overhead=Buffer.byteLength(f.db.raw.prepare(q).get().value)-1;
  f.db.raw.exec('DELETE FROM economy_stage_batches');f.db.raw.prepare('INSERT INTO economy_stage_batches(id,accepted) VALUES(?,1)').run('x'.repeat(524288-overhead+excess));
  const original=dump(f.db),rebuilt=dump(f.shadow),result=await recovery.preflightEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});
  assert.equal(result.status,excess?'blocked':'ready');if(excess){assert.equal(result.capacityFailure.actual,524289);assert.equal(result.capacityFailure.limit,524288);}else{const plan=await prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});assert.equal(result.plan.hash,plan.hash);}
  assert.equal(dump(f.db),original);assert.equal(dump(f.shadow),rebuilt);
 }finally{f.close();}
});
test('Audit4 C02: global metadata growth exceeding total byte budget is diagnosed before writes',async()=>{
 const f=await fixture();try{
  const s=f.db.raw.prepare('INSERT INTO economy_stage_batches(id,accepted) VALUES(?,1)');
  f.db.raw.exec('BEGIN');for(let i=0;i<7200;i++)s.run(String(i).padStart(8,'0')+'x'.repeat(600));f.db.raw.exec('COMMIT');
  const before=dump(f.db),result=await recovery.preflightEconomyRecovery(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});
  assert.equal(result.status,'blocked');assert.equal(result.capacityFailure.metric,'planBytes');assert.ok(result.capacityFailure.actual>4194304);assert.equal(dump(f.db),before);
 }finally{f.close();}
});
test('Audit4 C02: appended rows after a full snapshot page invalidate its transaction guard',async()=>{
 const f=await fixture();try{
  const insert=f.db.raw.prepare('INSERT INTO economy_stage_batches(id,accepted) VALUES(?,1)');for(let i=0;i<128;i++)insert.run(String(i));
  const p=await prepare(f.db,f.shadow,f.c,f.next,{nowMs:f.nowMs});let after;
  const race={...f.db,batch:async s=>{insert.run('appended-after-planning');after=dump(f.db);return f.db.batch(s);}};
  await assert.rejects(apply(race,f.shadow,f.c,f.next,{nowMs:f.nowMs,expectedPlanHash:p.hash}),/constraint|CHECK/i);assert.equal(dump(f.db),after);
 }finally{f.close();}
});
test('Audit4 C02 CLI: read-only preflight reports ready and blocked, preserves both file hashes, never stages a DB',async()=>{
 const f=await fixture(),folder=mkdtempSync(join(tmpdir(),'ember-audit4-preflight-'));const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
 try{
  const original=join(folder,'original.sqlite'),rebuilt=join(folder,'rebuilt.sqlite'),from=join(folder,'from.json'),to=join(folder,'to.json');
  await backup(f.db.raw,original);await backup(f.shadow.raw,rebuilt);writeFileSync(from,JSON.stringify(f.c));writeFileSync(to,JSON.stringify(f.next));
  const args=(file,out)=>['preflight','--original',file,'--rebuilt',rebuilt,'--from-config',from,'--to-config',to,'--now-ms',String(f.nowMs),'--out',out];
  const before=[sha(original),sha(rebuilt)],ready=join(folder,'ready');assert.equal((await runEconomyRecoveryTool(args(original,ready))).status,'PASS');assert.equal(existsSync(join(ready,'database.private.sqlite')),false);
  assert.deepEqual([sha(original),sha(rebuilt)],before);
  f.db.raw.prepare('INSERT INTO economy_stage_batches(id,accepted) VALUES(?,1)').run('x'.repeat(524288));const large=join(folder,'large.sqlite');await backup(f.db.raw,large);const largeSha=sha(large),blocked=join(folder,'blocked');
  assert.equal((await runEconomyRecoveryTool(args(large,blocked))).status,'BLOCKED');assert.equal(sha(large),largeSha);assert.equal(sha(rebuilt),before[1]);
  const report=JSON.parse(readFileSync(join(blocked,'recovery-preflight.private.json')));assert.equal(report.capacityFailure.table,'economy_stage_batches');assert.equal(existsSync(join(blocked,'migration-batch.private.json')),false);assert.equal(existsSync(join(blocked,'database.private.sqlite')),false);
 }finally{f.close();const absolute=realpathSync(folder),base=realpathSync(tmpdir());assert.ok(absolute.toLowerCase().startsWith((base+sep).toLowerCase())&&absolute.includes('ember-audit4-preflight-'));rmSync(absolute,{recursive:true,force:true});}
});
