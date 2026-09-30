// Who may walk into a house (docs/interiors/DESIGN_v001.md §1): only the signed-in owner, only into their own. Owner
// rights come from auth.ts (GET /api/me/home for the server session); nothing here asks the server or the wallet. Kept
// small: it ships in the world's main bundle, the interior itself is a lazy chunk (./interior/InteriorView.tsx).
import {ownerAddress,type AuthState} from './auth.ts';
import {HOUSE_FOOTPRINT,HOUSE_SIZES,type HouseSize} from './households.ts';
import {lotPoint,type HomePose,type Point} from './layout.ts';

export type EnterGate='ok'|'sign-in'|'not-yours'|'no-house'|'expired';
/** 'ok' only in owner mode (a server session whose house read counts a seat, the connected wallet if any the session's),
 *  with the session still unexpired at `now`, the house read for that session's address, and `home` that address's. */
export function enterGate(state:AuthState,home:{owner:string}|null,now:number):EnterGate{
  if(state.session&&!(state.session.expiresAt>now))return 'expired';
  const owner=ownerAddress(state,now);
  if(!owner||!state.session)return 'sign-in';
  const read=state.home;if(!read||read==='unavailable'||read.address.toLowerCase()!==owner)return 'sign-in';
  if(!home)return 'no-house';
  return home.owner.toLowerCase()===owner?'ok':'not-yours';
}
/** The one house the page may offer an Enter action for: the owner's own home when enterGate is 'ok' at `now`, else
 *  null (visitors, every other owner state, a stale or expired session, and every other wallet's house). */
export function enterableHome<H extends {owner:string}>(state:AuthState,homes:readonly H[],now:number):H|null{
  const owner=ownerAddress(state,now);if(!owner)return null;
  const own=homes.find(h=>h.owner.toLowerCase()===owner)??null;
  return own&&enterGate(state,own,now)==='ok'?own:null;
}
/** The house an Enter press (E, the door pill, the household block) opens: `offered` (the memoised enterableHome of the
 *  last render) only if enterGate is still 'ok' at the moment of the press, the way the move flow re-checks at its click
 *  (moves.ts). Swarm retest W-1: an expiry timer that fired late (a sleeping device) must not leave the door open until
 *  the next 10 s clock tick. */
export const enterAtPress=<H extends {owner:string}>(state:AuthState,offered:H|null,now:number):H|null=>offered&&enterGate(state,offered,now)==='ok'?offered:null;
/** Whether a household's block shows `Enter your home`: only the enterable home's own block. */
export const offersEnter=(home:{owner:string},enterable:{owner:string}|null)=>!!enterable&&home.owner.toLowerCase()===enterable.owner.toLowerCase();
/** Standing within this many metres of the owner's door offers the way in. */
export const DOOR_REACH=1.8;
/** The spot in front of a house's door (the house's own frame: the door on +Z). */
export const doorPoint=(home:HomePose&{size:HouseSize}):Point=>lotPoint(home,0,HOUSE_FOOTPRINT[home.size].hd+.6);
export const atDoor=(p:Point,home:HomePose&{size:HouseSize})=>{const d=doorPoint(home);return Math.hypot(p.x-d.x,p.z-d.z)<=DOOR_REACH;};
/** scene.ts checkDoor: the player stands at the door of the enterable home (the only one), on foot. */
export const nearOwnDoor=(p:Point,enterable:(HomePose&{size:HouseSize})|null,aboard:boolean)=>!!enterable&&!aboard&&atDoor(p,enterable);
/** WorldApp: the door pill `E  Enter your home` shows when the scene says the player is at the enterable home's door
 *  and nobody is inside yet. */
export const doorOffer=(viewNearDoor:boolean,enterable:{owner:string}|null,inside:boolean)=>viewNearDoor&&!!enterable&&!inside;
/** WorldApp: the open household block (the drawer's home) offers `Enter your home` only for the enterable home. */
export const blockEnter=(drawerHome:{owner:string}|null,enterable:{owner:string}|null,inside:boolean)=>!inside&&!!drawerHome&&offersEnter(drawerHome,enterable);
/** The interior chunk's loader: one import in flight or done at a time; a failed one is forgotten (and reported by
 *  `failed`), so the next Enter imports again instead of replaying the old rejection (INT-2). */
export function chunkLoader<T>(importer:()=>Promise<T>){
  let p:Promise<T>|null=null,failed=false;
  return {load:()=>p??=importer().then(m=>{failed=false;return m;},e=>{p=null;failed=true;throw e;}),get failed(){return failed;}};
}
/** Where `Go home` (WalletPanel, scene.focusHome) puts you: 1.6 m in front of the door spot, within reach of the way in. */
export const doorLanding=(home:HomePose&{size:HouseSize}):Point=>lotPoint(home,0,HOUSE_FOOTPRINT[home.size].hd+2.2);
/** Reviewers' preview (?interior=<size>&seats=<n>[&style=timber], DEV or ?debug=1 only): the room with mock seats. It grants nothing:
 *  no owner rights, no Enter button, no house of anyone's. null in a production URL without ?debug=1. */
export function interiorPreview(search:string,dev:boolean):{size:HouseSize;seats:number;style:'lisbon'|'timber'}|null{
  const q=new URLSearchParams(search),size=q.get('interior') as HouseSize;
  if((!dev&&q.get('debug')!=='1')||!HOUSE_SIZES.includes(size))return null;
  const n=Number(q.get('seats')??5);return {size,seats:Number.isInteger(n)?Math.min(60,Math.max(0,n)):5,style:q.get('style')==='timber'?'timber':'lisbon'};
}
