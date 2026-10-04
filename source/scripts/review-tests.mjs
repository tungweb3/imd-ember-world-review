import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
export const REVIEW_TEST_FILES=Object.freeze([
  'tests/auth.test.mjs','tests/aud4-auth.test.mjs','tests/auth-r5.test.mjs','tests/auth-r5-authority.test.mjs',
  'tests/member-client.test.mjs','tests/member-r4.test.mjs','tests/member-r5.test.mjs','tests/auth-lifecycle-model.test.mjs',
  'tests/auth-r7-authority.test.mjs','tests/auth-r7-lifecycle.test.mjs','tests/member-r7-cache.test.mjs','tests/auth-r8.test.mjs',
  'tests/ownership-market-r8.test.mjs','tests/auth-v11.test.mjs','tests/ownership-v11.test.mjs','tests/freshness-v11.test.mjs',
  'tests/auth-reference-scheduler.test.mjs','tests/auth-audit8.test.mjs','tests/ownership-audit8.test.mjs',
  'tests/clock-skew-audit8.test.mjs','tests/auth-audit8-causal.test.mjs','tests/auth-artifacts.test.mjs','tests/review-runner.test.mjs'
]);
export function reviewEnvironment(input=process.env){const env={...input};
  // All source selectors are test-only escape hatches. Clear the entire suffix,
  // including AUDIT8_SOURCE and future selectors, rather than an ageing list.
  for(const key of Object.keys(env))if(key.endsWith('_SOURCE')||key==='NODE_OPTIONS')delete env[key];return env;}
export function checkReviewPrerequisites({sourceDir,nodeVersion=process.version}={}){
  if(!/^v24\./.test(nodeVersion))throw new Error('Review tests require Node.js 24.x (package engines >=24 <25)');
  const missing=REVIEW_TEST_FILES.filter(file=>!existsSync(resolve(sourceDir,file)));
  if(missing.length)throw new Error('Review snapshot is missing required test files: '+missing.join(', '));
  const pkg=JSON.parse(readFileSync(resolve(sourceDir,'package.json'),'utf8')),lock=JSON.parse(readFileSync(resolve(sourceDir,'package-lock.json'),'utf8'));
  const local=resolve(sourceDir,'node_modules/viem/package.json');
  if(!existsSync(local))throw new Error('Local pinned viem is missing. Run npm ci --ignore-scripts in this checkout first.');
  const version=JSON.parse(readFileSync(local,'utf8')).version;
  if(version!==pkg.dependencies.viem||version!==lock.packages['node_modules/viem']?.version)throw new Error('Local viem differs from package.json/package-lock.json; run npm ci --ignore-scripts');
  return {node:nodeVersion,viem:version,testFiles:REVIEW_TEST_FILES.length};
}
export function reviewArguments(){return ['--test','--test-reporter=tap','--test-concurrency=3',...REVIEW_TEST_FILES];}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const sourceDir=resolve(import.meta.dirname,'..'),args=process.argv.slice(2);
  if(args.length>1||args.length===1&&!['--list','--check'].includes(args[0]))throw new Error('Usage: npm run test:review [-- --list | -- --check]');
  if(args[0]==='--list')console.log(REVIEW_TEST_FILES.join('\n'));
  else{console.log('REVIEW_PREREQUISITES '+JSON.stringify(checkReviewPrerequisites({sourceDir})));
    if(args[0]!=='--check'){const result=spawnSync(process.execPath,reviewArguments(),{cwd:sourceDir,env:reviewEnvironment(),stdio:'inherit'});
      if(result.error)throw result.error;process.exitCode=result.status??1;}}
}
