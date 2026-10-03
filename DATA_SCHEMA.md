> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# DATA_SCHEMA：D1 資料結構

本快照來源為 `c491ff3`；目前部署紀錄列出的 Worker 為 `acdbb2bd`、部署來源為 `ddb10e2`。以下以公開的 `source/migrations/0001`–`0006` 與 Worker 程式為準，沒有正式資料列。部署方自述六個 migration 已套用到正式 D1；本次未查詢正式 D1，無法確認執行中的 schema 或資料。見[部署證據](source/docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md)第 26–40 行及 [DEPLOYMENT_MATCH.md](DEPLOYMENT_MATCH.md)。

`DB` 綁定一個 D1 資料庫（`source/wrangler.jsonc:62–63`）。時間欄位採 epoch 毫秒整數；登入地址以小寫儲存，回應可轉成 checksum 格式。帳號、資料庫識別碼及部分註解的遮蔽見 [REDACTIONS.md](REDACTIONS.md)。

## 0001–0005：登入、席位紀錄與索引預算

以下 migration 檔案均位於 `source/migrations/`。

| 資料表 | 欄位與約束 | 公開來源 |
|---|---|---|
| `login_challenges` | `nonce` 主鍵；`address`、`origin`、`flow_hash`、`message`、`issued_at`、`accept_until` 必填；`used_at`、`invalidated_at`、`session_hash` 可空。後續增加可空的 `net`、`checked_at`、`called_at`、`sub`、`called_via`。儲存伺服器 SIWE 訊息及一次性狀態；flow／session token 只保存 SHA-256。 | `0001_wallet_login.sql:1–8`；`0002_sign_in_budgets.sql:5–12`；`0003_sign_in_layers.sql:14–22`；`0005_lanes_and_subnets.sql:6–14` |
| `sessions` | `token_hash` 主鍵；`address`、`chain_id`、`created_at`、`expires_at`、`nonce` 必填，`nonce` 唯一；`revoked_at` 可空。後續增加可空的 `wallet_type`、`verification_method`，只作登入驗證紀錄。 | `0001_wallet_login.sql:9–14`；`0002_sign_in_budgets.sql:13–14`；`0003_sign_in_layers.sql:5–13` |
| `seat_presence` | `token_id` 主鍵；`owner` 可空，`last_online_at`、`updated_at` 必填。紀錄名冊曾列為線上的席位；owner 是當時名冊資訊，不能授予 NFT 或房屋權限。 | `0001_wallet_login.sql:15–19`；`server/presence.ts:4–7,20–25` |
| `index_candidates` | `address` 主鍵；`ids`、`read_at` 必填。ids 是最多 256 個 token id 的 JSON 候選清單；仍須逐一用 `ownerOf` 證明所有權。較舊回答不能覆蓋較新回答。 | `0004_index_candidates.sql:5–12`；`server/ownership.ts` |
| `index_lanes` | `net`、`at` 必填，`sub` 可空；以網路及時間索引計算 D1 預算。IPv4 網路為 /24、IPv6 為 /48，IPv6 sub 為 /64。 | `0005_lanes_and_subnets.sql:15–20`；`worker/app.ts:90–103` |

0002–0005 的 SQL 只增加欄位、資料表或索引，未修改或刪除原有資料列。程式中的舊 schema 降級路徑不能取代正式 migration 套用證據。

## 0006：八張會員資料表

`0006_members.sql` 新增以下八張表、索引及七筆 system 名稱保留列，未改動 sessions 或其他既有表。八張表的完整 SQL 全部公開，包括 economy_accounts 與 life_state。遮蔽的是內部規格引用及註解；欄位、約束、預設值與執行語義保留。

| 資料表 | 欄位與約束 | `source/migrations/0006_members.sql` |
|---|---|---|
| `members` | `member_id` 主鍵；隨機 `public_member_id` 唯一且必填；state 僅允許 active；created_at、updated_at 必填。內部 id 為 m_ 加 32 hex；公開 id 為 u_ 加 20 隨機字元，未由地址或地址雜湊衍生。 | 第 12–20 行；產生器見 `server/member.ts:31–36` |
| `wallet_identities` | wallet_identity_id 主鍵；member_id 唯一並參照 members；identity_key 唯一；chain_namespace 固定 eip155、chain_id 固定 1；normalized_address 限 42 字元小寫 hex；verified_at、last_login_at、created_at 必填，status 固定 active。另檢查 canonical key 及 namespace／chain／address 唯一性。 | 第 22–40 行 |
| `member_profiles` | member_id 主鍵並參照 members；display_name、active_name_key、avatar_key 可空，active_name_key 唯一；狀態為 needs_name／ready／needs_rename／locked；version 預設 0，名稱變更時間可空，建立／更新時間必填。ready 必須有名稱與 name key。 | 第 42–59 行 |
| `nickname_claims` | name_key 主鍵；類型為 active／reserved／system／quarantined；member_id 參照 members，reserved_until、reason 可空，建立／更新時間必填。system 恰好沒有 member；reserved 恰好有期限；每 member 至多一個 active claim。 | 第 61–78 行 |
| `profile_requests` | member_id／request_id 複合主鍵；payload_hash、outcome、建立／到期時間必填；result_version 可空，但成功 ok 必須有版本。用於重試與會員寫入預算。 | 第 80–97 行 |
| `profile_history` | history_id 整數主鍵；member_id 參照 members；actor 限 self／admin，kind 限 initial／rename／moderation；新舊名稱、理由可空，版本、時間與到期時間必填。 | 第 99–113 行 |
| `economy_accounts` | member_id 主鍵並參照 members；settled_balance、reserved_balance、available_balance、ledger_version 為必填整數、預設 0；updated_at 必填。 | 第 115–123 行 |
| `life_state` | member_id 主鍵並參照 members；life_number 預設 1；state 預設 not_started、允許 not_started／alive／dead；started_at、last_valid_world_entry_at、death_at、revive_cost_at_death、revived_at、new_life_at 可空；version 預設 0，updated_at 必填。 | 第 125–139 行 |

第 141–150 行插入七筆保留名稱。伺服器與表單共用名稱驗證：NFKC 後採漢字、ASCII 字母、數字與底線，長度 2–20 個 grapheme；原始輸入最多 256 bytes、正規化名稱最多 128 bytes。唯一 key 將 ASCII 大寫改成小寫；控制字元先拒絕，保留名稱另以 skeleton 規則辨識（`src/world/memberName.ts:4–5,14–44,47–76`）。

## 現行讀寫與保留期限

- Bootstrap 只從有效 session 取得地址；初次呼叫以一個 D1 batch 建立 member、wallet identity、profile、零值 economy row 及 not_started life row。唯一 identity 的競態失敗會讀回已建立的會員（`server/member.ts:135–154`）。
- 本版讀取 economy 的 available／reserved 及 life 的 state／life number，回給自己的 profile。除 bootstrap 初始化外，Worker 閉包沒有這兩表的更新或狀態推進程式；life_state 欄位保留，本版沒有啟用生命週期功能（`server/member.ts:60–73,145–151`）。
- 改名採 expectedActorPublicId、expectedProfileVersion 與 requestId。D1 batch 以成功紀錄的版本 CHECK、唯一 name claim 及 profile 版本防止競態；同 request 的不同 payload 回 IDEMPOTENCY_CONFLICT（`server/member.ts:163–237`）。
- 改名冷卻為 7 天，舊名稱為原會員保留 30 天。profile_requests 期限為 1 天、profile_history 為 180 天；由該會員後續成功名稱寫入清理到期資料，並非到期瞬間刪除（`src/world/memberName.ts:5`；`server/member.ts:28,211–223`）。
- Cron 每 15 分鐘記錄完整線上名冊並清理登入資料：未使用 challenge 超過發出後 10 分鐘、已使用 challenge 超過接受期限後 1 天、session 到期超過 1 天；index candidates 保留 8 天，index lane 超過 1 分鐘可清理。實際刪除取決於 cron；seat_presence 不刪除（`wrangler.jsonc:65–66`；`server/presence.ts:29–66`）。
- 會員讀取至多每小時更新一次 last_login_at；公開名稱 API 不回歷史或 claims。人工名稱處置腳本產生 rename／lock／unlock SQL，沒有 HTTP 管理路由（`server/member.ts:122–133`；`scripts/member-moderate.mjs:15–37`）。

## 驗證範圍

本次公開 subset 加替身：341 tests、337 pass、4 fail；M1 聚焦測試 33/33 通過。指令、輸出及失敗原因見 [TESTS/README.md](TESTS/README.md)。本機 SQL／mock 不證明正式 D1 內容、migration 套用或資料保留時間；本次未讀正式資料列。
