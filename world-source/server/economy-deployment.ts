import type {EconomyConfig} from './economy-config.ts';

/** Release gate: this candidate has no reviewed/deployed financial contracts.
 * Only a later source change backed by an accepted, source-matching official
 * Swarm report and mainnet runtime readback may replace this null. Environment
 * variables, query strings, local demos and the previous wallet audits cannot
 * activate the economy or import prototype GOLD balances. */
export async function reviewedEconomyConfig():Promise<EconomyConfig|null>{return null;}
