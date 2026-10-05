import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,copyFileSync,existsSync,renameSync,symlinkSync,lstatSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {hashTree,sumsText,treeDigest,parseVersionId,recordName,dirtyRefusal,envFiles,envRefusal,isEntry,RECORDS_DIR,ROOT,
  skipRefusal,testArgs,buildSteps,runStep,finalizeRecord,deploymentOutcome} from '../scripts/deploy.mjs';
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

function recordFixture(){
  const name='20261005T000000Z-aaaaaaa',dir=tree({['records/'+name+'.partial/manifest.json']:'abc','outside/keep.txt':'private'});
  return {dir,root:join(dir,'records'),tmp:join(dir,'records',name+'.partial'),rec:join(dir,'records',name),outside:join(dir,'outside')};
}
const renameError=code=>Object.assign(new Error('synthetic record lock'),{code,syscall:'rename'});

test('record finalization moves a real directory once and preserves exact evidence bytes',()=>{
  const f=recordFixture();try{
    const before=hashTree(f.tmp),result=finalizeRecord(f.tmp,f.rec);
    assert.equal(result.status,'persisted');assert.equal(result.attempts,1);assert.deepEqual(result.errors,[]);
    assert.equal(existsSync(f.tmp),false);assert.deepEqual(hashTree(f.rec),before);assert.equal(readFileSync(join(f.rec,'manifest.json'),'utf8'),'abc');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

for(const code of ['EPERM','EACCES','EBUSY'])test('record finalization retries a Windows '+code+' once without changing the evidence or losing the original error',()=>{
  const f=recordFixture(),error=renameError(code),waits=[];let calls=0;
  try{
    const result=finalizeRecord(f.tmp,f.rec,{platform:'win32',rename:(a,b)=>{if(++calls===1)throw error;renameSync(a,b);},wait:ms=>waits.push(ms)});
    assert.equal(result.status,'persisted');assert.equal(result.attempts,2);assert.equal(calls,2);assert.deepEqual(waits,[100]);
    assert.equal(result.originalError,error);assert.deepEqual(result.errors,[{code,syscall:'rename',stage:'rename'}]);
    assert.equal(readFileSync(join(f.rec,'manifest.json'),'utf8'),'abc');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization exhausts a bounded retry, retains the partial bytes and reports persistence failure independently of successful upload',()=>{
  const f=recordFixture(),error=renameError('EPERM'),waits=[];let calls=0;
  try{
    const result=finalizeRecord(f.tmp,f.rec,{platform:'win32',rename:()=>{calls++;throw error;},wait:ms=>waits.push(ms)});
    assert.equal(result.status,'failed');assert.equal(result.attempts,4);assert.equal(calls,4);assert.deepEqual(waits,[100,250,500]);
    assert.equal(result.originalError,error);assert.equal(result.errors.length,4);assert.equal(existsSync(f.rec),false);
    assert.equal(readFileSync(join(f.tmp,'manifest.json'),'utf8'),'abc');
    assert.deepEqual(deploymentOutcome(0,true,false),{deployment:'uploaded',verification:'passed',recordPersistence:'failed',exitCode:1});
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('non-transient and non-Windows rename failures stop immediately, without copy or retry',()=>{
  const f=recordFixture();try{
    for(const [platform,code] of [['win32','EXDEV'],['linux','EPERM'],['win32','EIO']]){
      const error=renameError(code);let calls=0;
      const result=finalizeRecord(f.tmp,f.rec,{platform,rename:()=>{calls++;throw error;},wait:()=>assert.fail('unexpected retry')});
      assert.equal(result.status,'failed');assert.equal(result.attempts,1);assert.equal(calls,1);assert.equal(result.originalError,error);
      assert.equal(existsSync(f.rec),false);assert.equal(readFileSync(join(f.tmp,'manifest.json'),'utf8'),'abc');
    }
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization refuses an existing destination without overwriting either evidence tree',()=>{
  const f=recordFixture();try{
    mkdirSync(f.rec);writeFileSync(join(f.rec,'prior.json'),'previous');
    const result=finalizeRecord(f.tmp,f.rec,{rename:()=>assert.fail('unsafe rename')});
    assert.equal(result.status,'failed');assert.equal(result.attempts,0);assert.equal(result.errors[0].code,'RECORD_UNSAFE_PATH');
    assert.equal(readFileSync(join(f.rec,'prior.json'),'utf8'),'previous');assert.equal(readFileSync(join(f.tmp,'manifest.json'),'utf8'),'abc');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization refuses paths outside the configured root',()=>{
  const f=recordFixture();try{
    const result=finalizeRecord(f.tmp,join(f.outside,'unexpected'),{recordsRoot:f.root,rename:()=>assert.fail('unsafe rename')});
    assert.equal(result.status,'failed');assert.equal(result.attempts,0);assert.equal(existsSync(join(f.outside,'unexpected')),false);
    assert.equal(readFileSync(join(f.outside,'keep.txt'),'utf8'),'private');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization rejects an output junction, even when it points to a real directory',()=>{
  const f=recordFixture();try{
    symlinkSync(f.outside,f.rec,process.platform==='win32'?'junction':'dir');
    assert.equal(lstatSync(f.rec).isSymbolicLink(),true);
    const result=finalizeRecord(f.tmp,f.rec,{rename:()=>assert.fail('unsafe rename')});
    assert.equal(result.status,'failed');assert.equal(result.attempts,0);assert.equal(readFileSync(join(f.outside,'keep.txt'),'utf8'),'private');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization revalidates and rejects a destination junction introduced during retry',()=>{
  const f=recordFixture(),error=renameError('EPERM');let calls=0;
  try{
    const result=finalizeRecord(f.tmp,f.rec,{platform:'win32',rename:()=>{calls++;throw error;},wait:()=>symlinkSync(f.outside,f.rec,process.platform==='win32'?'junction':'dir')});
    assert.equal(result.status,'failed');assert.equal(result.attempts,1);assert.equal(calls,1);assert.equal(result.originalError,error);
    assert.deepEqual(result.errors.map(e=>e.stage),['rename','validate']);assert.equal(lstatSync(f.rec).isSymbolicLink(),true);
    assert.equal(readFileSync(join(f.outside,'keep.txt'),'utf8'),'private');assert.equal(existsSync(join(f.outside,'manifest.json')),false);
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization rejects a source directory replaced by a junction between attempts',()=>{
  const f=recordFixture(),error=renameError('EBUSY');let calls=0;
  try{
    const result=finalizeRecord(f.tmp,f.rec,{platform:'win32',rename:()=>{calls++;throw error;},wait:()=>{
      renameSync(f.tmp,join(f.root,'saved-partial'));symlinkSync(f.outside,f.tmp,process.platform==='win32'?'junction':'dir');
    }});
    assert.equal(result.status,'failed');assert.equal(result.attempts,1);assert.equal(calls,1);assert.equal(existsSync(f.rec),false);
    assert.equal(result.errors.at(-1).stage,'validate');assert.equal(readFileSync(join(f.outside,'keep.txt'),'utf8'),'private');
    assert.equal(readFileSync(join(f.root,'saved-partial/manifest.json'),'utf8'),'abc');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization does not report persistence when a replaced source junction is moved during rename',()=>{
  const f=recordFixture();try{
    const result=finalizeRecord(f.tmp,f.rec,{rename:(a,b)=>{
      renameSync(a,join(f.root,'saved-partial'));symlinkSync(f.outside,a,process.platform==='win32'?'junction':'dir');renameSync(a,b);
    }});
    assert.equal(result.status,'failed');assert.equal(result.attempts,1);assert.equal(result.errors[0].stage,'verify');
    assert.equal(lstatSync(f.rec).isSymbolicLink(),true);assert.equal(readFileSync(join(f.outside,'keep.txt'),'utf8'),'private');
    assert.equal(existsSync(join(f.outside,'manifest.json')),false);assert.equal(readFileSync(join(f.root,'saved-partial/manifest.json'),'utf8'),'abc');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('record finalization rejects a linked configured root and a non-directory partial entry',()=>{
  const f=recordFixture();try{
    const alias=join(f.dir,'alias');symlinkSync(f.root,alias,process.platform==='win32'?'junction':'dir');
    let result=finalizeRecord(join(alias,basename(f.tmp)),join(alias,basename(f.rec)),{rename:()=>assert.fail('unsafe rename')});
    assert.equal(result.status,'failed');assert.equal(result.attempts,0);
    const notDir=join(f.root,'file.partial');writeFileSync(notDir,'file');
    result=finalizeRecord(notDir,join(f.root,'file'),{rename:()=>assert.fail('unsafe rename')});
    assert.equal(result.status,'failed');assert.equal(result.attempts,0);assert.equal(readFileSync(notDir,'utf8'),'file');
  }finally{rmSync(f.dir,{recursive:true,force:true});}
});

test('a successfully persisted record never hides upload failure, unknown upload exit or changed build bytes',()=>{
  assert.deepEqual(deploymentOutcome(1,true,true),{deployment:'failed',verification:'passed',recordPersistence:'persisted',exitCode:1});
  assert.equal(deploymentOutcome(null,true,true).exitCode,1);
  assert.deepEqual(deploymentOutcome(0,false,true),{deployment:'uploaded',verification:'failed',recordPersistence:'persisted',exitCode:1});
  assert.deepEqual(deploymentOutcome(0,true,true),{deployment:'uploaded',verification:'passed',recordPersistence:'persisted',exitCode:0});
  assert.deepEqual(deploymentOutcome(0,true,true,true),{deployment:'dry-run-passed',verification:'passed',recordPersistence:'persisted',exitCode:0});
});

// Run main's real wiring over synthetic local executables, not Cloudflare or any credential reader. A copy of the
// canonical script still controls the order, manifest and exit. The fake build/upload programs never use the network.
for(const variant of ['good','upload-failed','dist-changed','record-locked'])test('canonical dry-run reports distinct upload/verification/persistence outcomes: '+variant,()=>{
  const makeDist="import {mkdirSync,writeFileSync} from 'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html','abc');";
  const upload="import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const out=process.argv[process.argv.indexOf('--outdir')+1];mkdirSync(out,{recursive:true});writeFileSync(join(out,'index.js'),'abc');console.log('synthetic local dry-run, no network');"+
    (variant==='upload-failed'?"process.exitCode=1;":variant==='dist-changed'?"writeFileSync('dist/index.html','changed');":'');
  const dir=tree({'package.json':JSON.stringify({type:'module',scripts:{test:'node --test tests/*.test.mjs'}}),
    '.gitignore':'deploy-records/\nnode_modules/\ndist/\n','package-lock.json':'{}','wrangler.jsonc':'{}','public/_headers':'/*\n',
    'node_modules/typescript/package.json':'{"version":"1.0.0"}','node_modules/typescript/bin/tsc':'',
    'node_modules/vite/package.json':'{"version":"1.0.0"}','node_modules/vite/bin/vite.js':makeDist,
    'node_modules/wrangler/package.json':'{"version":"1.0.0"}','node_modules/wrangler/bin/wrangler.js':upload});
  try{
    mkdirSync(join(dir,'scripts'));copyFileSync(join(ROOT,'scripts/deploy.mjs'),join(dir,'scripts/deploy.mjs'));
    for(const args of [['init','-q'],['add','-A'],['commit','-q','-m','synthetic deploy recorder fixture']]){
      const r=spawnSync('git',['-c','user.name=t','-c','user.email=t@example.invalid','-c','commit.gpgsign=false',...args],{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);
    }
    // A preload changes only this fixture process's native rename entry point to simulate a locked local record.
    const preload="import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';fs.renameSync=()=>{const e=new Error('synthetic lock');e.code='EPERM';e.syscall='rename';throw e;};syncBuiltinESMExports();";
    const args=variant==='record-locked'?['--import','data:text/javascript;base64,'+Buffer.from(preload).toString('base64')]:[];
    const r=spawnSync(process.execPath,[...args,'scripts/deploy.mjs','--dry-run','--skip-tests'],{cwd:dir,encoding:'utf8',timeout:20000});
    const outcome=r.stdout.split(/\r?\n/).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).find(row=>row.kind==='imd-world deploy outcome');
    assert.ok(outcome,r.stdout+r.stderr);assert.equal(r.status,variant==='good'?0:1,r.stdout+r.stderr);
    assert.equal(outcome.deployment,variant==='upload-failed'?'failed':'dry-run-passed');
    assert.equal(outcome.verification,variant==='dist-changed'?'failed':'passed');
    assert.equal(outcome.recordPersistence,variant==='record-locked'?'failed':'persisted');
    const names=readdirSync(join(dir,RECORDS_DIR));assert.equal(names.length,1);
    assert.equal(names[0].endsWith('.partial'),variant==='record-locked');
    const manifest=JSON.parse(readFileSync(join(dir,RECORDS_DIR,names[0],'manifest.json'),'utf8'));
    assert.equal(manifest.mode,'dry-run');assert.equal(manifest.wrangler.exitCode,variant==='upload-failed'?1:0);
    assert.equal(manifest.dist.unchangedDuringDeploy,variant!=='dist-changed');
    if(variant==='record-locked'){
      assert.ok(outcome.finalization.attempts>=1&&outcome.finalization.attempts<=4);
      assert.equal(outcome.finalization.errors[0].code,'EPERM');
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});
