## Current candidate: Audit2 Medium remediation

Product source: `d4b897e9cc1f3b066517e4abd276d67a95e72768`. Previous accepted report: job `17fb18b0-3f81-4545-aabe-fe3316b73e64`, public `5a9e8f74a4b8f6c9cedf7e661d3c683c5af311c0`, product `6732aa3f75971a3ecb371dfaf9a7adcff77b7cb2`: **2 Medium + 2 Info**. That report does not review this revision.

This candidate addresses only the two Medium mechanisms: durable invalid-position withdrawal halt in direct/staged ingestion, plus controlled earlier-start recovery preserving halted/pending evidence; and scanner-independent physical payment classification/de-duplication, including shared payment contracts, backfill and explicitly deferred missing legacy owner registries. No Solidity, token rate, GOLD transfer, exchange, admin wallet or production enablement change. The two informational findings remain acknowledged and unchanged. Review the updated RECONCILIATION.md and the new economy-audit2-medium.test.mjs; do not infer a fresh external acceptance from local tests.

# Ember World EMBEO / GOLD economic module review

Status: local review candidate. This package does not establish a completed Swarm review, mainnet deployment, production enablement or payment authorization. Test success, audit admission and an accepted audit report are separate outcomes.

The requested review covers both the Solidity custody/payment contracts and the TypeScript ledger, finalized-chain ingestion, API authorization and browser transaction boundary. A Solidity-only report does not cover this integration. Use the immutable containing Git commit and the published path/size/SHA-256 manifest to identify the actual submitted bytes.

## Player rules

- Ethereum mainnet EMBEO is `0x2b82cdeb8477415d541799abb0cc48044c8ea5f3`, with 18 decimals. One staking share is exactly 100,000 EMBEO.
- Each deposit creates its own position. For each share held throughout a complete UTC calendar day, the wallet receives 1 nontransferable GOLD after that day is finalized and fully indexed. The interval is UTC 00:00 inclusive to the next UTC 00:00 exclusive. A midday deposit first qualifies on the next complete day; this is not a rolling 24-hour reward.
- Principal can be withdrawn in positive whole shares at any time. Shares withdrawn earn no GOLD for that UTC day. Remaining shares and already earned GOLD are retained. New shares do not inherit an older position's eligibility.
- GOLD belongs to the verified wallet address, not its editable display name. It has no player transfer, trading or redemption endpoint. World services may separately list GOLD and EMBEO prices; the reward ratio is not a currency exchange rate.
- Stake custody is separate from service revenue. Payments go through the independent immutable payment contract to treasury `0x1C651928150DADDDA9C2C040a9D4901d862f8eC4`. This receiver is necessary public protocol data; no unrelated administrator-wallet allowlist is included.

## Source boundary

New financial source is included byte for byte with an explicit manifest. Selected existing authentication, ownership, D1 interfaces and client lifecycle dependencies provide runnable context. They are not a claim that an old login audit covers these new fund flows.

World routing, scheduled synchronization, feature gating and Staking Hall entry integration are provided as zero-context new-change patches plus base/source hashes. The full World renderer, full Worker configuration and unrelated AI Market administrator code are excluded. Complete-World integration tests remain a separately measured private gate; the public selected-source tests must not be described as that full gate.

Portable contract build/test tooling is a documented projection: machine-specific dependency paths are replaced with pinned local package resolution, a verified official compiler payload and a public canonical-token artifact fixture. Contract source, compiler settings, ABI and bytecode must match the frozen financial candidate. Tooling changes and public-byte hashes must be recorded rather than called an unchanged full-project copy.

No player databases, wallet-name lists, production balances, keys, session/bridge credentials, VPS snapshots, R3/8958 state, private Git parents, World media or unrelated game content belong in this packet.

## Reproduction requirements

Use Node 24.x; the measured local host uses Node 24.19.0. Install only from each packet's exact lock using `npm ci --ignore-scripts --no-audit --no-fund`. Install lifecycle scripts are unnecessary for these selected tests and remain disabled. The portable contract package pins solc `0.8.37+commit.f401782d`, OpenZeppelin 5.4.0, ethers 6.15.0, Hardhat 3.19.0 and EDR 0.22.2. Compiler settings are Cancun, optimizer 200, viaIR false and metadata bytecode hash none. The verified official solc payload SHA-256 is `d73fead3cbc860438f56f4d1723677499cdef212d0f8890241748d2d5afc1c5f`.

The selected TypeScript tests require the pinned viem 2.56.9, noble curves 1.9.1 and TypeScript 5.9.3 packages, Node's native SQLite and the supplied SQL migrations. Contract journey tests also require the portable isolated EDR runtime and original-token ABI/creation/runtime fixture. Client tests compare the small browser ABI encoder against viem and the compiled contract interface. React component lifecycle fixtures execute the actual shipped component, including stale responses, disabled state, focus and cleanup.

Install dependencies in `world-source` and `contracts` using their unchanged exact locks and the command above, then run `npm test` from this packet's root. The root runner verifies selected source hashes, builds the portable contracts, checks the projection against its frozen baseline, runs contract tests, and explicitly selects the seventeen financial test files with bounded concurrency. `npm run test:financial` and `npm run test:contracts` run the individual stages. Use this root review runner: the preserved `world-source/package.json` contains original full-World build/deployment scripts whose source/media closure is intentionally absent. Do not use those scripts as public-package release gates.

The public file set excludes the full-Worker `economy-worker.test.mjs`; do not recreate it with a mocked implementation and label it equivalent. Publish a measured sanitized result receipt only after the exact portable public checkout passes. [LOCAL_TESTS.md](LOCAL_TESTS.md) records the current measured/pending boundary; no external audit pass follows from running a local command.

## Boundaries requiring review

- SIWE identifies a wallet and grants no token allowance. Each EMBEO operation is explicitly reviewed, with an exact allowance and a separate execution confirmation; insufficient nonzero allowance is reset explicitly. No automatic chain switching, account connection or transaction resend is part of the new controller.
- Each GOLD payment requires its own short-lived, canonical `personal_sign` message binding wallet, origin, order, service, amount, request and nonce. It does not authorize EMBEO or Permit. Debit, immutable journal, order fulfillment and nonce consumption must be atomic and replay safe.
- Only validated finalized events may advance positions or rewards. Review full contiguous header/receipt/log proof, bounded synchronization, staged progress, reorganization detection, durable halt and UTC settlement. Stale or unavailable indexing must not invent a zero balance or stop independent contract withdrawal.
- A numeric header obtained at an announced finalized height must have that complete finalized identity, including an optional witness's matching height. Bounded pages below that height still trust the configured provider's ancestry and log enumeration; this is not an independent cryptographic finality proof.
- Orders use opaque server-generated 256-bit IDs with wallet/request idempotence. The ID is not payment authority: exact contract, payer, order, receiver and amount matching still authorizes reconciliation. A chain block's whole-second timestamp may precede a same-slot quote's server milliseconds; fulfillment must not depend on that false clock ordering. Quote/challenge creation rechecks server time after reads and retains final SQL session/revocation/expiry guards.
- A separate minute cron advances financial indexing/settlement without running the existing fifteen-minute presence/session cleanup or consuming its identity/NFT budgets. One settlement invocation processes at most 64 positions and 32 wallets across its days, with persistent page progress and per-wallet carry. Fully closed positions are excluded from later days; older eligible intervals remain settleable.
- Oversized single blocks use persistent receipt-verification staging; staged rows have no economic effect until the whole block is verified and atomically folded. The 10,000-event engineering ceiling is not a gas-derived protocol guarantee: a legitimate block above it would stall cursor progress. Range/page bounds do not establish production throughput.
- Receipts may come from forwarders, constructor calls or batches. Their outer `from`/`to` is not the event owner or emitting contract; the pinned emitter, successful canonical receipt and exact matching event remain authoritative. Unrelated LOG0/data and large receipts must not invalidate another legitimate event. Contract accounts may accrue GOLD, while the current EOA-only payment authorization does not let them spend it.
- Pending sends bind the chain and pending nonce, are recorded before the wallet prompt, and are read back from browser storage. A same-origin Web Lock stays held through the prompt; a busy lock rejects instead of queuing a later send, and missing lock support fails closed. A wrong candidate hash cannot overwrite the intent. Replacement recovery requires matching sender/chain/nonce and canonical finalized inclusion; a different payload is reported as replacement rather than successful execution. Adopting another tab's intent clears an unrelated prepared plan. Original wallet-returned hashes retain ordinary mined confirmation, which is separate from finalized ledger credit.
- Unknown sends are never automatically resent. Hashless/legacy manual acknowledgement follows an explicit wallet-history check but cannot prove that every mempool or another device lacks a broadcast. Web Locks coordinate this origin and browser scope, not other profiles/devices/sites or independent wallet actions. Browser-data deletion, an incorrect acknowledgement, actual extension nonce overrides and replacement compatibility remain limits; storage failure stops sending.

## Known limits and release gate

Local EDR uses synthetic chain 31337 and public test identities. It is not a mainnet fork, real wallet signature, public-chain transfer, traffic/load test or live production reward distribution. Windows native EDR results do not prove every platform's native runtime. This recheck uses previously independently cold-installed physical dependencies through ignored local junctions; this round does not claim a new dependency installation. Exact locks remain unchanged. Read-only mainnet token checks are separate from deployment proof.

The contracts are immutable and provide no administrator rescue or automatic refund. Direct token transfers into a staking contract create no position; mistakes and forced assets may be unrecoverable. Exact token runtime/supply assumptions must remain true. The payment contract does not validate the server's catalogue or entitlement: the server must match its own wallet-bound order and exact payment event. Catalogue prices, service delivery policy and any refund process need their own explicit release configuration.

GOLD is a server ledger and depends on the configured database/operator and finalized-chain RPC/indexer. EOA/ECDSA sessions can authorize the new debit flow; ERC-1271 identities can read but are not silently granted payment authority. Mainnet deployment addresses, byte-for-byte deployed runtime with immutable bindings, treasury, finality policy, migration, ingestion catch-up and end-to-end user checks remain release gates.

The current production adapter selects one fixed RPC provider and trusts it to enumerate every matching log. Header/receipt consistency checks do not cryptographically prove that the provider omitted no event. An optional witness-header test seam does not prove log-set completeness. The thirty-two-wallet/sixty-four-position page bounds and staged receipts reduce work per invocation, while index/range scan cost, large batched receipt enumeration, final block folding, D1 quotas and the real Workers 50 ms CPU cap remain unmeasured production-capacity gates. The minute scheduler is not a promise of instantaneous rewards during backlogs or outages.

Require the actual accepted Swarm report at the immutable source pin, substantive findings/reproductions and explicit coverage of both Solidity and TypeScript. Fix material findings and obtain necessary follow-up review before enabling real staking, payment or GOLD issuance. Preserve the original token, original services, earlier review pins and rollback evidence.

## 中文範圍說明

本包送審的是新增 EMBEO 質押、付款與不可轉讓 GOLD 帳本，包含 Solidity 及 TypeScript 邊界；不能把舊登入審核或只看合約的報告當成整體通過。新增金融檔案以清單逐筆雜湊核對，World 接線只提供精確新增差異及來源雜湊，完整 World 的測試另保留。公開副本不包含真玩家資料、站主錢包名單、密鑰、完整 World 素材或私人 Git 歷史。只有完成公開候選重現、實際 Swarm 報告與部署前後核對，才可考慮正式開放。

## Remediation checkpoint

See AUDIT_FINDINGS.md for all six prior findings and limitations. The new SQL registry blocks unsafe reward repinning without rewriting historical balances. Completed signed GOLD retries remain idempotent after expiry. Payment replay now includes exact amount; the browser getter and regenerated artifacts match this ABI. Manual wrong-amount transfers still have no automatic refund. An expired pending quote requires explicit renewal. This source is not covered by the old accepted report.

## Controlled historical recovery and payment exceptions

Read world-source/docs/economy/RECONCILIATION.md and the new section of AUDIT_FINDINGS.md. The package adds independent positive-delta recovery, atomic reviewed-plan migration, same-payment-contract lineage, immutable payment cases and a local SQLite-copy tool. No new HTTP administrator or refund authority is added. Financial features remain disabled; this packet is not externally reviewed or deployed.
