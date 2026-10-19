import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {handleInventoryApi} from '../server/inventory.ts';
import {INVENTORY_CATALOGUE,GAME_NFT_COLLECTIONS} from '../server/inventory-catalogue.ts';
import {InventoryClient,parseInventory} from '../src/world/inventoryClient.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {emptyArrangement,inventoryCommand} from '../src/world/inventory.ts';
const NOW=2_000_000_000_000,W='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),TOKEN='b'.repeat(43);
const definition={id:'game-cup',kind:'trophy',title:{zh:'可信戰果獎盃',en:'Verified game trophy'},description:{zh:'可信伺服器的測試憑據',en:'Trusted server test evidence'},color:'#aabbcc'};
async function fixture({files}={}){const db=openD1(files),hash=await sha256(TOKEN);db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(hash,W,1,NOW-1,NOW+60000,'inventory','EOA','ECDSA');let now=NOW,calls=0;
  const home=async(wallet)=>{calls++;return {address:wallet,seats:[],eligible:1,size:'m',block:100,checkedAt:now,presence:'fresh'};};
  return {db,hash,close:()=>db.raw.close(),time:n=>now=n,calls:()=>calls,deps:{db,now:()=>now,allow:async()=>true,home,catalogue:[definition]},grant(wallet=W,id='i_cup'){db.raw.prepare('INSERT INTO world_inventory_items(wallet,item_id,definition_id,source_id,acquired_ms) VALUES(?,?,?,?,?)').run(wallet,id,definition.id,'match:'+wallet+':'+id,NOW-10);}};
}
const request=(body,patch={})=>new Request('https://imdember.com/api/me/inventory'+(body?'':'?expected_address='+W),{method:body?'POST':'GET',headers:{cookie:SESSION_COOKIE+'='+TOKEN,...body?{origin:'https://imdember.com','content-type':'application/json'}:{}},...body?{body:JSON.stringify({expectedAddress:W,revision:0,command:body})}:{},...patch});
const call=async(f,command,patch)=>{const r=await handleInventoryApi(request(command,patch),f.deps);return {status:r.status,data:await r.json()};};
test('production has no game/NFT allowlist or preview starter grants; an empty real wallet remains empty',async()=>{const f=await fixture();try{
  assert.deepEqual(INVENTORY_CATALOGUE,[]);assert.deepEqual(GAME_NFT_COLLECTIONS,[]);
  f.grant();const r=await handleInventoryApi(request(),{...f.deps,catalogue:INVENTORY_CATALOGUE});const s=await r.json();assert.equal(r.status,200);assert.deepEqual(s.items,[]);assert.deepEqual(s.nftCollections,[]);assert.equal(s.fixture,undefined);assert.equal(s.localOnly,undefined);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_arrangements').get().n,0);
}finally{f.close();}});
test('same-wallet inventory, loadout and display persist one holding; moving a display never grants or duplicates',async()=>{const f=await fixture();try{f.grant();let r=await call(f,{type:'display',slot:'trophy-1',itemId:'i_cup'});assert.equal(r.status,200);assert.equal(r.data.revision,1);assert.equal(r.data.items.length,1);
  const req=request({type:'display',slot:'trophy-2',itemId:'i_cup'});const b=await req.json();b.revision=1;const response=await handleInventoryApi(new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(b)}),f.deps);const s=await response.json();assert.equal(response.status,200);assert.equal(s.displays['trophy-1'],null);assert.equal(s.displays['trophy-2'],'i_cup');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_items').get().n,1);assert.equal(s.revision,2);
  const fresh=await call(f);assert.equal(fresh.data.displays['trophy-2'],'i_cup');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_items WHERE wallet=?').get(B).n,0);
}finally{f.close();}});
test('stale tabs, wrong slots, absent items, self-grants, client NFT ownership and extra body fields cannot change state',async()=>{const f=await fixture();try{f.grant();
 for(const [c,status]of [[{type:'equip',slot:'weapon',itemId:'i_cup'},409],[{type:'display',slot:'trophy-1',itemId:'i_forged'},409],[{type:'claim-test-trophy'},400],[{type:'set-test-nft',state:'owned'},400],[{type:'publish',enabled:true,owner:W},400]])assert.equal((await call(f,c)).status,status);
 assert.equal((await call(f,{type:'display',slot:'trophy-1',itemId:'i_cup'})).status,200);
 assert.equal((await call(f,{type:'display',slot:'trophy-2',itemId:'i_cup'})).status,409);assert.equal(f.db.raw.prepare('SELECT revision FROM world_inventory_arrangements').get().revision,1);
}finally{f.close();}});
test('cross-wallet, forged origins, unknown sessions, unsupported methods and oversized bodies spend no home reads',async()=>{const f=await fixture();try{
 assert.equal((await handleInventoryApi(new Request('https://imdember.com/api/me/inventory?expected_address='+B,{headers:{cookie:SESSION_COOKIE+'='+TOKEN}}),f.deps)).status,409);
 for(const [patch,status]of [[{headers:{cookie:SESSION_COOKIE+'='+TOKEN,origin:'https://evil.invalid'}},403],[{headers:{}},401],[{method:'DELETE'},405]])assert.equal((await call(f,undefined,patch)).status,status);
 assert.equal((await call(f,{type:'publish',enabled:true},{body:'x'.repeat(4096)})).status,400);assert.equal(f.calls(),0);
 assert.equal((await call(f,undefined,{headers:{cookie:SESSION_COOKIE+'='+TOKEN,'sec-fetch-site':'cross-site'}})).status,403);
}finally{f.close();}});
test('home failure/partial-negative are not nonownership; no display writes, and private inventory stays intact',async()=>{const f=await fixture();try{f.grant();
 for(const home of [async()=>{throw Error('RPC failed');},async()=>({address:W,eligible:0,size:null,block:100,checkedAt:NOW,recheck:'limited'}),async()=>({address:B,eligible:1,size:'m',block:100,checkedAt:NOW}),async()=>({address:W,eligible:1,size:'m',block:100,checkedAt:NOW-30000})]){
 const deps={...f.deps,home};let r=await handleInventoryApi(request(),deps),s=await r.json();assert.equal(r.status,200);assert.equal(s.home.state,'unavailable');assert.equal(s.items.length,1);r=await handleInventoryApi(request({type:'display',slot:'trophy-1',itemId:'i_cup'}),deps);assert.equal(r.status,403);}
 assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_items').get().n,1);
}finally{f.close();}});
test('logout/expiry during home I/O cannot write a persisted arrangement or return private state',async()=>{for(const expiry of [false,true]){const f=await fixture();try{f.grant();const deps={...f.deps,home:async()=>{if(expiry)f.time(NOW+60000);else f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);return {address:W,eligible:1,size:'m',block:100,checkedAt:NOW};}};
 const r=await handleInventoryApi(request({type:'display',slot:'trophy-1',itemId:'i_cup'}),deps);assert.notEqual(r.status,200);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_arrangements').get().n,0);
 const s=await r.json();assert.equal(s.items,undefined);
}finally{f.close();}}});
test('revoked holdings disappear from equipment and display without deleting original ownership evidence',async()=>{const f=await fixture();try{f.grant();assert.equal((await call(f,{type:'display',slot:'trophy-1',itemId:'i_cup'})).status,200);f.db.raw.prepare('UPDATE world_inventory_items SET revoked_ms=?').run(NOW);
 const r=await call(f);assert.deepEqual(r.data.items,[]);assert.equal(r.data.displays['trophy-1'],null);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_items').get().n,1);
}finally{f.close();}});
test('anonymous publication is explicit, currently home-verified and contains only display fields',async()=>{const f=await fixture();try{f.grant();const publicReq=()=>new Request('https://imdember.com/api/world/collections/'+W);
 assert.deepEqual(await (await handleInventoryApi(publicReq(),f.deps)).json(),{visible:false,displays:[]});
 assert.equal((await call(f,{type:'publish',enabled:true})).status,200);
 const s=await (await handleInventoryApi(publicReq(),f.deps)).json();assert.deepEqual(Object.keys(s).sort(),['displays','visible']);for(const key of ['items','equipment','wallet','revision','source','gold','orders'])assert.equal(Object.hasOwn(s,key),false);
 const r=await handleInventoryApi(publicReq(),{...f.deps,home:async()=>{throw Error();}});assert.equal(r.status,503);
}finally{f.close();}});
test('pre-migration database and contract-wallet writes stay closed',async()=>{let f=await fixture({files:migrationFiles().filter(n=>Number(n.slice(0,4))<17)});try{assert.equal((await call(f)).status,503);}finally{f.close();}
 f=await fixture();try{f.db.raw.prepare("UPDATE sessions SET wallet_type='CONTRACT',verification_method='ERC1271'").run();assert.equal((await call(f,{type:'publish',enabled:true})).status,403);}finally{f.close();}
});
const auth=()=>({account:W,session:{address:W,expiresAt:NOW+60000},sessionKnown:true,phase:'idle',leaving:false,waiting:false});
test('client discards late cross-wallet or logout responses; checks actual response holdings and slot types',async()=>{const f=await fixture();try{const snap=(await call(f)).data;let state=auth();const client=new InventoryClient({auth:()=>state,now:()=>NOW,fetch:async()=>{state={...state,account:B};return Response.json(snap);}});await assert.rejects(client.state(),/ACCOUNT_CONTEXT_CHANGED/);
 assert.throws(()=>parseInventory({...snap,nftCollections:[{contract:'arbitrary'}]},W),/INVALID_RESPONSE/);assert.throws(()=>inventoryCommand({type:'claim-test-trophy'}),/INVALID_COMMAND/);
 const bad={...snap,...emptyArrangement(),equipment:{weapon:'i_missing',armor:null,tool:null}};assert.throws(()=>parseInventory(bad,W),/INVALID_RESPONSE/);
}finally{f.close();}});
