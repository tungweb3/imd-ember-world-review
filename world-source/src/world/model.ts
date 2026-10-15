import {jobId as uuid,jobUrl,siteUrl,sourceUrl,explorerTab,feedUrl} from './links.ts';
import {jobPhase,oraclePhase,launchPhase,publicationPhase,stageText,type RecordPhase} from './status.ts';
export type DataMode = 'live' | 'mock';
export type SourceState = 'fresh' | 'stale' | 'unavailable';
export type SourceSample = { state: SourceState; data: unknown; url: string; fetchedAt: number | null; retryAt?: number; error?: string };
export type FeedKey = 'swarm' | 'workers' | 'jobs' | 'oracle' | 'publications' | 'launches';
/** Sources a snapshot may carry. A snapshot without them is still valid (bridge.ts checks only the FeedKeys). */
export type OptionalFeedKey = 'activity';
export type Sources = Record<FeedKey, SourceSample> & Partial<Record<OptionalFeedKey, SourceSample>>;
export type Snapshot = { mode: DataMode; sources: Sources };
export type Presence = 'online' | 'offline' | 'unknown';
export type Agent = {
  tokenId: string; agentId: string | null; owner: string | null; presence: Presence;
  working: boolean | null; runtimes: string[]; models: string[]; version: string | null;
  devices: number; attempts: number | null; accepted: number | null; failed: number | null;
  pending: number | null; lastActivity: string | null; heartbeat: string | null;
  /** The swarm summary's seats[id].working (fresh swarm only). Presence stays with /workers; this may only mark an
   *  agent the roster lists online as working (the minimap's amber dot). */
  seatWorking: boolean | null;
};
export type RecordKind = 'job' | 'oracle' | 'publication' | 'launch';
/** One row of a feed. `href` is always an Explorer URL: the record's own page when its id is valid, else its tab.
 *  `status` is the raw upstream value (derived from contracts/types for publications); `phase` is the normalised one. */
export type RecordItem = {
  kind: RecordKind; id: string; title: string; status: string; phase: RecordPhase; time: string | null; href: string;
  jobId: string | null; chainId?: number | null; signed?: boolean; template?: string | null; types?: string[];
  siteUrl?: string | null; sourceUrl?: string | null; launchNumber?: number | null;
  /** A published workflow's stage jobs (its sites' and research reports' jobIds): they have no Explorer page of their
   *  own, so the recent-activity digest links their events to this workflow's page (happenings.ts). */
  stageJobs?: string[];
};
/** explorer.imd.fun/api/activity: Explorer's footer counts and 24 hourly accepted-step buckets (newest last). */
export type ActivitySummary = { at: number | null; working: number | null; jobs: number | null; oracle: number | null;
  workflows: number | null; total: number | null; steps: number[]; state: SourceState; fetchedAt: number | null };
/** One (swarm.at, counts.inferenceTokens) reading, for workload rates across reads. */
export type InferenceSample = { at: number; tokens: number };
export type WorldState = {
  mode: DataMode; agents: Agent[]; sources: Snapshot['sources']; reportedOnline: number | null;
  reportedWorking: number | null; enumeratedOnline: number; connectedDevices: number;
  unseatedDevices: number; invalidWorkers: number; completeWorkers: boolean;
  jobs: RecordItem[]; oracle: RecordItem[]; publications: RecordItem[]; launches: RecordItem[];
  accepted24h: number | null; oracle24h: number | null; liveLaunches: number | null; sites: number | null;
  /** Explorer activity (optional source); null when the snapshot has none. */
  activity: ActivitySummary | null;
  /** The last two distinct fresh inference readings of this mode, oldest first (see metrics.ts tokenRate). */
  inference: InferenceSample[];
  /** Workflow stage jobs among the latest /jobs rows (the gateway lists them; status.ts stageText): no Explorer page. */
  stageJobs: string[];
};
export function emptyWorld(mode:DataMode):WorldState {
  const sources=Object.fromEntries((['swarm','workers','jobs','oracle','publications','launches'] as FeedKey[]).map(key=>[key,{state:'unavailable',data:null,url:'https://api.imd.fun/'+key,fetchedAt:null}])) as Snapshot['sources'];
  return deriveWorld({mode,sources});
}

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function decimalId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value) && value.length <= 80) return BigInt(value).toString();
  return null;
}
export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
function string(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function compareIds(a: string, b: string) { return a.length - b.length || a.localeCompare(b); }
function blank(tokenId: string): Agent {
  return { tokenId, agentId:null, owner:null, presence:'unknown', working:null, runtimes:[],models:[],version:null,devices:0,attempts:null,accepted:null,failed:null,pending:null,lastActivity:null,heartbeat:null,seatWorking:null };
}
const FEED_FIELD: Record<RecordKind, string> = { job:'jobs', oracle:'requests', publication:'items', launch:'launches' };
function record(kind: RecordKind, x: Record<string, unknown>): RecordItem {
  const id = string(x.id) ?? '', title = string(x.question ?? x.objective ?? x.title) ?? `#${x.launchNumber ?? x.id ?? '—'}`;
  const time = string(x.publishedAt ?? x.updatedAt ?? x.createdAt), chainId = number(x.chainId);
  if (kind === 'job') {
    const j = uuid(id);
    return { kind, id, title, status:string(x.state ?? x.status) ?? 'unknown', phase:jobPhase(x.state ?? x.status), time,
      href:jobUrl(j) ?? feedUrl(kind), jobId:j, chainId, template:string(x.template) };
  }
  if (kind === 'oracle') {
    const signed = x.status === 'attested' && !!x.signer && !!x.attestedAt, j = uuid(x.jobId);
    return { kind, id, title, status:string(x.status ?? x.state) ?? 'unknown', phase:oraclePhase(x.status ?? x.state, signed), time,
      href:jobUrl(j) ?? feedUrl(kind), jobId:j, chainId, signed };
  }
  if (kind === 'launch') {
    return { kind, id, title, status:string(x.status) ?? 'unknown', phase:launchPhase(x.status), time, href:feedUrl(kind), jobId:null,
      chainId, sourceUrl:sourceUrl(x.sourceRepoUrl), launchNumber:number(x.launchNumber) };
  }
  // Publications, linked the way Explorer's Published tab links them: 'job:<uuid>' opens that job ('#deployed' when it
  // carries contracts); 'workflow:<uuid>' opens the workflow (its sites' and research's jobIds are stage jobs, which have
  // no page: /jobs/<stage> is "Not found"); 'launch:<uuid>' opens a job the API does not name, so it opens the
  // Published tab for its type. A launch's title can be IMD's stage prompt: its token's name stands in, as on Explorer.
  const types = array(x.types).map(string).filter((v): v is string => v !== null);
  const contracts = array(x.contracts).map(object), sites = array(x.sites).map(object), research = array(x.research).map(object);
  const own = id.startsWith('job:') ? uuid(id.slice(4)) : null, workflow = id.startsWith('workflow:') ? uuid(id.slice(9)) : null;
  const type = (['contracts','sites','research','media'] as const).find(t => types.includes(t));
  const phase = publicationPhase({types, contracts});
  const href = own ? jobUrl(own)! + (contracts.length ? '#deployed' : '') : workflow ? jobUrl(workflow)! : type ? explorerTab('published', type) : feedUrl(kind);
  const token = contracts.flatMap(c => array(c.artifacts).map(object)).find(a => a.role === 'token'), launchNumber = number(contracts[0]?.launchNumber);
  const shown = stageText(title) ? string(token?.name) ?? (launchNumber !== null ? `#${launchNumber}` : title) : title;
  return { kind, id, title:shown, status:string(x.status) ?? phase, phase, time, href, jobId:own ?? workflow, chainId:chainId ?? number(contracts[0]?.chainId), types,
    siteUrl:sites.map(r => siteUrl(r.ensName)).find(v => v !== null) ?? null,
    sourceUrl:[...research.map(r => r.repoUrl), ...contracts.map(r => r.sourceRepoUrl), ...sites.map(r => r.repoUrl)].map(sourceUrl).find(v => v !== null) ?? null,
    launchNumber, stageJobs:workflow ? [...sites, ...research].map(r => uuid(r.jobId)).filter((v): v is string => v !== null) : [] };
}
/** A feed's rows. Demo records (mock mode) have made-up ids, so their rows open the Explorer tab, never a record page. */
function items(source: SourceSample, kind: RecordKind, mode: DataMode): RecordItem[] {
  const rows = array(object(source.data)[FEED_FIELD[kind]]).map(row => record(kind, object(row))).filter(x => x.id);
  return mode === 'mock' ? rows.map(r => ({ ...r, href:feedUrl(kind), siteUrl:null, sourceUrl:null })) : rows;
}
function activitySummary(sample: SourceSample | undefined): ActivitySummary | null {
  if (!sample) return null;
  const x = object(sample.data), steps = array(x.steps).map(number);
  return { at:number(x.at), working:number(x.working), jobs:number(x.jobs), oracle:number(x.oracle), workflows:number(x.workflows), total:number(x.total),
    steps:steps.every(v => v !== null) ? steps as number[] : [], state:sample.state, fetchedAt:sample.fetchedAt };
}
/** Keeps the previous reading and appends a fresh one with a later swarm.at (a re-read of the same cached sample adds nothing). */
function inferenceHistory(previous: InferenceSample[], sample: SourceSample, swarm: Record<string, unknown>, counts: Record<string, unknown>): InferenceSample[] {
  const at = number(swarm.at), tokens = number(counts.inferenceTokens);
  if (sample.state !== 'fresh' || at === null || tokens === null || object(swarm.health).reachable === false) return previous;
  const last = previous.at(-1);
  if (last && at <= last.at) return previous;
  return [...previous.slice(-1), { at, tokens }];
}

// The worker list is the presence source. Historical seat statistics and owners cannot prove presence.
export function deriveWorld(snapshot: Snapshot, previous?: WorldState): WorldState {
  const sources = snapshot.sources, swarm = object(sources.swarm.data), health = object(swarm.health), counts = object(swarm.counts);
  const registry = new Map<string, Agent>();
  if (previous?.mode === snapshot.mode) for (const agent of previous.agents) registry.set(agent.tokenId, { ...agent, runtimes:[...agent.runtimes], models:[...agent.models], seatWorking:null });
  const ensure = (id: string) => { if (!registry.has(id)) registry.set(id,blank(id)); return registry.get(id)!; };
  for (const [key, value] of Object.entries(object(swarm.seats))) {
    const row = object(value), id = decimalId(row.tokenId ?? key);
    if (id === null) continue;
    const agent = ensure(id);
    agent.agentId = decimalId(row.agentId) ?? agent.agentId;
    for (const field of ['attempts','accepted','failed','pending'] as const) agent[field] = number(row[field]);
    agent.lastActivity = string(row.last);
    agent.seatWorking = sources.swarm.state === 'fresh' && typeof row.working === 'boolean' ? row.working : null;
  }
  const owners = array(swarm.owners);
  for (const agent of registry.values()) {
    const index = BigInt(agent.tokenId);
    if (index < BigInt(owners.length)) {
      const owner = string(owners[Number(index)]);
      if (owner && /^0x[\da-f]{40}$/i.test(owner) && !/^0x0{40}$/i.test(owner)) agent.owner = owner;
    }
  }
  const workersData = object(sources.workers.data), workerRows = array(workersData.workers);
  let invalidWorkers = 0, unseatedDevices = 0;
  const seen = new Set<string>();
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const value of workerRows) {
    const row = object(value), seat = object(row.seat), id = decimalId(seat.tokenId);
    if (Object.keys(row).length === 0) { invalidWorkers++; continue; }
    if (id === null) { unseatedDevices++; continue; }
    seen.add(id); ensure(id);
    if (!grouped.has(id)) grouped.set(id,[]); grouped.get(id)!.push(row);
  }
  const completeWorkers = sources.workers.state === 'fresh' && Array.isArray(workersData.workers) && invalidWorkers === 0 &&
    (number(workersData.count) === null || workersData.count === workerRows.length);
  for (const agent of registry.values()) {
    const rows = grouped.get(agent.tokenId);
    if (rows) {
      agent.presence = sources.workers.state === 'fresh' ? 'online' : 'unknown';
      agent.devices = rows.length;
      agent.agentId = decimalId(object(rows[0].seat).agentId) ?? agent.agentId;
      agent.working = sources.workers.state === 'fresh' ? rows.some(row => typeof row.working === 'number' ? row.working > 0 : row.working === true) : null;
      agent.version = string(rows[0].daemonVersion);
      const runtimes = rows.flatMap(row=>array(row.runtimes).map(object));
      agent.runtimes = [...new Set(runtimes.map(row=>string(row.id)).filter((v):v is string=>v!==null))];
      agent.models = [...new Set(runtimes.map(row=>string(object(row.premiumModel).model)).filter((v):v is string=>v!==null))];
      agent.heartbeat = rows.map(row=>string(row.lastHeartbeatAt)).filter((v):v is string=>!!v).sort().at(-1) ?? null;
    } else {
      agent.presence = completeWorkers ? 'offline' : 'unknown';
      agent.working = completeWorkers ? false : null; agent.devices = 0;
    }
    const idx=BigInt(agent.tokenId),owner=idx<BigInt(owners.length)?string(owners[Number(idx)]):null;
    if (!agent.owner && owner && /^0x[\da-f]{40}$/i.test(owner) && !/^0x0{40}$/i.test(owner)) agent.owner=owner;
  }
  return {mode:snapshot.mode,agents:[...registry.values()].sort((a,b)=>compareIds(a.tokenId,b.tokenId)),sources,
    reportedOnline:sources.swarm.state==='fresh'&&health.reachable!==false?number(health.agentsOnline):null,
    reportedWorking:sources.swarm.state==='fresh'&&health.reachable!==false?number(health.workingNow):null,
    enumeratedOnline:sources.workers.state==='fresh'?seen.size:0, connectedDevices:workerRows.length,
    unseatedDevices,invalidWorkers,completeWorkers,
    jobs:items(sources.jobs,'job',snapshot.mode),oracle:items(sources.oracle,'oracle',snapshot.mode),publications:items(sources.publications,'publication',snapshot.mode),launches:items(sources.launches,'launch',snapshot.mode),
    stageJobs:array(object(sources.jobs.data).stages).map(uuid).filter((v): v is string => v !== null),
    accepted24h:health.reachable===false?null:number(health.acceptedLastDay),oracle24h:health.reachable===false?null:number(health.oraclesDoneLastDay),liveLaunches:number(counts.launchesLive),sites:number(counts.sites),
    activity:activitySummary(sources.activity),
    inference:inferenceHistory(previous?.mode === snapshot.mode ? previous.inference ?? [] : [], sources.swarm, swarm, counts)};
}

/** Working as the world shows it (minimap and map amber dots, hillside signals, the registry's Working filter): an agent
 *  the roster lists online that the roster or the fresh swarm summary (seats[id].working) says is working. Presence
 *  stays with /workers; the swarm can only promote an online agent to working, never bring one online. */
export function isWorking(a: Agent): boolean { return a.presence==='online' && (a.working===true || a.seatWorking===true); }
export function searchAgents(agents: Agent[], query: string, filter: 'all'|'online'|'working') {
  const q=query.trim().toLowerCase().replace(/^#/, '');
  return agents.filter(a => (filter==='all' || filter==='online'&&a.presence==='online' || filter==='working'&&isWorking(a)) &&
    (!q || [a.tokenId,a.agentId,a.owner,...a.runtimes,...a.models].some(v=>v?.toLowerCase().includes(q))));
}
export function exactAgent(agents: Agent[], query: string) {
  const q=query.trim().replace(/^#/, '');
  return agents.find(a=>a.tokenId===q) ?? agents.find(a=>a.agentId===q);
}
