import type {AuthState,Provider,Session} from './auth.ts';
import {EconomyClient,EconomyClientError,economyAddress,economyInteger,economySession,parseEconomyConfig,validateGoldChallenge,SHARE_WEI,type EconomyConfig,type EconomyPayment,type EconomyOrder,type EconomyGoldChallenge} from './economyClient.ts';

type Hex=`0x${string}`;
// Fixed static ABI words keep the transaction module small. Tests compare every
// selector, encoding and decoding with viem and the compiled contract interface.
export const economyFunctions={allowance:{selector:'dd62ed3e',args:['address','address'],out:'uint'},balanceOf:{selector:'70a08231',args:['address'],out:'uint'},approve:{selector:'095ea7b3',args:['address','uint'],out:'bool'},token:{selector:'fc0c546a',args:[],out:'address'},SHARE_SIZE:{selector:'10a223e7',args:[],out:'uint'},positions:{selector:'99fbab88',args:['uint'],out:'position'},deposit:{selector:'b6b55f25',args:['uint'],out:'uint'},withdraw:{selector:'441a3e70',args:['uint','uint'],out:'none'},treasury:{selector:'61d027b3',args:[],out:'address'},paid:{selector:'e9c1121e',args:['address','bytes32','uint'],out:'bool'},pay:{selector:'d0ee4de0',args:['bytes32','uint'],out:'none'}} as const;
type FunctionName=keyof typeof economyFunctions;
export function encodeEconomyCall(name:FunctionName,args:readonly unknown[]=[]):Hex{
 const spec=economyFunctions[name];if(args.length!==spec.args.length)throw new EconomyClientError('INVALID_ARGUMENT');
 return ('0x'+spec.selector+spec.args.map((type,i)=>{const value=args[i];if(type==='address'){if(!economyAddress(value))throw new EconomyClientError('INVALID_ARGUMENT');return value.slice(2).toLowerCase().padStart(64,'0');}if(type==='bytes32'){if(typeof value!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(value))throw new EconomyClientError('INVALID_ARGUMENT');return value.slice(2).toLowerCase();}const text=typeof value==='bigint'?String(value):value;if(!economyInteger(text))throw new EconomyClientError('INVALID_ARGUMENT');return BigInt(text).toString(16).padStart(64,'0');}).join('')) as Hex;
}
export function decodeEconomyResult(name:FunctionName,value:unknown):unknown{
 const spec=economyFunctions[name],words=spec.out==='none'?0:spec.out==='position'?2:1;
 if(typeof value!=='string'||!new RegExp('^0x[0-9a-fA-F]{'+words*64+'}$').test(value))throw new EconomyClientError('INVALID_CHAIN_RESPONSE');
 const address=(word:string)=>{if(!/^0{24}[0-9a-fA-F]{40}$/.test(word))throw new EconomyClientError('INVALID_CHAIN_RESPONSE');return '0x'+word.slice(24).toLowerCase();};
 if(spec.out==='address')return address(value.slice(2));if(spec.out==='position')return [address(value.slice(2,66)),BigInt('0x'+value.slice(66))];if(spec.out==='none')return undefined;
 const integer=BigInt(value);if(spec.out==='bool'){if(integer>1n)throw new EconomyClientError('INVALID_CHAIN_RESPONSE');return integer===1n;}return integer;
}
export type EconomyPlan={kind:'stake';shares:string}|{kind:'withdraw';positionId:string;shares:string}|{kind:'pay';payment:EconomyPayment;expiresMs:number;serviceTitle:string};
export type EconomyWalletPhase='idle'|'checking'|'reset-required'|'approve-required'|'confirm'|'sending'|'pending'|'unknown'|'confirmed'|'replaced'|'rejected'|'error'|'context-changed';
export type EconomyWalletState={phase:EconomyWalletPhase;busy:boolean;plan:EconomyPlan|null;hash:string|null;step:'reset'|'approve'|'execute'|null;error:string|null;legacyPending:boolean};
type Pending={version?:2;nonce?:Hex;chainId:1;from:string;to:string;data:Hex;hash:Hex|null;step:'reset'|'approve'|'execute';intentId:string;createdMs:number};
export type EconomyPendingStore={get(key:string):unknown;set(key:string,value:Pending|null):void};
export type EconomyLock={run<T>(key:string,fn:()=>Promise<T>):Promise<T>};
/** The lock spans wallet prompts too. Storage read/write/readback alone is not
 * a compare-and-swap across separate tabs. No unprotected fallback may send. */
export const localEconomyLock:EconomyLock={async run(key,fn){const locks=globalThis.navigator?.locks;if(!locks)throw new EconomyClientError('PENDING_LOCK_UNAVAILABLE');return locks.request(key,{mode:'exclusive',ifAvailable:true},lock=>{if(!lock)throw new EconomyClientError('PENDING_LOCK_BUSY');return fn();});}};
type Deps={config:EconomyConfig;auth:()=>AuthState;provider:()=>Provider|null;onProviderChange?:(fn:()=>void)=>()=>void;fetch?:typeof fetch;origin?:string;canSpend?:()=>boolean;now?:()=>number;delay?:(ms:number)=>Promise<void>;receiptAttempts?:number;rpcTimeoutMs?:number;pending?:EconomyPendingStore;lock?:EconomyLock};
const HASH=/^0x[0-9a-fA-F]{64}$/,HEX=/^0x[0-9a-fA-F]*$/;
const quantity=(v:unknown):v is Hex=>typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v)&&v.length<=66;
const nonce=(v:unknown):v is Hex=>quantity(v)&&BigInt(v)<(1n<<64n);
const initial=():EconomyWalletState=>({phase:'idle',busy:false,plan:null,hash:null,step:null,error:null,legacyPending:false});
export const localEconomyPending:EconomyPendingStore={get(key){try{return JSON.parse(localStorage.getItem(key)??'null');}catch{return null;}},set(key,value){try{if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);}catch{/* A hint is never transaction authority. */}}};
/** A separate, click-driven transaction controller. It does not change SIWE,
 * choose a provider, switch chains, request accounts, sign messages or retry sends. */
export class EconomyWalletController{
 private s=initial();private listeners=new Set<()=>void>();private context:{provider:Provider;session:Session;address:string;generation:number;started:number}|null=null;
 private generation=0;private alive=true;private locked=false;private sendAttempted=false;private cleanups:(()=>void)[]=[];private transaction:Pending|null=null;private abort=new AbortController();
 private config:EconomyConfig;private client:EconomyClient;private deps:Deps;
 constructor(deps:Deps){this.deps=deps;const config=parseEconomyConfig(deps.config);if(!config.enabled)throw new EconomyClientError('NOT_CONFIGURED');this.config=config;this.client=new EconomyClient({auth:deps.auth,fetch:deps.fetch,now:deps.now,canSpend:()=>this.deps.canSpend?.()??true});}
 get state(){return this.s;}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private now(){return (this.deps.now??Date.now)();}
 private set(patch:Partial<EconomyWalletState>){if(!this.alive)return;this.s={...this.s,...patch};for(const listener of this.listeners)listener();}
 private key(address:string){return 'ember-economy-pending:'+this.config.chainId+':'+this.config.stakingContract+':'+this.config.paymentContract+':'+address;}
 private exclusive<T>(address:string,fn:()=>Promise<T>){return (this.deps.lock??localEconomyLock).run(this.key(address),fn);}
 private savePending(value:Pending|null,expectedId?:string){
  const address=value?.from??this.transaction?.from??this.context?.address,store=this.deps.pending;
  if(!address||!store)throw new EconomyClientError('PENDING_STORAGE_UNAVAILABLE');const key=this.key(address),prior=store.get(key) as Partial<Pending>|null;
  if(expectedId&&prior?.intentId!==expectedId)return false;
  store.set(key,value);const saved=store.get(key) as Partial<Pending>|null;
  if(value?!saved||['version','nonce','intentId','chainId','from','to','data','hash','step','createdMs'].some(key=>saved[key as keyof Pending]!==value[key as keyof Pending]):saved!==null&&saved!==undefined)throw new EconomyClientError('PENDING_STORAGE_UNAVAILABLE');return true;
 }
 private adoptPending(value:unknown,address:string){
  const v=value as Partial<Pending>|null;
  if(!v||v.chainId!==1||v.from!==address||!economyAddress(v.to)||![this.config.token,this.config.stakingContract,this.config.paymentContract].includes(v.to)||(v.hash!==null&&(typeof v.hash!=='string'||!HASH.test(v.hash)))||typeof v.data!=='string'||v.data.length>266||!HEX.test(v.data)||!['reset','approve','execute'].includes(String(v.step))||typeof v.intentId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(v.intentId)||!Number.isSafeInteger(v.createdMs)||(v.createdMs as number)<=0||(v.version===2?!nonce(v.nonce):v.version!==undefined||v.nonce!==undefined))return false;
  this.transaction=v as Pending;this.sendAttempted=true;this.set({phase:'unknown',busy:false,plan:null,hash:v.hash??null,step:v.step!,legacyPending:v.version!==2,error:'PENDING_TRANSACTION'});return true;
 }
 /** Reads only a locally stored hash hint. Restoring never calls the provider. */
 restorePending(){
  if(this.locked||this.s.hash||!this.alive)return;
  const session=economySession(this.deps.auth(),this.now());if(!session)return;
  this.adoptPending(this.deps.pending?.get(this.key(session.address.toLowerCase())),session.address.toLowerCase());
 }
 private unbind(){for(const cleanup of this.cleanups)cleanup();this.cleanups=[];}
 private invalidate=()=>{this.generation++;this.set({phase:this.transaction?'unknown':'context-changed',busy:false,error:'CONTEXT_CHANGED'});};
 /** Called by the pane when AuthState changes, without asking the wallet anything. */
 contextChanged(){if(this.context){try{this.guard();}catch{this.invalidate();}}}
 private bind(){
  this.unbind();const provider=this.deps.provider(),session=economySession(this.deps.auth(),this.now());
  if(!provider||!session||!this.deps.auth().account||this.deps.auth().account!.toLowerCase()!==session.address.toLowerCase())throw new EconomyClientError('AUTH_REQUIRED');
  this.context={provider,session,address:session.address.toLowerCase(),generation:++this.generation,started:this.now()};
  for(const event of ['accountsChanged','chainChanged','disconnect']){provider.on?.(event,this.invalidate);this.cleanups.push(()=>provider.removeListener?.(event,this.invalidate));}
  if(this.deps.onProviderChange)this.cleanups.push(this.deps.onProviderChange(()=>{if(this.deps.provider()!==provider)this.invalidate();}));
 }
 private guard(){
  const c=this.context,state=this.deps.auth(),session=economySession(state,this.now());
  if(!this.alive||!c||c.generation!==this.generation||this.deps.provider()!==c.provider||session!==c.session||state.account?.toLowerCase()!==c.address||this.now()<c.started||this.abort.signal.aborted)throw new EconomyClientError('CONTEXT_CHANGED');
 }
 private async rpc(method:string,params?:unknown[]){
  this.guard();let timer:ReturnType<typeof setTimeout>|undefined;
  try{const value=await Promise.race([this.context!.provider.request({method,...params?{params}:{}}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new EconomyClientError('REQUEST_TIMEOUT')),Math.max(1,Math.min(15_000,this.deps.rpcTimeoutMs??15_000)));})]);this.guard();return value;}finally{if(timer!==undefined)clearTimeout(timer);}
 }
 private async verify(){
  this.guard();await this.client.verifySession(this.context!.session,this.abort.signal);this.guard();
  const active=await this.client.config(this.abort.signal);this.guard();
  if(!active.enabled)throw new EconomyClientError('NOT_CONFIGURED');
  if(['chainId','token','stakingContract','paymentContract','treasury','shareWei'].some(key=>active[key as keyof EconomyConfig]!==this.config[key as keyof EconomyConfig]))throw new EconomyClientError('CONFIG_CHANGED');
  const accounts=await this.rpc('eth_accounts');if(!Array.isArray(accounts)||!economyAddress(accounts[0])||accounts[0].toLowerCase()!==this.context!.address)throw new EconomyClientError('ACCOUNT_MISMATCH');
  const chain=await this.rpc('eth_chainId');if(chain!=='0x1')throw new EconomyClientError('CHAIN_MISMATCH');
 }
 private async call(to:string,name:FunctionName,args:readonly unknown[]=[]){
  const data=encodeEconomyCall(name,args),value=await this.rpc('eth_call',[{from:this.context!.address,to,data},'latest']);return decodeEconomyResult(name,value);
 }
 private planAmount(plan:EconomyPlan){return plan.kind==='pay'?BigInt(plan.payment.amount):BigInt(plan.shares)*SHARE_WEI;}
 private spender(plan:EconomyPlan){return plan.kind==='pay'?this.config.paymentContract:this.config.stakingContract;}
 private validatePlan(plan:EconomyPlan){
  if(plan.kind!=='withdraw'&&this.deps.canSpend&&!this.deps.canSpend())throw new EconomyClientError('ECONOMY_HALTED');
  if(plan.kind==='pay'){
   const p=plan.payment;if(p.chainId!==1||p.contract!==this.config.paymentContract||p.token!==this.config.token||p.receiver!==this.config.treasury||!HASH.test(p.orderId)||!economyInteger(p.amount,false)||!Number.isSafeInteger(plan.expiresMs)||plan.expiresMs<=this.now())throw new EconomyClientError('INVALID_ORDER');
  }else if(!economyInteger(plan.shares,false)||BigInt(plan.shares)>((1n<<256n)-1n)/SHARE_WEI||(plan.kind==='withdraw'&&!economyInteger(plan.positionId,false)))throw new EconomyClientError('INVALID_SHARES');
 }
 private async inspect(){
  const plan=this.s.plan!;this.validatePlan(plan);await this.verify();this.guard();
  const target=this.spender(plan),token=await this.call(target,'token');
  if(typeof token!=='string'||token.toLowerCase()!==this.config.token)throw new EconomyClientError('CONTRACT_MISMATCH');
  if(plan.kind==='pay'){
   const treasury=await this.call(target,'treasury');if(typeof treasury!=='string'||treasury.toLowerCase()!==this.config.treasury)throw new EconomyClientError('CONTRACT_MISMATCH');
   if(await this.call(target,'paid',[this.context!.address,plan.payment.orderId,BigInt(plan.payment.amount)]))throw new EconomyClientError('ORDER_ALREADY_PAID');
  }else{
   if(await this.call(target,'SHARE_SIZE')!==SHARE_WEI)throw new EconomyClientError('CONTRACT_MISMATCH');
   if(plan.kind==='withdraw'){
    const position=await this.call(target,'positions',[BigInt(plan.positionId)]) as [string,bigint];
    if(!Array.isArray(position)||position[0].toLowerCase()!==this.context!.address||position[1]<BigInt(plan.shares))throw new EconomyClientError('POSITION_CHANGED');
    this.set({phase:'confirm',busy:false});return;
   }
  }
  const amount=this.planAmount(plan),balance=await this.call(this.config.token,'balanceOf',[this.context!.address]);
  if(typeof balance!=='bigint'||balance<amount)throw new EconomyClientError('INSUFFICIENT_EMBEO');
  const allowance=await this.call(this.config.token,'allowance',[this.context!.address,target]);
  if(typeof allowance!=='bigint')throw new EconomyClientError('INVALID_CHAIN_RESPONSE');
  this.set({phase:allowance>=amount?'confirm':allowance>0n?'reset-required':'approve-required',busy:false,error:null});
 }
 private fail(error:unknown){const code=error instanceof EconomyClientError?error.code:(error as {code?:unknown})?.code===4001?'USER_REJECTED':'REQUEST_FAILED';if(code==='USER_REJECTED')this.sendAttempted=false;this.set({busy:false,phase:this.transaction||this.sendAttempted?'unknown':code==='USER_REJECTED'?'rejected':code==='CONTEXT_CHANGED'||code==='ACCOUNT_MISMATCH'?'context-changed':'error',error:code});}
 private async action(fn:()=>Promise<void>){if(this.locked||!this.alive)return;this.locked=true;try{await fn();}catch(error){this.fail(error);}finally{this.locked=false;}}
 async prepare(plan:EconomyPlan){return this.action(async()=>{
  if(this.transaction||this.sendAttempted)throw new EconomyClientError('PENDING_TRANSACTION');this.validatePlan(plan);this.bind();
  // Copy the plan so later caller/UI mutation cannot alter a prepared transaction.
  this.set({...initial(),phase:'checking',busy:true,plan:structuredClone(plan)});await this.inspect();
 });}
 async approve(){if(!['reset-required','approve-required'].includes(this.s.phase))return;return this.action(async()=>{
  const reset=this.s.phase==='reset-required',plan=this.s.plan!;this.set({phase:'checking',busy:true});await this.inspect();this.guard();
  if(this.s.phase!==(reset?'reset-required':'approve-required'))return;
  const data=encodeEconomyCall('approve',[this.spender(plan),reset?0n:this.planAmount(plan)]);
  await this.send(this.config.token,data,reset?'reset':'approve');
 });}
 async confirm(){if(this.s.phase!=='confirm')return;return this.action(async()=>{
  this.set({phase:'checking',busy:true});await this.inspect();this.guard();if(this.s.phase!=='confirm')return;
  const plan=this.s.plan!,data=plan.kind==='stake'?encodeEconomyCall('deposit',[BigInt(plan.shares)]):plan.kind==='withdraw'?encodeEconomyCall('withdraw',[BigInt(plan.positionId),BigInt(plan.shares)]):encodeEconomyCall('pay',[plan.payment.orderId,BigInt(plan.payment.amount)]);
  await this.send(this.spender(plan),data,'execute');
 });}
 private async send(to:string,data:Hex,step:Pending['step']){
  const address=this.context!.address;
  this.set({phase:'checking',busy:true,step,error:null});
  await this.exclusive(address,async()=>{
  await this.verify();this.guard();this.validatePlan(this.s.plan!);this.set({phase:'sending',busy:true,step,error:null});
  // A wallet may broadcast even if its response arrives after unmount/context change.
  // Keep the returned hash as a reconciliation hint before checking UI ownership.
  const c=this.context!,stored=this.deps.pending?.get(this.key(c.address));
  if(stored){this.adoptPending(stored,c.address);throw new EconomyClientError('PENDING_TRANSACTION');}
  const nextNonce=await this.rpc('eth_getTransactionCount',[c.address,'pending']);if(!nonce(nextNonce))throw new EconomyClientError('INVALID_CHAIN_RESPONSE');
  // The nonce read may outlive a quote or observe an indexing halt. Recheck
  // spend authority at the final boundary before persisting or prompting.
  this.guard();this.validatePlan(this.s.plan!);
  const intent:Pending={version:2,nonce:nextNonce,chainId:1,from:c.address,to,data,hash:null,step,intentId:crypto.randomUUID().replaceAll('-',''),createdMs:this.now()};
  // Persist before the wallet prompt: a lost/invalid hash reply may still follow
  // a real broadcast. A new pane/tab must retain the unresolved send intent.
  this.savePending(intent);this.transaction=intent;this.sendAttempted=true;
  let value:unknown;try{value=await c.provider.request({method:'eth_sendTransaction',params:[{from:c.address,to,data,value:'0x0',chainId:'0x1',nonce:nextNonce}]});}
  catch(error){if((error as {code?:unknown})?.code===4001){this.savePending(null,intent.intentId);this.transaction=null;this.sendAttempted=false;}throw error;}
  if(typeof value!=='string'||!HASH.test(value))throw new EconomyClientError('INVALID_TRANSACTION_HASH');
  this.transaction={...intent,hash:value as Hex};if(!this.savePending(this.transaction,intent.intentId))throw new EconomyClientError('PENDING_CHANGED');
  this.guard();this.set({phase:'pending',hash:value,busy:true});
  });
  await this.waitReceipt(this.transaction!.hash!);
 }
 private async waitReceipt(candidate:Hex){
  const attempts=Math.min(20,Math.max(1,this.deps.receiptAttempts??8));
  for(let i=0;i<attempts;i++){
   this.guard();const receipt=await this.rpc('eth_getTransactionReceipt',[candidate]);
   if(receipt!==null){await this.finishReceipt(receipt,candidate);return;}
   if(i+1<attempts){await (this.deps.delay??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(1500);this.guard();}
  }
  this.set({phase:'unknown',busy:false,error:'PENDING_TRANSACTION'});
 }
 private async finishReceipt(receipt:unknown,candidate:Hex){
  const tx=this.transaction!,r=receipt as {transactionHash?:unknown;status?:unknown;from?:unknown;to?:unknown;blockHash?:unknown;blockNumber?:unknown};
  if(tx.version!==2&&candidate.toLowerCase()!==tx.hash?.toLowerCase())throw new EconomyClientError('LEGACY_REVIEW_REQUIRED');
  if(!r||typeof r.transactionHash!=='string'||r.transactionHash.toLowerCase()!==candidate.toLowerCase()||typeof r.from!=='string'||r.from.toLowerCase()!==tx.from||(r.to!==null&&(typeof r.to!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(r.to)))||typeof r.blockHash!=='string'||!HASH.test(r.blockHash)||!quantity(r.blockNumber)||!['0x0','0x1'].includes(String(r.status)))throw new EconomyClientError('INVALID_CHAIN_RESPONSE');
  const record=await this.rpc('eth_getTransactionByHash',[candidate]) as {hash?:string;from?:string;to?:string|null;input?:string;value?:string;chainId?:string;nonce?:string;blockHash?:string;blockNumber?:string}|null;
  if(!record||record.hash?.toLowerCase()!==candidate.toLowerCase()||record.from?.toLowerCase()!==tx.from||record.chainId!=='0x1'||record.blockHash?.toLowerCase()!==r.blockHash.toLowerCase()||record.blockNumber!==r.blockNumber||(record.to?.toLowerCase()??null)!==(typeof r.to==='string'?r.to.toLowerCase():null)||typeof record.input!=='string'||!HEX.test(record.input)||!quantity(record.value)||(tx.version===2&&record.nonce!==tx.nonce))throw new EconomyClientError('TRANSACTION_MISMATCH');
  const same=record.to?.toLowerCase()===tx.to&&record.input.toLowerCase()===tx.data.toLowerCase()&&record.value==='0x0';
  if(tx.version!==2&&!same)throw new EconomyClientError('TRANSACTION_MISMATCH');
  // The wallet-returned original hash retains its normal mined confirmation.
  // A manually supplied/replacement hash needs irreversible nonce consumption
  // before it can release an unrelated original send intent.
  if(tx.hash?.toLowerCase()!==candidate.toLowerCase()||!same){
   const final=await this.rpc('eth_getBlockByNumber',['finalized',false]) as {number?:unknown;hash?:unknown}|null;
   if(!final||!quantity(final.number)||typeof final.hash!=='string'||!HASH.test(final.hash)||BigInt(final.number)<BigInt(r.blockNumber))throw new EconomyClientError('TRANSACTION_NOT_FINALIZED');
   const canonical=final.number===r.blockNumber?final:await this.rpc('eth_getBlockByNumber',[r.blockNumber,false]) as {number?:unknown;hash?:unknown}|null;
   if(!canonical||canonical.number!==r.blockNumber||typeof canonical.hash!=='string'||canonical.hash.toLowerCase()!==r.blockHash.toLowerCase())throw new EconomyClientError('TRANSACTION_MISMATCH');
  }
  await this.exclusive(tx.from,async()=>{
   this.guard();const stored=this.deps.pending?.get(this.key(tx.from)) as Partial<Pending>|null;
   // Another tab may already have reconciled this same nonce and removed its
   // record. Its absence does not invalidate the receipt proof. A newer intent
   // must instead remain protected and become this pane's current review.
   if(stored&&stored.intentId!==tx.intentId){this.adoptPending(stored,tx.from);throw new EconomyClientError('PENDING_CHANGED');}
   if(stored&&!this.savePending(null,tx.intentId))throw new EconomyClientError('PENDING_CHANGED');
   this.transaction=null;this.sendAttempted=false;this.set({busy:false,phase:!same?'replaced':r.status==='0x1'?'confirmed':'error',hash:candidate,legacyPending:false,error:!same?'TRANSACTION_REPLACED':r.status==='0x1'?null:'TRANSACTION_REVERTED'});
  });
  if(same&&r.status==='0x1'&&tx.step!=='execute'&&this.s.plan){this.set({phase:'checking',busy:true});await this.inspect();}
 }
 async checkReceipt(hash?:string){if(!this.transaction||!hash&&!this.transaction.hash)return;return this.action(async()=>{
  const candidate=hash??this.transaction!.hash!;if(!HASH.test(candidate))throw new EconomyClientError('INVALID_TRANSACTION_HASH');
  if(this.transaction!.version!==2&&candidate.toLowerCase()!==this.transaction!.hash?.toLowerCase())throw new EconomyClientError('LEGACY_REVIEW_REQUIRED');
  this.bind();if(this.context!.address!==this.transaction!.from)throw new EconomyClientError('ACCOUNT_MISMATCH');this.set({phase:'checking',busy:true});await this.verify();this.guard();this.set({phase:'pending',busy:true});await this.waitReceipt(candidate as Hex);
 });}
 /** Explicit player acknowledgement only. No send, signature or automatic retry. */
 async clearUnknownAfterWalletCheck(){if(!this.transaction||this.transaction.hash!==null&&this.transaction.version===2)return;return this.action(async()=>{
  this.bind();if(this.context!.address!==this.transaction!.from)throw new EconomyClientError('ACCOUNT_MISMATCH');await this.verify();this.guard();
  const tx=this.transaction!;await this.exclusive(tx.from,async()=>{
   this.guard();const current=this.deps.pending?.get(this.key(tx.from)) as Partial<Pending>|null;
   // A prompt in another tab may have returned a hash while this acknowledgement
   // waited for its lock. An earlier hashless acknowledgement cannot clear it.
   if(!current||current.intentId!==tx.intentId||current.hash!==tx.hash||current.version!==tx.version||current.nonce!==tx.nonce){this.adoptPending(current,tx.from);throw new EconomyClientError('PENDING_CHANGED');}
   if(!this.savePending(null,tx.intentId))throw new EconomyClientError('PENDING_CHANGED');this.transaction=null;this.sendAttempted=false;this.set(initial());
  });
 });}
 async payGold(order:EconomyOrder,requestId:string,challenge:EconomyGoldChallenge){order=structuredClone(order);challenge=structuredClone(challenge);let paid:EconomyOrder|undefined;await this.action(async()=>{
  if(this.deps.canSpend&&!this.deps.canSpend())throw new EconomyClientError('ECONOMY_HALTED');
  if(this.transaction||this.sendAttempted)throw new EconomyClientError('PENDING_TRANSACTION');this.bind();this.set({...initial(),phase:'checking',busy:true});
  const origin=this.deps.origin??globalThis.location?.origin;validateGoldChallenge(challenge,order,requestId,this.context!.session,origin??'',this.now());
  await this.verify();this.guard();validateGoldChallenge(challenge,order,requestId,this.context!.session,origin??'',this.now());if(this.deps.canSpend&&!this.deps.canSpend())throw new EconomyClientError('ECONOMY_HALTED');
  this.set({phase:'sending',busy:true});const hex='0x'+[...new TextEncoder().encode(challenge.message)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const signature=await this.context!.provider.request({method:'personal_sign',params:[hex,this.context!.address]});this.guard();
  validateGoldChallenge(challenge,order,requestId,this.context!.session,origin??'',this.now());
  if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))throw new EconomyClientError('INVALID_SIGNATURE');
  if(this.deps.canSpend&&!this.deps.canSpend())throw new EconomyClientError('ECONOMY_HALTED');paid=await this.client.payGold(order,requestId,signature,this.abort.signal);this.guard();this.set({phase:'confirmed',busy:false});
 });return paid;}
 dispose(){this.alive=false;this.generation++;this.abort.abort();this.unbind();this.listeners.clear();}
}
