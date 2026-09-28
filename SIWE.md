# SIWE：登入訊息、伺服器驗證、nonce、預算、session、cookie 與 CSRF

原始碼：`source/server/auth.ts`（伺服器）、`source/worker/app.ts`（limiter 與網段鍵）、`source/src/world/auth.ts`（用戶端狀態機）、`source/migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql`（commit 0def8cb）。

## 1. 去敏的登入訊息範例（合成資料）

> **這是合成樣本，不是正式登入。** 地址來自本機臨時產生的合成金鑰（只存在記憶體、用完即丟、不控制任何資產）；nonce 由伺服器程式隨機產生、只存在本機記憶體資料庫。**檔案不含任何簽章**，cookie 值已遮蔽。沒有對 imdember.com 或任何網路發出請求（ERC-1271 路徑用的是只回 `eth_getCode = "0x"` 的本機替身）。

產生方式：呼叫真正的 `handleAccountApi` → `challenge()` → viem `createSiweMessage`（`server/auth.ts:177-178`），資料庫是 `node:sqlite` 跑真正的兩個 migration，時鐘固定在 2026-09-28T12:00:00Z。產生腳本：`TESTS/siwe-sample/generate-siwe-sample.mjs`；在本快照 `source/` 上執行的完整輸出：`TESTS/siwe-sample/siwe-sample-output.txt`。

```text
imdember.com wants you to sign in with your Ethereum account:
0x0edeA60e00450DE82b7D1F15C48fb453b3033919

Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers or transactions.

URI: https://imdember.com/
Version: 1
Chain ID: 1
Nonce: 9718b7a95d913abf3a3d6bcc70d0f9d2
Issued At: 2026-09-28T12:00:00.000Z
Expiration Time: 2026-09-28T12:05:00.000Z
```

錢包收到的是這段文字的 UTF-8 hex：`personal_sign` params `[hexUtf8(message), account]`（`src/world/auth.ts:196`）。訊息格式與 30449b2 相同，0def8cb 沒有改變簽名內容。

## 2. 訊息欄位

訊息**完全由伺服器產生**並存入 `login_challenges.message`；用戶端只能提供 `address`，無法影響其他欄位（`server/auth.ts:170-186`）。

| 欄位 | 值 | 來源 |
|---|---|---|
| domain | `new URL(origin).host`，正式環境只能是 `imdember.com` | Origin 允許清單（`auth.ts:18,98-105`） |
| address | `getAddress(輸入)`（EIP-55 checksum） | 請求 body，須為 40 位 hex |
| statement | 固定：`Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers or transactions.` | `SIWE_STATEMENT`（`auth.ts:68`） |
| URI | `origin + '/'` | |
| Version | `1` | |
| Chain ID | `1`（固定，與錢包目前的鏈無關） | |
| Nonce | 16 bytes 隨機值的 hex（128 bit，`crypto.getRandomValues`） | `auth.ts:108,176` |
| Issued At | 伺服器現在時間 | |
| Expiration Time | Issued At + 5 分鐘（等於 challenge 可接受的時間窗） | `CHALLENGE_TTL_MS`（`auth.ts:23`） |
| Not Before／Request ID／Resources | 無 | |

Session 的有效期（7 天）寫在 statement 文字裡；SIWE 的 Expiration Time 只表示「這個 challenge 5 分鐘內要簽完」。

## 3. 伺服器驗證順序（`POST /api/auth/verify`，`auth.ts:188-237`）

1. body 必須是 JSON、≤ 2048 bytes；`nonce` 為 32 位小寫 hex，`signature` 為 hex。
2. 依 nonce 讀 `login_challenges`；不存在 → 409 `CHALLENGE_USED`。
3. flow cookie 的 SHA-256 必須等於該列的 `flow_hash`，且請求 Origin 等於該列的 `origin`；否則 403 `FLOW_MISMATCH`。**到這一步為止都不寫資料庫**，所以沒有這個瀏覽器 flow cookie 的人無法作廢別人的 challenge。
4. 已使用或已作廢 → 409；`now >= accept_until` → 410 `CHALLENGE_EXPIRED`。
5. **從這裡開始，verify 判定的每一種拒絕（400 `UNSUPPORTED_SIGNATURE`、401 `SIGNATURE_INVALID`、429 `CHAIN_BUSY`、503 `VERIFY_UNAVAILABLE`）都會作廢（burn）這個 challenge**（`UPDATE … SET invalidated_at`，`auth.ts:202-204`）：同一個 challenge 不能拿來反覆試簽章。例外：limiter 綁定不存在（503 `LIMITER_UNAVAILABLE`，`permit` 重新丟出 `LimiterMissing`，`auth.ts:125-128,296`）或 D1 寫入丟例外（503 `AUTH_UNAVAILABLE`）時，請求在 burn 之前就結束，challenge 不會被作廢。若它已被認領（`checked_at` 已寫入），同一個 nonce 之後不會再觸發 ERC-1271（409 `CHALLENGE_USED`），只有真正簽署者的 ECDSA 簽章還能成功；所以這個例外不會讓錯誤簽章被重試，也不會多花鏈上查詢。
6. 以 ERC-6492 magic suffix 結尾的簽章（未部署的智慧帳戶）→ 作廢，400 `UNSUPPORTED_SIGNATURE`。
7. **從資料庫的原文**重新 parse 並驗證：viem `validateSiweMessage`（domain、nonce、address、時間），另外逐項檢查 URI、`chainId === 1`、version、statement，以及 Issued At／Expiration Time **必須等於**該列的 `issued_at`／`accept_until`。任何不符 → 作廢，401 `SIGNATURE_INVALID`。用戶端送來的只有 nonce 和簽章，驗證的訊息永遠是伺服器存的那一份。
8. 驗簽（`verifySignature`，`auth.ts:143-155`）：
   - 先 ECDSA `recoverMessageAddress`（EOA、EIP-7702 委派 EOA）；相符 → 通過，**不做任何鏈上讀取**。
   - 不符時才可能走 ERC-1271，但在任何帶金鑰的讀取之前先**認領**（`claim`，`auth.ts:212-217`）：同一個 D1 batch 內執行 `CLAIM_ERC1271`（`auth.ts:65-66`：只有在該 challenge 還沒被查過 `checked_at IS NULL`、而且它的網段 60 秒內 ERC-1271 查核少於 3 次時，才寫入 `checked_at`）與 `BURN_UNCLAIMED`（沒認領到時把它作廢）。沒認領到而且是被份額拒絕 → 429 `CHAIN_BUSY`；已被別的請求認領 → 409 `CHALLENGE_USED`。認領成功後再扣每據點的 `CHAIN_LIMITER`（鍵 `chain:erc1271`），被拒 → 作廢，429 `CHAIN_BUSY`。所以**每個 challenge 最多觸發一次 ERC-1271 查核**，並發的重送也一樣。
   - 認領與預算都通過後，只對**有 code** 的地址在主網 `latest` 呼叫 ERC-1271 `isValidSignature`，回傳必須**完全等於** `0x1626ba7e` 加 56 個 0（防止會回聲 calldata 的地址，例如 identity precompile，以前綴比對混過）。沒有 code → 作廢，401。需要 ERC-1271 但讀不到鏈 → 作廢，503 `VERIFY_UNAVAILABLE`。
9. **原子消耗**（`auth.ts:226-235`）：在同一個 D1 batch 中
   - `UPDATE login_challenges SET used_at, session_hash WHERE nonce=? AND used_at IS NULL AND invalidated_at IS NULL AND accept_until > now`
   - `INSERT INTO sessions … SELECT … FROM login_challenges WHERE nonce=? AND session_hash=?`
   只有真正搶到 UPDATE 的那一次會插入 session；`sessions.nonce UNIQUE` 是第二道鎖。並發的重送都會得到 409。時鐘在這一步重讀一次，ERC-1271 查詢期間過期的 challenge 不會被消耗。

本機實測（用真實 handler、合成金鑰，輸出見 `TESTS/siwe-sample/siwe-sample-output.txt`）：Origin 為 `https://evil.example` → 403 `ORIGIN_NOT_ALLOWED`；缺 flow cookie → 403 `FLOW_MISMATCH`；正確簽章 → 200；同一組 nonce＋簽章重送 → 409 `CHALLENGE_USED`；簽發滿 5 分鐘後驗證 → 410 `CHALLENGE_EXPIRED`；**另一把合成金鑰的簽章 → 401 `SIGNATURE_INVALID`（只送了一次 `eth_getCode`），之後同一 nonce 即使送正確簽章也是 409**；同一網段一分鐘內第 31 個 challenge → 429 `SIGN_IN_BUSY`（`Retry-After: 60`），同一時間另一個網段 → 200。

## 4. Session 與 cookie

| 項目 | 實作 |
|---|---|
| token | 32 bytes 隨機值（256 bit），base64url，43 字元（`auth.ts:226`） |
| 資料庫 | 只存 `SHA-256(token)`（`sessions.token_hash`）；另存地址、chain_id、建立與到期時間、`revoked_at`、nonce |
| cookie | `__Host-imd_session=<token>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=<到期前剩餘秒數>`（`auth.ts:116,236`） |
| 有效期 | 固定為 challenge 的 `issued_at + 7 天`，**不續期**（`SESSION_TTL_MS`） |
| 讀取 | cookie 格式必須是 43 字元 `[\w-]`；查無、已撤銷 → 視為未登入；過期 → `SESSION_EXPIRED`；兩者都會清掉 cookie（`auth.ts:158-167,238-243`） |
| 登出 | `UPDATE sessions SET revoked_at`，並作廢本瀏覽器 flow 的未用 challenge；回 204 並清除兩個 cookie（`auth.ts:245-252`）。冪等；Worker 不對它限流（zone 的邊緣規則仍會計入，見第 6、8 節），也不受 limiter 綁定缺失影響 |
| 清理 | cron（每 15 分鐘）刪除：簽發超過 10 分鐘、從未使用的 challenge（過期、被取代、被作廢或登出者）；已使用、而且時間窗結束超過一天的 challenge；過期超過一天的 session。兩個刪除都走索引（`server/presence.ts:29-35,42`；索引見 `migrations/0002`） |
| 登入流程 cookie | `__Host-imd_flow`：16 bytes 隨機 hex，`SameSite=Strict`、Max-Age 300；DB 只存 SHA-256。每次 challenge 都發新值，**不採用用戶端帶來的值**；帶來的舊值只用來作廢它先前開的 challenge，而且只在新 challenge 真的寫入時才作廢（被預算拒絕的請求不改變任何東西，`auth.ts:173-185`） |

用戶端 JavaScript 讀不到 session cookie（HttpOnly）。瀏覽器 localStorage 只存一個「提示」：`ember-world-session-hint` = `{address, expiresAt}`，不含 token，只用來顯示「已過期」而不是「訪客」（`src/world/auth.ts:62-67`）。

## 5. CSRF、Origin 與跨站

- 三個 POST（challenge、verify、logout）都要求 `Origin` 在允許清單內（`https://imdember.com`；`http://localhost|127.0.0.1|[::1]` 只在請求本身打到 loopback 時接受，所以正式環境不可能接受 localhost origin）。沒有 Origin → 403。
- challenge、verify、logout 都要求 `Content-Type: application/json`（HTML 表單無法送出，會觸發 CORS preflight，而伺服器不回任何 CORS 標頭）。
- flow cookie 是 `SameSite=Strict` 並綁定 challenge 與 origin（login CSRF 防護）；session cookie 是 `Lax`。
- 所有 Worker 回應都沒有 `Access-Control-*`；`Cross-Origin-Resource-Policy: same-origin`；`frame-ancestors 'none'`（API 與靜態檔都有）；`X-Frame-Options: DENY` 只在靜態檔（`public/_headers`），API 回應沒有（`server/world-api.ts` 的 `API_HEADERS`），由 CSP `frame-ancestors` 涵蓋。
- `GET /api/me/home` 先讀 session 再扣 `AUTH_LIMITER`，匿名請求與跨站的子資源／`fetch` 請求（瀏覽器不會附上 `SameSite=Lax` cookie）只會消耗放行型的 `API_LIMITER`（`auth.ts:287-292`）。但跨站的**頂層 GET 導覽**會附上 Lax cookie：第三方頁面可以讓已登入者的瀏覽器開啟 `/api/me/home`，消耗該 session 的 `home` 份額，需要索引讀取時（例如帶 `?fresh=1`）也消耗所在據點的 `chain:index` 預算（只會讓屋主狀態暫時回 429 或 `recheck:'limited'`，不會洩漏資料或寫入；回應是 JSON，第三方頁面讀不到）。

## 6. 速率限制、登入預算與失敗行為

| 層 | 內容 | 位置 |
|---|---|---|
| Cloudflare limiter（每據點） | `AUTH_LIMITER` 每 IP（IPv6 /64）20 次／60 秒，用在 challenge 與 verify；綁定丟例外時拒絕 | `worker/app.ts:43-52,68-75`、`server/auth.ts:125-128,270` |
| D1：每網段 challenge | 同一網段（IPv4 /24、IPv6 /48，`networkKey`）60 秒內最多 30 個；超過 429 `SIGN_IN_BUSY`，不寫任何列 | `server/auth.ts:54,58-60,180-185`；`worker/app.ts:55-59` |
| D1：全站 challenge（失控閥） | 6 秒內最多 60 個（約每分鐘 600）；超過 429 `SIGN_IN_BUSY` | 同上 |
| D1：每網段 ERC-1271 | 該 challenge 的網段 60 秒內最多 3 次查核，之後才扣 `CHAIN_LIMITER`；超過 429 `CHAIN_BUSY` 並作廢 challenge | `server/auth.ts:54,65-67,212-220` |
| Cloudflare limiter：`CHAIN_LIMITER` | 三個常數鍵各一份，每據點 20 次／60 秒；丟例外時拒絕 | `server/auth.ts:78-84` |
| Cloudflare 邊緣（WAF rate limiting rule） | 以 IP 計數，同一 IP 在 10 秒內超過 20 個 `/api/` 請求時由邊緣 Block 10 秒（回 429，被擋的請求不執行 Worker）；每 IP 每 10 秒 20 次以內的請求仍會到達 Worker 與上列 limiter、D1 預算。2026-09-29 約 01:20（+08）起涵蓋整個 `/api/`，包括 `POST /api/auth/logout`：Worker 從不對登出限流，但同一 IP 被 Block 的最多 10 秒內，登出也會收到邊緣的 429（第 8 節）。設定與實測為團隊端證據 | `ROUTES.md` 第 4 節 |
| 缺少 limiter 綁定 | 正式網址上需要它的路由回 503 `LIMITER_UNAVAILABLE`；只有 loopback 放行（`chain` 仍拒絕）；登出不受影響 | `worker/app.ts:60-75`、`server/auth.ts:125-128,296` |

兩個 D1 預算都寫在 `INSERT … SELECT … WHERE (count…)<30 AND (count…)<60` 這一個敘述裡（`INSERT_CHALLENGE`），計數與寫入是同一步，不會因為並發而超額；每個計數都用 `LIMIT` 限制掃描量，並使用 `migrations/0002` 新增的索引。程式註解（`server/auth.ts:25-53`）列出每次登入的 D1 讀寫量，以及失控閥被持續打滿一整個月的最壞成本估算。

## 7. 用戶端：換帳號、換鏈、多分頁、拒簽與晚回應

`src/world/auth.ts` 的 `AuthClient`。所有非同步回應都以世代計數 `gen` 比對，過期的回應直接丟棄。

| 情境 | 行為 | 位置 |
|---|---|---|
| 首次連線 | `eth_accounts` 不提示；只有點「登入」才 `eth_requestAccounts` | `auth.ts:111-115,181-185` |
| 已連線但未登入 | 狀態 `connected`，**不是**已驗證；屋主模式只來自伺服器 `/api/me/home` 的結果 | `auth.ts:45-57` |
| 已有此帳號的 session | 直接讀家，不要求簽名 | `auth.ts:186` |
| session 狀態不明（網路、429、503） | 不要求簽名，先重讀；仍不明就顯示提示 | `auth.ts:173-177` |
| 帳號切換 A→B（`accountsChanged`） | 立刻關閉屋主模式，丟棄 A 的進行中流程，向伺服器登出 A；登出失敗則重讀 session，以 `mismatch` 顯示 A 仍有效的 session | `auth.ts:228-236` |
| 錢包鎖住（帳號變空） | 保留有效的 session | `auth.ts:230` |
| 使用者改選另一個錢包 | 作廢進行中流程並向伺服器登出流程；新錢包的帳號若不是 session 的地址 → `mismatch` | `auth.ts:120-127` |
| 換鏈 | 不處理，也不需要：SIWE 固定 chainId 1，`personal_sign` 與錢包所在的鏈無關；不監聽 `chainChanged` | `auth.ts:109-110` |
| 拒絕連線／拒絕簽名 | 結束流程並顯示提示，**不自動重試** | `auth.ts:182,197` |
| 伺服器拒絕簽章或預算忙碌 | 結束流程並顯示提示（`signature-invalid`：訊息已作廢，再按一次會取得新的；`busy`：一分鐘後再試），**不自動重試** | `auth.ts:193,202,243-247`；文字 `auth.ts:296-300` |
| 簽名視窗開著時切換帳號／錢包 | 簽完也不會送 verify | `auth.ts:198` |
| verify 晚到（流程已被放棄） | 若成功，立刻呼叫 logout 撤銷（`revokeAbandoned`） | `auth.ts:201,204,239` |
| verify 回來的地址不是本次帳號 | 撤銷並顯示失敗 | `auth.ts:205` |
| 多分頁 | `BroadcastChannel('imd-ember-auth')` 只觸發各分頁重新 `GET /api/auth/session`，不信任訊息內容；家的回應地址與 session 不同（另一分頁換了 cookie）→ 重讀 | `auth.ts:103,156` |
| 第二個分頁開新 challenge | 瀏覽器共用同一個 flow cookie，第一個分頁的 challenge 被作廢，verify 得 403 `FLOW_MISMATCH`，顯示為 `challenge-lost`（設計行為） | `server/auth.ts:173-184` |
| 登出 | 伺服器確認撤銷後才把頁面改成登出；失敗則保持登入並提示（cookie 與伺服器 session 都還在） | `auth.ts:215-223` |

## 8. 已知限制（供 reviewer 判斷）

- session 是 7 天的 bearer cookie，不綁 IP 或 UA；同一地址的 session 數量沒有上限，也沒有「登出所有裝置」。NFT 賣出不會撤銷 session（session 是身分），屋主權利由 `ownerOf` 在 30 秒內撤掉（`OWNERSHIP_AND_HOMES.md`）。
- verify 在檢查 flow cookie 之前先查 nonce 是否存在，未知 nonce 回 409 而非 403；nonce 是 128 bit 隨機值，實際上無法枚舉。
- **可用性換安全**：登入預算與 `CHAIN_LIMITER` 都是「拒絕」而不是「放行」。
  - 同一個 /24（或 IPv6 /48）後面的正常玩家（例如同一公司、學校或行動網路 NAT）會共用每分鐘 30 個 challenge 與 3 次 ERC-1271 的份額；有人在同一網段用滿時，其他人要等一分鐘（`tests/auth.test.mjs` 明文測試這個取捨）。
  - 約 20 個 /24 各自持續用滿份額，就能讓全站 challenge 持續回 429 `SIGN_IN_BUSY`（程式註解稱之為失控閥，`server/auth.ts:29-32`）。持有 IPv6 /32 的攻擊者有 65,536 個 /48。程式註解把 zone 層的 Cloudflare WAF 規則描述為主要的洪水防線（註解中的「planned」是 0def8cb 的原文）。這條規則**已設定並啟用**：2026-09-29 約 01:20（+08）起涵蓋整個 `/api/`，每 IP 每 10 秒 20 次，超過由邊緣 Block 10 秒（`ROUTES.md` 第 4 節，團隊端）。它只擋單一 IP 超過門檻的部分，每 IP 每 10 秒 20 次以內的請求仍會到達 Worker；每個 /24 每分鐘 30 個 challenge 只相當於每 10 秒 5 個，低於門檻，所以上述約 20 個 /24 的情境不受它影響。
  - 邊緣規則對整個 `/api/`（包括頁面自己的 `/api/world/*` 讀取）按 IP 計數；同一個公開 IP 後面的玩家共用每 10 秒 20 次，超過時要等 10 秒。
  - 登出也在邊緣規則的計數範圍內：Worker 從不對 `POST /api/auth/logout` 限流（`server/auth.ts:269-270`，理由不變），但 2026-09-29 起邊緣規則涵蓋整個 `/api/`，所以同一 IP 大量送 `/api/` 請求時，登出可能在最多 10 秒內收到邊緣的 429（沒有 body、沒有 JSON code、沒有 `API_HEADERS`）。用戶端只看 `response.ok`（`src/world/auth.ts:241`），不解析 body 也不會因此出錯（`src/world/auth.ts:77`）：頁面保持登入並提示再按一次登出（`signout-failed`，`src/world/auth.ts:221`），不會誤顯示為已登出；這段時間內伺服器 session 仍然有效。團隊決定維持規則現狀並在此揭露。
  - `CHAIN_LIMITER` 與 `AUTH_LIMITER` 是每個 Cloudflare 據點各自計數；分散在多個據點的請求可以得到多份 `chain:erc1271`／`chain:index` 額度，所以帶金鑰的 Alchemy 讀取的全球上限取決於據點數，不是 20 次／分。每次 ERC-1271 讀取仍需一個新的 challenge（受全球 D1 預算限制）。
- 帶金鑰的 Alchemy 讀取仍可由不持有任何東西的人觸發，但每一條都有預算：ERC-1271 查核每個 challenge 最多一次（`eth_getCode`，有 code 才 `eth_call`）；`/api/me/home` 的 NFT 索引讀取每次都扣 `chain:index`，被拒時拋棄式地址不會有任何鏈上讀取。Alchemy 配額若仍被耗盡，需要 ERC-1271 的登入會回 503 `VERIFY_UNAVAILABLE`，屋主查核回 503 `OWNERSHIP_UNAVAILABLE`（不會誤放行）。本機重現：`TESTS/probes/keyed-reads-probe.mjs`，輸出 `TESTS/probes/keyed-reads-probe-output.txt`。
- 驗簽失敗就作廢 challenge：錢包若先回了錯誤格式的簽章，玩家必須再按一次登入、再簽一次（用戶端顯示 `signature-invalid` 提示）。
- ERC-1271 只在以太坊主網 `latest` 驗證；只部署在 L2 的合約錢包無法登入；未部署的 ERC-6492 錢包被明確拒絕。
- 沒有任何錢包宣告 EIP-6963 時退回 `window.ethereum`，無法分辨多個注入的錢包；0def8cb 起面板會顯示一行提醒，但仍無法技術上辨識。
- `script-src 'self'` 會擋下用 inline `<script>` 注入 provider 的舊式（MV2）錢包擴充功能；這是相容性風險，不是安全缺陷，本輪沒有用真實錢包測試。
- `migrations/0002` 必須先於 0def8cb 的程式套用；團隊端說明已在部署前套用到正式 D1，本輪沒有查詢正式資料庫確認。
