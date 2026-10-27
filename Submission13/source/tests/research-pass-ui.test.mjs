import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {createElement as h} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fetchAIMarketPassStatus,researchAccessNote} from '../src/world/aimarketPass.ts';
import {researchPassTerms,utcMinute,RESEARCH_PASS_PRODUCT} from '../src/world/researchPassCopy.ts';
import {goldPurchaseError} from '../src/world/goldPurchaseRules.ts';
registerHooks({load(url,context,next){if(!url.startsWith('file:')||!url.endsWith('.tsx'))return next(url,context);const file=fileURLToPath(url);return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};}});
const {ResearchPassCard}=await import('../src/world/ResearchPassCard.tsx');

const W='0x'+'a'.repeat(40),NOW=Date.UTC(2026,9,26,12),ENDS=NOW+3600_000;
const product={id:'research-pass:2',product:RESEARCH_PASS_PRODUCT,version:2,title:'每日通行證',gold:'100'};
const AREAS_ZH=['現貨卡片','IMD 雷達排行','代幣焦點','待研究項目','近 72 小時新幣觀察'];

test('rule D: the access note never mentions an EMBEO holding; it names the day pass',()=>{
 const none={trialEndsMs:null,passEndsMs:null,access:null,offerGold:null};
 assert.equal(researchAccessNote({zh:true,...none}),'柔焦隱藏的研究區域需持有每日通行證（24 小時）；這裡不會要求付款。');
 assert.equal(researchAccessNote({zh:false,...none}),'The softly blurred research areas need a 24-hour day pass. No payment is requested here.');
 for(const text of [researchAccessNote({zh:true,...none}),researchAccessNote({zh:false,...none}),researchAccessNote({zh:true,...none,offerGold:'100'}),researchAccessNote({zh:false,...none,offerGold:'100'}),researchAccessNote({zh:true,...none,passEndsMs:ENDS}),researchAccessNote({zh:false,...none,passEndsMs:ENDS})])assert.ok(!/EMBEO|100 萬|1,000,000/.test(text),text);
 assert.equal(researchAccessNote({zh:true,...none,access:true}),'研究資格已確認。');
 assert.equal(researchAccessNote({zh:false,...none,access:true}),'Research access confirmed.');
 assert.equal(researchAccessNote({zh:true,...none,trialEndsMs:ENDS}),'免費研究體驗進行中；結束時間 UTC：'+new Date(ENDS).toISOString());
 assert.equal(researchAccessNote({zh:false,...none,trialEndsMs:ENDS}),'Free research trial active; ends UTC: '+new Date(ENDS).toISOString());
});
test('access note announces an active pass with its UTC end and says BTC/ETH detail is open too',()=>{
 const zh=researchAccessNote({zh:true,trialEndsMs:null,passEndsMs:ENDS,access:true,offerGold:null}),en=researchAccessNote({zh:false,trialEndsMs:null,passEndsMs:ENDS,access:true,offerGold:null});
 assert.ok(zh.includes(utcMinute(ENDS))&&zh.includes('含 BTC / ETH 研究詳情')&&zh.includes('皆已開放'));assert.ok(en.includes('2026-10-26 13:00 UTC')&&en.includes('BTC / ETH research detail included'));
 // a free campaign wins over a pass note; the pass note wins over "access confirmed"
 assert.ok(researchAccessNote({zh:true,trialEndsMs:ENDS,passEndsMs:ENDS,access:true,offerGold:null}).startsWith('免費研究體驗'));
});
test('the offer sentence appears only when a price is known, with the exact price',()=>{
 const o=researchAccessNote({zh:true,trialEndsMs:null,passEndsMs:null,access:false,offerGold:'100'});
 assert.ok(o.includes('100 GOLD')&&o.includes('24 小時通行證')&&o.includes('含 BTC / ETH 研究詳情')&&!o.includes('不含'));assert.ok(!o.includes('這裡不會要求付款'));
 assert.ok(researchAccessNote({zh:false,trialEndsMs:null,passEndsMs:null,access:null,offerGold:'250'}).includes('250 GOLD'));
});

test('sale terms state what is opened (BTC/ETH detail included, no holding asked), the 24 hours, no repeat purchase and the GOLD rules',()=>{
 const zh=researchPassTerms(true,'100'),en=researchPassTerms(false,'100');
 for(const part of [...AREAS_ZH,'100 GOLD','付款成功即開通','24 小時','BTC / ETH 研究詳情','恕不退款','不延長有效期','不能重複購買','不可轉讓','不可兌回 EMBEO','不構成投資建議'])assert.ok(zh.includes(part),part);
 for(const part of ['100 GOLD','as soon as payment succeeds','24 hours','spot cards','IMD radar rankings','token focus','research leads','new-token watch','BTC / ETH research detail','non-refundable','not extended','cannot be bought again','non-transferable','not investment advice'])assert.ok(en.includes(part),part);
 // The old terms excluded BTC / ETH detail and asked for a 1,000,000 EMBEO holding; neither may come back.
 for(const text of [zh,en]){assert.ok(!/不含|not included|100 萬|1,000,000/.test(text),text);}
});

test('rule D: the hall door texts in World no longer ask for a 1,000,000 EMBEO holding',()=>{
 for(const file of ['../src/world/mountainTour/intro.ts','../src/world/publicHalls/runtime.ts']){
  const text=readFileSync(new URL(file,import.meta.url),'utf8');
  assert.ok(!/1,000,000 EMBEO|至少 1,000,000/.test(text),file);
  assert.ok(/24 小時|24-hour/.test(text),file);
 }
});
test('pass card shows price, version and the full terms next to an enabled order button',()=>{
 const html=renderToStaticMarkup(h(ResearchPassCard,{product,pass:null,zh:true,busy:false,disabled:false,onCreate(){throw Error('SSR must not order');}}));
 for(const part of ['每日通行證','100 GOLD','v2',...AREAS_ZH,'不構成投資建議'])assert.ok(html.includes(part),part);
 assert.match(html,/<button>建立訂單<\/button>/);assert.ok(!html.includes('有效至'));
});
test('an active pass disables ordering and shows when it ends; so do busy, closed and unavailable states',()=>{
 const render=patch=>renderToStaticMarkup(h(ResearchPassCard,{product,pass:null,zh:true,busy:false,disabled:false,onCreate(){},...patch}));
 const active=render({pass:{active:true,endsMs:ENDS}});assert.ok(active.includes('2026-10-26 13:00 UTC')&&active.includes('到期後才能再次購買'));assert.match(active,/<button disabled="">通行證有效中<\/button>/);
 assert.match(render({pass:{active:false,endsMs:NOW-1}}),/<button>建立訂單<\/button>/);          // an ended pass can be bought again
 for(const patch of [{busy:true},{disabled:true},{product:{...product,serviceable:false}}])assert.match(render(patch),/<button disabled="">/);
 assert.ok(render({product:{...product,serviceable:false}}).includes('目前不接受新訂單'));
 assert.ok(renderToStaticMarkup(h(ResearchPassCard,{product,pass:{active:true,endsMs:ENDS},zh:false,busy:false,disabled:false,onCreate(){}})).includes('Pass active until 2026-10-26 13:00 UTC'));
});

const session={address:W.toUpperCase().replace('0X','0x'),expiresAt:NOW+10*3600_000};
const state=(patch={})=>({wallet:W,paymentsReady:true,deliveryReady:true,controls:[{feature:'service',enabled:1,version:2}],researchPass:null,
 products:[{id:'research-pass:2',product:RESEARCH_PASS_PRODUCT,version:2,kind:'service',title:'x',gold:'100',embeo:null,enabled:1,serviceable:true}],...patch});
const status=async(body,{ok=true,now=[NOW,NOW+5],sessionPatch={}}={})=>{let i=0;return fetchAIMarketPassStatus({...session,...sessionPatch},{fetch:async()=>({ok,json:async()=>body}),now:()=>now[Math.min(i++,now.length-1)]});};
test('pass status reads the offer and the wallet grant from the wallet-fenced GOLD state',async()=>{
 assert.deepEqual(await status(state()),{offerGold:'100',active:false,endsMs:null});
 assert.deepEqual(await status(state({researchPass:{active:true,endsMs:ENDS,version:2}})),{offerGold:'100',active:true,endsMs:ENDS});
 assert.equal((await status(state({researchPass:{active:true,endsMs:NOW,version:2}}))).active,false);    // ended while the answer was in flight
 assert.equal((await status(state({researchPass:{active:false,endsMs:NOW-10,version:2}}))).active,false);
});
test('no offer unless the product is enabled, serviceable, the service control is open and payments are ready',async()=>{
 const product=patch=>state({products:[{...state().products[0],...patch}]});
 for(const body of [product({enabled:0}),product({serviceable:false}),product({kind:'topup'}),product({gold:'0'}),product({product:'other'}),state({products:[]}),state({controls:[{feature:'service',enabled:0,version:3}]}),state({controls:[]}),state({paymentsReady:false}),state({deliveryReady:false})])assert.equal((await status(body)).offerGold,null);
});
test('pass status refuses another wallet, a failed or malformed answer, an expired session and a moving clock',async()=>{
 assert.equal(await status(state({wallet:'0x'+'b'.repeat(40)})),null);assert.equal(await status(state(),{ok:false}),null);
 for(const bad of [{researchPass:{active:'yes',endsMs:ENDS}},{researchPass:{active:true,endsMs:0}},{researchPass:{active:true,endsMs:1.5}},{products:{}},{controls:null}])assert.equal(await status(state(bad)),null);
 assert.equal(await status(state(),{sessionPatch:{expiresAt:NOW}}),null);assert.equal(await status(state(),{now:[NOW,NOW-1]}),null);
 assert.equal(await status(state(),{sessionPatch:{address:'nope'}}),null);
 assert.equal(await fetchAIMarketPassStatus(session,{fetch:async()=>{throw Error('offline');},now:()=>NOW}),null);
 const aborted=new AbortController();aborted.abort();assert.equal(await fetchAIMarketPassStatus(session,{signal:aborted.signal,fetch:async()=>assert.fail('must not fetch'),now:()=>NOW}),null);
});

test('a wallet without enough GOLD is told so on the pass card instead of creating an order it cannot pay',()=>{
 const short=renderToStaticMarkup(h(ResearchPassCard,{product,pass:null,zh:true,busy:false,disabled:true,insufficient:true,onCreate(){}}));
 assert.ok(short.includes('GOLD 不足')&&short.includes('100 GOLD'));assert.match(short,/<button disabled="">建立訂單<\/button>/);
 assert.ok(!renderToStaticMarkup(h(ResearchPassCard,{product,pass:null,zh:true,busy:false,disabled:false,onCreate(){}})).includes('GOLD 不足'));
 assert.ok(!renderToStaticMarkup(h(ResearchPassCard,{product,pass:{active:true,endsMs:ENDS},zh:true,busy:false,disabled:true,insufficient:true,onCreate(){}})).includes('GOLD 不足'));   // an active pass needs no top-up note
 assert.ok(renderToStaticMarkup(h(ResearchPassCard,{product,pass:null,zh:false,busy:false,disabled:true,insufficient:true,onCreate(){}})).includes('Not enough GOLD'));
});
test('signing-step failures that used to show only a reference code now say what to do',()=>{
 for(const code of ['INVALID_GOLD_CHALLENGE','CHALLENGE_EXPIRED','INSUFFICIENT_GOLD','ECONOMY_HALTED','NOT_CONFIGURED','INVALID_CHAIN_RESPONSE','WALLET_TIMEOUT','RATE_LIMITED','INVALID_SIGNATURE']){
  const zh=goldPurchaseError(code,true),en=goldPurchaseError(code,false);
  assert.ok(!zh.includes('參考代碼')&&!en.includes('Reference:'),code);assert.notEqual(zh,en);
 }
 assert.ok(goldPurchaseError('INVALID_GOLD_CHALLENGE',true).includes('時間'));assert.ok(goldPurchaseError('UNKNOWN_X',true).includes('參考代碼：UNKNOWN_X'));
});
test('refusal reasons have plain wording in both languages',()=>{
 for(const code of ['PASS_ALREADY_ACTIVE','PASS_ORDER_PENDING']){const zh=goldPurchaseError(code,true),en=goldPurchaseError(code,false);assert.ok(!zh.includes(code)&&!en.includes(code));assert.notEqual(zh,en);}
 assert.ok(goldPurchaseError('PASS_ALREADY_ACTIVE',true).includes('到期後才能再次購買'));assert.ok(goldPurchaseError('PASS_ORDER_PENDING',false).includes('15 minutes'));
});
