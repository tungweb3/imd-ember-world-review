// Read-only wallet link (EIP-1193). The game never sends transactions. The only signature it ever asks for is the SIWE
// sign-in (auth.ts); moving house needs that session and asks the wallet for nothing (moves.ts).
// Discovery (EIP-6963): wallets announce themselves on eip6963:announceProvider after an eip6963:requestProvider. An entry
// is one provider object; the player's pick is that object, and only a pick in "My wallet" changes it. The remembered
// choice (its rdns, per browser) is used on a later visit only when exactly one announced wallet has that rdns: a second
// provider claiming it, or the remembered wallet not announcing while another does, shows the chooser instead of
// guessing. With none announced, window.ethereum is used as before. Every wallet call goes to current().
import type {Provider} from './auth.ts';
export type {Provider};
export const isAddress=(v:string)=>/^0x[0-9a-fA-F]{40}$/.test(v.trim());
const KEY='ember-world-wallet',CHOICE='ember-world-wallet-choice';
/** The address this browser last used (connected or typed), lowercased; null if none. */
export function savedAddress():string|null{try{const v=localStorage.getItem(KEY);return v&&isAddress(v)?v.toLowerCase():null;}catch{return null;}}
export function saveAddress(a:string|null){try{if(a)localStorage.setItem(KEY,a.toLowerCase());else localStorage.removeItem(KEY);}catch{/* private window */}}

export type WalletInfo={uuid:string;name:string;rdns:string;icon:string|null};
export type WalletOption={info:WalletInfo;provider:Provider};
export type Wallets={options:readonly WalletOption[];
  /** The wallet in use: this page's pick, else the remembered choice if exactly one announced wallet has its rdns, else
   *  the only one announced when nothing is remembered. */
  chosen:WalletOption|null;
  /** Wallets announced and none in use: nothing is asked of any wallet until the player picks. */
  needsChoice:boolean;
  /** rdns values claimed by more than one provider (a copy, or a malicious extension): shown with a warning. */
  duplicates:readonly string[];
  /** Any wallet at all (announced, or window.ethereum). */
  any:boolean;
  /** No wallet announced itself and window.ethereum is the one in use: the page cannot tell which extension that is. */
  unidentified:boolean};
type Target={addEventListener(type:string,fn:(e:Event)=>void):void;removeEventListener(type:string,fn:(e:Event)=>void):void;dispatchEvent(e:Event):boolean;ethereum?:unknown};
type Store=Pick<Storage,'getItem'|'setItem'>;
const isProvider=(p:unknown):p is Provider=>!!p&&typeof (p as Provider).request==='function';
/** Icons are data: images only (EIP-6963 says data URI), shown through <img> (an SVG there runs no script); anything
 *  else, or one over 64 kB, shows no icon. */
const ICON=/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,]/;
/** An announcement's detail, checked and copied; null when it is not a usable EIP-6963 announcement. */
export function announced(detail:unknown):WalletOption|null{
  const d=detail as {info?:Record<string,unknown>;provider?:unknown}|null;
  const i=d?.info;if(!i||!isProvider(d.provider))return null;
  const {uuid,name,rdns,icon}=i;
  if(typeof uuid!=='string'||!uuid||typeof name!=='string'||!name.trim()||typeof rdns!=='string'||!/^[\w-]+(\.[\w-]+)+$/.test(rdns))return null;
  return {info:{uuid,name:name.trim().slice(0,40),rdns,icon:typeof icon==='string'&&icon.length<=65536&&ICON.test(icon)?icon:null},provider:d.provider};
}

export class WalletRegistry{
  private found=new Map<Provider,WalletOption>();private listeners=new Set<()=>void>();private choice:string|null;private picked:Provider|null=null;
  private snap:Wallets;private win:Target;private store:Store|null;
  constructor(win:Target,store:Store|null){
    this.win=win;this.store=store;
    try{this.choice=store?.getItem(CHOICE)??null;}catch{this.choice=null;}
    this.snap=this.compute();
  }
  /** Listens for announcements and asks every wallet to announce; returns the stop. */
  start(){
    const on=(e:Event)=>{const o=announced((e as CustomEvent).detail);if(!o)return;
      const same=this.found.get(o.provider);if(same&&same.info.uuid===o.info.uuid&&same.info.rdns===o.info.rdns&&same.info.name===o.info.name&&same.info.icon===o.info.icon)return;
      this.found.set(o.provider,o);this.changed();};                                  // one entry per provider; a second provider never replaces another
    this.win.addEventListener('eip6963:announceProvider',on);
    try{this.win.dispatchEvent(new Event('eip6963:requestProvider'));}catch{/* no events */}
    return ()=>this.win.removeEventListener('eip6963:announceProvider',on);
  }
  get state(){return this.snap;}
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  /** The provider every wallet call uses now; null when none exists or the player has yet to pick. */
  current():Provider|null{
    const s=this.snap;
    if(s.chosen)return s.chosen.provider;
    if(s.options.length)return null;
    return isProvider(this.win.ethereum)?this.win.ethereum:null;
  }
  /** The player's pick (an announced entry); its rdns is remembered in this browser. */
  choose(o:WalletOption|null|undefined){
    const e=o&&this.found.get(o.provider);if(!e||this.picked===e.provider&&this.snap.chosen?.provider===e.provider)return;
    this.picked=e.provider;this.choice=e.info.rdns;try{this.store?.setItem(CHOICE,e.info.rdns);}catch{/* private window */}
    this.changed();
  }
  private compute():Wallets{
    const options=[...this.found.values()],count=new Map<string,number>();
    for(const o of options)count.set(o.info.rdns,(count.get(o.info.rdns)??0)+1);
    const named=this.choice?options.filter(o=>o.info.rdns===this.choice):[];
    const chosen=(this.picked&&this.found.get(this.picked))||(this.choice?named.length===1?named[0]:null:options.length===1?options[0]:null);
    return {options,chosen,needsChoice:options.length>0&&!chosen,duplicates:[...count].filter(([,n])=>n>1).map(([r])=>r),any:options.length>0||isProvider(this.win.ethereum),
      unidentified:options.length===0&&isProvider(this.win.ethereum)};
  }
  private changed(){this.snap=this.compute();for(const fn of this.listeners)fn();}
}
/** The one line "My wallet" shows while `unidentified`. */
export const unidentifiedNote=(say:(zh:string,en:string)=>string)=>say('這個錢包沒有用 EIP-6963 表明身分，無法辨識是哪一個擴充功能；簽名前請確認跳出的是你信任的錢包。',
  'This wallet didn’t identify itself (EIP-6963), so the page can’t tell which extension it is; check that the prompt comes from the wallet you trust before signing.');
let shared:WalletRegistry|null=null;
/** The page's registry, started on first use (before the sign-in client binds a provider). */
export function wallets():WalletRegistry{
  if(!shared){let store:Store|null=null;try{store=localStorage;}catch{/* blocked */}
    shared=new WalletRegistry(globalThis as unknown as Target,store);shared.start();}
  return shared;
}
