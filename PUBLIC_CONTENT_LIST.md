# PUBLIC_CONTENT_LIST：本 repo 公開的內容清單

本 repo 的所有檔案都應視為任何人可讀、可下載、可被 Swarm 與 GitHub 保存。這份清單列出公開了什麼、沒有公開什麼，以及其中值得注意的識別資訊。本 repo 的前兩個 commit（`c2a8c33`，第一次送審版本；`b6e986b`，上一次的審查對象）仍在歷史中，內容見各自 commit 的這份清單。

## 1. 公開的資料夾與檔案數（本 commit）

總共 109 個檔案（不含 `.git/`；上一個 commit 為 98 個）。

| 位置 | 檔案數 | 內容 |
|---|---|---|
| 根目錄 | 15 | `README.md`、`LICENSE`、`SCOPE.md`、`ROUTES.md`、`WALLET_METHODS.md`、`SIWE.md`、`OWNERSHIP_AND_HOMES.md`、`DEPENDENCIES.md`、`DATA_SCHEMA.md`、`DEPLOYMENT_MATCH.md`、`REDACTIONS.md`、`PUBLIC_CONTENT_LIST.md`（本檔）、`SHA256SUMS`、`.gitignore`、`.gitattributes` |
| `manifests/` | 8 | 重建與線上雜湊（`build-sha256.txt`、`build-sha256.lf-run.txt`、`live-sha256.txt`、`compare.txt`）、部署紀錄的 `SHA256SUMS` 副本（`deploy-record-SHA256SUMS.txt`）、公開與保留檔案的 git blob 清單、保留檔案的 SHA-256 清單 |
| `TESTS/` | 14 | 測試說明、`npm test` 原始輸出（加替身與不加替身）、「進入我的家」授權測試的輸出、`tsc` 輸出、Worker 重建輸出、兩份 `npm audit` JSON、SIWE 樣本產生腳本與輸出、`stubs/households.ts` 與 `stubs/layout.ts`（測試用替身，不含幾何）、`probes/` 的探測腳本與輸出 |
| `source/` | 72 | commit 132228c 中與錢包登入、屋主權限相關的原始碼、完整伺服器端、相關文件與部署證據（見下；8 個檔案有遮蔽，其餘 64 個與 git blob 相同，見 `REDACTIONS.md` 第 1 節）。其中每個會進入 Worker 或前端 build 的檔案都與部署的 commit 4321bb4 相同 |

`source/` 的 72 個檔案（標「新」的 11 個是本 commit 新增；收錄理由見 `SCOPE.md` 第 6.1 節）：

| 子資料夾 | 檔案 |
|---|---|
| 根 | `.gitignore`、`.nvmrc`、`index.html`、`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`wrangler.jsonc`（遮蔽） |
| `worker/` | `app.ts`、`index.ts` |
| `server/` | `auth.ts`、`chain-mock.ts`、`d1.ts`、`gateway.ts`、`ownership.ts`、`presence.ts`、`vite-plugin.ts`、`world-api.ts` |
| `src/` | `main.tsx` |
| `src/world/` | 錢包／登入與屋主權限：`auth.ts`、`siwe.ts`、`wallet.ts`、`WalletPanel.tsx`、`walletView.ts`、`reviewRecord.ts`、`auditRecord.ts`、`moves.ts`（註解遮蔽）、`homeEntry.ts`、`HomePanels.tsx`、`i18n.tsx`；Worker 執行期依賴：`cadence.ts`、`collections.ts`（註解遮蔽）、`houseSize.ts`、`links.ts`、`market.ts`、`model.ts`、`status.ts`（`siwe.ts` 兩邊都用）；公開靜態檔的雜湊檔名：`publicHashes.ts`（新）、`publicUrl.ts`（新） |
| `migrations/` | `0001_wallet_login.sql`（註解遮蔽）、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql`、`0004_index_candidates.sql`（新） |
| `public/` | `_headers` |
| `scripts/` | `deploy.mjs`、`deploy-evidence.mjs` |
| `docs/wallet-login/` | `DESIGN_W1_v001.md`（遮蔽） |
| `docs/security/` | `AUDIT_REMEDIATION_STATUS.md`（公開版，遮蔽）、`MINT_BOUNDARY.md`（新：日後 Mint 頁面的邊界問題與 S-2 清單，不含任何 Mint 程式） |
| `docs/security/deploy-evidence/` | 5 頁部署證據（皆新）：`20260928T210413Z-1a0ba21.md`、`20260929T050441Z-2da46cd.md`、`20260929T172429Z-5398b90.md`、`20260929T195417Z-4321bb4.md`、`20260930T064805Z-df8ea90.md`。只含從團隊部署紀錄複製的結構化欄位：來源 commit、紀錄 id、部署時間、Worker version id、Worker bundle 與前端檔案的 SHA-256、migration 檔名與雜湊及正式 D1 已套用的清單（人工填寫）、limiter 綁定、WAF 規則的描述與 rule id；`1a0ba21` 那頁另有部署後的實測紀錄。沒有 log 文字 |
| `tests/` | `auth.test.mjs`、`wallet-client.test.mjs`、`ownership.test.mjs`、`presence.test.mjs`、`worker.test.mjs`、`headers.test.mjs`、`deploy.test.mjs`、`deploy-evidence.test.mjs`（同一行的兩個測試字串遮蔽）、`home-entry.test.mjs`、`review-record.test.mjs`（兩行禁止字 regex 與它們的斷言訊息遮蔽）、`dependencies.test.mjs`（新）、`wallet-harness.mjs`、`d1-sqlite.mjs` |
| `tests/fixtures/` | `cold-home.mjs`、`cold-verify.mjs`、`swarm-2026-09-27.json`、`activity-0759z.json`、`wallet-panel.mjs`（新） |

## 2. 不公開的

- commit 132228c 中其餘 484 個檔案（3D 世界、地形與地形預烘、模型與下載佇列、美術、音樂、新手引導、Pepe 裝飾與雕像、非官方聲明與天氣說明的 UI、房屋分配與擺放、房屋內部與家具、主畫面 `WorldApp.tsx`、世界資料的讀取、其他測試與腳本、文件與圖檔、舊小遊戲殘留）：只公開**檔名與雜湊**（`manifests/withheld-source.txt`、`withheld-source-gitblobs.txt`）。注意：檔名本身會公開。
- 2026-09-30 06:48–09:27 UTC 曾上線的 commit `df8ea90` 的原始碼（只有它的部署證據頁公開）。
- 私人 GitHub repo、部署紀錄本身（manifest 以外的 wrangler logs 等）、source map 與上傳的 bundle 本身（bundle 可由 `source/` 重建）、完整原始碼測試的原始 log（只公開它的 SHA-256，見 `README.md`「如何測試」）、持有人的審查規格與團隊內部的修正計畫（包括程式註解中以章節或工具名稱引用的修正計畫與交叉檢查）、任何 `.env`／`.dev.vars`／金鑰、正式資料庫的任何資料。

## 3. 值得注意的識別資訊

| 項目 | 出現在 | 是否本來就公開 |
|---|---|---|
| 778 個錢包地址 | **只在** `source/tests/fixtures/swarm-2026-09-27.json`（IMD 公開名冊 API 的回應快照，檔內時間 2026-09-26T17:17Z；本版未改） | 是：公開 IMD 名冊 API 的資料。本 repo 沒有任何文件說明其中哪個地址屬於誰 |
| 合約與基礎設施地址：IMD 席位 NFT `0x0000ec93…ec1d`、IMD 代幣 `0xd34a99bc…63b7`、Multicall3 `0xcA11bde0…CA11` | 原始碼與文件 | 是（公開合約） |
| 測試用假地址 `0x…0004`、重複位元組地址（例如 `'0x'+'a1'.repeat(20)`） | 測試 | 是（虛構） |
| 合成金鑰地址 `0x070A585c…a4B2` | `TESTS/siwe-sample/`、`SIWE.md` | 是（本輪重新產生、只存在記憶體、已丟棄、不控制任何資產；上一輪的合成地址只在舊 commit 中） |
| 保留 IP 與網段（`203.0.113.x`、`198.51.100.x`、`192.0.2.x`、`2001:db8:…`、`100.64.0.1`） | 測試、`TESTS/probes/`、`TESTS/siwe-sample/` | 是（文件用位址與共用位址，不指向任何人） |
| 網域 `imdember.com`、`imd.stickember.com`（轉址），以及審查平台的公開連結（`explorer.imd.fun` 的 job 頁、`github.com/Identity-md/research` 的報告） | 多處 | 是 |
| GitHub 帳號名稱 `tungweb3` | `LICENSE`、`README.md` 版權聲明 | 版權人名稱；本 repo 沒有把它和任何錢包地址或席位連在一起 |
| git commit 的作者資訊 | 本 repo 的 commit metadata：作者 `tungweb3` 與其 GitHub noreply 地址；commit 訊息結尾的 trailer 行（例如 `Co-Authored-By`）也只含服務商的 noreply 地址 | noreply 地址不是個人信箱 |
| Swarm job id `4bd31cfb-1151-497f-9b27-40e668dea372`、`e48d0a96-d3a5-42bb-859f-e0b0707fd9ad`、`519db624-a82f-4dfe-91b9-1a519d1d3dd1` 與它們的公開頁面 | 文件、`source/src/world/reviewRecord.ts`、`source/docs/security/AUDIT_REMEDIATION_STATUS.md`、`MINT_BOUNDARY.md` | 是（公開的審查紀錄） |
| Cloudflare rate limiter namespace id（4101–4104）、Worker 名稱 `imd-world`、D1 名稱 `imd-world`、Worker version id（`beac62be`、`f9b68223`、`50c688c9`、`c89f5915`、`1a0dd495`、`6e7e40cd` 等） | `source/wrangler.jsonc`、文件、5 頁部署證據 | 不是機密；account_id／database_id 已遮蔽 |
| `imdember.com` zone 的 WAF rate limiting rule：名稱（`IMD API anti-flood`）、expression、門檻，以及 rule id `866d2fae97c942389a9fa9f15c411f46`；持有人 dashboard 截圖顯示的 Worker 清單、綁定名稱與 secret 名稱 | 文件；rule id 在 5 頁部署證據中的 3 頁（`1a0ba21`、`4321bb4`、`df8ea90`；`2da46cd` 與 `5398b90` 兩頁該欄為 pending） | 持有人同意公開；rule id 是規則的識別碼，不是憑證。截圖本身、account id 與 secret 值都不收錄 |
| 部署證據頁 `20260928T210413Z-1a0ba21.md` 的部署後實測：持有人用真實錢包（寫出錢包品牌與時間）登入一次、錢包畫面顯示的內容、D1 中新 session 的類型欄位 | 該頁 | 不含錢包地址、簽章或 cookie |
| commit hash（本 repo 與私人 repo）、正式檔案與 Worker bundle 的雜湊、前端檔案樹摘要（Frontend tree digest）、migration 雜湊、部署時間 | 文件、manifests、部署證據頁 | 是（審查必需） |
| 私人 repo 的分支名稱（`main`、`review-fixes`、`backlog-0929`、`perf-0929`、`ui-0930`）與 tag 名稱（例如 `v2026.09.30-1a0dd495`） | 文件、`manifests/compare.txt`、`source/docs/security/AUDIT_REMEDIATION_STATUS.md`、`source/docs/wallet-login/DESIGN_W1_v001.md`、部署證據頁、`source/tests/deploy-evidence.test.mjs`（測試資料） | 內部資訊，不含敏感內容 |
| 團隊內部修正計畫的名稱與章節號（remediation document v1.0 §x，以及程式註解與測試中以工具名稱稱呼的修正計畫與交叉檢查） | `source/docs/security/AUDIT_REMEDIATION_STATUS.md`、程式註解、測試 | 只有名稱與章節號；文件本身不公開 |
| 被保留檔案的檔名 | `manifests/withheld-*.txt` | 會公開檔名（不含內容） |

## 4. 已確認不包含

私鑰、助記詞、`.env` 真值、`.dev.vars`、API／RPC key（包括 Alchemy 金鑰）、session cookie 值、Bearer token、有效的正式簽章、正式資料庫的資料列、個人 email（檔案內容中 email 樣式的字串只有兩個測試用的保留網域假地址：`source/tests/deploy.test.mjs:99` 的 `.invalid` 網域地址與 `source/tests/deploy-evidence.test.mjs:13` 的 `example.com` 網域地址（RFC 2606／6761）；commit metadata 只有 noreply 地址）、本機路徑（測試中的 Windows 使用者目錄與 `/home/…` 形式的路徑都是虛構的假路徑，使用者名稱是 `someone`；`TESTS/` 的原始輸出把暫存目錄換成 `<SCRATCH>`）、Cloudflare account id 或 database id 的任何片段、使用者私人資料、瀏覽器 profile、HAR，以及未提交的內部草案與未來產品規劃的描述（唯一例外是持有人要求寫明的 Genesis Mint 邊界說明：日後 Mint 頁面在同一個 origin、使用本站登入狀態、上線前另行審查，World session 不等於使用者授權 Mint，見 `SCOPE.md` 第 3 節；`MINT_BOUNDARY.md` 只列出 Mint 自己的審查必須回答的問題，不含 Mint 的合約、授權設計或時程）。已遮蔽的位置見 `REDACTIONS.md` 第 1 節；檢查方式見 `REDACTIONS.md` 第 4 節。
