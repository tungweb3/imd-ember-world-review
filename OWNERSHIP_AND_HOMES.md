# OWNERSHIP_AND_HOMES：IMD 所有權查核與房屋權限

原始碼：`source/server/ownership.ts`、`source/server/auth.ts`、`source/server/presence.ts`、`source/src/world/{auth,moves,walletView,houseSize,WalletPanel,homeEntry,HomePanels}.ts(x)`（commit 2da46cd）。房屋的分配與擺放程式（`households.ts`、`layout.ts`、`collision.ts`）與房屋內部的繪製（`src/world/interior/*`、`HomeDoor.tsx`）依持有人決定不公開，本檔只用文字說明其行為。`server/ownership.ts` 與 `server/presence.ts` 自送審版本以來沒有改變。

## 0. 審查基準：一個錢包一間房

產品規則：**一個錢包一間房，房內可以有多個席位；房子大小跟著目前計入的席位數變。**（持有人決定。）審查規格中「一個錢包可以有多間房」這句**不採用**。請以「一錢包一房、多席位」檢查實作。與規格其他差異見 `SCOPE.md` 第 4 節。

## 1. 所有權從哪裡來

- 合約：以太坊主網 IMD 席位 NFT `SEAT_COLLECTION = 0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`（`src/world/market.ts:8`）。
- **唯一的證明是 `ownerOf`**：一次 `eth_call` 到 Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` 的 `aggregate3`，內含各候選席位的 `ownerOf(tokenId)` 與 `getBlockNumber`。第一個 chunk 用 `latest` 並取得區塊號，後續 chunk 固定在同一個區塊；每 chunk 200 個，最多 256 個候選（`server/ownership.ts:26,52-67`）。
- **候選**（不是證明）來自兩處：IMD 公開名冊 `swarm.owners`，以及 Alchemy `getNFTsForOwner`（最多 5 頁）（`ownership.ts:162-178`）。名冊或索引說某地址持有，不會直接給權利；最後只保留 `ownerOf` 結果等於該地址的席位（`ownership.ts:177`）。
- **每一次 NFT 索引讀取都先扣預算**：`CHAIN_LIMITER` 鍵 `chain:index`，每個 Cloudflare 據點 20 次／60 秒，丟例外或綁定不存在時都不讀（`server/auth.ts:465`、`ownership.ts:168-172`）。被拒時：候選只用 IMD 名冊加上先前存下的索引結果，照樣用 `ownerOf` 證明，回應多一個 `recheck:'limited'`。IMD 名冊上沒有、也沒有先前索引結果的地址（例如任何拋棄式金鑰）因此**不會觸發任何鏈上讀取**。
- RPC：Alchemy eth-mainnet，金鑰在 `Authorization` 標頭，逾時 10 秒（`ownership.ts:10-14,26,37-47`）。
- 登入方式（`EOA`／`ECDSA` 或 `CONTRACT`／`ERC1271`，記在 `sessions`）**不參與**所有權或屋主判斷；屋主判斷永遠是 `ownerOf`（F-2）。

## 2. 誰的所有權：只看伺服器 session

`GET /api/me/home` 的地址**只取自伺服器 session**（`server/auth.ts:459-466` → `readSession` → `s.address`）。用戶端唯一能傳的參數是 `fresh=1`，無法指定錢包、席位或「已連線」旗標；查詢字串、標頭或 body 裡的地址都不改變結果（`tests/ownership.test.mjs`「/api/me/home answers for the session’s wallet only…」）。

回應：`{address, seats:[{tokenId, agentId, online, lastOnlineAt, counts, reason}], eligible, size, block, checkedAt, presence, recheck?}`。

一個席位**計入房子**（`counts`）的條件（`ownership.ts:188-192`）：

1. `ownerOf` 證明為 session 地址所持有；
2. 是 agent（IMD 名冊有 `agentId`）；
3. 目前在線，或 24 小時內在線。在線紀錄只看 `seat_presence` 中 `owner = 此地址` 的列（`ownership.ts:180-186`）。

`eligible` = 計入的席位數；`size = houseSize(eligible)`：1 → s、2–3 → ms、4–6 → m、7–9 → l、10 以上 → xl（`src/world/houseSize.ts:6`）。

## 3. 失敗時的行為

- 沒有金鑰、網路／HTTP 失敗、回應格式錯誤 → 丟 `OwnershipUnavailable`，路由回 503 `OWNERSHIP_UNAVAILABLE`；UI 明寫這「不是沒有持有」。失敗結果不快取（`ownership.ts:13-14,29,37-47`）。
- IMD 名冊沒有資料 → 同樣 503（`ownership.ts:150`）。
- 名冊空白不會被當成「已轉走」，也不會放行屋主權限：沒有候選就回空席位、`eligible=0`，不是屋主。
- 索引讀取被預算拒絕 → 不是錯誤：200 加 `recheck:'limited'`，面板顯示一行說明（`src/world/WalletPanel.tsx:115`）。
- 正式網址上缺少需要的 limiter 綁定 → 503 `LIMITER_UNAVAILABLE`（不會退回不限流）。
- 用戶端遇 401（session 被撤銷或過期，例如別的裝置按了「登出所有裝置」）立即登出並關閉屋主模式；遇 503 立即把家設為 `unavailable`（屋主模式關閉）；遇 429 等其他錯誤，保留上一次成功結果最多 3 分鐘（`OWNER_STALE_MS`），之後同樣關閉（`src/world/auth.ts:87,165-168`）。

## 4. 快取與轉手

| 快取 | 期限 | 位置 |
|---|---|---|
| 所有權證明（ownerOf 結果；包含 `limited` 標記） | 30 秒 | `OWNERSHIP_TTL_MS`（`ownership.ts:23`） |
| 候選（NFT 索引） | 5 分鐘；`fresh=1` 時 30 秒 | `CANDIDATES_TTL_MS` |
| 每個 isolate 的 LRU 上限 | 512 個地址 | `CACHE_LIMIT`（`ownership.ts:26`） |

NFT 轉手時：

- **賣家**：session 不會被撤銷（session 是身分），但最多 30 秒後 `ownerOf` 重讀，該席位不再計入；若沒有其他計入的席位，`eligible=0`，不再是屋主，「進入我的家」也隨之關閉。用戶端在分頁可見時每 60 秒重查。
- **買家**：該席位最多 5 分鐘內出現在候選（按「重新檢查」為 30 秒），而且要等買家持有期間該席位上線過才會計入。
- 沒有持續連線，所以權限更新靠上述輪詢與快取期限，沒有推播。

## 5. 房屋：地圖、「我家」、搬家與「進入我的家」

| 功能 | 實作 | 需要 |
|---|---|---|
| 地圖上的房子 | 用戶端從**公開 IMD 名冊**計算：每個錢包一間，大小依 agent 數；位置由用戶端的擺放規則決定。這些程式不公開（團隊端），但它們只決定畫面上的位置，**不參與任何登入或權限判斷**；編譯後的程式在公開的正式 bundle 裡 | 無（公開資料） |
| 「這個錢包的家」 | 顯示使用者查看的地址在名冊中的房子 | 無 |
| 「我家」標記 | 只在屋主模式：`ownerAddress(authState)` 非 null，即伺服器 `eligible > 0` 且連線中的帳號（若有）就是 session 地址（`src/world/auth.ts:49-61`）；標記在地圖上 `owner === session 地址` 的那間房子（`walletView.ts:32-36`） | 伺服器驗證的 session ＋ ownerOf |
| 回家 | 移動鏡頭到「我家」門前 | 同上 |
| 搬家 | `moveGate` 必須為 `ok`（`moves.ts:46-51`），`commitMove` 再檢查一次（`moves.ts:64-66`）。結果只寫這個瀏覽器的 `localStorage['ember-world-moves-v1-<mode>']`，**不寫伺服器、不呼叫錢包、不簽章** | 同上 |
| **進入我的家**（本版新增） | 見下方說明。**不寫伺服器、不呼叫錢包、不發出新的 API 請求** | 同上，外加 session 尚未過期 |
| 伺服器端房屋登記／其他玩家看到你的搬家 | **不存在** | — |

**「進入我的家」的閘門**（`src/world/homeEntry.ts`，公開）：

- `enterGate(state, home, now)`（`homeEntry.ts:11-18`）只在下列條件**全部**成立時回 `ok`：屋主模式（`ownerAddress(state)` 非 null）；有 session 而且 `session.expiresAt > now`（否則 `expired`）；最近一次家的讀取結果存在、不是 `unavailable`、而且屬於 session 地址（否則 `sign-in`；例如另一個分頁換了 cookie）；地圖上有這間房子（否則 `no-house`）；房子的 owner 等於 session 地址（否則 `not-yours`）。地址比對不分大小寫。
- `enterableHome(state, homes, now)`（`:21-25`）：只回傳 session 地址自己的那一間、而且 `enterGate` 為 `ok`；其他所有情況（訪客、只連線未登入、沒有計入席位、所有權暫時無法確認、帳號不符、驗證中、等待簽名、過期、家的讀取屬於別的地址）都回 null。
- 頁面只在兩個地方提供「進入我的家」：房屋區塊（`blockEnter`，`:39`；按鈕在 `HomePanels.tsx:20`，只在呼叫端給了 `onEnter` 時出現）與站在自己家門口時的提示（`doorOffer`、`nearOwnDoor`，`:34-37`）。兩者都要求 `enterableHome` 不為 null，而且只針對那一間。被保留的 `WorldApp.tsx` 以 `enterableHome(authState, homes, Date.now())` 計算，並在每次登入狀態改變與每 10 秒的時鐘重算（團隊端；編譯後可在正式 bundle 搜尋 `` Enter your home `` 檢查）。
- 房屋內部（被保留的 `src/world/interior/*`，正式站上是延遲載入的 `assets/InteriorView-Xan3ABOQ.js`）只用已經讀到的 `/api/me/home` 席位資料繪製，另外只載入同 origin 的靜態模型；它不呼叫錢包、不發出 API 請求、不寫 localStorage（`WALLET_METHODS.md` 第 3 節對 chunk 的計數）。
- 開發用預覽 `?interior=<size>&seats=<n>`：只在開發模式或 `?debug=1` 時開啟（`interiorPreview`，`:48-54`），任何人都可以在正式網址加上 `?debug=1` 打開它。它只用固定的假席位資料開一個**不綁定任何房子**的房間（未公開的 `WorldApp.tsx` 呼叫時傳 `home: null`；正式 bundle 中沒有 `preview:mock` 這個字串），沒有 Enter 按鈕、沒有屋主權利，**不給任何權利**。團隊端的 `tests/home-entry.test.mjs` 另用測試常數 `PREVIEW_OWNER = preview:mock`（在未公開的 `src/world/interior/mockSeats.ts`）確認：即使是真的屋主 session，對這種預覽房子的 Enter 判定也只會得到 `not-yours`。
- 這是**用戶端閘門**：它決定頁面要不要顯示「進入」。背後的權限（誰是屋主）完全來自伺服器 session＋`ownerOf`；房屋內部沒有任何伺服器端狀態，所以就算有人改了自己瀏覽器裡的程式繞過閘門，也只能在自己的畫面上看到用自己 session 讀到的資料（或什麼都沒有）。
- 測試：`tests/home-entry.test.mjs` 的三項 `group 5` 測試在本快照可執行並通過（其中一項用真實 sign-in 對真實 Worker，並在伺服器撤銷 session 後確認閘門關閉）；門口幾何與預覽的三項需要被保留的程式（`TESTS/README.md` 第 1 節）。

屋主可以做的伺服器端寫入：**沒有**。屋主模式只影響自己瀏覽器的畫面。

訪客與屋主的差別：

- 訪客（未連線、已連線但未登入、登入但沒有計入席位、session 與連線帳號不符）：可以瀏覽世界、查看任一錢包的公開席位與房子位置。
- 屋主（伺服器驗證）：多了「我家」標記、回家、本機搬家、進入自己的房子。

入住資格不以持有 Genesis／Pepe 或曾經 mint 為條件：`CHARACTER_COLLECTIONS` 是空的，而且與 `eligible` 的計算無關（`ownership.ts:196-202` 只看 `SEAT_COLLECTION` 的證明）。房屋內部的「Pepe 櫃」只顯示「Pepe Genesis 尚未鑄造」的文字。

## 6. #361／#921

規格指定的測試座位案例；在 World 裡只是「特色守印者」的展示位置，全部在被保留的前端檔案內，只影響畫面（`SCOPE.md` 第 5 節）。已公開的 `server/`、`worker/` 沒有任何程式以席位編號引用 361 或 921，所以沒有登入、所有權或屋主權限上的特權。

## 7. 可能不一致之處（已知，供 reviewer 判斷）

1. **地圖大小與面板大小不同源**：地圖用公開名冊中所有已登記 agent 計算，不看在線狀態；伺服器 `eligible／size` 只計入持有、是 agent、且 24 小時內在線的席位。同一個錢包，地圖上的房子可能比「我的錢包」面板顯示的大。
2. **「我家」的位置來自公開名冊**，不是 `ownerOf`：`markedHome`／`enterableHome` 在用戶端依名冊算出的房子中找 `owner === session 地址` 的那一間。名冊落後時（例如剛賣出一個席位，但仍有其他計入的席位），屋主模式可能標到舊名冊計算出的房子並允許搬它或進入它。影響僅限自己瀏覽器的畫面與 localStorage。
3. **買家在名冊更新前沒有房子**：伺服器已驗證為屋主，但名冊還沒把這個錢包放上地圖時，面板會說明房子尚未出現（`moveGate`／`enterGate` 回 `no-house`）。
4. `/api/wallet/:address/assets` 對任何地址公開 `seat_presence` 衍生的 `lastOnlineAt`，`Cache-Control: public, max-age=300`。資料源本來就是公開名冊，屬低風險的彙整。
5. **ERC-1271 寬鬆合約**（F-2，仍存在）：一個對任何簽章都回 magic value 的合約若持有席位，任何人都能以它登入並取得屋主模式，包括「進入我的家」（目前只是自己畫面上的唯讀檢視）。

## 8. 測試

公開、可在本快照執行：`tests/ownership.test.mjs`（需替身；含「每一次索引讀取都扣 `chain:index`」「只從 session 取地址」「Worker 不載入 `layout.ts`／`households.ts`」）、`tests/presence.test.mjs`、`tests/wallet-client.test.mjs`（`moveGate`、`commitMove`、`markedHome`、屋主狀態）、`tests/home-entry.test.mjs` 的 `group 5`。房屋分配與擺放、房屋內部的測試隨程式一起保留，只在團隊端執行。全部是本機 mock／unit，鏈上讀取用 fixture 替身；見 `TESTS/README.md`。
