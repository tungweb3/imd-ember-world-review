/** Security transitions, independent of React state, timers, cookie transport and house reads. */
export type LifecycleSession={address:string;expiresAt:number};
export type SessionKnowledge={kind:'UNKNOWN'}|{kind:'ABSENT'}|{kind:'PRESENT';session:LifecycleSession};
export type LifecycleState='IDLE_UNKNOWN'|'IDLE_ABSENT'|'IDLE_PRESENT'|'PREFLIGHT_READING_SESSION'|'CONNECTING_WALLET'|
  'CHALLENGE_REQUESTED'|'CHALLENGE_READY'|'SIGNATURE_PROMPTING'|'VERIFY_IN_FLIGHT'|'VERIFY_COMMITTED_UNCERTAIN'|
  'VERIFY_RECONCILING'|'PRESENT_ACCEPTED'|'ABANDONED_CLEANUP_PENDING'|'STOPPED';
import type {CancellationReason} from './authCleanup.ts';
export type PreflightReceipt={readonly clickId:number;readonly readSeq:number;generation:number;readonly life:number;readonly knowledge:SessionKnowledge};
export type CleanupOwner={readonly flowId:number;readonly clickId:number;readonly generation:number;readonly life:number;
  readonly nonce:string;readonly account:string;readonly startedAtReadSeq:number;responseFence:number|null;
  responseObserved:boolean;status:'RETAINED'|'RELEASED'|'CONSUMED';abandoned:boolean;inFlight:boolean;attemptObserved:boolean;
  cancellationReason:CancellationReason|null;reconciling:boolean};
export type ClickOwner={readonly id:number;readonly provider:object;readonly accountAtClick:string|null;
  readonly generationAtClick:number;generation:number;readonly life:number;account:string|null;valid:boolean;
  state:LifecycleState;nonce?:string;owner?:CleanupOwner;preflight?:PreflightReceipt};
const transitions:Partial<Record<LifecycleState,readonly LifecycleState[]>>={
  PREFLIGHT_READING_SESSION:['CONNECTING_WALLET','CHALLENGE_REQUESTED'],CONNECTING_WALLET:['CHALLENGE_REQUESTED'],
  CHALLENGE_REQUESTED:['CHALLENGE_READY'],CHALLENGE_READY:['SIGNATURE_PROMPTING'],SIGNATURE_PROMPTING:['VERIFY_IN_FLIGHT'],
  VERIFY_IN_FLIGHT:['VERIFY_RECONCILING'],VERIFY_COMMITTED_UNCERTAIN:['VERIFY_RECONCILING'],VERIFY_RECONCILING:['VERIFY_RECONCILING'],
};

export class AuthLifecycle{
  private nextClick=0;private nextFlow=0;private intent:ClickOwner|null=null;private lastOwner:CleanupOwner|null=null;
  private owners=new Set<CleanupOwner>();
  private stopped=false;private stage:LifecycleState='IDLE_UNKNOWN';
  private evidence:SessionKnowledge={kind:'UNKNOWN'};
  get busy(){return this.intent!==null;}
  get click(){return this.intent;}
  get knowledge(){return this.evidence;}
  get retained(){return [...this.owners].reverse().find(o=>o.status==='RETAINED')??null;}
  get retainedOwners(){return [...this.owners];}
  private matching(generation:number,life:number){return [...this.owners].find(o=>o.generation===generation&&o.life===life);}
  private idle(){return this.evidence.kind==='PRESENT'?'IDLE_PRESENT':this.evidence.kind==='ABSENT'?'IDLE_ABSENT':'IDLE_UNKNOWN';}
  start(){this.stopped=false;this.stage=this.idle();}
  know(v:SessionKnowledge){this.evidence=v;if(v.kind!=='ABSENT'&&this.intent)this.intent.preflight=undefined;
    if(!this.intent&&!this.stopped)this.stage=this.idle();}
  begin(provider:object,account:string|null,generation:number,life:number){
    if(this.intent)return null;
    const c:ClickOwner={id:++this.nextClick,provider,accountAtClick:account,account,generationAtClick:generation,generation,life,
      valid:true,state:'PREFLIGHT_READING_SESSION'};
    this.intent=c;this.stage=c.state;return c;
  }
  current(c:ClickOwner,provider:object|null,account:string|null,generation:number,life:number){
    return this.intent===c&&c.valid&&c.provider===provider&&c.account===account&&c.generation===generation&&c.life===life;
  }
  transition(c:ClickOwner,state:LifecycleState){
    if(this.intent!==c||!c.valid||!transitions[c.state]?.includes(state)||
      (state==='CHALLENGE_REQUESTED'||state==='SIGNATURE_PROMPTING')&&!this.hasAbsentPreflight(c))return false;
    c.state=state;this.stage=state;return true;
  }
  preflight(c:ClickOwner,knowledge:SessionKnowledge,readSeq:number){
    if(this.intent!==c||!c.valid)return false;
    c.preflight={clickId:c.id,readSeq,generation:c.generation,life:c.life,knowledge};return true;
  }
  hasAbsentPreflight(c:ClickOwner){const r=c.preflight;return this.intent===c&&c.valid&&r?.clickId===c.id&&
    r.generation===c.generation&&r.life===c.life&&r.knowledge.kind==='ABSENT'&&this.evidence.kind==='ABSENT';}
  promote(c:ClickOwner,generation:number){if(this.intent===c&&c.valid){c.generation=generation;if(c.preflight)c.preflight.generation=generation;}}
  /** Only an explicit initial connection can pin an account; an existing click never migrates accounts. */
  connected(c:ClickOwner,account:string){
    if(this.intent!==c||!c.valid||c.state!=='CONNECTING_WALLET'||c.accountAtClick!==null||c.account!==null&&c.account!==account)return false;
    c.account=account;return true;
  }
  discovered(provider:object,account:string){
    const c=this.intent;
    if(c&&c.provider===provider&&c.valid&&c.accountAtClick===null&&c.account===null&&c.state==='PREFLIGHT_READING_SESSION')c.account=account;
  }
  finish(c:ClickOwner){c.valid=false;if(this.intent===c){this.intent=null;if(!this.stopped)this.stage=this.idle();}}
  cancel(stop=false){const c=this.intent;if(c)this.finish(c);if(stop){this.stopped=true;this.stage='STOPPED';}return c;}
  challenge(c:ClickOwner,nonce:string){if(this.transition(c,'CHALLENGE_READY'))c.nonce=nonce;}
  verify(c:ClickOwner,readSeq:number){
    if(this.intent!==c||!c.valid||!c.account||!c.nonce||c.state!=='SIGNATURE_PROMPTING'||!this.hasAbsentPreflight(c))throw new Error('Verify requires a live checked click');
    const o:CleanupOwner={flowId:++this.nextFlow,clickId:c.id,generation:c.generation,life:c.life,nonce:c.nonce,account:c.account,
      startedAtReadSeq:readSeq,responseFence:null,responseObserved:false,status:'RETAINED',abandoned:false,inFlight:false,attemptObserved:false,
      cancellationReason:null,reconciling:false};
    c.owner=o;this.lastOwner=o;this.owners.add(o);this.know({kind:'UNKNOWN'});this.transition(c,'VERIFY_IN_FLIGHT');return o;
  }
  observe(o:CleanupOwner,readSeq:number){
    if(o.responseObserved)return;o.responseObserved=true;o.responseFence=readSeq;
    if(o.status==='RETAINED'&&!o.abandoned&&!this.stopped){this.stage='VERIFY_COMMITTED_UNCERTAIN';if(this.intent?.owner===o)this.intent.state=this.stage;}
  }
  /** A read begun before response observation may be newer than dispatch and still predate commit. */
  mayRead(readSeq:number,generation:number,life:number){
    const o=this.matching(generation,life);if(!o)return true;
    return o.responseFence!==null&&readSeq>o.responseFence;
  }
  read(v:SessionKnowledge,readSeq:number,generation:number,life:number){
    if(!this.mayRead(readSeq,generation,life))return false;
    const o=this.matching(generation,life);
    if(v.kind!=='UNKNOWN'&&o)this.release(o);
    this.know(v);if(v.kind==='PRESENT'&&!this.stopped)this.stage='PRESENT_ACCEPTED';return true;
  }
  release(o:CleanupOwner){if(o.status==='RETAINED'){o.status='RELEASED';this.owners.delete(o);}}
  /** Lock reconciliation uses the current lifetime read, but must still be causally after this original response. */
  reconcileOwner(o:CleanupOwner,v:SessionKnowledge,readSeq:number){
    if(o.status!=='RETAINED'||o.cancellationReason!=='lock-reconcile'||o.responseFence===null||readSeq<=o.responseFence||v.kind==='UNKNOWN')return false;
    this.release(o);return true;
  }
  accept(c:ClickOwner,o:CleanupOwner,session:LifecycleSession){
    if(this.intent!==c||!c.valid||c.owner!==o||o.status!=='RETAINED'||session.address!==c.account||session.address!==o.account)return false;
    this.release(o);this.know({kind:'PRESENT',session});this.stage='PRESENT_ACCEPTED';return true;
  }
  abandon(o:CleanupOwner,reason:CancellationReason='context-switch'){
    if(o.status!=='RETAINED')return false;o.abandoned=true;o.cancellationReason=reason;
    if(!this.stopped)this.stage=reason==='lock-reconcile'?'VERIFY_RECONCILING':'ABANDONED_CLEANUP_PENDING';return true;}
  claimCleanup(o:CleanupOwner){
    if(o.status!=='RETAINED'||!o.abandoned||o.inFlight)return false;
    o.inFlight=true;o.attemptObserved=o.responseObserved;return true;
  }
  /** Qualification is captured at dispatch, not completion: delayed early refusal still needs a post-fence attempt. */
  cleanupDone(o:CleanupOwner,ok:boolean){
    o.inFlight=false;if(o.status!=='RETAINED')return false;
    if(ok||o.attemptObserved){o.status='CONSUMED';this.owners.delete(o);return false;}
    return o.responseObserved; // drain one post-observation retry of this same owner
  }
  get snapshot(){
    const c=this.intent,o=this.lastOwner;
    return {state:this.stage,knowledge:this.evidence.kind==='PRESENT'?{kind:'PRESENT' as const,session:{...this.evidence.session}}:{...this.evidence},
      click:c?{id:c.id,accountAtClick:c.accountAtClick,account:c.account,generationAtClick:c.generationAtClick,generation:c.generation,
        life:c.life,valid:c.valid,state:c.state,preflight:c.preflight?{clickId:c.preflight.clickId,readSeq:c.preflight.readSeq,
          generation:c.preflight.generation,life:c.preflight.life,knowledge:c.preflight.knowledge.kind}:null}:null,
      cleanup:o?{flowId:o.flowId,clickId:o.clickId,status:o.status,abandoned:o.abandoned,inFlight:o.inFlight,
        startedAtReadSeq:o.startedAtReadSeq,responseFence:o.responseFence,responseObserved:o.responseObserved,
        cancellationReason:o.cancellationReason,reconciling:o.reconciling}:null,
      retainedCount:this.owners.size};
  }
}
