import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {REVIEW_TEST_FILES,reviewEnvironment,reviewArguments,checkReviewPrerequisites} from '../scripts/review-tests.mjs';
test('review runner retains all 28 prior review files and includes the scheduled Audit11 regression',()=>{
  assert.equal(REVIEW_TEST_FILES.length,29);assert.equal(new Set(REVIEW_TEST_FILES).size,29);
  for(const name of ['auth-audit8.test.mjs','ownership-audit8.test.mjs','clock-skew-audit8.test.mjs','auth-audit8-causal.test.mjs','auth-artifacts.test.mjs','review-runner.test.mjs','auth-audit9.test.mjs','ownership-audit9.test.mjs','auth-audit10.test.mjs','ownership-audit10.test.mjs','artifacts-audit10.test.mjs','scheduled-audit11.test.mjs'])
    assert.ok(REVIEW_TEST_FILES.includes('tests/'+name));
  assert.deepEqual(reviewArguments().slice(3),REVIEW_TEST_FILES);assert.ok(REVIEW_TEST_FILES.includes('tests/auth-reference-scheduler.test.mjs'));
});
test('review runner cannot inherit a private source override or a global Node preload',()=>{
  const input={AUTH_R7_SOURCE:'private',AUTH_REFERENCE_SOURCE:'private',R8_SOURCE:'private',V11_SOURCE:'private',AUDIT8_SOURCE:'private',FUTURE_TEST_SOURCE:'private',NODE_OPTIONS:'--import private.mjs',PATH:'ordinary',AUTH_REFERENCE_ARTIFACT_DIR:'tmp/auth-reference-scheduler'};
  assert.deepEqual(reviewEnvironment(input),{PATH:'ordinary',AUTH_REFERENCE_ARTIFACT_DIR:'tmp/auth-reference-scheduler'});assert.equal(input.AUTH_REFERENCE_SOURCE,'private');
});
test('every source override actually referenced in test modules is removed by the review environment',()=>{
  const names=new Set();for(const file of readdirSync(import.meta.dirname).filter(name=>name.endsWith('.mjs'))){
    const text=readFileSync(join(import.meta.dirname,file),'utf8');for(const match of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*_SOURCE)\b/g))names.add(match[1]);}
  assert.deepEqual([...names].sort(),['AUDIT8_SOURCE','AUTH_R7_SOURCE','AUTH_REFERENCE_SOURCE','R8_SOURCE','SCHEDULED_AUDIT11_SOURCE','V11_SOURCE']);
  for(const key of names)assert.equal(reviewEnvironment({[key]:'private'})[key],undefined,key+' must not select private code');
});
test('review preflight requires Node24, every listed file, and a locally installed locked viem',()=>{
  const root=mkdtempSync(join(tmpdir(),'review-preflight-'));const put=(path,value)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
  try{assert.throws(()=>checkReviewPrerequisites({sourceDir:root,nodeVersion:'v22.0.0'}),/Node.js 24/);
    assert.throws(()=>checkReviewPrerequisites({sourceDir:root,nodeVersion:'v24.19.0'}),/missing required test files/);
    for(const file of REVIEW_TEST_FILES)put(file,'// runner preflight fixture; never used as a product test');
    put('package.json',{dependencies:{viem:'2.56.9'}});put('package-lock.json',{packages:{'node_modules/viem':{version:'2.56.9'}}});
    assert.throws(()=>checkReviewPrerequisites({sourceDir:root,nodeVersion:'v24.19.0'}),/Local pinned viem is missing/);
    put('node_modules/viem/package.json',{version:'2.56.8'});assert.throws(()=>checkReviewPrerequisites({sourceDir:root,nodeVersion:'v24.19.0'}),/differs/);
    put('node_modules/viem/package.json',{version:'2.56.9'});assert.deepEqual(checkReviewPrerequisites({sourceDir:root,nodeVersion:'v24.19.0'}),{node:'v24.19.0',viem:'2.56.9',testFiles:29});
  }finally{rmSync(root,{recursive:true,force:true});}
});
