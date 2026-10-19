import * as THREE from 'three';
import {INVENTORY_SLOTS,type InventorySnapshot} from './inventory.ts';

/** Bounded static display frames for approved, actually held game items. These
 * are labels for the holding, not fabricated weapon models or ownership. */
export function inventoryDisplay(snapshot:InventorySnapshot){
  const root=new THREE.Group();root.name='world-inventory-displays';
  if(snapshot.home.state!=='eligible')return root;
  for(const slot of INVENTORY_SLOTS){
    const item=snapshot.items.find(i=>i.id===snapshot.displays[slot.id]);if(!item)continue;
    const frame=new THREE.Mesh(new THREE.BoxGeometry(.23,.25,.025),new THREE.MeshStandardMaterial({color:item.definition.color,roughness:.65}));
    const left=['trophy-1','weapon-1','armor-1'].includes(slot.id),y=slot.id.startsWith('trophy')?1.505:slot.id.startsWith('weapon')?1.185:.865;
    frame.name='inventory:'+slot.id;frame.position.set(left?-.235:.235,y,.12);root.add(frame);
  }
  return root;
}
