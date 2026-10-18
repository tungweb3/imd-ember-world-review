import {assertObjectFields,canonicalJSON,parseStrictJSON} from '../shared-workbench/json.mjs';
export const MAX_REQUEST_BYTES=32768;
export class LocalError extends Error {
 constructor(code,stage='validation',receipt=null,transactionHash=null){super(code);this.code=code;this.stage=stage;this.receipt=receipt;this.transactionHash=transactionHash;}
}
export function reject(code){throw new LocalError(code);}
export function walletId(value){if(!['A','B','C'].includes(value))reject('WALLET_INVALID');return value;}
function exact(value,fields){try{assertObjectFields(value,fields,'REQUEST_SCHEMA_INVALID');canonicalJSON(value);}catch{reject('REQUEST_SCHEMA_INVALID');}}
export function parseRequest(text){try{return parseStrictJSON(text);}catch{reject('REQUEST_JSON_INVALID');}}
export function approvalRequest(value){exact(value,['wallet','look',...(Object.hasOwn(value??{},'route')?['route']:[])]);walletId(value.wallet);if(value.route!==undefined&&!['free','paid'].includes(value.route))reject('MINT_ROUTE_INVALID');return value;}
export function transactionRequest(value){
 const extra=Object.hasOwn(value??{},'submissionId')?['submissionId']:[];
 if(!extra.length)reject('SUBMISSION_ID_REQUIRED');
 if(value?.action==='approve')exact(value,['action','wallet',...extra]);
 else if(['mintFree','mintPaid'].includes(value?.action))exact(value,['action','wallet','packet',...extra]);
 else reject('ACTION_INVALID');walletId(value.wallet);
 if(extra.length&&(typeof value.submissionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.submissionId)))reject('SUBMISSION_ID_INVALID');
 return value;
}
export function adminRequest(value){
 const fields={pause:['action'],resume:['action'],advanceThreeDays:['action'],advance:['action','seconds'],reset:['action'],rotateSigner:['action'],changeRecipient:['action']};
 if(!fields[value?.action])reject('ACTION_INVALID');exact(value,fields[value.action]);
 if(value.action==='advance'&&(!Number.isSafeInteger(value.seconds)||value.seconds<1||value.seconds>259201))reject('TIME_DELTA_INVALID');
 return value;
}
export function equalJSON(a,b){try{return canonicalJSON(a)===canonicalJSON(b);}catch{return false;}}
