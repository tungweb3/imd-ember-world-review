# Submission29: fixes for audit 64b1ce06 (World 9d88f5c, not deployed)

World source `9d88f5c`. The live version is still `d5d7912`. **Not deployed.** No Celestao order, no grant and no 鼠道修仙 order has ever been made.

Submission28 (World `e93e55a`) was reviewed in job `64b1ce06`: 5 Low. This package fixes all five. Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commit after Submission28, its diff from `e93e55a`, and the whole diff from `24a3efa` (Submission26) for context.
- [source/](source/): final versions of the 6 files changed since `e93e55a`, and 71 unchanged files carried over from Submission28. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source. See section 0 of the request.
