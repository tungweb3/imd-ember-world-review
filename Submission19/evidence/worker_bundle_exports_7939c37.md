# Worker bundle at 7939c37: exports and the WorkerEntrypoint import

`npx wrangler deploy --dry-run --outdir <scratch>` on the clean tree of World source 7939c37, 2026-10-29. Nothing was uploaded.

- bundled `index.js` SHA-256: `a9fb073cded48b7b44d85f162fdfa276fabd5e161fe34438fb8b2223cddc1402`
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

7939c37 changes only the registry check in server/genesis-gold.ts (a repeated added-token GOLD price refuses the entry)
and its tests; the entrypoint class is the one shown in worker_bundle_exports_20b1d6a.md.
