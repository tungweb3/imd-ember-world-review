# Submission23: what differs from the private repository

Private source `754ef449ab3084002689b547afe8406c00a4ded2`. [SOURCE_MANIFEST.json](SOURCE_MANIFEST.json) lists every file in `source/` with its SHA-256 and git blob id. All of them are byte-identical to the private blobs.

| Item | Treatment |
|---|---|
| `source/` | The 17 modified files and 15 unchanged context files, unmasked. |
| `patches/` | `git format-patch` and `git diff` from `d5d7912`. The author e-mail is replaced with `operator@imdember.invalid`. |
| `integrations/celestao/deployment/`, `prepare_overlay.py` | Left out of `source/` and `patches/`. These operator tools changed too: the price list and result count expect six products, the smoke test covers six systems, and the overlay generator adds a version hash. |
| `integrations/celestao/web/world-pdf.js`, `world-wallet.css` | Unchanged, not included. |
| Not included | Git history, the rest of the repository, the Celestao chart engines, report text and algorithms (`backend/`, `web/`), 3D models and scenes, media, D1 data, backups, secrets, deploy credentials. |

`native.py` imports the private `backend.*` modules by name. Those modules are not here, so its annual path is reviewable at the boundary only.
