# Submission19 — what differs from the private repository

Private source `7939c37`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and git blob id; all 28 are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 28 files added or modified after `96858bf`, unmasked. `CLAUDE.md` is the repository's note on the wallet lock. `security/wallet-lock.json` holds file paths and SHA-256 values only. No media, 3D model or presentation file is among them. |
| `patches/` | `git format-patch 96858bf..7939c37`, plus `git diff 96858bf 7939c37`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | The test summaries contain no local paths. The bundle excerpt is from a `wrangler deploy --dry-run` (nothing uploaded) and holds no account identifiers. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials, the Genesis signer Worker. |
