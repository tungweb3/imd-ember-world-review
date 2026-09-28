# OWNERSHIP_AND_HOMES：IMD 所有權查核與房屋權限

原始碼：`source/server/ownership.ts`、`source/server/auth.ts`、`source/server/presence.ts`、`source/src/world/{auth,moves,walletView,houseSize,WalletPanel}.ts(x)`（commit 0def8cb）。房屋的分配與擺放程式（`households.ts`、`layout.ts`、`collision.ts`）依持有人決定不公開，本檔第 5 節只用文字說明其行為。

## 0. 審查基準：一個錢包一間房

產品規則：**一個錢包一間房，房內可以有多個席位；房子大小跟著目前計入的席位數變。**（持有人決定。）審查規格中「一個錢包可以有多間房」這句**不採用**。請以「一錢包一房、多席位」檢查實作。與規格其他差異（主要住所、進屋、「我家」是前端標記）見 `SCOPE.md` 第 4 節。

## 1. 所有權從哪裡來

- 合約：以太坊主網 IMD 席位 NFT `SEAT_COLLECTION = 0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`（`src/world/market.ts:8`）。
- **唯一的證明是 `ownerOf`**：一次 `eth_call` 到 Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` 的 `aggregate3`，內含各候選席位的 `ownerOf(tokenId)` 與 `getBlockNumber`。第一個 chunk 用 `latest` 並取得區塊號，後續 chunk 固定在同一個區塊；每 chunk 200 個，最多 256 個候選（`server/ownership.ts:26,52-67`）。
- **候選**（不是證明）來自兩處：IMD 公開名冊 `swarm.owners`，以及 Alchemy `getNFTsForOwner`（最多 5 頁）（`ownership.ts:162-178`）。名冊或索引說某地址持有，不會直接給權利；最後只保留 `ownerOf` 結果等於該地址的席位（`ownership.ts:177`）。
- **每一次 NFT 索引讀取都先扣預算**（0def8cb 起）：`CHAIN_LIMITER` 鍵 `chain:index`，每個 Cloudflare 據點 20 次／60 秒，丟例外或綁定不存在時都不讀（`server/auth.ts:293`、`ownership.ts:168-172`）。被拒時：候選只用 IMD 名冊加上先前存下的索引結果（如果有），照樣用 `ownerOf` 證明，回應多一個 `recheck:'limited'`；這個「被限制」的結果本身不會被當成新的索引結果存起來。IMD 名冊上沒有、也沒有先前索引結果的地址（例如任何拋棄式金鑰）因此**不會觸發任何鏈上讀取**。
- RPC：Alchemy eth-mainnet，金鑰在 `Authorization` 標頭，逾時 10 秒（`ownership.ts:10-14,26,37-47`）。

## 2. 誰的所有權：只看伺服器 session

`GET /api/me/home` 的地址**只取自伺服器 session**（`server/auth.ts:290-294` → `readSession` → `s.address`）。用戶端唯一能傳的參數是 `fresh=1`（要求 30 秒內重新詢問 NFT 索引，仍受 `chain:index` 預算限制），無法指定錢包、席位或「已連線」旗標。

回應：`{address, seats:[{tokenId, agentId, online, lastOnlineAt, counts, reason}], eligible, size, block, checkedAt, presence, recheck?}`。

一個席位**計入房子**（`counts`）的條件（`ownership.ts:188-192`）：

1. `ownerOf` 證明為 session 地址所持有；
2. 是 agent（IMD 名冊有 `agentId`）；
3. 目前在線，或 24 小時內在線。在線紀錄只看 `seat_presence` 中 `owner = 此地址` 的列，前一任持有者時期的在線紀錄不算（`ownership.ts:180-186`）。

`eligible` = 計入的席位數；`size = houseSize(eligible)`：1 → s、2–3 → ms、4–6 → m、7–9 → l、10 以上 → xl（`src/world/houseSize.ts:6`）。

## 3. 失敗時的行為

- 沒有金鑰、網路／HTTP 失敗、回應格式錯誤 → 丟 `OwnershipUnavailable`，路由回 503 `OWNERSHIP_UNAVAILABLE`；UI 明寫這「不是沒有持有」。失敗結果不快取（`ownership.ts:13-14,29,37-47`）。
- IMD 名冊沒有資料 → 同樣 503（`ownership.ts:150`）。
- 名冊空白不會被當成「已轉走」，也不會放行屋主權限：沒有候選就回空席位、`block:null`，`eligible=0`，不是屋主。
- 索引讀取被預算拒絕 → 不是錯誤：200 加 `recheck:'limited'`，面板顯示一行說明（`src/world/WalletPanel.tsx:110`）。名冊上的席位照常驗證，剛買入、名冊還沒列出的席位要等之後的查詢才會出現。
- 正式網址上缺少需要的 limiter 綁定 → 503 `LIMITER_UNAVAILABLE`（不會退回不限流）。
- 用戶端遇 503 立即把家設為 `unavailable`（屋主模式關閉）；遇 429 等其他錯誤，保留上一次成功結果最多 3 分鐘（`OWNER_STALE_MS`），之後同樣關閉（`src/world/auth.ts:81,160-161`）。

## 4. 快取與轉手

| 快取 | 期限 | 位置 |
|---|---|---|
| 所有權證明（ownerOf 結果；包含 `limited` 標記） | 30 秒 | `OWNERSHIP_TTL_MS`（`ownership.ts:23`） |
| 候選（NFT 索引） | 5 分鐘；`fresh=1` 時 30 秒 | `CANDIDATES_TTL_MS` |
| 每個 isolate 的 LRU 上限 | 512 個地址 | `CACHE_LIMIT`（`ownership.ts:26`） |

NFT 轉手時：

- **賣家**：session 不會被撤銷（session 是身分），但最多 30 秒後 `ownerOf` 重讀，該席位不再計入；若沒有其他計入的席位，`eligible=0`，不再是屋主。用戶端在分頁可見時每 60 秒重查。這一條不需要 NFT 索引，所以不受 `chain:index` 預算影響。
- **買家**：該席位最多 5 分鐘內出現在候選（名冊已更新則立即；按「重新檢查」為 30 秒），而且要等買家持有期間該席位上線過（有 `owner = 買家` 的在線紀錄）才會計入。同一據點的 `chain:index` 預算用完時，只有名冊已列出的席位會出現（`recheck:'limited'`）。
- 沒有持續連線，所以權限更新靠上述輪詢與快取期限，沒有推播。

## 5. 房屋：地圖、「我家」與搬家

| 功能 | 實作 | 需要 |
|---|---|---|
| 地圖上的房子 | 用戶端從**公開 IMD 名冊**計算：每個錢包一間，含其所有已登記的 agent，大小依 agent 數；位置由用戶端的擺放規則決定（正式資料模式另有一份固定的起始配置）。這些程式不公開（團隊端），但它們只決定畫面上的位置，**不參與任何登入或權限判斷**；編譯後的程式在公開的正式 bundle 裡 | 無（公開資料） |
| 「這個錢包的家」 | 顯示使用者查看的地址在名冊中的房子 | 無 |
| 「我家」標記 | 只在屋主模式：`ownerAddress(authState)` 非 null，即伺服器 `eligible > 0` 且連線中的帳號（若有）就是 session 地址（`src/world/auth.ts:45-57`）；標記在地圖上 `owner === session 地址` 的那間房子（`walletView.ts:31-35`） | 伺服器驗證的 session ＋ ownerOf |
| 回家 | 移動鏡頭到「我家」 | 同上 |
| 搬家 | `moveGate` 必須為 `ok`（屋主模式且房子屬於 session 地址，`moves.ts:46-51`），`commitMove` 再檢查一次（`moves.ts:64-66`）。結果只寫這個瀏覽器的 `localStorage['ember-world-moves-v1-<mode>']`，**不寫伺服器、不呼叫錢包、不簽章**。舊版存下的 `message`／`signature` 欄位讀取時會被剝除並重寫（`moves.ts:15-41`） | 同上 |
| 進入房屋內部 | **不存在** | — |
| 伺服器端房屋登記／其他玩家看到你的搬家 | **不存在** | — |

屋主可以做的伺服器端寫入：**沒有**。屋主模式只影響自己瀏覽器的畫面。

訪客與屋主的差別：

- 訪客（未連線、已連線但未登入、登入但沒有計入席位、session 與連線帳號不符）：可以瀏覽世界、查看任一錢包的公開席位與房子位置。
- 屋主（伺服器驗證）：多了「我家」標記、回家、本機搬家。

入住資格不以持有 Genesis／Pepe 或曾經 mint 為條件：`CHARACTER_COLLECTIONS` 是空的，而且與 `eligible` 的計算無關（`ownership.ts:196-202` 只看 `SEAT_COLLECTION` 的證明）。

## 6. #361／#921

規格指定的測試座位案例；在 World 裡只是「特色守印者」的展示位置（固定展示座標、地圖 beacon、場景標籤與一行 UI 文字），全部在被保留的前端檔案內，只影響畫面。完整位置清單見 `SCOPE.md` 第 5 節（團隊端）。已公開的 `server/`、`worker/` 沒有任何程式以席位編號引用 361 或 921，所以沒有登入、所有權或屋主權限上的特權。

## 7. 可能不一致之處（已知，供 reviewer 判斷）

1. **地圖大小與面板大小不同源**：地圖用公開名冊中所有已登記 agent 計算，不看在線狀態；伺服器 `eligible／size` 只計入持有、是 agent、且 24 小時內在線的席位。同一個錢包，地圖上的房子可能比「我的錢包」面板顯示的大。
2. **「我家」的位置來自公開名冊**，不是 `ownerOf`：`markedHome` 在用戶端依名冊算出的房子中找 `owner === session 地址` 的那一間（`walletView.ts:31-35`）。名冊落後時（例如剛賣出一個席位，但仍有其他計入的席位），屋主模式可能標到舊名冊計算出的房子並允許搬它。影響僅限自己瀏覽器的 localStorage 與畫面。
3. **買家在名冊更新前沒有房子**：伺服器已驗證為屋主，但名冊還沒把這個錢包放上地圖時，面板會說明房子尚未出現（`moveGate` 回 `no-house`）。`chain:index` 預算用完時，名冊外的新席位也暫時不會被驗證（`recheck:'limited'`）。
4. `/api/wallet/:address/assets` 對任何地址公開 `seat_presence` 衍生的 `lastOnlineAt`，`Cache-Control: public, max-age=300`。資料源本來就是公開名冊，屬低風險的彙整。

## 8. 測試

公開、可在本快照執行：`tests/ownership.test.mjs`（需 `TESTS/stubs/households.ts` 替身；含「每一次索引讀取都扣 `chain:index`」「被拒時用名冊與既有結果並標 `limited`」「缺少綁定回 503」）、`tests/presence.test.mjs`（含 10 分鐘清理）、`tests/wallet-client.test.mjs`（`moveGate`、`commitMove`、`markedHome`、屋主狀態、預算忙碌的提示）。房屋分配與擺放的 `tests/households.test.mjs` 隨擺放程式一起保留，只在團隊端執行。全部是本機 mock／unit，鏈上讀取用 fixture 替身；見 `TESTS/README.md`。
