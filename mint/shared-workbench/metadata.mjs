import {appearanceIdentity} from './catalogue.mjs';
import {bodies} from './catalogue.mjs';
import {clothing} from './appearance.mjs';
import {displayName} from './policy.mjs';
import {recipeURI} from './approval.mjs';
import {assertObjectFields,assertEquivalentJSON} from './json.mjs';
const description='Ember Evo Genesis 本機資料演練；3D 圖像及正式模型尚待交付。';
export function buildMetadata(record,revision=1){
 const name=displayName(record.id),identity=appearanceIdentity(record.selection);
 if(record.key!==identity.key||!Number.isSafeInteger(revision)||revision<1)throw Error('METADATA_IDENTITY_INVALID');
 const attributes=[{trait_type:'Body',value:bodies.find(b=>b.id===record.selection.body).name},{trait_type:'Skin',value:'Green'},
  ...clothing.map(slot=>({trait_type:slot.name,value:slot.options.find(o=>o.id===record.selection[slot.id]).name}))];
 return {name,description,image:null,animation_url:null,attributes,properties:{scope:'LOCAL_METADATA_PREVIEW_ONLY',
  tokenId:record.id,appearanceKey:identity.key,catalogueVersion:identity.catalogueVersion,selection:identity.selection,
  metadataRevision:revision,recipeURI:recipeURI(identity.key,revision),modelStatus:'TBD',rarity:false}};
}
export function verifyMetadata(metadata,record){
 assertObjectFields(metadata,['name','description','image','animation_url','attributes','properties'],'METADATA_CHANGED');
 assertObjectFields(metadata.properties,['scope','tokenId','appearanceKey','catalogueVersion','selection','metadataRevision','recipeURI','modelStatus','rarity'],'METADATA_CHANGED');
 const expected=buildMetadata(record,metadata?.properties?.metadataRevision);
 assertEquivalentJSON(metadata,expected,'METADATA_CHANGED');
 return true;
}
