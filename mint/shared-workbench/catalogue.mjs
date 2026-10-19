import {keccak256,toUtf8Bytes} from '../vendor/ethers.min.js';
import {clothing,assertClothingCompatibility,initialLook} from './appearance.mjs';
import {canonicalAppearance,MAX_SUPPLY} from './policy.mjs';
import {assertObjectFields} from './json.mjs';
export const SCOPE='LOCAL_CONCEPT_ONLY';
export const bodies=[{id:'standard',name:'標準'},{id:'stocky',name:'壯實'},{id:'elder',name:'圓潤長者'}];
export const catalogueVersion='concept-green-clothing-v1';
export function validateLook(look){
 assertObjectFields(look,['body','skin','hat','top','bottom','shoes'],'APPEARANCE_INVALID');
 canonicalAppearance(look);
 if(!bodies.some(b=>b.id===look.body))throw Error('BODY_UNKNOWN');
 for(const slot of clothing)if(!slot.options.some(item=>item.id===look[slot.id]))throw Error('ITEM_UNKNOWN');
 assertClothingCompatibility(look);
 return {body:look.body,skin:look.skin,hat:look.hat,top:look.top,bottom:look.bottom,shoes:look.shoes};
}
export function appearanceIdentity(look){
 const selection=validateLook(look),canonical=canonicalAppearance(selection);
 return {selection,canonical,key:keccak256(toUtf8Bytes(canonical)),catalogueVersion,scope:SCOPE};
}
export function catalogueReport(){
 const keys=new Set();
 for(const body of bodies)for(const hat of clothing[0].options)for(const top of clothing[1].options)
 for(const bottom of clothing[2].options)for(const shoes of clothing[3].options){
  const look={...initialLook(),body:body.id,hat:hat.id,top:top.id,bottom:bottom.id,shoes:shoes.id};
  if(top.blocksBottom&&bottom.id!=='none')continue;
  keys.add(appearanceIdentity(look).key);
 }
 return {scope:SCOPE,catalogueVersion,legalCanonicalCombinations:keys.size,targetSupply:MAX_SUPPLY,
  sufficientConceptCapacity:keys.size>=MAX_SUPPLY,productionCatalogueVerified:false,visualUniquenessVerified:false,modelCount:null};
}
