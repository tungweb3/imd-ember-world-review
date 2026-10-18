import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runtimeEvidence} from '../contract/tools/runtime.mjs';
import {LocalError} from './schema.mjs';
const artifactURL=new URL('../contract/artifacts/test-artifacts.json',import.meta.url);
const receiptURL=new URL('../contract/artifacts/build-receipt.json',import.meta.url);
const inputURL=new URL('../contract/artifacts/standard-input.json',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const keys=['contracts/EmberEvoGenesisCandidate.sol:EmberEvoGenesisCandidate','contracts/test/Fixtures.sol:FixtureToken'];
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
export function verifyOwnedSources(input,receipt,readSource=name=>readFileSync(new URL('../contract/'+name,import.meta.url))){
 const own=Object.entries(input.sources).filter(([name])=>name.startsWith('contracts/'));
 if(!own.length)throw new LocalError('OWNED_SOURCE_REQUIRED');
 return own.map(([name])=>{
  if(!/^contracts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.sol$/.test(name))throw new LocalError('OWNED_SOURCE_PATH_INVALID');
  if(sha(readSource(name))!==receipt.sourceSha256[name])throw new LocalError('OWNED_SOURCE_CHANGED');return {name,sha256:receipt.sourceSha256[name]};
 });
}
export function loadVerifiedArtifacts(){
 const bytes=readFileSync(artifactURL),receiptBytes=readFileSync(receiptURL),inputBytes=readFileSync(inputURL);
 const artifacts=JSON.parse(bytes),receipt=JSON.parse(receiptBytes),input=JSON.parse(inputBytes);
 if(receipt.standardInputReproduced!==true||receipt.chainBroadcast!==false||receipt.standardInputSha256!==sha(inputBytes)||receipt.runtime.compiler!==runtimeEvidence.compiler||receipt.runtime.compilerPayloadSha256!==runtimeEvidence.compilerPayloadSha256)throw new LocalError('BUILD_IDENTITY_CHANGED');
 if(receipt.settings.evmVersion!=='cancun'||receipt.settings.viaIR!==true||receipt.settings.optimizer?.enabled!==true||JSON.stringify(receipt.settings)!==JSON.stringify(input.settings))throw new LocalError('BUILD_SETTINGS_INVALID');
 if(sha(readFileSync(runtimeEvidence.entries.solc.path))!==runtimeEvidence.compilerPayloadSha256)throw new LocalError('COMPILER_PAYLOAD_CHANGED');
 for(const key of keys){
  const artifact=artifacts[key],expected=receipt.artifacts[key];
  if(!artifact||!expected||!/^0x(?:[0-9a-f]{2})+$/i.test(artifact.bytecode)||!/^0x(?:[0-9a-f]{2})+$/i.test(artifact.runtimeBytecode))throw new LocalError('ARTIFACT_SCHEMA_INVALID');
  if(sha(JSON.stringify(artifact.abi))!==expected.abiSha256||sha(Buffer.from(artifact.bytecode.slice(2),'hex'))!==expected.creationBytecodeSha256||sha(Buffer.from(artifact.runtimeBytecode.slice(2),'hex'))!==expected.runtimeTemplateSha256)throw new LocalError('ARTIFACT_IDENTITY_CHANGED');
 }
 for(const [name,source] of Object.entries(input.sources))if(sha(source.content)!==receipt.sourceSha256[name])throw new LocalError('BUILD_SOURCE_CHANGED');
 const ownedSources=verifyOwnedSources(input,receipt);
 const identity={artifactSha256:sha(bytes),receiptSha256:sha(receiptBytes),standardInputSha256:sha(inputBytes),compiler:runtimeEvidence.compiler,compilerPayloadSha256:runtimeEvidence.compilerPayloadSha256,ownedSources,artifacts:Object.fromEntries(keys.map(key=>[key,receipt.artifacts[key]])),standardInputReproduced:true};
 freeze(artifacts);freeze(identity);
 return Object.freeze({artifacts,identity,assertUnchanged(){if(sha(readFileSync(artifactURL))!==identity.artifactSha256||sha(readFileSync(receiptURL))!==identity.receiptSha256||sha(readFileSync(inputURL))!==identity.standardInputSha256||sha(readFileSync(runtimeEvidence.entries.solc.path))!==identity.compilerPayloadSha256)throw new LocalError('BUILD_CHANGED_RESTART_REQUIRED');verifyOwnedSources(input,receipt);}});
}
