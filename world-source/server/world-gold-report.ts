import {economySessionClock,readEconomySession,revalidateEconomySession} from './economy-session.ts';
import {API_HEADERS} from './world-api.ts';
import type {D1Database} from './d1.ts';
import type {ResearchDeliveryProvider} from './aimarket-delivery.ts';
export async function handleWorldGoldReport(request:Request,deps:{db?:D1Database;provider?:ResearchDeliveryProvider;now:()=>number;allow:()=>Promise<boolean>}):Promise<Response|null>{
  const u=new URL(request.url),m=/^\/api\/gold\/orders\/(0x[0-9a-f]{64})\/report$/.exec(u.pathname);if(!m)return null;
  const reply=(s:number,v:unknown)=>new Response(JSON.stringify(v),{status:s,headers:API_HEADERS});
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site'),local=u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);
  if((u.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==u.origin)||(site!==null&&!['same-origin','none'].includes(site)))return reply(403,{error:'FORBIDDEN_ORIGIN'});
  if(request.method!=='GET')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  const expected=u.searchParams.get('expected_address');if(u.searchParams.size!==1||!expected||!/^0x[0-9a-fA-F]{40}$/.test(expected))return reply(400,{error:'BAD_REQUEST'});
  if(!deps.db||!deps.provider)return reply(503,{error:'REPORT_UNAVAILABLE'});
  try{
    const clock=economySessionClock(deps.now);clock();if(!await deps.allow())return reply(429,{error:'RATE_LIMITED'});
    const s=await readEconomySession(request,deps.db,clock);if(typeof s==='string')return reply(401,{error:'AUTH_REQUIRED'});
    const wallet=s.address.toLowerCase();if(wallet!==expected.toLowerCase())return reply(409,{error:'ACCOUNT_CONTEXT_CHANGED'});
    const row=await deps.db.prepare("SELECT j.result_json FROM world_gold_jobs j JOIN economy_orders o ON o.id=j.order_id JOIN world_gold_links l ON l.order_id=o.id JOIN world_gold_products p ON p.id=l.product_id WHERE o.id=? AND o.wallet=? AND o.status='paid' AND j.state='delivered' AND p.product='research'").bind(m[1],wallet).first<{result_json:string}>();
    if(!row)return reply(404,{error:'REPORT_NOT_FOUND'});
    const result=JSON.parse(row.result_json);if(result?.provider!=='aimarket-vps-v1'||typeof result.reportId!=='string'||result.reportId!==result.documentHash)throw Error();
    const document=await deps.provider.readReport({orderId:m[1],wallet,product:'research',reference:result.reportId});
    if(!await revalidateEconomySession(request,deps.db,s,clock))return reply(401,{error:'AUTH_REQUIRED'});
    return reply(200,{orderId:m[1],document});
  }catch{return reply(503,{error:'REPORT_UNAVAILABLE'});}
}
