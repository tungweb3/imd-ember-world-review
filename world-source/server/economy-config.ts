/** No RPC credential, wallet authority or review bypass is part of this value.
 * The Worker supplies it only after its independent release/configuration gate. */
export type EconomyService={id:string;titleZh:string;titleEn:string;gold?:string;embeo?:string};
export type EconomyConfig={id:string;chainId:number;token:string;tokenDecimals:18;stakingContract:string;paymentContract:string;treasury:string;deploymentBlock:string;catalogue:readonly EconomyService[]};
export const ECONOMY_RULE='utc-full-day-v1';
export const ECONOMY_TOKEN='0x2b82cdeb8477415d541799abb0cc48044c8ea5f3';
export const ECONOMY_TREASURY='0x1c651928150daddda9c2c040a9d4901d862f8ec4';
export const ECONOMY_SHARE_TOKENS='100000';
export const ECONOMY_SHARE_WEI=100_000n*10n**18n;
export const ECONOMY_MAX_INTEGER=9_223_372_036_854_775_807n;
export const ECONOMY_MAX_UINT256=(1n<<256n)-1n;
export const ECONOMY_DAY_MS=86_400_000;
export const ECONOMY_ADDRESS=/^0x[0-9a-fA-F]{40}$/;
export const ECONOMY_HASH=/^0x[0-9a-fA-F]{64}$/;
export function economyUint(value:unknown,max=ECONOMY_MAX_UINT256,zero=false):string{
  if(typeof value!=='string'||! /^(0|[1-9][0-9]{0,77})$/.test(value))throw new Error('INVALID_INTEGER');
  const n=BigInt(value);if(n>max||(!zero&&n===0n))throw new Error('INTEGER_RANGE');return value;
}
export function economyAddress(value:unknown):string{
  if(typeof value!=='string'||!ECONOMY_ADDRESS.test(value)||/^0x0{40}$/i.test(value))throw new Error('INVALID_ADDRESS');
  return value.toLowerCase();
}
export async function economyDigest(value:string):Promise<string>{
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
}
/** Pure validation: enabling the feature and supplying reviewed deployment
 * addresses is deliberately the responsibility of the Worker release adapter. */
export async function defineEconomyConfig(raw:Omit<EconomyConfig,'id'>):Promise<EconomyConfig>{return defineConfig(raw,false);}
/** Explicit fixture constructor. Never selected by the deployed Worker. */
export async function defineLocalEconomyConfig(raw:Omit<EconomyConfig,'id'>):Promise<EconomyConfig>{if(raw.chainId!==31337)throw Error('LOCAL_CHAIN_REQUIRED');return defineConfig(raw,true);}
async function defineConfig(raw:Omit<EconomyConfig,'id'>,local:boolean):Promise<EconomyConfig>{
  if(!raw||!Number.isSafeInteger(raw.chainId)||raw.chainId<1||raw.tokenDecimals!==18)throw new Error('INVALID_CHAIN');
  const token=economyAddress(raw.token),stakingContract=economyAddress(raw.stakingContract),paymentContract=economyAddress(raw.paymentContract),treasury=economyAddress(raw.treasury);
  if(!local&&(raw.chainId!==1||token!==ECONOMY_TOKEN||treasury!==ECONOMY_TREASURY))throw new Error('UNAUTHORIZED_ASSET_OR_TREASURY');
  if(new Set([token,stakingContract,paymentContract,treasury]).size!==4)throw new Error('INVALID_CONTRACT_SEPARATION');
  const deploymentBlock=economyUint(raw.deploymentBlock,ECONOMY_MAX_INTEGER);
  if(!Array.isArray(raw.catalogue)||raw.catalogue.length>64)throw new Error('INVALID_CATALOGUE');
  const seen=new Set<string>();
  const catalogue=raw.catalogue.map(item=>{
    if(!item||! /^[a-z][a-z0-9-]{0,63}$/.test(item.id)||seen.has(item.id)||typeof item.titleZh!=='string'||typeof item.titleEn!=='string'||!item.titleZh.length||!item.titleEn.length||item.titleZh.length>160||item.titleEn.length>160)throw new Error('INVALID_SERVICE');
    seen.add(item.id);if(!item.gold&&!item.embeo)throw new Error('UNPRICED_SERVICE');
    return Object.freeze({id:item.id,titleZh:item.titleZh,titleEn:item.titleEn,...item.gold?{gold:economyUint(item.gold,ECONOMY_MAX_INTEGER)}:{},...item.embeo?{embeo:economyUint(item.embeo)}:{}});
  });
  // Price changes do not reset finalized chain cursors or historical positions.
  const id=await economyDigest(JSON.stringify([ECONOMY_RULE,raw.chainId,token,stakingContract,paymentContract,treasury,deploymentBlock]));
  return Object.freeze({id,chainId:raw.chainId,token,tokenDecimals:18,stakingContract,paymentContract,treasury,deploymentBlock,catalogue:Object.freeze(catalogue)});
}
export function publicEconomyConfig(config:EconomyConfig|null|undefined){
  return config?{enabled:true,chainId:config.chainId,token:config.token,tokenDecimals:18,stakingContract:config.stakingContract,paymentContract:config.paymentContract,treasury:config.treasury,shareTokens:ECONOMY_SHARE_TOKENS,shareWei:String(ECONOMY_SHARE_WEI),rule:ECONOMY_RULE,goldTransferable:false,catalogue:config.catalogue}:{enabled:false,reason:'NOT_CONFIGURED',shareTokens:ECONOMY_SHARE_TOKENS,rule:ECONOMY_RULE,goldTransferable:false,catalogue:[]};
}
