# IMD Ember World — selected-source review

**Current: [Submission32](Submission32/README.md) — paid delivery from Workers (`redirect:'manual'`) and the Celestao wait text; already live at the owner's choice (World `0c15374`, Celestao `382a266`).**

Read [Submission32/AUDIT_REQUEST.md](Submission32/AUDIT_REQUEST.md) first.

The history of `main` was rewritten on 2026-11-09; old commit ids map to new ones in [HISTORY_REWRITE.md](HISTORY_REWRITE.md).

**Previous: [Submission31](Submission31/README.md) — fixes for audit 48111df0 of the 鼠道修仙 GOLD store; published for the record, no further review requested; review cycle closed (World `69ad4b5`, not deployed).**

**Previous: [Submission30](Submission30/README.md) — fixes for audit 85163d96 of the 鼠道修仙 GOLD store, second round (World `0cba662`, not deployed); reviewed in job 48111df0, 3 Info, fixed in Submission31.**

**Previous: [Submission29](Submission29/README.md) — fixes for audit 64b1ce06 of the 鼠道修仙 GOLD store (World `9d88f5c`, not deployed); reviewed in job 85163d96, 3 Low and 3 Info, fixed in Submission30.**

**Previous: [Submission28](Submission28/README.md) — fixes for audit 447bb70d, two links to 鼠道修仙, and the 鼠道修仙 GOLD cosmetic store (World `e93e55a`, not deployed); reviewed in job 64b1ce06, 5 Low, fixed in Submission29.**

**Not sent: [Submission27](Submission27/README.md) — prepared for the 447bb70d fixes only; replaced by Submission28.**

**Previous: [Submission26](Submission26/README.md) — the Submission25 scope again after job 6fc92ac1 gave no final report, plus its reviewers' fixes, privacy wording and the birth-time form (World `24a3efa`, not deployed).**

**Previous: [Submission25](Submission25/README.md) — per-grant wallet signature, fixes for audit 37a926e3, and pre-sale payment fixes (World `580190a`, not deployed).**

**Previous: [Submission24](Submission24/README.md) — fixes for audit 521bc017 and an administrator GOLD grant (World `fd46d69`, not deployed).**

**Previous: [Submission23](Submission23/README.md) — the annual reading as the sixth Celestao GOLD product, with the Celestao payment path public for the first time (World `754ef44`, not deployed).**

**Previous: [Submission22](Submission22/README.md) — remediation of audit 93dae57f of the Genesis paid-mint GOLD ledger; the payment Transfer must carry the registry amount (source `7d09bda`, NOT DEPLOYED, production registry empty) · published for the record, no further review requested**

Read [Submission22/REMEDIATION.md](Submission22/REMEDIATION.md) first. [Submission21](Submission21/README.md) (settlement checks the paying token, `6be9ef3`) was reviewed in job `93dae57f`; [Submission20](Submission20/README.md) (the paid order names its payment token, `0727200`) was reviewed in job `e3e9b712`; [Submission19](Submission19/README.md) (the Genesis GOLD ledger at `7939c37`, plus the live remediation of audit f6bd50ad, `7021b5b`, Worker `a92a767c`) was reviewed in job `8febfeed`; [Submission18](Submission18/README.md) (final review of what was live at source `96858bf`) was reviewed in job `f6bd50ad`; [Submission17](Submission17/README.md) was published for the record without a review request; [Submission16](Submission16/README.md) was reviewed in job `1ac5269f`; [Submission15](Submission15/README.md) in job `351b0573`; [Submission14](Submission14/README.md) in job `12e0525d`; [Submission13](Submission13/README.md) in job `e4a57f91`. They and the Submission12 text below are kept as history.

**Submission12: TEAM SOURCE EVIDENCE PASS BOUNDED · EXTERNAL AUDIT12 UNKNOWN · RELEASE-READINESS UNKNOWN · NOT DEPLOYED**

This package targets only Audit11's scheduled non-finite housekeeping findings: A11-L1 (Low), destructive presence/session/challenge/member cleanup, and A11-I1 (Info), premature live index-probe deletion and backoff refund. Read [Submission12](Submission12/README.md), [review inputs](Submission12/REVIEW_INPUTS.md), [two-row matrix](Submission12/FinalClosure/CLOSURE_MATRIX.md), [measured tests](Submission12/FinalClosure/TEST_RESULTS.json) and [boundary](Submission12/BOUNDARY_CHECK.json).

Frozen source `3a1ea7d0cabd40aaf1bd171d64fa64edeb6a2548`; prior public `35ace952824ebf711fd9fa6cb7ea1cc83b75cd6a`; selected manifest SHA-256 `194c8f033c38294110613ce889fc8da8b63e4c99c603607af957c5882a3d0c42`. Final public identity is the containing immutable checkout's `git rev-parse HEAD`. TEAM source evidence is bounded PASS; external Audit12 and release readiness remain UNKNOWN. This candidate is not deployed.

Actual private gates: targeted 13/13, supported review 728/728 across 29 files, full private suite 1778/1778, fresh exact review 728/728, both artifact verifiers 20/20, and typecheck exit 0. Successful tests have zero failures, cancellations, skips or todos. The same unchanged evaluator produces 4 passes and 9 genuine assertion failures on the clean parent baseline. An independent offline refused-lane control passes 1/1 on the frozen candidate and fails 1/1 on the baseline, measuring lane admission 1→1 versus 1→2.

Only `worker/app.ts` changes product behavior. Three supporting test/runner files add scheduled regression and retain all 28 previous supported files. No helper, SQL, schema, dependency, Auth lifecycle, ownership logic, UI or feature changes are included. The six previous Audit10/Report10 issues remain previously closed and unchanged.

The selected source has 147 files: 131 exact, 16 historically masked, 57 preserved mask lines. Website 3D models/scenes/media, full renderer/avatar/selfie features, private Git history/data/backups/credentials, Genesis, Ember Coin and Fren Pet are excluded. [Manifest](manifests/submission12-published-source.json) fingerprints selected public bytes only. The precise scope is scheduled non-finite housekeeping, with no new rollback policy.

Final containing-commit tests and privacy/readback must be measured separately before publication. No production request or deployment is claimed. Native cleanup stays BLOCK for manual-only update coverage, with dimensions 5/6 NOT_CHECKED; the source-only exception is explicit. Earlier failed setup/evaluator attempts are retained privately and are not relabeled PASS. [Latest controlling audit](Submission12/FinalClosure/LATEST_AUDIT_IDENTITY.md) supersedes earlier source PASS labels.
