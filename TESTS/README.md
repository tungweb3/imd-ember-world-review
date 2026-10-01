# TESTS：實際執行的指令、版本與原始輸出

以下每一項都在 2026-10-01（UTC）實際執行過；沒有執行的測試不列為通過。

## 分類

| 類別 | 本快照有沒有 | 說明 |
|---|---|---|
| 靜態／mock／unit（Node） | **有**，本快照可執行 216 項（其中 4 項無法在本快照通過：3 項因被保留的程式、1 項因需要團隊的 git 歷史，見第 1 節） | 真的 Worker handler、真的五個 migration（`node:sqlite`）、本機產生的合成金鑰、鏈上讀取用 fixture 替身 |
| 瀏覽器測試 | **沒有** | 本快照沒有執行任何瀏覽器 E2E。A-8 與 N-7 的面板測試以 `react-dom/server` 把 `WalletPanel.tsx` 渲染成 HTML 字串再比對文字，仍不是瀏覽器測試 |
| 真實錢包測試 | **本快照沒有**；團隊端有一次說明（不是測試紀錄） | 準備本快照時沒有連接任何真實錢包，沒有簽任何正式訊息，沒有鏈上交易。團隊說明：持有人在 `bbf24001` 上線後（2026-10-01 04:16 與 04:19 UTC）以真實錢包登入，並按「Log out this device」登出（`DEPLOYMENT_MATCH.md` 第 2 節），沒有收錄紀錄，reviewer 無法重現 |
| 對正式站 | 只有 5 個公開 GET（`DEPLOYMENT_MATCH.md` 第 5 節），不是功能測試 |

`tests/wallet-client.test.mjs` 與 `tests/home-entry.test.mjs` 以真實的用戶端 `AuthClient` 對真實的 Worker handler 跑（fetch、EIP-1193 provider、分頁 channel、時鐘都是注入的替身），模擬換帳號、晚回應、拒簽、預算忙碌、頁面端訊息檢查、登出所有裝置、session 在本機時鐘上到期、「進入我的家」的閘門，以及本版的 session 讀取順序（N-1）、取消的登入流程（N-2）與登入結束的原因（N-7）等情境；它們仍是 Node 內的 mock 測試，不是瀏覽器測試。

## 1. npm test（本快照 `source/`）

```text
環境：Windows 11，Node v24.19.0，npm 11.17.0
時間：2026-10-01T04:25:24Z（不加替身）；04:25:35Z（加替身）；04:25:45Z（group 5）；04:25:46Z（N 測試）
做法：把本快照的 source/ 複製成一個獨立目錄並 git init、commit 一次（deploy.test.mjs 與 deploy-evidence.test.mjs 假設
      source/ 就是 git repo 的根目錄），npm ci（2026-10-01T04:24:47Z–04:25:20Z，--no-audit --no-fund）後：
npm test                                              # 不加替身
cp <本 repo>/TESTS/stubs/households.ts src/world/households.ts
cp <本 repo>/TESTS/stubs/layout.ts src/world/layout.ts
npm test                                              # 加替身
node --test --test-name-pattern="group 5" tests/home-entry.test.mjs
node --test --test-name-pattern="^N-" tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/worker.test.mjs
rm src/world/households.ts src/world/layout.ts
```

結果：

- 加替身：**tests 216，pass 212，fail 4**（`npm-test-output.txt`，本機路徑換成 `<SCRATCH>`，即那個 source/ 副本）。4 項失敗與上一輪是同樣 4 項：
  - 「the door: the Enter offer appears within 1.8 m of the owner's door spot…」（`tests/home-entry.test.mjs:53`）與「TEST-1: the render rules for the Enter action…」（`tests/home-entry.test.mjs:91`）：需要被保留的房屋尺寸與擺放幾何（`HOUSE_FOOTPRINT`、`lotPoint`）。替身**故意不提供**這些數值，讀取就丟出 `withheld: …`。
  - 「group 8: the ?interior= preview opens only in DEV or with ?debug=1…」（`tests/home-entry.test.mjs:62`）：需要被保留的 `src/world/interior/mockSeats.ts`。
  - 「deploy evidence from a real deploy record: commit, id, times, version id, bundle and frontend hashes, migrations, limiters, WAF rule; no log text」（`tests/deploy-evidence.test.mjs:31`）：它需要團隊的 git 歷史。這一版的測試先確認 HEAD 的證據頁列出 N-6 的 `chain:index:lane` 與 migration 0005（第 47、53 行，在本快照通過），再用私人 repo 的兩個較早 commit 確認 limiter 鍵與 migration 清單跟著各 commit 的原始碼走：第 54 行 `git rev-parse 132228c`（`1a0dd495` 的程式碼：有 A-1 的 `chain:erc1271:lane`，沒有 `chain:index:lane` 與 0005），第 58 行 `git rev-parse 3f661eb`（Report 修正那一版，A-1 之前）。本快照的副本只有一個 commit，`132228c` 不存在，`scripts/deploy-evidence.mjs` 回報 `manifest.json has no valid commit`，測試在第 54 行失敗。在團隊的 checkout 中整套 `npm test` 861/861 通過（團隊端，第 2 節）。因為失敗發生在第 54 行，同一測試第 55–64 行（較早 commit 的兩次比對，以及第 63–64 行「輸出不含 log 文字」的斷言）在本快照**沒有執行**；同檔第二個測試（第 68 行起）照常通過，其中第 80、88 行檢查假 email 與假路徑不會出現在輸出。
- 「進入我的家」的三項授權測試（名稱以 `group 5` 開頭）：**3 項全部通過**（`home-entry-group5-output.txt`）。其中一項以真實 sign-in 對真實 Worker 跑，確認閘門只對屋主自己的房子開放，session 在伺服器被撤銷後（`/api/me/home` 回 401）立即關閉。
- 本版 N-1..N-7 的測試（名稱以 `N-` 開頭，分在五個檔案）：**tests 43，pass 43，fail 0**（`n-tests-output.txt`，本輪新增的輸出檔）。指令與團隊狀態文件 `docs/security/AUDIT_REMEDIATION_STATUS.md` 的 8c3aea2e 一節寫的相同；這 43 項也包含在上面加替身的 216 項之內。
- 不加替身：**tests 111，pass 107，fail 4**——`ownership.test.mjs`、`home-entry.test.mjs`、`wallet-client.test.mjs` 三個檔案因 `Cannot find module …/households.ts` 無法載入，加上上述同一個 deploy-evidence 測試（`npm-test-output.no-stub.txt`）。

**為什麼需要替身**：`tests/ownership.test.mjs:11` 從 `households.ts` import `houseSize`，`src/world/homeEntry.ts:5-6` 從 `households.ts`、`layout.ts` import 房屋幾何，`tests/wallet-client.test.mjs:8` import `homeEntry.ts`（為了 W-1 的 `enterGate`）。`households.ts` 在 commit f4272c5（與 2e4e830 相同）對 `houseSize`／`HOUSE_SIZES` 只做一件事：從公開的 `src/world/houseSize.ts` 原樣轉出（`households.ts:11`、`households.ts:14`，團隊端；與 132228c 相同）。`TESTS/stubs/households.ts` 只有這個轉出，外加一個一讀就丟例外的 `HOUSE_FOOTPRINT`；`TESTS/stubs/layout.ts` 的 `lotPoint` 一呼叫就丟例外。兩個替身都不含任何擺放邏輯或幾何數值，也不是審查對象；它們與上一輪逐位元組相同（`households.ts` 替身的檔頭註解仍寫 132228c 的行號，那兩行在 f4272c5 沒有移動）。

執行的 11 個測試檔（與上一輪相同；**粗體**是本版新增或改寫的重點，括號內是測試名稱的開頭與位置；前幾輪加入的 F-、W-、A- 測試都還在，名稱以該編號開頭）：

- `auth.test.mjs`：SIWE 訊息、cookie 旗標、token 只存雜湊、Origin、flow、重送、過期、ERC-1271／6492、冷啟動 CPU、開發伺服器、每網段與全站 challenge 預算、驗簽失敗作廢 challenge、ERC-1271 每 challenge 最多一次、缺綁定時 503、F-1..F-5、W-2、W-3、A-1、A-5、A-6、A-7、logout-all、0003 之前部署時回 503。**本版：N-7 session 路由只對真的到期的 session 回 `expired`，被撤銷、偽造、格式錯誤或沒有的 cookie 都不給原因（`:314`）；N-4 屋主自己先前的檢查不再用掉 A-1 的備援通道，重試與第二台裝置都能登入（重現，`:599`）、通道仍是每 /24 與地址每分鐘一次，同 /24 的垃圾仍能佔住（殘餘，`:612`）、每次合約檢查記下是共用（`pool`）還是通道（`lane`）放行（`:632`）；N-4/N-5 一個 IPv6 /48 對同一地址每分鐘最多兩次通道檢查、來自兩個不同 /64（`:638`），以及 IPv6 通道圍堵的殘餘成本（`:648`）；N-5 同一 /48 內四個 /64 上的四個智慧錢包一分鐘內都能登入（重現，`:664`）、一個 /64 不能替鄰居花掉 /48 的份額（`:670`）、輪換 /64 仍有上限（`:686`）、IPv4 不變且不儲存或記錄比 /64 更長的 IPv6 位址（`:706`）、部署早於 0005 時沿用 0004 的規則且不回 503（`:732`）。**
- `wallet-client.test.mjs`：用戶端狀態機、EIP-6963、換帳號／錢包、晚回應、多分頁、搬家閘門、`markedHome`、頁面在錢包看到訊息前逐行檢查、簽名視窗開著時的摘要、「登出此裝置」與「登出所有裝置」、W-1、W-3、F-7(e)、A-3、A-4、A-8（A-8 以 `tests/fixtures/wallet-panel.mjs` 子程序用專案自己的 TypeScript 編譯並渲染 `WalletPanel.tsx`）。**本版：N-1 較舊的 session 讀取（「已登出」或「已登入」的回答、晚到的錯誤狀態、失敗或被截斷的 body）在較新的回答之後才到就被丟棄（`:1010`、`:1023`、`:1036`、`:1091`），換帳號或登出時也丟棄（`:1052`），登入點擊會等最新的 session 讀取、cookie 裡已有 session 時不簽任何東西（`:1069`），被取代的 session 的房屋讀取晚到時不改變任何狀態（`:1110`、`:1131`）；N-2 challenge body 在換帳號、換錢包、登出或關頁之後才到，錢包不會被要求簽名、也不送 verify（`:1150`、`:1161`），立刻開始的新登入不受舊流程影響（`:1179`、`:1217`），錢包在等待中鎖定就不要求簽名（`:1195`），已經打開的簽名視窗在登出後的回答被丟棄（`:1206`），還在等 session 讀取的點擊被關頁或登出結束（`:1235`）；N-7 在別處被撤銷的 session 顯示為「已失效」而不是「已到期」（重現，`:1254`），真正的到期仍顯示到期（`:1270`、`:1291`），「My wallet」面板在本頁登出後顯示 "Signed out."、被撤銷後顯示 "You are no longer signed in"（`:1308`，同樣以 `react-dom/server` 渲染）。另外「Sign out on all devices: every browser of the address is signed out…」（`:208`）現在檢查另一台裝置的結束原因是 `revoked`（已失效）而不是 `expired`，「A-8: a house read that was refused or cut off…」（`:614`）改成以 N-6 的殘餘情境設定。**
- `home-entry.test.mjs`：「進入我的家」的閘門與按鈕、門口幾何、預覽模式、W-1 按下 Enter 時閘門必須當下仍然成立（`:110`）。本版沒有改。
- `review-record.test.mjs`：審查紀錄的內容與標示、連結屬性、每個發現的嚴重度與狀態、`docs/security/AUDIT_REMEDIATION_STATUS.md` 與頁面資料一致且不含禁用字、個人資料或本機路徑、狀態文件引用的每個 `docs/security/*.md` 頁面都必須存在（`:255-257`）、`docs/security/MINT_BOUNDARY.md`（`:278`）。**本版：列出對 Worker `1a0dd495` 的審查 8c3aea2e（部署對照：此審查未評估）與 N-1..N-7，並寫明本版未經重新審查（`:135`）；狀態文件 8c3aea2e 一節每個發現一列，含網站上的嚴重度與狀態、修正 commit、確實存在的 `N-x` 測試，以及 `PARTIAL`／`FIXED_LOCALLY` 與部署版本 `bbf24001`（`:210-228`），每個 N 發現另有自己的區塊（`:250`）。** 本快照的狀態文件是公開版，兩個 regex 也少了兩個內部名稱（`REDACTIONS.md` 第 1.4、1.5 節），測試仍通過。
- `deploy-evidence.test.mjs`：部署證據腳本只輸出結構化欄位，log 裡的 email、本機路徑與其他文字都不會出現在輸出。**本版：migration 清單含 0005（`:47`）；HEAD 的 limiter 鍵含 `chain:index:lane`（`:53`），並以 132228c 與 3f661eb 兩個較早 commit 比對（需要 git 歷史，見上）。**
- `ownership.test.mjs`：ownerOf、Multicall3、候選、快取、失敗回 503、轉手、24 小時計入規則、`chain:index`、`/api/me/home` 只從 session 取地址、Worker 進入點不會載入 `layout.ts`／`households.ts`、A-2、A-4、部署早於 0004 時照舊運作（`:242`）。**本版：N-3 超過 256 個候選時，屋主在最近 24 小時內被看見而能計入的席位仍會被檢查（重現，`:429`），截斷完全依計入規則（`:438`），排序讀取只在超過上限時發生（`:452`），D1 保存的答案也以同樣方式截斷（`:467`）；N-6 一個 IP 的拋棄式登入不再讓新買家第一次找不到席位（重現，`:487`），通道只給「被拒且沒有可計入席位」的讀取（`:500`），每個網路每分鐘一條（`:518`），20 個其他網路仍能在一個地點把被拒的讀取擋在外面、下一分鐘恢復（殘餘，`:526`），全站上限每 6 秒 60 條（`:549`），讀取失敗（不是被拒）不拿通道（`:561`），部署早於 0005 時沒有通道、仍回 `limited` 而不是 503（`:571`）。**
- `presence.test.mjs`：cron 在線紀錄與清理、0002–0004 只增不改、A-2 cron 刪除 8 天以前的索引答案。**本版：migration 建立五個表（`:18`）；0005 只增不改、新欄位起始為空、`index_lanes` 起始為空、0004 的語句照常執行（`:68`）；N-6 cron 刪除一分鐘以前的通道列、0005 之前的資料庫不動（`:100`）。**
- `worker.test.mjs`：路由、rate limit（含 IPv6 /64）、上游請求、進入點只匯出 handler、缺少綁定時 503、`networkKey`、snapshot 的共用副本。**本版：N-5 subscriber 鍵是 /48 網段鍵內的 IPv6 /64，IPv4、IPv4-mapped 與未知的 client 沒有（`:240`）。**
- `headers.test.mjs`：`public/_headers` 與 `API_HEADERS` 的安全標頭、內容雜湊副本的快取。本版沒有改。
- `deploy.test.mjs`：部署腳本的出處紀錄、拒絕 dirty tree 與 `.env`、`deploy-records/` 被 gitignore、部署前先跑完整測試、失敗就停止。本版沒有改。
- `dependencies.test.mjs`（Swarm review F-6 的後續）：lockfile 中沒有任何 undici 落在 GHSA-3wwx-pv8p-q78v 的範圍（7.28.0–7.29.0），且 `package.json` 的 `overrides.undici` 等於 lock 內的版本（`:10`）；這個 override 仍然必要（`:19`）。本版沒有改。

## 2. 團隊端：完整原始碼的測試（不在本快照）

從 commit f4272c5 以 `git -c core.autocrlf=false archive` 取出完整原始碼（90 個測試檔），`npm ci` 後在該副本 `git init` 並提交一次，再 `npm test`：2026-10-01T04:27:12Z–04:27:57Z，Node v24.19.0：**tests 861，pass 860，fail 1**。失敗的是第 1 節那個 deploy-evidence 測試：封存副本沒有私人 repo 的 git 歷史。在私人 repo 的 checkout 中整套 `npm test` 是 861/861；部署紀錄的 manifest 另記錄 2e4e830 正式部署前 `scripts/deploy.mjs` 跑完整測試的結果為 `passed`。原始輸出含被保留測試的名稱與本機路徑，不收錄；其 SHA-256 為 `eb3b5d725c7a28082cf629406d45fb429d3e8198eadb98e2197ebc75254f4e03`。reviewer 無法重跑被保留的測試（房屋擺放、房屋內部、世界內容、纜車與天氣、`links.test.mjs`、`gateway.test.mjs`、`market.test.mjs` 等）。

## 3. 型別檢查（本快照 `source/`）

```text
npx tsc --noEmit      # 2026-10-01T04:25:50Z，不加替身
```

結果：exit 2。16 個錯誤全部來自被保留的檔案（`tsc-noEmit-output.txt`，與上一輪逐字相同）：

- `src/main.tsx` 找不到 `./world/WorldApp`、`./world/bridge.ts`、`./world/dataMode.ts`、`./world/skin/terrainTask.ts`、`./world/screenSpace.ts` 與 `virtual:baked-terrain`；
- `homeEntry.ts`、`HomePanels.tsx` 找不到 `./households.ts`、`./layout.ts`，`WalletPanel.tsx`、`walletView.ts` 找不到 `./households.ts`（只 import 型別）；以及由此連帶產生、在 `HomePanels.tsx` 的一個 TS7006；
- `vite.config.ts` 找不到被保留的建置腳本 `./scripts/content-hash.ts`、`./src/world/skin/terrainField.ts`、`./src/world/skin/terrainBake.ts`。

對應關係見 `SCOPE.md`。因此前端的 `npm run build` 在本快照無法完成；Worker 的建置不受影響。團隊在狀態文件 8c3aea2e 一節說明，修正 commit 的完整原始碼上 `npx tsc --noEmit` 沒有錯誤（團隊端）。

## 4. Worker bundle 重建（本快照 `source/`）

步驟見 `DEPLOYMENT_MATCH.md` 第 3 節。2026-10-01T04:25:20Z 的結果：`index.js` 280,605 bytes，SHA-256 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c`，等於部署紀錄中實際上傳的 bundle。輸出：`worker-dry-run-output.txt`。

## 5. npm audit

```text
npm audit --omit=dev --json   → npm-audit-omit-dev.json   （0 個弱點）
npm audit --json              → npm-audit-all.json         （0 個弱點）
時間：2026-10-01T04:25:55Z（本快照 source/ 的副本，npm ci 之後）
```

與上一輪相同（0 與 0）。`package.json` 與 `package-lock.json` 本版沒有改；`overrides.undici` 仍把 undici 固定在 7.29.1，`tests/dependencies.test.mjs` 檢查這個固定仍然有效且仍然必要。判讀見 `DEPENDENCIES.md`。

## 6. 去敏 SIWE 樣本

```text
cp TESTS/siwe-sample/generate-siwe-sample.mjs <source 副本>/_tmp_siwe.mjs
cd <source 副本> && node _tmp_siwe.mjs <輸出檔>      # 執行後刪除 _tmp_siwe.mjs
```

2026-10-01T04:25:57Z 重新產生。腳本呼叫真正的 `handleAccountApi` 與頁面端 `checkSignInMessage`，用記憶體中臨時產生的合成金鑰與 `node:sqlite` 上的真 migration（0001–0005），時鐘固定 2026-09-29T12:00:00Z，不連網路（ERC-1271 路徑用只回 `eth_getCode = "0x"` 的本機替身）。

**腳本這一版只改了檔頭**：來源 commit、Worker version、migration 範圍與行號更新為 2e4e830／`bbf24001`、0001–0005、`server/auth.ts:430`、`src/world/auth.ts:274-278`。結果與上一輪相同：對同一地址從同一網段在一分鐘內要 6 次 challenge，**6 次都是 200**，同一地址從另一網段同時也是 200；對同一網段在一分鐘內要 30 個不同地址的 challenge：30 次 200，第 31 次回 429 `SIGN_IN_BUSY`（log 行的 `reason` 為 `network`）；logout-all 撤銷 2 個 session。除了檔頭與每次不同的地址、nonce，輸出與上一輪逐字相同。

除了範例訊息，輸出也示範：頁面端檢查對 6 種竄改的結果、Origin、flow、重送、過期、錯誤簽章作廢 challenge、「沒有 code」快取、上述每地址與每網段的行為、logout-all、拒絕 log 的內容（客戶端只以 `net`（其 /24）出現）、session 的 `wallet_type`／`verification_method`。輸出 `siwe-sample/siwe-sample-output.txt` 不含簽章，cookie 已遮蔽。每次執行地址與 nonce 會不同，其餘結構相同。

## 7. 帶金鑰讀取與 limiter 綁定的探測

`probes/keyed-reads-probe.mjs`：用真實 handler、假鏈與合成金鑰，列出不持有任何東西的呼叫者能觸發哪些帶金鑰的 Alchemy 讀取、經過哪些預算，以及缺少 limiter 綁定時的回應。腳本沒有改（檔頭註解仍寫 migration 0001–0003；`tests/d1-sqlite.mjs` 實際套用 `migrations/` 下的全部檔案，本版即 0001–0005），2026-10-01T04:25:58Z 重跑：輸出（`probes/keyed-reads-probe-output.txt`）與上一輪逐字相同，**只有第 3 步不同**。

- 第 3 步（自建 session 的 `home?fresh=1`，`chain:index` 被拒）：上一輪是 0 次讀取、`recheck=limited`；這一輪是 1 次帶金鑰讀取、`recheck=-`，經過的預算多了 `CHAIN(chain:index:lane)`。這是 N-6 的探索通道：主鍵 `chain:index` 拒絕、而這次讀取的答案沒有可計入的席位時，請求者的網路先在 D1 記一條通道（`INDEX_LANE`），再扣 `CHAIN_LIMITER` 的 `chain:index:lane`，兩者都允許才讀一次索引；探測的 limiter 替身只拒絕 `chain:index`，所以通道放行。結果仍要由 `ownerOf` 證明（這個合成帳號沒有席位，`seats=0`）。通道也被拒時仍是 `limited`（`tests/ownership.test.mjs:526`）。
- 其餘各步與上一輪相同：EOA 同一 challenge 送 5 次錯誤簽章只觸發 1 次 `eth_getCode`，之後都是 409（連正確簽章也是）；同一 EOA 下一個 challenge 的錯誤簽章 0 次鏈上讀取；合約地址的錯誤簽章每個 challenge 最多 `eth_getCode`＋`eth_call` 各一次；`chain:code` 被拒時 0 次讀取並回 429 `CHAIN_BUSY`（附 log 行）；verify 用 `verify:` 鍵；自建 session 的 `home?fresh=1` 會扣 `chain:index`；正式網址缺 `AUTH_LIMITER` 時 challenge 回 503 `LIMITER_UNAVAILABLE`（loopback 回 200）；所有 limiter 都拒絕時，logout-all 仍回 200、logout 仍回 204。

## 8. 測試資料的來源

- `source/tests/fixtures/swarm-2026-09-27.json`：IMD 公開名冊 API（`api.imd.fun/swarm`）的回應快照（檔內時間 2026-09-26T17:17:45Z）。其中的席位持有者地址是名冊（公開 API）資料，只出現在這個 fixture；測試裡的其他地址都是合成或虛構的。
- `source/tests/fixtures/activity-0759z.json`：IMD 公開活動資料的快照。
- `source/tests/fixtures/wallet-panel.mjs` 不含資料：它只把父程序傳來的狀態交給 `WalletPanel.tsx` 渲染，頁面主機固定為 `imdember.com`。
- 測試中的錢包金鑰都在執行時於記憶體隨機產生（`tests/wallet-harness.mjs`），執行結束即丟棄。測試用的 IP 都只出現在記憶體中假 request 的標頭裡，測試不連網路；大多是保留位址：文件用（RFC 5737、RFC 3849，本版 N-5 的 IPv6 測試用 `2001:db8::/32`）、`100.64.0.0/10`（RFC 6598）、`198.18.0.0/15`（RFC 2544）與 loopback。少數比較相鄰網段的測試用了文件範圍旁的位址（`192.0.3.x`–`192.0.5.x`、`203.0.114.x`），這些從前幾輪就在。
- `source/tests/deploy-evidence.test.mjs:13` 的假 email（`example.com` 保留網域）、假本機路徑與假 UUID，都是用來確認它們**不會**出現在輸出裡的測試資料。

## 9. 團隊端、不在本快照內的紀錄

- 完整原始碼的 `npm test`（861 項，本檔第 2 節）、私人 checkout 中的 861/861、前端重建與部署紀錄及正式檔案的逐位元組比對（`DEPLOYMENT_MATCH.md` 第 2 節）、部署後的線上檢查與真實錢包登入（`DEPLOYMENT_MATCH.md` 第 2、5 節）。
- 這些屬於團隊端證據；依審查規格的交付要求，**既有團隊 log 不算 reviewer 重新執行的測試**。
