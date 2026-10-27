import {economySessionClock,readEconomySession,revalidateEconomySession,economySessionFailure} from './economy-session.ts';
import {hasGoldResultContract} from './world-gold-result.ts';
import {API_HEADERS} from './world-api.ts';
import type {D1Database} from './d1.ts';
import type {EconomyConfig} from './economy-config.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from './aimarket-admin.ts';
import {goldProducts,worldGoldSnapshot,goldQuote,goldCampaign,goldAdminCommand,reconcileWorldGold} from './world-gold.ts';
import {requireWorldGoldSchema} from './world-gold-schema.ts';
import type {FastCreditOutcome} from './world-gold-fast.ts';
/** GOLD fast credit (server/world-gold-fast.ts), bound by the Worker to its rate-limited chain RPC; absent = off. */
type FastCredit=(args:{wallet:string;orderId:string;transactionHash:string;nowMs:number})=>Promise<FastCreditOutcome>;
type Deps={db?:D1Database;config?:EconomyConfig|null;now?:()=>number;allow?:(key:string)=>boolean|Promise<boolean>;client?:string;serviceReady?:boolean;serviceProducts?:readonly string[];fastCredit?:FastCredit};
/** A fast-credit request whose transaction is not exactly this pending quote's payment: the finalized path decides. */
const FAST_REFUSALS=['NOT_A_TOPUP','ORDER_NOT_PENDING','PAYMENT_DOES_NOT_MATCH_ORDER','NO_PAYMENT_FOR_ORDER','TRANSACTION_FAILED','DUPLICATE_ORDER_PAYMENT','PAYMENT_ALREADY_USED'];
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:API_HEADERS});
const bad=(status:number,error:string)=>reply(status,{error});
const address=/^0x[0-9a-fA-F]{40}$/;
const exact=(o:Record<string,unknown>,keys:string[])=>Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
async function body(r:Request){
 if(r.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||!r.body)throw Error('BAD_REQUEST');
 const reader=r.body.getReader();let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
 try{for(;;){const b=await reader.read();if(b.done)break;size+=b.value.length;if(size>4096){await reader.cancel();throw Error('BAD_REQUEST');}text+=decoder.decode(b.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 const o=JSON.parse(text);if(!o||typeof o!=='object'||Array.isArray(o))throw Error('BAD_REQUEST');return o as Record<string,unknown>;
}
function command(o:unknown){
 if(!o||typeof o!=='object'||Array.isArray(o))throw Error('BAD_REQUEST');const c=o as Record<string,unknown>;
 const keys=c.action==='product'?['action','product','kind','title','gold','enabled','version',...(c.kind==='topup'?['embeo']:[])]:c.action==='campaign'?['action','version','startsMs','endsMs','stopped']:c.action==='control'?['action','feature','enabled','version']:['action','orderId'];
 if(!exact(c,keys)||!['product','campaign','control','repair-topup','refund-service'].includes(c.action as string))throw Error('BAD_REQUEST');
 return c as Parameters<typeof goldAdminCommand>[1]['command'];
}
/** Same World cookie and identity; spending continues through the existing
 * explicit GOLD-payment signature. No client receipt or amount can add GOLD:
 * fast-credit takes only a transaction hash, whose receipt the server fetches and verifies itself. */
export async function handleWorldGoldApi(request:Request,deps:Deps={}):Promise<Response|null>{
 const u=new URL(request.url),me=u.pathname==='/api/me/gold',trial=u.pathname==='/api/me/aimarket-trial',base=u.pathname==='/api/gold/state',quote=u.pathname==='/api/gold/quote',admin=u.pathname==='/api/gold/admin',retry=/^\/api\/gold\/orders\/(0x[0-9a-f]{64})\/reconcile$/.exec(u.pathname),fast=/^\/api\/gold\/orders\/(0x[0-9a-f]{64})\/fast-credit$/.exec(u.pathname);
 if(!me&&!trial&&!u.pathname.startsWith('/api/gold/'))return null;
 const local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
 if((u.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==u.origin)||(site!==null&&!['same-origin','none'].includes(site)))return bad(403,'FORBIDDEN_ORIGIN');
 if(!me&&!trial&&!base&&!quote&&!admin&&!retry&&!fast)return bad(404,'NOT_FOUND');
 const write=request.method==='POST';if((!['GET','POST'].includes(request.method))||((me||trial||base)&&write)||((quote||retry||fast)&&!write))return bad(405,'METHOD_NOT_ALLOWED');
 if(write&&(origin!==u.origin||u.search))return bad(403,'FORBIDDEN_ORIGIN');
 if(!deps.db||!deps.allow)return bad(503,'GOLD_NOT_CONFIGURED');
 let checkSession:(()=>Promise<boolean>)|undefined;
 try{
  const clock=economySessionClock(deps.now??Date.now),started=clock();
  // Fast credit polls for about 90 s right after a payment, while the panel is also refreshing: its own budget key,
  // so neither starves the other (2026-10-26: a shared budget ran out and the credit fell back to finality).
  if(!await deps.allow((fast?'world-gold-fast:':'world-gold:')+(deps.client??'unknown')))return bad(429,'RATE_LIMITED');
  const b=write?await body(request):null,expected=b?.expectedAddress??u.searchParams.get('expected_address');
  const lookup=admin?u.searchParams.get('order_id'):null;
  if(typeof expected!=='string'||!address.test(expected)||(!write&&(u.searchParams.size!==(lookup?2:1)||u.search.length>256))||(lookup!==null&&!/^0x[0-9a-f]{64}$/.test(lookup)))return bad(400,'BAD_REQUEST');
  const session=await readEconomySession(request,deps.db,clock);
  if(typeof session==='string')return bad(401,'AUTH_REQUIRED');const now=clock();
  if(!Number.isSafeInteger(now)||now<started||session.expiresAt<=now||!['ECDSA','ERC1271'].includes(session.verificationMethod??''))return bad(401,'AUTH_REQUIRED');
  checkSession=()=>revalidateEconomySession(request,deps.db!,session,clock);
  const wallet=session.address.toLowerCase();if(wallet!==expected.toLowerCase())return !await checkSession()?bad(401,'AUTH_REQUIRED'):bad(409,'ACCOUNT_MISMATCH');
  const isAdmin=AIMARKET_ACTIVITY_ADMIN_WALLETS.includes(wallet);
  const serviceable=(product?:string)=>deps.serviceReady===true&&(product===undefined?deps.serviceProducts===undefined||deps.serviceProducts.some(hasGoldResultContract):hasGoldResultContract(product)&&(deps.serviceProducts===undefined||deps.serviceProducts.includes(product)));
  const authReply=async(value:unknown,status=200)=>{if(!await revalidateEconomySession(request,deps.db!,session,clock))return bad(401,'AUTH_REQUIRED');return reply(status,value);};
  if(admin&&!isAdmin)return await authReply({error:'ADMIN_REQUIRED'},403);
  if(write&&(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA'))return await authReply({error:'EOA_REQUIRED'},403);
  await requireWorldGoldSchema(deps.db);
  if(!write){
   if(trial)return await authReply({address:wallet,campaign:await goldCampaign(deps.db,now)});
   if(admin&&lookup){const order=await deps.db.prepare(`SELECT o.*,l.kind,l.product_id,CAST(l.gold AS TEXT) gold,j.state delivery,j.failure,j.delivery_evidence_json FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id LEFT JOIN world_gold_jobs j ON j.order_id=o.id WHERE o.id=?`).bind(lookup).first();if(!order)return await authReply({error:'ORDER_NOT_FOUND'},404);return await authReply({order});}
   const snapshot=await worldGoldSnapshot(deps.db,wallet,now);
   if(me)return await authReply(snapshot);
   const [products,campaign,controls]=await Promise.all([goldProducts(deps.db),goldCampaign(deps.db,now),deps.db.prepare('SELECT feature,enabled,version FROM world_gold_controls ORDER BY feature').all()]);
   const actions=admin?await deps.db.prepare('SELECT wallet,action,payload,created_ms,before_json,after_json FROM world_gold_admin_actions ORDER BY created_ms DESC,id DESC LIMIT 100').all():null;
   return await authReply({...snapshot,products:products.map(p=>({...p,serviceable:p.kind==='topup'||serviceable(p.product)})),campaign,controls:controls.results,isAdmin,...actions?{actions:actions.results}:{},payment:deps.config?{chainId:deps.config.chainId,token:deps.config.token,contract:deps.config.paymentContract,treasury:deps.config.treasury}:null,paymentsReady:!!deps.config,formalPricesSet:products.some(p=>p.enabled&&p.kind==='topup'),deliveryReady:serviceable()});
  }
  if(!await revalidateEconomySession(request,deps.db,session,clock))return bad(401,'AUTH_REQUIRED');
  const auth={tokenHash:session.tokenHash};
  // SQL remains authoritative; the common catch revalidates read/write failures.
  if(quote){if(!deps.config)return await authReply({error:'GOLD_NOT_CONFIGURED'},503);if(!exact(b!,['expectedAddress','requestId','product'])||typeof b!.product!=='string'||typeof b!.requestId!=='string')return await authReply({error:'BAD_REQUEST'},400);
   const id=await goldQuote({db:deps.db,config:deps.config!,nowMs:clock(),now:clock,serviceReady:serviceable(b!.product)},{wallet,requestId:b!.requestId,product:b!.product,authorization:auth});return await authReply({orderId:id});}
  if(admin){if(!exact(b!,['expectedAddress','requestId','command','reason'])||typeof b!.reason!=='string'||typeof b!.requestId!=='string')return await authReply({error:'BAD_REQUEST'},400);
   const cmd=command(b!.command),ready=serviceable(cmd.action==='product'&&cmd.kind==='service'?cmd.product:undefined);
   if(!deps.config&&cmd.action!=='repair-topup'&&cmd.action!=='refund-service')return await authReply({error:'GOLD_NOT_CONFIGURED'},503);
   const result=await goldAdminCommand(deps.db,{wallet,requestId:b!.requestId,command:cmd,reason:b!.reason,nowMs:clock(),now:clock,authorization:auth,serviceReady:ready});return await authReply({ok:true,result});}
  if(fast){
   if(!exact(b!,['expectedAddress','transactionHash'])||typeof b!.transactionHash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(b!.transactionHash))return await authReply({error:'BAD_REQUEST'},400);
   if(!deps.config||!deps.fastCredit)return await authReply({error:'FAST_CREDIT_UNAVAILABLE'},503);
   const outcome=await deps.fastCredit({wallet,orderId:fast[1],transactionHash:b!.transactionHash.toLowerCase(),nowMs:clock()});return await authReply(outcome);
  }
  if(!exact(b!,['expectedAddress']))return await authReply({error:'BAD_REQUEST'},400);
  if(!await deps.db.prepare('SELECT id FROM economy_orders WHERE id=? AND wallet=?').bind(retry![1],wallet).first())return await authReply({error:'ORDER_NOT_FOUND'},404);
  // Reconciliation repairs already-owed rights, also run by cron. A concurrent
  // logout cannot undo an owed credit; it must refuse success to this request.
  const result=await reconcileWorldGold(deps.db,clock(),retry![1]);return result.failures.length?await authReply({ok:false,error:result.failures[0].code},409):await authReply({ok:true});
 }catch(e){e=await economySessionFailure(e,checkSession);const code=e instanceof Error?e.message:'GOLD_UNAVAILABLE';return bad(code==='AUTH_REQUIRED'?401:code==='ORDER_NOT_FOUND'?404:FAST_REFUSALS.includes(code)?409:code==='INVALID_CLOCK'||code==='INVALID_SETTLEMENT_CLOCK'?503:code==='BAD_REQUEST'||code==='INVALID_PRODUCT'||code==='INVALID_REQUEST_ID'?400:code==='ADMIN_REQUIRED'?403:code.startsWith('INVALID_')||code.endsWith('_REQUIRED')||code==='ORDER_EXPIRED'||code==='VERSION_CONFLICT'||code.endsWith('_NOT_ENTITLED')||code==='ECONOMY_HALTED'||code==='ECONOMY_CONFIG_REPLACED'||code==='IDEMPOTENCY_CONFLICT'||code==='FEATURE_PAUSED'||code==='PRODUCT_UNAVAILABLE'||code==='PASS_ALREADY_ACTIVE'||code==='PASS_ORDER_PENDING'?409:503,/^[A-Z][A-Z0-9_]{1,80}$/.test(code)?code:'GOLD_UNAVAILABLE');}
}
