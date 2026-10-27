import type {GoldOrder} from './worldGoldClient.ts';
import {orderCredited} from './goldPurchaseRules.ts';

/** A top-up the wallet has paid that the ledger has not credited yet. GOLD is credited once the payment is final
 *  (about 15 minutes; fast credit was switched off on 2026-10-27 after Swarm audit e4a57f91, owner decision), so the
 *  top bar shows a gold "+N crediting" meanwhile. Kept per wallet in this browser so it survives a reload; display
 *  only, never an entitlement: the ledger alone says credited. */
export type PendingCredit={orderId:string;gold:string;hash:string;atMs:number;
 /** The wallet saw this payment mined with its effect: the after-expiry rule no longer applies, only the 2 h cap. */
 mined?:boolean};
/** Finality takes about 13 minutes and the minute cron books it after; past 2 hours the entry is dropped. A note for an
 *  order still unpaid 60 minutes after its quote expired goes too: a payment cancelled or sped up in the wallet never
 *  mines, so nothing else would end it (Swarm audit 12e0525d L-3). The margin was 30 minutes; a payment sent near the
 *  end of its quote that mined some 25 minutes later lost its note before it was final (Swarm audit 351b0573, finding 1),
 *  so it now covers a late inclusion plus finality. An entry dated more than 5 minutes ahead of this clock (a clock
 *  corrected backwards, a damaged entry) is ignored rather than kept for ever (I-6). */
export const PENDING_CREDIT_ETA_MS=15*60_000,PENDING_CREDIT_MAX_MS=2*60*60_000,PENDING_CREDIT_AFTER_EXPIRY_MS=60*60_000,PENDING_CREDIT_SKEW_MS=5*60_000;
const key=(address:string)=>'ember-pending-gold-v1:'+address.toLowerCase();
const listeners=new Set<()=>void>();
/** Also told when another tab of this site changes a note (the `storage` event), so every tab shows the same. */
export function subscribePendingCredit(fn:()=>void){
 const other=(e:StorageEvent)=>{if(e.key===null||e.key.startsWith('ember-pending-gold-v1:'))fn();};
 listeners.add(fn);if(typeof window!=='undefined')window.addEventListener('storage',other);
 return()=>{listeners.delete(fn);if(typeof window!=='undefined')window.removeEventListener('storage',other);};
}
function stored(address:string):unknown[]{try{const v=JSON.parse(localStorage.getItem(key(address))??'[]');return Array.isArray(v)?v:[];}catch{return [];}}
function save(address:string,list:PendingCredit[]){try{if(list.length)localStorage.setItem(key(address),JSON.stringify(list));else localStorage.removeItem(key(address));}catch{/* display only */}for(const fn of listeners)fn();}
export function readPendingCredits(address:string,now=Date.now()):PendingCredit[]{
 return stored(address).filter((p):p is PendingCredit=>{const v=p as PendingCredit;return !!v&&/^0x[0-9a-f]{64}$/.test(v.orderId)&&/^[1-9][0-9]*$/.test(v.gold)&&typeof v.hash==='string'&&Number.isSafeInteger(v.atMs)&&v.atMs<=now+PENDING_CREDIT_SKEW_MS&&now-v.atMs<PENDING_CREDIT_MAX_MS;});
}
export function pendingCredit(address:string|null|undefined,orderId:string|null|undefined,now=Date.now()){return address&&orderId?readPendingCredits(address,now).find(p=>p.orderId===orderId)??null:null;}
/** The GOLD still being credited for this wallet (the top bar's "+N crediting"). */
export function pendingGold(address:string|null|undefined,now=Date.now()){let n=0n;if(address)for(const p of readPendingCredits(address,now))n+=BigInt(p.gold);return n;}
/** The wallet returned the payment hash of this top-up: show it as being credited until the ledger books it. */
export function trackPendingCredit(address:string,orderId:string,hash:string,gold:string,now=Date.now()){
 const list=readPendingCredits(address,now);if(list.some(p=>p.orderId===orderId)||!/^[1-9][0-9]*$/.test(gold))return;
 save(address,[...list,{orderId,gold,hash,atMs:now}]);
}
/** The hash of this top-up's payment, once the wallet has returned it (economyWallet.ts send sets it with phase
 *  'pending'). Before that wallet.hash is still the approval's: through 'checking' and 'sending' of the payment step,
 *  and after a wallet that answered nothing usable ('unknown'). A note made then would say "crediting" for no payment. */
export function paymentHash(wallet:{phase:string;step:string|null;hash:string|null}){return wallet.step==='execute'&&(wallet.phase==='pending'||wallet.phase==='confirmed')?wallet.hash:null;}
/** A payment reverted on chain or replaced by another transaction sends no GOLD. */
export function paymentFailed(wallet:{phase:string;step:string|null;error:string|null}){return wallet.step==='execute'&&(wallet.phase==='replaced'||wallet.phase==='error'&&wallet.error==='TRANSACTION_REVERTED');}
/** The payment did not go through (reverted on chain, or replaced by another transaction): no GOLD is on its way. */
export function dropPendingCredit(address:string,orderId:string,now=Date.now()){
 const list=readPendingCredits(address,now);if(list.some(p=>p.orderId===orderId))save(address,list.filter(p=>p.orderId!==orderId));
}
/** A payment the wallet saw mined with its intended effect is on its way to the ledger even when it mined late (low
 *  gas) or the indexer is slow: keep its note past the after-expiry margin (review of 2aeac71). */
export function markPendingCreditMined(address:string,hash:string,now=Date.now()){
 const h=hash.toLowerCase(),list=readPendingCredits(address,now);
 if(list.some(p=>p.hash.toLowerCase()===h&&!p.mined))save(address,list.map(p=>p.hash.toLowerCase()===h?{...p,mined:true}:p));
}
/** The same, found by the payment's hash: after a reload the wallet controller restores the transaction without its
 *  plan, so the order id is not known there, only the hash (Swarm audit 12e0525d L-2). */
export function dropPendingCreditByHash(address:string,hash:string,now=Date.now()){
 const h=hash.toLowerCase(),list=readPendingCredits(address,now);if(list.some(p=>p.hash.toLowerCase()===h))save(address,list.filter(p=>p.hash.toLowerCase()!==h));
}
/** Drop what the ledger has credited (and anything past the display window). True when a pending top-up was credited. */
export function settlePendingCredits(address:string,orders:readonly GoldOrder[],now=Date.now()){
 const list=readPendingCredits(address,now),order=(p:PendingCredit)=>orders.find(o=>o.id===p.orderId);
 const credited=list.filter(p=>{const o=order(p);return !!o&&orderCredited(o);});
 const keep=list.filter(p=>{const o=order(p);return !(o&&(orderCredited(o)||!p.mined&&o.status==='pending'&&now>o.expires_ms+PENDING_CREDIT_AFTER_EXPIRY_MS));});
 if(keep.length!==stored(address).length)save(address,keep);
 return credited.length>0;
}
