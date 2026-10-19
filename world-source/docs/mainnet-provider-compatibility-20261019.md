# Mainnet provider transport compatibility

The production acceptance probe on2026-10-19 observed the existing Alchemy
binding returning HTTP200 for chainId1 and the finalized header, HTTP400 with
JSON-RPC error-32600 for a128-block eth_getLogs query, and HTTP200 with a
complete empty result for the same contracts over10 blocks. The key value was
retained inside Cloudflare and never read out, replaced or included in evidence.
The public Alchemy method documentation also lists10 blocks for Free Ethereum:
https://www.alchemy.com/docs/chains/data-network/data-network-api-endpoints/eth-get-logs

The production Worker now fixes maxLogBlockRange10. A canonical page still
covers up to128 consecutive blocks. Each physical log request passes through
the existing independent600/min financial RPC budget. The complete responses
are combined only after checking each log belongs to its own requested slice.
Combined log pressure narrows the canonical page; no result is truncated.
Single busy blocks retain the existing complete-log staging/receipt validation.
All headers, anchors, finalized identity, receipts, amounts, UTC settlement,
CAS, holds and original payment-repair checks remain in force.

The generic engine retains its128-block transport default for injected adapters
which support that range. Only the fixed deployed provider selects10; browser
flags and environment values cannot choose the transport span or RPC endpoint.
No identity/NFT RPC code, credentials, economic rule or deployed contract changes.

The failure was reproduced before the fix: eight regression checks, one passing
reproduction and seven failing required behaviors. Regression coverage includes
full128-block progress, chunk-boundary events, complete receipts and replay,
combined log pressure, wrong-subrange/malformed later results, invalid bounds,
and accounting for every physical production RPC. Production cron outcomes
also retain a controlled error code without logging provider strings or keys.

The earlier8bf1844 publication was held behind the existing throughMs>0 stake
gate while the production index remained uninitialized. A release/backup report
must state the actual final published source and successful index readback;
this document alone is not an accepted Audit verdict or production success.
