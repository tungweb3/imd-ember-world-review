# Submission17 — what differs from the private repository

Private source `be7d3b0`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and git blob id; all 6 are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 6 files modified after `38a21a3`, unmasked. No media, 3D model or presentation file is among them. |
| `patches/` | `git format-patch 38a21a3..be7d3b0`, plus `git diff 38a21a3 be7d3b0`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | Local paths in the test summary are shown as `<local>`. The deploy record holds no account identifiers (`targetEnv` lists a variable name only). |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials. |
