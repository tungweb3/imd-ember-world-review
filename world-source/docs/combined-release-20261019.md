# Combined World release candidate — 2026-10-19

This is a candidate under development, not a production deployment or an accepted Audit verdict. Base World source41ca333d and Hive/Pepe commit aa4b6de are preserved. The exact previous public review snapshot is e5ca6e5ac90a9e78b4739a242995121e791cff92; job d6268e87-a268-48c7-87ec-fa243452f308 reported2 Medium,1 Low,1 Info. The repaired source here requires its own source-pinned review and release evidence.

## Included and accounted for

| Requirement | Candidate implementation | Production gate |
| --- | --- | --- |
| One-way EMBEO purchase of GOLD | Versioned immutable quote, exact original payment, one credit and receipt; GOLD is nontransferable/nonredeemable | Actual deployed/read-back payments contract, formal approved prices, finalized indexer and production migrations |
| Shared World GOLD | Available = book minus held; staking, topup, service/refund, Mint holds, admin original-order repairs and recovery use the same durable book | No import of prototype/memory balances; actual DB backup and migration |
| Member balances | Wallet EMBEO fixed mainnet Multicall; confirmed staking aggregate across all positions; shared available GOLD/book/held | Token read is independent of finance activation; missing/disabled/indexing/failed are explicit, never confirmed zero |
| Price changes | New quote uses latest version; old valid quote and paid receipt retain original price | Test products must not become formal prices |
| Mint shared GOLD | R4 concurrent free/paid, shared2222; original binding/auth, durable holds and original-namespace settlement | Mainnet Mint/signing/proof reader and real catalogue/assets remain separate gates; no3-day free restriction |
| Service retry/refund | Durable job and upstream idempotency contract; deterministic unusable result refunds original GOLD once; unknown timeout stays pending | Actual authenticated VPS delivery/query adapter and result authenticity; a fixture provider is not a real report |
| Admin and AIMarket campaign | Three previously designated owner wallets; original-order repair/refund, price versions, pause controls, UTC schedule/end | Real VPS/World enforcement together; external AIMarket remains public disconnected/blurred profile |
| Inventory/loadout/home cabinet | Original667b9f41 local collection patch merged, including three equipment slots/six cabinet positions, persistence, conflicts and tests | STILL LOCAL-ONLY. Fixture identities/items/NFT31337 are excluded from production builds. Real item grants, NFT allowlist/ownership, World identity/home rights, public projection and production storage are not implemented by this patch |
| Hive and Pepe2Pepe | Official websites and separate safe entrance choice in both languages; God view keeps avatar fixed | Actual combined production postflight; no building/road/model change |
| Backup | Preserve old audit, source/patches, databases, original R3/R4 and live deployment | Before production DB changes take baseline backup; after unified deployment perform and verify full backup to the established cloud destination |

Do not mark the local cabinet prototype as a finished production inventory. Its original LOCAL_SCOPE.md is historical prototype documentation; current Mint rules come from R4, not that document's past development pause.

Owner clarification: NFT inventory/display must use an explicit GAME-RELATED collection allowlist. Do not import all wallet NFTs or treat unrelated community/IMD membership/airdrop NFTs as game collectibles. Each approved collection needs its exact chain, contract and supported token standard; current ownership must be proved before showing/placing, and transfer-out removes the public display. No approved production game NFT contract has been supplied/deployed in this candidate, so no arbitrary collection is implicitly permitted. Fixture NFT31337 is never an allowlist entry for production.

## Audit7 repair boundary

1. M1: shared mode rejects new unlinked legacy catalogue orders in either currency. Pending legacy retries cannot reopen the route. Already-paid historical rows remain inspectable and are not silently credited/refunded; actual historic EMBEO exceptions need an independently verified original-payment/refund procedure. Linked GOLD topups remain usable while only service admission is paused.
2. M2: a result must match the documented structured report/content or explained zero/no-signal contract. Bare strings, including nonempty upstream error text, are unusable and use the existing original-price one-time refund. Historical rows are retained and inspection flags them; changing validation does not invent evidence of nondelivery or authorize mass retroactive refunds. Real adapters must validate authenticated product-specific outputs before this generic boundary.
3. L1: Mint admission samples a fresh clock immediately before the batch; default is the real server clock. Private-chain integration explicitly resamples the original chain clock. The SQL write-check independently includes sampled time < deadline. Expired retries do not release an executable existing hold; only original-namespace proof may release it. D1 queue latency after the final sample remains a deployment timing/capacity gate, not a claim of a database-native blockchain clock.
4. I1: both normal and concurrent-retry quote branches reject expired pending orders at equality; paid original receipts remain retrievable. HTTP returns409 ORDER_EXPIRED; the UI drops the expired request id so a deliberate next click can request a new quote, with no automatic payment or retry.

## Formal staking is not a configuration toggle

reviewedEconomyConfig() remains null. No mainnet vault/payment deployment or immutable runtime readback is recorded. Before activation: accepted exact-source external review, concrete owner wallet deployment/signing handoff, pinned mainnet runtime/token/treasury/constructor readback, original deploy block and finalized indexing, actual D1 capability/capacity, additive migrations/backup and postflight. Do not enable a synthetic address, fixture price, injected provider/reader or local chain as a substitute.

The user's combined deployment and backup authorization is retained. Partial hall-only deployment is superseded. There has been no production upload, database mutation, secret change, wallet signature/payment, original service restart or chain reset in this candidate work.
