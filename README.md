# IMD Ember World：錢包登入審查快照（World-only）

> Copyright (c) 2026 tungweb3. All rights reserved. Published solely so reviewers can read it for the IMD Ember World
> security review; no licence to copy, modify, redistribute or use is granted.（全文見 `LICENSE`）

## 這是什麼

這是 **審查用的去敏快照**，給外部 reviewer（例如 Swarm／Identity.md 上的 agent）檢查 https://imdember.com 目前正式上線的 World。IMD Ember World 是社群自行推動的非官方專案，Identity.md 沒有經營或背書它（`source/index.html:7`）。

它**不是**審查報告或證書，也不替任何安全結論背書。裡面的說明文件是專案方對程式現況的描述和已執行的本機測試紀錄；審查結論要由 reviewer 自己重新檢查原始碼與證據後做出。

本輪請 reviewer 回答一個問題（本 repo 不替這個問題下結論）：

**玩家在 imdember.com 連上自己的錢包並簽名登入，安全嗎？**

具體包括：錢包被要求簽什麼、頁面與伺服器怎麼檢查、session／cookie／Origin／CSRF／登出（含「登出所有裝置」與 session 結束原因的顯示）、登入的分層速率與預算限制（含 IPv6 的 /48 與其中 /64 的分層份額）、屋主功能（含「進入我的家」）背後的 NFT 所有權查核（含候選上限的排序、索引查詢被拒時的候選來源與每網段的探索 lane），以及阻止注入腳本觸發錢包提示的標頭、CSP 與依賴。

本 repo 有四個 commit：

| commit | 內容 |
|---|---|
| `c2a8c33`（第一個，已公開，未改動） | 第一次送審版本：來源 `0def8cb`、正式 Worker `beac62be`。Swarm job `4bd31cfb-1151-497f-9b27-40e668dea372` 審查的就是它 |
| `b6e986b`（第二個，已公開，未改動） | 來源 `2da46cd`、正式 Worker `50c688c9`。Swarm Report `e48d0a96`（重測）與 Swarm Audit `519db624` 審查的就是它 |
| `ae1d41a`（第三個，已公開，未改動） | 上一次的審查對象：來源 `4321bb4`、正式 Worker `1a0dd495`。Swarm Audit `8c3aea2e` 審查的就是它 |
| 本 commit（`ae1d41a` 之後的唯一一個 commit） | 目前正式版本：來源 `2e4e830b367f651e3c880587c1a4b465d1bfcd91`、正式 Worker `bbf24001-7eec-4f93-b312-a22e299ab275`。本檔與其他文件都描述這個版本 |

依持有人的決定，`source/` 只公開判斷「連錢包、簽名登入與屋主權限是否安全」所需的程式（78 個檔案，清單與每個檔案收錄的理由見 `SCOPE.md` 第 6 節）：

- **整個伺服器端都公開**：Worker 進入點、`server/` 全部檔案、五個 D1 migration（本版新增 `0005_lanes_and_subnets.sql`），以及 Worker 在執行期 import 的每個 `src/world/` 模組（與上一版相同的 8 個；Worker 的 import 範圍仍是同樣 16 個專案檔案）。reviewer 可以只用本快照重建實際上傳的 Worker bundle，並比對 SHA-256（`DEPLOYMENT_MATCH.md` 第 3 節）。
- **用戶端只公開錢包／登入與屋主權限需要的檔案**：登入狀態機 `auth.ts`、頁面端 SIWE 檢查 `siwe.ts`、EIP-6963 錢包選擇 `wallet.ts`、「我的錢包」面板 `WalletPanel.tsx`／`walletView.ts`、審查紀錄 `reviewRecord.ts`／`auditRecord.ts`、搬家閘門 `moves.ts`、「進入我的家」的閘門 `homeEntry.ts`；另外公開 `publicHashes.ts`／`publicUrl.ts`（公開靜態檔的雜湊檔名，與登入無關；`vite.config.ts` 與 `tests/headers.test.mjs` 會載入它們）。本版沒有新增公開的用戶端檔案：N-1、N-2、N-7 的修正都在已公開的 `auth.ts`、`walletView.ts`、`WalletPanel.tsx` 裡。
- **文件**：公開版修正狀態 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`、`source/docs/security/MINT_BOUNDARY.md`（日後 Mint 頁面必須自己審查的邊界問題；不含也不描述任何 Mint 程式），以及 10 頁部署證據 `source/docs/security/deploy-evidence/*.md`（本版新增 5 頁；只含從團隊部署紀錄取出的結構化欄位與團隊手填的部分：已套用的 migration、WAF rule id、`1a0ba21` 與 `2e4e830` 兩頁的部署後實測，以及 `2da46cd`、`5398b90` 兩頁事後產生時附的說明；沒有 log 文字）。
- **不公開**：3D 世界、房屋內部的繪製（`src/world/interior/*`）、地形、模型、美術、音樂、新手引導、城鎮的地標與纜車等世界內容（含這段期間上線的纜車、平靜天氣開關與世界資料讀取狀態的顯示）、房屋的分配與擺放規則（`households.ts`、`layout.ts`、`collision.ts`）、主畫面接線 `WorldApp.tsx`、世界資料的讀取 `bridge.ts`。每個不公開的檔案（504 個）都列在 `manifests/withheld-source.txt`（SHA-256）與 `manifests/withheld-source-gitblobs.txt`（git blob id）。這些程式都已編譯進公開的正式前端 bundle，可以直接對 bundle 檢查（`SCOPE.md` 第 6.3 節）。

**Genesis Mint 不在本次範圍。** 正式 World 的原始碼、前端 bundle 與 Worker bundle 裡都沒有 Mint 程式、路由、合約、signer 或 UI；Mint 會在上線前另外審查。持有人先前已說明日後的 Mint 頁面會在同一個 origin（`imdember.com`）並使用本站的 SIWE 登入狀態，所以本輪檢視的 session／cookie／Origin／CSP 設計也是它會繼承的基礎；Report e48d0a96 提出的 G-1～G-3 與 S-2 清單寫在 `source/docs/security/MINT_BOUNDARY.md`（`SCOPE.md` 第 3 節）。本版沒有改動這一頁。

## 自送審版本以來的變更（ae1d41a／Worker 1a0dd495 → 本 commit／Worker bbf24001）

### 審查紀錄

- **第一次審查**：Swarm job `4bd31cfb`（2026-09-28，對象 `c2a8c33`／Worker `beac62be`），報告 https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md 。F-1 Medium（shared-boundary）、F-2～F-5 Low、F-6～F-8 Info；部署對照 partial。
- **對 `b6e986b`（Worker `50c688c9`）的兩次審查**（2026-09-29）：Swarm Report `e48d0a96-d3a5-42bb-859f-e0b0707fd9ad`（重測，部署對照 partial；S-1、S-2、W-1～W-3 與範圍外的 G-1～G-3），報告 https://github.com/Identity-md/research/blob/main/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad/files/artifacts/report.md ；Swarm Audit `519db624-a82f-4dfe-91b9-1a519d1d3dd1`（A-1 Medium、A-2～A-8 Low，沒有部署對照判定），job 頁 https://explorer.imd.fun/jobs/519db624-a82f-4dfe-91b9-1a519d1d3dd1 。兩者的內容與修正已在 `ae1d41a` 的本檔逐項說明（`git show ae1d41a:README.md`），這裡只列現況（下方「先前發現的現況」）。
- **對 `ae1d41a`（Worker `1a0dd495`、來源 `4321bb4`）的審查：Swarm Audit `8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b`**，job 頁 https://explorer.imd.fun/jobs/8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b ，報告 https://github.com/Identity-md/research/blob/main/jobs/8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b/files/AUDIT.md ，judge 於 2026-09-30 13:45 UTC 完成。
  - 5 個 seat 全部 accepted：4 個專項（math、permissions、economics、control flow）加 1 個 judge。
  - judge 保留 7 項（N-1～N-7）：6 項 Low、1 項 Info，全部是可用性或畫面顯示問題；每一項都在未修改的程式上重現（真的 Worker handler 或真的 `AuthClient`、真的 migration 跑在 SQLite、合成金鑰、fixture 的鏈與 limiter）。
  - 它沒有找到轉移資產或任意簽名的路徑，也沒有找到在沒有金鑰時以某個地址登入、讓別人的 session 復活或結束、或取得不屬於自己的席位的屋主權利的方法。
  - 其中兩位專項審查者寫明 A-1～A-8 與 W-1～W-3 每一項都照文件所述運作。7 項中有 4 項是上一輪修正的延伸（N-1、N-2 延伸 A-3；N-3 延伸 A-4；N-4 延伸 A-1）。
  - 一位專項審查者只用 `ae1d41a` 的 `source/` 重建 Worker bundle，得到 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`，與團隊對 `1a0dd495` 的部署紀錄相同；judge 的報告沒有部署對照判定。
  - judge 沒有採用一位專項審查者「用光上游（Alchemy）額度會讓全站 503」的說法，只保留「新買家的首次查詢被擋」（N-6）。依團隊對各份提交的閱讀，審查者沒有驗證正式部署、Cloudflare 設定、上游額度、真錢包與瀏覽器，或快照以外的前端程式。
- 這些審查的結果只屬於各自審查的版本。**本版（Worker `bbf24001`）的變更尚未經任何重新審查**；「我的錢包」底部的審查紀錄也這樣標示：「之後的審查」一列連到 8c3aea2e，並寫明它看的是 Worker `1a0dd495`、不是目前版本（`source/src/world/reviewRecord.ts:65-69`、`:134-137`、`:143-150`）。

### 部署經過（團隊的部署紀錄；沒有從 Cloudflare 讀取，也沒有經審查驗證）

| Worker version | 來源 | 部署時間（UTC） | 內容 |
|---|---|---|---|
| `1a0dd495-35e7-4052-ba84-332e787f864d` | `4321bb4` | 2026-09-29 19:54 | Audit 8c3aea2e 的審查對象（Worker bundle `1018f02a…078c`） |
| `6e7e40cd-e6b9-481b-af2b-3f49347ef7cc` | `df8ea90` | 2026-09-30 06:48 上線，09:27 撤回 | 城鎮的視覺重新配置；09:27 以 `wrangler rollback` 回到 `1a0dd495`。`df8ea90` 的原始碼**不在**本快照 |
| `cc5cddb3-d153-4a15-b9c2-6b9311f1a425` | `007ee80` | 2026-09-30 14:53 | 持有人選定的五項：較溫和的壞天氣與「平靜天氣」開關、1.5 倍的 Pepe 雕像、Guardian Hall、三個新的船站、纜車；在正式的配置上，沒有搬動任何房子 |
| `3e0f4eb3-afa8-48d6-a156-acd621cf5e61` | `a77f91b` | 2026-09-30 15:48 | 第一次世界資料讀取失敗時更快重試（5 秒、15 秒；`source/src/world/cadence.ts` 的 `FIRST_RETRY_MS`） |
| `5f9e6468-e1df-4ebf-81a1-03235d59c917` | `41ae386` | 2026-09-30 18:58 | 地標在原地放大，沒有搬動任何房子 |
| `f152cd66-ae14-4f8f-b143-91420608bf82` | `0d57791` | 2026-09-30 22:20 | 纜車改為六個車廂；鍛造場放大（旁邊的磨坊移除） |
| `bbf24001-7eec-4f93-b312-a22e299ab275` | `2e4e830` | 2026-10-01 04:09:34–04:10:24 | `0d57791` 加上 N-1～N-7 的修正。部署前先匯出備份、再套用 `0005_lanes_and_subnets.sql`（約 04:09）。Worker bundle `018df7b3…c62c` |

`6e7e40cd` 到 `f152cd66` 都只改前端：Worker bundle 都與 `1a0dd495` 相同（`1018f02a…`），沒有 migration。目前執行的是 `bbf24001`（團隊說明；本輪沒有用 wrangler 查詢部署狀態）。表中每一版的部署證據頁都在 `source/docs/security/deploy-evidence/`（本版新增 `007ee80`、`a77f91b`、`41ae386`、`0d57791`、`2e4e830` 五頁）；本快照對正式站的比對見下方「版本對應」與 `DEPLOYMENT_MATCH.md`。

### Audit 8c3aea2e 的 7 項（N-1～N-7）

**下表的「做了什麼」與「殘餘風險」都是 IMD 團隊自己的說明，尚未經任何重新審查，reviewer 應自行驗證。** 嚴重度照抄 judge；第一欄括號內是 judge 當時引用的 `ae1d41a` 位置（舊行號），之後是團隊標示的狀態（N-1、N-2、N-3、N-4、N-7 已修正；N-5、N-6 部分修正）。逐項的舊行為、新行為、防止的濫用、殘餘、修改的檔案與測試：`source/docs/security/AUDIT_REMEDIATION_STATUS.md`「Swarm audit 8c3aea2e」一節（公開版，遮蔽見 `REDACTIONS.md` 第 1.4 節）與 `source/docs/wallet-login/DESIGN_W1_v001.md` 第 16 節。7 項都隨 `bbf24001` 上線（團隊的部署紀錄）。下表的行號都指本快照 `source/`。名稱以 `N-` 開頭的 43 項測試在本快照 2026-10-01T04:25:46Z 全部通過（`TESTS/n-tests-output.txt`）。

| 發現（審查嚴重度；舊位置）· 團隊標示 | 做了什麼（團隊說明） | 殘餘風險（仍存在） | 在哪裡驗證 |
|---|---|---|---|
| **N-1** 較舊的 session 讀取可以清掉較新讀取建立的屋主狀態（Low；舊 `src/world/auth.ts:178`）· 已修正 | 每次 session 讀取取得一個序號（`sessionReads`，與 `gen`、`homeGen` 分開）；只有最新一次的回應、本文、錯誤或失敗會被套用，在 fetch 之後、本文之後與失敗路徑都檢查。套用「已登出」或另一個 session 的讀取，會丟棄被取代的 session 的房屋讀取；登入開始時也一樣；沒有持有 session 時房屋路由的 401 不改變任何狀態。登入點擊會等到沒有 session 讀取在進行（自己的重讀前後都等）。不為了修復狀態去問錢包 | 團隊不知道還有殘餘。依設計（CORR-02），最新的那次讀取本身失敗時，到下一次讀取前 session 狀態未知，點擊會先重讀、不要求簽名；其他分頁一直發起 session 讀取時，點擊會一直等，期間不簽任何東西 | `source/src/world/auth.ts:118-121`（`sessionReads`）、`:187-206`（`restore`／`readSession`；`stale()` 在 `:189`，檢查在 `:191`、`:193`、`:205`；丟棄房屋讀取在 `:196`、`:204`）、`:225`、`:244-245`、`:264`；測試 `source/tests/wallet-client.test.mjs:1010`（重現）、`:1023`、`:1036`、`:1052`、`:1069`、`:1091`、`:1110`、`:1131` |
| **N-2** 已取消的登入在 challenge 本文晚到時，仍會請舊帳號簽名（Low；舊 `src/world/auth.ts:240`）· 已修正 | 讀完 challenge 本文後，只有仍是進行中的流程、錢包與帳號都沒變時才繼續；這個檢查緊接在 F-7a 的訊息檢查、簽名摘要與錢包提示之前，中間沒有 await。流程中錢包鎖定會安靜結束流程；晚到的 challenge 或 verify 拒絕只影響進行中的流程；用戶端 teardown 會結束進行中的流程並重設 phase。還在等 session 讀取的點擊，若期間登出、換帳號或換錢包、或頁面 teardown，也會結束，之後不提示、不再讀取（團隊自己檢查修正時補上，`5261844`）。沒有用 AbortController：已經到達的回應只依狀態判斷 | 流程取消時已經開著的錢包視窗，頁面無法關閉；它的回答會被丟棄，不會送去 verify | `source/src/world/auth.ts:240-293`（`signIn`；`live()` 在 `:243`，等待中被結束在 `:246-250`，讀完本文後的檢查在 `:269-271`，訊息檢查 `:273-275`，`personal_sign` 在 `:278`，`:280`、`:283-284`）、`:152-155`、`:163`（teardown）；測試 `source/tests/wallet-client.test.mjs:1150`（重現）、`:1161`、`:1179`、`:1195`、`:1206`、`:1217`、`:1235` |
| **N-3** 候選超過 256 個時，靠最近一次出現而計入的席位可能沒被檢查（Low，可用性；舊 `server/ownership.ts:212`）· 已修正 | 計入規則只寫一次（`counts`：名冊顯示在線的已註冊 agent，或 24 小時內在這個持有人名下出現過），席位狀態、上限的排序與 N-6 的 lane 都用它。排序：會計入的、其他已註冊的、其餘，各依 id。只有需要截斷時，每次證明才做一次 `seat_presence` 讀取（不在線的已註冊候選，主鍵查詢），存進 D1 的答案（A-2）與實際證明的清單用同一種截斷；沒有資料庫或讀取失敗時退回只看名冊（A-4 的做法）。24 小時規則、房屋大小、`partial` 與每個選中席位的 `ownerOf` 都不變 | 超過上限的席位不會列出；可能計入的席位超過 256 個時，超過的不會計入（此時房子已是最大尺寸）；回應標 `partial` | `source/server/ownership.ts:142-145`（`counts`）、`:146-148`（`rank`）、`:228-238`（只有截斷時才讀出現紀錄）、`:245`（存進 D1 的答案）、`:255-256`；測試 `source/tests/ownership.test.mjs:429`（重現）、`:438`、`:452`、`:467` |
| **N-4** 持有人自己先前的查核會用掉 A-1 的備用查核，一次垃圾 verify 就能擋住重試（Low，可用性；舊 `server/auth.ts:156`）· 已修正 | 每次合約查核記下它怎麼被放行（`login_challenges.called_via`：`pool` 或 `lane`，migration 0005；0005 之前的列算 lane），lane 只計算 lane 查核：每個 /24 對每個地址每分鐘 1 次，IPv6 每個 /48 從兩個不同的 /64 共 2 次（N-5）。自己用完該地址兩次共用查核的 subscriber（/24；IPv6 為 challenge 的 /64）不拿 lane，所以針對一個合約的垃圾仍只用掉該網段 3 次合約查核中的 2 次（F-3）。lane 仍在網段份額內、記在 `chain:erc1271:lane`，不佔兩個共用鍵；不增加讀寫（欄位寫在 claim 的同一個 UPDATE，不建索引） | 來自持有人自己 /24 的垃圾仍可擋住它：兩次垃圾 verify 用掉該地址的共用查核，或一次拿走 lane（IPv6：來自它的 /64，或它的 /48 中另外兩個 /64；log `address`）。lane 圍堵仍需每分鐘至少 9 個 /24 瞄準至少 3 個地址（IPv6：5 個 /48、各用兩個 /64、至少 2 個地址），在一個據點。0005 套用前沿用舊規則。門檻是本機精確 limiter 的結果，在邊緣不一定成立 | `source/server/auth.ts:197`（`CLAIM_CONTRACT` 記 `pool`）、`:201-216`（`CLAIM_LANE`；只算 lane 的條件在 `:215-216`）、`:495-497`、`:72-76`、`:82-87`（成本說明）；`source/migrations/0005_lanes_and_subnets.sql:12-14`；測試 `source/tests/auth.test.mjs:599`（重現）、`:612`、`:632`、`:638`、`:648` |
| **N-5** 同一個 /48 裡不同的 IPv6 用戶共用一組智慧錢包登入份額（Low，可用性；舊 `worker/app.ts:77`）· 部分修正 | 分配模型寫明：/64 是一個用戶（行動連線或家用線路；隱私位址只輪換低 64 位元），/48 是業者或 tunnel broker 分出的單位。份額巢狀：/48 得到每個 /24 份額的 2 倍（`NET6_SCALE`：每分鐘 60 個 challenge、20 次 code claim、6 次合約查核、每地址 2 次 lane），其中每個 /64 最多一個 /24 的 ERC-1271 claim 與合約查核（它的 challenge 受 `AUTH_LIMITER` 每分鐘 20 次限制）。計數依提出 challenge 的 /64（`login_challenges.sub`，發 challenge 時由 `worker/app.ts` 的 `subnetKey` 寫入），不依送 verify 的地址。IPv4 不變；log 仍只帶 /48。0005 之前的程式退回 0004 的 statements，/48 每分鐘仍是 30 個 challenge（團隊自己檢查修正時補上，`5261844`） | **部分修正**：能從共用 /48 的兩個以上 /64 發請求的人（住宅 /56 或 /60、重新連線的手機、tunnel-broker 的 /48）可以用掉該 /48 的份額（每分鐘 60 個 challenge、20 次 code 讀取、6 次合約查核），那裡的登入要等這一分鐘。challenge 的 /64 層是每據點的（`AUTH_LIMITER`），一個 /64 的流量若在一分鐘內到達三個據點，可以要到全部 60 個。每個 /48 在全站上限中算兩個 /24（閥門的一般部分：7 個 /48；`chain:code`：9 個）。每個 IPv6 challenge 列在存活期間保留它的 /64 前綴（不含主機位元、不寫進 log；未使用約 25 分鐘、已使用約一天）；部署前 5 分鐘內發出的 challenge 沒有這個欄位。IPv6 每次 claim 的讀取量增加（`server/auth.ts` 的 D1 成本說明） | `source/worker/app.ts:79-85`（`subnetKey`）、`:117-119`；`source/server/auth.ts:155-159`（`NET6_SCALE`、`netScale`）、`:164-171`（`INSERT_CHALLENGE` 的 `?14`）、`:433`、`:439-442`、`:184-191`（`CLAIM_ERC1271` 的 /64 條件）、`:199`、`:214`、`:477-480`（以 challenge 的 `row.sub` 計算）、`:172-178`、`:217-226`（0005 之前的 statements）、`:486-487`、`:492-496`；`source/migrations/0005_lanes_and_subnets.sql:6-11`；測試 `source/tests/auth.test.mjs:664`（重現）、`:670`、`:686`、`:706`、`:732`，`source/tests/worker.test.mjs:240` |
| **N-6** 一個 IP 可以在一個據點用光 NFT 索引的探索，讓新買家的席位找不到（Low，可用性；舊 `server/ownership.ts:219`）· 部分修正 | 探索 lane：`chain:index` 拒絕了一次索引讀取、而且當時的答案沒有計入任何席位（N-3 的同一條規則）時，請求者的網段每分鐘可以自己做一次索引讀取。先在 D1 計數（新表 `index_lanes`，migration 0005；每個 /24 每分鐘 1 次，/48 2 次且每個 /64 1 次；全站每 6 秒最多 60 次），再扣 `CHAIN_LIMITER` 的新鍵 `chain:index:lane`（每據點每分鐘 20 次，fail closed；沒有新綁定）。它的答案像其他索引讀取一樣保存（A-2），所以這位持有人之後不再需要 lane。每個候選仍由 `ownerOf` 證明，用戶端送來的任何東西都不是候選；lane 被拒時仍是 `limited`（無法查核，不是「沒有持有」）。已經計入席位的答案不拿 lane，索引讀取失敗（Alchemy 錯誤）而不是被預算拒絕時也不拿。cron（每 15 分鐘）刪除超過一分鐘的 lane 列 | **部分修正**：在一個據點，主鍵已被用光時，另外 20 個網段（IPv6：10 個 /48、各用兩個 /64）每分鐘都拿走自己的 lane，仍可在持續期間擋住被拒的讀取；買家自己 /24（或 /64，或它的 /48 中另外兩個 /64）上搶先拿走 lane 的人也可以。全站每分鐘 600 個 lane 會在主鍵也被用光的每個據點關閉 lane。已經計入一個席位、又買了只有索引列出的席位的持有人，在主鍵恢復前看到 `limited` 與較少的數量（A-2 的規則）。只有在 20 個網段都在拿 lane 時，一個據點的索引讀取才會從每分鐘 20 次升到 40 次。0005 套用前沒有 lane | `source/server/auth.ts:227-236`（`INDEX_LANE_BUDGET`、`INDEX_LANE`）、`:617-625`（home 路由的 `lane`：先 D1、再 `chain:index:lane`，任何錯誤都是沒有 lane）、`:271`（`CHAIN_KEYS.indexLane`）、`:126-137`（成本說明）；`source/server/ownership.ts:131-133`、`:239-253`（`refused` 只表示預算拒絕）、`:281-288`；`source/server/presence.ts:45-50`、`:60`；`source/migrations/0005_lanes_and_subnets.sql:15-20`；`source/wrangler.jsonc:50-56`（註解）；測試 `source/tests/ownership.test.mjs:487`（重現）、`:500`、`:518`、`:526`、`:549`、`:561`、`:571`，`source/tests/presence.test.mjs:100`，`source/tests/wallet-client.test.mjs:614`（A-8 的測試，改為這項殘餘的情境） |
| **N-7** 在別處被撤銷的登入，被顯示成登入已到期（Info；舊 `src/world/auth.ts:205`）· 已修正 | 「到期」只表示 session 真的到期：401 `SESSION_EXPIRED`、持有的 session 的 `expiresAt` 在本機時鐘上已到（在清掉 session 之前讀取），或 `GET /api/auth/session` 回 `{signedIn:false,expired:true}`；這個路由只對到期的 cookie 這樣回（被撤銷、偽造、格式錯誤或沒有 cookie 仍只回 `{signedIn:false}`；房屋路由原本就對同一個 cookie 回 `SESSION_EXPIRED`）。頁面得知的其他登出都是「失效」。「我的錢包」的三種文字：「登入已到期，請重新登入。」／“Your sign-in has expired. Please sign in again.”（也是狀態列）、「登入狀態已失效，請重新登入。」／“You are no longer signed in. Please sign in again.”、本頁自己登出後的「已登出。」／“Signed out.”。只憑 `AUTH_REQUIRED` 不會說是另一台裝置 | `AUTH_REQUIRED` 有多種原因，所以頁面只說登入已失效、不說原因。本機時鐘比伺服器慢、瀏覽器又已丟掉 cookie 時，在這段差距內的讀取看到單純的未登入回應，會把已到期的 session 說成已失效；差距等於時鐘差，兩種文字都請使用者重新登入 | `source/src/world/auth.ts:25-28`（`SessionEnd`）、`:200-204`、`:223-227`、`:140`、`:307`、`:361`；`source/server/auth.ts:526-534`（session 路由，`expired:true` 在 `:532`）；`source/src/world/walletView.ts:56-60`（`endedText`）；`source/src/world/WalletPanel.tsx:104-105`；測試 `source/tests/wallet-client.test.mjs:1254`（重現）、`:1270`、`:1291`、`:1308`、`:208`，`source/tests/auth.test.mjs:314` |

**本版沒有改變的部分**（團隊說明，可對照原始碼）：用戶端仍只呼叫三個錢包方法（`eth_accounts`、`eth_requestAccounts`、`personal_sign`）；SIWE 訊息與 statement、cookie、7 天的 session、登出與登出所有裝置、Origin 檢查、fail-closed 的 limiter 都不變；沒有新的綁定（仍是四個 rate limiter 與一個 D1），新的 `chain:index:lane` 是 `CHAIN_LIMITER` 裡的另一個鍵（`source/server/auth.ts:271`）。

修正狀態文件另外記錄了團隊自己對這些修正做的檢查（一次 security read 與 mutation check，不是外部審查；結果是 commit `5261844`），以及部署前列給持有人決定的取捨：IPv6 的倍數 2、IPv6 challenge 列保留 /64 前綴、探索 lane 與它全站每分鐘 600 次的上限、session 路由的 `expired: true`、到期文字取代狀態列、頁面關閉時結束進行中的登入。

### 先前發現的現況

各項的內容與修正已在先前 commit 的本檔說明（F-1～F-8：`git show b6e986b:README.md`；S-1、S-2、W-1～W-3、G-1～G-3、A-1～A-8：`git show ae1d41a:README.md`），逐項的團隊說明在 `AUDIT_REMEDIATION_STATUS.md`。嚴重度照抄各次審查；「現況」是團隊說明，尚未經重新審查。

| 發現 | 審查 | 嚴重度 | 現況（團隊說明） | 本版的關係 |
|---|---|---|---|---|
| F-1 | 4bd31cfb | Medium（shared-boundary） | 部分緩解；簽名轉送**仍未解決**（同 S-1） | 不變 |
| F-2 | 4bd31cfb | Low／Info | 部分處理；寬鬆的 ERC-1271 合約**仍未解決** | 不變 |
| F-3 | 4bd31cfb | Low（可用性） | 改善；部分未解決 | N-4、N-5 改變 lane 與 IPv6 的份額 |
| F-4 | 4bd31cfb | Low | 已修正（「登出所有裝置」） | N-7：其他裝置上被撤銷的 session 改說「登入狀態已失效」 |
| F-5 | 4bd31cfb | Low（可用性） | 改善；部分未解決 | N-5：一個 /48 在全站上限中算兩個 /24 |
| F-6 | 4bd31cfb | Info | 已修正；本快照 2026-10-01T04:25:55Z 重跑 `npm audit` 與 `npm audit --omit=dev`，都是 0（`TESTS/npm-audit-*.json`） | 不變 |
| F-7 | 4bd31cfb | Info | (a) 已修正；(b)–(e) 不變，接受為已知 | 不變 |
| F-8 | 4bd31cfb | Info（shared-boundary） | **仍未解決**（同 S-2） | 不變 |
| S-1 | e48d0a96 | Medium（對目前 World 為 Low） | **未解決**：釣魚頁面仍可轉送真實 challenge；防線是錢包的 EIP-4361 檢查與玩家本人 | 不變 |
| S-2 | e48d0a96 | Info（shared-boundary） | **未解決**（架構邊界；`MINT_BOUNDARY.md` 的 S-2 清單） | 不變 |
| W-1 | e48d0a96 | Info | 已處理（屋主模式、搬家、「進入我的家」都比對本機時鐘上的到期） | N-7 改變 session 結束時的文字 |
| W-2 | e48d0a96 | Info | 只改說法（log 帶由 IP 推出的網段鍵） | 不變：N-5 的 /64 不寫進 log |
| W-3 | e48d0a96 | Info | 已處理（節點失敗是 503，不是壞簽章） | 不變 |
| G-1～G-3 | e48d0a96 | 範圍外 | **未處理**（範圍外；`MINT_BOUNDARY.md` 只列問題） | 不變 |
| A-1 | 519db624 | Medium（可用性） | 改善；部分未解決 | N-4 改為只計 lane 查核 |
| A-2 | 519db624 | Low（可用性） | 已修正 | N-3 讓存進 D1 的答案依計入規則截斷；N-6 加上探索 lane |
| A-3 | 519db624 | Low | 已修正 | N-1、N-2 把同樣的作廢規則延伸到 session 讀取與登入流程 |
| A-4 | 519db624 | Low（可用性） | 已修正 | N-3 改為依計入規則排序 |
| A-5 | 519db624 | Low（可用性） | 已修正 | 不變 |
| A-6 | 519db624 | Low（可用性） | 部分修正 | N-5 改變 IPv6 的份額（/48 兩倍、每個 /64 有上限） |
| A-7 | 519db624 | Low（可用性） | 改善；部分未解決 | N-5：閥門的一般部分可被 7 個 /48 填滿（IPv4 仍是 14 個 /24） |
| A-8 | 519db624 | Low | 已修正 | 不變；N-6 被拒的讀取仍顯示為「這次查核沒能完成」 |

### 同一段時間的其他變更（都不改變伺服器授權）

- **城鎮與載入（隨 `cc5cddb3`、`3e0f4eb3`、`5f9e6468`、`f152cd66` 上線）**：較溫和的天氣與「平靜天氣」開關、Pepe 雕像、Guardian Hall、船站、纜車、放大的地標與鍛造場。程式都不公開（只列雜湊），只有三個已公開的檔案跟著改：`source/src/world/i18n.tsx`（纜車的兩個 UI 字串）、`source/src/world/publicHashes.ts`（Guardian Hall 模型的雜湊檔名）、`source/src/world/cadence.ts`（`FIRST_RETRY_MS`、`startWorldPoll`、`showLoading`：第一次世界資料讀取失敗時 5 秒、15 秒後重試，一次只有一個讀取）。沒有新的 API 路由、沒有新的錢包呼叫、沒有搬動任何房子；這段期間 Worker bundle 都是 `1018f02a…`。
- 「我的錢包」底部的審查紀錄（`reviewRecord.ts`、`auditRecord.ts`）加上「之後的審查」：8c3aea2e 的連結、N-1～N-7 與團隊的修正狀態，並標明它檢查的是 Worker `1a0dd495`，不是這個版本（`source/tests/review-record.test.mjs:135` 檢查）。
- `wrangler.jsonc` 只改註解（N-6 的 `chain:index:lane`）；`scripts/deploy-evidence.mjs` 沒有改動，它從 `CHAIN_KEYS` 列出新的鍵（見 `2e4e830` 那頁部署證據）。

## 範圍一覽

| 項目 | 內容 |
|---|---|
| 網站 | https://imdember.com/（唯一 origin；`www.imdember.com` 301、`imd.stickember.com` 302 轉到這裡，為較早一輪的觀測，本輪沒有重測） |
| 後端 | 一個 Cloudflare Worker `imd-world`，依設定只由 `/api/auth/*`、`/api/me/*`、`/api/wallet/*`、`/api/world/*` 觸發；Worker 對其他路徑一律轉交 Static Assets（`ROUTES.md` 第 1 節） |
| 錢包方法 | 用戶端仍只呼叫 `eth_accounts`、`eth_requestAccounts`、`personal_sign`（僅 SIWE 登入），只監聽 `accountsChanged`；已在正式主 bundle `index-C1BrxBtd.js` 與房屋內部 chunk `InteriorView-4LZmFcoq.js` 上重新計數，結果與上一輪相同（`WALLET_METHODS.md` 第 3 節） |
| 登入 | SIWE（EIP-4361），訊息由伺服器產生並存在 D1；頁面先確認流程、錢包與帳號都沒變（N-2），再逐行檢查訊息，才交給錢包（`source/src/world/siwe.ts:16-24`、`source/src/world/auth.ts:269-278`）；伺服器用 viem 驗簽（ECDSA，必要時 ERC-1271），只接受目前的 statement。verify 判定的驗簽失敗都會作廢 challenge；每個 challenge 最多一次 ERC-1271 查核（`SIWE.md`） |
| 登入限制 | L1 每網段（challenge 與 ERC-1271 份額；IPv4 /24，IPv6 /48 為兩倍、其中每個 /64 最多一個 /24 的 ERC-1271 份額，N-5）、L2 每錢包（不因地址拒絕，只記錄 surge；每個合約地址的查核份額，外加每網段只計 lane 查核的 lane，A-1、N-4）、L3 每 challenge、L4 每據點 Cloudflare limiter、L5 全站閥門（保留 20／60 給最近一分鐘沒發過的網段），外加 zone 的邊緣 WAF 規則；詳表 `ROUTES.md` 第 4 節 |
| 缺少 limiter 綁定 | 正式網址上需要該綁定的路由一律回 503（`LIMITER_UNAVAILABLE`／`limiter_unavailable`），不會變成不限流；只有 loopback 的本機開發維持放行（`chain` 仍拒絕） |
| Session | `__Host-imd_session`（HttpOnly、Secure、SameSite=Lax，7 天絕對期限，不續期，DB 只存 SHA-256）；「登出此裝置」與「登出所有裝置」；用戶端在本機時鐘到期時也結束屋主模式（W-1）；session 結束時分別顯示到期、失效或已登出（N-7） |
| 所有權 | 以太坊主網 IMD 席位合約 `ownerOf`（經 Multicall3）；IMD 公開名冊與 Alchemy 索引只當候選，每一次 NFT 索引讀取都先扣 `CHAIN_LIMITER`（`chain:index`）；索引被拒或失敗時，上一次的索引答案（D1 `index_candidates`）也只當候選（A-2）；被拒而且答案沒有計入席位時，請求者的網段每分鐘可再讀一次（D1 `index_lanes`，再扣 `chain:index:lane`；N-6）；候選超過 256 個時先檢查會計入的席位（N-3） |
| 房屋 | **一個錢包一間房**，大小依計入的席位數；搬家只寫本機 localStorage；「進入我的家」只給屋主自己的房子，不寫伺服器、不呼叫錢包（`OWNERSHIP_AND_HOMES.md`） |
| WebSocket | 沒有（原始碼、重建的 Worker bundle 與正式前端檔案皆無 WebSocket／EventSource） |
| 範圍外 | Genesis Mint 的一切（合約、授權、signer、metadata／IPFS、鑄造用的模型與圖檔）；只有邊界問題寫在 `MINT_BOUNDARY.md` |

詳細範圍與 World/Mint 邊界表：`SCOPE.md`。

## 版本對應

```text
正式 Worker version          bbf24001-7eec-4f93-b312-a22e299ab275
        ↑ 由下面的 2e4e830 建置並部署（npm run deploy：先跑完整測試，再 build 與上傳；在該 commit 的乾淨 worktree 執行；
          deploy record 20261001T040934Z-2e4e830，2026-10-01T04:09:34Z–04:10:24Z，dirty=false，tests "passed"）
IMD Ember World 私人 repo    commit 2e4e830b367f651e3c880587c1a4b465d1bfcd91（tag v2026.10.01-bbf24001）
        ‖ 本快照的 source/ 取自其後的 f4272c513e2052fb0bea6d2e8512180256a60919（main，2026-10-01）：每個會進入 Worker
        ‖ 或前端 build 的公開檔案都與 2e4e830 相同；2e4e830 之後只改了 docs/security/AUDIT_REMEDIATION_STATUS.md、
        ‖ docs/wallet-login/DESIGN_W1_v001.md、tests/review-record.test.mjs，並新增一頁部署證據（2e4e830 的部署）
        ↑ git -c core.autocrlf=false archive f4272c5 取出本快照 source/ 的 78 個檔案
          （8 個檔案有遮蔽，只改註解、文件文字、設定值與測試字串，見 REDACTIONS.md；其餘 70 個與 git blob 逐位元組相同）
本快照 repo                   本 commit（父 commit ae1d41a；本 commit 的 hash 以本 repo 的 `git log` 為準，檔案無法記載自己所在的 commit）
```

| 項目 | 上一次的審查對象（`ae1d41a`） | 本快照 |
|---|---|---|
| 正式 Worker version | `1a0dd495-35e7-4052-ba84-332e787f864d` | `bbf24001-7eec-4f93-b312-a22e299ab275` |
| 部署的私人來源 | `4321bb4da3826276919ed60ecc2018139dcaeacc` | `2e4e830b367f651e3c880587c1a4b465d1bfcd91`（2026-10-01 04:09:34–04:10:24 UTC 部署） |
| `source/` 取自 | `132228c` | `f4272c513e2052fb0bea6d2e8512180256a60919`（建置用的檔案與 2e4e830 相同） |
| Worker bundle（`index.js`） | 274,961 bytes，SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c` | 280,605 bytes，SHA-256 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c` |
| D1 migrations | 0001–0004 | 0001–0005 |

`migrations/0005_lanes_and_subnets.sql`（只新增：`login_challenges` 兩個可為 NULL 的欄位 `sub`、`called_via`，一個新表 `index_lanes` 與兩個索引）在 2026-10-01 約 04:09 UTC、部署 `bbf24001` 之前、先匯出備份後已套用到正式 D1；團隊之後讀回了 `index_lanes`、`index_lanes_net`、`index_lanes_at` 與兩個新欄位。`0004` 在 2026-09-29 約 19:53 UTC 套用。這些都是團隊端說明；本輪沒有查詢正式資料庫。

- 正式站前端檔案是公開的，任何人都能下載比對（2026-10-01T04:24:56Z–04:25:11Z，每個 GET 一次、間隔約 3–4 秒；與部署紀錄及團隊端從 2e4e830 CRLF 封存重建的結果三方相同）：
  - `https://imdember.com/`（index.html）　SHA-256 `62af24a41f3825ffd8b8c68b8d2032205b58a82cbb92618fed599609163e49c9`（2,634 bytes）
  - `https://imdember.com/assets/index-C1BrxBtd.js`　SHA-256 `b6d39838089b2707778990485570b6069054bdea22298bc2062b41a17f198d3d`（1,432,648 bytes）
  - `https://imdember.com/assets/InteriorView-4LZmFcoq.js`（房屋內部，延遲載入）　SHA-256 `5077095b0b0fee5b68ad02328bc5d2304de7822f90ed933f54780c8880041630`（93,255 bytes）
  - `https://imdember.com/assets/index-B1zoY2Mz.css`　SHA-256 `4d1e832e229e0ea91b5af4b907c915489babf94db21f015c8eb72bf1510e0b32`（57,205 bytes）
  - `GET /api/auth/session`：`{"signedIn":false}`、`no-store`、API 的 CSP `default-src 'none'; frame-ancestors 'none'`、`Cross-Origin-Resource-Policy: same-origin`、nosniff、HSTS，沒有 CORS 標頭。`/` 帶 HSTS（`max-age=31536000; includeSubDomains`）、CSP（`default-src 'self'; script-src 'self'; … frame-ancestors 'none'`）、Permissions-Policy、Referrer-Policy、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`。
  - 同一天約 04:10 UTC（部署之後），團隊另外看到：從 `Origin: https://evil.example` 發出的 `POST /api/auth/challenge` 回 403；沒有 session 的 `GET /api/me/home` 回 401（團隊端，記在 `2e4e830` 那頁部署證據）。
- 其餘 96 個靜態檔本輪沒有下載，只與部署紀錄比對（`manifests/compare.txt`：VERIFIED 4、RECORD-MATCH 95、NOT-SERVED 1（`_headers`））。與 `4321bb4` 的部署紀錄相比：93 個不變、2 個改變（`index.html` 與 Guardian Hall 的模型）、5 個新增、5 個移除（舊的主 JS、CSS、房屋內部 chunk、舊的 Guardian Hall 雜湊檔與手機版地形預烘檔）。
- 這些 bundle 包含不公開的前端程式（3D、房屋擺放與內部、`WorldApp.tsx` 的接線），所以 XSS／供應鏈與錢包接線的檢查可以直接對正式檔案做。
- 後端：reviewer 可以**只用本快照 `source/`** 重建實際上傳的 Worker bundle（`wrangler deploy --dry-run --outdir`），SHA-256 應為 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c`（280,605 bytes；本快照 2026-10-01T04:25:20Z 實測，`TESTS/worker-dry-run-output.txt`；步驟見 `DEPLOYMENT_MATCH.md` 第 3 節）。Cloudflare 上實際執行的程式與機密設定仍無法從外部確認（`DEPLOYMENT_MATCH.md` 第 2 節）。
- 2026-09-30 06:48 到 2026-10-01 04:10 UTC 之間執行過 `6e7e40cd`（已撤回）、`cc5cddb3`、`3e0f4eb3`、`5f9e6468`、`f152cd66`（上方「部署經過」）：Worker bundle 都與 `1a0dd495` 相同，前端不同；那些版本的前端檔案不在本輪比對之內。

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
node --test --test-name-pattern="^N-" tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/worker.test.mjs
rm src/world/households.ts src/world/layout.ts
```

- 本快照在 2026-10-01T04:25:35Z 執行：加上替身時 **216 項中 212 項通過**，4 項失敗，與上一輪是同樣的 4 項：三項**因為被保留的程式**（`home-entry.test.mjs` 的兩項房屋門口幾何測試「the door…」「TEST-1: the render rules…」需要被保留的 `HOUSE_FOOTPRINT`／`lotPoint`，替身故意不提供；一項 `?interior=` 預覽測試「group 8…」需要被保留的 `src/world/interior/mockSeats.ts`），一項**因為團隊的 git 歷史**（`deploy-evidence.test.mjs` 的「deploy evidence from a real deploy record…」在 `source/tests/deploy-evidence.test.mjs:54` 執行 `git rev-parse 132228c`、在 `:58` 執行 `git rev-parse 3f661eb`，兩者都是私人 repo 的 commit（`132228c` 是 Worker `1a0dd495` 的程式；`3f661eb` 是 Report 的修正，早於 A-1），用來比較 A-1、N-6 前後證據頁列出的 limiter 鍵與 migration；團隊的 checkout 中這項通過）。名稱以 N-、A-、W-、F- 開頭的測試全部通過。不加替身時（04:25:24Z）111 項中 107 項通過：`ownership.test.mjs`、`home-entry.test.mjs`、`wallet-client.test.mjs` 三個檔案無法載入 `households.ts`，另加同一項 deploy-evidence 測試。「進入我的家」的三項授權測試（`group 5`，04:25:45Z）與 43 項 `N-` 測試（04:25:46Z）全部通過。原始輸出：`TESTS/`。
- 這些是本機 mock／unit 測試，沒有瀏覽器測試。
- 團隊端的真錢包檢查（持有人說明，沒有公開截圖或紀錄）：持有人在 `bbf24001` 上線後（2026-10-01 04:16 與 04:19 UTC）用 MetaMask、一個沒有席位的錢包登入：錢包顯示來自 imdember.com 的「Sign-in request」、Ethereum、「No changes」、statement、Version 1、Chain ID 1；頁面接著顯示登入 7 天與「Checked on chain: this wallet holds no IMD seat right now」；按「Log out this device」後顯示「Signed out.」（N-7）。本文件不記載該錢包的地址。
- 團隊端（不在本快照）：f4272c5 的完整原始碼封存（90 個測試檔，含被保留的檔案）在 2026-10-01T04:27:12Z–04:27:57Z 執行 `npm test`：861 項中 860 項通過，1 項失敗就是上述需要 git 歷史的 deploy-evidence 測試（封存沒有 git 歷史）；在私人 checkout 中整套是 861 項全部通過。原始 log 不公開（含被保留的測試名稱與本機路徑），它的 SHA-256 是 `eb3b5d725c7a28082cf629406d45fb429d3e8198eadb98e2197ebc75254f4e03`。部署紀錄的 manifest 記載部署前的完整測試為 "passed"（`TESTS/README.md`）。
- `npm run build`（前端）在本快照**無法完成**：`tsc --noEmit`（04:25:50Z，exit 2）的錯誤全部來自被保留的檔案，與上一輪相同（`TESTS/tsc-noEmit-output.txt`，對應表見 `SCOPE.md` 第 6.3 節）。Worker 的建置不需要這些檔案。

## 規格項目在哪裡

持有人的審查規格（v1.1，World-only）與團隊內部的修正計畫本身**不隨本 repo 公開**。程式註解與測試裡提到的「remediation … §x」、以及用工具名稱稱呼的修正計畫、交叉檢查與交接文件（例如「… plan §14」「… crosscheck review」「… handoff」），都是團隊內部修正計畫的章節；它們的公開摘要是 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`。規格要求的材料清單與本快照位置如下：

| 規格材料 | 本快照位置 |
|---|---|
| 範圍說明 | `SCOPE.md`、`ROUTES.md` |
| World／Mint 邊界 | `SCOPE.md` 第 3 節、`source/docs/security/MINT_BOUNDARY.md` |
| 與規格的差異（房屋） | `SCOPE.md` 第 4 節 |
| 前端（Connect、SIWE、頁面端檢查、session 恢復與本機到期、session 結束原因、換帳號／換鏈、錯誤處理、Provider 呼叫、第三方 script、動態模組） | `WALLET_METHODS.md`、`SIWE.md` 第 7 節、`DEPENDENCIES.md`；原始碼 `source/src/world/{auth,siwe,wallet,WalletPanel,walletView,moves,homeEntry}.ts(x)` |
| 後端（challenge、verify、session、logout、logout-all、ownerOf、房屋 API、WebSocket、middleware、速率與預算） | `ROUTES.md`、`SIWE.md`、`OWNERSHIP_AND_HOMES.md`；原始碼 `source/server/`、`source/worker/` |
| 資料層（去敏 schema、nonce 一次性、session 撤銷／到期、快取、清理） | `DATA_SCHEMA.md`、`source/migrations/0001`～`0005` |
| 建置（lock 檔、Node／npm 版本、指令） | 本檔、`DEPENDENCIES.md`、`source/package-lock.json` |
| 測試（來源與原始輸出，區分 mock／瀏覽器／實際錢包） | `TESTS/` |
| 部署對照 | `DEPLOYMENT_MATCH.md`、`manifests/`、`source/docs/security/deploy-evidence/` |
| 原始登入訊息 | `SIWE.md` 第 1 節、`TESTS/siwe-sample/`（合成金鑰，無簽章） |
| 修正狀態 | 本檔「自送審版本以來的變更」、`source/docs/security/AUDIT_REMEDIATION_STATUS.md` |
| 檔案清單 | `SCOPE.md` 第 6 節、`SHA256SUMS`、`manifests/withheld-source.txt`、`REDACTIONS.md`、`PUBLIC_CONTENT_LIST.md` |

## 證據來源分欄

- **可自行驗證**：`source/` 原始碼與 `npm test`；從 `source/` 重建的 Worker bundle 雜湊；正式站公開檔案的 SHA-256 與字串計數；公開回應標頭。
- **僅團隊端證據**：部署紀錄（manifest、SHA256SUMS、上傳紀錄本身）與由它產生的 10 頁部署證據；哪個 Worker version 在什麼時間上線、`6e7e40cd` 的上線與撤回；正式 D1 已套用 0003、0004 與 0005 的說明（含 0005 套用後讀回的表、索引與欄位）；持有人 dashboard 顯示的內容（Worker 清單、綁定、secret 名稱、WAF 規則與它的 rule id）與團隊實測；持有人的真錢包登入；被保留檔案的內容與對它們做的搜尋；完整原始碼的測試與前端重建。reviewer 無法獨立取得，只能看到雜湊與結構化欄位。
- **修正狀態**：全部是 IMD 團隊自己的說明，尚未經重新審查。

文件引用團隊端證據時會標「團隊端」或「團隊說明」。

## 檔案完整性

- 根目錄的 `.gitattributes`（`* -text`）讓 git 不轉換任何檔案的換行，所以在 Windows（`core.autocrlf=true`）上 clone 也能得到相同位元組。
- `SHA256SUMS`（`sha256sum` 格式、相對路徑）涵蓋本 repo 除了它自己以外的全部檔案：`sha256sum -c SHA256SUMS`。
- `source/` 中除 `REDACTIONS.md` 第 1 節列出的 8 個遮蔽檔案外的 70 個檔案，`git hash-object --no-filters` 的結果等於 `manifests/published-source-gitblobs.txt` 列出的 commit f4272c5 blob id。8 個遮蔽檔案中有 3 個的原始 blob id 不公開（`ORIGINAL-BLOB-WITHHELD`：遮蔽的內容很短、可以猜，見 `REDACTIONS.md` 第 1 節）。

## 注意

- `source/docs/wallet-login/DESIGN_W1_v001.md` 的正文有些段落寫於 hardening 之前（例如舊的搬家簽章 `signMove`）；檔末的 Amendments 與第 15、16 節記錄了現況。**以程式碼為準。**
- 測試名稱也可能沿用舊稱（例如被保留的 `households.test.mjs` 有一項叫「a signed move …」）；搬家目前不簽章（`source/src/world/moves.ts:1-5`）。
- `AUDIT_REMEDIATION_STATUS.md` 與部署證據頁中「deployed in `bbf24001`」之類的部署事實，都是團隊的部署紀錄，不是審查結果。
- 本快照不含任何私鑰、助記詞、`.env`、`.dev.vars`、API／RPC key、session cookie、Bearer token 或有效的正式簽章（`REDACTIONS.md`）。
