# SIWE：登入訊息、頁面端檢查、伺服器驗證、nonce、預算、session、cookie 與 CSRF

原始碼：`source/src/world/siwe.ts`（statement、頁面端檢查與摘要，伺服器與頁面共用）、`source/server/auth.ts`（伺服器）、`source/worker/app.ts`（limiter 與網段鍵）、`source/src/world/auth.ts`（用戶端狀態機）、`source/src/world/walletView.ts`（簽名前說明與簽名中摘要）、`source/migrations/0001`～`0003`（commit 2da46cd）。

## 1. 去敏的登入訊息範例（合成資料）

> **這是合成樣本，不是正式登入。** 地址來自本機臨時產生的合成金鑰（只存在記憶體、用完即丟、不控制任何資產）；nonce 由伺服器程式隨機產生、只存在本機記憶體資料庫。**檔案不含任何簽章**，cookie 值已遮蔽。沒有對 imdember.com 或任何網路發出請求（ERC-1271 路徑用的是只回 `eth_getCode = "0x"` 的本機替身）。

產生方式：呼叫真正的 `handleAccountApi` → `challenge()` → viem `createSiweMessage`（`server/auth.ts:297-298`），資料庫是 `node:sqlite` 跑真正的三個 migration，時鐘固定在 2026-09-29T12:00:00Z；再用真正的頁面端 `checkSignInMessage` 檢查同一則訊息。產生腳本：`TESTS/siwe-sample/generate-siwe-sample.mjs`；完整輸出：`TESTS/siwe-sample/siwe-sample-output.txt`。

```text
imdember.com wants you to sign in with your Ethereum account:
0xf8Bf960426e249f886f24A0a20519D3675aCE5e6

Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.

URI: https://imdember.com/
Version: 1
Chain ID: 1
Nonce: 122ed2209ef36bf6fd3e9a1854fbd0d5
Issued At: 2026-09-29T12:00:00.000Z
Expiration Time: 2026-09-29T12:05:00.000Z
```

錢包收到的是這段文字的 UTF-8 hex：`personal_sign` params `[hexUtf8(message), account]`（`src/world/auth.ts:207`），而且只在頁面檢查通過之後（第 7 節）。

**與送審版本的差異**：statement 由「…This does not authorize asset transfers or transactions.」改為「…This does not authorize asset transfers, token or NFT approvals, or transactions.」（F-1）；其他欄位不變。伺服器仍接受上一版措辭的 challenge（`SIWE_PREVIOUS_STATEMENTS`，`server/auth.ts:142`），因為部署前簽發的 challenge 最多還會開著 5 分鐘；頁面只接受新措辭。

## 2. 訊息欄位

訊息**完全由伺服器產生**並存入 `login_challenges.message`；用戶端只能提供 `address`，無法影響其他欄位（`server/auth.ts:290-298`）。

| 欄位 | 值 | 來源 |
|---|---|---|
| domain | `new URL(origin).host`，正式環境只能是 `imdember.com` | Origin 允許清單（`auth.ts:20,181-189`） |
| address | `getAddress(輸入)`（EIP-55 checksum） | 請求 body，須為 40 位 hex |
| statement | 固定：`Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.` | `SIWE_STATEMENT`（`src/world/siwe.ts:6`，伺服器以 `server/auth.ts:8` import） |
| URI | `origin + '/'` | |
| Version | `1` | |
| Chain ID | `1`（固定，與錢包目前的鏈無關） | |
| Nonce | 16 bytes 隨機值的 hex（128 bit，`crypto.getRandomValues`） | `auth.ts:191,296` |
| Issued At | 伺服器現在時間 | |
| Expiration Time | Issued At + 5 分鐘（等於 challenge 可接受的時間窗） | `CHALLENGE_TTL_MS`（`auth.ts:25`） |
| Not Before／Request ID／Resources | 無 | |

Session 的有效期（7 天）寫在 statement 文字裡；SIWE 的 Expiration Time 只表示「這個 challenge 5 分鐘內要簽完」。

## 3. 伺服器驗證順序（`POST /api/auth/verify`，`auth.ts:316-377`）

1. `AUTH_LIMITER` 以 `verify:`＋IP 為鍵（與 challenge 分開計數，`auth.ts:441-442`、`worker/app.ts:75`）。body 必須是 JSON、≤ 2048 bytes；`nonce` 為 32 位小寫 hex，`signature` 為 hex。
2. 依 nonce 讀 `login_challenges`；不存在 → 409 `CHALLENGE_USED`。
3. flow cookie 的 SHA-256 必須等於該列的 `flow_hash`，且請求 Origin 等於該列的 `origin`；否則 403 `FLOW_MISMATCH`。**到這一步為止都不寫資料庫**，所以沒有這個瀏覽器 flow cookie 的人無法作廢別人的 challenge。
4. 已使用或已作廢 → 409；`now >= accept_until` → 410 `CHALLENGE_EXPIRED`。
5. **從這裡開始，verify 判定的每一種拒絕（400 `UNSUPPORTED_SIGNATURE`、401 `SIGNATURE_INVALID`、429 `CHAIN_BUSY`、503 `VERIFY_UNAVAILABLE`）都會作廢（burn）這個 challenge**（`auth.ts:331-333`）。例外：limiter 綁定不存在（503 `LIMITER_UNAVAILABLE`）或 D1 丟例外（503 `AUTH_UNAVAILABLE`）時，請求在 burn 之前就結束；若它已被認領（`checked_at` 已寫入），同一個 nonce 之後不會再觸發 ERC-1271（409），只有真正簽署者的 ECDSA 簽章還能成功。
6. 以 ERC-6492 magic suffix 結尾的簽章（未部署的智慧帳戶）→ 作廢，400 `UNSUPPORTED_SIGNATURE`。
7. **從資料庫的原文**重新 parse 並驗證：viem `validateSiweMessage`（domain、nonce、address、時間），另外逐項檢查 URI、`chainId === 1`、version、statement（新措辭或 `SIWE_PREVIOUS_STATEMENTS` 之一），以及 Issued At／Expiration Time **必須等於**該列的 `issued_at`／`accept_until`（`auth.ts:337-340`）。任何不符 → 作廢，401。
8. 驗簽（`verifySignature`，`auth.ts:252-275`），每一步都在它要付費的讀取**之前**檢查：
   - 先 ECDSA `recoverMessageAddress`（EOA、EIP-7702 委派 EOA）；相符 → `ECDSA`，**不做任何鏈上讀取**。
   - 不符時，若這個 Worker isolate 在 60 秒內已確認該地址「沒有 code」→ 401（不認領、不讀鏈，`auth.ts:222-226,257`）。
   - 查詢該地址是否為「已知智慧錢包」（`KNOWN_ERC1271`：有以 ERC-1271 建立、仍保留的 session；走部分索引 `sessions_erc1271`，最多讀一筆，`auth.ts:132`）。
   - **認領**（`CLAIM_ERC1271` 與 `BURN_UNCLAIMED` 在同一 batch，`auth.ts:119-120,136,343-346`）：只有在該 challenge 還沒被查過、而且它的網段 60 秒內認領少於 10 次（已知智慧錢包不受這個份額限制）時才寫入 `checked_at`。份額拒絕 → 429 `CHAIN_BUSY`；已被別的請求認領 → 409。**每個 challenge 最多一次 ERC-1271 查核**，並發的重送也一樣。
   - 不是已知智慧錢包時：先扣每據點 `chain:code`（`API_LIMITER`，180／分，fail closed），再送帶金鑰的 `eth_getCode`；沒有 code → 401（並快取 60 秒），回應格式錯誤或節點失敗 → 503 `VERIFY_UNAVAILABLE`。
   - 有 code（或已知智慧錢包）時：合約查核 `CLAIM_CONTRACT`（寫 `called_at`；該網段每分鐘 3 次、該合約地址每分鐘 2 次，跨所有網段，`auth.ts:124-126,348-352`），再扣每據點 `CHAIN_LIMITER`：已知智慧錢包用 `chain:erc1271:known`，否則 `chain:erc1271`（各 20／分）。任何一層拒絕 → 作廢，429 `CHAIN_BUSY`。
   - 全部通過後，在主網 `latest` 呼叫一次 ERC-1271 `isValidSignature`，回傳必須**完全等於** `0x1626ba7e` 加 56 個 0 → `ERC1271`；否則 401。
9. **原子消耗**（`auth.ts:362-376`）：在同一個 D1 batch 中
   - `UPDATE login_challenges SET used_at, session_hash WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL AND accept_until > now`
   - `INSERT INTO sessions(…, wallet_type, verification_method) SELECT … FROM login_challenges WHERE nonce=? AND session_hash=?`（`wallet_type` 為 `EOA`／`CONTRACT`，`verification_method` 為 `ECDSA`／`ERC1271`，只供稽核與除錯，不回傳、不授予任何東西，F-2）
   只有真正搶到 UPDATE 的那一次會插入 session；`sessions.nonce UNIQUE` 是第二道鎖。並發的重送得到 409。除了 UNIQUE 競爭之外的寫入失敗（例如正式 D1 缺少 0003 的欄位）會回 503 `AUTH_UNAVAILABLE` 並寫一行 log，不會變成無聲的 409（`auth.ts:370-374`）。時鐘在這一步重讀一次。

本機實測（真實 handler、合成金鑰，`TESTS/siwe-sample/siwe-sample-output.txt`）：Origin 為 `https://evil.example` → 403；缺 flow cookie → 403；正確簽章 → 200；同一組 nonce＋簽章重送 → 409；簽發滿 5 分鐘後驗證 → 410；另一把合成金鑰的簽章 → 401（只送了一次 `eth_getCode`），之後同一 nonce 即使送正確簽章也是 409；同一地址 60 秒內的下一個 challenge 再用錯誤簽章 → 401 且**不讀鏈**；同一地址從同一網段一分鐘內第 6 個 challenge → 429（同一地址從另一網段 → 200）；同一網段一分鐘內第 31 個 challenge → 429（另一網段 → 200）；logout-all 撤銷同一地址另一個瀏覽器的 session。

## 4. Session 與 cookie

| 項目 | 實作 |
|---|---|
| token | 32 bytes 隨機值（256 bit），base64url，43 字元（`auth.ts:362`） |
| 資料庫 | 只存 `SHA-256(token)`（`sessions.token_hash`）；另存地址、chain_id、建立與到期時間、`revoked_at`、nonce、`wallet_type`、`verification_method` |
| cookie | `__Host-imd_session=<token>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=<到期前剩餘秒數>`（`auth.ts:199,376`） |
| 有效期 | 固定為 challenge 的 `issued_at + 7 天`，**不續期**（`SESSION_TTL_MS`） |
| 讀取 | cookie 格式必須是 43 字元 `[\w-]`；查無、已撤銷 → 視為未登入；過期 → `SESSION_EXPIRED`；兩者都會清掉 cookie（`auth.ts:278-287,378-383`） |
| 登出此裝置 | `UPDATE sessions SET revoked_at`，並作廢本瀏覽器 flow 的未用 challenge；回 204 並清除兩個 cookie（`auth.ts:385-392`）。冪等；Worker 不對它限流 |
| 登出所有裝置 | 需要本請求自己的有效 session；撤銷該地址**所有**仍有效的 session（`REVOKE_ALL_SESSIONS`，部分索引 `sessions_live`）、作廢該地址過去 5 分鐘內與本 flow 未完成的 challenge；回 200 `{revoked}` 並清除兩個 cookie（`auth.ts:393-407`）。沒有有效 session → 401，不結束任何人。Worker 不對它限流 |
| 清理 | cron（每 15 分鐘）刪除：簽發超過 10 分鐘、從未使用的 challenge；已使用、而且時間窗結束超過一天的 challenge；過期超過一天的 session（`server/presence.ts:29-35,42`，本版未改）。被撤銷的 session 保留到過期後一天才刪 |
| 登入流程 cookie | `__Host-imd_flow`：16 bytes 隨機 hex，`SameSite=Strict`、Max-Age 300；DB 只存 SHA-256。每次 challenge 都發新值，**不採用用戶端帶來的值**；帶來的舊值只用來作廢它先前開的 challenge，而且只在新 challenge 真的寫入時才作廢（`auth.ts:293-306`） |

用戶端 JavaScript 讀不到 session cookie（HttpOnly）。瀏覽器 localStorage 只存一個「提示」：`ember-world-session-hint` = `{address, expiresAt}`，不含 token（`src/world/auth.ts:66-72`）。

## 5. CSRF、Origin 與跨站

- 四個 POST（challenge、verify、logout、logout-all）都要求 `Origin` 在允許清單內（`https://imdember.com`；loopback origin 只在請求本身打到 loopback 時接受）。沒有 Origin → 403。
- 四個 POST 都要求 `Content-Type: application/json`（HTML 表單無法送出，會觸發 CORS preflight，而伺服器不回任何 CORS 標頭）。
- flow cookie 是 `SameSite=Strict` 並綁定 challenge 與 origin（login CSRF 防護）；session cookie 是 `Lax`。
- 所有 Worker 回應都沒有 `Access-Control-*`；`Cross-Origin-Resource-Policy: same-origin`；`frame-ancestors 'none'`（API 與靜態檔都有）；`X-Frame-Options: DENY` 只在靜態檔。
- `GET /api/me/home` 先讀 session 再扣 `AUTH_LIMITER`（`auth.ts:459-464`）。跨站的**頂層 GET 導覽**會附上 Lax cookie：第三方頁面可以讓已登入者的瀏覽器開啟 `/api/me/home`，消耗該 session 的 `home` 份額與所在據點的 `chain:index`（F-7b，列為已知；回應第三方讀不到，不寫任何東西）。

## 6. 速率限制、登入預算與失敗行為

完整分層表見 `ROUTES.md` 第 4 節。要點：

| 層 | 內容 | 位置 |
|---|---|---|
| L1 每網段（D1，全球） | challenge 30／分；ERC-1271 認領 10／分；合約查核 3／分 | `server/auth.ts:98-100,105-108,119-126` |
| L2 每錢包（D1，全球） | 同一地址從同一網段 challenge 5／分（冷卻，只綁 (地址, 網段)，別處的人無法用它鎖住持有人）；同一地址被許多網段要求時只寫 `auth_surge` log；同一合約地址 ERC-1271 查核 2／分 | 同上、`auth.ts:311-313` |
| L3 每 challenge | 一次性 nonce、5 分鐘、任何失敗即作廢、最多一次 ERC-1271 | `auth.ts:326-340` |
| L4 每據點（Cloudflare limiter） | `AUTH_LIMITER` challenge 與 verify 各 20／分（每 IP）；`chain:code` 180／分；`chain:erc1271`、`chain:erc1271:known` 各 20／分；丟例外時拒絕 | `worker/app.ts:61-77`、`server/auth.ts:149-159,208-211` |
| L5 全站（D1） | challenge 閥門 6 秒 60 個（600／分），只當緊急上限 | `server/auth.ts:98,108` |
| 邊緣 WAF | 同一 IP 10 秒內超過 20 個 `/api/` 請求時 Block 10 秒（團隊端） | `ROUTES.md` 第 4 節 |
| 缺少 limiter 綁定 | 正式網址上需要它的路由回 503 `LIMITER_UNAVAILABLE`；只有 loopback 放行（`chain` 仍拒絕）；登出不受影響 | `worker/app.ts:74`、`server/auth.ts:468` |

三個 challenge 預算寫在 `INSERT … SELECT … WHERE` 這一個敘述裡（`INSERT_CHALLENGE`），計數與寫入是同一步，不會因為並發而超額；每個計數都用 `LIMIT` 限制掃描量，並使用 0002、0003 新增的索引。程式註解（`server/auth.ts:74-97`）列出每次登入的 D1 讀寫量，以及失控閥被持續打滿一整個月的最壞成本估算。每個 429／503 會寫一行 JSON log（`ROUTES.md` 第 5 節）：不含 IP、完整地址、cookie、token、簽章或訊息；但含用戶端的網段鍵（/24 或 /48），`auth_surge` 行另含地址的前 4 位 hex（`auth.ts:313,414-416`）。

## 7. 用戶端：頁面端檢查、摘要、換帳號、換鏈、多分頁、拒簽與晚回應

`src/world/auth.ts` 的 `AuthClient`。所有非同步回應都以世代計數 `gen` 比對，過期的回應直接丟棄。

**頁面端檢查（F-7a／F-1）**：`POST /api/auth/challenge` 回來之後、呼叫錢包之前，`checkSignInMessage`（`src/world/siwe.ts:17-25`）要求訊息**逐行**等於本站會產生的那一則：剛好 11 行；第 1 行的 domain 等於 `location.host`；第 2 行等於正在簽名的帳號（不分大小寫）；空行、完全相同的 statement、空行；`URI:` 等於 `location.origin + '/'`；Version 1；Chain ID 1；`Nonce:` 等於這個 challenge 回應自己的 32 位小寫 hex nonce；Issued At 與本機時鐘相差不超過 10 分鐘；Expiration Time 在 Issued At 之後、最多 5 分鐘；沒有其他行（沒有 Resources、Request ID、Not Before），整行比對，所以 CR 或相似字元都會失敗。不符 → 流程結束、顯示 `message-mismatch`，**錢包完全不會被呼叫**（`src/world/auth.ts:201-204`）。本機時鐘偏差超過 10 分鐘的裝置因此無法登入。限制：它防的是錯誤或被竄改的 challenge 回應（代理、伺服器錯誤）；**不防**注入本 origin 的腳本（那種腳本可以直接呼叫 provider），也不防釣魚頁面（釣魚頁面不會執行本頁的程式）。樣本輸出列出正確訊息與 6 種竄改的檢查結果（`TESTS/siwe-sample/siwe-sample-output.txt`）。

**簽名前與簽名中的說明（F-1 UX）**：簽名按鈕上方、錢包打開之前，顯示「此次簽名僅用於登入 IMD Ember World（登入有效 7 天）…不會轉移資產、不會對代幣或 NFT 做任何授權（approve），也不會送出交易…」與「網域：<本頁 host> · 網路：Ethereum · 用途：僅限登入」（`walletView.ts:48-52`、`WalletPanel.tsx:89-91`）。錢包的簽名提示開著時，顯示從**已檢查的訊息**讀回的摘要（`signInSummary`，`siwe.ts:31-35`）與「只在網址列顯示 <網域> 時簽名；若錢包顯示請求來自其他網站或出現不符警告，請拒絕。」（`walletView.ts:43-46`、`WalletPanel.tsx:109`）。這是提醒，不是防線：轉送的訊息寫的是真的網域，所以訊息裡的網域證明不了什麼；會不同的是請求來源（網址列、錢包顯示的請求來源或不符警告）。

| 情境 | 行為 | 位置 |
|---|---|---|
| 首次連線 | `eth_accounts` 不提示；只有點「登入」才 `eth_requestAccounts` | `auth.ts:117-121,186-191` |
| 已連線但未登入 | 狀態 `connected`，**不是**已驗證；屋主模式只來自伺服器 `/api/me/home` 的結果 | `auth.ts:49-61` |
| 已有此帳號的 session | 直接讀家，不要求簽名 | `auth.ts:192` |
| session 狀態不明（網路、429、503） | 不要求簽名，先重讀；仍不明就顯示提示 | `auth.ts:179-183` |
| 伺服器給的訊息不是本站的那一則 | 不呼叫錢包，顯示 `message-mismatch` | `auth.ts:201-204` |
| 帳號切換 A→B（`accountsChanged`） | 立刻關閉屋主模式，丟棄 A 的進行中流程，向伺服器登出 A；登出失敗則重讀 session，以 `mismatch` 顯示 A 仍有效的 session | `auth.ts:243-251` |
| 錢包鎖住（帳號變空） | 保留有效的 session（F-7e，已知） | `auth.ts:245` |
| 使用者改選另一個錢包 | 作廢進行中流程並向伺服器登出流程；新錢包的帳號若不是 session 的地址 → `mismatch` | `auth.ts:126-133` |
| 換鏈 | 不處理，也不需要：SIWE 固定 chainId 1，`personal_sign` 與錢包所在的鏈無關；不監聽 `chainChanged` | `auth.ts:115-116` |
| 拒絕連線／拒絕簽名 | 結束流程並顯示提示，**不自動重試** | `auth.ts:188,208` |
| 伺服器拒絕簽章或預算忙碌 | 結束流程並顯示提示（`signature-invalid`、`busy` 等），**不自動重試**；下一次點擊取得新的 challenge | `auth.ts:213,262-266` |
| 簽名視窗開著時切換帳號／錢包 | 簽完也不會送 verify | `auth.ts:209` |
| verify 晚到（流程已被放棄） | 若成功，立刻呼叫 logout 撤銷（`revokeAbandoned`） | `auth.ts:212,215,254` |
| verify 回來的地址不是本次帳號 | 撤銷並顯示失敗 | `auth.ts:216` |
| 多分頁 | `BroadcastChannel('imd-ember-auth')` 只觸發各分頁重新 `GET /api/auth/session`，不信任訊息內容；家的回應地址與 session 不同 → 重讀 | `auth.ts:109,162` |
| 登出此裝置 | 伺服器確認撤銷後才把頁面改成登出；失敗則保持登入並提示 | `auth.ts:227-238,260` |
| 登出所有裝置 | 「我的錢包」先行內確認（說明本瀏覽器其他分頁立即登出、其他裝置在下一次需要登入的請求時登出），確認後 `POST /api/auth/logout-all`；401（本瀏覽器的 session 已結束）時頁面改為登出並提示「沒有登出其他裝置」（`signout-all-stale`） | `auth.ts:227-238,255-258`；`walletView.ts:55-73` |

## 8. 已知限制（供 reviewer 判斷）

- session 是 7 天的 bearer cookie，不綁 IP 或 UA；同一地址的 session 數量沒有上限。現在可以「登出所有裝置」，但其他裝置是在下一次請求時才得知，不是推播。NFT 賣出不會撤銷 session（session 是身分），屋主權利由 `ownerOf` 在 30 秒內撤掉（`OWNERSHIP_AND_HOMES.md`）。
- **F-1（仍存在）**：攻擊者可以從伺服器取得「以受害者地址登入 imdember.com」的真實訊息，再騙受害者在釣魚頁簽名。頁面端檢查與摘要對這種攻擊沒有作用；防線是錢包的 EIP-4361 domain 比對與玩家本人。目前 World 的 session 只給看得到、不寫伺服器的權限。
- verify 在檢查 flow cookie 之前先查 nonce 是否存在，未知 nonce 回 409 而非 403；nonce 是 128 bit 隨機值，實際上無法枚舉。
- **可用性換安全**：各層預算與 limiter 都是「拒絕」而不是「放行」。
  - 同一個 /24（或 IPv6 /48）後面的正常玩家共用每分鐘 30 個 challenge、10 次 ERC-1271 認領與 3 次合約查核的份額。
  - 約 20 個 /24 各自持續用滿份額，就能在攻擊期間暫停全站新登入（F-5，仍存在）。至少 7 個 /24 對至少 10 個不同合約，可在攻擊期間讓某據點的首次智慧錢包登入回 429；任何地方每分鐘 2 次垃圾查核可讓單一合約地址回 429（F-3，仍存在）。這些都低於邊緣規則的單 IP 門檻。
  - 同一地址從同一網段一分鐘內只能開 5 個 challenge；正常使用者一分鐘內重按超過 5 次登入時要等一分鐘。
  - `CHAIN_LIMITER`、`AUTH_LIMITER` 與 `chain:code` 是每個 Cloudflare 據點各自計數；分散在多個據點的請求可以得到多份額度。每次 ERC-1271 讀取仍需一個新的 challenge（受全球 D1 預算限制）。
- ERC-1271：合約自己決定誰能代表它簽名（F-2，仍存在）；只在以太坊主網 `latest` 驗證；只部署在 L2 的合約錢包無法登入；未部署的 ERC-6492 錢包被明確拒絕。一個 60 秒內剛被確認「沒有 code」的地址若在這段時間內取得 code（例如新的 EIP-7702 委派），要等快取過期才能用 ERC-1271 登入。
- 驗簽失敗就作廢 challenge：錢包若先回了錯誤格式的簽章，玩家必須再按一次登入、再簽一次。
- 沒有任何錢包宣告 EIP-6963 時退回 `window.ethereum`，無法分辨多個注入的錢包；面板會顯示一行提醒。
- `script-src 'self'` 會擋下用 inline `<script>` 注入 provider 的舊式（MV2）錢包擴充功能；這是相容性風險，本輪沒有用真實錢包測試。
- `migrations/0003` 必須先於這版程式套用；團隊端說明已在部署 `f9b68223` 前套用到正式 D1，本輪沒有查詢正式資料庫確認。沒有套用時登入回 503（不會放行）。
- 伺服器仍接受上一版 statement 的 challenge（`SIWE_PREVIOUS_STATEMENTS`）；程式註解說明應在新版上線超過 5 分鐘後移除，2da46cd 仍保留。
