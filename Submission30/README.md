# Submission30: fixes for audit 85163d96 (World 0cba662, not deployed)

World source `0cba662`. The live version is still `d5d7912`. **Not deployed.** No Celestao order, no grant and no 鼠道修仙 order has ever been made.

Submission29 (World `9d88f5c`) was reviewed in job `85163d96`: 3 Low, 3 Info. This package fixes all six with the smallest change for each; the login design is unchanged. Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commit after Submission29, its diff from `9d88f5c`, and the whole diff from `24a3efa` (Submission26) for context.
- [source/](source/): final versions of the 4 files changed since `9d88f5c`, and 73 unchanged files carried over from Submission29. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source. See section 0 of the request.
