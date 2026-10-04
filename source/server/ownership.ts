import {encodeFunctionData,decodeFunctionResult,multicall3Abi,getAddress} from 'viem';
import type {ReadGateway,WaitUntil} from './gateway.ts';
import type {D1Database} from './d1.ts';
import {liveWorld,DAY_MS} from './presence.ts';
import {LimiterMissing} from './world-api.ts';
import {SEAT_COLLECTION} from '../src/world/market.ts';
import {CHARACTER_COLLECTIONS,type CharacterCollection} from '../src/world/collections.ts';
import {compareIds,type Agent} from '../src/world/model.ts';
import {houseSize,type HouseSize} from '../src/world/houseSize.ts';
import {isFreshAge} from '../src/shared/freshness.ts';
// Ownership and eligibility for the wallet routes (DESIGN_W1 §7). Discovery and proof are separate steps: candidate
// seat ids come from IMD's swarm.owners and Alchemy's NFT index; only ownerOf read on mainnet through Multicall3 (one
// eth_call, one block) proves ownership. Every chain read goes through an injected fetch (tests and local runs use
// fixtures). The Alchemy key only travels in the Authorization header; errors are generic and never cached, so a
// failure is 503 OWNERSHIP_UNAVAILABLE, never "owns nothing" (a failed index read with an answer kept from an earlier one
// is a limited answer instead, as when the budget refuses it: A-2).
export const ALCHEMY_RPC_URL='https://eth-mainnet.g.alchemy.com/v2';
export const ALCHEMY_NFTS_URL='https://eth-mainnet.g.alchemy.com/nft/v3/getNFTsForOwner';
export const MULTICALL3='0xcA11bde05977b3631167028862bE2a173976CA11';
export const ALCHEMY_IMAGE_HOST='nft-cdn.alchemy.com';
/** Ownership proof per address (ownerOf, one eth_call); candidate discovery per address (Alchemy's NFT index: 5 min, or
 *  30 s when the owner presses "Check again"); the character list per address, and how long a failed one is not asked
 *  again; seats online this long ago still count. A sold seat still drops within 30 s: ownerOf is re-read on the cached
 *  candidates. A newly bought one appears within 5 min (at once if IMD's swarm lists it; 30 s on "Check again"). */
export const OWNERSHIP_TTL_MS=30_000,CANDIDATES_TTL_MS=300_000,ASSETS_TTL_MS=300_000,FAILED_LIST_MS=60_000,ONLINE_WINDOW_MS=DAY_MS;
/** Candidate ids checked per address (supply 2000, largest holder 20 on 2026-09-27); ownerOf calls per eth_call;
 *  NFT index pages read (100 each); addresses cached per isolate. */
export const CANDIDATE_CAP=256,MULTICALL_CHUNK=200,NFT_PAGE_CAP=5,CACHE_LIMIT=512,CHAIN_TIMEOUT_MS=10_000;
const BLOCK_NUMBER=[{type:'function',name:'getBlockNumber',stateMutability:'view',inputs:[],outputs:[{name:'blockNumber',type:'uint256'}]}] as const;
const OWNER_OF=[{type:'function',name:'ownerOf',stateMutability:'view',inputs:[{name:'tokenId',type:'uint256'}],outputs:[{name:'',type:'address'}]}] as const;
export class OwnershipUnavailable extends Error{constructor(){super('OWNERSHIP_UNAVAILABLE');}}
/** Chain access for one request: the key (absent locally) and the fetch that reaches Alchemy (or a fixture). */
export type ChainAccess={key?:string;fetch:typeof fetch};
type Json=Record<string,unknown>;
const plain=(v:unknown):v is Json=>v!==null&&typeof v==='object'&&!Array.isArray(v);

/** One JSON-RPC call. A JSON-RPC error object is returned as `error` (a revert, or the node failing: the caller tells
 *  them apart, e.g. auth.ts `reverted`; here in ownership any error is OwnershipUnavailable); no key, a network or HTTP
 *  failure, or a malformed reply throws OwnershipUnavailable. */
export async function rpc(chain:ChainAccess,method:string,params:unknown[]):Promise<{result?:unknown;error?:unknown}>{
  if(!chain.key)throw new OwnershipUnavailable();
  let body:unknown;
  try{
    const r=await chain.fetch(ALCHEMY_RPC_URL,{method:'POST',signal:AbortSignal.timeout(CHAIN_TIMEOUT_MS),
      headers:{'content-type':'application/json',accept:'application/json',authorization:'Bearer '+chain.key},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    if(!r.ok)throw new Error();body=await r.json();
  }catch{throw new OwnershipUnavailable();}
  if(!plain(body))throw new OwnershipUnavailable();
  if(body.error!==undefined)return {error:body.error};
  if(!('result' in body))throw new OwnershipUnavailable();
  return {result:body.result};
}
/** ownerOf for every id at one block: without atBlock the first eth_call runs at `latest` and returns that block
 *  number (Multicall3.getBlockNumber); subsequent chunks and epoch deltas use that block. Reverting ownerOf is null. */
export async function ownersOf(chain:ChainAccess,ids:readonly string[],atBlock:number|null=null):Promise<{owners:Map<string,string|null>;block:number|null}>{
  if(atBlock!==null&&(!Number.isSafeInteger(atBlock)||atBlock<0))throw new OwnershipUnavailable();
  const owners=new Map<string,string|null>();let block:number|null=atBlock;
  for(let i=0;i<ids.length;i+=MULTICALL_CHUNK){
    const chunk=ids.slice(i,i+MULTICALL_CHUNK),head=block===null;
    const calls=[...head?[{target:MULTICALL3 as `0x${string}`,allowFailure:false,callData:encodeFunctionData({abi:BLOCK_NUMBER,functionName:'getBlockNumber'})}]:[],
      ...chunk.map(id=>({target:SEAT_COLLECTION as `0x${string}`,allowFailure:true,callData:encodeFunctionData({abi:OWNER_OF,functionName:'ownerOf',args:[BigInt(id)]})}))];
    const data=encodeFunctionData({abi:multicall3Abi,functionName:'aggregate3',args:[calls]});
    const {result,error}=await rpc(chain,'eth_call',[{to:MULTICALL3,data},head?'latest':'0x'+block!.toString(16)]);
    if(error!==undefined||typeof result!=='string')throw new OwnershipUnavailable();
    let out:readonly {success:boolean;returnData:`0x${string}`}[];
    try{out=decodeFunctionResult({abi:multicall3Abi,functionName:'aggregate3',data:result as `0x${string}`});}catch{throw new OwnershipUnavailable();}
    if(out.length!==calls.length)throw new OwnershipUnavailable();
    if(head){try{block=Number(BigInt(out[0].returnData));}catch{throw new OwnershipUnavailable();}
      if(!Number.isSafeInteger(block)||block<0)throw new OwnershipUnavailable();}
    out.slice(head?1:0).forEach((r,k)=>owners.set(chunk[k],r.success&&r.returnData.length===66?('0x'+r.returnData.slice(26)).toLowerCase():null));
  }
  return {owners,block};
}
export type IndexedNft={contract:string;tokenId:string;image:string|null;name:string|null};
/** Alchemy's NFT index for one owner, limited to `contracts`, up to NFT_PAGE_CAP pages. complete is false when more
 *  pages were left unread (the list is then shown as possibly incomplete, never as a complete zero). */
export async function indexedNfts(chain:ChainAccess,owner:string,contracts:readonly string[],withMetadata:boolean):Promise<{nfts:IndexedNft[];complete:boolean}>{
  if(!chain.key)throw new OwnershipUnavailable();
  const nfts:IndexedNft[]=[];let pageKey:string|null=null;
  for(let page=0;page<NFT_PAGE_CAP;page++){
    const url=new URL(ALCHEMY_NFTS_URL);url.searchParams.set('owner',owner);
    for(const c of contracts)url.searchParams.append('contractAddresses[]',c);
    url.searchParams.set('withMetadata',String(withMetadata));url.searchParams.set('pageSize','100');
    if(pageKey)url.searchParams.set('pageKey',pageKey);
    let body:unknown;
    try{const r=await chain.fetch(url.href,{signal:AbortSignal.timeout(CHAIN_TIMEOUT_MS),headers:{accept:'application/json',authorization:'Bearer '+chain.key}});
      if(!r.ok)throw new Error();body=await r.json();}catch{throw new OwnershipUnavailable();}
    if(!plain(body)||!Array.isArray(body.ownedNfts))throw new OwnershipUnavailable();
    for(const n of body.ownedNfts){
      if(!plain(n))continue;
      const contract=String(plain(n.contract)?n.contract.address:n.contractAddress??'').toLowerCase(),tokenId=typeof n.tokenId==='string'&&/^\d{1,80}$/.test(n.tokenId)?BigInt(n.tokenId).toString():null;
      if(!tokenId||!contracts.includes(contract))continue;
      nfts.push({contract,tokenId,image:safeImage(n.image),name:typeof n.name==='string'?n.name.slice(0,80):null});
    }
    pageKey=typeof body.pageKey==='string'&&body.pageKey?body.pageKey:null;
    if(!pageKey)return {nfts,complete:true};
  }
  return {nfts,complete:false};
}
/** Only Alchemy's own image CDN is rendered (CSP img-src allows exactly that host); IPFS gateways, arbitrary metadata
 *  hosts and data: URLs are dropped and the panel shows its local glyph. */
export function safeImage(image:unknown):string|null{
  if(!plain(image))return null;
  for(const v of [image.thumbnailUrl,image.cachedUrl,image.pngUrl]){
    if(typeof v!=='string'||v.length>1000)continue;
    try{const u=new URL(v);if(u.protocol==='https:'&&u.hostname===ALCHEMY_IMAGE_HOST&&!u.username&&!u.password&&!u.port)return u.href;}catch{/* not a URL */}
  }
  return null;
}

export type SeatStatus={tokenId:string;agentId:string|null;online:boolean;lastOnlineAt:number|null;counts:boolean;
  /** Why a held seat does not count: not a registered IMD agent; last seen online under this owner more than 24 h ago;
   *  or never recorded online under this owner (recording began at deploy; a buyer counts once they bring it online). */
  reason?:'not-agent'|'offline-24h'|'not-seen'};
export type HomeView={address:string;seats:SeatStatus[];eligible:number;size:HouseSize|null;block:number|null;checkedAt:number;
  /** The /workers read behind `online`: 'fresh' is the live roster; otherwise only recorded presence decides. */
  presence:'fresh'|'stale'|'unavailable';
  /** Not a complete answer. 'limited': the NFT index was due but the chain budget refused it (and, when that answer counted
   *  no seat, its network's index lane too, or the lane's own read failed: the request keeps its first proof, N-6 and
   *  AUD3-01), or the read failed with an answer kept, so the candidates are IMD's
   *  roster plus the last stored index answer (this isolate's or D1's, whichever is newer), and ownerOf proves them as
   *  always (a seat bought after both last listings may be missing). 'partial': more candidates than CANDIDATE_CAP, so
   *  some were not checked (A-4, N-3: seats that count, online now or seen under this owner in the last 24 h, come first,
   *  then other registered ones), or the index stopped at NFT_PAGE_CAP pages with more left. 'limited' is named when both
   *  apply. */
  recheck?:'limited'|'partial'};
/** The public view of a wallet: its seats as IMD's public roster (swarm.owners) lists them, with no keyed chain read at
 *  all (SEC-3: anyone can ask about any address); owner rights and on-chain proof come only from home(). */
export type AssetsView={address:string;source:'imd';seats:(SeatStatus&{image:string|null})[];fetchedAt:number|null;
  characters:{collections:{id:string;name:{zh:string;en:string};contract:string}[];items:IndexedNft[];state:'ok'|'unavailable'}};
export type OwnershipRequest={chain:ChainAccess;db?:D1Database;now:number;waitUntil?:WaitUntil;
  /** The chain budget (per Cloudflare location) every NFT index read spends first: home()'s candidates and the public
   *  character list. Absent or refusing means no such Alchemy call. */
  budget?:()=>Promise<boolean>;
  /** N-6 / AUD4: the network's discovery lane (bounded preflight/probe, 'chain:index:lane', then atomic INDEX_LANE), asked by home()
   *  only after `budget` refused an index read whose answer counts no seat; true lets that one read through. Absent: no lane. */
  lane?:()=>Promise<boolean>;
  /** The clock, read again after a proof queue wait, for cache freshness, and when an NFT index read begins (absent: `now`). Its answer is dated then, not when the request
   *  began: a request held before its index read (a slow roster read) must not date a later answer before one read
   *  meanwhile, or the newer-answer rule keeps the older one (Codex crosscheck review A2-R1). */
  clock?:()=>number};
/** indexedAt: when the index answer behind these candidates was read (0: none); limited: the index was due but refused,
 *  or failed with an answer kept; refused: the budget refused it (N-6's lane is only for those); partial: CANDIDATE_CAP
 *  left candidates unchecked, or the index left pages unread. */
type Proof={ids:string[];examined:Map<string,string|null>;failed:Set<string>;block:number|null;checkedAt:number;indexedAt:number;limited:boolean;refused:boolean;partial:boolean};
type ProofFlight={context:string;at:number;chain:ChainAccess;db:D1Database|undefined;promise:Promise<Proof>};
type Discovery={indexed?:Indexed;attemptedAt:number;limited:boolean;refused:boolean};
/** The counting rule (DESIGN_W1 §7): a registered IMD agent the live roster shows online now, or last seen online under
 *  this owner (seat_presence: CORR-03) within ONLINE_WINDOW_MS. One predicate for status(), the cap's rank (N-3) and the
 *  index lane (N-6), so no second copy of the 24 h rule exists. */
const counts=(agent:Agent|undefined,seen:number|undefined,now:number)=>agent?.agentId!=null&&(agent.presence==='online'||seen!==undefined&&seen>=now-ONLINE_WINDOW_MS);
/** Which candidates the cap keeps (A-4, N-3): seats that count (by that rule: online now, or seen under this owner in the
 *  last 24 h), then other registered ones, then the rest, each by id; the ones kept are checked and listed by id. */
const rank=(agent:Agent|undefined,seen:number|undefined,now:number)=>agent?.agentId==null?2:counts(agent,seen,now)?0:1;
/** The budget refused an index read (never cached; the caller falls back to the roster). */
class Limited extends Error{}
/** A-2 across instances: the last NFT-index answer per address, kept in D1 (migrations/0004) so every isolate and
 *  location has it, not only the one that read it. Every successful index read keeps its answer with one statement, run
 *  after the reply (waitUntil): an answer naming seats is upserted (at most CANDIDATE_CAP ids, ranked and cut like the
 *  candidates, N-3 included), never over a newer one (read_at: when the index read began); an answer naming none
 *  deletes the row, so a throwaway address writes nothing. It is read only when an index read is refused or fails, and
 *  it only names candidates: ownerOf proves each one.
 *  D1 (measured on workerd's D1): the upsert reads ≤ 1 row and writes 1 (2 for an address not kept yet: the row and its
 *  key); the delete writes none (1 when it removes a row); the read reads ≤ 1. Upserts are bounded by chain:index
 *  (20/min per location) and the index lanes (N-6: one read a minute per network, 600 a minute site-wide), reads by the
 *  proof cache (30 s per address and isolate) and the 'home' limit; the table holds only addresses the index names a
 *  seat for, and the cron deletes rows older than INDEX_KEEP_MS (server/presence.ts).
 *  Without a database (the Vite dev server) nothing is read or written; before the migration both fail and are ignored:
 *  this isolate's answer alone, as before. */
export const KEEP_INDEX=`INSERT INTO index_candidates(address,ids,read_at) VALUES(?1,?2,?3)
 ON CONFLICT(address) DO UPDATE SET ids=excluded.ids,read_at=excluded.read_at WHERE excluded.read_at>=index_candidates.read_at`;
export const DROP_INDEX='DELETE FROM index_candidates WHERE address=?1 AND read_at<=?2';
export const READ_INDEX='SELECT ids,read_at FROM index_candidates WHERE address=?1';
/** at: when the index read began (req.clock after the budget), in D1 read_at; complete: false when the index stopped at
 *  NFT_PAGE_CAP pages with more left (this isolate's reads only; a kept answer is read only when the index is refused or
 *  fails, and that view is 'limited' anyway). */
type Indexed={ids:string[];at:number;complete?:boolean};
function keepIndex(address:string,ids:string[],at:number,req:OwnershipRequest){
  if(!req.db)return;
  try{const done=(ids.length?req.db.prepare(KEEP_INDEX).bind(address,JSON.stringify(ids),at):req.db.prepare(DROP_INDEX).bind(address,at)).run().then(()=>{},()=>{});
    req.waitUntil?.(done);}catch{/* never fails the read */}
}
async function keptIndex(address:string,db:D1Database|undefined):Promise<Indexed|undefined>{
  if(!db)return undefined;
  try{
    const row=await db.prepare(READ_INDEX).bind(address).first<{ids:string;read_at:number}>(),ids:unknown=row&&JSON.parse(row.ids);
    if(!row||!Array.isArray(ids))return undefined;
    return {ids:ids.filter((id):id is string=>typeof id==='string'&&/^\d{1,80}$/.test(id)).slice(0,CANDIDATE_CAP),at:Number(row.read_at)};
  }catch{return undefined;}
}
type Entry<T>={value?:T;at:number;inflight?:Promise<T>};
/** Per-isolate LRU with in-flight sharing. Failures are never stored: a failed reload puts back the last good value with
 *  its own age (A-2, stale on error), so `peek` still has it and the next read past its age loads again. The age limit
 *  is the caller's, per read, and `keep` can refuse a stored value that is young enough but not good enough for this read. */
class Cache<T>{
  private map=new Map<string,Entry<T>>();
  /** The stored value, if any, without loading or reordering. */
  peek(key:string):T|undefined{return this.map.get(key)?.value;}
  async get(key:string,now:number,ttl:number,load:()=>Promise<T>,keep:(v:T)=>boolean=()=>true):Promise<T>{
    const hit=this.map.get(key);
    if(hit){this.map.delete(key);this.map.set(key,hit);if(hit.inflight)return hit.inflight;if(hit.value!==undefined&&isFreshAge(now,hit.at,ttl)&&keep(hit.value))return hit.value;}
    const entry:Entry<T>={at:now},last=hit?.value!==undefined?hit:undefined;
    entry.inflight=load().then(v=>{entry.value=v;return v;},e=>{if(this.map.get(key)===entry){if(last)this.map.set(key,last);else this.map.delete(key);}throw e;}).finally(()=>{entry.inflight=undefined;});
    this.map.set(key,entry);while(this.map.size>CACHE_LIMIT)this.map.delete(this.map.keys().next().value!);
    return entry.inflight;
  }
}
export class Ownership{
  private proofs=new Map<string,Proof>();private proofing=new Map<string,ProofFlight>();private discovery=new Cache<Discovery>();
  private candidates=new Cache<Indexed>();private lists=new Cache<IndexedNft[]>();private failed=new Map<string,number>();
  private gateway:Pick<ReadGateway,'source'>;private collections:readonly CharacterCollection[];
  constructor(gateway:Pick<ReadGateway,'source'>,collections:readonly CharacterCollection[]=CHARACTER_COLLECTIONS){this.gateway=gateway;this.collections=collections;}
  private async world(waitUntil?:WaitUntil){
    const [swarm,workers]=await Promise.all([this.gateway.source('swarm',waitUntil),this.gateway.source('workers',waitUntil)]);
    if(!swarm.data)throw new OwnershipUnavailable();
    const world=liveWorld(swarm,workers);
    return {agents:new Map(world.agents.map(a=>[a.tokenId,a])),owners:Array.isArray((swarm.data as Json).owners)?(swarm.data as Json).owners as unknown[]:[],
      presence:workers.state,fetchedAt:swarm.fetchedAt};
  }
  /** Discovery never grants ownership or renews an ownerOf epoch. Ordinary index reads use their 5 minute cadence;
   *  fresh reads use 30 seconds. Failed/refused discovery is held for 30 seconds too, without dating the fallback
   *  index as new. A reserved lane (`again`) may retry discovery, but cannot bypass a still-valid crypto result.
   *  Epochs keep positive AND negative results, at one block, for a fixed 30 second deadline. Newly discovered ids
   *  get only a pinned delta proof; at most CANDIDATE_CAP results are examined in the entire epoch. */
  private proof(address:string,owners:unknown[],agents:Map<string,Agent>,req:OwnershipRequest,fresh:boolean,again=false):Promise<Proof>{
    // Scope includes candidate membership and ranking inputs, not request-entry time. Same-context waiters share a
    // controlled failure; a queued independent roster/discovery intent gets its own evaluation after settlement.
    const owned=owners.flatMap((o,i)=>typeof o==='string'&&o.toLowerCase()===address?[String(i)]:[]);
    const context=JSON.stringify([fresh,again,owned,[...agents].map(([id,a])=>[id,a.agentId===null?2:a.presence==='online'?0:1])
      .sort((a,b)=>compareIds(String(a[0]),String(b[0])))]);
    const pending=this.proofing.get(address);
    // Serialise updates rather than returning another request's answer as complete. The caller may already have a
    // different roster/fresh intent: after the first update settles it discovers/proves only its missing delta.
    if(pending){const same=pending.context===context&&pending.chain.key===req.chain.key&&pending.chain.fetch===req.chain.fetch&&pending.db===req.db&&
        isFreshAge(req.clock?.()??req.now,pending.at,OWNERSHIP_TTL_MS);
      const evaluate=()=>this.proof(address,owners,agents,req,fresh,again);
      return pending.promise.then(evaluate,same?undefined:evaluate);}
    // Active updates are never evicted (that would duplicate in-flight work). The existing isolate address cap also
    // bounds their metadata; a new key at capacity is unavailable and may retry after an existing update settles.
    if(this.proofing.size>=CACHE_LIMIT)return Promise.reject(new OwnershipUnavailable());
    const store=(proof:Proof)=>{this.proofs.delete(address);this.proofs.set(address,proof);
      while(this.proofs.size>CACHE_LIMIT)this.proofs.delete(this.proofs.keys().next().value!);return proof;};
    const update=async():Promise<Proof>=>{
      if(!Number.isFinite(req.now))throw new OwnershipUnavailable();
      // An overlapping request's entry time can precede a local index answer completed while it waited. Compare
      // cache ages with the same live clock that dates discovery/proof, without accepting actual future evidence.
      const current=()=>req.clock?.()??req.now,discoveryNow=current();
      if(!Number.isFinite(discoveryNow))throw new OwnershipUnavailable();
      const candidates=new Set<string>();
      owners.forEach((o,i)=>{if(typeof o==='string'&&o.toLowerCase()===address)candidates.add(String(i));});
      // N-3: past the cap, the cut ranks by the counting rule itself, so a seat that counts through a recent sighting is
      // never cut for seats that cannot count. Only a cut needs sightings: one seat_presence read per build, of the
      // registered seats of roster and index not online now (the only ones a sighting can promote; PK lookups, at most
      // the candidates), shared by both cuts (the one kept in D1 and the one proven). No database, or the read failing:
      // the live roster alone ranks, as before (A-4).
      let seen:Promise<Map<string,number>>|undefined;
      const best=async(ids:Iterable<string>,limit=CANDIDATE_CAP)=>{const list=[...ids];if(limit<=0)return [];
        const sightings=list.length<=limit?new Map<string,number>():await(seen??=this.sightings([...new Set([...candidates,...list])]
          .filter(id=>rank(agents.get(id),undefined,req.now)===1),address,req.db).catch(()=>new Map<string,number>()));
        const order=(id:string)=>rank(agents.get(id),sightings.get(id),req.now);
        return list.sort((x,y)=>order(x)-order(y)||compareIds(x,y)).slice(0,limit);};
      const discovery=await this.discovery.get(address,discoveryNow,CANDIDATES_TTL_MS,async()=>{
        const attemptedAt=current();
        if(!Number.isFinite(attemptedAt))throw new OwnershipUnavailable();
        try{
          const indexed=await this.candidates.get(address,current(),fresh?OWNERSHIP_TTL_MS:CANDIDATES_TTL_MS,async()=>{
            if(!req.budget||!await req.budget())throw new Limited();
            const at=req.clock?.()??req.now;                                      // the index read begins now (A2-R1)
            if(!Number.isFinite(at))throw new OwnershipUnavailable();
            const {nfts,complete}=await indexedNfts(req.chain,address,[SEAT_COLLECTION],false),ids=[...new Set(nfts.map(n=>n.tokenId))];
            keepIndex(address,await best(ids),at,req);return {ids,at,complete};
          },v=>!again&&isFreshAge(current(),v.at,fresh?OWNERSHIP_TTL_MS:CANDIDATES_TTL_MS));
          return {indexed,attemptedAt,limited:false,refused:false};
        }catch(e){
          if(!(e instanceof Limited||e instanceof OwnershipUnavailable))throw e;
          const mine=this.candidates.peek(address),kept=await keptIndex(address,req.db);
          const dated=(v:Indexed|undefined)=>v!==undefined&&Number.isFinite(v.at)&&v.at<=current();
          // Future/invalid D1 dates may name candidates, but never win a newer-evidence comparison against a valid date.
          const indexed=kept&&(!mine||dated(kept)&&(!dated(mine)||kept.at>mine.at))?kept:mine;
          if(!(e instanceof Limited)&&!indexed?.ids.length)throw e;                // failed with no kept candidates: 503
          return {indexed,attemptedAt,limited:true,refused:e instanceof Limited};
        }
      },d=>!(again&&d.refused)&&(d.limited?isFreshAge(current(),d.attemptedAt,OWNERSHIP_TTL_MS):
        d.indexed!==undefined&&isFreshAge(current(),d.indexed.at,fresh?OWNERSHIP_TTL_MS:CANDIDATES_TTL_MS)));
      const {indexed,limited,refused}=discovery;
      for(const id of indexed?.ids??[])candidates.add(id);
      // Discovery/admission can wait longer than the crypto TTL. Re-evaluate the epoch at proof work's actual start,
      // rather than the home request's earlier clock; an expired epoch needs new evidence at latest, not a delta.
      const proofNow=req.clock?.()??req.now;
      if(!Number.isFinite(proofNow))throw new OwnershipUnavailable();
      const old=this.proofs.get(address),valid=old!==undefined&&isFreshAge(proofNow,old.checkedAt,OWNERSHIP_TTL_MS);
      const examined=new Map(valid?old.examined:undefined),failed=new Set(valid?old.failed:undefined),room=CANDIDATE_CAP-examined.size-failed.size;
      const ids=(await best([...candidates].filter(id=>!examined.has(id)&&!failed.has(id)),room)).sort(compareIds);
      // The deadline belongs to the epoch, including an empty/refused epoch: a delta never extends it.
      const checkedAt=valid?old.checkedAt:proofNow;let block=valid?old.block:null;
      if(!Number.isFinite(checkedAt))throw new OwnershipUnavailable();
      try{
        if(ids.length){const result=await ownersOf(req.chain,ids,block);block=result.block;
          for(const [id,owner] of result.owners)examined.set(id,owner);}
      }catch(e){
        if(!(e instanceof OwnershipUnavailable)||!valid||!isFreshAge(req.clock?.()??req.now,old.checkedAt,OWNERSHIP_TTL_MS))throw e;
        // No new crypto evidence was obtained. Failed IDs are unavailable, never guessed negative/owned, and count
        // toward this epoch's attempt cap. Retry only after its original deadline, without renewing old evidence.
        for(const id of ids)failed.add(id);
        return store({...old,failed,limited:true,refused,partial:true});
      }
      const done=req.clock?.()??req.now;
      if(!isFreshAge(done,checkedAt,OWNERSHIP_TTL_MS))throw new OwnershipUnavailable();
      const partial=indexed?.complete===false||[...candidates].some(id=>!examined.has(id));
      const proof:Proof={ids:[...examined].filter(([,owner])=>owner===address).map(([id])=>id).sort(compareIds),examined,failed,block,
        checkedAt,indexedAt:indexed?.at??0,limited:limited||failed.size>0,refused,partial};
      return store(proof);
    };
    const flight:ProofFlight={context,at:req.clock?.()??req.now,chain:req.chain,db:req.db,promise:undefined!};
    flight.promise=update().finally(()=>{if(this.proofing.get(address)===flight)this.proofing.delete(address);});
    this.proofing.set(address,flight);return flight.promise;
  }
  /** Last recorded sighting per seat under `owner` (cron; the owner is IMD's swarm view at the time), one query. A
   *  sighting made under a previous owner never counts for a buyer (CORR-03). Without a database only the live roster counts. */
  private async sightings(ids:string[],owner:string,db:D1Database|undefined):Promise<Map<string,number>>{
    if(!db||!ids.length)return new Map();
    const {results}=await db.prepare('SELECT token_id,last_online_at FROM seat_presence WHERE token_id IN (SELECT value FROM json_each(?1)) AND owner=?2')
      .bind(JSON.stringify(ids.map(Number)),owner).all<{token_id:number;last_online_at:number}>();
    return new Map(results.map(r=>[String(r.token_id),r.last_online_at]));
  }
  private status(id:string,agent:Agent|undefined,seen:number|undefined,now:number):SeatStatus{
    const online=agent?.presence==='online',agentId=agent?.agentId??null,lastOnlineAt=online?now:seen??null,count=counts(agent,seen,now);
    const reason=agentId===null?'not-agent' as const:count?null:lastOnlineAt===null?'not-seen' as const:'offline-24h' as const;
    return {tokenId:id,agentId,online,lastOnlineAt,counts:count,...reason?{reason}:{}};
  }
  /** The session address's household: verified seats, each with agent status and whether it counts toward the house.
   *  When the chain budget refused a due index read (and its network's lane was refused too, or the lane's own read
   *  failed), or the cap left candidates unchecked, the view says so in `recheck` (for as long as that proof lives), never
   *  as a complete answer. */
  async home(address:string,req:OwnershipRequest,fresh=false):Promise<HomeView>{
    const a=address.toLowerCase(),world=await this.world(req.waitUntil);
    let proof=await this.proof(a,world.owners,world.agents,req,fresh),seen=await this.sightings(proof.ids,a,req.db);
    // N-6: a read the budget refused whose answer counts no seat may be hiding a seat only the index names (a new buyer,
    // or one whose kept answer names only seats sold since, or none that count). Its network's lane (server/auth.ts
    // AUD4 preflight/probe, then 'chain:index:lane', then atomic INDEX_LANE: one admitted read a minute, IPv6 one per /64
    // and two per /48, at most INDEX_LANE_BUDGET per 6 s site-wide) reads the index once, keeping the answer (KEEP_INDEX); ownerOf
    // proves it as always, and nothing the client sends is a candidate. The lane is asked before the rebuild, so a
    // refused one costs no second ownerOf; refused, the view stays 'limited' (could not check, never "owns nothing").
    // AUD3-01 (Swarm audit 1ef8e8a6 #1): the lane's read was sent, so if it (or the ownerOf read after it) fails, this
    // request keeps the proof it already has, refused and so 'limited', with that proof's sightings (the pair replaces
    // only together), and the lane stays spent: no refund for a read that went out. Any other error propagates.
    if(proof.refused&&req.lane&&!proof.ids.some(id=>counts(world.agents.get(id),seen.get(id),req.now))&&await req.lane()){
      try{const p=await this.proof(a,world.owners,world.agents,{...req,budget:async()=>true},fresh,true),s=await this.sightings(p.ids,a,req.db);proof=p;seen=s;}
      catch(e){if(!(e instanceof OwnershipUnavailable))throw e;}}
    const seats=proof.ids.map(id=>this.status(id,world.agents.get(id),seen.get(id),req.now)),eligible=seats.filter(s=>s.counts).length;
    return {address:getAddress(a),seats,eligible,size:eligible?houseSize(eligible):null,block:proof.block,checkedAt:proof.checkedAt,presence:world.presence,
      ...proof.limited?{recheck:'limited' as const}:proof.partial?{recheck:'partial' as const}:{}};
  }
  /** Public assets of any address: seats as IMD's roster lists them (no keyed read, no image), with agent status and
   *  home()'s counting rule, unverified. Character NFTs (none configured yet) need Alchemy's index: one keyed read per
   *  address per ASSETS_TTL_MS, only within the global budget; a failed one is not asked again for FAILED_LIST_MS. */
  async assets(address:string,req:OwnershipRequest):Promise<AssetsView>{
    const a=address.toLowerCase(),world=await this.world(req.waitUntil),ids:string[]=[];
    world.owners.forEach((o,i)=>{if(typeof o==='string'&&o.toLowerCase()===a)ids.push(String(i));});
    const seen=await this.sightings(ids,a,req.db);
    return {address:getAddress(a),source:'imd',fetchedAt:world.fetchedAt,
      seats:ids.map(id=>({...this.status(id,world.agents.get(id),seen.get(id),req.now),image:null})),
      characters:{collections:this.collections.map(c=>({id:c.id,name:c.name,contract:c.contract.toLowerCase()})),...await this.characters(a,req)}};
  }
  private async characters(a:string,req:OwnershipRequest):Promise<{items:IndexedNft[];state:'ok'|'unavailable'}>{
    if(!this.collections.length)return {items:[],state:'ok'};
    const failedAt=this.failed.get(a);
    if(failedAt!==undefined&&isFreshAge(req.now,failedAt,FAILED_LIST_MS))return {items:[],state:'unavailable'};
    try{
      const items=await this.lists.get(a,req.now,ASSETS_TTL_MS,async()=>{
        if(!req.budget||!await req.budget())throw new OwnershipUnavailable();
        return (await indexedNfts(req.chain,a,this.collections.map(c=>c.contract.toLowerCase()),true)).nfts;
      });
      this.failed.delete(a);return {items,state:'ok'};
    }catch(e){
      if(e instanceof LimiterMissing)throw e;                                       // a deployment without the budget: 503, never cached as a failure
      this.failed.set(a,req.now);while(this.failed.size>CACHE_LIMIT)this.failed.delete(this.failed.keys().next().value!);
      return {items:[],state:'unavailable'};
    }
  }
}
