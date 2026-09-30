// Wallet sign-in on the client (W1, docs/wallet-login/DESIGN_W1_v001.md §9). The server is the only truth: the session is
// an HttpOnly cookie this code never sees, owner rights come from GET /api/me/home, and the SIWE text is built by the
// server; the client checks it line for line (siwe.ts) and only then personal_signs it (hex UTF-8; the one signature the client ever asks for). No crypto here and no viem in the bundle.
// Everything a test needs is injected (fetch, the EIP-1193 provider, the tab channel, the clock), so tests/wallet-client
// drive this class against the real Worker handler.
import type {HouseSize} from './houseSize.ts';
import type {PollEnv} from './cadence.ts';
import {checkSignInMessage,signInSummary,type SignInSummary} from './siwe.ts';

export type Provider={request:(args:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,fn:(v:unknown)=>void)=>void;removeListener?:(event:string,fn:(v:unknown)=>void)=>void};
export type MeSeat={tokenId:string;agentId:string|null;online:boolean;lastOnlineAt:number|null;counts:boolean;reason?:'not-agent'|'offline-24h'|'not-seen'};
export type MeHome={address:string;seats:MeSeat[];eligible:number;size:HouseSize|null;block:number;checkedAt:number;presence:'fresh'|'stale'|'unavailable';
  /** Not a complete answer (server/ownership.ts HomeView). 'limited': the NFT index was due while the server's chain budget
   *  was spent, so only IMD's roster (and an earlier index answer) named the seats that ownerOf then proved. 'partial':
   *  the wallet names more seats than one check covers (256; those whose agent can count were checked first), or the
   *  index had more pages than one read covers. */
  recheck?:'limited'|'partial'};
export type Session={address:string;expiresAt:number};
/** Spec 7.1: the nine states the chip and the panel show. */
export type AuthStatus='visitor'|'connected'|'awaitingSignature'|'verifying'|'owner'|'signedInNoHouse'|'expired'|'ownershipUnavailable'|'mismatch';
/** Why the last click did not end signed in, or signed out (shown once, never retried by itself). */
export type Notice='message-mismatch'|'no-wallet'|'connect-rejected'|'sign-rejected'|'rate-limited'|'busy'|'auth-unavailable'|'verify-unavailable'|'challenge-lost'|
  'signature-invalid'|'failed'|'unsupported-wallet'|'session-unknown'|'signout-failed'|'signout-all-stale';
export type AuthState={
  /** The wallet account this page is connected to (lowercase), from eth_accounts / eth_requestAccounts. */
  account:string|null;
  /** The server session (lowercase address) as GET /api/auth/session last said, or a verify just returned. */
  session:Session|null;
  /** The in-flight click: waiting for the wallet's signature, or for the server's verify. */
  phase:'idle'|'awaitingSignature'|'verifying';
  /** /api/me/home for the session: null not read yet; 'unavailable' a 503 (never "owns nothing"). */
  home:MeHome|'unavailable'|null;
  /** The session ran out (a 401 SESSION_EXPIRED, or the hint of this browser's last session is past its expiry). */
  expired:boolean;
  /** GET /api/auth/session has answered once (before that the chip shows nothing signed-in-ish). */
  restored:boolean;
  /** The last GET /api/auth/session was answered (200). After a failed read (network, 429, 503) nobody knows whether a
   *  session exists, so no signature is asked for until one is (CORR-02). */
  sessionKnown:boolean;
  /** A sign-out is on its way to the server (the page stays signed in until the server has revoked the session). */
  leaving:boolean;
  /** While the wallet's signature prompt is open: the summary read from the checked message (siwe.ts signInSummary),
   *  shown beside the prompt (F-1 UX). Null in every other phase. */
  signing:SignInSummary|null;
  checking:boolean;notice:Notice|null;
};
export const INITIAL:AuthState={account:null,session:null,phase:'idle',home:null,expired:false,restored:false,sessionKnown:false,leaving:false,signing:null,checking:false,notice:null};

/** The state the chip shows, derived from the facts only (so no two fields can disagree). Owner = the server read the
 *  session's seats and at least one counts, the connected wallet (if any) is the session's, and the session's expiresAt
 *  is still ahead of `now` on this device's clock (W-1: a session past its expiry is 'expired' here before any server
 *  says so, and a missing `now` counts as expired). A read that counted no seat but was not complete (`recheck`) is
 *  'ownershipUnavailable', never 'signedInNoHouse' (A-8: that is not a checked "no seat"). */
export function statusOf(s:AuthState,now:number):AuthStatus{
  if(s.phase!=='idle')return s.phase;
  if(s.session){
    if(!(s.session.expiresAt>now))return 'expired';
    if(s.account&&s.account!==s.session.address)return 'mismatch';
    if(s.home==='unavailable')return 'ownershipUnavailable';
    if(!s.home)return 'verifying';
    return s.home.eligible>0?'owner':s.home.recheck?'ownershipUnavailable':'signedInNoHouse';
  }
  if(s.expired)return 'expired';
  return s.account?'connected':'visitor';
}
/** Owner mode: only in the owner state at `now`, and only for the session's own address. */
export const ownerAddress=(s:AuthState,now:number)=>statusOf(s,now)==='owner'?s.session!.address:null;

export const hexUtf8=(text:string)=>'0x'+[...new TextEncoder().encode(text)].map(b=>b.toString(16).padStart(2,'0')).join('');
const isAddress=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v);
const firstAccount=(v:unknown)=>{const a=Array.isArray(v)?v[0]:null;return isAddress(a)?a.toLowerCase():null;};
const HINT='ember-world-session-hint';
/** A view hint only (address + expiry, no token): lets a returning browser say "expired" instead of "visitor". */
type HintStore={get():Session|null;set(s:Session|null):void};
export const localHint:HintStore={
  get(){try{const v=JSON.parse(localStorage.getItem(HINT)??'null');return v&&isAddress(v.address)&&typeof v.expiresAt==='number'?{address:v.address.toLowerCase(),expiresAt:v.expiresAt}:null;}catch{return null;}},
  set(s){try{if(s)localStorage.setItem(HINT,JSON.stringify(s));else localStorage.removeItem(HINT);}catch{/* private window */}}
};
type Channel={postMessage(v:unknown):void;close():void;addEventListener(type:'message',fn:()=>void):void};
/** Timers and the tab's visibility (cadence.ts PollEnv's shape). Default: setTimeout (unref'd under Node) and
 *  document visibilitychange (none without a document). */
export type AuthEnv=Pick<PollEnv,'set'|'clear'|'onVisible'>;
const defaultEnv:AuthEnv={set:(fn,ms)=>{const t=setTimeout(fn,ms) as unknown as {unref?:()=>void};t.unref?.();return t;},clear:t=>clearTimeout(t as ReturnType<typeof setTimeout>),
  onVisible:fn=>{if(typeof document==='undefined')return()=>{};const h=()=>{if(!document.hidden)fn();};document.addEventListener('visibilitychange',h);return()=>document.removeEventListener('visibilitychange',h);}};
/** setTimeout's longest delay (a longer one fires at once); the expiry timer re-arms in steps of at most this. */
const MAX_TIMER_MS=2**31-1;
export type AuthDeps={fetch:(path:string,init?:RequestInit)=>Promise<Response>;
  /** The wallet every call goes to (wallet.ts WalletRegistry.current: the EIP-6963 choice, or window.ethereum). */
  provider:()=>Provider|null;
  /** Subscribes to changes of `provider()` (a choice, a late announcement); returns the unsubscribe. */
  onProviderChange?:(fn:()=>void)=>()=>void;
  channel?:()=>Channel|null;hint?:HintStore;now?:()=>number;env?:AuthEnv;
  /** This page's origin, which the sign-in message must name (default location.origin; none: nothing is signed). */
  origin?:string};
const JSON_POST=(body:unknown):RequestInit=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),credentials:'same-origin'});
const code=async(r:Response)=>{try{const v=await r.clone().json();return typeof v?.error==='string'?v.error as string:null;}catch{return null;}};
/** Re-read /api/me/home no more often than this unless the click is the refresh button (20 per session per minute);
 *  owner mode re-checks this often while the tab is visible; a house older than OWNER_STALE_MS (every re-check since
 *  failed, e.g. 429) no longer grants owner mode (CORR-05, spec D07). */
export const HOME_MIN_GAP_MS=15_000,OWNER_RECHECK_MS=60_000,OWNER_STALE_MS=3*OWNER_RECHECK_MS;

export class AuthClient{
  private s:AuthState=INITIAL;private listeners=new Set<()=>void>();
  /** Bumped by every new click, account switch and sign-out: a response of an older generation is dropped. */
  private gen=0;private busy=false;private homeAt=0;private homeOkAt=0;private homeGen=0;private channel:Channel|null=null;private unsub:()=>void=()=>{};
  /** The provider whose accountsChanged this client follows, and a counter that drops a replaced provider's eth_accounts. */
  private bound:Provider|null=null;private binds=0;
  /** The load's session read: a click waits for it, so a reload with a live cookie never asks for a signature. */
  private restoring:Promise<void>|null=null;private deps:AuthDeps;
  /** W-1: the timer that ends the session here at its expiresAt, and when the last session read began. */
  private expiry:{session:Session;timer:unknown}|null=null;private sessionAt=-Infinity;
  constructor(deps:AuthDeps){this.deps=deps;}
  get state(){return this.s;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  private set(patch:Partial<AuthState>){const s={...this.s,...patch};if(s.phase!=='awaitingSignature')s.signing=null;this.s=s;this.arm();for(const fn of this.listeners)fn();}
  private get env(){return this.deps.env??defaultEnv;}
  /** Keeps one timer on the current session's expiresAt (W-1), so owner mode ends on time even with nothing else going on. */
  private arm(){
    const session=this.s.session;if(this.expiry?.session===session)return;
    if(this.expiry)this.env.clear(this.expiry.timer);this.expiry=null;if(!session)return;
    this.expiry={session,timer:this.env.set(()=>{if(this.expiry?.session!==session)return;this.expiry=null;if(!this.expireIfDue())this.arm();},
      Math.min(MAX_TIMER_MS,Math.max(0,session.expiresAt-this.now())))};
  }
  /** A session whose expiresAt has passed on this clock is over here now: owner mode off, 'expired' shown, the hint kept
   *  (it says expired on the next visit too) and any in-flight house read dropped. The server refuses it anyway. */
  private expireIfDue(){
    if(!this.s.session||this.s.session.expiresAt>this.now())return false;
    this.homeGen++;this.set({session:null,home:null,expired:true,checking:false});return true;
  }
  /** The tab is visible again (W-1): a session that ran out while hidden ends at once, and a page that had a session
   *  re-reads it (and so its house) from the server, at most once per HOME_MIN_GAP_MS; visitors ask nothing. */
  visible(){
    const had=!!this.s.session;this.expireIfDue();
    if(had&&this.now()-this.sessionAt>=HOME_MIN_GAP_MS&&this.s.phase==='idle'&&!this.busy)void this.restore();
  }
  private get hint(){return this.deps.hint??localHint;}
  private now(){return (this.deps.now??Date.now)();}
  private broadcast(kind:'signed-in'|'signed-out'){try{this.channel?.postMessage(kind);}catch{/* closed */}}

  /** Page load: the session from the cookie (no signature, ever), the wallet's already-granted account (no prompt), the
   *  account switches, and the other tabs. Returns the teardown. */
  start(){
    try{this.channel=this.deps.channel?.()??null;}catch{this.channel=null;}
    this.channel?.addEventListener('message',()=>{void this.restore();});      // re-read the server; never trust the message
    this.bind(this.deps.provider());
    const off=this.deps.onProviderChange?.(()=>this.providerChanged())??(()=>{});
    const offVisible=this.env.onVisible(()=>this.visible());
    void this.restore();
    return ()=>{off();offVisible();this.unsub();this.unsub=()=>{};this.bound=null;this.binds++;this.channel?.close();this.channel=null;
      if(this.expiry)this.env.clear(this.expiry.timer);this.expiry=null;};
  }
  /** Follows `p`: its already-granted account (eth_accounts, never a prompt) and its accountsChanged. chainChanged is not
   *  followed: the SIWE message is always chainId 1 and personal_sign does not depend on the wallet's chain. */
  private bind(p:Provider|null){
    this.unsub();this.unsub=()=>{};this.bound=p;const b=++this.binds;if(!p)return;
    void p.request({method:'eth_accounts'}).then(v=>{const a=firstAccount(v);if(b===this.binds&&a&&!this.s.account)this.set({account:a});}).catch(()=>{});
    if(p.on){const h=(v:unknown)=>{if(b===this.binds)this.accountChanged(firstAccount(v));};p.on('accountsChanged',h);this.unsub=()=>p.removeListener?.('accountsChanged',h);}
  }
  /** Another wallet is in use (the player's EIP-6963 choice, or one that announced late). A flow started with the old one
   *  is dropped here and its open challenges ended at the server, the old wallet's account is forgotten, and the new one's
   *  granted account (if any) is read without a prompt: an address other than the session's shows as a mismatch, so owner
   *  mode ends until that address signs in. */
  providerChanged(){
    const p=this.deps.provider();if(p===this.bound)return;
    const flow=this.s.phase!=='idle';
    if(flow||this.busy){this.gen++;this.busy=false;}
    this.set({account:null,phase:'idle',...flow?{notice:null}:{}});
    if(flow)void this.logoutRequest().then(ok=>{if(!ok)void this.restore();});
    this.bind(p);
  }
  /** GET /api/auth/session; a signed-in answer is followed by the home read. */
  restore(){const r=this.readSession().finally(()=>{if(this.restoring===r)this.restoring=null;});this.restoring=r;return r;}
  private async readSession(){
    const g=this.gen;this.sessionAt=this.now();
    try{
      const r=await this.deps.fetch('/api/auth/session',{credentials:'same-origin'});if(g!==this.gen)return;
      if(!r.ok){this.set({restored:true,sessionKnown:false,notice:r.status===503?'auth-unavailable':r.status===429?'rate-limited':this.s.notice});return;}
      const v=await r.json() as {signedIn:boolean;address?:string;expiresAt?:number};if(g!==this.gen)return;
      if(v.signedIn&&isAddress(v.address)&&typeof v.expiresAt==='number'){
        const session={address:v.address.toLowerCase(),expiresAt:v.expiresAt},same=this.s.session?.address===session.address;
        this.hint.set(session);this.set({session,expired:false,restored:true,sessionKnown:true,home:same?this.s.home:null});
        await this.refreshHome(!same,!same);return;                                    // a page load is a refresh too (spec B08)
      }
      // Expired only when this browser's own last session ran out; one revoked elsewhere (another tab's sign-out) is not.
      const hint=this.hint.get(),expired=this.s.expired||!!hint&&hint.expiresAt<=this.now();if(hint&&!expired)this.hint.set(null);
      this.set({session:null,home:null,restored:true,sessionKnown:true,expired});
    }catch{if(g===this.gen)this.set({restored:true,sessionKnown:false});}
  }
  /** GET /api/me/home for the session. force skips the 15 s gap (the refresh button, a new session); fresh (the refresh
   *  button) also has the server re-ask the NFT index if its answer is older than 30 s. Only the latest read is kept:
   *  one overtaken by a newer read (homeGen) or a new flow (gen) is dropped after every await, the body's too (A-3: an
   *  older answer whose body came last restored owner mode after a newer one had ended it). */
  async refreshHome(force=false,fresh=false){
    if(!this.s.session)return;
    if(!force&&this.now()-this.homeAt<HOME_MIN_GAP_MS&&this.s.home)return;
    const g=this.gen,hg=++this.homeGen;this.homeAt=this.now();this.set({checking:true});
    const stale=()=>g!==this.gen||hg!==this.homeGen;
    try{
      const r=await this.deps.fetch(fresh?'/api/me/home?fresh=1':'/api/me/home',{credentials:'same-origin'});
      if(stale())return;
      if(r.ok){const home=await r.json() as MeHome;if(stale())return;
        if(this.s.session&&home.address.toLowerCase()!==this.s.session.address){await this.restore();return;}  // another tab switched the cookie
        this.homeOkAt=this.now();this.set({home,checking:false});return;}
      const c=await code(r);if(stale())return;
      if(r.status===401){this.hint.set(null);this.set({session:null,home:null,expired:c==='SESSION_EXPIRED'||!!this.s.session,checking:false});return;}
      if(r.status===503)this.set({home:'unavailable',checking:false});
      else{const h=this.s.home,kept=h&&h!=='unavailable'&&this.now()-this.homeOkAt<=OWNER_STALE_MS?h:'unavailable';   // CORR-05
        this.set({checking:false,notice:r.status===429?'rate-limited':'failed',home:kept});}
    }catch{if(!stale())this.set({home:'unavailable',checking:false});}
  }
  /** The one sign-in click. One flow at a time (a second click while one runs does nothing); the wallet is asked to
   *  connect only if no account is known, and to sign only when the server has said no valid session for that account
   *  exists: after a failed session read the click reads it again first, and signs nothing while it stays unknown
   *  (CORR-02). A rejected signature ends the flow as `connected` with a notice: nothing is retried by itself. */
  async signIn(){
    if(this.busy)return;
    const p=this.deps.provider();if(!p){this.set({notice:'no-wallet'});return;}
    this.busy=true;
    if(this.restoring)await this.restoring;
    if(!this.s.sessionKnown)await this.restore();
    const g=++this.gen;
    if(this.deps.provider()!==p){this.busy=false;return;}                               // the wallet changed while waiting
    if(!this.s.sessionKnown){const n=this.s.notice;this.busy=false;this.set({notice:n==='rate-limited'||n==='auth-unavailable'?n:'session-unknown'});return;}
    this.set({notice:null});
    try{
      let account=this.s.account;
      if(!account){
        try{account=firstAccount(await p.request({method:'eth_requestAccounts'}));}catch{if(g===this.gen)this.set({notice:'connect-rejected'});return;}
        if(g!==this.gen)return;if(!account){this.set({notice:'connect-rejected'});return;}
        this.set({account});
      }
      if(this.s.session?.address===account){await this.refreshHome(true);return;}      // signed in already: no signature
      if(this.s.session&&!await this.logoutRequest()){                                 // another address's session ends first
        if(g===this.gen)this.set({notice:'signout-failed'});return;}
      if(g!==this.gen)return;
      this.set({session:null,home:null,phase:'awaitingSignature',signing:null});
      const c=await this.deps.fetch('/api/auth/challenge',JSON_POST({address:account}));
      if(g!==this.gen)return;
      if(!c.ok){this.set({phase:'idle',notice:failure(c.status,await code(c))});return;}
      const {nonce,message}=await c.json() as {nonce:string;message:string};
      // F-7a: the wallet sees only this site's own sign-in message for this account, now; anything else ends the flow here.
      const origin=this.deps.origin??globalThis.location?.origin??'';
      const signing=typeof message==='string'&&typeof nonce==='string'&&checkSignInMessage(message,{origin,account,nonce,now:this.now()})?signInSummary(message):null;
      if(!signing){this.set({phase:'idle',notice:'message-mismatch'});return;}
      this.set({signing});                                                             // the panel's summary while the wallet is open
      let signature:string;
      try{signature=await p.request({method:'personal_sign',params:[hexUtf8(message),account]}) as string;}
      catch{if(g===this.gen)this.set({phase:'idle',notice:'sign-rejected'});return;}
      if(g!==this.gen)return;                                                          // switched while the wallet was open: never verify
      this.set({phase:'verifying'});
      const v=await this.deps.fetch('/api/auth/verify',JSON_POST({nonce,signature}));
      if(g!==this.gen){if(v.ok)this.revokeAbandoned();return;}                          // a late success of an abandoned flow is revoked
      if(!v.ok){this.set({phase:'idle',notice:failure(v.status,await code(v))});return;}
      const s=await v.json() as {address:string;expiresAt:number},session={address:String(s.address).toLowerCase(),expiresAt:s.expiresAt};
      if(g!==this.gen){this.revokeAbandoned();return;}
      if(session.address!==account){this.revokeAbandoned();this.set({phase:'idle',notice:'failed'});return;}   // only the address that asked
      this.gen++;this.busy=false;                                                      // a session read begun before this is stale now
      this.hint.set(session);this.set({phase:'idle',session,home:null,expired:false,sessionKnown:true});this.broadcast('signed-in');
      await this.refreshHome(true);
    }catch{if(g===this.gen)this.set({phase:'idle',notice:'failed'});}
    finally{if(g===this.gen)this.busy=false;}
  }
  /** Sign out: the server revokes the session and the flow's open challenges, and only then is this page signed out.
   *  A logout that did not reach the server (network, 5xx) leaves the page signed in with a notice, because the cookie
   *  and the server session are both still there and a reload would show them (SEC-1 / CORR-01). `everywhere` ends every
   *  session of the address (F-4); other tabs hear it on the channel, other devices on their next session read. */
  async signOut(everywhere=false){
    if(this.s.leaving)return;
    this.gen++;this.busy=false;const g=this.gen;
    this.set({phase:'idle',notice:null,leaving:true});
    const ok=everywhere?await this.logoutAllRequest():await this.logoutRequest();
    if(g!==this.gen){this.set({leaving:false});return;}                                // switched meanwhile: that path decides
    if(!ok){this.set({leaving:false,notice:'signout-failed'});return;}
    // R-1: a 401 means this browser's own sign-in had already ended, so the server could not act for the address and
    // other devices are still signed in; this page is signed out, and says so instead of looking like a success.
    this.hint.set(null);this.set({session:null,home:null,expired:false,checking:false,leaving:false,sessionKnown:true,notice:ok==='stale'?'signout-all-stale':null});
    this.broadcast('signed-out');
  }
  /** The wallet switched account (A → B): owner mode off at once, A's in-flight flow dropped here and at the server, A's
   *  session ended; B starts as merely connected. If that logout does not reach the server, the session is read again,
   *  so the page shows A's still-valid session as a mismatch (never as signed out). A locked wallet (no account) leaves a
   *  valid session alone. */
  accountChanged(a:string|null){
    if(a===this.s.account)return;
    if(!a){this.set({account:null});return;}
    const wasFlow=this.s.phase!=='idle',other=!!this.s.session&&this.s.session.address!==a;
    if(!wasFlow&&!other){this.set({account:a});return;}
    this.gen++;this.busy=false;
    this.set({account:a,phase:'idle',...other?{session:null,home:null}:{},notice:null,checking:false});
    if(other||wasFlow){this.hint.set(null);void this.logoutRequest().then(ok=>{if(!ok)void this.restore();else if(other)this.broadcast('signed-out');});}
  }
  /** A verify that succeeded for a flow this page abandoned: its cookie arrived after the switch, so it is logged out
   *  here; if that fails the session is read again and shows as what it is. */
  private revokeAbandoned(){void this.logoutRequest().then(ok=>{if(!ok)void this.restore();});}
  /** POST /api/auth/logout-all (every session of the session's address, on every device): true when the server revoked
   *  them (200); 'stale' when there was no live session to act for (401: this browser's cookie is dead and cleared
   *  already, so nobody else was signed out); false when it did not reach the server. */
  private async logoutAllRequest():Promise<boolean|'stale'>{try{const r=await this.deps.fetch('/api/auth/logout-all',JSON_POST({}));return r.ok||(r.status===401&&'stale');}catch{return false;}}
  /** POST /api/auth/logout; true only when the server answered 2xx (the session is revoked and the cookies cleared). */
  private async logoutRequest(){try{return (await this.deps.fetch('/api/auth/logout',JSON_POST({}))).ok;}catch{return false;}}
}
/** A refused signature burns its challenge at the server (S1), so every notice here ends the flow; the next click asks
 *  for a new challenge and a new signature, and nothing is retried by itself. */
const failure=(status:number,c:string|null):Notice=>c==='CHAIN_BUSY'||c==='SIGN_IN_BUSY'?'busy':status===429?'rate-limited':
  c==='SIGNATURE_INVALID'?'signature-invalid':c==='VERIFY_UNAVAILABLE'?'verify-unavailable':
  c==='UNSUPPORTED_SIGNATURE'?'unsupported-wallet':status===503?'auth-unavailable':status===409||status===410||status===403?'challenge-lost':'failed';

/** The owner re-check (INT-1): every OWNER_RECHECK_MS while the tab is visible. One that comes due while the tab is
 *  hidden waits and runs once when the tab is visible again (cadence.ts startPoll does the same for the world's reads).
 *  Returns the stop. */
export function watchOwner(client:Pick<AuthClient,'refreshHome'>,env:PollEnv):()=>void{
  let timer:unknown=null,due=false,stopped=false;
  const schedule=()=>{timer=env.set(()=>{if(stopped)return;if(env.hidden())due=true;else void client.refreshHome();schedule();},OWNER_RECHECK_MS);};
  const unlisten=env.onVisible(()=>{if(due&&!stopped){due=false;void client.refreshHome();}});
  schedule();
  return ()=>{stopped=true;env.clear(timer);unlisten();};
}

type Say=(zh:string,en:string)=>string;
const short=(a:string)=>a.slice(0,6)+'…'+a.slice(-4);
/** Spec 7.1 wording: the panel's status line (and the chip's tooltip). */
export function statusText(st:AuthStatus,s:AuthState,say:Say):string{
  switch(st){
    case 'visitor':return say('連接錢包並入住','Connect wallet');
    case 'connected':return say('簽名驗證入住','Sign in to move in');
    case 'awaitingSignature':return say('請在錢包確認登入訊息','Confirm the sign-in message in your wallet');
    case 'verifying':return say('正在確認身分與 IMD 持有資格','Checking identity and IMD seats');
    case 'owner':{const n=(s.home as MeHome).eligible;return say(`我的家 · ${n} 位 agent`,`My home · ${n} agent${n===1?'':'s'}`);}
    case 'signedInNoHouse':return say('已登入，目前沒有符合資格的席位','Signed in, no eligible seat right now');
    case 'expired':return say('登入已到期，重新驗證後即可回家','Session expired, sign in again to go home');
    case 'ownershipUnavailable':return say('暫時無法確認持有資格，請稍後重試','Can’t confirm seats right now, try again later');
    case 'mismatch':return say(`錢包已切換到 ${short(s.account!)}；請重新簽名或登出`,`Wallet switched to ${short(s.account!)}; sign in again or log out`);
  }
}
/** The chip's own short label (the bottom bar must not grow into the zoom tools or the hint). */
export function chipText(st:AuthStatus,s:AuthState,say:Say):string{
  switch(st){
    case 'visitor':return say('連接錢包','Connect wallet');
    case 'connected':return say('簽名入住','Sign in');
    case 'awaitingSignature':return say('請在錢包確認','Confirm in wallet');
    case 'verifying':return say('確認中…','Checking…');
    case 'owner':return say(`我的家 · ${(s.home as MeHome).eligible}`,`My home · ${(s.home as MeHome).eligible}`);
    case 'signedInNoHouse':return short(s.session!.address);
    case 'expired':return say('登入已到期','Session expired');
    case 'ownershipUnavailable':return say('暫時無法確認','Can’t check');
    case 'mismatch':return say('錢包已切換','Wallet switched');
  }
}
export function noticeText(n:Notice,say:Say):string{
  switch(n){
    case 'message-mismatch':return say('伺服器傳來的登入訊息與本站預期的不符（網域、帳戶、時間或內容不對），所以沒有請錢包簽名。請重新整理後再試；若一再出現，請不要在任何地方簽這則訊息。','The sign-in message from the server isn’t the one this site expects (wrong site, account, time or wording), so your wallet was not asked to sign. Reload and try again; if it keeps happening, don’t sign it anywhere.');
    case 'no-wallet':return say('這個瀏覽器沒有偵測到錢包擴充功能。','No wallet extension found in this browser.');
    case 'connect-rejected':return say('錢包沒有同意連接。','The wallet did not approve the connection.');
    case 'sign-rejected':return say('尚未完成登入驗證，暫不能以屋主身分入住。','Sign-in was not completed, so you can’t move in as the owner yet.');
    case 'rate-limited':return say('嘗試次數太多，請一分鐘後再試。','Too many attempts. Try again in a minute.');
    case 'busy':return say('登入服務此刻太忙（許多人同時登入，或智慧錢包驗證已達上限），請一分鐘後再試。','Sign-in is busy right now (many sign-ins at once, or smart-wallet checks are at their limit). Try again in a minute.');
    case 'auth-unavailable':return say('登入服務暫時無法使用，請稍後再試。','Sign-in is unavailable right now. Try again later.');
    case 'verify-unavailable':return say('暫時無法驗證這種錢包的簽名，請稍後再試。','This wallet’s signature can’t be checked right now. Try again later.');
    case 'challenge-lost':return say('這次登入訊息已失效，請再按一次登入。','This sign-in message is no longer valid. Press sign in again.');
    case 'signature-invalid':return say('簽名與這則登入訊息不符，訊息已作廢；再按一次登入會取得新的訊息。','The signature didn’t match this sign-in message, so that message was discarded. Press sign in again to get a new one.');
    case 'failed':return say('登入沒有完成，請再試一次。','Sign-in did not complete. Try again.');
    case 'unsupported-wallet':return say('這種智慧合約錢包（尚未部署到主網）目前不支援登入，請改用一般錢包帳戶。','This smart-account wallet isn’t supported for sign-in yet (it isn’t deployed on mainnet). Use a regular wallet account.');
    case 'session-unknown':return say('暫時無法確認你是否已登入，所以沒有要求簽名；請稍後再按一次。','Couldn’t check whether you’re already signed in, so no signature was requested. Try again in a moment.');
    case 'signout-all-stale':return say('這個瀏覽器的登入早已結束，所以沒有登出其他裝置。請重新簽名登入，再按「登出所有裝置」。','This browser’s sign-in had already ended, so other devices were not signed out. Sign in again, then use Log out all devices.');
    case 'signout-failed':return say('登出沒有送達伺服器，你仍是登入狀態；請再按一次「登出此裝置」（或「登出所有裝置」）。','Log-out didn’t reach the server, so you’re still signed in. Press Log out this device (or Log out all devices) again.');
  }
}
