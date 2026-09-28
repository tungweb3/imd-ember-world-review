# ROUTES：正式 World 的路由表

來源：`source/wrangler.jsonc`、`source/worker/app.ts`、`source/server/auth.ts`、`source/server/world-api.ts`（commit 0def8cb）。
「線上觀察」一欄只來自 2026-09-28T16:06Z 的少量公開 GET，沒有對正式 API 發過任何 POST。另外，團隊為確認邊緣限流，在 2026-09-28 約 17:20Z 規則擴大後，從單一 IP 對 `GET /api/auth/session` 先依序送 26 次（當時還沒有擋），約 17:22Z 再於約 12 秒內送 30＋1 次（第 4 節、`DEPLOYMENT_MATCH.md` 第 5 節，團隊端）。

## 1. 哪些請求會執行 Worker

- `wrangler.jsonc:28`：`run_worker_first: ["/api/world/*", "/api/auth/*", "/api/me/*", "/api/wallet/*"]`
- `wrangler.jsonc:24`：`not_found_handling: "single-page-application"`
- 平台層面（依設定推論，未以請求驗證）：其他所有路徑（包括 `/api/other`、`/api/mint`、`/_headers`）不會執行 Worker，由 Workers Static Assets 回靜態檔；不存在的路徑回 SPA 的 `index.html`（HTTP 200）。`GET /_headers` 回 `index.html` 是前一輪（2026-09-28）的實際觀測。
- 程式層面（可自行驗證）：Worker 內的處理順序是 `handleAccountApi` → `handleWorldApi` → `env.ASSETS.fetch`（`worker/app.ts:86-92`）。兩個 handler 對各自前綴以外的路徑都回 `null`，所以即使平台把其他路徑交給 Worker，也只會轉交 Static Assets；程式裡沒有任何 Mint 路由。
- `wrangler.jsonc:33-34`：`workers_dev:false`、`preview_urls:false`；團隊端對該 Worker 的 workers.dev 主機名稱 GET 回 404。IMD 帳號的 Workers & Pages 只有 `imd-world`（imdember.com）一個應用程式：持有人提供的 Cloudflare dashboard 截圖（2026-09-29）確認（reviewer 無法獨立驗證）。
- Cron：`*/15 * * * *`（`wrangler.jsonc:58`）執行 `scheduled`，寫入在線紀錄並清理 challenge 與 session（`worker/app.ts:95-98`、`server/presence.ts`）。

## 2. 帳號路由（`server/auth.ts`）

Worker 產生的所有回應都帶 `API_HEADERS`（`server/world-api.ts:11-15`）：`Cache-Control: no-store`（另有說明者除外）、`Strict-Transport-Security: max-age=31536000; includeSubDomains`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Cross-Origin-Resource-Policy: same-origin`、`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`。**沒有任何 `Access-Control-*`（CORS）標頭。** Worker 產生的所有 429 都帶 `Retry-After: 60`。

邊緣的 429（第 4 節）由 Cloudflare 產生、不是 Worker：帶 Cloudflare 自己的 `Retry-After`（約 10 秒以內，實測為 8），沒有 JSON `error` code，也沒有 `API_HEADERS`。

| 方法與路徑 | 需要 session | 其他前提 | 速率限制與預算 | 讀／寫 | 主要回應 |
|---|---|---|---|---|---|
| `POST /api/auth/challenge` | 否 | Origin 必須是 `https://imdember.com`（loopback 只在請求本身打到 loopback 時接受，`auth.ts:98-105`）；`Content-Type: application/json`；body ≤ 2048 bytes；`address` 為 40 位 hex | ① `AUTH_LIMITER`（每 IP，IPv6 以 /64 計，每 Cloudflare 據點 20 次／60 秒；丟例外時拒絕）② D1 預算：同一網段（IPv4 /24、IPv6 /48）60 秒內最多 30 個，且全站 6 秒內最多 60 個（`auth.ts:54,58-60`） | 寫 D1：`INSERT … SELECT … WHERE <兩個計數都未滿>`（一個敘述，計數與寫入是同一步）；寫入成功才把同一 flow 舊的未用 challenge 標為 invalidated | 200 `{nonce,message,acceptUntil}` + `Set-Cookie: __Host-imd_flow`（Strict、Max-Age 300）。錯誤：400 `BAD_REQUEST`、403 `ORIGIN_NOT_ALLOWED`、405、429 `RATE_LIMITED`（AUTH_LIMITER）、**429 `SIGN_IN_BUSY`**（D1 預算，什麼都沒寫）、503 `AUTH_UNAVAILABLE`、**503 `LIMITER_UNAVAILABLE`** |
| `POST /api/auth/verify` | 否 | 同上 Origin／JSON；`nonce` 32 hex；`signature` hex；flow cookie 的 SHA-256 必須等於該 challenge 的 `flow_hash` | `AUTH_LIMITER` 同上；需要 ERC-1271 時另扣：③ 該 challenge 網段 60 秒內最多 3 次 ERC-1271 查核（D1）④ `CHAIN_LIMITER` 鍵 `chain:erc1271`（每據點 20 次／60 秒，丟例外或不存在時拒絕） | 讀 `login_challenges`；ECDSA 相符時不做任何鏈上讀取；不符時先在 D1 **認領**這個 challenge（`checked_at`，每個 challenge 最多一次），再送帶金鑰的 `eth_getCode`，有 code 才送 `eth_call`（ERC-1271）；**verify 判定的驗簽失敗（400／401／429 `CHAIN_BUSY`／503 `VERIFY_UNAVAILABLE`）都把 challenge 作廢**（`invalidated_at`；503 `LIMITER_UNAVAILABLE`／`AUTH_UNAVAILABLE` 在作廢前就結束，見 `SIWE.md` 第 3 節）；成功時同一 batch 內 `UPDATE login_challenges` + `INSERT sessions` | 200 `{address,expiresAt}` + `__Host-imd_session`（Lax）並清除 flow cookie。錯誤：400 `BAD_REQUEST`、401 `SIGNATURE_INVALID`、403 `FLOW_MISMATCH`、409 `CHALLENGE_USED`、410 `CHALLENGE_EXPIRED`、400 `UNSUPPORTED_SIGNATURE`（ERC-6492）、**429 `CHAIN_BUSY`**（ERC-1271 預算，沒有讀鏈，challenge 已作廢）、429 `RATE_LIMITED`、503 `VERIFY_UNAVAILABLE`、503 `LIMITER_UNAVAILABLE` |
| `POST /api/auth/logout` | 否（有就撤銷） | Origin 允許清單；`Content-Type: application/json` | Worker **刻意不限**（撤銷永遠要能執行，`auth.ts:269-270`）；因此缺少 limiter 綁定也不影響登出。但 2026-09-29 起 zone 的邊緣規則（每 IP 每 10 秒 20 次，涵蓋整個 `/api/`，第 4 節）也計入登出：同一 IP 大量送 `/api/` 請求時，登出可能在最多 10 秒內收到邊緣的 429（沒有 body）。用戶端只看 `response.ok`，把它當成登出沒有送達：頁面保持登入並提示再按一次（`src/world/auth.ts:77,221,241`）。團隊決定維持規則現狀並在此揭露 | 寫 D1：`sessions.revoked_at`；本瀏覽器 flow 的未用 challenge 標為 invalidated | 204，清除兩個 cookie。冪等 |
| `GET /api/auth/session` | 否 | — | `API_LIMITER`（180／60 秒；丟例外時放行，綁定不存在時 503） | 讀 `sessions` | 200 `{signedIn:false}` 或 `{signedIn:true,address,expiresAt}`；session 無效或過期時同時清掉 cookie。錯誤：429、503 `AUTH_UNAVAILABLE`／`LIMITER_UNAVAILABLE` |
| `GET /api/me/home`（可加 `?fresh=1`） | **是** | 地址只取自 session（`auth.ts:290-294`），用戶端無法指定錢包或席位 | 先 `API_LIMITER`，再以 `AUTH_LIMITER` 按 session（token hash 前 32 字元）限制（丟例外時拒絕）；**每一次 NFT 索引讀取**另扣 `CHAIN_LIMITER` 鍵 `chain:index`（`auth.ts:293`） | 讀 `sessions`、`seat_presence`；IMD 名冊（經 gateway）；Alchemy `getNFTsForOwner`（只在預算允許時）與 Multicall3 `ownerOf` | 200 `{address,seats[],eligible,size,block,checkedAt,presence}`，索引讀取被預算拒絕時多一個 **`recheck:'limited'`**（候選只來自 IMD 名冊與先前存下的索引結果，仍以 `ownerOf` 證明）；401 `AUTH_REQUIRED`／`SESSION_EXPIRED`；429；503 `OWNERSHIP_UNAVAILABLE`（不是「沒有持有」）；503 `LIMITER_UNAVAILABLE` |
| `GET /api/wallet/:address/assets` | 否 | `:address` 為 40 位 hex | `API_LIMITER` + `SEAT_LIMITER`（60／60 秒），丟例外時放行、綁定不存在時 503；角色清單另扣 `CHAIN_LIMITER` 鍵 `chain:assets`（目前清單為空，不會用到） | 讀 IMD 名冊與 `seat_presence`；**不做需要金鑰的鏈上讀取**（角色 collection 為空） | 200 `{address,source:'imd',seats[],characters}`，`Cache-Control: public, max-age=300`。資料是**未驗證**的公開名冊，不帶任何屋主權利 |
| 其他 `/api/auth/*`、`/api/me/*`、`/api/wallet/*` | — | — | — | — | 404 `UNKNOWN_ROUTE`（`auth.ts:274`）；方法不對回 405 |

`LIMITER_UNAVAILABLE`：Worker 在正式網址（非 loopback）上遇到需要的 limiter 綁定不存在時丟 `LimiterMissing`（`worker/app.ts:72`、`server/world-api.ts:20`），帳號路由一律回 503 `LIMITER_UNAVAILABLE`（`auth.ts:296`），不會退回不限流。

線上觀察（2026-09-28T16:06:13Z）：`GET https://imdember.com/api/auth/session` 回 200 `{"signedIn":false}`，帶 `no-store`、HSTS `max-age=31536000; includeSubDomains`、CSP `default-src 'none'; frame-ancestors 'none'`、CORP `same-origin`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`，沒有 `Access-Control-*`。如果正式執行的是 0def8cb 的 bundle（團隊端說明），這個 200 也表示 `API_LIMITER` 綁定存在（0def8cb 在綁定缺失時回 503；舊版會回 200，所以這不能用來證明版本）。

## 3. 世界資料路由（`server/world-api.ts`、`server/gateway.ts`）

唯讀的公開資料代理，**不讀也不寫 session**，與登入無關。原始碼已公開（整個伺服器端都公開，讓 reviewer 能重建 Worker bundle）。

| 方法與路徑 | 說明 |
|---|---|
| `GET /api/world/snapshot` | IMD 公開資料的合併快照 |
| `GET /api/world/market`（`?only=extras`） | 行情備援與席位地板價（Alchemy，金鑰只在伺服器） |
| `GET /api/world/seats/:id` | 單一席位；另加 `SEAT_LIMITER` |
| 非 GET | 405 `read_only` |
| 其他 `/api/world/*` | 404 `unknown_route` |

速率限制：`API_LIMITER`，丟例外時放行（`world-api.ts:41`）；綁定不存在時 503 `limiter_unavailable`（`world-api.ts:64`）。上游失敗回 503 `gateway_unavailable`。上游：`api.imd.fun`、`explorer.imd.fun`、`api.dexscreener.com`（經 zone 邊緣快取，`worker/app.ts:30-38`）與 Alchemy（帶金鑰，不經邊緣快取）。

## 4. 速率限制與預算

**邊緣：Cloudflare WAF rate limiting rule（已設定並啟用）**

| 項目 | 值 |
|---|---|
| 位置 | `imdember.com` zone（Free 方案，唯一一條規則），順序第一，狀態 active |
| 名稱 | `IMD API anti-flood` |
| expression | `(starts_with(http.request.uri.path, "/api/"))` |
| 計數 | 以 IP 計數，每 10 秒 20 次 |
| 超過時 | 同一 IP 在 10 秒內超過 20 次時，由 Cloudflare 邊緣 Block 10 秒：這段時間內該 IP 的 `/api/` 請求直接由邊緣回 429，不執行 Worker。每 IP 每 10 秒 20 次以內的請求照常到達 Worker |
| 生效時間 | 2026-09-27 建立，當時只涵蓋 `/api/world/`；持有人於 2026-09-29 約 01:20（+08，即 2026-09-28 約 17:20Z）擴大到整個 `/api/` |

團隊實測（2026-09-28 約 17:22Z，單一 IP）：約 12 秒內依序送 30 個 `GET https://imdember.com/api/auth/session`，約從第 24 個起由 Cloudflare 邊緣回 429（`Retry-After: 8`），再送一次仍是 429。計數是滑動視窗，切換點只是約略值。在這之前，規則儲存後隨即從同一 IP 依序送的 26 個同樣的 GET 都還沒有被擋（設定傳播延遲）。

意義：單一 IP 每 10 秒超過 20 次的請求會在邊緣被擋 10 秒，被擋的部分不執行 Worker。每 IP 每 10 秒 20 次以內（平均送時約每分鐘 120 次）的請求仍會到達 Worker，消耗 Worker 請求、它自己的 limiter 與 D1 預算；分散在許多 IP 的洪水也一樣。這些都由下面的綁定與 D1 預算處理。規則設定與實測都是團隊端證據（設定來自持有人的 dashboard；reviewer 若要自己觸發，必須在 10 秒內送超過 20 個請求，超出送審的「少量低頻 GET」限制）。`server/auth.ts:36` 註解把這條規則寫成「planned」，那是 0def8cb 原始碼的原文，現況以本節為準。

Cloudflare rate limiter 綁定（`wrangler.jsonc:39-49`、`worker/app.ts:62-75`）：

| 綁定 | 額度 | 用在 | 綁定丟例外時 | 綁定不存在時（正式網址） |
|---|---|---|---|---|
| `API_LIMITER` | 180／60 秒／IP／據點 | 所有 GET 讀取 | 放行 | **503** |
| `SEAT_LIMITER` | 60／60 秒 | 席位查詢、`/api/wallet/:a/assets` | 放行 | **503** |
| `AUTH_LIMITER` | 20／60 秒 | challenge、verify（每 IP）；`/api/me/home`（每 session） | **拒絕** | **503** |
| `CHAIN_LIMITER` | 20／60 秒，三個常數鍵各一份：`chain:erc1271`、`chain:index`、`chain:assets`（`server/auth.ts:84`） | ERC-1271 查核、`/api/me/home` 的每次 NFT 索引讀取、角色清單讀取 | 拒絕 | **503** |

- IPv6 以 /64 為 limiter 的鍵（`worker/app.ts:43-52`）。**這些綁定都是每個 Cloudflare 據點各自計數，不是全球**。
- 只有請求打到 loopback 主機（`localhost`、`127.0.0.1`、`[::1]`，本機 `wrangler dev`）時，缺少綁定才會放行（`chain` 仍然拒絕，`worker/app.ts:72`）。

D1 內的登入預算（跨所有據點，`server/auth.ts:25-67`）：

| 預算 | 值 | 計數方式 | 超過時 |
|---|---|---|---|
| 每網段 challenge | 60 秒內 30 個（`NETWORK_CHALLENGE_BUDGET`） | `login_challenges.net`（IPv4 /24、IPv6 /48，`worker/app.ts:55-59` 的 `networkKey`）＋`issued_at`，索引 `login_challenges_net` | 429 `SIGN_IN_BUSY`，不寫任何列 |
| 全站 challenge（失控閥） | 6 秒內 60 個（`CHALLENGE_BUDGET`，約每分鐘 600） | `issued_at`，索引 `login_challenges_issued` | 429 `SIGN_IN_BUSY`，不寫任何列 |
| 每網段 ERC-1271 查核 | 60 秒內 3 次（`ERC1271_NETWORK_SHARE`），之後才扣 `CHAIN_LIMITER`（`chain:erc1271`） | `checked_at`（認領時寫入） | 429 `CHAIN_BUSY`，沒有讀鏈，challenge 作廢 |

**需要金鑰的 Alchemy 讀取，誰能觸發、受哪個限制**（本機以真實 handler 與假鏈重現，`TESTS/probes/keyed-reads-probe-output.txt`）：

| 觸發方式 | 帶金鑰的呼叫 | 受哪個限制 |
|---|---|---|
| 匿名：取得任一地址的 challenge 後，用不相符的簽章送 `POST /api/auth/verify` | 每個 challenge **最多一次** `eth_getCode`（地址有 code 時再一次 `eth_call`）；第一次失敗就作廢，之後同一 nonce 都是 409 | 每網段每分鐘 30 個 challenge、每網段每分鐘 3 次 ERC-1271、每據點 `CHAIN_LIMITER`（`chain:erc1271`）20 次／60 秒；外加每 IP 的 `AUTH_LIMITER` |
| 用自己產生的任意金鑰登入後，`GET /api/me/home?fresh=1` | 每個地址每 5 分鐘（`fresh=1` 為 30 秒）一次 `getNFTsForOwner`（最多 5 頁）；有候選才送 Multicall3 `eth_call` | 每次索引讀取都先扣每據點 `CHAIN_LIMITER`（`chain:index`）；被拒時完全不讀索引，拋棄式地址（名冊上沒有）因此沒有任何鏈上讀取 |
| `GET /api/wallet/:address/assets` | 無（角色清單為空） | — |

代價是可用性：同一據點內用盡 `chain:erc1271` 或 `chain:index` 時，合約錢包的登入會得到 429 `CHAIN_BUSY`、剛買入但還沒進名冊的席位暫時不會出現（`recheck:'limited'`）；20 個以上的 /24 各自用滿份額，可以讓全站 challenge 持續回 429 `SIGN_IN_BUSY`（程式註解 `server/auth.ts:25-53` 有說明）。上面的邊緣規則只限制單一 IP：每個 /24 每分鐘 30 個 challenge 只相當於每 10 秒 5 個，低於邊緣門檻，所以這個情境不受邊緣規則影響，由 D1 預算承擔。這些都不會誤放行登入或屋主權限。

## 5. 靜態檔

由 Workers Static Assets 提供，標頭來自 `source/public/_headers`（檔案本身不會被提供）。2026-09-28T16:06Z 對 `/`、`/assets/index-BPJxeGls.js`、`/assets/index-BOzKL2IR.css` 三個回應檢查，全部帶（前一輪另對 73 個靜態回應檢查，結果相同）：

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://nft-cdn.alchemy.com; connect-src 'self' blob: https://api.dexscreener.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`

## 6. 本機開發伺服器（不在正式環境）

`server/vite-plugin.ts` 讓 `npm run dev` 用同一套 handler；沒有 D1，所以登入、session 與 `/api/me/home` 在 dev 一律回 503 `AUTH_UNAVAILABLE`（`server/auth.ts:266,282`）。`vite.config.ts` 的 `/__shot` 截圖端點是 `apply:'serve'`，只在 dev 伺服器存在，不會進 production build。`CHAIN_MOCK_OWNERS` 只在請求打到 loopback 主機時生效（`worker/app.ts:77-80`）。
