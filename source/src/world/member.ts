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
 *  no answer even after the one retry. */
export type SaveError={code:string;reason?:string;nextNameChangeAt?:number};
export type MemberState={
  /** The signed-in wallet (lowercase) this state is for; null when signed out. */
  address:string|null;
  /** idle: signed out; loading: the first answer is pending; ready: `view` is the server's; unavailable: no answer (a 503,
   *  429 or network failure): shown as such, never as "no name yet". */
  phase:'idle'|'loading'|'ready'|'unavailable';
  view:MemberView|null;saving:boolean;error:SaveError|null;
  /** "Not now" was chosen on this browser for this member: the naming card stays folded (no fake name is made). */
  skipped:boolean;
};
export type SessionSource={readonly state:{session:{address:string}|null};subscribe(fn:()=>void):()=>void};
export type MemberDeps={fetch:(path:string,init?:RequestInit)=>Promise<Response>;storage?:Pick<Storage,'getItem'|'setItem'>|null;
  newId?:()=>string;wait?:(ms:number)=>Promise<void>};
export const INITIAL_MEMBER:MemberState={address:null,phase:'idle',view:null,saving:false,error:null,skipped:false};
const SKIP_KEY='imd.member.skip.';
const json=(method:string,body?:unknown):RequestInit=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body??{}),credentials:'same-origin'});
const errorOf=async(r:Response):Promise<SaveError>=>{try{const v=await r.clone().json() as {error?:unknown;reason?:unknown;nextNameChangeAt?:unknown};
  return {code:typeof v.error==='string'?v.error:'HTTP_'+r.status,...typeof v.reason==='string'?{reason:v.reason}:{},...typeof v.nextNameChangeAt==='number'?{nextNameChangeAt:v.nextNameChangeAt}:{}};}
  catch{return {code:'HTTP_'+r.status};}};
const randomId=()=>{const b=crypto.getRandomValues(new Uint8Array(16));return 'r-'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');};

export class MemberClient{
  private s:MemberState=INITIAL_MEMBER;private listeners=new Set<()=>void>();private gen=0;private unsub:(()=>void)|null=null;
  private auth:SessionSource;private deps:MemberDeps;
  constructor(auth:SessionSource,deps:MemberDeps){this.auth=auth;this.deps=deps;}
  get state(){return this.s;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  private set(patch:Partial<MemberState>){this.s={...this.s,...patch};for(const fn of this.listeners)fn();}
  /** Follows the session: another wallet (or none) starts over and drops whatever was pending. Returns the stop. */
  start=()=>{
    if(!this.unsub){this.unsub=this.auth.subscribe(()=>this.follow());this.follow();}
    return ()=>{this.unsub?.();this.unsub=null;};
  };
  private follow(){
    const a=this.auth.state.session?.address.toLowerCase()??null;
    if(a===this.s.address)return;
    this.gen++;
    this.s={...INITIAL_MEMBER,address:a,phase:a?'loading':'idle'};for(const fn of this.listeners)fn();
    if(a)void this.load();
  }
  /** The answer is this state's only if nothing changed meanwhile and it names this state's wallet. */
  private mine(gen:number,v?:MemberView){return gen===this.gen&&(!v||v.loginWallet.address.toLowerCase()===this.s.address);}
  private skippedFor(v:MemberView){try{return this.deps.storage?.getItem(SKIP_KEY+v.member.publicMemberId)==='1';}catch{return false;}}
  /** GET /api/me/profile, and only when the member does not exist yet (404) POST /api/me/bootstrap, which creates it: a
   *  page load spends the read bucket, not the per-IP write one (the review of member-1003). The session alone decides whose. */
  load=async()=>{
    const gen=this.gen;if(!this.s.address)return;
    if(this.s.phase!=='ready')this.set({phase:'loading'});
    try{
      let r=await this.deps.fetch('/api/me/profile',{credentials:'same-origin'});if(!this.mine(gen))return;
      if(r.status===404){r=await this.deps.fetch('/api/me/bootstrap',json('POST'));if(!this.mine(gen))return;}
      if(r.status===401){this.set({phase:'idle',view:null});return;}          // the session ended: auth.ts finds out and says so
      if(!r.ok){this.set({phase:this.s.view?'ready':'unavailable'});return;}
      const v=await r.json() as MemberView;if(!this.mine(gen,v))return;
      this.set({phase:'ready',view:v,skipped:this.skippedFor(v)});
    }catch{if(this.mine(gen))this.set({phase:this.s.view?'ready':'unavailable'});}
  };
  /** Folds the first-name card on this browser for this member (no name is made, none is reserved). */
  skip=()=>{const v=this.s.view;if(!v)return;try{this.deps.storage?.setItem(SKIP_KEY+v.member.publicMemberId,'1');}catch{/* this visit only */}this.set({skipped:true});};
  clearError=()=>{if(this.s.error)this.set({error:null});};
  /** PUT /api/me/profile for the member and version shown. A lost answer is retried once with the same request id, so a
   *  save that did land is answered as such and spends no second cooldown. True when saved. */
  save=async(displayName:string):Promise<boolean>=>{
    const v=this.s.view,gen=this.gen;if(!v||this.s.saving)return false;
    const body={displayName,expectedActorPublicId:v.member.publicMemberId,expectedProfileVersion:v.member.version,requestId:(this.deps.newId??randomId)()};
    this.set({saving:true,error:null});
    let r:Response|null=null;
    for(let attempt=0;attempt<2&&!r;attempt++){
      try{r=await this.deps.fetch('/api/me/profile',json('PUT',body));}
      catch{if(attempt===0)await (this.deps.wait??(ms=>new Promise(f=>setTimeout(f,ms))))(1000);}
      if(!this.mine(gen))return false;
    }
    if(!r){this.set({saving:false,error:{code:'NETWORK'}});return false;}
    if(r.ok){
      const next=await r.json() as MemberView;if(!this.mine(gen,next))return false;
      this.set({saving:false,view:next,phase:'ready',error:null});return true;
    }
    const error=await errorOf(r);if(!this.mine(gen))return false;
    this.set({saving:false,error});
    // The profile moved on (another tab) or the cookie is another wallet's now: read again; the form stays as typed.
    if(error.code==='PROFILE_VERSION_CONFLICT'||error.code==='ACCOUNT_CONTEXT_CHANGED')void this.load();
    if(error.code==='NAME_CHANGE_COOLDOWN'&&error.nextNameChangeAt)this.set({view:{...v,member:{...v.member,nextNameChangeAt:error.nextNameChangeAt}}});
    return false;
  };
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
