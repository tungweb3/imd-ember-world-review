# Production after deploying World fe8bc4b (2026-10-27 04:52 UTC)

- Worker `imd-world` version `d5335f94-8a74-44b2-bd3d-b2ff5d6a1f89`, deploy record `20261027T045146Z-fe8bc4b`: 3,622 tests run by the deploy tool (3,617 pass, 5 skipped, 0 fail), `dirty:false`, `source.unchangedDuringUpload:true`, `viteEnv:[]`, `nodeEnv:null`, `dependencies.mismatches:[]`, dist unchanged during the deploy.
- The uploaded Worker module `worker/index.js` has SHA-256 `df3dba9db9c5f807b577b0016bcf1eda8cb08c9bcf5d4fb46f66665ef406283e`, byte-identical to the one deployed from `64396ae` (Submission14, Worker `40c6477f`): no server code changed.
- Six live JS bundles (`index`, `WorldBootstrap`, `WorldGoldPanel`, `economyWallet`, `EconomyPane`, and the second `index` chunk) were byte-identical to the build.
- `POST /api/gold/orders/{id}/fast-credit` still answers 404.
- Two captured cron runs ended `ok`, no exception.
- A local QA run (synthetic wallet, local SQLite, the real purchase page): no note before payment; one note with the payment's own hash after it; the note survives a reload; finality clears it and books the GOLD; a rejected wallet prompt leaves no note.
- The deploy tool's dry run on the real repository passes all the new checks (no false refusal).
