// Status truth: IMD's raw states, read the way Explorer groups them. Vocabulary seen in live data and IMD's API docs on
// 2026-09-27 (docs/imd-linkage/linkage_research_and_plan_v001.json):
//   jobs    state:  executing | completed | blocked | cancelled   (workflow stages: contracts, deployment, frontend,
//                   publishing, validating, completed, superseded, blocked, cancelled)
//   oracle  status: assessing | reproducing | attested | disagreed | blocked | mismatch | refused | failed
//   launches / publication contracts: live | parked
// Unknown values map to 'unknown' so a new upstream state can never light the world up by accident.
export type JobPhase='running'|'queued'|'blocked'|'done'|'cancelled'|'failed'|'unknown';
export type OraclePhase='answering'|'signed'|'split'|'failed'|'unknown';
export type PublishPhase='live'|'parked'|'site'|'research'|'media'|'published'|'unknown';
export type RecordPhase=JobPhase|OraclePhase|PublishPhase;

const RUNNING=/^(executing|running|working|building|integrating|reviewing|publishing|deploying|validating|contracts|deployment|frontend|in[_-]?progress|active)$/;
const QUEUED=/^(queued|pending|open|posted|waiting)$/;
const DONE=/^(completed|complete|done|succeeded|success)$/;
const CANCELLED=/^(cancelled|canceled|superseded)$/;
const FAILED=/^(failed|error|errored)$/;
const low=(v:unknown)=>typeof v==='string'?v.trim().toLowerCase():'';

/** Explorer's Jobs tabs: Running = executing (and in-flight workflow stages); Incomplete = blocked/failed/cancelled. */
export function jobPhase(state:unknown):JobPhase {
  const s=low(state);
  return RUNNING.test(s)?'running':QUEUED.test(s)?'queued':s==='blocked'?'blocked':DONE.test(s)?'done':CANCELLED.test(s)?'cancelled':FAILED.test(s)?'failed':'unknown';
}
/** Explorer's Oracle tabs: Answering (assessing, reproducing), Signed (attested with a signature), Failed (the rest).
 *  'disagreed' is its own phase, shown as 分歧 / Split: the panel answered but did not reach its quorum. An 'attested'
 *  row without signer and attestedAt is not treated as signed. */
export function oraclePhase(status:unknown,signed:boolean):OraclePhase {
  const s=low(status);
  if(s==='attested')return signed?'signed':'unknown';
  if(s==='disagreed')return 'split';
  if(/^(assessing|reproducing|answering|asking|pending|open|collecting)$/.test(s))return 'answering';
  if(/^(blocked|mismatch|refused|failed|expired|error)$/.test(s))return 'failed';
  return 'unknown';
}
/** A launch or published contract: live or parked. */
export function launchPhase(status:unknown):PublishPhase {
  const s=low(status);return s==='live'?'live':s==='parked'?'parked':'unknown';
}
/** A publication has no status of its own: derive it from its contracts (live / parked) and its types. */
export function publicationPhase(row:{types?:unknown;contracts?:unknown}):PublishPhase {
  const contracts=Array.isArray(row.contracts)?row.contracts.map(c=>launchPhase((c as {status?:unknown})?.status)):[];
  if(contracts.includes('live'))return 'live';
  if(contracts.length&&contracts.every(c=>c==='parked'))return 'parked';
  const types=Array.isArray(row.types)?row.types.map(low):[];
  return types.includes('sites')?'site':types.includes('research')?'research':types.includes('media')?'media':types.includes('contracts')?'published':types.length?'published':'unknown';
}

/** A workflow's stage job (its contract, frontend, … stage). Explorer has no page for one (/jobs/<id> is "Not found")
 *  and its Jobs tab lists the parent workflow instead. IMD marks them only in the text it hands the agent: the
 *  objective (and, for a launch publication, the title) opens with "WORKFLOW <STAGE> STAGE CONTEXT:" (observed on
 *  2026-09-27 in /jobs, /publications and swarm events; tests/fixtures/*-0928z.json). */
export const STAGE_TEXT=/^WORKFLOW [A-Z][A-Z ]* STAGE CONTEXT:/;
export function stageText(value:unknown):boolean {return typeof value==='string'&&STAGE_TEXT.test(value.trimStart());}

export const PHASE_LABELS:Record<RecordPhase,{zh:string;en:string}>={
  running:{zh:'執行中',en:'Running'},queued:{zh:'排隊中',en:'Queued'},blocked:{zh:'卡住',en:'Blocked'},done:{zh:'完成',en:'Done'},
  cancelled:{zh:'已取消',en:'Cancelled'},failed:{zh:'未成功',en:'Failed'},answering:{zh:'作答中',en:'Answering'},
  signed:{zh:'已簽署',en:'Signed'},split:{zh:'分歧',en:'Split'},live:{zh:'上線',en:'Live'},parked:{zh:'暫停',en:'Parked'},
  site:{zh:'網站',en:'Site'},research:{zh:'研究',en:'Research'},media:{zh:'媒體',en:'Media'},published:{zh:'已發表',en:'Published'},
  unknown:{zh:'狀態未知',en:'Unknown'}
};
