# Submission32: what differs from the private repositories

Private World source `0c1537449137f263232d21f7b0e0687388f31fdc`; private Celestao source `382a266bd41bfc90b9f3563da51171650ece3eb2`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file with its SHA-256 and private git blob id.

| Item | Treatment |
|---|---|
| `source/` | The 9 World files changed since `69ad4b5`, and 73 unchanged context files. Byte-identical to the private blobs, except the masked files below. |
| `celestao/` | The 3 files of Celestao `382a266`, byte-identical. `celestao/world_wallet_web/world-wallet.js` uses CRLF line endings, as stored in Celestao and served live (its SHA-256 begins `a223f3f85e9a`, the version tag in `index.html`). The World mirror `source/integrations/celestao/web/world-wallet.js` has the same content with LF endings. |
| Masked: `server/world-gold.ts`, `tests/world-gold-grants.test.mjs`, `migrations/0024_world_gold_grants.sql`, `tests/world-gold-grants-recovery.test.mjs` | Same rule as Submission26 to 31: the two grant wallets and the third administrator are written as `0x[REDACTED-…]`; those entries carry `masked: true` and the `sha256` of the public copy. |
| Masked: `wrangler.jsonc` | Submission13 rule: the three-line account comment is `// [REDACTED-INTERNAL]`, `account_id` is `REDACTED-CLOUDFLARE-ACCOUNT-ID` and `database_id` is `REDACTED-D1-DATABASE-ID`. |
| `patches/` | `git format-patch` and `git diff`, with the same masking; the author e-mail is `operator@imdember.invalid`. |
| Withheld, unchanged since `69ad4b5` | `integrations/celestao/deployment`, `integrations/celestao/prepare_overlay.py`, `integrations/celestao/README.md`, `integrations/celestao/web/squeek-banner.jpg` (see Submission28/REDACTIONS.md). |
| Not included | Git history, the rest of both repositories, the 鼠道修仙 game, chart engines, report text and algorithms, 3D, media, D1 data, backups, secrets, deploy credentials, the release tool (it only layers these three files on the live image). |
