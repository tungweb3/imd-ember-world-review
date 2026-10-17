# Audit 658db620 六項處置與驗收

基準 World e8afd02f、公開 ca2ed8a1，正式報告 1 Medium、4 Low、1 Info。以下是本機修復設計；實際執行總數與固定來源以新送審包的 manifests 和 evidence 為準。沒有新報告接受、主網合約部署、正式資料庫遷移或財務啟用。

| 編號 | 本機處置 | 可執行驗收 |
| --- | --- | --- |
| C-01 Medium | 從祖先的不可變 bootstrap recovery receipt 取得 predecessor；驗證 canonical registry、同域 receipt 鏈與歷史邊界，不刪保留前綴 | economy-audit4-recovery 的連續 C1→C2→C3、差額一次、重播、未來日、receipt 雜湊／來源／domain／缺欄位負控制；舊 Audit3 回歸 |
| C-02 Low | 每表 128 列快照，完整值與列數同批 guard，有界 UTF-8 匯入、全域事件順序、實際限制診斷與唯讀 preflight | 600 份既有 stake／601 重建事件；512 KiB 等號／加一；全域 metadata 成長／4 MiB；跨整頁新增造成原子回滾；CLI 兩份輸入 hash 不變、不產生可寫副本 |
| C-03 Low | 外部退役 progress 只在其 canonical 設定、receipt lineage 與現行 binding 相符時接受 | 先恢復 B 再恢復 A；B 原資料不變；偽造 receipt domain 仍拒絕 |
| C-04 Low | pending 語意檢查限定相關 staking domain；全表 snapshot guard 保留 | B 健康 staging 或 B 暫停前綴均不阻擋 A；最終批次前 B 變更仍整批拒絕 |
| C-05 Low | 同域非祖先只忽略具完整空狀態的同步 metadata | 空同步保留成功；event、未付款 order、legacy progress、pending footprint 各自拒絕；不刪設定或鏈狀態 |
| C-06 Info | 正確付款顯示待交付且請勿重付；例外另述；中性總說明與無自動退款／重送 | economy-pane 實際 JSX harness，中英文只有待交付／只有例外／混合，共六案例 |

## 不變量

事件重建權益減去實際 earned journal 與既有 adjustment，不以可花餘額或分頁 carry 補款。歷史證據、不可變報價、付款 facts、舊 journal 保留。所有信用、binding、lineage、歷史日封口與交付仍同一原子交易；過時 plan 與中途故障不部分寫入。舊版已成功 recovery hash 仍可讀回既有 receipt；新計畫使用 historical-recovery-v2 身分。

每十萬 EMBEO 一份、完整 UTC 日每日一 GOLD、按份取回及當日不計規則維持。GOLD 綁錢包，不可轉讓交易；沒有交易對、兌換、退款或新增任意補帳權限。Solidity、migration、登入與 Worker 啟用設定未因本輪修改。

## 容量與結案邊界

5,000 events、366 日、16 祖先、64 statements、512 KiB 每頁／值、4 MiB 兩庫總快照與 100 guard 參數都是同時適用的工程上限。實際能處理的事件數隨所有財務表與字串大小變動；事件數本身不能當作容量承諾。用 preflight 的相同 planner 驗證指定備份，再於 stage 重新檢查；超限是明確拒絕且不寫入。

指定 601-event 本機樣本的成功，只能結案舊整表 512 KiB 的可重現缺陷。實際 Workers CPU／D1、正式營運資料量及監測責任仍須於開放前確認。更大方案不得透過刪資料或不原子的分批套用規避。

## 送審要求

請獨立複核這六項的正負控制與互相影響，並重跑 Solidity、選取 TypeScript／D1／客戶端測試及原 A／B 歷史控制。不要以缺少新的 finding 取代既有不變量驗收，也不要把公開部分來源的測試當成完整私有 World 或正式環境容量證明。真實錢包、主網新合約 runtime／immutables、備份／遷移／catalogue／config／postflight 仍是獨立開放條件。
