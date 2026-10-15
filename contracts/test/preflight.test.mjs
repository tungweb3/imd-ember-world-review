import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {EXPECTED,validateTokenSnapshot,bindRuntime} from '../tools/preflight.mjs';
import {root,artifacts} from './runtime.mjs';
const original=JSON.parse(readFileSync(resolve(root,'fixtures/embeo-token-artifact.json'),'utf8'));
const fixture={chainId:1,address:EXPECTED.token,code:'0x'+original.evm.deployedBytecode.object,decimals:18,totalSupply:EXPECTED.tokenSupply,name:'EmberEVO',symbol:'EMBEO'};
test('Production token identity gate accepts only the exact canonical stored runtime and metadata',()=>{
  validateTokenSnapshot(fixture);
  for(const mutation of [
    {chainId:31337},{address:'0x0000000000000000000000000000000000000001'},
    {code:fixture.code.slice(0,-2)+'00'},{decimals:6},{totalSupply:'1'},{name:'Other token'},{symbol:'EMVO'}
  ])assert.throws(()=>validateTokenSnapshot({...fixture,...mutation}));
});
test('Immutable binding rejects missing, unknown, overlapping or out-of-bounds references',()=>{
  const artifact=structuredClone(artifacts.EmbeoPayments);
  const id=Object.keys(artifact.immutableBindings)[0];
  assert.throws(()=>bindRuntime(artifact,{}));
  const unknown=structuredClone(artifact);unknown.immutableBindings[id]='owner';assert.throws(()=>bindRuntime(unknown,EXPECTED));
  const overlap=structuredClone(artifact);overlap.immutableReferences[id].push({...overlap.immutableReferences[id][0]});assert.throws(()=>bindRuntime(overlap,EXPECTED));
  const outside=structuredClone(artifact);outside.immutableReferences[id][0].start=1000000;assert.throws(()=>bindRuntime(outside,EXPECTED));
  assert.match(bindRuntime(artifact,EXPECTED),/^0x[0-9a-f]+$/);
});
