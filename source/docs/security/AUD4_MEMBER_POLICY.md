# AUD4：會員寫入授權、原子額度與紀錄清理

範圍：R4-03、R4-04、R4-05，Web2 M1 會員資料。這份文件說明隔離分支的修正；沒有宣稱已部署或正式 D1 已套用。
不包含 Coin E1、0007、Genesis Mint、鏈上交易或任何新錢包簽署流程。

## 寫入授權

- 只有伺服器 session 的 `wallet_type=EOA` 且 `verification_method=ECDSA` 可以 POST bootstrap、PUT profile，以及 GET profile 的每小時 `last_login_at` 更新。
- CONTRACT/ERC1271、未知值、缺少驗證欄位的舊 session 一律禁止 persistent member writes，回 `403 CONTRACT_WRITE_NOT_ENABLED`。使用者需以正常 EOA 驗證建立符合政策的新 session；不得由客戶端提供類型或改 cookie。
- 合約／未知 session 的登入、現有 profile 與公開名稱讀取保留。GET 沒有會員時仍為 `404 MEMBER_NOT_FOUND`，不自動建立。已有會員的 GET 不更新 last_login，不觸發清理。
- 合約通過登入用 SIWE 的 ERC-1271 檢查，不表示後續任意會員資料修改有持續授權。這輪採暫停寫入政策，不宣稱已支援每次 intent 簽章。
- 會員名稱仍不授予席位／房屋權利；權利仍由原 session 地址與 ownerOf／eligibility 決定。
- 所有會員端點只讀 session cookie，不新增／清除 cookie。拒絕仍受原 Origin、驗證與 IP limiter 邊界約束。

## 每位會員每分鐘五次：由資料庫保證

新增 `0008_member_hardening.sql` 的 `profile_requests_write_budget` BEFORE INSERT trigger，將額度判定與新 request outcome 插入放在同一 SQL statement。
視窗為新 attempt 的 server time 往前 60 秒，`created_at > now-60000`，索引 `profile_requests_recent(member_id,created_at)`，最多讀五筆即可判定。
第六個不同 requestId 無法插入，SQLite `RAISE(ABORT,'MEMBER_WRITE_RATE_LIMIT')` 令整個成功 batch 回滾；API 回 `429 NAME_RATE_LIMITED`、`Retry-After: 60`。

計入的是通過 body、session、actor 與名稱格式檢查後，會保存 outcome 的有效邏輯 attempt：成功變更、名稱不可用、版本衝突、cooldown、locked，以及同名 no-op。
錯誤格式、未登入、跨帳號表單等在進入該紀錄前拒絕，沒有寫入 outcome。bootstrap／GET 不花名稱 attempt 額度；原每 IP 20/min member limiter 仍獨立適用。

同名 no-op 是本輪明示的語意細化：新 requestId 保存 `ok` 並花一個 slot，但不改名稱、profile version、cooldown 或 history。SQL 同時檢查 expected version、display_name 與 ready 狀態，避免舊讀值在其他修改後被記成成功。

成功變更仍在一個 D1 batch 裡完成：request outcome/version guard、唯一名稱 claim、history、profile update。版本／名稱競爭失敗時全部回滾。
回滾後補拒絕紀錄亦受同一 trigger；若期間額度已滿，回 429，不能忽略 insert 失敗後回假拒絕。一般 storage error 回 `503 PROFILE_UNAVAILABLE`。

## 相同 requestId

`(member_id,request_id)` 是唯一 key。既有 key 在 trigger 中不另計額度，交由 PK 衝突與 server reread 判定：

- 相同 payload hash：原成功回當前 profile；原拒絕回原 outcome。重試不再改 cooldown／version／history，也不再占新 slot。
- 不同 hash：`409 IDEMPOTENCY_CONFLICT`。
- 同 key 的新請求並發，即使拒絕使用 INSERT OR IGNORE，也必須重讀真正落盤的 winner，不能回尚未保存的本地判斷。
- 沒有新增 pending outcome、租約或暫存成功。response body 遺失／傳輸不確定時，客戶端保留相同 payload/requestId 重試；不得自行以新 key 猜測再送。
- 冪等保證以尚未被清理的 request 紀錄為界；到期且清理後不承諾舊 key 重放。

## 0008 前置與回退界線

0008 的 M1 部分是附加 trigger 與兩個 expiry index，依賴 0001–0006；同份 migration 另新增獨立 discovery probe table／indices，見 AUD4_DISCOVERY.md。刻意跳過不在本輪的 Coin 0007，不新增經濟欄位。
寫入前使用 D1 官方支援的 `sqlite_master` 查 trigger/index 的 name/type；缺任一物件，persistent bootstrap/PUT 回 503，EOA GET 仍讀資料但不 touch last_login。
Cron 缺遷移時回報 `schema_unavailable` 並跳過清理；沒有 DB binding 時直接跳過。正式遷移與部署需要另外的授權及 backup／驗收，本輪不執行。

## 有界清理與實際保留語意

- request 一日、history 180 日的 expires_at 是「可清理時間」，不是硬刪除 deadline。
- `profile_requests_expiry(expires_at,member_id,request_id)` 與 `profile_history_expiry(expires_at,history_id)` 支援全域到期範圍掃描。
- 每 15 分鐘既有 cron 獨立啟動 cleanup；每輪每表最多 200 列、同一 batch，並依 expiry/key 排序。大量 backlog 需多輪排空，不會在單次掃描／刪除全部資料。
- 合格 EOA 的 bootstrap／PUT 在執行業務操作前也清理，每表最多十列。成員再也不改名，cron 仍能清掉過期紀錄。
- 未到期的 idempotency row 不刪除。清理不改當前 profile／version／claims／member／session；不新增 API 可讀 history。
- 清理 log 只含 status、刪除數量。失敗固定 `unavailable`；沒有 raw SQL、例外內容、地址、名稱或 secret。

容量限制：cron 的最大 drain 為每表 200×96=19,200 列／日（另外有 opportunistic cleanup）。資料大量持續流入時到期 backlog 可能累積；需觀察實際數量，另行調整批次／排程並驗證 D1 成本與執行限額。

## 本機驗證與限制

`tests/aud4-member-server.test.mjs` 使用真 Worker、node:sqlite 及真 0001–0006＋0008 SQL，涵蓋 permissive ERC-1271／unknown 讀寫政策、缺 0008、6/12/20 並發 attempt、同 key 同／異 payload、success/refusal winner、quota fallback、no-op guard、bounded cleanup／cron／index。
`tests/member.test.mjs` 保留原 M1 回歸案例；手工 mixed-case fixture 明示 EOA/ECDSA，pre-0006 fixture 明確排除其後遷移。
本輪最後整合區測試三檔合計 58/58 通過（24 個新 server/probe＋20 個原 member＋14 個 presence）；TypeScript `tsc --noEmit` 通過，git diff whitespace check 通過。完整最終回歸另見隨附修正證據。
這些驗證沒有正式 D1/WAF runtime、真錢包或正式網站證據；正式部署須另外驗收。

## Primary references

- [Cloudflare D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/)：batch statements 依序執行，某一 statement 失敗時整個 sequence 交易回滾。
- [Cloudflare D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)：支援 `sqlite_master` 查表、索引與 schema SQL。
- [Cloudflare D1 limits](https://developers.cloudflare.com/d1/platform/limits/)：每個 D1 database 的查詢逐一處理，不能以跨請求 read-count/insert 代替原子 reservation。
- [SQLite CREATE TRIGGER / RAISE](https://www.sqlite.org/lang_createtrigger.html)：`RAISE(ABORT, literal)` 以指定 constraint message 終止目前 statement；配合 D1 batch 回滾，額度與業務修改一致。
