import {useEffect,useState} from 'react';
import type {GoldOrder,GoldState} from './worldGoldClient.ts';
import type {EconomyWalletState} from './economyWallet.ts';
import type {EconomyConfig} from './economyClient.ts';
import {economyTokenAmount} from './economyClient.ts';
import {balanceNumber} from './WalletBalanceHud.tsx';
import {purchaseStage,topupProducts,goldPurchaseError} from './goldPurchaseRules.ts';
import {PENDING_CREDIT_ETA_MS,type PendingCredit} from './pendingGoldCredit.ts';

type Props={data:GoldState;selected:GoldOrder|null;wallet:EconomyWalletState;config:EconomyConfig|null;busy:boolean;zh:boolean;pending?:PendingCredit|null;quote:(product:string)=>void;prepare:()=>void;approve:()=>void;confirm:()=>void;check:(hash?:string)=>void;clearUnknown?:()=>void;reconcile:()=>void;clear:()=>void};
/** All prices and credited amounts come from authenticated server snapshots.
 * Selecting a package/quote never requests a signature or sends a transaction. */
export function GoldPurchase({data,selected,wallet,config,busy,zh,pending,quote,prepare,approve,confirm,check,clearUnknown,reconcile,clear}:Props){
 const say=(a:string,b:string)=>zh?a:b,products=topupProducts(data.products),[product,setProduct]=useState(''),[ack,setAck]=useState(false),[now,setNow]=useState(Date.now);
 const [otherHash,setOtherHash]=useState(''),[checkedWallet,setCheckedWallet]=useState(false);
 const order=selected?.kind==='topup'?selected:null,chosen=products.find(p=>p.product===product)??products.find(p=>p.gold==='1000')??products[0];
 useEffect(()=>{setAck(false);},[order?.id,data.wallet]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const stage=purchaseStage(order,wallet,now),locked=busy||wallet.busy,unresolved=['pending','unknown','sending','checking'].includes(wallet.phase),prepared=wallet.plan?.kind==='pay'&&!['confirmed','rejected','error','context-changed','replaced'].includes(wallet.phase),canStart=data.paymentsReady===true&&!!data.controls.find(c=>c.feature==='topup'&&c.enabled)&&!unresolved;
 const sameRate=products.length>0&&products.every(p=>BigInt(p.embeo!)===BigInt(p.gold)*100n*10n**18n);
 const amount=order?.amount??chosen?.embeo,gold=order?.gold??chosen?.gold;
 const clock=(ms:number)=>new Date(ms).toLocaleTimeString(zh?'zh-TW':'en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
 return <section className="gold-purchase" aria-labelledby="gold-purchase-title" data-purchase-stage={stage}>
  <div className="gold-purchase-heading"><h2 id="gold-purchase-title">{say('購買 GOLD','Buy GOLD')}</h2><span>{say('單向購買點數','One-way purchase')}</span></div>
  {sameRate&&<p className="gold-purchase-rate">100 EMBEO <span aria-hidden="true">→</span> 1 GOLD</p>}
  {!order?<><div className="gold-quick-plans" role="group" aria-label={say('選擇購買點數方案','Choose a package')}>{products.map(p=><button key={p.id} aria-pressed={chosen?.id===p.id} disabled={locked||unresolved||prepared&&wallet.phase!=='confirmed'} onClick={()=>setProduct(p.product)}><strong>{balanceNumber(p.gold)} GOLD</strong><span>{balanceNumber(economyTokenAmount(p.embeo!))} EMBEO</span></button>)}</div>{!products.length&&<p role="status">{say('購買點數方案尚未開放。','Purchase packages are not available yet.')}</p>}</>:<>
   <h3>{stage==='credited'?say('GOLD 已入帳','GOLD credited'):stage==='expired'?say('此報價已到期','Quote expired'):stage==='awaiting-credit'?say('正在核對入帳','Confirming GOLD credit'):say('核對購買點數內容','Review purchase')}</h3>
   <p className="gold-order-reference">{say('原始訂單','Original order')}<code>{order.id}</code></p>
  </>}
  {amount&&gold&&<dl className="gold-purchase-total"><div><dt>{say('獲得','Receive')}</dt><dd>{balanceNumber(gold)} GOLD</dd></div><div><dt>{say('需支付','Pay')}</dt><dd>{balanceNumber(economyTokenAmount(amount))} EMBEO</dd></div></dl>}
  <p className="gold-purchase-fee">{say('Ethereum 主網。鏈上手續費另計，以錢包顯示為準。','Ethereum mainnet. Network fees are separate and shown by your wallet.')}</p>
  <p className="gold-purchase-timing"><strong>{say('付款完成後約 15 分鐘入帳。','Credited about 15 minutes after payment.')}</strong>{say('以太坊的付款要等到最終確認（約 13–15 分鐘）才會入帳，這樣交易被撤銷時也不會記錯帳。等待期間，右上角會用金色字顯示「+數量 入帳中」；你可以先返回世界，請勿重複付款。',' Ethereum payments are credited once they are final (about 13–15 minutes), so a reverted transaction never leaves a wrong balance. Meanwhile the top bar shows "+amount crediting" in gold; you can go back to the World. Do not pay again.')}</p>
  <div className="gold-receiving-wallet"><span>{say('GOLD 入帳錢包','Receiving wallet')}</span><code>{data.wallet}</code></div>
  <p className="gold-purchase-terms">{say('GOLD 綁定此錢包、跨館共用。不可轉讓、不可賣出，也不能兌回 EMBEO。','GOLD is wallet-bound and shared across World. It cannot be transferred, sold or redeemed for EMBEO.')}</p>
  {order&&stage!=='credited'&&stage!=='awaiting-credit'&&stage!=='expired'&&<label className="gold-purchase-ack"><input type="checkbox" checked={ack} disabled={locked||unresolved} onChange={e=>setAck(e.target.checked)}/><span>{say('我已核對入帳錢包，並了解這是單向購買點數。','I checked the receiving wallet and understand this is a one-way purchase.')}</span></label>}
  {config&&order&&<details className="gold-contract-details"><summary>{say('查看付款合約與收款地址','Payment contract and treasury')}</summary><p>EMBEO<code>{config.token}</code></p><p>{say('付款合約','Payment contract')}<code>{config.paymentContract}</code></p><p>{say('EMBEO 收款地址','EMBEO treasury')}<code>{config.treasury}</code></p></details>}
  {wallet.hash&&<p className="gold-transaction-reference">{say('交易雜湊','Transaction hash')}<a href={'https://etherscan.io/tx/'+wallet.hash} target="_blank" rel="noopener noreferrer">{wallet.hash}</a></p>}
  <div className="gold-purchase-buttons">
   {!order&&<button className="gold-primary" disabled={!chosen||!canStart||locked||prepared&&wallet.phase!=='confirmed'} onClick={()=>chosen&&quote(chosen.product)}>{say('核對購買點數內容','Review purchase')}</button>}
   {order&&stage==='review'&&<button className="gold-primary" disabled={locked||!ack||!config||unresolved} onClick={prepare}>{say('下一步：檢查授權額度','Next: check allowance')}</button>}
   {order&&stage==='approve'&&<button className="gold-primary" disabled={locked||!ack} onClick={approve}>{wallet.phase==='reset-required'?say('先將原授權歸零','Reset existing allowance'):say('授權本筆指定額度','Approve exact purchase amount')}</button>}
   {order&&stage==='confirm'&&<button className="gold-primary" disabled={locked||!ack} onClick={confirm}>{say('確認 EMBEO 付款','Confirm EMBEO payment')}</button>}
   {['pending','unknown'].includes(wallet.phase)&&wallet.hash&&<button className="gold-primary" disabled={locked} onClick={()=>check()}>{say('查詢原交易','Check original transaction')}</button>}
   {order&&(stage==='awaiting-credit'||order.status==='paid')&&stage!=='credited'&&<button className="gold-primary" disabled={locked} onClick={reconcile}>{say('查詢原單入帳','Check original credit')}</button>}
   {order&&(stage==='credited'||stage==='expired'||!prepared&&!unresolved&&stage==='review')&&<button disabled={locked} onClick={clear}>{stage==='credited'?say('完成','Done'):stage==='expired'?say('重新選擇方案','Choose a new package'):say('修改方案','Change package')}</button>}
  </div>
  {!canStart&&!order&&products.length>0&&<p role="status">{say('目前暫停新的購買點數訂單，原交易仍可查詢。','New purchases are paused. Existing transactions can still be checked.')}</p>}
  {stage==='approve'&&<p role="status">{say('授權不等於付款。請確認錢包中的額度，完成授權後還需確認付款。','Approval is separate from payment. Check the allowance in your wallet, then confirm payment.')}</p>}
  {(stage==='pending'||stage==='awaiting-credit')&&pending&&<p role="status" className="gold-credit-pending">{say(`入帳中：+${balanceNumber(pending.gold)} GOLD，預計 ${clock(pending.atMs+PENDING_CREDIT_ETA_MS)} 前入帳（約 15 分鐘）。`,`Crediting: +${balanceNumber(pending.gold)} GOLD, expected by ${clock(pending.atMs+PENDING_CREDIT_ETA_MS)} (about 15 minutes).`)}<small>{say('GOLD 到帳後右上角會自動更新，你可以先返回世界；請勿重複付款。','The top bar updates by itself when the GOLD arrives, so you can go back to the World. Do not pay again.')}</small></p>}
  {stage==='pending'&&!pending&&<p role="status">{say('交易確認中，請勿重複付款。','Transaction pending. Do not pay again.')}</p>}
  {stage==='awaiting-credit'&&!pending&&<p role="status" className="gold-credit-pending">{say('付款已上鏈，等待最終確認後入帳（約 15 分鐘）。GOLD 尚未入帳，可稍後按「查詢原單入帳」，不需再次付款。','Payment is on chain and is credited once final (about 15 minutes). GOLD is not credited yet; press "Check original credit" later. Do not pay again.')}</p>}
  {stage==='credited'&&<p role="status">{say('已核對帳本入帳；右上角資產餘額會同步更新。','Ledger credit verified. Your asset balance will refresh.')}</p>}
  {wallet.error&&<p role="alert">{goldPurchaseError(wallet.error,zh)}</p>}
  {wallet.phase==='unknown'&&!wallet.hash&&<p role="alert">{say('錢包回覆不明，已暫停新付款。請先在錢包核對原交易，勿重複付款。','Wallet response is uncertain. New payments are blocked. Check the original transaction in your wallet; do not pay again.')}</p>}
  {/* The same recovery the staking pane offers (EconomyPane.tsx): a payment cancelled or sped up in the wallet has a new
      hash only the player can supply, and a prompt that never returned a hash needs the player's acknowledgement.
      Without these the GOLD panel blocked every later purchase (Swarm audit 351b0573, findings 4 and 5). */}
  {wallet.phase==='unknown'&&<div className="gold-recovery">
   <p>{say('可從錢包貼入原交易、取消或加速交易的雜湊；系統會核對是否對應同一筆交易，完成最終確認後才解除防重。貼錯不會改寫原紀錄。','Paste the original transaction, cancellation or speed-up hash from your wallet. The record is cleared only after verifying the transaction and finality. An incorrect hash does not change the original record.')}</p>
   <label>{say('原交易或替代交易雜湊','Original or replacement transaction hash')}<input value={otherHash} onChange={e=>setOtherHash(e.target.value.trim().slice(0,66))}/></label>
   <button disabled={locked||!/^0x[0-9a-fA-F]{64}$/.test(otherHash)} onClick={()=>check(otherHash)}>{say('只核對這筆交易','Check this transaction only')}</button>
   {clearUnknown&&(wallet.legacyPending||!wallet.hash)&&<><label className="gold-purchase-ack"><input type="checkbox" checked={checkedWallet} onChange={e=>setCheckedWallet(e.target.checked)}/><span>{wallet.legacyPending?say('我已核對原交易及替代交易，確認原交易不會再執行；若判斷錯誤，再送出可能重複扣款。','I checked the original and replacement transactions and confirmed the original cannot execute again. A mistaken confirmation could result in a duplicate charge.'):say('我已核對錢包紀錄，確認原交易沒有送出；若判斷錯誤，再送出可能重複扣款。','I checked the wallet history and confirmed the original transaction was not broadcast. A mistaken confirmation could result in a duplicate charge.')}</span></label>
   <button disabled={locked||!checkedWallet} onClick={()=>{setCheckedWallet(false);clearUnknown();}}>{wallet.legacyPending?say('人工確認並解除舊版防重','Manually confirm and clear older record'):say('確認未送出，解除防重','Confirm not broadcast and clear record')}</button></>}
  </div>}
  {order&&stage==='expired'&&<p>{say('報價已到期；如已送出交易，仍會依原訂單核對入帳。','The quote expired. Any payment already sent will still be reconciled against the original order.')}</p>}
 </section>;
}
