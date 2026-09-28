# WALLET_METHODS：錢包方法清冊

這份清冊回答審查重點的第 1 項（持有人審查規格中的錢包方法清冊要求）：連線、登入、恢復 session、進入「我家」各流程，實際能呼叫哪些 wallet RPC 方法與 payload。

**結論：用戶端只呼叫三個 EIP-1193 方法：`eth_accounts`、`eth_requestAccounts`、`personal_sign`。其中 `personal_sign` 只用於 SIWE 登入。** 沒有交易、沒有 typed data、沒有 Permit／Permit2、沒有 approve／setApprovalForAll、沒有批次呼叫、沒有切換鏈、沒有 session key 或委派。本輪沒有觀察到任何轉帳、ERC20／NFT 授權或委派，因為程式裡根本沒有這些呼叫。登入簽章是身分驗證，不是資產授權。這個結論已在 0def8cb 的原始碼與 2026-09-28T16:06Z 下載的正式 bundle 上重新確認（第 3 節）。

## 1. 原始碼中全部的 provider 呼叫

`source/src/` 內全部的 `.request(` 只有三處，都在 `src/world/auth.ts`：

| 行 | 方法 | params | 何時呼叫 | 會跳出錢包提示？ |
|---|---|---|---|---|
| `auth.ts:113` | `eth_accounts` | 無 | 頁面載入、或換了錢包（EIP-6963 選擇）時 `bind()` | 否（只讀已授權的帳號） |
| `auth.ts:182` | `eth_requestAccounts` | 無 | 使用者點「登入」且目前沒有已知帳號時 | 是（連線請求） |
| `auth.ts:196` | `personal_sign` | `[hexUtf8(message), account]`，`message` 是伺服器 `POST /api/auth/challenge` 回傳、由伺服器產生的 SIWE 原文 | 同一次登入點擊，且伺服器確認此帳號沒有有效 session 之後 | 是（簽名請求） |

事件：只監聽 `accountsChanged`（`auth.ts:114`）。**不監聽 `chainChanged`**，也不呼叫 `eth_chainId`：SIWE 訊息固定 `Chain ID: 1`，`personal_sign` 與錢包目前所在的鏈無關（`auth.ts:109-110` 註解）。

一次登入點擊最多只會跳出一次簽名提示：伺服器拒絕簽章（401）、預算忙碌（429 `SIGN_IN_BUSY`／`CHAIN_BUSY`）或暫時無法驗證（503）時，流程結束並顯示提示，**不自動重試**；伺服器已作廢那個 challenge，下一次點擊會拿新的訊息、要求新的簽名（`auth.ts:243-247`、`SIWE.md` 第 3 節）。

錢包探索（`src/world/wallet.ts`）：

- 發出 `eip6963:requestProvider`，監聽 `eip6963:announceProvider`（`wallet.ts:54-60`）。
- 每個 provider 物件一筆；一個 provider 不會取代另一個；同一 `rdns` 有多個 provider 時標記為 `duplicates`，UI 顯示警告（`wallet.ts:24-25,78-83`）。
- 只有點選（「我的錢包」的 `choose()`，`wallet.ts:72-76`）會把使用中的錢包**換成另一個**已宣告的錢包。自動選擇只有兩種情況（`wallet.ts:78-83`）：記住的選擇（rdns）恰好對應一個已宣告錢包時套用它；沒有記住的選擇、而且只有一個錢包宣告時使用它。之後若又有第二個錢包宣告，選擇會退回「需要選擇」（`needsChoice`，使用中的 provider 變成 null），不會自動換成別的錢包。
- 沒有任何錢包宣告時退回 `window.ethereum`（`wallet.ts:65-70`）；這種情況下無法分辨多個注入的錢包。**0def8cb 起，這時「我的錢包」面板會顯示一行提醒**（`unidentified`，`wallet.ts:28-29,83,87-89`；`WalletPanel.tsx:101`）：「這個錢包沒有用 EIP-6963 表明身分，無法辨識是哪一個擴充功能；簽名前請確認跳出的是你信任的錢包。」這只是提示，不改變任何呼叫。
- 錢包圖示只接受 `data:image/(png|jpeg|gif|webp|svg+xml)` 且 ≤ 64 kB，經由 `<img>` 顯示（`wallet.ts:33-42`）。

## 2. 各流程逐步

| 流程 | 步驟 | 錢包方法 | 伺服器請求 |
|---|---|---|---|
| 首次進站（未連線） | 讀 session、讀已授權帳號 | `eth_accounts`（不提示） | `GET /api/auth/session` |
| 連線＋登入（同一次點擊，`signIn()`，`auth.ts:169-211`） | ① 需要時請求帳號 → ② 若此帳號已有 session，直接讀家，不簽 → ③ 若有別的地址的 session，先登出 → ④ 取 challenge → ⑤ 簽名 → ⑥ verify | ① `eth_requestAccounts` ⑤ `personal_sign` | ④ `POST /api/auth/challenge {address}` ⑥ `POST /api/auth/verify {nonce,signature}`，之後 `GET /api/me/home` |
| challenge 被預算拒絕（429 `SIGN_IN_BUSY`） | 在第 ⑤ 步之前就結束，顯示「登入服務此刻太忙」 | 只有 ①（如需要） | ④ |
| 重新整理頁面（恢復 session） | 讀 cookie session，再讀家 | `eth_accounts`（不提示）；**不簽名** | `GET /api/auth/session`、`GET /api/me/home` |
| 進入「我家」／回家 | 開面板或地圖標記；鏡頭移動 | 無 | `GET /api/me/home`（最少間隔 15 秒；分頁可見時屋主模式每 60 秒） |
| 搬家 | `moveGate` 檢查屋主模式，選地塊，寫 localStorage | **無** | **無**（只寫 `localStorage['ember-world-moves-v1-<mode>']`） |
| 查看任一錢包（輸入地址） | 顯示公開名冊的席位 | 無 | `GET /api/wallet/:address/assets` |
| 登出 | 伺服器撤銷後才在頁面上登出 | 無 | `POST /api/auth/logout` |
| 錢包切換帳號 A→B | 關閉屋主模式，登出 A 的 session 與進行中的流程 | 無（只收 `accountsChanged` 事件） | `POST /api/auth/logout`；失敗則重讀 session 並顯示 mismatch |
| 使用者改選另一個錢包 | 作廢進行中的流程，重新 bind | `eth_accounts`（不提示） | 進行中時 `POST /api/auth/logout` |
| 拒絕連線／拒絕簽名 | 顯示提示，**不自動重試** | — | — |

## 3. 不存在的方法（可自行驗證）

在正式站 bundle `https://imdember.com/assets/index-BPJxeGls.js`（SHA-256 `3ba7f1e06d50d8a05f90bf23e7ccdbff0e6daf2717ce6e2cbe8e42319970277e`，1,306,006 bytes，與部署紀錄及重建結果相同）上計數，2026-09-28T16:06Z：

| 字串 | 次數 |
|---|---|
| `.request(`（全部） | **3**：`` .request({method:`eth_accounts`}) ``、`` .request({method:`eth_requestAccounts`}) ``、`` .request({method:`personal_sign`,params:[…]}) `` |
| `eth_accounts`、`eth_requestAccounts`、`personal_sign` | 各 1 |
| `eth_sendTransaction`、`eth_sendRawTransaction`、`eth_signTransaction` | 0 |
| `eth_signTypedData`、`signTypedData`、`` eth_sign` ``、`eth_sign"` | 0 |
| `Permit2`、`permit`（不分大小寫） | 0 |
| `setApprovalForAll` | 0 |
| `approve`（不分大小寫） | 1，只在 UI 文字 `The wallet did not approve the connection.` |
| 函式選擇器 `0x095ea7b3`（approve）、`0xa22cb465`（setApprovalForAll）、`0xd505accf`（permit） | 0 |
| `wallet_sendCalls`、`wallet_getCallsStatus`、`wallet_grantPermissions`、`wallet_requestPermissions` | 0 |
| `wallet_switchEthereumChain`、`wallet_addEthereumChain`、`wallet_watchAsset`、`eth_chainId`、`chainChanged` | 0 |
| `WebSocket`、`EventSource`、`import(` | 0 |
| `accountsChanged` | 2（註冊與移除監聽） |
| `eip6963:requestProvider`／`eip6963:announceProvider` | 1／2 |

重現方法（任何人都可以做）：

```sh
curl -s -o index.js https://imdember.com/assets/index-BPJxeGls.js
sha256sum index.js     # 應為 3ba7f1e06d50d8a05f90bf23e7ccdbff0e6daf2717ce6e2cbe8e42319970277e
grep -o -E '.{0,25}\.request\(.{0,40}' index.js
for w in eth_sendTransaction signTypedData Permit2 setApprovalForAll wallet_sendCalls \
         wallet_switchEthereumChain eth_chainId chainChanged 0x095ea7b3 0xa22cb465 WebSocket EventSource; do
  printf '%s\t%s\n' "$w" "$(grep -o -F "$w" index.js | wc -l)"; done
```

注意：壓縮後的 bundle 用反引號字串（`` `eth_accounts` ``），搜尋時不要假設是雙引號。正式站日後換版時檔名會改變，請先從 `https://imdember.com/` 的 `<script>` 取得目前的檔名與雜湊。

## 4. 伺服器端的鏈上呼叫

伺服器沒有私鑰，也不送交易。它對 Alchemy（以太坊主網）只用兩個 JSON-RPC 方法，外加 Alchemy 的 NFT 索引 REST：

| 呼叫 | 用途 | 前提 | 位置 |
|---|---|---|---|
| `eth_getCode` | verify 時判斷地址是否為合約（決定是否走 ERC-1271） | ECDSA 不符，且在 D1 認領了這個 challenge、網段份額與 `CHAIN_LIMITER`（`chain:erc1271`）都允許 | `server/auth.ts:146-148` |
| `eth_call` → 地址的 `isValidSignature(bytes32,bytes)`（view） | ERC-1271 合約錢包驗簽，回傳必須完全等於 magic word | 同上，且地址有 code | `server/auth.ts:151-153` |
| `eth_call` → Multicall3 `aggregate3`（內含 `ownerOf` 與 `getBlockNumber`） | 所有權證明 | 有候選席位 | `server/ownership.ts:52-67` |
| `GET …/nft/v3/getNFTsForOwner` | 所有權候選（不是證明） | 每次都先扣 `CHAIN_LIMITER`（`chain:index`）；被拒則不讀 | `server/ownership.ts:16,166-172` |

Alchemy 金鑰是 Worker secret `ALCHEMY_API_KEY`，只放在 `Authorization` 標頭，不會送到瀏覽器（`server/ownership.ts:10-14,41-42`；CSP `connect-src` 也不允許瀏覽器連 Alchemy API）。

## 5. 註解：Worker bundle 中的 `privateKey`

從本快照 `source/` 重建的 Worker bundle（`index.js`，SHA-256 `4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3`，與部署紀錄中實際上傳的 bundle 相同；重建步驟見 `DEPLOYMENT_MATCH.md` 第 3 節）中，`privateKey` 區分大小寫出現 13 處，不分大小寫 38 處（多出的是 `normPrivateKeyToScalar`、`randomPrivateKey` 等）。全部是打包進來的 `@noble/curves`／viem 函式庫程式碼（簽章函式庫本身就有產生金鑰的 API），不是金鑰材料；伺服器原始碼沒有呼叫任何簽名 API。
