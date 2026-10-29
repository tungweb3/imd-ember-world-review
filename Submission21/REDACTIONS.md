# Submission21 — what differs from the private repository

Private source `6be9ef3`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and
git blob id; all are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 3 files modified after `0727200`, unmasked. |
| `patches/` | `git format-patch 0727200..6be9ef3`, plus `git diff 0727200 6be9ef3`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | The test summary contains no local paths. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials, the Genesis signer Worker. |
