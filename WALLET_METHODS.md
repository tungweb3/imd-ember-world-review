> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# WALLET_METHODS：錢包方法、流程與證據界線

## 1. 本次目標與清冊結論

固定 Worker `acdbb2bd-8add-4b15-bfa6-a31266c83520`，LIVE `ddb10e28a867998323164e7585635efedfcf7788`，source main `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`；D1 0001–0006。這份是團隊的 source／下載檔核對紀錄，**不是外部複查通過**。

公開 `source/src` 中的 EIP-1193 provider request 只有三個常數方法，全部在 `src/world/auth.ts`：

| 當前 source | 方法／params | 觸發與提示 |
| --- | --- | --- |
| `source/src/world/auth.ts:205` | `eth_accounts`，無 params | bind provider；只讀已授權帳號，不開提示 |
| `source/src/world/auth.ts:307` | `eth_requestAccounts`，無 params | 本人點登入、沒有已知 account；可開連線提示 |
| `source/src/world/auth.ts:338` | `personal_sign`，`[hexUtf8(message),account]` | 同次登入、精確 SIWE 檢查通過，開簽名提示 |

`hexUtf8` 是 UTF-8 text → hex（`source/src/world/auth.ts:83`）。message 來自 server challenge，nonce／目前 origin／account／11 行格式先由 `checkSignInMessage` 檢查（`source/src/world/auth.ts:334`、`source/src/world/siwe.ts:16`）。

這三個呼叫沒有發送 transaction、typed data、Permit／Permit2、approval、批次呼叫、切鏈、session key 或 delegation。新增 M1 命名不增加 wallet call（`source/src/world/member.ts:3`）。靜態 source／bundle 檢查不能單獨保證注入程式、惡意 provider 或全部 runtime 路徑；未公開 UI code 的界線見第 6 節。

## 2. Provider、事件與帳號順序

- EIP-6963：發出 `eip6963:requestProvider`，收 `eip6963:announceProvider`（`source/src/world/wallet.ts:54`）。
- 每個 provider 物件一筆；rdns 重複會警告，不把另一個物件靜默取代既有 provider（`source/src/world/wallet.ts:57`、`source/src/world/wallet.ts:78`）。
- 使用者 choose 的是 provider 物件。記住的 rdns 只有恰好一個宣告者才自動使用；沒記住且只有一個宣告者也可自動用（`source/src/world/wallet.ts:72`、`source/src/world/wallet.ts:81`）。
- 有宣告者但需要選擇時 current 為 null；完全沒有宣告者才退回 window.ethereum，UI 告知辨識不了擴充功能（`source/src/world/wallet.ts:65`、`source/src/world/wallet.ts:88`）。
- 圖示只接受 ≤64 kB 的 data:image 類型，透過 img 顯示（`source/src/world/wallet.ts:35`）。
- AuthClient 只監聽 `accountsChanged`，沒有監聽 `chainChanged`、沒有 eth_chainId；SIWE chainId 固定1（`source/src/world/auth.ts:200`、`source/src/world/auth.ts:206`）。
- 每個 accountsChanged（含重複 account、鎖錢包）先遞增 accountEvents。過時 eth_accounts／connect 答案不能蓋掉較新的 event（`source/src/world/auth.ts:204`、`source/src/world/auth.ts:312`、`source/src/world/auth.ts:396`）。
- challenge body 回來及簽名回來都再確認 gen／provider／account。已取消但已打開的錢包提示無法關閉，回應不送 verify（`source/src/world/auth.ts:331`、`source/src/world/auth.ts:340`）。

R3-R1 的順序修正尚未外部複查。本次只有合成 wallet ordering；wallet 回傳舊帳號卻沒有 accountsChanged 時，頁面無法辨識它是過時答案。

## 3. 每個使用流程會問什麼

| 流程 | 錢包呼叫 | API／本機行為 |
| --- | --- | --- |
| 載入頁面／恢復 session | eth_accounts；不簽名 | GET /api/auth/session，成功 session 再讀 /api/me/home |
| 同一帳號已登入，再按登入 | 無新簽名 | 重讀家，`source/src/world/auth.ts:315` |
| 新登入 | 必要時 eth_requestAccounts；最多一次 personal_sign | 先等 session read／本頁 logout，challenge→訊息檢查→verify→home |
| session 未知或 logout 超過等待期限 | 不開新的 wallet prompt | session-unknown／logout-slow；`source/src/world/auth.ts:299`、`source/src/world/auth.ts:302` |
| challenge／訊息不合、流程取消 | 沒有 personal_sign（若尚未打開） | 流程結束；不自動重試 |
| 簽名拒絕／verify 拒絕 | 不自動再簽 | 顯示原因；下次本人點擊取得新 challenge |
| 分頁回前景／到期／被撤銷 | 無 | session／home 讀取、到期計時器；`source/src/world/auth.ts:155`、`source/src/world/auth.ts:161` |
| 回家／我家標記／家重查 | 無 | 依已驗 home／名冊決定畫面；home polling |
| 搬家 | 無 | commitMove 再驗 owner；只寫本機 moves storage |
| Enter 自己的家 | 無 | enterAtPress 再驗；載入靜態 InteriorView chunk／模型，公開 gate 不發 API |
| 看任一地址資產 | 無 | 公開 GET /api/wallet/:address/assets，不證明屋主 |
| 登出此裝置 | 無 | POST /api/auth/logout；成功後清本頁身份 |
| 登出全部裝置 | 無 | POST /api/auth/logout-all；伺服器以 live session address 撤銷 |
| 換帳號 A→B／改選 provider | 不另簽；新 bind 可能 eth_accounts | 舊流程失效／logout；失敗就讀回 session，可能 mismatch |
| M1 取自己的會員／名稱 | 無 | 先 GET /api/me/profile；僅404才POST /api/me/bootstrap |
| M1 保存／改名 | 無 | PUT /api/me/profile，session＋actor＋version＋requestId |
| 房屋公開名稱 | 無 | 延遲400ms查 names，頁面快取1分鐘；不授屋主權 |
| 「稍後取名」 | 無 | 本機 member skip key；不建立／保留假名稱 |

相關 source：`source/src/world/auth.ts:280`、`source/src/world/auth.ts:365`、`source/src/world/moves.ts:64`、`source/src/world/homeEntry.ts:30`、`source/src/world/member.ts:60`、`source/src/world/member.ts:77`、`source/src/world/member.ts:118`。

本次沒有 Owner 真錢包測試。舊交接記錄的 MetaMask Sign-in request／No changes／登出只屬 `bbf24001`，不是 `acdbb2bd` 的實測。

## 4. 已下載正式檔案的靜態重新計數

團隊在 2026-10-03T13:01:16Z～13:01:40Z完成允許的五個低頻 GET，本頁只讀其已保存 body，沒有再連網。

| 檔案 | bytes／SHA-256 |
| --- | --- |
| /assets/index-BoNTm1MM.js | 1,482,070；`f9cf6a67132706372b2917efdfffe22c6cda0402ae2c7e4ec32bf3aee6c71588` |
| /assets/InteriorView-DM8tQpsI.js | 93,242；`4a64e1f3f47df59ea7f6e369691a78aab8791addbcb33d4d9f332de04e70e84c` |

以下是**literal substring 次數**，不等於執行次數或所有可能 runtime method。

| 字串／模式 | index JS | InteriorView |
| --- | --- | --- |
| `.request(` | 3；3個均是上述provider方法 | 3；都是內部繪製排程的this.request() |
| eth_accounts／eth_requestAccounts／personal_sign | 各1 | 各0 |
| eth_sendTransaction／eth_sendRawTransaction／eth_signTransaction | 各0 | 各0 |
| eth_signTypedData／signTypedData | 各0 | 各0 |
| Permit2；permit（不分大小寫） | 各0 | 各0 |
| setApprovalForAll | 0 | 0 |
| approve（不分大小寫） | 2；兩個都是說明文字 | 0 |
| 0x095ea7b3／0xa22cb465／0xd505accf | 各0 | 各0 |
| wallet_sendCalls／wallet_getCallsStatus | 各0 | 各0 |
| wallet_grantPermissions／wallet_requestPermissions | 各0 | 各0 |
| wallet_switchEthereumChain／wallet_addEthereumChain／wallet_watchAsset | 各0 | 各0 |
| eth_chainId／chainChanged／sendAsync | 各0 | 各0 |
| accountsChanged | 2（註冊／移除） | 0 |
| eip6963:requestProvider／eip6963:announceProvider | 1／2 | 0／0 |
| WebSocket／EventSource／eval(／new Function | 各0 | 各0 |
| document.cookie／document.write | 各0 | 各0 |
| import( | 1（InteriorView chunk） | 0 |
| fetch／localStorage／BroadcastChannel／postMessage | 87／17／2／3 | 各0 |

兩個 approve 字串是「授權（approve）」說明與「The wallet did not approve the connection.」，沒有 approve 呼叫。InteriorView 的三個 request 是繪製 scheduler，不是 EIP-1193。

四個正式靜態檔與部署紀錄 hash 相符、24個靜態標頭比較相同；五個 GET 均沒有 Set-Cookie。**整體 deployment match 仍 partial**，不因此證明正在跑的 Worker／D1／secret／binding／limiter 行為。

可以在已保存檔案上重算 substring／SHA，不必再向正式站要求請求。Report 本次僅允許首頁、指定 index JS／InteriorView／CSS、session 各一次，不包括真錢包、登入或新的 M1 GET。

## 5. Server 的鏈上讀取不是錢包交易

| Server 呼叫 | 用途與前提 | source |
| --- | --- | --- |
| eth_getCode | 非ECDSA、非no-code快取、非已知ERC1271；claim／code cap允許 | `source/server/auth.ts:439` |
| eth_call → isValidSignature | contract share／location key允許；完整magic word才認可 | `source/server/auth.ts:452` |
| eth_call → Multicall3 aggregate3 | ownerOf＋getBlockNumber；candidate cap256／每chunk200，同一block | `source/server/ownership.ts:54` |
| Alchemy getNFTsForOwner REST | 只發現候選；先chain:index，或符合條件的index lane；最多5頁 | `source/server/ownership.ts:74`、`source/server/ownership.ts:224` |
| 空 character list | 目前CHARACTER_COLLECTIONS空，因此不發角色NFT索引讀取 | `source/src/world/collections.ts:6`、`source/server/ownership.ts:311` |

Alchemy秘密只由Worker server使用，透過Authorization header；此包未含真實secret（`source/server/ownership.ts:43`、`source/server/ownership.ts:83`）。Server source 未要求用戶錢包為上述讀取付款或送交易；RPC效力仍依供應商及部署設定，未以此文件查證正式憑證。

## 6. Browser storage、M1 與驗證限制

| key／通道 | 用途，不能當權限來源 | source |
| --- | --- | --- |
| ember-world-wallet | 最後查看／連線地址 | `source/src/world/wallet.ts:11` |
| ember-world-wallet-choice | EIP-6963 rdns選擇；不是私鑰或session | `source/src/world/wallet.ts:11` |
| ember-world-session-hint | address／expiry，沒有token；到期顯示提示 | `source/src/world/auth.ts:86` |
| ember-world-moves-v1-live／mock | 本機位置；舊signature/message在讀入時丟棄 | `source/src/world/moves.ts:12`、`source/src/world/moves.ts:17` |
| imd.member.skip.<publicMemberId> | M1「稍後命名」卡折疊；不是免登入／保留名額 | `source/src/world/member.ts:29`、`source/src/world/member.ts:73` |
| imd-ember-auth BroadcastChannel | 通知其他分頁重讀server；不信任通知自帶的身份 | `source/src/world/WalletPanel.tsx:22`、`source/src/world/auth.ts:191` |

M1 player name 顯示於會員／錢包及房屋面板（`source/src/world/MemberPanel.tsx:94`、`source/src/world/WalletPanel.tsx:120`、`source/src/world/HomePanels.tsx:15`）。名稱、publicMemberId、skip key 都不能授予 owner／Enter／move；既有 session＋ownerOf＋eligibility gate 才是來源。

此包未公開WorldApp、完整layout／households、室內原始碼與美術；公開client有未公開的imports。測試stub可讓指定logic／React fixture執行，不提供完整app build、場景幾何或真錢包流程。Live兩個bundle的計數也無法排除執行期組method、注入JS或之後換版。

R3-R1、AUD3-01～08與追加修正仍待外部複查；M1從未Swarm審查。測試摘要：`公開無 stubs：161 run／157 pass／4 fail；公開加 stubs：341／337／4（3 項 withheld UI／geometry、1 項 deploy-evidence 私有歷史依賴）；focused 90/90、N 43/43、M1 server/client 33/33、Enter group 5 3/3。完整私有 source archive：1009／1008／1，亦為歷史依賴；npm audit production／all 均 0。全套公開測試不是全通，完整 UI／tsc 受 withheld imports 限制`，看新TESTS log，不把「Completed／accepted」或此清冊當安全背書。Genesis Mint與Coin E1的簽名／交易功能不由本頁涵蓋。
