import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../integrations/celestao/'+path,import.meta.url),'utf8');

test('the buyer is told why a polar birthplace is refused and that no payment was made',()=>{
  assert.match(read('celestao_world/native.py'),/raise NativeInputError\('LOCATION_UNSUPPORTED'\)/);
  const text=read('web/world-wallet.js').match(/LOCATION_UNSUPPORTED:say\('([^']+)','([^']+)'\)/);
  assert.ok(text,'world-wallet.js has no message for LOCATION_UNSUPPORTED');
  assert.match(text[1],/沒有建立付款/);
  assert.match(text[2],/No payment was created/);
});
