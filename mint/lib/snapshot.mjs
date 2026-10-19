import {AbiCoder,getAddress,keccak256,concat,sha256,toUtf8Bytes,ZeroHash,version} from '../vendor/ethers.min.js';
import {MAX_SUPPLY} from './policy.mjs';
import {parseStrictJSON,canonicalJSON,jsonByteLength} from './json.mjs';
if(version!=='6.15.0')throw Error('CRYPTO_VERSION_MISMATCH');
export const SNAPSHOT_SCOPE='LOCAL_SYNTHETIC_TEST_ONLY';
export const ALGORITHM='sorted-pairs-odd-promote-v1';
export const MAX_INPUT_BYTES=1048576,MAX_BUNDLE_BYTES=8388608;
const coder=AbiCoder.defaultAbiCoder(),hashPattern=/^0x[0-9a-f]{64}$/;
const digest=value=>sha256(toUtf8Bytes(JSON.stringify(value)));
const fail=(code,detail='')=>{const error=Error(code);error.detail=detail;throw error;};
export function normalizeWallet(wallet){
 if(typeof wallet!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(wallet))fail('WALLET_INVALID');
 let result;try{result=getAddress(wallet);}catch{fail('WALLET_CHECKSUM_INVALID');}
 if(/^0x0{40}$/i.test(result))fail('ZERO_WALLET');return result.toLowerCase();
}
export const walletLeaf=wallet=>keccak256(keccak256(coder.encode(['address'],[normalizeWallet(wallet)])));
const pair=(a,b)=>keccak256(concat([a,b].sort()));
function csvRecords(source){
 const records=[];let fields=[],value='',state='start';
 const field=()=>{fields.push(state==='unquoted'?value.trim():value);value='';state='start';};
 const record=()=>{field();if(fields.length!==1||fields[0]!=='')records.push(fields);fields=[];};
 for(let i=0;i<source.length;i++){
  const character=source[i];
  if(state==='quoted'){
   if(character==='"'){if(source[i+1]==='"'){value+='"';i++;}else state='closed';}else value+=character;
   continue;
  }
  if(character===','){field();continue;}
  if(character==='\n'||character==='\r'){
   if(character==='\r'){if(source[i+1]!=='\n')fail('CSV_ROW_INVALID');i++;}
   record();continue;
  }
  if(state==='closed')fail('CSV_QUOTE_INVALID');
  if(character==='"'){if(state!=='start')fail('CSV_QUOTE_INVALID');state='quoted';}
  else {state='unquoted';value+=character;}
 }
 if(state==='quoted')fail('CSV_QUOTE_INVALID');record();return records;
}
export function parseSnapshotInput(text,format='json'){
 if(typeof text!=='string'||jsonByteLength(text)>MAX_INPUT_BYTES)fail('INPUT_TOO_LARGE');
 const source=text.replace(/^\uFEFF/,'');if(!source.trim())fail('INPUT_EMPTY');
 if(format==='json'){
  const parsed=parseStrictJSON(source);
  if(Array.isArray(parsed))return parsed;
  if(!parsed||parsed.scope!==SNAPSHOT_SCOPE||!Array.isArray(parsed.rows)||Object.keys(parsed).some(k=>!['scope','rows'].includes(k)))fail('INPUT_SCHEMA_INVALID');
  return parsed.rows;
 }
 if(format!=='csv')fail('FORMAT_INVALID');
 const lines=csvRecords(source),header=lines.shift();
 if(!header||header.length!==2||header[0]!=='wallet'||header[1]!=='activeAgentCount')fail('CSV_HEADER_INVALID');
 return lines.map((fields,index)=>{if(fields.length!==2||!/^\d+$/.test(fields[1]))fail('CSV_ROW_INVALID',String(index+2));return {wallet:fields[0],activeAgentCount:Number(fields[1])};});
}
export function parseSnapshotBundle(text){
 if(typeof text!=='string'||jsonByteLength(text)>MAX_BUNDLE_BYTES)fail('BUNDLE_TOO_LARGE');
 const bundle=parseStrictJSON(text.replace(/^\uFEFF/,''));verifySnapshot(bundle);return bundle;
}
function exactKeys(value,keys){
 return value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value))&&Object.keys(value).length===keys.length&&Object.keys(value).every(key=>keys.includes(key));
}
export function normalizeRows(rows){
 if(!Array.isArray(rows)||rows.length>10000)fail('ROW_LIMIT');
 const byWallet=new Map();let duplicates=0;
 for(let index=0;index<rows.length;index++){
  const row=rows[index];if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!=='activeAgentCount,wallet')fail('ROW_SCHEMA_INVALID',String(index+1));
  const wallet=normalizeWallet(row.wallet),count=row.activeAgentCount;
  if(!Number.isSafeInteger(count)||count<0)fail('ACTIVE_AGENT_COUNT_INVALID',String(index+1));
  if(byWallet.has(wallet)){if(byWallet.get(wallet)!==count)fail('DUPLICATE_CONFLICT',wallet);duplicates++;}else byWallet.set(wallet,count);
 }
 const normalized=[...byWallet].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([wallet,activeAgentCount])=>({wallet,activeAgentCount}));
 const eligible=normalized.filter(row=>row.activeAgentCount>=1).map(row=>row.wallet);
 if(eligible.length>MAX_SUPPLY)fail('FREE_ELIGIBILITY_EXCEEDS_2222');
 return {rows:normalized,eligible,counts:{inputRows:rows.length,uniqueWallets:normalized.length,duplicateRowsRemoved:duplicates,eligibleWalletCount:eligible.length,excludedWalletCount:normalized.length-eligible.length}};
}
export function buildMerkle(wallets){
 if(!Array.isArray(wallets)||wallets.length>MAX_SUPPLY)fail('MERKLE_INPUT_INVALID');
 const canonical=wallets.map(normalizeWallet);if(new Set(canonical).size!==canonical.length)fail('MERKLE_DUPLICATE');canonical.sort();
 const leaves=canonical.map(walletLeaf),layers=[leaves];
 while(layers.at(-1).length>1){const prev=layers.at(-1),next=[];for(let i=0;i<prev.length;i+=2)next.push(i+1<prev.length?pair(prev[i],prev[i+1]):prev[i]);layers.push(next);}
 const root=leaves.length?layers.at(-1)[0]:ZeroHash;
 const entries=canonical.map((wallet,index)=>{let cursor=index;const proof=[];for(let depth=0;depth<layers.length-1;depth++){const sibling=cursor^1;if(sibling<layers[depth].length)proof.push(layers[depth][sibling]);cursor=Math.floor(cursor/2);}return {wallet,leaf:leaves[index],proof,freeMintLimit:1};});
 return {root,entries};
}
export function verifyWalletProof(wallet,proof,root){
 try{if(!hashPattern.test(root)||!Array.isArray(proof)||proof.length>32||proof.some(h=>typeof h!=='string'||!hashPattern.test(h)))return false;let result=walletLeaf(wallet);for(const hash of proof)result=pair(result,hash);return result===root;}catch{return false;}
}
export function buildSnapshot(rows){
 const normalized=normalizeRows(rows),tree=buildMerkle(normalized.eligible);
 const sourceRows=rows.map(row=>({wallet:normalizeWallet(row.wallet),activeAgentCount:row.activeAgentCount}));
 return {schemaVersion:1,scope:SNAPSHOT_SCOPE,sourceVerified:false,snapshotAt:null,snapshotBlock:null,freeStartAt:null,algorithm:ALGORITHM,
  sourceRows,inputSha256:digest(sourceRows),rows:normalized.rows,counts:normalized.counts,normalizedSha256:digest(normalized.rows),root:tree.root,proofs:tree.entries};
}
export function verifySnapshot(bundle){
 if(!bundle||bundle.schemaVersion!==1||bundle.scope!==SNAPSHOT_SCOPE||bundle.sourceVerified!==false||bundle.algorithm!==ALGORITHM)fail('BUNDLE_SCOPE_INVALID');
 const keys=['schemaVersion','scope','sourceVerified','snapshotAt','snapshotBlock','freeStartAt','algorithm','sourceRows','inputSha256','rows','counts','normalizedSha256','root','proofs'];
 if(!exactKeys(bundle,keys))fail('BUNDLE_SCHEMA_INVALID');
 if(bundle.snapshotAt!==null||bundle.snapshotBlock!==null||bundle.freeStartAt!==null)fail('FORMAL_DATES_MUST_REMAIN_TBD');
 const expected=buildSnapshot(bundle.sourceRows);
 if(!Array.isArray(bundle.rows)||bundle.rows.length!==expected.rows.length||bundle.rows.some(row=>!exactKeys(row,['wallet','activeAgentCount']))||expected.rows.some((row,i)=>row.wallet!==bundle.rows[i]?.wallet||row.activeAgentCount!==bundle.rows[i]?.activeAgentCount))fail('ROWS_NOT_CANONICAL');
 if(expected.inputSha256!==bundle.inputSha256)fail('INPUT_DATA_CHANGED');
 if(expected.normalizedSha256!==bundle.normalizedSha256)fail('NORMALIZED_DATA_CHANGED');
 if(expected.root!==bundle.root)fail('ROOT_MISMATCH');
 if(!exactKeys(bundle.counts,Object.keys(expected.counts))||expected.counts.eligibleWalletCount!==bundle.counts.eligibleWalletCount||expected.counts.uniqueWallets!==bundle.counts.uniqueWallets||expected.counts.excludedWalletCount!==bundle.counts.excludedWalletCount)fail('COUNT_MISMATCH');
 if(!Number.isSafeInteger(bundle.counts.inputRows)||!Number.isSafeInteger(bundle.counts.duplicateRowsRemoved)||bundle.counts.duplicateRowsRemoved<0||bundle.counts.inputRows!==bundle.counts.uniqueWallets+bundle.counts.duplicateRowsRemoved||bundle.counts.inputRows>10000)fail('INPUT_COUNT_MISMATCH');
 if(expected.counts.inputRows!==bundle.counts.inputRows||expected.counts.duplicateRowsRemoved!==bundle.counts.duplicateRowsRemoved)fail('INPUT_COUNT_MISMATCH');
 if(!Array.isArray(bundle.proofs)||bundle.proofs.some(entry=>!exactKeys(entry,['wallet','leaf','proof','freeMintLimit']))||canonicalJSON(expected.proofs)!==canonicalJSON(bundle.proofs))fail('PROOF_MISMATCH');
 for(const entry of bundle.proofs)if(!verifyWalletProof(entry.wallet,entry.proof,bundle.root))fail('PROOF_INVALID');
 return true;
}
export function eligibleCsv(bundle){verifySnapshot(bundle);return 'wallet,freeMintLimit\n'+bundle.proofs.map(p=>p.wallet+',1').join('\n')+'\n';}
