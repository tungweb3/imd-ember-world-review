import {readFileSync,readdirSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,relative,join,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {solc,openzeppelinRoot,runtimeEvidence} from './runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
function collect(dir,sources) {
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const path = join(dir,entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink not accepted as contract source');
    if (entry.isDirectory()) collect(path,sources);
    else if (entry.name.endsWith('.sol')) {
      sources[relative(root,path).split(sep).join('/')]={content:readFileSync(path,'utf8')};
    }
  }
}
export function compile() {
  const sources = {};
  collect(join(root,'contracts'),sources);
  const input = {language:'Solidity',sources,settings:{
    optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'cancun',
    outputSelection:{'*':{'*':['abi','metadata','evm.bytecode.object','evm.deployedBytecode.object']}}
  }};
  const output = JSON.parse(solc.compile(JSON.stringify(input),{import: path => {
    if (!path.startsWith('@openzeppelin/contracts/') || path.includes('..') || path.includes('\\')) {
      return {error:'Unsupported import'};
    }
    const file = realpathSync(join(openzeppelinRoot,path.slice('@openzeppelin/contracts/'.length)));
    if (!file.startsWith(realpathSync(openzeppelinRoot)+sep)) return {error:'Import escapes package'};
    const contents = readFileSync(file,'utf8');
    sources[path] = {content:contents};
    return {contents};
  }}));
  const fail = result => {
    const errors=(result.errors ?? []).filter(e=>e.severity==='error');
    if (errors.length) throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
  };
  fail(output);
  const reproduced = JSON.parse(solc.compile(JSON.stringify(input)));
  fail(reproduced);
  const artifacts={};
  for (const [file,contracts] of Object.entries(output.contracts)) {
    for (const [name,contract] of Object.entries(contracts)) {
      const rebuilt = reproduced.contracts[file][name];
      assert.deepEqual(contract.abi,rebuilt.abi);
      assert.equal(contract.evm.bytecode.object,rebuilt.evm.bytecode.object);
      assert.equal(contract.evm.deployedBytecode.object,rebuilt.evm.deployedBytecode.object);
      artifacts[`${file}:${name}`] = {abi:contract.abi,bytecode:'0x'+contract.evm.bytecode.object,
        runtimeBytecode:'0x'+contract.evm.deployedBytecode.object};
    }
  }
  return {input,output:reproduced,artifacts,standardInputReproduced:true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = compile();
  const artifactDir = join(root,'artifacts');
  mkdirSync(artifactDir,{recursive:true});
  const standardInput = JSON.stringify(result.input,null,2)+'\n';
  writeFileSync(join(artifactDir,'standard-input.json'),standardInput);
  const own = Object.fromEntries(Object.entries(result.artifacts).filter(([name])=>name.startsWith('contracts/')));
  writeFileSync(join(artifactDir,'test-artifacts.json'),JSON.stringify(own,null,2)+'\n');
  const receipt={scope:'LOCAL TEST PROBE ONLY; no issuance or production Genesis',
    runtime:runtimeEvidence,settings:result.input.settings,standardInputSha256:sha256(standardInput),
    sourceSha256:Object.fromEntries(Object.entries(result.input.sources).map(([p,s])=>[p,sha256(s.content)])),
    standardInputReproduced:true,chainBroadcast:false,
    artifacts:Object.fromEntries(Object.entries(own).map(([name,a])=>[name,{abiSha256:sha256(JSON.stringify(a.abi)),
      creationBytecodeSha256:sha256(Buffer.from(a.bytecode.slice(2),'hex')),
      runtimeTemplateSha256:sha256(Buffer.from(a.runtimeBytecode.slice(2),'hex'))}]))};
  writeFileSync(join(artifactDir,'build-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({scope:receipt.scope,compiler:runtimeEvidence.compiler,
    ownArtifacts:Object.keys(own).length,sourceFiles:Object.keys(result.input.sources).length,
    standardInputReproduced:true,chainBroadcast:false}));
}

