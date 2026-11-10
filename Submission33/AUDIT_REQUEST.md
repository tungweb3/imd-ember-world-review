# Audit request: fixes for audit 88a680a7

Prepared 2026-11-10. A request for review, not a claim that anything is safe. **The Celestao page fix went live before this review**, at the owner's choice.

## 0. Scope and identity

- World source `7672dc5861a8f96e446bf439dda75f3fd89bae06`. Live World is unchanged: `deba7cc` (Worker version `c9a77feb`). `7672dc5` changes only tests and `integrations/celestao/web/world-wallet.js`, which is not part of the Worker. **No locked wallet file and no Worker code changed**; the wallet-lock test passes.
- Celestao source `2b5f1c2f29a7d1ccc22f95b7d6e41b2a9353d6e8`. Live in image `59cf266f154b` since 2026-11-10; the image is the previous live image (`db6ade9629ba`, Submission32) plus these three web files only.
- Commits since Submission32:
  - World `7672dc5` Audit 88a680a7: Celestao run polling fix, wider fetch-option guard, 3xx tests
  - Celestao `2988b2f` World wallet: keep polling a paid run after a failed status check; wait text 1–3 minutes
  - Celestao `2b5f1c2` Load world-wallet.js 2988b2f (cache tag 6ac8b2051ba2)

## 1. Findings of 88a680a7

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Low | One failed status check ended the Celestao "this page updates by itself" view and removed the World order link and the Check again button | `showRun` builds the link and button in one helper (`controls`) and schedules the 5-second poll in another (`poll`). After a failed check it shows the error and keeps both, and keeps polling. Exceptions: `AUTH_REQUIRED` and `CONTEXT_CHANGED` (the wallet session is missing, expired or changed; the page asks the buyer to reconnect, and `focus`/`visibilitychange` re-check the session) get neither; `NOT_FOUND` (no such run for this wallet) keeps the link and button but stops polling. The poll still only fires while the page is visible and the same view is current; `focus` and `visibilitychange` still re-check |
| 2 | Low | The Workers fetch guard only looked for `redirect:'error'` in the top level of `server/` and `worker/` | `tests/worker-fetch-redirect.test.mjs` walks `server/`, `worker/` and `src/shared/` at any depth (`.ts .tsx .mts .js .mjs`), allows only `redirect` `manual`/`follow` and `cache` `no-store`/`no-cache`, rejects any `credentials`, `referrerPolicy` or `integrity` key, and fails if the scan stops reaching the three files that call external services |
| 3 | Low | A paid order that Celestao refuses with 409 (vault restored from an older backup, or the two sides disagree) is retried every minute and never refunded | **Not changed.** A real fix needs a new refund path in `server/world-gold.ts`, a locked file, and an operator decision about who confirms nondelivery. Disclosed in section 2. Added a read-only query for such orders; production returned none (`evidence/stuck_paid_orders_query.md`) |
| 4 | Info | No test fed a 3xx to either delivery adapter | `tests/aimarket-delivery.test.mjs`: 301, 302, 303, 307 and 308 with a `Location` header, for deliver and read: each rejects with `DELIVERY_UNAVAILABLE`, the transport is called once (nothing followed) and `redirect:'manual'` is passed. `tests/celestao-checkout.test.mjs`: the same five codes against a paid, bound order, through the adapter and through `runGoldServiceJobs`: no follow, the order stays paid, delivery is neither delivered nor refunded, and the balance keeps the 1,000 GOLD charge |
| 5 | Info | The lease equals the one-minute cron period, so a reading that takes longer than 8 s is retried a minute later: about 2–3 minutes, not 1–2 | Text only: the three wait messages (confirm step, `working`, `prepared`) now say about 1–3 minutes, in both languages. The lease and the cron are unchanged (`server/world-gold.ts` is locked) |
| 6 | Info | A run retired after its quote lapsed still shows "not started yet … 1–3 minutes" and polls every 5 seconds | **Not changed.** Needs a new state from `paid.py`/`vault.py`. Disclosed in section 2 |

## 2. Disclosed

- Finding 3 stands as reported. The only signal is `console.error("celestao_delivery_refused", orderId)`, sampled with the rest of the Worker logs. The operator can run the read-only query in `evidence/` by hand; nothing schedules or alerts on it. The 24-hour automatic refund of Submission26 covers runs that never finish computing, not a 409 refusal.
- Finding 6 stands as reported. A retired run is unpaid by definition (its quote lapsed), so no money is at risk; the page polls every 5 seconds while it is visible and says the reading has not started.
- Finding 1: a run that keeps failing (for example World stays unreachable) now polls every 5 seconds for as long as the page is visible, with no back-off. Each check is one same-origin GET to Celestao.
- Finding 2: the guard is still a text scan of object keys, not a type-level check, and it cannot see options built at run time. `mode` is not checked because the same key name is used by unrelated objects in `server/`; no Worker fetch passes it today.
- "About 1–3 minutes" is still an estimate: one cron pass plus up to 8 s, and one more cron pass when the chart takes longer. Celestao's computation limit is 15 minutes, so the text says "usually".
- The World checkout page (`src/world/CelestaoCheckout.tsx`, a locked file) is unchanged and still says "Paid. Your report is being prepared" without a time.
- The Celestao change went live before this review.

## Please attack

1. Finding 1: any error or state in which the page now polls when it should not (a lost or switched wallet, another wallet's run), stops when it should not, shows a link for the wrong run, or invites a second payment.
2. Finding 2: any Worker-side fetch option that Workers reject or treat differently from Node and the guard still misses.
3. Finding 4: any 3xx, or other non-200 answer, that the adapters or the job runner could still count as delivered or as a confirmed nondelivery that refunds.
4. Anything else in the diffs.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, the 鼠道修仙 game, 3D and rendering, media, Genesis.

## Evidence

- `evidence/full_suite_7672dc5_summary.txt`: 3,960 tests, 3,955 pass, 5 skipped, 0 fail; type check; removal checks for findings 1, 2, 4 and 5; the Celestao release checks.
- `evidence/stuck_paid_orders_query.md`: the read-only query for finding 3 and its empty result.
- The finding 1 tests run the real `world-wallet.js` in a small fake page (`tests/celestao-home-prices.test.mjs`).
- Nobody outside reviewed these changes.

## Not tested

The new polling in a real browser; a real World outage during a paid run; a real 3xx from either service; AI Market delivery against its server.
