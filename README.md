# IMD Ember World — Audit/Report remediation review package

Review-only source and evidence for the sixth Audit/Report counterexamples: Auth lifecycle, conditional logout authority and public-name cache. The fixed Auth code is deployed. This maintainer package is not independent closure, certification or a zero-defect claim; no new paid review has been submitted by the agent.

| Identity | Exact value |
|---|---|
| Previous public snapshot / public parent | `445747d6a4d4fb6fa4eaa9c67b74e3e2bd9c1703` |
| Auth remediation source | `ff6bed81afe69fddfc006d9ec8e96e3e6448ecc7` |
| Latest deployed source containing identical supplied Auth scope | `e48a94f8951938f889fa3aa963c0a3e9e1df9dfd` |
| Deployment record | `20261004T031821Z-e48a94f` |
| Worker version | `6c505065-798d-4890-b7c7-0c6063d1ae9b` |
| Worker bytes / SHA-256 | 314508 / `afd82f506aceb57ca85ce44ff6c7e65146546d383ae2e2b2b7feca72bd23e92a` |
| Record finished UTC / traffic | `2026-10-04T03:20:14.463Z` / 100% |

Use the immutable commit containing this README; its SHA is supplied separately after sealing. It cannot embed its own commit hash.

- [Finding-by-finding fixes and retained limits](R7/AUTH_REMEDIATION.md), [sixth original Audit/Report mapping](R7/PRIOR_REVIEWS.md).
- [Explicit Auth state machine](source/docs/security/AUTH_STATE_MACHINE.md), [source fingerprints](manifests/r7-published-source.json).
- [Actual public-source validation](R7/PUBLIC_SOURCE_VALIDATION.json), [test scope and failures](R7/TEST_RESULTS.md).
- [Build/deployment correspondence](R7/BUILD_EVIDENCE.md), [sanitized production facts](R7/PRODUCTION_DEPLOYMENT.json), [current inventory](R7/PUBLIC_CONTENT.md).

## Evidence boundary

111 supplied source text files: 95 exact, 16 preserved redactions, 57 masked lines. The published Auth scope has no Git diff between the Auth remediation commit and latest deployment commit. Redacted originals and their new fingerprints remain withheld. New website/avatar/selfie features, all models/textures/media, geometry, full scene/WorldApp, feature tests, private evidence, bundles/maps, credentials/env, owner data and private Git history are omitted. Old public asset filename/hash references are historical references, not payloads or current feature review.

Actual supported public tests: **386/386**, no skips or scene import stubs. Full public TypeScript: **exit2, 16 diagnostics** from intentionally withheld presentation/build dependencies. Full frontend cannot be built from this subset. Independent supplied-source Worker dry-run produced the recorded 314508-byte hash under the documented dependency layout; the first sandbox compiler failure is retained. Private Auth **1357/1357** and complete deployed-source **1392/1392** are separate team evidence, not public execution or external review.

Deployment correspondence remains **partial**: version/traffic metadata, five anonymous GETs, four static hashes, 24 headers and anonymous signed-out session. Functional anonymous browser smoke is a separate team check, not wallet/Auth, production D1, WAF/limiter, concurrency or complete feature proof. No production secrets, logs, export links or static asset inventory are supplied.

World wallet methods remain `eth_accounts`, `eth_requestAccounts`, exact SIWE `personal_sign`. No Solidity/Genesis Mint/Coin E1/0007, token transaction, approval, Permit, batch or delegation is in scope. M1 names remain persistent Web2 writes; ERC-1271 login/read is available while persistent writes retain the documented EOA policy.

The root design documents, R5/R6, old manifests and TESTS describe their pinned historical snapshots. Current results are under R7. Do not rewrite old findings as closed: reproduce the original orderings and judge fixed/partly/open/unknown. R4-03 policy, R4-09 availability, AUD3-05 partly, AUD3-09 review-limit, auth-read stall, cross-cookie authority, late Set-Cookie and best-effort termination limitations remain explicit.
