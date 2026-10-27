import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {PACKAGES} from '../scripts/gold-topup-release.mjs';
import {EconomyClientError} from '../src/world/economyClient.ts';
import {FAST_CREDIT_SCHEDULE_MS,followFastCredit,fastFollow,fastCrediting,resetFastFollows} from '../src/world/fastGoldCredit.ts';
import {purchaseStage} from '../src/world/goldPurchaseRules.ts';
registerHooks({load(url,context,next){if(url.endsWith('.css'))return {format:'module',source:'export {};',shortCircuit:true};if(!url.startsWith('file:')||!url.endsWith('.tsx'))return next(url,context);const file=fileURLToPath(url);return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};}});
const {GoldPurchase}=await import('../src/world/GoldPurchase.tsx');

// GOLD fast credit in the browser (src/world/fastGoldCredit.ts, GoldPurchase, the top bar): follow the wallet's hash
// on a fixed schedule, show "crediting", and fall back to the finalized path on any refusal.
const ID='0x'+'1'.repeat(64),TX='0x'+'2'.repeat(64);
/** Manual timers: run() fires the next scheduled callback and lets its request settle. */
function harness(replies){
  const timers=[],events=[],calls=[];
  const deps={set:(fn,ms)=>{timers.push({fn,ms});},emit:(name,detail)=>events.push([name,detail?.gold]),
    fastCredit:async(id,hash)=>{calls.push([id,hash]);const r=replies.shift();if(r instanceof Error)throw r;return r;}};
  return {deps,timers,events,calls,async run(){const t=timers.shift();assert.ok(t,'a timer is scheduled');t.fn();for(let i=0;i<5;i++)await Promise.resolve();return t.ms;}};
}

test('the follower asks the server with the wallet hash and stops once the GOLD is credited',async()=>{resetFastFollows();
  const t=harness([{status:'waiting'},{status:'credited',gold:'100'}]);
  followFastCredit(t.deps,ID,TX,'100');
  assert.equal(fastFollow(ID).status,'crediting');assert.equal(fastCrediting(),100n,'the top bar shows +100 crediting');
  assert.equal(await t.run(),FAST_CREDIT_SCHEDULE_MS[0]);assert.equal(fastFollow(ID).status,'crediting');
  assert.equal(await t.run(),FAST_CREDIT_SCHEDULE_MS[1]-FAST_CREDIT_SCHEDULE_MS[0]);
  assert.equal(fastFollow(ID).status,'credited');assert.equal(fastCrediting(),0n);assert.equal(t.timers.length,0);
  assert.deepEqual(t.calls,[[ID,TX],[ID,TX]]);assert.deepEqual(t.events.at(-1),['world:gold-changed',undefined],'balances refresh');
  followFastCredit(t.deps,ID,TX,'100');assert.equal(t.calls.length,2,'one follower per order');
});

test('outages and rate limits retry on the schedule; a refusal ends fast credit and leaves the finalized path',async()=>{resetFastFollows();
  const t=harness([new EconomyClientError('RATE_LIMITED'),new EconomyClientError('CHAIN_UNAVAILABLE'),new EconomyClientError('PAYMENT_DOES_NOT_MATCH_ORDER')]);
  followFastCredit(t.deps,ID,TX,'100');await t.run();await t.run();assert.equal(fastFollow(ID).status,'crediting');
  await t.run();assert.deepEqual(fastFollow(ID),{orderId:ID,gold:'100',transactionHash:TX,status:'fallback',code:'PAYMENT_DOES_NOT_MATCH_ORDER'});
  assert.equal(t.timers.length,0);assert.equal(fastCrediting(),0n);
});

test('after a fallback the "check original credit" button can start the schedule again, never alongside a running one',async()=>{resetFastFollows();
  const t=harness([new EconomyClientError('FAST_CREDIT_UNAVAILABLE'),{status:'credited',gold:'100'}]);
  followFastCredit(t.deps,ID,TX,'100');await t.run();assert.equal(fastFollow(ID).status,'fallback');
  followFastCredit(t.deps,ID,TX,'100');assert.equal(fastFollow(ID).status,'crediting');
  followFastCredit(t.deps,ID,TX,'100');assert.equal(t.timers.length,1,'a running schedule is not doubled');
  await t.run();assert.equal(fastFollow(ID).status,'credited');assert.equal(t.calls.length,2);
});

test('the schedule ends after about 90 seconds of waiting, then the finalized path takes over',async()=>{resetFastFollows();
  const t=harness(FAST_CREDIT_SCHEDULE_MS.map(()=>({status:'waiting'})));followFastCredit(t.deps,ID,TX,'100');
  let total=0;while(t.timers.length)total+=await t.run();
  assert.equal(total,FAST_CREDIT_SCHEDULE_MS.at(-1));assert.equal(t.calls.length,FAST_CREDIT_SCHEDULE_MS.length);
  assert.deepEqual(fastFollow(ID),{orderId:ID,gold:'100',transactionHash:TX,status:'fallback',code:'TIMEOUT_WAITING'});
});
test('a schedule that ran out on rate limits says so in its code',async()=>{resetFastFollows();
  const t=harness(FAST_CREDIT_SCHEDULE_MS.map(()=>new EconomyClientError('RATE_LIMITED')));followFastCredit(t.deps,ID,TX,'100');
  while(t.timers.length)await t.run();assert.equal(fastFollow(ID).code,'TIMEOUT_RATE_LIMITED');
});

test('a fast credit, not a mined receipt, completes the purchase stage',()=>{
  const o={id:ID,kind:'topup',gold:'100',currency:'EMBEO',amount:'1',status:'pending',creditedGold:'0',expires_ms:Date.now()+60000};
  const plan={kind:'pay',payment:{orderId:ID}},w={phase:'confirmed',step:'execute',plan};
  assert.equal(purchaseStage(o,w,Date.now()),'awaiting-credit','a mined receipt alone is not credit');
  assert.equal(purchaseStage({...o,fastCredit:'credited',creditedGold:'100'},w,Date.now()),'credited');
  assert.equal(purchaseStage({...o,fastCredit:'credited',creditedGold:'0'},w,Date.now()),'awaiting-credit','the credited amount must be booked');
  assert.equal(purchaseStage({...o,fastCredit:'reverted',creditedGold:'100'},w,Date.now()),'awaiting-credit');
});

const W='0x'+'a'.repeat(40),order={id:ID,kind:'topup',gold:'1000',currency:'EMBEO',amount:'100000000000000000000000',status:'pending',creditedGold:'0',expires_ms:Date.now()+60000};
const data={wallet:W,products:PACKAGES,paymentsReady:true,controls:[{feature:'topup',enabled:1}]},idle={phase:'idle',busy:false,plan:null,step:null,hash:null,error:null};
const html=patch=>renderToStaticMarkup(h(GoldPurchase,{data,wallet:idle,selected:null,config:{token:W,paymentContract:W,treasury:W},busy:false,zh:true,quote(){},prepare(){},approve(){},confirm(){},check(){},reconcile(){},clear(){},...patch}));
test('the purchase page states the 12-second credit before any payment, in both languages',()=>{
  assert.ok(html().includes('付款上鏈後約 12 秒入帳。'));assert.ok(html().includes('以太坊每 12 秒產生一個區塊，網路壅塞時可能稍久。入帳前右上角會顯示「入帳中」。'));
  assert.ok(html({zh:false}).includes('Credited about 12 seconds after your payment is on chain.'));
  assert.ok(!html({selected:order}).includes('通常約 15 分鐘'));
});
test('after payment the page says crediting while the follower runs, and the 15-minute fallback otherwise',()=>{
  const paying={...idle,phase:'confirmed',step:'execute',plan:{kind:'pay',payment:{orderId:ID}},hash:TX};
  let s=html({selected:order,wallet:paying,fast:{orderId:ID,gold:'1000',status:'crediting'}});
  assert.ok(s.includes('入帳中（約 12 秒）'));assert.ok(s.includes('請勿重複付款'));assert.ok(!s.includes('最晚約 15 分鐘'));
  s=html({selected:order,wallet:paying,fast:{orderId:ID,gold:'1000',transactionHash:TX,status:'fallback',code:'TIMEOUT_RATE_LIMITED'}});
  assert.ok(s.includes('最晚約 15 分鐘'));assert.ok(s.includes('查詢原單入帳'));assert.ok(!s.includes('入帳中（約 12 秒）'));
  assert.ok(s.includes('參考代碼：TIMEOUT_RATE_LIMITED'),'the reason is visible for a screenshot');
  s=html({selected:{...order,fastCredit:'credited',creditedGold:'1000'},wallet:paying,fast:{orderId:ID,gold:'1000',status:'credited'}});
  assert.ok(s.includes('GOLD 已入帳'));
});
