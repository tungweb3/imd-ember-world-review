import * as THREE from 'three';

// StickEmber palette: Codex's warm stone and teal stay; basalt, ember, banner red and moss come from the
// novel's scene art (灰燼區, 城心高塔, 石龜村, 火焰城門). Data colours stay in scene.ts.
export const SE={
  basalt:0x34373a,basaltLight:0x4d4f4f,sand:0xb09a76,sandLight:0xc9b793,stone:0x9c977e,
  gold:0xccb875,brass:0xb08a4a,iron:0x2b2d2f,ember:0xf4a151,emberHot:0xff7a2e,
  banner:0x8e2a22,tealDeep:0x2f515c,teal:0x8ae0ca,moss:0x62734c,earth:0x6e5d47,ink:0x1f3239,
  star:0x9d8be0,roofClaude:0x985a48,roofCodex:0x557a70,roofIdle:0x5d6462
};

const cache=new Map<string,THREE.MeshStandardMaterial>();
/** Shared materials: one per colour/glow pair so the whole city stays at a few dozen materials. */
export function mat(color:number,glow=0,opts:{flat?:boolean;rough?:number;metal?:number;side?:THREE.Side}={}){
  const key=[color,glow,opts.flat??0,opts.rough??.86,opts.metal??.06,opts.side??0].join('|');
  let m=cache.get(key);
  if(!m){m=new THREE.MeshStandardMaterial({color,roughness:opts.rough??.86,metalness:opts.metal??.06,emissive:glow?color:0,emissiveIntensity:glow,flatShading:opts.flat??false,side:opts.side??THREE.FrontSide});cache.set(key,m);}
  return m;
}
export function part(geometry:THREE.BufferGeometry,material:THREE.Material,x=0,y=0,z=0){
  const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;return m;
}
export const cube=(w:number,h:number,d:number,color:number,x=0,y=0,z=0,glow=0)=>part(new THREE.BoxGeometry(w,h,d),mat(color,glow),x,y,z);
export const drum=(rTop:number,rBottom:number,h:number,color:number,x=0,y=0,z=0,sides=12,glow=0)=>part(new THREE.CylinderGeometry(rTop,rBottom,h,sides),mat(color,glow,{flat:sides<=8}),x,y,z);
export function hoop(r:number,tube:number,color:number,y:number,glow=.25,segments=64){
  const m=part(new THREE.TorusGeometry(r,tube,6,segments),mat(color,glow),0,y,0);m.rotation.x=-Math.PI/2;m.castShadow=false;return m;
}
/** Triangular prism with the ridge along X: gable roofs and forge sheds. */
export function gable(w:number,h:number,d:number,color:number,x=0,y=0,z=0){
  const shape=new THREE.Shape([new THREE.Vector2(-d/2,0),new THREE.Vector2(d/2,0),new THREE.Vector2(0,h)]);
  const g=new THREE.ExtrudeGeometry(shape,{depth:w,bevelEnabled:false});g.translate(0,0,-w/2);g.rotateY(Math.PI/2);
  return part(g,mat(color,0,{flat:true}),x,y,z);
}

let bannerTexture:THREE.CanvasTexture|null=null;
/** Red cloth with a gold flame mark, the recurring emblem of 火焰城 banners. Blank of any lettering. */
export function bannerMaterial(){
  if(!bannerTexture){
    const c=document.createElement('canvas');c.width=64;c.height=160;const g=c.getContext('2d')!;
    g.fillStyle='#7d241d';g.fillRect(0,0,64,160);g.fillStyle='#5a1914';g.fillRect(0,0,64,10);g.fillRect(0,150,64,10);
    g.strokeStyle='#d9a441';g.lineWidth=3;g.strokeRect(6,14,52,132);
    g.fillStyle='#e0ac47';g.beginPath();g.moveTo(32,48);g.bezierCurveTo(50,70,44,96,32,104);g.bezierCurveTo(20,96,14,76,26,62);g.bezierCurveTo(26,72,30,76,32,78);g.bezierCurveTo(30,66,28,58,32,48);g.fill();
    g.fillStyle='#7d241d';g.beginPath();g.moveTo(32,74);g.bezierCurveTo(38,84,36,96,32,98);g.bezierCurveTo(28,96,27,88,32,74);g.fill();
    g.beginPath();g.moveTo(0,160);g.lineTo(32,146);g.lineTo(64,160);g.fillStyle='rgba(0,0,0,0)';g.globalCompositeOperation='destination-out';g.fill();
    bannerTexture=new THREE.CanvasTexture(c);bannerTexture.colorSpace=THREE.SRGBColorSpace;
  }
  return new THREE.MeshStandardMaterial({map:bannerTexture,side:THREE.DoubleSide,roughness:.95,transparent:true,alphaTest:.5});
}
/** Banner hanging from a crossbar; the flag faces local +Z. */
export function banner(width:number,height:number,x=0,y=0,z=0){
  const g=new THREE.Group();g.position.set(x,y,z);
  const cloth=new THREE.Mesh(new THREE.PlaneGeometry(width,height),bannerMaterial());cloth.position.y=-height/2;cloth.castShadow=true;cloth.name='banner-cloth';
  g.add(cloth,cube(width+.3,.12,.12,SE.brass,0,.05,0));return g;
}
export function bannerPost(height:number,x=0,z=0,facing=0){
  const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=facing;
  g.add(cube(.28,height,.28,SE.basalt,0,height/2,0),cube(.5,.3,.5,SE.basaltLight,0,.15,0),banner(1.1,height*.55,0,height-.25,.2));
  g.add(part(new THREE.SphereGeometry(.16,8,6),mat(SE.ember,.9),0,height+.12,0));
  return g;
}
export function brazier(x=0,y=0,z=0,scale=1){
  const g=new THREE.Group();g.position.set(x,y,z);g.scale.setScalar(scale);
  g.add(drum(.38,.24,.42,SE.iron,0,.21,0,8),drum(.08,.12,.5,SE.iron,0,-.05,0,6));
  const coal=part(new THREE.SphereGeometry(.3,8,5,0,Math.PI*2,0,Math.PI/2),mat(SE.emberHot,1.4),0,.38,0);coal.name='ember-glow';coal.castShadow=false;g.add(coal);
  return g;
}
