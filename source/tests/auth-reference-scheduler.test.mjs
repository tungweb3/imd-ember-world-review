import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {AuthReference,InvariantFailure,canonical,ORACLE_VERSION} from './auth-reference-model.mjs';
import {runSeed,minimizeFailure,KERNELS,GENERATOR_VERSION,TEST_ADDRESSES,sourceRoot} from './auth-scheduler-driver.mjs';

const artifactRoot=resolve(import.meta.dirname,'../../evidence/reference-scheduler');
const inputPaths=['src/world/auth.ts','src/world/authLifecycle.ts','src/world/authCleanup.ts','worker/app.ts','server/auth.ts',
  'src/shared/freshness.ts','server/ownership.ts','server/member.ts','tests/auth-r7-fixtures.mjs','package-lock.json',
  'tests/wallet-harness.mjs','tests/d1-sqlite.mjs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function provenance(){return {sourceRoot,inputs:Object.fromEntries(inputPaths.filter(p=>existsSync(resolve(sourceRoot,p))).map(p=>[p,sha(readFileSync(resolve(sourceRoot,p)))])),
  evaluator:Object.fromEntries(['auth-reference-model.mjs','auth-scheduler-driver.mjs','auth-reference-scheduler.test.mjs'].map(p=>[p,sha(readFileSync(resolve(import.meta.dirname,p)))])),
  node:process.version,sqlite:'node:sqlite DatabaseSync; actual migrations; route body/transaction treated as one Worker execution step',
  oracle:ORACLE_VERSION,generator:GENERATOR_VERSION};}
function save(name,value){mkdirSync(artifactRoot,{recursive:true});writeFileSync(resolve(artifactRoot,name),JSON.stringify(value,null,2)+'\n');}
const oracle=()=>{const m=new AuthReference(TEST_ADDRESSES,1_000_000);m.tab('a','A');m.start('a');m.click('a');return m;};
function absentRead(m){const r=m.command('a','/api/auth/session',{},m.jar);m.run(r,m.now);m.headers(r);m.visible(r);m.body(r);return r;}
function beginVerify(m,{finish=true}={}){
  absentRead(m);const c=m.command('a','/api/auth/challenge',{address:TEST_ADDRESSES.A},m.jar);m.run(c,m.now);m.headers(c);m.visible(c);m.body(c);m.prompt('a');
  const v=m.command('a','/api/auth/verify',{nonce:c.nonce},m.jar);m.run(v,m.now);m.headers(v);m.visible(v);if(finish)m.body(v);return v;
}
const rejects=(fn,id)=>assert.throws(fn,e=>e instanceof InvariantFailure&&e.invariant===id);

test('independent oracle imports no production AuthClient, lifecycle, status helper or Worker',()=>{
  const text=readFileSync(new URL('./auth-reference-model.mjs',import.meta.url),'utf8');
  assert.ok(!/^\s*(?:import\s|export\s.*\bfrom\s)/m.test(text),'pure model has no imports of any kind');
  assert.equal(canonical({signedIn:'false'}).kind,'UNKNOWN');assert.equal(canonical({signedIn:false}).kind,'ABSENT');
  assert.equal(canonical({signedIn:true,address:TEST_ADDRESSES.A,expiresAt:Infinity}).kind,'UNKNOWN');
});

test('oracle calibration: UNKNOWN prompt rejected; same-click canonical ABSENT prompt accepted',()=>{
  const bad=oracle();rejects(()=>bad.prompt('a'),'AUTH-I9');
  const good=oracle();absentRead(good);assert.doesNotThrow(()=>good.prompt('a'));assert.equal(good.projection('a').prompts,1);
});
test('oracle calibration: zero-GET challenge and duplicate prompt rejected; fresh click control accepted',()=>{
  const m=oracle();rejects(()=>m.command('a','/api/auth/challenge',{address:TEST_ADDRESSES.A},m.jar),'AUTH-I3');
  absentRead(m);assert.doesNotThrow(()=>m.command('a','/api/auth/challenge',{address:TEST_ADDRESSES.A},m.jar));m.prompt('a');rejects(()=>m.prompt('a'),'AUTH-I10');
});
test('oracle calibration: released nonce cannot revive, displayed address cleanup still accepted',()=>{
  const m=oracle(),v=beginVerify(m);assert.equal(v.owner.status,'RELEASED');m.intent('a','account','B');
  rejects(()=>m.command('a','/api/auth/logout',{expectedNonce:v.body.nonce},m.jar),'AUTH-I1');
  const r=m.command('a','/api/auth/logout',{expectedAddress:TEST_ADDRESSES.A},m.jar);assert.equal(m.run(r,m.now).status,204);
  assert.equal(m.counts().revoked,1);rejects(()=>m.command('a','/api/auth/logout',{expectedAddress:TEST_ADDRESSES.A},m.jar),'AUTH-I5');
});
test('oracle calibration: uncertain lock rejects auto logout and accepts post-fence canonical PRESENT',()=>{
  const m=oracle(),v=beginVerify(m,{finish:false});m.intent('a','lock');
  rejects(()=>m.command('a','/api/auth/logout',{expectedNonce:v.body.nonce},m.jar),'INFO-1');
  const r=m.command('a','/api/auth/session',{},m.jar);m.run(r,m.now);m.visible(r);m.body(r);
  assert.equal(v.owner.status,'RELEASED');assert.equal(m.projection('a').knowledge,'PRESENT');assert.equal(m.counts().live,1);
});
test('oracle calibration: dead cookie never falls back to pending cancellation; genuine pending-only flow may cancel',()=>{
  const m=oracle();absentRead(m);const c=m.command('a','/api/auth/challenge',{address:TEST_ADDRESSES.A},m.jar);m.run(c,m.now);m.headers(c);
  const before=m.counts();const dead=m.command('external','/api/auth/logout',{expectedNonce:c.nonce},{...m.jar,session:'DEAD'});
  assert.equal(m.run(dead,m.now).status,409);assert.deepEqual(m.counts(),before);
  const good=m.command('external','/api/auth/logout',{expectedNonce:c.nonce},m.jar);assert.equal(m.run(good,m.now).status,204);assert.equal(m.counts().pending,0);
});
test('oracle calibration: old nonce cannot revoke newer session or invalidate newer pending flow',()=>{
  const m=oracle(),v=beginVerify(m),old=v.body.nonce;
  const c=m.command('external','/api/auth/challenge',{address:TEST_ADDRESSES.B},m.jar);m.run(c,m.now);m.headers(c);
  const oldCleanup=m.command('external','/api/auth/logout',{expectedNonce:old},m.jar);assert.equal(m.run(oldCleanup,m.now).status,204);
  m.headers(oldCleanup);assert.equal(m.jar.flow,c.expected.cookies[0][1]);assert.equal(m.challenges.get(c.nonce).invalid,false);
  const newer=m.command('external','/api/auth/verify',{nonce:c.nonce},m.jar);m.run(newer,m.now);m.headers(newer);
  const before=m.counts(),stale=m.command('external','/api/auth/logout',{expectedNonce:old},m.jar);assert.equal(m.run(stale,m.now).status,409);
  assert.deepEqual(m.counts(),before);assert.equal(m.counts().live,1);
});
test('oracle calibration: stale UI projection and duplicate accepted hint rejected; matching projection accepted',()=>{
  const m=oracle();beginVerify(m);assert.doesNotThrow(()=>m.assertProjection('a',m.projection('a')));
  rejects(()=>m.assertProjection('a',{...m.projection('a'),displayed:TEST_ADDRESSES.B}),'REFERENCE-PROJECTION');
  m.hint('a','signed-in');rejects(()=>m.hint('a','signed-in'),'AUTH-I2');
});

for(let seed=0;seed<KERNELS.length;seed++)test(`fixed independent-model real-Worker matrix: ${KERNELS[seed]}`,async()=>{
  const trace=await runSeed(seed,{retainTrace:true});assert.ok(trace.metrics.workerCalls>=2);assert.ok(trace.metrics.dbComparisons>0);
  assert.ok(trace.metrics.projectionComparisons>=4);save(`fixed-${seed}-${trace.kernel}.json`,{...provenance(),trace});
});

test('focused UNKNOWN-start controls reach displayed/pending and uncertain-lock policies without weakening preflight oracle',async()=>{
  for(const [seed,warmUnknown] of [[0,['a']],[3,true],[19,true]]){const trace=await runSeed(seed,{warmUnknown,retainTrace:true});save(`focused-${seed}.json`,{...provenance(),trace});}
});

test('same seed and complete explicit-action replay have deterministic normalized digests and identical projections',async()=>{
  for(const seed of [0,1,3,4,10,12,19]){
    const first=await runSeed(seed,{retainTrace:true}),again=await runSeed(seed,{retainTrace:true}),replayed=await runSeed(seed,{replayActions:first.actions});
    assert.equal(first.traceDigest,again.traceDigest,'PRNG seed produces the same causal action schedule');
    assert.equal(first.traceDigest,replayed.traceDigest,'complete action replay does not invoke random selection');
    assert.deepEqual(first.projections,replayed.projections);assert.deepEqual(first.counts,replayed.counts);
  }
});

test('500 deterministic real AuthClient + Worker + SQLite schedules agree with independent reference oracle',async T=>{
  const runId='gate-'+Date.now()+'-'+randomUUID().slice(0,8),results=[],coverage=new Set(),branches={},start=performance.now(),p=provenance();
  let failure=null,minimized=null;
  for(let seed=0;seed<500;seed++){
    try{const result=await runSeed(seed);results.push(result);branches[result.kernel]=(branches[result.kernel]??0)+1;
      for(const key of result.coverage)coverage.add(key);
    }catch(error){failure={seed,invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null,trace:error.schedulerTrace};
      save(runId+'-failure-original.json',{...p,...failure});
      if(error.schedulerTrace&&error.invariant)minimized=await minimizeFailure(error.schedulerTrace,error.invariant);
      save(runId+'-failure-minimized.json',{...p,invariant:failure.invariant,trace:minimized});break;
    }
  }
  const metrics={};for(const result of results)for(const [key,value] of Object.entries(result.metrics))metrics[key]=(metrics[key]??0)+value;
  const report={...p,runId,requestedSeeds:500,executedSeeds:results.length+(failure?1:0),passedSeeds:results.length,failedSeeds:failure?1:0,
    status:failure?'FAIL':'PASS',elapsedMs:performance.now()-start,uniqueNormalizedDigests:new Set(results.map(r=>r.traceDigest)).size,
    branches,coverage:[...coverage].sort(),metrics,results,failure,
    limits:['Two tabs; public A/B/C test identities; finite scripted anchors plus randomized causal completions.',
      'Worker route body/SQL execution is an atomic scheduler step; no claim of all D1 internal interleavings.',
      'Timers/provider/visibility are injected; real OS wallets, all browsers, process termination, Cloudflare bindings/WAF remain outside this evaluator.',
      'Real handler cryptographic nonces/tokens stay random; replay aliases them instead of overriding production randomness.',
      'Synthetic unavailable/invalid canonical responses are explicitly injected before Worker admission. Other route effects use real Worker/SQLite.',
      'Ownership TTL/freshness matrix rows use separate real-Worker ownership tests, not counted as Auth oracle seeds.',
      'Seeds are not unique-permutation claims; unique normalized trace digests are reported separately.',
      'AUTH-I8/I11/I12 broad server concurrency/dead-token controls remain separately required; this bounded scheduler is not a replacement.']};
  save(runId+'-RESULT.json',report);save('LATEST.json',{runId,resultFile:runId+'-RESULT.json',status:report.status});
  T.diagnostic('INDEPENDENT_AUTH_SCHEDULER '+JSON.stringify({runId,status:report.status,passedSeeds:report.passedSeeds,uniqueNormalizedDigests:report.uniqueNormalizedDigests,metrics,branches}));
  assert.equal(failure,null,failure?`seed=${failure.seed} invariant=${failure.invariant}; original/minimized traces saved at ${artifactRoot}`:'');
  assert.equal(results.length,500);assert.equal(Object.keys(branches).length,KERNELS.length);
  assert.ok(metrics.workerCalls>1000&&metrics.dbComparisons>1000&&metrics.projectionComparisons>1000,'each seed has real effects and oracle comparisons');
  assert.ok(metrics.preHeaderFailures>0,'transport-failure branch is nonvacuous');
  assert.ok(report.uniqueNormalizedDigests>=100,'seed diversity cannot be merely empty/no-op repetitions');
});
