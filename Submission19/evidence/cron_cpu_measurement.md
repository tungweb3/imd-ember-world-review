# Why the Genesis cron reads 8 orders and hashes the bytecode once per finalized block

The scheduled run has `limits.cpu_ms: 50` (`wrangler.jsonc`) and also runs the economy sync and the World's own GOLD reconciliation.

Before the fix, the reader fetched the contract's runtime code and hashed it (keccak-256) for every held order. Measured 2026-10-28, Node 24 on Windows, viem `keccak256` over a 24,576-byte input:

```
32x keccak 24KB ms 37.1
```

So a page of 32 held orders spent about 37 ms on hashing alone. An independent review measured about 0.9 ms per hash (≈ 29 ms per page). Either way a mint rush could push the whole scheduled run past its limit, and a try/catch cannot catch that.

After the fix (`20b1d6a`):

- the reader keeps the finalized block hash whose code it already verified and skips `eth_getCode` and the hash for later orders at the same block (code at a block is fixed by the block hash);
- a cron run reads at most `GENESIS_CRON_PAGE = 8` held orders per deployment, resuming from `genesis_gold_cursors`.

Test: `tests/genesis-gold.test.mjs` "cron pages through held orders … checking the bytecode once per finalized block" counts one `eth_getCode` call for a page of 8 and checks that the cursor moves on to the remaining orders.

Not measured in workerd.
