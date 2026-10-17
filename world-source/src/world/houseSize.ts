// House size by the number of a wallet's agents (owner decision 2026-09-28: 1 s, 2–3 ms, 4–6 m, 7–9 l, 10+ xl). Its own
// module with no imports, so the Worker (server/ownership.ts) never evaluates layout.ts and the canal geometry at cold
// start (INT-4); households.ts re-exports it for the client.
export type HouseSize='s'|'ms'|'m'|'l'|'xl';
export const HOUSE_SIZES:readonly HouseSize[]=['s','ms','m','l','xl'];
export function houseSize(agents:number):HouseSize{return agents<=1?'s':agents<=3?'ms':agents<=6?'m':agents<=9?'l':'xl';}
