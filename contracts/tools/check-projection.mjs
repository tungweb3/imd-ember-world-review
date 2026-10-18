import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const read=path=>readFileSync(resolve(root,path));
const manifest=JSON.parse(read('baseline/projection-manifest.json'));
for(const [path,expected] of Object.entries(manifest.originalSourceSha256))assert.equal(sha(read(path)),expected,'SOLIDITY_SOURCE_CHANGED_'+path);
for(const [name,expected] of Object.entries(manifest.contracts)){
  const baselineBytes=read('baseline/'+name+'.json');assert.equal(sha(baselineBytes),expected.artifactSha256);
  const baseline=JSON.parse(baselineBytes),actualBytes=read('artifacts/'+name+'.json'),actual=JSON.parse(actualBytes);
  for(const field of ['abi','bytecode','deployedBytecode','immutableReferences','immutableBindings','storageLayout','metadata'])assert.deepEqual(actual[field],baseline[field],name+'_'+field+'_DIFFERS');
  assert.equal(sha(Buffer.from(actual.bytecode.slice(2),'hex')),expected.creationBytecodeSha256);
  assert.equal(sha(Buffer.from(actual.deployedBytecode.slice(2),'hex')),expected.runtimeTemplateSha256);
  assert.equal(sha(actualBytes),expected.artifactSha256,'PUBLIC_ARTIFACT_BYTES_DIFFER');
}
assert.equal(sha(read('artifacts/compiler-input.json')),manifest.compilerInputSha256,'COMPILER_INPUT_CHANGED');
assert.equal(sha(read('interface.json')),manifest.interfaceSha256);
const token=JSON.parse(read('fixtures/embeo-token-artifact.json'));
assert.equal(sha(read('fixtures/embeo-token-artifact.json')),manifest.tokenArtifactSha256);
assert.equal(sha(Buffer.from(token.evm.bytecode.object,'hex')),manifest.tokenCreationBytecodeSha256);
assert.equal(sha(Buffer.from(token.evm.deployedBytecode.object,'hex')),manifest.tokenRuntimeBytecodeSha256);
console.log(JSON.stringify({status:'EXACT_SOLIDITY_ABI_BYTECODE_METADATA_AND_FIXTURE_MATCH',contracts:Object.keys(manifest.contracts),privatePathsRequired:false}));
