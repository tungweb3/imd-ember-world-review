// The player's member and name on the client (server/member.ts; [REDACTED]). The server is the authority:
// this keeps the last answer for the signed-in wallet and drops every answer that belongs to another one. It follows the
// sign-in client (auth.ts) and never asks the wallet anything: naming needs no signature.
// Three guards [REDACTED]: `gen` (a sign-out or another wallet makes every pending answer stale), the
// answer's own loginWallet (it must be the wallet this state is for), and the server's expectedActorPublicId and
// expectedProfileVersion on every write (a tab whose cookie now belongs to another wallet is refused there).
import type {ProfileState} from './memberName.ts';

export type MemberView={member:{publicMemberId:string;displayName:string|null;profileState:ProfileState;version:number;
    nameChangedAt:number|null;nextNameChangeAt:number|null};
  loginWallet:{chainId:number;address:string};economy:{available:number;reserved:number};life:{state:string;lifeNumber:number};serverTime:number};
/** A refused save: the server's code, the format reason (NAME_FORMAT_INVALID) or the time (NAME_CHANGE_COOLDOWN). 'NETWORK':
   *  no answer even after the one retry. SAVE_RESULT_UNKNOWN retains the original idempotent request. */
export type SaveError={code:string;reason?:string;nextNameChangeAt?:number};
export type MemberState={
  /** The signed-in wallet (lowercase) this state is for; null when signed out. */
  address:string|null;
  /** idle: signed out; loading: the first answer is pending; ready: `view` is the server's; unavailable: no answer (a 503,
   *  429 or network failure): shown as such, never as "no name yet". */
  phase:'idle'|'loading'|'ready'|'unavailable';
  view:MemberView|null;saving:boolean;error:SaveError|null;
  /** A transport failure has not yet been reconciled with the original request id. New names cannot be sent. */
  pendingSave:boolean;
  /** Time-based UI hint, calibrated from serverTime. The server still enforces every name change. */
  cooling:boolean;
  /** "Not now" was chosen on this browser for this member: the naming card stays folded (no fake name is made). */
  skipped:boolean;
};
export type SessionSource={readonly state:{session:{address:string}|null};subscribe(fn:()=>void):()=>void};
export type MemberDeps={fetch:(path:string,init?:RequestInit)=>Promise<Response>;storage?:Pick<Storage,'getItem'|'setItem'>|null;
  newId?:()=>string;wait?:(ms:number)=>Promise<void>;now?:()=>number;timers?:Timers};
export const INITIAL_MEMBER:MemberState={address:null,phase:'idle',view:null,saving:false,error:null,pendingSave:false,cooling:false,skipped:false};
const SKIP_KEY='imd.member.skip.';
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body??{}),credentials:'same-origin'});
const errorOf=async(r:Response):Promise<SaveError>=>{try{const v=await r.clone().json() as {error?:unknown;reason?:unknown;nextNameChangeAt?:unknown};
  return {code:typeof v.error==='string'?v.error:'HTTP_'+r.status,...typeof v.reason==='string'?{reason:v.reason}:{},...typeof v.nextNameChangeAt==='number'?{nextNameChangeAt:v.nextNameChangeAt}:{}};}
  catch{return {code:'HTTP_'+r.status};}};
const randomId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));return 'r-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');};
/** Bounds fetch plus body consumption, including a stream that never completes. Retries retain the same request id. */
export const PROFILE_WRITE_TIMEOUT_MS=15_000;
type SaveBody={displayName:string;expectedActorPublicId:string;expectedProfileVersion:number;requestId:string};
type PendingSave={body:SaveBody;uncertain:boolean};
/** A syntactically valid JSON body is not necessarily a profile response. Bad/truncated bodies enter recovery. */
function profileOf(value:unknown):MemberView{
  const v=value as MemberView,m=v?.member;
  if(!m||typeof m.publicMemberId!=='string'||!Number.isInteger(m.version)||m.version<0||
    !['needs_name','ready','needs_rename','locked'].includes(m.profileState)||
    !(m.displayName===null||typeof m.displayName==='string')||
    !(m.nextNameChangeAt===null||Number.isFinite(m.nextNameChangeAt))||!Number.isFinite(v.serverTime)||
    v.loginWallet?.chainId!==1||typeof v.loginWallet.address!=='string'||!/^0x[\da-f]{40}$/i.test(v.loginWallet.address))throw new Error('Invalid profile response');
  return v;
}
const REFUSAL_OUTCOMES=new Set(['NAME_UNAVAILABLE','NAME_CHANGE_COOLDOWN','PROFILE_VERSION_CONFLICT','PROFILE_LOCKED','IDEMPOTENCY_CONFLICT']);

export class MemberClient{
  private s:MemberState=INITIAL_MEMBER;private listeners=new Set<()=>void>();private gen=0;private unsub:(()=>void)|null=null;
  private reads=0;private saveRuns=0;private versions=new Map<string,number>();
  // Kept in this client only, per wallet: a switch drops responses, not an uncertain operation's request id.
  private pending=new Map<string,PendingSave>();private cooldownTimer:unknown=null;
  private timeBase:{local:number;server:number}|null=null;
  private auth:SessionSource;private deps:MemberDeps;
  constructor(auth:SessionSource,deps:MemberDeps){this.auth=auth;this.deps=deps;}
  get state(){return this.s;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  private set(patch:Partial<MemberState>){this.s={...this.s,...patch};for(const fn of this.listeners)fn();}
  /** Follows the session: another wallet (or none) starts over and drops whatever was pending. Returns the stop. */
  start=()=>{
    if(!this.unsub){this.unsub=this.auth.subscribe(()=>this.follow());if(!this.follow()&&this.s.address)void this.load();}
    return ()=>{this.unsub?.();this.unsub=null;this.gen++;this.reads++;this.saveRuns++;this.clearCooldown();
      const p=this.s.address?this.pending.get(this.s.address):null;if(p)p.uncertain=true;
      this.set({saving:false,pendingSave:!!p,...p?{error:{code:'SAVE_RESULT_UNKNOWN'}}:{}});};
  };
  private follow(){
    const a=this.auth.state.session?.address.toLowerCase()??null;
    if(a===this.s.address)return false;
    const abandoned=this.s.address?this.pending.get(this.s.address):null;if(abandoned)abandoned.uncertain=true;
    this.gen++;this.reads++;this.saveRuns++;this.versions.clear();this.timeBase=null;this.clearCooldown();
    const pending=!!a&&this.pending.has(a);
    this.s={...INITIAL_MEMBER,address:a,phase:a?'loading':'idle',pendingSave:pending,error:pending?{code:'SAVE_RESULT_UNKNOWN'}:null};for(const fn of this.listeners)fn();
    if(a)void this.load();
    return true;
  }
  /** The answer is this state's only if nothing changed meanwhile and it names this state's wallet. */
  private mine(gen:number,v?:MemberView){return gen===this.gen&&(!v||v.loginWallet.address.toLowerCase()===this.s.address);}
  private now(){return (this.deps.now??Date.now)();}
  private serverNow(){return this.timeBase?this.timeBase.server+Math.max(0,this.now()-this.timeBase.local):this.now();}
  private timers():Timers{return this.deps.timers??{set:(f,ms)=>setTimeout(f,ms),clear:t=>clearTimeout(t as ReturnType<typeof setTimeout>)};}
  private clearCooldown(){if(this.cooldownTimer!==null)this.timers().clear(this.cooldownTimer);this.cooldownTimer=null;}
  private armCooldown(){
    this.clearCooldown();const deadline=this.s.view?.member.nextNameChangeAt??null;
    const remaining=deadline===null?0:deadline-this.serverNow(),cooling=remaining>0;
    if(this.s.cooling!==cooling)this.set({cooling});
    if(!cooling||!this.unsub)return;
    const gen=this.gen;
    this.cooldownTimer=this.timers().set(()=>{this.cooldownTimer=null;if(!this.mine(gen))return;
      if(deadline!==null&&deadline>this.serverNow()){this.armCooldown();return;}
      this.set({cooling:false});void this.load();
    },Math.min(remaining,2_147_483_647));
    // Local Node tests should not be kept alive by a seven-day browser timer.
    (this.cooldownTimer as {unref?:()=>void}|null)?.unref?.();
  }
  /** Versions cannot move backwards for a member in this account generation, even across GET/save ordering. */
  private accept(v:MemberView){
    const known=this.versions.get(v.member.publicMemberId)??-1;if(v.member.version<known)return false;
    this.versions.set(v.member.publicMemberId,v.member.version);this.timeBase={local:this.now(),server:v.serverTime};
    this.set({phase:'ready',view:v,skipped:this.skippedFor(v)});this.armCooldown();return true;
  }
  private skippedFor(v:MemberView){try{return this.deps.storage?.getItem(SKIP_KEY+v.member.publicMemberId)==='1';}catch{return false;}}
  /** GET /api/me/profile, and only when the member does not exist yet (404) POST /api/me/bootstrap, which creates it: a
   *  page load spends the read bucket, not the per-IP write one (the review of member-1003). The session alone decides whose. */
  load=async()=>{
    const gen=this.gen,read=++this.reads;if(!this.s.address)return;
    const current=(v?:MemberView)=>read===this.reads&&this.mine(gen,v);
    if(this.s.phase!=='ready')this.set({phase:'loading'});
    try{
      let r=await this.deps.fetch('/api/me/profile',{credentials:'same-origin'});if(!current())return;
      if(r.status===404){r=await this.deps.fetch('/api/me/bootstrap',json('POST'));if(!current())return;}
      if(r.status===401){this.clearCooldown();this.set({phase:'idle',view:null,cooling:false});return;} // auth.ts reconciles the session
      if(!r.ok){const error=await errorOf(r);if(!current())return;
        this.set({phase:this.s.view?'ready':'unavailable',...error.code==='CONTRACT_WRITE_NOT_ENABLED'?{error}:{}});return;}
      const v=profileOf(await r.json());if(!current(v))return;this.accept(v);
    }catch{if(current())this.set({phase:this.s.view?'ready':'unavailable'});}
  };
  /** Folds the first-name card on this browser for this member (no name is made, none is reserved). */
  skip=()=>{const v=this.s.view;if(!v)return;try{this.deps.storage?.setItem(SKIP_KEY+v.member.publicMemberId,'1');}catch{/* this visit only */}this.set({skipped:true});};
  clearError=()=>{if(this.s.error)this.set({error:null});};
  /** A retry always uses the original body/id, including after a body failure or an account switch and return. */
  retrySave=async():Promise<boolean>=>{
    const a=this.s.address,p=a?this.pending.get(a):null;if(!p||this.s.saving)return false;return this.submit(p);
  };
  save=async(displayName:string):Promise<boolean>=>{
    const v=this.s.view,a=this.s.address;if(!v||!a||this.s.saving)return false;
    const old=this.pending.get(a);if(old){if(old.body.displayName===displayName)return this.submit(old);
      this.set({error:{code:'SAVE_RESULT_UNKNOWN'},pendingSave:true});return false;}
    const p:PendingSave={body:{displayName,expectedActorPublicId:v.member.publicMemberId,expectedProfileVersion:v.member.version,
      requestId:(this.deps.newId??randomId)()},uncertain:false};this.pending.set(a,p);return this.submit(p);
  };
  private async write(body:SaveBody,current:()=>boolean):Promise<{r:Response;next?:MemberView;error?:SaveError}>{
    const abort=new AbortController();let timer:unknown;
    const timeout=new Promise<never>((_,reject)=>{timer=this.timers().set(()=>{abort.abort();reject(new Error('Profile write timeout'));},PROFILE_WRITE_TIMEOUT_MS);});
    try{return await Promise.race([timeout,(async()=>{
      const r=await this.deps.fetch('/api/me/profile',{...json('PUT',body),signal:abort.signal});
      if(!current())throw new Error('Stale profile write');
      return r.ok?{r,next:profileOf(await r.json())}:{r,error:await errorOf(r)};
    })()]);}finally{this.timers().clear(timer);}
  }
  private async submit(p:PendingSave):Promise<boolean>{
    const gen=this.gen,run=++this.saveRuns,a=this.s.address;if(!a)return false;
    const current=(v?:MemberView)=>run===this.saveRuns&&this.mine(gen,v);
    this.set({saving:true,pendingSave:p.uncertain,error:null});
    try{
      for(let attempt=0;attempt<2;attempt++){
        try{
          const result=await this.write(p.body,current);if(!current())return false;const {r}=result;
          if(r.ok){const next=result.next!;
            if(!current(next)){p.uncertain=true;this.set({pendingSave:true,error:{code:'SAVE_RESULT_UNKNOWN'}});void this.load();return false;}
            this.pending.delete(a);this.reads++;this.accept(next);this.set({pendingSave:false,error:null});return true;}
          const error=result.error!;
          // A retry stopped before looking up the request (IP limit, 401, 503) does not settle an earlier uncertain PUT.
          if(r.status>=500||(p.uncertain&&!REFUSAL_OUTCOMES.has(error.code))){p.uncertain=true;}
          else{
            this.pending.delete(a);this.set({pendingSave:false,error});
            if(error.code==='PROFILE_VERSION_CONFLICT'||error.code==='ACCOUNT_CONTEXT_CHANGED'||error.code==='NAME_CHANGE_COOLDOWN')void this.load();
            return false;
          }
        }catch{p.uncertain=true;}
        if(!current())return false;
        if(attempt===0)await (this.deps.wait??(ms=>new Promise<void>(f=>setTimeout(f,ms))))(1000);
      }
      if(current()){this.set({error:{code:'SAVE_RESULT_UNKNOWN'},pendingSave:true});void this.load();}
      return false;
    }catch{if(current()){p.uncertain=true;this.set({error:{code:'SAVE_RESULT_UNKNOWN'},pendingSave:true});void this.load();}return false;}
    finally{if(current())this.set({saving:false});}
  }
}
export function createMember(auth:SessionSource){
  return new MemberClient(auth,{fetch:(p,i)=>fetch(p,i),storage:(()=>{try{return localStorage;}catch{return null;}})()});
}

/** Public names of other wallets (GET /api/world/names/:address) for their house panels, kept a minute per address in
 *  this page; a failure is "no name" (the panel shows the household as before). */
const NAME_TTL_MS=60_000;
const names=new Map<string,{at:number;name:Promise<string|null>}>();
export function publicName(address:string,now=Date.now(),get:(p:string)=>Promise<Response>=p=>fetch(p,{credentials:'same-origin'})):Promise<string|null>{
  const a=address.toLowerCase();if(!/^0x[\da-f]{40}$/.test(a))return Promise.resolve(null);
  const hit=names.get(a);if(hit&&now-hit.at<NAME_TTL_MS)return hit.name;
  const name=get('/api/world/names/'+a).then(async r=>{if(!r.ok)return null;const v=await r.json() as {name?:unknown};return typeof v.name==='string'?v.name:null;}).catch(()=>null);
  names.set(a,{at:now,name});if(names.size>256)names.delete(names.keys().next().value!);
  return name;
}
/** How long a house panel waits before asking for its owner's name: clicking through houses asks only for the one the
 *  viewer stops at (the edge rule allows 20 /api/ requests per 10 s per IP and then blocks sign-in too). A name already
 *  read in the last minute is answered at once. */
export const NAME_LOOKUP_DELAY_MS=400;
export type Timers={set:(f:()=>void,ms:number)=>unknown;clear:(t:unknown)=>void};
/** Asks for `address`'s public name after NAME_LOOKUP_DELAY_MS (at once when kept); the returned function cancels it, as
 *  the panel does when it shows another house or closes. */
export function lookupName(address:string,onName:(name:string|null)=>void,{timers,now=Date.now,get}:{timers?:Timers;now?:()=>number;get?:(p:string)=>Promise<Response>}={}):()=>void{
  let live=true;const a=address.toLowerCase(),t=timers??{set:(f,ms)=>setTimeout(f,ms),clear:x=>clearTimeout(x as ReturnType<typeof setTimeout>)};
  const run=()=>{void publicName(a,now(),get).then(n=>{if(live)onName(n);});};
  const hit=names.get(a);if(hit&&now()-hit.at<NAME_TTL_MS){run();return ()=>{live=false;};}
  const timer=t.set(run,NAME_LOOKUP_DELAY_MS);
  return ()=>{live=false;t.clear(timer);};
}
