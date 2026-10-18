export type ResearchMessage={type:'ember-aimarket:ready'|'ember-aimarket:login-required'|'ember-aimarket:request-access'|'ember-aimarket:close';version:1}|{type:'ember-aimarket:access';version:1;eligible:boolean};
export function researchSessionChanged(previous:string|null,current:string|null){return previous!==null&&previous!==current;}
/** Frame messages affect presentation only. Server-held identity and holdings remain authoritative. */
export function researchMessage(data:unknown,origin:string,expectedOrigin:string,source:unknown,expectedSource:unknown):ResearchMessage|null{
 if(origin!==expectedOrigin||!expectedSource||source!==expectedSource||!data||typeof data!=='object'||Array.isArray(data))return null;
 const value=data as Record<string,unknown>;
 if(value.version!==1)return null;
 if(['ember-aimarket:ready','ember-aimarket:login-required','ember-aimarket:request-access','ember-aimarket:close'].includes(String(value.type))&&Object.keys(value).length===2)return value as ResearchMessage;
 return value.type==='ember-aimarket:access'&&typeof value.eligible==='boolean'&&Object.keys(value).length===3?value as ResearchMessage:null;
}
