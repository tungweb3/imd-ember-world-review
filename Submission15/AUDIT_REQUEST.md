# Audit request: remediation of Swarm audit 12e0525d (Submission14)

Prepared 2026-10-27. A request for review, not a claim that anything is safe. Nothing here has been verified externally.

## 0. Scope and identity

- Previous review: job `12e0525d` on Submission14 (World source `64396ae`, public commit `5f02679`): 5 Low, 1 Info. It found no path that credits GOLD before finality and no false accept in `intendedEffect`; the findings concern the display-only "+N crediting" note and the deploy tool.
- This submission: World source `fe8bc4b` (2 commits after `64396ae`), **deployed as Worker `d5335f94-8a74-44b2-bd3d-b2ff5d6a1f89` on 2026-10-27 04:52 UTC**.
- **No server code changed.** The uploaded Worker module `worker/index.js` (SHA-256 `df3dba9db9c5f807…`) is byte-identical to the one deployed from `64396ae`. The changes are browser code (`src/world/`) and the deploy tool (`scripts/deploy.mjs`).
- Public copy as before: selected source only, no Git history, 3D/media, data, backups or credentials ([REDACTIONS.md](REDACTIONS.md), [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json)).

## 1. What was done about each finding

| Finding | Fix | Where | Test |
|---|---|---|---|
| L-1 reverted routed payment held for finality, then "replaced" | The wallet's own routed hash mined with status 0x0 is judged `TRANSACTION_REVERTED` at once, like a direct send (its nonce and sender are bound before this point). Pasted or replacement hashes still wait for finality. | `src/world/economyWallet.ts` `finishReceipt` | `economy-wallet-recovery`: reverted with finalized false and true; pasted reverted hash still `TRANSACTION_NOT_FINALIZED` |
| L-2 note kept after a reload (plan null) | The failed payment's note is also dropped by the hash it was sent with; the wallet state keeps that hash (`sentHash`), so a pasted replacement hash does not hide it | `pendingGoldCredit.ts` `dropPendingCreditByHash`, `economyWallet.ts`, `WorldGoldPanel.tsx` | `pending-gold-credit` L-2; `sentHash` assertion in `economy-wallet-recovery` |
| L-3 cancelled / sped-up payment never ends the note | A note whose order is still unpaid 30 minutes after its quote expired is dropped, unless the wallet saw that payment mined (then only the 2 h cap applies, for a late-mined payment or a slow indexer) | `pendingGoldCredit.ts` `settlePendingCredits`, `markPendingCreditMined` | `pending-gold-credit` L-3 and "mined" tests |
| L-4 edit between the re-check and wrangler's bundling | After wrangler bundles and uploads, HEAD, `git status` and `.env*` are read a third time; any change marks the record `dirty:true`, `source.unchangedDuringUpload:false`, and the outcome failed (exit 1). The upload itself cannot be undone. | `scripts/deploy.mjs` | `deploy` "edited-while-uploading" |
| L-5 gitignored build inputs | A real deploy refuses: `VITE_*` shell variables (names only are printed), `NODE_ENV` other than production, a missing/pre-v2 `package-lock.json`, a `node_modules` without npm's install record, any locked package missing (except optional/devOptional for other platforms) or at another version or from another source (`resolved`/`integrity`), and any installed package the lockfile does not name. A dry run records them. | `scripts/deploy.mjs` | `deploy` "vite-env" and the L-5 unit test; the real repository passes |
| I-6 note dated in the future | A note dated more than 5 minutes ahead of the clock is ignored and removed on the next check | `pendingGoldCredit.ts` | `pending-gold-credit` I-6 |

Also: the `TRANSACTION_REPLACED` message no longer claims the GOLD will not be credited (a replaced routed transaction can still have paid) and no longer points to a button that may be hidden.

## 2. Changes

| Commit | What |
| --- | --- |
| `2aeac71` | The six findings above |
| `fe8bc4b` | Follow-ups from an independent review of `2aeac71`: `sentHash`; the "mined" mark; stricter dependency check (missing lockfile or install record is a refusal, source comparison, devOptional); `NODE_ENV`; `TRANSACTION_REPLACED` wording |

Files not in `source/` are unchanged since `Submission14/source/` (World `64396ae`) or `Submission13/source/` (World `ae1f640`).

## 3. Please attack

1. **L-1**: can a successful payment, approval, stake or withdrawal now be shown as reverted, or a send intent be released for a transaction that is not this intent's own (wrong nonce, sender, chain, or a wallet-local pending copy)? After a reverted approval or payment, does the flow recover without a stuck lock?
2. **Note lifecycle** (`pendingGoldCredit.ts`, `WorldGoldPanel.tsx`, `WalletBalanceHud.tsx`): every ending is now credited / reverted / replaced / never mined (after-expiry) / 2 h cap / future-dated. Is there still a case where "+N crediting" shows for a payment that cannot be credited, ends while a real payment is still on its way, or polls without bound? It remains display only: confirm nothing treats it as credit.
3. **Deploy tool**: false refusals on a clean deploy; anything uploaded that the record does not name. Known residual: an edit made while wrangler bundles and reverted before it exits is not seen; a file edited inside an installed package is not detected (see section 5).

## 4. Evidence

- `evidence/full_suite_fe8bc4b_summary.txt`: the suite the deploy tool ran just before the upload: 3,622 tests, 3,617 pass, 5 skipped (Windows symlink-privilege checks, pre-existing), 0 fail.
- `evidence/mutation_checks.md`: twelve mutations (each fix undone once); each makes its test fail.
- `evidence/deploy_record_fe8bc4b_manifest.json`: the deploy record (clean tree, unchanged during upload, no VITE_* or NODE_ENV, no dependency mismatch, dist and Worker hashes).
- `evidence/production_state_20261027.md`: checks after the deploy (identical Worker module, live bundles equal to the build, retired route still 404, cron ok, a local QA purchase run).

## 5. Not verified

- No external review of these two commits yet.
- No purchase with a real wallet since these deploys (the note was exercised with a synthetic wallet on the real purchase page).
- Deploy tool residuals: an edit made during wrangler's bundling and reverted before wrangler exits is not detected (the stronger design, bundling once and uploading that exact bundle with `--no-bundle`, is not done); a file edited inside an installed package at the locked version and source is not detected.
- Only MetaMask with smart-account routing and desktop Chrome were used for real transactions.
