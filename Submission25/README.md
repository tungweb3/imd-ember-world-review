# Submission25: per-grant wallet signature, fixes for audit 37a926e3, and pre-sale payment fixes (not deployed)

World source `580190a`, 7 commits after `fd46d69` (Submission24). The live version is still `d5d7912`. **Not deployed.** The live checkout code is closed, no Celestao order has been made, and production has no grant table.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commits, plus the diff from `fd46d69`.
- [source/](source/): final versions of 27 of the 28 changed files (REDACTIONS.md names the other), and 31 unchanged files carried over from Submission24 so this package can be read on its own. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source. See section 0 of the request.
