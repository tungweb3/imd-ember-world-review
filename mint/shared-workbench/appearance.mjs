// Small concept shelf, NOT a frozen production catalogue or approved 3D inventory.
export const FIXED_SKIN = 'green';
const item = (id, name, image, crop, extra = {}) => ({id, name, image, crop, ...extra});
export const clothing = [
  {id:'hat', name:'帽子', options:[
    item('none','不戴帽子','classic',[.09,.06,.22,.25]),
    item('beanie','針織毛帽','surveyor',[.10,.05,.22,.18]),
    item('captain','船長帽','captain',[.08,.04,.23,.20])]},
  {id:'top', name:'上衣', options:[
    item('tee','圓領 T 恤','classic',[.06,.32,.27,.28]),
    item('shirt','短袖工作衫','explorer',[.05,.31,.28,.31]),
    item('robe','長袍','mage',[.04,.28,.32,.51],{blocksBottom:true})]},
  {id:'bottom', name:'褲子', options:[
    item('none','不穿褲子','classic',[.07,.59,.27,.26]),
    item('shorts','反折短褲','explorer',[.08,.60,.21,.18]),
    item('cargo','工裝褲','surveyor',[.08,.57,.22,.21])]},
  {id:'shoes', name:'鞋子', options:[
    item('bare','赤腳','classic',[.07,.81,.28,.11]),
    item('sandals','皮革涼鞋','explorer',[.05,.76,.26,.13]),
    item('boots','工作靴','surveyor',[.05,.76,.29,.14])]}
];
export const initialLook = () => ({body:'standard',skin:FIXED_SKIN,hat:'none',top:'tee',bottom:'none',shoes:'bare'});
export const optionFor = (slot, id) => clothing.find(c=>c.id===slot)?.options.find(o=>o.id===id);
export const bottomBlocked = look => optionFor('top',look.top)?.blocksBottom === true;
export function assertClothingCompatibility(look) {
  if (bottomBlocked(look) && look.bottom !== 'none') throw Error('TOP_BLOCKS_BOTTOM');
}
export function selectClothing(look,slot,id) {
  if (!optionFor(slot,id)) throw Error('PREVIEW_OPTION_UNKNOWN');
  const next={...look,[slot]:id};
  if (slot==='top' && bottomBlocked(next)) next.bottom='none';
  assertClothingCompatibility(next);
  return next;
}
