# ROUTES：正式 World 的路由表

來源：`source/wrangler.jsonc`、`source/worker/app.ts`、`source/server/auth.ts`、`source/server/world-api.ts`、`source/server/ownership.ts`、`source/server/presence.ts`、`source/migrations/0005_lanes_and_subnets.sql`（本 commit 的 `source/`，取自私人 repo commit `f4272c5`；進入 Worker 的檔案與正式 Worker `bbf24001` 的來源 `2e4e830` 相同）。
「線上觀察」只來自 2026-10-01T04:24:56Z～04:25:11Z 的五個公開 GET（`/`、主 JS、CSS、`GET /api/auth/session`、房屋內部 chunk，每個一次、間隔至少 3 秒），本輪沒有對正式 API 發過任何 POST。團隊部署後的實測（約 04:10 UTC，一個 `POST /api/auth/challenge` 與一個 `GET /api/me/home`）記在部署證據頁 `source/docs/security/deploy-evidence/20261001T040934Z-2e4e830.md`，是團隊端證據。邊緣 WAF 規則的設定與觸發實測是更早一輪（2026-09-28）的團隊端證據（第 4 節）。

## 1. 哪些請求會執行 Worker

- `wrangler.jsonc:30`：`run_worker_first: ["/api/world/*", "/api/auth/*", "/api/me/*", "/api/wallet/*"]`
- `wrangler.jsonc:26`：`not_found_handling: "single-page-application"`
- 平台層面（依設定推論，未以請求驗證）：其他所有路徑（包括 `/api/other`、`/api/mint`、`/_headers`）不會執行 Worker，由 Workers Static Assets 回靜態檔；不存在的路徑回 SPA 的 `index.html`（HTTP 200）。
- 程式層面（可自行驗證）：Worker 內的處理順序是 `handleAccountApi` → `handleWorldApi` → `env.ASSETS.fetch`（`worker/app.ts:116-124`）。兩個 handler 對各自前綴以外的路徑都回 `null`（`server/auth.ts:560,571-573`、`server/world-api.ts:47`），所以即使平台把其他路徑交給 Worker，也只會轉交 Static Assets；程式裡沒有任何 Mint 路由（Mint 不在本次範圍，另行審查）。
- `wrangler.jsonc:35-36`：`workers_dev:false`、`preview_urls:false`。「這個帳號的 Workers & Pages 只有 `imd-world`（imdember.com）一個應用程式」來自持有人 2026-09-29 提供的 Cloudflare dashboard 截圖；之後沒有重新確認，reviewer 無法獨立驗證。
- Cron：`*/15 * * * *`（`wrangler.jsonc:66`）執行 `scheduled`（`worker/app.ts:125-129`、`server/presence.ts:55-66`）：寫入在線紀錄，清理 challenge 與 session，刪除讀取超過 8 天的 `index_candidates`（A-2），本版另外刪除超過一分鐘的 `index_lanes` 列（N-6，`server/presence.ts:43-50,59-61,65`）。

## 2. 帳號路由（`server/auth.ts`）

Worker 產生的所有回應都帶 `API_HEADERS`（`server/world-api.ts:11-15`）：`Cache-Control: no-store`（另有說明者除外）、`Strict-Transport-Security: max-age=31536000; includeSubDomains`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Cross-Origin-Resource-Policy: same-origin`、`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`。**沒有任何 `Access-Control-*`（CORS）標頭。** Worker 產生的所有 429 都帶 `Retry-After: 60`。帳號路由的每一個 429 與 503 都會寫一行 JSON log（第 5 節）。

邊緣的 429（第 4 節）由 Cloudflare 產生、不是 Worker：帶 Cloudflare 自己的 `Retry-After`，沒有 JSON `error` code，也沒有 `API_HEADERS`。

| 方法與路徑 | 需要 session | 其他前提 | 速率限制與預算 | 讀／寫 | 主要回應 |
|---|---|---|---|---|---|
| `POST /api/auth/challenge` | 否 | Origin 必須是 `https://imdember.com`（loopback 只在請求本身打到 loopback 時接受，`auth.ts:296-304,589-590`）；`Content-Type: application/json`；body ≤ 2048 bytes；`address` 為 40 位 hex | ① `AUTH_LIMITER`，鍵為 IP（IPv6 以 /64 計），每 Cloudflare 據點 20 次／60 秒；丟例外時拒絕 ② D1 預算（一個敘述內原子計數，`auth.ts:164-171,433-442`）：同一網段 60 秒內 30 個（L1；IPv6 /48 為 60 個，N-5）、全站 6 秒內 60 個（L5），其中 20 個只給過去一分鐘沒有 challenge 的網段（A-7）。**沒有每地址的限制**（A-6）。所有計數以 body 讀完後的時間為準（A-5，`auth.ts:424`）。正式 D1 還沒有 `0005` 時退回 `0004` 的敘述與份額（IPv6 /48 也是 30 個，`auth.ts:172-179,439-442`） | 寫 D1：`INSERT … SELECT … WHERE <兩個計數都未滿>`，同時寫下要求者的 IPv6 /64（`sub`；IPv4 為 NULL，N-5）；同一 batch 讀這個地址過去一分鐘在所有網段的 challenge 數（≥ 20 時寫一行 `auth_surge`，不封鎖）；寫入成功才把同一 flow 舊的未用 challenge 標為 invalidated（`auth.ts:432-449`） | 200 `{nonce,message,acceptUntil}` + `Set-Cookie: __Host-imd_flow`（Strict、Max-Age 300）。錯誤：400 `BAD_REQUEST`、403 `ORIGIN_NOT_ALLOWED`、405、429 `RATE_LIMITED`（AUTH_LIMITER）、**429 `SIGN_IN_BUSY`**（D1 預算，什麼都沒寫；log 的 reason 為 `network` 或 `global`，`auth.ts:443-445`）、503 `AUTH_UNAVAILABLE`、**503 `LIMITER_UNAVAILABLE`** |
| `POST /api/auth/verify` | 否 | 同上 Origin／JSON；`nonce` 32 hex；`signature` hex；flow cookie 的 SHA-256 必須等於該 challenge 的 `flow_hash` | `AUTH_LIMITER`，鍵為 `verify:`＋IP（與 challenge 分開計數，各 20 次／60 秒，L4）；需要 ERC-1271 時依序另扣（`auth.ts:61-97,477-501`），每個 D1 計數都以 challenge 自己的網段與 /64（該列的 `sub`）為準：該網段每分鐘 10 次認領（IPv6 /48 20 次、每個 /64 10 次；每次最多一個 `eth_getCode`）→ `API_LIMITER` 鍵 `chain:code`（每據點 180 次／60 秒，丟例外或不存在時拒絕）→ 有 code 時，該網段每分鐘 3 次（IPv6 /48 6 次、每個 /64 3 次）、該合約地址每分鐘 2 次（跨所有網段）的合約查核；地址的 2 次用完時，改為該網段對該地址的 lane 查核（A-1：每個 /24 每分鐘 1 次，IPv6 /48 2 次且來自兩個 /64；N-4：只有 lane 查核會用掉 lane，自己做滿該地址 2 次一般查核的 /24（IPv6 /64）拿不到；都算在網段的份額內）→ `CHAIN_LIMITER` 鍵 `chain:erc1271`（8 天內以 ERC-1271 登入過的地址用 `chain:erc1271:known`，lane 查核用 `chain:erc1271:lane`，各每據點 20 次／60 秒） | 讀 `login_challenges`；時間在 body 讀完後才取（A-5，`auth.ts:453`），body 在 challenge 的 5 分鐘時間窗結束後才送完 → 410，不讀鏈；ECDSA 相符時不做任何鏈上讀取；不符時：該 isolate 60 秒內已知「沒有 code」的地址直接 401，否則先在 D1 **認領**（`checked_at`，每個 challenge 最多一次），再依上列順序送帶金鑰的 `eth_getCode`，有 code 才送一次 `eth_call`（ERC-1271）；合約查核寫 `called_at` 與 `called_via`（`pool` 或 `lane`，N-4）；**verify 判定的驗簽失敗（400／401／429 `CHAIN_BUSY`／503 `VERIFY_UNAVAILABLE`）都把 challenge 作廢**（`invalidated_at`；503 `LIMITER_UNAVAILABLE`／`AUTH_UNAVAILABLE` 在作廢前就結束，見 `SIWE.md` 第 3 節）；成功時同一 batch 內 `UPDATE login_challenges` + `INSERT sessions`（含 `wallet_type`、`verification_method`）。正式 D1 還沒有 `0005` 時，第一個認領失敗一次後改用 `0004` 的三個敘述，不回 503（`auth.ts:217-226,486-487,492-494`） | 200 `{address,expiresAt}` + `__Host-imd_session`（Lax）並清除 flow cookie。錯誤：400 `BAD_REQUEST`、401 `SIGNATURE_INVALID`、403 `FLOW_MISMATCH`、409 `CHALLENGE_USED`、410 `CHALLENGE_EXPIRED`、400 `UNSUPPORTED_SIGNATURE`（ERC-6492）、**429 `CHAIN_BUSY`**（ERC-1271 的任何一層預算，challenge 已作廢）、429 `RATE_LIMITED`、503 `VERIFY_UNAVAILABLE`（節點失敗或回應格式錯誤；W-3：只有合約的 revert／EVM halt 才是 401，`auth.ts:395-396,400-407`）、503 `LIMITER_UNAVAILABLE`、503 `AUTH_UNAVAILABLE`（例如 session 寫入失敗但不是 UNIQUE 競爭，`auth.ts:518-522`） |
| `POST /api/auth/logout` | 否（有就撤銷） | Origin 允許清單；`Content-Type: application/json` | Worker **刻意不限**（撤銷永遠要能執行，`auth.ts:591-594`）；缺少 limiter 綁定也不影響。zone 的邊緣規則（第 4 節）仍會計入 | 寫 D1：`sessions.revoked_at`；本瀏覽器 flow 的未用 challenge 標為 invalidated（`auth.ts:535-543`） | 204，清除兩個 cookie。冪等 |
| `POST /api/auth/logout-all` | **是**（本請求自己的有效 session） | 同上 Origin／JSON | Worker **刻意不限**（同上） | 以 session 找出地址；同一 batch：撤銷該地址所有仍有效的 session（`REVOKE_ALL_SESSIONS`，走部分索引 `sessions_live`）、作廢該地址過去 5 分鐘內未完成的 challenge 與本瀏覽器 flow 的 challenge（`auth.ts:544-558`）。只設 `revoked_at`，不刪列 | 200 `{revoked:<撤銷數>}`，清除兩個 cookie。沒有 session → 401 `AUTH_REQUIRED`（不清任何東西）；session 已撤銷或偽造 → 401 `AUTH_REQUIRED` 並清 cookie；已過期 → 401 `SESSION_EXPIRED`。沒有有效 session 的人無法結束任何地址的 session |
| `GET /api/auth/session` | 否 | — | `API_LIMITER`（180／60 秒；丟例外時放行，綁定不存在時 503，`auth.ts:607-610`） | 讀 `sessions` | 200 `{signedIn:false}`、`{signedIn:false,expired:true}` 或 `{signedIn:true,address,expiresAt}`（不回傳 `wallet_type`／`verification_method`）。**本版新增（N-7）**：只有已過期的 session cookie 得到 `expired:true`；已撤銷、查無、格式錯誤或沒有 cookie 都只回 `{signedIn:false}`（`auth.ts:526-534`）。session 無效或過期時同時清掉 cookie |
| `GET /api/me/home`（可加 `?fresh=1`） | **是** | 地址只取自 session（`auth.ts:611-626`），用戶端無法指定錢包或席位 | 先 `API_LIMITER`，再以 `AUTH_LIMITER` 按 session（token hash 前 32 字元）限制（丟例外時拒絕）；**每一次 NFT 索引讀取**另扣 `CHAIN_LIMITER` 鍵 `chain:index`（`auth.ts:617`、`server/ownership.ts:241-242`）。**本版新增（N-6）**：`chain:index` 拒絕、而且答案沒有計入任何席位時，請求者網段的索引 lane 先在 D1 計數（`INDEX_LANE`：每個 /24 每分鐘 1 次，IPv6 /48 2 次且每個 /64 1 次，全站每 6 秒 60 次），通過才扣 `CHAIN_LIMITER` 鍵 `chain:index:lane`（每據點 20 次／60 秒，丟例外時拒絕、綁定不存在時 503）；D1 計數出錯就是沒有 lane（`auth.ts:618-624`、`server/auth.ts:227-236`） | 讀 `sessions`、`seat_presence`；IMD 名冊（經 gateway）；Alchemy `getNFTsForOwner`（只在預算或 lane 允許時）與 Multicall3 `ownerOf`。每次成功的索引讀取在回應之後（`waitUntil`）把答案寫進 `index_candidates`（A-2：有席位則 upsert，最多 256 個 id，不覆蓋較新的答案；沒有席位則刪除該列，`server/ownership.ts:164-176,245`）；索引讀取被 `chain:index` 拒絕或失敗時，讀取 `index_candidates` 與本 isolate 的上一份答案中較新者當候選，照樣由 `ownerOf` 證明（`server/ownership.ts:177-184,247-253`）；lane 允許時重建一次證明，只讀一次索引（`server/ownership.ts:278-288`）。**本版新增 D1 寫入（N-6）**：拿到 lane 時寫一列 `index_lanes`（網段鍵、IPv6 /64、時間）。候選超過 256 個時，先依計入規則排序（N-3：現在在線、或 24 小時內在此持有人名下出現過的席位優先），只有這時才多讀一次 `seat_presence`（`server/ownership.ts:142-148,228-238`） | 200 `{address,seats[],eligible,size,block,checkedAt,presence}`；不是完整答案時多一個 `recheck`（`server/ownership.ts:112-122,290-291`）：**`'limited'`**＝索引該讀但被預算拒絕（答案沒有計入席位時，lane 也被拒），或讀取失敗而有保留的答案（A-2、N-6）；**`'partial'`**＝候選超過 256 個（先查可能計入房子的席位，其餘不列）或索引讀到 5 頁上限還有剩（A-4、N-3）；兩者都成立時回 `limited`。401 `AUTH_REQUIRED`／`SESSION_EXPIRED`；429；503 `OWNERSHIP_UNAVAILABLE`（不是「沒有持有」；索引讀取失敗且沒有任何保留答案時也是 503，`server/ownership.ts:251`）；503 `LIMITER_UNAVAILABLE` |
| `GET /api/wallet/:address/assets` | 否 | `:address` 為 40 位 hex | `API_LIMITER` + `SEAT_LIMITER`（60／60 秒），丟例外時放行、綁定不存在時 503；角色清單另扣 `CHAIN_LIMITER` 鍵 `chain:assets`（目前清單為空，不會用到；`auth.ts:600-605`） | 讀 IMD 名冊與 `seat_presence`；**不做需要金鑰的鏈上讀取**（角色 collection 為空） | 200 `{address,source:'imd',seats[],characters}`，`Cache-Control: public, max-age=300`。資料是**未驗證**的公開名冊，不帶任何屋主權利 |
| 其他 `/api/auth/*`、`/api/me/*`、`/api/wallet/*` | — | — | — | — | 404 `UNKNOWN_ROUTE`（`auth.ts:598`）；方法不對回 405（`auth.ts:587,599`） |

`LIMITER_UNAVAILABLE`：Worker 在正式網址（非 loopback）上遇到需要的 limiter 綁定不存在時丟 `LimiterMissing`（`worker/app.ts:100`、`server/world-api.ts:20`），帳號路由一律回 503 `LIMITER_UNAVAILABLE`（`auth.ts:627`），不會退回不限流。

「進入我的家」（房屋內部）**沒有**伺服器路由：它只在用戶端依 `/api/me/home` 的結果開放（`OWNERSHIP_AND_HOMES.md` 第 5 節）。

**本版在路由層的變化**（相對上一輪審查版本 `ae1d41a`／Worker `1a0dd495`；Swarm Audit `8c3aea2e` 的 N-1～N-7。都是團隊的說明，尚未經重新審查，reviewer 應自行驗證）：

| 項目 | 路由 | 變化 | 位置 |
|---|---|---|---|
| N-3 | `GET /api/me/home` | 候選超過 256 個時，截斷前依計入規則排序（現在在線、或 24 小時內在此持有人名下出現過的優先，再來是其他已註冊的）；只有需要截斷時才多讀一次 `seat_presence`；存進 D1 的答案也同樣截斷。仍回 `recheck:'partial'` | `server/ownership.ts:142-148,228-238,245,256` |
| N-4 | `POST /api/auth/verify` | 每次合約查核記下它是一般查核（`called_via='pool'`）還是 lane 查核（`'lane'`）；lane 只計 lane 查核，所以同網段先前的一般查核不再用掉它；自己做滿該地址 2 次一般查核的 /24（IPv6 /64）拿不到 lane。新欄位 `login_challenges.called_via` | `server/auth.ts:192-216,490-499`；`migrations/0005_lanes_and_subnets.sql:12-14` |
| N-5 | challenge、verify | IPv6 份額改為巢狀：/48 是 /24 的兩倍（challenge 60、認領 20、合約查核 6、每地址 lane 2），其中每個 /64 的認領與合約查核最多一個 /24 的份額；challenge 列記下要求它的 /64（`login_challenges.sub`，`worker/app.ts` `subnetKey`），verify 的計數依該列，不看送 verify 的位址。IPv4 不變；log 仍只帶 /48。正式 D1 還沒有 `0005` 時退回 `0004` 的規則 | `worker/app.ts:79-85,117-119`；`server/auth.ts:155-159,164-179,184-191,217-226,433-442,477-480`；`migrations/0005_lanes_and_subnets.sql:6-11` |
| N-6 | `GET /api/me/home` | 索引讀取被 `chain:index` 拒絕、答案又沒有計入席位時，請求者網段的「發現 lane」：先在 D1 計數（新表 `index_lanes`），再扣 `CHAIN_LIMITER` 的新鍵 `chain:index:lane`；允許則讀一次索引，答案照 A-2 保存，`ownerOf` 照樣證明；被拒仍是 `recheck:'limited'`。cron 刪除超過一分鐘的 lane 列。沒有新的綁定 | `server/auth.ts:227-236,271,617-625`；`server/ownership.ts:131-133,278-288`；`server/presence.ts:45-50,59-61`；`migrations/0005_lanes_and_subnets.sql:15-20` |
| N-7 | `GET /api/auth/session` | 過期的 session cookie 回 `{signedIn:false,expired:true}`；其他情況的回應不變。用戶端據此區分「到期」與「失效」 | `server/auth.ts:526-534`；`src/world/auth.ts:25-28,200-204,223-227`；`src/world/walletView.ts:56-60` |
| N-1、N-2 | （用戶端） | session 讀取加序號，只套用最新一次（N-1）；登入點擊先等最新的 session 讀取，challenge 回應到達後、簽名提示之前再確認流程、錢包與帳號（N-2）。伺服器路由沒有改變 | `src/world/auth.ts:116-121,187-206,233-251,269-271` |

線上觀察（2026-10-01T04:25:07Z）：`GET https://imdember.com/api/auth/session` 回 200 `{"signedIn":false}`，帶 `no-store`、HSTS `max-age=31536000; includeSubDomains`、CSP `default-src 'none'; frame-ancestors 'none'`、CORP `same-origin`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`，沒有 `Access-Control-*`（`manifests/live-sha256.txt`）。

## 3. 世界資料路由（`server/world-api.ts`、`server/gateway.ts`）

唯讀的公開資料代理，**不讀也不寫 session**，與登入無關。本版沒有改動這兩個檔案（與上一輪審查版本逐位元組相同）。快照來源是 stale-while-revalidate，並有每個 Cloudflare 據點共用的副本（Cache API，鍵在同源的 `/api/world/_shared/v1/<shape>/<source>` 之下，`worker/app.ts:40-58`、`server/world-api.ts:26-27,51`）。依程式註解，這些項目只由 gateway 以完整鍵讀取，內容就是快照路由本來回的公開資料；用戶端請求這個路徑時由 Worker 處理，屬於未知路由（404 `unknown_route`，`server/world-api.ts:65`）。reviewer 應自行驗證沒有用戶端請求會直接拿到這些項目。

| 方法與路徑 | 說明 |
|---|---|
| `GET /api/world/snapshot` | IMD 公開資料的合併快照 |
| `GET /api/world/market`（`?only=extras`） | 行情備援與席位地板價（Alchemy，金鑰只在伺服器） |
| `GET /api/world/seats/:id` | 單一席位；另加 `SEAT_LIMITER` |
| 非 GET | 405 `read_only` |
| 其他 `/api/world/*` | 404 `unknown_route` |

速率限制：`API_LIMITER`，丟例外時放行（`world-api.ts:43`）；綁定不存在時 503 `limiter_unavailable`（`world-api.ts:66`）。上游失敗回 503 `gateway_unavailable`。上游：`api.imd.fun`、`explorer.imd.fun`、`api.dexscreener.com`（經 zone 邊緣快取，`worker/app.ts:30-39`）與 Alchemy（帶金鑰，不經邊緣快取）。

## 4. 分層速率限制與預算

**邊緣：Cloudflare WAF rate limiting rule（團隊端；本輪沒有改動，也沒有重測）**

| 項目 | 值 |
|---|---|
| 位置 | `imdember.com` zone，名稱 `IMD API anti-flood`，狀態 active；規則 id `866d2fae97c942389a9fa9f15c411f46`（持有人 2026-09-29 從 dashboard 讀取，記在部署證據頁，例如 `source/docs/security/deploy-evidence/20261001T040934Z-2e4e830.md`；之後沒有重讀） |
| expression | `(starts_with(http.request.uri.path, "/api/"))`（2026-09-29 約 01:20（+08）起；之前只有 `/api/world/`） |
| 計數與動作 | 以 IP 計數，同一 IP 在 10 秒內超過 20 次時由 Cloudflare 邊緣 Block 10 秒（回 429，不執行 Worker） |
| 團隊實測（2026-09-28） | 約 17:22Z，單一 IP 約 12 秒內送 30 個 `GET /api/auth/session`，約從第 24 個起由邊緣回 429（`Retry-After: 8`） |

它只擋單一 IP 超過門檻的部分；每 IP 每 10 秒 20 次以內的請求，以及分散在許多 IP 的請求，仍會到達 Worker，由下面各層處理。登出與登出所有裝置也在這條規則的計數範圍內：同一 IP 被 Block 的最多 10 秒內，它們會收到邊緣的 429；用戶端只看 `response.ok`，這時頁面保持登入並提示再按一次（`src/world/auth.ts:304,329,331`），伺服器 session 仍然有效。

**Worker 內的各層**（`server/auth.ts:27-101`；`source/docs/security/AUDIT_REMEDIATION_STATUS.md` 的「Layered sign-in limits」表）：

| 層 | 內容 | 上限 | 拒絕時 | 計數位置 |
|---|---|---|---|---|
| L1 每網段 | challenge（IPv4 /24、IPv6 /48） | 30／分（IPv6 /48：60） | 429 `SIGN_IN_BUSY` | D1（全球） |
| L1 每網段 | ERC-1271 認領（每次最多一個 `eth_getCode`） | 10／分（IPv6 /48：20） | 429 `CHAIN_BUSY` | D1 |
| L1 每網段 | ERC-1271 合約查核（含 lane 查核） | 3／分（IPv6 /48：6） | 429 `CHAIN_BUSY` | D1 |
| L1 每用戶（N-5） | 只限 IPv6：/48 內的每個 /64，以要求該 challenge 的 /64 計（不看送 verify 的位址）；它的 challenge 數由 L4 限制 | 認領 10／分、合約查核 3／分 | 429 `CHAIN_BUSY` | D1 |
| L2 每錢包 | 同一地址的 challenge | **不限**（A-6） | — | — |
| L2 每錢包 | 同一地址被許多網段要求 | 不封鎖；一分鐘內第 20 個起每個 challenge 寫一行 `auth_surge` | 只記錄 | D1 |
| L2 每合約 | 同一合約地址的 ERC-1271 查核（跨所有網段） | 2／分 | 改試 lane（下一列） | D1 |
| L2 每合約 | 2 次用完後：每個網段對該地址的 lane 查核（A-1）；只有 lane 查核會用掉它，自己做滿 2 次一般查核的 /24（IPv6 /64）拿不到（N-4） | 每 /24 1／分（IPv6 /48：2，來自兩個 /64） | 429 `CHAIN_BUSY`（reason `address` 或 `network_contract`） | D1 |
| L3 每 challenge | 一次性 nonce、5 分鐘、任何失敗即作廢、最多一次 ERC-1271 | 1 | 401／409／410 | D1 |
| L4 每據點 | `AUTH_LIMITER` challenge（每 IP；IPv6 /64） | 20／分 | 429 `RATE_LIMITED`，fail closed | Cloudflare 據點 |
| L4 每據點 | `AUTH_LIMITER` verify（`verify:` 鍵，每 IP） | 20／分 | 429 `RATE_LIMITED`，fail closed | Cloudflare 據點 |
| L4 每據點 | `API_LIMITER` 鍵 `chain:code`（ERC-1271 的 `eth_getCode`） | 180／分 | 429 `CHAIN_BUSY`，fail closed | Cloudflare 據點 |
| L4 每據點 | `CHAIN_LIMITER` 鍵 `chain:erc1271`／`chain:erc1271:known`／`chain:erc1271:lane`（`eth_call`） | 各 20／分 | 429 `CHAIN_BUSY`，fail closed | Cloudflare 據點 |
| L5 全站 | challenge 閥門，只當緊急上限；其中 20 個只給過去一分鐘沒有 challenge 的網段（A-7） | 6 秒 60 個（600／分） | 429 `SIGN_IN_BUSY` | D1 |
| 家的讀取（N-6） | `chain:index` 拒絕、答案沒有計入席位的索引讀取：請求者網段的發現 lane，先在 D1 計數（`index_lanes`），再扣 `CHAIN_LIMITER` 鍵 `chain:index:lane` | 每 /24 1／分（IPv6 /48：2，每個 /64 1）；全站每 6 秒 60 個；該鍵每據點 20／分 | 讀取維持 `recheck:'limited'`（無法確認，不是沒有持有）；該鍵 fail closed | D1（全球）＋ Cloudflare 據點 |

所有 D1 計數都以 body 讀完之後的時間為準，合約查核在 `eth_getCode` 之後再讀一次時鐘（A-5，`server/auth.ts:98,327-329`）。正式 D1 還沒有 `0005` 時，challenge 與 ERC-1271 認領退回 `0004` 的規則（IPv6 /48 只算一個 /24、沒有 /64 計數、lane 照舊規則），也不開索引 lane（`server/auth.ts:172-179,217-226`、`auth.ts:620-623`）。

Cloudflare rate limiter 綁定（`wrangler.jsonc:41-58`、`worker/app.ts:87-103`；本版沒有新增綁定，仍是四個，只在 `CHAIN_LIMITER` 內多了一個鍵）：

| 綁定 | 額度 | 用在（鍵） | 綁定丟例外時 | 綁定不存在時（正式網址） |
|---|---|---|---|---|
| `API_LIMITER` | 180／60 秒 | 所有 GET 讀取（IP）；ERC-1271 的 `eth_getCode` 上限（常數鍵 `chain:code`） | GET 放行；`chain:code` **拒絕** | **503** |
| `SEAT_LIMITER` | 60／60 秒 | 席位查詢、`/api/wallet/:a/assets` | 放行 | **503** |
| `AUTH_LIMITER` | 20／60 秒 | challenge（IP）、verify（`verify:`＋IP）、`/api/me/home`（`session:`＋token hash 前綴） | **拒絕** | **503** |
| `CHAIN_LIMITER` | 20／60 秒，常數鍵各一份：`chain:erc1271`、`chain:erc1271:known`、`chain:erc1271:lane`、`chain:index`、`chain:index:lane`（本版新增，N-6）、`chain:assets`（`server/auth.ts:264-271`） | ERC-1271 的 `eth_call`、`/api/me/home` 的每次 NFT 索引讀取（含 lane 放行的那一次）、角色清單讀取 | 拒絕 | **503** |

- **這些綁定都是每個 Cloudflare 據點各自計數，不是全球**；全球性的只有 D1 內的各層（含 N-6 lane 的 D1 計數）。
- 只有請求打到 loopback 主機（本機 `wrangler dev`）時，缺少綁定才會放行（`chain` 仍然拒絕，`worker/app.ts:100`）。
- 登出與登出所有裝置在 Worker 內從不經過任何 limiter（`auth.ts:591-594`；`TESTS/probes/keyed-reads-probe-output.txt` 第 6 項在所有 limiter 都拒絕時仍回 200／204）。

**需要金鑰的 Alchemy 讀取，誰能觸發、受哪個限制**（本機以真實 handler 與假鏈重現，`TESTS/probes/keyed-reads-probe-output.txt`；2026-10-01T04:25:58Z 在本快照 `source/` 重跑，除第 3 項外與上一輪輸出相同：上一輪第 3 項是 `recheck=limited`、0 次帶金鑰的呼叫，本版由 N-6 的 lane 放行那一次索引讀取）：

| 觸發方式 | 帶金鑰的呼叫 | 受哪個限制 |
|---|---|---|
| 匿名：取得任一 EOA 地址的 challenge 後，用不相符的簽章送 `POST /api/auth/verify` | 第一個 challenge 最多一次 `eth_getCode`；之後同一 nonce 都是 409；同一地址 60 秒內的下一個 challenge 因「沒有 code」快取而**完全不讀鏈**（探測第 1 項） | L1 認領份額（IPv6 另有 /64 份額）、`chain:code`、每 IP 的 `AUTH_LIMITER`（`verify:`） |
| 匿名：對一個有 code 的合約地址送不相符的簽章 | 每個 challenge 最多一次 `eth_getCode` 加一次 `eth_call`（探測第 1b 項） | 上列，再加每網段 3 次（IPv6 /48 6 次、每個 /64 3 次）與每合約 2 次（用完後每網段的 lane）的合約查核、`chain:erc1271`（或 `:known`、`:lane`） |
| 用自己產生的任意金鑰登入後，`GET /api/me/home?fresh=1` | 每個地址每 5 分鐘（`fresh=1` 為 30 秒）一次 `getNFTsForOwner`；有候選才送 Multicall3 `eth_call` | 每次索引讀取都先扣每據點 `chain:index`；被拒時改用 IMD 名冊與保留的索引答案（A-2，讀 D1，不需金鑰）當候選；答案沒有計入席位時，請求者網段的 lane（N-6）可放行一次索引讀取：D1 計數後扣 `chain:index:lane`（探測第 3 項：`chain:index` 拒絕後 1 次帶金鑰的呼叫，buckets `CHAIN(chain:index)`、`CHAIN(chain:index:lane)`，`recheck` 為 `-`）。拋棄式金鑰的 session 也能用掉所在網段的 lane |
| `GET /api/wallet/:address/assets` | 無（角色清單為空） | — |

代價是可用性（都不會誤放行登入或屋主權限），以下是團隊自己寫下的殘餘風險（`server/auth.ts:51-60,77-97,126-137`；`README.md` 與 `AUDIT_REMEDIATION_STATUS.md` 的 F-3、F-5、A-1、A-6、A-7、N-4～N-6）：至少 7 個 /24（IPv6：分布在至少 4 個 /48 的至少 7 個 /64）對至少 10 個不同合約持續送垃圾時，某據點的首次智慧錢包登入會在攻擊期間回 429 `CHAIN_BUSY`；單一合約地址的 2 次共用查核用完後每個網段仍有自己的 lane 查核，所以少數其他網段的垃圾不再擋住它，持有人自己先前的嘗試也不再用掉 lane（N-4），但來自持有人自己 /24（IPv6：它的 /64，或同一 /48 的另外兩個 /64）的垃圾，或每分鐘至少 9 個 /24（IPv6：至少 5 個 /48、各用兩個 /64）對至少 3 個地址（IPv6：2 個）把某據點的 `chain:erc1271:lane` 用滿，仍能在攻擊期間擋住它；同一 /24 內兩個 IP 就能用滿該網段每分鐘 30 個 challenge（IPv6 /48 的 60 個，三個 /64 就能用滿；N-5 列為部分修正：能從同一 /48 的兩個以上 /64 發請求的人仍能用掉它的份額）；全站新登入要被擋住，需要 14 個 /24（或 7 個 IPv6 /48）用滿份額，再加上每分鐘約 200 個其他網段各要一次（至少 214 個網段、220 個 IP），否則過去一分鐘沒要過 challenge 的網段仍拿得到第一個 challenge（已要過的網段共用的 40 個，14 個 /24 就能占滿）。N-6（團隊列為部分修正）：主鍵 `chain:index` 已用完時，同一據點每分鐘至少 20 個其他網段（IPv6：10 個 /48、各用兩個 /64）持續用掉各自的 lane，仍能在這段期間讓被拒的讀取拿不到 lane；買家自己的 /24（或 /64，或同一 /48 的另外兩個 /64）上先拿走 lane 的人也可以；全站每分鐘 600 個 lane 會在主鍵也用完的每個據點關上 lane。一個據點的索引讀取每分鐘最多從 20 次升到 40 次，而且只在每分鐘有 20 個網段在那裡用 lane 時。上述都低於邊緣規則的單 IP 門檻，由 D1 各層承擔。

## 5. 拒絕記錄（log）

帳號路由每回一個 429 或 503，就寫一行 JSON（`server/auth.ts:563-581`）：`{evt:'auth_refused', route, status, error, reason, colo, net, walletType?}`；`reason` 是拒絕的那一層或那個預算（例如 `network`、`global`、`auth`、`verify`、`code_share`、`code_cap`、`network_contract`、`address`、`budget`、`budget_known`、`budget_lane`、`rpc`、`home`、`api`、`missing:<綁定名>`、`error`；沒有另外標註時就是 `error` code 本身），`net` 是 /24 或 /48 的網段鍵，`colo` 是 Cloudflare 據點代碼。本版的 reason 沒有增減；N-6 的 lane 被拒時路由回 200（`recheck:'limited'`），不寫 log。另有 `{evt:'auth_surge', route, reason:'address_surge', addr:<地址前 6 個字元，即 0x 加 4 位 hex>, colo, net}`（`auth.ts:449`）。**沒有任何一行包含完整 IP、完整地址、cookie、token、簽章、訊息或 nonce**；IPv6 的 /64（N-5 存在 `login_challenges.sub`，N-6 存在 `index_lanes.sub`）也不寫進 log（`auth.ts:45-50`）。Workers Logs 的取樣率是 0.2（`wrangler.jsonc:37`），所以大約只留下五分之一。範例：`TESTS/siwe-sample/siwe-sample-output.txt`、`TESTS/probes/keyed-reads-probe-output.txt`。

## 6. 靜態檔

由 Workers Static Assets 提供，標頭來自 `source/public/_headers:18-24`（檔案本身不會被提供）。本版沒有改 `_headers`（與上一輪審查版本逐位元組相同）：`/assets/*` 下建置時另存、帶內容雜湊的模型、Pepe 裝飾圖與相框副本，和 Vite 的輸出一樣快取一週（`_headers:26-36`）。2026-10-01T04:24:56Z～04:25:11Z 對 `/`、主 JS、房屋內部 chunk、CSS 四個回應檢查，全部帶：

- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://nft-cdn.alchemy.com; connect-src 'self' blob: https://api.dexscreener.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`

## 7. 本機開發伺服器（不在正式環境）

`server/vite-plugin.ts` 讓 `npm run dev` 用同一套 handler；沒有 D1，所以登入、session 與 `/api/me/home` 在 dev 一律回 503 `AUTH_UNAVAILABLE`（`server/auth.ts:588,606`）。`vite.config.ts` 的 `/__shot` 截圖端點是 `apply:'serve'`，只在 dev 伺服器存在，不會進 production build（`vite.config.ts:13-16`）。`CHAIN_MOCK_OWNERS` 只在請求打到 loopback 主機時生效（`worker/app.ts:104-108`）。
