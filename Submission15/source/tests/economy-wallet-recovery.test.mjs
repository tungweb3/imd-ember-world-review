import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL} from '../src/world/auth.ts';
import {EconomyWalletController,encodeEconomyCall,localEconomyLock,ECONOMY_EFFECT_TOPICS} from '../src/world/economyWallet.ts';
import {keccak256,stringToHex} from 'viem';
import {ECONOMY_TOKEN,ECONOMY_TREASURY,SHARE_WEI} from '../src/world/economyClient.ts';

const A='0x'+'a'.repeat(40),VAULT='0x'+'1'.repeat(40),PAY='0x'+'2'.repeat(40),HASH='0x'+'3'.repeat(64),OTHER='0x'+'4'.repeat(64),BLOCK='0x'+'5'.repeat(64),NOW=Date.UTC(2026,9,16);
const config={enabled:true,chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:VAULT,paymentContract:PAY,treasury:ECONOMY_TREASURY,shareTokens:'100000',shareWei:String(SHARE_WEI),rule:'utc-full-day-v1',goldTransferable:false,catalogue:[]};
const word=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),address=a=>'0x'+a.slice(2).padStart(64,'0');
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function mutex(){let tail=Promise.resolve();return {run(_key,fn){const run=tail.then(fn,fn);tail=run.catch(()=>{});return run;}};}
function fixture({lost=false,lock=mutex(),store=new Map(),legacy=null}={}){
 const auth={...INITIAL,account:A,session:{address:A,expiresAt:NOW+3600000},sessionKnown:true,restored:true},calls=[],sent=[];let candidate=null,finalized=true,intercept=null;
 const provider={on(){},removeListener(){},async request(args){
  calls.push(args);if(intercept){const value=intercept(args);if(value!==undefined)return value;}
  const {method,params}=args;
  if(method==='eth_accounts')return [A];if(method==='eth_chainId')return '0x1';if(method==='eth_getTransactionCount')return '0x8';
  if(method==='eth_call'){
   const selector=params[0].data.slice(2,10);
   if(selector==='fc0c546a')return address(ECONOMY_TOKEN);
   if(selector==='10a223e7')return word(SHARE_WEI);
   if(selector==='70a08231'||selector==='dd62ed3e')return word(10n*SHARE_WEI);
   if(selector==='99fbab88')return address(A)+word(3n).slice(2);
   if(selector==='61d027b3')return address(ECONOMY_TREASURY);
   if(selector==='e9c1121e')return word(0n);
   throw Error('unexpected selector '+selector);
  }
  if(method==='eth_sendTransaction'){sent.push(params[0]);if(lost)throw Error('lost response');return HASH;}
  if(method==='eth_getTransactionReceipt')return candidate&&params[0]===candidate.hash?{transactionHash:candidate.hash,from:A,to:candidate.to,status:candidate.status??'0x1',blockHash:BLOCK,blockNumber:'0x20',logs:candidate.logs??[]}:null;
  if(method==='eth_getTransactionByHash')return candidate&&params[0]===candidate.hash?{from:A,to:candidate.to,input:candidate.input,value:'0x0',chainId:'0x1',nonce:candidate.nonce,hash:candidate.hash,blockHash:BLOCK,blockNumber:'0x20',...candidate.patch}:null;
  if(method==='eth_getBlockByNumber')return {number:params[0]==='finalized'&&!finalized?'0x1f':'0x20',hash:BLOCK};
  throw Error('unexpected RPC '+method);
 }};
 const deps={config,auth:()=>auth,provider:()=>provider,now:()=>NOW,lock,pending:{get:k=>store.get(k),set:(k,v)=>v?store.set(k,structuredClone(v)):store.delete(k)},fetch:async path=>({status:200,json:async()=>path==='/api/auth/session'?{signedIn:true,...auth.session}:config}),receiptAttempts:1,delay:async()=>{}};
 const controller=new EconomyWalletController(deps);
 if(legacy){const key='ember-economy-pending:1:'+VAULT+':'+PAY+':'+A;store.set(key,{chainId:1,from:A,to:VAULT,data:encodeEconomyCall('deposit',[1n]),hash:null,step:'execute',intentId:'legacy_intent_12345',createdMs:NOW,...legacy});controller.restorePending();}
 return {controller,deps,store,calls,sent,candidate(value){candidate=value;},set finalized(value){finalized=value;},intercept(value){intercept=value;}};
}

test('new sends bind and persist a pending nonce plus chain ID before the wallet prompt',async()=>{
 const f=fixture();await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].nonce,'0x8');assert.equal(f.sent[0].chainId,'0x1');
 assert.equal([...f.store.values()][0].nonce,'0x8');assert.equal([...f.store.values()][0].version,2);
 assert.deepEqual(f.calls.find(c=>c.method==='eth_getTransactionCount').params,[A,'pending']);f.controller.dispose();
});
// A smart-account wallet (EIP-7702, MetaMask) runs the call through its own delegation contract: the mined transaction's
// `to`/input differ from the request although the call ran (owner's first real top-up, 2026-10-26).
const DELEGATION='0x'+'d'.repeat(40),OID='0x'+'7'.repeat(64),pad=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
const T=ECONOMY_EFFECT_TOPICS,routed=(logs,patch={})=>({hash:HASH,to:DELEGATION,input:'0xcef6d209'+'0'.repeat(64),nonce:'0x8',logs,...patch});
const effect={
 staked:shares=>({address:VAULT,topics:[T.staked,pad(A),word(9n)],data:word(shares)+word(shares*SHARE_WEI).slice(2)}),
 approval:(spender,amount)=>({address:ECONOMY_TOKEN,topics:[T.approval,pad(A),pad(spender)],data:word(amount)}),
 paid:(orderId,amount)=>({address:PAY,topics:[T.paid,orderId,pad(A),pad(ECONOMY_TOKEN)],data:pad(ECONOMY_TREASURY)+word(amount).slice(2)}),
};
const payPlan=()=>({kind:'pay',payment:{chainId:1,contract:PAY,token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY,orderId:OID,amount:'1000'},expiresMs:NOW+600000,serviceTitle:'gold-100'});
test('effect topics are the keccak of the reviewed event signatures',()=>{
 assert.deepEqual(T,{approval:keccak256(stringToHex('Approval(address,address,uint256)')),paid:keccak256(stringToHex('Paid(bytes32,address,address,address,uint256)')),
  staked:keccak256(stringToHex('Staked(address,uint256,uint256,uint256)')),withdrawn:keccak256(stringToHex('Withdrawn(address,uint256,uint256,uint256)'))});
});
test('smart-account routed stake, approval and payment count as done when the receipt proves the exact intended effect',async()=>{
 {const f=fixture();await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();assert.equal(f.controller.state.hash,HASH);
  f.candidate(routed([effect.staked(1n)]));await f.controller.checkReceipt();
  assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.controller.state.error,null);assert.equal(f.store.size,0);f.controller.dispose();}
 {const f=fixture();let allowance=0n;f.intercept(a=>a.method==='eth_call'&&a.params[0].data.slice(2,10)==='dd62ed3e'?word(allowance):undefined);
  await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.controller.state.phase,'approve-required');await f.controller.approve();
  f.candidate(routed([effect.approval(VAULT,SHARE_WEI)]));allowance=SHARE_WEI;await f.controller.checkReceipt();
  assert.equal(f.controller.state.phase,'confirm','after the approval the page moves on to the payment/stake step');assert.equal(f.store.size,0);f.controller.dispose();}
 {const f=fixture();await f.controller.prepare(payPlan());assert.equal(f.controller.state.phase,'confirm');await f.controller.confirm();
  assert.equal(f.sent[0].to,PAY.toLowerCase());f.candidate(routed([{address:ECONOMY_TOKEN,topics:['0x'+'e'.repeat(64)],data:'0x'},effect.paid(OID,1000n)]));
  await f.controller.checkReceipt();assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.controller.state.error,null);assert.equal(f.store.size,0);f.controller.dispose();}
});
test('a routed transaction without exactly the intended effect is never taken as done',async()=>{
 const wrong={
  sender:{...effect.paid(OID,1000n),topics:[T.paid,OID,pad('0x'+'4'.repeat(40)),pad(ECONOMY_TOKEN)]},
  order:effect.paid('0x'+'8'.repeat(64),1000n),
  amount:effect.paid(OID,999n),
  contract:{...effect.paid(OID,1000n),address:'0x'+'9'.repeat(40)},
  token:{...effect.paid(OID,1000n),topics:[T.paid,OID,pad(A),pad('0x'+'5'.repeat(40))]},
  receiver:{...effect.paid(OID,1000n),data:pad('0x'+'6'.repeat(40))+word(1000n).slice(2)},
  event:{...effect.paid(OID,1000n),topics:[T.staked,OID,pad(A),pad(ECONOMY_TOKEN)]},
 };
 for(const [name,log] of Object.entries({...wrong,'no log':null})){
  const f=fixture();await f.controller.prepare(payPlan());await f.controller.confirm();
  f.candidate(routed(log?[log]:[]));await f.controller.checkReceipt();
  assert.notEqual(f.controller.state.phase,'confirmed',name);assert.equal(f.controller.state.error,'TRANSACTION_REPLACED',name);f.controller.dispose();
 }
 // The wallet's own routed hash that reverted is the reverted send itself: judged at once, before finality, like a
 // direct one (Swarm audit 12e0525d L-1: it used to wait for finality and then read "replaced").
 for(const final of [false,true]){
  const f=fixture();await f.controller.prepare(payPlan());await f.controller.confirm();f.finalized=final;
  f.candidate(routed([],{status:'0x0'}));await f.controller.checkReceipt();   // a reverted receipt carries no logs
  assert.deepEqual({phase:f.controller.state.phase,error:f.controller.state.error},{phase:'error',error:'TRANSACTION_REVERTED'},'finalized '+final);
  assert.equal(f.store.size,0,'the intent is resolved');f.controller.dispose();
 }
 {const f=fixture();await f.controller.prepare(payPlan());await f.controller.confirm();f.finalized=false;
  f.candidate(routed([effect.paid(OID,1000n)],{status:'0x0',hash:OTHER}));await f.controller.checkReceipt(OTHER);
  assert.equal(f.controller.state.error,'TRANSACTION_NOT_FINALIZED','a pasted hash that reverted still waits for finality');f.controller.dispose();}
 // and a pasted hash of another routed transaction never gets the shortcut, even with a matching effect
 const f=fixture();await f.controller.prepare(payPlan());await f.controller.confirm();
 f.candidate(routed([effect.paid(OID,1000n)],{hash:OTHER}));await f.controller.checkReceipt(OTHER);
 assert.notEqual(f.controller.state.phase,'confirmed');
 // The crediting note is found by the hash the payment was sent with, not by the pasted one (review of 2aeac71).
 assert.equal(f.controller.state.hash,OTHER);assert.equal(f.controller.state.sentHash,HASH);f.controller.dispose();
});
test('a delegated batch that also did something else of the same kind for this sender is not "exactly" the intended effect',async()=>{
 // Swarm audit e4a57f91 I-8: one matching log among others used to be enough.
 const MAX=2n**256n-1n;
 for(const [name,extra] of [['opposite approval',effect.approval(VAULT,0n)],['approval to another spender',effect.approval('0x'+'3'.repeat(40),MAX)]]){
  const f=fixture();let allowance=0n;f.intercept(a=>a.method==='eth_call'&&a.params[0].data.slice(2,10)==='dd62ed3e'?word(allowance):undefined);
  await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.approve();
  f.candidate(routed([effect.approval(VAULT,SHARE_WEI),extra]));allowance=SHARE_WEI;await f.controller.checkReceipt();
  assert.notEqual(f.controller.state.phase,'confirm',name);assert.equal(f.controller.state.error,'TRANSACTION_REPLACED',name);f.controller.dispose();
 }
 const f=fixture();await f.controller.prepare(payPlan());await f.controller.confirm();
 f.candidate(routed([effect.paid(OID,1000n),effect.paid('0x'+'8'.repeat(64),1000n)]));await f.controller.checkReceipt();
 assert.notEqual(f.controller.state.phase,'confirmed','a second payment by this sender in the same batch');f.controller.dispose();
 // Another sender's event of the same kind in the batch does not count against this one.
 const g=fixture();await g.controller.prepare(payPlan());await g.controller.confirm();
 g.candidate(routed([effect.paid(OID,1000n),{...effect.paid('0x'+'8'.repeat(64),5n),topics:[T.paid,'0x'+'8'.repeat(64),pad('0x'+'4'.repeat(40)),pad(ECONOMY_TOKEN)]}]));await g.controller.checkReceipt();
 assert.equal(g.controller.state.phase,'confirmed');g.controller.dispose();
});
test('a smart-account routed withdrawal counts as done only with exactly its Withdrawn event (position, shares, sender)',async()=>{
 // EmbeoStakingVault: Withdrawn(address indexed player, uint256 indexed positionId, uint256 shares, uint256 amount).
 const withdrawn=(pos,shares,player=A)=>({address:VAULT,topics:[T.withdrawn,pad(player),word(pos)],data:word(shares)+word(shares*SHARE_WEI).slice(2)});
 const run=async logs=>{const f=fixture();await f.controller.prepare({kind:'withdraw',positionId:'1',shares:'1'});await f.controller.confirm();
  f.candidate(routed(logs));await f.controller.checkReceipt();const s={phase:f.controller.state.phase,error:f.controller.state.error};f.controller.dispose();return s;};
 assert.deepEqual(await run([{address:ECONOMY_TOKEN,topics:['0x'+'e'.repeat(64)],data:'0x'},withdrawn(1n,1n)]),{phase:'confirmed',error:null});
 for(const [name,logs] of [['other position',[withdrawn(2n,1n)]],['other shares',[withdrawn(1n,2n)]],['other player',[withdrawn(1n,1n,'0x'+'4'.repeat(40))]],
  ['two withdrawals',[withdrawn(1n,1n),withdrawn(2n,1n)]],['stake instead',[effect.staked(1n)]],['nothing',[]]]){
  const s=await run(logs);assert.notEqual(s.phase,'confirmed',name);assert.equal(s.error,'TRANSACTION_REPLACED',name);
 }
});
test('a new sign-in while the wallet prompt is open still shows the broadcast hash and offers the check',async()=>{
 const f=fixture();await f.controller.prepare({kind:'stake',shares:'1'});
 f.intercept(a=>{if(a.method!=='eth_sendTransaction')return undefined;const s=f.deps.auth();s.session={...s.session,expiresAt:s.session.expiresAt+1};f.sent.push(a.params[0]);return HASH;});
 await f.controller.confirm();
 assert.equal(f.controller.state.phase,'unknown');assert.equal(f.controller.state.error,'CONTEXT_CHANGED');
 assert.equal(f.controller.state.hash,HASH,'the hash is visible, so the panel offers "check original transaction"');
 assert.equal([...f.store.values()][0].hash,HASH);f.controller.dispose();
});
// MetaMask answers eth_getTransactionByHash from its own copy while it still lists the transaction as pending: no block,
// no chain ID, even when the network already has the receipt (the owner's first top-up showed TRANSACTION_MISMATCH).
const walletCopy={chainId:undefined,blockHash:null,blockNumber:null};
test('a mined payment the wallet still lists as pending is polled again, never called a mismatch',async()=>{
 {const f=fixture();await f.controller.prepare(payPlan());await f.controller.confirm();const sent=f.sent[0];
  f.candidate({hash:HASH,to:sent.to,input:sent.data,nonce:'0x8',patch:walletCopy});await f.controller.checkReceipt();
  assert.equal(f.controller.state.phase,'unknown');assert.equal(f.controller.state.error,'PENDING_TRANSACTION');assert.equal(f.controller.state.hash,HASH);assert.equal(f.store.size,1,'the intent stays protected');
  f.candidate({hash:HASH,to:sent.to,input:sent.data,nonce:'0x8'});await f.controller.checkReceipt();
  assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.controller.state.error,null);assert.equal(f.store.size,0);f.controller.dispose();}
 {const f=fixture();f.deps.receiptAttempts=3;await f.controller.prepare(payPlan());await f.controller.confirm();const sent=f.sent[0];let lag=1;
  f.intercept(a=>a.method==='eth_getTransactionByHash'&&lag-->0?{hash:HASH,from:A,to:sent.to,input:sent.data,value:'0x0',nonce:'0x8',...walletCopy}:undefined);
  f.candidate(routed([effect.paid(OID,1000n)]));await f.controller.checkReceipt();
  assert.equal(f.controller.state.phase,'confirmed','the next poll sees the network record, here a smart-account route');assert.equal(f.store.size,0);f.controller.dispose();}
 {const f=fixture({lost:true});await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
  f.candidate({hash:OTHER,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x8',patch:{...walletCopy,blockHash:BLOCK}});await f.controller.checkReceipt(OTHER);
  assert.equal(f.controller.state.error,'TRANSACTION_MISMATCH','a record with a block but no chain ID is still refused');assert.equal(f.store.size,1);f.controller.dispose();}
});
test('MetaMask pending count as a JSON number (45) still reaches the wallet prompt, as quantity 0x2d, for approve and pay alike',async()=>{
 for(const step of ['approve','execute']){
  const f=fixture();f.intercept(args=>args.method==='eth_getTransactionCount'?45:args.method==='eth_call'&&args.params[0].data.slice(2,10)==='dd62ed3e'&&step==='approve'?word(0):undefined);
  await f.controller.prepare({kind:'stake',shares:'1'});
  if(step==='approve'){assert.equal(f.controller.state.phase,'approve-required');await f.controller.approve();}else await f.controller.confirm();
  assert.equal(f.sent.length,1,step);assert.equal(f.sent[0].nonce,'0x2d',step);assert.equal([...f.store.values()][0].nonce,'0x2d',step);
  assert.notEqual(f.controller.state.error,'INVALID_CHAIN_RESPONSE',step);f.controller.dispose();
 }
});
test('a malformed numeric pending count is refused before any wallet prompt and leaves no send intent',async()=>{
 for(const bad of [-1,1.5,Number.NaN,Number.MAX_SAFE_INTEGER+2,2**64,'45','0x08','0X2D',null]){
  const f=fixture();f.intercept(args=>args.method==='eth_getTransactionCount'?bad:undefined);
  await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
  assert.equal(f.sent.length,0,String(bad));assert.equal(f.store.size,0,String(bad));assert.equal(f.controller.state.error,'INVALID_CHAIN_RESPONSE',String(bad));f.controller.dispose();
 }
});
test('a finalized same-nonce cancellation resolves the old intent without claiming the stake succeeded and restores withdrawal',async()=>{
 const f=fixture();await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
 f.candidate({hash:OTHER,to:A,input:'0x',nonce:'0x8'});await f.controller.checkReceipt(OTHER);
 assert.equal(f.controller.state.phase,'replaced');assert.equal(f.store.size,0);assert.equal(f.sent.length,1);
 await f.controller.prepare({kind:'withdraw',positionId:'1',shares:'1'});assert.equal(f.controller.state.phase,'confirm');assert.equal(f.sent.length,1);f.controller.dispose();
});
test('an unconfirmed or wrong candidate never changes a hashless intent or destroys its acknowledgement path',async()=>{
 const f=fixture({lost:true});await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
 await f.controller.checkReceipt(OTHER);assert.equal([...f.store.values()][0].hash,null);assert.equal(f.controller.state.hash,null);
 await f.controller.clearUnknownAfterWalletCheck();assert.equal(f.store.size,0);f.controller.dispose();
});
test('an old identical-payload receipt with another nonce cannot clear a newer ambiguous deposit',async()=>{
 const f=fixture({lost:true});await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
 f.candidate({hash:OTHER,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x7'});await f.controller.checkReceipt(OTHER);
 assert.equal(f.controller.state.phase,'unknown');assert.equal(f.store.size,1);assert.equal([...f.store.values()][0].hash,null);
 await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();assert.equal(f.sent.length,1);f.controller.dispose();
});
test('matching speed-up payload is confirmed only after canonical finalized inclusion',async()=>{
 const f=fixture();await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
 f.candidate({hash:OTHER,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x8'});f.finalized=false;await f.controller.checkReceipt(OTHER);
 assert.equal(f.controller.state.phase,'unknown');assert.equal([...f.store.values()][0].hash,HASH);
 f.finalized=true;await f.controller.checkReceipt(OTHER);assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.store.size,0);assert.equal(f.sent.length,1);f.controller.dispose();
});
test('the wallet-returned original hash keeps mined confirmation without waiting for finality',async()=>{
 const f=fixture();f.candidate({hash:HASH,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x8'});f.finalized=false;
 await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.store.size,0);assert.equal(f.calls.some(c=>c.method==='eth_getBlockByNumber'&&c.params[0]==='finalized'),false);f.controller.dispose();
});
test('reconciliation rejects transaction/receipt hash, chain, sender and nonce substitutions without persisting them',async()=>{
 for(const patch of [{hash:HASH},{from:PAY},{chainId:'0xa'},{nonce:'0x9'},{blockHash:HASH},{blockNumber:'0x21'}]){
  const f=fixture({lost:true});await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();
  f.candidate({hash:OTHER,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x8',patch});await f.controller.checkReceipt(OTHER);
  assert.equal(f.store.size,1);assert.equal([...f.store.values()][0].hash,null);assert.equal(f.controller.state.phase,'unknown');f.controller.dispose();
 }
});
test('legacy hashless intents reject automatic old-receipt proof and keep an explicit manual-review exit',async()=>{
 const f=fixture({legacy:{}});f.candidate({hash:OTHER,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x7'});await f.controller.checkReceipt(OTHER);
 assert.equal(f.store.size,1);assert.equal(f.controller.state.legacyPending,true);assert.equal([...f.store.values()][0].hash,null);
 await f.controller.clearUnknownAfterWalletCheck();assert.equal(f.store.size,0);assert.equal(f.sent.length,0);f.controller.dispose();
});
test('legacy hashed intents have an explicit manual-review exit rather than an unrecoverable UI lock',async()=>{
 const f=fixture({legacy:{hash:HASH}});await f.controller.clearUnknownAfterWalletCheck();assert.equal(f.store.size,0);assert.equal(f.sent.length,0);f.controller.dispose();
});
test('missing production lock support fails closed before sending or persisting an intent',async()=>{
 const f=fixture();delete f.deps.lock;const controller=new EconomyWalletController(f.deps),before=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try{Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});await controller.prepare({kind:'stake',shares:'1'});await controller.confirm();assert.equal(f.sent.length,0);assert.equal(f.store.size,0);assert.equal(controller.state.error,'PENDING_LOCK_UNAVAILABLE');}
 finally{if(before)Object.defineProperty(globalThis,'navigator',before);else delete globalThis.navigator;controller.dispose();f.controller.dispose();}
});
test('the shared lock remains held across the wallet prompt and the second tab cannot overwrite its intent',async()=>{
 const store=new Map(),lock=mutex(),gate=deferred(),f=fixture({store,lock}),g=fixture({store,lock});
 await Promise.all([f.controller.prepare({kind:'stake',shares:'1'}),g.controller.prepare({kind:'stake',shares:'1'})]);
 f.intercept(args=>args.method==='eth_sendTransaction'?gate.promise:undefined);
 const first=f.controller.confirm();await turn();const id=[...store.values()][0].intentId;
 const second=g.controller.confirm();await turn();assert.equal(g.sent.length,0);assert.equal([...store.values()][0].intentId,id);
 gate.resolve(HASH);await Promise.all([first,second]);assert.equal(g.sent.length,0);assert.equal([...store.values()][0].intentId,id);assert.equal(g.controller.state.phase,'unknown');
 f.controller.dispose();g.controller.dispose();
});
test('a second tab can reconcile the same proved nonce after the first tab has already cleared its stored intent',async()=>{
 const store=new Map(),lock=mutex(),f=fixture({store,lock}),g=fixture({store,lock});
 await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();g.controller.restorePending();assert.equal(g.controller.state.phase,'unknown');
 const record={hash:HASH,to:VAULT,input:encodeEconomyCall('deposit',[1n]),nonce:'0x8'};f.candidate(record);g.candidate(record);
 await f.controller.checkReceipt();assert.equal(store.size,0);await g.controller.checkReceipt();assert.equal(g.controller.state.phase,'confirmed');assert.equal(store.size,0);assert.equal(g.sent.length,0);f.controller.dispose();g.controller.dispose();
});
test('production locks reject a busy tab instead of queueing an old confirmation for a later send',async()=>{
 const f=fixture();delete f.deps.lock;const c=new EconomyWalletController(f.deps),gate=deferred(),acquired=deferred(),key='ember-economy-pending:1:'+VAULT+':'+PAY+':'+A;
 const holding=localEconomyLock.run(key,async()=>{acquired.resolve();await gate.promise;});await acquired.promise;
 try{await c.prepare({kind:'stake',shares:'1'});await c.confirm();assert.equal(c.state.error,'PENDING_LOCK_BUSY');assert.equal(f.sent.length,0);assert.equal(f.store.size,0);}
 finally{gate.resolve();await holding;}
 await turn();assert.equal(f.sent.length,0,'releasing the first tab must not automatically resume the old confirmation');
 await c.prepare({kind:'stake',shares:'1'});await c.confirm();assert.equal(f.sent.length,1,'a new explicit review and confirmation is required');c.dispose();f.controller.dispose();
});
test('adopting another tab withdrawal clears the unrelated local stake plan before showing its receipt result',async()=>{
 const store=new Map(),lock=mutex(),f=fixture({store,lock}),g=fixture({store,lock});
 await f.controller.prepare({kind:'withdraw',positionId:'1',shares:'1'});await f.controller.confirm();
 await g.controller.prepare({kind:'stake',shares:'1'});assert.equal(g.controller.state.plan.kind,'stake');await g.controller.confirm();
 assert.equal(g.controller.state.phase,'unknown');assert.equal(g.controller.state.plan,null);assert.equal(g.sent.length,0);
 g.candidate({hash:HASH,to:VAULT,input:encodeEconomyCall('withdraw',[1n,1n]),nonce:'0x8'});await g.controller.checkReceipt();assert.equal(g.controller.state.phase,'confirmed');assert.equal(g.controller.state.plan,null);assert.equal(g.sent.length,0);f.controller.dispose();g.controller.dispose();
});

async function heldNonce(f,action){
 const gate=deferred(),hit=deferred();f.intercept(args=>args.method==='eth_getTransactionCount'?(hit.resolve(),gate.promise):undefined);
 const pending=action();await hit.promise;return {pending,release(){gate.resolve('0x8');}};
}
test('stake stops before wallet prompt if indexing halts while pending nonce read is awaited',async()=>{
 const f=fixture();let allowed=true;f.deps.canSpend=()=>allowed;
 try{await f.controller.prepare({kind:'stake',shares:'1'});const h=await heldNonce(f,()=>f.controller.confirm());allowed=false;h.release();await h.pending;
 assert.equal(f.sent.length,0,'a newly halted economy must not reach eth_sendTransaction after the nonce wait');assert.equal(f.store.size,0);assert.equal(f.controller.state.error,'ECONOMY_HALTED');}finally{f.controller.dispose();}
});
test('EMBEO quote expiry during nonce await stops before wallet prompt and persistence',async()=>{
 const f=fixture(),gate=deferred(),hit=deferred();let clock=NOW;f.deps.now=()=>clock;
 f.intercept(args=>{
  if(args.method==='eth_getTransactionCount'){hit.resolve();return gate.promise;}
  if(args.method==='eth_call'&&args.params[0].data.startsWith('0x61d027b3'))return address(config.treasury);
  if(args.method==='eth_call'&&args.params[0].data.startsWith('0xe9c1121e'))return word(0);
 });
 try{await f.controller.prepare({kind:'pay',payment:{chainId:1,contract:PAY,token:config.token,receiver:config.treasury,orderId:'0x'+'6'.repeat(64),amount:'7'},expiresMs:NOW+100,serviceTitle:'Local nonce expiry'});
 assert.equal(f.controller.state.phase,'confirm');const pending=f.controller.confirm();await hit.promise;clock=NOW+101;gate.resolve('0x8');await pending;
 assert.equal(f.sent.length,0,'an expired quote must be rejected before a wallet send is requested');assert.equal(f.store.size,0);assert.equal(f.controller.state.error,'INVALID_ORDER');}finally{f.controller.dispose();}
});
for(const change of ['expired-session','account','provider','unmount'])test(`nonce await retains identity guard for ${change}`,async()=>{
 const f=fixture();try{await f.controller.prepare({kind:'stake',shares:'1'});const h=await heldNonce(f,()=>f.controller.confirm());
 if(change==='expired-session')f.deps.now=()=>NOW+3600000;
 if(change==='account')f.deps.auth().account='0x'+'b'.repeat(40);
 if(change==='provider')f.deps.provider=()=>({request:async()=>null});
 if(change==='unmount')f.controller.dispose();
 h.release();await h.pending;assert.equal(f.sent.length,0);assert.equal(f.store.size,0);
 }finally{f.controller.dispose();}
});
test('withdrawal remains possible when indexing halts during pending nonce await',async()=>{
 const f=fixture();let allowed=true;f.deps.canSpend=()=>allowed;
 try{await f.controller.prepare({kind:'withdraw',positionId:'1',shares:'1'});const h=await heldNonce(f,()=>f.controller.confirm());allowed=false;h.release();await h.pending;assert.equal(f.sent.length,1);assert.equal(f.sent[0].to,VAULT);}finally{f.controller.dispose();}
});
