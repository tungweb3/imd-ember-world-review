import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createArtifactStore,sanitizeArtifact} from './auth-artifacts.mjs';
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'auth-artifacts-'));try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}}
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
