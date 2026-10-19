import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W,OWNER,B,rid} from './world-gold-audit5-fixture.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {handleWorldGoldReport} from '../server/world-gold-report.ts';
import {handleMemberBalances} from '../server/member-balances.ts';
import {handleAIMarketCampaign} from '../server/aimarket-campaign.ts';
import {handleInventoryApi} from '../server/inventory.ts';
import {economySessionClock} from '../server/economy-session.ts';
import {createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import {reconcileWorldGold,claimGoldJob,finishGoldJob} from '../server/world-gold.ts';

const TOKEN='y'.repeat(43),ROOT='https://imdember.com';
const req=(path,wallet,value)=>new Request(ROOT+path+(value?'':'?expected_address='+wallet),{method:value?'POST':'GET',headers:{cookie:SESSION_COOKIE+'='+TOKEN,origin:ROOT,...value?{'content-type':'application/json'}:{}},...value?{body:JSON.stringify({expectedAddress:wallet,...value})}:{}});
const readRoutes=['legacy','gold','state','trial','balances','report','campaign','inventory','admin'];
async function setup(route){
 const f=await fixture();await f.topup();const wallet=route==='campaign'||route==='admin'?OWNER:W;let id;
 if(route==='report'){
  id=await f.service();const attempt=await claimGoldJob(f.db,id,NOW+1);
  await finishGoldJob(f.db,{orderId:id,attempt,nowMs:NOW+2,outcome:{result:{provider:'aimarket-vps-v1',report:'Published research: 2026-10-19',reportId:'a'.repeat(64),documentHash:'a'.repeat(64),reportDate:'2026-10-19'}}});
 }
 const hash=await sha256(TOKEN);f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(hash,wallet,1,NOW-1,NOW+60000,'boundary','EOA','ECDSA');
 let at=NOW,io=0;const clock=()=>at;
 const trigger=()=>{io++;};let onIO=trigger,onRevalidation=()=>{},sessionReads=0;
 const prepare=f.db.prepare,batch=f.db.batch;
 const matches=sql=>route==='legacy'?sql.includes('SELECT position_id id'):['trial','campaign'].includes(route)?sql.includes('SELECT version,starts_ms'):route==='inventory'?sql.includes('SELECT revision,arrangement_json'):route==='balances'?sql.includes('SELECT CAST(COALESCE((SELECT balance'):route==='admin'?sql.includes('SELECT feature,enabled,version'):false;
 const wrap=(s,sql)=>({...s,bind:(...v)=>wrap(s.bind(...v),sql),first:async()=>{const r=await s.first();if(sql.startsWith('SELECT address,expires_at')&&++sessionReads===2)onRevalidation();if(matches(sql))onIO();return r;},all:async()=>{const r=await s.all();if(matches(sql))onIO();return r;}});
 f.db.prepare=sql=>wrap(prepare(sql),sql);
 f.db.batch=async list=>{const out=await batch(list);if(['gold','state'].includes(route)&&list.some(s=>s.sql.includes('FROM world_gold_history')))onIO();return out;};
 const d={db:f.db,config:f.config,now:clock,allow:async()=>true,serviceReady:true,serviceProducts:['research']};
 const invoke=()=>{
  if(route==='legacy')return handleEconomyApi(req('/api/me/economy',wallet),d);
  if(route==='balances')return handleMemberBalances(req('/api/me/balances',wallet),{...d,config:async()=>f.config,chain:{},client:'fixture'});
  if(route==='campaign')return handleAIMarketCampaign(req('/api/me/aimarket-campaign',wallet),d);
  if(route==='inventory')return handleInventoryApi(req('/api/me/inventory',wallet),{...d,home:async()=>({address:wallet,eligible:0,block:100,checkedAt:at})});
  if(route==='report')return handleWorldGoldReport(req('/api/gold/orders/'+id+'/report',wallet),{...d,provider:{readReport:async()=>{onIO();return {content:'private-fixture'};}}});
  return handleWorldGoldApi(req(route==='gold'?'/api/me/gold':route==='state'?'/api/gold/state':route==='trial'?'/api/me/aimarket-trial':'/api/gold/admin',wallet),d);
 };
 return {...f,wallet,hash,invoke,time:n=>at=n,onIO:fn=>onIO=()=>{io++;fn();},io:()=>io,onRevalidation:fn=>onRevalidation=fn};
}

for(const route of readRoutes)for(const mutation of ['logout','expiry-equality','clock-regression','expiry-changed','verification-downgrade','wallet-changed'])test(`audit9 private matrix ${route}: ${mutation} during I/O discards the whole body`,async()=>{
 const f=await setup(route);try{
  f.time(NOW+10);let once=false;
  f.onIO(()=>{if(once)return;once=true;
   if(mutation==='logout')f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW+10);
   if(mutation==='expiry-equality')f.time(NOW+60000);
   if(mutation==='clock-regression')f.time(NOW+5);
   if(mutation==='expiry-changed')f.db.raw.prepare('UPDATE sessions SET expires_at=expires_at+1').run();
   if(mutation==='verification-downgrade')f.db.raw.prepare('UPDATE sessions SET verification_method=NULL').run();
   if(mutation==='wallet-changed')f.db.raw.prepare('UPDATE sessions SET address=?').run(B);
  });
  const r=await f.invoke();assert.equal(once,true);assert.equal(r.status,mutation==='clock-regression'?503:401);assert.deepEqual(Object.keys(await r.json()),['error']);assert.match(r.headers.get('cache-control'),/no-store/);
 }finally{f.close();}
});

for(const route of readRoutes)for(const invalid of ['unverified','unsafe-expiry'])test(`audit9 private matrix ${route}: refuses initial ${invalid} before snapshot/provider`,async()=>{
 const f=await setup(route);try{
  if(invalid==='unverified')f.db.raw.prepare('UPDATE sessions SET wallet_type=NULL,verification_method=NULL').run();
  else f.db.raw.prepare('UPDATE sessions SET expires_at=?').run(NOW+60000.5);
  const r=await f.invoke();assert.equal(r.status,401);assert.equal(f.io(),0);assert.deepEqual(Object.keys(await r.json()),['error']);
 }finally{f.close();}
});

for(const route of readRoutes)test(`audit9 private matrix ${route}: unchanged ECDSA and ERC1271 sessions retain read access`,async()=>{
 const f=await setup(route);try{assert.equal((await f.invoke()).status,200);f.db.raw.prepare("UPDATE sessions SET wallet_type='CONTRACT',verification_method='ERC1271'").run();assert.equal((await f.invoke()).status,200);}finally{f.close();}
});

test('audit9 clocks allow equal timestamps, reject invalid/final samples and remain failed after recovery',()=>{
 for(const invalid of [NOW-1,NaN,Infinity,0,NOW+0.5,Number.MAX_SAFE_INTEGER+1]){let at=NOW;const clock=economySessionClock(()=>at);assert.equal(clock(),NOW);assert.equal(clock(),NOW);at=invalid;assert.throws(clock,/INVALID_CLOCK/);at=NOW+1;assert.throws(clock,/INVALID_CLOCK/);}
});

for(const route of readRoutes)for(const mutation of ['backward-final-sample','expiry-at-final-sample'])test(`audit9 private matrix ${route}: ${mutation} while the final session read awaits`,async()=>{
 const f=await setup(route);try{f.time(NOW+10);let fired=false;f.onRevalidation(()=>{fired=true;f.time(mutation==='backward-final-sample'?NOW+5:NOW+60000);});
 const r=await f.invoke();assert.equal(fired,true);assert.equal(r.status,mutation==='backward-final-sample'?503:401);assert.deepEqual(Object.keys(await r.json()),['error']);
 }finally{f.close();}
});

for(const route of ['quote','challenge','pay','admin','campaign','inventory'])for(const mutation of ['logout','expiry-equality','clock-regression'])test(`audit9 committed ${route}: late ${mutation} cannot return a stale success body`,async()=>{
 const f=await fixture();try{
  await f.topup();const wallet=['admin','campaign'].includes(route)?OWNER:W,hash=await sha256(TOKEN);
  f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(hash,wallet,1,NOW-1,NOW+60000,'post-write','EOA','ECDSA');
  let at=NOW+10,id,signed;if(['challenge','pay'].includes(route)){id=await f.quote('research');if(route==='pay')signed=await f.challenge(id);}
  const mutate=()=>{if(mutation==='logout')f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(at);if(mutation==='expiry-equality')at=NOW+60000;if(mutation==='clock-regression')at=NOW+5;};
  let fired=false;const once=()=>{if(!fired){fired=true;mutate();}};
  const batch=f.db.batch,prepare=f.db.prepare;
  f.db.batch=async list=>{const r=await batch(list);if(list.some(s=>/INSERT INTO economy_orders|INSERT INTO economy_gold_journal|INSERT INTO world_gold_admin_actions|INSERT OR IGNORE INTO world_inventory_arrangements/.test(s.sql)))once();return r;};
  f.db.prepare=sql=>{const s=prepare(sql);if(!sql.startsWith('INSERT INTO economy_gold_challenges'))return s;const wrap=p=>({...p,bind:(...v)=>wrap(p.bind(...v)),run:async()=>{const r=await p.run();once();return r;}});return wrap(s);};
  const d={db:f.db,config:f.config,now:()=>at,allow:async()=>true,serviceReady:true,serviceProducts:['research']};let r;
  if(route==='quote')r=await handleWorldGoldApi(req('/api/gold/quote',wallet,{product:'pack',requestId:rid()}),d);
  if(route==='challenge')r=await handleEconomyApi(req('/api/economy/orders/'+id+'/gold/challenge',wallet,{requestId:rid()}),d);
  if(route==='pay')r=await handleEconomyApi(req('/api/economy/orders/'+id+'/gold',wallet,{requestId:signed.requestId,signature:signed.signature}),d);
  if(route==='admin')r=await handleWorldGoldApi(req('/api/gold/admin',wallet,{requestId:rid(),reason:'Post-write boundary',command:{action:'control',feature:'topup',version:0,enabled:false}}),d);
  if(route==='campaign')r=await handleAIMarketCampaign(req('/api/me/aimarket-campaign',wallet,{requestId:rid(),reason:'Post-write campaign boundary',version:1,startsMs:NOW,endsMs:NOW+1000,stopped:false}),d);
  if(route==='inventory')r=await handleInventoryApi(req('/api/me/inventory',wallet,{revision:0,command:{type:'publish',enabled:false}}),{...d,home:async()=>({address:wallet,eligible:0,checkedAt:at,block:100})});
  assert.equal(fired,true);assert.equal(r.status,mutation==='clock-regression'?503:401);assert.deepEqual(Object.keys(await r.json()),['error']);
  if(route==='pay')assert.equal((await f.snapshot()).book,'7'); // A valid committed payment is never silently undone.
 }finally{f.close();}
});

test('audit9 supported research payment remains exactly once, even after its provider is removed and admissions paused',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.quote('research'),args=await f.challenge(id);args.serviceProducts=['research'];await payEconomyOrderGold(f.db,f.config,args);await f.admin({action:'control',feature:'service',enabled:false,version:0});
 const paid=await payEconomyOrderGold(f.db,f.config,{...args,serviceReady:false,serviceProducts:[],nowMs:NOW+900001});assert.equal(paid.status,'paid');assert.equal((await f.snapshot()).book,'7');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_jobs').get().n,1);
 }finally{f.close();}
});

test('audit9 SQL independently refuses unsupported challenge and debit when the application product lookup lies',async()=>{
 for(const step of ['challenge','pay']){const f=await fixture();try{await f.topup();await f.admin({action:'product',product:'fortune',kind:'service',title:'Fortune',gold:'1',enabled:true,version:1});const id=await f.quote('fortune'),args=step==='pay'?await f.challenge(id):{wallet:W,orderId:id,requestId:rid(),origin:ROOT,nowMs:NOW,serviceReady:true};
  const prepare=f.db.prepare;f.db.prepare=sql=>{const s=prepare(sql);if(!sql.startsWith('SELECT l.order_id,p.product'))return s;const wrap=p=>({...p,bind:(...v)=>wrap(p.bind(...v)),first:async()=>({...await p.first(),product:'research'})});return wrap(s);};
  await assert.rejects((step==='challenge'?createEconomyGoldChallenge:payEconomyOrderGold)(f.db,f.config,{...args,serviceProducts:['research']}));assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_jobs').get().n,0);
 }finally{f.close();}}
});

test('audit9 supported HTTP payment, wrong-origin/account and empty-provider admission use one rule',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.quote('research'),hash=await sha256(TOKEN);f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(hash,W,1,NOW-1,NOW+60000,'http-pay','EOA','ECDSA');
 const d={db:f.db,config:f.config,now:()=>NOW+1,allow:async()=>true,serviceReady:true,serviceProducts:['research']},path='/api/economy/orders/'+id+'/gold';
 let r=await handleEconomyApi(req(path+'/challenge',W,{requestId:rid()}),{...d,serviceProducts:[]});assert.equal(r.status,503);
 const requestId=rid();r=await handleEconomyApi(req(path+'/challenge',W,{requestId}),d);assert.equal(r.status,200);const ch=(await r.json()).challenge;
 const {account}=await import('./world-gold-audit5-fixture.mjs');const signature=await account.signMessage({message:ch.message});r=await handleEconomyApi(req(path,W,{requestId,signature}),d);assert.equal(r.status,200);assert.equal((await f.snapshot()).book,'7');
 r=await handleEconomyApi(req(path,B,{requestId,signature}),d);assert.equal(r.status,409);assert.equal((await f.snapshot()).book,'7');
 }finally{f.close();}
});

test('audit9 reconciliation completion after logout returns 401; cron and an authenticated retry preserve one owed credit',async()=>{
 const f=await setup('gold');try{const id=await f.quote();await f.paid(id);const prepare=f.db.prepare;
 f.db.prepare=sql=>{if(sql.startsWith('SELECT id FROM economy_orders WHERE id='))f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW+1);return prepare(sql);};
 const d={db:f.db,config:null,now:()=>NOW+2,allow:async()=>true};const r=await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',W,{}),d);assert.equal(r.status,401);
 f.db.prepare=prepare;await reconcileWorldGold(f.db,NOW+3);assert.equal((await f.snapshot()).book,'20');f.db.raw.prepare('UPDATE sessions SET revoked_at=NULL').run();assert.equal((await handleWorldGoldApi(req('/api/gold/orders/'+id+'/reconcile',W,{}),d)).status,200);assert.equal((await f.snapshot()).book,'20');
 }finally{f.close();}
});
