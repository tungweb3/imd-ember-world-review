# Audit a211537e remediation

Reviewed baseline: World `1015b2c5c8663c6c4bfb46f135be84cacea1cae0`, public export `cc7b7b6b58078c5cd3ecba00e8650348fe2cbcb0`.
Original report: https://explorer.imd.fun/jobs/a211537e-407d-4494-bfbb-159f2665bc33

## Reproductions before changes

`tests/world-gold-audit9.test.mjs` failed six behavioral assertions against the
unchanged baseline: both unsupported legacy challenge and payment succeeded;
a new private read accepted a backward clock above request start; reconcile
returned success after logout; an unverified session read its report; an owner
published an enabled unsupported service. The original red log is retained
separately from subsequent green runs. The report case first funds the fixture,
so an insufficient-balance setup error is not counted as a reproduction.

## M1: product-scoped payment admission

Both legacy GOLD functions receive the trusted provider product list from the
same Worker dependency object used by the new quote route. An unsupported
pending service is refused before a challenge/debit. Challenge insertion and
debit SQL independently bind the immutable linked product against the supplied
JSON product list. Empty lists refuse all new services; omitted lists retain
the documented standalone/helper compatibility. Request JSON cannot supply it.

Already-paid receipts are returned idempotently even when the provider changes,
the quote expires or admissions pause. Existing queued jobs and provider rights
are preserved; this patch does not delete jobs, manufacture refunds, debit an
original order again or claim a provider transition has been operationally
completed. Production remains research-only. A supported delivery adapter must
be installed before accepting new payments for another product.

## L1/L3: one private session and clock policy

`economy-session.ts` validates positive safe-integer, nondecreasing time at each
sample, including after each awaited session read. Equal samples are valid; a
failure stays failed for the request even if a subordinate catch handles it.
Initial reads require a verified ECDSA/ERC1271 session and safe-integer live
expiry. Revalidation pins token, wallet, original expiry, wallet type and method.
It refuses logout, expiry equality, wallet changes and downgraded sessions.

Applied to legacy economy, shared GOLD state/history/admin/trial, member
balances, full report, campaign management and private inventory. ECDSA and
ERC1271 reads retain access; money/inventory/admin writes retain EOA/ECDSA
requirements and their existing atomic live-session SQL. Reports authenticate
before provider access. Private responses are no-store. Invalid/regressing time
is 503; lost authority is 401 with no private success body. Async response
revalidation is awaited inside each handler's error boundary.

New quote/admin and legacy challenge/payment responses also revalidate after
their persistent operation. A valid committed payment remains valid when the
response is refused after a late logout; clients retry the original request,
rather than assume an error means no transaction committed.

## L2: reconciliation authorization boundary

HTTP reconciliation revalidates the original session after completion, on both
success and failure responses. A concurrent logout/expiry cannot receive a
successful response. Reconciliation is the same idempotent repair of already
owed rights used by cron. This intentionally chooses the report's post-write
revalidation option: an entitled credit may already have committed and is not
undone on logout. Cron and an authenticated retry retain exactly one credit.
This is not a claim that HTTP logout rolls back entitled reconciliation.

## I1: unsupported product publication

The admin product branch refuses a new enabled service when its trusted
product-scoped readiness is false. Disabled definitions and unrelated topups
remain available for preparation. The isolated local runtime and historical recovery fixture explicitly declare
their implemented synthetic delivery capability; this is not a production
provider flag or a relaxation of the new guard. Full portable regression first
caught these two old call sites and the aborted release is retained.
Immutable old price versions and admin
idempotency evidence remain intact; no formal price is inferred from fixtures.

## Wider checks and limitations

The regression matrix covers nine private read views, late logout/expiry/time
regression/expiry changes/method downgrade/wallet switch, final-session-read
boundaries, initial invalid sessions, ECDSA/ERC1271 compatibility, six committed
write responses, supported payment replay, an empty provider list, independent
SQL admission, and reconciliation replay. Existing tests retain UTC-day rewards,
holds, price versions, late chain payments, capacity, recovery, schema guards,
provider leases, delivery failure/refunds, large authenticated report bodies
and source/asset provenance.

Local native workerd D1 runs the real migrations, supported/unsupported payment,
independent JSON-list SQL guards, replay and backward-clock refusal. Node SQL
fixtures are distinct from native D1 and public-chain acceptance. No contract,
schema migration, frontend, building/road/model/audio/video or price changes are
part of this patch. NFT allowlist stays empty; retail admissions stay closed.

Final counts, fixed producing commit, deployment, HTTP postflight and packet
hashes are recorded in the accompanying release evidence only after completion.
These tests do not prove peak production capacity or an accepted Swarm verdict.
