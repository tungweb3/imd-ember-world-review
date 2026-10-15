# Submitted source boundary

The exact source pin, selected file list, byte sizes, SHA-256 and Git blob identifiers are recorded in `manifests/selected-source.json`. The fixed product candidate is `5c4922a8a8004e071a53974884251b9171e2ec6a`, based on `b5dd12ad852743c855ed68a8178a183ff2bdcd4f`. It includes the completed-stake date-display fix and the later forwarded/constructor/batched receipt indexing correction. A public Git containing commit must be pinned separately before submission; no private Git ancestry is included.

| Material | Included boundary |
|---|---|
| `world-source/server/economy*.ts` | Exact new configuration, closed release adapter, API, ledger, settlement, finalized RPC and staging modules. |
| `world-source/src/world/EconomyPane.tsx`, `economyClient.ts`, `economyWallet.ts`, `economyEntry.ts`, `economyPane.css` | Exact new lazy financial UI, strict response/message validation, integer transaction encoding, explicit approvals/execution and persistent uncertain-send handling. |
| `world-source/tests/economy-*.test.mjs` | Explicit eleven-file financial selection, including adversarial, API, client, real-EVM forwarder/constructor/batch receipts, full local journey, ledger, migration/restore, actual component lifecycle, RPC, settlement and staging. Full-Worker test excluded. |
| SQL migrations | Exact new 0010/0011 schemas plus every existing migration needed by the real native-SQLite test adapter. No database or data export. |
| Selected existing TypeScript source | Authentication, ownership, gateway/D1/type and client lifecycle imports needed to run/type-resolve the new financial boundary. No assertion that these old components received a new complete independent audit. |
| `contracts` | Portable separate contract package: exact Solidity source/ABI/bytecode/compiler settings, pinned compiler/OZ/ethers/EDR closure and public original-token fixture; tooling path changes explicitly documented. |
| `context/world-integration.patch` | Exact zero-context changes to economic Worker routing/cron/limiters, Vite dev routing, World overlay/audio/entry callbacks and wallet-module comment. |

The integration patch is evidence of the new wiring, not a runnable complete World renderer or a reproduction of the private full-Worker gate. `context/integration-source.json` records source before/after hashes and base/candidate commits; private full-World test evidence must be evaluated separately. The fixed UI hides moving estimates after a confirmed staking execution and retains the receipt plus the authoritative ledger position date; the actual component regression keeps a live session while advancing three UTC days so expiry cannot produce a false pass.

Excluded: complete World/Worker/Wrangler files, unrelated administrator-role lists, player names/ownership/balances, production D1, private sessions/credentials, VPS or chain state, backups, original private Git ancestry, 3D/media/novel/library/game assets, and unrelated AI Market/StickEmber source. The fixed canonical token and single immutable payment treasury are permitted public protocol identifiers; this does not permit publishing an unrelated administrator allowlist.

The review must assess Solidity and TypeScript together. Explicitly report any unsupported language, omitted dependency or boundary that the audit service cannot inspect. Old identity/token reviews, local test success, a paid admission or an accepted job status do not establish this scope's actual completed review.
