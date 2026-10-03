# Sixth-review build and deployment evidence

Fixed private source `1cc61b68b2dc14af83bf5178c9fe057452ba9b46`, parent `54410b2f8dece71bdb2fd999c94feea6454ecfcd`. Public parent `357668f37c75317f79ff2266795636597a707c04`. The commit containing this file is the exact new public snapshot; it cannot embed its own SHA. Use the pinned owner link, not a moving branch.

## Actual production operation

`node scripts/deploy.mjs` ran the full package test command (1183/1183, zero fail/cancel/skip/todo), TypeScript and Vite before upload. Clean working tree, no Vite env files, unchanged lockfile. Record `20261003T214856Z-1cc61b6`, UTC `2026-10-03T21:48:56.252Z` to `2026-10-03T21:50:27.782Z`.

Worker `5022cd62-6f1f-444c-af94-3b68ec359b94`, **314447 bytes**, SHA-256 **`3977c6db6cbff23e9f6aec87092a236c603eac8bf64a7ce0c825d400dd1ad7dd`**. The retained uploaded bundle matches the final full-source dry-run. The separately supplied-source rebuild is described in [PUBLIC_SOURCE_VALIDATION.json](PUBLIC_SOURCE_VALIDATION.json); its placeholders are review fixtures, not a frontend release.

Deployment API: `665f9e0a-8ae6-4a09-ac0d-e919d09fb60c`, created `2026-10-03T21:50:24.590411Z`, this version at 100% traffic. [PRODUCTION_DEPLOYMENT.json](PRODUCTION_DEPLOYMENT.json) contains only allowlisted metadata. Worker bytes/maps, raw deployment logs, model/texture assets, full frontend source/bodies, credentials and backup files are withheld.

The local frontend manifest has 102 files, tree digest `2ab7a5e3ee6b85e2a96bef7a71ae548ebe4af60d41a65530017a82808f40b2ec`. No file inventory containing private presentation assets is added to this snapshot.

## Production verification and limits

Five anonymous GETs were made at least five seconds apart, UTC `2026-10-03T21:51:47.506Z` to `2026-10-03T21:52:11.967Z`: home, built index JS, InteriorView JS, CSS and auth session. All five returned 200. Four static body hashes match the build; six static security headers match 24/24. The session returns signedIn:false/no-store; none sets a cookie. See [LIVE_MATCH.json](LIVE_MATCH.json); raw fetched bodies/headers stay private.

Deployment comparison is **partial**, not full browser/session/write validation. It does not prove all private static assets, wallet UX, deployed concurrent D1 quota/cleanup, WAF/limiter enforcement, upstream behavior or same-origin/phishing interactions.

A private D1 backup was taken before this deployment. Selected migration/schema metadata read before/after is identical: 0001-0006 plus 0008; no 0007 and no migration was applied. This is not a new production parallel-write test. The previous R5 schema readback is historical evidence; local SQLite/workerd tests do not become production concurrency guarantees.

## Rebuilding only the supplied Worker

From a fresh `source/` copy, install exact dependencies (`npm ci --no-audit --no-fund`). Create an empty local `dist/index.html` only to satisfy the ASSETS-directory requirement, then run `wrangler deploy --dry-run --outdir ../worker-rebuild` with metrics disabled. No live deployment or remote migration is part of review. Full frontend TypeScript/build depends on intentionally withheld presentation modules; their failures are documented rather than replaced by production assertions.

Raw byte identity was measured in the recorded same-depth source/dependency-junction layout:314447bytes and the SHA above. An earlier deeper scratch layout produced314846bytes;133 module annotations/CommonJS dependency labels differ by one relative directory level, totaling399bytes. Those actual nonmatching bytes/log fingerprints are retained. No bundle was rewritten or normalized to claim a match. Arbitrary checkout depths or a fresh npm-ci dependency layout are not guaranteed to reproduce the exact hash; reviewers should record their own layout and measured output. See PUBLIC_SOURCE_VALIDATION.json for all three compiler runs and the limits of this comparison.

The fixed source's R5_LOW_REMEDIATION statement of no deployment describes the earlier implementation phase. This file records the later owner-authorized deployment. Earlier R4/R5 evidence and originals are historical and keep their old identities; they are not current test totals or sixth-review verdicts.
