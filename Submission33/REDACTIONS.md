# Submission33: what differs from the private repositories

Private World source `7672dc5861a8f96e446bf439dda75f3fd89bae06`; private Celestao source `2b5f1c2f29a7d1ccc22f95b7d6e41b2a9353d6e8`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 5 World files changed since `0c15374`, and 78 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| `celestao/` | The 3 files of Celestao `2b5f1c2`, byte-identical. `celestao/world_wallet_web/world-wallet.js` uses CRLF line endings, as stored in Celestao and served live (its SHA-256 begins `6ac8b2051ba2`, the version tag in `index.html` and `index-pdf.html`). The World mirror `source/integrations/celestao/web/world-wallet.js` has the same content with LF endings. |
| Masked: `server/world-gold.ts`, `tests/world-gold-grants.test.mjs`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | Same rule as Submission26 to 32: the two grant wallets and the third administrator are written as `0x[REDACTED-…]`; those entries carry `masked: true` and the `sha256` of the public copy. |
| Masked: `wrangler.jsonc` | Submission13 rule: the three-line account comment is `// [REDACTED-INTERNAL]`, `account_id` is `REDACTED-CLOUDFLARE-ACCOUNT-ID` and `database_id` is `REDACTED-D1-DATABASE-ID`. |
| `patches/` | `git format-patch` and `git diff`, with the same masking; the author e-mail is `operator@imdember.invalid`. |
| `evidence/stuck_paid_orders_query.md` | Order ids and wallets are cut to prefixes in the query itself; the result was empty. |
| Withheld, unchanged since `0c15374` | `integrations/celestao/deployment`, `integrations/celestao/prepare_overlay.py`, `integrations/celestao/README.md`, `integrations/celestao/web/squeek-banner.jpg` (see Submission28/REDACTIONS.md). |
| Not included | Git history, the rest of both repositories, the 鼠道修仙 game, chart engines, report text and algorithms, 3D, media, D1 data, backups, secrets, deploy credentials, the release tool (it only layers these three files on the live image). |
