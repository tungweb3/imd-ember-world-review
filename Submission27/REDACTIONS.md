# Submission27: what differs from the private repository

Private source `a3abbf7f7c37fa97dcf3c25cba781680cf0b8ca7`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 8 files changed since `24a3efa`, and 52 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| Masked: `tests/world-gold-grants.test.mjs`, `server/world-gold.ts`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | The two wallets allowed to grant are written as `0x[REDACTED-GRANT-WALLET-1]` and `0x[REDACTED-GRANT-WALLET-2]`, and the third administrator as `0x[REDACTED-ADMIN-WALLET-3]`. All are real 42-character addresses in the private source. Those files carry `masked: true` with no blob id, and their `sha256` is of the public copy. A test fixture id that carried the third administrator's ending is rewritten too. Nothing else in them differs. The tests that rely on them fail as published. |
| What masking means here | It keeps the role off a named address in this submission. It is not secrecy: these are public-chain addresses, and earlier public material may contain them. Wallet 2 is the economy treasury, whose address is public by design. |
| `server/aimarket-admin.ts` | Unchanged and not included, because it lists the administrator wallets. |
| `patches/` | `git format-patch` and `git diff`, with the same masking. The `index` lines of sections whose text was masked are replaced with `index [omitted]`. The author e-mail is replaced with `operator@imdember.invalid`. |
| `integrations/celestao/README.md`, `prepare_overlay.py`, `deployment/` | Left out, as in Submission26. None of them changed since `24a3efa`. |
| Not included | Git history, the rest of the repository, the private Celestao tree (`6560ad4`, which carries the same `integrations/celestao` code as `world_wallet/`), the chart engines, report text and algorithms, 3D models and scenes, media, D1 data, backups, secrets, deploy credentials. |
