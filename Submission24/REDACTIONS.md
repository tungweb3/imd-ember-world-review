# Submission24: what differs from the private repository

Private source `fd46d69ca2d59bcd442aba5cd9990f53f93870c3`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 34 changed files and 15 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| Masked: `migrations/0024_world_gold_grants.sql`, `server/world-gold.ts`, `tests/world-gold-grants-recovery.test.mjs`, `tests/world-gold-grants.test.mjs` | The two wallets allowed to grant are written as `0x[REDACTED-GRANT-WALLET-1]` and `0x[REDACTED-GRANT-WALLET-2]`. Both are real 42-character lowercase addresses in the private source. Those files carry `masked: true` with no blob id, and their `sha256` is of the public copy. A test fixture id that carried the third administrator's ending is rewritten too. Nothing else in them differs. They parse and apply, but the entries are placeholders, so no real wallet passes and the tests that rely on them fail. |
| What masking means here | It keeps the role off a named address in this submission. It is not secrecy: these are public-chain addresses, and earlier public material may contain them. Wallet 2 is the economy treasury, whose address is public by design. |
| `server/aimarket-admin.ts` | Unchanged and not included, because it lists the administrator wallets. It exports a frozen list of three lowercase addresses; two of them are the grant wallets. |
| `patches/` | `git format-patch` and `git diff` from `754ef44`, with the same masking. The first commit's test names, which carried wallet endings, are rewritten to `GRANT_A`, `GRANT_B`, `THIRD_ADMIN` and `[wallet-n]`. The `index` lines of masked files are replaced with `index [omitted]`, so these patches will not apply as published. The author e-mail is replaced with `operator@imdember.invalid`. |
| `integrations/celestao/deployment/`, `prepare_overlay.py` | Left out, as in Submission23. They did not change in these commits. |
| Not included | Git history, the rest of the repository, the Celestao chart engines, report text and algorithms (`backend/`, `web/`), 3D models and scenes, media, D1 data, backups, secrets, deploy credentials. |
