# Reproducible local verification

Node24 (validated with24.19.0) and Python3 stdlib are required. Financial tests use SQLite, React test rendering and isolated private EDR; contract tests rebuild the original Solidity fixture and check projections. No real network, keys or production DB is needed. Follow exact package locks in DEPENDENCIES.md.

1. `node tools/verify-source.mjs`
2. Install the exact locks in `world-source` and `contracts` in your own review directory.
3. `node tools/run-contract-tests.mjs`
4. `node tools/run-selected-financial-tests.mjs`
5. From `aimarket`: `python -m unittest -v test_world_trial test_world_trial_audit5 test_world_trial_audit6`
6. `node tools/scan-public-tree.mjs`

The final fixed-source results are recorded in evidence/packet-validation.json after completion, not inferred from a partial run. Full World TypeScript/build/dry-run results come from the private complete World checkout; this selected packet omits unrelated artwork and the full Worker regression suite. Local workerd D1 runs the exact SQL through migrations0016 and the complete schema inventory; it proves local D1 behavior, not production capacity.

Initial unmodified-source Node reproductions:9 expected failures. The isolated Python baseline reproduces2 product errors; its initial launcher/temp-directory failure is not counted as a product reproduction. Cross-path reinspection additionally caught stale payment time after schema I/O; before and after evidence is retained. Early obsolete historical schema fixtures and a mock-clock assignment error were corrected transparently; assertions were not removed or finance tests skipped. Sanitized logs retain failures, while machine-local originals remain outside this export.

The final verification reuses an existing exact-lock dependency runtime via local-only junctions. No fresh npm install or independent clean-room dependency download is claimed. Source/export manifests distinguish byte-exact source from narrowly documented portable resolver/artifact-filename adaptations.

## Final fixed-source results

World source `41ca333db50696a0a2f4c886d6fe7171637908cc`: **2872 total / 2867 passed /0 failed /5 existing skips**. Portable selected finance: **433/433**; portable Solidity:**30/30**; portable Python:**18/18**. TypeScript/build/Worker dry-run (no upload) passed. Local workerd D1 ran the exact production migrations through0016 and the112-object inventory:9 facts passed, production capacity unproved. R3 70/R4 50 preserved; no previous migration/World geometry/public asset edits.

Full World reinspection initially exposed two stale hardcoded migration filename inventories, now updated to include0016; the final full rerun is authoritative. Full-World presence/deploy history tests are in the commit/diff and full-suite log hash but outside portable selection because the deploy test requires old Git history. All selected financial assertions remain. First portable contract attempt had a missing generated directory in its after hook; the runner now creates it and all30 pass. See verificationHistory, sanitized before/after logs and T01-T22 index.
