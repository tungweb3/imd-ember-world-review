# Planned shared GOLD migration, inspection and recovery

This is a reviewable LOCAL plan only. Do not execute remote D1 commands, restart/reset the preserved chain, alter production secrets/configuration, enable services, send real payments or deploy this candidate as part of packet preparation.

## Forward migration and interruption

1. Capture the exact reviewed source/auxiliary hashes and the original DB's applied-migration list plus table/column/index/trigger inventory. Preserve original exports and their SHA256, existing services, finalized event evidence, chain namespace registry and previous release.
2. On an offline duplicate only, verify integrity and FK checks, then apply the exact *missing* canonical migrations in order. An already applied0010–0015 is never edited/reapplied. The new change is0016. Known historical schemas missing0014/0015 apply those original files first. Unknown partial/mixed schemas require explicit review; presence of one table does not authorize guessing a migration history.
3. Verify `worldGoldSchemaReady` returns true for the complete reviewed112-object/244-column inventory. It has no positive/negative cache. Verify account/book/held/available, original paid entitlements, failed refunds, day progress and pending rewards. Compare the original export byte-for-byte; only the duplicate changes.
4. Reproduce code-ahead-of-schema: current World POST refuses `SCHEMA_INCOMPLETE`, maintenance logs a coded deferred state, no new debit/quote/hold is accepted, and original obligations remain. Apply missing migrations on the duplicate and retry the exact original order; do not request payment again.
5. The old `economy-recovery.mjs migrate-copy` is the retained historical0012/0013 recovery tool, not a complete shared-GOLD migrator. The0014–0016 duplicate upgrade is demonstrated separately by executable audit6 migration tests. No new production migration has been applied or promised.

An eventual production rollout should keep all new admissions disabled through verified backup, migration, source/config/consumer compatibility checks and postflight. Code-first mistakes must still fail closed. Prefer forward fixes or roll back code/config to the compatible reviewed release; do not reverse a migration by dropping financial tables. Restoring SQLite does not restore EVM authority. A lost original reader/chain stays blocked.

## Read-only exception inventory

`inspectWorldGoldExceptions` is a bounded internal read-only helper, without a public HTTP endpoint or arbitrary SQL/credit input. It returns schema readiness, case rows and per-category next cursors. Paginate each category; a100-row page is not a full database certification. An incomplete schema yields `SCHEMA_INCOMPLETE` with no inspected cases and must not be interpreted as “no exceptions.” Use an upgraded offline duplicate to inspect older exports; retain the unchanged original.

| Case | Preserved evidence | Planned handling; no production action this round |
| --- | --- | --- |
| Owed staking reward | Original config/day/wallet/delta/reference; settled-null and retry state | First verify earned event entitlement. Let bounded retry insert the original journal only when capacity fits. Never add a new-day replacement reward or erase the owed row. |
| Failed service/refund pending | Original paid order/link/cost and terminal evidence; actual credits | Retry exact remaining original refund. Capacity failure retains failed/refund-pending, never claims `refunded`. Once actual credit commits, terminal refunded and receipt become authoritative. |
| Legacy paid without durable job | Original service id/wallet/amount, signature debit, paid status and legacy fulfillment | Independently determine actual delivery/contract. Prepare a reviewed append-only reconciliation/compensation plan bound to the original order and maximum outstanding amount. Do not invent a new price, charge again, blindly deliver again, or assume legacy fulfillment means an external report was delivered. Current code blocks new legacy admissions; it does not assert all historical legacy cases are resolved. |
| Historical delivered-empty result | Original debit/result/evidence/status | Preserve history and identify actual nondelivery. Propose separately reviewed compensating evidence/credit, with original-price cap and dedupe. Do not rewrite delivered/evidence fields or misuse a generic balance setter. |
| Wrong historical proof-mode label | Original immutable settlement and original chain/reader facts | Preserve the immutable row. Prepare an append-only classification correction linked to independently verified facts; never relabel a private chain as finalized or alter the old receipt to conceal it. |
| Held Mint | Full persisted binding, original registry/reader/chain and proof | Settle only with the preserved authority. Latest-time/retry eligibility is not finalized expiry authority. A new runId/chain, process restart, restored DB or missing memory map never suffices. |

No inventory result establishes that production actually contains these cases. This round's examples are isolated fixtures. Historical compensation for paid-no-job or delivered-empty cases requires its own reviewed data plan; no such production mutation is implemented or executed here.

## Observable maintenance and manual recovery

- Topup/refund reconciliation processes at most128 candidates per class, commits each independently and records per-order stable error/cooldown. An explicit original-order retry can recheck after room appears without repricing it.
- Pending reward retry processes at most32 original rows, exposes credited/capacity/retry status, and defers unsuccessful rows for five minutes. The day marker means accounted scanning; owed is not issued. A target journal fault must not roll back healthy peers or erase its entitlement.
- Provider runner claims at most16 jobs. `orderId` is the external idempotency key across timeout/restart. Use QUERY/DELIVER semantics from the provider contract; unknown delivery is not terminal nondelivery. Attempts/leases fence stale writers.
- Mint reconciliation is max32 with a persisted cursor. Wrong/missing authority returns a blocked diagnostic and preserves holds. Reset with an injected persistent ledger is refused before chain or memory changes.
- Historical correction separates book/spent amounts from earned event entitlements. Pending rewards are counted as already owed and included in the atomic source snapshot, so the same share-day cannot be corrected and later retried twice. If a **new correction** cannot fit, the reviewed plan remains blocked with a coded integer-capacity error; it does not cancel rights or publish a partial unreviewed plan.
- Real Workers CPU/D1 limits, provider completeness, durable chain namespace/reader registry, real-wallet behavior and production migration/postflight are separate release gates. Bounded local work and exact-SQL local D1 tests do not certify production capacity.

## Three complete flow proofs

1. **Topup -> shared balance:** exact contract payment receipt/log -> order paid -> one original credit -> replay/partial credit/price change -> state reload. Actual private EVM plus native D1 paths are retained. The exact1025-order SQL reproduction establishes the reported capacity precondition using legitimate current quotes rather than a balance setter.
2. **Service -> delivery/refund:** explicit signed debit -> one durable job -> saved result without another charge; pending timeout with the same key; terminal invalid result or structured nondelivery -> original refund once. Refilled capacity keeps refund pending until room exists. Concurrent/late worker and DB-write-fault controls preserve atomicity.
3. **Mint -> consume/legal release:** exact scoped hold -> real private EVM free/paid execution -> one consume receipt; equality refuses retry without release; delayed authority stays pending; later verified expiry/revocation releases; map loss and same-chain SQLite backup restore recover against the original reader. A paid-only GOLD pause leaves eligible free mint fee-free and existing hold settlement serviceable.

The private EVM is memory-only. Same-chain backup tests retain its original running authority. They prove neither machine-restart EVM persistence nor public finality.

Old pre0016 recovery binaries must not process a migrated book with owed rewards. SQL0016 refuses new plans without the pending-entitlement-aware report marker while owed rows exist. A rollback keeps finances disabled and preserves the compatible maintenance binary/obligations; it does not reactivate an old writer or discard a queue.
