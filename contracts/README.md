# Ember World economy contract review package

This is a portable projection of a local review candidate, not a deployment or an audit certificate. It contains no production credentials, wallet keys, production database, historical user data or dependency on an original workstation directory. Original Solidity source bytes, ABI, creation/runtime-template bytecode, immutable bindings, storage layout, compiler input and compiler metadata are preserved and checked against the frozen baseline.

Use Node 24.x with npm and a supported EDR native platform:

```
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

`npm test` builds using the pinned official compiler, checks every projected artifact against the baseline, then runs the full 26-test suite. It uses a fresh in-process chain 31337 with public test accounts. No RPC port, public-chain transaction or real wallet is used. All original tests are retained: 24 EVM cases and two preflight negative-control cases. The fixture token has exactly the previously verified mainnet EMBEO runtime; its balances and supply are instantiated locally for tests.

The compiler is Solidity `0.8.37+commit.f401782d`, with optimizer 200, Cancun, viaIR false and metadata bytecode hash none. The npm solc 0.8.37 wrapper is pinned, but its bundled soljson is not used because it differs from the official release payload. The exact official payload is included under `vendor/` and verified by SHA-256 before compilation. Compiler source is published at the exact upstream release tag, https://github.com/ethereum/solidity/tree/v0.8.37 ; provenance and license text are included. `DEPENDENCIES.md` records package pins and upstream licensing.

Only tooling imports, package resolution, local fixture location and public build evidence differ from the workstation-only package. `tools/runtime.mjs` loads solely this package's installed dependencies. `tools/check-projection.mjs` fails if any original Solidity source, ABI, bytecode, immutable binding, storage layout, metadata or token fixture differs. Runtime-template hashes are not deployed contract code hashes: deployment must bind the reviewed immutable values and pass the read-only post-deployment gate.

`npm run preflight:readonly` is an optional, explicitly networked check of canonical mainnet EMBEO on two fixed public RPC providers. It does not deploy a contract or transmit a transaction. It is not part of the offline build/test command. Public-check results and independent Swarm findings still need assessment at the final source pin before any deployment or feature enablement.

Install lifecycle scripts remain disabled. Native EDR is loaded from its platform-specific optional npm package; no source build or postinstall is required on the measured Windows x64 environment. Linux/macOS native execution has not been measured by this package's author. Initial npm installation needs registry access; compilation and EVM tests then run without network access. Do not publish node_modules, local caches or machine-generated private execution receipts.
