import type {GoldDeliveryProvider} from './world-gold-delivery.ts';

const ORIGIN='https://aimarket.trade',PATH='/api/internal/world-gold',VERSION='ember-world-research-delivery/v1';
// The VPS accepts a 900,000-byte document and returns both its JSON object and
// canonical JSON string. Escaping the latter again needs up to twice its UTF-8
// bytes, in addition to the document. Reserve bounded envelope overhead too.
export const MAX_RESEARCH_RESPONSE_BYTES=3*900_000+16_000;
const bytes=(s:string)=>new TextEncoder().encode(s),hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(n=>n.toString(16).padStart(2,'0')).join('');
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const deliveryDigest=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',bytes(s)));
export async function deliverySignature(secret:string,direction:'request'|'response',path:string,time:string,body:string){
  const key=await crypto.subtle.importKey('raw',bytes(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return 'v1.'+time+'.'+hex(await crypto.subtle.sign('HMAC',key,bytes(VERSION+'\n'+direction+'\nPOST\n'+path+'\n'+time+'\n'+await deliveryDigest(body))));
}
async function verified(secret:string,path:string,header:string|null,body:string,now:number){
  const m=header&&/^v1\.(\d{10})\.([0-9a-f]{64})$/.exec(header);if(!m||Math.abs(Number(m[1])-Math.floor(now/1000))>30)return false;
  const expected=await deliverySignature(secret,'response',path,m[1],body);let diff=expected.length^header!.length;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^header!.charCodeAt(i);return diff===0;
}
export type ResearchDeliveryProvider=GoldDeliveryProvider&{readReport:(order:{orderId:string;wallet:string;product:string;reference:string})=>Promise<unknown>};
/** A fixed destination/protocol, authenticated in both directions. Secrets and
 * upstream URLs never enter browser responses; errors/timeouts remain pending. */
export function createAIMarketDelivery(secret:string|undefined,transport:typeof fetch=fetch,clock=Date.now):ResearchDeliveryProvider|undefined{
  if(!secret||secret.length<32||secret.length>256||/\s/.test(secret))return undefined;
  const request=async(action:'deliver'|'read',order:{orderId:string;wallet:string;product:string;reference?:string})=>{
    if(!/^0x[0-9a-f]{64}$/.test(order.orderId)||!/^0x[0-9a-f]{40}$/.test(order.wallet)||order.product!=='research')throw Error('UNSUPPORTED_SERVICE');
    const at=clock();if(!Number.isSafeInteger(at)||at<=0)throw Error('INVALID_CLOCK');
    const path=PATH+'/'+action,body=JSON.stringify({orderId:order.orderId,wallet:order.wallet,product:order.product,...action==='read'?{reference:order.reference}:{}}),time=String(Math.floor(at/1000));
    const response=await transport(ORIGIN+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','accept':'application/json','x-ember-gold-signature':await deliverySignature(secret!,'request',path,time,body)},body});
    if(response.status!==200||response.headers.get('content-type')?.split(';')[0]!=='application/json'||!response.body)throw Error('DELIVERY_UNAVAILABLE');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;const cap=action==='read'?MAX_RESEARCH_RESPONSE_BYTES:16000;
    try{for(;;){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>cap){await reader.cancel();throw Error('DELIVERY_UNAVAILABLE');}raw+=decoder.decode(c.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
    const fresh=clock();if(!Number.isSafeInteger(fresh)||fresh<at||!await verified(secret!,path,response.headers.get('x-ember-gold-signature'),raw,fresh))throw Error('DELIVERY_UNAVAILABLE');
    const value:unknown=JSON.parse(raw);if(!object(value)||value.schema!==VERSION||value.orderId!==order.orderId||value.wallet!==order.wallet||value.product!==order.product)throw Error('DELIVERY_UNAVAILABLE');
    return value;
  };
  return {id:'aimarket-vps-v1',products:['research'],
    async deliver(order){
      if(order.idempotencyKey!==order.orderId)throw Error('INVALID_IDEMPOTENCY_KEY');
      const v=await request('deliver',order);if(v.kind==='pending')return {kind:'pending'};
      if(v.kind==='terminal-failure'&&v.code==='REPORT_TOO_LARGE'&&object(v.proof)&&v.proof.kind==='provider-confirmed-nondelivery'&&v.proof.reference===order.orderId)return {kind:'terminal-failure',code:v.code,proof:{kind:'provider-confirmed-nondelivery',reference:order.orderId}};
      if(v.kind!=='delivered'||!object(v.result)||typeof v.result.report!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(String(v.result.reportDate))||!/^([0-9a-f]{64})$/.test(String(v.result.documentHash))||v.result.reportId!==v.result.documentHash||v.result.provider!=='aimarket-vps-v1')throw Error('DELIVERY_UNAVAILABLE');
      return {kind:'delivered',result:v.result};
    },
    async readReport(order){
      if(!/^[0-9a-f]{64}$/.test(order.reference))throw Error('INVALID_REPORT_REFERENCE');
      const v=await request('read',order);
      if(v.kind!=='delivered'||v.reference!==order.reference||!object(v.document)||v.document.report_id!==order.reference)throw Error('DELIVERY_UNAVAILABLE');
      const {report_id,...unsigned}=v.document;
      // Canonical document bytes are supplied alongside parsed JSON so JS/Python
      // float/Unicode formatting cannot silently change the published hash.
      if(typeof v.canonical!=='string'||await deliveryDigest(v.canonical)!==report_id||JSON.stringify(JSON.parse(v.canonical))!==JSON.stringify(unsigned))throw Error('DELIVERY_UNAVAILABLE');
      return v.document;
    },
  };
}
