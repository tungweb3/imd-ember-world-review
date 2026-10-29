# Submission21 — audit request

- This submission: World source `6be9ef3`, **not deployed**, one commit after `0727200` (Submission20, audited in job
  `e3e9b712`). Production registry `server/genesis-deployments.ts` is still empty, so every reservation is refused.
- The design of the Genesis GOLD ledger is in [Submission19/AUDIT_REQUEST.md](../Submission19/AUDIT_REQUEST.md), the
  per-token order in [Submission20/AUDIT_REQUEST.md](../Submission20/AUDIT_REQUEST.md); this file lists only what changed.
- The wallet lock is unchanged: the only failure of the full suite is the wallet-lock test on `server/world-gold.ts`
  (from `20b1d6a`, already in Submission19). `6be9ef3` changes no locked file.
- Files: `server/genesis-gold.ts`, `server/genesis-gold-reader.ts`, `tests/genesis-gold.test.mjs`.

## 1. Findings of audit e3e9b712

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Low | The cron page dropped every `MINT_SCOPE_MISMATCH`, so a wrong-chain RPC or a wrong registry `codeHash` left a deployment's holds stuck with nothing logged | Fixed: `reconcileGenesisDeployments` keeps every outcome (`out.push({deployment, outcomes})`). The page is the deployment's own, so the status can only come from the reader; `maintainGenesisGold` returns it like any other non-pending status, so `worker/app.ts` logs it. |
| 2 | Low | An exactly full page was taken as "more rows follow", costing one empty run per cycle | Fixed: the page query reads `limit + 1` rows, reconciles the first `limit`, and stores the last id as the cursor only when the extra row exists; otherwise `''`. |
| 3 | Low | Settlement never checked which token paid, so a hold naming imdUSD v1 could be consumed by a mint paid in v2 (same GOLD price) | Fixed in the reader: in the consumed branch the same receipt must hold at least one `Transfer(address,address,uint256)` log, not removed, emitted by `order.token`, with `topics[1]` = the order's wallet and `topics[2]` = the order's recipient, else `MINT_PROOF_CONFLICT` (the hold stays). `mintPaid` pulls the payment with `token.safeTransferFrom(msg.sender, paymentRecipient, amount)` and `msg.sender` is the order's wallet (it is in the signed digest). The amount is not compared: the contract already requires the exact per-token amount, and the World registry keeps one dollar `embeoCost`. |
| 4 | Info | `GENESIS_CRON_PAGE=8` counts orders, not RPC cost | Documented next to the constant (per-order RPC counts, about 480 releases per deployment per hour on the every-minute trigger). Not changed. |
| 5 | Info | The stored-order retry path was correct but untested for another account's or an invalid consent and for a changed token, goldCost, wallet or recipient | Tests added; deleting the stored-path `verifyConsent` call now fails a test (checked by mutation). |

## 2. Please attack

1. The Transfer check (finding 3): can a receipt satisfy it without the order's own token paying the order's wallet's
   money to the recipient (a token that emits a fake `Transfer`, a log of another contract, a batch with two orders, a
   Safe or ERC-4337 wallet where the payer is not the order's wallet)? Can it refuse a genuine paid mint, leaving the hold
   stuck?
2. The cursor (finding 2): with `limit + 1`, can an order be skipped, reconciled twice in one run, or starved across
   wraps, including when orders are inserted or settled between runs?
3. The cron outcomes (finding 1): can keeping `MINT_SCOPE_MISMATCH` make the cron fail, exceed its limits or log
   anything other than the order id and the code?
4. Anything in `6be9ef3` that releases or spends a hold that `0727200` kept.

## 3. Tests

`evidence/full_suite_6be9ef3_summary.txt`. `tests/genesis-gold.test.mjs` has 33 tests, all passing; new: the cron
path reports a wrong chain and a wrong code hash (finding 1), exactly one page and one page plus one (finding 2), a hold
refused by a receipt paid in V2, paid in USDC, with no payment, from another address or to another address and settled
by its own token's payment (finding 3), retries with another account's or an invalid consent and with a changed token,
goldCost, recipient or wallet (finding 5). The test chain now puts the payment `Transfer` in every paid receipt.

Mutation checks run on the private tree (not committed): deleting the stored-path `verifyConsent` call fails the finding 5
test; deleting the Transfer check fails the finding 3 test.

## 4. Not verified

- Nothing in `6be9ef3` has run in production or against mainnet. Sepolia's book is a separate copy.
- The Transfer check was tested on the JSON-RPC stand-in, not on a real Sepolia receipt.
