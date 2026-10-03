# SCOPE：本次 World 公開審查範圍

目標是 World 的資料讀取、錢包登入、session、席位／房屋權限及 M1 會員公開名稱。部署紀錄的 Worker 為 `acdbb2bd-8add-4b15-bfa6-a31266c83520`、部署來源為 `ddb10e28a867998323164e7585635efedfcf7788`；本快照從固定 Git source `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c` 取檔。快照 source 與部署來源是不同識別值。

修補狀態與正式設定由維護者提供。本版包含前輪修補及仍未解決的限制；新增 M1 未經外部審查確認，先前審查只適用各自的版本。見 `source/docs/security/AUDIT_REMEDIATION_STATUS.md:18–37`、`source/src/world/reviewRecord.ts` 與[最新部署證據](source/docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md)。

## 公開內容與完整性

固定 source 有 **604** 個 tracked 檔案；公開其中 **92** 個、保留 **512** 個。92 中 **76** 個與原始 blob 相同、**16** 個經遮蔽；其中 **11** 個標為 LOW_ENTROPY，原始 blob id／SHA-256 不公開。92 是 source 檔數，未計根目錄說明、manifests 或 TESTS。

清單見 [PUBLIC_CONTENT_LIST.md](PUBLIC_CONTENT_LIST.md)；逐檔核對依 manifests、整包 SHA-256 清單及 [REDACTIONS.md](REDACTIONS.md)。保留檔名仍可見。0006 的八張表全部公開，含 economy_accounts 與 life_state 的欄位、約束、預設值及現行程式；註解遮蔽沒有移除 SQL 行為。DESIGN_M1 文件本體保留，公開 source 註解中的相應引用已遮蔽。

## 可直接審查的程式

- Worker entry、路由順序、gateway、內部快取、Origin／limiter、安全標頭及 cron。
- SIWE challenge／verify、EOA／已部署 ERC-1271、session／登出、錢包資產、ownerOf 確認的房屋權限及索引候選／預算。
- M1 bootstrap、讀取／改名、公開名稱查詢、名稱正規化／唯一性、冷卻／舊名保留、版本／帳號切換／重試防護及人工名稱處置 SQL 產生器。
- 六個 D1 migrations、公開 client／React 面板、部署工具、測試與 fixtures。細節見 [DATA_SCHEMA.md](DATA_SCHEMA.md)、[ROUTES.md](ROUTES.md)。

會員從有效 session 的登入地址解析；member_id 不授予 NFT 或房屋權限。economy_accounts／life_state 在 bootstrap 初始化並出現在自己的 profile 摘要；本版沒有啟用生命週期狀態推進，沒有 economy 更新或 Mint route（`source/server/member.ts:60–73,135–154`）。

## Worker 閉包與重建邊界

逐層核對 worker/index.ts 的相對 value imports，在完整固定 source 及公開 92 檔中都是 **18 檔**；公開清單無缺項。另有 type-only 的 server/d1.ts，亦已公開：

| 群組 | 閉包檔案 |
|---|---|
| Worker（2） | worker/index.ts、worker/app.ts |
| Server（7） | server/gateway.ts、world-api.ts、auth.ts、member.ts、ownership.ts、presence.ts、chain-mock.ts |
| 共用 World（9） | src/world/cadence.ts、collections.ts、houseSize.ts、links.ts、market.ts、memberName.ts、model.ts、siwe.ts、status.ts |

package.json、lockfile 及 TypeScript／Vite／Wrangler 設定公開；npm 依賴與檢查見 [DEPENDENCIES.md](DEPENDENCIES.md)。本輪公開 subset 的 Worker dry-run 重建為 **303,128 bytes**、SHA-256 `cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518`，與部署紀錄一致（部署證據第 13、63 行）。本輪完整 source 執行的是前端 build，未執行其 Worker dry-run；本次記錄見 [TESTS/README.md](TESTS/README.md)。重建相同不證明正式 Worker 完整執行設定。

整站前端無法由此 subset 重建：`source/src/main.tsx:3–8` 匯入保留的 WorldApp、bridge、terrain 等。公開 client／面板可局部檢查，替身不證明保留的 UI／幾何正確。

## 未含內容與證據限制

512 個保留檔包括 3D／地形／模型與美術、World 主畫面、房屋配置／內部呈現、其他測試與內部文件。E1、Genesis Mint、Mint 合約／授權服務／交易流程、3D 資產權利政策、內部規格及未公開規劃不在此次範圍。公開 MINT_BOUNDARY.md 是邊界說明，不是 Mint 實作或安全背書。

未收錄憑證、.env／.dev.vars、正式 D1 資料、私人部署原始 logs、真實錢包測試影像或完整私人 source。fixtures 含公開鏈上地址及合成資料，文件沒有將地址與持有人身分連結。

2026-10-03 13:01:16Z–13:01:40Z 的公開 GET 5/5 成功、靜態檔 SHA-256 4/4 比對成功、靜態標頭 24/24 相同；匿名 session 回 signedIn:false／no-store，五回答無 Set-Cookie。這只證明所讀檔與匿名端點當時的回答；未讀正式 D1、未測本版真實錢包或所有會員路由。**Deployment match = partial**；remote migrations、limiter／WAF、secrets、log sampling 仍含部署方自述。

公開 subset 加替身為 **341 tests、337 pass、4 fail**；M1 聚焦測試 **33/33** 通過。完整 source archive 為 **1009 tests、1008 pass、1 fail**，失敗涉及歷史 deploy-evidence；不能宣稱完整全部通過。指令、輸出、替身與其他聚焦結果見 [TESTS/README.md](TESTS/README.md)。此資料包本身不是新的外部審查結論。
