import * as THREE from 'three';

/** A live list of material-bearing objects. Topology changes visit only the changed
 * subtree; timed lighting/rain updates never walk unchanged groups, labels or lights.
 * Material and geometry are read at update time, so direct swaps (including hover
 * clones), animation, and their restoration need no separate invalidation signal.
 * This borrows objects and never modifies or disposes a material or geometry. */
export class SceneMaterialIndex {
  private readonly watched=new Set<THREE.Object3D>();
  private readonly objects=new Set<THREE.Mesh|THREE.Points>();
  private ordered:(THREE.Mesh|THREE.Points)[]|null=null;
  private readonly added=(event:{child:THREE.Object3D})=>{if(this.inScene(event.child))this.enroll(event.child);};
  private readonly removed=(event:{child:THREE.Object3D})=>{if(!this.inScene(event.child))this.drop(event.child);};
  readonly scene:THREE.Scene;
  constructor(scene:THREE.Scene){this.scene=scene;this.enroll(scene);}
  private inScene(object:THREE.Object3D){for(let parent:THREE.Object3D|null=object;parent;parent=parent.parent)if(parent===this.scene)return true;return false;}
  private enroll(root:THREE.Object3D){
    root.traverse(object=>{if(this.watched.has(object))return;this.watched.add(object);
      object.addEventListener('childadded',this.added);object.addEventListener('childremoved',this.removed);
      if(object instanceof THREE.Mesh||object instanceof THREE.Points){this.objects.add(object);this.ordered=null;}});
  }
  private drop(root:THREE.Object3D){
    root.traverse(object=>{if(!this.watched.delete(object))return;
      object.removeEventListener('childadded',this.added);object.removeEventListener('childremoved',this.removed);
      if(object instanceof THREE.Mesh||object instanceof THREE.Points){this.objects.delete(object);this.ordered=null;}});
  }
  forEach(visit:(object:THREE.Mesh|THREE.Points)=>void){const list=this.ordered??=Array.from(this.objects);for(let i=0;i<list.length;i++)visit(list[i]);}
  /** Only detaches this index's listeners. Shared/source resources remain owned by their creators. */
  dispose(){for(const object of this.watched){object.removeEventListener('childadded',this.added);object.removeEventListener('childremoved',this.removed);}this.watched.clear();this.objects.clear();this.ordered=[];}
}
