import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalMintClient,salePhase,mintReadiness} from './client-state.mjs';
const look={body:'standard',skin:'green',hat:'none',top:'tee',bottom:'none',shoes:'bare'};
const packet={route:'free',deadline:1300,runId:'run-1',selection:look};
function state(change={}){return {runId:'run-1',revision:1,chainId:31337,now:1000,freeStartAt:1000,goldPrice:'1',paused:false,recipient:'recipient-1',signerEpoch:'1',priceAtomic:'300000',totalMinted:'0',records:[],receipts:[],wallets:[{id:'A',address:'wallet-a-address',gold:{book:'10',reserved:'0',available:'10'},eligible:true,freeClaimed:false,tokenBalanceAtomic:'900000',allowanceAtomic:'0'},{id:'B',address:'wallet-b-address',gold:{book:'10',reserved:'0',available:'10'},eligible:true,freeClaimed:false,tokenBalanceAtomic:'900000',allowanceAtomic:'0'},{id:'C',address:'wallet-c-address',gold:{book:'10',reserved:'0',available:'10'},eligible:false,freeClaimed:false,tokenBalanceAtomic:'900000',allowanceAtomic:'0'}],...change};}
function defer(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
async function ready(transport=async()=>({ok:true,state:state(),sessionToken:'local-session'})){const client=new LocalMintClient(transport,look);await client.refresh();return client;}
test('both paths open together and free does not expire after three days',()=>{
 assert.equal(salePhase(state()),'open');assert.equal(salePhase(state({now:999999})),'open');assert.equal(salePhase(state({now:999})),'waiting');assert.equal(salePhase(state({totalMinted:'2222'})),'soldout');
});
test('free and paid have independent qualification, GOLD and EMBEO requirements',()=>{
 assert.equal(mintReadiness(state(),'C',look,packet),'NOT_IN_SNAPSHOT');const claimed=state();claimed.wallets[0].freeClaimed=true;assert.equal(mintReadiness(claimed,'A',look,packet),'FREE_ALREADY_CLAIMED');
 const paid=state();assert.equal(mintReadiness(paid,'A',look,null,'paid'),'APPROVAL_REQUIRED');paid.wallets[0].allowanceAtomic='300000';assert.equal(mintReadiness(paid,'A',look,null,'paid'),'APPEARANCE_APPROVAL_REQUIRED');assert.equal(mintReadiness(paid,'A',look,{...packet,route:'paid'},'paid'),null);
 paid.wallets[0].gold.available='0';assert.equal(mintReadiness(paid,'A',look,null,'paid'),'GOLD_INSUFFICIENT');paid.wallets[0].tokenBalanceAtomic='0';assert.equal(mintReadiness(paid,'A',look,packet,'paid'),'EMBEO_INSUFFICIENT');
});
test('reordered look fields still detect a minted duplicate',()=>{
 const selection={shoes:'bare',bottom:'none',top:'tee',hat:'none',skin:'green',body:'standard'};
 assert.equal(mintReadiness(state({records:[{selection}]}),'A',look,packet),'APPEARANCE_ALREADY_MINTED');
});
test('expired packet cannot open new Mint review',async()=>{
 const client=await ready();client.packet=packet;client.applyState(state({now:1301,revision:2}));
 assert.throws(()=>client.openReview('mint'),/APPEARANCE_APPROVAL_EXPIRED/);
});
test('cancelled review sends no transaction and preserves previous receipt',async()=>{
 const calls=[];const client=await ready(async(path,body)=>{calls.push({path,body});return {state:state(),sessionToken:'s'};});
 client.packet=packet;client.lastReceipt={hash:'old-confirmed-hash'};client.openReview('mint');client.cancelReview();
 assert.equal(calls.length,1);assert.equal(client.review,null);assert.equal(client.lastReceipt.hash,'old-confirmed-hash');assert.match(client.notice,/沒有送出交易/);
});
test('wallet and look change invalidate both signed packet and review',async()=>{
 const client=await ready();client.packet=packet;client.openReview('mint');client.setWallet('B');assert.equal(client.packet,null);assert.equal(client.review,null);
 client.packet=packet;client.openReview('mint');client.setLook({...look,hat:'beanie'});assert.equal(client.packet,null);assert.equal(client.review,null);
});
test('late appearance signature after buyer change is discarded',async()=>{
 const delayed=defer();const client=await ready(async(path)=>path==='/api/approval'?delayed.promise:{state:state(),sessionToken:'s'});
 const pending=client.obtainApproval();client.setWallet('B');delayed.resolve({packet,state:state()});await pending;
 assert.equal(client.packet,null);assert.equal(client.wallet,'B');assert.equal(client.busy,false);assert.match(client.notice,/捨棄/);
});
test('late appearance signature after outfit change is discarded',async()=>{
 const delayed=defer();const client=await ready(async(path)=>path==='/api/approval'?delayed.promise:{state:state(),sessionToken:'s'});
 const pending=client.obtainApproval();client.setLook({...look,hat:'beanie'});delayed.resolve({packet,state:state()});await pending;
 assert.equal(client.packet,null);assert.equal(client.look.hat,'beanie');
});
test('confirmed transaction keeps its submitted buyer when selector changes while pending',async()=>{
 const delayed=defer(),calls=[];const client=await ready(async(path,body)=>{calls.push({path,body});return path==='/api/transaction'?delayed.promise:{state:state(),sessionToken:'s'};});
 client.packet=packet;client.openReview('mint');const pending=client.confirm();client.setWallet('B');
 assert.equal(calls[1].body.wallet,'A');assert.equal(calls[1].body.action,'mintFree');
 delayed.resolve({state:state({revision:2,totalMinted:'1'}),receipt:{status:1,hash:'actual-hash',tokenId:1,owner:'wallet-a-address'}});await pending;
 assert.equal(client.wallet,'B');assert.equal(client.lastReceipt.submittedWallet,'A');assert.equal(client.lastReceipt.owner,'wallet-a-address');assert.equal(client.lastReceipt.hash,'actual-hash');
});
test('duplicate confirm while pending cannot send second transaction',async()=>{
 const delayed=defer(),calls=[];const client=await ready(async(path,body)=>{calls.push({path,body});return path==='/api/transaction'?delayed.promise:{state:state(),sessionToken:'s'};});
 client.packet=packet;client.openReview('mint');const pending=client.confirm();await assert.rejects(client.confirm(),/TRANSACTION_PENDING/);
 delayed.resolve({state:state({revision:2}),receipt:{status:1,hash:'one-tx'}});await pending;assert.equal(calls.filter(call=>call.path==='/api/transaction').length,1);
});
test('real reverted receipt and authoritative rollback state are shown without inventing success',async()=>{
 const originalRecord={id:1,key:'old-nft'};const chain=state({records:[originalRecord]});
 const client=await ready(async(path)=>{if(path==='/api/transaction')throw Object.assign(Error('actual revert'),{code:'MINT_PAUSED',stage:'reverted',state:{...chain,revision:2},receipt:{status:0,hash:'reverted-hash',feeWei:'100'}});return {state:chain,sessionToken:'s'};});
 client.packet=packet;client.openReview('mint');await client.confirm();assert.equal(client.lastReceipt.status,0);assert.equal(client.lastReceipt.feeWei,'100');assert.deepEqual(client.state.records,[originalRecord]);assert.equal(client.error.code,'MINT_PAUSED');assert.equal(client.busy,false);
});
test('signer, recipient, pause and phase changes invalidate confirmation context',async()=>{
 for(const change of [{signerEpoch:'2'},{recipient:'recipient-2'},{paused:true},{now:999}]){const client=await ready();client.packet=packet;client.openReview('mint');client.applyState(state({...change,revision:2}));assert.equal(client.review,null);assert.equal(client.packet,null);}
});
test('stale server revision cannot overwrite a later state',async()=>{
 const client=await ready();client.applyState(state({revision:4,totalMinted:'2'}));client.applyState(state({revision:2,totalMinted:'0'}));assert.equal(client.state.revision,4);assert.equal(client.state.totalMinted,'2');
});
test('out-of-order state refresh ignores older completion and session token',async()=>{
 const first=defer(),second=defer();let number=0;const client=new LocalMintClient(async()=>++number===1?first.promise:second.promise,look);
 const older=client.refresh(),newer=client.refresh();second.resolve({state:state({revision:3}),sessionToken:'new'});await newer;first.resolve({state:state({revision:1}),sessionToken:'old'});await older;assert.equal(client.state.revision,3);assert.equal(client.sessionToken,'new');
});
test('new chain reset clears receipts, approval and review; old-run state cannot return',async()=>{
 const resetState=state({runId:'run-2',revision:0});const client=await ready(async(path)=>path==='/api/admin'?{state:resetState,sessionToken:'new'}:{state:state(),sessionToken:'s'});
 client.packet=packet;client.lastReceipt={hash:'old'};client.openReview('mint');await client.admin('reset');
 assert.equal(client.lastReceipt,null);assert.equal(client.packet,null);assert.equal(client.review,null);assert.equal(client.state.runId,'run-2');assert.equal(client.sessionToken,'new');
 client.applyState(state({revision:100}),'run-1');assert.equal(client.state.runId,'run-2');
});
test('Mint committed but POST response lost is recovered by the exact submission ID and actual receipt',async()=>{
 let ledger=state(),sent=0;
 const client=await ready(async(path,body)=>{
  if(path==='/api/transaction'){sent++;const receipt={submissionId:body.submissionId,wallet:body.wallet,action:body.action,from:'wallet-a-address',status:1,hash:'confirmed-after-network-loss',tokenId:1,owner:'wallet-a-address',feeWei:'123'};ledger=state({revision:2,totalMinted:'1',records:[{id:1,key:'minted-key',owner:'wallet-a-address'}],receipts:[receipt]});throw Object.assign(Error('NETWORK_UNAVAILABLE'),{code:'NETWORK_UNAVAILABLE'});}
  return {state:ledger,sessionToken:'s'};
 });
 client.packet=packet;client.openReview('mint');await client.confirm();assert.equal(sent,1);assert.equal(client.uncertainSubmission,null);assert.equal(client.lastReceipt.hash,'confirmed-after-network-loss');assert.equal(client.lastReceipt.submittedWallet,'A');assert.equal(client.state.totalMinted,'1');assert.equal(client.error,null);assert.match(client.notice,/已找回/);
});
test('approval committed but response lost uses matching actual authorization receipt without resending',async()=>{
 let ledger=state({now:260200}),sent=0;
 const client=await ready(async(path,body)=>{if(path==='/api/transaction'){sent++;ledger=state({now:260201,revision:2,receipts:[{submissionId:body.submissionId,wallet:body.wallet,action:'approve',from:'wallet-a-address',status:1,hash:'approved-hash',feeWei:'12'}]});ledger.wallets[0].allowanceAtomic='300000';throw Object.assign(Error('NETWORK_UNAVAILABLE'),{code:'NETWORK_UNAVAILABLE'});}return {state:ledger,sessionToken:'s'};});
 client.setRoute('paid');client.openReview('approve');await client.confirm();assert.equal(sent,1);assert.equal(client.lastReceipt.hash,'approved-hash');assert.equal(client.lastReceipt.submittedAction,'approve');assert.equal(client.state.wallets[0].allowanceAtomic,'300000');assert.equal(client.uncertainSubmission,null);
});
test('mined revert with response lost recovers actual status 0 fee and rolled-back records',async()=>{
 let ledger=state();const client=await ready(async(path,body)=>{
  if(path==='/api/transaction'){ledger=state({revision:2,receipts:[{submissionId:body.submissionId,wallet:'A',action:'mintFree',from:'wallet-a-address',status:0,hash:'failed-after-network-loss',feeWei:'777'}]});throw Object.assign(Error('NETWORK_UNAVAILABLE'),{code:'NETWORK_UNAVAILABLE'});}
  return {state:ledger,sessionToken:'s'};
 });
 client.packet=packet;client.openReview('mint');await client.confirm();assert.equal(client.uncertainSubmission,null);assert.equal(client.lastReceipt.status,0);assert.equal(client.lastReceipt.feeWei,'777');assert.equal(client.error.code,'TRANSACTION_REVERTED');assert.equal(client.state.records.length,0);assert.equal(client.state.totalMinted,'0');
});
test('not processed plus unavailable readback remains unknown, blocks resubmission, and preserves prior good data',async()=>{
 let offline=false,sent=0;const original=state({records:[{id:7,key:'prior-record'}]});
 const client=await ready(async(path)=>{if(path==='/api/transaction'){sent++;offline=true;throw Object.assign(Error('NETWORK_UNAVAILABLE'),{code:'NETWORK_UNAVAILABLE'});}if(offline)throw Object.assign(Error('NETWORK_UNAVAILABLE'),{code:'NETWORK_UNAVAILABLE'});return {state:original,sessionToken:'s'};});
 client.packet=packet;client.lastReceipt={hash:'prior-success'};client.openReview('mint');await client.confirm();assert.equal(sent,1);assert.ok(client.uncertainSubmission);assert.equal(client.lastReceipt.hash,'prior-success');assert.deepEqual(client.state.records,original.records);assert.equal(client.error.code,'TX_OUTCOME_UNKNOWN');assert.match(client.notice,/未確認/);assert.doesNotMatch(client.notice,/沒有送出|尚未送出/);
 await assert.rejects(client.confirm(),/TX_OUTCOME_UNKNOWN/);await assert.rejects(client.obtainApproval(),/TX_OUTCOME_UNKNOWN/);await assert.rejects(client.admin('pause'),/TX_OUTCOME_UNKNOWN/);
 offline=false;await client.refresh();assert.ok(client.uncertainSubmission);assert.equal(sent,1);assert.match(client.notice,/尚未找到/);
});
test('unrelated same-buyer receipt cannot resolve uncertain submission',async()=>{
 let ledger=state();const client=await ready(async(path)=>{if(path==='/api/transaction'){ledger=state({revision:2,receipts:[{submissionId:'different-id',wallet:'A',action:'mintFree',from:'wallet-a-address',status:1,hash:'someone-elses-request'}]});throw Error('NETWORK_UNAVAILABLE');}return {state:ledger,sessionToken:'s'};});
 client.packet=packet;client.openReview('mint');await client.confirm();assert.ok(client.uncertainSubmission);assert.equal(client.lastReceipt,null);assert.equal(client.error.code,'TX_OUTCOME_UNKNOWN');
});
test('manual reset can resolve an unknown submission without re-sending it',async()=>{
 let ledger=state(),sent=0;const client=await ready(async(path)=>{if(path==='/api/transaction'){sent++;throw Error('NETWORK_UNAVAILABLE');}if(path==='/api/admin')ledger=state({runId:'run-2',revision:0});return {state:ledger,sessionToken:'s'};});
 client.packet=packet;client.openReview('mint');await client.confirm();assert.ok(client.uncertainSubmission);await client.admin('reset');assert.equal(sent,1);assert.equal(client.uncertainSubmission,null);assert.equal(client.state.runId,'run-2');assert.equal(client.lastReceipt,null);assert.equal(client.packet,null);
});
