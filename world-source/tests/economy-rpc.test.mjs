import test from 'node:test';
import assert from 'node:assert/strict';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_SHARE_WEI as SHARE,ECONOMY_DAY_MS as DAY} from '../server/economy-config.ts';
import {economyChainState,economyWalletSnapshot,createEconomyOrder} from '../server/economy-ledger.ts';
import {createEconomyRpc,syncEconomyChain,ECONOMY_EVENT_TOPICS,EconomyRpcError} from '../server/economy-rpc.ts';
import {pendingEconomyBlock} from '../server/economy-staging.ts';
import {ALCHEMY_RPC_URL} from '../server/ownership.ts';

const T=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),OTHER='0x'+'b'.repeat(40),VAULT='0x'+'1'.repeat(40),PAYMENTS='0x'+'2'.repeat(40);
const H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),Q=n=>'0x'+BigInt(n).toString(16),U=n=>BigInt(n).toString(16).padStart(64,'0'),A=a=>a.slice(2).padStart(64,'0');
const config=()=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:VAULT,paymentContract:PAYMENTS,treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'fixture',titleZh:'測試',titleEn:'Fixture',gold:'1',embeo:'7'}]});
const block=n=>({number:Q(n),hash:H(n),parentHash:H(n-1),timestamp:Q((T+(n-100)*DAY)/1000),gasLimit:Q(96_000_000)});
function stake({n=100,index=0,shares=2n,position=1n,wallet=W,tx=H(10000+n)}={}){return {address:VAULT,topics:[ECONOMY_EVENT_TOPICS.stake,'0x'+A(wallet),'0x'+U(position)],data:'0x'+U(shares)+U(shares*SHARE),transactionHash:tx,blockNumber:Q(n),blockHash:H(n),logIndex:Q(index),removed:false};}
function payment(orderId,{n=100,index=0,wallet=W,amount=7n}={}){return {address:PAYMENTS,topics:[ECONOMY_EVENT_TOPICS.payment,orderId,'0x'+A(wallet),'0x'+A(ECONOMY_TOKEN)],data:'0x'+A(ECONOMY_TREASURY)+U(amount),transactionHash:H(20000+n),blockNumber:Q(n),blockHash:H(n),logIndex:Q(index),removed:false};}
function fixture({head=101,logs=[stake()],override}={}){
  const calls=[],state={head,logs};
  const rpc=async(method,params)=>{
    calls.push({method,params:structuredClone(params)});
    let value;
    if(method==='eth_chainId')value='0x1';
    else if(method==='eth_getBlockByNumber')value=block(params[0]==='finalized'?state.head:Number(BigInt(params[0])));
    else if(method==='eth_getLogs')value=state.logs.filter(l=>BigInt(l.blockNumber)>=BigInt(params[0].fromBlock)&&BigInt(l.blockNumber)<=BigInt(params[0].toBlock));
    else if(method==='eth_getTransactionReceipt'){
      const matching=state.logs.filter(l=>l.transactionHash===params[0]);if(!matching.length)value=null;
      else {const l=matching[0],wallet=l.address===VAULT?'0x'+l.topics[1].slice(-40):'0x'+l.topics[2].slice(-40);value={status:'0x1',transactionHash:l.transactionHash,blockNumber:l.blockNumber,blockHash:l.blockHash,from:wallet,to:l.address,logs:matching};}
    }else throw Error('UNEXPECTED_RPC_METHOD');
    value=structuredClone(value);return override?await override(method,params,value,calls,state):value;
  };
  return {rpc,calls,state};
}
const count=(db,table)=>Number(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
async function rejected(f,expected,options={}){const db=openD1(),c=await config();try{await assert.rejects(syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+5*DAY,...options}),expected);assert.equal(count(db,'economy_chain_events'),0);assert.equal(count(db,'economy_positions'),0);assert.equal(count(db,'economy_gold_journal'),0);assert.equal((await economyChainState(db,c)).haltedReason,null);}finally{db.raw.close();}}

test('finalized bounded range uses exact filter, receipt and canonical timestamp, then posts a completed UTC day',async()=>{
  const db=openD1(),c=await config(),f=fixture();
  try{const result=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+5*DAY});assert.equal(result.status,'indexed');assert.equal(result.toBlock,'101');assert.equal(result.eventCount,1);assert.equal(result.settledDays,1);
    const state=await economyChainState(db,c);assert.equal(state.lastHash,H(101));assert.equal(state.throughMs,T+DAY);assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');
    const filter=f.calls.find(row=>row.method==='eth_getLogs').params[0];assert.deepEqual(filter,{fromBlock:'0x64',toBlock:'0x65',address:[VAULT,PAYMENTS],topics:[Object.values(ECONOMY_EVENT_TOPICS)]});
    assert.equal(f.calls.filter(row=>row.method==='eth_getTransactionReceipt').length,1);assert.ok(f.calls.filter(row=>row.method==='eth_getBlockByNumber'&&row.params[0]==='0x65').length>=2);
    assert.equal(db.raw.prepare('SELECT at_ms t FROM economy_chain_events').get().t,T);
  }finally{db.raw.close();}
});

test('wrong chain and malformed quantity abort before any persistent mutation',async()=>{
  for(const chain of ['0x7a69','0x01',1,'0x-1'])await rejected(fixture({override:(m,p,v)=>m==='eth_chainId'?chain:v}));
});
test('unreviewed config or oversized bounds are rejected without reading RPC',async()=>{
  const db=openD1(),c=await config(),f=fixture();
  try{for(const options of [{maxBlocks:129},{maxLogs:257},{maxBlocks:0},{settleMaxDays:32},{nowMs:-1}])await assert.rejects(syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T,...options}));
    await assert.rejects(syncEconomyChain(db,{...c,id:'forged'},{rpc:f.rpc,nowMs:T}));await assert.rejects(syncEconomyChain(db,{...c,chainId:31337},{rpc:f.rpc,nowMs:T}));assert.equal(f.calls.length,0);
  }finally{db.raw.close();}
});
test('status zero, wrong receipt tx/block and missing receipts never establish credit',async()=>{
  const patches=[{status:'0x0'},{transactionHash:H(99)},{blockHash:H(99)},{blockNumber:Q(99)}];
  for(const patch of patches)await rejected(fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?{...v,...patch}:v}),/RECEIPT_SOURCE_MISMATCH/);
  await rejected(fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?null:v}),/MALFORMED_RPC_OBJECT/);
});
test('outer receipt addresses are well formed but do not override the emitting contract player',async()=>{
  for(const patch of [{to:'bad'},{from:'bad'},{from:null},{to:undefined}])await rejected(fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?{...v,...patch}:v}),/MALFORMED_RPC_ADDRESS/);
  for(const patch of [{to:OTHER,from:OTHER},{to:null,from:OTHER}]){
    const db=openD1(),c=await config(),f=fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?{...v,...patch}:v});try{await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');assert.equal((await economyWalletSnapshot(db,c,OTHER)).gold,'0');}finally{db.raw.close();}
  }
});
test('receipt log must match the exact canonical address, topics, data and index',async()=>{
  for(const change of [l=>({...l,data:'0x'+U(2)+U(1)}),l=>({...l,address:OTHER}),l=>({...l,logIndex:'0x1'}),l=>({...l,topics:[...l.topics.slice(0,2),H(88)]})]) {
    await rejected(fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?{...v,logs:[change(v.logs[0])]}:v}),/RECEIPT_LOG_MISMATCH/);
  }
  await rejected(fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?{...v,logs:[]}:v}),/RECEIPT_LOG_MISMATCH/);
  await rejected(fixture({override:(m,p,v)=>m==='eth_getTransactionReceipt'?{...v,logs:[v.logs[0],v.logs[0]]}:v}),/RECEIPT_LOG_MISMATCH/);
});
test('removed logs, unconfirmed source and mismatched canonical event block are rejected',async()=>{
  for(const patch of [{removed:true},{removed:undefined},{blockHash:H(999)}])await rejected(fixture({logs:[{...stake(),...patch}]}));
  await rejected(fixture({override:(m,p,v)=>m==='eth_getLogs'?[stake({n:102})]:v}),/LOG_OUTSIDE_FINALIZED_RANGE/);
});
test('ABI words, topic count, share units, position id and expected contract remain exact',async()=>{
  const l=stake();
  for(const patch of [
    {data:'0x'+U(2)+U(1)},{data:l.data+'00'},{data:'0x'+U(0)+U(0)},
    {topics:[...l.topics,H(9)]},{topics:[l.topics[0],H(1n<<255n),l.topics[2]]},{topics:[l.topics[0],l.topics[1],H(0)]},
    {address:PAYMENTS},{topics:[H(999),...l.topics.slice(1)]}
  ])await rejected(fixture({logs:[{...l,...patch}]}));
});
test('payment token/treasury and nonzero order are checked before any order fulfillment',async()=>{
  const l=payment(H(99));
  for(const patch of [
    {topics:[l.topics[0],H(0),...l.topics.slice(2)]},
    {topics:[...l.topics.slice(0,3),'0x'+A(OTHER)]},
    {data:'0x'+A(OTHER)+U(7)},
    {data:'0x'+A(ECONOMY_TREASURY)+U(0)}
  ])await rejected(fixture({logs:[{...l,...patch}]}));
});
test('explicit staging capacity ceiling and duplicate indexes fail without dropping any event',async()=>{
  const many=Array.from({length:10001},(_,i)=>stake({index:i,position:BigInt(i+1)}));await rejected(fixture({logs:many}),/RPC_BLOCK_LOG_BOUND/);
  await rejected(fixture({logs:[stake(),stake()]}),/DUPLICATE_RPC_LOG/);
});
test('a busy finalized block stages bounded pages, exposes no partial balance and eventually credits once',async()=>{
  const db=openD1(),c=await config(),logs=Array.from({length:257},(_,i)=>stake({index:i,position:BigInt(i+1),tx:H(30000+i)})),f=fixture({logs});
  try{
    for(const offset of [128,256]){const result=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});assert.equal(result.status,'staging');assert.equal(result.staged,offset);assert.equal((await pendingEconomyBlock(db,c)).nextOffset,offset);assert.equal((await economyChainState(db,c)).lastBlock,'99');assert.equal(count(db,'economy_chain_events'),0);assert.equal(count(db,'economy_positions'),0);assert.equal((await economyWalletSnapshot(db,c,W)).gold,'0');}
    const completed=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});assert.equal(completed.status,'indexed');assert.equal(completed.eventCount,257);assert.equal((await economyChainState(db,c)).lastBlock,'100');assert.equal(await pendingEconomyBlock(db,c),null);assert.equal(count(db,'economy_chain_events'),257);assert.equal(count(db,'economy_positions'),257);
    for(let i=0;i<10;i++)await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,c,W)).gold,'514');assert.equal(count(db,'economy_gold_journal'),1);
    assert.equal(f.calls.filter(row=>row.method==='eth_getTransactionReceipt').length,257);
  }finally{db.raw.close();}
});
test('pending finalized block digest cannot change between pages and its hash or parent reorg durably halts',async()=>{
  for(const mode of ['digest','hash','parent']){
    const db=openD1(),c=await config(),logs=Array.from({length:257},(_,i)=>stake({index:i,position:BigInt(i+1),tx:H(40000+i)})),good=fixture({logs});
    try{await syncEconomyChain(db,c,{rpc:good.rpc,nowMs:T+DAY});
      const changed=mode==='digest'?fixture({logs:logs.map((l,i)=>i===200?{...l,data:'0x'+U(3)+U(3n*SHARE)}:l)}):fixture({logs,override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]===(mode==='parent'?'0x63':'0x64')?{...v,hash:H(999)}:v});
      await assert.rejects(syncEconomyChain(db,c,{rpc:changed.rpc,nowMs:T+DAY}),mode==='digest'?/RPC_STAGED_LOG_MISMATCH/:/FINALIZED_REORG/);
      assert.equal((await pendingEconomyBlock(db,c)).nextOffset,128);assert.equal(count(db,'economy_positions'),0);assert.equal((await economyChainState(db,c)).haltedReason,mode==='digest'?null:'FINALIZED_REORG');
    }finally{db.raw.close();}
  }
});
test('a bad receipt on the final staged page cannot publish previous pages and can retry safely',async()=>{
  const db=openD1(),c=await config(),logs=Array.from({length:257},(_,i)=>stake({index:i,position:BigInt(i+1),tx:H(50000+i)})),good=fixture({logs}),bad=fixture({logs,override:(m,p,v)=>m==='eth_getTransactionReceipt'&&p[0]===H(50256)?{...v,status:'0x0'}:v});
  try{await syncEconomyChain(db,c,{rpc:good.rpc,nowMs:T+DAY});await syncEconomyChain(db,c,{rpc:good.rpc,nowMs:T+DAY});await assert.rejects(syncEconomyChain(db,c,{rpc:bad.rpc,nowMs:T+DAY}),/RECEIPT_SOURCE_MISMATCH/);
    assert.equal((await pendingEconomyBlock(db,c)).nextOffset,256);assert.equal(count(db,'economy_positions'),0);assert.equal((await economyChainState(db,c)).lastBlock,'99');
    await syncEconomyChain(db,c,{rpc:good.rpc,nowMs:T+DAY});assert.equal(count(db,'economy_positions'),257);
  }finally{db.raw.close();}
});
test('provider result-limit replies shrink the range, while ordinary quota errors never masquerade as logs',async()=>{
  const db=openD1(),c=await config(),f=fixture({head:103,override:(m,p,v)=>{if(m==='eth_getLogs'&&BigInt(p[0].toBlock)>101n)throw new EconomyRpcError('RPC_RESULT_LIMIT');return v;}});
  try{const result=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});assert.equal(result.toBlock,'101');assert.equal(count(db,'economy_chain_events'),1);}finally{db.raw.close();}
});
test('an oversized multi-block range halves before header work and never drops events',async()=>{
  const db=openD1(),c=await config(),f=fixture({head:103,logs:[stake(),stake({n:101,position:2n}),stake({n:102,position:3n}),stake({n:103,position:4n})]});
  try{const first=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+9*DAY,maxLogs:2});assert.equal(first.toBlock,'101');assert.equal(first.eventCount,2);
    assert.equal(f.calls.some(row=>row.method==='eth_getBlockByNumber'&&row.params[0]==='0x66'),false);
    const second=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+9*DAY,maxLogs:2});assert.equal(second.fromBlock,'102');assert.equal(second.toBlock,'103');assert.equal(count(db,'economy_chain_events'),4);
  }finally{db.raw.close();}
});
test('the entire RPC round has a 25-second deadline without a permanent chain halt',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date']});const db=openD1(),c=await config();let reached;const started=new Promise(resolve=>{reached=resolve;});
  const rpc=async()=>{reached();return new Promise(()=>{});};
  try{const pending=syncEconomyChain(db,c,{rpc,nowMs:T});await started;t.mock.timers.tick(25_000);await assert.rejects(pending,/ECONOMY_SYNC_TIMEOUT/);assert.equal(count(db,'economy_chain_state'),0);}finally{db.raw.close();}
});
test('empty finalized ranges still advance the contiguous horizon with no invented GOLD',async()=>{
  const db=openD1(),c=await config(),f=fixture({logs:[]});try{const result=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+9*DAY});assert.equal(result.eventCount,0);assert.equal((await economyChainState(db,c)).lastBlock,'101');assert.equal(count(db,'economy_gold_journal'),0);}finally{db.raw.close();}
});
test('128 block bound preserves backlog and subsequent calls continue from the exact cursor',async()=>{
  const db=openD1(),c=await config(),f=fixture({head:300,logs:[]});try{
    const a=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+300*DAY});assert.equal(a.fromBlock,'100');assert.equal(a.toBlock,'227');
    const b=await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+300*DAY});assert.equal(b.fromBlock,'228');assert.equal(b.toBlock,'300');
    assert.equal((await economyChainState(db,c)).lastBlock,'300');
  }finally{db.raw.close();}
});
test('same-isolate concurrent schedules and later retries settle each wallet-day once',async()=>{
  const db=openD1(),c=await config(),f=fixture();try{
    const results=await Promise.all([syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY}),syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY}),syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY})]);
    assert.equal(results.filter(row=>row.status==='indexed').length,1);assert.equal(count(db,'economy_chain_events'),1);assert.equal(count(db,'economy_gold_journal'),1);assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');
  }finally{db.raw.close();}
});
test('stored finalized hash mismatch durably halts, preserves prior credit and stops future RPC reads',async()=>{
  const db=openD1(),c=await config(),f=fixture();try{
    await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});const bad=fixture({override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]==='0x65'?{...v,hash:H(999)}:v});
    await assert.rejects(syncEconomyChain(db,c,{rpc:bad.rpc,nowMs:T+3*DAY}),/FINALIZED_REORG/);assert.equal((await economyChainState(db,c)).haltedReason,'FINALIZED_REORG');
    const calls=bad.calls.length;await assert.rejects(syncEconomyChain(db,c,{rpc:bad.rpc,nowMs:T+4*DAY}),/ECONOMY_HALTED/);assert.equal(bad.calls.length,calls);assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');
  }finally{db.raw.close();}
});
test('a stored-cursor race found on final reread also durably halts before new ingestion',async()=>{
  const db=openD1(),c=await config(),f=fixture();try{
    await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});let anchors=0;
    const raced=fixture({head:102,logs:[],override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]==='0x65'&&++anchors===2?{...v,hash:H(999)}:v});
    await assert.rejects(syncEconomyChain(db,c,{rpc:raced.rpc,nowMs:T+3*DAY}),/FINALIZED_REORG/);assert.equal((await economyChainState(db,c)).lastBlock,'101');assert.equal(count(db,'economy_chain_events'),1);
  }finally{db.raw.close();}
});
test('an uncommitted range hash race fails transiently without a durable halt or credit',async()=>{
  let ends=0;await rejected(fixture({override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]==='0x65'&&++ends===2?{...v,hash:H(888)}:v}),/RPC_RANGE_CHANGED/);
});
test('RPC timeout/quota is transient and a later valid retry processes the full range once',async()=>{
  const db=openD1(),c=await config(),good=fixture(),bad=fixture({override:m=>{throw Error('timeout or quota');}});try{
    await assert.rejects(syncEconomyChain(db,c,{rpc:bad.rpc,nowMs:T+DAY}));assert.equal(count(db,'economy_chain_state'),0);
    await syncEconomyChain(db,c,{rpc:good.rpc,nowMs:T+DAY});assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');assert.equal((await economyChainState(db,c)).haltedReason,null);
  }finally{db.raw.close();}
});
test('a noncontiguous parent, wrong block number or decreasing canonical time cannot advance cursor',async()=>{
  for(const patch of [{parentHash:H(888)},{number:Q(777)},{timestamp:Q(T/1000-2*DAY/1000)}])await rejected(fixture({override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]==='0x64'?{...v,...patch}:v}));
  await rejected(fixture({head:103,override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]==='0x66'?{...v,parentHash:H(999)}:v}),/NONCONTIGUOUS_RPC_RANGE/);
});
test('optional witness uses the common finalized height and rejects a hash disagreement',async()=>{
  const db=openD1(),c=await config(),primary=fixture({head:104}),witness=fixture({head:101});try{const result=await syncEconomyChain(db,c,{rpc:primary.rpc,witnessRpc:witness.rpc,nowMs:T+9*DAY});assert.equal(result.toBlock,'101');assert.equal((await economyWalletSnapshot(db,c,W)).gold,'2');}finally{db.raw.close();}
  const db2=openD1(),wrong=fixture({override:(m,p,v)=>m==='eth_getBlockByNumber'&&p[0]==='0x65'?{...v,hash:H(555)}:v});try{await assert.rejects(syncEconomyChain(db2,c,{rpc:fixture().rpc,witnessRpc:wrong.rpc,nowMs:T+DAY}),/RPC_WITNESS_MISMATCH/);assert.equal(count(db2,'economy_chain_state'),0);}finally{db2.raw.close();}
});
test('verified exact Paid log fulfills only a matching server order and retry cannot fulfill twice',async()=>{
  const db=openD1(),c=await config();try{
    const order=await createEconomyOrder(db,c,{wallet:W,requestId:'rpc-payment-fixture-0001',serviceId:'fixture',currency:'EMBEO',nowMs:T});
    const f=fixture({logs:[payment(order.id)]});await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});await syncEconomyChain(db,c,{rpc:f.rpc,nowMs:T+DAY});
    assert.equal(count(db,'economy_fulfillments'),1);assert.equal((await economyWalletSnapshot(db,c,W)).orders[0].status,'paid');assert.equal(count(db,'economy_gold_journal'),0);
  }finally{db.raw.close();}
});
test('fixed Alchemy factory preserves header-only key flow, allows read methods and suppresses raw failures',async()=>{
  const calls=[],key='TEST_ONLY_NOT_A_REAL_CREDENTIAL',rpc=createEconomyRpc({key,fetch:async(url,options)=>{calls.push({url,options});return Response.json({jsonrpc:'2.0',id:1,result:'0x1'});}});
  assert.equal(await rpc('eth_chainId',[]),'0x1');assert.equal(calls[0].url,ALCHEMY_RPC_URL);assert.equal(calls[0].url.includes(key),false);assert.equal(new Headers(calls[0].options.headers).get('authorization'),'Bearer '+key);
  for(const method of ['eth_sendTransaction','personal_sign','eth_call','debug_traceTransaction'])await assert.rejects(rpc(method,[]),/RPC_METHOD_NOT_ALLOWED/);assert.equal(calls.length,1);
  const failed=createEconomyRpc({key,fetch:async()=>{throw Error('sensitive '+key);}});await assert.rejects(failed('eth_chainId',[]),error=>error.message==='ECONOMY_RPC_UNAVAILABLE'&&!String(error).includes(key));
  const quota=createEconomyRpc({key,fetch:async()=>Response.json({error:{message:'quota '+key}})});await assert.rejects(quota('eth_chainId',[]),/ECONOMY_RPC_UNAVAILABLE/);
});
