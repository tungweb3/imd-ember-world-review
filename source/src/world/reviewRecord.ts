// The Swarm Audit Record (remediation 2026-09-29 §6): the public record of the review of World's wallet sign-in and home
// authorization (IMD Swarm job 4bd31cfb, Worker version beac62be, 2026-09-28 UTC), shown collapsed in "My wallet" before
// and after sign-in. One data module for the page and docs/security/AUDIT_REMEDIATION_STATUS.md (tests/review-record
// checks the doc against it). It says what was reviewed and what changed since; it is a record of that version only, so
// no badge and none of the words the remediation forbids (tests/review-record lists them).
// When a later version is reviewed, add its record here and keep this one, labelled by its version.
import {jobUrl} from './links.ts';

type Say=(zh:string,en:string)=>string;
type Text={zh:string;en:string};
export type Finding={id:string;severity:'Medium'|'Low'|'Low/Info'|'Info';area:Text|null;title:Text;status:Text};

const JOB='4bd31cfb-1151-497f-9b27-40e668dea372';
/** `commit` is the source the reviewers rebuilt; `worker` the Cloudflare version id the team gave them; `bundle` the
 *  SHA-256 of that Worker bundle, which they reproduced. `match`: the review's deployment-match verdict. */
export const REVIEW_RECORD={job:JOB,commit:'0def8cb',worker:'beac62be',bundle:'4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3',
  date:'2026-09-28',match:'partial',
  /** A Swarm re-review of a later version: none yet. Set only from an actual re-review job. */
  rereview:null as null|{job:string;version:string},
  scope:{zh:'錢包登入與我家權限（僅 World）',en:'Wallet sign-in & home authorization (World-only)'},
  jobUrl:jobUrl(JOB)!,
  reportUrl:`https://github.com/Identity-md/research/blob/main/jobs/${JOB}/files/artifacts/report.md`} as const;

/** Every finding of the report, its severity as the report gives it, and one honest line on where it stands in this
 *  version ('open' where it is open). The statuses are the IMD team's own account, not the reviewers' (the page says so). */
export const FINDINGS:readonly Finding[]=[
  {id:'F-1',severity:'Medium',area:{zh:'共用邊界',en:'shared boundary'},title:{zh:'登入訊息可被轉送（釣魚）',en:'Sign-in message can be relayed (phishing)'},
    status:{zh:'部分緩解：本頁會在簽名前檢查訊息並顯示摘要；但釣魚網站可以略過本頁的檢查——只在網址列是 imdember.com 時簽名；若錢包顯示請求來自其他網站或出現不符警告，請拒絕。',
      en:'Partly mitigated: this page checks the message before you sign and shows what you sign, but a phishing site can skip page checks — sign only when the address bar shows imdember.com; if your wallet says the request comes from another site or warns of a mismatch, reject.'}},
  {id:'F-2',severity:'Low/Info',area:null,title:{zh:'接受任何簽名的智慧合約錢包',en:'Smart-contract wallets that accept any signature'},
    status:{zh:'部分處理：登入會記錄錢包類型與驗證方式，驗證無法進行時一律拒絕；合約本身的規則仍決定誰能代表它簽名（未解決）。',en:'Partly addressed: sessions record the wallet type and check method, and an unavailable check always refuses; the contract’s own rules still decide who signs for it (open).'}},
  {id:'F-3',severity:'Low',area:{zh:'可用性',en:'availability'},title:{zh:'垃圾簽名可暫時佔滿智慧錢包驗證額度',en:'Junk signatures can use up smart-wallet checks'},
    status:{zh:'已改善：依網段、合約地址分配額度，並先確認地址有無合約程式碼；仍有殘餘風險：多個網段在垃圾請求持續期間，可讓某據點的首次智慧錢包登入保持忙碌（未完全解決）。',en:'Improved: shares per network and per contract, and a code check before the smart-wallet budget; residual: many networks can still keep first-time smart-wallet sign-in busy at one location while the junk continues (partly open).'}},
  {id:'F-4',severity:'Low',area:null,title:{zh:'只能登出目前的瀏覽器',en:'Log-out ended only this browser'},
    status:{zh:'已修正：新增「登出所有裝置」。',en:'Fixed: “Log out all devices”.'}},
  {id:'F-5',severity:'Low',area:{zh:'可用性',en:'availability'},title:{zh:'約 20 個網段可關閉全站登入',en:'About 20 networks can close sign-in site-wide'},
    status:{zh:'已改善：分層限流，取得與驗證分開計算，同一錢包有冷卻；全站上限保留，只作緊急煞車。仍存在：約 20 個網段持續以滿額發送時，仍可暫停全站新登入（瀏覽不受影響；未完全解決）。',
      en:'Improved: layered limits, challenge and verify counted apart, a per-wallet cooldown; the site-wide ceiling stays as an emergency brake. Still: about 20 /24s at full rate can close new sign-ins site-wide while they keep going; browsing is unaffected (partly open).'}},
  {id:'F-6',severity:'Info',area:null,title:{zh:'建置用套件的已知漏洞',en:'Known advisories in build tools'},
    status:{zh:'已修正：建置工具已更新，npm audit 為 0。',en:'Fixed: build tools updated; npm audit reports 0.'}},
  {id:'F-7',severity:'Info',area:null,title:{zh:'其他觀察（a–e）',en:'Other observations (a–e)'},
    status:{zh:'(a) 已修正（簽名前檢查訊息）；(b)–(e) 維持現狀，列為已知。',en:'(a) fixed (the message is checked before signing); (b)–(e) unchanged, accepted as known.'}},
  {id:'F-8',severity:'Info',area:{zh:'共用邊界',en:'shared boundary'},title:{zh:'同一網域共用標頭、cookie 與錢包授權',en:'One origin shares headers, cookies and wallet access'},
    status:{zh:'未解決：World 本輪沒有改動；日後同網域的頁面會與 World 共用這些設定，需各自審查。',en:'Open: nothing changed in World; later pages on this origin share these with World and need their own review.'}}
];

/** This build changed sign-in after the reviewed version, so the record is labelled as a previous review. */
export const REVIEW_CHANGED=true;
export const recordLabels=(say:Say)=>({
  title:say('審查紀錄','Swarm Audit Record'),
  changed:say('先前的審查 — 目前版本已變更','Previous review — current version has changed'),
  scope:say('審查範圍','Reviewed scope'),version:say('審查版本','Reviewed version'),date:say('審查日期','Review date'),
  match:say('部署對照','Deployment match'),job:say('審查任務','Review job'),report:say('報告','Report'),rereview:say('重新審查','Re-review'),
  findings:say('發現（出自審查）· 修正狀態為 IMD 團隊自行說明，尚未重新審查','Findings (from the review) · fix status as reported by the IMD team, not re-reviewed'),
  only:say('此紀錄只適用於受審查的版本。','This record applies to the reviewed version only.')});
export const versionText=(say:Say)=>{const r=REVIEW_RECORD,b=r.bundle.slice(0,8);return say(`Worker ${r.worker}（原始碼 ${r.commit}，bundle ${b}…）`,`Worker ${r.worker} (source ${r.commit}, bundle ${b}…)`);};
export const matchText=(say:Say)=>say(REVIEW_RECORD.match==='partial'?'partial（部分驗證）':REVIEW_RECORD.match,REVIEW_RECORD.match);
export const rereviewText=(say:Say)=>REVIEW_RECORD.rereview?`${REVIEW_RECORD.rereview.version} (${REVIEW_RECORD.rereview.job.slice(0,8)}…)`:say('尚未進行','none yet');
export const dateText=(say:Say)=>say(`${REVIEW_RECORD.date}（UTC）`,`${REVIEW_RECORD.date} (UTC)`);
export const findingLine=(f:Finding,say:Say)=>`${f.id} · ${f.severity}${f.area?say('（'+f.area.zh+'）',' ('+f.area.en+')'):''} — ${say(f.title.zh,f.title.en)}${say('。','. ')}${say(f.status.zh,f.status.en)}`;
/** The anchors' attributes: a new tab, sending no referrer and no window.opener. */
export const outLink=(href:string)=>({href,target:'_blank',rel:'noreferrer noopener'}) as const;
