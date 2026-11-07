/** 鼠道修仙 (Squeek Ascension) cosmetic store, sold for World GOLD.
 * Owner decision 2026-11-07: 11 one-time cosmetics, 200 GOLD each, no bundles.
 * The World server is the only price authority; the game never sends an amount.
 * A cosmetic gives no power, resources or time: it only changes what is drawn. */
export const SQUEEK_ORIGIN='https://squeekascension.celestao.com';
export const SQUEEK_REDIRECT='https://squeekascension.celestao.com/';
export const SQUEEK_CLIENT_ID='squeek-ascension';
export const SQUEEK_ISSUER='https://imdember.com';
export const SQUEEK_API_PREFIX='/api/squeek/';
export const SQUEEK_CATALOG_VERSION='squeek-world-1';
export const SQUEEK_PRODUCT_VERSION=1;
export type SqueekKind='aura'|'glow'|'sky';
export type SqueekItem={sku:string;product:string;version:number;gold:string;kind:SqueekKind;nameZh:string;nameEn:string};
const item=(sku:string,kind:SqueekKind,nameZh:string,nameEn:string):SqueekItem=>Object.freeze({sku,product:'squeek-'+sku.replace(/[._]/g,'-'),version:SQUEEK_PRODUCT_VERSION,gold:'200',kind,nameZh,nameEn});
export const SQUEEK_ITEMS:readonly SqueekItem[]=Object.freeze([
 item('aura.frostmoon_sword.v1','aura','霜月劍意','Frostmoon Sword Aura'),
 item('aura.star_river_arcane.v1','aura','星河流轉','Star River'),
 item('aura.golden_body.v1','aura','不動金身','Golden Body'),
 item('aura.blood_moon_demon.v1','aura','血月焚魂','Blood Moon'),
 item('glow.auspicious_cloud.v1','glow','祥雲靈環','Auspicious Halo'),
 item('glow.nine_stars.v1','glow','九星連環','Nine Stars'),
 item('glow.fire_lotus.v1','glow','業火紅蓮','Fire Lotus'),
 item('sky.sakura.v1','sky','櫻吹雪','Falling Sakura'),
 item('sky.fireflies.v1','sky','螢火之夜','Firefly Night'),
 item('sky.first_snow.v1','sky','初雪','First Snow'),
 item('sky.meteors.v1','sky','流星雨','Meteor Shower')
]);
export const SQUEEK_PRODUCTS:readonly string[]=Object.freeze(SQUEEK_ITEMS.map(i=>i.product));
export const squeekBySku=(sku:unknown)=>typeof sku==='string'?SQUEEK_ITEMS.find(i=>i.sku===sku)??null:null;
export const squeekByProduct=(product:unknown)=>typeof product==='string'?SQUEEK_ITEMS.find(i=>i.product===product)??null:null;
/** The game's own purchase key. World prefixes it, so it never collides with another service's request id. */
export const SQUEEK_REQUEST_KEY=/^[A-Za-z0-9_-]{22,64}$/;
export const squeekRequestId=(key:string)=>'sq_'+key;
