# Submission15 — remediation of Swarm audit 12e0525d (crediting note, deploy tool)

World source `fe8bc4b`, 2 commits after Submission14's `64396ae`, deployed as Worker `d5335f94-8a74-44b2-bd3d-b2ff5d6a1f89` (2026-10-27 04:52 UTC). Follow-up to the review of Submission14 (job `12e0525d`: 5 Low, 1 Info). No server code changed: the uploaded Worker module is byte-identical to Submission14's. Nothing here has been reviewed externally.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md): what was done about each finding, the questions to attack, and what is not verified. Then:

- [patches/](patches/) — one file per commit, plus the cumulative diff from `64396ae`
- [source/](source/) — final versions of the 8 modified files ([SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives blob ids)
- [evidence/](evidence/) — full test results, mutation checks, the deploy record, production checks
- [REDACTIONS.md](REDACTIONS.md) — what differs from the private repository

Unchanged files referred to here are in `Submission14/source/` and `Submission13/source/`. The public snapshot identity is the commit of this repository that contains this folder.
