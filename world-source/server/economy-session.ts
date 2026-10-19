import {readSession,type Session} from './auth.ts';
import type {D1Database} from './d1.ts';

/** One request's clock, shared with every downstream money operation. Equal
 * samples are allowed; an invalid or regressing sample fails closed. */
export function economySessionClock(source:()=>number){
 let last=0,invalid=false;
 return ()=>{const now=source();if(invalid||!Number.isSafeInteger(now)||now<=0||now<last){invalid=true;throw Error('INVALID_CLOCK');}last=now;return now;};
}
export function verifiedEconomySession(session:Session|string,now:number):session is Session{
 return typeof session!=='string'&&/^0x[0-9a-fA-F]{40}$/.test(session.address)&&Number.isSafeInteger(session.expiresAt)&&session.expiresAt>now&&['ECDSA','ERC1271'].includes(session.verificationMethod??'');
}
/** The read itself awaits hashing and D1. Validate at its completion, too. */
export async function readEconomySession(request:Request,db:D1Database,clock:()=>number){
 const session=await readSession(request,db,clock()),now=clock();
 return verifiedEconomySession(session,now)?session:typeof session==='string'?session:'AUTH_REQUIRED';
}
/** Revalidation pins the exact authentication context, including expiry and
 * method. It never upgrades a changed session or returns a stale private body. */
export async function revalidateEconomySession(request:Request,db:D1Database,original:Session,clock:()=>number){
 const fresh=await readEconomySession(request,db,clock);
 return typeof fresh!=='string'&&fresh.tokenHash===original.tokenHash&&fresh.address.toLowerCase()===original.address.toLowerCase()&&fresh.expiresAt===original.expiresAt&&fresh.walletType===original.walletType&&fresh.verificationMethod===original.verificationMethod;
}
