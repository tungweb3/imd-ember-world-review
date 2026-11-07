# Audit request: fixes for 85163d96 (鼠道修仙 GOLD store, second round)

Prepared 2026-11-07. A request for review, not a claim that anything is safe. **No real Celestao payment, no real grant and no 鼠道修仙 purchase has ever been made.**

## 0. Scope and identity

- World source `0cba66284df8eed064909d93ca6f3bc3753570f9`, **not deployed**. Live is still `d5d7912`.
- **The scope is the one commit since `9d88f5c`** (Submission29), in `patches/cumulative_9d88f5c..0cba662.diff`:
  - `0cba662` Fix audit 85163d96: consent only for same-origin, decided before budget; notice for browsers without Fetch Metadata; spend malformed codes; revoke on reuse; no payment button for owned cosmetic
- The owner asked for the narrowest fix of each finding and no redesign: the files touched are `server/squeek-store.ts`, `src/world/SqueekCheckout.tsx`, `src/world/SqueekConnect.tsx`, `tests/squeek-store.test.mjs`. **No locked wallet file changed in this round** (none). The checkout page is payment UI, so this round is reviewed like the others.
- **The wallet-lock test fails on purpose**, for files changed in earlier rounds: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/CelestaoCheckout.tsx`, `src/world/WorldGoldPanel.tsx`, `src/world/economyWallet.ts`, `src/world/goldPurchaseRules.ts`, `src/world/worldGoldClient.ts`, `tests/economy-client.test.mjs`. The hashes were not refreshed.
- Everything in Submission29 was judged by 85163d96. Its disclosures and those of Submission28 still stand except where this request changes them.

## 1. The six findings of 85163d96

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Low | A signed-in browser without Fetch Metadata got a 403 JSON dead end, contrary to the disclosure | `authorize` treats a GET whose `Accept` includes `text/html` as a page request when `Sec-Fetch-Mode` is `navigate` **or absent**, and sends it to `/squeek-connect/`. When `Sec-Fetch-Site` is absent the link adds `browser=unsupported`, and that page shows an alert that this browser cannot sign in (update it; the game stays playable) instead of a Continue button that could never work. The parameter only selects a message. No code is ever issued without `Sec-Fetch-Site: same-origin`, so such browsers still cannot sign in: that limit is now stated, not hidden |
| 2 | Low | `Sec-Fetch-Site: none` (a link from another app) was accepted as consent | Only `same-origin` mints a code. `none` is handled like any other site: the consent page for a page request, 403 `CONSENT_REQUIRED` otherwise |
| 3 | Low | `authorize` spent the per-IP budget and read the session before the consent check | The consent decision is made from headers first; the budget and `readSession` run only for a `same-origin` request that can mint a code. A test sends 20 cross-site requests and counts zero budget keys and zero database statements, then a same-origin request still mints |
| 4 | Info | A well-formed code sent with another field wrong was not spent | In the 400 branch of `token`, when the body parsed and `code` has the code format, that code is marked `consumed_at=now, token_hash='rejected'` (only if still unconsumed) before answering 400. The client budget is spent before this, as before |
| 5 | Info | A replayed code did not revoke the grant issued on it | When the consuming `UPDATE` matches no row, `token` revokes the `squeek_tokens` row whose hash the code recorded (never for `'rejected'`), then answers 401 as before |
| 6 | Info | The checkout page offered a payment button for a pending order of an owned cosmetic | The pending-order branch shows `ALREADY_OWNED` and no button when `data.owned`; `operate(true)` throws `ALREADY_OWNED` from the fresh state before asking for a challenge. Server rules are unchanged |

## 2. Disclosed

- Finding 1: browsers that send no Fetch Metadata (for example Safari before 16.4, Firefox before 90) cannot sign in to the game; they see the notice. Everything else in World is unaffected.
- Finding 2: a typed or bookmarked authorize URL now also needs the one click.
- Finding 4: a code is spent only when it has the code format; a body that does not parse is answered 400 without touching any code.
- Finding 5: anyone who sees a used code within its row's lifetime can present it once more and so end that player's game grant (a forced logout; no data or GOLD is exposed). This is the RFC 6749 trade-off, chosen deliberately. Expired code rows are pruned by the cron job, after which a replay revokes nothing.
- Finding 6: the order list in the GOLD panel can still show such a pending order; paying it there is refused by the server with `ALREADY_OWNED` as before.
- The game's specification was updated for findings 1, 4 and 5.

## Please attack

1. Findings 1 to 3: any request that obtains a code without `Sec-Fetch-Site: same-origin`, any authorize request that reaches the budget or the database without it, and any use of `browser=unsupported` beyond showing a message.
2. Findings 4 and 5: any exchange sequence that leaves a code usable after a failed attempt, revokes a grant it should not (another code's, another wallet's), or fails to revoke on reuse.
3. Finding 6: any path on the checkout page that asks for a GOLD signature for an owned cosmetic.
4. Anything else in `patches/cumulative_9d88f5c..0cba662.diff`.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, the 鼠道修仙 game itself, 3D and rendering, media, AIMarket, Genesis.

## Evidence

- `evidence/full_suite_0cba662_summary.txt`: 3,949 tests, 3,943 pass, 5 skipped, 1 fail (the wallet lock, as above); type check; six removal checks.
- New tests in `tests/squeek-store.test.mjs`, named `85163d96 #1` to `#6`, plus two updated expectations (a header-less non-page authorize request is now 403; `none` no longer mints).
- Nobody outside reviewed these changes.

## Not tested

Real payment; a real wallet; the consent and checkout pages in a real browser (the page changes are checked by source tests only); an actual old browser; the game's adapter; production D1 and rate limiters; the release image.
