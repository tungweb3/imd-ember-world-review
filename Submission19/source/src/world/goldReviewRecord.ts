// The record of the last Swarm audit of World's GOLD purchase and wallet payment code (job f6bd50ad, 2026-10-27 UTC),
// collapsed at the foot of the GOLD panel: what was reviewed, where to read the report and the reviewed source, and each
// finding with the site maintainer's own account of its fix. The sign-in audits stay in "My wallet" (auditRecord.ts).
// Written with createElement (no JSX) so tests/gold-review-record renders this very markup.
import {createElement as h} from 'react';
import {jobUrl} from './links.ts';
import {outLink} from './reviewRecord.ts';

type Text={zh:string;en:string};
const JOB='f6bd50ad-af0b-4191-a0de-0e322c19c667';
export const GOLD_REVIEW={job:JOB,jobUrl:jobUrl(JOB)!,reportUrl:`https://api.imd.fun/jobs/${JOB}/report.md`,
  sourceUrl:'https://github.com/tungweb3/imd-ember-world-review/tree/26fd4b55b07509cecf33196677f222e41eebdf31/Submission18',
  commit:'96858bf',worker:'b08f59ef',snapshot:'26fd4b5',date:'2026-10-27'} as const;
export const GOLD_REVIEW_FINDINGS:readonly {id:string;severity:'Low';title:Text;status:Text}[]=[
  {id:'#1',severity:'Low',title:{zh:'錢包回傳較舊的失敗付款時，防止重複付款的鎖會提早解除',en:'An older reverted payment returned by the wallet released the do-not-pay-again lock early'},
    status:{zh:'此版本已修正：交易編號較舊的付款，只有成功時才算這次的付款；失敗的付款不會解除這個鎖。',
      en:'Fixed in this version: under an older nonce only a successful payment counts as this one; a reverted one keeps the lock.'}},
  {id:'#2',severity:'Low',title:{zh:'開兩個分頁時，一個分頁會刪掉另一個分頁的「入帳中」提示',en:'With two tabs open, one tab could remove the other tab’s crediting note'},
    status:{zh:'此版本已修正：只刪除失敗那筆付款自己的提示。這只影響畫面，GOLD 入帳不受影響。',
      en:'Fixed in this version: only the failed payment’s own note is removed. Display only; crediting itself was never affected.'}},
  {id:'#3',severity:'Low',title:{zh:'部署工具沒有擋下兩個會換掉打包程式的環境變數',en:'The deploy tool did not refuse two variables that replace the bundlers'},
    status:{zh:'此版本已修正：部署時只要設了其中一個，就拒絕上傳。',en:'Fixed in this version: a deploy refuses to upload when either is set.'}}];

export function GoldReviewRecord({zh}:{zh:boolean}){
  const say=(a:string,b:string)=>zh?a:b,r=GOLD_REVIEW,row=(k:string,v:unknown)=>[h('dt',{key:k+'t'},k),h('dd',{key:k+'d'},v as string)];
  return h('details',{className:'audit-record gold-review-record'},
    h('summary',null,say('GOLD 付款審查紀錄','GOLD payment review record')),
    h('dl',null,
      ...row(say('審查範圍','Reviewed scope'),say('GOLD 購買點數、錢包付款與部署工具（僅 World）','GOLD purchases, wallet payments and the deploy tool (World only)')),
      ...row(say('審查版本','Reviewed version'),say(`World 原始碼 ${r.commit}（Worker ${r.worker}，公開快照 ${r.snapshot}）`,`World source ${r.commit} (Worker ${r.worker}, public snapshot ${r.snapshot})`)),
      ...row(say('審查日期','Review date'),say(`${r.date}（UTC）`,`${r.date} (UTC)`)),
      ...row(say('審查任務','Review job'),h('a',outLink(r.jobUrl),r.job.slice(0,8)+'… ↗')),
      ...row(say('報告','Report'),h('a',outLink(r.reportUrl),'report.md ↗')),
      ...row(say('受審查的原始碼','Reviewed source'),h('a',outLink(r.sourceUrl),'Submission18 ↗'))),
    h('p',{className:'small-note'},say('這次審查找到 3 個 Low，沒有 Medium 以上的問題。','This review found 3 Low and nothing of Medium or higher.')),
    h('p',{className:'small-note audit-head'},say('發現（出自審查）· 修正狀態為本站維護者自行說明，修正後的版本尚未重新審查','Findings (from the review) · fix status as reported by the site maintainer; the fixed version was not re-reviewed')),
    h('ul',null,GOLD_REVIEW_FINDINGS.map(f=>h('li',{key:f.id},`${f.id} · ${f.severity} — ${say(f.title.zh,f.title.en)}${say('。','. ')}${say(f.status.zh,f.status.en)}`))));
}
