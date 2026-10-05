import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync,rmdirSync,readdirSync,lstatSync,unlinkSync,renameSync,linkSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createArtifactStore,sanitizeArtifact} from './auth-artifacts.mjs';
function dispose(root){const r=relative(resolve(tmpdir()),resolve(root));assert.ok(!isAbsolute(r)&&/^auth-artifacts-[^\\/]+$/.test(r),'cleanup stays in the generated fixture root');rmSync(root,{recursive:true,force:true});}
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'auth-artifacts-'));try{const result=fn(root);if(result?.then)return result.finally(()=>dispose(root));dispose(root);return result;}catch(error){dispose(root);throw error;}}
function prepared(root){const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'});mkdirSync(store.directory,{recursive:true});return {store,path:join(store.directory,'core500-RESULT.json'),outside:join(root,'outside.json')};}
test('artifact default writes zero files and creates no sibling evidence directory',()=>fixture(root=>{
  const store=createArtifactStore({sourceDir:root,requestedDir:''});assert.equal(store.enabled,false);assert.equal(store.write('core500-RESULT.json',{status:'PASS'}),false);
  assert.equal(store.cleanup(),0);assert.deepEqual(readdirSync(root),[]);
}));
test('explicit deterministic output sanitizes machine fields and repeated writes produce identical bytes',()=>fixture(root=>{
  // Portable synthetic policy inputs, not a hardcoded user/machine path.
  const windowsPath=['C:','fixture','secret','test.ts'].join('\\'),unixPath=['','home','fixture','test.ts'].join('/');
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/auth-reference-scheduler'}),value={sourceRoot:root,runtimeExe:join(root,'node'),
    trace:{actions:[{type:'start',tab:'a'}],failure:{message:`Failed ${windowsPath} and ${unixPath}`}},status:'FAIL'};
  assert.equal(store.write('core500-failure-original.json',value),true);const path=join(root,'tmp/auth-reference-scheduler/core500-failure-original.json'),first=readFileSync(path,'utf8');
  store.write('core500-failure-original.json',value);assert.equal(readFileSync(path,'utf8'),first);assert.ok(!first.includes('sourceRoot')&&!first.includes('runtimeExe')&&!first.includes(root));
  assert.equal(JSON.parse(first).trace.failure.message,'Failed [local-path] and [local-path]');
  assert.deepEqual(JSON.parse(first).trace.actions,value.trace.actions);assert.throws(()=>store.write('gate-123-random-RESULT.json',{}),/namespace/);
  assert.equal(store.write('fixed-1-audit-lock-503-same-unlock.json',{trace:value.trace}),true);
}));
test('artifact directory rejects parent paths and source/tmp itself',()=>fixture(root=>{
  for(const requestedDir of ['../evidence/reference-scheduler','tmp','.',join(tmpdir(),'outside')])assert.throws(()=>createArtifactStore({sourceDir:root,requestedDir}),/child directory/);
}));
test('artifact directory rejects symlink or junction escape',()=>fixture(root=>{
  mkdirSync(join(root,'tmp'));mkdirSync(join(root,'elsewhere'));symlinkSync(join(root,'elsewhere'),join(root,'tmp/link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/link/result'}),/symlink or junction/);
}));
test('cleanup removes scheduler-owned files only and rechecks containment',()=>fixture(root=>{
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/auth-reference-scheduler'});store.write('core500-RESULT.json',{status:'PASS'});
  const other=join(store.directory,'reviewer-note.txt');writeFileSync(other,'keep');assert.equal(store.cleanup(),1);assert.equal(existsSync(other),true);
  assert.equal(store.cleanup(),0);assert.deepEqual(sanitizeArtifact({body:{expectedAddress:'0xabc'},relative:'src/world/auth.ts'}),{body:{expectedAddress:'0xabc'},relative:'src/world/auth.ts'});
}));

test('dangling output file symlink is observed and rejected without creating its outside target',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);symlinkSync(outside,path,'file');assert.equal(existsSync(path),false);assert.ok(lstatSync(path).isSymbolicLink());
  assert.throws(()=>store.write('core500-RESULT.json',{status:'PASS'}),/not a regular file/);assert.equal(existsSync(outside),false);assert.ok(lstatSync(path).isSymbolicLink());
}));
test('existing output file symlink is rejected and its outside bytes stay exact',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);writeFileSync(outside,'sentinel');symlinkSync(outside,path,'file');
  assert.throws(()=>store.write('core500-RESULT.json',{}),/not a regular file/);assert.equal(readFileSync(outside,'utf8'),'sentinel');
}));
test('directory symlink or Windows junction as final output is rejected',()=>fixture(root=>{
  const {store,path}=prepared(root),outside=join(root,'outside');mkdirSync(outside);symlinkSync(outside,path,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>store.write('core500-RESULT.json',{}),/not a regular file/);assert.deepEqual(readdirSync(outside),[]);
}));
test('dangling parent directory link fails closed before creating its target',()=>fixture(root=>{
  mkdirSync(join(root,'tmp'));const outside=join(root,'missing');symlinkSync(outside,join(root,'tmp/link'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/link/result'}),/symlink or junction/);assert.equal(existsSync(outside),false);
}));
test('configured artifact root and source/tmp cannot be junction or symlink aliases',()=>fixture(root=>{
  mkdirSync(join(root,'tmp'));mkdirSync(join(root,'outside'));symlinkSync(join(root,'outside'),join(root,'tmp/artifacts'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'}),/symlink or junction/);
  unlinkSync(join(root,'tmp/artifacts'));rmdirSync(join(root,'tmp'));symlinkSync(join(root,'outside'),join(root,'tmp'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'}),/symlink or junction/);assert.deepEqual(readdirSync(join(root,'outside')),[]);
}));
test('directory final target and non-directory parent are rejected',()=>fixture(root=>{
  const {store,path}=prepared(root);mkdirSync(path);assert.throws(()=>store.write('core500-RESULT.json',{}),/not a regular file/);
  writeFileSync(join(root,'tmp/not-directory'),'sentinel');assert.throws(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/not-directory/result'}),/not a directory|ENOTDIR/);
}));
test('existing regular file is replaced completely without mutating its outside hard-link alias',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);writeFileSync(path,'old sentinel');linkSync(path,outside);
  assert.equal(store.write('core500-RESULT.json',{status:'PASS'}),true);assert.equal(readFileSync(path,'utf8'),'{\n  "status": "PASS"\n}\n');
  assert.equal(readFileSync(outside,'utf8'),'old sentinel');assert.deepEqual(readdirSync(store.directory),['core500-RESULT.json']);
}));
test('deterministic target substitution during serialization is rejected at finalization',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);writeFileSync(path,'sentinel');let substitutions=0;
  const value={get status(){substitutions++;unlinkSync(path);symlinkSync(outside,path,'file');return 'PASS';}};
  assert.throws(()=>store.write('core500-RESULT.json',value),/not a regular file/);assert.equal(substitutions,1);assert.equal(existsSync(outside),false);
  assert.ok(lstatSync(path).isSymbolicLink());assert.deepEqual(readdirSync(store.directory),['core500-RESULT.json'],'failed temp is removed without touching link target');
}));
test('deterministic parent substitution during serialization rejects an outside-root finalization',()=>fixture(root=>{
  const {store,outside}=prepared(root),outsideDir=join(root,'outside-dir'),parked=join(root,'tmp/parked');mkdirSync(outsideDir);
  const value={get status(){renameSync(store.directory,parked);symlinkSync(outsideDir,store.directory,process.platform==='win32'?'junction':'dir');return 'PASS';}};
  assert.throws(()=>store.write('core500-RESULT.json',value),/symlink or junction|parent changed/);assert.deepEqual(readdirSync(outsideDir),[]);assert.equal(existsSync(outside),false);
}));
test('absolute local path masking covers arbitrary POSIX roots, drive paths, UNC and nested errors',()=>{
  for(const path of ['/root/reviewer/private/project.ts','/home/user/project/file.ts','/Users/alice/project/file.ts','C:\\Users\\alice\\project\\file.ts',
    'D:/work/project/file.ts','/tmp/reviewer/file.json','/var/reviewer/private.ts','/opt/work/file.ts','\\\\server\\share\\private.ts','file:///root/private.ts']){
    assert.equal(sanitizeArtifact(path),'[local-path]',path);assert.equal(sanitizeArtifact({error:{message:`Error: failed at ${path}`}}).error.message,'Error: failed at [local-path]');
  }
  assert.equal(sanitizeArtifact('Error at "/any root/private directory/file.ts"'),'Error at "[local-path]"');
  assert.equal(sanitizeArtifact('Error at "C:\\private directory\\file.ts"'),'Error at "[local-path]"');
  assert.equal(sanitizeArtifact('/arbitrary root/private directory/file.ts'),'[local-path]');assert.equal(sanitizeArtifact('/'),'[local-path]');
  assert.deepEqual(sanitizeArtifact({'/arbitrary/private.ts':{relative:'tests/auth-artifacts.test.mjs'}}),{'[local-path]':{relative:'tests/auth-artifacts.test.mjs'}});
});
test('persisted bare absolute diagnostics redact complete spaced and parenthesized path suffixes',()=>fixture(root=>{
  const {store,path}=prepared(root),paths=['/root/private directory/project.ts','C:\\reviewer\\private directory\\project.ts',
    '/root/reviewer (private)/project.ts','C:\\reviewer (private)\\project.ts','\\\\server\\private directory\\project.ts',
    'C://Users/alice/private.ts','D:///work/private directory/project.ts','E:\\private directory\\project.ts','\\Users\\alice\\private.ts'];
  store.write('core500-RESULT.json',{nested:{errors:paths.map(path=>({message:`Error at ${path}`}))},
    multiline:'Error at /root/private directory/project.ts\nrelative tests/auth-artifacts.test.mjs\nhttps://example.com/root/project.ts',
    quoted:'Error at "/root/private directory/project.ts"; relative tests/auth-artifacts.test.mjs',
    quotedWindows:'Error at "\\Users\\alice\\private.ts"; relative tests/auth-artifacts.test.mjs',
    inlineURL:'Error at /root/private directory/project.ts https://example.com/root/project.ts',
    relative:'tests/auth-artifacts.test.mjs',url:'https://example.com/root/project.ts',route:'/api/auth/session',
    events:[{index:0,type:'headers',id:'r1'},{index:1,type:'body',id:'r1'}],nonce:'n1',classification:'ABSENT'});
  const bytes=readFileSync(path,'utf8'),saved=JSON.parse(bytes);
  assert.deepEqual(saved.nested.errors,paths.map(()=>({message:'Error at [local-path]'})));
  assert.equal(saved.multiline,'Error at [local-path]\nrelative tests/auth-artifacts.test.mjs\nhttps://example.com/root/project.ts');
  assert.equal(saved.quoted,'Error at "[local-path]"; relative tests/auth-artifacts.test.mjs');
  assert.equal(saved.quotedWindows,'Error at "[local-path]"; relative tests/auth-artifacts.test.mjs');
  assert.equal(sanitizeArtifact('\\Users\\alice\\private.ts'),'[local-path]');assert.equal(sanitizeArtifact('C:relative\\file.ts'),'C:relative\\file.ts');
  assert.equal(saved.inlineURL,'Error at [local-path] https://example.com/root/project.ts');
  assert.ok(!bytes.includes('private directory')&&!bytes.includes('(private)'));
  assert.equal(saved.relative,'tests/auth-artifacts.test.mjs');assert.equal(saved.url,'https://example.com/root/project.ts');assert.equal(saved.route,'/api/auth/session');
  assert.deepEqual(saved.events,[{index:0,type:'headers',id:'r1'},{index:1,type:'body',id:'r1'}]);assert.equal(saved.nonce,'n1');assert.equal(saved.classification,'ABSENT');
}));
test('network URLs, relative paths, scheduler route IDs, actions and aliases retain semantic bytes',()=>{
  const value={url:'https://example.com/root/project.ts',urls:'see https://example.com/root/file.ts and https://other.test/var/data?q=1',
    relative:'tests/auth-artifacts.test.mjs',fixture:'./fixtures/auth.json',parent:'../fixtures/auth.json',route:'/api/auth/session',
    actions:[{type:'headers',id:'r1'},{type:'body',id:'r1'}],nonce:'n1',eventId:'r1',classification:'ABSENT'};
  assert.deepEqual(sanitizeArtifact(value),value);
});
test('saved sanitized artifact retains a complete non-vacuous real-Worker replay',()=>fixture(async root=>{
  const {runSeed}=await import('./auth-scheduler-driver.mjs'),trace=await runSeed(0,{retainTrace:true});assert.ok(trace.actions.length>5);assert.ok(trace.metrics.workerCalls>=2);
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'});store.write('core500-failure-original.json',
    {trace,diagnostics:{message:'Error: failed at /root/reviewer/private/project.ts',url:'https://example.com/root/project.ts',relative:'tests/auth-artifacts.test.mjs'}});
  const saved=JSON.parse(readFileSync(join(store.directory,'core500-failure-original.json'),'utf8'));
  assert.equal(saved.diagnostics.message,'Error: failed at [local-path]');assert.deepEqual(saved.trace.actions,trace.actions);assert.deepEqual(saved.trace.events,trace.events);
  const replay=await runSeed(saved.trace.seed,{replayActions:saved.trace.actions,retainTrace:true});
  assert.equal(replay.traceDigest,trace.traceDigest);assert.deepEqual(replay.counts,trace.counts);assert.deepEqual(replay.projections,trace.projections);
  assert.ok(replay.metrics.workerCalls>=2);assert.equal(saved.diagnostics.url,'https://example.com/root/project.ts');
}));

// The actual CLI is a separate output sink. Keep its real causal driver, filesystem,
// namespace and final-link controls in the supported test file, without a stub.
const checkout=resolve(import.meta.dirname,'..');
let cliTrace;
async function failureInput(root,{invalid=true}={}){
  cliTrace??=(await import('./auth-scheduler-driver.mjs')).runSeed(0,{retainTrace:true});
  const trace=structuredClone(await cliTrace);assert.ok(trace.actions.length>5);assert.ok(trace.metrics.workerCalls>=2);
  if(invalid)trace.actions.push({type:'worker',id:trace.actions.find(action=>action.type==='worker').id});
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/store'});
  store.write('core500-failure-original.json',{trace});
  const input=join(store.directory,'core500-failure-original.json');
  return {trace,store,input,before:readFileSync(input),output:join(store.directory,'core500-failure-minimized.json')};
}
async function cliFixture(fn){
  const allowed=join(checkout,'tmp');mkdirSync(allowed,{recursive:true});
  assert.ok(!lstatSync(allowed).isSymbolicLink()&&realpathSync(allowed)===allowed,'CLI fixtures need the actual contained checkout/tmp');
  const root=mkdtempSync(join(allowed,'auth-artifact-cli-'));
  try{return await fn(root);}finally{
    const r=relative(allowed,root);assert.ok(!isAbsolute(r)&&/^auth-artifact-cli-[^\\/]+$/.test(r));rmSync(root,{recursive:true,force:true});
  }
}
function replayCLI(input,output){
  const env={...process.env};
  for(const key of Object.keys(env))if(key==='NODE_TEST_CONTEXT'||key==='NODE_OPTIONS'||key==='AUTH_REFERENCE_ARTIFACT_DIR'||key.endsWith('_SOURCE'))delete env[key];
  const args=[join(checkout,'scripts/replay-auth-trace.mjs'),'--replay',input];if(output!==undefined)args.push('--minimize',output);
  const child=spawnSync(process.execPath,args,{cwd:checkout,encoding:'utf8',env,timeout:60_000});
  assert.equal(child.error,undefined,'real CLI must execute rather than an environment/timeout substitute');return child;
}
test('Audit9 minimization CLI rejects a dangling final file symlink without creating its target',()=>cliFixture(async root=>{
  const {input,output,before}=await failureInput(root),outside=join(root,'outside.json');symlinkSync(outside,output,'file');
  assert.equal(existsSync(outside),false);assert.ok(lstatSync(output).isSymbolicLink());
  const child=replayCLI(input,output);assert.equal(child.status,1);assert.equal(existsSync(outside),false,'unsafe minimize sink must not create outside target');
  assert.ok(lstatSync(output).isSymbolicLink());assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/ARTIFACT_REJECTED/);
}));
test('Audit9 minimization CLI rejects an existing final file symlink and preserves target bytes',()=>cliFixture(async root=>{
  const {input,output,before}=await failureInput(root),outside=join(root,'outside.json');writeFileSync(outside,'outside sentinel');symlinkSync(outside,output,'file');
  const child=replayCLI(input,output);assert.equal(child.status,1);assert.equal(readFileSync(outside,'utf8'),'outside sentinel');
  assert.ok(lstatSync(output).isSymbolicLink());assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/ARTIFACT_REJECTED/);
}));
test('Audit9 minimization CLI rejects nonregular final output through the validated writer',()=>cliFixture(async root=>{
  const {input,output,before}=await failureInput(root);mkdirSync(output);
  const child=replayCLI(input,output);assert.equal(child.status,1);assert.deepEqual(readdirSync(output),[]);
  assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/ARTIFACT_REJECTED/);
}));
test('Audit9 minimization CLI refuses parent directory aliases without following them',()=>cliFixture(async root=>{
  const {input,before}=await failureInput(root),outside=join(root,'outside'),alias=join(root,'tmp/alias');mkdirSync(outside);
  symlinkSync(outside,alias,process.platform==='win32'?'junction':'dir');
  const child=replayCLI(input,join(alias,'core500-failure-minimized.json'));assert.equal(child.status,1);
  assert.deepEqual(readdirSync(outside),[]);assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/symlink or junction/);
}));
test('Audit9 minimization CLI refuses outputs outside checkout/tmp and invalid scheduler names',()=>fixture(outside=>cliFixture(async root=>{
  const {input,before}=await failureInput(root),outsideOutput=join(outside,'core500-failure-minimized.json');
  for(const target of [outsideOutput,join(checkout,'core500-failure-minimized.json'),join(checkout,'tmp/core500-failure-minimized.json')]){
    assert.equal(existsSync(target),false,'boundary fixture starts without an existing target');
    const escaped=replayCLI(input,target);assert.equal(escaped.status,1);assert.equal(existsSync(target),false);
    assert.match(escaped.stderr,/child directory of source\/tmp/);
  }
  const invalid=join(root,'tmp/store/private-output.json'),wrongName=replayCLI(input,invalid);assert.equal(wrongName.status,1);
  assert.equal(existsSync(invalid),false);assert.match(wrongName.stderr,/scheduler namespace/);assert.deepEqual(readFileSync(input),before);
})));
test('Audit9 minimization CLI never overwrites its replay input',()=>cliFixture(async root=>{
  const {input,before}=await failureInput(root),child=replayCLI(input,input);assert.equal(child.status,1);
  assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/separate from the replay input/);
}));
test('Audit9 minimization CLI writes and safely replaces a regular contained artifact with real replay data',()=>cliFixture(async root=>{
  const {input,output,before,trace}=await failureInput(root);writeFileSync(output,'regular sentinel');
  for(let i=0;i<2;i++){
    const child=replayCLI(input,output);assert.equal(child.status,1,'HARNESS-CAUSAL intentionally exercises the failure/minimize sink');
    assert.match(child.stderr,/HARNESS-CAUSAL/);assert.doesNotMatch(child.stderr,/ARTIFACT_REJECTED/);
    const saved=JSON.parse(readFileSync(output,'utf8'));assert.equal(saved.invariant,'HARNESS-CAUSAL');
    assert.equal(saved.trace.minimization.reproduced,true);assert.equal(saved.trace.minimization.originalEvents,trace.actions.length);
    assert.ok(saved.trace.actions.length>0);assert.deepEqual(readFileSync(input),before);
  }
  assert.deepEqual(readdirSync(dirnameOf(input)).sort(),['core500-failure-minimized.json','core500-failure-original.json']);
}));
function dirnameOf(path){return resolve(path,'..');}
test('Audit9 successful default CLI replay creates no minimized artifact',()=>cliFixture(async root=>{
  const {input,before,store}=await failureInput(root,{invalid:false}),child=replayCLI(input);assert.equal(child.status,0);
  const result=JSON.parse(child.stdout);assert.equal(result.status,'PASS');assert.ok(result.metrics.workerCalls>=2);
  assert.deepEqual(readdirSync(store.directory),['core500-failure-original.json']);assert.deepEqual(readFileSync(input),before);
}));
test('Audit9 minimization CLI preserves replay input identity through an existing directory alias',t=>cliFixture(async root=>{
  const {input,output,before,store,trace}=await failureInput(root),alias=join(root,'tmp/input-alias');
  symlinkSync(store.directory,alias,process.platform==='win32'?'junction':'dir');assert.ok(lstatSync(alias).isSymbolicLink());
  const aliasedInput=join(alias,'core500-failure-original.json');assert.notEqual(resolve(aliasedInput),resolve(input));
  assert.equal(realpathSync(aliasedInput),realpathSync(input));assert.equal(readFileSync(aliasedInput).equals(before),true);
  const safe=replayCLI(aliasedInput,output);assert.equal(safe.status,1);assert.match(safe.stderr,/HARNESS-CAUSAL/);assert.doesNotMatch(safe.stderr,/ARTIFACT_REJECTED/);
  const minimizedBytes=readFileSync(output),saved=JSON.parse(minimizedBytes);assert.equal(saved.invariant,'HARNESS-CAUSAL');
  assert.equal(saved.trace.minimization.reproduced,true);assert.equal(saved.trace.minimization.originalEvents,trace.actions.length);
  assert.ok(lstatSync(output).isFile()&&!lstatSync(output).isSymbolicLink());assert.equal(readFileSync(input).equals(before),true);
  assert.equal(readFileSync(aliasedInput).equals(before),true);t.diagnostic('real directory alias: separate safe output written; both input views unchanged');
  const collision=replayCLI(aliasedInput,input);assert.equal(collision.status,1);
  assert.equal(readFileSync(input).equals(before),true,'the canonical input must survive an aliased input/output collision');
  assert.equal(readFileSync(aliasedInput).equals(before),true);assert.equal(readFileSync(output).equals(minimizedBytes),true);
  assert.match(collision.stderr,/ARTIFACT_REJECTED/);assert.match(collision.stderr,/separate from the replay input/);
  const malformed=join(root,'malformed-input.json');writeFileSync(malformed,'{not valid JSON');
  for(const badInput of [join(root,'missing-input.json'),malformed]){
    const failed=replayCLI(badInput,output);assert.equal(failed.status,1);assert.equal(failed.stdout,'');
    assert.equal(JSON.parse(failed.stderr).invariant,'REPLAY_ERROR');assert.equal(readFileSync(output).equals(minimizedBytes),true);
    assert.equal(readFileSync(input).equals(before),true);
  }
  assert.deepEqual(readdirSync(store.directory).sort(),['core500-failure-minimized.json','core500-failure-original.json']);
}));

test('Audit9 persisted route-prefix filenames are masked while exact protocol routes and replay identities survive',()=>fixture(root=>{
  const {store,path}=prepared(root);
  const filenames=['/api/auth/session.log','/api/auth/verify.backup','/api/me/home.private.json','/api/auth/logout-all.json',
    '/api/auth/session/secret.json','/api/auth/session?token=private','/api/auth/session#private','/api/auth/session;private.json','/api/auth/session,private.json'];
  const routes=['/api/auth/session','/api/auth/challenge','/api/auth/verify','/api/auth/logout','/api/auth/logout-all','/api/me/home','/api/me/home?fresh=1','/api/me/home/refresh'];
  const control={relative:'tests/auth-artifacts.test.mjs',parent:'../fixtures/auth.json',url:'https://example.com/api/auth/session.log',
    actions:[{type:'start',tab:'a'},{type:'headers',id:'r1'}],events:[{index:0,type:'headers',id:'r1'}],nonce:'n1',classification:'ABSENT'};
  store.write('core500-RESULT.json',{nested:{errors:filenames.map(path=>({message:`Error at ${path}`}))},routes,
    quoted:filenames.map(path=>`Cannot read "${path}"`),exactQuoted:routes.map(path=>`route "${path}"`),control,
    key:{'/api/auth/session.log':'masked filename key'},knownOther:'Cannot read /var/private/session.log'});
  const saved=JSON.parse(readFileSync(path,'utf8'));
  assert.deepEqual(saved.nested.errors,filenames.map(()=>({message:'Error at [local-path]'})));
  assert.deepEqual(saved.quoted,filenames.map(()=>'Cannot read "[local-path]"'));assert.deepEqual(saved.routes,routes);
  assert.deepEqual(saved.exactQuoted,routes.map(path=>`route "${path}"`));assert.deepEqual(saved.control,control);
  assert.deepEqual(saved.key,{'[local-path]':'masked filename key'});assert.equal(saved.knownOther,'Cannot read [local-path]');
}));
