# Submission19 — Genesis paid-mint GOLD ledger (not deployed), plus the live remediation of audit f6bd50ad

World source `7939c37`, 6 commits after Submission18's `96858bf`:

- `7021b5b` — remediation of job `f6bd50ad` (3 Low) and the GOLD panel's review record; **live** as Worker `a92a767c-bb89-4871-8439-916cded5bb6d` since 2026-10-27 19:34 UTC;
- `ecd9050`, `943959c` — the wallet lock (a test that fails when an audited wallet file changes);
- `20b1d6a` — **the GOLD ledger for paid Genesis NFT mints: not deployed**, production registry empty;
- `21df62b` — **each Genesis payment token has its own GOLD price** (owner 2026-10-29: imdUSD 1,200 GOLD, the discount; USDC 1,600 GOLD): a registry entry lists the added tokens' GOLD prices and an order is held only at one of them. Not deployed;
- `7939c37` — a registry entry that lists the same added-token GOLD price twice is refused; a test that registry ids are unique. Not deployed.

`20b1d6a` changes one type line in a locked file (`server/world-gold.ts`), so the wallet-lock test fails on purpose until this review is done. Nothing here has been reviewed externally.

Start with [AUDIT_REQUEST.md](AUDIT_REQUEST.md): what the ledger does, what was left and why, the questions to attack, and what is not verified. Then:

- [patches/](patches/) — the six commits, plus the cumulative diff from `96858bf`
- [source/](source/) — final versions of the 28 added or modified files ([SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) gives blob ids)
- [evidence/](evidence/) — full test results at `20b1d6a` and `7939c37`, the Worker bundle's exports at both, the CPU measurement behind the cron page size
- [REDACTIONS.md](REDACTIONS.md) — what differs from the private repository

The Genesis contract is public at <https://github.com/tungweb3/ember-evo-genesis-review> (Submission5). The contract that will be deployed on mainnet adds more payment tokens, each with its own GOLD price (AUDIT_REQUEST.md §1b); that source is not in this submission and gets its own Genesis review. Unchanged World files referred to here are in `Submission18/source/` and the earlier `SubmissionN/source/` folders. The public snapshot identity is the commit of this repository that contains this folder.
