// The Swarm Audit Record (remediation 2026-09-29 §6): the public record of the review of World's wallet sign-in and home
// authorization (IMD Swarm job 4bd31cfb, Worker version beac62be, 2026-09-28 UTC), of the two re-reviews of a later
// version (Worker 50c688c9, 2026-09-29 UTC), of the Swarm audit of a later one still (Worker 1a0dd495, 2026-09-30
// UTC) and of the two reviews of the version after it (Worker bbf24001, 2026-10-01 UTC), shown collapsed in "My
// wallet" before and after sign-in. One data module for
// the page and docs/security/AUDIT_REMEDIATION_STATUS.md (tests/review-record checks the doc against it). It says what was
// reviewed and what changed since; each record is of its version only, so no badge and none of the words the
// remediation forbids (tests/review-record lists them).
// When a later version is reviewed, add its record here and keep these, labelled by their versions.
import {jobUrl} from './links.ts';

type Say=(zh:string,en:string)=>string;
type Text={zh:string;en:string};
export type Finding={id:string;severity:'Medium'|'Low'|'Low/Info'|'Info';area:Text|null;title:Text;status:Text};

const JOB='4bd31cfb-1151-497f-9b27-40e668dea372',RETEST='e48d0a96-d3a5-42bb-859f-e0b0707fd9ad',AUDIT='519db624-a82f-4dfe-91b9-1a519d1d3dd1';
const AUDIT3='8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b',REPORT4='dcf922ca-68de-4cc5-bfbc-8b226008b0bf',AUDIT4='1ef8e8a6-4297-4ff8-b869-2d9b91445d82';
const reportOf=(job:string)=>`https://github.com/Identity-md/research/blob/main/jobs/${job}/files/artifacts/report.md`;
const AVAILABILITY={zh:'可用性',en:'availability'},HARDENING={zh:'強化',en:'hardening'};

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
      status:{zh:'此版本已改善：少數其他網段的垃圾請求不再能擋住智慧錢包——某錢包每分鐘 2 次共用查核用完後，只要該據點每分鐘 20 次這類查核還沒用完，每個網段每分鐘仍各有 1 次（IPv6 /48 為 2 次，來自其中兩個 /64），屋主自己先前的嘗試不會用掉它。仍存在：同一個 /24（或 /48）裡的垃圾請求仍可擋住它；在同一據點每分鐘至少 9 個 /24 打 3 個以上地址時也可以（未完全解決）。',
        en:'Improved in this version: junk from a few other networks no longer holds a smart wallet — once its 2 shared checks a minute are spent, each network still gets one check of it a minute (an IPv6 /48 two, from two of its /64s), which the owner’s own earlier attempt doesn’t use up, while the location’s 20 such checks a minute last. Still: junk from the wallet’s own /24 (or /48) can hold it, and so can at least 9 /24s aimed at 3 or more addresses every minute at one location (partly open).'}},
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
      status:{zh:'此版本部分修正：取消每個錢包的冷卻，鄰居的 challenge 不會再擋到持有人。仍存在：同一個 /24 裡兩個 IP 就能用完該網段每分鐘 30 個 challenge（IPv6 /48 每分鐘 60 個，其中三個 /64 就能用完），網段內的玩家要等一分鐘；只影響登入（未完全解決）。',
        en:'Partly fixed in this version: there is no per-wallet cooldown, so a neighbour’s challenges never refuse a player’s own. Still: two IPs in one /24 can spend that network’s 30 challenges a minute (an IPv6 /48 has 60, which three of its /64s can spend), and every player there waits the minute; sign-in only (partly open).'}},
    {id:'A-7',severity:'Low',area:AVAILABILITY,title:{zh:'約 20 個網段可一直佔滿全站登入上限',en:'About 20 networks could keep the site-wide sign-in ceiling full'},
      status:{zh:'此版本已改善：全站每 6 秒 60 個 challenge 中，保留 20 個給最近一分鐘沒發過的網段。仍存在：14 個 /24 持續滿額、再加上每分鐘約 200 個其他網段時，仍可暫停新登入；瀏覽不受影響（未完全解決）。',
        en:'Improved in this version: 20 of every 60 challenges per 6 s are kept for networks that have not asked in the last minute. Still: 14 /24s at full rate plus about 200 other networks a minute can close new sign-ins while they keep going; browsing is unaffected (partly open).'}},
    {id:'A-8',severity:'Low',area:null,title:{zh:'鏈上查詢因限流沒做成，畫面卻寫「鏈上核實：這個錢包目前沒有 IMD 席位」',en:'A refused on-chain check was shown as “Checked on chain: this wallet holds no IMD seat right now”'},
      status:{zh:'此版本已修正：查核沒能完成時，畫面會說明這次查核沒完成、請稍後重試，不再說已在鏈上核實、這個錢包沒有席位。',
        en:'Fixed in this version: when the check could not be completed, the page says so and asks to try again later; it no longer says the chain was checked and the wallet holds no seat.'}}]}];

/** The version the Swarm audit of 2026-09-30 examined: Worker 1a0dd495 (source 4321bb4), read through the public snapshot
 *  ae1d41a of that source, and the SHA-256 of the Worker bundle one of its reviewers rebuilt from the snapshot (equal to
 *  the team's deploy record; the judge's report gives no deployment-match verdict). Not this version: REVIEW_CHANGED
 *  says so, and so does the page. */
export const REVIEWED_LATER={worker:'1a0dd495',commit:'4321bb4',snapshot:'ae1d41a',bundle:'1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c',date:'2026-09-30'} as const;
/** The Swarm reviews of REVIEWED_LATER, oldest first (the Rereview shape): Audit 8c3aea2e (four specialists and a judge,
 *  report AUDIT.md) and its findings N-1..N-7 with the severities it gives; each status is the site maintainer's
 *  account of this version. Only from actual review jobs. */
export const LATER_REVIEWS:readonly Rereview[]=[
  {job:AUDIT3,kind:'Audit',jobUrl:jobUrl(AUDIT3)!,reportUrl:`https://github.com/Identity-md/research/blob/main/jobs/${AUDIT3}/files/AUDIT.md`,match:null,findings:[
    {id:'N-1',severity:'Low',area:null,title:{zh:'較舊的登入狀態查詢可能清掉較新查詢建立的屋主狀態',en:'An older session read could erase the owner state a newer one had set'},
      status:{zh:'此版本已修正：只採用最新一次的登入狀態查詢（含內容與錯誤），較舊的回應不會蓋掉較新的結果；按登入時會等最新一次查詢完成。',
        en:'Fixed in this version: only the newest session read is applied, its body and errors included, so an older answer can’t undo a newer one; a sign-in click waits for the newest read.'}},
    {id:'N-2',severity:'Low',area:null,title:{zh:'已取消的登入仍可能要求舊帳號簽名',en:'A cancelled sign-in could still ask the old account to sign'},
      status:{zh:'此版本已修正：收到登入訊息後，頁面會先確認登入流程、錢包與帳號都沒變，才請錢包簽名；已取消的流程不會再跳出簽名。仍存在：已經開啟的錢包視窗，頁面無法替你關閉；它的回覆會被捨棄。',
        en:'Fixed in this version: once the sign-in message arrives, the page checks that the flow, the wallet and the account are unchanged before asking the wallet; a cancelled flow asks nothing. Still: a wallet window already open can’t be closed by the page; its answer is dropped.'}},
    {id:'N-3',severity:'Low',area:AVAILABILITY,title:{zh:'候選席位超過 256 個時，靠 24 小時內上線紀錄計入房子的席位可能沒被檢查',en:'Past 256 candidate seats, a seat that counts through a recent sighting could be left unchecked'},
      status:{zh:'此版本已修正：候選席位超過 256 個時，先檢查會計入房子的席位（目前在線，或 24 小時內以這個持有人身分上線過），沒查完的清單仍標示為未查完。仍存在：超過上限的席位不會列出。',
        en:'Fixed in this version: past the 256-candidate cap, seats that count (online now, or seen under this owner in the last 24 hours) are checked first, and a cut list is still marked as incomplete. Still: seats past the cap are not listed.'}},
    {id:'N-4',severity:'Low',area:AVAILABILITY,title:{zh:'屋主自己前一次的查核會用掉 A-1 的備用查核，一次垃圾驗證就能擋住重試',en:'The owner’s own earlier check used up A-1’s fallback check, so one junk verify could block a retry'},
      status:{zh:'此版本已修正：備用查核只計算備用查核本身，屋主自己前一次的嘗試不再用掉它，重試或第二台裝置都能通過。仍存在：同一個網段裡的垃圾請求仍可擋住它（同 A-1）。',
        en:'Fixed in this version: the fallback check counts only fallback checks, so the owner’s own earlier attempt no longer uses it up, and a retry or a second device gets through. Still: junk from the wallet’s own network can hold it, as for A-1.'}},
    {id:'N-5',severity:'Low',area:AVAILABILITY,title:{zh:'同一個 IPv6 /48 裡的不同用戶共用一份智慧錢包登入名額',en:'Separate IPv6 subscribers in one /48 shared one set of smart-wallet sign-in shares'},
      status:{zh:'此版本已改善：IPv6 /48 的登入名額是 /24 的兩倍，其中每個 /64 最多用一個 /24 份的智慧錢包查核，以要求 challenge 的那個 /64 計算。仍存在：握有同一個 /48 裡兩個以上 /64 的人，仍可用光它的名額，那裡的登入要等一分鐘（未完全解決）。',
        en:'Improved in this version: an IPv6 /48 gets twice a /24’s sign-in shares, and each /64 in it at most one /24’s share of smart-wallet checks, counted by the /64 that asked for the challenge. Still: someone holding two or more /64s of a shared /48 can spend its shares, and sign-in there waits the minute (partly open).'}},
    {id:'N-6',severity:'Low',area:AVAILABILITY,title:{zh:'單一 IP 可用光某據點的 NFT 索引查詢額度，讓新買家的席位查不到',en:'One IP could use up NFT-index discovery at a location and keep a new buyer’s seat from being found'},
      status:{zh:'此版本已改善：索引查詢被拒、又沒有席位計入時，發出請求的網段每分鐘仍有一次自己的索引查詢，單一 IP 不再能讓新買家的席位查不到；每個席位照樣用 ownerOf 確認。仍存在：同一據點每分鐘另有 20 個網段持續搶用時，仍可讓它這次查不到（未完全解決）。',
        en:'Improved in this version: when an index read is refused and no seat counts yet, the requester’s network still gets one index read a minute of its own, so one IP no longer keeps a new buyer’s seat from being found; ownerOf still proves every seat. Still: 20 other networks at one location every minute can keep it refused while they go on (partly open).'}},
    {id:'N-7',severity:'Info',area:null,title:{zh:'在別處被撤銷的登入，被顯示成登入已到期',en:'A sign-in revoked elsewhere was shown as an expired session'},
      status:{zh:'此版本已修正：伺服器已不承認的登入顯示「登入狀態已失效，請重新登入。」；只有登入真的到期時才顯示「登入已到期，請重新登入。」。仍存在：這台裝置的時鐘比伺服器慢時，在那段差距裡到期的登入可能顯示成已失效；兩種說法都請你重新登入。',
        en:'Fixed in this version: a sign-in the server no longer accepts reads “You are no longer signed in. Please sign in again.”, and “Your sign-in has expired. Please sign in again.” only when it ran out. Still: when this device’s clock runs behind the server’s, a sign-in that ran out in that gap can read as no longer signed in; both ask you to sign in again.'}}]}];

/** The version both Swarm reviews of 2026-10-01 examined: Worker bbf24001 (source 2e4e830), read through the public
 *  snapshot 8cad017 of that source, and the SHA-256 of the Worker bundle as the Report rebuilt it from that snapshot
 *  (equal to the team's deploy record; the audit did not rebuild it). Not this version: REVIEW_CHANGED says so, and so
 *  does the page. */
export const REVIEWED_BBF={worker:'bbf24001',commit:'2e4e830',snapshot:'8cad017',bundle:'018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c',date:'2026-10-01'} as const;
/** The Swarm reviews of REVIEWED_BBF, oldest first (the Rereview shape): Report dcf922ca (a limited retest, report.md,
 *  deployment match partial; its one new finding, R-1, here R3-R1) and Audit 1ef8e8a6 (five submissions, four
 *  specialists' and a judge's, from four seats; AUDIT.md, no deployment-match verdict; #1..#9, here AUD3-01..AUD3-09,
 *  #9 a review record, not a defect), with the severities they give, under the ids of the owner's engineering handoff;
 *  each status is the site maintainer's account of this version. Only from actual review jobs. */
export const BBF_REVIEWS:readonly Rereview[]=[
  {job:REPORT4,kind:'Report',jobUrl:jobUrl(REPORT4)!,reportUrl:reportOf(REPORT4),match:'partial',findings:[
    {id:'R3-R1',severity:'Low',area:null,title:{zh:'錢包較晚回來的連線結果可蓋掉帳號切換，讓舊帳號被要求簽名',en:'A wallet’s late connect answer could undo an account switch and ask the old account to sign'},
      status:{zh:'此版本已修正：頁面等待錢包連線、或簽名視窗還開著時，錢包若切換帳號或鎖定，頁面保留錢包最後指定的帳號並結束這次點擊：不再向錢包要求任何東西、也不驗證，不會為了補救再開錢包視窗；下一次點擊從目前的帳號開始。仍存在：這種錢包事件順序是用測試錢包重現的，沒有用真實錢包確認。',
        en:'Fixed in this version: when the wallet switches or locks while the page waits for it to connect, or while its signature window is open, the page keeps the account the wallet named last and ends that click: it asks the wallet nothing more and verifies nothing, and never opens a wallet window to recover; the next click starts from the current account. Still: this order of wallet events was reproduced with a test wallet, not with real wallets.'}}]},
  {job:AUDIT4,kind:'Audit',jobUrl:jobUrl(AUDIT4)!,reportUrl:`https://github.com/Identity-md/research/blob/main/jobs/${AUDIT4}/files/AUDIT.md`,match:null,findings:[
    {id:'AUD3-01',severity:'Low',area:AVAILABILITY,title:{zh:'備用索引通道的查詢失敗時，回 503 並丟掉已確認的席位',en:'A failed index read on the discovery lane answered 503 and dropped the seats already proven'},
      status:{zh:'此版本已修正：備用通道自己的索引查詢、或之後的 ownerOf 查核失敗時，回應保留這次請求已用 ownerOf 確認的席位，並標示為查核沒完成，不會當成沒有席位。仍存在：這次查詢已經送出，所以該網段這一分鐘的備用通道仍算用掉。',
        en:'Fixed in this version: if the lane’s own index read, or the ownerOf check after it, fails, the answer keeps the seats this request had already proven with ownerOf and is marked as a check not completed, never as owning nothing. Still: the read was sent, so that network’s lane stays used for the minute.'}},
    {id:'AUD3-02',severity:'Low',area:AVAILABILITY,title:{zh:'據點限流拒絕後，備用索引通道的預約仍佔用網段名額與全站上限',en:'A lane claim the location’s limit then refused still used up the network’s lane and the site-wide ceiling'},
      status:{zh:'此版本部分修正：據點限流拒絕的備用通道預約沒有做任何查詢，所以會被釋放：該網段 30 秒後可以再預約，這筆預約也立刻不再計入全站上限。仍存在：全站每 6 秒只釋放 20 個預約，超過或釋放失敗時，預約照舊佔用該網段一分鐘，所以同一據點 6 秒內約 80 個預約（以前是 60 個）仍會在那 6 秒佔滿全站上限、擋住其他據點；這個做法假設被拒的限流檢查不計數，尚未向 Cloudflare 確認（未完全解決）。',
        en:'Partly fixed in this version: a lane claim the location’s limit refused made no read, so it is released: its network may claim again 30 s later, and the claim leaves the site-wide count at once. Still: only 20 claims every 6 s are released site-wide; past that, or if a release fails, a claim holds its network for the minute as before, so about 80 claims within 6 s from one location (60 before) still fill the site-wide ceiling for every other location for those 6 s; this relies on a refused limit check costing nothing, not yet confirmed with Cloudflare (partly open).'}},
    {id:'AUD3-03',severity:'Low',area:AVAILABILITY,title:{zh:'據點限流拒絕的智慧錢包查核仍用掉該地址的共用查核，屋主自己的重試因此被擋住',en:'A smart-wallet check the location’s limit refused still used up the address’s shared checks, so the owner’s own retries kept it out'},
      status:{zh:'此版本已修正：沒有送到鏈上的智慧錢包查核會被收回，屋主的重試只在限流本身拒絕時才被擋，限流有空檔後重新登入即可通過；被拒的那次 challenge 仍作廢。仍存在：已送到鏈上的查核不論結果都計數；這個做法假設被拒的限流檢查不計數，尚未向 Cloudflare 確認。',
        en:'Fixed in this version: a smart-wallet check that never reached the chain is taken back, so the owner’s retries are refused only while the limit itself refuses, and a new sign-in gets through once it has room; the refused challenge stays used. Still: a check that reached the chain counts whatever its answer; this relies on a refused limit check costing nothing, not yet confirmed with Cloudflare.'}},
    {id:'AUD3-04',severity:'Info',area:null,title:{zh:'登出途中開始的登入狀態查詢，可能讓已結束的登入重新出現',en:'A session read begun during this page’s sign-out could show the ended sign-in again'},
      status:{zh:'此版本已修正：伺服器確認這個頁面的登出後（包括切換帳號或按下登入時送出的登出），在那之前開始的登入狀態與我的家查詢都不再套用，畫面維持「已登出。」；即使其間換了錢包，已結束的登入也會從畫面上移除，其他分頁也會收到通知。仍存在：登出確認前已送達頁面的查詢結果，會先顯示到登出確認為止。',
        en:'Fixed in this version: once the server confirms this page’s sign-out (also the one an account switch or the sign-in button sends), no session or house read begun before it is applied, so “Signed out.” stays; the ended sign-in leaves the page even if another wallet was chosen meanwhile, and other tabs are told. Still: a read whose answer reaches the page before the sign-out is confirmed is shown until it is.'}},
    {id:'AUD3-05',severity:'Info',area:null,title:{zh:'我的家查詢回覆另一個地址時，畫面仍留著先前的屋主狀態，且一直顯示確認中',en:'A house answer for another address left the previous owner view and a check that never ended'},
      status:{zh:'此版本部分修正：我的家查詢回覆的是另一個地址時（另一個分頁用別的錢包登入），頁面先丟掉原本的房屋資料並結束確認，再重新讀取登入狀態；若讀取失敗，顯示「暫時無法確認持有資格，請稍後重試」，不會是屋主模式，也可以按「重新確認」。仍存在：在登入狀態讀取成功之前，面板仍把先前的登入顯示為已登入，但不會進入屋主模式；審查預期頁面不再這樣顯示（未完全解決）。',
        en:'Partly fixed in this version: when the house read answers for another address (another tab signed in with another wallet), the page drops the house it held and ends the check before it reads the session again; if that read fails it shows “Can’t confirm seats right now, try again later”, never owner mode, and “Check again” can be pressed. Still: until a session read succeeds, the panel keeps showing the earlier sign-in as signed in, without owner mode; the audit expected the page to stop showing it (partly open).'}},
    {id:'AUD3-06',severity:'Info',area:AVAILABILITY,title:{zh:'較晚到的已登出回應，可能刪掉另一個分頁剛設定的登入 cookie',en:'A late signed-out answer could delete the sign-in cookie another tab had just set'},
      status:{zh:'此版本已修正：只說明目前沒有有效登入的回應（登入狀態查詢、我的家查詢、被拒的「登出所有裝置」）不再清除登入 cookie，所以不會刪掉另一個分頁剛設定的 cookie；伺服器照樣拒絕舊的那個。新的登入向錢包要求任何東西之前，頁面會先等自己送出的登出得到回應（最多 5 秒，等候時會說明；逾時則不要求簽名，並說明先前的登出還沒有回應），所以它們也不會刪掉新登入的 cookie。仍存在：主動登出的回應若在另一個分頁登入之後才到，仍會讓這個瀏覽器登出；已結束的登入 cookie 現在會留在瀏覽器裡直到到期。',
        en:'Fixed in this version: answers that only report that there is no live sign-in (the session read, the house read, a refused “Log out all devices”) no longer clear the sign-in cookie, so they can’t delete one another tab has just set; the server still refuses the old one. Before a new sign-in asks the wallet anything, the page waits for its own sign-outs to be answered (at most 5 s, saying so meanwhile; past that it asks nothing and says that sign-out hasn’t been answered yet), so they can’t delete that sign-in’s cookie either. Still: an explicit sign-out whose answer arrives after another tab’s sign-in still signs that browser out, and an ended sign-in’s cookie now stays in the browser until it expires.'}},
    {id:'AUD3-07',severity:'Info',area:null,title:{zh:'對已到期的登入按「登出所有裝置」時，沒有說明登入已到期',en:'Log out all devices on a sign-in that had run out did not say it had expired'},
      status:{zh:'此版本已修正：伺服器表示這個瀏覽器的登入已到期時，頁面顯示「登入已到期，請重新登入。」，並照樣說明沒有登出其他裝置；之後再讀一次登入狀態，另一個分頁剛完成的登入會被找到。仍存在：這台裝置的時鐘比伺服器慢、且瀏覽器已丟掉 cookie 時，頁面無法得知登入已到期（同 N-7）。',
        en:'Fixed in this version: when the server says this browser’s sign-in ran out, the page says “Your sign-in has expired. Please sign in again.” and still that other devices were not signed out; it then reads the session again, so a sign-in another tab has just made is found. Still: when this device’s clock runs behind the server’s and the browser has already dropped the cookie, the page can’t tell that it ran out, as for N-7.'}},
    {id:'AUD3-08',severity:'Info',area:HARDENING,title:{zh:'不尋常的 IP 位址寫法可能被歸到無關網段的限流',en:'Unusual address text could be rate-limited as an unrelated network'},
      status:{zh:'此版本已修正：完整解析用戶端位址；以 IPv6 形式寫的 IPv4 位址算作那個 IPv4，其他 IPv6 仍是 IPv6，不是用戶端位址的文字共用一份小額度。仍存在：沒有證據顯示真實請求會走到這裡；若 Cloudflare 送來這裡不接受的寫法，那些用戶會共用那份額度。',
        en:'Fixed in this version: the whole client address is parsed; an IPv4 address written in IPv6 form counts as that IPv4, other IPv6 stays IPv6, and text that is not a client address shares one small allowance. Still: no real request was shown to reach this; were Cloudflare to send a form this rejects, those clients would share that allowance.'}},
    {id:'AUD3-09',severity:'Info',area:null,title:{zh:'審查紀錄（不是缺陷）：這次審查查了什麼、無法查什麼',en:'Review record (not a defect): what the audit checked and what it could not check'},
      status:{zh:'僅為紀錄，沒有要修正的項目：這次審查沒找到已取消、切換或關閉的登入流程仍能要求簽名或驗證的路徑，Report 的 R3-R1 則找到連線仍在等待時的一條（此版本已修正）。審查無法檢查的項目（正式部署、真實的 Cloudflare 限流與資料庫、真實錢包與瀏覽器）仍未檢查。',
        en:'Record only, nothing to fix: the audit found no path from a cancelled, switched or closed sign-in to a signature or a verify, and the Report’s R3-R1 shows one for a connect still pending (fixed in this version). What it could not check (the live deployment, real Cloudflare limits and database, real wallets and browsers) is still unchecked.'}}]}];

/** `commit` is the source the reviewers rebuilt; `worker` the Cloudflare version id the team gave them; `bundle` the
 *  SHA-256 of that Worker bundle, which they reproduced. `match`: the review's deployment-match verdict. */
export const REVIEW_RECORD={job:JOB,commit:'0def8cb',worker:'beac62be',bundle:'4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3',
  date:'2026-09-28',match:'partial',
  /** The Swarm re-reviews of a later version (REREVIEWED), oldest first. Only from actual re-review jobs. */
  rereviews:REREVIEWS,
  /** The Swarm reviews of a later version still (REVIEWED_LATER), oldest first. */
  later:LATER_REVIEWS,
  /** The Swarm reviews of the version after it (REVIEWED_BBF), oldest first. */
  bbf:BBF_REVIEWS,
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

/** This build changed sign-in after the reviewed version, after the re-reviewed one, after Worker 1a0dd495 (Swarm audit
 *  8c3aea2e's N-1..N-7 fixes) and after Worker bbf24001 (the R3-R1 and AUD3-01..AUD3-08 fixes), so the record is labelled
 *  as a previous review, the re-reviews as of Worker 50c688c9, the later review as of Worker 1a0dd495 and the reviews of
 *  2026-10-01 as of Worker bbf24001. */
export const REVIEW_CHANGED=true;
export const recordLabels=(say:Say)=>({
  title:say('審查紀錄','Swarm Audit Record'),
  changed:say('先前的審查 — 目前版本已變更','Previous review — current version has changed'),
  scope:say('審查範圍','Reviewed scope'),version:say('審查版本','Reviewed version'),date:say('審查日期','Review date'),
  match:say('部署對照','Deployment match'),job:say('審查任務','Review job'),report:say('報告','Report'),rereview:say('重新審查','Re-review'),
  laterRow:say('之後的審查','Later review'),bbfRow:say(`Worker ${REVIEWED_BBF.worker} 的審查`,`Reviews of Worker ${REVIEWED_BBF.worker}`),
  findings:say('發現（出自審查）· 修正狀態為 本站維護者自行說明，尚未重新審查','Findings (from the review) · fix status as reported by the site maintainer, not re-reviewed'),
  only:say('此紀錄只適用於受審查的版本。','This record applies to the reviewed version only.'),
  rereviews:say(`重新審查（${REREVIEWED.date}，UTC）`,`Re-reviews (${REREVIEWED.date}, UTC)`),
  rereviewOnly:say(`兩次重新審查看的是 Worker ${REREVIEWED.worker}，不是目前版本；目前版本的變更沒有經過重新審查。下列發現出自重新審查，修正狀態為 本站維護者自行說明。`,
    `Both re-reviews examined Worker ${REREVIEWED.worker}, not this version; this version’s changes were not re-reviewed. The findings below are the re-reviews’; their fix status is as reported by the site maintainer.`),
  later:say(`之後的審查（${REVIEWED_LATER.date}，UTC）`,`Later review (${REVIEWED_LATER.date}, UTC)`),
  laterOnly:say(`這次審查看的是 Worker ${REVIEWED_LATER.worker}，不是目前版本；目前版本的變更沒有經過重新審查。下列發現出自這次審查，修正狀態為 本站維護者自行說明。`,
    `This review examined Worker ${REVIEWED_LATER.worker}, not this version; this version’s changes were not re-reviewed. The findings below are the review’s; their fix status is as reported by the site maintainer.`),
  bbf:say(`Worker ${REVIEWED_BBF.worker} 的審查（${REVIEWED_BBF.date}，UTC）`,`Reviews of Worker ${REVIEWED_BBF.worker} (${REVIEWED_BBF.date}, UTC)`),
  bbfOnly:say(`兩次審查看的是 Worker ${REVIEWED_BBF.worker}，不是目前版本；目前版本的變更沒有經過重新審查。下列發現出自這兩次審查，修正狀態為 本站維護者自行說明。`,
    `Both reviews examined Worker ${REVIEWED_BBF.worker}, not this version; this version’s changes were not re-reviewed. The findings below are the reviews’; their fix status is as reported by the site maintainer.`)});
export const versionText=(say:Say)=>{const r=REVIEW_RECORD,b=r.bundle.slice(0,8);return say(`Worker ${r.worker}（原始碼 ${r.commit}，bundle ${b}…）`,`Worker ${r.worker} (source ${r.commit}, bundle ${b}…)`);};
export const matchText=(say:Say)=>say(REVIEW_RECORD.match==='partial'?'partial（部分驗證）':REVIEW_RECORD.match,REVIEW_RECORD.match);
/** A re-review as the page names it: its template and its job's short id. */
export const rereviewName=(r:Rereview,say:Say)=>say(r.kind==='Report'?'Report（重測）':'Audit（審查）',r.kind)+' '+r.job.slice(0,8)+'…';
export const rereviewVersionText=(say:Say)=>{const r=REREVIEWED,b=r.bundle.slice(0,8);
  return say(`Worker ${r.worker}（原始碼 ${r.commit}，公開快照 ${r.snapshot}，bundle ${b}…，由 Report 重建）`,`Worker ${r.worker} (source ${r.commit}, public snapshot ${r.snapshot}, bundle ${b}… as the Report rebuilt it)`);};
export const laterVersionText=(say:Say)=>{const r=REVIEWED_LATER,b=r.bundle.slice(0,8);
  return say(`Worker ${r.worker}（原始碼 ${r.commit}，公開快照 ${r.snapshot}，bundle ${b}…，由審查者重建）`,`Worker ${r.worker} (source ${r.commit}, public snapshot ${r.snapshot}, bundle ${b}… as a reviewer rebuilt it)`);};
export const bbfVersionText=(say:Say)=>{const r=REVIEWED_BBF,b=r.bundle.slice(0,8);
  return say(`Worker ${r.worker}（原始碼 ${r.commit}，公開快照 ${r.snapshot}，bundle ${b}…，由 Report 重建）`,`Worker ${r.worker} (source ${r.commit}, public snapshot ${r.snapshot}, bundle ${b}… as the Report rebuilt it)`);};
export const rereviewMatchText=(r:Rereview,say:Say)=>r.match==='partial'?say('部署對照：partial（部分驗證）','Deployment match: partial'):say('部署對照：此審查未評估','Deployment match: not assessed by the audit');
export const dateText=(say:Say)=>say(`${REVIEW_RECORD.date}（UTC）`,`${REVIEW_RECORD.date} (UTC)`);
export const findingLine=(f:Finding,say:Say)=>`${f.id} · ${f.severity}${f.area?say('（'+f.area.zh+'）',' ('+f.area.en+')'):''} — ${say(f.title.zh,f.title.en)}${say('。','. ')}${say(f.status.zh,f.status.en)}`;
/** The anchors' attributes: a new tab, sending no referrer and no window.opener. */
export const outLink=(href:string)=>({href,target:'_blank',rel:'noreferrer noopener'}) as const;
