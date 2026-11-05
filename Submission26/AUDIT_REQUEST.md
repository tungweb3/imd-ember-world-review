# Audit request: the Submission25 scope again, its reviewers' fixes, privacy wording and the birth-time form

Prepared 2026-11-06. A request for review, not a claim that anything is safe. Nothing here has been verified externally, and **no real Celestao payment and no real grant has ever been made**.

## 0. Scope and identity

- World source `24a3efa3ed706e3f40f549519609b0040bad1b96`, **not deployed**. Live is still `d5d7912`.
- **Job 6fc92ac1 on Submission25 (`580190a`) gave no final report.** It ended blocked: the math reviewer failed three times with a login limit on its machine, so the judge never ran. Three other reviewers wrote reports, which nobody merged or reproduced independently. **Nobody reviewed the math area, so please cover it.**
- So the scope is everything since `fd46d69`, the last source with a final report (37a926e3). The new work since Submission25 is in `patches/commits_after_submission25.patch`, and the whole range is in `patches/cumulative_fd46d69..24a3efa.diff`.
- **The wallet-lock test fails on purpose.** These audited files differ from their hashes: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/CelestaoCheckout.tsx`, `src/world/WorldGoldPanel.tsx`, `src/world/economyWallet.ts`, `src/world/worldGoldClient.ts`, `tests/economy-client.test.mjs`. The hashes were not refreshed, so the deploy tool refuses this source until this audit is handled and the owner approves it.
- `migrations/0024`, `src/shared/goldGrants.ts`, `src/world/goldGrantRules.ts`, the grant tests and `integrations/celestao` are not on the lock list. `integrations/celestao` decides refunds, so it is in scope all the same.
- **World and Celestao must ship together.** World's prepare response has a new field, `lapsed`, and `bridge.py` checks the field set strictly. With only one side deployed or rolled back, every new checkout answers 503, and nothing is charged.
- Commits, oldest first: `a7f63e0` privacy text; `3dc9c55` signature and audit fixes; `9124eb3` reload and oversize; `163d222` stuck orders; `74cb24a` polar birthplaces; `b0f9182` retention; `580190a` privacy wording; `60ba12b` wait limit, engine status sorting, lapse message; `3d14551` privacy wording; `24a3efa` birth-time form.
- `wrangler.jsonc` is not in this package. `WORLD_GOLD_GRANTS` is in neither wrangler config, and the owner has not set it.

## 1. Reviewer reports from 6fc92ac1 (never judged)

Each was checked against the code here. The severity is the reviewer's own.

| # | Severity | Finding | Checked | Now |
|---|---|---|---|---|
| 1 | Medium | `OSError` counted as engine away, so `TimeoutError`, `FileNotFoundError` and `ConnectionError` waited for ever | True, reproduced | A wait now ends after 24 hours: section 5 |
| 1b | Not reported; found while checking | The real engines turn exceptions into 502 or 503, so one input that always fails also waited for ever, with no refund and no alert | True, by reading the endpoints; no real failure was produced | Same 24-hour limit |
| 2 | Medium and Low | Engine 500, 504, 507 and 408 refunded at once, skipping the 3 attempts and the hour | True in code; those statuses were not seen in the current endpoints | Sorted: section 5 |
| 3 | Low | A raised `HTTPException` counted as an attempt, even for 429 or 503 | True in code; the current endpoints return these rather than raise | A raised status is treated like a returned one |
| 4 | Low | After a quote lapsed, the checkout page showed only a disabled button for 5 minutes. Our earlier request wrongly said the page asks the buyer to wait | True | The page now says so. The test reads the source and does not render the page |
| 5 | Low | "Can be read only by the same signed-in wallet" overstated it, because one server key opens everything | True | Reworded: section 7 |
| 6 | Info | "Encrypted digest" is an HMAC, not encryption | True | Reworded: section 7 |
| 7 | Info | The 30-day limit for backups is not enforced by code | True | **Not changed.** The operator deletes them by hand |

All three reports said the signature path has no problem, `personal_sign` without chainId is acceptable, one reading gets one order, one wallet cannot reach another's run, and `prune_failed` does not remove deliverable runs. Two of the reviewers could not run commands, so that is from reading code. Please do not rely on it.

`secure_delete` was mentioned but not listed. It is on in the test image (SQLite 3.40.1). The production image and the WAL file were not checked.

## 2. Findings of 37a926e3

These fixes have had no final report either.

| # | Severity | Finding | Now |
|---|---|---|---|
| 1 | Medium | Grant authorised by the session cookie alone | Fixed differently from the suggested fix: section 3 |
| 2 | Low | `grantLeft` ignored the 100-grant limit | Fixed: it answers 0 at the limit, and `grantsLeft` is new |
| 3 | Low | All-uppercase address skipped the checksum | Fixed: anything not all-lowercase must pass the checksum |
| 4 | Low | The 120-second lease is not renewed, so a second process would recompute | **Not changed.** One process is the deployed shape. It is documented in `integrations/celestao/README.md`, and a private test checks `workers=1` |
| 5 | Low | `TimeoutError` below Python 3.11 | Fixed: `paid.py` catches both. The production image is 3.12 |
| 6 | Low | A session lapsing between two reads gave 409 instead of 401 | Fixed |
| 7 | Low | A grant to a contract wallet can never be spent | **Partly fixed.** A recipient with a known contract session is refused, and the panel says EOA. A contract wallet that never signed in, or whose session was cleared, is not caught |
| 8 | Info | The form showed with no economy config | Fixed |
| 9 | Info | A resend was compared as raw JSON | Fixed: compared by what the grant does, so spelling and signature do not matter |

## 3. The per-grant signature

The session is still required, and is checked again inside the write batch. Each grant now also needs a signature from the session's wallet.

- **`personal_sign`, not the EIP-712 the report suggested.** GOLD payment already uses it, the page needs no extra viem bundle, and the wallet shows readable text. Please say if this is a weakness.
- `goldGrantMessage` binds origin, administrator, recipient, amount, reason, request id and expiry. **It has no chainId**: the site origin binds the deployment. The origin comes from the request URL on the server.
- The server accepts an expiry up to 10 minutes ahead, and the page asks for 5. The signature and expiry are stored in the `world_gold_admin_actions` payload.
- Recovery is ECDSA, and sessions must be EOA. There is no EIP-1271.
- A resend of a stored request id replays before any signature check, by what the grant does, whatever its signature or age, so a lost answer costs nothing.

Left as it is:

- A resend asks the wallet to sign again, and the server does not look at that signature.
- After `WALLET_TIMEOUT`, the old wallet window may still be open, and pressing the button again adds another.
- A signature refused by a limit stays valid until it expires, at most 10 minutes. Someone holding the cookie and that signature can only repeat that same grant.
- `deps.recoverGrantSigner` is a test seam, because the tests have no real wallet's key. Neither the worker nor the vite plugin passes it, and a test checks that. Real viem recovery is tested with a generated key.
- One grant wallet is still the treasury, which signs in to the site to grant.

## 4. One reading, one order

A reload lost the page's request id, so the same reading got a second payable run and a buyer could pay twice.

- `vault.prepare` finds the wallet's run for the same system and input digest, so a new request id gets the old run. A failed (refunded) run can be bought again.
- World's prepare answers `lapsed` once the quoted order has been pending and past its expiry for 5 minutes. Celestao then retires the run and opens a new one, at most 3 times per request. A retired run can still be delivered, and is found again if it did get an order. The 5 minutes exist because the ledger compares against a time read before its write, so a payment can land just after expiry. During them the checkout page now asks the buyer to wait.
- A report over `MAX_REPORT_BYTES` now fails at once and is refunded, instead of being recomputed at each lease for ever.

Left as it is:

- A different name, target or reading context is a different reading, and can be paid for separately. The target defaults to today, so resubmitting after midnight is a new order. The human design report does not appear to use the target, so it may charge again for the same content. That was read from code, not tested.
- A refund made by editing the database directly is not known to the vault. The normal flow cannot reach this.
- If a vault already held duplicate old rows, the newer could be chosen first. There are no real sales, so there should be none.

## 5. Stuck paid orders

**Engine answers are now sorted (`native.py`):**

| Engine answer | What happens |
|---|---|
| 400, 409, 422 | The engine refuses this input and always will. The run fails at once, and World refunds |
| 408, 429, 502, 503, 504 | Away or busy. The order waits |
| Any other status that is not 200 (such as 404, 500, 507) | Counts as a failed attempt |

- A failed attempt also comes from a result that cannot be used, a system mismatch or an unexpected exception. At least 3 attempts, and at least 1 hour after the first, fail the run, and World refunds. The hour leaves time to catch a bad deployment.
- **Waiting now has an end (`vault.note_wait`, `WAIT_LIMIT_MS`).** These faults wait: the statuses above, a database error, a disk or other `OSError`, out of memory, and a computation past 15 minutes. From the first one, the run fails after 24 hours and World refunds. The first time is kept in the additive column `first_waited_ms`. If a report arrives before that, it is delivered as usual.
- A run not found answers 409 and is not refunded, because the database may be the wrong one. Only a run this vault removed (`pruned_runs`: id and owner digest, no birth data) is refunded.
- An operator can still end an order with `python -m celestao_world.orders list|refund 0x<order>`, which refuses an order with a saved report. World's next delivery call gets the failure and cancels a computation still running.

To disclose:

- **An engine down for over a day refunds every open order.** The owner accepted this: the buyer can buy again. There is no breaker across orders.
- **The wait clock never resets.** If World's job runner stops for days, the first transient fault after it recovers refunds at once, with no retry. So does a second fault days after a first one that cleared.
- A hung computation is counted only at the next delivery call past 15 minutes, so its refund can come some tens of minutes after 24 hours.
- A database that stays broken cannot record the wait, so that order still waits.
- The `OSError` class was not narrowed, because 24 hours now caps it. A real code fault raising `OSError` waits a day rather than counting as attempts.
- A bad deployment unnoticed for over 1 hour starts refunding open orders, at most 16 a minute. Nothing stops this across orders.
- A `RuntimeError` that is not a code fault, such as thread exhaustion, counts as an attempt.
- Attempt counts never reset, so 3 failures far apart still count.
- Annual and profile worker threads cannot be cancelled; the engine slot returns when the thread ends or the process restarts.
- Still no exit: `inputHash` mismatch (409), wrong secret or clock skew (401 for ever), a restored database that lost `pruned_runs` (409). World's `refund-service` still needs the job to be failed or refunded already.
- Input that cannot be decrypted answers 503 for ever and does not count. The tool can end it.

## 6. Polar birthplaces

Placidus houses have no answer for many birth times past the polar circle, so western and profile reports took payment, failed and were refunded.

- Past 66.5 degrees, western and profile answer `LOCATION_UNSUPPORTED` before payment, and the buyer page says why. Human design, Zi Wei and annual Zi Wei are unaffected.
- A profile whose `analysis_timezone` is not `Asia/Taipei` answers `INVALID_CHART_INPUT` before payment. It takes a forged request, because the page always sends Taipei.

**The line errs towards refusing.** Some birth times between 66.6 and 69.65 degrees can be calculated and now cannot be bought (measured: 39% refused at 66.6, all at 69.65). The free site's behaviour did not change.

## 7. Retention and the privacy text

- A failed run keeps its encrypted birth details for 30 days from when the program first sees the failure (`failed_ms`), then only its id and owner digest stay. `prune_failed` runs at server start and hourly, at most 50 rows a pass. It touches failed runs only: an unpaid run still waits for World to answer, or a long outage could cost a paid order its birth details.
- Afterwards a delivery still gets terminal-failure, so a refund cannot get stuck. The buyer's status call answers `cleared`, and the page explains and links to the World order. `orders refund` answers `NOT_FOUND`.
- The privacy text is in `integrations/celestao/web/world-wallet.js`. The owner confirmed the wording of `3d14551` in the Celestao session, and that session's record was checked. It has had no legal review.

New wording since Submission25:

- The site shows stored reports only to the same signed-in wallet. The key is held by the server, not the wallet, so people who manage the server, or anyone who breaks into it, could technically read them.
- World's records include a digest from the birth details and a server key. The digest alone cannot be turned back, but someone with both the key and World's records could test guesses.
- "Wallet collection" now says it is on the server. The storage consent now says Celestial Atlas holds the key.
- On the paid site only: the FAQ no longer says there is no chart database, the About page no longer says there are no payments or wallets, and the privacy page gains a section on Cloudflare, the VPS and connection logs.

To disclose:

- That new section follows the free site's text. Public responses match "HTTPS, through Cloudflare". What Cloudflare, the host and the proxy actually log, and for how long, was **not** checked, and the text says "may" and "depend on settings".
- `/world-assets/app.js` has no version in its URL and is served with `max-age=14400`, while the entry page is `no-store`. **A returning visitor may see the old FAQ and About text for up to 4 hours after release.** The live and new files contain the same hook strings, so mixing them looks like a text difference only. That was not run.
- The clock starts when the program first sees the failure, which can be up to about an hour late, and later if the server is down. The text says "at least 30 days".
- World's `celestao_checkouts` keeps `input_hash` for rows with an order, indefinitely. This comes from reading the code; production D1 was not queried.
- The 30-day limit for backups relies on the operator deleting them by hand. The program does not delete them and takes no automatic backups.
- `pruned_runs` keeps run id and wallet digest indefinitely, as the text says.
- Completed runs and saved reports are not touched. There is no permanent deletion yet, and the text says so.

## 8. The birth-time form

The owner asked for a drop-down. The single time field is now two lists on the Celestao overlay: hour, marked with its 時辰, and minute. See `patches/prepare_overlay_580190a..24a3efa.diff`.

- The value sent is still `HH:MM`. `calculationInput` picks its fields one by one, so `time_hour` and `time_minute` stay in the page's draft. The backend and reports did not change.
- Both must be chosen. There is no default minute. "Birth time unknown" disables both and sends null, as before.
- A list of 時辰 alone was refused on purpose: BaZi, Western, Human Design and the complete report use the minute, so it would have been quietly wrong.

To disclose:

- **A buyer who knows only the 時辰 must still pick a minute,** as with the old field, and no text explains what to choose. The minute can change paid results, and the buyer cannot see that.
- The hour labels were compared with the backend's `time_index`; no astrologer reviewed them.
- Two copies must stay in step by hand: the builder's edits, and the generated `app.js` tracked in the Celestao tree. They were compared byte for byte at this source. Nothing enforces it later.
- Going back from a finished result to the form was run only as a function, not on the page.

## 9. Known and left as they are, from earlier rounds

- **World unable to deliver for over 30 days while prepares still succeed:** a paid, undelivered order can lose its birth data and is then refunded through `pruned_runs`, rather than delivered. Paid checkouts should be compared with the vault before release. Not done.
- **Unpaid clean-up runs only on prepare,** so it waits while sales are paused or nobody buys. No per-wallet cap on unpaid runs. Up to 800 expired World checkouts an hour are removed.
- **Rolling back and forward again:** older code does not know `unadmitted`, and can give a link for a run that still carries the mark. Rolling back after a first sale strands paid annual orders. Rolling the Worker back after the first grant makes recovery plans refuse.
- **Grants:** cannot be taken back, and the book has no correcting entry. Both limits trust `created_ms` from the Worker clock, so a forward jump escapes the rolling window. Rows cannot be pruned, and a recovery plan is limited to 4 MiB. `INSERT OR REPLACE` on the grant table skips the immutability triggers on D1; no code uses it. Any of the three administrators can still publish a `topup` product with a large GOLD amount at a low price, so this is not a cap on all issuance.
- **521bc017 items not changed:** a reverse proxy could merge clients (`CELESTAO_PROXY_IP` and the Cloudflare layer not verified), and the catalogue version string.
- From Submission23: a target date of 2099 or later gets unedited text at full price, and there is no per-product sale switch on the service.

## 10. Please attack

1. **Math, which nobody has reviewed in this range:** grant limits and rolling windows, `grantLeft` and `grantsLeft`, the 3-attempt and 1-hour counts, the 24-hour and 15-minute clocks, the 5-minute lapse, the 30-day clock, refund amounts against what was paid, and the rounding or integer limits on any of them.
2. **Signature:** forge, reuse or stretch one, across sites, recipients, amounts or request ids. Message ambiguity, the reason's encoding, the origin taken from the request, the expiry, the replay path before the check, and whether the test seam can be reached in production. Is `personal_sign` without chainId acceptable here?
3. **One reading, one order:** any interleaving of reload, repeat, lapse, retire, payment and delivery that charges twice or loses a paid order. The 5-minute wait, the 3 tries, the renamed request id. Can a wallet reach another wallet's run?
4. **Waiting and stuck orders:** can `note_wait` end a run that has a saved report or a delivered one? Races between `note_wait`, `strike`, `abandon`, the lease and a late `complete`. A status put in the wrong group. Can a healthy order be refunded by the clock that never resets, more easily than section 5 says? The tool running beside the server.
5. **Retention:** can `prune_failed` remove a run that can still be delivered or that has a report? A late delivery, or a re-purchase, after clearing. Does `cleared` tell anyone anything they should not learn? Can the cleaner stop quietly?
6. **Polar:** any input that passes `validate` and still fails `compute` because of location or timezone, so that a buyer pays and is refunded.
7. **Birth-time form:** any way the two lists reach payment with a time the buyer did not choose, such as a half-filled pick, a language switch, unknown time switched on and off, or going back.
8. **Privacy text against code:** any sentence in `world-wallet.js` that the code does not make true.
9. **Refund truth:** anything that makes World refund an order whose report was delivered, or keep the money for one that was not.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, 3D and rendering, media, AIMarket, Genesis.

## 11. Evidence

- `evidence/full_suite_24a3efa_summary.txt`: 3,925 tests, 3,919 pass, 5 skipped, 1 fail (the wallet lock, as above); type check.
- `evidence/removal_checks.txt`: each safeguard removed once, with which commit each ran at. They were not all rerun at the final source.
- `evidence/celestao_side_summary.txt`: overlay and real-engine tests at the final source, and the builder's byte comparison.
- Internal reviews read the signature code, the reload fix and the first version of the stuck-order fix. They are not external verification. No independent review is claimed for the commits after that, including the wait limit and the status sorting.

## 12. Not tested

Real payment; real grant; a real wallet signing a grant; production D1 or remote migrations; the logged-in panel with a real wallet; the logged-in Celestao screens, including the `cleared` message, the privacy page and the consent box; the checkout page's lapse message as rendered; a real engine failure or hang, which were only simulated; old and new files mixed in a browser; a real phone, whose native drop-downs look different; cleanup on a real database; the release image; limiter behaviour on Cloudflare; whether `CELESTAO_PROXY_IP` gives real per-client peers; two processes overlapping during a compose rebuild; the full native test run; legal review.
