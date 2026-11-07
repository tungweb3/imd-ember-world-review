import React, {lazy, Suspense} from "react";
import { createRoot } from "react-dom/client";
import { bootRead } from "./world/bridge.ts";
import { initialMode } from "./world/dataMode.ts";

// The first snapshot read starts now, before React mounts and the 3D scene is built (bridge.ts bootRead, startEarlyRead); it never throws, so React always mounts.
const marketEntry=location.pathname==='/aimarket/'||location.pathname==='/aimarket'||new URLSearchParams(location.search).get('portal')==='aimarket';
const celestialEntry=location.pathname==='/fortune-connect/'||location.pathname==='/fortune-connect';
const celestialCheckout=location.pathname==='/fortune-checkout/'||location.pathname==='/fortune-checkout';
const squeekEntry=location.pathname==='/squeek-connect/'||location.pathname==='/squeek-connect';
const squeekCheckout=location.pathname==='/squeek-checkout/'||location.pathname==='/squeek-checkout';
const goldGuide=location.pathname==='/gold/'||location.pathname==='/gold';
const lightEntry=celestialEntry||celestialCheckout||squeekEntry||squeekCheckout||goldGuide;
const collectionEntry=import.meta.env.DEV&&__COLLECTION_LOCAL__&&new URLSearchParams(location.search).get('collection')==='1';
const homeDemoEntry=import.meta.env.DEV&&new URLSearchParams(location.search).get('homeDemo')==='1';
if(!marketEntry&&!lightEntry&&!collectionEntry&&!homeDemoEntry)bootRead(initialMode());
// The World bootstrap starts its terrain work; the research entry does not load the 3D scene.
const Market=lazy(()=>import('./world/AIMarketGateway.tsx'));
const Celestial=lazy(()=>import('./world/CelestaoGateway.tsx'));
const CelestialCheckout=lazy(()=>import('./world/CelestaoCheckout.tsx'));
const SqueekEntry=lazy(()=>import('./world/SqueekConnect.tsx'));
const SqueekCheckout=lazy(()=>import('./world/SqueekCheckout.tsx'));
const GoldGuide=lazy(()=>import('./world/GoldGuide.tsx'));
const World=lazy(()=>import('./world/WorldBootstrap.tsx'));
const Collection=import.meta.env.DEV&&__COLLECTION_LOCAL__?lazy(()=>import('./world/collection/CollectionLocalApp.tsx')):null;
const HomeDemo=import.meta.env.DEV?lazy(()=>import('./world/homeDemo/HomeDemoApp.tsx')):null;
declare const __COLLECTION_LOCAL__:boolean;
createRoot(document.getElementById("root")!).render(<React.StrictMode><Suspense fallback={<p role="status">{homeDemoEntry?'正在準備示範住宅…':collectionEntry?'正在開啟收藏預覽…':squeekEntry||squeekCheckout?'正在開啟鼠道修仙錢包服務…':goldGuide?'正在開啟 GOLD 說明…':celestialEntry||celestialCheckout?'正在開啟玄曜錢包服務…':marketEntry?'正在開啟觀研館…':'世界正在展開…'}</p>}>{homeDemoEntry&&HomeDemo?<HomeDemo/>:collectionEntry&&Collection?<Collection/>:goldGuide?<GoldGuide/>:squeekCheckout?<SqueekCheckout/>:squeekEntry?<SqueekEntry/>:celestialCheckout?<CelestialCheckout/>:celestialEntry?<Celestial/>:marketEntry?<Market/>:<World/>}</Suspense></React.StrictMode>);
