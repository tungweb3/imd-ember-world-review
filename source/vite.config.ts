import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imdGatewayPlugin } from './server/vite-plugin.ts';

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

// build.license: the minified bundle drops the three.js/React license comments, so their notices ship as a file beside it.
export default defineConfig({ plugins: [react(),imdGatewayPlugin(),shotPlugin()], server: { strictPort: true }, build: { target: "es2022", license: { fileName: "third-party-licenses.txt" } } });
