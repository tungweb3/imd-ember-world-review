# Audit f5a3b8f9: two Low and three Info findings

Baseline producing source: `e5f17432152670e5516f09fade16f2720b86dcb4`.
Reviewed public export: `87b64e20b644d67a943f9d397a265986f038bb78`.
Original report: https://explorer.imd.fun/jobs/f5a3b8f9-c3ee-4706-aa61-d1a7e4fb3159?hired=audit

This is a bounded patch. Seven runtime files change: five directly affected API/
reconciliation files, the GOLD client type and its service-order button. No
contract, migration, catalogue data, deployment configuration, dependency,
World rendering, building, road, model, media or upstream provider is changed.
New tests and this document are separate from those runtime changes.

## L1/L2: failed writes distinguish authentication loss from other failures

Quote/admin/campaign write failures and the legacy order/challenge/pay family
revalidate the original session before classifying an error. The inventory
zero-change path revalidates before returning a revision conflict. A revoked,
expired, downgraded or replaced session returns401 with only AUTH_REQUIRED;
invalid/regressing clocks remain503. A database fault with a valid session
remains503, and a real inventory revision conflict remains409. Existing
same-origin, EOA/ECDSA, ownership and rate limits remain in effect.

The live-session SQL predicates and transactional checks are preserved. A lost
session cannot authorize the failing batch. A legitimate write committed before
logout is not reversed: the reply refuses stale success, and an authenticated
retry must continue to use the original idempotency key/signature/order.

## I3/I4: capability is consistent in control, quote and state

One API predicate checks installed delivery readiness, the declared product
list and the existing result contract. An empty or entirely unsupported list
cannot enable the service feature or report global deliveryReady. Omitted
lists retain the existing trusted-adapter compatibility: supported result
contracts are available when the adapter is ready. A disabled preparatory
definition or a disable/pause command remains allowed.

State adds a boolean serviceable on each product. Historical immutable rows
remain visible, including to the price-version editor; their prices, enabled
flags, orders and rights are not rewritten or deleted. The GOLD service-order
button additionally refuses serviceable:false. Missing fields remain compatible
with the prior server/local fixture during rollout; server-side quote/challenge/
pay admission remains authoritative. This flag describes delivery capability,
not feature enablement or the presence of formal prices.

## I5: an owned HTTP reconcile observes cron's cooldown

Both topup/job creation and failed-service refund retry paths inspect retry_ms
before attempting the repair. Before that instant, an owned HTTP request
returns409 with the stored failure code, without incrementing attempts or moving
the deadline. At equality or later the original entitlement can retry. Successful
credit/refund stays idempotent and clears the error. Pausing new transactions
does not cancel owed rights. Cron keeps its existing due-row filtering.

Explicit audited administrator repair-topup/refund-service commands retain their
existing manual recovery authority; this change concerns the member reconcile
endpoint. This is a cooldown check, not a new distributed retry lease: concurrent
requests already in flight can still meet the existing idempotent SQL, which
protects balances. No capacity/load guarantee is asserted.

## Reproductions and validation

`tests/world-gold-audit10.test.mjs` contains eight cases reproducing all five
findings against the baseline (five distinct logout routes plus capability,
historical products and retry cooldown). `tests/economy-boundaries-audit10.test.mjs`
adds45 checks: six write routes, expiry equality, method/wallet changes, invalid
clock, live-session DB faults, a real CAS conflict, capability combinations,
topup/refund before/at/after cooldown, paused admission and ownership/origin/auth.
The existing logout test now expects the corrected401 and checks its error body.
Two older timing/refund fixtures now explicitly separate order-only expiry from
simultaneous auth loss, and verify no early refund retry before its exact cooldown
deadline; they retain the original no-write/original-price/once-only assertions.
The previous128 read/write/provider/time regressions remain unchanged.

Release evidence must separately record full World tests, TypeScript/build,
portable financial/contracts/Python checks, native workerd D1 and actual deployed
version/HTTP readback. The five existing Windows symlink skips are not passes.
Historical reports, local tests, deployment, publication and a new external
Audit verdict are distinct. This document does not claim that Swarm has already
accepted these fixes.

GOLD remains wallet-bound, nontransferable and nonredeemable. Undecided formal
prices keep retail purchase/service/Mint admission closed; the approved game
NFT whitelist stays empty. No public-chain transaction is needed for this patch.
