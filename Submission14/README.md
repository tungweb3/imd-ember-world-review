# Submission14 — remediation of Swarm audit e4a57f91 (GOLD fast credit retired, I-8 fixed)

World source `64396ae`, 4 commits after Submission13's `ae1f640`, deployed as Worker `40c6477f-f6af-491c-91c8-8e6bbd35dac2` (2026-10-27 03:37 UTC). Follow-up to the review of Submission13 (job `e4a57f91`: 1 Medium, 6 Low, 1 Info). The owner chose to credit GOLD top-ups only at finality again; fast credit is switched off in production and removed from every entry point. Nothing here has been reviewed externally.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md): what was done about each finding, what changed, the questions to attack, and what is not verified. Then:

- [patches/](patches/) — one file per commit, plus the cumulative diff from `ae1f640`
- [source/](source/) — final versions of the 17 added or modified files ([SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives blob ids and the 2 removed files)
- [evidence/](evidence/) — full test results, mutation checks, the real routed receipts check, production state at the switch-off, the deploy records
- [REDACTIONS.md](REDACTIONS.md) — what differs from the private repository

Unchanged files referred to here are in `Submission13/source/`. The public snapshot identity is the commit of this repository that contains this folder.
