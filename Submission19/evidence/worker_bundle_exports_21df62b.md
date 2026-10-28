# Worker bundle at 21df62b: exports and the WorkerEntrypoint import

`npx wrangler deploy --dry-run --outdir <scratch>` on the clean tree of World source 21df62b, 2026-10-29. Nothing was uploaded.

- bundled `index.js` SHA-256: `57052a34fc1918e2f6f731f30dc31a98c42231ed3bfe3725289f99b564ae8f5b`
- `#worker-entrypoint` still resolves under wrangler's `workerd` condition to the runtime class:

```js
5376:import { WorkerEntrypoint } from "cloudflare:workers";
```

- the module's exports are unchanged from 20b1d6a:

```js
export {
  GenesisGold,
  index_default as default
};
```

21df62b changes only server/genesis-gold.ts (the registry's addedTokenGoldCosts and the price check), its registry note
and its tests; the entrypoint class is the one shown in worker_bundle_exports_20b1d6a.md.
