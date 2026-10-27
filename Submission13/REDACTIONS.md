# Submission13 — what differs from the private repository

Private source `ae1f640` (deployed as Worker `a718a392-9c68-459f-940a-fa3657a36d0b`). [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256, its public git blob id and the private blob id at `ae1f640`.

| Item | Treatment |
|---|---|
| `source/` | 50 of the 52 non-media files changed by the 18 commits. 49 are byte-identical to the private blobs (`exact: true`). |
| `src/world/WorldApp.tsx`, `src/world/publicHalls/runtime.ts` | The app shell and the public-hall runtime (3D halls) are withheld as presentation code, as in earlier snapshots. Their changed hunks are in `patches/` (no money or identity logic: scene pause/resume and one doorway text). Size, SHA-256 and blob id are in `SOURCE_MANIFEST.json` (`withheld`). |
| Not included either | 3D buildings and scenes, the Celestao fortune service and its algorithms (only World's GOLD checkout for it is here), AIMarket. |
| `source/wrangler.jsonc` | Lines 3–5 (Cloudflare account and login comment) → `// [REDACTED-INTERNAL]`; line 12 `account_id` → `REDACTED-CLOUDFLARE-ACCOUNT-ID`; line 73 `database_id` → `REDACTED-D1-DATABASE-ID`. Same masks as earlier public snapshots. Line count unchanged. |
| Miner films | `public/assets/miners/{small,medium,large}.*.mp4` (owner media) are not published, in `source/` or in `patches/`. Sizes and SHA-256 are in `SOURCE_MANIFEST.json` (`withheld`) and pinned in `source/src/world/miningAssets.json`; the served files can be fetched from `https://imdember.com` and compared. |
| `patches/` | `git format-patch c0b96c7..ae1f640` excluding the three films. Author e-mail → `operator@imdember.invalid`. Commit messages and diffs otherwise unchanged. |
| Not included | Git history, the rest of the repository, 3D models, other media, D1 data, backups, secrets, deploy credentials. |
