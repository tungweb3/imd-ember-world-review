# Production after deploying World be7d3b0 (2026-10-27 17:18 UTC)

- Worker `imd-world` version `7dfe57a1-9917-4d36-87e5-159a8aa6d134`, deploy record `20261027T171806Z-be7d3b0`: 3,635 tests run by the deploy tool (3,630 pass, 5 skipped, 0 fail), `dirty:false`, `source.unchangedDuringUpload:true`, `viteEnv:[]`, `buildEnv:[]`, `targetEnv:["CLOUDFLARE_ACCOUNT_ID"]` (the account was chosen by the shell; its value is not recorded), `nodeEnv:null`, `dependencies.mismatches:[]`, dist unchanged during the deploy.
- The uploaded Worker module `worker/index.js` has SHA-256 `df3dba9db9c5f807…`, byte-identical to the one deployed from `38a21a3` (Submission16), `fe8bc4b` and `64396ae`: no server code changed.
- All 58 live JS and CSS files under `/assets/` were byte-identical to the build; the controller and GOLD panel chunks carry the new `paidOrder` field. The live `index.html` equals the build except for Cloudflare's injected Web Analytics `<script>` before `</body>` (blocked by the site's CSP; pre-existing, not part of the build).
- `POST /api/gold/orders/{id}/fast-credit` (the retired route) answers 404; `GET /api/economy/config` answers 200.
- A 150-second `wrangler tail` captured 2 cron runs, both `ok`, no exceptions.
- Not checked: the GOLD-panel recovery block and the learned nonce with a real wallet; no purchase with a real wallet since these deploys.
