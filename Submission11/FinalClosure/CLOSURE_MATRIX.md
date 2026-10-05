# Audit10 / Report10 six-row closure matrix

Frozen source `e20f6da6d6baa17743a5a01d87055d0761051353`; selected manifest SHA-256 `4c82cd864ef99cede0ecdca6314d15a23e9eddb3446e85dcc123d958c7b7b2fc`; official prior public `c2f21a9ef9e1a093ed2c5808f8a99e4751fde643`. Final public identity is `git rev-parse HEAD` in the containing immutable checkout. TEAM local source evidence is bounded PASS; external Audit11 and RELEASE-READINESS remain UNKNOWN.

| ID | Severity | Issue | Primary source | Regression | Status |
|---|---|---|---|---|---|
| A10-L1 | Low | Passive discovery cleanup retention | [src/world/auth.ts](../../source/src/world/auth.ts) | tests/auth-audit10.test.mjs; tests/auth-lifecycle-model.test.mjs | TEAM CLOSED BOUNDED; external UNKNOWN |
| A10-I1 | Info | Candidate cap ranking clock | [server/ownership.ts](../../source/server/ownership.ts) | tests/ownership-audit10.test.mjs | TEAM CLOSED BOUNDED; external UNKNOWN |
| A10-I2 | Info | Public assets display clock | [server/auth.ts](../../source/server/auth.ts) | tests/ownership-audit10.test.mjs | TEAM CLOSED BOUNDED; external UNKNOWN |
| A10-I3 | Info | Spaced route-prefix path masking | [tests/auth-artifacts.mjs](../../source/tests/auth-artifacts.mjs) | tests/artifacts-audit10.test.mjs; scripts/verify-artifact-closure.mjs | TEAM CLOSED BOUNDED; external UNKNOWN |
| R10-N1 | Info | Non-finite lane persistence/recovery | [server/auth.ts](../../source/server/auth.ts) | tests/ownership-audit10.test.mjs | TEAM CLOSED BOUNDED; external UNKNOWN |
| R10-N2 | Info | Audit9 LOW2 semantic synchronization (test reliability) | [tests/auth-audit9.test.mjs](../../source/tests/auth-audit9.test.mjs) | tests/auth-audit9.test.mjs | TEAM CLOSED BOUNDED; external UNKNOWN |

**A10-L1**: Discovery affects current-life owners; stronger retained revocation reasons cannot be weakened. Uncertain transport/5xx retains original nonce responsibility; conclusive2xx or post-fence409 settles it. No unbounded retry loop; canonical PRESENT remains authoritative while cleanup is retained.

**A10-I1**: Sample the evaluation clock after awaited sightings/candidate-cap work, so expired low IDs cannot crowd out seat257. Preserve checkedAt and index producer timestamps; no authority renewal.

**A10-I2**: Thread live clock from the route and sample after relevant sightings and optional character awaits. Preserve fetchedAt/producer dates and inclusive24h policy; public status is a display hint.

**A10-I3**: Only explicit complete route/log/list grammar is exempt. Actual persisted nested bare/quoted/tab/Unicode-space filename readback masks the whole path; exact routes, network URLs, relative IDs and replay identities survive.

**R10-N1**: Reject invalid or rolled-back temporal authority at preflight/probe/limiter boundaries before durable admission. No Inf/NaN probe/lane row; existing finite probe dates stay finite and normal clocks recover+10m/+60m.

**R10-N2**: Report10 severity remains Info; test reliability is the category. Wait for actual logout completion, not more flush turns or sleeps. Single-file50/50 and supported full-runner10/10 demonstrate bounded stability; no failing test was removed or skipped.

All rows share the frozen full supported715/715 and clean715/715 gates. R10-N2 additionally has semantic single-file50/50 and full-runner10/10. H-S5 adds the spaced-path persistence check without removing or weakening any of the original19 artifact groups. The baseline negative calibration is real assertion failure, not unavailable environment evidence. See [validated counts/stream hashes](TEST_RESULTS.json).
