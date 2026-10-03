> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# DEPLOYMENT_MATCH：部署檔案比對與驗證界線

## 1. 結論與版本

本輪部署對照結果為 **partial**。公開來源可獨立重建與部署紀錄相同的 Worker；完整來源重建的 102 個靜態檔案全部符合紀錄；取得的四個線上靜態檔案也符合相同雜湊。本輪未驗證正式 D1 的執行狀態、WAF／限流執行效果或此版本的真實錢包登入。

這是非官方社群專案的技術證據包，檔案相符不等於整個線上服務的行為已經重新審查。

| 項目 | 本輪基準 |
|---|---|
| 公開來源基準 SRC | `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c` |
| 部署來源 LIVE | `ddb10e28a867998323164e7585635efedfcf7788` |
| Worker version | `acdbb2bd-8add-4b15-bfa6-a31266c83520` |
| 部署 tag（紀錄） | `v2026.10.03-acdbb2bd` |
| 部署紀錄 id | `20261003T005417Z-ddb10e2` |
| 部署開始 UTC（紀錄） | `2026-10-03T00:54:17.810Z` |
| 部署完成 UTC（紀錄） | `2026-10-03T00:55:15.367Z` |
| 部署分支／dirty（紀錄） | `member-1003`／`false` |
| 實測 Node／npm | `v24.19.0`／`11.17.0` |

SRC 比 LIVE 多兩個文件變化：`source/docs/security/AUDIT_REMEDIATION_STATUS.md` 修改，以及新增 `source/docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md`。這兩個文件不進入 Worker 或前端建置。其餘已公開、會進入建置的來源在 SRC 與 LIVE 相同。

`source/` 有 92 個檔案，其中 16 個經遮蔽、76 個與 SRC blob 位元組一致；原樹共 604 個檔案，512 個只公開清單及雜湊。遮蔽界線見 `REDACTIONS.md`。

## 2. 證據的種類

| 證據 | 本輪實際完成 | 可支持的結論 |
|---|---|---|
| 公開來源 Worker dry run | 是 | 本地生成的 Worker 與紀錄 bundle 相符 |
| 完整來源 CRLF 重建 | 是 | 102 個 dist 檔案與紀錄逐位元組相符 |
| 完整來源 LF 重建 | 是 | 只有四個文字檔因 CR 位元組不同 |
| 線上靜態 GET | 四個 | 這四個回應的 body 與紀錄／CRLF 重建相符 |
| 靜態安全標頭 | 4 回應 × 6 個值 | 24 次值比對相符 |
| 無 cookie 的 session GET | 一個 | 此請求回答 `signedIn:false` |
| Worker 部署／流量設定查詢 | 未做 | 100% 流量仍是團隊聲明 |
| 正式 D1、WAF、限流執行效果 | 未做 | 只有設定、來源、團隊紀錄與本地測試 |
| 此版本真實錢包登入 | 未做 | 本地合成簽名不能替代這項驗證 |

部署證據頁的 `Tests before build: passed (npm test)` 是部署當時的團隊紀錄。本輪新跑的測試結果另列於 `TESTS/README.md`，不能以該欄覆蓋本輪失敗。

## 3. 公開來源可重建的 Worker

從 `source/` 的獨立副本安裝 lock 後，於 `2026-10-03T13:09:06Z–13:09:10Z` 執行 Wrangler dry run，exit 0。

- bundle：`worker/index.js`，**303,128 bytes**。
- SHA-256：`cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518`。
- 位元組大小與 SHA 均符合部署紀錄。
- `source/src/world/collections.ts`、`source/src/world/memberName.ts`、`source/server/member.ts` 的遮蔽只涉及註解，未改動打包邏輯。
- dry run 沒有上傳 Worker，也沒有讀取正式 D1 或執行錢包操作。

審查者可在全新的副本中重建；以下指令是重現方法，本輪輸出已保存在 `TESTS/worker-dry-run-output.txt`：

```bash
# 在 source/ 的全新副本內；不要指向正式 checkout。
npm ci --no-audit --no-fund
mkdir dist
printf '<!doctype html>\n' > dist/index.html
CI=1 WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --dry-run --outdir ../worker-rebuild
wc -c ../worker-rebuild/index.js
sha256sum ../worker-rebuild/index.js
```

`dist/index.html` 是讓 assets binding 通過 dry run 的最小佔位檔，並非前端重建成果。公開副本不足以執行完整 `npm run build`，原因見 `TESTS/README.md`。

## 4. 完整來源的靜態重建

本輪在保留的完整來源副本中，分別以 `core.autocrlf=true` 與 `false` 匯出 LIVE，再執行 `npm run build`；兩次均 exit 0。

| 重建 | UTC 時間 | 實際結果 |
|---|---|---|
| CRLF | `2026-10-03T13:13:05Z–13:13:15Z` | 102 個 dist 檔案全部與部署紀錄相符 |
| LF | `2026-10-03T13:13:31Z–13:13:41Z` | 同樣 102 個檔案；四個文字檔雜湊不同 |

LF 差異只在 `_headers`、`favicon.svg`、`index.html`、`licenses/cinzel-OFL.txt`；逐檔去除 CR 位元組後與 CRLF 版相等。其餘 98 個檔案原始位元組相同。

`manifests/build-sha256.txt` 列全部 CRLF 結果；`manifests/build-sha256.lf-run.txt` 列四個 LF 差異。這項完整前端重建需要未公開的來源，外部審查者無法僅從公開副本重跑。

## 5. 線上 GET 與標頭

於 `2026-10-03T13:01:16Z–13:01:40Z` 保存五個 GET。四個靜態回應均為 200，沒有 Set-Cookie；body 雜湊同時符合部署紀錄與 CRLF 重建。

| 路徑 | bytes | SHA-256 |
|---|---:|---|
| `/`（部署檔 index.html） | 2,634 | `b51fd33164084511d9fb0dc3a23cadfcecbb6965d74a0e418761b7a1bee0205a` |
| `/assets/index-BoNTm1MM.js` | 1,482,070 | `f9cf6a67132706372b2917efdfffe22c6cda0402ae2c7e4ec32bf3aee6c71588` |
| `/assets/index-BZpalHf7.css` | 58,227 | `6799cd5de49639b854270820c090bf5983b22d7d81b58818b9a427e48c1152ec` |
| `/assets/InteriorView-DM8tQpsI.js` | 93,242 | `4a64e1f3f47df59ea7f6e369691a78aab8791addbcb33d4d9f332de04e70e84c` |

比對的六個靜態標頭為 `X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、`Strict-Transport-Security`、`X-Frame-Options`、`Content-Security-Policy`，全部與 `source/public/_headers` 的值相同，詳見 `DEPENDENCIES.md`。

另一次 `GET /api/auth/session` 為 200，body 是 `{"signedIn":false}`，18 bytes，SHA-256 `60483fbb3c01c4080583563e215e3ca4ab5ce4ff74f47cf36eadedd152572d2f`。沒有 Set-Cookie。API 使用自己的標頭，不能套用上面六個靜態標頭的 tally。

其餘 98 個 dist 項目未作線上 GET；其中 `_headers` 是部署規則檔，本身不作靜態 body 對照。`manifests/compare.txt` tally：**VERIFIED 4、RECORD-MATCH 97、NOT-SERVED 1**。

## 6. 正式執行環境與歷史界線

部署頁列出 D1 migrations `0001`–`0006`，並記載 `0006_members.sql` 約於 `2026-10-03T00:49Z` 套用。這是團隊紀錄，本輪未重新查詢遠端 migration 清單或資料表。`0006` 原始雜湊因低熵遮蔽不公開，見 `REDACTIONS.md`。

Wrangler dry run 顯示 DB、ASSETS 與四個 limiter binding，只證明本地設定能產生 bundle，不證明正式綁定存在或額度實際生效。WAF rule id 與設定來自部署頁的團隊填寫欄位，本輪未重新讀取控制台或觸發限流。

上一個已公開送審基準是來源 `2e4e830`／Worker `bbf24001`／公開快照 `8cad017`。其後有三次前端部署 `d5f52483`、`ef1a55fb`、`8269ae53`，再有 `63c6c7bd` 的第四輪修正及本次 `acdbb2bd` 的 M1 會員層；這些變更不能沿用先前審查的通過狀態。

與 `2e4e830` 的紀錄比較，本輪 dist 中 95 個不變、1 個改變、6 個新增，先前 4 個檔名已消失。完整逐檔結果在 `manifests/compare.txt`。Coin E1 與 Genesis Mint 不在本包範圍。

## 7. 可追溯檔案

- `source/docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md`：團隊部署紀錄的結構化摘錄。
- `manifests/deploy-record-SHA256SUMS.txt`：紀錄的 105 列 SHA；102 列屬於 dist。
- `manifests/build-sha256.txt`、`manifests/build-sha256.lf-run.txt`：本輪兩種換行重建。
- `manifests/live-sha256.txt`：五次已保存 GET 的 body 雜湊。
- `manifests/compare.txt`：逐檔對照、變更分類與 tally。
- `TESTS/README.md`：本輪實測結果、預期失敗與重現方法。
