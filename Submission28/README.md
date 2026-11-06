# Submission28: fixes for audit 447bb70d, two links to 鼠道修仙, and the 鼠道修仙 GOLD cosmetic store (not deployed)

World source `e93e55a`. The live version is still `d5d7912`. **Not deployed.** No Celestao order, no grant and no 鼠道修仙 order has ever been made; production has none of these tables enabled.

Submission27 was prepared for the 447bb70d fixes only and was never sent. This package replaces it and covers every commit since Submission26 (`24a3efa`). Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commits after Submission26, their diff from `24a3efa`, and the whole diff from `fd46d69` for context.
- [source/](source/): final versions of the 28 files changed since `24a3efa`, and 48 unchanged files carried over from Submission26 so this package can be read on its own. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source. See section 0 of the request.
