import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W,OWNER,rid} from './world-gold-audit5-fixture.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {handleAIMarketCampaign} from '../server/aimarket-campaign.ts';
import {handleInventoryApi} from '../server/inventory.ts';
import {reconcileWorldGold,claimGoldJob,finishGoldJob} from '../server/world-gold.ts';

const ROOT='https://imdember.com',TOKEN='z'.repeat(43);
const req=(path,wallet,value)=>new Request(ROOT+path+(value?'':'?expected_address='+wallet),{method:value?'POST':'GET',headers:{origin:ROOT,cookie:SESSION_COOKIE+'='+TOKEN,...value?{'content-type':'application/json'}:{}},...value?{body:JSON.stringify({expectedAddress:wallet,...value})}:{}});
async function session(f,wallet=W){const hash=await sha256(TOKEN);f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(hash,wallet,NOW-1,NOW+3600000,'audit10','EOA','ECDSA');return hash;}
const deps=f=>({db:f.db,config:f.config,now:()=>NOW+2,allow:async()=>true,serviceReady:true,serviceProducts:['research']});
function afterRead(f,n,fn){const prepare=f.db.prepare;let reads=0;f.db.prepare=sql=>{const s=prepare(sql);if(!sql.startsWith('SELECT address,expires_at'))return s;const wrap=p=>({...p,bind:(...v)=>wrap(p.bind(...v)),first:async()=>{const row=await p.first();if(++reads===n)fn();return row;}});return wrap(s);};}

for(const route of ['quote','admin','campaign','pay','inventory'])test(`audit10 L1/L2: ${route} logout before atomic write is 401 with no write`,async()=>{
 const f=await fixture();try{
  await f.topup();const wallet=['admin','campaign'].includes(route)?OWNER:W,hash=await session(f,wallet);let id,signed;
  if(route==='pay'){id=await f.quote('research');signed=await f.challenge(id);}
  const before=f.db.raw.prepare('SELECT count(*) n FROM economy_orders').get().n;
  afterRead(f,['inventory','campaign'].includes(route)?1:2,()=>f.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(NOW+1,hash));
  const d=deps(f);let r;
  if(route==='quote')r=await handleWorldGoldApi(req('/api/gold/quote',wallet,{product:'pack',requestId:rid()}),d);
  if(route==='admin')r=await handleWorldGoldApi(req('/api/gold/admin',wallet,{requestId:rid(),reason:'Late logout boundary',command:{action:'control',feature:'topup',version:0,enabled:false}}),d);
  if(route==='campaign')r=await handleAIMarketCampaign(req('/api/me/aimarket-campaign',wallet,{requestId:rid(),reason:'Late campaign logout',version:1,startsMs:NOW,endsMs:NOW+1000,stopped:false}),d);
  if(route==='pay')r=await handleEconomyApi(req('/api/economy/orders/'+id+'/gold',wallet,{requestId:signed.requestId,signature:signed.signature}),d);
  if(route==='inventory')r=await handleInventoryApi(req('/api/me/inventory',wallet,{revision:0,command:{type:'publish',enabled:false}}),{...d,home:async()=>({address:wallet,eligible:0,checkedAt:NOW+2,block:100})});
  assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'AUTH_REQUIRED'});
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM economy_orders').get().n,before);
  assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_jobs').get().n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_arrangements').get().n,0);
  assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_campaigns').get().n,0);
  assert.equal(f.db.raw.prepare("SELECT enabled FROM world_gold_controls WHERE feature='topup'").get().enabled,1);
  if(signed)assert.equal(f.db.raw.prepare('SELECT consumed_ms FROM economy_gold_challenges WHERE order_id=?').get(id).consumed_ms,null);
 }finally{f.close();}
});

test('audit10 I3: empty or unsupported provider cannot enable service or advertise delivery',async()=>{
 for(const products of [[],['unknown']]){const f=await fixture();try{
  await session(f,OWNER);await f.admin({action:'control',feature:'service',version:0,enabled:false});
  const d={...deps(f),serviceProducts:products},r=await handleWorldGoldApi(req('/api/gold/admin',OWNER,{requestId:rid(),reason:'Reject empty capability',command:{action:'control',feature:'service',version:1,enabled:true}}),d);
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'SERVICE_DELIVERY_UNAVAILABLE'});
  assert.equal(f.db.raw.prepare("SELECT enabled FROM world_gold_controls WHERE feature='service'").get().enabled,0);
  const state=await handleWorldGoldApi(req('/api/gold/state',OWNER),d);assert.equal((await state.json()).deliveryReady,false);
 }finally{f.close();}}
});

test('audit10 I4: historical unsupported service stays immutable but is marked unserviceable in state',async()=>{
 const f=await fixture();try{await f.admin({action:'product',product:'fortune',kind:'service',title:'Fortune',gold:'1',enabled:true,version:1});await session(f);
  const r=await handleWorldGoldApi(req('/api/gold/state',W),deps(f)),state=await r.json();assert.equal(r.status,200);
  const p=state.products.find(p=>p.product==='fortune');assert.equal(p?.serviceable,false);assert.equal(p.enabled,1);
  assert.equal(state.products.find(p=>p.product==='research').serviceable,true);assert.equal(state.deliveryReady,true);
  assert.equal(f.db.raw.prepare("SELECT enabled FROM world_gold_products WHERE id='fortune:1'").get().enabled,1);
  const q=await handleWorldGoldApi(req('/api/gold/quote',W,{product:'fortune',requestId:rid()}),deps(f));assert.equal(q.status,503);
 }finally{f.close();}
});

test('audit10 I5: HTTP respects the same topup retry boundary as cron and credits exactly once',async()=>{
 const f=await fixture();try{await f.topup();f.db.raw.prepare("UPDATE economy_gold_accounts SET balance='9223372036854775800' WHERE wallet=?").run(W);
  const id=await f.quote();await f.paid(id);await reconcileWorldGold(f.db,NOW);await session(f);
  const original=f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id);assert.equal(original.attempts,1);
  for(const at of [NOW+1,NOW+2,NOW+299999]){const r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',W,{}),{...deps(f),now:()=>at});assert.equal(r.status,409);assert.equal((await r.json()).error,'GOLD_BALANCE_CAPACITY');assert.deepEqual(f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id),original);}
  assert.equal((await reconcileWorldGold(f.db,NOW+299999)).processed,0);
  f.db.raw.prepare("UPDATE economy_gold_accounts SET balance='0' WHERE wallet=?").run(W);
  const r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',W,{}),{...deps(f),now:()=>NOW+300000});assert.equal(r.status,200);assert.equal((await f.snapshot()).book,'10');
  await reconcileWorldGold(f.db,NOW+300001,id);assert.equal((await f.snapshot()).book,'10');
 }finally{f.close();}
});
