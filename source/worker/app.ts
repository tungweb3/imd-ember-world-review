import {GATEWAY_DEFAULTS,SHARED_SHAPE,type ReadGateway,type SharedCopy} from '../server/gateway.ts';
import {handleWorldApi,LimiterMissing,type Allow} from '../server/world-api.ts';
import {UPSTREAM_TTL_MS} from '../src/world/cadence.ts';
import {handleAccountApi} from '../server/auth.ts';
import {handleMemberApi} from '../server/member.ts';
import {Ownership,type ChainAccess} from '../server/ownership.ts';
import {recordPresence} from '../server/presence.ts';
import {mockChainFetch,parseMockOwners} from '../server/chain-mock.ts';
import {CHARACTER_COLLECTIONS} from '../src/world/collections.ts';
import type {D1Database} from '../server/d1.ts';
// Cloudflare Worker for imdember.com (entry: worker/index.ts). wrangler.jsonc routes only /api/world/* and the wallet
// routes (/api/auth/*, /api/me/*, /api/wallet/*) to it (assets.run_worker_first); every other path is served by Workers
// Static Assets from dist/ without running this code. The cron trigger runs `scheduled` (the presence recorder).
// Helpers live here, not in the entry: workerd treats every named export of the entry module as an entrypoint and
// refuses to start on one that is not a handler (a string constant, for example).
type AssetsBinding={fetch(request:Request):Promise<Response>};
type RateLimit={limit(options:{key:string}):Promise<{success:boolean}>};
/** ALCHEMY_API_KEY: a Worker secret (production only), used server-side for the seat floor and the wallet routes'
 *  chain reads; never sent to clients. DB: D1 for sign-in and presence. CHAIN_MOCK_OWNERS: local E2E only (loopback). */
export type Env={ASSETS:AssetsBinding;API_LIMITER?:RateLimit;SEAT_LIMITER?:RateLimit;AUTH_LIMITER?:RateLimit;CHAIN_LIMITER?:RateLimit;ALCHEMY_API_KEY?:string;
  DB?:D1Database;CHAIN_MOCK_OWNERS?:string};
export type Context={waitUntil(promise:Promise<unknown>):void};

export const USER_AGENT='imdember-world/1.0 (+https://imdember.com)';
// api.imd.fun is not on Cloudflare, so this subrequest reads through the imdember.com zone cache: one copy per
// Cloudflare location for 10 s, whichever isolate asks. cacheEverything is required: Cloudflare does not cache
// extensionless JSON by default, and cacheTtlByStatus (unlike cacheTtl) does not imply it. Only 2xx and 404 are
// cached; redirects, other client errors and server errors never are. The responses are public (Cache-Control public,
// no Set-Cookie). DEX Screener is a Cloudflare zone of its own, where these options are most likely ignored; the
// gateway's per-isolate cache is the bound there.
export const EDGE_CACHE_TTL_BY_STATUS:Record<string,number>={'200-299':UPSTREAM_TTL_MS/1000,'300-399':-1,'400-403':-1,'404':10,'405-499':-1,'500-599':-1};
/** Only public, keyless reads go through the edge cache. Anything else (Alchemy, read with the Worker's secret in an
 *  Authorization header) is fetched plainly and bounded by the gateway's own per-isolate TTL. */
export const EDGE_CACHED_HOSTS:readonly string[]=['api.imd.fun','explorer.imd.fun','api.dexscreener.com'];
export const upstreamFetch:typeof fetch=(input,init)=>{
  const headers=new Headers(init?.headers);headers.set('user-agent',USER_AGENT);
  const url=new URL(input instanceof Request?input.url:String(input));
  const edge=url.protocol==='https:'&&EDGE_CACHED_HOSTS.includes(url.hostname)&&!headers.has('authorization');
  return fetch(input,edge?{...init,headers,cf:{cacheEverything:true,cacheTtlByStatus:EDGE_CACHE_TTL_BY_STATUS}} as RequestInit:{...init,headers});
};
/** Where the shared copy of the snapshot sources lives in the Cache API: under /api/world/, which only ever reaches this
 *  Worker (run_worker_first), where it is an unknown route (404). No client request is answered from these entries;
 *  only the gateway reads them, by this exact key. v1: the SharedRecord shape (server/gateway.ts). The full key adds
 *  SHARED_SHAPE (a hash of the code that shapes the data) and the source: <origin>/api/world/_shared/v1/<shape>/<source>,
 *  so a deploy that changes a select starts from an empty copy instead of the previous version's data. */
export const SHARED_COPY_PATH='/api/world/_shared/v1/';
/** The part of the Cache API (caches.default: one cache per Cloudflare location) the shared copy uses. */
export type EdgeCache={match(request:string):Promise<Response|undefined>;put(request:string,response:Response):Promise<unknown>};
/** The gateway's SharedCopy over the Cache API, keyed under the request's own origin. Entries expire after maxAgeMs
 *  (Cache-Control), and the gateway ignores anything older anyway (GATEWAY_DEFAULTS.staleMaxAgeMs). The records are the
 *  public snapshot data the route itself answers with; nothing secret is ever written. */
export function edgeCopy(cache:EdgeCache,origin:string,maxAgeMs:number=GATEWAY_DEFAULTS.staleMaxAgeMs):SharedCopy{
  const key=(name:string)=>origin+SHARED_COPY_PATH+SHARED_SHAPE+'/'+encodeURIComponent(name);
  return {
    async get(name){const r=await cache.match(key(name));return r?.ok?await r.json():undefined;},
    put:(name,record)=>cache.put(key(name),new Response(JSON.stringify(record),{headers:{'content-type':'application/json','cache-control':'public, max-age='+Math.floor(maxAgeMs/1000)}}))
  };
}
const defaultCache=():EdgeCache|undefined=>(globalThis as {caches?:{default?:EdgeCache}}).caches?.default;
/** A canonical dotted IPv4 address (four parts, each 0 to 255 with no leading zero) as its four numbers, else null. */
const quad=(s:string)=>{const m=/^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/.exec(s);const p=m?m.slice(1).map(Number):null;return p&&p.every(n=>n<=255)?p:null;};
/** A valid IPv6 address (lowercase) as its 8 16-bit groups, else null: hex groups of 1 to 4 digits, at most one '::' (at
 *  least one group: so at most 7 written with it, exactly 8 without), a dotted quad only as the final piece. */
function ipv6(s:string):number[]|null{
  if(!/^[\da-f:.]+$/.test(s))return null;const halves=s.split('::');if(halves.length>2)return null;
  const part=(h:string)=>h?h.split(':'):[],head=part(halves[0]),tail=halves.length===2?part(halves[1]):[];
  const end=halves.length===2?tail:head,last=end.at(-1);                               // a dotted quad only as the final piece
  if(last?.includes('.')){const q=quad(last);if(!q)return null;end.splice(-1,1,(q[0]<<8|q[1]).toString(16),(q[2]<<8|q[3]).toString(16));}
  const all=[...head,...tail];if(!all.every(g=>/^[\da-f]{1,4}$/.test(g))||(halves.length===2?all.length>7:all.length!==8))return null;
  return [...head,...Array<string>(8-all.length).fill('0'),...tail].map(g=>parseInt(g,16));
}
/** Rate-limit key for a client address: IPv4 as is; IPv6 by its /64 prefix, because one subscriber usually holds a
 *  whole /64 and could otherwise rotate host bits to get a fresh limit per request. AUD3-08 (Swarm audit 1ef8e8a6 #8,
 *  hardening; no production request was shown to reach it): the whole text is parsed (quad, ipv6), never its tail. An
 *  IPv4-mapped address (::ffff:0:0/96, written in hex or dotted form) counts as that IPv4 address; IPv6 with any other
 *  dotted tail (NAT64 64:ff9b::/96, 2001:db8::1.2.3.4) stays the IPv6 /64 it is. The rest of the zero /64 (::, ::1,
 *  ::a.b.c.d: no public client is in it) and any text that is not an address (a zone id, extra or missing parts, leading
 *  zeros, spaces) is 'ip:unknown', the key a missing header gets (networkKey: 'net:unknown'): one bounded allowance
 *  shared by all of them, never a bucket of its own per string or a pseudo-network. The trade-off: were Cloudflare to
 *  send a form this rejects (it sends dotted IPv4 and compressed IPv6), those clients would share that one allowance.
 *  Local development with cf-connecting-ip ::1 is 'ip:unknown' too. Canonical IPv4 and IPv6 keys are as before. */
export function rateLimitKey(ip:string|null):string {
  if(!ip)return 'ip:unknown';
  const v4=quad(ip);if(v4)return 'ip:'+v4.join('.');
  const g=ipv6(ip.toLowerCase());if(!g)return 'ip:unknown';
  if(g.slice(0,5).every(x=>x===0)&&g[5]===0xffff)return 'ip:'+[g[6]>>8,g[6]&255,g[7]>>8,g[7]&255].join('.');
  if(g.slice(0,4).every(x=>x===0))return 'ip:unknown';                                  // the zero /64: no public client is in it
  return 'ip6:'+g.slice(0,4).map(x=>x.toString(16)).join(':')+'::/64';
}
/** The client's network for the D1 sign-in budgets (server/auth.ts): IPv4 by /24, IPv6 by /48 (a site's usual
 *  allocation), so one party rotating addresses inside its network still spends one share. Built on rateLimitKey. */
export function networkKey(ip:string|null):string{
  const k=rateLimitKey(ip),v4=/^ip:(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(k);
  if(v4)return 'net:'+v4[1]+'.0/24';
  return k.startsWith('ip6:')?'net6:'+k.slice(4).split(':').slice(0,3).join(':')+'::/48':'net:'+k.slice(3);
}
/** The IPv6 subscriber inside that network (Swarm audit 8c3aea2e N-5): its /64, as rateLimitKey has it ('net6:<prefix>::/64';
 *  a mobile device's connection or a home line gets its own /64, and privacy addresses rotate only the low 64 bits).
 *  Null for IPv4, IPv4-mapped and unknown clients, whose network is one level. Never the host bits. */
export function subnetKey(ip:string|null):string|null{
  const k=rateLimitKey(ip);
  return k.startsWith('ip6:')?'net6:'+k.slice(4):null;
}
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
/** The binding each bucket spends ('verify' shares AUTH_LIMITER's namespace under 'verify:'+IP keys, so challenges and
 *  verifies of one IP each get 20/min; 'home' shares it under session keys; 'code', the sign-in's
 *  eth_getCode cap, shares API_LIMITER's under the constant key 'chain:code': 180/min per location, fails closed).
 *  'member', the member bootstrap and name writes (server/member.ts), shares it under 'member:'+IP keys: 20/min per IP. */
export const LIMITER_BINDINGS={api:'API_LIMITER',seat:'SEAT_LIMITER',auth:'AUTH_LIMITER',verify:'AUTH_LIMITER',home:'AUTH_LIMITER',chain:'CHAIN_LIMITER',code:'API_LIMITER',member:'AUTH_LIMITER'} as const;
// Rate limits are per client (see rateLimitKey) and per Cloudflare location, or per the key the caller names ('home'
// passes the session, 'chain' a constant: still per location, never global; the global sign-in budgets live in D1). A failing binding throws to the caller: the read API fails open, the other
// buckets fail closed (server/auth.ts). A binding missing from the deployment (S2: renamed or dropped in wrangler.jsonc)
// throws LimiterMissing on any non-loopback request, and the route answers 503; only a loopback URL (wrangler dev, local
// E2E) keeps the old open path, where 'chain' still allows nothing.
function limiter(request:Request,env:Env):Allow&((bucket:keyof typeof LIMITER_BINDINGS,key?:string)=>Promise<boolean>) {
  const ip=rateLimitKey(request.headers.get('cf-connecting-ip')),loopback=LOOPBACK.has(new URL(request.url).hostname);
  return async(bucket:keyof typeof LIMITER_BINDINGS,key?:string)=>{
    const name=LIMITER_BINDINGS[bucket],binding=env[name];
    if(!binding){if(loopback)return bucket!=='chain';throw new LimiterMissing(name);}
    return (await binding.limit({key:key??(bucket==='verify'||bucket==='member'?bucket+':'+ip:ip)})).success;
  };
}
/** Chain reads for this request: Alchemy with the secret, or the CHAIN_MOCK_OWNERS fixture on a loopback URL only. */
export function chainAccess(request:Request,env:Env,chainFetch:typeof fetch):ChainAccess{
  const mock=LOOPBACK.has(new URL(request.url).hostname)?parseMockOwners(env.CHAIN_MOCK_OWNERS):null;
  return mock?{key:'local-mock',fetch:mockChainFetch(mock)}:{key:env.ALCHEMY_API_KEY||undefined,fetch:chainFetch};
}
type ScheduledController={scheduledTime:number;cron:string};
/** chainFetch reaches Alchemy for the wallet routes (Authorization is set, so upstreamFetch never edge-caches it).
 *  edgeCache: the location's Cache API for the gateway's shared copy (none outside workerd). */
export function createWorker(gateway:ReadGateway,chainFetch:typeof fetch=upstreamFetch,now:()=>number=Date.now,collections=CHARACTER_COLLECTIONS,
  edgeCache:()=>EdgeCache|undefined=defaultCache) {
  const ownership=new Ownership(gateway,collections),noCode=new Map<string,number>();   // per isolate (server/auth.ts NoCodeCache)
  return {
    async fetch(request:Request,env:Env,ctx:Context):Promise<Response> {
      const waitUntil=(promise:Promise<unknown>)=>ctx.waitUntil(promise),allow=limiter(request,env),ip=request.headers.get('cf-connecting-ip');
      const colo=(request as {cf?:{colo?:string}}).cf?.colo;
      // The member routes (server/member.ts) first: they answer only their own paths and only read the sign-in session.
      const member=await handleMemberApi(request,{db:env.DB,now,allow,client:networkKey(ip),colo});
      if(member)return member;
      const account=await handleAccountApi(request,{db:env.DB,now,allow,chain:chainAccess(request,env,chainFetch),ownership,waitUntil,noCode,
        client:networkKey(ip),sub:subnetKey(ip),colo});
      if(account)return account;
      const cache=edgeCache(),shared=cache?edgeCopy(cache,new URL(request.url).origin):undefined;
      const api=await handleWorldApi(request,gateway,{waitUntil,allow,floorKey:env.ALCHEMY_API_KEY||undefined,shared});
      return api??env.ASSETS.fetch(request);
    },
    /** Cron (every 15 min): record which seats IMD lists online. Nothing to do without a database. */
    async scheduled(_controller:ScheduledController,env:Env,ctx:Context):Promise<void> {
      if(!env.DB)return;
      ctx.waitUntil(recordPresence(gateway,env.DB,now(),p=>ctx.waitUntil(p)).then(r=>console.log('presence',JSON.stringify(r))));
    }
  };
}
