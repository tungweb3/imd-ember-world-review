# Submission28: what differs from the private repository

Private source `e93e55ac0f0305fc7e22469c7efd139fc825ea7f`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 28 files changed since `24a3efa`, and 48 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| Masked: `tests/world-gold-grants.test.mjs`, `server/world-gold.ts`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | The two wallets allowed to grant are written as `0x[REDACTED-GRANT-WALLET-1]` and `0x[REDACTED-GRANT-WALLET-2]`, and the third administrator as `0x[REDACTED-ADMIN-WALLET-3]`. All are real 42-character addresses in the private source. Those files carry `masked: true` with no blob id, and their `sha256` is of the public copy. A test fixture id that carried the third administrator's ending is rewritten too. Nothing else in them differs. The tests that rely on them fail as published. |
| What masking means here | It keeps the role off a named address in this submission. It is not secrecy: these are public-chain addresses, and earlier public material may contain them. Wallet 2 is the economy treasury, whose address is public by design. |
| `server/aimarket-admin.ts` | Unchanged and not included, because it lists the administrator wallets. |
| `patches/` | `git format-patch` and `git diff`, with the same masking. The `index` lines of sections whose text was masked are replaced with `index [omitted]`. The author e-mail is replaced with `operator@imdember.invalid`. |
| `integrations/celestao/prepare_overlay.py` | Left out, as in Submission26, because it is built around the private Celestao page source. It changed only in `6b15dfa` and `0ad7677`: 7 added lines, which (1) insert one fixed link to `https://squeekascension.celestao.com/?ref=celestao` (new tab, `noopener noreferrer`) after the last item of the Celestao top navigation, (2) append the same link as an image banner at the end of a personal report page (not for demo readings, missing results, the PDF page or print), and (3) add `squeek-banner.jpg` to the files it copies. No payment, wallet or data code. The CSS for both is in `integrations/celestao/web/world-wallet.css`, which is included. |
| `integrations/celestao/web/squeek-banner.jpg` | Left out: a 1500×500 promotional image (182,194 bytes) for the banner. |
| `integrations/celestao/README.md`, `deployment/` | Left out, as in Submission26. Neither changed since `24a3efa`. |
| Not included | Git history, the rest of the repository, the private Celestao tree (`dd679fe`), the 鼠道修仙 game, the chart engines, report text and algorithms, 3D models and scenes, media, D1 data, backups, secrets, deploy credentials. |
