import {useEffect,useState} from 'react';
import type {GoldOrder,GoldState} from './worldGoldClient.ts';
import type {EconomyWalletState} from './economyWallet.ts';
import type {EconomyConfig} from './economyClient.ts';
import {economyTokenAmount} from './economyClient.ts';
import {balanceNumber} from './WalletBalanceHud.tsx';
import {purchaseStage,topupProducts,goldPurchaseError} from './goldPurchaseRules.ts';
import type {FastFollow} from './fastGoldCredit.ts';

type Props={data:GoldState;selected:GoldOrder|null;wallet:EconomyWalletState;config:EconomyConfig|null;busy:boolean;zh:boolean;fast?:FastFollow|null;quote:(product:string)=>void;prepare:()=>void;approve:()=>void;confirm:()=>void;check:()=>void;reconcile:()=>void;clear:()=>void};
/** All prices and credited amounts come from authenticated server snapshots.
 * Selecting a package/quote never requests a signature or sends a transaction. */
export function GoldPurchase({data,selected,wallet,config,busy,zh,fast,quote,prepare,approve,confirm,check,reconcile,clear}:Props){
 const say=(a:string,b:string)=>zh?a:b,products=topupProducts(data.products),[product,setProduct]=useState(''),[ack,setAck]=useState(false),[now,setNow]=useState(Date.now);
 const order=selected?.kind==='topup'?selected:null,chosen=products.find(p=>p.product===product)??products.find(p=>p.gold==='1000')??products[0];
 useEffect(()=>{setAck(false);},[order?.id,data.wallet]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const stage=purchaseStage(order,wallet,now),locked=busy||wallet.busy,unresolved=['pending','unknown','sending','checking'].includes(wallet.phase),prepared=wallet.plan?.kind==='pay'&&!['confirmed','rejected','error','context-changed','replaced'].includes(wallet.phase),canStart=data.paymentsReady===true&&!!data.controls.find(c=>c.feature==='topup'&&c.enabled)&&!unresolved;
 const sameRate=products.length>0&&products.every(p=>BigInt(p.embeo!)===BigInt(p.gold)*100n*10n**18n);
 const amount=order?.amount??chosen?.embeo,gold=order?.gold??chosen?.gold;
 return <section className="gold-purchase" aria-labelledby="gold-purchase-title" data-purchase-stage={stage}>
  <div className="gold-purchase-heading"><h2 id="gold-purchase-title">{say('購買 GOLD','Buy GOLD')}</h2><span>{say('單向購點','One-way purchase')}</span></div>
  {sameRate&&<p className="gold-purchase-rate">100 EMBEO <span aria-hidden="true">→</span> 1 GOLD</p>}
  {!order?<><div className="gold-quick-plans" role="group" aria-label={say('選擇購點方案','Choose a package')}>{products.map(p=><button key={p.id} aria-pressed={chosen?.id===p.id} disabled={locked||unresolved||prepared&&wallet.phase!=='confirmed'} onClick={()=>setProduct(p.product)}><strong>{balanceNumber(p.gold)} GOLD</strong><span>{balanceNumber(economyTokenAmount(p.embeo!))} EMBEO</span></button>)}</div>{!products.length&&<p role="status">{say('購點方案尚未開放。','Purchase packages are not available yet.')}</p>}</>:<>
   <h3>{stage==='credited'?say('GOLD 已入帳','GOLD credited'):stage==='expired'?say('此報價已到期','Quote expired'):stage==='awaiting-credit'?say('正在核對入帳','Confirming GOLD credit'):say('核對購點內容','Review purchase')}</h3>
   <p className="gold-order-reference">{say('原始訂單','Original order')}<code>{order.id}</code></p>
  </>}
  {amount&&gold&&<dl className="gold-purchase-total"><div><dt>{say('獲得','Receive')}</dt><dd>{balanceNumber(gold)} GOLD</dd></div><div><dt>{say('需支付','Pay')}</dt><dd>{balanceNumber(economyTokenAmount(amount))} EMBEO</dd></div></dl>}
  <p className="gold-purchase-fee">{say('Ethereum 主網。鏈上手續費另計，以錢包顯示為準。','Ethereum mainnet. Network fees are separate and shown by your wallet.')}</p>
  <p className="gold-purchase-timing"><strong>{say('付款上鏈後約 12 秒入帳。','Credited about 12 seconds after your payment is on chain.')}</strong>{say('以太坊每 12 秒產生一個區塊，網路壅塞時可能稍久。入帳前右上角會顯示「入帳中」。',' Ethereum makes a block every 12 seconds; it can take longer when the network is busy. Until then the top bar shows "crediting".')}</p>
  <div className="gold-receiving-wallet"><span>{say('GOLD 入帳錢包','Receiving wallet')}</span><code>{data.wallet}</code></div>
  <p className="gold-purchase-terms">{say('GOLD 綁定此錢包、跨館共用。不可轉讓、不可賣出，也不能兌回 EMBEO。','GOLD is wallet-bound and shared across World. It cannot be transferred, sold or redeemed for EMBEO.')}</p>
  {order&&stage!=='credited'&&stage!=='awaiting-credit'&&stage!=='expired'&&<label className="gold-purchase-ack"><input type="checkbox" checked={ack} disabled={locked||unresolved} onChange={e=>setAck(e.target.checked)}/><span>{say('我已核對入帳錢包，並了解這是單向購點。','I checked the receiving wallet and understand this is a one-way purchase.')}</span></label>}
  {config&&order&&<details className="gold-contract-details"><summary>{say('查看付款合約與收款地址','Payment contract and treasury')}</summary><p>EMBEO<code>{config.token}</code></p><p>{say('付款合約','Payment contract')}<code>{config.paymentContract}</code></p><p>{say('EMBEO 收款地址','EMBEO treasury')}<code>{config.treasury}</code></p></details>}
  {wallet.hash&&<p className="gold-transaction-reference">{say('交易雜湊','Transaction hash')}<a href={'https://etherscan.io/tx/'+wallet.hash} target="_blank" rel="noopener noreferrer">{wallet.hash}</a></p>}
  <div className="gold-purchase-buttons">
   {!order&&<button className="gold-primary" disabled={!chosen||!canStart||locked||prepared&&wallet.phase!=='confirmed'} onClick={()=>chosen&&quote(chosen.product)}>{say('核對購點內容','Review purchase')}</button>}
   {order&&stage==='review'&&<button className="gold-primary" disabled={locked||!ack||!config||unresolved} onClick={prepare}>{say('下一步：檢查授權額度','Next: check allowance')}</button>}
   {order&&stage==='approve'&&<button className="gold-primary" disabled={locked||!ack} onClick={approve}>{wallet.phase==='reset-required'?say('先將原授權歸零','Reset existing allowance'):say('授權本筆指定額度','Approve exact purchase amount')}</button>}
   {order&&stage==='confirm'&&<button className="gold-primary" disabled={locked||!ack} onClick={confirm}>{say('確認 EMBEO 付款','Confirm EMBEO payment')}</button>}
   {['pending','unknown'].includes(wallet.phase)&&wallet.hash&&<button className="gold-primary" disabled={locked} onClick={check}>{say('查詢原交易','Check original transaction')}</button>}
   {order&&(stage==='awaiting-credit'||order.status==='paid')&&stage!=='credited'&&<button className="gold-primary" disabled={locked} onClick={reconcile}>{say('查詢原單入帳','Check original credit')}</button>}
   {order&&(stage==='credited'||stage==='expired'||!prepared&&!unresolved&&stage==='review')&&<button disabled={locked} onClick={clear}>{stage==='credited'?say('完成','Done'):stage==='expired'?say('重新選擇方案','Choose a new package'):say('修改方案','Change package')}</button>}
  </div>
  {!canStart&&!order&&products.length>0&&<p role="status">{say('目前暫停新購點訂單，原交易仍可查詢。','New purchases are paused. Existing transactions can still be checked.')}</p>}
  {stage==='approve'&&<p role="status">{say('授權不等於付款。請確認錢包中的額度，完成授權後還需確認付款。','Approval is separate from payment. Check the allowance in your wallet, then confirm payment.')}</p>}
  {(stage==='pending'||stage==='awaiting-credit')&&fast?.status==='crediting'&&<p role="status">{say('付款已送出，入帳中（約 12 秒）。GOLD 到帳後右上角會自動更新，你可以先返回世界；請勿重複付款。','Payment sent; crediting (about 12 seconds). The top bar updates by itself when the GOLD arrives, so you can go back to the World. Do not pay again.')}</p>}
  {stage==='pending'&&fast?.status!=='crediting'&&<p role="status">{say('交易確認中，請勿重複付款。','Transaction pending. Do not pay again.')}</p>}
  {stage==='awaiting-credit'&&fast?.status!=='crediting'&&<p role="status">{say('這筆付款改由鏈上最終確認後入帳，最晚約 15 分鐘。GOLD 尚未入帳，請稍後按「查詢原單入帳」（也會再試一次快速入帳），不需再次付款。','This payment is credited after final chain confirmation instead, at most about 15 minutes. GOLD is not credited yet. Press "Check original credit" later (it also retries the fast credit); do not pay again.')}{fast?.code&&<small className="gold-fast-code"> {say('參考代碼：','Reference: ')}{fast.code}</small>}</p>}
  {stage==='credited'&&<p role="status">{say('已核對帳本入帳；右上角資產餘額會同步更新。','Ledger credit verified. Your asset balance will refresh.')}</p>}
  {wallet.error&&<p role="alert">{goldPurchaseError(wallet.error,zh)}</p>}
  {wallet.phase==='unknown'&&!wallet.hash&&<p role="alert">{say('錢包回覆不明，已暫停新付款。請先在錢包核對原交易，勿重複付款。','Wallet response is uncertain. New payments are blocked. Check the original transaction in your wallet; do not pay again.')}</p>}
  {order&&stage==='expired'&&<p>{say('報價已到期；如已送出交易，仍會依原訂單核對入帳。','The quote expired. Any payment already sent will still be reconciled against the original order.')}</p>}
 </section>;
}
