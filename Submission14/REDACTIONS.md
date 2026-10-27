# Submission14 — what differs from the private repository

Private source `64396ae`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and git blob id; all 17 are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 17 files added or modified after `ae1f640`, unmasked. No media, 3D model or presentation file is among them. |
| `patches/` | `git format-patch ae1f640..64396ae`, plus `git diff ae1f640 64396ae`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | Local paths in the test summary are shown as `<local>`. The deploy records hold no account identifiers. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials. |
