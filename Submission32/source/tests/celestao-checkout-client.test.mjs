import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCelestaoCheckout,CelestaoCheckoutClient} from '../src/world/celestaoCheckoutClient.ts';
import {fortuneProduct} from '../src/shared/fortunePricing.ts';
import {INITIAL} from '../src/world/auth.ts';
const wallet='0x'+'a'.repeat(40),runId='r'.repeat(43),now=1780000000000;
const payload=()=>({wallet,runId,product:fortuneProduct('profile'),expiresMs:now+900000,ready:true,order:{id:'0x'+'1'.repeat(64),serviceId:'fortune-profile',currency:'GOLD',amount:'3000',status:'pending',createdMs:now,expiresMs:now+900000,paidMs:null,delivery:null,result:null,failure:null}});
const state=()=>({...INITIAL,account:wallet,session:{address:wallet,expiresAt:now+3600000},restored:true,sessionKnown:true});
test('checkout binds the promotional price to its selected wallet, run and GOLD order',()=>{
 assert.equal(parseCelestaoCheckout(payload(),runId,wallet).product.listGold,'3400');
 for(const v of [{...payload(),wallet:'0x'+'b'.repeat(40)},{...payload(),runId:'x'.repeat(43)},{...payload(),product:{...payload().product,gold:'3400'}},{...payload(),order:{...payload().order,amount:'3400'}},{...payload(),order:{...payload().order,currency:'EMBEO'}},{...payload(),order:{...payload().order,serviceId:'fortune-bazi'}}])assert.throws(()=>parseCelestaoCheckout(v,runId,wallet),/INVALID_RESPONSE/);
});
test('late checkout response after a wallet change cannot create a trusted selection',async()=>{
 let auth=state(),resolve;const client=new CelestaoCheckoutClient({auth:()=>auth,now:()=>now,fetch:()=>new Promise(r=>resolve=r)});
 const pending=client.state(runId);auth={...auth,account:'0x'+'b'.repeat(40)};resolve(new Response(JSON.stringify(payload())));await assert.rejects(pending,/CONTEXT_CHANGED/);
});
test('quote never supplies prices, keeps the stable run id and requires the original live session',async()=>{
 let auth=state();const seen=[];const client=new CelestaoCheckoutClient({auth:()=>auth,now:()=>now,fetch:async(path,options)=>{seen.push({path,options});return new Response(JSON.stringify({orderId:payload().order.id}));}});
 assert.equal(await client.quote(runId),payload().order.id);assert.equal(seen[0].path,'/api/celestao-checkout/quote');
 assert.deepEqual(JSON.parse(seen[0].options.body),{runId,expectedAddress:wallet});assert.equal(seen[0].options.redirect,'error');
 auth={...auth,session:{...auth.session,expiresAt:now}};await assert.rejects(()=>client.quote(runId),/AUTH_REQUIRED/);assert.equal(seen.length,1);
});
test('the Celestao, 鼠道修仙 and GOLD guide light routes skip the World snapshot and renderer bootstrap',()=>{
 const main=readFileSync(new URL('../src/main.tsx',import.meta.url),'utf8');
 assert.match(main,/const lightEntry=celestialEntry\|\|celestialCheckout\|\|squeekEntry\|\|squeekCheckout\|\|goldGuide;/);
 assert.match(main,/if\(!marketEntry&&!lightEntry&&!collectionEntry&&!homeDemoEntry\)bootRead/);
 for(const file of ['CelestaoGateway.tsx','CelestaoCheckout.tsx','SqueekConnect.tsx','SqueekCheckout.tsx','GoldGuide.tsx']){const code=readFileSync(new URL('../src/world/'+file,import.meta.url),'utf8');assert.doesNotMatch(code,/WebGLRenderer|WorldBootstrap|new Scene\(/);}
});
