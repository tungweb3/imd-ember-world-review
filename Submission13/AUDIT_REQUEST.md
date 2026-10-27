# Audit request: World wallet, GOLD and staking changes of 2026-10-26 (incl. GOLD fast credit)

Prepared 2026-10-27 by the operator's World session. This is a request for review, **not** a claim that anything is audited or safe. Nothing here has been verified by an external party. The previous package (`swarm_audit_day_pass`, World at `6d982dd`) covered the research day pass and rule D; this one covers everything changed in the World repository **after** `6d982dd`, with the wallet and money paths as the focus.

## 0. Provenance you should know first

- On 2026-10-26 the operator's C: drive failed. The World source was **reconstructed** on D: from the 10-25 backup, the returned patches and the session transcripts (every edit replayed exactly). The reconstructed tree was checked against production: all 198 built frontend files were byte-identical to `imdember.com` except the Cloudflare Web Analytics beacon injected at the edge; the full test suite passed. The **Worker bundle could not be compared byte-for-byte** with the then-live version (no credentials at the time).
- Because of the reconstruction, **commit hashes in this package differ from the ones in earlier notes** for the same content: `a793c32→a3d5594`, `1a2b903→48ef107`, `d86e27c→bcda915`, `7a980ac→c190c38`, `e165591→6f5ff19`, `e78e4ef→ad01fd2` (the 10-26 line-ending commit `4ebd8cc` has no counterpart: the rebuilt tree is LF throughout).
- One deployment record does not match its commit exactly: record `20261026T182308Z-40e97f4` (Worker `85bbfb8c`) also shipped an **uncommitted wording edit** (`src/world/publicHalls/runtime.ts`), made while that deploy's tests ran; it was committed and deployed as `3cdaab1` six minutes later (identical `dist` hash). `scripts/deploy.mjs` checks for a clean tree only before testing; it does not re-check after the build. Suggested fix noted in section 7.
- This is the **public copy** in `tungweb3/imd-ember-world-review` (Submission13). Like the earlier submissions it is selected source, not the full private repository: no Git history, website 3D models/media, data, backups or credentials. What differs from the private repository blobs is listed in [REDACTIONS.md](REDACTIONS.md): patch author e-mails are `operator@imdember.invalid`; `source/wrangler.jsonc` masks the account comment and the Cloudflare account / D1 ids exactly as earlier snapshots did; the three miner films are withheld from `source/` and from the patches (their sizes and SHA-256 are listed, and pinned in `source/src/world/miningAssets.json`); the app shell `src/world/WorldApp.tsx` and the 3D public-hall runtime `src/world/publicHalls/runtime.ts` are withheld from `source/` (their changed hunks are in the patches).
- The public snapshot identity for the audit form is this repository's commit that contains `Submission13/` (`git rev-parse HEAD` of your checkout).

## 1. What is deployed

| Component | Running version | Source |
| --- | --- | --- |
| World Worker `imd-world` | `a718a392-9c68-459f-940a-fa3657a36d0b` (deployed 2026-10-26 21:15 UTC from `ae1f640`; earlier versions in `evidence/deploy_records_20261026.txt`) | this package's `source/` = `ae1f640` (`git rev-parse`: see `evidence/deploy_records_20261026.txt`) |
| D1 `imd-world` | migrations through `0021_world_gold_fast_credit.sql` | `source/migrations/0021_world_gold_fast_credit.sql` |
| Worker secret `GOLD_FAST_CREDIT` | `"1"` (new fast credits accepted) | unset = no new fast credits; existing ones still settle or revert |
| AIMarket VPS, Celestao | unchanged by this package | out of scope |

## 2. What changed (index; `patches/` has one file per commit plus `cumulative_6d982dd..ae1f640.diff`, both generated from the rebuilt base `c0b96c7` = content of `6d982dd`)

| Commit | Area | Money / identity relevance |
| --- | --- | --- |
| `a3d5594` | Wallet: MetaMask returns the pending nonce as a JSON number; accepted as a non-negative safe integer | Before: every MetaMask approve/pay/stake failed before the prompt |
| `48ef107` | GOLD panel / balances: read-only views compare sessions **by value**; GOLD signature prompt times out after 3 min; day-pass card refuses an order the wallet cannot pay | Display reads only; debit paths unchanged |
| `bcda915` | Sign-in recovery (re-read while the session is unknown), payment waits ~2 min, misc. shell fixes | `auth.ts` lifecycle |
| `c190c38` | Bridge limiter: AIMarket per-read session checks get their own 120/min budget (`BRIDGE_LIMITER`) | Rate limiting |
| `6f5ff19`, `ea72e92` | Opening film (no money) | — |
| `ad01fd2` | Economy wallet: a hash returned by the wallet counts as done when its receipt carries **exactly the intended effect** (Approval / Paid / Staked / Withdrawn, intended contract, this sender, this call's arguments) even if `to`/`input` differ (MetaMask Delegation Manager `0xdb9b…7db3`); a wallet-local pending copy (no block, no chainId) is polled again, not judged a mismatch | **Receipt acceptance logic — please review closely** |
| `2f7570d` | Explicit wallet pick keeps the session when the picked wallet's `eth_accounts` already grants the signed-in address (owner decision) | Session authority vs. wallet transport |
| `3cf9e16`, `b96738d`, `66565c7` | **GOLD fast credit** (section 3) | **New money path — main focus** |
| `60b9872`, `40e97f4`, `3cdaab1` | Wording, top-bar Buy button, layout | — |
| `b3118c9` | Wallet controller guard compares the session **by value** (address + expiry); the staking pane keys its reset on the same value | **Transaction authority check relaxed from object identity to value — please review** |
| `3e73767` | Staking pane: display-only "confirming" stake, 3D viewer removed, disabled-button reasons | Display only (section 4) |
| `380227d` | Miner films (owner-provided, re-encoded 720x720, no audio, hash-pinned) play for a running miner | Media only |
| `ae1f640` | Opening: a film paused at its end with no event no longer holds the ready World (2 s check) | No money |

## 3. GOLD fast credit (the new money path)

Goal: credit an EMBEO→GOLD top-up when its `Paid` event is in a **canonical block** (~12 s), instead of after finality (~15 min). The finalized indexer stays the only writer of `economy_orders.status` and of every existing journal.

```
browser: wallet returns payment hash -> POST /api/gold/orders/{id}/fast-credit {transactionHash}   (hash only; own per-IP budget)
Worker:  fastCreditTopup -> economyReceiptPayment (indexer's own log/receipt/header parser, server RPC):
           status=1, header at receipt.blockNumber has receipt.blockHash, exactly one Paid for this order id from the
           payment contract, token/treasury as configured, payer = order wallet, amount = order amount
         -> one D1 batch: write-check (order pending, top-ups enabled, not halted, not replaced, no fast credit for this
            order or this tx+logIndex) + INSERT world_gold_fast_credits(credited) + INSERT fast entry +gold
minute tick: maintainFastGold: re-included in a later block (cursor not past it) -> move; finalized cursor passed the
             block and the order is still unpaid and the receipt is now absent/failed/mismatched -> revert (take what is
             available, record the rest as a debt that blocks GOLD service payments and mint holds; later credits repay
             it); canonical but unpaid at finality -> reported, never reverted by guess; RPC outage -> retry, never revert
reconcileWorldGold / admin repair-topup: ordinary top-up entry +gold and fast-settle −gold in the same batch (net 0)
```

SQL guards (migration 0021) enforce: fast credit only for a pending EMBEO top-up of the same wallet and exact quoted GOLD; one per order and per (tx, logIndex); transitions credited→settled only when the order is paid, credited→reverted only while pending; settle requires the ordinary top-up entry for the full quote in the same batch; entries immutable; debts only shrink through their own collect entries; `balance = journal + world entries + fast entries` (recovery includes fast entries).

Please attack:
1. Can a fast credit be obtained without a real payment of that exact order (forged/foreign receipt, another order's `Paid` in the same tx, a log from another contract, a wallet-local pending copy, a non-canonical block, a reorg race between verification and the batch)?
2. Can one payment be credited twice (fast + finalized; two orders; settle not running; repair-topup path; concurrent requests)?
3. Revert path: wrong reverts (finality cursor semantics, `halted`, re-inclusion after revert), debt math, debt bypass (any GOLD spend path not covered by the two triggers).
4. Availability: can the endpoint be abused to burn the RPC budget (`ECONOMY_CHAIN_LIMITER` key `economy:fast`, 600/min shared across clients) or to block the indexer?
5. Trust in the single RPC provider (production passes no witness RPC; the finalized indexer has the same single-provider trust, but fast credit acts before finality).

## 4. Session comparison by value (b3118c9) and wallet pick (2f7570d)

- `sameSession(a,b)` = same lowercase address and same `expiresAt`. The auth client creates a new session object on every routine re-read (focus, other tab, ~60 s owner re-check). Object identity made any approve-then-stake longer than a minute fail. A new sign-in has a new expiry; another wallet has a different address; the provider object and `state.account` are still identity/equality checked in the guard.
- `EconomyClient.guard` (GOLD challenge / payGold / snapshot) **still uses object identity** — deliberately unchanged; each call is short and captures the session at call time.
- Question: is value equality sufficient for transaction authority, or can two distinct server sessions share address and `expiresAt` (millisecond expiry from sign-in)?
- Wallet pick: the picked provider is asked `eth_accounts` (never a prompt); same address and no in-flight sign-in/retained flow → keep the session; locked / empty / other address / intervening event → previous behaviour (cleanup). Is any authority leaked to a provider that merely *claims* the address? (It cannot sign for it; the session itself was proven by SIWE earlier.)

## 5. Evidence (`evidence/`)

- `deploy_records_20261026.txt`: every World deployment of 2026-10-26 with commit, Worker version id, `worker/index.js` and `dist` SHA-256, test status (each deploy re-ran the full suite).
- `full_suite_ae1f640_summary.txt`: 3,606 tests, 3,601 pass, 5 skipped (pre-existing), 0 fail; names and outcomes.
- `production_observations.md`: the owner's five real top-ups and one real stake, what failed and why, and the post-fix fast credit (≈5 s, settled at finality; balance equals the journal sum).
- Mutation checks (local, not in files): fast credit 7/7 deliberate regressions caught (no settle, any-error revert, revert canonical, revert before finality, no amount/payer check, no canonical check, debt not blocking); BigInt bind restored → 11 tests fail; session identity guard restored → the new same-value test fails; staking "confirming" record removed → its pane test fails.

## 6. Not verified / out of scope

- No external review of any of this. No load or adversarial testing against production.
- The fast-credit **revert / debt** paths have only run in tests; no real reorg was observed.
- Only one wallet (MetaMask with smart-account routing) and one browser (desktop Chrome, Windows) were used. Mobile, Safari, other wallets untested.
- Staking rewards for the new position (first expected 2026-10-28 00:00 UTC) not yet observed.
- AIMarket VPS, Celestao, Genesis Mint, contracts: out of scope.

## 7. Known weaknesses the operator already sees

- `scripts/deploy.mjs` should re-check the working tree (or hash the sources) after testing and building, so a record can never name a commit that differs from what shipped (section 0).
- Fast-credit polling is client-driven; a payer who closes the page immediately still gets credit only at finality (by design).
- `MinerMedia` no longer uses the 3D viewer; the GLB models and `miningViewer.ts` remain in the repository (unused by the page) and can be removed later.

## 8. Reproduce

This public copy is for reading: `source/` holds only the changed files, so it does not build or run by itself. In the full private checkout, Node 24: `npm ci && npm test`, `npx tsc --noEmit`. Fast credit: `tests/world-gold-fast.test.mjs`, `tests/fast-gold-client.test.mjs`. Wallet: `tests/economy-wallet-recovery.test.mjs`, `tests/economy-client.test.mjs`, `tests/auth-audit8.test.mjs`, `tests/wallet-client.test.mjs`, `tests/session-compare.test.mjs`. About 10 native-chain tests (`economy-forwarder`, `economy-journey`, `mining-native`, `world-gold-native-journey`, `world-gold-audit5/6`) need the sibling workspaces of the full checkout: the pinned solc/ethers/OpenZeppelin packages (path set in `genesis-candidate-2026-10-12-r2/.rd/runtime.config.private.json`, `dependencyRoot`), the contract artifacts in `world-economy-2026-10-16/contracts/artifacts`, and writable `release/` and `.rd/recheck-2026-10-16/ledger/` folders next to `source/`. Without them those files fail at load time, not on an assertion.

## 9. Rollback / emergency stop

- Stop new fast credits: `wrangler secret delete GOLD_FAST_CREDIT` (existing fast credits still settle or revert every minute).
- Worker rollback: `wrangler rollback <previous version id>` (ids in `evidence/deploy_records_20261026.txt`). Migration 0021 is additive; rolling the Worker back leaves its tables unused (a pre-0021 Worker does not settle fast credits — stop new fast credits first and let existing ones settle).
