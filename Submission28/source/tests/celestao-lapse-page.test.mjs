import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// A source check: the page needs a wallet session and is not rendered here.
const page=readFileSync(new URL('../src/world/CelestaoCheckout.tsx',import.meta.url),'utf8');

test('a buyer whose unpaid quote ran out is told to wait, and is not left with a dead button',()=>{
  assert.match(page,/data\.order\.status==='paid'\?[\s\S]*?:data\.order\.expiresMs<=Date\.now\(\)\?<p role="alert">\{ERRORS\.ORDER_EXPIRED\[zh\?0:1\]\}<\/p>:<button/);
  assert.match(page,/ORDER_EXPIRED:\['[^']*等 5 分鐘[^']*','[^']*Wait 5 minutes[^']*'\]/);
  assert.doesNotMatch(page,/data\.order\.expiresMs<=Date\.now\(\)\} onClick/);
});
