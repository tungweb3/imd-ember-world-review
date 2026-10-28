import type {GenesisDeployment} from './genesis-gold.ts';
// Genesis deployments the GOLD book accepts paid orders for. Each entry pins chain, contract, runtime code hash, deploy
// block, both immutable costs, the EIP-712 domain version and the payment recipient (read back from the deployed
// contract before an entry is added).
// Production is empty: the mainnet contract is not deployed and its payment token (imdUSD v1 or v2) is not decided, so
// every reservation is refused (MINT_DEPLOYMENT_UNKNOWN) even if the mint control were switched on. The entry is added,
// and this file re-reviewed, only after the mainnet deployment.
// Append-only while any order of an entry is held: the cron settles holds only for entries listed here, so removing or
// renaming an entry (or changing its pinned costs) would leave its holds reserved.
export const GENESIS_DEPLOYMENTS:readonly GenesisDeployment[]=Object.freeze([]);
