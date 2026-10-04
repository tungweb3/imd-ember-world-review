// Actual causal driver additions, with expected authority from a separate pure
// oracle. No source-policy helper imports or replacement Worker/SQLite handlers.
import {SchedulerDriver,TEST_ADDRESSES} from './auth-scheduler-driver.mjs';
import {Audit8Reference,AUDIT8_ORACLE_VERSION} from './auth-audit8-reference.mjs';
import {InvariantFailure} from './auth-reference-model.mjs';
import {createHash} from 'node:crypto';
export const AUDIT8_KERNELS=['passive-discovery','lock-503-same-unlock','hint-while-prompt'];
const rule=(ok,message,detail={})=>{if(!ok)throw new InvariantFailure('AUDIT8-CAUSAL',message,detail);};
export class Audit8Scheduler extends SchedulerDriver{
  constructor(seed){super(seed);this.model=new Audit8Reference(TEST_ADDRESSES,this.w.clock.now());this.model.tab('a','A');this.model.tab('b','A');}
  async action(action,options={}){
    if(action.type!=='discovery'&&action.type!=='unlock')return super.action(action,options);
    if(options.record!==false)this.actions.push({...action});this.mark('action',action);
    const q=this.tabs.get(action.tab);
    if(action.type==='discovery'){
      this.model.discovery(action.tab);
      q.providerEvent(action.account,'discovery');
    }else{this.model.unlock(action.tab,action.account);q.accountEvent(action.account);}
    await this.pump();return this;
  }
}
const verify=d=>d.requests.find(r=>r.path==='/api/auth/verify'&&r.tab==='a');
export async function runAudit8Seed(seed,{kernel=AUDIT8_KERNELS[seed%3],replayActions=null,retainTrace=true}={}){
  const d=new Audit8Scheduler(seed);
  try{
    if(replayActions){for(const action of replayActions)await d.action(action);await d.pump();d.checkpoint('audit8-replay-final');
      if(d.metrics.workerCalls<2||d.prompts.length!==1)throw new InvariantFailure('HARNESS-NONVACUOUS','Audit8 replay must retain real canonical route effects and one original signing prompt');
      if(d.enabled().length)throw new InvariantFailure('HARNESS-TRACE-INCOMPLETE','explicit replay omits causal completion steps required by the selected source');
      if(kernel==='hint-while-prompt')d.model.requireValidSignatureCompletion('a');}
    else{
      await d.action({type:'start',tab:'a'});await d.action({type:'start',tab:'b'});await d.drain();d.checkpoint('initial-ABSENT');
      if(kernel==='passive-discovery'){
        await d.action({type:'click',tab:'a'});await d.drain();d.checkpoint('accepted-before-discovery');
        await d.action({type:'discovery',tab:'a',account:seed%2?'A':null});await d.drain();d.checkpoint('passive-discovery');
        rule(d.model.counts().live===1&&!d.requests.some(r=>r.path==='/api/auth/logout'),'passive provider discovery cannot revoke accepted identity');
        rule(d.prompts.length===1,'passive discovery cannot request another signature');
      }else if(kernel==='lock-503-same-unlock'){
        await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>verify(d)?.stage==='exposed',{hold:(r,type)=>r.path==='/api/auth/verify'&&type==='body',label:'committed verify body held'});
        await d.action({type:'fault-session',value:503});await d.action({type:'lock',tab:'a'});
        if(seed%2){
          await d.drain((r,type)=>r.path==='/api/auth/verify'&&type==='body');
        }else{
          await d.runUntil(()=>d.requests.some(r=>r.path==='/api/auth/session'&&r.fault===503&&r.stage==='committed'),
            {hold:(r,type)=>r.path==='/api/auth/verify'&&type==='body'||r.fault===503&&type==='headers',label:'old failed reconcile held before headers'});
        }
        await d.action({type:'unlock',tab:'a',account:'A'});await d.drain();d.checkpoint('same-account-unlock-preserves-commit');
        rule(d.model.counts().live===1&&!d.requests.some(r=>r.path==='/api/auth/logout'),'same-account unlock and stale lock callback cannot revoke committed session');
      }else if(kernel==='hint-while-prompt'){
        await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>d.prompts.length===1,{hold:(_r,type)=>type==='prompt',label:'valid personal_sign is open'});
        await d.action({type:'hint',tab:'a'});await d.drain((_r,type)=>type==='prompt');
        d.checkpoint('ordinary-hint-during-prompt');await d.drain();d.checkpoint('valid-signature-after-hint');
        d.model.requireValidSignatureCompletion('a');
      }else throw new InvariantFailure('HARNESS-ACTION','unknown Audit8 kernel');
      d.checkpoint('audit8-final');
    }
    const result=retainTrace?d.trace(kernel):d.summary(kernel);return {...result,audit8Oracle:AUDIT8_ORACLE_VERSION};
  }catch(error){error.schedulerTrace={...d.trace(kernel),audit8Oracle:AUDIT8_ORACLE_VERSION,
      failure:{invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null}};throw error;}
  finally{await d.close();}
}
export async function minimizeAudit8Failure(trace,invariant,{maxTrials=36}={}){
  const witness=trace.failure,same=error=>error.invariant===invariant&&(!witness||error.message===witness.message&&
    ['tab','prompts','challenges'].every(key=>witness.detail?.[key]===undefined||error.detail?.[key]===witness.detail[key]));
  let actions=trace.actions,attempts=0,invalid=0;
  for(let span=Math.max(1,Math.floor(actions.length/2));span>=1&&attempts<maxTrials;span=Math.floor(span/2)){
    for(let at=0;at<actions.length&&attempts<maxTrials;at+=span){const candidate=actions.slice(0,at).concat(actions.slice(at+span));attempts++;
      try{await runAudit8Seed(trace.seed,{kernel:trace.kernel,replayActions:candidate});}catch(error){
        if(same(error)){actions=candidate;at=Math.max(-span,at-span);}else if(error.invariant?.startsWith('HARNESS')||!error.invariant)invalid++;}}
  }
  let reproduced=false;try{await runAudit8Seed(trace.seed,{kernel:trace.kernel,replayActions:actions});}catch(error){reproduced=same(error);}
  return {...trace,actions,eventCount:actions.length,traceDigest:createHash('sha256').update(JSON.stringify(actions)).digest('hex'),
    minimization:{attempts,invalid,reproduced,originalEvents:trace.actions.length}};
}
