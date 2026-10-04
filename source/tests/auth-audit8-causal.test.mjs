import test from 'node:test';
import assert from 'node:assert/strict';
import {runAudit8Seed,minimizeAudit8Failure,AUDIT8_KERNELS} from './auth-audit8-causes.mjs';
import {Audit8Reference,AUDIT8_ORACLE_VERSION} from './auth-audit8-reference.mjs';
import {InvariantFailure,ORACLE_VERSION} from './auth-reference-model.mjs';
import {TEST_ADDRESSES,sourceRoot,GENERATOR_VERSION} from './auth-scheduler-driver.mjs';
import {createArtifactStore,sanitizeArtifact} from './auth-artifacts.mjs';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const artifacts=createArtifactStore({sourceDir:resolve(import.meta.dirname,'..')});
const inputPaths=['src/world/auth.ts','src/world/authLifecycle.ts','src/world/authCleanup.ts','src/shared/freshness.ts','worker/app.ts',
  'server/auth.ts','server/ownership.ts','server/member.ts','tests/auth-r7-fixtures.mjs','tests/wallet-harness.mjs','tests/d1-sqlite.mjs','package-lock.json'];
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const provenance=()=>({selectedSource:process.env.AUTH_REFERENCE_SOURCE?'explicit override':'checkout',node:process.version,oracle:ORACLE_VERSION,
  audit8Oracle:AUDIT8_ORACLE_VERSION,generator:GENERATOR_VERSION,inputs:Object.fromEntries(inputPaths.map(p=>[p,sha(resolve(sourceRoot,p))])),
  evaluator:Object.fromEntries(['auth-reference-model.mjs','auth-scheduler-driver.mjs','auth-audit8-reference.mjs','auth-audit8-causes.mjs','auth-audit8-causal.test.mjs','auth-artifacts.mjs']
    .map(p=>[p,sha(resolve(import.meta.dirname,p))]))});
for(const [index,kernel] of AUDIT8_KERNELS.entries())test('Audit8 independent causal oracle: '+kernel,async()=>{
  const result=await runAudit8Seed(index,{kernel});
  assert.ok(result.metrics.workerCalls>=2&&result.metrics.dbComparisons>=2&&result.metrics.projectionComparisons>=2);
  artifacts.write(`fixed-${index}-audit-${kernel}.json`,{...provenance(),trace:result});
});
test('Audit8 oracle calibration keeps passive discovery powerless and rejects empty signature-completion witnesses',()=>{
  const m=new Audit8Reference(TEST_ADDRESSES,1_000_000);m.tab('a','A');m.start('a');m.discovery('a');
  assert.equal(m.tabs.get('a').plans.length,0);assert.equal(m.tabs.get('a').account,'A');
  assert.throws(()=>m.requireValidSignatureCompletion('a'),error=>error instanceof InvariantFailure&&error.invariant==='AUDIT8-SIGNATURE-CONTINUITY');
  // Explicit selection has a different normative input and remains an auth-context change.
  m.intent('a','provider','B');assert.equal(m.tabs.get('a').provider,1);assert.equal(m.tabs.get('a').account,'B');
  const text=readFileSync(new URL('./auth-audit8-reference.mjs',import.meta.url),'utf8');
  const imports=[...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match=>match[1]);assert.deepEqual(imports,['./auth-reference-model.mjs']);
});
test('Audit8 seed and full explicit causal replay produce the same normalized effects; empty replay is rejected',async()=>{
  for(const seed of [0,1,2,3,4,5]){const first=await runAudit8Seed(seed),again=await runAudit8Seed(seed),replay=await runAudit8Seed(seed,{replayActions:first.actions});
    assert.equal(first.traceDigest,again.traceDigest);assert.equal(first.traceDigest,replay.traceDigest);assert.deepEqual(first.counts,replay.counts);assert.deepEqual(first.projections,replay.projections);}
  await assert.rejects(()=>runAudit8Seed(2,{replayActions:[]}),error=>error.invariant==='HARNESS-NONVACUOUS');
});
test('90 additional deterministic Audit8 causal schedules agree with pure policy oracle, separately from the original 500',async T=>{
  const results=[],branches={},coverage=new Set(),p=provenance();let failure=null,minimized=null;
  for(let seed=0;seed<90;seed++)try{const result=await runAudit8Seed(seed,{retainTrace:false});results.push(result);
    branches[result.kernel]=(branches[result.kernel]??0)+1;for(const action of result.coverage)coverage.add(action);
  }catch(error){failure={seed,invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null,trace:error.schedulerTrace};
    artifacts.write('audit8-90-failure-original.json',{...p,...failure});if(error.schedulerTrace&&error.invariant)minimized=await minimizeAudit8Failure(error.schedulerTrace,error.invariant);
    artifacts.write('audit8-90-failure-minimized.json',{...p,invariant:failure.invariant,trace:minimized});break;}
  const metrics={};for(const result of results)for(const [key,value] of Object.entries(result.metrics))metrics[key]=(metrics[key]??0)+value;
  const report={...p,requestedSeeds:90,executedSeeds:results.length+(failure?1:0),passedSeeds:results.length,failedSeeds:failure?1:0,
    status:failure?'FAIL':'PASS',uniqueNormalizedDigests:new Set(results.map(r=>r.traceDigest)).size,branches,coverage:[...coverage].sort(),metrics,results,failure,
    limits:['Additional three Audit8 causal kernels; core 500 are retained and counted separately.',
      'Passive same-account provider objects and temporarily empty account discovery; real WalletRegistry selection/discovery is checked in auth-audit8.test.mjs.',
      'Two-tab staged header/cookie/body delivery; Worker route/SQL execution is one atomic scheduler step, not every D1 interleaving.',
      'No real browser, wallet, WAF, Cloudflare production binding or process-kill coverage claim.']};
  artifacts.write('audit8-90-RESULT.json',report);T.diagnostic('AUDIT8_CAUSAL_SCHEDULER '+JSON.stringify({status:report.status,passedSeeds:report.passedSeeds,
    uniqueNormalizedDigests:report.uniqueNormalizedDigests,metrics,branches,artifacts:artifacts.enabled?'tmp output explicitly enabled':'disabled'}));
  assert.equal(failure,null,failure?sanitizeArtifact(`seed=${failure.seed} invariant=${failure.invariant}; `)+(artifacts.enabled?'replay artifacts in explicit tmp output':'enable AUTH_REFERENCE_ARTIFACT_DIR=tmp/auth-reference-scheduler to preserve traces'):'');
  assert.equal(results.length,90);assert.deepEqual(branches,Object.fromEntries(AUDIT8_KERNELS.map(kernel=>[kernel,30])));
  assert.ok(metrics.workerCalls>=500&&metrics.dbComparisons>=500&&metrics.projectionComparisons>=500);assert.ok(report.uniqueNormalizedDigests>=30);
});
