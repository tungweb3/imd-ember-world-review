# Submission26: what differs from the private repository

Private source `24a3efa3ed706e3f40f549519609b0040bad1b96`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | 29 of the 30 files changed since `fd46d69`, and 31 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| Masked: `server/world-gold.ts`, `tests/world-gold-grants.test.mjs`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | The two wallets allowed to grant are written as `0x[REDACTED-GRANT-WALLET-1]` and `0x[REDACTED-GRANT-WALLET-2]`, and the third administrator as `0x[REDACTED-ADMIN-WALLET-3]`. All are real 42-character addresses in the private source. Those files carry `masked: true` with no blob id, and their `sha256` is of the public copy. A test fixture id that carried the third administrator's ending is rewritten too. Nothing else in them differs. They parse, but the entries are placeholders, so no real wallet passes and the tests that rely on them fail. |
| What masking means here | It keeps the role off a named address in this submission. It is not secrecy: these are public-chain addresses, and earlier public material may contain them. Wallet 2 is the economy treasury, whose address is public by design. |
| `server/aimarket-admin.ts` | Unchanged and not included, because it lists the administrator wallets. It exports a frozen list of three lowercase addresses; two of them are the grant wallets. |
| `patches/` | `git format-patch` and `git diff`, with the same masking. The `index` lines of sections whose text was masked are replaced with `index [omitted]`, so those sections will not apply as published. The author e-mail is replaced with `operator@imdember.invalid`. |
| `integrations/celestao/README.md` | Changed, but the file is withheld: it lays out private server paths. The paragraphs added are in `patches/`. |
| `integrations/celestao/prepare_overlay.py` | The file is left out, as in Submission23 to 25. **It changed this time**, because the FAQ, About page and birth-time form are built by it, so its diff from `580190a` is in `patches/prepare_overlay_580190a..24a3efa.diff`. |
| `integrations/celestao/deployment/` | Left out, as in Submission23 to 25. It did not change since `fd46d69`. |
| Generated `app.js` | Not included. The upstream file it is built from is private. The changed form code is in the builder's diff. |
| Not included | Git history, the rest of the repository, the private Celestao tree (`c940698`, which carries the same `integrations/celestao` code as `world_wallet/`), the chart engines, report text and algorithms, 3D models and scenes, media, D1 data, backups, secrets, deploy credentials. |
