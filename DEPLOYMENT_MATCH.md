# DEPLOYMENT_MATCH：送審來源、建置與正式部署的對照

## 1. 版本識別

| 項目 | 值 | 證據類型 |
|---|---|---|
| 網站 | https://imdember.com/ | — |
| Worker 名稱 | `imd-world` | `source/wrangler.jsonc` |
| 正式 Worker version | `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f`：部署紀錄中 wrangler 回傳的 Version ID。本輪沒有用 wrangler 查詢部署狀態；「這是目前 100% 流量的版本」是團隊端說明，與下方正式前端檔案的比對結果一致 | 團隊端 |
| 來源 commit | `2da46cdafcf8ad3fb3571ea0273ecc5d1ab5be1d`（committer date 2026-09-29T13:04:32+08:00；私人 repo 的 `main`，tag `v2026.09.29-50c688c9`） | 團隊端（私人 repo） |
| 部署紀錄 | `deploy-records/20260929T050441Z-2da46cd`：mode `deploy`，started 2026-09-29T05:04:41.560Z，finished 05:05:18.089Z，從一個乾淨的工作目錄以該 commit 部署（branch 欄位為 `HEAD`），`dirty:false`，`envFiles:[]`，`tests:"passed"`，tools node v24.19.0／wrangler 4.143.0／vite 8.3.1／typescript 5.9.3，`wrangler.exitCode:0`，`wrangler.versionId = 50c688c9-…`，`dist.unchangedDuringDeploy:true`，`worker.main` = `worker/index.js` 264,561 bytes、SHA-256 `14584fe4…f5e4` | 團隊端（只摘錄這些欄位與雜湊） |
| 第一個帶著修正上線的版本 | `f9b68223-19f7-4318-8274-294413b81965`（來源 `1a0ba21`，2026-09-28 21:05 UTC）。它與 `50c688c9` 之間還有兩次正式部署：`ead82d7a-6c72-4635-969f-192e4ff5dcc8`（來源 `296033f`，2026-09-29 00:33 UTC）與 `8c142a21-278f-4980-9dcd-5d3112c0c39e`（來源 `5393bec`，02:04 UTC），都是只改前端／世界的部署，部署紀錄記下的 Worker bundle SHA-256 同樣是 `14584fe4…`（團隊端部署紀錄 manifest，未公開）；所以 `50c688c9` 的前一個正式版本是 `8c142a21`。它的部署紀錄記下的 Worker bundle SHA-256 也是 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`，也就是說 `1a0ba21 → 2da46cd` 之間 Worker 沒有變（私人 repo 的 `git diff 1a0ba21 2da46cd` 對所有 Worker 會載入的檔案、`wrangler.jsonc`、`package*.json` 與 `public/_headers` 都是空的） | 團隊端 |
| 送審版本 | `beac62be-27ff-40cd-9dc4-3cbbdc6add4b`（來源 `0def8cb`，Worker bundle `4ec73351…0eccf3`）：本 repo 第一個 commit `c2a8c33` 描述的版本 | 見 `c2a8c33` |
| D1 migration | `migrations/0003_sign_in_layers.sql` 在部署 `f9b68223` 前套用到正式 D1（只增不改；先匯出備份；從 `d1_migrations` 讀回） | 團隊端說明；本輪未查詢正式資料庫 |
| 本快照 | 本 repo 的 commit（見 `git log`）；`source/` = `git -c core.autocrlf=false archive 2da46cd` 中的 61 個檔案，其中 8 個有遮蔽（`REDACTIONS.md` 第 1 節） | 可自行驗證（本 repo） |

部署紀錄中的 config 雜湊與 git blob 的關係（這次的部署工作目錄以 CRLF checkout）：

| 檔案 | manifest SHA-256 | 說明 |
|---|---|---|
| `wrangler.jsonc` | `d0265f46…73e9` | 等於 git blob 轉成 CRLF 後的雜湊（LF 為 `04123e0f…`）；本快照的遮蔽版為另一個值（`REDACTIONS.md`） |
| `package-lock.json` | `ec90de1f…45a1` | 等於 git blob（blob id `41c72fb6…`）轉成 CRLF 後的雜湊；本快照 `source/package-lock.json` 是 LF 的 blob 原文 |
| `public/_headers` | `0de79067…534b` | 等於 git blob（blob id `9c807469…`，LF 為 `b89d6828…c48d`，即本快照 `source/public/_headers`）轉成 CRLF 後的雜湊；與送審版本相同 |

## 2. 各類檔案的比對結果

方法（團隊端，需要完整原始碼）：從 2da46cd 以 `git -c core.autocrlf=true archive` 取出 → `npm ci` → `npm run build`（`tsc --noEmit && vite build`，Node v24.19.0，2026-09-29T05:53Z），得到 70 個 `dist/` 檔案；另以 `core.autocrlf=false` 取出並 build 一次；對正式站的 `index.html`、主 JS、房屋內部 chunk、CSS 各 GET 一次計算 SHA-256；並與部署紀錄 `SHA256SUMS` 比對。明細：`manifests/compare.txt`、`manifests/build-sha256.txt`、`manifests/build-sha256.lf-run.txt`、`manifests/live-sha256.txt`、`manifests/deploy-record-SHA256SUMS.txt`。

| 類別 | 結果 | 依據 |
|---|---|---|
| `index.html` | **verified** | 線上 = 部署紀錄 = 重建：`7f0f9d5409db78799bb61ba1573d780cc8ecb815f4e60c4f0c8ba7317ce7a75c`（730 bytes，CRLF） |
| 前端主 JS `assets/index-Bj4ribmm.js` | **verified** | `70742ed409b55a400cb8439c3cb5e4bac719f8a4763083c77764d3a7283ef528`，1,344,457 bytes，三方相同 |
| 房屋內部 chunk `assets/InteriorView-Xan3ABOQ.js` | **verified** | `fbd4e640ac1718781f8980c3671282abfa4893fbc3b05cd672831912ff1770b0`，92,999 bytes，三方相同 |
| 前端 CSS `assets/index-5qjaKexX.css` | **verified** | `adaf06955abcaff313a964c753508d8be821d381bd4bf951d67e95ec08202233`，54,966 bytes，三方相同 |
| 其餘 65 個靜態檔（字型、favicon、授權檔、圖片、GLB、MP3） | **重建 = 部署紀錄；本輪未對正式站重新下載** | 其中 49 個與送審版本的部署紀錄相同；新增的 16 個是 3 張 Pepe 裝飾圖、12 個房屋內部家具 GLB 與 1 個 Pepe 雕像 GLB（`manifests/compare.txt` 標 `NEW since the 0def8cb record`）。本輪依限制只下載 index、JS 與 CSS |
| `_headers`（標頭規則） | **verified（線上觀測）** | 檔案本身不會被提供；本輪對四個靜態回應檢查，6 個安全標頭值與 `source/public/_headers` 完全一致 |
| 上傳的 Worker bundle（`worker/index.js`） | **verified，reviewer 可自行重現** | 只用本快照 `source/` 以 `wrangler deploy --dry-run --outdir` 重建（第 3 節）：264,561 bytes、SHA-256 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`，等於部署紀錄 `SHA256SUMS` 與 manifest `worker.main` 中 `worker/index.js` 的值。「部署紀錄裡的就是實際上傳的那份」仍是團隊端證據 |
| Cloudflare 上實際執行的 Worker 程式與機密設定 | **unverified** | 外部無法下載執行中的 Worker 程式。前一輪持有人提供的 dashboard 截圖（2026-09-29）顯示 `imd-world` 只有一個 secret `ALCHEMY_API_KEY`（值加密）；截圖不能證明執行中的程式碼，reviewer 也無法獨立驗證截圖內容。前端雜湊相符，不能自動證明遠端後端與機密設定一致 |
| 正式 D1 schema（含 0003） | **unverified** | 依限制未查詢正式資料庫。外部可觀測的間接跡象只有：`GET /api/auth/session` 回 200（不需要 0003） |
| 正式 rate limiter 與 D1 綁定 | **持有人提供的 dashboard 截圖確認（前一輪；reviewer 無法獨立驗證）** | `API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `source/wrangler.jsonc` 相同；本版沒有新增綁定。`GET /api/auth/session` 在正式站回 200：如果正式執行的確是這份 bundle，缺 `API_LIMITER` 會是 503，所以這個 200 間接顯示該綁定存在 |
| 帳號內其他 Worker／Pages | **持有人提供的 dashboard 截圖確認（前一輪；reviewer 無法獨立驗證）** | 只列出一個應用程式 `imd-world` |
| workers.dev／preview URL | **設定可自行驗證；線上為前一輪的團隊端觀測** | `wrangler.jsonc:35-36` 為 `workers_dev:false`、`preview_urls:false` |
| 邊緣 WAF rate limiting rule | **團隊端（持有人 dashboard 設定＋前一輪團隊實測）** | `IMD API anti-flood`：`/api/` 每 IP 每 10 秒 20 次，Block 10 秒（`ROUTES.md` 第 4 節） |

**整體仍是 partial**：可重現的部分（Worker bundle、正式前端檔案、回應標頭）都相符；決定實際行為的執行環境（執行中的 Worker、secret、D1 schema、limiter 綁定、WAF 規則）無法從外部獨立確認。

reviewer 能獨立做的：下載 `index.html`、JS、CSS 與任何靜態檔，比對上表雜湊；檢查線上回應標頭與 `GET /api/auth/session` 的回應標頭；從 `source/` 重建 Worker bundle 並比對雜湊（第 3 節）。其他都是團隊端證據。

## 3. 從本快照重建 Worker bundle（reviewer 可自行執行）

Worker 的建置只需要伺服器端輸入：`worker/`、`server/`、Worker 在執行期 import 的 8 個 `src/world/` 模組（`cadence`、`collections`、`houseSize`、`links`、`market`、`model`、`status`、`siwe`）、`wrangler.jsonc`、`package-lock.json` 鎖定的 wrangler／esbuild。不需要被保留的前端檔案，也不需要 Cloudflare 帳號（`--dry-run` 只打包、不上傳）。

```sh
cd source
npm ci                                   # Node v24.19.0、npm 11.17.0；lock 內為 wrangler 4.143.0、esbuild 0.28.1
mkdir -p dist && printf '<!doctype html>\n' > dist/index.html
                                         # wrangler 要求 assets 目錄存在；它的內容不會進 Worker bundle
WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir ../worker-rebuild
sha256sum ../worker-rebuild/index.js     # 14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4
grep 'worker/index.js$' ../manifests/deploy-record-SHA256SUMS.txt
```

- 團隊在 2026-09-29T05:53:07Z 用上述步驟，在只含本快照（沒有任何被保留檔案、已遮蔽）的副本上執行，得到 264,561 bytes、SHA-256 `14584fe4…f5e4`，與部署紀錄相同。輸出：`TESTS/worker-dry-run-output.txt`（本機路徑已換成 `<SCRATCH>`）。
- npm 11.17.0 的 `npm ci` 會提示 `esbuild`、`workerd` 的 postinstall 腳本沒有被允許執行（`allow-scripts`）；上述重建不需要它們。
- 遮蔽（`REDACTIONS.md` 第 1 節）不影響輸出：`wrangler.jsonc` 的 placeholder 與註解不會寫進 bundle；`collections.ts` 只改了註解；其餘遮蔽檔案（`moves.ts`、兩份文件、migration、兩個測試）都不進 Worker bundle。
- 同時產生的 `index.js.map` 內含建置機器的路徑，不作比對。它列出的專案原始檔共 16 個：`worker/index.ts`、`worker/app.ts`、`server/{auth,ownership,presence,gateway,world-api,chain-mock}.ts`、`src/world/{cadence,collections,houseSize,links,market,model,status,siwe}.ts`；第三方套件只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`。
- 重建的 bundle 中可以找到本版新增的字串：`logout-all`、`chain:code`、`chain:erc1271:known`、`auth_refused`、`auth_surge`、`wallet_type`、`token or NFT approvals` 各至少 1 次；`WebSocket`、`EventSource`、`WebSocketPair` 0 次。

這證明「本快照的原始碼可以產生實際上傳的那份 bundle」。它不能證明 Cloudflare 目前執行的就是這份 bundle，也不能證明機密設定的值（第 2 節的 unverified 列）。

## 4. 換行（line ending）與逐位元組重現

私人 repo 沒有 `.gitattributes`。這次的部署工作目錄以 CRLF checkout：

- 用 `git -c core.autocrlf=true archive 2da46cd` 重建：**70 個 `dist/` 檔案全部與部署紀錄逐位元組相同**（`manifests/build-sha256.txt`）。
- 用 `core.autocrlf=false`（LF）重建：只有 `_headers`、`index.html`、`favicon.svg`、`licenses/cinzel-OFL.txt` 四個文字檔不同（`manifests/build-sha256.lf-run.txt`），去掉 CR 後內容相同。JS、CSS、字型、模型、圖片、音樂與 Worker bundle 不受換行影響。
- 本快照 repo 本身有 `.gitattributes`（`* -text`），clone 後的位元組與 commit 內容相同。

建議（本輪未改碼）：在私人 repo 加入 `.gitattributes`（例如 `* text=auto eol=lf`），讓外部人能從 git 直接逐位元組重現，而不必猜 checkout 設定。

## 5. 本輪對正式站的請求

2026-09-29T05:52:39Z–05:52:58Z 的請求全部是公開 GET、低頻（每個請求間隔約 2 秒以上），沒有 POST、沒有錢包、沒有資料庫存取、沒有掃描：`GET /`、`GET /assets/index-Bj4ribmm.js`、`GET /assets/index-5qjaKexX.css`、`GET /api/auth/session`、`GET /assets/InteriorView-Xan3ABOQ.js`，各一次（結果見 `manifests/live-sha256.txt`）。重建 Worker bundle、執行測試與修訂本快照的階段沒有再對正式站發任何請求。

## 6. 不公開的團隊端檔案

部署紀錄中的 `wrangler-logs/`、`wrangler.log` 與 `worker/index.js.map` 含部署者的登入資訊與本機路徑，**不在本快照內**，本輪也沒有讀取它們的內容；本快照只收錄 `SHA256SUMS`（只有雜湊與相對路徑，`manifests/deploy-record-SHA256SUMS.txt`）與上述 manifest 欄位。私人 repo 內由 `scripts/deploy-evidence.mjs` 產生的部署證據頁（`docs/security/deploy-evidence/*`）也不收錄，只列雜湊。
