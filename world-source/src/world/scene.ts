import * as THREE from 'three';
import {freeCameraPoint,freeCameraDrag,freeCameraStep,type ViewMode} from './freeCamera.ts';
export type {ViewMode} from './freeCamera.ts';
import {debugFrameMetrics,type FrameMetrics} from './frameMetrics.ts';
import {initDiagnosticStart,debugInitDiagnostics,type InitDiagnostics} from './initDiagnostics.ts';
import {benchmarkQuality} from './benchmarkQuality.ts';
import {BuildingNameLabels,type BuildingName,type NameRect} from './buildingNameLabels.ts';
import './buildingNameLabels.css';
import {ShadowCadence} from './shadowCadence.ts';
import {aimarketEntry} from './aimarketEntry.ts';
import {stickemberEntry} from './stickemberEntry.ts';
import {emberClashEntry} from './gameEntry.ts';
import {economyEntry} from './economyEntry.ts';
import {PublicHallsRuntime} from './publicHalls/runtime.ts';
import {prefetchPublicHallRoads,preparePublicHallRoads,type CivicRoadAssetManifest} from './publicHalls/civic-road-task.ts';
import {civicRoadGeometryFingerprint} from './publicHalls/civic-road-diagnostics.ts';
declare const __CIVIC_ROAD_MANIFEST__:CivicRoadAssetManifest|null;
import {MountainTourRuntime} from './mountainTour/runtime.ts';
declare const __MOUNTAIN_TOUR_PREVIEW__:boolean;
import {CivicBuildingGlow} from './publicHalls/civic-building-glow.ts';
import {createCivicMeadow,seatCivicForest} from './publicHalls/civic-meadow.ts';
import {createCivicGrades,seatCivicGradeForest} from './publicHalls/civic-grades.ts';
import {hallPlacement,nearPublicEntrance,type PublicHallId} from './publicHalls/placement.ts';
declare const __PUBLIC_HALLS_PREVIEW__:boolean;
import {copySelfieCanvas,selfieFraming,selfiePng,SELFIE_WIDTH,SELFIE_HEIGHT,type SelfieOptions} from './selfie.ts';
import {ASSET_SLOTS,replaceSlot,loadModel,queuedLoader,fromSpawn,fitHall,releaseFarModelLoads,modelLoadState} from './assets.ts';
import {HeartCore} from './heartCore.ts';
import {LANDMARKS,DISTRICTS,DISTRICT_SIGNS,FEATURED_HOMES,SPAWN,HALL,WALK_RADIUS,WALLS,VILLAGE2,FROST_TRAVEL,LONGHOUSE_SCALE,LONGHOUSE_WALLS,walkRadius,homeStyle,inBox,hash,terrainHeight,riverQuery,doorstep,lotBase,labelRise,farLabelRise,landmarkTop,type Point,type LandmarkId} from './layout.ts';
import {agentSpots,houseModelDistances,HOUSE_FOOTPRINT,HOUSE_SIZES,type Home,type HouseSize} from './households.ts';
import {prepareHouseModelReplacements,installHouseModelReplacements,discardHouseModelReplacements,type HouseBatch} from './houseModelArrival.ts';
import {HomeCollisionIndex} from './collision.ts';
import {HousePickIndex} from './housePickIndex.ts';
import {lotPoint,SHELTERS,type HomePose} from './layout.ts';
import {nearOwnDoor,doorPoint,doorLanding} from './homeEntry.ts';
import {isWorking,type Agent,type WorldState,type SourceSample} from './model.ts';
import type {Language} from './i18n.tsx';
import {ObservatoryDisplay,WEATHER_SKY} from './Observatory.ts';
import {OBSERVATORY,marketView,type Weather} from './market.ts';
import {PEPE_LABEL_RISE,PEPE_SCALE} from './pepeStatue.ts';
import {WeatherFx,weatherOverride,gentleSky} from './skin/weather.ts';
import {skyWeather} from './calmSky.ts';
import {SkyShow,FIRST_WAIT,RUSH_WAIT,brilliantSky,wholeWorldSky,worldFireworksPreview,type SkyQuote} from './skyShow.ts';
import {DecorativeLightBudget} from './decorativeLightBudget.ts';
import {DayNight,NW_PANE,NW_WARM} from './skin/daynight.ts';
import {SceneMaterialIndex} from './skin/sceneMaterialIndex.ts';
import {hourOverride} from './worldTime.ts';
import type {WorldSound} from './sound.ts';
import type {MusicPlayer} from './musicPlayer.ts';
import {goalBeacon,beaconSegments,hourLevels,stepHours,outputMeter,sparkLevel} from './metrics.ts';
import type {LampPlan} from './lamps.ts';
import type {ActivityFeed} from './happenings.ts';
import {pierInstruments,setHours,setBeacon,ForgeSparks,DoorLamps,Fireworks,plaque,BEACON_TOP,PIER,HOURS_PLAQUE,FIREWORKS_ORIGIN,type PierParts} from './skin/linkage.ts';
import {blockedAt,steerTo,steerStep,walkStep,walkBlocked,WALK_SPEED,RUN_SPEED,type Box,type Steer} from './collision.ts';
import {CABLE_SOLIDS,CABLE_LABELS,cableClick,stationsHiding,type End} from './cableCar.ts';
import {createStickEmberBuilding,hallOutside,FORGE_SPARKS,type HallStyle} from './skin/landmarks.ts';
import {frosthollow} from './skin/frost.ts';
import {canalWorks} from './skin/canal.ts';
import {shelters,loadShelters,stopLifts} from './skin/shelters.ts';
import {stopClick,stopZone} from './stopClick.ts';
import {NightGlows,EMBER_TEXELS} from './skin/embers.ts';
import {EmberBoats} from './skin/boatModel.ts';
import {AmbientBoats,RIDER_REACH} from './skin/ambientBoats.ts';
import {riderSeed} from './boatRiders.ts';
import {Rides} from './skin/rides.ts';
import {figure} from './skin/figure.ts';
import {applyPlayerAppearance,disposePlayerAppearance} from './skin/playerAppearance.ts';
import {normaliseAppearance,type PlayerAppearance} from './playerAppearance.ts';
import {withoutSelfieLabels} from './selfieLabels.ts';
import {CityActivityRuntime} from './activityNative/city-runtime.ts';
import {ForgeModelGlow} from './activityNative/forge-model-glow.ts';
import {CityRoofMechanisms} from './activityNative/city-roof-mechanisms.ts';
import {NativeActivityPreview} from './activityNative/session.ts';
declare const __NATIVE_ACTIVITY_PREVIEW__:boolean;
import type {RideView} from './boarding.ts';
import {terrainMesh,terrainShell,outskirts,groundHeight,surfaceBound,pavings,lanes,fitLaneSurface,river,bridge,quay,waterWheel,forgeYard,villageRows,forest,backdrop,terrainField,type TerrainField,type RiverHandle} from './skin/terrain.ts';
import {takeTerrain} from './skin/terrainTask.ts';
import {cottageWalls,cottageRoof,roofColor,houseMaterial,lisbonWalls,lisbonRoof,plasterColor,TERRACOTTA,HOUSE_MODELS,plasterTint,type HouseModelKey} from './skin/houses.ts';
import {bannerPost} from './skin/kit.ts';
import {pepeDecor,type PepeDecor} from './skin/pepeDecor.ts';
import {SkinAnimator} from './skin/animate.ts';
import {buildPlaza,bellSpireBase,BELL_SPIRE_POSE,PlazaAnimator,perchEmber} from './skin/plaza.ts';
import {CAMERA_FOV,PLAY_MAX_ZOOM,VILLAGE_LABELS,maxZoomFor,emberReach,worldCircle,panoWeight,panoPitch,panoLook,fogDensity,cameraClip,shadowStrength,nearLabelAlpha,farLabelAlpha,backdropAlpha,
  clampZoom,stepZoom,wheelZoom,pinchZoom,easeZoom,placeLabels,LABEL_SLOTS,fineDetailVisible,FINE_DETAIL_RADIUS,orbitPosition,visibleBand,bandFit,viewClearance,
  firstVisitGoals,frameFor,openingAt,type Circle,type PoseChannel,type Rect,type Opening,type FramePose} from './overview.ts';
import {TOUCH_LAYOUT,LANDSCAPE_PHONE,projectPoint,type ProjectionFeed,type ScreenPoint} from './screenSpace.ts';
import {LABEL_MIN_PX,TAP_TARGET,fitLabel,labelAt,labelIntent,signText,type Fit} from './labels.ts';
import {arrivalStep,landing,placeEdge} from './arrival.ts';
import {RING_MIN_PX,beaconKey,breath,ringGrow,ringMote,type Beacon} from './beacons.ts';
import {layerLabels,nearPlace,pickBox,ringBreathes,stationsCover,signAlpha,type Edges,type LayerEnv} from './labelTier.ts';
import {FROST_SIGNS} from './frostRide.ts';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

/** A cable car station ('valley': the Falls station, 'top': the Frosthollow station): a click rides it (scene.ts, not a drawer). */
export type Selection={kind:'building';id:LandmarkId}|{kind:'agent';id:string}|{kind:'observatory';id:'observatory'}|{kind:'lot';id:string}|{kind:'cable';id:'valley'|'top'}|{kind:'stop';id:string};
/** yaw: the camera's (the hint's arrows); figures: the agents drawn as figures now, where they stand (the beacons). */
export type SceneView={viewMode:ViewMode;cameraFocus:Point;freeViewAvailable:boolean;player:Point;near:Selection|null;nearDoor:boolean;fps:number;drawCalls:number;nearFigures:number;renderedSignals:number;yaw:number;figures:{id:string;x:number;z:number}[];ride:RideView};
const SE_STONE=0x8f8a7d;
/** Scratch values for the frame loop (no allocation per frame). */
const FOLLOW=new THREE.Vector3(),SKY=new THREE.Color();
const palette={stone:0x9c977e,darkStone:0x666e65,gold:0xccb875,blue:0x2f515c,ember:0xf4a151,teal:0x8ae0ca,ink:0x1f3239};
const signalColor=(a:Agent)=>a.presence!=='online'?0x637c82:isWorking(a)?0xffb568:a.runtimes.includes('claude')?0xf9b6a2:0x8ae0ca;
function material(color:number,glow=0){return new THREE.MeshStandardMaterial({color,roughness:.86,metalness:.08,emissive:glow?color:0,emissiveIntensity:glow});}
function mesh(geometry:THREE.BufferGeometry,color:number,x=0,y=0,z=0,glow=0){const m=new THREE.Mesh(geometry,material(color,glow));m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;}
function box(w:number,h:number,d:number,color:number,x=0,y=0,z=0){return mesh(new THREE.BoxGeometry(w,h,d),color,x,y,z);}
function cylinder(r:number,h:number,color:number,x=0,y=0,z=0,sides=12){return mesh(new THREE.CylinderGeometry(r,r,h,sides),color,x,y,z);}
function label(text:string,color='#e8e5c9',size=1){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=80;const ctx=canvas.getContext('2d')!;
  ctx.font='500 32px "Microsoft JhengHei", sans-serif';ctx.textAlign='center';ctx.fillStyle='rgba(24,42,48,.82)';ctx.roundRect(20,5,472,64,18);ctx.fill();ctx.fillStyle=color;ctx.fillText(text,256,49);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false}));sprite.userData.text=text;sprite.scale.set(6.4*size,1*size,1);return sprite;
}
/** A label you can click (onboarding 05, 09; labels.ts): fitted to its text (runs of [text, colour]) and drawn over the
 *  scene, untoned like the HUD, with no depth test or fog, so the label you see is the one a click reaches. Names end in
 *  a gold ›; a road sign is a flat plate framed in its district's colour. Its text is half its height (LABEL_TEXT), drawn
 *  at 32 px like the old labels (over twice the 12–13 px floor), so a label stays sharp as it grows. */
function tagLabel(runs:[string,string][],frame?:string){
  const h=64,font='600 32px "Microsoft JhengHei", sans-serif',canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;ctx.font=font;
  const widths=runs.map(([t])=>ctx.measureText(t).width),pad=frame?27:23,w=Math.ceil(widths.reduce((a,b)=>a+b,0)+pad*2);
  canvas.width=w;canvas.height=h;ctx.font=font;ctx.textBaseline='middle';ctx.beginPath();
  if(frame){ctx.roundRect(3,3,w-6,h-6,7);ctx.fillStyle='rgba(21,32,36,.94)';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle=frame;ctx.stroke();}
  else{ctx.roundRect(1,1,w-2,h-2,h/2-1);ctx.fillStyle='rgba(24,42,48,.92)';ctx.fill();}
  let x=pad;runs.forEach(([t,color],i)=>{ctx.fillStyle=color;ctx.fillText(t,x,h/2+2);x+=widths[i];});
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,fog:false,toneMapped:false,transparent:true}));sprite.renderOrder=10;
  return {sprite,aspect:w/h};
}
/** A clickable label and its layering (labelTier.ts): key, its beacon key; alpha, the opacity drawn (eased); near, within
 *  NEAR_M of its place (4 Hz); fit, laid out on screen this frame; pick, reachable by a click or a tap; behind, a cable
 *  car station stands between it and the camera. */
type Tag=Fit&{sprite:THREE.Sprite;target:Selection;sign:boolean;key:string;alpha:number;near:boolean;fit:boolean;pick:boolean;block:boolean;behind?:boolean;name?:BuildingName};
const NO_EDGES:Edges[]=[];
/** A breathing ring's scales under reduced motion (a still double ring) and every other ring's: shared, never per frame. */
const DOUBLE=[1,.64],SINGLE=[1];
/** The hover lift (onboarding 06): warm light added to lit materials, a brighter tint on unlit ones and sprites. */
const LIFT=new THREE.Color(.3,.22,.09);
const liftable=(m:THREE.Material)=>'emissive' in m||m instanceof THREE.MeshBasicMaterial||m instanceof THREE.SpriteMaterial;
function liftMaterial(m:THREE.Material){
  const c=m.clone();c.onBeforeCompile=m.onBeforeCompile;c.customProgramCacheKey=m.customProgramCacheKey;
  if('emissive' in c){const s=m as THREE.MeshStandardMaterial,d=c as THREE.MeshStandardMaterial;d.emissive.copy(s.emissive).multiplyScalar(s.emissiveIntensity).add(LIFT);d.emissiveIntensity=1;}
  else (c as THREE.MeshBasicMaterial).color.multiplyScalar(1.3);
  return c;
}
/** Panorama label: a fixed on-screen size (sizeAttenuation off, scaled per viewport in fitFarLabels), drawn over the
 *  scene. Villages are larger serif names; landmarks and "your home" use the in-world label style. */
type FarLabel={sprite:THREE.Sprite;w:number;h:number;x:number;z:number;y:number;id:string;name?:BuildingName};
function farLabel(text:string,kind:'village'|'landmark'|'home',x:number,z:number,y:number,id:string):FarLabel{
  const px=kind==='village'?19:13,font=kind==='village'?`500 ${px}px Georgia,"Noto Serif TC","PMingLiU",serif`:`500 ${px}px "Microsoft JhengHei",sans-serif`,dpr=2;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;ctx.font=font;
  const w=Math.ceil(ctx.measureText(text).width)+(kind==='village'?30:22),h=kind==='village'?32:24;
  canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.font=font;ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle=kind==='village'?'rgba(20,38,46,.78)':'rgba(24,42,48,.82)';ctx.beginPath();ctx.roundRect(1,1,w-2,h-2,h/2-1);ctx.fill();
  if(kind!=='landmark'){ctx.strokeStyle=kind==='home'?'#ffd27a':'rgba(233,217,184,.55)';ctx.lineWidth=1;ctx.stroke();}
  ctx.fillStyle=kind==='village'?'#f2e6c6':kind==='home'?'#ffe2a6':'#e8e5c9';ctx.fillText(text,w/2,h/2+1);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,sizeAttenuation:false,transparent:true}));
  sprite.renderOrder=20;sprite.visible=false;sprite.position.set(x,y,z);sprite.name='far-label-'+id;
  return {sprite,w,h,x,z,y,id};
}
/** "You are here" on the panorama, where the player is a speck: an ember map pin whose tip stands on the player.
 *  Drawn over the labels, outside their declutter (it is small, and the minimap may be hidden on phones there). */
function youPin(){
  const w=22,h=30,dpr=2,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
  ctx.beginPath();ctx.arc(w/2,10.5,8.5,Math.PI*.82,Math.PI*.18);ctx.lineTo(w/2,h-1.5);ctx.closePath();
  ctx.lineJoin='round';ctx.strokeStyle='rgba(20,38,46,.85)';ctx.lineWidth=3.5;ctx.stroke();ctx.fillStyle='#f4a151';ctx.fill();ctx.strokeStyle='#fff6e2';ctx.lineWidth=1.6;ctx.stroke();
  ctx.beginPath();ctx.arc(w/2,10.5,3.2,0,Math.PI*2);ctx.fillStyle='#fff6e2';ctx.fill();
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,sizeAttenuation:false,transparent:true}));
  sprite.center.set(.5,1.5/h);sprite.renderOrder=21;sprite.visible=false;sprite.name='you-pin';
  return {sprite,w,h};
}
/** You (onboarding 07): a teal halo under the player, always on; teal so it is never read as a beacon's gold ring. */
function youHalo(){
  // Untoned colours: a deep teal rim that holds against the bright square, over a light teal fill.
  const g=new THREE.Group(),m=(color:number,opacity:number)=>new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  const disc=new THREE.Mesh(new THREE.CircleGeometry(.8,40),m(palette.teal,.3)),ring=new THREE.Mesh(new THREE.RingGeometry(.6,.8,40),m(0x1fa98a,.95));
  for(const o of [disc,ring]){o.rotation.x=-Math.PI/2;o.renderOrder=2;g.add(o);}
  g.position.y=.08;g.name='you-halo';return g;
}
/** Beacon rings (onboarding 04, beacons.ts): one instanced mesh of flat gold rings, each with a thin mote of light rising
 *  from its middle. Per instance: aK, its brightness (the breath), and aMote, whether its mote shows. The band adds gold
 *  light over a deep gold cover and dark amber edges (premultiplied), so a ring reads on the bright square and on grass;
 *  untoned sRGB like the labels. Its matrix scales x and z by the ring's radius and y by its growth. */
const BEACON_INSTANCES=16;
function beaconRings(){
  const ring=new THREE.RingGeometry(.72,1,56,1).rotateX(-Math.PI/2),mote=new THREE.CylinderGeometry(.045,.045,2.4,6,1,true).translate(0,1.25,0);
  for(const [g,v] of [[ring,0],[mote,1]] as const)g.setAttribute('part',new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(v),1));
  const geometry=mergeGeometries([ring,mote]);ring.dispose();mote.dispose();
  for(const name of ['aK','aMote'])geometry.setAttribute(name,new THREE.InstancedBufferAttribute(new Float32Array(BEACON_INSTANCES),1).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.ShaderMaterial({uniforms:{gold:{value:new THREE.Vector3(1,.8,.4)},deep:{value:new THREE.Vector3(.86,.52,.08)},rim:{value:new THREE.Vector3(.42,.26,.06)}},transparent:true,depthWrite:false,
    blending:THREE.CustomBlending,blendSrc:THREE.OneFactor,blendDst:THREE.OneMinusSrcAlphaFactor,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,
    vertexShader:`attribute float part,aK,aMote;varying float vK,vPart,vR,vH;
      void main(){vK=aK;vPart=part;vR=length(position.xz);vH=position.y;if(part>.5&&aMote<.5){gl_Position=vec4(2.,2.,2.,1.);return;}gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform vec3 gold,deep,rim;varying float vK,vPart,vR,vH;
      void main(){if(vPart>.5){gl_FragColor=vec4(gold*vK*(1.-smoothstep(.1,2.6,vH)),0.);return;}
        float t=clamp((vR-.72)/.28,0.,1.),band=smoothstep(0.,.45,t)*(1.-smoothstep(.55,1.,t)),edge=(1.-band)*.6*vK,cover=band*.7*vK;
        gl_FragColor=vec4(gold*band*vK*.55+deep*cover+rim*edge,edge+cover);}`});
  const mesh=new THREE.InstancedMesh(geometry,material,BEACON_INSTANCES);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.count=0;mesh.frustumCulled=false;mesh.renderOrder=3;mesh.visible=false;mesh.name='beacon-rings';
  return mesh;
}
/** The hall's footprint as an unrotated box (the camera tilt and roof toggle inside it). */
const HALL_BOX={...HALL,rotation:0};
/** Screen corners (NDC) of the view, for the minimap's footprint of the ground the camera sees. */
const FRUSTUM_CORNERS=[[-1,-1],[1,-1],[1,1],[-1,1]] as const;
type Figure=ReturnType<typeof figure>;
export class WorldScene {
  private initStartedAt=initDiagnosticStart(location.search,import.meta.env.DEV);private initDiagnostics?:InitDiagnostics;
  private renderer:THREE.WebGLRenderer;private scene=new THREE.Scene();private camera=new THREE.PerspectiveCamera(CAMERA_FOV,1,.1,1600);
  private player=figure(palette.ember);private keys=new Set<string>();private stick={x:0,z:0};private target:Steer|null=null;
  private yaw=.35;private pitch=.69;private zoom=29;private cameraTarget=new THREE.Vector3(SPAWN.x,1,SPAWN.z);
  private cameraMode:ViewMode='person';
  private personView:{yaw:number;pitch:number;viewPitch:number;zoom:number;zoomGoal:number|null;lead:Point;framed:boolean;target:THREE.Vector3}|null=null;
  private frozenPerson:{position:THREE.Vector3;rotation:THREE.Euler}|null=null;
  private frame=0;private last=performance.now();private publishAt=0;private frames=0;private fpsAt=performance.now();private fps=0;
  private startedAt=performance.now();private slowSamples=0;private frameMetrics?:FrameMetrics;private benchmarkQuality=benchmarkQuality(location);
  private nameLabels!:BuildingNameLabels;private nameReserved:NameRect[]=[];
  private shadowCadence=new ShadowCadence();private shadowUpdates=0;private civicFillRoots:readonly (THREE.Object3D|undefined)[]=[];
  private resize:ResizeObserver;private held=false;private world?:WorldState;private homes:readonly Home[]=[];
  private agents=new Map<string,Agent>();private positions=new Map<string,Point>();private facing=new Map<string,number>();private homeBoxes:Box[]=[];private homeIndex=new HomeCollisionIndex(this.homeBoxes);private housePickIndex=new HousePickIndex();private bound=WALK_RADIUS;private nearby=new Map<string,Figure>();
  private houseSets:HouseBatch[]=[];private houseModels=new Map<HouseModelKey,{geometry:THREE.BufferGeometry;material:THREE.Material;stretchY:number}>();private signals?:THREE.Points;private signalIds:string[]=[];
  private nativeActivity:NativeActivityPreview|null=null;
  private publicHalls:PublicHallsRuntime|null=null;
  private mountainTour:MountainTourRuntime|null=null;
  private buildingNamesShown=true;
  private firstFrameDrawn=false;
  private readonly debugModelLoads=new URLSearchParams(location.search).get('debug')==='1';private modelBatchKey='';
  private civicBuildingGlow=new CivicBuildingGlow();private decorativeLights:DecorativeLightBudget;
  private cityActivity:CityActivityRuntime|null=null;
  private forgeModelGlow:ForgeModelGlow|null=null;
  private cityRoofMechanisms:CityRoofMechanisms|null=null;
  private nativeHidden=new Map<Figure,boolean>();
  // Hall roof: the chosen closed roof + light column is the default; ?hall=atrium still shows the alternative sample.
  private hallStyle:HallStyle=new URLSearchParams(location.search).get('hall')==='atrium'?'atrium':'closed';
  private near:Selection|null=null;private selected:Selection|null=null;private hover:Selection|null=null;
  private water:RiverHandle;private hallRoof:THREE.Object3D[]=[];private hallShell?:THREE.Object3D;private hallVisual?:THREE.Object3D;private hallModel?:THREE.Object3D;private myHome?:THREE.Group;private lotMarkers?:THREE.InstancedMesh;private lots:HomePose[]=[];private viewPitch=.69;private glow:THREE.Mesh;private buildingRoots=new Map<LandmarkId,THREE.Group>();private labels:THREE.Sprite[]=[];
  private heartCore:HeartCore;private skin:SkinAnimator;private plaza:PlazaAnimator;
  private pointers=new Map<number,{x:number;y:number;startX:number;startY:number;button:number;dragged:boolean;gesture:boolean}>();private pinch=0;
  private cleanups:(()=>void)[]=[];private mobile=matchMedia(TOUCH_LAYOUT).matches;private reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  private observatory=new ObservatoryDisplay();private sun=new THREE.DirectionalLight(0xffdeb0,3);private hemi=new THREE.HemisphereLight(0xe9f1db,0x314955,2.9);
  // Whole-world panorama (overview.ts): zoom range, the circle it frames, far labels, the snow ranges past the terrain.
  private maxZoom=PLAY_MAX_ZOOM;private ember=WALK_RADIUS;private circle:Circle=worldCircle();private outskirts:THREE.Mesh;
  private farLabels:FarLabel[]=[];private homeLabel?:FarLabel;private homeName?:BuildingName;private language:Language='zh';private viewHeight=1;private viewWidth=1;
  private clip={near:.1,far:1600};private shadowK=1;private farAlpha=0;private look=new THREE.Vector3();
  private corner=new THREE.Vector3();private fineShown=true;
  // The on-screen band of the canvas (short landscape pages keep a 480 px minimum height), and how far the
  // panorama's view shifts to centre the world in it (bandFit); viewShift is the offset currently applied.
  private band={top:0,bottom:1};private bandShift=0;private viewShift=0;
  // Button/key/wheel zooms glide to zoomGoal (easeZoom); pinch and the focus functions set the zoom at once.
  private zoomGoal:number|null=null;
  private backdrop?:THREE.Group;private backdropMaterials:THREE.Material[]=[];private backdropK=1;
  private pin=youPin();private lastFar=-Infinity;
  private clearKey=new Float64Array(6).fill(NaN);private clearNow=new Float64Array(6);private clearValue=0;
  private ground:(x:number,z:number)=>number=groundHeight;   // upper bound of the drawn ground (surfaceBound), set with the terrain
  // Rain, haze, ripples and wet ground (skin/weather.ts); ?weather= forces a tier in DEV or with ?debug=1.
  // Tripo models' night glows by texel colour (skin/embers.ts) and the Ember boats (skin/boatModel.ts, one InstancedMesh).
  private glows=new NightGlows();private boats!:EmberBoats;private sail!:AmbientBoats;private ride!:Rides;private dragAt=-Infinity;private rideFloor=0;
  private weather:Weather='unknown';private rain:WeatherFx;private skyNow=new THREE.Color(0x657f88);private skyKnown=false;private forced=weatherOverride(location.search,import.meta.env.DEV);private ears:WorldSound|null=null;private tune:MusicPlayer|null=null;
  // World time (UTC, skin/daynight.ts) over the weather: sunLevel is the weather's eased sun; ?hour=HH previews an hour.
  private daynight:DayNight;private sunLevel=WEATHER_SKY.unknown.sun;
  // IMD linkage (skin/linkage.ts): the pier's goal beacon and hour lamps, forge sparks, hillside door lamps, milestone
  // fireworks; the 1h mood adds showers and wind, and a fresh 1h OR 24h gain >=10% sends up three reusable waves while
  // the world is uncovered, above the square and seven important building areas. At >=20%, the same bounded show
  // also visits Frosthollow and comes around sooner (skyShow.ts).
  private pier:PierParts;private sparks:ForgeSparks;private doorLamps=new DoorLamps();private fireworks:Fireworks;
  private skyShow:SkyShow;private uncovered=false;private slow=false;private skyBursts=0;
  private skyQuote:SkyQuote|null=null;private worldSkyPreview=false;
  private mood={rain:0,wind:0};private plaques:THREE.Sprite[]=[];private lastPlan:LampPlan|null=null;
  private pepeDecor!:PepeDecor;
  private halo=youHalo();private head=new THREE.Vector3();
  /** The cable car's reduced-motion ride is a short fade (cableCar.ts cableFade): a dark sheet over the canvas. */
  private fadeEl=(()=>{const d=document.createElement('div');d.className='ride-fade';d.style.cssText='position:absolute;inset:0;background:#0d1a1f;opacity:0;pointer-events:none';return d;})();private fadeK=0;
  // Labels you can click (labels.ts), and hover and tap feedback (onboarding 05, 06, 09): the mouse's last point over the
  // canvas, what it is over, a tap's 250 ms flash, and the lift currently applied (restored when it moves on).
  private tags:Tag[]=[];private mouse:{x:number;y:number}|null=null;private hoverKey=new Float64Array(18).fill(NaN);private hoverAt=0;private cursor='';
  private hoverHit:{selection:Selection;house:boolean;travel:boolean}|null=null;private flashing:{selection:Selection;house:boolean}|null=null;private flashTimer=0;
  private lifted:{key:string;roots:THREE.Object3D[];mats:[THREE.Mesh|THREE.Sprite,THREE.Material|THREE.Material[],THREE.Material[]][];cols:[THREE.InstancedMesh,number,THREE.Color][];shown:THREE.Object3D[]}|null=null;
  /** The stops' shelters (one InstancedMesh, layout.ts SHELTERS order) and their decks' lift sheets (skin/shelters.ts
   *  stopLifts), which a click on a stop reaches; boardAt: a click's boarding, taken once you stand at the stop (performance.now() deadline, 0: none). */
  private stopShelters!:THREE.InstancedMesh;private stopDecks!:THREE.Group;private boardAt=0;
  // An explicit travel waiting for the camera to settle (onArrive, arrival.ts), how far the view's pitch still has to ease,
  // and a travel under reduced motion: the next frame cuts to the new view instead of gliding.
  private arrival:{done:()=>void;at:Point;since:number}|null=null;private pitchGap=0;private cut=false;
  // A first visit's opening frame (onboarding 03, overview.ts frameFor): the follow looks `lead` metres off the player
  // while framed; the first move, drag, zoom or key eases it back to the play camera (opening), and a walk to a place
  // (walkTo) waits for its tap walk to end there.
  private lead={x:0,z:0};private framed=false;private opening:(Opening&{since:number})|null=null;private approach:{steer:Steer;done:()=>void;lost:()=>void}|null=null;
  // Beacons (onboarding 04, beacons.ts): the rings to draw (their ground heights), the targets whose sprite label their DOM
  // tag stands in for, and a scratch point for inFrame.
  private beaconMesh=beaconRings();private beaconList:(Beacon&{ys:number[]})[]=[];private beaconed=new Set<string>();private probe:ScreenPoint={id:'',x:0,y:0,depth:0,onScreen:false,behind:false};private dummy=new THREE.Object3D();
  /** onSelect: open the drawer for a selection, or (travel) go there first and open it on arrival (the app decides how). */
  constructor(private host:HTMLElement,private onSelect:(selection:Selection,travel?:boolean)=>void,private onView:(view:SceneView)=>void,private pose?:PoseChannel,private screen?:ProjectionFeed){
    this.initDiagnostics=debugInitDiagnostics(host,this.initStartedAt);this.cleanups.push(()=>{this.initDiagnostics?.dispose();try{delete host.dataset.civicRoadCache;delete host.dataset.civicRoadInput;delete host.dataset.civicRoadGeometry;}catch{/* optional local diagnostic */}});
    const localRoadFallback=this.initDiagnostics&&this.benchmarkQuality&&new URLSearchParams(location.search).get('road_cache')==='off';
    if(typeof __PUBLIC_HALLS_PREVIEW__!=='undefined'&&__PUBLIC_HALLS_PREVIEW__)prefetchPublicHallRoads(this.mobile,localRoadFallback||typeof __CIVIC_ROAD_MANIFEST__==='undefined'?null:__CIVIC_ROAD_MANIFEST__);
    this.decorativeLights=new DecorativeLightBudget(this.scene,this.mobile?4:6);this.cleanups.push(()=>this.decorativeLights.dispose());
    this.renderer=new THREE.WebGLRenderer({antialias:!this.mobile,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(this.benchmarkQuality?.pixelRatio??Math.min(devicePixelRatio,this.mobile?1.25:1.5));this.renderer.shadowMap.enabled=this.benchmarkQuality?.shadows??!this.mobile;
    this.renderer.shadowMap.autoUpdate=false;
    this.renderer.shadowMap.type=THREE.BasicShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.3;
    const canvas=this.renderer.domElement;canvas.tabIndex=0;canvas.setAttribute('aria-label','IMD Ember World 可探索的 3D 世界');host.appendChild(canvas);
    canvas.dataset.qualityProfile=this.benchmarkQuality?.name??'adaptive';
    this.frameMetrics=debugFrameMetrics(this.renderer);this.cleanups.push(()=>this.frameMetrics?.dispose());
    this.nameLabels=new BuildingNameLabels(host);this.cleanups.push(()=>this.nameLabels.dispose());
    this.camera.layers.enable(1);   // fine detail (tagFineDetail) is drawn at play distance
    this.scene.background=new THREE.Color(0x657f88);this.scene.fog=new THREE.FogExp2(0x657f88,.006);
    this.scene.add(this.hemi);
    const sun=this.sun;sun.position.set(-40,65,25);sun.castShadow=this.benchmarkQuality?.shadows??!this.mobile;
    sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-45;sun.shadow.camera.right=45;sun.shadow.camera.top=45;sun.shadow.camera.bottom=-45;sun.shadow.bias=-.0007;this.scene.add(sun);
    // StickEmber skin, map revision v001 "Emberford" (燼渡): a river-valley village. Shapes live in layout.ts, meshes in skin/terrain.ts.
    this.water=river();
    // The terrain's field comes from the build's baked file on a phone (downloading since boot) or is worked out at the
    // end of this constructor (skin/terrainTask.ts); its two meshes are made here, in their old place (object and material
    // ids keep the renderer's draw order), and filled once it is there, below.
    const shell=terrainShell();this.outskirts=shell.outskirts;
    const paving=pavings(),laneSurface=lanes();
    this.scene.add(shell.terrain,this.outskirts,paving,laneSurface,this.water.root,bridge(),quay(),waterWheel(),villageRows(),frosthollow(this.water.flow),canalWorks(),forgeYard());   // the forge's yard (2026-10-01) after these: their ids as they were, all built later in the same order
    // The stops' shelters (2026-10-02) after the yard, the Tripo shelter in place of their stand-in once it loads.
    const stopShelters=shelters();this.stopShelters=stopShelters.getObjectByName('stop-shelters') as THREE.InstancedMesh;this.stopDecks=stopLifts();this.scene.add(stopShelters,this.stopDecks);this.cleanups.push(loadShelters(stopShelters,ASSET_SLOTS.find(s=>s.id==='boat-shelter')!,this.glows,queuedLoader(Math.min(...SHELTERS.map(s=>Math.hypot(s.x-SPAWN.x,s.z-SPAWN.z))))));
    // The square after the Cluj mix (keeper on horseback, memory windows, pools, trees) and the Ember Belfry (skin/plaza.ts).
    const plaza=buildPlaza();this.scene.add(plaza.root);
    // Pepe in the town: street-lamp banners, gonfalons, murals, posters and shop signs (skin/pepeDecor.ts, pepeDecor.ts).
    this.pepeDecor=pepeDecor(this.mobile);this.scene.add(this.pepeDecor.root);this.cleanups.push(()=>this.pepeDecor.dispose());
    // Frosthollow's name over the longhouse, 2.2 m over its ridge as it grew (layout.ts LONGHOUSE_WALLS.ridge live, skin/frost.ts).
    const lh=WALLS.find(w=>w.id==='v2-longhouse')!,frost=label(VILLAGE2.en,'#dfe9ee',.8);frost.name='frost-label';frost.position.set(lh.x,terrainHeight(lh.x,lh.z)+11+LONGHOUSE_WALLS.ridge*(LONGHOUSE_SCALE-1),lh.z);this.scene.add(frost);this.labels.push(frost);
    for(const d of DISTRICTS){const p=DISTRICT_SIGNS[d.id],post=bannerPost(3.2,p.x,p.z,Math.atan2(SPAWN.x-p.x,SPAWN.z-p.z));post.position.y=terrainHeight(p.x,p.z);this.scene.add(post);}   // road signs: buildTags
    this.heartCore=new HeartCore(ASSET_SLOTS.find(s=>s.id==='heart-core')!,palette);
    this.cleanups.push(()=>this.heartCore.dispose());
    for(const landmark of LANDMARKS){
      const parent=new THREE.Group();parent.position.set(landmark.x,terrainHeight(landmark.x,landmark.z),landmark.z);const visual=createStickEmberBuilding(landmark.id,this.heartCore.pivot,this.hallStyle);visual.rotation.y=landmark.rotation*Math.PI/180;parent.add(visual);
      this.scene.add(parent);this.buildingRoots.set(landmark.id,parent);if(landmark.id==='heart'){this.hallRoof=(this.hallStyle==='atrium'?['hall-facade-top']:['hall-roof','hall-facade-top']).map(n=>visual.getObjectByName(n)!);this.hallShell=visual.getObjectByName('hall-shell')!;this.hallVisual=visual;hallOutside(visual,false);if(this.hallStyle==='closed')this.loadHallModel(visual);}
      if(landmark.id!=='heart'){
        const stop=replaceSlot(parent,visual,ASSET_SLOTS.find(s=>s.id===landmark.id)!,landmark.id==='forge'?{onLoaded:model=>{
          this.forgeModelGlow?.dispose();this.forgeModelGlow=new ForgeModelGlow(model);
          this.forgeModelGlow.setActive(this.cityActivity?.active?this.cityActivity.store.getSnapshot().civic.get('forge')?.active??null:null);
        }}:{});
        this.cleanups.push(()=>{if(landmark.id==='forge'){this.forgeModelGlow?.dispose();this.forgeModelGlow=null;}stop();});
      }
    }
    this.decorate();
    this.pier=pierInstruments();this.buildingRoots.get('launch')!.getObjectByName('launch-pier')!.add(this.pier.group);   // the pier's own frame (skin/landmarks.ts launch)
    // Sparks rise from the forge's taller chimney (the forge visual's own frame, which the Tripo model is fitted into).
    this.sparks=new ForgeSparks(new THREE.Vector3(FORGE_SPARKS.x,FORGE_SPARKS.y,FORGE_SPARKS.z),this.mobile?28:60);this.buildingRoots.get('forge')!.getObjectByName('landmark-forge-visual')!.add(this.sparks.points);
    this.fireworks=new Fireworks(new THREE.Vector3(FIREWORKS_ORIGIN.x,FIREWORKS_ORIGIN.y,FIREWORKS_ORIGIN.z),this.mobile?4:6,this.mobile?40:64);
    this.scene.add(this.doorLamps.group,this.fireworks.points);this.buildPlaques();
    this.worldSkyPreview=worldFireworksPreview(location.search,import.meta.env.DEV);
    this.skyShow=new SkyShow(Math.random,this.forced.fireworks||this.worldSkyPreview?RUSH_WAIT:FIRST_WAIT);
    // Village buildings with Tripo models (fit mode): mounted by object name, fall back to the procedural build.
    const mounts:THREE.Object3D[]=[];this.scene.traverse(o=>{if(['triumphal-arch','frost-longhouse','frost-mill','frost-house','equestrian-mount','bell-spire','boat-lift'].includes(o.name))mounts.push(o);});
    for(const o of mounts){const slot=ASSET_SLOTS.find(s=>s.id===o.name);if(slot)this.cleanups.push(replaceSlot(o as THREE.Group,o as THREE.Group,slot,o.name==='equestrian-mount'?{onLoaded:m=>{perchEmber(m);}}:o.name==='boat-lift'?{onLoaded:m=>{this.glows.add(m,EMBER_TEXELS,'ember');}}:{}));}
    // The boats' model queues at the river's distance from SPAWN: the ambient boats sail past the quay below the square.
    this.boats=new EmberBoats(ASSET_SLOTS.find(s=>s.id==='ember-boat')!,this.glows,queuedLoader(riverQuery(SPAWN.x,SPAWN.z).d));this.scene.add(this.boats.mesh);this.cleanups.push(()=>this.boats.dispose());
    // The ambient boats' riders (boatRiders.ts): per browser, drawn with the figures below, never an agent drawn nearby.
    this.sail=new AmbientBoats(this.boats,this.scene,riderSeed(),id=>{const a=this.agents.get(id);return figure(a?signalColor(a):palette.ember);},f=>this.disposeFigure(f));this.cleanups.push(()=>this.sail.dispose());this.ride=new Rides(this.boats,this.glows,this.player,!(typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__));this.scene.add(this.ride.frost.group,this.ride.cable.group);this.cleanups.push(()=>this.ride.dispose());
    this.ride.cable.blocked=p=>walkBlocked(this.homeBoxes,this.bound,false,this.homeIndex)(p);   // the cable car never sets you down on a blocked door
    host.appendChild(this.fadeEl);this.cleanups.push(()=>this.fadeEl.remove());
    for(const o of [this.observatory.root,this.observatory.pepe])o.position.y=terrainHeight(o.position.x,o.position.z);
    this.scene.add(this.observatory.root,this.observatory.pepe);
    this.skin=new SkinAnimator(this.scene,this.water);this.skin.hulls=()=>this.boats.hulls();this.plaza=new PlazaAnimator(this.scene,this.skin,plaza.handles);
    if(import.meta.env.DEV)void import('./skin/devCapture.ts').then(m=>{if(this.disposed)return;m.setLiveRig(this as unknown as Parameters<typeof m.setLiveRig>[0]);m.installCapture();});
    this.buildTags();this.buildStopNames();
    {const q=lotPoint(BELL_SPIRE_POSE,4.2,2.5),spire=label('Ember Belfry','#f1d9a8',.8);spire.name='spire-label';spire.position.set(q.x,bellSpireBase().floor+11,q.z);   // beside the belfry, clear of the tower face
    this.scene.add(spire);this.labels.push(spire);}
    this.buildFarLabels();this.scene.add(this.pin.sprite);
    const materialIndex=new SceneMaterialIndex(this.scene);this.cleanups.push(()=>materialIndex.dispose());
    this.rain=new WeatherFx(this.scene,this.mobile||matchMedia('(pointer: coarse)').matches,this.reduced,materialIndex);if(this.forced.lightning)this.rain.strikeSoon(2);   // phones' budget (landscape ones too); ?lightning=now (DEV / ?debug=1)
    this.daynight=new DayNight(this.scene,this.sun,materialIndex);this.daynight.preview=hourOverride(location.search,import.meta.env.DEV);this.plaza.worldMs=()=>this.daynight.now||Date.now();
    this.glow=mesh(new THREE.TorusGeometry(1.2,.055,5,40),palette.gold,0,.15,0,.4);this.glow.rotation.x=-Math.PI/2;this.glow.visible=false;this.scene.add(this.glow,this.beaconMesh);
    this.player.root.position.set(SPAWN.x,terrainHeight(SPAWN.x,SPAWN.z),SPAWN.z);this.cameraTarget.y=this.player.root.position.y+1;this.player.root.add(this.halo);this.scene.add(this.player.root);
    this.scene.add(sun.target);
    this.resize=new ResizeObserver(()=>this.size());this.resize.observe(host);this.size();
    const listen=(target:EventTarget,type:string,fn:EventListener,options?:AddEventListenerOptions)=>{target.addEventListener(type,fn,options);this.cleanups.push(()=>target.removeEventListener(type,fn,options));};
    const previewHost=host.closest<HTMLElement>('[data-activity-native-preview="simulated"]');
    if(typeof __NATIVE_ACTIVITY_PREVIEW__!=='undefined'&&__NATIVE_ACTIVITY_PREVIEW__&&previewHost){
      this.nativeActivity=new NativeActivityPreview({wrapper:previewHost,scene:this.scene,ambient:this.daynight.windowGlow.uWindowGlow,
        focusHome:home=>{this.focusHome(home);this.pitch=.9;this.zoom=16;this.yaw=home.rotation+1;},
        focusHeart:()=>this.focusBuilding('heart',true),onResidentsChanged:()=>this.refreshNativeRiderPool()});
      this.cleanups.push(()=>{this.nativeActivity?.dispose();this.nativeActivity=null;this.nativeHidden.clear();});
      const motion=matchMedia('(prefers-reduced-motion: reduce)');
      listen(motion,'change',(()=>{this.reduced=motion.matches;}) as EventListener);
    }
    if(!previewHost&&new URLSearchParams(location.search).get('activity')!=='off'){
      this.cityActivity=new CityActivityRuntime({scene:this.scene,ambient:this.daynight.windowGlow.uWindowGlow,
        onManagedChanged:()=>this.refreshNativeRiderPool()});
      this.cityRoofMechanisms=new CityRoofMechanisms(this.scene);
      this.cleanups.unshift(()=>{this.cityRoofMechanisms?.dispose();this.cityRoofMechanisms=null;});
      this.cleanups.push(()=>{this.cityActivity?.dispose();this.cityActivity=null;});
      const motion=matchMedia('(prefers-reduced-motion: reduce)');
      listen(motion,'change',(()=>{this.reduced=motion.matches;}) as EventListener);
      listen(document,'visibilitychange',(()=>{this.updateCityActivity(performance.now(),Date.now(),document.hidden);}) as EventListener);
    }
    // The window can change height (or the page scroll) without the canvas resizing: re-measure the on-screen band.
    listen(window,'resize',()=>this.measureBand());listen(window,'scroll',()=>this.measureBand(),{passive:true});
    listen(window,'keydown',this.keydown as EventListener);listen(window,'keyup',this.keyup as EventListener);listen(window,'blur',()=>this.clearInput());
    listen(document,'visibilitychange',()=>{this.clearInput();this.last=performance.now();});
    listen(canvas,'pointerdown',this.down as EventListener);listen(canvas,'pointermove',this.move as EventListener);listen(canvas,'pointerup',this.up as EventListener);listen(canvas,'pointercancel',this.cancel as EventListener);
    listen(canvas,'pointerleave',(e=>{if((e as PointerEvent).pointerType==='mouse')this.mouse=null;}) as EventListener);   // onto the HUD or out of the window
    listen(canvas,'wheel',((e:WheelEvent)=>{if(this.paused)return;e.preventDefault();this.unframe('zoom');this.easeZoomTo(wheelZoom(this.zoomGoal??this.zoom,e.deltaY,e.deltaMode,this.maxZoom));}) as EventListener,{passive:false});
    listen(canvas,'contextmenu',e=>e.preventDefault());
    // The first frame waits for the terrain (skin/terrainTask.ts): the same ground, so the same first view as always. A
    // failure filling it in (a field that does not fit the grid, memory) is tried once more with the field worked out
    // here, then reported like a failed constructor (onError: WorldApp's scene error), never left as a blank canvas.
    const fill=async(field:TerrainField)=>{
      if(this.disposed)return;
      this.initDiagnostics?.end('terrainWait',terrainWaitAt);terrainWaitAt=undefined;const fillAt=this.initDiagnostics?.begin('fill'),meadowAt=this.initDiagnostics?.begin('meadow');
      const meadow=typeof __PUBLIC_HALLS_PREVIEW__!=='undefined'&&__PUBLIC_HALLS_PREVIEW__?createCivicMeadow(field):null;
      this.initDiagnostics?.end('meadow',meadowAt);const gradesAt=this.initDiagnostics?.begin('grades');
      const grades=meadow?createCivicGrades(meadow.field):null,renderField=grades?.field??meadow?.field??field;
      this.initDiagnostics?.end('grades',gradesAt);
      const civicGround=(p:Point,original:number)=>grades?.groundAt(p,meadow?.groundAt(p,original)??original)??meadow?.groundAt(p,original)??original;
      const terrainLaneAt=this.initDiagnostics?.begin('terrainLaneFit');
      const terrain=terrainMesh(this.mobile,renderField,shell.terrain);fitLaneSurface(laneSurface,renderField);outskirts(terrain,shell.outskirts);this.ground=surfaceBound(terrain);
      this.initDiagnostics?.end('terrainLaneFit',terrainLaneAt);
      if(this.initDiagnostics){const laneMeshes=laneSurface.children.filter((o):o is THREE.Mesh=>o instanceof THREE.Mesh);this.initDiagnostics.setWorkload({mobile:this.mobile,inputSeg:field.seg,renderSeg:renderField.seg,inputHeightValues:field.heights.length,renderHeightValues:renderField.heights.length,renderColorValues:renderField.colors.length,terrainVertices:terrain.geometry.getAttribute('position').count,terrainNormals:terrain.geometry.getAttribute('normal').count,laneMeshCount:laneMeshes.length,laneVertices:laneMeshes.reduce((n,m)=>n+m.geometry.getAttribute('position').count,0),laneIndices:laneMeshes.reduce((n,m)=>n+(m.geometry.index?.count??0),0)});}
      const forestAt=this.initDiagnostics?.begin('forestSeating');
      if(meadow)this.cleanups.unshift(seatCivicForest(this.scene,field,meadow.field));
      if(grades&&meadow)this.cleanups.unshift(seatCivicGradeForest(this.scene,meadow.field,grades.field));
      this.initDiagnostics?.end('forestSeating',forestAt);const publicHallsAt=this.initDiagnostics?.begin('wholePublicHalls');
      if(typeof __PUBLIC_HALLS_PREVIEW__!=='undefined'&&__PUBLIC_HALLS_PREVIEW__&&!this.publicHalls){
        const mountainLayout=typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__;
        const traceRoads=!!this.initDiagnostics&&new URLSearchParams(location.search).get('road_debug')==='1';
        const preparedRoads=await preparePublicHallRoads({scene:this.scene,field:renderField,omitEcosystem:mountainLayout,launchpadAtFormerEcosystem:mountainLayout,debugInputs:traceRoads?trace=>{try{host.dataset.civicRoadInput=JSON.stringify(trace);}catch{/* optional public-input diagnostic */}}:undefined});
        if(this.disposed){preparedRoads.disposeUnused();return;}
        try{this.publicHalls=new PublicHallsRuntime({scene:this.scene,camera:this.camera,host,preparedRoads,buildingNames:this.nameLabels,onResearch:this.openResearch,onLibrary:this.openLibrary,onGame:this.openGame,onEconomy:this.openEconomy,observer:()=>this.cameraMode==='god',observeHall:id=>this.observePublicHall(id),field:renderField,player:()=>({x:this.player.root.position.x,z:this.player.root.position.z}),terrainOverride:civicGround,nightGlow:()=>this.daynight.glow,lightBudget:this.decorativeLights,reducedMotion:()=>this.reduced,launchpadAtFormerEcosystem:mountainLayout,omitEcosystem:mountainLayout,
          retiredNativeCable:typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__,
          blocked:p=>this.publicHallBaseBlocked(p),pauseChanged:()=>{this.target=this.approach=null;this.arrival=null;this.clearInput();},
          peek:id=>this.peekPublicHall(id),jump:(id,p)=>this.jumpPublicHall(id,p),walk:(p,done,lost)=>this.walkTo(p,done,lost,true),cancelWalk:()=>{this.target=this.approach=null;this.arrival=null;},viewZoom:()=>this.zoom,viewFocus:()=>this.cameraTarget});}finally{preparedRoads.disposeUnused();}
        if(this.initDiagnostics)try{host.dataset.civicRoadCache=JSON.stringify({profile:renderField.seg,status:preparedRoads.cacheStatus,inputSha256:preparedRoads.inputSha256});}catch{/* diagnostics cannot prevent readiness */}
        if(traceRoads){const road=this.publicHalls.root.getObjectByName('public-hall-branch-paths');if(road instanceof THREE.Mesh)void civicRoadGeometryFingerprint(road.geometry).then(snapshot=>{if(!this.disposed)try{host.dataset.civicRoadGeometry=JSON.stringify(snapshot);}catch{/* optional geometry diagnostic */}}).catch(()=>{/* optional geometry diagnostic */});}
        this.publicHalls.setLanguage(this.language);this.publicHalls.setBuildingNamesVisible(this.buildingNamesShown);this.cleanups.unshift(()=>{this.publicHalls?.dispose();this.publicHalls=null;});
      }
      this.initDiagnostics?.end('wholePublicHalls',publicHallsAt);const mountainAt=this.initDiagnostics?.begin('mountainTour');
      if(typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__&&!this.mountainTour){
        this.mountainTour=new MountainTourRuntime({scene:this.scene,camera:this.camera,host,buildingNames:this.nameLabels,onResearch:this.openResearch,observer:()=>this.cameraMode==='god',field:renderField,player:this.player.root,nativeBusy:()=>this.ride.busy,aimarketRelocated:true,
          solid:p=>blockedAt(p,this.homeBoxes,'all',this.homeIndex)!==null,bound:()=>this.bound,place:p=>this.place(p),clear:()=>{this.target=this.approach=null;this.clearInput();},
          focus:(p,zoom,yaw)=>{if(this.cameraMode==='god'){this.focusGodCamera(p,zoom,yaw);return;}const hero=this.player.root.position;this.lead={x:p.x-hero.x,z:p.z-hero.z};this.framed=true;this.opening=null;this.zoom=zoom;this.zoomGoal=null;this.pitch=this.viewPitch=.7;this.yaw=yaw??(zoom>150?.8:-.5);this.cameraTarget.set(p.x,this.mountainTour?.groundAt(p,terrainHeight(p.x,p.z))??terrainHeight(p.x,p.z),p.z);this.cut=true;},
          zoom:()=>this.zoom,reduced:()=>this.reduced,night:()=>this.daynight.glow,lightBudget:this.decorativeLights,nativeStations:this.ride.cable.stations,viewFocus:()=>this.cameraTarget,publicGround:(p,original)=>this.publicHalls?.groundAt(p,original)??original});
        this.mountainTour.setLanguage(this.language);this.mountainTour.setBuildingNamesVisible(this.buildingNamesShown);this.cleanups.unshift(()=>{this.mountainTour?.dispose();this.mountainTour=null;});
      }
      this.initDiagnostics?.end('mountainTour',mountainAt);
      this.cleanups.unshift(()=>this.civicBuildingGlow.dispose());
      this.civicFillRoots=[...this.buildingRoots.values(),this.scene.getObjectByName('bell-spire'),this.scene.getObjectByName('triumphal-arch'),...['dream','ecosystem','stickember','launchpad','aimarket','fortune','hive','staking','pepe2pepe'].map(id=>this.publicHalls?.root.getObjectByName('public-hall-base-'+id))];
      this.terrainReady=true;if(!this.suspended)this.frame=requestAnimationFrame(this.animate);
      this.initDiagnostics?.end('fill',fillAt);this.initDiagnostics?.mark('ready');
    };
    this.initDiagnostics?.end('constructor',this.initStartedAt);let terrainWaitAt=this.initDiagnostics?.begin('terrainWait');
    void takeTerrain(this.mobile).then(fill).catch(()=>{this.initDiagnostics?.failedAttempt();terrainWaitAt=undefined;const fallbackAt=this.initDiagnostics?.begin('fallbackFieldCompute'),field=terrainField(this.mobile);this.initDiagnostics?.end('fallbackFieldCompute',fallbackAt);return fill(field);}).catch(()=>{this.initDiagnostics?.failedAttempt();if(!this.disposed)this.onError?.();});
  }
  /** Called once if the scene cannot be finished after its constructor returned (the terrain could not be filled in). */
  onError?:()=>void;onReady?:()=>void;onResearch?:()=>void;onLibrary?:()=>void;onGame?:()=>void;onEconomy?:()=>void;
  private openResearch=()=>{if(this.onResearch)this.onResearch();else window.location.assign(aimarketEntry(this.language));};
  private openLibrary=()=>{if(this.onLibrary)this.onLibrary();else window.location.assign(stickemberEntry(this.language));};
  private openEconomy=()=>{if(this.onEconomy)this.onEconomy();else window.location.assign(economyEntry(this.language));};
  private openGame=()=>{if(this.onGame)this.onGame();else window.location.assign(emberClashEntry(this.language));};
  /** False until the terrain is filled in: no frame is drawn before it (resume() waits for it too). */
  private terrainReady=false;
  setBuildingNamesVisible(shown:boolean){this.buildingNamesShown=shown;if(!shown)this.nameLabels.hide();this.publicHalls?.setBuildingNamesVisible(shown);this.mountainTour?.setBuildingNamesVisible(shown);if(this.terrainReady){this.fadeLabels(Infinity);this.fitTags();}}
  setLanguage(language:Language){
    this.nameLabels.root.setAttribute('aria-label',language==='zh'?'建築名稱':'Building names');
    this.publicHalls?.setLanguage(language);
    this.mountainTour?.setLanguage(language);
    this.observatory.setLanguage(language);this.language=language;this.buildFarLabels();this.buildPlaques();
    this.renderer.domElement.setAttribute('aria-label',language==='zh'?'IMD Ember World 可探索的 3D 世界':'IMD Ember World, an explorable 3D world');
    this.buildTags();this.buildStopNames();
    {const old=this.scene.getObjectByName('frost-label') as THREE.Sprite,next=label(language==='zh'?VILLAGE2.name+' '+VILLAGE2.en:VILLAGE2.en,'#dfe9ee',.8);next.name=old.name;next.position.copy(old.position);
      this.scene.remove(old);old.material.map?.dispose();old.material.dispose();this.scene.add(next);this.labels[this.labels.indexOf(old)]=next;}
    {const old=this.scene.getObjectByName('spire-label') as THREE.Sprite,next=label(language==='zh'?'燼鐘塔':'Ember Belfry','#f1d9a8',.8);next.name=old.name;next.position.copy(old.position);
      this.scene.remove(old);old.material.map?.dispose();old.material.dispose();this.scene.add(next);this.labels[this.labels.indexOf(old)]=next;}
  }
  /** 霜鏡潭碼頭 and 霜谷渡口's two landings name themselves (frostRide.ts FROST_SIGNS), over their shelters or sign, in the
   *  current language; fadeLabels shows them as a cable car station's 纜車: whole within SIGN_FULL_M of you, gone by
   *  SIGN_GONE_M. */
  private stopNames:{sprite:THREE.Sprite;x:number;z:number}[]=[];
  private buildStopNames(){
    for(const n of this.stopNames){this.scene.remove(n.sprite);n.sprite.material.map?.dispose();n.sprite.material.dispose();}
    this.stopNames=FROST_SIGNS.map(s=>{const sprite=label(this.language==='zh'?s.zh:s.en,'#dfe9ee',.62);sprite.name='stop-name';sprite.position.set(s.x,s.y,s.z);sprite.visible=false;
      sprite.material.depthTest=false;sprite.material.fog=false;sprite.renderOrder=10;   // over the scene as the clickable names are: by the tarn the hills' haze veiled it
      this.scene.add(sprite);return {sprite,x:s.x,z:s.z};});}
  /** The labels you can click, in the current language (labels.ts): each landmark's name, Pepe for the Observatory, the
   *  featured seats, and the four road signs (the district, an arrow, the landmark its road leads to). */
  private buildTags(){
    for(const t of this.tags){this.scene.remove(t.sprite);t.sprite.material.map?.dispose();t.sprite.material.dispose();}
    const zh=this.language==='zh',tags:Tag[]=[],gold='#e2c07c',cream='#f2ecda';
    const add=(runs:[string,string][],size:number,target:Selection,x:number,y:number,z:number,frame?:string)=>{
      const {sprite,aspect}=tagLabel(runs,frame),base={x:.8*size*aspect,y:.8*size};sprite.position.set(x,y,z);sprite.scale.set(base.x,base.y,1);sprite.name=`tag-${target.kind}-${target.id}${frame?'-sign':''}`;
      const name=target.kind==='agent'?undefined:this.nameLabels.create((frame?'sign:':'')+beaconKey(target),frame?runs.map(run=>run[0]).join(''):runs[0][0],touch=>{
        if(this.paused)return;const travel=target.kind==='cable'?this.cableTravel(target.id==='top'?1:0):!!frame||labelIntent(this.edge(target))==='travel';
        if(touch)this.flash(target,travel,false);else this.act(target,travel);
      });
      if(name)sprite.visible=false;
      this.scene.add(sprite);tags.push({sprite,name,target,sign:!!frame,key:beaconKey(target),alpha:0,near:false,fit:false,pick:false,block:false,at:{x,y,z},base,k:1,box:{x:0,y:0,w:0,h:0,depth:0,shown:false}});
    };
    for(const b of LANDMARKS){const p=this.buildingRoots.get(b.id)!.position;add([[zh?b.name:b.en,'#e8e5c9'],[' ›',gold]],1,{kind:'building',id:b.id},p.x,p.y+labelRise(b.id),p.z);}
    add([['Pepe','#b6e196'],[' ›',gold]],.46,{kind:'observatory',id:'observatory'},OBSERVATORY.pepe.x,this.observatory.pepe.position.y+PEPE_LABEL_RISE*PEPE_SCALE,OBSERVATORY.pepe.z);
    for(const [id,p] of Object.entries(FEATURED_HOMES))add([['#'+id,id==='361'?'#a5ecde':'#ffd195'],[' ›',gold]],.64,{kind:'agent',id},p.x,terrainHeight(p.x,p.z)+3.5,p.z);
    // 纜車 over each cable car station's door (a click rides it, act).
    if(!(typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__))for(const e of [0,1] as End[]){const p=CABLE_LABELS[e];add([[zh?'纜車':'Cable car','#e8e5c9'],[' ›',gold]],.72,{kind:'cable',id:e?'top':'valley'},p.x,p.y,p.z);}
    for(const d of DISTRICTS){const p=DISTRICT_SIGNS[d.id],s=signText(d.id,zh);add([[s.from,s.color],[' → ',cream],[s.to,cream]],.68,{kind:'building',id:s.target},p.x,terrainHeight(p.x,p.z)+4.3,p.z,s.color);}
    this.tags=tags;this.nameBoxes=tags.filter(t=>!t.sign).map(t=>t.box);this.nearTags();
  }
  /** The name labels' boxes on screen, the ones a road sign yields to (labelTier.ts signYields). */
  private nameBoxes:Tag['box'][]=[];
  /** Which name labels stand within NEAR_M of the player (their place's edge; an agent: its seat), four times a second. */
  private nearTags(){const hero=this.cameraMode==='god'?this.cameraTarget:this.player.root.position;for(const t of this.tags)if(!t.sign)t.near=nearPlace(hero,t.target,this.positions);}
  private decorate(){
    const far=backdrop();this.scene.add(forest(),far);this.backdrop=far;
    // The silhouettes fade out on the way to the panorama (backdropAlpha), so they get their own transparent copies
    // of the shared kit materials; at opacity 1 (play distance) they draw exactly as before.
    const copies=new Map<THREE.Material,THREE.Material>();
    far.traverse(o=>{if(!(o instanceof THREE.Mesh))return;const m=o.material as THREE.Material;let c=copies.get(m);if(!c){c=m.clone();c.transparent=true;copies.set(m,c);}o.material=c;});
    this.backdropMaterials=[...copies.values()];
    for(const p of Object.values(FEATURED_HOMES))this.scene.add(cylinder(1.7,.2,palette.stone,p.x,terrainHeight(p.x,p.z)+.1,p.z,12));   // their seat labels: buildTags
  }
  /** The pier's plaques: the beacon says whose goal it is (IMD's own, not a forecast); the hour lamps say they show
   *  workload. Rebuilt on a language change; they fade with the other in-world labels. */
  private buildPlaques(){
    for(const old of this.plaques){old.removeFromParent();old.material.map?.dispose();old.material.dispose();this.labels.splice(this.labels.indexOf(old),1);}
    const zh=this.language==='zh',visual=this.buildingRoots.get('launch')?.getObjectByName('launch-pier');if(!visual)return;
    const beacon=plaque(zh?['$1B 目標燈塔','IMD 自己設定的目標，不是預測']:['$1B goal beacon','IMD’s own goal, not a forecast'],'#ffd98f',1.25,!zh);
    beacon.name='beacon-plaque';beacon.position.set(0,BEACON_TOP+.5,PIER.beaconZ);
    const hours=plaque(zh?['每小時完成步數','工作量 · 最近 60 分鐘在燈塔旁']:['Accepted steps per hour','workload · the last 60 minutes by the beacon'],'#ffe0a3',1,!zh);
    hours.name='hours-plaque';hours.position.set(HOURS_PLAQUE.x,HOURS_PLAQUE.y,HOURS_PLAQUE.z);
    visual.add(beacon,hours);this.plaques=[beacon,hours];this.labels.push(beacon,hours);
  }
  /** Outside the hall the Tripo exterior stands in for the procedural walls, roof and pediment; inside, the model is
   *  hidden and the procedural walls return without their roof so the camera can look down on the altar. */
  /** "Your home": a gold light column and a label over the connected wallet's house (null clears it). */
  setMyHome(home:Home|null,text='你的家'){
    this.setHomeLabel(null);
    if(this.myHome){this.scene.remove(this.myHome);this.myHome.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Sprite){o.geometry.dispose();const m=o.material as THREE.MeshBasicMaterial;m.map?.dispose();m.dispose();}});this.myHome=undefined;}
    if(!home)return;
    const g=new THREE.Group();g.name='my-home';const f=HOUSE_FOOTPRINT[home.size],y=lotBase(home,f.hw,f.hd).floor;g.position.set(home.x,y,home.z);
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.5,.9,40,16,1,true),new THREE.MeshBasicMaterial({color:0xffd27a,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide,blending:THREE.AdditiveBlending}));beam.position.y=20;beam.name='my-home-beam';
    const sign=label(text,'#ffe2a6',.9);sign.position.y=9.5;sign.name='my-home-label';g.add(beam,sign);this.scene.add(g);this.myHome=g;
    this.setHomeLabel(text,home.x,home.z,y);
  }
  /** Walk to a household's door and face the house. */
  focusHome(home:Home){if(this.cameraMode==='god'){this.focusGodCamera(home,26,home.rotation);return;}const f=HOUSE_FOOTPRINT[home.size];this.place(doorLanding(home));this.cameraTarget.set(home.x,terrainHeight(home.x,home.z)+1,home.z);this.yaw=home.rotation;this.pitch=.55;this.zoom=Math.max(20,f.hw*7);this.target=null;this.selected=null;this.hover=null;this.updateNearby();}
  /** Look at a free lot from above (move mode starts at the nearest one). */
  focusLot(p:HomePose){if(this.cameraMode==='god'){this.focusGodCamera(p,40,p.rotation);return;}this.place(p);this.cameraTarget.set(p.x,terrainHeight(p.x,p.z)+1,p.z);this.yaw=p.rotation;this.pitch=.8;this.zoom=40;this.target=null;this.updateNearby();}
  /** Move mode: glowing rings on the free lots (clickable, Selection kind 'lot' with the index as id); null hides them. */
  setLots(lots:HomePose[]|null,size:HouseSize='s'){
    if(this.lotMarkers){this.scene.remove(this.lotMarkers);this.lotMarkers.geometry.dispose();(this.lotMarkers.material as THREE.Material).dispose();this.lotMarkers=undefined;}
    this.lots=lots??[];if(!lots?.length)return;
    // A translucent slab the size of the house footprint, turned like the house would stand (door on +Z).
    const geo=new THREE.BoxGeometry(1,1,1);geo.translate(0,.5,0);const f=HOUSE_FOOTPRINT[size];
    const m=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial({color:0x2fe3b8,transparent:true,opacity:.62,depthWrite:false}),lots.length),d=new THREE.Object3D();
    lots.forEach((p,i)=>{d.position.set(p.x,lotBase(p,f.hw,f.hd).floor-.2,p.z);d.rotation.set(0,p.rotation,0);d.scale.set(f.hw*2,.6,f.hd*2);d.updateMatrix();m.setMatrixAt(i,d.matrix);});
    m.computeBoundingSphere();m.name='lot-markers';this.scene.add(m);this.lotMarkers=m;
  }
  showHallInside(inside:boolean){
    if(this.hallModel){this.hallModel.visible=!inside;if(this.hallShell)this.hallShell.visible=inside;for(const o of this.hallRoof)o.visible=false;if(this.hallVisual)hallOutside(this.hallVisual,!inside);}
    else for(const o of this.hallRoof)o.visible=!inside;
  }
  private loadHallModel(visual:THREE.Object3D){
    const slot=ASSET_SLOTS.find(s=>s.id==='heart-hall');if(!slot?.url)return;
    this.cleanups.push(loadModel(slot.url,fromSpawn(visual),{onError:()=>{/* keep the procedural hall */},onLoad:glb=>{
      if(this.disposed)return;const model=glb.scene;model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=o.receiveShadow=true;}});
      // Fit to the procedural exterior (walls, portico, roof, pediment) in the hall's own frame.
      this.hallModel=fitHall(visual,model);this.cleanups.push(()=>{model.removeFromParent();model.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();(o.material as THREE.Material).dispose();}});});
      const hero=this.player.root.position;this.showHallInside(inBox(HALL_BOX,hero.x,hero.z,.8)&&this.zoom<=PLAY_MAX_ZOOM);
    }}));
  }
  /** Tripo house models (public/models/houses); each style × size falls back to the procedural cottage until it loads. */
  /** Load only the style × size models some home actually uses (Frosthollow's log houses wait for residents). */
  private requestedModels=new Set<HouseModelKey>();
  /** Coalesce model arrivals until the next frame; only their own house parts change. */
  private pendingHouseModels=new Set<HouseModelKey>();
  /** Ask for the house models some homes use before the first read has placed anyone (WorldApp: the founding homes,
   *  whose models the first live read draws), so they download while the data is on its way; a model loads once.
   *  Each queues (assets.ts loadModel) at the distance from SPAWN of the nearest home that uses it. */
  preloadHouseModels(homes:Iterable<Point&{size:HouseSize}>){this.loadHouseModels(homes);}
  private loadHouseModels(homes:Iterable<Point&{size:HouseSize}>){
    for(const [key,near] of houseModelDistances(homes)){const entry=HOUSE_MODELS[key];if(!entry||this.requestedModels.has(key))continue;this.requestedModels.add(key);const {url,stretchY=1}=entry;this.cleanups.push(loadModel(url,near,{onLoad:glb=>{
      if(this.disposed)return;let mesh:THREE.Mesh|undefined;glb.scene.traverse(o=>{if(!mesh&&o instanceof THREE.Mesh)mesh=o;});if(!mesh)return;
      mesh.updateWorldMatrix(true,false);const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),material=plasterTint(mesh.material as THREE.MeshStandardMaterial);
      if(key.startsWith('lisbon'))material.userData.nightWindows=NW_PANE|NW_WARM;   // the Lisbon models paint dark panes (skin/daynight.ts)
      this.houseModels.set(key,{geometry,material,stretchY});this.cleanups.push(()=>{geometry.dispose();material.dispose();});
      if(this.world)this.pendingHouseModels.add(key);
    },onError:()=>{/* keep the procedural house */}}));}
  }
  setWorld(world:WorldState,homes:readonly Home[]){
    const housingAt=this.initDiagnostics?.begin('housingWorldRebuild');
    this.nativeActivity?.beforeWorldRebuild();
    this.cityActivity?.beforeWorldRebuild();
    this.pendingHouseModels.clear();
    this.unlift();this.observatory.setWorld(world);   // the houses are rebuilt and the oracle's material is set below: lift again after
    this.world=world;this.homes=homes;this.agents=new Map(world.agents.map(a=>[a.tokenId,a]));
    // Agents stand in front of their wallet's house; seats without a live agent id or a known owner have no home.
    const spots=agentSpots(homes);
    this.positions=new Map([...spots].map(([id,q])=>[id,{x:q.x,z:q.z}]));this.facing=new Map([...spots].map(([id,q])=>[id,q.rotation]));
    // Tripo models' geometry and material are shared across rebuilds; only the procedural ones are disposed.
    const shared=new Set<unknown>([...this.houseModels.values()].flatMap(m=>[m.geometry,m.material]));
    // InstancedMesh.dispose() frees its instance buffers on the GPU (the shared Tripo geometry and material stay).
    for(const item of [...this.houseSets.flatMap(h=>h.meshes),this.signals])if(item){this.scene.remove(item);if(item instanceof THREE.InstancedMesh)item.dispose();if(!shared.has(item.geometry))item.geometry.dispose();for(const m of Array.isArray(item.material)?item.material:[item.material])if(!shared.has(m))m.dispose();}
    this.houseSets=[];this.housePickIndex.invalidate();this.renderer.domElement.dataset.homes=String(homes.length);
    this.loadHouseModels(homes);this.renderer.domElement.dataset.houseModels=[...this.houseModels.keys()].join(',');
    this.homeBoxes=homes.map(h=>({x:h.x,z:h.z,...HOUSE_FOOTPRINT[h.size],rotation:h.rotation*180/Math.PI}));this.homeIndex=new HomeCollisionIndex(this.homeBoxes);
    const dummy=new THREE.Object3D(),color=new THREE.Color();
    // Until the Tripo house models land, each size is the village cottage stretched to its footprint and a little taller.
    const TALL={s:1,ms:1.06,m:1.14,l:1.22,xl:1.3};
    for(const style of ['lisbon','timber'] as const)for(const size of HOUSE_SIZES){
      const mine=homes.filter(h=>homeStyle(h)===style&&h.size===size);if(!mine.length)continue;
      const f=HOUSE_FOOTPRINT[size],model=this.houseModels.get(`${style}-${size}`);
      // A Tripo model is already built to its footprint; the procedural cottage is stretched to it.
      const sx=model?1:f.hw/HOUSE_FOOTPRINT.s.hw,sz=model?1:f.hd/HOUSE_FOOTPRINT.s.hd,tall=model?model.stretchY:TALL[size];
      const parts=model?[new THREE.InstancedMesh(model.geometry,model.material,mine.length)]:
        [new THREE.InstancedMesh(style==='lisbon'?lisbonWalls():cottageWalls(),houseMaterial(),mine.length),new THREE.InstancedMesh(style==='lisbon'?lisbonRoof():cottageRoof(),houseMaterial(),mine.length)];
      const podiumGeometry=new THREE.BoxGeometry(1,1,1);podiumGeometry.translate(0,-.5,0);
      const podium=new THREE.InstancedMesh(podiumGeometry,new THREE.MeshStandardMaterial({color:style==='lisbon'?0xcfc6b3:SE_STONE,roughness:.95,flatShading:true}),mine.length);
      mine.forEach((h,i)=>{
        const agent=this.agents.get(h.agents[0])!,base=lotBase(h,f.hw,f.hd);
        dummy.position.set(h.x,base.floor,h.z);dummy.rotation.set(0,h.rotation,0);
        // Fixed per-home variety (height, width) so the hillside is not a stamp pattern.
        const jitterY=model?.94+hash(h.x,h.z,4)*.14:style==='lisbon'?.9+hash(h.x,h.z,4)*.3:.92+hash(h.x,h.z,4)*.38;
        dummy.scale.set(sx*(.96+hash(h.x,h.z,5)*.08),tall*jitterY,sz*(.96+hash(h.x,h.z,6)*.08));dummy.updateMatrix();
        for(const m of parts)m.setMatrixAt(i,dummy.matrix);
        // Terrace podium from just under the floor down past the lowest corner of the plot.
        dummy.position.set(h.x,base.floor+.25,h.z);dummy.rotation.set(0,h.rotation,0);dummy.scale.set(f.hw*2+.3,base.podium+.25,f.hd*2+.3);dummy.updateMatrix();podium.setMatrixAt(i,dummy.matrix);
        const shade=.9+hash(h.x,h.z,7)*.18;
        // Runtime shows as plaster colour in Emberford (warm Claude / cool Codex / off-white offline) and as roof tint in Frosthollow.
        if(model)parts[0].setColorAt(i,color.setHex(style==='lisbon'?plasterColor(agent,hash(h.x,h.z,8)):0xffffff));
        else if(style==='lisbon'){parts[0].setColorAt(i,color.setHex(plasterColor(agent,hash(h.x,h.z,8))));parts[1].setColorAt(i,color.setHex(TERRACOTTA).multiplyScalar(shade));}
        else parts[1].setColorAt(i,color.setHex(roofColor(agent)).multiplyScalar(shade));});
      const meshes=[...parts,podium];
      for(const m of meshes){m.castShadow=m.receiveShadow=true;m.computeBoundingSphere();}
      this.scene.add(...meshes);this.houseSets.push({key:`${style}-${size}`,meshes,ids:mine.map(h=>h.agents[0])});
    }
    this.signalIds=world.agents.map(a=>a.tokenId);const vertices=new Float32Array(world.agents.length*3),colors=new Float32Array(vertices.length);
    world.agents.forEach((a,i)=>{const p=this.positions.get(a.tokenId)!,c=new THREE.Color(signalColor(a));vertices.set([p.x,terrainHeight(p.x,p.z)+5.1,p.z],i*3);colors.set([c.r,c.g,c.b],i*3);});
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    this.signals=new THREE.Points(geometry,new THREE.PointsMaterial({size:.38,vertexColors:true,sizeAttenuation:true}));this.scene.add(this.signals);
    this.bound=walkRadius(this.positions.values());this.ember=emberReach(homes);this.refreshExtent();
    this.heartCore.setFresh(world.sources.workers.state==='fresh');this.skin.setWorld(world);this.plaza.setWorld(world);
    this.doorLamps.build(homes,this.agents);
    // Workload: hour lamps from Explorer's buckets (dimmed when that read is old), sparks only on a fresh swarm read.
    const hours=stepHours(world);setHours(this.pier,hourLevels(hours?.hours??[]).map(v=>hours?.state==='fresh'?v:v*.5));
    this.sparks.setLevel(world.sources.swarm.state==='fresh'?sparkLevel(outputMeter(world)):0);
    const oracle=this.buildingRoots.get('oracle')!.getObjectByName('oracle-crystal') as THREE.Mesh,oracleMaterial=oracle.material as THREE.MeshStandardMaterial;
    const attested=world.sources.oracle.state==='fresh'&&world.oracle.some(r=>r.signed);oracleMaterial.color.setHex(attested?palette.teal:palette.gold);oracleMaterial.emissiveIntensity=attested?.8:.08;
    // Online agents with a home ride the boats (any with a home while none is online).
    const housed=world.agents.filter(a=>this.positions.has(a.tokenId)),online=housed.filter(a=>a.presence==='online');this.sail.setPool((online.length?online:housed).map(a=>a.tokenId));
    this.updateNearby();this.relift();
    this.nativeActivity?.setWorld(world,homes,this.houseSets);
    this.cityActivity?.setWorld(world,homes,this.houseSets);
    this.activityRevision=-1;
    this.initDiagnostics?.end('housingWorldRebuild',housingAt);
  }
  private refreshHouseModels(){
    if(!this.world||!this.pendingHouseModels.size)return;
    const at=this.initDiagnostics?.begin('housingModelArrival');
    let status:'ok'|'error'='error';
    try{
      const replacements=prepareHouseModelReplacements(this.houseSets,this.homes,this.agents,this.houseModels,this.pendingHouseModels);
      this.pendingHouseModels.clear();
      try{
        if(replacements.length){
          this.unlift();
          try{
            this.nativeActivity?.beforeWorldRebuild();this.cityActivity?.beforeWorldRebuild();
            installHouseModelReplacements(this.scene,replacements);this.housePickIndex.invalidate();
          }finally{
            // Window bindings copy instance colours, so retain setWorld's lift-before-bind order.
            try{this.relift();}
            finally{try{this.nativeActivity?.setHouseBatches(this.houseSets);}finally{this.cityActivity?.setHouseBatches(this.houseSets);}}
          }
        }
      }finally{discardHouseModelReplacements(replacements);}
      this.renderer.domElement.dataset.houseModels=[...this.houseModels.keys()].join(',');
      status='ok';
    }finally{
      this.initDiagnostics?.end('housingModelArrival',at,status);
    }
  }
  private refreshNativeRiderPool(){
    if((!this.nativeActivity&&!this.cityActivity)||!this.world)return;
    const housed=this.world.agents.filter(a=>this.positions.has(a.tokenId)),online=housed.filter(a=>a.presence==='online');
    this.sail.setPool((online.length?online:housed).filter(a=>!this.ownsActivityResident(a.tokenId)).map(a=>a.tokenId));
  }
  private ownsActivityResident(id:string){return !!(this.nativeActivity?.ownsResident(id)||this.cityActivity?.ownsResident(id));}
  get activityStore(){return this.cityActivity?.store??null;}
  private activityRevision=-1;
  private cityPresentationApplied=false;
  private updateCityActivity(time:number,epochMs:number,hidden:boolean){
    if(this.cityActivity&&!this.cityActivity.active){
      if(this.cityPresentationApplied){this.activityRevision=-1;this.cityPresentationApplied=false;this.forgeModelGlow?.setActive(null);this.skin.setActivityPresentation(null);this.doorLamps.setActivityLevels(new Map());
        if(this.world){this.heartCore.setFresh(this.world.sources.workers.state==='fresh');this.sparks.setLevel(this.world.sources.swarm.state==='fresh'?sparkLevel(outputMeter(this.world)):0);}}
      this.cityRoofMechanisms?.setActive(null);this.cityRoofMechanisms?.update(time/1000,this.reduced,hidden);
      this.forgeModelGlow?.update(time/1000,this.reduced,hidden);return;
    }
    const frame=this.cityActivity?.update({time,epochMs,hidden,camera:this.camera,player:this.player.root.position,zoom:this.zoom,reduced:this.reduced,viewHeight:this.viewHeight});
    if(frame&&frame.revision!==this.activityRevision){
      this.cityPresentationApplied=true;
      this.activityRevision=frame.revision;const forge=frame.civic.get('forge'),oracle=frame.civic.get('oracle'),heart=frame.civic.get('heart');
      this.skin.setActivityPresentation({runningJobs:forge?.active===null?null:forge?.count??null,answering:oracle?.active===null?null:oracle?.count??null,heartFresh:heart?.active===true&&heart?.reason==='ok'});
      this.heartCore.setFresh(heart?.reason==='ok');this.sparks.setLevel(heart?.reason==='ok'&&forge?.reason==='ok'&&this.world?sparkLevel(outputMeter(this.world)):0);
      this.forgeModelGlow?.setActive(forge?.active??null);
      this.cityRoofMechanisms?.setActive({heart:heart?.reason==='ok'?heart.active:null,oracle:oracle?.reason==='ok'?oracle.active:null});
      const levels=new Map<string,number>();for(const home of this.homes){let level=0;for(const id of home.agents){const state=frame.residents.get(id)?.state;level=Math.max(level,state==='working'?1.1:0);}levels.set(home.owner,level);}
      this.doorLamps.setActivityLevels(levels);
    }
    this.forgeModelGlow?.update(time/1000,this.reduced,hidden);
    this.cityRoofMechanisms?.update(time/1000,this.reduced,hidden);
    return frame;
  }
  private updateNearby(){
    const hero=this.player.root.position,limit=this.mobile?8:16;
    const candidates=[...this.positions].map(([id,p])=>({id,p,d:Math.hypot(p.x-hero.x,p.z-hero.z)})).filter(x=>x.d<18&&!this.sail.riding(x.id)).sort((a,b)=>a.d-b.d).slice(0,limit);
    const keep=new Set(candidates.map(x=>x.id));
    for(const [id,f]of this.nearby)if(!keep.has(id)){this.disposeFigure(f);this.nearby.delete(id);}
    for(const c of candidates) {
      const agent=this.agents.get(c.id)!;let f=this.nearby.get(c.id);
      if(!f){f=figure(signalColor(agent));const r=this.facing.get(c.id)??0,q=c.id in FEATURED_HOMES?doorstep({...c.p,rotation:r},1.9):c.p;f.root.position.set(q.x,terrainHeight(q.x,q.z),q.z);f.root.rotation.y=r;this.scene.add(f.root);this.nearby.set(c.id,f);}
      const body=f.root.children[0] as THREE.Mesh;(body.material as THREE.MeshStandardMaterial).color.setHex(signalColor(agent));
    }
  }
  private disposeFigure(f:Pick<Figure,'root'>){this.nativeHidden.delete(f as Figure);if(this.lifted?.roots.includes(f.root))this.unlift();this.scene.remove(f.root);f.root.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
  /** Dynamic native and mountain blockers remain authoritative after the former cable sites retire. */
  private publicHallBaseBlocked(p:Point):boolean{
    const retired=typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__;
    const base=walkBlocked(this.homeBoxes,this.bound,retired?'all':false,this.homeIndex)(p);
    return this.mountainTour?.blocked(p,base)??base;
  }
  /** Explicit civic travel lands only at each hall's checked exterior entrance. */
  private jumpPublicHall(id:PublicHallId,p:Point):boolean{
    const hall=hallPlacement(id),retired=typeof __MOUNTAIN_TOUR_PREVIEW__!=='undefined'&&__MOUNTAIN_TOUR_PREVIEW__;
    if(this.cameraMode==='god'||!['stickember','aimarket','fortune','hive','staking','pepe2pepe'].includes(id)||!hall||this.disposed||this.suspended||!this.terrainReady||!this.publicHalls||this.ride.busy||this.mountainTour?.aboard||p.x!==hall.entrance.x||p.z!==hall.entrance.z||!nearPublicEntrance(p,id,point=>this.publicHallBaseBlocked(point),retired))return false;
    this.place(p);const ground=this.publicHalls.groundAt(p,terrainHeight(p.x,p.z));
    this.player.root.position.y=this.mountainTour?.groundAt(p,ground)??ground;
    this.clearInput();this.target=this.approach=null;this.selected=this.hover=null;
    this.player.root.rotation.y=hall.rotation+Math.PI;
    this.yaw=hall.rotation+.25;this.pitch=this.viewPitch=.65;this.zoom=Math.max(34,Math.max(hall.halfWidth,hall.halfDepth)*4);
    const shift=this.viewWidth>=700?6:0,viewX=hall.x-Math.cos(this.yaw)*shift,viewZ=hall.z+Math.sin(this.yaw)*shift;
    this.lead={x:viewX-p.x,z:viewZ-p.z};this.framed=true;this.opening=null;
    this.zoomGoal=null;this.cameraTarget.set(viewX,this.player.root.position.y+1,viewZ);this.cut=true;this.updateNearby();return true;
  }
  focusAgent(id:string,travel=true){const p=this.positions.get(id);if(!p)return;if(this.cameraMode==='god'){this.selected={kind:'agent',id};this.hover=null;this.focusGodCamera(p,24,this.facing.get(id)??this.yaw);return;}this.selected={kind:'agent',id};this.hover=null;if(travel){const r=this.facing.get(id)??0;this.place(doorstep({...p,rotation:r},3.4));this.cameraTarget.set(p.x,terrainHeight(p.x,p.z)+1,p.z);this.yaw=r;this.target=null;this.zoom=19;}this.updateNearby();}
  focusBuilding(id:LandmarkId,travel=false){const b=LANDMARKS.find(b=>b.id===id)!;if(this.cameraMode==='god'){this.selected={kind:'building',id};this.hover=null;this.focusGodCamera(b,Math.max(32,b.radius*5),b.rotation*Math.PI/180);return;}this.selected={kind:'building',id};this.hover=null;if(travel){const at=landing({kind:'building',id});this.place(at);this.cameraTarget.set(b.x,terrainHeight(b.x,b.z)+1,b.z);this.yaw=at.yaw;this.target=null;this.arrive();}}
  /** Every travel lands at play distance: from the panorama (or anywhere past 80 m) the camera comes back to the
   *  spawn view's distance and pitch, since there the look point is the world's centre, not you. At play distance
   *  the current zoom and pitch are kept (as travel always did). Focus functions with their own framing set it. */
  private arrive(){if(this.zoom>PLAY_MAX_ZOOM){this.zoom=29;this.pitch=.69;}}
  /** Travel to Frosthollow's longhouse (minimap target). */
  focusFrost(){if(this.cameraMode==='god'){this.focusGodCamera(FROST_TRAVEL,48,FROST_TRAVEL.yaw);return;}this.place(FROST_TRAVEL);this.cameraTarget.set(FROST_TRAVEL.x,terrainHeight(FROST_TRAVEL.x,FROST_TRAVEL.z)+1,FROST_TRAVEL.z);this.target=null;this.yaw=FROST_TRAVEL.yaw;this.pitch=.5;this.zoom=26;this.selected=null;this.hover=null;this.updateNearby();}
  /** Travel to a spot facing `yaw` (a boat stop on the map: mapShapes.ts MAP_STOPS). */
  focusPlace(p:Point&{yaw:number}){if(this.cameraMode==='god'){this.focusGodCamera(p,40,p.yaw);return;}this.place(p);this.cameraTarget.set(p.x,terrainHeight(p.x,p.z)+1,p.z);this.target=null;this.yaw=p.yaw;this.pitch=.55;this.zoom=26;this.selected=null;this.hover=null;this.updateNearby();}
  focusObservatory(){if(this.cameraMode==='god'){this.selected={kind:'observatory',id:'observatory'};this.hover=null;this.focusGodCamera(OBSERVATORY,38,.3);return;}const at=landing({kind:'observatory'});this.place(at);this.target=null;this.yaw=at.yaw;this.pitch=.4;this.zoom=21;this.selected={kind:'observatory',id:'observatory'};this.hover=null;this.updateNearby();}
  /** The weather's sound (sound.ts): thunder after each strike, the rain hiss following the rain level. */
  listen(ears:WorldSound|null){this.ears=ears;this.rain.onStrike=ears?s=>ears.thunder(s):undefined;}
  /** The music (musicPlayer.ts) follows the weather shown and the night drawn (a previewed hour included). */
  music(tune:MusicPlayer|null){this.tune=tune;}
  /** The time slider (WorldTime.tsx): a previewed UTC hour, or null for live world time. */
  setTimePreview(hour:number|null){this.daynight.preview=hour;}
  /** Calm weather (calmSky.ts): the sky, rain and music leave the market for a clear sky (the rain clearing quickly, and
   *  no clearing song: the switch cleared it, not the market); the Observatory keeps the market. */
  setCalm(calm:boolean){if(calm!==this.calm){this.calm=calm;this.setMarket(this.sample,true);this.tune?.setWorld(this.weather,this.daynight.state.weights.night,this.daynight.preview!==null,true);}}
  private calm=false;private sample:SourceSample|null=null;
  setMarket(sample:SourceSample|null,quick=false){
    this.sample=sample;this.observatory.setMarket(sample);const view=marketView(sample),f=this.forced;
    this.skyQuote={state:view.state,change24h:view.quote?.change24h??null,change1h:view.quote?.change?.h1??null,fetchedAt:view.fetchedAt};
    ({weather:this.weather,mood:this.mood}=skyWeather(f.weather??view.weather,f.wind===null?view.mood:{...view.mood,wind:f.wind},this.calm));
    this.renderer.domElement.dataset.weather=this.weather;this.rain.set(this.weather,this.mood,quick);
    if(!this.skyKnown&&this.weather!=='unknown'){this.skyKnown=true;const sky=gentleSky(this.weather,WEATHER_SKY);this.skyNow.setHex(sky.color);this.sunLevel=sky.sun;}   // the first known sky at once, as the rain
    setBeacon(this.pier,beaconSegments(goalBeacon(view)));this.fireworks.setWind(this.mood.wind);
  }
  /** Recent activity for the control wall (happenings.ts, accumulated across reads by the app). */
  setActivity(feed:ActivityFeed){this.observatory.setActivity(feed);}
  /** Door lamps for the arrivals of the latest read (lamps.ts planLamps). */
  setArrivals(plan:LampPlan){this.lastPlan=plan;this.doorLamps.light(plan,performance.now(),this.reduced);this.renderer.domElement.dataset.arrivals=String(plan.cues.length);}
  /** A new hundred agents online: fireworks over the square and a peal from the belfry. Under reduced motion there are
   *  no fireworks (the app still announces the milestone in text) and the bell does not swing. A brilliant sky's burst
   *  in the air finishes first (skin/linkage.ts Fireworks.start). */
  celebrate(hundred:number){
    if(!this.reduced)this.fireworks.start(performance.now());this.plaza.peal(Math.min(10,Math.max(3,Math.round(hundred/100))));
    this.renderer.domElement.dataset.celebrated=String(hundred);
  }
  /** Whether someone can see the world (afterRead.ts worldUncovered: a visible tab, no strip, drawer, interior or lot
   *  choice over it): the brilliant sky's fireworks wait for it. */
  setUncovered(open:boolean){this.uncovered=open;}
  /** One brilliant-sky burst at once, whatever the schedule (dev capture only); none under reduced motion, nor over the
   *  hundred's show. */
  skyBurst(){if(this.fireworksWeather()==='brilliant'&&!this.reduced&&!this.slow&&this.uncovered&&!this.paused)this.fireworks.start(performance.now(),this.skyShow.burst(this.worldSkyPreview||wholeWorldSky(this.skyQuote)));}
  /** Stop market fireworks at the display TTL even between market reads; explicit visual previews keep their gate. */
  private fireworksWeather(){return this.weather==='brilliant'&&!this.forced.weather&&!this.worldSkyPreview&&!brilliantSky(this.skyQuote)?'unknown':this.weather;}
  /** Every place on the Explore checklist seen (onboarding 10): three clear strikes from the belfry, no fireworks. */
  peal(){this.plaza.peal(3);this.renderer.domElement.dataset.pealed='explore';}
  /** A replay asked for from the Observatory drawer: back to the plaza view, which frames the show over the square. */
  watchFireworks(){if(!this.reduced)this.home();}
  /** Dev capture: light the last arrivals again (renders of a dawn). */
  replayArrivals(){if(this.lastPlan)this.doorLamps.light(this.lastPlan,performance.now(),this.reduced);}
  private place(p:Point){if(this.cameraMode==='god')return;this.publicHalls?.cancelRoute();this.mountainTour?.travel();this.ride?.travel();this.unframe('travel');this.player.root.position.set(p.x,this.mountainTour?.groundAt(p,terrainHeight(p.x,p.z))??terrainHeight(p.x,p.z),p.z);this.zoomGoal=null;this.arrival=this.approach=null;this.cut=this.reduced;this.screen?.teleported();}
  /** After a travel (onboarding 11): call done once the camera has settled on the arrival (arrivalStep); walking away,
   *  another travel or cancelArrival drops it. The app opens the drawer there, unless another opened meanwhile. */
  onArrive(done:()=>void){if(this.cameraMode==='god'){done();return;}const h=this.player.root.position;this.arrival={done,at:{x:h.x,z:h.z},since:performance.now()};}
  cancelArrival(){this.arrival=null;}
  home(){if(this.cameraMode==='god'){this.focusGodCamera(SPAWN,60,.35);return;}this.place(SPAWN);this.target=null;this.yaw=.35;this.pitch=.69;this.zoom=29;this.selected=null;this.hover=null;this.updateNearby();}
  /** A first visit's opening frame (onboarding 03, overview.ts frameFor) over the HUD boxes measured now: portrait phones
   *  the look-ahead toward the screen, wider screens the closest pull-back that shows the screen and Pepe, #361, the arch
   *  and two more landmarks you can see and read in the clear band (a phone held landscape without the two). It holds
   *  until the first move, drag, zoom or key (unframe). refit: the HUD changed under a frame still held (the first read
   *  filled the cards, a resize), so it glides to the new one; else nothing. */
  firstVisitPose(phone:boolean,hud:readonly Rect[],refit=false):FramePose|null{
    if(refit&&!this.framed)return null;
    const {pose}=frameFor(firstVisitGoals(phone,!phone&&matchMedia(LANDSCAPE_PHONE).matches),{width:this.viewWidth,height:this.viewHeight,hud},phone),hero=this.player.root.position;
    this.yaw=pose.yaw;this.pitch=pose.pitch;this.lead={x:pose.x-hero.x,z:pose.z-hero.z};this.framed=true;this.opening=null;this.renderer.domElement.dataset.opening='framed';
    if(refit&&!this.reduced){this.zoomGoal=pose.zoom===this.zoom?null:pose.zoom;return pose;}
    this.viewPitch=pose.pitch;this.zoom=pose.zoom;this.zoomGoal=null;this.cameraTarget.set(pose.x,pose.y,pose.z);this.cut=true;return pose;
  }
  /** Ends the opening frame for good: it eases back to the play camera over OPENING_MS (at once under reduced motion or for
   *  a travel, whose focus sets its own view); what the input moves itself stays with it (a zoom, a drag's pitch). */
  private unframe(kind:'move'|'zoom'|'drag'|'travel'){
    if(this.cameraMode==='god')return;
    if(this.framed){this.framed=false;this.zoomGoal=null;this.opening={lead:{...this.lead},zoom:this.zoom,pitch:this.pitch,since:performance.now()};this.renderer.domElement.dataset.opening=kind;}
    const o=this.opening;if(!o)return;if(kind==='zoom')o.zoom=null;if(kind==='drag')o.pitch=null;
    if(kind==='travel'||this.reduced){this.ease(Infinity);this.cut=true;}
  }
  private ease(now:number){const o=this.opening;if(!o)return;const s=openingAt(o,now-o.since);this.lead=s.lead;if(s.zoom!==null)this.zoom=s.zoom;if(s.pitch!==null)this.pitch=s.pitch;if(s.done)this.opening=null;}
  /** Walk to a point as a tap would (steerTo), then call done once there and settled (onArrive), or lost when the walk
   *  gives up short of it. Taking over (keys, the stick, another tap, a drawer, a travel) drops it. The first-run strip's
   *  「從 Pepe 的大螢幕開始」 walks you to the screen so. */
  walkTo(p:Point,done:()=>void,lost:()=>void,publicRoute=false){if(this.cameraMode==='god'){lost();return;}if(!publicRoute)this.publicHalls?.cancelRoute();if(this.paused){lost();return;}this.arrival=null;this.target=steerTo(p);this.approach={steer:this.target,done,lost};this.unframe('move');}
  setStick(x:number,z:number){this.stick={x:Number.isFinite(x)?x:0,z:Number.isFinite(z)?z:0};if(x||z){this.publicHalls?.cancelRoute();this.target=this.approach=null;this.unframe('move');}}
  setPaused(paused:boolean){if(paused)this.rideCover();this.held=paused;this.target=this.approach=null;this.clearInput();}
  /** Browser-local free cosmetics only; never changes identity, home rights or another agent's figure. */
  setPlayerAppearance(value:PlayerAppearance):void{if(this.disposed)return;applyPlayerAppearance(this.player,normaliseAppearance(value));}
  /** Render/copy synchronously with a temporary camera, then restore the normal camera/pose/renderer before encoding.
   *  preserveDrawingBuffer remains false; no DOM or HUD is photographed. */
  captureSelfie(options:SelfieOptions={}):Promise<Blob>{
    if(this.disposed||this.suspended||this.ride.aboard||this.mountainTour?.aboard)return Promise.reject(new Error('SELFIE_UNAVAILABLE'));
    const hero=this.player.root,p=hero.position,frame=selfieFraming({x:p.x,y:p.y,z:p.z,yaw:hero.rotation.y},options);
    const camera=this.camera.clone();camera.fov=frame.fov;camera.aspect=SELFIE_WIDTH/SELFIE_HEIGHT;
    camera.clearViewOffset();camera.position.set(frame.position.x,frame.position.y,frame.position.z);
    camera.lookAt(frame.target.x,frame.target.y,frame.target.z);camera.updateProjectionMatrix();
    const size=this.renderer.getSize(new THREE.Vector2()),ratio=this.renderer.getPixelRatio(),target=this.renderer.getRenderTarget(),yaw=hero.rotation.y,halo=this.halo.visible;
    let photo:HTMLCanvasElement;
    try{this.renderer.setRenderTarget(null);this.renderer.setDrawingBufferSize(SELFIE_WIDTH,SELFIE_HEIGHT,1);
      hero.rotation.y=frame.yaw;this.halo.visible=false;
      this.renderer.shadowMap.needsUpdate=true;this.sun.shadow.needsUpdate=true;
      photo=withoutSelfieLabels({tags:this.tags,stopNames:this.stopNames,farLabels:this.farLabels,labels:[...this.labels,...(this.nativeActivity?.labels??[]),...(this.cityActivity?.labels??[])],
        homeLabel:this.homeLabel,homeSign:this.myHome?.getObjectByName('my-home-label'),pin:this.pin},()=>{
        this.renderer.render(this.scene,camera);return copySelfieCanvas(this.renderer.domElement);
      });
    }catch{return Promise.reject(new Error('SELFIE_UNAVAILABLE'));}
    finally{hero.rotation.y=yaw;this.halo.visible=halo;this.renderer.setDrawingBufferSize(size.x,size.y,ratio);
      this.renderer.setRenderTarget(target);
      this.renderer.shadowMap.needsUpdate=true;this.sun.shadow.needsUpdate=true;
      // The active world RAF still draws while its inputs are paused by the photo panel. Avoid an extra full
      // world draw on the synchronous capture path; retain it when no visible RAF can restore the canvas.
      if(!this.terrainReady||!this.frame||document.hidden||target!==null)this.renderer.render(this.scene,this.camera);}
    return selfiePng(photo);
  }
  /** A drawer over the world, or the world handed to a house interior (suspend): no input, no walking. */
  get viewMode():ViewMode{return this.cameraMode;}
  get freeViewAvailable(){return !this.disposed&&this.terrainReady&&!this.paused&&!this.ride?.busy&&!this.mountainTour?.busy;}
  /** A local presentation mode never changes the actor, account, terrain or entrance authority. */
  setViewMode(mode:ViewMode):boolean{
    if(mode!=='person'&&mode!=='god')return false;if(mode===this.cameraMode)return !this.disposed;
    if(!this.freeViewAvailable)return false;
    this.publicHalls?.cancelRoute();this.target=this.approach=null;this.arrival=null;this.boardAt=0;this.clearInput();
    clearTimeout(this.flashTimer);this.flashing=null;this.mouse=null;this.setHover(null,0,0);
    if(mode==='god'){
      this.personView={yaw:this.yaw,pitch:this.pitch,viewPitch:this.viewPitch,zoom:this.zoom,zoomGoal:this.zoomGoal,lead:{...this.lead},framed:this.framed,target:this.cameraTarget.clone()};
      this.frozenPerson={position:this.player.root.position.clone(),rotation:this.player.root.rotation.clone()};
      this.cameraMode='god';const p=freeCameraPoint(this.look);this.cameraTarget.set(p.x,this.cameraGround(p)+1,p.z);
      this.pitch=this.viewPitch=.9;this.zoom=Math.max(48,Math.min(95,this.zoom));this.zoomGoal=null;this.framed=false;this.opening=null;
    }else{
      const saved=this.personView;this.cameraMode='person';
      if(saved){this.yaw=saved.yaw;this.pitch=saved.pitch;this.viewPitch=saved.viewPitch;this.zoom=saved.zoom;this.zoomGoal=saved.zoomGoal;this.lead=saved.lead;this.framed=saved.framed;this.cameraTarget.copy(saved.target);}
      if(this.frozenPerson){this.player.root.position.copy(this.frozenPerson.position);this.player.root.rotation.copy(this.frozenPerson.rotation);}
      this.personView=null;this.frozenPerson=null;this.opening=null;
    }
    this.cut=true;this.checkDoor();this.nearTags();this.publishSceneView();return true;
  }
  private cameraGround(p:Point){const original=terrainHeight(p.x,p.z),publicGround=this.publicHalls?.groundAt(p,original)??original,value=this.mountainTour?.groundAt(p,publicGround)??publicGround;return Number.isFinite(value)?value:0;}
  /** Panning changes only the observer's ground-plane focus; it does not make the camera walk downhill. */
  private panGodCamera(p:Point){const point=freeCameraPoint(p);this.cameraTarget.x=point.x;this.cameraTarget.z=point.z;this.nearTags();}
  private focusGodCamera(p:Point,zoom=48,yaw=this.yaw):boolean{
    if(this.cameraMode!=='god'||this.disposed||this.suspended||!this.terrainReady||!Number.isFinite(p.x)||!Number.isFinite(p.z)||!Number.isFinite(zoom)||!Number.isFinite(yaw))return false;
    this.target=this.approach=null;this.arrival=null;this.clearInput();this.panGodCamera(p);this.cameraTarget.y=this.cameraGround(p)+1;this.zoom=clampZoom(zoom,this.maxZoom);this.zoomGoal=null;this.yaw=yaw;this.pitch=this.viewPitch=.85;this.opening=null;this.cut=true;return true;
  }
  private observePublicHall(id:PublicHallId):boolean{const hall=hallPlacement(id);return !!hall&&this.focusGodCamera(hall,Math.max(38,Math.max(hall.halfWidth,hall.halfDepth)*4),hall.rotation+.25);}
  private publishSceneView(){const hero=this.player.root.position;this.renderer.domElement.dataset.viewMode=this.cameraMode;this.renderer.domElement.dataset.cameraFocus=this.cameraTarget.x.toFixed(3)+','+this.cameraTarget.z.toFixed(3);
    this.onView({viewMode:this.cameraMode,cameraFocus:{x:this.cameraTarget.x,z:this.cameraTarget.z},freeViewAvailable:this.freeViewAvailable,player:{x:hero.x,z:hero.z},near:this.near,nearDoor:this.nearDoor,fps:this.fps,drawCalls:this.renderer.info.render.calls,nearFigures:this.nearby.size,renderedSignals:this.signalIds.length,yaw:this.yaw,figures:[...this.nearby].map(([id,f])=>({id,x:f.root.position.x,z:f.root.position.z})),ride:this.ride.view(Date.now()/1000)});}
  private get paused(){return this.held||this.suspended||this.publicHalls?.overlayOpen===true||this.mountainTour?.overlayOpen===true;}
  focusPublicHall(id:PublicHallId){return this.publicHalls?.visit(id)??false;}
  /** Exterior camera view only. The player, home rights and other overlay pause reasons remain owned by the original host. */
  private peekPublicHall(id:PublicHallId):()=>void{
    const hall=hallPlacement(id);if(!hall)return ()=>{};
    const saved={yaw:this.yaw,pitch:this.pitch,viewPitch:this.viewPitch,zoom:this.zoom,zoomGoal:this.zoomGoal,lead:{...this.lead},framed:this.framed,opening:this.opening,target:this.cameraTarget.clone()};
    const hero=this.player.root.position;this.yaw=hall.rotation+.25;this.pitch=this.viewPitch=.65;this.zoom=id==='dream'?39:id==='stickember'?38:id==='radar'?35:29;this.zoomGoal=null;
    const shift=this.viewWidth>=700?6:0,viewX=hall.x-Math.cos(this.yaw)*shift,viewZ=hall.z+Math.sin(this.yaw)*shift;
    this.lead={x:viewX-hero.x,z:viewZ-hero.z};this.framed=true;this.opening=null;this.cameraTarget.set(viewX,this.cameraMode==='god'?this.cameraGround(hall)+2:terrainHeight(hall.x,hall.z)+2,viewZ);this.cut=true;
    return ()=>{this.yaw=saved.yaw;this.pitch=saved.pitch;this.viewPitch=saved.viewPitch;this.zoom=saved.zoom;this.zoomGoal=saved.zoomGoal;this.lead=saved.lead;this.framed=saved.framed;this.opening=saved.opening;this.cameraTarget.copy(saved.target);this.cut=true;};
  }
  // Home interiors (docs/interiors/DESIGN_v001.md §1–2): the owner's own house is enterable at its door (null for everyone
  // not in owner mode; homeEntry.ts enterGate decides), checked at 4 Hz with the nearby figures; E there enters.
  private enterable:Home|null=null;private nearDoor=false;private onDoor:(()=>void)|null=null;private suspended=false;
  setEnterable(home:Home|null,onDoor:(()=>void)|null=null){this.enterable=home;this.onDoor=home?onDoor:null;this.checkDoor();}
  private checkDoor(){if(this.cameraMode==='god'){this.nearDoor=false;return;}this.nearDoor=nearOwnDoor(this.player.root.position,this.enterable,!!(this.ride?.aboard||this.mountainTour?.aboard));}
  /** Where a house's door is on screen now (CSS px from the canvas's top-left), for the iris that opens from it. */
  doorScreen(home:Home){const d=doorPoint(home),q=projectPoint(this.camera,this.viewWidth,this.viewHeight,'',d.x,terrainHeight(d.x,d.z)+1.2,d.z,this.probe);return q.onScreen?{x:q.x,y:q.y}:null;}
  /** Inside a house the world stops drawing (0 frames), drops its input and lends its renderer: one WebGL context. The
   *  scene graph, camera and player pose stay exactly as they were; polling (setWorld, setMarket) goes on. */
  suspend(){if(!this.suspended&&!this.disposed){this.suspended=true;cancelAnimationFrame(this.frame);this.frameMetrics?.skip();this.initDiagnostics?.skipFrame();this.nameLabels.hide();this.clearInput();this.target=this.approach=null;this.arrival=null;this.mouse=null;this.setHover(null,0,0);this.screen?.hide();}return this.renderer;}
  borrowRenderer(){return this.renderer;}
  /** Back from a house: the canvas home again (the interior drew on it elsewhere), the frame clock reset (as a hidden
   *  tab's return), the size re-measured, the loop restarted. */
  resume(){
    if(!this.suspended||this.disposed)return;this.frameMetrics?.skip();this.initDiagnostics?.skipFrame();this.suspended=false;const c=this.renderer.domElement;if(c.parentElement!==this.host)this.host.prepend(c);
    const now=performance.now();this.last=this.fpsAt=now;this.frames=0;this.slowSamples=0;   // a stay inside is not a slow frame (PERF-2)
    this.size();this.renderer.shadowMap.needsUpdate=true;this.checkDoor();if(this.terrainReady)this.frame=requestAnimationFrame(this.animate);
  }
  /** What a house window shows of the sky: the weather tier drawn (?weather= included), the 1h mood and the world-time
   *  preview (the slider, ?hour=); null preview is live UTC time. */
  skyState(){return {weather:this.weather,mood:{...this.mood},preview:this.daynight.preview};}
  /** Set the zoom at once (pinch, resize clamp, dev capture); cancels a glide in progress. */
  setZoom(zoom:number){this.zoom=clampZoom(zoom,this.maxZoom);this.zoomGoal=null;}
  /** Glide to a zoom (buttons, keys, wheel), or jump there when the player prefers reduced motion. */
  private easeZoomTo(zoom:number){const z=clampZoom(zoom,this.maxZoom);if(this.reduced||z===this.zoom)this.setZoom(z);else this.zoomGoal=z;}
  /** +/− buttons and keys: whole zoom levels (×1.18 up to 80 m, ×1.45 beyond; overview.ts). Positive = farther.
   *  Steps count from where a glide is heading, so quick repeated clicks add up. */
  zoomStep(steps:number){this.unframe('zoom');this.easeZoomTo(stepZoom(this.zoomGoal??this.zoom,steps,this.maxZoom));}
  /** Current zoom and its range (the panorama's maximum depends on the viewport's aspect). */
  zoomRange(){return {zoom:this.zoom,max:this.maxZoom};}
  clearSelection(){this.selected=null;}
  interact(){if(this.cameraMode==='god')return;if(!this.ride.busy&&this.mountainTour?.interact())return;if(!this.ride.aboard&&this.publicHalls?.tryInteract(this.player.root.position))return;if(this.ride.interact(Date.now()/1000,this.reduced))return;if(this.nearDoor&&this.onDoor){this.onDoor();return;}if(this.near)this.onSelect(this.near);}
  /** 燼火升降台: at the Falls landing, the Ember Lift to the Frost Tarn (skin/rides.ts). */
  boardLift(){if(this.cameraMode==='god')return;if(!this.mountainTour?.busy)this.ride.boardLift(Date.now()/1000);}
  /** 燼舟 (boarding.ts): the HUD's get-off / stay-aboard button; Esc (queues the alight, or cancels a boarding); a drawer or
   *  the Map over the world (cancels a boarding; a ride sails on). */
  rideAlight(){this.ride.alight(Date.now()/1000);}
  rideEsc(){this.ride.esc(Date.now()/1000);}
  rideCover(){this.ride?.cover();}
  /** The beacons to draw (onboarding 04; the app picks them, beacons.ts). Each one's DOM tag (Beacons.tsx) stands in for its
   *  sprite label, which hides and cannot be picked while the beacon is up. */
  /** The one ring that breathes (labelTier.ts featuredKey: the place shown in full); the other lit rings hold still. */
  setFeatured(key:string|null){this.featured=key;}
  private featured:string|null=null;
  setBeacons(list:readonly Beacon[]){this.beaconList=list.map(b=>({...b,ys:b.rings.map(r=>terrainHeight(r.x,r.z)+.06)}));this.beaconed=new Set(list.map(b=>beaconKey(b.target)));}
  /** A beacon tag's button: what a click on its label would do (pick): open it, or go there first when it is far; a tap
   *  lights it for 250 ms first. */
  beaconPick(s:Selection,touch:boolean){if(this.paused)return;const travel=labelIntent(this.edge(s))==='travel';if(touch)this.flash(s,travel,false);else this.act(s,travel);}
  /** A ground point on screen now, `margin` px inside its edges (the beacons' spare rings go to landmarks in frame). */
  inFrame(p:Point,margin=24){const q=projectPoint(this.camera,this.viewWidth,this.viewHeight,'',p.x,terrainHeight(p.x,p.z)+1,p.z,this.probe);return q.onScreen&&q.x>=margin&&q.x<=this.viewWidth-margin&&q.y>=margin&&q.y<=this.viewHeight-margin;}
  /** The rings each frame: the featured one breathes (a still double ring under reduced motion), the other lit and quiet
   *  ones hold, a seen one is faint without its mote (and a bare one never has one); each grows to stay RING_MIN_PX wide on screen and fades out with the in-world labels past 80 m. */
  private drawBeacons(now:number){
    const mesh=this.beaconMesh,fade=nearLabelAlpha(this.zoom);mesh.visible=this.beaconList.length>0&&fade>0;if(!mesh.visible)return;
    const min=this.mobile?RING_MIN_PX.touch:RING_MIN_PX.fine,k=mesh.geometry.getAttribute('aK') as THREE.InstancedBufferAttribute,mote=mesh.geometry.getAttribute('aMote') as THREE.InstancedBufferAttribute,d=this.dummy;let n=0;
    for(const b of this.beaconList){
      const lit=b.state!=='seen',live=ringBreathes(b,this.featured),v=(b.state==='seen'?.22:!live?.55:this.reduced?.7:breath(now))*fade;
      b.rings.forEach((r,j)=>{const g=ringGrow(this.camera,this.viewWidth,this.viewHeight,r.x,b.ys[j],r.z,r.r,min);
        for(const s of this.reduced&&live?DOUBLE:SINGLE){if(n>=BEACON_INSTANCES)return;d.position.set(r.x,b.ys[j],r.z);d.scale.set(r.r*g*s,g,r.r*g*s);d.updateMatrix();mesh.setMatrixAt(n,d.matrix);k.setX(n,v);mote.setX(n,s===1&&ringMote(r,lit)?1:0);n++;}});
    }
    mesh.count=n;mesh.instanceMatrix.needsUpdate=true;k.needsUpdate=true;mote.needsUpdate=true;
  }
  private clearInput(){this.keys.clear();this.stick={x:0,z:0};this.pointers.clear();this.pinch=0;}
  private keydown=(e:KeyboardEvent)=>{
    if(this.paused || e.target instanceof HTMLElement && (e.target.closest('input,textarea,select,button')||e.target.isContentEditable))return;
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft'].includes(e.code)){this.publicHalls?.cancelRoute();e.preventDefault();this.keys.add(e.code);this.target=null;if(e.code!=='ShiftLeft'){this.approach=null;this.unframe('move');}}
    if(e.code==='KeyE'&&!e.repeat)this.interact();
    if(e.code==='KeyL'&&!e.repeat)this.boardLift();
    if(['Equal','NumpadAdd','Minus','NumpadSubtract'].includes(e.code)&&!e.ctrlKey&&!e.metaKey){e.preventDefault();this.zoomStep(e.code==='Minus'||e.code==='NumpadSubtract'?1:-1);}
  };
  private keyup=(e:KeyboardEvent)=>{this.keys.delete(e.code);};
  private down=(e:PointerEvent)=>{if(this.paused)return;this.renderer.domElement.setPointerCapture(e.pointerId);this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button,dragged:false,gesture:false});if(this.pointers.size===2){const p=[...this.pointers.values()];for(const pointer of p)pointer.gesture=true;this.pinch=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}};
  private move=(e:PointerEvent)=>{
    if(this.paused)return;const p=this.pointers.get(e.pointerId);
    if(p){const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;
      if(this.pointers.size===2){const ps=[...this.pointers.values()],d=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);if(this.pinch){this.unframe('zoom');this.setZoom(pinchZoom(this.zoom,this.pinch,d,this.maxZoom));}this.pinch=d;}
      else {if(this.cameraMode==='god'&&p.button!==2){
        if(!p.gesture&&Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>8){const px=p.dragged?dx:e.clientX-p.startX,py=p.dragged?dy:e.clientY-p.startY;p.dragged=true;this.panGodCamera(freeCameraDrag(this.cameraTarget,{x:px,y:py},this.yaw,this.viewPitch,this.zoom,this.viewHeight));this.dragAt=performance.now();}
      }else{if(Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>8){p.dragged=true;this.unframe('drag');this.dragAt=performance.now();}this.yaw-=dx*.006;this.pitch=THREE.MathUtils.clamp(this.pitch+dy*.004,.25,1.2);}}
    }else if(e.pointerType==='mouse')this.mouse={x:e.clientX,y:e.clientY};   // picked once a frame (hoverFrame)
  };
  private cancel=(e:PointerEvent)=>{this.pointers.delete(e.pointerId);this.pinch=0;};
  private up=(e:PointerEvent)=>{
    const p=this.pointers.get(e.pointerId),multi=this.pinch>0;this.pointers.delete(e.pointerId);this.pinch=0;if(e.pointerType==='mouse')this.mouse={x:e.clientX,y:e.clientY};   // hover resumes where a drag ended
    if(!p||this.paused||multi||p.gesture||p.dragged||this.cameraMode==='god'&&p.button===2||Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>8)return;
    this.publicHalls?.cancelRoute();
    if(this.mountainTour?.tryPointer(e.clientX,e.clientY))return;
    if(this.publicHalls?.tryPointer(e.clientX,e.clientY))return;
    const touch=e.pointerType!=='mouse',hit=this.pick(e.clientX,e.clientY,touch);
    if(hit.selection){if(touch)this.flash(hit.selection,hit.travel,hit.house);else this.act(hit.selection,hit.travel);}
    else if(hit.point&&this.cameraMode!=='god'){this.target=steerTo(hit.point);this.approach=null;this.unframe('move');if(touch){const r=this.renderer.domElement.getBoundingClientRect();this.screen?.missed(e.clientX-r.left,e.clientY-r.top);}}
  };
  private act(s:Selection,travel:boolean){if(s.kind==='cable'){this.cableClick(s.id==='top'?1:0);return;}if(s.kind==='stop'){this.stopClick(s.id);return;}if(!travel)this.selected=s;this.onSelect(s,travel);}
  /** A click on a cable car station (its label, its walls, a cabin in it): by either station, the ride from the one you
   *  stand by (off its platform, by its door first); farther, there first (by its door, facing it). Nothing while a ride
   *  is under way (a near click is no travel). */
  private cableClick(end:End){if(this.mountainTour){this.mountainTour.stationClick(end);return;}if(this.cameraMode==='god'){this.focusGodCamera(CABLE_LABELS[end],40);return;}const c=cableClick(this.player.root.position,end);if(c.board!==null&&this.ride.busy)return;
    if(c.stand)this.focusPlace(c.stand);if(c.board!==null)this.ride.boardCable(Date.now()/1000,c.board,this.reduced);}
  /** A click on a boat stop's shelter or deck (stopClick.ts): within BOARD_NEAR of it, to the stop (unless you stand at it)
   *  and aboard, as E there, once the frame finds you at it (boardAt); farther, there first. Nothing while a ride is under way. */
  private stopClick(id:string){if(this.cameraMode==='god'){this.focusPlace(stopZone(id).stand);return;}if(this.ride.busy||this.mountainTour?.busy)return;const c=stopClick(this.player.root.position,id);if(c.stand)this.focusPlace(c.stand);this.boardAt=c.board?performance.now()+2000:0;}
  /** Touch (onboarding 06): what a tap reached lights up for 250 ms, then opens (or travels there). */
  private flash(s:Selection,travel:boolean,house:boolean){
    clearTimeout(this.flashTimer);this.selected=s;this.flashing={selection:s,house};this.relift();
    this.flashTimer=window.setTimeout(()=>{this.flashing=null;this.relift();if(!this.disposed&&!this.paused)this.act(s,travel);},250);
  }
  /** Mouse hover (onboarding 06), picked at most once a frame and only after the mouse or the camera moved (or 250 ms
   *  passed, as figures come and go): the pointer cursor, the lift and the chip (through the feed) over what a click
   *  would open. Nothing over decoration, while dragging, over the HUD (the canvas loses the pointer) or under a drawer. */
  /** The mouse on the canvas as of the last hover pick (a road sign under it comes back whole, layerLabels). */
  private mouseAt={x:0,y:0};private mouseOn=false;
  private hoverFrame(now:number){
    const m=this.mouse;if(!m||this.paused||this.pointers.size){this.mouseOn=false;if(this.hoverHit||this.cursor)this.setHover(null,0,0);return;}
    const key=this.hoverKey,e=this.camera.matrixWorld.elements;let same=key[0]===m.x&&key[1]===m.y&&now-this.hoverAt<250;
    for(let i=0;i<16&&same;i++)same=key[i+2]===e[i];if(same)return;
    key[0]=m.x;key[1]=m.y;key.set(e,2);this.hoverAt=now;
    if(this.mountainTour?.isPointerOverHall(m.x,m.y)){this.setHover(null,0,0);this.cursor='pointer';this.renderer.domElement.style.cursor=this.cursor;return;}
    const hit=this.pick(m.x,m.y),r=this.renderer.domElement.getBoundingClientRect();this.mouseAt.x=m.x-r.left;this.mouseAt.y=m.y-r.top;this.mouseOn=true;
    this.setHover(hit.selection?{selection:hit.selection,house:hit.house,travel:hit.travel}:null,m.x-r.left,m.y-r.top);
  }
  private setHover(h:{selection:Selection;house:boolean;travel:boolean}|null,x:number,y:number){
    this.hoverHit=h;this.hover=h?.selection??null;const cursor=h?'pointer':'';if(cursor!==this.cursor){this.cursor=cursor;this.renderer.domElement.style.cursor=cursor;}
    this.relift();this.screen?.hovered(h?{kind:h.selection.kind,id:h.selection.id,travel:h.travel,house:h.house,x,y}:null);
  }
  /** The lift on what the mouse is over or a tap just reached: its meshes (and sprites) swap to lit clones of their
   *  materials; an agent's house, one instance of the shared house meshes, lifts its instance colour instead. */
  private relift(){
    const l=this.flashing??this.hoverHit,s=l?.selection,key=s?`${s.kind}:${s.id}:${l!.house?1:0}`:'';
    if((this.lifted?.key??'')===key)return;this.unlift();if(!s)return;
    const figure=s.kind==='agent'&&!l!.house?this.nearby.get(s.id)??this.sail.figureOf(s.id):undefined;
    const roots:THREE.Object3D[]=s.kind==='building'?[this.buildingRoots.get(s.id)!]:s.kind==='observatory'?[this.observatory.root,this.observatory.pepe]:s.kind==='cable'?[this.ride.cable.stations[s.id==='top'?1:0]]:figure?[figure.root]:[];
    const lifted:NonNullable<typeof this.lifted>={key,roots,mats:[],cols:[],shown:[]};
    for(const r of roots)r.traverse(o=>{
      if(!(o instanceof THREE.Mesh||o instanceof THREE.Sprite))return;const was=o.material as THREE.Material|THREE.Material[],clones:THREE.Material[]=[];
      const next=(Array.isArray(was)?was:[was]).map(m=>{if(!liftable(m))return m;const c=liftMaterial(m);clones.push(c);return c;});
      if(clones.length){o.material=Array.isArray(was)?next:next[0] as never;lifted.mats.push([o,was,clones]);}
    });
    if(s.kind==='agent'&&!figure)for(const set of this.houseSets){const i=set.ids.indexOf(s.id);if(i<0)continue;
      for(const m of set.meshes)if(m.instanceColor){const c=new THREE.Color();m.getColorAt(i,c);lifted.cols.push([m,i,c]);m.setColorAt(i,c.clone().multiplyScalar(1.6));m.instanceColor.needsUpdate=true;}}
    // A boat stop: its shelter's instance colour lifted as a house's is, and its deck's warm sheet shown, together.
    if(s.kind==='stop'){const i=SHELTERS.findIndex(h=>h.stop===s.id),m=this.stopShelters;
      if(i>=0&&m.instanceColor){const c=new THREE.Color();m.getColorAt(i,c);lifted.cols.push([m,i,c]);m.setColorAt(i,c.clone().multiplyScalar(1.35));m.instanceColor.needsUpdate=true;}
      const sheet=this.stopDecks.getObjectByName('stop-lift:'+s.id);if(sheet){sheet.visible=true;lifted.shown.push(sheet);}}
    this.lifted=lifted;
  }
  private unlift(){
    const l=this.lifted;if(!l)return;this.lifted=null;
    for(const [o,was,clones] of l.mats){o.material=was as never;for(const c of clones)c.dispose();}
    for(const [m,i,c] of l.cols){m.setColorAt(i,c);m.instanceColor!.needsUpdate=true;}
    for(const o of l.shown)o.visible=false;
  }
  /** How far the player stands from a place's edge: a label click opens it within OPEN_WITHIN, beyond that it travels. */
  private edge(s:Selection){if(s.kind==='cable'&&this.mountainTour)return this.mountainTour.stationDistance(s.id==='top'?1:0);return placeEdge(this.player.root.position,s,this.positions)??Infinity;}
  private cableTravel(end:End){return this.mountainTour?this.mountainTour.stationDistance(end)>4:cableClick(this.player.root.position,end).board===null;}
  /** What is under a screen point: a label first (labels.ts: they draw over the scene, so the one you see is the one you
   *  reach; a finger reaches a 44 px box), then the nearest building, figure, house or lot, else the ground. */
  private pick(x:number,y:number,touch=false){
    const rect=this.renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.layers.enableAll();ray.setFromCamera(new THREE.Vector2((x-rect.left)/rect.width*2-1,1-(y-rect.top)/rect.height*2),this.camera);
    const i=labelAt(this.tags.map(t=>t.target.kind==='agent'&&!this.positions.has(t.target.id)?null:pickBox(t)),x-rect.left,y-rect.top,touch?TAP_TARGET:0);
    if(i>=0){const t=this.tags[i];return {selection:t.target as Selection|null,point:null,travel:t.target.kind==='cable'?this.cableTravel(t.target.id==='top'?1:0):t.sign||labelIntent(this.edge(t.target))==='travel',house:false};}
    let nearest:Selection|null=null,depth=Infinity,house=false;
    for(const b of LANDMARKS){const y=this.buildingRoots.get(b.id)!.position.y,p=ray.ray.intersectBox(new THREE.Box3(new THREE.Vector3(b.x-b.radius,y,b.z-b.radius),new THREE.Vector3(b.x+b.radius,y+landmarkTop(b.id),b.z+b.radius)),new THREE.Vector3());if(p&&ray.ray.origin.distanceTo(p)<depth){depth=ray.ray.origin.distanceTo(p);nearest={kind:'building',id:b.id};}}
    for(const root of [this.observatory.root,this.observatory.pepe]){const hit=ray.intersectObject(root,true)[0];if(hit&&hit.distance<depth){nearest={kind:'observatory',id:'observatory'};depth=hit.distance;}}
    {const hit=ray.intersectObject(this.pier.group,true)[0];if(hit&&hit.distance<depth){nearest={kind:'building',id:'launch'};depth=hit.distance;}}   // the beacon and hour lamps stand past the dais
    {const hit=this.ride.cable.pick(ray,Date.now()/1000,this.reduced);if(hit&&hit.distance<depth){nearest={kind:'cable',id:hit.end?'top':'valley'};depth=hit.distance;}}   // a station, or a cabin in one
    {const hit=ray.intersectObject(this.stopShelters,false)[0];if(hit&&hit.instanceId!==undefined&&hit.distance<depth){nearest={kind:'stop',id:SHELTERS[hit.instanceId].stop};depth=hit.distance;}}   // a stop's shelter
    {const hit=ray.intersectObject(this.stopDecks,true)[0];if(hit&&hit.distance<depth){nearest={kind:'stop',id:hit.object.name.slice('stop-lift:'.length)};depth=hit.distance;}}   // or its deck
    if(this.lotMarkers){const hit=ray.intersectObject(this.lotMarkers)[0];if(hit&&hit.instanceId!==undefined&&hit.distance<depth){nearest={kind:'lot',id:String(hit.instanceId)};depth=hit.distance;}}
    for(const set of this.houseSets){const hit=set.meshes.map(m=>this.housePickIndex.first(ray,m)).filter((hit):hit is THREE.Intersection=>hit!==undefined).sort((a,b)=>a.distance-b.distance)[0];if(hit&&hit.instanceId!==undefined&&hit.distance<depth){nearest={kind:'agent',id:set.ids[hit.instanceId]};depth=hit.distance;house=true;}}
    for(const [id,f]of this.nearby){const hit=ray.intersectObject(f.root,true)[0];if(hit&&hit.distance<depth){nearest={kind:'agent',id};depth=hit.distance;house=false;}}
    {const hit=this.sail.pick(ray,this.selected?.kind==='agent'?this.selected.id:null);if(hit&&hit.distance<depth){nearest={kind:'agent',id:hit.id};depth=hit.distance;house=false;}}   // a rider, or a hull's next rider
    // Terrain is a heightfield: refine the hit by re-intersecting at the height found under the previous guess.
    let ground:THREE.Vector3|null=null,h=0;for(let i=0;i<4;i++){ground=ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-h),new THREE.Vector3());if(!ground)break;h=terrainHeight(ground.x,ground.z);}
    return {selection:nearest,point:ground?{x:ground.x,z:ground.z}:null,travel:nearest?.kind==='cable'?this.cableTravel(nearest.id==='top'?1:0):nearest?.kind==='stop'&&!stopClick(this.player.root.position,nearest.id).board,house:house&&nearest?.kind==='agent'};
  }
  private size(){if(this.suspended)return;/* resume() measures again */const {width,height}=this.host.getBoundingClientRect();if(!width||!height)return;this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    this.viewWidth=width;this.viewHeight=height;this.viewShift=NaN;this.band={top:NaN,bottom:NaN};this.measureBand();this.fitFarLabels();}
  /** The rows of the canvas on screen right now (visibleBand); refits the panorama only when they change. */
  private measureBand(){
    const r=this.host.getBoundingClientRect();if(!r.width||!r.height)return;
    const band=visibleBand(r.top,r.height,window.innerHeight);if(band.top===this.band.top&&band.bottom===this.band.bottom)return;
    this.band=band;this.refreshExtent();
  }
  /** Maximum zoom frames the whole walkable world in the on-screen band (portrait phones need a longer pull-back). */
  private refreshExtent(){
    const fit=bandFit(this.viewWidth,this.viewHeight,this.band);
    this.circle=worldCircle(this.ember);this.maxZoom=maxZoomFor(fit.aspect,this.ember,fit.fov);this.bandShift=fit.shift;
    if(this.zoomGoal!==null)this.zoomGoal=clampZoom(this.zoomGoal,this.maxZoom);this.zoom=clampZoom(this.zoom,this.maxZoom);
  }
  /** Panorama labels: landmarks and the two villages (and your home, see setHomeLabel), in the current language. */
  private buildFarLabels(){
    for(const l of this.farLabels)this.disposeFarLabel(l);
    const zh=this.language==='zh',list:FarLabel[]=[];
    for(const v of VILLAGE_LABELS){const text=zh?v.zh+' '+v.en:v.en,l=farLabel(text,'village',v.x,v.z,terrainHeight(v.x,v.z)+14,v.id);l.name=this.nameLabels.create('village:'+v.id,text);list.push(l);}
    for(const b of LANDMARKS){const text=zh?b.name:b.en,l=farLabel(text,'landmark',b.x,b.z,terrainHeight(b.x,b.z)+farLabelRise(b.id),b.id);l.name=this.nameLabels.create('building:'+b.id,text);list.push(l);}
    this.farLabels=list;for(const l of list){if(l.name)l.sprite.visible=false;this.scene.add(l.sprite);}
    if(this.homeLabel){const h=this.homeLabel;this.homeLabel=undefined;this.setHomeLabel(h.sprite.userData.text as string,h.x,h.z,h.y-12);this.disposeFarLabel(h);}
    this.orderFarLabels();this.fitFarLabels();
  }
  private setHomeLabel(text:string|null,x=0,z=0,y=0){
    if(this.homeLabel){this.disposeFarLabel(this.homeLabel);this.homeLabel=undefined;}
    if(text!==null){const l=farLabel(text,'home',x,z,y+12,'home');l.sprite.userData.text=text;l.name=this.homeName=this.nameLabels.create('home:own',text);this.homeLabel=l;this.scene.add(l.sprite);}
    else if(this.homeName){this.nameLabels.unregister(this.homeName);this.homeName.element.remove();this.homeName=undefined;}
    this.orderFarLabels();this.fitFarLabels();
  }
  /** Declutter priority: the two villages, your home, then the landmarks. */
  private farOrder:FarLabel[]=[];
  private orderFarLabels(){const [ember,frost,...landmarks]=this.farLabels;this.farOrder=[ember,frost,...(this.homeLabel?[this.homeLabel]:[]),...landmarks].filter(Boolean);}
  private disposeFarLabel(l:FarLabel){this.scene.remove(l.sprite);l.sprite.material.map?.dispose();l.sprite.material.dispose();}
  /** sizeAttenuation-off sprites are sized in units of the frustum height at depth 1: convert CSS pixels to that. */
  private fitFarLabels(){const k=2*Math.tan(CAMERA_FOV*Math.PI/360)/this.viewHeight;for(const l of this.farOrder)l.sprite.scale.set(l.w*k,l.h*k,1);this.pin.sprite.scale.set(this.pin.w*k,this.pin.h*k,1);}

  /** Camera, fog, clip planes, sun and shadow, and the outskirts for the current zoom (overview.ts). At or below 80 m
   *  this is exactly the play camera it always was; beyond, the view eases into the whole-world panorama: pitch
   *  biased toward top-down, the look point sliding to the world's centre, fog thinning, shadows fading out.
   *  dt = Infinity snaps (dev capture). */
  private frameView(dt:number){
    const hero=this.player.root.position,w=panoWeight(this.zoom,this.maxZoom),far=this.zoom>PLAY_MAX_ZOOM;
    // Inside the hall the camera tilts down over the north wing and arch (they would otherwise block the view).
    const hallView=this.cameraMode==='person'&&inBox(HALL_BOX,hero.x,hero.z,.8);
    let pitch=panoPitch(hallView?Math.max(this.pitch,1.05):Math.max(this.pitch,this.rideFloor),w),floor=-Infinity;
    const look=this.cameraMode==='god'?this.cameraTarget:panoLook(this.cameraTarget,this.circle,w);this.look.set(look.x,look.y,look.z);
    // Past play distance the camera must not end up behind a valley rim or under the snow ranges: when the line to
    // the look point is blocked, the pitch rises (at once, so no frame is blocked) just enough to clear it.
    if(far){const clear=this.clearance(pitch);if(clear>pitch){floor=clear;pitch=clear;}}
    this.viewPitch+=(pitch-this.viewPitch)*Math.min(1,dt*4);if(this.viewPitch<floor)this.viewPitch=floor;this.pitchGap=Math.abs(pitch-this.viewPitch);
    const eye=orbitPosition(look,this.yaw,this.viewPitch,this.zoom);this.camera.position.set(eye.x,eye.y,eye.z);
    const ground=this.cameraMode==='god'?Math.max(this.ground(eye.x,eye.z),this.cameraGround({x:eye.x,z:eye.z})):far?this.ground(eye.x,eye.z):terrainHeight(eye.x,eye.z);   // the outskirts are drawn only past 80 m
    this.camera.position.y=Math.max(this.camera.position.y,ground+1.5);this.camera.lookAt(this.look);
    // Short landscape pages: centre the panorama in the on-screen band of the canvas (bandFit).
    const shift=Math.round(this.bandShift*w);
    if(shift!==this.viewShift){this.viewShift=shift;if(shift)this.camera.setViewOffset(this.viewWidth,this.viewHeight,0,shift,this.viewWidth,this.viewHeight);else this.camera.clearViewOffset();}
    const sunAt=panoLook(hero,this.circle,w);const key=this.daynight.offset;this.sun.position.set(sunAt.x+key.x,sunAt.y+key.y,sunAt.z+key.z);this.sun.target.position.set(sunAt.x,sunAt.y,sunAt.z);
    (this.scene.fog as THREE.FogExp2).density=fogDensity(this.zoom);
    const clip=cameraClip(this.zoom,w);
    if(clip.near!==this.clip.near||clip.far!==this.clip.far){this.clip=clip;this.camera.near=clip.near;this.camera.far=clip.far;this.camera.updateProjectionMatrix();}
    // Shadow strength is a uniform (no shader rebuild); at 0 the shadow pass is skipped altogether.
    const shadow=shadowStrength(this.zoom);
    if(shadow!==this.shadowK){if(shadow>0&&this.shadowK<=0)this.sun.shadow.needsUpdate=true;this.shadowK=shadow;this.sun.shadow.intensity=shadow;this.sun.shadow.autoUpdate=false;}
    this.outskirts.visible=far;
    const backK=backdropAlpha(this.zoom);
    if(backK!==this.backdropK&&this.backdrop){this.backdropK=backK;this.backdrop.visible=backK>0;for(const m of this.backdropMaterials)m.opacity=backK;}
    const fine=fineDetailVisible(this.zoom,this.viewHeight);
    if(fine!==this.fineShown){this.fineShown=fine;if(fine)this.camera.layers.enable(1);else{this.tagFineDetail();this.camera.layers.disable(1);}}
    this.camera.updateMatrixWorld();
  }
  /** viewClearance for the current look point, yaw, pitch and zoom (over the drawn terrain and the outskirts),
   *  recomputed once one of them has moved more than a safety margin's worth (30 cm, 0.002 rad, 0.5 %): a still
   *  view costs nothing; a moving one re-samples up to a few hundred cheap height bounds every few frames. */
  private clearance(pitch:number){
    const key=this.clearKey,v=this.clearNow;v[0]=this.look.x;v[1]=this.look.y;v[2]=this.look.z;v[3]=this.yaw;v[4]=pitch;v[5]=Math.log(this.zoom);
    let same=true;for(let i=0;i<6;i++)if(!(Math.abs(v[i]-key[i])<(i<3?.3:i<5?.002:.005))){same=false;break;}
    if(!same){key.set(v);this.clearValue=viewClearance(this.look,this.yaw,pitch,this.zoom,this.ground);}
    return this.clearValue;
  }
  /** In-world labels fade out past 80 m (they are world-sized and would shrink to specks); the panorama labels
   *  (villages, your home, landmarks, in that priority) fade in and are decluttered in screen space. The clickable ones
   *  are layered (labelTier.ts layerLabels): a name is dimmed unless you stand near its place or the mouse is over it, a
   *  road sign dimmed unless within 10 m or under the mouse, shown only near you, never in the panorama, and fading out
   *  where it would cover a name or a beacon tag; dimmed, both stay clickable. Opacities ease over EASE_MS (dtMs since
   *  the last frame; Infinity: at once). */
  /** The frame's inputs to layerLabels, one object reused. */
  private layer:LayerEnv={fade:0,wall:false,play:true,beaconed:new Set(),hero:{x:0,z:0},hover:null,mouse:null,names:[],tags:[],dtMs:Infinity,reduced:false};
  private simpleName(sprite:THREE.Sprite,key:string,visible:boolean){
    sprite.visible=false;if(farLabelAlpha(this.zoom)>=.5)return;
    const name=this.nameLabels.create(key,String(sprite.userData.text??'')),p=sprite.position;
    projectPoint(this.camera,this.viewWidth,this.viewHeight,key,p.x,p.y,p.z,this.probe);
    this.nameLabels.place(name,{x:this.probe.x,y:this.probe.y,depth:this.probe.depth,align:'center',visible:visible&&!this.paused&&!this.probe.behind&&this.probe.onScreen});
    sprite.visible=false;
  }
  private fadeLabels(dtMs=Infinity){
    const near=nearLabelAlpha(this.zoom),far=farLabelAlpha(this.zoom),wall=this.near?.kind==='observatory',hero=this.player.root.position,e=this.layer;
    this.nameReserved.length=0;
    for(const sign of this.labels){
      if(sign.name==='frost-label'||sign.name==='spire-label')this.simpleName(sign,sign.name==='frost-label'?'village:frosthollow':'building:belfry',this.buildingNamesShown&&near>=.5&&!wall);
      else{sign.visible=this.buildingNamesShown&&near>0&&!wall;sign.material.opacity=near;}
    }
    e.fade=near;e.wall=wall;e.play=this.zoom<=PLAY_MAX_ZOOM;e.beaconed=this.beaconed;e.hero=this.cameraMode==='god'?this.cameraTarget:hero;e.hover=this.hover;e.mouse=this.mouseOn?this.mouseAt:null;
    e.names=this.nameBoxes;e.tags=this.screen?.tags??NO_EDGES;e.dtMs=dtMs;e.reduced=this.reduced;e.buildingNames=this.buildingNamesShown;
    for(const n of this.stopNames){const a=this.buildingNamesShown?near*signAlpha(Math.hypot(hero.x-n.x,hero.z-n.z),e.play,false):0;this.simpleName(n.sprite,`stop:${n.x},${n.z}`,a>=.5&&!wall);}
    stationsCover(this.tags,this.camera.position,e.play&&!this.mountainTour);layerLabels(this.tags,e);
    for(const t of this.tags){t.sprite.visible=!t.name&&t.alpha>0;t.sprite.material.opacity=t.alpha;}
    const home=this.myHome?.getObjectByName('my-home-label') as THREE.Sprite|undefined;if(home){home.visible=false;
      if(this.homeName&&far<.5){home.getWorldPosition(this.corner);projectPoint(this.camera,this.viewWidth,this.viewHeight,'home:own',this.corner.x,this.corner.y,this.corner.z,this.probe);
        this.nameLabels.place(this.homeName,{x:this.probe.x,y:this.probe.y,depth:this.probe.depth,align:'center',visible:this.buildingNamesShown&&near>=.5&&!this.paused&&!this.probe.behind&&this.probe.onScreen});}}
    const all=this.farOrder,pin=this.pin.sprite;
    if(far<=0){if(this.farAlpha>0){for(const l of all)l.sprite.visible=false;pin.visible=false;}this.farAlpha=far;return;}
    this.farAlpha=far;
    pin.position.set(hero.x,hero.y+.3,hero.z);pin.visible=true;pin.material.opacity=far;
    // Labels step aside (below, then above their point) rather than sit under the pin or each other (placeLabels).
    const at=this.corner.set(hero.x,hero.y,hero.z).project(this.camera),pw=this.pin.w,ph=this.pin.h;
    const reserved:Rect[]=at.z<1?[{x:(at.x+1)/2*this.viewWidth-pw/2,y:(1-at.y)/2*this.viewHeight-ph,w:pw,h:ph}]:[];
    this.nameReserved.push(...reserved.map(r=>({left:r.x,top:r.y,width:r.w,height:r.h})));
    const items=all.map(l=>{
      if(!this.buildingNamesShown)return null;
      const p=this.corner.set(l.x,l.y,l.z).project(this.camera);if(p.z>1||Math.abs(p.x)>1.05||Math.abs(p.y)>1.05)return null;
      const w=l.name?.size.width||l.w,h=l.name?.size.height||l.h,x=(p.x+1)/2*this.viewWidth-w/2,y=(1-p.y)/2*this.viewHeight-h/2;
      return LABEL_SLOTS.map(s=>({x,y:y+s*h,w,h}) as Rect);});
    const slots=placeLabels(items,6,reserved);
    all.forEach((l,i)=>{const k=slots[i];l.sprite.visible=!l.name&&k>=0;l.sprite.material.opacity=far;if(k>=0)l.sprite.center.y=.5+LABEL_SLOTS[k];
      if(l.name&&far>=.5){const r=k>=0?items[i]?.[k]:null;this.nameLabels.place(l.name,{x:r?r.x+r.w/2:0,y:r?r.y+r.h/2:0,align:'center',priority:l.id==='emberford'||l.id==='frosthollow'?2:0,visible:!!r&&this.buildingNamesShown&&!this.paused});}
    });
  }
  /** Building plates keep their text at 14 CSS px; their native boxes also drive canvas picking.
   *  Agent labels retain their existing sprite fit. Providers retain the distance and coverage rules. */
  private fitTags(){
    const min=this.mobile?LABEL_MIN_PX.touch:LABEL_MIN_PX.fine;
    for(const t of this.tags){
      if(t.name){t.sprite.visible=false;if(!t.sign&&farLabelAlpha(this.zoom)>=.5){t.box.shown=false;continue;}
        projectPoint(this.camera,this.viewWidth,this.viewHeight,t.key,t.at.x,t.at.y,t.at.z,this.probe);t.box.depth=this.probe.depth;
        this.nameLabels.place(t.name,{x:this.probe.x,y:this.probe.y,depth:this.probe.depth,align:'center',priority:t.near?1:0,visible:t.fit&&t.pick&&!this.paused&&!this.probe.behind&&this.probe.onScreen,
          shown:(shown,box)=>{t.box.x=box.left+box.width/2;t.box.y=box.top+box.height/2;t.box.w=box.width;t.box.h=box.height;t.box.shown=shown;}});
        continue;
      }
      if(!t.fit){t.box.shown=false;continue;}fitLabel(this.camera,this.viewWidth,this.viewHeight,t,min);t.sprite.scale.set(t.base.x*t.k,t.base.y*t.k,1);
    }
  }
  /** Minimap pose: the player, the camera's facing and the ground the view covers (published only when it moves). */
  private poseLast=new Float64Array(9).fill(NaN);private poseNow=new Float64Array(9);
  private publishPose(){
    if(!this.pose)return;
    const hero=this.player.root.position,c=this.camera.position,v=this.poseNow,last=this.poseLast,pano=panoWeight(this.zoom,this.maxZoom);
    v[0]=hero.x;v[1]=hero.z;v[2]=this.yaw;v[3]=c.x;v[4]=c.y;v[5]=c.z;v[6]=this.camera.aspect;v[7]=this.zoom;v[8]=pano;
    let moved=false;for(let i=0;i<v.length;i++)if(!(Math.abs(v[i]-last[i])<1e-3)){moved=true;last[i]=v[i];}
    if(!moved)return;
    const ground=this.look.y-1,reach=Math.max(this.zoom*3,150),footprint:Point[]=[];
    for(const [nx,ny] of FRUSTUM_CORNERS){
      const d=this.corner.set(nx,ny,.5).unproject(this.camera).sub(c).normalize(),flat=Math.hypot(d.x,d.z)||1e-6;
      let t=d.y<-1e-4?(ground-c.y)/d.y:Infinity;if(!(t>0))t=Infinity;t=Math.min(t,reach/flat);
      footprint.push({x:c.x+d.x*t,z:c.z+d.z*t});
    }
    this.pose.publish({x:hero.x,z:hero.z,yaw:this.yaw,zoom:this.zoom,pano,footprint});
  }
  /** Screen points for the DOM marks (screenSpace.ts), after render: you above the head until the panorama's pin
   *  takes over, the beacon tags' anchors while in-world labels show, and the boxes of the road signs you can see (and
   *  click), which the tags keep clear of.
   *  Nothing is projected while a drawer pauses the world. */
  private signBlocks=DISTRICTS.map(()=>({left:0,right:0,top:0,bottom:0}));
  private projectMarks(){
    const s=this.screen;if(!s)return;if(this.paused){s.hide();return;}
    let n=0;s.blocks.length=0;for(const t of this.tags)if(t.block&&t.box.w>0&&t.box.h>0&&t.box.depth>this.camera.near&&t.box.x>=0&&t.box.x<=this.viewWidth&&t.box.y>=0&&t.box.y<=this.viewHeight&&n<this.signBlocks.length){const b=this.signBlocks[n++],x=t.box;b.left=x.x-x.w/2;b.right=x.x+x.w/2;b.top=x.y-x.h/2;b.bottom=x.y+x.h/2;s.blocks.push(b);}
    const hero=this.player.root.position;s.project(this.camera,this.viewWidth,this.viewHeight,farLabelAlpha(this.zoom)>0?null:this.head.set(hero.x,hero.y+2.2,hero.z),nearLabelAlpha(this.zoom)>=.5);
  }
  /** Moves small single meshes (world radius under FINE_DETAIL_RADIUS) to layer 1, which the camera stops drawing at
   *  panorama distances on short screens. Re-run each time, since Tripo models arrive after start-up. Picking
   *  tests every layer, and so does the shadow pass while layer 1 is on (it follows the camera's layers). */
  private tagFineDetail(){
    this.scene.updateMatrixWorld();
    this.scene.traverse(o=>{if(!(o instanceof THREE.Mesh)||o instanceof THREE.InstancedMesh||o.layers.mask!==1)return;
      const g=o.geometry as THREE.BufferGeometry;if(!g.boundingSphere)g.computeBoundingSphere();
      if(g.boundingSphere&&g.boundingSphere.radius*o.matrixWorld.getMaxScaleOnAxis()<FINE_DETAIL_RADIUS)o.layers.set(1);});
  }
  /** Dev capture: apply the current rig state (player, target, yaw, pitch, zoom) at once, as a frame would. */
  applyView(){this.frameView(Infinity);this.cutStations();this.nearTags();this.fadeLabels();this.fitTags();}
  /** A cable car station standing between the camera and you (cableCar.ts stationsHiding: a cabin carries you through it,
   *  and the ride's camera looks down into it) is drawn without its canopy while it does (skin/cableCar.ts
   *  CableCar.cutaway: the hall over its deck and its roof; the rest stays solid), whole again once it does not; only at
   *  play distance. */
  private cutStations(){this.ride.cable.cutaway(this.zoom<=PLAY_MAX_ZOOM&&!this.suspended&&!this.mountainTour?stationsHiding(this.camera.position,this.player.root.position):[]);}
  private animate=(now:number)=>{
    this.initDiagnostics?.beginFrame();
    this.frameMetrics?.begin();
    this.frame=requestAnimationFrame(this.animate);const dt=Math.max(0,Math.min((now-this.last)/1000,.05));this.last=now;
    if(document.hidden){this.initDiagnostics?.skipFrame();this.frameMetrics?.skip();this.nativeActivity?.update(now,this.camera,this.player.root.position,this.reduced,true,this.zoom);this.updateCityActivity(now,Date.now(),true);return;}   // the first frame's stamp can precede `last`
    this.refreshHouseModels();
    const hero=this.player.root.position;let vx=0,vz=0;
    if(this.cameraMode==='god'&&this.frozenPerson){hero.copy(this.frozenPerson.position);this.player.root.rotation.copy(this.frozenPerson.rotation);}
    const riding=this.ride.aboard||!!this.mountainTour?.aboard;if(riding)this.target=this.approach=null;   // aboard a 燼舟 you sit: no walking
    if(!this.paused&&!riding&&this.cameraMode==='person'){
      const x=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0)+this.stick.x;
      const z=(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)-(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)+this.stick.z;
      const speed=this.keys.has('ShiftLeft')?RUN_SPEED:WALK_SPEED,baseBlocked=walkBlocked(this.homeBoxes,this.bound,this.mountainTour?'all':false,this.homeIndex),blocked=(p:Point)=>(this.mountainTour?.blocked(p,baseBlocked(p))??baseBlocked(p))||!!this.publicHalls?.blocked(p);
      if(this.target&&!x&&!z){const going=steerStep(hero,this.target,speed*dt,dt,blocked);vx=this.target.vx;vz=this.target.vz;if(!going)this.target=null;}   // tap-to-walk steers around solids (collision.ts)
      else {const w=walkStep(hero,x,z,this.yaw,speed*dt,blocked);vx=w.vx;vz=w.vz;if(w.hit)this.target=null;}
      const a=this.approach;if(a&&this.target!==a.steer){this.approach=null;if(Math.hypot(hero.x-a.steer.x,hero.z-a.steer.z)<1.5)this.onArrive(a.done);else a.lost();}   // ended on its own: arrived, or stuck
      hero.y=this.publicHalls?.groundAt(hero,terrainHeight(hero.x,hero.z))??terrainHeight(hero.x,hero.z);
      hero.y=this.mountainTour?.groundAt(hero,hero.y)??hero.y;
      this.showHallInside(inBox(HALL_BOX,hero.x,hero.z,.8)&&this.zoom<=PLAY_MAX_ZOOM);   // from afar the hall keeps its roof
    }
    if(!this.paused&&this.cameraMode==='god'){const x=(this.keys.has('KeyD')||this.keys.has('ArrowRight')?1:0)-(this.keys.has('KeyA')||this.keys.has('ArrowLeft')?1:0)+this.stick.x,z=(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)-(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)+this.stick.z;if(x||z)this.panGodCamera(freeCameraStep(this.cameraTarget,{x,z},this.yaw,this.zoom,dt,this.keys.has('ShiftLeft')));}
    if(this.zoomGoal!==null){this.zoom=easeZoom(this.zoom,this.zoomGoal,dt);if(this.zoom===this.zoomGoal)this.zoomGoal=null;}
    if(this.zoom>PLAY_MAX_ZOOM)this.lastFar=now;
    const walking=Math.hypot(vx,vz)>.05;if(walking)this.player.root.rotation.y=Math.atan2(vx,vz);
    this.cityActivity?.setSelected(this.selected?.kind==='agent'?this.selected.id:null);
    this.updateCityActivity(now,Date.now(),false);
    this.halo.scale.setScalar(THREE.MathUtils.clamp(this.zoom/34,.85,1.6));   // still a readable ring from the first-visit framing
    this.player.legs.children.forEach((leg,i)=>{leg.rotation.x=walking?Math.sin(now*.01+i*Math.PI)*.5:0;});
    this.player.arms.children.forEach((arm,i)=>{arm.rotation.x=walking?-Math.sin(now*.01+i*Math.PI)*.45:0;});
    for(const [id,f]of this.nearby){
      if(this.ownsActivityResident(id)){if(!this.nativeHidden.has(f))this.nativeHidden.set(f,f.root.visible);f.root.visible=false;}
      else if(this.nativeHidden.has(f)){f.root.visible=this.nativeHidden.get(f)!;this.nativeHidden.delete(f);}
      const a=this.agents.get(id),work=!this.cityActivity?.active&&!!a&&isWorking(a);f.arms.children.forEach((arm,i)=>{arm.rotation.x=work&&!this.reduced?-.8+Math.sin(now*.004+i)*.3:0;});}
    this.heartCore.animate(now,this.reduced||!!this.cityActivity?.active&&this.cityActivity.store.getSnapshot().civic.get('heart')?.active!==true);this.skin.animate(now,dt,this.reduced);this.plaza.animate(now,dt,this.reduced);
    this.doorLamps.setZoom(this.zoom);this.doorLamps.animate(now,this.reduced);this.sparks.animate(dt,this.mood.wind,this.reduced);
    // A brilliant sky's burst when one is due, one in the air cut short once the sky drawn is not brilliant (skyShow.ts:
    // the drawn sky, reduced motion, cover, a slow device, a show in the air).
    const worldFireworks=this.worldSkyPreview||wholeWorldSky(this.skyQuote);
    const fireworksWeather=this.fireworksWeather(),skyMode=fireworksWeather==='brilliant'?(worldFireworks?'world':'city'):'off';
    if(this.renderer.domElement.dataset.skyShow!==skyMode)this.renderer.domElement.dataset.skyShow=skyMode;
    if(this.skyShow.frame(now,{weather:fireworksWeather,reduced:this.reduced,open:this.uncovered&&!this.paused,slow:this.slow,world:worldFireworks},this.fireworks))this.renderer.domElement.dataset.skyBursts=String(++this.skyBursts);
    this.fireworks.setZoom(this.zoom);this.fireworks.animate(now);
    // 'market' means the bounded three-wave show is active, including rocket travel and the short gaps between waves.
    const skyActive=this.fireworks.bursting?'market':this.fireworks.playing?'milestone':'off';
    if(this.renderer.domElement.dataset.skyActive!==skyActive)this.renderer.domElement.dataset.skyActive=skyActive;
    this.ease(now);if(this.benchmarkQuality){this.zoom=this.benchmarkQuality.zoom;this.zoomGoal=null;}const cut=this.cut;this.cut=false;
    if(this.cameraMode==='person')this.cameraTarget.lerp(FOLLOW.set(hero.x+this.lead.x,this.publicHalls?.cameraFocusY??hero.y+1,hero.z+this.lead.z),cut?1:1-Math.exp(-dt*6));
    this.frameView(cut?Infinity:dt);this.cutStations();this.nameLabels.begin(this.viewWidth,this.viewHeight);
    if(this.arrival){const a=this.arrival,step=arrivalStep({elapsed:now-a.since,walked:Math.hypot(hero.x-a.at.x,hero.z-a.at.z),look:this.cameraTarget.distanceTo(FOLLOW),pitch:this.pitchGap,zooming:this.zoomGoal!==null,dragging:this.pointers.size>0});
      if(step!=='wait'){this.arrival=null;if(step==='open')a.done();}}
    const sky=gentleSky(this.weather,WEATHER_SKY),blend=1-Math.exp(-dt*1.5);
    // The sky eases in skyNow (set afresh each frame: the lightning's flash, skin/weather.ts, lifts only the copy drawn).
    this.skyNow.lerp(SKY.setHex(sky.color),blend);this.sunLevel=THREE.MathUtils.lerp(this.sunLevel,sky.sun,blend);
    // The world time (skin/daynight.ts) tints it into the background and fog and sets the key light and the sky light;
    // the rain lights the windows and lamps by day, and its streaks and wet ground follow the night's glow.
    this.daynight.cosy=this.rain.cosy;this.rain.daylight=this.daynight.update(Date.now(),this.camera,this.clip.far,this.skyNow,this.sunLevel,this.scene.background as THREE.Color,(this.scene.fog as THREE.FogExp2).color,this.scene.fog as THREE.FogExp2);this.rain.night=this.daynight.glow;
    this.civicBuildingGlow.update(this.daynight.glow,now,this.civicFillRoots);
    this.nativeActivity?.update(now,this.camera,hero,this.reduced,false,this.zoom);
    this.glows.update(this.daynight.glow);
    this.sail.update(Date.now()/1000,this.water.water.position.y,this.reduced,this.cameraTarget,this.zoom<=PLAY_MAX_ZOOM?RIDER_REACH[this.mobile?'touch':'fine']:0,this.nearby);   // wall-clock: the same boats in every browser
    // Rain: the 24h tier's own rain plus a shower when the last hour fell more than 5 %, leaned by the wind (market.ts, skin/weather.ts).
    this.rain.update(dt,this.camera,this.zoom,this.renderer.domElement.height,this.scene.fog as THREE.FogExp2);
    this.pepeDecor.update(dt,this.rain.windNow,this.daynight.glow,this.zoom,this.reduced);
    this.observatory.update(now,this.daynight.glow,this.reduced,this.hemi,this.camera.position);   // the Pepe statue's ember and gold
    this.ears?.setRain(this.rain.level,this.weather,dt);this.tune?.setWorld(this.weather,this.daynight.state.weights.night,this.daynight.preview!==null);
    this.near=null;let nearest=5;
    for(const b of LANDMARKS){const d=Math.hypot(hero.x-b.x,hero.z-b.z)-b.radius;if(d<nearest){nearest=d;this.near={kind:'building',id:b.id};}}
    for(const p of [OBSERVATORY,OBSERVATORY.pepe]){const d=Math.hypot(hero.x-p.x,hero.z-p.z)-2.8;if(d<nearest){nearest=d;this.near={kind:'observatory',id:'observatory'};}}
    for(const [id,p]of this.positions){const d=Math.hypot(hero.x-p.x,hero.z-p.z);if(d<nearest){nearest=d;this.near={kind:'agent',id};}}
    // 燼舟: a pier's boarding zone takes the E key from a landmark farther away; then the player's boat and your seat in it.
    const nativeRide=this.ride.update(Date.now()/1000,this.water.water.position.y,this.reduced,this.cameraMode==='god'||this.mountainTour?.aboard?{x:1e6,z:1e6}:hero,nearest);
    const tourRide=this.mountainTour?.update(Date.now()/1000,this.viewWidth,this.viewHeight,this.held||this.suspended||this.ride.busy);
    const ride=tourRide?{...tourRide,landing:false}:nativeRide;if(ride.landing)this.near=null;
    if(this.boardAt){if(ride.landing&&!this.ride.busy){this.boardAt=0;this.interact();}else if(performance.now()>this.boardAt)this.boardAt=0;}   // a stop's click (stopClick): aboard once you stand at itthis.halo.visible=!ride.aboard;this.rideFloor=ride.floor;
    if(ride.seated&&this.zoom<=PLAY_MAX_ZOOM)this.easeZoomTo(ride.zoom??(this.mobile&&this.viewHeight>this.viewWidth?22:18));
    {const f=this.ride.fade(Date.now()/1000);if(f!==this.fadeK){this.fadeK=f;this.fadeEl.style.opacity=f.toFixed(3);}}
    if(this.cameraMode==='person'&&ride.ashore){hero.set(ride.ashore.x,this.mountainTour?.groundAt(ride.ashore,terrainHeight(ride.ashore.x,ride.ashore.z))??terrainHeight(ride.ashore.x,ride.ashore.z),ride.ashore.z);this.player.root.rotation.y=this.yaw=ride.ashore.yaw;this.screen?.teleported();}   // the Map's own view of the stop
    // The camera eases round behind the boat, unless you turned it in the last 3 s (never under reduced motion).
    if(this.cameraMode==='person'&&ride.seated&&!this.reduced&&now-this.dragAt>3000)this.yaw=ride.heading+Math.PI;   // sitting down: a cut to behind the boat, not a swing through the quay
    if(this.cameraMode==='person'&&ride.aboard&&!this.reduced&&now-this.dragAt>3000){const d=ride.heading+Math.PI-this.yaw;this.yaw+=Math.atan2(Math.sin(d),Math.cos(d))*(1-Math.exp(-dt*1.5));}
    if(this.near!==null&&ride.aboard)this.near=null;
    if(this.cameraMode==='god'&&this.frozenPerson){hero.copy(this.frozenPerson.position);this.player.root.rotation.copy(this.frozenPerson.rotation);}
    this.fadeLabels(dt*1000);this.fitTags();this.hoverFrame(now);
    this.drawBeacons(now);
    // The gold torus is the hover outline only (a tap's flash too): the rings say what to click (onboarding 04).
    const selection=this.hover??this.flashing?.selection??null;this.glow.visible=!!selection&&selection.kind!=='stop'&&!(selection.kind==='agent'&&this.sail.riding(selection.id));   // a rider's own lift is its outline; a stop's is its deck's sheet
    if(selection&&selection.kind!=='stop'){const p=selection.kind==='agent'?this.positions.get(selection.id):selection.kind==='lot'?this.lots[Number(selection.id)]:selection.kind==='observatory'?OBSERVATORY:selection.kind==='cable'?CABLE_SOLIDS[selection.id==='top'?1:0]:LANDMARKS.find(b=>b.id===selection.id);if(p)this.glow.position.set(p.x,terrainHeight(p.x,p.z)+.18,p.z);const r=selection.kind==='building'?LANDMARKS.find(b=>b.id===selection.id)!.radius:selection.kind==='observatory'?3.9:selection.kind==='cable'?6.6:1.4;this.glow.scale.setScalar(r/1.2);}
    this.frames++;
    if(now-this.fpsAt>1000){this.fps=Math.round(this.frames*1000/(now-this.fpsAt));this.frames=0;this.fpsAt=now;
      // The slow-device fallback below never restores quality, so it only judges play distance: a visit to the
      // panorama (more of the world in view) must not leave the rest of the session at a lower resolution.
      const judging=now-this.startedAt>5000&&now-this.lastFar>1500;
      this.slowSamples=judging&&this.fps>0&&this.fps<22?this.slowSamples+1:0;
      if(this.slowSamples>=3&&!this.benchmarkQuality){this.slowSamples=0;this.slow=true;if(this.renderer.shadowMap.enabled){this.renderer.shadowMap.enabled=false;this.renderer.setPixelRatio(.9);this.size();}else if(this.renderer.getPixelRatio()>.7){this.renderer.setPixelRatio(.7);this.size();}}
    }
    this.publicHalls?.update(hero,this.viewWidth,this.viewHeight,this.held||this.suspended||!!this.ride.aboard||!!this.mountainTour?.aboard||this.mountainTour?.overlayOpen===true);
    this.nameLabels.commit([...this.nameReserved,...(this.screen?.tags??NO_EDGES).map(r=>({left:r.left,top:r.top,width:r.right-r.left,height:r.bottom-r.top}))]);
    this.decorativeLights.update(now,this.camera,this.cameraTarget);
    if(this.shadowCadence.update(now,this.sun.target.position,this.renderer.shadowMap.enabled&&this.shadowK>0,cut||this.renderer.shadowMap.needsUpdate||this.sun.shadow.needsUpdate)){
      this.renderer.shadowMap.needsUpdate=true;this.sun.shadow.needsUpdate=true;this.shadowUpdates++;
      if(this.frameMetrics)this.renderer.domElement.dataset.shadowUpdates=String(this.shadowUpdates);
    }
    if(this.debugModelLoads)this.renderer.domElement.dataset.decorativeLights=JSON.stringify(this.decorativeLights.stats);
    this.renderer.render(this.scene,this.camera);
    if(!this.firstFrameDrawn)this.initDiagnostics?.mark('firstRender');
    this.frameMetrics?.frame(now,{paused:this.paused,zoom:this.zoom,terrainReady:this.terrainReady});
    if(!this.firstFrameDrawn){this.firstFrameDrawn=true;
      if(this.debugModelLoads){this.renderer.domElement.dataset.firstWorldFrameMs=performance.now().toFixed(1);this.renderer.domElement.dataset.farModelsBeforeFirstFrame=String(modelLoadState().startedFar);}
      releaseFarModelLoads();const readyCallbackAt=this.initDiagnostics?.begin('onReadyCallback');this.onReady?.();this.initDiagnostics?.end('onReadyCallback',readyCallbackAt);this.initDiagnostics?.mark('onReady');
    }
    if(this.debugModelLoads){const state=modelLoadState(),key=[state.near,state.far,state.waiting,state.released,state.startedFar,state.peakFar].join(',');if(key!==this.modelBatchKey){this.modelBatchKey=key;this.renderer.domElement.dataset.modelBatches=JSON.stringify(state);}}
    this.publishPose();this.projectMarks();
    if(now-this.publishAt>250){this.publishAt=now;this.updateNearby();this.nearTags();this.checkDoor();this.renderer.domElement.dataset.camera=this.camera.position.toArray().map(n=>n.toFixed(2)).join(',');
      if(import.meta.env.DEV){const d=this.renderer.domElement.dataset;d.activityCheckFps=String(this.fps);d.activityCheckDrawCalls=String(this.renderer.info.render.calls);d.activityCheckShadows=String(this.renderer.shadowMap.enabled);d.activityCheckPixelRatio=String(this.renderer.getPixelRatio());d.cityZoom=String(this.zoom);}
      if(this.nativeActivity){const n=this.nativeActivity.diagnostics,d=this.renderer.domElement.dataset;
        d.nativeActors=String(n.actors);d.nativeMoving=String(n.moving);d.nativePose=n.pose;d.nativeWindowReady=String(n.windowReady);
        d.nativeEnabled=String(n.enabled);d.nativeFps=String(this.fps);d.nativeDrawCalls=String(this.renderer.info.render.calls);
        d.nativeDuplicateRiders=String(this.sail.riders.flat().filter(id=>this.nativeActivity!.ownsResident(id)).length);}
      if(this.cityActivity){const n=this.cityActivity.diagnostics,d=this.renderer.domElement.dataset;
        d.cityActors=String(n.residents.actors);d.cityMoving=String(n.residents.moving+n.civic.moving);d.cityWindows=String(n.windows.activeInstances);d.cityWindowPasses=String(n.windows.passes);
        d.cityPose=n.residents.pose;d.cityMode=this.cityActivity.store.getSnapshot().mode;d.cityFps=String(this.fps);d.cityDrawCalls=String(this.renderer.info.render.calls);
        d.cityPanoramaDomains=String(n.panorama.activeDomains);d.cityPanoramaParticles=String(n.panorama.particles);d.cityPanoramaCalls=String(n.panorama.drawCalls);
        d.forgePaintGlow=String(this.forgeModelGlow?.stats.level??0);d.forgePaintSupported=String(this.forgeModelGlow?.stats.supported??false);
        const roof=this.cityRoofMechanisms?.stats;d.cityRoofHeart=String(roof?.heartSupported??false);d.cityRoofOracle=String(roof?.oracleSupported??false);
        d.cityRoofChecking=String(roof?.oracleVisible??false);d.cityRoofChase=String(roof?.heartChase??false);d.cityRoofParts=String(roof?.movingParts??0);
        d.cityDuplicateRiders=String(this.sail.riders.flat().filter(id=>this.ownsActivityResident(id)).length);}
      this.publishSceneView();}
    if(this.initDiagnostics)this.initDiagnostics.frame(now,{terrainReady:this.terrainReady,calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,pixelRatio:this.renderer.getPixelRatio(),shadows:this.renderer.shadowMap.enabled,canvasWidth:this.renderer.domElement.width,canvasHeight:this.renderer.domElement.height});
  };
  private disposed=false;
  dispose(){this.disposed=true;this.arrival=null;clearTimeout(this.flashTimer);this.unlift();disposePlayerAppearance(this.player);if(import.meta.env.DEV)void import('./skin/devCapture.ts').then(m=>m.clearLiveRig(this));cancelAnimationFrame(this.frame);this.observatory.dispose();this.resize.disconnect();this.cleanups.forEach(f=>f());const textures=new Set<THREE.Texture>();this.scene.traverse(o=>{if(o instanceof THREE.Mesh||o instanceof THREE.Points||o instanceof THREE.Sprite||o instanceof THREE.LineSegments){o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material]){const map=(m as THREE.MeshBasicMaterial).map;if(map)textures.add(map);m.dispose();}}});textures.forEach(t=>t.dispose());this.renderer.dispose();this.renderer.domElement.remove();}
}
