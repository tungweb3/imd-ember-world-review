import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PACKAGES} from '../scripts/gold-topup-release.mjs';
import {PENDING_CREDIT_ETA_MS,PENDING_CREDIT_MAX_MS,PENDING_CREDIT_AFTER_EXPIRY_MS,PENDING_CREDIT_SKEW_MS,dropPendingCredit,dropPendingCreditByHash,markPendingCreditMined,paymentFailed,paymentHash,pendingCredit,pendingGold,readPendingCredits,settlePendingCredits,subscribePendingCredit,trackPendingCredit} from '../src/world/pendingGoldCredit.ts';
import {purchaseStage} from '../src/world/goldPurchaseRules.ts';
registerHooks({load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};if(!url.startsWith('file:')||!url.endsWith('.tsx'))return next(url,context);const file=fileURLToPath(url);return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};}});
const {GoldPurchase}=await import('../src/world/GoldPurchase.tsx');
const {WalletBalanceHud}=await import('../src/world/WalletBalanceHud.tsx');

// GOLD is credited at finality again (owner decision after Swarm audit e4a57f91, 2026-10-27): about 15 minutes after
// payment, with a gold "+N crediting" in the top bar and on the purchase page meanwhile (src/world/pendingGoldCredit.ts).
const store=new Map();globalThis.localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const W='0x'+'a'.repeat(40),ID='0x'+'1'.repeat(64),ID2='0x'+'3'.repeat(64),TX='0x'+'2'.repeat(64),NOW=1_793_000_000_000;
const order=(patch={})=>({id:ID,kind:'topup',gold:'1000',currency:'EMBEO',amount:'100000000000000000000000',status:'pending',creditedGold:'0',created_ms:NOW,expires_ms:NOW+900000,...patch});

test('a paid top-up is shown as crediting until the ledger books it, then dropped once',()=>{store.clear();let changes=0;const off=subscribePendingCredit(()=>changes++);
  trackPendingCredit(W,ID,TX,'1000',NOW);trackPendingCredit(W,ID,TX,'1000',NOW+5);
  assert.equal(pendingGold(W,NOW),1000n,'the top bar shows +1,000 crediting');assert.equal(readPendingCredits(W,NOW).length,1,'one entry per order');
  trackPendingCredit(W,ID2,TX,'100',NOW);assert.equal(pendingGold(W.toUpperCase().replace('0X','0x'),NOW),1100n,'per wallet, any address case');
  assert.equal(settlePendingCredits(W,[order({status:'paid',creditedGold:'0'})],NOW),false,'paid but not yet booked in World GOLD');
  assert.equal(settlePendingCredits(W,[order({status:'paid',creditedGold:'1000'})],NOW+14*60_000),true);
  assert.equal(pendingGold(W,NOW),100n);assert.equal(pendingCredit(W,ID,NOW),null);assert.ok(pendingCredit(W,ID2,NOW));
  assert.ok(changes>=3);off();
});
test('the note never outlives the display window and holds no entitlement',()=>{store.clear();
  trackPendingCredit(W,ID,TX,'1000',NOW);
  assert.equal(pendingGold(W,NOW+PENDING_CREDIT_MAX_MS-1),1000n);assert.equal(pendingGold(W,NOW+PENDING_CREDIT_MAX_MS),0n);
  settlePendingCredits(W,[],NOW+PENDING_CREDIT_MAX_MS);assert.equal(store.size,0,'a stale entry is removed on the next check');
  store.set('ember-pending-gold-v1:'+W,'{not json');assert.equal(pendingGold(W,NOW),0n);
  store.set('ember-pending-gold-v1:'+W,JSON.stringify([{orderId:'x',gold:'5',hash:TX,atMs:NOW},{orderId:ID,gold:'-1',hash:TX,atMs:NOW}]));assert.equal(pendingGold(W,NOW),0n,'malformed entries are ignored');
  assert.equal(PENDING_CREDIT_ETA_MS,15*60_000);
});
test('only the payment\'s own hash starts a note: never the approval hash still shown while the payment is checked or sent',()=>{
  // Independent review 2026-10-27: approve, then "confirm payment" set step 'execute' with the approval hash still in
  // state ('checking'), so "+N crediting" appeared before the wallet asked, and stayed after a rejected prompt.
  const APPROVAL='0x'+'a1'.repeat(32),PAY='0x'+'b2'.repeat(32);
  for(const phase of ['checking','sending','unknown','confirm','error','rejected'])assert.equal(paymentHash({phase,step:'execute',hash:APPROVAL}),null,phase);
  assert.equal(paymentHash({phase:'confirmed',step:'approve',hash:APPROVAL}),null,'the confirmed approval itself');
  assert.equal(paymentHash({phase:'pending',step:'execute',hash:PAY}),PAY);assert.equal(paymentHash({phase:'confirmed',step:'execute',hash:PAY}),PAY);
});
test('a reverted or replaced payment drops its note at once; a rejected prompt never made one',()=>{store.clear();
  assert.equal(paymentFailed({phase:'error',step:'execute',error:'TRANSACTION_REVERTED'}),true);assert.equal(paymentFailed({phase:'replaced',step:'execute',error:'TRANSACTION_REPLACED'}),true);
  for(const w of [{phase:'error',step:'execute',error:'USER_REJECTED'},{phase:'replaced',step:'approve',error:'TRANSACTION_REPLACED'},{phase:'pending',step:'execute',error:null}])assert.equal(paymentFailed(w),false,JSON.stringify(w));
  trackPendingCredit(W,ID,TX,'1000',NOW);trackPendingCredit(W,ID2,TX,'100',NOW);dropPendingCredit(W,ID,NOW);
  assert.equal(pendingGold(W,NOW),100n);assert.equal(pendingCredit(W,ID,NOW),null);dropPendingCredit(W,ID,NOW);assert.equal(pendingGold(W,NOW),100n,'idempotent');
});
test('Swarm audit 12e0525d: after a reload the failed payment\'s note is found by its hash (L-2)',()=>{store.clear();
  trackPendingCredit(W,ID,TX,'1000',NOW);trackPendingCredit(W,ID2,'0x'+'4'.repeat(64),'100',NOW);
  dropPendingCreditByHash(W,TX.toUpperCase().replace('0X','0x'),NOW);assert.equal(pendingCredit(W,ID,NOW),null);assert.equal(pendingGold(W,NOW),100n,'only that payment');
  const src=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
  assert.match(src,/const sent=wallet\.sentHash\?\?wallet\.hash;/,'by the hash the payment was sent with, not a pasted replacement');
  assert.match(src,/if\(sent\)dropPendingCreditByHash\(data\.wallet,sent\)/,'the panel drops by hash too, where the restored transaction has no plan');
});
test('a payment the wallet saw mined keeps its note past the after-expiry margin; only the 2 h cap ends it (review of 2aeac71)',()=>{store.clear();
  const quote=order({expires_ms:NOW+900000}),late=NOW+900001+PENDING_CREDIT_AFTER_EXPIRY_MS;
  trackPendingCredit(W,ID,TX,'1000',NOW);markPendingCreditMined(W,TX.toUpperCase().replace('0X','0x'),NOW);
  settlePendingCredits(W,[quote],late);assert.equal(pendingGold(W,late),1000n,'mined late or a slow indexer: still on its way');
  assert.equal(pendingGold(W,NOW+PENDING_CREDIT_MAX_MS),0n);
  const src=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
  assert.match(src,/const mined=wallet\.step==='execute'&&wallet\.phase==='confirmed';/);assert.match(src,/if\(data&&mined&&sent\)markPendingCreditMined\(data\.wallet,sent\)/);
});
test('Swarm audit 351b0573 finding 1: a payment that mined late but unseen by this browser keeps its note until it can be final',()=>{store.clear();
  assert.equal(PENDING_CREDIT_AFTER_EXPIRY_MS,60*60_000);
  // Expiry E; sent just before E, mined at E+25 min after the wallet stopped polling, final about E+38 min.
  const E=NOW+900000,quote=order({expires_ms:E});trackPendingCredit(W,ID,TX,'1000',E-60000);
  for(const at of [E+30*60_000+1,E+39*60_000])assert.equal((settlePendingCredits(W,[quote],at),pendingGold(W,at)),1000n,'kept at E+'+(at-E)/60000+' min');
  assert.equal(settlePendingCredits(W,[order({expires_ms:E,status:'paid',creditedGold:'1000'})],E+40*60_000),true,'booked: the top bar refreshes');
});
test('Swarm audit 351b0573 finding 6: the panel makes one note per payment, so the 2 h cap ends it while the panel stays open',()=>{
  const src=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
  assert.match(src,/const once=o\.id\+':'\+payingHash\.toLowerCase\(\)\+':'\+wallet\.phase;if\(tracked\.current\.has\(once\)\)return;tracked\.current\.add\(once\);\s*trackPendingCredit\(/);
  assert.match(src,/\},\[payingOrder,payingHash,wallet\.phase,data\]\);/,'a late confirmation still gets its one note');
});
test('Swarm audit 351b0573 findings 4 and 5: the GOLD panel offers the staking pane\'s recovery for an unresolved payment',()=>{
  const unknown={...idle,phase:'unknown',step:'execute',error:'PENDING_TRANSACTION'};
  let s=html({wallet:{...unknown,hash:TX},clearUnknown(){}});
  assert.ok(s.includes('原交易或替代交易雜湊')&&s.includes('只核對這筆交易'),'a cancelled or sped-up payment: paste its new hash');
  assert.ok(s.includes('查詢原交易'));assert.ok(!s.includes('確認未送出，解除防重'),'a sent hash is never cleared by hand');
  s=html({wallet:{...unknown,hash:null},clearUnknown(){}});
  assert.ok(s.includes('錢包回覆不明')&&s.includes('確認原交易沒有送出')&&s.includes('確認未送出，解除防重'),'a prompt that returned no hash: acknowledge');
  assert.ok(!html({wallet:{...unknown,hash:null}}).includes('確認未送出，解除防重'),'only where the panel wires the acknowledgement');
  assert.ok(!html().includes('只核對這筆交易'),'nothing of this while no payment is unresolved');
  const panel=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8'),page=readFileSync(new URL('../src/world/GoldPurchase.tsx',import.meta.url),'utf8');
  assert.match(panel,/check=\{hash=>void run\(\(\)=>controller!\.checkReceipt\(hash\)\)\} clearUnknown=\{\(\)=>void run\(\(\)=>controller!\.clearUnknownAfterWalletCheck\(\)\)\}/);
  assert.match(page,/onClick=\{\(\)=>check\(\)\}>\{say\('查詢原交易'/,'the original-transaction button passes no click event as a hash');
});
test('Swarm audit 12e0525d: a payment that never mines (cancelled or sped up in the wallet) ends 60 minutes after its quote expired (L-3)',()=>{store.clear();
  const quote=order({expires_ms:NOW+900000});trackPendingCredit(W,ID,TX,'1000',NOW);
  assert.equal(settlePendingCredits(W,[quote],NOW+900000+PENDING_CREDIT_AFTER_EXPIRY_MS),false);assert.equal(pendingGold(W,NOW+900000+PENDING_CREDIT_AFTER_EXPIRY_MS),1000n,'still within the margin');
  assert.equal(settlePendingCredits(W,[quote],NOW+900001+PENDING_CREDIT_AFTER_EXPIRY_MS),false,'dropped, not credited: no balance refresh');
  assert.equal(pendingGold(W,NOW+900001+PENDING_CREDIT_AFTER_EXPIRY_MS),0n);
  trackPendingCredit(W,ID,TX,'1000',NOW);assert.equal(settlePendingCredits(W,[order({status:'paid',creditedGold:'1000'})],NOW+3*3600000),false,'past the 2 h window: dropped silently');
});
test('Swarm audit 12e0525d: a note dated ahead of this clock is ignored instead of living for ever (I-6)',()=>{store.clear();
  trackPendingCredit(W,ID,TX,'1000',NOW+PENDING_CREDIT_SKEW_MS);assert.equal(pendingGold(W,NOW),1000n,'small skew tolerated');
  store.clear();trackPendingCredit(W,ID,TX,'1000',NOW+3*3600000);assert.equal(pendingGold(W,NOW),0n,'clock corrected backwards by 3 h');
  settlePendingCredits(W,[],NOW);assert.equal(store.size,0,'and removed on the next check');
  store.set('ember-pending-gold-v1:'+W,JSON.stringify([{orderId:ID,gold:'5',hash:TX,atMs:Number.MAX_SAFE_INTEGER}]));assert.equal(pendingGold(W,NOW),0n);
});
test('another tab changing a note reaches this tab (storage event), and only for these notes',()=>{
  const prior=globalThis.window;globalThis.window=new EventTarget();try{
   let n=0;const off=subscribePendingCredit(()=>n++);
   const fire=key=>window.dispatchEvent(Object.assign(new Event('storage'),{key}));
   fire('ember-pending-gold-v1:'+W);fire('ember-world-language');fire(null);assert.equal(n,2,'its own key and a cleared storage');
   off();fire('ember-pending-gold-v1:'+W);assert.equal(n,2,'unsubscribed');
  }finally{globalThis.window=prior;}
});
test('only the ledger completes a purchase: a mined receipt or a pending note never does',()=>{
  const plan={kind:'pay',payment:{orderId:ID}},w={phase:'confirmed',step:'execute',plan};
  assert.equal(purchaseStage(order(),w,NOW),'awaiting-credit');
  assert.equal(purchaseStage(order({status:'paid',creditedGold:'1000'}),w,NOW),'credited');
  assert.equal(purchaseStage(order({status:'paid',creditedGold:'0'}),w,NOW),'awaiting-credit','the credited amount must be booked');
});

const data={wallet:W,products:PACKAGES,paymentsReady:true,controls:[{feature:'topup',enabled:1}]},idle={phase:'idle',busy:false,plan:null,step:null,hash:null,error:null};
const html=patch=>renderToStaticMarkup(h(GoldPurchase,{data,wallet:idle,selected:null,config:{token:W,paymentContract:W,treasury:W},busy:false,zh:true,quote(){},prepare(){},approve(){},confirm(){},check(){},reconcile(){},clear(){},...patch}));
test('the purchase page states the 15-minute wait and the gold note before any payment, in both languages',()=>{
  const s=html();assert.ok(s.includes('付款完成後約 15 分鐘入帳。'));assert.ok(s.includes('右上角會用金色字顯示「+數量 入帳中」'));assert.ok(s.includes('請勿重複付款'));
  assert.ok(html({zh:false}).includes('Credited about 15 minutes after payment.'));
  assert.ok(!s.includes('12 秒')&&!html({zh:false}).includes('12 seconds'),'the fast-credit promise is gone');
});
test('after payment the page shows the gold crediting note with the expected time, then the credit',()=>{
  const paying={...idle,phase:'confirmed',step:'execute',plan:{kind:'pay',payment:{orderId:ID}},hash:TX},at=Date.UTC(2026,9,27,3,0);
  const expected=new Date(at+PENDING_CREDIT_ETA_MS).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false});
  let s=html({selected:order(),wallet:paying,pending:{orderId:ID,gold:'1000',hash:TX,atMs:at}});
  assert.match(s,/class="gold-credit-pending"/);assert.ok(s.includes('入帳中：+1,000 GOLD，預計 '+expected+' 前入帳（約 15 分鐘）。'));assert.ok(s.includes('請勿重複付款'));
  s=html({selected:order(),wallet:paying,pending:null});
  assert.ok(s.includes('等待最終確認後入帳（約 15 分鐘）'));assert.ok(s.includes('查詢原單入帳'),'another browser or a cleared note still has the check');
  s=html({selected:order({status:'paid',creditedGold:'1000'}),wallet:paying,pending:{orderId:ID,gold:'1000',hash:TX,atMs:at}});
  assert.ok(s.includes('GOLD 已入帳'));assert.ok(!s.includes('入帳中：'));
});
test('the top bar shows "+N 入帳中" in gold next to the GOLD balance while a top-up is pending',()=>{store.clear();
  const state={session:{address:W,expiresAt:NOW+3600000},account:W};
  const read=gold=>({identity:W,data:{embeo:{status:'ok',atomic:'0'},staked:{status:'ok',atomic:'0'},gold:{status:'ok',available:gold}},failed:false,refreshing:false,refresh:async()=>{}});
  const bar=()=>renderToStaticMarkup(h(WalletBalanceHud,{state,read:read('500'),zh:true,onOpen(){}}));
  assert.ok(!bar().includes('balance-gold-crediting'));
  trackPendingCredit(W,ID,TX,'1000');const s=bar();
  assert.match(s,/<dd title="500">500<span class="balance-gold-crediting" role="status"[^>]*> \+1,000<span class="balance-gold-crediting-word"> 入帳中<\/span>/);
  assert.match(readFileSync(new URL('../src/world/walletBalanceHud.css',import.meta.url),'utf8'),/\.balance-gold-crediting\{font-size:\.8em;color:#ffd86b;font-weight:700/,'bright gold');
});
test('the browser no longer asks for fast credit; only the finalized ledger credits a top-up',()=>{
  for(const f of readdirSync(new URL('../src/world/',import.meta.url),{recursive:true}).filter(f=>/\.tsx?$/.test(f)))
   assert.doesNotMatch(readFileSync(new URL('../src/world/'+f.replace(/\\/g,'/'),import.meta.url),'utf8'),/\/fast-credit|fastGoldCredit|followFastCredit/,f);
});
