# Submission31: what differs from the private repository

Private source `69ad4b5be1d4e08f23318cc3cc9797b5b157f5b2`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 2 files changed since `0cba662`, and 75 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| Masked: `server/world-gold.ts`, `tests/world-gold-grants.test.mjs`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | Same rule as Submission26 to 30: the two grant wallets and the third administrator are written as `0x[REDACTED-…]`; those entries carry `masked: true` and the `sha256` of the public copy. |
| `patches/` | `git format-patch` and `git diff`, with the same masking; the author e-mail is `operator@imdember.invalid`. |
| Withheld, unchanged since `0cba662` | `integrations/celestao/deployment`, `integrations/celestao/prepare_overlay.py`, `integrations/celestao/README.md`, `integrations/celestao/web/squeek-banner.jpg` (see Submission28/REDACTIONS.md). |
| Not included | Git history, the rest of the repository, the private Celestao tree, the 鼠道修仙 game, chart engines, report text and algorithms, 3D, media, D1 data, backups, secrets (including `SQUEEK_SUBJECT_KEY`), deploy credentials. |
