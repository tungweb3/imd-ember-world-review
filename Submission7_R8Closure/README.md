# Submission 7 — R8 v1.1 targeted closure

This package asks the external reviewer to confirm six Low and two Info dispositions from the prior reviews. It includes repaired Auth lifecycle/cleanup, independent real-client causal traces, ownership proof epochs, freshness and market numeric boundaries.

Private candidate source: `8a22b51035c965b9df2fe010e3ac0a780581b0e2`. Public parent: `c4f451b015abdaced6c35a717b29f5bb1cb351c0`. Use the immutable containing Git commit, supplied separately; this file cannot embed its own containing commit hash.

Candidate **not deployed**; production parity is unmeasured. No new paid review was submitted by the agent. No WORLD_SECURITY_BASELINE_v1 has been established.

- [Finding disposition and required 11-case matrix](../source/R8_FINAL_CLOSURE.md)
- [Actual public test/build evidence](TEST_RESULTS.json), [independent 500-seed result](REFERENCE_SCHEDULER.json), [replayed prior failures](COUNTEREXAMPLES.json)
- [Auth policy](../source/docs/security/AUTH_STATE_MACHINE.md), [ownership policy](../source/OWNERSHIP_FRESHNESS.md), [cache boundaries](../source/docs/security/FRESHNESS_BOUNDARIES.md), [retained limits](../source/docs/security/SECURITY_BASELINE_LIMITS.md)
- [Source manifest](../manifests/submission7-r8closure-published-source.json), [boundary checks](BOUNDARY_CHECK.json), [deployment status](DEPLOYMENT_STATUS.json), [original prior review links](PRIOR_REVIEWS.md), [complete inventory](PUBLIC_CONTENT.md)

Measured public tests: **518/518**, zero failures/skips/cancellations/todo. Independently generated reference schedules: **500/500**, **428** distinct normalized action digests. Full public frontend compilation is unavailable because presentation dependencies are intentionally withheld; its diagnostics are preserved privately and its failed gate is reported. Supplied Worker dry-run passed using an empty local ASSETS fixture, which is not a website build.

Private complete-project **1528/1528**, TypeScript and Vite build are separately labeled team measurements. They are not claims that withheld files were publicly reviewed. Do not treat tests, Low labels, accepted/Completed or a final output as approval, fund-safety proof, certification or absence of vulnerabilities. Reviewer measurements, team claims, inference and unavailable checks must remain separate.
