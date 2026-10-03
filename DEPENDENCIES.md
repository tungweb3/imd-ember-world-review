> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# DEPENDENCIES：依賴、外部來源與標頭

## 1. 本輪環境與安裝

版本基準為來源 `c491ff3`／部署來源 `ddb10e2`／Worker `acdbb2bd`。以下數字來自本輪 lock、執行輸出與已保存的線上檔案。

| 項目 | 實際版本／設定 | 依據 |
|---|---|---|
| Node | `v24.19.0` | 本輪 runner；`source/.nvmrc`，engines `>=24 <25` |
| npm | `11.17.0` | 本輪 runner |
| TypeScript | `5.9.3` | `source/package-lock.json` |
| Vite | `8.3.1` | lock 與部署證據頁 |
| Wrangler | `4.143.0` | lock、dry-run 輸出 |
| workerd | `1.20260926.1` | lock |
| miniflare | `5.20260926.0-alpha` | lock |
| esbuild | `0.28.1` | lock |
| Worker compatibility_date | `2026-05-15` | `source/wrangler.jsonc:17` |
| Worker CPU cap（設定） | `50 ms` | `source/wrangler.jsonc:20` |

公開來源副本的 `npm ci --no-audit --no-fund` 於 `2026-10-03T13:08:38Z–13:09:06Z` 完成，exit 0。lockfileVersion 為 3，159 個套件項目，159 個均有 integrity。

本輪安裝曾對三個 tarball 顯示重試警告，最後 exit 0。npm 也提示 esbuild 與 workerd 的 postinstall 尚未列入 allowScripts；本輪沒有額外允許它們，Worker dry run 與後續完整來源建置仍完成。這些安裝警告不是測試通過或供應鏈保證。

## 2. 直接依賴與用途

`source/package.json` 宣告的直接版本：

| 套件 | 版本 | 使用位置 |
|---|---|---|
| `viem` | 2.56.9 | 伺服器 SIWE、訊息簽章復原、ABI 編解碼 |
| `@noble/curves` | 1.9.1 | 伺服器 secp256k1；與 viem 共用 |
| `react`、`react-dom` | 19.2.6 | 前端 UI；本地測試也渲染面板 |
| `three` | 0.186.1 | 前端 3D |

`source/package.json` 的 overrides：

- `ws: ^8.21.0`；lock 中解析為 `8.22.0`。
- `undici: 7.29.1`；lock 中唯一 undici 為這個版本。
- miniflare 的依賴宣告仍要求 undici `7.29.0`，override 取代實際解析版本。

undici 是本地開發／建置工具依賴，不在本輪生成的 Worker sourcemap 套件清單內。`source/tests/dependencies.test.mjs:10`、`:19` 的兩項 F-6 測試本輪通過：解析版本不在註明的 advisory 範圍，且上游仍有需要 override 的精確 pin。未來上游解除該 pin 時，第二項測試會提醒重新整理 override。

## 3. 實際打包內容

本輪公開來源重建 Worker 為 303,128 bytes，SHA-256 `cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518`，符合部署紀錄。從該次生成的 sourcemap 檢查，第三方套件為：

- `viem`
- `abitype`
- `@noble/curves`
- `@noble/hashes`

該 sourcemap 的專案模組共 18 個：

- `source/worker/index.ts`、`source/worker/app.ts`。
- `source/server/auth.ts`、`source/server/ownership.ts`、`source/server/presence.ts`、`source/server/gateway.ts`、`source/server/world-api.ts`、`source/server/chain-mock.ts`、`source/server/member.ts`。
- `source/src/world/cadence.ts`、`source/src/world/collections.ts`、`source/src/world/houseSize.ts`、`source/src/world/links.ts`、`source/src/world/market.ts`、`source/src/world/model.ts`、`source/src/world/status.ts`、`source/src/world/siwe.ts`、`source/src/world/memberName.ts`。

M1 新增會員／名稱模組，不新增 npm 直接依賴。前端完整來源重建的 `third-party-licenses.txt` 與部署紀錄相符；公開副本缺前端實作，不能僅用這份副本獨立重建完整前端。

## 4. npm audit 的實際結果

於 `2026-10-03T13:10:18Z` 開始執行兩種 audit；兩個 JSON 都已檢查能解析，且具有漏洞統計欄位。

| 指令 | info | low | moderate | high | critical | total |
|---|---:|---:|---:|---:|---:|---:|
| `npm audit --omit=dev --json` | 0 | 0 | 0 | 0 | 0 | 0 |
| `npm audit --json` | 0 | 0 | 0 | 0 | 0 | 0 |

原始 JSON 在 `TESTS/npm-audit-omit-dev.json` 與 `TESTS/npm-audit-all.json`。npm 報告依賴統計為 prod 19、dev 141、optional 86、total 159；這些分類含重疊，不能直接相加。它也不同於 package.json 直接依賴的五個項目。

這是該次 advisory 資料與該 lock 的結果；不支持未來仍為零、套件所有行為已審查、或建置機器未遭修改的結論。

## 5. 執行期外部來源

| 來源 | 使用方式 | 公開來源依據 |
|---|---|---|
| `api.dexscreener.com` | 瀏覽器行情讀取；Worker 行情備援 | `source/public/_headers:24`、`source/src/world/market.ts` |
| `nft-cdn.alchemy.com` | 錢包面板 NFT 圖片，僅 img-src | `source/server/ownership.ts:19`、`source/src/world/WalletPanel.tsx` |
| `api.imd.fun` | Worker 的公開網路摘要／工作等讀取 | `source/server/gateway.ts:9` |
| `explorer.imd.fun/api/activity` | Worker 的公開活動資料 | `source/server/gateway.ts:12` |
| `eth-mainnet.g.alchemy.com` | Worker 的鏈上所有權、NFT 索引與 floor 讀取 | `source/server/ownership.ts:17`、`source/server/gateway.ts:14` |

Alchemy 讀取的憑證透過伺服器 Authorization header，頁面不呼叫這些 API。此描述來自來源，本輪未讀取憑證或測試真實 Alchemy 付費請求。

本輪已保存的主 JS 中 `https://` 主機字串為：`api.dexscreener.com`、`api.imd.fun`、`dexscreener.com`、`explorer.imd.fun`、`github.com`、`imd-town.0xfinne.com`、`imd.fun`、`jcgt.org`、`react.dev`。字串存在不等於執行網路請求；API 連線允許範圍由 CSP 決定，連結與函式庫文字也會出現在 bundle。

## 6. 動態載入與檔案字串檢查

對本輪取得且符合紀錄的 `index-BoNTm1MM.js`、`InteriorView-DM8tQpsI.js`、`index-BZpalHf7.css` 檢查：

- 主 JS 的 `import(` 為 1 次；房屋內部 chunk 為 0 次。
- 主 JS 與房屋內部 chunk 的 `eval(`、`new Function`、`document.write`、`new Worker`、`importScripts`、`WebAssembly` 都為 0 次。
- 房屋內部 chunk 沒有 `https://` 字串。
- CSS 沒有 `@import` 或 `https://` 字串；兩個 url 均為同 origin 的 Cinzel woff2。
- 字串搜尋是有限的靜態檢查，不是瀏覽器執行追蹤，也不證明不存在所有形式的動態程式執行。

## 7. 靜態安全標頭

本輪四個靜態 GET 的六個值與 `source/public/_headers:19` 起的設定完全相同，共 24 次比對：

```text
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://nft-cdn.alchemy.com; connect-src 'self' blob: https://api.dexscreener.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`style-src` 允許 unsafe-inline，屬已記載的界線。HSTS 沒有 preload。CSP 限制網頁腳本與框架嵌入，不涵蓋惡意瀏覽器擴充、冒名錢包 provider 或同 origin 已遭替換的程式。

Worker 回應使用 `source/server/world-api.ts:11` 的 API_HEADERS，而不是靜態 _headers：no-store、HSTS、nosniff、Referrer-Policy、CORP same-origin、CSP `default-src 'none'; frame-ancestors 'none'`。無 cookie 的 session GET 已保存；正式限流、WAF 與所有 API 回應分支未經線上重跑。

## 8. 重現與範圍

```bash
# 在公開 source/ 的獨立副本內
npm ci --no-audit --no-fund
npm audit --omit=dev --json
npm audit --json
node --test tests/dependencies.test.mjs
```

測試、Worker dry run 與完整來源建置的實際結果在 `TESTS/README.md`、`DEPLOYMENT_MATCH.md`。本包範圍不含 Coin E1 或 Genesis Mint；本輪沒有新增、更新套件或部署任何內容。
