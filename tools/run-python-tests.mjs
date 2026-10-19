import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {root,verifySelectedSource} from './verify-source.mjs';
verifySelectedSource();
const result=spawnSync(process.env.REVIEW_PYTHON||'python3',['-m','unittest','test_world_gold_delivery','test_world_trial','test_world_trial_audit5','test_world_trial_audit6','-v'],{cwd:resolve(root,'aimarket'),stdio:'inherit',shell:false});
if(result.error)throw Error('PYTHON3_REQUIRED: set REVIEW_PYTHON to a Python 3 executable');
if(result.signal)throw Error('PYTHON_TEST_SIGNAL: '+result.signal);
process.exitCode=result.status??1;
