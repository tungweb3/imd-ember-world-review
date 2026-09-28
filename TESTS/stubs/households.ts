// Test-only stand-in for the withheld src/world/households.ts, NOT part of the reviewed source.
// tests/ownership.test.mjs imports `houseSize` from '../src/world/households.ts'. At commit 0def8cb that file only
// re-exports it from the published src/world/houseSize.ts (households.ts:11-12), which this line reproduces.
// Usage (see TESTS/README.md): cp ../TESTS/stubs/households.ts src/world/households.ts   (run inside source/, then delete it)
export {HOUSE_SIZES,houseSize,type HouseSize} from './houseSize.ts';
