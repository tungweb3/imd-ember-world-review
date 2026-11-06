import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {defineEconomyConfig} from '../server/economy-config.ts';
import {ingestEconomyEvents} from '../server/economy-ledger.ts';
import {applyEconomyRecovery,prepareEconomyRecovery,preflightEconomyRecovery} from '../server/economy-recovery.ts';
import {fixture,NOW,H,W} from './world-gold-audit5-fixture.mjs';
const GRANT_WALLET='0x[REDACTED-GRANT-WALLET-1]',RECIPIENT='0x'+'c'.repeat(40),args={nowMs:NOW+2*86400000+1};
async function recover(f,files){
 const next=await defineEconomyConfig({...f.config,deploymentBlock:'99'}),db=files?openD1(files):f.db,shadow=openD1(files);
 for(const [target,c,from] of [[db,f.config,'100'],[shadow,next,'99']])await ingestEconomyEvents(target,c,{fromBlock:from,toBlock:'102',toBlockHash:H(102),throughTimestamp:NOW+2*86400000,events:[]});
 return {db,next,shadow};
}
test('a recovery plan counts granted GOLD as part of the book and adds nothing',async()=>{
 const f=await fixture();let shadow;try{
  const r=await recover(f);shadow=r.shadow;
  f.db.raw.prepare("INSERT INTO world_gold_grants(id,wallet,delta,kind,reference,actor,reason,created_ms) VALUES('g',?,1000,'admin-grant','admin-grant:g',?,'tester',?)").run(RECIPIENT,GRANT_WALLET,NOW);
  const plan=await prepareEconomyRecovery(f.db,shadow,f.config,r.next,args);assert.equal(plan.report.totalDelta,'0');assert.deepEqual(plan.report.adjustments,[]);
  assert.equal((await preflightEconomyRecovery(f.db,shadow,f.config,r.next,args)).status,'ready');
  assert.ok(plan.report.capacity.tables.some(t=>t.side==='original'&&t.table==='world_gold_grants'&&t.rows===1));
  await applyEconomyRecovery(f.db,shadow,f.config,r.next,{...args,expectedPlanHash:plan.hash});
  assert.equal((await f.snapshot(RECIPIENT)).book,'1000');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_grants').get().n,1);
 }finally{f.close();shadow?.raw.close();}
});
test('granted GOLD pays for a service like bought GOLD',async()=>{
 const f=await fixture();try{
  f.db.raw.prepare("INSERT INTO world_gold_grants(id,wallet,delta,kind,reference,actor,reason,created_ms) VALUES('g',?,10,'admin-grant','admin-grant:g',?,'tester',?)").run(W,GRANT_WALLET,NOW);
  assert.equal((await f.snapshot()).available,'10');
  await f.service();const after=await f.snapshot();assert.equal(after.book,'7');
  assert.deepEqual(after.history.map(h=>h.kind).sort(),['admin-grant','service-payment']);
 }finally{f.close();}
});
test('a recovery plan still refuses a balance no ledger explains',async()=>{
 const f=await fixture();let shadow;try{
  const r=await recover(f);shadow=r.shadow;
  f.db.raw.prepare("INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,1000)").run(RECIPIENT);
  await assert.rejects(prepareEconomyRecovery(f.db,shadow,f.config,r.next,args),/RECOVERY_BALANCE_JOURNAL_MISMATCH/);
 }finally{f.close();shadow?.raw.close();}
});
test('a database before the grants migration still plans a recovery',async()=>{
 const f=await fixture(),files=migrationFiles().filter(n=>Number(n.slice(0,4))<24);let r;try{
  r=await recover(f,files);const plan=await prepareEconomyRecovery(r.db,r.shadow,f.config,r.next,args);assert.equal(plan.report.totalDelta,'0');
 }finally{f.close();r?.db.raw.close();r?.shadow.raw.close();}
});
