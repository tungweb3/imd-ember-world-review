import {readSession} from './auth.ts';
import type {D1Database} from './d1.ts';
import {API_HEADERS} from './world-api.ts';

// Human-authorized on 2026-10-16. This role is only for World AIMarket trial
// management; it does not grant VPS owner, research, payment or NFT authority.
export const AIMARKET_ACTIVITY_ADMIN_ROLE='aimarket:trial:manage';
export const AIMARKET_ACTIVITY_ADMIN_WALLETS:readonly string[]=Object.freeze([
  '0x30e3e579e7eae086e6d53999f95fac5933e4d0aa',
  '0x18d85dbddf15b38dce122afffb3356424dfee653',
  '0x1c651928150daddda9c2c040a9d4901d862f8ec4'
]);
const WALLETS=new Set(AIMARKET_ACTIVITY_ADMIN_WALLETS);
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
type AdminDeps={db?:D1Database;now?:()=>number;client?:string;allow?:(key:string)=>boolean|Promise<boolean>};
const reply=(status:number,value:unknown,extra:Record<string,string>={})=>new Response(JSON.stringify(value),{status,headers:{...API_HEADERS,...extra}});
const error=(status:number,code:string,extra?:Record<string,string>)=>reply(status,{error:code},extra);
const validClock=(value:number)=>Number.isSafeInteger(value)&&value>0;

/** A same-origin, read-only role lookup. expected_address guards wallet-switch
 *  races; only the server's live SIWE session supplies the authorized identity.
 *  No campaign is enabled here and no database row or bridge scope is changed. */
export async function handleAIMarketAdmin(request:Request,deps:AdminDeps={}):Promise<Response|null>{
  const url=new URL(request.url);
  if(url.pathname!=='/api/me/aimarket-admin')return null;
  const local=url.protocol==='http:'&&LOOPBACK.has(url.hostname);
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((url.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==url.origin)||
    (site!==null&&site!=='same-origin'&&site!=='none'))return error(403,'FORBIDDEN_ORIGIN');
  if(request.method!=='GET')return error(405,'METHOD_NOT_ALLOWED',{Allow:'GET'});
  const expected=url.searchParams.get('expected_address');
  if(url.search.length>256||url.searchParams.size!==1||!expected||!ADDRESS.test(expected))return error(400,'BAD_REQUEST');
  if(!deps.db||!deps.allow)return error(503,'ADMIN_UNAVAILABLE');
  try{
    const clock=deps.now??Date.now,started=clock();
    if(!validClock(started))return error(503,'ADMIN_UNAVAILABLE');
    if(!await deps.allow('aimarket-admin:'+(deps.client??'unknown')))return error(429,'RATE_LIMITED',{'Retry-After':'60'});
    const session=await readSession(request,deps.db,started);
    if(typeof session==='string')return error(401,session==='SESSION_EXPIRED'?'SESSION_EXPIRED':'AUTH_REQUIRED');
    const at=clock();
    if(!validClock(at)||at<started)return error(503,'ADMIN_UNAVAILABLE');
    if(!ADDRESS.test(session.address)||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=at||
      (session.verificationMethod!=='ECDSA'&&session.verificationMethod!=='ERC1271'))return error(401,'AUTH_REQUIRED');
    const address=session.address.toLowerCase();
    if(address!==expected.toLowerCase())return error(409,'ACCOUNT_MISMATCH');
    const canManageFreeTrial=WALLETS.has(address);
    return reply(200,{address,expiresAt:session.expiresAt,role:canManageFreeTrial?AIMARKET_ACTIVITY_ADMIN_ROLE:null,canManageFreeTrial});
  }catch{return error(503,'ADMIN_UNAVAILABLE');}
}
