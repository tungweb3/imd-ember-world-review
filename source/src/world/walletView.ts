// Pure view rules for "My wallet" (WalletPanel.tsx) and the 「我家」 marker (WorldApp.tsx), kept out of .tsx so the tests
// run them on what the real Worker answers.
import type {Home} from './households.ts';
import type {MeHome,MeSeat} from './auth.ts';

type Say=(zh:string,en:string)=>string;
export type SeatRow=MeSeat&{image:string|null};

/** The seat rows. For the signed-in wallet, only the seats the server proved with ownerOf (CORR-04: a public row the proof
 *  did not confirm — a seat just sold that IMD's roster still lists — is dropped, not shown as held); otherwise the public
 *  list (IMD's roster, unverified). */
export function seatRows(pub:readonly SeatRow[]|null,me:MeHome|null):SeatRow[]|null{
  if(!me)return pub?[...pub]:null;
  return me.seats.map(s=>({...s,image:pub?.find(p=>p.tokenId===s.tokenId)?.image??null}));
}
/** The pill beside a seat: counts, or why it does not. */
export function countsText(s:Pick<MeSeat,'counts'|'reason'>,say:Say):string{
  if(s.counts)return say('計入房子','Counts');
  switch(s.reason){
    case 'not-agent':return say('未註冊 agent','No agent');
    case 'offline-24h':return say('24h 未上線','Offline 24h+');
    case 'not-seen':return say('尚未記錄上線','Not seen online yet');
    default:return say('不計入','Not counted');
  }
}
/** "n agents count toward the house" with the right number (CORR-08). */
export const eligibleText=(n:number,say:Say)=>say(`${n} 位 agent 計入房子`,`${n} agent${n===1?' counts':'s count'} toward the house`);

/** The household the map marks (INT-6): in owner mode the signed-in wallet's own household, labelled 「我家」; otherwise the
 *  viewed wallet's, labelled 「這個錢包的家」. `mine` is true only for the owner's own. */
export function markedHome(homes:readonly Home[],owner:string|null,viewed:string|null):{home:Home|null;mine:boolean}{
  const own=owner?homes.find(h=>h.owner===owner)??null:null;
  if(own)return {home:own,mine:true};
  return {home:viewed?homes.find(h=>h.owner===viewed)??null:null,mine:false};
}
export const markerLabel=(mine:boolean,say:Say)=>mine?say('我家','My home'):say('這個錢包的家','This wallet’s home');
