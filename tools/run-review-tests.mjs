import {spawnSync} from 'node:child_process';
import {root,verifySelectedSource} from './verify-source.mjs';
verifySelectedSource();
for(const script of ['tools/run-contract-tests.mjs','tools/run-selected-financial-tests.mjs']){
 const result=spawnSync(process.execPath,[script],{cwd:root,stdio:'inherit',shell:false});
 if(result.error)throw result.error;if(result.signal)throw Error('REVIEW_TEST_SIGNAL: '+result.signal);
 if(result.status!==0){process.exitCode=result.status??1;break;}
}
