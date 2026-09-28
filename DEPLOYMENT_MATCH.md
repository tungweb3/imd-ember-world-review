# DEPLOYMENT_MATCH：送審來源、建置與正式部署的對照

## 1. 版本識別

| 項目 | 值 | 證據類型 |
|---|---|---|
| 網站 | https://imdember.com/ | — |
| Worker 名稱 | `imd-world` | `source/wrangler.jsonc` |
| 正式 Worker version | `beac62be-27ff-40cd-9dc4-3cbbdc6add4b`：部署紀錄中 wrangler 回傳的 Version ID。本輪沒有再用 wrangler 查詢部署狀態；「這是目前 100% 流量的版本」是團隊端說明，與下方正式前端檔案的比對結果一致 | 團隊端 |
| 來源 commit | `0def8cb5b80083d32545c59bc707fbbc92a4758d`（committer date 2026-09-28T23:57:58+08:00） | 團隊端（私人 repo） |
| 部署紀錄 | `deploy-records/20260928T160119Z-0def8cb`：mode `deploy`，started 2026-09-28T16:01:19.021Z，finished 16:01:50.078Z，branch `harden2`（與 main 同一 commit），`dirty:false`，`envFiles:[]`，`tests:"passed"`，tools node v24.19.0／wrangler 4.92.0／vite 8.3.1／typescript 5.9.3，`wrangler.exitCode:0`，`wrangler.versionId = beac62be-…`，`dist.unchangedDuringDeploy:true` | 團隊端（只摘錄這些欄位與雜湊） |
| D1 migration | `migrations/0002_sign_in_budgets.sql` 在部署前套用到正式 D1（只增不改） | 團隊端說明；本輪未查詢正式資料庫 |
| 本快照 | 本 repo 的 commit（見 `git log`）；`source/` = `git -c core.autocrlf=false archive 0def8cb` 中的 51 個檔案，其中 5 個有遮蔽（只改註解、文件文字與設定值，`REDACTIONS.md` 第 1 節） | 可自行驗證（本 repo） |
| 私人 repo tag | `v2026.09.29-beac62be` 指向 0def8cb | 團隊端 |

部署紀錄中的 config 雜湊與 git blob 的關係：

| 檔案 | manifest SHA-256 | 說明 |
|---|---|---|
| `wrangler.jsonc` | `6dd513e6…2f46` | 等於 git blob（LF）的雜湊；本快照的遮蔽版為另一個值（`REDACTIONS.md`） |
| `package-lock.json` | `212f78a5…6dc9` | 等於 git blob（blob id `90eb7b4a…`）轉成 CRLF 後的雜湊；本快照 `source/package-lock.json` 是 LF 的 blob 原文 |
| `public/_headers` | `0de79067…534b` | 等於 git blob（blob id `9c807469…`，LF 為 `b89d6828…c48d`，即本快照 `source/public/_headers`）轉成 CRLF 後的雜湊 |

## 2. 各類檔案的比對結果

方法（團隊端，需要完整原始碼）：從 0def8cb 以 `git -c core.autocrlf=true archive` 取出 → `npm ci` → `vite build`（Node v24.19.0），得到 53 個 `dist/` 檔案；另以 `core.autocrlf=false` 取出並 `npm run build` 一次；對正式站的 `index.html`、JS、CSS 各 GET 一次計算 SHA-256；並與部署紀錄 `SHA256SUMS` 比對。明細：`manifests/compare.txt`、`manifests/build-sha256.txt`、`manifests/build-sha256.lf-run.txt`、`manifests/live-sha256.txt`、`manifests/deploy-record-SHA256SUMS.txt`。

| 類別 | 結果 | 依據 |
|---|---|---|
| `index.html` | **verified** | 線上 = 部署紀錄 = 重建：`49973696ecc3db3bdac2cf041d3f903b2b5f9bfe687f0895f2d0eb0aae357459`（730 bytes，CRLF；見第 4 節） |
| 前端 JS `assets/index-BPJxeGls.js` | **verified** | `3ba7f1e06d50d8a05f90bf23e7ccdbff0e6daf2717ce6e2cbe8e42319970277e`，1,306,006 bytes，三方相同 |
| 前端 CSS `assets/index-BOzKL2IR.css` | **verified** | `83f3b7da4ac0845236cd609d89b17d3e30958ed99bbce5ded93f2ed26cafd804`，53,394 bytes，三方相同（與前一版相同） |
| 其餘 49 個靜態檔（字型 2、favicon、2 份授權檔、`pepe.webp`、23 個 GLB、20 個 MP3） | **重建 = 部署紀錄；本輪未對正式站重新下載** | 重建與部署紀錄逐檔相同；它們的 SHA-256 也與前一版（30449b2）的部署紀錄相同，前一版曾對正式站逐檔比對（29 個逐位元組相同，20 個 MP3 只比對大小與檔名雜湊）。本輪依限制只下載 index、JS、CSS |
| `_headers`（標頭規則） | **verified（線上觀測）** | 檔案本身不會被提供；本輪對 `/`、JS、CSS 三個回應檢查，6 個安全標頭值與 `source/public/_headers` 完全一致。reviewer 可對任一靜態檔 `curl -I` 自行核對 |
| 上傳的 Worker bundle（`worker/index.js`） | **verified，reviewer 可自行重現** | 只用本快照 `source/` 以 `wrangler deploy --dry-run --outdir` 重建（第 3 節）：257,723 bytes、SHA-256 `4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3`，等於部署紀錄 `SHA256SUMS` 與 manifest `worker.main` 中 `worker/index.js` 的值。「部署紀錄裡的就是實際上傳的那份」仍是團隊端證據 |
| Cloudflare 上實際執行的 Worker 程式與機密設定 | **unverified**（程式碼）；secret 名稱由持有人截圖確認 | 外部無法下載執行中的 Worker 程式。持有人提供的 dashboard 截圖（2026-09-29）顯示 `imd-world` 只有一個 secret `ALCHEMY_API_KEY`（值加密、無法讀取）；截圖不能證明執行中的程式碼，reviewer 也無法獨立驗證截圖內容。審查規格也提醒：前端 bundle 雜湊相符，不能自動證明遠端後端與機密設定一致 |
| 正式 D1 schema（含 0002） | **unverified** | 依限制未查詢正式資料庫 |
| 正式 rate limiter 與 D1 綁定 | **持有人提供的 dashboard 截圖確認（reviewer 無法獨立驗證）** | 截圖（2026-09-29）顯示 `imd-world` 的綁定為 `API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `source/wrangler.jsonc` 相同。外部可觀測的部分：`GET /api/auth/session` 在正式站回 200。**如果**正式執行的確是 0def8cb 的 bundle（團隊端，見上表），缺 `API_LIMITER` 會是 503，所以這個 200 間接顯示該綁定存在；舊版 d2c0bcda 缺綁定時也回 200，所以這個推論不能獨立證明版本；其餘三個本輪沒有用 wrangler 或請求另外查詢。重建的 bundle 的 `--dry-run` 輸出列出四個綁定（`TESTS/worker-dry-run-output.txt`），那是設定，不是正式狀態 |
| 帳號內其他 Worker／Pages | **持有人提供的 dashboard 截圖確認（reviewer 無法獨立驗證）** | IMD 帳號的 Workers & Pages 只列出一個應用程式 `imd-world`（imdember.com），所以沒有其他 Worker／Pages 綁定 D1 `imd-world`。截圖與 account id 不收錄 |
| workers.dev／preview URL | **設定可自行驗證；線上為團隊端觀測** | `wrangler.jsonc:33-34` 為 `workers_dev:false`、`preview_urls:false`；團隊端對該 Worker 的 workers.dev 主機名稱 GET 回 404 |
| 邊緣 WAF rate limiting rule | **團隊端（持有人 dashboard 設定＋團隊實測）** | `IMD API anti-flood`：`/api/` 每 IP 每 10 秒 20 次，Block 10 秒；2026-09-29 約 01:20（+08，2026-09-28 約 17:20Z）起涵蓋整個 `/api/`。實測（約 17:22Z）：單一 IP 在約 12 秒內送 30 個 GET，約從第 24 個起由邊緣回 429（`ROUTES.md` 第 4 節、本檔第 5 節） |

reviewer 能獨立做的：下載 `index.html`、JS、CSS 與任何靜態檔，比對上表雜湊；檢查線上回應標頭與 `GET /api/auth/session` 的回應標頭；從 `source/` 重建 Worker bundle 並比對雜湊（第 3 節）。其他都是團隊端證據。

## 3. 從本快照重建 Worker bundle（reviewer 可自行執行）

Worker 的建置只需要伺服器端輸入：`worker/`、`server/`、Worker 在執行期 import 的 7 個 `src/world/` 模組（`cadence`、`collections`、`houseSize`、`links`、`market`、`model`、`status`）、`wrangler.jsonc`、`package-lock.json` 鎖定的 wrangler／esbuild。不需要被保留的前端檔案，也不需要 Cloudflare 帳號（`--dry-run` 只打包、不上傳）。

```sh
cd source
npm ci                                   # Node v24.19.0、npm 11.17.0；lock 內為 wrangler 4.92.0
mkdir -p dist && printf '<!doctype html>\n' > dist/index.html
                                         # wrangler 要求 assets 目錄存在；它的內容不會進 Worker bundle
WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir ../worker-rebuild
sha256sum ../worker-rebuild/index.js     # 4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3
grep 'worker/index.js' ../manifests/deploy-record-SHA256SUMS.txt
```

- 遮蔽（`REDACTIONS.md` 第 1 節）不影響輸出：`wrangler.jsonc` 的 placeholder 與註解不會寫進 bundle；`collections.ts`、`moves.ts` 與 migration 只改了註解，打包時註解被丟掉。
- 團隊在 2026-09-28T16:09Z（遮蔽前的註解）與 16:51:21Z（目前的遮蔽版）用上述步驟，在只含本快照（沒有任何被保留檔案）的副本上執行，兩次都得到相同的 SHA-256 與大小。
- （團隊端）把遮蔽版的 `collections.ts`、`moves.ts` 放進 commit 0def8cb 的完整 CRLF 原始碼後重新 `vite build`（2026-09-28T16:52Z）：`index-BPJxeGls.js`、`index-BOzKL2IR.css`、`index.html` 的 SHA-256 仍與正式站及部署紀錄相同，所以註解遮蔽也沒有改變前端 bundle。輸出紀錄：`TESTS/worker-dry-run-output.txt`（本機路徑已換成 `<SCRATCH>`）。
- 同時產生的 `index.js.map` 內含建置機器的路徑，雜湊會因機器而異，不作比對。它列出的專案原始檔共 15 個：`worker/index.ts`、`worker/app.ts`、`server/{auth,ownership,presence,gateway,world-api,chain-mock}.ts`、`src/world/{cadence,collections,houseSize,links,market,model,status}.ts`；第三方套件只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`。
- 重建的 bundle 中可以找到本版新增的字串：`SIGN_IN_BUSY`、`CHAIN_BUSY`、`LIMITER_UNAVAILABLE`、`limiter_unavailable`、`chain:erc1271`、`chain:index`、`chain:assets` 各 1 次；`WebSocket`、`EventSource`、`WebSocketPair` 0 次。

這證明「本快照的原始碼可以產生實際上傳的那份 bundle」。它不能證明 Cloudflare 目前執行的就是這份 bundle，也不能證明機密設定的值（第 2 節的 unverified 列）。

## 4. 換行（line ending）與逐位元組重現

私人 repo 沒有 `.gitattributes`。這次的部署工作目錄（`imd-world-harden2`）以 `core.autocrlf=true` checkout，文字檔大多是 CRLF：

- 用 `git -c core.autocrlf=true archive 0def8cb` 重建：**53 個 `dist/` 檔案全部與部署紀錄逐位元組相同**（`manifests/build-sha256.txt`）。
- 用 `core.autocrlf=false`（LF）重建：只有 `_headers`、`index.html`、`favicon.svg`、`licenses/cinzel-OFL.txt` 四個文字檔不同（`manifests/build-sha256.lf-run.txt`），去掉 CR 後內容相同。JS、CSS、字型、模型、音樂與 Worker bundle 不受換行影響，兩種方式都逐位元組相同。
- 例外：部署紀錄的 `wrangler.jsonc` 雜湊是 LF 版本（該檔在部署工作目錄是 LF）。它不影響任何建置輸出。
- 本快照 repo 本身有 `.gitattributes`（`* -text`），clone 後的位元組與 commit 內容相同，不受 `core.autocrlf` 影響。

建議（本輪未改碼）：在私人 repo 加入 `.gitattributes`（例如 `* text=auto eol=lf`），或讓 `deploy.mjs` 記錄每個檔案的換行狀態，讓外部人能從 git 直接逐位元組重現，而不必猜 checkout 設定。

## 5. 本輪對正式站的請求

2026-09-28T16:05:57Z–16:06:13Z 的請求全部是公開 GET、低頻（每個請求間隔約 1 秒以上），沒有 POST、沒有錢包、沒有資料庫存取、沒有掃描：`GET /`、`GET /assets/index-BPJxeGls.js`、`GET /assets/index-BOzKL2IR.css`、`GET /api/auth/session`，各一次（回應標頭一併保存於團隊端，內容見 `manifests/live-sha256.txt`）。重建 Worker bundle、執行測試與修訂本快照的階段沒有再對正式站發任何請求。

之後，團隊為確認邊緣 WAF 規則另外送了下列請求（團隊端；前兩組為了觸發規則而連續送出，不屬於低頻）：

- 持有人約 2026-09-28T17:20Z 儲存擴大後的規則，團隊隨即從單一 IP 依序送 26 個 `GET /api/auth/session`，當時都還沒有被擋（設定傳播延遲）。
- 約 17:22Z，從同一 IP 在約 12 秒內依序送 30 個 `GET /api/auth/session`，約從第 24 個起由邊緣回 429；再加送 1 個，仍是 429（第 2 節、`ROUTES.md` 第 4 節）。
- 對該 Worker 的 workers.dev 主機名稱 GET 一次，回 404。

以上全部是 GET，沒有 POST、錢包或資料庫存取。

## 6. 不公開的團隊端檔案

部署紀錄中的 `wrangler-logs/`、`wrangler.log` 與 `worker/index.js.map` 含部署者的登入資訊與本機路徑，**不在本快照內**，本輪也沒有讀取它們的內容；本快照只收錄 `SHA256SUMS`（只有雜湊與相對路徑，`manifests/deploy-record-SHA256SUMS.txt`）與上述 manifest 欄位。
