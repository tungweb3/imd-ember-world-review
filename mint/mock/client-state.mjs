const clone=value=>structuredClone(value);
const localError=code=>Object.assign(Error(code),{code});
export function salePhase(state){
 if(!state)return 'loading';
 if(Number(state.totalMinted)>=2222)return 'soldout';
 if(state.now<state.freeStartAt)return 'waiting';
 return 'open';
}
export function mintReadiness(state,wallet,look,packet,route='free'){
 if(!state)return 'STATE_LOADING';
 const account=state.wallets.find(row=>row.id===wallet),phase=salePhase(state);
 if(!account)return 'WALLET_UNKNOWN';
 if(state.paused)return 'MINT_PAUSED';
 if(phase==='soldout')return 'SOLD_OUT';
 if(phase==='waiting')return 'FREE_NOT_STARTED';
 if(state.records.some(record=>record.selection&&['body','skin','hat','top','bottom','shoes'].every(slot=>record.selection[slot]===look[slot])))return 'APPEARANCE_ALREADY_MINTED';
 if(route==='free'&&!account.eligible)return 'NOT_IN_SNAPSHOT';
 if(route==='free'&&account.freeClaimed)return 'FREE_ALREADY_CLAIMED';
 if(route==='paid'&&BigInt(account.tokenBalanceAtomic)<BigInt(state.priceAtomic))return 'EMBEO_INSUFFICIENT';
 if(route==='paid'&&BigInt(account.allowanceAtomic)<BigInt(state.priceAtomic))return 'APPROVAL_REQUIRED';
 if(route==='paid'&&!packet&&BigInt(account.gold?.available??'0')<BigInt(state.goldPrice))return 'GOLD_INSUFFICIENT';
 if(!packet)return 'APPEARANCE_APPROVAL_REQUIRED';
 if(packet.route!==route)return 'MINT_ROUTE_CHANGED';
 if(state.now>packet.deadline)return 'APPEARANCE_APPROVAL_EXPIRED';
 return null;
}
export class LocalMintClient{
 constructor(transport,look){
  this.transport=transport;this.look=clone(look);this.wallet='A';this.route='free';this.state=null;
  this.sessionToken=null;this.packet=null;this.review=null;this.lastReceipt=null;this.uncertainSubmission=null;
  this.error=null;this.notice='正在讀取本機合約。';this.busy=false;this.selectionRevision=0;this.refreshSequence=0;
  this.onChange=()=>{};
 }
 notify(){this.onChange();}
 invalidate(){this.selectionRevision++;this.packet=null;this.review=null;this.error=null;}
 setRoute(route){if(!['free','paid'].includes(route))throw localError('MINT_ROUTE_INVALID');if(route!==this.route){this.route=route;this.invalidate();this.notify();}}
 setWallet(wallet){if(wallet!==this.wallet){this.wallet=wallet;this.invalidate();this.notice='錢包已變更，請重新取得搭配批准。';this.notify();}}
 setLook(look){this.look=clone(look);this.invalidate();this.notice='搭配已變更，請重新取得搭配批准。';this.notify();}
 applyState(state,originRunId){
  if(!state)return;
  if(originRunId&&this.state&&originRunId!==this.state.runId)return;
  const prior=this.state;
  if(prior&&prior.runId===state.runId&&state.revision<prior.revision)return;
  if(prior&&(prior.runId!==state.runId||prior.signerEpoch!==state.signerEpoch||prior.recipient!==state.recipient||prior.paused!==state.paused||salePhase(prior)!==salePhase(state)))this.invalidate();
  this.state=state;
  if(prior&&prior.runId!==state.runId)this.lastReceipt=null;
 }
 async refresh(){
  if(this.busy)throw localError('TRANSACTION_PENDING');
  const sequence=++this.refreshSequence;
  try{
   const result=await this.transport('/api/state',null,this.sessionToken);
   if(sequence!==this.refreshSequence)return;
   this.sessionToken=result.sessionToken??this.sessionToken;this.applyState(result.state);
   if(this.uncertainSubmission)this.reconcileSubmission(result.state);
   else{this.error=null;this.notice='本機合約已讀取，可選擇錢包與搭配。';}
  }catch(error){if(sequence===this.refreshSequence){this.error=this.uncertainSubmission?localError('TX_OUTCOME_UNKNOWN'):error;this.notice=this.uncertainSubmission?'交易結果仍未確認；本機服務尚未連線，請重新讀取。':'本機服務尚未連線，請重新讀取。';}}
  this.notify();
 }
 assertIdle(allowUnknown=false){if(this.busy)throw localError('TRANSACTION_PENDING');if(!this.state)throw localError('STATE_LOADING');if(this.uncertainSubmission&&!allowUnknown)throw localError('TX_OUTCOME_UNKNOWN');}
 async obtainApproval(){
  this.assertIdle();const ticket=this.selectionRevision,originRunId=this.state.runId;
  const request={wallet:this.wallet,look:clone(this.look),route:this.route};this.busy=true;this.review=null;this.packet=null;this.error=null;
  this.notice='正在取得本機簽名批准。';this.notify();
  try{
   const result=await this.transport('/api/approval',request,this.sessionToken);this.applyState(result.state,originRunId);
   if(ticket===this.selectionRevision&&originRunId===this.state?.runId){this.packet=result.packet;this.notice='搭配批准已取得；送出前會由合約再驗證。';}
   else this.notice='錢包或搭配已變更，已捨棄先前的批准。';
  }catch(error){this.applyState(error.state,originRunId);this.error=error;this.notice='搭配批准未取得，請依提示修正後重試。';}
  finally{this.busy=false;this.notify();}
 }
 openReview(action){
  this.assertIdle();const phase=salePhase(this.state);
  if(action==='approve'&&(phase!=='open'||this.route!=='paid'))throw localError('PAID_NOT_STARTED');
  if(action!=='approve'){
   const reason=mintReadiness(this.state,this.wallet,this.look,this.packet,this.route);if(reason)throw localError(reason);
   action=this.route==='free'?'mintFree':'mintPaid';
  }
  this.review={action,wallet:this.wallet,look:clone(this.look),packet:clone(this.packet),runId:this.state.runId,selectionRevision:this.selectionRevision};
  this.error=null;this.notice='請核對下方明細；確認後才會送出本機交易。';this.notify();
 }
 cancelReview(){this.review=null;if(this.uncertainSubmission){this.error=localError('TX_OUTCOME_UNKNOWN');this.notice='先前交易的結果仍未確認，請重新讀取合約。';}else{this.notice='已取消明細，沒有送出交易或消耗 Gas。';this.error=null;}this.notify();}
 receiptFor(receipt,submitted){return {...receipt,submittedWallet:submitted.wallet,submittedAction:submitted.action,submittedLook:submitted.look};}
 reconcileSubmission(state){
  const submitted=this.uncertainSubmission;if(!submitted)return;
  if(state.runId!==submitted.runId){this.uncertainSubmission=null;this.packet=null;this.error=null;this.notice='本機鏈已重置；先前的交易結果無法從這條新鏈核對，可以重新演練。';return;}
  const receipt=state.receipts?.find(row=>row.submissionId===submitted.submissionId&&row.wallet===submitted.wallet&&row.action===submitted.action&&row.from?.toLowerCase()===submitted.walletAddress.toLowerCase());
  if(!receipt){this.error=localError('TX_OUTCOME_UNKNOWN');this.notice='尚未找到這次交易的收據，結果仍未確認。請重新讀取合約，請勿重複送出；GOLD 保留不會因畫面取消而解除。';return;}
  this.lastReceipt=this.receiptFor(receipt,submitted);this.uncertainSubmission=null;this.packet=null;
  this.error=Number(receipt.status)===1?null:localError('TRANSACTION_REVERTED');
  this.notice=Number(receipt.status)===1?'已找回這次交易的成功收據；餘額與 NFT 歸屬已重新讀取。':'已找回這次交易的失敗收據；請查看實際 Gas 與回滾後的狀態。';
 }
 async readUncertainSubmission(){
  try{const result=await this.transport('/api/state',null,this.sessionToken);this.sessionToken=result.sessionToken??this.sessionToken;this.applyState(result.state);this.reconcileSubmission(result.state);}
  catch{this.error=localError('TX_OUTCOME_UNKNOWN');this.notice='未收到交易結果，而且暫時無法讀取本機鏈。結果仍未確認，請重新讀取；請勿重複送出。';}
 }
 async confirm(){
  this.assertIdle();if(!this.review)throw localError('NO_REVIEW');
  const submitted={...this.review,submissionId:globalThis.crypto.randomUUID(),walletAddress:this.state.wallets.find(row=>row.id===this.review.wallet).address};
  if(submitted.runId!==this.state.runId||submitted.selectionRevision!==this.selectionRevision)throw localError('REVIEW_INVALIDATED');
  this.review=null;this.busy=true;this.error=null;this.notice='交易已送往本機合約，正在等待交易收據。';this.notify();
  try{
   const body={action:submitted.action,wallet:submitted.wallet,submissionId:submitted.submissionId};if(submitted.action!=='approve')body.packet=submitted.packet;
   const result=await this.transport('/api/transaction',body,this.sessionToken);this.applyState(result.state,submitted.runId);
   this.lastReceipt=this.receiptFor(result.receipt,submitted);
   this.notice=submitted.action==='approve'?'付款授權已上鏈，可以查看 Mint 明細。':'Mint 已上鏈；NFT 歸屬與資料已重新讀取。';
   if(submitted.action!=='approve')this.packet=null;
  }catch(error){
   this.applyState(error.state,submitted.runId);this.error=error;
   if(error.receipt)this.lastReceipt=this.receiptFor(error.receipt,submitted);
   if(error.stage==='reverted')this.notice='合約拒絕此交易；已重新讀取餘額與 NFT 歸屬。';
   else if(error.stage==='validation')this.notice='請求未通過驗證，請依提示修正後重試。';
   else{this.uncertainSubmission=submitted;this.packet=null;this.notice='未收到交易結果；可能已上鏈，正在重新讀取本機合約。';await this.readUncertainSubmission();}
  }finally{this.busy=false;this.notify();}
 }
 async admin(action,seconds){
  this.assertIdle(action==='reset');const originRunId=this.state.runId;this.busy=true;this.review=null;this.error=null;
  this.notice='正在更新本機測試狀態。';this.notify();
  try{
   const body={action};if(seconds!==undefined)body.seconds=seconds;
   const result=await this.transport('/api/admin',body,this.sessionToken);
   this.sessionToken=result.sessionToken??this.sessionToken;
   if(action==='reset'){this.state=null;this.lastReceipt=null;this.uncertainSubmission=null;this.invalidate();this.applyState(result.state);}
   else this.applyState(result.state,originRunId);
   if(result.receipt)this.lastReceipt={...result.receipt,submittedWallet:'管理員',submittedAction:action};
   this.notice=action==='reset'?'本機鏈已重置，先前交易與 NFT 已清除。':'本機測試狀態已更新。';
  }catch(error){this.applyState(error.state,originRunId);this.error=error;this.notice='本機操作未完成，已保留可讀取的合約狀態。';}
  finally{this.busy=false;this.notify();}
 }
}
