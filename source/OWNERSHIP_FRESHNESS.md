# Ownership freshness — R8 v1.1

Date: 2026-10-04. This document describes the local candidate implementation and synthetic controls. It is not a production-deployment or external-review claim.

## Authority and clock rules

Only mainnet `ownerOf` evidence for the authenticated server-session address can grant household eligibility. The roster, Alchemy index, D1 index candidates, public names and public member IDs are discovery/display data. Existing online/owner-specific last-seen counting rules, candidate ranking, collection address, household sizes and server authentication remain unchanged.

All ownership/list/backoff cache reads use `isFreshAge`: finite `now`, `stamp`, positive finite TTL and finite elapsed age; only `0 <= age < TTL` is fresh. Exact expiry, a backwards clock or a non-finite age misses the cache. A first proof or delta finishing after clock rollback or at/after its deadline is unavailable; it cannot install future/expired authority. A failed delta may return old evidence only if that old epoch remains fresh at actual completion.

## Discovery and cryptographic evidence have different deadlines

- Ordinary NFT discovery uses the original index's 5-minute deadline; explicit `fresh=1` uses its 30-second deadline. Index reads still require the existing budget or a successfully reserved discovery lane, and use at most five pages.
- Refused/failed discovery with retained candidates keeps its own 30-second attempt backoff. It does not date the retained index as new. An admitted `again` lane can retry discovery; it cannot override valid positive or negative cryptographic evidence.
- An ownership epoch starts once and expires exactly 30 seconds after `checkedAt`. Successful `fresh`, index admission, an admitted lane and new candidate discovery never renew that epoch.
- Discovery or lane admission may wait past that deadline. After discovery finishes, the actual clock determines whether the prior epoch is still valid. An expired epoch starts a new `latest` proof at that clock; it cannot reuse an old pinned block or the request's earlier timestamp.
- The epoch records every successfully examined ID, including wrong-owner and reverting `ownerOf` results. Negative evidence is reused for the same fixed deadline; it never grants ownership.
- A new candidate inside an epoch receives a delta proof. Existing results are reused, and the delta is pinned to the epoch's block. An empty epoch obtains its first block on its first nonempty delta, without changing its original `checkedAt` or deadline. The response never presents evidence from mixed blocks as a single-block proof.
- There are at most 256 attempted IDs per epoch: proved positive/negative IDs plus unavailable failed-delta IDs. Remaining space is selected using the same counting/ranking rule, including owner-specific recent sightings when a delta cut is necessary. Excess candidates produce `partial` (or `limited` if discovery/proof also failed), and wait for a new epoch. Negative results are not evicted to make space for repeated re-proofs.
- Per-address updates serialize. Cache freshness uses the live Worker clock after a queue wait, so request-start time cannot falsely reject an index that completed meanwhile. A successful waiter re-evaluates its own captured roster, current clock and fresh intent; it does not label a previous roster complete. Identical pending contexts (candidate/ranking scope, fresh/again intent, chain key/fetcher and database, within the original 30-second pending window) share a controlled failure. A changed roster/intent/context or an expired pending window is an independent evaluation after either predecessor settlement. There is no permanently rejected map entry.

## Failures and bounded retries

A first or expired proof that fails remains `OWNERSHIP_UNAVAILABLE`, never a complete empty home. Failed index reads without retained index candidates retain the existing unavailable behavior. The lane continues to spend its reservation when an upstream read went out; there is no refund.

A delta RPC failure during a valid epoch keeps the old proven seats, their original block/time and matching owner-specific sightings, marks the answer `limited`, and records the attempted new IDs as **unavailable**, not negative/owned. These failed IDs consume epoch capacity and are not retried until its original deadline. They cannot gain household authority without a later successful `ownerOf` result. This introduces a deliberate availability trade-off: a healthy node recovering a second later cannot recover those new candidates until the remainder of the existing 30-second epoch ends.

Future/non-finite D1 `read_at` values cannot become fresh or win a newer-evidence comparison against a valid dated local index. They can only name untrusted candidates, which still need a valid chain proof. D1 storage and existing migration/error fallback rules are unchanged.

Completed epoch and index/list caches are bounded to 512 addresses per isolate. Active proof-flight metadata is also bounded to 512 address keys; active work is never evicted. A new key at capacity is controlled unavailable before index/budget/RPC work and may retry after an active entry settles. Candidate proof cost is bounded by the 256 attempted-ID epoch cap, RPC chunking (200 IDs per call), in-flight serialization and existing authenticated home/chain/lane limiters. This is **not** a single-RPC-per-epoch guarantee: genuinely new candidates can require deltas. Nor is it a global RPC ceiling across addresses, isolate eviction, colos, restarts or upstream errors. First/expired proof failures have no valid epoch to retain; their retries remain unavailable and are bounded by existing request limiters rather than the successful-epoch cache. No new distributed/global RPC limiter is introduced.

## Fixed evaluator and results

The unchanged `tests/ownership-v11.test.mjs` evaluator can load another source tree using `V11_SOURCE`. It uses deterministic fixture addresses, clocks, historical block snapshots, local index/RPC replies and SQLite; it makes no live requests.

| Control | Required and measured candidate result |
|---|---|
| Index at 0s; ordinary proof at 31s; fresh at 32s | 2 index reads, **2 RPCs**, preserved 31s `checkedAt` and proof block |
| 20 refused fresh reads over 19s | Budget 1, index 0, **RPC 1**, all views `limited` |
| New index candidates during a valid epoch | Only unseen IDs read; positive/negative/revert results retained; delta pinned to old block/deadline |
| Refused then admitted new-buyer lane | Refusal adds 0 RPC; admitted lane proves only new candidate, preserving old negative result |
| 20 concurrent requests during held delta | One index reload and one delta RPC, with identical proved seats |
| Discovery held across an existing proof deadline | New `latest` proof dated at actual proof start; sold seat rejected |
| Buyer lane admission delayed 60 seconds | Eligible seat retained only after current ownerOf; reservation, index read and proof dated at T+60s in real SQLite |
| New roster during a held proof | Waiting caller gets its own one-ID pinned delta rather than a falsely complete old answer |
| 255 proved IDs then two new IDs | One remaining slot; at most 256 attempted IDs; overflow partial |
| Remaining slot with owner-specific sighting | Recently seen/counting candidate ranks above older offline candidate |
| Failed delta followed by 20 refreshes | One failed delta attempt; no guessed ownership; retry at original deadline |
| Failed delta fills last slot; further new candidate | No additional RPC or grant until a new epoch |
| Sold seat at 29,999 / 30,000 / 30,001 ms | Cached before expiry; reproved/rejected at and after expiry |
| Backward/non-finite time; held RPC crossing rollback/expiry | No future/stale cached authority; failed proof remains unavailable |
| Future D1 date and character success/failure caches | Future date does not replace valid index; negative age invalidates cache/backoff |

Historical v1.1 targeted command: `node --test tests/aud4-discovery.test.mjs tests/review-record.test.mjs tests/ownership.test.mjs tests/ownership-market-r8.test.mjs tests/ownership-v11.test.mjs`: **139 passed, 0 failed/skipped/cancelled**. This includes 28 v1.1 controls and existing Worker/SQLite authority, lane, index/D1, ranking, public-asset and review-document regressions. Eighth-candidate controls live in `tests/ownership-audit8.test.mjs`; current frozen results and full-project build are recorded separately in the submission evidence. Historical results do not substitute for them.

Counterfactual command: run the same new evaluator with `V11_SOURCE` pointing at the frozen deployed parent `f9a34cba0876306287b35aff0176e9dc38942624`. Result: **8 passed / 20 expected failures / 0 skipped/cancelled**; exit 1 is intentional evidence that old behavior is rejected, not a candidate failure. Latest full logs and input hashes are in the private delivery's `evidence/ownership-v11/final-suite-repair/`; earlier 27-control runs are retained in `evidence/ownership-v11/baseline.txt` and `candidate.txt`.

Two legacy fixtures were deliberately updated to express this policy, not to suppress failures: the admitted 0/31/32 test now requires RPC 2 rather than the old 3; the AUD3-01 second-RPC failure fixture includes a genuinely unseen ID so the failing delta still occurs. The existing previous-seat/limited/HTTP 200 expectation remains intact. No wallet method, API, security header, schema/migration, Genesis/Mint/Solidity, 3D or visual change is made by this ownership patch.
