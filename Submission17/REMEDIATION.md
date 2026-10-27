# Remediation of Swarm audit 1ac5269f (Submission16)

Prepared 2026-10-28. A record of what was changed, not a claim that anything is safe. Nothing here has been verified externally.

## 0. Scope and identity

- Previous review: job `1ac5269f` on Submission16 (World source `38a21a3`, public commit `f2f6340`): 6 Low, 3 Info. It found no path that credits GOLD without payment or before finality.
- This submission: World source `be7d3b0` (1 commit after `38a21a3`), **deployed as Worker `7dfe57a1-9917-4d36-87e5-159a8aa6d134` on 2026-10-27 17:18 UTC**.
- **No server code changed.** The uploaded Worker module `worker/index.js` (SHA-256 `df3dba9db9c5f807…`) is byte-identical to the one deployed from `38a21a3`. The changes are browser code (`src/world/`) and the deploy tool (`scripts/deploy.mjs`).
- The owner asked for the smallest fixes that do not create new problems.

## 1. What was done about each finding

| Finding | Fix | Where | Test |
|---|---|---|---|
| 1 Low: own hash under a LOWER nonce with this call's exact calldata → `TRANSACTION_MISMATCH` for ever | Under a lower nonce the wallet's own hash is accepted only for a **payment** with this call's exact calldata or exact `Paid` effect (the order id is used once and `EmbeoPayments.pay` reverts `OrderAlreadyPaid` on a second payment). A lower-nonce revert, stake, withdrawal or approval proves nothing about which send it was and stays refused. | `economyWallet.ts` `finishReceipt` (`lowerPayment`, `renumbered`) | `economy-wallet-recovery` "the wallet's own hash mined under another nonce …": lower identical payment, lower reverted identical payment, lower routed payment accepted; lower routed without effect, lower other call, lower revert of another call, lower identical stake, no nonce refused |
| 2 Low: renumbered send then sped up or cancelled → every pasted hash needs the stored nonce | `learnNonce`: when the wallet's pending copy (no block) of its **own** returned hash, from the same sender, reports a **higher** valid nonce, the stored intent learns it (under the intent lock and the intentId guard; best effort). Read on the first poll without a receipt and from the pending-copy branch. A tab still holding the old nonce takes the stored intent over (`PENDING_CHANGED`) instead of judging. | `economyWallet.ts` `learnNonce`, `waitReceipt`, `finishReceipt` | "a renumbered send that is sped up or cancelled …": speed-up confirmed, cancellation replaced, old nonce refused once learned, stale tab, never learned for lower/same/other sender/mined/other hash/malformed, failing lookup |
| 3 Info: own hash under a higher nonce, status 0x1 without data or effect → locked | Under a higher nonce the own hash is judged by the normal rules: confirmed with proof, otherwise a replacement after finality | `finishReceipt` (`renumbered`) | same test: "higher, routed without the effect", "higher, another call", not yet final → `TRANSACTION_NOT_FINALIZED` |
| 4 Low: pasted same-nonce speed-up of a routed payment judged "replaced" | `intendedEffect` is computed for every receipt; a non-own hash still goes through the finality and canonical-block checks | `finishReceipt` (`effect`) | "a routed transaction without exactly the intended effect …": pasted routed `Paid` → `TRANSACTION_NOT_FINALIZED`, then `confirmed`; without the effect still `replaced` |
| 5 Low: late note under a pasted hash never marked mined | The panel marks both `sentHash` and `hash` mined | `WorldGoldPanel.tsx` | `pending-gold-credit` "finding 5" (effect order replayed) |
| 6 Info: reload, then a pasted hash confirms the payment → no note | `state.paidOrder`: the order id from the intent's own pay calldata, set only for a payment judged done; the panel uses it when there is no plan | `economyWallet.ts`, `WorldGoldPanel.tsx` | "a payment confirmed after a reload names the order it paid …"; `pending-gold-credit` "finding 6" |
| 7 Low: NODE_OPTIONS preload rule bypassed (quotes, `--snapshot-blob`, `--openssl-config`) | NODE_OPTIONS is accepted only when every option (quotes removed) is `--max-old-space-size=N` (either spelling), `--enable-source-maps`, `--no-warnings` or `--no-deprecation` | `deploy.mjs` `buildEnvNames` | environment unit test |
| 8 Low: API host, account and Worker name chosen by the shell | `CLOUDFLARE_API_BASE_URL`, `CF_API_BASE_URL`, `CLOUDFLARE_COMPLIANCE_REGION`, `WRANGLER_API_ENVIRONMENT`, `WRANGLER_CI_OVERRIDE_NAME` refused by name; `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID` recorded by name in `manifest.targetEnv` (the operator sets the account this way; its value is not recorded) | `deploy.mjs` | environment unit test; `deploy` "clean" (name recorded, value absent) |
| 9 Info: lower-case `vite_*` refused on Windows | `VITE_` matched with case on every platform, like Vite's `loadEnv` | `deploy.mjs` `viteEnvNames` | environment unit test |

An independent review of the first draft found two Low issues, both fixed in the same commit: the lower direction first accepted any revert and any identical calldata (a stale hash of an older revert or stake would have released the intent at once); and a second tab that adopted the intent before the nonce was learned still judged by the old nonce. It also suggested accepting the underscore spelling of `--max-old-space-size` and a non-circular `targetEnv` test (done).

## 2. Left as they are

- **Finding 6, the purchase card:** after a reload, a payment confirmed through a pasted hash now gets its "+N crediting" in the top bar, but the purchase card (`purchaseStage`, which needs a plan) still shows review or expired. Display only; the ledger credits the order as usual.
- **A wallet returning another request's hash under a higher nonce:** judged a replacement after finality and released. This needs a wallet bug plus a concurrent send; for a payment the contract refuses a second payment of the order.
- **A lower-nonce own hash that is not a payment, and a lower nonce in the wallet's pending copy (not learned):** stay locked as before; a stale hash cannot be told apart. A player can clear this browser's site data to leave such a lock.
- Residuals from Submission16 section 2 (finding 2 of `351b0573`; hand-placed packages; git ignore configuration) are unchanged.

## 3. Evidence

- `evidence/full_suite_be7d3b0_summary.txt`: the suite the deploy tool ran just before the upload: 3,635 tests, 3,630 pass, 5 skipped (Windows symlink-privilege checks, pre-existing), 0 fail.
- `evidence/mutation_checks.md`: seventeen mutations (each fix undone once); each makes its test fail.
- `evidence/deploy_record_be7d3b0_manifest.json`: the deploy record.
- `evidence/production_state_20261028_be7d3b0.md`: checks after the deploy.

## 4. Not verified

- No external review of this commit.
- The GOLD-panel recovery block and the learned nonce have been exercised only by tests, not with a real wallet.
- No purchase with a real wallet since these deploys.
