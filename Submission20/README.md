# Submission20 — fixes for audit 8febfeed (Genesis GOLD ledger, not deployed)

World source `0727200`, one commit after Submission19's `7939c37`. **Not deployed**; the production Genesis registry is
still empty. It answers the Swarm audit of Submission19 (job `8febfeed`, 1 Medium, 4 Low, 1 Info), and carries the World
side of the Genesis contract audit `944905c3` finding 1 (the paid order names its payment token).

The wallet-lock test still fails on purpose on `server/world-gold.ts` (the one type line from `20b1d6a`); `0727200` does
not touch any locked file. Nothing here has been reviewed externally.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/) — the commit, plus the diff from `7939c37`
- [source/](source/) — final versions of the 6 modified files ([SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives blob ids)
- [evidence/](evidence/) — full test results at `0727200`
- [REDACTIONS.md](REDACTIONS.md) — what differs from the private repository

The Genesis contract with the matching change is public at <https://github.com/tungweb3/ember-evo-genesis-review>
(Submission7). Unchanged World files are in `Submission19/source/` and the earlier `SubmissionN/source/` folders. The
public snapshot identity is the commit of this repository that contains this folder.
