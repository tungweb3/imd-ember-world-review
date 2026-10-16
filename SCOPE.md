# Submitted source boundary

The exact source pin, selected file list, byte sizes, SHA-256 and Git blob identifiers are recorded in `manifests/selected-source.json`. The fixed product candidate is `adb13e9a98a3505229dbd866c6c268bca790d057`, based on `b5dd12ad852743c855ed68a8178a183ff2bdcd4f`. It includes the completed-stake date-display fix and the later forwarded/constructor/batched receipt indexing correction. A public Git containing commit must be pinned separately before submission; no private Git ancestry is included.

| Material | Included boundary |
|---|---|
| `world-source/server/economy*.ts` | Exact new configuration, closed release adapter, API, ledger, settlement, finalized RPC and staging modules. |
| `world-source/src/world/EconomyPane.tsx`, `economyClient.ts`, `economyWallet.ts`, `economyEntry.ts`, `economyPane.css` | Exact new lazy financial UI, strict response/message validation, integer transaction encoding, explicit approvals/execution and persistent uncertain-send handling. |
| `world-source/tests/economy-*.test.mjs` | Explicit fourteen-file financial selection, including adversarial, API, client, real-EVM forwarder/constructor/batch receipts, full local journey, ledger, migration/restore, actual component lifecycle, RPC, settlement and staging. Full-Worker test excluded. |
| SQL migrations | Exact new 0010/0011 schemas plus every existing migration needed by the real native-SQLite test adapter. No database or data export. |
| Selected existing TypeScript source | Authentication, ownership, gateway/D1/type and client lifecycle imports needed to run/type-resolve the new financial boundary. No assertion that these old components received a new complete independent audit. |
| `contracts` | Portable separate contract package: exact Solidity source/ABI/bytecode/compiler settings, pinned compiler/OZ/ethers/EDR closure and public original-token fixture; tooling path changes explicitly documented. |
| `context/world-integration.patch` | Exact zero-context changes to economic Worker routing/cron/limiters, Vite dev routing, World overlay/audio/entry callbacks and wallet-module comment. |

The integration patch is evidence of the new wiring, not a runnable complete World renderer or a reproduction of the private full-Worker gate. `context/integration-source.json` records source before/after hashes and base/candidate commits; private full-World test evidence must be evaluated separately. The fixed UI hides moving estimates after a confirmed staking execution and retains the receipt plus the authoritative ledger position date; the actual component regression keeps a live session while advancing three UTC days so expiry cannot produce a false pass.

This recheck adds exact finalized-height identity checks, opaque random order IDs with same-slot payment reconciliation, fresh quote/challenge write guards, nonce-bound pending intents, same-origin Web Locks and explicit finalized replacement recovery. The new payment-timing and wallet-recovery tests belong to the fourteen-file selection. Production Solidity, ABI and the portable contract build baseline remain unchanged; the read-only deployment preflight and its tests now validate complete finalized header identity. Prior checkpoint counts are historical evidence, not this checkpoint's test result. External review submission remains on hold pending the user's requested detailed local recheck.

Excluded: complete World/Worker/Wrangler files, unrelated administrator-role lists, player names/ownership/balances, production D1, private sessions/credentials, VPS or chain state, backups, original private Git ancestry, 3D/media/novel/library/game assets, and unrelated AI Market/StickEmber source. The fixed canonical token and single immutable payment treasury are permitted public protocol identifiers; this does not permit publishing an unrelated administrator allowlist.

The review must assess Solidity and TypeScript together. Explicitly report any unsupported language, omitted dependency or boundary that the audit service cannot inspect. Old identity/token reviews, local test success, a paid admission or an accepted job status do not establish this scope's actual completed review.

Second-recheck additions: the exact payload-roundtrip test, stricter client/request enum boundaries, late nonce-await guards and the portable read-only finalized-header preflight/control tests. Portable imports and the token fixture location are the only adaptations to the two mirrored chain-tool files. No deployed contract change or new network measurement is implied.

Final checkpoint adds persistent GOLD time lower bounds and four actual server/client roundtrip regressions for a hypothetical cross-request/worker server-clock regression. The candidate rejects before writes rather than clamping time. This defensive assumption does not establish client control or a production incident, and does not invalidate legitimate EMBEO same-slot block/server clock skew.
