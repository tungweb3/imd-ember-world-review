import * as THREE from 'three';
import type {BuildingNameLabels,BuildingName} from '../buildingNameLabels.ts';
import {writeData,writeHidden} from '../domDelta.ts';
import {aimarketEntry} from '../aimarketEntry.ts';
import {stickemberEntry} from '../stickemberEntry.ts';
import {economyEntry} from '../economyEntry.ts';
import {emberClashEntry} from '../gameEntry.ts';
import type {DecorativeLightBudget} from '../decorativeLightBudget.ts';
import {loadModel} from '../assets.ts';
import {backgroundModelPriority} from '../worldModelLoads.ts';
import {AreaModelDemand} from '../areaModelDemand.ts';
import {modelDetailVisible} from '../areaModelView.ts';
import hallPreviews from '../hallPreviews.json' with {type:'json'};
import civicModels from '../civicModels.json' with {type:'json'};
import {createEcosystemHall} from './ecosystem-model.ts';
import {createRadarBoard} from './radar-board.ts';
import {createStickEmberBoard} from './stickember-board.ts';
import {createLaunchpadBoard} from './launchpad-board.ts';
import {PUBLIC_HALLS,PUBLIC_HALL_ROADS,publicHallRoadClearance,LAUNCHPAD_HALL,hallPlacement,nearPublicEntrance,publicHallBlocked,publicHallName,routeFrom,type PublicHallId} from './placement.ts';
import {TERRAIN_HALF,SPAWN,type Point} from '../layout.ts';
import type {TerrainField} from '../skin/terrainField.ts';
import {drapeLaneGeometry} from '../skin/terrain-lane-drape.ts';
import {createHallGround,createHallGrounds,installHallTerrainCutouts,hallFieldHeight,insideHallPlot,hallBermWidth,hallGroundAt} from './grounds.ts';
import {hallCourtyardWidth} from './civic-courtyard.ts';
import {createCivicRoadSurfaceGeometry} from './civic-road-surface.ts';
import {createCivicRoadPlanGeometry} from './civic-road-plan.ts';
import {cutCivicRoadAgainstNativeLanes} from './civic-native-road-cut.ts';
import {claimPreparedPublicHallRoads,type PreparedPublicHallRoads} from './civic-road-task.ts';
import {farLabelAlpha,nearLabelAlpha} from '../overview.ts';
import {NEAR_M} from '../labelTier.ts';
import {createRadarPresentation} from './radar-presentation.ts';
import {createStickEmberFire} from './stickember-fire.ts';

declare const __DREAM_HALL_ASSET__:string;
declare const __ECOSYSTEM_HALL_ASSET__:string;
declare const __RADAR_HALL_ASSET__:string;
declare const __STICKEMBER_HALL_ASSET__:string;
declare const __SIMD_LAUNCHPAD_ASSET__:string;
export interface PublicHallsHost {
  scene:THREE.Scene;camera:THREE.Camera;host:HTMLElement;field:TerrainField;player:()=>Point;
  preparedRoads?:PreparedPublicHallRoads;
  buildingNames?:BuildingNameLabels;
  onResearch?:()=>void;
  onLibrary?:()=>void;
  onGame?:()=>void;
  onEconomy?:()=>void;
  observer?:()=>boolean;
  observeHall?:(id:PublicHallId)=>boolean;
  blocked:(p:Point)=>boolean;pauseChanged:()=>void;
  peek:(id:PublicHallId)=>()=>void;walk:(p:Point,done:()=>void,lost:()=>void)=>void;cancelWalk:()=>void;
  jump?:(id:PublicHallId,p:Point)=>boolean;
  viewZoom?:()=>number;
  viewFocus?:()=>Point;loadModel?:typeof loadModel;
  nightGlow?:()=>number;reducedMotion?:()=>boolean;lightBudget?:DecorativeLightBudget;
  terrainOverride?:(point:Point,original:number)=>number;
  /** The mountain preview owns the relocated hall; default/canonical layout remains intact. */
  omitEcosystem?:boolean;
  /** Only the summit layout replaces the vacated city plot with the Launchpad exterior. */
  launchpadAtFormerEcosystem?:boolean;
  /** Only the existing mountain tour layout replaces all native cable solids with its own stations. */
  retiredNativeCable?:boolean;
}
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
const ownDispose=(root:THREE.Object3D)=>{
  const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;geometries.add(o.geometry);for(const material of Array.isArray(o.material)?o.material:[o.material]){
    materials.add(material);for(const value of Object.values(material))if(value instanceof THREE.Texture)textures.add(value);}});
  root.removeFromParent();root.clear();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
};
/** Owns public exteriors and doorway panels. The World host opens the separate game, library and research panes. */
export class PublicHallsRuntime {
  readonly root=new THREE.Group();readonly element=node('div');
  private labels=new Map<PublicHallId,HTMLButtonElement>();
  private nameHandles=new Map<PublicHallId,BuildingName>();
  private roofs=new Map<PublicHallId,THREE.Vector3>();private bases=new Map<PublicHallId,THREE.Group>();
  private grounds=new Map<PublicHallId,ReturnType<typeof createHallGround>>();private fallbacks=new Map<PublicHallId,()=>void>();
  private groundSurfaces:Array<ReturnType<typeof createHallGround>>=[];
  private cachedRoadGeometry:THREE.BufferGeometry|null=null;
  private cleanup:Array<()=>void>=[];private modal:HTMLElement|null=null;private restore:()=>void=()=>{};
  private focus:HTMLElement|null=null;private inert:Array<{el:HTMLElement;inert:boolean;visibility:string}>=[];
  private language:'zh'|'en'='en';private active:PublicHallId|null=null;private disposed=false;private route=0;private routing=false;private buildingNamesShown=true;
  private modelStates=new Map<PublicHallId,'deferred'|'pending'|'ready'|'unavailable'>();private projection=new THREE.Vector3();
  private demand=new AreaModelDemand<PublicHallId>();
  private fullLoads=new Map<PublicHallId,number>();
  private modelPanel:HTMLElement|null=null;private modelNotice:HTMLElement|null=null;private modelRetry:HTMLButtonElement|null=null;private retryActions:HTMLElement|null=null;
  private status=node('p');
  get overlayOpen(){return this.modal!==null;}
  private hallOpen(id:PublicHallId){return id==='dream'||id==='radar'||id==='stickember'||id==='launchpad'||id==='ecosystem'||id==='aimarket'||id==='fortune'||id==='hive'||id==='staking'||id==='pepe2pepe';}
  private instantHall(id:PublicHallId){return id==='stickember'||id==='aimarket'||id==='fortune'||id==='hive'||id==='staking'||id==='pepe2pepe';}
  private boardDispose:()=>void=()=>{};
  private h:PublicHallsHost;
  private halls:typeof PUBLIC_HALLS;
  private radarPresentation:ReturnType<typeof createRadarPresentation>|null=null;
  private stickemberFire:ReturnType<typeof createStickEmberFire>|null=null;
  constructor(h:PublicHallsHost){
    this.h=h;this.halls=h.omitEcosystem?PUBLIC_HALLS.filter(h=>h.id!=='ecosystem'):PUBLIC_HALLS;
    if(h.omitEcosystem&&h.launchpadAtFormerEcosystem)this.halls=[...this.halls,LAUNCHPAD_HALL];
    try{
    this.root.name='public-halls-preview';this.element.className='public-halls';this.element.dataset.preview='true';
    const terrain=h.scene.getObjectByName('valley-terrain'),colors=terrain instanceof THREE.Mesh?terrain.geometry.getAttribute('color')?.array:undefined,detail=terrain instanceof THREE.Mesh?terrain.geometry.getAttribute('civicGroundDetail')?.array:undefined,normals=terrain instanceof THREE.Mesh?terrain.geometry.getAttribute('normal')?.array:undefined;
    const prepared=claimPreparedPublicHallRoads(h.preparedRoads,h);
    this.groundSurfaces=prepared?.groundSurfaces??createHallGrounds(this.halls,h.field,colors instanceof Float32Array?colors:undefined,detail instanceof Float32Array?detail:undefined,normals instanceof Float32Array?normals:undefined);
    this.cachedRoadGeometry=prepared?.geometry??null;
    this.grounds=new Map(this.groundSurfaces.map(ground=>[ground.plot.h.id,ground]));
    this.root.add(...this.groundSurfaces.map(ground=>ground.root));
    for(const hall of this.halls){
      const base=new THREE.Group();base.name='public-hall-base-'+hall.id;base.userData.publicHallId=hall.id;base.position.set(hall.x,0,hall.z);base.rotation.y=hall.rotation;this.bases.set(hall.id,base);this.root.add(base);
      const ground=this.grounds.get(hall.id)!;base.position.y=ground.floor;ground.root.position.y=-ground.floor;base.add(ground.root);
      if(hall.id==='ecosystem'){const asset=createEcosystemHall();asset.root.scale.setScalar(1.6);base.add(asset.root);this.fallbacks.set(hall.id,()=>asset.dispose());}
      else {const fallback=hall.id!=='dream'?this.radarBlockout():this.dreamBlockout();if(hall.id==='stickember')fallback.name='stickember-hall-blockout';fallback.scale.setScalar(1.8);base.add(fallback);this.fallbacks.set(hall.id,()=>ownDispose(fallback));}
      this.modelStates.set(hall.id,'deferred');this.element.dataset[hall.id+'Asset']='blockout';this.roofs.set(hall.id,new THREE.Vector3(hall.x,ground.floor+(hall.id==='dream'?9:8),hall.z));
      const label=node('button');label.type='button';label.className='public-halls-label';label.dataset.hall=hall.id;label.dataset.hallLabel=hall.id;label.onclick=()=>this.activate(hall.id);this.element.append(label);this.labels.set(hall.id,label);
      if(h.buildingNames){const name=h.buildingNames.register('public:'+hall.id,label);this.nameHandles.set(hall.id,name);this.cleanup.push(()=>h.buildingNames?.unregister(name));}
    }
    h.host.parentElement!.append(this.element);h.scene.add(this.root);
    this.cleanup.push(installHallTerrainCutouts(h.scene,[...this.grounds.values()].map(g=>g.cutoutPlot)));
    const bakedRoad=this.cachedRoadGeometry;this.cachedRoadGeometry=null;this.makePaths(bakedRoad);this.clearVegetation();this.setLanguage('en');for(const hall of this.halls){this.demand.add(hall.id,hall,priority=>this.loadHall(hall.id,false,priority));this.loadHall(hall.id,true);}
    }catch(error){this.cachedRoadGeometry?.dispose();this.cachedRoadGeometry=null;this.dispose();throw error;}
  }
  private height(x:number,z:number){
    return hallFieldHeight(this.h.field,x,z);
  }
  groundAt(p:Point,original:number){const height=this.h.terrainOverride?.(p,original)??original;return hallGroundAt(this.groundSurfaces,p,height);}
  blocked(p:Point){return publicHallBlocked(p,this.halls);}
  get cameraFocusY(){
    if(!this.active||!this.modal)return null;const floor=this.grounds.get(this.active)?.floor??0;
    if(this.modal.dataset.inside==='true'&&this.instantHall(this.active))return (floor+(this.roofs.get(this.active)?.y??floor+8))/2;
    return this.modal.dataset.inside==='false'?floor+(this.active==='radar'?5.4:this.active==='stickember'?6:3.6):null;
  }
  private radarBlockout(){
    const g=new THREE.Group();g.name='radar-hall-blockout';
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(4,3,2.7),new THREE.MeshStandardMaterial({color:0x6d8075,roughness:.94,wireframe:true}));mesh.position.y=1.5;g.add(mesh);return g;
  }
  private dreamBlockout(){
    const g=new THREE.Group();g.name='dream-hall-blockout';
    const material=new THREE.MeshStandardMaterial({color:0xd4c8ac,roughness:.92}),roof=new THREE.MeshStandardMaterial({color:0x485f71,roughness:.9});
    const box=(w:number,h:number,d:number,x:number,y:number,z:number,m:THREE.Material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);};
    box(3,3.3,4.2,0,1.65,0,material);for(const x of [-2.05,2.05]){box(1.4,2.15,3.7,x,1.075,0,material);box(1.6,.22,4,x,2.26,0,roof);}
    const dome=new THREE.Mesh(new THREE.ConeGeometry(2.05,1.1,8),roof);dome.position.y=3.85;dome.rotation.y=Math.PI/8;g.add(dome);
    box(.65,.5,.65,0,4.65,0,material);box(.85,.16,.85,0,4.98,0,roof);
    const dark=new THREE.MeshStandardMaterial({color:0x533d39,roughness:.85}),warm=new THREE.MeshStandardMaterial({color:0xe6b875,emissive:0xe6b875,emissiveIntensity:.15});
    box(1.15,1.8,.04,0,.9,2.13,dark);for(const x of [-.95,.95])box(.4,.78,.035,x,2.52,2.13,warm);
    return g;
  }
  private loadHall(id:PublicHallId,preview=false,priority?:number){
    const civic=civicModels[id as keyof typeof civicModels]??null;
    const fullUrl=civic?civic.url:id==='launchpad'?(typeof __SIMD_LAUNCHPAD_ASSET__==='undefined'?'':__SIMD_LAUNCHPAD_ASSET__):id==='dream'?(typeof __DREAM_HALL_ASSET__==='undefined'?'':__DREAM_HALL_ASSET__):id==='radar'?(typeof __RADAR_HALL_ASSET__==='undefined'?'':__RADAR_HALL_ASSET__):id==='stickember'?(typeof __STICKEMBER_HALL_ASSET__==='undefined'?'':__STICKEMBER_HALL_ASSET__):(typeof __ECOSYSTEM_HALL_ASSET__==='undefined'?'':__ECOSYSTEM_HALL_ASSET__);
    if(civic?!/^\/assets\/halls\/(aimarket|fortune|hive|staking|pepe2pepe)\.[a-f0-9]{12}\.glb$/.test(fullUrl):id==='launchpad'?fullUrl!=='/assets/halls/launchpad.b5fec9caa77e.glb':!/^\/preview-assets\/[a-z0-9.-]+\.glb$/.test(fullUrl)&&!/^\/(?:assets\/)?halls\/(dream|ecosystem|radar|stickember)\.[a-f0-9]{12}\.glb$/.test(fullUrl)){this.modelStates.set(id,'unavailable');if(!preview)this.demand.failed(id);return;}
    const generation=preview?0:(this.fullLoads.get(id)??0)+1;if(!preview){this.fullLoads.set(id,generation);this.modelStates.set(id,'pending');}
    const distantUrl=civic?civic.previewUrl:hallPreviews[id as keyof typeof hallPreviews].url;
    const url=preview?distantUrl:fullUrl+(generation>1?'?detail-retry='+generation:'');
    const current=()=>preview||this.fullLoads.get(id)===generation;
    const failed=()=>{if(!this.disposed&&!preview&&current()&&this.modelStates.get(id)!=='ready'){this.modelStates.set(id,'unavailable');this.demand.failed(id);if(this.active===id)this.updateModelStatus();}};
    const placement=hallPlacement(id)!;
    this.cleanup.push((this.h.loadModel??loadModel)(url,priority??backgroundModelPriority(Math.hypot(placement.x-SPAWN.x,placement.z-SPAWN.z)),{onLoad:gltf=>{
      if(this.disposed||!current()||preview&&this.modelStates.get(id)==='ready'){ownDispose(gltf.scene);return;}
      let radar:ReturnType<typeof createRadarPresentation>|null=null,fire:ReturnType<typeof createStickEmberFire>|null=null;
      try{
        const model=gltf.scene;model.rotation.y=id==='dream'?-Math.PI/2:0;model.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());
        if(![size.x,size.y,size.z].every(v=>Number.isFinite(v)&&v>0))throw new Error('Invalid model bounds');
        const hall=hallPlacement(id)!,scale=Math.min((hall.halfWidth*2-.2)/size.x,(hall.halfDepth*2-.2)/size.z),centre=box.getCenter(new THREE.Vector3());model.scale.setScalar(scale);model.position.set(-centre.x*scale,-box.min.y*scale,-centre.z*scale);
        // Validate complete-model mechanisms before removing the healthy distant facade.
        if(!preview&&id==='radar')radar=createRadarPresentation(hall,model);
        if(!preview&&id==='stickember'){fire=createStickEmberFire(model);model.add(fire.root);}
        const base=this.bases.get(id)!;model.name=id+'-hall-tripo';model.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
        this.fallbacks.get(id)?.();this.fallbacks.delete(id);base.add(model);
        this.roofs.set(id,new THREE.Vector3(hall.x,base.position.y+size.y*scale+.7,hall.z));
        if(preview){this.fallbacks.set(id,()=>ownDispose(model));this.element.dataset[id+'Asset']='distant';return;}
        if(radar){const owned=radar;this.radarPresentation=owned;base.add(owned.root);const release=this.h.lightBudget?.register(owned.root);this.cleanup.push(()=>{release?.();owned.dispose();if(this.radarPresentation===owned)this.radarPresentation=null;});}
        if(fire){const owned=fire;this.stickemberFire=owned;const release=this.h.lightBudget?.register(owned.root);this.cleanup.push(()=>{release?.();owned.dispose();if(this.stickemberFire===owned)this.stickemberFire=null;});}
        this.modelStates.set(id,'ready');this.element.dataset[id+'Asset']='tripo';if(this.active===id)this.updateModelStatus();
      }catch{radar?.dispose();fire?.dispose();ownDispose(gltf.scene);failed();}
    },onError:failed}));
  }
  private activeRoads(){return PUBLIC_HALL_ROADS.filter(road=>road.id!=='hall-ecosystem'||this.halls.some(h=>h.id==='ecosystem'||h.id==='launchpad'));}
  private installRoad(geometry:THREE.BufferGeometry){
    try{const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xb4a07a,roughness:.97,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));mesh.name='public-hall-branch-paths';mesh.receiveShadow=true;this.root.add(mesh);}catch(error){geometry.dispose();throw error;}
  }
  private makePaths(baked:THREE.BufferGeometry|null=null){
    if(baked){this.installRoad(baked);return;}
    const recipe=createCivicRoadPlanGeometry(this.activeRoads());
    try{const draped=drapeLaneGeometry(recipe,this.h.field,.035);
      try{const surface=createCivicRoadSurfaceGeometry(draped,this.groundSurfaces,this.h.field);
        try{surface.userData.civicRoadPlan={...recipe.userData.civicRoadPlan};
          const geometry=cutCivicRoadAgainstNativeLanes(surface,this.h.scene.getObjectByName('lanes')??null);
          // The road clears rendered grass by 7 mm; at oblique views that leaves only a few depth bins.
          // Bias only this owned paving during rasterization, keeping its geometry and walkable height exact.
          this.installRoad(geometry);
        }finally{surface.dispose();}
      }finally{draped.dispose();}
    }finally{recipe.dispose();}
  }
  private clearVegetation(){
    const forest=this.h.scene.getObjectByName('forest');if(!forest)return;const roads=this.activeRoads(),matrix=new THREE.Matrix4(),position=new THREE.Vector3();
    forest.traverse(o=>{if(!(o instanceof THREE.InstancedMesh))return;const saved:Array<{i:number;m:THREE.Matrix4}>=[];
      for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);if(matrix.elements[0]===0&&matrix.elements[5]===0&&matrix.elements[10]===0)continue;
        const hit=publicHallRoadClearance(position,1.6,roads)||this.halls.some(h=>{const dx=position.x-h.x,dz=position.z-h.z,c=Math.cos(h.rotation),s=Math.sin(h.rotation),x=dx*c-dz*s,z=dx*s+dz*c,margin=h.id==='stickember'?hallBermWidth(h)+.6:h.id==='radar'?3.7:hallCourtyardWidth(h)>0?hallCourtyardWidth(h)+1.6:2.8;return Math.abs(x)<h.halfWidth+margin&&Math.abs(z)<h.halfDepth+margin||Math.abs(x)<3&&z>h.halfDepth&&z<h.halfDepth+h.stairRun+1;});
        if(hit){saved.push({i,m:matrix.clone()});o.setMatrixAt(i,new THREE.Matrix4().makeScale(0,0,0));}}
      if(saved.length){o.instanceMatrix.needsUpdate=true;this.cleanup.push(()=>{for(const {i,m}of saved)o.setMatrixAt(i,m);o.instanceMatrix.needsUpdate=true;});}
    });
  }
  setBuildingNamesVisible(shown:boolean){this.buildingNamesShown=shown;if(!shown)for(const label of this.labels.values())label.hidden=true;}
  setLanguage(language:'zh'|'en'){
    this.language=language;
    for(const hall of this.halls)this.labels.get(hall.id)!.textContent=publicHallName(hall.id,language)!;
    if(this.modal)this.refresh();
  }
  update(player:Point&{y?:number},width:number,height:number,covered:boolean){
    if(!covered)this.demand.update(player,this.h.viewFocus?.()??player,this.h.viewZoom?.()??80,id=>{const hall=hallPlacement(id)!,base=this.bases.get(id)!,roof=this.roofs.get(id)!;this.projection.set(hall.x,(base.position.y+roof.y)/2,hall.z);return modelDetailVisible(this.h.camera,this.projection,hall.halfWidth*2,width);});
    {const state=this.demand.serializedState;if(this.element.dataset.areaModels!==state)this.element.dataset.areaModels=state;}
    if(this.radarPresentation){const glow=this.h.nightGlow?.()??0;this.radarPresentation.update(glow,performance.now()/1000,this.h.reducedMotion?.()??false);writeData(this.element,'radarGlow',String(glow));writeData(this.element,'radarRotation',this.radarPresentation.pivot.rotation.y.toFixed(3));}
    if(this.stickemberFire){const reduced=this.h.reducedMotion?.()??false;this.stickemberFire.update(performance.now()/1000,this.h.nightGlow?.()??0,reduced);writeData(this.element,'stickemberFire',reduced?'steady':'burning');writeData(this.element,'stickemberFireGlow',this.stickemberFire.uniforms.uStickFireGlow.value.toFixed(3));}
    if(covered){if(this.modal)this.close();if(this.routing)this.cancelRoute();}
    writeData(this.element,'playerX',player.x.toFixed(2));writeData(this.element,'playerZ',player.z.toFixed(2));
    writeData(this.element,'playerY',(player.y??0).toFixed(3));
    const zoom=this.h.viewZoom?.()??80,far=farLabelAlpha(zoom),fade=nearLabelAlpha(zoom);
    writeHidden(this.element,covered);for(const [id,label]of this.labels){const hall=hallPlacement(id)!,dx=player.x-hall.x,dz=player.z-hall.z,c=Math.cos(hall.rotation),s=Math.sin(hall.rotation),lx=dx*c-dz*s,lz=dx*s+dz*c;
      const near=Math.hypot(Math.max(0,Math.abs(lx)-hall.halfWidth),Math.max(0,Math.abs(lz)-hall.halfDepth))<=NEAR_M;
      const alpha=Math.max(far,fade);if(label.style.opacity!=='1')label.style.opacity='1';const layer=far>=.5?'far':'near';if(label.dataset.layer!==layer)label.dataset.layer=layer;
      this.projection.copy(this.roofs.get(id)!).project(this.h.camera);
      const visible=this.buildingNamesShown&&!covered&&!this.modal&&alpha>.02&&this.projection.z>=-1&&this.projection.z<=1&&Math.abs(this.projection.x)<.9&&Math.abs(this.projection.y)<.8;
      const name=this.nameHandles.get(id),x=(this.projection.x+1)*width/2,y=(1-this.projection.y)*height/2;
      if(name&&this.h.buildingNames)this.h.buildingNames.place(name,{x,y,visible,priority:near?1:0,depth:this.h.camera.position.distanceTo(this.roofs.get(id)!)});
      else{if(label.hidden===visible)label.hidden=!visible;if(visible){const left=Math.round(x)+'px',top=Math.round(y)+'px';if(label.style.left!==left)label.style.left=left;if(label.style.top!==top)label.style.top=top;}}
      if(visible){const value=String(this.hallOpen(id)&&nearPublicEntrance(player,id,this.h.blocked,this.h.retiredNativeCable));if(label.dataset.near!==value)label.dataset.near=value;}}
  }
  tryInteract(player:Point){if(this.modal)return true;if(this.h.observer?.())return false;for(const hall of this.halls)if(this.hallOpen(hall.id)&&nearPublicEntrance(player,hall.id,this.h.blocked,this.h.retiredNativeCable)){this.open(hall.id,true);return true;}return false;}
  tryPointer(clientX:number,clientY:number){
    if(this.disposed||this.modal)return false;const rect=this.h.host.getBoundingClientRect();if(!rect.width||!rect.height)return false;
    const ray=new THREE.Raycaster();ray.layers.mask=this.h.camera.layers.mask;ray.setFromCamera(new THREE.Vector2((clientX-rect.left)/rect.width*2-1,1-(clientY-rect.top)/rect.height*2),this.h.camera);
    const hit=ray.intersectObjects([...this.bases.values()],true)[0];if(!hit)return false;
    // The original world keeps priority when a wall/tree/terrain actually covers this facade.
    const rendered=(object:THREE.Object3D)=>{for(let o:THREE.Object3D|null=object;o;o=o.parent)if(!o.visible)return false;return true;};
    const occluder=ray.intersectObjects(this.h.scene.children,true).find(q=>q.object instanceof THREE.Mesh&&rendered(q.object)&&!(q.object.name==='valley-terrain'&&this.groundSurfaces.some(g=>insideHallPlot(g.cutoutPlot,q.point)))&&q.distance+1e-3<hit.distance);if(occluder)return false;
    let object:THREE.Object3D|null=hit.object;
    while(object){for(const [id,base]of this.bases)if(object===base){this.activate(id);return true;}object=object.parent;}
    return false;
  }
  private activate(id:PublicHallId){if(this.h.observer?.()){this.open(id,false);return;}if(id!=='stickember'&&this.instantHall(id)&&this.h.jump)this.visit(id);else this.open(id,nearPublicEntrance(this.h.player(),id,this.h.blocked,this.h.retiredNativeCable));}
  /** Explicit travel uses the same safe, exterior doorstep as walking; it never enters a closed model body. */
  visit(id:PublicHallId):boolean{
    if(this.h.observer?.()){
      if(this.disposed||!this.bases.has(id))return false;this.close();this.cancelRoute();let focused=false;
      try{focused=this.h.observeHall?.(id)===true;}catch{focused=false;}
      this.open(id,focused&&this.hallOpen(id));
      if(!focused&&this.modal){const notice=node('p',this.language==='zh'?'目前無法移動觀察鏡頭，仍可查看建築介紹。':'The observation camera is unavailable. You can still read the building introduction.');notice.setAttribute('role','status');this.modal.append(notice);}
      return focused;
    }
    if(this.disposed||!this.bases.has(id)||!this.instantHall(id)||!this.hallOpen(id))return false;
    if(!this.h.jump){this.open(id,nearPublicEntrance(this.h.player(),id,this.h.blocked,this.h.retiredNativeCable));return false;}
    const hall=hallPlacement(id)!;this.close();this.cancelRoute();let arrived=false;
    if(nearPublicEntrance(hall.entrance,id,this.h.blocked,this.h.retiredNativeCable)){
      try{arrived=this.h.jump(id,{...hall.entrance})===true&&nearPublicEntrance(this.h.player(),id,this.h.blocked,this.h.retiredNativeCable);}catch{arrived=false;}
    }
    this.open(id,arrived);
    if(!arrived)this.status.textContent=this.language==='zh'?'入口暫時無法抵達，請稍後再試。':'The entrance is temporarily unavailable. Please try again.';
    else if(id==='stickember')this.status.textContent=this.language==='zh'?'已抵達小燼館入口，可開啟書館閱讀。':'You are at the StickEmber entrance. Open the library to read.';
    return arrived;
  }
  private open(id:PublicHallId,inside:boolean){
    if(this.disposed||this.modal||!this.bases.has(id))return;this.demand.request(id);this.cancelRoute();this.focus=document.activeElement instanceof HTMLElement?document.activeElement:null;this.active=id;
    inside=inside&&this.hallOpen(id);
    if(!inside)this.restore=this.h.peek(id);
    const modal=node('section');modal.className='public-halls-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','public-hall-title');modal.dataset.inside=String(inside);this.modal=modal;
    for(const child of this.h.host.parentElement!.children)if(child instanceof HTMLElement&&child!==this.element){this.inert.push({el:child,inert:child.inert,visibility:child.style.visibility});child.inert=true;if(child!==this.h.host)child.style.visibility='hidden';}
    this.element.append(modal);this.refresh();this.h.pauseChanged();modal.querySelector<HTMLButtonElement>('button')?.focus();
    modal.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.close();}else if(e.key==='Tab'){
      const all=Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary'));if(!all.length)return;const index=all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();all[(index+(e.shiftKey?-1:1)+all.length)%all.length].focus();}};
  }
  private refresh(){
    if(!this.modal||!this.active)return;const focusIndex=Array.from(this.modal.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary')).indexOf(document.activeElement as HTMLElement);
    this.boardDispose();this.boardDispose=()=>{};
    const observer=this.h.observer?.()===true;if(!observer&&this.modal.dataset.observer==='true')this.modal.dataset.inside=String(this.hallOpen(this.active)&&nearPublicEntrance(this.h.player(),this.active,this.h.blocked,this.h.retiredNativeCable));
    const zh=this.language==='zh',id=this.active,inside=this.modal.dataset.inside==='true',available=this.hallOpen(id);this.modal.dataset.hall=id;this.modal.dataset.availability=available?'open':'closed';this.modal.dataset.observer=String(observer);this.modal.replaceChildren();
    const close=node('button','×');close.type='button';close.className='public-halls-close';close.setAttribute('aria-label',zh?'關閉':'Close');close.onclick=()=>this.close();this.modal.append(close);
    const civic=!!civicModels[id as keyof typeof civicModels];
    const kicker=node('p',observer?(available?(zh?'上帝視角 · 查看建築':'GOD VIEW · BUILDING VIEW'):(zh?'上帝視角 · 暫未開放':'GOD VIEW · NOT OPEN YET')):id==='launchpad'?(zh?'公共展館 · 官方網站入口':'PUBLIC HALL · OFFICIAL WEBSITE'):!available?(zh?'公共展館 · 暫未開放':'PUBLIC HALL · NOT OPEN YET'):inside?(civic||id==='stickember'||id==='dream'?(zh?'公共展館 · 館前入口':'PUBLIC HALL · AT THE ENTRANCE'):(zh?'公共展館 · 大廳預覽':'PUBLIC HALL · LOBBY PREVIEW')):(zh?'公共展館 · 查看建築':'PUBLIC HALL · BUILDING VIEW'));kicker.className='public-halls-kicker';this.modal.append(kicker);
    const title=node('h2',id==='launchpad'?'SIMD Launchpad':publicHallName(id,this.language)!);title.id='public-hall-title';this.modal.append(title);
    if(observer)this.modal.append(node('p',zh?'僅移動鏡頭觀察，角色留在原處。':'Move only the camera to observe; your character stays in place.'));
    if(id==='dream'){
      this.modal.append(node('p',zh?'在館內開始餘燼交鋒，結束後可直接返回世界。':'Play Ember Clash inside the hall, then return directly to World.'));
      const play=node('button',zh?'進入餘燼交鋒':'Enter Ember Clash');play.type='button';let disposed=false;
      play.onclick=()=>{if(disposed)return;this.close();if(this.h.onGame)this.h.onGame();else window.location.assign(emberClashEntry(this.language));};
      this.boardDispose=()=>{disposed=true;play.onclick=null;};this.modal.append(play);
      this.status=node('p',zh?'World 館內遊戲':'Game inside World');this.status.className='public-halls-status';this.modal.append(this.status);
    }else if(id==='ecosystem'||id==='aimarket'){
      this.modal.append(node('p',zh?'查看 AIMarket 公開摘要，或沿用 World 錢包登入取得研究資格。':'Browse AIMarket summaries, or continue with your World wallet login for research access.'));
      const link=node('button',zh?'開啟 AIMarket':'Open AIMarket');link.type='button';link.onclick=()=>{this.close();if(this.h.onResearch)this.h.onResearch();else window.location.assign(aimarketEntry(this.language));};this.modal.append(link);
      this.status=node('p',zh?'研究詳情需持有至少 1,000,000 EMBEO。':'Research details require at least 1,000,000 EMBEO.');this.modal.append(this.status);
    }else if(id==='radar'){
      this.modal.append(createRadarBoard(this.language));this.status=node('p',zh?'外部網站入口':'External project website');this.status.className='public-halls-status';this.modal.append(this.status);
    }else if(id==='stickember'){
      const board=createStickEmberBoard(this.language,()=>{this.close();if(this.h.onLibrary)this.h.onLibrary();else window.location.assign(stickemberEntry(this.language));});this.modal.append(board.element);this.boardDispose=board.dispose;
      this.status=node('p',zh?'World 館內書庫':'Library inside World');this.status.className='public-halls-status';this.modal.append(this.status);
    }else if(id==='launchpad'){
      const board=createLaunchpadBoard(this.language);this.modal.append(board.element);this.boardDispose=board.dispose;
      this.status=node('p',zh?'官方網站入口':'Official website doorway');this.status.className='public-halls-status';this.modal.append(this.status);
    }else if(id==='staking'){
      this.modal.append(node('p',zh?'管理 EMBEO 質押、查看 GOLD 帳本及支付 World 服務費用。':'Manage EMBEO staking, view your GOLD ledger and pay for World services.'));
      const manage=node('button',zh?'管理質押與 GOLD':'Manage staking and GOLD');manage.type='button';let disposed=false;
      manage.onclick=()=>{if(disposed)return;this.close();if(this.h.onEconomy)this.h.onEconomy();else window.location.assign(economyEntry(this.language));};
      this.boardDispose=()=>{disposed=true;manage.onclick=null;};this.modal.append(manage);
      this.status=node('p',zh?'正式開放須完成新增功能審核。':'Opening requires review of the new features.');this.status.className='public-halls-status';this.modal.append(this.status);
    }else if(id==='fortune'||id==='hive'||id==='pepe2pepe'){
      this.modal.append(node('p',id==='fortune'?(zh?'觀星、命盤與人生故事的交流空間。':'A place to explore stars, charts and life stories.'):id==='hive'?(zh?'Hive 蜂群館，夥伴在世界裡交流與協作的據點。':'A meeting place for the Hive community.'):id==='pepe2pepe'?(zh?'Pepe2Pepe，玩家交流與遊戲的新據點。功能準備中。':'Pepe2Pepe, a new meeting place for players and games. Features are in preparation.'):(zh?'質押挖礦館，綠晶礦山中的新據點。功能準備中。':'Staking Mine, a new landmark in the green crystal hills. Features are in preparation.')));
      this.status=node('p',observer?(zh?'正在觀察會館外觀，可繼續移動鏡頭探索。':'Observe the hall exterior, or keep exploring with the camera.'):inside?(zh?'已抵達館前，可繼續探索其他會館。':'You have arrived at the entrance. Keep exploring the other halls.'):(zh?'前往館前，或繼續探索其他會館。':'Go to the entrance, or keep exploring the other halls.'));this.status.className='public-halls-status';this.modal.append(this.status);
    }else{
    this.modal.append(node('p',zh?'本館籌備中，暫時不開放。開放消息將另行公布。':'This hall is in preparation and is not open yet. Opening details will be announced later.'));
    this.status=node('p',zh?'目前僅可查看建築外觀。':'Building exterior preview only.');this.status.className='public-halls-status';this.modal.append(this.status);
    }
    this.modelPanel=node('div');this.modelPanel.className='public-halls-model-state';this.modelNotice=node('small');this.modelNotice.setAttribute('role','status');this.modelRetry=node('button',zh?'重新載入建築':'Retry building model');this.modelRetry.type='button';this.modelRetry.onclick=()=>{this.demand.request(id);this.updateModelStatus();};this.retryActions=node('div');this.retryActions.className='public-halls-actions';this.retryActions.append(this.modelRetry);this.modelPanel.append(this.modelNotice,this.retryActions);this.modal.append(this.modelPanel);this.updateModelStatus();
    const actions=node('div');actions.className='public-halls-actions';if(observer){
      const view=node('button',zh?'觀察館外':'View exterior');view.type='button';view.onclick=()=>{if(this.h.observer?.())this.visit(id);else this.refresh();};actions.append(view);
    }else if(!inside&&available){
      const instant=this.instantHall(id)&&!!this.h.jump;
      if(instant){const jump=node('button',zh?'立即前往入口':'Go to entrance');jump.type='button';jump.onclick=()=>this.visit(id);actions.append(jump);}
      // StickEmber keeps both user-selected travel options before opening its in-World books.
      if(id==='stickember'||!instant){const walk=node('button',zh?'沿路前往入口':'Walk to entrance');walk.type='button';walk.onclick=()=>this.go(id);actions.append(walk);}
    }
    const back=node('button',zh?'返回世界':'Back to World');back.type='button';back.onclick=()=>this.close();actions.append(back);this.modal.append(actions);
    if(focusIndex>=0){const targets=Array.from(this.modal.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary'));targets[Math.min(focusIndex,targets.length-1)]?.focus();}
  }
  private go(id:PublicHallId){
    if(this.h.observer?.()){this.visit(id);return;}
    if(!this.hallOpen(id))return;
    const path=routeFrom(this.h.player(),id,this.h.blocked,this.h.retiredNativeCable);if(!path){this.status.textContent=this.language==='zh'?'請先返回廣場或步道，再前往入口。':'Return to the square or a path, then try the entrance.';return;}
    this.close();this.routing=true;const token=++this.route;let index=1;const next=()=>{if(this.disposed||token!==this.route)return;if(this.h.observer?.()){this.cancelRoute();return;}if(index>=path.length){this.routing=false;this.tryInteract(this.h.player());return;}this.h.walk(path[index++],next,()=>{if(!this.disposed&&token===this.route)this.cancelRoute();});};next();
  }
  cancelRoute(){this.route++;this.routing=false;this.h.cancelWalk();}
  private updateModelStatus(){
    if(!this.modal||!this.active||!this.modelPanel||!this.modelNotice||!this.modelRetry||!this.retryActions)return;
    const state=this.modelStates.get(this.active),failed=state==='unavailable',zh=this.language==='zh';this.modelPanel.hidden=state==='ready';
    this.modelNotice.textContent=failed?(zh?'完整建築載入失敗，遠景仍可查看。你可以直接重試。':'Detailed model loading failed. The distant view remains available; you can retry here.'):(zh?'正在補上建築細節，你仍可返回世界繼續探索。':'Adding building detail. You can return to the world and keep exploring.');
    const focused=document.activeElement===this.modelRetry;this.modelRetry.hidden=!failed;this.modelRetry.disabled=!failed;this.retryActions.style.display=failed?'flex':'none';if(focused&&!failed)this.modal.querySelector<HTMLButtonElement>('button')?.focus();
  }
  private close(){
    if(!this.modal)return;this.boardDispose();this.boardDispose=()=>{};this.modal.remove();this.modal=null;this.active=null;this.modelPanel=this.modelNotice=this.modelRetry=this.retryActions=null;this.restore();this.restore=()=>{};
    for(const state of this.inert){state.el.inert=state.inert;state.el.style.visibility=state.visibility;}this.inert=[];this.h.pauseChanged();if(this.focus?.isConnected&&!this.focus.inert){const label=this.focus.className.split(' ').includes('public-halls-label');if(label&&!this.buildingNamesShown)this.h.host.querySelector('canvas')?.focus();else{if(label)this.focus.hidden=false;this.focus.focus();}}this.focus=null;
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.demand.dispose();this.cancelRoute();this.close();this.cleanup.reverse().forEach(f=>f());this.cleanup=[];this.fallbacks.forEach(f=>f());this.fallbacks.clear();ownDispose(this.root);this.element.remove();}
}
