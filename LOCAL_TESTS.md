# Validation and failure reproduction

The initial regression suite reproduced all 11 Node failures on unmodified World source57ce2d59 and all 3 Python tests (4 subcase errors). The independent second inspection initially found 3 additional boundary/evidence failures; those source-matching before/after logs remain preserved locally. These are test failures proving the evaluators detect the defects, not accepted release behavior.

Original and second-inspection regression cases are included in tests/world-gold-audit5*.test.mjs and aimarket/test_world_trial_audit5.py. Real private EVM tests exercise memory-order-map loss, original chain expiry/consumption, SQLite reopen/backup restore and reset refusal. A calibrated malformed-proof test deliberately removes only the SQL guard in an isolated database; the evaluator must detect the unsafe transition. Existing cross-spend mutation calibration remains.

Final full-workspace, portable, Python, contracts, native D1, TypeScript/build/dry-run and preservation results will be recorded in evidence/packet-validation.json after completion. Pending/unrecorded checks must not be treated as passed. Dependency reuse on this host is disclosed; no fresh npm install is claimed.

## Final fixed-source results

World source `7afdd097847d2cd6b5d503734566afc1b78a2c8d`: **2837 total / 2832 passed / 0 failed / 5 existing Windows symlink skips**. Selected portable financial tests: **398 passed, no failures/skips**. Portable original Solidity tests: **30 passed**. Portable Python trial tests: **10 passed**. TypeScript, build, Worker dry-run (no upload), and local workerd D1 exact production SQL passed. Original R3 70 and R4 50 files remain byte-identical; original migrations0010..0014, World public assets and geometry are unchanged.

The initial 11 Node cases all failed before remediation; Python reproduced the trial-boundary errors. The second inspection initially detected 3 additional binding/evidence gaps (14 cases / 11 pass / 3 fail), then all50 affected checks passed after correction. The final portable/full suites additionally include the malformed-proof SQL guard-removal calibration and actual private EVM map-loss/backup-restore cases.

The first portable assembly had six import failures because five existing context modules were omitted; this was corrected before final verification. It was not a product fix or a skipped financial test. The30 contract cases had already passed and unchanged contract code was not needlessly rerun; the separate final selected financial suite passed398.

Full-workspace build results do not make this selected packet a full artwork build. No public-chain, actual external provider or production capacity success is claimed. See evidence/packet-validation.json and all release gates.
