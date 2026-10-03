# REDACTIONS：公開副本的遮蔽與保留項目

## 1. 數量、來源與一致性

公開來源基準：`c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`，由不作換行轉換的 git archive 匯出。

| 項目 | 數量 |
|---|---:|
| 原始 tracked tree | 604 |
| 公開 source 檔案 | 92 |
| 保留正文、只公開清單的檔案 | 512 |
| 公開副本有遮蔽的檔案 | 16 |
| 遮蔽且不公開原始 blob／SHA 的低熵檔案 | 11 |
| 公開副本與原始 blob 完全相同 | 76 |

16 個遮蔽檔案均保留原始行數。以下列出所有不同的行號；來源程式的行號引用仍成立。其餘 76 個檔案通過 `git hash-object --no-filters` 與 SRC blob id 的比對。

本次是原有 8 個遮蔽檔案，加上 8 個 M1／部署證據相關檔案。新增遮蔽共 **26 行**，包括最新部署頁中 migration 0006 的原始 SHA 欄位。新增八個也都歸入低熵保留，所以原有 3 個低熵檔案變為 11 個。

### 1.1 原有八個檔案

| 公開檔案 | 遮蔽行號 | 公開副本 SHA-256 |
|---|---|---|
| `source/docs/security/AUDIT_REMEDIATION_STATUS.md` | 329,1700,1701 | `ebadf4a996d596076fe0f66edeb773ca06d01e77fe9042b53228b990cd2c1e87` |
| `source/docs/wallet-login/DESIGN_W1_v001.md` | 4,5,8,9,10,20,130,181,182,238,431,478,479,481,491 | `cb939c9ca90c8655723fef290db4081e3ab0f2c60aaa18d82ae32defbccea312` |
| `source/migrations/0001_wallet_login.sql` | 15,16 | `d968991d8f51babf059591b9876891076bec232a3ea782453fa91d1d3ef9d3a6` |
| `source/src/world/collections.ts` | 2,3 | `bc21ef28e8c885338158090037042d746dde4a4f9a4daf871bad8a7e40599c5b` |
| `source/src/world/moves.ts` | 1 | `2b3ff677085a7e73d1e7b596895567754f7fffccae5fbbc700f764673a72f0fd` |
| `source/tests/deploy-evidence.test.mjs` | 63 | `5d55de3e0d7d8ceadfcad2df7b33f615517f6a1bb8a5c54d2201462810be4f44` |
| `source/tests/review-record.test.mjs` | 380,403 | `817a2d501fe0b28db2ad08240b30c1695e9b0acaf2330a236e6df833841259e1` |
| `source/wrangler.jsonc` | 3,4,5,12,63 | `28203878b03100f8899f7eba219c10b0f7046ebc05eb55d60096f1f804835f27` |

原有遮蔽涵蓋部署帳號／環境識別、文件內部文字、註解，以及供測試使用的辨識字串。設定值的替換在公開副本用明示的遮蔽值，不能直接拿這份設定部署。來源程式的邏輯、鏈上地址與公開驗證所需的控制流程未因此改寫。

### 1.2 本輪新增八個檔案

| 公開檔案 | 遮蔽行號 | 公開副本 SHA-256 |
|---|---|---|
| `source/server/member.ts` | 6,26,29,65 | `9f40f858842e8c4671efa1b4db5a76a6a8d07fffc9ec3139a112a592a81045b1` |
| `source/src/world/memberName.ts` | 1,14,47 | `06c40c6baacc83039ccf7c06257080b391e769aef778dbf04a328e125f4ff41d` |
| `source/src/world/member.ts` | 1,4 | `e921e4aeb7f59ebbeecce314cd2fe5fc9c4feb5c3820fe570fd4fc4df50a9ef4` |
| `source/migrations/0006_members.sql` | 1,2,7,10,24,25,46,115,125,126 | `9d0b9b920122c87bf877db92aabd2fb968c43bf0533c2f1d66aabf31c2fee261` |
| `source/tests/member.test.mjs` | 9,10,54 | `52185e55c8ea08ea3a8a3eb86fb14f1331513526dc4390eff3f9b2b16df7cb80` |
| `source/tests/member-client.test.mjs` | 9 | `4d9bbf987aea11e6a2c00367e1dd9ece8c81a5b8204fe5953cab4b6ccae56eac` |
| `source/scripts/member-moderate.mjs` | 11 | `db0affe1d40dcbcb5e50881083dd599fe9d7451731c042050bb8595cbf32e3e6` |
| `source/docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md` | 36,63 | `ede6e3e979250fc5500ee8d23d903f40b7d61b613e8fd82f60273e21d3f7430c` |

新增遮蔽逐檔性質如下：

- `source/server/member.ts`：第 6、26、29、65 行的註解。
- `source/src/world/memberName.ts`：第 1、14、47 行的註解。
- `source/src/world/member.ts`：第 1、4 行的註解。
- `source/migrations/0006_members.sql`：第 1、2、7、10、24、25、46、115、125、126 行的 SQL 註解。
- `source/tests/member.test.mjs`：第 9、10、54 行的註解。
- `source/tests/member-client.test.mjs`：第 9 行的註解。
- `source/scripts/member-moderate.mjs`：第 11 行的註解。
- `source/docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md`：第 36 行的原始 migration SHA，及第 63 行的一段文件文字。

可執行 SQL、資料表與索引定義、reserved-name 資料列、會員／名稱驗證、測試斷言及管理腳本的執行邏輯均保留。修改的是註解與文件文字，不是為了讓測試通過而改變程式。

`source/src/world/MemberPanel.tsx:61` 的既有 UI 文字完整保留。此檔沒有遮蔽，與 SRC blob 相同。

### 1.3 低熵雜湊為何保留

短字詞或短文件片段可被猜測；若仍公開原始 SHA-256 或 Git blob id，外部可逐一試猜並核對。這些雜湊不能作為去識別化方法。

不公開原始 blob id 與原始 SHA 的 11 個檔案為：

- `source/docs/security/AUDIT_REMEDIATION_STATUS.md`
- `source/tests/deploy-evidence.test.mjs`
- `source/tests/review-record.test.mjs`
- 上面第 1.2 節的全部八個新增檔案。

`manifests/published-source-gitblobs.txt` 對這 11 個標示 `ORIGINAL-BLOB-WITHHELD`。第 1.2 節中的最新部署頁也遮蔽 0006 原始 SHA：單獨在證據頁保留該 SHA，會破壞 migration 註解的低熵保留措施。

上面表格列的是**公開副本**的 SHA，可用於驗證交付內容；不代表能由公開副本驗證這 11 個原始檔案。其餘五個遮蔽檔案的原始 blob id 仍列在 manifest，76 個未改檔案則可直接核對。

## 2. 未公開正文的 512 個檔案

`manifests/withheld-source.txt` 列出檔名與原始 SHA-256；`manifests/withheld-source-gitblobs.txt` 列出對應 Git blob id。這些列是來源樹的檔案身分記錄，沒有附正文，也不表示其內容已完成外部審查。

保留範圍包括世界場景、房屋幾何與擺放、完整室內視圖、資產、部分設計／工作文件和未納入公開測試範圍的來源。公開安全／登入／會員檔案的查核不能延伸到這些正文。

例如 `src/world/households.ts`、`src/world/layout.ts`、`src/world/interior/mockSeats.ts` 保留在來源樹，公開副本缺這些檔案。這會造成 README 已列出的測試與 tsc 失敗，而不是任意跳過或宣告通過。

`TESTS/stubs/households.ts` 和 `TESTS/stubs/layout.ts` 是另外交付的測試替身，不是這 512 個檔案的還原，也不是正式程式。替身不含房屋幾何值；讀取幾何會直接丟例外。

## 3. 測試輸出的去識別化

本輪公開 12 個輸出檔，由實際執行的原始結果產生：

- 兩種公開副本測試輸出：有替身、無替身。
- group 5、N、第四輪回歸、M1 會員四種 focused 輸出。
- tsc 與 Worker dry-run 輸出。
- 兩個 npm audit JSON。
- 本地 SIWE 範例與 keyed-reads probe 輸出。

已把本機副本的絕對路徑替換為 `<SCRATCH>`；Worker 輸出目錄／Wrangler log 目錄也替換為以該 token 表示的相對位置。Windows、JSON 跳脫與正斜線形式均處理，公開輸出換行統一為 LF。測試名稱、錯誤、計數、測試結果與 npm audit 的 JSON 結構保留。

公開副本測試輸出沒有改掉四項失敗。完整來源測試的 raw log 不進公開包；只有 SHA、計數、命令與失敗摘要列在 `TESTS/README.md`。

合成錢包、測試 IP、fixture 公開名冊地址是測試資料，不是使用者真實簽名或憑證。SIWE 範例使用執行時生成的記憶體金鑰，不含簽章。

## 4. 建置與部署對照的影響

16 個檔案的遮蔽不改變本輪重建 Worker 的輸出：bundle 303,128 bytes，SHA-256 `cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518`，與紀錄相符。

這只能驗證生成 bundle 的位元組。公開副本沒有完整前端來源，且修改過部署設定識別值，無法把它當成正式環境的可直接部署 checkout。

完整來源的 CRLF／LF 前端重建是另項證據；線上比對只取得四個靜態 body。整體結果仍是 partial，見 `DEPLOYMENT_MATCH.md`。

Coin E1、Genesis Mint、其合約與新經濟方案不在本輪公開來源範圍；本包未把它們當成已部署功能。

## 5. 核對方法

```bash
# 未遮蔽檔案：在公開 source/ 副本執行，和 manifest 的相同行比對。
git hash-object --no-filters server/auth.ts
# 公開副本內容：與上表 SHA 比對。
sha256sum server/member.ts
```

遮蔽檔案不能直接以原始 blob id 驗證其公開副本。11 個低熵檔案也沒有公開原始雜湊供此種比對。

本文件表格的行號和公開副本 SHA 在本輪逐檔產生；來源行數一致、76 個 exact 檔案、16／11 個遮蔽分類由 manifest 產生器核對。所有結果均針對本次 SRC，不能沿用到後續來源版本。
