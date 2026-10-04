# R8 v1.1 freshness and numeric boundaries

Authority and local-cache policy remains frozen: `isFreshAge(now, stamp, ttl)` requires finite operands, positive finite TTL, and `0 <= age < ttl`. Exact TTL is expired. Audit8 explicitly separates public remote epoch samples from authority. The existing gateway shared-copy tolerance of 60 seconds is now the single formal public transport/display policy, `-60000 <= age < ttl`; its inclusive lower bound and half-open TTL are tested. This supersedes the previous zero-skew market/display rule that caused persistent retries with a slightly ahead Worker clock. It does not relax login, ownership, local retry timers or member writes.

## Clock domains and coverage

| Surface | Clock / policy |
| --- | --- |
| Auth session read, home minimum gap, retained home success | injected client epoch clock, finite nonnegative age; expiry and SIWE wall timestamps retain their separate server/message semantics |
| Ownership proof, candidate/discovery admission, failed index backoff | Worker injected epoch clock; proof checkedAt and discovery time independent; see ownership policy |
| Public-name cache and cached lookup scheduling | client epoch time with shared age guard; names remain display only |
| Early snapshot | local recorded epoch read age; negative/nonfinite age discards early read |
| Market extras retry and success | separate actual attempt stamp and TTL (60 seconds on failure, 15 minutes on success); never synthesize a future stamp to represent a retry |
| Quote / floor fetchedAt | remote epochs; finite signed age in the formal 60-second skew bound, half-open TTL; original producer timestamp preserved |
| World polling classification | same remote bound; bounded skew keeps the 15-minute cadence; beyond-bound/nonfinite values fail; old valid data gets the existing bounded follow-up |
| Shared gateway copy | same remote bound; fetchedAt is retained, never clamped to local now; TTL is anchored to producer fetchedAt |
| Member rename cooldown | existing server-calibrated epoch estimate advanced by monotonic elapsed time; local timer only schedules server reconciliation, never grants rename permission |

No local `performance.now()` value is subtracted from a remote epoch timestamp. A backward client epoch change forces scoped cache re-evaluation rather than extending cached authority. The runtime still cannot discover a revocation/transfer without performing the next canonical read; periodic Auth reconciliation remains essential.

## Numeric UI boundary

`marketQuoteOf` normalizes the direct and Worker fallback quote at `marketView`, before UI consumers. Main price must be finite and positive. Native price is finite/positive or null. Market cap, liquidity, volume and trade counts are finite/nonnegative or null. Changes may be finite negative numbers. Optional malformed fields do not discard an otherwise valid primary quote. Pair/provider metadata is normalized with the existing allowed source defaults.

`floorView` requires finite positive ETH floor and a valid public remote age. A finite positive USD fallback may survive when a new quote cannot price the floor; invalid USD is omitted. Existing `ethUsd` and `withUsd` finite operand/product protections are preserved. A JSON exponent such as `1e999` may parse as Infinity, so a TypeScript cast alone is insufficient.

## Scope limits

The visual day/night clock, synchronized boats, animation frame interpolation, beacon/arrival lamp cooldowns, milestone storytelling and music fades are not session/ownership/name-write authority and are unchanged. Initial upstream `selectFloor` preserves any parsed retrieval time; values beyond the remote skew bound are hidden. Missing/unparseable retrieval time uses initial observation time, while cached merges never rewrite an existing stamp. Public data freshness is display/scheduling only: it cannot grant a session, prove ownership, write a name, or bypass canonical reconciliation. Actual global clock offsets and real provider/browser scheduling are not guaranteed by deterministic fixtures.

## Controls

`tests/freshness-v11.test.mjs` retains strict local/authority and malformed numeric controls. `tests/clock-skew-audit8.test.mjs` covers Worker offsets +1s, +5s, +60s, +60s+1ms, repeated polling, retained shared timestamps, exact TTLs and strict authority's rejection of +1ms. The same new evaluator fails the frozen seventh candidate before the public-clock repair; those private calibration logs are separate from current candidate results.
