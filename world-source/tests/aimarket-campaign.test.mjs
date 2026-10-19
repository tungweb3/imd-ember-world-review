import test from 'node:test';
import assert from 'node:assert/strict';
import {handleAIMarketCampaign} from '../server/aimarket-campaign.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from '../server/aimarket-admin.ts';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
const NOW=Date.UTC(2026,9,19),W=AIMARKET_ACTIVITY_ADMIN_WALLETS[0],B='0x'+'b'.repeat(40),TOKEN='s'.repeat(43);
async function fixture(wallet=W,files){const db=openD1(files);db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(await sha256(TOKEN),wallet,1,NOW-1,NOW+60000,'campaign','EOA','ECDSA');let now=NOW;return {db,time:n=>now=n,close:()=>db.raw.close(),deps:{db,now:()=>now,allow:async()=>true}};}
const campaign=(patch={})=>({expectedAddress:W,requestId:'campaign-request-00001',version:1,startsMs:NOW,endsMs:NOW+1000,stopped:false,reason:'Owner requested free World campaign',...patch});
const request=(value=null,patch={})=>new Request('https://imdember.com/api/me/aimarket-campaign'+(value?'':'?expected_address='+W),{method:value?'POST':'GET',headers:{cookie:SESSION_COOKIE+'='+TOKEN,...value?{origin:'https://imdember.com','content-type':'application/json'}:{}},...value?{body:JSON.stringify(value)}:{},...patch});
test('free campaign management works independently of financial contracts/prices, with UTC exclusive end and audited stop',async()=>{const f=await fixture();try{
 let r=await handleAIMarketCampaign(request(),f.deps);assert.equal(r.status,200);assert.equal((await r.json()).campaign.version,0);
 r=await handleAIMarketCampaign(request(campaign()),f.deps);assert.equal(r.status,200);assert.equal((await r.json()).campaign.active,true);
 assert.equal((await handleAIMarketCampaign(request(campaign()),f.deps)).status,200);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_admin_actions').get().n,1);
 f.time(NOW+1000);assert.equal((await (await handleAIMarketCampaign(request(),f.deps)).json()).campaign.active,false);
 f.time(NOW+1);r=await handleAIMarketCampaign(request(campaign({requestId:'campaign-request-stop1',version:2,stopped:true})),f.deps);assert.equal(r.status,200);assert.equal((await r.json()).campaign.active,false);
 const actions=f.db.raw.prepare('SELECT before_json,after_json FROM world_gold_admin_actions ORDER BY created_ms,id').all();assert.equal(actions.length,2);assert.ok(actions.every(a=>a.before_json&&a.after_json));assert.equal(f.db.raw.prepare('SELECT count(*) n FROM economy_orders').get().n,0);
}finally{f.close();}});
test('wrong wallet, origin, session, contract write, extra fee/amount claims and invalid interval cannot change campaigns',async()=>{const f=await fixture();try{
 for(const [r,status]of [[request(campaign({expectedAddress:B})),409],[request(campaign(),{headers:{origin:'https://evil.invalid'}}),403],[request(null,{headers:{}}),401],[request(campaign({gold:'999'})),400],[request(campaign({endsMs:NOW})),409]])assert.equal((await handleAIMarketCampaign(r,f.deps)).status,status);
 f.db.raw.prepare("UPDATE sessions SET wallet_type='CONTRACT',verification_method='ERC1271'").run();assert.equal((await handleAIMarketCampaign(request(campaign()),f.deps)).status,403);assert.equal(f.db.raw.prepare('SELECT count(*) n FROM world_gold_campaigns').get().n,0);
}finally{f.close();}
 const other=await fixture(B);try{assert.equal((await handleAIMarketCampaign(request(null,{headers:{cookie:SESSION_COOKIE+'='+TOKEN}}),other.deps)).status,409);const u=new Request('https://imdember.com/api/me/aimarket-campaign?expected_address='+B,{headers:{cookie:SESSION_COOKIE+'='+TOKEN}});assert.equal((await handleAIMarketCampaign(u,other.deps)).status,403);}finally{other.close();}
});
test('pre-shared database remains unavailable; no campaign or grant is synthesized',async()=>{const f=await fixture(W,migrationFiles().filter(n=>Number(n.slice(0,4))<14));try{assert.equal((await handleAIMarketCampaign(request(),f.deps)).status,503);}finally{f.close();}});
test('a logout during campaign query refuses the late private response',async()=>{const f=await fixture();try{const prepare=f.db.prepare;f.db.prepare=sql=>{const s=prepare(sql);if(!sql.includes('SELECT version,starts_ms'))return s;return {...s,first:async()=>{const value=await s.first();f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);return value;}};};const r=await handleAIMarketCampaign(request(),f.deps);assert.equal(r.status,401);assert.equal((await r.json()).campaign,undefined);}finally{f.close();}});
