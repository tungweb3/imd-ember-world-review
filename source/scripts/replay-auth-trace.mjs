import {readFileSync,writeFileSync} from 'node:fs';
import {runSeed,minimizeFailure} from '../tests/auth-scheduler-driver.mjs';
const args=process.argv.slice(2),file=args[args.indexOf('--replay')+1];
if(!args.includes('--replay')||!file)throw new Error('Usage: node scripts/replay-auth-trace.mjs --replay trace.json [--minimize output.json]');
const loaded=JSON.parse(readFileSync(file,'utf8')),trace=loaded.trace??loaded;
if(!Number.isInteger(trace.seed)||!Array.isArray(trace.actions))throw new Error('Trace must include seed and complete causal actions');
try{const result=await runSeed(trace.seed,{replayActions:trace.actions,retainTrace:true});console.log(JSON.stringify({status:'PASS',seed:trace.seed,traceDigest:result.traceDigest,counts:result.counts,metrics:result.metrics}));}
catch(error){console.error(JSON.stringify({status:'FAIL',seed:trace.seed,invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null}));
  if(args.includes('--minimize')&&error.invariant){const out=args[args.indexOf('--minimize')+1];if(!out)throw new Error('--minimize needs output path');
    const minimized=await minimizeFailure(error.schedulerTrace??trace,error.invariant);writeFileSync(out,JSON.stringify({invariant:error.invariant,trace:minimized},null,2)+'\n');}
  process.exitCode=1;
}
