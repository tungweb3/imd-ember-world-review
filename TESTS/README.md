# TESTS：實際執行的指令、版本與原始輸出

以下每一項都在 2026-09-28（UTC）實際執行過；沒有執行的測試不列為通過。

## 分類

| 類別 | 本快照有沒有 | 說明 |
|---|---|---|
| 靜態／mock／unit（Node） | **有**，本快照可執行 112 項 | 真的 Worker handler、真的兩個 migration（`node:sqlite`）、本機產生的合成金鑰、鏈上讀取用 fixture 替身 |
| 瀏覽器測試 | **沒有** | 本快照沒有執行任何瀏覽器 E2E |
| 真實錢包測試 | **沒有** | 沒有連接任何真實錢包，沒有簽任何正式訊息，沒有鏈上交易 |
| 對正式站 | 只有 4 個公開 GET（`DEPLOYMENT_MATCH.md` 第 5 節），不是功能測試 |

`tests/wallet-client.test.mjs` 以真實的用戶端 `AuthClient` 對真實的 Worker handler 跑（fetch、EIP-1193 provider、分頁 channel、時鐘都是注入的替身），模擬換帳號、晚回應、拒簽、預算忙碌等情境；它仍是 Node 內的 mock 測試，不是瀏覽器測試。

## 1. npm test（本快照 `source/`）

```text
環境：Windows 11，Node v24.19.0，npm 11.17.0
時間：2026-09-28T16:51:49Z – 16:51:56Z（在本快照的 git clone 等價副本上執行：只有本快照的檔案，外加 git init；
      node_modules 是同一份 package-lock.json 在 16:09Z 以 npm ci 安裝的，lock 檔之後沒有改變）
cd source
npm ci --no-audit --no-fund
npm test            # 先不加替身：node --test tests/*.test.mjs
cp ../TESTS/stubs/households.ts src/world/households.ts
npm test            # 加替身
rm src/world/households.ts
```

結果：加替身時 **tests 112，pass 112，fail 0**。原始輸出：`npm-test-output.txt`（只把本機路徑換成 `<SCRATCH>`）。

不加替身時：tests 97，pass 96，fail 1——失敗的是 `ownership.test.mjs` 整個檔案，因 `Cannot find module '…/src/world/households.ts'` 無法載入（`npm-test-output.no-stub.txt`，本機路徑換成 `<SCRATCH>`）。

**為什麼需要替身**：`tests/ownership.test.mjs:5` 從 `households.ts` import `houseSize`。`households.ts` 屬於不公開的房屋擺放程式，但在 commit 0def8cb 它對 `houseSize` 只做一件事：從公開的 `src/world/houseSize.ts` 原樣轉出（`households.ts:11-12`，團隊端；該檔在 30449b2 → 0def8cb 沒有變動）。`TESTS/stubs/households.ts` 只有這一行轉出，不含任何擺放邏輯，也不是審查對象。

執行的 7 個測試檔（括號內是 0def8cb 新增或改寫的重點）：

- `auth.test.mjs`：SIWE 訊息、cookie 旗標、token 只存雜湊、Origin、flow、重送、過期、ERC-1271／6492、冷啟動 CPU、開發伺服器（**每網段與全站 challenge 預算、`SIGN_IN_BUSY` 不寫任何列；verify 判定的驗簽失敗都作廢 challenge；ERC-1271 先認領、每 challenge 最多一次、並發與作廢失敗時也只讀一次鏈；每網段 3 次份額與 `chain:erc1271`、`CHAIN_BUSY`；缺少 AUTH／API／SEAT／CHAIN 綁定時正確的路由回 503、loopback 放行；Worker 對登出永不限流（zone 的邊緣規則另計，見 `SIWE.md` 第 8 節）**）。
- `wallet-client.test.mjs`：用戶端狀態機、EIP-6963、換帳號／錢包、晚回應、多分頁、搬家閘門、舊簽章剝除、`markedHome`（**預算忙碌的提示，下一次點擊可以登入；`unidentified` 提醒**）。
- `ownership.test.mjs`：ownerOf、Multicall3、候選、快取、失敗回 503、轉手、24 小時計入規則（**每次 NFT 索引讀取扣 `chain:index`；被拒時拋棄式 session 沒有任何鏈上讀取；`recheck:'limited'`；缺少綁定回 503**）。
- `presence.test.mjs`：cron 在線紀錄與清理（**兩個 migration 依序套用、0002 對既有資料只增不改；未使用的 challenge 10 分鐘後刪除；兩個清理都以 `EXPLAIN QUERY PLAN` 確認走索引**）。
- `worker.test.mjs`：路由、rate limit（含 IPv6 /64）、上游請求、進入點只匯出 handler（**缺少綁定時 503；`networkKey` 的 /24、/48 與 IPv4-mapped IPv6**）。
- `headers.test.mjs`：`public/_headers` 與 `API_HEADERS` 的安全標頭。
- `deploy.test.mjs`：部署腳本的出處紀錄、拒絕 dirty tree 與 `.env`、`deploy-records/` 被 gitignore、import 腳本不會部署（**部署前先跑完整測試、失敗就停止；只有 dry run 能 `--skip-tests`；在臨時 git repo 上實際執行腳本**）。

`deploy.test.mjs` 的「deploy-records gitignored」一項會呼叫 `git check-ignore`，需要在 git repo 內執行（在本 repo 的 clone 裡執行即可）；另一項會在系統暫存目錄建立臨時 git repo，需要 `git` 在 PATH 上。

## 2. 團隊端：完整原始碼的測試（不在本快照）

從 commit 0def8cb 以 `git -c core.autocrlf=false archive` 取出完整原始碼（49 個測試檔），`npm ci` 後在該副本 `git init` 並提交一次（`deploy.test.mjs` 需要 git repo），再 `npm test`：2026-09-28T16:07:08Z–16:07:23Z，Node v24.19.0：**tests 514，pass 514，fail 0**。原始輸出含被保留測試的名稱，不收錄；其 SHA-256 為 `86d311d5c4b407fe5f54bf468e0f2a97ad3ae8541027acfbdffe426b06580cae`。

（同一份副本在 `git init` 之前先跑過一次：513 通過、1 失敗，失敗的正是需要 git repo 的「deploy records are gitignored」那一項。）

其中包括隨房屋擺放程式一起保留的 `tests/households.test.mjs`，以及與已公開模組有關、但本快照沒有收錄的 `links.test.mjs`（外部連結過濾：`javascript:` URL、仿冒 GitHub 主機、帶帳密的 URL）、`gateway.test.mjs`、`market.test.mjs`、`linkage-gateway.test.mjs`（它們依賴被保留的 `bridge.ts` 或 fixture）。reviewer 無法重跑這些。部署紀錄的 manifest 另記錄這次正式部署前 `scripts/deploy.mjs` 跑完整測試的結果為 `passed`。

## 3. 型別檢查（本快照 `source/`）

```text
npx tsc --noEmit      # 2026-09-28T16:52Z 在遮蔽後重跑，輸出與先前相同
```

結果：exit 2。錯誤全部來自被保留的檔案（`tsc-noEmit-output.txt`）：`src/main.tsx` 找不到 `./world/WorldApp`；`walletView.ts`、`WalletPanel.tsx`、`HomePanels.tsx` 的型別 import 找不到 `./households.ts`、`./layout.ts`；以及由此連帶產生的一個 TS7006。對應關係見 `SCOPE.md` 第 6.3 節。因此前端的 `npm run build` 在本快照無法完成；Worker 的建置不受影響（下節）。

## 4. Worker bundle 重建（本快照 `source/`）

步驟見 `DEPLOYMENT_MATCH.md` 第 3 節。遮蔽之後、2026-09-28T16:51:21Z 的結果：`index.js` 257,723 bytes，SHA-256 `4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3`，等於部署紀錄中實際上傳的 bundle。輸出：`worker-dry-run-output.txt`。

## 5. npm audit

```text
npm audit --omit=dev --json   → npm-audit-omit-dev.json   （0 個弱點）
npm audit --json              → npm-audit-all.json         （4 high、1 low，皆 wrangler 的建置工具鏈）
時間：2026-09-28T16:09:22Z–16:09:25Z（本快照 source/，npm ci 之後）
```

判讀見 `DEPENDENCIES.md` 第 3 節。

## 6. 去敏 SIWE 樣本

```text
cp TESTS/siwe-sample/generate-siwe-sample.mjs source/_tmp_siwe.mjs
cd source && node _tmp_siwe.mjs <輸出檔>      # 執行後刪除 _tmp_siwe.mjs
```

腳本呼叫真正的 `handleAccountApi`，用記憶體中臨時產生的合成金鑰與 `node:sqlite` 上的真 migration，時鐘固定 2026-09-28T12:00:00Z，不連網路（ERC-1271 路徑用只回 `eth_getCode = "0x"` 的本機替身）。除了範例訊息，也示範 Origin、flow、重送、過期、**錯誤簽章作廢 challenge**、**每網段 challenge 預算**。輸出 `siwe-sample/siwe-sample-output.txt` 不含簽章，cookie 已遮蔽。每次執行地址與 nonce 會不同，其餘結構相同。

## 7. 帶金鑰讀取與 limiter 綁定的探測

`probes/keyed-reads-probe.mjs`：用真實 handler、假鏈與合成金鑰，列出不持有任何東西的呼叫者能觸發哪些帶金鑰的 Alchemy 讀取、經過哪些預算，以及缺少 limiter 綁定時的回應。2026-09-28T16:12:10Z 的輸出：`probes/keyed-reads-probe-output.txt`。重點：同一 challenge 送 5 次錯誤簽章只觸發 1 次 `eth_getCode`，之後都是 409（連正確簽章也是）；自建 session 的 `home?fresh=1` 會扣 `chain:index`，被拒時 0 次鏈上讀取並回 `recheck=limited`；正式網址缺 `AUTH_LIMITER` 時 challenge 回 503 `LIMITER_UNAVAILABLE`，loopback 回 200。判讀見 `SIWE.md` 第 8 節、`ROUTES.md` 第 4 節。

## 8. 測試資料的來源

- `source/tests/fixtures/swarm-2026-09-27.json`：IMD 公開名冊 API（`api.imd.fun/swarm`）的回應快照。檔內 `at` 欄位為 1790443065898（即 2026-09-26T17:17:45Z）。其中的席位持有者地址是名冊（公開 API）資料：設計文件記載 2026-09-27 時名冊中 430 個 agent 席位的持有者與鏈上 `ownerOf` 一致（`source/docs/wallet-login/DESIGN_W1_v001.md:9-11`，團隊端），fixture 中其餘席位的持有者沒有逐一對鏈上核對。這些地址只出現在這個 fixture；測試裡的其他地址都是合成或虛構的。
- `source/tests/fixtures/activity-0759z.json`：IMD 公開活動資料的快照。
- 測試中的錢包金鑰都在執行時於記憶體隨機產生（`tests/wallet-harness.mjs`），執行結束即丟棄。測試用的 IP 都是保留位址：文件用（RFC 5737、RFC 3849）、`100.64.0.0/10`（RFC 6598）與 loopback。

## 9. 團隊端、不在本快照內的紀錄

- 完整原始碼的 `npm test`（514 項，本檔第 2 節）、前端重建與部署紀錄及正式 bundle 的逐位元組比對（`DEPLOYMENT_MATCH.md` 第 2 節）。
- 這些屬於團隊端證據；依審查規格的交付要求，**既有團隊 log 不算 reviewer 重新執行的測試**。
