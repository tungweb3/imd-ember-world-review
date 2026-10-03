# Current build and production deployment boundary

Fixed private source `54410b2f8dece71bdb2fd999c94feea6454ecfcd`, parent `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`. Public candidate parent `6e307dea76e763936fc4ac86e54c9f5d558f58c4`.

- Windows, Node v24.19.0, npm 11.17.0, exact unchanged package-lock, Wrangler4.143.0, TypeScript5.9.3.
- Full source: `npm run build` (`tsc --noEmit && vite build`) passed; 102 dist files. Model/texture/frontend output files and their private inventory are withheld.
- Pre-deployment full-source Worker: `npx --no-install wrangler deploy --dry-run --outdir ../worker-private` passed after a local filesystem-permission retry. That dry run uploaded nothing.
- Worker: **309594 bytes**, SHA-256 **`c7d7c0fbe49ce601a187bafdf7480c40d64ceda7bcfde64b9aea3f63f809811c`**.
- Sanitized-source-only Worker dry-run passed. Its index.js is byte-identical to the full-source Worker (309594 bytes, the SHA-256 above). Actual initial sandbox failure and successful retry are recorded in TEST_RESULTS.md. No withheld scene code was used to generate that Worker.
- Before this deployment, production ran `acdbb2bd-8add-4b15-bfa6-a31266c83520`,303128bytes,SHA-256 `cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518`, source `ddb10e28a867998323164e7585635efedfcf7788`. The pre-deploy query confirmed that version at100%.

## Production deployment and five GETs

After the local repair/validation phase, `node scripts/deploy.mjs` deployed fixed source `54410b2f8dece71bdb2fd999c94feea6454ecfcd`. Record `20261003T174551Z-54410b2` starts at `2026-10-03T17:45:51.193Z` and finishes at `2026-10-03T17:48:17.618Z`. The deployment run's full-source tests passed1087/1087 before build.

The retained upload bundle is309594bytes, SHA-256 `c7d7c0fbe49ce601a187bafdf7480c40d64ceda7bcfde64b9aea3f63f809811c`, identical to both supplied-source and full-source local Worker rebuilds. Its new Worker version is `e491cb71-60ec-4cfe-9db7-b88e52d78ce9`. The post-deploy query's latest deployment is `ed848a16-21ba-43d8-8b95-4ff3183f7732`, created `2026-10-03T17:48:14.840676Z`, with that version at100% traffic. These structured fields are in [PRODUCTION_DEPLOYMENT.json](PRODUCTION_DEPLOYMENT.json) and the [deployment evidence page](deploy-evidence/20261003T174551Z-54410b2.md); raw private deployment logs and bundle files are withheld.

[LIVE_MATCH.json](LIVE_MATCH.json) records five unauthenticated GETs at `2026-10-03T17:49:09.683Z–17:49:14.844Z`: `/`, `/assets/index-CIkdCwRI.js`, `/assets/InteriorView-B7dudNwf.js`, `/assets/index-BZpalHf7.css`, and `/api/auth/session`. All five returned200. The four static body hashes match the deployment record and the six static security-header values match `source/public/_headers`24/24. The session returns signedIn:false/no-store. None of the five responses contains Set-Cookie. The session's API headers are separate from the static24-value comparison.

Deployment comparison remains **partial**. Retained artifact hashes, version/traffic metadata and these four static responses establish the listed correspondence. They do not verify all102 deployed dist files, real-wallet login, production M1 writes/concurrency, cron throughput, WAF/limiter accounting, upstream behavior or complete browser/WorldApp integration. Only structured metadata/hashes are published, with no fetched JS/CSS bodies, model/texture/scene bytes, Worker bundle or source maps.

## Local D1 validation

A fresh local workerd-backed D1 applied all seven migrations0001–0006 plus final0008 successfully using `wrangler d1 migrations apply imd-world --local --persist-to ../d1-local-final`. The six new schema objects were read back. A local fixture inserted five attempts in one member's minute; the sixth failed with MEMBER_WRITE_RATE_LIMIT/SQLITE_CONSTRAINT_TRIGGER, and readback remained five. This is local SQL/runtime evidence, not a production concurrent-request guarantee. Parallel route reproductions use the separate node:sqlite adapter suite.

0008 adds the M1 write-budget trigger, two expiry indexes and independent discovery-probe table/two indexes. It deliberately does not include Coin migration0007. Those local checks preceded the separately authorized production operation: backup completed,0008 applied, and the remote readback lists seven migrations and all six new schema objects with matching SQL. See [PRODUCTION_D1.md](PRODUCTION_D1.md). The schema readback does not turn the local five/six-attempt fixture into a production concurrency test.

## Rebuilding the supplied Worker

In a fresh copy of `source/`, install exact dependencies with `npm ci --no-audit --no-fund`. Create an empty local `dist/index.html` only to satisfy Wrangler's ASSETS directory requirement (the full frontend requires withheld scene sources). Set CI=1 and WRANGLER_SEND_METRICS=false, then run `npx --no-install wrangler deploy --dry-run --outdir ../worker-rebuild`. Hash the resulting index.js. The placeholder is not a website build or a deployed artifact. Do not run ordinary deploy or remote migration commands as part of review.
