# Publication allowlist

The authoritative selected product-byte allowlist is `manifests/selected-source.json`. It stages 68 committed World files (893,475 bytes) from fixed product commit `5c4922a8a8004e071a53974884251b9171e2ec6a` and explicitly selects eleven new financial test files. Includes all real SQL migrations and original package/lock evidence; no player data or World media is included. Recalculate this inventory if the product checkpoint changes.

| Prefix or file | Publication purpose |
|---|---|
| `README.md`, `SCOPE.md`, `REQUIREMENTS.md`, `REDACTIONS.md`, `DEPENDENCIES.md`, `LOCAL_TESTS.md` | Requirements, scope, reproduction and honest limitations. |
| `AUDIT_OBJECTIVE.en.txt`, `AUDIT_OBJECTIVE.zh-Hant.txt` | Explicit Solidity plus TypeScript economic review objective. |
| `package.json`, `.gitignore`, `.gitattributes`, `tools/*.mjs` | Root selected-review scripts, byte verification and offline privacy screening. |
| `manifests/selected-source.json` | Exact source commit, byte sizes, SHA-256 and Git blob map, and selected tests. |
| `evidence/selected-verification.json` | Sanitized measured cold-dependency selected-tree receipt: 26/26 contract and 136/136 financial tests, zero skips/failures. Separate from full private World, containing-public-Git and Swarm gates. |
| `context/world-integration.patch`, `context/integration-source.json` | Zero-context new World wiring and base/changed-file fingerprints only. |
| `world-source/` | Only manifest-listed exact new financial modules, tests, migration schemas and required existing dependency context. |
| `contracts/` | Only the separate portable contract package's explicit public allowlist, exact Solidity/artifacts/standard input, public token fixture, pinned compiler payload/dependency locks, test/build tooling and licenses. |

Excluded from publication even if present for local execution: every `node_modules` folder/junction, `.git` ancestry from private projects, `.rd`, `.wrangler`, generated `release/` and contract execution evidence, private JSON/logs, `.env`/`.dev.vars`, credentials/signatures/keys, remote state, production databases, backups and raw private receipts. A fixed payment treasury is public protocol data; unrelated administrator wallets are excluded.

The portable contracts have been placed using their separate exact 40-file allowlist and passed the independent cold-dependency selected-root run. The complete local publication allowlist contains 129 files, excluding ignored execution evidence and dependencies. The publisher must seal and verify the final path/mode/size/SHA-256 list against the containing public Git tree; its commit is read from the actual checkout, not preassigned here. This file does not assert that a public Git tree has been sealed or uploaded.
