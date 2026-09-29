# DATA_SCHEMA：D1 資料結構（去敏）

來源：`source/migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql`（commit 2da46cd 的全部 migration）。本檔**不含任何正式資料列**；本輪依限制沒有查詢正式資料庫（沒有 `wrangler d1 … --remote`），所以正式 D1 的 schema 是否與這三個 migration 完全相同，只能以 repo 與團隊端說明為準（未驗證）。團隊端說明：0003 在部署 `f9b68223`（2026-09-28 21:05 UTC）之前、先匯出備份後套用到正式 D1，並從 `d1_migrations` 與 `sqlite_master` 讀回確認。

資料庫：Cloudflare D1 `imd-world`，binding `DB`。repo 內只有這個 Worker 綁定它（`wrangler.jsonc:61`；database_id 已遮蔽，見 `REDACTIONS.md`）。時間一律是 epoch 毫秒整數，地址一律小寫 hex。

## Migration 0003（本版新增，只增不改）

`0003_sign_in_layers.sql` 只新增可為 NULL 的欄位與索引，不改也不刪任何既有列；0003 之前的程式在 0003 之後仍可運作（`tests/presence.test.mjs`「0003 is additive: on a live 0002 database every row stays as it was…」）：

1. `ALTER TABLE sessions ADD COLUMN wallet_type TEXT`（`'EOA'`／`'CONTRACT'`，F-2）
2. `ALTER TABLE sessions ADD COLUMN verification_method TEXT`（`'ECDSA'`／`'ERC1271'`，F-2）
3. `CREATE INDEX sessions_erc1271 ON sessions(address) WHERE verification_method='ERC1271'`（部分索引：「已知智慧錢包」查詢最多讀一筆，永遠不碰該地址的 ECDSA session）
4. `CREATE INDEX sessions_live ON sessions(address, expires_at) WHERE revoked_at IS NULL`（部分索引：logout-all 只讀仍有效的 session）
5. `ALTER TABLE login_challenges ADD COLUMN called_at INTEGER`（ERC-1271 合約查核的時間，F-3）
6. `CREATE INDEX login_challenges_called_net ON login_challenges(net, called_at) WHERE called_at IS NOT NULL`
7. `CREATE INDEX login_challenges_called_address ON login_challenges(address, called_at) WHERE called_at IS NOT NULL`
8. `CREATE INDEX login_challenges_address ON login_challenges(address, issued_at, net)`（每錢包冷卻與跨網段 surge 計數，F-5）

wrangler 會把套用過的 migration 記在 `d1_migrations`，不會重跑。這版的 session INSERT 會寫 `wallet_type`，所以若 0003 沒有套用，verify 會回 503 `AUTH_UNAVAILABLE` 並寫一行 log（不會放行，`server/auth.ts:370-374`；`tests/auth.test.mjs`「deployed before migrations/0003…」）。

## Migration 0002（上一版，只增不改）

`ALTER TABLE login_challenges ADD COLUMN net TEXT`、`ADD COLUMN checked_at INTEGER`；索引 `login_challenges_issued(issued_at)`、`login_challenges_net(net, issued_at)`、`sessions_expires(expires_at)`。

## login_challenges

每次成功的 `POST /api/auth/challenge` 一列（被預算拒絕的請求不寫任何列）。

| 欄位 | 型別 | 來自 | 說明 |
|---|---|---|---|
| `nonce` | TEXT PRIMARY KEY | 0001 | 16 bytes 隨機 hex |
| `address` | TEXT NOT NULL | 0001 | 要登入的地址（小寫） |
| `origin` | TEXT NOT NULL | 0001 | 發起請求的 Origin（verify 時必須相同） |
| `flow_hash` | TEXT NOT NULL | 0001 | `SHA-256(__Host-imd_flow)`，login CSRF 綁定；cookie 原值不存 |
| `message` | TEXT NOT NULL | 0001 | 伺服器產生的完整 SIWE 原文；verify 只從這裡讀，不從用戶端讀 |
| `issued_at` | INTEGER NOT NULL | 0001 | 簽發時間；必須等於訊息的 Issued At |
| `accept_until` | INTEGER NOT NULL | 0001 | 簽發 + 5 分鐘；必須等於訊息的 Expiration Time |
| `used_at` | INTEGER | 0001 | 被消耗的時間（一次性） |
| `invalidated_at` | INTEGER | 0001 | 作廢時間：被同一 flow 的新 challenge 取代、登出、登出所有裝置，或 verify 判定的驗簽失敗 |
| `session_hash` | TEXT | 0001 | 消耗時產生的 session token 的 SHA-256 |
| `net` | TEXT | 0002 | 請求 challenge 的用戶網段：`net:a.b.c.0/24` 或 `net6:x:y:z::/48`，由 `cf-connecting-ip` 推導（`worker/app.ts:55-59`）；**不存完整 IP** |
| `checked_at` | INTEGER | 0002 | 某次 verify 為了唯一一次 ERC-1271 查核而認領這個 challenge 的時間（`CLAIM_ERC1271`） |
| `called_at` | INTEGER | **0003** | 認領之後、確認地址有 code 並進入合約查核的時間（`CLAIM_CONTRACT`，`server/auth.ts:124-126`） |

索引：`login_challenges_flow(flow_hash, used_at)`（0001）；`login_challenges_issued`、`login_challenges_net`（0002）；`login_challenges_address`、`login_challenges_called_net`、`login_challenges_called_address`（0003）。

## sessions

| 欄位 | 型別 | 來自 | 說明 |
|---|---|---|---|
| `token_hash` | TEXT PRIMARY KEY | 0001 | `SHA-256(session token)`；token 原值只在 cookie 裡 |
| `address` | TEXT NOT NULL | 0001 | 登入地址（小寫） |
| `chain_id` | INTEGER NOT NULL | 0001 | 固定 1 |
| `created_at` | INTEGER NOT NULL | 0001 | |
| `expires_at` | INTEGER NOT NULL | 0001 | challenge `issued_at` + 7 天；絕對期限，不續期 |
| `revoked_at` | INTEGER | 0001 | 登出或登出所有裝置時設定 |
| `nonce` | TEXT NOT NULL UNIQUE | 0001 | 來源 challenge；UNIQUE 是「一個 challenge 只能產生一個 session」的第二道鎖 |
| `wallet_type` | TEXT | **0003** | `EOA`（ECDSA 由地址自己的金鑰證明，含 EIP-7702 委派 EOA）或 `CONTRACT`（ERC-1271）；0003 之前的列為 NULL。只供稽核與除錯：`/api/auth/session` 不回傳，沒有任何程式用它授予權限 |
| `verification_method` | TEXT | **0003** | `ECDSA` 或 `ERC1271`；同上 |

索引：`sessions_address(address)`（0001）、`sessions_expires(expires_at)`（0002）、`sessions_erc1271`、`sessions_live`（0003，部分索引）。

## seat_presence（本版未改）

cron（每 15 分鐘）記錄 IMD `/workers` 名冊列為在線的席位。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `token_id` | INTEGER PRIMARY KEY | 席位編號 |
| `owner` | TEXT | 當時 IMD `swarm.owners[id]` 的地址（僅參考；所有權以 `ownerOf` 為準） |
| `last_online_at` | INTEGER NOT NULL | 最後一次被列為在線的時間 |
| `updated_at` | INTEGER NOT NULL | |

索引：`seat_presence_seen(last_online_at)`。這張表不刪除。

## 一次性、撤銷、到期、預算與清理

| 規則 | 實作 |
|---|---|
| challenge 預算 | `INSERT … SELECT … WHERE (同網段 60 秒內) < 30 AND (同地址同網段 60 秒內) < 5 AND (全站 6 秒內) < 60`，一個敘述完成計數與寫入；每個計數以 `LIMIT` 限制掃描量（`server/auth.ts:105-108`） |
| nonce 一次性 | verify 在同一個 batch 內 `UPDATE … WHERE used_at IS NULL AND invalidated_at IS NULL AND accept_until > now` 再 `INSERT … SELECT`；只有 UPDATE 成功的那次會產生 session；`sessions.nonce UNIQUE` 為第二道鎖（`server/auth.ts:362-376`） |
| 驗簽失敗 | `UPDATE login_challenges SET invalidated_at WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL`（`server/auth.ts:332`）；之後同一 nonce 一律 409 |
| ERC-1271 一次性 | `CLAIM_ERC1271`：只在 `checked_at IS NULL` 而且同網段 60 秒內認領 < 10（已知智慧錢包除外）時寫入 `checked_at`；同一 batch 的 `BURN_UNCLAIMED` 在沒認領到時作廢它（`server/auth.ts:119-120,136`） |
| ERC-1271 合約查核 | `CLAIM_CONTRACT`：只在 `called_at IS NULL` 而且同網段 60 秒內 < 3、同地址 60 秒內 < 2 時寫入 `called_at`（`server/auth.ts:124-126`） |
| 已知智慧錢包 | `KNOWN_ERC1271`：`SELECT 1 FROM sessions WHERE address=? AND verification_method='ERC1271' LIMIT 1`（`server/auth.ts:132`）；session 保留到過期後一天，所以「已知」最長約 8 天 |
| 重送 | 已使用或已作廢 → 409 `CHALLENGE_USED` |
| challenge 到期 | `now >= accept_until` → 410 |
| session 撤銷（此裝置） | `UPDATE sessions SET revoked_at WHERE token_hash=? AND revoked_at IS NULL`（`server/auth.ts:388`） |
| session 撤銷（所有裝置） | `REVOKE_ALL_SESSIONS`：`UPDATE sessions SET revoked_at=? WHERE address=? AND revoked_at IS NULL AND expires_at>?`（`server/auth.ts:135,403`）；同一 batch 作廢該地址過去 5 分鐘內與本 flow 未完成的 challenge。只設 `revoked_at`，不刪列 |
| session 到期 | `expires_at <= now` → `SESSION_EXPIRED`，並清除 cookie |
| 清理（cron，本版未改） | `DELETE FROM login_challenges WHERE issued_at < now-10分鐘 AND (used_at IS NULL OR accept_until < now-1天)`；`DELETE FROM sessions WHERE expires_at < now-1天`。兩者都是索引範圍讀取（`server/presence.ts:29-35,42`；`tests/presence.test.mjs` 以 `EXPLAIN QUERY PLAN` 固定） |

## 快取（不在 D1）

- 所有權證明 30 秒、候選 5 分鐘（`fresh` 30 秒）、公開資產清單 5 分鐘，全部是每個 Worker isolate 的記憶體 LRU（上限 512 個地址）（`server/ownership.ts:23-26`，本版未改）。
- **「沒有 code」快取**（本版新增，F-3）：每個 Worker isolate 一份 `Map`，記住 `eth_getCode` 剛回「沒有 code」的地址 60 秒，上限 4,096 筆（`server/auth.ts:222-226,264-266`、`worker/app.ts:86`）。命中時錯誤簽章直接 401，不認領、不讀鏈。它只會讓錯誤簽章更早被拒，不會讓任何簽章通過。

## 測試如何使用這份 schema

`tests/d1-sqlite.mjs` 把 `migrations/` 內的 SQL 依編號順序原封不動套到 `node:sqlite` 記憶體資料庫，並提供與 D1 相同的 `prepare／batch` 介面（batch 為單一交易）；本版可以只套用前幾個 migration，用來測試「程式先於 0003 部署」的情況。所有登入與所有權測試都跑在這三個真 migration 上。
