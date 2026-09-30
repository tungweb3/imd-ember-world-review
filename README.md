# IMD Ember World：錢包登入審查快照（World-only）

> Copyright (c) 2026 tungweb3. All rights reserved. Published solely so reviewers can read it for the IMD Ember World
> security review; no licence to copy, modify, redistribute or use is granted.（全文見 `LICENSE`）

## 這是什麼

這是 **審查用的去敏快照**，給外部 reviewer（例如 Swarm／Identity.md 上的 agent）檢查 https://imdember.com 目前正式上線的 World。IMD Ember World 是社群自行推動的非官方專案，Identity.md 沒有經營或背書它（`source/index.html:7`）。

它**不是**審查報告或證書，也不替任何安全結論背書。裡面的說明文件是專案方對程式現況的描述和已執行的本機測試紀錄；審查結論要由 reviewer 自己重新檢查原始碼與證據後做出。

本輪請 reviewer 回答一個問題（本 repo 不替這個問題下結論）：

**玩家在 imdember.com 連上自己的錢包並簽名登入，安全嗎？**

具體包括：錢包被要求簽什麼、頁面與伺服器怎麼檢查、session／cookie／Origin／CSRF／登出（含「登出所有裝置」）、登入的分層速率與預算限制、屋主功能（含「進入我的家」）背後的 NFT 所有權查核（含索引查詢被拒時的候選來源），以及阻止注入腳本觸發錢包提示的標頭、CSP 與依賴。

本 repo 有三個 commit：

| commit | 內容 |
|---|---|
| `c2a8c33`（第一個，已公開，未改動） | 第一次送審版本：來源 `0def8cb`、正式 Worker `beac62be`。Swarm job `4bd31cfb-1151-497f-9b27-40e668dea372` 審查的就是它 |
| `b6e986b`（第二個，已公開，未改動） | 上一次的審查對象：來源 `2da46cd`、正式 Worker `50c688c9`。Swarm Report `e48d0a96`（重測）與 Swarm Audit `519db624` 審查的就是它 |
| 本 commit（`b6e986b` 之後的唯一一個 commit） | 目前正式版本：來源 `4321bb4da3826276919ed60ecc2018139dcaeacc`、正式 Worker `1a0dd495-35e7-4052-ba84-332e787f864d`。本檔與其他文件都描述這個版本 |

依持有人的決定，`source/` 只公開判斷「連錢包、簽名登入與屋主權限是否安全」所需的程式（72 個檔案，清單與每個檔案收錄的理由見 `SCOPE.md` 第 6 節）：

- **整個伺服器端都公開**：Worker 進入點、`server/` 全部檔案、四個 D1 migration（本版新增 `0004_index_candidates.sql`），以及 Worker 在執行期 import 的每個 `src/world/` 模組（與上一版相同的 8 個）。reviewer 可以只用本快照重建實際上傳的 Worker bundle，並比對 SHA-256（`DEPLOYMENT_MATCH.md` 第 3 節）。
- **用戶端只公開錢包／登入與屋主權限需要的檔案**：登入狀態機 `auth.ts`、頁面端 SIWE 檢查 `siwe.ts`、EIP-6963 錢包選擇 `wallet.ts`、「我的錢包」面板 `WalletPanel.tsx`／`walletView.ts`、審查紀錄 `reviewRecord.ts`／`auditRecord.ts`、搬家閘門 `moves.ts`、「進入我的家」的閘門 `homeEntry.ts`；另外公開 `publicHashes.ts`／`publicUrl.ts`（公開靜態檔的雜湊檔名，與登入無關；`vite.config.ts` 與 `tests/headers.test.mjs` 會載入它們）。
- **文件**：公開版修正狀態 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`、本版新增的 `source/docs/security/MINT_BOUNDARY.md`（日後 Mint 頁面必須自己審查的邊界問題；不含也不描述任何 Mint 程式），以及 5 頁部署證據 `source/docs/security/deploy-evidence/*.md`（只含從團隊部署紀錄複製的結構化欄位）。
- **不公開**：3D 世界、房屋內部的繪製（`src/world/interior/*`）、地形（含本版的地形預烘與分段計算）、模型、美術、音樂、新手引導、房屋的分配與擺放規則（`households.ts`、`layout.ts`、`collision.ts`）、主畫面接線 `WorldApp.tsx`、世界資料的讀取 `bridge.ts`。每個不公開的檔案（484 個）都列在 `manifests/withheld-source.txt`（SHA-256）與 `manifests/withheld-source-gitblobs.txt`（git blob id）。這些程式都已編譯進公開的正式前端 bundle，可以直接對 bundle 檢查（`SCOPE.md` 第 6.3 節）。

**Genesis Mint 不在本次範圍。** 正式 World 的原始碼、前端 bundle 與 Worker bundle 裡都沒有 Mint 程式、路由、合約、signer 或 UI；Mint 會在上線前另外審查。持有人先前已說明日後的 Mint 頁面會在同一個 origin（`imdember.com`）並使用本站的 SIWE 登入狀態，所以本輪檢視的 session／cookie／Origin／CSP 設計也是它會繼承的基礎；Report 提出的 G-1～G-3 與 S-2 清單寫在 `source/docs/security/MINT_BOUNDARY.md`（`SCOPE.md` 第 3 節）。

## 自送審版本以來的變更（b6e986b／Worker 50c688c9 → 本 commit／Worker 1a0dd495）

### 審查紀錄

- **第一次審查**：Swarm job `4bd31cfb`（2026-09-28，對象 `c2a8c33`／Worker `beac62be`），報告 https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md 。判定「沒有 High／Critical；F-1 Medium（shared-boundary）、F-2～F-5 Low、F-6～F-8 Info；部署對照 partial」。F-1～F-8 的修正已在 `b6e986b` 的本檔逐項說明，這裡只列現況（下方「F-1～F-8 的現況」）。
- **對 `b6e986b`（Worker `50c688c9`、來源 `2da46cd`）的兩次審查**，都在 2026-09-29 完成：
  - **Swarm Report `e48d0a96-d3a5-42bb-859f-e0b0707fd9ad`**（重測，15:00–15:12 UTC）：報告 https://github.com/Identity-md/research/blob/main/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad/files/artifacts/report.md 。部署對照 partial（它只用 `source/` 重建出相同的 Worker bundle，並比對四個正式靜態檔）。它重測了 F-1～F-8，另外提出 S-1（= F-1 簽名轉送，仍在）、S-2（= F-8 同 origin 邊界）、W-1～W-3（Info）與 G-1～G-3（Mint 上線前待辦，範圍外）。報告自己說明它不回答「網站安全」這種概括問題。
  - **Swarm Audit `519db624-a82f-4dfe-91b9-1a519d1d3dd1`**（14:54–15:24 UTC；job 頁 https://explorer.imd.fun/jobs/519db624-a82f-4dfe-91b9-1a519d1d3dd1 ，沒有公開的報告檔）：5 個 seat（4 個專項加 1 個 judge）全部 accepted。judge 合併去重後保留 8 項，每項都對 Worker handler（真 migration、SQLite）重現：A-1 Medium、A-2～A-8 Low，全部是可用性或畫面顯示問題。它沒有找到轉移資產（approve、交易）、偽造 session 或偽造所有權的路徑，並同意 F-1 的真簽名轉送與 F-2 的寬鬆合約是 SIWE 本身的界線。它沒有驗證正式部署、Cloudflare 綁定／WAF／上傳處理、真錢包與瀏覽器、正式 RPC、未公開的前端，也沒有重建 Worker；沒有部署對照判定。
- 這兩次審查的結果只屬於 `b6e986b`／Worker `50c688c9`。**本版的變更尚未經任何重新審查**；「我的錢包」裡的審查紀錄也這樣標示。

### 部署經過（團隊的部署紀錄；沒有從 Cloudflare 讀取，也沒有經審查驗證）

| Worker version | 來源 | 部署時間（UTC） | 內容 |
|---|---|---|---|
| `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f` | `2da46cd` | 2026-09-29 05:05 | 兩次審查的對象（Worker bundle `14584fe4…f5e4`） |
| `c89f5915-9511-4d90-893f-6555fe2e086d` | `5398b90` | 2026-09-29 17:25 | Report 的 W-1～W-3、undici 釘版（F-6）、移除舊 statement 的過渡接受、載入速度改善；Worker bundle `bedef2a4…f43f`。**不含** A-1～A-8 |
| `1a0dd495-35e7-4052-ba84-332e787f864d` | `4321bb4` | 2026-09-29 19:54:17–19:54:53 | 在上一版之上加 A-1～A-8；另有前端的「非官方專案」聲明與「為什麼是這種天氣」說明文字（與安全無關）。部署前先匯出備份、再套用 `0004_index_candidates.sql`（約 19:53）。Worker bundle `1018f02a…078c` |
| `6e7e40cd-e6b9-481b-af2b-3f49347ef7cc` | `df8ea90` | 2026-09-30 06:48 上線，09:27 撤回 | 城鎮的視覺重新配置，沒有 migration；Worker bundle 與 `1a0dd495` 相同（`1018f02a…`），前端不同（依部署紀錄，包括 `moves.ts` 的本機搬家清單鍵名與 `market.ts` 的行情畫面位置）。09:27 以 `wrangler rollback` 回到 `1a0dd495`。`df8ea90` 的原始碼**不在**本快照；它的部署證據頁在 `source/docs/security/deploy-evidence/20260930T064805Z-df8ea90.md` |

目前執行的是 `1a0dd495`（團隊說明；本輪沒有用 wrangler 查詢部署狀態）。表中每一版（以及更早的 `f9b68223`）的部署證據頁都在 `source/docs/security/deploy-evidence/`；本快照對正式站的比對見下方「版本對應」與 `DEPLOYMENT_MATCH.md`。

### Audit 519db624 的 8 項（A-1～A-8）

**下表的「做了什麼」與「殘餘風險」都是 IMD 團隊自己的說明，尚未經任何重新審查，reviewer 應自行驗證。** 嚴重度照抄 judge；第一欄括號內是 judge 當時引用的 `b6e986b` 位置（舊行號）。逐項的舊行為、新行為、防止的濫用、殘餘、修改的檔案與測試：`source/docs/security/AUDIT_REMEDIATION_STATUS.md`「Swarm audit 519db624」一節（公開版，遮蔽見 `REDACTIONS.md` 第 1.4 節）。8 項都隨 `1a0dd495` 上線（團隊的部署紀錄）。下表的行號都指本快照 `source/`。

| 發現（審查嚴重度） | 做了什麼（團隊說明） | 殘餘風險（仍存在） | 在哪裡驗證 |
|---|---|---|---|
| **A-1** 每分鐘兩次垃圾查核可讓指定的智慧錢包一直無法登入（Medium，可用性；F-3 的殘留；舊 `server/auth.ts:124`） | 一個合約地址每分鐘 2 次共用查核（跨所有網段、先於簽章結果扣）用完後，challenge 所屬的網段仍可在自己每分鐘 3 次的份額內、每分鐘對該地址做 1 次查核（`CLAIM_LANE`），記在自己的每據點 limiter 鍵 `chain:erc1271:lane`（每分鐘 20 次），不佔 `chain:erc1271`／`chain:erc1271:known`，所以這兩個鍵看到的仍是每地址每分鐘最多 2 次 | **改善，不是修復**：來自持有人自己 /24（或 /48）的垃圾查核仍可擋住它（log `reason:address`）；至少 9 個 /24 每分鐘瞄準至少 3 個地址，可在一個據點讓 `chain:erc1271:lane` 保持關閉（`budget_lane`）；回訪的智慧錢包也一樣。這些門檻是本機精確 limiter 的結果；正式環境的 limiter 是每據點、最終一致的，這些數字在邊緣不一定成立 | `source/server/auth.ts:149-156`（`CLAIM_LANE`）、`:190`（`CHAIN_KEYS`）、`:397-406`（先 `CLAIM_CONTRACT`、再 `CLAIM_LANE`，各自的 budget 鍵）、`:307`、`:66-81`（成本說明）；`source/wrangler.jsonc:50-55`（註解）；測試 `source/tests/auth.test.mjs:498`、`:542` |
| **A-2** 索引查詢被拒時刪掉已存的候選清單，剛買的席位從家裡消失（Low，可用性；舊 `server/ownership.ts:138`） | ① 快取重新載入失敗時放回上一個成功值（保留它原本的時間），不再刪掉；② 每次成功的 NFT 索引讀取，在回應之後把答案（最多 256 個 id，依 A-4 排序）寫進 D1 新表 `index_candidates`（migration 0004，只新增一個表），不會蓋掉較新的答案；答案沒有席位時刪除該列，所以拋棄式地址不寫任何東西；答案的時間是索引讀取開始時，不是請求開始時；③ 只有索引被拒或失敗時才讀它，取本 isolate 與 D1 中較新的一份當候選，仍由 `ownerOf` 證明（`recheck:'limited'`）；索引失敗又沒有任何保存的答案時仍回 503；④ cron 刪除 8 天前讀取的答案。所有權證明本身不會重用超過 30 秒 | 在 IMD 名冊與索引最後一次列出之後才買的席位，要等之後的查核才出現；答案保存 8 天，超過 8 天沒回來的持有人在索引被拒時只剩名冊；另一個 instance 要等 D1 寫入完成才看得到新答案。migration 0004 必須先於程式套用（團隊說明：2026-09-29 約 19:53 UTC 先匯出備份再套用；本輪沒有查詢正式資料庫）；程式先於 migration 部署時，退回每個 instance 自己的答案，讀取與 cron 都不會失敗（有測試） | `source/server/ownership.ts:174-190`（快取，`:186` 放回舊值）、`:141-173`（`KEEP_INDEX`／`DROP_INDEX`／`READ_INDEX`、`keepIndex`、`keptIndex`）、`:217-230`（被拒／失敗時的備援，`:228` 沒有保存答案時 503）、`:220`；`source/migrations/0004_index_candidates.sql:12`；`source/server/presence.ts:37-43,52`；`source/server/auth.ts:520`；測試 `source/tests/ownership.test.mjs:130`、`:155`、`:206`、`:236`，`source/tests/presence.test.mjs:67` |
| **A-3** 較舊的「我的家」回應可在較新的結果之後恢復屋主模式（Low；舊 `src/world/auth.ts:161`） | `refreshHome` 在每一個會改變狀態的 await 之後（含 JSON 本文與錯誤本文）都同時檢查 `gen` 與 `homeGen`；換帳號與兩種登出都會增加 `gen` | 團隊不知道還有殘餘。屋主模式仍是定期重新確認，不是即時（見 W-1） | `source/src/world/auth.ts:189-210`（`stale()` 在 `:197`，檢查在 `:200`、`:201`、`:204`、`:209`）；測試 `source/tests/wallet-client.test.mjs:562` |
| **A-4** 候選超過 256 個時，唯一會計入的席位可能沒被檢查（Low，可用性；舊 `server/ownership.ts:174`） | 截斷之前先排序：名冊顯示 agent 在線的席位、其他已註冊的席位、其餘，各依 id；被截斷的清單在 `/api/me/home` 回 `recheck:'partial'`，不當成完整答案；NFT 索引讀到 5 頁上限還有剩時也是 `partial`；「我的錢包」的說明寫出這兩種原因。成本仍最多 256 次 `ownerOf`（兩次 `eth_call`） | 超過上限的席位不會列出；可能計入的席位超過 256 個時，也不會全部計入 | `source/server/ownership.ts:136-138`（`rank`）、`:212`、`:232-233`、`:93-95`、`:115-120`、`:261-262`；`source/src/world/walletView.ts:27-33`；測試 `source/tests/ownership.test.mjs:353`、`:387`，`source/tests/wallet-client.test.mjs:672` |
| **A-5** 慢速上傳的請求本文把合約查核記到較早的分鐘（Low，可用性；舊 `server/auth.ts:431`） | challenge 與 verify 在本文讀完之後才讀時鐘；合約查核在 `eth_getCode` 之後再讀一次，最後的 consume 再讀一次。在 challenge 的 5 分鐘之後才完成的 verify 回 410，不做鏈上讀取 | 每 IP 的 `AUTH_LIMITER` 在請求一開始（讀本文之前）就檢查，所以單一 IP 可以把幾分鐘份的慢請求一起完成；它們的成本仍受 D1 份額限制（以到達時間計）。程式沒有另設本文讀取期限（本文上限 2,048 bytes）；Cloudflare 對慢速上傳的處理沒有檢查 | `source/server/auth.ts:243-245`（`clock`）、`:340`、`:366`、`:374`、`:398`、`:415`；限流在 `:495-496`；本文上限 `:26`、`:247-254`；測試 `source/tests/auth.test.mjs:460` |
| **A-6** 同網段的鄰居可用掉某位玩家的登入名額（Low，可用性；F-5 的殘留；舊 `server/auth.ts:106`） | 取消每 (address, network) 每分鐘 5 個 challenge 的冷卻（`WALLET_CHALLENGE_BUDGET` 已刪除）：不再有 challenge 因為它的地址被拒；同一地址被許多網段要求時仍寫 `auth_surge` 紀錄（每分鐘第 20 個起每個都寫） | **部分修正**：同一個 /24（或 /48）內兩個 IP 就能用完該網段每分鐘 30 個 challenge，網段內其他玩家要等這一分鐘（只影響新登入，既有 session 不受影響）；D1 的預算只看網段鍵（依設計不存完整 IP），分不出同一 /24 裡的主機 | `source/server/auth.ts:31-34`、`:129-131`（`INSERT_CHALLENGE` 已沒有每地址條件）、`:360-362`；`TESTS/siwe-sample/siwe-sample-output.txt`（同地址同網段 6 個 challenge 全部 200）；測試 `source/tests/auth.test.mjs:565`、`:376` |
| **A-7** 約 20 個網段可持續佔滿全站 challenge 上限，讓所有新登入失敗（Low，可用性；舊 `server/auth.ts:108`） | 全站每 6 秒 60 個 challenge 中，保留 20 個（`FRESH_NETWORK_RESERVE`）給最近一分鐘沒發過 challenge 的網段；其他網段共用 40 個。上限本身不變（每分鐘 600） | **改善，不是修復**：14 個 /24 滿額，再加上每 6 秒 20 個（約每分鐘 200 個）各發一次、算準時機的其他網段（至少 214 個網段、220 個 IP），仍可在攻擊期間讓新網段拿不到第一個 challenge；13 個 /24、或每 6 秒 19 個網段則不行（兩者都有測試）。已發過的網段共用的 40 個可被 14 個 /24 佔滿，所以攻擊期間已拿到第一個 challenge 的玩家要等一分鐘才有第二個。IPv6 /48 比 IPv4 /24 便宜。瀏覽與既有 session 不受影響 | `source/server/auth.ts:118`、`:121-124`、`:125-131`（`?13` 與 `EXISTS`）、`:351-352`、`:45-53`；測試 `source/tests/auth.test.mjs:585`、`:337` |
| **A-8** 鏈上查核因限流沒做成，畫面卻寫「鏈上核實：這個錢包目前沒有 IMD 席位」（Low；舊 `src/world/WalletPanel.tsx:132`） | 沒有計入任何席位、而且不完整（`limited`，或 A-4 的 `partial`）的讀取，狀態是 `ownershipUnavailable` 而不是 `signedInNoHouse`；面板說「這次鏈上查核沒能完成（不是沒有持有）…請稍後重試」，空清單下寫「尚未在鏈上核實到席位：這次查核沒能完成」。文字集中在 `walletView.ts`，面板只負責呈現；測試改為用 react-dom/server 實際渲染面板（`source/tests/fixtures/wallet-panel.mjs`） | 團隊不知道還有殘餘 | `source/src/world/auth.ts:54-65`（`:61`）；`source/src/world/walletView.ts:34-55`；`source/src/world/WalletPanel.tsx:82`、`:122`、`:132`；測試 `source/tests/wallet-client.test.mjs:609` |

### Report e48d0a96 的發現（S-1、S-2、W-1～W-3、G-1～G-3）

同樣是**團隊自己的說明，尚未經重新審查**。W-1～W-3 隨 `c89f5915` 上線，`1a0dd495` 延續（團隊的部署紀錄）。

| 發現（報告嚴重度） | 做了什麼（團隊說明） | 殘餘風險（仍存在） | 在哪裡驗證 |
|---|---|---|---|
| **S-1** F-1 的簽名轉送仍在（Medium；對目前 World 為 Low） | 沒有能在 World 端修掉的方法（SIWE 本身的界線，Audit 也同意）。F-1 的措施維持：頁面在錢包看到訊息前逐行檢查、簽名視窗開著時顯示從訊息讀回的摘要與「只在網址列是 imdember.com 時簽名」、statement 寫明不授權資產轉移、代幣或 NFT approval、交易。上一版為了跨部署而接受舊 statement 的過渡（`SIWE_PREVIOUS_STATEMENTS`）已在 `c89f5915` 移除，伺服器只接受目前的 statement | **未解決**：釣魚頁面不執行本頁的程式，仍可要求玩家簽一則真實的 challenge，轉送後取得 7 天 session；防線是錢包的 EIP-4361 domain／請求來源檢查與玩家本人。頁面檢查不防注入本 origin 的腳本。目前 session 只給唯讀視圖與本機效果；日後 Mint 若沿用 session，見 G-1 | `source/src/world/siwe.ts:5`、`:16-24`；`source/src/world/auth.ts:241-247`；`source/src/world/walletView.ts:68-80`；`source/server/auth.ts:168-172`、`:388`；測試 `source/tests/auth.test.mjs:191`；`SIWE.md` 第 1、7、8 節 |
| **S-2** F-8 同 origin 邊界不變（Info，shared-boundary） | World 沒有要改的地方；把日後同 origin 頁面自己的審查至少要涵蓋的項目寫成清單（`MINT_BOUNDARY.md` 的 S-2 清單：Mint 專屬授權、合約地址、chain ID、交易參數、approvals、Permit／Permit2、交易模擬、收款人、數量、replay、智慧合約錢包、session 重用、同 origin cookie、CSP 變更） | **未解決**（架構邊界）：日後同 origin 的頁面會與 World 共用 CSP、`__Host-` cookie、localStorage 與錢包的「已連線網站」，需要自己的審查 | `source/docs/security/MINT_BOUNDARY.md:42-62`；`source/server/auth.ts:22`、`:230`；`source/public/_headers:18-24`；`SCOPE.md` 第 3 節 |
| **W-1** 過期的 session 仍可在本機搬家（Info） | `statusOf`／`ownerAddress`、`moveGate`、`commitMove` 都用本機時鐘比對 session 的 `expiresAt`；「進入我的家」在按下的那一刻再檢查（`enterAtPress`）；用戶端在到期時用計時器自己結束 session；分頁重新顯示時結束已到期的 session，並（最多每 15 秒一次）重讀伺服器 | 在別的裝置按「登出所有裝置」，本頁要到下一次讀取才知道；屋主模式是定期重新確認（伺服器 `ownerOf` 快取最多 30 秒；分頁可見時每 60 秒、focus、打開「我的錢包」、分頁重新顯示時重查），隱藏的分頁在重新顯示前維持原狀。只影響本機畫面與 localStorage，沒有伺服器寫入 | `source/src/world/auth.ts:54-67`（`:57`）、`:110-135`；`source/src/world/moves.ts:42-51`、`:62-70`；`source/src/world/homeEntry.ts:11-18`、`:26-30`；測試 `source/tests/wallet-client.test.mjs:472`、`:506`，`source/tests/home-entry.test.mjs:110` |
| **W-2** 拒絕 log 被說成「不含 IP」（Info） | 只改說法，log 內容不變：每行帶由 IP 推出的網段鍵（IPv4 /24、IPv6 /48，沒有 IP 時 `net:unknown`），surge 行另帶地址前 6 個字元；不含完整 IP、完整地址、cookie、token、簽章、訊息或 nonce | 網段鍵仍是由 IP 推出的資訊（依設計保留，供監控）。Workers Logs 取樣率 0.2 | `source/server/auth.ts:41-44`、`:465-470`；`source/worker/app.ts:74-78`；測試 `source/tests/auth.test.mjs:436`；`ROUTES.md` 第 5 節 |
| **W-3** 已知 ERC-1271 合約的 JSON-RPC 錯誤被報成壞簽章（Info） | 只有 revert（EIP-1474 code 3，或 -32000 "execution reverted"）、合約造成的 EVM 中止（-32000 的 out of gas、invalid opcode 等）或不是 magic word 的回答才是 401；其他 JSON-RPC 錯誤、傳輸／HTTP 失敗或格式錯誤的回覆是 503 `VERIFY_UNAVAILABLE`。兩種情況 challenge 都作廢、不產生 session；頁面對 503 顯示「暫時無法驗證」 | 分類依節點回傳的 code／message；沒有列出的 -32000 訊息算成節點失敗（503）。兩邊都不會放行 | `source/server/auth.ts:279-284`、`:311`、`:316-323`；`source/server/ownership.ts:36-51`；測試 `source/tests/auth.test.mjs:866`，`source/tests/wallet-client.test.mjs:530` |
| **G-1～G-3** Mint 上線前待辦（範圍外） | 寫成 `source/docs/security/MINT_BOUNDARY.md`：G-1 World 的 session 永遠不是 Mint 授權；G-2 SIWE 轉送、寬鬆 ERC-1271 合約與資格規則要為 Mint 重新評估；G-3 Mint 帶來的 CSP、cookie／storage、錢包方法與交易流程變更要另外審查。`AUDIT_REMEDIATION_STATUS.md` 與 `DESIGN_W1_v001.md` 都連到它 | **未處理**（範圍外）：這頁只列問題、不回答；沒有任何 Mint 程式被審查；Mint 需要自己的專項審查 | `source/docs/security/MINT_BOUNDARY.md:19-24`（G-1）、`:26-35`（G-2）、`:37-40`（G-3）；測試 `source/tests/review-record.test.mjs:207` |

### F-1～F-8（第一次審查 4bd31cfb）的現況

各項的修正內容見 `b6e986b` 的本檔（`git show b6e986b:README.md`）與 `AUDIT_REMEDIATION_STATUS.md` 的 F-1～F-8 各節。Report e48d0a96 的判定照報告摘要；「現況」是團隊說明。

| 發現 | Report e48d0a96 的判定（摘要） | 現況（團隊說明） |
|---|---|---|
| F-1 | 部分改善；轉送未修復 | 同 S-1：**仍未解決** |
| F-2 | 欄位與 fail-closed 修復；寬鬆合約仍可代表自己登入；RPC 錯誤分類見 W-3 | 欄位與拒絕行為不變（`source/server/auth.ts:274-315`、`:420-421`）。**寬鬆 ERC-1271 合約仍未解決**：合約自己決定誰能代表它簽名，持有席位的寬鬆合約可讓任何人取得該席位的屋主視圖；`CONTRACT` 標記只讓這類 session 在 D1 看得見 |
| F-3 | 舊的垃圾簽章路徑已修復；殘餘如述，門檻只是本機結果，在邊緣不一定成立 | 單一地址的部分由 A-1 改善；其餘殘餘不變，仍部分未解決 |
| F-4 | 修復；其他裝置到下一次請求才得知 | 不變（`source/server/auth.ts:446-460`） |
| F-5 | 分層已實作；全站殘餘如述；log 說法不精確（W-2） | 由 A-6、A-7 改變；仍部分未解決 |
| F-6 | 部分：重測當天 `npm audit` 3 moderate（undici，經 wrangler → miniflare），`--omit=dev` 0 | `package.json` 的 `overrides.undici` 固定為 7.29.1（`source/package.json:19-22`），`source/tests/dependencies.test.mjs:10`、`:19` 檢查 lockfile；本快照 2026-09-30T11:56:43Z 重跑，`npm audit` 與 `npm audit --omit=dev` 都是 0（`TESTS/npm-audit-*.json`、`DEPENDENCIES.md` 第 3 節）。新公告隨時會出現，建置機的供應鏈風險仍在 |
| F-7 | (a) 修復；(b)–(e) 殘餘如述 | 不變：(b) 跨站頂層導覽可觸發 `/api/me/home?fresh=1`（`source/server/auth.ts:513-521`）；(c) `style-src 'unsafe-inline'`（`source/public/_headers:24`）；(d) loopback 例外只看請求 URL（`source/worker/app.ts:89-96`、`source/server/auth.ts:212-220`）；(e) 錢包鎖定時保留 session（`source/src/world/auth.ts:283-291`） |
| F-8 | 殘餘如述 | 同 S-2：**仍未解決** |

### 同一段時間的其他變更（都不改變伺服器授權）

- **載入速度（隨 `c89f5915` 上線）**：Worker 對 `/api/world/*` 公開資料的讀取改為 stale-while-revalidate，並在每個 Cloudflare 據點的 Cache API 放一份共用副本；副本的鍵在 `/api/world/_shared/v1/…` 之下，只由伺服器端讀取，用戶端請求這個路徑是 404（`source/worker/app.ts:40-58`、`:114-115`、`source/server/gateway.ts`）。前端在 React 掛載前先開始讀取（`source/src/main.tsx:10-14`）；世界的模型與圖檔另外以內容雜湊檔名發佈（`publicHashes.ts`／`publicUrl.ts`、`vite.config.ts`，`/assets/*` 快取一週：`source/public/_headers:26-36`）；`index.html` 加上只有 inline CSS、沒有 script 的載入畫面。沒有新的 API 路由，沒有新的錢包呼叫。
- **非官方聲明與天氣說明（隨 `1a0dd495` 上線）**：`index.html` 的 description（`source/index.html:7`）與前端加上「獨立社群專案，Identity.md 不經營也不背書」的聲明；「為什麼是這種天氣」的說明文字。這兩段 UI 的程式（`unofficial.ts`、`weatherWhy.ts`）不公開。
- 「我的錢包」底部的審查紀錄（`reviewRecord.ts`、`auditRecord.ts`）加上兩次重新審查的連結、它們的發現與團隊的修正狀態，並標明兩次重新審查檢查的是 Worker `50c688c9`，不是這個版本；F-6 那一行改為說明 undici 已修補。
- `scripts/deploy-evidence.mjs`：證據頁列出該 commit 的 limiter 鍵（例如 A-1 新增的 `chain:erc1271:lane`）。本版起公開 5 頁部署證據。
- 世界內容（城鎮配置、地標、地形預烘、音樂等）：不公開，只列雜湊。

## 範圍一覽

| 項目 | 內容 |
|---|---|
| 網站 | https://imdember.com/（唯一 origin；`www.imdember.com` 301、`imd.stickember.com` 302 轉到這裡，為較早一輪的觀測，本輪沒有重測） |
| 後端 | 一個 Cloudflare Worker `imd-world`，依設定只由 `/api/auth/*`、`/api/me/*`、`/api/wallet/*`、`/api/world/*` 觸發；Worker 對其他路徑一律轉交 Static Assets（`ROUTES.md` 第 1 節） |
| 錢包方法 | 用戶端仍只呼叫 `eth_accounts`、`eth_requestAccounts`、`personal_sign`（僅 SIWE 登入），只監聽 `accountsChanged`；已在正式主 bundle `index-BFVt9xb_.js` 與房屋內部 chunk `InteriorView-wZGOk4w6.js` 上重新計數，結果與上一輪相同（`WALLET_METHODS.md` 第 3 節） |
| 登入 | SIWE（EIP-4361），訊息由伺服器產生並存在 D1；頁面先逐行檢查才交給錢包（`source/src/world/siwe.ts:16-24`、`source/src/world/auth.ts:241-247`）；伺服器用 viem 驗簽（ECDSA，必要時 ERC-1271），只接受目前的 statement。verify 判定的驗簽失敗都會作廢 challenge；每個 challenge 最多一次 ERC-1271 查核（`SIWE.md`） |
| 登入限制 | L1 每網段（challenge 與 ERC-1271 份額）、L2 每錢包（不因地址拒絕，只記錄 surge；每個合約地址的查核份額，外加 A-1 的每網段 lane）、L3 每 challenge、L4 每據點 Cloudflare limiter、L5 全站閥門（保留 20／60 給最近一分鐘沒發過的網段），外加 zone 的邊緣 WAF 規則；詳表 `ROUTES.md` 第 4 節 |
| 缺少 limiter 綁定 | 正式網址上需要該綁定的路由一律回 503（`LIMITER_UNAVAILABLE`／`limiter_unavailable`），不會變成不限流；只有 loopback 的本機開發維持放行（`chain` 仍拒絕） |
| Session | `__Host-imd_session`（HttpOnly、Secure、SameSite=Lax，7 天絕對期限，不續期，DB 只存 SHA-256）；「登出此裝置」與「登出所有裝置」；用戶端在本機時鐘到期時也結束屋主模式（W-1） |
| 所有權 | 以太坊主網 IMD 席位合約 `ownerOf`（經 Multicall3）；IMD 公開名冊與 Alchemy 索引只當候選，每一次 NFT 索引讀取都先扣 `CHAIN_LIMITER`（`chain:index`）；索引被拒或失敗時，上一次的索引答案（D1 `index_candidates`）也只當候選（A-2） |
| 房屋 | **一個錢包一間房**，大小依計入的席位數；搬家只寫本機 localStorage；「進入我的家」只給屋主自己的房子，不寫伺服器、不呼叫錢包（`OWNERSHIP_AND_HOMES.md`） |
| WebSocket | 沒有（原始碼、重建的 Worker bundle 與正式前端檔案皆無 WebSocket／EventSource） |
| 範圍外 | Genesis Mint 的一切（合約、授權、signer、metadata／IPFS、鑄造用的模型與圖檔）；只有邊界問題寫在 `MINT_BOUNDARY.md` |

詳細範圍與 World/Mint 邊界表：`SCOPE.md`。

## 版本對應

```text
正式 Worker version          1a0dd495-35e7-4052-ba84-332e787f864d
        ↑ 由下面的 4321bb4 建置並部署（npm run deploy：先跑完整測試，再 build 與上傳；在該 commit 的乾淨工作目錄執行；
          deploy record 20260929T195417Z-4321bb4，2026-09-29T19:54:17Z–19:54:53Z，dirty=false，tests "passed"）
IMD Ember World 私人 repo    commit 4321bb4da3826276919ed60ecc2018139dcaeacc（tag v2026.09.30-1a0dd495）
        ‖ 本快照的 source/ 取自其後的 132228cf746cb41cd9e3a5124a5903e9ab2da386（main，2026-09-30）：每個會進入 Worker
        ‖ 或前端 build 的公開檔案都與 4321bb4 相同；4321bb4 之後只改了 docs/security/AUDIT_REMEDIATION_STATUS.md、
        ‖ tests/review-record.test.mjs，並新增兩頁部署證據（4321bb4、df8ea90 的部署）
        ↑ git -c core.autocrlf=false archive 132228c 取出本快照 source/ 的 72 個檔案
          （8 個檔案有遮蔽，只改註解、文件文字、設定值與測試字串，見 REDACTIONS.md；其餘 64 個與 git blob 逐位元組相同）
本快照 repo                   本 commit（父 commit b6e986b；本 commit 的 hash 以本 repo 的 `git log` 為準，檔案無法記載自己所在的 commit）
```

| 項目 | 上一次的審查對象（`b6e986b`） | 本快照 |
|---|---|---|
| 正式 Worker version | `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f` | `1a0dd495-35e7-4052-ba84-332e787f864d` |
| 部署的私人來源 | `2da46cdafcf8ad3fb3571ea0273ecc5d1ab5be1d` | `4321bb4da3826276919ed60ecc2018139dcaeacc`（2026-09-29 19:54:17–19:54:53 UTC 部署） |
| `source/` 取自 | `2da46cd` | `132228cf746cb41cd9e3a5124a5903e9ab2da386`（建置用的檔案與 4321bb4 相同） |
| Worker bundle（`index.js`） | 264,561 bytes，SHA-256 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4` | 274,961 bytes，SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c` |
| D1 migrations | 0001–0003 | 0001–0004 |

`migrations/0004_index_candidates.sql`（只新增一個表）在 2026-09-29 約 19:53 UTC、部署 `1a0dd495` 之前、先匯出備份後已套用到正式 D1；`0003` 在 2026-09-28 約 21:00 UTC 套用（都是團隊端說明；本輪沒有查詢正式資料庫）。

- 正式站前端檔案是公開的，任何人都能下載比對（2026-09-30T11:57:34Z–11:57:51Z，每個 GET 一次、間隔至少 2.5 秒；與部署紀錄及團隊端從 4321bb4 CRLF checkout 重建的結果三方相同）：
  - `https://imdember.com/`（index.html）　SHA-256 `b3ee4f225fd60f7c5118284471cd2f05779c4a110d1d8518113e08b0e97ddab8`（2,634 bytes）
  - `https://imdember.com/assets/index-BFVt9xb_.js`　SHA-256 `ec1f3da36a0141f0308e384284e41cc97f344d7fbed594ede9071994c7ea58d2`（1,383,354 bytes）
  - `https://imdember.com/assets/InteriorView-wZGOk4w6.js`（房屋內部，延遲載入）　SHA-256 `13616a8827bfa406b285833d404d5d4f3e49ca9649dd5d0e9adb11944677cbbd`（93,255 bytes）
  - `https://imdember.com/assets/index-DkZ6U0YC.css`　SHA-256 `d14af57285213037ad12066e17763a2d2c00ad30369563c8eef90c1f8ab26c84`（55,902 bytes）
  - `GET /api/auth/session`：`{"signedIn":false}`、`no-store`、API 的 CSP `default-src 'none'; frame-ancestors 'none'`、`Cross-Origin-Resource-Policy: same-origin`、nosniff、HSTS，沒有 CORS 標頭。`/` 帶 HSTS（`max-age=31536000; includeSubDomains`）、CSP（`default-src 'self'; script-src 'self'; … frame-ancestors 'none'`）、Permissions-Policy、Referrer-Policy、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`。
- 其餘 96 個靜態檔本輪沒有下載，只與部署紀錄比對（`manifests/compare.txt`：VERIFIED 4、RECORD-MATCH 95、NOT-SERVED 1（`_headers`））。與 `2da46cd` 的部署紀錄相比：42 個不變、25 個改變、33 個新增、3 個移除（舊的主 JS、CSS 與房屋內部 chunk）。
- 這些 bundle 包含不公開的前端程式（3D、房屋擺放與內部、`WorldApp.tsx` 的接線），所以 XSS／供應鏈與錢包接線的檢查可以直接對正式檔案做。
- 後端：reviewer 可以**只用本快照 `source/`** 重建實際上傳的 Worker bundle（`wrangler deploy --dry-run --outdir`），SHA-256 應為 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`（274,961 bytes；本快照 2026-09-30T11:56:14Z 實測，`TESTS/worker-dry-run-output.txt`；步驟見 `DEPLOYMENT_MATCH.md` 第 3 節）。Cloudflare 上實際執行的程式與機密設定仍無法從外部確認（`DEPLOYMENT_MATCH.md` 第 2 節）。
- 2026-09-30 06:48–09:27 UTC 之間執行的是 `6e7e40cd`（上方「部署經過」）：Worker bundle 相同，前端不同；那段時間的前端檔案不在本輪比對之內。

## 如何測試

環境：Node **v24.19.0**（`source/.nvmrc`；`package.json` engines `>=24 <25`）、npm **11.17.0**。不需要任何金鑰或 `.env`。

`tests/deploy.test.mjs` 與 `tests/deploy-evidence.test.mjs` 會呼叫 `git`，而且假設 `source/` 就是 git repo 的根目錄（它們讀 `git show HEAD:wrangler.jsonc` 與 `HEAD:migrations/…`）。所以請把 `source/` 複製成一個獨立的 git repo 再測：

```sh
cp -r source ../imd-src && cd ../imd-src          # 或任何暫存目錄
git init -q && git add -A && git -c user.name=r -c user.email=r commit -qm snapshot
npm ci
# 兩個被保留模組的測試用替身（不含房屋幾何，見 TESTS/stubs/）：
cp <本 repo>/TESTS/stubs/households.ts src/world/households.ts
cp <本 repo>/TESTS/stubs/layout.ts src/world/layout.ts
npm test                                          # = node --test tests/*.test.mjs
node --test --test-name-pattern="group 5" tests/home-entry.test.mjs   # 「進入我的家」的授權測試
node --test --test-name-pattern="A-[1-8]:" tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/wallet-client.test.mjs
rm src/world/households.ts src/world/layout.ts
```

- 本快照在 2026-09-30T11:56:27Z 執行：加上替身時 **171 項中 167 項通過**，4 項失敗：三項**因為被保留的程式**（`home-entry.test.mjs` 的兩項房屋門口幾何測試「the door…」「TEST-1: the render rules…」需要被保留的 `HOUSE_FOOTPRINT`／`lotPoint`，替身故意不提供；一項 `?interior=` 預覽測試「group 8…」需要被保留的 `src/world/interior/mockSeats.ts`），一項**因為團隊的 git 歷史**（`deploy-evidence.test.mjs` 的「deploy evidence from a real deploy record…」在 `source/tests/deploy-evidence.test.mjs:52` 執行 `git rev-parse 3f661eb`，那是私人 repo 的 commit（Report 修正），用來比較 A-1 前後的 limiter 鍵；團隊的 checkout 中這項通過）。名稱以 A-1～A-8、W-1～W-3 或 F- 開頭的測試全部通過。不加替身時 96 項中 92 項通過：`ownership.test.mjs`、`home-entry.test.mjs`、`wallet-client.test.mjs` 三個檔案無法載入 `households.ts`，另加同一項 deploy-evidence 測試。「進入我的家」的三項授權測試（`group 5`）全部通過（11:56:37Z）。原始輸出：`TESTS/`。
- 這些是本機 mock／unit 測試，沒有瀏覽器測試，也沒有真實錢包測試。
- 團隊端（不在本快照）：132228c 的完整原始碼封存（79 個測試檔，含被保留的檔案）在 2026-09-30T11:57:57Z–11:58:25Z 執行 `npm test`：726 項中 725 項通過，1 項失敗就是上述需要 git 歷史的 deploy-evidence 測試（封存沒有 git 歷史）；在 132228c 的私人 checkout 中 `node --test tests/deploy-evidence.test.mjs` 2 項全部通過。原始 log 不公開（含被保留的測試名稱與本機路徑），它的 SHA-256 是 `be8235b7cc663ea153e6d29256a6129bde3b43ca8f8667ad9e2bd50be60277d2`。部署紀錄的 manifest 記載部署前的完整測試為 "passed"（`TESTS/README.md`）。
- `npm run build`（前端）在本快照**無法完成**：`tsc --noEmit` 的錯誤全部來自被保留的檔案（本版多了 `src/main.tsx` 的早期讀取與 `vite.config.ts` 的地形預烘所 import 的檔案；`TESTS/tsc-noEmit-output.txt`，對應表見 `SCOPE.md` 第 6.3 節）。Worker 的建置不需要這些檔案。

## 規格項目在哪裡

持有人的審查規格（v1.1，World-only）與團隊內部的修正計畫本身**不隨本 repo 公開**。程式註解與測試裡提到的「remediation … §x」、以及用工具名稱稱呼的修正計畫與交叉檢查（例如「… plan §14」「… crosscheck review」），都是團隊內部修正計畫的章節；它們的公開摘要是 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`。規格要求的材料清單與本快照位置如下：

| 規格材料 | 本快照位置 |
|---|---|
| 範圍說明 | `SCOPE.md`、`ROUTES.md` |
| World／Mint 邊界 | `SCOPE.md` 第 3 節、`source/docs/security/MINT_BOUNDARY.md` |
| 與規格的差異（房屋） | `SCOPE.md` 第 4 節 |
| 前端（Connect、SIWE、頁面端檢查、session 恢復與本機到期、換帳號／換鏈、錯誤處理、Provider 呼叫、第三方 script、動態模組） | `WALLET_METHODS.md`、`SIWE.md` 第 7 節、`DEPENDENCIES.md`；原始碼 `source/src/world/{auth,siwe,wallet,WalletPanel,walletView,moves,homeEntry}.ts(x)` |
| 後端（challenge、verify、session、logout、logout-all、ownerOf、房屋 API、WebSocket、middleware、速率與預算） | `ROUTES.md`、`SIWE.md`、`OWNERSHIP_AND_HOMES.md`；原始碼 `source/server/`、`source/worker/` |
| 資料層（去敏 schema、nonce 一次性、session 撤銷／到期、快取、清理） | `DATA_SCHEMA.md`、`source/migrations/0001`～`0004` |
| 建置（lock 檔、Node／npm 版本、指令） | 本檔、`DEPENDENCIES.md`、`source/package-lock.json` |
| 測試（來源與原始輸出，區分 mock／瀏覽器／實際錢包） | `TESTS/` |
| 部署對照 | `DEPLOYMENT_MATCH.md`、`manifests/`、`source/docs/security/deploy-evidence/` |
| 原始登入訊息 | `SIWE.md` 第 1 節、`TESTS/siwe-sample/`（合成金鑰，無簽章） |
| 修正狀態 | 本檔上一節、`source/docs/security/AUDIT_REMEDIATION_STATUS.md` |
| 檔案清單 | `SCOPE.md` 第 6 節、`SHA256SUMS`、`manifests/withheld-source.txt`、`REDACTIONS.md`、`PUBLIC_CONTENT_LIST.md` |

## 證據來源分欄

- **可自行驗證**：`source/` 原始碼與 `npm test`；從 `source/` 重建的 Worker bundle 雜湊；正式站公開檔案的 SHA-256 與字串計數；公開回應標頭。
- **僅團隊端證據**：部署紀錄（manifest、SHA256SUMS、上傳紀錄本身）與由它產生的 5 頁部署證據；哪個 Worker version 在什麼時間上線、`6e7e40cd` 的上線與撤回；正式 D1 已套用 0003 與 0004 的說明；持有人 dashboard 顯示的內容（Worker 清單、綁定、secret 名稱、WAF 規則與它的 rule id）與團隊實測；被保留檔案的內容與對它們做的搜尋；完整原始碼的測試與前端重建。reviewer 無法獨立取得，只能看到雜湊與結構化欄位。
- **修正狀態**：全部是 IMD 團隊自己的說明，尚未經重新審查。

文件引用團隊端證據時會標「團隊端」或「團隊說明」。

## 檔案完整性

- 根目錄的 `.gitattributes`（`* -text`）讓 git 不轉換任何檔案的換行，所以在 Windows（`core.autocrlf=true`）上 clone 也能得到相同位元組。
- `SHA256SUMS`（`sha256sum` 格式、相對路徑）涵蓋本 repo 除了它自己以外的全部檔案：`sha256sum -c SHA256SUMS`。
- `source/` 中除 `REDACTIONS.md` 第 1 節列出的 8 個遮蔽檔案外的 64 個檔案，`git hash-object --no-filters` 的結果等於 `manifests/published-source-gitblobs.txt` 列出的 commit 132228c blob id。8 個遮蔽檔案中有 3 個的原始 blob id 不公開（`ORIGINAL-BLOB-WITHHELD`：遮蔽的內容很短、可以猜，見 `REDACTIONS.md` 第 1 節）。

## 注意

- `source/docs/wallet-login/DESIGN_W1_v001.md` 的正文有些段落寫於 hardening 之前（例如舊的搬家簽章 `signMove`）；檔末的 Amendments 與第 15 節記錄了現況。**以程式碼為準。**
- 測試名稱也可能沿用舊稱（例如被保留的 `households.test.mjs` 有一項叫「a signed move …」）；搬家目前不簽章（`source/src/world/moves.ts:1-5`）。
- `AUDIT_REMEDIATION_STATUS.md` 與部署證據頁中「deployed in `1a0dd495`」之類的部署事實，都是團隊的部署紀錄，不是審查結果。
- 本快照不含任何私鑰、助記詞、`.env`、`.dev.vars`、API／RPC key、session cookie、Bearer token 或有效的正式簽章（`REDACTIONS.md`）。
