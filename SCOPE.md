# SCOPE：審查範圍、World/Mint 邊界與已公開的原始碼

對象：https://imdember.com 正式 World，Worker version `1a0dd495-35e7-4052-ba84-332e787f864d`，部署的來源 commit `4321bb4da3826276919ed60ecc2018139dcaeacc`。本快照的 `source/` 取自其後的 commit `132228cf746cb41cd9e3a5124a5903e9ab2da386`，兩者在每個會進入 Worker 或前端 build 的公開檔案上相同（之後只改了 `docs/security/AUDIT_REMEDIATION_STATUS.md`、`tests/review-record.test.mjs` 與兩頁部署證據）。
行號都指本快照 `source/` 內的檔案（除 `REDACTIONS.md` 第 1 節列出的 8 個檔案的遮蔽外，內容與 commit 132228c 的 git blob 逐位元組相同；遮蔽不改變行數）。被保留檔案的行號以 commit 132228c 為準，屬團隊端證據。

本 repo 的前兩個 commit 是先前的審查對象：`c2a8c33`（來源 0def8cb、Worker beac62be，Swarm job 4bd31cfb）與 `b6e986b`（來源 2da46cd、Worker 50c688c9，Swarm Report e48d0a96 與 Audit 519db624）。之後的變更與每個 Swarm 發現的對應，見 `README.md`「自送審版本以來的變更」。

## 1. 納入與排除（依持有人審查規格的範圍分類）

| 分類 | 本輪處理 | 本快照位置 |
|---|---|---|
| World 錢包連線與登入 | 納入：Connect、頁面端訊息檢查、SIWE、challenge、verify、session、logout、logout-all、過期（含本機時鐘上的到期）與恢復、登入的分層速率與預算限制 | `SIWE.md`、`WALLET_METHODS.md`、`ROUTES.md` |
| World 帳號狀態 | 納入：首次連線、換帳號、換鏈、多分頁、拒簽、晚回應（較舊的查詢結果被丟棄）、登出所有裝置 | `SIWE.md` 第 7 節 |
| IMD 與房屋 | 納入：目前持有席位、`ownerOf`、候選來源（IMD 名冊、NFT 索引、索引被拒時保存在 D1 的上一次答案）與候選上限、「我家」、一錢包一房與席位數、轉手後權限更新、「進入我的家」的閘門 | `OWNERSHIP_AND_HOMES.md`、`DATA_SCHEMA.md` |
| World API／WebSocket | 納入：上述功能的後端授權、快取、NFT 轉手後的更新。**沒有 WebSocket**（見第 5 節） | `ROUTES.md` |
| 必要 World 網站安全 | 納入：middleware、依賴、第三方 script、XSS／CSRF／Origin、資料暴露；也包括本版為載入速度加上的 Worker 端共用快取（只放公開的世界資料） | `DEPENDENCIES.md`、`ROUTES.md` |
| Genesis Mint 專用功能 | **排除**：Solidity mint 合約、authorize／finalize、signer 生命週期、鑄造交易、部署管理 | 本檔第 3 節（邊界證據）；`source/docs/security/MINT_BOUNDARY.md` 只列邊界問題 |
| Genesis 永久內容 | **排除**：metadata 凍結、模型核准、GLB／PNG 鑄造驗收、IPFS／pinning | 同上 |
| World 的 3D、地形、美術、音樂、新手引導、房屋分配與擺放規則、房屋內部的繪製、主畫面接線、世界資料的讀取 | **不公開原始碼**（持有人決定），但逐檔列出雜湊；它們都在公開的正式前端檔案裡，可從 bundle 檢查 | 第 6 節、`manifests/withheld-source.txt` |

## 2. 目前正式上線的 World 功能（以 4321bb4 為準）

已上線：

1. **瀏覽世界**：3D 村莊依公開 IMD agent 網路資料繪製，不需登入、不需錢包。資料經 `/api/world/*`（唯讀代理；本版起 Worker 在每個據點的 Cache API 保存一份公開資料的共用副本，`worker/app.ts:40-58`）或瀏覽器直接讀 DEX Screener 行情。
2. **查看任一錢包（未驗證）**：輸入或連接一個地址，可看該地址在 IMD 公開名冊裡的席位與「這個錢包的家」。只是公開資料的顯示，**沒有任何屋主權利**（`GET /api/wallet/:address/assets`，`source:'imd'`）。
3. **錢包登入（SIWE）**：一次點擊完成連線與簽名。頁面先逐行檢查伺服器給的訊息，不符就不要求簽名；簽名視窗開著時顯示從訊息讀回的摘要；session 7 天。challenge 受 D1 內的每網段與全站預算限制（全站上限中保留一部分給最近一分鐘沒發過的網段；不會因為地址而拒絕）；verify 判定的驗簽失敗會作廢該 challenge（`SIWE.md`）。
4. **登出**：「登出此裝置」（`POST /api/auth/logout`）與「登出所有裝置」（`POST /api/auth/logout-all`，行內再確認一次）。
5. **屋主模式（owner mode）**：登入後伺服器以 `ownerOf` 驗證該 session 地址的席位；至少一個席位計入、而且 session 在本機時鐘上尚未到期時（`src/world/auth.ts:54-67`），地圖上該錢包的房子標為「我家」，可以「回家」（移動鏡頭）、「搬家」與「進入我的家」。
6. **搬家（僅本機）**：需要屋主模式；結果只存在這個瀏覽器的 localStorage，只改變自己畫面上的房子位置，不寫伺服器、不呼叫錢包、不簽章。
7. **進入我的家（房屋內部，僅本機繪製）**：只有 `homeEntry.ts` 的 `enterGate` 為 `ok`（屋主模式、session 未過期、家的讀取結果屬於 session 地址、房子屬於該地址）時，頁面才在門口或房屋區塊提供「進入我的家」，按下時再檢查一次（`enterAtPress`，`src/world/homeEntry.ts:26-30`）。房屋內部是延遲載入的 chunk，只用已經讀到的 `/api/me/home` 席位資料繪製（另外只載入同 origin 的靜態模型 `/models/interior/*.glb`），不發出新的 API 請求、不呼叫錢包、不寫伺服器（`OWNERSHIP_AND_HOMES.md` 第 5 節）。
8. **我的錢包面板**：列出 session 地址經驗證的席位及是否計入；錢包沒有以 EIP-6963 表明身分時顯示一行提醒（`WalletPanel.tsx:106`）；鏈上查核不完整（索引查詢被拒，或候選被截斷）時顯示說明，而且不會說成「沒有席位」（`WalletPanel.tsx:116,122,132`，文字在 `walletView.ts:27-55`）；角色 NFT（Pepe）欄位顯示「即將推出」（`WalletPanel.tsx:143`，`CHARACTER_COLLECTIONS=[]`）；底部是收合的「審查紀錄／Swarm Audit Record」（`WalletPanel.tsx:157`）。
9. **在線紀錄與清理**：cron 每 15 分鐘把 IMD 名冊列為在線的席位寫入 D1 `seat_presence`，並刪除簽發超過 10 分鐘、從未使用的 challenge，已結束超過一天的 challenge 與 session，以及（本版新增）讀取超過 8 天的索引答案 `index_candidates`（`server/presence.ts:28-58`）。

目前**沒有**：伺服器端的房屋登記與伺服器端搬家、一個錢包多間房、角色 NFT（Pepe）collection、任何 mint、資產授權、付款、session key 或執行委派。與規格驗收基準的差異整理在第 4 節。

## 3. World/Mint 邊界

結論分兩層：

- **目前正式部署（已檢視）**：imdember.com 上的 World **沒有接入 Genesis Mint**。World 的原始碼、前端檔案、Worker bundle 與路由設定裡都沒有 Mint 程式或 Mint API。
- **日後的 Genesis Mint（持有人說明；本輪沒有檢視）**：持有人先前已說明，日後的 Mint 頁面會在 `imdember.com`（與 World **同一個 origin**），並**使用本站的 SIWE 登入狀態**；Mint 會在上線前另外審查。團隊的原則（公開版修正狀態文件引述）：World 的登入 session 不能直接當成「使用者已授權 Mint」；Mint 是否需要獨立且明確的簽名或交易確認，由 Mint 自己的規格與審查決定。Report e48d0a96 的 G-1～G-3 與 S-2 清單寫在 `source/docs/security/MINT_BOUNDARY.md`；那一頁只列問題，不審查也不描述任何 Mint 程式。

| 面向 | 目前正式部署（imdember.com） | 日後 Genesis Mint 頁面（持有人說明，未檢視） | 證據與類型 |
|---|---|---|---|
| origin | World 只在 `imdember.com`（`wrangler.jsonc:32` custom domain；`workers_dev:false`、`preview_urls:false`，`:35-36`）。`www.imdember.com` 回 301、`imd.stickember.com` 回 302 到 `https://imdember.com/`（較早一輪的公開 HEAD 觀測，本輪沒有重測）。對該 Worker 的 workers.dev 主機名稱 GET 回 404（團隊端觀測，較早一輪） | `imdember.com` 上的頁面，同一個 origin | 設定可自行驗證；Mint 部分為持有人說明 |
| session／cookie | `__Host-imd_session`、`__Host-imd_flow`：`__Host-` 前綴、`Path=/`、無 `Domain`，只屬於 `imdember.com`（`server/auth.ts:22,230`）。同 origin 的任何頁面都會帶這兩個 cookie | 使用本站的 SIWE 登入狀態（同 origin，即同一組 cookie）；G-1：World session 不是 Mint 授權（`MINT_BOUNDARY.md:19-24`） | cookie 設定可自行驗證；Mint 部分為持有人說明與團隊文件 |
| 前端 | 沒有 Mint 程式。正式主 JS（`index-BFVt9xb_.js`，SHA-256 `ec1f3da3…58d2`）與房屋內部 chunk（`InteriorView-wZGOk4w6.js`，`13616a88…cbbd`）中 `ipfs`、`tokenURI`、`finalize`、`eth_sendTransaction`、`signTypedData`、`wallet_switchEthereumChain`、`WebSocket`、`EventSource` 都是 0 次；`.request({method:` 恰好 3 處（都在主 JS）。不區分大小寫的 `genesis` 共 4 處：主 JS 2 處（雕像模型的來源／出處說明字串），chunk 2 處（UI 文字「Pepe Genesis 尚未鑄造，這座櫃子之後會放你的收藏」的中英文）；`authorize` 3 處都在主 JS，是 SIWE statement 與簽名前說明的「does not authorize」／「authorizes no」；`mint` 主 JS 12 處（three.js 的 `numIntersection`／`cubeUV_minTileSize`、CSS 色名 `mintcream`、「minted seat」說明文字）、chunk 1 處（上述 UI 文字）；`import(` 主 JS 1 處，就是載入房屋內部 chunk 的 `import(\`./InteriorView-wZGOk4w6.js\`)` | 本輪不存在；上線前另行審查 | 可自行驗證（下載正式檔案，2026-09-30T11:57Z 取得；計數與上一輪相同，`WALLET_METHODS.md` 第 3 節） |
| 後端路由 | 程式層面：Worker 只有 `handleAccountApi`（`/api/auth/*`、`/api/me/*`、`/api/wallet/*`）與 `handleWorldApi`（`/api/world/*`），兩者都回 `null` 時一律轉交 `env.ASSETS.fetch`，沒有任何 Mint handler（`worker/app.ts:109-117`、`server/auth.ts:462-475`、`server/world-api.ts:44-47`）。本版的共用快取鍵在 `/api/world/_shared/v1/…` 之下，用戶端請求這個路徑是 404（`worker/app.ts:40-45`）。平台層面：依 `wrangler.jsonc:26,30`（`run_worker_first` 四組前綴、SPA fallback），`/api/mint` 這類路徑應由 Static Assets 直接回 `index.html`、不執行 Worker；**這一點是依設定推論，沒有用實際請求驗證** | 本輪不存在；上線前另行審查 | 程式可自行驗證；Worker bundle 可自行重建（`DEPLOYMENT_MATCH.md` 第 3 節）；平台行為為推論 |
| 資料層 | repo 內只有這個 Worker 綁定 D1 `imd-world`（`wrangler.jsonc:62`，ID 已遮蔽）。IMD 帳號的 Workers & Pages 只有 `imd-world`（imdember.com）一個應用程式：持有人提供的 Cloudflare dashboard 截圖（2026-09-29，較早一輪）確認（reviewer 無法獨立驗證）；本輪沒有用 wrangler 查詢 | 登入狀態存於 D1 `imd-world` 的 `sessions`；Mint 頁面如何讀取未說明；上線前另行審查 | 設定可自行驗證；帳號內容為持有人提供的截圖 |
| 簽名服務 | **沒有簽名服務**，伺服器沒有私鑰。Worker 的 `Env` 只有 `ASSETS`、4 個 rate limiter、`ALCHEMY_API_KEY`、`DB`、`CHAIN_MOCK_OWNERS`（`worker/app.ts:19-20`）。伺服器只「驗」簽：`recoverMessageAddress` 與 ERC-1271 `isValidSignature`（view call）（`server/auth.ts:290-315`） | 本輪不存在（沒有 Mint 合約或 signer）；Mint 合約上線前另行審查 | 可自行驗證 |

補充：

- （團隊端）在 132228c 的 113 個被保留程式檔（第 6.3 節）中，`tokenURI`、`/api/mint`、`finalize`、`ipfs`、`signTypedData`、`eth_sendTransaction` 都是 0 次；沒有 Mint 合約、mint／authorize／finalize 路由、IPFS 上傳、signer 或 Mint UI。房屋內部的「Pepe 櫃」只顯示「尚未鑄造」的文字，不呼叫錢包也不讀鏈（chunk 中 `.request(` 的 3 處都是繪製迴圈自己的 `this.request()`，見 `WALLET_METHODS.md` 第 3 節）。
- Pepe 角色 collection：`src/world/collections.ts:6` 是空陣列；伺服器在清單為空時直接回 `{items:[],state:'ok'}`，不做需要金鑰的鏈上讀取（`server/ownership.ts:275-276`）。

## 4. 房屋規則與規格差異

**產品規則**（持有人決定）：一個錢包一間房，房內可以有多個席位；房子大小跟著該錢包目前計入的席位數變。審查規格中「一個錢包可以有多間房」這句**不採用**。reviewer 應檢查實作是否符合「一錢包一房、多席位」，而不是以「多間房」作為缺陷依據。

實作（公開部分）：

- 房子大小：1 個 → s、2–3 → ms、4–6 → m、7–9 → l、10 以上 → xl（`src/world/houseSize.ts:6`）。
- 伺服器 `/api/me/home` 計算的 `eligible`／`size` 只計入：經 `ownerOf` 驗證持有、是 agent（有 agentId）、且 24 小時內在線的席位（`server/ownership.ts:247-252,256-262`）。候選超過 256 個時先檢查可能計入的席位，並標為 `partial`（`server/ownership.ts:136-138,212,232-233`；A-4）。
- 地圖上的房子由用戶端依公開 IMD 名冊計算，每個錢包一間；分配與擺放規則的原始碼不公開（第 6 節），行為說明見 `OWNERSHIP_AND_HOMES.md` 第 5 節。

**與規格驗收基準的差異**（第一列是持有人已定案的產品規則，是審查基準而不是缺陷；其餘各列持有人尚未正式簽核，reviewer 應把它們當成已揭露的差異）：

| 規格項目 | 目前實作 | 位置 |
|---|---|---|
| 規格中「一個錢包可以有多間房」與「多間房屋」的敘述 | **不採用**：一錢包一房，房內多席位 | `src/world/houseSize.ts:1-3` 註解；`server/ownership.ts:256-262` |
| 規格中的「主要住所」 | **不適用**：一錢包只有一間房 | — |
| 規格中「玩家能實際進入有權使用的房屋」 | 屋主可以「進入我的家」，只限 session 地址自己的房子；閘門是用戶端的 `enterGate`（按下時再檢查一次），背後的權限來自伺服器 session＋`ownerOf`。房屋內部只在本機繪製，沒有伺服器端的「進屋」狀態 | `src/world/homeEntry.ts:11-30`；`OWNERSHIP_AND_HOMES.md` 第 5 節 |
| 規格中「不能只增加前端標籤就視為完成」 | 「我家」與「進入我的家」是**前端標記與前端閘門**；背後的權限判斷（屋主模式）來自伺服器 session＋`ownerOf`，但屋主模式不會啟用任何伺服器端寫入 | `src/world/walletView.ts:61-65`、`src/world/auth.ts:54-67`、`homeEntry.ts:11-18` |
| 搬家（規格未明訂） | 只存在本機瀏覽器的 localStorage，其他玩家看不到，不寫伺服器 | `src/world/moves.ts:62-70` |

## 5. #361／#921 與 WebSocket

- **#361、#921 沒有任何特權。** 它們是規格指定的測試座位案例，在 World 裡只是「特色守印者」的展示位置。所有引用都只影響畫面，全部在被保留的前端檔案內（團隊端證據；reviewer 可在正式 bundle 中檢查），例如 `layout.ts:566` 的 `FEATURED_HOMES` 展示座標、地圖 beacon 的順序、首個畫面的鏡頭目標、場景標籤與一行 UI 文字；房屋內部的預覽用假席位（`src/world/interior/mockSeats.ts:10`，只在開發模式或 `?debug=1` 的預覽中使用，不屬於任何房子，`homeEntry.ts:53-59`）的前兩個編號也是 361、921。
- 已公開的 `server/`、`worker/` 沒有以席位編號做任何判斷；唯一出現 361 的地方是 `server/chain-mock.ts:4` 的註解，拿它當只在 loopback 生效的測試替身設定範例。測試（`tests/ownership.test.mjs`、`tests/wallet-client.test.mjs`、`tests/home-entry.test.mjs`）用 361、921 當合成案例，持有人是每次隨機產生的測試金鑰。
- **沒有 WebSocket 或任何持續連線。** 公開的 `src/`、`server/`、`worker/`、重建的 Worker bundle 與正式前端檔案都沒有 `WebSocket`、`EventSource` 或 `WebSocketPair`。多分頁同步只用本機 `BroadcastChannel('imd-ember-auth')`（`src/world/WalletPanel.tsx:20`），而且只觸發重新向伺服器讀 session，不信任訊息內容（`src/world/auth.ts:144`）。分頁可見時，屋主狀態每 60 秒以 `GET /api/me/home` 重查（輪詢，不是推播；`src/world/auth.ts:100,311-317`）；分頁重新顯示時結束已到期的 session 並重讀伺服器（`src/world/auth.ts:130-135`）。

## 6. 公開與保留的原始碼

### 6.1 已公開（`source/`，72 個檔案）

- **Worker 與伺服器（全部）**：`worker/index.ts`、`worker/app.ts`（rate limit、網段鍵、`verify:` 與 `chain:code` 鍵、缺綁定時 fail closed、chain access、世界資料的共用快取）、`server/auth.ts`（SIWE、session、cookie、Origin、分層登入預算、logout-all、refusal log、帳號路由）、`server/ownership.ts`、`server/presence.ts`、`server/d1.ts`、`server/world-api.ts`、`server/gateway.ts`、`server/chain-mock.ts`（只在 loopback 生效的測試替身）、`server/vite-plugin.ts`（本機開發伺服器接線）
- **Worker 在執行期 import 的 `src/world/` 模組**：`cadence.ts`、`collections.ts`、`houseSize.ts`、`links.ts`、`market.ts`、`model.ts`、`siwe.ts`、`status.ts`。Worker 的 import 範圍與上一版相同：重建的 Worker bundle 的 sourcemap 列出的專案檔案正好是 `worker/` 兩個、`server/` 六個（`auth`、`ownership`、`presence`、`gateway`、`world-api`、`chain-mock`；不含型別專用的 `d1.ts` 與開發用的 `vite-plugin.ts`）加這 8 個模組，共 16 個（`DEPLOYMENT_MATCH.md` 第 3 節）
- **用戶端錢包／登入與屋主權限**：`src/world/auth.ts`（登入狀態機）、`siwe.ts`（頁面端檢查與摘要）、`wallet.ts`（EIP-6963）、`WalletPanel.tsx`、`walletView.ts`（屋主標記、簽名摘要、查核不完整時的說明、登出按鈕）、`reviewRecord.ts`、`auditRecord.ts`（審查紀錄）、`moves.ts`（搬家閘門）、`homeEntry.ts`（「進入我的家」閘門）、`HomePanels.tsx`（`WalletPanel` 用到的房屋區塊與「進入我的家」按鈕）、`i18n.tsx`、進入點 `src/main.tsx`、`publicHashes.ts`／`publicUrl.ts`（見下表）
- **資料層**：`migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql`、`0004_index_candidates.sql`
- **設定**：`index.html`、`public/_headers`、`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`wrangler.jsonc`（遮蔽）、`.nvmrc`、`.gitignore`
- **部署出處與證據腳本**：`scripts/deploy.mjs`（部署前先跑完整測試）、`scripts/deploy-evidence.mjs`
- **測試**：`tests/{auth,wallet-client,ownership,presence,worker,headers,deploy,deploy-evidence,home-entry,review-record,dependencies}.test.mjs`、`tests/wallet-harness.mjs`、`tests/d1-sqlite.mjs`、`tests/fixtures/{cold-home.mjs,cold-verify.mjs,swarm-2026-09-27.json,activity-0759z.json,wallet-panel.mjs}`
- **文件**：`docs/wallet-login/DESIGN_W1_v001.md`（有遮蔽）、`docs/security/AUDIT_REMEDIATION_STATUS.md`（公開版，有遮蔽；`tests/review-record.test.mjs` 會讀它）、`docs/security/MINT_BOUNDARY.md`、`docs/security/deploy-evidence/` 的 5 頁部署證據

本版新增的 11 個檔案（上一版 61 個）與收錄理由：

| 檔案 | 收錄理由 |
|---|---|
| `migrations/0004_index_candidates.sql` | A-2：Worker 用的新表 `index_candidates`；沒有它無法重現 D1 schema 與測試 |
| `src/world/publicHashes.ts`、`src/world/publicUrl.ts` | 公開靜態檔的雜湊檔名（載入速度改善）。公開的 `vite.config.ts:7-8` 與 `tests/headers.test.mjs:6-7` import 它們，前端 bundle 也包含它們；與登入無關 |
| `tests/dependencies.test.mjs` | F-6 的後續：檢查 lockfile 的 undici 不在 GHSA-3wwx-pv8p-q78v 的範圍，以及 `package.json` 的 override 仍然需要 |
| `tests/fixtures/wallet-panel.mjs` | A-8：用專案自己的 TypeScript 編譯 `WalletPanel.tsx`，以 react-dom/server 實際渲染面板，供 `tests/wallet-client.test.mjs:609` 檢查畫面文字 |
| `docs/security/MINT_BOUNDARY.md` | Report 的 G-1～G-3 與 S-2 清單；`AUDIT_REMEDIATION_STATUS.md` 與 `DESIGN_W1_v001.md` 連到它，`tests/review-record.test.mjs:207` 檢查它。不含任何 Mint 程式 |
| `docs/security/deploy-evidence/20260928T210413Z-1a0ba21.md`、`20260929T050441Z-2da46cd.md`、`20260929T172429Z-5398b90.md`、`20260929T195417Z-4321bb4.md`、`20260930T064805Z-df8ea90.md` | 每次部署的結構化欄位（版本、雜湊、migration、limiter 綁定、WAF 規則與它的 rule id），由 `scripts/deploy-evidence.mjs` 從團隊的部署紀錄產生，不含 log 文字。`AUDIT_REMEDIATION_STATUS.md` 引用它們，`tests/review-record.test.mjs` 檢查它們存在。內容是團隊端證據 |

選擇原則：判斷「連錢包、簽名登入與屋主權限是否安全」所需的程式、完整的伺服器端（讓 reviewer 能重建 Worker bundle），以及讓這些程式的測試能執行的最小依賴。

### 6.2 保留（484 個檔案）

3D 場景、地形（含本版的地形預烘 `skin/terrainBake.ts`、`skin/terrainField.ts` 與分段計算 `skin/terrainTask.ts`）、模型與模型下載佇列、天氣（含「為什麼是這種天氣」`weatherWhy.ts`）、美術、音樂、新手引導、標籤、觀測站、地圖 UI、Pepe 裝飾與雕像、非官方聲明的 UI（`unofficial.ts`）、房屋分配與擺放（`households.ts`、`layout.ts`、`layoutBaked.ts`、`collision.ts` 與其測試）、房屋內部的繪製與家具（`src/world/interior/*`、`HomeDoor.tsx`、`public/models/interior/*`）、`WorldApp.tsx`（主畫面接線）、世界資料的讀取與資料模式（`bridge.ts`、`dataMode.ts`）、舊的 StickEmber 小遊戲殘留（**不在正式 bundle 裡**）、其他測試、腳本、文件與圖檔。與上一版相比新增 34 個保留檔案（大多是載入速度改善、非官方聲明與天氣說明的程式與測試）；上一版保留的部署證據頁 `20260928T210413Z-1a0ba21.md` 本版改為公開。清單與 SHA-256：`manifests/withheld-source.txt`；git blob id：`manifests/withheld-source-gitblobs.txt`（都以 commit 132228c 為準）。

### 6.3 被裁切的模組關係（誠實揭露）

已公開 → 被保留（公開檔案 import 了未公開檔案）：

| 公開檔案 | import 種類 | 被保留檔案 | 影響 |
|---|---|---|---|
| `src/main.tsx:3-8` | value | `src/world/WorldApp.tsx`、`bridge.ts`、`dataMode.ts`、`skin/terrainTask.ts`、`screenSpace.ts`，以及 Vite 在 build 時產生的虛擬模組 `virtual:baked-terrain` | 前端無法從 `source/` 建置（`bridge.ts` 以下是本版的早期讀取與地形預烘） |
| `vite.config.ts:9-11` | value | `scripts/content-hash.ts`、`src/world/skin/terrainField.ts`、`src/world/skin/terrainBake.ts` | 同上（build 設定本身；本版新增） |
| `src/world/homeEntry.ts:5-6` | value（`HOUSE_FOOTPRINT`、`HOUSE_SIZES`、`lotPoint`） | `src/world/households.ts`、`src/world/layout.ts` | 門口位置的幾何（`doorPoint`、`atDoor`、`doorLanding`）需要被保留的房屋尺寸與擺放；授權閘門（`enterGate`、`enterableHome`、`enterAtPress`、`offersEnter`、`blockEnter`、`doorOffer`）不用它們。測試用替身見 `TESTS/stubs/` |
| `src/world/walletView.ts:3` | type-only（`Home`） | `src/world/households.ts` | 只影響型別檢查 |
| `src/world/WalletPanel.tsx:3` | type-only（`Home`） | `src/world/households.ts` | 同上 |
| `src/world/HomePanels.tsx:2-3` | type-only（`Home`、`HouseSize`、`HomePose`） | `src/world/households.ts`、`src/world/layout.ts` | 同上 |
| `tests/ownership.test.mjs:7` | value（`houseSize`） | `src/world/households.ts` | 該檔只是轉出公開的 `houseSize.ts`；替身即可執行 |
| `tests/home-entry.test.mjs:70` | 動態 import（`mockSeats`） | `src/world/interior/mockSeats.ts` | 只有 `?interior=` 預覽那一項測試需要，本快照無法執行 |

另外一個不是檔案、而是 git 歷史的依賴：`tests/deploy-evidence.test.mjs:52` 執行 `git rev-parse 3f661eb`（私人 repo 的 commit，Report 的修正），比較 A-1 前後證據頁列出的 limiter 鍵。本快照複製出的 repo 沒有這個 commit，所以該測試在本快照失敗；團隊的 checkout 中它通過（團隊端）。

**本快照的失敗與上表的對應**（2026-09-30 的執行，原始輸出在 `TESTS/`）：

| 執行 | 結果 | 失敗的原因 |
|---|---|---|
| `npx tsc --noEmit`（不加替身，11:56:38Z） | exit 2，16 行錯誤 | 全部來自被保留的 import：`src/main.tsx` 6 行（第 3–8 行）、`homeEntry.ts` 2 行（第 5–6 行）、`HomePanels.tsx` 2 行（第 2–3 行）加上連帶產生的 1 個 TS7006（第 18 行）、`WalletPanel.tsx` 1 行（第 3 行）、`walletView.ts` 1 行（第 3 行）、`vite.config.ts` 3 行（第 9–11 行）（`TESTS/tsc-noEmit-output.txt`） |
| `npm test` 加上兩個替身（11:56:27Z） | 171 項、167 通過、4 失敗 | `home-entry.test.mjs:53`「the door…」與 `:91`「TEST-1: the render rules…」：替身不提供 `HOUSE_FOOTPRINT`／`lotPoint`；`home-entry.test.mjs:62`「group 8: the ?interior= preview…」：缺 `mockSeats.ts`；`deploy-evidence.test.mjs:31`「deploy evidence from a real deploy record…」：缺私人 git 歷史（上段）（`TESTS/npm-test-output.txt`） |
| `npm test` 不加替身（11:56:19Z） | 96 項、92 通過、4 失敗 | `ownership.test.mjs`（第 7 行 import `households.ts`）、`home-entry.test.mjs` 與 `wallet-client.test.mjs`（經 `homeEntry.ts:5-6`）三個檔案無法載入；加上同一項 deploy-evidence 測試（`TESTS/npm-test-output.no-stub.txt`） |

Worker 不 import 任何被保留的檔案（`tests/ownership.test.mjs:481`「the Worker entry never loads layout.ts or households.ts…」以實際載入固定這一點）。

被保留 → 已公開（未公開檔案使用公開模組；團隊端，132228c）：

| 被保留檔案 | 使用的公開模組 |
|---|---|
| `src/world/WorldApp.tsx` | `WalletPanel.tsx`（`WalletPanel`、`WalletChip`、`createAuth`、`useAuth`）、`auth.ts`（`ownerAddress`）、`wallet.ts`、`walletView.ts`（`markedHome`、`markerLabel`）、`moves.ts`（`readMoves`、`commitMove`、`moveGate`）、`homeEntry.ts`（`enterableHome`、`enterAtPress`、`blockEnter`、`doorOffer`、`interiorPreview`）、`HomePanels.tsx`，以及世界資料用的 `model.ts`、`market.ts`、`links.ts`、`cadence.ts`、`status.ts`、`i18n.tsx` |
| `src/world/HomeDoor.tsx` | `homeEntry.ts`（`chunkLoader`），延遲載入 `src/world/interior/InteriorView.tsx` |
| `src/world/scene.ts` | `homeEntry.ts`（`nearOwnDoor`、`doorPoint`、`doorLanding`） |
| `src/world/interior/*` | `auth.ts` 的型別（`AuthState`、`MeSeat`）、`walletView.ts`（`countsText`）；席位資料來自 `WorldApp` 傳入的屋主狀態（即 `/api/me/home` 的結果） |
| `src/world/households.ts` | `model.ts`、`houseSize.ts`、`moves.ts`（型別） |
| `src/world/assets.ts`、`pepeDecor.ts`、`Observatory.ts`、`skin/houses.ts` | `publicUrl.ts`（雜湊檔名） |

**`WorldApp.tsx` 的錢包與「進入」接線**：原始碼不公開，但編譯後的程式完整存在於公開的正式主 bundle `https://imdember.com/assets/index-BFVt9xb_.js`（SHA-256 `ec1f3da3…58d2`），reviewer 可以直接讀。可用下列字串定位（壓縮後的字串用反引號）：

| 在 bundle 中搜尋 | 對應的接線 |
|---|---|
| `` eip6963:requestProvider ``、`` personal_sign ``、`` imd-ember-auth ``、`` ember-world-session-hint `` | 公開的 `wallet.ts`／`auth.ts`／`WalletPanel.tsx` 編譯後的位置 |
| `` /api/me/home ``、`` /api/auth/logout-all `` | 屋主狀態重查、登出所有裝置 |
| `` ember-world-moves-v1 `` | 搬家的本機儲存 |
| `` Enter your home `` | 「進入我的家」的兩個按鈕（房屋區塊與門口提示），只在 `enterableHome` 不為 null 時出現 |
| `` InteriorView-wZGOk4w6.js `` | 房屋內部 chunk 的唯一一個動態 `import(` |
| `` get(`debug`) `` | `?interior=` 預覽只在 `?debug=1`（或開發模式）開啟，只用假資料，不屬於任何房子（`homeEntry.ts:53-59`） |
| `` get(`mode`) ``、`` get(`wallet`) `` | `?mode=mock` 假資料模式；`?wallet=0x…` 只移動鏡頭，不給任何權利 |

`commitMove` 與 `enterGate` 都自己再檢查一次屋主狀態，不依賴呼叫端（`src/world/moves.ts:64-66`、`src/world/homeEntry.ts:11-30`）。無論 `WorldApp` 怎麼接線，屋主模式都不會啟用任何伺服器寫入（`OWNERSHIP_AND_HOMES.md` 第 5 節）。

對被保留檔案做的檢查（團隊端，2026-09-30，在 132228c 的 113 個被保留程式檔上執行，也就是 `manifests/withheld-source.txt` 中 `tests/` 以外的 `.ts`、`.tsx`、`.mjs`、`.js`；reviewer 可在正式 bundle 上複查）：`window.ethereum`、`eip6963`、`personal_sign`、`eth_`、`/api/auth`、`/api/me`、`/api/wallet`、`document.cookie`、`innerHTML`、`dangerouslySetInnerHTML`、`eval(`、`new Function`、`BroadcastChannel`、`WebSocket`、`EventSource` 都是 **0 次**。`postMessage` 1 次：`src/world/skin/terrainTask.ts:35`，同一頁內 `MessageChannel` 的兩端互傳 `null`，用來讓出一次事件迴圈，不是跨視窗訊息。`.request(` 3 次，全部是房屋內部繪製迴圈自己的 `this.request()`（`src/world/interior/room.ts:124,312,343`），不是 EIP-1193。`import(` 只有：`HomeDoor.tsx:9` 的房屋內部 chunk、`scene.ts:264,927` 兩處只在開發模式的 `devCapture`（production build 會移除）、`skin/devCapture.ts:38` 的 three.js，以及三個離線腳本（`interior-glb.mjs`、`pepe-decor.mjs`、`pepe-frame.mjs`）的 `sharp`。`fetch(` 只出現在 `src/world/bridge.ts`（`/api/world/*` 資料與 DEX Screener 行情）、`src/world/assets.ts:64`（同 origin 的模型檔）、`src/world/skin/terrainTask.ts:21`（同 origin 的預烘地形檔）、只在開發模式的 `skin/devCapture.ts`，以及兩個不進 bundle 的離線腳本（`capture-imd.mjs`、`found_homes.mjs`，讀 `api.imd.fun`）；`modelFetch.ts:1` 是註解，`musicPlayer.ts` 的 `prefetch` 是 `HTMLAudioElement` 預載，不是 `fetch(`。localStorage 只用於偏好設定（音效、地圖收合、首次導覽、慶祝紀錄、效能指標）與 `WorldApp.tsx:55` 的搬家儲存（另有兩個離線腳本 `build-map-handoff.mjs`、`export_plan.mjs` 在說明文字中提到它）。正式主 bundle 中的 `innerHTML`（5 處）與 `dangerouslySetInnerHTML`（12 處）都在打包進來的 React DOM 程式碼內，數量與上一輪相同；房屋內部 chunk 兩者都是 0。

## 7. 未知與限制

- **Genesis Mint**：持有人說明日後的 Mint 頁面會在同一個 origin、使用本站的 SIWE 登入狀態；本輪 World 沒有任何 Mint 程式、路由、合約、signer 或 UI（第 3 節）。`MINT_BOUNDARY.md` 只列問題，不是任何 Mint 的審查。
- **正式執行的版本**：目前執行 `1a0dd495` 是團隊說明，本輪沒有用 wrangler 查詢部署狀態。2026-09-30 06:48–09:27 UTC 之間執行的是 `6e7e40cd`（來源 `df8ea90`，Worker bundle 相同、前端不同），之後以 `wrangler rollback` 回到 `1a0dd495`；`df8ea90` 的原始碼不在本快照，那段時間的前端檔案也不在本輪比對之內（`README.md`「部署經過」）。
- 其他 Worker／Pages：持有人提供的 Cloudflare dashboard 截圖（2026-09-29，較早一輪）顯示 IMD 帳號只有 `imd-world` 一個應用程式（reviewer 無法獨立驗證）。
- 邊緣限流：`imdember.com` zone 的 Cloudflare WAF rate limiting rule「IMD API anti-flood」（`/api/` 每 IP 每 10 秒 20 次，Block 10 秒；rule id `866d2fae97c942389a9fa9f15c411f46`，記在部署證據頁）；設定與實測為團隊端證據（`ROUTES.md` 第 4 節）。
- 正式 D1 的 schema 是否與 `migrations/0001`～`0004` 相同：本輪禁止查詢正式資料庫；「0003 在部署 f9b68223 之前、0004 在部署 1a0dd495 之前套用」都是團隊端說明。若 0003 沒有套用，verify 的 session INSERT 會因 `wallet_type` 欄位不存在而失敗，登入回 503 `AUTH_UNAVAILABLE` 並寫一行 log（不會放行，`server/auth.ts:423-427`）。若 0004 沒有套用，`index_candidates` 的讀寫失敗會被忽略，退回每個 instance 自己的索引答案，房屋讀取與 cron 不會失敗（`server/ownership.ts:151-152,161-173`、`server/presence.ts:52`）。
- 4 個 rate limiter 在正式環境：`API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `wrangler.jsonc` 一致：持有人提供的截圖（2026-09-29，較早一輪）確認（reviewer 無法獨立驗證）；部署證據頁也列出同樣的綁定（團隊端）。本版沒有新增綁定：A-1 的 `chain:erc1271:lane` 是 `CHAIN_LIMITER` 裡的另一個鍵（`server/auth.ts:190`），`verify:` 鍵共用 `AUTH_LIMITER`，`chain:code` 共用 `API_LIMITER`（`worker/app.ts:80-83`）。
- `CHAIN_LIMITER`、`AUTH_LIMITER` 與 `chain:code` 是**每個 Cloudflare 據點**各自計數，不是全球，而且是最終一致的；全球性的只有 D1 內的預算（`SIWE.md` 第 6 節）。文件與測試中的攻擊門檻（例如 A-1、A-7）是本機精確 limiter 的結果，在邊緣不一定成立。
- Cloudflare 實際執行的 Worker 程式碼與機密設定：外部無法取得；上傳的 bundle 可自行重建比對（`DEPLOYMENT_MATCH.md`）。
- 前端：`WorldApp.tsx`、房屋擺放、房屋內部、世界資料讀取與地形的程式不公開，前端無法從 `source/` 重建，只能對公開的正式檔案檢查。
- 瀏覽器與真實錢包 E2E：本快照沒有執行，見 `TESTS/README.md`。
