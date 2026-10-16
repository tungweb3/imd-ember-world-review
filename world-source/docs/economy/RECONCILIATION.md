# 歷史 GOLD 差額與 EMBEO 付款對帳

這是新增金流的內部維運流程，尚未正式啟用。原 UTC 完整日、每十萬 EMBEO 一份、每日每份一 GOLD、隨時按整份解押等規則不變。沒有新增玩家／站主錢包的任意增減 GOLD 權限，沒有公開補帳 API，也不會透過此工具簽章、付款、退款、操作遠端 D1 或自動上線。

## 歷史差額計算

受控來源必須是原資料庫的離線備份，以及由既有 finalized header／receipt／log 驗證索引器，從更早區塊重建到**相同完整區塊身分與時間範圍**的獨立資料庫。不能接受玩家上傳事件或自己填入的「應得 GOLD」。既有 RPC ancestry/log 完整性信任假設仍存在，這不是額外的共識證明。

`prepareEconomyRecovery` 重新按事件計算每個 UTC 日／錢包的應得 share-day，不把重建庫的帳戶餘額或 reward journal 當作應得金額。原範圍的每個已接受事件必須完整保留且內容一致。兩端均不得有未完成 staging、未結算部分日或 halt。

應補 = 重建後應得獎勵 − 原來源及已核准祖先來源的歷史已發獎勵 − 歷次差額補帳。比較的是已賺獎勵，**不是扣款後的可花費餘額**。例如原已得1 GOLD、已花掉1 GOLD，重建後應得2 GOLD，只補1 GOLD，結果餘額1，不是補2。

只處理正差額。若已發超過應得、餘額與 journal 不符、舊證據遺失／改變或來源有歧義，停止並回報，不自動負數扣帳、改舊 journal 或碰本金。差額 journal 以原允許的 `utc-reward` 類別追加，另有不可變 `economy_gold_adjustments` 對應來源、日期、原已發、應得、差額及 recovery ID。玩家顯示為「歷史差額補帳」。

## 計畫、原子套用與設定切換

維運者先核對 plan hash、逐日差額與輸入備份指紋。套用時重新計算同一計畫，並在同一批次的第一個 SQL 比對原資料庫的全部經濟資料快照；若核對期間有消費、索引、結算、訂單或處置變動，整批拒絕。

一次 `db.batch()` 完成 recovery receipt、同付款合約的祖先設定關係、reward binding 切換、重建事件／持倉匯入、已結算日封口及正差額。原事件、journal、已扣款與不可變報價保留。原 pending 訂單若遇到合法晚到精確事件，可以正常更新 paid 與一次履約；這不是覆寫原報價。任一 SQL 失敗全部回滾，同一已成功 hash 重試只讀回同一 receipt。

重建設定的已完成歷史日封口，未來正常結算從下一完整日開始；第二次更早重建會計入祖先及既有 adjustment，不能再補一次。已退役設定不能新增訂單／GOLD 寫入或索引提交；結算頁也在最終 SQL 核對 binding。鏈上提領本金仍獨立，不增加站主扣款或救援權限。

只支援相同 chain/token/vault/**payment contract**/treasury，且往前調整 deploymentBlock。切換付款合約一律拒絕，因舊合約晚到訂單需要另行設計、複審與切換計畫；不能把本工具視為任意合約遷移器。實際 Worker 的固定設定切換仍是獨立受控發布，不由本工具完成。切換前應暫停新金流、核對舊單及備份；不重設鏈或刪除證據。

單次工程上限：5,000 個重建事件、366 日、16 個祖先來源、64 個 batch statements、每個快照／bound value 512 KiB、兩庫快照合計4 MiB。超限在任何寫入前拒絕，須另訂分批遷移及審查；不宣稱一般大型生產庫也符合限制。本機小型 D1 批次可重現，不代表正式 CPU／配額已驗證。

## 本機工具

Node24，固定 package lock。工具只讀輸入備份，所有修改都寫到新的副本目錄，輸入必須是離線且無 WAL 的 regular SQLite 檔案。D1 SQL export 須先在受控離線環境建立 SQLite；正式匯出、備份與套用需要另行操作授權，這裡不載入任何憑證。

```text
node scripts/economy-recovery.mjs migrate-copy --original before.sqlite --out migrated-copy
node scripts/economy-recovery.mjs plan --original migrated-copy/database.private.sqlite --rebuilt rebuilt.sqlite --from-config from.json --to-config to.json --now-ms TIMESTAMP --out plan-output
node scripts/economy-recovery.mjs stage --original migrated-copy/database.private.sqlite --rebuilt rebuilt.sqlite --from-config from.json --to-config to.json --now-ms SAME_TIMESTAMP --expected-plan REVIEWED_HASH --out staged-output
```

`from.json`／`to.json` 是經 `defineEconomyConfig` 重算身分的設定，不含 secrets。重建庫必須由受控 finalized 索引器產生並完成指定範圍結算，不能拿一般資料庫複製／任意 JSON 當鏈上證明。plan 與 stage 的時間及輸入須一致。

輸出包括 `recovery-plan.private.json`、`receipt.private.json`；stage 額外產生 `database.private.sqlite` 與 `migration-batch.private.json`。後者含真實錢包、訂單與資料庫快照，只能保留在私人維運證據中，**不得加入公開 Audit 包**。batch 是給內部已核准的 D1 binding runner 使用，不能把多次 HTTP／單條 SQL 執行當成同一原子交易。這個 CLI 沒有連遠端、執行 migration-batch 或替換正式資料庫的指令。

正式處理前要驗證實際來源、備份可還原、原子 batch 在目標 D1 的限制、差額與舊單對帳、確切程式／plan hash 及複審。正式套用後要讀回 receipt、binding、日封口、journal／餘額守恆、舊單與新增正差額。回復不能直接還原過期餘額而抹掉其後合法付款；遇到問題先停止新金流、保留 receipt，另擬追加式處置。

## 錯額與其他異常付款

新 finalized 付款在事件、cursor 與 fulfillment 的同一交易記錄 `economy_payment_cases`。staging 未完整 fold 前不可見。事實包括 chain、付款合約、tx、log index、block、payer、order、應付／實付、token、treasury 與分類。以 chain/payment contract/tx/log 去重，重建命名空間不能重複建立同一實際付款案件。

分類包括 matched、找不到訂單、付款人不符、來源不符、幣別不符、金額不符及額外付款。精確付款才可交付；錯額、陌生訂單與錯誤付款人不交付。錯額後的正確付款仍可完成一次，原錯額紀錄保留並連到正確 paid event；這不表示原錯額已退款或已結案。

玩家只能透過既有 SIWE 查自己的最近50筆異常；不是本人訂單不顯示其應付價或付款結果。頁面提示不自動退款／重送，並標示實付、本人訂單應付、正確付款是否確認、處置是否已記錄。GOLD與錯誤幣別訂單的金額不冒充 EMBEO 應付價。

既有原始事件可分頁補建案件，每頁256筆，重試冪等，不更動原事件、訂單或任何餘額。工具最多一次32頁，超限會明確失敗，可用自己的輸出副本作為下一輪輸入續跑，不接觸原備份。內部工具可匯出最多500案件，超過需另做受控分頁；玩家讀取仍有限制。

```text
node scripts/economy-recovery.mjs reconcile-copy --original upgraded.sqlite --from-config config.json --now-ms TIMESTAMP --out reconciled-copy
node scripts/economy-recovery.mjs cases --original reconciled-copy/database.private.sqlite --out cases-output
node scripts/economy-recovery.mjs disposition-copy --original reconciled-copy/database.private.sqlite --from-config config.json --now-ms TIMESTAMP --case EVENT_ID --request UNIQUE_REQUEST_ID --action acknowledged-no-entitlement --note-file decision.txt --out disposition-copy
```

處置僅允許追加說明或記錄「該異常款不交付」，同 request 不可改內容。它不扣款、不發 GOLD、不改訂單、不轉移 treasury 資金、不驗證／授予 treasury 控制權，也不能把使用者填的 tx hash 標成「已退款」。如果未來要退款，必須另行確認操作者權限、取得實際交易與驗證證據；本版不提供退款執行功能。

本工具沒有站主網頁端點。玩家或站主的普通 SIWE session 都不能透過 HTTP 呼叫補帳或處置。維運工具持有的是既有資料庫／檔案操作權限，文字備註不構成鏈上身分或不可否認簽章。

## 驗收與剩餘限制

回歸包含已花 GOLD 的正差額、第二次重建、UTC 午夜／日中／部分解押、另一合法 vault、祖先 GOLD 與晚到 EMBEO、過期計畫、錯誤 hash、並行更新、整批故障／重試、超發拒絕、資料遷移備份、300事件 staging、錯額與錯 payer 隱私、追加處置、API拒絕與元件顯示。完整 World與精確公開副本另有原生執行證據；實際結果以本版 receipts 為準。

此流程不是主網 preflight、正式 Cloudflare CPU／D1 容量、RPC log 完整性、真實錢包 nonce/replacement、正式 catalogue 或新合約 runtime/immutables 的驗證。這些與新確切 commit 的 Swarm 複審仍是正式開放條件。不得將本機通過改寫成正式上線或整個 World 已通過審計。
