// Pure view rules for "My wallet" (WalletPanel.tsx) and the 「我家」 marker (WorldApp.tsx), kept out of .tsx so the tests
// run them on what the real Worker answers.
import type {Home} from './households.ts';
import type {AuthClient,MeHome,MeSeat} from './auth.ts';
import type {SignInSummary} from './siwe.ts';

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

/** The two lines beside the open wallet prompt (F-1 UX), from the checked message's summary: what is being signed, and
 *  what to compare. A relayed message (F-1) names the real domain, so the domain in the text proves nothing: what differs
 *  is the requesting site (the address bar, the wallet's request-origin line or its mismatch warning). The wallet's
 *  check is the defence; this page cannot stop a look-alike site from skipping it, so it claims nothing more. */
export const signingText=(s:SignInSummary,say:Say):[string,string]=>{const w=s.address.slice(0,6)+'…'+s.address.slice(-4);return [
  say(`登入 IMD Ember World · 網域：${s.domain} · 網路：${s.network} · 錢包：${w} · 用途：僅限登入 · 不轉移資產、不做任何授權`,`Sign in to IMD Ember World · Domain: ${s.domain} · Network: ${s.network} · Wallet: ${w} · Purpose: sign-in only · No asset transfer or approval`),
  say(`只在網址列顯示 ${s.domain} 時簽名；若錢包顯示請求來自其他網站或出現不符警告，請拒絕。`,`Sign only when the address bar shows ${s.domain}. If your wallet says the request comes from another site or warns of a mismatch, reject.`)];};
/** Above the sign-in button, before the wallet opens (F-1 UX; on a phone the wallet's sheet can cover the summary above):
 *  what the signature is and is not, and the site and network it is for (`host`: this page's own, location.host). */
export const presignText=(host:string,say:Say):[string,string]=>[
  say('此次簽名僅用於登入 IMD Ember World（登入有效 7 天）、確認錢包控制權。不收取 Gas，不會轉移資產、不會對代幣或 NFT 做任何授權（approve），也不會送出交易；請確認錢包顯示的是本站登入訊息。',
    'This signature only signs you in to IMD Ember World (for 7 days) and proves you control the wallet. It costs no gas and authorizes no asset transfer, token or NFT approval, or transaction. Check that your wallet shows this site’s sign-in message.'),
  say(`網域：${host} · 網路：Ethereum · 用途：僅限登入`,`Domain: ${host} · Network: Ethereum · Purpose: sign-in only`)];

/** My wallet's log-out actions when signed in (F-4): this device, and all devices behind an inline confirm that says who
 *  follows when (this browser's other tabs at once, other devices on their next signed-in request). */
export type LogoutAct='device'|'ask-all'|'all'|'cancel';
type LogoutButton={act:LogoutAct;label:string};
export const logoutDeviceLabel=(say:Say)=>say('登出此裝置','Log out this device');
export function logoutView(confirming:boolean,address:string,say:Say):{buttons:LogoutButton[];confirm:{note:string;buttons:LogoutButton[]}|null}{
  const w=address.slice(0,6)+'…'+address.slice(-4),device={act:'device' as const,label:logoutDeviceLabel(say)};
  if(!confirming)return {buttons:[device,{act:'ask-all',label:say('登出所有裝置','Log out all devices')}],confirm:null};
  return {buttons:[device],confirm:{note:say(`這會結束 ${w} 在所有瀏覽器與裝置上的登入（包括這裡）：本瀏覽器的其他分頁立即登出，其他裝置在下一次需要登入的操作時登出。`,
    `This logs out ${w} on every browser and device, including this one. Other tabs here log out at once; other devices on their next signed-in request.`),
    buttons:[{act:'all',label:say('確定，登出所有裝置','Yes, log out all devices')},{act:'cancel',label:say('取消','Cancel')}]}};
}
/** Is the "Log out all devices" confirm open? Only for the very session it was opened for (`asked`, the session object
 *  then): once that session ends (another tab logs out) and a new sign-in follows in the same open drawer, it is closed. */
export const confirmOpen=(asked:object|null,session:object|null)=>asked!==null&&asked===session;
/** What a log-out button does: asking and cancelling only open or close the confirm; 'device' ends this browser's
 *  session, 'all' (only from the confirm) every session of the address (POST /api/auth/logout-all). */
export function runLogout(act:LogoutAct,client:Pick<AuthClient,'signOut'>,confirm:(open:boolean)=>void):Promise<void>{
  if(act==='ask-all'||act==='cancel'){confirm(act==='ask-all');return Promise.resolve();}
  confirm(false);return client.signOut(act==='all');
}
