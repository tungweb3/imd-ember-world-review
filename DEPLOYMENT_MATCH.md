# DEPLOYMENT_MATCH：送審來源、建置與正式部署的對照

## 1. 版本識別

| 項目 | 值 | 證據類型 |
|---|---|---|
| 網站 | https://imdember.com/ | — |
| Worker 名稱 | `imd-world` | `source/wrangler.jsonc` |
| 正式 Worker version | `bbf24001-7eec-4f93-b312-a22e299ab275`：部署紀錄中 wrangler 回傳的 Version ID（manifest `wrangler.versionId`）。本輪沒有用 wrangler 查詢部署狀態；「這是目前 100% 流量的版本」是團隊端說明，與下方正式前端檔案的比對結果一致 | 團隊端 |
| 來源 commit | `2e4e830b367f651e3c880587c1a4b465d1bfcd91`（committer date 2026-10-01T12:07:32+08:00；私人 repo，tag `v2026.10.01-bbf24001`） | 團隊端（私人 repo） |
| 部署紀錄 | `deploy-records/20261001T040934Z-2e4e830`：mode `deploy`，started 2026-10-01T04:09:34.487Z，finished 04:10:24.205Z，從該 commit 的乾淨 worktree 部署（branch 欄位為 `audit3-fixes`；團隊說明 `main` 之後快轉到它），`dirty:false`，`envFiles:[]`，`tests:"passed"`，tools node v24.19.0／wrangler 4.143.0／vite 8.3.1／typescript 5.9.3，`wrangler.exitCode:0`，`wrangler.versionId = bbf24001-…`，`dist.unchangedDuringDeploy:true`，`worker.main` = `worker/index.js` 280,605 bytes、SHA-256 `018df7b3…c62c`。由同一份紀錄產生的證據頁已收錄：`source/docs/security/deploy-evidence/20261001T040934Z-2e4e830.md`（其中遠端已套用的 migration、WAF rule id 與「Live checks after the upload」一節是團隊在腳本產生後手動填寫的；腳本只留待填的空格） | 團隊端（只摘錄這些欄位與雜湊） |
| 上一輪送審之後的正式部署 | 依團隊的部署紀錄，`1a0dd495` 之後、`bbf24001` 之前有五次部署，都只改前端：部署紀錄記下的 Worker bundle 都是 `1018f02a…078c`（與 `1a0dd495` 相同），都沒有 migration。依序為 `6e7e40cd-e6b9-481b-af2b-3f49347ef7cc`（來源 `df8ea90`，2026-09-30 06:48 UTC，視覺版面調整；團隊在 09:27 UTC 以 `wrangler rollback` 回到 `1a0dd495`）、`cc5cddb3-d153-4a15-b9c2-6b9311f1a425`（`007ee80`，14:53 UTC：溫和天氣與「平靜」切換、Pepe 放大 1.5 倍、Guardian Hall、三個船站、纜車）、`3e0f4eb3-afa8-48d6-a156-acd621cf5e61`（`a77f91b`，15:48 UTC：第一次讀取世界資料時更早重試）、`5f9e6468-e1df-4ebf-81a1-03235d59c917`（`41ae386`，18:58 UTC：地標原地放大，沒有移動任何住處）、`f152cd66-ae14-4f8f-b143-91420608bf82`（`0d57791`，22:20 UTC：六個纜車車廂、鍛造場）。之後才是 `bbf24001`（來源 `2e4e830` = `0d57791` 加上 Swarm Audit 8c3aea2e 的 N-1..N-7 修正，2026-10-01 04:10 UTC）。這五次與 `bbf24001` 的證據頁都已收錄：`source/docs/security/deploy-evidence/20260930T064805Z-df8ea90.md`、`20260930T145241Z-007ee80.md`、`20260930T154746Z-a77f91b.md`、`20260930T185800Z-41ae386.md`、`20260930T221950Z-0d57791.md`、`20261001T040934Z-2e4e830.md` | 團隊端 |
| 上一輪送審版本 | `1a0dd495-35e7-4052-ba84-332e787f864d`（來源 `4321bb4`，Worker bundle `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`）：本 repo commit `ae1d41a` 描述的版本；Swarm Audit 8c3aea2e（2026-09-30 13:45 UTC 判定）審的是它（6 Low + 1 Info，N-1..N-7；一位審查者只用該快照重建出同一個 Worker bundle `1018f02a…`，與部署紀錄相同；judge 的報告沒有給部署對照結論）。更早的 `b6e986b` 描述 `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f`（來源 `2da46cd`，Worker bundle `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`；Swarm Report e48d0a96，部署對照結論 partial，與 Swarm Audit 519db624），`c2a8c33` 描述 `beac62be-27ff-40cd-9dc4-3cbbdc6add4b`（來源 `0def8cb`，Worker bundle `4ec73351…0eccf3`；Swarm review 4bd31cfb）。`bbf24001` 本身尚未經重新審查 | 見 `ae1d41a`、`b6e986b`、`c2a8c33` |
| D1 migration | `migrations/0005_lanes_and_subnets.sql`（N-4／N-5／N-6；只增不改：`login_challenges` 加兩個可為 NULL 的欄位 `sub`、`called_via`，新增表 `index_lanes` 與兩個索引 `index_lanes_net`、`index_lanes_at`）在部署 `bbf24001` 前、約 2026-10-01 04:09 UTC 套用到正式 D1：先匯出備份，之後 `wrangler d1 migrations list imd-world --remote` 回答沒有待套用的 migration，並讀回該表、兩個索引與兩個欄位（上述證據頁）。0001–0004 在更早的部署前已套用；中間五次前端部署都沒有 migration | 團隊端說明；本輪未查詢正式資料庫 |
| 本快照 | 本 repo 的 commit（見 `git log`，在 `ae1d41a` 之上）；`source/` = `git -c core.autocrlf=false archive f4272c513e2052fb0bea6d2e8512180256a60919`（私人 repo 的 `main`，committer date 2026-10-01T12:14:13+08:00）中的 78 個檔案（上一輪的 72 個加 6 個新公開的檔案，見 `REDACTIONS.md` 第 2 節），其中 8 個有遮蔽（`REDACTIONS.md` 第 1 節）。f4272c5 與部署的 2e4e830 相比，只有 `docs/security/AUDIT_REMEDIATION_STATUS.md`、`docs/wallet-login/DESIGN_W1_v001.md`、`tests/review-record.test.mjs` 不同，另多一個部署證據頁 `20261001T040934Z-2e4e830.md`；所有會進入 Worker 或前端建置的公開檔案兩者相同（`manifests/published-source-gitblobs.txt` 的說明行） | 可自行驗證（本 repo）；「f4272c5 與 2e4e830 只差這些」是團隊端說明，Worker 部分可由第 3 節的重建交叉確認 |

部署紀錄中的 config 雜湊與 git blob 的關係（部署工作目錄以 CRLF checkout）：

| 檔案 | manifest SHA-256 | 說明 |
|---|---|---|
| `wrangler.jsonc` | `4c67da97…7fb6` | 等於原始 git blob（blob id `97112ebc…`）轉成 CRLF 後的雜湊（LF 為 `860f697a…8ad1`）；本快照的遮蔽版為另一個值（`REDACTIONS.md`）。公開版與上一輪相比只有第 53–56 行的註解不同（N-6 的 `chain:index:lane`） |
| `package-lock.json` | `5098282c…acc5` | 等於 git blob（blob id `b55eb002…`）轉成 CRLF 後的雜湊；本快照 `source/package-lock.json` 是 LF 的 blob 原文（`9f86565e…b95b`）。與上一輪送審版本相同 |
| `public/_headers` | `da0b20c4…c29e` | 等於 git blob（blob id `69421584…`，LF 為 `010ed5e5…cc07`，即本快照 `source/public/_headers`）轉成 CRLF 後的雜湊，也就是部署的 `dist/_headers`。與上一輪送審版本相同（blob 未變） |

## 2. 各類檔案的比對結果

方法（團隊端，需要完整原始碼）：從 2e4e830 以 `git -c core.autocrlf=true archive` 取出 → `npm ci` → `npm run build`（`tsc --noEmit && vite build`，Node v24.19.0，2026-10-01T04:28:02Z），得到 100 個 `dist/` 檔案；另以 `core.autocrlf=false` 取出並 build 一次（04:28:23Z）；對正式站的 `index.html`、主 JS、房屋內部 chunk、CSS 各 GET 一次計算 SHA-256；並與部署紀錄 `SHA256SUMS` 比對。明細：`manifests/compare.txt`（統計：VERIFIED 4、RECORD-MATCH 95、NOT-SERVED 1）、`manifests/build-sha256.txt`、`manifests/build-sha256.lf-run.txt`、`manifests/live-sha256.txt`、`manifests/deploy-record-SHA256SUMS.txt`。

| 類別 | 結果 | 依據 |
|---|---|---|
| `index.html` | **verified** | 線上 = 部署紀錄 = 重建：`62af24a41f3825ffd8b8c68b8d2032205b58a82cbb92618fed599609163e49c9`（2,634 bytes，CRLF） |
| 前端主 JS `assets/index-C1BrxBtd.js` | **verified** | `b6d39838089b2707778990485570b6069054bdea22298bc2062b41a17f198d3d`，1,432,648 bytes，三方相同 |
| 房屋內部 chunk `assets/InteriorView-4LZmFcoq.js` | **verified** | `5077095b0b0fee5b68ad02328bc5d2304de7822f90ed933f54780c8880041630`，93,255 bytes，三方相同 |
| 前端 CSS `assets/index-B1zoY2Mz.css` | **verified** | `4d1e832e229e0ea91b5af4b907c915489babf94db21f015c8eb72bf1510e0b32`，57,205 bytes，三方相同 |
| 其餘 95 個靜態檔（字型、favicon、授權檔、圖片、GLB、MP3、手機版地形資料） | **重建 = 部署紀錄；本輪未對正式站重新下載** | `manifests/compare.txt` 標 `RECORD-MATCH`。與上一輪送審版本（4321bb4）的部署紀錄相比，全部 100 個檔案中 93 個相同；2 個有變（`index.html` 與 `models/landmarks/landmark_guardian.glb`）；5 個是新的（新的主 JS、CSS 與房屋內部 chunk，`assets/models/landmarks/landmark_guardian.0ed4a14deb.glb`，`assets/terrain-phone.b79d0a4b5a.bin`）；上一輪的 `assets/index-BFVt9xb_.js`、`assets/index-DkZ6U0YC.css`、`assets/InteriorView-wZGOk4w6.js`、`assets/models/landmarks/landmark_guardian.e6b33e0bee.glb`、`assets/terrain-phone.14ece2ac35.bin` 已不在紀錄中。本輪依限制只下載 index、JS 與 CSS |
| `_headers`（標頭規則） | **verified（線上觀測）** | 檔案本身不會被提供（`NOT-SERVED`）；本輪對四個靜態回應檢查，6 個安全標頭值與 `source/public/_headers` 完全一致 |
| 上傳的 Worker bundle（`worker/index.js`） | **verified，reviewer 可自行重現** | 只用本快照 `source/` 以 `wrangler deploy --dry-run --outdir` 重建（第 3 節）：280,605 bytes、SHA-256 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c`，等於部署紀錄 `SHA256SUMS` 與 manifest `worker.main` 中 `worker/index.js` 的值。「部署紀錄裡的就是實際上傳的那份」仍是團隊端證據 |
| Cloudflare 上實際執行的 Worker 程式與機密設定 | **unverified** | 外部無法下載執行中的 Worker 程式，也無法確認目前 100% 流量是 `bbf24001`。本輪 GET 到的四個前端檔案等於 2e4e830 的部署紀錄，不等於前一次部署 0d57791 的紀錄（其 `index.html` 為 `ae717830…`，見 `20260930T221950Z-0d57791.md`），也不等於 4321bb4 的紀錄（`b3ee4f22…`），與團隊所說 `bbf24001` 正在服務一致。持有人較早提供的 dashboard 截圖（2026-09-29，早於本版部署）顯示 `imd-world` 只有一個 secret `ALCHEMY_API_KEY`（值加密）；本輪沒有新的截圖，截圖也不能證明執行中的程式碼，reviewer 無法獨立驗證。前端雜湊相符，不能自動證明遠端後端與機密設定一致 |
| 正式 D1 schema（含 0005） | **unverified** | 依限制未查詢正式資料庫；0005 已套用是團隊說明（第 1 節）。外部可觀測的間接跡象只有 `GET /api/auth/session` 回 200（不需要 0003–0005）。程式在沒有 0005 的資料庫上會退回 0004 的規則、不拿索引通道，也不回 503（`tests/auth.test.mjs:732` "N-5 (deployed ahead of 0005)…"、`tests/ownership.test.mjs:571` "N-6 (deployed ahead of 0005)…"；沒有 0004 時見 `tests/ownership.test.mjs:242`），所以正常的回應也不能證明 0005 已套用 |
| 正式 rate limiter 與 D1 綁定 | **持有人提供的 dashboard 截圖確認（較早的一輪；reviewer 無法獨立驗證）** | `API_LIMITER` 4101、`SEAT_LIMITER` 4102、`AUTH_LIMITER` 4103、`CHAIN_LIMITER` 4104 與 D1 `imd-world`（`DB`），與 `source/wrangler.jsonc:44-63` 相同；證據頁 `20261001T040934Z-2e4e830.md` 列出同樣的值（取自 `wrangler.jsonc`，不是讀 Cloudflare）。本版沒有新增綁定：N-6 的新鍵 `chain:index:lane`（`server/auth.ts:271`）用既有的 `CHAIN_LIMITER`，`wrangler.jsonc` 只在第 53–56 行的註解加上說明；dry-run 列出的綁定也與上一版相同（`TESTS/worker-dry-run-output.txt`）。`GET /api/auth/session` 在正式站回 200：如果正式執行的確是這份 bundle，缺 `DB` 或 `API_LIMITER` 會是 503（`server/auth.ts:606-609`、`server/auth.ts:627`、`worker/app.ts:96-102`），所以這個 200 間接顯示這兩個綁定存在 |
| 帳號內其他 Worker／Pages | **持有人提供的 dashboard 截圖確認（較早的一輪；reviewer 無法獨立驗證）** | 只列出一個應用程式 `imd-world` |
| workers.dev／preview URL | **設定可自行驗證；線上為較早一輪的團隊端觀測** | `wrangler.jsonc:35-36` 為 `workers_dev:false`、`preview_urls:false` |
| 邊緣 WAF rate limiting rule | **團隊端（持有人 dashboard 設定＋較早一輪的團隊實測）** | `IMD API anti-flood`：`/api/` 每 IP 每 10 秒 20 次，Block 10 秒；rule id `866d2fae97c942389a9fa9f15c411f46`（證據頁寫明是 2026-09-29 從 dashboard 讀到、本次部署沒有重讀）。說明見 `ROUTES.md` 與 `server/auth.ts:99-101` |
| 真實錢包登入（`bbf24001`） | **團隊端說明（reviewer 無法重現，沒有收錄截圖）** | 持有人在 2026-10-01 04:16 與 04:19 UTC 以 MetaMask、一個不持有 IMD 席位的錢包（地址不公開）在 `bbf24001` 上登入：錢包顯示來自 imdember.com 的「Sign-in request」、Ethereum、「No changes」、本站的 statement、Version 1、Chain ID 1；頁面隨後顯示登入 7 天與 "Checked on chain: this wallet holds no IMD seat right now"；按「Log out this device」後顯示 "Signed out."（N-7 的文字）。這不是測試紀錄，也不證明其他錢包的顯示方式 |

**整體仍是 partial**：可重現的部分（Worker bundle、正式前端檔案、回應標頭）都相符；決定實際行為的執行環境（實際服務流量的 Worker version、執行中的 Worker、secret、D1 schema 與 0005、limiter 綁定、WAF 規則）無法從外部獨立確認。

reviewer 能獨立做的：下載 `index.html`、JS、CSS 與任何靜態檔，比對上表雜湊；檢查線上回應標頭與 `GET /api/auth/session` 的回應標頭；從 `source/` 重建 Worker bundle 並比對雜湊（第 3 節）；閱讀已收錄的部署證據頁（內容仍是團隊端證據）。其他都是團隊端證據。

## 3. 從本快照重建 Worker bundle（reviewer 可自行執行）

Worker 的建置只需要伺服器端輸入：`worker/`、`server/`、Worker 在執行期 import 的 8 個 `src/world/` 模組（`cadence`、`collections`、`houseSize`、`links`、`market`、`model`、`status`、`siwe`）、`wrangler.jsonc`、`package-lock.json` 鎖定的 wrangler／esbuild。不需要被保留的前端檔案，也不需要 Cloudflare 帳號（`--dry-run` 只打包、不上傳）。

```sh
cd source
npm ci                                   # Node v24.19.0、npm 11.17.0；lock 內為 wrangler 4.143.0、esbuild 0.28.1
mkdir -p dist && printf '<!doctype html>\n' > dist/index.html
                                         # wrangler 要求 assets 目錄存在；它的內容不會進 Worker bundle
WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir ../worker-rebuild
sha256sum ../worker-rebuild/index.js     # 018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c
grep 'worker/index.js$' ../manifests/deploy-record-SHA256SUMS.txt
```

- 團隊在 2026-10-01T04:25:20Z 用上述步驟（`npm ci` 04:24:47Z–04:25:20Z），在只含本快照 78 個檔案（沒有任何被保留檔案、已遮蔽）的副本上執行，得到 280,605 bytes、SHA-256 `018df7b3…c62c`，與部署紀錄相同。輸出：`TESTS/worker-dry-run-output.txt`（本機路徑已換成 `<SCRATCH>`）。
- npm 11.17.0 的 `npm ci` 會提示 `esbuild`、`workerd` 的 postinstall 腳本沒有被允許執行（`allow-scripts`）；上述重建不需要它們。
- 遮蔽（`REDACTIONS.md` 第 1 節）不影響輸出：`wrangler.jsonc` 的 placeholder 與註解不會寫進 bundle；`collections.ts` 只改了註解；其餘遮蔽檔案（`moves.ts`、兩份文件、migration、兩個測試）都不進 Worker bundle。
- 同時產生的 `index.js.map` 內含建置機器的路徑，不作比對。它列出的專案原始檔與上一輪相同，共 16 個：`worker/index.ts`、`worker/app.ts`、`server/{auth,ownership,presence,gateway,world-api,chain-mock}.ts`、`src/world/{cadence,collections,houseSize,links,market,model,status,siwe}.ts`（`server/d1.ts` 只提供型別）；第三方套件只有 `viem`、`abitype`、`@noble/curves`、`@noble/hashes`。
- 重建的 bundle 中可以找到自 4321bb4（上一輪送審的 `1a0dd495`）以來 Worker 端新增的字串：`chain:index:lane` 1 次（`server/auth.ts:271`，N-6）、`INDEX_LANE`（`server/auth.ts:234`，N-6）、`index_lanes`（`server/auth.ts:234-236`、`server/presence.ts:50`，N-6）、`called_via`（`server/auth.ts:197`、`server/auth.ts:212`，N-4）、`subnetKey`（`worker/app.ts:82`，N-5）、`NET6_SCALE`（`server/auth.ts:158`，N-5）、`expired: true` 1 次（session 路由，`server/auth.ts:532`，N-7）；上一輪的 `chain:erc1271:lane`、`CLAIM_LANE`、`index_candidates` 仍在；`WebSocket`、`EventSource`、`WebSocketPair` 0 次。

這證明「本快照的原始碼可以產生實際上傳的那份 bundle」。它不能證明 Cloudflare 目前執行的就是這份 bundle，也不能證明機密設定的值（第 2 節的 unverified 列）。

## 4. 換行（line ending）與逐位元組重現

私人 repo 仍然沒有 `.gitattributes`。這次的部署工作目錄以 CRLF checkout：

- 用 `git -c core.autocrlf=true archive 2e4e830` 重建：**100 個 `dist/` 檔案全部與部署紀錄逐位元組相同**（`manifests/build-sha256.txt`）。
- 用 `core.autocrlf=false`（LF）重建：只有 `_headers`、`favicon.svg`、`index.html`、`licenses/cinzel-OFL.txt` 四個文字檔不同（`manifests/build-sha256.lf-run.txt`），差別只在 CR 位元組。JS、CSS、字型、模型、圖片、音樂、地形資料與 Worker bundle 不受換行影響。
- 本快照 repo 本身有 `.gitattributes`（`* -text`），clone 後的位元組與 commit 內容相同。

建議（本輪未改碼）：在私人 repo 加入 `.gitattributes`（例如 `* text=auto eol=lf`），讓外部人能從 git 直接逐位元組重現，而不必猜 checkout 設定。

## 5. 本輪對正式站的請求

2026-10-01 04:24:56–04:25:11 UTC（以回應的 Date 標頭為準）的請求全部是公開 GET、低頻（每個請求間隔 3 秒以上），沒有 POST、沒有錢包、沒有資料庫存取、沒有掃描：`GET /`、`GET /assets/index-C1BrxBtd.js`、`GET /assets/index-B1zoY2Mz.css`、`GET /api/auth/session`、`GET /assets/InteriorView-4LZmFcoq.js`，各一次（結果見 `manifests/live-sha256.txt`）。`/api/auth/session` 回 200 `{"signedIn":false}`（`Cache-Control: no-store`、CSP `default-src 'none'; frame-ancestors 'none'`、`Cross-Origin-Resource-Policy: same-origin`、`nosniff`、HSTS，沒有 CORS 標頭）。靜態回應的標頭與上一輪相同（HSTS、CSP、`X-Frame-Options: DENY`、`nosniff` 等）。重建 Worker bundle、前端重建、執行測試與修訂本快照的階段沒有再對正式站發任何請求。

本輪對正式站的請求只有上述 5 個 GET，都在 `bbf24001` 部署（04:10 UTC）之後。以下是團隊端紀錄，不是本輪的請求：部署後約 04:10 UTC 團隊的檢查（證據頁 `20261001T040934Z-2e4e830.md`：`GET /` 與主 JS 等於部署紀錄；`GET /api/auth/session` 200 `{"signedIn":false}`；沒有 session 的 `GET /api/me/home` 401；從 `Origin: https://evil.example` 送出的 `POST /api/auth/challenge` 403），04:16 與 04:19 UTC 的真實錢包登入（第 2 節），以及 2026-09-30 中間五次前端部署與 06:48–09:27 UTC 的回滾（第 1 節）。

## 6. 不公開的團隊端檔案

部署紀錄中的 `wrangler-logs/`、`wrangler.log` 與 `worker/index.js.map` 含部署者的登入資訊與本機路徑，**不在本快照內**，本輪也沒有讀取它們的內容；本快照只收錄 `SHA256SUMS`（只有雜湊與相對路徑，`manifests/deploy-record-SHA256SUMS.txt`）與上述 manifest 欄位。

私人 repo 內由 `scripts/deploy-evidence.mjs` 產生的部署證據頁，**這次收錄 10 頁**（`source/docs/security/deploy-evidence/`：上一輪的 1a0ba21、2da46cd、5398b90、4321bb4、df8ea90，加上本輪新收錄的 007ee80、a77f91b、41ae386、0d57791、2e4e830）：`tests/review-record.test.mjs:255-257` 會確認 `AUDIT_REMEDIATION_STATUS.md` 引用的每個 `docs/security/*.md` 頁面都存在；這些頁面只含腳本從部署紀錄取出的結構化欄位（版本、雜湊、migration、limiter 綁定、WAF 規則 id）與團隊手填的欄位，不含 log 文字（`tests/deploy-evidence.test.mjs` 檢查產生器的輸出）。它們與 git blob 逐位元組相同、沒有遮蔽；內容仍是團隊端證據。
