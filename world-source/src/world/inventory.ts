import type {HouseSize} from './houseSize.ts';

export type InventoryKind='weapon'|'armor'|'tool'|'trophy'|'nft';
export type EquipmentSlot='weapon'|'armor'|'tool';
export const INVENTORY_SLOTS=[
  {id:'trophy-1',kind:'trophy',zh:'上層左・戰利品',en:'Upper left · trophy'},
  {id:'trophy-2',kind:'trophy',zh:'上層右・戰利品',en:'Upper right · trophy'},
  {id:'weapon-1',kind:'weapon',zh:'中層左・武器',en:'Middle left · weapon'},
  {id:'weapon-2',kind:'weapon',zh:'中層右・武器',en:'Middle right · weapon'},
  {id:'armor-1',kind:'armor',zh:'下層左・護甲',en:'Lower left · armor'},
  {id:'nft-1',kind:'nft',zh:'下層右・NFT 畫框',en:'Lower right · NFT frame'},
] as const;
export type InventorySlot=typeof INVENTORY_SLOTS[number]['id'];
export type InventoryDefinition={id:string;kind:InventoryKind;title:{zh:string;en:string};description:{zh:string;en:string};color:string};
export type InventoryItem={id:string;definition:InventoryDefinition;source:string;acquiredAt:number};
export type InventoryArrangement={equipment:Record<EquipmentSlot,string|null>;displays:Record<InventorySlot,string|null>;published:boolean};
export type InventorySnapshot=InventoryArrangement&{wallet:string;revision:number;items:InventoryItem[];home:{state:'eligible'|'none'|'unavailable';size:HouseSize|null};nftCollections:readonly unknown[]};
export type InventoryCommand={type:'equip';slot:EquipmentSlot;itemId:string|null}|{type:'display';slot:InventorySlot;itemId:string|null}|{type:'publish';enabled:boolean};
export function emptyArrangement():InventoryArrangement{return {equipment:{weapon:null,armor:null,tool:null},displays:{'trophy-1':null,'trophy-2':null,'weapon-1':null,'weapon-2':null,'armor-1':null,'nft-1':null},published:false};}

export function inventoryCommand(v:unknown):InventoryCommand{
  if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_COMMAND');
  const o=v as Record<string,unknown>,keys=Object.keys(o).sort().join(',');
  if(o.type==='publish'&&keys==='enabled,type'&&typeof o.enabled==='boolean')return {type:'publish',enabled:o.enabled};
  if(keys!=='itemId,slot,type'||o.itemId!==null&&(typeof o.itemId!=='string'||!/^i_[a-z0-9_-]{1,96}$/.test(o.itemId)))throw Error('INVALID_COMMAND');
  if(o.type==='equip'&&['weapon','armor','tool'].includes(String(o.slot)))return o as InventoryCommand;
  if(o.type==='display'&&INVENTORY_SLOTS.some(s=>s.id===o.slot))return o as InventoryCommand;
  throw Error('INVALID_COMMAND');
}
