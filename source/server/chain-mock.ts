import {decodeFunctionData,encodeFunctionResult,encodeAbiParameters,multicall3Abi} from 'viem';
import {ALCHEMY_RPC_URL,ALCHEMY_NFTS_URL,MULTICALL3} from './ownership.ts';
import {SEAT_COLLECTION} from '../src/world/market.ts';
// Local end-to-end only: `wrangler dev --local --var CHAIN_MOCK_OWNERS:'{"361":"0x…"}'` answers Alchemy's NFT index
// and Multicall3 ownerOf from this map, so a freshly generated test key can own seats without a real key or chain.
// worker/app.ts uses it only when the request URL is loopback (localhost, 127.0.0.1, [::1]), so it can never act on
// imdember.com. ERC-1271 calls answer "0x" (not a contract wallet).
export const MOCK_BLOCK=21_000_000n;
export function parseMockOwners(raw:string|undefined):Record<string,string>|null{
  if(!raw)return null;
  try{
    const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))return null;
    const out:Record<string,string>={};
    for(const [id,owner] of Object.entries(v))if(/^\d{1,5}$/.test(id)&&typeof owner==='string'&&/^0x[\da-fA-F]{40}$/.test(owner))out[BigInt(id).toString()]=owner.toLowerCase();
    return out;
  }catch{return null;}
}
export function mockChainFetch(owners:Record<string,string>):typeof fetch{
  const ownerOf=[{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{name:'',type:'address'}]}] as const;
  return async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.origin+url.pathname===ALCHEMY_NFTS_URL){
      const who=(url.searchParams.get('owner')??'').toLowerCase(),wanted=url.searchParams.getAll('contractAddresses[]');
      const ownedNfts=wanted.includes(SEAT_COLLECTION)?Object.entries(owners).filter(([,o])=>o===who).map(([tokenId])=>({contract:{address:SEAT_COLLECTION},tokenId,name:'IMD Seat #'+tokenId,image:{}})):[];
      return Response.json({ownedNfts,totalCount:ownedNfts.length,pageKey:null});
    }
    if(url.href!==ALCHEMY_RPC_URL)return new Response('{}',{status:404});
    const {method,params}=JSON.parse(String(init?.body));
    if(method!=='eth_call'||params?.[0]?.to!==MULTICALL3)return Response.json({jsonrpc:'2.0',id:1,result:'0x'});
    const {args}=decodeFunctionData({abi:multicall3Abi,data:params[0].data});
    const results=(args[0] as readonly {target:string;callData:`0x${string}`}[]).map(call=>{
      if(call.target===MULTICALL3)return {success:true,returnData:encodeAbiParameters([{type:'uint256'}],[MOCK_BLOCK])};
      const id=String(decodeFunctionData({abi:ownerOf,data:call.callData}).args[0]),owner=owners[id];
      return owner?{success:true,returnData:encodeFunctionResult({abi:ownerOf,functionName:'ownerOf',result:owner as `0x${string}`})}:{success:false,returnData:'0x' as `0x${string}`};
    });
    return Response.json({jsonrpc:'2.0',id:1,result:encodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',result:results})});
  };
}
