import {economySessionClock,readEconomySession,revalidateEconomySession} from './economy-session.ts';
import {API_HEADERS} from './world-api.ts';
import type {D1Database} from './d1.ts';
import type {HomeView} from './ownership.ts';
import {INVENTORY_CATALOGUE,GAME_NFT_COLLECTIONS} from './inventory-catalogue.ts';
import {emptyArrangement,inventoryCommand,INVENTORY_SLOTS,type InventoryArrangement,type InventoryDefinition,type InventoryItem,type InventorySnapshot} from '../src/world/inventory.ts';

type Deps={db?:D1Database;now?:()=>number;allow:()=>Promise<boolean>;home:(wallet:string,fresh:boolean)=>Promise<HomeView>;catalogue?:readonly InventoryDefinition[]};
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,ITEM=/^i_[a-z0-9_-]{1,96}$/;
const json=(status:number,v:unknown)=>new Response(JSON.stringify(v),{status,headers:API_HEADERS});
const liveSql='SELECT 1 FROM sessions WHERE token_hash=? AND address=? AND expires_at>? AND revoked_at IS NULL AND wallet_type=\'EOA\' AND verification_method=\'ECDSA\'';
function clockSample(clock:()=>number,minimum:number){const n=clock();if(!Number.isSafeInteger(n)||n<=0||n<minimum)throw Error('INVALID_CLOCK');return n;}
async function ready(db:D1Database){const r=await db.prepare("SELECT name,type FROM sqlite_master WHERE name IN ('world_inventory_items','world_inventory_arrangements','world_inventory_active')").all<{name:string;type:string}>();if(!['world_inventory_items','world_inventory_arrangements'].every(n=>r.results.some(x=>x.name===n&&x.type==='table'))||!r.results.some(x=>x.name==='world_inventory_active'&&x.type==='index'))throw Error('INVENTORY_UNAVAILABLE');}
function arrangement(raw:string):InventoryArrangement{
  const a=JSON.parse(raw),empty=emptyArrangement();
  if(!a||typeof a!=='object'||typeof a.published!=='boolean'||!a.equipment||!a.displays)throw Error('INVENTORY_UNAVAILABLE');
  for(const [key,slots]of [['equipment',Object.keys(empty.equipment)],['displays',Object.keys(empty.displays)]] as const){
    if(Object.keys(a[key]).sort().join()!==[...slots].sort().join()||slots.some(s=>a[key][s]!==null&&(typeof a[key][s]!=='string'||!ITEM.test(a[key][s]))))throw Error('INVENTORY_UNAVAILABLE');
  }
  return {equipment:a.equipment,displays:a.displays,published:a.published};
}
async function read(db:D1Database,wallet:string,catalogue:readonly InventoryDefinition[]){
  const [row,held]=await Promise.all([
    db.prepare('SELECT revision,arrangement_json FROM world_inventory_arrangements WHERE wallet=?').bind(wallet).first<{revision:number;arrangement_json:string}>(),
    db.prepare('SELECT item_id,definition_id,source_id,acquired_ms FROM world_inventory_items WHERE wallet=? AND revoked_ms IS NULL ORDER BY item_id LIMIT 1001').bind(wallet).all<{item_id:string;definition_id:string;source_id:string;acquired_ms:number}>(),
  ]);
  if(held.results.length>1000)throw Error('INVENTORY_CAPACITY');
  const definitions=new Map(catalogue.filter(d=>d.kind!=='nft').map(d=>[d.id,d])); // Empty whitelist means no NFT inference, including from DB rows.
  const items:InventoryItem[]=held.results.flatMap(i=>{const definition=definitions.get(i.definition_id);return definition&&ITEM.test(i.item_id)?[{id:i.item_id,definition,source:i.source_id,acquiredAt:i.acquired_ms}]:[];});
  const state=row?arrangement(row.arrangement_json):emptyArrangement(),ids=new Map(items.map(i=>[i.id,i]));
  for(const slot of ['weapon','armor','tool'] as const)if(ids.get(state.equipment[slot]??'')?.definition.kind!==slot)state.equipment[slot]=null;
  for(const slot of INVENTORY_SLOTS)if(ids.get(state.displays[slot.id]??'')?.definition.kind!==slot.kind)state.displays[slot.id]=null;
  return {...state,revision:row?.revision??0,items};
}
async function homeState(deps:Deps,wallet:string,fresh:boolean,at:number){
  try{const h=await deps.home(wallet,fresh),now=clockSample(deps.now??Date.now,at);
    if(h.address.toLowerCase()!==wallet||!Number.isSafeInteger(h.checkedAt)||h.checkedAt>now||now-h.checkedAt>=30000||!Number.isSafeInteger(h.block)||h.block===null||h.block<0||!Number.isSafeInteger(h.eligible)||h.eligible<0)throw Error();
    if(h.eligible>0&&h.size&&['s','ms','m','l','xl'].includes(h.size))return {state:'eligible' as const,size:h.size,checkedAt:h.checkedAt};
    if(h.recheck)return {state:'unavailable' as const,size:null,checkedAt:0};
    return {state:'none' as const,size:null,checkedAt:h.checkedAt};
  }catch{return {state:'unavailable' as const,size:null,checkedAt:0};}
}
async function body(request:Request){
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||!request.body)throw Error('BAD_REQUEST');
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>2048){await reader.cancel();throw Error('BAD_REQUEST');}raw+=decoder.decode(chunk.value,{stream:true});}raw+=decoder.decode();}finally{reader.releaseLock();}
  const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw Error('BAD_REQUEST');return b as Record<string,unknown>;
}
/** Real World-session inventory. No synthetic identities, self-grants, NFT
 * scans, payments, or game-result assertions are exposed by these routes. */
export async function handleInventoryApi(request:Request,deps:Deps):Promise<Response|null>{
  const url=new URL(request.url),own=url.pathname==='/api/me/inventory',publicMatch=/^\/api\/world\/collections\/(0x[0-9a-fA-F]{40})$/.exec(url.pathname);
  if(!own&&!publicMatch)return null;
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site'),local=url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname),write=request.method==='POST';
  if((url.origin!=='https://imdember.com'&&!local)||(origin!==null&&origin!==url.origin)||(site!==null&&!['same-origin','none'].includes(site)))return json(403,{error:'FORBIDDEN_ORIGIN'});
  if(request.method!=='GET'&&(!write||!own))return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(write&&(origin!==url.origin||url.search))return json(403,{error:'FORBIDDEN_ORIGIN'});
  if(!deps.db)return json(503,{error:'INVENTORY_UNAVAILABLE'});
  try{
    const db=deps.db,clock=economySessionClock(deps.now??Date.now),start=clockSample(clock,0);
    deps={...deps,now:clock};
    if(!await deps.allow())return json(429,{error:'RATE_LIMITED'});
    await ready(db);
    if(publicMatch){
      if(url.search)return json(400,{error:'BAD_REQUEST'});
      const wallet=publicMatch[1].toLowerCase();let state=await read(db,wallet,deps.catalogue??INVENTORY_CATALOGUE);
      if(!state.published)return json(200,{visible:false,displays:[]});
      const home=await homeState(deps,wallet,false,start);
      if(home.state==='unavailable')return json(503,{error:'HOME_UNAVAILABLE'});
      if(home.state!=='eligible')return json(200,{visible:false,displays:[]});
      state=await read(db,wallet,deps.catalogue??INVENTORY_CATALOGUE);
      if(!state.published)return json(200,{visible:false,displays:[]});
      const displays=INVENTORY_SLOTS.flatMap(slot=>{const item=state.items.find(i=>i.id===state.displays[slot.id]);return item?[{slot:slot.id,title:item.definition.title,kind:item.definition.kind,color:item.definition.color}]:[];});
      // Visitors receive no inventory ids, provenance, equipment or financial data.
      return json(200,{visible:true,displays});
    }
    const b=write?await body(request):null,expected=write?b?.expectedAddress:url.searchParams.get('expected_address');
    if(typeof expected!=='string'||!ADDRESS.test(expected)||!write&&(url.searchParams.size!==1||url.search.length>128))return json(400,{error:'BAD_REQUEST'});
    if(write&&Object.keys(b!).sort().join()!=='command,expectedAddress,revision')return json(400,{error:'BAD_REQUEST'});
    const session=await readEconomySession(request,db,clock);if(typeof session==='string')return json(401,{error:'AUTH_REQUIRED'});
    const wallet=session.address.toLowerCase();if(wallet!==expected.toLowerCase())return json(409,{error:'ACCOUNT_CONTEXT_CHANGED'});
    if(write&&(session.walletType!=='EOA'||session.verificationMethod!=='ECDSA'))return json(403,{error:'EOA_REQUIRED'});
    const home=await homeState(deps,wallet,write,start),state=await read(db,wallet,deps.catalogue??INVENTORY_CATALOGUE);
    if(write){
      if(!Number.isSafeInteger(b!.revision)||b!.revision!==state.revision)return json(409,{error:'REVISION_CONFLICT'});
      const command=inventoryCommand(b!.command);
      if((command.type==='display'||command.type==='publish'&&command.enabled)&&home.state!=='eligible')return json(403,{error:home.state==='none'?'HOME_REQUIRED':'HOME_UNAVAILABLE'});
      const next:InventoryArrangement={equipment:{...state.equipment},displays:{...state.displays},published:state.published};
      if(command.type==='publish')next.published=command.enabled;
      else{
        const item=command.itemId===null?null:state.items.find(i=>i.id===command.itemId),kind=command.type==='equip'?command.slot:INVENTORY_SLOTS.find(s=>s.id===command.slot)!.kind;
        if(command.itemId!==null&&(!item||item.definition.kind!==kind))return json(409,{error:'ITEM_NOT_AVAILABLE'});
        if(command.type==='equip')next.equipment[command.slot]=command.itemId;
        else{if(command.itemId)for(const slot of INVENTORY_SLOTS)if(next.displays[slot.id]===command.itemId)next.displays[slot.id]=null;next.displays[command.slot]=command.itemId;}
      }
      const at=clockSample(clock,start),needsHome=command.type==='display'||command.type==='publish'&&command.enabled;
      if(needsHome&&at-home.checkedAt>=30000)return json(403,{error:'HOME_UNAVAILABLE'});
      const auth=[session.tokenHash,wallet,at];
      const result=await db.batch([
        db.prepare(`INSERT OR IGNORE INTO world_inventory_arrangements(wallet,revision,arrangement_json,updated_ms) SELECT ?,0,?,? WHERE EXISTS (${liveSql})`).bind(wallet,JSON.stringify(emptyArrangement()),at,...auth),
        db.prepare(`UPDATE world_inventory_arrangements SET revision=revision+1,arrangement_json=?,updated_ms=? WHERE wallet=? AND revision=? AND EXISTS (${liveSql}) AND (?=0 OR ? > ?-30000) AND NOT EXISTS (SELECT 1 FROM world_inventory_items WHERE wallet=? AND item_id IN (SELECT value FROM json_each(?) UNION SELECT value FROM json_each(?)) AND revoked_ms IS NOT NULL)`).bind(JSON.stringify(next),at,wallet,state.revision,...auth,needsHome?1:0,home.checkedAt,at,wallet,JSON.stringify(next.equipment),JSON.stringify(next.displays)),
      ]);
      if(result[1].meta.changes!==1){
        if(!await revalidateEconomySession(request,db,session,clock))return json(401,{error:'AUTH_REQUIRED'});
        return json(409,{error:'REVISION_CONFLICT'});
      }
      Object.assign(state,next,{revision:state.revision+1});
    }
    if(!await revalidateEconomySession(request,db,session,clock))return json(401,{error:'AUTH_REQUIRED'});
    const snapshot:InventorySnapshot={...state,wallet,home:{state:home.state,size:home.size},nftCollections:GAME_NFT_COLLECTIONS};
    return json(200,snapshot);
  }catch(e){const code=e instanceof Error?e.message:'';return json(['BAD_REQUEST','INVALID_COMMAND'].includes(code)?400:503,{error:['BAD_REQUEST','INVALID_COMMAND','INVENTORY_CAPACITY'].includes(code)?code:'INVENTORY_UNAVAILABLE'});}
}
