# Production after deploying World 96858bf (2026-10-27 18:28 UTC)

- Worker `imd-world` version `b08f59ef-0c80-4632-a4f3-f96e9c0cbb01`, deploy record `20261027T182851Z-96858bf`: 3,635 tests run by the deploy tool (3,630 pass, 5 skipped, 0 fail), `dirty:false`, `source.unchangedDuringUpload:true`, `viteEnv:[]`, `buildEnv:[]`, `targetEnv:["CLOUDFLARE_ACCOUNT_ID"]` (name only), `nodeEnv:null`, `dependencies.mismatches:[]`, dist unchanged during the deploy.
- The uploaded Worker module `worker/index.js` has SHA-256 `df3dba9db9c5f807…`, byte-identical to the ones deployed from `be7d3b0` and `38a21a3`: no server code changed.
- All 58 live JS and CSS files under `/assets/` were byte-identical to the build. The live `index.html` equals the build except for Cloudflare's injected Web Analytics `<script>` (blocked by the site's CSP; pre-existing).
- `POST /api/gold/orders/{id}/fast-credit` (the retired route) answers 404; `GET /api/economy/config` answers 200.
- A 180-second `wrangler tail` captured 3 cron runs, all `ok`, no exceptions.
- The GOLD product titles in D1 (`world_gold_products`, read with SELECT only) are unchanged by `96858bf` (only page text changed).
