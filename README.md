# IMD Ember World：錢包登入審查快照（World-only）

> Copyright (c) 2026 tungweb3. All rights reserved. Published solely so reviewers can read it for the IMD Ember World
> security review; no licence to copy, modify, redistribute or use is granted.（全文見 `LICENSE`）

## 這是什麼

這是 **審查用的去敏快照**，給外部 reviewer（例如 Swarm／Identity.md 上的 agent）檢查 https://imdember.com 目前正式上線的 World。

它**不是**審查報告、證書或安全保證。裡面的說明文件是專案方對程式現況的描述和已執行的本機測試紀錄；審查結論要由 reviewer 自己重新檢查原始碼與證據後做出。

本輪只回答一個問題：

**玩家在 imdember.com 連上自己的錢包並簽名登入，安全嗎？**

具體包括：錢包被要求簽什麼、伺服器怎麼驗證、session／cookie／Origin／CSRF／登出、登入的速率與預算限制、屋主功能背後的 NFT 所有權查核，以及阻止注入腳本觸發錢包提示的標頭、CSP 與依賴。

依持有人的決定，`source/` 只公開判斷「連錢包與簽名登入是否安全」所需的程式：

- **整個伺服器端都公開**：Worker 進入點、`server/` 全部檔案、兩個 D1 migration，以及 Worker 在執行期 import 的每個 `src/world/` 模組。reviewer 可以只用本快照重建實際上傳的 Worker bundle，並比對 SHA-256（`DEPLOYMENT_MATCH.md` 第 3 節）。
- **用戶端只公開錢包／登入流程需要的檔案**（登入狀態機、EIP-6963 錢包選擇、「我的錢包」面板、屋主判斷與搬家閘門）。
- **不公開**：3D 世界、地形、模型、美術、音樂、新手引導，以及房屋的分配與擺放規則（`households.ts`、`layout.ts`、`collision.ts` 與其測試）、主畫面接線 `WorldApp.tsx`。每個不公開的檔案都列在 `manifests/withheld-source.txt`（SHA-256）與 `manifests/withheld-source-gitblobs.txt`（git blob id）。這些程式都已編譯進公開的正式前端 bundle，可以直接對 bundle 檢查（`SCOPE.md` 第 6.3 節）。

**Genesis Mint 不在本次範圍。** 正式 World 的原始碼、前端 bundle 與 Worker bundle 裡都沒有 Mint 程式、路由、合約、signer 或 UI。持有人說明：Genesis Mint 頁面日後會是 `imdember.com` 的子頁面（同一個 origin），並使用本站的 SIWE 登入狀態；Mint 頁面與它的合約會在上線前另外審查。因此，本輪檢視的 session／cookie／Origin／CSP 設計，也是日後 Mint 頁面會依賴的基礎（`SCOPE.md` 第 3 節）。

## 範圍一覽

| 項目 | 內容 |
|---|---|
| 網站 | https://imdember.com/（唯一 origin；`www.imdember.com` 301、`imd.stickember.com` 302 轉到這裡，為前一輪的觀測） |
| 後端 | 一個 Cloudflare Worker `imd-world`，依設定只由 `/api/auth/*`、`/api/me/*`、`/api/wallet/*`、`/api/world/*` 觸發；Worker 對其他路徑一律轉交 Static Assets（`ROUTES.md` 第 1 節） |
| 錢包方法 | 用戶端只呼叫 `eth_accounts`、`eth_requestAccounts`、`personal_sign`（僅 SIWE 登入），只監聽 `accountsChanged`（`WALLET_METHODS.md`，已在正式 bundle 上重新計數） |
| 登入 | SIWE（EIP-4361），訊息由伺服器產生並存在 D1；伺服器用 viem 驗簽（ECDSA，必要時 ERC-1271）。**verify 判定的驗簽失敗（400／401／429 `CHAIN_BUSY`／503 `VERIFY_UNAVAILABLE`）都會作廢該 challenge**（limiter 綁定缺失或 D1 故障的 503 例外，見 `SIWE.md` 第 3 節）；ERC-1271 查核每個 challenge 最多一次（`SIWE.md`） |
| 登入預算 | D1 內原子計數：每個網段（IPv4 /24、IPv6 /48）每分鐘 30 個 challenge、全站每 6 秒 60 個（失控閥），超過回 429 `SIGN_IN_BUSY`；ERC-1271 查核每網段每分鐘 3 次，再扣每據點的 `CHAIN_LIMITER`，超過回 429 `CHAIN_BUSY`（`SIWE.md` 第 6 節） |
| 邊緣限流 | `imdember.com` zone 的 Cloudflare WAF rate limiting rule：以 IP 計數，同一 IP 在 10 秒內超過 20 個 `/api/` 請求時，由 Cloudflare 邊緣 Block 10 秒（回 429）；2026-09-29 約 01:20（+08）起涵蓋整個 `/api/`（之前只有 `/api/world/`），登出也計入。每 IP 每 10 秒 20 次以內（平均送時約每分鐘 120 次）的請求仍會到達 Worker，由 Worker 自己的 limiter 與上列 D1 預算處理；分散在許多 IP 的洪水也一樣（團隊端設定與實測，`ROUTES.md` 第 4 節） |
| 缺少 limiter 綁定 | 正式網址上需要該綁定的路由一律回 503（`LIMITER_UNAVAILABLE`／`limiter_unavailable`），不會變成不限流；只有 loopback 的本機開發維持放行（`ROUTES.md` 第 4 節） |
| Session | `__Host-imd_session`（HttpOnly、Secure、SameSite=Lax，7 天絕對期限，DB 只存 SHA-256） |
| 所有權 | 以太坊主網 IMD 席位合約 `ownerOf`（經 Multicall3），IMD 公開名冊與 Alchemy 索引只當候選；每一次 NFT 索引讀取都先扣 `CHAIN_LIMITER`（`chain:index`），被拒時只用名冊候選並回 `recheck:'limited'` |
| 房屋 | **一個錢包一間房**，大小依計入的席位數；搬家只寫本機 localStorage，不寫伺服器、不呼叫錢包。與規格的差異見 `SCOPE.md` 第 4 節 |
| WebSocket | 沒有（原始碼與兩份 bundle 皆無 WebSocket／EventSource） |
| 範圍外 | Genesis Mint 合約、mint authorize／finalize、Mint signer、永久 metadata／IPFS、Mint 用 renderer／GLB／PNG |

詳細範圍與 World/Mint 邊界表：`SCOPE.md`。

## 版本對應

```text
正式 Worker version  beac62be-27ff-40cd-9dc4-3cbbdc6add4b
        ↑ 由此 commit 建置並部署（npm run deploy：先跑完整測試，再 build 與上傳；
          deploy record 20260928T160119Z-0def8cb，2026-09-28T16:01:19Z–16:01:50Z，dirty=false，tests "passed"）
IMD Ember World 私人 repo  commit 0def8cb5b80083d32545c59bc707fbbc92a4758d（branch main／harden2，tag v2026.09.29-beac62be）
        ↑ git -c core.autocrlf=false archive 取出本快照 source/ 的 51 個檔案
          （5 個檔案有遮蔽，只改註解、文件文字與設定值，見 REDACTIONS.md；其餘 46 個與 git blob 逐位元組相同）
本快照 repo 的 commit   以本 repo 的 `git log` 為準（檔案無法記載自己所在的 commit）
```

部署前，`migrations/0002_sign_in_budgets.sql`（只新增兩個可為 NULL 的欄位與三個索引）已套用到正式 D1（團隊端說明；本輪沒有查詢正式資料庫）。

- 正式站前端 bundle 是公開的，任何人都能下載比對（2026-09-28T16:06Z 實測，與部署紀錄及重建結果三方相同）：
  - `https://imdember.com/assets/index-BPJxeGls.js`　SHA-256 `3ba7f1e06d50d8a05f90bf23e7ccdbff0e6daf2717ce6e2cbe8e42319970277e`（1,306,006 bytes）
  - `https://imdember.com/assets/index-BOzKL2IR.css`　SHA-256 `83f3b7da4ac0845236cd609d89b17d3e30958ed99bbce5ded93f2ed26cafd804`（53,394 bytes，與前一版相同）
  - `https://imdember.com/`（index.html）　SHA-256 `49973696ecc3db3bdac2cf041d3f903b2b5f9bfe687f0895f2d0eb0aae357459`（730 bytes）
- 這份完整 bundle 包含不公開的前端程式（3D、房屋擺放、`WorldApp.tsx` 的接線），所以 XSS／供應鏈與錢包接線的檢查可以直接對正式 bundle 做。
- 後端：reviewer 可以**只用本快照 `source/`** 重建實際上傳的 Worker bundle（`wrangler deploy --dry-run --outdir`），SHA-256 應為 `4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3`（257,723 bytes；步驟見 `DEPLOYMENT_MATCH.md` 第 3 節）。Cloudflare 上實際執行的程式與機密設定仍無法從外部確認；Worker 清單、綁定與 secret 名稱有持有人提供的 dashboard 截圖（reviewer 無法獨立驗證，`DEPLOYMENT_MATCH.md` 第 2 節）。

## 如何測試

環境：Node **v24.19.0**（`source/.nvmrc`；`package.json` engines `>=24 <25`）、npm **11.17.0**。不需要任何金鑰或 `.env`。請在本 repo 的 git clone 裡執行（`deploy.test.mjs` 有一項會呼叫 `git check-ignore`）。

```sh
cd source
npm ci
# ownership.test.mjs 需要被保留的 households.ts 裡的一個 re-export；用 TESTS/stubs 的一行替身：
cp ../TESTS/stubs/households.ts src/world/households.ts
npm test          # = node --test tests/*.test.mjs
rm src/world/households.ts
```

- 本快照在 2026-09-28T16:51Z 執行：加上替身時 **112 項全部通過**（`TESTS/npm-test-output.txt`）；不加替身時 96 項通過，`ownership.test.mjs` 因找不到 `households.ts` 無法載入、記為 1 項失敗（`TESTS/npm-test-output.no-stub.txt`）。
- 這些是本機 mock／unit 測試，沒有瀏覽器測試，也沒有真實錢包測試。完整原始碼（commit 0def8cb 的 49 個測試檔，含被保留檔案）的 **514 項**測試在團隊端全部通過（`TESTS/README.md` 第 1 節）。
- `npm run build`（前端）在本快照**無法完成**：`tsc --noEmit` 的錯誤全部來自被保留的檔案（`WorldApp.tsx`、`households.ts`、`layout.ts`；`TESTS/tsc-noEmit-output.txt`）。Worker 的建置不需要這些檔案。

## 規格項目在哪裡

持有人的審查規格（v1.1，World-only）本身**不隨本 repo 公開**。它要求的材料清單與本快照位置如下；本 repo 其他地方引用規格時，都直接寫出被引用的要求內容，不依賴章節號：

| 規格材料 | 本快照位置 |
|---|---|
| 範圍說明 | `SCOPE.md`、`ROUTES.md` |
| World／Mint 邊界 | `SCOPE.md` 第 3 節 |
| 與規格的差異（房屋） | `SCOPE.md` 第 4 節 |
| 前端（Connect、SIWE、session 恢復、換帳號／換鏈、錯誤處理、Provider 呼叫、第三方 script、動態模組） | `WALLET_METHODS.md`、`SIWE.md` 第 7 節、`DEPENDENCIES.md`；原始碼 `source/src/world/{auth,wallet,WalletPanel,walletView,moves}.ts(x)` |
| 後端（challenge、verify、session、logout、ownerOf、房屋 API、WebSocket、middleware、速率與預算） | `ROUTES.md`、`SIWE.md`、`OWNERSHIP_AND_HOMES.md`；原始碼 `source/server/`、`source/worker/` |
| 資料層（去敏 schema、nonce 一次性、session 撤銷／到期、快取、清理） | `DATA_SCHEMA.md`、`source/migrations/0001_wallet_login.sql`、`0002_sign_in_budgets.sql` |
| 建置（lock 檔、Node／npm 版本、指令） | 本檔、`DEPENDENCIES.md`、`source/package-lock.json` |
| 測試（來源與原始輸出，區分 mock／瀏覽器／實際錢包） | `TESTS/` |
| 部署對照 | `DEPLOYMENT_MATCH.md`、`manifests/` |
| 原始登入訊息 | `SIWE.md` 第 1 節、`TESTS/siwe-sample/`（合成金鑰，無簽章） |
| 檔案清單 | `SHA256SUMS`、`manifests/withheld-source.txt`、`REDACTIONS.md`、`PUBLIC_CONTENT_LIST.md` |

## 證據來源分欄

規格要求把「團隊提供的證據」和「reviewer 可自行驗證的證據」分開。本快照的標示方式：

- **可自行驗證**：`source/` 原始碼與 `npm test`；從 `source/` 重建的 Worker bundle 雜湊；正式站公開 bundle 的 SHA-256 與字串計數；公開回應標頭。
- **僅團隊端證據**：deploy record（manifest、SHA256SUMS、上傳紀錄本身）、正式 D1 已套用 0002 的說明、持有人提供的 Cloudflare dashboard 截圖所顯示的內容（Worker 清單、綁定、secret 名稱；截圖本身不收錄）、WAF 規則的設定與團隊的實測、被保留檔案的內容與對它們做的搜尋、完整原始碼的測試與前端重建。reviewer 無法獨立取得，只能看到雜湊。

文件引用團隊端證據時會標「團隊端」。

## 檔案完整性

- 根目錄的 `.gitattributes`（`* -text`）讓 git 不轉換任何檔案的換行，所以在 Windows（`core.autocrlf=true`）上 clone 也能得到相同位元組。
- `SHA256SUMS`（`sha256sum` 格式、相對路徑）涵蓋本 repo 除了它自己以外的全部檔案：`sha256sum -c SHA256SUMS`。
- `source/` 中除 `REDACTIONS.md` 第 1 節列出的 5 個遮蔽檔案外的 46 個檔案，`git hash-object --no-filters` 的結果等於 `manifests/published-source-gitblobs.txt` 列出的 commit 0def8cb blob id。

## 注意

- `source/docs/wallet-login/DESIGN_W1_v001.md` 的正文寫於 hardening 之前，部分段落仍描述舊的搬家簽章（`signMove`）。檔末的 Amendments 記錄了現況：搬家已不再簽章。**以程式碼為準。**
- 測試名稱也可能沿用舊稱（例如被保留的 `households.test.mjs` 有一項叫「a signed move …」）；搬家目前不簽章（`source/src/world/moves.ts:1-5`）。
- 本快照不含任何私鑰、助記詞、`.env`、`.dev.vars`、API／RPC key、session cookie、Bearer token 或有效的正式簽章（`REDACTIONS.md`）。
