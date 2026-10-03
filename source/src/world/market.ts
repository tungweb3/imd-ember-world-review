import {object,type SourceSample} from './model.ts';
import {FRESH_MS} from './cadence.ts';

export const IMD_TOKEN='0xD34a99Bc0f67aE1bbd63C660e6d0b0dd03E263B7';
export const MARKET_URL='https://api.dexscreener.com/tokens/v1/ethereum/'+IMD_TOKEN;
/** The Identity.MD seat NFT collection (Ethereum mainnet). Verified 2026-09-27 against api.imd.fun/swarm
 *  chain {chainId:1, collection} and the contract imd.fun/token asks Alchemy getFloorPrice about. */
export const SEAT_COLLECTION='0x0000ec93127baa929e58e97dd0095a2bfb38ec1d';
/** imd.fun draws 2,000 seat modules (a fixed constant on its wall and token page). */
export const SEAT_SUPPLY=2000;

export type PriceChange={m5:number|null;h1:number|null;h6:number|null;h24:number|null};
export type Flow={h1:number|null;h24:number|null};
export type Trades={buys:number;sells:number};
export type MarketQuote={
  priceUsd:number;change24h:number|null;marketCap:number|null;liquidityUsd:number|null;pairUrl:string;provider:'DEX Screener'|'Demo';
  /** Price in ETH (the pair's quote token), for ETH/USD = priceUsd / priceNative. */
  priceNative?:number|null;
  /** true when DEX Screener sent no marketCap and marketCap above is its fdv. */
  capFromFdv?:boolean;
  change?:PriceChange;volumeUsd?:Flow;txns?:{h1:Trades|null;h24:Trades|null};
};
/** The seat NFT floor, read server-side only (Alchemy getFloorPrice with the Worker secret ALCHEMY_API_KEY). A seat's
 *  market price, not earnings. floorUsd uses ETH/USD from the $IMD pair (priceUsd / priceNative), as imd.fun/token does. */
export type SeatFloor={floorEth:number;floorUsd?:number;marketplace:string;fetchedAt:number};
/** Worker-only market extras, carried by /api/world/market. floorEnabled is false when the Worker has no floor source
 *  (no key): the client then stops asking for extras for the rest of the session. */
export type MarketExtras={floorEnabled:boolean;floor?:SeatFloor};
/** What the client's market read returns: the quote sample, with the Worker's extras merged in when it has them. */
export type MarketSample=SourceSample&{extras?:MarketExtras};
export type Weather='brilliant'|'sunny'|'overcast'|'rain'|'storm'|'thunderstorm'|'unknown';
const finite=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:null;
const positive=(x:unknown)=>{const n=finite(x);return n!==null&&n>=0?n:null;};
const decimal=(x:unknown)=>{const n=typeof x==='string'&&x.trim()?Number(x):finite(x);return n!==null&&Number.isFinite(n)&&n>0?n:null;};
const trades=(x:unknown):Trades|null=>{const t=object(x),b=positive(t.buys),s=positive(t.sells);return b===null||s===null?null:{buys:b,sells:s};};
// USD prices belong to the base token. Never use a similarly named token or a quote-side price.
export function selectMarket(payload:unknown):MarketQuote {
  if(!Array.isArray(payload))throw new Error('Market schema changed');
  const rows=payload.map(object).filter(p=>p.chainId==='ethereum'&&String(object(p.baseToken).address).toLowerCase()===IMD_TOKEN.toLowerCase())
    .map(p=>({p,price:typeof p.priceUsd==='string'&&p.priceUsd.trim()?Number(p.priceUsd):NaN,liquidity:positive(object(p.liquidity).usd)}))
    .filter(x=>Number.isFinite(x.price)&&x.price>0).sort((a,b)=>(b.liquidity??-1)-(a.liquidity??-1));
  const row=rows[0];if(!row)throw new Error('No matching IMD USD quote');
  const url=String(row.p.url??''),change=object(row.p.priceChange),volume=object(row.p.volume),txns=object(row.p.txns);
  const cap=positive(row.p.marketCap),fdv=positive(row.p.fdv);
  return {priceUsd:row.price,change24h:finite(change.h24),marketCap:cap??fdv,liquidityUsd:row.liquidity,
    pairUrl:url.startsWith('https://dexscreener.com/ethereum/')?url:'https://imd.fun/token/',provider:'DEX Screener',
    priceNative:decimal(row.p.priceNative),capFromFdv:cap===null&&fdv!==null,
    change:{m5:finite(change.m5),h1:finite(change.h1),h6:finite(change.h6),h24:finite(change.h24)},
    volumeUsd:{h1:positive(volume.h1),h24:positive(volume.h24)},txns:{h1:trades(txns.h1),h24:trades(txns.h24)}};
}
/** Alchemy NFT API v3 getFloorPrice → SeatFloor. OpenSea first (what imd.fun shows), LooksRare as the fallback; only an
 *  ETH-denominated, positive floor counts. Throws when neither marketplace has one. */
export function selectFloor(payload:unknown,now:number):SeatFloor {
  const body=object(payload);
  for(const [key,marketplace] of [['openSea','OpenSea'],['looksRare','LooksRare']] as const){
    const m=object(body[key]),floor=finite(m.floorPrice);
    if(m.error||floor===null||floor<=0||String(m.priceCurrency??'').toUpperCase()!=='ETH')continue;
    const at=typeof m.retrievedAt==='string'?Date.parse(m.retrievedAt):NaN;
    return {floorEth:floor,marketplace,fetchedAt:Number.isFinite(at)&&at<=now?at:now};
  }
  throw new Error('No seat floor');
}
/** ETH/USD from the $IMD quote (priceUsd / priceNative); null without a native price. */
export function ethUsd(quote:MarketQuote|null|undefined):number|null {
  const native=quote?.priceNative;return quote&&native&&native>0?quote.priceUsd/native:null;
}
export function withUsd(floor:SeatFloor,quote:MarketQuote|null|undefined):SeatFloor {
  const rate=ethUsd(quote);return rate===null?floor:{...floor,floorUsd:floor.floorEth*rate};
}
/** The 24h change's tier (owner, 2026-10-01, replacing the 2026-09-28 tiers): ≥ +10 brilliant (大晴天, a brighter sky
 *  with fireworks now and then, skyShow.ts), 0…+10 sunny (晴朗), −5…0 overcast (陰天), −12…−5 rain, −22…−12 storm
 *  (heavy rain and wind), ≤ −22 thunderstorm. A value exactly on a falling boundary takes the worse tier (−5 rain, −12
 *  storm, −22 thunderstorm); exactly 0 is sunny and exactly +10 brilliant. The old 0…+5 fair tier (薄雲) is gone. */
export function weatherForChange(change:number|null):Weather {
  if(change===null||!Number.isFinite(change))return 'unknown';
  return change>=10?'brilliant':change>=0?'sunny':change>-5?'overcast':change>-12?'rain':change>-22?'storm':'thunderstorm';
}
/** A floor older than this is hidden rather than shown as current. */
export const FLOOR_MAX_AGE_MS=2*60*60_000;
/** The seat-floor card's data, or null when the card is hidden (no floor, not ETH, or too old). floorUsd comes from the
 *  viewer's own fresh quote (`quote`); the Worker's figure (priced with the quote of the same fallback read) only stands
 *  in when the viewer has none. */
export function floorView(sample:MarketSample|null|undefined,quote:MarketQuote|null,now=Date.now()):SeatFloor|null {
  const f=sample?.extras?.floor;
  if(!f||!(f.floorEth>0)||!Number.isFinite(f.fetchedAt)||now-f.fetchedAt>FLOOR_MAX_AGE_MS)return null;
  const {floorUsd,...base}=f,mine=withUsd(base,quote);
  return mine.floorUsd!==undefined?mine:typeof floorUsd==='number'&&Number.isFinite(floorUsd)?f:base;
}
export function marketView(sample:MarketSample|null,now=Date.now()) {
  const raw=object(sample?.data),price=positive(raw.priceUsd);
  const quote=price!==null&&price>0?raw as MarketQuote:null;
  const fresh=sample?.state==='fresh'&&sample.fetchedAt!==null&&now-sample.fetchedAt<=FRESH_MS&&now-sample.fetchedAt>=-10000;
  const state=quote?(fresh?'fresh':'stale'):'unavailable';
  return {state,quote,fetchedAt:sample?.fetchedAt??null,weather:weatherForChange(fresh?finite(quote?.change24h):null),floor:floorView(sample,fresh?quote:null,now),
    mood:marketMood(fresh?quote?.change?.h1:null)} as const;
}
/** Each 24h tier's own rain and wind, 0..1: gentle rain; heavy rain with wind (storm); torrential in a thunderstorm. */
export const WEATHER_RAIN:Record<Weather,number>={brilliant:0,sunny:0,overcast:0,rain:.3,storm:.65,thunderstorm:1,unknown:0};
export const WEATHER_WIND:Record<Weather,number>={brilliant:0,sunny:0,overcast:0,rain:0,storm:.5,thunderstorm:.65,unknown:0};
const unit=(x:number)=>Number.isFinite(x)?Math.min(1,Math.max(0,x)):0;
/** Rain on screen, 0..1 (skin/weather.ts turns it into streak count, length, speed, haze, wet ground and ripples): the
 *  24h tier's own rain plus a shower when the last hour fell more than 5 % (marketMood): .075 just past it, up to .3 (as
 *  much as the rain tier's own) at −10 % or worse. 0 means no rain drawn. */
export function rainIntensity(weather:Weather,mood:{rain:number}):number {
  return Math.min(1,(WEATHER_RAIN[weather]??0)+.3*unit(mood.rain));
}
/** A shower from the falling hour on a dry 24h sky: rain is drawn (rainIntensity > 0) though the tier has none of its own.
 *  The weather card and the Observatory name it, so rain under "Clear skies" reads as meant, not as a fault. */
export function showerOver(weather:Weather,mood:{rain:number}):boolean {return weather!=='unknown'&&!(WEATHER_RAIN[weather]>0)&&rainIntensity(weather,mood)>0;}
export const SHOWER_LABEL={en:'shower',zh:'陣雨'} as const;
/** Wind for the rain, 0..1: the tier's own (storms) with the 1h mood's wind blowing on top of it. */
export function rainWind(weather:Weather,mood:{wind:number}):number {
  const own=WEATHER_WIND[weather]??0;return own+(1-own)*unit(mood.wind);
}
/** The 1h shower (owner, 2026-10-01, replacing "any falling hour, full at −4 %"): none unless the last hour fell by more
 *  than SHOWER_FROM (−5 % exactly, or anything milder, brings none); just past it a light but visible shower, SHOWER_LIGHT
 *  of the most, growing in a straight line to the most at SHOWER_FULL or worse. */
export const SHOWER_FROM=-5,SHOWER_FULL=-10,SHOWER_LIGHT=.25;
/** Rain and wind, 0..1, from the 1h change (the sky keeps following the 24h change): the shower above, and wind with the
 *  size of the move either way, full at ±6 %. Calm when unknown. */
export function marketMood(change1h:number|null|undefined):{rain:number;wind:number} {
  const c=finite(change1h);if(c===null)return {rain:0,wind:0};
  const rain=c<SHOWER_FROM?Math.min(1,SHOWER_LIGHT+(1-SHOWER_LIGHT)*(SHOWER_FROM-c)/(SHOWER_FROM-SHOWER_FULL)):0;
  return {rain,wind:Math.min(1,Math.abs(c)/6)};
}
export const WEATHER_LABELS:Record<Weather,{en:string;zh:string;icon:string}>={
  brilliant:{en:'Brilliant sky',zh:'大晴天',icon:'☀'},sunny:{en:'Clear skies',zh:'晴朗',icon:'☀'},overcast:{en:'Overcast',zh:'陰天',icon:'☁'},
  rain:{en:'Rain',zh:'雨天',icon:'☂'},storm:{en:'Storm',zh:'風暴',icon:'☂'},thunderstorm:{en:'Thunderstorm',zh:'雷雨',icon:'⛈'},
  unknown:{en:'Awaiting market data',zh:'等待行情',icon:'◌'}
};
// Map revision v001: on the square's west side, screen facing east (+X) across the square. rotation in degrees.
export const OBSERVATORY={x:-13,z:-9,radius:3.9,rotation:90,pepe:{x:-12,z:1}};

export function demoMarket():MarketSample {
  const at=Date.now();
  return {state:'fresh',url:'mock://market',fetchedAt:at,
    data:{priceUsd:8,change24h:2.4,marketCap:30000000,liquidityUsd:3000000,pairUrl:'https://imd.fun/token/',provider:'Demo',priceNative:.003,capFromFdv:false,
      change:{m5:0,h1:.4,h6:1.1,h24:2.4},volumeUsd:{h1:12000,h24:600000},txns:{h1:{buys:6,sells:4},h24:{buys:160,sells:150}}} satisfies MarketQuote,
    extras:{floorEnabled:true,floor:{floorEth:2.5,marketplace:'Demo',fetchedAt:at}}};
}
