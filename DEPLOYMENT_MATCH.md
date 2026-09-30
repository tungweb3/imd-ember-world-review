# DEPLOYMENT_MATCH：送審來源、建置與正式部署的對照

## 1. 版本識別

| 項目 | 值 | 證據類型 |
|---|---|---|
| 網站 | https://imdember.com/ | — |
| Worker 名稱 | `imd-world` | `source/wrangler.jsonc` |
| 正式 Worker version | `1a0dd495-35e7-4052-ba84-332e787f864d`：部署紀錄中 wrangler 回傳的 Version ID（manifest `wrangler.versionId`）。本輪沒有用 wrangler 查詢部署狀態；「這是目前 100% 流量的版本」是團隊端說明，與下方正式前端檔案的比對結果一致 | 團隊端 |
| 來源 commit | `4321bb4da3826276919ed60ecc2018139dcaeacc`（committer date 2026-09-30T03:53:34+08:00；私人 repo，tag `v2026.09.30-1a0dd495`） | 團隊端（私人 repo） |
| 部署紀錄 | `deploy-records/20260929T195417Z-4321bb4`：mode `deploy`，started 2026-09-29T19:54:17.306Z，finished 19:54:53.523Z，從該 commit 的乾淨 worktree 部署（branch 欄位為 `HEAD`），`dirty:false`，`envFiles:[]`，`tests:"passed"`，tools node v24.19.0／wrangler 4.143.0／vite 8.3.1／typescript 5.9.3，`wrangler.exitCode:0`，`wrangler.versionId = 1a0dd495-…`，`dist.unchangedDuringDeploy:true`，`worker.main` = `worker/index.js` 274,961 bytes、SHA-256 `1018f02a…078c`。由同一份紀錄產生的證據頁已收錄：`source/docs/security/deploy-evidence/20260929T195417Z-4321bb4.md` | 團隊端（只摘錄這些欄位與雜湊） |
| 上一輪送審之後的正式部署 | 依團隊的部署紀錄：`c89f5915-9511-4d90-893f-6555fe2e086d`（來源 `5398b90`，2026-09-29 17:25 UTC；Swarm Report e48d0a96 的 W-1..W-3 修正、undici 鎖版、移除舊 SIWE statement 的相容、效能調整；Worker bundle `bedef2a4690239ccca8ee03db4928cb2246e1589a95169ce6bdb6a6c8b23f43f`；不含 A-1..A-8）→ `1a0dd495`（來源 `4321bb4`：在其上加入 Swarm Audit 519db624 的 A-1..A-8，另有前端的「非官方專案」聲明與天氣說明文字，與登入安全無關）。之後 2026-09-30 06:48–09:27 UTC 的正式版本是 `6e7e40cd-e6b9-481b-af2b-3f49347ef7cc`（來源 `df8ea90`，視覺版面調整；部署紀錄記下的 Worker bundle 同樣是 `1018f02a…078c`，前端改動包括 `moves.ts` 本機搬家清單的鍵名與 `market.ts` 的市場畫面位置），團隊在 09:27 UTC 以 `wrangler rollback` 回到 `1a0dd495`。`df8ea90` 不在本快照內。這三次部署的證據頁都已收錄：`source/docs/security/deploy-evidence/20260929T172429Z-5398b90.md`、`20260929T195417Z-4321bb4.md`、`20260930T064805Z-df8ea90.md` | 團隊端 |
| 上一輪送審版本 | `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f`（來源 `2da46cd`，Worker bundle `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`）：本 repo commit `b6e986b` 描述的版本；2026-09-29 完成的 Swarm Report 重測 e48d0a96（部署對照結論 partial）與 Swarm Audit 519db624 審的都是它。更早的 `c2a8c33` 描述的是 `beac62be-27ff-40cd-9dc4-3cbbdc6add4b`（來源 `0def8cb`，Worker bundle `4ec73351…0eccf3`）。`1a0dd495` 本身尚未經重新審查 | 見 `b6e986b`、`c2a8c33` |
| D1 migration | `migrations/0004_index_candidates.sql`（A-2；只新增一個表 `index_candidates`，不改其他表）在部署 `1a0dd495` 前、約 2026-09-29 19:53 UTC 套用到正式 D1：先匯出備份，之後 `wrangler d1 migrations list imd-world --remote` 回答沒有待套用的 migration，遠端表清單含 `index_candidates`（上述證據頁）。0001–0003 在更早的部署前已套用 | 團隊端說明；本輪未查詢正式資料庫 |
| 本快照 | 本 repo 的 commit（見 `git log`）；`source/` = `git -c core.autocrlf=false archive 132228cf746cb41cd9e3a5124a5903e9ab2da386`（私人 repo 的 `main`，2026-09-30）中的 72 個檔案，其中 8 個有遮蔽（`REDACTIONS.md` 第 1 節）。132228c 與部署的 4321bb4 相比，只有 `docs/security/AUDIT_REMEDIATION_STATUS.md`、`tests/review-record.test.mjs` 與兩個部署證據頁不同；所有會進入 Worker 或前端建置的公開檔案兩者相同（`manifests/published-source-gitblobs.txt` 的說明行） | 可自行驗證（本 repo）；「132228c 與 4321bb4 只差這些」是團隊端說明，Worker 部分可由第 3 節的重建交叉確認 |

部署紀錄中的 config 雜湊與 git blob 的關係（部署工作目錄以 CRLF checkout）：

| 檔案 | manifest SHA-256 | 說明 |
|---|---|---|
| `wrangler.jsonc` | `e94146c0…4290` | 等於原始 git blob（blob id `97b387d3…`）轉成 CRLF 後的雜湊（LF 為 `17903ea4…5fc6`）；本快照的遮蔽版為另一個值（`REDACTIONS.md`） |
| `package-lock.json` | `5098282c…acc5` | 等於 git blob（blob id `b55eb002…`）轉成 CRLF 後的雜湊；本快照 `source/package-lock.json` 是 LF 的 blob 原文（`9f86565e…b95b`） |
| `public/_headers` | `da0b20c4…c29e` | 等於 git blob（blob id `69421584…`，LF 為 `010ed5e5…cc07`，即本快照 `source/public/_headers`）轉成 CRLF 後的雜湊，也就是部署的 `dist/_headers`。與上一輪送審版本相比只改了註解（內容雜湊副本的快取說明），標頭規則與值不變 |

## 2. 各類檔案的比對結果

方法（團隊端，需要完整原始碼）：從 4321bb4 以 `git -c core.autocrlf=true archive` 取出 → `npm ci` → `npm run build`（`tsc --noEmit && vite build`，Node v24.19.0，2026-09-30T11:59:49Z），得到 100 個 `dist/` 檔案；另以 `core.autocrlf=false` 取出並 build 一次（12:00:45Z）；對正式站的 `index.html`、主 JS、房屋內部 chunk、CSS 各 GET 一次計算 SHA-256；並與部署紀錄 `SHA256SUMS` 比對。明細：`manifests/compare.txt`（統計：VERIFIED 4、RECORD-MATCH 95、NOT-SERVED 1）、`manifests/build-sha256.txt`、`manifests/build-sha256.lf-run.txt`、`manifests/live-sha256.txt`、`manifests/deploy-record-SHA256SUMS.txt`。

| 類別 | 結果 | 依據 |
|---|---|---|
| `index.html` | **verified** | 線上 = 部署紀錄 = 重建：`b3ee4f225fd60f7c5118284471cd2f05779c4a110d1d8518113e08b0e97ddab8`（2,634 bytes，CRLF） |
| 前端主 JS `assets/index-BFVt9xb_.js` | **verified** | `ec1f3da36a0141f0308e384284e41cc97f344d7fbed594ede9071994c7ea58d2`，1,383,354 bytes，三方相同 |
| 房屋內部 chunk `assets/InteriorView-wZGOk4w6.js` | **verified** | `13616a8827bfa406b285833d404d5d4f3e49ca9649dd5d0e9adb11944677cbbd`，93,255 bytes，三方相同 |
| 前端 CSS `assets/index-DkZ6U0YC.css` | **verified** | `d14af57285213037ad12066e17763a2d2c00ad30369563c8eef90c1f8ab26c84`，55,902 bytes，三方相同 |
| 其餘 95 個靜態檔（字型、favicon、授權檔、圖片、GLB、MP3、手機版地形資料） | **重建 = 部署紀錄；本輪未對正式站重新下載** | `manifests/compare.txt` 標 `RECORD-MATCH`。與上一輪送審版本（2da46cd）的部署紀錄相比，全部 100 個檔案中 42 個相同；25 個有變（`_headers`、`index.html` 與 23 個房屋、地標、船的 GLB）；33 個是新的（新的主 JS、CSS 與房屋內部 chunk，`assets/` 下 28 個檔名含內容雜湊的模型、Pepe 裝飾與參考圖副本（`src/world/publicUrl.ts`、`src/world/publicHashes.ts`），1 個 `assets/terrain-phone.14ece2ac35.bin`，1 張 `references/imd/pepe-idle.webp`）；上一輪的主 JS、CSS 與房屋內部 chunk 已不在紀錄中。本輪依限制只下載 index、JS 與 CSS |
| `_headers`（標頭規則） | **verified（線上觀測）** | 檔案本身不會被提供（`NOT-SERVED`）；本輪對四個靜態回應檢查，6 個安全標頭值與 `source/public/_headers` 完全一致 |
| 上傳的 Worker bundle（`worker/index.js`） | **verified，reviewer 可自行重現** | 只用本快照 `source/` 以 `wrangler deploy --dry-run --outdir` 重建（第 3 節）：274,961 bytes、SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`，等於部署紀錄 `SHA256SUMS` 與 manifest `worker.main` 中 `worker/index.js` 的值。「部署紀錄裡的就是實際上傳的那份」仍是團隊端證據 |
| Cloudflare 上實際執行的 Worker 程式與機密設定 | **unverified** | 外部無法下載執行中的 Worker 程式，也無法確認目前 100% 流量是 `1a0dd495`（2026-09-30 06:48–09:27 UTC 曾是 `6e7e40cd`，團隊說明已回滾；兩者部署紀錄的 Worker bundle 相同）。本輪 GET 到的四個前端檔案等於 4321bb4 的部署紀錄，不等於 df8ea90 的紀錄（其 `index.html` 為 `ad646c22…`，見 `20260930T064805Z-df8ea90.md`），與回滾一致。持有人較早提供的 dashboard 截圖（2026-09-29，早於本版部署）顯示 `imd-world` 只有一個 secret `ALCHEMY_API_KEY`（值加密）；本輪沒有新的截圖，截圖也不能證明執行中的程式碼，reviewer 無法獨立驗證。前端雜湊相符，不能自動證明遠端後端與機密設定一致 |
| 正式 D1 schema（含 0004） | **unverified** | 依限制未查詢正式資料庫；0004 已套用是團隊說明（第 1 節）。外部可觀測的間接跡象只有 `GET /api/auth/session` 回 200（不需要 0003、0004）。程式在沒有 0004 的資料庫上照舊運作（`tests/ownership.test.mjs:236` "deployed before migrations/0004…"），所以正常的回應也不能證明 0004 已套用 |
| 正式 rate limiter 與 D1 綁定 | **持有人提供的 dashboard 截圖確認（較早的一輪；reviewer 無法獨立驗證）** | `API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `source/wrangler.jsonc:44-62` 相同；證據頁 `20260929T195417Z-4321bb4.md` 列出同樣的值（取自 `wrangler.jsonc`，不是讀 Cloudflare）。本版沒有新增綁定：A-1 的新鍵 `chain:erc1271:lane` 用既有的 `CHAIN_LIMITER`，`wrangler.jsonc` 只在第 52–54 行的註解加上說明；dry-run 列出的綁定也與上一版相同（`TESTS/worker-dry-run-output.txt`）。`GET /api/auth/session` 在正式站回 200：如果正式執行的確是這份 bundle，缺 `DB` 或 `API_LIMITER` 會是 503（`server/auth.ts:508-511`、`server/auth.ts:522`、`worker/app.ts:89-95`），所以這個 200 間接顯示這兩個綁定存在 |
| 帳號內其他 Worker／Pages | **持有人提供的 dashboard 截圖確認（較早的一輪；reviewer 無法獨立驗證）** | 只列出一個應用程式 `imd-world` |
| workers.dev／preview URL | **設定可自行驗證；線上為較早一輪的團隊端觀測** | `wrangler.jsonc:35-36` 為 `workers_dev:false`、`preview_urls:false` |
| 邊緣 WAF rate limiting rule | **團隊端（持有人 dashboard 設定＋較早一輪的團隊實測）** | `IMD API anti-flood`：`/api/` 每 IP 每 10 秒 20 次，Block 10 秒；rule id `866d2fae97c942389a9fa9f15c411f46`（證據頁寫明是 2026-09-29 從 dashboard 讀到、本次部署沒有重讀）。說明見 `ROUTES.md` 與 `server/auth.ts:83-85` |

**整體仍是 partial**：可重現的部分（Worker bundle、正式前端檔案、回應標頭）都相符；決定實際行為的執行環境（實際服務流量的 Worker version、執行中的 Worker、secret、D1 schema、limiter 綁定、WAF 規則）無法從外部獨立確認。

reviewer 能獨立做的：下載 `index.html`、JS、CSS 與任何靜態檔，比對上表雜湊；檢查線上回應標頭與 `GET /api/auth/session` 的回應標頭；從 `source/` 重建 Worker bundle 並比對雜湊（第 3 節）；閱讀已收錄的部署證據頁（內容仍是團隊端證據）。其他都是團隊端證據。

## 3. 從本快照重建 Worker bundle（reviewer 可自行執行）

Worker 的建置只需要伺服器端輸入：`worker/`、`server/`、Worker 在執行期 import 的 8 個 `src/world/` 模組（`cadence`、`collections`、`houseSize`、`links`、`market`、`model`、`status`、`siwe`）、`wrangler.jsonc`、`package-lock.json` 鎖定的 wrangler／esbuild。不需要被保留的前端檔案，也不需要 Cloudflare 帳號（`--dry-run` 只打包、不上傳）。

```sh
cd source
npm ci                                   # Node v24.19.0、npm 11.17.0；lock 內為 wrangler 4.143.0、esbuild 0.28.1
mkdir -p dist && printf '<!doctype html>\n' > dist/index.html
                                         # wrangler 要求 assets 目錄存在；它的內容不會進 Worker bundle
WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir ../worker-rebuild
sha256sum ../worker-rebuild/index.js     # 1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c
grep 'worker/index.js$' ../manifests/deploy-record-SHA256SUMS.txt
```

- 團隊在 2026-09-30T11:56:14Z 用上述步驟（`npm ci` 11:55:39Z–11:56:14Z），在只含本快照 72 個檔案（沒有任何被保留檔案、已遮蔽）的副本上執行，得到 274,961 bytes、SHA-256 `1018f02a…078c`，與部署紀錄相同。輸出：`TESTS/worker-dry-run-output.txt`（本機路徑已換成 `<SCRATCH>`）。
- npm 11.17.0 的 `npm ci` 會提示 `esbuild`、`workerd` 的 postinstall 腳本沒有被允許執行（`allow-scripts`）；上述重建不需要它們。
- 遮蔽（`REDACTIONS.md` 第 1 節）不影響輸出：`wrangler.jsonc` 的 placeholder 與註解不會寫進 bundle；`collections.ts` 只改了註解；其餘遮蔽檔案（`moves.ts`、兩份文件、migration、兩個測試）都不進 Worker bundle。
- 同時產生的 `index.js.map` 內含建置機器的路徑，不作比對。它列出的專案原始檔與上一輪相同，共 16 個：`worker/index.ts`、`worker/app.ts`、`server/{auth,ownership,presence,gateway,world-api,chain-mock}.ts`、`src/world/{cadence,collections,houseSize,links,market,model,status,siwe}.ts`（`server/d1.ts` 只提供型別）；第三方套件只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`。
- 重建的 bundle 中可以找到自 2da46cd 以來新增的字串，各至少 1 次：`chain:erc1271:lane`（`server/auth.ts:190`，A-1）、`CLAIM_LANE`（`server/auth.ts:154`，A-1）、`budget_lane`（`server/auth.ts:405`，A-1 的拒絕原因）、`FRESH_NETWORK_RESERVE`（`server/auth.ts:118`，A-7）、`index_candidates`（`server/ownership.ts:153`、`server/ownership.ts:156`、`server/presence.ts:43`，A-2）、`/api/world/_shared/v1/`（`worker/app.ts:45`，效能調整）；A-6 移除的 `WALLET_CHALLENGE_BUDGET` 0 次；`WebSocket`、`EventSource`、`WebSocketPair` 0 次。

這證明「本快照的原始碼可以產生實際上傳的那份 bundle」。它不能證明 Cloudflare 目前執行的就是這份 bundle，也不能證明機密設定的值（第 2 節的 unverified 列）。

## 4. 換行（line ending）與逐位元組重現

私人 repo 仍然沒有 `.gitattributes`。這次的部署工作目錄以 CRLF checkout：

- 用 `git -c core.autocrlf=true archive 4321bb4` 重建：**100 個 `dist/` 檔案全部與部署紀錄逐位元組相同**（`manifests/build-sha256.txt`）。
- 用 `core.autocrlf=false`（LF）重建：只有 `_headers`、`favicon.svg`、`index.html`、`licenses/cinzel-OFL.txt` 四個文字檔不同（`manifests/build-sha256.lf-run.txt`），差別只在 CR 位元組。JS、CSS、字型、模型、圖片、音樂、地形資料與 Worker bundle 不受換行影響。
- 本快照 repo 本身有 `.gitattributes`（`* -text`），clone 後的位元組與 commit 內容相同。

建議（本輪未改碼）：在私人 repo 加入 `.gitattributes`（例如 `* text=auto eol=lf`），讓外部人能從 git 直接逐位元組重現，而不必猜 checkout 設定。

## 5. 本輪對正式站的請求

2026-09-30 11:57:34–11:57:51 UTC（以回應的 Date 標頭為準）的請求全部是公開 GET、低頻（每個請求間隔 2.5 秒以上），沒有 POST、沒有錢包、沒有資料庫存取、沒有掃描：`GET /`、`GET /assets/index-BFVt9xb_.js`、`GET /assets/index-DkZ6U0YC.css`、`GET /api/auth/session`、`GET /assets/InteriorView-wZGOk4w6.js`，各一次（結果見 `manifests/live-sha256.txt`）。`/api/auth/session` 回 200 `{"signedIn":false}`（`Cache-Control: no-store`、CSP `default-src 'none'; frame-ancestors 'none'`、`Cross-Origin-Resource-Policy: same-origin`、`nosniff`、HSTS，沒有 CORS 標頭）。重建 Worker bundle、前端重建、執行測試與修訂本快照的階段沒有再對正式站發任何請求。

本輪對正式站的請求只有上述 5 個 GET，都在團隊所說的回滾（09:27 UTC）之後；2026-09-30 06:48–09:27 UTC 的 `6e7e40cd` 期間與回滾本身，只有團隊的部署紀錄與說明（第 1 節）。

## 6. 不公開的團隊端檔案

部署紀錄中的 `wrangler-logs/`、`wrangler.log` 與 `worker/index.js.map` 含部署者的登入資訊與本機路徑，**不在本快照內**，本輪也沒有讀取它們的內容；本快照只收錄 `SHA256SUMS`（只有雜湊與相對路徑，`manifests/deploy-record-SHA256SUMS.txt`）與上述 manifest 欄位。

私人 repo 內由 `scripts/deploy-evidence.mjs` 產生的部署證據頁，**這次收錄了 5 頁**（`source/docs/security/deploy-evidence/`：1a0ba21、2da46cd、5398b90、4321bb4、df8ea90 的部署）：`tests/review-record.test.mjs:185-187` 會確認 `AUDIT_REMEDIATION_STATUS.md` 引用的每個 `docs/security/*.md` 頁面都存在；這些頁面只含腳本從部署紀錄取出的結構化欄位（版本、雜湊、migration、limiter 綁定、WAF 規則 id），不含 log 文字（`tests/deploy-evidence.test.mjs` 檢查產生器的輸出）。它們與 git blob 逐位元組相同、沒有遮蔽；內容仍是團隊端證據。
