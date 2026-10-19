import {encodeFunctionData,decodeFunctionResult,multicall3Abi} from 'viem';
import {economySessionClock,readEconomySession,revalidateEconomySession} from './economy-session.ts';
import {rpc,MULTICALL3,type ChainAccess} from './ownership.ts';
import {ECONOMY_ADDRESS,ECONOMY_TOKEN,ECONOMY_SHARE_WEI,type EconomyConfig} from './economy-config.ts';
import {economyChainState} from './economy-ledger.ts';
import {goldBalanceStatement,goldBalanceView} from './world-gold.ts';
import {requireWorldGoldSchema} from './world-gold-schema.ts';
import {API_HEADERS} from './world-api.ts';
import type {D1Database} from './d1.ts';

const READS=[
 {type:'function',name:'getBlockNumber',stateMutability:'view',inputs:[],outputs:[{type:'uint256'}]},
 {type:'function',name:'getChainId',stateMutability:'view',inputs:[],outputs:[{type:'uint256'}]},
 {type:'function',name:'balanceOf',stateMutability:'view',inputs:[{name:'owner',type:'address'}],outputs:[{type:'uint256'}]},
] as const;
/** One fixed-asset, same-block read. This is a displayed latest balance, never
 * proof of payment or staking rewards. No client-selected token/RPC/call data. */
export async function readWalletEmbeo(chain:ChainAccess,wallet:string){
 if(!ECONOMY_ADDRESS.test(wallet))throw Error('INVALID_ADDRESS');
 const calls=[
  {target:MULTICALL3,allowFailure:false,callData:encodeFunctionData({abi:READS,functionName:'getBlockNumber'})},
  {target:MULTICALL3,allowFailure:false,callData:encodeFunctionData({abi:READS,functionName:'getChainId'})},
  {target:ECONOMY_TOKEN,allowFailure:false,callData:encodeFunctionData({abi:READS,functionName:'balanceOf',args:[wallet as `0x${string}`]})},
 ] as const;
 const data=encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[calls]}),{result,error}=await rpc(chain,'eth_call',[{to:MULTICALL3,data},'latest']);
 if(error||typeof result!=='string'||!/^0x[0-9a-fA-F]+$/.test(result))throw Error('BALANCE_UNAVAILABLE');
 const rows=decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:result as `0x${string}`});
 if(rows.length!==3||rows.some(r=>!r.success||!/^0x[0-9a-fA-F]{64}$/.test(r.returnData)))throw Error('BALANCE_UNAVAILABLE');
 const [block,chainId,atomic]=rows.map(r=>BigInt(r.returnData));
 if(chainId!==1n||block<=0n)throw Error('BALANCE_UNAVAILABLE');
 return {status:'ok' as const,atomic:String(atomic),block:String(block)};
}

type Deps={db?:D1Database;config:()=>Promise<EconomyConfig|null>;chain:ChainAccess;now?:()=>number;allow:(bucket:'home'|'chain',key?:string)=>Promise<boolean>|boolean;client:string};
/** Private read-only balance view. Authenticate before keyed chain access and
 * revalidate after all I/O, so logout/expiry cannot return a late wallet view. */
export async function handleMemberBalances(request:Request,deps:Deps):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!=='/api/me/balances')return null;
 const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:API_HEADERS});
 const bad=(status:number,error:string)=>reply(status,{error});
 const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site'),local=url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if((url.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==url.origin)||(site!==null&&!['same-origin','none'].includes(site)))return bad(403,'FORBIDDEN_ORIGIN');
 if(request.method!=='GET')return bad(405,'METHOD_NOT_ALLOWED');
 const keys=[...url.searchParams.keys()],expected=url.searchParams.get('expected_address');
 if(keys.length!==1||keys[0]!=='expected_address'||!expected||!ECONOMY_ADDRESS.test(expected))return bad(400,'BAD_REQUEST');
 if(!deps.db)return bad(503,'BALANCE_UNAVAILABLE');
 try{
  const clock=economySessionClock(deps.now??Date.now),started=clock();
  if(!Number.isSafeInteger(started)||started<=0)return bad(503,'BALANCE_UNAVAILABLE');
  if(!await deps.allow('home',deps.client))return bad(429,'RATE_LIMITED');
  const session=await readEconomySession(request,deps.db,clock);if(typeof session==='string')return bad(401,session==='SESSION_EXPIRED'?'SESSION_EXPIRED':'AUTH_REQUIRED');
  const wallet=session.address.toLowerCase();if(wallet!==expected.toLowerCase())return bad(409,'ACCOUNT_CONTEXT_CHANGED');
  let config:EconomyConfig|null=null;try{config=await deps.config();}catch{/* release gate stays closed */}
  // One readiness query shared by both private DB reads. The summary reads no
  // reports/history and does not force their 100-row payloads on every refresh.
  const ready=requireWorldGoldSchema(deps.db).then(()=>true,()=>false);
  const [embeo,staked,gold]=await Promise.all([
   (async()=>{try{if(!await deps.allow('chain','member:embeo'))throw Error();return await readWalletEmbeo(deps.chain,wallet);}catch{return {status:'unavailable' as const};}})(),
   (async()=>{if(!config)return {status:'not-configured' as const};try{
    if(!await ready)throw Error();const state=await economyChainState(deps.db!,config);
    if(state.haltedReason)return {status:'unavailable' as const};
    if(BigInt(state.lastBlock)<BigInt(config.deploymentBlock)||state.throughMs<=0)return {status:'indexing' as const};
    const sum=await deps.db!.prepare('SELECT CAST(COALESCE(SUM(remaining_shares),0) AS TEXT) shares FROM economy_positions WHERE config_id=? AND wallet=?').bind(config.id,wallet).first<{shares:string}>();
    if(!sum||! /^(0|[1-9][0-9]{0,18})$/.test(sum.shares))throw Error();
    return {status:'ok' as const,atomic:String(BigInt(sum.shares)*ECONOMY_SHARE_WEI),block:state.lastBlock,throughMs:state.throughMs};
   }catch{return {status:'unavailable' as const};}})(),
   (async()=>{try{if(!await ready)throw Error();const s=goldBalanceView(await goldBalanceStatement(deps.db!,wallet).first<{book:string;reserved:string}>());return {status:'ok' as const,...s};}catch{return {status:'unavailable' as const};}})(),
  ]);
  if(!await revalidateEconomySession(request,deps.db,session,clock))return bad(401,'AUTH_REQUIRED');
  const freshAt=clock();if(session.expiresAt<=freshAt)return bad(401,'AUTH_REQUIRED');
  return reply(200,{wallet,asOf:freshAt,embeo,staked,gold});
 }catch{return bad(503,'BALANCE_UNAVAILABLE');}
}
