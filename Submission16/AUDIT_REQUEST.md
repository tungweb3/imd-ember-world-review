# Audit request: remediation of Swarm audit 351b0573 (Submission15)

Prepared 2026-10-27. A request for review, not a claim that anything is safe. Nothing here has been verified externally.

## 0. Scope and identity

- Previous review: job `351b0573` on Submission15 (World source `fe8bc4b`, public commit `37e6afd`): 9 Low, 4 Info. It found no path that credits GOLD without payment or before finality.
- This submission: World source `38a21a3` (1 commit after `fe8bc4b`), **deployed as Worker `eb8f9da9-825d-4029-aa44-9c1ecfad08e4` on 2026-10-27 09:33 UTC**.
- **No server code changed.** The uploaded Worker module `worker/index.js` (SHA-256 `df3dba9db9c5f807…`) is byte-identical to the one deployed from `fe8bc4b` and `64396ae`. The changes are browser code (`src/world/`) and the deploy tool (`scripts/deploy.mjs`).
- The owner asked for the smallest fixes that do not create new problems. Three findings were deliberately left (section 2).
- Public copy as before: selected source only, no Git history, 3D/media, data, backups or credentials ([REDACTIONS.md](REDACTIONS.md), [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)).

## 1. What was done about each finding

| Finding | Fix | Where | Test |
|---|---|---|---|
| 1 Low: unmined note dropped 30 min after expiry while a late payment is on its way | The after-expiry margin is 60 minutes (covers a late inclusion plus finality); the 2 h cap still bounds every note | `pendingGoldCredit.ts` `PENDING_CREDIT_AFTER_EXPIRY_MS` | `pending-gold-credit` "finding 1" (mined at E+25 min, kept at E+30 and E+39, booked at E+40) |
| 3 Low: own hash mined under another nonce → `TRANSACTION_MISMATCH` for ever | The nonce equality check now runs after `same`/`effect` are known. A v2 record with another nonce is accepted only for the wallet's own returned hash, under a **higher** nonce (renumbering only moves up), carrying this call's exact calldata (`same`) or exact intended effect, or reverted. A lower or missing nonce (an older transaction, e.g. a stale hash) and every pasted hash still need the intent's nonce. | `economyWallet.ts` `finishReceipt` | `economy-wallet-recovery` "own hash mined under another nonce": routed/direct/reverted accepted; no effect, another call, lower nonce (identical payment, reverted, routed), no nonce, and a pasted hash refused |
| 4 Low: failed payment prompt after an approval keeps the approval hash; no acknowledgement in the GOLD panel | `send()` clears `hash` and `sentHash` when a new send starts; the GOLD panel offers the staking pane's hashless acknowledgement (`clearUnknownAfterWalletCheck`) | `economyWallet.ts` `send`; `GoldPurchase.tsx`, `WorldGoldPanel.tsx` | `economy-wallet-recovery` "a payment prompt that fails after an approval"; `pending-gold-credit` "findings 4 and 5" |
| 5 Low: no replacement-hash input in the GOLD panel | The panel shows the staking pane's paste form (original, cancellation or speed-up hash → `checkReceipt(hash)`, which keeps its nonce, sender, chain and finality checks) whenever the wallet state is `unknown` | `GoldPurchase.tsx`, `WorldGoldPanel.tsx` | `pending-gold-credit` "findings 4 and 5" |
| 6 Low: 2 h cap defeated while the panel stays open | The tracking effect runs once per (order, hash, phase): a refresh no longer re-creates an aged-out note; a payment confirmed late (after its unmined note ended) still gets one note, ended by its own cap | `WorldGoldPanel.tsx` | `pending-gold-credit` "finding 6" (source assertion) |
| 7 Low: node_modules checked only at the start | Re-checked after the build (refusal, nothing uploaded) and after the upload (record `dirty:true`, `source.dependenciesAfter`, exit 1) | `scripts/deploy.mjs` | `deploy` "deps-added", "deps-while-uploading" |
| 8 Low: CLOUDFLARE_ENV, WRANGLER_BUILD_*, NODE_OPTIONS pass through | A real deploy refuses, by name only, a non-empty `CLOUDFLARE_ENV`, `WRANGLER_ENV`, `WRANGLER_BUILD_*`, and a `NODE_OPTIONS` that preloads code (`--import`, `--require`/`-r`, `--loader`, `--experimental-loader`); a dry run lists them in `manifest.buildEnv`. Case-sensitive except on Windows. | `scripts/deploy.mjs` `buildEnvNames` | `deploy` "cloudflare-env" and the environment unit test |
| 10 Info: `sentHash` survives into the next intent | `initial()` (and the panel's empty state) has `sentHash:null` | `economyWallet.ts`, `WorldGoldPanel.tsx` | `economy-wallet-recovery` "a new intent starts without the previous sent hash" |
| 11 Info: `vite_*` refused on Linux | The `VITE_` prefix is matched with case except on Windows (whose variable names have none) | `scripts/deploy.mjs` `viteEnvNames` | environment unit test (win32 and linux) |
| 12 Info: `link:true` lockfile entry → "undefined locked" | Link entries are skipped (the repository has none) | `scripts/deploy.mjs` `dependencyMismatches` | dependency unit test "link" |

An independent review of the first draft found four issues, all fixed in the same commit: the nonce exception first accepted any other nonce (now only higher); a routed own hash reverted under a renumbered nonce stayed locked (now judged reverted); the once-per-payment guard blocked the late-confirmation note (phase added to the key); the new environment names were matched without case on every platform.

## 2. Not changed, and why

- **2 Low (own hash with status 0x0 judged before finality).** Left as the documented tradeoff the report describes: holding the intent until finality would change the core receipt flow L-1 just settled, and a post-merge mainnet reorg that turns a reverted transaction into a successful one is rare. Open to a reviewer's view on whether the narrower variant (keep only the do-not-pay-again lock until finality) is worth its complexity.
- **9 Low (hand-placed package directories invisible to the dependency check)** and **13 Info (.git/info/exclude, global excludes, skip-worktree)**. Both need write access to the operator's own checkout or git configuration; walking `node_modules` or replacing git's ignore rules risks false refusals of clean deploys. Recorded as residuals of what the deploy record can claim.

## 3. Please attack

1. **Finding 3**: can the renumbered-nonce exception confirm or release an intent for a transaction that is not this intent's own (another tab's send, a later transaction with the same calldata, a wallet returning a hash for a different request)? Is "higher nonce + exact calldata or exact effect or reverted" sufficient?
2. **Findings 4 and 5**: can the new GOLD-panel acknowledgement clear an intent that did broadcast, other than by the player's own false acknowledgement (as in the staking pane)? Can the paste form release an intent for a hash that is not a same-nonce replacement? Does clearing `hash` at the start of a send break any state that reads it between approval and payment?
3. **Findings 1 and 6**: is there still a case where "+N crediting" shows for a payment that cannot be credited, ends while a real payment is on its way, or lasts beyond the 2 h cap?
4. **Deploy tool**: false refusals of a clean deploy (Windows and Linux); anything uploaded that the record does not name, besides the residuals in section 2 and Submission15's.

## 4. Evidence

- `evidence/full_suite_38a21a3_summary.txt`: the suite the deploy tool ran just before the upload: 3,631 tests, 3,626 pass, 5 skipped (Windows symlink-privilege checks, pre-existing), 0 fail.
- `evidence/mutation_checks.md`: eleven mutations (each fix undone once); each makes its test fail.
- `evidence/deploy_record_38a21a3_manifest.json`: the deploy record (clean tree, unchanged during upload, no VITE_*, build-environment variables, NODE_ENV or dependency mismatch, dist and Worker hashes).
- `evidence/production_state_20261027_38a21a3.md`: checks after the deploy (identical Worker module, live JS/CSS equal to the build, retired route still 404, cron ok).

## 5. Not verified

- No external review of this commit yet.
- The new GOLD-panel recovery block has been exercised only by rendering tests, not with a real wallet in an unknown state.
- No purchase with a real wallet since these deploys.
- Only MetaMask with smart-account routing and desktop Chrome were used for real transactions.
