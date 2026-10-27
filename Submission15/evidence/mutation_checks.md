Mutation checks run locally on 2026-10-27: each fix undone once, its test file re-run, the file restored.

2aeac71 (Swarm audit 12e0525d findings)
- L-1 `economyWallet.ts` `same||own&&r.status==='0x0'||own...` back to `same||own...`: "a routed transaction without exactly the intended effect is never taken as done" fails (the reverted own routed hash waits for finality again).
- L-2 `dropPendingCreditByHash` disabled: "after a reload the failed payment's note is found by its hash (L-2)" fails.
- L-3 after-expiry rule removed: "a payment that never mines ... ends 30 minutes after its quote expired (L-3)" fails.
- I-6 future-date bound removed: "a note dated ahead of this clock is ignored instead of living for ever (I-6)" fails.
- L-4 third read forced to "unchanged": "a real deploy re-checks ...: edited-while-uploading" fails.
- L-5 VITE_* refusal removed: "a real deploy re-checks ...: vite-env" fails.
- L-5 version comparison disabled: "VITE_* shell variables and a node_modules that differs from package-lock.json are refused" fails.

fe8bc4b (independent review of 2aeac71)
- `!p.mined` removed from the after-expiry rule: "a payment the wallet saw mined keeps its note past the after-expiry margin" fails.
- `sentHash` no longer set: the pasted-replacement assertion (`state.sentHash===HASH`) fails.
- NODE_ENV refusal disabled: the L-5 dependency/environment test fails.
- Missing or pre-v2 lockfile check disabled: the same test fails ("no lockfile", "lockfile v1").
- resolved/integrity comparison disabled: the same test fails ("another source").
