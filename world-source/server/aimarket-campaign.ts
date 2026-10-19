import {economySessionClock,readEconomySession,revalidateEconomySession} from './economy-session.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from './aimarket-admin.ts';
import {goldCampaign,goldAdminCommand} from './world-gold.ts';
import {requireWorldGoldSchema} from './world-gold-schema.ts';
import type {D1Database} from './d1.ts';
import {API_HEADERS} from './world-api.ts';

type Deps={db?:D1Database;now:()=>number;allow:()=>Promise<boolean>};
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:API_HEADERS});
/** Free campaigns have no mainnet-contract/price dependency. This endpoint can
 * only schedule/stop a World research campaign; it cannot enable purchases,
 * change prices, mint GOLD, or grant an external website session access. */
export async function handleAIMarketCampaign(request:Request,deps:Deps):Promise<Response|null>{
  const u=new URL(request.url);if(u.pathname!=='/api/me/aimarket-campaign')return null;
  const local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site'),write=request.method==='POST';
  if((u.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==u.origin)||(site!==null&&!['same-origin','none'].includes(site))||write&&origin!==u.origin)return reply(403,{error:'FORBIDDEN_ORIGIN'});
  if(request.method!=='GET'&&!write)return reply(405,{error:'METHOD_NOT_ALLOWED'});
  if(!deps.db)return reply(503,{error:'CAMPAIGN_UNAVAILABLE'});
  try{
    const db=deps.db,clock=economySessionClock(deps.now);clock();
    if(!await deps.allow())return reply(429,{error:'RATE_LIMITED'});
    let b:Record<string,unknown>|null=null;
    if(write){
      if(u.search||request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||!request.body)return reply(400,{error:'BAD_REQUEST'});
      const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
      try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>2048){await reader.cancel();throw Error('BAD_REQUEST');}raw+=decoder.decode(c.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
      const o=JSON.parse(raw);if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).sort().join()!=='endsMs,expectedAddress,reason,requestId,startsMs,stopped,version')return reply(400,{error:'BAD_REQUEST'});b=o;
    }
    const expected=b?.expectedAddress??u.searchParams.get('expected_address');
    if(typeof expected!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(expected)||!write&&(u.searchParams.size!==1||u.search.length>128))return reply(400,{error:'BAD_REQUEST'});
    const session=await readEconomySession(request,db,clock),at=clock();
    if(typeof session==='string')return reply(401,{error:'AUTH_REQUIRED'});
    const wallet=session.address.toLowerCase();if(wallet!==expected.toLowerCase())return reply(409,{error:'ACCOUNT_CONTEXT_CHANGED'});
    if(!AIMARKET_ACTIVITY_ADMIN_WALLETS.includes(wallet))return reply(403,{error:'ADMIN_REQUIRED'});
    await requireWorldGoldSchema(db);
    if(write){
      if(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA')return reply(403,{error:'EOA_REQUIRED'});
      if(typeof b!.requestId!=='string'||typeof b!.reason!=='string'||!Number.isSafeInteger(b!.version)||!Number.isSafeInteger(b!.startsMs)||!Number.isSafeInteger(b!.endsMs)||typeof b!.stopped!=='boolean')return reply(400,{error:'BAD_REQUEST'});
      try{await goldAdminCommand(db,{wallet,requestId:b!.requestId,reason:b!.reason,nowMs:at,now:clock,authorization:{tokenHash:session.tokenHash},command:{action:'campaign',version:b!.version as number,startsMs:b!.startsMs as number,endsMs:b!.endsMs as number,stopped:b!.stopped}});}
      catch(e){if(e instanceof Error&&e.message==='INVALID_CLOCK')throw e;if(!await revalidateEconomySession(request,db,session,clock))return reply(401,{error:'AUTH_REQUIRED'});throw e;}
    }
    const campaign=await goldCampaign(db,clock());
    if(!await revalidateEconomySession(request,db,session,clock))return reply(401,{error:'AUTH_REQUIRED'});
    return reply(200,{address:wallet,campaign});
  }catch(e){const code=e instanceof Error?e.message:'';return reply(code==='AUTH_REQUIRED'?401:code==='BAD_REQUEST'?400:['INVALID_CAMPAIGN','INVALID_REQUEST_ID','REASON_REQUIRED','IDEMPOTENCY_CONFLICT','ATOMIC_GUARD_FAILED'].includes(code)?409:503,{error:/^[A-Z][A-Z0-9_]{1,60}$/.test(code)?code:'CAMPAIGN_UNAVAILABLE'});}
}
