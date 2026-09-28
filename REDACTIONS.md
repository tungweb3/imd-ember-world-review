# REDACTIONS：所有移除與替換

## 1. 原始碼的修改（五個檔案，只改註解、文件文字與設定值）

`source/` 的 51 個檔案取自 `git -c core.autocrlf=false archive 0def8cb5b80083d32545c59bc707fbbc92a4758d`，也就是 git blob 的原始位元組（LF）。**只有下列 5 個檔案被修改**，其他 46 個檔案與 git blob 逐位元組相同（可用 `manifests/published-source-gitblobs.txt` 的 blob id 以 `git hash-object --no-filters` 核對）。5 個被修改的檔案行數都沒有改變，所以文件引用的行號仍然對得上。

| 檔案 | 原始 blob（commit 0def8cb） | 原始 SHA-256 | 本快照 SHA-256 | 是否進入正式 bundle |
|---|---|---|---|---|
| `source/wrangler.jsonc` | `ed0973452a2d1a5f073e222a13bef35679f4eb5b` | `6dd513e6ce4c7f94e72053fb02ae119567d8f5dafe3d23731b1158a97b1d2f46`（與部署紀錄記錄的 `wrangler.jsonc` 雜湊相同） | `18babf199c89414089f4e8fcf3d1e28da1ad5be047b1e33c98850a35aab793dc` | 否（部署設定） |
| `source/docs/wallet-login/DESIGN_W1_v001.md` | `3566edd86cdb26a7ce84ba5b17d433e3b3fb5d0e` | `f9d0ea2a06a694a98aff0f82d64d4ea4f02c1ffd4d27bddb8c9d5f0e6e7e2c51` | `70db1c95a52ed95823474df3a727c90d4f6f78faa1c41cc24372030c0441e08c` | 否（文件） |
| `source/src/world/collections.ts` | `db20e1e573dbc4c6c4e44228fbd3c69e5054e765` | `e16162ff5fac9960678fba72a333075071fc280c1b64a9a28d3cc7df89772949` | `bc21ef28e8c885338158090037042d746dde4a4f9a4daf871bad8a7e40599c5b` | 是（Worker 與前端），但只改註解 |
| `source/src/world/moves.ts` | `5122c1a2faa496b12512ee738d43356dd3409861` | `410564fec809a70bcade7b2a41ef26b740e44f46a38cfe051996d34bfeee4a21` | `f707a4a4d482d07639e41558a4ae593b68afc703db2c69bc144883c9f424c0c2` | 是（前端），但只改註解 |
| `source/migrations/0001_wallet_login.sql` | `b64e58cf82c7d06a639d73728509303ee41bce32` | `696eeccbebd66ce944d86ec248540a0afa10a0283e255c0bf9df85c2cfc22a71` | `d968991d8f51babf059591b9876891076bec232a3ea782453fa91d1d3ef9d3a6` | 否（D1 migration），只改 SQL 註解 |

**註解不進 bundle，已實測**：遮蔽後（2026-09-28T16:51:21Z）從本快照 `source/` 以 `wrangler deploy --dry-run --outdir` 重建的 Worker `index.js` 仍是 257,723 bytes、SHA-256 `4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3`（與部署紀錄相同）；團隊端把遮蔽版 `collections.ts`、`moves.ts` 放進 commit 0def8cb 的完整原始碼重建前端，`index-BPJxeGls.js`、`index-BOzKL2IR.css`、`index.html` 的雜湊也與正式站相同（`DEPLOYMENT_MATCH.md` 第 3 節）。

遮蔽標記：`[REDACTED]` 表示依持有人決定移除的未來產品規劃或未提交草案的描述；`[REDACTED-INTERNAL]` 表示與本審查無關的內部說明；`[REDACTED-EMAIL]` 不再出現（原本所在的整句已改為 `[REDACTED-INTERNAL]`）；設定值用 `REDACTED-CLOUDFLARE-ACCOUNT-ID`、`REDACTED-D1-DATABASE-ID`。

### 1.1 `source/wrangler.jsonc`

完整差異（左：commit 0def8cb；右：本快照；左側原值不在本 repo 中，以說明代替）：

```diff
3,5c3,5
< // <第 3–5 行：account_id 用途說明，含部署者的登入 email 與與本審查無關的內部說明，已遮蔽>
< // <同上>
< // <同上，句末為 "The imdember.com zone lives in this account.">
---
> // account_id pins the deploy to the Cloudflare account that holds the imdember.com zone.
> // [REDACTED-INTERNAL]
> // [REDACTED-INTERNAL]
12c12
<   "account_id": "<32 位 hex，已遮蔽>",
---
>   "account_id": "REDACTED-CLOUDFLARE-ACCOUNT-ID",
55c55
<     { "binding": "DB", "database_name": "imd-world", "database_id": "<UUID，已遮蔽>", "migrations_dir": "migrations" }
---
>     { "binding": "DB", "database_name": "imd-world", "database_id": "REDACTED-D1-DATABASE-ID", "migrations_dir": "migrations" }
```

| 位置 | 原內容 | 替換為 | 原因 |
|---|---|---|---|
| 第 3–5 行註解 | account_id 的用途說明，含部署者的 Cloudflare 登入 email 與內部說明 | 一句中性說明＋`[REDACTED-INTERNAL]` | 個人資料與內部資訊，審查不需要 |
| 第 12 行 `account_id` | Cloudflare 帳號 ID | `REDACTED-CLOUDFLARE-ACCOUNT-ID` | 不是機密，但公開審查不需要 |
| 第 55 行 `database_id` | D1 資料庫 ID | `REDACTED-D1-DATABASE-ID` | 同上 |

遮蔽只影響 wrangler 要部署到哪個帳號與資料庫，不影響任何程式行為：測試不讀這些值；`wrangler deploy --dry-run` 用遮蔽版產生的 Worker bundle 與實際上傳的相同（`DEPLOYMENT_MATCH.md` 第 3 節）。公開後 `source/wrangler.jsonc` 無法直接用來部署（placeholder 不是有效的 ID）。

### 1.2 `source/docs/wallet-login/DESIGN_W1_v001.md`（設計文件，不是程式）

| 行 | 原內容（摘要） | 替換為 | 原因 |
|---|---|---|---|
| 4–5 | W1 不包含的未來項目清單 | `[REDACTED]`（第 5 行其餘文字不變，只是換行位置） | 持有人決定：不描述未來產品規劃 |
| 8 | 「owner decisions 2026-09-28」後的內部來源標註 | 刪除該括號 | 內部資訊 |
| 9–10 | 一份未進 git 的內部文件的名稱、路徑與其角色 | `[REDACTED]`，後接「Two facts: …」 | 持有人決定：不描述未提交的草案。兩個事實（32 個持有人是 EIP-7702 委派 EOA；2026-09-27 名冊與鏈上 `ownerOf` 對 430 個 agent 一致）保留，因為它們解釋了 ECDSA 優先、ERC-1271 其次的設計 |
| 20 | 誰會在日後處理伺服器與用戶端計數差異 | `[REDACTED]` | 未來規劃 |
| 106 | 「Order」後引用上述草案的章節號 | 刪除，只留「Order:」 | 草案引用 |
| 152 | `seat_presence` 將來的用途 | `[REDACTED]` | 未來規劃 |
| 178 | 將來加入角色 collection 的方式 | `[REDACTED]` | 未來規劃 |
| 204 | 與本審查無關的內部說明 | `[REDACTED-INTERNAL]` | 內部資訊 |
| 349 | 誰會在日後補上名冊未擺放的缺口 | `[REDACTED]` | 未來規劃 |
| 396–397 | 持有人截圖所在的本機工作資料夾 | `[REDACTED-INTERNAL]` | 內部資訊 |
| 399 | 「Still open」括號內的未來階段名稱 | `[REDACTED]` | 未來規劃 |
| 409 | 搬家只存本機的原因（未來規劃） | `[REDACTED]` | 未來規劃 |

仍然保留、持有人已知的相關文字：第 254、388–389 行描述正式 UI 的「即將推出 / Coming soon」（這段 UI 在正式 bundle 裡，任何人都看得到）；第 340 行「replaces the planned `walletSession.ts`」是已完成的設計變更的歷史說明。

### 1.3 `source/src/world/collections.ts`、`source/src/world/moves.ts`、`source/migrations/0001_wallet_login.sql`（只改註解）

| 檔案:行 | 原內容（摘要） | 替換為 |
|---|---|---|
| `collections.ts:2-3` | 清單何時會有內容（未來規劃） | `[REDACTED]`，其後說明清單為空時面板顯示「即將推出」、加入一個 collection 是這裡的一筆設定 |
| `moves.ts:1` | 搬家何時不再只存本機（未來規劃） | `local only; [REDACTED]` |
| `0001_wallet_login.sql:15-16` | `seat_presence` 將來由誰讀取（未來規劃） | `Never deleted ([REDACTED]).` |

這三處都是註解：`collections.ts` 的程式碼（`CHARACTER_COLLECTIONS=[]`）、`moves.ts` 的程式碼與 migration 的 SQL 敘述都沒有改。migration 只在 D1 以檔名記錄是否套用過，註解不影響 schema。

### 1.4 刻意保留、沒有遮蔽的相關文字

- `source/src/world/HomePanels.tsx:29` 的 UI 文字（共用的住處登記後端還沒上線）與 `source/src/world/i18n.tsx:39` 的 UI 文字（未來的探索故事）：它們在公開的正式前端 bundle 裡，改動會讓公開原始碼與正式 bundle 不一致，所以保留。
- `source/server/auth.ts:36` 註解提到 Cloudflare WAF rate limiting rule 是主要洪水防線：這是與登入安全直接相關的說明，所以保留原文。註解寫的「planned」是 0def8cb 當時的狀態；這條規則現在已設定並啟用（2026-09-29 約 01:20（+08）起涵蓋整個 `/api/`，見 `ROUTES.md` 第 4 節）。

## 2. 未收錄的檔案（不是遮蔽，是不公開）

- **commit 0def8cb 中的 395 個檔案**：依持有人決定不公開（3D 世界、地形、模型、美術、音樂、新手引導、地圖、房屋分配與擺放 `households.ts`／`layout.ts`／`collision.ts` 與 `tests/households.test.mjs`、主畫面接線 `WorldApp.tsx`、其他測試與腳本、文件與圖檔、舊小遊戲殘留、repo 的 README／DESIGN／PLAN 等）。清單與 SHA-256：`manifests/withheld-source.txt`；git blob id：`manifests/withheld-source-gitblobs.txt`。
- **部署紀錄中的敏感檔案**：`wrangler-logs/`、`wrangler.log`、`worker/index.js.map`（含部署者的登入資訊與本機路徑）以及實際上傳的 `worker/index.js` 都不收錄；只收錄 `SHA256SUMS`（雜湊與相對路徑，`manifests/deploy-record-SHA256SUMS.txt`）與 `DEPLOYMENT_MATCH.md` 摘錄的 manifest 欄位。`worker/index.js` 可由 reviewer 從 `source/` 自行重建。
- **git tag 的 tagger 欄位**：不收錄。
- **wrangler 部署查詢輸出**：本輪沒有執行；只引用部署紀錄 manifest 中的版本、時間與工具版本。

## 3. 產生的證據檔中的遮蔽

- `TESTS/siwe-sample/siwe-sample-output.txt`：`__Host-imd_flow`、`__Host-imd_session` 的值替換為 `<REDACTED>`；不寫入任何簽章。地址是當次臨時產生的合成金鑰地址，金鑰只存在記憶體、已丟棄、不控制任何資產。網段 `net:203.0.113.0/24`、`net:198.51.100.0/24` 是文件用的保留位址範圍（RFC 5737）。
- `TESTS/probes/keyed-reads-probe-output.txt`：session 鍵（token 雜湊前綴）顯示為 `session:<token-hash prefix>`；其餘 IP 都是 RFC 5737 文件用位址。
- `SIWE.md` 的範例訊息取自同一份 SIWE 輸出。
- `TESTS/npm-test-output.txt`、`TESTS/npm-test-output.no-stub.txt`、`TESTS/worker-dry-run-output.txt`：建置機器上的暫存目錄路徑換成 `<SCRATCH>`，其餘未改。

## 4. 從未讀取或收錄的東西

整個準備過程**沒有讀取**任何 `.dev.vars`、`.env*`、憑證、keyring 或 wrangler 登入檔，沒有讀取部署紀錄的 wrangler 記錄檔與 source map，也沒有讀取 Cloudflare secret 的值（Worker secret 只知道名稱 `ALCHEMY_API_KEY`；持有人提供的 dashboard 截圖也只顯示名稱，值已加密）。截圖本身與 Cloudflare account id 都不收錄。本快照不含私鑰、助記詞、`.env` 真值、API／RPC key、session cookie、Bearer token、有效正式簽章、使用者私人資料或瀏覽器 profile。

檢查方式（對整個快照）：搜尋 email 樣式、`Users`／`AppData` 等本機路徑、64 位 hex（私鑰樣式）、`sk_`、API key 樣式；除了 `package-lock.json` 的套件完整性雜湊（`sha512-…`）、公開的合約／錢包地址、交易選擇器與文件引用的 SHA-256 之外沒有命中。email 樣式只有兩個：`noreply@anthropic.com`（commit 訊息的 `Co-Authored-By` 行，以及 `PUBLIC_CONTENT_LIST.md` 提到它的地方）與 `source/tests/deploy.test.mjs:99` 的 `t@example.invalid`（測試用的保留網域假地址，RFC 2606）。測試 harness 中的 `test-alchemy-key` 是假字串，不是金鑰。

## 5. 保留、未遮蔽的識別資訊（刻意公開）

見 `PUBLIC_CONTENT_LIST.md` 第 3 節：網域、公開合約地址、IMD 公開名冊中的席位持有者地址（只在一個測試 fixture 內）、GitHub 帳號名稱 `tungweb3`（版權聲明）等。
