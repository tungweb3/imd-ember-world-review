import {GOLD_GRANT_MAX,GOLD_GRANT_SIGNATURE_ASK_MS,goldGrantMessage} from '../shared/goldGrants.ts';

export function grantFormReady({to,gold,checked}:{to:string;gold:string;checked:boolean}){
 const address=to.trim();
 return checked&&/^0x[0-9a-fA-F]{40}$/.test(address)&&!/^0x0{40}$/.test(address)&&/^[1-9][0-9]{0,8}$/.test(gold)&&Number(gold)<=GOLD_GRANT_MAX;
}
export type GrantAttempt={key:string;id:string};
/** The same grant keeps its request id, so resending after a lost answer cannot pay twice; a different one gets a new id. */
export const grantAttemptFor=(current:GrantAttempt,key:string,newId:()=>string):GrantAttempt=>current.key===key?current:{key,id:newId()};
/** What the panel sends: the wallet signs exactly what the server rebuilds from the request. */
export async function signedGrantCommand(g:{origin:string;admin:string;to:string;gold:string;reason:string;requestId:string;now:number;sign:(message:string)=>Promise<string>}){
 const expiresMs=g.now+GOLD_GRANT_SIGNATURE_ASK_MS;
 return {action:'grant',wallet:g.to,gold:g.gold,expiresMs,signature:await g.sign(goldGrantMessage({origin:g.origin,admin:g.admin,to:g.to,gold:g.gold,reason:g.reason,requestId:g.requestId,expiresMs}))};
}
const WALLET_REFUSALS:Record<string,[string,string]>={
 USER_REJECTED:['已取消錢包簽章，這筆沒有發放。','Wallet signature cancelled. Nothing was sent.'],
 CHAIN_MISMATCH:['請先把錢包切到 Ethereum 主網，再發一次。','Switch your wallet to Ethereum mainnet, then send again.'],
 ACCOUNT_MISMATCH:['錢包目前的帳號和登入的不同，請切回登入的帳號。','Your wallet is on a different account than the signed-in one. Switch back to it.'],
 CONTEXT_CHANGED:['錢包或登入狀態變了，請確認後再發一次。','The wallet or sign-in changed. Check it, then send again.'],
 WALLET_TIMEOUT:['錢包太久沒有回應。請先關掉錢包裡還開著的簽章視窗，再發一次。','The wallet took too long. Close any signature window still open in it, then send again.'],
 REQUEST_TIMEOUT:['錢包太久沒有回應，請再發一次。','The wallet took too long. Send again.'],
 PENDING_TRANSACTION:['還有一筆交易或簽章沒處理完，請先處理好再發放。','A transaction or signature is still open. Finish it first.'],
 REQUEST_FAILED:['錢包沒有完成簽章，這筆沒有發放，請再試一次。','The wallet did not finish signing. Nothing was sent. Try again.'],
 INVALID_SIGNATURE:['錢包沒有回傳可用的簽章，這筆沒有發放，請再試一次。','The wallet did not return a usable signature. Nothing was sent. Try again.'],
 CONFIG_CHANGED:['付款設定變了，請重新整理頁面。','The payment settings changed. Reload the page.'],
 NOT_CONFIGURED:['付款設定還沒開啟，暫時不能發放。','Payments are not configured, so grants are closed for now.'],
};
export function grantError(code:string,zh:boolean){
 const wallet=Object.hasOwn(WALLET_REFUSALS,code)?WALLET_REFUSALS[code]:null;if(wallet)return wallet[zh?0:1];
 if(code==='GRANT_DUPLICATE_RECENT')return zh?'這個地址 10 分鐘內已發過相同數量，請先看下方最近紀錄，避免重複發放。':'This wallet got the same amount in the last 10 minutes. Check the recent grants below.';
 if(code==='GRANT_DAILY_LIMIT')return zh?'已達 24 小時發放上限（20,000 GOLD 或 100 筆）。':'The 24-hour grant limit is reached (20,000 GOLD or 100 grants).';
 if(code==='INVALID_ADDRESS_CHECKSUM')return zh?'地址的大小寫對不上，可能打錯字了，請重新複製。':'The address fails its checksum, so it may be mistyped. Copy it again.';
 if(code==='RECIPIENT_NOT_EOA')return zh?'這個地址曾用合約錢包登入，收到也花不掉，請改用一般錢包。':'This address has signed in as a contract wallet and could not spend the GOLD. Use an ordinary wallet.';
 if(code==='GRANT_SIGNATURE_EXPIRED')return zh?'簽章已過期，或電腦時間不對，請再發一次。':'The signature expired, or this computer\'s clock is off. Send it again.';
 if(code==='INVALID_GRANT_SIGNATURE'||code==='GRANT_SIGNATURE_REQUIRED')return zh?'錢包簽章不符，請確認錢包是登入的帳號後再發一次。':'The wallet signature does not match. Check the wallet is the signed-in account and send it again.';
 if(code==='INVALID_GRANT_AMOUNT')return zh?'數量不在允許範圍內。':'The amount is outside the allowed range.';
 return code;
}
