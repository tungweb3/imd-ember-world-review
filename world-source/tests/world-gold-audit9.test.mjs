import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,NOW,W,OWNER,rid} from './world-gold-audit5-fixture.mjs';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {handleWorldGoldReport} from '../server/world-gold-report.ts';
import {handleMemberBalances} from '../server/member-balances.ts';
import {handleAIMarketCampaign} from '../server/aimarket-campaign.ts';
import {runGoldServiceJobs} from '../server/world-gold-delivery.ts';

const TOKEN='x'.repeat(43),ROOT='https://imdember.com';
async function session(f,wallet=W){
 const hash=await sha256(TOKEN);
 f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(hash,wallet,1,NOW-1,NOW+60000,'audit9','EOA','ECDSA');
 return hash;
}
function request(path,value,wallet=W){return new Request(ROOT+path+(value?'':'?expected_address='+wallet),{method:value?'POST':'GET',headers:{cookie:SESSION_COOKIE+'='+TOKEN,origin:ROOT,...value?{'content-type':'application/json'}:{}},...value?{body:JSON.stringify({expectedAddress:wallet,...value})}:{}});}
const deps=f=>({db:f.db,config:f.config,now:()=>NOW+1,allow:async()=>true,serviceReady:true,serviceProducts:['research']});
async function report(f){await f.topup();const id=await f.service();await runGoldServiceJobs(f.db,{id:'fixture',products:['research'],deliver:async()=>({kind:'delivered',result:{provider:'aimarket-vps-v1',report:'Published research: 2026-10-19',reportId:'a'.repeat(64),reportDate:'2026-10-19',documentHash:'a'.repeat(64)}})},()=>NOW+1);return id;}

for(const step of ['challenge','pay'])test(`audit9 M1: provider removal refuses pending legacy service ${step} without debit`,async()=>{
 const f=await fixture();try{
  await f.topup();await f.admin({action:'product',product:'fortune',kind:'service',title:'Fortune',gold:'1',enabled:true,version:1});const id=await f.quote('fortune');
  const signed=step==='pay'?await f.challenge(id):null;await session(f);
  const r=await handleEconomyApi(request('/api/economy/orders/'+id+'/gold'+(step==='challenge'?'/challenge':''),step==='challenge'?{requestId:rid()}:{requestId:signed.requestId,signature:signed.signature}),deps(f));
  assert.equal(r.status,503);assert.equal((await r.json()).error,'SERVICE_DELIVERY_UNAVAILABLE');
  assert.equal((await f.snapshot()).book,'10');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_jobs').get().n,0);
 }finally{f.close();}
});

test('audit9 L1: new private reads reject a clock regression above route start',async()=>{
 for(const path of ['/api/me/gold','/api/gold/state','/api/me/aimarket-trial','/api/me/balances']){
  const f=await fixture();try{await session(f);let calls=0;const now=()=>++calls<=2?NOW:calls===3?NOW+10:NOW+5;
   const d={...deps(f),now};const r=path.endsWith('balances')?await handleMemberBalances(request(path),{...d,config:async()=>f.config,chain:{},client:'audit9'}):await handleWorldGoldApi(request(path),d);
   assert.equal(r.status,503,path);assert.deepEqual(Object.keys(await r.json()),['error']);
  }finally{f.close();}
 }
});

test('audit9 L2: logout after fresh session read cannot return reconcile success',async()=>{
 const f=await fixture();try{await f.topup();const id=await f.quote();await f.paid(id);const hash=await session(f);const prepare=f.db.prepare;let reads=0;
 f.db.prepare=sql=>{const s=prepare(sql);if(!sql.startsWith('SELECT address,expires_at'))return s;const wrap=p=>({...p,bind:(...v)=>wrap(p.bind(...v)),first:async()=>{const row=await p.first();if(++reads===2)f.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(NOW+1,hash);return row;}});return wrap(s);};
 const r=await handleWorldGoldApi(request('/api/gold/orders/'+id+'/reconcile',{}),deps(f));assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'AUTH_REQUIRED'});
 }finally{f.close();}
});

test('audit9 L3: an unverified legacy session cannot read its paid research document',async()=>{
 const f=await fixture();try{const id=await report(f);await session(f);f.db.raw.prepare('UPDATE sessions SET wallet_type=NULL,verification_method=NULL').run();let calls=0;
 const r=await handleWorldGoldReport(request('/api/gold/orders/'+id+'/report'),{...deps(f),provider:{readReport:async()=>{calls++;return {content:'private'};}}});assert.equal(r.status,401);assert.equal(calls,0);assert.deepEqual(await r.json(),{error:'AUTH_REQUIRED'});
 }finally{f.close();}
});

test('audit9 I1: owner cannot publish an enabled service outside the provider products',async()=>{
 const f=await fixture();try{await session(f,OWNER);const count=f.db.raw.prepare('SELECT count(*) n FROM world_gold_products').get().n;
 const r=await handleWorldGoldApi(request('/api/gold/admin',{requestId:rid(),reason:'Reject unserviceable product',command:{action:'product',product:'fortune',kind:'service',title:'Fortune',gold:'1',enabled:true,version:1}},OWNER),deps(f));
 assert.equal(r.status,503);assert.equal((await r.json()).error,'SERVICE_DELIVERY_UNAVAILABLE');assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_products').get().n,count);
 }finally{f.close();}
});
