import {getAddress,ZeroAddress,keccak256,toUtf8Bytes,TypedDataEncoder,verifyTypedData} from '../vendor/ethers.min.js';
import {appearanceIdentity} from './catalogue.mjs';
import {assertObjectFields,assertEquivalentJSON} from './json.mjs';
export const APPROVAL_FIELDS=['selection','canonical','key','catalogueVersion','scope','wallet','uri','deadline','signer','signerEpoch','domain','value','digest','signature','status'];
export const TYPES={Appearance:[{name:'wallet',type:'address'},{name:'key',type:'bytes32'},{name:'uriHash',type:'bytes32'},{name:'deadline',type:'uint256'},{name:'signerEpoch',type:'uint256'}]};
export const ACCEPTANCE_TYPES={SignerAcceptance:[{name:'signer',type:'address'},{name:'signerEpoch',type:'uint256'},{name:'proposalNonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
export function address(value){const out=getAddress(value);if(out===ZeroAddress)throw Error('ZERO_ADDRESS');return out.toLowerCase();}
export function domain(contract){return {name:'EmberEvoGenesisCandidate',version:'4',chainId:31337,verifyingContract:address(contract)};}
function integer(n,label){if(!Number.isSafeInteger(n)||n<1)throw Error(label);return n;}
export function recipeURI(key,revision=1){if(!/^0x[0-9a-f]{64}$/.test(key))throw Error('KEY_INVALID');return 'urn:emberevo:local:recipe:'+key+':r'+integer(revision,'REVISION_INVALID');}
export function buildApproval({wallet,look,contract,signer,signerEpoch,now,ttl=300,usedKeys=[]}){
 integer(now,'TIME_INVALID');integer(signerEpoch,'EPOCH_INVALID');integer(ttl,'TTL_INVALID');if(ttl>3600)throw Error('TTL_TOO_LONG');
 const identity=appearanceIdentity(look);if(usedKeys.includes(identity.key))throw Error('APPEARANCE_ALREADY_MINTED');
 const uri=recipeURI(identity.key),deadline=integer(now+ttl,'DEADLINE_INVALID'),approvalDomain=domain(contract);
 const value={wallet:address(wallet),key:identity.key,uriHash:keccak256(toUtf8Bytes(uri)),deadline,signerEpoch};
 return {...identity,wallet:value.wallet,uri,deadline,signer:address(signer),signerEpoch,domain:approvalDomain,value,
  digest:TypedDataEncoder.hash(approvalDomain,TYPES,value),signature:null,status:'UNSIGNED_LOCAL_MOCK'};
}
export function validateApproval(p,ctx){
 if(!p)throw Error('LOCAL_APPROVAL_REQUIRED');
 assertObjectFields(p,APPROVAL_FIELDS,'APPROVAL_SCHEMA_INVALID');
 if(p.status!=='UNSIGNED_LOCAL_MOCK'||p.signature!==null)throw Error('LOCAL_APPROVAL_REQUIRED');
 const identity=appearanceIdentity(p.selection);
 if(p.key!==identity.key||p.canonical!==identity.canonical||p.catalogueVersion!==identity.catalogueVersion||p.scope!==identity.scope)throw Error('LOOK_CHANGED');
 if(p.wallet!==address(ctx.wallet))throw Error('WALLET_CHANGED');
 if(p.signer!==address(ctx.signer)||p.signerEpoch!==ctx.signerEpoch)throw Error('AUTHORITY_CHANGED');
 if(!Number.isSafeInteger(ctx.now)||!Number.isSafeInteger(p.deadline)||ctx.now>p.deadline)throw Error('APPROVAL_EXPIRED');
 if(p.uri!==recipeURI(identity.key))throw Error('URI_CHANGED');
 const rebuilt=buildApproval({wallet:p.wallet,look:p.selection,contract:ctx.contract,signer:ctx.signer,signerEpoch:ctx.signerEpoch,now:p.deadline-1,ttl:1});
 assertEquivalentJSON(p.domain,rebuilt.domain,'APPROVAL_BINDING_CHANGED');
 assertEquivalentJSON(p.value,rebuilt.value,'APPROVAL_BINDING_CHANGED');
 if(p.digest!==rebuilt.digest)throw Error('APPROVAL_BINDING_CHANGED');
 if(ctx.usedKeys.includes(p.key))throw Error('APPEARANCE_ALREADY_MINTED');
 if(ctx.paused)throw Error('MINT_PAUSED');
 return true;
}
// Only native tests call this with a public TEST authority; no production signing service.
export async function signForLocalEvm(p,testAuthority){
 if(p.status!=='UNSIGNED_LOCAL_MOCK'||p.signature!==null||p.domain.chainId!==31337||address(testAuthority.address)!==p.signer)throw Error('LOCAL_SIGNER_REQUIRED');
 validateApproval(p,{wallet:p.wallet,signer:p.signer,signerEpoch:p.signerEpoch,contract:p.domain.verifyingContract,now:p.deadline,usedKeys:[],paused:false});
 const signature=await testAuthority.signTypedData(p.domain,TYPES,p.value);
 if(address(verifyTypedData(p.domain,TYPES,p.value,signature))!==p.signer)throw Error('LOCAL_SIGNATURE_INVALID');
 return {key:p.key,uri:p.uri,deadline:p.deadline,signature,scope:'LOCAL_EDR_TEST_ONLY'};
}
