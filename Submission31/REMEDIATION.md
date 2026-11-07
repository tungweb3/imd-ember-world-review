# Remediation of audit 48111df0 (published for the record, no further review requested)

Prepared 2026-11-08. World source `69ad4b5be1d4e08f23318cc3cc9797b5b157f5b2`, **not deployed**; live is still `d5d7912`. No real Celestao payment, grant or 鼠道修仙 purchase has ever been made.

Scope: `69ad4b5` Fix audit 48111df0 (3 Info): spend codes on every malformed exchange, revoke on reuse in both branches, keep code rows for a grant lifetime. Files: `server/squeek-store.ts`, `tests/squeek-store.test.mjs`. **No locked wallet file and no payment code changed**; only the read-only login of the 鼠道修仙 store.

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Info | A failed exchange whose body had another key set, another Content-Type, or a query string did not spend a well-formed code | The token route reads the JSON object (at most 2048 bytes) once whatever the Content-Type, then applies the key-set, Content-Type and query-string checks. Any 400 whose object names a well-formed `code` spends it (`token_hash='rejected'`). Still not spent: a body that is not a JSON object or is over 2048 bytes, since no code can be read from it |
| 2 | Info | A used code replayed through the 400 branch did not revoke its grant | Both branches call one helper, `revokeReused`. In the 400 branch it runs when the spend changed no row (the code was already used), and it never revokes for a code spent by mistake (`'rejected'`) |
| 3 | Info | Code rows were pruned 1 to 16 minutes after issue, so a replay could no longer revoke a 60-minute grant | `pruneSqueekAuth` deletes a code row only one grant lifetime (60 min) after the code's own expiry, so the row outlives every grant made from it. Tokens are pruned as before |

Tests: `48111df0 #1` to `#3` in `tests/squeek-store.test.mjs`; the prune expectation of DATA-02 was updated for finding 3. Full suite: 3,952 tests, 3,946 pass, 5 skipped, 1 fail (the wallet lock, for files changed in earlier rounds: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/CelestaoCheckout.tsx`, `src/world/WorldGoldPanel.tsx`, `src/world/economyWallet.ts`, `src/world/goldPurchaseRules.ts`, `src/world/worldGoldClient.ts`, `tests/economy-client.test.mjs`). The disclosures of Submission30 still stand.

Not tested: a real wallet, the pages in a real browser, the game's adapter, production D1, the release image.
