import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {readFileSync} from 'node:fs';
import {keccak256,stringToHex} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {ingestEconomyEvents,haltEconomyChain,createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import {goldAdminCommand,goldQuote,reconcileWorldGold,worldGoldSnapshot} from '../server/world-gold.ts';
import {fastCreditTopup,maintainFastGold,fastGoldReady} from '../server/world-gold-fast.ts';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';

// GOLD fast credit (migrations/0021, server/world-gold-fast.ts): credit at inclusion, settle at finality, revert or
// record a debt when the finalized cursor passes an unpaid credit. A fake RPC serves exactly the receipts and headers
// each case sets; the finalized ledger is driven with the real ingestion.
const NOW=Date.UTC(2026,9,26),OWNER=ECONOMY_TREASURY,ACCOUNT=privateKeyToAccount(generatePrivateKey()),W=ACCOUNT.address.toLowerCase();
const OTHER='0x'+'b'.repeat(40),PAYMENTS='0x'+'2'.repeat(40),PAID=keccak256(stringToHex('Paid(bytes32,address,address,address,uint256)'));
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),hex=n=>'0x'+BigInt(n).toString(16),word=a=>'0x'+a.slice(2).padStart(64,'0');
let seq=0;const rid=()=>`fast-request-${String(++seq).padStart(12,'0')}`;

function chain(){
  const blocks=new Map(),receipts=new Map(),calls=[];
  const header=n=>blocks.get(n)??{number:hex(n),hash:hash(0xb000+n),parentHash:hash(0xb000+n-1),timestamp:hex(Math.floor(NOW/1000)+n)};
  return {calls,receipts,
    reorg(n){blocks.set(n,{...header(n),hash:hash(0xc000+n)});},
    rpc:async(method,params)=>{calls.push(method);
      if(method==='eth_chainId')return '0x1';
      if(method==='eth_getBlockByNumber')return header(Number(BigInt(params[0])));
      if(method==='eth_getTransactionReceipt')return receipts.get(params[0])??null;
      throw Error('unexpected '+method);},
    blockHash:n=>header(n).hash,
    /** A mined Paid(orderId, payer, payer, token, treasury, amount) in block n. */
    pay(tx,n,{orderId,wallet=W,amount,token=ECONOMY_TOKEN,status='0x1',blockHash=header(n).hash,extraLogs=[]}){
      receipts.set(tx,{transactionHash:tx,status,blockNumber:hex(n),blockHash,from:wallet,to:PAYMENTS,logs:[...extraLogs,{
        address:PAYMENTS,topics:[PAID,orderId,word(wallet),word(token)],data:word(ECONOMY_TREASURY)+BigInt(amount).toString(16).padStart(64,'0'),
        transactionHash:tx,logIndex:'0x0',blockNumber:hex(n),blockHash,removed:false}]});
    }};
}
async function setup(){
  const db=openD1(),c=chain(),config=await defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,treasury:OWNER,stakingContract:'0x'+'1'.repeat(40),paymentContract:PAYMENTS,tokenDecimals:18,deploymentBlock:'100',catalogue:[]});
  const admin=command=>goldAdminCommand(db,{wallet:OWNER,requestId:rid(),command,reason:'fixture verified operation',nowMs:NOW,serviceReady:true});
  await admin({action:'product',product:'gold-pack',kind:'topup',title:'測試購點',gold:'10',embeo:'7000000000000000000',enabled:true,version:1});
  await admin({action:'product',product:'research',kind:'service',title:'測試研究',gold:'3',enabled:true,version:1});
  const quote=(product='gold-pack')=>goldQuote({db,config,nowMs:NOW,serviceReady:true},{wallet:W,requestId:rid(),product});
  const order=id=>db.raw.prepare('SELECT * FROM economy_orders WHERE id=?').get(id);
  const fast=(id,tx,wallet=W)=>fastCreditTopup(db,config,c.rpc,{wallet,orderId:id,transactionHash:tx,nowMs:NOW});
  let cursor=99;
  /** The finalized indexer advances to block `to`, with the given payments in their blocks. */
  const finalize=async(to,payments=[])=>{
    const events=payments.map(p=>({kind:'payment',transactionHash:p.tx,logIndex:0,blockNumber:String(p.block),blockHash:c.blockHash(p.block),timestamp:NOW+p.block,
      wallet:p.wallet??W,amount:p.amount??order(p.orderId).amount,orderId:p.orderId,token:config.token,receiver:config.treasury}));
    await ingestEconomyEvents(db,config,{fromBlock:String(cursor+1),toBlock:String(to),toBlockHash:c.blockHash(to),throughTimestamp:NOW+to,events});cursor=to;
  };
  const maintain=()=>maintainFastGold(db,config,c.rpc,NOW);
  const snapshot=()=>worldGoldSnapshot(db,W,NOW);
  const spend=async()=>{const id=await quote('research'),r=rid();const ch=await createEconomyGoldChallenge(db,config,{wallet:W,orderId:id,requestId:r,origin:'https://imdember.com',nowMs:NOW,serviceReady:true});
    return payEconomyOrderGold(db,config,{wallet:W,orderId:id,requestId:r,signature:await ACCOUNT.signMessage({message:ch.message}),origin:'https://imdember.com',nowMs:NOW,serviceReady:true});};
  /** balance = journal + world entries + fast entries, for every wallet (the recovery equation). */
  const balanced=()=>{
    const sums=db.raw.prepare(`SELECT wallet,SUM(delta) s FROM (SELECT wallet,delta FROM economy_gold_journal UNION ALL SELECT wallet,delta FROM world_gold_entries UNION ALL SELECT wallet,delta FROM world_gold_fast_entries) GROUP BY wallet`).all();
    for(const r of sums)assert.equal(db.raw.prepare('SELECT balance FROM economy_gold_accounts WHERE wallet=?').get(r.wallet)?.balance??0,r.s,'balance equation for '+r.wallet);
  };
  return {db,c,config,admin,quote,order,fast,finalize,maintain,snapshot,spend,balanced,close:()=>db.raw.close()};
}
const credit=f=>f.db.raw.prepare('SELECT * FROM world_gold_fast_credits').all();

test('migration 0021 is recognized and a fresh book has no fast credit',async()=>{const f=await setup();try{assert.equal(await fastGoldReady(f.db),true);assert.deepEqual(credit(f),[]);}finally{f.close();}});

test('a mined, canonical payment of the exact quote is credited at once, spendable, and idempotent',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa1);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});
  assert.deepEqual(await f.fast(id,tx),{status:'credited',gold:'10'});
  let s=await f.snapshot();assert.equal(s.book,'10');assert.equal(s.available,'10');
  const o=s.orders.find(o=>o.id===id);assert.equal(o.creditedGold,'10');assert.equal(o.fastCredit,'credited');assert.equal(o.status,'pending','the finalized indexer still owns the order status');
  assert.deepEqual(s.history.map(h=>[h.kind,h.delta]),[['topup','10']]);
  assert.deepEqual(await f.fast(id,tx),{status:'credited',gold:'10'},'repeat call');assert.equal((await f.snapshot()).book,'10');
  await f.spend();s=await f.snapshot();assert.equal(s.book,'7','fast GOLD pays a service');f.balanced();
}finally{f.close();}});

test('not mined yet, or mined in a block that is not canonical, waits without credit',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa2);
  assert.deepEqual(await f.fast(id,tx),{status:'waiting'});
  f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount,blockHash:hash(0xdead)});
  assert.deepEqual(await f.fast(id,tx),{status:'waiting'});assert.equal((await f.snapshot()).book,'0');assert.deepEqual(credit(f),[]);
}finally{f.close();}});

test('a transaction that is not exactly this quote’s payment is refused and credits nothing',async()=>{const f=await setup();try{
  const id=await f.quote(),other=await f.quote(),amount=f.order(id).amount;
  const cases=[['wrong amount',{orderId:id,amount:'1'},/PAYMENT_DOES_NOT_MATCH_ORDER/],['another payer',{orderId:id,amount,wallet:OTHER},/PAYMENT_DOES_NOT_MATCH_ORDER/],
    ['another order',{orderId:other,amount},/NO_PAYMENT_FOR_ORDER/],['failed transaction',{orderId:id,amount,status:'0x0'},/TRANSACTION_FAILED/],
    ['another token',{orderId:id,amount,token:'0x'+'9'.repeat(40)},/INVALID_EVENT_PAYMENT_ASSET/]];
  for(const [i,[label,args,code]] of cases.entries()){const tx=hash(0xb0+i);f.c.pay(tx,150+i,args);await assert.rejects(f.fast(id,tx),code,label);}
  await assert.rejects(f.fast(id,hash(0xb0),OTHER),/ORDER_NOT_FOUND/,'another wallet cannot use this order');
  const service=await f.quote('research');await assert.rejects(f.fast(service,hash(0xb0)),/NOT_A_TOPUP/);
  assert.equal((await f.snapshot()).book,'0');assert.deepEqual(credit(f),[]);
}finally{f.close();}});

test('finality settles a fast credit exactly once: one +10 in history, no double credit',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa3);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  await f.finalize(150,[{tx,block:150,orderId:id}]);await reconcileWorldGold(f.db,NOW);await reconcileWorldGold(f.db,NOW);
  const s=await f.snapshot();assert.equal(s.book,'10');assert.equal(credit(f)[0].state,'settled');
  assert.deepEqual(s.history.map(h=>[h.kind,h.delta]),[['topup','10']]);
  assert.deepEqual(f.db.raw.prepare('SELECT kind,delta FROM world_gold_fast_entries ORDER BY created_ms,kind').all().map(r=>[r.kind,r.delta]),[['fast-settle',-10],['fast-topup',10]]);
  assert.deepEqual(await f.fast(id,tx),{status:'credited',gold:'10'});f.balanced();
  assert.equal((await f.maintain()).reverted,0);
}finally{f.close();}});

test('admin repair of a fast-credited paid order also settles it once',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa4);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  await f.finalize(150,[{tx,block:150,orderId:id}]);await f.admin({action:'repair-topup',orderId:id});await reconcileWorldGold(f.db,NOW);
  assert.equal((await f.snapshot()).book,'10');assert.equal(credit(f)[0].state,'settled');f.balanced();
}finally{f.close();}});

test('a payment reorged away is reverted once the finalized cursor passes its block unpaid',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa5);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  f.c.receipts.delete(tx);f.c.reorg(150);
  const early=await f.maintain();assert.equal(early.reverted,0,'not final yet: wait');assert.deepEqual(early.failures,[],'waiting is not even attempted');
  assert.equal((await f.snapshot()).book,'10');
  await f.finalize(160);assert.equal((await f.maintain()).reverted,1);
  const s=await f.snapshot();assert.equal(s.book,'0');assert.equal(credit(f)[0].state,'reverted');
  assert.deepEqual(s.history.map(h=>[h.kind,h.delta]).sort(),[['fast-revert','-10'],['topup','10']]);
  assert.deepEqual(await f.fast(id,tx),{status:'reverted'});assert.equal((await f.maintain()).reverted,0);f.balanced();
}finally{f.close();}});

test('reverting GOLD already spent records a debt that blocks spending until credits repay it',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa6);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  await f.spend();f.c.receipts.delete(tx);await f.finalize(160);await f.maintain();
  assert.equal((await f.snapshot()).book,'0');assert.equal(f.db.raw.prepare('SELECT amount FROM world_gold_fast_debts').get().amount,3);
  const next=await f.quote();await f.finalize(161,[{tx:hash(0xa7),block:161,orderId:next}]);await reconcileWorldGold(f.db,NOW);
  assert.equal((await f.snapshot()).book,'10');await assert.rejects(f.spend(),/GOLD_DEBT_OUTSTANDING/);
  assert.equal((await f.maintain()).collected,1);
  assert.equal((await f.snapshot()).book,'7');assert.equal(f.db.raw.prepare('SELECT amount FROM world_gold_fast_debts').get().amount,0);
  await f.spend();assert.equal((await f.snapshot()).book,'4','spending is open again');f.balanced();
  assert.throws(()=>f.db.raw.exec('UPDATE world_gold_fast_debts SET amount=0'),/INVALID_FAST_DEBT_TRANSITION/);
}finally{f.close();}});

test('a payment re-included in a later block follows its new block and still settles',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa8),amount=f.order(id).amount;f.c.pay(tx,150,{orderId:id,amount});await f.fast(id,tx);
  f.c.reorg(150);f.c.pay(tx,152,{orderId:id,amount});
  assert.equal((await f.maintain()).moved,1);assert.equal(Number(credit(f)[0].block_number),152);
  await f.finalize(151);assert.equal((await f.maintain()).reverted,0,'its block is not final yet');
  await f.finalize(152,[{tx,block:152,orderId:id}]);await reconcileWorldGold(f.db,NOW);
  assert.equal((await f.snapshot()).book,'10');assert.equal(credit(f)[0].state,'settled');f.balanced();
}finally{f.close();}});

test('a payment paid late after its revert is credited by the finalized path, never twice',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xa9);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  f.c.receipts.delete(tx);await f.finalize(160);await f.maintain();assert.equal((await f.snapshot()).book,'0');
  await f.finalize(170,[{tx,block:170,orderId:id}]);await reconcileWorldGold(f.db,NOW);await f.maintain();
  assert.equal((await f.snapshot()).book,'10');f.balanced();
}finally{f.close();}});

test('canonical yet unpaid at finality is reported, never reverted by guess',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xaa);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  await f.finalize(160);const m=await f.maintain();
  assert.equal(m.reverted,0);assert.deepEqual(m.failures.map(x=>x.code),['FAST_CREDIT_UNPAID_AT_FINALITY']);assert.equal((await f.snapshot()).book,'10');
}finally{f.close();}});

test('an RPC outage never reverts: the credit waits for a definite answer',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xab);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);await f.finalize(160);
  const down=async()=>{throw Error('ECONOMY_RPC_UNAVAILABLE');};
  const m=await maintainFastGold(f.db,f.config,down,NOW);assert.equal(m.reverted,0);assert.equal(credit(f)[0].state,'credited');
  await assert.rejects(fastCreditTopup(f.db,f.config,down,{wallet:W,orderId:await f.quote(),transactionHash:hash(0xac),nowMs:NOW}),/CHAIN_UNAVAILABLE/);
}finally{f.close();}});

test('a halted economy or paused top-ups accept no new fast credit',async()=>{const f=await setup();try{
  const id=await f.quote(),tx=hash(0xad);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});
  await f.admin({action:'control',feature:'topup',enabled:false,version:0});await assert.rejects(f.fast(id,tx),/FEATURE_PAUSED/);
  await f.admin({action:'control',feature:'topup',enabled:true,version:1});await haltEconomyChain(f.db,f.config,'FINALIZED_REORG');
  await assert.rejects(f.fast(id,tx),/ECONOMY_HALTED/);assert.equal((await f.snapshot()).book,'0');
}finally{f.close();}});

test('the SQL guards refuse forged fast entries and illegal transitions',async()=>{const f=await setup();try{
  const id=await f.quote(),raw=f.db.raw;
  assert.throws(()=>raw.prepare("INSERT INTO world_gold_fast_entries VALUES(?,?,10,'fast-topup',?,?,?)").run('forged',W,'fast-topup:'+id,id,NOW),/FAST_TOPUP_NOT_CREDITED/);
  assert.throws(()=>raw.prepare("INSERT INTO world_gold_fast_credits VALUES(?,?,999,?,0,150,?,'credited',?,?)").run(id,W,hash(1),hash(2),NOW,NOW),/FAST_CREDIT_NOT_ELIGIBLE/);
  const tx=hash(0xae);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});await f.fast(id,tx);
  assert.throws(()=>raw.exec("UPDATE world_gold_fast_credits SET state='settled'"),/INVALID_FAST_CREDIT_TRANSITION/,'not paid yet');
  assert.throws(()=>raw.exec("UPDATE world_gold_fast_credits SET gold=20"),/INVALID_FAST_CREDIT_TRANSITION/);
  assert.throws(()=>raw.exec('DELETE FROM world_gold_fast_credits'),/IMMUTABLE_FAST_CREDIT/);
  assert.throws(()=>raw.exec('UPDATE world_gold_fast_entries SET delta=99'),/IMMUTABLE_JOURNAL/);
  assert.throws(()=>raw.exec('DELETE FROM world_gold_fast_entries'),/IMMUTABLE_JOURNAL/);
  assert.throws(()=>raw.prepare("INSERT INTO world_gold_fast_entries VALUES(?,?,-10,'fast-settle',?,?,?)").run('early-settle',W,'fast-settle:'+id,id,NOW),/FAST_SETTLE_NOT_ENTITLED/);
  assert.throws(()=>raw.prepare("INSERT INTO world_gold_fast_entries VALUES(?,?,-10,'fast-revert',?,?,?)").run('early-revert',W,'fast-revert:'+id,id,NOW),/FAST_REVERT_NOT_ENTITLED/);
  assert.equal((await f.snapshot()).book,'10');f.balanced();
}finally{f.close();}});

const ROOT='https://imdember.com',TOKEN='f'.repeat(43);
const post=(path,wallet,body)=>new Request(ROOT+path,{method:'POST',headers:{origin:ROOT,cookie:SESSION_COOKIE+'='+TOKEN,'content-type':'application/json'},body:JSON.stringify({expectedAddress:wallet,...body})});
test('the fast-credit route is retired (2026-10-27): a signed-in owner with a real payment gets 404 and no GOLD before finality',async()=>{const f=await setup();try{
  f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(await sha256(TOKEN),W,NOW-1,NOW+3600000,'fast-credit-api','EOA','ECDSA');
  const id=await f.quote(),tx=hash(0xaf);f.c.pay(tx,150,{orderId:id,amount:f.order(id).amount});
  const keys=[],deps={db:f.db,config:f.config,now:()=>NOW+10,client:'ip-a',allow:async k=>{keys.push(k);return true;},fastCredit:()=>assert.fail('no route may reach a fast credit')};
  for(const method of ['POST','GET']){
   const r=await handleWorldGoldApi(method==='POST'?post('/api/gold/orders/'+id+'/fast-credit',W,{transactionHash:tx}):new Request(ROOT+'/api/gold/orders/'+id+'/fast-credit?expected_address='+W,{headers:{cookie:SESSION_COOKIE+'='+TOKEN}}),deps);
   assert.equal(r.status,404,method);assert.equal((await r.json()).error,'NOT_FOUND');
  }
  assert.deepEqual(keys,[],'refused before any budget, session or chain read');assert.equal(credit(f).length,0);assert.equal((await f.snapshot()).book,'0');f.balanced();
  const src=readFileSync(new URL('../worker/app.ts',import.meta.url),'utf8');
  assert.doesNotMatch(src,/fastCreditTopup|maintainFastGold|GOLD_FAST_CREDIT|economy:fast/,'the Worker neither binds nor maintains fast credit');
}finally{f.close();}});
