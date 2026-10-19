import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { solc, openzeppelinRoot, runtimeEvidence, ethers } from './runtime.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = value => createHash('sha256').update(value).digest('hex');
const sources = {};
for (const name of readdirSync(resolve(root, 'src')).filter(name => name.endsWith('.sol')).sort()) {
  sources['src/' + name] = { content: readFileSync(resolve(root, 'src', name), 'utf8') };
}
const dependencySources = {};
function imports(path) {
  if (!path.startsWith('@openzeppelin/contracts/') || path.includes('..')) return {error: 'IMPORT_NOT_ALLOWLISTED'};
  const content = readFileSync(resolve(openzeppelinRoot, path.slice('@openzeppelin/contracts/'.length)), 'utf8');
  dependencySources[path] = { content };
  return { contents: content };
}
const input = { language: 'Solidity', sources, settings: {
  optimizer: { enabled: true, runs: 200 }, viaIR: false, evmVersion: 'cancun',
  metadata: { bytecodeHash: 'none' },
  outputSelection: {'*': {'*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'storageLayout', 'metadata'], '': ['ast']}}
}};
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: imports }));
if ((output.errors ?? []).some(error => error.severity === 'error')) throw Error(JSON.stringify(output.errors));
mkdirSync(resolve(root, 'artifacts'), {recursive: true});
const inventory = [];
const immutableNames = {};
function findImmutables(node) {
  if (!node || typeof node !== 'object') return;
  if (node.nodeType === 'VariableDeclaration' && node.mutability === 'immutable') immutableNames[node.id] = node.name;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(findImmutables);
    else if (value && typeof value === 'object') findImmutables(value);
  }
}
Object.values(output.sources).forEach(source => findImmutables(source.ast));
for (const name of ['EmbeoStakingVault', 'EmbeoPayments']) {
  const artifact = output.contracts[`src/${name}.sol`][name];
  const result = {contractName: name, sourceName: `src/${name}.sol`, compiler: solc.version(),
    abi: artifact.abi, bytecode: '0x' + artifact.evm.bytecode.object,
    deployedBytecode: '0x' + artifact.evm.deployedBytecode.object,
    immutableReferences: artifact.evm.deployedBytecode.immutableReferences,
    immutableBindings: Object.fromEntries(Object.keys(artifact.evm.deployedBytecode.immutableReferences).map(id => {
      if (!['token', 'tokenCodeHash', 'tokenSupply', 'treasury'].includes(immutableNames[id])) throw Error('UNKNOWN_IMMUTABLE_BINDING');
      return [id, immutableNames[id]];
    })),
    storageLayout: artifact.storageLayout, metadata: JSON.parse(artifact.metadata),
    productionReady: false, deployedToPublicChain: false};
  const bytes = JSON.stringify(result, null, 2) + '\n';
  writeFileSync(resolve(root, 'artifacts', name + '.json'), bytes);
  inventory.push({contractName: name, artifactSha256: sha(bytes), creationBytes: (result.bytecode.length - 2) / 2,
    runtimeTemplateBytes: (result.deployedBytecode.length - 2) / 2,
    runtimeTemplateKeccak256: ethers.keccak256(result.deployedBytecode)});
}
const completeInput = {...input, sources: {...sources, ...dependencySources}};
const reproduced = JSON.parse(solc.compile(JSON.stringify(completeInput)));
if ((reproduced.errors ?? []).some(error => error.severity === 'error')) throw Error('STANDARD_INPUT_REPRODUCTION_FAILED');
for (const name of ['EmbeoStakingVault', 'EmbeoPayments']) {
  if (reproduced.contracts[`src/${name}.sol`][name].evm.bytecode.object !== output.contracts[`src/${name}.sol`][name].evm.bytecode.object) throw Error('NONREPRODUCIBLE_BUILD');
}
const compilerInputBytes = JSON.stringify(completeInput, null, 2) + '\n';
writeFileSync(resolve(root, 'artifacts/compiler-input.json'), compilerInputBytes);
writeFileSync(resolve(root, 'artifacts/build.json'), JSON.stringify({schema: 'imd.world.economy-contract-build/v1',
  status: 'LOCAL_REVIEW_CANDIDATE', compiler: solc.version(), compilerInputSha256: sha(compilerInputBytes),
  sourceInputs: Object.fromEntries(Object.entries(completeInput.sources).map(([path, {content}]) => [path, sha(content)])),
  runtimeEvidence, warnings: output.errors ?? [], inventory}, null, 2) + '\n');
console.log(JSON.stringify({status: 'BUILT_LOCAL_REVIEW_CANDIDATE', compiler: solc.version(), inventory}));
