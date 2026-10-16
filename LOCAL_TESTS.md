# Local second-recheck evidence boundary

The fixed product checkpoint `adb13e9a98a3505229dbd866c6c268bca790d057` passed this local packet selected runner with native exit 0: portable contract build/projection check and 29/29 contract tests, then 188/188 financial tests across fourteen files. Both groups have zero failures, cancellations, skips and todos. The new payload-roundtrip and preflight identity regressions executed in this run. [Sanitized receipt](evidence/selected-verification.json). No external submission, quote, payment, Swarm acceptance or deployment is performed.

This round uses previously independently cold-installed physical dependencies through ignored local `node_modules` junctions. Both package locks remain byte-identical to that measured installation. No new `npm ci`, dependency upgrade or lifecycle script is executed in this round; it must not be labelled another fresh installation. No dependency links or generated private evidence belong to the 132-file publication allowlist. The immutable containing public Git commit and final public-Git checkout verification are separate publisher gates. No external Swarm result or release-readiness conclusion is claimed.

All 132 allowlisted payload files remained byte-identical across execution. Only measured result documents, sanitized receipts and dependent contract manifests were updated afterward; executable sources, locks, compiler, artifacts and runner bytes remain the tested bytes. The earlier sealed review package and its 129 allowlisted bytes remain unchanged. This new packet has no Git publication or external submission attached to this result.

The private product source has its own native local test/build/integration evidence. Do not copy raw private receipts or transplant their counts as a result of this public projection. A clean public checkout must independently reproduce the selected modules and portable tooling.

Run from the packet root after dependencies are installed from the two exact locks:

```sh
npm run verify:source
npm run verify:privacy
npm run test:contracts
npm run test:financial
```

`npm test` runs both test stages sequentially. `test:financial` reads the manifest's explicit file list, including adversarial, API, client, local-EVM journey, forwarded-call/constructor/batch receipts, ledger, migration/restore, pane lifecycle, finalized RPC, bounded settlement, busy-block staging, actual EDR payment timing and mocked-provider wallet recovery tests. The runner creates ignored `release/` and `.rd/recheck-2026-10-16/ledger/` outputs for the actual tests. It excludes `economy-worker.test.mjs`; the complete private Worker/World suite is a separate gate. Every selected assertion must execute; no skip or failure may be relabelled a pass.

Retain native exit codes, actual stdout/stderr, test/pass/fail/cancel/skip counts, exact submitted public commit and source/artifact/lock manifest hashes. The measured selected-tree receipt distinguishes this isolated new-source copy with reused pinned dependencies from the complete private product suite and browser QA. The final publisher must independently verify the containing public Git checkout against the sealed publication allowlist and retain full private product measurements; this receipt must not be relabelled as either gate.

No real wallet transaction/signature, mainnet deployment, production D1 write, R3/8958 reset or external paid audit is part of these tests. Synthetic EDR chain 31337 and generated/test fixture identities remain local. Workers CPU 50 ms, D1 production capacity, large-population latency, large batched receipts, a malicious provider omitting logs and real extension UX are not established by desktop test timing. A valid block above the 10,000-event engineering cap can stall indexing; contract accounts may accrue GOLD but cannot use the current EOA-only GOLD payment authorization.
