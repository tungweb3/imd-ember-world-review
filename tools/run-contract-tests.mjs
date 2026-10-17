import {readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {root} from './verify-source.mjs';

if(Number(process.versions.node.split('.')[0])!==24)throw Error('NODE_24_REQUIRED');
const cwd=resolve(root,'contracts');
if(!existsSync(resolve(cwd,'package-lock.json')))throw Error('PORTABLE_CONTRACT_LOCK_REQUIRED');
const run=args=>{const result=spawnSync(process.execPath,args,{cwd,stdio:'inherit',shell:false});if(result.error)throw result.error;if(result.signal)throw Error('CONTRACT_TEST_SIGNAL: '+result.signal);if(result.status!==0)process.exit(result.status??1);};
run(['tools/build.mjs']);
run(['tools/check-projection.mjs']);
const files=readdirSync(resolve(cwd,'test')).filter(name=>/^[a-z-]+\.test\.mjs$/.test(name)).sort().map(name=>'test/'+name);
if(!files.length)throw Error('MISSING_CONTRACT_TESTS');
console.log(JSON.stringify({stage:'PORTABLE_CONTRACT_TESTS',files,publicChainWrites:false}));
run(['--test','--test-reporter=tap','--test-concurrency=1',...files]);
