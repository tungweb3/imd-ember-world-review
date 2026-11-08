import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../integrations/celestao/'+path,import.meta.url),'utf8');

test('the privacy page states the number of days the vault keeps a refunded order',()=>{
  assert.match(read('celestao_world/vault.py'),/^FAILED_RETENTION_MS=30\*86400000\r?$/m);
  const page=read('web/world-wallet.js');
  assert.match(page,/判定失敗後保留至少 30 天/);
  assert.match(page,/at least 30 days after the failure is confirmed/);
});

test('a buyer who comes back to a cleared run is sent to the World order',()=>{
  const page=read('web/world-wallet.js');
  const branch=page.match(/run\.state==='cleared'\?say\('([^']+)','([^']+)'\)/);
  assert.ok(branch,'world-wallet.js has no message for a cleared run');
  assert.match(branch[1],/World 原始訂單/);
  assert.match(branch[2],/original World order/);
  assert.match(page,/fortune-checkout\/\?run=/);
});
