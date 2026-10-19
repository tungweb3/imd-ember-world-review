/** Review fixture contracts for research/fortune results, not proof that a real
 * upstream report exists. Real provider adapters must additionally validate
 * their service-specific signed/authenticated response before this boundary. */
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0;
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const hasGoldResultContract=(product:string)=>['research','fortune'].includes(product);
function usableDocument(product:string,v:unknown){
 if(!hasGoldResultContract(product))return false;
 // A bare non-JSON upstream error is not a report. Historical rows remain
 // stored and are flagged by inspection, rather than silently accepted here.
 if(!record(v))return false;
 if(text(v.report)||text(v.content))return true;
 // Zero signals, a numeric zero or false can be a meaningful documented result.
 if(v.status==='no-signal')return text(v.explanation)&&Array.isArray(v.signals)&&v.signals.length===0;
 return v.status==='ok'&&text(v.explanation)&&Object.hasOwn(v,'value')&&
  (typeof v.value==='boolean'||typeof v.value==='number'&&Number.isFinite(v.value));
}
export function encodeGoldResult(product:string,result:unknown):{json:string|null;failure:string|null}{
 let json:string|undefined;
 try{json=JSON.stringify(result);}catch{return {json:null,failure:'RESULT_NOT_SERIALIZABLE'};}
 if(typeof json!=='string')return {json:null,failure:'RESULT_NOT_SERIALIZABLE'};
 if(new TextEncoder().encode(json).length>16000)return {json:null,failure:'RESULT_TOO_LARGE'};
 // Validate the value actually persisted, including objects with toJSON hooks.
 const stored:unknown=JSON.parse(json);
 if(!usableDocument(product,stored))return {json:null,failure:'RESULT_UNUSABLE'};
 // TextEncoder silently replaces lone surrogates. Reject rather than changing
 // report contents while classifying a delivery as successful.
 const stack:unknown[]=[stored];
 while(stack.length){const v=stack.pop();
  if(typeof v==='string'&&/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))return {json:null,failure:'RESULT_INVALID_UNICODE'};
  if(Array.isArray(v))stack.push(...v);else if(record(v))for(const [k,x] of Object.entries(v))stack.push(k,x);
 }
 return {json,failure:null};
}

/** Opaque INTERNAL auth document plus the separately typed complete MintBinding.
 * Only lossless plain JSON objects are allowed. No coercion or silent removal
 * of undefined/functions/symbols, custom serializers, cycles or nonfinite data.
 * Existing JSON bytes/key order and full retry equality are preserved. */
export function encodeMintAuth(auth:unknown,binding:{id:string;wallet:string;gold:string;deadline:number;chainId:number;contract:string;chainInstance:string}):string{
 const seen=new Set<object>();
 const visit=(v:unknown,depth:number):boolean=>{
  if(depth>32)return false;
  if(v===null||typeof v==='boolean'||typeof v==='string')return true;
  if(typeof v==='number')return Number.isFinite(v);
  if(typeof v!=='object')return false;
  if(seen.has(v))return false;
  if(!Array.isArray(v)&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)return false;
  if(Array.isArray(v)&&Object.keys(v).length!==v.length)return false;
  seen.add(v);
  const descriptors=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(v);
  const ok=keys.every(k=>typeof k==='string'&&(Array.isArray(v)&&k==='length'||
   descriptors[k].enumerable&&Object.hasOwn(descriptors[k],'value')&&visit(descriptors[k].value,depth+1)));
  seen.delete(v);return ok;
 };
 try{
  if(!record(auth)||!Object.keys(auth).length||!visit(auth,0))throw Error();
  const encoded=JSON.stringify(auth);
  if(typeof encoded!=='string'||new TextEncoder().encode(encoded).length>16000)throw Error();
  const doc=JSON.parse(encoded) as Record<string,unknown>;
  const sameAddress=(v:unknown,w:string)=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&v.toLowerCase()===w;
  const uint=(v:unknown)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v);
  const hash=(v:unknown)=>typeof v==='string'&&/^0x[0-9a-fA-F]{64}$/.test(v);
  if(Object.hasOwn(doc,'auth')){
   const a=doc.auth,p=doc.packet,anchor=doc.chainAnchor;
   if(!record(a)||!record(p)||!record(p.domain)||!record(anchor)||!hash(anchor.genesisHash)||!hash(anchor.codeHash)
    ||a.orderId!==binding.id||!sameAddress(a.wallet,binding.wallet)||a.goldCost!==binding.gold||!Number.isSafeInteger(a.deadline)||Number(a.deadline)*1000!==binding.deadline
    ||!hash(a.key)||!hash(a.uriHash)||!uint(a.embeoCost)||!uint(a.signerEpoch)||typeof a.recipient!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(a.recipient)
    ||p.route!=='paid'||p.runId!==binding.chainInstance||p.domain.chainId!==binding.chainId||!sameAddress(p.domain.verifyingContract,binding.contract)
    ||!sameAddress(p.walletAddress,binding.wallet)||p.key!==a.key||p.deadline!==a.deadline||p.signerEpoch!==a.signerEpoch||p.expectedRecipient!==a.recipient||p.expectedCost!==a.embeoCost)throw Error();
  }else{
   // Existing recorded fixture auth is wallet/order-bound. Neither form is a
   // browser authorization or proof that the production signer is installed.
   if(doc.id!==binding.id||!sameAddress(doc.wallet,binding.wallet)||(Object.hasOwn(doc,'cost')&&doc.cost!==binding.gold))throw Error();
  }
  return encoded;
 }catch{throw Error('INVALID_MINT_AUTH');}
}
