import {clothing,initialLook,selectClothing,bottomBlocked,optionFor} from '/lib/appearance.mjs';
import {bodies,appearanceIdentity} from '/lib/catalogue.mjs';
import {LocalMintClient,salePhase,mintReadiness} from '/client-state.mjs';
const el=id=>document.getElementById(id);
const client=new LocalMintClient(transport,initialLook());
const messages={
 STATE_LOADING:'先重新讀取本機合約。',WALLET_UNKNOWN:'請選擇本機測試錢包。',TRANSACTION_PENDING:'交易尚未完成，請等待收據。',
 MINT_PAUSED:'Mint 已暫停；可在本機管理操作恢復。',SOLD_OUT:'2222 枚已售罄。',FREE_NOT_STARTED:'免費 Mint 尚未開始。',PAID_NOT_STARTED:'請選擇付費流程，並等待共同開售時間。',
 NOT_IN_SNAPSHOT:'這個測試錢包沒有免費資格，可改選付費 Mint。',FREE_ALREADY_CLAIMED:'這個錢包已免費領取 1 枚；可改選付費 Mint。',
 EMBEO_INSUFFICIENT:'測試 EMBEO 餘額不足，無法支付這次 Mint。',APPROVAL_REQUIRED:'先查看並確認 EMBEO 付款授權。',APPEARANCE_APPROVAL_REQUIRED:'先取得這個搭配的簽名批准。',
 APPEARANCE_APPROVAL_EXPIRED:'搭配批准已過期，請重新取得。',APPEARANCE_ALREADY_MINTED:'這個搭配已被 Mint，請重新選擇。',SALE_NOT_STARTED:'尚未到共同開售時間。',GOLD_INSUFFICIENT:'可用測試 GOLD 不足。',MINT_ROUTE_CHANGED:'流程已變更，請重新取得批准。',PAID_ORDER_UNAVAILABLE:'訂單已完成或解除，請重新取得批准。',
 REVIEW_INVALIDATED:'錢包、搭配或合約狀態已變更，請重新查看明細。',NO_REVIEW:'先查看交易明細。',TOP_BLOCKS_BOTTOM:'長袍涵蓋下身，不能另外搭配褲子。',
 PACKET_EXPIRED:'搭配批准已過期，請重新取得。',PACKET_INVALID:'搭配批准無效，請重新取得。',PACKET_RUN_MISMATCH:'本機鏈已重置，請重新取得搭配批准。',
 PACKET_WALLET_MISMATCH:'批准與買家不一致，請重新取得搭配批准。',PAYMENT_CONTEXT_CHANGED:'收款設定已變更，請重新取得批准與明細。',
 HTTP_ERROR:'本機服務回應失敗，請重新讀取合約。',NETWORK_UNAVAILABLE:'本機服務尚未連線，請重新讀取合約。',SESSION_INVALID:'本機服務已重新啟動，請重新讀取合約。',
 TX_OUTCOME_UNKNOWN:'交易結果仍未確認，請重新讀取合約；在找到收據或重置本機鏈前，請勿重複送出。',TRANSACTION_REVERTED:'合約拒絕交易，請查看實際 Gas 與回滾後的狀態。',
 SaleNotStarted:'開售尚未開始。',PaidMintNotStarted:'付費 Mint 尚未開始。',FreeMintClosed:'免費期限已結束。',FreeAlreadyClaimed:'此錢包已使用免費資格。',
 AppearanceAlreadyMinted:'這個搭配已被 Mint，請重新選擇。',ApprovalExpired:'搭配批准已過期，請重新取得。',InvalidSignerEpoch:'批准者已輪替，請重新取得搭配批准。'
};
function errorText(error){const code=error?.code??error?.message;return messages[code]??error?.message??'操作未完成，請重新讀取合約。';}
async function transport(path,body,sessionToken){
 let response;
 try{response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Local-Session':sessionToken??''}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});}
 catch{throw Object.assign(Error('NETWORK_UNAVAILABLE'),{code:'NETWORK_UNAVAILABLE'});}
 const result=await response.json();
 if(!response.ok||result.ok!==true){const detail=result.error??{};throw Object.assign(Error(detail.message??detail.code??'HTTP_ERROR'),{code:detail.code??'HTTP_ERROR',stage:detail.stage,state:result.state,receipt:detail.receipt});}
 return result;
}
function perform(action){try{Promise.resolve(action()).catch(showError);}catch(error){showError(error);}}
function showError(error){client.error=error;client.notify();}
function tokenText(value){const number=BigInt(value??'0'),whole=number/10n**18n,decimal=(number%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return whole.toLocaleString('zh-TW')+(decimal?'.'+decimal:'');}
function ethText(value){const amount=BigInt(value??'0'),whole=amount/10n**18n,decimal=(amount%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');return whole.toString()+(decimal?'.'+decimal:'');}
function duration(seconds){seconds=Math.max(0,seconds);return Math.floor(seconds/86400)+' 天 '+Math.floor(seconds%86400/3600)+' 時 '+Math.floor(seconds%3600/60)+' 分 '+seconds%60+' 秒';}
function lookText(look){if(!look)return '—';return [bodies.find(body=>body.id===look.body)?.name,...clothing.map(slot=>optionFor(slot.id,look[slot.id])?.name)].join('、');}
function text(id,value){el(id).textContent=value??'—';}
function picture(item){const frame=document.createElement('span'),image=document.createElement('img');frame.className='crop';image.src='/assets/'+item.image+'.png';image.alt='';image.loading='lazy';const[x,y,width,height]=item.crop;image.style.width=100/width+'%';image.style.height=100/height+'%';image.style.left=-100*x/width+'%';image.style.top=-100*y/height+'%';frame.append(image);return frame;}
function reference(item){el('reference').src='/assets/'+item.image+'.png';el('reference').alt=item.name+'概念素材參考';text('reference-caption',item.name+'概念參考；尚未合成正式 3D 模型。');}
function createShelf(){
 for(const body of bodies){const button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.body=body.id;button.textContent=body.name;button.onclick=()=>client.setLook({...client.look,body:body.id});el('bodies').append(button);}
 for(const slot of clothing){const section=document.createElement('section'),heading=document.createElement('h3'),tiles=document.createElement('div');section.className='slot';heading.textContent=slot.name;tiles.className='tiles';tiles.setAttribute('role','group');tiles.setAttribute('aria-label',slot.name);
  for(const item of slot.options){const button=document.createElement('button'),name=document.createElement('span'),state=document.createElement('span');button.type='button';button.className='item';button.dataset.slot=slot.id;button.dataset.item=item.id;button.setAttribute('aria-label',slot.name+'：'+item.name);name.className='item-name';name.textContent=item.name;state.className='item-state';button.append(picture(item),name,state);button.onclick=()=>perform(()=>{client.setLook(selectClothing(client.look,slot.id,item.id));reference(item);});tiles.append(button);}
  section.append(heading,tiles);el('clothing').append(section);
 }
}
function drawShelf(){
 for(const button of document.querySelectorAll('[data-body]'))button.setAttribute('aria-pressed',String(button.dataset.body===client.look.body));
 for(const button of document.querySelectorAll('.item')){const blocked=button.dataset.slot==='bottom'&&button.dataset.item!=='none'&&bottomBlocked(client.look),selected=client.look[button.dataset.slot]===button.dataset.item;button.disabled=blocked;button.setAttribute('aria-pressed',String(selected));button.querySelector('.item-state').textContent=blocked?'長袍不可搭配':selected?'已選擇':'選擇這件';}
 text('fit-status',bottomBlocked(client.look)?'長袍涵蓋下身，已清除褲子並停用褲子選項。':'各部件可分開選擇；實際 3D 相容性仍待驗收。');
}
function drawSale(state){
 const phase=salePhase(state),paused=state?.paused?' · 已暫停':'';
 text('phase',({loading:'正在讀取合約',waiting:'尚未開售',open:'免費與付費同時開放',soldout:'已售罄'})[phase]+paused);
 text('countdown',!state?'—':phase==='waiting'?'距離開始 '+duration(state.freeStartAt-state.now):phase==='soldout'?'合約已達總量上限。':'無三天截止；共用剩餘供應，先完成 Mint 者取得。');
 text('minted',state?state.totalMinted+' / 2222':'— / 2222');text('reserved',state?.freeReserved);text('available',state?.paidAvailable);
}
function drawBuyer(state){
 const account=state?.wallets.find(row=>row.id===client.wallet),phase=salePhase(state),route=client.route,ready=mintReadiness(state,client.wallet,client.look,client.packet,route);el('route').value=route;
 el('wallet').value=client.wallet;
 text('eligibility',!account?'正在核對免費資格。':account.freeClaimed?'此錢包已免費領取 1 枚。':account.eligible?'此測試錢包符合免費資格，可免費領取 1 枚。':'此測試錢包沒有免費資格；可改選付費 Mint。');
 text('wallet-address',account?.address);text('balance-token',account?tokenText(account.tokenBalanceAtomic)+' EMBEO':'—');text('balance-eth',account?ethText(account.ethBalanceWei)+' ETH':'—');text('allowance',route==='free'?'免費流程無需付款授權':account?tokenText(account.allowanceAtomic)+' EMBEO':'—');
 text('price-label','本機測試費用（非正式價格）');text('gold-book',account?.gold.book);text('gold-available',account?.gold.available);text('gold-reserved',account?.gold.reserved);text('price',route==='free'?'0 EMBEO ＋ 0 GOLD':route==='paid'?tokenText(state.priceAtomic)+' EMBEO ＋ '+state.goldPrice+' GOLD':'—');
 const occupied=state?.records.some(record=>record.key===appearanceIdentity(client.look).key);
 text('look-state',occupied?'已被 Mint；請重新搭配':'合法概念搭配，尚未被 Mint');text('approval-time',client.packet?state.now>client.packet.deadline?'已過期':duration(client.packet.deadline-state.now):'尚未取得');
 text('readiness',client.busy?'請等待目前的本機請求完成。':client.uncertainSubmission?messages.TX_OUTCOME_UNKNOWN:ready?messages[ready]??ready:'條件已就緒，可以查看 Mint 明細。');
 el('get-approval').disabled=client.busy||Boolean(client.uncertainSubmission)||!state||state.paused||phase==='soldout'||phase==='waiting'||occupied||route==='free'&&(!account?.eligible||account?.freeClaimed);
 text('get-approval',client.packet&&state.now<=client.packet.deadline?'重新取得搭配批准':route==='paid'?'保留 GOLD 並取得批准':'取得免費搭配批准');
 el('approve').hidden=route!=='paid'||Boolean(account&&BigInt(account.allowanceAtomic)>=BigInt(state.priceAtomic));
 el('approve').disabled=client.busy||Boolean(client.uncertainSubmission)||!state||state.paused||route!=='paid'||!account||BigInt(account.tokenBalanceAtomic)<BigInt(state.priceAtomic);
 el('mint').disabled=client.busy||Boolean(client.uncertainSubmission)||Boolean(ready);text('mint',route==='paid'?'查看付費 Mint 明細':'查看免費 Mint 明細');el('refresh').disabled=client.busy;
}
function drawReview(state){
 const review=client.review;el('review').hidden=!review;if(!review)return;
 text('review-title',review.action==='approve'?'確認 EMBEO 付款授權':'確認 '+(review.action==='mintFree'?'免費':'付費')+' Mint');
 text('review-details',review.action==='approve'?'將授權本機 Mint 合約使用 '+tokenText(state.priceAtomic)+' 測試 EMBEO。授權這一步不會扣除 Mint 費用。':(review.action==='mintFree'?'免費 Mint 1 枚，不扣除 EMBEO 或 GOLD。':'付費 Mint 1 枚，支付 '+tokenText(state.priceAtomic)+' 測試 EMBEO ＋ '+state.goldPrice+' 測試 GOLD。GOLD 已保留，鏈上成功核對後結算。'));
 const wallet=state.wallets.find(row=>row.id===review.wallet);text('review-wallet','錢包 '+review.wallet+' · '+wallet.address);text('review-recipient',review.action==='mintFree'?'免費 Mint 無需付款':state.recipient);text('review-look',review.action==='approve'?'付款授權不會占用造型':lookText(review.look));
 text('confirm',review.action==='approve'?'確認授權並送出本機交易':'確認 Mint 並送出本機交易');el('confirm').disabled=client.busy;el('cancel').disabled=client.busy;
}
function drawReceipt(state){
 const receipt=client.lastReceipt;el('receipt').hidden=!receipt;el('receipt-metadata').hidden=true;if(!receipt)return;
 const action=receipt.submittedAction??receipt.action,success=Number(receipt.status)===1,token=state?.records.find(record=>record.id===receipt.tokenId);
 const names={approve:'付款授權',mintFree:'免費 Mint',mintPaid:'付費 Mint',pause:'暫停 Mint',resume:'恢復 Mint',rotateSigner:'輪替批准者',changeRecipient:'更換收款地址'};
 text('receipt-summary',(names[action]??'本機交易')+(success?'成功':'失敗')+' · 送出'+(receipt.submittedWallet==='管理員'?'管理員':'錢包 '+(receipt.submittedWallet??receipt.wallet))+(receipt.tokenId?' · Ember Evo '+receipt.tokenId:''));
 text('receipt-hash',receipt.hash??receipt.transactionHash);text('receipt-block',receipt.blockNumber);text('receipt-gas',receipt.gasUsed);text('receipt-fee',ethText(receipt.feeWei)+' ETH');text('receipt-owner',token?.owner??receipt.owner??'沒有建立新的 NFT');text('receipt-uri',token?.uri??receipt.tokenURI??'—');
 if(token?.metadata){el('receipt-metadata').hidden=false;text('receipt-json',JSON.stringify(token.metadata,null,2));el('download-metadata').onclick=()=>downloadJSON(token.metadata,'ember-evo-'+token.id+'-local.json');}
}
function appendFact(target,label,value){const row=document.createElement('div'),term=document.createElement('dt'),data=document.createElement('dd');term.textContent=label;data.textContent=value??'—';row.append(term,data);target.append(row);}
function drawRecords(state){
 const records=state?.records??[];text('records-count',records.length+' 枚');el('records').replaceChildren();
 if(!records.length){const p=document.createElement('p');p.className='muted';p.textContent='尚無本機 NFT。';el('records').append(p);return;}
 for(const record of [...records].reverse()){const details=document.createElement('details'),summary=document.createElement('summary'),description=document.createElement('p'),facts=document.createElement('dl'),metadata=document.createElement('pre');details.className='nft';summary.textContent='Ember Evo '+record.id+' · '+lookText(record.selection);description.textContent='此編號、歸屬與資料位址已從本機合約讀回。';facts.className='facts';appendFact(facts,'NFT 歸屬',record.owner);appendFact(facts,'資料位址',record.uri);appendFact(facts,'交易雜湊',record.transactionHash);metadata.textContent=JSON.stringify(record.metadata,null,2);details.append(summary,description,facts,metadata);el('records').append(details);}
}
function drawAdmin(state){
 for(const id of ['advance-paid','advance-approval','pause','rotate-signer','change-recipient','reset','reset-confirm'])el(id).disabled=client.busy||!state;
 if(client.uncertainSubmission)for(const id of ['advance-paid','advance-approval','pause','rotate-signer','change-recipient'])el(id).disabled=true;
 el('advance-paid').disabled=client.busy||Boolean(client.uncertainSubmission)||!state;text('pause',state?.paused?'恢復 Mint':'暫停 Mint');
 text('chain-time',state?'31337 · '+state.now+' 秒':'—');text('contract-address',state?.contractAddress);text('token-address',state?.tokenAddress);text('signer-epoch',state?.signerEpoch);text('signer-address',state?.signer);text('recipient-address',state?.recipient);
 if(client.busy)el('reset-review').hidden=true;
}
function draw(){const state=client.state;text('status',client.uncertainSubmission?messages.TX_OUTCOME_UNKNOWN:client.error?errorText(client.error):client.notice);el('status').dataset.error=String(Boolean(client.error)||Boolean(client.uncertainSubmission));drawSale(state);drawShelf();drawBuyer(state);drawReview(state);drawReceipt(state);drawRecords(state);drawAdmin(state);}
function downloadJSON(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
el('route').onchange=()=>client.setRoute(el('route').value);
el('wallet').onchange=()=>client.setWallet(el('wallet').value);
el('get-approval').onclick=()=>perform(()=>client.obtainApproval());el('approve').onclick=()=>perform(()=>client.openReview('approve'));el('mint').onclick=()=>perform(()=>client.openReview('mint'));el('confirm').onclick=()=>perform(()=>client.confirm());el('cancel').onclick=()=>client.cancelReview();el('refresh').onclick=()=>perform(()=>client.refresh());
el('advance-paid').onclick=()=>perform(()=>client.admin('advanceThreeDays'));el('advance-approval').onclick=()=>perform(()=>client.admin('advance',301));el('pause').onclick=()=>perform(()=>client.admin(client.state.paused?'resume':'pause'));el('rotate-signer').onclick=()=>perform(()=>client.admin('rotateSigner'));el('change-recipient').onclick=()=>perform(()=>client.admin('changeRecipient'));
el('reset').onclick=()=>{client.cancelReview();el('reset-review').hidden=false;};el('reset-cancel').onclick=()=>{el('reset-review').hidden=true;};el('reset-confirm').onclick=()=>perform(()=>client.admin('reset'));
createShelf();client.onChange=()=>{draw();drawOrders();};draw();void client.refresh();

function drawOrders(){
 el('orders').replaceChildren();
 for(const order of client.state?.orders.filter(o=>o.wallet===client.wallet)??[]){
  const row=document.createElement('div'),description=document.createElement('p');
  description.textContent=order.orderId.slice(0,12)+'… · '+({reserved:'GOLD 保留中',consumed:'已完成並扣點',released:'已解除保留'}[order.status]??order.status)+(order.error?' · 暫待鏈上核對':'');row.append(description);
  if(order.status==='reserved'){const button=document.createElement('button');button.className='secondary';button.textContent='取消訂單並核對保留';button.disabled=client.busy;button.onclick=()=>perform(async()=>{
   client.busy=true;client.notify();try{const result=await transport('/api/order/cancel',{wallet:order.wallet,orderId:order.orderId},client.sessionToken);client.applyState(result.state);client.invalidate();client.notice='已核對原訂單；成功訂單不退款，未成功且授權已撤銷才解除保留。';}finally{client.busy=false;client.notify();}
  });row.append(button);}el('orders').append(row);
 }
}
// Read-only recovery while an order is unresolved. Never resubmit a transaction.
setInterval(()=>{if(!client.busy&&!client.review&&(client.uncertainSubmission||client.state?.orders.some(o=>o.status==='reserved')))void client.refresh();},3000);
