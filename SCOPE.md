# SCOPE：審查範圍、World/Mint 邊界與已公開的原始碼

對象：https://imdember.com 正式 World，Worker version `beac62be-27ff-40cd-9dc4-3cbbdc6add4b`，來源 commit `0def8cb5b80083d32545c59bc707fbbc92a4758d`。
行號都指本快照 `source/` 內的檔案（除 `REDACTIONS.md` 第 1 節列出的 5 個檔案的遮蔽外，內容與 commit 0def8cb 的 git blob 逐位元組相同；遮蔽不改變行數）。被保留檔案的行號也以 commit 0def8cb 為準，屬團隊端證據；（團隊端，reviewer 無法從本 repo 驗證，因為本 repo 只列出 0def8cb 的 blob id）被保留的檔案在 30449b2 → 0def8cb 之間只有 repo 的 `README.md` 與 `tests/linkage-gateway.test.mjs` 改變，其餘不變。

## 1. 納入與排除（依持有人審查規格的範圍分類）

| 分類 | 本輪處理 | 本快照位置 |
|---|---|---|
| World 錢包連線與登入 | 納入：Connect、SIWE、challenge、verify、session、logout、過期與恢復、登入的速率與預算限制 | `SIWE.md`、`WALLET_METHODS.md` |
| World 帳號狀態 | 納入：首次連線、換帳號、換鏈、多分頁、拒簽、晚回應 | `SIWE.md` 第 7 節 |
| IMD 與房屋 | 納入：目前持有席位、`ownerOf`、「我家」、一錢包一房與席位數、轉手後權限更新 | `OWNERSHIP_AND_HOMES.md` |
| World API／WebSocket | 納入：上述功能的後端授權、快取、NFT 轉手後的更新。**沒有 WebSocket**（見第 5 節） | `ROUTES.md` |
| 必要 World 網站安全 | 納入：middleware、依賴、第三方 script、XSS／CSRF／Origin、資料暴露 | `DEPENDENCIES.md`、`ROUTES.md` |
| Genesis Mint 專用功能 | **排除**：Solidity mint 合約、authorize／finalize、signer 生命週期、鑄造交易、部署管理 | 本檔第 3 節（邊界證據） |
| Genesis 永久內容 | **排除**：metadata 凍結、模型核准、GLB／PNG 鑄造驗收、IPFS／pinning | 同上 |
| World 的 3D、地形、美術、音樂、新手引導、房屋分配與擺放規則、主畫面接線 | **不公開原始碼**（持有人決定），但逐檔列出雜湊；它們都在公開的正式前端 bundle 裡，可從 bundle 檢查 | 第 6 節、`manifests/withheld-source.txt` |

## 2. 目前正式上線的 World 功能（以 0def8cb 為準）

已上線：

1. **瀏覽世界**：3D 村莊依公開 IMD agent 網路資料繪製，不需登入、不需錢包。資料經 `/api/world/*`（唯讀代理）或瀏覽器直接讀 DEX Screener 行情。
2. **查看任一錢包（未驗證）**：輸入或連接一個地址，可看該地址在 IMD 公開名冊裡的席位與「這個錢包的家」。只是公開資料的顯示，**沒有任何屋主權利**（`GET /api/wallet/:address/assets`，`source:'imd'`）。
3. **錢包登入（SIWE）**：一次點擊完成連線與簽名；session 7 天；登出。challenge 受 D1 內的每網段與全站預算限制；verify 判定的驗簽失敗會作廢該 challenge（limiter 綁定缺失或 D1 故障的 503 例外，見 `SIWE.md` 第 3 節），下一次點擊取得新的 challenge（`SIWE.md`）。
4. **屋主模式（owner mode）**：登入後伺服器以 `ownerOf` 驗證該 session 地址的席位，至少一個席位計入時，地圖上該錢包的房子標為「我家」，可以「回家」（移動鏡頭）與「搬家」。
5. **搬家（僅本機）**：需要屋主模式；結果只存在這個瀏覽器的 localStorage，只改變自己畫面上的房子位置，不寫伺服器、不呼叫錢包、不簽章。
6. **我的錢包面板**：列出 session 地址經驗證的席位及是否計入；錢包沒有以 EIP-6963 表明身分時顯示一行提醒（`src/world/WalletPanel.tsx:101`、`wallet.ts:87-89`）；NFT 索引查詢被預算拒絕時顯示一行說明（`WalletPanel.tsx:110`）；角色 NFT（Pepe）欄位顯示「即將推出」（`CHARACTER_COLLECTIONS=[]`）。
7. **在線紀錄與清理**：cron 每 15 分鐘把 IMD 名冊列為在線的席位寫入 D1 `seat_presence`（用來判斷 24 小時內是否在線），並刪除簽發超過 10 分鐘、從未使用的 challenge，以及已結束超過一天的 challenge 與 session（`server/presence.ts:29-46`）。

目前**沒有**：伺服器端的房屋登記與伺服器端搬家、房屋內部（「進屋」）、一個錢包多間房、角色 NFT（Pepe）collection、任何 mint、資產授權、付款、session key 或執行委派。與規格驗收基準的差異整理在第 4 節。

## 3. World/Mint 邊界

結論分兩層：

- **目前正式部署（已檢視）**：imdember.com 上的 World **沒有接入 Genesis Mint**。不是把 Mint 按鈕藏起來，而是 World 的原始碼、前端 bundle、Worker bundle 與路由設定裡都沒有 Mint 程式或 Mint API。
- **日後的 Genesis Mint（持有人說明；本輪沒有檢視）**：持有人表示，Genesis Mint 頁面日後會做成 `imdember.com` 的子頁面（與 World **同一個 origin**），並**使用本站的 SIWE 登入狀態**；Mint 頁面與它的合約會在上線前另外審查。本輪 World 裡沒有任何 Mint 程式、路由、合約、signer 或 UI（證據見下表與補充）。因此，本輪檢視的 session／cookie／Origin／CSP 設計，也是日後 Mint 頁面會依賴的基礎。

| 面向 | 目前正式部署（imdember.com） | 日後 Genesis Mint 頁面（持有人說明，未檢視） | 證據與類型 |
|---|---|---|---|
| origin | World 只在 `imdember.com`（`wrangler.jsonc:30` custom domain；`workers_dev:false`、`preview_urls:false`，`:33-34`）。`www.imdember.com` 回 301、`imd.stickember.com` 回 302 到 `https://imdember.com/`，兩者都不設 cookie。對該 Worker 的 workers.dev 主機名稱 GET 回 404（團隊端觀測） | `imdember.com` 的子頁面，同一個 origin | 設定可自行驗證；轉址為前一輪（2026-09-28）的公開 HEAD 觀測，本輪沒有重測；Mint 部分為持有人說明 |
| session／cookie | `__Host-imd_session`、`__Host-imd_flow`：`__Host-` 前綴、`Path=/`、無 `Domain`，只屬於 `imdember.com`（`server/auth.ts:20,116-117`）。同 origin 的任何頁面都會帶這兩個 cookie | 使用本站的 SIWE 登入狀態（同 origin，即同一組 cookie） | cookie 設定可自行驗證；Mint 部分為持有人說明 |
| 前端 bundle | 沒有 Mint 程式。正式 JS（`index-BPJxeGls.js`，SHA-256 `3ba7f1e0…277e`）中 `genesis`、`ipfs`、`pinata`、`tokenURI`、`finalize`、`authorize`、`eth_sendTransaction`、`signTypedData`、`wallet_switchEthereumChain`、`WebSocket`、`EventSource`、`import(` 都是 0 次；`.request({method:` 恰好 3 處。不區分大小寫的 `mint` 共 12 處：8 處 three.js 的 `numIntersection`、2 處 three.js 的 `cubeUV_minTileSize`、1 處 CSS 色名 `mintcream`、1 處「minted seat」說明文字 | 本輪不存在；上線前另行審查 | 可自行驗證（下載正式 bundle，2026-09-28T16:06Z 計數） |
| 後端路由 | 程式層面：Worker 只有 `handleAccountApi`（`/api/auth/*`、`/api/me/*`、`/api/wallet/*`）與 `handleWorldApi`（`/api/world/*`），兩者都回 `null` 時一律轉交 `env.ASSETS.fetch`，沒有任何 Mint handler（`worker/app.ts:86-92`、`server/auth.ts:254-274`、`server/world-api.ts:43-45`）。平台層面：依 `wrangler.jsonc:24,28`（`run_worker_first` 四組前綴、SPA fallback），`/api/mint` 這類路徑應由 Static Assets 直接回 `index.html`、不執行 Worker；**這一點是依設定推論，沒有用實際請求驗證** | 本輪不存在；上線前另行審查 | 程式可自行驗證；Worker bundle 可自行重建（`DEPLOYMENT_MATCH.md` 第 3 節）；平台行為為推論 |
| 資料層 | repo 內只有這個 Worker 綁定 D1 `imd-world`（`wrangler.jsonc:55`，ID 已遮蔽）。IMD 帳號的 Workers & Pages 只有 `imd-world`（imdember.com）一個應用程式，它的綁定是 4 個 rate limiter 與 D1 `imd-world`（`DB`）：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）確認（reviewer 無法獨立驗證）；本輪沒有用 wrangler 查詢 | 登入狀態存於 D1 `imd-world` 的 `sessions`；Mint 頁面如何讀取未說明；上線前另行審查 | 設定可自行驗證；帳號內容為持有人提供的截圖 |
| 簽名服務 | **沒有簽名服務**，伺服器沒有私鑰。Worker 的 `Env` 只有 `ASSETS`、4 個 rate limiter、`ALCHEMY_API_KEY`、`DB`、`CHAIN_MOCK_OWNERS`（`worker/app.ts:19`）。伺服器只「驗」簽：`recoverMessageAddress` 與 ERC-1271 `isValidSignature`（view call）（`server/auth.ts:143-155`） | 本輪不存在（沒有 Mint 合約或 signer）；Mint 合約上線前另行審查 | 可自行驗證 |

補充：

- （團隊端，前一輪在 30449b2 上做過）私人 repo 的所有分支與 tag 都查過（`git grep` 與 `git log --all -S`），沒有 Mint 合約、mint／authorize／finalize 路由、IPFS 上傳、tokenURI、signer 或 Mint UI。「authorize」只出現在 SIWE 聲明「This does not authorize asset transfers or transactions」。30449b2 → 0def8cb 的 10 個 commit 只改了第 6.1 節列出的伺服器、登入與測試檔、`migrations/0002`、`package.json`／lock、`scripts/deploy.mjs`、`wrangler.jsonc`、設計文件、repo README 與被保留的 `tests/linkage-gateway.test.mjs`（共 23 個檔案，`git diff --stat 30449b2 0def8cb`），沒有任何 Mint 相關內容（團隊端）。
- Pepe 角色 collection：`src/world/collections.ts:6` 是空陣列；伺服器在清單為空時直接回 `{items:[],state:'ok'}`，不做需要金鑰的鏈上讀取（`server/ownership.ts:216-217`）。清單非空時，程式只做唯讀的持有顯示，而且每次索引讀取都先扣 `CHAIN_LIMITER`（`chain:assets`，`server/ownership.ts:219-221`），不是鑄造。

## 4. 房屋規則與規格差異

**產品規則**（持有人決定）：一個錢包一間房，房內可以有多個席位；房子大小跟著該錢包目前計入的席位數變。審查規格中「一個錢包可以有多間房」這句**不採用**。reviewer 應檢查實作是否符合「一錢包一房、多席位」，而不是以「多間房」作為缺陷依據。

實作（公開部分）：

- 房子大小：1 個 → s、2–3 → ms、4–6 → m、7–9 → l、10 以上 → xl（`src/world/houseSize.ts:6`）。
- 伺服器 `/api/me/home` 計算的 `eligible`／`size` 只計入：經 `ownerOf` 驗證持有、是 agent（有 agentId）、且 24 小時內在線的席位（`server/ownership.ts:188-202`：`status` 與 `home`）。
- 地圖上的房子由用戶端依公開 IMD 名冊計算，每個錢包一間；分配與擺放規則的原始碼不公開（第 6 節），行為說明見 `OWNERSHIP_AND_HOMES.md` 第 5 節。

**與規格驗收基準的差異**（第一列「一錢包一房」是持有人已定案的產品規則，是審查基準而不是缺陷；其餘各列持有人尚未正式簽核，在簽核或規格改版前，reviewer 應把它們當成已揭露的差異，而不是已被接受的基準）：

| 規格項目 | 目前實作 | 位置 |
|---|---|---|
| 規格中「一個錢包可以有多間房」與「多間房屋」的敘述 | **不採用**：一錢包一房，房內多席位 | `src/world/houseSize.ts:1-3` 註解；`server/ownership.ts:196-202` |
| 規格中的「主要住所」 | **不適用**：一錢包只有一間房，沒有「主要住所」的選擇 | — |
| 規格中「玩家能實際進入有權使用的房屋」 | **不存在**：沒有房屋內部，也沒有「進屋」 | — |
| 規格中「不能只增加前端標籤就視為完成」 | 「我家」是**前端標記加鏡頭移動**；背後的權限判斷（屋主模式）來自伺服器 session＋`ownerOf`，但屋主模式不會啟用任何伺服器端寫入 | `src/world/walletView.ts:31-35`、`src/world/auth.ts:45-57`；`OWNERSHIP_AND_HOMES.md` 第 5 節 |
| 搬家（規格未明訂） | 只存在本機瀏覽器的 localStorage，其他玩家看不到，不寫伺服器 | `src/world/moves.ts:64-70` |

## 5. #361／#921 與 WebSocket

- **#361、#921 沒有任何特權。** 它們是規格指定的測試座位案例，在 World 裡只是「特色守印者」的展示位置。所有引用都只影響畫面（全部在被保留的檔案內，團隊端證據；這些檔案在 30449b2 → 0def8cb 之間沒有變動；reviewer 可在正式 bundle 中檢查）：
  - `src/world/layout.ts:540,542`：`FEATURED_HOMES` 給兩者固定的展示座標；
  - `src/world/households.ts:121,124`：讓它們站在展示位置而不是家門前；
  - `src/world/beacons.ts:20,57,63`：地圖 beacon 的順序；
  - `src/world/overview.ts:310-318`：首個畫面的鏡頭目標；
  - `src/world/scene.ts:296,311,446,497`：標籤、底座、門前站姿與鏡頭；
  - `src/world/mock.ts:4`：mock 資料模式的假 id；
  - `src/world/WorldApp.tsx:416`：一行 UI 說明文字。
- 已公開的 `server/`、`worker/` 完全沒有以席位編號引用這兩個數字（只有 `server/chain-mock.ts:4` 註解中的例子；`server/auth.ts:8` 的「4361」是 EIP-4361），所以不影響登入、所有權或屋主權限。測試（`tests/ownership.test.mjs`、`tests/wallet-client.test.mjs`）用 361、921 當合成案例，持有人是每次隨機產生的測試金鑰。
- **沒有 WebSocket 或任何持續連線。** `src/`、`server/`、`worker/` 與兩份 bundle 都沒有 `WebSocket`、`EventSource`、`WebSocketPair` 或 `Upgrade`。多分頁同步只用本機 `BroadcastChannel('imd-ember-auth')`，而且只觸發重新向伺服器讀 session，不信任訊息內容。分頁可見時，屋主狀態每 60 秒以 `GET /api/me/home` 重查（輪詢，不是推播；`src/world/auth.ts:81`）。

## 6. 公開與保留的原始碼

### 6.1 已公開（`source/`，51 個檔案）

- **Worker 與伺服器（全部）**：`worker/index.ts`、`worker/app.ts`（rate limit、網段鍵、缺綁定時 fail closed、chain access）、`server/auth.ts`（SIWE、session、cookie、Origin、登入預算、帳號路由）、`server/ownership.ts`（ownerOf、候選、快取、索引預算）、`server/presence.ts`（cron 在線紀錄與清理）、`server/d1.ts`、`server/world-api.ts`（`API_HEADERS`、`LimiterMissing` 與 `/api/world/*`）、`server/gateway.ts`（上游讀取、`/api/world/*` 公開資料代理）、`server/chain-mock.ts`（只在 loopback 生效的測試替身）、`server/vite-plugin.ts`（本機開發伺服器接線）
- **Worker 在執行期 import 的 `src/world/` 模組**：`cadence.ts`、`collections.ts`、`houseSize.ts`、`links.ts`、`market.ts`、`model.ts`、`status.ts`。重建的 Worker bundle 的 sourcemap 列出的專案檔案正好是上述 `worker/`、`server/`（不含型別專用的 `d1.ts` 與開發用的 `vite-plugin.ts`）加這 7 個模組，共 15 個（`DEPLOYMENT_MATCH.md` 第 3 節）。30449b2 → 0def8cb 沒有新增任何被 Worker 或錢包流程 import 的檔案
- **用戶端錢包／登入流程**：`src/world/auth.ts`（登入狀態機）、`wallet.ts`（EIP-6963）、`WalletPanel.tsx`（「我的錢包」）、`walletView.ts`（屋主標記規則）、`moves.ts`（搬家閘門與本機儲存）、`HomePanels.tsx`（`WalletPanel` 用到的房屋區塊與地址縮寫）、`i18n.tsx`（面板文字）、進入點 `src/main.tsx`
- **資料層**：`migrations/0001_wallet_login.sql`、`migrations/0002_sign_in_budgets.sql`
- **設定**：`index.html`、`public/_headers`、`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`wrangler.jsonc`（遮蔽）、`.nvmrc`、`.gitignore`
- **部署出處腳本**：`scripts/deploy.mjs`（部署前先跑完整測試）
- **測試**：`tests/{auth,wallet-client,ownership,presence,worker,headers,deploy}.test.mjs`、`tests/wallet-harness.mjs`、`tests/d1-sqlite.mjs`、`tests/fixtures/{cold-home.mjs,cold-verify.mjs,swarm-2026-09-27.json,activity-0759z.json}`
- **設計文件**：`docs/wallet-login/DESIGN_W1_v001.md`（有遮蔽，見 `REDACTIONS.md` 第 1.2 節）

選擇原則：判斷「連錢包與簽名登入是否安全」所需的程式、完整的伺服器端（讓 reviewer 能重建 Worker bundle），以及讓這些程式的測試能執行的最小依賴。

### 6.2 保留（395 個檔案）

3D 場景、地形、模型、天氣、美術、音樂、新手引導、標籤、觀測站、地圖 UI、房屋分配與擺放（`households.ts`、`layout.ts`、`collision.ts`、`tests/households.test.mjs`）、`WorldApp.tsx`（主畫面接線）、舊的 StickEmber 小遊戲殘留（`src/App.tsx`、`src/game/*`、`src/style.css`，**不在正式 bundle 裡**）、其他測試、腳本、文件與圖檔。清單與 SHA-256：`manifests/withheld-source.txt`；git blob id：`manifests/withheld-source-gitblobs.txt`。

### 6.3 被裁切的模組關係（誠實揭露）

已公開 → 被保留（公開檔案 import 了未公開檔案）：

| 公開檔案 | import 種類 | 被保留檔案 | 影響 |
|---|---|---|---|
| `src/main.tsx:3` | value | `src/world/WorldApp.tsx` | 前端無法從 `source/` 建置 |
| `src/world/walletView.ts:3` | type-only（`Home`） | `src/world/households.ts` | 只影響型別檢查；Node 執行測試時型別 import 會被移除 |
| `src/world/WalletPanel.tsx:3` | type-only（`Home`） | `src/world/households.ts` | 同上 |
| `src/world/HomePanels.tsx:2-3` | type-only（`Home`、`HouseSize`、`HomePose`） | `src/world/households.ts`、`src/world/layout.ts` | 同上 |
| `tests/ownership.test.mjs:5` | value（`houseSize`） | `src/world/households.ts` | 該檔只是轉出公開的 `houseSize.ts`；用 `TESTS/stubs/households.ts` 替身即可執行（`TESTS/README.md`） |

以上就是 `tsc --noEmit` 的全部錯誤來源（`TESTS/tsc-noEmit-output.txt`，另有一個由缺少型別連帶產生的 TS7006）。Worker 不 import 任何被保留的檔案。

被保留 → 已公開（未公開檔案使用公開模組；團隊端）：

| 被保留檔案 | 使用的公開模組 |
|---|---|
| `src/world/WorldApp.tsx` | `WalletPanel.tsx`、`auth.ts`（`createAuth`、`useAuth`、`ownerAddress`）、`wallet.ts`、`walletView.ts`（`markedHome`）、`moves.ts`（`readMoves`、`commitMove`、`moveGate`）、`HomePanels.tsx` |
| `src/world/households.ts` | `model.ts`、`houseSize.ts`、`moves.ts`（型別） |
| `src/world/scene.ts`、`lamps.ts`、`afterRead.ts` 等 | `households.ts`（被保留）與公開的資料模組 |

**`WorldApp.tsx` 的錢包接線**：原始碼不公開，但編譯後的程式完整存在於公開的正式前端 bundle `https://imdember.com/assets/index-BPJxeGls.js`（SHA-256 `3ba7f1e0…277e`），reviewer 可以直接讀。可用下列字串定位（壓縮後的字串用反引號）：

| 在 bundle 中搜尋 | 對應的接線 |
|---|---|
| `` eip6963:requestProvider ``、`` personal_sign ``、`` imd-ember-auth ``、`` ember-world-session-hint `` | 公開的 `wallet.ts`／`auth.ts` 編譯後的位置，由 `WorldApp` 以 `createAuth(wallets())` 建立 |
| `` /api/me/home `` | 屋主狀態重查 |
| `` ember-world-moves-v1 `` | 搬家的本機儲存（`WorldApp.tsx:51` 以 `localStorage` 作為 `moveStore`，交給公開的 `moves.ts`） |
| `` get(`mode`) `` | `?mode=mock` 會切到假資料模式（只換資料來源與搬家儲存的 key，不影響登入或伺服器授權） |
| `` get(`wallet`) `` | `?wallet=0x…` 連結只把鏡頭移到該錢包在名冊中的房子，不給任何權利 |

團隊端另外節錄了 `WorldApp.tsx` 中與屋主相關的程式行（逐字，行號為 commit 0def8cb，與 30449b2 相同；reviewer 無法看到檔案其餘內容）：

```tsx
// 106
const auth=useMemo(()=>createAuth(wallets()),[]),authState=useAuth(auth,drawer?.kind==='home');
// 109
const canSign=!!authState.account&&address===authState.account;
// 267
const owner=ownerAddress(authState),{home:myHome,mine:ownHome}=useMemo(()=>markedHome(homes.current,owner,address),[owner,address,homesVersion]);
// 288
const startMove=()=>{if(!myHome||moveGate(authState,myHome)!=='ok')return; …
// 292
const canMove=moveGate(authState,ownHome?myHome:null)==='ok';
// 296
const next=commitMove(moveStore(),mode,moves.current,authState,myHome,selectedLot);
```

`commitMove` 自己會再檢查 `moveGate`，不依賴呼叫端（`src/world/moves.ts:64-66`）。無論 `WorldApp` 怎麼接線，屋主模式都不會啟用任何伺服器寫入（`OWNERSHIP_AND_HOMES.md` 第 5 節）。

對被保留檔案做的檢查（團隊端，reviewer 可在正式 bundle 上複查）：在被保留的 `src/`、`server/`、`worker/`、`scripts/` 程式檔中搜尋 `.request(`、`window.ethereum`、`eip6963`、`personal_sign`、`eth_`、`/api/auth`、`/api/me`、`/api/wallet`、`document.cookie`、`innerHTML`、`dangerouslySetInnerHTML`、`eval(`、`new Function`、`postMessage`、`BroadcastChannel`，**0 次**（在 30449b2 上執行；這些檔案在 0def8cb 未變）。localStorage 只用於偏好設定（音效、語言、地圖收合、首次導覽）與 `WorldApp.tsx:51` 的搬家儲存。`fetch(` 只出現在：`src/world/bridge.ts`（`/api/world/*` 資料）、`src/world/skin/devCapture.ts`（僅開發模式，production build 會移除，正式 bundle 中 `devCapture` 為 0 次），以及兩個不進 bundle 的離線腳本 `scripts/capture-imd.mjs`、`scripts/found_homes.mjs`（讀 `api.imd.fun`）。音樂播放器 `musicPlayer.ts` 用 `HTMLAudioElement`，沒有 `fetch(`。正式 bundle 中的 `innerHTML`（5 處）與 `dangerouslySetInnerHTML`（12 處）全部在打包進來的 React DOM 程式碼內（屬性處理與 `<script>` 元素建立），不是專案程式。

## 7. 未知與限制

- **Genesis Mint**：持有人說明日後會是 `imdember.com` 的同 origin 子頁面，使用本站的 SIWE 登入狀態；本輪 World 沒有任何 Mint 程式、路由、合約、signer 或 UI，Mint 頁面與合約上線前另行審查（第 3 節）。
- 其他 Worker／Pages：IMD 帳號的 Workers & Pages 只列出 `imd-world`（imdember.com）一個應用程式，所以沒有其他 Worker／Pages 綁定 D1 `imd-world`：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）確認（reviewer 無法獨立驗證）。
- 邊緣限流：`imdember.com` zone 的 Cloudflare WAF rate limiting rule 已設定並啟用（2026-09-27 起涵蓋 `/api/world/`，2026-09-29 約 01:20（+08）起涵蓋整個 `/api/`；每 IP 每 10 秒 20 次，Block 10 秒）。同一 IP 在 10 秒內超過 20 次的請求在邊緣被擋 10 秒；每 IP 每 10 秒 20 次以內（平均送時約每分鐘 120 次）的請求，以及分散在許多 IP 的請求，仍會到達 Worker 自己的 limiter 與 D1 預算。設定與實測為團隊端證據（`ROUTES.md` 第 4 節）。`server/auth.ts:36` 註解中的「planned」是 0def8cb 的原文。
- 正式 D1 的 schema 是否與 `migrations/0001` + `0002` 相同：本輪禁止查詢正式資料庫；「0002 已在部署前套用」是團隊端說明。若 0002 沒有套用，`POST /api/auth/challenge` 的 INSERT 會因 `net` 欄位不存在而失敗，登入回 503 `AUTH_UNAVAILABLE`（不會放行）。
- 4 個 rate limiter 在正式環境：`imd-world` 的綁定為 `API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `wrangler.jsonc` 一致：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）確認（reviewer 無法獨立驗證）；本輪沒有用 wrangler 查詢。程式層面，綁定**不存在**時正式網址上需要它的路由回 503（`worker/app.ts:72`），綁定存在但呼叫丟例外時 `auth`、`home`、`chain` 拒絕、`api`、`seat` 放行（`server/auth.ts:125-128`）。
- `CHAIN_LIMITER` 與 `AUTH_LIMITER` 是**每個 Cloudflare 據點**各自計數，不是全球；全球性的只有 D1 內的 challenge 預算（`SIWE.md` 第 6 節）。
- Cloudflare 實際執行的 Worker 程式碼與機密設定：外部無法取得（持有人提供的截圖只顯示 secret 名稱 `ALCHEMY_API_KEY`，值已加密）；上傳的 bundle 可自行重建比對（`DEPLOYMENT_MATCH.md`）。
- 前端：`WorldApp.tsx` 與房屋擺放程式不公開，前端無法從 `source/` 重建，只能對公開的正式 bundle 檢查。
- 瀏覽器與真實錢包 E2E：本快照沒有執行，見 `TESTS/README.md`。
