import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {EXPECTED,validateTokenSnapshot,bindRuntime,validateBlockIdentity} from '../tools/preflight.mjs';
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

const H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const header={number:'0x64',hash:H(100),parentHash:H(99),timestamp:'0x65000000',gasLimit:'0x1c9c380'};
test('Deployment readback binds number, finalized hash, parent, timestamp and available gas limit',()=>{
  validateBlockIdentity(header,{...header});
  for(const mutation of [{number:'0x65'},{hash:H(999)},{parentHash:H(999)},{timestamp:'0x65000001'},{gasLimit:'0x1'}])
    assert.throws(()=>validateBlockIdentity(header,{...header,...mutation},'FINALIZED_HEADER_MISMATCH'),/FINALIZED_HEADER_MISMATCH/);
});
test('Equivalent hex casing and omitted optional gas limit retain the same header identity',()=>{
  const lowercase={...header,hash:H(0xabc)};validateBlockIdentity({...lowercase,hash:'0x'+lowercase.hash.slice(2).toUpperCase()},lowercase);
  const {gasLimit,...withoutGas}=header;validateBlockIdentity(header,withoutGas);validateBlockIdentity(withoutGas,header);
});
test('Malformed header identities fail closed before a readback can be accepted',()=>{
  for(const mutation of [{number:'0x064'},{timestamp:'0x00'},{gasLimit:'bad'},{hash:'0x01'},{parentHash:null},{number:100}])
    assert.throws(()=>validateBlockIdentity({...header,...mutation},header));
  for(const value of [null,[],undefined])assert.throws(()=>validateBlockIdentity(value,header));
});
