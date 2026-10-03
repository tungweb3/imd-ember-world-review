> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# SIWE：登入、訊息檢查、nonce、session 與撤銷

## 1. 範圍與版本

本頁是團隊對公開 source 的說明，供 reviewer 驗證；不是外部複查結果或認證。

| 項目 | 本次固定目標 |
| --- | --- |
| Worker | `acdbb2bd-8add-4b15-bfa6-a31266c83520` |
| 部署 source | `ddb10e28a867998323164e7585635efedfcf7788` |
| 快照 source | main `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c` |
| D1 | 0001–0006；0006 新增 M1，原 sessions 表未變 |
| 上次外部審查 | 公開 `8cad017`／Worker `bbf24001`；Audit `1ef8e8a6`、Report `dcf922ca` |

LIVE 與 main 的差異是一份狀態文件與一頁新增部署證據，不進建置。R3-R1、AUD3-01～08 修正尚未外部複查；M1 會員／公開玩家名稱從未由 Swarm 審查。Genesis Mint、Coin E1／0007 不在本次範圍。

## 2. 一次登入的流程

1. `AuthClient.start()` 讀 session、已授權帳號並監聽分頁通知；不要求簽名（`source/src/world/auth.ts:189`）。
2. `signIn()` 等最新 session read，並等本頁尚未完成的 logout／被取消 verify。後者最多等 5 秒；session read 本身沒有這個五秒上限（`source/src/world/auth.ts:174`、`source/src/world/auth.ts:280`）。
3. 狀態仍不明就不簽。必要時呼叫 `eth_requestAccounts`；同一帳號已有有效 session 時直接重讀家；另一帳號的 session 先登出（`source/src/world/auth.ts:302`、`source/src/world/auth.ts:307`、`source/src/world/auth.ts:315`）。
4. `POST /api/auth/challenge {address}`；伺服器產生、儲存精確 SIWE 原文與新的 flow cookie（`source/server/auth.ts:482`）。
5. 回應到達後，頁面確認仍是同一流程／provider／account，再逐行檢查訊息（`source/src/world/auth.ts:331`、`source/src/world/auth.ts:334`）。
6. 只簽 `personal_sign [hexUtf8(message), account]`（`source/src/world/auth.ts:338`）。拒絕／取消不自動重試。
7. 簽名回來再確認 provider／account；`POST /api/auth/verify {nonce,signature}`。成功後讀 `/api/me/home`（`source/src/world/auth.ts:340`、`source/src/world/auth.ts:345`、`source/src/world/auth.ts:356`）。
8. 沒有將登入簽名當作資產授權、搬家簽名或 Mint 授權。連接帳號本身也不授予 session 或屋主權。

## 3. SIWE 原文與合成樣本

格式由 `createSiweMessage` 建立（`source/server/auth.ts:489`），statement 與頁面共用（`source/src/world/siwe.ts:5`）。下方是**欄位示意**，占位值不能用來登入；實際合成輸出見 `TESTS/siwe-sample/`。

```text
imdember.com wants you to sign in with your Ethereum account:
<SYNTHETIC_CHECKSUM_ADDRESS>

Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.

URI: https://imdember.com/
Version: 1
Chain ID: 1
Nonce: <SYNTHETIC_32_LOWERCASE_HEX>
Issued At: <SERVER_UTC_TIME>
Expiration Time: <SERVER_UTC_TIME_PLUS_5_MINUTES>
```

| 欄位 | 固定／產生方式 | 當前 source |
| --- | --- | --- |
| domain／URI | allowed Origin 的 host／origin 加 `/`；正式僅 https://imdember.com | `source/server/auth.ts:20`、`source/server/auth.ts:349`、`source/server/auth.ts:489` |
| address | body 唯一可指定的身份欄位；40 hex，轉 checksum／儲存小寫 | `source/server/auth.ts:483`、`source/server/auth.ts:487` |
| statement | 上述固定全文 | `source/src/world/siwe.ts:5` |
| version／chainId | `1`／`1`；不要求錢包切鏈 | `source/server/auth.ts:489` |
| nonce | 新 16-byte 隨機值，32 位小寫 hex | `source/server/auth.ts:488` |
| issuedAt | body 讀完後取時鐘 | `source/server/auth.ts:483` |
| expirationTime | issuedAt + 5 分鐘；是 challenge 期限 | `source/server/auth.ts:25`、`source/server/auth.ts:488` |
| session 期限 | challenge issuedAt + 7 天；不是成功 verify 後再加七天 | `source/server/auth.ts:573` |
| 額外 Resources／Request ID／Not Before | 此伺服器不產生；頁面不接受額外行 | `source/src/world/siwe.ts:16` |

合成生成器 `TESTS/siwe-sample/generate-siwe-sample.mjs` 呼叫真正 handler／0001–0006 migrations／node:sqlite／頁面檢查；不用真錢包、不讀 key、不連正式站。合成輸出不是正式 session 或真錢包驗證。

## 4. 頁面端的逐行檢查

`checkSignInMessage` 要求恰好 11 行；比對完整行，CR、相似字元、額外行都不能通過（`source/src/world/siwe.ts:16`、`source/src/world/siwe.ts:19`）。

- host 與目前 origin、URI、account 必須一致；地址比對不分大小寫。
- statement、Version 1、Chain ID 1 與空白行都精確相同。
- nonce 必須是 challenge 的 32 位小寫 hex。
- Issued At 與本機時鐘差距最多 10 分鐘；expiration 必須在 issued 之後且差距不超過 5 分鐘（`source/src/world/siwe.ts:9`、`source/src/world/siwe.ts:23`）。
- 檢查與 `personal_sign` 之間沒有 await；簽名中摘要由通過檢查的訊息讀出（`source/src/world/auth.ts:334`、`source/src/world/siwe.ts:30`）。
- 檢查失敗顯示 `message-mismatch`，不送錢包；已開啟的錢包視窗不能由頁面強制關閉。
- 這是目前頁面的防禦；無法保證惡意擴充功能、注入 JS 或仿冒頁會做同樣檢查。請求網站／錢包 origin 提示仍重要（`source/src/world/walletView.ts:77`）。

## 5. Verify：存儲原文、驗簽與原子 consume

入口 `source/server/auth.ts:511`；伺服器不接收 client 傳來的 message 或 address 來取代原文。

1. 路由先檢查 D1、Origin，再用獨立 `verify:` limiter；body 是 JSON、≤2048 bytes（`source/server/auth.ts:650`、`source/server/auth.ts:384`）。
2. body 讀完後取時鐘；nonce／signature 格式不合回 400（`source/server/auth.ts:512`）。
3. 依 nonce 讀 challenge；不存在／used／invalidated 回 409；flow cookie hash 與 Origin 不符回 403；到期回 410（`source/server/auth.ts:514`、`source/server/auth.ts:518`、`source/server/auth.ts:520`）。在 flow 比對以前不作廢別人的 challenge。
4. 到 burn 階段後的 unsupported／invalid／busy／RPC unavailable 都作廢 challenge。ERC-6492 suffix 回 400（`source/server/auth.ts:526`、`source/server/auth.ts:529`）。
5. 重新 parse **D1 存的原文**，比對 domain、address、nonce、時間、URI、chainId、version、statement、issued_at／accept_until（`source/server/auth.ts:532`）。
6. ECDSA 或 ERC-1271 驗證通過才可建立 session；結果不是簽署控制權證明就拒絕（`source/server/auth.ts:565`）。
7. consume 前再取一次時鐘。條件 UPDATE 與 `INSERT ... SELECT` 同一 D1 batch；INSERT 只接受本次產生的 session_hash，並有唯一 nonce 限制。並發成功簽章不能產生兩個 session（`source/server/auth.ts:573`、`source/server/auth.ts:576`）。
8. consume 時到期／競爭失敗回 409。只有 UNIQUE race 當作競爭；其他 D1 例外回 503，不當成靜默成功（`source/server/auth.ts:582`）。
9. limiter missing／D1 例外可能在 burn 前結束；已寫 checked_at 的 nonce 不能重做 ERC-1271。不要簡化成「任何錯誤必定 burn」。

以上是程式與本機測試要證明的行為；沒有透過此文件證明正式 D1 runtime 的所有返回值與原子性。

## 6. ECDSA／ERC-1271 與限制

| 階段 | 行為 | source |
| --- | --- | --- |
| ECDSA first | recoverMessageAddress 等於目標就成功，不讀鏈；包含以自己的 key 簽名的 delegated EOA | `source/server/auth.ts:429` |
| 未知地址／no-code | isolate 60 秒 no-code cache；未知合約先 claim，扣 chain:code，再 eth_getCode | `source/server/auth.ts:397`、`source/server/auth.ts:434` |
| 已知 ERC-1271 | retained ERC1271 session 的部分索引查詢；略過 code read，不代表永久信任簽名 | `source/server/auth.ts:287`、`source/server/auth.ts:435` |
| contract check | D1 network／subnet／address share 或 lane，之後 location limiter | `source/server/auth.ts:549` |
| eth_call | `isValidSignature(hashMessage(message),signature)`，latest；必須完整等於 ABI magic word | `source/server/auth.ts:310`、`source/server/auth.ts:452` |
| error | revert／列出的 EVM halt 是 invalid；節點/HTTP/transport 不可用是 unavailable，不放行 | `source/server/auth.ts:459` |
| release | limiter 不准時釋放 called_at／called_via，但保留 checked_at 並 burn；已送出 eth_call 的 claim 不退 | `source/server/auth.ts:297`、`source/server/auth.ts:449`、`source/server/auth.ts:563` |

F-2 殘留：如果合約對任何簽名都回 magic word，任何人可能以該合約登入。這是 ERC-1271 目標合約的寬鬆政策，不表示 ECDSA key 已洩漏；ownerOf 仍另外查。

## 7. Cookie、session、Origin 與 budgets

| 值／規則 | 實作 |
| --- | --- |
| flow cookie | `__Host-imd_flow`，新 16-byte hex；Secure、HttpOnly、Path=/、無 Domain、SameSite=Strict、5 分鐘 |
| session cookie | `__Host-imd_session`，新 32-byte base64url（43 字元）；相同 Host 屬性、SameSite=Lax，絕對到期 |
| D1 | 只存 token SHA-256；每次受保護讀取檢查 row／revoked_at／expires_at |
| 儲存位置 | cookie 由瀏覽器管理，前端不讀 token；localStorage session hint 只有 address／expiry |

參照 `source/server/auth.ts:22`、`source/server/auth.ts:367`、`source/server/auth.ts:469`、`source/server/auth.ts:573`、`source/src/world/auth.ts:86`。

所有 auth POST 都要求 allowed Origin；production 不接受 localhost Origin。API_HEADERS 不加入跨站 CORS 許可（`source/server/auth.ts:349`、`source/server/auth.ts:657`）。GET 不靠 Origin 作身份驗證，受保護 GET 仍靠 cookie／D1。

- challenge／verify 每 IP(/IPv6 /64)各 20/min，verify 使用分開 key；logout 永不受 limiter 拒絕（`source/server/auth.ts:659`、`source/worker/app.ts:109`）。
- D1 network challenge：IPv4 /24 30/min、IPv6 /48 兩倍；global 是 60/6 秒，其中 20 保留給當期未問過的新 network（`source/server/auth.ts:180`、`source/server/auth.ts:197`）。
- ERC-1271 code share 10、contract share 3、address share 2；IPv6 /48 兩倍且 /64 限一份。code cap 180/min/location；每個 chain key 20/min/location（`source/server/auth.ts:182`、`source/server/auth.ts:218`、`source/server/auth.ts:324`）。
- auth／verify／home／chain／code limiter 例外 fail closed；api／seat 讀取例外 fail open；missing binding 非 loopback 一律 503（`source/server/auth.ts:376`、`source/worker/app.ts:115`）。
- Cloudflare 實際拒絕是否計次仍未知；mock 固定窗口不是正式環境證據。AUD3-02／03 release 依賴此假設（`source/server/auth.ts:101`）。

## 8. 撤銷、非同步與 M1

`GET /api/auth/session` 不清過期 cookie，也不發 Set-Cookie；`/api/me/home` 401 與被拒 logout-all 同樣不清 cookie（`source/server/auth.ts:596`、`source/server/auth.ts:620`、`source/server/auth.ts:684`）。這避免死 cookie 的慢回應覆蓋別的分頁的新登入。

明確 logout 會撤 session／flow 並清兩 cookie；logout-all 只能由目前 live session 決定 address，撤該地址全部 live sessions／open challenges（`source/server/auth.ts:603`、`source/server/auth.ts:617`）。明確 logout 的慢回應仍可能清另一分頁較新的同名 cookie，屬已知殘留。

Client 用 gen／sessionReads／homeGen 丟舊回應（`source/src/world/auth.ts:223`、`source/src/world/auth.ts:245`）。每個 accountsChanged 先遞增 accountEvents（`source/src/world/auth.ts:396`）；confirmed logout 再使舊讀取失效（`source/src/world/auth.ts:426`）。已取消 verify 的晚到成功從 headers 到達即發 logout，不等待 body（`source/src/world/auth.ts:349`、`source/src/world/auth.ts:411`）。

M1 在 `source/worker/app.ts:139` 先 dispatch，但只用既有 `readSession`。名稱寫入以 session／actor／version 綁定，不簽錢包、不授屋主權，沒有 Set-Cookie（`source/server/member.ts:39`、`source/server/member.ts:174`）。GET profile 仍可能 hourly touch last_login_at（`source/server/member.ts:131`）；不能稱所有 GET 完全不寫 D1。

## 9. 本輪證據與未驗證項

本輪測試摘要：`公開無 stubs：161 run／157 pass／4 fail；公開加 stubs：341／337／4（3 項 withheld UI／geometry、1 項 deploy-evidence 私有歷史依賴）；focused 90/90、N 43/43、M1 server/client 33/33、Enter group 5 3/3。完整私有 source archive：1009／1008／1，亦為歷史依賴；npm audit production／all 均 0。全套公開測試不是全通，完整 UI／tsc 受 withheld imports 限制`；以 `TESTS/README.md` 與新 log 為準，不能沿用前輪數字。

2026-10-03T13:01:16Z～13:01:40Z 的五個允許 GET 均200；四靜態檔 body hash 對上、24個靜態標頭比較相同。session GET 為 signedIn:false／no-store，五個都無 Set-Cookie。**Deployment match 仍是 partial**：GET 不證明 running Worker identity、D1／secret／binding／WAF／limiter accounting。

本次沒有 Owner 真錢包驗證。舊 MetaMask 登入紀錄只屬 Worker bbf24001，不能搬到本版。未公開 UI imports／場景／室內使完整 app build 不能只靠此包重現。合成 handler、SQLite 與 React fixture 不是正式登入、完整瀏覽器 UI 或正式 D1 證明。
