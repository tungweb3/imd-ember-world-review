> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# ROUTES：公開 Worker 路由與邊界

本版對應部署 Worker `acdbb2bd`、部署來源 `ddb10e2`、快照來源 `c491ff3`。`source/worker/app.ts:135–146` 依序呼叫會員、帳號、World handler，再交給 Static Assets。`wrangler.jsonc:21–30` 只讓 /api/world/*、/api/auth/*、/api/me/*、/api/wallet/* 優先執行 Worker；其他路徑由 Static Assets 處理，未知靜態路徑採 SPA fallback。

## HTTP 路由

以下程式路徑均相對於 `source/`。no-store 是對瀏覽器的 cache policy；gateway 的內部快取與共用 snapshot copy 為另一層。Worker 回應使用 `server/world-api.ts:11–14` 的安全標頭；帳號路由不提供 Access-Control-*（`server/auth.ts:12–13`）。

| 方法與路徑 | 身分、讀寫與回應 | 程式依據 |
|---|---|---|
| `GET /api/world/snapshot` | 公開整理後的 World feeds；no-store；先花 api bucket。 | `server/world-api.ts:45–51` |
| `GET /api/world/market` | 公開行情與可用的 seat floor；?only=extras 只讀 Worker extras；no-store。 | `server/world-api.ts:29–38,52–58` |
| `GET /api/world/seats/:id` | 公開席位資料；id 為 canonical 非負十進位、最多 80 位；另花 seat bucket；no-store。 | `server/world-api.ts:5,60–63` |
| `GET /api/world/names/:address` | 無須 session；地址限 40 hex 的 0x 地址；只回 ready profile 的 {name}，沒會員或沒名稱皆為 {name:null}；no-store。 | `server/member.ts:15,94–99,122–126` |
| `POST /api/auth/challenge` | 同源登入寫入；為指定地址建立伺服器 SIWE challenge、設定 flow cookie；no-store。 | `server/auth.ts:482–509,630,653–663` |
| `POST /api/auth/verify` | 同源登入寫入；驗證 nonce、flow、儲存的 SIWE 訊息與簽章，一次性建立 session。採本版 ECDSA／已部署 ERC-1271 規則，拒絕 ERC-6492；成功設定 session cookie；no-store。 | `server/auth.ts:429–459,511–594` |
| `GET /api/auth/session` | 讀目前 cookie 的登入狀態；匿名為 {signedIn:false}；no-store；不建立 session。 | `server/auth.ts:596–601,674–677` |
| `POST /api/auth/logout` | 同源撤銷本裝置 session、清 cookie；不限流；no-store。 | `server/auth.ts:603–615,659–662` |
| `POST /api/auth/logout-all` | 同源、須有效 session；撤銷同地址的有效 sessions、清 cookie；不限流；no-store。 | `server/auth.ts:617–625,659–662` |
| `GET /api/me/home` | 須有效 session；以伺服器確認的地址查房屋權限，候選索引仍須 ownerOf；?fresh=1 交給 ownership 重新查詢路徑；no-store。 | `server/auth.ts:679–708`；`server/ownership.ts` |
| `GET /api/wallet/:address/assets` | 公開錢包資產資訊；花 api、seat，角色索引另受 chain 預算。成功為 public,max-age=300，錯誤為 no-store。本版 character collections 清單為空。 | `server/auth.ts:629,665–673`；`src/world/collections.ts:5–6` |
| `POST /api/me/bootstrap` | 同源、須有效 session；冪等取得／初次建立會員；Content-Type 為 application/json。地址從 session 取得；no-store，不寫或清登入 cookie。 | `server/member.ts:101–119,135–154` |
| `GET /api/me/profile` | 須有效 session；只讀既有會員，未建立為 404 MEMBER_NOT_FOUND；至多每小時更新 last_login_at；no-store，不寫或清登入 cookie。 | `server/member.ts:103–111,129–133` |
| `PUT /api/me/profile` | 同源、須有效 session；設定／改公開名稱。只接受 displayName、expectedActorPublicId、expectedProfileVersion、requestId；no-store，不寫或清登入 cookie。 | `server/member.ts:113–119,157–237` |

公開玩家名稱與錢包地址的房屋面板一起呈現。`MemberPanel.tsx:61` 的既有 UI 文字保留。自己的 profile 回應含公開 member id、名稱狀態、登入錢包、economy 摘要及 life 初始狀態；不回內部 member id、name key 或 claims（`server/member.ts:65–73`）。

## 限流、錯誤與 cookie

- API_LIMITER 180/min、SEAT_LIMITER 60/min、AUTH_LIMITER 20/min、CHAIN_LIMITER 20/min 依 key、依 Cloudflare location 計算；D1 登入預算另計。缺必要綁定回 503。已存在但拋錯的 read bucket 可放行，登入與會員寫入等 bucket 拒絕執行（`wrangler.jsonc:38–57`；`worker/app.ts:105–120`）。
- 會員寫入採 member: 加 client IP 的獨立 key，每 IP／location 20/min；profile 另有 D1 每 member 每分鐘 5 個到達資料庫的寫入預算。會員 GET 使用 api（`worker/app.ts:108–120`；`server/member.ts:20–28,94–119,190–192`）。
- 會員寫入先檢查 DB、Origin、limiter，再由 handler 讀 body／session。profile body 限 2,048 bytes；帳號／版本變更回 409，名稱格式回 400、被鎖回 403、名稱衝突／冷卻回 409、預算不足回 429；DB／必要 limiter 不可用回 503（`server/auth.ts:26`；`server/member.ts:47–54,113–119,157–237`）。
- flow／session cookie 採 __Host- 名稱；challenge 有效 5 分鐘、session 絕對期限 7 天。細節見 [SIWE.md](SIWE.md)、[WALLET_METHODS.md](WALLET_METHODS.md)。會員路由只讀 session，不另請錢包簽章（`server/auth.ts:22–25`；`server/member.ts:6–13`；`src/world/member.ts:1–6`）。
- 已辨識路由的不支援方法回 405 與 Allow；World prefix 未知 GET 為 404 unknown_route，帳號 prefix 未知路由為 404 UNKNOWN_ROUTE。names 路由先由會員 handler 處理；/api/other 不在四個 Worker prefix，可落入靜態 SPA fallback。

人工名稱處置腳本產生 SQL，沒有管理 HTTP endpoint。此範圍不含 E1、Mint、合約部署或交易提交路由。

## 本次驗證

2026-10-03 13:01:16Z–13:01:40Z 的公開 GET 5/5 成功；四靜態檔與部署紀錄 SHA-256 4/4 相同；四檔各六個標頭共 24/24 符合 public/_headers；匿名 session 回 signedIn:false、no-store。五回答均無 Set-Cookie。未測會員寫入、真實錢包或正式 D1，部署比對仍為 **partial**。見 [DEPLOYMENT_MATCH.md](DEPLOYMENT_MATCH.md)。

公開 subset 加替身：341 tests、337 pass、4 fail；M1 聚焦測試 33/33 通過。指令與限制見 [TESTS/README.md](TESTS/README.md)。
