import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import type {Agent} from '../model.ts';
import {SE} from './kit.ts';
import {NW_EMBER,NW_DARK} from './daynight.ts';
import {publicUrl} from '../publicUrl.ts';

// Hillside cottage for every agent: stone footing (sunk 1.2 m so slopes never show a gap), plaster walls with
// dark timber framing, an ember-lit window. Footprint 2.4 × 2.1 fits Codex's home collider (1.35 × 1.2).
// Door on local +Z; scene.ts turns each door toward the lodge.
function colored(geometry:THREE.BufferGeometry,color:number){
  const g=geometry.index?geometry.toNonIndexed():geometry,c=new THREE.Color(color),n=g.attributes.position.count,a=new Float32Array(n*3);
  for(let i=0;i<n;i++)a.set([c.r,c.g,c.b],i*3);g.setAttribute('color',new THREE.BufferAttribute(a,3));if(g.attributes.uv)g.deleteAttribute('uv');return g;
}
const box=(w:number,h:number,d:number,x:number,y:number,z:number,color:number)=>{const b=new THREE.BoxGeometry(w,h,d);b.translate(x,y,z);return colored(b,color);};
export function cottageWalls(){
  const timber=0x3b2c22,parts=[
    box(2.6,1.6,2.3,0,-.5,0,SE.basaltLight),            // footing
    box(2.4,1.7,2.1,0,1.15,0,0xd3c3a0),                  // plaster walls
    box(.7,1.15,.1,0,.88,1.07,SE.ink),                   // door
    box(.9,.14,.16,0,1.52,1.1,SE.gold),                  // lintel
    box(.46,.38,.1,-.8,1.3,1.07,SE.emberHot),            // front window
    box(.46,.38,.1,1.21,1.3,0,SE.emberHot)
  ];
  for(const x of [-1.2,1.2])for(const z of [-1.05,1.05])parts.push(box(.16,1.75,.16,x,1.15,z,timber));
  parts.push(box(2.46,.14,2.16,0,1.95,0,timber),box(2.46,.12,2.16,0,.36,0,timber));
  for(const s of [-1,1]){const brace=new THREE.BoxGeometry(.1,1.5,.06);brace.rotateZ(s*.6);brace.translate(s*.55+.5*s,1.15,1.08);parts.push(colored(brace,timber));}
  const g=mergeGeometries(parts);g.computeVertexNormals();return g;
}
export function cottageRoof(){
  // Steep gable facing the door (ridge runs front to back) and a stone chimney; tinted per instance.
  const s=new THREE.Shape([new THREE.Vector2(-1.55,0),new THREE.Vector2(1.55,0),new THREE.Vector2(0,1.55)]);
  const roof=new THREE.ExtrudeGeometry(s,{depth:2.9,bevelEnabled:false});roof.translate(0,2.02,-1.45);
  const chimney=new THREE.BoxGeometry(.32,.9,.32);chimney.translate(.62,3.05,-.55);
  const g=mergeGeometries([colored(roof,0xffffff),colored(chimney,0xa8a39a)]);g.computeVertexNormals();return g;
}
/** Roof tint by runtime, muted from IMD Town's coral (Claude) / mint (Codex); offline homes go slate grey. */
export function roofColor(a:Agent){
  return a.presence!=='online'?SE.roofIdle:a.runtimes.includes('claude')?SE.roofClaude:SE.roofCodex;
}
/** Night windows (skin/daynight.ts): the ember panes of the cottages and the dark panes of the Lisbon houses. */
export function houseMaterial(){const m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,flatShading:true});m.userData.nightWindows=NW_EMBER|NW_DARK;return m;}

// ─── Emberford hillside: Alfama-style houses (map revision v002) ──────────────────────────────────────────
// Same footprint as the cottage (fits Codex's 1.35 × 1.2 collider), door on local +Z. The plaster is white in the
// geometry and tinted per instance: warm pastels for Claude runtimes, cool pastels for Codex, off-white offline.
// The terracotta roof is its own mesh so the runtime tint never reaches it.
export function lisbonWalls(){
  const plaster=0xf6f1e8,frame=0xfbf8f1,dark=0x2e2b28,shutter=0x46705a,door=0x5a3b2a,iron=0x2b2d2f,parts=[
    box(2.6,1.6,2.3,0,-.5,0,0xcfc6b3),                    // stone footing
    box(2.4,3.3,2.1,0,1.95,0,plaster),                   // two storeys of plaster
    box(2.46,.14,2.16,0,.4,0,0xe7e0d2),box(2.5,.16,2.2,0,3.62,0,frame),   // plinth line and cornice
    box(.66,1.2,.1,0,.9,1.07,door),box(.8,.1,.14,0,1.55,1.09,frame),     // door and lintel
    box(.5,.62,.1,-.75,2.45,1.07,dark),box(.5,.62,.1,.75,2.45,1.07,dark),  // upper windows
    box(.62,.08,.12,-.75,2.12,1.09,frame),box(.62,.08,.12,.75,2.12,1.09,frame),
    box(.5,.55,.1,1.21,1.05,.1,dark),box(.5,.62,.1,-1.21,2.45,-.2,dark)    // side windows
  ];
  for(const x of [-.75,.75])for(const s of [-1,1])parts.push(box(.2,.64,.06,x+s*.36,2.45,1.1,shutter));
  parts.push(box(1.2,.08,.45,-.2,1.95,1.28,iron),box(1.2,.35,.03,-.2,2.12,1.49,iron));   // little iron balcony
  const g=mergeGeometries(parts);g.computeVertexNormals();return g;
}
export function lisbonRoof(){
  // Low hipped terracotta roof with a small chimney; white in the geometry, tinted per instance.
  const roof=new THREE.ConeGeometry(1.95,1.1,4,1);roof.rotateY(Math.PI/4);roof.scale(1.03,1,.93);roof.translate(0,4.25,0);
  const eave=new THREE.BoxGeometry(2.7,.1,2.4);eave.translate(0,3.73,0);
  const chimney=new THREE.BoxGeometry(.3,.7,.3);chimney.translate(.55,4.5,-.45);
  const g=mergeGeometries([colored(roof,0xffffff),colored(eave,0xf0e6da),colored(chimney,0xe9e2d6)]);g.computeVertexNormals();return g;
}
const WARM=[0xf2d27a,0xf0b9a2,0xf4d9a6],COOL=[0xaed6d1,0xb9cde2,0xc7dcc6];
/** Plaster colour by runtime (warm Claude, cool Codex, off-white offline); pick fixed per house from its seed 0..1. */
export function plasterColor(a:Agent,seed:number){
  if(a.presence!=='online')return 0xe9e4da;
  const set=a.runtimes.includes('claude')?WARM:COOL;return set[Math.min(set.length-1,Math.floor(seed*set.length))];
}
export const TERRACOTTA=0xb5583a;

// ─── Tripo house models (stickember-3d/world, normalised by tools/world_game.py) ─────────────────────────────
// Metres, origin at the centre of the footprint, lowest point on y=0, door on +Z. Missing entries use the
// procedural houses above.
export type HouseModelKey=`${'lisbon'|'timber'}-${'s'|'ms'|'m'|'l'|'xl'}`;
export const HOUSE_MODELS:Partial<Record<HouseModelKey,{url:string;stretchY?:number}>>={
  'lisbon-s':{url:publicUrl('models/houses/house_lisbon_s.glb')},
  // The small-medium model is wide and low (3.64 m); stretched so it never stands shorter than the small house.
  'lisbon-ms':{url:publicUrl('models/houses/house_lisbon_ms.glb'),stretchY:1.2},
  'lisbon-m':{url:publicUrl('models/houses/house_lisbon_m.glb')},
  'lisbon-l':{url:publicUrl('models/houses/house_lisbon_l.glb')},
  'lisbon-xl':{url:publicUrl('models/houses/house_lisbon_xl.glb')},
  // Frosthollow log houses: not tinted (the only near-white texels are snow); runtime shows on the signal above.
  // Tripo made the small and the largest log houses squat (2.4 / 2.5 / 3.9 m tall); stretched to read as a size ladder.
  'timber-s':{url:publicUrl('models/houses/house_timber_s.glb'),stretchY:1.3},
  'timber-ms':{url:publicUrl('models/houses/house_timber_ms.glb'),stretchY:1.35},
  'timber-m':{url:publicUrl('models/houses/house_timber_m.glb')},
  'timber-l':{url:publicUrl('models/houses/house_timber_l.glb')},
  'timber-xl':{url:publicUrl('models/houses/house_timber_xl.glb'),stretchY:1.5}
};
/** The model's material with the per-instance colour applied only to near-white texels (the plaster), so the
 *  runtime tint never reaches the terracotta roof, the shutters or the door. */
export function plasterTint(source:THREE.MeshStandardMaterial){
  const m=source.clone();
  m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
    `#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
      float plaster=smoothstep(.42,.62,min(diffuseColor.r,min(diffuseColor.g,diffuseColor.b)));
      diffuseColor.rgb*=mix(vec3(1.),vColor.rgb,plaster);
    #endif`);};
  m.customProgramCacheKey=()=>'plaster-tint';return m;
}
