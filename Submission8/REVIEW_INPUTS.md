# Review inputs — Submission8

Review the containing immutable public commit; compare with previous public `7215c5d89a96bc79113a85766c04868d54393f3c` and frozen candidate `bb7549e0a2576ba4da0ea7c4147c4aba1a7f577f`. Prior Audit6/Report6 materials are historical; current claims are isolated under Submission8.

Use Node.js 24.x, then run in `source/`:

```sh
npm ci --ignore-scripts
npm run test:review
```

This command selects all 23 supplied review test files and verifies the actual pinned viem package. It clears source selector overrides. Do not omit failing files, add missing-module stubs or replace crypto/Worker/SQLite with synthetic packages. The public frontend remains intentionally incomplete; a failed full frontend build is not converted into a pass.

The default test runner creates no sibling evidence directory. Optional scheduler artifacts stay inside an explicit source `tmp/` directory; follow the supplied artifact policy and clean them after inspection. Exact input/evaluator hashes, actual row counts, branch counts and metrics are in REFERENCE_SCHEDULER.json; core500 and additional90 remain distinct measurements.

For every finding give severity, blocker rationale, pinned file/line, event order, actual database rows and prompt/challenge/verify/cleanup/hint/RPC counts. Separate fresh reviewer reproduction, team measurements, inference and unavailable checks. Independently evaluate deployment/bindings/migrations/headers and actual byte correspondence to the extent access permits, without live wallet writes, payment or asset operations. Retain scope and concurrency/transport limits.
