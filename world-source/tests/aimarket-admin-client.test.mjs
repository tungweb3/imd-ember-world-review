import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {fetchAIMarketAdminStatus} from '../src/world/aimarketAdmin.ts';
import * as entry from '../src/world/aimarketEntry.ts';
import * as messages from '../src/world/aimarketMessages.ts';
import {INITIAL,statusOf,noticeText} from '../src/world/auth.ts';
import {researchPresentationOrigin} from '../src/world/portalPresentation.ts';

const ADDRESS='0x30E3E579E7EAe086E6D53999f95FAC5933e4D0AA',OTHER='0x18D85dBdDf15b38dCE122afFFb3356424dfEe653';
const session={address:ADDRESS,expiresAt:2000};
const grant=(address=ADDRESS,expiresAt=2000)=>({address,expiresAt,role:'aimarket:trial:manage',canManageFreeTrial:true});
const response=(body,status=200)=>({status,json:async()=>body});

test('admin client sends only a fixed same-origin credentialed GET bound to the current wallet session',async()=>{
 const controller=new AbortController(),calls=[];
 const result=await fetchAIMarketAdminStatus(session,{now:()=>1000,signal:controller.signal,fetch:async(...args)=>{calls.push(args);return response(grant(ADDRESS.toLowerCase()));}});
 assert.deepEqual(result,grant(ADDRESS.toLowerCase()));assert.equal(calls.length,1);
 const [url,options]=calls[0],parsed=new URL(url,'https://imdember.com');
 assert.equal(parsed.origin,'https://imdember.com');assert.equal(parsed.pathname,'/api/me/aimarket-admin');
 assert.deepEqual([...parsed.searchParams.keys()],['expected_address']);assert.equal(parsed.searchParams.get('expected_address').toLowerCase(),ADDRESS.toLowerCase());
 assert.equal(options.method,'GET');assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert.equal(options.signal,controller.signal);
 assert.equal(options.body,undefined);
});

test('admin client rejects unsuccessful responses, malformed JSON, and transport failures',async()=>{
 for(const status of [201,204,301,401,403,500])assert.equal(await fetchAIMarketAdminStatus(session,{now:()=>1000,fetch:async()=>response(grant(),status)}),null,`HTTP ${status}`);
 for(const failure of [async()=>{throw new TypeError('offline');},async()=>({status:200,json:async()=>{throw new SyntaxError('invalid JSON');}}),async()=>{throw new DOMException('cancelled','AbortError');}]){
  assert.equal(await fetchAIMarketAdminStatus(session,{now:()=>1000,fetch:failure}),null);
 }
});

test('admin client accepts only the complete four-field owner response for the exact session',async()=>{
 const valid=grant();
 const invalid=[null,[],true,'owner',{},Object.fromEntries(Object.entries(valid).filter(([key])=>key!=='role')),
  {...valid,admin:true},{...valid,url:'https://evil.invalid'},{...valid,address:OTHER},{...valid,address:'0x123'},
  {...valid,expiresAt:2001},{...valid,expiresAt:'2000'},{...valid,expiresAt:1000},{...valid,expiresAt:NaN},
  {...valid,expiresAt:Infinity},{...valid,expiresAt:Number.MAX_SAFE_INTEGER+1},{...valid,expiresAt:2000.5},
  {...valid,role:'owner'},{...valid,role:['aimarket:trial:manage']},{...valid,canManageFreeTrial:false},
  {...valid,canManageFreeTrial:1},{...valid,canManageFreeTrial:'true'}];
 for(const body of invalid)assert.equal(await fetchAIMarketAdminStatus(session,{now:()=>1000,fetch:async()=>response(body)}),null,JSON.stringify(body));
});

test('admin client never grants an expired or invalid session, including expiry while awaiting the server',async()=>{
 for(const expiresAt of [1000,999,NaN,Infinity,2000.5,Number.MAX_SAFE_INTEGER+1]){
  assert.equal(await fetchAIMarketAdminStatus({...session,expiresAt},{now:()=>1000,fetch:async()=>response(grant(ADDRESS,expiresAt))}),null,String(expiresAt));
 }
 let now=1000;
 assert.equal(await fetchAIMarketAdminStatus(session,{now:()=>now,fetch:async()=>{now=2000;return response(grant());}}),null);
});

test('admin client rejects clock errors and cancellation even when a transport still resolves successfully',async()=>{
 for(const clock of [()=>{throw new Error('clock unavailable');},()=>NaN,()=>Infinity,()=>0,()=>1000.5]){
  assert.equal(await fetchAIMarketAdminStatus(session,{now:clock,fetch:async()=>response(grant())}),null);
 }
 let reads=0;assert.equal(await fetchAIMarketAdminStatus(session,{now:()=>++reads===1?1000:999,fetch:async()=>response(grant())}),null);
 for(const phase of ['fetch','json']){
  const controller=new AbortController();
  assert.equal(await fetchAIMarketAdminStatus(session,{now:()=>1000,signal:controller.signal,fetch:async()=>{
   if(phase==='fetch')controller.abort();
   return {status:200,json:async()=>{if(phase==='json')controller.abort();return grant();}};
  }}),null,`cancelled during ${phase}`);
 }
});

test('admin client snapshots the requested session against caller mutation while awaiting a response',async()=>{
 const mutable={...session};let complete;
 const result=fetchAIMarketAdminStatus(mutable,{now:()=>1000,fetch:()=>new Promise(resolve=>{complete=resolve;})});
 mutable.address=OTHER;mutable.expiresAt=3000;complete(response(grant()));
 assert.deepEqual(await result,grant(ADDRESS.toLowerCase()));
});

// Execute the actual shipped component. This small React adapter preserves state,
// dependency changes, effect cleanup, and explicit re-renders so stale promises
// exercise the component's real lifecycle rather than a copied access model.
const source=readFileSync(new URL('../src/world/AIMarketPane.tsx',import.meta.url),'utf8');
const product=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({language='zh'}={}){
 const hooks=[],requests=[],handlers=new Map(),timers=new Map();let cursor=0,refCursor=0,current=1000,timerId=0,tree,pending=[],dirty=false,mounted=true,lateWrites=0;
 let state={...INITIAL,sessionKnown:true,session:{...session}},props;
 const frameWindow={postMessage(){}},host={querySelector(){return {focus(){}};}};
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
 const react={
  useRef(initial){const refIndex=refCursor++,index=cursor++;return hooks[index]??=( {current:refIndex===0?host:refIndex===1?{contentWindow:frameWindow}:initial});},
  useState(initial){const index=cursor++;if(!hooks[index])hooks[index]={value:typeof initial==='function'?initial():initial};const slot=hooks[index];return [slot.value,next=>{if(!mounted)lateWrites++;const value=typeof next==='function'?next(slot.value):next;if(!Object.is(value,slot.value)){slot.value=value;dirty=true;}}];},
  useCallback(fn,deps){const index=cursor++;if(!hooks[index]||!same(hooks[index].deps,deps))hooks[index]={deps,fn};return hooks[index].fn;},
  useEffect(fn,deps){const index=cursor++,old=hooks[index];if(!old||!same(old.deps,deps)){const slot={deps,cleanup:old?.cleanup};hooks[index]=slot;pending.push(()=>{slot.cleanup?.();slot.cleanup=fn();});}},
  useSyncExternalStore(_subscribe,getSnapshot){cursor++;return getSnapshot();}
 };
 const registry={subscribe(){},state:{options:[],needsChoice:false},choose(){}};
 const window={addEventListener(name,fn){handlers.set(name,fn);},removeEventListener(name,fn){if(handlers.get(name)===fn)handlers.delete(name);},open(){return {};}};
 const document={activeElement:null,addEventListener(){},removeEventListener(){}};
 const schedule=(fn,repeat)=>{const id=++timerId;timers.set(id,{fn,repeat});return id;};
 const exports={},require=name=>{
  if(name==='react')return react;if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name==='./aimarketAdmin.ts')return {fetchAIMarketAdminStatus:(identity,options)=>new Promise(resolve=>requests.push({identity:{...identity},options,resolve}))};
  if(name==='./aimarketTrial.ts')return {fetchAIMarketTrialStatus:async()=>null};
  if(name==='./aimarketEntry.ts')return entry;if(name==='./aimarketMessages.ts')return messages;if(name==='./auth.ts')return {statusOf,noticeText};
  if(name==='./portalPresentation.ts')return {researchPresentationOrigin};if(name==='./wallet.ts')return {wallets:()=>registry};
  if(name==='./aimarketPane.css')return {};throw Error('Unbound product import '+name);
 };
 vm.runInNewContext(product,{exports,require,window,document,AbortController,navigator:{userActivation:{isActive:true}},location:{hostname:'imdember.com',port:'',search:'',origin:'https://imdember.com'},Date:{now:()=>current},
  setInterval:fn=>schedule(fn,true),clearInterval:id=>timers.delete(id),setTimeout:fn=>schedule(fn,false),clearTimeout:id=>timers.delete(id)});
 const render=()=>{cursor=0;refCursor=0;pending=[];dirty=false;tree=exports.AIMarketPane(props);const first=tree;for(const effect of pending)effect();return first;};
 const flush=()=>{for(let turn=0;dirty;turn++){assert.ok(turn<12,'component effects should settle');render();}};
 const text=node=>node===null||node===undefined||typeof node==='boolean'?'':typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(' '):text(node.props?.children);
 const update=next=>{state=next;props={state,language,onSignIn(){},onClose(){}};const first=render();flush();return text(first);};
 update(state);
 return {requests,update,get state(){return state;},get text(){return text(tree);},get lateWrites(){return lateWrites;},
  async settle(){await new Promise(resolve=>setImmediate(resolve));flush();},
  time(next){current=next;for(const timer of [...timers.values()])if(timer.repeat)timer.fn();flush();},
  unmount(){mounted=false;for(const slot of hooks)slot?.cleanup?.();}
 };
}
const ownerShown=text=>/站主後台：免費活動起訖|Admin: free-trial schedule/i.test(text);

test('actual pane shows the trial-admin entry only after the current server response',async()=>{
 const f=fixture();assert.equal(f.requests.length,1);assert.equal(ownerShown(f.text),false);
 assert.equal(f.requests[0].identity.address,ADDRESS);assert.equal(f.requests[0].options.signal.aborted,false);
 f.requests[0].resolve(grant());await f.settle();assert.equal(ownerShown(f.text),true);
 assert.match(f.text,/站主後台：免費活動起訖/);assert.doesNotMatch(f.text,/立即結束|延長活動|開始免費/);
 const ordinary=fixture();ordinary.requests[0].resolve(null);await ordinary.settle();assert.equal(ownerShown(ordinary.text),false);
 const english=fixture({language:'en'});english.requests[0].resolve(grant());await english.settle();assert.equal(ownerShown(english.text),true);assert.match(english.text,/Admin: free-trial schedule/);
});

test('actual pane immediately hides an accepted old owner when the wallet changes and ignores its late response',async()=>{
 const f=fixture();f.requests[0].resolve(grant());await f.settle();assert.equal(ownerShown(f.text),true);
 const first=f.update({...f.state,account:OTHER,session:{address:OTHER,expiresAt:2000}});
 assert.equal(ownerShown(first),false,'identity render guard must hide the old owner before effects run');assert.equal(ownerShown(f.text),false);
 assert.equal(f.requests[0].options.signal.aborted,true);assert.equal(f.requests.length,2);
 f.requests[1].resolve(grant(OTHER));await f.settle();assert.equal(ownerShown(f.text),true);
 const pending=fixture();pending.update({...pending.state,account:OTHER,session:{address:OTHER,expiresAt:2000}});
 pending.requests[0].resolve(grant());await pending.settle();assert.equal(ownerShown(pending.text),false,'aborted previous request may still resolve');
 pending.requests[1].resolve(null);await pending.settle();assert.equal(ownerShown(pending.text),false);
});

test('actual pane cancels owner lookup on logout and cannot restore the badge from a late owner response',async()=>{
 const f=fixture();f.update({...INITIAL,sessionKnown:true});assert.equal(f.requests[0].options.signal.aborted,true);
 f.requests[0].resolve(grant());await f.settle();assert.equal(ownerShown(f.text),false);assert.equal(f.requests.length,1);
});

test('actual pane hides owner status immediately when the connected wallet no longer matches the World session',async()=>{
 const f=fixture();f.requests[0].resolve(grant());await f.settle();assert.equal(ownerShown(f.text),true);
 assert.equal(ownerShown(f.update({...f.state,account:OTHER})),false);assert.equal(ownerShown(f.text),false);assert.equal(f.requests.length,1);
});

test('actual pane removes an owner at expiry and rejects a pending lookup that resolves after expiry',async()=>{
 const f=fixture();f.requests[0].resolve(grant());await f.settle();assert.equal(ownerShown(f.text),true);
 f.time(2000);assert.equal(ownerShown(f.text),false);
 const pending=fixture();pending.time(2001);assert.equal(pending.requests[0].options.signal.aborted,true);
 pending.requests[0].resolve(grant());await pending.settle();assert.equal(ownerShown(pending.text),false);
});

test('actual pane cleanup prevents a resolved owner lookup from writing state after unmount',async()=>{
 const f=fixture();f.unmount();assert.equal(f.requests[0].options.signal.aborted,true);
 f.requests[0].resolve(grant());await f.settle();assert.equal(f.lateWrites,0);
});
