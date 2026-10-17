# Audit4 finding disposition

Product source fe920ae748155d7d7ed9aaa98ebb6f9fb2c3a81f. Previous product e8afd02f650fb8b3f9696b8e02004c226105889a, public ca2ed8a1fd509e9d03989924b2ef1c77e4ab5037, accepted job 658db620-bc5e-4dfd-ace6-7eae69968112 reported 1 Medium, 4 Low, 1 Info. That report does not cover these new bytes. New exact-source external review is pending.

All six dispositions are local changes pending independent exact-source review.

C-01: repeated bootstrap-prefix recovery validates immutable ancestor receipts, canonical registry, same staking domain and transitive lineage; preserves original prefix/journals and credits only the true positive shortfall once. Corrupt or missing receipt boundaries still fail.

C-03/C-04: verified foreign retired progress no longer blocks this vault; unrelated healthy or halted pending prefixes are excluded only from semantic checks. Every financial table remains in the atomic snapshot guard, so foreign concurrent changes still invalidate the plan.

C-05: only provably empty same-vault sync metadata is tolerated. Events, positions/checkpoints, day progress/pages, journal references, bindings, staged/pending data, pending orders and payment cases/recovery/lineage remain footprint. Challenges/fulfillments/actions/adjustments retain their existing FK and ownership relationships. No evidence deletion.

C-02: snapshots are deterministic 128-row pages. Count plus all complete page values are compared inside one atomic batch. UTF-8 bounded bulk imports retain global block/log event order. The identical read-only planner powers the preflight CLI, reports actual bytes/pages/guard parameters/statements or an explicit capacity failure, and never creates a writable DB copy. All caps apply together: 5000 events is only an upper cap, not guaranteed capacity; 366 days,16 ancestors,64 statements,512KiB per page/bound value,4MiB both snapshots,100 guard parameters. Oversize data remains untouched and requires a separately reviewed larger atomic plan. A 600-existing-event/601-rebuilt-event fixture passes locally; arbitrary workloads and actual Workers/D1 production capacity remain unproved.

C-06: neutral bilingual list text, pending delivery explicitly says do not pay again, exceptions have separate wording, pending rows do not claim an exception disposition. No debit, resend or refund behavior changes.

No Solidity, migrations, auth, reward ratio, treasury, buildings/roads, production flags, catalogue or services change. Prior A/B authority, clock, UTC, nonce/replacement, payment privacy/dedup, earned-journal and atomicity controls remain required.

## Executable evidence

See world-source/docs/economy/AUDIT4_REMEDIATION.md, economy-audit4-recovery.test.mjs, bilingual economy-pane.test.mjs and the retained Audit3/reconciliation/authority suites. Red fixtures are replayed against the old exact Git source; failures caused by absent new preflight API/CLI are labeled separately from reproduced old behavior. The original 658db620 report remains retained privately; it is not a report for this new candidate.
