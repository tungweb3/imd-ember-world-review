# Submission22: remediation of Swarm audit 93dae57f

The audit reviewed Submission21 (World `6be9ef3`) at public commit `7024d8f` and reported 2 Low. Both are fixed in
`7d09bda`. Nothing is deployed, and the production registry `server/genesis-deployments.ts` is still empty.

## 1. Findings and what changed

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Low | The payment check accepted any `Transfer` of the order's token from the wallet to the recipient, whatever its amount. A 0 or 1-wei `Transfer` of imdUSD v1, batched next to a mint paid in v2, settled a v1 hold. | Fixed. Every registry token now names the exact amount `mintPaid` charges, in the token's smallest unit: `paymentAmount` for `paymentToken`, and `amount` for each entry of `addedTokens`. Both are read back from `paymentTokens(token)` (the low 128 bits) before an entry is added. `pinnedDeployment` refuses an entry that lacks either amount or has a zero or malformed one. The reader accepts only a `Transfer` whose `data` is exactly one 32-byte word equal to that amount. A receipt with only a 0, 1-wei, USDC-sized or off-by-one `Transfer` of the order's token stays held with `MINT_PROOF_CONFLICT`. |
| 2 | Low | A code-hash mismatch was never cached, so every order of a cron page fetched and hashed the 24 KB bytecode again. | Fixed. The reader remembers the outcome of the code check for the finalized block, mismatch included. A page of 8 orders against a wrong `codeHash` makes one `eth_getCode` call and still reports `MINT_SCOPE_MISMATCH` for every order. A non-string `eth_getCode` answer is still `MINT_SCOPE_MISMATCH` and is not cached. |

## 2. Tests

- `tests/genesis-gold.test.mjs`: 35 tests, all passing (33 before). The new tests:
  - **Finding 1:** a v2 payment next to a 0, 1-wei, 20 USDC-sized or 20e18 + 1 `Transfer` of v1 stays held. The exact 20e18 v1 payment settles. The registry rejects an entry without amounts, or with a zero, leading-zero, numeric or exponent amount.
  - **Finding 2:** 8 held orders against a wrong code make one `eth_getCode` call, and all 8 are reported.
- Full suite at `7d09bda`: 3,675 tests, 3,669 pass, 5 skipped, and 1 failure, which is the wallet-lock test explained in [README.md](README.md). `npx tsc --noEmit -p .` exits 0. See [evidence/](evidence/).
- Mutation checks on the private tree (not committed):
  - Removing the amount comparison fails the finding 1 test.
  - Resetting the cache on a mismatch fails the finding 2 test.
- The Genesis signer's end-to-end tests run against this book with the real contract on a local chain (ember-evo-genesis-review, Submission9). Paid mints in imdUSD (18 decimals) and USDC (6 decimals) settle with the amount read back from `paymentTokens(token)`. This covers the amount check on receipts the contract itself produced.

## 3. Not verified

- Nothing in `7d09bda` has run in production or on mainnet. No Sepolia receipt has been checked yet.
- Every token added on chain must emit the standard 3-topic `Transfer` and charge the amount the registry lists. The registry entry is written only after both are read back from the deployed contract.
