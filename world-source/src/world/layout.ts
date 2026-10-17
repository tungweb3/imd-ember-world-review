import { compareIds, decimalId } from './model.ts';
import { LAYOUT_BAKED } from './layoutBaked.ts';
export type Point = { x:number; z:number };
export type Layout = Record<string,number>;
export function extendLayout(layout: Layout, ids: string[]): Layout {
  const next: Layout={}, slots=new Set<number>(); let cursor=0;
  const savedEntries=Object.entries(layout);
  for(const [id,slot] of savedEntries) {
    if(decimalId(id)!==id || !Number.isSafeInteger(slot) || slot<0 || slot>=savedEntries.length || slots.has(slot)) continue;
    next[id]=slot; slots.add(slot); cursor=Math.max(cursor,slot+1);
  }
  for(const id of [...new Set(ids)].sort(compareIds)) if(decimalId(id)===id && next[id]===undefined) next[id]=cursor++;
  return next;
}

// ─── Map revision v002 ────────────────────────────────────────────────────────────────────────────────
// 1 unit = 1 m, Y up, north = -Z.
// 燼渡 Emberford (first village, Lisbon): the river runs from the waterfall by the sealed Memory Gate (north-west)
//   out to the south-east. A Terreiro-do-Paço square opens onto the quay, arcaded wings on three sides, a
//   triumphal arch to the north and the Hall of the Heart behind it. One stone bridge leads to the Agents'
//   hillside (Alfama-style houses) across the water.
// 霜谷 Frosthollow (second village, Skyrim): a timber village on a high valley above the waterfall, reached by
//   the pass trail that climbs beside the Memory Gate. Agent homes move there once Emberford's hillside is full.

export const SPAWN={x:0,z:-3};
export const SQUARE={x:0,z:-7,hw:18,hd:11,h:.4};
export const HALL={x:0,z:-35,hw:10,hd:8,h:1.6};

/** River centreline, upstream → downstream, with half-width w. Sampled with Catmull-Rom into RIVER_PATH. */
export const RIVER_KNOTS=[
  {x:-104,z:-62,w:2.6},{x:-88,z:-49,w:3.2},{x:-70,z:-33,w:3.7},{x:-54,z:-16,w:4.1},{x:-38,z:-2,w:4.4},
  {x:-20,z:8,w:4.6},{x:-2,z:12.5,w:4.8},{x:18,z:12,w:5},{x:34,z:8,w:5.2},{x:52,z:9,w:5.4},
  {x:70,z:20,w:5.8},{x:90,z:38,w:6.2},{x:112,z:60,w:6.6},{x:134,z:84,w:7}
];
function catmull(p0:number,p1:number,p2:number,p3:number,t:number){
  const t2=t*t,t3=t2*t;return .5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);
}
export type RiverSample={x:number;z:number;w:number;s:number};
function sampleKnots(k:{x:number;z:number;w:number}[]):RiverSample[]{
  const out:RiverSample[]=[];let s=0;
  for(let i=0;i<k.length-1;i++){
    const a=k[Math.max(0,i-1)],b=k[i],c=k[i+1],d=k[Math.min(k.length-1,i+2)],steps=Math.ceil(Math.hypot(c.x-b.x,c.z-b.z));
    for(let j=0;j<steps;j++){const t=j/steps,x=catmull(a.x,b.x,c.x,d.x,t),z=catmull(a.z,b.z,c.z,d.z,t),w=b.w+(c.w-b.w)*t;
      if(out.length){const p=out[out.length-1];s+=Math.hypot(x-p.x,z-p.z);}out.push({x,z,w,s});}
  }
  const last=k[k.length-1],p=out[out.length-1];out.push({x:last.x,z:last.z,w:last.w,s:s+Math.hypot(last.x-p.x,last.z-p.z)});
  return out;
}
export const RIVER_PATH=sampleKnots(RIVER_KNOTS);
/** Nearest of the segments in `list` (all of them when null), in segment order with a strict '<' on Math.hypot. A
 *  segment whose squared distance is over the best one's by more than a part in 10^9 is passed over without its hypot:
 *  it cannot be nearer (hypot and the squares round far closer than that), so the answer is the same, bit for bit. */
function nearestSegment(path:RiverSample[],x:number,z:number,list:Int32Array|null){
  let best=Infinity,bestSq=Infinity,w=0,s=0,side=0;
  for(let m=0,n=list?list.length:path.length-1;m<n;m++){const i=list?list[m]:m;
    const a=path[i],b=path[i+1],dx=b.x-a.x,dz=b.z-a.z,len2=dx*dx+dz*dz||1;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len2)),ex=x-(a.x+dx*t),ez=z-(a.z+dz*t),sq=ex*ex+ez*ez;
    if(sq>bestSq*(1+1e-9))continue;
    const d=Math.hypot(ex,ez);
    if(d<best){best=d;bestSq=sq;w=a.w+(b.w-a.w)*t;s=a.s+(b.s-a.s)*t;side=Math.sign(dx*(z-a.z)-dz*(x-a.x));}
  }
  return {d:best,w,s,side};
}
/** Distance from (x,z) to a sampled centreline, the local half-width and the along-path position: every segment. */
export function pathScan(path:RiverSample[],x:number,z:number){return nearestSegment(path,x,z,null);}
// Exact nearest-segment index: an 8 m grid over ±336 m per path, each cell built on first use (a query only pays for the
// cells near where it is asked). A cell keeps the segments whose distance from its centre is at most the nearest one's
// plus the cell diagonal (no other can be nearest anywhere in the cell), so scanning them in segment order gives
// bit-identical results to pathScan. Outside the grid, pathScan itself.
const IDX_CELL=8,IDX_HALF=336,IDX_N=Math.ceil(2*IDX_HALF/IDX_CELL),IDX_DIAG=Math.SQRT2*IDX_CELL,PATH_INDEX=new WeakMap<RiverSample[],(Int32Array|undefined)[]>();
let idxDist=new Float64Array(0);
function indexCell(path:RiverSample[],cells:(Int32Array|undefined)[],c:number){
  const n=path.length-1,cx=-IDX_HALF+(c%IDX_N+.5)*IDX_CELL,cz=-IDX_HALF+(Math.floor(c/IDX_N)+.5)*IDX_CELL;let near=Infinity;
  if(idxDist.length<n)idxDist=new Float64Array(n);const d=idxDist;
  for(let k=0;k<n;k++){const a=path[k],b=path[k+1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((cx-a.x)*dx+(cz-a.z)*dz)/(dx*dx+dz*dz||1)));d[k]=Math.hypot(cx-a.x-dx*t,cz-a.z-dz*t);if(d[k]<near)near=d[k];}
  const out:number[]=[];for(let k=0;k<n;k++)if(d[k]<=near+IDX_DIAG+1e-9)out.push(k);return cells[c]=Int32Array.from(out);
}
/** pathScan through the segment index. */
function pathQuery(path:RiverSample[],x:number,z:number){
  const i=Math.floor((x+IDX_HALF)/IDX_CELL),j=Math.floor((z+IDX_HALF)/IDX_CELL);if(i<0||j<0||i>=IDX_N||j>=IDX_N)return nearestSegment(path,x,z,null);
  let cells=PATH_INDEX.get(path);if(!cells)PATH_INDEX.set(path,cells=new Array(IDX_N*IDX_N));
  const c=j*IDX_N+i;return nearestSegment(path,x,z,cells[c]??indexCell(path,cells,c));
}
export function riverQuery(x:number,z:number){return pathQuery(RIVER_PATH,x,z);}

// ─── 環島水道 Island canal ─────────────────────────────────────────────────────────────────────────────────
// A branch leaves the falls pool under the Memory Gate, runs down the hillside's west foot, round its south rim through
// the Guardian Mere (守印者湖) and north-east back into the river: the hillside becomes 守印者島 Guardian Isle, while the
// square and every civic landmark stay on the north bank. w = water half-width; v = the valley the canal cuts on the
// island side, vo outside (default CHANNEL_VALLEY_OUT). Knots from the judged design (river-loop J_final).
export const BRANCH_KNOTS:{x:number;z:number;w:number;v:number;vo?:number}[]=[
  {x:-99,z:-49,w:3.4,v:36,vo:12},{x:-103,z:-33,w:3.6,v:36,vo:14},{x:-107.1,z:-14.7,w:3.8,v:36,vo:18},{x:-113.8,z:7.7,w:3.9,v:36,vo:24},{x:-112,z:31,w:4,v:34},
  {x:-99.6,z:53.5,w:4.1,v:21},{x:-86.3,z:72.1,w:4.2,v:20},{x:-76.1,z:86.4,w:4.3,v:20},{x:-70.4,z:107.4,w:4.3,v:21},{x:-65.1,z:132.6,w:4.4,v:36},
  {x:-51.4,z:148.7,w:4.5,v:36},{x:-30.3,z:149.6,w:4.8,v:36},{x:-11.5,z:141.6,w:7,v:24},{x:4.1,z:139,w:11,v:20},{x:19.4,z:140.2,w:12,v:20},
  {x:33.6,z:141.6,w:9,v:23},{x:52,z:141,w:5.2,v:34},{x:70,z:133,w:5.3,v:36},{x:86,z:122,w:5.4,v:36},{x:94,z:108,w:5.5,v:30},
  {x:98,z:94,w:5.6,v:22},{x:106,z:82,w:5.7,v:26},{x:108,z:70,w:5.8,v:26},{x:104,z:58,w:5.9,v:20},{x:103.5,z:51.5,w:6,v:20}
];
export const BRANCH_PATH=sampleKnots(BRANCH_KNOTS);
export const CHANNEL_VALLEY_OUT=34,CHANNEL_BANK=.5;
const KNOT_S=BRANCH_KNOTS.map(k=>pathScan(BRANCH_PATH,k.x,k.z).s);
/** Valley width at branch position s, interpolated between the knots (island side, or outside when out). */
function valleyAt(s:number,out:boolean){const V=BRANCH_KNOTS.map(k=>out?k.vo??CHANNEL_VALLEY_OUT:k.v);
  for(let i=0;i<KNOT_S.length-1;i++)if(s<=KNOT_S[i+1])return V[i]+(V[i+1]-V[i])*Math.max(0,Math.min(1,(s-KNOT_S[i])/Math.max(1e-6,KNOT_S[i+1]-KNOT_S[i])));
  return V[V.length-1];}
const BRANCH_V=BRANCH_PATH.map(p=>valleyAt(p.s,false)),BRANCH_VO=BRANCH_PATH.map(p=>valleyAt(p.s,true)),BRANCH_CHUNKS:{i0:number;i1:number;x0:number;x1:number;z0:number;z1:number}[]=[];
for(let i=0;i<BRANCH_PATH.length;i+=16){const seg=BRANCH_PATH.slice(i,i+17),xs=seg.map(p=>p.x),zs=seg.map(p=>p.z);
  BRANCH_CHUNKS.push({i0:i,i1:Math.min(BRANCH_PATH.length-1,i+16),x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs)});}
/** Round water at the river's live level, each with its own valley width v: the falls pool under the waterfall (narrow,
 *  or it would undercut the cliff), the reed lagoon at the river mouth and the Ember Lift's cradle bay. */
export const BASINS:{id:string;x:number;z:number;r:number;v:number}[]=[{id:'falls-pool',x:-101,z:-53,r:7,v:10},{id:'delta-lagoon',x:140.7,z:91.4,r:14,v:16},{id:'lift-bay',x:-107,z:-57.8,r:2,v:1.5}];
/** The Ember Lift's aqueduct runs from a (by the tower) to j (in the stream). Its cradle (frostLine.ts) sits at the bottom in
 *  LIFT_PIT: a 6.0 × 2.4 m box on the aqueduct's axis, its tower end 0.5 m short of a, over the lift bay. landHeight digs the
 *  bed under it (and PIT_MARGIN round it, then up at PIT_SLOPE), so no earth shows in the cradle at low water; the water
 *  rules (waterQuery) are the bay's as before; the tower's footprint is left alone (its plinth walls the pit). */
const AQ_A={x:-107.6,z:-59.6},AQ_J={x:-110.7,z:-69},AQ_L=Math.hypot(AQ_J.x-AQ_A.x,AQ_J.z-AQ_A.z);
export const LIFT_PIT:Wall={id:'lift-pit',x:AQ_A.x-(AQ_J.x-AQ_A.x)/AQ_L*3.5,z:AQ_A.z-(AQ_J.z-AQ_A.z)/AQ_L*3.5,hw:1.2,hd:3,rotation:Math.atan2(AQ_J.x-AQ_A.x,AQ_J.z-AQ_A.z)*180/Math.PI};
/** The pits landHeight digs (a list, as BASINS: the terrain guard takes it out to measure the cut). */
/** The falls pool's berth: the Falls landing's boats lie between its deck and Guardian Isle's west tip, whose south
 *  shoulder is dredged back to the bed so no sand shows inside a hull at low water (tests/boats.test.mjs, the drawn ground). */
export const BERTH_PIT:Wall={id:'berth-pit',x:-94.5,z:-50.1,hw:2.2,hd:.7,rotation:0};
export const PITS:Wall[]=[LIFT_PIT,BERTH_PIT];
const PIT_MARGIN=.3,PIT_SLOPE=3;
function pitFloor(x:number,z:number){let h=Infinity;
  if(inBox(BOAT_LIFT,x,z,.1))return h;   // the tower's plinth is the pit's west wall: its footing keeps the ground as it was
  for(const P of PITS){const r=P.rotation*Math.PI/180,dx=x-P.x,dz=z-P.z,lx=dx*Math.cos(r)-dz*Math.sin(r),lz=dx*Math.sin(r)+dz*Math.cos(r);
    h=Math.min(h,WATER_BED+Math.hypot(Math.max(0,Math.abs(lx)-P.hw-PIT_MARGIN),Math.max(0,Math.abs(lz)-P.hd-PIT_MARGIN))*PIT_SLOPE);}
  return h;}

/** 0..1: the canal valley's hold on the land (0 at the bank, 1 untouched), the lowest over nearby branch samples and
 *  basins; inner = on the island side. */
export function channelValley(x:number,z:number,inner:boolean){let t=1;
  for(const c of BRANCH_CHUNKS){if(x<c.x0-44||x>c.x1+44||z<c.z0-44||z>c.z1+44)continue;
    for(let i=c.i0;i<=c.i1;i++){const p=BRANCH_PATH[i],d=Math.hypot(x-p.x,z-p.z),V=inner?BRANCH_V[i]:BRANCH_VO[i];if(d<p.w+V)t=Math.min(t,smooth(p.w+1,p.w+V,d));}}
  for(const b of BASINS){const d=Math.hypot(x-b.x,z-b.z);if(d<b.r+b.v)t=Math.min(t,smooth(b.r+1,b.r+b.v,d));}
  return t;}
const BRANCH_BOX=BRANCH_PATH.reduce((b,p)=>({x0:Math.min(b.x0,p.x-p.w),x1:Math.max(b.x1,p.x+p.w),z0:Math.min(b.z0,p.z-p.w),z1:Math.max(b.z1,p.z+p.w)}),{x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity});
/** Nearest canal water (branch or basin) like riverQuery; d − w is the distance past its edge. */
export function channelQuery(x:number,z:number){
  let best=x<BRANCH_BOX.x0-60||x>BRANCH_BOX.x1+60||z<BRANCH_BOX.z0-60||z>BRANCH_BOX.z1+60?{d:Infinity,w:0,s:0,side:0}:pathQuery(BRANCH_PATH,x,z);
  for(const b of BASINS){const d=Math.hypot(x-b.x,z-b.z);if(d-b.r<best.d-best.w)best={d,w:b.r,s:0,side:0};}
  return best;}
/** Nearest of Emberford's water (river, canal, basins); pass the river query when it is already known. */
export function waterQuery(x:number,z:number,river=riverQuery(x,z)){const c=channelQuery(x,z);return c.d-c.w<river.d-river.w?c:river;}
/** River positions (s) of the split in the falls pool and of the join. */
export const S_SPLIT=riverQuery(BRANCH_PATH[0].x,BRANCH_PATH[0].z).s,S_JOIN=riverQuery(BRANCH_PATH[BRANCH_PATH.length-1].x,BRANCH_PATH[BRANCH_PATH.length-1].z).s;
/** 守印者島 Guardian Isle: the river from the split to the join, then the canal back to the split. */
export const ISLAND:Point[]=[...RIVER_PATH.filter(p=>p.s>=S_SPLIT&&p.s<=S_JOIN).map(p=>({x:p.x,z:p.z})),...[...BRANCH_PATH].reverse().map(p=>({x:p.x,z:p.z}))];
function inPolygon(poly:Point[],x:number,z:number){let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;}
  return inside;}
// onIsland: a 1 m raster (a cell is in when its centre is), built lazily; cells within 2 of the outline ask inPolygon.
const ISLAND_BOX=ISLAND.reduce((b,p)=>({x0:Math.min(b.x0,p.x),x1:Math.max(b.x1,p.x),z0:Math.min(b.z0,p.z),z1:Math.max(b.z1,p.z)}),{x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity});
const ISL_X0=Math.floor(ISLAND_BOX.x0)-1,ISL_Z0=Math.floor(ISLAND_BOX.z0)-1,ISL_NX=Math.ceil(ISLAND_BOX.x1)-ISL_X0+2,ISL_NZ=Math.ceil(ISLAND_BOX.z1)-ISL_Z0+2;
let islandBits:Uint8Array|null=null;   // 0 out, 1 in, 2 near the outline
function islandRaster(){const bits=new Uint8Array(ISL_NX*ISL_NZ);
  for(let j=0;j<ISL_NZ;j++){const z=ISL_Z0+j+.5,xs:number[]=[];
    for(let i=0,k=ISLAND.length-1;i<ISLAND.length;k=i++){const a=ISLAND[i],b=ISLAND[k];if((a.z>z)!==(b.z>z))xs.push((b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x);}
    xs.sort((a,b)=>a-b);for(let m=0;m+1<xs.length;m+=2)for(let i=Math.max(0,Math.ceil(xs[m]-ISL_X0-.5));i<ISL_NX&&ISL_X0+i+.5<xs[m+1];i++)bits[j*ISL_NX+i]=1;}
  for(let k=0;k<ISLAND.length;k++){const a=ISLAND[k],b=ISLAND[(k+1)%ISLAND.length],n=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)*2)+1;
    for(let t=0;t<=n;t++){const x=a.x+(b.x-a.x)*t/n,z=a.z+(b.z-a.z)*t/n;
      for(let di=-2;di<=2;di++)for(let dj=-2;dj<=2;dj++){const i=Math.floor(x-ISL_X0)+di,j=Math.floor(z-ISL_Z0)+dj;if(i>=0&&j>=0&&i<ISL_NX&&j<ISL_NZ)bits[j*ISL_NX+i]=2;}}}
  return bits;}
export function onIsland(x:number,z:number){
  if(x<ISLAND_BOX.x0||x>ISLAND_BOX.x1||z<ISLAND_BOX.z0||z>ISLAND_BOX.z1)return false;
  const b=(islandBits??=islandRaster())[Math.floor(z-ISL_Z0)*ISL_NX+Math.floor(x-ISL_X0)];return b===2?inPolygon(ISLAND,x,z):b===1;}

// ─── 霜谷 Frosthollow: high valley, its stream and the pass ────────────────────────────────────────────
/** The second village's valley: flat floor inside rIn, rising to a ridge line of peaks and cols (rimAt) round it; floor
 *  height in metres. rOut bounds the valley's own ground (tint, lots, timber houses), not the ridge. */
export const VILLAGE2={x:-175,z:-132,rIn:58,rOut:80,floor:10.4,name:'霜谷',en:'Frosthollow'};
/** Mountain stream through Frosthollow; it pours over the cliff as the waterfall that starts the Ember River. */
export const STREAM_KNOTS=[
  {x:-232,z:-178,w:2.1},{x:-210,z:-160,w:2.1},{x:-190,z:-146,w:2.1},{x:-172,z:-130,w:2.2},{x:-155,z:-114,w:2.4},
  {x:-138,z:-97,w:2.5},{x:-122,z:-81,w:2.6},{x:-106.5,z:-64.5,w:2.6}
];
export const STREAM_PATH=sampleKnots(STREAM_KNOTS);
export const STREAM_WATER=VILLAGE2.floor-.65;
const STREAM_BOX=STREAM_PATH.reduce((b,p)=>({x0:Math.min(b.x0,p.x),x1:Math.max(b.x1,p.x),z0:Math.min(b.z0,p.z),z1:Math.max(b.z1,p.z)}),{x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity});
const STREAM_LENGTH=STREAM_PATH[STREAM_PATH.length-1].s;
/** The stream's own channel anywhere (inWorld's halo follows this, never water added around it). */
export function streamPathQuery(x:number,z:number){const q=pathQuery(STREAM_PATH,x,z);return {...q,fromEnd:STREAM_LENGTH-q.s};}
/** Like riverQuery for the mountain stream; fromEnd = metres left before the waterfall lip. */
export function streamQuery(x:number,z:number){
  if(x<STREAM_BOX.x0-60||x>STREAM_BOX.x1+60||z<STREAM_BOX.z0-60||z>STREAM_BOX.z1+60)return {d:Infinity,w:0,s:0,side:0,fromEnd:Infinity};
  return streamPathQuery(x,z);
}
/** 霜鏡潭 Frost Tarn: a small lake at the stream's head, at STREAM_WATER (the Frost line's boats turn here). */
export const FROST_TARN={x:-228,z:-175,r:13};
/** Frosthollow's water, the stream or the tarn, like streamQuery. The tarn reads as stream water of half-width 2.2 whose
 *  centreline is the disc of radius r − 2.2, so every rule that measures past the water's edge takes it as it is. */
export function frostWaterQuery(x:number,z:number){
  const q=streamQuery(x,z),e=Math.hypot(x-FROST_TARN.x,z-FROST_TARN.z)-FROST_TARN.r;return e<q.d-q.w?{d:e+2.2,w:2.2,s:0,side:0,fromEnd:Infinity}:q;
}

// ─── 霜谷渡口 Frosthollow landing: the Frost line's village stop and passing place (owner, 2026-10-01) ──────────────────
// A stop in the village where the Frost line calls, and a second shuttle so the wait halves. The line is one boat wide
// (the lift's cradle, the aqueduct's trough, the stream itself), so the two shuttles, half a cycle apart, pass at this stop
// as single-track railways do at a station: the up-bound one (toward the tarn) pulls into a bay cut in the south-west
// bank below the Frost bridge, between the longhouse and the watermill, and lies at a landing stage at its back; the
// down-bound one (toward the falls) lies in the lane at a landing stage on the north-east bank, on the pass trail's edge.
// The bay is landHeight's alone (frostBayQuery, carved in highland): the water rules the lots, the homes and the forest
// read (frostWaterQuery, PATHS) do not know it, so none of them changes (tests/home-fixture.test.mjs,
// tests/layout-bake.test.mjs); only the terrain field does, in the bay (tests/terrain-field.test.mjs).
/** A lane offset (as boats.ts Shift): `off` metres to the path's side +1 at path position s, held over ±hold, eased out
 *  over `ease` m (15). */
export type LaneShift={s:number;off:number;hold:number;ease?:number};
export function laneOffset(shifts:LaneShift[],s:number){let o=0;for(const k of shifts)o+=k.off*(1-smooth(k.hold,k.hold+(k.ease??15),Math.abs(s-k.s)));return o;}
let FROST_LANE_SHIFTS:LaneShift[]|null=null;
/** The Frost line's lane up the stream (frostLine.ts sails it): centred under the Frost bridge, 0.5 m off the watermill's
 *  side (streamPathQuery's side +1 is the south-west bank, the mill's and the longhouse's). */
export function frostLane():LaneShift[]{
  if(FROST_LANE_SHIFTS)return FROST_LANE_SHIFTS;const mill=WALLS.find(w=>w.id==='v2-mill')!,w=streamPathQuery(mill.x,mill.z),b=streamPathQuery((BRIDGE2.x1+BRIDGE2.x2)/2,(BRIDGE2.z1+BRIDGE2.z2)/2);
  return FROST_LANE_SHIFTS=[{s:w.s,off:-.5*w.side,hold:6},{s:b.s,off:0,hold:5}];}
/** The station: the up-bound berth `up.s` m down the stream from the tarn, `up.off` m south-west of the lane (its hull
 *  0.56 m clear of the down-bound one beside it), held ±hold, eased in over `ease` (it leaves the lane past the mill's
 *  wheel and is back in it before the Frost bridge); the down-bound berth at `down.s` in the lane, 2 m upstream, so the
 *  up-bound shuttle coming in passes the other's bow already in the bay. The bay is the water round the up-bound path,
 *  `w` m either side of it (2.5: at 2.1 a phone's coarser ground showed 0.37 m of bank in a hull leaving it). Its
 *  landings: STOP_PIERS. */
export const FROST_STATION={up:{s:88,off:2.75,hold:3,ease:6},down:{s:86},w:2.5} as const;
let FROST_BAY:{path:(RiverSample&{o:number})[];x0:number;x1:number;z0:number;z1:number}|null=null;
/** The up-bound shuttle's path through the bay, every half metre of the stream from where it leaves the lane to where it
 *  is back (lane and bay offsets on the stream's centreline, o metres to its south-west; w the bay's half-width). */
export function frostBay(){
  if(FROST_BAY)return FROST_BAY;const U=FROST_STATION.up,reach=U.hold+U.ease,lane=frostLane(),P=STREAM_PATH,path:(RiverSample&{o:number})[]=[];
  for(let s=U.s-reach;s<=U.s+reach+1e-9;s+=.5){const i=Math.max(1,P.findIndex(p=>p.s>=s)),a=P[i-1],b=P[i],f=(s-a.s)/(b.s-a.s),dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);
    const o=laneOffset(lane,s)+U.off*(1-smooth(U.hold,reach,Math.abs(s-U.s)));path.push({x:a.x+dx*f-dz/l*o,z:a.z+dz*f+dx/l*o,w:FROST_STATION.w,s,o});}
  const m=FROST_STATION.w+3;return FROST_BAY={path,x0:Math.min(...path.map(p=>p.x))-m,x1:Math.max(...path.map(p=>p.x))+m,z0:Math.min(...path.map(p=>p.z))-m,z1:Math.max(...path.map(p=>p.z))+m};}
let STREAM_DRAWN:RiverSample[]|null=null;
/** The stream as drawn (its water, skin/frost.ts; the maps' ribbon): STREAM_PATH, its south-west edge out round the bay
 *  where the bay's water reaches past it (each sample's middle moved half that way and widened as much, so the ribbon's
 *  north-east edge stays where it was). */
export function streamDrawn():RiverSample[]{
  if(STREAM_DRAWN)return STREAM_DRAWN;const B=frostBay().path,P=STREAM_PATH;
  return STREAM_DRAWN=P.map((p,i)=>{if(p.s<B[0].s||p.s>B[B.length-1].s)return p;const k=Math.min(B.length-2,Math.floor((p.s-B[0].s)/.5)),f=(p.s-B[k].s)/(B[k+1].s-B[k].s),o=B[k].o+(B[k+1].o-B[k].o)*f;
    const d=Math.max(0,o+FROST_STATION.w-p.w);if(d<=0)return p;const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],dx=b.x-a.x,dz=b.z-a.z,l=Math.hypot(dx,dz);
    return {x:p.x-dz/l*d/2,z:p.z+dx/l*d/2,w:p.w+d/2,s:p.s};});}
/** Round the stream where the bay can be (worked out without the lane, so a query far off never builds it). */
const BAY_NEAR=(()=>{const U=FROST_STATION.up,r=U.hold+U.ease,m=U.off+FROST_STATION.w+4,P=STREAM_PATH.filter(p=>Math.abs(p.s-U.s)<=r+1);
  return {x0:Math.min(...P.map(p=>p.x))-m,x1:Math.max(...P.map(p=>p.x))+m,z0:Math.min(...P.map(p=>p.z))-m,z1:Math.max(...P.map(p=>p.z))+m};})();
/** Distance from (x,z) to the bay's path and its half-width (d Infinity far from it). */
export function frostBayQuery(x:number,z:number){if(x<BAY_NEAR.x0||x>BAY_NEAR.x1||z<BAY_NEAR.z0||z>BAY_NEAR.z1)return {d:Infinity,w:FROST_STATION.w};
  const B=frostBay();if(x<B.x0||x>B.x1||z<B.z0||z>B.z1)return {d:Infinity,w:FROST_STATION.w};
  let d=Infinity;for(let i=0;i+1<B.path.length;i++){const a=B.path[i],b=B.path[i+1],dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));d=Math.min(d,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));}
  return {d,w:FROST_STATION.w};}

/** The one stone bridge: from the quay (north) to the Agents' bank (south). Deck height peaks mid-span. */
export const BRIDGE={id:'ember-bridge',x1:4.5,z1:4,x2:6.5,z2:23,width:4.6,rise:1.7};
export type BridgeSpec={id:string;x1:number;z1:number;x2:number;z2:number;width:number;rise:number};
/** Deck height of a bridge at (x,z), or null off the deck. base = height at both ends. */
export function deckOf(b:BridgeSpec,base:number,x:number,z:number):number|null{
  const dx=b.x2-b.x1,dz=b.z2-b.z1,len=Math.hypot(dx,dz),ux=dx/len,uz=dz/len;
  const along=(x-b.x1)*ux+(z-b.z1)*uz,across=(x-b.x1)*uz-(z-b.z1)*ux;
  if(along<0||along>len||Math.abs(across)>b.width/2)return null;
  return base+Math.sin(Math.PI*along/len)*b.rise;
}
export function bridgeDeck(x:number,z:number):number|null{return deckOf(BRIDGE,SQUARE.h,x,z);}
/** Frosthollow's stone bridge over the stream, from the longhouse bank (south-west) to the pass-trail bank (north-east). */
export const BRIDGE2:BridgeSpec={id:'frost-bridge',x1:-175.8,z1:-125.9,x2:-168.2,z2:-134.1,width:3.6,rise:1.8};
export function bridge2Deck(x:number,z:number):number|null{return deckOf(BRIDGE2,VILLAGE2.floor,x,z);}
/** Landing stages: flat plank decks at base (m), walkable out over the water; the ember boats moor at their ends, or
 *  alongside one that lies `along` the bank (its axis x1→x2 on the water's edge, the boats sailing that way past it). */
export type PierSpec=BridgeSpec&{base:number;along?:true};
export const PIERS:PierSpec[]=[
  {id:'guardian-pier',x1:15,z1:126.5,x2:15.6,z2:133.5,width:2.4,rise:0,base:0},    // 守印者碼頭: hill-street's end, out into the Guardian Mere
  {id:'falls-landing',x1:-90.3,z1:-55.2,x2:-96.4,z2:-54,width:2.4,rise:0,base:0},  // 瀑布渡口: from the Memory Gate forecourt into the falls pool
  {id:'tarn-landing',x1:-213.2,z1:-172.4,x2:-220.1,z2:-173.6,width:2.4,rise:0,base:10.15}   // 霜鏡潭: into the Frost Tarn
];
/** More stops on the Guardian Isle loop (owner, 2026-09-30: 「燼舟多幾個停靠站」), on free bank of the live layout: each
 *  square to the canal, from a root on dry bank to a boat's half beam and 0.4 m short of the canal's centreline, where the
 *  boats' lane runs (boats.ts moors them square across its end). Every lot of the first 6,000 and every home keeps 2 m
 *  clear of them and their lamps and signs, every lane 5 m (tests/boat-stops.test.mjs). Walked (pierDeck) and drawn
 *  (skin/canal.ts) like the landing stages, but not PIERS entries: the lots read those (lotFits), and no lot changes. */
// And on 2026-10-01 (owner: 「還是各區可以搭船的地方再增幾個？」) three more, so the Jobs district and the island's far
// shores have one near: 工坊渡口 the forge's own landing on the river's north bank, a stage along the bank on the strip
// between the water and the gate trail by the forge yard (the boats lie alongside it, as at the Falls landing; its lamp
// and sign at its ends, off the trail); 島西北碼頭 on the west canal below the island's north-west homes; 湖西碼頭 on the
// canal west of the Guardian Mere, below its south homes. Sited on the live layout as the others: no lot, home, tree or
// rock moves for them.
export const STOP_PIERS:PierSpec[]=[
  {id:'isle-east',x1:100.84,z1:76.62,x2:105.82,z2:77.93,width:2.4,rise:0,base:0},   // 島東碼頭: the isle's east shore, below its east homes
  {id:'isle-west',x1:-75.85,z1:76.47,x2:-78.98,z2:78.91,width:2.4,rise:0,base:0},   // 島西碼頭: the isle's west shore, by its west homes
  {id:'forge-landing',x1:-55.8,z1:-23.63,x2:-51.65,z2:-19.29,width:2.4,rise:0,base:0,along:true},   // 工坊渡口: along the river's north bank, downstream, by the forge yard
  {id:'isle-northwest',x1:-107.59,z1:4.23,x2:-111.47,z2:3.26,width:2.4,rise:0,base:0},   // 島西北碼頭: the isle's north-west shore, on the west canal
  {id:'mere-west',x1:-40.26,z1:144.37,x2:-40.18,z2:149.16,width:2.4,rise:0,base:0},      // 湖西碼頭: the isle's south shore, west of the Guardian Mere
  // 霜谷渡口 (the Frost line's, frostLine.ts): along the bay's back for the up-bound shuttle, on the bank's top by the
  // longhouse, 4 m beside its stern half (a rock lies 3 m past its upstream end); along the north-east bank for the
  // down-bound one, on the pass trail's side (FROST_STATION).
  {id:'frosthollow-landing',x1:-163.89,z1:-115.74,x2:-166.92,z2:-118.34,width:2.4,rise:0,base:11.35,along:true},
  {id:'frosthollow-landing-ne',x1:-165.75,z1:-128,x2:-161.17,z2:-124.12,width:2.4,rise:0,base:10.45,along:true}
];
/** The ember-boat stops added on the loop (2026-09-30 and 2026-10-01), by their piers' ids; the launch's own pier is
 *  another (launchDeck). */
export const NEW_STOPS=['isle-east','isle-west','forge-landing','isle-northwest','mere-west'] as const;
/** An along stage's channel side: +1 when the water lies to the left of x1→x2 (−u.z, u.x), −1 to the right. */
export function alongSide(p:PierSpec){const len=Math.hypot(p.x2-p.x1,p.z2-p.z1),u={x:(p.x2-p.x1)/len,z:(p.z2-p.z1)/len},m={x:(p.x1+p.x2)/2,z:(p.z1+p.z2)/2};
  const wet=(k:number)=>{const q={x:m.x-u.z*k*p.width/2,z:m.z+u.x*k*p.width/2},w=waterQuery(q.x,q.z),s=frostWaterQuery(q.x,q.z);return Math.min(w.d-w.w,s.d-s.w);};
  return wet(1)<wet(-1)?1:-1;}
/** The T heads of the stages shorter than the boat lying at them (島西碼頭, 島西北碼頭: 4 m): a deck across the stage's
 *  end, 5.2 m along the canal and 1.6 m deep, its outer edge the stage's end: the boat lies alongside it and comes no
 *  nearer (as the reviewed new-layout stop, 2026-09-30). Walked as a pier (pierDeck), drawn with the piers
 *  (skin/canal.ts); not a stop, and not a PIERS entry. */
export const PIER_HEADS:PierSpec[]=['isle-west','isle-northwest'].map(id=>{const p=STOP_PIERS.find(p=>p.id===id)!,len=Math.hypot(p.x2-p.x1,p.z2-p.z1),u={x:(p.x2-p.x1)/len,z:(p.z2-p.z1)/len},c={x:p.x2-u.x*.8,z:p.z2-u.z*.8};
  return {id:id+'-head',x1:c.x+u.z*2.6,z1:c.z-u.x*2.6,x2:c.x-u.z*2.6,z2:c.z+u.x*2.6,width:1.6,rise:0,base:p.base};});
/** 啟印台's pier (skin/landmarks.ts launch(), skin/linkage.ts PIER): 3.2 m wide, out from LAUNCH_ANCHOR (the live dais's
 *  middle) `from`..`to` m along the platform's facing. It stops short of mid-river: boats.ts moors the boats square across
 *  its end, 0.45 m past it. The grown dais (2026-09-30) reaches LAUNCH_SHIFT m further landward, not riverward, so the
 *  pier, its instruments and the stop stay where they were (tests/landmark-growth.test.mjs). */
export const LAUNCH_PIER={from:5,to:10.5,width:3.2} as const;
/** The launch pier's deck top over the dais's ground (skin/landmarks.ts launch(): its planks' top). */
export const LAUNCH_DECK_TOP=.225;
let LAUNCH_DECK:PierSpec|null=null;
/** 啟印台's pier as walked, a stop of the ember boats since 2026-09-30: its deck (LAUNCH_PIER from LAUNCH_ANCHOR, turned
 *  with the dais) from just inside the dais's riverside rim (the drum's foot, LAUNCH_ANCHOR.dais from the anchor, so no
 *  water shows between them) to its end, at the dais's ground plus LAUNCH_DECK_TOP; you step onto it from the bank east
 *  of the dais. Not a PIERS entry: the dais draws it (skin/landmarks.ts). */
export function launchDeck():PierSpec{
  if(LAUNCH_DECK)return LAUNCH_DECK;const p={...LAUNCH_ANCHOR,rotation:LANDMARKS.find(b=>b.id==='launch')!.rotation},r=p.rotation*Math.PI/180,at=(d:number)=>({x:p.x-Math.sin(r)*d,z:p.z-Math.cos(r)*d});
  const a=at(LAUNCH_PIER.from-.4),b=at(LAUNCH_PIER.to);
  return LAUNCH_DECK={id:'launch-pier',x1:a.x,z1:a.z,x2:b.x,z2:b.z,width:LAUNCH_PIER.width,rise:0,base:landHeight(p.x,p.z)+LAUNCH_DECK_TOP};
}
/** What stands on the launch pier's deck in your way (skin/linkage.ts pierInstruments): the $1B beacon's footing near its
 *  end, a box in the dais's frame (walls: collision.ts). The hour lamps' 12 cm rail and 7 cm posts along its east edge are
 *  stepped over: as a wall they would cut the pier from the bank on that side. */
export function launchSolids():Wall[]{
  const p={...LAUNCH_ANCHOR,rotation:LANDMARKS.find(b=>b.id==='launch')!.rotation},r=p.rotation*Math.PI/180,w=(lx:number,lz:number)=>({x:p.x+lx*Math.cos(r)+lz*Math.sin(r),z:p.z-lx*Math.sin(r)+lz*Math.cos(r)});
  return [{id:'launch-beacon',...w(0,-(LAUNCH_PIER.to-.9)),hw:.65,hd:.65,rotation:p.rotation}];
}
/** A boat stop's landing stage: a PIERS or STOP_PIERS deck, or the launch's own pier. */
export function stopPier(id:string):PierSpec|undefined{return id==='launch-pier'?launchDeck():[...PIERS,...STOP_PIERS].find(p=>p.id===id);}
export function pierDeck(x:number,z:number):number|null{for(const p of PIERS){const d=deckOf(p,p.base,x,z);if(d!==null)return d;}
  for(const p of STOP_PIERS){const d=deckOf(p,p.base,x,z);if(d!==null)return d;}for(const p of PIER_HEADS){const d=deckOf(p,p.base,x,z);if(d!==null)return d;}
  const l=launchDeck();return deckOf(l,l.base,x,z);}
/** 纜車 The cable car from the falls to Frosthollow (owner, 2026-09-30, picked from the new version: 「纜車（瀑布到霜谷）」),
 *  on the live layout: the valley station by the falls, a little way down the gate trail from its end (21.5 m from the
 *  Memory Gate, which keeps its forecourt to itself: 8 m nearer, the review of 2026-09-30 found the station crowding
 *  it), and the top station on Frosthollow's village green by the Frost bridge, in a straight line up the pass (its
 *  throat crossed high). Each station a 7 × 10 m box along the line, on ground no lot, home, lane, landmark, pier or the
 *  aqueduct touches (tests/cable-car.test.mjs); the line is up in the air over the pass trail and the lots under it,
 *  high enough for the tallest house (cableCar.ts). Not in WALLS or PADS: no lot, tree or terrain changes for it. */
export const CABLE_CAR={valley:{x:-70.57,z:-50.72},top:{x:-166,z:-140.5},station:{hw:3.5,hd:5}} as const;
/** 守印者石階 Guardian Steps (skin/canal.ts draws them): hill-street's last run down to the Guardian pier, from `from` m along
 *  it, two flights of about `rise` m risers with a landing at z ≈ 117. Each tread is level at the highest ground under it, or
 *  where the ground falls faster (below the landing) at most `steepest` under the tread above, so feet stand on the stone,
 *  the earth never shows through it and the flight keeps to the slope. Solid cheeks line it (GUARDIAN_CHEEKS). */
export const GUARDIAN_STEPS={from:10.2,landing:[16.6,17.6] as [number,number],rise:.3,steepest:.45,width:3.4};
let treads:{u0:number;u1:number;top:number}[]|null=null;
function stepFrame(){const pts=PATHS.find(p=>p.id==='hill-street')!.points,a=pts[pts.length-2],b=pts[pts.length-1],len=Math.hypot(b.x-a.x,b.z-a.z);return {a,len,ux:(b.x-a.x)/len,uz:(b.z-a.z)/len};}
/** The Guardian Steps' treads top-down: u0..u1 along hill-street's last run from its second-last point, and their tops. */
export function guardianTreads(){if(treads)return treads;
  const {a,len,ux,uz}=stepFrame(),S=GUARDIAN_STEPS,at=(u:number,v=0)=>landHeight(a.x+ux*u-uz*v,a.z+uz*u+ux*v);
  const high=(u0:number,u1:number)=>{let top=-Infinity;for(let i=0;i<=6;i++)for(const v of [-S.width/2,0,S.width/2])top=Math.max(top,at(u0+(u1-u0)*i/6,v));return top;};
  const flight=(u0:number,u1:number,from:number)=>{const n=Math.max(1,Math.ceil((from-at(u1))/S.rise));let top=from;
    return Array.from({length:n},(_,i)=>{const t0=u0+(u1-u0)*i/n,t1=u0+(u1-u0)*(i+1)/n;top=Math.max(high(t0,t1),top-S.steepest);return {u0:t0,u1:t1,top};});};
  // Level treads down each flight from the ground at its top: on the highest earth under each, at most `steepest` a step.
  const upper=flight(S.from,S.landing[0],at(S.from)+S.rise),landing={u0:S.landing[0],u1:S.landing[1],top:high(S.landing[0],S.landing[1])};
  return treads=[...upper,landing,...flight(S.landing[1],len-.2,landing.top)];}
export function stepsDeck(x:number,z:number):number|null{const {a,ux,uz}=stepFrame(),S=GUARDIAN_STEPS,u=(x-a.x)*ux+(z-a.z)*uz,v=(x-a.x)*uz-(z-a.z)*ux;
  if(Math.abs(v)>S.width/2||u<S.from)return null;for(const t of guardianTreads())if(u>=t.u0&&u<t.u1)return t.top;return null;}
/** 燼火升降台 Ember Lift: the tower on the lift bay by the falls pool that raises boats to the stream above the waterfall
 *  (its footprint; skin/plaza.ts EMBER_LIFT is an unrelated lamp constant). Blocks walking and lots. */
export const BOAT_LIFT:Wall={id:'boat-lift',x:-111,z:-58.6,hw:1.9,hd:3,rotation:0};
/** The lift's stone aqueduct on two piers, from the tower (a) into the stream 6.2 m above the waterfall lip (j): a trough
 *  of inner width 2.4 m, floor 9.0, water at STREAM_WATER. As a box (local +Z from a to j, outer half-width 1.6) for inBox. */
export const AQUEDUCT:Wall&{a:Point;j:Point;inner:number;floor:number}={id:'aqueduct',x:(AQ_A.x+AQ_J.x)/2,z:(AQ_A.z+AQ_J.z)/2,hw:1.6,hd:Math.hypot(AQ_J.x-AQ_A.x,AQ_J.z-AQ_A.z)/2,
  rotation:Math.atan2(AQ_J.x-AQ_A.x,AQ_J.z-AQ_A.z)*180/Math.PI,a:AQ_A,j:AQ_J,inner:2.4,floor:9};

// ─── The landmarks grown (owner, 2026-09-30) ─────────────────────────────────────────────────────────────────────
// 「重要的建築物需要大型一點，這樣子讓人才能一眼看到他不是住人的，而且有東西可以看的，可以玩的」: on the live layout, in
// proportion, no home moved (tests/home-fixture.test.mjs). Each grows as far as its target and the room round it allow,
// keeping 1.2 m clear of every home, lot, lane, water, pier, station and statue (tests/landmark-growth.test.mjs): the
// Oracle Tower 1.5x on its knoll; the Archive Hall 1.35x, 2.5 m east and 3.3 m up its slope from the east road, which
// ran under it and now passes between it and the Baixa; the launch dais 1.35x landward, its pier and boat stop where
// they were; the forge and the Memory Gate 1.35x taller on their plans (a chimney stack, spired towers); the hall of the
// Heart's roof crowned. The Guardian Hall is as b0d14f0 drew it (the homes' yards round it bind); Frosthollow's longhouse
// 1.12x (the lots round it bind). On 2026-10-01 the mill house beside the forge went (「拿掉」, owner: nobody lived
// there, and it read as a home by a public building) and the forge grew 1.3x onto the land it left (FORGE_SITE), its
// yard where the house stood (FORGE_YARD_PROPS).
/** How many times its live size each landmark is drawn: the whole building about its middle, a Tripo model uniformly
 *  (never stretched; skin/landmarks.ts createStickEmberBuilding); the launch's dais only, about its riverside rim. */
export const LANDMARK_SCALE={heart:1,oracle:1.5,forge:1.3,archive:1.35,launch:1.35,guardian:1,chronicle:1} as const;
/** How many times its live height the forge and the Memory Gate stand on their Tripo models: procedural parts over the
 *  model (skin/landmarks.ts FORGE_STACKS, GATE_SPIRES). The forge, stacks and all, is drawn LANDMARK_SCALE.forge times
 *  since 2026-10-01: 1.3 x 1.35 its live height. */
export const LANDMARK_RISE={forge:1.35,chronicle:1.35} as const;
/** Each landmark's top over its ground as the live site drew it (m; the shipped models fitted as the scene fits them,
 *  measured by tests/landmark-growth.test.mjs): what its growth is measured against. */
export const LIVE_TOP={heart:13.08,oracle:14.48,forge:8.79,archive:8.9,launch:3.95,chronicle:7.86} as const;
/** The Archive Hall's middle: 2.5 m east and 3.3 m up the slope from the live one (31, −12), so the east road passes it;
 *  and its facing (degrees), its door turned 17° north of the live one's (−78°): a travel's arrival camera (you before its
 *  door, the view behind you) looks at you and the hall down the east road's mouth between the square's east wings, as it
 *  did on the live site. Facing −78° from here the north-east wing stood between the camera and both (−66° to −55° see
 *  through; tests/arrival-names.test.mjs). */
export const ARCHIVE_SITE={x:33.5,z:-15.3,rotation:-61} as const;
/** 啟印台: the live dais's middle, its riverside rim `dais` m out; the pier, its instruments and its boat stop are laid out
 *  from here (launchDeck) and stay where they were. The grown dais's middle stands LAUNCH_SHIFT m landward of it. */
export const LAUNCH_ANCHOR={x:48,z:-2,dais:5.2} as const;
export const LAUNCH_SHIFT=LAUNCH_ANCHOR.dais*(LANDMARK_SCALE.launch-1);
/** The grown landmarks' walking and click radius (m, LANDMARKS; collision.ts adds LANDMARK_PAD), taken up to the next
 *  eighth of a metre: the Oracle Tower's plinth's foot (4.9 m at 1x; its live radius, 4, let you walk into its plinth),
 *  the Archive Hall's live radius times its scale (its body, 4.85 at 1x, inside; its lamp posts stand past it on its steps,
 *  as they did), the launch's too (4.5 at 1x, inside its dais's foot as it was: you step onto its pier from the bank), the
 *  forge's too (4.8 at 1x: its square hall's walls 4.1 m from its middle, its corners 6.05, as they were). */
export const GROWN_RADIUS={oracle:7.375,archive:6.5,launch:6.125,forge:6.25} as const;
/** 燼火工坊: the live forge's middle, from which its water wheel (skin/terrain.ts waterWheel) and the boats' pass-by at the
 *  wheel (boats.ts) are laid out, so both stay where they were; and the grown forge's middle and facing (2026-10-01): 2.1 m
 *  landward and 1.55 m up the bank from it, toward where the mill house stood, its door turned 5° nearer east than the
 *  live one's (75°), toward the square's west gate. Its river side is no nearer the water than it was (its walking circle
 *  1.43 m off, 0.78 live; its walls' foot 0.59 m, 0.35 live), its wall at the wheel's rim and 0.07 m clear of all the
 *  wheel sweeps as it turns (0.1 m nearer the river its paddles' corners grazed it: tests/landmark-growth.test.mjs).
 *  Facing 75° from here a travel's camera saw you through the square's west wing, as on the live site; turned, it looks
 *  through the square's west gate at you and the forge (tests/arrival-names.test.mjs). The gate trail, which ran from its
 *  back wall through the mill house, leaves from under that wall through the yard (FORGE_YARD_PROPS keep off it). */
export const FORGE_ANCHOR={x:-38,z:-15} as const,FORGE_SITE={x:-37.8,z:-17.6,rotation:80} as const;
/** The forge's square plinth, its walls' dark stone foot, in its own frame at 1x (m; its door toward +z): what stops you
 *  (collision.ts FORGE_SOLID). Its walking circle (GROWN_RADIUS) meets the middles of its walls but not its corners, 7.9
 *  m out at 1.3x: you walked 1.33 m in past them (0.96 m on the live site, the same flaw 1.3x: the review of 2026-10-01). */
export const FORGE_PLINTH={x0:-4.3,x1:4.11,hd:4.37} as const;
/** The grown forge's plinth as a box (a Wall, but not one of WALLS: the lots and the forest keep off the forge's pad). */
export const FORGE_SOLID:Wall=(()=>{const s=LANDMARK_SCALE.forge,r=FORGE_SITE.rotation*Math.PI/180,mid=(FORGE_PLINTH.x0+FORGE_PLINTH.x1)/2*s;
  return {id:'forge',x:FORGE_SITE.x+mid*Math.cos(r),z:FORGE_SITE.z-mid*Math.sin(r),hw:(FORGE_PLINTH.x1-FORGE_PLINTH.x0)/2*s,hd:FORGE_PLINTH.hd*s,rotation:FORGE_SITE.rotation};})();
/** Frosthollow's longhouse is drawn this many times its live size (skin/frost.ts), on its live site and facing: 1.12, as
 *  near the 1.15 asked as its walls allow with the lots round it (the ring of lots 3024–3036 on the valley floor: at 1.12
 *  lot 3024's yard, a large house's, is 0.07 m past where the walking rule stops you). */
export const LONGHOUSE_SCALE=1.12;
/** The longhouse's log walls as its Tripo model stands at 1x, in its own frame (door on +Z; tests/landmark-growth.test.mjs
 *  measures them): hw either side of its middle, from `back` m behind it to `front` m before it; the two posts under its
 *  back eaves stand to `posts` m behind it (the live collider held them). Its porch stands before them, open, as it was.
 *  Its ridge stood `ridge` m over its ground live (scene.ts floats Frosthollow's name over it). */
export const LONGHOUSE_WALLS={hw:6.78,back:2.89,posts:4.25,front:4.18,ridge:8.82} as const;
/** The hall of the Heart's crown (skin/landmarks.ts hallCrown): an open gilded lantern stage on its modelled roof lantern,
 *  whose top is LIVE_TOP.heart over the altar's floor, the lantern's middle `z` m from the altar (toward the back); the
 *  crown's top `top` m up. Open, so the heart's light column still rises through it. */
export const HALL_CROWN={z:-.73,top:15.3} as const;

/** Flat building pads. Rect pads use hw/hd, round pads use r. blend = metres to fade back into the slope. */
export type Pad={id:string;x:number;z:number;h:number;blend:number;r?:number;hw?:number;hd?:number};
export const PADS:Pad[]=[
  {id:'square',x:SQUARE.x,z:SQUARE.z,hw:SQUARE.hw,hd:SQUARE.hd,h:SQUARE.h,blend:5},
  {id:'forecourt',x:0,z:-22,hw:24,hd:4.5,h:SQUARE.h,blend:4},
  {id:'hall',x:HALL.x,z:HALL.z,hw:HALL.hw+1,hd:HALL.hd+1,h:HALL.h,blend:4},
  {id:'forge',x:-38,z:-15,r:6.5,h:.5,blend:5},
  {id:'archive',x:31,z:-12,r:7,h:.7,blend:6},
  {id:'launch',x:48,z:-2,r:6.5,h:.4,blend:5},
  {id:'oracle',x:24,z:-42,r:7.5,h:7.5,blend:10},
  {id:'lodge',x:6,z:31,r:6,h:.9,blend:6},
  {id:'gate',x:-90,z:-60,r:6,h:2.6,blend:7}
];
/** Frosthollow pads, applied on top of the high valley. */
export const PADS2:Pad[]=[
  {id:'longhouse',x:-178,z:-114,r:10,h:VILLAGE2.floor+.9,blend:6},
  {id:'mill',x:-160,z:-109,r:5,h:VILLAGE2.floor+.4,blend:4},
  {id:'green',x:-164,z:-142,r:7,h:VILLAGE2.floor+.3,blend:5}
];
/** The grown landmarks' level ground (2026-09-30), laid over the pads (valleyHeight): the Archive Hall's on its new site
 *  (cut into the slope behind it, clear of the row houses' ground) and the launch dais's landward; the Oracle Tower's
 *  plinth fits its knoll's (PADS oracle, 7.5 m round). The grown forge (2026-10-01) stands on its live pad's level (0.5 m)
 *  but for the corner by its door toward the Baixa, dug 0.8 m into the slope: its terrace levels that corner, 1.35 m
 *  toward it from the forge's middle, on a short bank that leaves the ground under the Baixa's block where it was and the
 *  west road's and the gate trail's within 5 cm (tests/landmark-growth.test.mjs; 8 m round the forge's middle on a 5 m
 *  bank it dropped the Baixa's corner a metre). The drawn ground, flat between its vertices 2 m apart (3.1 m on a phone),
 *  cannot turn so short a bank between the forge's corner and the block's, 3.4 m apart: it comes down 0.27 m along the
 *  last metre of the block's west side (its footing's foot 0.46 m over it there, 0.19 m live), and a bank short enough
 *  to leave that would leave the forge's corner in the drawn ground as deep again (0.43 m, 0.19 m now). Before its door
 *  the ground is level at its floor from its door ring to where a travel lands you (forge-front, 1.45 m farther out than
 *  the live one's landing, on the rise toward the square): standing 0.26 m over the ring's ground there, you and its tag
 *  came so near on screen that a phone's arrival showed only the tag's name line (the review of 2026-10-01).
 *  The terrain alone: lots, forest draws and keep-outs read PADS, the live layout's, so no lot, tree draw or home moves
 *  (tests/home-fixture.test.mjs, tests/layout-bake.test.mjs); a tree or rock that would stand on a terrace goes
 *  (skin/terrain.ts forest). */
export const TERRACES:Pad[]=[
  {id:'forge',x:FORGE_SITE.x+1,z:FORGE_SITE.z-.9,r:6.6,h:.5,blend:2.3},
  {id:'forge-front',x:FORGE_SITE.x+Math.sin(FORGE_SITE.rotation*Math.PI/180)*(GROWN_RADIUS.forge+2.4),z:FORGE_SITE.z+Math.cos(FORGE_SITE.rotation*Math.PI/180)*(GROWN_RADIUS.forge+2.4),r:1.3,h:.5,blend:1.6},
  {id:'launch',x:LAUNCH_ANCHOR.x,z:LAUNCH_ANCHOR.z-LAUNCH_SHIFT,r:7.6,h:.4,blend:5},
  {id:'archive',x:ARCHIVE_SITE.x,z:ARCHIVE_SITE.z,r:7.8,h:.7,blend:4}   // last: its level top over the dais's fall-off
];
function smooth(a:number,b:number,x:number){const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);}
function padDistance(p:Pad,x:number,z:number){
  if(p.r!==undefined)return Math.max(0,Math.hypot(x-p.x,z-p.z)-p.r);
  const qx=Math.max(0,Math.abs(x-p.x)-p.hw!),qz=Math.max(0,Math.abs(z-p.z)-p.hd!);return Math.hypot(qx,qz);
}
function ripple(x:number,z:number){return Math.sin(x*.05+Math.sin(z*.031)*2)*Math.cos(z*.043+Math.sin(x*.021))*.6+Math.sin(x*.13+z*.11)*.2;}
/** Low-frequency noise (±1, 250–600 m features) that frays the outskirts' biome borders. */
export function biomeNoise(x:number,z:number){return Math.sin(x*.011+Math.sin(z*.007)*1.7)*Math.cos(z*.009+Math.sin(x*.006)*1.3)*.6+Math.sin(x*.023-z*.017+1.3)*.4;}
/** 0..1: mountain range at this bearing from Emberford's centre (clockwise from north): the W–N–NNE crescent around
 *  Frosthollow and behind the hall. Everywhere else the rim is meadow downs and sand flats. */
export function rangeWeight(x:number,z:number){const b=Math.atan2(x,-z);
  return smooth(.25,.6,Math.cos(b+.61)+.18*Math.sin(b*3+1.1)+.1*Math.sin(b*5+2.3)+.38*biomeNoise(x,z));}
/** 0..1: sand and dry flats, two lobes (SE by the river mouth at 130°, SW under the spires at 227°), off the ranges
 *  (m = rangeWeight; 0 gives the lobes alone). */
export function dryWeight(x:number,z:number,m=rangeWeight(x,z)){const b=Math.atan2(x,-z),n=Math.sin(x*.017+Math.sin(z*.012)*1.9+4.1)*Math.cos(z*.014+Math.sin(x*.009)*1.6)*.6+Math.sin(x*.031+z*.026+.7)*.4;
  return smooth(.5,.8,.62*Math.max(Math.cos(b-2.27),Math.cos(b-3.97))+.5*n)*(1-m);}
export const WATER_BED=-2.3;
/** Terrain height: valley slopes from the river, hills to the north, snow mountains at the rim, flat pads, carved bed, bridge deck. */
/** Emberford's valley on its own (no high valley, pass or bed carving): slopes, ridge, knoll, rim, pads. */
function valleyHeight(x:number,z:number,river:{d:number;w:number}){
  const {d,w}=river,R=Math.hypot(x,z);
  let h=smooth(w+2,w+60,d)*12+ripple(x,z)*1.8*smooth(w+3,w+28,d);
  h+=smooth(-18,-75,z)*9*smooth(w+6,w+30,d);                                   // northern ridge behind the hall
  h+=Math.exp(-((x-24)**2+(z+42)**2)/300)*5;                                    // oracle knoll
  if(R>118){const m=rangeWeight(x,z);h+=smooth(118,172,R)*m*(34+ripple(x*.4,z*.4)*10)+smooth(128,200,R)*(1-m)*(6+ripple(x*.33+17,z*.33-9)*4);   // ranges W–N–NNE, downs elsewhere
    // Ridged relief on the ranges: none at the square's edge (its heights are the outskirts' seam) nor along the lower pass.
    if(R>150&&m>0){const e=1-smooth(.8,.97,Math.max(Math.abs(x),Math.abs(z))/TERRAIN_HALF),q=inBoxOf(LOWER_PASS,x,z)?streamQuery(x,z):null;
      if(e>0)h+=(ridged(x,z)*46-16)*m*smooth(150,195,R)*e*(q?1-(1-smooth(18,30,q.d))*(1-smooth(90,110,q.fromEnd)):1);}}
  for(const p of PADS){const t=1-smooth(0,p.blend,padDistance(p,x,z));h+=(p.h-h)*t;}
  for(const p of TERRACES){const d=padDistance(p,x,z);if(d<p.blend){const t=1-smooth(0,p.blend,d);h+=(p.h-h)*t;}}
  return h;
}
/** Where the stream's last 110 m run, plus 30 m: the ranges' relief holds still there (valleyHeight, highland). */
const LOWER_PASS=STREAM_PATH.filter(p=>STREAM_LENGTH-p.s<=112).reduce((b,p)=>({x0:Math.min(b.x0,p.x-31),x1:Math.max(b.x1,p.x+31),z0:Math.min(b.z0,p.z-31),z1:Math.max(b.z1,p.z+31)}),{x0:Infinity,x1:-Infinity,z0:Infinity,z1:-Infinity});
function inBoxOf(b:{x0:number;x1:number;z0:number;z1:number},x:number,z:number){return x>=b.x0&&x<=b.x1&&z>=b.z0&&z<=b.z1;}
/** Pass trail's lower part: a ramp from the Memory Gate up to the high valley (heights set at module load). */
const RAMP_POINTS=[{x:-84,z:-60},{x:-86,z:-70},{x:-96,z:-82},{x:-110,z:-90}];
const RAMP_LENGTHS=RAMP_POINTS.slice(1).map((b,i)=>Math.hypot(b.x-RAMP_POINTS[i].x,b.z-RAMP_POINTS[i].z));
const RAMP_TOTAL=RAMP_LENGTHS.reduce((a,b)=>a+b,0);
const RAMP_START_H=valleyHeight(RAMP_POINTS[0].x,RAMP_POINTS[0].z,riverQuery(RAMP_POINTS[0].x,RAMP_POINTS[0].z));
function rampQuery(x:number,z:number){
  if(x<-125||x>-70||z<-105||z>-45)return {w:0,h:0};
  let best=Infinity,along=0,acc=0;
  for(let i=0;i<RAMP_POINTS.length-1;i++){const a=RAMP_POINTS[i],b=RAMP_POINTS[i+1],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l2)),dd=Math.hypot(x-a.x-dx*t,z-a.z-dz*t);if(dd<best){best=dd;along=acc+t*RAMP_LENGTHS[i];}acc+=RAMP_LENGTHS[i];}
  const k=along/RAMP_TOTAL;return {w:1-smooth(2.6,7,best),h:RAMP_START_H+(VILLAGE2.floor-RAMP_START_H)*smooth(0,1,k)};
}
/** Frosthollow's ridge line at bearing b (radians clockwise from north, about VILLAGE2): crest radius r (m from the
 *  valley's centre), crest height h (m) and the outer shoulder's width wo; n (±1) is the bearing noise behind h and wo.
 *  Peaks and cols 32–84 m high at radius 77–103 m, so no two bearings read as one crater wall; the wall leaves the
 *  floor at `foot` (58–69 m) and climbs concave (bend > 1) or bulging (bend < 1), so its foot is no circle either. */
export function rimAt(b:number){
  const n=.5*Math.sin(3*b+1.3)+.3*Math.sin(5*b+.4)+.2*Math.sin(8*b+2.1)+.1*Math.sin(13*b+.7);
  const f=.5+.3*Math.sin(4*b+2.6)+.2*Math.sin(7*b+.3);   // 0..1: where the foot of the wall leaves the floor and how it bends
  return {r:90+8*Math.sin(2*b+.9)+5*Math.sin(5*b+2.2),h:58+26*n,wo:26+10*n,n,foot:VILLAGE2.rIn+11*f,bend:.7+.7*f};
}
/** rimAt tabled every 360/1024° (linear between entries), so highland pays no sines for it at each vertex. */
const RIM_N=1024,RIM_TAB=Array.from({length:RIM_N+1},(_,i)=>rimAt(i/RIM_N*Math.PI*2));
function rimLookup(b:number){const f=(b/(Math.PI*2)+1)%1*RIM_N,i=Math.floor(f),t=f-i,p=RIM_TAB[i],q=RIM_TAB[i+1];
  return {r:p.r+(q.r-p.r)*t,h:p.h+(q.h-p.h)*t,wo:p.wo+(q.wo-p.wo)*t,foot:p.foot+(q.foot-p.foot)*t,bend:p.bend+(q.bend-p.bend)*t};}
/** Smooth max: max(a, b) rounded over k metres, so a ridge joins the relief under it without a crease. */
function smax(a:number,b:number,k:number){const t=Math.max(0,k-Math.abs(a-b))/k;return Math.max(a,b)+t*t*k*.25;}
/** Value noise (0..1) on a unit lattice of hashed corners, smoothstepped between them: no period, unlike sines. The
 *  corners come from a 64 × 64 table per octave k (it wraps every 64 cells, 2–5 km: past the whole world). */
const LATTICE=[7,8].map(k=>Float64Array.from({length:4096},(_,n)=>hash(n&63,n>>6,k)));
function valueNoise(x:number,z:number,k:number){const i=Math.floor(x),j=Math.floor(z),u=x-i,v=z-j,su=u*u*(3-2*u),sv=v*v*(3-2*v),t=LATTICE[k-1];
  const i0=i&63,i1=(i+1)&63,j0=(j&63)<<6,j1=((j+1)&63)<<6,a=t[i0|j0],b=t[i1|j0],c=t[i0|j1],d=t[i1|j1];return a+(b-a)*su+(c-a)*sv+(a-b-c+d)*su*sv;}
/** Ridged relief (0..0.6, mean 0.23 like the sine families it replaced) in world space: crests where warped value noise
 *  crosses its middle, ~80 m apart, a finer 34 m octave riding on them; a soft |t| rounds every crest. Nothing repeats,
 *  so no garland of equal scallops along the ranges. */
export function ridged(x:number,z:number){
  const wx=x+22*Math.sin(z*.017+1.3),wz=z+22*Math.sin(x*.015+.4),t1=3*(valueNoise(wx/80,wz/80,1)-.5),t2=3*(valueNoise(wz/34+7.3,wx/34-3.1,2)-.5);
  const r1=Math.max(0,1.245-Math.sqrt(t1*t1+.06)),r2=Math.max(0,1.245-Math.sqrt(t2*t2+.06));
  return r1*r1*(.62+.38*r2*r2)*.6;
}
/** Three summits off Frosthollow's ridge (N, NE, W): top (x, z), height over the ranges h (m), base radius r (m). */
export const FROST_PEAKS=[{x:-196,z:-240,h:44,r:46},{x:-104,z:-222,h:38,r:40},{x:-280,z:-128,h:30,r:36}];
/** The summits' height at (x, z): cones with arêtes (the base radius swings with bearing), the highest wins. */
function peaks(x:number,z:number){let h=0;
  for(const p of FROST_PEAKS){const dx=x-p.x,dz=z-p.z,d=Math.hypot(dx,dz)/p.r;if(d>=1.34)continue;const a=Math.atan2(dx,dz);
    const arete=1+.22*Math.abs(Math.sin(a*1.5+p.x))+.12*Math.sin(a*5+p.z);h=Math.max(h,p.h*Math.pow(1-Math.min(1,d*arete*.85),1.5));}
  return h;}
/** How far Frosthollow's ground reaches from VILLAGE2 (the summits' and the ridge's shoulders stay inside it). */
const FROST_REACH=175;
const FAR={d:Infinity,w:0,s:0,side:0,fromEnd:Infinity};
/** Frosthollow's valley, ridge line, summits, stream bed and pads, over Emberford's heights. Near Emberford (R < 132)
 *  and along the lower pass the old crater rim's heights stay: its Gaussian tail pins the falls lip, the Memory Gate,
 *  the Ember Lift and its aqueduct and the pass trail; the ridge takes over by R 158 (and 18–30 m off the stream). */
function highland(x:number,z:number,h:number){
  const dx=x-VILLAGE2.x,dz=z-VILLAGE2.z,d2=Math.hypot(dx,dz);if(d2>FROST_REACH)return h;
  // Past d2 128 the stream (its end 97 m out, the tarn 81 m) lies over 30 m away: no bed, no pass to hold, no floor.
  const s=d2<=128?frostWaterQuery(x,z):FAR,R=Math.hypot(x,z),m2=(1-smooth(10,22,s.d))*smooth(0,6,s.fromEnd);
  const w=R<132?0:smooth(132,158,R)*(1-(1-smooth(18,30,s.d))*(1-smooth(90,110,s.fromEnd)));
  let o=h,mo=0,M=h,mn=0;
  if(w<1&&d2<=VILLAGE2.rIn+70){mo=Math.max(1-smooth(VILLAGE2.rIn,VILLAGE2.rOut,d2),m2);o=h+Math.exp(-(((d2-(VILLAGE2.rIn+18))/14)**2))*24*(1-mo);}   // old crater rim
  if(w>0){const ph=peaks(x,z),base=ph>0?h+ph+ripple(x*.3,z*.3)*4*Math.min(1,ph/10):h;M=base;mn=m2;
    if(d2<145){const rim=rimLookup(Math.atan2(dx,-dz)),out=1-smooth(rim.r,rim.r+rim.wo,d2),ridge=(rim.h*.75+10+ripple(x*.35+5,z*.35-3)*4)*out+base*(1-out);   // past 145 m: summits alone
      M=base+(smax(base,ridge,12)-base)*(1-smooth(118,145,d2));mn=Math.max(1-Math.pow(smooth(rim.foot,rim.r,d2),rim.bend),m2);}}   // floor → rounded crest → shoulder, never over Emberford
  if(mo>0||mn>0){
    let hp=VILLAGE2.floor+smooth(6,50,s.d)*5+ripple(x,z)*.8*smooth(4,20,s.d);
    for(const p of PADS2){const t=1-smooth(0,p.blend,padDistance(p,x,z));hp+=(p.h-hp)*t;}
    const bed=VILLAGE2.floor-1.4,bay=s.side>0?frostBayQuery(x,z):{d:Infinity,w:0};hp=bed+(hp-bed)*Math.min(smooth(s.w-1,s.w+1.4,s.d),smooth(bay.w-1,bay.w+1.4,bay.d));   // the stream's bed, and 霜谷渡口's bay (its bank only: the far bank keeps the stream's)
    o=o*(1-mo)+hp*mo;M=M*(1-mn)+hp*mn;
  }
  return o+(M-o)*w;
}
/** 0 in Emberford, 1 on Frosthollow's valley floor and along its stream (for terrain colour); s: frostWaterQuery
 *  here, when the caller has it. */
export function highlandWeight(x:number,z:number,s?:{d:number;fromEnd:number}){
  const d2=Math.hypot(x-VILLAGE2.x,z-VILLAGE2.z);if(d2>VILLAGE2.rIn+70)return 0;
  s??=frostWaterQuery(x,z);return Math.max(1-smooth(VILLAGE2.rIn,VILLAGE2.rOut,d2),(1-smooth(10,22,s.d))*smooth(0,6,s.fromEnd));
}
/** The earth alone (the terrain mesh): no bridge or pier decks, so the water runs on under their arches. Where the
 *  canal is the nearer water its valley settles the land toward CHANNEL_BANK, then the nearer water carves its bed. */
export function landHeight(x:number,z:number,river=riverQuery(x,z),c=channelQuery(x,z)):number{
  let h=highland(x,z,valleyHeight(x,z,river));
  const canal=c.d-c.w<river.d-river.w;
  if(canal&&c.d<c.w+44)h=Math.min(h,CHANNEL_BANK+(h-CHANNEL_BANK)*channelValley(x,z,onIsland(x,z)));
  const ramp=rampQuery(x,z);if(ramp.w>0)h=h*(1-ramp.w)+ramp.h*ramp.w;
  const {d,w}=canal?c:river,bank=smooth(w-1.4,w+1.6,d);h=WATER_BED+(h-WATER_BED)*bank;
  return Math.min(h,pitFloor(x,z));
}
/** Where feet stand: the earth, raised to a bridge or pier deck over it. */
export function terrainHeight(x:number,z:number,river=riverQuery(x,z)):number{
  const h=landHeight(x,z,river),deck=bridgeDeck(x,z)??bridge2Deck(x,z)??pierDeck(x,z)??stepsDeck(x,z);return deck===null?h:Math.max(h,deck);
}
export const WORLD_RADIUS=160;
/** Half size of the terrain square: holds both villages, the pass and all 5000 seats. */
export const TERRAIN_HALF=320;

/** Walkable lanes painted onto the terrain. hw = half width in metres. */
export const PATHS:{id:string;hw:number;kind:'stone'|'dirt'|'trail';points:Point[]}[]=[
  // Out of the square's west gate to the forge's door (its last run turned to the grown forge's door on 2026-10-01: left
  // as it was, it ran into its corner; the lamp along that run with it).
  {id:'west-road',hw:1.8,kind:'stone',points:[{x:-17,z:-15.5},{x:-25,z:-15},{x:-31.2,z:-16.45}]},
  {id:'gate-trail',hw:1.1,kind:'trail',points:[{x:-43,z:-17},{x:-54,z:-26},{x:-66,z:-38},{x:-78,z:-50},{x:-86,z:-57}]},
  // Through the square's east gap and along the Baixa's north front to the launch dais, south of the Archive Hall (it ran
  // under the hall's plinth to 2026-09-30).
  {id:'east-road',hw:1.8,kind:'stone',points:[{x:18,z:-7},{x:23.5,z:-7.3},{x:27,z:-5.6},{x:32.8,z:-5.2},{x:37.5,z:-4.7},{x:40.9,z:-4.5}]},
  {id:'oracle-path',hw:1.2,kind:'dirt',points:[{x:0,z:-23},{x:4,z:-25.5},{x:14,z:-26},{x:19,z:-31},{x:21,z:-35}]},
  {id:'south-road',hw:1.8,kind:'stone',points:[{x:6.5,z:23},{x:6,z:27}]},
  {id:'hill-street',hw:1.6,kind:'dirt',points:[{x:6,z:35},{x:7,z:52},{x:9,z:74},{x:12,z:100},{x:15,z:126.5}]},
  {id:'pass-trail',hw:1.3,kind:'trail',points:[{x:-86,z:-57},...RAMP_POINTS,{x:-128,z:-104},{x:-146,z:-118},{x:-160,z:-127},{x:-167.6,z:-134.6}]},
  {id:'frost-lane',hw:1.5,kind:'dirt',points:[{x:-176.4,z:-125.3},{x:-177.2,z:-120},{x:-178,z:-116}]}
];

// Agents' homes. A fixed candidate sequence is generated once (independent of population); slot n takes the
// n-th valid candidate, so saved slots never move. Three phases, each ending after three empty terraces:
//   A  Emberford hillside: terraces around the Guardian lodge, opening toward the river   (≈ slots 0–860)
//   B  Frosthollow: full rings around the longhouse on the high valley floor
//   C  Emberford rim: phase A's terraces continue outward with the slope limit relaxed    (up to 5000 seats)
export const HOME_TERRACES={cx:6,cz:31,firstRadius:11,step:5.6,spacing:3.8,baseSpread:72,spreadGrowth:3,maxSpread:180,clearing:.3};
export type HomePose={x:number;z:number;rotation:number};
/** Deterministic 0..1 hash of a position; the same candidate always gets the same jitter. */
export function hash(x:number,z:number,k=0){const v=Math.sin(x*127.1+z*311.7+k*74.7)*43758.5453;return v-Math.floor(v);}
/** Smooth 0..1 value noise on an 18 m grid, used to open clearings in the agents' hillside. */
export function clearing(x:number,z:number){
  const g=18,gx=Math.floor(x/g),gz=Math.floor(z/g),fx=x/g-gx,fz=z/g-gz,u=fx*fx*(3-2*fx),v=fz*fz*(3-2*fz);
  const c=(i:number,j:number)=>hash(gx+i,gz+j,9);
  return (c(0,0)*(1-u)+c(1,0)*u)*(1-v)+(c(0,1)*(1-u)+c(1,1)*u)*v;
}
/** Frosthollow's terraces: rings around the longhouse, every direction (the stream and buildings are skipped). */
export const FROST_TERRACES={cx:-178,cz:-114,firstRadius:15,step:5.6,spacing:3.8};
const homeCache:HomePose[]=[];let terrace=0,frostTerrace=0,phase:'A'|'B'|'C'='A',terraceCandidates:HomePose[]=[];
function nearPath(x:number,z:number,margin:number){
  for(const p of PATHS)for(let i=0;i<p.points.length-1;i++){const a=p.points[i],b=p.points[i+1],dx=b.x-a.x,dz=b.z-a.z,l2=dx*dx+dz*dz;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/l2));if(Math.hypot(x-a.x-dx*t,z-a.z-dz*t)<p.hw+margin)return true;}
  return false;
}
function nearBridge(b:BridgeSpec,x:number,z:number,margin:number){
  const dx=b.x2-b.x1,dz=b.z2-b.z1,l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-b.x1)*dx+(z-b.z1)*dz)/l2));
  return Math.hypot(x-b.x1-dx*t,z-b.z1-dz*t)<b.width/2+margin;
}
function slopeOk(x:number,z:number){
  const e=1.2,sx=terrainHeight(x+e,z)-terrainHeight(x-e,z),sz=terrainHeight(x,z+e)-terrainHeight(x,z-e);
  return Math.hypot(sx,sz)/(2*e)<.55;
}
function validHome(x:number,z:number,mode:'hillside'|'frost'|'relaxed'){
  const r=riverQuery(x,z),c=channelQuery(x,z);if(r.d<r.w+4.5||c.d<c.w+4.5)return false;
  // South/west bank first; the far north bank opens only well outside the village core.
  if(r.side<0&&Math.hypot(x,z)<75)return false;
  // South of the river the Agents' hillside is Guardian Isle: phase A stays inside the canal loop.
  if(mode==='hillside'&&r.side>0&&!onIsland(x,z))return false;
  const st=frostWaterQuery(x,z);if(st.d<st.w+3.5)return false;
  if(rampQuery(x,z).w>.05)return false;
  for(const p of PADS)if(padDistance(p,x,z)<3)return false;
  for(const p of PADS2)if(padDistance(p,x,z)<2)return false;
  if(nearPath(x,z,2.2)||nearBridge(BRIDGE,x,z,3)||nearBridge(BRIDGE2,x,z,3))return false;
  if(WALLS.some(w=>inBox(w,x,z,2.6)))return false;
  if(mode==='relaxed')return true;
  if(mode==='frost')return Math.hypot(x-VILLAGE2.x,z-VILLAGE2.z)<VILLAGE2.rIn-4&&slopeOk(x,z);
  if(Math.hypot(x,z)>WORLD_RADIUS-12||terrainHeight(x,z,r)>=19)return false;   // in the valley, off the downs
  // Phase A stays in Emberford; Frosthollow's valley is phase B's.
  if(Math.hypot(x-VILLAGE2.x,z-VILLAGE2.z)<VILLAGE2.rOut+10)return false;
  return slopeOk(x,z);
}
/** One ring of candidates: jittered positions (tangent ±0.3 m, radial ±0.4 m, door ±11°) minus clearings. */
/** With a `tape`, which positions pass is read from it (baked, see RingTape) while it lasts; a live ring records them. */
function ring(cx:number,cz:number,r:number,spread:number,spacing:number,offset:number,mode:'hillside'|'frost'|'relaxed',tape?:RingTape){
  const n=Math.max(2,Math.floor(2*spread*r/spacing)),out:HomePose[]=[],baked=tape?.read(n)??null,record=baked?null:tape?.record??null;
  for(let i=0;i<n;i++){
    if(baked&&!baked(i))continue;
    const a=-spread+(i+.5)*(2*spread/n)+offset*(2*spread/n)*.5,x0=cx+Math.sin(a)*r,z0=cz+Math.cos(a)*r;
    // Clearings: a smooth noise field leaves gardens and groves between neighbourhoods instead of unbroken rings.
    if(!baked&&clearing(x0,z0)<HOME_TERRACES.clearing){record?.push(0);continue;}
    const t=(hash(x0,z0,1)-.5)*.6,rr=(hash(x0,z0,2)-.5)*.8,x=x0+Math.cos(a)*t+Math.sin(a)*rr,z=z0-Math.sin(a)*t+Math.cos(a)*rr;
    const rotation=Math.atan2(cx-x,cz-z)+(hash(x0,z0,3)-.5)*.4,dx=x+Math.sin(rotation)*3.4,dz=z+Math.cos(rotation)*3.4;
    // The doorstep must be open ground too: never facing into a village building or the water.
    if(baked||validHome(x,z,mode)&&!WALLS.some(w=>inBox(w,dx,dz,.6))&&!inWater(dx,dz)){out.push({x,z,rotation});record?.push(1);}
    else record?.push(0);
  }
  return out;
}
/** Which ring positions pass (validHome, the doorstep and the clearings), one bit per position in the order the rings
 *  are made: a sequence reads them from a tape baked at build time (scripts/bake-layout.mjs, src/world/layoutBaked.ts)
 *  instead of running those checks, and makes its rings live once the tape runs out. A tape without bits records
 *  what live rings decide (the bake). Only whole rings are read: a ring longer than what is left is made live. */
export class RingTape {
  private pos=0;private bits:Uint8Array;private count:number;readonly record:number[]|null;
  constructor(bits:Uint8Array=new Uint8Array(0),count=0,record:number[]|null=null){this.bits=bits;this.count=count;this.record=record;}
  read(n:number):((i:number)=>boolean)|null {
    if(this.pos+n>this.count){this.pos=this.count;return null;}
    const at=this.pos,bits=this.bits;this.pos+=n;return i=>(bits[(at+i)>>3]>>((at+i)&7)&1)===1;
  }
}
/** Bits as the tapes and tables store them: little-endian within each byte, base64. */
export function packBits(bits:readonly number[]):string {const b=new Uint8Array(Math.ceil(bits.length/8));bits.forEach((v,i)=>{if(v)b[i>>3]|=1<<(i&7);});let t="";for(const x of b)t+=String.fromCharCode(x);return btoa(t);}
export function unpackBytes(b64:string):Uint8Array {return Uint8Array.from(atob(b64),c=>c.charCodeAt(0));}
let emptyTerraces=0;
function nextTerrace(){
  let out:HomePose[];
  if(phase==='B'){
    const F=FROST_TERRACES,r=F.firstRadius+frostTerrace*F.step;out=ring(F.cx,F.cz,r,Math.PI,F.spacing,frostTerrace%2,'frost');frostTerrace++;
  }else{
    const T=HOME_TERRACES,r=T.firstRadius+terrace*T.step,spread=Math.min(T.maxSpread,T.baseSpread+terrace*T.spreadGrowth)*Math.PI/180;
    out=ring(T.cx,T.cz,r,spread,T.spacing,terrace%2,phase==='A'?'hillside':'relaxed');terrace++;
  }
  // Three empty terraces end a phase; phase C never ends (guaranteed growth for every seat).
  emptyTerraces=out.length?0:emptyTerraces+1;
  if(emptyTerraces>=3&&phase!=='C'){phase=phase==='A'?'B':'C';emptyTerraces=0;}
  return out;
}
export function homePose(slot:number):HomePose{
  while(homeCache.length<=slot){if(!terraceCandidates.length)terraceCandidates=nextTerrace();const c=terraceCandidates.shift();if(c)homeCache.push(c);}
  return homeCache[slot];
}
export function lotPosition(slot:number):Point{const p=homePose(slot);return {x:p.x,z:p.z};}

// ─── Household lots (one wallet, one house, five sizes; see households.ts) ─────────────────────────────────
// A finer candidate sequence over the same terraces and phases as homePose (rings 2.8 m apart, candidates 1.9 m
// apart along each ring). Houses of different sizes take the first candidate where their whole footprint fits,
// so the sequence only proposes positions; households.ts decides which ones are used.
export const LOT_TERRACES={step:2.8,spacing:1.9};
export type LotCandidate=HomePose&{mode:'hillside'|'frost'|'relaxed'};
/** The lot candidates in order: a fresh sequence reading which ring positions pass from `tape` (scripts/bake-layout.mjs
 *  records a live one). lotCandidate below is the page's, on the baked tape. */
export function lotSequence(tape?:RingTape):(i:number)=>LotCandidate {
  const cache:LotCandidate[]=[];let lotRing=0,lotFrostRing=0,lotPhase:'A'|'B'|'C'='A',lotEmpty=0,queue:LotCandidate[]=[];
  const next=():LotCandidate[]=>{
    let out:LotCandidate[];
    if(lotPhase==='B'){const F=FROST_TERRACES,r=F.firstRadius+lotFrostRing*LOT_TERRACES.step;out=ring(F.cx,F.cz,r,Math.PI,LOT_TERRACES.spacing,lotFrostRing%2,'frost',tape).map(p=>({...p,mode:'frost'}));lotFrostRing++;}
    else{const T=HOME_TERRACES,k=lotRing*LOT_TERRACES.step/T.step,r=T.firstRadius+lotRing*LOT_TERRACES.step,spread=Math.min(T.maxSpread,T.baseSpread+k*T.spreadGrowth)*Math.PI/180,mode=lotPhase==='A'?'hillside':'relaxed';
      out=ring(T.cx,T.cz,r,spread,LOT_TERRACES.spacing,lotRing%2,mode,tape).map(p=>({...p,mode}));lotRing++;}
    // Six empty rings end a phase (rings are half as far apart as homePose's terraces); phase C never ends.
    lotEmpty=out.length?0:lotEmpty+1;
    if(lotEmpty>=6&&lotPhase!=='C'){lotPhase=lotPhase==='A'?'B':'C';lotEmpty=0;}
    return out;
  };
  return i=>{while(cache.length<=i){if(!queue.length)queue=next();const c=queue.shift();if(c)cache.push(c);}return cache[i];};
}
const LOTS=lotSequence(new RingTape(unpackBytes(LAYOUT_BAKED.lotRings.bits),LAYOUT_BAKED.lotRings.count));
/** The i-th lot candidate (stable: asking for more never changes earlier ones). */
export function lotCandidate(i:number):LotCandidate{return LOTS(i);}
/** Local (lx, lz) in a house's frame (door on +Z) → world. */
export function lotPoint(p:HomePose,lx:number,lz:number):Point{
  const c=Math.cos(p.rotation),s=Math.sin(p.rotation);return {x:p.x+lx*c+lz*s,z:p.z-lx*s+lz*c};
}
export const LOT_MAX_FALL=3.2;
/** Alfama-style terracing: the floor sits level with the uphill corner (less 0.3 m) and a stone podium runs down
 *  to 0.4 m below the downhill corner, so no house floats or sinks on the hillside. */
export function lotBase(p:HomePose,hw:number,hd:number){
  const hs=[[-1,-1],[1,-1],[-1,1],[1,1],[0,0]].map(([u,v])=>{const q=lotPoint(p,u*hw,v*hd);return terrainHeight(q.x,q.z);});
  const floor=Math.max(...hs)-.3;return {floor,podium:floor-Math.min(...hs)+.4};
}
/** Whether a house with half extents hw × hd can stand at p: the whole footprint is dry, off the lanes, clear of
 *  village buildings and pads, not too steep, and the ground in front of the door is open. */
export function lotFits(p:LotCandidate,hw:number,hd:number,yard=2){
  if(!validHome(p.x,p.z,p.mode))return false;
  const hs:number[]=[];
  for(const [u,v] of [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1],[0,1],[-1,0],[1,0]]){
    const q=lotPoint(p,u*(hw+.4),v*(hd+.4)),r=riverQuery(q.x,q.z),c=channelQuery(q.x,q.z),st=frostWaterQuery(q.x,q.z);
    if(r.d<r.w+2||c.d<c.w+2||st.d<st.w+1.5||rampQuery(q.x,q.z).w>.05)return false;
    if(PIERS.some(k=>nearBridge(k,q.x,q.z,1))||inBox(BOAT_LIFT,q.x,q.z,1))return false;
    if(PADS.some(pad=>padDistance(pad,q.x,q.z)<1.2)||PADS2.some(pad=>padDistance(pad,q.x,q.z)<1))return false;
    if(nearPath(q.x,q.z,.5)||nearBridge(BRIDGE,q.x,q.z,1)||nearBridge(BRIDGE2,q.x,q.z,1)||WALLS.some(w=>inBox(w,q.x,q.z,1)))return false;
    if(p.mode==='hillside'&&Math.hypot(q.x,q.z)>WORLD_RADIUS-12)return false;
    if(p.mode==='frost'&&Math.hypot(q.x-VILLAGE2.x,q.z-VILLAGE2.z)>VILLAGE2.rIn-3)return false;
    hs.push(terrainHeight(q.x,q.z,r));
  }
  // Sloping plots get a stone terrace (see lotBase); past 3.2 m of fall it would tower over the lane.
  if(Math.max(...hs)-Math.min(...hs)>LOT_MAX_FALL)return false;
  // The front yard (where the household's agents gather) must be dry, off the buildings and off the water.
  for(const u of [-1,0,1]){const door=lotPoint(p,u*hw,hd+yard);if(inWater(door.x,door.z)||WALLS.some(w=>inBox(w,door.x,door.z,.6)))return false;}
  return true;
}
// Featured seats keep dedicated pedestals on the quay, flanking the Cais steps.
export const FEATURED_HOMES:Record<string,Point>={'361':{x:-6,z:2},'921':{x:12,z:2}};
/** Where an agent lives: the two featured agents keep pedestals on the square (facing the river), everyone else a terrace home. */
export function agentHome(id:string,slot:number):HomePose{const f=FEATURED_HOMES[id];return f?{x:f.x,z:f.z,rotation:0}:homePose(slot);}
/** Point in front of a door (doors face local +Z); used for figures and for travel so nobody lands inside a wall. */
export function doorstep(p:HomePose,distance:number):Point{return {x:p.x+Math.sin(p.rotation)*distance,z:p.z+Math.cos(p.rotation)*distance};}
/** Walkable radius before the snow rim; grows only if homes ever reach past it. */
export const WALK_RADIUS=118;
/** How far from Emberford's centre the player may walk: the valley, or 10 m past the farthest home once homes climb the rim. */
export function walkRadius(homes:Iterable<Point>){let r=WALK_RADIUS;for(const p of homes)r=Math.max(r,Math.hypot(p.x,p.z)+10);return r;}
/** Walkable world: Emberford within `radius`, Guardian Isle, the pass trail, and Frosthollow's valley. */
export function inWorld(x:number,z:number,radius:number){
  if(Math.hypot(x,z)<radius||Math.hypot(x-VILLAGE2.x,z-VILLAGE2.z)<VILLAGE2.rIn+14||onIsland(x,z))return true;
  if(rampQuery(x,z).w>.5)return true;
  const s=streamPathQuery(x,z);return s.d<16&&s.fromEnd>4;
}
/** Which village's house style a home uses: timber in and around Frosthollow, Lisbon plaster elsewhere. */
export function homeStyle(p:Point):'lisbon'|'timber'{return Math.hypot(p.x-VILLAGE2.x,p.z-VILLAGE2.z)<VILLAGE2.rOut+10?'timber':'lisbon';}
/** House collider half extents in the house's own frame (matches Codex's 1.35 × 1.2). */
export const HOME_COLLIDER={hw:1.35,hd:1.2};

/** 守印廳 the Guardian Hall (v002, owner 2026-09-30), the Guardian Quarter's building on the live layout: its plan's reach
 *  (m, from its centre to the farthest of its outline) and its height at the stand-in's scale 1 (skin/landmarks.ts
 *  GUARDIAN_HALL, the octagon 6 m across that fitInto fits the Tripo hall to; tests/guardian-hall.test.mjs measures both
 *  from the shipped model), and how many times that it is drawn. 1.55: a 10.2 m hall, 9.3 m across, its dome just over
 *  the roofs of the homes round it (the nearest, within 20 m on the slope above it, 8.8–10 m over its ground; the
 *  tallest house model 7.5 m) and its plan only a little wider than the first hall's (4.76 m round against 4.29; that
 *  one stood 4.6 m tall). It stands inside the lodge's 6 m terrace (PADS 'lodge'), so no terrace, lot or home moves for
 *  it, and its walking rule (radius + collision.ts LANDMARK_PAD) stays off the nearest home's front yard (5.21 m out):
 *  more would reach into it. A few homes may move for a landmark (owner, 2026-09-30), but neither beside it can: every lot
 *  within 40 m of the lodge is taken, and the nearest free one for either extra-large house (the two largest households,
 *  0xabe0cd… and 0xbe11d8…) is 81 m off, on the isle's east shore. So 1.55 stays, its plan 1.11 times the first hall's
 *  (1.2 was asked): below 1.4 it would stand on less ground than the first hall. */
export const GUARDIAN_HALL_PLAN={reach:3.07,top:6.58,scale:1.55} as const;
export const LANDMARKS = [
  {id:'heart',name:'心晶殿',en:'Hall of the Heart',x:0,z:-36,radius:5,rotation:0,description:'燼渡的主殿，心晶安放在殿中的祭壇上，連結整座守印者之城。觀看網路脈動，從這裡開始探索。',descriptionEn:'Emberford’s great hall. The heart crystal rests on the altar inside and connects the city of guardians. Watch the network pulse and begin your exploration here.'},
  {id:'oracle',name:'共識之塔',en:'Oracle Tower',x:24,z:-42,radius:GROWN_RADIUS.oracle,rotation:-35,description:'立在北方高丘上的塔。守印者共同查證問題；只有公開資料標示 attested 的結果，才亮起共識印記。',descriptionEn:'A tower on the northern knoll. Guardians verify questions together; the consensus seal lights up when public records include an attested result.'},
  {id:'forge',name:'燼火工坊',en:'Ember Forge',x:FORGE_SITE.x,z:FORGE_SITE.z,radius:GROWN_RADIUS.forge,rotation:FORGE_SITE.rotation,description:'上游河岸的水車工坊，Jobs 任務區的主工坊。有工作在跑時水車轉動、爐火升起。閱讀近期任務，並在 IMD Explorer 查看完整狀態。',descriptionEn:'The water-wheel workshop upstream, heart of the Jobs district. The wheel turns and the furnace burns while work is running. Read recent jobs, then visit IMD Explorer for the full list.'},
  {id:'archive',name:'記憶檔案館',en:'Archive Hall',x:ARCHIVE_SITE.x,z:ARCHIVE_SITE.z,radius:GROWN_RADIUS.archive,rotation:ARCHIVE_SITE.rotation,description:'Published 成果區的典藏館，展示近期公開作品。下游的啟印碼頭提供合約發布紀錄；官網可依合約、網站、研究與媒體瀏覽。',descriptionEn:'The hall of the Published district, displaying recent public works. The launch pier downstream holds contract launch records. Explorer offers contracts, sites, research and media.'},
  {id:'launch',name:'啟印台',en:'Launch Platform',x:LAUNCH_ANCHOR.x,z:LAUNCH_ANCHOR.z-LAUNCH_SHIFT,radius:GROWN_RADIUS.launch,rotation:180,description:'Published 成果區在下游河岸的啟印碼頭，與記憶檔案館相連。閱讀發布紀錄與所屬鏈。',descriptionEn:'The Published district’s launch pier on the downstream bank, connected to Archive Hall. Browse launch records and their chains.'},
  {id:'guardian',name:'守印者聚落',en:'Guardian Quarter',x:6,z:31,radius:GUARDIAN_HALL_PLAN.reach*GUARDIAN_HALL_PLAN.scale,rotation:180,description:'過橋後的 Agents 守印者區名冊入口。每位取得的 Agent 在山坡上都有自己的住處，搜尋席位、Agent ID、錢包或執行環境，前往相見。',descriptionEn:'Across the bridge, the registry entrance to the Agents district. Every known agent has a home on the hillside. Search by seat, Agent ID, wallet or runtime and travel to meet them.'},
  {id:'chronicle',name:'記憶之門',en:'Memory Gate',x:-90,z:-60,radius:3.4,rotation:45,description:'河流源頭的封印之門，留給未來故事與探索。此門尚未開啟。',descriptionEn:'A sealed gate at the river’s source, reserved for future stories and exploration. It has yet to open.'}
] as const;
export type LandmarkId = typeof LANDMARKS[number]['id'];

// Explorer categories organize the city. World names remain independent art assets.
export const DISTRICTS=[
  {id:'jobs',label:'Jobs',name:'任務區',direction:'West',directionZh:'西',x:-34,z:-12,color:'#f4a151',entry:'forge',members:['forge'],url:'https://explorer.imd.fun/',categories:['All','Running','Incomplete','Completed'],summary:'Work in progress',summaryZh:'任務與製作中的工作'},
  {id:'oracle',label:'Oracle',name:'共識區',direction:'North',directionZh:'北',x:22,z:-38,color:'#8fc8e7',entry:'oracle',members:['oracle'],url:'https://explorer.imd.fun/oracle',categories:['All','Answering','Failed','Signed'],summary:'Questions and signed answers',summaryZh:'提問、回答與簽署結果'},
  {id:'published',label:'Published',name:'成果區',direction:'East',directionZh:'東',x:38,z:-8,color:'#ddc57e',entry:'archive',members:['archive','launch'],url:'https://explorer.imd.fun/published',categories:['Contracts','Sites','Research','Media'],summary:'Contracts, sites, research, media',summaryZh:'合約、網站、研究與媒體'},
  {id:'agents',label:'Agents',name:'守印者區',direction:'South',directionZh:'南',x:6,z:40,color:'#8ae0ca',entry:'guardian',members:['guardian'],url:'https://explorer.imd.fun/agents',categories:[],summary:'Registry and growing neighborhoods',summaryZh:'名冊與持續擴展的住處'}
] as const satisfies readonly {id:string;label:string;name:string;direction:string;directionZh:string;x:number;z:number;color:string;entry:LandmarkId;members:readonly LandmarkId[];url:string;categories:readonly string[];summary:string;summaryZh:string}[];
export type DistrictId=typeof DISTRICTS[number]['id'];
export function districtForLandmark(id:LandmarkId){return DISTRICTS.find(d=>(d.members as readonly LandmarkId[]).includes(id));}
// Where each district's signpost stands (at the road leaving the square), and the landmark its road leads to.
export const DISTRICT_SIGNS:Record<DistrictId,Point&{to:LandmarkId}>={jobs:{x:-16,z:-16.5,to:'forge'},oracle:{x:5,z:-16.5,to:'oracle'},published:{x:16,z:-9.5,to:'archive'},agents:{x:9,z:3,to:'guardian'}};

/** Solid village walls the player cannot walk through (oriented boxes; rotation in degrees). */
export type Wall={id:string;x:number;z:number;hw:number;hd:number;rotation:number};
export const WALLS:Wall[]=[
  // Hall of the Heart (portico side open to the south).
  {id:'hall-back',x:0,z:-42.6,hw:10,hd:.6,rotation:0},{id:'hall-west',x:-9.4,z:-35,hw:.6,hd:8,rotation:0},{id:'hall-east',x:9.4,z:-35,hw:.6,hd:8,rotation:0},
  // Terreiro do Paço wings: north (split by the triumphal arch), west (gap at the NW corner for the west road),
  // east (gap for the east road). The south side is the quay.
  {id:'wing-north-w',x:-13.1,z:-20.75,hw:9.9,hd:2.25,rotation:0},{id:'wing-north-e',x:13.1,z:-20.75,hw:9.9,hd:2.25,rotation:0},
  {id:'wing-west',x:-20.75,z:-6,hw:2.25,hd:7,rotation:0},
  {id:'wing-east-n',x:20.75,z:-14.75,hw:2.25,hd:3.75,rotation:0},{id:'wing-east-s',x:20.75,z:-.75,hw:2.25,hd:3.75,rotation:0},
  // Baixa blocks outside the square (the mill house by the forge went on 2026-10-01: its ground the forge's yard,
  // FORGE_YARD_PROPS).
  {id:'baixa-nw',x:-27,z:-28,hw:3.5,hd:3,rotation:0},{id:'baixa-e',x:29,z:0,hw:3.5,hd:3,rotation:0},
  // 霜谷 Frosthollow: longhouse facing the bridge, the watermill on the stream, timber houses around the green.
  {id:'v2-longhouse',x:-178,z:-114,hw:8,hd:4,rotation:168},
  {id:'v2-mill',x:-160,z:-109,hw:3,hd:2.5,rotation:-43},
  {id:'v2-house-1',x:-194,z:-120,hw:2.8,hd:2.3,rotation:120},{id:'v2-house-2',x:-190,z:-100,hw:2.8,hd:2.3,rotation:150},
  {id:'v2-house-3',x:-164,z:-96,hw:2.8,hd:2.3,rotation:200},{id:'v2-house-4',x:-156,z:-146,hw:2.8,hd:2.3,rotation:320},
  {id:'v2-house-5',x:-170,z:-154,hw:2.8,hd:2.3,rotation:0},{id:'v2-house-6',x:-150,z:-132,hw:2.8,hd:2.3,rotation:290},
  {id:'v2-house-7',x:-184,z:-156,hw:2.8,hd:2.3,rotation:20},
  // The square's equestrian ensemble (keeper on horseback on a stepped plinth, skin/plaza.ts) at the compass centre;
  // the box is the lowest step exactly (4.0 × 5.4 m), the four district keepers stand inside it.
  {id:'statue',x:0,z:-8,hw:2,hd:2.7,rotation:0}
].map(w=>w.id.startsWith('v2-house')?{...w,rotation:Math.round(Math.atan2(VILLAGE2.x-w.x,VILLAGE2.z-w.z)*180/Math.PI)}:w);
/** The forge's yard behind its back wall, where the mill house stood (skin/terrain.ts forgeYard draws them; collision.ts
 *  walks round them): against the wall a lean-to woodshed stacked full of logs under its roof, falling away from the wall
 *  (a post-and-beam frame over a few logs, seen edge-on from the trail beside a bare tree, read as a gallows: the review of
 *  2026-10-01), crates and a charcoal heap by its north end, a smith's anvil on its stump before it and a handcart of ore;
 *  a quench trough on the river side of the gate trail, by the water; a bare ash tree, as round the forge (not solid, as
 *  the forest's are not), off the trail's view of the shed. Each box on its ground (m, degrees; its local z along its
 *  length; the woodshed's +x toward the wall, its high side), h its height; drawn 1.2 times the size they were first drawn,
 *  by a forge 1.3 times its own. They keep off the gate trail, which runs through the yard (a walker's reach and more),
 *  the forge's body and the water, and stand within 4 m of the forge's plinth (tests/landmark-growth.test.mjs). The lots
 *  and the forest keep off the yard as they kept off the house: the forge's pad and the gate trail keep them off its
 *  ground (tests/home-fixture.test.mjs, tests/layout-bake.test.mjs: the lot rules and the forest read WALLS as the live
 *  site did, but for the house). */
export const FORGE_YARD_PROPS:(Wall&{kind:'woodpile'|'crates'|'cart'|'anvil'|'trough'|'coal'|'ash';h:number})[]=[
  {id:'forge-woodpile',kind:'woodpile',x:-44.03,z:-22.19,hw:.9,hd:1.55,rotation:-10,h:2.7},
  {id:'forge-crates',kind:'crates',x:-43.45,z:-24.63,hw:.72,hd:.72,rotation:-10,h:1.6},
  {id:'forge-coal',kind:'coal',x:-43.32,z:-26.49,hw:.72,hd:.72,rotation:-10,h:.85},
  {id:'forge-anvil',kind:'anvil',x:-45.78,z:-22.35,hw:.42,hd:.54,rotation:80,h:.96},
  {id:'forge-cart',kind:'cart',x:-47.09,z:-25.27,hw:.84,hd:1.32,rotation:-129,h:1.6},
  {id:'forge-trough',kind:'trough',x:-46.15,z:-16.78,hw:.42,hd:.84,rotation:-129,h:.72},
  {id:'forge-ash',kind:'ash',x:-46.31,z:-27.37,hw:.2,hd:.2,rotation:0,h:4.2}
];
/** The row houses round the square (skin/terrain.ts villageRows builds a pombaline block on each of these boxes): its
 *  floors (the north wings stay low so the hall rises behind the arch) and its eaves over the ground (the cornice). */
export const ROW_HOUSE=/^(wing|baixa)/;
export const rowFloors=(id:string)=>id.startsWith('wing-north')?2:3;
export const rowEaves=(floors:number)=>4.2+3*(floors-1);
/** Storey heights of a Pombaline row (m): the footing's top, the ground floor, each upper floor. */
export const ROW_STOREY={plinth:.4,ground:3.4,upper:3} as const;
export const rowBays=(w:number)=>Math.max(2,Math.round(w/3.2));
/** Top of a row's walls (its cornice) over its ground. */
export const rowTop=(floors:number)=>ROW_STOREY.plinth+ROW_STOREY.ground+ROW_STOREY.upper*(floors-1);
/** A row house's frame: the front (local +Z) faces the square along the box axis closest to it; w along the front. */
export function rowFrame(wall:Wall){
  const toSquare=Math.atan2(SQUARE.x-wall.x,SQUARE.z-wall.z),r=wall.rotation*Math.PI/180,k=Math.round((toSquare-r)/(Math.PI/2)),front=r+k*Math.PI/2,across=k%2!==0;
  return {front,w:(across?wall.hd:wall.hw)*2,d:(across?wall.hw:wall.hd)*2,floors:rowFloors(wall.id),arcade:wall.id.startsWith('wing')};
}
/** How much higher a landmark's top stands than the live one's (m): its growth (LANDMARK_SCALE, LANDMARK_RISE) on its
 *  LIVE_TOP, the hall's crown (HALL_CROWN); the launch's dais stays under its name and its beacon mast. Its click box, its
 *  name and its far name rise with it. */
export function topGain(id:LandmarkId){
  return id==='heart'?HALL_CROWN.top-LIVE_TOP.heart:id==='forge'||id==='chronicle'?LIVE_TOP[id]*(LANDMARK_RISE[id]*LANDMARK_SCALE[id]-1):id==='oracle'||id==='archive'?LIVE_TOP[id]*(LANDMARK_SCALE[id]-1):0;}
/** How high a landmark's top stands over its ground, for its click box (scene.ts): the Guardian Hall its own; the hall of the
 *  Heart's is its altar's, inside. */
export const landmarkTop=(id:LandmarkId)=>id==='guardian'?GUARDIAN_HALL_PLAN.top*GUARDIAN_HALL_PLAN.scale:id==='heart'?8:(id==='oracle'?14:8)+topGain(id);
/** How much higher a landmark's name floats than the live one's: as much as its top rose, but the forge's and the Memory
 *  Gate's stay where they were, over their bodies (as tall as they were) between their new stacks and spires: the forge's
 *  as high again put a first visit's opening out at its 60 m limit on a desktop (tests/first-visit.test.mjs). The forge's
 *  body grew 1.3x on 2026-10-01 (its ridge 7.9 m): its name, 8.4 m up, lies on its ridge between its stacks, and a
 *  travel's arrival shows it below the HUD's title as the live one; as high again as its body (10.9 m) it left the top of
 *  the screen there. */
const nameGain=(id:LandmarkId)=>id==='forge'||id==='chronicle'?0:topGain(id);
/** The Guardian Hall's and the Archive Hall's names over their bodies (m over the ground): the Guardian Hall's across the
 *  foot of its dome, the Archive Hall's across its facade. A travel's arrival (scene.ts focusBuilding: you 3 m before the
 *  door, the play view behind you) showed both on the live site; over their grown tops they floated off the top of the
 *  screen there. Here each shows below the HUD's title and clear of its cards on a desktop and on a phone held either way
 *  (tests/arrival-names.test.mjs): on a phone held upright in the 25 px between the title's pills and the weather and
 *  network cards, which 6.05-6.15 m and 5.45-5.55 m reach. That holds on a canvas about 830-858 px tall only (390 x 844):
 *  a name stands a fixed share of the canvas's height down the screen, the title a fixed number of px; on a shorter one
 *  (375 x 667, or a phone browser with its toolbars shown) the names lie on the pills; the live site's lay on the title
 *  at every height. The panorama's names stay over their tops. */
export const ARRIVAL_NAME={guardian:6.1,archive:5.5} as const;
/** How high a landmark's name label floats over its ground (scene.ts buildTags): the Guardian Hall's and the Archive
 *  Hall's ARRIVAL_NAME; the others as high over their tops as the live ones were. */
export const labelRise=(id:LandmarkId)=>id==='guardian'||id==='archive'?ARRIVAL_NAME[id]:(id==='oracle'?17.6:id==='heart'?15.2:8.4)+nameGain(id);
/** How high its name floats in the panorama (scene.ts buildFarLabels), over its top as the live one did: the Guardian
 *  Hall's 4.1 m over its dome, where b0d14f0 put it. */
export const farLabelRise=(id:LandmarkId)=>id==='guardian'?landmarkTop('guardian')+4.1:(id==='oracle'?19:id==='heart'?17:10)+nameGain(id);
// ─── Plaza decor (Cluj mix, 2026-09-27): solids that block walking but never shape lots, forest or terrain ──
// These live outside WALLS on purpose: validHome, lotFits and forest() read WALLS, and forest() shares one rng()
// across all trees, so a new wall anywhere would reshuffle most of the forest and could move lot candidates.
/** 燼鐘塔 Ember Belfry on the west hill behind the square: the Oracle Tower's mirror across the arch–hall axis
 *  (like Carmo on Lisbon's west hill). Door (local +Z) faces the square's statue. Not a PAD: the terrace follows
 *  lotBase's terracing rule instead of flattening the hill. */
export const BELL_SPIRE:Wall={id:'bell-spire',x:-24,z:-42,hw:3.5,hd:3.5,rotation:35.2};
/** Shallow pools in the square's south band, flanking the spawn with an 8.6 m gate between them (outer curb). */
export const SQUARE_POOLS:Wall[]=[{id:'pool-w',x:-6.6,z:-2,hw:2.3,hd:1,rotation:0},{id:'pool-e',x:6.6,z:-2,hw:2.3,hd:1,rotation:0}];
/** Round-canopy trees: an east allée on the east wings' pier lines (z −14.75 | −4.5, −0.75, 3.0), so every arcade
 *  door stays visible between the trunks, with the east-road mouth and the Published sign open between the groups.
 *  The north facade, the arch axis, the west corner (Pepe, the control wall) and the river frontage stay open. */
export const SQUARE_TREES:Point[]=[{x:15.6,z:-14.75},{x:15.6,z:-4.5},{x:15.6,z:-.75},{x:15.6,z:3}];
/** The Guardian Steps' two basalt cheeks (skin/canal.ts), 0.3 m thick beside the treads for the flights' whole length:
 *  the steps are walked from the top or the pier, not stepped onto from the slope beside them. */
export const GUARDIAN_CHEEKS:Wall[]=(()=>{const {a,len,ux,uz}=stepFrame(),S=GUARDIAN_STEPS,u=(S.from+len-.2)/2,v=S.width/2+.15;
  return [1,-1].map(k=>({id:'guardian-cheek-'+(k>0?'e':'w'),x:a.x+ux*u+uz*v*k,z:a.z+uz*u-ux*v*k,hw:.15,hd:(len-.2-S.from)/2,rotation:Math.atan2(ux,uz)*180/Math.PI}));})();
/** Everything above that blocks the player (collision.ts); tree trunks are 0.6 m boxes. */
export const DECOR_SOLIDS:Wall[]=[BOAT_LIFT,...GUARDIAN_CHEEKS,...SQUARE_POOLS,...SQUARE_TREES.map((p,i)=>({id:'square-tree-'+i,x:p.x,z:p.z,hw:.3,hd:.3,rotation:0})),BELL_SPIRE];
/** Frosthollow's longhouse as walked and mapped since it grew (LONGHOUSE_SCALE): its log walls as drawn and the posts under
 *  its back eaves (LONGHOUSE_WALLS). WALLS keeps the live collider (16 x 8 m round its middle), which the lots and the
 *  forest read, so none of them moves; collision.ts and WorldMap.tsx use this one. */
export const LONGHOUSE_SOLID:Wall=(()=>{const w=WALLS.find(w=>w.id==='v2-longhouse')!,s=LONGHOUSE_SCALE,r=w.rotation*Math.PI/180,W=LONGHOUSE_WALLS,off=(W.front-W.posts)/2*s;
  return {id:w.id,x:w.x+Math.sin(r)*off,z:w.z+Math.cos(r)*off,hw:W.hw*s,hd:(W.front+W.posts)/2*s,rotation:w.rotation};})();
/** Minimap travel target for Frosthollow (not an Explorer landmark): before the longhouse's porch, facing its door (7 m
 *  from its middle live: the live collider's front and 3 m, drawn LONGHOUSE_SCALE times since it grew). */
export const FROST_TRAVEL=(()=>{const w=WALLS.find(w=>w.id==='v2-longhouse')!,r=w.rotation*Math.PI/180,d=(w.hd+3)*LONGHOUSE_SCALE;
  return {x:w.x+Math.sin(r)*d,z:w.z+Math.cos(r)*d,yaw:r};})();
export function inBox(b:{x:number;z:number;hw:number;hd:number;rotation:number},x:number,z:number,pad=0){
  const r=-b.rotation*Math.PI/180,dx=x-b.x,dz=z-b.z,lx=dx*Math.cos(r)+dz*Math.sin(r),lz=-dx*Math.sin(r)+dz*Math.cos(r);
  return Math.abs(lx)<b.hw+pad&&Math.abs(lz)<b.hd+pad;
}
/** Water blocks walking except on the bridge and pier decks (the Ember River, the canal and its basins, Frosthollow's stream). */
export function inWater(x:number,z:number){
  const r=waterQuery(x,z);if(r.d<r.w-.2&&bridgeDeck(x,z)===null&&pierDeck(x,z)===null)return true;
  const s=frostWaterQuery(x,z),b=frostBayQuery(x,z);return (s.d<s.w-.2&&s.fromEnd>1||b.d<b.w-.2)&&bridge2Deck(x,z)===null&&pierDeck(x,z)===null;
}
/** At the bank end of each new stop's pier: a street lamp on one side and a stop sign (a boat on a green board, facing up
 *  the bank) on the other, 0.5 m off the deck's edges, up the bank until both stand 0.5 m clear of the water (as the
 *  reviewed new-layout stops, 2026-09-30, a little nearer the deck: Isle East's lots come to 2 m of it). Solids (collision.ts); skin/canal.ts draws both, its lantern lit with the town's lamps. */
/** A stage along the bank has them at its two ends instead, 0.75 m past each on its landward half (the lamp at its x1
 *  end, the sign at x2), the sign facing up the bank. The Frost Tarn's landing has them too since 2026-10-01 (owner: make
 *  it easy to find), as 霜谷渡口's two. */
/** Since 2026-10-02 a boat shelter (SHELTERS) stands in their place at every stop but 霜谷渡口's north-east landing. */
export type StopPost={stop:string;kind:'lamp'|'sign';x:number;z:number;facing:number};
const dryOf=(q:Point)=>{const w=waterQuery(q.x,q.z),s=frostWaterQuery(q.x,q.z),b=frostBayQuery(q.x,q.z);return Math.min(w.d-w.w,s.d-s.w,b.d-b.w)>=.5;};
/** 候船亭 The boat shelter (owner, 2026-10-01: concept 1A, the red-tiled one; Tripo, stickember-3d/world/props/boat-shelter/v001;
 *  ASSET_SLOTS 'boat-shelter'): origin at its slab's middle, the slab 2.60 × 2.11 m, 3.12 m to the ridge, its open front +Z (the
 *  street), its back board toward the pier; box: the whole model's plan (eaves and the lantern at its front right) and slab:
 *  the slab's half-sizes, in the model's metres, drawn `scale` times. A 1.9 m figure would need 1.25 times to pass under its
 *  front sign, so it is solid, its whole box (collision.ts). Its name boards (skin/shelters.ts): the cream face of the front
 *  sign and the back board's face toward the pier, centre and size in the model's metres (game_report.json). */
export const SHELTER={scale:1.1,box:{x0:-1.447,x1:1.557,z0:-1.13,z1:1.378},slab:{hw:1.3,hd:1.054},
  front:{x:.08,y:1.9,z:.949,w:1.06,h:.2},back:{x:-.006,y:1.941,z:-.859,w:1.08,h:.28}} as const;
/** Where each stop's shelter stands, found on the live layout by the rules the stops' tests keep (tests/boat-stops.test.mjs:
 *  lots, homes, lanes, trees, rocks, landmarks, the boats, and the arrival views seeing you and the boat past it): for a
 *  stage across the bank, `a` m up the bank from its root (less than 0: out over the water), on its `side` (+1 the
 *  shelter's own +X), its near edge `off` m beside the deck, its front up the bank; for a stage along the bank, `a` m along
 *  it from its x1 end and `o` m landward of its axis (less than 0: toward the water), its front landward (face +1) or
 *  toward the stage (−1). On the bank its slab stands on a stone footing. Where every free metre of the bank by the pier
 *  is a lot a household could take next (島東, 島西北, 湖西) it stands on piles in the water beside the pier (water), at
 *  the deck's height, 0.6 m and more off the boats, and no lot changes; so the forge's, whose strip of bank between the
 *  gate trail, the yard and the river has no room for it (all 30 m up and down the bank), in line with its stage past its
 *  upstream end, 0.8 m from it, half over the bank's edge (owner, 2026-10-02: 「工坊A」, not 5 m off on the river), the
 *  boats 0.39 m off it as they come alongside, its eaves 0.22 m off the trail. 霜谷渡口 has one, by its bay landing; its
 *  north-east landing across the stream keeps its lamp and sign. */
const SHELTER_SITES:({stop:string;water?:true;a:number}&({side:1|-1;off:number}|{o:number;face:1|-1}))[]=[
  {stop:'isle-east',water:true,a:-1.8,side:1,off:.5},{stop:'isle-west',a:.8,side:-1,off:.5},{stop:'forge-landing',water:true,a:-2.45,o:.025,face:1},
  {stop:'isle-northwest',water:true,a:-1.9,side:-1,off:1.7},{stop:'mere-west',water:true,a:-2,side:-1,off:.5},
  {stop:'frosthollow-landing',a:-1.5,o:3,face:1},{stop:'tarn-landing',a:.8,side:-1,off:.5}];
/** A shelter as placed: its origin (x, z), turned by yaw (local +Z = (sin yaw, cos yaw)), its slab's foot at y (the deck's
 *  height in the water; on the bank 8 cm under the highest ground below the slab, its footing below). */
export type Shelter={stop:string;x:number;z:number;yaw:number;y:number;water:boolean};
/** Local (lx, lz) of a shelter, in the model's metres, on the ground plane. */
export function shelterPoint(s:{x:number;z:number;yaw:number},lx:number,lz:number):Point{const k=SHELTER.scale,c=Math.cos(s.yaw),n=Math.sin(s.yaw);return {x:s.x+(lx*c+lz*n)*k,z:s.z+(-lx*n+lz*c)*k};}
/** The ground under a shelter's slab, every 0.25 m: its lowest and highest. */
export function shelterGround(s:{x:number;z:number;yaw:number}){let lo=Infinity,hi=-Infinity;const L=SHELTER.slab,st=.25/SHELTER.scale;
  for(let u=-L.hw;u<=L.hw+1e-9;u+=st)for(let v=-L.hd;v<=L.hd+1e-9;v+=st){const q=shelterPoint(s,u,v),h=landHeight(q.x,q.z);lo=Math.min(lo,h);hi=Math.max(hi,h);}
  return {lo,hi};}
export const SHELTERS:Shelter[]=SHELTER_SITES.map(site=>{
  const p=stopPier(site.stop)!,len=Math.hypot(p.x2-p.x1,p.z2-p.z1),u={x:(p.x2-p.x1)/len,z:(p.z2-p.z1)/len},S=SHELTER.scale,B=SHELTER.box;let x:number,z:number,yaw:number;
  if('o' in site){const k=-alongSide(p),n={x:-u.z*k,z:u.x*k};yaw=Math.atan2(site.face*n.x,site.face*n.z);x=p.x1+u.x*site.a+n.x*site.o;z=p.z1+u.z*site.a+n.z*site.o;}
  else{yaw=Math.atan2(-u.x,-u.z);const b=site.side>0?p.width/2+site.off-B.x0*S:-(p.width/2+site.off+B.x1*S);x=p.x1-u.x*site.a-u.z*b;z=p.z1-u.z*site.a+u.x*b;}
  const water=site.water===true;return {stop:site.stop,x,z,yaw,y:water?p.base:shelterGround({x,z,yaw}).hi-.08,water};});
/** How far p is from a shelter's box (0 inside it). */
export function shelterGap(s:Shelter,p:Point){const b=shelterBox(s),r=-b.rotation*Math.PI/180,dx=p.x-b.x,dz=p.z-b.z,lx=dx*Math.cos(r)+dz*Math.sin(r),lz=-dx*Math.sin(r)+dz*Math.cos(r);
  return Math.hypot(Math.max(0,Math.abs(lx)-b.hw),Math.max(0,Math.abs(lz)-b.hd));}
/** Standing within this of a stop's shelter is standing at its stop, as on its deck (boarding.ts boardZone, frostRide.ts
 *  frostZone): E boards there (owner, 2026-10-02: the shelter and the deck both offer the boat). */
export const SHELTER_REACH=1.6;
/** A shelter's solid: its whole box (collision.ts), as a wall. */
export function shelterBox(s:Shelter):Wall{const B=SHELTER.box,S=SHELTER.scale,c=shelterPoint(s,(B.x0+B.x1)/2,(B.z0+B.z1)/2);
  return {id:'stop-shelter',x:c.x,z:c.z,hw:(B.x1-B.x0)/2*S,hd:(B.z1-B.z0)/2*S,rotation:s.yaw*180/Math.PI};}
export const STOP_POSTS:StopPost[]=[...STOP_PIERS,PIERS.find(p=>p.id==='tarn-landing')!].filter(p=>!SHELTER_SITES.some(s=>s.stop===p.id)).flatMap(p=>{
  const len=Math.hypot(p.x2-p.x1,p.z2-p.z1),u={x:(p.x2-p.x1)/len,z:(p.z2-p.z1)/len};
  if(p.along){const k=-alongSide(p),n={x:-u.z*k,z:u.x*k},facing=Math.atan2(n.x,n.z);   // n: toward the land
    const at=(a:number,o:number)=>({x:p.x1+u.x*a+n.x*o,z:p.z1+u.z*a+n.z*o});let o=.6;while(o<3&&!(dryOf(at(-.75,o))&&dryOf(at(len+.75,o))))o+=.1;
    return [{stop:p.id,kind:'lamp' as const,...at(-.75,o),facing},{stop:p.id,kind:'sign' as const,...at(len+.75,o),facing}];}
  const side=p.width/2+.5,facing=Math.atan2(-u.x,-u.z);
  const at=(d:number,k:number)=>({x:p.x1-u.x*d+u.z*side*k,z:p.z1-u.z*d-u.x*side*k});
  let d=.2;while(d<5&&!(dryOf(at(d,1))&&dryOf(at(d,-1))))d+=.2;
  // The tarn's sign goes on its lamp's side, 1.4 m further up the bank: on the other a pine's crown is half a metre off.
  return [{stop:p.id,kind:'lamp' as const,...at(d,1),facing},{stop:p.id,kind:'sign' as const,...p.id==='tarn-landing'?at(d+1.4,1):at(d,-1),facing}];});
