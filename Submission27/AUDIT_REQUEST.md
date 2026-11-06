# Audit request: fixes for audit 447bb70d on Submission26

Prepared 2026-11-06. A request for review, not a claim that anything is safe. **No real Celestao payment and no real grant has ever been made.**

## 0. Scope and identity

- World source `a3abbf7f7c37fa97dcf3c25cba781680cf0b8ca7`, **not deployed**. Live is still `d5d7912`.
- Job 447bb70d judged Submission26 (`24a3efa`) and found 3 Low and 1 Info. **The scope is the one commit since `24a3efa`**: `patches/cumulative_24a3efa..a3abbf7.diff`. Everything before it was reviewed by 447bb70d; its known items are in [Submission26/AUDIT_REQUEST.md](../Submission26/AUDIT_REQUEST.md) sections 1 to 9 and still stand.
- **The wallet-lock test fails on purpose.** These audited files differ from their hashes: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/CelestaoCheckout.tsx`, `src/world/WorldGoldPanel.tsx`, `src/world/economyWallet.ts`, `src/world/worldGoldClient.ts`, `tests/economy-client.test.mjs`. This commit changes the locked `src/world/WorldGoldPanel.tsx`. The hashes were not refreshed, so the deploy tool refuses this source until this audit is handled and the owner approves it.
- `integrations/celestao` decides refunds, so it is in scope although it is not on the lock list. The Celestao tree carries a byte-identical copy; World and Celestao must still ship together.

## 1. The four findings and what changed

| # | Severity | Finding of 447bb70d | Fix |
|---|---|---|---|
| 1 | Low | A page that keeps its request id (restored from history) reopens the failed, refunded run instead of buying again | `vault.prepare`: when the request id finds a failed run with the same system and input, that row's `request_id` is renamed to `request_id||'~'||id`, the same way `retire_lapsed` does it, and the lookup by input digest runs as for a new request id. It skips failed runs, so a new run is made. The failed row keeps its id, order, input digest and state |
| 2 | Low | `IDEMPOTENCY_CONFLICT` from `vault.prepare` reached the general handler as 503 `STORAGE_UNAVAILABLE` | `paid.py`: both `vault.prepare` calls go through `start()`. `IDEMPOTENCY_CONFLICT` is 409; `INVALID_REQUEST`, `INPUT_TOO_LARGE`, `DOCUMENT_TOO_LARGE` and `SAVE_CONSENT_REQUIRED` are 422; any other `VaultError` is still 503. The page drops the request id it kept for that reading on 409, so the next press starts a new one, and says no payment was created |
| 3 | Low | The grant form offered a signature for an amount above a positive `grantLeft`, and the error then said the limit was reached | `goldGrantRules.ts`: new `withinGrantLeft`; `grantFormReady` takes `left` and `count` and refuses an amount above `grantLeft` or when `grantsLeft` is 0. The panel says why. `GRANT_DAILY_LIMIT` now reads "this grant would go over the 24-hour limit; check what is left above". The server is unchanged |
| 4 | Info | The privacy text promises at most 30 more days in backups, which no code enforces | Text only. It now says backups are not deleted automatically and the operator deletes them by hand within 30 more days. No backup deletion was added |

## 2. Left as it is, to disclose

- **Item 1:** the page still does not change its request id after a failure; the server now handles it. A renamed id contains `~`, which a request id may not contain, so it never matches a request again. The failed row is still found by id for a late delivery (which answers terminal-failure, tested), by `prune_failed` and by the operator tool. The rename and the new run are in one transaction.
- **Item 1:** a request id sent with a different input from its failed run still answers `IDEMPOTENCY_CONFLICT`; the check runs before the rename.
- **Item 2:** the normal page should not reach the conflict, because its request id is keyed by system and input, and the route checks consent first. Whether the page can reach `INPUT_TOO_LARGE` after `validate` was not checked. For the 422 codes the page shows its general "temporarily unavailable" text. A 4xx now ends the request without `forget_unpaid`, because `vault.prepare` refused before creating any run.
- **Item 3:** `grantLeft` and `grantsLeft` are as of the panel's last refresh, so they can be stale; the server still decides. A value the panel did not get, or one that is not a plain number, does not block the form. Still no wording that tells "amount too large" from "count used up" apart in the server's answer, which is one code.
- **Item 4:** the 30 days rely on the operator. The program takes no automatic backups and deletes none.

## 3. Please attack

1. **The rename:** any interleaving of prepare, delivery, refund, lapse, retire, `prune_failed` and the operator tool where renaming a failed run's request id charges twice, loses a paid order, or stops a late delivery or refund working. Two prepares with the same id at once. A failed run that was retired, or retired after failing.
2. **The 409 and 422 mapping:** any real storage fault now answered with a 4xx, so that the page stops when it should retry, or any path that should still remove a fresh unpaid run.
3. **The grant form:** any `grantLeft` or `grantsLeft` value (stale, missing, leading zeros, very large) for which the form blocks a grant the server would accept, or still offers one it must refuse. The `BigInt` conversions.
4. **Privacy text against code:** the changed sentence, in both languages.
5. Anything else in `patches/cumulative_24a3efa..a3abbf7.diff`.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, 3D and rendering, media, AIMarket, Genesis.

## 4. Evidence

- `evidence/full_suite_a3abbf7_summary.txt`: 3,926 tests, 3,920 pass, 5 skipped, 1 fail (the wallet lock, as above); type check.
- `evidence/celestao_side_summary.txt`: overlay tests in both trees and the builder's byte comparison.
- New tests: `test_vault` (a failed run gives its request id to a new run and keeps its order), `test_paid` (a refunded reading can be bought again with the kept request id; conflicts are 409, refusals 422, storage faults still 503), `world-gold-grants` (no signature above what is left).
- No removal checks were run for these fixes, and nobody outside reviewed them.

## 5. Not tested

Real payment; real grant; a real wallet signing a grant; the logged-in panel and Celestao screens in a browser, including the new messages; a page actually restored from browser history; production D1; the release image; the real-engine tests and the full native run (no engine code changed); legal review.
