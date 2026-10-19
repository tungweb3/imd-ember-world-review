# Evidence and reproducibility

The producing checkout uses a fresh isolated install with install scripts
disabled, the unchanged Wrangler/Miniflare versions, and exact security overrides.
Native workerd D1 tests cover inventory CAS, campaign authority, atomic shared
balances/holds/debits, capacity-bound rewards and concurrent owed-credit retry.
FullWorld regression, TypeScript, build, deployment and HTTP/version postflight
are independent from the portable selected tests. Current counts and exact
status are recorded only after each check completes in evidence/current-review.json.

Windows's five existing native file-symlink privilege skips are not passes.
Empty production queues/index pages do not prove dense-block CPU capacity,
large-report peak CPU, real-wallet acceptance or high-load D1 performance.
The provider's original canonicalJSON framing is tested with its actual Python
serializer as well as TypeScript fixtures. Unknown timeouts are not refunds.
