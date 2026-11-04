import {GOLD_GRANT_MAX} from '../shared/goldGrants.ts';

export function grantFormReady({to,gold,checked}:{to:string;gold:string;checked:boolean}){
 const address=to.trim();
 return checked&&/^0x[0-9a-fA-F]{40}$/.test(address)&&!/^0x0{40}$/.test(address)&&/^[1-9][0-9]{0,8}$/.test(gold)&&Number(gold)<=GOLD_GRANT_MAX;
}
export type GrantAttempt={key:string;id:string};
/** The same grant keeps its request id, so resending after a lost answer cannot pay twice; a different one gets a new id. */
export const grantAttemptFor=(current:GrantAttempt,key:string,newId:()=>string):GrantAttempt=>current.key===key?current:{key,id:newId()};
export function grantError(code:string,zh:boolean){
 if(code==='GRANT_DUPLICATE_RECENT')return zh?'這個地址 10 分鐘內已發過相同數量，請先看下方最近紀錄，避免重複發放。':'This wallet got the same amount in the last 10 minutes. Check the recent grants below.';
 if(code==='GRANT_DAILY_LIMIT')return zh?'已達 24 小時發放上限（20,000 GOLD 或 100 筆）。':'The 24-hour grant limit is reached (20,000 GOLD or 100 grants).';
 if(code==='INVALID_ADDRESS_CHECKSUM')return zh?'地址的大小寫對不上，可能打錯字了，請重新複製。':'The address fails its checksum, so it may be mistyped. Copy it again.';
 if(code==='INVALID_GRANT_AMOUNT')return zh?'數量不在允許範圍內。':'The amount is outside the allowed range.';
 return code;
}
