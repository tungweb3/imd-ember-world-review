# Publication allowlist

The authoritative selected product-byte allowlist is `manifests/selected-source.json`. It stages 71 committed World files (949,613 bytes) from fixed product commit `adb13e9a98a3505229dbd866c6c268bca790d057` and explicitly selects fourteen new financial test files. Includes all real SQL migrations and original package/lock evidence; no player data or World media is included. Recalculate this inventory if the product checkpoint changes.

| Prefix or file | Publication purpose |
|---|---|
| `README.md`, `SCOPE.md`, `REQUIREMENTS.md`, `REDACTIONS.md`, `DEPENDENCIES.md`, `LOCAL_TESTS.md` | Requirements, scope, reproduction and honest limitations. |
| `AUDIT_OBJECTIVE.en.txt`, `AUDIT_OBJECTIVE.zh-Hant.txt` | Explicit Solidity plus TypeScript economic review objective. |
| `package.json`, `.gitignore`, `.gitattributes`, `tools/*.mjs` | Root selected-review scripts, byte verification and offline privacy screening. |
| `manifests/selected-source.json` | Exact source commit, byte sizes, SHA-256 and Git blob map, and selected tests. |
| `evidence/selected-verification.json` | Sanitized measured recheck receipt: 29/29 contract and 188/188 financial tests, zero failures/skips. This round reuses pinned installed dependencies; separate from full private World, containing-public-Git and Swarm gates. |
| `context/world-integration.patch`, `context/integration-source.json` | Zero-context new World wiring and base/changed-file fingerprints only. |
| `world-source/` | Only manifest-listed exact new financial modules, tests, migration schemas and required existing dependency context. |
| `contracts/` | Only the separate portable contract package's explicit public allowlist, exact Solidity/artifacts/standard input, public token fixture, pinned compiler payload/dependency locks, test/build tooling and licenses. |

Excluded from publication even if present for local execution: every `node_modules` folder/junction, `.git` ancestry from private projects, `.rd`, `.wrangler`, generated `release/` and contract execution evidence, private JSON/logs, `.env`/`.dev.vars`, credentials/signatures/keys, remote state, production databases, backups and raw private receipts. A fixed payment treasury is public protocol data; unrelated administrator wallets are excluded.

The portable contracts use their separate exact 40-file allowlist; production Solidity, ABI, artifacts and compiler baseline are unchanged; the preflight tool and tests now validate complete finalized header identity. The new local publication allowlist contains 132 files, excluding ignored execution evidence and dependency junctions. This round reuses prior independently cold-installed physical dependencies and does not claim another fresh install. The publisher must seal and verify the final path/mode/size/SHA-256 list against the containing public Git tree; its commit is read from the actual checkout, not preassigned here. This file does not assert that a public Git tree has been sealed, uploaded or submitted for audit; all external actions remain on hold.
