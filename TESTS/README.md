# TESTS：實際執行的指令、版本與原始輸出

以下每一項都在 2026-09-29（UTC）實際執行過；沒有執行的測試不列為通過。

## 分類

| 類別 | 本快照有沒有 | 說明 |
|---|---|---|
| 靜態／mock／unit（Node） | **有**，本快照可執行 141 項（其中 3 項因被保留的程式無法通過，見第 1 節） | 真的 Worker handler、真的三個 migration（`node:sqlite`）、本機產生的合成金鑰、鏈上讀取用 fixture 替身 |
| 瀏覽器測試 | **沒有** | 本快照沒有執行任何瀏覽器 E2E |
| 真實錢包測試 | **沒有** | 沒有連接任何真實錢包，沒有簽任何正式訊息，沒有鏈上交易 |
| 對正式站 | 只有 5 個公開 GET（`DEPLOYMENT_MATCH.md` 第 5 節），不是功能測試 |

`tests/wallet-client.test.mjs` 與 `tests/home-entry.test.mjs` 以真實的用戶端 `AuthClient` 對真實的 Worker handler 跑（fetch、EIP-1193 provider、分頁 channel、時鐘都是注入的替身），模擬換帳號、晚回應、拒簽、預算忙碌、頁面端訊息檢查、登出所有裝置、「進入我的家」的閘門等情境；它們仍是 Node 內的 mock 測試，不是瀏覽器測試。

## 1. npm test（本快照 `source/`）

```text
環境：Windows 11，Node v24.19.0，npm 11.17.0
時間：2026-09-29T05:54:48Z – 05:54:52Z（不加替身）；05:54:52Z – 05:54:56Z（加替身）；05:54:56Z（group 5）
做法：把本快照的 source/ 複製成一個獨立目錄並 git init、commit 一次（deploy.test.mjs 與 deploy-evidence.test.mjs 假設
      source/ 就是 git repo 的根目錄），npm ci（2026-09-29T05:52:31Z–05:52:48Z，--no-audit --no-fund）後：
npm test                                              # 不加替身
cp <本 repo>/TESTS/stubs/households.ts src/world/households.ts
cp <本 repo>/TESTS/stubs/layout.ts src/world/layout.ts
npm test                                              # 加替身
node --test --test-name-pattern="group 5" tests/home-entry.test.mjs
rm src/world/households.ts src/world/layout.ts
```

結果：

- 加替身：**tests 141，pass 138，fail 3**（`npm-test-output.txt`，本機路徑換成 `<SCRATCH>`，即那個 source/ 副本）。3 項失敗全部在 `tests/home-entry.test.mjs`，全部是因為被保留的程式：
  - 「the door: the Enter offer appears within 1.8 m of the owner's door spot…」與「TEST-1: the render rules for the Enter action…」：需要被保留的房屋尺寸與擺放幾何（`HOUSE_FOOTPRINT`、`lotPoint`）。替身**故意不提供**這些數值，讀取就丟出 `withheld: …`。
  - 「group 8: the ?interior= preview opens only in DEV or with ?debug=1…」：需要被保留的 `src/world/interior/mockSeats.ts`。
- 「進入我的家」的三項授權測試（名稱以 `group 5` 開頭）：**3 項全部通過**（`home-entry-group5-output.txt`）。其中一項以真實 sign-in 對真實 Worker 跑，確認閘門只對屋主自己的房子開放，session 在伺服器被撤銷後（`/api/me/home` 回 401）立即關閉。
- 不加替身：tests 120，pass 118，fail 2——`ownership.test.mjs` 與 `home-entry.test.mjs` 兩個檔案因 `Cannot find module …/households.ts` 無法載入（`npm-test-output.no-stub.txt`）。

**為什麼需要替身**：`tests/ownership.test.mjs:5` 從 `households.ts` import `houseSize`，`src/world/homeEntry.ts:5-6` 從 `households.ts`、`layout.ts` import 房屋幾何。`households.ts` 在 commit 2da46cd 對 `houseSize`／`HOUSE_SIZES` 只做一件事：從公開的 `src/world/houseSize.ts` 原樣轉出（`households.ts:12`，團隊端）。`TESTS/stubs/households.ts` 只有這個轉出，外加一個一讀就丟例外的 `HOUSE_FOOTPRINT`；`TESTS/stubs/layout.ts` 的 `lotPoint` 一呼叫就丟例外。兩個替身都不含任何擺放邏輯或幾何數值，也不是審查對象。

執行的 10 個測試檔（括號內是本版新增或改寫的重點）：

- `auth.test.mjs`：SIWE 訊息、cookie 旗標、token 只存雜湊、Origin、flow、重送、過期、ERC-1271／6492、冷啟動 CPU、開發伺服器、每網段與全站 challenge 預算、驗簽失敗作廢 challenge、ERC-1271 每 challenge 最多一次、缺綁定時 503（**F-1 新 statement 與舊措辭的相容；F-2 每個 session 記錄 EOA/ECDSA 或 CONTRACT/ERC1271、ERC-1271 路徑每一種無法驗證都拒絕；F-3 每網段與每合約份額、`chain:code`、回訪智慧錢包的預算、EOA 垃圾簽章不碰合約預算；F-5 分層限制、challenge 與 verify 分開計數、每錢包冷卻、每個拒絕與 surge 一行不含識別資訊的 log；logout-all；部分索引；0003 之前部署時回 503**）。
- `wallet-client.test.mjs`：用戶端狀態機、EIP-6963、換帳號／錢包、晚回應、多分頁、搬家閘門、`markedHome`（**頁面在錢包看到訊息前逐行檢查；簽名視窗開著時的摘要；「登出此裝置」與「登出所有裝置」**）。
- `home-entry.test.mjs`（**新**）：「進入我的家」的閘門與按鈕、門口幾何、預覽模式。
- `review-record.test.mjs`（**新**）：審查紀錄的內容與標示、連結屬性、每個發現的嚴重度與狀態、`docs/security/AUDIT_REMEDIATION_STATUS.md` 與頁面資料一致且不含禁用字、個人資料或本機路徑。本快照的那份文件是公開版（`REDACTIONS.md` 第 1.4 節），測試仍通過。
- `deploy-evidence.test.mjs`（**新**）：部署證據腳本只輸出結構化欄位，log 裡的 email、本機路徑與其他文字都不會出現在輸出。
- `ownership.test.mjs`：ownerOf、Multicall3、候選、快取、失敗回 503、轉手、24 小時計入規則、`chain:index`（**`/api/me/home` 只從 session 取地址；Worker 進入點不會載入 `layout.ts`／`households.ts`**）。
- `presence.test.mjs`：cron 在線紀錄與清理（**0003 只增不改**）。
- `worker.test.mjs`：路由、rate limit（含 IPv6 /64）、上游請求、進入點只匯出 handler、缺少綁定時 503、`networkKey`。
- `headers.test.mjs`：`public/_headers` 與 `API_HEADERS` 的安全標頭。
- `deploy.test.mjs`：部署腳本的出處紀錄、拒絕 dirty tree 與 `.env`、`deploy-records/` 被 gitignore、部署前先跑完整測試、失敗就停止。

## 2. 團隊端：完整原始碼的測試（不在本快照）

從 commit 2da46cd 以 `git -c core.autocrlf=false archive` 取出完整原始碼（63 個測試檔），`npm ci` 後在該副本 `git init` 並提交一次，再 `npm test`：2026-09-29T05:55:33Z–05:55:46Z，Node v24.19.0：**tests 617，pass 617，fail 0**。原始輸出含被保留測試的名稱與本機路徑，不收錄；其 SHA-256 為 `98129d50c1bc31182dfcdf50d7c9b468ee05c40ea313bbbcabb8755611a4da26`。部署紀錄的 manifest 另記錄這次正式部署前 `scripts/deploy.mjs` 跑完整測試的結果為 `passed`。reviewer 無法重跑被保留的測試（房屋擺放、房屋內部、世界內容、`links.test.mjs`、`gateway.test.mjs`、`market.test.mjs` 等）。

## 3. 型別檢查（本快照 `source/`）

```text
npx tsc --noEmit      # 2026-09-29T05:55:01Z，不加替身
```

結果：exit 2。錯誤全部來自被保留的檔案（`tsc-noEmit-output.txt`）：`src/main.tsx` 找不到 `./world/WorldApp`；`homeEntry.ts`、`walletView.ts`、`WalletPanel.tsx`、`HomePanels.tsx` 找不到 `./households.ts`、`./layout.ts`；以及由此連帶產生的一個 TS7006。對應關係見 `SCOPE.md` 第 6.3 節。因此前端的 `npm run build` 在本快照無法完成；Worker 的建置不受影響。

## 4. Worker bundle 重建（本快照 `source/`）

步驟見 `DEPLOYMENT_MATCH.md` 第 3 節。2026-09-29T05:53:07Z 的結果：`index.js` 264,561 bytes，SHA-256 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`，等於部署紀錄中實際上傳的 bundle。輸出：`worker-dry-run-output.txt`。

## 5. npm audit

```text
npm audit --omit=dev --json   → npm-audit-omit-dev.json   （0 個弱點）
npm audit --json              → npm-audit-all.json         （3 moderate，皆在 wrangler 的建置工具鏈）
時間：2026-09-29T05:55:36Z–05:55:45Z（本快照 source/ 的副本，npm ci 之後）
```

判讀見 `DEPENDENCIES.md` 第 3 節。**這與團隊在 2026-09-29 較早時的結果（`npm audit` 0）不同**：差別是之後才公布的 undici advisory（GHSA-3wwx-pv8p-q78v）。

## 6. 去敏 SIWE 樣本

```text
cp TESTS/siwe-sample/generate-siwe-sample.mjs <source 副本>/_tmp_siwe.mjs
cd <source 副本> && node _tmp_siwe.mjs <輸出檔>      # 執行後刪除 _tmp_siwe.mjs
```

腳本呼叫真正的 `handleAccountApi` 與頁面端 `checkSignInMessage`，用記憶體中臨時產生的合成金鑰與 `node:sqlite` 上的真 migration，時鐘固定 2026-09-29T12:00:00Z，不連網路（ERC-1271 路徑用只回 `eth_getCode = "0x"` 的本機替身）。除了範例訊息，也示範：頁面端檢查對 6 種竄改的結果、Origin、flow、重送、過期、錯誤簽章作廢 challenge、「沒有 code」快取、每錢包冷卻、每網段預算、logout-all、拒絕 log 的內容、session 的 `wallet_type`／`verification_method`。輸出 `siwe-sample/siwe-sample-output.txt` 不含簽章，cookie 已遮蔽。每次執行地址與 nonce 會不同，其餘結構相同。

## 7. 帶金鑰讀取與 limiter 綁定的探測

`probes/keyed-reads-probe.mjs`：用真實 handler、假鏈與合成金鑰，列出不持有任何東西的呼叫者能觸發哪些帶金鑰的 Alchemy 讀取、經過哪些預算，以及缺少 limiter 綁定時的回應。2026-09-29T06:00:12Z 的輸出：`probes/keyed-reads-probe-output.txt`。重點：EOA 同一 challenge 送 5 次錯誤簽章只觸發 1 次 `eth_getCode`，之後都是 409（連正確簽章也是）；同一 EOA 下一個 challenge 的錯誤簽章 0 次鏈上讀取；合約地址的錯誤簽章每個 challenge 最多 `eth_getCode`＋`eth_call` 各一次；`chain:code` 被拒時 0 次讀取並回 429 `CHAIN_BUSY`（附 log 行）；verify 用 `verify:` 鍵；自建 session 的 `home?fresh=1` 會扣 `chain:index`，被拒時 0 次讀取並回 `recheck=limited`；正式網址缺 `AUTH_LIMITER` 時 challenge 回 503 `LIMITER_UNAVAILABLE`（loopback 回 200）；所有 limiter 都拒絕時，logout-all 仍回 200、logout 仍回 204。

## 8. 測試資料的來源

- `source/tests/fixtures/swarm-2026-09-27.json`：IMD 公開名冊 API（`api.imd.fun/swarm`）的回應快照（檔內時間 2026-09-26T17:17:45Z）。其中的席位持有者地址是名冊（公開 API）資料，只出現在這個 fixture；測試裡的其他地址都是合成或虛構的。
- `source/tests/fixtures/activity-0759z.json`：IMD 公開活動資料的快照。
- 測試中的錢包金鑰都在執行時於記憶體隨機產生（`tests/wallet-harness.mjs`），執行結束即丟棄。測試用的 IP 都是保留位址：文件用（RFC 5737、RFC 3849）、`100.64.0.0/10`（RFC 6598）與 loopback。
- `source/tests/deploy-evidence.test.mjs` 的假 email（`example.com` 保留網域）、假本機路徑與假 UUID，都是用來確認它們**不會**出現在輸出裡的測試資料。

## 9. 團隊端、不在本快照內的紀錄

- 完整原始碼的 `npm test`（617 項，本檔第 2 節）、前端重建與部署紀錄及正式檔案的逐位元組比對（`DEPLOYMENT_MATCH.md` 第 2 節）。
- 這些屬於團隊端證據；依審查規格的交付要求，**既有團隊 log 不算 reviewer 重新執行的測試**。
