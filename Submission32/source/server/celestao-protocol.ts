/** Dedicated Celestao protocol; never accepts an HTTP-selected destination. */
export const CELESTAO_DELIVERY_SCHEMA='ember-world-celestao/v1';
export const CELESTAO_DELIVERY_PATH='/api/internal/world-gold/deliver';
export const CELESTAO_PREPARE_PATH='/api/celestao-checkout/prepare';
export const celestaoSecret=(v:unknown):v is string=>typeof v==='string'&&v.length>=32&&v.length<=256&&!/\s/.test(v);
export const celestaoDigest=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function celestaoSignature(secret:string,direction:'request'|'response',path:string,time:string,body:string){
 if(!celestaoSecret(secret))throw Error('DELIVERY_UNAVAILABLE');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return 'v1.'+time+'.'+hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(CELESTAO_DELIVERY_SCHEMA+'\n'+direction+'\nPOST\n'+path+'\n'+time+'\n'+await celestaoDigest(body))));
}
export async function verifyCelestaoSignature(secret:string,direction:'request'|'response',path:string,signature:string|null,body:string,now:number){
 const match=signature&&/^v1\.(\d{10})\.([0-9a-f]{64})$/.exec(signature);
 if(!celestaoSecret(secret)||!match||!Number.isSafeInteger(now)||Math.abs(Number(match[1])-Math.floor(now/1000))>30)return false;
 const expected=await celestaoSignature(secret,direction,path,match[1],body);let diff=expected.length^signature!.length;
 for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^signature!.charCodeAt(i);return diff===0;
}
export async function celestaoBody(request:Request|Response,cap=4096){
 if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||!request.body)throw Error('BAD_REQUEST');
 const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>cap){await reader.cancel();throw Error('BAD_REQUEST');}raw+=decoder.decode(part.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
 const value:unknown=JSON.parse(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('BAD_REQUEST');return {raw,value:value as Record<string,unknown>};
}
