import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as client from '../src/world/economyClient.ts';
import * as entry from '../src/world/economyEntry.ts';
import {INITIAL} from '../src/world/auth.ts';

const NOW=1_800_000_000_000,A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),VAULT='0x'+'1'.repeat(40),PAY='0x'+'2'.repeat(40);
const source=readFileSync(new URL('../src/world/EconomyPane.tsx',import.meta.url),'utf8'),product=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const enabled={enabled:true,chainId:1,token:client.ECONOMY_TOKEN,tokenDecimals:18,stakingContract:VAULT,paymentContract:PAY,treasury:client.ECONOMY_TREASURY,shareTokens:'100000',shareWei:String(client.SHARE_WEI),rule:'utc-full-day-v1',goldTransferable:false,catalogue:[]};
const disabled={enabled:false,reason:'NOT_CONFIGURED',shareTokens:'100000',rule:'utc-full-day-v1',goldTransferable:false,catalogue:[]};
const account=()=>({...INITIAL,account:A,session:{address:A,expiresAt:NOW+3600000},sessionKnown:true,restored:true});
const snapshot=(patch={})=>({address:A,gold:'12',positions:[{id:'1',shares:'2',initialShares:'3',depositedMs:NOW-86400000}],positionsTruncated:false,journal:[],orders:[],chain:{block:'123',throughMs:NOW,haltedReason:null},settledThroughMs:NOW-86400000,...patch});
function fixture({language='zh',initial=account(),priorInert=false}={}){
 const hooks=[],requests=[],controllers=[],timers=new Map(),keys=new Map();let cursor=0,tree,pending=[],dirty=false,mounted=true,lateWrites=0,current=NOW,focus=0,restored=0,closed=0,signedIn=0,walletReads=0;
 const prior={isConnected:true,closest:()=>priorInert?{}:null,focus(){restored++;}},returnButton={offsetWidth:100,offsetHeight:44,focus(){focus++;}},lastButton={offsetWidth:100,offsetHeight:44,focus(){focus++;}},document={activeElement:prior,addEventListener:(name,fn)=>keys.set(name,fn),removeEventListener:name=>keys.delete(name)},host={querySelector:()=>returnButton,querySelectorAll:()=>[returnButton,lastButton]};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={useRef(initial){const i=cursor++;return hooks[i]??={current:i===0?host:initial};},useState(initial){const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};const slot=hooks[i];return [slot.value,next=>{if(!mounted)lateWrites++;const value=typeof next==='function'?next(slot.value):next;if(!Object.is(slot.value,value)){slot.value=value;dirty=true;}}];},useEffect(fn,deps){const i=cursor++,old=hooks[i];if(!old||!same(old.deps,deps)){const slot={deps,cleanup:old?.cleanup};hooks[i]=slot;pending.push(()=>{slot.cleanup?.();slot.cleanup=fn();});}},useSyncExternalStore(subscribe,get){const i=cursor++;if(hooks[i]?.subscribe!==subscribe){hooks[i]?.cleanup?.();hooks[i]={subscribe,cleanup:subscribe(()=>{dirty=true;})};}return get();}};
 class FakeClient{config(signal){return new Promise(resolve=>requests.push({kind:'config',signal,resolve}));}snapshot(signal){return new Promise(resolve=>requests.push({kind:'snapshot',signal,resolve}));}createOrder(config,serviceId,currency,requestId,signal){return new Promise((resolve,reject)=>requests.push({kind:'order',config,serviceId,currency,requestId,signal,resolve,reject}));}goldChallenge(order,requestId,origin,signal){return new Promise((resolve,reject)=>requests.push({kind:'challenge',order,requestId,origin,signal,resolve,reject}));}}
 class FakeController{
  state={phase:'idle',busy:false,plan:null,hash:null,step:null,error:null,legacyPending:false};listeners=new Set();plans=[];receiptCandidates=[];acknowledgements=0;disposed=false;
  constructor(deps){this.deps=deps;controllers.push(this);}subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn);};restorePending(){}contextChanged(){}dispose(){this.disposed=true;this.listeners.clear();}prepare(plan){this.plans.push(plan);this.state={...this.state,plan,phase:'confirm'};for(const fn of this.listeners)fn();}approve(){}confirm(){}checkReceipt(hash){this.receiptCandidates.push(hash);}clearUnknownAfterWalletCheck(){this.acknowledgements++;}async payGold(order){return {...order,status:'paid',paidMs:current};}
 }
 const registry={state:{options:[],needsChoice:false},subscribe:()=>()=>{},subscribeProvider:()=>()=>{},current(){walletReads++;return null;},choose(){}};
 const exports={},require=name=>{if(name==='react')return react;if(name==='react/jsx-runtime')return {Fragment:Symbol.for('fragment'),jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})};if(name==='./economyClient.ts')return {...client,EconomyClient:FakeClient};if(name==='./economyWallet.ts')return {EconomyWalletController:FakeController,localEconomyPending:{}};if(name==='./economyEntry.ts')return entry;if(name==='./wallet.ts')return {wallets:()=>registry};if(name==='./economyPane.css')return {};throw Error(name);};
 vm.runInNewContext(product,{exports,require,document,location:{origin:'https://imdember.com',search:'?provider=https://evil.invalid&amount=1'},Date:{now:()=>current},AbortController,BigInt,Number,crypto:globalThis.crypto,setInterval(fn){const id=timers.size+1;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)});
 let props={language,state:initial,onSignIn(){signedIn++;},onClose(){closed++;}};
 const render=()=>{cursor=0;pending=[];dirty=false;tree=exports.EconomyPane(props);for(const fn of pending)fn();};
 const flush=()=>{for(let i=0;dirty;i++){assert.ok(i<20,'effects settle');render();}};
 const text=node=>node==null||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
 const nodes=type=>{const found=[],visit=node=>{if(!node||typeof node!=='object')return;if(Array.isArray(node)){for(const n of node)visit(n);return;}if(node.type===type)found.push(node);visit(node.props?.children);};visit(tree);return found;};
 render();flush();return {requests,controllers,keys,timers,document,returnButton,lastButton,render(){render();flush();},nodes,get text(){return text(tree);},get lateWrites(){return lateWrites;},get walletReads(){return walletReads;},get focus(){return focus;},get restored(){return restored;},get closed(){return closed;},get signedIn(){return signedIn;},get state(){return props.state;},update(state){props={...props,state};render();flush();},async settle(){await new Promise(resolve=>setImmediate(resolve));flush();},time(value){current=value;for(const fn of timers.values())fn();flush();},unmount(){mounted=false;for(const hook of hooks)hook?.cleanup?.();}};
}
test('actual disabled pane shows truthful rules and never loads a wallet or asset balance',async()=>{
 const f=fixture();assert.equal(f.requests.length,1);assert.equal(f.requests[0].kind,'config');f.requests[0].resolve(disabled);await f.settle();assert.match(f.text,/尚未開放/);assert.match(f.text,/100,000 EMBEO/);assert.match(f.text,/完整 UTC 日/);assert.match(f.text,/不可交易或轉讓/);assert.equal(f.controllers.length,0);assert.equal(f.walletReads,0);assert.equal(f.nodes('input').length,0);assert.equal(f.requests.length,1);f.unmount();
});
test('actual English disabled state and return action preserve the original World shell',async()=>{const f=fixture({language:'en'});f.requests[0].resolve(disabled);await f.settle();assert.match(f.text,/Not open yet/);assert.match(f.text,/cannot be traded or transferred/);const back=f.nodes('button').find(b=>b.props.children==='Back to World');back.props.onClick();assert.equal(f.closed,1);assert.equal(f.focus,1);f.unmount();assert.equal(f.restored,1);});
test('enabled panel reads only the current server account and displays finalized balance and sync',async()=>{
 const f=fixture();f.requests[0].resolve(enabled);await f.settle();assert.equal(f.controllers.length,1);assert.equal(f.requests.filter(r=>r.kind==='snapshot').length,1);assert.equal(f.walletReads,0);f.requests.find(r=>r.kind==='snapshot').resolve(snapshot());await f.settle();assert.match(f.text,/12\s+GOLD/);assert.match(f.text,/已確認的可用 GOLD，已扣除處理中保留/);assert.match(f.text,/尚無上架服務/);assert.equal(f.nodes('button').some(b=>b.props.children==='核對質押'&&!b.props.disabled),true);f.unmount();assert.equal(f.controllers[0].disposed,true);
});

test('capacity-pending rewards are labelled separately from spendable GOLD in the actual staking pane',async()=>{
 for(const language of ['zh','en']){const f=fixture({language});f.requests[0].resolve(enabled);await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({gold:'12',pendingRewardCount:'2'}));await f.settle();
  assert.match(f.text,/12\s+GOLD/);assert.match(f.text,language==='zh'?/尚未計入可用 GOLD/:/not included in spendable GOLD/);assert.equal(f.controllers[0].plans.length,0);f.unmount();}
});
test('actual pane labels historical corrections and retained wrong-amount evidence without promising refunds or resending',async()=>{
 const f=fixture();f.requests[0].resolve(enabled);await f.settle();
 f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({journal:[{id:'adjust:fixture',delta:'1',kind:'historical-adjustment',createdMs:NOW}],paymentCases:[{id:'case-fixture',transactionHash:'0x'+'f'.repeat(64),orderId:'0x'+'3'.repeat(64),actualAmount:'1',expectedAmount:String(10n**18n),classification:'wrong-amount',createdMs:NOW,correctPaymentEvent:'event-fixture',disposition:'unreviewed'}]}));await f.settle();
 assert.match(f.text,/歷史差額補帳/);assert.match(f.text,/付款對帳紀錄/);assert.match(f.text,/0\.000000000000000001/);assert.match(f.text,/正確付款已確認/);assert.match(f.text,/不會自動退款或重送交易/);assert.match(f.text,/處置未結案/);assert.equal(f.controllers[0].plans.length,0);f.unmount();
});

test('actual pane displays a finalized payment awaiting owner fulfillment without calling it delivered or suggesting resend',async()=>{
 for(const language of ['zh','en']){
  const f=fixture({language});f.requests[0].resolve(enabled);await f.settle();
  f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({paymentCases:[{id:'pending-payment',transactionHash:'0x'+'f'.repeat(64),orderId:'0x'+'3'.repeat(64),actualAmount:String(10n**18n),expectedAmount:String(10n**18n),classification:'pending-fulfillment',createdMs:NOW,correctPaymentEvent:null,disposition:'unreviewed'}]}));await f.settle();
  assert.match(f.text,language==='zh'?/付款已確認，等待服務交付/:/Finalized payment received; service delivery pending/);
  assert.doesNotMatch(f.text,language==='zh'?/正確付款已確認，原異常款另行記錄/:/Correct payment confirmed; original exception retained/);
  assert.equal(f.controllers[0].plans.length,0);f.unmount();
 }
});
test('account switch hides old GOLD immediately and aborts its late ledger reply',async()=>{
 const f=fixture();f.requests[0].resolve(enabled);await f.settle();const old=f.requests.find(r=>r.kind==='snapshot');f.update({...f.state,account:B,session:{address:B,expiresAt:NOW+3600000}});assert.equal(old.signal.aborted,true);old.resolve(snapshot());await f.settle();assert.doesNotMatch(f.text,/12\s+GOLD/);f.requests.filter(r=>r.kind==='snapshot').at(-1).resolve(snapshot({address:B,gold:'7'}));await f.settle();assert.match(f.text,/7\s+GOLD/);assert.doesNotMatch(f.text,/12\s+GOLD/);f.unmount();
});
test('expired login hides all displayed balances and preserves explicit sign-in',async()=>{const f=fixture();f.requests[0].resolve(enabled);await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot());await f.settle();f.time(NOW+3600000);assert.doesNotMatch(f.text,/12\s+GOLD/);const sign=f.nodes('button').find(b=>b.props.children==='登入 World 錢包');assert.ok(sign);sign.props.onClick();assert.equal(f.signedIn,1);f.unmount();});
test('halt retains balance and withdrawal while blocking new stakes and listing payments',async()=>{
 const f=fixture();f.requests[0].resolve(enabled);await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({positionsTruncated:true,chain:{block:'123',throughMs:NOW,haltedReason:'FINALIZED_CURSOR_CHANGED'}}));await f.settle();assert.match(f.text,/12\s+GOLD/);assert.match(f.text,/鏈上索引核對暫停/);assert.match(f.text,/200 筆/);assert.equal(f.nodes('button').find(b=>b.props.children==='核對質押').props.disabled,true);assert.equal(f.nodes('button').find(b=>b.props.children==='核對取回本金').props.disabled,false);f.nodes('button').find(b=>b.props.children==='核對取回本金').props.onClick();f.render();assert.equal(f.controllers[0].plans[0].kind,'withdraw');assert.equal(f.controllers[0].plans[0].shares,'2');assert.match(f.text,/取出部分今日不計 GOLD/);f.unmount();
});
test('unsynced chain is not described as an authoritative zero position and cannot accept new money',async()=>{const f=fixture();f.requests[0].resolve(enabled);await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({positions:[],chain:{block:'1',throughMs:0,haltedReason:null}}));await f.settle();assert.match(f.text,/不能視為沒有持倉/);assert.equal(f.nodes('button').find(b=>b.props.children==='核對質押').props.disabled,true);f.unmount();});
test('the pane prepares whole shares only after the player clicks and does not sign on mount',async()=>{const f=fixture();f.requests[0].resolve(enabled);await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot());await f.settle();assert.equal(f.controllers[0].plans.length,0);const input=f.nodes('input').find(n=>n.props.id==='economy-shares');input.props.onChange({target:{value:'2'}});f.render();f.nodes('button').find(b=>b.props.children==='核對質押').props.onClick();f.render();assert.deepEqual(JSON.parse(JSON.stringify(f.controllers[0].plans[0])),{kind:'stake',shares:'2'});assert.match(f.text,/200000\s+EMBEO/);assert.match(f.text,/確認質押 EMBEO/);assert.equal(f.walletReads,0);f.unmount();});
test('the actual server GOLD canonical builder and shipped client produce byte-identical text',()=>{
 const backend=readFileSync(new URL('../server/economy-ledger.ts',import.meta.url),'utf8'),compiled=ts.transpileModule(backend,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,exports={};
 vm.runInNewContext(compiled,{exports,require:()=>({}),Date,Error});const c={orderId:'0x'+'3'.repeat(64),requestId:'request_1234567890',wallet:A,nonce:'0x'+'4'.repeat(64),origin:'https://imdember.com',issuedMs:NOW,expiresMs:NOW+300000,amount:'2',serviceId:'local-test'};
 assert.equal(client.economyGoldMessage(c),exports.economyGoldMessage(c));
});
test('unmount aborts requests and removes timers, keyboard handlers and future state writes',async()=>{const f=fixture();f.unmount();assert.equal(f.requests[0].signal.aborted,true);f.requests[0].resolve(enabled);await f.settle();assert.equal(f.controllers.length,0);assert.equal(f.lateWrites,0);assert.equal(f.timers.size,0);assert.equal(f.keys.size,0);});
test('position-ID exit remains available through a truncated or unsynced halted ledger',async()=>{
 const f=fixture();f.requests[0].resolve(enabled);await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({positions:[],positionsTruncated:true,chain:{block:'1',throughMs:0,haltedReason:'FINALIZED_CURSOR_CHANGED'}}));await f.settle();
 assert.match(f.text,/原質押交易紀錄/);for(const [id,value]of [['economy-position-id','777'],['economy-manual-shares','1']]){f.nodes('input').find(n=>n.props.id===id).props.onChange({target:{value}});f.render();}
 const exit=f.nodes('button').find(b=>b.props.children==='核對指定持倉');assert.equal(exit.props.disabled,false);exit.props.onClick();f.render();assert.deepEqual(JSON.parse(JSON.stringify(f.controllers[0].plans[0])),{kind:'withdraw',positionId:'777',shares:'1'});assert.equal(f.nodes('button').find(b=>b.props.children==='確認取回本金').props.disabled,false);f.unmount();
});
const service={id:'local-test',titleZh:'測試服務',titleEn:'Test service',gold:'2',embeo:'1000000000000000000'};
const localOrder=(currency='GOLD',patch={})=>({id:'0x'+'3'.repeat(64),wallet:A,serviceId:'local-test',currency,amount:currency==='GOLD'?'2':service.embeo,status:'pending',createdMs:NOW,expiresMs:NOW+900000,paidMs:null,...patch});
async function commerceFixture(){const f=fixture();f.requests[0].resolve({...enabled,catalogue:[service]});await f.settle();f.requests.find(r=>r.kind==='snapshot').resolve(snapshot());await f.settle();return f;}

for(const language of ['zh','en'])for(const kind of ['pending','exception','mixed'])test(`Audit4 C06 ${language}/${kind}: payment status distinguishes pending delivery from exceptions without another payment request`,async()=>{
 const f=fixture({language});try{
  f.requests[0].resolve(enabled);await f.settle();
  const row={id:'pending-payment',transactionHash:'0x'+'f'.repeat(64),orderId:'0x'+'3'.repeat(64),actualAmount:String(10n**18n),expectedAmount:String(10n**18n),classification:'pending-fulfillment',createdMs:NOW,correctPaymentEvent:null,disposition:'unreviewed'};
  const exception={...row,id:'wrong-payment',classification:'wrong-amount'};
  const paymentCases=kind==='pending'?[row]:kind==='exception'?[exception]:[row,exception];
  f.requests.find(r=>r.kind==='snapshot').resolve(snapshot({paymentCases}));await f.settle();
  assert.doesNotMatch(f.text,/These payments grant no additional service|以下付款未取得額外服務/);
  assert.match(f.text,language==='zh'?/不會自動退款或重送/:/No automatic refund or resend/);
  if(kind!=='exception')assert.match(f.text,language==='zh'?/請勿重複付款/:/Please do not pay again/);
  if(kind!=='pending')assert.match(f.text,language==='zh'?/未符合訂單交付條件/:/does not meet the order/);
  assert.equal(f.requests.filter(r=>r.kind==='order').length,0);assert.equal(f.controllers[0].plans.length,0);
 }finally{f.unmount();}
});
test('a confirmed GOLD purchase creates a fresh order for the next explicit purchase',async()=>{
 const f=await commerceFixture();f.nodes('button').find(b=>/GOLD/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();const first=f.requests.find(r=>r.kind==='order');assert.ok(first);first.resolve({order:localOrder()});await f.settle();f.requests.find(r=>r.kind==='challenge').resolve({message:'fixed canonical fixture',expiresMs:NOW+300000});await f.settle();const pay=f.nodes('button').find(b=>b.props.children==='簽名確認 GOLD 付款');assert.equal(pay.props.disabled,false);pay.props.onClick();await f.settle();f.requests.filter(r=>r.kind==='snapshot').at(-1).resolve(snapshot({orders:[localOrder('GOLD',{status:'paid',paidMs:NOW})],gold:'10'}));await f.settle();assert.match(f.text,/GOLD 付款已完成/);
 f.nodes('button').find(b=>/GOLD/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();const second=f.requests.filter(r=>r.kind==='order').at(-1);assert.notEqual(first.requestId,second.requestId);f.unmount();
});
test('a network retry retains the original order request ID instead of duplicating a charge',async()=>{
 const f=await commerceFixture(),buy=()=>f.nodes('button').find(b=>/GOLD/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();buy();const first=f.requests.find(r=>r.kind==='order');first.reject(Error('network lost'));await f.settle();buy();const second=f.requests.filter(r=>r.kind==='order').at(-1);assert.equal(second.requestId,first.requestId);f.unmount();
});
test('an ORDER_EXPIRED response releases only the quote attempt so the next explicit service click can request a fresh quote',async()=>{
 const f=await commerceFixture(),buy=()=>f.nodes('button').find(b=>/GOLD/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();
 buy();const first=f.requests.find(r=>r.kind==='order');first.reject(new client.EconomyClientError('ORDER_EXPIRED'));await f.settle();assert.match(f.text,/訂單已到期/);
 buy();const next=f.requests.filter(r=>r.kind==='order').at(-1);assert.notEqual(next.requestId,first.requestId);assert.equal(f.controllers[0].plans.length,0);f.unmount();
});
test('an expired unpaid order needs a fresh server ledger check before clearing for a new quote',async()=>{
 const f=await commerceFixture(),buy=()=>f.nodes('button').find(b=>/GOLD/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();buy();const first=f.requests.find(r=>r.kind==='order'),old=localOrder('GOLD',{expiresMs:NOW+1000});first.resolve({order:old});await f.settle();f.requests.find(r=>r.kind==='challenge').resolve({message:'fixed canonical fixture',expiresMs:NOW+1000});await f.settle();f.time(NOW+1001);f.nodes('button').find(b=>b.props.children==='核對並清除到期訂單').props.onClick();await f.settle();f.requests.filter(r=>r.kind==='snapshot').at(-1).resolve(snapshot({orders:[old]}));await f.settle();assert.doesNotMatch(f.text,/這筆未付款訂單已到期/);buy();assert.notEqual(f.requests.filter(r=>r.kind==='order').at(-1).requestId,first.requestId);f.unmount();
});
test('an unknown EMBEO broadcast cannot be cleared or replaced with a blind new order',async()=>{
 const f=await commerceFixture();f.nodes('button').find(b=>/EMBEO/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();const o=localOrder('EMBEO',{expiresMs:NOW+1000});f.requests.find(r=>r.kind==='order').resolve({order:o,payment:{chainId:1,contract:PAY,token:client.ECONOMY_TOKEN,receiver:client.ECONOMY_TREASURY,orderId:o.id,amount:o.amount}});await f.settle();const c=f.controllers[0];c.state={...c.state,phase:'unknown',hash:'0x'+'9'.repeat(64)};for(const fn of c.listeners)fn();f.time(NOW+1001);assert.equal(f.nodes('button').find(b=>b.props.children==='核對並清除到期訂單').props.disabled,true);assert.equal(f.nodes('button').find(b=>/EMBEO/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.disabled,true);assert.equal(f.requests.filter(r=>r.kind==='order').length,1);f.unmount();
});
test('focus wraps within dialog and handled Escape is respected, then restores connected noninert controls',async()=>{const f=fixture();let prevented=0;const event=(key,extra={})=>({key,preventDefault(){prevented++;},stopPropagation(){},...extra});f.keys.get('keydown')(event('Escape',{defaultPrevented:true}));assert.equal(f.closed,0);f.document.activeElement=f.returnButton;f.keys.get('keydown')(event('Tab',{shiftKey:true}));f.document.activeElement=f.lastButton;f.keys.get('keydown')(event('Tab'));assert.equal(f.focus,3);f.keys.get('keydown')(event('Escape'));assert.equal(f.closed,1);assert.equal(prevented,3);f.unmount();assert.equal(f.restored,1);const inert=fixture({priorInert:true});inert.unmount();assert.equal(inert.restored,0);});


test('confirmed stake hides its changing estimate and retains the ledger position first day after a UTC rollover',async()=>{
 const longSession={...account(),session:{address:A,expiresAt:NOW+10*entry.ECONOMY_DAY_MS}},f=fixture({initial:longSession});
 f.requests[0].resolve(enabled);await f.settle();const recorded=snapshot();f.requests.find(r=>r.kind==='snapshot').resolve(recorded);await f.settle();
 f.nodes('button').find(b=>b.props.children==='核對質押').props.onClick();f.render();assert.match(f.text,/預計首個完整 UTC 日/);
 const c=f.controllers[0];c.state={...c.state,phase:'confirmed',step:'execute',hash:'0x'+'9'.repeat(64)};for(const notify of c.listeners)notify();f.render();
 assert.doesNotMatch(f.text,/預計首個完整 UTC 日|預計首次產出/);assert.match(f.text,/鏈上交易已確認/);
 const positionFirstDay=entry.economyUtc(entry.firstEconomyDay(recorded.positions[0].depositedMs));assert.ok(f.text.includes(positionFirstDay));
 f.time(NOW+3*entry.ECONOMY_DAY_MS);assert.ok(f.state.session.expiresAt>NOW+3*entry.ECONOMY_DAY_MS,'a still-live session prevents a false pass caused by hiding the whole pane');
 assert.doesNotMatch(f.text,/預計首個完整 UTC 日|預計首次產出/);assert.ok(f.text.includes(positionFirstDay));assert.match(f.text,/鏈上交易已確認/);f.unmount();
});

test('hashed unknown transactions retain an editable replacement candidate and never offer a blind clear',async()=>{
 const f=await commerceFixture(),c=f.controllers[0],original='0x'+'8'.repeat(64),candidate='0x'+'9'.repeat(64);
 c.state={...c.state,phase:'unknown',hash:original,step:'execute'};f.render();
 assert.ok(f.nodes('input').find(n=>n.props.id==='economy-original-hash'));assert.equal(f.nodes('input').some(n=>n.props.type==='checkbox'),false);
 const input=f.nodes('input').find(n=>n.props.id==='economy-original-hash');input.props.onChange({target:{value:candidate}});f.render();f.nodes('button').find(n=>n.props.children==='只核對這筆交易').props.onClick();
 assert.deepEqual(c.receiptCandidates,[candidate]);assert.ok(f.text.includes(original));assert.match(f.text,/貼錯不會改寫原紀錄/);assert.equal(f.nodes('button').find(n=>n.props.children==='核對取回本金').props.disabled,true);
 c.state={...c.state,error:'TRANSACTION_NOT_FINALIZED'};f.render();assert.match(f.text,/等待最終確認/);assert.equal(f.nodes('input').find(n=>n.props.id==='economy-original-hash').props.value,candidate);assert.ok(f.text.includes(original));f.unmount();
});
test('legacy hashed unknown transactions clearly label their manual acknowledgement without an automatic success claim',async()=>{
 const f=await commerceFixture(),c=f.controllers[0];c.state={...c.state,phase:'unknown',hash:'0x'+'8'.repeat(64),legacyPending:true};f.render();assert.match(f.text,/舊版紀錄/);assert.match(f.text,/無法自動證明/);assert.doesNotMatch(f.text,/鏈上交易已確認/);
 const acknowledgement=f.nodes('button').find(n=>n.props.children==='人工確認並解除舊版防重');assert.equal(acknowledgement.props.disabled,true);f.nodes('input').find(n=>n.props.type==='checkbox').props.onChange({target:{checked:true}});f.render();f.nodes('button').find(n=>n.props.children==='人工確認並解除舊版防重').props.onClick();assert.equal(c.acknowledgements,1);assert.equal(c.plans.length,0);f.unmount();
});
test('a proven replacement reopens principal withdrawal and expired-order review without claiming the original payment succeeded',async()=>{
 const f=await commerceFixture();f.nodes('button').find(b=>/EMBEO/.test(String(b.props.children))&&Array.isArray(b.props.children)).props.onClick();const o=localOrder('EMBEO',{expiresMs:NOW+1000});f.requests.find(r=>r.kind==='order').resolve({order:o,payment:{chainId:1,contract:PAY,token:client.ECONOMY_TOKEN,receiver:client.ECONOMY_TREASURY,orderId:o.id,amount:o.amount}});await f.settle();
 const c=f.controllers[0];c.state={...c.state,phase:'replaced',hash:'0x'+'9'.repeat(64),error:'TRANSACTION_REPLACED'};f.time(NOW+1001);assert.match(f.text,/這不代表原本的質押或付款成功/);assert.doesNotMatch(f.text,/鏈上交易已確認/);assert.equal(f.nodes('button').find(n=>n.props.children==='核對取回本金').props.disabled,false);assert.equal(f.nodes('button').find(n=>n.props.children==='核對並清除到期訂單').props.disabled,false);assert.equal(c.receiptCandidates.length,0);f.unmount();
});
