# Post-release review remediation

This release fixes three reproduced defects on the prior World267fcf01 baseline:

1. Delivery pagination selected16 jobs before excluding products unsupported by
   the current provider. Sixteen deferred historical jobs could starve a valid
   research job. Filter the supported result-contract products in SQL before the
   limit. Preserve deferred jobs, original debit amounts and provider keys.
2. A valid900KB report can exceed2.1MB when the protocol includes both its JSON
   document and its canonical JSON string. Re-escaping the latter produced a
   reproducible2,400,495-byte response from an800,120-byte Python document.
   Bound read responses at3*900,000+16,000 bytes; retain summary size, timeout,
   stream cancellation, HMAC, original wallet/order and document-hash checks.
3. The legacy private economy snapshot checked the session before asynchronous
   reads but not after them. Revalidate the same session and a monotonic clock
   before returning; logout/expiry returns401 without private data, and a clock
   regression returns503.

Nine regression cases reproduce starvation, later provider resumption, bounded
pagination, lease expiry equality, JSON response limits and late logout/expiry.
The report-size fixture additionally uses the actual Python serialization code.

## Build-tool repair

Keep the previously tested Wrangler/Miniflare versions. Patch only the vulnerable
transitive dependencies with exact npm overrides: sharp0.35.5 and
source-map-js1.2.2. These address GHSA-wq5f-xc86-pv6w and GHSA-68fv-2mgg-jv7q.
Use an isolated clean dependency installation, with installation scripts disabled;
do not update a shared dependency directory used by another project. Record the
exact lock and tool versions in release evidence and rerun native Worker/D1 tests.
An advisory scan alone is not integration or deployment evidence.

## Unchanged release boundaries

No Solidity, deployed contract addresses, production schema, financial rate,
retail prices, NFT allowlist, buildings, roads, models, video or audio are changed.
Purchases, paid services and Mint new-admission controls remain closed while
prices/issuance are unset. GOLD remains nontransferable and nonredeemable.
Do not redeploy the existing mainnet contracts or create real paid fixture orders.

The source commit and successful release record identify what actually shipped.
Prepared audit materials, public GitHub availability, paid Swarm submission and
an accepted audit verdict are separate facts. Preserve earlier backup and audit
snapshots; they do not silently acquire these changes.
