# Submission21 — fixes for audit e3e9b712 (Genesis GOLD ledger, not deployed)

World source `6be9ef3`, one commit after Submission20's `0727200`. **Not deployed**; the production Genesis registry is
still empty. It answers the Swarm audit of Submission20 (job `e3e9b712`, 3 Low, 2 Info): the cron reports a wrong chain
or code hash, the cron cursor no longer costs an empty run, settlement checks that the order's own token paid, and the
retry path has tests.

The wallet-lock test still fails on purpose on `server/world-gold.ts` (the one type line from `20b1d6a`); `6be9ef3` does
not touch any locked file. Nothing here has been reviewed externally.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md). Then:

- [patches/](patches/) — the commit, plus the diff from `0727200`
- [source/](source/) — final versions of the 3 modified files ([SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives blob ids)
- [evidence/](evidence/) — full test results at `6be9ef3`
- [REDACTIONS.md](REDACTIONS.md) — what differs from the private repository

The Genesis contract and signer are public at <https://github.com/tungweb3/ember-evo-genesis-review> (Submission8: the
signer fixes of Genesis audit e9fc751f; the contract is unchanged from Submission7). Unchanged World files are in
`Submission20/source/`, `Submission19/source/` and the earlier `SubmissionN/source/` folders. The public snapshot identity
is the commit of this repository that contains this folder.
