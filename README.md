# IMD Ember World — selected-source review

**Submission12: TEAM SOURCE EVIDENCE PASS BOUNDED · EXTERNAL AUDIT12 UNKNOWN · RELEASE-READINESS UNKNOWN · NOT DEPLOYED**

This package targets only Audit11's scheduled non-finite housekeeping findings: A11-L1 (Low), destructive presence/session/challenge/member cleanup, and A11-I1 (Info), premature live index-probe deletion and backoff refund. Read [Submission12](Submission12/README.md), [review inputs](Submission12/REVIEW_INPUTS.md), [two-row matrix](Submission12/FinalClosure/CLOSURE_MATRIX.md), [measured tests](Submission12/FinalClosure/TEST_RESULTS.json) and [boundary](Submission12/BOUNDARY_CHECK.json).

Frozen source `3a1ea7d0cabd40aaf1bd171d64fa64edeb6a2548`; prior public `35ace952824ebf711fd9fa6cb7ea1cc83b75cd6a`; selected manifest SHA-256 `194c8f033c38294110613ce889fc8da8b63e4c99c603607af957c5882a3d0c42`. Final public identity is the containing immutable checkout's `git rev-parse HEAD`. TEAM source evidence is bounded PASS; external Audit12 and release readiness remain UNKNOWN. This candidate is not deployed.

Actual private gates: targeted 13/13, supported review 728/728 across 29 files, full private suite 1778/1778, fresh exact review 728/728, both artifact verifiers 20/20, and typecheck exit 0. Successful tests have zero failures, cancellations, skips or todos. The same unchanged evaluator produces 4 passes and 9 genuine assertion failures on the clean parent baseline. An independent offline refused-lane control passes 1/1 on the frozen candidate and fails 1/1 on the baseline, measuring lane admission 1→1 versus 1→2.

Only `worker/app.ts` changes product behavior. Three supporting test/runner files add scheduled regression and retain all 28 previous supported files. No helper, SQL, schema, dependency, Auth lifecycle, ownership logic, UI or feature changes are included. The six previous Audit10/Report10 issues remain previously closed and unchanged.

The selected source has 147 files: 131 exact, 16 historically masked, 57 preserved mask lines. Website 3D models/scenes/media, full renderer/avatar/selfie features, private Git history/data/backups/credentials, Genesis, Ember Coin and Fren Pet are excluded. [Manifest](manifests/submission12-published-source.json) fingerprints selected public bytes only. The precise scope is scheduled non-finite housekeeping, with no new rollback policy.

Final containing-commit tests and privacy/readback must be measured separately before publication. No production request or deployment is claimed. Native cleanup stays BLOCK for manual-only update coverage, with dimensions 5/6 NOT_CHECKED; the source-only exception is explicit. Earlier failed setup/evaluator attempts are retained privately and are not relabeled PASS. [Latest controlling audit](Submission12/FinalClosure/LATEST_AUDIT_IDENTITY.md) supersedes earlier source PASS labels.
