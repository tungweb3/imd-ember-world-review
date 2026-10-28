# Audit request: Genesis paid-mint GOLD ledger in the World Worker

Prepared 2026-10-29. A request for review, not a claim that anything is safe. Nothing here has been verified externally.

## 0. Scope and identity

- Previous public snapshot: Submission18 (World source `96858bf`), reviewed in job `f6bd50ad` (3 Low).
- This submission: World source `21df62b`, **not deployed**. Five commits after `96858bf`:
  - `7021b5b` — remediation of `f6bd50ad` (3 Low) plus the "GOLD payment review record" panel section. **Live** as Worker `a92a767c-bb89-4871-8439-916cded5bb6d` since 2026-10-27 19:34 UTC. Published here for the first time.
  - `ecd9050`, `943959c` — the wallet lock: `scripts/wallet-lock.mjs`, `security/wallet-lock.json` (SHA-256 of the wallet files the earlier audits reviewed) and `tests/wallet-lock.test.mjs`, which fails when a locked file changes. Tests and tooling only.
  - **`20b1d6a` — the subject of this review**: the GOLD ledger for paid Genesis NFT mints, ported from the Sepolia rehearsal Worker.
  - **`21df62b`** — each Genesis payment token has its own GOLD price (§1b).
- **Expected failure:** `server/world-gold.ts` is locked and `20b1d6a` changes one type line in it (`MintBinding` gains two optional fields). The lock hash was deliberately not refreshed, so `tests/wallet-lock.test.mjs` fails and the deploy tool refuses to upload until this review is done and the owner approves. See `evidence/full_suite_20b1d6a_summary.txt` and `evidence/full_suite_21df62b_summary.txt`.
- No Solidity is in this submission. The Genesis contract the ledger reads is public at <https://github.com/tungweb3/ember-evo-genesis-review> (Submission5, `EmberEvoGenesisCandidate.sol`); its mainnet deployment has not happened yet. The version to be deployed adds the payment tokens of §1b; it gets its own Genesis review.

## 1. What `20b1d6a` does

The Genesis mint signer is a separate Worker of the same Cloudflare account. When a wallet pays part of a mint in World GOLD, the signer calls this Worker through a **service binding** (`worker/index.ts`, `class GenesisGold extends WorkerEntrypoint`: `reserve`, `order`, `reconcile`). There is no public HTTP route.

1. **reserve** (`server/genesis-gold.ts` `reserveGenesisGold`): the request names a deployment id and an order. Costs, payment recipient, chain, contract and EIP-712 domain version come from the code registry (`server/genesis-deployments.ts`), never the caller. The wallet's own EIP-712 consent ("Ember World GOLD" v1, `GenesisGoldHold`) over every order field is required. The order deadline must be at most 900 s ahead. The hold goes through the existing generic mint hold (`reserveMintGold` in `server/world-gold.ts`, reviewed before), with the document checked by `encodeMintAuth` (`server/world-gold-result.ts`, new `genesis-r5-paid-v1` branch). An identical retry returns the stored state; any other content with the same order id conflicts.
2. **settle / release** (`reconcileGenesisGold`, the cron `maintainGenesisGold`): only the existing `reconcileHeldMintGold` changes a hold's state, driven by a finalized-chain reader (`server/genesis-gold-reader.ts`). The reader pins chain id and runtime code hash at the finalized block, reads `paidOrderTokenId(orderId)` and `paidOrderRevoked(orderId)` there, and for a used order verifies the receipt: canonical block at or below finalized, status 1, exactly one `PaidOrderConsumed` for this order and exactly one `GenesisMinted` for this wallet and token with the order's look, choice, paid flag and costs. Unused orders are released only when revoked or when finalized chain time is strictly past the deadline. Any RPC error or inconsistency keeps the hold.
3. **Bounded log search.** Production reads use Alchemy Free, which accepts at most 10 blocks per `eth_getLogs`. Without a transaction hint the reader searches only the order window `[deadline − 900 − 120 s, deadline]`, mapped to blocks with the one-block-per-12-s-slot rule (chains 1 and 11155111), with a timestamp binary search when slots were missed, in requests of ≤ 10 blocks. A chain not in the slot table (local tests) is searched from the deploy block.
4. **Cron** (`worker/app.ts` `maintainGold`): the Genesis step runs first in its own try/catch, reads at most 8 held orders per deployment per run from a persisted cursor (migration `0022_genesis_gold_cursor.sql`), verifies the bytecode hash once per finalized block, and reports a malformed registry entry by code without stopping the others.
5. **Production registry is empty**: every reserve is refused (`MINT_DEPLOYMENT_UNKNOWN`) and the cron does nothing until the mainnet contract is deployed and its entry is added.

Two internal reviews before this submission found and fixed: EIP-55 or upper-case registry values making retries conflict and the reader never match (now normalized by `pinnedDeployment`); the Genesis step being blocked by other cron failures; the per-order bytecode hash (32 × 24 KB ≈ 37 ms against the 50 ms CPU limit of the scheduled run); no timeout or status check on the test-chain RPC; one bad registry entry stopping all deployments.

## 1b. What `21df62b` does: one GOLD price per payment token

Owner decision 2026-10-29. The Genesis contract to be deployed takes imdUSD v1 (its deployment token, 1,200 GOLD); the owner Safe adds USDC right after deployment (1,600 GOLD) and imdUSD v2 later (1,200 GOLD); at most two added tokens, each once, usable two days after being added, never removed. Every token pays the same $20, so paying in imdUSD is a 400 GOLD discount. On chain, `mintPaid` takes the GOLD price of the token actually paid, checks the signed `PaidAuthorization.goldCost` against it and reports it in `PaidOrderConsumed.goldCost`.

- `GenesisDeployment` gains `addedTokenGoldCosts` (at most two positive decimal strings; anything else refuses the entry with `MINT_DEPLOYMENT_INVALID`).
- `parseOrder` accepts an order whose `goldCost` is the deployment token's or one of the added tokens' (else `MINT_PRICE_MISMATCH`). The order names no token; the wallet's consent covers the exact `goldCost` held.
- The reader is unchanged: it already settles a hold only when the stored order's `goldCost`, the held amount and `PaidOrderConsumed.goldCost` are equal, so an order held at the imdUSD price and paid in USDC (which the contract refuses anyway) would stay held, never settle at the wrong price.
- The mainnet entry is added only after USDC is added on chain, with the prices read back from `paymentTokens(token)`; imdUSD v2 has imdUSD's price, so adding it later changes nothing in the registry.

## 2. Left as they are

- **A hold that keeps failing with `MINT_PROOF_CONFLICT` stays held.** Examples: a consumption outside the window because the signer signed a different deadline for the same order id, a registry cost that differs from the contract. No GOLD is spent or released on a guess, but there is no alert or operator path yet; the cron keeps retrying it.
- **The signer is trusted to sign the contract authorization with the held deadline.** The contract does not bind the deadline to the order id. The signer could equally sign an order with no hold at all, so this is a trust assumption, not a new one.
- **The window relies on Ethereum's 12 s slot.** If the slot ever shortens, `GENESIS_SLOT_SECONDS` must change; until then a consumption could be missed (the hold stays held; nothing is released wrongly).
- **Registry entries are append-only while any of their orders is held** (comment in `genesis-deployments.ts`); removing one would leave its holds reserved.

## 3. Please attack

1. **Can GOLD be spent without a finalized matching mint, released while a consumption exists or can still finalize, or counted twice?** `genesis-gold-reader.ts` `read`, `reconcileHeldMintGold` in `world-gold.ts`.
2. **`orderWindow`**: off-by-one at either end, the binary search invariant, missed slots, a reconciliation long after the order, `fin.time < start`. Can it return a window that misses a real consumption while still reporting "not consumed"? (It should only ever keep the hold.)
3. **reserve**: can a caller with the service binding hold GOLD without the wallet's consent, with other costs or recipient than the registry's, with a longer deadline, or make a retry hold twice? Is the `encodeMintAuth` branch binding domain version and recipient from the registry sufficient?
4. **Worker wiring**: `package.json` `imports` (`#worker-entrypoint`: `workerd` → `cloudflare:workers`, otherwise a Node stub for tests), the extra named export in `worker/index.ts`, cron isolation and limits (CPU, subrequests, `ECONOMY_CHAIN_LIMITER` key `genesis:rpc`), and any secret (the Alchemy key, a test RPC URL) reaching an error, log or the service boundary.
5. **`21df62b`**: can an order be held at one deployment's price list and settle at another price, can a registry entry carry a price list that lets a caller hold an amount no token of the contract charges, or can the price check be bypassed on retry (the stored-order path of `reserveGenesisGold`)?
6. **`7021b5b`** (live): the three `f6bd50ad` fixes — lower-nonce payment must have status 0x1, a failed note is dropped only by order id and hash, `ESBUILD_BINARY_PATH` / `NAPI_RS_NATIVE_LIBRARY_PATH` refused by the deploy tool.

## 4. Not verified

- Nothing in `20b1d6a` or `21df62b` has run in production or against mainnet; the Sepolia rehearsal of the same book ran with a different (unbounded) log search.
- The tests use a JSON-RPC stand-in, not a real node.
- CPU time was measured in Node 24 on a desktop, not in workerd.
