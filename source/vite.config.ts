import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imdGatewayPlugin } from './server/vite-plugin.ts';
import { readFileSync } from "node:fs";
import { PUBLIC_HASHES } from './src/world/publicHashes.ts';
import { hashedPath } from './src/world/publicUrl.ts';
import { contentHash } from './scripts/content-hash.ts';
import { terrainField } from './src/world/skin/terrainField.ts';
import { packTerrain, BAKED_TERRAIN_ID } from './src/world/skin/terrainBake.ts';

// Dev-only: POST /__shot?name=x with a PNG data URL saves the WebGL canvas to docs/map-revision/renders/.
function shotPlugin(): Plugin {
  return { name: 'shot-capture', apply: 'serve', configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      const name = new URL(req.url ?? '', 'http://x').searchParams.get('name')?.replace(/[^a-z0-9_-]/gi, '') || 'shot';
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => { const dir = join(server.config.root, 'docs/map-revision/renders'); mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.png`), Buffer.from(body.replace(/^data:image\/png;base64,/, ''), 'base64')); res.end('saved ' + name); });
    });
  } };
}

// Build only: each public file in src/world/publicHashes.ts is also written under assets/ with its content hash in the
// name (publicUrl.ts hashedPath), the copy the page loads; public/_headers caches /assets/* for a week. A file whose
// content no longer matches its hash stops the build (run node scripts/hash-public.mjs).
export function hashedPublicCopies(root = process.cwd()): Plugin {
  return { name: 'hashed-public-copies', apply: 'build', generateBundle() {
    for (const [path, hash] of Object.entries(PUBLIC_HASHES)) {
      const source = readFileSync(join(root, 'public', path));
      if (contentHash(source) !== hash) this.error(`public/${path} changed since it was hashed: run node scripts/hash-public.mjs`);
      this.emitFile({ type: 'asset', fileName: hashedPath(path)!, source });
    }
  } };
}

// Build only: the phone's terrain field (src/world/skin/terrainField.ts) worked out once here and written under assets/
// with its content hash in the name; `virtual:baked-terrain` exports its URL (null on the dev server, where the page
// works it out itself). Phones download it instead of spending ~1 s of main thread on it (skin/terrainTask.ts).
export function bakedTerrain(): Plugin {
  const resolved = '\0' + BAKED_TERRAIN_ID;
  let build = false, file: { name: string; source: Uint8Array } | null = null;
  return { name: 'baked-terrain', configResolved(config) { build = config.command === 'build'; },
    resolveId(id) { return id === BAKED_TERRAIN_ID ? resolved : null; },
    load(id) {
      if (id !== resolved) return null;
      if (!build) return 'export default null;';
      if (!file) { const source = packTerrain(terrainField(true)); file = { name: `assets/terrain-phone.${contentHash(source)}.bin`, source }; }
      return `export default import.meta.env.BASE_URL + ${JSON.stringify(file.name)};`;
    },
    generateBundle() { if (file) this.emitFile({ type: 'asset', fileName: file.name, source: file.source }); } };
}

// build.license: the minified bundle drops the three.js/React license comments, so their notices ship as a file beside it.
export default defineConfig({ plugins: [react(),imdGatewayPlugin(),shotPlugin(),hashedPublicCopies(),bakedTerrain()], server: { strictPort: true }, build: { target: "es2022", license: { fileName: "third-party-licenses.txt" } } });
