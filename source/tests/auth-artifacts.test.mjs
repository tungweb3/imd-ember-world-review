import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync,rmdirSync,readdirSync,lstatSync,unlinkSync,renameSync,linkSync} from 'node:fs';
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
