import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Swarm review F-6 follow-up (2026-09-29): GHSA-3wwx-pv8p-q78v affects undici 7.28.0-7.29.0, reached through
// wrangler -> miniflare (build and dev tools only). package.json overrides it; this reads what `npm ci` installs.
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const parse=v=>v.split(/[.-]/).slice(0,3).map(Number);
const cmp=(a,b)=>{const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
test('F-6: no undici in the lockfile falls in GHSA-3wwx-pv8p-q78v (7.28.0-7.29.0)',()=>{
  const found=Object.entries(lock.packages).filter(([path])=>/(^|\/)node_modules\/undici$/.test(path)).map(([path,p])=>[path,p.version]);
  assert.ok(found.length>0,'undici is in the tree (via miniflare)');
  for(const [path,version] of found)assert.ok(cmp(version,'7.28.0')<0||cmp(version,'7.29.0')>0,`${path} ${version}`);
  assert.equal(pkg.overrides.undici,lock.packages['node_modules/undici'].version,'the override is what the lockfile holds');
});
// The override is a stopgap: it stays only while something in the tree still asks for an undici inside the advisory
// range (miniflare pins 7.29.0 exactly). Once wrangler ships a miniflare that asks for 7.29.1 or later, this fails:
// drop the override (package.json) and this test's last assertion, so the exact pin never holds undici back.
test('F-6: the undici override is still needed (a dependency pins a vulnerable undici)',()=>{
  const asks=Object.entries(lock.packages).filter(([,p])=>p.dependencies?.undici).map(([path,p])=>[path,p.dependencies.undici]);
  const pinnedBad=asks.filter(([,spec])=>/^\d+\.\d+\.\d+$/.test(spec)&&cmp(spec,'7.28.0')>=0&&cmp(spec,'7.29.0')<=0);
  assert.ok(pinnedBad.length>0,`no dependency pins a vulnerable undici any more (${JSON.stringify(asks)}): remove the undici override`);
});
