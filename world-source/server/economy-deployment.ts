import {defineEconomyConfig} from './economy-config.ts';
/** Fixed owner-signed Ethereum deployments. Prices remain unset. Production
 * release additionally requires independent finalized receipts and DB checks.
 * Environment values and query flags cannot replace these pinned addresses. */
export async function reviewedEconomyConfig(){return defineEconomyConfig({"chainId":1,"token":"0x2b82cdeb8477415d541799abb0cc48044c8ea5f3","tokenDecimals":18,"stakingContract":"0xf110043728e6338e19d41f1d02f02a575070eda9","paymentContract":"0x0b9653941b0dbf967f2ef27b7563a0fed303bac6","treasury":"0x1c651928150daddda9c2c040a9d4901d862f8ec4","deploymentBlock":"26222887","catalogue":[]});}
