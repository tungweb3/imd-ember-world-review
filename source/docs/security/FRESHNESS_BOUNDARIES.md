# R8 v1.1 freshness and numeric boundaries

Policy frozen 2026-10-04. `isFreshAge(now, stamp, ttl)` requires finite operands, positive finite TTL, and `0 <= age < ttl`. Exact TTL is expired. No future timestamp tolerance is granted to market quotes; the former 10-second tolerance and inclusive endpoint are removed deliberately. The market regression now asserts both TTL-minus-one and exact TTL.

## Clock domains and coverage

| Surface | Clock / policy |
| --- | --- |
| Auth session read, home minimum gap, retained home success | injected client epoch clock, finite nonnegative age; expiry and SIWE wall timestamps retain their separate server/message semantics |
| Ownership proof, candidate/discovery admission, failed index backoff | Worker injected epoch clock; proof checkedAt and discovery time independent; see ownership policy |
| Public-name cache and cached lookup scheduling | client epoch time with shared age guard; names remain display only |
| Early snapshot | local recorded epoch read age; negative/nonfinite age discards early read |
| Market extras retry and success | separate actual attempt stamp and TTL (60 seconds on failure, 15 minutes on success); never synthesize a future stamp to represent a retry |
| Quote / floor fetchedAt | remote epoch time compared to client epoch time; invalid/future values cannot be current |
| World polling classification | invalid/future source fetchedAt cannot count as a good read; old valid data gets the existing bounded follow-up policy |
| Member rename cooldown | existing server-calibrated epoch estimate advanced by monotonic elapsed time; local timer only schedules server reconciliation, never grants rename permission |

No local `performance.now()` value is subtracted from a remote epoch timestamp. A backward client epoch change forces scoped cache re-evaluation rather than extending cached authority. The runtime still cannot discover a revocation/transfer without performing the next canonical read; periodic Auth reconciliation remains essential.

## Numeric UI boundary

`marketQuoteOf` normalizes the direct and Worker fallback quote at `marketView`, before UI consumers. Main price must be finite and positive. Native price is finite/positive or null. Market cap, liquidity, volume and trade counts are finite/nonnegative or null. Changes may be finite negative numbers. Optional malformed fields do not discard an otherwise valid primary quote. Pair/provider metadata is normalized with the existing allowed source defaults.

`floorView` requires finite positive ETH floor and valid nonnegative age. A finite positive USD fallback may survive when a new quote cannot price the floor; invalid USD is omitted. Existing `ethUsd` and `withUsd` finite operand/product protections are preserved. A JSON exponent such as `1e999` may parse as Infinity, so a TypeScript cast alone is insufficient.

## Scope limits

The visual day/night clock, synchronized boats, animation frame interpolation, beacon/arrival lamp cooldowns, milestone storytelling and music fades are not session/ownership/name-write authority and are unchanged. They are explicitly excluded from this targeted security cache patch. Initial upstream `selectFloor` preserves any parsed retrieval time, including a future value that the UI then hides. A missing/unparseable upstream time uses the initial fetch observation time; cached merge failures never rewrite existing fetchedAt to now. Real OS/provider scheduling and regional clock drift remain external behavior, not covered by deterministic local fixtures.

## Controls

`tests/freshness-v11.test.mjs` runs the same product evaluator against baseline and candidate via `R8_SOURCE`. It includes malformed wire numbers, valid negative changes, future stamps, exact deadlines, backward successful extras cache, backward failed retry, cadence, and public names. Baseline failure is expected and retained as calibration, separately from candidate regression results.
