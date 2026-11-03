/** Initial versioned Celestao prices. Product provisioning and charging remain
 * separate release gates; importing this catalogue never enables a service. */
export const FORTUNE_PRICING_VERSION='celestao-gold-v1-20261025';
export const FORTUNE_SYSTEMS=['bazi','ziwei','annual_ziwei','western','human','profile'] as const;
export type FortuneSystem=typeof FORTUNE_SYSTEMS[number];
export type FortuneProduct=Readonly<{system:FortuneSystem;product:string;nameZh:string;nameEn:string;gold:string;listGold:string;version:1}>;
const singlePrices=Object.freeze({bazi:'1000',ziwei:'1000',western:'800',human:'600'});
const total=Object.values(singlePrices).reduce((sum,value)=>sum+BigInt(value),0n).toString();
const product=(system:FortuneSystem,nameZh:string,nameEn:string,gold:string,listGold=gold):FortuneProduct=>Object.freeze({system,product:'fortune-'+system.replace('_','-'),nameZh,nameEn,gold,listGold,version:1});
export const FORTUNE_PRODUCTS:readonly FortuneProduct[]=Object.freeze([
 product('bazi','四柱八字','Four Pillars',singlePrices.bazi),
 product('ziwei','紫微斗數','Zi Wei Dou Shu',singlePrices.ziwei),
 product('annual_ziwei','流年運勢','Zi Wei Year','1000'),
 product('western','西洋星盤','Western astrology',singlePrices.western),
 product('human','人類圖','Human Design',singlePrices.human),
 product('profile','完整解讀','Complete reading','3000',total)
]);
export function fortuneProduct(value:unknown):FortuneProduct|null{
 return typeof value==='string'?FORTUNE_PRODUCTS.find(p=>p.system===value||p.product===value)??null:null;
}
