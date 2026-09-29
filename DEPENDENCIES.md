# DEPENDENCIES：依賴、第三方來源與安全標頭

## 1. 建置環境

| 項目 | 版本 | 依據 |
|---|---|---|
| Node | v24.19.0 | `source/.nvmrc`；`package.json` engines `>=24 <25`；部署紀錄 manifest `tools.node` |
| npm | 11.17.0 | 本快照測試時的本機版本 |
| TypeScript | 5.9.3 | lock／manifest |
| Vite | 8.3.1 | lock／manifest（rolldown 1.2.11、esbuild 0.28.1、lightningcss 1.33.0） |
| wrangler | **4.143.0**（送審版本為 4.92.0；F-6） | lock／manifest（workerd 1.20260926.1、miniflare 5.20260926.0-alpha、esbuild 0.28.1） |
| Worker compatibility_date | 2026-05-15（**不變**：wrangler 升級不改變正式環境的執行語意） | `wrangler.jsonc:17` |

指令（`source/package.json:9-18`）：

- 安裝：`npm ci`（lockfileVersion 3，159 個 `integrity`）。npm 11.17.0 會提示 `esbuild`、`workerd` 的 postinstall 沒有被允許執行；測試與 Worker 重建不需要它們。
- 測試：`npm test` = `node --test tests/*.test.mjs`
- 建置：`npm run build` = `tsc --noEmit && vite build`（本快照缺被保留的前端檔案，無法完成；Worker 可單獨重建，見 `DEPLOYMENT_MATCH.md` 第 3 節）
- 部署：`npm run deploy` = `node scripts/deploy.mjs`：工作目錄不乾淨或有 Vite 會載入的 `.env*` 就拒絕；**先跑完整的 `npm test`**，任何測試失敗就不 build、不部署；接著 `tsc --noEmit` 與 `vite build`；以 `wrangler deploy --outdir` 保留實際上傳的 Worker bundle；寫出 deploy record（manifest、SHA256SUMS）。只有 dry run 可以 `--skip-tests`。本次正式部署的 manifest 記錄 `tests: "passed"`（團隊端）。
- 部署證據：`npm run deploy:evidence` = `node scripts/deploy-evidence.mjs <deploy record>`（本版新增）：從部署紀錄只取結構化欄位（commit、紀錄 id、時間、Version ID、bundle 與前端雜湊、migration 檔名與雜湊、limiter 設定、WAF 規則的說明），不讀任何機密檔，不複製任何 log 文字；`tests/deploy-evidence.test.mjs` 用帶有 email 與本機路徑的假 log 驗證這一點。

## 2. 正式依賴

直接依賴（`package.json:22-28`，全部鎖定精確版本；本版未改）：

| 套件 | 版本 | 用在哪裡 |
|---|---|---|
| `viem` | 2.56.9 | **只在伺服器**（`server/auth.ts`、`ownership.ts`、`chain-mock.ts`）：SIWE 建立／解析／驗證、`recoverMessageAddress`、ABI 編解碼。前端不 import viem；頁面端的 SIWE 檢查（`src/world/siwe.ts`）刻意不用 viem，只做字串比對 |
| `@noble/curves` | 1.9.1 | 伺服器：與 viem 共用同一份 secp256k1，只調整預計算視窗以壓低冷啟動 CPU（`auth.ts:15-18`；測試確認只有一份） |
| `react`、`react-dom` | 19.2.6 | 前端 UI；`review-record.test.mjs` 也用 `react-dom/server` 把審查紀錄畫成 HTML 來測 |
| `three` | 0.186.1 | 前端 3D |

`overrides`：`"ws": "^8.21.0"`（lock 中只有一份 `ws` 8.22.0）。

lock 中非 dev 套件共 17 個：`@adraffy/ens-normalize` 1.11.1、`@noble/ciphers` 1.3.0、`@noble/curves` 1.9.1、`@noble/hashes` 1.8.0、`@scure/base` 1.2.6、`@scure/bip32` 1.7.0、`@scure/bip39` 1.6.0、`abitype` 1.2.3、`eventemitter3` 5.0.1、`isows` 1.0.7、`ox` 0.14.45、`react` 19.2.6、`react-dom` 19.2.6、`scheduler` 0.27.0、`three` 0.186.1、`viem` 2.56.9、`ws` 8.22.0。

Worker bundle 實際打包的第三方套件只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`（重建 bundle 的 sourcemap，`DEPLOYMENT_MATCH.md` 第 3 節）。

## 3. npm audit

在本快照 `source/` 的副本（`npm ci` 後）於 2026-09-29T05:55:36Z–05:55:45Z 執行，原始 JSON：`TESTS/npm-audit-omit-dev.json`、`TESTS/npm-audit-all.json`。

- `npm audit --omit=dev`：**0 個弱點**。
- `npm audit`（含 dev）：**3 個 moderate**，都是同一個 advisory，**全部在 wrangler 的建置／本機開發工具鏈**，不進任何正式 bundle：
  - `undici` 7.29.0（moderate，GHSA-3wwx-pv8p-q78v「Denial of Service via unhandled error in WebSocket permessage-deflate decompression」，影響 `>=7.28.0 <7.29.1`），經 `miniflare` 5.20260926.0-alpha 與 `wrangler` 4.143.0 兩層連帶列出。
  - npm 給的「修正」是把 wrangler 降到 4.101.0（標為 semver major），本輪沒有改動依賴。
- **與團隊修正 F-6 時的結果不同**：團隊把 wrangler 升到 4.143.0 時 `npm audit` 為 0（網站審查紀錄上 F-6 寫「npm audit 為 0」），這個 advisory 是之後才公布的。F-6 的原始問題（esbuild、sharp、undici 7.0–7.28 的 4 high＋1 low）確實已不再出現；新的這一項仍只在建置機與本機開發工具鏈裡。
- 部署出去的兩份 bundle 的雜湊都可重現（前端由團隊重建、Worker 可由 reviewer 從 `source/` 重建），降低了「建置機器被動手腳而沒人發現」的風險。

## 4. 執行期第三方來源

前端只會連兩個第三方來源，CSP 也只允許這兩個：

| 來源 | CSP 指令 | 用途 | 信任程度 |
|---|---|---|---|
| `https://api.dexscreener.com` | `connect-src` | 瀏覽器直接讀 IMD 行情（`/api/world/market` 是備援） | 只當顯示用的行情數字，不影響登入或權限 |
| `https://nft-cdn.alchemy.com` | `img-src` | 「我的錢包」中的 NFT 圖片；Worker 只轉交這個主機的 URL（`server/ownership.ts:18,97` 的 `safeImage`） | 只以 `<img>` 顯示 |

- 沒有分析工具、沒有外部字型（Cinzel 字型自架在 `/assets/`）、沒有 CDN 腳本、沒有第三方 script。
- 正式主 JS 中出現的 `https://` 主機（2026-09-29T05:52Z 計數）：`imd.fun`、`explorer.imd.fun`（含審查任務連結）、`dexscreener.com`、`github.com`（審查報告連結）與另一個第三方地圖站的主機，都只是 `<a>` 外部連結（新分頁、`rel=noreferrer noopener`）；`api.imd.fun` 只是顯示用的 URL 字串，CSP 也不允許瀏覽器直接連過去；`api.dexscreener.com` 是上表的行情讀取；`react.dev`、`jcgt.org` 是函式庫內的字串。房屋內部 chunk 沒有任何 `https://` 字串。
- 伺服器端（Worker）連的上游：`api.imd.fun`、`explorer.imd.fun`、`api.dexscreener.com`（公開、無金鑰，經 zone 邊緣快取）；Alchemy `eth-mainnet.g.alchemy.com`（帶金鑰，不快取在邊緣）。
- 正式 CSS（`index-5qjaKexX.css`）只有 `url(/assets/cinzel-*.woff2)` 與 `/references/imd/pepe.webp`，沒有 `@import`。

## 5. 動態模組

- 正式主 JS 中 `import(` 為 1 次：載入同 origin 的房屋內部 chunk `` import(`./InteriorView-Xan3ABOQ.js`) ``（`script-src 'self'` 允許）。房屋內部 chunk 本身 `import(` 為 0。
- （團隊端）原始碼中另有兩處以 `import.meta.env.DEV` 包住的 `devCapture` 動態 import（被保留的 `src/world/scene.ts`），production build 會移除；正式 bundle 中 `devCapture` 為 0 次（可自行驗證）。
- `vite.config.ts` 的 `shotPlugin` 為 `apply:'serve'`，只在 dev 伺服器生效。

## 6. 安全標頭（正式站實測，2026-09-29T05:52Z）

靜態檔（`source/public/_headers`，本版未改；本輪對 `/`、主 JS、房屋內部 chunk、CSS 四個回應檢查，全部一致）：

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://nft-cdn.alchemy.com; connect-src 'self' blob: https://api.dexscreener.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Worker 回應（`source/server/world-api.ts:11-15` 的 `API_HEADERS`，`GET /api/auth/session` 實測）：`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`、HSTS 同上、`X-Content-Type-Options: nosniff`、`Referrer-Policy`、`Cross-Origin-Resource-Policy: same-origin`、`Cache-Control: no-store`；沒有 CORS 標頭。

與錢包安全相關的意義：

- `script-src 'self'`（沒有 `'unsafe-inline'`、`'unsafe-eval'`、沒有第三方來源）：大幅降低注入的 inline script 或外部 script 在本站執行、進而觸發錢包提示的可能。這是縱深防禦，不涵蓋惡意瀏覽器擴充功能或冒名的 EIP-6963 provider。頁面端的 SIWE 檢查也不防注入本 origin 的腳本（`SIWE.md` 第 7 節）。`style-src` 允許 `'unsafe-inline'`（F-7c，列為已知）。
- `frame-ancestors 'none'`＋`X-Frame-Options: DENY`：本站不能被嵌入 iframe，防止點擊劫持誘導簽名。
- HSTS 一年含子網域（未 preload）。
- 專案程式沒有 `innerHTML`、`dangerouslySetInnerHTML`、`eval`、`new Function`、`document.write`：已公開的 `src/`、`server/`、`worker/` 可自行驗證；被保留的程式檔是團隊端搜尋（`SCOPE.md` 第 6.3 節），reviewer 可在正式檔案上複查——正式主 bundle 中 `eval(`、`new Function`、`document.write` 為 0 次，`innerHTML`（5 次）與 `dangerouslySetInnerHTML`（12 次）只出現在打包進來的 React DOM 程式碼內；房屋內部 chunk 全部為 0。審查紀錄用 React `createElement` 產生，外部連結是固定字串（`src/world/reviewRecord.ts:13-22`）。

`tests/headers.test.mjs` 固定這些標頭值。
