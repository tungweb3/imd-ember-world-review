# Audit request: paid delivery from Workers, and the Celestao wait text

Prepared 2026-11-09. A request for review, not a claim that anything is safe. **Deployed before this review, at the owner's choice**: the first real paid order stayed undelivered for two hours.

## 0. Scope and identity

- World source `0c1537449137f263232d21f7b0e0687388f31fdc`. Live: `deba7cc` (Worker version `c9a77feb`, 2026-11-08). `0c15374` differs from `deba7cc` only in `integrations/celestao/web/world-wallet.js`, which is not part of the Worker.
- Celestao source `382a266bd41bfc90b9f3563da51171650ece3eb2`. Live in image `db6ade9629ba` since 2026-11-09; the image is the previous live image plus these three web files only.
- Commits since Submission31 (`69ad4b5`), in `patches/cumulative_69ad4b5..0c15374.diff`:
  - `1eb74fa` Refresh the wallet lock after the closed Swarm audit cycle
  - `f33468a` Deliver paid orders from Workers with redirect:'manual'
  - `deba7cc` Keep World music playing while the GOLD and wallet panes are open
  - `0c15374` Mirror Celestao 382a266: tell payers the report takes about 1-2 minutes
- `1eb74fa` only refreshes `security/wallet-lock.json` after the closed review cycle of Submission31. **No locked wallet file changed after it** (none); the wallet-lock test passes.
- Celestao: `382a266`, in `patches/celestao_dd679fe..382a266.patch`.

## 1. The stuck order and the fix (`f33468a`)

On 2026-11-08 the first real paid Celestao order (1,000 GOLD, paid 13:42:46 UTC) was never delivered. Both World delivery adapters called `fetch(url, {redirect: 'error', ...})`. The Cloudflare Workers runtime does not support `'error'` and throws a TypeError before sending anything; Node accepts it, so the unit tests passed. `runGoldServiceJobs` catches the error without logging and leaves the job for the next minute, so the job retried silently. No refund could happen either, since a refund needs a provider-confirmed nondelivery.

The fix changes `'error'` to `'manual'` in `server/celestao-delivery.ts` and `server/aimarket-delivery.ts`. Both already refuse any response whose status is not 200, so a 3xx is still refused: it throws `DELIVERY_UNAVAILABLE` and the job retries, as a thrown error did before. `tests/worker-fetch-redirect.test.mjs` keeps `redirect:'error'` out of `server/` and `worker/`. After the deploy the order was delivered in one cron pass (see `evidence/production_timeline.md`). Production holds no other GOLD service job; AI Market delivery had the same defect, but its product is not on sale and no AI Market job exists.

## 2. The wait text (Celestao `382a266`, mirrored in `0c15374`)

- The confirm step before payment adds: "After payment, your report is usually ready in about 1–2 minutes and is saved to My collection automatically. Do not pay again while you wait."
- A run in `working` (World delivered the paid order and the chart is being computed) now says "Paid. Your report is being prepared, usually in about 1–2 minutes…" instead of "has not been delivered".
- Any other unfinished run (`prepared`) says "This reading has not started yet. If you paid in World, it usually starts within 1–2 minutes…". Celestao cannot see payment, so this text does not claim it.
- `index.html` and `index-pdf.html` only change the script version tag (the first 12 hex digits of the new file's SHA-256).

## 3. Also in scope

- `deba7cc`: the GOLD and wallet panes no longer pause the World music; the 3D scene still pauses behind them. No payment logic changed.

## 4. Disclosed

- A delivery that throws is still not logged by `runGoldServiceJobs` (the fix was kept narrow); this is why the stuck order took two hours to diagnose.
- The guard test only looks for `redirect:'error'`. A search of `server/`, `worker/` and `src/shared/` found no other `cache`, `credentials`, `mode`, `referrer`, `integrity`, `keepalive` or `priority` fetch option; that search is not a test.
- "About 1–2 minutes" comes from one measured delivery: the cron runs every minute and Celestao waits up to 8 seconds for the chart before answering "pending". Celestao's computation limit is 15 minutes, so the text says "usually".
- A `working` run whose computation died keeps the "being prepared" text until World refunds it (the 24-hour rule of Submission26). The text links to the World order.
- A `complete` run without a valid record id (a malformed response) now gets the "not started" text instead of "not delivered".
- The World checkout page (`src/world/CelestaoCheckout.tsx`, a locked file) was not changed and still says "Paid. Your report is being prepared" without a time.
- Both changes went live before this review.

## Please attack

1. Any way `'manual'` lets a redirect or any non-200 response count as delivered, or as a confirmed nondelivery that triggers a refund.
2. Any other fetch option or API in the Worker-side payment and delivery code that Workers reject or handle differently from Node.
3. The wait text: any run state in which it tells a buyer something false about payment, or invites a second payment.
4. Anything else in the two diffs.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, the 鼠道修仙 game, 3D and rendering, media, Genesis.

## Evidence

- `evidence/full_suite_0c15374_summary.txt`: 3,954 tests, 3,949 pass, 5 skipped, 0 fail; type check.
- `evidence/production_timeline.md`: the stuck order, the probe and the deploys.
- Nobody outside reviewed these changes.

## Not tested

A second real payment after the fix; the `working` and `prepared` texts in a real browser (the confirm-step text was read from the live page); AI Market delivery against its server.
