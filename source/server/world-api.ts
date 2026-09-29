import type {ReadGateway,WaitUntil} from './gateway.ts';
import {withUsd,type MarketExtras,type MarketQuote,type SeatFloor} from '../src/world/market.ts';
// The one implementation of GET /api/world/*, shared by the Vite dev server and the Cloudflare Worker so they cannot drift.
export const WORLD_API_PREFIX='/api/world/';
const SEAT_ROUTE=/^\/api\/world\/seats\/(0|[1-9]\d{0,79})$/;
/** HSTS for every response, static (public/_headers says the same, tests/headers.test.mjs pins both) and Worker: a year,
 *  every subdomain of imdember.com, no preload (preload is a one-way list submission the owner has not decided on). */
export const HSTS='max-age=31536000; includeSubDomains';
// Static assets get their headers from public/_headers; that file never applies to Worker responses, so these carry their own.
// Every Worker response is built from these (here and in server/auth.ts), errors, 429s and 204s included.
export const API_HEADERS:Readonly<Record<string,string>>={
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Strict-Transport-Security':HSTS,
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin',
  'Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"
};
export type ApiRequest={method:string;url:string};
/** Thrown by the Worker's limiter (worker/app.ts) when a production request needs a rate-limit binding the deployment
 *  lacks (renamed or dropped in wrangler.jsonc): every route that needs it answers 503 instead of running unthrottled.
 *  A limiter that is configured but throws is a different case, handled per bucket (the read API fails open). */
export class LimiterMissing extends Error{binding:string;constructor(binding:string){super('rate-limit binding missing: '+binding);this.binding=binding;}}
/** Rate-limit check per bucket: 'api' for every GET under /api/world/, 'seat' additionally for seat lookups. */
export type Allow=(bucket:'api'|'seat')=>boolean|Promise<boolean>;
export type WorldApiOptions={waitUntil?:WaitUntil;allow?:Allow;
  /** The Worker secret ALCHEMY_API_KEY (production only). Without it the seat floor is simply absent. */
  floorKey?:string};
type FloorGateway=Pick<ReadGateway,'floor'|'floorNow'|'floorRefused'>;
/** The Worker-only market extras. The floor is included only when there is one; floorEnabled tells the client whether
 *  asking again can ever return one (false: no key configured, or Alchemy refused it). `wait` false answers from the
 *  cache without waiting on Alchemy (a background read refreshes it). floorUsd is added only from a quote read for this
 *  same request; otherwise the client prices the floor with its own quote (market.ts floorView). */
export async function marketExtras(gateway:FloorGateway,quote:MarketQuote|null,options:WorldApiOptions,wait:boolean):Promise<MarketExtras> {
  if(!options.floorKey)return {floorEnabled:false};
  const floor=wait?await gateway.floor(options.floorKey,options.waitUntil):gateway.floorNow(options.floorKey,options.waitUntil);
  if(gateway.floorRefused())return {floorEnabled:false};
  const data=floor?.data as SeatFloor|null|undefined;
  return data?{floorEnabled:true,floor:withUsd(data,quote)}:{floorEnabled:true};
}
const reply=(status:number,body:string,extra?:Record<string,string>)=>new Response(body,{status,headers:{...API_HEADERS,...extra}});
const error=(status:number,code:string,extra?:Record<string,string>)=>reply(status,JSON.stringify({error:code}),extra);
// A failing limiter never blocks the world (fail open); a binding missing from a production deployment does (503).
async function permitted(allow:Allow|undefined,bucket:'api'|'seat'){if(!allow)return true;try{return (await allow(bucket))!==false;}catch(e){if(e instanceof LimiterMissing)throw e;return true;}}
/** Returns null when the path is not under /api/world/ (the caller serves it as a static asset). */
export async function handleWorldApi(request:ApiRequest,gateway:Pick<ReadGateway,'snapshotBody'|'market'|'seat'>&FloorGateway,options:WorldApiOptions={}):Promise<Response|null> {
  const {pathname,searchParams}=new URL(request.url);
  if(!pathname.startsWith(WORLD_API_PREFIX))return null;
  if(request.method!=='GET')return error(405,'read_only',{Allow:'GET'});
  try {
    if(!await permitted(options.allow,'api'))return error(429,'rate_limited',{'Retry-After':'60'});
    if(pathname==='/api/world/snapshot')return reply(200,await gateway.snapshotBody(options.waitUntil));
    // ?only=extras: the Observatory drawer wants only what the Worker alone can read (the seat floor); the market is
    // not read upstream for it, and no old cached quote prices it. The full route is the quote fallback: its floor comes
    // from the cache as it is, so the quote never waits on Alchemy.
    if(pathname==='/api/world/market'){
      if(searchParams.get('only')==='extras')return reply(200,JSON.stringify({extras:await marketExtras(gateway,null,options,true)}));
      const market=await gateway.market(options.waitUntil),quote=market.state==='fresh'?market.data as MarketQuote:null;
      return reply(200,JSON.stringify({...market,extras:await marketExtras(gateway,quote,options,false)}));
    }
    const match=SEAT_ROUTE.exec(pathname);
    if(match){
      if(!await permitted(options.allow,'seat'))return error(429,'rate_limited',{'Retry-After':'60'});
      return reply(200,JSON.stringify(await gateway.seat(match[1],options.waitUntil)));
    }
    return error(404,'unknown_route');
  } catch(e) {return e instanceof LimiterMissing?error(503,'limiter_unavailable'):error(503,'gateway_unavailable');}
}
