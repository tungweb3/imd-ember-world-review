/** Fixed World entry; no URL, provider, address or price is accepted from the query. */
export const economyEntry=(language:'zh'|'en')=>'/?portal=economy&lang='+language;
export const ECONOMY_DAY_MS=86_400_000;
export function firstEconomyDay(depositedMs:number){
 if(!Number.isSafeInteger(depositedMs)||depositedMs<0)throw Error('INVALID_TIME');
 return Math.ceil(depositedMs/ECONOMY_DAY_MS)*ECONOMY_DAY_MS;
}
export function economyUtc(value:number|null){return value===null?'—':new Date(value).toISOString().replace('T',' ').slice(0,19)+' UTC';}
