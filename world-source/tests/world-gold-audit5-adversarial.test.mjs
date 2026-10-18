import test from 'node:test';
import assert from 'node:assert/strict';
import * as gold from '../server/world-gold.ts';
import {createEconomyGoldChallenge,payEconomyOrderGold,ingestEconomyEvents} from '../server/economy-ledger.ts';
import {runGoldServiceJobs} from '../server/world-gold-delivery.ts';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {prepareEconomyRecovery,preflightEconomyRecovery} from '../server/economy-recovery.ts';
import {defineEconomyConfig} from '../server/economy-config.ts';
import {fixture,NOW,W,H,rid,mintProof} from './world-gold-audit5-fixture.mjs';
import {createWorker} from '../worker/app.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';

test('second inspection: reservation retry cannot change wallet, amount, scope or deadline under identical auth',async()=>{const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);for(const patch of [{wallet:'0x'+'c'.repeat(40)},{gold:'1'},{chainId:31337},{chainInstance:'other'},{contract:'0x'+'7'.repeat(40)},{deadline:m.deadline+1}])await assert.rejects(gold.reserveMintGold(f.db,{...m,...patch},NOW),/MINT_ORDER_CONFLICT/);assert.equal((await f.snapshot()).reserved,'8');
 }finally{f.close();}});
test('second inspection: bare timeout/failure assertions never authorize a service refund',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);await assert.rejects(gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+1,outcome:{failure:'RPC_TIMEOUT'}}),/DELIVERY_EVIDENCE_REQUIRED/);assert.equal((await f.snapshot()).book,'7');await assert.rejects(gold.refundGold(f.db,id,NOW+2));
 }finally{f.close();}});
test('second inspection: pausing after signature verification but before commit cannot debit',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.quote('research'),signed=await f.challenge(id),batch=f.db.batch;f.db.batch=async list=>{f.db.raw.exec("UPDATE world_gold_controls SET enabled=0,version=version+1 WHERE feature='service'");return batch(list);};
 await assert.rejects(payEconomyOrderGold(f.db,f.config,signed),/FEATURE_PAUSED/);assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_jobs').get().n,0);
 }finally{f.close();}});
test('second inspection: pausing between challenge precheck and INSERT creates no challenge',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.quote('research'),prepare=f.db.prepare;f.db.prepare=sql=>{const s=prepare(sql);if(!sql.startsWith('INSERT INTO economy_gold_challenges'))return s;return {...s,bind:(...values)=>{const b=s.bind(...values);return {...b,run:async()=>{f.db.raw.exec("UPDATE world_gold_controls SET enabled=0 WHERE feature='service'");return b.run();}};}};};
 await assert.rejects(createEconomyGoldChallenge(f.db,f.config,{wallet:W,orderId:id,requestId:rid(),origin:'https://imdember.com',nowMs:NOW,serviceReady:true}),/FEATURE_PAUSED/);assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_challenges').get().n,0);
 }finally{f.close();}});
test('second inspection: delivery-job insertion failure rolls back debit, paid status and challenge together',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.quote('research'),signed=await f.challenge(id);f.db.raw.exec("CREATE TRIGGER audit5_job_fault BEFORE INSERT ON world_gold_jobs BEGIN SELECT RAISE(ABORT,'SIMULATED_DISK_WRITE'); END");
 await assert.rejects(payEconomyOrderGold(f.db,f.config,signed),/SIMULATED_DISK_WRITE/);assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(id).status,'pending');assert.equal(f.db.raw.prepare('SELECT consumed_ms FROM economy_gold_challenges WHERE order_id=?').get(id).consumed_ms,null);
 f.db.raw.exec('DROP TRIGGER audit5_job_fault');await payEconomyOrderGold(f.db,f.config,signed);assert.equal((await f.snapshot()).book,'7');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_jobs WHERE order_id=?').get(id).n,1);
 }finally{f.close();}});
test('second inspection: pending provider retries reuse one key; proven nondelivery records proof and refunds once',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service(),keys=[];let now=NOW,kind='pending';const provider={id:'fixture-provider',deliver:async o=>{keys.push(o.idempotencyKey);return kind==='pending'?{kind:'pending'}:{kind:'terminal-failure',code:'NO_DELIVERY',proof:{kind:'provider-confirmed-nondelivery',reference:'receipt-123'}};}};
 await runGoldServiceJobs(f.db,provider,()=>now);assert.equal((await f.snapshot()).book,'7');await assert.rejects(gold.refundGold(f.db,id,now));now+=60001;kind='failed';await runGoldServiceJobs(f.db,provider,()=>now);assert.equal((await f.snapshot()).book,'10');assert.deepEqual(keys,[id,id]);
 const row=f.db.raw.prepare('SELECT delivery_evidence_json FROM world_gold_jobs WHERE order_id=?').get(id);assert.equal(JSON.parse(row.delivery_evidence_json).reference,'receipt-123');await runGoldServiceJobs(f.db,provider,()=>now);assert.equal(keys.length,2);
 }finally{f.close();}});
test('second inspection: provider exceptions and malformed terminal proof leave the original entitlement pending',async()=>{const f=await fixture();try{
 await f.topup();const id=await f.service();let now=NOW;await runGoldServiceJobs(f.db,{id:'fixture',deliver:async()=>{throw Error('timeout');}},()=>now);assert.equal((await f.snapshot()).book,'7');now+=60001;
 await runGoldServiceJobs(f.db,{id:'fixture',deliver:async()=>({kind:'terminal-failure',code:'TIMEOUT',proof:{kind:'unproven-timeout',reference:'x'}})},()=>now);assert.equal((await f.snapshot()).book,'7');await assert.rejects(gold.refundGold(f.db,id,now));
 }finally{f.close();}});
test('second inspection: UTF8 oversize, undefined and cyclic results terminate without a repeated charge',async()=>{for(const result of ['燼'.repeat(6000),undefined,(()=>{const a={};a.self=a;return a;})()]){const f=await fixture();try{await f.topup();const id=await f.service(),attempt=await gold.claimGoldJob(f.db,id,NOW);await gold.finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+1,outcome:{result}});assert.equal((await f.snapshot()).book,'10');assert.equal((await f.snapshot()).orders.find(o=>o.id===id).delivery,'refunded');}finally{f.close();}}});
test('second inspection: scope, proof type, finalized mode and chain deadline are independently enforced',async()=>{const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);for(const patch of [{wallet:'0x'+'c'.repeat(40)},{gold:'1'},{mode:'private-chain-fixture'},{orderId:H(100)},{blockHash:null},{blockNumber:'x'},{chainTimeMs:0},{tokenId:'00'},{revoked:1},{revoked:false,chainTimeMs:NOW}]){const evidence=mintProof(m,'released',patch);await assert.rejects(gold.settleMintGold(f.db,{id:m.id,chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,state:'released',evidence},NOW+86400000));assert.throws(()=>f.db.raw.prepare("UPDATE world_gold_mints SET state='released',evidence_json=? WHERE id=?").run(JSON.stringify(evidence),m.id));}assert.equal((await f.snapshot()).reserved,'8');
 }finally{f.close();}});
test('second inspection: wall time cannot expire a still-executable chain authorization',async()=>{const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);const reader={chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,read:async()=>mintProof(m,'released',{revoked:false,chainTimeMs:NOW})};
 assert.equal((await gold.reconcileHeldMintGold(f.db,reader,NOW+86400000)).outcomes[0].status,'pending');assert.equal((await f.snapshot()).reserved,'8');reader.read=async()=>mintProof(m,'released',{revoked:false,chainTimeMs:m.deadline+1});assert.equal((await gold.reconcileHeldMintGold(f.db,reader,NOW+86400001)).outcomes[0].status,'released');assert.equal((await f.snapshot()).available,'10');
 }finally{f.close();}});
test('second inspection: lost/wrong chain namespace remains held without even consulting the wrong reader',async()=>{const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);const r=await gold.reconcileHeldMintGold(f.db,{chainId:m.chainId,contract:m.contract,chainInstance:'new-chain',read:async()=>{throw Error('wrong reader must not run');}},NOW+86400000);assert.equal(r.outcomes[0].status,'MINT_SCOPE_MISMATCH');assert.equal((await f.snapshot()).reserved,'8');
 }finally{f.close();}});
test('second inspection: stored-order recovery is bounded and writes immutable before/after evidence',async()=>{const f=await fixture();try{
 await f.topup();for(let i=1;i<=5;i++)await gold.reserveMintGold(f.db,{...f.mint(H(i)),gold:'1'},NOW);
 const base=f.mint(),reader={chainId:base.chainId,contract:base.contract,chainInstance:base.chainInstance,read:async m=>mintProof(m)};let after='',total=0;do{const r=await gold.reconcileHeldMintGold(f.db,reader,NOW,{after,limit:2});assert.ok(r.outcomes.length<=2);total+=r.outcomes.length;after=r.next;}while(after);assert.equal(total,5);assert.equal((await f.snapshot()).available,'10');
 const a=f.db.raw.prepare('SELECT before_json,after_json FROM world_gold_mint_settlements LIMIT 1').get();assert.equal(JSON.parse(a.before_json).state,'held');assert.equal(JSON.parse(a.after_json).state,'released');assert.throws(()=>f.db.raw.exec('DELETE FROM world_gold_mint_settlements'));
 }finally{f.close();}});
test('second inspection: simultaneous settlement retries create exactly one debit and one settlement receipt',async()=>{const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);const o={id:m.id,chainId:m.chainId,contract:m.contract,chainInstance:m.chainInstance,state:'consumed',evidence:mintProof(m,'consumed')};await Promise.all([gold.settleMintGold(f.db,o,NOW),gold.settleMintGold(f.db,o,NOW)]);assert.equal((await f.snapshot()).book,'2');assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_mint_settlements').get().n,1);
 }finally{f.close();}});
test('second inspection: known pre-0015 schema remains recoverable and missing required tables return a coded error',async()=>{const f=await fixture(),files=migrationFiles().filter(n=>Number(n.slice(0,4))<15),db=openD1(files),shadow=openD1(files);try{
 const next=await defineEconomyConfig({...f.config,deploymentBlock:'99'}),args={nowMs:NOW+86400001};for(const [target,c,from] of [[db,f.config,'100'],[shadow,next,'99']])await ingestEconomyEvents(target,c,{fromBlock:from,toBlock:'102',toBlockHash:H(102),throughTimestamp:NOW+86400000,events:[]});assert.equal((await prepareEconomyRecovery(db,shadow,f.config,next,args)).report.totalDelta,'0');db.raw.exec('DROP TABLE world_gold_jobs');await assert.rejects(prepareEconomyRecovery(db,shadow,f.config,next,args),/RECOVERY_SCHEMA_MISSING/);
 }finally{f.close();db.raw.close();shadow.raw.close();}});
test('second inspection: HTTP/env cannot manufacture a delivery capability; trusted runtime binding can admit service',async()=>{const f=await fixture();try{
 const token='t'.repeat(43),tokenHash=await sha256(token);f.db.raw.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,'EOA','ECDSA')").run(tokenHash,W,NOW-1,NOW+60000,rid());
 const env={DB:f.db,ASSETS:{fetch:async()=>new Response('unused')},ECONOMY_LIMITER:{limit:async()=>({success:true})},SERVICE_READY:true,DELIVERY_PROVIDER:'fixture'},request=extra=>new Request('https://imdember.com/api/gold/quote',{method:'POST',headers:{origin:'https://imdember.com','content-type':'application/json',cookie:SESSION_COOKIE+'='+token},body:JSON.stringify({expectedAddress:W,requestId:rid(),product:'research',...extra})}),context={waitUntil(){}};
 const closed=createWorker({},undefined,()=>NOW,[],undefined,{config:async()=>f.config});assert.equal((await (await closed.fetch(request({}),env,context)).json()).error,'SERVICE_DELIVERY_UNAVAILABLE');assert.equal((await closed.fetch(request({serviceReady:true}),env,context)).status,400);
 const bound=createWorker({},undefined,()=>NOW,[],undefined,{config:async()=>f.config,delivery:{id:'fixture',deliver:async()=>({kind:'pending'})}});assert.equal((await bound.fetch(request({}),env,context)).status,200);
 }finally{f.close();}});
test('second inspection: malformed-proof rejection evaluator detects removal of the SQL proof guard',async()=>{for(const defect of [false,true]){const f=await fixture();try{
 await f.topup();const m=f.mint();await gold.reserveMintGold(f.db,m,NOW);if(defect)f.db.raw.exec('DROP TRIGGER world_gold_mint_proof');let blocked=false;try{f.db.raw.prepare("UPDATE world_gold_mints SET state='released',evidence_json=? WHERE id=?").run('{"timeout":true}',m.id);}catch{blocked=true;}assert.equal(blocked,!defect);assert.equal(f.db.raw.prepare('SELECT state FROM world_gold_mints WHERE id=?').get(m.id).state,defect?'released':'held');
 }finally{f.close();}}});
