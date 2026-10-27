# Submission18 — what differs from the private repository

Private source `96858bf`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and git blob id; all 12 are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 12 files modified after `38a21a3`, unmasked. `CelestaoCheckout.tsx` is the World's checkout page for a Celestao service (published before in Submission13); it holds no fortune algorithm. No media, 3D model or presentation file is among them. |
| `patches/` | `git format-patch 38a21a3..96858bf`, plus `git diff 38a21a3 96858bf`. Author e-mail → `operator@imdember.invalid`; otherwise unchanged. |
| `evidence/` | Local paths in the test summary are shown as `<local>`. The deploy record holds no account identifiers (`targetEnv` lists a variable name only). The real purchase names the owner's public order id and transaction hash only. |
| Not included | Git history, the rest of the repository, 3D models and scenes, media, the Celestao fortune service, D1 data, backups, secrets, deploy credentials. |
