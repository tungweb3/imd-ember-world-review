# Submission20 — audit request

- This submission: World source `0727200`, **not deployed**, one commit after `7939c37` (Submission19, audited in job
  `8febfeed`). Production registry `server/genesis-deployments.ts` is still empty, so every reservation is refused.
- The design of the Genesis GOLD ledger is in [Submission19/AUDIT_REQUEST.md](../Submission19/AUDIT_REQUEST.md); this
  file lists only what changed.
- The wallet lock is unchanged: the only failure of the full suite is the wallet-lock test on `server/world-gold.ts`
  (from `20b1d6a`, already in Submission19). `0727200` changes no locked file.

## 1. The order names its payment token (Genesis audit 944905c3, finding 1)

The Genesis contract (Submission7 of the Genesis review) now signs the payment token in its `PaidAuthorization`, so
imdUSD v1 and v2 (both 1,200 GOLD) are no longer interchangeable for one order. The World book follows:

- `GenesisOrder` has `token`; the wallet's `GenesisGoldHold` consent has `token` after `genesis`; the stored document is
  schema `genesis-r5-paid-v2` (`world-gold-result.ts` requires a lowercase token address in it). No v1 hold exists in
  production.
- A registry entry lists `paymentToken` + `goldCost` (the deployment token) and `addedTokens: [{token, goldCost}]` (at
  most two, distinct, not `paymentToken`, positive prices; two tokens may share a price). `parseOrder` holds an order only
  when its `goldCost` is the price listed for its `token` (`genesisTokenGoldCost`), else `MINT_PRICE_MISMATCH`.

## 2. Findings of audit 8febfeed

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Medium | One `embeoCost` per deployment while the contract charges per-token amounts; a USDC mint could never settle | Not applicable to the contract that will be deployed: in the multi-token contract (Genesis Submission6 and 7) `GenesisMinted.cost` is always `paidCost`, the dollar price in 18 decimals, whichever token paid (20e6 USDC charged, 20e18 reported); the Genesis contract's own tests assert it. The audit read the single-token Submission5 contract. Documented on `GenesisDeployment`. |
| 2 | Low | `orderWindow` skipped the binary search when the first guess fell at or below the deploy block | Fixed: the search starts from the deploy block (`lo = deploy`) and binary-searches as in the other branch; only a deploy block inside the order window returns early. |
| 3 | Low | The cron page was cut from every held mint, not the deployment's own | Fixed in `genesis-gold.ts` (the locked `world-gold.ts` is unchanged): the page query filters `chain_instance`, `chain_id` and `contract`, and `reconcileHeldMintGold` is called once per id. |
| 4 | Low | An identical retry was re-validated against the current registry | Fixed: on the stored-order path `parseOrder` skips the price, recipient and cost check (`prices=false`); the request must still equal the stored document byte for byte and carry the wallet's consent. |
| 5 | Low | Reconcile calls over the service binding and the cron shared one rate-limit key | Fixed: `GENESIS_RPC_KEYS` — `genesis:rpc` for the cron, `genesis:rpc:service` for the service binding. |
| 6 | Info | `genesisGoldOrder`'s comment said no wallet data is returned | Fixed: the comment says the wallet's balance is returned (the signer shows it on the Mint page); the consent signature never is. |

## 3. Please attack

1. Token binding: can a hold be made for a token the entry does not list, at another token's price, or with a consent
   that names a different token than the order?
2. The retry path with `prices=false`: can a caller use it to hold or change anything that the first hold would have
   refused (another wallet, order, price, deployment, or a missing consent)?
3. `orderWindow` deploy branch: any off-by-one at `lo = deploy`, or a case where the consumption block is left out? It must
   only ever keep a hold, never release one.
4. Cron page: does the per-deployment query skip or repeat a held order across cursor wraps, or exceed the cron's CPU and
   subrequest limits (page 8, one `reconcileHeldMintGold` call per id)?
5. Rate-limit keys: does any chain read still use the cron's key from the service path, or the reverse?

## 4. Tests

`evidence/full_suite_0727200_summary.txt`. `tests/genesis-gold.test.mjs` has 29 tests, all passing; new: the order's
token and price pairs, the consent binding the token, a v2 token listed later, the retry after a registry edit (finding
4), a contract deployed long before the order and reconciled 500,000 blocks later (finding 2), two deployments' holds
(finding 3), the two rate-limit keys (finding 5).

## 5. Not verified

- Nothing in `0727200` has run in production or against mainnet. Sepolia's book is a separate copy.
- `wrangler deploy --dry-run` was not repeated for this commit; the Worker wiring (`worker/index.ts`, `worker/app.ts`,
  `package.json`) is unchanged since `7939c37`.
