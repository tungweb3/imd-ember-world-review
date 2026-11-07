# Submission29: what differs from the private repository

Private source `9d88f5ce3142b55bc39f62c085b31453b1b6cdec`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 6 files changed since `e93e55a`, and 71 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| Masked: `server/world-gold.ts`, `tests/world-gold-grants.test.mjs`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | Same rule as Submission26 to 28: the two grant wallets and the third administrator are written as `0x[REDACTED-…]`; those entries carry `masked: true` and the `sha256` of the public copy. |
| `patches/` | `git format-patch` and `git diff`, with the same masking; `index` lines of masked sections read `index [omitted]`; the author e-mail is `operator@imdember.invalid`. |
| Withheld, unchanged since `e93e55a` | `integrations/celestao/deployment`, `integrations/celestao/prepare_overlay.py`, `integrations/celestao/README.md`, `integrations/celestao/web/squeek-banner.jpg` (see Submission28/REDACTIONS.md). |
| Not included | Git history, the rest of the repository, the private Celestao tree, the 鼠道修仙 game, chart engines, report text and algorithms, 3D, media, D1 data, backups, secrets (including the new `SQUEEK_SUBJECT_KEY`), deploy credentials. |
