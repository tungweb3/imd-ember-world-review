import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';
import {ImdBridge} from './bridge.ts';
import {initialMode} from './dataMode.ts';
import {object,searchAgents,exactAgent,emptyWorld,isWorking,type DataMode,type WorldState,type SourceSample} from './model.ts';
import {LANDMARKS,DISTRICTS,districtForLandmark,homeStyle,type LandmarkId,type DistrictId} from './layout.ts';
import {households,placeHouseholds,agentSpots,freeLots,applyMoves,vacatedLots,homeOf,type Home,type FoundingHome,type HomeMove,type HouseSize} from './households.ts';
import {HouseholdBlock,LotPanel} from './HomePanels.tsx';
import {WalletPanel,WalletChip,createAuth,useAuth} from './WalletPanel.tsx';
import {createMember} from './member.ts';
import {MemberContext} from './MemberPanel.tsx';
import {ownerAddress} from './auth.ts';
import {enterableHome,enterAtPress,doorOffer,blockEnter,interiorPreview} from './homeEntry.ts';
import {HomeInterior,loadInterior,type DoorNotice} from './HomeDoor.tsx';
import {markedHome,markerLabel} from './walletView.ts';
import {wallets,savedAddress,saveAddress,isAddress} from './wallet.ts';
import {readMoves,commitMove,moveGate} from './moves.ts';
import type {HomePose} from './layout.ts';
import FOUNDING from './founding-homes.json';
import {WorldScene,type Selection,type SceneView} from './scene.ts';
import {deferPanel} from './deferredPanel.tsx';

import type {SelfieOptions} from './selfie.ts';
import {AvatarPortrait} from './AvatarPortrait.tsx';
import {normaliseAppearance,readAppearance,saveAppearance,type PlayerAppearance} from './playerAppearance.ts';
import './world.css';
import {OPENING_CLOSED,worldOpeningActive,worldOpeningReady} from './opening.ts';
import './godView.css';
import './mountainTour/mountain-tour.css';
import {mountainHousingFit,mountainMovedHomeConflict,safeWorldUrl} from './mountainTour/public-housing.ts';
declare const __MOUNTAIN_TOUR_PREVIEW__:boolean;
declare const __COLLECTION_LOCAL__:boolean;
import {LanguageProvider,useWorldText} from './i18n.tsx';

import {startPoll,startWorldPoll,worldReadResult,showLoading} from './cadence.ts';
import {ConnectionPill,SourceRows,Feed} from './SourceNotes.tsx';
import {MiniMap} from './MiniMap.tsx';
import {HudPocket} from './HudPocket.tsx';
import {MAP_STOPS,MAP_CABLE} from './mapShapes.ts';
import {PoseChannel,emberReach,type Rect} from './overview.ts';
import {ProjectionFeed,LANDSCAPE_PHONE,TOUCH_LAYOUT} from './screenSpace.ts';
import {pickBeacons,settled,hintFor,hintTarget,beaconKey,ARROWS,type Beacon,type BeaconTarget,type Hint} from './beacons.ts';
import {Beacons} from './Beacons.tsx';
import {tagRanks,type TagRank} from './labelTier.ts';
import {welcomeFor,isFirstVisit,markSeen,stripKey,readVisited,recordVisit,visitOf,visitCount,inFrosthollow,PLACE_TOTAL,STRIP_IDLE_MS,TUCKED_MS,WHERE_MS,type PlaceId} from './firstRun.ts';
import {drawerHeading,placeEdge,standingAt,landing} from './arrival.ts';
import {Checklist} from './Checklist.tsx';
import {WorldTime} from './WorldTime.tsx';
import {YouTag} from './YouTag.tsx';
import {HoverChip,TapNote} from './HoverChip.tsx';
import {RideHud,hudPhase,useLiftText,useCableText} from './RideHud.tsx';
import {marketView,WEATHER_LABELS,type MarketSample} from './market.ts';
import {readCalmPref,saveCalmPref,CardWeather} from './calmSky.ts';
import {weatherOverride} from './skin/weather.ts';
import {WorldSound,readSoundPref,soundHint,toggleHandlers} from './sound.ts';
import {MusicPlayer} from './musicPlayer.ts';
import {librarySoundHost} from './libraryAudio.ts';
import type {Track} from './music.ts';
import {ObservatoryPanel,GoalBlock,WorkloadBlock} from './ObservatoryPanel.tsx';
import {changeText} from './weatherWhy.ts';
import {agentUrl,explorerTab,walletUrl,walletLabel,jobUrl,districtTabs,parseWorldLink,type WorldTarget} from './links.ts';
import type {ActivityFeed} from './happenings.ts';
import {afterRead,readMemory,celebrationReady,worldCover,worldUncovered,type ReadMemory} from './afterRead.ts';
import {TitleNote,GuideIntro} from './unofficial.ts';
import {readMilestone,saveMilestone,goalBeacon,outputMeter,milestoneText,MILESTONE_STEP,type CelebrationKind} from './metrics.ts';

const SelfiePanel=deferPanel<Parameters<typeof import('./SelfiePanel.tsx').SelfiePanel>[0]>(()=>import('./SelfiePanel.tsx').then(m=>({default:m.SelfiePanel})));
const AvatarPanel=deferPanel<Parameters<typeof import('./AvatarPanel.tsx').AvatarPanel>[0]>(()=>import('./AvatarPanel.tsx').then(m=>({default:m.AvatarPanel})));
const WorldMap=deferPanel<Parameters<typeof import('./WorldMap.tsx').WorldMap>[0]>(()=>import('./WorldMap.tsx').then(m=>({default:m.WorldMap})));
const CityHousePanel=deferPanel<Parameters<typeof import('./activityNative/city-panel.tsx').CityHousePanel>[0]>(()=>import('./activityNative/city-panel.tsx').then(m=>({default:m.CityHousePanel})));
const CityCivicPanel=deferPanel<Parameters<typeof import('./activityNative/city-panel.tsx').CityCivicPanel>[0]>(()=>import('./activityNative/city-panel.tsx').then(m=>({default:m.CityCivicPanel})));
const ResearchPane=deferPanel<Parameters<typeof import('./AIMarketPane.tsx').AIMarketPane>[0]>(()=>import('./AIMarketPane.tsx').then(m=>({default:m.AIMarketPane})));
const LibraryPane=deferPanel<Parameters<typeof import('./StickEmberPane.tsx').StickEmberPane>[0]>(()=>import('./StickEmberPane.tsx').then(m=>({default:m.StickEmberPane})));
const GoldPane=deferPanel<Parameters<typeof import('./WorldGoldPanel.tsx').WorldGoldPanel>[0]>(()=>import('./WorldGoldPanel.tsx').then(m=>({default:m.WorldGoldPanel})));
const InventoryPane=deferPanel<Parameters<typeof import('./InventoryPane.tsx').InventoryPane>[0]>(()=>import('./InventoryPane.tsx').then(m=>({default:m.InventoryPane})));
const EconomyPane=deferPanel<Parameters<typeof import('./EconomyPane.tsx').EconomyPane>[0]>(()=>import('./EconomyPane.tsx').then(m=>({default:m.EconomyPane})));
const ClashPane=deferPanel<Parameters<typeof import('./GamePane.tsx').GamePane>[0]>(()=>import('./GamePane.tsx').then(m=>({default:m.GamePane})));

type Drawer=Selection|{kind:'registry'}|{kind:'help'}|{kind:'home'}|null;
const nice=(n:number|null|undefined)=>n==null?'—':n.toLocaleString();
/** Same homes for every player: placed from public data; the live world keeps the frozen founding layout. */
function homesFor(world:WorldState,moves:readonly HomeMove[]):Home[]{const founding=world.mode==='live'?FOUNDING.homes as FoundingHome[]:[];return placeHouseholds(households(world.agents),applyMoves(founding,moves),vacatedLots(founding,moves),typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__?mountainHousingFit:undefined);}
/** Moves waiting for a shared registry (not live yet): kept in this browser, applied locally, no signatures (moves.ts). */
const moveStore=()=>{try{return localStorage;}catch{return null;}};
const out={target:'_blank',rel:'noreferrer'} as const;
/** Reviewers' ?weather=<tier> (DEV builds or ?debug=1 only, skin/weather.ts): the pocket names the tier the scene shows. */
const FORCED_WEATHER=weatherOverride(location.search,import.meta.env.DEV).weather;
/** Explorer's tabs for a district (All / Running / …; Agents: All / Online / Working / Outdated), as links. */
function DistrictTabs({id}:{id:DistrictId}){
  const {zh,text}=useWorldText();
  return <nav className="district-tabs" aria-label={text('IMD Explorer 分頁','IMD Explorer tabs')}>{districtTabs(id).map(tab=><a key={tab.href} href={tab.href} {...out}>{zh?tab.labelZh:tab.label}</a>)}</nav>;
}

/** The HUD boxes over the canvas (CSS px from its top-left): the opening frame keeps its goals clear of them (overview.ts
 *  frameFor). */
const HUD_BOXES='.world-title h1,.title-pills,.market-pocket,.network-pocket,.hud-pocket,.minimap,.top-controls,.world-tools,.view-mode-state,.zoom-tools,.touch-stick,.first-run';
function hudRects(host:HTMLElement):Rect[]{
  const o=host.getBoundingClientRect();
  return [...(host.closest('main')??document).querySelectorAll<HTMLElement>(HUD_BOXES)].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>e.getBoundingClientRect())
    .filter(r=>r.width&&r.height).map(r=>({x:r.left-o.left,y:r.top-o.top,w:r.width,h:r.height}));
}
const portraitPhone=()=>matchMedia('(max-width: 700px)').matches&&!matchMedia(LANDSCAPE_PHONE).matches;
/** How far (m) the strip's 「從 Pepe 的大螢幕開始」 walks you; from farther it travels. */
const WALK_TO_PEPE=20;
/** A media query's match, kept current (a phone turned, a window resized). */
function useMedia(query:string){const subscribe=useCallback((changed:()=>void)=>{const m=matchMedia(query);m.addEventListener('change',changed);return()=>m.removeEventListener('change',changed);},[query]);return useSyncExternalStore(subscribe,()=>matchMedia(query).matches);}

export default function WorldApp(){return <LanguageProvider><WorldContent/></LanguageProvider>;}
function WorldContent(){
  const [opening,setOpening]=useState(worldOpeningActive);
  useEffect(()=>{const closed=()=>setOpening(false);addEventListener(OPENING_CLOSED,closed);if(!worldOpeningActive())closed();return()=>removeEventListener(OPENING_CLOSED,closed);},[]);
  const [mode,setMode]=useState<DataMode>(initialMode),[world,setWorld]=useState<WorldState|null>(null),[busy,setBusy]=useState(true);
  // The world read's first load (cadence.ts startWorldPoll): until its first good read or its quick retries are spent,
  // what has not come yet shows as loading, not unavailable (SourceNotes.tsx).
  const [firstLoad,setFirstLoad]=useState(true);
  const [buildingNamesShown,setBuildingNamesShown]=useState(true);
  const [drawer,setDrawer]=useState<Drawer>(null),[query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|'online'|'working'>('online'),[page,setPage]=useState(0);
  const [view,setView]=useState<SceneView|null>(null),[sceneError,setSceneError]=useState<boolean>(false),[sceneReady,setSceneReady]=useState(false),[seat,setSeat]=useState<SourceSample|null>(null),[seatError,setSeatError]=useState(false);
  const godView=view?.viewMode==='god';
  const [mini,setMini]=useState(false),miniNow=useRef(mini);miniNow.current=mini;
  const [selfie,setSelfie]=useState(false),selfieLauncher=useRef<HTMLButtonElement>(null);
  const [research,setResearch]=useState(false);
  const [library,setLibrary]=useState(()=>new URLSearchParams(location.search).get('portal')==='stickember');
  const [game,setGame]=useState(()=>new URLSearchParams(location.search).get('portal')==='ember-clash');
  const [gold,setGold]=useState(()=>new URLSearchParams(location.search).get('portal')==='gold');
  const [inventory,setInventory]=useState(false);
  const closeInventory=useCallback(()=>setInventory(false),[]);
  useEffect(()=>{const open=()=>{setDrawer(null);setMini(false);setSelfie(false);setAvatar(false);setResearch(false);setLibrary(false);setGame(false);setEconomy(false);setGold(false);setInventory(true);};window.addEventListener('world:inventory-open',open);return()=>window.removeEventListener('world:inventory-open',open);},[]);
  const [economy,setEconomy]=useState(()=>new URLSearchParams(location.search).get('portal')==='economy');
  useEffect(()=>{const open=()=>{setInventory(false);setDrawer(null);setMini(false);setSelfie(false);setAvatar(false);setResearch(false);setLibrary(false);setGame(false);setEconomy(false);setGold(true);};window.addEventListener('world:gold-open',open);return()=>window.removeEventListener('world:gold-open',open);},[]);
  const closeGold=useCallback(()=>setGold(false),[]),closeEconomy=useCallback(()=>setEconomy(false),[]);
  const portalOpen=research||library||game||gold||economy||inventory,audioCovered=library||game||gold||economy||inventory||opening,audioCoveredNow=useRef(audioCovered);audioCoveredNow.current=audioCovered;
  const sceneCovered=portalOpen||(opening&&sceneReady);
  const libraryAudio=useRef<ReturnType<typeof librarySoundHost>|null>(null);
  const closeResearch=useCallback(()=>{setResearch(false);requestAnimationFrame(()=>host.current?.querySelector('canvas')?.focus());},[]);
  const closeLibrary=useCallback(()=>{setLibrary(false);const url=new URL(location.href);if(url.searchParams.get('portal')==='stickember'){url.searchParams.delete('portal');history.replaceState(null,'',url);}requestAnimationFrame(()=>host.current?.querySelector('canvas')?.focus());},[]);
  const closeGame=useCallback(()=>{setGame(false);const url=new URL(location.href);if(url.searchParams.get('portal')==='ember-clash'){url.searchParams.delete('portal');history.replaceState(null,'',url);}requestAnimationFrame(()=>host.current?.querySelector('canvas')?.focus());},[]);
  const closeSelfie=useCallback(()=>setSelfie(false),[]);
  const [avatar,setAvatar]=useState(false),avatarLauncher=useRef<HTMLButtonElement>(null);
  const [appearance,setAppearance]=useState(readAppearance),[appearanceSaved,setAppearanceSaved]=useState(true);
  const closeAvatar=useCallback(()=>setAvatar(false),[]);
  const chooseAppearance=useCallback((value:PlayerAppearance)=>{const next=normaliseAppearance(value);setAppearance(next);setAppearanceSaved(saveAppearance(next));},[]);
  // 燼舟 (boarding.ts): the Map over the world cancels a boarding; a ride sails on under it.
  useEffect(()=>{if(mini)scene.current?.rideCover();},[mini]);
  // The Explore checklist's visited places (firstRun.ts, kept across visits) and its 7-of-7 toast: due, then shown.
  const [visited,setVisited]=useState<ReadonlySet<PlaceId>>(readVisited),visitedNow=useRef(visited),[explored,setExplored]=useState<'due'|'shown'|null>(null);
  // Beacons (onboarding 04, beacons.ts): when this visit began and the drawers opened in it (a seen ring, agents met).
  const [since]=useState(()=>performance.now()),opened=useRef(new Map<string,number>());
  // Calm weather (calmSky.ts): the sky and the music leave the market by choice; the card and the Observatory do not.
  const [calm,setCalm]=useState(readCalmPref),chooseCalm=useCallback((on:boolean)=>{saveCalmPref(on);setCalm(on);},[]);
  const sound=useRef<WorldSound|null>(null),[soundOn,setSoundOn]=useState(readSoundPref),music=useRef<MusicPlayer|null>(null),[tune,setTune]=useState<Track|null>(null),[musicHeld,setMusicHeld]=useState(false),[soundLocked,setSoundLocked]=useState(false);
  const [address,setAddress]=useState<string|null>(savedAddress),[walletError,setWalletError]=useState<string|null>(null);
  // Wallet sign-in (auth.ts): the server session and owner verification; `address` above stays the viewed wallet.
  const auth=useMemo(()=>createAuth(wallets()),[]),authState=useAuth(auth,drawer?.kind==='home');
  // The signed-in wallet's member and player name (member.ts): follows the session, never asks the wallet anything.
  const member=useMemo(()=>createMember(auth),[auth]);useEffect(()=>member.start(),[member]);
  // The wallet the sign-in client follows (auth.ts, the EIP-6963 choice) is the only one the page reads: canSign = that
  // account is the viewed wallet.
  const canSign=!!authState.account&&address===authState.account;
  const [homesVersion,setHomesVersion]=useState(0),[lots,setLots]=useState<HomePose[]|null>(null),[lotError,setLotError]=useState<string|null>(null);
  const [marketSample,setMarketSample]=useState<MarketSample|null>(null),[marketClock,setMarketClock]=useState(Date.now());
  // IMD linkage: recent activity kept across reads, door-lamp arrivals, the hundred-agent milestone, inbound links.
  const [feed,setFeed]=useState<ActivityFeed|null>(null),[celebration,setCelebration]=useState<{hundred:number;kind:CelebrationKind}|null>(null);
  // A hundred found by a read waits here until someone can see it (tab visible, strip and drawers closed, not
  // moving house); only then does it play and get saved as celebrated.
  const [pendingHundred,setPendingHundred]=useState<number|null>(null),[pageVisible,setPageVisible]=useState(()=>!document.hidden);
  const memory=useRef<ReadMemory>(readMemory(readMilestone())),[celebrated,setCelebrated]=useState<number|null>(()=>memory.current.milestone?.hundred??null);
  const marketPoke=useRef<()=>void>(()=>{}),pendingLink=useRef<WorldTarget|null>(parseWorldLink(location.search));
  const host=useRef<HTMLDivElement>(null),scene=useRef<WorldScene|null>(null),homes=useRef<Home[]>([]),moves=useRef<HomeMove[]>([]),bridge=useMemo(()=>new ImdBridge(mode),[mode]);
  const captureSelfie=useCallback((options:SelfieOptions)=>scene.current?.captureSelfie(options)??Promise.reject(new Error('SELFIE_UNAVAILABLE')),[]);
  const root=useRef<HTMLElement>(null),refreshRef=useRef<()=>void>(()=>{}),selectedCallback=useRef<(s:Selection,travel?:boolean)=>void>(()=>{});
  // The drawer open now (an explicit travel's arrival opens its own only if none opened meanwhile), and the checklist's go.
  const drawerNow=useRef<Drawer>(null),goPlace=useRef<(id:PlaceId)=>void>(()=>{});
  // Player pose for the minimap and the full map, pushed by the scene each frame it moves (no React re-render).
  const pose=useMemo(()=>new PoseChannel(),[]);
  // Screen points of the player (and later the beacons) for the DOM marks, projected by the scene after each render.
  const screen=useMemo(()=>new ProjectionFeed(),[]);
  // How this visit is welcomed (firstRun.ts welcomeFor): a first run gets the strip and the opening frame, a returning visit
  // the 20 s where-to-start pill, a deep link neither (the Explore pill pulses once; one whose target the first read cannot
  // find gets the strip after all, unframed). The strip is up ('first', or 'replay' from the ? guide) until it folds; the
  // note under the Explore pill is the fold's 4 s bubble or the where-to-start pill. poke: a key or a focus move while the
  // strip is up (someone tabbing towards it), which restarts its 12 s.
  const [welcome,setWelcome]=useState(()=>welcomeFor(location.search)),firstRun=welcome==='strip';
  const [strip,setStrip]=useState<'first'|'replay'|null>(firstRun?'first':null),stripNow=useRef(strip),[held,setHeld]=useState(false),[poke,setPoke]=useState(0);
  const [note,setNote]=useState<'tucked'|'where'|null>(()=>welcome==='where'&&visitCount(visited)<PLACE_TOTAL?'where':null);stripNow.current=strip;
  /** Folds the strip, whichever way (its buttons, Esc, a tap, drag, wheel or key in the world, a tool, a drawer, 12 s
   *  untouched): the one place that gives a portrait phone its joystick back. The first-run fold saves the flag (so a
   *  reload before it shows the strip again) and leaves the bubble under the Explore pill. */
  const collapse=useCallback(()=>{const s=stripNow.current;if(!s)return;stripNow.current=null;setStrip(null);setHeld(false);if(s==='first'){markSeen();setNote('tucked');}},[]);
  const {language,setLanguage,zh,locale,t,text,date,short,presence}=useWorldText();
  const namesAction=buildingNamesShown?text('隱藏建築名稱','Hide building names'):text('顯示建築名稱','Show building names');
  const market=marketView(marketSample,marketClock),shownWeather=FORCED_WEATHER??market.weather;
  useEffect(()=>{scene.current?.setLanguage(language);},[language]);
  useEffect(()=>{scene.current?.setBuildingNamesVisible(buildingNamesShown);},[buildingNamesShown]);
  // The market card sits under the title however it wraps (the independence line takes two lines on a narrow phone):
  // world.css reads --title-bottom. Set before the first frame is fitted around the HUD (hudRects, in an effect).
  useLayoutEffect(()=>{const m=root.current,title=m?.querySelector<HTMLElement>('.world-title');if(!m||!title)return;
    const set=()=>m.style.setProperty('--title-bottom',title.offsetTop+title.offsetHeight+'px'),ro=new ResizeObserver(set);ro.observe(title);set();return()=>ro.disconnect();},[]);
  /** A place visited (firstRun.ts recordVisit): saved at once; the one that makes 7 of 7 queues the toast and the peal. */
  const visit=useCallback((id:PlaceId|null)=>{const r=recordVisit(visitedNow.current,id);if(r.visited===visitedNow.current)return;visitedNow.current=r.visited;setVisited(r.visited);if(r.done)setExplored('due');},[]);
  /** Open a drawer; a landmark's or the Observatory's counts as visited (the sealed gate, agents and lots do not). */
  const choose=useCallback((selection:Selection)=>{scene.current?.cancelArrival();setDrawer(selection);collapse();visit(visitOf(selection));opened.current.set(beaconKey(selection),performance.now());},[visit,collapse]);
  const openResearch=useCallback(()=>{setInventory(false);setDrawer(null);setMini(false);setSelfie(false);setAvatar(false);setLibrary(false);setGame(false);setGold(false);setEconomy(false);collapse();setResearch(true);},[collapse]);
  const openLibrary=useCallback(()=>{setInventory(false);setDrawer(null);setMini(false);setSelfie(false);setAvatar(false);setResearch(false);setGame(false);setGold(false);setEconomy(false);collapse();setLibrary(true);},[collapse]);
  const openGame=useCallback(()=>{setInventory(false);setDrawer(null);setMini(false);setSelfie(false);setAvatar(false);setResearch(false);setLibrary(false);setGold(false);setEconomy(false);collapse();setGame(true);},[collapse]);
  const onGo=useCallback((id:PlaceId)=>goPlace.current(id),[]);
  /** Fireworks and a peal for a hundred agents online, and the text that says so (it stays for 14 s). */
  const celebrate=useCallback((hundred:number,kind:CelebrationKind='live')=>{scene.current?.celebrate(hundred);setCelebration({hundred,kind});},[]);
  useEffect(()=>{if(celebration===null)return;const timer=setTimeout(()=>setCelebration(null),14000);return()=>clearTimeout(timer);},[celebration]);
  useEffect(()=>{const seen=()=>setPageVisible(!document.hidden);document.addEventListener('visibilitychange',seen);return()=>document.removeEventListener('visibilitychange',seen);},[]);
  /** A link from Explorer or a shared URL (?seat= / ?wallet= / ?job= / ?district=, links.ts), followed once the first
   *  read has the roster. */
  const followLink=useCallback((next:WorldState)=>{
    const target=pendingLink.current;if(!target||!next.agents.length)return;pendingLink.current=null;
    const lost=()=>{if(isFirstVisit()){setWelcome('strip');stripNow.current='first';setStrip('first');}};
    if(target.kind==='seat'){if(next.agents.some(a=>a.tokenId===target.id)){scene.current?.focusAgent(target.id,true);choose({kind:'agent',id:target.id});}else lost();}
    else if(target.kind==='wallet'){const h=homes.current.find(h=>h.owner===target.address);if(h){scene.current?.focusHome(h);choose({kind:'agent',id:h.agents[0]});}else lost();}
    else if(target.kind==='job'){const id:LandmarkId|null=next.oracle.some(o=>o.jobId===target.id)?'oracle':next.jobs.some(j=>j.jobId===target.id)?'forge':null;
      if(id){scene.current?.focusBuilding(id,true);choose({kind:'building',id});}else choose({kind:'observatory',id:'observatory'});}
    else{const d=DISTRICTS.find(d=>d.id===target.id);if(d){scene.current?.focusBuilding(d.entry,true);choose({kind:'building',id:d.entry});}}
  },[choose]);
  useEffect(()=>{
    try {scene.current=new WorldScene(host.current!,(s,travel)=>selectedCallback.current(s,travel),setView,pose,screen);scene.current.onError=()=>setSceneError(true);scene.current.onReady=()=>setSceneReady(true);scene.current.setLanguage(language);scene.current.setPlayerAppearance(appearance);
      scene.current.onResearch=openResearch;
      scene.current.onLibrary=openLibrary;
      scene.current.onGame=openGame;
      scene.current.onEconomy=()=>{setDrawer(null);setResearch(false);setLibrary(false);setGame(false);setGold(false);setEconomy(true);};
      // The founding households keep their lots (households.ts), so the first live read draws their house models: those
      // start loading now, while that read is on its way, instead of after it.
      if(mode==='live')scene.current.preloadHouseModels(FOUNDING.homes as FoundingHome[]);
      // A first run opens framed (onboarding 03): portrait phones look ahead toward the screen, wider screens pull back.
      if(firstRun)scene.current.firstVisitPose(portraitPhone(),hudRects(host.current!));}
    catch {setSceneError(true);}
    return ()=>{scene.current?.dispose();scene.current=null;};
  },[]);
  useEffect(()=>{scene.current?.setPlayerAppearance(appearance);},[appearance]);
  // Before the first market read reaches the scene: a visitor who chose calm weather never sees the market's sky first.
  useEffect(()=>{scene.current?.setCalm(calm);},[calm]);
  // The HUD under a frame still held changes as the first read fills the cards, or with a resize: frame it again. Not for
  // the strip folding (it only frees the view; the approved frame stays put), so after the fold only a resize refits.
  useEffect(()=>{if(!firstRun)return;let timer=0;const refit=(resized=false)=>{if(!resized&&!stripNow.current)return;clearTimeout(timer);timer=window.setTimeout(()=>{if(host.current)scene.current?.firstVisitPose(portraitPhone(),hudRects(host.current),true);},200);};
    const watch=new ResizeObserver(()=>refit()),m=host.current?.closest('main'),resize=()=>refit(true);if(m)for(const e of m.querySelectorAll(HUD_BOXES))watch.observe(e);
    refit();addEventListener('resize',resize);return()=>{clearTimeout(timer);watch.disconnect();removeEventListener('resize',resize);};
  },[firstRun,world!==null,marketSample!==null,language]);
  // Shared weather/music master: try audible autoplay once when permitted; real gestures remain the fallback.
  useEffect(()=>{const audioCover=librarySoundHost();audioCover.setPaused(audioCoveredNow.current);libraryAudio.current=audioCover;
    const ears=new WorldSound(audioCover.host),tune=new MusicPlayer();sound.current=ears;music.current=tune;tune.onTrack=setTune;setMusicHeld(tune.held);ears.onLocked=setSoundLocked;setSoundLocked(ears.locked);ears.attach(tune);scene.current?.listen(ears);scene.current?.music(tune);if(!tune.held)ears.tryAutoplay();
    return()=>{scene.current?.listen(null);scene.current?.music(null);ears.attach(null);setSoundLocked(false);tune.dispose();ears.dispose();audioCover.dispose();libraryAudio.current=null;sound.current=null;music.current=null;setTune(null);};},[]);
  useEffect(()=>{libraryAudio.current?.setPaused(audioCovered);},[audioCovered]);
  useEffect(()=>{
    let stopped=false;const controller=new AbortController();setMarketSample(null);scene.current?.setMarket(null);
    // Every poll here follows cadence.ts: one read per REFRESH_MS (15 min), quick retries until a read succeeds, nothing while hidden.
    const poll=startPoll(async()=>{try{const s=await bridge.getMarket(controller.signal);if(stopped)return true;setMarketSample(s);setMarketClock(Date.now());return s.state==='fresh';}catch{return stopped;}});
    marketPoke.current=()=>poll.poke();
    return()=>{stopped=true;controller.abort();poll.stop();};
  },[bridge]);
  useEffect(()=>{const timer=setInterval(()=>setMarketClock(Date.now()),10000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{scene.current?.setMarket(marketSample);},[marketSample,market.weather,market.state]);
  const previewTime=useCallback((hour:number|null)=>scene.current?.setTimePreview(hour),[]),[night,setNight]=useState(false),timeBand=useCallback((b:string)=>setNight(b==='night'),[]);   // the world-time slider (WorldTime.tsx)
  useEffect(()=>{
    homes.current=[];moves.current=readMoves(moveStore(),mode);
    if(typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__&&mountainMovedHomeConflict(moves.current)){location.replace(safeWorldUrl(location.search));return;}
    setWorld(null);setBusy(true);scene.current?.setWorld(emptyWorld(mode),[]);let stopped=false;const controller=new AbortController();
    memory.current=readMemory(memory.current.milestone);setFeed(null);setPendingHundred(null);
    const read=async()=>{setBusy(true);try{const next=await bridge.refresh(controller.signal);if(stopped)return true;
      homes.current=homesFor(next,moves.current);scene.current?.setWorld(next,homes.current);setWorld(next);setHomesVersion(v=>v+1);
      // What this read sets off (afterRead.ts): the recent-activity digest with earlier work kept, door lamps for the
      // agents that joined since the last arrivals shown, and a new hundred agents online. The page's memory stops a
      // repeat at once; the hundred plays (and is saved in localStorage) when someone can see it, below.
      const effects=afterRead(memory.current,next,homes.current,Date.now());memory.current=effects.memory;
      setFeed(effects.feed);scene.current?.setActivity(effects.feed);
      if(effects.lamps)scene.current?.setArrivals(effects.lamps);
      if(effects.celebrate!==null)setPendingHundred(effects.celebrate);
      followLink(next);
      return worldReadResult(next.sources);
    }catch{return stopped;}finally{if(!stopped)setBusy(false);}};
    const poll=startWorldPoll(read,on=>{if(!stopped)setFirstLoad(on);});refreshRef.current=()=>poll.poke();
    return ()=>{stopped=true;controller.abort();poll.stop();};
  },[bridge,mode,celebrate,followLink]);
  useEffect(()=>{scene.current?.setPaused(drawer!==null||selfie||avatar||portalOpen||opening);if(drawer===null)scene.current?.clearSelection();},[drawer,selfie,avatar,portalOpen,opening]);
  // Keep background loading, then stop hidden 3D frames while the movie finishes.
  useEffect(()=>{if(!sceneCovered)return;scene.current?.suspend();return()=>{scene.current?.resume();};},[sceneCovered]);
  useEffect(()=>{if(sceneError)worldOpeningReady(true);else if(sceneReady&&!firstLoad)worldOpeningReady();},[sceneReady,sceneError,firstLoad]);
  // Inside the owner's house (HomeDoor.tsx): the world is covered like a drawer covers it.
  const [inside,setInside]=useState<{home:Home|null;size:HouseSize;style:'lisbon'|'timber';preview:number|null;leave:DoorNotice}|null>(null);
  // What covers the world (afterRead.ts worldCover), read once: the hundred, seven of seven and the brilliant sky's
  // fireworks (skyShow.ts) all wait for the tab to be visible and nothing over the world.
  const cover=worldCover({visible:pageVisible&&!opening,strip,drawer:selfie||avatar||portalOpen?{kind:'help'}:drawer,inside,lots}),uncovered=worldUncovered(cover);
  // A queued hundred plays once the page is visible and nothing covers the world; only then is it saved as celebrated
  // (a background tab or the first-run strip would otherwise use up the one show for that hundred unseen).
  useEffect(()=>{
    if(pendingHundred===null||!celebrationReady({pending:pendingHundred,...cover}))return;
    const record={hundred:pendingHundred,at:Date.now()};memory.current={...memory.current,milestone:record};saveMilestone(record);
    setCelebrated(pendingHundred);celebrate(pendingHundred);setPendingHundred(null);
  },[pendingHundred,uncovered,celebrate]);   // cover changes what it says only through uncovered
  useEffect(()=>{scene.current?.setUncovered(uncovered);},[uncovered]);
  // Seven of seven (onboarding 10) waits the same way: once the drawer that did it has closed, a toast and a peal (no fireworks).
  useEffect(()=>{
    if(explored!=='due'||!celebrationReady({pending:PLACE_TOTAL,...cover}))return;
    scene.current?.peal();setExplored('shown');
  },[explored,uncovered]);   // as above
  useEffect(()=>{if(explored!=='shown')return;const timer=setTimeout(()=>setExplored(null),8000);return()=>clearTimeout(timer);},[explored]);
  // The Worker-only market extras (the seat floor) are read when the Observatory drawer opens, where the floor card is
  // (bridge.getExtras: at most once per 15 minutes; never again once the Worker has no floor source).
  const observatoryOpen=drawer?.kind==='observatory';
  useEffect(()=>{
    if(!observatoryOpen)return;const controller=new AbortController();
    void bridge.getExtras(controller.signal).then(()=>{const s=bridge.withExtras();if(s)setMarketSample(s);}).catch(()=>{});
    return()=>controller.abort();
  },[observatoryOpen,bridge]);
  useEffect(()=>{
    if(!drawer)return;const panel=document.querySelector<HTMLElement>('.world-drawer'),prior=document.activeElement as HTMLElement|null;
    panel?.querySelector<HTMLElement>('.close')?.focus();
    const trap=(e:KeyboardEvent)=>{if(e.key!=='Tab'||!panel)return;const list=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input')];const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};
    document.addEventListener('keydown',trap);return()=>{document.removeEventListener('keydown',trap);if(prior?.isConnected)prior.focus();};
  },[drawer]);
  const selectedId=drawer?.kind==='agent'?drawer.id:null;
  useEffect(()=>{
    setSeat(null);setSeatError(false);if(selectedId===null)return;const controller=new AbortController();let disposed=false;
    // Read when the drawer opens, then on the same cadence as the snapshot while it stays open.
    const poll=startPoll(async()=>{try{const s=await bridge.getSeat(selectedId,controller.signal);if(!disposed){setSeat(s);setSeatError(false);}return true;}catch{if(!disposed)setSeatError(true);return disposed;}});
    return ()=>{disposed=true;controller.abort();poll.stop();};
  },[selectedId,bridge]);
  // Esc: the ride (boarding.ts) unless it closes a drawer, the Map, the Explore list or the world-time panel (which has
  // already closed by now when the Esc came from inside it).
  useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key==='Escape'){if(insideNow.current){if(drawerNow.current!==null){setDrawer(null);e.preventDefault();}return;}/* the room's own Esc waits for the card over it */if(drawerNow.current===null&&!miniNow.current&&!document.querySelector('#explore-list,.world-time.open')&&!e.composedPath().some(n=>n instanceof Element&&n.classList.contains('world-time-panel')))scene.current?.rideEsc();setDrawer(null);collapse();}};window.addEventListener('keydown',esc);return()=>window.removeEventListener('keydown',esc);},[collapse]);
  // The strip folds on anything outside it: a click, tap or drag in the world, a tag, a tool, a card, the minimap, the
  // wheel, a key that walks, zooms or inspects (never on its own buttons or the language toggle: read it in the other
  // language first), and by itself after 12 s untouched while the page is in view (held while the pointer or focus is on it).
  useEffect(()=>{
    const m=root.current;if(!strip||!m)return;
    // Photo tools fold the intro in their click handler. Folding on pointerdown
    // can mount the mobile hint over the same target before pointerup arrives.
    const away=(e:Event)=>{const el=e.target instanceof Element?e.target:null;if(el&&!el.closest('.first-run,.language-toggle,.photo-tools'))collapse();};
    const key=(e:KeyboardEvent)=>{const el=e.target instanceof HTMLElement?e.target:null;if(stripKey(e.code)&&!e.ctrlKey&&!e.metaKey&&!(el&&(el.closest('input,textarea,select,button')||el.isContentEditable)))collapse();else setPoke(n=>n+1);};
    const moved=()=>setPoke(n=>n+1),o={capture:true,passive:true};m.addEventListener('pointerdown',away,o);m.addEventListener('click',away,o);m.addEventListener('wheel',away,o);m.addEventListener('focusin',moved);addEventListener('keydown',key);
    return()=>{m.removeEventListener('pointerdown',away,o);m.removeEventListener('click',away,o);m.removeEventListener('wheel',away,o);m.removeEventListener('focusin',moved);removeEventListener('keydown',key);};
  },[strip,collapse]);
  // The 12 s count from when the town is on screen (the scene drawn, or no WebGL at all; the first read in), not from mount:
  // a slow phone would otherwise fold the strip before anyone saw it. The note under the Explore pill counts from then too,
  // and not while a drawer is open (on a phone the drawer covers it).
  const townUp=!opening&&(!!view||sceneError)&&(world!==null||!busy),covered=drawer!==null;
  useEffect(()=>{if(!strip||held||!pageVisible||!townUp)return;const timer=setTimeout(collapse,STRIP_IDLE_MS);return()=>clearTimeout(timer);},[strip,held,pageVisible,townUp,poke,collapse]);
  useEffect(()=>{if(!note||!townUp||covered)return;const timer=setTimeout(()=>setNote(null),note==='tucked'?TUCKED_MS:WHERE_MS);return()=>clearTimeout(timer);},[note,townUp,covered]);
  const agents=world?.agents??[],results=useMemo(()=>searchAgents(agents,query,filter),[agents,query,filter]);
  const spots=useMemo(()=>agentSpots(homes.current),[homesVersion]);
  const mapPoints=useMemo(()=>agents.filter(a=>spots.has(a.tokenId)).map(a=>({a,p:spots.get(a.tokenId)!})),[agents,spots]);
  const agentMap=useMemo(()=>new Map(agents.map(a=>[a.tokenId,a])),[agents]);
  // Owner mode (signed in, seats verified by the server) marks the session wallet's household 「我家」 (ownHome); otherwise
  // myHome is the viewed wallet's (walletView.ts markedHome). The maps, the move flow and "Go home" all use myHome.
  const owner=ownerAddress(authState,Date.now()),{home:myHome,mine:ownHome}=useMemo(()=>markedHome(homes.current,owner,address),[owner,address,homesVersion]);
  const ember=useMemo(()=>emberReach(homes.current),[homesVersion]);
  // Home interiors (docs/interiors/DESIGN_v001.md): the signed-in owner walks into their own house, nobody else into any
  // (homeEntry.ts). Re-checked with every auth change and the 10 s clock, so an expiring session closes the door too.
  const enterable=useMemo(()=>enterableHome(authState,homes.current,Date.now()),[authState,homesVersion,marketClock]);
  // Inside a house: the lazy chunk runs the iris, suspends the world and gives it back; `leave` is why it should go out.
  const [doorNotice,setDoorNotice]=useState<DoorNotice>(null);
  const insideNow=useRef(inside),enterRef=useRef(()=>{});insideNow.current=inside;
  const leaveHome=(why:DoorNotice='go')=>setInside(i=>i&&!i.leave?{...i,leave:why}:i);
  enterRef.current=()=>{const h=enterAtPress(authState,enterable,Date.now());if(!h||insideNow.current||!scene.current||scene.current.viewMode==='god')return;setDrawer(null);setMini(false);collapse();setDoorNotice(null);setInside({home:h,size:h.size,style:homeStyle(h),preview:null,leave:null});};
  useEffect(()=>{scene.current?.setEnterable(enterable,()=>enterRef.current());},[enterable]);
  // Owner mode ending while inside (sign-out, account switch, expiry, seats no longer counting): straight back out.
  useEffect(()=>{if(inside&&inside.preview===null&&(!enterable||enterable.owner!==inside.home?.owner))leaveHome('outside');},[enterable,inside]);
  useEffect(()=>{if(!doorNotice)return;const timer=setTimeout(()=>setDoorNotice(null),8000);return()=>clearTimeout(timer);},[doorNotice]);
  // Reviewers' preview (?interior=<size>&seats=<n>, DEV or ?debug=1): the room with mock seats, owner rights never involved.
  const previewed=useRef(false);
  useEffect(()=>{const p=interiorPreview(location.search,import.meta.env.DEV);if(!p||!view||previewed.current)return;previewed.current=true;setInside({home:null,size:p.size,style:p.style,preview:p.seats,leave:null});},[view!==null]);
  // Stable, so the memoised minimap skips the 4 Hz re-renders the scene's view updates cause here.
  const openMap=useCallback(()=>{setMini(true);collapse();},[collapse]);
  /** The refresh buttons read the snapshot and the market now (user-initiated only; the cadence is unchanged). */
  const refreshAll=()=>{refreshRef.current();marketPoke.current();};
  /** Replay the last celebration (or show the latest hundred reached, when this browser has none) from the Observatory
   *  drawer: back to the plaza view, which frames the show; nothing is saved. Under reduced motion the drawer shows the
   *  message itself instead (ObservatoryPanel). */
  const replayHundred=celebrated??(world?.reportedOnline!=null&&world.reportedOnline>=MILESTONE_STEP?Math.floor(world.reportedOnline/MILESTONE_STEP)*MILESTONE_STEP:null);
  const replayKind:CelebrationKind=celebrated!==null?'replay':'preview';
  const replay=()=>{if(replayHundred===null)return;setDrawer(null);setMini(false);scene.current?.watchFireworks();celebrate(replayHundred,replayKind);};
  const celebrationText=celebration===null?null:milestoneText(celebration.hundred,celebration.kind,text,locale);
  const celebrationShort=celebration===null?null:milestoneText(celebration.hundred,celebration.kind,text,locale,true);
  useEffect(()=>{scene.current?.setMyHome(myHome,markerLabel(ownHome,text));},[myHome,ownHome,language]);
  // The wallet's account (connected by the sign-in click, or already granted) becomes the viewed wallet too.
  useEffect(()=>{const a=authState.account;if(a){setAddress(a);saveAddress(a);}},[authState.account]);
  const useAddress=(v:string)=>{if(!isAddress(v)){setWalletError(text('這不是有效的錢包地址。','That is not a valid wallet address.'));return;}setWalletError(null);setAddress(v.trim().toLowerCase());saveAddress(v);};
  const forgetWallet=()=>{setAddress(null);saveAddress(null);endMove();};
  const goHome=()=>{if(myHome){scene.current?.focusHome(myHome);setDrawer(null);collapse();focusWorld();}};
  // Moving needs owner mode (the server-verified SIWE session, moves.ts moveGate) and asks the wallet for nothing.
  const startMove=()=>{if(!myHome||moveGate(authState,myHome,Date.now())!=='ok')return;const l=freeLots(homes.current,myHome.owner,myHome.size,80,6000,typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__?mountainHousingFit:undefined);setLots(l);scene.current?.setLots(l,myHome.size);if(l[0])scene.current?.focusLot(l[0]);setDrawer(null);setMini(false);setLotError(null);};
  function endMove(){setLots(null);scene.current?.setLots(null);}
  const selectedLot=drawer?.kind==='lot'&&lots?lots[Number(drawer.id)]??null:null;
  // Owner mode ending (sign-out, account switch, expiry, seats no longer counting) ends move mode too.
  const canMove=moveGate(authState,ownHome?myHome:null,Date.now())==='ok';
  useEffect(()=>{if(!canMove&&lots){endMove();if(drawer?.kind==='lot')setDrawer(null);}},[canMove]);
  const confirmMove=()=>{
    if(!selectedLot||!ownHome)return;setLotError(null);
    const next=commitMove(moveStore(),mode,moves.current,authState,myHome,selectedLot,Date.now());
    if(!next){setLotError(text('請先簽名登入，才能搬家。','Sign in first to move your house.'));return;}
    moves.current=next;const owner=next.at(-1)!.owner;
    if(world){homes.current=homesFor(world,moves.current);scene.current?.setWorld(world,homes.current);setHomesVersion(v=>v+1);}
    endMove();setDrawer(null);const moved=homes.current.find(h=>h.owner===owner);if(moved)scene.current?.focusHome(moved);
  };
  useEffect(()=>{setPage(0);},[query,filter,mode]);
  useEffect(()=>{setPage(p=>Math.min(p,Math.max(0,Math.ceil(results.length/40)-1)));},[results.length]);
  const selectedAgent=selectedId!==null?agents.find(a=>a.tokenId===selectedId):null;
  const selectedBuilding=drawer?.kind==='building'?LANDMARKS.find(b=>b.id===drawer.id):null;
  const selectedDistrict=selectedBuilding?districtForLandmark(selectedBuilding.id):null;
  const workersState=world?.sources.workers.state??'unavailable';
  const locate=(id:string)=>{if(insideNow.current)leaveHome();scene.current?.focusAgent(id,true);choose({kind:'agent',id});};
  /** Focus back on the world after a tool, unless a drawer opened meanwhile (it holds the focus: a travel under reduced motion). */
  const focusWorld=()=>requestAnimationFrame(()=>{if(drawerNow.current===null)host.current?.querySelector('canvas')?.focus();});
  /** A drawer's own 前往 X: go there and look (its drawer is closed on purpose, so arriving does not reopen it). */
  const travelBuilding=(id:LandmarkId)=>{scene.current?.focusBuilding(id,true);setDrawer(null);collapse();focusWorld();};
  /** Explicit travel (onboarding 11: the checklist, the Map, the ? tiles, a far label, a road sign): go there, then open
   *  its drawer (which counts the visit) once the camera settles (scene.onArrive, arrival.ts: about 600 ms), unless another
   *  drawer opened meanwhile or you walked off. Under reduced motion the camera cuts, so it opens at once; with no 3D scene
   *  (no WebGL) the drawer opens alone. */
  const travelTo=(s:Selection)=>{
    const sc=scene.current;if(s.kind==='lot')return;if(!sc){setMini(false);choose(s);return;}
    if(s.kind==='building')sc.focusBuilding(s.id,true);else if(s.kind==='observatory')sc.focusObservatory();else sc.focusAgent(s.id,true);
    setDrawer(null);setMini(false);collapse();focusWorld();
    if(sc.viewMode==='god'||matchMedia('(prefers-reduced-motion: reduce)').matches)choose(s);else sc.onArrive(()=>{if(drawerNow.current===null)choose(s);});
  };
  drawerNow.current=drawer;selectedCallback.current=(s,travel)=>{if(travel)travelTo(s);else choose(s);};
  /** The strip's 「從 Pepe 的大螢幕開始 →」: fold it and walk to the front of the screen (a tap walk, so it shows how to get
   *  about), then open the Observatory once there (onboarding 11). It travels instead under reduced motion, from farther
   *  than a short walk (a replayed strip) or when the walk gets stuck; your own move on the way takes over. */
  const startAtPepe=()=>{
    const s={kind:'observatory',id:'observatory'} as const,sc=scene.current,at=landing(s),p=view?.player;collapse();
    if(!sc){choose(s);return;}
    if(sc.viewMode==='god'||matchMedia('(prefers-reduced-motion: reduce)').matches||!p||Math.hypot(p.x-at.x,p.z-at.z)>WALK_TO_PEPE)travelTo(s);
    else{sc.walkTo(at,()=>{if(drawerNow.current===null)choose(s);},()=>{if(drawerNow.current===null)travelTo(s);});focusWorld();}
  };
  const changeMode=(next:DataMode)=>{setDrawer(null);setQuery('');setMode(next);const url=new URL(location.href);url.searchParams.set('mode',next);history.replaceState(null,'',url);};
  const heading=drawer?drawerHeading(drawer,zh):null;
  // Standing at the drawer's place (within its edge + 6 m, arrival.ts): its 前往 / 走近 button would go nowhere, so it hides.
  const here=!!drawer&&!!view&&standingAt(placeEdge(godView?view.cameraFocus:view.player,drawer,spots));
  const selectedData=object(seat?.data);
  const nearName=view?.near?.kind==='observatory'?text('蜂群觀測站','Swarm Observatory'):view?.near?.kind==='building'?(zh?LANDMARKS.find(b=>b.id===view.near!.id)?.name:LANDMARKS.find(b=>b.id===view.near!.id)?.en):view?.near?t("守印者 #")+view.near.id:null;
  // Beacons (onboarding 04): picked on every view update (4 Hz) from what is visited, opened and drawn; the list keeps its
  // identity until a ring changes, so the scene and the tags hear only real changes. None in move mode or before the first
  // read has answered (a failed read still gets the Observatory and the landmarks).
  const landscape=useMedia(LANDSCAPE_PHONE),touchLayout=useMedia(TOUCH_LAYOUT),coarse=useMedia('(pointer: coarse)');
  const online=useMemo(()=>world?new Set(world.agents.filter(a=>a.presence==='online').map(a=>a.tokenId)):null,[world]);
  const picked=view&&!sceneError&&!lots&&(world||!busy)?pickBeacons({visited,opened:opened.current,online,figures:view.figures,player:view.player,inFrame:p=>scene.current?.inFrame(p)??false,landscape,now:performance.now(),since,relight:note==='where'}):[];
  const beaconMemo=useRef<{sig:string;list:readonly Beacon[]}>({sig:'',list:[]}),beaconSig=picked.map(b=>b.key+b.state+b.rings.map(r=>r.x.toFixed(1)+','+r.z.toFixed(1)).join()).join('|');
  if(beaconSig!==beaconMemo.current.sig)beaconMemo.current={sig:beaconSig,list:picked};
  const beacons=beaconMemo.current.list;
  const namedBeacons=useMemo(()=>buildingNamesShown?beacons:beacons.filter(b=>b.target.kind==='agent'),[beacons,buildingNamesShown]);
  // Their tags' ranks (labelTier.ts): one place whole (the hint's when you stand by it, else the nearest, else the hint's),
  // the rest the name dimmed, dots once settled (3 visits; not while the where-to-start pill relights the rings); kept
  // until one changes, so the tags re-render only then (never per frame). Only the whole one's ring breathes.
  const nextPlace=view&&beacons.length?hintTarget(view.player,view.yaw,visited)?.id??null:null,folded=settled(visited,opened.current,note==='where');
  const ranked=view?tagRanks(beacons,nextPlace,view.player,folded):new Map<string,TagRank>();
  const rankMemo=useRef<{sig:string;ranks:ReadonlyMap<string,TagRank>}>({sig:'',ranks:new Map()}),rankSig=[...ranked].map(([k,r])=>k+r.tier+r.near).join('|');
  if(rankSig!==rankMemo.current.sig)rankMemo.current={sig:rankSig,ranks:ranked};
  useEffect(()=>{scene.current?.setBeacons(beacons);},[beacons]);
  const featured=[...rankMemo.current.ranks].find(([,r])=>r.tier==='full')?.[0]??null;
  useEffect(()=>{scene.current?.setFeatured(featured);},[featured]);
  const pickBeacon=useCallback((s:BeaconTarget,touch:boolean)=>scene.current?.beaconPick(s,touch),[]);
  // The hint (onboarding 08): E within reach, else the nearest place not visited within 40 m (arrow, metres, what a click
  // does), else how to play for this screen. The live region hears it only when its target changes (and settles).
  const ride=view?.ride,boardable=ride?.phase==='near',riding=hudPhase(ride),liftText=useLiftText(),cableText=useCableText();   // 燼舟, the cable car: a stop's E, the ride's HUD
  const canSwitchView=sceneReady&&!sceneError&&!!view?.freeViewAvailable&&!inside&&!riding&&!portalOpen&&!selfie&&!avatar&&!lots&&!drawer&&!mini&&!strip;
  const toggleView=()=>{const sc=scene.current;if(!canSwitchView||!sc)return;if(sc.setViewMode(sc.viewMode==='god'?'person':'god'))focusWorld();};
  const viewModeLabel=godView?text('上帝視角','God view'):text('人物探索','Person exploration');
  const viewModeHint=godView?(coarse?text('單指拖曳或搖桿移動視角 · 雙指縮放','Drag with one finger or use the stick to pan · Pinch to zoom'):text('拖曳或 WASD 移動視角 · 滾輪縮放','Drag or WASD to pan · Scroll to zoom')):text('移動人物探索世界','Explore the world with your person');
  const hint:Hint=view?hintFor(!!nearName||boardable||riding,view.player,view.yaw,visited,p=>scene.current?.inFrame(p)??true):{kind:'idle'};
  const hintPlace=hint.kind==='go'?(hint.id==='observatory'?t('Pepe 的大螢幕'):(b=>b?(zh?b.name:b.en):'')(LANDMARKS.find(b=>b.id===hint.id))):'';
  // Off screen there is no name to click: the Explore list goes there. The pill turns one arrow (↗ is kept for links that
  // leave the site); the live region reads the arrow as a character.
  const hintGo=hint.kind==='go'?`${hintPlace} ${hint.meters} m · ${!hint.shown?text('探索清單裡可直接前往','go there from Explore'):hint.travel?text('點名牌直接前往',coarse?'tap its name to go':'click its name to go'):text('點它',coarse?'tap it':'click it')}`:'';
  const hintText=godView?text('人物停在原地；點建築查看。搭乘與進屋請切回人物探索。','Your person stays in place. Select buildings to inspect; return to person exploration to board or enter a home.'):riding?(ride?.cable?(ride.phase==='boarding'?text('纜車車廂進站中','A cable car cabin is coming in'):text('搭乘纜車中 · 到站自動下車','Riding the cable car · you step out at the station')):text('搭乘燼舟中 · E 下一站下船','Riding the ember boat · E gets off at the next stop')):boardable?(ride?.cable?'E '+cableText(ride.next):ride?.shuttle&&ride.lift?'E '+liftText(ride.lift,ride.stop):text('E 搭燼舟','E Board the ember boat')):nearName?`${text('查看','Inspect')} ${nearName}`:hint.kind==='go'?`${hint.arrow} ${hintGo}`
    :t(touchLayout&&coarse?'點發光的東西查看 · 左下搖桿走路 · 雙指縮放':coarse?'點發光的東西查看 · 點地面走路 · 雙指縮放':'點會發光的人或建築查看 · WASD 走路 · 拖曳轉視角 · 滾輪縮放');
  const hintKey=drawer||strip?'':godView?'god':riding?'ride':boardable?'board':nearName?'near:'+nearName:hint.kind==='go'?'go:'+hint.id:'idle',hintNow=useRef(hintText),[hintLive,setHintLive]=useState('');hintNow.current=hintKey?hintText:'';
  useEffect(()=>{const timer=setTimeout(()=>setHintLive(hintNow.current),700);return()=>clearTimeout(timer);},[hintKey,language,coarse,touchLayout]);
  // Under the Explore pill: where the strip went (4 s), or a returning visit's 「從哪開始？」 (20 s, opens the list).
  const left=PLACE_TOTAL-visitCount(visited),noteText=useMemo(()=>note==='tucked'?{text:left?text(`開場收進這裡 · 還有 ${left} 個地方可以逛`,`The intro is tucked in here · ${left} ${left===1?'place':'places'} to explore`):text('開場收進這裡','The intro is tucked in here'),opens:false}:note==='where'?{text:t('從哪開始？'),opens:true}:null,[note,left,zh]);
  const visitObservatory=()=>{scene.current?.focusObservatory();setDrawer(null);setMini(false);collapse();focusWorld();};
  const visitFrost=()=>{scene.current?.focusFrost();setDrawer(null);setMini(false);collapse();focusWorld();visit('frost');};
  const visitStop=(id:string)=>{const at=MAP_STOPS.find(m=>m.id===id)?.stand??MAP_CABLE.find(m=>m.id===id)?.stand;if(!at)return;scene.current?.focusPlace(at);setDrawer(null);setMini(false);collapse();focusWorld();};
  goPlace.current=id=>{if(id==='frost')visitFrost();else travelTo(id==='observatory'?{kind:'observatory',id}:{kind:'building',id});};
  // Frosthollow has no drawer: reaching its valley on foot is the visit too.
  const inFrost=!!view&&inFrosthollow(view.player);
  useEffect(()=>{if(inFrost)visit('frost');},[inFrost,visit]);
  // The music's moments (music.ts): a boat ride, the fireworks or seven of seven, Frosthollow (at night).
  const celebrating=celebration!==null||explored==='shown';
  useEffect(()=>{music.current?.setContext({riding,celebrating,frosthollow:inFrost});},[riding,celebrating,inFrost]);
  const debug=useMemo(()=>new URLSearchParams(location.search).get('debug')==='1',[]);
  const nearDoor=!godView&&doorOffer(!!view?.nearDoor,enterable,!!inside),drawerHome=selectedId!==null?homeOf(homes.current,selectedId)??null:null,offerEnter=!godView&&blockEnter(drawerHome,enterable,!!inside);
  useEffect(()=>{if(nearDoor||offerEnter)void loadInterior().catch(()=>{});},[nearDoor,offerEnter]);   // fetched as the way in shows
  const joystick=(e:ReactPointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect(),dx=(e.clientX-r.left-r.width/2)/42,dz=(e.clientY-r.top-r.height/2)/42,len=Math.max(1,Math.hypot(dx,dz));scene.current?.setStick(dx/len,dz/len);e.currentTarget.style.setProperty('--jx',`${dx/len*25}px`);e.currentTarget.style.setProperty('--jy',`${dz/len*25}px`);};
  const resetJoystick=(e:ReactPointerEvent<HTMLDivElement>)=>{scene.current?.setStick(0,0);e.currentTarget.style.setProperty('--jx','0px');e.currentTarget.style.setProperty('--jy','0px');};
  const hud=['ember-world',inside&&'inside-home',riding&&'riding',strip&&'first-run-open',mini&&'map-open',drawer&&'drawer-open',lots&&!drawer&&'moving'].filter(Boolean).join(' ');
  return <MemberContext.Provider value={member}><main ref={root} className={hud} data-welcome={welcome} data-language={language} data-visited={visitCount(visited)} data-mode={mode} data-weather={market.weather} data-calm={calm?'on':'off'} data-music={tune?.id??''} data-market-state={market.state} data-registered={agents.length} data-online={world?.enumeratedOnline??0} data-signals={view?.renderedSignals??0} data-view-mode={view?.viewMode??'person'} data-camera-focus={view?`${view.cameraFocus.x.toFixed(2)},${view.cameraFocus.z.toFixed(2)}`:''} data-player={view?`${view.player.x.toFixed(2)},${view.player.z.toFixed(2)}`:''}>
    <div className="world-canvas" ref={host} inert={portalOpen}/>
    {research&&<ResearchPane panelZh={zh} panelOverlay panelClose={closeResearch} state={authState} onSignIn={()=>void auth.signIn()} language={language} onLanguage={setLanguage} onClose={closeResearch}/>}
    {library&&<LibraryPane panelZh={zh} panelOverlay panelClose={closeLibrary} language={language} onClose={closeLibrary}/>}
    {game&&<ClashPane panelZh={zh} panelOverlay panelClose={closeGame} language={language} onClose={closeGame}/>}
    {gold&&<GoldPane panelZh={zh} panelOverlay panelClose={closeGold} state={authState} language={language} onClose={closeGold} onSignIn={()=>void auth.signIn()}/>}
    {inventory&&<InventoryPane panelZh={zh} panelOverlay panelClose={closeInventory} state={authState} zh={zh} onClose={closeInventory}/>}
    {economy&&<EconomyPane panelZh={zh} panelOverlay panelClose={closeEconomy} state={authState} language={language} onClose={closeEconomy} onSignIn={()=>void auth.signIn()}/>}
    {selfie&&<SelfiePanel panelZh={zh} panelOverlay panelClose={closeSelfie} capture={captureSelfie} onClose={closeSelfie} zh={zh} returnFocusRef={selfieLauncher}/>}
    {avatar&&<AvatarPanel panelZh={zh} panelOverlay panelClose={closeAvatar} appearance={appearance} onChange={chooseAppearance} onClose={closeAvatar} zh={zh} returnFocusRef={avatarLauncher} persisted={appearanceSaved}/>}
    <div className="world-hud" style={{display:'contents'}} inert={!!inside||selfie||avatar||portalOpen}>
    <div className="world-tags">{!sceneError&&<><Beacons feed={screen} beacons={namedBeacons} ranks={rankMemo.current.ranks} onPick={pickBeacon} coarse={coarse}/><YouTag feed={screen} first={firstRun} covered={drawer!==null||!pageVisible||!townUp}/><HoverChip feed={screen}/><TapNote feed={screen}/></>}</div>
    <header className="world-title"><h1><span className="title-name"><span className="title-imd">IMD</span> <span className="title-ew"><b>Ember</b> World</span></span></h1><i className="title-rule" aria-hidden="true"/><p>{t('IMD Agent 網路的即時 3D 世界')}</p><TitleNote say={text}/><div className="title-pills"><ConnectionPill mode={mode} workers={world?.sources.workers} busy={busy} firstLoad={firstLoad} onRefresh={refreshAll}/><Checklist visited={visited} onGo={onGo} note={noteText} pulse={welcome==='link'}/></div></header>
    <HudPocket kind="network" label={text('網路狀態','Network')} value={`${nice(workersState==='fresh'?world?.enumeratedOnline:null)} · ${nice(world?.reportedWorking)} ${text('工作中','working')}`} compact={touchLayout}>
    <aside className="network-pocket" aria-label={t("網路狀態")}><div><b>{nice(workersState==='fresh'?world?.enumeratedOnline:null)}</b><span>{text('名冊上線','Listed online')}</span></div><div><b>{nice(world?.reportedWorking)}</b><span>{text('網路工作中','Network working')}</span></div><button onClick={()=>choose({kind:'building',id:'heart'})}>{text('網路摘要','Network summary')} →</button></aside></HudPocket>
    <HudPocket kind="weather" label={text('市場天氣','Market weather')} value={`${night&&WEATHER_LABELS[shownWeather].icon==='☀'?'☾':WEATHER_LABELS[shownWeather].icon} ${market.quote?'$IMD $'+market.quote.priceUsd.toFixed(2):text('等待行情','Waiting for market')}`} compact={touchLayout}>
    <button className="market-pocket" onClick={()=>choose({kind:'observatory',id:'observatory'})} aria-label={text('市場天氣與蜂群觀測站','Market weather & Swarm Observatory')}><span className="weather-icon" aria-hidden="true">{night&&WEATHER_LABELS[shownWeather].icon==='☀'?'☾':WEATHER_LABELS[shownWeather].icon}</span><span><small>{text('市場天氣','Market weather')}{mode==='mock'?' / Demo':''}</small><CardWeather weather={shownWeather} mood={market.mood} calm={calm} zh={zh}/><small>$IMD {market.quote?'$'+market.quote.priceUsd.toFixed(2):'—'} · {changeText(market.quote?.change24h,market.weather)} / 24h{market.state==='stale'?text(' · 快取',' · cached'):''}</small></span><span aria-hidden="true">→</span></button></HudPocket>
    <WorldTime onPreview={previewTime} onBand={timeBand}/>
    <div className="top-controls">{import.meta.env.DEV&&__COLLECTION_LOCAL__&&<button onClick={()=>location.assign("?collection=1&portal=collection&lang="+language)}>{text("收藏","Items")}</button>}<button className="language-toggle" aria-label={zh?'Switch to English':'切換中文'} onClick={()=>{const next=zh?'en':'zh';setLanguage(next);const url=new URL(location.href);url.searchParams.set('lang',next);history.replaceState(null,'',url);}}>{zh?'EN':'中文'}</button><button onClick={()=>setDrawer({kind:'help'})} aria-label={t("操作說明")}>?</button><span className="sound-wrap"><button className="sound-toggle" aria-pressed={soundOn} aria-label={text('天氣聲音與音樂','Weather sound and music')} title={soundOn&&musicHeld?text('聲音：開；音樂為省流量暫停（點一下播放音樂）','Sound on; music paused to save data (click to play it)'):soundOn?soundLocked?text('聲音：開（點一下開始）','Sound on (click to start)'):text('聲音：開（點一下靜音）','Sound on (click to mute)'):text('聲音：關','Sound off')} {...toggleHandlers(()=>sound.current,()=>{if(soundOn&&musicHeld){sound.current?.pressCancel();setMusicHeld(false);music.current?.pressed(true);return;}  /* saveData: this press is for the music */
      /* a press that found the audio locked started it (sound.ts pressToggle): it stays on */const next=sound.current?sound.current.pressToggle():!soundOn;setSoundOn(next);music.current?.pressed(next);setMusicHeld(false);})}><svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" fill="currentColor"/>{soundOn?<path d="M13 7.2a4 4 0 0 1 0 5.6M15.3 5a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>:<path d="M13 7.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>}</svg></button><span className="sound-hint" role="status" aria-live="polite">{soundHint(soundLocked,soundOn,coarse,zh,musicHeld)??''}</span></span></div>
    {!sceneReady&&!sceneError&&<p className="world-starting" role="status">{text('正在準備廣場…','Preparing the plaza…')}</p>}
    {sceneError&&<p className="scene-error" role="alert">{t('無法啟動 3D 場景，請使用支援 WebGL 的瀏覽器。Agent 名冊仍可查看。')} <button onClick={()=>location.reload()}>{text('重新載入頁面','Reload page')}</button></p>}
    {strip&&<section className="first-run" aria-labelledby="first-run-title" onPointerEnter={()=>setHeld(true)} onPointerLeave={()=>setHeld(false)} onFocus={()=>setHeld(true)} onBlur={()=>setHeld(false)}><div className="first-run-text"><h2 id="first-run-title">{t('這是 IMD Agent 網路的即時小鎮')}</h2><p>{t('沿路探訪住處與公共建築 · 點發光處查看資料')}</p></div><div className="first-run-actions"><button className="first-run-go" onClick={startAtPepe}>{t('從 Pepe 的大螢幕開始 →')}</button><button className="first-run-skip" onClick={()=>{collapse();focusWorld();}}>{t('自己逛逛')}</button></div></section>}
    <nav className="world-tools" aria-label={t("探索工具")}><button aria-label={t("尋找 Agent")} onClick={()=>{setDrawer({kind:'registry'});collapse();}}><span aria-hidden="true">⌕</span>{text('尋找 Agent','Find an agent')}</button><button aria-label={t("地圖")} onClick={()=>setMini(!mini)}><span aria-hidden="true">◈</span>{text('地圖','Map')}</button><button className="god-view-toggle" aria-label={text('上帝視角','God view')} aria-pressed={godView} aria-describedby="world-view-mode-description" disabled={!canSwitchView} title={canSwitchView?(godView?text('切回人物探索','Return to person exploration'):text('切換上帝視角，人物停在原地','Switch to God view; your person stays in place')):text('場景準備好並關閉面板、完成搭乘後即可切換','Switch when the scene is ready, panels are closed and your ride is finished')} onClick={toggleView}><svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16"><circle cx="10" cy="10" r="5.5"/><path d="M10 1v4m0 10v4M1 10h4m10 0h4"/></svg>{text('上帝視角','God view')}</button><button aria-label={godView?text('查看廣場','View the plaza'):t("回廣場")} onClick={()=>{scene.current?.home();setDrawer(null);}}><span aria-hidden="true">⌂</span>{godView?text('查看廣場','View plaza'):text('回廣場','Plaza')}</button><WalletChip state={authState} onOpen={()=>{setDrawer({kind:'home'});collapse();}}/></nav>
    <p className="view-mode-state" id="world-view-mode-description" hidden={!!drawer||!!strip||!!inside||portalOpen||selfie||avatar||!!lots} role="status" aria-live="polite"><b>{viewModeLabel}</b>{godView&&<span>{viewModeHint}</span>}</p>
    {lots&&!drawer&&<div className="move-banner" role="status"><span>{text('搬家模式：點一塊發亮的空地','Move mode: select a glowing lot')}（{lots.length}）</span><button onClick={endMove}>{text('取消','Cancel')}</button></div>}
    <div className="zoom-tools"><div className="photo-tools"><button className="building-names-toggle" aria-pressed={buildingNamesShown} aria-label={namesAction} title={namesAction} onClick={()=>setBuildingNamesShown(shown=>!shown)}><span>{namesAction}</span></button><button ref={avatarLauncher} className="avatar-launch" disabled={sceneError||!view||riding||!!inside} title={text('選擇火柴人造型','Choose your stick figure')} aria-label={text('造型','Appearance')} onClick={()=>{collapse();setDrawer(null);setMini(false);setSelfie(false);setAvatar(true);}}><AvatarPortrait appearance={appearance}/><span>{text('造型','Style')}</span></button><button ref={selfieLauncher} className="selfie-launch" disabled={sceneError||!view||riding||!!inside} title={riding?text('下船後再自拍','Step ashore to take a selfie'):text('自拍與分享','Take and share a selfie')} aria-label={text('自拍','Selfie')} onClick={()=>{collapse();setDrawer(null);setMini(false);setAvatar(false);setSelfie(true);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-3h4l2 3h4v13H4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="12" cy="13" r="4" fill="none" stroke="currentColor" strokeWidth="1.5"/></svg><span>{text('自拍','Selfie')}</span></button></div><button onClick={()=>scene.current?.zoomStep(-1)} aria-label={t("拉近鏡頭")}>+</button><button onClick={()=>scene.current?.zoomStep(1)} aria-label={t("拉遠鏡頭")}>−</button></div>
    <p className="sr-only" role="status">{celebrationText?celebrationText+(zh?'。':'.'):''}{explored==='shown'?t('燼渡全部走過了！'):''}</p>
    {!drawer&&!strip&&!inside&&<div className="interaction-hint">{explored==='shown'&&!lots&&<p className="celebration" aria-hidden="true"><span>✦</span> {t('燼渡全部走過了！')}</p>}{celebration!==null&&!lots&&<p className="celebration" aria-hidden="true"><span>✦</span> <span className="long">{celebrationText}</span><span className="short">{celebrationShort}</span></p>}{godView?null:riding&&ride?<RideHud view={ride} coarse={coarse} onAlight={()=>{scene.current?.rideAlight();focusWorld();}} onCancel={()=>{scene.current?.rideEsc();focusWorld();}}/>:boardable?<><button className="board-boat" onClick={()=>{scene.current?.interact();focusWorld();}}><kbd>E</kbd> {ride?.cable?cableText(ride.next):ride?.shuttle&&ride.lift?liftText(ride.lift,ride.stop):text('搭燼舟','Board the ember boat')}</button>{ride?.lift&&!ride.shuttle&&<button className="board-boat board-lift" onClick={()=>{scene.current?.boardLift();focusWorld();}}><kbd>L</kbd> {liftText(ride.lift,ride.stop)}</button>}</>:nearDoor?<button className="enter-home" onClick={()=>enterRef.current()}><kbd>E</kbd> {text('進入我的家','Enter your home')}</button>:nearName?<button onClick={()=>scene.current?.interact()}><kbd>E</kbd> {text('查看','Inspect')} {nearName}</button>:<p className="hint-pill" aria-hidden="true">{hint.kind==='go'?<><i className="hint-arrow" style={{'--turn':ARROWS.indexOf(hint.arrow as typeof ARROWS[number])} as CSSProperties}>↑</i> {hintGo}</>:hintText}</p>}</div>}
    <p className="sr-only" role="status">{hintLive}</p>
    <div className={'touch-stick '+(drawer||riding||strip&&!landscape?'disabled':'')} role="group" aria-label={godView?text('視角移動搖桿','Camera pan joystick'):t("移動搖桿")} onPointerDown={e=>{if(drawer||riding||strip&&!landscape)return;e.currentTarget.setPointerCapture(e.pointerId);joystick(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))joystick(e);}} onPointerUp={resetJoystick} onPointerCancel={resetJoystick}><i/><span>{godView?text('移動視角','Pan view'):t("移動")}</span></div>
    {!sceneError&&<MiniMap pose={pose} ember={ember} points={mapPoints} myHome={myHome} viewMode={godView?'god':'person'} cameraFocus={godView?view?.cameraFocus:null} onOpen={openMap}/>}
    {mini&&<WorldMap panelZh={zh} panelOverlay panelClose={()=>setMini(false)} points={mapPoints} myHome={myHome} lots={lots} pose={pose} visited={visited} viewMode={godView?'god':'person'} cameraFocus={godView?view?.cameraFocus:null} onTravel={id=>travelTo({kind:'building',id})} onPublicHall={id=>{setDrawer(null);setMini(false);collapse();scene.current?.focusPublicHall(id);}} onObservatory={()=>travelTo({kind:'observatory',id:'observatory'})} onFrost={visitFrost} onStop={visitStop} onClose={()=>setMini(false)}/>}
    {(doorNotice==='outside'||doorNotice==='failed')&&!inside&&<div className="move-banner" role="status"><span>{doorNotice==='outside'?text('你已回到屋外：目前不是這間房子的屋主身分。','You’ve stepped back outside: you are no longer signed in as this house’s owner.'):text('暫時無法開門。請重新整理頁面後再試一次。','Couldn’t open the door. Reload the page to try again.')}</span>{doorNotice==='failed'&&<button onClick={()=>location.reload()}>{text('重新整理','Reload')}</button>}<button onClick={()=>setDoorNotice(null)}>{text('知道了','OK')}</button></div>}
    {debug&&<footer className="world-footnote"><span className="perf">{view?.fps??0} fps · {view?.nearFigures??0} {text('近景守印者','nearby figures')}</span></footer>}
    </div>
    {drawer&&<><button className="drawer-backdrop" aria-label={t("關閉面板")} onClick={()=>setDrawer(null)}/><aside className="world-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><div className="drawer-header"><div><span>{heading?.eyebrow}</span><h2 id="drawer-title">{heading?.title}</h2></div><button className="close" aria-label={t("關閉面板")} onClick={()=>setDrawer(null)}>×</button></div><div className="drawer-body">
      {drawer.kind==='home'&&<WalletPanel client={auth} member={member} state={authState} address={address} canSign={canSign} home={myHome} agents={agentMap} error={walletError} onUseAddress={useAddress} onForget={forgetWallet} onTravel={goHome} onMove={startMove} onLocate={locate}/>}
      {drawer.kind==='lot'&&(selectedLot&&myHome?<LotPanel lot={selectedLot} home={myHome} error={lotError} onMove={confirmMove} onCancel={()=>setDrawer(null)}/>:<p className="empty-state">{text('這塊地已經不能選了。','This lot is no longer available.')}</p>)}
      {drawer.kind==='observatory'&&<ObservatoryPanel world={world} loading={showLoading(world?.sources.swarm,firstLoad)} sample={marketSample} feed={feed} celebrated={celebrated} replayHundred={replayHundred} replayKind={replayKind} onReplay={replay} onVisit={here?null:visitObservatory} calm={calm} onCalm={chooseCalm}/>}
      {drawer.kind==='registry'&&<><p>{t("全體連線名冊隨 IMD 更新。每位守印者都有住處，新加入的成員會自動進入世界。")}</p><a className="source-link" href="https://explorer.imd.fun/agents" target="_blank" rel="noreferrer">{text('在 IMD Explorer 查看 Agents','Open Agents in IMD Explorer')} ↗</a><form className="agent-search" onSubmit={e=>{e.preventDefault();const found=exactAgent(agents,query);if(found)locate(found.tokenId);else setPage(0);}}><input aria-label={t("搜尋 Agent")} placeholder={t("席位 #、Agent ID、錢包、Codex…")} value={query} onChange={e=>setQuery(e.target.value)}/><button aria-label={t("定位確切 Agent")} type="submit">{t("尋找")}</button></form><div className="registry-filters">{(['online','working','all'] as const).map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='online'?t("上線"):f==='working'?t("工作中"):t("全部記錄")}</button>)}</div><div className="registry-count"><span>{zh?`${results.length} 位符合 · 完整記錄 ${agents.length} 位`:`${results.length} matches · ${agents.length} total records`}</span><small>{workersState==='fresh'?t("每 15 分鐘更新"):workersState==='stale'?t("快取 · 上線狀態待確認"):t("連線狀態待確認")}</small></div>
        {!results.length&&<p className="empty-state">{busy||showLoading(world?.sources.workers,firstLoad)?t("正在讀取全體名冊…"):workersState!=='fresh'?t("目前無法確認上線狀態，可改看全部記錄或重新整理。"):t("沒有符合的守印者。可切換「全部記錄」查看離線成員。")}</p>}
        <ul className="agent-list">{results.slice(page*40,(page+1)*40).map(a=><li key={a.tokenId}><button onClick={()=>locate(a.tokenId)}><i className={a.presence==='online'?(isWorking(a)?'working':'online'):'offline'}/><span><strong>#{a.tokenId}</strong><small>Agent {a.agentId??t("未知")} · {a.runtimes.join(' / ')||t("環境未知")}</small></span><span className="agent-list-status">{presence(a.presence,isWorking(a))} <b aria-hidden="true">→</b></span></button></li>)}</ul>
        {results.length>40&&<div className="pager"><button disabled={page===0} onClick={()=>setPage(p=>p-1)}>{t("上一頁")}</button><span>{page+1} / {Math.ceil(results.length/40)}</span><button disabled={(page+1)*40>=results.length} onClick={()=>setPage(p=>p+1)}>{t("下一頁")}</button></div>}<p className="small-note">{t("分頁只影響清單顯示。所有取得的 Agent 均可搜尋與定位，場景沒有名冊人數上限。")}</p></>}
      {selectedAgent&&<><div className={'guardian-state '+selectedAgent.presence}><i/>{presence(selectedAgent.presence,isWorking(selectedAgent))}<span>{date(world?.sources.workers.fetchedAt)}</span></div>{['361','921'].includes(selectedAgent.tokenId)&&<p className="guardian-role">{selectedAgent.tokenId==='361'?t("觀測之印"):t("行動之印")}{t("· 世界中的特色守印者")}</p>}<p>{t("這個角色對應 IMD 席位 #")}{selectedAgent.tokenId}{t("。活動和工作姿態依公開連線資料更新。")}</p><dl className="agent-details"><dt>{t("席位 Token ID")}</dt><dd>{selectedAgent.tokenId}</dd><dt>ERC-8004 Agent ID</dt><dd>{selectedAgent.agentId??t("未提供")}</dd><dt>{t("執行環境")}</dt><dd>{selectedAgent.runtimes.join(' / ')||t("未提供")}</dd><dt>{t("模型")}</dt><dd>{selectedAgent.models.join(' / ')||t("未提供")}</dd><dt>{t("Worker 版本")}</dt><dd>{selectedAgent.version??t("未提供")}</dd><dt>{t("連線装置")}</dt><dd>{selectedAgent.devices}</dd><dt>{t("錢包")}</dt><dd title={selectedAgent.owner??''}>{selectedAgent.owner&&walletUrl(selectedAgent.owner)?<a href={walletUrl(selectedAgent.owner)!} {...out}>{walletLabel(selectedAgent.owner,selectedData.ownerName)} ↗</a>:t("未提供")}</dd><dt>{t("最後心跳")}</dt><dd>{selectedAgent.heartbeat?new Date(selectedAgent.heartbeat).toLocaleString(locale):t("未提供")}</dd></dl><div className="agent-stats"><div><b>{nice(selectedAgent.accepted)}</b><span>{t("通過提交")}</span></div><div><b>{nice(selectedAgent.failed)}</b><span>{t("失敗")}</span></div><div><b>{nice(selectedAgent.pending)}</b><span>{t("待驗證")}</span></div></div><p className="small-note">{t("統計來源：網路摘要")}{date(world?.sources.swarm.fetchedAt)}{world?.sources.swarm.state==='stale'?t("（快取）"):''}{t("。席位不等於 ERC-8004 Agent ID；提交通過不等於 Oracle 簽署。")}</p>
        {!here&&<button className="primary" onClick={()=>{if(insideNow.current)leaveHome();scene.current?.focusAgent(selectedAgent.tokenId,true);setDrawer(null);}}>{godView?text('查看這位守印者','View this guardian'):t("走近這位守印者")}</button>}{(()=>{const h=homeOf(homes.current,selectedAgent.tokenId);return h?<HouseholdBlock home={h} agents={agentMap} mine={h.owner===address} onLocate={locate} onEnter={offerEnter?()=>enterRef.current():undefined}/>:null;})()}<a className="source-link" href={agentUrl(selectedAgent.tokenId)??explorerTab('agents')} target="_blank" rel="noreferrer">{t("在 IMD 查看此席位 ↗")}</a>
        <CityHousePanel panelZh={zh} store={scene.current?.activityStore??null} home={homeOf(homes.current,selectedAgent.tokenId)??null} seatId={selectedAgent.tokenId} zh={zh}/>
        <h3>{t("席位的近期工作")}</h3>{seatError?<p className="empty-state">{t("席位詳情暫不可用，名冊仍可查看。")}</p>:!seat?<p className="small-note">{t("正在讀取席位詳情…")}</p>:<><p className={'source-note '+seat.state}>{seat.state==='fresh'?t("公開詳情"):seat.state==='stale'?t("上次詳情"):t("暫不可用")} · {date(seat.fetchedAt)}</p>{Array.isArray(selectedData.work)?<ul className="record-list">{selectedData.work.map((v,i)=>{const r=object(v),href=jobUrl(r.jobId),title=String(r.objective??r.jobId??t("未提供"));return <li key={i}><span className="record-status">{String(r.status??'unknown')}</span><p>{href?<a href={href} {...out}>{title} ↗</a>:title}</p></li>;})}</ul>:<p className="small-note">{mode==='mock'?t("此為示範角色，沒有真實工作紀錄。"):t("這次未提供工作紀錄。")}</p>}</>}
      </>}
      {selectedBuilding&&<>{selectedDistrict&&<div className="district-context" data-district={selectedDistrict.id}><span>{selectedDistrict.label} / {zh?selectedDistrict.name:selectedDistrict.direction+' district'}</span><a href={selectedDistrict.url} target="_blank" rel="noreferrer">{text('在 IMD Explorer 查看','Open in IMD Explorer')} ↗</a><DistrictTabs id={selectedDistrict.id}/></div>}<p>{zh?selectedBuilding.description:selectedBuilding.descriptionEn}</p>{!here&&<button className="primary" onClick={()=>travelBuilding(selectedBuilding.id)}>{godView?text('查看','View '):t("前往")}{zh?selectedBuilding.name:selectedBuilding.en}</button>}
        <CityCivicPanel panelZh={zh} store={scene.current?.activityStore??null} kind={selectedBuilding.id} zh={zh}/>
        {selectedBuilding.id==='heart'&&<><h3>{t("世界的脈動")}</h3><dl className="agent-details"><dt>{t("網路回報上線")}</dt><dd>{nice(world?.reportedOnline)}</dd><dt>{t("已取得上線席位")}</dt><dd>{nice(workersState==='fresh'?world?.enumeratedOnline:null)}</dd><dt>{t("連線裝置樣本")}</dt><dd>{nice(world?.connectedDevices)}</dd><dt>{t("名冊完整性")}</dt><dd>{world?.completeWorkers?t("完整回傳"):t("待確認")}</dd><dt>{t("歷史／当前記錄")}</dt><dd>{agents.length}</dd><dt>{t("24h 通過提交")}</dt><dd>{nice(world?.accepted24h)}</dd><dt>{t("24h Oracle 結果")}</dt><dd>{nice(world?.oracle24h)}</dd><dt>{t("摘要中的上線發布")}</dt><dd>{nice(world?.liveLaunches)}</dd><dt>{t("摘要中的網站")}</dt><dd>{nice(world?.sites)}</dd></dl><p className="small-note">{t("網路摘要與連線名冊分別取樣，數字可能有時間或覆蓋差異。未綁定席位的裝置")}{world?.unseatedDevices??0}{t("台。已鑄造席位不直接視為上線 Agent。")}</p><h3>{t("資料來源")}</h3>{world&&<SourceRows sources={world.sources} firstLoad={firstLoad}/>}<button className="secondary" disabled={busy} onClick={refreshAll}>{busy?t("讀取中…"):t("重新整理公開資料")}</button></>}
        {world&&selectedBuilding.id==='oracle'&&<Feed items={world.oracle} sample={world.sources.oracle} kind="oracle" firstLoad={firstLoad}/>}
        {world&&selectedBuilding.id==='forge'&&<><h3>{text('工坊的火花：蜂群工作量','Forge sparks: swarm workload')}</h3><p className="small-note">{text('煙囪的火花隨全網每秒推理量跳動；還沒有兩次讀取時，改看最近 60 分鐘通過驗收的步數。水車與爐火跟著執行中的任務（Explorer 的「執行中」分頁）。','The chimney sparks follow the network’s inference per second; before two reads they follow the accepted steps of the last 60 minutes. The mill and the furnace follow the running jobs (Explorer’s Running tab).')}</p><WorkloadBlock meter={outputMeter(world)} fresh={world.activity?.state==='fresh'}/><h3>{text('近期任務','Recent jobs')}</h3><Feed items={world.jobs} sample={world.sources.jobs} kind="job" firstLoad={firstLoad}/></>}
        {world&&selectedBuilding.id==='archive'&&<><Feed items={world.publications} sample={world.sources.publications} kind="publication" firstLoad={firstLoad}/><button className="secondary" onClick={()=>choose({kind:'building',id:'launch'})}>{text('查看區內的合約發布台','View the district’s contract launches')}</button></>}
        {world&&selectedBuilding.id==='launch'&&<><h3>{text('碼頭末端的 $1B 目標燈塔','The $1B goal beacon at the pier’s end')}</h3><GoalBlock goal={goalBeacon(market)}/><h3>{text('碼頭的 24 盞小時燈','The pier’s 24 hour lamps')}</h3><WorkloadBlock meter={outputMeter(world)} fresh={world.activity?.state==='fresh'}/><h3>{text('合約發布','Contract launches')}</h3><Feed items={world.launches} sample={world.sources.launches} kind="launch" firstLoad={firstLoad}/><button className="secondary" onClick={()=>choose({kind:'building',id:'archive'})}>{text('返回成果典藏館','Back to the Published hall')}</button></>}
        {selectedBuilding.id==='guardian'&&<><p>{agents.length}{t("位守印者已取得記錄。住處會隨著名冊擴展，已分配的位置保持固定。")}</p><button className="secondary" onClick={()=>setDrawer({kind:'registry'})}>{t("打開全體名冊")}</button><div className="featured-agents">{['361','921'].map(id=><button key={id} disabled={!agents.some(a=>a.tokenId===id)} onClick={()=>locate(id)}>{t("守印者 #")}{id}</button>)}</div></>}
        {selectedBuilding.id==='chronicle'&&<div className="sealed-gate"><span>◈</span><h3>{t("尚未開啟的記憶")}</h3><p>{t("未來會從這裡延伸這款新遊戲的探索故事。")}</p></div>}
      </>}
      {drawer.kind==='help'&&<><GuideIntro say={text}/><button className="secondary replay-intro" onClick={()=>{setDrawer(null);setNote(null);setStrip('replay');}}>{t('重看開場')}</button><h3>{text('城市四個分區','Four city districts')}</h3><div className="district-guide">{DISTRICTS.map(d=><button key={d.id} onClick={()=>travelTo({kind:'building',id:d.entry})}><strong>{d.label}</strong><span>{zh?d.summaryZh:d.summary}</span></button>)}</div><h3>{text('人物探索與上帝視角','Person exploration and God view')}</h3><p>{text('工具列的上帝視角按鈕可自由切換。上帝視角只移動鏡頭，人物留在原地；點建築或地圖查看，原有書館與觀研館仍在 World 內開啟。搭乘或進屋請先切回人物探索。','Use the God view button in the toolbar to switch. God view moves the camera while your person stays in place. Select buildings or the map to inspect; the library and research hall still open inside World. Return to person exploration before boarding or entering a home.')}</p><dl className="agent-details"><dt>{text('上帝視角：電腦','God view: desktop')}</dt><dd>{text('拖曳或 WASD 移動畫面；滾輪縮放','Drag or WASD to pan; scroll to zoom')}</dd><dt>{text('上帝視角：手機','God view: mobile')}</dt><dd>{text('單指拖曳或搖桿移動視角；雙指縮放','Drag with one finger or use the stick to pan; pinch to zoom')}</dd></dl><h3>{t("如何探索")}</h3><dl className="agent-details"><dt>{t("電腦移動")}</dt><dd>{t("WASD / 方向鍵")}</dd><dt>{t("沿路行走")}</dt><dd>{t("點地面")}</dd><dt>{t("環繞鏡頭")}</dt><dd>{t("拖曳畫面")}</dd><dt>{t("拉近／拉遠")}</dt><dd>{t("滾輪或 + / −")}</dd><dt>{t("查看附近")}</dt><dd>{t("E / 點建築與角色")}</dd><dt>{t("手機移動")}</dt><dd>{t("左下搖桿")}</dd><dt>{t("手機鏡頭")}</dt><dd>{t("右側拖曳 / 雙指縮放")}</dd></dl><h3>{t("資料模式")}</h3><p>{t("實況模式讀取 IMD 公開資料。斷線時保留已知記錄，狀態標示待確認；示範模式的數字與活動都不代表真實網路。")}</p><div className="mode-switch"><button aria-pressed={mode==='live'} onClick={()=>changeMode('live')}>{t("IMD 實況")}</button><button aria-pressed={mode==='mock'} onClick={()=>changeMode('mock')}>{t("示範世界")}</button></div><h3>{t("目前的模型")}</h3><p>{t("建築與角色使用可替換的程序化模型。接下來會依參考圖製作 Tripo 模型，經 Blender 整理後逐件放入世界。")}</p><h3>{text('音樂','Music')}</h3><p className="small-note now-playing">{tune?<>{text('正在播放：','Now playing: ')}<b>{zh?tune.titleZh:tune.title}</b><br/></>:null}{text('音樂跟著市場天氣與夜色變換（開了平靜天氣就只跟夜色），和天氣聲音共用喇叭鈕。音樂以 Suno 製作。','The music follows the market weather and the night (with calm weather on, only the night), and shares the speaker button with the weather sound. Music made with Suno.')}</p><div className="source-links"><a href="https://explorer.imd.fun/" target="_blank" rel="noreferrer">IMD Explorer ↗</a><a href="https://imd-town.0xfinne.com/" target="_blank" rel="noreferrer">{t("IMD Town 參考 ↗")}</a><a href="https://imd.fun/docs/" target="_blank" rel="noreferrer">{t("IMD 官方文件 ↗")}</a></div></>}
    </div></aside></>}
    {inside&&scene.current&&<HomeInterior scene={scene.current} home={inside.home} size={inside.size} style={inside.style} preview={inside.preview} leave={!!inside.leave} auth={authState} world={world} covered={drawer!==null||inventory}
      onGone={()=>{setDoorNotice(insideNow.current?.leave??null);setInside(null);focusWorld();}} onFailed={()=>{scene.current?.resume();setInside(null);setDoorNotice('failed');}}
      onSeat={id=>{if(!agentMap.has(id))return false;choose({kind:'agent',id});return true;}}/>}
  </main></MemberContext.Provider>;
}
