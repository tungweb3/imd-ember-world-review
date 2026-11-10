import type {D1Database} from './d1.ts';
import type {GoldDeliveryProvider} from './world-gold-delivery.ts';
import {encodeGoldResult} from './world-gold-result.ts';
import {FORTUNE_PRODUCTS,fortuneProduct} from '../src/shared/fortunePricing.ts';
import {CELESTAO_DELIVERY_PATH,CELESTAO_DELIVERY_SCHEMA,celestaoBody,celestaoSecret,celestaoSignature,verifyCelestaoSignature} from './celestao-protocol.ts';

/** Complete reports stay in the encrypted Celestao vault. Only a strict,
 * signed wallet/order/run-bound delivery receipt enters the World ledger. */
export function createCelestaoDelivery(db:D1Database|undefined,secret:string|undefined,transport:typeof fetch=fetch,clock=Date.now):GoldDeliveryProvider|undefined{
 if(!db||!celestaoSecret(secret))return undefined;
 return {id:'celestao-v1',products:FORTUNE_PRODUCTS.map(p=>p.product),async deliver(order){
  if(order.idempotencyKey!==order.orderId||!/^0x[0-9a-f]{64}$/.test(order.orderId)||!/^0x[0-9a-f]{40}$/.test(order.wallet)||!fortuneProduct(order.product))throw Error('DELIVERY_UNAVAILABLE');
  const bound=await db.prepare(`SELECT c.id,c.input_hash FROM celestao_checkouts c JOIN economy_orders o ON o.id=c.order_id AND o.wallet=c.wallet AND o.service_id=c.product
   WHERE c.order_id=? AND c.wallet=? AND c.product=? AND o.status='paid' AND o.currency='GOLD'`).bind(order.orderId,order.wallet,order.product).first<{id:string;input_hash:string}>();
  if(!bound)throw Error('DELIVERY_UNAVAILABLE');
  const time=clock();if(!Number.isSafeInteger(time)||time<=0)throw Error('INVALID_CLOCK');
  const body=JSON.stringify({schema:CELESTAO_DELIVERY_SCHEMA,orderId:order.orderId,wallet:order.wallet,product:order.product,runId:bound.id,inputHash:bound.input_hash});
  const response=await transport('https://celestao.com'+CELESTAO_DELIVERY_PATH,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'content-type':'application/json','accept':'application/json','x-celestao-signature':await celestaoSignature(secret,'request',CELESTAO_DELIVERY_PATH,String(Math.floor(time/1000)),body)},body});
  // The vault refused this paid order: retrying will not help, and nothing else reports it.
  if(response.status===409)console.error('celestao_delivery_refused',order.orderId);
  if(response.status!==200)throw Error('DELIVERY_UNAVAILABLE');
  const {raw,value:v}=await celestaoBody(response,16000),fresh=clock();
  if(fresh<time||!await verifyCelestaoSignature(secret,'response',CELESTAO_DELIVERY_PATH,response.headers.get('x-celestao-signature'),raw,fresh)||v.schema!==CELESTAO_DELIVERY_SCHEMA||v.orderId!==order.orderId||v.wallet!==order.wallet||v.product!==order.product||v.runId!==bound.id||v.inputHash!==bound.input_hash)throw Error('DELIVERY_UNAVAILABLE');
  if(v.kind==='pending')return {kind:'pending'};
  if(v.kind==='delivered'){
   const encoded=encodeGoldResult(order.product,v.result);if(encoded.failure)throw Error('DELIVERY_UNAVAILABLE');
   return {kind:'delivered',result:JSON.parse(encoded.json!)};
  }
  if(v.kind==='terminal-failure'&&v.code==='CHART_NOT_GENERATED'&&v.proof&&typeof v.proof==='object'&&!Array.isArray(v.proof)&&
   (v.proof as Record<string,unknown>).kind==='provider-confirmed-nondelivery'&&(v.proof as Record<string,unknown>).reference===order.orderId)
   return {kind:'terminal-failure',code:'CHART_NOT_GENERATED',proof:{kind:'provider-confirmed-nondelivery',reference:order.orderId}};
  throw Error('DELIVERY_UNAVAILABLE');
 }};
}
