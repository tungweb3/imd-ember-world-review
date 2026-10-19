import type {InventoryDefinition} from '../src/world/inventory.ts';

// No game grants or NFT collections have been issued/approved yet. Models,
// preview fixtures, arbitrary metadata and wallet air-drops confer no ownership.
// Future game integration must add explicit server-verified issuance and a
// reviewed definition here; there is deliberately no browser grant endpoint.
export const INVENTORY_CATALOGUE:readonly InventoryDefinition[]=Object.freeze([]);
export const GAME_NFT_COLLECTIONS:readonly {chainId:number;contract:string}[]=Object.freeze([]);
