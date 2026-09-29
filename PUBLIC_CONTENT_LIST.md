# PUBLIC_CONTENT_LIST：本 repo 公開的內容清單

本 repo 的所有檔案都應視為任何人可讀、可下載、可被 Swarm 與 GitHub 保存。這份清單列出公開了什麼、沒有公開什麼，以及其中值得注意的識別資訊。本 repo 的第一個 commit（`c2a8c33`，送審版本）仍在歷史中，內容見該 commit 自己的這份清單。

## 1. 公開的資料夾與檔案數（本 commit）

總共 98 個檔案（不含 `.git/`）。

| 位置 | 檔案數 | 內容 |
|---|---|---|
| 根目錄 | 15 | `README.md`、`LICENSE`、`SCOPE.md`、`ROUTES.md`、`WALLET_METHODS.md`、`SIWE.md`、`OWNERSHIP_AND_HOMES.md`、`DEPENDENCIES.md`、`DATA_SCHEMA.md`、`DEPLOYMENT_MATCH.md`、`REDACTIONS.md`、`PUBLIC_CONTENT_LIST.md`（本檔）、`SHA256SUMS`、`.gitignore`、`.gitattributes` |
| `manifests/` | 8 | 重建與線上雜湊（`build-sha256.txt`、`build-sha256.lf-run.txt`、`live-sha256.txt`、`compare.txt`）、部署紀錄的 `SHA256SUMS` 副本、公開與保留檔案的 git blob 清單、保留檔案的 SHA-256 清單 |
| `TESTS/` | 14 | 測試說明、`npm test` 原始輸出（加替身與不加替身）、「進入我的家」授權測試的輸出、`tsc` 輸出、Worker 重建輸出、兩份 `npm audit` JSON、SIWE 樣本產生腳本與輸出、`stubs/households.ts` 與 `stubs/layout.ts`（測試用替身，不含幾何）、`probes/` 的探測腳本與輸出 |
| `source/` | 61 | commit 2da46cd 中與錢包登入、屋主權限相關的原始碼與完整伺服器端（見下；8 個檔案有遮蔽，其餘 53 個與 git blob 相同，見 `REDACTIONS.md` 第 1 節） |

`source/` 的 61 個檔案：

| 子資料夾 | 檔案 |
|---|---|
| 根 | `.gitignore`、`.nvmrc`、`index.html`、`package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、`wrangler.jsonc`（遮蔽） |
| `worker/` | `app.ts`、`index.ts` |
| `server/` | `auth.ts`、`chain-mock.ts`、`d1.ts`、`gateway.ts`、`ownership.ts`、`presence.ts`、`vite-plugin.ts`、`world-api.ts` |
| `src/` | `main.tsx` |
| `src/world/` | 錢包／登入與屋主權限：`auth.ts`、`siwe.ts`、`wallet.ts`、`WalletPanel.tsx`、`walletView.ts`、`reviewRecord.ts`、`auditRecord.ts`、`moves.ts`（註解遮蔽）、`homeEntry.ts`、`HomePanels.tsx`、`i18n.tsx`；Worker 執行期依賴：`cadence.ts`、`collections.ts`（註解遮蔽）、`houseSize.ts`、`links.ts`、`market.ts`、`model.ts`、`status.ts`（`siwe.ts` 兩邊都用） |
| `migrations/` | `0001_wallet_login.sql`（註解遮蔽）、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql` |
| `public/` | `_headers` |
| `scripts/` | `deploy.mjs`、`deploy-evidence.mjs` |
| `docs/wallet-login/` | `DESIGN_W1_v001.md`（遮蔽） |
| `docs/security/` | `AUDIT_REMEDIATION_STATUS.md`（公開版，遮蔽） |
| `tests/` | `auth.test.mjs`、`wallet-client.test.mjs`、`ownership.test.mjs`、`presence.test.mjs`、`worker.test.mjs`、`headers.test.mjs`、`deploy.test.mjs`、`deploy-evidence.test.mjs`（一個字串遮蔽）、`home-entry.test.mjs`、`review-record.test.mjs`（一個 regex 遮蔽）、`wallet-harness.mjs`、`d1-sqlite.mjs` |
| `tests/fixtures/` | `cold-home.mjs`、`cold-verify.mjs`、`swarm-2026-09-27.json`、`activity-0759z.json` |

## 2. 不公開的

- commit 2da46cd 中其餘 451 個檔案（3D 世界、地形、模型、美術、音樂、新手引導、Pepe 裝飾與雕像、房屋分配與擺放、房屋內部與家具、主畫面 `WorldApp.tsx`、其他測試與腳本、文件與圖檔、舊小遊戲殘留）：只公開**檔名與雜湊**（`manifests/withheld-source.txt`、`withheld-source-gitblobs.txt`）。注意：檔名本身會公開。
- 私人 GitHub repo、部署紀錄的 wrangler logs、source map 與上傳的 bundle 本身（bundle 可由 `source/` 重建）、部署證據頁、持有人的審查規格與團隊內部的修正計畫、任何 `.env`／`.dev.vars`／金鑰、正式資料庫的任何資料。

## 3. 值得注意的識別資訊

| 項目 | 出現在 | 是否本來就公開 |
|---|---|---|
| 778 個錢包地址 | **只在** `source/tests/fixtures/swarm-2026-09-27.json`（IMD 公開名冊 API 的回應快照，檔內時間 2026-09-26T17:17Z） | 是：公開 IMD 名冊 API 的資料。本 repo 沒有任何文件說明其中哪個地址屬於誰 |
| 合約與基礎設施地址：IMD 席位 NFT `0x0000ec93…ec1d`、IMD 代幣 `0xd34a99bc…63b7`、Multicall3 `0xcA11bde0…CA11` | 原始碼與文件 | 是（公開合約） |
| 測試用假地址 `0x…0004`、重複位元組地址（例如 `'0x'+'a1'.repeat(20)`） | 測試 | 是（虛構） |
| 合成金鑰地址 `0xf8Bf9604…E5e6` | `SIWE.md`、`TESTS/siwe-sample/` | 是（臨時產生、已丟棄、不控制任何資產） |
| 保留 IP 與網段（`203.0.113.x`、`198.51.100.x`、`192.0.2.x`、`2001:db8:…`、`100.64.0.1`） | 測試、`TESTS/probes/`、`TESTS/siwe-sample/` | 是（文件用位址與共用位址，不指向任何人） |
| 網域 `imdember.com`、`imd.stickember.com`（轉址） | 多處 | 是 |
| GitHub 帳號名稱 `tungweb3` | `LICENSE`、`README.md` 版權聲明 | 版權人名稱；本 repo 沒有把它和任何錢包地址或席位連在一起 |
| git commit 的作者資訊 | 本 repo 的 commit metadata：作者 `tungweb3` 與其 GitHub noreply 地址（`…@users.noreply.github.com`）；commit 訊息結尾的 `Co-Authored-By` 行含 `noreply@anthropic.com` | noreply 地址不是個人信箱 |
| Swarm job id `4bd31cfb-1151-497f-9b27-40e668dea372` 與它的公開報告連結 | 文件、`source/src/world/reviewRecord.ts` | 是（公開的審查紀錄） |
| Cloudflare rate limiter namespace id（4101–4104）、Worker 名稱 `imd-world`、D1 名稱 `imd-world`、Worker version id | `source/wrangler.jsonc`、文件 | 不是機密；account_id／database_id 已遮蔽 |
| `imdember.com` zone 的 WAF rate limiting rule 名稱（`IMD API anti-flood`）、expression 與門檻；持有人 dashboard 截圖顯示的 Worker 清單、綁定名稱與 secret 名稱 | 文件 | 持有人同意公開；截圖本身、account id 與 secret 值都不收錄 |
| commit hash、正式檔案雜湊、部署時間 | 文件與 manifests | 是（審查必需） |
| 私人 repo 的分支名稱（`main`、`review-fixes`）與 tag 名稱 | 文件、`manifests/compare.txt`、`source/docs/security/AUDIT_REMEDIATION_STATUS.md` | 內部資訊，不含敏感內容 |
| 被保留檔案的檔名 | `manifests/withheld-*.txt` | 會公開檔名（不含內容） |

## 4. 已確認不包含

私鑰、助記詞、`.env` 真值、`.dev.vars`、API／RPC key（包括 Alchemy 金鑰）、session cookie 值、Bearer token、有效的正式簽章、正式資料庫的資料列、個人 email（檔案內容中的 email 樣式字串只有上表提到的 `noreply@anthropic.com`，以及測試用的保留網域假地址：`t@example.invalid`（`source/tests/deploy.test.mjs:99`）與 `…@example.com`（`source/tests/deploy-evidence.test.mjs:13`，RFC 2606）；commit metadata 另有 GitHub noreply 地址）、本機路徑（測試中的 `C:\Users\someone\…`、`/home/someone/…` 是虛構的假路徑）、Cloudflare account id 或 database id 的任何片段、使用者私人資料、瀏覽器 profile、HAR，以及未提交的內部草案與未來產品規劃的描述（唯一例外是持有人要求寫明的 Genesis Mint 邊界說明與一句原則：日後 Mint 頁面是同 origin 子頁面、使用本站登入狀態、上線前另行審查，World session 不等於使用者授權 Mint，見 `SCOPE.md` 第 3 節）。已遮蔽的位置見 `REDACTIONS.md` 第 1 節；檢查方式見 `REDACTIONS.md` 第 4 節。
