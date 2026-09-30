import React from "react";
import { createRoot } from "react-dom/client";
import App from "./world/WorldApp";
import { bootRead } from "./world/bridge.ts";
import { initialMode } from "./world/dataMode.ts";
import { startTerrain } from "./world/skin/terrainTask.ts";
import { TOUCH_LAYOUT } from "./world/screenSpace.ts";
import BAKED_TERRAIN from "virtual:baked-terrain";

// The first snapshot read starts now, before React mounts and the 3D scene is built (bridge.ts bootRead, startEarlyRead); it never throws, so React always mounts.
bootRead(initialMode());
// So does a phone's baked terrain (skin/terrainTask.ts), for the grid the scene will ask for (scene.ts: phones by
// TOUCH_LAYOUT); never throws.
try { startTerrain(matchMedia(TOUCH_LAYOUT).matches, BAKED_TERRAIN); } catch { /* the scene works it out itself */ }
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
