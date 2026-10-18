import {readSession} from './auth.ts';
import {API_HEADERS} from './world-api.ts';
import type {D1Database} from './d1.ts';
import type {EconomyConfig} from './economy-config.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from './aimarket-admin.ts';
import {goldProducts,worldGoldSnapshot,goldQuote,goldCampaign,goldAdminCommand,reconcileWorldGold} from './world-gold.ts';
type Deps={db?:D1Database;config?:EconomyConfig|null;now?:()=>number;allow?:(key:string)=>boolean|Promise<boolean>;client?:string;serviceReady?:boolean};
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
 * explicit GOLD-payment signature. No client receipt or amount can add GOLD. */
export async function handleWorldGoldApi(request:Request,deps:Deps={}):Promise<Response|null>{
 const u=new URL(request.url),me=u.pathname==='/api/me/gold',trial=u.pathname==='/api/me/aimarket-trial',base=u.pathname==='/api/gold/state',quote=u.pathname==='/api/gold/quote',admin=u.pathname==='/api/gold/admin',retry=/^\/api\/gold\/orders\/(0x[0-9a-f]{64})\/reconcile$/.exec(u.pathname);
 if(!me&&!trial&&!u.pathname.startsWith('/api/gold/'))return null;
 const local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
 if((u.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==u.origin)||(site!==null&&!['same-origin','none'].includes(site)))return bad(403,'FORBIDDEN_ORIGIN');
 if(!me&&!trial&&!base&&!quote&&!admin&&!retry)return bad(404,'NOT_FOUND');
 const write=request.method==='POST';if((!['GET','POST'].includes(request.method))||((me||trial||base)&&write)||((quote||retry)&&!write))return bad(405,'METHOD_NOT_ALLOWED');
 if(write&&(origin!==u.origin||u.search))return bad(403,'FORBIDDEN_ORIGIN');
 if(!deps.db||!deps.config||!deps.allow)return bad(503,'GOLD_NOT_CONFIGURED');
 try{
  const clock=deps.now??Date.now,started=clock();if(!Number.isSafeInteger(started)||started<=0)throw Error('INVALID_CLOCK');
  if(!await deps.allow('world-gold:'+(deps.client??'unknown')))return bad(429,'RATE_LIMITED');
  const b=write?await body(request):null,expected=b?.expectedAddress??u.searchParams.get('expected_address');
  const lookup=admin?u.searchParams.get('order_id'):null;
  if(typeof expected!=='string'||!address.test(expected)||(!write&&(u.searchParams.size!==(lookup?2:1)||u.search.length>256))||(lookup!==null&&!/^0x[0-9a-f]{64}$/.test(lookup)))return bad(400,'BAD_REQUEST');
  const session=await readSession(request,deps.db,clock());
  if(typeof session==='string')return bad(401,'AUTH_REQUIRED');const now=clock();
  if(!Number.isSafeInteger(now)||now<started||session.expiresAt<=now||!['ECDSA','ERC1271'].includes(session.verificationMethod??''))return bad(401,'AUTH_REQUIRED');
  const wallet=session.address.toLowerCase();if(wallet!==expected.toLowerCase())return bad(409,'ACCOUNT_MISMATCH');
  const isAdmin=AIMARKET_ACTIVITY_ADMIN_WALLETS.includes(wallet);
  if(admin&&!isAdmin)return bad(403,'ADMIN_REQUIRED');
  if(write&&(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA'))return bad(403,'EOA_REQUIRED');
  if(!write){
   if(trial)return reply(200,{address:wallet,campaign:await goldCampaign(deps.db,now)});
   if(admin&&lookup){const order=await deps.db.prepare(`SELECT o.*,l.kind,l.product_id,CAST(l.gold AS TEXT) gold,j.state delivery,j.failure,j.delivery_evidence_json FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id LEFT JOIN world_gold_jobs j ON j.order_id=o.id WHERE o.id=?`).bind(lookup).first();if(!order)return bad(404,'ORDER_NOT_FOUND');return reply(200,{order});}
   const snapshot=await worldGoldSnapshot(deps.db,wallet,now);
   if(me)return reply(200,snapshot);
   const [products,campaign,controls]=await Promise.all([goldProducts(deps.db),goldCampaign(deps.db,now),deps.db.prepare('SELECT feature,enabled,version FROM world_gold_controls ORDER BY feature').all()]);
   const actions=admin?await deps.db.prepare('SELECT wallet,action,payload,created_ms,before_json,after_json FROM world_gold_admin_actions ORDER BY created_ms DESC,id DESC LIMIT 100').all():null;
   return reply(200,{...snapshot,products,campaign,controls:controls.results,isAdmin,...actions?{actions:actions.results}:{},payment:{chainId:deps.config.chainId,token:deps.config.token,contract:deps.config.paymentContract,treasury:deps.config.treasury},formalPricesSet:false,deliveryReady:deps.serviceReady===true});
  }
  const fresh=await readSession(request,deps.db,clock());if(typeof fresh==='string'||fresh.address.toLowerCase()!==wallet||fresh.expiresAt<=clock()||fresh.verificationMethod!=='ECDSA'||fresh.walletType!=='EOA')return bad(401,'AUTH_REQUIRED');
  const auth={tokenHash:fresh.tokenHash};
  if(quote){if(!exact(b!,['expectedAddress','requestId','product'])||typeof b!.product!=='string'||typeof b!.requestId!=='string')return bad(400,'BAD_REQUEST');
   const id=await goldQuote({db:deps.db,config:deps.config,nowMs:clock(),now:clock,serviceReady:deps.serviceReady},{wallet,requestId:b!.requestId,product:b!.product,authorization:auth});return reply(200,{orderId:id});}
  if(admin){if(!exact(b!,['expectedAddress','requestId','command','reason'])||typeof b!.reason!=='string'||typeof b!.requestId!=='string')return bad(400,'BAD_REQUEST');
   const result=await goldAdminCommand(deps.db,{wallet,requestId:b!.requestId,command:command(b!.command),reason:b!.reason,nowMs:clock(),now:clock,authorization:auth,serviceReady:deps.serviceReady});return reply(200,{ok:true,result});}
  if(!exact(b!,['expectedAddress']))return bad(400,'BAD_REQUEST');
  if(!await deps.db.prepare('SELECT id FROM economy_orders WHERE id=? AND wallet=?').bind(retry![1],wallet).first())return bad(404,'ORDER_NOT_FOUND');
  const result=await reconcileWorldGold(deps.db,clock(),retry![1]);return result.failures.length?reply(409,{ok:false,error:result.failures[0].code}):reply(200,{ok:true});
 }catch(e){const code=e instanceof Error?e.message:'GOLD_UNAVAILABLE';return bad(code==='BAD_REQUEST'||code==='INVALID_PRODUCT'||code==='INVALID_REQUEST_ID'?400:code==='ADMIN_REQUIRED'?403:code.startsWith('INVALID_')||code.endsWith('_REQUIRED')||code==='IDEMPOTENCY_CONFLICT'||code==='FEATURE_PAUSED'||code==='PRODUCT_UNAVAILABLE'?409:503,/^[A-Z][A-Z0-9_]{1,80}$/.test(code)?code:'GOLD_UNAVAILABLE');}
}
