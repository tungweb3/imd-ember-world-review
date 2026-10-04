import {readFileSync,writeFileSync} from 'node:fs';
import {runSeed,minimizeFailure} from '../tests/auth-scheduler-driver.mjs';
import {runAudit8Seed,minimizeAudit8Failure} from '../tests/auth-audit8-causes.mjs';
import {sanitizeArtifact} from '../tests/auth-artifacts.mjs';
const args=process.argv.slice(2),file=args[args.indexOf('--replay')+1];
if(!args.includes('--replay')||!file)throw new Error('Usage: node scripts/replay-auth-trace.mjs --replay trace.json [--minimize output.json]');
const loaded=JSON.parse(readFileSync(file,'utf8')),trace=loaded.trace??loaded;
if(!Number.isInteger(trace.seed)||!Array.isArray(trace.actions))throw new Error('Trace must include seed and complete causal actions');
const audit8=Boolean(trace.audit8Oracle),replay=()=>audit8?runAudit8Seed(trace.seed,{kernel:trace.kernel,replayActions:trace.actions,retainTrace:true}):runSeed(trace.seed,{replayActions:trace.actions,retainTrace:true});
try{const result=await replay();console.log(JSON.stringify({status:'PASS',seed:trace.seed,traceDigest:result.traceDigest,counts:result.counts,metrics:result.metrics}));}
catch(error){console.error(JSON.stringify(sanitizeArtifact({status:'FAIL',seed:trace.seed,invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null})));
  if(args.includes('--minimize')&&error.invariant){const out=args[args.indexOf('--minimize')+1];if(!out)throw new Error('--minimize needs output path');
    const minimized=await (audit8?minimizeAudit8Failure:minimizeFailure)(error.schedulerTrace??trace,error.invariant);writeFileSync(out,JSON.stringify(sanitizeArtifact({invariant:error.invariant,trace:minimized}),null,2)+'\n');}
  process.exitCode=1;
}
