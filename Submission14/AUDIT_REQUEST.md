# Audit request: remediation of Swarm audit e4a57f91 (Submission13) and the follow-up changes

Prepared 2026-10-27. A request for review, not a claim that anything is safe. Nothing here has been verified externally.

## 0. Scope and identity

- Previous review: job `e4a57f91` on Submission13 (World source `ae1f640`, public commit `8027166`): 1 Medium, 6 Low, 1 Info, all in GOLD fast credit except I-8.
- This submission: World source `64396ae` (4 commits after `ae1f640`), **deployed as Worker `40c6477f-f6af-491c-91c8-8e6bbd35dac2` on 2026-10-27 03:37 UTC (fast credit had been switched off at 325f040, Worker `c927a5ae`)**.
- Public copy as before: selected source only, no Git history, 3D/media, data, backups or credentials ([REDACTIONS.md](REDACTIONS.md), [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) with private blob ids).

## 1. What was done about each finding

The owner's decision (2026-10-27), after reading L-7: credit top-ups **only at finality** again (~15 minutes after payment). GOLD spent before finality on a payment that is later reorged out cannot be recovered off chain, which no rate limit or debt rule fully fixes. Fast credit was switched off in production (secret `GOLD_FAST_CREDIT` deleted; at that moment the production ledger held exactly one fast credit, already `settled`, and no debt), and is now removed from every entry point.

| Finding | Status | Where |
|---|---|---|
| M-1 maintainFastGold 16-row window | **Closed: the tick is removed** (no credit can be created, the only one is settled) | `worker/app.ts` maintainGold |
| L-2 debt window | Closed: same tick removed; there are no debts | `worker/app.ts` |
| L-3 revert/collect read outside the batch | Closed: revert and collection no longer run | `worker/app.ts` |
| L-4 shared `economy:fast` budget | Closed: the route and the `economy:fast` key are gone | `server/world-gold-api.ts`, `worker/app.ts` |
| L-5 LOG0 in the fast receipt parser | Closed: `economyReceiptPayment` is no longer reachable from any route | `server/economy-rpc.ts` (unchanged, unused by the Worker) |
| L-6 expired order accepted | Closed: the route is gone (`/api/gold/orders/{id}/fast-credit` answers 404 before budget, session or chain reads) | `server/world-gold-api.ts` |
| L-7 debt binds only the wallet | Closed by design: GOLD is credited only after finality | browser + route + tick |
| I-8 `intendedEffect` used `logs.some` | **Fixed**: exactly one event of the intended kind for this sender from the intended contract, carrying this call's arguments | `src/world/economyWallet.ts` |

Kept on purpose: `server/world-gold-fast.ts` (its `fastSettleStatements` still runs inside ordinary reconciliation and is a no-op without a `credited` row), migration `0021` tables and triggers (the debt triggers still guard spending, history stays readable), and the recovery equation including fast entries. Please confirm that nothing left can create a `world_gold_fast_credits` row.

## 2. Changes

| Commit | What | Money / identity relevance |
| --- | --- | --- |
| `8161565` | `scripts/deploy.mjs`: after tests and build, re-check `git status` and HEAD before uploading (the 40e97f4 incident) | Release integrity |
| `8cb7d66` | Browser stops asking for fast credit; top-ups are credited at finality; gold "+N 入帳中" note (`pendingGoldCredit.ts`) in the top bar and the purchase page with the expected time; I-8 exact-one rule in `intendedEffect` | **Credit timing; wallet receipt acceptance** |
| `325f040` | Test: routed withdrawal needs exactly its `Withdrawn` event (position, shares, sender) | Principal withdrawal |
| `64396ae` | Fast-credit route and minute tick removed from the Worker; note fixes from an independent review (payment hash only, drop on reverted/replaced, cross-tab sync, immediate check); deploy also re-checks gitignored `.env*` after the build | **Removes the fast-credit money path** |

Removed files: `src/world/fastGoldCredit.ts` (browser follower), `tests/fast-gold-client.test.mjs`. Files not in `source/` here are unchanged since Submission13 (`Submission13/source/`), notably `server/world-gold-fast.ts`, `server/world-gold.ts`, `server/economy-rpc.ts`, `migrations/0021_world_gold_fast_credit.sql`.

## 3. Please attack

1. **Finality-only GOLD**: can any route, cron or admin path still credit a top-up before the finalized indexer marks the order paid? Is anything in the remaining fast-credit code reachable?
2. **I-8 fix** (`intendedEffect`): false accepts or false rejects for approve / pay / deposit / withdraw through an EIP-7702 / MetaMask Delegation Manager batch. The owner's six real routed mainnet receipts (5 payments, 1 stake) still pass; extra or opposite events of the same kind for this sender now fail as "replaced".
3. **Pending note** (`src/world/pendingGoldCredit.ts`): a per-wallet localStorage note shown as "+N 入帳中" until the ledger books the order. It is display only. Can it ever be treated as credit, show for a payment never sent, survive a reverted/replaced payment, leak across wallets, or cause unbounded polling (30 s, only while a note exists, also across tabs)?
4. **Deploy tool**: after tests and build, `scripts/deploy.mjs` re-checks `git status`, HEAD and gitignored `.env*` files before uploading. Is there still a path that uploads something other than the recorded commit?

## 4. Evidence

- `evidence/full_suite_64396ae_summary.txt`: 3,615 tests, 3,610 pass, 5 skipped (Windows symlink-privilege checks, pre-existing), 0 fail.
- `evidence/mutation_checks.md`: each fix undone once; its test fails.
- `evidence/real_routed_receipts_check.txt`: the tightened `intendedEffect` over the owner's six real routed mainnet receipts: all accepted.
- `evidence/production_state_20261027.md`: ledger state at the switch-off (1 fast credit, settled; 0 debts; secret deleted) and the checks after each deploy.
- `evidence/deploy_record_325f040_manifest.json`, `evidence/deploy_record_64396ae_manifest.json`: deploy records (commit, clean tree, test/tsc/build results, dist and Worker bundle hashes) of Workers `c927a5ae` and `40c6477f`.
- Withdrawal: 26 existing withdrawal tests pass, including a real isolated EVM vault deposit then withdrawal and partial/full withdrawals at the UTC boundary; the "withdraw" button needs only a valid session and wallet, not the spending conditions.

## 5. Not verified

- No external review of these changes yet.
- The pending note has been exercised in a local QA page with a synthetic wallet, not with a real wallet purchase after this deployment.
- The fast-credit library and 0021 triggers are kept; their removal would need a migration and is not proposed now.
- Only MetaMask with smart-account routing and desktop Chrome were used for real transactions.
