# Sixth snapshot test results and unavailable checks

These are maintainer measurements, not independent sixth-review findings. Synthetic tests, complete private-source tests, supplied-source tests and production checks have separate populations.

| Population | Executed / pass | Fail / cancel / skip | Result |
|---|---|---|---|
| Final private-source local package gate at1cc61b6 | 1183 /1183 | 0 /0 /0 | TypeScript/Vite pass; initial Wrangler sandbox read refusal, isolated local compiler retry pass |
| Formal deployment package gate at1cc61b6 | 1183 /1183 | 0 /0 /0 | TypeScript/Vite pass; successful real upload; retained Worker matches314447B/SHA3977c6db... |
| Public-source three new R5 files, no scene stubs | 96 /96 | 0 /0 /0 | Auth49,authority36,member11 |
| Public-source four existing auth/member files, no scene stubs | 116 /116 | 0 /0 /0 | auth.test,aud4-auth,member-client,member-r4 |
| Public disjoint supported subset (seven files above) | 212 /212 | 0 /0 /0 | Not the private1183 or a full public/browser suite |

The two1183 runs are repeated validations of the same complete population, not2366 unique cases. The public96/116 groups are disjoint; their212 total is a supported subset. No test result proves absent unknown vulnerabilities or deployment/browser correctness beyond its scenario.

Public commands, exact timestamps, safe log digests, fixture descriptions and all compiler runs are in [PUBLIC_SOURCE_VALIDATION.json](PUBLIC_SOURCE_VALIDATION.json). Raw diagnostic logs and generated bundles/maps remain private outside the snapshot. Real handlers/routes/migrations/node:sqlite are used with in-memory generated EOA keys signing exact synthetic SIWE. Provider/upstream/timer controls are fixtures, not real wallets/production D1. New tests log state/order, prompt/session counts and pending challenge changes without credentials.

## Supported public reproduction

In a scratch copy with exact dependencies, run:

```
node --test --test-concurrency=3 tests/auth-r5.test.mjs tests/auth-r5-authority.test.mjs tests/member-r5.test.mjs
node --test --test-concurrency=3 tests/auth.test.mjs tests/aud4-auth.test.mjs tests/member-client.test.mjs tests/member-r4.test.mjs
```

No private presentation code or import stubs were added for those runs. Source-only Worker compile uses an empty local dist/index.html asset placeholder, not a website/deployment. Same-depth raw Worker rebuild matches the uploaded Worker; the deeper-layout output differed399bytes/133 dependency-relative labels and is also recorded, not normalized away. Checkout/npm-ci layouts can affect raw bytes.

## Actual failures and withheld dependencies

Public `tsc --noEmit` exited2 with16 diagnostics:15 TS2307 missing deliberately withheld presentation modules and one derived TS7006 implicit-any diagnostic. These are listed in the validation JSON. Complete public frontend build was not run because the full WorldApp/terrain/scene modules are intentionally withheld. Public wallet-client presentation-import coverage also has withheld dependencies; no scene stubs were added this round. Complete private1183 includes those legacy regressions, but its pass count is team evidence and not independently replayable from this104-file subset alone.

The first public Worker compile hit sandbox ancestor-directory AccessDenied. A permitted deeper-layout compile succeeded but did not raw-match the target. A third same-depth compile succeeded and raw-matched. All outputs/digests are recorded separately. The final full-source local pipeline likewise had only Wrangler permission failure after passed tests/tsc/Vite, then a standalone successful compiler retry. Formal deployment reran the full gate and succeeded.

Previous R5 TEST_RESULTS describes old239/419 populations, failures and stubs at prior snapshot357668f. It remains historical evidence and does not supply this round's counts. Parent-source four principal auth counterexamples and backward-clock member counterexample were reproduced as failures in the private baseline fixture; originals and run digests are retained in owner records. The public Git history contains old public source, not the private source history.

## Limits requiring independent assessment

Real wallet UX, OS/browser clock correction/suspension, full WorldApp browser integration, production concurrent member/profile writes and cleanup throughput, current WAF/limiter refusal accounting/bindings, upstream/multi-network behavior and indefinite real auth-read stalls were not exercised by these local runs. Teardown request delivery after offline/process termination remains best effort. Five post-deploy GETs/version metadata are partial deployment correspondence. R4-03 smart-wallet-write policy, R4-09 availability, AUD3-05 partly, AUD3-09 review-limit, no-token cross-session authority and delayed cookie-clear timing remain explicit.

The fourth Low is client cooldown availability: monotonic elapsed schedules a GET; valid server time determines unlock. Tests use independent wall/elapsed/server clocks and early/late callback gates. They do not claim an actual OS clock/background-tab experiment. No migration, Mint/Solidity/Coin E1/0007 or asset-signing capabilities were added.
