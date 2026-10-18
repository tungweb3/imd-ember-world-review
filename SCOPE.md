# Review scope

Review migration 0014 and the legacy account/recovery changes; original-price topups and once-only partial-credit repair; shared available/book/held GOLD; scoped Mint reservation and proven receipt settlement; paid service jobs, leases, retry, saved results and terminal-failure refunds; EOA/SIWE account continuity and live SQL authorization; admin identity, immutable reason/before/after records, versioned pricing and new-admission switches; authenticated World-only AIMarket trial claims and the Python consumer.

No new staking/payment Solidity implementation is introduced. Their exact prior sources, compiler inputs, ABI, bytecode and EMBEO token fixtures are retained with projection checks. R4 Mint Solidity is unchanged; its copied service awaits the injected shared persistent ledger. Review that boundary, not only the Solidity files.

The World Worker release configuration still returns null. Fixture prices are 7 EMBEO for 10 GOLD, research 3 GOLD, fortune 2 GOLD, paid Mint 300000 test EMBEO plus 1 GOLD (test UI admins may version fixture packages). No value is a production price. Test chain recipient is a synthetic test identity; the production treasury remains the confirmed existing public treasury in economy-config.

Local R4 EDR needs chain 31337. Only the explicit SQLite fixture adapter changes the registry chain check at local DB creation. The production migration remains chain 1. A separate local workerd D1 test runs exact production SQL. Neither is a production CPU/row-limit capacity proof.

Private EDR chain state is memory-only. SQLite reopen/backup/restore proof retains the same live EVM. Restarting the process or machine does not restore chain authority or authorize release of held GOLD. The preview refuses to reuse an existing saved fixture file as a new chain instance.

Actual AIMarket/fortune report providers, target VPS installation, real-wallet signing, real chain/runtime/config/finality, deployment/migration rollback and production capacity remain independent release gates. Test result providers are explicit fixtures. The external AIMarket teaser is unchanged. Games and real game GOLD rewards are deferred. NFT/collection production rights are not granted by this packet.

The user authorized publication of this candidate to tungweb3/imd-ember-world-review on branch economy-shared-gold-20261018-57ce2d59. The Audit form must use the actual public commit resolved after upload, not the local World source commit or an old audit commit. This authorization covers source publication and filling the form; wallet signing, payment and deployment remain outside this preparation.
