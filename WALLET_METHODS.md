# WALLET_METHODS：錢包方法清冊

這份清冊回答審查重點的第 1 項（持有人審查規格中的錢包方法清冊要求）：連線、登入、恢復 session、登出、進入「我家」與「進入我的家」各流程，實際能呼叫哪些 wallet RPC 方法與 payload。

**結論（與上一輪審查版本相同）：用戶端只呼叫三個 EIP-1193 方法：`eth_accounts`、`eth_requestAccounts`、`personal_sign`。其中 `personal_sign` 只用於 SIWE 登入，而且只在頁面端檢查通過之後。** 沒有交易、沒有 typed data、沒有 Permit／Permit2、沒有 approve／setApprovalForAll、沒有批次呼叫、沒有切換鏈、沒有 session key 或委派。「登出所有裝置」與「進入我的家」都不呼叫錢包；本版的 W-1（本機時鐘判斷 session 到期、分頁回到前景時重讀）、A-3（丟棄較舊的家讀取）與 A-8（查核不完整時的說明文字）也都不呼叫錢包。登入簽章是身分驗證，不是資產授權。這個結論已在本 commit 的 `source/`（取自私人 repo commit `132228c`；進入前端建置的檔案與正式版本的來源 `4321bb4` 相同），以及 2026-09-30T11:57Z 下載的正式主 bundle 與房屋內部 chunk 上重新確認（第 3 節）。

## 1. 原始碼中全部的 provider 呼叫

`source/src/` 內全部的 EIP-1193 `.request(` 只有三處，都在 `src/world/auth.ts`：

| 行 | 方法 | params | 何時呼叫 | 會跳出錢包提示？ |
|---|---|---|---|---|
| `auth.ts:156` | `eth_accounts` | 無 | 頁面載入、或換了錢包（EIP-6963 選擇）時 `bind()`（`auth.ts:154-158`） | 否（只讀已授權的帳號） |
| `auth.ts:228` | `eth_requestAccounts` | 無 | 使用者點「登入」且目前沒有已知帳號時 | 是（連線請求） |
| `auth.ts:247` | `personal_sign` | `[hexUtf8(message), account]`，`message` 是伺服器 `POST /api/auth/challenge` 回傳、由伺服器產生、**並已通過頁面端 `checkSignInMessage` 逐行檢查**的 SIWE 原文 | 同一次登入點擊，伺服器確認此帳號沒有有效 session、而且頁面檢查通過之後（`auth.ts:241-245`；頁面檢查在 `auth.ts:243`） | 是（簽名請求） |

事件：只監聽 `accountsChanged`（`auth.ts:157`）。**不監聽 `chainChanged`**，也不呼叫 `eth_chainId`：SIWE 訊息固定 `Chain ID: 1`，`personal_sign` 與錢包目前所在的鏈無關（`auth.ts:152-153` 註解）。

一次登入點擊最多只會跳出一次簽名提示。伺服器給的訊息不是本站的那一則時，**連一次都不會**（`message-mismatch`）。伺服器拒絕簽章（401）、預算忙碌（429）或暫時無法驗證（503）時，流程結束並顯示提示，**不自動重試**；伺服器已作廢那個 challenge，下一次點擊會拿新的訊息、要求新的簽名（`auth.ts:253,302-306`、`SIWE.md` 第 3 節）。

錢包探索（`src/world/wallet.ts`，本版未改，與上一輪審查版本逐位元組相同）：

- 發出 `eip6963:requestProvider`，監聽 `eip6963:announceProvider`（`wallet.ts:54-60`）。
- 每個 provider 物件一筆；同一 `rdns` 有多個 provider 時標記為 `duplicates`，UI 顯示警告（`wallet.ts:24-25,78-83`）。
- 只有點選（`choose()`，`wallet.ts:72-76`）會把使用中的錢包換成另一個已宣告的錢包。自動選擇只有兩種情況：記住的選擇（rdns）恰好對應一個已宣告錢包時套用它；沒有記住的選擇、而且只有一個錢包宣告時使用它。之後若又有第二個錢包宣告，選擇會退回「需要選擇」，不會自動換成別的錢包。
- 沒有任何錢包宣告時退回 `window.ethereum`（`wallet.ts:65-70`）；這時「我的錢包」面板會顯示一行提醒（`wallet.ts:28-29,87-89`；`WalletPanel.tsx:106`）。這只是提示，不改變任何呼叫。
- 錢包圖示只接受 `data:image/(png|jpeg|gif|webp|svg+xml)` 且 ≤ 64 kB，經由 `<img>` 顯示（`wallet.ts:33-42`）。

## 2. 各流程逐步

| 流程 | 步驟 | 錢包方法 | 伺服器請求 |
|---|---|---|---|
| 首次進站（未連線） | 讀 session、讀已授權帳號 | `eth_accounts`（不提示） | `GET /api/auth/session` |
| 連線＋登入（同一次點擊，`signIn()`，`auth.ts:215-262`） | ① 需要時請求帳號 → ② 若此帳號已有 session，直接讀家，不簽 → ③ 若有別的地址的 session，先登出 → ④ 取 challenge → ⑤ **頁面檢查訊息**，不符就結束 → ⑥ 顯示摘要並簽名 → ⑦ verify | ① `eth_requestAccounts` ⑥ `personal_sign` | ④ `POST /api/auth/challenge {address}` ⑦ `POST /api/auth/verify {nonce,signature}`，之後 `GET /api/me/home` |
| challenge 被預算拒絕（429） | 在第 ⑤ 步之前就結束，顯示「登入服務此刻太忙」 | 只有 ①（如需要） | ④ |
| 訊息不是本站的那一則 | 第 ⑤ 步結束，顯示 `message-mismatch` | 只有 ①（如需要），**沒有** `personal_sign` | ④ |
| 重新整理頁面（恢復 session） | 讀 cookie session，再讀家 | `eth_accounts`（不提示）；**不簽名** | `GET /api/auth/session`、`GET /api/me/home` |
| 分頁回到前景（W-1） | 到期的 session 立刻在本頁結束；有 session 時最多每 15 秒重讀一次（`auth.ts:117-135`） | **無** | `GET /api/auth/session`，之後 `GET /api/me/home` |
| 進入「我家」／回家 | 開面板或地圖標記；鏡頭移動 | 無 | `GET /api/me/home`（最少間隔 15 秒；分頁可見時屋主模式每 60 秒） |
| 進入我的家（房屋內部） | `enterableHome` 不為 null 時才出現按鈕；載入房屋內部 chunk 與同 origin 的靜態模型，用已讀到的席位資料繪製 | **無** | **無新的 API 請求**（只有靜態檔 `assets/InteriorView-wZGOk4w6.js`、`models/interior/*.glb`） |
| 搬家 | `moveGate` 檢查屋主模式，選地塊，寫 localStorage | **無** | **無** |
| 查看任一錢包（輸入地址） | 顯示公開名冊的席位 | 無 | `GET /api/wallet/:address/assets` |
| 登出此裝置 | 伺服器撤銷後才在頁面上登出 | 無 | `POST /api/auth/logout` |
| 登出所有裝置 | 行內確認後，伺服器撤銷該地址所有 session | 無 | `POST /api/auth/logout-all` |
| 錢包切換帳號 A→B | 關閉屋主模式，登出 A 的 session 與進行中的流程 | 無（只收 `accountsChanged` 事件） | `POST /api/auth/logout`；失敗則重讀 session 並顯示 mismatch |
| 使用者改選另一個錢包 | 作廢進行中的流程，重新 bind | `eth_accounts`（不提示） | 進行中時 `POST /api/auth/logout` |
| 拒絕連線／拒絕簽名 | 顯示提示，**不自動重試** | — | — |

## 3. 正式檔案上的重新計數（可自行驗證）

2026-09-30T11:57:38Z 下載的正式主 bundle `https://imdember.com/assets/index-BFVt9xb_.js`（SHA-256 `ec1f3da36a0141f0308e384284e41cc97f344d7fbed594ede9071994c7ea58d2`，1,383,354 bytes）與 11:57:51Z 下載的房屋內部 chunk `https://imdember.com/assets/InteriorView-wZGOk4w6.js`（SHA-256 `13616a8827bfa406b285833d404d5d4f3e49ca9649dd5d0e9adb11944677cbbd`，93,255 bytes），兩者都與部署紀錄及團隊重建結果相同：

| 字串 | 主 bundle | 房屋內部 chunk |
|---|---|---|
| `.request(`（全部） | **3**：`` .request({method:`eth_accounts`}) ``、`` .request({method:`eth_requestAccounts`}) ``、`` .request({method:`personal_sign`,params:[…]}) `` | 3，全部是繪製迴圈自己的 `this.request()`（排程重畫），不是 EIP-1193 |
| `eth_accounts`、`eth_requestAccounts`、`personal_sign` | 各 1 | 0 |
| `eth_sendTransaction`、`eth_sendRawTransaction`、`eth_signTransaction` | 0 | 0 |
| `eth_signTypedData`、`signTypedData`、`` eth_sign` ``、`eth_sign"` | 0 | 0 |
| `Permit2`、`permit`（不分大小寫） | 0 | 0 |
| `setApprovalForAll` | 0 | 0 |
| `approve`（不分大小寫） | 2，只在 UI 文字：`The wallet did not approve the connection.`，以及簽名前說明中的「授權（approve）」 | 0 |
| 函式選擇器 `0x095ea7b3`（approve）、`0xa22cb465`（setApprovalForAll）、`0xd505accf`（permit） | 0 | 0 |
| `wallet_sendCalls`、`wallet_getCallsStatus`、`wallet_grantPermissions`、`wallet_requestPermissions` | 0 | 0 |
| `wallet_switchEthereumChain`、`wallet_addEthereumChain`、`wallet_watchAsset`、`eth_chainId`、`chainChanged` | 0 | 0 |
| `sendAsync` | 0 | 0 |
| `accountsChanged` | 2（註冊與移除監聽） | 0 |
| `eip6963:requestProvider`／`eip6963:announceProvider` | 1／2 | 0／0 |
| `WebSocket`、`EventSource`、`eval(`、`new Function`、`document.cookie`、`document.write` | 0 | 0 |
| `import(` | 1：`` import(`./InteriorView-wZGOk4w6.js`) `` | 0 |
| `fetch`、`localStorage`、`BroadcastChannel`、`postMessage` | （主 bundle 有，見 `SCOPE.md` 第 6.3 節） | 0 |

每一個數字都與上一輪（2026-09-29T05:52Z 下載的 `index-Bj4ribmm.js`，SHA-256 `70742ed409b55a400cb8439c3cb5e4bac719f8a4763083c77764d3a7283ef528`，與 `InteriorView-Xan3ABOQ.js`）的計數相同：三個錢包方法與它們的呼叫點沒有增減。原始碼端，`src/world/auth.ts` 本版改的是 W-1、A-3、A-8 的狀態處理（上表的呼叫只是行號位移），`src/world/wallet.ts` 沒有改。兩版 bundle 的其餘差異（頁面內容、世界與效能工作）這裡沒有逐字比對。

重現方法（任何人都可以做）：

```sh
curl -s -o index.html https://imdember.com/
grep -o 'assets/[^"]*' index.html                      # 目前的主 JS 與 CSS 檔名
curl -s -o index.js https://imdember.com/assets/index-BFVt9xb_.js
grep -o 'InteriorView-[A-Za-z0-9_-]*\.js' index.js       # 房屋內部 chunk 的檔名
curl -s -o interior.js https://imdember.com/assets/InteriorView-wZGOk4w6.js
sha256sum index.js interior.js
grep -o -E '.{0,25}\.request\(.{0,40}' index.js interior.js
for w in eth_sendTransaction signTypedData Permit2 setApprovalForAll wallet_sendCalls \
         wallet_switchEthereumChain eth_chainId chainChanged 0x095ea7b3 0xa22cb465 WebSocket EventSource; do
  printf '%s\t%s\t%s\n' "$w" "$(grep -o -F "$w" index.js | wc -l)" "$(grep -o -F "$w" interior.js | wc -l)"; done
```

注意：壓縮後的 bundle 用反引號字串（`` `eth_accounts` ``），搜尋時不要假設是雙引號。正式站日後換版時檔名會改變，請先從 `https://imdember.com/` 取得目前的檔名與雜湊。

【限制】靜態計數排除不了「方法名稱在執行期組字串」的寫法；但全部 EIP-1193 呼叫點只有 3 處，而且方法名稱都是字面常數。

## 4. 伺服器端的鏈上呼叫

伺服器沒有私鑰，也不送交易。它對 Alchemy（以太坊主網）只用兩個 JSON-RPC 方法，外加 Alchemy 的 NFT 索引 REST：

| 呼叫 | 用途 | 前提 | 位置 |
|---|---|---|---|
| `eth_getCode` | verify 時判斷地址是否為合約（決定是否走 ERC-1271） | ECDSA 不符；該地址不在 60 秒「沒有 code」快取中、不是已知智慧錢包；已認領這個 challenge（網段份額內）且每據點 `chain:code` 允許 | `server/auth.ts:294-306` |
| `eth_call` → 地址的 `isValidSignature(bytes32,bytes)`（view） | ERC-1271 合約錢包驗簽，回傳必須完全等於 magic word；節點錯誤是 503、只有 revert 是 401（W-3） | 地址有 code（或為已知智慧錢包），合約查核份額（或 A-1 的 lane 查核）與 `chain:erc1271`（或 `chain:erc1271:known`、`chain:erc1271:lane`）都允許；每個 challenge 最多一次 | `server/auth.ts:307-314` |
| `eth_call` → Multicall3 `aggregate3`（內含 `ownerOf` 與 `getBlockNumber`） | 所有權證明 | 有候選席位（最多 256 個，A-4 先排序） | `server/ownership.ts:52-70` |
| `GET …/nft/v3/getNFTsForOwner` | 所有權候選（不是證明） | 每次都先扣 `CHAIN_LIMITER`（`chain:index`）；被拒則不讀，改用 IMD 名冊與保留的索引答案（A-2：D1 `index_candidates`，不需金鑰） | `server/ownership.ts:17,74-96,216-230` |

Alchemy 金鑰是 Worker secret `ALCHEMY_API_KEY`，只放在 `Authorization` 標頭，不會送到瀏覽器（`server/ownership.ts:13,39-44,83`；CSP `connect-src` 也不允許瀏覽器連 Alchemy API）。

## 5. 註解：Worker bundle 中的 `privateKey`

從本快照 `source/` 重建的 Worker bundle（`index.js`，274,961 bytes，SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`，與部署紀錄中實際上傳的 bundle 相同；重建步驟見 `DEPLOYMENT_MATCH.md` 第 3 節，輸出見 `TESTS/worker-dry-run-output.txt`）中，`privateKey` 區分大小寫出現 13 處，不分大小寫 38 處（多出的是 `normPrivateKeyToScalar`、`randomPrivateKey` 等），與上一輪相同。全部是打包進來的 `@noble/curves`／viem 函式庫程式碼，不是金鑰材料；伺服器原始碼沒有呼叫任何簽名 API。
