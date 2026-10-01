# DATA_SCHEMA：D1 資料結構（去敏）

來源：`source/migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql`、`0003_sign_in_layers.sql`、`0004_index_candidates.sql`、`0005_lanes_and_subnets.sql`（本快照的全部 migration）。這五個檔名與正式部署來源 `2e4e830` 的部署證據頁所列相同，`0002`–`0005` 的 SHA-256 也與證據頁相同（`source/docs/security/deploy-evidence/20261001T040934Z-2e4e830.md:26-35`）；`0001` 因遮蔽而不同（見 `REDACTIONS.md`）。本檔**不含任何正式資料列**；本輪的驗證沒有查詢正式資料庫（沒有 `wrangler d1 … --remote`），所以正式 D1 的 schema 是否與這五個 migration 完全相同，只能以 repo 與團隊端說明為準（未驗證，reviewer 應自行判斷）。團隊端說明：

- 0003 在部署 `f9b68223`（2026-09-28 21:05 UTC）之前、先匯出備份後套用到正式 D1，並從 `d1_migrations` 與 `sqlite_master` 讀回確認。
- 0004 在部署 `1a0dd495`（2026-09-29 19:54 UTC）之前、約 19:53 UTC、先匯出備份後以 `wrangler d1 migrations apply imd-world --remote` 套用；之後 `wrangler d1 migrations list imd-world --remote` 回答 "No migrations to apply"，遠端資料表清單包含 `index_candidates`（`source/docs/security/deploy-evidence/20260929T195417Z-4321bb4.md:26-38`）。
- **0005** 在部署 `bbf24001`（2026-10-01 04:09:34–04:10:24 UTC）之前、約 04:09 UTC、先匯出備份後以 `wrangler d1 migrations apply imd-world --remote` 套用；之後 `wrangler d1 migrations list imd-world --remote` 回答 "No migrations to apply"，並讀回資料表 `index_lanes`（含索引 `index_lanes_net`、`index_lanes_at`）與欄位 `login_challenges.sub`、`login_challenges.called_via`（`source/docs/security/deploy-evidence/20261001T040934Z-2e4e830.md:37-39`）。

資料庫：Cloudflare D1 `imd-world`，binding `DB`。repo 內只有這個 Worker 綁定它（`wrangler.jsonc:63`；database_id 已遮蔽，見 `REDACTIONS.md`）。時間一律是 epoch 毫秒整數，地址一律小寫 hex。

## Migration 0005（本版新增，只增不改）

`0005_lanes_and_subnets.sql` 是 Swarm audit 8c3aea2e 的 N-4／N-5／N-6 用的：只新增兩個可為 NULL 的欄位，與一張帶兩個索引的新表，不改也不刪任何既有表或列；0005 之前的程式從不提到它們（`source/migrations/0005_lanes_and_subnets.sql:1-5`；`tests/presence.test.mjs`「0005 is additive: on a live 0004 database every row of every table stays as it was, the new columns are empty, index_lanes starts empty, and the 0004 statements still run」）：

```sql
ALTER TABLE login_challenges ADD COLUMN sub TEXT;
ALTER TABLE login_challenges ADD COLUMN called_via TEXT;
CREATE TABLE index_lanes(net TEXT NOT NULL, sub TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS index_lanes_net ON index_lanes(net, at, sub);
CREATE INDEX IF NOT EXISTS index_lanes_at ON index_lanes(at);
```

（`source/migrations/0005_lanes_and_subnets.sql:11,14,18-20`；各欄位的用途寫在同一檔 `:6-10,12-13,15-17` 的註解。）

- `login_challenges.sub`（N-5）：IPv6 時，要求這個 challenge 的用戶端所在的 /64；讓一個 /48 底下各 /64 的 ERC-1271 認領與合約查核可以分開計數，而且依「要 challenge 的那個 /64」計數，不看是誰送出 verify。永遠不含 host bits，不建索引。見下方「login_challenges」。
- `login_challenges.called_via`（N-4）：已認領的合約查核是經共用份額（`'pool'`）還是經 lane（`'lane'`）進來的，讓 lane 只計 lane 查核。0005 之前的列為 NULL，照舊規則算作 lane。
- `index_lanes`（N-6）：每個網段的 NFT 索引「探索 lane」的計數表。見下方「index_lanes」。

**程式先於 0005 部署時沿用 0004 的規則**（團隊的部署順序是先套 migration 再部署程式；`source/migrations/0005_lanes_and_subnets.sql:3-5`）：

- challenge：帶 `sub` 的 `INSERT_CHALLENGE` 在沒有該欄位的資料庫上失敗，錯誤訊息符合 `SCHEMA_0004`（只認 `sub`／`called_via` 欄位不存在，其他錯誤照樣丟出），整個 batch 回滾（什麼都沒讀、沒寫），改用 0004 的 `INSERT_CHALLENGE_0004`，網段上限也回到 0004 的數字（一個 IPv6 /48 等同一個 /24 的 30）（`server/auth.ts:172-179,436-445`）。
- verify：第一個 ERC-1271 認領同樣失敗一次（回滾）後，這個請求改用 `CLAIM_ERC1271_0004`、`CLAIM_CONTRACT_0004`、`CLAIM_LANE_0004`，倍率為 1（`server/auth.ts:217-226,477-496`）。
- `/api/me/home`：`INDEX_LANE` 的任何錯誤都當作沒有 lane，讀取維持 `recheck:'limited'`，不回 503（`server/auth.ts:618-624`）。
- cron：`PRUNE_INDEX_LANES` 在主要 batch 之後以自己的敘述執行，失敗時 `lanesPruned: null`，不影響在線紀錄與其他清理（`server/presence.ts:26-28,45-50,59-61,65`）。
- 測試：`tests/auth.test.mjs`「N-5 (deployed ahead of 0005): challenges and ERC-1271 sign-in keep the 0004 rules and never answer 503; once 0005 is applied the new rules hold」、`tests/ownership.test.mjs`「N-6 (deployed ahead of 0005): no lane, and a refused read is limited as before, never 503」、`tests/presence.test.mjs`「N-6: the cron deletes index-lane rows older than a minute … a database before 0005 is left alone」。

## Migration 0004（上一版，只增不改）

`0004_index_candidates.sql` 只新增一張表，不改也不刪任何既有表或列；0004 之前的程式從不讀它（`tests/presence.test.mjs`「0004 is additive: on a live 0003 database every row of every table stays as it was, and index_candidates starts empty」）：

```sql
CREATE TABLE index_candidates(address TEXT PRIMARY KEY, ids TEXT NOT NULL, read_at INTEGER NOT NULL);
```

（`source/migrations/0004_index_candidates.sql:12`；除主鍵外沒有其他索引，理由見 `:9-11` 與下方「清理」。）用途是 Swarm audit 519db624 的 A-2：把每個地址最近一次 NFT 索引的答案存在 D1，讓每個 Worker isolate 與據點都拿得到，而不是只有讀到它的那一個。

程式先於 0004 部署時：寫入與讀取這張表都會失敗並被忽略，行為退回「每個 isolate 只記自己的答案」；cron 的清理也獨立執行，不會讓在線紀錄或其他清理停下（`server/ownership.ts:162-163,174-175,183`、`server/presence.ts:41-42,59-61`；`tests/ownership.test.mjs`「deployed before migrations/0004: house reads, refused or failing index reads and the cron work as before the table」）。

## Migration 0003（更早，只增不改）

`0003_sign_in_layers.sql` 只新增可為 NULL 的欄位與索引，不改也不刪任何既有列；0003 之前的程式在 0003 之後仍可運作（`tests/presence.test.mjs`「0003 is additive: on a live 0002 database every row stays as it was…」）：

1. `ALTER TABLE sessions ADD COLUMN wallet_type TEXT`（`'EOA'`／`'CONTRACT'`，F-2）
2. `ALTER TABLE sessions ADD COLUMN verification_method TEXT`（`'ECDSA'`／`'ERC1271'`，F-2）
3. `CREATE INDEX sessions_erc1271 ON sessions(address) WHERE verification_method='ERC1271'`（部分索引：「已知智慧錢包」查詢最多讀一筆，永遠不碰該地址的 ECDSA session）
4. `CREATE INDEX sessions_live ON sessions(address, expires_at) WHERE revoked_at IS NULL`（部分索引：logout-all 只讀仍有效的 session）
5. `ALTER TABLE login_challenges ADD COLUMN called_at INTEGER`（ERC-1271 合約查核的時間，F-3）
6. `CREATE INDEX login_challenges_called_net ON login_challenges(net, called_at) WHERE called_at IS NOT NULL`
7. `CREATE INDEX login_challenges_called_address ON login_challenges(address, called_at) WHERE called_at IS NOT NULL`
8. `CREATE INDEX login_challenges_address ON login_challenges(address, issued_at, net)`（當初為 F-5 的每錢包冷卻與跨網段 surge 計數建立；A-6 已移除每錢包冷卻，現在由 surge 計數 `ADDRESS_COUNT` 與 logout-all 作廢該地址 challenge 的敘述使用）

wrangler 會把套用過的 migration 記在 `d1_migrations`，不會重跑。session INSERT 會寫 `wallet_type`，所以若 0003 沒有套用，verify 會回 503 `AUTH_UNAVAILABLE` 並寫一行 log（不會放行，`server/auth.ts:518-522`；`tests/auth.test.mjs`「deployed before migrations/0003…」）。

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
| `issued_at` | INTEGER NOT NULL | 0001 | 簽發時間；必須等於訊息的 Issued At。自 A-5 起在 request body 讀完之後才取時間 |
| `accept_until` | INTEGER NOT NULL | 0001 | 簽發 + 5 分鐘；必須等於訊息的 Expiration Time |
| `used_at` | INTEGER | 0001 | 被消耗的時間（一次性） |
| `invalidated_at` | INTEGER | 0001 | 作廢時間：被同一 flow 的新 challenge 取代、登出、登出所有裝置，或 verify 判定的失敗（驗簽失敗、ERC-1271 份額或預算被拒等） |
| `session_hash` | TEXT | 0001 | 消耗時產生的 session token 的 SHA-256 |
| `net` | TEXT | 0002 | 請求 challenge 的用戶網段：`net:a.b.c.0/24` 或 `net6:x:y:z::/48`，由 `cf-connecting-ip` 推導（`networkKey`，`worker/app.ts:74-78`）；**不存完整 IP** |
| `checked_at` | INTEGER | 0002 | 某次 verify 為了唯一一次 ERC-1271 查核而認領這個 challenge 的時間（`CLAIM_ERC1271`，`server/auth.ts:184-191`） |
| `called_at` | INTEGER | 0003 | 認領之後、確認地址有 code 並進入合約查核的時間：`CLAIM_CONTRACT`，或同一 batch 內的 `CLAIM_LANE`（A-1、N-4）（`server/auth.ts:192-216,490-497`） |
| `sub` | TEXT | **0005（本版）** | IPv6 時，要求 challenge 的用戶端所在的 /64：`net6:x:y:z:w::/64`，由 `subnetKey` 推導（`worker/app.ts:79-85,117-119`）；IPv4、IPv4-mapped 與未知的用戶端為 NULL。**永遠不含 host bits**，也不寫進 log（`server/auth.ts:48-50`）。寫入：`INSERT_CHALLENGE` 的 `?14`（`server/auth.ts:164-171,436-442`）。讀取：verify 的三個 ERC-1271 認領都用 challenge 列自己的 `sub` 計數，不看送出 verify 的請求（`server/auth.ts:184-216,477-496`，特別是 `:480`）。不建索引：只在網段計數本來就會讀到的列上讀。隨所屬的 challenge 列一起被 cron 刪除（未使用的最多約 25 分鐘，已使用的約一天；`source/migrations/0005_lanes_and_subnets.sql:6-10`） |
| `called_via` | TEXT | **0005（本版）** | 合約查核是怎麼被允許的：`'pool'`（`CLAIM_CONTRACT`）或 `'lane'`（`CLAIM_LANE`）（N-4，`server/auth.ts:197,212`），與 `called_at` 寫在同一列、同一次 UPDATE。只有 `CLAIM_LANE` 讀它：lane 只計 `called_via` 不是 `'pool'` 的查核；0005 之前的列為 NULL，照舊算作 lane（`server/auth.ts:201-216`）。隨所屬的 challenge 列一起刪除 |

索引：`login_challenges_flow(flow_hash, used_at)`（0001）；`login_challenges_issued`、`login_challenges_net`（0002）；`login_challenges_address`、`login_challenges_called_net`、`login_challenges_called_address`（0003）。0005 沒有在這張表上新增索引。

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

索引：`sessions_address(address)`（0001）、`sessions_expires(expires_at)`（0002）、`sessions_erc1271`、`sessions_live`（0003，部分索引）。本版 schema 未改。

## seat_presence（本版 schema 未改）

cron（每 15 分鐘）記錄 IMD `/workers` 名冊列為在線的席位。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `token_id` | INTEGER PRIMARY KEY | 席位編號 |
| `owner` | TEXT | 當時 IMD `swarm.owners[id]` 的地址（僅參考；所有權以 `ownerOf` 為準） |
| `last_online_at` | INTEGER NOT NULL | 最後一次被列為在線的時間 |
| `updated_at` | INTEGER NOT NULL | |

索引：`seat_presence_seen(last_online_at)`。這張表不刪除（`server/presence.ts:51-54`）。本版多了一個讀取者（N-3）：候選超過 256 個需要截斷時，排序前先讀一次 `owner = 此地址` 的在線紀錄（只查不在線的已註冊候選，主鍵查詢，最多候選數；同一次證明中 D1 保存的答案與要證明的候選共用這次讀取）（`server/ownership.ts:228-238,262-269`）。

## index_candidates（上一版新增，0004）

每個地址最近一次 NFT 索引（Alchemy `getNFTsForOwner`）的答案，只當作**候選**；每一個候選照樣由 `ownerOf` 證明，這張表不授予任何權利。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `address` | TEXT PRIMARY KEY | 地址（小寫）。只會是索引曾列出至少一個席位的地址 |
| `ids` | TEXT NOT NULL | JSON 陣列，最多 `CANDIDATE_CAP`（256）個十進位 token id，與要證明的候選用同一個排序截斷：會計入房子的席位（即時名冊顯示現在在線；超過 256 個時另加 24 小時內在此 owner 名下被記錄在線的，N-3）、其他已註冊 agent 的席位、其餘，各依編號（`server/ownership.ts:27,142-148,228-238,245`） |
| `read_at` | INTEGER NOT NULL | 那次索引讀取**開始**的時間（在 `chain:index` 預算通過之後取時鐘，不是請求開始的時間；`server/ownership.ts:134-137,243`、`server/auth.ts:625`）。較舊的答案永遠不會覆蓋較新的 |

誰寫、誰讀、誰刪：

| 動作 | 誰 | 敘述 | 條件與實作 |
|---|---|---|---|
| 寫入 | `GET /api/me/home`（`Ownership.proof`）每一次成功的索引讀取，包括經 N-6 lane 進行的那一次 | `KEEP_INDEX`（`server/ownership.ts:164-165`）：`INSERT … ON CONFLICT(address) DO UPDATE … WHERE excluded.read_at>=index_candidates.read_at` | 答案列出席位時 upsert；在回應送出之後以 `waitUntil` 執行，失敗不影響這次讀取（`server/ownership.ts:172-176,245`） |
| 刪除（單一地址） | 同上 | `DROP_INDEX`（`server/ownership.ts:166`）：`DELETE … WHERE address=?1 AND read_at<=?2` | 答案沒有列出任何席位時；所以拋棄式地址不會留下任何列 |
| 讀取 | 同上，只在索引讀取被拒或失敗時 | `READ_INDEX`（`server/ownership.ts:167`）：`SELECT ids,read_at … WHERE address=?1` | `chain:index` 預算拒絕（`Limited`）或索引讀取失敗（`OwnershipUnavailable`）時才讀；與本 isolate 自己保存的答案取較新者；只接受 1–80 位數字字串、最多 256 個（`server/ownership.ts:177-184,247-253`） |
| 清理 | cron（每 15 分鐘） | `PRUNE_INDEX`（`server/presence.ts:44`）：`DELETE FROM index_candidates WHERE read_at<?1`，`?1 = now - INDEX_KEEP_MS`（8 天，`server/presence.ts:43`） | 在主要 batch 之後以自己的敘述執行，失敗時回傳 `indexPruned: null`，不影響在線紀錄與其他清理（`server/presence.ts:26-28,59-61,65`）；`tests/presence.test.mjs`「A-2: the cron deletes index answers read more than 8 days ago…」 |

沒有資料庫時（Vite dev server）什麼都不讀也不寫（`server/ownership.ts:173,178`）。

## index_lanes（本版新增，0005）

N-6 的「探索 lane」計數表：`chain:index`（每個據點 20 次／分鐘）拒絕了一次 NFT 索引讀取、而且那次的答案沒有任何席位計入房子時，**發出 `/api/me/home` 請求的那個網段**可以自己再做一次索引讀取。這張表只記「哪個網段、哪個 /64、什麼時候取得了 lane」，不記地址、session 或任何回應內容，也不授予任何權利（`source/migrations/0005_lanes_and_subnets.sql:15-20`）。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `net` | TEXT NOT NULL | 請求的網段（IPv4 /24、IPv6 /48；`networkKey`，`worker/app.ts:74-78`）；沒有 IP 時是 `net:unknown` |
| `sub` | TEXT | IPv6 時請求的 /64（`subnetKey`，`worker/app.ts:79-85`），否則 NULL；不含 host bits |
| `at` | INTEGER NOT NULL | 這一列被寫入（lane 在 D1 被允許）的時間 |

索引：`index_lanes_net(net, at, sub)`（每個網段的計數，覆蓋索引）、`index_lanes_at(at)`（全站上限與 cron 的清理）。沒有主鍵。

誰寫、誰讀、誰刪：

| 動作 | 誰 | 敘述 | 條件與實作 |
|---|---|---|---|
| 寫入（同時計數） | `GET /api/me/home`，只在 `Ownership.home` 判定「預算拒絕、而且沒有席位計入」之後（`server/ownership.ts:281-288`） | `INDEX_LANE`（`server/auth.ts:230-236`）：`INSERT INTO index_lanes(net,sub,at) SELECT … WHERE` 該網段 60 秒內 < `netScale`（IPv4 /24：1；IPv6 /48：2，而且同一個 /64 不能有第二列）`AND` 全站 6 秒內 < `INDEX_LANE_BUDGET`（60，即每分鐘 600）（`server/auth.ts:227-229`） | 一個敘述完成計數與寫入，所以同時到達的請求也只有一個拿到；只有寫入成功（`changes === 1`）才接著問 `CHAIN_LIMITER` 的 `chain:index:lane` 鍵（fail closed）。鍵拒絕時，這一列仍留著（該網段這一分鐘的 lane 已用掉），這次讀取維持 `limited`。綁定值在 `server/auth.ts:621-624` |
| 讀取 | 只有 `INDEX_LANE` 自己的兩個計數 | 同上 | 網段計數最多讀 `netScale` 個覆蓋索引項，全站計數最多讀 60 個 `index_lanes_at` 項；所以表的大小不增加讀取量 |
| 清理 | cron（每 15 分鐘） | `PRUNE_INDEX_LANES`（`server/presence.ts:50`）：`DELETE FROM index_lanes WHERE at<?1`，`?1 = now - INDEX_LANE_KEEP_MS`（60 秒，`server/presence.ts:49`） | `index_lanes_at` 的範圍讀取，不是全表掃描（`server/presence.ts:45-48`；`tests/presence.test.mjs`「N-6: the cron deletes index-lane rows older than a minute…」以 `EXPLAIN QUERY PLAN` 固定）。在主要 batch 之後以自己的敘述執行，失敗時 `lanesPruned: null`（`server/presence.ts:59-61,65`） |

lane 取得後的索引讀取與一般讀取相同：結果照樣寫入 `index_candidates`（所以列出席位的屋主之後不必再走 lane），每個候選照樣由 `ownerOf` 證明；用戶端送來的任何東西都不是候選（`server/ownership.ts:281-288`）。索引讀取「失敗」（Alchemy 錯誤）而不是被預算拒絕時，不走 lane（`tests/ownership.test.mjs`「N-6: an index read that failed (the budget allowed it) takes no lane…」）。`INDEX_LANE` 的任何錯誤（0005 未套用、D1 失敗）都當作沒有 lane，也不會問 `chain:index:lane` 鍵（`server/auth.ts:618-624`）。

## 一次性、撤銷、到期、預算與清理

| 規則 | 實作 |
|---|---|
| challenge 預算 | `INSERT_CHALLENGE`：`INSERT … SELECT … WHERE (同網段 60 秒內) < 30 × netScale AND (全站 6 秒內) < 60 − 20 × [此網段 60 秒內已有 challenge]`，一個敘述完成計數與寫入；每個計數以 `LIMIT` 限制掃描量，`EXISTS` 最多讀一筆（`server/auth.ts:164-171`，綁定值在 `:433-442`）。A-6 已移除「同地址同網段 60 秒內 < 5」的每錢包冷卻；A-7 在全站 60／6 秒中保留 20（`FRESH_NETWORK_RESERVE`，`:152`）給 60 秒內沒有要過 challenge 的網段。**本版變更（N-5）**：IPv6 /48 的網段份額是 /24 的 `NET6_SCALE`（2）倍，即 60（`:155-159`），而且這一列多寫要求者的 /64（`sub`）。被拒時另讀 `REFUSAL_REASON`（`:180-181,443-445`）只為了寫 log |
| 同一地址的 surge 紀錄 | `ADDRESS_COUNT`（`server/auth.ts:183`）與 INSERT 同一個 batch（`:436-442`）；同一地址 60 秒內第 20 個起每個 challenge 寫一行 `auth_surge` log（`:449`）。只記錄，不拒絕 |
| nonce 一次性 | verify 在同一個 batch 內 `UPDATE … WHERE used_at IS NULL AND invalidated_at IS NULL AND accept_until > now` 再 `INSERT … SELECT`；只有 UPDATE 成功的那次會產生 session；`sessions.nonce UNIQUE` 為第二道鎖（`server/auth.ts:510-524`） |
| 驗簽失敗 | `UPDATE login_challenges SET invalidated_at WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL`（`server/auth.ts:468`）；之後同一 nonce 一律 409 |
| ERC-1271 一次性 | `CLAIM_ERC1271`：只在 `checked_at IS NULL` 而且同網段 60 秒內認領 < 10 × netScale（已知智慧錢包除外）時寫入 `checked_at`；**本版（N-5）** IPv6 另要求 challenge 的 /64（`sub`）在同一批列上 < 10。同一 batch 的 `BURN_UNCLAIMED` 在沒認領到時作廢它（`server/auth.ts:184-191,247,483-488`） |
| ERC-1271 合約查核 | `CLAIM_CONTRACT`：只在 `called_at IS NULL` 而且同網段 60 秒內 < 3 × netScale、IPv6 的 /64 < 3（本版，N-5）、同地址 60 秒內 < 2 時寫入 `called_at`，並寫 `called_via='pool'`（本版，N-4）（`server/auth.ts:192-200`） |
| ERC-1271 lane（A-1；本版改，N-4／N-5） | `CLAIM_LANE`，與 `CLAIM_CONTRACT` 同一個 batch：同地址的共用份額用完後，challenge 所屬網段仍可在 60 秒內對該地址做 lane 查核：/24 一次；IPv6 /48 兩次，而且要來自兩個不同的 /64（仍在該網段的合約查核份額之內：/24 為 3 次，IPv6 /48 為 6 次、每個 /64 為 3 次；`called_at IS NULL` 才寫），寫 `called_via='lane'`，計入獨立的 limiter 鍵 `chain:erc1271:lane`。本版起只有 lane 查核會用掉 lane（`called_via` 不是 `'pool'`），所以屋主自己先前的共用查核不再用掉它；但這一分鐘已自己做完該地址兩次共用查核的 /24（IPv6：/64）不能再取 lane（`server/auth.ts:201-216,271,490-497`）。兩者都被拒時另讀 `ADDRESS_CONTRACT_CHECKS`（`:237-239,498-499`）只為了寫 log |
| 已知智慧錢包 | `KNOWN_ERC1271`：`SELECT 1 FROM sessions WHERE address=? AND verification_method='ERC1271' LIMIT 1`（`server/auth.ts:243`）；session 保留到過期後一天，所以「已知」最長約 8 天 |
| 重送 | 已使用或已作廢 → 409 `CHALLENGE_USED` |
| challenge 到期 | `now >= accept_until` → 410（自 A-5 起 `now` 在 body 讀完後才取，`server/auth.ts:327-329,453,461`） |
| session 撤銷（此裝置） | `UPDATE sessions SET revoked_at WHERE token_hash=? AND revoked_at IS NULL`（`server/auth.ts:539`） |
| session 撤銷（所有裝置） | `REVOKE_ALL_SESSIONS`：`UPDATE sessions SET revoked_at=? WHERE address=? AND revoked_at IS NULL AND expires_at>?`（`server/auth.ts:246,554`）；同一 batch 作廢該地址過去 5 分鐘內與本 flow 未完成的 challenge（`:555-556`）。只設 `revoked_at`，不刪列 |
| session 到期 | `expires_at <= now` → `SESSION_EXPIRED`，並清除 cookie（`server/auth.ts:417`）。本版（N-7）起 `GET /api/auth/session` 對這種 cookie 回 `{signedIn:false, expired:true}`，對撤銷、未知、格式錯誤或沒有的 cookie 不說原因（`server/auth.ts:526-533`）；不讀寫任何新的資料 |
| 索引答案（A-2） | `KEEP_INDEX`／`DROP_INDEX`／`READ_INDEX`，見「index_candidates」 |
| 索引探索 lane（本版新增，N-6） | `INDEX_LANE`，見「index_lanes」 |
| 清理（cron） | `PRUNE_CHALLENGES`：`DELETE FROM login_challenges WHERE issued_at < now-10分鐘 AND (used_at IS NULL OR accept_until < now-1天)`；`PRUNE_SESSIONS`：`DELETE FROM sessions WHERE expires_at < now-1天`。兩者都是索引範圍讀取（`server/presence.ts:31-37,58`；`tests/presence.test.mjs` 以 `EXPLAIN QUERY PLAN` 固定）。`sub`、`called_via` 隨 challenge 列一起刪除。`PRUNE_INDEX`（8 天）刻意是全表掃描而不是索引範圍讀取，因為這張表只放索引曾列出席位的地址（程式註解估計最多幾千列，每天讀 96 次），而在 `read_at` 上加索引會讓每次 upsert 多寫一筆索引項（`server/presence.ts:38-44`）。本版新增 `PRUNE_INDEX_LANES`（60 秒，`index_lanes_at` 的範圍讀取，`server/presence.ts:45-50`） |

## D1 讀寫量（程式註解所述，reviewer 應自行判斷）

以下數字是程式註解的說法（`server/auth.ts:102-151`、`server/ownership.ts:157-161`、`server/presence.ts:38-50`），以 D1 計費的「列」計算：寫入時每改動一個索引項也算一列。團隊註明 `index_candidates` 的數字是在本機 workerd 的 D1 上量的；`index_lanes` 與 IPv6 的數字是註解的估算；本輪沒有重新量測。

| 動作 | 讀 | 寫 |
|---|---|---|
| challenge（1 個 batch） | INSERT…SELECT ≤ 91 個索引項（IPv6 /48 ≤ 121：網段計數、全站計數、判斷網段是否「新」的 1 項）；surge 計數 ≤ 21；被拒時另讀 ≤ 30（IPv6 ≤ 60）以寫出原因 | 1 列 + 5 個索引項（nonce、flow、issued、net、address）= 6（`sub` 在列內、不建索引，不多寫）；帶著舊 flow 時另作廢其未完成的 challenge（通常 0–1）。0005 之前：帶 `sub` 的 batch 立刻失敗並回滾（不讀不寫），改跑 0004 的敘述 |
| verify（ECDSA） | 以 nonce 讀 1 列 | 成功：challenge UPDATE 2（列 + flow 索引項）＋ session INSERT…SELECT 6（讀 1；token_hash、nonce、address、expires、live）；ERC-1271 session 多 `sessions_erc1271` = 7。失敗：1（作廢） |
| verify（ERC-1271 額外） | `KNOWN_ERC1271` ≤ 1；認領讀網段最近 6 分鐘的 challenge ≤ 180（IPv6 ≤ 360，並在同一批列上數 /64）；合約 `CLAIM_CONTRACT` ≤ 5、`CLAIM_LANE` ≤ 9（IPv6 ≤ 20、≤ 30） | 認領 1；合約查核由認領成功的那一個寫 1 列 + 最多 2 個部分索引項 = 3（`called_via` 在同一列內）；失敗時作廢 1。0005 之前：第一個認領失敗一次（回滾，不讀不寫），之後用 0004 的敘述 |
| `/api/me/home` | session 1；已證明席位的在線紀錄；候選超過 256 個時排序前另讀一次在線紀錄（N-3，主鍵查詢，最多候選數）；索引被拒或失敗時 `READ_INDEX` ≤ 1；被拒而沒有席位計入時 `INDEX_LANE` ≤ 2 個 `index_lanes_net` 覆蓋索引項 + ≤ 60 個 `index_lanes_at` 項；lane 取得後另有一次在線紀錄讀取 | 每次索引讀取（`chain:index` 或 lane）的 `KEEP_INDEX`：讀 ≤ 1、寫 1（新地址 2：列與主鍵）；`DROP_INDEX` 寫 0（真的刪到一列時 1）。`INDEX_LANE` 取得時寫 3（列與 2 個索引項），被拒時 0 |
| cron（每 15 分鐘） | 讀 10 分鐘前簽發、仍保留的 challenge（前一天內已使用的）；`PRUNE_INDEX` 掃描 `index_candidates`；`PRUNE_INDEX_LANES` 只讀要刪的範圍 | 每刪一列寫 1（`index_lanes` 每刪一列寫 3：列與 2 個索引項） |

程式註解的上限估算：

- `index_candidates`：`chain:index` 每個據點每分鐘 20 次（一個月 864 k 次索引讀取），在列已存在時約為每個據點每月寫 0.9 M 列，若每次都是新地址最多約 1.7 M 列（只有索引列出席位的地址會被保存，所以每個新地址都要真的持有席位）；upsert 另受索引 lane 約束（每個網段每分鐘 1 次、全站每分鐘 600 次）；讀取次數受每個地址每個 isolate 30 秒的證明快取與每個 session 的 `home` 限流約束（`server/ownership.ts:157-161`、`server/auth.ts:120-125`）。註解另說 lane 讓一個據點的索引讀取從每分鐘 20 次最多升到 40 次，而且只在有 20 個其他網段每分鐘在那裡取 lane 時（`server/auth.ts:135-137`）。
- `index_lanes`（N-6，`server/auth.ts:126-137`）：表中最多約 16 分鐘的 lane（cron 每 15 分鐘刪一次超過 1 分鐘的列），全站上限下約 9.6 k 列；計數只讀最近 1 分鐘與 6 秒的項，所以表的大小不增加讀取。一個網段整個月每分鐘都取 lane，約寫 259 k 列（約 $0.26；IPv6 /48 為兩倍）；一個長期存在的拋棄式 session 可以從它讀取的每個網段造成這個量。全站上限（每 6 秒 60、每分鐘 600）把 lane 限制在每月 25.9 M 次，約寫 155 M 列（若沒有其他寫入，超出包含的 50 M 後約 $105）；被拒的 lane 認領讀 ≤ 62、不寫（每分鐘 20,000 次持續一個月：約讀 54 bn 列，約 $54）。
- 登入部分：一次成功登入約寫 13 列、讀 5–91 列（`server/auth.ts:138-139`）；在全站閥門持續全開一整個月的最壞情況下，註解估算的費用與容量見 `server/auth.ts:140-151`。本版在其中加上 IPv6 的數字（每個被接受的 challenge 讀 ≤ 143、被拒的請求讀 ≤ 202；若閥門下每個 challenge 都是 IPv6 而且 verify 要 ERC-1271 認領，認領每月約讀 9.3 bn 列，IPv4 為 4.7 bn）（`server/auth.ts:143-147`）。

## 快取（不在 D1）

- 所有權證明 30 秒、候選 5 分鐘（`fresh` 30 秒）、公開資產清單 5 分鐘，全部是每個 Worker isolate 的記憶體 LRU（上限 512 個地址）（`server/ownership.ts:24-27`）。自 A-2 起，重新載入失敗時，快取會放回上一個成功的值並保留它原本的時間，而不是刪掉（`server/ownership.ts:185-201`，特別是 `:196-197`），所以索引被拒時 `peek` 仍拿得到上一次的答案。所有權證明本身不會在 30 秒之後被沿用；N-6 的 lane 取得時，被預算拒絕而建立的證明會重建一次（`server/ownership.ts:222-224,260,287-288`）。跨 isolate 的部分由上面的 `index_candidates` 補上。
- **「沒有 code」快取**（F-3）：每個 Worker isolate 一份 `Map`，記住 `eth_getCode` 剛回「沒有 code」的地址 60 秒，上限 4,096 筆（`server/auth.ts:340-344,386-388`、`worker/app.ts:114`）。命中時錯誤簽章直接 401，不認領、不讀鏈。它只會讓錯誤簽章更早被拒，不會讓任何簽章通過。

## 測試如何使用這份 schema

`tests/d1-sqlite.mjs` 把 `migrations/` 內的 SQL 依編號順序原封不動套到 `node:sqlite` 記憶體資料庫，並提供與 D1 相同的 `prepare／batch` 介面（batch 為單一交易，任何錯誤都回滾）；可以只套用前幾個 migration，用來測試「程式先於 0003／0004／0005 部署」的情況（`tests/auth.test.mjs`「deployed before migrations/0003…」「N-5 (deployed ahead of 0005)…」、`tests/ownership.test.mjs`「deployed before migrations/0004…」「N-6 (deployed ahead of 0005)…」、`tests/presence.test.mjs`「0005 is additive…」）。所有登入與所有權測試都跑在這五個真 migration 上；以上各項在加替身的 `npm test` 中全部通過（`TESTS/npm-test-output.txt`）。本機 SQLite 與正式 D1 的查詢計畫可能不同；`EXPLAIN QUERY PLAN` 的斷言只證明在 `node:sqlite` 上的行為。
