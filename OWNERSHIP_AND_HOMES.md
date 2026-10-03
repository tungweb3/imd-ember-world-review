> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# OWNERSHIP_AND_HOMES：席位證明、屋主資格、搬家與 Enter

## 1. 固定目標與權限來源

Worker `acdbb2bd-8add-4b15-bfa6-a31266c83520`；LIVE `ddb10e28a867998323164e7585635efedfcf7788`；source main `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`；D1 0001–0006。

本頁描述當前公開 source 與團隊證據。R3-R1、AUD3-01～08未外部複查；M1會員／玩家名稱未經Swarm審查。Genesis Mint、Coin E1／0007不在範圍；不是審查通過聲明。

**身份、持有與畫面分開：** session證明登入身份；mainnet ownerOf證明席位持有；agent活動決定是否計入房子；地圖／位置／名稱只是顯示。連錢包、輸入地址、名冊列名、M1名稱或localStorage都不能替代這些證明。

| 讀取 | 誰可以讀 | 可以證明什麼 |
| --- | --- | --- |
| GET /api/wallet/:address/assets | 任意地址，公開 | IMD名冊列出的席位／活動；**未作ownerOf證明** |
| GET /api/me/home | live session | 只查session地址；ownerOf證明後的席位與eligibility |
| GET /api/world/names/:address | 任意有效地址，公開 | 玩家自行設置的公開名稱／null；不授屋主權 |

Source：`source/server/auth.ts:668`、`source/server/auth.ts:683`、`source/server/auth.ts:707`、`source/server/ownership.ts:302`、`source/server/member.ts:122`。

## 2. Candidate discovery 不等於 ownership proof

入口 `Ownership.home`（`source/server/ownership.ts:280`）；session地址由路由決定，body／query不能換成另一個address。

1. 讀IMD swarm／workers，沒有swarm資料就失敗（`source/server/ownership.ts:207`）。
2. 候選為swarm.owners列出的token ids，加Alchemy NFT index發現的token ids（`source/server/ownership.ts:227`、`source/server/ownership.ts:245`）。
3. 每次新的NFT index讀取先扣chain:index；不存在／拒絕budget就不讀。最多5頁、每頁100，還有頁就標不完整（`source/server/ownership.ts:74`、`source/server/ownership.ts:243`）。
4. 候選超256，先保留按同一計數規則可能計入的席位，再其他registered agent，再其餘；以token id排序裁切。不把256個非計入者排在可計入者前（`source/server/ownership.ts:146`、`source/server/ownership.ts:235`）。
5. 對保留候選讀ownerOf，只有回傳地址等於session地址才留下（`source/server/ownership.ts:259`）。名冊／index本身不是證明。
6. Multicall3每chunk最多200；第一call讀latest及blockNumber，後續chunks固定同block。ownerOf單項revert視為null；整個RPC／decode失敗是不可用（`source/server/ownership.ts:54`）。
7. 回傳address、seats、eligible、size、block、checkedAt、presence及可能的recheck，不把client傳入值當owned seats（`source/server/ownership.ts:295`）。

IMD seat contract取自 `source/src/world/market.ts:8` 的SEAT_COLLECTION；mainnet `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`。Multicall3地址固定在 `source/server/ownership.ts:18`。本頁沒有新查鏈上code或部署狀態。

## 3. Eligibility、presence 與房屋大小

一席計入，須已由ownerOf證明持有、是registered IMD agent，且**現在live roster在線，或同一owner下24小時內有在線記錄**（`source/server/ownership.ts:146`）。

| 不計入原因 | 意義 | source |
| --- | --- | --- |
| not-agent | 沒有agentId | `source/server/ownership.ts:271` |
| not-seen | 現在不在線，該owner沒有保留在線紀錄 | `source/server/ownership.ts:273` |
| offline-24h | 記錄早於24小時窗口 | `source/server/ownership.ts:146` |

`seat_presence`以seat／owner查，舊owner的歷史不能計給buyer（`source/server/ownership.ts:265`）。目前live在線則可直接計入，不必一概等下次cron。

Cron每15分鐘記錄完整workers名冊中的online seats；不完整／失敗名冊不新增offline判定。UPSERT保留最新sighting與已知owner；seat_presence不清除（`source/server/presence.ts:22`、`source/server/presence.ts:56`、`source/worker/app.ts:148`）。紀錄時間用workers fetchedAt，資料自身也可能有cache年齡，不能當零延遲鏈上活動證明。

| eligible數量 | server size |
| --- | --- |
| 0 | null，非owner |
| 1 | s |
| 2–3 | ms |
| 4–6 | m |
| 7–9 | l |
| 10+ | xl |

規則在 `source/src/world/houseSize.ts:6`；home只用counts為true的數量（`source/server/ownership.ts:295`）。一錢包一間、大小依計入席位，是產品規則；M1名稱不提供額外屋主身份。

## 4. Budget fallback、lane 與不完整查核

Index budget被拒時，退回名冊加上此isolate／D1保存的最近index答案；取較新的保存值，再對每個候選讀ownerOf（`source/server/ownership.ts:248`）。保存答案只是候選；跨isolate以waitUntil寫入，可能尚未落地。

成功index答案依read開始時間保存，舊回應不能覆蓋新答案；空答案刪除記錄（`source/server/ownership.ts:165`、`source/server/ownership.ts:173`、`source/server/ownership.ts:244`）。讀失敗但有保存候選可回limited；失敗且無保存候選則503。

| 情況 | server／client語義 |
| --- | --- |
| RPC／index無可用fallback／無swarm | 503 OWNERSHIP_UNAVAILABLE；不是沒有席位 |
| budget拒絕、保存候選可驗 | 200 recheck:limited |
| 超candidate cap／index page cap | 200 recheck:partial；limited同時存在時優先limited |
| 無任何eligible且有recheck | ownershipUnavailable，不是signedInNoHouse |
| 完整查核且沒有eligible | signedInNoHouse |

Source：`source/server/ownership.ts:252`、`source/server/ownership.ts:297`、`source/src/world/auth.ts:68`、`source/src/world/walletView.ts:36`、`source/src/world/walletView.ts:41`。

N-6 lane只在**budget拒絕index且第一份答案沒有計入席位**時嘗試（`source/server/ownership.ts:292`）。先D1 claim、再chain:index:lane；IPv4 /24一份/min，IPv6 /48兩份、每/64一份，site-wide60/6秒。missing binding回503，D1 lane錯誤維持limited（`source/server/auth.ts:263`、`source/server/auth.ts:696`）。

AUD3-01：lane已讀出的index或後續ownerOf失敗，保留第一proof／sightings，回limited，不退已用lane（`source/server/ownership.ts:292`）。

AUD3-02：lane key拒絕／失敗時只釋放本次claim，network30秒後可重試；site-wide最多20 releases/6秒。超上限或釋放失敗則claim仍計入。**部分修正殘留**：同一location約80 claims/6秒仍可填滿site-wide ceiling（`source/server/auth.ts:278`、`source/server/auth.ts:702`）。「Cloudflare拒絕limiter不計次」未驗證；本機windowLimiter不證明正式窗口計法（`source/server/auth.ts:101`）。

N-6仍有availability殘留：同location的lane key可能由其他networks耗完；同network的人可先用該份；site-wide用盡也無lane。這不授錯誤ownership，但可能暫時找不到新買候選。

## 5. Cache、轉手與前端時序

| cache／poll | source與限制 |
| --- | --- |
| ownerOf proof | 30秒TTL；不是UI一定30秒內更新 |
| index候選 | 5分鐘；fresh=1時30秒；失敗保留上次成功值 |
| isolate LRU | 512地址 |
| D1 index答案 | cron刪read_at超8天者；仍只作候選 |
| lane row | 計數1分鐘；cron每15分鐘清超期row |
| home通常refresh | 最小間隔15秒；可見owner每60秒重讀 |
| 上次家讀取在部分非503錯誤下暫留 | 最多3分鐘；401／503不同處理 |

Source：`source/server/ownership.ts:24`、`source/server/ownership.ts:27`、`source/server/presence.ts:43`、`source/server/presence.ts:50`、`source/src/world/auth.ts:117`、`source/src/world/auth.ts:245`、`source/src/world/auth.ts:448`。

賣出席位不撤identity session；下一個有效ownerOf重查時該席位不再計入，最後一席失去eligible才關owner。快取／輪詢／隱藏分頁／網路錯誤都可能讓畫面延遲；不能保證30秒整站撤UI權限。

新買席位須先被名冊／index發現並ownerOf證明；live在線或該owner的24h紀錄才能計入。買家沒有eligible時可能用lane補探索；已有其他eligible者不走此lane，新席位可能等一般index可用。

Client舊home read不能蓋較新home／flow：每個await檢查gen／homeGen；session read也只採最新sessionReads（`source/src/world/auth.ts:223`、`source/src/world/auth.ts:245`）。

- Home401：清identity view／home，區分expired或revoked；503立即home unavailable，關owner（`source/src/world/auth.ts:261`）。
- Other refusal可能短暫留舊成功home，超OWNER_STALE_MS才unavailable（`source/src/world/auth.ts:265`）。
- AUD3-05：home回另一address立即丟house並重讀session；**部分修正**是舊session可暫時顯示，但不保留owner mode（`source/src/world/auth.ts:256`）。
- 本機到期timer與返回前景時重新查到期；依裝置時鐘。遠端撤銷要下一個server read才知道（`source/src/world/auth.ts:155`、`source/src/world/auth.ts:161`）。

## 6. 地圖、「我家」、搬家與 Enter

`ownerAddress`只在statusOf=owner時回session address：有eligible、session未到期、已連線account若存在須相符（`source/src/world/auth.ts:68`、`source/src/world/auth.ts:81`）。沒有連線account時可以由尚有效session延續identity。

地圖house位置／幾何／分配原始碼未公開。團隊描述地圖依公開名冊一wallet一house、大小依地圖agent數；這不等於server eligible數。公開`markedHome`選session owner的house，否則選正在查看的wallet（`source/src/world/walletView.ts:66`）。

| 功能 | 公開可核對的gate／效果 |
| --- | --- |
| 我家標記／回家 | ownerAddress＋地圖找到同owner的house |
| 搬家 | moveGate需owner、house存在且owner相同；commitMove在click時再驗 |
| 保存搬家 | 只有browser moves storage；不API、不錢包、不簽名；別人看不到 |
| Enter | enterGate驗到期、owner、home read address、house存在與owner相同 |
| Enter button／門口pill | enterableHome僅回自己的house；blockEnter／doorOffer也只針對它 |
| 真正按Enter | enterAtPress以當下now再跑gate，避免sleep timer延後 |
| Interior載入 | chunkLoader失敗可重試；公開gate沒有新wallet／API call |

Source：`source/src/world/moves.ts:46`、`source/src/world/moves.ts:64`、`source/src/world/moves.ts:69`、`source/src/world/homeEntry.ts:11`、`source/src/world/homeEntry.ts:21`、`source/src/world/homeEntry.ts:30`、`source/src/world/homeEntry.ts:42`、`source/src/world/homeEntry.ts:47`、`source/src/world/HomePanels.tsx:22`。

Moves的key是ember-world-moves-v1-live／mock；讀入時只保留cleanMove欄位，舊message／signature不信任也不保留（`source/src/world/moves.ts:12`、`source/src/world/moves.ts:17`、`source/src/world/moves.ts:37`）。目前沒有上線的共用home registry，UI自己說明搬家只在browser生效（`source/src/world/HomePanels.tsx:33`）。

Enter是client gate；依團隊描述，室內沒有server寫入狀態；改自己瀏覽器gate不等於取得他人的session／API資料。完整WorldApp呼叫整合與室內原始碼被withhold，不能單憑fixture聲稱完整畫面／室內都審過。

`interiorPreview`需DEV或debug=1，檢查size並限制seat數；是mock preview，不提供owner或Enter權（`source/src/world/homeEntry.ts:55`）。完整preview整合與幾何依賴withheld code，本包不重建。

## 7. M1：公開名稱不改屋主資格

M1 member是session地址的profile，不是額外NFT／席位。伺服器從readSession找identity，PUT比對expectedActorPublicId／version；沒有client指定owner或role（`source/server/member.ts:137`、`source/server/member.ts:157`、`source/server/member.ts:174`）。

- 房屋標題由useHouseName查owner的public name，地址仍顯示；Enter callback仍由原gate提供（`source/src/world/HomePanels.tsx:15`、`source/src/world/HomePanels.tsx:22`）。
- 名稱與地址關聯是已決定公開；names route回name或null，無會員／未取名同null。沒有名稱反查地址路由（`source/server/member.ts:122`）。
- lookup等400ms、cache1分鐘；換house／關面板取消callback（`source/src/world/member.ts:106`、`source/src/world/member.ts:118`、`source/src/world/member.ts:122`）。
- `imd.member.skip.<publicMemberId>`只折疊命名卡；不保留名稱、不賦owner（`source/src/world/member.ts:29`、`source/src/world/member.ts:73`）。
- GET profile可能hourly寫last_login_at；這和home權限不同，亦不Set-Cookie（`source/server/member.ts:39`、`source/server/member.ts:131`）。
- M1目前economy零值／life not_started是placeholder；不表示Coin E1已上線。

## 8. 待reviewer判定與證據限制

地圖與server大小可能不同；地圖owner名冊落後，現有owner可能標到舊位置；新buyer已eligible但地圖尚無house時gate回no-house。這些多屬顯示／localStorage差異，不能默認為跨walletserver寫入。

F-2寬鬆ERC1271合約仍可讓非key持有人以合約身份登入；NFT-index省略候選／256cap／pagecap／lane耗盡與同networkavailability殘留仍需按README／原finding判定。沒有Genesis／Pepe或玩家名稱作house entitlement：CHARACTER_COLLECTIONS目前空（`source/src/world/collections.ts:6`）。

本輪測試：`公開無 stubs：161 run／157 pass／4 fail；公開加 stubs：341／337／4（3 項 withheld UI／geometry、1 項 deploy-evidence 私有歷史依賴）；focused 90/90、N 43/43、M1 server/client 33/33、Enter group 5 3/3。完整私有 source archive：1009／1008／1，亦為歷史依賴；npm audit production／all 均 0。全套公開測試不是全通，完整 UI／tsc 受 withheld imports 限制`。指定handler、SQLite、ownerOf fixture、Enter gate可在文件stub環境測；room／layout幾何和完整UI不可只從公開包build。新測試log、缺檔／history失敗原因見`TESTS/README.md`；不用上輪數字。

本輪5GET全200、四靜態hash相符、24標頭相同、均無Set-Cookie；但deployment整體仍partial。沒有本版Owner真錢包驗證，沒有以此包核對正式D1／limiter拒絕計次／RPC供應商／WAF。匹配live檔、測試pass或第三次報告都不是本版外部複查通過。
