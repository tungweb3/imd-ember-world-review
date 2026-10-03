> Historical fourth-snapshot evidence (public commit `6e307de`, source `c491ff3`, deployed Worker `acdbb2bd`). Current R4/AUD4 repair evidence is in the root README and R5/. Source has changed; old source counts, tests, algorithms and fingerprints are not current results.

# PUBLIC_CONTENT_LIST：公開內容清單

固定 source `c491ff3` 共 **604** 個 tracked 檔案；以下 **92** 個收錄於 source/，另 **512** 個保留。公開 source 中 **76** 個原樣、**16** 個遮蔽；其中 **11** 個為 LOW_ENTROPY，不公開原始 blob id／SHA-256。部署對照為 Worker `acdbb2bd`、部署來源 `ddb10e2`；見 [SCOPE.md](SCOPE.md)、[DEPLOYMENT_MATCH.md](DEPLOYMENT_MATCH.md)、[REDACTIONS.md](REDACTIONS.md)。

92 是來源檔數；說明、manifests 與 TESTS 證據另計。逐檔內容與 public SHA-256 以整包清單及 manifests 為準。

## source/ 的 92 檔

| 路徑群組 | 數量 | 檔案 |
|---|---:|---|
| 根目錄 | 8 | .gitignore、.nvmrc、index.html、package.json、package-lock.json、tsconfig.json、vite.config.ts、wrangler.jsonc |
| worker/ | 2 | app.ts、index.ts |
| server/ | 9 | auth.ts、chain-mock.ts、d1.ts、gateway.ts、member.ts、ownership.ts、presence.ts、vite-plugin.ts、world-api.ts |
| src/ | 1 | main.tsx |
| src/world/ | 23 | HomePanels.tsx、MemberPanel.tsx、WalletPanel.tsx、auditRecord.ts、auth.ts、cadence.ts、collections.ts、homeEntry.ts、houseSize.ts、i18n.tsx、links.ts、market.ts、member.ts、memberName.ts、model.ts、moves.ts、publicHashes.ts、publicUrl.ts、reviewRecord.ts、siwe.ts、status.ts、wallet.ts、walletView.ts |
| migrations/ | 6 | 0001_wallet_login.sql、0002_sign_in_budgets.sql、0003_sign_in_layers.sql、0004_index_candidates.sql、0005_lanes_and_subnets.sql、0006_members.sql |
| public/ | 1 | _headers |
| scripts/ | 3 | deploy.mjs、deploy-evidence.mjs、member-moderate.mjs |
| docs/wallet-login/ | 1 | DESIGN_W1_v001.md |
| docs/security/ | 2 | AUDIT_REMEDIATION_STATUS.md、MINT_BOUNDARY.md |
| docs/security/deploy-evidence/ | 15 | 完整檔名如下 |
| tests/ | 15 | auth.test.mjs、d1-sqlite.mjs、dependencies.test.mjs、deploy-evidence.test.mjs、deploy.test.mjs、headers.test.mjs、home-entry.test.mjs、member-client.test.mjs、member.test.mjs、ownership.test.mjs、presence.test.mjs、review-record.test.mjs、wallet-client.test.mjs、wallet-harness.mjs、worker.test.mjs |
| tests/fixtures/ | 6 | activity-0759z.json、cold-home.mjs、cold-verify.mjs、member-panel.mjs、swarm-2026-09-27.json、wallet-panel.mjs |
| **合計** | **92** | |

十五份部署證據頁均在 docs/security/deploy-evidence/：

- 20260928T210413Z-1a0ba21.md
- 20260929T050441Z-2da46cd.md
- 20260929T172429Z-5398b90.md
- 20260929T195417Z-4321bb4.md
- 20260930T064805Z-df8ea90.md
- 20260930T145241Z-007ee80.md
- 20260930T154746Z-a77f91b.md
- 20260930T185800Z-41ae386.md
- 20260930T221950Z-0d57791.md
- 20261001T040934Z-2e4e830.md
- 20261001T111020Z-7da33f2.md
- 20261001T191028Z-9ad115a.md
- 20261002T040044Z-9f069dd.md
- 20261002T060718Z-f36144a.md
- 20261003T005417Z-ddb10e2.md

相對前次公開的 `8cad017`（78 個 source 檔），本版新增 **14 檔**：四份部署證據 `docs/security/deploy-evidence/20261001T111020Z-7da33f2.md`、`20261001T191028Z-9ad115a.md`、`20261002T040044Z-9f069dd.md`、`20261002T060718Z-f36144a.md`，以及十個 M1 檔案 server/member.ts、src/world/memberName.ts、src/world/member.ts、src/world/MemberPanel.tsx、migrations/0006_members.sql、tests/member.test.mjs、tests/member-client.test.mjs、tests/fixtures/member-panel.mjs、scripts/member-moderate.mjs、docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md。十個 M1 檔案中八檔有註解或證據文字遮蔽；MemberPanel.tsx 與 member-panel fixture 原樣保留。

## 這份清單會揭露的內容

- 六個 migrations，包括 0006 的全部八張表：members、wallet_identities、member_profiles、nickname_claims、profile_requests、profile_history、economy_accounts、life_state。後兩表的欄位、約束、預設值及初始化／讀取程式保留，註解遮蔽並未隱藏它們。詳見 [DATA_SCHEMA.md](DATA_SCHEMA.md)。
- M1 會員與公開玩家名稱行為、與錢包地址的查詢關係、冷卻／保留及人工處置流程。MemberPanel.tsx:61 的既有 UI 文字仍公開；名稱查詢不回會員內部 id 或登入紀錄。
- 公開名冊 fixture 的錢包地址、公開合約地址、端點、站點網址與 synthetic 測試字串；文件沒有將地址與特定人的身分連結。
- 十五份部署證據的 source commit、版本識別、部署時間、bundle／前端雜湊、migration、limiter 與 WAF 描述。人工填寫的正式設定及套用狀態屬部署方自述；最新 0006 原始 SHA-256 已以 ORIGINAL-BLOB-WITHHELD 遮蔽，公開副本 SHA-256 可核對。

## 保留內容與資料包說明

512 個保留 source 檔只提供清單及允許公開的完整性標記；檔名仍可見，包括 DESIGN_M1。文件本體、內部規格及未公開規劃不公開。保留的 3D／地形／美術／World 主畫面等使整站前端無法由此 subset 完整重建。

根目錄說明、manifests 與 TESTS 用於範圍、遮蔽、重現及證據。測試替身是受限支援材料，不是保留實作的替代版本；private review 手續檔、原始遮蔽文字／hash、私人 logs、正式資料及憑證未納入本包。E1 和 Mint 實作不含於本 World snapshot。

公開 subset 加替身為 341 tests、337 pass、4 fail；M1 聚焦 33/33 通過，詳見 [TESTS/README.md](TESTS/README.md)。部署比對為 **partial**；沒有正式 D1、本版真實錢包或完整 3D 前端的實測證據。
