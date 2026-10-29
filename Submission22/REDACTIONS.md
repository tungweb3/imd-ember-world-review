# Submission22: what differs from the private repository

Private source `7d09bda`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and
git blob id. All of them are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 4 files modified after `6be9ef3`, unmasked. |
| `patches/` | `git format-patch 6be9ef3..7d09bda`, plus `git diff 6be9ef3 7d09bda`. The author e-mail is replaced with `operator@imdember.invalid`; nothing else changes. |
| `evidence/` | The test summary contains no local paths. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials, the Genesis signer Worker. |
