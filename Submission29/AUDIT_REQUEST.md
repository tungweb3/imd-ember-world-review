# Audit request: fixes for 64b1ce06 (鼠道修仙 GOLD store)

Prepared 2026-11-07. A request for review, not a claim that anything is safe. **No real Celestao payment, no real grant and no 鼠道修仙 purchase has ever been made.**

## 0. Scope and identity

- World source `9d88f5ce3142b55bc39f62c085b31453b1b6cdec`, **not deployed**. Live is still `d5d7912`.
- **The scope is the one commit since `e93e55a`** (Submission28), in `patches/cumulative_e93e55a..9d88f5c.diff`:
  - `9d88f5c` Fix audit 64b1ce06: squeek checkout link, per-client limits, keyed subject, consent and spent codes, checkout-only cosmetics
- Everything in Submission28 was judged by 64b1ce06 (5 Low, all fixed below). Its disclosures in [Submission28/AUDIT_REQUEST.md](../Submission28/AUDIT_REQUEST.md) still stand except where this request changes them.
- **The wallet-lock test fails on purpose.** These audited files differ from their hashes: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/CelestaoCheckout.tsx`, `src/world/WorldGoldPanel.tsx`, `src/world/economyWallet.ts`, `src/world/goldPurchaseRules.ts`, `src/world/worldGoldClient.ts`, `tests/economy-client.test.mjs`. This round changes the locked `server/world-gold.ts`, `src/world/WorldGoldPanel.tsx`, `src/world/goldPurchaseRules.ts`. The hashes were not refreshed, so the deploy tool refuses this source until this audit is handled and the owner approves it.

## 1. The five findings of 64b1ce06

| # | Finding | Fix |
|---|---|---|
| 1 | `GET /api/squeek/quote` returned a `checkoutUrl` without the request key or language, which the checkout page rejects | The quote takes `sku`, a required `requestKey` (same format as the checkout) and an optional `lang` (`zh`/`en`); no other or repeated parameter. `checkoutUrl` is built with `URLSearchParams({sku,request,lang})`. A test feeds the returned URL to `squeekCheckoutParams` and requires `valid`, the same key and the language |
| 2 | Token and Bearer routes were limited only by a caller-chosen key, and the grant lookup ran before the limiter | `token` first spends `'squeek:token-client:'+client` (20/min), then the per-code key, before reading the body or touching the database. Bearer routes spend `'squeek:api-client:'+client` (the 180/min API budget) and then the per-grant key, **both before** `readSqueekGrant`. A test counts database statements: none run once either budget is spent |
| 3 | The subject id was an unkeyed hash of the wallet, returned beside a wallet hint | `squeekSubject(key,address)` is `'sq_'+HMAC-SHA256(SQUEEK_SUBJECT_KEY,'squeek-subject-v1:'+address)[0:40 hex]`. The key is a new Worker secret (43–128 base64url characters); without a valid key every `/api/squeek/` route answers 503. `walletHint` is removed: no Bearer response carries any part of the address (the owner's choice) |
| 4 | `authorize` minted a code on any cross-site navigation; a failed exchange left the code usable | A code is issued only when `Sec-Fetch-Site` is `same-origin` or `none`. Any other value or a missing header sends a navigation to `/squeek-connect/` (signed in: a Continue link, a same-origin navigation; the site sends `X-Frame-Options: DENY`), and answers 403 `CONSENT_REQUIRED` otherwise. The token `UPDATE` now consumes the code on every attempt within its 60 s, writing the grant hash only when verifier, redirect and session match and `'rejected'` otherwise; the token row is inserted only for the grant hash |
| 5 | Cosmetics could be quoted through the generic `/api/gold/quote` and the GOLD panel, skipping the sales gate and ownership pre-check | `goldQuote` refuses a 鼠道修仙 product with `SQUEEK_CHECKOUT_REQUIRED` unless called with `squeekCheckout:true` **and** an `'sq_'` request id. Only `/api/squeek/checkout/quote` passes that flag (after `salesOpen` and the ownership check); the generic route builds its arguments field by field, so a client cannot set it. The panel no longer lists `squeek-*` products, and `goldPurchaseError` has text for `ALREADY_OWNED` and `SQUEEK_CHECKOUT_REQUIRED` |

## 2. Disclosed

- Finding 4: every login from the game now stops on `/squeek-connect/` for one click, also for a signed-in player. `Sec-Fetch-Site: none` (a typed or bookmarked URL) is accepted as the user's own navigation. Browsers that send no fetch metadata always go through the consent page.
- Finding 4: a code that reaches the token endpoint with a wrong verifier is spent; the game must start a new login.
- Finding 3: the subject key must never be rotated (every subject id would change); nothing is deployed, so no existing id moves. The game is told it gets no wallet address.
- Finding 2: the per-client key is the client IP (`cf-connecting-ip`, normalised by `rateLimitKey`); players behind one address share its budget.
- Finding 5: an order created by the squeek checkout still appears in the panel's order list and can be paid there; the debit batch's one-time rule is unchanged.
- The game's adapter is not in this package and was not tested; its specification was updated for the four interface changes (quote key, no hint, consent click, spent code).

## Please attack

1. Finding 5: any remaining way to create or pay a cosmetic order without `salesOpen` and the ownership pre-check (another caller of `goldQuote`, admin commands, retries of an older request id).
2. Finding 4: any way to obtain a code for a signed-in victim without their click on World, and any exchange path that leaves a code usable after a failed attempt.
3. Finding 2: any route under `/api/squeek/` that reaches the database before a per-client budget.
4. Finding 3: any response that still lets the game recover the wallet address.
5. Anything else in `patches/cumulative_e93e55a..9d88f5c.diff`.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, the 鼠道修仙 game itself, 3D and rendering, media, AIMarket, Genesis.

## Evidence

- `evidence/full_suite_9d88f5c_summary.txt`: 3,943 tests, 3,937 pass, 5 skipped, 1 fail (the wallet lock, as above); type check; four removal checks.
- New tests in `tests/squeek-store.test.mjs`, named `64b1ce06 #1` to `#5`, plus the updated login and PAY-02 tests.
- Nobody outside reviewed these changes.

## Not tested

Real payment; a real wallet; the new pages and the consent click in a real browser; the game's adapter; production D1 and rate limiters; the release image.
