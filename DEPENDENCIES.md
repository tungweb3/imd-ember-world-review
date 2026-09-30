# DEPENDENCIES：依賴、第三方來源與安全標頭

## 1. 建置環境

| 項目 | 版本 | 依據 |
|---|---|---|
| Node | v24.19.0 | `source/.nvmrc`；`package.json:6-8` engines `>=24 <25`；部署證據頁 Tools（`source/docs/security/deploy-evidence/20260929T195417Z-4321bb4.md:15`） |
| npm | 11.17.0 | 本快照測試時的本機版本 |
| TypeScript | 5.9.3 | lock／部署證據頁 |
| Vite | 8.3.1 | lock／部署證據頁（rolldown 1.2.11、lightningcss 1.33.0；esbuild 0.28.1 是 Vite 的 optional peer，與 wrangler 共用同一份） |
| wrangler | 4.143.0（最初送審的版本為 4.92.0；F-6；本版未改） | lock／部署證據頁（workerd 1.20260926.1、miniflare 5.20260926.0-alpha、esbuild 0.28.1；undici **7.29.1**，經 `overrides` 固定，見第 3 節） |
| Worker compatibility_date | 2026-05-15（**不變**：wrangler 升級不改變正式環境的執行語意） | `wrangler.jsonc:17` |

與上一版快照相比，`package.json` 只多了 `overrides.undici`，`package-lock.json` 只有 `node_modules/undici` 從 7.29.0 變成 7.29.1；其他套件版本都沒有變。

指令（`source/package.json:9-18`）：

- 安裝：`npm ci`（lockfileVersion 3，159 個套件項目，159 個都有 `integrity`）。npm 11.17.0 會提示 `esbuild`、`workerd` 的 postinstall 沒有被允許執行（本輪 `npm ci` 也一樣）；測試與 Worker 重建不需要它們。
- 測試：`npm test` = `node --test tests/*.test.mjs`
- 建置：`npm run build` = `tsc --noEmit && vite build`（本快照缺被保留的前端檔案，無法完成；Worker 可單獨重建，見 `DEPLOYMENT_MATCH.md` 第 3 節）
- 部署：`npm run deploy` = `node scripts/deploy.mjs`：工作目錄不乾淨或有 Vite 會載入的 `.env*` 就拒絕；**先跑完整的 `npm test`**，任何測試失敗就不 build、不部署；接著 `tsc --noEmit` 與 `vite build`；以 `wrangler deploy --outdir` 保留實際上傳的 Worker bundle；寫出 deploy record（manifest、SHA256SUMS）。只有 dry run 可以 `--skip-tests`。本次正式部署（`1a0dd495`）的部署證據頁記錄 `Tests before build: passed (npm test)`（團隊端，`source/docs/security/deploy-evidence/20260929T195417Z-4321bb4.md:14`）。
- 部署證據：`npm run deploy:evidence` = `node scripts/deploy-evidence.mjs <deploy record>`：從部署紀錄只取結構化欄位（commit、紀錄 id、時間、Version ID、bundle 與前端雜湊、migration 檔名與雜湊、limiter 設定、WAF 規則的說明），本版起也列出該 commit 的 `server/auth.ts` 裡的 limiter 鍵（`CHAIN_KEYS`）；不讀任何機密檔，不複製任何 log 文字。`tests/deploy-evidence.test.mjs` 用帶有 email 與本機路徑的假 log 驗證這一點；其中第一項要比對 A-1 前後的 limiter 鍵，需要 `git rev-parse` 一個未公開的團隊 commit，所以在本快照會失敗（團隊端的 checkout 中通過），第二項（在 git 之外執行）在本快照通過（`TESTS/README.md`）。

## 2. 正式依賴

直接依賴（`package.json:23-29`，全部鎖定精確版本；本版未改）：

| 套件 | 版本 | 用在哪裡 |
|---|---|---|
| `viem` | 2.56.9 | **只在伺服器**（`server/auth.ts`、`ownership.ts`、`chain-mock.ts`）：SIWE 建立／解析／驗證、`recoverMessageAddress`、ABI 編解碼。前端不 import viem；頁面端的 SIWE 檢查（`src/world/siwe.ts`）刻意不用 viem，只做字串比對 |
| `@noble/curves` | 1.9.1 | 伺服器：與 viem 共用同一份 secp256k1，只調整預計算視窗以壓低冷啟動 CPU（`server/auth.ts:15-18`；測試確認只有一份） |
| `react`、`react-dom` | 19.2.6 | 前端 UI；測試中 `review-record.test.mjs` 用 `react-dom/server` 把審查紀錄畫成 HTML，`tests/fixtures/wallet-panel.mjs`（本版新增，A-8）用它實際繪製 `WalletPanel.tsx` |
| `three` | 0.186.1 | 前端 3D |

`overrides`（`package.json:19-22`）：

- `"ws": "^8.21.0"`（lock 中只有一份 `ws` 8.22.0）。
- `"undici": "7.29.1"`（**本版新增**，F-6 的後續；理由見第 3 節）。

lock 中非 dev 套件共 17 個：`@adraffy/ens-normalize` 1.11.1、`@noble/ciphers` 1.3.0、`@noble/curves` 1.9.1、`@noble/hashes` 1.8.0、`@scure/base` 1.2.6、`@scure/bip32` 1.7.0、`@scure/bip39` 1.6.0、`abitype` 1.2.3、`eventemitter3` 5.0.1、`isows` 1.0.7、`ox` 0.14.45、`react` 19.2.6、`react-dom` 19.2.6、`scheduler` 0.27.0、`three` 0.186.1、`viem` 2.56.9、`ws` 8.22.0。`undici` 標為 dev（只經 wrangler → miniflare 進來）。

實際進入正式 bundle 的第三方套件：

- **Worker bundle**：只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`。依據是本輪從本快照重建的 Worker bundle 的 sourcemap（該 bundle 274,961 bytes，SHA-256 `1018f02a…078c`，與部署紀錄相同；`DEPLOYMENT_MATCH.md` 第 3 節）。同一份 sourcemap 中的專案檔就是 `worker/index.ts`、`worker/app.ts`、`server/{auth,ownership,presence,gateway,world-api,chain-mock}.ts`、`src/world/{cadence,collections,houseSize,links,market,model,status,siwe}.ts` 這 16 個，與上一版相同。
- **前端 bundle**：`react`、`react-dom`、`scheduler`、`three`。依據是 Vite 依實際打包內容產生的 `dist/third-party-licenses.txt`（團隊端重建，其 SHA-256 與部署紀錄相同，`manifests/compare.txt`）。在正式主 JS（`index-BFVt9xb_.js`）中，`viem`、`noble`、`secp256k1`、`keccak` 這些字串都是 0 次（本輪 2026-09-30 11:57 UTC 取得的正式檔案，雜湊與部署紀錄相同）。

## 3. npm audit

在本快照 `source/` 的副本（`npm ci` 後）於 2026-09-30T11:56:43Z 執行，原始 JSON：`TESTS/npm-audit-omit-dev.json`、`TESTS/npm-audit-all.json`。

- `npm audit --omit=dev`：**0 個弱點**。
- `npm audit`（含 dev）：**0 個弱點**（info、low、moderate、high、critical 全為 0；npm 計算的依賴數：19 個 prod、141 個 dev、共 159）。

與上一版快照的差別：上一版（`b6e986b`）在 2026-09-29 執行的結果是 0（`--omit=dev`）與 **3 個 moderate**（含 dev），三個都是同一個 advisory：`undici` 7.29.0 的 GHSA-3wwx-pv8p-q78v（WebSocket permessage-deflate 解壓縮錯誤未處理，可造成服務中斷；影響 `>=7.28.0 <7.29.1`），經 `miniflare` 5.20260926.0-alpha 與 `wrangler` 4.143.0 兩層連帶列出，全部在 wrangler 的建置／本機開發工具鏈，不進任何正式 bundle。Swarm retest e48d0a96 因此把 F-6 評為「部分」。

**為什麼現在是 0：undici override。**

- `miniflare` 5.20260926.0-alpha 在它自己的依賴中把 undici 釘死在 `7.29.0`（`package-lock.json:2201`），而當時沒有任何 wrangler 版本帶著修正過的 undici（4.143.0 是最新版；npm 給的「修正」是把 wrangler 降到 4.101.0，標為 semver major）。
- 團隊的做法是在 `package.json` 加上 `"overrides": {"undici": "7.29.1"}`（`package.json:21`；同一條版本線的 patch 版），讓 lock 中唯一的一份 undici 變成 7.29.1（`package-lock.json:2514-2515`），wrangler 版本不動。依團隊的說法（`source/docs/security/AUDIT_REMEDIATION_STATUS.md` 的 F-6 段落），這個修改是 commit `202da0b`，已隨 Worker `c89f5915` 部署並延續到目前的 `1a0dd495`；undici 只是工具依賴，不在 Worker bundle 內，用 7.29.0 與 7.29.1 建出的 Worker bundle 位元組相同。本輪沒有用 7.29.0 重建做這個比對；本輪用 7.29.1 從本快照重建的 Worker bundle 與部署紀錄相同（見第 2 節）。
- `tests/dependencies.test.mjs`（本版新增）有兩項，都在本快照通過（`TESTS/npm-test-output.txt`）：
  - 「F-6: no undici in the lockfile falls in GHSA-3wwx-pv8p-q78v (7.28.0-7.29.0)」（`tests/dependencies.test.mjs:10-15`）：lock 中每一份 undici 都不在 advisory 範圍內，而且 `overrides.undici` 就是 lock 中的版本。
  - 「F-6: the undici override is still needed (a dependency pins a vulnerable undici)」（`tests/dependencies.test.mjs:19-23`）：只要還有依賴把 undici 釘在範圍內的版本就通過；等 wrangler 帶來要求 7.29.1 以上的 miniflare，這項就會失敗，提醒移除這個 override 與這項斷言，讓這個精確版本的 pin 不會擋住之後的 undici 更新（註解在 `:16-18`）。
- 殘留風險：這是某一天的 audit 結果；新的 advisory 會陸續出現，建置機器的供應鏈風險一般性地存在（團隊的做法是部署前重跑 `npm audit`）。部署出去的兩份 bundle 的雜湊都可重現（前端由團隊重建、Worker 可由 reviewer 從 `source/` 重建），降低了「建置機器被動手腳而沒人發現」的風險，但不能排除它。

## 4. 執行期第三方來源

前端只會連兩個第三方來源，CSP 也只允許這兩個：

| 來源 | CSP 指令 | 用途 | 信任程度 |
|---|---|---|---|
| `https://api.dexscreener.com` | `connect-src` | 瀏覽器直接讀 IMD 行情（`/api/world/market` 是備援） | 只當顯示用的行情數字，不影響登入或權限 |
| `https://nft-cdn.alchemy.com` | `img-src` | 「我的錢包」中的 NFT 圖片；Worker 只轉交這個主機的 URL（`server/ownership.ts:19,99` 的 `safeImage`），頁面顯示前再檢查一次主機（`src/world/WalletPanel.tsx:59`） | 只以 `<img>` 顯示 |

- 沒有分析工具、沒有外部字型（Cinzel 字型自架在 `/assets/`）、沒有 CDN 腳本、沒有第三方 script。
- 正式主 JS（`index-BFVt9xb_.js`，2026-09-30T11:57Z 取得的正式檔案上計數）中出現的 `https://` 主機，與上一版是同一組：`imd.fun`、`explorer.imd.fun`（含審查任務連結）、`dexscreener.com`、`github.com`（審查報告連結）與另一個第三方地圖站的主機，都只是 `<a>` 外部連結（新分頁，`rel` 含 `noreferrer`，依 HTML 規範也隱含 noopener；審查紀錄的連結是 `noreferrer noopener`，`src/world/reviewRecord.ts:121`）；`api.imd.fun` 只是顯示用的 URL 字串，CSP 也不允許瀏覽器直接連過去；`api.dexscreener.com` 是上表的行情讀取；`react.dev`、`jcgt.org` 是函式庫內的字串。房屋內部 chunk（`InteriorView-wZGOk4w6.js`）沒有任何 `https://` 字串。
- 伺服器端（Worker）連的上游：`api.imd.fun`、`explorer.imd.fun`、`api.dexscreener.com`（公開、無金鑰，經 zone 邊緣快取）；Alchemy `eth-mainnet.g.alchemy.com`（帶金鑰，不快取在邊緣）（`server/gateway.ts:9,12,14`、`src/world/market.ts:5`）。本版的效能改動另讓 Worker 把公開快照資料的一份共用副本存在各據點的 Cache API（鍵在 `/api/world/_shared/v1/` 之下，只存路由本來就公開回應的資料，不存任何機密；`worker/app.ts:40-58`）。
- 正式 CSS（`index-DkZ6U0YC.css`）只有 `url(/assets/cinzel-latin-400-normal-DnUIPmzd.woff2)` 與 `url(/assets/cinzel-latin-600-normal-Dd5YO2UX.woff2)`，沒有 `@import`。

## 5. 動態模組

- 正式主 JS 中 `import(` 為 1 次：載入同 origin 的房屋內部 chunk `` import(`./InteriorView-wZGOk4w6.js`) ``（`script-src 'self'` 允許）。房屋內部 chunk 本身 `import(` 為 0。
- （團隊端）原始碼中另有兩處以 `import.meta.env.DEV` 包住的 `devCapture` 動態 import（被保留的 `src/world/scene.ts`），production build 會移除；正式 bundle 中 `devCapture` 為 0 次（可自行驗證）。
- `vite.config.ts` 的 `shotPlugin` 為 `apply:'serve'`，只在 dev 伺服器生效（`vite.config.ts:14-15`）。
- 本版新增兩個只在 build 時執行的 Vite plugin：`hashedPublicCopies`（`vite.config.ts:25-36`）把 `public/` 下的模型、裝飾圖集與 Pepe 框各寫一份檔名含內容雜湊的副本到 `assets/`；`bakedTerrain`（`vite.config.ts:38-53`）在 build 時把手機版地形資料算好，寫成 `assets/terrain-phone.<hash>.bin`，`virtual:baked-terrain` 只匯出這個同 origin 檔案的 URL 字串，頁面用 `fetch` 讀取資料，它不是程式模組。兩者用到的 `scripts/content-hash.ts`、`src/world/skin/terrainField.ts`、`src/world/skin/terrainBake.ts` 被保留（所以本快照的 `tsc --noEmit` 對 `vite.config.ts` 報缺檔）。正式主 JS 中 `new Worker`、`importScripts`、`WebAssembly` 都是 0 次。

## 6. 安全標頭（正式站實測，2026-09-30T11:57:34Z–11:57:51Z）

靜態檔（`source/public/_headers:18-24`；這一段安全標頭本版未改，`_headers` 只改了 `/assets/*` 快取規則的註解，說明模型等檔案的雜湊副本也在 `/assets/` 下）。本輪對 `/`、主 JS、CSS、房屋內部 chunk 四個回應檢查，安全標頭全部一致：

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://nft-cdn.alchemy.com; connect-src 'self' blob: https://api.dexscreener.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Worker 回應（`source/server/world-api.ts:11-15` 的 `API_HEADERS`，`GET /api/auth/session` 實測）：`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`、HSTS 同上、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Cross-Origin-Resource-Policy: same-origin`、`Cache-Control: no-store`；沒有 CORS 標頭。

與錢包相關的意義：

- `script-src 'self'`（沒有 `'unsafe-inline'`、`'unsafe-eval'`、沒有第三方來源）：大幅降低注入的 inline script 或外部 script 在本站執行、進而觸發錢包提示的可能。這是縱深防禦，不涵蓋惡意瀏覽器擴充功能或冒名的 EIP-6963 provider。頁面端的 SIWE 檢查也不防注入本 origin 的腳本（`SIWE.md` 第 7 節）。`style-src` 允許 `'unsafe-inline'`（F-7c，列為已知）。
- `frame-ancestors 'none'`＋`X-Frame-Options: DENY`：本站不能被嵌入 iframe，防止點擊劫持誘導簽名。
- HSTS 一年含子網域（未 preload）。
- 專案程式沒有 `innerHTML`、`dangerouslySetInnerHTML`、`eval`、`new Function`、`document.write`：已公開的 `src/`、`server/`、`worker/` 可自行驗證；被保留的程式檔是團隊端搜尋（`SCOPE.md` 第 6.3 節），reviewer 可在正式檔案上複查——正式主 bundle 中 `eval(`、`new Function`、`document.write` 為 0 次，`innerHTML`（5 次）與 `dangerouslySetInnerHTML`（12 次）只出現在打包進來的 React DOM 程式碼內；房屋內部 chunk 全部為 0。審查紀錄用 React `createElement` 產生（`src/world/auditRecord.ts:4-5`），外部連結是固定字串（`src/world/reviewRecord.ts:14-15,65-71`、`src/world/links.ts:5,36`）。

`tests/headers.test.mjs` 固定這些標頭值，也檢查雜湊副本與原檔的快取規則。
