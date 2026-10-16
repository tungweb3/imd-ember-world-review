import {createRequire} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(resolve(root,'package.json'));
const sha=value=>createHash('sha256').update(value).digest('hex');
if(Number(process.versions.node.split('.')[0])!==24)throw Error('NODE_24_REQUIRED');
const pins={'solc':'0.8.37','@openzeppelin/contracts':'5.4.0','ethers':'6.15.0','hardhat':'3.19.0','@nomicfoundation/edr':'0.22.2'};
const packages={};
for(const [name,expected] of Object.entries(pins)){
  const bytes=readFileSync(resolve(root,'node_modules',name,'package.json')),pkg=JSON.parse(bytes);
  if(pkg.version!==expected)throw Error('PIN_MISMATCH_'+name);
  packages[name]={version:expected,packageSha256:sha(bytes)};
}
const payload=resolve(root,'vendor/soljson-v0.8.37+commit.f401782d.cjs');
const expected='d73fead3cbc860438f56f4d1723677499cdef212d0f8890241748d2d5afc1c5f';
if(sha(readFileSync(payload))!==expected)throw Error('OFFICIAL_COMPILER_PAYLOAD_MISMATCH');
// npm's same-version soljson is deliberately not used: its payload differs.
export const solc=require('solc').setupMethods(require(payload));
if(solc.version()!=='0.8.37+commit.f401782d.Emscripten.clang')throw Error('COMPILER_IDENTITY_MISMATCH');
export const ethers=require('ethers');
export const openzeppelinRoot=resolve(root,'node_modules/@openzeppelin/contracts');
const nativePackages=[];
const foundation=resolve(root,'node_modules/@nomicfoundation');
for(const name of readdirSync(foundation).filter(name=>name.startsWith('edr-'))){
  const folder=resolve(foundation,name),bytes=readFileSync(resolve(folder,'package.json')),pkg=JSON.parse(bytes);
  const binaries=readdirSync(folder).filter(name=>name.endsWith('.node'));
  if(pkg.version!=='0.22.2'||binaries.length!==1)throw Error('PINNED_EDR_NATIVE_BINARY_REQUIRED');
  nativePackages.push({name:'@nomicfoundation/'+name,version:pkg.version,packageSha256:sha(bytes),
    binary:binaries[0],binarySha256:sha(readFileSync(resolve(folder,binaries[0])))});
}
if(nativePackages.length===0)throw Error('EDR_NATIVE_PACKAGE_MISSING');
export const runtimeEvidence=Object.freeze({node:process.version,platform:process.platform,arch:process.arch,
  compiler:solc.version(),compilerPayloadSha256:expected,compilerPayload:'vendor/soljson-v0.8.37+commit.f401782d.cjs',
  compilerOfficialSource:'https://binaries.soliditylang.org/bin/soljson-v0.8.37+commit.f401782d.js',
  dependencyLockSha256:sha(readFileSync(resolve(root,'package-lock.json'))),packages,nativePackages,backend:'Hardhat EDR in-process',
  evmVersion:'cancun',localOnly:true,publicChainWrites:false,
  limitations:['EDR chain 31337; no public RPC or funded wallet in tests','Platform execution is measured only where the suite is run']});
