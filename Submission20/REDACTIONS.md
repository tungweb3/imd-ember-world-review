# Submission20 — what differs from the private repository

Private source `0727200`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and
git blob id; all are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 6 files modified after `7939c37`, unmasked. |
| `patches/` | `git format-patch 7939c37..0727200`, plus `git diff 7939c37 0727200`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | The test summary contains no local paths. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials, the Genesis signer Worker. |
