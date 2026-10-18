import {mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {root,verifySelectedSource} from './verify-source.mjs';

if(Number(process.versions.node.split('.')[0])!==24)throw Error('NODE_24_REQUIRED');
const {manifest}=verifySelectedSource();
if(!existsSync(resolve(root,'contracts/test/runtime.mjs')))throw Error('PORTABLE_CONTRACT_PACKAGE_REQUIRED_FOR_JOURNEY_TEST');
mkdirSync(resolve(root,'release'),{recursive:true});
mkdirSync(resolve(root,'.rd/recheck-2026-10-16/ledger'),{recursive:true});
const files=manifest.selectedTests.map(path=>path.slice('world-source/'.length));
console.log(JSON.stringify({stage:'SELECTED_FINANCIAL_TESTS',files,sourceCommit:manifest.sourceCommit,fullWorkerTestExcluded:true}));
const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=2',...files],{cwd:resolve(root,'world-source'),stdio:'inherit',shell:false});
if(result.error)throw result.error;
if(result.signal)throw Error('FINANCIAL_TEST_SIGNAL: '+result.signal);
process.exitCode=result.status??1;
