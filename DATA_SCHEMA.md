# DATA_SCHEMA：D1 資料結構（去敏）

來源：`source/migrations/0001_wallet_login.sql` 與 `source/migrations/0002_sign_in_budgets.sql`（commit 0def8cb 的全部 migration）。本檔**不含任何正式資料列**；本輪依限制沒有查詢正式資料庫（沒有 `wrangler d1 … --remote`），所以正式 D1 的 schema 是否與這兩個 migration 完全相同，只能以 repo 與團隊端說明為準（未驗證）。團隊端說明：0002 在部署 0def8cb 之前已套用到正式 D1。

資料庫：Cloudflare D1 `imd-world`，binding `DB`。repo 內只有這個 Worker 綁定它（`wrangler.jsonc:55`；database_id 已遮蔽，見 `REDACTIONS.md`）；IMD 帳號的 Workers & Pages 只有 `imd-world` 一個應用程式，所以沒有其他 Worker 綁定它：持有人提供的 dashboard 截圖確認（reviewer 無法獨立驗證；`SCOPE.md` 第 7 節）。時間一律是 epoch 毫秒整數，地址一律小寫 hex。

## Migration 0002（只增不改）

`0002_sign_in_budgets.sql` 只做五件事，不改也不刪任何既有列；0001 時代的程式在 0002 之後仍可運作（`tests/presence.test.mjs` 的「0002 is additive」測試在一個已有資料的 0001 資料庫上驗證這一點）：

1. `ALTER TABLE login_challenges ADD COLUMN net TEXT`
2. `ALTER TABLE login_challenges ADD COLUMN checked_at INTEGER`
3. `CREATE INDEX login_challenges_issued ON login_challenges(issued_at)`
4. `CREATE INDEX login_challenges_net ON login_challenges(net, issued_at)`
5. `CREATE INDEX sessions_expires ON sessions(expires_at)`

wrangler 會把套用過的 migration 記在 `d1_migrations`，不會重跑。0def8cb 的 challenge INSERT 會寫 `net` 欄位，所以若 0002 沒有套用，登入會回 503 `AUTH_UNAVAILABLE`（不會放行）。

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
| `invalidated_at` | INTEGER | 0001 | 作廢時間：被同一 flow 的新 challenge 取代、登出，或（0def8cb 起）verify 判定的驗簽失敗（limiter 綁定缺失或 D1 寫入失敗的 503 不會作廢，見 `SIWE.md` 第 3 節） |
| `session_hash` | TEXT | 0001 | 消耗時產生的 session token 的 SHA-256 |
| `net` | TEXT | **0002** | 請求 challenge 的用戶網段：`net:a.b.c.0/24`（IPv4）或 `net6:x:y:z::/48`（IPv6），由 `cf-connecting-ip` 推導（`worker/app.ts:55-59`）；**不存完整 IP**。0002 之前的列為 NULL |
| `checked_at` | INTEGER | **0002** | 某次 verify 為了唯一一次 ERC-1271 查核而認領這個 challenge 的時間（`server/auth.ts:65-66`） |

索引：`login_challenges_flow(flow_hash, used_at)`（0001）、`login_challenges_issued(issued_at)`（0002，全站失控閥與清理用）、`login_challenges_net(net, issued_at)`（0002，每網段預算用）。

## sessions

| 欄位 | 型別 | 說明 |
|---|---|---|
| `token_hash` | TEXT PRIMARY KEY | `SHA-256(session token)`；token 原值只在 cookie 裡 |
| `address` | TEXT NOT NULL | 登入地址（小寫） |
| `chain_id` | INTEGER NOT NULL | 固定 1 |
| `created_at` | INTEGER NOT NULL | |
| `expires_at` | INTEGER NOT NULL | challenge `issued_at` + 7 天；絕對期限，不續期 |
| `revoked_at` | INTEGER | 登出時設定 |
| `nonce` | TEXT NOT NULL UNIQUE | 來源 challenge；UNIQUE 是「一個 challenge 只能產生一個 session」的第二道鎖 |

索引：`sessions_address(address)`（0001）、`sessions_expires(expires_at)`（0002，清理用）。

## seat_presence

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
| challenge 預算 | `INSERT … SELECT … WHERE (同網段 60 秒內的列數) < 30 AND (全站 6 秒內的列數) < 60`，一個敘述完成計數與寫入；每個計數以 `LIMIT` 限制掃描量（`server/auth.ts:58-60`） |
| nonce 一次性 | verify 在同一個 batch 內 `UPDATE … WHERE used_at IS NULL AND invalidated_at IS NULL AND accept_until > now` 再 `INSERT … SELECT`；只有 UPDATE 成功的那次會產生 session；`sessions.nonce UNIQUE` 為第二道鎖（`server/auth.ts:226-235`） |
| 驗簽失敗 | `UPDATE login_challenges SET invalidated_at WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL`（`server/auth.ts:202-204`）；之後同一 nonce 一律 409 |
| ERC-1271 一次性 | `UPDATE … SET checked_at WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL AND (同網段 60 秒內已查核數) < 3`；同一 batch 的 `BURN_UNCLAIMED` 在沒認領到時作廢它（`server/auth.ts:65-67,212-217`） |
| 重送 | 已使用或已作廢 → 409 `CHALLENGE_USED` |
| challenge 到期 | `now >= accept_until` → 410 |
| session 撤銷 | 登出 `UPDATE sessions SET revoked_at`；`readSession` 見到 `revoked_at` 即視為未登入 |
| session 到期 | `expires_at <= now` → `SESSION_EXPIRED`，並清除 cookie |
| 清理（cron） | `DELETE FROM login_challenges WHERE issued_at < now-10分鐘 AND (used_at IS NULL OR accept_until < now-1天)`：從未使用的 challenge 10 分鐘後刪除，已使用的保留到時間窗結束後一天；`DELETE FROM sessions WHERE expires_at < now-1天`。兩者都是索引範圍讀取（`server/presence.ts:29-35,42`；`tests/presence.test.mjs` 以 `EXPLAIN QUERY PLAN` 固定） |

## 快取（不在 D1）

所有權證明 30 秒、候選 5 分鐘（`fresh` 30 秒）、公開資產清單 5 分鐘，全部是每個 Worker isolate 的記憶體 LRU（上限 512 個地址）（`server/ownership.ts:23-26`）。所有權查核失敗不快取；NFT 索引讀取被預算拒絕也不快取（只有該次的證明帶 `limited` 標記、30 秒）；角色清單讀取失敗則會被記住 60 秒，期間直接回 `unavailable`、不再詢問（`FAILED_LIST_MS`，`server/ownership.ts:23,216-229`）。

## 測試如何使用這份 schema

`tests/d1-sqlite.mjs` 把 `migrations/` 內的 SQL 依編號順序原封不動套到 `node:sqlite` 記憶體資料庫，並提供與 D1 相同的 `prepare／batch` 介面（batch 為單一交易）。所有登入與所有權測試都跑在這兩個真 migration 上。
