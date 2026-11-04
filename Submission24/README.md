# Submission24: fixes for audit 521bc017, and an administrator GOLD grant (not deployed)

World source `fd46d69`, four commits after `754ef44` (Submission23). The live version is still `d5d7912`. **Not deployed.** The live checkout code is closed, no Celestao order has been made, and production has no grant table.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/): the commits, plus the diff from `754ef44`.
- [source/](source/): final versions of the 34 changed files, and 15 unchanged files needed to read them. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): test results at `fd46d69`.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The wallet-lock test **fails on purpose** at this source, because the grant changes five audited files. See section 0 of the request.
