# Submission26: the Submission25 scope again, plus its reviewers' fixes, privacy wording and the birth-time form (not deployed)

World source `24a3efa`. The live version is still `d5d7912`. **Not deployed.** The live checkout code is closed, no Celestao order has been made, and production has no grant table.

**Job 6fc92ac1 on Submission25 produced no final report**, so this package asks again for everything since `fd46d69`, the last source with one. Section 0 of the request explains.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): what changed since Submission25 (`580190a`), the whole diff from `fd46d69`, and the overlay builder's diff.
- [source/](source/): final versions of 29 of the 30 files changed since `fd46d69` (REDACTIONS.md names the other), and 31 unchanged files carried over so this package can be read on its own. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source. See section 0 of the request.
