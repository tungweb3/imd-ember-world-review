## Current candidate: Audit2 Medium remediation

Product source: `d4b897e9cc1f3b066517e4abd276d67a95e72768`. Previous accepted report: job `17fb18b0-3f81-4545-aabe-fe3316b73e64`, public `5a9e8f74a4b8f6c9cedf7e661d3c683c5af311c0`, product `6732aa3f75971a3ecb371dfaf9a7adcff77b7cb2`: **2 Medium + 2 Info**. That report does not review this revision.

This candidate addresses only the two Medium mechanisms: durable invalid-position withdrawal halt in direct/staged ingestion, plus controlled earlier-start recovery preserving halted/pending evidence; and scanner-independent physical payment classification/de-duplication, including shared payment contracts, backfill and explicitly deferred missing legacy owner registries. No Solidity, token rate, GOLD transfer, exchange, admin wallet or production enablement change. The two informational findings remain acknowledged and unchanged. Review the updated RECONCILIATION.md and the new economy-audit2-medium.test.mjs; do not infer a fresh external acceptance from local tests.

# Pinned reproduction dependencies

Use Node 24.x (measured Windows x64 host: 24.19.0). Native `node:sqlite` executes the actual additive SQL migrations; replacing it with an in-memory JavaScript accounting imitation is not equivalent. Use each supplied lock file and `npm ci --ignore-scripts --no-audit --no-fund`. Lifecycle scripts remain disabled; no native postinstall is needed on the measured Windows x64 EDR runtime. Dependencies are not vendored as `node_modules` and machine junctions must never be committed.

| Package | Pin | Purpose |
|---|---|---|
| viem | 2.56.9 | Server message recovery/RPC encoding; independent client ABI reference in tests. |
| @noble/curves | 1.9.1 | Existing identity verification dependency. |
| TypeScript | 5.9.3 | Transpile the actual React component into lifecycle test fixtures. |
| React / React DOM | 19.2.6 | Preserved client package/type context; original lock unchanged. |
| Three | 0.186.1 | Preserved type/dependency closure only; no World asset files are copied. |
| solc | 0.8.37 wrapper, official 0.8.37+commit.f401782d payload | Exact contract compilation. The verified official payload differs from npm's bundled soljson. |
| OpenZeppelin contracts | 5.4.0 | Exact SafeERC20, ReentrancyGuard and imported interfaces. |
| ethers | 6.15.0 | Isolated contract interaction and original-token runtime checks. |
| Hardhat | 3.19.0 | In-process Cancun runtime, with no public RPC/fork/listening socket. |
| EDR | 0.22.2 | Native isolated execution; platform package chosen by the supplied lock. |

Compiler settings are optimizer enabled/runs 200, viaIR false, Cancun, metadata bytecode hash none. Official compiler payload SHA-256 is `d73fead3cbc860438f56f4d1723677499cdef212d0f8890241748d2d5afc1c5f`; compiler version must be `0.8.37+commit.f401782d.Emscripten.clang`. The portable package provides provenance, complete standard input, imported source hashes, exact artifacts, immutable bindings and relevant licenses. Raw private machine paths are omitted.

`world-source/package.json` and its lock are preserved exact source evidence, including existing Vite/Wrangler/native tool dependencies. This selected package intentionally lacks the original renderer/assets and full deployment closure. Use the packet root's explicit `test`/`test:financial`/`test:contracts` scripts; running preserved full-World build or deployment scripts is unsupported here.

The financial runner verifies the exact manifest, creates ignored local `release/` and `.rd/recheck-2026-10-16/ledger/` directories for relative generated evidence, and passes an explicit seventeen-file list to Node with test concurrency 2. The forwarded/constructor/batched receipt and payment-timing tests use the same portable compiler/runtime; production contract bytecode is unchanged. Wallet-recovery uses existing TypeScript dependencies and mocked provider/storage transports. Migration backup fixtures use a newly created OS temporary directory with verified cleanup boundaries. Contract tests run serially against fresh EDR memory. These local fixture operations do not read or reset production data.

This recheck reuses the prior independently cold-installed physical dependency trees through ignored local `node_modules` junctions. Both package locks are byte-identical to that measured installation. No `npm ci`, dependency upgrade or lifecycle script is run in this round; do not describe this round as another fresh installation. A recipient can independently install both exact locks with the command above.

Windows fresh dependency installation and native execution evidence must be recorded from the exact portable package. Availability of a Linux/macOS native EDR binary does not prove that it was executed here. No package install, checksum comparison or compiler success establishes Swarm acceptance, production CPU/D1 capacity or permission to deploy.
