// Every link from the world into IMD Explorer, and every link from outside back into the world, is built here.
// Explorer's URL scheme is observed (explorer commit 47417580, checked 2026-09-27), not documented, so it lives in this
// one module and tests/links.test.mjs pins it with real ids. Anything that fails validation gets no deep link: callers
// fall back to the Explorer tab for that kind of record, never to a URL built from unchecked data.
export const EXPLORER='https://explorer.imd.fun';
export const WORLD_ORIGIN='https://imdember.com';

const DECIMAL=/^(0|[1-9]\d{0,79})$/;
const ADDRESS=/^0x[0-9a-f]{40}$/i,ZERO_ADDRESS=/^0x0{40}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// <label>.site.identitymd.eth and similar: lowercase DNS-style labels ending in .eth.
const ENS=/^(?=.{5,120}$)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)*\.eth$/;

/** A seat (token) id as the world stores it: a canonical decimal string. Numbers must be safe integers. */
export function seatId(value:unknown):string|null {
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?String(value):null;
  return typeof value==='string'&&DECIMAL.test(value)?value:null;
}
/** A holder wallet, lowercased. The zero address is nobody's wallet. */
export function walletAddress(value:unknown):string|null {
  return typeof value==='string'&&ADDRESS.test(value)&&!ZERO_ADDRESS.test(value)?value.toLowerCase():null;
}
/** An IMD job id (uuid), lowercased. */
export function jobId(value:unknown):string|null {
  return typeof value==='string'&&UUID.test(value)?value.toLowerCase():null;
}
export function ensName(value:unknown):string|null {
  if(typeof value!=='string')return null;
  const v=value.trim().toLowerCase();return ENS.test(v)?v:null;
}

/** Explorer's agent page (not /api/agents/<id>, which is a JSON route). */
export function agentUrl(tokenId:unknown):string|null {const id=seatId(tokenId);return id===null?null:`${EXPLORER}/agents/${id}`;}
export function walletUrl(address:unknown):string|null {const a=walletAddress(address);return a===null?null:`${EXPLORER}/wallet/${a}`;}
/** Jobs, and oracle questions too: Explorer has no /oracle/<id> page; a question is shown on its job's page. */
export function jobUrl(id:unknown):string|null {const j=jobId(id);return j===null?null:`${EXPLORER}/jobs/${j}`;}
/** A published site, through the eth.limo gateway, as Explorer links it. */
export function siteUrl(name:unknown):string|null {const n=ensName(name);return n===null?null:`https://${n}.limo`;}
/** Source repositories and research reports: only https GitHub URLs are passed on. */
export function sourceUrl(value:unknown):string|null {
  if(typeof value!=='string'||value.length>400)return null;
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='github.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}

// Explorer's list tabs and their filters (?show= / ?type=), as its nav reads them.
export const EXPLORER_TABS={
  jobs:{path:'/',param:'show',filters:['live','incomplete','completed']},
  oracle:{path:'/oracle',param:'show',filters:['open','unsigned','signed']},
  published:{path:'/published',param:'type',filters:['contracts','sites','research','media']},
  agents:{path:'/agents',param:'show',filters:['online','working','outdated']}
} as const;
export type ExplorerSection=keyof typeof EXPLORER_TABS;
export type ExplorerFilter<S extends ExplorerSection>=typeof EXPLORER_TABS[S]['filters'][number];
export function explorerTab<S extends ExplorerSection>(section:S,filter?:ExplorerFilter<S>):string {
  const tab=EXPLORER_TABS[section],base=EXPLORER+tab.path;
  return filter&&(tab.filters as readonly string[]).includes(filter)?`${base}?${tab.param}=${filter}`:base;
}
/** The tab chips each district shows, in the order Explorer shows them (All first where Explorer has it). */
export type DistrictTab={label:string;labelZh:string;href:string};
export function districtTabs(district:DistrictId):DistrictTab[] {
  const tab=(label:string,labelZh:string,href:string)=>({label,labelZh,href});
  switch(district){
    case 'jobs':return [tab('All','全部',explorerTab('jobs')),tab('Running','執行中',explorerTab('jobs','live')),tab('Incomplete','未完成',explorerTab('jobs','incomplete')),tab('Completed','已完成',explorerTab('jobs','completed'))];
    case 'oracle':return [tab('All','全部',explorerTab('oracle')),tab('Answering','作答中',explorerTab('oracle','open')),tab('Failed','未簽署',explorerTab('oracle','unsigned')),tab('Signed','已簽署',explorerTab('oracle','signed'))];
    case 'published':return [tab('Contracts','合約',explorerTab('published','contracts')),tab('Sites','網站',explorerTab('published','sites')),tab('Research','研究',explorerTab('published','research')),tab('Media','媒體',explorerTab('published','media'))];
    case 'agents':return [tab('All','全部',explorerTab('agents')),tab('Online','上線',explorerTab('agents','online')),tab('Working','工作中',explorerTab('agents','working')),tab('Outdated','版本過舊',explorerTab('agents','outdated'))];
  }
}
/** Where a feed of each record kind lives on Explorer (the feed's "open the source" link). */
export function feedUrl(kind:'job'|'oracle'|'publication'|'launch'):string {
  return kind==='job'?explorerTab('jobs'):kind==='oracle'?explorerTab('oracle'):kind==='launch'?explorerTab('published','contracts'):explorerTab('published');
}

// ─── Links back into the world: ?seat= / ?wallet= / ?job= / ?district= ──────────────────────────────────────
/** Must equal the ids of DISTRICTS in layout.ts (tests/links.test.mjs checks); kept here so this module stays leaf-level. */
export const DISTRICT_IDS=['jobs','oracle','published','agents'] as const;
export type DistrictId=typeof DISTRICT_IDS[number];
export type WorldTarget={kind:'seat';id:string}|{kind:'wallet';address:string}|{kind:'job';id:string}|{kind:'district';id:DistrictId};
/** The first valid target in a query string (seat, then wallet, job, district). Values are validated strictly:
 *  a decimal seat id without leading zeros, 0x plus 40 hex digits, a uuid, a known district. Anything else is ignored. */
export function parseWorldLink(search:string):WorldTarget|null {
  let q:URLSearchParams;try{q=new URLSearchParams(search);}catch{return null;}
  const seat=seatId(q.get('seat')??undefined);if(seat!==null)return {kind:'seat',id:seat};
  const wallet=walletAddress(q.get('wallet')??undefined);if(wallet!==null)return {kind:'wallet',address:wallet};
  const job=jobId(q.get('job')??undefined);if(job!==null)return {kind:'job',id:job};
  const district=q.get('district');if(district&&(DISTRICT_IDS as readonly string[]).includes(district))return {kind:'district',id:district as DistrictId};
  return null;
}
/** A shareable world URL for a target (the reverse of parseWorldLink). */
export function worldLink(target:WorldTarget,origin=WORLD_ORIGIN):string {
  const u=new URL('/',origin);
  u.searchParams.set(target.kind,target.kind==='wallet'?target.address:target.id);
  return u.href;
}

// ─── Wallet display, the way imd.fun shows it ─────────────────────────────────────────────────────────────────
/** 0x1234…abcd */
export function shortWallet(address:unknown):string|null {const a=walletAddress(address);return a===null?null:a.slice(0,6)+'…'+a.slice(-4);}
/** The ENS name when the data already provides one (plain text, never resolved here), else the short address. */
export function walletLabel(address:unknown,name?:unknown):string|null {
  if(walletAddress(address)===null)return null;
  return ensName(name)??shortWallet(address);
}
