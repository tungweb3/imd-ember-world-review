# REDACTIONS：所有移除與替換

## 1. 原始碼的修改（八個檔案，只改註解、文件文字、設定值與測試字串）

`source/` 的 78 個檔案取自 `git -c core.autocrlf=false archive f4272c513e2052fb0bea6d2e8512180256a60919`，也就是 git blob 的原始位元組（LF）。**只有下列 8 個檔案被修改**（與前幾輪是同樣 8 個，遮蔽的種類與遮蔽後的文字也相同，只有行號因新增內容而移動），其他 70 個檔案與 git blob 逐位元組相同（可用 `manifests/published-source-gitblobs.txt` 的 blob id 以 `git hash-object --no-filters` 核對）。8 個被修改的檔案行數都沒有改變，所以文件引用的行號仍然對得上。本輪新公開的 6 個檔案（`migrations/0005_lanes_and_subnets.sql` 與 5 個部署證據頁，第 2 節）都沒有遮蔽。

| 檔案 | 原始 blob（commit f4272c5） | 原始 SHA-256 | 本快照 SHA-256 | 是否進入正式 bundle |
|---|---|---|---|---|
| `source/wrangler.jsonc` | `97112ebc1a9a754eed8ecc461c643b483592faa6` | `860f697af01e0ac34622d79b090b9297c1b856880a54927272f1e2e76e928ad1`（LF；部署紀錄記錄的是 CRLF 版 `4c67da97…`） | `28203878b03100f8899f7eba219c10b0f7046ebc05eb55d60096f1f804835f27` | 否（部署設定） |
| `source/docs/wallet-login/DESIGN_W1_v001.md` | `4b2b25938ab6a7aff8fda4170bee6fdd579c942f` | `141ebe0eeae4a0903b37c1e721abb019f2f6b61a5b207fbcba6efac17c042378` | `c06a392a8c7be8b7a93e128cde3da9721699e5b778e342ec108808149462c8a0` | 否（文件） |
| `source/docs/security/AUDIT_REMEDIATION_STATUS.md` | 不公開（低熵遮蔽，見下） | 不公開（低熵遮蔽，見下） | `6d44dab8b086227d07843ea3b313ec04e299dd743848f38783cee9412656dee6` | 否（文件；`tests/review-record.test.mjs` 會讀它） |
| `source/src/world/collections.ts` | `db20e1e573dbc4c6c4e44228fbd3c69e5054e765` | `e16162ff5fac9960678fba72a333075071fc280c1b64a9a28d3cc7df89772949` | `bc21ef28e8c885338158090037042d746dde4a4f9a4daf871bad8a7e40599c5b` | 是（Worker 與前端），但只改註解 |
| `source/src/world/moves.ts` | `f05f5dc5297b6eced76ea3616ea23374f2db298a` | `ff5a1f600d6faa96cb95380efdcab9d0e27beb197404cde36dbc7509210d7624` | `2b3ff677085a7e73d1e7b596895567754f7fffccae5fbbc700f764673a72f0fd` | 是（前端），但只改註解 |
| `source/migrations/0001_wallet_login.sql` | `b64e58cf82c7d06a639d73728509303ee41bce32` | `696eeccbebd66ce944d86ec248540a0afa10a0283e255c0bf9df85c2cfc22a71` | `d968991d8f51babf059591b9876891076bec232a3ea782453fa91d1d3ef9d3a6` | 否（D1 migration），只改 SQL 註解 |
| `source/tests/deploy-evidence.test.mjs` | 不公開（低熵遮蔽，見下） | 不公開（低熵遮蔽，見下） | `3fb0af538bfd232fefba12d8bd08db8c2d741e73c34d15a572521459d716ae3e` | 否（測試） |
| `source/tests/review-record.test.mjs` | 不公開（低熵遮蔽，見下） | 不公開（低熵遮蔽，見下） | `4c1209eb4667ef96d92468a6912381fa7f96cfafb2f1691756c7d1391638dd92` | 否（測試） |

**為什麼三個檔案不公開原始雜湊**：`AUDIT_REMEDIATION_STATUS.md`、`deploy-evidence.test.mjs`、`review-record.test.mjs` 被遮蔽的內容很短、可以猜（例如固定長度的 hex 前綴、regex 裡的幾個詞）。只要原始檔的 SHA-256 或 git blob id 公開，任何人都能把猜測的字串放回遮蔽處重算雜湊來確認猜測，遮蔽就失去作用。所以這三個檔案只公開本快照版本的 SHA-256（`SHA256SUMS`），原始 blob id 與原始 SHA-256 都不公開（`manifests/published-source-gitblobs.txt` 中對應的一行寫 `ORIGINAL-BLOB-WITHHELD`）。它們都不進正式 bundle；內容與原始檔的差別只在第 1.4、1.5 節列出的位置，行數不變。其餘五個檔案的原始雜湊照常公開：`wrangler.jsonc` 的遮蔽包含 128 位元以上的隨機值（account id、database id），`DESIGN_W1_v001.md` 的遮蔽是多段較長的文字；`collections.ts`、`0001_wallet_login.sql` 的原始雜湊在第一個 commit（`c2a8c33`）已經公開、無法收回，它們遮蔽的只是未來規劃的描述文字。

`collections.ts` 與 `0001_wallet_login.sql` 的 blob 自 `c2a8c33` 以來沒有改變，遮蔽內容與前三輪完全相同。`moves.ts` 的 blob 與上一輪（`ae1d41a`）相同，遮蔽的仍是與 `c2a8c33` 相同的那一句（第 1 行，遮蔽後的文字也與前幾輪相同），它的原始雜湊當時已經公開。`wrangler.jsonc`（第 53–56 行的 limiter 註解多了 N-6 的說明）與 `DESIGN_W1_v001.md`（新增第 16 節等）這一版有改，所以原始 blob id 與原始 SHA-256 是新的；兩者的遮蔽都不是可猜的短字串。

**遮蔽不影響建置輸出，已實測**：遮蔽後（2026-10-01T04:25:20Z）從本快照 `source/` 以 `wrangler deploy --dry-run --outdir` 重建的 Worker `index.js` 是 280,605 bytes、SHA-256 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c`（與部署紀錄相同，`DEPLOYMENT_MATCH.md` 第 3 節）。前端：`collections.ts`、`moves.ts` 的遮蔽都只在 `//` 註解內，正式建置不會輸出這些註解；本快照缺少被保留的前端檔案，無法建置前端，所以本輪沒有另外以遮蔽版重建前端；其餘遮蔽檔案都不進前端 bundle。

遮蔽標記：`[REDACTED]` 表示依持有人決定移除的未來產品規劃或未提交草案的描述；`[REDACTED-INTERNAL]` 表示與本審查無關的內部說明或個人資訊；設定值用 `REDACTED-CLOUDFLARE-ACCOUNT-ID`、`REDACTED-D1-DATABASE-ID`；測試字串用 `REDACTED-ACCOUNT-ID-PREFIX`、`REDACTED-EMAIL-DOMAIN`。

### 1.1 `source/wrangler.jsonc`

完整差異（左：commit f4272c5；右：本快照；左側原值不在本 repo 中，以說明代替）：

```diff
3,5c3,5
< // <第 3–5 行：account_id 用途說明，含部署者的登入 email 與本審查無關的內部說明，已遮蔽>
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
63c63
<     { "binding": "DB", "database_name": "imd-world", "database_id": "<UUID，已遮蔽>", "migrations_dir": "migrations" }
---
>     { "binding": "DB", "database_name": "imd-world", "database_id": "REDACTED-D1-DATABASE-ID", "migrations_dir": "migrations" }
```

| 位置 | 原內容 | 替換為 | 原因 |
|---|---|---|---|
| 第 3–5 行註解 | account_id 的用途說明，含部署者的 Cloudflare 登入 email 與內部說明 | 一句中性說明＋`[REDACTED-INTERNAL]` | 個人資料與內部資訊，審查不需要 |
| 第 12 行 `account_id` | Cloudflare 帳號 ID | `REDACTED-CLOUDFLARE-ACCOUNT-ID` | 公開審查不需要 |
| 第 63 行 `database_id`（上一輪在第 62 行；第 53–56 行的 limiter 註解多了一行，說明 N-6 的 `chain:index:lane`） | D1 資料庫 ID | `REDACTED-D1-DATABASE-ID` | 同上 |

遮蔽只影響 wrangler 要部署到哪個帳號與資料庫，不影響任何程式行為：測試不讀這些值（`scripts/deploy-evidence.mjs` 只讀 `ratelimits` 欄位）；`wrangler deploy --dry-run` 用遮蔽版產生的 Worker bundle 與實際上傳的相同。公開後 `source/wrangler.jsonc` 無法直接用來部署（placeholder 不是有效的 ID）。

### 1.2 `source/docs/wallet-login/DESIGN_W1_v001.md`（設計文件，不是程式）

與上一輪的遮蔽位置與內容相同（共 11 處），行號因新增內容（第 16 節，Swarm Audit 8c3aea2e 的後續）而位移；`seat_presence` 那一處現在在 §6 cron 段落的第 180–181 行（被遮蔽的括號跨兩行）。

| 行 | 原內容（摘要） | 替換為 | 原因 |
|---|---|---|---|
| 4–5 | W1 不包含的未來項目清單 | `[REDACTED]`（第 5 行其餘文字不變） | 持有人決定：不描述未來產品規劃 |
| 8 | 「owner decisions 2026-09-28」後的內部來源標註 | 刪除該括號 | 內部資訊 |
| 9–10 | 一份未進 git 的內部文件的名稱、路徑與其角色 | `[REDACTED]`，後接「Two facts: …」 | 持有人決定：不描述未提交的草案。兩個事實（32 個持有人是 EIP-7702 委派 EOA；2026-09-27 名冊與鏈上 `ownerOf` 對 430 個 agent 一致）保留 |
| 20 | 誰會在日後處理伺服器與用戶端計數差異 | `[REDACTED]` | 未來規劃 |
| 130 | 「Order」後引用上述草案的章節號 | 刪除，只留「Order:」 | 草案引用 |
| 180–181 | `seat_presence` 將來的用途 | `[REDACTED]` | 未來規劃 |
| 237 | 將來加入角色 collection 的方式 | `[REDACTED]` | 未來規劃 |
| 430 | 誰會在日後補上名冊未擺放的缺口 | `[REDACTED]` | 未來規劃 |
| 477–478 | 持有人截圖所在的本機工作資料夾 | `[REDACTED-INTERNAL]` | 內部資訊 |
| 480 | 「Still open」括號內的未來階段名稱 | `[REDACTED]` | 未來規劃 |
| 490 | 搬家只存本機的原因（未來規劃） | `[REDACTED]` | 未來規劃 |

仍然保留、持有人已知的相關文字：描述正式 UI「即將推出 / Coming soon」的段落（那段 UI 在正式 bundle 裡）；第 15 節引用「remediation doc v1.0」與它的驗收項目編號（見第 1.4 節的說明）；第 15 節對 Genesis Mint 的一句提醒（World session 不等於同意 mint，第 533–536 行，並連到 `docs/security/MINT_BOUNDARY.md`）。新增的第 16 節（第 616 行起）沒有遮蔽。

### 1.3 `source/src/world/collections.ts`、`source/src/world/moves.ts`、`source/migrations/0001_wallet_login.sql`（只改註解，遮蔽與前幾輪相同）

| 檔案:行 | 原內容（摘要） | 替換為 |
|---|---|---|
| `collections.ts:2-3` | 清單何時會有內容（未來規劃） | `[REDACTED]`，其後說明清單為空時面板顯示「即將推出」、加入一個 collection 是這裡的一筆設定 |
| `moves.ts:1` | 搬家何時不再只存本機（未來規劃） | `local only; [REDACTED]` |
| `0001_wallet_login.sql:15-16` | `seat_presence` 將來由誰讀取（未來規劃） | `Never deleted ([REDACTED]).` |

這三個公開檔案與上一輪公開的版本逐位元組相同。

### 1.4 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`（修正狀態文件的公開版）

這份是團隊的修正狀態文件，本快照收錄它的公開版（`tests/review-record.test.mjs` 會讀它並與頁面資料比對；遮蔽後該測試仍通過）。只改兩處，遮蔽後的文字與上一輪相同：

| 行 | 原內容（摘要） | 替換為 | 原因 |
|---|---|---|---|
| 324（上一輪在第 309 行） | 一句說明某個上線後步驟由誰執行的內部備註 | `[REDACTED-INTERNAL]` | 內部分工，不是審查需要的事實 |
| 928–929（上一輪在第 604–605 行） | 「Genesis Mint」後括號內列出的日後 Mint 合約檔名與授權設計細節 | `[REDACTED]`（兩行） | 持有人決定：不描述未來產品規劃；該節引用的原則句（World session 不等於使用者授權 Mint）保留 |

文件中的狀態、殘餘風險、測試名稱與指令、分層限制表、部署版本與後續部署的列表，以及新增的「Swarm audit 8c3aea2e」一節（第 637 行起，N-1..N-7）都**沒有改**。它寫的是團隊自己的說明，尚未經重新審查；reviewer 應自行核對。

文件與程式註解會提到「remediation document v1.0」「remediation 2026-09-29 §x」：那是團隊內部的修正計畫，**不隨本 repo 公開**；這些引用只是章節編號，它的公開摘要就是這份文件。同樣地，狀態文件、程式註解與測試中提到的「Codex remediation plan」「Codex plan」「Codex crosscheck review」與本輪的「Codex handoff」（例如 `AUDIT_REMEDIATION_STATUS.md:428`、`AUDIT_REMEDIATION_STATUS.md:594`、`AUDIT_REMEDIATION_STATUS.md:906`、`server/ownership.ts:136`、`tests/ownership.test.mjs:209`、`tests/wallet-client.test.mjs:677`）也是團隊內部的修正計畫、交叉檢查紀錄與工程交接文件，不公開，只引用其章節或項目編號。這些名稱沒有遮蔽：`tests/review-record.test.mjs:251-252` 會讀狀態文件中「The Codex plans' test names」一節，確認其中列出的測試確實存在。

### 1.5 兩個測試檔的字串（不改變測試邏輯）

| 檔案:行 | 原內容 | 替換為 | 原因與影響 |
|---|---|---|---|
| `tests/deploy-evidence.test.mjs:63`（一；上一輪在第 57 行） | 「不可出現在輸出中」清單裡的一個 10 位 hex 字串：真實 Cloudflare account id 的前綴 | `'REDACTED-ACCOUNT-ID-PREFIX'` | 不公開帳號 id 的任何部分。測試仍檢查 `account_id` 這個欄位名與整份 `wrangler.jsonc` 註解不會進入輸出；在本快照（`wrangler.jsonc` 已遮蔽）這個字串本來就不可能出現 |
| `tests/deploy-evidence.test.mjs:63`（二） | 同一清單裡的一個字串：部署者登入 email 的網域片段 | `'REDACTED-EMAIL-DOMAIN'` | 不公開部署者 email 的任何部分。測試邏輯不變：它只檢查這個字串不在輸出裡，而第 64 行的 `doesNotMatch(md,/@|…/)` 本來就禁止輸出中出現任何 `@`，檢查強度不變。注意：在本快照中這個測試會在第 54 行因缺少團隊的 git 歷史而失敗，第 63–64 行不會執行（`TESTS/README.md` 第 1 節）；在團隊的 checkout 中照常執行並通過 |
| `tests/review-record.test.mjs:267`（上一輪在第 196 行） | 檢查狀態文件的禁止字 regex 中兩個與本審查無關的內部名稱，以及斷言訊息中的同一個名稱 | 從 regex 移除這兩個詞；斷言訊息改為 `'no local path, email or wallet address [REDACTED-INTERNAL]'` | 公開 repo 不收錄與審查無關的內部名稱。其餘檢查（本機路徑、email、錢包地址、禁用字）不變 |
| `tests/review-record.test.mjs:290`（上一輪在第 219 行） | 對 `docs/security/MINT_BOUNDARY.md` 套用的同一個 regex，含同樣兩個內部名稱（原本沒有斷言訊息） | 從 regex 移除這兩個詞；加上同樣的斷言訊息 `'no local path, email or wallet address [REDACTED-INTERNAL]'` | 同上。這兩處讓本快照的測試比團隊版少檢查這兩個名稱；團隊版在團隊端的完整測試中照常執行並通過 |

### 1.6 刻意保留、沒有遮蔽的相關文字

- `source/src/world/HomePanels.tsx:31` 的 UI 文字（共用的住處登記後端還沒上線）與 `source/src/world/i18n.tsx:39` 的 UI 文字（未來的探索故事）：它們在公開的正式前端 bundle 裡，改動會讓公開原始碼與正式 bundle 不一致，所以保留。
- `source/wrangler.jsonc` 中的 zone 設定說明（HTTPS、WAF 規則）與 D1 migration 的套用方式說明：一般部署設定說明，前幾輪已公開。
- `source/server/auth.ts:99-101` 描述 zone 的 Cloudflare WAF 規則是第一道洪水防線：與登入安全直接相關。

## 2. 未收錄的檔案（不是遮蔽，是不公開）

- **commit f4272c5 中的 504 個檔案**：依持有人決定不公開（3D 世界、地形與其建置腳本、模型、美術、音樂、新手引導、地圖、Pepe 裝飾與雕像、房屋分配與擺放、房屋內部、主畫面接線 `WorldApp.tsx` 與效能調整新增的 `bridge.ts`、`dataMode.ts`、`screenSpace.ts`、`skin/terrainTask.ts`、其他測試與腳本、文件與圖檔、舊小遊戲殘留、repo 的 README／DESIGN／PLAN 等）。比上一輪（132228c 的 484 個）多 20 個，都是前端的世界內容與其測試：纜車（`src/world/cableCar.ts`、`src/world/skin/cableCar.ts`）、平靜天空（`src/world/calmSky.ts`）、`src/world/SourceNotes.tsx`，以及 11 個新測試檔與 5 個 fixture（船站、纜車、天氣、Guardian Hall、地標放大、Pepe 廣場、首次載入等）。清單與 SHA-256：`manifests/withheld-source.txt`；git blob id：`manifests/withheld-source-gitblobs.txt`。
- **本輪新公開的 6 個檔案**（不再保留）：`migrations/0005_lanes_and_subnets.sql`（N-4／N-5／N-6 的 schema；測試透過 `tests/d1-sqlite.mjs` 在 `node:sqlite` 上執行全部 migration，`tests/auth.test.mjs:751` 與 `tests/presence.test.mjs:76` 也直接讀這個檔案），以及 5 個部署證據頁 `docs/security/deploy-evidence/20260930T145241Z-007ee80.md`、`20260930T154746Z-a77f91b.md`、`20260930T185800Z-41ae386.md`、`20260930T221950Z-0d57791.md`、`20261001T040934Z-2e4e830.md`。它們都與 git blob 逐位元組相同、沒有遮蔽。
- **部署證據頁共收錄 10 頁**：上一輪的 5 頁（1a0ba21、2da46cd、5398b90、4321bb4、df8ea90 的部署）加上本輪 5 頁。原因：`tests/review-record.test.mjs:255-257` 會確認 `AUDIT_REMEDIATION_STATUS.md` 引用的每個 `docs/security/*.md` 頁面都存在；而這些頁面只含 `scripts/deploy-evidence.mjs` 從部署紀錄取出的結構化欄位（版本、雜湊、migration、limiter 綁定、WAF 規則 id）與團隊手填的欄位，不含 log 文字。內容仍是團隊端證據（`DEPLOYMENT_MATCH.md` 第 6 節）。
- **部署紀錄中的敏感檔案**：`wrangler-logs/`、`wrangler.log`、`worker/index.js.map`（含部署者的登入資訊與本機路徑）以及實際上傳的 `worker/index.js` 都不收錄；只收錄 `SHA256SUMS`（雜湊與相對路徑，`manifests/deploy-record-SHA256SUMS.txt`）與 `DEPLOYMENT_MATCH.md` 摘錄的 manifest 欄位。`worker/index.js` 可由 reviewer 從 `source/` 自行重建。
- **git tag 的 tagger 欄位**：不收錄。
- **wrangler 部署查詢輸出**：本輪沒有執行；只引用部署紀錄 manifest 中的版本、時間與工具版本，以及團隊對部署、回滾與 0005 套用的說明。
- **團隊端完整測試的原始輸出**：含被保留測試的名稱與本機路徑，不收錄，只公開其 SHA-256（`TESTS/README.md` 第 2 節）。
- **真實錢包登入的畫面**：團隊端說明（`DEPLOYMENT_MATCH.md` 第 2 節）沒有附截圖，也不公開所用的錢包地址。

## 3. 產生的證據檔中的遮蔽

以下證據檔都在 2026-10-01 重新產生。

- `TESTS/siwe-sample/siwe-sample-output.txt`：`__Host-imd_flow`、`__Host-imd_session` 的值替換為 `<REDACTED>`；不寫入任何簽章。地址是當次臨時產生的合成金鑰地址，金鑰只存在記憶體、已丟棄、不控制任何資產；頁面端摘要中的地址以說明文字代替。腳本使用的網段 `203.0.113.0/24`、`198.51.100.0/24` 都是文件用的保留位址範圍（RFC 5737；輸出中出現的是 `net:203.0.113.0/24`）。log 行中的 `colo` 是固定的 `TEST`。
- `TESTS/probes/keyed-reads-probe-output.txt`：session 鍵（token 雜湊前綴）顯示為 `session:<token-hash prefix>`；IP 都是 RFC 5737 文件用位址或 loopback。
- `SIWE.md` 的範例訊息取自同一份 SIWE 輸出。
- `TESTS/npm-test-output.txt`、`TESTS/npm-test-output.no-stub.txt`、`TESTS/home-entry-group5-output.txt`、`TESTS/n-tests-output.txt`（本輪新增）、`TESTS/worker-dry-run-output.txt`：建置機器上的暫存目錄路徑換成 `<SCRATCH>`（group 5 與 N 測試的輸出本來就不含路徑），其餘未改。
- `TESTS/tsc-noEmit-output.txt`：只有相對路徑，不需替換；tsc 在 Windows 上輸出 CRLF 換行，收錄時改成 LF（本 repo 的所有檔案都是 LF），文字未改。

## 4. 從未讀取或收錄的東西

整個準備過程**沒有讀取**任何 `.dev.vars`、`.env*`、憑證、keyring 或 wrangler 登入檔，沒有讀取部署紀錄的 wrangler 記錄檔與 source map，也沒有讀取 Cloudflare secret 的值（Worker secret 只知道名稱 `ALCHEMY_API_KEY`）。截圖本身與 Cloudflare account id 都不收錄。本快照不含私鑰、助記詞、`.env` 真值、API／RPC key、session cookie、Bearer token、有效正式簽章、使用者私人資料、正式資料庫的任何資料列或瀏覽器 profile。

檢查方式（對整個快照的檔案）：搜尋 email 樣式、Windows／Linux 使用者目錄與暫存目錄等本機路徑樣式、64 位 hex（私鑰樣式）、`sk_`、API key 樣式、account id 與 database id 的片段，以及 `tests/review-record.test.mjs` 移除的兩個內部名稱；除了 `package-lock.json` 的套件完整性雜湊（`sha512-…`）、公開的合約／錢包地址、交易選擇器、文件與證據頁引用的 SHA-256、測試用的 SHA-256 測試向量（`"abc"` 與空字串）之外沒有命中。email 樣式只有 `source/tests/deploy.test.mjs:99` 與 `source/tests/deploy-evidence.test.mjs:13` 兩個測試用的假地址（保留網域 `example.invalid`、`example.com`，RFC 2606）。`source/tests/deploy-evidence.test.mjs:13` 另有兩個虛構的 Windows 與 Linux 使用者目錄路徑（使用者名稱 `someone`），用來確認它們不會出現在輸出。測試 harness 中的 `test-alchemy-key`（`source/tests/wallet-harness.mjs:86`）是假字串，不是金鑰。

## 5. 保留、未遮蔽的識別資訊（刻意公開）

見 `PUBLIC_CONTENT_LIST.md`：網域、公開合約地址、IMD 公開名冊中的席位持有者地址（只在一個測試 fixture 內）、GitHub 帳號名稱 `tungweb3`（版權聲明）等。
