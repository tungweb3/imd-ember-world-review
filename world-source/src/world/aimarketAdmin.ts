export type AIMarketAdminStatus={address:string;expiresAt:number;role:'aimarket:trial:manage';canManageFreeTrial:true};
type Session={address:string;expiresAt:number};
type Options={fetch?:typeof fetch;signal?:AbortSignal;now?:()=>number};
const ADDRESS=/^0x[0-9a-fA-F]{40}$/;

/** Presentation only: management requests must independently check the server
 *  role. No wallet allowlist or credential is included in the client bundle. */
export async function fetchAIMarketAdminStatus(session:Session,options:Options={}):Promise<AIMarketAdminStatus|null>{
  const clock=options.now??Date.now;
  const {address,expiresAt}=session;
  try{
    const started=clock();
    if(!ADDRESS.test(address)||!Number.isSafeInteger(expiresAt)||!Number.isSafeInteger(started)||started<=0||expiresAt<=started)return null;
    const response=await (options.fetch??fetch)('/api/me/aimarket-admin?'+new URLSearchParams({expected_address:address}),
      {method:'GET',credentials:'same-origin',cache:'no-store',signal:options.signal});
    if(response.status!==200||options.signal?.aborted)return null;
    const value:unknown=await response.json();
    if(!value||typeof value!=='object'||Array.isArray(value)||options.signal?.aborted)return null;
    const row=value as Record<string,unknown>,keys=Object.keys(row),at=clock();
    if(keys.length!==4||!keys.every(key=>['address','expiresAt','role','canManageFreeTrial'].includes(key))||
      typeof row.address!=='string'||!ADDRESS.test(row.address)||row.address.toLowerCase()!==address.toLowerCase()||
      row.expiresAt!==expiresAt||!Number.isSafeInteger(at)||at<started||expiresAt<=at||row.role!=='aimarket:trial:manage'||row.canManageFreeTrial!==true)return null;
    return {address:row.address.toLowerCase(),expiresAt,role:'aimarket:trial:manage',canManageFreeTrial:true};
  }catch{return null;}
}
