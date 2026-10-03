# 正式 D1 migration 與 schema 讀回

這份文件記錄本次 R4 / AUD4 部署準備中已完成的正式 D1 操作。維護者執行遠端操作後，另以只讀方式核對操作前後的結構化查詢結果。這是團隊提供的正式 schema 證據；沒有執行正式會員寫入、並發負載或限流測試。

## 已完成的操作

| 項目 | 結果 |
|---|---|
| 正式資料庫 | `imd-world` |
| migration 前備份 | completed；內容與儲存位置不公開 |
| 操作前 migration list | `0001`–`0006` 六份，查詢成功 |
| 操作前六個新 schema objects | 均不存在，查詢成功 |
| 本次套用 | `0008_member_hardening.sql` |
| 操作後 migration list | `0001`–`0006` 加 `0008`，共七份，查詢成功 |
| 操作後 schema 讀回 | 六個 objects 均存在；名稱、類型與 SQL 定義全部符合公開 `0008` |

操作後讀回的 migration names 為：

- `0001_wallet_login.sql`
- `0002_sign_in_budgets.sql`
- `0003_sign_in_layers.sql`
- `0004_index_candidates.sql`
- `0005_lanes_and_subnets.sql`
- `0006_members.sql`
- `0008_member_hardening.sql`

`0007`（Coin E1）沒有列於本次遠端 migration 讀回，也不屬於本次 World / Auth / M1 變更。

## 六個 schema objects 的核對

參考來源為 [公開 migration 0008](../source/migrations/0008_member_hardening.sql)。將查詢傳回的 SQL 與來源對應的 `CREATE` statement 比較時，只正規化空白與最末尾分號；其餘 SQL 內容及類型相同。六項全部符合。

| 名稱 | 類型 | 0008 起始行 | 讀回結果 |
|---|---|---:|---|
| `profile_requests_write_budget` | trigger | 4 | 存在；SQL 符合 |
| `profile_requests_expiry` | index | 19 | 存在；SQL 符合 |
| `profile_history_expiry` | index | 20 | 存在；SQL 符合 |
| `index_lane_probes` | table | 25 | 存在；SQL 符合 |
| `index_lane_probes_net` | index | 33 | 存在；SQL 符合 |
| `index_lane_probes_expiry` | index | 35 | 存在；SQL 符合 |

`profile_requests_write_budget` 對新 logical request 檢查該 member 過去 60 秒最多五筆紀錄，超額時以 `MEMBER_WRITE_RATE_LIMIT` 拒絕；已有相同 member／request ID 仍由既有冪等流程處理。兩個會員 expiry indexes 支援有上限的清理。

`index_lane_probes` 保留獨立的 30 秒探測退避；欄位為 `scope_key`、`net`、`sub`、`probed_at`、`expires_at`，且 `expires_at = probed_at + 30000`。兩個索引分別支援網段 gate 與 expiry 清理。探測紀錄不加入 `index_lanes` 的 admitted global capacity。

## 證據界線

這次查詢證明遠端 migration list 與六個 schema definitions 已存在且符合來源。沒有用正式資料製造五次／第六次寫入、並發請求或 expiry backlog，也沒有驗證 cron 已實際清除正式紀錄。既有本機五次／第六次拒絕與回歸測試仍是本機證據；正式 D1 的並發排程、負載、額度與清理吞吐仍未由本頁驗證。

Worker version、流量分配、部署紀錄與低頻 live GET 的結果依本次 [build／deployment evidence](BUILD_EVIDENCE.md) 分別記錄；D1 套用成功本身不推定這些項目已完成。binding、WAF、Cloudflare limiter 計數與真實錢包／完整瀏覽器行為也不由 schema 讀回證明。

`source/docs/security/AUD4_MEMBER_POLICY.md`、`AUD4_REMEDIATION.md` 及既有本機測試文件描述修正實作階段，其中「未部署／未操作正式 D1」的句子屬於該階段的紀錄。正式 D1 的本次現況以本頁為準。第四次 snapshot 的根目錄文件及原始外部 Audit／Report 維持各自的歷史版本與驗證界線。

本頁只摘錄 migration names、schema names／types 及 SQL 比對結果；不附 raw backup、raw 查詢 log、正式資料、資料庫識別 UUID、帳戶識別、憑證或本機路徑。
