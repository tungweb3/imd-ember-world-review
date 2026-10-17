import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {createEconomyOrder,ingestEconomyEvents,economyWalletSnapshot} from '../server/economy-ledger.ts';
import {parseEconomySnapshot} from '../src/world/economyClient.ts';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';

const NOW=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),H='0x'+'b'.repeat(64);
const raw={chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'snapshot-fixture',titleZh:'本機測試',titleEn:'Local fixture',gold:'1',embeo:'7'}]};
async function paidSnapshot(offset){
 const db=openD1(),config=await defineEconomyConfig(raw);
 try{
  const quote=await createEconomyOrder(db,config,{wallet:W,requestId:'cross-boundary-snapshot-0001',serviceId:'snapshot-fixture',currency:'EMBEO',nowMs:NOW+750});
  await ingestEconomyEvents(db,config,{fromBlock:'100',toBlock:'100',toBlockHash:H,throughTimestamp:NOW+offset,events:[{kind:'payment',transactionHash:'0x'+'c'.repeat(64),logIndex:0,blockNumber:'100',blockHash:H,timestamp:NOW+offset,wallet:W,amount:'7',orderId:quote.id,token:ECONOMY_TOKEN,receiver:ECONOMY_TREASURY}]});
  const snapshot=await economyWalletSnapshot(db,config,W);
  assert.equal(snapshot.orders[0].status,'paid');
  return snapshot;
 }finally{db.raw.close();}
}
test('ordinary fulfilled EMBEO snapshot after quote creation parses',async()=>{
 const snapshot=await paidSnapshot(1000);assert.doesNotThrow(()=>parseEconomySnapshot(snapshot,W));
});
test('same-slot fulfilled EMBEO snapshot remains readable when validated block time precedes quote milliseconds',async()=>{
 const snapshot=await paidSnapshot(0);
 assert.equal(snapshot.orders[0].createdMs-snapshot.orders[0].paidMs,750);
 assert.doesNotThrow(()=>parseEconomySnapshot(snapshot,W),'a fulfilled exact EMBEO order must not poison the entire client account snapshot');
});
test('GOLD paid before quote creation remains an invalid server response',async()=>{
 const snapshot=await paidSnapshot(1000);snapshot.orders[0].currency='GOLD';snapshot.orders[0].paidMs=NOW;
 assert.throws(()=>parseEconomySnapshot(snapshot,W),/INVALID_RESPONSE/);
});
for(const [field,value] of [['currency',['GOLD']],['currency',['EMBEO']],['status',['pending']],['status',['paid']]])test(`snapshot order ${field} rejects a coercible JSON array ${JSON.stringify(value)}`,async()=>{
 const snapshot=await paidSnapshot(1000);snapshot.orders[0][field]=value;
 if(field==='status'&&value[0]==='pending')snapshot.orders[0].paidMs=null;
 assert.throws(()=>parseEconomySnapshot(snapshot,W),/INVALID_RESPONSE/);
});

test('a later request clock before the persisted GOLD quote cannot create a challenge',async()=>{
 const db=openD1(),config=await defineEconomyConfig(raw);
 try{
  const order=await createEconomyOrder(db,config,{wallet:W,requestId:'clock-quote-challenge-0001',serviceId:'snapshot-fixture',currency:'GOLD',nowMs:NOW+1000,now:()=>NOW+1000});
  await assert.rejects(createEconomyGoldChallenge(db,config,{wallet:W,orderId:order.id,requestId:'clock-challenge-request-0001',origin:'https://imdember.com',nowMs:NOW,now:()=>NOW}),/INVALID_SETTLEMENT_CLOCK/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_challenges').get().n,0);
  assert.equal(db.raw.prepare('SELECT status FROM economy_orders').get().status,'pending');
 }finally{db.raw.close();}
});

for(const [label,paymentOffset] of [['before quote creation',0],['after quote but before challenge issuance',1500]])test(`a later request clock ${label} cannot debit GOLD or consume the signed challenge`,async()=>{
 const db=openD1(),config=await defineEconomyConfig(raw),account=privateKeyToAccount(generatePrivateKey()),wallet=account.address.toLowerCase();
 try{
  db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,9)').run(wallet);
  const order=await createEconomyOrder(db,config,{wallet,requestId:'clock-quote-payment-0001',serviceId:'snapshot-fixture',currency:'GOLD',nowMs:NOW+1000,now:()=>NOW+1000});
  const requestId='clock-signed-payment-0001',challenge=await createEconomyGoldChallenge(db,config,{wallet,orderId:order.id,requestId,origin:'https://imdember.com',nowMs:NOW+2000,now:()=>NOW+2000});
  const signature=await account.signMessage({message:challenge.message}),nowMs=NOW+paymentOffset;
  await assert.rejects(payEconomyOrderGold(db,config,{wallet,orderId:order.id,requestId,origin:'https://imdember.com',signature,nowMs,now:()=>nowMs}),/INVALID_SETTLEMENT_CLOCK/);
  assert.equal((await economyWalletSnapshot(db,config,wallet)).gold,'9');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_gold_journal').get().n,0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,0);
  assert.equal(db.raw.prepare('SELECT consumed_ms FROM economy_gold_challenges').get().consumed_ms,null);
  assert.equal(db.raw.prepare('SELECT status FROM economy_orders').get().status,'pending');
 }finally{db.raw.close();}
});

test('a nondecreasing request clock completes signed GOLD payment and the account snapshot remains readable',async()=>{
 const db=openD1(),config=await defineEconomyConfig(raw),account=privateKeyToAccount(generatePrivateKey()),wallet=account.address.toLowerCase();
 try{
  db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,9)').run(wallet);
  const order=await createEconomyOrder(db,config,{wallet,requestId:'clock-positive-order-0001',serviceId:'snapshot-fixture',currency:'GOLD',nowMs:NOW+1000,now:()=>NOW+1000});
  const requestId='clock-positive-payment-0001',challenge=await createEconomyGoldChallenge(db,config,{wallet,orderId:order.id,requestId,origin:'https://imdember.com',nowMs:NOW+2000,now:()=>NOW+2000});
  const signature=await account.signMessage({message:challenge.message});
  const paid=await payEconomyOrderGold(db,config,{wallet,orderId:order.id,requestId,origin:'https://imdember.com',signature,nowMs:NOW+2001,now:()=>NOW+2001});
  assert.equal(paid.status,'paid');assert.equal(paid.paidMs,NOW+2001);
  assert.equal(parseEconomySnapshot(await economyWalletSnapshot(db,config,wallet),wallet).gold,'8');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM economy_fulfillments').get().n,1);
 }finally{db.raw.close();}
});
