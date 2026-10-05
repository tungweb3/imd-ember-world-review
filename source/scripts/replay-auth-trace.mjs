import {readFileSync,realpathSync} from 'node:fs';
import {resolve,relative,dirname,basename} from 'node:path';
import {runSeed,minimizeFailure} from '../tests/auth-scheduler-driver.mjs';
import {runAudit8Seed,minimizeAudit8Failure} from '../tests/auth-audit8-causes.mjs';
import {createArtifactStore,sanitizeArtifact} from '../tests/auth-artifacts.mjs';
function artifactOperation(operation){
  try{return operation();}catch(error){error.artifactRejected=true;throw error;}
}
async function main(){
const args=process.argv.slice(2),file=args[args.indexOf('--replay')+1];
if(!args.includes('--replay')||!file)throw new Error('Usage: node scripts/replay-auth-trace.mjs --replay trace.json [--minimize output.json]');
let store=null,outputName=null;
if(args.includes('--minimize')){
  const out=args[args.indexOf('--minimize')+1];if(!out)throw new Error('--minimize needs output path');
  // Resolving the existing input is a read/replay operation, not an output rejection.
  const inputPath=realpathSync(resolve(file));
  artifactOperation(()=>{
    const output=resolve(out),source=resolve(import.meta.dirname,'..');
    if(relative(inputPath,output)==='')throw new Error('minimized output must be separate from the replay input');
    // Use the same contained, namespace-checked writer as the supported runner.
    // Resolving the path preserves cwd-relative CLI usage without a second sink.
    const requestedDir=relative(source,dirname(output));
    if(!requestedDir)throw new Error('artifacts must use a child directory of source/tmp');
    store=createArtifactStore({sourceDir:source,requestedDir});outputName=basename(output);
  });
}
const loaded=JSON.parse(readFileSync(file,'utf8')),trace=loaded.trace??loaded;
if(!Number.isInteger(trace.seed)||!Array.isArray(trace.actions))throw new Error('Trace must include seed and complete causal actions');
const audit8=Boolean(trace.audit8Oracle),replay=()=>audit8?runAudit8Seed(trace.seed,{kernel:trace.kernel,replayActions:trace.actions,retainTrace:true}):runSeed(trace.seed,{replayActions:trace.actions,retainTrace:true});
try{const result=await replay();console.log(JSON.stringify({status:'PASS',seed:trace.seed,traceDigest:result.traceDigest,counts:result.counts,metrics:result.metrics}));}
catch(error){console.error(JSON.stringify(sanitizeArtifact({status:'FAIL',seed:trace.seed,invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null})));
  if(store&&error.invariant){
    const minimized=await (audit8?minimizeAudit8Failure:minimizeFailure)(error.schedulerTrace??trace,error.invariant);
    artifactOperation(()=>store.write(outputName,{invariant:error.invariant,trace:minimized}));}
  process.exitCode=1;
}
}
await main().catch(error=>{
  console.error(JSON.stringify(sanitizeArtifact({status:'FAIL',invariant:error.artifactRejected?'ARTIFACT_REJECTED':'REPLAY_ERROR',message:error.message,code:error.code??null})));
  process.exitCode=1;
});
