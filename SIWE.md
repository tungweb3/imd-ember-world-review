# SIWE：登入訊息、頁面端檢查、伺服器驗證、nonce、預算、session、cookie 與 CSRF

原始碼：`source/src/world/siwe.ts`（statement、頁面端檢查與摘要，伺服器與頁面共用）、`source/server/auth.ts`（伺服器）、`source/worker/app.ts`（limiter 與網段鍵）、`source/src/world/auth.ts`（用戶端狀態機）、`source/src/world/walletView.ts`（簽名前說明、簽名中摘要與「我的錢包」的查核說明）、`source/migrations/0001`～`0003`（登入用的表；`0004` 是 `/api/me/home` 的 `index_candidates`，見 `ROUTES.md`）。本 commit 的 `source/` 取自私人 repo commit `132228c`；進入 Worker 與前端建置的檔案與正式 Worker `1a0dd495` 的來源 `4321bb4` 相同。

上一輪審查的版本是公開 commit `b6e986b`（來源 `2da46cd`，Worker `50c688c9`），下文簡稱「上一輪審查版本」。之後的改動分兩批上線：Report `e48d0a96` 的後續（W-1～W-3 等，Worker `c89f5915`，來源 `5398b90`），以及 Swarm Audit `519db624` 的 A-1～A-8（Worker `1a0dd495`，來源 `4321bb4`）。**下文所寫的修正狀態都是團隊自己的說明，尚未經重新審查，reviewer 應自行驗證。**

## 1. 去敏的登入訊息範例（合成資料）

> **這是合成樣本，不是正式登入。** 地址來自本機臨時產生的合成金鑰（只存在記憶體、用完即丟、不控制任何資產）；nonce 由伺服器程式隨機產生、只存在本機記憶體資料庫。**檔案不含任何簽章**，cookie 值已遮蔽。沒有對 imdember.com 或任何網路發出請求（ERC-1271 路徑用的是只回 `eth_getCode = "0x"` 的本機替身）。

產生方式：呼叫真正的 `handleAccountApi` → `challenge()` → viem `createSiweMessage`（`server/auth.ts:346-347`），資料庫是 `node:sqlite` 跑真正的 `0001`～`0004` 四個 migration，時鐘固定在 2026-09-29T12:00:00Z；再用真正的頁面端 `checkSignInMessage` 檢查同一則訊息。2026-09-30T12:01:38Z 以本快照 `source/` 重新產生。產生腳本：`TESTS/siwe-sample/generate-siwe-sample.mjs`；完整輸出：`TESTS/siwe-sample/siwe-sample-output.txt`。

```text
imdember.com wants you to sign in with your Ethereum account:
0x070A585c47fdF2CeF8179c8F9B3530320097a4B2

Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.

URI: https://imdember.com/
Version: 1
Chain ID: 1
Nonce: e60e1d84d064dccf678c05c61170c62b
Issued At: 2026-09-29T12:00:00.000Z
Expiration Time: 2026-09-29T12:05:00.000Z
```

錢包收到的是這段文字的 UTF-8 hex：`personal_sign` params `[hexUtf8(message), account]`（`src/world/auth.ts:247`），而且只在頁面檢查通過之後（`src/world/auth.ts:241-244`，第 7 節）。

**與上一輪審查版本的差異**：訊息格式與 statement 都沒有改。改的是伺服器端：上一輪審查版本的 verify 還接受更早一版措辭（`SIWE_PREVIOUS_STATEMENTS`）的 challenge；這個過渡清單已在 Worker `c89f5915` 刪除，現在 verify 只接受 `SIWE_STATEMENT`（`server/auth.ts:168-172,388`），與頁面端相同。樣本中的地址與 nonce 是這次重新產生的合成值，所以與上一輪的樣本不同。

## 2. 訊息欄位

訊息**完全由伺服器產生**並存入 `login_challenges.message`；用戶端只能提供 `address`，無法影響其他欄位（`server/auth.ts:339-347`）。

| 欄位 | 值 | 來源 |
|---|---|---|
| domain | `new URL(origin).host`，正式環境只能是 `imdember.com` | Origin 允許清單（`auth.ts:20,212-220`） |
| address | `getAddress(輸入)`（EIP-55 checksum） | 請求 body，須為 40 位 hex（`auth.ts:341`） |
| statement | 固定：`Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.` | `SIWE_STATEMENT`（`src/world/siwe.ts:5`，伺服器以 `server/auth.ts:8` import） |
| URI | `origin + '/'` | |
| Version | `1` | |
| Chain ID | `1`（固定，與錢包目前的鏈無關） | |
| Nonce | 16 bytes 隨機值的 hex（128 bit，`crypto.getRandomValues`） | `auth.ts:222,345` |
| Issued At | 伺服器現在時間，在 request body 讀完之後才取（A-5） | `auth.ts:340` |
| Expiration Time | Issued At + 5 分鐘（等於 challenge 可接受的時間窗） | `CHALLENGE_TTL_MS`（`auth.ts:25`） |
| Not Before／Request ID／Resources | 無 | |

Session 的有效期（7 天）寫在 statement 文字裡；SIWE 的 Expiration Time 只表示「這個 challenge 5 分鐘內要簽完」。

## 3. 伺服器驗證順序（`POST /api/auth/verify`，`auth.ts:365-430`）

1. `AUTH_LIMITER` 以 `verify:`＋IP 為鍵（與 challenge 分開計數，`auth.ts:495-496`、`worker/app.ts:94`）。body 必須是 JSON、≤ 2048 bytes（`auth.ts:26,246-254`）；`nonce` 為 32 位小寫 hex，`signature` 為 hex。**時間在 body 讀完之後才讀取**（A-5，`auth.ts:243-245,366`）：之後所有計數與時間比對都以這個時間為準，不再以請求開始的時間為準。
2. 依 nonce 讀 `login_challenges`；不存在 → 409 `CHALLENGE_USED`（`auth.ts:368-370`）。
3. flow cookie 的 SHA-256 必須等於該列的 `flow_hash`，且請求 Origin 等於該列的 `origin`；否則 403 `FLOW_MISMATCH`（`auth.ts:371-372`）。**到這一步為止都不寫資料庫**，所以沒有這個瀏覽器 flow cookie 的人無法作廢別人的 challenge。
4. 已使用或已作廢 → 409；`now >= accept_until` → 410 `CHALLENGE_EXPIRED`（`auth.ts:373-374`）。因為第 1 步的時間是 body 讀完後才取，challenge 的 5 分鐘時間窗就是 body 送達的期限：body 在時間窗結束之後才送完的 verify 回 410，不做任何鏈上讀取（A-5）。程式本身沒有另設讀取 body 的逾時；Cloudflare 對慢速上傳的處理，本輪與團隊文件都沒有檢查。
5. **從這裡開始，verify 判定的每一種拒絕（400 `UNSUPPORTED_SIGNATURE`、401 `SIGNATURE_INVALID`、429 `CHAIN_BUSY`、503 `VERIFY_UNAVAILABLE`）都會作廢（burn）這個 challenge**（`auth.ts:380-382`）。例外：limiter 綁定不存在（503 `LIMITER_UNAVAILABLE`）或 D1 丟例外（503 `AUTH_UNAVAILABLE`）時，請求在 burn 之前就結束（`auth.ts:522`）；若它已被認領（`checked_at` 已寫入），同一個 nonce 之後不會再觸發 ERC-1271（409），只有真正簽署者的 ECDSA 簽章還能成功。
6. 以 ERC-6492 magic suffix 結尾的簽章（未部署的智慧帳戶）→ 作廢，400 `UNSUPPORTED_SIGNATURE`（`auth.ts:383`）。
7. **從資料庫的原文**重新 parse 並驗證：viem `validateSiweMessage`（domain、nonce、address、時間），另外逐項檢查 URI、`chainId === 1`、version、statement（**只接受** `SIWE_STATEMENT`），以及 Issued At／Expiration Time **必須等於**該列的 `issued_at`／`accept_until`（`auth.ts:386-389`）。任何不符 → 作廢，401。
8. 驗簽（`verifySignature`，`auth.ts:290-315`），每一步都在它要付費的讀取**之前**檢查：
   - 先 ECDSA `recoverMessageAddress`（EOA、EIP-7702 委派 EOA）；相符 → `ECDSA`，**不做任何鏈上讀取**（`auth.ts:292`）。
   - 不符時，若這個 Worker isolate 在 60 秒內已確認該地址「沒有 code」→ 401（不認領、不讀鏈，`auth.ts:256-260,295`）。
   - 查詢該地址是否為「已知智慧錢包」（`KNOWN_ERC1271`：有以 ERC-1271 建立、仍保留的 session；走部分索引 `sessions_erc1271`，最多讀一筆，`auth.ts:163,391`）。
   - **認領**（`CLAIM_ERC1271` 與 `BURN_UNCLAIMED` 在同一 batch，`auth.ts:141-142,167,392-395`）：只有在該 challenge 還沒被查過、而且它的網段 60 秒內認領少於 10 次（已知智慧錢包不受這個份額限制）時才寫入 `checked_at`。份額拒絕 → 429 `CHAIN_BUSY`；已被別的請求認領 → 409。**每個 challenge 最多一次 ERC-1271 查核**，並發的重送也一樣。
   - 不是已知智慧錢包時：先扣每據點 `chain:code`（`API_LIMITER`，180／分，fail closed），再送帶金鑰的 `eth_getCode`；沒有 code → 401（並快取 60 秒），回應格式錯誤或節點失敗 → 503 `VERIFY_UNAVAILABLE`（`auth.ts:297-306`）。
   - 有 code（或已知智慧錢包）時，先重讀一次時鐘（A-5：合約查核以 `eth_getCode` 之後的時間計數，`auth.ts:398`），再做合約查核：`CLAIM_CONTRACT`（寫 `called_at`；該網段每分鐘 3 次、該合約地址每分鐘 2 次，跨所有網段）；若該地址的 2 次已用完，改試 `CLAIM_LANE`（A-1：這個 challenge 所在的網段每分鐘仍可對該地址做 1 次，算在該網段的 3 次內）。兩者在同一個 batch（`auth.ts:146-148,154-156,397-404`）。都被拒 → 429，log 的 reason 為 `address`（該地址份額已滿）或 `network_contract`。
   - 最後扣每據點 `CHAIN_LIMITER`：lane 查核用 `chain:erc1271:lane`，已知智慧錢包用 `chain:erc1271:known`，否則 `chain:erc1271`（各 20／分，`auth.ts:190,405-406`）。任何一層拒絕 → 作廢，429 `CHAIN_BUSY`。
   - 全部通過後，在主網 `latest` 呼叫一次 ERC-1271 `isValidSignature`，回傳必須**完全等於** `0x1626ba7e` 加 56 個 0 → `ERC1271`；否則 401（`auth.ts:177,307-314`）。W-3（Report `e48d0a96`）：JSON-RPC 錯誤中只有合約自己的 revert 或 EVM halt 算 401；其他節點錯誤（限流、內部錯誤、逾時、未列出的 -32000 訊息）與格式錯誤的回應都是 503 `VERIFY_UNAVAILABLE`，不當成簽章錯誤（`auth.ts:311-312,316-323`）。
9. **原子消耗**（`auth.ts:415-427`）：在同一個 D1 batch 中
   - `UPDATE login_challenges SET used_at, session_hash WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL AND accept_until > now`
   - `INSERT INTO sessions(…, wallet_type, verification_method) SELECT … FROM login_challenges WHERE nonce=? AND session_hash=?`（`wallet_type` 為 `EOA`／`CONTRACT`，`verification_method` 為 `ECDSA`／`ERC1271`，只供稽核與除錯，不回傳、不授予任何東西，F-2）
   只有真正搶到 UPDATE 的那一次會插入 session；`sessions.nonce UNIQUE` 是第二道鎖。並發的重送得到 409。除了 UNIQUE 競爭之外的寫入失敗（例如正式 D1 缺少 0003 的欄位）會回 503 `AUTH_UNAVAILABLE` 並寫一行 log，不會變成無聲的 409（`auth.ts:423-427,522`）。時鐘在這一步重讀一次（`auth.ts:415`）。

本機實測（真實 handler、合成金鑰，`TESTS/siwe-sample/siwe-sample-output.txt`）：Origin 為 `https://evil.example` → 403；缺 flow cookie → 403；正確簽章 → 200；同一組 nonce＋簽章重送 → 409；簽發滿 5 分鐘後驗證 → 410；另一把合成金鑰的簽章 → 401（只送了一次 `eth_getCode`），之後同一 nonce 即使送正確簽章也是 409；同一地址 60 秒內的下一個 challenge 再用錯誤簽章 → 401 且**不讀鏈**；同一地址從同一網段一分鐘內 6 個 challenge **全部 200**（上一輪審查版本的第 6 個回 429；A-6 移除了這個冷卻），同一地址從另一網段也是 200；同一網段一分鐘內 30 個不同地址的 challenge 全部 200，第 31 個 → 429 `SIGN_IN_BUSY`（log 的 reason 為 `network`），另一網段 → 200；logout-all 回 200 `{"revoked":2}`，同一地址另一個瀏覽器的 session 隨之結束。

## 4. Session 與 cookie

| 項目 | 實作 |
|---|---|
| token | 32 bytes 隨機值（256 bit），base64url，43 字元（`auth.ts:415`） |
| 資料庫 | 只存 `SHA-256(token)`（`sessions.token_hash`）；另存地址、chain_id、建立與到期時間、`revoked_at`、nonce、`wallet_type`、`verification_method` |
| cookie | `__Host-imd_session=<token>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=<到期前剩餘秒數>`（`auth.ts:230,429`） |
| 有效期 | 固定為 challenge 的 `issued_at + 7 天`，**不續期**（`SESSION_TTL_MS`，`auth.ts:25,415`） |
| 讀取 | cookie 格式必須是 43 字元 `[\w-]`；查無、已撤銷 → 視為未登入；過期 → `SESSION_EXPIRED`；兩者都會清掉 cookie（`auth.ts:326-335,431-436`） |
| 登出此裝置 | `UPDATE sessions SET revoked_at`，並作廢本瀏覽器 flow 的未用 challenge；回 204 並清除兩個 cookie（`auth.ts:437-445`）。冪等；Worker 不對它限流（`auth.ts:493-496`） |
| 登出所有裝置 | 需要本請求自己的有效 session；撤銷該地址**所有**仍有效的 session（`REVOKE_ALL_SESSIONS`，部分索引 `sessions_live`）、作廢該地址過去 5 分鐘內與本 flow 未完成的 challenge；回 200 `{revoked}` 並清除兩個 cookie（`auth.ts:446-460`）。沒有有效 session → 401，不結束任何人。Worker 不對它限流 |
| 清理 | cron（每 15 分鐘）刪除：簽發超過 10 分鐘、從未使用的 challenge；已使用、而且時間窗結束超過一天的 challenge；過期超過一天的 session（`server/presence.ts:30-36,51`）。被撤銷的 session 保留到過期後一天才刪。本版的 cron 另外刪除讀取超過 8 天的 `index_candidates`（A-2，`presence.ts:42-43,52`），與 session 無關 |
| 登入流程 cookie | `__Host-imd_flow`：16 bytes 隨機 hex，`SameSite=Strict`、Max-Age 300；DB 只存 SHA-256。每次 challenge 都發新值，**不採用用戶端帶來的值**；帶來的舊值只用來作廢它先前開的 challenge，而且只在新 challenge 真的寫入時才作廢（`auth.ts:342-355,363`） |

用戶端 JavaScript 讀不到 session cookie（HttpOnly）。瀏覽器 localStorage 只存一個「提示」：`ember-world-session-hint` = `{address, expiresAt}`，不含 token（`src/world/auth.ts:72-78`）。

## 5. CSRF、Origin 與跨站

- 四個 POST（challenge、verify、logout、logout-all）都要求 `Origin` 在允許清單內（`https://imdember.com`；loopback origin 只在請求本身打到 loopback 時接受，`auth.ts:212-220,491-492`）。沒有 Origin → 403。
- 四個 POST 都要求 `Content-Type: application/json`（HTML 表單無法送出，會觸發 CORS preflight，而伺服器不回任何 CORS 標頭）。
- flow cookie 是 `SameSite=Strict` 並綁定 challenge 與 origin（login CSRF 防護）；session cookie 是 `Lax`。
- 所有 Worker 回應都沒有 `Access-Control-*`；`Cross-Origin-Resource-Policy: same-origin`；`frame-ancestors 'none'`（API 與靜態檔都有）；`X-Frame-Options: DENY` 只在靜態檔。2026-09-30T11:57Z 對 `/api/auth/session` 與四個靜態檔各 GET 一次，標頭與此相符（`ROUTES.md` 第 2、6 節）。
- `GET /api/me/home` 先讀 session 再扣 `AUTH_LIMITER`（`auth.ts:513-518`）。跨站的**頂層 GET 導覽**會附上 Lax cookie：第三方頁面可以讓已登入者的瀏覽器開啟 `/api/me/home`，消耗該 session 的 `home` 份額與所在據點的 `chain:index`（F-7b，列為已知；回應第三方讀不到）。本版起，這樣觸發的索引讀取若成功，會在回應之後把索引答案寫進 `index_candidates`（A-2，`server/ownership.ts:153-165,222`）；寫入的是該 session 自己地址的候選席位，不授予任何東西。

## 6. 速率限制、登入預算與失敗行為

完整分層表見 `ROUTES.md` 第 4 節；程式裡的說明在 `server/auth.ts:27-85`。要點：

| 層 | 內容 | 位置 |
|---|---|---|
| L1 每網段（D1，全球） | challenge 30／分；ERC-1271 認領 10／分；合約查核 3／分（A-1 的 lane 查核也算在這 3 次內） | `server/auth.ts:30,118-120,129-131,141-148,154-156` |
| L2 每錢包（D1，全球） | **不因地址拒絕任何 challenge**（A-6：上一輪審查版本「同一地址從同一網段 5／分」的冷卻已移除，因為同一 /24 的鄰居可以用掉持有人的份額）；同一地址一分鐘內被要求的第 20 個 challenge 起，每個都寫一行 `auth_surge` log（`ADDRESS_SURGE`），不封鎖；同一合約地址 ERC-1271 查核 2／分（跨所有網段），用完後每個網段每分鐘仍可對它做 1 次 lane 查核（`CLAIM_LANE`，A-1） | `auth.ts:31-34,60-65,119,134-135,149-156,360-362` |
| L3 每 challenge | 一次性 nonce、5 分鐘、任何失敗即作廢、最多一次 ERC-1271 | `auth.ts:35,373-389` |
| L4 每據點（Cloudflare limiter） | `AUTH_LIMITER` challenge 與 verify 各 20／分（每 IP）；`chain:code` 180／分；`chain:erc1271`、`chain:erc1271:known`、`chain:erc1271:lane` 各 20／分；丟例外時拒絕 | `worker/app.ts:80-96`、`server/auth.ts:36-38,179-190,237-242` |
| L5 全站（D1） | challenge 閥門 6 秒 60 個（600／分），只當緊急上限，最後才檢查；其中 20 個（`FRESH_NETWORK_RESERVE`）只給過去一分鐘沒有 challenge 的網段（A-7），已要過的網段共用其餘 40 個 | `server/auth.ts:39-40,47-53,118,121-124,131` |
| 計時（A-5） | 所有計數都以 body 讀完之後的時間為準，合約查核在 `eth_getCode` 之後再讀一次時鐘 | `auth.ts:82,243-245,340,366,398` |
| 邊緣 WAF | 同一 IP 10 秒內超過 20 個 `/api/` 請求時 Block 10 秒（團隊端） | `ROUTES.md` 第 4 節 |
| 缺少 limiter 綁定 | 正式網址上需要它的路由回 503 `LIMITER_UNAVAILABLE`；只有 loopback 放行（`chain` 仍拒絕）；登出不受影響 | `worker/app.ts:93`、`server/auth.ts:522` |

兩個 challenge 預算（L1 網段、L5 閥門與它的保留額）寫在 `INSERT … SELECT … WHERE` 這一個敘述裡（`INSERT_CHALLENGE`，`server/auth.ts:125-131`），計數與寫入是同一步，不會因為並發而超額；每個計數都用 `LIMIT` 限制掃描量，並使用 0002、0003 新增的索引；判斷網段是否「新」的 `EXISTS` 最多讀一筆。被拒的請求什麼都不寫，所以被拒的網段仍算是「新」的。程式註解（`server/auth.ts:86-117`）列出每次登入的 D1 讀寫量，以及失控閥被持續打滿一整個月的最壞成本估算。每個 429／503 會寫一行 JSON log（`ROUTES.md` 第 5 節）：不含完整 IP、完整地址、cookie、token、簽章、訊息或 nonce；但含用戶端的網段鍵（/24 或 /48），`auth_surge` 行另含地址的前 6 個字元（`0x` 加 4 位 hex）（`auth.ts:41-44,362,465-470`）。

## 7. 用戶端：頁面端檢查、摘要、換帳號、換鏈、多分頁、拒簽與晚回應

`src/world/auth.ts` 的 `AuthClient`。所有非同步回應都以世代計數 `gen`（家的讀取另加 `homeGen`）比對，過期的回應直接丟棄。

**頁面端檢查（F-7a／F-1）**：`POST /api/auth/challenge` 回來之後、呼叫錢包之前，`checkSignInMessage`（`src/world/siwe.ts:16-24`）要求訊息**逐行**等於本站會產生的那一則：剛好 11 行；第 1 行的 domain 等於 `location.host`；第 2 行等於正在簽名的帳號（不分大小寫）；空行、完全相同的 statement、空行；`URI:` 等於 `location.origin + '/'`；Version 1；Chain ID 1；`Nonce:` 等於這個 challenge 回應自己的 32 位小寫 hex nonce；Issued At 與本機時鐘相差不超過 10 分鐘；Expiration Time 在 Issued At 之後、最多 5 分鐘；沒有其他行（沒有 Resources、Request ID、Not Before），整行比對，所以 CR 或相似字元都會失敗。不符 → 流程結束、顯示 `message-mismatch`，**錢包完全不會被呼叫**（`src/world/auth.ts:241-244`）。本機時鐘偏差超過 10 分鐘的裝置因此無法登入。限制：它防的是錯誤或被竄改的 challenge 回應（代理、伺服器錯誤）；**不防**注入本 origin 的腳本（那種腳本可以直接呼叫 provider），也不防釣魚頁面（釣魚頁面不會執行本頁的程式）。樣本輸出列出正確訊息與 6 種竄改的檢查結果（`TESTS/siwe-sample/siwe-sample-output.txt`）。

**簽名前與簽名中的說明（F-1 UX）**：簽名按鈕上方、錢包打開之前，顯示「此次簽名僅用於登入 IMD Ember World（登入有效 7 天）…不會轉移資產、不會對代幣或 NFT 做任何授權（approve），也不會送出交易…」與「網域：<本頁 host> · 網路：Ethereum · 用途：僅限登入」（`walletView.ts:77-80`、`WalletPanel.tsx:90-92`）。錢包的簽名提示開著時，顯示從**已檢查的訊息**讀回的摘要（`signInSummary`，`siwe.ts:30-34`）與「只在網址列顯示 <網域> 時簽名；若錢包顯示請求來自其他網站或出現不符警告，請拒絕。」（`walletView.ts:72-74`、`WalletPanel.tsx:110`）。這是提醒，不是防線：轉送的訊息寫的是真的網域，所以訊息裡的網域證明不了什麼；會不同的是請求來源（網址列、錢包顯示的請求來源或不符警告）。

| 情境 | 行為 | 位置 |
|---|---|---|
| 首次連線 | `eth_accounts` 不提示；只有點「登入」才 `eth_requestAccounts` | `auth.ts:154-158,227-231` |
| 已連線但未登入 | 狀態 `connected`，**不是**已驗證；屋主模式只來自伺服器 `/api/me/home` 的結果 | `auth.ts:54-67` |
| 已有此帳號的 session | 直接讀家，不要求簽名 | `auth.ts:232` |
| session 狀態不明（網路、429、503） | 不要求簽名，先重讀；仍不明就顯示提示 | `auth.ts:219-223` |
| 伺服器給的訊息不是本站的那一則 | 不呼叫錢包，顯示 `message-mismatch` | `auth.ts:241-244` |
| 帳號切換 A→B（`accountsChanged`） | 立刻關閉屋主模式，丟棄 A 的進行中流程，向伺服器登出 A；登出失敗則重讀 session，以 `mismatch` 顯示 A 仍有效的 session | `auth.ts:283-291` |
| 錢包鎖住（帳號變空） | 保留有效的 session（F-7e，已知） | `auth.ts:285` |
| 使用者改選另一個錢包 | 作廢進行中流程並向伺服器登出流程；新錢包的帳號若不是 session 的地址 → `mismatch` | `auth.ts:163-170` |
| 換鏈 | 不處理，也不需要：SIWE 固定 chainId 1，`personal_sign` 與錢包所在的鏈無關；不監聽 `chainChanged` | `auth.ts:152-153` |
| 拒絕連線／拒絕簽名 | 結束流程並顯示提示，**不自動重試** | `auth.ts:228,248` |
| 伺服器拒絕簽章或預算忙碌 | 結束流程並顯示提示（`signature-invalid`、`busy` 等），**不自動重試**；下一次點擊取得新的 challenge | `auth.ts:239,253,302-306` |
| 簽名視窗開著時切換帳號／錢包 | 簽完也不會送 verify | `auth.ts:249` |
| verify 晚到（流程已被放棄） | 若成功，立刻呼叫 logout 撤銷（`revokeAbandoned`） | `auth.ts:252,255,294` |
| verify 回來的地址不是本次帳號 | 撤銷並顯示失敗 | `auth.ts:256` |
| session 在本機時鐘上到期（W-1） | 以本機時鐘比對 `expiresAt`：到期立刻不是屋主（顯示 `expired`），不等伺服器；一個計時器在 `expiresAt` 觸發；分頁回到前景時先檢查到期，再（最多每 15 秒一次）重讀 session 與家 | `auth.ts:54-57,117-135` |
| 較舊的家讀取比較新的晚回來（A-3） | 每個 await 之後（含 JSON body 與錯誤 body）都比對 `gen` 與 `homeGen`，被較新讀取或新流程取代的回應直接丟棄，不會恢復已結束的屋主模式 | `auth.ts:189-210` |
| 家的讀取不完整（A-8） | `recheck` 為 `limited` 或 `partial`、而且沒有計入任何席位 → `ownershipUnavailable`（「暫時無法確認」），不是「已登入、沒有符合資格的席位」；面板說明查核沒能完成、不是沒有持有 | `auth.ts:54-62`；`walletView.ts:34-55` |
| 多分頁 | `BroadcastChannel('imd-ember-auth')` 只觸發各分頁重新 `GET /api/auth/session`，不信任訊息內容；家的回應地址與 session 不同 → 重讀 | `auth.ts:144,202`；`WalletPanel.tsx:20` |
| 登出此裝置 | 伺服器確認撤銷後才把頁面改成登出；失敗則保持登入並提示 | `auth.ts:267-278,300` |
| 登出所有裝置 | 「我的錢包」先行內確認（說明本瀏覽器其他分頁立即登出、其他裝置在下一次需要登入的請求時登出），確認後 `POST /api/auth/logout-all`；401（本瀏覽器的 session 已結束）時頁面改為登出並提示「沒有登出其他裝置」（`signout-all-stale`） | `auth.ts:267-278,295-298`；`walletView.ts:82-102` |

## 8. 已知限制（供 reviewer 判斷）

- session 是 7 天的 bearer cookie，不綁 IP 或 UA；同一地址的 session 數量沒有上限。可以「登出所有裝置」，但其他裝置是在下一次請求時才得知，不是推播。NFT 賣出不會撤銷 session（session 是身分），屋主權利由 `ownerOf` 在 30 秒內撤掉（`OWNERSHIP_AND_HOMES.md`）。
- **F-1（仍存在）**：攻擊者可以從伺服器取得「以受害者地址登入 imdember.com」的真實訊息，再騙受害者在釣魚頁簽名。頁面端檢查與摘要對這種攻擊沒有作用；防線是錢包的 EIP-4361 domain 比對與玩家本人。目前 World 的 session 只給看得到、不寫伺服器的權限。
- verify 在檢查 flow cookie 之前先查 nonce 是否存在，未知 nonce 回 409 而非 403；nonce 是 128 bit 隨機值，實際上無法枚舉。
- **以可用性為代價**：各層預算與 limiter 用完或出錯時都是「拒絕」而不是「放行」。以下是團隊自己寫下的殘餘風險（`server/auth.ts:47-53,66-81`；`source/docs/security/AUDIT_REMEDIATION_STATUS.md` 的 F-3、F-5、A-1、A-5～A-7），reviewer 應自行驗證：
  - 同一個 /24（或 IPv6 /48）後面的正常玩家共用每分鐘 30 個 challenge、10 次 ERC-1271 認領與 3 次合約查核的份額。沒有每錢包冷卻之後（A-6），鄰居替某個地址要的 challenge 不會再擋住持有人本人；但同一 /24 內兩個 IP 就能用滿該網段每分鐘 30 個 challenge，這一分鐘內該網段的每個玩家都要等（只影響登入）。D1 預算只看網段鍵、不存完整 IP，所以分不出同一 /24 內的不同主機。
  - 全站閥門（A-7／F-5）：過去一分鐘沒要過 challenge 的網段有 60 個中的 20 個保留額；要擋住這種網段的第一個 challenge，除了 14 個 /24 用滿份額，還需要每分鐘約 200 個其他網段各要一次、並抓準時間補滿閥門（至少 214 個網段、220 個 IP；IPv6 /48 比 IPv4 /24 便宜）。已要過的網段共用其餘 40 個，14 個 /24 就能占滿，所以攻擊期間已拿到第一個 challenge 的玩家要等一分鐘才拿得到第二個。
  - 智慧錢包（A-1／F-3）：至少 7 個 /24 對至少 10 個不同合約持續送垃圾，可在攻擊期間讓某據點的首次智慧錢包登入回 429（已知智慧錢包有自己的 `chain:erc1271:known`，同樣條件）。單一合約地址每分鐘 2 次共用查核用完後，每個網段仍有自己的一次 lane 查核，所以少數其他網段的垃圾不再擋住它；仍擋得住它的是：來自持有人自己 /24（/48）的垃圾（log reason `address`），或每分鐘至少 9 個 /24 對至少 3 個地址把某據點的 `chain:erc1271:lane` 用滿（log reason `budget_lane`）。這些都低於邊緣規則的單 IP 門檻。
  - 慢速 body（A-5）：`AUTH_LIMITER` 在請求開始時就檢查，所以一個 IP 可以先開著多個 body、再一起送完，得到幾分鐘份的每 IP 額度；它們的成本仍受 D1 各層限制，而且以送達時間計數。程式沒有自己的 body 讀取逾時，Cloudflare 對慢速上傳的處理沒有檢查。
  - `CHAIN_LIMITER`、`AUTH_LIMITER` 與 `chain:code` 是每個 Cloudflare 據點各自計數；分散在多個據點的請求可以得到多份額度。每次 ERC-1271 讀取仍需一個新的 challenge（受全球 D1 預算限制）。
- ERC-1271：合約自己決定誰能代表它簽名（F-2，仍存在）；只在以太坊主網 `latest` 驗證；只部署在 L2 的合約錢包無法登入；未部署的 ERC-6492 錢包被明確拒絕。一個 60 秒內剛被確認「沒有 code」的地址若在這段時間內取得 code（例如新的 EIP-7702 委派），要等快取過期才能用 ERC-1271 登入。節點錯誤是 503、不是 401（W-3），所以節點不穩時智慧錢包登入會失敗，但不會被記成簽章錯誤。
- 驗簽失敗就作廢 challenge：錢包若先回了錯誤格式的簽章，玩家必須再按一次登入、再簽一次。
- 沒有任何錢包宣告 EIP-6963 時退回 `window.ethereum`，無法分辨多個注入的錢包；面板會顯示一行提醒。
- `script-src 'self'` 會擋下用 inline `<script>` 注入 provider 的舊式（MV2）錢包擴充功能；這是相容性風險，本輪沒有用真實錢包測試。
- `migrations/0003` 必須先於登入程式套用（沒有套用時登入回 503，不會放行）；`migrations/0004`（A-2 的 `index_candidates`）也應先於本版程式套用。團隊端說明：0004 在部署 `1a0dd495` 前（約 2026-09-29 19:53 UTC）先匯出備份再套用到正式 D1（部署證據頁 `source/docs/security/deploy-evidence/20260929T195417Z-4321bb4.md`）；本輪沒有查詢正式資料庫確認。團隊說明與測試都表示，若程式先於 0004 上線，只會退回「每個 instance 自己保留索引答案」，家的讀取與 cron 都不會因此失敗。
- 上一輪審查版本仍保留的舊 statement 過渡清單（`SIWE_PREVIOUS_STATEMENTS`）已刪除；日後若再改 statement，程式註解要求再加一個版本的過渡清單，否則部署當下仍開著的 challenge 會回 401（`server/auth.ts:168-172`）。
