# Worker bundle at 20b1d6a: exports and the WorkerEntrypoint import

`npx wrangler deploy --dry-run --outdir <scratch>` (wrangler 4.143.0) on the clean tree of World source 20b1d6a, 2026-10-29. Nothing was uploaded.

- bundled `index.js` SHA-256: `4656291f0fa7d32cc62b72d28ff2f187592dec2852d0825a3f5c15a71c6faed9`
- `#worker-entrypoint` resolved under wrangler's `workerd` condition to the runtime class:

```js
5376:import { WorkerEntrypoint } from "cloudflare:workers";
```

- the module's exports (workerd accepts a default handler plus WorkerEntrypoint classes):

```js
export {
  GenesisGold,
  index_default as default
};
```

- the entrypoint class:

```js
var GenesisGold = class extends WorkerEntrypoint {
  static {
    __name(this, "GenesisGold");
  }
  reserve(request) {
    return createGenesisGoldService2(this.env).reserve(request);
  }
  order(request) {
    return createGenesisGoldService2(this.env).order(request);
  }
  reconcile(request) {
    return createGenesisGoldService2(this.env).reconcile(request);
  }
};
```

Under Node (the test suite) the same specifier resolves to `worker/entrypoint-node.ts`, a stub with the same shape.
