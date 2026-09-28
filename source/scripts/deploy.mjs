// Deploy with provenance: `npm run deploy` (real) or `npm run deploy:dry-run` (nothing is uploaded).
// Runs the full test suite first (package.json scripts.test) and stops before building when any test fails; only a dry
// run may skip it, with `--dry-run --skip-tests` (a real deploy given --skip-tests is refused), and the manifest says so.
// Then builds dist/ from the (clean) working tree at HEAD, runs `wrangler deploy --outdir` so the exact Worker bundle wrangler
// uploads is kept, and writes deploy-records/<UTC time>-<commit>[-dry-run]/ (gitignored) with:
//   manifest.json  commit, tool versions, config hashes, wrangler's Version ID, and every file's size + SHA-256
//   SHA256SUMS     the same hashes in `sha256sum -c` form (paths relative to the repo root: dist/…, worker/…)
//   worker/        the uploaded Worker bundle (wrangler's --outdir)
//   wrangler.log   wrangler's own output (bindings and IDs; secrets are never printed by wrangler)
// A real deploy refuses a dirty working tree, so the record's commit is exactly what shipped, and refuses any .env file
// Vite would load into the build (gitignored, so the commit would not say what shipped); a dry run lists their names in
// the manifest. Nothing here reads .dev.vars, .env or credentials (only file names are listed); wrangler uses its own login.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,mkdirSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=fileURLToPath(new URL('..',import.meta.url));
export const RECORDS_DIR='deploy-records';
const sha256=buf=>createHash('sha256').update(buf).digest('hex');
/** Every regular file under `dir`, sorted by path, with POSIX paths relative to `base` (default: `dir`). */
export function hashTree(dir,base=dir){
  const out=[];
  const walk=d=>{for(const name of readdirSync(d)){const p=join(d,name),s=statSync(p);if(s.isDirectory())walk(p);else if(s.isFile()){const b=readFileSync(p);out.push({path:relative(base,p).split(sep).join('/'),size:b.length,sha256:sha256(b)});}}};
  walk(dir);return out.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
/** `sha256sum` lines ("<hash>  <path>"), one per file; sha256sum -c accepts them as they are. */
export const sumsText=files=>files.map(f=>`${f.sha256}  ${f.path}\n`).join('');
/** One digest for a whole tree: SHA-256 of its SHA256SUMS text, so it changes when any file's name or bytes change. */
export const treeDigest=files=>sha256(sumsText(files));
/** wrangler prints "Current Version ID: <uuid>" after an upload; a dry run prints none. */
export function parseVersionId(text){return /Current Version ID:\s*([0-9a-f-]{36})/i.exec(text)?.[1]??null;}
/** deploy-records/ folder name: sortable UTC time, short commit, and the mode. */
export function recordName(date,commit,dryRun){return date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')+'-'+commit.slice(0,7)+(dryRun?'-dry-run':'');}
/** The build and upload are refused unless the working tree is clean (a dry run only notes it). */
export function dirtyRefusal(porcelain,dryRun){return porcelain.trim()&&!dryRun?'working tree is not clean; commit or stash first so the record names what ships:\n'+porcelain:null;}
/** The env files `vite build` (mode production) loads from the repo root, by name only; their contents are never read. */
export const VITE_ENV_FILE=/^\.env(?:\.local|\.production|\.production\.local)?$/;
export const envFiles=dir=>readdirSync(dir).filter(n=>VITE_ENV_FILE.test(n)&&statSync(join(dir,n)).isFile()).sort();
/** A real deploy refuses them: they are gitignored, so the build would depend on something the commit does not name. */
export function envRefusal(names,dryRun){return names.length&&!dryRun?'env files would change the build but are not in git ('+names.join(', ')+'); move the setting into the commit or remove them':null;}
/** Only a dry run may skip the tests. */
export function skipRefusal(skipTests,dryRun){return skipTests&&!dryRun?'--skip-tests is only accepted with --dry-run; a real deploy always runs the full test suite first':null;}
/** The node arguments of package.json's scripts.test (today `node --test tests/*.test.mjs`), run with this same Node, so
 *  the deploy gate is exactly `npm test`. Anything but a plain node command is refused rather than guessed. */
export function testArgs(root=ROOT){
  const cmd=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts?.test,parts=typeof cmd==='string'?cmd.trim().split(/\s+/):[];
  if(parts[0]!=='node'||parts.length<2||parts.some(p=>/[&|;<>`$]/.test(p)))throw new Error('package.json scripts.test must be a plain node command, not: '+cmd);
  return parts.slice(1);
}
/** The steps before wrangler, in order: the full test suite (unless a dry run skips it), tsc, vite build. */
export function buildSteps(root,skipTests){
  return [...skipTests?[]:[['npm test',testArgs(root)]],['tsc',['node_modules/typescript/bin/tsc','--noEmit']],['vite build',['node_modules/vite/bin/vite.js','build']]];
}
/** Runs one step in `root` with this Node; true only on exit 0. NODE_TEST_CONTEXT is dropped so a suite started from
 *  inside another test run still reports as a top-level run (its exit code is the verdict). */
export function runStep(args,root=ROOT,{capture=false}={}){
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',env});
  if(r.error)throw r.error;return r.status===0;
}
/** True when this module is the script node was started with (import.meta.main exists only from Node 24.2). Windows
 *  paths compare without case. */
export function isEntry(argv1,url){
  if(!argv1)return false;const a=resolve(argv1),b=fileURLToPath(url);
  return process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
}

function run(args,{capture=false,env}={}){
  const r=spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',env:{...process.env,...env}});
  if(r.error)throw r.error;return r;
}
const git=(...args)=>{const r=spawnSync('git',args,{cwd:ROOT,encoding:'utf8'});if(r.status!==0)throw new Error('git '+args.join(' ')+': '+r.stderr);return r.stdout.trim();};
const pkgVersion=name=>JSON.parse(readFileSync(join(ROOT,'node_modules',name,'package.json'),'utf8')).version;

function main(){
  const dryRun=process.argv.includes('--dry-run'),skipTests=process.argv.includes('--skip-tests');
  const commit=git('rev-parse','HEAD'),porcelain=git('status','--porcelain','--untracked-files=normal');
  const env=envFiles(ROOT),refused=skipRefusal(skipTests,dryRun)??dirtyRefusal(porcelain,dryRun)??envRefusal(env,dryRun);if(refused){console.error(refused);process.exit(1);}
  const started=new Date(),name=recordName(started,commit,dryRun),rec=join(ROOT,RECORDS_DIR,name),tmp=rec+'.partial';
  if(skipTests)console.log('> npm test skipped (--dry-run --skip-tests)');
  for(const [label,args] of buildSteps(ROOT,skipTests)){
    console.log('> '+label);if(!runStep(args)){console.error(label+' failed; nothing was built or deployed');process.exit(1);}
  }
  mkdirSync(tmp,{recursive:true});
  const dist=hashTree(join(ROOT,'dist'),ROOT);
  console.log('> wrangler deploy'+(dryRun?' --dry-run':''));
  const w=run(['node_modules/wrangler/bin/wrangler.js','deploy',...(dryRun?['--dry-run']:[]),'--outdir',join(tmp,'worker')],
    {capture:true,env:{WRANGLER_LOG_PATH:join(tmp,'wrangler-logs'),WRANGLER_SEND_METRICS:'false'}});
  const log=(w.stdout??'')+(w.stderr??'');process.stdout.write(log);writeFileSync(join(tmp,'wrangler.log'),log);
  const distAfter=hashTree(join(ROOT,'dist'),ROOT);
  const worker=existsSync(join(tmp,'worker'))?hashTree(join(tmp,'worker'),tmp):[];
  const file=p=>({path:p,sha256:sha256(readFileSync(join(ROOT,p)))});
  const manifest={
    kind:'imd-world deploy record',mode:dryRun?'dry-run':'deploy',startedAt:started.toISOString(),finishedAt:new Date().toISOString(),
    commit,branch:git('rev-parse','--abbrev-ref','HEAD'),dirty:Boolean(porcelain.trim()),envFiles:env,tests:skipTests?'skipped (dry run)':'passed',
    tools:{node:process.version,wrangler:pkgVersion('wrangler'),vite:pkgVersion('vite'),typescript:pkgVersion('typescript')},
    config:[file('wrangler.jsonc'),file('package-lock.json'),file('public/_headers')],
    wrangler:{exitCode:w.status,versionId:parseVersionId(log)},
    dist:{sha256:treeDigest(dist),files:dist,unchangedDuringDeploy:treeDigest(distAfter)===treeDigest(dist)},
    // worker/index.js is the module wrangler uploads and is byte-identical across runs of the same commit; the tree digest
    // is not reproducible, because wrangler stamps README.md with the time and index.js.map with the absolute --outdir.
    worker:{main:worker.find(f=>f.path==='worker/index.js')??null,sha256:treeDigest(worker),files:worker}
  };
  writeFileSync(join(tmp,'manifest.json'),JSON.stringify(manifest,null,1)+'\n');
  writeFileSync(join(tmp,'SHA256SUMS'),sumsText([...dist,...worker.map(f=>({...f,path:RECORDS_DIR+'/'+name+'/'+f.path}))]));
  renameSync(tmp,rec);
  console.log(`record: ${relative(ROOT,rec)}  dist ${manifest.dist.sha256.slice(0,16)}  worker/index.js ${manifest.worker.main?.sha256.slice(0,16)??'-'}  version ${manifest.wrangler.versionId??'-'}`);
  if(w.status!==0||!manifest.dist.unchangedDuringDeploy){console.error('wrangler failed or dist changed during the deploy; see the record');process.exit(1);}
}
if(isEntry(process.argv[1],import.meta.url))main();
