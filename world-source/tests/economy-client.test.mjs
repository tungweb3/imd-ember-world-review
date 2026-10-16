import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encodeAbiParameters,decodeFunctionData,encodeFunctionData,parseAbi,toFunctionSelector} from 'viem';
import {INITIAL} from '../src/world/auth.ts';
import {EconomyClient,ECONOMY_TOKEN,ECONOMY_TREASURY,SHARE_WEI,parseEconomyConfig,parseEconomySnapshot,economyGoldMessage,validateGoldChallenge,economySession,economyTokenAmount} from '../src/world/economyClient.ts';
import {EconomyWalletController,encodeEconomyCall,decodeEconomyResult,economyFunctions} from '../src/world/economyWallet.ts';
import {economyEntry,firstEconomyDay,ECONOMY_DAY_MS} from '../src/world/economyEntry.ts';

const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),VAULT='0x'+'1'.repeat(40),PAY='0x'+'2'.repeat(40),NOW=1_800_000_000_000,OID='0x'+'3'.repeat(64),NONCE='0x'+'4'.repeat(64),SIG='0x'+'5'.repeat(130),REQ='request_1234567890',BLOCK='0x'+'6'.repeat(64);
const config=()=>({enabled:true,chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:VAULT,paymentContract:PAY,treasury:ECONOMY_TREASURY,shareTokens:'100000',shareWei:String(SHARE_WEI),rule:'utc-full-day-v1',goldTransferable:false,catalogue:[{id:'local-test',titleZh:'測試服務',titleEn:'Test service',gold:'2',embeo:String(3n*10n**18n)}]});
const disabled=()=>({enabled:false,reason:'NOT_CONFIGURED',shareTokens:'100000',rule:'utc-full-day-v1',goldTransferable:false,catalogue:[]});
const auth=()=>({...INITIAL,account:A,session:{address:A,expiresAt:NOW+3_600_000},sessionKnown:true,restored:true});
const selected=()=>({id:OID,wallet:A,serviceId:'local-test',currency:'GOLD',amount:'2',status:'pending',createdMs:NOW,expiresMs:NOW+900_000,paidMs:null});
const challenge=()=>{const c={orderId:OID,requestId:REQ,wallet:A,nonce:NONCE,origin:'https://imdember.com',issuedMs:NOW,expiresMs:NOW+300_000,amount:'2',serviceId:'local-test'};return {...c,message:economyGoldMessage(c)};};
const snapshot=()=>({address:A,gold:'2',positions:[{id:'1',initialShares:'3',shares:'2',depositedMs:NOW-ECONOMY_DAY_MS}],positionsTruncated:false,journal:[],orders:[],chain:{block:'123',throughMs:NOW,haltedReason:null},settledThroughMs:Math.floor(NOW/ECONOMY_DAY_MS)*ECONOMY_DAY_MS});
const response=(body,status=200)=>({status,json:async()=>body});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const abi=parseAbi(['function allowance(address owner,address spender) view returns(uint256)','function balanceOf(address owner) view returns(uint256)','function approve(address spender,uint256 amount) returns(bool)','function token() view returns(address)','function SHARE_SIZE() view returns(uint256)','function positions(uint256 id) view returns(address player,uint256 shares)','function deposit(uint256 shares) returns(uint256)','function withdraw(uint256 id,uint256 shares)','function treasury() view returns(address)','function paid(address payer,bytes32 id) view returns(bool)','function pay(bytes32 id,uint256 amount)']);
const word=n=>encodeAbiParameters([{type:'uint256'}],[n]);
function fixture(options={}){
 let state=auth(),current,clock=NOW,allowance=options.allowance??0n,receiptNull=!!options.receiptNull,rejectSend=false,available=true;
 const calls=[],http=[],sent=[],events=new Map(),hints=new Map(),providers=new Set();let intercept=null,fetchIntercept=null;
 const provider={on(event,fn){if(!events.has(event))events.set(event,new Set());events.get(event).add(fn);},removeListener(event,fn){events.get(event)?.delete(fn);},async request(args){
  calls.push(args);if(intercept){const result=intercept(args);if(result!==undefined)return result;}
  if(args.method==='eth_accounts')return [A];if(args.method==='eth_chainId')return '0x1';if(args.method==='eth_getTransactionCount')return '0x'+(sent.length+1).toString(16);
  if(args.method==='personal_sign')return SIG;
  if(args.method==='eth_call'){
   const tx=args.params[0],decoded=decodeFunctionData({abi,data:tx.data});
   switch(decoded.functionName){case 'token':return encodeAbiParameters([{type:'address'}],[ECONOMY_TOKEN]);case 'treasury':return encodeAbiParameters([{type:'address'}],[ECONOMY_TREASURY]);case 'SHARE_SIZE':return word(SHARE_WEI);case 'balanceOf':return word(options.balance??20n*SHARE_WEI);case 'allowance':return word(allowance);case 'positions':return encodeAbiParameters([{type:'address'},{type:'uint256'}],[A,3n]);case 'paid':return encodeAbiParameters([{type:'bool'}],[false]);default:throw Error('unexpected call '+decoded.functionName);}
  }
  if(args.method==='eth_sendTransaction'){
   if(rejectSend)throw Object.assign(Error('rejected'),{code:4001});const tx={...args.params[0],hash:'0x'+(sent.length+1).toString(16).padStart(64,'0')};sent.push(tx);return tx.hash;
  }
  if(args.method==='eth_getTransactionReceipt'){
   if(receiptNull)return null;const tx=sent.find(t=>t.hash===args.params[0]);if(!tx)throw Error('missing tx');const decoded=decodeFunctionData({abi,data:tx.data});if(decoded.functionName==='approve')allowance=decoded.args[1];
   return {transactionHash:tx.hash,from:A,to:tx.to,status:options.revert?'0x0':'0x1',blockHash:BLOCK,blockNumber:'0x1'};
  }
  if(args.method==='eth_getTransactionByHash'){const tx=sent.find(t=>t.hash===args.params[0]);return {...tx,input:tx.data,chainId:'0x1',blockHash:BLOCK,blockNumber:'0x1'};}
  if(args.method==='eth_getBlockByNumber')return {number:'0x1',hash:BLOCK};
  throw Error('unexpected RPC '+args.method);
 }};
 current=provider;
 const fetch=async(path,init)=>{http.push({path,init});if(fetchIntercept){const value=fetchIntercept(path,init);if(value!==undefined)return value;}if(path==='/api/auth/session')return response({signedIn:true,address:state.session?.address,expiresAt:state.session?.expiresAt});if(path==='/api/economy/config')return response(config());if(path.endsWith('/gold'))return response({order:{...selected(),status:'paid',paidMs:clock}});throw Error('unexpected HTTP '+path);};
 let lockTail=Promise.resolve();const lock={run(_key,fn){const run=lockTail.then(fn,fn);lockTail=run.catch(()=>{});return run;}};
 const deps={config:config(),auth:()=>state,provider:()=>current,onProviderChange:fn=>{providers.add(fn);return()=>providers.delete(fn);},fetch,origin:'https://imdember.com',now:()=>clock,receiptAttempts:1,rpcTimeoutMs:options.rpcTimeoutMs??1000,delay:async()=>{},canSpend:()=>available,lock,pending:options.pendingStore??{get:key=>hints.get(key),set:(key,value)=>{if(value)hints.set(key,value);else hints.delete(key);}}};
 const controller=new EconomyWalletController(deps);
 return {controller,calls,http,sent,events,hints,provider,reopen:()=>new EconomyWalletController(deps),intercept(fn){intercept=fn;},fetchIntercept(fn){fetchIntercept=fn;},emit(event,value){for(const fn of events.get(event)??[])fn(value);},switchProvider(value){current=value;for(const fn of providers)fn();},set state(value){state=value;controller.contextChanged();},get state(){return state;},set now(value){clock=value;},set receiptNull(value){receiptNull=value;},set rejectSend(value){rejectSend=value;},set available(value){available=value;},get allowance(){return allowance;}};
}
test('fixed entry and UTC calendar use exact complete days, including midnight',()=>{
 assert.equal(economyEntry('zh'),'/?portal=economy&lang=zh');assert.equal(economyEntry('en'),'/?portal=economy&lang=en');const midnight=Date.parse('2026-10-16T00:00:00Z');assert.equal(firstEconomyDay(midnight),midnight);assert.equal(firstEconomyDay(midnight+1),midnight+ECONOMY_DAY_MS);assert.equal(firstEconomyDay(midnight+12*3600000)+ECONOMY_DAY_MS,Date.parse('2026-10-18T00:00:00Z'));assert.throws(()=>firstEconomyDay(NaN));
});
test('config pins Ethereum EMBEO, treasury, nontransferable GOLD and separated contracts',()=>{
 assert.deepEqual(parseEconomyConfig(config()),config());assert.deepEqual(parseEconomyConfig(disabled()),disabled());
 for(const patch of [{chainId:10},{token:B},{treasury:B},{goldTransferable:true},{tokenDecimals:6},{stakingContract:PAY},{paymentContract:ECONOMY_TOKEN},{shareWei:'1'},{rule:'rolling-24hr'},{catalogue:[{...config().catalogue[0],gold:'0'}]},{catalogue:[...config().catalogue,...config().catalogue]}])assert.throws(()=>parseEconomyConfig({...config(),...patch}));
 assert.throws(()=>new EconomyWalletController({config:disabled(),auth,provider:()=>null}));
});
test('server amounts remain decimal integer strings, not floats or browser-calculated rewards',()=>{
 assert.equal(economyTokenAmount('1000000000000000001'),'1.000000000000000001');assert.equal(economyTokenAmount('1000000000000000000'),'1');assert.equal(parseEconomySnapshot(snapshot(),A).gold,'2');
 for(const patch of [{gold:2},{gold:'1.5'},{address:B},{gold:'-1'},{positions:[{...snapshot().positions[0],shares:'4'}]},{chain:{block:'123',throughMs:NOW}},{orders:Array(51).fill(selected())}])assert.throws(()=>parseEconomySnapshot({...snapshot(),...patch},A));
 assert.equal(parseEconomySnapshot({...snapshot(),chain:{...snapshot().chain,haltedReason:'FINALIZED_CURSOR_CHANGED'}},A).gold,'2');
});
test('wallet session requires known identity, unexpired clock and matching connected account',()=>{
 assert.ok(economySession(auth(),NOW));for(const patch of [{sessionKnown:false},{leaving:true},{phase:'verifying'},{account:B},{session:{address:A,expiresAt:NOW}}])assert.equal(economySession({...auth(),...patch},NOW),null);
});
test('config and ledger GETs are fixed, same-origin credentialed and abortable',async()=>{
 const calls=[],state=auth(),abort=new AbortController(),client=new EconomyClient({auth:()=>state,now:()=>NOW,fetch:async(path,init)=>{calls.push({path,init});return response(path==='/api/economy/config'?disabled():snapshot());}});
 await client.config(abort.signal);await client.snapshot(abort.signal);assert.equal(calls[0].path,'/api/economy/config');assert.equal(calls[1].path,'/api/me/economy?expected_address='+A);for(const {init}of calls){assert.equal(init.method,'GET');assert.equal(init.credentials,'same-origin');assert.equal(init.cache,'no-store');assert.equal(init.redirect,'error');assert.equal(init.signal,abort.signal);assert.equal(init.body,undefined);}
});
test('late ledger fetch/json responses cannot restore another or expired session balance',async()=>{
 for(const phase of ['fetch','json']){let state=auth();const gate=deferred(),client=new EconomyClient({auth:()=>state,now:()=>NOW,fetch:async()=>{if(phase==='fetch')await gate.promise;return {status:200,json:async()=>{if(phase==='json')await gate.promise;return snapshot();}};}});const pending=client.snapshot();await turn();state={...state,session:{address:B,expiresAt:NOW+1e6}};gate.resolve();await assert.rejects(pending,/CONTEXT_CHANGED/);}
});
test('order creation accepts the server price only when every payment destination and order field matches',async()=>{
 const state=auth(),calls=[],order={...selected(),currency:'EMBEO',amount:config().catalogue[0].embeo},payment={chainId:1,contract:PAY,token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY,orderId:OID,amount:order.amount};let rewrite=value=>value;
 const client=new EconomyClient({auth:()=>state,now:()=>NOW,fetch:async(path,init)=>{calls.push({path,init});return response(path==='/api/auth/session'?{signedIn:true,...state.session}:rewrite({order,payment}));}});
 assert.equal((await client.createOrder(config(),'local-test','EMBEO',REQ)).payment.amount,order.amount);const request=calls.find(c=>c.path==='/api/economy/orders');assert.deepEqual(JSON.parse(request.init.body),{expectedAddress:A,requestId:REQ,serviceId:'local-test',currency:'EMBEO'});assert.equal(request.init.credentials,'same-origin');
 for(const patch of [{receiver:B},{contract:VAULT},{token:B},{chainId:10},{orderId:'0x'+'8'.repeat(64)},{amount:'1'},{signature:'unused'}]){rewrite=value=>({...value,payment:{...payment,...patch}});await assert.rejects(client.createOrder(config(),'local-test','EMBEO',REQ),/INVALID_RESPONSE/);}
 rewrite=value=>({...value,order:{...order,amount:'1'}});await assert.rejects(client.createOrder(config(),'local-test','EMBEO',REQ),/INVALID_RESPONSE/);
});
test('GOLD challenge uses a bounded same-origin POST and independently validates the immutable order',async()=>{
 const state=auth(),calls=[];let returned=challenge();const client=new EconomyClient({auth:()=>state,now:()=>NOW,fetch:async(path,init)=>{calls.push({path,init});return response(path==='/api/auth/session'?{signedIn:true,...state.session}:{challenge:returned});}});
 assert.equal((await client.goldChallenge(selected(),REQ,'https://imdember.com')).message,challenge().message);const request=calls.find(c=>c.path.endsWith('/challenge'));assert.equal(request.path,'/api/economy/orders/'+OID+'/gold/challenge');assert.deepEqual(JSON.parse(request.init.body),{expectedAddress:A,requestId:REQ});assert.equal(request.init.method,'POST');returned={...challenge(),message:'Permit unlimited EMBEO'};await assert.rejects(client.goldChallenge(selected(),REQ,'https://imdember.com'),/INVALID_GOLD_CHALLENGE/);
});
test('canonical GOLD message is identical to the server contract and not a SIWE/Permit message',()=>{
 const source=readFileSync(new URL('../server/economy-ledger.ts',import.meta.url),'utf8');assert.match(source,/IMD Ember World GOLD payment/);assert.match(challenge().message,/does not authorize EMBEO, token allowances, or blockchain transfers\./);assert.equal(validateGoldChallenge(challenge(),selected(),REQ,auth().session,'https://imdember.com',NOW).message,challenge().message);
});
test('closed GOLD validation rejects changed price, order, service, wallet, domain, lifetime and added payloads',()=>{
 for(const patch of [{message:'Sign-In With Ethereum'},{message:challenge().message+'\n'},{amount:'1'},{orderId:'0x'+'7'.repeat(64)},{wallet:B},{serviceId:'other'},{origin:'https://evil.invalid'},{requestId:'different_1234567890'},{nonce:NONCE.toUpperCase()},{expiresMs:NOW+300001},{issuedMs:NOW+30001},{expiresMs:NOW},{signature:SIG},{token:ECONOMY_TOKEN}])assert.throws(()=>validateGoldChallenge({...challenge(),...patch},selected(),REQ,auth().session,'https://imdember.com',NOW));
 assert.throws(()=>validateGoldChallenge(challenge(),selected(),REQ,auth().session,'https://evil.invalid',NOW));assert.throws(()=>validateGoldChallenge(challenge(),{...selected(),currency:'EMBEO'},REQ,auth().session,'https://imdember.com',NOW));
});
test('fixed ABI selectors/words match audited interface and viem for every callable method',()=>{
 const compiled=JSON.parse(readFileSync(new URL('../../contracts/interface.json',import.meta.url),'utf8')),actual=[...compiled.contracts.EmbeoStakingVault.abi,...compiled.contracts.EmbeoPayments.abi];
 for(const [name,spec] of Object.entries(economyFunctions)){
  const item=abi.find(row=>row.name===name),args=item.inputs.map(i=>i.type==='address'?A:i.type==='bytes32'?OID:3n);assert.equal('0x'+spec.selector,toFunctionSelector(item));assert.equal(encodeEconomyCall(name,args),encodeFunctionData({abi,functionName:name,args}));
  if(!['allowance','balanceOf','approve'].includes(name))assert.ok(actual.some(row=>row.type==='function'&&row.name===name&&row.inputs.map(i=>i.type).join()===item.inputs.map(i=>i.type).join()));
 }
 assert.equal(decodeEconomyResult('balanceOf',word((1n<<256n)-1n)),(1n<<256n)-1n);assert.equal(decodeEconomyResult('paid',word(1n)),true);assert.throws(()=>decodeEconomyResult('paid',word(2n)));assert.throws(()=>decodeEconomyResult('token','0x'+'f'.repeat(64)));assert.throws(()=>encodeEconomyCall('deposit',[-1n]));assert.throws(()=>encodeEconomyCall('pay',[OID,1n<<256n]));
});
test('constructing and restoring the controller never calls a wallet or signs a message',()=>{const f=fixture();f.controller.restorePending();assert.equal(f.calls.length,0);assert.equal(f.http.length,0);f.controller.dispose();});
test('stake preparation cannot send, and exact approval still requires a separate execution click',async()=>{
 const f=fixture();await f.controller.prepare({kind:'stake',shares:'2'});assert.equal(f.controller.state.phase,'approve-required');assert.equal(f.sent.length,0);await f.controller.approve();assert.equal(f.sent.length,1);assert.equal(f.allowance,2n*SHARE_WEI);assert.equal(f.controller.state.phase,'confirm');assert.equal(decodeFunctionData({abi,data:f.sent[0].data}).functionName,'approve');assert.equal(decodeFunctionData({abi,data:f.sent[0].data}).args[1],2n*SHARE_WEI);await f.controller.confirm();assert.equal(f.sent.length,2);assert.equal(f.controller.state.phase,'confirmed');assert.deepEqual(decodeFunctionData({abi,data:f.sent[1].data}),{functionName:'deposit',args:[2n]});assert.ok(!f.calls.some(c=>['eth_requestAccounts','wallet_switchEthereumChain','personal_sign'].includes(c.method)));f.controller.dispose();
});
test('an insufficient nonzero allowance is explicitly reset before exact approval',async()=>{
 const f=fixture({allowance:1n});await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.controller.state.phase,'reset-required');await f.controller.approve();assert.equal(f.allowance,0n);assert.equal(f.controller.state.phase,'approve-required');assert.equal(f.sent.length,1);await f.controller.approve();assert.equal(f.allowance,SHARE_WEI);assert.equal(f.controller.state.phase,'confirm');assert.equal(f.sent.length,2);f.controller.dispose();
});
test('existing sufficient allowance never skips the explicit stake confirmation',async()=>{const f=fixture({allowance:10n*SHARE_WEI});await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.controller.state.phase,'confirm');assert.equal(f.sent.length,0);await f.controller.approve();assert.equal(f.sent.length,0);f.controller.dispose();});
test('each deposit uses an immutable shares copy and rejects zero/fractional/overflow units',async()=>{
 for(const shares of ['0','1.1','-1','01',String((1n<<256n)-1n)]){const f=fixture();await f.controller.prepare({kind:'stake',shares});assert.equal(f.sent.length,0);assert.equal(f.calls.length,0);f.controller.dispose();}
 const f=fixture({allowance:20n*SHARE_WEI}),plan={kind:'stake',shares:'2'};const ready=f.controller.prepare(plan);plan.shares='19';await ready;assert.equal(f.controller.state.plan.shares,'2');await f.controller.confirm();assert.equal(decodeFunctionData({abi,data:f.sent[0].data}).args[0],2n);f.controller.dispose();
});
test('withdrawal reads actual chain position and never asks for a token allowance',async()=>{const f=fixture();f.available=false;await f.controller.prepare({kind:'withdraw',positionId:'1',shares:'2'});assert.equal(f.controller.state.phase,'confirm');await f.controller.confirm();assert.equal(f.sent[0].to,VAULT);assert.deepEqual(decodeFunctionData({abi,data:f.sent[0].data}),{functionName:'withdraw',args:[1n,2n]});assert.equal(f.calls.filter(c=>c.method==='eth_call').some(c=>c.params[0].data.startsWith('0xdd62ed3e')),false);f.controller.dispose();});
test('manual position-ID withdrawal rejects another owner or excessive shares from actual chain data',async()=>{
 for(const kind of ['owner','shares']){const f=fixture();if(kind==='owner')f.intercept(args=>args.method==='eth_call'&&args.params[0].data.startsWith('0x99fbab88')?encodeAbiParameters([{type:'address'},{type:'uint256'}],[B,100n]):undefined);await f.controller.prepare({kind:'withdraw',positionId:'777',shares:kind==='owner'?'1':'4'});assert.equal(f.controller.state.error,'POSITION_CHANGED');assert.equal(f.sent.length,0);f.controller.dispose();}
});
test('halt stops new stakes and payments without blocking principal withdrawal',async()=>{const f=fixture({allowance:SHARE_WEI});await f.controller.prepare({kind:'stake',shares:'1'});f.available=false;await f.controller.confirm();assert.equal(f.sent.length,0);assert.equal(f.controller.state.error,'ECONOMY_HALTED');await f.controller.payGold(selected(),REQ,challenge());assert.equal(f.calls.filter(c=>c.method==='personal_sign').length,0);f.controller.dispose();});
test('insufficient token balance stops before approval or execution',async()=>{const f=fixture({balance:SHARE_WEI-1n});await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.controller.state.error,'INSUFFICIENT_EMBEO');assert.equal(f.sent.length,0);f.controller.dispose();});
test('wallet rejection is shown once and is never automatically resent',async()=>{const f=fixture();await f.controller.prepare({kind:'stake',shares:'1'});f.rejectSend=true;await f.controller.approve();assert.equal(f.controller.state.phase,'rejected');assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);await turn();assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);f.controller.dispose();});
for(const event of ['accountsChanged','chainChanged','disconnect'])test('provider '+event+' while awaiting a read cancels all later sends',async()=>{
 const f=fixture(),gate=deferred();f.intercept(args=>args.method==='eth_accounts'?gate.promise:undefined);const pending=f.controller.prepare({kind:'stake',shares:'1'});await turn();f.emit(event,[B]);gate.resolve([A]);await pending;assert.equal(f.controller.state.phase,'context-changed');assert.equal(f.sent.length,0);f.controller.dispose();
});
test('provider replacement during preparation cancels even when its address is the same',async()=>{const f=fixture(),gate=deferred();f.intercept(args=>args.method==='eth_chainId'?gate.promise:undefined);const pending=f.controller.prepare({kind:'stake',shares:'1'});await turn();f.switchProvider({request:async()=>[]});gate.resolve('0x1');await pending;assert.equal(f.controller.state.phase,'context-changed');assert.equal(f.sent.length,0);f.controller.dispose();});
test('session replacement and clock expiry during awaited reads stop transaction authority',async()=>{
 for(const kind of ['replacement','expiry']){const f=fixture(),gate=deferred();f.intercept(args=>args.method==='eth_accounts'?gate.promise:undefined);const pending=f.controller.prepare({kind:'stake',shares:'1'});await turn();if(kind==='replacement')f.state={...f.state,session:{...f.state.session}};else f.now=f.state.session.expiresAt;gate.resolve([A]);await pending;assert.equal(f.sent.length,0);assert.equal(f.controller.state.phase,'context-changed');f.controller.dispose();}
});
test('two simultaneous clicks produce one wallet send and retain the same transaction',async()=>{
 const f=fixture({allowance:SHARE_WEI}),gate=deferred();await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_sendTransaction'?gate.promise:undefined);const first=f.controller.confirm(),second=f.controller.confirm();await turn();assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);gate.reject(Object.assign(Error('rejected'),{code:4001}));await Promise.all([first,second]);assert.equal(f.controller.state.phase,'rejected');f.controller.dispose();
});
test('pending receipt has bounded polling and explicit read-only reconciliation, never a repeated send',async()=>{
 const f=fixture({allowance:SHARE_WEI,receiptNull:true});await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();assert.equal(f.controller.state.phase,'unknown');assert.equal(f.sent.length,1);assert.equal(f.calls.filter(c=>c.method==='eth_getTransactionReceipt').length,1);assert.equal(f.hints.size,1);await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.sent.length,1);f.receiptNull=false;await f.controller.checkReceipt();assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.sent.length,1);assert.equal(f.hints.size,0);f.controller.dispose();
});
test('a lost send response remains ambiguous and cannot be retried by another preparation',async()=>{
 const f=fixture({allowance:SHARE_WEI});await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_sendTransaction'?Promise.reject(Error('network lost')):undefined);await f.controller.confirm();assert.equal(f.controller.state.phase,'unknown');await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);f.controller.dispose();
});
test('unknown sends persist before the wallet prompt and survive controller reopen without a duplicate',async()=>{
 for(const result of ['lost','invalid-hash']){const f=fixture({allowance:SHARE_WEI});await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>{if(args.method==='eth_sendTransaction'){assert.equal(f.hints.size,1);assert.equal([...f.hints.values()][0].hash,null);return result==='lost'?Promise.reject(Error('response lost')):'invalid-hash';}});await f.controller.confirm();assert.equal(f.controller.state.phase,'unknown');assert.equal(f.hints.size,1);f.controller.dispose();const reopened=f.reopen();reopened.restorePending();assert.equal(reopened.state.phase,'unknown');assert.equal(reopened.state.hash,null);await reopened.prepare({kind:'stake',shares:'1'});await reopened.confirm();assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);reopened.dispose();}
});
test('a storage quota failure or silent failed persistence blocks the wallet send',async()=>{
 for(const store of [{get:()=>null,set(){throw Error('quota');}},{get:()=>null,set(){}}]){const f=fixture({allowance:SHARE_WEI,pendingStore:store});await f.controller.prepare({kind:'stake',shares:'1'});await f.controller.confirm();assert.equal(f.calls.some(c=>c.method==='eth_sendTransaction'),false);assert.equal(f.controller.state.phase,'error');f.controller.dispose();}
});
test('explicit no-broadcast acknowledgement clears only its own intent and never sends by itself',async()=>{
 const f=fixture({allowance:SHARE_WEI});await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_sendTransaction'?Promise.reject(Error('lost')):undefined);await f.controller.confirm();f.controller.dispose();const next=f.reopen();next.restorePending();await next.clearUnknownAfterWalletCheck();assert.equal(f.hints.size,0);assert.equal(next.state.phase,'idle');assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);next.dispose();
});
test('a disposed controller retains its cross-tab prompt lock and a late hash invalidates an earlier acknowledgement',async()=>{
 const f=fixture({allowance:SHARE_WEI,receiptNull:true}),gate=deferred();await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_sendTransaction'?gate.promise:undefined);const old=f.controller.confirm();await turn();const oldId=[...f.hints.values()][0].intentId;f.controller.dispose();const next=f.reopen();next.restorePending();let cleared=false;const acknowledgement=next.clearUnknownAfterWalletCheck().then(()=>{cleared=true;});await turn();assert.equal(cleared,false);gate.resolve('0x'+'9'.repeat(64));await Promise.all([old,acknowledgement]);assert.equal([...f.hints.values()][0].intentId,oldId);assert.equal([...f.hints.values()][0].hash,'0x'+'9'.repeat(64));assert.equal(next.state.hash,'0x'+'9'.repeat(64));await next.prepare({kind:'stake',shares:'1'});await next.confirm();assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);next.dispose();
});
test('receipt RPC timeout is bounded and leaves a broadcast hash for reconciliation',async()=>{
 const f=fixture({allowance:SHARE_WEI,rpcTimeoutMs:5});await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_getTransactionReceipt'?new Promise(()=>{}):undefined);await f.controller.confirm();assert.equal(f.controller.state.phase,'unknown');assert.equal(f.controller.state.error,'REQUEST_TIMEOUT');assert.match(f.controller.state.hash,/^0x/);f.controller.dispose();
});
test('receipt status and transaction call data must match before a success can be shown',async()=>{
 const f=fixture({allowance:SHARE_WEI});await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_getTransactionByHash'?{from:A,to:VAULT,input:'0x1234',value:'0x0'}:undefined);await f.controller.confirm();assert.equal(f.controller.state.phase,'unknown');assert.equal(f.controller.state.error,'TRANSACTION_MISMATCH');assert.equal(f.hints.size,1);f.controller.dispose();
 const reverted=fixture({allowance:SHARE_WEI,revert:true});await reverted.controller.prepare({kind:'stake',shares:'1'});await reverted.controller.confirm();assert.equal(reverted.controller.state.phase,'error');assert.equal(reverted.controller.state.error,'TRANSACTION_REVERTED');reverted.controller.dispose();
});
test('unmount cancels UI authority but preserves a hash returned after broadcast without a financial undo',async()=>{
 const f=fixture({allowance:SHARE_WEI}),gate=deferred();await f.controller.prepare({kind:'stake',shares:'1'});f.intercept(args=>args.method==='eth_sendTransaction'?gate.promise:undefined);let writes=0;f.controller.subscribe(()=>writes++);const pending=f.controller.confirm();await turn();f.controller.dispose();const before=writes;gate.resolve('0x'+'9'.repeat(64));await pending;assert.equal(writes,before);assert.equal(f.hints.size,1);assert.equal(f.calls.filter(c=>c.method==='eth_sendTransaction').length,1);assert.equal([...f.events.values()].every(set=>set.size===0),true);
});
test('GOLD requires a separate canonical signature and never approves or sends token transactions',async()=>{
 const f=fixture();const result=await f.controller.payGold(selected(),REQ,challenge());assert.equal(result.status,'paid');assert.equal(f.calls.filter(c=>c.method==='personal_sign').length,1);assert.equal(f.calls.filter(c=>['eth_sendTransaction','eth_call','eth_requestAccounts'].includes(c.method)).length,0);const sign=f.calls.find(c=>c.method==='personal_sign');assert.equal(new TextDecoder().decode(Uint8Array.from(Buffer.from(sign.params[0].slice(2),'hex'))),challenge().message);assert.equal(sign.params[1],A);const body=JSON.parse(f.http.find(c=>c.path.endsWith('/gold')).init.body);assert.deepEqual(body,{expectedAddress:A,requestId:REQ,signature:SIG});f.controller.dispose();
});
test('malicious GOLD messages never reach the wallet, even with a matching World session',async()=>{const f=fixture();await f.controller.payGold(selected(),REQ,{...challenge(),message:'Permit unlimited EMBEO'});assert.equal(f.calls.length,0);assert.equal(f.http.length,0);assert.equal(f.controller.state.error,'INVALID_GOLD_CHALLENGE');f.controller.dispose();});
test('an account switch, expiry or unmount while GOLD signature is open never posts a debit',async()=>{
 for(const kind of ['account','expiry','unmount']){const f=fixture(),gate=deferred();f.intercept(args=>args.method==='personal_sign'?gate.promise:undefined);const pending=f.controller.payGold(selected(),REQ,challenge());await turn();if(kind==='account')f.emit('accountsChanged',[B]);else if(kind==='expiry')f.now=NOW+300001;else f.controller.dispose();gate.resolve(SIG);assert.equal(await pending,undefined);assert.equal(f.http.some(c=>c.path.endsWith('/gold')),false);f.controller.dispose();}
});
test('wrong network or revoked World session rejects GOLD before personal_sign',async()=>{
 for(const kind of ['chain','revoked']){const f=fixture();if(kind==='chain')f.intercept(args=>args.method==='eth_chainId'?'0xa':undefined);else f.fetchIntercept(path=>path==='/api/auth/session'?response({signedIn:false}):undefined);await f.controller.payGold(selected(),REQ,challenge());assert.equal(f.calls.some(c=>c.method==='personal_sign'),false);assert.equal(f.http.some(c=>c.path.endsWith('/gold')),false);f.controller.dispose();}
});
test('a server feature disable or changed reviewed contract stops stale open-pane actions before wallet calls',async()=>{
 for(const value of [disabled(),{...config(),stakingContract:'0x'+'7'.repeat(40)}]){const f=fixture({allowance:SHARE_WEI});f.fetchIntercept(path=>path==='/api/economy/config'?response(value):undefined);await f.controller.prepare({kind:'stake',shares:'1'});assert.equal(f.calls.length,0);assert.ok(['NOT_CONFIGURED','CONFIG_CHANGED'].includes(f.controller.state.error));f.controller.dispose();}
});
test('negative control shows the canonical validator stops a substituted Permit message',()=>{
 const unvalidated=value=>value.message;assert.equal(unvalidated({...challenge(),message:'Permit unlimited EMBEO'}),'Permit unlimited EMBEO');assert.throws(()=>validateGoldChallenge({...challenge(),message:'Permit unlimited EMBEO'},selected(),REQ,auth().session,'https://imdember.com',NOW));
});
test('GOLD halting during final post-signature session verification stops before POST',async()=>{
 const f=fixture(),gate=deferred(),hit=deferred();let signed=false;
 f.intercept(args=>{if(args.method==='personal_sign'){signed=true;return SIG;}});
 f.fetchIntercept(path=>path==='/api/auth/session'&&signed?(hit.resolve(),gate.promise):undefined);
 try{const pending=f.controller.payGold(selected(),REQ,challenge());await hit.promise;f.available=false;gate.resolve(response({signedIn:true,...f.state.session}));assert.equal(await pending,undefined);assert.equal(f.http.some(c=>c.path.endsWith('/gold')),false);assert.equal(f.controller.state.error,'ECONOMY_HALTED');}
 finally{f.controller.dispose();}
});
test('GOLD halting after POST starts still accepts its authoritative completed payment response',async()=>{
 const f=fixture(),gate=deferred(),hit=deferred();
 f.fetchIntercept(path=>path.endsWith('/gold')?{status:200,json:async()=>{hit.resolve();return gate.promise;}}:undefined);
 try{const pending=f.controller.payGold(selected(),REQ,challenge());await hit.promise;f.available=false;gate.resolve({order:{...selected(),status:'paid',paidMs:NOW}});assert.equal((await pending).status,'paid');assert.equal(f.controller.state.phase,'confirmed');assert.equal(f.http.filter(c=>c.path.endsWith('/gold')).length,1);}
 finally{f.controller.dispose();}
});
