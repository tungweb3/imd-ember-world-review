import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {ethers} from '../../../contracts/tools/runtime.mjs';
export * from '../../../contracts/tools/runtime.mjs';
const root=fileURLToPath(new URL('../../../contracts/',import.meta.url));
const requireEvm=createRequire(resolve(root,'package.json'));
const TEST_MNEMONIC='test test test test test test test test test test test junk';
export function testAuthority(index=0){return ethers.HDNodeWallet.fromPhrase(TEST_MNEMONIC,undefined,"m/44'/60'/0'/0/"+index);}
export async function createTestProvider(chainId=31337){
 const {createHardhatRuntimeEnvironment}=await import(pathToFileURL(requireEvm.resolve('hardhat/hre')).href);
 const hre=await createHardhatRuntimeEnvironment({solidity:'0.8.37',networks:{local:{type:'edr-simulated',chainType:'l1',chainId,hardfork:'cancun',accounts:{mnemonic:TEST_MNEMONIC,count:5},throwOnTransactionFailures:false,throwOnCallFailures:true}}},{},root);
 const connection=await hre.network.create('local');
 return {request:args=>connection.provider.request(args),disconnect:()=>connection.close()};
}
