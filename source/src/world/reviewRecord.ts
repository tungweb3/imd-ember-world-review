// The Swarm Audit Record (remediation 2026-09-29 §6): the public record of the review of World's wallet sign-in and home
// authorization (IMD Swarm job 4bd31cfb, Worker version beac62be, 2026-09-28 UTC) and of the two re-reviews of a later
// version (Worker 50c688c9, 2026-09-29 UTC), shown collapsed in "My wallet" before and after sign-in. One data module for
// the page and docs/security/AUDIT_REMEDIATION_STATUS.md (tests/review-record checks the doc against it). It says what was
// reviewed and what changed since; each record is of its version only, so no badge and none of the words the
// remediation forbids (tests/review-record lists them).
// When a later version is reviewed, add its record here and keep these, labelled by their versions.
import {jobUrl} from './links.ts';

type Say=(zh:string,en:string)=>string;
type Text={zh:string;en:string};
export type Finding={id:string;severity:'Medium'|'Low'|'Low/Info'|'Info';area:Text|null;title:Text;status:Text};

const JOB='4bd31cfb-1151-497f-9b27-40e668dea372',RETEST='e48d0a96-d3a5-42bb-859f-e0b0707fd9ad',AUDIT='519db624-a82f-4dfe-91b9-1a519d1d3dd1';
const reportOf=(job:string)=>`https://github.com/Identity-md/research/blob/main/jobs/${job}/files/artifacts/report.md`;
const AVAILABILITY={zh:'可用性',en:'availability'};

/** The version both re-reviews examined: the Worker the team named, its source, the public snapshot of that source the
 *  reviewers read, and the SHA-256 of the Worker bundle as the Report rebuilt it from that snapshot (the audit did not
 *  rebuild it). Not this version: REVIEW_CHANGED says so, and so does the page. */
export const REREVIEWED={worker:'50c688c9',commit:'2da46cd',snapshot:'b6e986b',bundle:'14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4',date:'2026-09-29'} as const;
/** A Swarm re-review of REREVIEWED: its job (template Report or Audit), its report file if one was published, its
 *  deployment-match verdict (null: it did not assess one), and its own new findings with their severities as it gives
 *  them; each status is the site maintainer's account of this version. Only from actual re-review jobs. */
export type Rereview={job:string;kind:'Report'|'Audit';jobUrl:string;reportUrl:string|null;match:'partial'|null;findings:readonly Finding[]};
export const REREVIEWS:readonly Rereview[]=[
  {job:RETEST,kind:'Report',jobUrl:jobUrl(RETEST)!,reportUrl:reportOf(RETEST),match:'partial',findings:[
    {id:'W-1',severity:'Info',area:null,title:{zh:'過期的登入仍被當成屋主，可在本機搬家',en:'An expired session still counted as owner for a local move'},
      status:{zh:'此版本已修正：屋主模式、搬家與進門都用本機時鐘比對登入到期時間。仍存在：在別處按「登出所有裝置」，這個頁面要到下一次讀取才會知道。',
        en:'Fixed in this version: owner mode, the move and the Enter press compare the session’s expiry with this device’s clock. Still: a “Log out all devices” elsewhere reaches this page on its next read.'}},
    {id:'W-2',severity:'Info',area:null,title:{zh:'拒絕紀錄被說成「不含 IP」',en:'The refusal logs were described as having “no IP”'},
      status:{zh:'此版本已修正（說法）：紀錄含由 IP 推出的網段鍵（IPv4 /24、IPv6 /48），surge 行另含地址前 6 個字元；紀錄內容沒有改變。',
        en:'Fixed in this version (wording): the logs carry a network key derived from the IP (IPv4 /24, IPv6 /48) and, on surge lines, a 6-character address prefix; the logs are unchanged.'}},
    {id:'W-3',severity:'Info',area:null,title:{zh:'智慧錢包查核時節點出錯，被當成簽名錯誤',en:'A node error on a smart wallet’s check was reported as a bad signature'},
      status:{zh:'此版本已修正：節點失敗回 503（暫時無法查核）；只有 revert、合約造成的 EVM 中止或回傳值不對才算簽名錯誤（401）。兩種情況 challenge 都作廢，不產生 session。',
        en:'Fixed in this version: a node failure is 503 (can’t check now); only a revert, an EVM halt the contract causes or a wrong answer is a bad signature (401). Either way the challenge is burnt and no session is made.'}}]},
  {job:AUDIT,kind:'Audit',jobUrl:jobUrl(AUDIT)!,reportUrl:null,match:null,findings:[
    {id:'A-1',severity:'Medium',area:AVAILABILITY,title:{zh:'每分鐘兩次垃圾驗證可讓指定的智慧錢包無法登入',en:'Two junk checks a minute could keep a chosen smart wallet from signing in'},
      status:{zh:'此版本已改善：少數其他網段的垃圾請求不再能擋住智慧錢包——某錢包每分鐘 2 次共用查核用完後，只要該據點每分鐘 20 次這類查核還沒用完，每個網段每分鐘仍各有 1 次。仍存在：同一個 /24（或 /48）裡的垃圾請求仍可擋住它；在同一據點每分鐘至少 9 個 /24 打 3 個以上地址時也可以（未完全解決）。',
        en:'Improved in this version: junk from a few other networks no longer holds a smart wallet — once its 2 shared checks a minute are spent, each network still gets one check of it a minute while the location’s 20 such checks a minute last. Still: junk from the wallet’s own /24 (or /48) can hold it, and so can at least 9 /24s aimed at 3 or more addresses every minute at one location (partly open).'}},
    {id:'A-2',severity:'Low',area:AVAILABILITY,title:{zh:'索引查詢被拒時刪掉已存的席位清單，剛買的席位因此從家裡消失',en:'A refused index read dropped the stored seat list, so a newly bought seat left the house'},
      status:{zh:'此版本已修正：索引查詢被拒或失敗時，改用上一次的索引答案；這份答案現在存在資料庫裡，每個伺服器執行個體都讀得到，並再用 ownerOf 確認這些席位。仍存在：IMD 名冊與索引都還沒列出的新買席位，要等之後的查詢才會出現；答案保留 8 天。',
        en:'Fixed in this version: a refused or failed index read falls back to the last index answer, now kept in the database so every server instance has it, and ownerOf proves those seats again. Still: a seat bought after both IMD’s roster and the index last listed it appears on a later check, and an answer is kept for 8 days.'}},
    {id:'A-3',severity:'Low',area:null,title:{zh:'較舊的「我的家」查詢結果可能蓋掉較新的結果，恢復屋主模式',en:'An older house read could restore owner mode after a newer one ended it'},
      status:{zh:'此版本已修正：較舊的查詢在讀完內容後也會再檢查一次，不會蓋掉較新的結果。',
        en:'Fixed in this version: an older house read is dropped after its body arrives too, so it can’t undo a newer answer.'}},
    {id:'A-4',severity:'Low',area:AVAILABILITY,title:{zh:'候選席位超過 256 個時，唯一計入房子的席位可能沒被檢查',en:'Past 256 candidate seats, the only seat that counts could be left unchecked'},
      status:{zh:'此版本已修正：超過 256 個候選席位時，先檢查可能計入房子的席位；沒查完的清單會標示為未查完，不會當成完整的答案。仍存在：超過上限的席位不會列出。',
        en:'Fixed in this version: past the 256-candidate cap, seats that can count are checked first, and a cut list is marked as incomplete, never shown as a complete answer. Still: seats past the cap are not listed.'}},
    {id:'A-5',severity:'Low',area:AVAILABILITY,title:{zh:'故意慢慢上傳請求內容，可把智慧錢包查核記到較早的分鐘',en:'Slow request bodies dated smart-wallet checks into earlier minutes'},
      status:{zh:'此版本已修正：登入的各項名額都以請求內容收完的時間計算。仍存在：每個 IP 的限流在請求一開始就檢查，所以單一 IP 可以把好幾分鐘份的慢請求一起完成；成本仍受每個網段的名額限制。',
        en:'Fixed in this version: sign-in counts are dated when the request body has arrived. Still: the per-IP limit is asked when a request starts, so one IP can finish several minutes’ worth of slow requests together; what they cost stays within the per-network shares.'}},
    {id:'A-6',severity:'Low',area:AVAILABILITY,title:{zh:'同網段的鄰居可以用掉某位玩家的登入名額',en:'A network neighbour could spend a player’s sign-in allowance'},
      status:{zh:'此版本部分修正：取消每個錢包的冷卻，鄰居的 challenge 不會再擋到持有人。仍存在：同一個 /24（或 /48）裡兩個 IP 就能用完該網段每分鐘 30 個 challenge，網段內的玩家要等一分鐘；只影響登入（未完全解決）。',
        en:'Partly fixed in this version: there is no per-wallet cooldown, so a neighbour’s challenges never refuse a player’s own. Still: two IPs in one /24 (or /48) can spend that network’s 30 challenges a minute, and every player there waits the minute; sign-in only (partly open).'}},
    {id:'A-7',severity:'Low',area:AVAILABILITY,title:{zh:'約 20 個網段可一直佔滿全站登入上限',en:'About 20 networks could keep the site-wide sign-in ceiling full'},
      status:{zh:'此版本已改善：全站每 6 秒 60 個 challenge 中，保留 20 個給最近一分鐘沒發過的網段。仍存在：14 個 /24 持續滿額、再加上每分鐘約 200 個其他網段時，仍可暫停新登入；瀏覽不受影響（未完全解決）。',
        en:'Improved in this version: 20 of every 60 challenges per 6 s are kept for networks that have not asked in the last minute. Still: 14 /24s at full rate plus about 200 other networks a minute can close new sign-ins while they keep going; browsing is unaffected (partly open).'}},
    {id:'A-8',severity:'Low',area:null,title:{zh:'鏈上查詢因限流沒做成，畫面卻寫「鏈上核實：這個錢包目前沒有 IMD 席位」',en:'A refused on-chain check was shown as “Checked on chain: this wallet holds no IMD seat right now”'},
      status:{zh:'此版本已修正：查核沒能完成時，畫面會說明這次查核沒完成、請稍後重試，不再說已在鏈上核實、這個錢包沒有席位。',
        en:'Fixed in this version: when the check could not be completed, the page says so and asks to try again later; it no longer says the chain was checked and the wallet holds no seat.'}}]}];

/** `commit` is the source the reviewers rebuilt; `worker` the Cloudflare version id the team gave them; `bundle` the
 *  SHA-256 of that Worker bundle, which they reproduced. `match`: the review's deployment-match verdict. */
export const REVIEW_RECORD={job:JOB,commit:'0def8cb',worker:'beac62be',bundle:'4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3',
  date:'2026-09-28',match:'partial',
  /** The Swarm re-reviews of a later version (REREVIEWED), oldest first. Only from actual re-review jobs. */
  rereviews:REREVIEWS,
  scope:{zh:'錢包登入與我家權限（僅 World）',en:'Wallet sign-in & home authorization (World-only)'},
  jobUrl:jobUrl(JOB)!,
  reportUrl:reportOf(JOB)} as const;

/** Every finding of the report, its severity as the report gives it, and one honest line on where it stands in this
 *  version ('open' where it is open). The statuses are the site maintainer's own account, not the reviewers' (the page says so). */
export const FINDINGS:readonly Finding[]=[
  {id:'F-1',severity:'Medium',area:{zh:'共用邊界',en:'shared boundary'},title:{zh:'登入訊息可被轉送（釣魚）',en:'Sign-in message can be relayed (phishing)'},
    status:{zh:'部分緩解：本頁會在簽名前檢查訊息並顯示摘要；但釣魚網站可以略過本頁的檢查——只在網址列是 imdember.com 時簽名；若錢包顯示請求來自其他網站或出現不符警告，請拒絕。',
      en:'Partly mitigated: this page checks the message before you sign and shows what you sign, but a phishing site can skip page checks — sign only when the address bar shows imdember.com; if your wallet says the request comes from another site or warns of a mismatch, reject.'}},
  {id:'F-2',severity:'Low/Info',area:null,title:{zh:'接受任何簽名的智慧合約錢包',en:'Smart-contract wallets that accept any signature'},
    status:{zh:'部分處理：登入會記錄錢包類型與驗證方式，驗證無法進行時一律拒絕；合約本身的規則仍決定誰能代表它簽名（未解決）。',en:'Partly addressed: sessions record the wallet type and check method, and an unavailable check always refuses; the contract’s own rules still decide who signs for it (open).'}},
  {id:'F-3',severity:'Low',area:{zh:'可用性',en:'availability'},title:{zh:'垃圾簽名可暫時佔滿智慧錢包驗證額度',en:'Junk signatures can use up smart-wallet checks'},
    status:{zh:'已改善：依網段、合約地址分配額度（某合約每分鐘 2 次共用額度用完後，只要該據點這類查核的額度還沒用完，每個網段仍各有 1 次），並先確認地址有無合約程式碼；仍有殘餘風險：多個網段在垃圾請求持續期間，可讓某據點的智慧錢包登入保持忙碌（首次登入的、回訪的，或指定的某個地址），同一網段的垃圾請求也能擋住該網段的智慧錢包（未完全解決）。',
      en:'Improved: shares per network and per contract (once a contract’s 2 shared checks a minute are spent, each network still gets one while the location’s allowance for these lasts), and a code check before the smart-wallet budget; residual: many networks can still keep smart-wallet sign-in busy at one location (first-time wallets, returning ones, or one chosen address), and junk from a smart wallet’s own network can hold it, while the junk continues (partly open).'}},
  {id:'F-4',severity:'Low',area:null,title:{zh:'只能登出目前的瀏覽器',en:'Log-out ended only this browser'},
    status:{zh:'已修正：新增「登出所有裝置」。',en:'Fixed: “Log out all devices”.'}},
  {id:'F-5',severity:'Low',area:{zh:'可用性',en:'availability'},title:{zh:'約 20 個網段可關閉全站登入',en:'About 20 networks can close sign-in site-wide'},
    status:{zh:'已改善：分層限流，取得與驗證分開計算，全站上限保留一部分給最近一分鐘沒發過的網段；全站上限保留，只作緊急煞車。仍存在：約 14 個網段持續滿額、再加上每分鐘約 200 個其他網段時，仍可暫停全站新登入（瀏覽不受影響；未完全解決）。',
      en:'Improved: layered limits, challenge and verify counted apart, part of the site-wide ceiling kept for networks that have not asked in the last minute; the ceiling stays as an emergency brake. Still: about 14 /24s at full rate plus about 200 other networks a minute can close new sign-ins site-wide while they keep going; browsing is unaffected (partly open).'}},
  {id:'F-6',severity:'Info',area:null,title:{zh:'建置用套件的已知漏洞',en:'Known advisories in build tools'},
    status:{zh:'已修正：建置工具已更新，2026-09-28 npm audit 為 0。之後出現一則只影響開發工具的新公告（undici，中度），2026-09-29 已修補，當日 npm audit 再次為 0。以上都不隨網站發佈。',
      en:'Fixed: build tools updated; npm audit reported 0 on 2026-09-28. A later advisory in a dev-only tool (undici, moderate) was patched on 2026-09-29; npm audit reported 0 again that day. None of these ship with the site.'}},
  {id:'F-7',severity:'Info',area:null,title:{zh:'其他觀察（a–e）',en:'Other observations (a–e)'},
    status:{zh:'(a) 已修正（簽名前檢查訊息）；(b)–(e) 維持現狀，列為已知。',en:'(a) fixed (the message is checked before signing); (b)–(e) unchanged, accepted as known.'}},
  {id:'F-8',severity:'Info',area:{zh:'共用邊界',en:'shared boundary'},title:{zh:'同一網域共用標頭、cookie 與錢包授權',en:'One origin shares headers, cookies and wallet access'},
    status:{zh:'未解決：World 本輪沒有改動；日後同網域的頁面會與 World 共用這些設定，需各自審查。',en:'Open: nothing changed in World; later pages on this origin share these with World and need their own review.'}}
];

/** This build changed sign-in after the reviewed version and after the re-reviewed one, so the record is labelled as a
 *  previous review and the re-reviews as of Worker 50c688c9. */
export const REVIEW_CHANGED=true;
export const recordLabels=(say:Say)=>({
  title:say('審查紀錄','Swarm Audit Record'),
  changed:say('先前的審查 — 目前版本已變更','Previous review — current version has changed'),
  scope:say('審查範圍','Reviewed scope'),version:say('審查版本','Reviewed version'),date:say('審查日期','Review date'),
  match:say('部署對照','Deployment match'),job:say('審查任務','Review job'),report:say('報告','Report'),rereview:say('重新審查','Re-review'),
  findings:say('發現（出自審查）· 修正狀態為 本站維護者自行說明，尚未重新審查','Findings (from the review) · fix status as reported by the site maintainer, not re-reviewed'),
  only:say('此紀錄只適用於受審查的版本。','This record applies to the reviewed version only.'),
  rereviews:say(`重新審查（${REREVIEWED.date}，UTC）`,`Re-reviews (${REREVIEWED.date}, UTC)`),
  rereviewOnly:say(`兩次重新審查看的是 Worker ${REREVIEWED.worker}，不是目前版本；目前版本的變更沒有經過重新審查。下列發現出自重新審查，修正狀態為 本站維護者自行說明。`,
    `Both re-reviews examined Worker ${REREVIEWED.worker}, not this version; this version’s changes were not re-reviewed. The findings below are the re-reviews’; their fix status is as reported by the site maintainer.`)});
export const versionText=(say:Say)=>{const r=REVIEW_RECORD,b=r.bundle.slice(0,8);return say(`Worker ${r.worker}（原始碼 ${r.commit}，bundle ${b}…）`,`Worker ${r.worker} (source ${r.commit}, bundle ${b}…)`);};
export const matchText=(say:Say)=>say(REVIEW_RECORD.match==='partial'?'partial（部分驗證）':REVIEW_RECORD.match,REVIEW_RECORD.match);
/** A re-review as the page names it: its template and its job's short id. */
export const rereviewName=(r:Rereview,say:Say)=>say(r.kind==='Report'?'Report（重測）':'Audit（審查）',r.kind)+' '+r.job.slice(0,8)+'…';
export const rereviewVersionText=(say:Say)=>{const r=REREVIEWED,b=r.bundle.slice(0,8);
  return say(`Worker ${r.worker}（原始碼 ${r.commit}，公開快照 ${r.snapshot}，bundle ${b}…，由 Report 重建）`,`Worker ${r.worker} (source ${r.commit}, public snapshot ${r.snapshot}, bundle ${b}… as the Report rebuilt it)`);};
export const rereviewMatchText=(r:Rereview,say:Say)=>r.match==='partial'?say('部署對照：partial（部分驗證）','Deployment match: partial'):say('部署對照：此審查未評估','Deployment match: not assessed by the audit');
export const dateText=(say:Say)=>say(`${REVIEW_RECORD.date}（UTC）`,`${REVIEW_RECORD.date} (UTC)`);
export const findingLine=(f:Finding,say:Say)=>`${f.id} · ${f.severity}${f.area?say('（'+f.area.zh+'）',' ('+f.area.en+')'):''} — ${say(f.title.zh,f.title.en)}${say('。','. ')}${say(f.status.zh,f.status.en)}`;
/** The anchors' attributes: a new tab, sending no referrer and no window.opener. */
export const outLink=(href:string)=>({href,target:'_blank',rel:'noreferrer noopener'}) as const;
