# Current candidate: e70ee73c remediation

Product source: e8afd02f650fb8b3f9696b8e02004c226105889a. Prior containing source: 8f89b6d47125763f8907f302030687fb5feec01a / product d4b897e9cc1f3b066517e4abd276d67a95e72768; accepted job e70ee73c-8d49-4dae-8538-83588e95baa5 reported 2 Medium, 1 Low, 1 Info. That report does NOT review these new bytes. Local verification and a future exact-source external review are distinct.

## Findings disposition (local candidate, external review pending)

| Finding | Disposition | Executable evidence | Limits |
|---|---|---|---|
| B-01 Medium partial/unissued settlement deadlock | LOCALLY_ADDRESSED_PENDING_EXTERNAL_REVIEW | economy-audit3-recovery.test.mjs: none,32/33wallets,64/65positions,direct/staged,replay,rollback,stale snapshots,second recovery,future days; old reconciliation suites | Only INVALID_POSITION_WITHDRAWAL; other halts still fail |
| B-02 Medium early immutable matched classification | LOCALLY_ADDRESSED_PENDING_EXTERNAL_REVIEW | owner/other scanner permutations,reachable single payment,halt/lineage,pending client/UI,CLI refuses fake completion; existing negative controls | Two exact same-payer/order/amount events are defensive inputs; actual EVM refuses duplicate. Existing wrong immutable cases require separate append-correction review; no production financial data is claimed migrated |
| B-03 Low initial empty sentinel | LOCALLY_ADDRESSED_PENDING_EXTERNAL_REVIEW | direct,staged and retained-prefix first-batch failure; pending old quote fulfills once; fake sentinel/height/history/other halt refused | Verified predecessor only,controlled indexer output,not independent consensus proof |
| B-04 Info halt scope | DOCUMENTED_AND_TESTED_PENDING_EXTERNAL_REVIEW | per-config halt/global GOLD regression; runbook and current-pane wording | One fixed production config; future concurrent-config policy must be reviewed separately |

B-01 uses one recovery path: only INVALID_POSITION_WITHDRAWAL may recover old unissued/partial UTC days from actual EARNED journals plus prior adjustments. Partial carry is not issued. Keep old pages/journals, snapshot guards and lineage, atomically retire the old namespace and close rebuilt history; overissuance and other halts still fail.

B-03 accepts an empty first-batch sentinel only after a namespace inventory, with the rebuilt indexer at the rejected first batch's exact predecessor height and a real finalized block identity. Existing pending quotes/challenges remain immutable and in lineage. Preserve validated staged prefixes; reject fake emptiness, economic history, arbitrary later boundaries, unsupported halts and config changes.

B-02 never permanently classifies an exact pending payment as matched/extra. Normal owner/lineage ingestion must fulfill first; other scanners retain facts and deferred/awaitingFulfillment counters. The private-wallet view derives pending-fulfillment without creating mutable final cases or moving money. CLI refuses unresolved fulfillment explicitly. After real fulfillment, physical identity determines final classification and exactly-once delivery. Old erroneous immutable cases are not rewritten; production financial features remain disabled. Duplicate exact events are defensive indexer inputs: the actual compiled EmbeoPayments rejects a second identical payer/order/amount call. Independently test the reachable single-payment/unfulfilled-owner case.

B-04 explicitly retains per-config halt with wallet-global GOLD; production serves one fixed reviewed config. Multi-config cross-vault spending-halt policy is a separate future design. No change to Solidity, migrations, auth, rates, treasury, transferable assets, principal exit, buildings/roads or production enablement.

## Earlier review history

- Job592da0ae / public143ac7e0 / productadb13e9a: earlier reward replay,completed-GOLD retry,wrong-amount and quote-expiry findings. Their adversarial controls remain in the selected current test files and the private World gate. Absence from the latest report is not treated as independent closure.
- Job17fb18b0 / public5a9e8f74 / product6732aa3f: 2Medium+2Info, predecessor of the local d4b897e9 fixes.
- Jobe70ee73c / public8f89b6d4 / productd4b897e9: the report this new candidate addresses. No report accepted for this new source yet.

No claim of current mainnet deployment/runtime/immutables,physical-wallet extension,productionCPU/D1 capacity,live catalogue or formal migration acceptance. No real-asset transaction or source publication is performed by this preparation.

## Concrete independent arithmetic checkpoints

These are controlled local fixtures, not player balances or mainnet claims. Expectations are derived from the complete events, not copied from a shortened report constant.

| Current fixture | Old earned J | Rebuilt entitlement E | Correction E-J | Check |
|---|---:|---:|---:|---|
| SQLite33 wallets,one missing two-share lot |32|35|3|First32 journals retained; wallet33 and missing lot corrected; next day total69 after a one-share withdrawal |
| SQLite65 positions for one wallet,partial64-position carry |0|67|67|Carry64 is unissued; no double credit; next day total133 after withdrawal |
| Native D1,33 wallets,one missing one-share lot |32|34|2|Future day total67; replay unchanged |
| Empty first-batch predecessor |0|0|0|No complete day at predecessor; old quote later fulfilled and historical day settled only after normal indexer advances |

## Reproduction and acceptance boundaries

- Run the exact root Node24 review runner. It selects18 current financial files, including economy-audit3-recovery.test.mjs, and separately runs actual compiled EDR contract tests.
- Current new regressions cover unissued/partial/full old days;32/33wallet and64/65position boundaries;direct/staged/prefix;owner/other order;private pending display;deferred CLI input protection;stale/fault/retry;second recovery;future settlement;fake bootstrap and unsupported-halt refusals. Existing selected suites retain earned-versus-spent,overissuance,SQL snapshot race,UTC,late-payment,GOLD retry,wrong signer/privacy,unknown send,nonce and WebLock controls.
- Resource limits remain5000events,366days,16ancestors,64statements,512KiB per bound snapshot/value,4MiB total; they are existing refusal guards, not a newly measured production-capacity result.
- No operator can use this CLI to send a refund,change original quote terms,delete immutable evidence or deploy a replacement payment contract.
- Existing pre-repair immutable matched rows are not silently rewritten. If a future production inventory finds such rows, preserve them and review an append-only correction plan; this packet does not claim to have migrated live cases.
- Actual wallet extensions,mainnet deployed contracts,provider completeness,target CPU/D1 budget,live catalogue and production migration/postflight are explicitly outside this local completion evidence.
