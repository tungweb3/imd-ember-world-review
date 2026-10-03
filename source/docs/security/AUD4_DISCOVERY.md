# AUD4-03 / R4-09：Discovery lane 的 admitted capacity

本輪只修正 World `/api/me/home` 的 discovery lane。會員名稱、登入、Genesis Mint、Coin E1、Solidity、錢包交易及批准權限均不是這項變更的內容。房屋權限仍由有效 session 的地址、Ethereum mainnet `ownerOf` 與既有 seat／activity 規則決定。

## 問題與新順序

舊 AUD3-02 先在 D1 寫入 claim，再詢問 `chain:index:lane`。本地 limiter 拒絕後，每六秒最多釋放 20 筆；其餘拒絕會占住全域 60／六秒的容量。Audit 的 80 次拒絕案例留下 20 筆 released 與 60 筆 retained，即使沒有送出 NFT-index 工作，另一個 location 也可能被擋住。

新順序如下：

1. `INDEX_LANE_READY` 以有界、唯讀查詢預檢本網及全域 admitted 額度。
2. 重新讀時鐘，在獨立 `index_lane_probes` 以原子 gate 取得本網 30 秒 probe 權；batch 先清理最多兩筆過期 scope，再保留 probe。
3. 詢問本地 `chain:index:lane` limiter。拒絕或一般 binding 故障時停止，保留 probe marker，但零 admitted lane 寫入、零 release／UPDATE refund、零 NFT-index 呼叫。
4. 本地允許後，重新讀取時鐘，以原子 `INDEX_LANE` 重查本網及全域額度，再保留工作。
5. 只有確認 admitted 保留成功，才執行既有 index rebuild。已送出的 index／ownerOf 工作失敗仍不退還保留，並保留 AUD3-01 的第一份 ownership proof。

預檢不是保留，也不能授權 index 工作。不同網段的請求可以同時通過預檢、probe 與本地 limiter；最後 D1 statement 才是 admitted 額度權威。競態輸掉的請求可能已消耗本地 token，但不會增加 admitted 列或送出 index 呼叫。同網段並發必須先通過原子 probe gate，不能在 limiter 拒絕後才補寫 marker。

## 嚴格資料庫條件與成本

原子保留維持 60／六秒的全域條件、IPv4 `/24` 每分鐘一筆、IPv6 `/64` 每分鐘一筆及 `/48` 每分鐘兩筆。SQL 共用同一 eligibility predicate，避免預檢與保留條件漂移。預檢後的保留使用新的時間，避免慢速 limiter 把保留日期放到過去的容量窗口。

每次 admitted 預檢最多讀取 2 筆 covering `index_lanes_net` entries 及 60 筆 covering `index_lanes_at` entries；本地允許後的保留再做相同上限的查詢，這兩次最多共 124 筆 entries。成功保留寫入 row 與兩個索引 entries，共 3 筆，後續正常 cron 清理再寫 3 筆。拒絕預檢時不做 probe；拒絕本地 limiter 時不新增 admitted 列，獨立 probe 仍存在。

`0008_member_hardening.sql` 另外加入 `index_lane_probes(scope_key,net,sub,probed_at,expires_at)`。`scope_key` 是 canonical net 加固定分隔符及 sub，IPv4 sub 為空；TEXT primary key 沒有 nullable composite key 的漏洞。`expires_at = probed_at + 30,000`，允許、拒絕及故障都保留 marker，不退款。gate 的 covering network 查詢最多讀 2 筆，另有至多一筆同 scope 的 PK 衝突／到期更新；過期 scope 即使未被兩筆 prune 選中，也可原子替換。網段額度為 `/24`、`/64` 每 30 秒各一筆，`/48` 每 30 秒兩筆。

每次 probe batch 的 expiry 查詢最多取 2 筆，後續最多 2 個 PK 定位／列刪除；一次 gate 至多新增或替換 1 筆 marker。marker 列的物理寫入估算是 table row、TEXT PK autoindex、network index 及 expiry index，至多 4 筆；最多兩筆刪除加一筆保留合計至多 12 筆。沒有新 release scan 或無界 UPDATE。查詢明示 `INDEXED BY`，缺少任一必要索引時不退化成 full scan。

獨立 cron 的 `pruneIndexProbes` 使用 expiry index，每次最多取 200 個 scope、做 200 個 PK 定位／刪除，至多 800 筆物理寫入估算；其清理不依賴 M1 `schemaReady`。過期定義是 `expires_at <= now`，沒有再保留一分鐘。傳入上限會夾在 0–200，NaN／Infinity 使用 200。缺 table／index 回傳固定 `schema_unavailable`，一般儲存故障由 caller 記錄固定 unavailable，不洩漏 SQL 或原始錯誤。

新保留上限為每分鐘 600 筆；保留與最終 prune 合計最多每分鐘 3,600 筆寫入。若既有每 15 分鐘的 cron 正常執行，約 16 分鐘的存量上限估算是 9,600 筆；cron 延遲時不能把這個估算當成硬性儲存上限。一次 admitted operation 仍最多讀取 `NFT_PAGE_CAP` 的 5 個 NFT-index 頁面，多餘候選維持 `partial`。

`index_lane_probes` 沒有全域 fail-closed probe cap，以免某一 location 的拒絕再次阻擋另一 location 的 admitted 工作。正常持續輸入時，每次最多建 1 筆、可清最多 2 筆到期列，有助排出過期 backlog；這不是總儲存硬上限。新網段湧入、流量及 location 數未知，cron 延遲或停止也可能留下 backlog，應另觀測而非宣稱絕對容量界限。

本輪不產生 `released:` 列，也不產生 `index_lane_kept` release-cap 日誌。既有 `released:` predicate 保留，讓舊部署留下的 IPv6 列仍受到原 `/64` 限制；原有 cron 繼續清理。舊部署留下的 retained 列在其既有時間窗口內仍會計數，切換版本不會憑空移除它們。新版缺少 0008 table 或索引時 lane fail closed，但 EOA 登入、session read、原先可建立的 ownership proof 與 normal index key 不依賴 probe 表。舊 binary 不會讀取獨立 probe 表，回退仍回到舊版 discovery 殘留，不能當作已修復。

## Cloudflare 官方行為與未知事項

[Cloudflare Rate Limiting API 官方文件](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) 說明 rate limit 按 location 執行，計數採本地快取、非同步更新，且不適合作精確計帳。文件沒有保證 `success:false` 的呼叫不影響計數。因此 D1 控制 admitted reservation，Cloudflare limiter 只提供基礎設施流量限制；本地 20 normal ＋ 20 lane／分鐘是測試模型及設定目標，不能宣稱為正式環境的精確呼叫上限。

獨立 probe gate 保留舊版 30 秒網段 backoff，因此即使多 session 同時通過 admitted 預檢，同一 `/24`／`/64` 每分鐘仍最多探測兩次，`/48` 最多四次。既有 API／home binding 及外部 edge 規則繼續限制流量，但這些基礎設施限制不是全域或精確計帳。多 session、多 IP、多 location 的壓力仍是可用性殘留。

測試明確比較兩種滑動窗口模型：

| 模型 | 20 個網段先占用本地 key，之後 10 個 `/24` 持續重查、各只能每 30 秒探測，買家每 15 秒重查 |
| --- | --- |
| 拒絕不計入額度 | 拒絕不延長關閉，買家在約 60 秒後可 discovery |
| 拒絕也計入額度 | 10 個 `/24` 在 3 分鐘模型期間仍可阻擋同 location 買家；9 個不足，買家約 60 秒後 discovery。D1 admitted 列沒有被拒絕探測增加 |

這是明確保留的本地可用性風險；本輪沒有把舊模型的阻擋成本降低成一個 `/24`。修好的是「拒絕探測占用跨 location 的 admitted 全域容量」，不是所有 limiter／網路共享／多網段攻擊的 availability 問題。D1 admitted 保留失敗仍可能耗掉已取得的本地 token；probe marker 也保留到期，無法退還。

## 回歸與舊期待的變更

`tests/aud4-discovery.test.mjs` 加入 AUD4-03：原始 4 EOA × 20 次、80 個 `/24` 拒絕的兩種計數模型；跨 location 合法新買家；跨 location 的全域上限；強制所有預檢先通過的 IPv4、IPv6 及全域競態；12 個同網段並發拒絕只有一次 local probe；29,999 ms 拒絕／30,000 ms 可重探的時間邊界；opportunistic 最多 2 筆；缺 0008／必要索引；D1 預檢／回覆不確定；慢速本地許可；舊 released 列相容；兩種本地殘留模型。每例驗證 route status、admitted 列與實際 NFT-index 呼叫；登入 session 數在 80 次拒絕與合法買家 discovery 前後不變。這些 route fixture 沒有錢包 provider；錢包提示數的 client 回歸由 auth suite 驗證。獨立 cron 上限、缺 M1 schema 的隔離性及固定安全 log，由整合 owner 的 member／presence 測試驗證。

`tests/ownership.test.mjs` 保留 N-6、AUD3-01 及既有 ownerOf／eligibility 檢查，明確更新舊 AUD3-02：

- 本地拒絕由「backdated released 列」改為「沒有列」，不再有 release-cap／release-failed 操作。
- 原 100 次拒絕的「20 released／60 retained／20 D1 refused」改為零 admitted 列、零 index 工作；獨立 probe marker 保留退避，不污染 admitted ceiling。
- 同網段並發在詢問本地 key 之前已受原子 probe gate 限制；不同網段的 global 競態仍由最後 admitted SQL 控制。
- 保留兩次／分鐘的網段 probe 上限及 denial-counted 的 10／9 網段可用性殘留。既有 `windowLimiter` 是 fixed-window 且每次呼叫都計數，不能描述為 refusal-free。

2026-10-04 驗證命令：`node --test --test-reporter=spec tests/ownership.test.mjs tests/aud4-discovery.test.mjs`，70／70 通過（51 個 ownership、19 個新增 discovery），零 fail／skip。測試使用 node:sqlite adapter 與 fake chain／colo-local limiters，不證明正式 Cloudflare 計數、真實 D1 執行／RETURNING、WAF、upstream 可用性或完整 WorldApp／真實瀏覽器整合。
