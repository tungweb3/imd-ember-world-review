# OWNERSHIP_AND_HOMES：IMD 所有權查核與房屋權限

原始碼：`source/server/ownership.ts`、`source/server/auth.ts`、`source/server/presence.ts`、`source/migrations/0004_index_candidates.sql`、`source/migrations/0005_lanes_and_subnets.sql`、`source/src/world/{auth,moves,walletView,houseSize,homeEntry}.ts`、`source/src/world/{WalletPanel,HomePanels}.tsx`（本快照 `source/`，取自 `f4272c5`；其中進入 Worker 與前端建置的檔案與正式部署來源 `2e4e830` 相同）。房屋的分配與擺放程式（`households.ts`、`layout.ts`、`collision.ts`）與房屋內部的繪製（`src/world/interior/*`、`HomeDoor.tsx`）依持有人決定不公開，本檔只用文字說明其行為。

自上次送審版本（`ae1d41a`，Worker `1a0dd495`）以來，本檔涉及的程式有這些修改，全部來自 Swarm audit 8c3aea2e：伺服器端的 N-3（候選超過 256 個時，依「會不會計入房子」的同一條規則排序）與 N-6（`chain:index` 拒絕而且沒有席位計入時，請求所在網段的探索 lane；D1 migration `0005`），以及用戶端的 N-1（只套用最新一次的 session 讀取）與 N-7（面板分別說明到期、失效與登出）。這些修正的狀態是團隊自己的說法（`source/docs/security/AUDIT_REMEDIATION_STATUS.md` 的「Swarm audit 8c3aea2e」段落：N-1、N-3、N-7 為已修正，N-6 為部分處理），沒有經過重新審查，reviewer 應自行驗證。

## 0. 審查基準：一個錢包一間房

產品規則：**一個錢包一間房，房內可以有多個席位；房子大小跟著目前計入的席位數變。**（持有人決定。）審查規格中「一個錢包可以有多間房」這句**不採用**，這是產品規則，不是缺陷。請以「一錢包一房、多席位」檢查實作。與規格其他差異見 `SCOPE.md` 第 4 節。

## 1. 所有權從哪裡來

- 合約：以太坊主網 IMD 席位 NFT `SEAT_COLLECTION = 0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`（`src/world/market.ts:8`）。
- **唯一的證明是 `ownerOf`**：一次 `eth_call` 到 Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` 的 `aggregate3`，內含各候選席位的 `ownerOf(tokenId)` 與 `getBlockNumber`。第一個 chunk 用 `latest` 並取得區塊號，後續 chunk 固定在同一個區塊；每 chunk 200 個，最多 256 個候選（`server/ownership.ts:27,54-69`）。
- **候選**（不是證明）的來源如下（`server/ownership.ts:223-261`）。名冊、索引或保存的答案說某地址持有，都不會直接給權利；最後只保留 `ownerOf` 結果等於該地址的席位（`:259`）。
  1. IMD 公開名冊 `swarm.owners`（`:227`）；
  2. Alchemy `getNFTsForOwner`（最多 5 頁）（`:241-246`，`indexedNfts` 在 `:72-96`）；
  3. （A-2）索引讀取被預算拒絕或失敗時，上一次保存的索引答案：本 isolate 記憶體裡的，或 D1 `index_candidates` 裡的，兩者取較新者（`:247-253`）。它不論多舊都只是候選，照樣由 `ownerOf` 證明。
- **候選排序與上限（A-4；本版改，N-3）**：候選超過 256 個時，先排序再截斷：會計入房子的席位（已註冊的 agent，而且即時名冊顯示現在在線，或 24 小時內在此 owner 名下被記錄在線）、其他已註冊 agent 的席位、其餘，各依編號（`server/ownership.ts:142-148,234-238,256`）。上一版只看即時名冊的在線狀態，24 小時內的在線紀錄在截斷之後才讀，所以 256 個不會計入的已註冊席位可以把一個一小時前在線、會計入的席位擠掉（N-3）。本版只有在需要截斷時，才在排序前多讀一次 `seat_presence`（只查不在線的已註冊候選，主鍵查詢），D1 保存的答案與這次要證明的候選共用這次讀取；沒有資料庫或這次讀取失敗時，退回只用即時名冊排序（A-4 的規則）（`:228-236`）。有候選被截掉，或索引讀到第 5 頁還有下一頁，回應就是 `recheck:'partial'`，不會被當成完整答案（`:255,290-291`）。成本仍最多 256 個 `ownerOf`、兩次 `eth_call`。
- **每一次 NFT 索引讀取都先扣預算**：`CHAIN_LIMITER` 鍵 `chain:index`，每個 Cloudflare 據點 20 次／60 秒，丟例外或綁定不存在時都不讀（`server/auth.ts:271,617`、`server/ownership.ts:242`）。被拒時：候選只用 IMD 名冊加上先前保存的索引答案，照樣用 `ownerOf` 證明，回應多一個 `recheck:'limited'`；這樣證明出來的席位若沒有任何一個計入房子，才會再問下一項的網段 lane。所以 IMD 名冊上沒有、也沒有保存答案的地址（例如任何拋棄式金鑰），在 `chain:index` 被拒時最多只能經它所在網段的 lane 造成索引讀取（每個網段每分鐘 1 次、IPv6 /48 兩次，全站每分鐘最多 600 次），而且沒有候選可證明，所以不會有 `ownerOf` 讀取（`tests/ownership.test.mjs`「N-6: one lane per network a minute, even when claims race」）；lane 也被拒時，只多 D1 讀取（`READ_INDEX` 與 lane 的計數）。上一版的說法「不會觸發任何帶金鑰的鏈上讀取」在本版不再成立。
- **網段的探索 lane（本版新增，N-6）**：`chain:index` 拒絕了一次索引讀取，而且這次的答案沒有任何席位計入房子時（新買家、保存的答案只列出已賣掉或不計入的席位、或什麼都沒有），`home()` 會問發出這次 `/api/me/home` 請求的網段的 lane：先在 D1 `index_lanes` 計數（IPv4 /24 每分鐘 1 次；IPv6 /48 每分鐘 2 次、每個 /64 1 次；全站每 6 秒最多 60 次），通過才問 `CHAIN_LIMITER` 的新鍵 `chain:index:lane`（每個據點 20 次／60 秒，fail closed；沒有新增綁定）。兩者都允許時，用這一次索引讀取重建證明；答案照一般索引讀取保存到 `index_candidates`（所以這個屋主之後不必再走 lane），每個候選照樣由 `ownerOf` 證明，用戶端送來的任何東西都不是候選。lane 先於重建詢問，所以被拒的 lane 不會多一次 `ownerOf`；被拒時維持 `limited`（「沒能查核」，不是「沒有持有」）。索引讀取「失敗」（Alchemy 錯誤）而不是被拒時不走 lane；0005 套用之前、或 D1 失敗時沒有 lane（`server/ownership.ts:131-133,138-141,252,280-288`、`server/auth.ts:227-236,617-625`；表的結構、讀寫量與清理見 `DATA_SCHEMA.md`；限度見第 7 節第 9 項）。
- **保存索引答案（A-2）**：每一次成功的索引讀取（包括經 lane 的那一次），都在回應送出之後把答案（最多 256 個、依上面的順序）upsert 到 D1 `index_candidates`，較舊的答案不會覆蓋較新的；答案沒有列出任何席位時改為刪除那一列，所以拋棄式地址不會留下任何列（`server/ownership.ts:151-176,245`；表的結構、讀寫量與清理見 `DATA_SCHEMA.md`）。答案的時間是那次索引讀取**開始**的時間（`:134-137,243`）。
- RPC：Alchemy eth-mainnet，金鑰在 `Authorization` 標頭，逾時 10 秒（`server/ownership.ts:10-15,27,39-51`）。
- 登入方式（`EOA`／`ECDSA` 或 `CONTRACT`／`ERC1271`，記在 `sessions`）**不參與**所有權或屋主判斷；屋主判斷永遠是 `ownerOf`（F-2）。

## 2. 誰的所有權：只看伺服器 session

`GET /api/me/home` 的地址**只取自伺服器 session**（`server/auth.ts:611-625` → `readSession` → `s.address`）。用戶端唯一能傳的參數是 `fresh=1`，無法指定錢包、席位或「已連線」旗標；查詢字串、標頭或 body 裡的地址都不改變結果（`tests/ownership.test.mjs`「/api/me/home answers for the session’s wallet only…」）。N-6 的 lane 以這個請求的來源網段（由 `cf-connecting-ip` 推導，`worker/app.ts:74-85,117-119`）計數，沒有任何請求參數能指定它，也不改變查的是哪個地址。

回應：`{address, seats:[{tokenId, agentId, online, lastOnlineAt, counts, reason}], eligible, size, block, checkedAt, presence, recheck?}`；`recheck` 是 `'limited'` 或 `'partial'`，兩者都成立時回 `'limited'`（`server/ownership.ts:112-122,290-291`）。

一個席位**計入房子**（`counts`）的條件（`server/ownership.ts:142-145,270-274`）：

1. `ownerOf` 證明為 session 地址所持有；
2. 是 agent（IMD 名冊有 `agentId`）；
3. 目前在線，或 24 小時內在線。在線紀錄只看 `seat_presence` 中 `owner = 此地址` 的列（`server/ownership.ts:262-269`）。

本版（N-3）起，第 2、3 項只寫在一個函式 `counts` 裡（`server/ownership.ts:142-145`），席位狀態、上限排序（N-3）與探索 lane 的判斷（N-6）共用它，程式裡不再有第二份 24 小時規則。

`eligible` = 計入的席位數；`size = houseSize(eligible)`：1 → s、2–3 → ms、4–6 → m、7–9 → l、10 以上 → xl（`src/world/houseSize.ts:6`）。

## 3. 失敗與不完整時的行為

伺服器：

- 沒有金鑰、網路／HTTP 失敗、回應格式錯誤 → 丟 `OwnershipUnavailable`，路由回 503 `OWNERSHIP_UNAVAILABLE`；UI 明寫這「不是沒有持有」。失敗結果不快取（`server/ownership.ts:13-15,30,39-51`、`server/auth.ts:625-626`）。
- 索引讀取失敗（A-2）：若有保存的索引答案（本 isolate 或 D1），改用它當候選、照樣用 `ownerOf` 證明，回 200 加 `recheck:'limited'`；沒有保存的答案時仍是 503（`server/ownership.ts:247-253`）。失敗不是被拒，所以不走 N-6 的 lane。
- IMD 名冊沒有資料 → 同樣 503（`server/ownership.ts:208`）。
- 名冊空白不會被當成「已轉走」，也不會放行屋主權限：沒有候選就回空席位、`eligible=0`，不是屋主。
- 索引讀取被預算拒絕 → 不是錯誤：200 加 `recheck:'limited'`。本版起（N-6），若沒有任何席位計入，先試網段的 lane：lane 取得就照常讀索引（答案完整時不帶 `recheck`），lane 被拒仍是 `limited`（`server/ownership.ts:280-288`）。
- 候選超過 256 個，或索引停在頁數上限還有下一頁 → 200 加 `recheck:'partial'`（A-4；N-3 改了排序，見第 1 節）。
- 正式網址上缺少需要的 limiter 綁定 → 503 `LIMITER_UNAVAILABLE`（不會退回不限流；lane 的鍵在同一個 `CHAIN_LIMITER` 綁定內，`server/auth.ts:618-627`）。

用戶端：

- **「查核沒完成」不顯示為「沒有席位」（A-8）**：回應帶 `recheck` 而且沒有任何席位計入時，狀態是 `ownershipUnavailable`（「暫時無法確認持有資格，請稍後重試」），不是 `signedInNoHouse`（`src/world/auth.ts:57-73`，判斷在 `:69`）。面板說明「這次鏈上查核沒能完成（不是沒有持有），所以還沒有席位計入房子。登入仍有效，請稍後重試。」，空的席位清單下方說「尚未在鏈上核實到席位：這次查核沒能完成，請稍後重試。」；「鏈上核實：這個錢包目前沒有 IMD 席位。」只在查核完整時出現（`src/world/walletView.ts:34-43`）。有席位計入時仍是屋主，面板在席位下方用一行說明為什麼這次答案不完整（`recheckNote`，`src/world/walletView.ts:27-33`）。這些文字全部由 `walletView.ts` 的 `panelHome`／`houseNotes` 決定（`:44-55`），`WalletPanel.tsx` 只負責顯示（`src/world/WalletPanel.tsx:82,118,124,134`）。本版這個狀態仍會在 N-6 的 lane 被拒時出現（第 7 節第 9 項）。
- **較舊的回應被丟棄（A-3）**：`refreshHome` 只保留最新一次讀取。每一個 await 之後（回應本身、JSON body、錯誤 body）都比對 `gen` 與 `homeGen`，被較新的讀取或新流程（換帳號、登出、登出所有裝置）超越的回應直接丟掉（`src/world/auth.ts:207-232`，判斷在 `:215,218-219,222,231`）。所以一個 body 較晚到的舊答案，不會在賣出之後恢復屋主模式、Enter 或搬家，也不會蓋掉恢復後的新答案。
- **session 讀取也只套用最新一次（本版，N-1）**：每一次 `GET /api/auth/session` 都有編號，只有最新一次的回答、錯誤與 body 會被套用；套用「未登入」或換成另一個 session（或同一地址但期限不同的 session）時，也丟掉被取代 session 進行中的家讀取（`src/world/auth.ts:118-121,186-206`，特別是 `:189,196,204`）。所以較舊的 session 回答不會在之後恢復或清掉屋主模式；登入按鈕會等最新一次 session 讀取結束（`tests/wallet-client.test.mjs`「N-1: …」八項）。
- **session 到期在本機比對（W-1）**：session 的 `expiresAt` 不在本機時鐘之後時，`statusOf` 直接回 `expired`，`ownerAddress` 回 null（`src/world/auth.ts:65,74-75`）；用戶端在 `expiresAt` 設一個計時器，到時結束本機的 session 並丟掉進行中的家讀取（`:129-141`）；分頁重新可見時立即檢查到期，並（最多每 15 秒一次）重新讀取伺服器（`:142-147`）。
- 遇 401（session 被撤銷或過期，例如別的裝置按了「登出所有裝置」）立即登出並關閉屋主模式；遇 503 立即把家設為 `unavailable`（屋主模式關閉）；遇 429 等其他錯誤，保留上一次成功結果最多 3 分鐘（`OWNER_STALE_MS`），之後同樣關閉（`src/world/auth.ts:108,222-230`）。**本版（N-7）起面板分別說明原因**：`SESSION_EXPIRED`，或手上 session 的 `expiresAt` 已在本機時鐘上到期 →「登入已到期，請重新登入。」；其他 401（`AUTH_REQUIRED`：被撤銷或伺服器不認得）→「登入狀態已失效，請重新登入。」；本頁自己登出 →「已登出。」；沒有持有 session 時收到的 401 不改變任何狀態（N-1）（`src/world/auth.ts:223-227`、`src/world/walletView.ts:56-60`、`src/world/WalletPanel.tsx:104-105`）。屋主模式的關閉與以前相同，只有說明的原因不同。

## 4. 快取與轉手

| 快取 | 期限 | 位置 |
|---|---|---|
| 所有權證明（ownerOf 結果；包含 `limited`／`partial` 標記） | 30 秒；N-6 的 lane 取得時，被預算拒絕而建立的證明會重建一次（本版） | `OWNERSHIP_TTL_MS`（`server/ownership.ts:24`）；重建條件在 `:222-224,260` |
| 候選（NFT 索引） | 5 分鐘；`fresh=1` 時 30 秒。自 A-2 起重新載入失敗時保留上一個成功的值 | `CANDIDATES_TTL_MS`（`server/ownership.ts:24`）；快取在 `:185-201` |
| 保存的索引答案（跨 isolate，A-2） | 直到 cron 刪除（索引讀取時間超過 8 天）；只在索引被拒或失敗時讀 | D1 `index_candidates`（`server/ownership.ts:151-167`、`server/presence.ts:43-44`） |
| 每個 isolate 的 LRU 上限 | 512 個地址 | `CACHE_LIMIT`（`server/ownership.ts:27`） |

N-6 的 `index_lanes` 不是快取：它只記哪個網段在哪一分鐘取得了 lane，cron 刪除超過 1 分鐘的列（`server/presence.ts:45-50`）。

NFT 轉手時：

- **賣家**：session 不會被撤銷（session 是身分），但最多 30 秒後 `ownerOf` 重讀，該席位不再計入；若沒有其他計入的席位，`eligible=0`，不再是屋主，「進入我的家」也隨之關閉。用戶端在分頁可見時每 60 秒重查，另外在視窗取得焦點、打開「我的錢包」、分頁重新顯示時重查（`src/world/WalletPanel.tsx:36-46`、`src/world/auth.ts:142-147,339-348`）；較舊的家讀取（A-3）或 session 讀取（N-1）回應不會把屋主模式帶回來。
- **買家**：該席位最多 5 分鐘內出現在候選（按「重新確認」為 30 秒，`src/world/WalletPanel.tsx:93`），而且要等買家持有期間該席位上線過才會計入。`chain:index` 被拒時，IMD 名冊或保存的索引答案列出它，它就會出現；兩者都沒列出、而且買家沒有任何席位計入時，本版起請求所在網段的 lane 可以在每分鐘一次的範圍內讀索引而找到它（N-6）。買家已有其他計入的席位、或 lane 也被拒時，在兩者上一次列出之後才買的席位，要等之後的查詢（A-2、N-6 的殘留，第 7 節）。
- 沒有持續連線，所以權限更新靠上述輪詢與快取期限，沒有推播。

## 5. 房屋：地圖、「我家」、搬家與「進入我的家」

| 功能 | 實作 | 需要 |
|---|---|---|
| 地圖上的房子 | 用戶端從**公開 IMD 名冊**計算：每個錢包一間，大小依 agent 數；位置由用戶端的擺放規則決定。這些程式不公開（團隊端），但它們只決定畫面上的位置，**不參與任何登入或權限判斷**；編譯後的程式在公開的正式 bundle 裡 | 無（公開資料） |
| 「這個錢包的家」 | 顯示使用者查看的地址在名冊中的房子 | 無 |
| 「我家」標記 | 只在屋主模式：`ownerAddress(authState, now)` 非 null，即伺服器 `eligible > 0`、連線中的帳號（若有）就是 session 地址，而且 session 在本機時鐘上尚未到期（`src/world/auth.ts:57-75`）；標記在地圖上 `owner === session 地址` 的那間房子（`src/world/walletView.ts:64-70`） | 伺服器驗證的 session ＋ ownerOf |
| 回家 | 移動鏡頭到「我家」門前 | 同上 |
| 搬家 | `moveGate(state, home, now)` 必須為 `ok`（`src/world/moves.ts:42-51`），`commitMove` 在按下的那一刻再檢查一次（`src/world/moves.ts:62-67`）。結果只寫這個瀏覽器的 `localStorage['ember-world-moves-v1-<mode>']`（`src/world/moves.ts:12`），**不寫伺服器、不呼叫錢包、不簽章** | 同上 |
| 進入我的家 | 見下方說明。**不寫伺服器、不呼叫錢包、不發出新的 API 請求** | 同上（其中已包含 session 尚未到期） |
| 伺服器端房屋登記／其他玩家看到你的搬家 | **不存在** | — |

**「進入我的家」的閘門**（`src/world/homeEntry.ts`，公開；本版未改）：

- `enterGate(state, home, now)`（`homeEntry.ts:11-18`）依序檢查：有 session 但 `session.expiresAt` 不在 `now` 之後 → `expired`（`:12`）；不是屋主模式（`ownerAddress(state, now)` 為 null）→ `sign-in`；最近一次家的讀取不存在、是 `unavailable`、或不屬於 session 地址（例如另一個分頁換了 cookie）→ `sign-in`；地圖上沒有這間房子 → `no-house`；房子的 owner 不是 session 地址 → `not-yours`；全部通過才是 `ok`。地址比對不分大小寫。
- `enterableHome(state, homes, now)`（`:21-25`）：只回傳 session 地址自己的那一間、而且 `enterGate` 為 `ok`；其他所有情況（訪客、只連線未登入、沒有計入席位、所有權暫時無法確認或查核不完整、帳號不符、驗證中、等待簽名、過期、家的讀取屬於別的地址）都回 null。
- **按下的那一刻再檢查（W-1）**：`enterAtPress(state, offered, now)`（`:26-30`）在按下 Enter（E 鍵、門口提示、房屋區塊）時，用按下那一刻的時間再跑一次 `enterGate`，只有仍為 `ok` 才打開，跟搬家在按下時再檢查一樣。這是為了裝置休眠等情況下到期計時器晚觸發時，門不會開到下一次 10 秒時鐘才關。
- 頁面只在兩個地方提供「進入我的家」：房屋區塊（`blockEnter`，`homeEntry.ts:44`；按鈕在 `HomePanels.tsx:20`，只在呼叫端給了 `onEnter` 時出現）與站在自己家門口時的提示（`nearOwnDoor`、`doorOffer`，`homeEntry.ts:39-42`）。兩者都要求 `enterableHome` 不為 null，而且只針對那一間。被保留的 `WorldApp.tsx` 以 `enterableHome(authState, homes, Date.now())` 計算，在每次登入狀態改變與每 10 秒的時鐘重算，按下時再呼叫 `enterAtPress(authState, enterable, Date.now())`（團隊端；編譯後可在正式 bundle 搜尋 `` Enter your home `` 檢查）。
- 房屋內部（被保留的 `src/world/interior/*`，正式站上是延遲載入的 `assets/InteriorView-4LZmFcoq.js`）只用已經讀到的 `/api/me/home` 席位資料繪製，另外只載入同 origin 的靜態模型；它不呼叫錢包、不發出 API 請求、不寫 localStorage（`WALLET_METHODS.md` 第 3 節對 chunk 的計數）。
- 開發用預覽 `?interior=<size>&seats=<n>`：只在開發模式或 `?debug=1` 時開啟（`interiorPreview`，`:53-59`），任何人都可以在正式網址加上 `?debug=1` 打開它。它只用固定的假席位資料開一個**不綁定任何房子**的房間（未公開的 `WorldApp.tsx` 呼叫時傳 `home: null`；正式 bundle 中沒有 `preview:mock` 這個字串），沒有 Enter 按鈕、沒有屋主權利，**不給任何權利**。團隊端的 `tests/home-entry.test.mjs` 另用測試常數 `PREVIEW_OWNER = preview:mock`（在未公開的 `src/world/interior/mockSeats.ts`）確認：即使是真的屋主 session，對這種預覽房子的 Enter 判定也只會得到 `not-yours`。
- 這是**用戶端閘門**：它決定頁面要不要顯示並打開「進入」。背後的權限（誰是屋主）完全來自伺服器 session＋`ownerOf`；房屋內部沒有任何伺服器端狀態，所以就算有人改了自己瀏覽器裡的程式繞過閘門，也只能在自己的畫面上看到用自己 session 讀到的資料（或什麼都沒有）。
- 測試：`tests/home-entry.test.mjs` 的三項 `group 5` 測試與「W-1: an Enter press opens the offered house only while enterGate is still ok at that moment」在本快照（放入 `TESTS/stubs/` 的兩個替身後）可執行並通過（其中一項 `group 5` 用真實 sign-in 對真實 Worker，並在伺服器撤銷 session 後確認閘門關閉）；門口幾何、`TEST-1` 與 `group 8` 預覽三項需要被保留的程式（`TESTS/README.md` 第 1 節）。

屋主可以做的伺服器端寫入：**沒有**。屋主模式只影響自己瀏覽器的畫面。`index_candidates` 的寫入是伺服器在每次索引讀取後自己做的，內容只是候選；`index_lanes` 的寫入是伺服器為被拒的索引讀取記下網段與時間；兩者都不由用戶端指定內容，也不授予權利。

訪客與屋主的差別：

- 訪客（未連線、已連線但未登入、登入但沒有計入席位、查核不完整而沒有計入席位、session 已到期或已失效、session 與連線帳號不符）：可以瀏覽世界、查看任一錢包的公開席位與房子位置。
- 屋主（伺服器驗證、session 在本機時鐘上尚未到期）：多了「我家」標記、回家、本機搬家、進入自己的房子。

入住資格不以持有 Genesis／Pepe 或曾經 mint 為條件：`CHARACTER_COLLECTIONS` 是空的（`src/world/collections.ts:6`），而且與 `eligible` 的計算無關（`server/ownership.ts:278-292` 只看 `SEAT_COLLECTION` 的證明）。房屋內部的「Pepe 櫃」只顯示「Pepe Genesis 尚未鑄造」的文字。Mint 不在本次範圍內，另行審查。

## 6. #361／#921

規格指定的測試座位案例；在 World 裡只是「特色守印者」的展示位置，全部在被保留的前端檔案內，只影響畫面（`SCOPE.md` 第 5 節）。已公開的 `server/`、`worker/` 沒有任何程式以席位編號引用 361 或 921（唯一出現的是 `server/chain-mock.ts:4` 註解裡的本機測試用法範例；chain-mock 只在 loopback 網址作用），所以沒有登入、所有權或屋主權限上的特權。

## 7. 可能不一致之處（已知，供 reviewer 判斷）

1. **地圖大小與面板大小不同源**：地圖用公開名冊中所有已登記 agent 計算，不看在線狀態；伺服器 `eligible／size` 只計入持有、是 agent、且 24 小時內在線的席位。同一個錢包，地圖上的房子可能比「我的錢包」面板顯示的大。
2. **「我家」的位置來自公開名冊**，不是 `ownerOf`：`markedHome`／`enterableHome` 在用戶端依名冊算出的房子中找 `owner === session 地址` 的那一間。名冊落後時（例如剛賣出一個席位，但仍有其他計入的席位），屋主模式可能標到舊名冊計算出的房子並允許搬它或進入它。影響僅限自己瀏覽器的畫面與 localStorage。
3. **買家在名冊更新前沒有房子**：伺服器已驗證為屋主，但名冊還沒把這個錢包放上地圖時，面板會說明房子尚未出現（`moveGate`／`enterGate` 回 `no-house`）。
4. `/api/wallet/:address/assets` 對任何地址公開 `seat_presence` 衍生的 `lastOnlineAt`，`Cache-Control: public, max-age=300`。資料源本來就是公開名冊，屬低風險的彙整。
5. **ERC-1271 寬鬆合約**（F-2，仍存在）：一個對任何簽章都回 magic value 的合約若持有席位，任何人都能以它登入並取得屋主模式，包括「進入我的家」（目前只是自己畫面上的唯讀檢視）。
6. **保存的索引答案的限度**（A-2 的殘留，團隊的說法；本版 N-6 處理了其中「沒有席位計入」的情況）：屋主已有計入的席位時，在 IMD 名冊與索引上一次列出之後才買的席位，要等 `chain:index` 有空的下一次查詢才出現（這段期間面板顯示 `limited` 與較小的數量）；最後一次索引讀取超過 8 天的屋主，在索引被拒時只剩名冊（沒有席位計入時另有 lane）；另一個 isolate 要等 D1 寫入（在回應之後執行）落地後才看得到新的答案。
7. **超過上限的席位不列出**（A-4、N-3 的殘留，團隊的說法）：候選超過 256 個時，本版起先保留依計數規則會計入的席位，排在後面的席位不會被列出；可計入的席位超過 256 個時，排在後面的也不會計入（那時房子已是最大的 xl）；回應以 `partial` 標示。沒有資料庫或在線紀錄讀取失敗時，退回只用即時名冊排序（A-4 的規則）。
8. **遠端登出的延遲**（W-1 的殘留）：別的裝置按「登出所有裝置」，這個頁面要到下一次讀取伺服器才知道；隱藏中的分頁在重新顯示前維持原狀。本機到期則由本機時鐘判斷，依賴裝置時鐘大致正確；本機時鐘比伺服器慢時，在這段差距內到期的 session 可能顯示「登入狀態已失效」而不是「登入已到期」，兩者都要求重新登入（N-7 的殘留，團隊的說法）。
9. **探索 lane 的限度**（N-6 的殘留，團隊的說法，部分處理）：同一據點的 `chain:index` 被用完、又有 20 個其他網段（IPv6：10 個各用兩個 /64 的 /48）每分鐘都取走該據點的 `chain:index:lane` 時，被拒的讀取在那段期間仍維持 `limited`；與買家同一個 /24（或同一個 /64、或同一 /48 的另外兩個 /64）的人先取走該網段這一分鐘的 lane 時也一樣；全站每分鐘 600 次 lane 用完時，主鍵也被用完的據點都沒有 lane。lane 讓一個據點的索引讀取從每分鐘 20 次最多升到 40 次（只在有 20 個其他網段在那裡取 lane 時）。0005 套用之前沒有 lane。這些情況下面板說「查核沒能完成」，不會說「沒有席位」（A-8）。`tests/ownership.test.mjs`「N-6: twenty other networks can still keep a refused read out at one location, and it reopens the next minute (the residual at its stated cost)」重現這個成本：20 個其他網段時被擋，19 個時不會，下一分鐘恢復。

## 8. 測試

公開、可在本快照執行：`tests/ownership.test.mjs`（需替身；含「每一次索引讀取都扣 `chain:index`」「只從 session 取地址」「Worker 不載入 `layout.ts`／`households.ts`」，A-2 的三項「A-2: …」、「deployed before migrations/0004…」、A-4 的兩項「A-4: …」，以及本版的 N-3 四項「N-3: …」與 N-6 七項「N-6: …」，其中一項是「N-6 (deployed ahead of 0005)…」）、`tests/presence.test.mjs`（「0004 is additive…」「0005 is additive…」「A-2: the cron deletes index answers read more than 8 days ago…」「N-6: the cron deletes index-lane rows older than a minute…」）、`tests/wallet-client.test.mjs`（需替身；`moveGate`、`commitMove`、`markedHome`、屋主狀態，以及「W-1: …」「A-3: …」「A-8: …」「A-4: on the page…」，本版的「N-1: …」八項與「N-7: …」四項；A-8 那項以 `tests/fixtures/wallet-panel.mjs` 用 `react-dom/server` 實際繪製 `WalletPanel.tsx`，本版改成以 N-6 的殘留情境設定）、`tests/home-entry.test.mjs` 的 `group 5` 與「W-1: …」（需替身）。以上各項在加替身的 `npm test` 中全部通過（`TESTS/npm-test-output.txt`）；不加替身時 `ownership.test.mjs`、`home-entry.test.mjs`、`wallet-client.test.mjs` 因缺 `households.ts` 無法載入。房屋分配與擺放、房屋內部的測試隨程式一起保留，只在團隊端執行。全部是本機 mock／unit，鏈上讀取用 fixture 替身；見 `TESTS/README.md`。
