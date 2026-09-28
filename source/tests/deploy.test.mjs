import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {hashTree,sumsText,treeDigest,parseVersionId,recordName,dirtyRefusal,envFiles,envRefusal,isEntry,RECORDS_DIR,ROOT,
  skipRefusal,testArgs,buildSteps,runStep} from '../scripts/deploy.mjs';
// scripts/deploy.mjs's provenance helpers, run on real files. Hashes are checked against the published SHA-256 test
// vectors ("abc", ""), never recomputed here. Importing the script must not deploy anything (it runs only as main).
const ABC='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',EMPTY='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
function tree(files){const dir=mkdtempSync(join(tmpdir(),'imd-deploy-'));for(const [p,body] of Object.entries(files)){mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),body);}return dir;}

test('hashTree lists every file under the tree, sorted, with POSIX paths relative to the base, size and SHA-256',()=>{
  // 'a-b.txt' sorts before 'a/x.txt' ('-' < '/') although a directory walk reaches a/ first: the order is by path.
  const dir=tree({'dist/b.txt':'abc','dist/a/z/e.bin':'','dist/a-b.txt':'abc'});
  try{
    assert.deepEqual(hashTree(join(dir,'dist'),dir),[
      {path:'dist/a-b.txt',size:3,sha256:ABC},{path:'dist/a/z/e.bin',size:0,sha256:EMPTY},{path:'dist/b.txt',size:3,sha256:ABC}]);
    assert.deepEqual(hashTree(join(dir,'dist')).map(f=>f.path),['a-b.txt','a/z/e.bin','b.txt'],'base defaults to the tree itself');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('SHA256SUMS lines are sha256sum -c format, and the tree digest changes with any byte or any file name',()=>{
  const dir=tree({'w/index.js':'abc','w/index.js.map':''});
  try{
    const files=hashTree(join(dir,'w'),dir);
    assert.equal(sumsText(files),`${ABC}  w/index.js\n${EMPTY}  w/index.js.map\n`);
    const digest=treeDigest(files);assert.match(digest,/^[\da-f]{64}$/);
    assert.equal(treeDigest(hashTree(join(dir,'w'),dir)),digest,'stable for the same bytes');
    writeFileSync(join(dir,'w/index.js'),'abd');const edited=treeDigest(hashTree(join(dir,'w'),dir));assert.notEqual(edited,digest,'one byte');
    writeFileSync(join(dir,'w/index.js'),'abc');assert.equal(treeDigest(hashTree(join(dir,'w'),dir)),digest);
    const renamed=files.map(f=>f.path==='w/index.js'?{...f,path:'w/other.js'}:f);assert.notEqual(treeDigest(renamed),digest,'same bytes, other name');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a real deploy refuses a dirty tree; a dry run only records it',()=>{
  assert.equal(dirtyRefusal('',false),null);assert.equal(dirtyRefusal('\n',false),null);
  assert.match(dirtyRefusal(' M server/auth.ts\n',false),/not clean[\s\S]*server\/auth\.ts/);
  assert.equal(dirtyRefusal(' M server/auth.ts\n',true),null);
});

test('record names sort by UTC time and carry the short commit and the mode; the Version ID is read from wrangler',()=>{
  const at=new Date(Date.UTC(2026,8,28,13,8,5,123)),sha='6f288e4'+'0'.repeat(33);
  assert.equal(recordName(at,sha,false),'20260928T130805Z-6f288e4');assert.equal(recordName(at,sha,true),'20260928T130805Z-6f288e4-dry-run');
  assert.ok(recordName(new Date(Date.UTC(2026,8,28,9)),sha,false)<recordName(new Date(Date.UTC(2026,8,28,13)),sha,false));
  assert.equal(parseVersionId('Uploaded imd-world (3.1 sec)\nDeployed imd-world triggers\n  imdember.com (custom domain)\nCurrent Version ID: 2a5bf0b7-1c2d-4e5f-8a9b-0c1d2e3f4a5b\n'),'2a5bf0b7-1c2d-4e5f-8a9b-0c1d2e3f4a5b');
  assert.equal(parseVersionId('--dry-run: exiting now.\n'),null);
});

test('deploy records are gitignored and importing the script deploys nothing',()=>{
  const r=spawnSync('git',['check-ignore','-q',RECORDS_DIR+'/20260928T130805Z-6f288e4/manifest.json'],{cwd:ROOT});
  assert.equal(r.status,0,'deploy-records/ must be ignored by git');
  // A fresh process imports it (with --dry-run in argv, so even a regression could never upload): only our line prints.
  const child=spawnSync(process.execPath,['--input-type=module','-e',"await import('./scripts/deploy.mjs');console.log('imported')",'--','--dry-run'],{cwd:ROOT,encoding:'utf8',timeout:20000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,'imported'+String.fromCharCode(10));
});

test('env files Vite would load are refused on a real deploy and listed by name on a dry run; others are ignored',()=>{
  const dir=tree({'.env':'','.env.local':'','.env.production':'','.env.production.local':'','.env.example':'','.env.development':'','.envrc':'','.dev.vars':'','x.env':'','.env.d/.env':''});
  try{
    assert.deepEqual(envFiles(dir),['.env','.env.local','.env.production','.env.production.local']);
    assert.match(envRefusal(envFiles(dir),false),/\(\.env, \.env\.local, \.env\.production, \.env\.production\.local\)/);
    assert.equal(envRefusal(envFiles(dir),true),null,'a dry run only records them');assert.equal(envRefusal([],false),null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

// S4: the deploy built and uploaded without running the tests.
test('the deploy runs the full suite (package.json scripts.test) before tsc and vite, and a failing test stops it; only a dry run may skip',()=>{
  assert.deepEqual(buildSteps(ROOT,false).map(([label])=>label),['npm test','tsc','vite build'],'the tests come first');
  assert.deepEqual(buildSteps(ROOT,false)[0][1],testArgs(ROOT));assert.deepEqual(buildSteps(ROOT,true).map(([label])=>label),['tsc','vite build']);
  assert.match(skipRefusal(true,false),/only accepted with --dry-run/);assert.equal(skipRefusal(true,true),null);assert.equal(skipRefusal(false,false),null);
  // The gate is the exit code of that very command, run for real on a throwaway project: one failing test fails it.
  const pkg=JSON.stringify({type:'module',scripts:{test:JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).scripts.test}});
  const pass="import test from 'node:test';test('ok',()=>{});",fail="import test from 'node:test';import assert from 'node:assert';test('no',()=>assert.equal(1,2));";
  const good=tree({'package.json':pkg,'tests/a.test.mjs':pass,'tests/b.test.mjs':pass}),bad=tree({'package.json':pkg,'tests/a.test.mjs':pass,'tests/b.test.mjs':fail});
  try{
    assert.equal(runStep(buildSteps(good,false)[0][1],good,{capture:true}),true);
    assert.equal(runStep(buildSteps(bad,false)[0][1],bad,{capture:true}),false,'one failing test');
    for(const test of ['npm test','node --test && curl x','node']){
      writeFileSync(join(bad,'package.json'),JSON.stringify({scripts:{test}}));assert.throws(()=>testArgs(bad),/plain node command/,test);
    }
  }finally{rmSync(good,{recursive:true,force:true});rmSync(bad,{recursive:true,force:true});}
});

test('the script runs main only as the started script, on any Node 24 (no import.meta.main), with Windows paths compared without case',()=>{
  const script=join(ROOT,'scripts','deploy.mjs'),url=pathToFileURL(script).href;
  assert.equal(isEntry(script,url),true);assert.equal(isEntry(join(ROOT,'scripts','..','scripts','deploy.mjs'),url),true);
  assert.equal(isEntry(join(ROOT,'scripts','other.mjs'),url),false);assert.equal(isEntry(undefined,url),false);assert.equal(isEntry('',url),false);
  if(process.platform==='win32')assert.equal(isEntry(script.toUpperCase(),url),true);
});

// L4: only the helpers were tested; a regression in main's wiring (skipping the gate, ignoring its result) passed the suite.
test('the script itself, run on a throwaway git repo: a failing test stops a dry run before tsc with no record; --skip-tests alone is refused',()=>{
  const pkg=JSON.stringify({type:'module',scripts:{test:JSON.parse(readFileSync(join(ROOT,'package.json'),'utf8')).scripts.test}});
  const pass="import test from 'node:test';test('ok',()=>{});",fail="import test from 'node:test';import assert from 'node:assert';test('no',()=>assert.equal(1,2));";
  const dir=tree({'package.json':pkg,'tests/a.test.mjs':pass,'tests/b.test.mjs':fail});
  const git=(...args)=>{const r=spawnSync('git',['-c','user.name=t','-c','user.email=t@example.invalid','-c','commit.gpgsign=false',...args],{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
  const deploy=(...args)=>{const r=spawnSync(process.execPath,['scripts/deploy.mjs',...args],{cwd:dir,encoding:'utf8',timeout:60000});return {status:r.status,out:r.stdout+r.stderr};};
  try{
    mkdirSync(join(dir,'scripts'));copyFileSync(join(ROOT,'scripts','deploy.mjs'),join(dir,'scripts','deploy.mjs'));
    git('init','-q');git('add','-A');git('commit','-q','-m','x');
    let r=deploy('--dry-run');
    assert.equal(r.status,1,r.out);assert.match(r.out,/> npm test[\s\S]*npm test failed; nothing was built or deployed/);assert.doesNotMatch(r.out,/> tsc/);
    assert.equal(existsSync(join(dir,RECORDS_DIR)),false,'no record was started');
    r=deploy('--skip-tests');assert.equal(r.status,1);assert.match(r.out,/--skip-tests is only accepted with --dry-run/);assert.doesNotMatch(r.out,/> npm test/);
    // With the suite green the gate lets the run through to tsc (absent in this throwaway repo, so it stops there).
    writeFileSync(join(dir,'tests/b.test.mjs'),pass);r=deploy('--dry-run');
    assert.equal(r.status,1);assert.match(r.out,/> npm test[\s\S]*> tsc[\s\S]*tsc failed; nothing was built or deployed/);assert.equal(existsSync(join(dir,RECORDS_DIR)),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
