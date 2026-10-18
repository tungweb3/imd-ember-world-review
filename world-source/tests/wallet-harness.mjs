import {decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {createWorker} from '../worker/app.ts';
import {ReadGateway} from '../server/gateway.ts';
import {ALCHEMY_RPC_URL,ALCHEMY_NFTS_URL,MULTICALL3} from '../server/ownership.ts';
import {SEAT_COLLECTION} from '../src/world/market.ts';
import {openD1} from './d1-sqlite.mjs';
// Shared by the wallet tests: the real Worker (createWorker) over node:sqlite running the real migrations, a fake
// api.imd.fun (swarm + workers), a fake Alchemy (NFT index + Multicall3 ownerOf + ERC-1271), an injected clock, and a
// cookie-keeping browser. Keys are generated per run (viem generatePrivateKey) and never written anywhere.
export const START=Date.UTC(2026,8,28,12,0,0);
export const newAccount=()=>privateKeyToAccount(generatePrivateKey());
const OWNER_OF=[{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{name:'',type:'address'}]}];
const ERC1271=[{type:'function',name:'isValidSignature',stateMutability:'view',inputs:[{name:'hash',type:'bytes32'},{name:'signature',type:'bytes'}],outputs:[{name:'',type:'bytes4'}]}];

/** Fake Alchemy. `owners`: on-chain ownerOf (id → lowercase address); `index`: what the NFT index claims per owner
 *  (defaults to the on-chain truth); `contracts`: address → (hash, signature) → bytes4 for ERC-1271 (these have code);
 *  `raw`: address → calldata → the eth_call result verbatim, with `code` (address → bytecode, default none);
 *  `characters`: owner → [{contract, tokenId}] for character collections; `intercept(method, params)`, if set, may answer
 *  (a Response) or throw (a transport failure) for one RPC call before anything else. */
export function fakeChain({owners={},block=21_000_000n}={}){
  const state={owners,block,index:null,contracts:new Map(),raw:new Map(),code:new Map(),characters:{},fail:null,calls:[],images:{}};
  const fetcher=async(input,init={})=>{
    const url=String(input);state.calls.push({url,headers:new Headers(init.headers),body:init.body});
    if(state.fail==='network')throw new TypeError('network down');
    if(state.fail==='http')return new Response('{}',{status:500});
    if(url.startsWith(ALCHEMY_NFTS_URL+'?')){
      const u=new URL(url),who=u.searchParams.get('owner').toLowerCase(),wanted=u.searchParams.getAll('contractAddresses[]');
      const ids=state.index?.[who]??Object.entries(state.owners).filter(([,o])=>o===who).map(([id])=>id);
      const page=Number(u.searchParams.get('pageKey')??0),rows=wanted.includes(SEAT_COLLECTION)?ids:[];
      if(state.fail==='index')return new Response('{}',{status:502});
      const chars=(state.characters[who]??[]).filter(n=>wanted.includes(n.contract)).map(n=>({contract:{address:n.contract},tokenId:n.tokenId,name:'Pepe '+n.tokenId,image:{}}));
      return Response.json({ownedNfts:[...rows.map(tokenId=>({contract:{address:SEAT_COLLECTION},tokenId,name:'Seat '+tokenId,image:state.images[tokenId]??{}})),...chars],
        totalCount:rows.length+chars.length,pageKey:state.endlessPages?String(page+1):null});
    }
    if(url!==ALCHEMY_RPC_URL)return new Response('{}',{status:404});
    const {method,params}=JSON.parse(init.body),held=await state.intercept?.(method,params);if(held)return held;
    if(state.fail==='rpc-error')return Response.json({jsonrpc:'2.0',id:1,error:{code:-32000,message:'boom'}});
    if(method==='eth_getCode'){const at=params[0].toLowerCase();return Response.json({jsonrpc:'2.0',id:1,result:state.code.get(at)??(state.contracts.has(at)?'0x6080604052':'0x')});}
    if(method!=='eth_call')return Response.json({jsonrpc:'2.0',id:1,error:{code:-32601}});
    const [{to,data},tag]=params;
    if(state.raw.has(to.toLowerCase()))return Response.json({jsonrpc:'2.0',id:1,result:state.raw.get(to.toLowerCase())(data)});
    if(to===MULTICALL3){
      state.lastTag=tag;
      const calls=decodeFunctionData({abi:multicall3Abi,data}).args[0];
      const out=calls.map(c=>{
        if(c.target===MULTICALL3)return {success:true,returnData:encodeAbiParameters([{type:'uint256'}],[state.block])};
        const id=String(decodeFunctionData({abi:OWNER_OF,data:c.callData}).args[0]),o=state.owners[id];
        return o?{success:true,returnData:encodeFunctionResult({abi:OWNER_OF,functionName:'ownerOf',result:o})}:{success:false,returnData:'0x'};
      });
      return Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:out})});
    }
    const wallet=state.contracts.get(to.toLowerCase());
    if(!wallet)return Response.json({jsonrpc:'2.0',id:1,result:'0x'});                // an EOA: no code, empty return
    const {args:[hash,signature]}=decodeFunctionData({abi:ERC1271,data});
    const magic=wallet(hash,signature);
    return magic?Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:ERC1271,functionName:'isValidSignature',result:magic})}):
      Response.json({jsonrpc:'2.0',id:1,error:{code:3,message:'execution reverted'}});
  };
  return {state,fetcher};
}
/** Fake api.imd.fun: a swarm with `seats` (id → agentId) and owners, and a /workers roster of `online` ids. */
export function fakeImd({seats={},owners=[],online=[],count}={}){
  const state={seats,owners,online,count,fail:new Set(),calls:0};
  const fetcher=async url=>{
    state.calls++;const path=String(url).replace('https://api.imd.fun','');
    if(state.fail.has(path))return new Response('{}',{status:502});
    if(path==='/swarm')return Response.json({at:1,seats:Object.fromEntries(Object.entries(state.seats).map(([id,agentId])=>[id,{tokenId:Number(id),agentId}])),owners:state.owners});
    if(path==='/workers'){const workers=state.online.map(id=>({seat:{tokenId:String(id),agentId:state.seats[id]??null},working:0,runtimes:[],lastHeartbeatAt:'2026-09-28T11:59:00Z'}));
      return Response.json({count:state.count??workers.length,workers},{headers:state.age?{age:String(state.age)}:{}});}
    return new Response('{}',{status:404});
  };
  return {state,fetcher};
}
/** A rate-limit binding shaped like Cloudflare's simple limiter: `limit` calls per key per 60 s window of `now`. `keys`
 *  lists every key it was asked about. */
export function windowLimiter(limit,now){
  const seen=new Map(),keys=[];
  return {keys,async limit({key}){keys.push(key);const k=Math.floor(now()/60_000)+'|'+key,n=(seen.get(k)??0)+1;seen.set(k,n);return {success:n<=limit};}};
}
/** A binding that always allows (the tests' explicit stand-in for a configured limiter). */
export const openLimiter=()=>({limit:async()=>({success:true})});
/** Every rate-limit binding production has, each allowing: tests replace one, or set it to undefined to remove it. */
export const openLimiters=()=>({API_LIMITER:openLimiter(),SEAT_LIMITER:openLimiter(),AUTH_LIMITER:openLimiter(),CHAIN_LIMITER:openLimiter()});
/** The Worker with a database, clock, fake upstreams, limiter bindings (open unless `env` says otherwise) and character collections. */
export function setup({imd=fakeImd(),chain=fakeChain(),key='test-alchemy-key',env:extra={},collections}={}){
  const db=openD1();let t=START;
  const clock={now:()=>t,advance:ms=>{t+=ms;},set:ms=>{t=ms;}};
  const gateway=new ReadGateway(imd.fetcher,clock.now);
  const worker=createWorker(gateway,chain.fetcher,clock.now,collections);
  const env={ASSETS:{fetch:async()=>new Response('asset',{headers:{'x-served-by':'assets'}})},DB:db,...key?{ALCHEMY_API_KEY:key}:{},...openLimiters(),...extra};
  const kept=[],ctx={waitUntil:p=>kept.push(p)};
  return {db,clock,gateway,worker,env,imd,chain,kept,
    call:(request,e=env)=>worker.fetch(request,e,ctx),
    browser:(origin,base,ip)=>new Browser(r=>worker.fetch(r,env,ctx),origin,base,ip)};
}
/** A cookie jar that behaves like one browser profile: it keeps what Set-Cookie sets and drops Max-Age=0. `ip`, if given,
 *  is its cf-connecting-ip (otherwise none: every such browser is the one client 'ip:unknown', network 'net:unknown'). */
export class Browser{
  constructor(send,origin='https://imdember.com',base=origin,ip){this.send=send;this.origin=origin;this.base=base;this.ip=ip;this.jar=new Map();this.setCookies=[];}
  cookie(){return [...this.jar].map(([k,v])=>k+'='+v).join('; ');}
  keep(response){
    for(const line of response.headers.getSetCookie()){this.setCookies.push(line);
      const [pair,...attrs]=line.split(';'),at=pair.indexOf('='),name=pair.slice(0,at),value=pair.slice(at+1);
      if(attrs.some(a=>a.trim().toLowerCase()==='max-age=0'))this.jar.delete(name);else this.jar.set(name,value);}
    return response;
  }
  request(path,{method='GET',body,origin=this.origin,headers={}}={}){
    const h=new Headers(headers);if(origin)h.set('origin',origin);if(this.ip&&!h.has('cf-connecting-ip'))h.set('cf-connecting-ip',this.ip);if(this.jar.size)h.set('cookie',this.cookie());
    if(body!==undefined&&!h.has('content-type'))h.set('content-type','application/json');
    return new Request(this.base+path,{method,headers:h,body:body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body)});
  }
  async post(path,body={},options={}){return this.keep(await this.send(this.request(path,{...options,method:'POST',body})));}
  async get(path,options={}){return this.keep(await this.send(this.request(path,options)));}
  /** challenge → sign with `account` → verify. Returns every step. */
  async signIn(account,{sign=m=>account.signMessage({message:m})}={}){
    const challenge=await this.post('/api/auth/challenge',{address:account.address}),c=await challenge.clone().json();
    const signature=await sign(c.message),verify=await this.post('/api/auth/verify',{nonce:c.nonce,signature});
    return {challenge,c,signature,verify};
  }
}
