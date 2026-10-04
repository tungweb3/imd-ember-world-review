// Wallet sign-in on the client (W1, docs/wallet-login/DESIGN_W1_v001.md §9). The server is the only truth: the session is
// an HttpOnly cookie this code never sees, owner rights come from GET /api/me/home, and the SIWE text is built by the
// server; the client checks it line for line (siwe.ts) and only then personal_signs it (hex UTF-8; the one signature the client ever asks for). No crypto here and no viem in the bundle.
// Everything a test needs is injected (fetch, the EIP-1193 provider, the tab channel, the clock), so tests/wallet-client
// drive this class against the real Worker handler.
import type {HouseSize} from './houseSize.ts';
import type {PollEnv} from './cadence.ts';
import {checkSignInMessage,signInSummary,type SignInSummary} from './siwe.ts';
import {endedText} from './walletView.ts';                                          // walletView imports only types from here: no cycle
import {AuthLifecycle,type ClickOwner,type CleanupOwner} from './authLifecycle.ts';

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
/** Why the last click did not end signed in, or signed out (shown once, never retried by itself); 'logout-slow' when a
 *  click's wait for this page's own logout (ADV-3, AuthState.waiting) ran out. */
export type Notice='message-mismatch'|'no-wallet'|'connect-rejected'|'sign-rejected'|'rate-limited'|'busy'|'auth-unavailable'|'verify-unavailable'|'challenge-lost'|
  'signature-invalid'|'failed'|'unsupported-wallet'|'session-unknown'|'signout-failed'|'signout-all-stale'|'signout-all-context-changed'|'logout-slow';
/** Why the page's last session ended (N-7): 'expired' it ran out (a SESSION_EXPIRED, or its expiresAt reached on this
 *  clock); 'revoked' the server no longer knows it (AUTH_REQUIRED, or a session read says signed out: a logout-all or a
 *  logout elsewhere, a cookie the server dropped; which one, the page cannot tell); 'signed-out' this page's own sign-out. */
export type SessionEnd='expired'|'revoked'|'signed-out';
export type AuthState={
  /** The wallet account this page is connected to (lowercase), from eth_accounts / eth_requestAccounts. */
  account:string|null;
  /** The server session (lowercase address) as GET /api/auth/session last said, or a verify just returned. */
  session:Session|null;
  /** The in-flight click: waiting for the wallet's signature, or for the server's verify. */
  phase:'idle'|'awaitingSignature'|'verifying';
  /** /api/me/home for the session: null not read yet; 'unavailable' a 503 (never "owns nothing"). */
  home:MeHome|'unavailable'|null;
  /** The session ran out: a 401 SESSION_EXPIRED or a session read saying so, the held session's expiresAt reached on this
   *  clock, or the hint of this browser's last session past its expiry. A revoked session is not expired (N-7). */
  expired:boolean;
  /** Why the last session ended (N-7, SessionEnd); null while signed in, on a fresh page and once a sign-in begins. */
  ended:SessionEnd|null;
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
  /** ADV-3: a sign-in click waits for this page's own logout (or an abandoned flow's verify) before it asks the wallet
   *  anything; My wallet says so in place of the notice, and its sign button is off. A field of its own, so a session or
   *  house read that fails meanwhile (its notice) cannot take it down (the review of 066d109, RC-2); it ends with the
   *  wait: the click going on or running out, and every switch, sign-out or teardown that ends the click. */
  waiting:boolean;
};
export const INITIAL:AuthState={account:null,session:null,phase:'idle',home:null,expired:false,ended:null,restored:false,sessionKnown:false,leaving:false,signing:null,checking:false,notice:null,waiting:false};

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
const isRecord=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const isExpiry=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
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
/** The session a verify's 2xx body names (lowercase address and expiresAt), or undefined if it names none. */
const sessionIn=async(r:Response):Promise<Session|undefined>=>{try{const v=await r.json() as {address?:unknown;expiresAt?:unknown};
  return isAddress(v?.address)&&isExpiry(v.expiresAt)?{address:v.address.toLowerCase(),expiresAt:v.expiresAt}:undefined;}catch{return undefined;}};
type CleanupContext={expectedNonce?:string;expectedAddress?:string};
/** Re-read /api/me/home no more often than this unless the click is the refresh button (20 per session per minute);
 *  owner mode re-checks this often while the tab is visible; a house older than OWNER_STALE_MS (every re-check since
 *  failed, e.g. 429) no longer grants owner mode (CORR-05, spec D07). */
export const HOME_MIN_GAP_MS=15_000,OWNER_RECHECK_MS=60_000,OWNER_STALE_MS=3*OWNER_RECHECK_MS;
/** ADV-3: how long a sign-in click waits for this page's logouts still on their way before it ends, asking nothing. */
export const LOGOUT_WAIT_MS=5_000;

export class AuthClient{
  private s:AuthState=INITIAL;private listeners=new Set<()=>void>();
  /** Bumped by every new click, account switch and sign-out: a response of an older generation is dropped. */
  private gen=0;private lifecycle=new AuthLifecycle();private homeAt=0;private homeOkAt=0;private homeGen=0;private channel:Channel|null=null;private unsub:()=>void=()=>{};
  /** The provider whose accountsChanged this client follows, and a counter that drops a replaced provider's eth_accounts.
   *  R3-R1: accountEvents counts every accountsChanged it heard (a repeat and a lock too): a wallet answer about accounts
   *  that was awaited while one arrived is older than it, so it is applied only if it names the account the latest set. */
  private bound:Provider|null=null;private binds=0;private accountEvents=0;
  /** The newest session read: a click waits until none is running, so a reload with a live cookie never asks for a signature. */
  private restoring:Promise<void>|null=null;private deps:AuthDeps;
  /** N-1: numbers every session read; only the newest one's answer, failure or body is applied (one overtaken by a newer
   *  read, or by a new flow: gen, is dropped after every await, as house reads are by homeGen, A-3). A read that applies
   *  "signed out" or another session drops the replaced session's house read (homeGen), as expireIfDue does. */
  private sessionReads=0;
  /** W-1: the timer that ends the session here at its expiresAt, and when the last session read began. */
  private expiry:{session:Session;timer:unknown}|null=null;private sessionAt=-Infinity;
  /** ADV-3: this page's requests whose answer still writes the session cookie when it lands: every logout (a switch's,
   *  an abandoned flow's, a sign-out's, a click's own; its Max-Age=0 deletes whatever cookie the browser holds by then),
   *  and a verify until its flow has kept its session or logged it out. Each entry settles after its own handler ran. */
  private unsettled=new Set<Promise<unknown>>();
  /** UI lifetime never owns verify cleanup; AuthLifecycle's per-operation owner survives cancellation. */
  private life=0;
  constructor(deps:AuthDeps){this.deps=deps;}
  get state(){return this.s;}
  get lifecycleSnapshot(){return this.lifecycle.snapshot;}
  private get busy(){return this.lifecycle.busy;}
  private sessionUnknown(){return this.lifecycle.knowledge.kind==='UNKNOWN';}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  private set(patch:Partial<AuthState>){const s={...this.s,...patch};if(s.phase!=='awaitingSignature')s.signing=null;
    if(patch.sessionKnown!==undefined)this.lifecycle.know(!s.sessionKnown?{kind:'UNKNOWN'}:s.session?{kind:'PRESENT',session:s.session}:{kind:'ABSENT'});
    this.s=s;this.arm();for(const fn of this.listeners)fn();}
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
    this.homeGen++;this.set({session:null,home:null,expired:true,ended:'expired',checking:false,sessionKnown:false});return true;
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
  /** Keeps `p` in `unsettled` until it settles (ADV-3); returns `p`. */
  private hold<T>(p:Promise<T>){const q=p.then(()=>{},()=>{});this.unsettled.add(q);void q.then(()=>{this.unsettled.delete(q);});return p;}
  /** A logout this page does not wait for, `then` run on its answer (both held in `unsettled`, ADV-3). */
  private sendLogout(then:(ok:boolean)=>void,context?:CleanupContext){this.hold(this.logoutRequest(context).then(then));}
  /** Cleanup can settle after a read of a replacement session. A tuple is not a session identity: drop owner evidence
   *  and reconcile the actual cookie, without claiming absence or asking for another signature. */
  private reconcileCleanup(){this.homeGen++;this.set({home:null,checking:false,sessionKnown:false});void this.restore();}
  /** Automatic cancellation may only end the original flow or the displayed authenticated account. Without either
   *  assertion it sends nothing; only explicit signOut intentionally acts on the current shared cookie. */
  private automaticCleanup(g:number,life:number,click:ClickOwner|null,held?:Session,broadcast=false){
    if(click?.owner){this.revokeAbandoned(click.owner);return;}
    const context=click?.nonce?{expectedNonce:click.nonce}:held?{expectedAddress:held.address}:null;
    if(!context)return;
    this.sendLogout(ok=>{
      if(life!==this.life)return;
      // A wallet choice can supersede a waiting click without starting another sign-in. Read the actual shared
      // cookie after this cleanup settles; matching addresses/expiry alone cannot identify a newer session.
      if(g!==this.gen){if(!this.busy&&this.s.phase==='idle'){if(ok)this.reconcileCleanup();else void this.restore();}return;}
      if(!ok){void this.restore();return;}
      const current=this.s.session;
      // Even identical address/expiry can name another tab's newer session, whose cookie arrived after the cleanup
      // headers. Conversely delayed cookie-clear headers can remove a newer cookie. Only a fresh read distinguishes it.
      if(current)this.reconcileCleanup();else this.loggedOut(g,held);
      if(broadcast)this.broadcast('signed-out');
    },context);
  }
  /** N-1: no session read running; ADV-3: and, while `matters()`, nothing in `unsettled`. False when something there is
   *  still out after LOGOUT_WAIT_MS (a read is always waited for: it ends by itself). */
  private async quiet(matters:()=>boolean){
    let timer:unknown=null,late=false,wake=()=>{};const bound=new Promise<void>(r=>{wake=r;});
    try{for(;;){
      if(this.restoring){await this.restoring;continue;}
      if(!this.unsettled.size||!matters())return true;if(late)return false;
      timer??=this.env.set(()=>{late=true;wake();},LOGOUT_WAIT_MS);
      const seen=[...this.unsettled];                                                  // dropped once settled, so this loop never spins
      await Promise.race([Promise.all(seen).then(()=>{for(const q of seen)this.unsettled.delete(q);}),bound]);
    }}finally{if(timer!==null)this.env.clear(timer);}
  }

  /** Page load: the session from the cookie (no signature, ever), the wallet's already-granted account (no prompt), the
   *  account switches, and the other tabs. Returns the teardown, which first ends an in-flight sign-in (N-2: the page's
   *  own cancel, a click still waiting for a session read included; nothing prompts after it, and a client started again
   *  is not left in "Confirm in wallet"). */
  start(){
    const life=++this.life;
    this.lifecycle.start();
    try{this.channel=this.deps.channel?.()??null;}catch{this.channel=null;}
    this.channel?.addEventListener('message',()=>{if(life===this.life)void this.restore();}); // queued old callback is not new-life intent
    this.bind(this.deps.provider());
    const off=this.deps.onProviderChange?.(()=>{if(life===this.life)this.providerChanged();})??(()=>{});
    const offVisible=this.env.onVisible(()=>{if(life===this.life)this.visible();});
    void this.restore();
    return ()=>{if(life!==this.life)return;this.lifecycle.cancel(true);this.life++;this.gen++;
      // Security cleanup still runs after teardown; its old life/gen may never update this UI again.
      for(const owner of this.lifecycle.retainedOwners)this.revokeAbandoned(owner);
      if(this.s.phase!=='idle'||this.s.waiting||this.s.leaving||this.s.checking)this.set({phase:'idle',waiting:false,leaving:false,checking:false});
      off();offVisible();this.unsub();this.unsub=()=>{};this.bound=null;this.binds++;this.channel?.close();this.channel=null;
      if(this.expiry)this.env.clear(this.expiry.timer);this.expiry=null;};
  }
  /** Follows `p`: its already-granted account (eth_accounts, never a prompt) and its accountsChanged. chainChanged is not
   *  followed: the SIWE message is always chainId 1 and personal_sign does not depend on the wallet's chain. */
  private bind(p:Provider|null){
    this.unsub();this.unsub=()=>{};this.bound=p;const b=++this.binds;if(!p)return;
    const e=this.accountEvents;                                                        // R3-R1: an event while it was asked is newer than its answer
    void p.request({method:'eth_accounts'}).then(v=>{const a=firstAccount(v);if(b===this.binds&&e===this.accountEvents&&a&&!this.s.account){this.lifecycle.discovered(p,a);this.set({account:a});}}).catch(()=>{});
    if(p.on){const h=(v:unknown)=>{if(b===this.binds)this.accountChanged(firstAccount(v));};p.on('accountsChanged',h);this.unsub=()=>p.removeListener?.('accountsChanged',h);}
  }
  /** Another wallet is in use (the player's EIP-6963 choice, or one that announced late). A flow started with the old one
   *  is dropped here and its open challenges ended at the server, the old wallet's account is forgotten, and the new one's
   *  granted account (if any) is read without a prompt: an address other than the session's shows as a mismatch, so owner
   *  mode ends until that address signs in. */
  providerChanged(){
    const p=this.deps.provider();if(p===this.bound)return;
    const abandoned=this.lifecycle.click,activeFlow=this.s.phase!=='idle',flow=activeFlow||this.lifecycle.retainedOwners.length>0,held=this.s.session??undefined;
    if(flow||this.busy){this.gen++;this.lifecycle.cancel();}
    this.set({account:null,phase:'idle',waiting:false,...flow?{notice:null,sessionKnown:false}:{}});
    if(activeFlow)this.automaticCleanup(this.gen,this.life,abandoned,held);
    for(const owner of this.lifecycle.retainedOwners)this.revokeAbandoned(owner);
    this.bind(p);
  }
  /** GET /api/auth/session; a signed-in answer is followed by the home read. */
  restore(){const r=this.readSession().finally(()=>{if(this.restoring===r)this.restoring=null;});this.restoring=r;return r;}
  private async readSession(){
    const g=this.gen,life=this.life,q=++this.sessionReads,stale=()=>g!==this.gen||life!==this.life||q!==this.sessionReads||!this.lifecycle.mayRead(q,g,life);this.sessionAt=this.now();
    try{
      const r=await this.deps.fetch('/api/auth/session',{credentials:'same-origin'});if(stale())return;
      if(!r.ok){this.set({restored:true,sessionKnown:false,notice:r.status===503?'auth-unavailable':r.status===429?'rate-limited':this.s.notice});return;}
      const v:unknown=await r.json();if(stale())return;
      // R5-03: JSON success is not evidence of absence. Only the two valid tagged response variants are confirmed.
      if(!isRecord(v)||!(v.signedIn===false&&(v.expired===undefined||typeof v.expired==='boolean')||
        v.signedIn===true&&isAddress(v.address)&&isExpiry(v.expiresAt))){this.set({restored:true,sessionKnown:false});return;}
      if(v.signedIn===true&&isAddress(v.address)&&isExpiry(v.expiresAt)){
        const session={address:v.address.toLowerCase(),expiresAt:v.expiresAt},held=this.s.session,same=held?.address===session.address;
        this.lifecycle.read({kind:'PRESENT',session},q,g,life); // terminal release before house I/O
        const renew=!same||held!.expiresAt!==session.expiresAt;if(renew)this.homeGen++;       // another session: its predecessor's house read is dropped
        this.hint.set(session);this.set({session,expired:false,ended:null,restored:true,sessionKnown:true,home:same?this.s.home:null,...renew?{checking:false}:{}});
        await this.refreshHome(!same,!same);return;                                    // a page load is a refresh too (spec B08)
      }
      // Expired only when a session ran out: the server says so, or the held session's or this browser's hint's expiresAt
      // has passed here (N-7: read before the session is cleared); one revoked elsewhere (another tab's sign-out) is not.
      const held=this.s.session,now=this.now(),hint=this.hint.get();
      this.lifecycle.read({kind:'ABSENT'},q,g,life);
      const expired=this.s.expired||v.expired===true||!!held&&held.expiresAt<=now||!!hint&&hint.expiresAt<=now;if(hint&&!expired)this.hint.set(null);
      this.homeGen++;this.set({session:null,home:null,restored:true,sessionKnown:true,expired,ended:expired?'expired':held?'revoked':this.s.ended,checking:false});
    }catch{if(!stale())this.set({restored:true,sessionKnown:false});}
  }
  /** GET /api/me/home for the session. force skips the 15 s gap (the refresh button, a new session); fresh (the refresh
   *  button) also has the server re-ask the NFT index if its answer is older than 30 s. Only the latest read is kept:
   *  one overtaken by a newer read (homeGen) or a new flow (gen) is dropped after every await, the body's too (A-3: an
   *  older answer whose body came last restored owner mode after a newer one had ended it). */
  async refreshHome(force=false,fresh=false){
    const held=this.s.session;if(!held)return;
    if(!force&&this.now()-this.homeAt<HOME_MIN_GAP_MS&&this.s.home)return;
    const g=this.gen,hg=++this.homeGen;this.homeAt=this.now();this.set({checking:true});
    const stale=()=>g!==this.gen||hg!==this.homeGen;
    try{
      const r=await this.deps.fetch(fresh?'/api/me/home?fresh=1':'/api/me/home',{credentials:'same-origin'});
      if(stale())return;
      if(r.ok){const home=await r.json() as MeHome;if(stale())return;
        // Another tab switched the cookie. AUD3-05: an answer for another address is not "unreadable for now": the held
        // session's house and the check end here (unconfirmed, never owner mode), and only then is the session re-read.
        if(this.s.session&&home.address.toLowerCase()!==this.s.session.address){this.set({home:'unavailable',checking:false});await this.restore();return;}
        this.homeOkAt=this.now();this.set({home,checking:false});return;}
      const c=await code(r);if(stale())return;
      // N-7: expired only when the session ran out (SESSION_EXPIRED, or the held session's expiresAt reached here); any
      // other 401 (AUTH_REQUIRED: revoked, unknown) is a revocation, and a 401 with no session held says nothing (N-1).
      if(r.status===401){if(!this.s.session){this.set({checking:false});return;}
        const ran=c==='SESSION_EXPIRED'||held.expiresAt<=this.now();
        this.hint.set(null);this.set({session:null,home:null,expired:ran,ended:ran?'expired':'revoked',checking:false,sessionKnown:false});return;}
      if(r.status===503)this.set({home:'unavailable',checking:false});
      else{const h=this.s.home,kept=h&&h!=='unavailable'&&this.now()-this.homeOkAt<=OWNER_STALE_MS?h:'unavailable';   // CORR-05
        this.set({checking:false,notice:r.status===429?'rate-limited':'failed',home:kept});}
    }catch{if(!stale())this.set({home:'unavailable',checking:false});}
  }
  /** The one sign-in click. One flow at a time (a second click while one runs does nothing); the wallet is asked to
   *  connect only if no account is known, and to sign only when the server has said no valid session for that account
   *  exists: after a failed session read the click reads it again first, and signs nothing while it stays unknown
   *  (CORR-02). A rejected signature ends the flow as `connected` with a notice: nothing is retried by itself. After every
   *  await the flow writes state or opens a wallet prompt only while it is the live flow (gen), with the same wallet and
   *  the same account (N-2: a challenge body that arrives after a switch, a sign-out or the page's teardown asks nothing,
   *  and a click still waiting for a session read when one of them happens is ended by it too). R3-R1: the wallet's own
   *  answers are no newer than its events: a connect answered for another account than an accountsChanged that came
   *  meanwhile, or a lock while the prompt was open, ends the click with nothing set, asked or verified (never a prompt to
   *  recover: the next click starts from the account the wallet named last). ADV-3: no challenge is asked for while a
   *  logout this page sent, or an abandoned flow's verify, is still on its way (bounded: LOGOUT_WAIT_MS). */
  async signIn(){
    if(this.busy)return;
    const p=this.deps.provider();if(!p){this.set({notice:'no-wallet'});return;}
    const click=this.lifecycle.begin(p,this.s.account,this.gen,this.life)!;
    const live=()=>this.lifecycle.current(click,this.deps.provider(),this.s.account,this.gen,this.life);
    const asks=()=>!this.s.account||this.s.session?.address!==this.s.account;
    const out=()=>!!this.restoring||this.unsettled.size>0&&asks();
    const wait=async()=>{let ok=true;while(ok&&live()&&out()){
      if(this.unsettled.size>0&&asks()&&!this.s.waiting)this.set({waiting:true});ok=await this.quiet(asks);
    }return ok;};
    let decided=()=>{},owner:CleanupOwner|undefined;
    try{
      let quiet=await wait();
      if(quiet&&live()&&this.sessionUnknown()){await this.restore();quiet=await wait();}
      if(!live())return;
      if(this.s.waiting)this.set({waiting:false});
      if(!quiet){this.set({notice:'logout-slow'});return;}
      if(this.sessionUnknown()){
        const n=this.s.notice;this.set({notice:n==='rate-limited'||n==='auth-unavailable'?n:'session-unknown'});return;
      }
      const g=++this.gen,life=this.life;this.lifecycle.promote(click,g);this.set({notice:null});
      let account=click.account;
      if(!account){
        this.lifecycle.transition(click,'CONNECTING_WALLET');const seen=this.accountEvents;
        try{account=firstAccount(await p.request({method:'eth_requestAccounts'}));}
        catch{if(live())this.set({notice:'connect-rejected'});return;}
        if(!click.valid||this.lifecycle.click!==click||g!==this.gen||life!==this.life||this.deps.provider()!==p)return;
        if(!account){this.set({notice:'connect-rejected'});return;}
        if(seen!==this.accountEvents&&this.s.account!==account)return;
        if(!this.lifecycle.connected(click,account))return;this.set({account});
      }
      if(!live())return;
      if(this.s.session?.address===account){await this.refreshHome(true);return;}
      if(this.s.session){
        const held=this.s.session,ok=await this.hold(this.logoutRequest({expectedAddress:held.address}));
        if(life!==this.life)return;
        if(!ok){if(live()){this.set({sessionKnown:false,notice:'signout-failed'});await this.restore();}return;}
        this.loggedOut(g,held);this.broadcast('signed-out');
      }
      if(!live())return;
      this.homeGen++;this.set({session:null,home:null,ended:null,phase:'awaitingSignature',signing:null,checking:false});
      this.lifecycle.transition(click,'CHALLENGE_REQUESTED');
      const c=await this.deps.fetch('/api/auth/challenge',JSON_POST({address:account}));
      if(!live())return;
      if(!c.ok){const n=failure(c.status,await code(c));if(live())this.set({phase:'idle',notice:n});return;}
      const {nonce,message}=await c.json() as {nonce:string;message:string};
      if(!live())return;
      const origin=this.deps.origin??globalThis.location?.origin??'';
      const signing=typeof message==='string'&&typeof nonce==='string'&&checkSignInMessage(message,{origin,account,nonce,now:this.now()})?signInSummary(message):null;
      if(!signing){this.set({phase:'idle',notice:'message-mismatch'});return;}
      this.lifecycle.challenge(click,nonce);
      // A newer canonical read may have resolved this cookie while the challenge was awaited.
      if(this.sessionUnknown()){this.set({phase:'idle',notice:'session-unknown'});return;}
      if(this.s.session?.address===account){this.set({phase:'idle'});await this.refreshHome(true);return;}
      this.lifecycle.transition(click,'SIGNATURE_PROMPTING');this.set({signing});
      let signature:string;
      try{signature=await p.request({method:'personal_sign',params:[hexUtf8(message),account]}) as string;}
      catch{if(live())this.set({phase:'idle',notice:'sign-rejected'});return;}
      if(!live())return;
      this.set({phase:'verifying',sessionKnown:false});
      this.hold(new Promise<void>(r=>{decided=r;}));
      owner=this.lifecycle.verify(click,this.sessionReads);
      const v=await this.deps.fetch('/api/auth/verify',JSON_POST({nonce,signature}));
      this.lifecycle.observe(owner,this.sessionReads);
      if(!v.ok){
        this.lifecycle.release(owner);decided();const n=failure(v.status,await code(v));
        if(live()){await this.restore();if(live())this.set({phase:'idle',notice:n});}return;
      }
      if(!live()){void sessionIn(v);this.revokeAbandoned(owner);return;}
      if(owner.abandoned)this.revokeAbandoned(owner);
      const session=await sessionIn(v);
      if(!live()){this.revokeAbandoned(owner);return;}
      if(owner.status!=='RETAINED'){this.set({phase:'idle'});return;}
      if(!session){await this.reconcileVerify(click,owner);return;}
      if(session.address!==account){this.revokeAbandoned(owner);this.set({phase:'idle',notice:'failed'});return;}
      if(!this.lifecycle.accept(click,owner,session))return;
      this.lifecycle.finish(click);this.gen++; // prior session reads cannot overwrite this accepted body
      this.hint.set(session);this.set({phase:'idle',session,home:null,expired:false,ended:null,sessionKnown:true});
      this.broadcast('signed-in');decided();await this.refreshHome(true);
    }catch{
      if(owner){this.lifecycle.observe(owner,this.sessionReads);
        if(live())await this.reconcileVerify(click,owner);else this.revokeAbandoned(owner);
      }else if(live())this.set({phase:'idle',notice:'failed'});
    }finally{
      decided();if(this.lifecycle.click===click){if(this.s.phase!=='idle'||this.s.waiting)this.set({phase:'idle',waiting:false});this.lifecycle.finish(click);}
    }
  }
  /** Recovery is ordered after response/transport observation, not after dispatch. Release precedes house awaits. */
  private async reconcileVerify(click:ClickOwner,owner:CleanupOwner){
    const live=()=>this.lifecycle.current(click,this.deps.provider(),this.s.account,this.gen,this.life);
    if(owner.status!=='RETAINED'){if(live())this.set({phase:'idle'});return;}
    if(!live()){this.revokeAbandoned(owner);return;}
    this.lifecycle.transition(click,'VERIFY_RECONCILING');
    this.sessionReads++;this.homeGen++;this.set({sessionKnown:false,home:null,checking:false});
    await this.restore();
    if(!live()){this.revokeAbandoned(owner);return;} // terminal owners refuse this request
    this.set({phase:'idle',notice:this.s.sessionKnown?this.s.session?null:'failed':'session-unknown'});
    if(this.s.sessionKnown&&this.s.session)this.broadcast('signed-in');
  }
  /** Sign out: the server revokes the session and the flow's open challenges, and only then is this page signed out.
   *  A logout that did not reach the server (network, 5xx) leaves the page signed in with a notice, because the cookie
   *  and the server session are both still there and a reload would show them (SEC-1 / CORR-01). `everywhere` ends every
   *  session of the address (F-4); other tabs hear it on the channel, other devices on their next session read. A
   *  logout-all the server refused (401: this browser's sign-in had ended) is followed by one session read (AUD3-07). */
  async signOut(everywhere=false){
    if(this.s.leaving)return;
    const life=this.life;
    this.gen++;this.lifecycle.cancel();for(const owner of this.lifecycle.retainedOwners)this.revokeAbandoned(owner);const g=this.gen,held=this.s.session??undefined;
    this.set({phase:'idle',notice:null,leaving:true,waiting:false});
    const ok=await this.hold(everywhere?this.logoutAllRequest(held?.address):this.logoutRequest());
    if(life!==this.life)return;
    // Switched meanwhile: that path decides. But another wallet chosen while a click waited for this sign-out takes a
    // generation and clears nothing, so a confirmed sign-out still ends the very session it ended (says "Signed out.")
    // and tells the other tabs, as the click's own logout does (ADV-1, ADV-2; the re-check of 2f5d6c1). A logout-all the
    // server refused (401) says this browser's sign-in had ended, so the session is read afresh as below (the review of
    // 13449f2, CF-3: the page kept that session, owner mode included, until the owner re-check).
    if(g!==this.gen){if(ok===true){if(this.loggedOut(g,held))this.set({ended:'signed-out'});this.broadcast('signed-out');}else if(ok)void this.restore();this.set({leaving:false});return;}
    if(!ok){this.set({leaving:false,notice:'signout-failed'});return;}
    if(ok===true){this.loggedOut(g);                                                   // AUD3-04: revoked and cleared: no read begun before this answer is applied
      this.hint.set(null);this.set({session:null,home:null,expired:false,checking:false,leaving:false,sessionKnown:true,notice:null,ended:'signed-out'});
      this.broadcast('signed-out');return;}
    // R-1: a 401 means this browser's own sign-in had already ended, so the server could not act for the address and
    // other devices are still signed in; this page is signed out, and says so instead of looking like a success. AUD3-07:
    // expired when the server says it ran out (SESSION_EXPIRED); any other 401 names no cause. Nothing was revoked, and the
    // cookie the browser holds now may be one another tab of it has just set, so the session is read afresh (that read,
    // the newest, also supersedes every read begun before: N-1). The notice comes after it, so a failed read (429, 503)
    // cannot hide that other devices were not signed out, and leaves the session unknown: a click reads it first (CORR-02).
    const ran=ok==='expired';this.homeGen++;this.hint.set(null);
    this.set({session:null,home:null,expired:ran,ended:ran?'expired':null,checking:false,sessionKnown:false});
    await this.restore();if(life!==this.life)return;if(g!==this.gen){this.set({leaving:false});return;}
    this.set({leaving:false,notice:ok==='context-changed'?'signout-all-context-changed':'signout-all-stale'});
    if(ok!=='context-changed')this.broadcast('signed-out');
  }
  /** The wallet switched account (A → B): owner mode off at once, A's in-flight flow dropped here and at the server, A's
   *  session ended; B starts as merely connected. If that logout does not reach the server, the session is read again,
   *  so the page shows A's still-valid session as a mismatch (never as signed out). A locked wallet (no account) leaves a
   *  valid session alone. */
  accountChanged(a:string|null){
    this.accountEvents++;
    const click=this.lifecycle.click;
    if(a===this.s.account&&!(a===null&&click))return;
    // A wallet announcing the account of this click's explicit initial grant agrees with that grant.
    if(a&&click?.state==='CONNECTING_WALLET'&&click.accountAtClick===null&&click.account===null){this.set({account:a});return;}
    const wasFlow=!!click||this.lifecycle.retainedOwners.length>0;
    const other=!!a&&!!this.s.session&&this.s.session.address!==a;
    if(!wasFlow&&!other){this.set({account:a});return;}
    this.gen++;this.lifecycle.cancel();const g=this.gen,ended=other?this.s.session!:undefined;
    this.set({account:a,phase:'idle',...other?{session:null,home:null}:{},sessionKnown:false,notice:null,checking:false,waiting:false});
    if(other||wasFlow){if(other)this.hint.set(null);this.automaticCleanup(g,this.life,click,ended,other);}
    for(const owner of this.lifecycle.retainedOwners)this.revokeAbandoned(owner);
  }
  /** One operation owns conditional cleanup. Old closures can request it, never recreate or revive it. */
  private revokeAbandoned(owner:CleanupOwner){
    if(!this.lifecycle.abandon(owner)||!this.lifecycle.claimCleanup(owner))return;
    const g=owner.generation,life=owner.life;
    this.sendLogout(ok=>{
      const retry=this.lifecycle.cleanupDone(owner,ok);
      if(retry){this.revokeAbandoned(owner);return;}
      if(owner.status==='RETAINED'||life!==this.life)return;
      if(!ok){if(g===this.gen||!this.busy&&this.s.phase==='idle')void this.restore();return;}
      if(g===this.gen){if(this.s.session)this.reconcileCleanup();else this.loggedOut(g);}
      else if(!this.busy&&this.s.phase==='idle')this.reconcileCleanup();
    },{expectedNonce:owner.nonce});
  }
  /** AUD3-04: a logout this page sent was confirmed (2xx: revoked, cookie cleared). Unless a newer flow began since it was
   *  sent (g; that flow's own gen++ already dropped every older read, and later reads are the new session's), every
   *  session or house read begun before now answered for what it revoked, so none is applied, and a session a read showed
   *  meanwhile ends here too. ADV-1: `held`, the session that logout ended (the click's own, or an account switch's), ends
   *  here even after a newer flow began, as long as the page still holds that very session (address and expiresAt; a
   *  read may have shown it again before the logout reached the server); a newer one is left alone. Since the re-check
   *  of 2f5d6c1 a sign-out's and an abandoned flow's logout name theirs too. True when it applied (after a newer flow
   *  began: only when it ended the session it names). g null: no generation, only `held` (an abandoned flow's verify
   *  body that named its session after the logout was confirmed, RC-1).
   *  A logout that did not reach the server, or a refused logout-all, invalidates nothing. */
  private loggedOut(g:number|null,held?:Session){
    const s=this.s.session,same=!!held&&s?.address===held.address&&s.expiresAt===held.expiresAt;
    if(g!==this.gen&&!same)return false;this.sessionReads++;this.homeGen++;
    if(s){this.hint.set(null);this.set({session:null,home:null,checking:false});}return true;}
  /** POST /api/auth/logout-all (every session of the session's address, on every device): true when the server revoked
   *  them (200); 'expired' when this browser's session had run out (401 SESSION_EXPIRED, AUD3-07) and 'stale' for any
   *  other 401 (AUTH_REQUIRED, or a body nobody can read): there was no live session to act for, so nobody else was
   *  signed out, and the cookie is dead (the server refuses it); false when it did not reach the server. */
  private async logoutAllRequest(expectedAddress?:string):Promise<boolean|'stale'|'expired'|'context-changed'>{
    if(!expectedAddress)return 'context-changed';
    try{const r=await this.deps.fetch('/api/auth/logout-all',JSON_POST({expectedAddress}));
      if(r.ok)return true;
      if(r.status===409)return 'context-changed';                                      // unreadable conflict bodies still require reconciliation
      if(r.status!==401)return false;return await code(r)==='SESSION_EXPIRED'?'expired':'stale';}catch{return false;}}
  /** POST /api/auth/logout; true only when the server answered 2xx (the session is revoked and the cookies cleared). */
  private async logoutRequest(context?:CleanupContext){
    try{return (await this.deps.fetch('/api/auth/logout',JSON_POST(context??{}))).ok;}catch{return false;}}
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
    case 'expired':return endedText('expired',say);                                  // N-7: one source for the expiry sentence (walletView.ts)
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
    case 'signout-all-context-changed':return say('目前登入帳戶與你選擇的帳戶無法核對，所以沒有登出任何裝置。請確認目前帳戶後再操作。','The signed-in account did not match the logout request, so no devices were signed out. Check the current account before trying again.');
    case 'signout-failed':return say('登出沒有送達伺服器，你仍是登入狀態；請再按一次「登出此裝置」（或「登出所有裝置」）。','Log-out didn’t reach the server, so you’re still signed in. Press Log out this device (or Log out all devices) again.');
    case 'logout-slow':return say('這個頁面先前送出的登出（或已取消的登入）還沒有得到回應，所以沒有要求簽名；請稍後再按一次。','A log-out (or a cancelled sign-in) this page sent earlier hasn’t been answered yet, so no signature was requested. Try again in a moment.');
  }
}
/** My wallet's line while a click waits (AuthState.waiting, ADV-3), in place of the notice. */
export const waitingText=(say:Say)=>say('正在等這個頁面先前送出的登出（或已取消的登入）得到回應；在那之前不會向錢包要求任何東西。','Waiting for a log-out (or a cancelled sign-in) this page sent earlier to be answered; your wallet is asked nothing until then.');
