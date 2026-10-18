import {createRequire} from 'node:module';
import {readFileSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {solc, ethers, runtimeEvidence} from '../tools/runtime.mjs';
export {solc, ethers, runtimeEvidence};
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const TX = {gasLimit: 6_000_000n};
export const SHARE = 100_000n * 10n ** 18n;
const requireEvm = createRequire(resolve(root, 'package.json'));
export async function createIsolatedProvider() {
  const {createHardhatRuntimeEnvironment} = await import(pathToFileURL(requireEvm.resolve('hardhat/hre')).href);
  const cache = resolve(root, '.rd/cache'); mkdirSync(cache, {recursive: true});
  const hre = await createHardhatRuntimeEnvironment({paths:{cache}, solidity:'0.8.37', networks:{isolated:{
    type:'edr-simulated', chainType:'l1', chainId:31337, hardfork:'cancun',
    accounts:{mnemonic:'test test test test test test test test test test test junk', count:5},
    throwOnTransactionFailures:false, throwOnCallFailures:true
  }}}, {}, root);
  const connection = await hre.network.create('isolated');
  return {request:args=>connection.provider.request(args), disconnect:()=>connection.close()};
}
export const artifacts = Object.fromEntries(['EmbeoStakingVault','EmbeoPayments'].map(name => [name, JSON.parse(readFileSync(resolve(root,'artifacts',name+'.json'),'utf8'))]));
const originalToken = JSON.parse(readFileSync(resolve(root,'fixtures/embeo-token-artifact.json'),'utf8'));
export const EMBEO_RUNTIME = '0x01fb92b21a7414fcac4480618142f8968a5d2bae8071370fb5e9369b97fc55bc';
export const tokenArtifact = {abi:originalToken.abi, bytecode:'0x'+originalToken.evm.bytecode.object};
if (ethers.keccak256('0x'+originalToken.evm.deployedBytecode.object) !== EMBEO_RUNTIME) throw Error('PRESERVED_EMBEO_RUNTIME_CHANGED');
const mockInput = {language:'Solidity',sources:{'AdversarialToken.sol':{content:readFileSync(resolve(root,'test/AdversarialToken.sol'),'utf8')}},settings:{optimizer:{enabled:true,runs:200},viaIR:false,evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}};
const mockOutput = JSON.parse(solc.compile(JSON.stringify(mockInput)));
if ((mockOutput.errors??[]).some(error=>error.severity==='error')) throw Error(JSON.stringify(mockOutput.errors));
const mock = mockOutput.contracts['AdversarialToken.sol'].AdversarialToken;
export const mockArtifact = {abi:mock.abi,bytecode:'0x'+mock.evm.bytecode.object};
const badMetadata = mockOutput.contracts['AdversarialToken.sol'].BadMetadataToken;
export const badMetadataArtifact = {abi:badMetadata.abi,bytecode:'0x'+badMetadata.evm.bytecode.object};
export async function deploy(artifact, signer, ...args) {
  const instance = await new ethers.ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args,TX);
  await instance.waitForDeployment(); return instance;
}
