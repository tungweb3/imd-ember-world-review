import type {ReadGateway,WaitUntil} from './gateway.ts';
import type {D1Database} from './d1.ts';
import {deriveWorld,type FeedKey,type SourceSample,type WorldState} from '../src/world/model.ts';
// Presence recorder (cron */15, worker/app.ts scheduled) and the world view the wallet routes share. Presence means
// exactly what the client means (model.ts deriveWorld): a seat the /workers roster lists is online; a seat missing
// from a fresh, complete roster is offline; anything else is unknown. The recorder writes only from a complete roster,
// so a failed or partial read never makes anyone look offline for longer than they were.
export const DAY_MS=86_400_000;
const FEEDS:FeedKey[]=['swarm','workers','jobs','oracle','publications','launches'];
const blank=(key:string):SourceSample=>({state:'unavailable',data:null,url:'https://api.imd.fun/'+key,fetchedAt:null});
let memo:{swarm:SourceSample;workers:SourceSample;world:WorldState}|undefined;
/** deriveWorld over swarm + workers only, memoised on the (immutable) gateway samples, so repeated requests in one
 *  isolate pay for it once per upstream read. */
export function liveWorld(swarm:SourceSample,workers:SourceSample):WorldState{
  if(memo&&memo.swarm===swarm&&memo.workers===workers)return memo.world;
  const sources=Object.fromEntries(FEEDS.map(k=>[k,blank(k)])) as Record<FeedKey,SourceSample>;
  const world=deriveWorld({mode:'live',sources:{...sources,swarm,workers}});
  memo={swarm,workers,world};return world;
}
// One statement for the whole roster: the ids travel as one JSON parameter (one D1 query instead of ~430). The newest
// sighting wins; an unknown owner (swarm unavailable) keeps the last known one.
export const UPSERT_PRESENCE=`INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at)
 SELECT value->>'id',value->>'owner',?1,?2 FROM json_each(?3) WHERE true
 ON CONFLICT(token_id) DO UPDATE SET owner=COALESCE(excluded.owner,seat_presence.owner),
 last_online_at=MAX(seat_presence.last_online_at,excluded.last_online_at),updated_at=excluded.updated_at`;
/** indexPruned: stored index answers deleted (null: the prune failed, e.g. a deploy ahead of migrations/0004); lanesPruned:
 *  index-lane rows deleted (null: a deploy ahead of migrations/0005). */
export type PresenceRun={written:number;skipped?:'workers-incomplete';at:number;indexPruned:number|null;lanesPruned:number|null};
/** A challenge never used (expired, superseded, burnt or logged out) is deleted this long after issue (S3; its 5 min
 *  window is long over). A used one, which names its session, stays until a day after its window closed. */
export const UNUSED_CHALLENGE_KEEP_MS=10*60_000;
/** Both prunes are range reads of an index (migrations/0002: login_challenges_issued, sessions_expires), never a table
 *  scan: ?1 = now - DAY_MS, ?2 = now - UNUSED_CHALLENGE_KEEP_MS. The challenge prune reads every challenge issued before
 *  ?2 that is still kept (the used ones of the last day, one per sign-in) and deletes the rest; the session prune reads
 *  only the rows it deletes. */
export const PRUNE_CHALLENGES='DELETE FROM login_challenges WHERE issued_at<?2 AND (used_at IS NULL OR accept_until<?1)';
export const PRUNE_SESSIONS='DELETE FROM sessions WHERE expires_at<?1';
/** A stored NFT-index answer (A-2, server/ownership.ts KEEP_INDEX) is kept 8 days, a day past a session's 7: any index
 *  read since has replaced it, and older ones only name candidates for an owner who has not been back. A scan (?1 = now -
 *  INDEX_KEEP_MS): index_candidates holds only addresses the index names a seat for (a few thousand rows at most, read
 *  96 times a day), and an index on read_at would add a row written to every upsert. Its own statement, after the batch,
 *  so a deploy ahead of migrations/0004 never stops the presence record or the other prunes. */
export const INDEX_KEEP_MS=8*DAY_MS;
export const PRUNE_INDEX='DELETE FROM index_candidates WHERE read_at<?1';
/** N-6 (server/auth.ts INDEX_LANE): an index lane counts for a minute, so its row is deleted once older (?1 = now -
 *  INDEX_LANE_KEEP_MS): a range of index_lanes_at, never a scan; 3 rows written per row deleted (the row and its two
 *  index entries). Its own statement after the batch like PRUNE_INDEX: a deploy ahead of migrations/0005 never stops
 *  the presence record or the other prunes. */
export const INDEX_LANE_KEEP_MS=60_000;
export const PRUNE_INDEX_LANES='DELETE FROM index_lanes WHERE at<?1';
/** Records every seat the roster lists online at the roster's own time (fetchedAt: an edge-cached copy can be up to
 *  5 min old), drops never-used challenges after UNUSED_CHALLENGE_KEEP_MS, used ones a day after their window closed,
 *  sessions that ended more than a day ago, stored index answers older than INDEX_KEEP_MS and index-lane rows older than
 *  INDEX_LANE_KEEP_MS. seat_presence is never deleted. */
export async function recordPresence(gateway:Pick<ReadGateway,'source'>,db:D1Database,now=Date.now(),waitUntil?:WaitUntil):Promise<PresenceRun>{
  const [swarm,workers]=await Promise.all([gateway.source('swarm',waitUntil),gateway.source('workers',waitUntil)]);
  const world=liveWorld(swarm,workers),at=workers.fetchedAt??now;
  const housekeeping=[db.prepare(PRUNE_CHALLENGES).bind(now-DAY_MS,now-UNUSED_CHALLENGE_KEEP_MS),db.prepare(PRUNE_SESSIONS).bind(now-DAY_MS)];
  const pruned=(sql:string,before:number)=>db.prepare(sql).bind(before).run().then(r=>r.meta.changes??0,()=>null);
  const pruneKept=async()=>({indexPruned:await pruned(PRUNE_INDEX,now-INDEX_KEEP_MS),lanesPruned:await pruned(PRUNE_INDEX_LANES,now-INDEX_LANE_KEEP_MS)});
  if(!world.completeWorkers){await db.batch(housekeeping);return {written:0,skipped:'workers-incomplete',at,...await pruneKept()};}
  const online=world.agents.filter(a=>a.presence==='online'&&Number.isSafeInteger(Number(a.tokenId)))
    .map(a=>({id:Number(a.tokenId),owner:swarm.data&&a.owner?a.owner.toLowerCase():null}));
  await db.batch([db.prepare(UPSERT_PRESENCE).bind(at,now,JSON.stringify(online)),...housekeeping]);
  return {written:online.length,at,...await pruneKept()};
}
