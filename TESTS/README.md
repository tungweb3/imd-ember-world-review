# TESTS：本輪實測、保留造成的失敗與重現方法

## 1. 版本與測試性質

本輪公開來源基準為 `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`；部署來源為 `ddb10e28a867998323164e7585635efedfcf7788`，Worker `acdbb2bd-8add-4b15-bfa6-a31266c83520`。Node `v24.19.0`、npm `11.17.0`。

這裡的測試與 probe 在本地執行真實專案 handler／client，使用記憶體 SQLite、合成帳號、假錢包 provider、假鏈上／網路資料和 limiter。**不是對正式 Worker 的登入或正式 D1／WAF／限流測試**。SIWE 範例與 probe 沒有對外送請求，也沒有操作真實錢包。

公開來源只有 13 個 `*.test.mjs`。保留的完整來源有更多測試與幾何／資產；兩種來源的計數不同，不能直接相減當成覆蓋率。

## 2. 實際結果

| 實際執行 | UTC 開始–結束 | tests / pass / fail | exit | 公開輸出 |
|---|---|---:|---:|---|
| 公開副本，無替身 `npm test` | 13:09:10–13:09:19 | 161 / 157 / 4 | 1 | `npm-test-output.no-stub.txt` |
| 公開副本，有替身 `npm test` | 13:09:19–13:09:49 | 341 / 337 / 4 | 1 | `npm-test-output.txt` |
| group 5 Enter 授權 | 13:09:49–13:09:49 | 3 / 3 / 0 | 0 | `home-entry-group5-output.txt` |
| N 回歸 | 13:09:49–13:09:54 | 43 / 43 / 0 | 0 | `n-tests-output.txt` |
| 第四輪 focused 回歸 | 13:09:54–13:10:12 | 90 / 90 / 0 | 0 | `audit4-tests-output.txt` |
| M1 會員／名稱 | 13:10:12–13:10:15 | 33 / 33 / 0 | 0 | `member-tests-output.txt` |
| 完整來源 archive、concurrency 3 | 13:11:22–13:12:46 | 1009 / 1008 / 1 | 1 | raw log 保留，只列摘要與 SHA |

全部時間為 **2026-10-03 UTC**。以上七次執行的 cancelled、skipped、todo 均為 0。focused 測試是完整集合的子集，不可與全套計數相加。

- 公開副本測試總時間：無替身 8673.6345 ms，有替身 28577.9519 ms。
- 完整來源 archive 測試總時間：84137.6872 ms。
- 本輪沒有任何一份全套測試是零失敗；focused 通過不覆蓋下節的缺口。
- 部署頁的 `passed (npm test)` 是團隊在部署當時的紀錄，本表是另一次實測。

## 3. 無替身的四項失敗

`npm-test-output.no-stub.txt` 保存四項實際失敗：

| 失敗 | 根因與來源 |
|---|---|
| `tests/home-entry.test.mjs` 整檔載入 | `source/src/world/homeEntry.ts:5` import 保留的 `src/world/households.ts`；其下一行也依賴保留的 layout |
| `tests/ownership.test.mjs` 整檔載入 | `source/tests/ownership.test.mjs:11` import homeEntry，`:12` 直接 import households |
| `tests/wallet-client.test.mjs` 整檔載入 | `source/tests/wallet-client.test.mjs:8` import homeEntry，間接需要 households／layout |
| deploy-evidence 的 real-record 案例 | 測試第 54 行需要來源 repo 的歷史 commit `132228c`，獨立 archive 沒有它 |

前三個在 loader 階段丟 `ERR_MODULE_NOT_FOUND`。這三個失敗是檔案載入結果，該檔內的個別測試沒有逐一執行；不能把 161 當成完整已公開案例數。

## 4. 有替身的四項失敗

`TESTS/stubs/households.ts` 只從公開 `houseSize.ts` 轉出 houseSize／HOUSE_SIZES；HOUSE_FOOTPRINT 一讀就丟例外。`TESTS/stubs/layout.ts` 的 lotPoint 一呼叫就丟例外。它們沒有房屋位置或幾何數值，不是正式來源、也不假造測試答案。

| 實際失敗案例 | 發生位置 | 根因 |
|---|---|---|
| the door: Enter offer within 1.8 m | `source/tests/home-entry.test.mjs:53` | doorPoint 讀取替身的 HOUSE_FOOTPRINT，直接丟 withheld |
| group 8: interior preview | `source/tests/home-entry.test.mjs:62`，動態 import 在 `:70` | 保留的 `src/world/interior/mockSeats.ts` 不存在 |
| TEST-1: Enter render rules | `source/tests/home-entry.test.mjs:91` | 前面部分按鈕斷言執行後，doorPoint 讀取保留的幾何 |
| deploy-evidence real-record | `source/tests/deploy-evidence.test.mjs:31` | 同樣缺歷史 commit；詳見下一節 |

有替身時三個測試檔可載入，341 項中 337 通過。沒有幾何來源的門口距離、完整預覽資料與後段幾何斷言仍未完成驗證。

group 5 的三項授權測試通過：只允許 session 屋主自己的房屋；本地登入後撤銷 session，home 路由回 401 時關閉閘門；按鈕只對自己的家顯示。這使用專案真實 AuthClient 與 Worker handler，但鏈、provider、資料庫都是本地測試環境。

## 5. deploy-evidence 歷史失敗與完整來源結果

本輪三種全套執行都在同一個測試的 `source/tests/deploy-evidence.test.mjs:54` 失敗：

1. 第一段對新建副本 HEAD 產生 evidence；包含 migration 0001–0006 與現行 CHAIN_KEYS 的斷言已執行。
2. 第 54 行要求 `git rev-parse 132228c`，再以該 commit 產生 record。
3. archive 只建立自己的新 HEAD，沒有這個歷史；測試 helper 收到無效 commit，子程序回 `manifest.json has no valid commit`，assertion 失敗。

這個錯誤不是本輪正式部署 record 的 manifest 已被判為不合法。測試的歷史重現依賴不在 archive 中。

同一測試第 55–64 行的舊版本比較與「不含 log 文字」尾段斷言因中止未執行。另一項「outside git」測試照常通過，其中第 80、88 行也檢查輸出不含假 email／路徑；不能用另一項通過補稱第一項尾段已跑。

完整來源 archive 實際命令是：

```bash
node --test --test-concurrency=3 tests/*.test.mjs
```

結果 1009／1008／1，唯一失敗就是上述歷史案例。沒有再稱它為完整 `npm test` 或全部通過。原始完整 log 不公開，SHA-256：

```text
6a6d0077e3321642a4354ec68bc7aeb84e4836ac557a8b31570f2c77dca61ccf
```

## 6. tsc 的 16 個 diagnostics

移除兩個替身後，`npx --no-install tsc --noEmit` 於 13:10:15–13:10:18 UTC 執行，exit 2；`tsc-noEmit-output.txt` 保存 **15 個 TS2307、1 個 TS7006**。

| 報錯來源 | 缺少的模組／型別 |
|---|---|
| `source/src/main.tsx:3`–`:7` | WorldApp、bridge、dataMode、skin/terrainTask、screenSpace，共五個保留模組 |
| `source/src/main.tsx:8` | virtual:baked-terrain 的宣告／build plugin 相關來源保留 |
| `source/src/world/homeEntry.ts:5`、`:6` | households、layout |
| `source/src/world/HomePanels.tsx:2`、`:3` | households、layout |
| `source/src/world/WalletPanel.tsx:3` | households |
| `source/src/world/walletView.ts:3` | households |
| `source/vite.config.ts:9`–`:11` | scripts/content-hash、skin/terrainField、skin/terrainBake |

額外 TS7006 在 `source/src/world/HomePanels.tsx:20` 的 callback 參數 id：households 的型別無法解析，失去推導來源。這不是本輪獨立證明的完整來源型別錯誤；同版完整來源兩次 `npm run build`（含 tsc）均 exit 0。

公開副本的 `npm run build` 會先在 tsc 停止，無法完成前端。Worker 可單獨 dry run 重建，exit 0、303,128 bytes，雜湊與紀錄相符，詳見 `DEPLOYMENT_MATCH.md`。

## 7. 公開副本的重現方法

在本包根目錄開 Bash，使用全新 scratch 副本。此例建立自己的 Git HEAD，仍不具備上述歷史 commit：

```bash
package_root="$PWD"
scratch=$(mktemp -d)
cp -R source "$scratch/source"
cd "$scratch/source"
git init -q
git -c core.autocrlf=false add -A
git -c user.name=review -c user.email=review@example.invalid -c core.autocrlf=false commit -qm snapshot
npm ci --no-audit --no-fund
npm test
cp "$package_root/TESTS/stubs/households.ts" src/world/households.ts
cp "$package_root/TESTS/stubs/layout.ts" src/world/layout.ts
npm test
node --test --test-name-pattern="group 5" tests/home-entry.test.mjs
node --test --test-name-pattern="^N-" tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/worker.test.mjs
node --test --test-name-pattern="^(R3-R1|AUD3-|ADV-)" tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/worker.test.mjs
# 只移除剛複製到 scratch 的兩個測試替身。
rm src/world/households.ts src/world/layout.ts
node --test tests/member.test.mjs tests/member-client.test.mjs
npx --no-install tsc --noEmit
```

上面兩次全套測試及 tsc 預期非零，必須查看實際錯誤，不能把其他錯誤也視作保留造成。替身不應複製進正式 checkout 或提交成產品程式。

## 8. SIWE 範例、probe 與 audit

- SIWE 範例於 13:10:20–13:10:21 UTC 生成，exit 0。腳本 `siwe-sample/generate-siwe-sample.mjs`，輸出 `siwe-sample/siwe-sample-output.txt`。使用本地真實 challenge handler、合成記憶體金鑰、migration 0001–0006；時鐘刻意固定為 2026-09-29。
- 範例的簽名訊息僅為登入：domain、chainId 1、nonce、URI 與時間供頁面逐行檢查。未包含簽章，也未要求真實錢包簽名。
- keyed-reads probe 於 13:10:21 UTC 執行，exit 0。腳本與輸出在 `probes/`；以假 fetch／limiter 記錄有金鑰讀取的次數與 budget 鍵。
- probe 看到 EOA 同一 nonce 五次錯簽只一次 eth_getCode，其後 409；合約錯簽每 challenge 最多 eth_getCode＋eth_call；chain:code 拒絕時零鏈讀取，429 CHAIN_BUSY。
- probe 的索引探索通道案例：chain:index 被拒而 chain:index:lane 放行時一次讀取、seats 0；缺 AUTH_LIMITER 的正式 origin 回 503；所有 limiter 拒絕時本地 logout-all 200／logout 204。
- 上述僅是本地執行結果，不能證明正式 budget／上游或 WAF 行為。
- npm audit 的 production／含 dev 兩份 JSON 均 total 0，詳見 `../DEPENDENCIES.md`。

公開輸出共 12 份，絕對本機路徑替換為 `<SCRATCH>`，保留錯誤與計數；處理說明見 `../REDACTIONS.md`。Coin E1／Genesis Mint、本版本真實錢包登入與正式 D1 執行狀態不在這些本地測試的已驗證範圍。
