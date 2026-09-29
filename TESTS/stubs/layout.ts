// Test-only stand-in for the withheld src/world/layout.ts, NOT part of the reviewed source.
// src/world/homeEntry.ts imports lotPoint (house geometry: where a house's door is) from it. That geometry is withheld
// and NOT reproduced: calling lotPoint throws, so the door-geometry tests of tests/home-entry.test.mjs cannot pass here;
// the Enter authorization tests ("group 5") never call it. Types are placeholders.
// Usage (see TESTS/README.md): cp ../TESTS/stubs/layout.ts src/world/layout.ts   (run inside source/, then delete it)
export type Point={x:number;z:number};
export type HomePose={x:number;z:number;rotation:number};
export function lotPoint(_p:HomePose,_lx:number,_lz:number):Point{throw new Error('withheld: lotPoint (layout.ts) is not in this snapshot');}
