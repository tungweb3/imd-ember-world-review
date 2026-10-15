import * as THREE from 'three';
import {SceneMaterialIndex} from './sceneMaterialIndex.ts';
import {bandWeights,sunPosition,moonPosition,moonPhase,utcHour,worldNow,DAY_MS,type Band,type BandWeights,type SkyPos} from '../worldTime.ts';

// Day and night (owner, 2026-09-28) on top of the market weather (skin/weather.ts, WEATHER_SKY in Observatory.ts):
//   sky      the weather's eased sky colour is tinted per band (dawn rose, dusk ember, night deep blue-violet, darker
//            at a new moon) and becomes the background and the fog; the lightning's flash still lifts it afterwards.
//   key      the one shadow-casting light follows the sun by day (warm orange and long shadows near the horizon) and the
//            moon by night (cool, scaled by the lit share). It swaps bodies only while both are dark, so no pop.
//   hemi     the sky light's colours and share (WeatherFx.daylight) follow the bands; the rain's dimming stays on top.
//   discs    a sun disc and a moon disc (lit by the real phase) far out along their directions: two draws when on screen.
//   lights   windows glow warm from dusk (a shader rule on the house and landmark materials, no light per window),
//            lamps, lanterns and the heart crystal read brighter, a light mist thickens the fog, and the moon lays a
//            glint on the river and the pools (a patch on the water materials that keeps the rain's). No extra draw.
//            The rain lights the windows and lamps by day too (cosy, owner 2026-09-30): `cosy`, from skin/weather.ts.
//   wet night the moonlight never drops under a sky of sun level NIGHT_KEY_FLOOR at night (owner, 2026-09-30: night and
//            rain stay readable, never gloomy): a thunderstorm's night keeps 4/5 of a sun-3 night's moonlight on the
//            town, while its cloud still hides the moon and greys the sky (the review measured its plaza at 63 % of a
//            dry night's, the moonlight at 53 %). Day, dawn and dusk keep the weather's own sun.

const lerpBands=(w:BandWeights,v:Record<Band,number>)=>w.dawn*v.dawn+w.day*v.day+w.dusk*v.dusk+w.night*v.night;
const smooth=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Per-band sky tint: the weather colour moves `mix` of the way to `color` after scaling by `keep`; dawn's and dusk's
 *  glow needs a clear sky (tintSky's clear), so a stormy dusk stays a storm (no brighter than its noon). */
export const SKY_TINT:Record<Band,{color:number;mix:number;keep:number}>={
  dawn:{color:0xe0a08a,mix:.45,keep:.9},day:{color:0xffffff,mix:0,keep:1},dusk:{color:0xd8784a,mix:.5,keep:.8},night:{color:0x121a38,mix:.6,keep:.22}};
/** Per-band sky light (hemisphere): sky and ground colours and its share of the weather's. The night keeps enough (a
 *  light ground term, over half the share) that figures and the forest stay mid-grey on a moonless, stormy night. */
export const HEMI:Record<Band,{sky:number;ground:number;share:number}>={
  dawn:{sky:0xf3cdb4,ground:0x3a3f52,share:.72},day:{sky:0xe9f1db,ground:0x314955,share:1},dusk:{sky:0xf2b48e,ground:0x3e3448,share:.66},night:{sky:0x90a0dc,ground:0x3c4668,share:.8}};
export const SUN_HIGH=0xffdeb0,SUN_LOW=0xff8a3c,MOONLIGHT=0xa9b8ff;
/** Moonlight at a full moon relative to the weather's sun (the key at a new moon keeps NEW_MOON of it). */
export const MOON_KEY=.3,NEW_MOON=.15;
/** The key light never comes from lower than this (rad), so shadows stay long but inside the shadow box. */
export const KEY_MIN_ALT=.2;
/** A change of world time (the slider, Back to live) eases in with this time constant (s); under SNAP_MS it snaps. */
export const EASE=.2,SNAP_MS=60000;

export type Lighting={weights:BandWeights;sun:SkyPos;moon:SkyPos;phase:number;lit:number;
  key:{dir:{x:number;y:number;z:number};color:number;share:number;body:'sun'|'moon'};hemi:{sky:number;ground:number;share:number};night:number};
// Numeric lighting returns no Color references. Reuse private work colours while
// retaining each conversion and arithmetic operation in its original order.
const MIX_A=new THREE.Color(),MIX_B=new THREE.Color(),HEMI_ACC=new THREE.Color(),HEMI_TERM=new THREE.Color();
const mixHex=(a:number,b:number,t:number)=>MIX_A.setHex(a).lerp(MIX_B.setHex(b),t).getHex();
/** Everything the rig sets for a UTC timestamp, as numbers (tests read this; DayNight applies it). key.share scales the
 *  weather's sun intensity. */
export function lighting(ms:number):Lighting {
  const weights=bandWeights(utcHour(ms)),sun=sunPosition(ms),moon=moonPosition(ms),{phase,lit}=moonPhase(ms);
  const high=smooth(.05,.45,sun.y),sunK=smooth(-.03,.2,sun.y)*(.55+.45*high);
  const moonK=(1-smooth(-.13,-.03,sun.y))*smooth(0,.2,moon.y)*MOON_KEY*(NEW_MOON+(1-NEW_MOON)*lit);
  const body=sun.y>-.03?'sun':'moon',p=body==='sun'?sun:moon,alt=Math.max(KEY_MIN_ALT,p.altitude),flat=Math.hypot(p.x,p.z)||1;
  const dir={x:p.x/flat*Math.cos(alt),y:Math.sin(alt),z:p.z/flat*Math.cos(alt)};
  const H=(k:'sky'|'ground')=>{HEMI_ACC.setRGB(0,0,0);for(const b of ['dawn','day','dusk','night'] as Band[])HEMI_ACC.add(HEMI_TERM.setHex(HEMI[b][k]).multiplyScalar(weights[b]));return HEMI_ACC.getHex();};
  const dark=.85+.15*lit;
  return {weights,sun,moon,phase,lit,night:weights.night,
    key:{dir,color:body==='sun'?mixHex(SUN_LOW,SUN_HIGH,high):MOONLIGHT,share:body==='sun'?sunK:moonK,body},
    hemi:{sky:H('sky'),ground:H('ground'),share:lerpBands(weights,{dawn:HEMI.dawn.share,day:1,dusk:HEMI.dusk.share,night:HEMI.night.share*dark})}};
}
const T=new THREE.Color(),U=new THREE.Color(),ACC=new THREE.Color();
/** The sky colour for a band blend: each band's tint of the weather sky, weighted (a new moon darkens the night; clear,
 *  0 thunderstorm … 1 sunny and brilliant, scales dawn's and dusk's glow). */
export function tintSky(weather:THREE.Color,weights:BandWeights,lit:number,out:THREE.Color,clear=1){
  ACC.setRGB(0,0,0);
  for(const b of ['dawn','day','dusk','night'] as Band[]){if(!weights[b])continue;const t=SKY_TINT[b];
    T.copy(weather).multiplyScalar(t.keep).lerp(U.setHex(t.color),b==='night'?t.mix:t.mix*clear);if(b==='night')T.multiplyScalar(.7+.3*lit);ACC.r+=T.r*weights[b];ACC.g+=T.g*weights[b];ACC.b+=T.b*weights[b];}
  return out.copy(ACC);
}

const DISC_VERT=`varying vec2 vUv;void main(){vUv=uv*2.-1.;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// The sun: a hot core and a soft glow. The moon: a sphere lit from the phase angle (right side lit while waxing), its
// dark side a faint earthshine, both fading with the weather's cloud (uAlpha).
const SUN_FRAG=`uniform vec3 uColor;uniform float uAlpha;varying vec2 vUv;void main(){float r=length(vUv);if(r>1.)discard;
  float core=1.-smoothstep(.26,.3,r),glow=pow(1.-r,2.2)*.55;gl_FragColor=vec4(mix(uColor,vec3(1.,.98,.9),core*.6)*1.4,(core+glow)*uAlpha);}`;
const MOON_FRAG=`uniform float uPhase,uAlpha;varying vec2 vUv;void main(){vec2 p=vUv/.62;float r=length(p);
  float glow=pow(max(0.,1.-length(vUv)),2.)*.25*uAlpha;if(r>1.){if(glow<=0.)discard;gl_FragColor=vec4(.75,.8,1.,glow);return;}
  vec3 n=vec3(p,sqrt(1.-r*r));float a=6.2831853*uPhase;vec3 l=vec3(sin(a),0.,-cos(a));float d=smoothstep(-.04,.04,dot(n,l));
  float mottle=.94+.06*sin(p.x*9.+p.y*5.)*sin(p.y*7.-p.x*3.);vec3 c=mix(vec3(.1,.12,.2),vec3(.95,.94,.86)*mottle,d);
  gl_FragColor=vec4(c,mix(.18,1.,d)*uAlpha*(1.-smoothstep(.96,1.,r)));}`;

// ─── Night lights ───────────────────────────────────────────────────────────────────────────────────────────────
/** How far the town's lights are on: all night, most of the way through dusk, a little at dawn. */
export const glowLevel=(w:BandWeights)=>Math.min(1,w.night+.7*w.dusk+.35*w.dawn);
/** At full glow: lamp and lantern brightness × (1 + LAMP_BOOST), window glow WINDOW_GLOW × WINDOW_COLOR, fog density
 *  × (1 + NIGHT_MIST). */
export const LAMP_BOOST=1.3,WINDOW_GLOW=.85,WINDOW_COLOR=0xff9c48,NIGHT_MIST=.35;
/** The key light's sun level at least this at night (× the night weight): the rain tiers' moonlight (overcast 2.5,
 *  clear 3.4; set against the old fair sky's 3). */
export const NIGHT_KEY_FLOOR=2.4;
/** Window rules, a bit mask in a material's userData.nightWindows (textured materials default to NW_WARM):
 *    NW_WARM  lit-window texels the Tripo models paint (sRGB R ≥ 215, G ≥ 170, B ≤ 110)
 *    NW_EMBER the procedural cottages' SE.emberHot panes (vertex colour)
 *    NW_DARK  dark neutral panes on upright faces (procedural Lisbon houses and Pombaline rows, Tripo Lisbon houses);
 *             the brown doors and timbers and the blue-grey iron stay dark.
 *    NW_PANE  the Tripo Lisbon houses' panes: dark grey or dark green texels on upright faces.
 *  userData.nightLift (hex): an emissive floor × the glow for dark-albedo masses (the forest) that the night sky light
 *  alone leaves black. */
export const NW_WARM=1,NW_EMBER=2,NW_DARK=4,NW_PANE=8;
const NW_HEAD=`uniform float uWindowGlow;
float nightWindow(vec3 c,float up){float m=0.;
#if NW_RULE & 1
  m=max(m,step(.68,c.r)*step(.40,c.g)*step(c.b,.155));
#endif
#if NW_RULE & 2
  m=max(m,step(.9,c.r)*step(.12,c.g)*step(c.g,.3)*step(c.b,.06));
#endif
#if NW_RULE & 4
  {float v=max(c.r,max(c.g,c.b));m=max(m,step(.008,v)*step(v,.06)*step(c.b,c.r)*step(c.r-c.b,.012)*step(abs(up),.35));}
#endif
#if NW_RULE & 8
  {float v=max(c.r,max(c.g,c.b));m=max(m,step(.012,v)*step(v,.1)*step(c.r,c.g+.004)*step(c.b,c.g+.004)*step(abs(up),.35));}
#endif
  return m;}`;
// Read-only reuse by the opt-in single-house activity accent; the environment still owns uWindowGlow.
export {NW_HEAD as NIGHT_WINDOW_MASK_GLSL};
const GLINT_HEAD=`uniform float uGlint;uniform vec3 uMoonDir;`;
// The moon's reflection where the view ray mirrors onto the moon: a hot spot the moon's size and a path stretched along
// the view's vertical (a moon road), which the water's own texture (and the rain's rings) break up.
const GLINT_APPLY=`if(uGlint>0.){vec3 L=normalize((viewMatrix*vec4(uMoonDir,0.)).xyz),R=reflect(-normalize(vViewPosition),normal);vec3 d=R-L;
  float tex=dot(diffuseColor.rgb,vec3(.3,.5,.2)),spot=exp(-dot(d,d)*2600.),road=exp(-d.x*d.x*900.-d.y*d.y*25.)*step(0.,dot(R,L));
  totalEmissiveRadiance+=uGlint*vec3(.78,.84,1.)*(spot*3.+road*.35*(.2+2.2*tex));}`;
const DEFAULT_COMPILE=THREE.Material.prototype.onBeforeCompile;
/** Add a fragment patch after emissivemap_fragment, keeping a patch the material already has and its cache key. */
export function chainPatch(m:THREE.MeshStandardMaterial,tag:string,uniforms:Record<string,{value:unknown}>,head:string,apply:string,defines=''){
  const own=m.onBeforeCompile,key=m.customProgramCacheKey.bind(m);
  m.onBeforeCompile=(shader,renderer)=>{if(own!==DEFAULT_COMPILE)own.call(m,shader,renderer);Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+defines+head).replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+apply);};
  m.customProgramCacheKey=()=>key()+'|'+tag;m.needsUpdate=true;
}
const WINDOW_RGB=new THREE.Color(WINDOW_COLOR).toArray().map(v=>v.toFixed(3)).join(',');
const NW_APPLY=`totalEmissiveRadiance+=uWindowGlow*vec3(${WINDOW_RGB})*nightWindow(diffuseColor.rgb,inverseTransformDirection(normal,viewMatrix).y);`;
/** A lamp-like material: an emissive standard one glowing a visible colour, or an opaque unlit (toneMapped false) basic
 *  one; not a transparent overlay (the you-halo, the lightning bolt) nor one marked userData.nightLamp=false (a screen). */
export const lampLike=(m:THREE.Material)=>m.userData.nightLamp!==false&&(m instanceof THREE.MeshStandardMaterial?m.emissive.r+m.emissive.g+m.emissive.b>.45&&m.emissiveIntensity>0:
  m instanceof THREE.MeshBasicMaterial&&!m.toneMapped&&!m.transparent);
type StdLamp={m:THREE.MeshStandardMaterial;base:number;shown:number};type BasicLamp={m:THREE.MeshBasicMaterial;base:THREE.Color;shown:THREE.Color};

export class DayNight {
  readonly sunDisc:THREE.Mesh;readonly moonDisc:THREE.Mesh;
  /** The previewed hour (the time slider, ?hour=) or null for live world time; `now` the last world time drawn. The
   *  preview stays on the UTC day it started (a real midnight does not move it); a change of time eases in (EASE s). */
  preview:number|null=null;now=0;state:Lighting;
  private anchor:number|null=null;private last=NaN;
  /** Where the key light stands relative to its target (scene.ts frameView), 80 m out along the key's direction. */
  readonly offset=new THREE.Vector3(-40,65,25);
  /** Shared by every window material and every water glint (one write moves them all). */
  readonly windowGlow={uWindowGlow:{value:0}};readonly glint={uGlint:{value:0},uMoonDir:{value:new THREE.Vector3(0,1,0)}};
  /** The night glow (glowLevel) last applied. */
  glow=0;
  /** The rain's share of the window and lamp glow by day, 0..1 (WeatherFx.cosy, set each frame): the windows and lamps
   *  glow at the greater of it and the night's glow; the mist and the moon's glint stay the night's. */
  cosy=0;
  private seen=new WeakSet<THREE.Material>();private lamps:(StdLamp|BasicLamp)[]=[];private lifts:THREE.MeshStandardMaterial[]=[];private scene:THREE.Scene;private nextScan=-Infinity;
  private hemi?:THREE.HemisphereLight;private sunColor=new THREE.Color();private key:THREE.DirectionalLight;
  private readonly materials:SceneMaterialIndex;private readonly ownMaterials:boolean;
  constructor(scene:THREE.Scene,key:THREE.DirectionalLight,materials?:SceneMaterialIndex){
    this.key=key;this.scene=scene;
    this.materials=materials??new SceneMaterialIndex(scene);this.ownMaterials=!materials;
    // The moon's glint on the water (the rain's ripples already patch these; the chain keeps them).
    scene.traverse(o=>{if(o instanceof THREE.Mesh&&/^(river|plaza|stream)-water$/.test(o.name)&&o.material instanceof THREE.MeshStandardMaterial&&!this.seen.has(o.material)){
      this.seen.add(o.material);chainPatch(o.material,'moon-glint',this.glint,GLINT_HEAD,GLINT_APPLY);}});
    scene.traverse(o=>{if(o instanceof THREE.HemisphereLight&&!this.hemi)this.hemi=o;});
    const plane=new THREE.PlaneGeometry(1,1),mat=(frag:string,uniforms:Record<string,{value:unknown}>)=>new THREE.ShaderMaterial({vertexShader:DISC_VERT,fragmentShader:frag,uniforms,transparent:true,depthWrite:false,fog:false,toneMapped:false});
    this.sunDisc=new THREE.Mesh(plane,mat(SUN_FRAG,{uColor:{value:this.sunColor},uAlpha:{value:0}}));this.sunDisc.name='sun-disc';
    this.moonDisc=new THREE.Mesh(plane,mat(MOON_FRAG,{uPhase:{value:0},uAlpha:{value:0}}));this.moonDisc.name='moon-disc';
    for(const d of [this.sunDisc,this.moonDisc]){d.renderOrder=-1;d.visible=false;scene.add(d);}
    this.state=lighting(0);
  }
  /** Once per frame before the weather's update: the time's lighting over the weather's eased sky colour and sun
   *  (sunLevel, WEATHER_SKY) into the background and fog colours, the key light, and the sky light's share (returned,
   *  for WeatherFx.daylight). far: the camera's far plane (the discs sit inside it). mist: the fog whose density
   *  frameView has just set (the night thickens it). */
  update(realMs:number,camera:THREE.PerspectiveCamera,far:number,weatherSky:THREE.Color,sunLevel:number,background:THREE.Color,fog:THREE.Color,mist?:THREE.FogExp2){
    if(this.preview===null)this.anchor=null;else if(this.anchor===null||Math.abs(realMs-this.anchor)>1.5*DAY_MS)this.anchor=realMs;
    // Ease the drawn time toward the target the short way round the clock; live ticking and a hidden tab's return snap.
    const target=worldNow(this.anchor??realMs,this.preview),dt=(realMs-this.last)/1000;this.last=realMs;
    let off=this.now-target;off=((off%DAY_MS)+1.5*DAY_MS)%DAY_MS-DAY_MS/2;
    this.now=!(dt>=0&&dt<2)||Math.abs(off)<SNAP_MS?target:target+off*Math.exp(-dt/EASE);
    const s=this.state=lighting(this.now),clear=smooth(1,3,sunLevel);
    tintSky(weatherSky,s.weights,s.lit,background,clear);fog.copy(background);
    this.offset.set(s.key.dir.x,s.key.dir.y,s.key.dir.z).multiplyScalar(80);
    this.key.color.setHex(s.key.color);this.key.intensity=(sunLevel+Math.max(0,NIGHT_KEY_FLOOR-sunLevel)*s.weights.night)*s.key.share;
    if(this.hemi){this.hemi.color.setHex(s.hemi.sky);this.hemi.groundColor.setHex(s.hemi.ground);}
    // Discs: far out along each body's direction, facing the camera, ~4° (sun) and ~3° (moon) across; the weather's
    // cloud (its sun level, 0.7 thunderstorm … 3.6 brilliant) hides them.
    const D=Math.min(far*.8,1200);
    const place=(m:THREE.Mesh,p:SkyPos,size:number,alpha:number)=>{m.visible=alpha>.01&&p.altitude>-.08;if(!m.visible)return;
      m.position.set(camera.position.x+p.x*D,camera.position.y+p.y*D,camera.position.z+p.z*D);
      m.quaternion.copy(camera.quaternion);m.scale.setScalar(D*size);(m.material as THREE.ShaderMaterial).uniforms.uAlpha.value=alpha;};
    this.sunColor.setHex(mixHex(SUN_LOW,SUN_HIGH,smooth(.05,.45,s.sun.y)));
    place(this.sunDisc,s.sun,.14,clear*smooth(-.08,.02,s.sun.y));
    (this.moonDisc.material as THREE.ShaderMaterial).uniforms.uPhase.value=s.phase;
    place(this.moonDisc,s.moon,.1,clear*(.35+.65*(1-smooth(-.1,.15,s.sun.y)))*smooth(-.08,.02,s.moon.y));
    // Night lights: windows, lamps, mist; the glint needs the moon up over a dark sky (a thin moon barely shows, and
    // cloud dims it but a stormy night still catches a little).
    const g=this.glow=glowLevel(s.weights),lights=Math.max(g,Math.min(1,Math.max(0,this.cosy)||0));this.windowGlow.uWindowGlow.value=WINDOW_GLOW*lights;if(mist)mist.density*=1+NIGHT_MIST*g;
    const m=this.glint.uMoonDir.value.set(s.moon.x,s.moon.y,s.moon.z).normalize();
    this.glint.uGlint.value=g*smooth(.09,.2,m.y)*(1-smooth(-.1,0,s.sun.y))*(NEW_MOON+(1-NEW_MOON)*s.lit)*(.25+.75*clear);
    if(realMs>=this.nextScan){this.nextScan=realMs+2000;this.scan();}
    this.boost(1+LAMP_BOOST*lights);for(const m of this.lifts)m.emissive.setHex(m.userData.nightLift).multiplyScalar(g);   // dark foliage's moonlit floor
    return s.hemi.share;
  }
  /** Every 2 s: patch new window materials and register new lamps (houses are rebuilt with each read, Tripo models
   *  load late); lamps no longer in the scene are dropped. */
  scan(){
    const live=new Set<THREE.Material>();
    this.materials.forEach(o=>{
      for(const m of Array.isArray(o.material)?o.material:[o.material]){live.add(m);if(this.seen.has(m))continue;this.seen.add(m);
        if(lampLike(m))this.lamps.push(m instanceof THREE.MeshStandardMaterial?{m,base:m.emissiveIntensity,shown:m.emissiveIntensity}:{m:m as THREE.MeshBasicMaterial,base:(m as THREE.MeshBasicMaterial).color.clone(),shown:(m as THREE.MeshBasicMaterial).color.clone()});
        else if(m instanceof THREE.MeshStandardMaterial&&typeof m.userData.nightLift==='number')this.lifts.push(m);
        else if(m instanceof THREE.MeshStandardMaterial&&!m.transparent){const rule=m.userData.nightWindows??(m.map?NW_WARM:0);
          if(rule)chainPatch(m,'night-windows-'+rule,this.windowGlow,NW_HEAD,NW_APPLY,'#define NW_RULE '+rule+'\n');}}});
    this.lamps=this.lamps.filter(l=>live.has(l.m));this.lifts=this.lifts.filter(m=>live.has(m));
  }
  /** Release only a privately created index; an injected shared index has its own owner. */
  dispose(){if(this.ownMaterials)this.materials.dispose();}
  /** Lamps × k. Another writer (an animator, a feed) sets the base; the boost multiplies whatever it last wrote. */
  private boost(k:number){
    for(const l of this.lamps){
      if(l.m instanceof THREE.MeshStandardMaterial){const x=l as StdLamp;if(x.m.emissiveIntensity!==x.shown)x.base=x.m.emissiveIntensity;x.m.emissiveIntensity=x.shown=x.base*k;}
      else{const x=l as BasicLamp;if(!x.m.color.equals(x.shown))x.base.copy(x.m.color);x.m.color.copy(x.base).multiplyScalar(k);x.shown.copy(x.m.color);}
    }
  }
}
