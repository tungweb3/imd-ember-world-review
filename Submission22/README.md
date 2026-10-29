# Submission22: remediation of Swarm audit 93dae57f (Genesis GOLD ledger, not deployed)

World source `7d09bda`, one commit after Submission21's `6be9ef3`. **Not deployed.** The production Genesis registry is
still empty. This submission answers the Swarm audit of Submission21 (job `93dae57f`, 2 Low):

- The payment Transfer must carry the exact amount the registry lists for the order's token.
- A code-hash mismatch is cached for the finalized block.

**Published for the record. The owner has not asked for another external review.** Three World reviews looked at the Genesis
GOLD ledger (jobs `8febfeed`, `e3e9b712`, `93dae57f`), and the Genesis audits read it as secondary scope. Only the
first found a Medium issue.

The wallet-lock test still fails on purpose on `server/world-gold.ts`, the one type line from `20b1d6a`. `7d09bda` does
not touch any locked file.

Start with [REMEDIATION.md](REMEDIATION.md). Then:

- [patches/](patches/): the commit, plus the diff from `6be9ef3`.
- [source/](source/): final versions of the 4 modified files. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives their blob ids.
- [evidence/](evidence/): full test results at `7d09bda`, with the mutation checks.
- [REDACTIONS.md](REDACTIONS.md): what differs from the private repository.

The Genesis contract and signer are public at <https://github.com/tungweb3/ember-evo-genesis-review>. Submission9 there
holds the signer fixes of Genesis audit d1c83d3d, with this book as its secondary scope. Unchanged World files are in
`Submission21/source/`, `Submission20/source/`, `Submission19/source/` and the earlier `SubmissionN/source/` folders.
The public snapshot is identified by the commit of this repository that contains this folder.
