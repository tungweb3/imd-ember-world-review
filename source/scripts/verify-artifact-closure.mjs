// Exit 0 means every assertion passed, not merely that the probe finished.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync,readFileSync,existsSync,lstatSync,readdirSync,rmSync,unlinkSync,renameSync,linkSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
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
const failures=checks.filter(check=>check.status==='FAIL');
console.log(JSON.stringify({schema:'artifact-closure-v1',status:failures.length?'FAIL':'PASS',node:process.version,platform:process.platform,
  artifactSource:relative(checkout,artifactSource)||'.',artifactModuleSha256:createHash('sha256').update(readFileSync(modulePath)).digest('hex'),
  assertions:{total:checks.length,passed:checks.length-failures.length,failed:failures.length,skipped:0},checks,
  limits:['Local filesystem; no NFS/SMB exclusivity claim.','Node has no portable dirfd/openat parent-relative atomic rename: adversarial concurrent ancestry swaps remain outside the private fixture-root trust assumption.']},null,2));
process.exitCode=failures.length?1:0;
