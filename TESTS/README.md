# TESTS：實際執行的指令、版本與原始輸出

以下每一項都在 2026-09-30（UTC）實際執行過；沒有執行的測試不列為通過。

## 分類

| 類別 | 本快照有沒有 | 說明 |
|---|---|---|
| 靜態／mock／unit（Node） | **有**，本快照可執行 171 項（其中 4 項無法在本快照通過：3 項因被保留的程式、1 項因需要團隊的 git 歷史，見第 1 節） | 真的 Worker handler、真的四個 migration（`node:sqlite`）、本機產生的合成金鑰、鏈上讀取用 fixture 替身 |
| 瀏覽器測試 | **沒有** | 本快照沒有執行任何瀏覽器 E2E。A-8 的測試以 `react-dom/server` 把 `WalletPanel.tsx` 渲染成 HTML 字串再比對文字，仍不是瀏覽器測試 |
| 真實錢包測試 | **沒有** | 沒有連接任何真實錢包，沒有簽任何正式訊息，沒有鏈上交易 |
| 對正式站 | 只有 5 個公開 GET（`DEPLOYMENT_MATCH.md` 第 5 節），不是功能測試 |

`tests/wallet-client.test.mjs` 與 `tests/home-entry.test.mjs` 以真實的用戶端 `AuthClient` 對真實的 Worker handler 跑（fetch、EIP-1193 provider、分頁 channel、時鐘都是注入的替身），模擬換帳號、晚回應、拒簽、預算忙碌、頁面端訊息檢查、登出所有裝置、session 在本機時鐘上到期、「進入我的家」的閘門等情境；它們仍是 Node 內的 mock 測試，不是瀏覽器測試。

## 1. npm test（本快照 `source/`）

```text
環境：Windows 11，Node v24.19.0，npm 11.17.0
時間：2026-09-30T11:56:19Z（不加替身）；11:56:27Z（加替身）；11:56:37Z（group 5）
做法：把本快照的 source/ 複製成一個獨立目錄並 git init、commit 一次（deploy.test.mjs 與 deploy-evidence.test.mjs 假設
      source/ 就是 git repo 的根目錄），npm ci（2026-09-30T11:55:39Z–11:56:14Z，--no-audit --no-fund）後：
npm test                                              # 不加替身
cp <本 repo>/TESTS/stubs/households.ts src/world/households.ts
cp <本 repo>/TESTS/stubs/layout.ts src/world/layout.ts
npm test                                              # 加替身
node --test --test-name-pattern="group 5" tests/home-entry.test.mjs
rm src/world/households.ts src/world/layout.ts
```

結果：

- 加替身：**tests 171，pass 167，fail 4**（`npm-test-output.txt`，本機路徑換成 `<SCRATCH>`，即那個 source/ 副本）。4 項失敗：
  - 「the door: the Enter offer appears within 1.8 m of the owner's door spot…」（`tests/home-entry.test.mjs:53`）與「TEST-1: the render rules for the Enter action…」（`tests/home-entry.test.mjs:91`）：需要被保留的房屋尺寸與擺放幾何（`HOUSE_FOOTPRINT`、`lotPoint`）。替身**故意不提供**這些數值，讀取就丟出 `withheld: …`。
  - 「group 8: the ?interior= preview opens only in DEV or with ?debug=1…」（`tests/home-entry.test.mjs:62`）：需要被保留的 `src/world/interior/mockSeats.ts`。
  - **本輪新增**：「deploy evidence from a real deploy record: commit, id, times, version id, bundle and frontend hashes, migrations, limiters, WAF rule; no log text」（`tests/deploy-evidence.test.mjs:31`）。這個測試在第 52 行執行 `git rev-parse 3f661eb`：它用私人 repo 的一個較早 commit（Report 修正那一版，A-1 之前）確認證據頁列出的 limiter 鍵跟著該 commit 的 `server/auth.ts` 走（HEAD 有 A-1 的 `chain:erc1271:lane`，3f661eb 沒有）。本快照的副本只有一個 commit，`3f661eb` 不存在，`scripts/deploy-evidence.mjs` 回報 `manifest.json has no valid commit`，測試失敗。它需要團隊的 git 歷史；在團隊的 checkout（132228c）中 `node --test tests/deploy-evidence.test.mjs` 2/2 通過（團隊端，第 2 節）。因為失敗發生在第 52 行，同一測試第 55–58 行「輸出不含 log 文字」的斷言在本快照**沒有執行**；同檔第二個測試（第 62 行起）照常通過，其中第 74、82 行檢查假 email 與假路徑不會出現在輸出。
- 「進入我的家」的三項授權測試（名稱以 `group 5` 開頭）：**3 項全部通過**（`home-entry-group5-output.txt`）。其中一項以真實 sign-in 對真實 Worker 跑，確認閘門只對屋主自己的房子開放，session 在伺服器被撤銷後（`/api/me/home` 回 401）立即關閉。
- 不加替身：**tests 96，pass 92，fail 4**——`ownership.test.mjs`、`home-entry.test.mjs`、`wallet-client.test.mjs` 三個檔案因 `Cannot find module …/households.ts` 無法載入，加上上述同一個 deploy-evidence 測試（`npm-test-output.no-stub.txt`）。`wallet-client.test.mjs` 這一版也需要替身：它為了 W-1 從 `homeEntry.ts` import `enterGate`（`tests/wallet-client.test.mjs:8`）。

**為什麼需要替身**：`tests/ownership.test.mjs:7` 從 `households.ts` import `houseSize`，`src/world/homeEntry.ts:5-6` 從 `households.ts`、`layout.ts` import 房屋幾何，`tests/wallet-client.test.mjs:8` import `homeEntry.ts`。`households.ts` 在 commit 132228c 對 `houseSize`／`HOUSE_SIZES` 只做一件事：從公開的 `src/world/houseSize.ts` 原樣轉出（`households.ts:11`、`households.ts:14`，團隊端）。`TESTS/stubs/households.ts` 只有這個轉出，外加一個一讀就丟例外的 `HOUSE_FOOTPRINT`；`TESTS/stubs/layout.ts` 的 `lotPoint` 一呼叫就丟例外。兩個替身都不含任何擺放邏輯或幾何數值，也不是審查對象；它們的程式與上一輪相同；`households.ts` 替身的檔頭註解本輪改成 132228c 的行號（只改註解，測試時用的是改註解前的版本，執行結果不受影響）。

執行的 11 個測試檔（上一輪的 10 個加上 `dependencies.test.mjs`；**粗體**是本版新增或改寫的重點，括號內是測試名稱的開頭與位置）：

- `auth.test.mjs`：SIWE 訊息、cookie 旗標、token 只存雜湊、Origin、flow、重送、過期、ERC-1271／6492、冷啟動 CPU、開發伺服器、每網段與全站 challenge 預算、驗簽失敗作廢 challenge、ERC-1271 每 challenge 最多一次、缺綁定時 503、F-2 每個 session 記錄 EOA/ECDSA 或 CONTRACT/ERC1271、F-3 每網段與每合約份額與 `chain:code`、F-5 分層限制與不含識別資訊的拒絕 log、logout-all、0003 之前部署時回 503。**本版：F-1 只接受目前的 statement，舊措辭與任何其他文字回 401（「F-1: … only that text verifies, the retired wording and any other is 401」，`:191`）；F-5 改寫為沒有鄰居能讓玩家的 challenge 被拒（`:376`）；W-2 IPv6 的拒絕 log 只帶 /48 網段鍵、surge 前綴 6 個字元（`:436`）；A-5 body 晚到的 challenge／verify 以到達時間計數、合約檢查排在 code 讀取之後（`:460`）；A-1 其他網段的垃圾簽章不再能卡住某個智慧錢包，該錢包自己的網段每分鐘仍有一次檢查（`:498`），以及殘餘成本的量化（「A-1: the residual at its stated cost…」，`:542`）；A-6 鄰居替某地址要的 challenge 不會讓該玩家被拒，/24 份額是唯一的網段限制（`:565`）；A-7 20 個網段佔滿全站閥門時，最近一分鐘沒要過的網段仍拿得到 challenge（`:585`）；W-3 合約錢包的 `eth_call` 在節點失敗時回 503 `VERIFY_UNAVAILABLE` 且不建立 session，revert 或非 magic 回傳才是 401（`:866`）。**
- `wallet-client.test.mjs`：用戶端狀態機、EIP-6963、換帳號／錢包、晚回應、多分頁、搬家閘門、`markedHome`、頁面在錢包看到訊息前逐行檢查、簽名視窗開著時的摘要、「登出此裝置」與「登出所有裝置」。**本版：W-1 session 在本機時鐘上超過 `expiresAt` 就不是屋主模式，狀態、搬家閘門、搬家與提示都拒絕（`:472`）；visibility-refresh-clears-stale-owner 分頁重新顯示時在別處「登出所有裝置」或席位已售出就離開屋主模式（`:506`）；W-3 on the page 節點失敗顯示「暫時無法檢查」而不是簽章錯誤（`:530`）；F-7(e) 錢包鎖定時保留 session 與屋主模式（`:546`）；A-3 較舊的房屋讀取在較新的回答之後才到就被丟棄（`:562`）；A-8 被拒或被截斷的房屋讀取顯示「檢查未能完成」，不是「鏈上查過：沒有席位」（`:609`）——這個測試會啟動 `tests/fixtures/wallet-panel.mjs` 子程序，用專案自己的 TypeScript 編譯 `WalletPanel.tsx` 並以 `react-dom/server` 渲染「My wallet」面板；A-4 on the page 索引在頁數上限截斷時顯示清單可能不完整（`:672`）。**
- `home-entry.test.mjs`：「進入我的家」的閘門與按鈕、門口幾何、預覽模式。**本版：W-1 按下 Enter 時閘門必須當下仍然成立（`:110`）。**
- `review-record.test.mjs`：審查紀錄的內容與標示、連結屬性、每個發現的嚴重度與狀態、`docs/security/AUDIT_REMEDIATION_STATUS.md` 與頁面資料一致且不含禁用字、個人資料或本機路徑。**本版：列出對 Worker `50c688c9` 的兩次重新審查與其發現，並寫明本版未經重新審查（`:80`）；狀態文件引用的每個 `docs/security/*.md` 頁面都必須存在（`:185-187`，所以部署證據頁這次收錄）；`docs/security/MINT_BOUNDARY.md` 寫下 G-1..G-3 與 S-2 清單且不對任何 Mint 下結論（`:207`）。** 本快照的狀態文件是公開版，兩個 regex 也少了兩個內部名稱（`REDACTIONS.md` 第 1.4、1.5 節），測試仍通過。
- `deploy-evidence.test.mjs`：部署證據腳本只輸出結構化欄位，log 裡的 email、本機路徑與其他文字都不會出現在輸出。**本版：migration 清單含 0004；limiter 鍵依 commit 列出（需要 git 歷史，見上）。**
- `ownership.test.mjs`：ownerOf、Multicall3、候選、快取、失敗回 503、轉手、24 小時計入規則、`chain:index`、`/api/me/home` 只從 session 取地址、Worker 進入點不會載入 `layout.ts`／`households.ts`。**本版：A-2 索引重讀被拒時沿用上一次的索引答案當候選並由 ownerOf 重新證明（`:130`）、另一個 server instance 從 D1 保存的答案證明只有索引提到的席位（`:155`）、保存的答案以索引讀取開始的時間為準（`:206`）；部署早於 0004 時照舊運作（`:236`）；A-4 超過 256 個候選時先查能計入的席位，被截斷的清單標為 `partial`、絕不說成完整的零（`:353`、`:387`）。**
- `presence.test.mjs`：cron 在線紀錄與清理、0003 只增不改。**本版：migration 建立四個表（`:17`）；0004 只增不改、`index_candidates` 起始為空（`:54`）；A-2 cron 刪除 8 天以前的索引答案（`:67`）。**
- `worker.test.mjs`：路由、rate limit（含 IPv6 /64）、上游請求、進入點只匯出 handler、缺少綁定時 503、`networkKey`。**本版（效能調整）：Worker 在每個 location 保留 snapshot 的共用副本、冷啟動的 isolate 直接用它回答（`:247`）；`edgeCopy` 以請求的 origin 為鍵（`:277`）。**
- `headers.test.mjs`：`public/_headers` 與 `API_HEADERS` 的安全標頭。**本版：頁面載入的模型、裝飾與 Pepe 相框的內容雜湊副本快取一週、原檔每次重新驗證（`:75`；import `src/world/publicHashes.ts`、`src/world/publicUrl.ts`）。**
- `deploy.test.mjs`：部署腳本的出處紀錄、拒絕 dirty tree 與 `.env`、`deploy-records/` 被 gitignore、部署前先跑完整測試、失敗就停止。
- `dependencies.test.mjs`（**新檔**，Swarm review F-6 的後續）：lockfile 中沒有任何 undici 落在 GHSA-3wwx-pv8p-q78v 的範圍（7.28.0–7.29.0），且 `package.json` 的 `overrides.undici` 等於 lock 內的版本（`:10`）；這個 override 仍然必要——一旦沒有任何相依套件再鎖定有問題的 undici，測試就失敗，提醒移除 override（`:19`）。

## 2. 團隊端：完整原始碼的測試（不在本快照）

從 commit 132228c 以 `git -c core.autocrlf=false archive` 取出完整原始碼（79 個測試檔），`npm ci` 後在該副本 `git init` 並提交一次，再 `npm test`：2026-09-30T11:57:57Z–11:58:25Z，Node v24.19.0：**tests 726，pass 725，fail 1**。失敗的是第 1 節那個 deploy-evidence 測試：封存副本沒有私人 repo 的 git 歷史，`3f661eb` 不存在；在私人 repo 的 checkout（132228c）中 `node --test tests/deploy-evidence.test.mjs` 2/2 通過。原始輸出含被保留測試的名稱與本機路徑，不收錄；其 SHA-256 為 `be8235b7cc663ea153e6d29256a6129bde3b43ca8f8667ad9e2bd50be60277d2`。部署紀錄的 manifest 另記錄 4321bb4 正式部署前 `scripts/deploy.mjs` 跑完整測試的結果為 `passed`。reviewer 無法重跑被保留的測試（房屋擺放、房屋內部、世界內容、`links.test.mjs`、`gateway.test.mjs`、`market.test.mjs` 等）。

## 3. 型別檢查（本快照 `source/`）

```text
npx tsc --noEmit      # 2026-09-30T11:56:38Z，不加替身
```

結果：exit 2。16 個錯誤全部來自被保留的檔案（`tsc-noEmit-output.txt`）：

- `src/main.tsx` 找不到 `./world/WorldApp`、`./world/bridge.ts`、`./world/dataMode.ts`、`./world/skin/terrainTask.ts`、`./world/screenSpace.ts` 與 `virtual:baked-terrain`（後五個是效能調整後新增的 import）；
- `homeEntry.ts`、`HomePanels.tsx` 找不到 `./households.ts`、`./layout.ts`，`WalletPanel.tsx`、`walletView.ts` 找不到 `./households.ts`（只 import 型別）；以及由此連帶產生、在 `HomePanels.tsx` 的一個 TS7006；
- `vite.config.ts` 找不到被保留的建置腳本 `./scripts/content-hash.ts`、`./src/world/skin/terrainField.ts`、`./src/world/skin/terrainBake.ts`。

對應關係見 `SCOPE.md`。因此前端的 `npm run build` 在本快照無法完成；Worker 的建置不受影響。

## 4. Worker bundle 重建（本快照 `source/`）

步驟見 `DEPLOYMENT_MATCH.md` 第 3 節。2026-09-30T11:56:14Z 的結果：`index.js` 274,961 bytes，SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`，等於部署紀錄中實際上傳的 bundle。輸出：`worker-dry-run-output.txt`。

## 5. npm audit

```text
npm audit --omit=dev --json   → npm-audit-omit-dev.json   （0 個弱點）
npm audit --json              → npm-audit-all.json         （0 個弱點）
時間：2026-09-30T11:56:43Z（本快照 source/ 的副本，npm ci 之後）
```

上一輪是 0 與 3 moderate（undici GHSA-3wwx-pv8p-q78v，經由 wrangler → miniflare，只在建置與開發工具鏈）。這一版 `package.json` 的 `overrides.undici` 把 undici 固定在 7.29.1，`tests/dependencies.test.mjs` 檢查這個固定仍然有效且仍然必要。判讀見 `DEPENDENCIES.md`。

## 6. 去敏 SIWE 樣本

```text
cp TESTS/siwe-sample/generate-siwe-sample.mjs <source 副本>/_tmp_siwe.mjs
cd <source 副本> && node _tmp_siwe.mjs <輸出檔>      # 執行後刪除 _tmp_siwe.mjs
```

2026-09-30T12:01:38Z 重新產生。腳本呼叫真正的 `handleAccountApi` 與頁面端 `checkSignInMessage`，用記憶體中臨時產生的合成金鑰與 `node:sqlite` 上的真 migration（0001–0004），時鐘固定 2026-09-29T12:00:00Z，不連網路（ERC-1271 路徑用只回 `eth_getCode = "0x"` 的本機替身）。

**腳本這一版有改**：A-6 移除了每個（地址, 網段）的 challenge 冷卻，`WALLET_CHALLENGE_BUDGET` 已不存在，腳本不再 import 它，改為對同一地址從同一網段在一分鐘內要 6 次 challenge：**6 次都是 200**（上一輪審查的版本會拒絕第 6 次），同一地址從另一網段同時也是 200；對同一網段在一分鐘內要 30 個不同地址的 challenge：30 次 200，第 31 次回 429 `SIGN_IN_BUSY`（log 行的 `reason` 為 `network`），另一網段同時仍是 200；logout-all 撤銷 2 個 session。檔頭的來源 commit、Worker version 與行號也更新為 4321bb4／`1a0dd495`、`server/auth.ts:346`、`src/world/auth.ts:243-247`。

除了範例訊息，輸出也示範：頁面端檢查對 6 種竄改的結果、Origin、flow、重送、過期、錯誤簽章作廢 challenge、「沒有 code」快取、上述每地址與每網段的行為、logout-all、拒絕 log 的內容（客戶端只以 `net`（其 /24）出現）、session 的 `wallet_type`／`verification_method`。輸出 `siwe-sample/siwe-sample-output.txt` 不含簽章，cookie 已遮蔽。每次執行地址與 nonce 會不同，其餘結構相同。

## 7. 帶金鑰讀取與 limiter 綁定的探測

`probes/keyed-reads-probe.mjs`：用真實 handler、假鏈與合成金鑰，列出不持有任何東西的呼叫者能觸發哪些帶金鑰的 Alchemy 讀取、經過哪些預算，以及缺少 limiter 綁定時的回應。腳本沒有改，2026-09-30T11:59:49Z 重跑：輸出（`probes/keyed-reads-probe-output.txt`）除了上一輪檔頭的時間戳記那一行之外，與上一輪逐字相同。重點：EOA 同一 challenge 送 5 次錯誤簽章只觸發 1 次 `eth_getCode`，之後都是 409（連正確簽章也是）；同一 EOA 下一個 challenge 的錯誤簽章 0 次鏈上讀取；合約地址的錯誤簽章每個 challenge 最多 `eth_getCode`＋`eth_call` 各一次；`chain:code` 被拒時 0 次讀取並回 429 `CHAIN_BUSY`（附 log 行）；verify 用 `verify:` 鍵；自建 session 的 `home?fresh=1` 會扣 `chain:index`，被拒時 0 次讀取並回 `recheck=limited`；正式網址缺 `AUTH_LIMITER` 時 challenge 回 503 `LIMITER_UNAVAILABLE`（loopback 回 200）；所有 limiter 都拒絕時，logout-all 仍回 200、logout 仍回 204。

## 8. 測試資料的來源

- `source/tests/fixtures/swarm-2026-09-27.json`：IMD 公開名冊 API（`api.imd.fun/swarm`）的回應快照（檔內時間 2026-09-26T17:17:45Z）。其中的席位持有者地址是名冊（公開 API）資料，只出現在這個 fixture；測試裡的其他地址都是合成或虛構的。
- `source/tests/fixtures/activity-0759z.json`：IMD 公開活動資料的快照。
- `source/tests/fixtures/wallet-panel.mjs`（新）不含資料：它只把父程序傳來的狀態交給 `WalletPanel.tsx` 渲染，頁面主機固定為 `imdember.com`。
- 測試中的錢包金鑰都在執行時於記憶體隨機產生（`tests/wallet-harness.mjs`），執行結束即丟棄。測試用的 IP 都是保留位址：文件用（RFC 5737、RFC 3849）、`100.64.0.0/10`（RFC 6598）與 loopback。
- `source/tests/deploy-evidence.test.mjs:13` 的假 email（`example.com` 保留網域）、假本機路徑與假 UUID，都是用來確認它們**不會**出現在輸出裡的測試資料。

## 9. 團隊端、不在本快照內的紀錄

- 完整原始碼的 `npm test`（726 項，本檔第 2 節）、私人 checkout 中 `tests/deploy-evidence.test.mjs` 的 2/2、前端重建與部署紀錄及正式檔案的逐位元組比對（`DEPLOYMENT_MATCH.md` 第 2 節）。
- 這些屬於團隊端證據；依審查規格的交付要求，**既有團隊 log 不算 reviewer 重新執行的測試**。
