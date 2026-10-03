# Actual current test outcomes

Full private fixed source: 54410b2f8dece71bdb2fd999c94feea6454ecfcd. Public source copies are the 100 supplied files, installed from the exact unchanged lock completely offline (78 packages). The scratch source-root Git fixture does not contain private historical commits. The table and diagnostic logs below record the local validation phase before production deployment. The public subset and full-source totals describe different populations and must not be added as a coverage percentage.

| Run | Executed | Passed | Failed | Skipped | Result |
|---|---:|---:|---:|---:|---|
| [full-tests.log](logs/full-tests.txt) | 1087 | 1087 | 0 | 0 | passed |
| [public-no-stub.log](logs/public-no-stub.txt) | 239 | 235 | 4 | 0 | failed; limitations below |
| [public-with-stub.log](logs/public-with-stub.txt) | 419 | 414 | 5 | 0 | failed; limitations below |
| [public-focused.log](logs/public-focused.txt) | 83 | 83 | 0 | 0 | passed |
| [public-n.log](logs/public-n.txt) | 42 | 42 | 0 | 0 | passed |
| [public-enter-group5.log](logs/public-enter-group5.txt) | 3 | 3 | 0 | 0 | passed |
| [public-member-aud4.log](logs/public-member-aud4.txt) | 111 | 111 | 0 | 0 | passed |
| [public-presence-performance-recheck.log](logs/public-presence-performance-recheck.txt) | 1 | 1 | 0 | 0 | passed |

## Failures retained

- Without stubs: three entire files fail loading (`home-entry`, `ownership`, `wallet-client`) because withheld households/layout are absent; their individual cases did not execute. The fourth failed case requires private historical commit132228c for deploy-evidence. HEAD migration evidence executes, but later historical checks cannot complete.
- With the two explicitly published throwing stubs: door distance, interior preview/mockSeats and Enter render geometry remain unavailable, plus the same private-history case. The first full run also failed the production-sized presence timing assertion: minimum60.33ms did not meet its <25ms threshold. That original 419/414/5 result remains failed; no case was hidden or silently skipped.
- The unchanged presence performance case was rerun in isolation: five samples29.3/6.9/5.2/4.3/6.0ms, and passed1/1. This is a separate rerun, not proof of why the loaded full run failed, nor a proof of Cloudflare's CPU behavior.
- `npx tsc --noEmit` on public source fails with withheld frontend/module dependencies (actual output supplied). Full private-source tsc and frontend build pass. A public full frontend build was not executed; necessary private scene/bake/UI sources are not supplied.

## Executable targeted regressions

- R3-R1/AUD3/ADV combined83/83, N-prefix42/42, Enter group5 authorization3/3, original M1 plus all new AUD4/M1-R2 files111/111. These runs use only public source and two documented throwing import stubs where required. Prefix selection does not restore geometry or a full WorldApp.
- Tests use real handlers/client classes with node:sqlite and synthetic providers/chain/limiter models. The full private suite is1087/1087 (zero fail/skip); it includes withheld geometry/rendering source but is still not a real-browser/real-wallet production test.
- Fresh local workerd D1 applied final0008; local SQL five attempts/sixth rejection/readback-five passed. Concurrent Worker scenarios use the node:sqlite adapter. Subsequent production schema readback is recorded separately below; production request concurrency remains unverified.

## Source-only Worker rebuild

The public Worker dry-run initially failed due to local sandbox parent-directory access. The exact dry-run command succeeded with a filesystem permission retry, without uploads or remote mutations; both outputs are supplied. The local placeholder dist/index.html only satisfies Wrangler ASSETS directory validation, not a frontend build. After compilation, **public and private index.js are byte-identical**:309594bytes, SHA-256 `c7d7c0fbe49ce601a187bafdf7480c40d64ceda7bcfde64b9aea3f63f809811c`.

Exact commands, UTC and exits are in each diagnostic. A dry run has no deployed versionID. Nodev24.19.0/npm11.17.0/Wrangler4.143.0/TypeScript5.9.3, unchanged lock. No raw private Wrangler logs, worker bundle/maps, credentials or 3D contents are published.

## Not executed / review limits

The local runs above performed no real signatures, transactions, deployments or remote D1 operations. Production D1 request concurrency/quotas/cleanup throughput; real WAF/binding accounting; true multi-location Cloudflare behavior; actual provider event/cookie arrival; real wallets; full public WorldApp/browser hookup; production upstream failures and authenticated repaired routes remain unverified. The schema, deployment and five-GET evidence below narrows specific environment gaps without changing the original local test outcomes.

## Subsequent production operation

After the local phase, production backup completed and migration0008 was applied. Remote readback lists0001–0006 plus0008 and the six new schema objects; their names/types/SQL match the supplied migration. [PRODUCTION_D1.md](PRODUCTION_D1.md) records this separately. No production five/six-attempt fixture, concurrent member requests or deliberate limiter/expiry-load probe was run.

Deployment record `20261003T174551Z-54410b2` reports an additional full-source pre-build run passing1087/1087. This deployment-run result is separate from the table's preserved local log; it does not replace the public239/235/4 or419/414/5 outcomes and is not added to them. The deployment began `2026-10-03T17:45:51.193Z` and finished `2026-10-03T17:48:17.618Z`. [PRODUCTION_DEPLOYMENT.json](PRODUCTION_DEPLOYMENT.json) and the [evidence page](deploy-evidence/20261003T174551Z-54410b2.md) identify version `e491cb71-60ec-4cfe-9db7-b88e52d78ce9`, source54410b2 and the subsequent100% traffic query. Its retained bundle matches the309594-byte/c7d7c0fbe49ce601a187bafdf7480c40d64ceda7bcfde64b9aea3f63f809811c local rebuild.

[LIVE_MATCH.json](LIVE_MATCH.json) records five unauthenticated GETs at `2026-10-03T17:49:09.683Z–17:49:14.844Z`, all200. Four static hashes match the deployment record,24/24 static security-header values match the supplied `_headers`, and the session returns signedIn:false/no-store. No response sets a cookie. These are limited production checks, not a real-wallet login, an authenticated M1 test, or a full deployed-site validation. Independent fifth-review results remain pending.
