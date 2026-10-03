# IMD Ember World：第四次送審用版本快照

這是 https://imdember.com 的登入、伺服器、資料庫結構、錢包面板及相關測試快照。它是公開審查的取材，不是審查報告、證書，也不替任何結論背書。

IMD Ember World 是社群自行推動的非官方專案，Identity.md 沒有經營或背書它。

本輪提出的問題是：上次審查後的登入與限流修正，以及新增玩家名稱功能，在目前的權限及失敗邊界下表現如何？**本 repo 不替這個問題下結論。**

## 1. 本次版本與歷史

| 項目 | 本次取材 |
|---|---|
| 正式網址 | https://imdember.com |
| Worker | `acdbb2bd-8add-4b15-bfa6-a31266c83520` |
| 部署 source | `ddb10e28a867998323164e7585635efedfcf7788` |
| 部署 tag | `v2026.10.03-acdbb2bd` |
| 快照 source | `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c` |
| 前次公開快照 | `8cad017fad58bac89d88fa72d530d3c56160009b` |
| Worker 重建 | 303,128 bytes；`cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518` |
| D1 migrations | 團隊部署紀錄為 0001–0006；本輪未查正式 D1 |

快照 source 比部署 source 多兩份文件變更：`docs/security/AUDIT_REMEDIATION_STATUS.md` 及新增的 M1 部署證據頁。Worker／前端的原始建置輸入沒有改動。公開 source 的遮蔽另列於 [REDACTIONS.md](REDACTIONS.md)。

| 公開歷史 | 當時 Worker | 相關外部 job |
|---|---|---|
| `c2a8c33` | `beac62be` | Report `4bd31cfb` |
| `b6e986b` | `50c688c9` | Audit `519db624`；Report `e48d0a96` |
| `ae1d41a` | `1a0dd495` | Audit `8c3aea2e` |
| `8cad017` | `bbf24001` | Audit `1ef8e8a6`；Report `dcf922ca` |
| 本次後續版本 | `acdbb2bd` | 本 repo 不包含本次外部審查結果 |

每份外部結果只屬於它審查的版本。兩份最近結果的完整 job 編號與原文位置，見 [原狀態文件](source/docs/security/AUDIT_REMEDIATION_STATUS.md) 的「Swarm reviews of Worker bbf24001」一節；上表使用短編號供辨識。

## 2. 自前次送審版本以來的變更

這次合併檢查兩組**尚未經外部重新審查**的變更：

1. `63c6c7bd` 加入前次 Report／Audit 發現的修正，以及團隊自己的追加檢查修正。該版本未做成公開審查 commit。
2. `acdbb2bd` 加入 M1 會員與公開玩家名稱；這一層從未經 Swarm 審查。

兩者之間及之前另有三次前端部署（`d5f52483`、`ef1a55fb`、`8269ae53`），涉及天氣、船站與上船操作。部署經過及 fingerprint 以 [DEPLOYMENT_MATCH.md](DEPLOYMENT_MATCH.md)、`source/docs/security/deploy-evidence/` 及 `manifests/compare.txt` 為準。部署紀錄是團隊的證據，不是審查結果。

### 前次發現的團隊自述現況

| 原編號 | 原等級 | 團隊自述狀態 | 請 reviewer 保留注意的邊界 |
|---|---|---|---|
| R3-R1 | Low | 已修正，未重審 | 換帳號的事件順序以合成錢包測試；缺事件時無法辨識往返同帳號；沒有本版真錢包驗證 |
| AUD3-01 | Low | 已修正，未重審 | 已送出的持有查詢仍花費該次鏈上額度 |
| AUD3-02 | Low | **部分修正** | 同一 location 約 80 次 index lane claims／6 秒仍可耗盡全域 lane ceiling；被拒絕 limiter 呼叫是否計次尚未驗證 |
| AUD3-03 | Low | 已修正，未重審 | 已送出的 `eth_call` 不論結果均計次；相同 limiter 假設未驗證 |
| AUD3-04 | Info | 已修正，未重審 | 登出完成前及被放棄流程晚到的 session 仍有顯示窗口 |
| AUD3-05 | Info | **部分修正** | session refresh 完成前保留先前登入顯示，屋主模式受另行限制 |
| AUD3-06 | Info | 已修正，未重審 | 晚到 logout 回應可能刪另一分頁新 cookie；本分頁最長等 5 秒 |
| AUD3-07 | Info | 已修正，未重審 | 瀏覽器先丟棄過期 cookie 時不能辨識到期原因 |
| AUD3-08 | Info | 已修正，未重審 | 未證明真實請求能形成原異常；`::1` 歸 `ip:unknown` |
| AUD3-09 | Info | 無修正項，限制記錄 | 外部 reviewer 原先無法檢查的環境仍需實際證據 |

詳細說明與原 T01–T41 矩陣在 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`。這份原狀態文件不是 M1 完整審查記錄；其中歷史「nothing deployed」或舊狀態要依本輪版本表解讀，不能用來否定 M1 已列於部署紀錄。ADV／ADVR／DR／RC／DOC／CF 是團隊自查，不是外部發現；末次修正後未再完整獨立複查。

### 新會員層 M1

M1 提供 `POST /api/me/bootstrap`、`GET/PUT /api/me/profile`、`GET /api/world/names/:address`，以及 migration 0006。會員由 session 的錢包地址定位，不由 request body 選擇目標地址。名稱不授予屋主權限，也不改房屋的持有依據。

名稱可由公開地址查詢；該連結是現有功能。寫入路由檢查 Origin、`member:` limiter 與 session。`GET /api/me/profile` 會最多每小時更新一次 `last_login_at`，所以不能稱所有 GET 完全不寫資料。請 reviewer 直接核對早期拒絕、每會員限流、重送、版本、冷卻、唯一名稱、batch 原子性與回應 cookie。

`economy_accounts` 與 `life_state` 是 0006 中已存在的結構，本版回應使用零餘額及 `not_started`。**此快照不含 Ember Coin E1、migration 0007 或 Mint。** 不以保留欄位宣稱未啟用的功能已在審查範圍。

## 3. 範圍、公開內容與保留內容

公開 92 個 source，來自固定 source 樹的 604 個檔案；512 個檔案只列路徑和指紋。92 個中 76 個逐位元組相同、16 個有行數保留的遮蔽；11 個低熵原始 blob 指紋不公開。

新增 10 個會員檔案與各自理由見 [PUBLIC_CONTENT_LIST.md](PUBLIC_CONTENT_LIST.md)。不公開模型、貼圖、場景、美術程式、音樂、房屋幾何／配置、`WorldApp.tsx`。內部設計文件本體不公開；檔名仍可能出現在保留檔 manifest。線上可見的 MemberPanel 文案保留。

Worker 的 18 個 value import 檔及 `server/d1.ts` type 介面均在 source 中，可依本包方法重建 Worker。完整場景與前端建置需團隊私下完整來源；公開測試的替身只協助載入，不提供房屋幾何。

## 4. 本輪證據與驗證限制

| 證據 | 本輪結果／位置 |
|---|---|
| 公開 Worker 重建 | 完整 hash／size 與部署紀錄相同；`TESTS/worker-dry-run-output.txt` |
| 五次低頻 GET | 4 個靜態檔 hash 與部署紀錄相符；session 回 `signedIn:false`、no-store；均無 Set-Cookie |
| 靜態標頭 | 4 檔 × 6 值共 24 項與 `source/public/_headers` 相同 |
| GET UTC | 2026-10-03T13:01:16Z 至 2026-10-03T13:01:40Z |
| 公開／團隊測試 | 公開含替身 341 項：337 通過／4 失敗；M1 33/33、修正回歸 90/90；完整來源 archive 1009 項：1008 通過／1 歷史依賴失敗；詳見 [TESTS/README.md](TESTS/README.md) |
| 前端 CRLF／LF 重建 | CRLF 的 102 檔全部相符；LF 只有 4 個文字檔的 CR 差異；完整指紋見 manifests |
| 部署對照結論 | **partial** |

partial 的原因包括：只有四個正式靜態檔被下載；Worker 流量分配、正式 D1、binding、WAF、限流實際計次與完整真錢包行為 **unverified**。本輪沒有本版真錢包驗證；歷史真錢包記錄只屬於 `bbf24001`。

### 給本輪 reviewer 的說明

- Audit 只讀固定公開快照，不連網。
- Report 讀相同快照，正式站只做文字指定的五次 GET；用 curl 或瀏覽器 User-Agent。前次 Python-urllib 取得 403，不能把未取到的檔案稱為相同。遇到其他阻擋不繞過。
- 本包的測試、部署記錄及修正狀態是團隊提供的證據，請自行判斷。公開 source 的 test failures、tsc errors、mock／替身與未驗證項目均須按實際用途解讀。

## 5. 文件與重現入口

| 文件 | 用途 |
|---|---|
| [SCOPE.md](SCOPE.md) | 範圍、import 邊界與保留內容 |
| [ROUTES.md](ROUTES.md) | HTTP 路由、檢查順序與限流 |
| [SIWE.md](SIWE.md) | 登入訊息、session、cookie 與客戶端 |
| [WALLET_METHODS.md](WALLET_METHODS.md) | 錢包方法與靜態 bundle 掃描限制 |
| [DATA_SCHEMA.md](DATA_SCHEMA.md) | migrations 0001–0006、資料與清理 |
| [OWNERSHIP_AND_HOMES.md](OWNERSHIP_AND_HOMES.md) | 錢包、持有與房屋權限 |
| [DEPLOYMENT_MATCH.md](DEPLOYMENT_MATCH.md) | 建置、部署紀錄與 GET 比對 |
| [DEPENDENCIES.md](DEPENDENCIES.md) | 鎖定依賴、工具與 npm audit |
| [REDACTIONS.md](REDACTIONS.md) | 遮蔽及刻意保留項目 |
| [PUBLIC_CONTENT_LIST.md](PUBLIC_CONTENT_LIST.md) | 公開清單、數量與識別碼 |
| [TESTS/README.md](TESTS/README.md) | 可重現指令、UTC、測試結果及限制 |

`SHA256SUMS` 在所有文件與產物完成後產生，不含它自己。公開 repo 保留追加歷史，沒有私密 repo 的 Git 歷史。LICENSE 的權利保留條款延續；其中舊 source 編號是歷史 provenance，本輪取材版本以本 README 與 manifests 為準。
