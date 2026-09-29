# ROUTES：正式 World 的路由表

來源：`source/wrangler.jsonc`、`source/worker/app.ts`、`source/server/auth.ts`、`source/server/world-api.ts`（commit 2da46cd）。
「線上觀察」一欄只來自 2026-09-29T05:52Z 的少量公開 GET，沒有對正式 API 發過任何 POST。邊緣 WAF 規則的設定與觸發實測是前一輪（2026-09-28）的團隊端證據（第 4 節）。

## 1. 哪些請求會執行 Worker

- `wrangler.jsonc:30`：`run_worker_first: ["/api/world/*", "/api/auth/*", "/api/me/*", "/api/wallet/*"]`
- `wrangler.jsonc:26`：`not_found_handling: "single-page-application"`
- 平台層面（依設定推論，未以請求驗證）：其他所有路徑（包括 `/api/other`、`/api/mint`、`/_headers`）不會執行 Worker，由 Workers Static Assets 回靜態檔；不存在的路徑回 SPA 的 `index.html`（HTTP 200）。
- 程式層面（可自行驗證）：Worker 內的處理順序是 `handleAccountApi` → `handleWorldApi` → `env.ASSETS.fetch`（`worker/app.ts:88-95`）。兩個 handler 對各自前綴以外的路徑都回 `null`（`server/auth.ts:409,419-421`），所以即使平台把其他路徑交給 Worker，也只會轉交 Static Assets；程式裡沒有任何 Mint 路由。
- `wrangler.jsonc:35-36`：`workers_dev:false`、`preview_urls:false`。IMD 帳號的 Workers & Pages 只有 `imd-world`（imdember.com）一個應用程式：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）確認（reviewer 無法獨立驗證）。
- Cron：`*/15 * * * *`（`wrangler.jsonc:64`）執行 `scheduled`，寫入在線紀錄並清理 challenge 與 session（`worker/app.ts:97-100`、`server/presence.ts`）。

## 2. 帳號路由（`server/auth.ts`）

Worker 產生的所有回應都帶 `API_HEADERS`（`server/world-api.ts:11-15`）：`Cache-Control: no-store`（另有說明者除外）、`Strict-Transport-Security: max-age=31536000; includeSubDomains`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Cross-Origin-Resource-Policy: same-origin`、`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`。**沒有任何 `Access-Control-*`（CORS）標頭。** Worker 產生的所有 429 都帶 `Retry-After: 60`。帳號路由的每一個 429 與 503 都會寫一行 JSON log（第 5 節）。

邊緣的 429（第 4 節）由 Cloudflare 產生、不是 Worker：帶 Cloudflare 自己的 `Retry-After`，沒有 JSON `error` code，也沒有 `API_HEADERS`。

| 方法與路徑 | 需要 session | 其他前提 | 速率限制與預算 | 讀／寫 | 主要回應 |
|---|---|---|---|---|---|
| `POST /api/auth/challenge` | 否 | Origin 必須是 `https://imdember.com`（loopback 只在請求本身打到 loopback 時接受，`auth.ts:181-189`）；`Content-Type: application/json`；body ≤ 2048 bytes；`address` 為 40 位 hex | ① `AUTH_LIMITER`，鍵為 IP（IPv6 以 /64 計），每 Cloudflare 據點 20 次／60 秒；丟例外時拒絕 ② D1 預算（一個敘述內原子計數，`auth.ts:105-108`）：同一網段 60 秒內 30 個（L1）、同一地址從同一網段 60 秒內 5 個（L2 冷卻）、全站 6 秒內 60 個（L5） | 寫 D1：`INSERT … SELECT … WHERE <三個計數都未滿>`；同一 batch 讀這個地址過去一分鐘在所有網段的 challenge 數（≥ 20 時寫一行 `auth_surge`，不封鎖）；寫入成功才把同一 flow 舊的未用 challenge 標為 invalidated | 200 `{nonce,message,acceptUntil}` + `Set-Cookie: __Host-imd_flow`（Strict、Max-Age 300）。錯誤：400 `BAD_REQUEST`、403 `ORIGIN_NOT_ALLOWED`、405、429 `RATE_LIMITED`（AUTH_LIMITER）、**429 `SIGN_IN_BUSY`**（D1 預算，什麼都沒寫；log 的 reason 為 `network`／`wallet`／`global`）、503 `AUTH_UNAVAILABLE`、**503 `LIMITER_UNAVAILABLE`** |
| `POST /api/auth/verify` | 否 | 同上 Origin／JSON；`nonce` 32 hex；`signature` hex；flow cookie 的 SHA-256 必須等於該 challenge 的 `flow_hash` | `AUTH_LIMITER`，鍵為 `verify:`＋IP（與 challenge 分開計數，各 20 次／60 秒，L4）；需要 ERC-1271 時依序另扣（`auth.ts:48-57,341-353`）：該網段每分鐘 10 次認領（每次最多一個 `eth_getCode`）→ `API_LIMITER` 鍵 `chain:code`（每據點 180 次／60 秒，丟例外或不存在時拒絕）→ 有 code 時，該網段每分鐘 3 次、該合約地址每分鐘 2 次（跨所有網段）的合約查核 → `CHAIN_LIMITER` 鍵 `chain:erc1271`（或 8 天內以 ERC-1271 登入過的地址用 `chain:erc1271:known`，各每據點 20 次／60 秒） | 讀 `login_challenges`；ECDSA 相符時不做任何鏈上讀取；不符時：該 isolate 60 秒內已知「沒有 code」的地址直接 401，否則先在 D1 **認領**（`checked_at`，每個 challenge 最多一次），再依上列順序送帶金鑰的 `eth_getCode`，有 code 才送一次 `eth_call`（ERC-1271）；**verify 判定的驗簽失敗（400／401／429 `CHAIN_BUSY`／503 `VERIFY_UNAVAILABLE`）都把 challenge 作廢**（`invalidated_at`；503 `LIMITER_UNAVAILABLE`／`AUTH_UNAVAILABLE` 在作廢前就結束，見 `SIWE.md` 第 3 節）；成功時同一 batch 內 `UPDATE login_challenges` + `INSERT sessions`（含 `wallet_type`、`verification_method`） | 200 `{address,expiresAt}` + `__Host-imd_session`（Lax）並清除 flow cookie。錯誤：400 `BAD_REQUEST`、401 `SIGNATURE_INVALID`、403 `FLOW_MISMATCH`、409 `CHALLENGE_USED`、410 `CHALLENGE_EXPIRED`、400 `UNSUPPORTED_SIGNATURE`（ERC-6492）、**429 `CHAIN_BUSY`**（ERC-1271 的任何一層預算，challenge 已作廢）、429 `RATE_LIMITED`、503 `VERIFY_UNAVAILABLE`、503 `LIMITER_UNAVAILABLE`、503 `AUTH_UNAVAILABLE`（例如 session 寫入失敗但不是 UNIQUE 競爭，`auth.ts:370-374`） |
| `POST /api/auth/logout` | 否（有就撤銷） | Origin 允許清單；`Content-Type: application/json` | Worker **刻意不限**（撤銷永遠要能執行，`auth.ts:439-442`）；缺少 limiter 綁定也不影響。zone 的邊緣規則（第 4 節）仍會計入 | 寫 D1：`sessions.revoked_at`；本瀏覽器 flow 的未用 challenge 標為 invalidated（`auth.ts:385-392`） | 204，清除兩個 cookie。冪等 |
| `POST /api/auth/logout-all` | **是**（本請求自己的有效 session） | 同上 Origin／JSON | Worker **刻意不限**（同上） | 以 session 找出地址；同一 batch：撤銷該地址所有仍有效的 session（`REVOKE_ALL_SESSIONS`，走部分索引 `sessions_live`）、作廢該地址過去 5 分鐘內未完成的 challenge 與本瀏覽器 flow 的 challenge（`auth.ts:393-407`）。只設 `revoked_at`，不刪列 | 200 `{revoked:<撤銷數>}`，清除兩個 cookie。沒有 session → 401 `AUTH_REQUIRED`（不清任何東西）；session 已撤銷或偽造 → 401 `AUTH_REQUIRED` 並清 cookie；已過期 → 401 `SESSION_EXPIRED`。沒有有效 session 的人無法結束任何地址的 session |
| `GET /api/auth/session` | 否 | — | `API_LIMITER`（180／60 秒；丟例外時放行，綁定不存在時 503） | 讀 `sessions` | 200 `{signedIn:false}` 或 `{signedIn:true,address,expiresAt}`（不回傳 `wallet_type`／`verification_method`）；session 無效或過期時同時清掉 cookie |
| `GET /api/me/home`（可加 `?fresh=1`） | **是** | 地址只取自 session（`auth.ts:459-466`），用戶端無法指定錢包或席位 | 先 `API_LIMITER`，再以 `AUTH_LIMITER` 按 session（token hash 前 32 字元）限制（丟例外時拒絕）；**每一次 NFT 索引讀取**另扣 `CHAIN_LIMITER` 鍵 `chain:index`（`auth.ts:465`） | 讀 `sessions`、`seat_presence`；IMD 名冊（經 gateway）；Alchemy `getNFTsForOwner`（只在預算允許時）與 Multicall3 `ownerOf` | 200 `{address,seats[],eligible,size,block,checkedAt,presence}`，索引讀取被預算拒絕時多一個 **`recheck:'limited'`**；401 `AUTH_REQUIRED`／`SESSION_EXPIRED`；429；503 `OWNERSHIP_UNAVAILABLE`（不是「沒有持有」）；503 `LIMITER_UNAVAILABLE` |
| `GET /api/wallet/:address/assets` | 否 | `:address` 為 40 位 hex | `API_LIMITER` + `SEAT_LIMITER`（60／60 秒），丟例外時放行、綁定不存在時 503；角色清單另扣 `CHAIN_LIMITER` 鍵 `chain:assets`（目前清單為空，不會用到） | 讀 IMD 名冊與 `seat_presence`；**不做需要金鑰的鏈上讀取**（角色 collection 為空） | 200 `{address,source:'imd',seats[],characters}`，`Cache-Control: public, max-age=300`。資料是**未驗證**的公開名冊，不帶任何屋主權利 |
| 其他 `/api/auth/*`、`/api/me/*`、`/api/wallet/*` | — | — | — | — | 404 `UNKNOWN_ROUTE`（`auth.ts:446`）；方法不對回 405 |

`LIMITER_UNAVAILABLE`：Worker 在正式網址（非 loopback）上遇到需要的 limiter 綁定不存在時丟 `LimiterMissing`（`worker/app.ts:74`、`server/world-api.ts:20`），帳號路由一律回 503 `LIMITER_UNAVAILABLE`（`auth.ts:468`），不會退回不限流。

「進入我的家」（房屋內部）**沒有**伺服器路由：它只在用戶端依 `/api/me/home` 的結果開放（`OWNERSHIP_AND_HOMES.md` 第 5 節）。

線上觀察（2026-09-29T05:52:48Z）：`GET https://imdember.com/api/auth/session` 回 200 `{"signedIn":false}`，帶 `no-store`、HSTS `max-age=31536000; includeSubDomains`、CSP `default-src 'none'; frame-ancestors 'none'`、CORP `same-origin`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`，沒有 `Access-Control-*`（`manifests/live-sha256.txt`）。

## 3. 世界資料路由（`server/world-api.ts`、`server/gateway.ts`，本版只改了 `LimiterMissing` 記下綁定名稱）

唯讀的公開資料代理，**不讀也不寫 session**，與登入無關。

| 方法與路徑 | 說明 |
|---|---|
| `GET /api/world/snapshot` | IMD 公開資料的合併快照 |
| `GET /api/world/market`（`?only=extras`） | 行情備援與席位地板價（Alchemy，金鑰只在伺服器） |
| `GET /api/world/seats/:id` | 單一席位；另加 `SEAT_LIMITER` |
| 非 GET | 405 `read_only` |
| 其他 `/api/world/*` | 404 `unknown_route` |

速率限制：`API_LIMITER`，丟例外時放行（`world-api.ts:41`）；綁定不存在時 503 `limiter_unavailable`（`world-api.ts:64`）。上游失敗回 503 `gateway_unavailable`。上游：`api.imd.fun`、`explorer.imd.fun`、`api.dexscreener.com`（經 zone 邊緣快取，`worker/app.ts:30-38`）與 Alchemy（帶金鑰，不經邊緣快取）。

## 4. 分層速率限制與預算

**邊緣：Cloudflare WAF rate limiting rule（團隊端；本輪沒有改動，也沒有重測）**

| 項目 | 值 |
|---|---|
| 位置 | `imdember.com` zone，名稱 `IMD API anti-flood`，狀態 active |
| expression | `(starts_with(http.request.uri.path, "/api/"))`（2026-09-29 約 01:20（+08）起；之前只有 `/api/world/`） |
| 計數與動作 | 以 IP 計數，同一 IP 在 10 秒內超過 20 次時由 Cloudflare 邊緣 Block 10 秒（回 429，不執行 Worker） |
| 前一輪團隊實測 | 2026-09-28 約 17:22Z，單一 IP 約 12 秒內送 30 個 `GET /api/auth/session`，約從第 24 個起由邊緣回 429（`Retry-After: 8`） |

它只擋單一 IP 超過門檻的部分；每 IP 每 10 秒 20 次以內的請求，以及分散在許多 IP 的請求，仍會到達 Worker，由下面各層處理。登出與登出所有裝置也在這條規則的計數範圍內：同一 IP 被 Block 的最多 10 秒內，它們會收到邊緣的 429；用戶端只看 `response.ok`，這時頁面保持登入並提示再按一次（`src/world/auth.ts:233`），伺服器 session 仍然有效。

**Worker 內的各層**（`server/auth.ts:27-101`；`source/docs/security/AUDIT_REMEDIATION_STATUS.md` 的「Layered sign-in limits」表）：

| 層 | 內容 | 上限 | 拒絕時 | 計數位置 |
|---|---|---|---|---|
| L1 每網段 | challenge（IPv4 /24、IPv6 /48） | 30／分 | 429 `SIGN_IN_BUSY` | D1（全球） |
| L1 每網段 | ERC-1271 認領（每次最多一個 `eth_getCode`） | 10／分 | 429 `CHAIN_BUSY` | D1 |
| L1 每網段 | ERC-1271 合約查核 | 3／分 | 429 `CHAIN_BUSY` | D1 |
| L2 每錢包 | 同一地址從同一網段的 challenge（冷卻） | 5／分 | 429 `SIGN_IN_BUSY` | D1 |
| L2 每錢包 | 同一地址被許多網段要求 | 不封鎖；一分鐘內第 20 個起每個 challenge 寫一行 `auth_surge` | 只記錄 | D1 |
| L2 每合約 | 同一合約地址的 ERC-1271 查核（跨所有網段） | 2／分 | 429 `CHAIN_BUSY` | D1 |
| L3 每 challenge | 一次性 nonce、5 分鐘、任何失敗即作廢、最多一次 ERC-1271 | 1 | 401／409／410 | D1 |
| L4 每據點 | `AUTH_LIMITER` challenge（每 IP；IPv6 /64） | 20／分 | 429 `RATE_LIMITED`，fail closed | Cloudflare 據點 |
| L4 每據點 | `AUTH_LIMITER` verify（`verify:` 鍵，每 IP） | 20／分 | 429 `RATE_LIMITED`，fail closed | Cloudflare 據點 |
| L4 每據點 | `API_LIMITER` 鍵 `chain:code`（ERC-1271 的 `eth_getCode`） | 180／分 | 429 `CHAIN_BUSY`，fail closed | Cloudflare 據點 |
| L4 每據點 | `CHAIN_LIMITER` 鍵 `chain:erc1271`／`chain:erc1271:known`（`eth_call`） | 各 20／分 | 429 `CHAIN_BUSY`，fail closed | Cloudflare 據點 |
| L5 全站 | challenge 閥門，只當緊急上限 | 6 秒 60 個（600／分） | 429 `SIGN_IN_BUSY` | D1 |

Cloudflare rate limiter 綁定（`wrangler.jsonc:41-56`、`worker/app.ts:61-77`；本版沒有新增綁定）：

| 綁定 | 額度 | 用在（鍵） | 綁定丟例外時 | 綁定不存在時（正式網址） |
|---|---|---|---|---|
| `API_LIMITER` | 180／60 秒 | 所有 GET 讀取（IP）；ERC-1271 的 `eth_getCode` 上限（常數鍵 `chain:code`） | GET 放行；`chain:code` **拒絕** | **503** |
| `SEAT_LIMITER` | 60／60 秒 | 席位查詢、`/api/wallet/:a/assets` | 放行 | **503** |
| `AUTH_LIMITER` | 20／60 秒 | challenge（IP）、verify（`verify:`＋IP）、`/api/me/home`（`session:`＋token hash 前綴） | **拒絕** | **503** |
| `CHAIN_LIMITER` | 20／60 秒，常數鍵各一份：`chain:erc1271`、`chain:erc1271:known`、`chain:index`、`chain:assets`（`server/auth.ts:159`） | ERC-1271 的 `eth_call`、`/api/me/home` 的每次 NFT 索引讀取、角色清單讀取 | 拒絕 | **503** |

- **這些綁定都是每個 Cloudflare 據點各自計數，不是全球**；全球性的只有 D1 內的各層。
- 只有請求打到 loopback 主機（本機 `wrangler dev`）時，缺少綁定才會放行（`chain` 仍然拒絕，`worker/app.ts:74`）。
- 登出與登出所有裝置在 Worker 內從不經過任何 limiter（`auth.ts:439-442`；`TESTS/probes/keyed-reads-probe-output.txt` 第 6 項在所有 limiter 都拒絕時仍回 200／204）。

**需要金鑰的 Alchemy 讀取，誰能觸發、受哪個限制**（本機以真實 handler 與假鏈重現，`TESTS/probes/keyed-reads-probe-output.txt`）：

| 觸發方式 | 帶金鑰的呼叫 | 受哪個限制 |
|---|---|---|
| 匿名：取得任一 EOA 地址的 challenge 後，用不相符的簽章送 `POST /api/auth/verify` | 第一個 challenge 最多一次 `eth_getCode`；之後同一 nonce 都是 409；同一地址 60 秒內的下一個 challenge 因「沒有 code」快取而**完全不讀鏈**（探測第 1 項） | L1 認領份額、`chain:code`、每 IP 的 `AUTH_LIMITER`（`verify:`） |
| 匿名：對一個有 code 的合約地址送不相符的簽章 | 每個 challenge 最多一次 `eth_getCode` 加一次 `eth_call`（探測第 1b 項） | 上列，再加每網段 3 次與每合約 2 次的合約查核、`chain:erc1271` |
| 用自己產生的任意金鑰登入後，`GET /api/me/home?fresh=1` | 每個地址每 5 分鐘（`fresh=1` 為 30 秒）一次 `getNFTsForOwner`；有候選才送 Multicall3 `eth_call` | 每次索引讀取都先扣每據點 `chain:index`；被拒時完全不讀索引（探測第 3 項） |
| `GET /api/wallet/:address/assets` | 無（角色清單為空） | — |

代價是可用性（都不會誤放行登入或屋主權限）：至少 7 個 /24 對至少 10 個不同合約持續送垃圾時，某據點的首次智慧錢包登入會在攻擊期間回 429 `CHAIN_BUSY`；任何地方每分鐘 2 次垃圾查核，就能讓單一合約地址在攻擊期間回 429；約 20 個 /24 各自用滿 challenge 份額時，全站新登入會在攻擊期間回 429 `SIGN_IN_BUSY`。上述都低於邊緣規則的單 IP 門檻，由 D1 各層承擔。這些是團隊自己寫下的殘餘風險（`README.md` 的 F-3、F-5 列）。

## 5. 拒絕記錄（log）

帳號路由每回一個 429 或 503，就寫一行 JSON（`server/auth.ts:412-429`）：`{evt:'auth_refused', route, status, error, reason, colo, net, walletType?}`；`reason` 是拒絕的那一層或那個預算（例如 `network`、`wallet`、`global`、`auth`、`verify`、`code_share`、`code_cap`、`network_contract`、`address`、`budget`、`budget_known`、`rpc`、`home`、`api`、`missing:<綁定名>`、`error`），`net` 是 /24 或 /48 的網段鍵，`colo` 是 Cloudflare 據點代碼。另有 `{evt:'auth_surge', route, reason:'address_surge', addr:<地址前 4 位 hex>, colo, net}`。**沒有任何一行包含 IP、完整地址、cookie、token、簽章或訊息。** Workers Logs 的取樣率是 0.2（`wrangler.jsonc:37`），所以大約只留下五分之一。範例：`TESTS/siwe-sample/siwe-sample-output.txt`、`TESTS/probes/keyed-reads-probe-output.txt`。

## 6. 靜態檔

由 Workers Static Assets 提供，標頭來自 `source/public/_headers`（檔案本身不會被提供；本版未改）。2026-09-29T05:52Z 對 `/`、主 JS、房屋內部 chunk、CSS 四個回應檢查，全部帶：

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://nft-cdn.alchemy.com; connect-src 'self' blob: https://api.dexscreener.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`

## 7. 本機開發伺服器（不在正式環境）

`server/vite-plugin.ts` 讓 `npm run dev` 用同一套 handler；沒有 D1，所以登入、session 與 `/api/me/home` 在 dev 一律回 503 `AUTH_UNAVAILABLE`（`server/auth.ts:436,454`）。`vite.config.ts` 的 `/__shot` 截圖端點是 `apply:'serve'`，只在 dev 伺服器存在，不會進 production build。`CHAIN_MOCK_OWNERS` 只在請求打到 loopback 主機時生效（`worker/app.ts:79-82`）。
