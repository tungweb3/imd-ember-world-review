import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY,ECONOMY_SHARE_WEI as SHARE,ECONOMY_DAY_MS as DAY} from '../server/economy-config.ts';
import {ingestEconomyEvents,economyWalletSnapshot,economyChainState} from '../server/economy-ledger.ts';
import {syncEconomyChain,ECONOMY_EVENT_TOPICS} from '../server/economy-rpc.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {INITIAL} from '../src/world/auth.ts';
import {EconomyWalletController} from '../src/world/economyWallet.ts';
import {publicEconomyConfig} from '../server/economy-config.ts';
import {encodeAbiParameters} from 'viem';
const T=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),OTHER='0x'+'b'.repeat(40),VAULT='0x'+'1'.repeat(40),PAY='0x'+'2'.repeat(40);
const H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),Q=n=>'0x'+BigInt(n).toString(16),U=n=>BigInt(n).toString(16).padStart(64,'0');
const config=()=>defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,stakingContract:VAULT,paymentContract:PAY,treasury:ECONOMY_TREASURY,deploymentBlock:'100',catalogue:[{id:'fixture',titleZh:'僅供測試',titleEn:'Fixture only',gold:'3',embeo:'7'}]});
const block=n=>({number:Q(n),hash:H(n),parentHash:H(n-1),timestamp:Q(T/1000+(n-100)*DAY/1000)});
const count=(db,t)=>Number(db.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n);

test('regression: a disconnected middle header cannot advance an empty finalized range and later manufacture a trusted horizon',async()=>{
 const db=openD1(),c=await config(),calls=[];
 const rpc=async(method,params)=>{
  calls.push({method,params});if(method==='eth_chainId')return '0x1';if(method==='eth_getLogs')return [];
  if(method==='eth_getBlockByNumber'){const n=params[0]==='finalized'?102:Number(BigInt(params[0])),b=block(n);return n===101?{...b,parentHash:H(999)}:b;}
  throw Error('UNEXPECTED_READ');
 };
 try{await assert.rejects(syncEconomyChain(db,c,{rpc,nowMs:T+3*DAY}),/NONCONTIGUOUS_RPC_RANGE/);assert.equal((await economyChainState(db,c)).lastBlock,'99');assert.equal(count(db,'economy_chain_events'),0);assert.equal(count(db,'economy_positions'),0);assert.equal(count(db,'economy_gold_journal'),0);}finally{db.raw.close();}
});
test('regression: a substituted event player that disagrees with the actual receipt log cannot establish principal or GOLD',async()=>{
 const db=openD1(),c=await config(),log={address:VAULT,topics:[ECONOMY_EVENT_TOPICS.stake,'0x'+W.slice(2).padStart(64,'0'),H(1)],data:'0x'+U(1)+U(SHARE),blockNumber:Q(100),blockHash:H(100),transactionHash:H(2000),logIndex:'0x0',removed:false};
 const substituted={...log,topics:[log.topics[0],'0x'+OTHER.slice(2).padStart(64,'0'),log.topics[2]]};
 const rpc=async(method,params)=>{
  if(method==='eth_chainId')return '0x1';if(method==='eth_getBlockByNumber')return block(params[0]==='finalized'?101:Number(BigInt(params[0])));
  if(method==='eth_getLogs')return [substituted];if(method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:log.transactionHash,blockNumber:log.blockNumber,blockHash:log.blockHash,from:W,to:VAULT,logs:[log]};throw Error('UNEXPECTED_READ');
 };
 try{await assert.rejects(syncEconomyChain(db,c,{rpc,nowMs:T+DAY}),/RECEIPT_LOG_MISMATCH/);assert.equal(count(db,'economy_chain_events'),0);assert.equal(count(db,'economy_positions'),0);assert.equal(count(db,'economy_gold_journal'),0);}finally{db.raw.close();}
});
test('regression: closed historical lots never hide a later live position behind the snapshot bound',async()=>{
 const db=openD1(),c=await config(),events=[];
 const event=(kind,index,position,blockNumber,timestamp,shares='1')=>({kind,transactionHash:H(10000+blockNumber*1000+index),logIndex:index,blockNumber:String(blockNumber),blockHash:H(blockNumber),timestamp,wallet:W,positionId:String(position),shares,amount:String(BigInt(shares)*SHARE)});
 for(let i=0;i<200;i++)events.push(event('stake',i,i+1,100,T));
 for(let i=0;i<200;i++)events.push(event('withdraw',i,i+1,101,T+1000));
 events.push(event('stake',0,201,102,T+2000,'5'));
 try{await ingestEconomyEvents(db,c,{events,fromBlock:'100',toBlock:'103',toBlockHash:H(103),throughTimestamp:T+3000});const s=await economyWalletSnapshot(db,c,W);assert.equal(s.positions.find(p=>p.id==='201')?.shares,'5','active principal must be visible even after 200 withdrawn lots');assert.equal(s.positionsTruncated,true);}finally{db.raw.close();}
});
test('regression: revocation at the final GOLD batch boundary leaves debit, nonce, order and fulfillment untouched',async()=>{
 const db=openD1(),c=await config(),account=privateKeyToAccount(generatePrivateKey()),wallet=account.address.toLowerCase(),token='a'.repeat(43),tokenHash=await sha256(token),now=T+DAY;
 db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,revoked_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,NULL,?,?,?)').run(tokenHash,wallet,1,T,now+DAY,'adversarial-final-batch','EOA','ECDSA');
 db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run(wallet,10);
 const deps={db,config:c,now:()=>now,allow:async()=>true};
 const post=async(path,body,override=deps)=>{const response=await handleEconomyApi(new Request('https://imdember.com'+path,{method:'POST',headers:{origin:'https://imdember.com',cookie:SESSION_COOKIE+'='+token,'content-type':'application/json'},body:JSON.stringify(body)}),override);return {response,body:await response.json()};};
 try{
  const o=await post('/api/economy/orders',{expectedAddress:wallet,requestId:'adversarial-order-0001',serviceId:'fixture',currency:'GOLD'});assert.equal(o.response.status,200);
  const path='/api/economy/orders/'+o.body.order.id+'/gold',requestId='adversarial-payment-0001',ch=await post(path+'/challenge',{expectedAddress:wallet,requestId});assert.equal(ch.response.status,200);
  const signature=await account.signMessage({message:ch.body.challenge.message});
  const racedDb={...db,batch:async statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO economy_gold_journal')))db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').run(now,tokenHash);return db.batch(statements);}};
  const result=await post(path,{expectedAddress:wallet,requestId,signature},{...deps,db:racedDb});assert.notEqual(result.response.status,200);
  assert.equal(db.raw.prepare('SELECT CAST(balance AS TEXT) balance FROM economy_gold_accounts WHERE wallet=?').get(wallet).balance,'10');assert.equal(count(db,'economy_gold_journal'),0);assert.equal(count(db,'economy_fulfillments'),0);assert.equal(db.raw.prepare('SELECT consumed_ms t FROM economy_gold_challenges').get().t,null);assert.equal(db.raw.prepare('SELECT status FROM economy_orders').get().status,'pending');
 }finally{db.raw.close();}
});
test('regression: a broadcast with no returned hash stays unresolved after closing and reopening the controller',async()=>{
 const c=await config(),now=T+DAY,state={...INITIAL,account:W,session:{address:W,expiresAt:now+DAY},sessionKnown:true,restored:true},hints=new Map();let sends=0;
 const provider={async request({method,params}){
  if(method==='eth_accounts')return [W];if(method==='eth_chainId')return '0x1';
  if(method==='eth_call'){
   const data=params[0].data;if(data.startsWith('0xfc0c546a'))return encodeAbiParameters([{type:'address'}],[ECONOMY_TOKEN]);
   if(data.startsWith('0x10a223e7'))return encodeAbiParameters([{type:'uint256'}],[SHARE]);
   if(data.startsWith('0x99fbab88'))return encodeAbiParameters([{type:'address'},{type:'uint256'}],[W,2n]);
   throw Error('UNEXPECTED_CALL');
  }
  if(method==='eth_sendTransaction'){sends++;throw Error('response lost after wallet may have broadcast');}throw Error('UNEXPECTED_RPC');
 }};
 const deps={config:publicEconomyConfig(c),auth:()=>state,provider:()=>provider,now:()=>now,pending:{get:key=>hints.get(key),set(key,value){if(value)hints.set(key,value);else hints.delete(key);}},fetch:async path=>({status:200,json:async()=>path==='/api/economy/config'?publicEconomyConfig(c):{signedIn:true,address:W,expiresAt:state.session.expiresAt}})};
 const first=new EconomyWalletController(deps);try{await first.prepare({kind:'withdraw',positionId:'1',shares:'1'});assert.equal(first.state.phase,'confirm');await first.confirm();assert.equal(first.state.phase,'unknown');assert.equal(sends,1);}finally{first.dispose();}
 const reopened=new EconomyWalletController(deps);try{reopened.restorePending();await reopened.prepare({kind:'withdraw',positionId:'1',shares:'1'});await reopened.confirm();assert.equal(sends,1,'a new controller must not silently forget the unknown financial send');assert.equal(reopened.state.phase,'unknown');}finally{reopened.dispose();}
});
