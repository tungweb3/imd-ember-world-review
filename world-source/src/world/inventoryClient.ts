import type {AuthState} from './auth.ts';
import {economySession} from './economyClient.ts';
import {emptyArrangement,inventoryCommand,INVENTORY_SLOTS,type InventoryCommand,type InventorySnapshot} from './inventory.ts';

const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function parseInventory(value:unknown,wallet:string):InventorySnapshot{
  if(!object(value)||value.wallet!==wallet||!Number.isSafeInteger(value.revision)||Number(value.revision)<0||!Array.isArray(value.items)||value.items.length>1000||!object(value.home)||!['eligible','none','unavailable'].includes(String(value.home.state))||!(value.home.size===null||['s','ms','m','l','xl'].includes(String(value.home.size)))||!Array.isArray(value.nftCollections)||value.nftCollections.length!==0||typeof value.published!=='boolean')throw Error('INVALID_RESPONSE');
  const empty=emptyArrangement();
  for(const k of ['equipment','displays'] as const){const v=value[k];if(!object(v)||Object.keys(v).sort().join()!==Object.keys(empty[k]).sort().join()||Object.values(v).some(x=>x!==null&&(typeof x!=='string'||!/^i_[a-z0-9_-]{1,96}$/.test(x))))throw Error('INVALID_RESPONSE');}
  const ids=new Set<string>();
  for(const item of value.items){
    if(!object(item)||typeof item.id!=='string'||!/^i_[a-z0-9_-]{1,96}$/.test(item.id)||ids.has(item.id)||typeof item.source!=='string'||item.source.length>256||!Number.isSafeInteger(item.acquiredAt)||Number(item.acquiredAt)<=0||!object(item.definition))throw Error('INVALID_RESPONSE');
    const d=item.definition;if(!['weapon','armor','tool','trophy'].includes(String(d.kind))||typeof d.id!=='string'||typeof d.color!=='string'||!/^#[0-9a-f]{6}$/i.test(d.color)||!object(d.title)||!object(d.description)||[d.title.zh,d.title.en,d.description.zh,d.description.en].some(s=>typeof s!=='string'||s.length>1000))throw Error('INVALID_RESPONSE');ids.add(item.id);
  }
  for(const [slot,id]of Object.entries(value.equipment as Record<string,string|null>))if(id!==null&&!value.items.some(i=>i.id===id&&i.definition.kind===slot))throw Error('INVALID_RESPONSE');
  for(const slot of INVENTORY_SLOTS){const id=(value.displays as Record<string,string|null>)[slot.id];if(id!==null&&!value.items.some(i=>i.id===id&&i.definition.kind===slot.kind))throw Error('INVALID_RESPONSE');}
  return value as unknown as InventorySnapshot;
}
export class InventoryClient{
  private deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number};
  constructor(deps:{auth:()=>AuthState;fetch?:typeof fetch;now?:()=>number}){this.deps=deps;}
  identity(){const s=economySession(this.deps.auth(),this.deps.now?.()??Date.now());return s?s.address.toLowerCase()+':'+s.expiresAt:null;}
  private async request(command:InventoryCommand|undefined,revision:number|undefined,signal?:AbortSignal){
    const key=this.identity();if(!key)throw Error('AUTH_REQUIRED');const wallet=key.split(':')[0],transport=this.deps.fetch??fetch;
    const r=await transport('/api/me/inventory'+(command?'':'?expected_address='+wallet),{credentials:'same-origin',cache:'no-store',signal,...command?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedAddress:wallet,revision,command:inventoryCommand(command)})}:{}});
    const data=await r.json();if(signal?.aborted||this.identity()!==key)throw Error('ACCOUNT_CONTEXT_CHANGED');
    if(!r.ok)throw Error(object(data)&&typeof data.error==='string'?data.error:'INVENTORY_UNAVAILABLE');
    return parseInventory(data,wallet);
  }
  state(signal?:AbortSignal){return this.request(undefined,undefined,signal);}
  command(revision:number,command:InventoryCommand,signal?:AbortSignal){return this.request(command,revision,signal);}
}
