# IMD Ember World：錢包登入審查快照（World-only）

> Copyright (c) 2026 tungweb3. All rights reserved. Published solely so reviewers can read it for the IMD Ember World
> security review; no licence to copy, modify, redistribute or use is granted.（全文見 `LICENSE`）

## 這是什麼

這是 **審查用的去敏快照**，給外部 reviewer（例如 Swarm／Identity.md 上的 agent）檢查 https://imdember.com 目前正式上線的 World。

它**不是**審查報告、證書或安全保證。裡面的說明文件是專案方對程式現況的描述和已執行的本機測試紀錄；審查結論要由 reviewer 自己重新檢查原始碼與證據後做出。

本輪只回答一個問題：

**玩家在 imdember.com 連上自己的錢包並簽名登入，安全嗎？**

具體包括：錢包被要求簽什麼、頁面與伺服器怎麼檢查、session／cookie／Origin／CSRF／登出（含「登出所有裝置」）、登入的分層速率與預算限制、屋主功能（含「進入我的家」）背後的 NFT 所有權查核，以及阻止注入腳本觸發錢包提示的標頭、CSP 與依賴。

本 repo 有兩個 commit：

| commit | 內容 |
|---|---|
| `c2a8c33`（第一個，已公開，未改動） | 送審版本：來源 `0def8cb`、正式 Worker `beac62be`。Swarm job `4bd31cfb-1151-497f-9b27-40e668dea372` 審查的就是它 |
| 本 commit（`c2a8c33` 之後的唯一一個 commit） | 目前正式版本：來源 `2da46cdafcf8ad3fb3571ea0273ecc5d1ab5be1d`、正式 Worker `50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f`。本檔與其他文件都描述這個版本 |

依持有人的決定，`source/` 只公開判斷「連錢包、簽名登入與屋主權限是否安全」所需的程式：

- **整個伺服器端都公開**：Worker 進入點、`server/` 全部檔案、三個 D1 migration，以及 Worker 在執行期 import 的每個 `src/world/` 模組（本版新增 `siwe.ts`）。reviewer 可以只用本快照重建實際上傳的 Worker bundle，並比對 SHA-256（`DEPLOYMENT_MATCH.md` 第 3 節）。
- **用戶端只公開錢包／登入與屋主權限需要的檔案**：登入狀態機 `auth.ts`、頁面端 SIWE 檢查 `siwe.ts`、EIP-6963 錢包選擇 `wallet.ts`、「我的錢包」面板 `WalletPanel.tsx`／`walletView.ts`、審查紀錄 `reviewRecord.ts`／`auditRecord.ts`、搬家閘門 `moves.ts`，以及「進入我的家」的閘門 `homeEntry.ts`。
- **不公開**：3D 世界、房屋內部的繪製（`src/world/interior/*`）、地形、模型、美術、音樂、新手引導、房屋的分配與擺放規則（`households.ts`、`layout.ts`、`collision.ts`）、主畫面接線 `WorldApp.tsx`。每個不公開的檔案都列在 `manifests/withheld-source.txt`（SHA-256）與 `manifests/withheld-source-gitblobs.txt`（git blob id）。這些程式都已編譯進公開的正式前端 bundle，可以直接對 bundle 檢查（`SCOPE.md` 第 6.3 節）。

**Genesis Mint 不在本次範圍。** 正式 World 的原始碼、前端 bundle 與 Worker bundle 裡都沒有 Mint 程式、路由、合約、signer 或 UI。持有人說明：Genesis Mint 頁面日後會是 `imdember.com` 的子頁面（同一個 origin），並使用本站的 SIWE 登入狀態；Mint 頁面與它的合約會在上線前另外審查。因此，本輪檢視的 session／cookie／Origin／CSP 設計，也是日後 Mint 頁面會依賴的基礎（`SCOPE.md` 第 3 節）。

## 自送審版本以來的變更（c2a8c33／Worker beac62be → 本 commit／Worker 50c688c9）

先前的公開報告：https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md （job：https://explorer.imd.fun/jobs/4bd31cfb-1151-497f-9b27-40e668dea372）。報告的判定是「沒有 High／Critical；F-1 Medium（shared-boundary）、F-2～F-5 Low、F-6～F-8 Info；部署對照 partial」。

**下表的「狀態」都是 IMD 團隊自己的說明，尚未經任何重新審查。** 報告的嚴重度照抄報告；「殘餘風險」是團隊自己寫下、仍然存在的部分。修正分兩輪做在 `0def8cb` 之後的 commit（`git log 0def8cb..2da46cd`，私人 repo），第一次隨 Worker `f9b68223`（來源 `1a0ba21`，2026-09-28 21:05 UTC）上線；目前的 `50c688c9`（來源 `2da46cd`，2026-09-29 05:05 UTC）帶著同一份 Worker bundle（SHA-256 `14584fe4…f5e4`，兩份部署紀錄相同；`1a0ba21` 那份是團隊端證據），其後只改了前端與不公開的世界內容。逐項細節、測試名稱與測試指令：`source/docs/security/AUDIT_REMEDIATION_STATUS.md`（公開版，遮蔽見 `REDACTIONS.md` 第 1.4 節）。

| 發現（報告嚴重度） | 做了什麼（團隊說明） | 殘餘風險（仍存在） | 在哪裡驗證 |
|---|---|---|---|
| **F-1** SIWE 訊息可被轉送（Medium，shared-boundary；對 World 為 Low） | ① 頁面在錢包看到訊息**之前**逐行檢查（domain、URI、chain 1、帳號、nonce、Issued At／Expiration Time、完全相同的 statement；多一行、CR 或相似字元都不行），不符就不要求簽名（`message-mismatch`）。② 簽名視窗開著時，「我的錢包」顯示從已檢查的訊息讀回的摘要（網域、網路、錢包、用途「僅限登入」），並提示「只在網址列是 imdember.com 時簽名；錢包顯示請求來自其他網站或出現不符警告就拒絕」；按鈕上方在錢包打開前就先顯示網域、網路與用途。③ statement 改為「…This does not authorize asset transfers, token or NFT approvals, or transactions.」；上一版措辭的 challenge 仍可在部署前後 5 分鐘內驗證 | 釣魚頁面不會執行本頁的程式，仍可要求簽一則真實訊息；防線仍是錢包的 EIP-4361 domain 比對與玩家本人。頁面檢查防的是錯誤或被竄改的 challenge 回應，**不防**注入本 origin 的腳本（它可以直接呼叫 provider）。Mint 若沿用 session 的影響見 F-8 | `source/src/world/siwe.ts`、`source/src/world/auth.ts:201-207`、`walletView.ts:43-52`；`SIWE.md` 第 1、7 節；`TESTS/siwe-sample/` |
| **F-2** 接受任何簽章的 ERC-1271 合約（Low／Info） | 每個 session 記錄 `wallet_type`（`EOA`／`CONTRACT`）與 `verification_method`（`ECDSA`／`ERC1271`），只供稽核與除錯，不回傳、不授予任何東西（`migrations/0003`）。ERC-1271 路徑的每一種「無法驗證」都拒絕（無金鑰／節點錯誤 503、預算拒絕或丟例外 429、缺綁定 503），不會退回信任地址 | **未解決（ERC-1271 本身的語意）**：合約自己決定誰能代表它簽名；寬鬆合約持有的席位仍可被任何人登入並取得屋主模式（目前只是自己畫面上的唯讀檢視與「進入我的家」）。`CONTRACT` 標記只讓這類 session 在 D1 看得見，不讓它更安全 | `source/server/auth.ts:238-275,367-368`；`DATA_SCHEMA.md`；`OWNERSHIP_AND_HOMES.md` 第 5 節 |
| **F-3** 垃圾簽章可耗盡 `chain:erc1271`（Low，可用性） | ERC-1271 路徑改為每一步都在它要付費的讀取之前檢查、每個 challenge 只查一次：先看該 isolate 的無 code 快取（命中即 401）並查是否為回訪智慧錢包，再依序認領（每 /24 每分鐘 10 次；回訪智慧錢包不佔這個份額）→ 每據點 `chain:code`（180／分，fail closed）→ `eth_getCode`（沒有 code 回 401，並在該 isolate 快取 60 秒；回訪智慧錢包跳過這兩步）→ 合約查核（每 /24 每分鐘 3 次、每個合約地址每分鐘 2 次，跨所有網段）→ 每據點 `chain:erc1271`（首次）或 `chain:erc1271:known`（8 天內以 ERC-1271 登入過的地址）→ 一次 `eth_call`。EOA 的垃圾簽章不再碰合約預算 | **部分未解決**：至少 7 個 /24 對至少 10 個不同合約持續送垃圾時，可讓某據點的**首次**智慧錢包登入在攻擊期間維持 429；回訪智慧錢包有自己的預算，但攻擊者可以自己部署「接受任何簽章」的合約（F-2）來佔用它（每個要付 gas 與一次首次登入）。任何地方每分鐘 2 次垃圾查核，就能讓**單一**合約地址在攻擊期間維持 429（已接受，記錄為 `address`）。EOA 不受影響 | `source/server/auth.ts:48-70,100,119-136,252-275,341-353`；`TESTS/probes/keyed-reads-probe-output.txt`（1、1b、1c） |
| **F-4** 登出只結束這個瀏覽器（Low） | 新增 `POST /api/auth/logout-all`：以本請求的有效 session 找出地址，撤銷該地址所有仍有效的 session（設 `revoked_at`，不刪列）與它未完成的 challenge；Worker 不對它限流。「我的錢包」有「登出此裝置」與「登出所有裝置」（後者要在行內再確認一次）。同瀏覽器其他分頁立即跟上（BroadcastChannel 後重讀伺服器），其他裝置在下一次需要登入的請求時跟上 | 其他裝置不是即時推播，而是下一次請求時才知道；本瀏覽器的 session 已經結束時，無法代表該地址登出其他裝置（頁面會明說，`signout-all-stale`）。bearer cookie 若在撤銷前被使用，撤銷前的那段時間仍有效 | `source/server/auth.ts:393-407`；`source/src/world/auth.ts:227-238,255-258`；`TESTS/siwe-sample/siwe-sample-output.txt`（logout-all 行） |
| **F-5** 約 20 個 /24 可關閉全站登入（Low，可用性，已揭露） | 分層限制（`ROUTES.md` 第 4 節）：L1 每網段、L2 每錢包（同一地址同一網段每分鐘 5 個 challenge 的冷卻；同一地址被許多網段要求時只記錄 `auth_surge`，不封鎖）、L3 每 challenge、L4 每據點（challenge 與 verify 各用自己的 `AUTH_LIMITER` 鍵）、L5 全站閥門（只當緊急上限）。每個 429／503 寫一行 JSON log（不含 IP、完整地址、cookie、訊息或 nonce） | **仍存在**：約 20 個 /24 各自持續用滿份額時，仍可在攻擊期間暫停全站**新**登入（瀏覽不受影響）。邊緣 WAF 規則擋不住這種低速分散的流量。Workers Logs 取樣率 0.2，監控看到的數字約為實際的 1/5 | `source/server/auth.ts:27-47,98-113,290-315,412-429`；`SIWE.md` 第 6 節 |
| **F-6** 建置工具的已知弱點（Info） | wrangler 4.92.0 → 4.143.0（同一個 major；`compatibility_date` 不變），團隊當時的 `npm audit` 為 0 | **本快照重跑（2026-09-29T05:55Z）時 `npm audit` 回報 3 個 moderate**：之後才公布的 undici advisory GHSA-3wwx-pv8p-q78v（undici 7.28.0–7.29.0，經 `wrangler → miniflare`），仍只在建置／本機開發工具鏈；`npm audit --omit=dev` 為 0。網站審查紀錄上 F-6 的「npm audit 為 0」是團隊當時的結果，**以本快照的 `TESTS/npm-audit-all.json` 為準** | `DEPENDENCIES.md` 第 3 節；`TESTS/npm-audit-*.json` |
| **F-7** 其他觀察（Info） | (a) 已由 F-1 的頁面檢查處理；(b)–(e) 依設計維持並列為已知 | (b) 跨站頂層導覽可觸發 `/api/me/home?fresh=1`（只花該 session 自己的份額與每據點 `chain:index`，回應讀不到）；(c) `style-src 'unsafe-inline'`；(d) loopback 例外只看請求 URL 的 hostname（workers.dev 關閉時外部走不到）；(e) 錢包鎖定時保留 session | `SIWE.md` 第 5、8 節 |
| **F-8** 同 origin 共用標頭、cookie 與錢包授權（Info，shared-boundary） | World 沒有需要改的地方 | **未解決**：日後同 origin 的頁面（例如 Mint）會與 World 共用 CSP、`__Host-` cookie、localStorage 與錢包的「已連線網站」，需各自審查 | `SCOPE.md` 第 3 節 |

同一段時間的其他變更（都不改變伺服器授權）：

- **房屋內部「進入我的家」**：只有屋主模式、而且只對 session 地址自己的房子，頁面才提供「進入」；閘門在 `source/src/world/homeEntry.ts`（`enterGate`／`enterableHome`），權限仍只來自伺服器 session＋`/api/me/home`（`ownerOf`）。沒有新的伺服器路由、沒有新的錢包呼叫、不寫伺服器。房屋內部的繪製是一個延遲載入的 JS chunk（`assets/InteriorView-Xan3ABOQ.js`），原始碼不公開，但它在正式站可下載，本快照對它重新計數過錢包方法（`WALLET_METHODS.md` 第 3 節）。見 `OWNERSHIP_AND_HOMES.md` 第 5 節。
- 「我的錢包」底部新增收合的「審查紀錄／Swarm Audit Record」（`reviewRecord.ts`、`auditRecord.ts`）：標明是「先前的審查 — 目前版本已變更」、「修正狀態為 IMD 團隊自行說明，尚未重新審查」、「重新審查：尚未進行」。
- `scripts/deploy-evidence.mjs`：從部署紀錄產生部署證據頁，只複製結構化欄位，不複製任何 log 文字。
- 世界內容（Pepe 裝飾與雕像、房屋內部與家具模型）：不公開，只列雜湊。

## 範圍一覽

| 項目 | 內容 |
|---|---|
| 網站 | https://imdember.com/（唯一 origin；`www.imdember.com` 301、`imd.stickember.com` 302 轉到這裡，為前一輪的觀測，本輪沒有重測） |
| 後端 | 一個 Cloudflare Worker `imd-world`，依設定只由 `/api/auth/*`、`/api/me/*`、`/api/wallet/*`、`/api/world/*` 觸發；Worker 對其他路徑一律轉交 Static Assets（`ROUTES.md` 第 1 節） |
| 錢包方法 | 用戶端仍只呼叫 `eth_accounts`、`eth_requestAccounts`、`personal_sign`（僅 SIWE 登入），只監聽 `accountsChanged`；已在正式主 bundle 與房屋內部 chunk 上重新計數（`WALLET_METHODS.md`） |
| 登入 | SIWE（EIP-4361），訊息由伺服器產生並存在 D1；頁面先逐行檢查才交給錢包；伺服器用 viem 驗簽（ECDSA，必要時 ERC-1271）。verify 判定的驗簽失敗都會作廢 challenge；每個 challenge 最多一次 ERC-1271 查核（`SIWE.md`） |
| 登入限制 | L1 每網段、L2 每錢包、L3 每 challenge、L4 每據點 Cloudflare limiter、L5 全站閥門，外加 zone 的邊緣 WAF 規則；詳表 `ROUTES.md` 第 4 節 |
| 缺少 limiter 綁定 | 正式網址上需要該綁定的路由一律回 503（`LIMITER_UNAVAILABLE`／`limiter_unavailable`），不會變成不限流；只有 loopback 的本機開發維持放行（`chain` 仍拒絕） |
| Session | `__Host-imd_session`（HttpOnly、Secure、SameSite=Lax，7 天絕對期限，DB 只存 SHA-256）；「登出此裝置」與「登出所有裝置」 |
| 所有權 | 以太坊主網 IMD 席位合約 `ownerOf`（經 Multicall3），IMD 公開名冊與 Alchemy 索引只當候選；每一次 NFT 索引讀取都先扣 `CHAIN_LIMITER`（`chain:index`） |
| 房屋 | **一個錢包一間房**，大小依計入的席位數；搬家只寫本機 localStorage；「進入我的家」只給屋主自己的房子，不寫伺服器、不呼叫錢包（`OWNERSHIP_AND_HOMES.md`） |
| WebSocket | 沒有（原始碼、重建的 Worker bundle 與正式前端檔案皆無 WebSocket／EventSource） |
| 範圍外 | Genesis Mint 合約、mint authorize／finalize、Mint signer、永久 metadata／IPFS、Mint 用 renderer／GLB／PNG |

詳細範圍與 World/Mint 邊界表：`SCOPE.md`。

## 版本對應

```text
正式 Worker version  50c688c9-1bcf-4b68-a0ab-b7a9dc6ec82f
        ↑ 由此 commit 建置並部署（npm run deploy：先跑完整測試，再 build 與上傳；從乾淨的工作目錄執行；
          deploy record 20260929T050441Z-2da46cd，2026-09-29T05:04:41Z–05:05:18Z，dirty=false，tests "passed"）
IMD Ember World 私人 repo  commit 2da46cdafcf8ad3fb3571ea0273ecc5d1ab5be1d（branch main，tag v2026.09.29-50c688c9）
        ↑ git -c core.autocrlf=false archive 取出本快照 source/ 的 61 個檔案
          （8 個檔案有遮蔽，只改註解、文件文字、設定值與測試字串，見 REDACTIONS.md；其餘 53 個與 git blob 逐位元組相同）
本快照 repo 的 commit   以本 repo 的 `git log` 為準（檔案無法記載自己所在的 commit）
```

`migrations/0003_sign_in_layers.sql`（只新增可為 NULL 的欄位與索引）在 2026-09-28 約 21:00 UTC、部署 `f9b68223` 之前已套用到正式 D1（團隊端說明；本輪沒有查詢正式資料庫）。

- 正式站前端檔案是公開的，任何人都能下載比對（2026-09-29T05:52:39Z–05:52:58Z 實測，與部署紀錄及重建結果三方相同）：
  - `https://imdember.com/`（index.html）　SHA-256 `7f0f9d5409db78799bb61ba1573d780cc8ecb815f4e60c4f0c8ba7317ce7a75c`（730 bytes）
  - `https://imdember.com/assets/index-Bj4ribmm.js`　SHA-256 `70742ed409b55a400cb8439c3cb5e4bac719f8a4763083c77764d3a7283ef528`（1,344,457 bytes）
  - `https://imdember.com/assets/InteriorView-Xan3ABOQ.js`（房屋內部，延遲載入）　SHA-256 `fbd4e640ac1718781f8980c3671282abfa4893fbc3b05cd672831912ff1770b0`（92,999 bytes）
  - `https://imdember.com/assets/index-5qjaKexX.css`　SHA-256 `adaf06955abcaff313a964c753508d8be821d381bd4bf951d67e95ec08202233`（54,966 bytes）
- 這些 bundle 包含不公開的前端程式（3D、房屋擺放與內部、`WorldApp.tsx` 的接線），所以 XSS／供應鏈與錢包接線的檢查可以直接對正式檔案做。
- 後端：reviewer 可以**只用本快照 `source/`** 重建實際上傳的 Worker bundle（`wrangler deploy --dry-run --outdir`），SHA-256 應為 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`（264,561 bytes；步驟見 `DEPLOYMENT_MATCH.md` 第 3 節）。Cloudflare 上實際執行的程式與機密設定仍無法從外部確認（`DEPLOYMENT_MATCH.md` 第 2 節）。

## 如何測試

環境：Node **v24.19.0**（`source/.nvmrc`；`package.json` engines `>=24 <25`）、npm **11.17.0**。不需要任何金鑰或 `.env`。

`tests/deploy.test.mjs` 與 `tests/deploy-evidence.test.mjs` 會呼叫 `git`，而且假設 `source/` 就是 git repo 的根目錄（它們讀 `git show HEAD:wrangler.jsonc` 與 `HEAD:migrations/…`）。所以請把 `source/` 複製成一個獨立的 git repo 再測：

```sh
cp -r source ../imd-src && cd ../imd-src          # 或任何暫存目錄
git init -q && git add -A && git -c user.name=r -c user.email=r commit -qm snapshot
npm ci
# 兩個被保留模組的測試用替身（不含房屋幾何，見 TESTS/stubs/）：
cp <本 repo>/TESTS/stubs/households.ts src/world/households.ts
cp <本 repo>/TESTS/stubs/layout.ts src/world/layout.ts
npm test                                          # = node --test tests/*.test.mjs
node --test --test-name-pattern="group 5" tests/home-entry.test.mjs   # 「進入我的家」的授權測試
rm src/world/households.ts src/world/layout.ts
```

- 本快照在 2026-09-29T05:54:52Z 執行：加上替身時 **141 項中 138 項通過**，3 項失敗，**全部是因為被保留的程式**：`home-entry.test.mjs` 的兩項房屋門口幾何測試（需要被保留的 `layout.ts`／`households.ts` 幾何，替身故意不提供）與一項 `?interior=` 預覽測試（需要被保留的 `src/world/interior/mockSeats.ts`）。「進入我的家」的三項授權測試（`group 5`）全部通過。不加替身時 120 項中 118 項通過，`ownership.test.mjs` 與 `home-entry.test.mjs` 兩個檔案無法載入。原始輸出：`TESTS/`。
- 這些是本機 mock／unit 測試，沒有瀏覽器測試，也沒有真實錢包測試。完整原始碼（commit 2da46cd 的 63 個測試檔，含被保留檔案）的 **617 項**測試在團隊端全部通過（`TESTS/README.md` 第 2 節）。
- `npm run build`（前端）在本快照**無法完成**：`tsc --noEmit` 的錯誤全部來自被保留的檔案（`TESTS/tsc-noEmit-output.txt`）。Worker 的建置不需要這些檔案。

## 規格項目在哪裡

持有人的審查規格（v1.1，World-only）與團隊內部的修正計畫本身**不隨本 repo 公開**（程式註解裡提到的「remediation … §x」就是這份內部修正計畫的章節；它的公開摘要是 `source/docs/security/AUDIT_REMEDIATION_STATUS.md`）。規格要求的材料清單與本快照位置如下：

| 規格材料 | 本快照位置 |
|---|---|
| 範圍說明 | `SCOPE.md`、`ROUTES.md` |
| World／Mint 邊界 | `SCOPE.md` 第 3 節 |
| 與規格的差異（房屋） | `SCOPE.md` 第 4 節 |
| 前端（Connect、SIWE、頁面端檢查、session 恢復、換帳號／換鏈、錯誤處理、Provider 呼叫、第三方 script、動態模組） | `WALLET_METHODS.md`、`SIWE.md` 第 7 節、`DEPENDENCIES.md`；原始碼 `source/src/world/{auth,siwe,wallet,WalletPanel,walletView,moves,homeEntry}.ts(x)` |
| 後端（challenge、verify、session、logout、logout-all、ownerOf、房屋 API、WebSocket、middleware、速率與預算） | `ROUTES.md`、`SIWE.md`、`OWNERSHIP_AND_HOMES.md`；原始碼 `source/server/`、`source/worker/` |
| 資料層（去敏 schema、nonce 一次性、session 撤銷／到期、快取、清理） | `DATA_SCHEMA.md`、`source/migrations/0001`～`0003` |
| 建置（lock 檔、Node／npm 版本、指令） | 本檔、`DEPENDENCIES.md`、`source/package-lock.json` |
| 測試（來源與原始輸出，區分 mock／瀏覽器／實際錢包） | `TESTS/` |
| 部署對照 | `DEPLOYMENT_MATCH.md`、`manifests/` |
| 原始登入訊息 | `SIWE.md` 第 1 節、`TESTS/siwe-sample/`（合成金鑰，無簽章） |
| 修正狀態 | 本檔上一節、`source/docs/security/AUDIT_REMEDIATION_STATUS.md` |
| 檔案清單 | `SHA256SUMS`、`manifests/withheld-source.txt`、`REDACTIONS.md`、`PUBLIC_CONTENT_LIST.md` |

## 證據來源分欄

- **可自行驗證**：`source/` 原始碼與 `npm test`；從 `source/` 重建的 Worker bundle 雜湊；正式站公開檔案的 SHA-256 與字串計數；公開回應標頭。
- **僅團隊端證據**：deploy record（manifest、SHA256SUMS、上傳紀錄本身）、正式 D1 已套用 0003 的說明、持有人 dashboard 顯示的內容（Worker 清單、綁定、secret 名稱、WAF 規則）與團隊實測、被保留檔案的內容與對它們做的搜尋、完整原始碼的測試與前端重建、`f9b68223` 與 `50c688c9` 的 Worker bundle 相同這件事。reviewer 無法獨立取得，只能看到雜湊。
- **修正狀態**：全部是 IMD 團隊自己的說明，尚未經重新審查。

文件引用團隊端證據時會標「團隊端」。

## 檔案完整性

- 根目錄的 `.gitattributes`（`* -text`）讓 git 不轉換任何檔案的換行，所以在 Windows（`core.autocrlf=true`）上 clone 也能得到相同位元組。
- `SHA256SUMS`（`sha256sum` 格式、相對路徑）涵蓋本 repo 除了它自己以外的全部檔案：`sha256sum -c SHA256SUMS`。
- `source/` 中除 `REDACTIONS.md` 第 1 節列出的 8 個遮蔽檔案外的 53 個檔案，`git hash-object --no-filters` 的結果等於 `manifests/published-source-gitblobs.txt` 列出的 commit 2da46cd blob id。

## 注意

- `source/docs/wallet-login/DESIGN_W1_v001.md` 的正文有些段落寫於 hardening 之前（例如舊的搬家簽章 `signMove`）；檔末的 Amendments 與第 15 節記錄了現況。**以程式碼為準。**
- 測試名稱也可能沿用舊稱（例如被保留的 `households.test.mjs` 有一項叫「a signed move …」）；搬家目前不簽章（`source/src/world/moves.ts:1-5`）。
- 本快照不含任何私鑰、助記詞、`.env`、`.dev.vars`、API／RPC key、session cookie、Bearer token 或有效的正式簽章（`REDACTIONS.md`）。
