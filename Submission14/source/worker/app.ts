import {GATEWAY_DEFAULTS,SHARED_SHAPE,type ReadGateway,type SharedCopy} from '../server/gateway.ts';
import {handleWorldApi,LimiterMissing,API_HEADERS,type Allow} from '../server/world-api.ts';
import {UPSTREAM_TTL_MS} from '../src/world/cadence.ts';
import {handleAccountApi,pruneIndexProbes} from '../server/auth.ts';
import {handleMemberApi,pruneMemberRecords} from '../server/member.ts';
import {handleMemberBalances} from '../server/member-balances.ts';
import {handleInventoryApi} from '../server/inventory.ts';
import {handleAIMarketAuth,pruneAIMarketAuth} from '../server/aimarket-auth.ts';
import {handleCelestaoAuth,pruneCelestaoAuth} from '../server/celestao-auth.ts';
import {handleAIMarketAdmin} from '../server/aimarket-admin.ts';
import {handleAIMarketCampaign} from '../server/aimarket-campaign.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {reconcileWorldGold} from '../server/world-gold.ts';
import {sharedGoldSchemaPresent,worldGoldSchemaReady} from '../server/world-gold-schema.ts';
import {hasGoldDeliveryProvider,runGoldServiceJobs,combineGoldProviders,type GoldDeliveryProvider} from '../server/world-gold-delivery.ts';
import {reviewedEconomyConfig} from '../server/economy-deployment.ts';
import {createAIMarketDelivery} from '../server/aimarket-delivery.ts';
import {createResearchPassDelivery} from '../server/research-pass.ts';
import {createCelestaoDelivery} from '../server/celestao-delivery.ts';
import {handleCelestaoCheckout} from '../server/celestao-checkout.ts';
import {handleWorldGoldReport} from '../server/world-gold-report.ts';
import {createEconomyRpc,syncEconomyChain,EconomyRpcError,ECONOMY_PROVIDER_LOG_BLOCK_RANGE,type EconomyRpc} from '../server/economy-rpc.ts';
import type {EconomyConfig} from '../server/economy-config.ts';
import {Ownership,type ChainAccess} from '../server/ownership.ts';
import {recordPresence} from '../server/presence.ts';
import {mockChainFetch,parseMockOwners} from '../server/chain-mock.ts';
import {CHARACTER_COLLECTIONS} from '../src/world/collections.ts';
import type {D1Database} from '../server/d1.ts';
// Cloudflare Worker for imdember.com (entry: worker/index.ts). wrangler.jsonc routes only /api/world/* and the wallet
// routes (/api/auth/*, /api/me/*, /api/wallet/*) and /api/aimarket-auth/* to it (assets.run_worker_first); every other path is served by Workers
// Static Assets from dist/ without running this code. The cron trigger runs `scheduled` (presence, M1 and probe cleanup).
// Helpers live here, not in the entry: workerd treats every named export of the entry module as an entrypoint and
// refuses to start on one that is not a handler (a string constant, for example).
type AssetsBinding={fetch(request:Request):Promise<Response>};
type RateLimit={limit(options:{key:string}):Promise<{success:boolean}>};
/** ALCHEMY_API_KEY: a Worker secret (production only), used server-side for the seat floor and the wallet routes'
 *  chain reads; never sent to clients. AIMARKET_BRIDGE_SECRET: separate backend-only random SSO credential, never an
 *  owner key; absent means bridge disabled. DB: D1 for sign-in and presence. CHAIN_MOCK_OWNERS: local E2E only (loopback). */
export type Env={ASSETS:AssetsBinding;API_LIMITER?:RateLimit;SEAT_LIMITER?:RateLimit;AUTH_LIMITER?:RateLimit;CHAIN_LIMITER?:RateLimit;ALCHEMY_API_KEY?:string;
  DB?:D1Database;CHAIN_MOCK_OWNERS?:string;AIMARKET_BRIDGE_SECRET?:string;CELESTAO_BRIDGE_SECRET?:string;CELESTAO_DELIVERY_SECRET?:string;CELESTAO_PAID_ENABLED?:string;ECONOMY_LIMITER?:RateLimit;ECONOMY_CHAIN_LIMITER?:RateLimit;BRIDGE_LIMITER?:RateLimit};
export type Context={waitUntil(promise:Promise<unknown>):void};
/** The research server's per-read session checks ('aimarket:session:*') get their own, larger budget (wrangler.jsonc
 *  BRIDGE_LIMITER) when it is bound; every other bridge key, and local runs without it, keep AUTH_LIMITER. */
export const authBudget=(env:Env,key:string):RateLimit|undefined=>key.startsWith('aimarket:session:')&&env.BRIDGE_LIMITER?env.BRIDGE_LIMITER:env.AUTH_LIMITER;

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
/** Internal test seam. The deployed entry passes no override; requests and
 * environment values cannot supply a deployment record or an RPC endpoint. */
export type EconomyWorkerDeps={config:()=>Promise<EconomyConfig|null>;rpc?:(env:Env)=>EconomyRpc;delivery?:GoldDeliveryProvider};
/** chainFetch reaches Alchemy for the wallet routes (Authorization is set, so upstreamFetch never edge-caches it).
 *  edgeCache: the location's Cache API for the gateway's shared copy (none outside workerd). */
export function createWorker(gateway:ReadGateway,chainFetch:typeof fetch=upstreamFetch,now:()=>number=Date.now,collections=CHARACTER_COLLECTIONS,
  edgeCache:()=>EdgeCache|undefined=defaultCache,economy:EconomyWorkerDeps={config:reviewedEconomyConfig}) {
  const ownership=new Ownership(gateway,collections),noCode=new Map<string,number>();   // per isolate (server/auth.ts NoCodeCache)
  const deliveryFor=(env:Env)=>economy.delivery??combineGoldProviders(createAIMarketDelivery(env.AIMARKET_BRIDGE_SECRET,chainFetch,now),createCelestaoDelivery(env.DB,env.CELESTAO_DELIVERY_SECRET,chainFetch,now),createResearchPassDelivery());
  /** The economy RPC under ECONOMY_CHAIN_LIMITER (the finalized indexer's key). */
  const economyRpc=(env:Env,key:'economy:rpc'):EconomyRpc=>{
    const base=economy.rpc?.(env)??createEconomyRpc({key:env.ALCHEMY_API_KEY||undefined,fetch:chainFetch});
    return async(method,params)=>{
      if(!(await env.ECONOMY_CHAIN_LIMITER!.limit({key})).success)throw Error('ECONOMY_RPC_RATE_LIMITED');
      return base(method,params);
    };
  };
  const syncEconomy=async(env:Env,at:number)=>{
    if(!env.DB)return;
    const config=await economy.config();if(!config||!env.ECONOMY_CHAIN_LIMITER)return;
    await syncEconomyChain(env.DB,config,{rpc:economyRpc(env,'economy:rpc'),nowMs:at,maxLogBlockRange:ECONOMY_PROVIDER_LOG_BLOCK_RANGE});
  };
  const maintainGold=async(env:Env,at:number)=>{
    if(!env.DB)return;
    if(!await sharedGoldSchemaPresent(env.DB))return;
    if(!await worldGoldSchemaReady(env.DB)){console.log('gold_maintenance',JSON.stringify({status:'deferred',code:'SCHEMA_INCOMPLETE'}));return;}
    const result=await reconcileWorldGold(env.DB,at);if(result.failures.length)console.log('gold_reconcile',JSON.stringify(result.failures));
    if(result.rewards.some(r=>r.status!=='credited'))console.log('gold_rewards',JSON.stringify(result.rewards));
    // GOLD fast credit was retired on 2026-10-27 with every fast credit settled, so no credit is left to follow.
    const delivery=deliveryFor(env);
    if(hasGoldDeliveryProvider(delivery))await runGoldServiceJobs(env.DB,delivery,now);
  };
  return {
    async fetch(request:Request,env:Env,ctx:Context):Promise<Response> {
      const waitUntil=(promise:Promise<unknown>)=>ctx.waitUntil(promise),allow=limiter(request,env),ip=request.headers.get('cf-connecting-ip');
      const colo=(request as {cf?:{colo?:string}}).cf?.colo;
      // A backend-only secret, unrelated to administrator keys; absent configuration disables this new bridge.
      const celestial=await handleCelestaoAuth(request,{db:env.DB,secret:env.CELESTAO_BRIDGE_SECRET,now,client:rateLimitKey(ip),
        allow:async key=>{if(!env.AUTH_LIMITER)throw new LimiterMissing('AUTH_LIMITER');return (await env.AUTH_LIMITER.limit({key})).success;}});
      if(celestial)return celestial;
      if(new URL(request.url).pathname.startsWith('/api/celestao-checkout/')){
        const checkout=await handleCelestaoCheckout(request,{db:env.DB,secret:env.CELESTAO_DELIVERY_SECRET,enabled:env.CELESTAO_PAID_ENABLED==='1',
          ready:deliveryFor(env)?.products?.some(p=>p.startsWith('fortune-'))===true,config:await economy.config(),now,client:rateLimitKey(ip),allow:key=>allow('home',key)});
        if(checkout)return checkout;
      }
      const bridge=await handleAIMarketAuth(request,{db:env.DB,secret:env.AIMARKET_BRIDGE_SECRET,now,client:rateLimitKey(ip),
        allow:async key=>{const limiter=authBudget(env,key);if(!limiter)throw new LimiterMissing('AUTH_LIMITER');return (await limiter.limit({key})).success;}});
      if(bridge)return bridge;
      const admin=await handleAIMarketAdmin(request,{db:env.DB,now,client:rateLimitKey(ip),allow:key=>allow('home',key)});
      if(admin)return admin;
      const campaign=await handleAIMarketCampaign(request,{db:env.DB,now,allow:()=>allow('home','aimarket-campaign:'+rateLimitKey(ip))});
      if(campaign)return campaign;
      const path=new URL(request.url).pathname;
      const inventory=await handleInventoryApi(request,{db:env.DB,now,allow:()=>allow('home','inventory:'+rateLimitKey(ip)),
        home:(wallet,fresh)=>ownership.home(wallet,{chain:chainAccess(request,env,chainFetch),db:env.DB,now:now(),waitUntil,
          budget:()=>allow('chain','inventory:home'),clock:now},fresh)});
      if(inventory)return inventory;
      const report=await handleWorldGoldReport(request,{db:env.DB,provider:createAIMarketDelivery(env.AIMARKET_BRIDGE_SECRET,chainFetch,now),now,allow:()=>allow('home','gold-report:'+rateLimitKey(ip))});
      if(report)return report;
      const balances=await handleMemberBalances(request,{db:env.DB,config:economy.config,chain:chainAccess(request,env,chainFetch),now,allow,client:networkKey(ip)});
      if(balances)return balances;
      if(path==='/api/me/economy'||path.startsWith('/api/economy/')||path==='/api/me/gold'||path==='/api/me/aimarket-trial'||path.startsWith('/api/gold/')){
        let config:EconomyConfig|null=null;try{config=await economy.config();}catch{/* A failed release gate remains closed. */}
        const delivery=deliveryFor(env);
        const deps={db:env.DB,config,now,serviceReady:hasGoldDeliveryProvider(delivery),serviceProducts:delivery?.products,client:rateLimitKey(ip),allow:async(key:string)=>{
          if(!env.ECONOMY_LIMITER)throw new LimiterMissing('ECONOMY_LIMITER');
          return (await env.ECONOMY_LIMITER.limit({key})).success;
        }};
        // This deployed World entry always requires the complete shared book,
        // even on a pre-0014 DB. Historical standalone helper tests are not a
        // fallback deployment mode and cannot reopen the old catalogue route.
        if(config&&env.DB&&request.method==='POST'&&!await worldGoldSchemaReady(env.DB))return new Response(JSON.stringify({error:'SCHEMA_INCOMPLETE'}),{status:503,headers:API_HEADERS});
        const response=await handleWorldGoldApi(request,deps)??await handleEconomyApi(request,deps);
        if(response)return response;
      }
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
    /** Cron (every 15 min): record which seats IMD lists online, and independently drain expired M1 records in
     *  bounded batches. No database: skip. A database still on 0006: reads stay available and cleanup skips safely. */
    async scheduled(_controller:ScheduledController,env:Env,ctx:Context):Promise<void> {
      if(!env.DB)return;
      // Financial indexing/settlement has its own bounded minute tick. It does
      // not run presence, prune sessions, or consume the identity/NFT budgets.
      if(_controller.cron==='* * * * *'){
        const at=now();if(!Number.isSafeInteger(at)||at<=0)return;
        ctx.waitUntil(Promise.allSettled([syncEconomy(env,at),maintainGold(env,at)]).then(results=>{for(const [i,r] of results.entries())if(r.status==='rejected')console.log(i?'gold_maintenance':'economy_sync',JSON.stringify({status:'unavailable',code:r.reason instanceof EconomyRpcError?r.reason.code:'INTERNAL_ERROR'}));}));return;
      }
      // Validate every housekeeping clock before starting any persistent work; preserve each helper's finite sample.
      const presenceNow=now(),memberNow=now(),probeNow=now();
      if(![presenceNow,memberNow,probeNow].every(Number.isFinite)){
        console.log('scheduled',JSON.stringify({status:'invalid_clock'}));return;
      }
      ctx.waitUntil(recordPresence(gateway,env.DB,presenceNow,p=>ctx.waitUntil(p)).then(r=>console.log('presence',JSON.stringify(r))));
      ctx.waitUntil(pruneMemberRecords(env.DB,memberNow).then(r=>console.log('member_cleanup',JSON.stringify(r)))
        .catch(()=>console.log('member_cleanup',JSON.stringify({status:'unavailable'}))));
      // Probe backoff has an independent lifecycle: an absent M1 schema must not gate it, and a failed probe prune
      // must not cancel presence/member housekeeping. The helper caps the deletion batch at 200 rows.
      ctx.waitUntil(pruneIndexProbes(env.DB,probeNow).then(r=>console.log('index_probe_cleanup',JSON.stringify(r)))
        .catch(()=>console.log('index_probe_cleanup',JSON.stringify({status:'unavailable'}))));
      if(env.AIMARKET_BRIDGE_SECRET)ctx.waitUntil(pruneAIMarketAuth(env.DB,probeNow).then(r=>console.log('aimarket_bridge_cleanup',JSON.stringify(r)))
        .catch(()=>console.log('aimarket_bridge_cleanup',JSON.stringify({status:'unavailable'}))));
      if(env.CELESTAO_BRIDGE_SECRET)ctx.waitUntil(pruneCelestaoAuth(env.DB,probeNow).catch(()=>{}));
    }
  };
}
