// Character NFT collections shown under "My wallet" (shared by the client panel and the Worker's assets route).
// Empty until the owner deploys the Pepe character collection: the panel then shows 「即將推出 / Coming soon」. Adding
// it is one entry here (Ethereum mainnet only; `contract` lowercase). Seats are not listed here: they are
// SEAT_COLLECTION in market.ts.
export type CharacterCollection={id:string;name:{zh:string;en:string};chainId:1;contract:string};
export const CHARACTER_COLLECTIONS:readonly CharacterCollection[]=[];
