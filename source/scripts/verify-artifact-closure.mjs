// Exit 0 means every assertion passed, not merely that the probe finished.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync,readFileSync,existsSync,lstatSync,readdirSync,rmSync,unlinkSync,renameSync,linkSync,realpathSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {sanitizeArtifact as safeReport} from '../tests/auth-artifacts.mjs';

const checkout=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
if(args.length!==0&&(args.length!==2||args[0]!=='--artifact-source'))throw new Error('Usage: node scripts/verify-artifact-closure.mjs [--artifact-source checkout]');
const artifactSource=args.length?resolve(args[1]):checkout,modulePath=join(artifactSource,'tests/auth-artifacts.mjs');
const {createArtifactStore,sanitizeArtifact}=await import(pathToFileURL(modulePath).href);
const checks=[];
async function check(id,fn){try{const observed=await fn();checks.push({id,status:'PASS',observed:observed??null});}
  catch(error){checks.push({id,status:'FAIL',error:safeReport({name:error.name,code:error.code??null,message:error.message})});}}
async function fixture(fn){
  const root=mkdtempSync(join(tmpdir(),'artifact-closure-'));
  try{return await fn(root);}finally{
    const r=relative(resolve(tmpdir()),resolve(root));assert.ok(!isAbsolute(r)&&/^artifact-closure-[^\\/]+$/.test(r),'fixture cleanup must stay in generated temp root');
    rmSync(root,{recursive:true,force:true});
  }
}
function prepared(root){const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'});mkdirSync(store.directory,{recursive:true});return {store,path:join(store.directory,'core500-RESULT.json'),outside:join(root,'outside.json')};}
function rejection(fn){try{fn();return false;}catch(error){if(error.code==='EPERM'||error.code==='EACCES')throw error;return true;}}
const cliPath=join(artifactSource,'scripts/replay-auth-trace.mjs');
let causalTrace;
async function cliFixture(fn){
  const allowed=join(artifactSource,'tmp');mkdirSync(allowed,{recursive:true});
  assert.ok(!lstatSync(allowed).isSymbolicLink()&&realpathSync(allowed)===allowed);
  const root=mkdtempSync(join(allowed,'artifact-closure-cli-'));
  try{return await fn(root);}finally{
    const r=relative(allowed,root);assert.ok(!isAbsolute(r)&&/^artifact-closure-cli-[^\\/]+$/.test(r));rmSync(root,{recursive:true,force:true});
  }
}
async function cliInput(root,{invalid=true}={}){
  // Generate a real non-vacuous causal trace, then deliberately repeat a completed
  // Worker action to exercise the minimization sink, not an Auth vulnerability.
  causalTrace??=(await import('../tests/auth-scheduler-driver.mjs')).runSeed(0,{retainTrace:true});
  const trace=structuredClone(await causalTrace);assert.ok(trace.actions.length>5);assert.ok(trace.metrics.workerCalls>=2);
  if(invalid)trace.actions.push({type:'worker',id:trace.actions.find(action=>action.type==='worker').id});
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/store'});store.write('core500-failure-original.json',{trace});
  const input=join(store.directory,'core500-failure-original.json');
  return {store,trace,input,before:readFileSync(input),output:join(store.directory,'core500-failure-minimized.json')};
}
function replayCLI(input,output){
  const env={...process.env};for(const key of Object.keys(env))if(key==='NODE_TEST_CONTEXT'||key==='NODE_OPTIONS'||key==='AUTH_REFERENCE_ARTIFACT_DIR'||key.endsWith('_SOURCE'))delete env[key];
  const argv=[cliPath,'--replay',input];if(output!==undefined)argv.push('--minimize',output);
  const child=spawnSync(process.execPath,argv,{cwd:artifactSource,encoding:'utf8',env,timeout:60_000});
  assert.equal(child.error,undefined,'the actual selected CLI must execute');return child;
}

await check('H-A1-dangling-output-file-symlink',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);symlinkSync(outside,path,'file');assert.ok(lstatSync(path).isSymbolicLink());assert.equal(existsSync(path),false);
  const rejected=rejection(()=>store.write('core500-RESULT.json',{status:'PASS'})),outsideCreated=existsSync(outside);
  assert.equal(rejected,true,'dangling output must be rejected');assert.equal(outsideCreated,false,'outside target must stay absent');
  return {realFileSymlink:true,targetExistedBefore:false,rejected,outsideCreated};
}));
await check('H-A2-existing-output-file-symlink',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);writeFileSync(outside,'sentinel');symlinkSync(outside,path,'file');assert.ok(lstatSync(path).isSymbolicLink());
  assert.equal(rejection(()=>store.write('core500-RESULT.json',{})),true);assert.equal(readFileSync(outside,'utf8'),'sentinel');return {realFileSymlink:true,targetBytesUnchanged:true};
}));
await check('H-A3-final-directory-link',()=>fixture(root=>{
  const {store,path}=prepared(root),outsideDir=join(root,'outside-dir');mkdirSync(outsideDir);symlinkSync(outsideDir,path,process.platform==='win32'?'junction':'dir');
  assert.ok(lstatSync(path).isSymbolicLink());assert.equal(rejection(()=>store.write('core500-RESULT.json',{})),true);assert.deepEqual(readdirSync(outsideDir),[]);
  return {type:process.platform==='win32'?'junction':'directory-symlink',outsideCreated:false};
}));
await check('H-A3-dangling-parent-link',()=>fixture(root=>{
  mkdirSync(join(root,'tmp'));const outsideDir=join(root,'missing');symlinkSync(outsideDir,join(root,'tmp/link'),process.platform==='win32'?'junction':'dir');
  assert.equal(rejection(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/link/output'})),true);assert.equal(existsSync(outsideDir),false);return {outsideCreated:false};
}));
await check('H-A3-artifact-root-link',()=>fixture(root=>{
  mkdirSync(join(root,'tmp'));mkdirSync(join(root,'outside'));symlinkSync(join(root,'outside'),join(root,'tmp/artifacts'),process.platform==='win32'?'junction':'dir');
  assert.equal(rejection(()=>createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'})),true);return {rejected:true};
}));
await check('H-A4-H-A5-regular-write-safe-replacement',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);assert.equal(store.write('core500-RESULT.json',{status:'PASS'}),true);
  const first=readFileSync(path,'utf8');assert.equal(first,'{\n  "status": "PASS"\n}\n');linkSync(path,outside);
  assert.equal(store.write('core500-RESULT.json',{status:'FAIL'}),true);assert.equal(readFileSync(outside,'utf8'),first);
  assert.equal(readFileSync(path,'utf8'),'{\n  "status": "FAIL"\n}\n');assert.deepEqual(readdirSync(store.directory),['core500-RESULT.json']);
  return {regularWrite:true,exactBytes:true,replacementPolicy:'replace-entry',hardLinkAliasUnchanged:true};
}));
await check('H-A6-nonregular-directory',()=>fixture(root=>{
  const {store,path}=prepared(root);mkdirSync(path);assert.equal(rejection(()=>store.write('core500-RESULT.json',{})),true);return {rejected:true};
}));
await check('H-A7-final-entry-replacement-control',()=>fixture(root=>{
  const {store,path,outside}=prepared(root);writeFileSync(path,'sentinel');let substitutions=0;
  const value={get status(){substitutions++;unlinkSync(path);symlinkSync(outside,path,'file');return 'PASS';}};
  assert.equal(rejection(()=>store.write('core500-RESULT.json',value)),true);assert.equal(substitutions,1);assert.equal(existsSync(outside),false);
  assert.ok(lstatSync(path).isSymbolicLink());return {substitutions,rejected:true,outsideCreated:false};
}));
await check('H-A7-parent-replacement-control',()=>fixture(root=>{
  const {store}=prepared(root),parked=join(root,'tmp/parked'),outsideDir=join(root,'outside-dir');mkdirSync(outsideDir);let substitutions=0;
  const value={get status(){substitutions++;renameSync(store.directory,parked);symlinkSync(outsideDir,store.directory,process.platform==='win32'?'junction':'dir');return 'PASS';}};
  assert.equal(rejection(()=>store.write('core500-RESULT.json',value)),true);assert.equal(substitutions,1);assert.deepEqual(readdirSync(outsideDir),[]);
  return {substitutions,rejected:true,outsideCreated:false};
}));
await check('H-S1-generalized-local-path-masking',()=>{
  const paths=['/root/reviewer/private/project.ts','/home/user/project/file.ts','/Users/alice/project/file.ts','C:\\Users\\alice\\project\\file.ts',
    'D:/work/project/file.ts','/tmp/reviewer/file.json','/opt/private/project.ts','/var/local/private.ts','\\\\server\\share\\private.ts','file:///root/private.ts'];
  for(const path of paths){assert.equal(sanitizeArtifact(path),'[local-path]');assert.equal(sanitizeArtifact({error:{message:`Error: failed at ${path}`}}).error.message,'Error: failed at [local-path]');}
  assert.equal(sanitizeArtifact('Error at "/arbitrary root/private directory/file.ts"'),'Error at "[local-path]"');
  assert.equal(sanitizeArtifact('/arbitrary root/private directory/file.ts'),'[local-path]');assert.equal(sanitizeArtifact('/'),'[local-path]');
  assert.deepEqual(sanitizeArtifact({'/arbitrary/private.ts':'retained'}),{'[local-path]':'retained'});
  return {syntheticPathForms:paths.length,nestedErrors:true,quotedSpaces:true,absoluteValueSpaces:true,absoluteKeys:true};
});
await check('H-S2-URL-relative-path-protocol-identity-preservation',()=>{
  const value={url:'https://example.com/root/project.ts',relative:'tests/auth-artifacts.test.mjs',fixture:'../fixtures/auth.json',route:'/api/auth/session',
    actions:[{type:'headers',id:'r1'},{type:'body',id:'r1'}],nonce:'n1',classification:'ABSENT'};
  assert.deepEqual(sanitizeArtifact(value),value);return {url:true,relative:true,route:true,actions:true,nonceAlias:true,eventOrder:true};
});
await check('H-S3-persisted-spaced-parenthesized-diagnostics',()=>fixture(root=>{
  const {store,path}=prepared(root),paths=['/root/private directory/project.ts','C:\\reviewer\\private directory\\project.ts',
    '/root/reviewer (private)/project.ts','C:\\reviewer (private)\\project.ts','\\\\server\\private directory\\project.ts',
    'C://Users/alice/private.ts','D:///work/private directory/project.ts','E:\\private directory\\project.ts','\\Users\\alice\\private.ts'];
  store.write('core500-RESULT.json',{nested:{errors:paths.map(path=>({message:`Error at ${path}`}))},
    multiline:'Error at /root/private directory/project.ts\nrelative tests/auth-artifacts.test.mjs\nhttps://example.com/root/project.ts',
    inlineURL:'Error at /root/private directory/project.ts https://example.com/root/project.ts',
    relative:'tests/auth-artifacts.test.mjs',url:'https://example.com/root/project.ts',route:'/api/auth/session',
    events:[{index:0,type:'headers',id:'r1'},{index:1,type:'body',id:'r1'}],nonce:'n1',classification:'ABSENT'});
  const bytes=readFileSync(path,'utf8'),saved=JSON.parse(bytes);assert.deepEqual(saved.nested.errors,paths.map(()=>({message:'Error at [local-path]'})));
  assert.equal(saved.multiline,'Error at [local-path]\nrelative tests/auth-artifacts.test.mjs\nhttps://example.com/root/project.ts');
  assert.equal(saved.inlineURL,'Error at [local-path] https://example.com/root/project.ts');assert.ok(!bytes.includes('private directory')&&!bytes.includes('(private)'));
  assert.equal(sanitizeArtifact('\\Users\\alice\\private.ts'),'[local-path]');assert.equal(sanitizeArtifact('Error at "\\Users\\alice\\private.ts"'),'Error at "[local-path]"');
  assert.equal(sanitizeArtifact('C:relative\\file.ts'),'C:relative\\file.ts');
  assert.equal(saved.relative,'tests/auth-artifacts.test.mjs');assert.equal(saved.url,'https://example.com/root/project.ts');assert.equal(saved.route,'/api/auth/session');
  assert.deepEqual(saved.events,[{index:0,type:'headers',id:'r1'},{index:1,type:'body',id:'r1'}]);assert.equal(saved.nonce,'n1');assert.equal(saved.classification,'ABSENT');
  return {spacedParenthesizedForms:paths.length,persistedNestedErrors:true,multilineAndStructuredIdentitiesPreserved:true};
}));
await check('H-R1-actual-saved-trace-nonvacuous-replay',()=>fixture(async root=>{
  // Always the current checkout's real causal driver; alternate selects only the artifact store.
  const {runSeed}=await import('../tests/auth-scheduler-driver.mjs'),trace=await runSeed(0,{retainTrace:true});
  assert.ok(trace.actions.length>5);assert.ok(trace.metrics.workerCalls>=2);
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'});store.write('core500-failure-original.json',
    {trace,error:{message:'Error: failed at /root/reviewer/private/project.ts'}});
  const saved=JSON.parse(readFileSync(join(store.directory,'core500-failure-original.json'),'utf8'));
  assert.equal(saved.error.message,'Error: failed at [local-path]');assert.deepEqual(saved.trace.actions,trace.actions);assert.deepEqual(saved.trace.events,trace.events);
  const replay=await runSeed(saved.trace.seed,{retainTrace:true,replayActions:saved.trace.actions});assert.equal(replay.traceDigest,trace.traceDigest);
  assert.deepEqual(replay.counts,trace.counts);assert.deepEqual(replay.projections,trace.projections);assert.ok(replay.metrics.workerCalls>=2);
  return {actions:trace.actions.length,workerCalls:replay.metrics.workerCalls,dbComparisons:replay.metrics.dbComparisons,traceDigest:replay.traceDigest,classificationUnchanged:true};
}));
await check('H-C1-real-CLI-dangling-output-symlink',()=>cliFixture(async root=>{
  const {input,output,before}=await cliInput(root),outside=join(root,'outside.json');symlinkSync(outside,output,'file');
  assert.ok(lstatSync(output).isSymbolicLink());assert.equal(existsSync(outside),false);
  const child=replayCLI(input,output);assert.equal(child.status,1);assert.equal(existsSync(outside),false,'CLI must not create a dangling link target');
  assert.ok(lstatSync(output).isSymbolicLink());assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/ARTIFACT_REJECTED/);
  return {actualCLI:true,realFileSymlink:true,targetCreated:false,inputBytesUnchanged:true};
}));
await check('H-C2-real-CLI-existing-output-symlink',()=>cliFixture(async root=>{
  const {input,output,before}=await cliInput(root),outside=join(root,'outside.json');writeFileSync(outside,'outside sentinel');symlinkSync(outside,output,'file');
  const child=replayCLI(input,output);assert.equal(child.status,1);assert.equal(readFileSync(outside,'utf8'),'outside sentinel');
  assert.ok(lstatSync(output).isSymbolicLink());assert.deepEqual(readFileSync(input),before);assert.match(child.stderr,/ARTIFACT_REJECTED/);
  return {actualCLI:true,realFileSymlink:true,targetBytesUnchanged:true,inputBytesUnchanged:true};
}));
await check('H-C3-real-CLI-boundary-nonregular-parent-and-input-controls',()=>fixture(outside=>cliFixture(async root=>{
  const {input,output,before}=await cliInput(root);mkdirSync(output);
  const nonregular=replayCLI(input,output);assert.equal(nonregular.status,1);assert.match(nonregular.stderr,/ARTIFACT_REJECTED/);assert.deepEqual(readdirSync(output),[]);
  for(const escaped of [join(outside,'core500-failure-minimized.json'),join(artifactSource,'core500-failure-minimized.json'),join(artifactSource,'tmp/core500-failure-minimized.json')]){
    assert.equal(existsSync(escaped),false,'boundary fixture starts without an existing target');
    const escape=replayCLI(input,escaped);assert.equal(escape.status,1);assert.match(escape.stderr,/child directory of source\/tmp/);assert.equal(existsSync(escaped),false);
  }
  const invalid=join(root,'tmp/store/private-output.json'),namespace=replayCLI(input,invalid);assert.equal(namespace.status,1);
  assert.match(namespace.stderr,/scheduler namespace/);assert.equal(existsSync(invalid),false);
  const outsideDir=join(root,'outside-dir'),alias=join(root,'tmp/alias');mkdirSync(outsideDir);symlinkSync(outsideDir,alias,process.platform==='win32'?'junction':'dir');
  const parent=replayCLI(input,join(alias,'core500-failure-minimized.json'));assert.equal(parent.status,1);assert.match(parent.stderr,/symlink or junction/);assert.deepEqual(readdirSync(outsideDir),[]);
  const collision=replayCLI(input,input);assert.equal(collision.status,1);assert.match(collision.stderr,/separate from the replay input/);
  assert.deepEqual(readFileSync(input),before);return {actualCLI:true,nonregularRejected:true,outsideRootRejected:true,namespaceRejected:true,parentLinkRejected:true,inputBytesUnchanged:true};
})));
await check('H-C4-real-CLI-regular-replacement-and-default-replay',()=>cliFixture(async root=>{
  const {input,output,before,trace}=await cliInput(root);writeFileSync(output,'regular sentinel');
  for(let i=0;i<2;i++){
    const child=replayCLI(input,output);assert.equal(child.status,1);assert.match(child.stderr,/HARNESS-CAUSAL/);assert.doesNotMatch(child.stderr,/ARTIFACT_REJECTED/);
    const saved=JSON.parse(readFileSync(output,'utf8'));assert.equal(saved.invariant,'HARNESS-CAUSAL');assert.equal(saved.trace.minimization.reproduced,true);
    assert.equal(saved.trace.minimization.originalEvents,trace.actions.length);assert.ok(saved.trace.actions.length>0);assert.deepEqual(readFileSync(input),before);
  }
  assert.deepEqual(readdirSync(resolve(input,'..')).sort(),['core500-failure-minimized.json','core500-failure-original.json']);
  const successRoot=join(root,'success');mkdirSync(successRoot);
  const success=await cliInput(successRoot,{invalid:false}),normal=replayCLI(success.input);assert.equal(normal.status,0);
  const result=JSON.parse(normal.stdout);assert.equal(result.status,'PASS');assert.ok(result.metrics.workerCalls>=2);
  assert.deepEqual(readFileSync(success.input),success.before);assert.deepEqual(readdirSync(success.store.directory),['core500-failure-original.json']);
  return {actualCLI:true,regularWriteAndReplacement:true,realFailureInvariant:'HARNESS-CAUSAL',originalActions:trace.actions.length,defaultReplayWorkerCalls:result.metrics.workerCalls};
}));
await check('H-C5-real-CLI-input-directory-alias-identity',()=>cliFixture(async root=>{
  const {input,output,before,store,trace}=await cliInput(root),alias=join(root,'tmp/input-alias');
  symlinkSync(store.directory,alias,process.platform==='win32'?'junction':'dir');assert.ok(lstatSync(alias).isSymbolicLink());
  const aliasedInput=join(alias,'core500-failure-original.json');assert.notEqual(resolve(aliasedInput),resolve(input));
  assert.equal(realpathSync(aliasedInput),realpathSync(input));assert.equal(readFileSync(aliasedInput).equals(before),true);
  const safe=replayCLI(aliasedInput,output);assert.equal(safe.status,1);assert.match(safe.stderr,/HARNESS-CAUSAL/);assert.doesNotMatch(safe.stderr,/ARTIFACT_REJECTED/);
  const minimizedBytes=readFileSync(output),saved=JSON.parse(minimizedBytes);assert.equal(saved.invariant,'HARNESS-CAUSAL');
  assert.equal(saved.trace.minimization.reproduced,true);assert.equal(saved.trace.minimization.originalEvents,trace.actions.length);
  assert.ok(lstatSync(output).isFile()&&!lstatSync(output).isSymbolicLink());assert.equal(readFileSync(input).equals(before),true);
  assert.equal(readFileSync(aliasedInput).equals(before),true);
  const collision=replayCLI(aliasedInput,input);assert.equal(collision.status,1);
  assert.equal(readFileSync(input).equals(before),true,'the canonical replay input must survive an aliased input/output collision');
  assert.equal(readFileSync(aliasedInput).equals(before),true);assert.equal(readFileSync(output).equals(minimizedBytes),true);
  assert.match(collision.stderr,/ARTIFACT_REJECTED/);assert.match(collision.stderr,/separate from the replay input/);
  const malformed=join(root,'malformed-input.json');writeFileSync(malformed,'{not valid JSON');
  for(const badInput of [join(root,'missing-input.json'),malformed]){
    const failed=replayCLI(badInput,output);assert.equal(failed.status,1);assert.equal(failed.stdout,'');
    assert.equal(JSON.parse(failed.stderr).invariant,'REPLAY_ERROR');assert.equal(readFileSync(output).equals(minimizedBytes),true);
    assert.equal(readFileSync(input).equals(before),true);
  }
  assert.deepEqual(readdirSync(store.directory).sort(),['core500-failure-minimized.json','core500-failure-original.json']);
  return {actualCLI:true,realDirectoryAlias:true,canonicalInputCollisionRejected:true,separateSafeOutputWritten:true,originalActions:trace.actions.length,inputBytesUnchanged:true,missingAndMalformedInputs:'REPLAY_ERROR'};
}));
await check('H-S4-persisted-route-prefix-filenames-and-exact-route-controls',()=>fixture(root=>{
  const {store,path}=prepared(root),filenames=['/api/auth/session.log','/api/auth/verify.backup','/api/me/home.private.json','/api/auth/logout-all.json',
    '/api/auth/session/secret.json','/api/auth/session?token=private','/api/auth/session#private','/api/auth/session;private.json','/api/auth/session,private.json'];
  const routes=['/api/auth/session','/api/auth/challenge','/api/auth/verify','/api/auth/logout','/api/auth/logout-all','/api/me/home','/api/me/home?fresh=1','/api/me/home/refresh'];
  const control={relative:'tests/auth-artifacts.test.mjs',parent:'../fixtures/auth.json',url:'https://example.com/api/auth/session.log',
    actions:[{type:'start',tab:'a'},{type:'headers',id:'r1'}],events:[{index:0,type:'headers',id:'r1'}],nonce:'n1',classification:'ABSENT'};
  store.write('core500-RESULT.json',{nested:{errors:filenames.map(path=>({message:`Error at ${path}`}))},routes,
    quoted:filenames.map(path=>`Cannot read "${path}"`),exactQuoted:routes.map(path=>`route "${path}"`),control,
    key:{'/api/auth/session.log':'masked filename key'},knownOther:'Cannot read /var/private/session.log'});
  const saved=JSON.parse(readFileSync(path,'utf8'));assert.deepEqual(saved.nested.errors,filenames.map(()=>({message:'Error at [local-path]'})));
  assert.deepEqual(saved.quoted,filenames.map(()=>'Cannot read "[local-path]"'));assert.deepEqual(saved.routes,routes);
  assert.deepEqual(saved.exactQuoted,routes.map(path=>`route "${path}"`));assert.deepEqual(saved.control,control);
  assert.deepEqual(saved.key,{'[local-path]':'masked filename key'});assert.equal(saved.knownOther,'Cannot read [local-path]');
  return {persistedFilenameVariants:filenames.length,exactRoutes:routes.length,quotedAndBareDiagnostics:true,URLAndReplayIdentitiesPreserved:true};
}));
await check('H-S5-persisted-spaced-route-prefix-filenames-and-complete-token-controls',()=>fixture(root=>{
  const {store,path}=prepared(root),paths=['/api/auth/session private.log','/api/auth/session dir/file.ts','/api/auth/session (private)/x.ts',
    '/api/auth/verify\tprivate.log','/api/me/home?fresh=1 private.log','/api/me/home/refresh dir/file.ts'];
  const controls={routes:['/api/auth/session','/api/auth/verify','/api/me/home','/api/me/home?fresh=1','/api/me/home/refresh'],
    log:'GET /api/me/home?fresh=1 200',listing:'route /api/auth/logout, then /api/auth/logout-all',url:'https://example.com/api/auth/session.log',
    relative:'tests/auth-artifacts.test.mjs',nonce:'n1',actions:[{type:'start',tab:'a'}],events:[{index:0,type:'headers',id:'r1'}]};
  store.write('core500-RESULT.json',{nested:{errors:paths.map(path=>({message:`Error at ${path}`}))},quoted:paths.map(path=>`Cannot read "${path}"`),controls});
  const bytes=readFileSync(path),saved=JSON.parse(bytes);
  assert.deepEqual(saved.nested.errors,paths.map(()=>({message:'Error at [local-path]'})),'a bare spaced filename must be masked from the route prefix, not only from an inner slash');
  assert.deepEqual(saved.quoted,paths.map(()=>'Cannot read "[local-path]"'));assert.deepEqual(saved.controls,controls);
  return {persistedSpacedFilenameVariants:paths.length,completeRouteControlsPreserved:true,persistedBytes:bytes.length,persistedSha256:createHash('sha256').update(bytes).digest('hex')};
}));
const failures=checks.filter(check=>check.status==='FAIL');
console.log(JSON.stringify({schema:'artifact-closure-v1',status:failures.length?'FAIL':'PASS',node:process.version,platform:process.platform,
  artifactSource:relative(checkout,artifactSource)||'.',artifactModuleSha256:createHash('sha256').update(readFileSync(modulePath)).digest('hex'),
  replayCliSha256:createHash('sha256').update(readFileSync(cliPath)).digest('hex'),
  assertions:{total:checks.length,passed:checks.length-failures.length,failed:failures.length,skipped:0},checks,
  limits:['Local filesystem; no NFS/SMB exclusivity claim.','Node has no portable dirfd/openat parent-relative atomic rename: adversarial concurrent ancestry swaps remain outside the private fixture-root trust assumption.']},null,2));
process.exitCode=failures.length?1:0;
