import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W,OWNER,B,rid} from './world-gold-audit5-fixture.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {handleAIMarketCampaign} from '../server/aimarket-campaign.ts';
import {handleInventoryApi} from '../server/inventory.ts';
import {emptyArrangement} from '../src/world/inventory.ts';
import {reconcileWorldGold,claimGoldJob,finishGoldJob} from '../server/world-gold.ts';

const ROOT='https://imdember.com',TOKEN='v'.repeat(43);
const req=(path,wallet,value)=>new Request(ROOT+path+(value?'':'?expected_address='+wallet),{method:value?'POST':'GET',headers:{origin:ROOT,cookie:SESSION_COOKIE+'='+TOKEN,...value?{'content-type':'application/json'}:{}},...value?{body:JSON.stringify({expectedAddress:wallet,...value})}:{}});
async function setup(route){
 const f=await fixture();await f.topup();const wallet=['admin','campaign'].includes(route)?OWNER:W,hash=await sha256(TOKEN);
 f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(hash,wallet,NOW-1,NOW+3600000,'audit10-matrix','EOA','ECDSA');
 let at=NOW+10,id,signed;
 if(['challenge','pay'].includes(route)){id=await f.quote('research');if(route==='pay')signed=await f.challenge(id);}
 const d={db:f.db,config:f.config,now:()=>at,allow:async()=>true,serviceReady:true,serviceProducts:['research']};
 const invoke=()=>route==='quote'?handleWorldGoldApi(req('/api/gold/quote',wallet,{product:'pack',requestId:rid()}),d):route==='admin'?handleWorldGoldApi(req('/api/gold/admin',wallet,{requestId:rid(),reason:'Audit10 error boundary',command:{action:'control',feature:'topup',version:0,enabled:false}}),d):route==='campaign'?handleAIMarketCampaign(req('/api/me/aimarket-campaign',wallet,{requestId:rid(),reason:'Audit10 campaign boundary',version:1,startsMs:NOW,endsMs:NOW+1000,stopped:false}),d):route==='inventory'?handleInventoryApi(req('/api/me/inventory',wallet,{revision:0,command:{type:'publish',enabled:false}}),{...d,home:async()=>({address:wallet,eligible:0,block:100,checkedAt:at})}):handleEconomyApi(req('/api/economy/orders/'+id+'/gold'+(route==='challenge'?'/challenge':''),wallet,route==='challenge'?{requestId:rid()}:{requestId:signed.requestId,signature:signed.signature}),d);
 const beforeRead=fn=>{const prepare=f.db.prepare;let reads=0;f.db.prepare=sql=>{const s=prepare(sql);if(!sql.startsWith('SELECT address,expires_at'))return s;const wrap=p=>({...p,bind:(...v)=>wrap(p.bind(...v)),first:async()=>{const row=await p.first();if(++reads===(['campaign','inventory'].includes(route)?1:2))fn();return row;}});return wrap(s);};};
 return {...f,wallet,id,signed,d,invoke,beforeRead,time:n=>at=n};
}

for(const route of ['quote','admin','campaign','challenge','pay','inventory'])for(const change of ['expiry-equality','method-lost','wallet-switched','invalid-clock'])test(`audit10 before-write ${route}: ${change} keeps ledger and session boundaries`,async()=>{
 const f=await setup(route);try{
  f.beforeRead(()=>{if(change==='expiry-equality')f.db.raw.prepare('UPDATE sessions SET expires_at=?').run(NOW+10);if(change==='method-lost')f.db.raw.prepare('UPDATE sessions SET verification_method=NULL').run();if(change==='wallet-switched')f.db.raw.prepare('UPDATE sessions SET address=?').run(B);if(change==='invalid-clock')f.time(NOW+5);});
  const r=await f.invoke();assert.equal(r.status,change==='invalid-clock'?503:401);assert.deepEqual(Object.keys(await r.json()),['error']);assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_jobs').get().n,0);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_inventory_arrangements').get().n,0);
 }finally{f.close();}
});

for(const route of ['quote','admin','campaign','pay','inventory'])test(`audit10 ${route}: real batch failure with a live session stays 503`,async()=>{
 const f=await setup(route);try{
  f.db.batch=async()=>{throw Error('isolated database fault');};const r=await f.invoke();assert.equal(r.status,503);assert.deepEqual(Object.keys(await r.json()),['error']);
  assert.equal(f.db.raw.prepare('SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?').get(W).balance,'10');
 }finally{f.close();}
});

test('audit10 inventory: actual concurrent revision conflict remains 409 without overwriting the winner',async()=>{
 const f=await setup('inventory');try{const batch=f.db.batch;f.db.batch=async list=>{f.db.raw.prepare('INSERT INTO world_inventory_arrangements(wallet,revision,arrangement_json,updated_ms) VALUES(?,1,?,?)').run(W,JSON.stringify(emptyArrangement()),NOW);return batch(list);};const r=await f.invoke();assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'REVISION_CONFLICT'});assert.equal(f.db.raw.prepare('SELECT revision FROM world_inventory_arrangements WHERE wallet=?').get(W).revision,1);}finally{f.close();}
});

for(const products of [undefined,[],['unknown'],['research'],['unknown','research'],['fortune']])for(const ready of [false,true])test(`audit10 capabilities: ready=${ready} products=${JSON.stringify(products)}`,async()=>{
 const f=await setup('admin');try{
  const d={...f.d,serviceReady:ready,serviceProducts:products},r=await handleWorldGoldApi(req('/api/gold/state',OWNER),d),state=await r.json(),supported=ready&&(products===undefined||products.some(p=>['research','fortune'].includes(p)));
  assert.equal(r.status,200);assert.equal(state.deliveryReady,supported);assert.equal(state.products.find(p=>p.product==='pack').serviceable,true);assert.equal(state.products.find(p=>p.product==='research').serviceable,ready&&(products===undefined||products.includes('research')));
  await f.admin({action:'control',feature:'service',version:0,enabled:false});
  const enable=await handleWorldGoldApi(req('/api/gold/admin',OWNER,{requestId:rid(),reason:'Capability control matrix',command:{action:'control',feature:'service',version:1,enabled:true}}),d);assert.equal(enable.status,supported?200:503);
  const disable=await handleWorldGoldApi(req('/api/gold/admin',OWNER,{requestId:rid(),reason:'Capability disable always allowed',command:{action:'control',feature:'service',version:supported?2:1,enabled:false}}),d);assert.equal(disable.status,200);
  const preparatory=await handleWorldGoldApi(req('/api/gold/admin',OWNER,{requestId:rid(),reason:'Disabled definitions remain preparatory',command:{action:'product',product:'future',title:'Future service',kind:'service',version:1,gold:'1',enabled:false}}),d);assert.equal(preparatory.status,200);
 }finally{f.close();}
});

for(const kind of ['topup','refund'])test(`audit10 ${kind}: early retries keep backoff; exact deadline retries; cron completes once while paused`,async()=>{
 const f=await setup('quote');try{
  let id;if(kind==='topup'){id=await f.quote();await f.paid(id);}else{id=await f.service();const attempt=await claimGoldJob(f.db,id,NOW);await finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW,outcome:{result:{report:'fixture result'}}});f.db.raw.prepare("UPDATE world_gold_jobs SET state='failed',result_json=NULL,failure='fixture-confirmed',delivery_evidence_json=? WHERE order_id=?").run(JSON.stringify({kind:'provider-confirmed-nondelivery',provider:'fixture',reference:'confirmed'}),id);}
  f.db.raw.prepare("UPDATE economy_gold_accounts SET balance='9223372036854775807' WHERE wallet=?").run(W);
  await reconcileWorldGold(f.db,NOW,id);const original=f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id);assert.equal(original.attempts,1);
  await f.admin({action:'control',feature:kind==='topup'?'topup':'service',version:0,enabled:false});
  for(const at of [NOW+1,NOW+299999]){const r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',W,{}),{...f.d,now:()=>at});assert.equal(r.status,409);assert.deepEqual(f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id),original);}
  const stillFull=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',W,{}),{...f.d,now:()=>NOW+300000});assert.equal(stillFull.status,409);const next=f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id);assert.equal(next.attempts,2);assert.equal(next.retry_ms,NOW+600000);
  f.db.raw.prepare('UPDATE economy_gold_accounts SET balance=0 WHERE wallet=?').run(W);await reconcileWorldGold(f.db,NOW+599999);assert.equal((await f.snapshot()).book,'0');await reconcileWorldGold(f.db,NOW+600000);assert.equal((await f.snapshot()).book,kind==='topup'?'10':'3');await reconcileWorldGold(f.db,NOW+600001,id);assert.equal((await f.snapshot()).book,kind==='topup'?'10':'3');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_reconcile_errors WHERE order_id=?').get(id).n,0);
 }finally{f.close();}
});

test('audit10 reconciliation ownership/origin/auth checks cannot reveal or reset another order cooldown',async()=>{
 const f=await setup('quote');try{const id=await f.quote();await f.paid(id);f.db.raw.prepare("UPDATE economy_gold_accounts SET balance='9223372036854775807' WHERE wallet=?").run(W);await reconcileWorldGold(f.db,NOW,id);const original=f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id);
  let r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',B,{}),f.d);assert.equal(r.status,409);
  f.db.raw.prepare('UPDATE sessions SET address=?').run(B);r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',B,{}),f.d);assert.equal(r.status,404);
  const hostile=req('/api/gold/orders/'+id+'/reconcile',B,{});hostile.headers.set('origin','https://evil.test');r=await handleWorldGoldApi(hostile,f.d);assert.equal(r.status,403);
  f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',B,{}),f.d);assert.equal(r.status,401);assert.deepEqual(f.db.raw.prepare('SELECT * FROM world_gold_reconcile_errors WHERE order_id=?').get(id),original);
 }finally{f.close();}
});
