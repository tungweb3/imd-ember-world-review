# T01–T22 executable review index

This is the candidate's verification index, not a new Swarm verdict. Test files below are under world-source/tests unless prefixed aimarket. Local capacity/private EVM results do not certify production limits/finality.

| Index | Verification and retained evidence |
|---|---|
| T01 | audit6-matrix: every positive journal at exact int64 boundary; isolated storage fault/cooldown. audit6-integration:1025 lawful orders -> exact cap -> healthy peer reward. |
| T02 | audit6-matrix: owed UTC days, duplicate workers, spend/retry/replay; audit6-integration: historical paid entitlement, recovery marker/backup prevents twice-issued rewards. |
| T03 | audit6-matrix: refill/capacity-bound original-price refund stays pending, later exact once. |
| T04 | audit6-matrix: old pending signature cannot bypass current shared gate; legacy paid rights stay in read-only inventory. |
| T05 | audit5 + audit5-adversarial: pause before challenge, after signature/before SQL; job insertion fault atomically rolls back order/debit/challenge. |
| T06 | audit6-matrix: old/partial versions and every required trigger/index/table/column; uncached readiness; audit6-integration: deployed pre0014 World entry refuses. |
| T07 | audit6-matrix: paid pre0015 entitlement persists, forward migration resumes same order once. |
| T08 | aimarket/test_world_trial_audit6.py: expired identity denial/revocation; before/equal/after and malformed expiry. |
| T09 | Python audit6 + original trial tests: network/balance waits crossing expiry, external profile and trial boundary preserves normal holder eligibility. |
| T10 | audit6 + audit6-integration: paid auth deadline−1 reuses and actually mints; equality and after never return an unmineable packet. |
| T11 | audit6-integration + audit5-adversarial: delayed required proof/lost namespace stays held; wall-clock alone cannot release. |
| T12 | audit6-matrix: null/blank/array/empty/unsafe Unicode/deep result; unknown schema refuses new charge. |
| T13 | audit6-matrix: valid explained zero/false/no-signal accepted, no misleading generic emptiness rejection. |
| T14 | audit6-matrix + audit5-adversarial: original refund once, output validation during expired lease cannot stale-finalize; unknown timeout retains same key. |
| T15 | audit6-matrix + audit5-adversarial: SQL wrong mode both directions and deliberate guard-removal calibration. |
| T16 | audit6-matrix: undefined/function/symbol/cycle/BigInt/custom serializer/depth/multibyte auth; stable rejection and no financial writes; wrong order/wallet binding. |
| T17 | audit6-integration: paid-only pause allows actual fee-free free Mint and existing paid-hold consume, refuses new paid auth. |
| T18 | audit6-matrix: partial schema emits coded cron maintenance defer, independent maintenance remains observable. |
| T19 | audit6-matrix + audit5-adversarial: provider query/retry uses original idempotency key; unknown exceptions remain pending; actual delivery is separate release gate. |
| T20 | world-gold-api and original world-gold: current session/owner/origin, concurrent admin CAS/replay, atomic before/after; native D1 admin evidence fact. |
| T21 | audit5-adversarial + audit6-matrix: crash/DB failure/duplicate workers/terminal refund and Mint consume once; original-price obligations never repriced. |
| T22 | audit6-integration + native-journey: SQLite same-chain restore, owed-aware recovery; audit6-matrix: bounded read-only exceptions, no clean claim for incomplete schema. |

Exact file names are world-gold-audit6*.test.mjs, world-gold-audit5*.test.mjs and world-gold-native-journey.test.mjs. Full retained original suites also exercise UTC full days, withdrawal, price-version immutability, duplicate receipts, payload binding and auth/session races. The complete selected test list is manifests/selected-source.json.
