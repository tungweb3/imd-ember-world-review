# SCOPE：審查範圍、World/Mint 邊界與已公開的原始碼

對象：https://imdember.com 正式 World，Worker version `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f`，來源 commit `2da46cdafcf8ad3fb3571ea0273ecc5d1ab5be1d`。
行號都指本快照 `source/` 內的檔案（除 `REDACTIONS.md` 第 1 節列出的 8 個檔案的遮蔽外，內容與 commit 2da46cd 的 git blob 逐位元組相同；遮蔽不改變行數）。被保留檔案的行號也以 commit 2da46cd 為準，屬團隊端證據。

送審版本（本 repo 第一個 commit `c2a8c33`，來源 0def8cb、Worker beac62be）之後的變更與每個 Swarm 發現的對應，見 `README.md`「自送審版本以來的變更」。

## 1. 納入與排除（依持有人審查規格的範圍分類）

| 分類 | 本輪處理 | 本快照位置 |
|---|---|---|
| World 錢包連線與登入 | 納入：Connect、頁面端訊息檢查、SIWE、challenge、verify、session、logout、logout-all、過期與恢復、登入的分層速率與預算限制 | `SIWE.md`、`WALLET_METHODS.md`、`ROUTES.md` |
| World 帳號狀態 | 納入：首次連線、換帳號、換鏈、多分頁、拒簽、晚回應、登出所有裝置 | `SIWE.md` 第 7 節 |
| IMD 與房屋 | 納入：目前持有席位、`ownerOf`、「我家」、一錢包一房與席位數、轉手後權限更新、「進入我的家」的閘門 | `OWNERSHIP_AND_HOMES.md` |
| World API／WebSocket | 納入：上述功能的後端授權、快取、NFT 轉手後的更新。**沒有 WebSocket**（見第 5 節） | `ROUTES.md` |
| 必要 World 網站安全 | 納入：middleware、依賴、第三方 script、XSS／CSRF／Origin、資料暴露 | `DEPENDENCIES.md`、`ROUTES.md` |
| Genesis Mint 專用功能 | **排除**：Solidity mint 合約、authorize／finalize、signer 生命週期、鑄造交易、部署管理 | 本檔第 3 節（邊界證據） |
| Genesis 永久內容 | **排除**：metadata 凍結、模型核准、GLB／PNG 鑄造驗收、IPFS／pinning | 同上 |
| World 的 3D、地形、美術、音樂、新手引導、房屋分配與擺放規則、房屋內部的繪製、主畫面接線 | **不公開原始碼**（持有人決定），但逐檔列出雜湊；它們都在公開的正式前端檔案裡，可從 bundle 檢查 | 第 6 節、`manifests/withheld-source.txt` |

## 2. 目前正式上線的 World 功能（以 2da46cd 為準）

已上線：

1. **瀏覽世界**：3D 村莊依公開 IMD agent 網路資料繪製，不需登入、不需錢包。資料經 `/api/world/*`（唯讀代理）或瀏覽器直接讀 DEX Screener 行情。
2. **查看任一錢包（未驗證）**：輸入或連接一個地址，可看該地址在 IMD 公開名冊裡的席位與「這個錢包的家」。只是公開資料的顯示，**沒有任何屋主權利**（`GET /api/wallet/:address/assets`，`source:'imd'`）。
3. **錢包登入（SIWE）**：一次點擊完成連線與簽名。頁面先逐行檢查伺服器給的訊息，不符就不要求簽名；簽名視窗開著時顯示從訊息讀回的摘要；session 7 天。challenge 受 D1 內的每網段、每錢包與全站預算限制；verify 判定的驗簽失敗會作廢該 challenge（`SIWE.md`）。
4. **登出**：「登出此裝置」（`POST /api/auth/logout`）與「登出所有裝置」（`POST /api/auth/logout-all`，行內再確認一次）。
5. **屋主模式（owner mode）**：登入後伺服器以 `ownerOf` 驗證該 session 地址的席位，至少一個席位計入時，地圖上該錢包的房子標為「我家」，可以「回家」（移動鏡頭）、「搬家」與「進入我的家」。
6. **搬家（僅本機）**：需要屋主模式；結果只存在這個瀏覽器的 localStorage，只改變自己畫面上的房子位置，不寫伺服器、不呼叫錢包、不簽章。
7. **進入我的家（房屋內部，僅本機繪製）**：只有 `homeEntry.ts` 的 `enterGate` 為 `ok`（屋主模式、session 未過期、家的讀取結果屬於 session 地址、房子屬於該地址）時，頁面才在門口或房屋區塊提供「進入我的家」。房屋內部是延遲載入的 chunk，只用已經讀到的 `/api/me/home` 席位資料繪製（另外只載入同 origin 的靜態模型 `/models/interior/*.glb`），不發出新的 API 請求、不呼叫錢包、不寫伺服器（`OWNERSHIP_AND_HOMES.md` 第 5 節）。
8. **我的錢包面板**：列出 session 地址經驗證的席位及是否計入；錢包沒有以 EIP-6963 表明身分時顯示一行提醒（`WalletPanel.tsx:105`）；NFT 索引查詢被預算拒絕時顯示一行說明（`WalletPanel.tsx:115`）；角色 NFT（Pepe）欄位顯示「即將推出」（`CHARACTER_COLLECTIONS=[]`）；底部是收合的「審查紀錄／Swarm Audit Record」（`WalletPanel.tsx:157`）。
9. **在線紀錄與清理**：cron 每 15 分鐘把 IMD 名冊列為在線的席位寫入 D1 `seat_presence`，並刪除簽發超過 10 分鐘、從未使用的 challenge，以及已結束超過一天的 challenge 與 session（`server/presence.ts:29-46`，本版未改）。

目前**沒有**：伺服器端的房屋登記與伺服器端搬家、一個錢包多間房、角色 NFT（Pepe）collection、任何 mint、資產授權、付款、session key 或執行委派。與規格驗收基準的差異整理在第 4 節。

## 3. World/Mint 邊界

結論分兩層：

- **目前正式部署（已檢視）**：imdember.com 上的 World **沒有接入 Genesis Mint**。World 的原始碼、前端檔案、Worker bundle 與路由設定裡都沒有 Mint 程式或 Mint API。
- **日後的 Genesis Mint（持有人說明；本輪沒有檢視）**：持有人表示，Genesis Mint 頁面日後會做成 `imdember.com` 的子頁面（與 World **同一個 origin**），並**使用本站的 SIWE 登入狀態**；Mint 頁面與它的合約會在上線前另外審查。團隊的原則（公開版修正狀態文件引述）：World 的登入 session 不能直接當成「使用者已授權 Mint」；Mint 是否需要獨立且明確的簽名或交易確認，由 Mint 自己的規格與審查決定。

| 面向 | 目前正式部署（imdember.com） | 日後 Genesis Mint 頁面（持有人說明，未檢視） | 證據與類型 |
|---|---|---|---|
| origin | World 只在 `imdember.com`（`wrangler.jsonc:32` custom domain；`workers_dev:false`、`preview_urls:false`，`:35-36`）。`www.imdember.com` 回 301、`imd.stickember.com` 回 302 到 `https://imdember.com/`（前一輪的公開 HEAD 觀測，本輪沒有重測）。對該 Worker 的 workers.dev 主機名稱 GET 回 404（團隊端觀測，前一輪） | `imdember.com` 的子頁面，同一個 origin | 設定可自行驗證；Mint 部分為持有人說明 |
| session／cookie | `__Host-imd_session`、`__Host-imd_flow`：`__Host-` 前綴、`Path=/`、無 `Domain`，只屬於 `imdember.com`（`server/auth.ts:22,199`）。同 origin 的任何頁面都會帶這兩個 cookie | 使用本站的 SIWE 登入狀態（同 origin，即同一組 cookie） | cookie 設定可自行驗證；Mint 部分為持有人說明 |
| 前端 | 沒有 Mint 程式。正式主 JS（`index-Bj4ribmm.js`，SHA-256 `70742ed4…f528`）與房屋內部 chunk（`InteriorView-Xan3ABOQ.js`，`fbd4e640…70b0`）中 `ipfs`、`tokenURI`、`finalize`、`eth_sendTransaction`、`signTypedData`、`wallet_switchEthereumChain`、`WebSocket`、`EventSource` 都是 0 次；`.request({method:` 恰好 3 處（都在主 JS）。不區分大小寫的 `genesis` 共 4 處：主 JS 2 處（雕像模型的來源／出處說明字串），chunk 2 處（UI 文字「Pepe Genesis 尚未鑄造，這座櫃子之後會放你的收藏」的中英文）；`authorize` 3 處都是 SIWE statement 與簽名前說明的「does not authorize」；`mint` 主 JS 12 處（three.js 的 `numIntersection`／`cubeUV_minTileSize`、CSS 色名 `mintcream`、「minted seat」說明文字）、chunk 1 處（上述 UI 文字）；`import(` 主 JS 1 處，就是載入房屋內部 chunk 的 `import(\`./InteriorView-Xan3ABOQ.js\`)` | 本輪不存在；上線前另行審查 | 可自行驗證（下載正式檔案，2026-09-29T05:52Z 計數，`WALLET_METHODS.md` 第 3 節） |
| 後端路由 | 程式層面：Worker 只有 `handleAccountApi`（`/api/auth/*`、`/api/me/*`、`/api/wallet/*`）與 `handleWorldApi`（`/api/world/*`），兩者都回 `null` 時一律轉交 `env.ASSETS.fetch`，沒有任何 Mint handler（`worker/app.ts:88-95`、`server/auth.ts:409-421`、`server/world-api.ts:43-45`）。平台層面：依 `wrangler.jsonc:26,30`（`run_worker_first` 四組前綴、SPA fallback），`/api/mint` 這類路徑應由 Static Assets 直接回 `index.html`、不執行 Worker；**這一點是依設定推論，沒有用實際請求驗證** | 本輪不存在；上線前另行審查 | 程式可自行驗證；Worker bundle 可自行重建（`DEPLOYMENT_MATCH.md` 第 3 節）；平台行為為推論 |
| 資料層 | repo 內只有這個 Worker 綁定 D1 `imd-world`（`wrangler.jsonc:61`，ID 已遮蔽）。IMD 帳號的 Workers & Pages 只有 `imd-world`（imdember.com）一個應用程式：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）確認（reviewer 無法獨立驗證）；本輪沒有用 wrangler 查詢 | 登入狀態存於 D1 `imd-world` 的 `sessions`；Mint 頁面如何讀取未說明；上線前另行審查 | 設定可自行驗證；帳號內容為持有人提供的截圖 |
| 簽名服務 | **沒有簽名服務**，伺服器沒有私鑰。Worker 的 `Env` 只有 `ASSETS`、4 個 rate limiter、`ALCHEMY_API_KEY`、`DB`、`CHAIN_MOCK_OWNERS`（`worker/app.ts:19-20`）。伺服器只「驗」簽：`recoverMessageAddress` 與 ERC-1271 `isValidSignature`（view call）（`server/auth.ts:252-275`） | 本輪不存在（沒有 Mint 合約或 signer）；Mint 合約上線前另行審查 | 可自行驗證 |

補充：

- （團隊端）`0def8cb..2da46cd` 的 commit 中沒有任何 Mint 合約、mint／authorize／finalize 路由、IPFS 上傳、tokenURI、signer 或 Mint UI；房屋內部的「Pepe 櫃」只顯示「尚未鑄造」的文字，不呼叫錢包也不讀鏈（chunk 中 `.request(` 的 3 處都是繪製迴圈自己的 `this.request()`，見 `WALLET_METHODS.md` 第 3 節）。
- Pepe 角色 collection：`src/world/collections.ts:6` 是空陣列；伺服器在清單為空時直接回 `{items:[],state:'ok'}`，不做需要金鑰的鏈上讀取（`server/ownership.ts:216-217`）。

## 4. 房屋規則與規格差異

**產品規則**（持有人決定）：一個錢包一間房，房內可以有多個席位；房子大小跟著該錢包目前計入的席位數變。審查規格中「一個錢包可以有多間房」這句**不採用**。reviewer 應檢查實作是否符合「一錢包一房、多席位」，而不是以「多間房」作為缺陷依據。

實作（公開部分）：

- 房子大小：1 個 → s、2–3 → ms、4–6 → m、7–9 → l、10 以上 → xl（`src/world/houseSize.ts:6`）。
- 伺服器 `/api/me/home` 計算的 `eligible`／`size` 只計入：經 `ownerOf` 驗證持有、是 agent（有 agentId）、且 24 小時內在線的席位（`server/ownership.ts:188-202`）。
- 地圖上的房子由用戶端依公開 IMD 名冊計算，每個錢包一間；分配與擺放規則的原始碼不公開（第 6 節），行為說明見 `OWNERSHIP_AND_HOMES.md` 第 5 節。

**與規格驗收基準的差異**（第一列是持有人已定案的產品規則，是審查基準而不是缺陷；其餘各列持有人尚未正式簽核，reviewer 應把它們當成已揭露的差異）：

| 規格項目 | 目前實作 | 位置 |
|---|---|---|
| 規格中「一個錢包可以有多間房」與「多間房屋」的敘述 | **不採用**：一錢包一房，房內多席位 | `src/world/houseSize.ts:1-3` 註解；`server/ownership.ts:196-202` |
| 規格中的「主要住所」 | **不適用**：一錢包只有一間房 | — |
| 規格中「玩家能實際進入有權使用的房屋」 | **本版新增**：屋主可以「進入我的家」，只限 session 地址自己的房子；閘門是用戶端的 `enterGate`，背後的權限來自伺服器 session＋`ownerOf`。房屋內部只在本機繪製，沒有伺服器端的「進屋」狀態 | `src/world/homeEntry.ts:11-39`；`OWNERSHIP_AND_HOMES.md` 第 5 節 |
| 規格中「不能只增加前端標籤就視為完成」 | 「我家」與「進入我的家」是**前端標記與前端閘門**；背後的權限判斷（屋主模式）來自伺服器 session＋`ownerOf`，但屋主模式不會啟用任何伺服器端寫入 | `src/world/walletView.ts:32-36`、`src/world/auth.ts:49-61`、`homeEntry.ts:11-18` |
| 搬家（規格未明訂） | 只存在本機瀏覽器的 localStorage，其他玩家看不到，不寫伺服器 | `src/world/moves.ts:64-70` |

## 5. #361／#921 與 WebSocket

- **#361、#921 沒有任何特權。** 它們是規格指定的測試座位案例，在 World 裡只是「特色守印者」的展示位置。所有引用都只影響畫面，全部在被保留的前端檔案內（團隊端證據；reviewer 可在正式 bundle 中檢查），例如 `layout.ts` 的 `FEATURED_HOMES` 展示座標、地圖 beacon 的順序、首個畫面的鏡頭目標、場景標籤與一行 UI 文字；房屋內部的預覽用假席位（`src/world/interior/mockSeats.ts`，只在開發模式或 `?debug=1` 的預覽中使用，不屬於任何房子，`homeEntry.ts:48-54`）的前兩個編號也是 361、921。
- 已公開的 `server/`、`worker/` 完全沒有以席位編號引用這兩個數字，所以不影響登入、所有權或屋主權限。測試（`tests/ownership.test.mjs`、`tests/wallet-client.test.mjs`、`tests/home-entry.test.mjs`）用 361、921 當合成案例，持有人是每次隨機產生的測試金鑰。
- **沒有 WebSocket 或任何持續連線。** 公開的 `src/`、`server/`、`worker/`、重建的 Worker bundle 與正式前端檔案都沒有 `WebSocket`、`EventSource` 或 `WebSocketPair`。多分頁同步只用本機 `BroadcastChannel('imd-ember-auth')`，而且只觸發重新向伺服器讀 session，不信任訊息內容（`src/world/auth.ts:109`）。分頁可見時，屋主狀態每 60 秒以 `GET /api/me/home` 重查（輪詢，不是推播；`src/world/auth.ts:87,271-277`）。

## 6. 公開與保留的原始碼

### 6.1 已公開（`source/`，61 個檔案）

- **Worker 與伺服器（全部）**：`worker/index.ts`、`worker/app.ts`（rate limit、網段鍵、`verify:` 與 `chain:code` 鍵、缺綁定時 fail closed、chain access）、`server/auth.ts`（SIWE、session、cookie、Origin、分層登入預算、logout-all、refusal log、帳號路由）、`server/ownership.ts`、`server/presence.ts`、`server/d1.ts`、`server/world-api.ts`、`server/gateway.ts`、`server/chain-mock.ts`（只在 loopback 生效的測試替身）、`server/vite-plugin.ts`（本機開發伺服器接線）
- **Worker 在執行期 import 的 `src/world/` 模組**：`cadence.ts`、`collections.ts`、`houseSize.ts`、`links.ts`、`market.ts`、`model.ts`、`status.ts`，以及本版新增的 `siwe.ts`（statement 由伺服器與頁面共用）。重建的 Worker bundle 的 sourcemap 列出的專案檔案正好是 `worker/` 兩個、`server/` 六個（不含型別專用的 `d1.ts` 與開發用的 `vite-plugin.ts`）加這 8 個模組，共 16 個（`DEPLOYMENT_MATCH.md` 第 3 節）
- **用戶端錢包／登入與屋主權限**：`src/world/auth.ts`（登入狀態機）、`siwe.ts`（頁面端檢查與摘要）、`wallet.ts`（EIP-6963）、`WalletPanel.tsx`、`walletView.ts`（屋主標記、簽名摘要、登出按鈕）、`reviewRecord.ts`、`auditRecord.ts`（審查紀錄）、`moves.ts`（搬家閘門）、`homeEntry.ts`（「進入我的家」閘門）、`HomePanels.tsx`（`WalletPanel` 用到的房屋區塊與「進入我的家」按鈕）、`i18n.tsx`、進入點 `src/main.tsx`
- **資料層**：`migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql`
- **設定**：`index.html`、`public/_headers`、`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`wrangler.jsonc`（遮蔽）、`.nvmrc`、`.gitignore`
- **部署出處與證據腳本**：`scripts/deploy.mjs`（部署前先跑完整測試）、`scripts/deploy-evidence.mjs`
- **測試**：`tests/{auth,wallet-client,ownership,presence,worker,headers,deploy,deploy-evidence,home-entry,review-record}.test.mjs`、`tests/wallet-harness.mjs`、`tests/d1-sqlite.mjs`、`tests/fixtures/{cold-home.mjs,cold-verify.mjs,swarm-2026-09-27.json,activity-0759z.json}`
- **文件**：`docs/wallet-login/DESIGN_W1_v001.md`（有遮蔽）、`docs/security/AUDIT_REMEDIATION_STATUS.md`（公開版，有遮蔽；`tests/review-record.test.mjs` 會讀它）

選擇原則：判斷「連錢包、簽名登入與屋主權限是否安全」所需的程式、完整的伺服器端（讓 reviewer 能重建 Worker bundle），以及讓這些程式的測試能執行的最小依賴。

### 6.2 保留（451 個檔案）

3D 場景、地形、模型、天氣、美術、音樂、新手引導、標籤、觀測站、地圖 UI、Pepe 裝飾與雕像、房屋分配與擺放（`households.ts`、`layout.ts`、`collision.ts` 與其測試）、房屋內部的繪製與家具（`src/world/interior/*`、`HomeDoor.tsx`、`public/models/interior/*`）、`WorldApp.tsx`（主畫面接線）、舊的 StickEmber 小遊戲殘留（**不在正式 bundle 裡**）、其他測試、腳本、文件（包括部署證據頁 `docs/security/deploy-evidence/*`）與圖檔。清單與 SHA-256：`manifests/withheld-source.txt`；git blob id：`manifests/withheld-source-gitblobs.txt`。

### 6.3 被裁切的模組關係（誠實揭露）

已公開 → 被保留（公開檔案 import 了未公開檔案）：

| 公開檔案 | import 種類 | 被保留檔案 | 影響 |
|---|---|---|---|
| `src/main.tsx:3` | value | `src/world/WorldApp.tsx` | 前端無法從 `source/` 建置 |
| `src/world/homeEntry.ts:5-6` | value（`HOUSE_FOOTPRINT`、`HOUSE_SIZES`、`lotPoint`） | `src/world/households.ts`、`src/world/layout.ts` | 門口位置的幾何（`doorPoint`、`atDoor`、`doorLanding`）需要被保留的房屋尺寸與擺放；授權閘門（`enterGate`、`enterableHome`、`offersEnter`、`blockEnter`、`doorOffer`）不用它們。測試用替身見 `TESTS/stubs/` |
| `src/world/walletView.ts:3` | type-only（`Home`） | `src/world/households.ts` | 只影響型別檢查 |
| `src/world/WalletPanel.tsx:3` | type-only（`Home`） | `src/world/households.ts` | 同上 |
| `src/world/HomePanels.tsx:2-3` | type-only（`Home`、`HouseSize`、`HomePose`） | `src/world/households.ts`、`src/world/layout.ts` | 同上 |
| `tests/ownership.test.mjs:5` | value（`houseSize`） | `src/world/households.ts` | 該檔只是轉出公開的 `houseSize.ts`；替身即可執行 |
| `tests/home-entry.test.mjs:70` | 動態 import（`mockSeats`） | `src/world/interior/mockSeats.ts` | 只有 `?interior=` 預覽那一項測試需要，本快照無法執行 |

以上就是 `tsc --noEmit` 的全部錯誤來源（`TESTS/tsc-noEmit-output.txt`，另有一個由缺少型別連帶產生的 TS7006）。Worker 不 import 任何被保留的檔案（`tests/ownership.test.mjs` 的「the Worker entry never loads layout.ts or households.ts」以實際載入固定這一點）。

被保留 → 已公開（未公開檔案使用公開模組；團隊端）：

| 被保留檔案 | 使用的公開模組 |
|---|---|
| `src/world/WorldApp.tsx` | `WalletPanel.tsx`、`auth.ts`（`createAuth`、`useAuth`、`ownerAddress`）、`wallet.ts`、`walletView.ts`（`markedHome`）、`moves.ts`、`homeEntry.ts`（`enterableHome`、`blockEnter`、`doorOffer`、`interiorPreview`）、`HomePanels.tsx` |
| `src/world/HomeDoor.tsx` | `homeEntry.ts`（`chunkLoader`），延遲載入 `src/world/interior/InteriorView.tsx` |
| `src/world/scene.ts` | `homeEntry.ts`（`nearOwnDoor`、`doorPoint`、`doorLanding`） |
| `src/world/interior/*` | `auth.ts` 的型別（`AuthState`、`MeSeat`）；席位資料來自 `WorldApp` 傳入的屋主狀態（即 `/api/me/home` 的結果） |
| `src/world/households.ts` | `model.ts`、`houseSize.ts`、`moves.ts`（型別） |

**`WorldApp.tsx` 的錢包與「進入」接線**：原始碼不公開，但編譯後的程式完整存在於公開的正式主 bundle `https://imdember.com/assets/index-Bj4ribmm.js`（SHA-256 `70742ed4…f528`），reviewer 可以直接讀。可用下列字串定位（壓縮後的字串用反引號）：

| 在 bundle 中搜尋 | 對應的接線 |
|---|---|
| `` eip6963:requestProvider ``、`` personal_sign ``、`` imd-ember-auth ``、`` ember-world-session-hint `` | 公開的 `wallet.ts`／`auth.ts` 編譯後的位置 |
| `` /api/me/home ``、`` /api/auth/logout-all `` | 屋主狀態重查、登出所有裝置 |
| `` ember-world-moves-v1 `` | 搬家的本機儲存 |
| `` Enter your home `` | 「進入我的家」的兩個按鈕（房屋區塊與門口提示），只在 `enterableHome` 不為 null 時出現 |
| `` InteriorView-Xan3ABOQ.js `` | 房屋內部 chunk 的唯一一個動態 `import(` |
| `` get(`debug`) `` | `?interior=` 預覽只在 `?debug=1`（或開發模式）開啟，只用假資料，不屬於任何房子（`homeEntry.ts:48-54`） |
| `` get(`mode`) ``、`` get(`wallet`) `` | `?mode=mock` 假資料模式；`?wallet=0x…` 只移動鏡頭，不給任何權利 |

`commitMove` 與 `enterGate` 都自己再檢查一次屋主狀態，不依賴呼叫端（`src/world/moves.ts:64-66`、`src/world/homeEntry.ts:11-24`）。無論 `WorldApp` 怎麼接線，屋主模式都不會啟用任何伺服器寫入（`OWNERSHIP_AND_HOMES.md` 第 5 節）。

對被保留檔案做的檢查（團隊端，2026-09-29，在 2da46cd 的 97 個被保留程式檔上執行；reviewer 可在正式 bundle 上複查）：`window.ethereum`、`eip6963`、`personal_sign`、`eth_`、`/api/auth`、`/api/me`、`/api/wallet`、`document.cookie`、`innerHTML`、`dangerouslySetInnerHTML`、`eval(`、`new Function`、`postMessage`、`BroadcastChannel` 都是 **0 次**。`.request(` 3 次，全部是房屋內部繪製迴圈自己的 `this.request()`（`src/world/interior/room.ts:124,312,343`），不是 EIP-1193。`import(` 只有：`HomeDoor.tsx:9` 的房屋內部 chunk、`scene.ts` 兩處只在開發模式的 `devCapture`（production build 會移除）、`devCapture.ts` 內的 three.js，以及兩個離線腳本的 `sharp`。`fetch(` 只出現在 `src/world/bridge.ts`（`/api/world/*` 資料）、只在開發模式的 `devCapture.ts`，以及兩個不進 bundle 的離線腳本（讀 `api.imd.fun`）；`musicPlayer.ts` 的 `prefetch` 是 `HTMLAudioElement` 預載，不是 `fetch(`。localStorage 只用於偏好設定（音效、語言、地圖收合、首次導覽、慶祝紀錄、效能指標）與 `WorldApp.tsx:53` 的搬家儲存。正式主 bundle 中的 `innerHTML`（5 處）與 `dangerouslySetInnerHTML`（12 處）全部在打包進來的 React DOM 程式碼內；房屋內部 chunk 兩者都是 0。

## 7. 未知與限制

- **Genesis Mint**：持有人說明日後會是 `imdember.com` 的同 origin 子頁面，使用本站的 SIWE 登入狀態；本輪 World 沒有任何 Mint 程式、路由、合約、signer 或 UI（第 3 節）。
- 其他 Worker／Pages：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）顯示 IMD 帳號只有 `imd-world` 一個應用程式（reviewer 無法獨立驗證）。
- 邊緣限流：`imdember.com` zone 的 Cloudflare WAF rate limiting rule（`/api/` 每 IP 每 10 秒 20 次，Block 10 秒）；設定與實測為團隊端證據（`ROUTES.md` 第 4 節）。
- 正式 D1 的 schema 是否與 `migrations/0001`～`0003` 相同：本輪禁止查詢正式資料庫；「0003 已在部署 f9b68223 之前套用」是團隊端說明。若 0003 沒有套用，verify 的 session INSERT 會因 `wallet_type` 欄位不存在而失敗，登入回 503 `AUTH_UNAVAILABLE` 並寫一行 log（不會放行，`server/auth.ts:370-374`）。
- 4 個 rate limiter 在正式環境：`API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `wrangler.jsonc` 一致：持有人提供的截圖（2026-09-29，前一輪）確認（reviewer 無法獨立驗證）。本版沒有新增綁定：`verify:` 鍵共用 `AUTH_LIMITER`，`chain:code` 共用 `API_LIMITER`（`worker/app.ts:61-64`）。
- `CHAIN_LIMITER`、`AUTH_LIMITER` 與 `chain:code` 是**每個 Cloudflare 據點**各自計數，不是全球；全球性的只有 D1 內的預算（`SIWE.md` 第 6 節）。
- Cloudflare 實際執行的 Worker 程式碼與機密設定：外部無法取得；上傳的 bundle 可自行重建比對（`DEPLOYMENT_MATCH.md`）。
- 前端：`WorldApp.tsx`、房屋擺放與房屋內部的程式不公開，前端無法從 `source/` 重建，只能對公開的正式檔案檢查。
- 瀏覽器與真實錢包 E2E：本快照沒有執行，見 `TESTS/README.md`。
