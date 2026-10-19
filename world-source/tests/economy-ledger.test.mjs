import test from 'node:test';
import assert from 'node:assert/strict';
// Original standalone catalogue invariants; current shared route refusals are tested by Audit6.
import {openStandaloneEconomyD1 as openD1,migrationFiles} from './d1-sqlite.mjs';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_DAY_MS as DAY,ECONOMY_MAX_INTEGER as MAX,ECONOMY_SHARE_WEI as SHARE} from '../server/economy-config.ts';
import {ingestEconomyEvents,settleEconomy,economyChainState,economyWalletSnapshot,createEconomyOrder,createEconomyGoldChallenge,payEconomyOrderGold,haltEconomyChain} from '../server/economy-ledger.ts';
const ACCOUNT=privateKeyToAccount(generatePrivateKey()),T=Date.UTC(2026,9,16),W=ACCOUNT.address.toLowerCase(),OTHER='0x'+'b'.repeat(40);
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const raw={chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'local-fixture',titleZh:'本機測試',titleEn:'Local fixture',gold:'3',embeo:String(7n*10n**18n)}]};
const config=()=>defineEconomyConfig(raw);
function event(kind,block,time,shares='1',patch={}){return {kind,transactionHash:hash(1000+block),logIndex:0,blockNumber:String(block),blockHash:hash(block),timestamp:time,wallet:W,positionId:'1',shares,amount:String(BigInt(shares)*SHARE),...patch};}
const batch=(events,{fromBlock='100',toBlock='110',throughTimestamp=T+3*DAY,...patch}={})=>({events,fromBlock,toBlock,toBlockHash:hash(toBlock),throughTimestamp,...patch});
const count=(db,table)=>Number(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
const order=(db,c,patch={})=>createEconomyOrder(db,c,{wallet:W,requestId:'fixture-request-0001',serviceId:'local-fixture',currency:'GOLD',nowMs:T,...patch});
const signatures=new WeakMap();
async function signedPay(db,c,o,patch={}){
 const args={wallet:W,orderId:o.id,requestId:'payment-request-0001',nowMs:o.createdMs,origin:'https://imdember.com',...patch},key=o.id+args.requestId;
 let saved=signatures.get(db);if(!saved){saved=new Map();signatures.set(db,saved);}
 if(!saved.has(key)){const challenge=await createEconomyGoldChallenge(db,c,{...args,nowMs:o.createdMs});saved.set(key,await ACCOUNT.signMessage({message:challenge.message}));}
 return payEconomyOrderGold(db,c,{...args,signature:saved.get(key)});
}

test('new migration is independent, adds no old demo GOLD and requires signed-64-bit integer balances',()=>{
 assert.ok(migrationFiles().includes('0010_world_economy.sql'));const db=openD1();
 assert.equal(count(db,'economy_gold_accounts'),0);assert.equal(count(db,'economy_gold_journal'),0);
 assert.throws(()=>db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run(W,1.5));
 assert.throws(()=>db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run(W,-1));
 db.raw.close();
});
test('canonical chain, token, treasury and separated immutable contracts fail closed; catalogue price never resets scope',async()=>{
 const c=await config(),changed=await defineEconomyConfig({...raw,catalogue:[{...raw.catalogue[0],gold:'99'}]});assert.equal(c.id,changed.id);
 assert.notEqual(c.id,(await defineEconomyConfig({...raw,stakingContract:'0x'+'3'.repeat(40)})).id);
 for(const patch of [{chainId:10},{token:'0x'+'f'.repeat(40)},{tokenDecimals:6},{treasury:W},{stakingContract:raw.paymentContract},{deploymentBlock:'0'},{catalogue:[{...raw.catalogue[0],gold:'1.5'}]},{catalogue:[raw.catalogue[0],raw.catalogue[0]]}])await assert.rejects(defineEconomyConfig({...raw,...patch}));
 assert.ok(Object.isFrozen(c));assert.ok(Object.isFrozen(c.catalogue));
});
test('calendar lot accounting: noon deposit waits; partial withdrawal only cancels its portion; exact midnight preserves previous day',async()=>{
 const db=openD1(),c=await config();
 await ingestEconomyEvents(db,c,batch([
  event('stake',100,T+DAY/2,'10'),
  event('withdraw',101,T+DAY+DAY/2,'3'),
  event('stake',102,T+DAY+3*DAY/4,'2',{positionId:'2'}),
  event('withdraw',103,T+2*DAY,'1')
 ]));
 const result=await settleEconomy(db,c,{nowMs:T+3*DAY});assert.equal(result.settledDays,2);
 const snapshot=await economyWalletSnapshot(db,c,W);assert.equal(snapshot.gold,'15');assert.equal(snapshot.settledThroughMs,T+3*DAY);
 assert.deepEqual(snapshot.journal.map(j=>j.delta).sort(),['7','8']);
 assert.equal(snapshot.positions.find(p=>p.id==='1').shares,'6');
 assert.equal((await settleEconomy(db,c,{nowMs:T+3*DAY})).settledDays,0);assert.equal(count(db,'economy_gold_journal'),2);db.raw.close();
});
test('UTC midnight deposit qualifies immediately; pre-boundary withdrawal invalidates day and never claws back previous GOLD',async()=>{
 const db=openD1(),c=await config();
 await ingestEconomyEvents(db,c,batch([event('stake',100,T,'2')],{toBlock:'101',throughTimestamp:T+DAY}));
 await settleEconomy(db,c,{nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');
 await ingestEconomyEvents(db,c,batch([event('withdraw',102,T+2*DAY-1,'2')],{fromBlock:'102',toBlock:'103',throughTimestamp:T+2*DAY}));
 await settleEconomy(db,c,{nowMs:T+2*DAY});assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');assert.equal(count(db,'economy_gold_days'),2);db.raw.close();
});
test('reward waits for complete finalized indexing and wall clock, never rolling 24h or client timestamp',async()=>{
 const db=openD1(),c=await config();
 await ingestEconomyEvents(db,c,batch([event('stake',100,T+1,'1')],{toBlock:'101',throughTimestamp:T+2*DAY-1}));
 assert.equal((await settleEconomy(db,c,{nowMs:T+9*DAY})).settledDays,0);
 await ingestEconomyEvents(db,c,batch([],{fromBlock:'102',toBlock:'103',throughTimestamp:T+2*DAY}));
 assert.equal((await settleEconomy(db,c,{nowMs:T+2*DAY-1})).settledDays,0);
 assert.equal((await settleEconomy(db,c,{nowMs:T+2*DAY})).settledDays,1);assert.equal((await economyWalletSnapshot(db,c,W)).gold,'1');db.raw.close();
});
test('invalid ranges/assets/clocks write no facts; invalid finalized withdrawals roll back facts and persist only the integrity halt',async()=>{
 const c=await config();
 const bad=[batch([event('stake',100,T,'1',{amount:'1'})]),batch([event('stake',100,T,'1',{shares:'01'})]),batch([event('stake',100,T,'1',{shares:String(MAX+1n),amount:String((MAX+1n)*SHARE)})]),batch([event('stake',99,T)]),batch([event('stake',101,T),event('stake',100,T,'1',{positionId:'2'})]),batch([event('stake',100,T),event('stake',100,T,'1',{positionId:'2'})]),batch([event('stake',110,T,'1')]),batch([],{fromBlock:'101'}),batch([event('withdraw',100,T)]),batch([event('stake',100,T),event('withdraw',101,T+1,'2')]),batch([event('stake',100,T),event('withdraw',101,T+1,'1',{wallet:OTHER})])];
 for(const [i,input] of bad.entries()){const db=openD1();try{
  const invalidWithdrawal=i>=bad.length-3;
  await assert.rejects(ingestEconomyEvents(db,c,input),invalidWithdrawal?/ECONOMY_HALTED/:undefined);
  assert.equal(count(db,'economy_chain_events'),0);assert.equal(count(db,'economy_positions'),0);assert.equal(count(db,'economy_ingestions'),0);
  assert.equal(count(db,'economy_chain_state'),invalidWithdrawal?1:0);
  if(invalidWithdrawal)assert.deepEqual(await economyChainState(db,c),{lastBlock:'99',lastHash:'',throughMs:0,haltedReason:'INVALID_POSITION_WITHDRAWAL'});
 }finally{db.raw.close();}}
});
test('identical retry and concurrent identical ingestion settle once; gaps, altered old log and cursor rewind denied',async()=>{
 const db=openD1(),c=await config(),input=batch([event('stake',100,T)]);
 const results=await Promise.all([ingestEconomyEvents(db,c,input),ingestEconomyEvents(db,c,input)]);assert.equal(results.filter(x=>x.replayed).length,1);
 assert.equal((await ingestEconomyEvents(db,c,input)).replayed,true);assert.equal(count(db,'economy_positions'),1);
 await assert.rejects(ingestEconomyEvents(db,c,batch([event('stake',100,T,'2')])));
 await assert.rejects(ingestEconomyEvents(db,c,batch([],{fromBlock:'112',toBlock:'113'})));
 assert.equal((await economyChainState(db,c)).lastBlock,'110');
 await Promise.all([settleEconomy(db,c,{nowMs:T+3*DAY}),settleEconomy(db,c,{nowMs:T+3*DAY})]);
 assert.equal((await economyWalletSnapshot(db,c,W)).gold,'3');assert.equal(count(db,'economy_gold_journal'),3);db.raw.close();
});
test('integer values above JS safe range retain exact decimal strings and arithmetic, and balance overflow aborts settlement atomically',async()=>{
 const db=openD1(),c=await config(),n=9_007_199_254_740_993n;
 await ingestEconomyEvents(db,c,batch([event('stake',100,T,String(n))],{throughTimestamp:T+DAY}));
 await settleEconomy(db,c,{nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,c,W)).gold,String(n));
 db.raw.prepare('UPDATE economy_gold_accounts SET balance=? WHERE wallet=?').run(String(MAX),W);
 await ingestEconomyEvents(db,c,batch([],{fromBlock:'111',toBlock:'112',throughTimestamp:T+2*DAY}));
 await assert.rejects(settleEconomy(db,c,{nowMs:T+2*DAY}));assert.equal(count(db,'economy_gold_days'),1);assert.equal(count(db,'economy_gold_journal'),1);assert.equal((await economyWalletSnapshot(db,c,W)).gold,String(MAX));db.raw.close();
});
test('order price is server catalogue snapshot; requests are wallet scoped, name independent and mismatch rejected',async()=>{
 const db=openD1(),c=await config(),a=await order(db,c);
 const changed=await defineEconomyConfig({...raw,catalogue:[{...raw.catalogue[0],gold:'10'}]});assert.deepEqual(await order(db,changed),a);assert.equal(a.amount,'3');
 assert.notEqual((await order(db,c,{wallet:OTHER})).id,a.id);
 await assert.rejects(order(db,c,{currency:'EMBEO'}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(order(db,c,{requestId:'fixture-request-0002',serviceId:'invented-service'}),/SERVICE_UNAVAILABLE/);
 await assert.rejects(order(db,await defineEconomyConfig({...raw,catalogue:[]}),{requestId:'fixture-request-0003'}),/SERVICE_UNAVAILABLE/);
 assert.equal(count(db,'economy_orders'),2);db.raw.close();
});
test('persisted quotes, chain events and GOLD journals are append-only financial evidence',async()=>{
 const db=openD1(),c=await config(),o=await order(db,c);
 await ingestEconomyEvents(db,c,batch([event('stake',100,T)],{throughTimestamp:T+DAY}));await settleEconomy(db,c,{nowMs:T+DAY});
 for(const sql of ["UPDATE economy_orders SET amount='1'", "UPDATE economy_orders SET wallet='"+OTHER+"'", 'UPDATE economy_chain_events SET at_ms=0', 'DELETE FROM economy_chain_events', 'UPDATE economy_gold_journal SET delta=999', 'DELETE FROM economy_gold_journal'])assert.throws(()=>db.raw.exec(sql),/IMMUTABLE/);
 assert.equal((await economyWalletSnapshot(db,c,W)).gold,'1');assert.equal((await economyWalletSnapshot(db,c,W)).orders.find(x=>x.id===o.id).amount,'3');db.raw.close();
});
test('GOLD payment is atomic and idempotent: concurrent spend cannot go negative or grant without debit',async()=>{
 const db=openD1(),c=await config();await ingestEconomyEvents(db,c,batch([event('stake',100,T,'5')],{throughTimestamp:T+DAY}));await settleEconomy(db,c,{nowMs:T+DAY});
 const a=await order(db,c,{nowMs:T+DAY}),b=await order(db,c,{nowMs:T+DAY,requestId:'fixture-request-0002'});
 const pay=o=>signedPay(db,c,o);
 const results=await Promise.allSettled([pay(a),pay(b)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/INSUFFICIENT_GOLD/);
 assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');assert.equal(count(db,'economy_fulfillments'),1);assert.equal(count(db,'economy_gold_journal'),2);
 const paid=results.find(x=>x.status==='fulfilled').value;assert.equal((await pay(paid)).status,'paid');assert.equal(count(db,'economy_fulfillments'),1);
 await assert.rejects(payEconomyOrderGold(db,c,{wallet:W,orderId:paid.id,requestId:'payment-request-0002',nowMs:T+DAY}),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(payEconomyOrderGold(db,c,{wallet:OTHER,orderId:paid.id,requestId:'payment-request-0001',nowMs:T+DAY}),/ORDER_NOT_FOUND/);db.raw.close();
});
test('insufficient balance, expired order and fulfillment failure leave all balances/journals/order status unchanged',async()=>{
 const db=openD1(),c=await config(),a=await order(db,c);
 await assert.rejects(signedPay(db,c,a),/INSUFFICIENT_GOLD/);assert.equal(count(db,'economy_gold_journal'),0);assert.equal(count(db,'economy_fulfillments'),0);assert.equal(db.raw.prepare('SELECT consumed_ms at FROM economy_gold_challenges').get().at,null);
 await assert.rejects(signedPay(db,c,a,{nowMs:T+900000}),/CHALLENGE_EXPIRED/);
 db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run(W,10);
 db.raw.exec("CREATE TRIGGER fail_entitlement BEFORE INSERT ON economy_fulfillments BEGIN SELECT RAISE(ABORT,'synthetic fulfillment failure'); END;");
 await assert.rejects(signedPay(db,c,a),/synthetic fulfillment failure/);
 assert.equal((await economyWalletSnapshot(db,c,W)).gold,'10');assert.equal(count(db,'economy_gold_journal'),0);assert.equal((await economyWalletSnapshot(db,c,W)).orders[0].status,'pending');db.raw.close();
});
test('EMBEO requires exact order-bound verified event and amount; wrong payer/unmatched logs never grant an entitlement',async()=>{
 for(const patch of [{wallet:OTHER},{amount:'1'},{orderId:hash(999)}]){
  const db=openD1(),c=await config(),o=await order(db,c,{currency:'EMBEO'});
  const e={kind:'payment',transactionHash:hash(1000),logIndex:0,blockNumber:'100',blockHash:hash(100),timestamp:T,wallet:W,amount:o.amount,orderId:o.id,token:c.token,receiver:c.treasury,...patch};
  await ingestEconomyEvents(db,c,batch([e]));assert.equal(count(db,'economy_chain_events'),1);assert.equal(count(db,'economy_fulfillments'),0);assert.equal((await economyWalletSnapshot(db,c,W)).orders[0].status,'pending');db.raw.close();
 }
 const db=openD1(),c=await config(),o=await order(db,c,{currency:'EMBEO'}),e={kind:'payment',transactionHash:hash(1000),logIndex:0,blockNumber:'100',blockHash:hash(100),timestamp:T+900000,wallet:W,amount:o.amount,orderId:o.id,token:c.token,receiver:c.treasury};
 const input=batch([e]);await ingestEconomyEvents(db,c,input);await ingestEconomyEvents(db,c,input);assert.equal(count(db,'economy_fulfillments'),1);assert.equal(count(db,'economy_gold_journal'),0);assert.equal((await economyWalletSnapshot(db,c,W)).orders[0].status,'paid');db.raw.close();
});
test('GOLD money signature binds wallet, order, amount, origin and nonce; old SIWE, wrong signer and cross-order signatures cannot spend',async()=>{
 const db=openD1(),c=await config(),a=await order(db,c),b=await order(db,c,{requestId:'fixture-request-0002'});
 db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run(W,20);
 const requestId='payment-request-0001',origin='https://imdember.com',challenge=await createEconomyGoldChallenge(db,c,{wallet:W,orderId:a.id,requestId,origin,nowMs:T});
 const good=await ACCOUNT.signMessage({message:challenge.message}),wrong=privateKeyToAccount(generatePrivateKey());
 const pay=(patch={})=>payEconomyOrderGold(db,c,{wallet:W,orderId:a.id,requestId,origin,nowMs:T,signature:good,...patch});
 for(const signature of [undefined,'0x1234',await wrong.signMessage({message:challenge.message}),await ACCOUNT.signMessage({message:'Sign in to IMD Ember World.'}),await ACCOUNT.signMessage({message:challenge.message.replace('Amount: 3 GOLD','Amount: 2 GOLD')})])await assert.rejects(pay({signature}),/INVALID_GOLD_SIGNATURE/);
 await createEconomyGoldChallenge(db,c,{wallet:W,orderId:b.id,requestId,origin,nowMs:T});await assert.rejects(pay({orderId:b.id}),/INVALID_GOLD_SIGNATURE/);
 await assert.rejects(pay({origin:'https://evil.test'}),/GOLD_SIGNATURE_REQUIRED/);
 await assert.rejects(pay({nowMs:T+300000}),/CHALLENGE_EXPIRED/);assert.equal((await economyWalletSnapshot(db,c,W)).gold,'20');
 assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_challenges WHERE consumed_ms IS NOT NULL').get().n,0);
 assert.equal((await pay()).status,'paid');assert.equal((await pay()).status,'paid');assert.equal((await economyWalletSnapshot(db,c,W)).gold,'17');assert.equal(count(db,'economy_fulfillments'),1);db.raw.close();
});
test('finalized cursor anomaly durably halts issuance and new payments, retaining prior balances and positions for independent principal withdrawal',async()=>{
 const db=openD1(),c=await config();await ingestEconomyEvents(db,c,batch([event('stake',100,T,'5')],{throughTimestamp:T+DAY}));await settleEconomy(db,c,{nowMs:T+DAY});
 const o=await order(db,c,{nowMs:T+DAY});await haltEconomyChain(db,c,'FINALIZED_CURSOR_CHANGED');await haltEconomyChain(db,c,'SECOND_REASON');
 for(const action of [()=>settleEconomy(db,c,{nowMs:T+2*DAY}),()=>ingestEconomyEvents(db,c,batch([],{fromBlock:'111',toBlock:'112',throughTimestamp:T+2*DAY})),()=>order(db,c,{requestId:'fixture-request-0002'}),()=>signedPay(db,c,o)])await assert.rejects(action(),/ECONOMY_HALTED/);
 const s=await economyWalletSnapshot(db,c,W);assert.equal(s.chain.haltedReason,'FINALIZED_CURSOR_CHANGED');assert.equal(s.gold,'5');assert.equal(s.positions[0].shares,'5');assert.equal(count(db,'economy_fulfillments'),0);db.raw.close();
});
