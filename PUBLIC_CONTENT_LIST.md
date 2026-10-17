# Current candidate: e70ee73c remediation

Product source: e8afd02f650fb8b3f9696b8e02004c226105889a. Prior containing source: 8f89b6d47125763f8907f302030687fb5feec01a / product d4b897e9cc1f3b066517e4abd276d67a95e72768; accepted job e70ee73c-8d49-4dae-8538-83588e95baa5 reported 2 Medium, 1 Low, 1 Info. That report does NOT review these new bytes. Local verification and a future exact-source external review are distinct.

B-01 uses one recovery path: only INVALID_POSITION_WITHDRAWAL may recover old unissued/partial UTC days from actual EARNED journals plus prior adjustments. Partial carry is not issued. Keep old pages/journals, snapshot guards and lineage, atomically retire the old namespace and close rebuilt history; overissuance and other halts still fail.

B-03 accepts an empty first-batch sentinel only after a namespace inventory, with the rebuilt indexer at the rejected first batch's exact predecessor height and a real finalized block identity. Existing pending quotes/challenges remain immutable and in lineage. Preserve validated staged prefixes; reject fake emptiness, economic history, arbitrary later boundaries, unsupported halts and config changes.

B-02 never permanently classifies an exact pending payment as matched/extra. Normal owner/lineage ingestion must fulfill first; other scanners retain facts and deferred/awaitingFulfillment counters. The private-wallet view derives pending-fulfillment without creating mutable final cases or moving money. CLI refuses unresolved fulfillment explicitly. After real fulfillment, physical identity determines final classification and exactly-once delivery. Old erroneous immutable cases are not rewritten; production financial features remain disabled. Duplicate exact events are defensive indexer inputs: the actual compiled EmbeoPayments rejects a second identical payer/order/amount call. Independently test the reachable single-payment/unfulfilled-owner case.

B-04 explicitly retains per-config halt with wallet-global GOLD; production serves one fixed reviewed config. Multi-config cross-vault spending-halt policy is a separate future design. No change to Solidity, migrations, auth, rates, treasury, transferable assets, principal exit, buildings/roads or production enablement.

## Retained review requirements

# Exact source publication inventory

This local candidate has142allowlisted files. The selected-source manifest binds79exact World files (1,042,460bytes) and16financial test files to product `e8afd02f650fb8b3f9696b8e02004c226105889a`. The separate portable contract inventory contains41files, preserving the previously frozen remediation Solidity/compiler/artifact projection while independently rerunning this checkout.

Includes root scope/requirements/objectives/findings/reproduction/privacy documents, exact source/context manifests, zero-context World integration patch, sanitized test receipts, root verification/runners, selected financial server/client/SQL/test modules and the offline-copy recovery script/runbook. The full World renderer, complete Worker configuration/tests and unrelated assets/admin projects are omitted. The root objective contains the full scope; the separately prepared form references it and states the new recovery/authority boundaries.

Excluded even if present locally: ignored dependency junctions, .git ancestry, .rd/.wrangler/release, private receipts/logs, any true original/rebuilt/staged database, snapshots, recovery-plan.private.json, migration-batch.private.json, payment case/action exports, keys/signatures/credentials, owner-role lists and World media. Actual player data must never be added for convenience. Canonical token and immutable treasury are public protocol data. This inventory is not publication or deployment authorization; verify containing Git blobs against the frozen path/mode/size/SHA256 list.
