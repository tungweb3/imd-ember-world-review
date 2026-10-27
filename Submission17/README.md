# Submission17 — remediation of Swarm audit 1ac5269f (renumbered nonce both ways, learned nonce, crediting note, deploy target)

World source `be7d3b0`, 1 commit after Submission16's `38a21a3`, deployed as Worker `7dfe57a1-9917-4d36-87e5-159a8aa6d134` (2026-10-27 17:18 UTC). Follow-up to the review of Submission16 (job `1ac5269f`: 6 Low, 3 Info). No server code changed: the uploaded Worker module is byte-identical to Submission16's. Nothing here has been reviewed externally.

**Published for the record; the owner has not requested a further external review.** After four reviews (jobs `e4a57f91`, `12e0525d`, `351b0573`, `1ac5269f`), none of the last three found a Medium or higher issue, and each found no path that credits GOLD without payment or before finality.

Start with [REMEDIATION.md](REMEDIATION.md): what was done about each finding, what was deliberately left, and what is not verified. Then:

- [patches/](patches/) — the commit, plus the cumulative diff from `38a21a3`
- [source/](source/) — final versions of the 6 modified files ([SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives blob ids)
- [evidence/](evidence/) — full test results, mutation checks, the deploy record, production checks
- [REDACTIONS.md](REDACTIONS.md) — what differs from the private repository

Unchanged files referred to here are in `Submission16/source/`, `Submission15/source/`, `Submission14/source/` and `Submission13/source/`. The public snapshot identity is the commit of this repository that contains this folder.
