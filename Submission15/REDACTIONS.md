# Submission15 — what differs from the private repository

Private source `fe8bc4b`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and git blob id; all 8 are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 8 files modified after `64396ae`, unmasked. No media, 3D model or presentation file is among them. |
| `patches/` | `git format-patch 64396ae..fe8bc4b`, plus `git diff 64396ae fe8bc4b`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | Local paths in the test summary are shown as `<local>`. The deploy record holds no account identifiers. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials. |
