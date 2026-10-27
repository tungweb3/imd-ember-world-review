# Production after deploying World 38a21a3 (2026-10-27 09:33 UTC)

- Worker `imd-world` version `eb8f9da9-825d-4029-aa44-9c1ecfad08e4`, deploy record `20261027T093325Z-38a21a3`: 3,631 tests run by the deploy tool (3,626 pass, 5 skipped, 0 fail), `dirty:false`, `source.unchangedDuringUpload:true`, `viteEnv:[]`, `buildEnv:[]`, `nodeEnv:null`, `dependencies.mismatches:[]`, dist unchanged during the deploy.
- The uploaded Worker module `worker/index.js` has SHA-256 `df3dba9db9c5f807…`, byte-identical to the one deployed from `fe8bc4b` (Submission15) and `64396ae` (Submission14): no server code changed.
- All 58 live JS and CSS files under `/assets/` were byte-identical to the build. The live `index.html` equals the build except for Cloudflare's injected Web Analytics `<script>` before `</body>` (blocked by the site's CSP; pre-existing, not part of the build).
- `POST /api/gold/orders/{id}/fast-credit` (the retired route) answers 404; `GET /api/economy/config` answers 200.
- A 150-second `wrangler tail` captured 5 cron runs, all `ok`, no exceptions.
- The home page loads; the only console error is the blocked Cloudflare beacon above.
- Not checked: the new GOLD-panel recovery block with a real wallet (it is shown only when a payment's state is unknown).
