// Moving house (local only; [REDACTED]). The only proof of ownership is the server-verified SIWE
// session: owner mode (auth.ts ownerAddress, i.e. GET /api/me/home counted a seat for the session's address). A move
// asks the wallet for nothing and stores no signature. Entries saved by older builds carried a personal_sign message
// and signature; those fields are dropped on read and never trusted (a stored move only ever moves a house in this
// browser's own view, and it proves nothing).
import {HOUSE_SIZES,type HouseSize} from './houseSize.ts';
import type {DataMode} from './model.ts';
import {ownerAddress,statusOf,type AuthState} from './auth.ts';

export type HomeMove={owner:string;x:number;z:number;rotation:number;size:HouseSize};
type Store=Pick<Storage,'getItem'|'setItem'>;
export const movesKey=(mode:string)=>'ember-world-moves-v1-'+mode;
const LIMIT=1e4;
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<LIMIT;
/** The fields a move may have, rebuilt from scratch (anything else, e.g. an old message/signature, is left behind); null
 *  when the entry is not a move. */
export function cleanMove(v:unknown):HomeMove|null{
  if(!v||typeof v!=='object')return null;
  const m=v as Record<string,unknown>;
  if(typeof m.owner!=='string'||!/^0x[\da-fA-F]{40}$/.test(m.owner)||!num(m.x)||!num(m.z)||!num(m.rotation)||!HOUSE_SIZES.includes(m.size as HouseSize))return null;
  return {owner:m.owner.toLowerCase(),x:m.x,z:m.z,rotation:m.rotation,size:m.size as HouseSize};
}
/** One stored list, cleaned; rewritten when cleaning changed it. */
function load(store:Store,key:string):HomeMove[]{
  let raw:string|null=null,list:unknown=[];
  try{raw=store.getItem(key);list=JSON.parse(raw??'[]');}catch{list=[];}
  const by=new Map<string,HomeMove>();
  for(const v of Array.isArray(list)?list:[]){const m=cleanMove(v);if(m){by.delete(m.owner);by.set(m.owner,m);}}
  const moves=[...by.values()],text=JSON.stringify(moves);
  if(raw!==null&&raw!==text)try{store.setItem(key,text);}catch{/* private window */}
  return moves;
}
/** Each data mode keeps its own list. */
export const MOVE_MODES:readonly DataMode[]=['live','mock'];
/** This browser's moves in `mode`, one per owner (the last one wins). Every mode's stored list is cleaned and rewritten
 *  when that changed it, so no old signature stays in localStorage under either key. */
export function readMoves(store:Store|null,mode:string):HomeMove[]{
  if(!store)return [];
  for(const m of MOVE_MODES)if(m!==mode)load(store,movesKey(m));
  return load(store,movesKey(mode));
}
/** Why a move is (not) allowed at `now` (this device's clock). 'sign-in': no owner session (a wallet that is merely
 *  connected, a mismatched session, seats not confirmed, or a session whose expiresAt is not ahead of `now`, W-1);
 *  'not-yours': the house shown is another wallet's; 'no-house': the owner's house is not on the map yet. */
export type MoveGate='ok'|'sign-in'|'not-yours'|'no-house';
export function moveGate(state:AuthState,home:{owner:string}|null,now:number):MoveGate{
  const owner=ownerAddress(state,now);
  if(!owner)return 'sign-in';
  if(!home)return 'no-house';
  return home.owner.toLowerCase()===owner?'ok':'not-yours';
}
/** What "My wallet" says under the connected account's own house when it cannot move it: 'sign-in' only when that
 *  account has no live session (none, another address's, or one past its expiresAt at `now`); a signed-in account is told why its seats do not count now ('no-seat': none qualifies under
 *  the 24 h rule; 'unverified': the chain read failed). null: nothing to say (owner mode, another wallet's house, or a
 *  state such as verifying that resolves by itself). */
export type MoveHint='sign-in'|'no-seat'|'unverified';
export function moveHint(state:AuthState,home:{owner:string}|null,now:number):MoveHint|null{
  if(!home||!state.account||home.owner.toLowerCase()!==state.account||ownerAddress(state,now))return null;
  if(state.session?.address!==state.account)return 'sign-in';
  const st=statusOf(state,now);return st==='expired'?'sign-in':st==='signedInNoHouse'?'no-seat':st==='ownershipUnavailable'?'unverified':null;
}
/** Records the owner's move to `lot` in `moves` and the store; refuses (null) unless moveGate is 'ok' at `now` (the
 *  moment of the click, on this device's clock). The owner is the session's address, never the viewed or connected wallet. */
export function commitMove(store:Store|null,mode:string,moves:readonly HomeMove[],state:AuthState,home:{owner:string;size:HouseSize}|null,
  lot:{x:number;z:number;rotation:number},now:number):HomeMove[]|null{
  if(moveGate(state,home,now)!=='ok')return null;
  const move=cleanMove({owner:ownerAddress(state,now),x:lot.x,z:lot.z,rotation:lot.rotation,size:home!.size});if(!move)return null;
  const next=[...moves.filter(m=>m.owner!==move.owner),move];
  try{store?.setItem(movesKey(mode),JSON.stringify(next));}catch{/* kept for this session */}
  return next;
}
