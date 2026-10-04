# Actual supplied-source checks and private-team evidence

**386/386 supported public tests passed**, exit0, zero fail/cancel/skip/todo. They ran against the actual 111 sanitized source files, exact unchanged dependencies, and no scene import stubs or private geometry. Raw logs remain private; commands/UTC/counts are recorded in [PUBLIC_SOURCE_VALIDATION.json](PUBLIC_SOURCE_VALIDATION.json).

```text
node --test --test-reporter=tap --test-concurrency=3 tests/auth.test.mjs tests/aud4-auth.test.mjs tests/auth-r5.test.mjs tests/auth-r5-authority.test.mjs tests/member-client.test.mjs tests/member-r4.test.mjs tests/member-r5.test.mjs tests/auth-lifecycle-model.test.mjs tests/auth-r7-authority.test.mjs tests/auth-r7-lifecycle.test.mjs tests/member-r7-cache.test.mjs
```

UTC: `2026-10-04T03:33:46.637704+00:00` → `2026-10-04T03:34:08.006148+00:00`. The 11 named files cover new Auth model/lifecycle/live authority/name cache plus existing auth/member regressions. `auth-r7-fixtures.mjs` defaults to this supplied source; no AUTH_R7_SOURCE override was set. Real Worker routes/migration SQL run on node:sqlite; providers, accounts, upstreams, cookies/channels, clocks and transport/body gates are synthetic/in-memory. No real wallet/session or production request is used. Full wallet-client geometry/UI and withheld scene tests are outside the executed population even though legacy public tests remain available for inspection.

Full public TypeScript **exit2, 16 diagnostics** (15 TS2307 missing presentation/build imports, one derived TS7006). The exact diagnostic list is supplied; full frontend build was not executed because WorldApp/scene/geometry/build dependencies are withheld. This is an explicit subset limit, not a new product failure and not a passing global typecheck.

Worker dry-run first failed at local sandbox ancestor-directory resolution, exit1. A local compiler permission retry passed and produced the exact recorded 314508-byte Worker hash without changing supplied source, rewriting the bundle or adding geometry/stubs. Both runs remain recorded. The empty local ASSETS fixture is not a website/frontend build; generated Worker/map are not published.

Separately, maintainer evidence for exact Auth commit `ff6bed81afe69fddfc006d9ec8e96e3e6448ecc7` is **1357/1357**; canonical deployment on source `e48a94f8951938f889fa3aa963c0a3e9e1df9dfd` ran private full suite **1392/1392**, zero fail/cancel/skip/todo, TypeScript and Vite passed. The latter includes unrelated private presentation feature tests; it is not the 386-test public population, not a public rebuild of those features, and not external review. Team before/after counts appear in AUTH_REMEDIATION.md and remain separately labeled.

Existing TESTS/stubs are historical test-only throwing stand-ins for withheld house geometry. They were not copied into source or used in these new runs. Existing R5/R6 outputs and failures retain their original source/version scope. No live signing, authenticated M1 mutation, production D1 race/cron, WAF/limiter or browser/OS lifetime guarantee follows from these checks.
