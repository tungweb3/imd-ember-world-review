# Submission27: fixes for audit 447bb70d on Submission26 (not deployed)

World source `a3abbf7`. The live version is still `d5d7912`. **Not deployed.** The live checkout code is closed, no Celestao order has been made, and production has no grant table.

Job 447bb70d judged Submission26 (`24a3efa`): 3 Low, 1 Info. This package is the fixes for those four, and nothing else. Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commit after Submission26, its diff from `24a3efa`, and the whole diff from `fd46d69` for context.
- [source/](source/): final versions of the 8 files changed since `24a3efa`, and 52 unchanged files carried over from Submission26 so this package can be read on its own. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source. See section 0 of the request.
