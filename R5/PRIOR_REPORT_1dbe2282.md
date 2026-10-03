# IMD Ember World：R3／AUD3 重測與 M1 首次有限審查

日期：2026-10-03（UTC）。本紀錄只評估指定 World 快照；不是網站認證、背書或零漏洞宣告。Completed／accepted 只代表交付完成。

## 對使用者問題的回答

**本次證據不足以對整個正式站作出「可以放心連接、登入及使用」的肯定判定。** 可支持的較窄結論是：指定程式與取得的兩個 live JS 中，錢包呼叫僅見帳號讀取、連線與 SIWE `personal_sign`；本機未重現無有效 EOA 簽章登入、復活已撤銷的伺服器 session、由其他地址撤銷某地址所有 session，或僅憑偽造候選／玩家名稱獲得他人屋主權。舊 R3-R1 的錯帳號連線回應重現已被阻止，原 N-2 控制組也不提示、不 verify。

My home 仍取決於 session、mainnet IMD `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d` 的 ownerOf 及席位活動資格；move 是本機位置保存，Enter 是客戶端閘門，均未發現新增資產交易授權。但共享限流可造成登入／探索不可用；撤銷、換分頁及鏈上轉手存在更新窗口。完整 WorldApp、房屋配置／室內原始碼與真實錢包流程不可驗證，故不能把局部閘門測試擴大為完整 UI 通過。

**公開玩家名稱改變了隱私與 session 的實際能力。** 名稱可被任何人以錢包地址查得；名稱不是真實身分、官方身分或房屋權利證明。M1 讓既有 session 能建立會員、持久改名，故既有 phishing relay、寬鬆 ERC-1271、同源頁面共用 cookie 的後果不再僅是讀取房屋畫面。M1 有兩項新本機發現：並發時每會員五次紀錄上限不是原子限制（M1-R1，Low，合成 D1 時序），以及舊 profile 讀取可覆蓋剛保存的前端顯示（M1-R2，Info）。未證明他人可無 session 改名，未證明正式 D1 已出現上述並發。

## 來源、版本與證據層級

- **[實測]** 本輪親自執行的本機測試或指定 live GET；**[碼讀]** 固定快照程式；**[推論]** 由前兩者推導的影響；**[團隊]** 尚未獨立確認的部署／歷史敘述；**[未知]** 本輪沒有證據。下文 fixed 僅限原發現及列明情境。
- [指定快照](https://github.com/tungweb3/imd-ember-world-review/tree/6e307dea76e763936fc4ac86e54c9f5d558f58c4)：`6e307dea76e763936fc4ac86e54c9f5d558f58c4`。以 GitHub commit API 查得 parent **`8cad017fad58bac89d88fa72d530d3c56160009b`**，符合要求；取 commit archive，不追 moving branch。摘要保存於 [pin.json](evidence/pin.json)。包內 SHA256SUMS 的131項本輪全部相符；這只證明所供manifest自洽，不獨立證明私人source provenance（[結果](evidence/snapshot-integrity.txt)）。
- [團隊] source 基準 `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`，部署來源 `ddb10e28a867998323164e7585635efedfcf7788`，Worker `acdbb2bd-8add-4b15-bfa6-a31266c83520`；兩來源僅狀態文件及新增 evidence 頁不同、無建置輸入變更。本輪未取得私人歷史逐一驗證這個差異聲明。
- 前輪原文：[Report dcf922ca](https://github.com/Identity-md/research/blob/main/jobs/dcf922ca-68de-4cc5-bfbc-8b226008b0bf/files/artifacts/report.md)、[Audit 1ef8e8a6](https://github.com/Identity-md/research/blob/main/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82/files/AUDIT.md)。已下載閱讀；修補狀態另讀目標 [AUDIT_REMEDIATION_STATUS.md](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/docs/security/AUDIT_REMEDIATION_STATUS.md)。沒有將團隊的 Fixed 當作外部結論。
- 已閱讀 root README、SCOPE、ROUTES、SIWE、DATA_SCHEMA、OWNERSHIP_AND_HOMES、DEPLOYMENT_MATCH、WALLET_METHODS、DEPENDENCIES、TESTS/README 及 source 的 MINT_BOUNDARY。文件視為待查資料，不作執行指令。
- 下文 `source/...:行` 均指上述固定快照，並以關鍵程式永久連結輔助定位。公開 92 source／保留 512 個檔案是包內清單的描述；保留部分僅取指紋，不聲稱碼讀。

## R3-R1／AUD3 逐項裁決

本機 [focused.log](evidence/focused.log) 為 90／90；其中包含團隊提供的回歸案例，執行是本輪獨立重跑，測試設計本身仍來自團隊。追加 probe 另列，沒有把案例數相加當覆蓋率。

| 原 ID／原等級 | 團隊聲稱 | 本輪 verdict、可歸因證據及殘餘 |
|---|---|---|
| R3-R1／Low | fixed，未重審 | **fixed（原重現）**。[AuthClient:307](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/src/world/auth.ts#L307)、`:312,331,340,396`：帳號事件序號及 provider／account／generation 護欄。重跑舊 report probe，調整斷言為修正後預期：prompts=0、verify=0、accountRevertedToA=false、sessionForA=false、status=connected；B 保留。獨立 N-2 delayed challenge body 控制組亦 0／0。[輸出](evidence/reviewer-probe.log)。沒有 accountsChanged 的陳舊帳號／同帳號往返仍不可辨識；合成 provider 順序不是真錢包證據。 |
| AUD3-01／Low | fixed | **fixed（原 lane failure）**。[ownership.ts:280](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/server/ownership.ts#L280)，`:292–297`：lane 重建的 OwnershipUnavailable 保留第一份 proof＋sightings，回 200 limited；502、timeout、malformed、第二次 ownerOf 失敗測試通過。第一份 proof 不可得仍 503，非 OwnershipUnavailable 的 D1 錯誤不被吞。已送出讀取仍花費，不退款。 |
| AUD3-02／Low | partly | **partly**。[auth.ts:263](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/server/auth.ts#L263)、`:278,694–705`：只 release 自己 claim，30s 重試、全站 20 releases／6s，release 失敗保留計數。本輪 60 網段原例通過；追加 80 claims 同 location／同 6s：20 reads、20 released、60 counted；另一 location 的 buyer `seats=[]、limited`，lane key 未詢問。[80-case](evidence/lane-80-case.txt)、[結果](evidence/lane-80.log)。既存 100-claim cap／並發／release fail guard 均通過。拒絕 limiter 呼叫若計次，10 個 /24 反覆重問可維持 3 分鐘阻擋，9 個不足（合成模型），正式計法未知。 |
| AUD3-03／Low | fixed | **fixed（未送 eth_call 的 claim 回收）；availability residual as stated**。[auth.ts:297](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/server/auth.ts#L297)、`:449,549–570`：僅清 called_at／called_via，checked_at 保留，正常拒絕後 burn；已送出的 eth_call 即使 503 也計次，不藉 release 多買一次 call 或復活 nonce。pool／lane、missing binding、release 失敗、0004 fallback、並發隔離測試均通過。若拒絕也計次，7 個 /24 先塞滿主 key，再 6 個 /24 各每6s一次 garbage verify 可擋首次 smart-wallet 3分鐘，5 個不足；固定窗口模型無此持續效果。這兩種模型的通過不確認 Cloudflare 採哪一種。 |
| AUD3-04／Info | fixed | **fixed（已確認 logout 後舊 read 復顯）**。[client auth.ts:365](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/src/world/auth.ts#L365)、`:411,426`：confirmed logout 作廢舊 session／home read；較新 generation 只清它確實結束的 session。AUD3-04＋ADV-1／2 測試覆蓋晚到 body、失敗 read、換 provider、另一分頁通知。logout 確認前與 abandoned verify 到達後而 revoke 未完成前仍有顯示／有效 session 窗口；失敗不能冒稱已登出。 |
| AUD3-05／Info | partly | **partly**。[client auth.ts:256](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/src/world/auth.ts#L256)：home 回 B、頁面原 A 時立即 home=unavailable、checking=false，再讀 session。429、503、網路失敗仍保留 A 的登入顯示，但非 owner；成功 read 才顯示 cookie 的 B（若 wallet A 則 mismatch）。回歸三種失敗及恢復通過，不能稱舊 session 顯示已全部移除。 |
| AUD3-06／Info | fixed | **fixed（非明確 logout 回應清 cookie）；明確跨分頁 logout residual as stated**。[server auth.ts:596](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/server/auth.ts#L596)、`:620,684`：dead session／home 401／拒絕 logout-all 無 Set-Cookie。原 late-clear 案例通過。明確 logout 仍清同名 cookie；跨 tab 新登入後舊 logout 回應可刪新 cookie，新 session 在 DB 仍 live 到期，該 guard 確認此殘餘。本頁待決 logout 用 LOGOUT_WAIT_MS=5000，超時結束且零 prompt；不等於 session read 也有五秒 timeout。 |
| AUD3-07／Info | fixed | **fixed（server 明示 expiry 的文案及重讀）**。`source/src/world/auth.ts:375–388,436`：區分 expired／stale；401 後讀 session，失敗保留「未登出其他裝置」提示；較新流程已開始仍重讀 refused logout-all，而不對新流程宣告 signed-out。AUD3-07＋ADV-1 後續案例均通過。瀏覽器先丟過期 cookie，只收到 AUTH_REQUIRED 時仍無法辨識原到期原因。 |
| AUD3-08／Info | fixed | **fixed（parser hardening）**。[worker/app.ts:29](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/worker/app.ts#L29)、`:90–103`：完整 IPv4／IPv6 解析，mapped hex／dotted 歸 IPv4，其餘 dotted tail 保留 IPv6；錯誤文字同 unknown，不逐字串開新份額。worker＋auth 測試通過，`::1`→ip:unknown 保留。尚無真正式請求能製造原畸形 header 的證據；不是已證明的外部 WAF bypass。 |

**AUD3-09／Info：review-limit record，沒有缺陷修復 verdict。** 仍未知正式 Worker 身分／secrets／bindings、D1 原子性與 migrations、Alchemy、limiter accounting、WAF、真 wallet／browser、保留 UI、私人歷史、Mint。此次取得 live 檔案及 Worker 重建縮小了前輪缺口，沒有關閉其他限制。舊 T41「nothing deployed」只是歷史狀態，不拿來否定本版 M1 部署聲稱。

後續順序案例另核對：`auth.ts:349` abandoned verify **headers 到達**即發 logout，body 卡住不延後 revoke；body 在較新 session 之後才到不清新 session；`auth.ts:375` refused logout-all 在換帳號／較新 flow 後仍 restore。ADV 測試涵蓋 body／logout 兩種到達順序、wrong account、lost logout、等待時 429／503、頁面 teardown。本次沒有真 cookie jar 的跨瀏覽器實測，fixture 的 Set-Cookie 模型仍有限。

## M1 FIRST REVIEW

入口 [server/member.ts:81](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/server/member.ts#L81)，migration [0006_members.sql](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/migrations/0006_members.sql)。本輪 **33／33** M1 server/client 回歸通過；這是本次首次檢查，不沿用任何前輪通過狀態。

| 檢查 | 觀察與界線 |
|---|---|
| Session-only identity | `member.ts:29,137–140,173–175` 由 readSession 的地址找 eip155:1 identity；body 不可指定 wallet／role／member id。PUT 只接受四個欄位，actor 必須等於 session 的 publicMemberId；錯 actor=409，過期／偽造／無 cookie=401。僅連接錢包沒有會員權限。 |
| 寫入檢查順序 | method 判別後先 DB **binding 有無**，再 Origin、member limiter；PUT 再有界 JSON body（2048 bytes）、欄位形狀、session、actor、名稱等。`member.ts:101–119,168–192`。注意 DB 有 binding 不表示資料庫健康或 0006 存在；缺表由後續 SQL 拋錯成503。Bootstrap `:137` 只驗 JSON Content-Type，不解析／使用 body；不能稱它具有與 PUT 相同的 body 長度檢查。 |
| Limiter | `worker/app.ts:109–120`，AUTH_LIMITER 的 `member:`＋IP key，20/min/location（IPv6 使用 /64）。錯 Origin 不花 member key；無 session 的同源寫入仍花。binding throws→429（closed）；production 缺 binding→503；loopback 例外不代表正式放行。GET 使用 api，throws fail-open，缺 binding 仍503。 |
| GET profile 的寫入 | `member.ts:103–111,131–133` 有 session 才讀會員，未建立404；最多每小時更新 last_login_at，update 條件避免重複生效。自寫 probe 模擬 API limiter 拋錯仍200且時間增加3,600,001ms，緊接再 GET 不更新；touch 寫入失敗仍200。故「所有 GET 不寫資料」不成立。GET 無 Origin 防護及可能附 Lax cookie 是 Info 邊界；不是無 session 可改名。 |
| 早期 PUT 成本 | probe 12 個非法名稱=400、錯 actor=409，profile_requests=0，但13次 member limiter 呼叫；body／session／actor／格式、idempotency conflict 及同名 no-op 等都未必列入5/member/min。文件的「到DB的writes」應明確區別 DB讀取與已記錄嘗試。這不是完全免費／不限流，也不是逐 PUT 五次上限。 |
| Bootstrap race | 一批建立 member、identity、profile、economy、life；identity UNIQUE、member_id UNIQUE，競爭失敗讀回 winner。兩份 bootstrap、強制 stale read 回歸通過；不會由 body 建別人會員。SQLite adapter 明確 BEGIN／ROLLBACK 的模型不驗證正式 D1。 |
| Name write race | `member.ts:202–237` batch 以 expected version guard 的成功 request row CHECK、nickname_claims PK、active_name_key UNIQUE 防止雙名／覆蓋；改版或鎖定 rollback。M1 回歸覆蓋不同會員搶名、stale version、moderation、帳號切換。每會員**速率**的 count 不在該原子 guard 內，見 M1-R1。 |
| Idempotency／冷卻 | member＋requestId 複合鍵；同 payload（正規化顯示名＋version）回原 outcome，成功時回目前 profile；不同 payload=409。7天改名冷卻、舊名保留30天；同名 no-op不再次加冷卻。重試不等於免費 HTTP：IP key 仍扣。request紀錄1天、history180天由後續成功寫入清理，非準時刪除；沒有後續寫入可留更久。 |
| 名稱限制／冒充 | NFKC、ASCII小寫唯一 key、2–20 grapheme、byte limits，拒絕 controls／bidi／HTML／URL字符；保留名稱 skeleton 擋若干官方變體。不是一般人名的同形字／冒充保證，使用者自取名不等於授權標章。React面板用文字顯示；SQL bind參數。本輪未重現名稱 XSS、SQL注入或名稱授予 house rights。 |
| 公開 lookup／揭露 | `member.ts:122–126` 匿名 `{name}`，不存在會員／未取名／非ready均 `{name:null}`；無內部id、claims或history。probe實測同地址 null→EmberCat，無session即可讀。這是有意公開的地址—名稱連結，可被第三方保存／關聯；null不能可靠證明從未登入。沒有本輪 production names GET。 |
| Cookie／客户端 | member reply `:39–41` 全程 no-store，無 Set-Cookie；不會重設／清除登入。MemberClient `:46–68,78–99` 按身份 generation、response wallet、actor/version防跨帳號；同身份內舊load的排序缺口見 M1-R2。名稱查詢延遲400ms、快取1分鐘、256-entry，取消callback不表示取消已發HTTP。 |
| 運行與資料 placeholder | 缺0006本機會員路由503而登入仍可用。八張表中 economy 初始0／life not_started；沒有0007、check-in、economy更新／E1實作，不能將保留欄位當Coin功能。 |

### M1-R1 — Low：每會員五次寫入紀錄的並發上限非原子

**[碼讀＋本機合成時序重現]** `source/server/member.ts:190–194` 先 SELECT count，之後才在 `:179–181` INSERT OR IGNORE refusal；兩者不是同一原子條件寫入。migration `0006_members.sql:85–97` 僅保護 requestId／成功version，不限制每分鐘總數。

前提：已有自己的有效session、會員與合法actor；多個不同requestId的同源PUT並發，IP limiter仍有額度，數個 D1 count 在首個紀錄寫入前完成。攻擊不需另一個人的session。本輪在真handler＋node:sqlite外包一層**只延後 count 回應、不改SQL或值**的 barrier，12個請求都讀到0後一起續行；20/min的IP fixture放行。12個`Admin`保留名稱全部409且`profile_requests=12`，超過5；其後普通PUT=429。直接在同步adapter自然排程的初版則只有5筆，不能隱去這個差異，也不能宣稱 production 自然排程已重現。

影響：每會員5/min不是嚴格DB成本界線，可在重疊讀取下增加拒絕紀錄／寫入量，仍受20/IP/location、session及其他防線約束；沒有藉此取得別人身分，也未繞過成功改名的version／冷卻。建議把budget reserve／計數檢查和紀錄寫入放到同一條條件SQL或原子batch，拒絕路徑也適用。

重現：[reviewer-member.mjs](evidence/reviewer-member.mjs) 複製至已安裝依賴的固定source副本 `tests/` 後 `node tests/reviewer-member.mjs`；[最終輸出](evidence/reviewer-member-final.log)。[初版自然排程失敗斷言](evidence/reviewer-member.log) 也保留；沒有將失敗研究當通過。

### M1-R2 — Info：同一登入身分的舊 GET 覆蓋剛保存的名稱顯示

**[實測]** `source/src/world/member.ts:55,61–69,78–92` 的mine只核對identity generation／wallet；load不編號，save成功也不使舊load失效。前提：同身份profile GET在途，稍後save完成，再收到舊GET；公開class允許此順序，完整WorldApp能否由一般UI觸發未驗證。

真handler先生成v0 profile回應、probe延遲交付，保存OrderCat得v1，再交付v0：client退回`needs_name、displayName:null、version:0`，server仍`ready、OrderCat、version:1`。影響為過時名稱／提示／後續版本衝突，不是伺服器改名回滾或越權。建議對load／save使用一致的序號，或拒絕同會員較低version的response。

重現：[reviewer-member-order.mjs](evidence/reviewer-member-order.mjs)、[輸出](evidence/member-order-final.log)。初版probe誤以GET沒有init參數判斷，未釋放promise exit13；修正為依method判別後exit0。這是scaffolding修正，未改target code。

### M1 邊界擴大：沿用 F-1／F-2／F-8，不能再只描述為 read-only

**[碼讀＋推論，非另算新的簽章繞過]** [MINT_BOUNDARY.md:11](https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/docs/security/MINT_BOUNDARY.md#L11) 仍描述World session只授予read-only view，但M1 `member.ts:137,173`接受同一session持久建立／改名。取得真challenge簽章的relay、可任意回magic word的合約、或同源惡意程式，可能操作該session的公開名稱，觸發7天冷卻。actor public id是防陳舊表單，不是第二因子，持有session可先GET取得。F-1原Medium共享邊界、F-2 Low/Info與F-8 Info不因此消失；本輪未實施釣魚或真合約攻擊。建議更新「read-only」敘述與登入能力提示，將公開姓名變更列入session風險。

## N、A、W、F 舊項目及其他檢查

以下裁決限原問題，證據為當前碼讀、[全套stub log](evidence/stub.log)、[N 43／43](evidence/n.log)；未重新取得更早私人版本或跑正式負載。

| ID | 本輪判定與具體界線 |
|---|---|
| N-1 | **fixed**。`src/world/auth.ts:223–240` sessionReads＋gen在headers、body、error後判斷；舊signed-out不能覆寫較新signed-in。AUD3-04補logout成功時作廢在途讀取。 |
| N-2 | **fixed**。`:331,340` challenge body／signature後確認同一flow／provider／account；獨立控制組0 prompts／0 verifies。已開prompt不能由頁面關掉；R3-R1解決的是另一個connect排序。 |
| N-3 | **fixed（原排序）**。`server/ownership.ts:146`與candidate排序、presence查詢配合；>256時優先現在online或同owner最近24h可計入席位。N-3邊界測試通過；256 cap／5 pages仍可能partial，非完整所有權清單。 |
| N-4 | **fixed（pool/lane混計）**。`server/auth.ts:218`起SQL依called_via區分，owner自己的舊pool不吃fallback lane；垃圾占自己的shared network／全location仍可阻礙。 |
| N-5 | **partly／residual as stated**。`worker/app.ts:90–103` /48總額與/64子份額、`auth.ts:182`起shares；IPv6 /48兩份、/64一份，轉host或verify IP不搬challenge份額。/48多subscriber共享與分配假設未消除。 |
| N-6 | **partly／residual as stated**。`auth.ts:694–705`、`ownership.ts:292`的新買家lane；20其他網段可耗location key，同網先取、全站ceiling、已有其他eligible不走lane等仍在。80-claim與拒絕計次模型見AUD3-02。一個operation可有5個NFT HTTP GET，不是一次請求。 |
| N-7 | **fixed（原分類）**。`server/auth.ts:596`真到期加expired；`client auth.ts:236–240,261`區分revoked／expired。本頁expiry、clock skew、logout-all測試通過；cookie已丟時原因仍未知。 |
| A-1／Medium availability | **partly／residual as stated**。合約shared checks與lane各有限；N-4／N-5改善成本但同網或多網段仍能塞滿。本機A-1與N回歸通過，不是高負載／Cloudflare吞吐保證。 |
| A-2／Low | **fixed 原kept-index問題**。`server/ownership.ts:165–173,248`跨isolate候選保存與時間防倒退，ownerOf重證；未發現的新買候選仍可能無法計入。 |
| A-3／Low | **fixed 原home-read排序**。`src/world/auth.ts:245–267` gen／homeGen涵蓋body和錯誤，N-1另處理session read。不可概括到新M1的load（M1-R2）。 |
| A-4／Low | **fixed 原cap排序／標示**。A-4＋N-3測試涵蓋256以上與owner-bound sightings；partial不是完整zero。 |
| A-5／Low | **fixed 原舊分鐘計數**。`server/auth.ts:483,512,550,573`在body、code後及consume前取時；slow body測試通過。readJson無獨立timeout，仍有等待資源成本。 |
| A-6／Low | **partly**。address cooldown移除、network challenge共享仍在；IPv4 /24 30/min、IPv6 /48 60/min等不是每使用者保證。 |
| A-7／Low | **partly**。global60/6s中fresh-network reserve改善忙網獨占；多fresh networks仍能用盡，沒做正式DoS測試。 |
| A-8／Low | **fixed 原誤導文案**。`src/world/auth.ts:68–77`與walletView對limited／partial無eligible顯示unavailable，非「已查鏈無席位」；React render回歸通過。 |
| W-1／Info | **fixed 本機到期gate；remote revoke residual**。`auth.ts:155,161`、`homeEntry.ts:11,30`當下clock重驗，其他裝置撤銷仍需下一server read；沒有push即時撤全UI證據。 |
| W-2／Info | **residual as stated**。refusal log有net與colo，並非無IP衍生資料；M1 `member.ts:77–87`也記net／route／status，非完整IP或name。沒有讀正式logs／retention設定。 |
| W-3／Info | **fixed**。`auth.ts:452–459`node／transport錯503，revert／wrong magic等401；失敗不建session。 |
| F-1／S-1／Medium shared boundary | **residual as stated，M1擴大影響**。逐行SIWE／stored message比對不阻止取得真簽章的relay；Origin不能辨識伺服器端relay。不是無簽章登入。 |
| F-2／Low/Info | **residual as stated**。ECDSA first、code gate、exact 32-byte magic word、CONTRACT/ERC1271標記仍在；合約任意接受簽章仍可登入，M1同樣接受此session。 |
| F-3／Low | **partly**。code cap／no-code cache／nonce一次claim／合約share防無限RPC，仍有availability殘餘。keyed probe同nonce五次錯簽只一次eth_getCode，正簽重試仍409；contract一nonce最多getCode＋eth_call。 |
| F-4／Low | **fixed 原缺logout-all**。`auth.ts:617–625`只由live session的address撤銷，forged／dead無權；不同address不受影響。limiter全拒時logout-all200、logout204；前置WAF可能仍阻擋，未測。 |
| F-5／Low | **partly／residual as stated**。challenge／verify分key、fresh-network reserve、globalcap仍有共享availability取捨。 |
| F-6／Info | **本時點npm audit 0**。prod／all JSON皆total0，F-6依賴測試通過；不是供應鏈審查或未來advisory保證。 |
| F-7／Info | **(a) fixed；其餘residual as stated**。精確SIWE檢查；Lax top-level GET仍可能花home／lane預算，M1 profile GET還可能touch時間；style-src unsafe-inline；loopback例外依URL；鎖錢包accountsChanged([])不撤已有效session，不能等同logout。 |
| F-8／S-2／Info | **open／residual as stated**。同origin共用Path=/ cookie、storage、CSP及wallet連線；HttpOnly不阻止同源程式帶cookie發會員寫入。Mint未知項另列。 |

**權限與共享快取補充。** `server/auth.ts:679–707`的home地址只來自session；body、query、public names、public assets均不能選擇另一個受保護身份。`server/ownership.ts:54`以ownerOf／Multicall同block證明候選；偽造index／roster測試不能直接授權。owner-bound presence不把seller sightings送buyer。一wallet一house、大小依counted seats是產品規則。proof30s快取、可見頁60s重查、部分失敗暫留home最多3分鐘，不能承諾轉手30秒內整個UI撤權；地圖名冊與server eligible大小／位置可不同。

`moves.ts:46,64`及`homeEntry.ts:11,30`按當下session與house owner重驗；Enter group5 3／3含撤銷後401關閘。public assets不是owner證明。Worker共用snapshot copy相關測試（不同gateway/isolate、clone、失敗／舊資料）通過；client的公共資料不能寫進session或names。沒有重現公共cache污染授予身份。上游roster／index漏報、stale快取及RPC故障仍可能影響availability／畫面，不是完整上游資料真實性驗證。

## 正式檔案的 wallet-method inventory

僅檢查本次已下載的index JS與InteriorView，沒有額外GET。詳細literal計數及周邊程式在 [live-checks.json](evidence/live-checks.json)。

| 字串／呼叫 | index JS | InteriorView |
|---|---:|---:|
| eth_accounts | 1 | 0 |
| eth_requestAccounts | 1 | 0 |
| personal_sign | 1 | 0 |
| `.request(` | 3（上列provider呼叫） | 3（繪圖this.request排程） |
| eth_sendTransaction／eth_sendRawTransaction／eth_signTransaction | 各0 | 各0 |
| eth_signTypedData／signTypedData | 各0 | 各0 |
| permit（不分大小寫，含Permit2） | 0 | 0 |
| approve（不分大小寫） | 2（說明文案） | 0 |
| setApprovalForAll／0x095ea7b3／0xa22cb465／0xd505accf | 各0 | 各0 |
| wallet_sendCalls／wallet_getCallsStatus | 各0 | 各0 |
| wallet_grantPermissions／wallet_requestPermissions | 各0 | 各0 |
| wallet_switchEthereumChain／wallet_addEthereumChain／wallet_watchAsset | 各0 | 各0 |
| sessionKey／delegation／sendAsync | 各0 | 各0 |
| document.cookie／eval(／new Function | 各0 | 各0 |
| import( | 1（InteriorView） | 0 |

公開source `src/world/auth.ts:205,307,338`與取得bundle相符；personal_sign參數為`[hexUtf8(經精確檢查的SIWE), account]`，沒有發現transaction、typed-data、approval、batch、切鏈或session-key呼叫。兩個approve是中文授權說明與拒絕連線英文句；Interior的request為requestAnimationFrame相關，不是錢包。server eth_getCode／eth_call是後端讀取，不是使用者錢包送交易。

**這是靜態可見方法清冊，字串零次不證明所有runtime路徑、動態組字、注入provider、第三方擴充或未取得檔案的行為。** 本輪沒有打開錢包或模擬production登入；不以fixture證明完整browser flow。

## Deployment match：partial

**[實測] source/單獨Worker重建 verified；整體deployment partial。** 在/tmp隔離source副本，lock安裝後以最小dist/index.html占位讓assets binding通過dry-run；不借用完整前端、房屋geometry或保留WorldApp。移除文件stubs後再建，得到：

```text
303128 bytes
cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518  index.js
```

與任務指定值及`manifests/deploy-record-SHA256SUMS.txt`的`deploy-records/20261003T005417Z-ddb10e2/worker/index.js`完整一致。[hash](evidence/worker-hash.txt)、[manifest摘錄](evidence/deploy-manifest-extract.txt)、[dry-run](evidence/worker-final.log)。占位HTML不是frontend重建。

正式站只有以下**五次GET、各一次**，curl User-Agent、約6秒間隔，未送cookie、不follow redirect、不重試、不POST／PUT、未登入或查其他API。2026-10-03 **14:39:20Z–14:39:45Z**全部200／curl exit0。原始response headers、時間與body hash在 [live.json](evidence/live.json)。

| URL | bytes | 本輪SHA-256；與指定／紀錄相符 |
|---|---:|---|
| [首頁](https://imdember.com/) | 2634 | `b51fd33164084511d9fb0dc3a23cadfcecbb6965d74a0e418761b7a1bee0205a` |
| [index JS](https://imdember.com/assets/index-BoNTm1MM.js) | 1482070 | `f9cf6a67132706372b2917efdfffe22c6cda0402ae2c7e4ec32bf3aee6c71588` |
| [InteriorView](https://imdember.com/assets/InteriorView-DM8tQpsI.js) | 93242 | `4a64e1f3f47df59ea7f6e369691a78aab8791addbcb33d4d9f332de04e70e84c` |
| [CSS](https://imdember.com/assets/index-BZpalHf7.css) | 58227 | `6799cd5de49639b854270820c090bf5983b22d7d81b58818b9a427e48c1152ec` |
| [匿名session](https://imdember.com/api/auth/session) | 18 | `60483fbb3c01c4080583563e215e3ca4ab5ce4ff74f47cf36eadedd152572d2f`；`{"signedIn":false}` |

四靜態回應×六個標頭與`source/public/_headers` **24／24相等**：nosniff、strict-origin-when-cross-origin、camera/microphone/geolocation禁用、HSTS max-age31536000/includeSubDomains、X-Frame-Options DENY、CSP。CSP script-src self；style-src含unsafe-inline。五回應均無Set-Cookie；session為no-store，API自己的CSP／CORP，不混入靜態24項。

本輪未遇403、未繞過任何封鎖。與團隊13:01:16Z–13:01:40Z的四個fingerprint一致，不能據此認定之後永遠不變。沒有取得其餘98個dist檔，沒有完整前端rebuild。**running Worker version／流量分配、secrets、D1 0001–0006已套用、bindings、limiter拒絕是否計次及WAF >20 API/IP/10s仍是團隊聲稱／未知**；匿名GET成功不證明M1表存在，static hash相同也不證明API使用同一Worker程式。

## 命令、結果與可重現性

本輪Node **v24.21.0**、npm **11.19.0**；與團隊v24.19.0／11.17.0不同但符合engines。沒有修改目標產品程式。下載快照放test/scratch，依測試說明在**repository以外/tmp**建立自己的git HEAD，未操作交付repo的.git／.github／.env／node_modules。報告及文字證據不依賴安裝後的工具即可閱讀；套件只是本輪隔離執行工具，並非提交的產品依賴。

取得：`curl -L --fail -A 'curl/8.0' https://api.github.com/repos/tungweb3/imd-ember-world-review/commits/6e307dea76e763936fc4ac86e54c9f5d558f58c4`，以及同commit的GitHub archive；前輪報告以raw.githubusercontent.com取回。正式GET實際形式：

```bash
curl --silent --show-error --max-time 40 -A 'curl/8.0' \
  -D <一次性headers檔> -o <一次性body檔> -w '%{http_code}' https://imdember.com<指定路徑>
```

下列均於隔離source副本執行，完整log隨報告保存；沒有把團隊舊log當成本輪結果。

| 命令／操作 | 本輪結果 |
|---|---|
| `git init -q; git add -A; git -c user.name=review -c user.email=review@example.invalid commit -qm snapshot`（僅/tmp獨立repo） | 成功；只有自己的HEAD，無132228c來源歷史 |
| `npm ci --no-audit --no-fund` | 首次exit226，預設/home npm cache唯讀EROFS；沒有掩蓋失敗 |
| `npm ci --cache /tmp/imd-review-run/npm-cache --no-audit --no-fund` | exit0；未另批准esbuild/workerd postinstall，工具仍可執行 |
| `npm test`（無stubs） | **161 run／157 pass／4 fail，exit1** |
| 複製TESTS/stubs的households.ts、layout.ts後 `npm test` | **341／337／4，exit1** |
| `node --test --test-name-pattern='^(R3-R1\|AUD3-\|ADV-)' tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/worker.test.mjs` | **90／90／0，exit0**；實際shell pattern為 `^(R3-R1|AUD3-|ADV-)`，表內反斜線僅防Markdown表格分欄 |
| `node --test --test-name-pattern='^N-' tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/worker.test.mjs` | **43／43／0，exit0** |
| `node --test --test-name-pattern='group 5' tests/home-entry.test.mjs` | **3／3／0，exit0** |
| `node --test tests/member.test.mjs tests/member-client.test.mjs` | **33／33／0，exit0** |
| 移除剛複製的兩個stubs；`npx --no-install tsc --noEmit` | exit2，**16 diagnostics：15 TS2307、1 TS7006** |
| `mkdir -p dist`，寫最小HTML；`CI=1 WRANGLER_SEND_METRICS=false npx --no-install wrangler deploy --dry-run --outdir ../worker-rebuild` | 首次config路徑不可用；改 `XDG_CONFIG_HOME=/tmp/imd-review-run/config`、`WRANGLER_LOG_PATH=/tmp/imd-review-run/logs`、`npm_config_cache=/tmp/imd-review-run/npm-cache` 後exit0。移除stubs後重建仍同完整hash／size；沒有上傳 |
| `npm audit --cache /tmp/imd-review-run/npm-cache --json`、另加`--omit=dev` | 兩者exit0，JSON漏洞total皆**0**；[all](evidence/audit-all.json)、[prod](evidence/audit-prod.json) |
| `node tests/reviewer-probe.mjs` | exit0；舊R3-R1不再成立、N-2零prompt/verify、pagination=5／partial |
| 將80-case附加至ownership測試副本；`node --test --test-name-pattern=REVIEW-80 tests/reviewer-lane.mjs` | **1／1／0**；另一location buyer被全域ceiling阻擋；其他case未重跑 |
| `node tests/reviewer-member.mjs` | 最終exit0；early-refusal、fail-open hourly touch、12並發紀錄、匿名lookup assertions全部完成。自然排程初版預期12卻實際5而exit1；加入明示barrier才重現可能時序 |
| `node tests/reviewer-member-order.mjs` | 最終exit0；client v0、server v1；初版probe判GET條件錯誤exit13，已修正 |
| 文件keyed-reads probe複製至tests後 `node tests/keyed-probe.mjs` | exit0；nonce／RPC／limiter／logout成本結果見[keyed.log](evidence/keyed.log) |
| 文件SIWE generator複製到source後 `node siwe-probe.mjs ../siwe.txt` | exit0；本機合成訊息，不是真錢包或正式cookie |

**四個全套失敗不可混為漏洞或宣稱全通。** 無stubs時home-entry、ownership、wallet-client三整檔在loader缺households／layout，個別case未執行。加stubs後只開放非幾何邏輯：door 1.8m、group8 interior preview、TEST-1 Enter render後段三例仍因HOUSE_FOOTPRINT主動throw／缺mockSeats而失敗。第四個deploy-evidence real-record案例在`tests/deploy-evidence.test.mjs:54`依賴私有歷史`132228c`；自己的archive HEAD無此commit，後段舊版比較未執行，不是正式manifest已判無效。兩套均cancelled/skipped/todo=0；focused未選案例不當成已測。

tsc缺WorldApp、bridge、dataMode、terrain、households、layout、virtual宣告及build script等；TS7006由缺型別造成。沒有完整UI/application build產物，沒有擅自補幾何使測試假通。團隊完整source的1009／1008／1與102個static rebuild仍只是團隊紀錄，本輪未重做。

## World／Mint 邊界與未知事項

- **G-1**：World SIWE/session不是Mint授權；M1名稱寫入也不是Mint同意。Mint必須有自己的明確交易／授權設計，本輪沒有可驗實作。
- **G-2**：relay、permissive ERC-1271、World的ownerOf／活動eligibility與cache不能直接移植成Mint資格證明。新增名稱只是社群識別字，不是官方或合約身分。
- **G-3／S-2**：同origin cookie／storage／wallet權限、CSP、合約地址、chain id、recipient、amount/quantity、交易參數、approvals、Permit/Permit2、simulation、replay、smart-wallet政策及session reuse均須Mint另審；本輪全部是**unknown／out of scope**，不推定已實作或已通過。
- **Genesis Mint、Ember Coin E1、0007、check-in/economy實作不在此目標**。0006的零economy與not_started life只是目前placeholder；未添加、測試或評價Solidity（repo無Solidity）。
- 正式M1的DB狀態、production D1 batch isolation／RETURNING、真wallet事件順序與prompt、跨tab真browser cookie到達、WAF與實際拒絕計數、secrets與運營logs、保留WorldApp接線、場景／室內／3D／美術／音樂均未確認。
- 所有本機簽章使用記憶體合成金鑰、假provider與假鏈上資料；不是production簽章、資產或交易。node:sqlite的transaction adapter支持本機SQL判斷，但不能證明Cloudflare D1的部署與執行效果。

交付檔案結構與文字／hash檢查只證明輸出可讀、引用與紀錄自洽；本輪自查沒有獨立認證效力。修補通過的原情境、已保留的availability／共享邊界、新M1問題及未知項必須一併閱讀。
