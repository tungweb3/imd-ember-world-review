# DATA_SCHEMA：D1 資料結構（去敏）

來源：`source/migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql`、`0004_index_candidates.sql`（本快照的全部 migration）。這四個檔名與正式部署來源 `4321bb4` 的部署證據頁所列相同，`0002`–`0004` 的 SHA-256 也與證據頁相同；`0001` 因遮蔽而不同（見 `REDACTIONS.md`）。本檔**不含任何正式資料列**；本輪依限制沒有查詢正式資料庫（沒有 `wrangler d1 … --remote`），所以正式 D1 的 schema 是否與這四個 migration 完全相同，只能以 repo 與團隊端說明為準（未驗證，reviewer 應自行判斷）。團隊端說明：

- 0003 在部署 `f9b68223`（2026-09-28 21:05 UTC）之前、先匯出備份後套用到正式 D1，並從 `d1_migrations` 與 `sqlite_master` 讀回確認。
- **0004** 在部署 `1a0dd495`（2026-09-29 19:54 UTC）之前、約 19:53 UTC、先匯出備份後以 `wrangler d1 migrations apply imd-world --remote` 套用；之後 `wrangler d1 migrations list imd-world --remote` 回答 "No migrations to apply"，遠端資料表清單包含 `index_candidates`（`source/docs/security/deploy-evidence/20260929T195417Z-4321bb4.md:26-38`）。

資料庫：Cloudflare D1 `imd-world`，binding `DB`。repo 內只有這個 Worker 綁定它（`wrangler.jsonc:62`；database_id 已遮蔽，見 `REDACTIONS.md`）。時間一律是 epoch 毫秒整數，地址一律小寫 hex。

## Migration 0004（本版新增，只增不改）

`0004_index_candidates.sql` 只新增一張表，不改也不刪任何既有表或列；0004 之前的程式從不讀它（`tests/presence.test.mjs`「0004 is additive: on a live 0003 database every row of every table stays as it was, and index_candidates starts empty」）：

```sql
CREATE TABLE index_candidates(address TEXT PRIMARY KEY, ids TEXT NOT NULL, read_at INTEGER NOT NULL);
```

（`source/migrations/0004_index_candidates.sql:12`；除主鍵外沒有其他索引，理由見 `:9-11` 與下方「清理」。）用途是 Swarm audit 519db624 的 A-2：把每個地址最近一次 NFT 索引的答案存在 D1，讓每個 Worker isolate 與據點都拿得到，而不是只有讀到它的那一個。

程式先於 0004 部署時（團隊的部署順序是先套 migration 再部署程式）：寫入與讀取這張表都會失敗並被忽略，行為退回「每個 isolate 只記自己的答案」；cron 的清理也獨立執行，不會讓在線紀錄或其他清理停下（`server/ownership.ts:151-152,163-164,172`、`server/presence.ts:40-41,52-53`；`tests/ownership.test.mjs`「deployed before migrations/0004: house reads, refused or failing index reads and the cron work as before the table」）。

## Migration 0003（上一版，只增不改）

`0003_sign_in_layers.sql` 只新增可為 NULL 的欄位與索引，不改也不刪任何既有列；0003 之前的程式在 0003 之後仍可運作（`tests/presence.test.mjs`「0003 is additive: on a live 0002 database every row stays as it was…」）：

1. `ALTER TABLE sessions ADD COLUMN wallet_type TEXT`（`'EOA'`／`'CONTRACT'`，F-2）
2. `ALTER TABLE sessions ADD COLUMN verification_method TEXT`（`'ECDSA'`／`'ERC1271'`，F-2）
3. `CREATE INDEX sessions_erc1271 ON sessions(address) WHERE verification_method='ERC1271'`（部分索引：「已知智慧錢包」查詢最多讀一筆，永遠不碰該地址的 ECDSA session）
4. `CREATE INDEX sessions_live ON sessions(address, expires_at) WHERE revoked_at IS NULL`（部分索引：logout-all 只讀仍有效的 session）
5. `ALTER TABLE login_challenges ADD COLUMN called_at INTEGER`（ERC-1271 合約查核的時間，F-3）
6. `CREATE INDEX login_challenges_called_net ON login_challenges(net, called_at) WHERE called_at IS NOT NULL`
7. `CREATE INDEX login_challenges_called_address ON login_challenges(address, called_at) WHERE called_at IS NOT NULL`
8. `CREATE INDEX login_challenges_address ON login_challenges(address, issued_at, net)`（當初為 F-5 的每錢包冷卻與跨網段 surge 計數建立；本版 A-6 已移除每錢包冷卻，現在由 surge 計數 `ADDRESS_COUNT` 與 logout-all 作廢該地址 challenge 的敘述使用）

wrangler 會把套用過的 migration 記在 `d1_migrations`，不會重跑。這版的 session INSERT 會寫 `wallet_type`，所以若 0003 沒有套用，verify 會回 503 `AUTH_UNAVAILABLE` 並寫一行 log（不會放行，`server/auth.ts:423-427`；`tests/auth.test.mjs`「deployed before migrations/0003…」）。

## Migration 0002（更早，只增不改）

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
| `issued_at` | INTEGER NOT NULL | 0001 | 簽發時間；必須等於訊息的 Issued At。本版起在 request body 讀完之後才取時間（A-5） |
| `accept_until` | INTEGER NOT NULL | 0001 | 簽發 + 5 分鐘；必須等於訊息的 Expiration Time |
| `used_at` | INTEGER | 0001 | 被消耗的時間（一次性） |
| `invalidated_at` | INTEGER | 0001 | 作廢時間：被同一 flow 的新 challenge 取代、登出、登出所有裝置，或 verify 判定的失敗（驗簽失敗、ERC-1271 份額或預算被拒等） |
| `session_hash` | TEXT | 0001 | 消耗時產生的 session token 的 SHA-256 |
| `net` | TEXT | 0002 | 請求 challenge 的用戶網段：`net:a.b.c.0/24` 或 `net6:x:y:z::/48`，由 `cf-connecting-ip` 推導（`worker/app.ts:74-78`）；**不存完整 IP** |
| `checked_at` | INTEGER | 0002 | 某次 verify 為了唯一一次 ERC-1271 查核而認領這個 challenge 的時間（`CLAIM_ERC1271`，`server/auth.ts:141-142`） |
| `called_at` | INTEGER | 0003 | 認領之後、確認地址有 code 並進入合約查核的時間：`CLAIM_CONTRACT`，或同一 batch 內的 `CLAIM_LANE`（A-1）（`server/auth.ts:146-148,154-156,399-401`） |

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
| `wallet_type` | TEXT | 0003 | `EOA`（ECDSA 由地址自己的金鑰證明，含 EIP-7702 委派 EOA）或 `CONTRACT`（ERC-1271）；0003 之前的列為 NULL。只供稽核與除錯：`/api/auth/session` 不回傳，沒有任何程式用它授予權限 |
| `verification_method` | TEXT | 0003 | `ECDSA` 或 `ERC1271`；同上 |

索引：`sessions_address(address)`（0001）、`sessions_expires(expires_at)`（0002）、`sessions_erc1271`、`sessions_live`（0003，部分索引）。

## seat_presence（本版未改）

cron（每 15 分鐘）記錄 IMD `/workers` 名冊列為在線的席位。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `token_id` | INTEGER PRIMARY KEY | 席位編號 |
| `owner` | TEXT | 當時 IMD `swarm.owners[id]` 的地址（僅參考；所有權以 `ownerOf` 為準） |
| `last_online_at` | INTEGER NOT NULL | 最後一次被列為在線的時間 |
| `updated_at` | INTEGER NOT NULL | |

索引：`seat_presence_seen(last_online_at)`。這張表不刪除（`server/presence.ts:46-47`）。

## index_candidates（本版新增，0004）

每個地址最近一次 NFT 索引（Alchemy `getNFTsForOwner`）的答案，只當作**候選**；每一個候選照樣由 `ownerOf` 證明，這張表不授予任何權利。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `address` | TEXT PRIMARY KEY | 地址（小寫）。只會是索引曾列出至少一個席位的地址 |
| `ids` | TEXT NOT NULL | JSON 陣列，最多 `CANDIDATE_CAP`（256）個十進位 token id，依 A-4 的順序排列（roster 顯示在線的 agent 席位、其他已註冊 agent 的席位、其餘，各依編號）後截斷（`server/ownership.ts:27,136-138,212,222`） |
| `read_at` | INTEGER NOT NULL | 那次索引讀取**開始**的時間（在 `chain:index` 預算通過之後取時鐘，不是請求開始的時間；`server/ownership.ts:129-132,220`、`server/auth.ts:520`）。較舊的答案永遠不會覆蓋較新的 |

誰寫、誰讀、誰刪：

| 動作 | 誰 | 敘述 | 條件與實作 |
|---|---|---|---|
| 寫入 | `GET /api/me/home`（`Ownership.proof`）每一次成功的索引讀取 | `KEEP_INDEX`（`server/ownership.ts:153-154`）：`INSERT … ON CONFLICT(address) DO UPDATE … WHERE excluded.read_at>=index_candidates.read_at` | 答案列出席位時 upsert；在回應送出之後以 `waitUntil` 執行，失敗不影響這次讀取（`server/ownership.ts:161-165,222`） |
| 刪除（單一地址） | 同上 | `DROP_INDEX`（`server/ownership.ts:155`）：`DELETE … WHERE address=?1 AND read_at<=?2` | 答案沒有列出任何席位時；所以拋棄式地址不會留下任何列 |
| 讀取 | 同上，只在索引讀取被拒或失敗時 | `READ_INDEX`（`server/ownership.ts:156`）：`SELECT ids,read_at … WHERE address=?1` | `chain:index` 預算拒絕（`Limited`）或索引讀取失敗（`OwnershipUnavailable`）時才讀；與本 isolate 自己保存的答案取較新者；只接受 1–80 位數字字串、最多 256 個（`server/ownership.ts:166-173,224-230`） |
| 清理 | cron（每 15 分鐘） | `PRUNE_INDEX`（`server/presence.ts:43`）：`DELETE FROM index_candidates WHERE read_at<?1`，`?1 = now - INDEX_KEEP_MS`（8 天，`server/presence.ts:42`） | 在主要 batch 之後以自己的敘述執行，失敗時回傳 `indexPruned: null`，不影響在線紀錄與其他清理（`server/presence.ts:26-27,52-53,57`）；`tests/presence.test.mjs`「A-2: the cron deletes index answers read more than 8 days ago…」 |

沒有資料庫時（Vite dev server）什麼都不讀也不寫（`server/ownership.ts:162,167`）。

## 一次性、撤銷、到期、預算與清理

| 規則 | 實作 |
|---|---|
| challenge 預算 | `INSERT_CHALLENGE`：`INSERT … SELECT … WHERE (同網段 60 秒內) < 30 AND (全站 6 秒內) < 60 − 20 × [此網段 60 秒內已有 challenge]`，一個敘述完成計數與寫入；每個計數以 `LIMIT` 限制掃描量，`EXISTS` 最多讀一筆（`server/auth.ts:129-131`，綁定值在 `:351-352`）。本版變更：A-6 移除「同地址同網段 60 秒內 < 5」的每錢包冷卻；A-7 在全站 60／6 秒中保留 20（`FRESH_NETWORK_RESERVE`，`:118`）給 60 秒內沒有要過 challenge 的網段。被拒時另讀 `REFUSAL_REASON`（`:133,357`）只為了寫 log |
| 同一地址的 surge 紀錄 | `ADDRESS_COUNT`（`server/auth.ts:135`）與 INSERT 同一個 batch（`:350-355`）；同一地址 60 秒內第 20 個起每個 challenge 寫一行 `auth_surge` log（`:362`）。只記錄，不拒絕 |
| nonce 一次性 | verify 在同一個 batch 內 `UPDATE … WHERE used_at IS NULL AND invalidated_at IS NULL AND accept_until > now` 再 `INSERT … SELECT`；只有 UPDATE 成功的那次會產生 session；`sessions.nonce UNIQUE` 為第二道鎖（`server/auth.ts:415-429`） |
| 驗簽失敗 | `UPDATE login_challenges SET invalidated_at WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL`（`server/auth.ts:381`）；之後同一 nonce 一律 409 |
| ERC-1271 一次性 | `CLAIM_ERC1271`：只在 `checked_at IS NULL` 而且同網段 60 秒內認領 < 10（已知智慧錢包除外）時寫入 `checked_at`；同一 batch 的 `BURN_UNCLAIMED` 在沒認領到時作廢它（`server/auth.ts:141-142,167,393-395`） |
| ERC-1271 合約查核 | `CLAIM_CONTRACT`：只在 `called_at IS NULL` 而且同網段 60 秒內 < 3、同地址 60 秒內 < 2 時寫入 `called_at`（`server/auth.ts:146-148`） |
| ERC-1271 lane（本版新增，A-1） | `CLAIM_LANE`，與 `CLAIM_CONTRACT` 同一個 batch：同地址的共用份額用完後，challenge 所屬網段仍可在 60 秒內對該地址做 1 次查核（仍在該網段的 3 次之內，`called_at IS NULL` 才寫），計入獨立的 limiter 鍵 `chain:erc1271:lane`（`server/auth.ts:154-156,190,399-402`）。兩者都被拒時另讀 `ADDRESS_CONTRACT_CHECKS`（`:159,403-404`）只為了寫 log |
| 已知智慧錢包 | `KNOWN_ERC1271`：`SELECT 1 FROM sessions WHERE address=? AND verification_method='ERC1271' LIMIT 1`（`server/auth.ts:163`）；session 保留到過期後一天，所以「已知」最長約 8 天 |
| 重送 | 已使用或已作廢 → 409 `CHALLENGE_USED` |
| challenge 到期 | `now >= accept_until` → 410（本版起 `now` 在 body 讀完後才取，A-5，`server/auth.ts:243-245,366,374`） |
| session 撤銷（此裝置） | `UPDATE sessions SET revoked_at WHERE token_hash=? AND revoked_at IS NULL`（`server/auth.ts:441`） |
| session 撤銷（所有裝置） | `REVOKE_ALL_SESSIONS`：`UPDATE sessions SET revoked_at=? WHERE address=? AND revoked_at IS NULL AND expires_at>?`（`server/auth.ts:166,456`）；同一 batch 作廢該地址過去 5 分鐘內與本 flow 未完成的 challenge（`:457-458`）。只設 `revoked_at`，不刪列 |
| session 到期 | `expires_at <= now` → `SESSION_EXPIRED`，並清除 cookie（`server/auth.ts:333`） |
| 索引答案（本版新增，A-2） | `KEEP_INDEX`／`DROP_INDEX`／`READ_INDEX`，見上一節 |
| 清理（cron） | `PRUNE_CHALLENGES`：`DELETE FROM login_challenges WHERE issued_at < now-10分鐘 AND (used_at IS NULL OR accept_until < now-1天)`；`PRUNE_SESSIONS`：`DELETE FROM sessions WHERE expires_at < now-1天`。兩者都是索引範圍讀取（`server/presence.ts:30-36,51`；`tests/presence.test.mjs` 以 `EXPLAIN QUERY PLAN` 固定）。本版新增 `PRUNE_INDEX`（8 天，見上一節）：刻意是全表掃描而不是索引範圍讀取，因為這張表只放索引曾列出席位的地址（程式註解估計最多幾千列，每天讀 96 次），而在 `read_at` 上加索引會讓每次 upsert 多寫一筆索引項（`server/presence.ts:37-43`） |

## D1 讀寫量（程式註解所述，reviewer 應自行判斷）

以下數字是程式註解的說法（`server/auth.ts:86-117`、`server/ownership.ts:147-150`、`server/presence.ts:37-41`），以 D1 計費的「列」計算：寫入時每改動一個索引項也算一列。團隊註明 `index_candidates` 的數字是在本機 workerd 的 D1 上量的；本輪沒有重新量測。

| 動作 | 讀 | 寫 |
|---|---|---|
| challenge（1 個 batch） | INSERT…SELECT ≤ 91 個索引項（網段計數、全站計數、判斷網段是否「新」的 1 項）；surge 計數 ≤ 21；被拒時另讀 ≤ 30 以寫出原因 | 1 列 + 5 個索引項（nonce、flow、issued、net、address）= 6；帶著舊 flow 時另作廢其未完成的 challenge（通常 0–1） |
| verify（ECDSA） | 以 nonce 讀 1 列 | 成功：challenge UPDATE 2（列 + flow 索引項）＋ session INSERT…SELECT 6（讀 1；token_hash、nonce、address、expires、live）；ERC-1271 session 多 `sessions_erc1271` = 7。失敗：1（作廢） |
| verify（ERC-1271 額外） | `KNOWN_ERC1271` ≤ 1；認領讀網段最近 6 分鐘的 challenge ≤ 180；合約 `CLAIM_CONTRACT` ≤ 5、`CLAIM_LANE` ≤ 9 | 認領 1；合約查核由認領成功的那一個寫 1 列 + 最多 2 個部分索引項 = 3；失敗時作廢 1 |
| `/api/me/home` | session 1；已證明席位的在線紀錄；索引被拒或失敗時 `READ_INDEX` ≤ 1 | 每次 `chain:index` 讀取的 `KEEP_INDEX`：讀 ≤ 1、寫 1（新地址 2：列與主鍵）；`DROP_INDEX` 寫 0（真的刪到一列時 1） |
| cron（每 15 分鐘） | 讀 10 分鐘前簽發、仍保留的 challenge（前一天內已使用的）；`PRUNE_INDEX` 掃描 `index_candidates` | 每刪一列寫 1 |

程式註解的上限估算：`chain:index` 每個據點每分鐘 20 次（一個月 864 k 次索引讀取），`index_candidates` 在列已存在時約為每個據點每月寫 0.9 M 列，若每次都是新地址最多約 1.7 M 列（只有索引列出席位的地址會被保存，所以每個新地址都要真的持有席位）；讀取次數受每個地址每個 isolate 30 秒的證明快取與每個 session 的 `home` 限流約束（`server/ownership.ts:147-150`、`server/auth.ts:100-105`）。登入部分：一次成功登入約寫 13 列、讀 5–91 列；在全站閥門持續全開一整個月的最壞情況下，註解估算的費用與容量見 `server/auth.ts:106-117`。

## 快取（不在 D1）

- 所有權證明 30 秒、候選 5 分鐘（`fresh` 30 秒）、公開資產清單 5 分鐘，全部是每個 Worker isolate 的記憶體 LRU（上限 512 個地址）（`server/ownership.ts:24-27`）。**本版有改（A-2）**：重新載入失敗時，快取會放回上一個成功的值並保留它原本的時間，而不是刪掉（`server/ownership.ts:174-190`，特別是 `:185-186`），所以索引被拒時 `peek` 仍拿得到上一次的答案。所有權證明本身不會在 30 秒之後被沿用。跨 isolate 的部分由上面的 `index_candidates` 補上。
- **「沒有 code」快取**（F-3）：每個 Worker isolate 一份 `Map`，記住 `eth_getCode` 剛回「沒有 code」的地址 60 秒，上限 4,096 筆（`server/auth.ts:256-260,302-304`、`worker/app.ts:107`）。命中時錯誤簽章直接 401，不認領、不讀鏈。它只會讓錯誤簽章更早被拒，不會讓任何簽章通過。

## 測試如何使用這份 schema

`tests/d1-sqlite.mjs` 把 `migrations/` 內的 SQL 依編號順序原封不動套到 `node:sqlite` 記憶體資料庫，並提供與 D1 相同的 `prepare／batch` 介面（batch 為單一交易）；可以只套用前幾個 migration，用來測試「程式先於 0003／0004 部署」的情況（`tests/auth.test.mjs`「deployed before migrations/0003…」、`tests/ownership.test.mjs`「deployed before migrations/0004…」）。所有登入與所有權測試都跑在這四個真 migration 上。本機 SQLite 與正式 D1 的查詢計畫可能不同；`EXPLAIN QUERY PLAN` 的斷言只證明在 `node:sqlite` 上的行為。
