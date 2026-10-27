# Audit request: remediation of Swarm audit 1ac5269f (Submission16), final review of what is live

Prepared 2026-10-28. A request for review, not a claim that anything is safe. Nothing here has been verified externally.

## 0. Scope and identity

- Previous review: job `1ac5269f` on Submission16 (World source `38a21a3`, public commit `f2f6340`): 6 Low, 3 Info. It found no path that credits GOLD without payment or before finality.
- This submission: World source `96858bf`, **deployed as Worker `b08f59ef-0c80-4632-a4f3-f96e9c0cbb01` on 2026-10-27 18:28 UTC**. Two commits after `38a21a3`:
  - `be7d3b0` — the remediation (browser wallet controller, GOLD panel, deploy tool). Also published as Submission17.
  - `96858bf` — page wording only: the Chinese word 購點 ("top-up") became 購買點數 ("buy points") in the GOLD purchase text, error messages, the research pass card, the Celestao checkout and the local preview, plus the two test assertions that read them. No logic, key or condition changed.
- **No server code changed.** The uploaded Worker module `worker/index.js` (SHA-256 `df3dba9db9c5f807…`) is byte-identical to the one deployed from `38a21a3`. No Solidity changed.
- The owner asked for the smallest fixes that do not create new problems. Public copy as before: selected source only ([REDACTIONS.md](REDACTIONS.md), [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)).

## 1. What was done about each finding (be7d3b0)

| Finding | Fix | Where | Test |
|---|---|---|---|
| 1 Low: own hash under a LOWER nonce with this call's exact calldata → `TRANSACTION_MISMATCH` for ever | Under a lower nonce the wallet's own hash is accepted only for a **payment** with this call's exact calldata or exact `Paid` effect (the order id is used once and `EmbeoPayments.pay` reverts `OrderAlreadyPaid` on a second payment). A lower-nonce revert, stake, withdrawal or approval stays refused. | `economyWallet.ts` `finishReceipt` (`lowerPayment`, `renumbered`) | `economy-wallet-recovery` "the wallet's own hash mined under another nonce …" |
| 2 Low: renumbered send then sped up or cancelled → every pasted hash needs the stored nonce | `learnNonce`: when the wallet's pending copy (no block) of its **own** returned hash, from the same sender, reports a **higher** valid nonce, the stored intent learns it (under the intent lock and the intentId guard; best effort). Read on the first poll without a receipt and in the pending-copy branch. A tab still holding the old nonce takes the stored intent over (`PENDING_CHANGED`) instead of judging. | `economyWallet.ts` `learnNonce`, `waitReceipt`, `finishReceipt` | "a renumbered send that is sped up or cancelled …" |
| 3 Info: own hash under a higher nonce, status 0x1 without data or effect → locked | Under a higher nonce the own hash is judged by the normal rules: confirmed with proof, otherwise a replacement after finality | `finishReceipt` (`renumbered`) | the finding 1 test ("higher, …") |
| 4 Low: pasted same-nonce speed-up of a routed payment judged "replaced" | `intendedEffect` is computed for every receipt; a non-own hash still needs the intent's nonce and passes the finality and canonical-block checks | `finishReceipt` (`effect`) | "a routed transaction without exactly the intended effect …" |
| 5 Low: late note under a pasted hash never marked mined | The panel marks both `sentHash` and `hash` mined | `WorldGoldPanel.tsx` | `pending-gold-credit` "finding 5" |
| 6 Info: reload, then a pasted hash confirms the payment → no note | `state.paidOrder`: the order id from the intent's own pay calldata, set only for a payment judged done; the panel uses it when there is no plan | `economyWallet.ts`, `WorldGoldPanel.tsx` | "a payment confirmed after a reload names the order it paid …"; `pending-gold-credit` "finding 6" |
| 7 Low: NODE_OPTIONS preload rule bypassed | NODE_OPTIONS is accepted only when every option (quotes removed) is `--max-old-space-size=N` (either spelling), `--enable-source-maps`, `--no-warnings` or `--no-deprecation` | `deploy.mjs` `buildEnvNames` | environment unit test |
| 8 Low: API host, account and Worker name chosen by the shell | `CLOUDFLARE_API_BASE_URL`, `CF_API_BASE_URL`, `CLOUDFLARE_COMPLIANCE_REGION`, `WRANGLER_API_ENVIRONMENT`, `WRANGLER_CI_OVERRIDE_NAME` refused by name; `CLOUDFLARE_ACCOUNT_ID` / `CF_ACCOUNT_ID` recorded by name in `manifest.targetEnv` (the operator sets the account this way; its value is not recorded) | `deploy.mjs` | environment unit test; `deploy` "clean" |
| 9 Info: lower-case `vite_*` refused on Windows | `VITE_` matched with case on every platform, like Vite's `loadEnv` | `deploy.mjs` `viteEnvNames` | environment unit test |

An independent review of the first draft found two Low issues, both fixed in `be7d3b0`: the lower direction first accepted any revert and any identical calldata (a stale hash of an older revert or stake would have released the intent at once), and a second tab that adopted the intent before the nonce was learned still judged by the old nonce.

## 2. Left as they are

- **Finding 6, the purchase card:** after a reload, a payment confirmed through a pasted hash gets its "+N crediting" in the top bar, but the purchase card (`purchaseStage`, which needs a plan) still shows review or expired. Display only.
- **A wallet returning another request's hash under a higher nonce:** judged a replacement after finality and released. Needs a wallet bug plus a concurrent send; for a payment the contract refuses a second payment of the order.
- **A lower-nonce own hash that is not a payment, and a lower nonce in the wallet's pending copy (not learned):** stay locked as before; a stale hash cannot be told apart. Clearing the site's browser data leaves such a lock.
- Residuals from Submission16 section 2 (finding 2 of `351b0573`; hand-placed packages; git ignore configuration) are unchanged.

## 3. Please attack

1. **Findings 1 and 3** (`finishReceipt`): can `renumbered` confirm or release an intent for a transaction that is not this intent's own, beyond the wallet-bug case in section 2? Is "lower nonce only for a payment with exact calldata or effect" safe given `paid()` in `inspect()` and `OrderAlreadyPaid`?
2. **Finding 2** (`learnNonce`): can the learned nonce be wrong (another tab's send, a wallet's copy of another transaction, a race with `finishReceipt` or `clearUnknownAfterWalletCheck`), and can that release an intent or create a new permanent lock?
3. **Finding 4**: does computing the effect for pasted hashes let any pasted hash confirm something it should not, now that only the nonce, sender, chain, finality and canonical-block checks stand between it and `confirmed`?
4. **Findings 5 and 6**: is there now a "+N crediting" for a payment that cannot be credited, for the wrong order, or beyond the 2 h cap?
5. **Deploy tool**: false refusals of a clean deploy (Windows and Linux, with `CLOUDFLARE_ACCOUNT_ID` set as the operator does), or anything uploaded that the record does not name.
6. **96858bf**: confirm the wording commit changes text only.

## 4. Evidence

- `evidence/full_suite_96858bf_summary.txt`: the suite the deploy tool ran just before the upload of `96858bf`: 3,635 tests, 3,630 pass, 5 skipped (Windows symlink-privilege checks, pre-existing), 0 fail. The same counts were measured for `be7d3b0` (Submission17).
- `evidence/mutation_checks_be7d3b0.md`: seventeen mutations of `be7d3b0` (each fix undone once); each makes its test fail.
- `evidence/deploy_record_96858bf_manifest.json`: the deploy record.
- `evidence/production_state_20261028_96858bf.md`: checks after the deploy (identical Worker module, live JS/CSS equal to the build, retired route 404, cron ok).
- `evidence/real_purchase_20261028.md`: the first real-wallet top-up since the finality change: paid at 18:04:23 UTC, credited at 18:18:30 UTC, with the crediting note shown meanwhile.

## 5. Not verified

- No external review of `be7d3b0` or `96858bf`.
- The GOLD-panel recovery block and the learned nonce have been exercised only by tests, not with a real wallet.
- Only MetaMask with smart-account routing and desktop Chrome were used for real transactions.
