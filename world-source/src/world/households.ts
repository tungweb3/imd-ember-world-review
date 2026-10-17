import {compareIds,type Agent} from './model.ts';
import {lotCandidate,lotFits,lotPoint,homeStyle,unpackBytes,SPAWN,FEATURED_HOMES,type HomePose,type LotCandidate,type Point} from './layout.ts';

// One wallet, one house (user decision 2026-09-26). Only seats that are live IMD agents get a home; a wallet's
// house holds all of its agents and its size follows the current agent count. Every player computes the same
// result from public data: households are ranked (most agents first, then lowest token id) and placed greedily
// on the lot candidates, nearest the Guardian lodge first. The founding placement (founding-homes.json) is frozen
// so later changes do not reshuffle the hillside; only new or outgrown households look for a new lot.
/** 1 small, 2–3 small-medium, 4–6 medium, 7–9 large, 10+ extra large (owner rule, 2026-09-27): houseSize.ts, which the
 *  Worker imports without this module's layout. */
import {HOUSE_SIZES,houseSize,type HouseSize} from './houseSize.ts';
import type {HouseModelKey} from './skin/houses.ts';
import {LAYOUT_BAKED} from './layoutBaked.ts';
export {HOUSE_SIZES,houseSize,type HouseSize};
/** Collider half extents per size, in the house's own frame (door on +Z), measured from the Tripo house models
 *  (width × depth in metres: s 2.6×2.66, ms 3.4×2.8, m 4.5×4.26, l 5.9×5.38, xl 7.5×4.79; balconies may overhang). */
export const HOUSE_FOOTPRINT:Record<HouseSize,{hw:number;hd:number}>={s:{hw:1.35,hd:1.2},ms:{hw:1.75,hd:1.35},m:{hw:2.3,hd:2},l:{hw:3,hd:2.6},xl:{hw:3.8,hd:2.35}};
/** Front yard kept clear in front of each door, where the household's agents gather. */
export const HOUSE_YARD:Record<HouseSize,number>={s:1.6,ms:1.8,m:2.2,l:2.6,xl:3.2};
/** Clear ground kept between two lots (walkable alleys). */
export const HOUSE_GAP=1.1;
const rank=(s:HouseSize)=>HOUSE_SIZES.indexOf(s);

export type Household={owner:string;agents:string[];size:HouseSize};
/** Group live agents by owner wallet. Agents without an agent id or a known owner have no house. */
export function households(agents:readonly Agent[]):Household[]{
  const byOwner=new Map<string,string[]>();
  for(const a of agents){if(a.agentId===null||!a.owner)continue;const o=a.owner.toLowerCase();if(!byOwner.has(o))byOwner.set(o,[]);byOwner.get(o)!.push(a.tokenId);}
  return [...byOwner].map(([owner,ids])=>{ids.sort(compareIds);return {owner,agents:ids,size:houseSize(ids.length)};}).sort(byPriority);
}
/** Placement priority: more agents first, then the lowest token id. */
export function byPriority(a:Household,b:Household){return b.agents.length-a.agents.length||compareIds(a.agents[0],b.agents[0]);}

export type Home=HomePose&{owner:string;size:HouseSize;agents:string[]};
export type FoundingHome={owner:string;x:number;z:number;rotation:number;size:HouseSize};
type Rect={x:number;z:number;hw:number;hd:number;rotation:number};
const rect=(p:HomePose,s:HouseSize):Rect=>({x:p.x,z:p.z,rotation:p.rotation,...HOUSE_FOOTPRINT[s]});
/** The whole lot: the house plus its front yard. Lots, not houses, are kept HOUSE_GAP apart. */
export function lotRect(p:HomePose,s:HouseSize):Rect{const f=HOUSE_FOOTPRINT[s],y=HOUSE_YARD[s],c=lotPoint(p,0,y/2);return {x:c.x,z:c.z,rotation:p.rotation,hw:f.hw,hd:f.hd+y/2};}
/** Oriented rectangles overlap (separating axis test), with `gap` of clearance required between them. */
export function rectsOverlap(a:Rect,b:Rect,gap=0){
  const axes=[a.rotation,b.rotation].flatMap(r=>[[Math.cos(r),-Math.sin(r)],[Math.sin(r),Math.cos(r)]]);
  const half=(q:Rect,[ax,az]:number[])=>{const c=Math.cos(q.rotation),s=Math.sin(q.rotation);return q.hw*Math.abs(c*ax-s*az)+q.hd*Math.abs(s*ax+c*az);};
  for(const axis of axes){const d=Math.abs((b.x-a.x)*axis[0]+(b.z-a.z)*axis[1]);if(d>half(a,axis)+half(b,axis)+gap)return false;}
  return true;
}
/** Coarse spatial hash so overlap checks stay local. */
class Placed{
  private cells=new Map<string,Rect[]>();
  private keys(r:Rect){const e=Math.hypot(r.hw,r.hd)+HOUSE_GAP,out:string[]=[];for(let i=Math.floor((r.x-e)/8);i<=Math.floor((r.x+e)/8);i++)for(let j=Math.floor((r.z-e)/8);j<=Math.floor((r.z+e)/8);j++)out.push(i+','+j);return out;}
  add(r:Rect){for(const k of this.keys(r)){if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k)!.push(r);}}
  clear(r:Rect){for(const k of this.keys(r))for(const o of this.cells.get(k)??[])if(rectsOverlap(r,o,HOUSE_GAP))return false;return true;}
}
/** Whether a house of size `s` fits on lot candidate i: the rule (layout.ts lotFits on the candidate, with the size's
 *  footprint and yard). Deterministic, and about 0.1 ms a call: the first placement asks it thousands of times, which
 *  held the first read on a phone for about three seconds. */
export function candidateFits(i:number,s:HouseSize,candidate:(i:number)=>LotCandidate=lotCandidate){const f=HOUSE_FOOTPRINT[s];return lotFits(candidate(i),f.hw,f.hd,HOUSE_YARD[s]);}
/** candidateFits for the first LAYOUT_BAKED.lotFits.count candidates, worked out at build time (scripts/bake-layout.mjs):
 *  one byte per candidate, bit k for HOUSE_SIZES[k]. tests/layout-bake.test.mjs recomputes every bit with candidateFits,
 *  so a change to the lots, the terrain or the footprints fails there until the layout is baked again. */
const BAKED=LAYOUT_BAKED.lotFits.sizes===HOUSE_SIZES.join(',')?unpackBytes(LAYOUT_BAKED.lotFits.bits).subarray(0,LAYOUT_BAKED.lotFits.count):new Uint8Array(0);
const fitCache=new Map<string,boolean>();
function fits(i:number,s:HouseSize){if(i<BAKED.length)return (BAKED[i]>>rank(s)&1)===1;const k=i+s;let v=fitCache.get(k);if(v===undefined){v=candidateFits(i,s);fitCache.set(k,v);}return v;}
/** Hard stop for the candidate walk; phase C never ends, so this only guards against a bug. */
const MAX_CANDIDATES=60000;

/**
 * Where every household lives. Founding homes keep their spot (a household that shrank stays put; one that grew
 * stays if the bigger house still fits there). Everyone else takes the first free candidate that fits, in
 * priority order. Founding households that are gone leave flat ground.
 * `reserved` lots (vacated by a move, see vacatedLots) stay empty for everyone placed on the fly, so a move never
 * makes a newcomer or an outgrown household jump; until a shared registry records every assignment, placing on
 * the fly is only stable if the set of usable lots can only shrink.
 * `fit` answers whether a size fits on a candidate: the baked table (tests pass the rule itself, candidateFits).
 */
export function placeHouseholds(list:readonly Household[],founding:readonly FoundingHome[]=[],reserved:readonly FoundingHome[]=[],fit:(i:number,s:HouseSize)=>boolean=fits):Home[]{
  const placed=new Placed(),homes:Home[]=[],waiting:Household[]=[],foundingBy=new Map(founding.map(f=>[f.owner.toLowerCase(),f]));
  // Pass 1: founding households that did not grow keep their lot unconditionally (a smaller house fits its own lot).
  // Pass 1b: grown ones stay only if the bigger lot still fits beside every kept neighbour; they never push anyone.
  const grown:Household[]=[];
  for(const h of [...list].sort(byPriority)){
    const f=foundingBy.get(h.owner);if(!f){waiting.push(h);continue;}
    if(rank(h.size)>rank(f.size)){grown.push(h);continue;}
    const pose={x:f.x,z:f.z,rotation:f.rotation};placed.add(lotRect(pose,f.size));homes.push({...pose,owner:h.owner,size:h.size,agents:h.agents});
  }
  for(const r of reserved)placed.add(lotRect(r,r.size));
  for(const h of grown){
    const f=foundingBy.get(h.owner)!,pose={x:f.x,z:f.z,rotation:f.rotation},r=lotRect(pose,h.size),fp=HOUSE_FOOTPRINT[h.size];
    if(lotFits({...pose,mode:'relaxed'},fp.hw,fp.hd,HOUSE_YARD[h.size])&&placed.clear(r)){placed.add(r);homes.push({...pose,owner:h.owner,size:h.size,agents:h.agents});}
    else waiting.push(h);
  }
  // Founding lots of households that left are simply never added: they are free, flat ground again.
  // Pass 2: new and outgrown households, most agents first. Lots are only ever added here, so a candidate a size could
  // not use (it does not fit, or it overlaps a lot) stays unusable for that size, and so does the one just taken: the
  // next household of the same size carries on from there (`from`) with the same result as a walk from candidate 0.
  const from=new Map<HouseSize,number>();
  for(const h of waiting.sort(byPriority)){
    for(let i=from.get(h.size)??0;i<MAX_CANDIDATES;i++){
      if(!fit(i,h.size))continue;const c=lotCandidate(i),r=lotRect(c,h.size);if(!placed.clear(r))continue;
      placed.add(r);homes.push({x:c.x,z:c.z,rotation:c.rotation,owner:h.owner,size:h.size,agents:h.agents});from.set(h.size,i+1);break;
    }
  }
  return homes;
}

/** Empty lots a household of `size` could move to, nearest the lodge first: candidates where the house fits and
 *  whose lot keeps clear of every other home (the household's own current lot counts as free). */
export function freeLots(homes:readonly Home[],owner:string,size:HouseSize,limit=80,scan=6000,fit:(i:number,s:HouseSize)=>boolean=fits):HomePose[]{
  const placed=new Placed(),own=homes.find(h=>h.owner===owner);for(const h of homes)if(h.owner!==owner)placed.add(lotRect(h,h.size));
  const out:HomePose[]=[];
  for(let i=0;i<scan&&out.length<limit;i++){if(!fit(i,size))continue;const c=lotCandidate(i),r=lotRect(c,size);
    if(own&&Math.hypot(c.x-own.x,c.z-own.z)<1)continue;   // not the lot the household already stands on
    if(placed.clear(r)){out.push({x:c.x,z:c.z,rotation:c.rotation});placed.add(r);}}
  return out;
}
import type {HomeMove} from './moves.ts';
export type {HomeMove};
/** This browser's moves (moves.ts; oldest first) rewrite the owner's founding lot; placeHouseholds then keeps it like any founding home. */
export function applyMoves(founding:readonly FoundingHome[],moves:readonly HomeMove[]):FoundingHome[]{
  const by=new Map(founding.map(f=>[f.owner.toLowerCase(),f]));
  for(const m of moves)by.set(m.owner.toLowerCase(),{owner:m.owner.toLowerCase(),x:m.x,z:m.z,rotation:m.rotation,size:m.size});
  return [...by.values()];
}

/** Founding lots of households that have moved away (kept empty; see placeHouseholds' `reserved`). */
export function vacatedLots(founding:readonly FoundingHome[],moves:readonly HomeMove[]):FoundingHome[]{
  const movers=new Set(moves.map(m=>m.owner.toLowerCase()));return founding.filter(f=>movers.has(f.owner.toLowerCase()));
}

/** Where each agent stands: featured seats on their quay pedestals, everyone else in a crowd packed into the
 *  front yard (rows 0.7 m apart, as many rows as the yard holds, spread across the lot's width). */
export function agentSpots(homes:readonly Home[]):Map<string,HomePose>{
  const out=new Map<string,HomePose>();
  for(const h of homes){
    const f=HOUSE_FOOTPRINT[h.size],yard=HOUSE_YARD[h.size],crowd=h.agents.filter(id=>!FEATURED_HOMES[id]);
    const rows=Math.max(1,Math.min(Math.ceil(crowd.length/Math.max(1,Math.floor(f.hw*2/.9)+1)),Math.floor((yard-.9)/.7)+1)),perRow=Math.ceil(crowd.length/rows);
    const along=Math.min(.9,(f.hw*2-.2)/Math.max(1,perRow-1));
    for(const id of h.agents){const featured=FEATURED_HOMES[id];if(featured)out.set(id,{x:featured.x,z:featured.z,rotation:0});}
    crowd.forEach((id,i)=>{
      const k=Math.floor(i/perRow),j=i%perRow,n=Math.min(perRow,crowd.length-k*perRow),p=lotPoint(h,(j-(n-1)/2)*along,f.hd+.6+k*.7);
      out.set(id,{x:p.x,z:p.z,rotation:h.rotation});
    });
  }
  return out;
}
/** The house model each home uses: its village's style and its size (skin/houses.ts HOUSE_MODELS keys). The scene asks for
 *  these; at boot, for the founding homes', before the first read has placed anyone (WorldApp). */
export function houseModelKeys(homes:Iterable<Point&{size:HouseSize}>):HouseModelKey[]{return [...houseModelDistances(homes).keys()];}
/** Each model the homes use, with the distance (m) from `from` (SPAWN) of the nearest home using it: the order its
 *  download queues in (assets.ts loadModel). */
export function houseModelDistances(homes:Iterable<Point&{size:HouseSize}>,from:Point=SPAWN):Map<HouseModelKey,number>{
  const out=new Map<HouseModelKey,number>();
  for(const h of homes){const k:HouseModelKey=`${homeStyle(h)}-${h.size}`,d=Math.hypot(h.x-from.x,h.z-from.z);if(!(out.get(k)!<=d))out.set(k,d);}
  return out;
}
export function homeOf(homes:readonly Home[],tokenId:string):Home|undefined{return homes.find(h=>h.agents.includes(tokenId));}
export type {Point};
