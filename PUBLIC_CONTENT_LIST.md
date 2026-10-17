## Current candidate: Audit2 Medium remediation

Product source: `d4b897e9cc1f3b066517e4abd276d67a95e72768`. Previous accepted report: job `17fb18b0-3f81-4545-aabe-fe3316b73e64`, public `5a9e8f74a4b8f6c9cedf7e661d3c683c5af311c0`, product `6732aa3f75971a3ecb371dfaf9a7adcff77b7cb2`: **2 Medium + 2 Info**. That report does not review this revision.

This candidate addresses only the two Medium mechanisms: durable invalid-position withdrawal halt in direct/staged ingestion, plus controlled earlier-start recovery preserving halted/pending evidence; and scanner-independent physical payment classification/de-duplication, including shared payment contracts, backfill and explicitly deferred missing legacy owner registries. No Solidity, token rate, GOLD transfer, exchange, admin wallet or production enablement change. The two informational findings remain acknowledged and unchanged. Review the updated RECONCILIATION.md and the new economy-audit2-medium.test.mjs; do not infer a fresh external acceptance from local tests.

# Exact source publication inventory

This local candidate has142allowlisted files. The selected-source manifest binds79exact World files (1,042,460bytes) and16financial test files to product `d4b897e9cc1f3b066517e4abd276d67a95e72768`. The separate portable contract inventory contains41files, preserving the previously frozen remediation Solidity/compiler/artifact projection while independently rerunning this checkout.

Includes root scope/requirements/objectives/findings/reproduction/privacy documents, exact source/context manifests, zero-context World integration patch, sanitized test receipts, root verification/runners, selected financial server/client/SQL/test modules and the offline-copy recovery script/runbook. The full World renderer, complete Worker configuration/tests and unrelated assets/admin projects are omitted. The root objective contains the full scope; the separately prepared form references it and states the new recovery/authority boundaries.

Excluded even if present locally: ignored dependency junctions, .git ancestry, .rd/.wrangler/release, private receipts/logs, any true original/rebuilt/staged database, snapshots, recovery-plan.private.json, migration-batch.private.json, payment case/action exports, keys/signatures/credentials, owner-role lists and World media. Actual player data must never be added for convenience. Canonical token and immutable treasury are public protocol data. This inventory is not publication or deployment authorization; verify containing Git blobs against the frozen path/mode/size/SHA256 list.
