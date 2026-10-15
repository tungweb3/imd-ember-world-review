# Local test evidence boundary

Fixed product pin `5c4922a8a8004e071a53974884251b9171e2ec6a` passed the independent cold-dependency selected-package runner with native exit 0: portable contract build/projection check and 26/26 contract tests, then 136/136 financial tests across eleven files. Both groups have zero failures, cancellations, skips and todos. [The measured receipt](evidence/selected-verification.json) records the exact source/artifact/lock hashes, actual counts and limits. The forwarded-call, constructor, batch and unrelated LOG0 regressions executed in this run.

Both selected World and portable-contract dependencies were independently installed into a clean physical copy using exact locks, Node 24.19.0 and `npm ci --ignore-scripts --no-audit --no-fund`; both native installs exited 0. Installation scripts remained disabled; no dependency was upgraded or copied through a junction. Source changes for the new fixed checkpoint were copied into that cold-installed tree without changing either lock, then the complete selected runner passed. All 129 allowlisted payload files were byte-identical before and after execution. Subsequent edits record these results only; executable sources, manifests and runner bytes remain the tested bytes. The immutable containing public Git commit and final public-Git checkout verification are separate publisher gates. No external Swarm result or release-readiness conclusion is claimed.

The private product source has its own native local test/build/integration evidence. Do not copy raw private receipts or transplant their counts as a result of this public projection. A clean public checkout must independently reproduce the selected modules and portable tooling.

Run from the packet root after dependencies are installed from the two exact locks:

```sh
npm run verify:source
npm run verify:privacy
npm run test:contracts
npm run test:financial
```

`npm test` runs both test stages sequentially. `test:financial` reads the manifest's explicit file list, including adversarial, API, client, local-EVM journey, forwarded-call/constructor/batch receipts, ledger, migration/restore, pane lifecycle, finalized RPC, bounded settlement and busy-block staging tests. It excludes `economy-worker.test.mjs`; the complete private Worker/World suite is a separate gate. Every selected financial assertion must execute; no skip or failure may be relabelled a pass.

Retain native exit codes, actual stdout/stderr, test/pass/fail/cancel/skip counts, exact submitted public commit and source/artifact/lock manifest hashes. The measured selected-tree receipt distinguishes this clean-copy/cold-dependency run from the complete private product suite and browser QA. The final publisher must independently verify the containing public Git checkout against the sealed publication allowlist and retain full private product measurements; this receipt must not be relabelled as either gate.

No real wallet transaction/signature, mainnet deployment, production D1 write, R3/8958 reset or external paid audit is part of these tests. Synthetic EDR chain 31337 and generated/test fixture identities remain local. Workers CPU 50 ms, D1 production capacity, large-population latency, large batched receipts, a malicious provider omitting logs and real extension UX are not established by desktop test timing. A valid block above the 10,000-event engineering cap can stall indexing; contract accounts may accrue GOLD but cannot use the current EOA-only GOLD payment authorization.
