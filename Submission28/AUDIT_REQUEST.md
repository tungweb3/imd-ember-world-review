# Audit request: fixes for 447bb70d, and the 鼠道修仙 GOLD cosmetic store

Prepared 2026-11-07. A request for review, not a claim that anything is safe. **No real Celestao payment, no real grant and no 鼠道修仙 purchase has ever been made.**

## 0. Scope and identity

- World source `e93e55ac0f0305fc7e22469c7efd139fc825ea7f`, **not deployed**. Live is still `d5d7912`.
- **The scope is the 4 commits since `24a3efa`**, in `patches/cumulative_24a3efa..e93e55a.diff`:
  - `a3abbf7` Fix audit 447bb70d: repurchase, 409/422, grant form, backup wording
  - `6b15dfa` Link the sister site 鼠道修仙 from the Celestao top navigation (Celestao 0017)
  - `0ad7677` Show the 鼠道修仙 banner at the end of a Celestao personal report (Celestao 0018)
  - `e93e55a` 鼠道修仙 cosmetic store on World GOLD (not deployed, sales closed)
- Everything before `24a3efa` was judged by 447bb70d (3 Low, 1 Info, all fixed in part A). Its known items are in [Submission26/AUDIT_REQUEST.md](../Submission26/AUDIT_REQUEST.md) sections 1 to 9 and still stand.
- **The wallet-lock test fails on purpose.** These audited files differ from their hashes: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/CelestaoCheckout.tsx`, `src/world/WorldGoldPanel.tsx`, `src/world/economyWallet.ts`, `src/world/worldGoldClient.ts`, `tests/economy-client.test.mjs`. Part A changes the locked `src/world/WorldGoldPanel.tsx`; the others changed before `24a3efa` and were judged by 447bb70d. Part C changes no locked file but changes the shared GOLD debit in `server/economy-ledger.ts`, which is not on the list. The hashes were not refreshed, so the deploy tool refuses this source until this audit is handled and the owner approves it.
- `integrations/celestao` decides Celestao refunds, so it is in scope although it is not on the lock list. The Celestao tree carries a byte-identical copy; World and Celestao must still ship together.

## Part A. The four findings of 447bb70d (commit `a3abbf7`)

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | Low | A page that keeps its request id (restored from history) reopens the failed, refunded run instead of buying again | `vault.prepare`: when the request id finds a failed run with the same system and input, that row's `request_id` is renamed to `request_id||'~'||id`, the same way `retire_lapsed` does it, and the lookup by input digest runs as for a new request id. It skips failed runs, so a new run is made. The failed row keeps its id, order, input digest and state |
| 2 | Low | `IDEMPOTENCY_CONFLICT` from `vault.prepare` reached the general handler as 503 `STORAGE_UNAVAILABLE` | `paid.py`: both `vault.prepare` calls go through `start()`. `IDEMPOTENCY_CONFLICT` is 409; `INVALID_REQUEST`, `INPUT_TOO_LARGE`, `DOCUMENT_TOO_LARGE` and `SAVE_CONSENT_REQUIRED` are 422; any other `VaultError` is still 503. The page drops the request id it kept for that reading on 409, so the next press starts a new one |
| 3 | Low | The grant form offered a signature for an amount above a positive `grantLeft`, and the error then said the limit was reached | `goldGrantRules.ts`: new `withinGrantLeft`; `grantFormReady` refuses an amount above `grantLeft` or when `grantsLeft` is 0. The panel says why. The server is unchanged |
| 4 | Info | The privacy text promises at most 30 more days in backups, which no code enforces | Text only: backups are not deleted automatically; the operator deletes them by hand within 30 more days |

Disclosed: the page still does not change its request id after a failure (the server handles it); a renamed id contains `~`, which a request id may not contain; a request id sent with a different input still answers `IDEMPOTENCY_CONFLICT`; whether the page can reach `INPUT_TOO_LARGE` after `validate` was not checked; `grantLeft`/`grantsLeft` are as of the panel's last refresh; the 30 days rely on the operator.

## Part B. Two links from Celestao to 鼠道修仙 (commits `6b15dfa`, `0ad7677`)

The owner's sister site, a small game at `https://squeekascension.celestao.com/`. One fixed link `?ref=celestao`, new tab, `rel="noopener noreferrer"`, carrying no birth data, chart or user data. It appears in the top navigation of every Celestao page (including the form and the page before payment, by the owner's choice; it is not next to the pay button), and as an image banner at the end of a personal report. The site sends `Referrer-Policy: no-referrer`, and Celestao's cookies set no `Domain`, so they are not sent to the subdomain. The logo is a data: SVG in `world-wallet.css`; the banner image is served from `/world-assets/`; CSP is unchanged. The generator change is described in REDACTIONS.md.

## Part C. 鼠道修仙 cosmetic store on World GOLD (commit `e93e55a`)

Owner decisions of 2026-11-07: 11 one-time cosmetics at 200 GOLD each, no bundles; GOLD is returned only when delivery fails (no refund once a cosmetic is delivered); tested locally; a public GOLD guide page. Cosmetics change only how the game looks. Files: `server/squeek-store.ts`, `server/squeek-ownership.ts`, `src/shared/squeekCatalog.ts`, `migrations/0025_squeek_store.sql`, the pages `src/world/Squeek*.tsx`, `squeekCheckoutClient.ts`, `squeekEntry.ts`, `GoldGuide.tsx`, and small changes to `server/economy-ledger.ts`, `server/world-gold-result.ts`, `worker/app.ts`, `wrangler.jsonc`, `src/main.tsx`, `src/world/WorldApp.tsx`.

1. **Identity.** The game has no server. `GET /api/squeek/authorize` (authorization code + PKCE S256) needs the World session cookie, redirects only to the fixed `https://squeekascension.celestao.com/`, and issues a 60-second single-use code. `POST /api/squeek/token` exchanges it with the verifier for a Bearer grant of at most 60 minutes, bound to the World session (World logout ends it). The grant is **read-only**: `snapshot`, `quote` (no reservation), `order`, `orders`, `logout`. It shows a pseudonym (`'sq_'+sha256('squeek-subject-v1:'+wallet)[0:40]`) and a shortened wallet, not the full address. CORS allows only the game's origin and no credentials.
2. **Purchase.** `/squeek-checkout/?sku=…&request=…` on imdember.com reads the cookie session (same-origin only, as the Celestao checkout). `POST /api/squeek/checkout/quote` creates one World GOLD order with request id `'sq_'+requestKey` for the server's price. The player then signs that single amount with the existing economy GOLD payment (challenge + `personal_sign`). The browser never sends an amount.
3. **Ownership** is not stored: it is derived from the wallet's paid order for that cosmetic whose delivery job is not `failed` or `refunded`, as the AIMarket research pass is. Delivery is an in-World provider that only records the order as delivered; on a failed job the existing `service-refund` returns the GOLD and the cosmetic disappears with it.
4. **One-time rule**: an owned cosmetic is refused at checkout, at the payment challenge, and by `SQUEEK_ONE_TIME_SQL` inside the GOLD debit batch in `payEconomyOrderGold`, which is the authority. It binds only the order id and applies only to the 11 products.
5. **Release gates.** Migration 0025 adds tables only. The products appear only after a one-time `squeek_release_actions` insert at deployment; sales also need the Worker flag `SQUEEK_SALES_ENABLED=1` (which registers the delivery provider) and the shared `service` control.
6. `/gold/` is a static explanation of GOLD (zh/en) with one link, `/?open=gold`, which opens the World GOLD panel.

## Please attack

1. **Part C, money:** any way to own a cosmetic without a live paid order, be charged twice for one cosmetic (two tabs, two request keys, generic `/api/gold/quote`, retries, replays), keep a cosmetic after a refund, or be refunded twice. Whether `SQUEEK_ONE_TIME_SQL` can be bypassed or can block a payment it should not (other products, other wallets).
2. **Part C, identity:** code or grant theft, redirect or state handling, PKCE, session binding after World logout or wallet switch, cross-wallet reads, CORS, and whether a read-only grant can reach any route that changes state other than its own `logout`.
3. **Part C, checkout:** CSRF on `checkout/quote`, the request-key format, a key reused for another cosmetic, an expired order, a contract wallet.
4. **Part A:** the rename (any interleaving of prepare, delivery, refund, lapse, retire, `prune_failed` and the operator tool), the 409/422 mapping, the grant form values, and the privacy sentence against code.
5. Anything else in `patches/cumulative_24a3efa..e93e55a.diff`.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, the 鼠道修仙 game itself, 3D and rendering, media, AIMarket, Genesis.

## Disclosed for part C

- `revision` is the latest timestamp among the wallet's cosmetic orders; it is not a counter.
- `quote` answers `affordable` from the balance at that moment; the payment rechecks.
- A pending order the player abandons expires after 15 minutes without a charge; a second request key can be quoted meanwhile and the first payment to land wins.
- The token endpoint has no client secret (public client); PKCE and the fixed redirect are the protection.
- The game side (its adapter, storage of the grant, account-switch handling, free play) is not in this package and was not tested here.

## Evidence

- `evidence/full_suite_e93e55a_summary.txt`: 3,938 tests, 3,932 pass, 5 skipped, 1 fail (the wallet lock, as above); type check; one removal check for the store.
- `evidence/celestao_side_summary.txt`: overlay tests and the builder's byte comparison.
- New tests: `tests/squeek-store.test.mjs` (login, catalogue gates, and the game's PAY-01, 02, 04 to 10 and DATA-02 on the real ledger code over SQLite), plus the part A tests in `test_vault`, `test_paid` and `world-gold-grants`.
- Nobody outside reviewed these changes.

## Not tested

Real payment; real grant; a real wallet signing a grant or a cosmetic payment; the logged-in panel, Celestao and 鼠道修仙 screens in a browser (the new pages were only rendered signed out on a local dev server); the game's adapter; production D1; the release image; the real-engine tests and the full native run (no engine code changed); legal review.
