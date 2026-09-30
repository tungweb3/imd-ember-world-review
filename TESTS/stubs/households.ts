// Test-only stand-in for the withheld src/world/households.ts, NOT part of the reviewed source.
// tests/ownership.test.mjs imports `houseSize` from '../src/world/households.ts', and src/world/homeEntry.ts imports
// HOUSE_SIZES and HOUSE_FOOTPRINT from it. At commit 132228c (as at 4321bb4) the real file re-exports HOUSE_SIZES / houseSize
// from the published src/world/houseSize.ts (households.ts:11, :14), which the first line reproduces. HOUSE_FOOTPRINT (house geometry)
// is withheld and NOT reproduced: any read of it throws, so only tests that never touch house geometry can pass here.
// Usage (see TESTS/README.md): cp ../TESTS/stubs/households.ts src/world/households.ts   (run inside source/, then delete it)
export {HOUSE_SIZES,houseSize,type HouseSize} from './houseSize.ts';
export const HOUSE_FOOTPRINT:any=new Proxy({},{get(){throw new Error('withheld: HOUSE_FOOTPRINT (households.ts) is not in this snapshot');}});
