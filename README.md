# IMD Ember World - fifth Low remediation, sixth closure-review snapshot

World/Auth/Member M1 repairs for the four new Low findings from the fifth Audit. The fixed source is deployed; independent sixth Report/Audit are pending. This is the maintainer's repair/verification record, not a certification.

| Identity | Exact value |
|---|---|
| Fifth public snapshot / this snapshot's parent | `357668f37c75317f79ff2266795636597a707c04` |
| Private fixed/deployed source | `1cc61b68b2dc14af83bf5178c9fe057452ba9b46` |
| Private source parent | `54410b2f8dece71bdb2fd999c94feea6454ecfcd` |
| Deployment record | `20261003T214856Z-1cc61b6` |
| Worker | `5022cd62-6f1f-444c-af94-3b68ec359b94` |
| Worker bytes / SHA-256 | 314447 / `3977c6db6cbff23e9f6aec87092a236c603eac8bf64a7ce0c825d400dd1ad7dd` |
| Deployment UTC | `2026-10-03T21:48:56.252Z` - `2026-10-03T21:50:27.782Z` |
| Post-deploy traffic | 100%; deployment `665f9e0a-8ae6-4a09-ac0d-e919d09fb60c` |
| D1 | 0001-0006 plus 0008, pre/post selected metadata identical, no migration applied |

Use the commit containing this README for the sixth review; its exact SHA is supplied in the owner handoff after committing. A file cannot embed the hash of its containing commit.

- [Four Low remediation and limits](source/docs/security/R5_LOW_REMEDIATION.md).
- [Source fingerprints and preserved redactions](manifests/r6-published-source.json).
- [Build/deployment correspondence](R6/BUILD_EVIDENCE.md), [production allowlist](R6/PRODUCTION_DEPLOYMENT.json), [five GETs](R6/LIVE_MATCH.json).
- [Public-source validation](R6/PUBLIC_SOURCE_VALIDATION.json) and [current test results](R6/TEST_RESULTS.md).
- [Fifth results and closure scope](R6/PRIOR_REVIEWS.md), [current public inventory](R6/PUBLIC_CONTENT.md).

Full private-source package suite1183/1183, including96 new regressions (49auth/36authority/11member); no tests skipped. Public supported-subset results are separate and exact, including intentionally withheld-source/typecheck/frontend limits. Full/private, supplied-source, synthetic fixtures and production checks are distinct evidence levels. Worker rebuild comparison does not make full presentation sources public.

## Publication boundary

104 source text files:88 exact and16 preserved redactions,57 masked lines. Original redacted-source fingerprints are withheld. No website 3D models, textures, scene geometry, full WorldApp, media binaries, generated Worker bundle/maps, secrets/env, D1 exports/backup/download links, raw logs or private Git history are included. Old asset filename/hash references are not asset contents. The public repository uses its existing public-only history.

No Genesis Mint, Solidity, Coin E1/0007, check-in/rewards or new token/NFT transactions/approval/Permit/batch/delegation capabilities were added. World wallet methods remain eth_accounts,eth_requestAccounts,personal_sign. Public M1 names are persistent Web2 writes; World is not wholly read-only. EOA M1 is separate from on-chain assets; legitimate ERC1271 login/read remains available while persistent writes stay disabled by documented policy.

## Sixth review

Targeted World/Auth/M1 closure: verify the four fifth Low findings, R4-02 old/new lifecycle event orderings, R4-08 clock/timer/server reconciliation and R4-01 context-binding guards. Preserve no-duplicate-prompt, newer-session/challenge isolation and old owner/session boundaries. Separate reproduced facts, team claims, inferences and unknowns; judge findings fixed/partly/open/unknown, retain residuals and review limits.

The old root design documents, R5 artifacts, old manifests and TESTS record prior snapshots. Fixed-source implementation documents describe their pre-deployment phase. This README and R6 metadata record the later deployment; no prior result is rewritten as a sixth verdict. R4-02/R4-08 await independent closure; R4-03 policy, R4-09 availability, AUD3-05 partly and AUD3-09 review-limit remain. Late cookie-clear transport and best-effort delivery limits are explicit. Five anonymous GETs and version metadata provide partial deployment correspondence, not real-wallet/full-browser/production concurrency or a fund-safety proof.
