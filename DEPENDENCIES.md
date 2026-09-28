# DEPENDENCIES：依賴、第三方來源與安全標頭

## 1. 建置環境

| 項目 | 版本 | 依據 |
|---|---|---|
| Node | v24.19.0 | `source/.nvmrc`；`package.json` engines `>=24 <25`；部署紀錄 manifest `tools.node` |
| npm | 11.17.0 | 本快照測試時的本機版本 |
| TypeScript | 5.9.3 | lock／manifest |
| Vite | 8.3.1 | lock／manifest（rolldown 1.2.11、esbuild 0.27.3、lightningcss 1.33.0） |
| wrangler | 4.92.0 | lock／manifest（workerd 1.20260515.1、miniflare 4.20260515.0） |
| Worker compatibility_date | 2026-05-15 | `wrangler.jsonc:15` |

指令（`source/package.json:9-17`）：

- 安裝：`npm ci`（lockfileVersion 3）
- 測試：`npm test` = `node --test tests/*.test.mjs`
- 建置：`npm run build` = `tsc --noEmit && vite build`（本快照缺被保留的前端檔案，無法完成；Worker 可單獨重建，見 `DEPLOYMENT_MATCH.md` 第 3 節）
- 部署：`npm run deploy` = `node scripts/deploy.mjs`：工作目錄不乾淨或有 Vite 會載入的 `.env*` 就拒絕；**先跑完整的 `npm test`**（取自 `package.json` 的 `scripts.test`，只接受單純的 `node …` 指令），任何測試失敗就不 build、不部署；接著 `tsc --noEmit` 與 `vite build`；以 `wrangler deploy --outdir` 保留實際上傳的 Worker bundle；寫出 deploy record（manifest、SHA256SUMS）。只有 dry run 可以 `--skip-tests`，正式部署帶這個旗標會被拒絕；manifest 的 `tests` 欄位記錄 `passed` 或 `skipped (dry run)`（`scripts/deploy.mjs:1-5,43-62,77-85`）。本次正式部署的 manifest 記錄 `tests: "passed"`（團隊端）。

## 2. 正式依賴

直接依賴（`package.json:21-27`，全部鎖定精確版本）：

| 套件 | 版本 | 用在哪裡 |
|---|---|---|
| `viem` | 2.56.9 | **只在伺服器**（`server/auth.ts`、`ownership.ts`、`chain-mock.ts`）：SIWE 建立／解析／驗證、`recoverMessageAddress`、ABI 編解碼。前端不 import viem |
| `@noble/curves` | 1.9.1 | 伺服器：與 viem 共用同一份 secp256k1，只調整預計算視窗以壓低冷啟動 CPU（`auth.ts:13-16`；測試確認只有一份） |
| `react`、`react-dom` | 19.2.6 | 前端 UI |
| `three` | 0.186.1 | 前端 3D |

**`overrides`**（0def8cb 新增，`package.json:18-20`）：`"ws": "^8.21.0"`。效果：lock 中只剩一份 `ws` 8.22.0（`node_modules/ws`），先前被 wrangler／miniflare 帶進來並提升到頂層的 `ws` 8.18.0 與 viem 自帶的 `viem/node_modules/ws` 都不再存在。

lock 中非 dev 套件共 18 個：`@adraffy/ens-normalize` 1.11.1、`@noble/ciphers` 1.3.0、`@noble/curves` 1.9.1、`@noble/hashes` 1.8.0、`@scure/base` 1.2.6、`@scure/bip32` 1.7.0、`@scure/bip39` 1.6.0、`abitype` 1.2.3、`eventemitter3` 5.0.1、`isows` 1.0.7、`ox` 0.14.45、`react` 19.2.6、`react-dom` 19.2.6、`scheduler` 0.27.0、`three` 0.186.1、`typescript` 5.9.3（viem／abitype／ox 的 peer）、`viem` 2.56.9、`ws` 8.22.0（`isows` 的 peer）。

Worker bundle 實際打包的第三方套件只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`（重建 bundle 的 sourcemap，`DEPLOYMENT_MATCH.md` 第 3 節）。

## 3. npm audit

在本快照 `source/`（`npm ci` 後）於 2026-09-28T16:09:22Z–16:09:25Z 執行，原始 JSON：`TESTS/npm-audit-omit-dev.json`、`TESTS/npm-audit-all.json`。

- `npm audit --omit=dev`：**0 個弱點**（info 0、low 0、moderate 0、high 0、critical 0）。前一版的 `ws` 8.18.0（GHSA-96hv-2xvq-fx4p high、GHSA-58qx-3vcg-4xpx moderate）已由上述 override 消除。
- `npm audit`（含 dev）：1 low、4 high，共 5 個套件，**全部是 wrangler 的建置／本機開發工具鏈**，不進任何正式 bundle：
  - `esbuild`（low，GHSA-g7r4-m6w7-qqqr；範圍 0.27.3–0.28.0，經 wrangler）
  - `miniflare`（high，經 `sharp`、`undici`）
  - `sharp`（high，GHSA-f88m-g3jw-g9cj、GHSA-rgj7-g3m4-5g8c）
  - `undici`（high，7.0.0–7.28.0，多個 advisory）
  - `wrangler`（high，直接 devDependency 4.92.0，經 `esbuild`、`miniflare`）
  - npm 的建議修正是把 wrangler 升到 4.143.0（非 semver major）；本輪沒有改動依賴。這些套件用在 `wrangler deploy` 打包與本機 `wrangler dev`，正式的前端 bundle 與 Worker bundle 都不含它們（Worker bundle 的第三方內容見上節）。

## 4. 執行期第三方來源

前端只會連兩個第三方來源，CSP 也只允許這兩個：

| 來源 | CSP 指令 | 用途 | 信任程度 |
|---|---|---|---|
| `https://api.dexscreener.com` | `connect-src` | 瀏覽器直接讀 IMD 行情（DEX Screener 會限流 Cloudflare 出口 IP，所以由瀏覽器讀；`/api/world/market` 是備援） | 只當顯示用的行情數字，不影響登入或權限 |
| `https://nft-cdn.alchemy.com` | `img-src` | 「我的錢包」中的 NFT 圖片；Worker 只轉交這個主機的 URL（`server/ownership.ts:18,97` 的 `safeImage`） | 只以 `<img>` 顯示 |

- 沒有分析工具、沒有外部字型（Cinzel 字型自架在 `/assets/`）、沒有 CDN 腳本、沒有第三方 script。
- 正式 JS 中出現的網址主機（2026-09-28T16:06Z 計數）：`imd.fun`、`explorer.imd.fun`、`dexscreener.com` 與另一個第三方地圖站的主機（字串就在正式 JS 裡，可自行搜尋 `https://`）只是 `<a>` 外部連結；`api.imd.fun` 只是顯示用的 URL 字串，CSP 也不允許瀏覽器直接連過去（由 Worker 代理）；`api.dexscreener.com` 是上表的行情讀取；`www.w3.org`（SVG／XML 命名空間）、`react.dev`、`jcgt.org` 是函式庫內的字串。
- 伺服器端（Worker）連的上游：`api.imd.fun`、`explorer.imd.fun`、`api.dexscreener.com`（公開、無金鑰，經 zone 邊緣快取）；Alchemy `eth-mainnet.g.alchemy.com`（帶金鑰，不快取在邊緣）。
- （團隊端）私人 repo 中殘留的 `src/style.css`（含 Google Fonts `@import`）屬於舊的 StickEmber 小遊戲，**不在正式 bundle 裡**（reviewer 可從正式 CSS 驗證）：`src/main.tsx` 只 import `./world/WorldApp`；正式 CSS（與前一版相同，SHA-256 `83f3b7da…d804`）只有 `url(/assets/cinzel-*.woff2)` 與 `/references/imd/pepe.webp`，沒有 `@import`。

## 5. 動態模組

- 正式 JS 中 `import(` 為 0 次。
- （團隊端）原始碼中只有兩處以 `import.meta.env.DEV` 包住的 `devCapture` 動態 import（被保留的 `src/world/scene.ts:255,872`），production build 會移除；正式 bundle 中 `devCapture` 為 0 次（可自行驗證）。
- `vite.config.ts` 的 `shotPlugin` 為 `apply:'serve'`，只在 dev 伺服器生效。

## 6. 安全標頭（正式站實測，2026-09-28T16:06Z）

靜態檔（`source/public/_headers`；本輪對 `/`、JS、CSS 三個回應檢查，前一輪對 73 個回應檢查，全部一致。reviewer 可對任一靜態檔自行 `curl -I` 核對）：

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

- `script-src 'self'`（沒有 `'unsafe-inline'`、`'unsafe-eval'`、沒有第三方來源）：大幅降低注入的 inline script 或外部 script 在本站執行、進而觸發錢包提示的可能。這是縱深防禦，不涵蓋惡意瀏覽器擴充功能或冒名的 EIP-6963 provider（`WALLET_METHODS.md` 第 1 節）。`style-src` 允許 `'unsafe-inline'`（React 的 inline style），不影響 script。
- `frame-ancestors 'none'`＋`X-Frame-Options: DENY`：本站不能被嵌入 iframe，防止點擊劫持誘導簽名。
- HSTS 一年含子網域（未 preload）。
- 專案程式沒有 `innerHTML`、`dangerouslySetInnerHTML`、`eval`、`new Function`、`document.write`：已公開的 `src/`、`server/`、`worker/` 可自行驗證；被保留的程式檔是團隊端搜尋，reviewer 可在正式 bundle 上複查——正式 bundle 中 `eval(`、`new Function`、`document.write` 為 0 次，`innerHTML`（5 次）與 `dangerouslySetInnerHTML`（12 次）只出現在打包進來的 React DOM 程式碼內。

`tests/headers.test.mjs` 固定這些標頭值。
