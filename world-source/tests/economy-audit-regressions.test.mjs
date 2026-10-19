import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {readFileSync} from 'node:fs';
// Original standalone catalogue invariants; current shared route refusals are tested by Audit6.
import {openStandaloneEconomyD1 as openD1,migrationFiles} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy,economyWalletSnapshot,createEconomyOrder,createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
const T=Date.UTC(2026,9,1),account=privateKeyToAccount(generatePrivateKey()),W=account.address.toLowerCase();
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const raw={chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'audit-fixture',titleZh:'本機測試',titleEn:'Local fixture',gold:'1',embeo:String(10n**18n)}]};
const cfg=patch=>defineEconomyConfig({...raw,...patch});
function legacyD1(){const db=openD1();db.raw.exec('DROP TRIGGER economy_reward_progress_binding; DROP TRIGGER economy_reward_binding_no_change; DROP TRIGGER economy_reward_binding_no_delete; DROP TABLE economy_reward_bindings;');return db;}
async function oneDay(db,c){
 const start=BigInt(c.deploymentBlock);
 if(start<100n)await ingestEconomyEvents(db,c,{fromBlock:String(start),toBlock:'99',toBlockHash:hash(99),throughTimestamp:T-1000,events:[]});
 await ingestEconomyEvents(db,c,{fromBlock:'100',toBlock:'101',toBlockHash:hash(101),throughTimestamp:T+DAY,events:[{kind:'stake',transactionHash:hash(1000),logIndex:0,blockNumber:'100',blockHash:hash(100),timestamp:T,wallet:W,positionId:'1',shares:'1',amount:String(SHARE)}]});
}
test('same deployed staking contract cannot re-credit one UTC share-day through a deployment-block or payment-contract re-pin',async()=>{
 for(const patch of [{deploymentBlock:'99'},{paymentContract:'0x'+'3'.repeat(40)}]){
  const db=openD1(),a=await cfg(),b=await cfg(patch);try{
   await oneDay(db,a);await settleEconomy(db,a,{nowMs:T+DAY+1});assert.equal((await economyWalletSnapshot(db,a,W)).gold,'1');
   await oneDay(db,b);await assert.rejects(settleEconomy(db,b,{nowMs:T+DAY+1}),/ECONOMY_CONFIG_CONFLICT/);
   assert.equal((await economyWalletSnapshot(db,a,W)).gold,'1');assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM economy_gold_journal WHERE kind='utc-reward'").get().n,1);
   await settleEconomy(db,a,{nowMs:T+DAY+2});assert.equal((await economyWalletSnapshot(db,a,W)).gold,'1');
  }finally{db.raw.close();}
 }
});
test('a correctly signed completed GOLD payment stays idempotent after its challenge and quote expire; expired NEW debits and wrong signatures remain rejected',async()=>{
 const db=openD1(),c=await cfg();try{
  await oneDay(db,c);await settleEconomy(db,c,{nowMs:T+DAY+1});
  const start=T+DAY+1000,order=await createEconomyOrder(db,c,{wallet:W,requestId:'audit-gold-order-001',serviceId:'audit-fixture',currency:'GOLD',nowMs:start});
  const challenge=await createEconomyGoldChallenge(db,c,{wallet:W,orderId:order.id,requestId:'audit-gold-proof-001',origin:'https://imdember.com',nowMs:start+1});
  const signature=await account.signMessage({message:challenge.message}),args={wallet:W,orderId:order.id,requestId:challenge.requestId,origin:challenge.origin,signature,nowMs:start+2};
  const paid=await payEconomyOrderGold(db,c,args);assert.equal(paid.status,'paid');
  for(const time of [challenge.expiresMs,order.expiresMs+1,start+DAY])assert.deepEqual(await payEconomyOrderGold(db,c,{...args,nowMs:time}),paid);
  assert.deepEqual(await createEconomyOrder(db,c,{wallet:W,requestId:'audit-gold-order-001',serviceId:'audit-fixture',currency:'GOLD',nowMs:start+DAY}),paid);
  await assert.rejects(payEconomyOrderGold(db,c,{...args,signature:'0x'+'0'.repeat(130),nowMs:start+DAY}),/INVALID_GOLD_SIGNATURE/);
  await assert.rejects(payEconomyOrderGold(db,c,{...args,requestId:'different-proof-001',nowMs:start+DAY}),/IDEMPOTENCY_CONFLICT/);
  assert.equal((await economyWalletSnapshot(db,c,W)).gold,'0');assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM economy_gold_journal WHERE kind='service-payment'").get().n,1);
  const fresh=await createEconomyOrder(db,c,{wallet:W,requestId:'audit-gold-order-002',serviceId:'audit-fixture',currency:'GOLD',nowMs:start});
  const expired=await createEconomyGoldChallenge(db,c,{wallet:W,orderId:fresh.id,requestId:'audit-gold-proof-002',origin:args.origin,nowMs:start});
  await assert.rejects(payEconomyOrderGold(db,c,{...args,orderId:fresh.id,requestId:expired.requestId,signature:await account.signMessage({message:expired.message}),nowMs:expired.expiresMs}),/CHALLENGE_EXPIRED/);
  assert.equal(db.raw.prepare('SELECT status FROM economy_orders WHERE id=?').get(fresh.id).status,'pending');
 }finally{db.raw.close();}
});
test('catalogue edits preserve the reward binding; separate deployed vaults can independently earn into the same wallet',async()=>{
 const db=openD1(),a=await cfg(),price=await cfg({catalogue:[{...raw.catalogue[0],gold:'9'}]}),other=await cfg({stakingContract:'0x'+'4'.repeat(40)});try{
  await oneDay(db,a);await settleEconomy(db,a,{nowMs:T+DAY+1});await settleEconomy(db,price,{nowMs:T+DAY+2});assert.equal((await economyWalletSnapshot(db,a,W)).gold,'1');
  await oneDay(db,other);await settleEconomy(db,other,{nowMs:T+DAY+1});assert.equal((await economyWalletSnapshot(db,a,W)).gold,'2');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_reward_bindings').get().n,2);
  assert.throws(()=>db.raw.exec("UPDATE economy_reward_bindings SET config_id='different'"),/ECONOMY_CONFIG_CONFLICT/);assert.throws(()=>db.raw.exec('DELETE FROM economy_reward_bindings'),/ECONOMY_CONFIG_CONFLICT/);
 }finally{db.raw.close();}
});
test('concurrent first settlements of two config aliases atomically choose one reward stream, never two credits',async()=>{
 const db=openD1(),a=await cfg(),b=await cfg({deploymentBlock:'99'});try{
  await oneDay(db,a);await oneDay(db,b);const results=await Promise.allSettled([settleEconomy(db,a,{nowMs:T+DAY+1}),settleEconomy(db,b,{nowMs:T+DAY+1})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.match(String(results.find(r=>r.status==='rejected').reason),/ECONOMY_CONFIG_CONFLICT/);
  assert.equal(db.raw.prepare('SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?').get(W).balance,'1');assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_journal').get().n,1);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_reward_bindings').get().n,1);
 }finally{db.raw.close();}
});
test('additive reward migration preserves a legacy partial day; a new alias cannot adopt it and the original config finishes without re-credit',async()=>{
 const db=legacyD1(),a=await cfg(),b=await cfg({deploymentBlock:'99'});try{
  const wallets=Array.from({length:40},(_,i)=>'0x'+(1000+i).toString(16).padStart(40,'0'));
  const events=wallets.map((wallet,i)=>({kind:'stake',transactionHash:hash(1000+i),logIndex:i,blockNumber:'100',blockHash:hash(100),timestamp:T,wallet,positionId:String(i+1),shares:'1',amount:String(SHARE)}));
  await ingestEconomyEvents(db,a,{fromBlock:'100',toBlock:'101',toBlockHash:hash(101),throughTimestamp:T+DAY,events});
  // Exact legacy shape after a 32-wallet page, independently seeded before0012.
  db.raw.prepare('INSERT INTO economy_day_progress(config_id,day_start_ms,position_ceiling,last_wallet,last_position,version) VALUES(?,?,?,?,?,1)').run(a.id,T,'40'.padStart(78,'0'),wallets[31],'32');
  for(const wallet of wallets.slice(0,32)){const ref=`${a.id}:${T}:${wallet}`;db.raw.prepare("INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms) VALUES(?,?,1,'utc-reward',?,?)").run('reward:'+ref,wallet,ref,T+DAY);}
  const before=db.raw.prepare('SELECT * FROM economy_gold_journal ORDER BY id').all();db.raw.exec(readFileSync(new URL('../migrations/0012_economy_reward_bindings.sql',import.meta.url),'utf8'));
  assert.deepEqual(db.raw.prepare('SELECT * FROM economy_gold_journal ORDER BY id').all(),before);
  await ingestEconomyEvents(db,b,{fromBlock:'99',toBlock:'99',toBlockHash:hash(99),throughTimestamp:T-1,events:[]});await ingestEconomyEvents(db,b,{fromBlock:'100',toBlock:'101',toBlockHash:hash(101),throughTimestamp:T+DAY,events});
  await assert.rejects(settleEconomy(db,b,{nowMs:T+DAY+1}),/ECONOMY_CONFIG_CONFLICT/);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_journal').get().n,32);
  assert.equal((await settleEconomy(db,a,{nowMs:T+DAY+1})).settledDays,1);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_journal').get().n,40);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_accounts WHERE balance=1').get().n,40);
  for(const row of before)assert.deepEqual(db.raw.prepare('SELECT * FROM economy_gold_journal WHERE id=?').get(row.id),row);
 }finally{db.raw.close();}
});
test('an expired pending quote replay is ORDER_EXPIRED; a new explicit request obtains a fresh quote and the old quote remains immutable',async()=>{
 for(const currency of ['GOLD','EMBEO']){const db=openD1(),c=await cfg();try{
  const args={wallet:W,requestId:'audit-expired-quote-01',serviceId:'audit-fixture',currency,nowMs:T},old=await createEconomyOrder(db,c,args);
  await assert.rejects(createEconomyOrder(db,c,{...args,nowMs:old.expiresMs}),/ORDER_EXPIRED/);
  const fresh=await createEconomyOrder(db,c,{...args,requestId:'audit-renewed-quote-01',nowMs:old.expiresMs+1});
  assert.notEqual(fresh.id,old.id);assert.ok(fresh.expiresMs>old.expiresMs);
  assert.equal(db.raw.prepare('SELECT expires_ms FROM economy_orders WHERE id=?').get(old.id).expires_ms,old.expiresMs);
 }finally{db.raw.close();}}
});
test('ambiguous legacy config histories never auto-bind or rewrite prior GOLD during migration',async()=>{
 const db=legacyD1(),a=await cfg(),b=await cfg({deploymentBlock:'99'});try{
  for(const c of[a,b]){await oneDay(db,c);db.raw.prepare('INSERT INTO economy_day_progress(config_id,day_start_ms,position_ceiling) VALUES(?,?,?)').run(c.id,T,'1'.padStart(78,'0'));const ref=`${c.id}:${T}:${W}`;db.raw.prepare("INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms) VALUES(?,?,1,'utc-reward',?,?)").run('reward:'+ref,W,ref,T+DAY);}
  const before=db.raw.prepare('SELECT * FROM economy_gold_journal ORDER BY id').all();db.raw.exec(readFileSync(new URL('../migrations/0012_economy_reward_bindings.sql',import.meta.url),'utf8'));
  for(const c of[a,b])await assert.rejects(settleEconomy(db,c,{nowMs:T+DAY+1}),/ECONOMY_CONFIG_CONFLICT/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_reward_bindings').get().n,0);assert.deepEqual(db.raw.prepare('SELECT * FROM economy_gold_journal ORDER BY id').all(),before);assert.equal((await economyWalletSnapshot(db,a,W)).gold,'2');
 }finally{db.raw.close();}
});
