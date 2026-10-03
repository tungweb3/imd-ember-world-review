# IMD Ember World — R4/AUD4 fixes, fifth-review candidate

This snapshot contains the team's repairs for the eight fourth-Audit findings plus the Report's independent M1-R2. Report M1-R1 and Audit #5 share one atomic-budget fix: nine unique fixes in World/Auth/Member M1. The repaired source was deployed on 2026-10-03 UTC, after production migration0008. A post-deploy query lists the new Worker at 100% traffic. Independent fifth-review results are still pending.

| Identity | Exact value |
|---|---|
| Prior reviewed public commit / this candidate's public parent | `6e307dea76e763936fc4ac86e54c9f5d558f58c4` |
| Private fixed source commit | `54410b2f8dece71bdb2fd999c94feea6454ecfcd` |
| Private fixed parent | `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c` |
| Deployed and public/private rebuilt Worker | `e491cb71-60ec-4cfe-9db7-b88e52d78ce9`; 309594 bytes; SHA-256 `c7d7c0fbe49ce601a187bafdf7480c40d64ceda7bcfde64b9aea3f63f809811c` |
| Deployed source | `54410b2f8dece71bdb2fd999c94feea6454ecfcd` |
| Deployment record | `20261003T174551Z-54410b2` |
| Deploy start / finish UTC | `2026-10-03T17:45:51.193Z` / `2026-10-03T17:48:17.618Z` |
| Post-deploy traffic | New version 100%, deployment `ed848a16-21ba-43d8-8b95-4ff3183f7732`, created `2026-10-03T17:48:14.840676Z` |
| Production schema readback | 0001–0006 plus `0008_member_hardening.sql`, seven migrations and six new schema objects; no Coin 0007 |

Use the exact commit containing this README for review, rather than a moving branch. Its own SHA is supplied in the owner handoff after committing; a file cannot embed the SHA of the commit containing itself.

## Current evidence

- [Nine-finding implementation and regression matrix](source/docs/security/AUD4_REMEDIATION.md).
- [Contract-write policy, atomic attempts and retention](source/docs/security/AUD4_MEMBER_POLICY.md).
- [Independent discovery probes and admitted-capacity limits](source/docs/security/AUD4_DISCOVERY.md).
- [Build/deployment comparison](R5/BUILD_EVIDENCE.md).
- [Sanitized production deployment fields](R5/PRODUCTION_DEPLOYMENT.json) and [deployment evidence page](R5/deploy-evidence/20261003T174551Z-54410b2.md).
- [Production D1 migration and schema readback](R5/PRODUCTION_D1.md).
- [Five post-deploy GETs and static hashes/headers](R5/LIVE_MATCH.json).
- [Actual tests and withheld-dependency limits](R5/TEST_RESULTS.md).
- [Current public inventory](R5/PUBLIC_CONTENT.md) and [source fingerprints](manifests/r5-published-source.json).
- [Unedited fourth-review originals and hashes](R5/PRIOR_REVIEWS.md), supplied for offline retesting.
- [Prior reviewed snapshot](https://github.com/tungweb3/imd-ember-world-review/tree/6e307dea76e763936fc4ac86e54c9f5d558f58c4).

The other root-level design/scope documents, old manifests and legacy TESTS describe the **fourth snapshot**, with a history notice. Their old source counts, test totals and deployment-match claims are not current results. The fixed source's AUD4 policy/remediation documents record the implementation stage before this deployment; their statements that no remote operation occurred apply to that stage. R5 production evidence records the subsequent deployment and D1 operations. Earlier external findings retain their original snapshot/status distinctions.

## Publication and scope

The public source contains 100 files: 84 exact fixed-source blobs and 16 preserved redactions (57 masked lines). This extends the previous 92-file allowlist by eight scoped docs/migration/tests. No 3D model, texture, scene geometry, full WorldApp, music/video, private Git objects, secrets, worker bundle or source map is supplied. Asset filenames and previously public fingerprints may be mentioned; references are not asset contents. Source lines align with fixed source, and original redacted blob fingerprints remain withheld.

No Genesis Mint, Solidity, Coin E1/0007, check-in/economy mutations, token/NFT transactions or approvals, Permit/Permit2, wallet batches/delegated permissions/session keys, unrelated game/UI redesign were added. World keeps `eth_accounts`, `eth_requestAccounts`, and exact-SIWE `personal_sign`. House rights derive from live authenticated address and Ethereum mainnet ownerOf/seat eligibility, not M1 names.

Legitimate ERC1271 wallets retain login/read but temporarily cannot perform persistent M1 writes; unknown verification metadata fails the same policy. This restriction is explicit, not claimed as complete smart-wallet write support.

## Independent review request

Retest AUD4-01–08, Report M1-R1 and M1-R2, including their distinct controlled reproductions. Preserve R3-R1/AUD3/N/ADV and Enter/Home invariants. Separate strict DB invariants from infrastructure and best-effort availability limits. Assess request-time context checks, late cookie timing, same-id unknown PUT recovery, 5/member/min concurrency, retention/probe backlog and both refused-limiter accounting models.

Production schema definitions and version/traffic readback are now recorded. The five post-deploy GETs at `2026-10-03T17:49:09.683Z–17:49:14.844Z` all returned 200: four static body hashes match the deployment record, their six security headers match24/24, and the anonymous session returns signedIn:false/no-store with no Set-Cookie. Deployment comparison remains partial: these checks do not establish production D1 concurrency/quotas/cleanup throughput, bindings/WAF/limiter accounting, real-wallet behavior, full WorldApp/browser integration, upstream availability, same-origin injection/relay or multi-network/shared-network availability. Output completion is not a claim of no vulnerabilities or a certification.

The fourth completed jobs are [Audit f3e7cfc7](https://explorer.imd.fun/jobs/f3e7cfc7-0b43-473a-9c0f-6931cf278c56) and [Report 1dbe2282](https://explorer.imd.fun/jobs/1dbe2282-d61a-42a8-9823-2b24e48d29c1). Their findings apply to their old snapshot; current fix status and deployment evidence are team records, pending independent re-review.
