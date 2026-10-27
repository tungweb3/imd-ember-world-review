import {fortuneProduct} from '../shared/fortunePricing.ts';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {AuthState} from './auth.ts';
import {WorldGoldClient,goldPriceInputAtomic,type GoldState,type GoldOrder} from './worldGoldClient.ts';
import {EconomyClient,economyRequestId,economySession,economyTokenAmount,EconomyClientError,type EconomyConfig,type EconomyOrder} from './economyClient.ts';
import {EconomyWalletController,localEconomyPending,type EconomyWalletState} from './economyWallet.ts';
import {GoldPurchase} from './GoldPurchase.tsx';
import {dropPendingCredit,dropPendingCreditByHash,markPendingCreditMined,paymentFailed,paymentHash,pendingCredit,settlePendingCredits,subscribePendingCredit,trackPendingCredit,type PendingCredit} from './pendingGoldCredit.ts';
import {ResearchPassCard} from './ResearchPassCard.tsx';
import {ResearchPassConfirm} from './ResearchPassConfirm.tsx';
import {RESEARCH_PASS_PRODUCT} from './researchPassCopy.ts';
import {goldPurchaseError} from './goldPurchaseRules.ts';
import {wallets} from './wallet.ts';
import './worldGold.css';
const EMPTY:EconomyWalletState={phase:'idle',busy:false,hash:null,sentHash:null,paidOrder:null,error:null,plan:null,step:null,legacyPending:false};
const message=(e:unknown)=>e instanceof EconomyClientError?e.code:e instanceof Error?e.message:'UNAVAILABLE';
function useGold(state:AuthState){
 const auth=useRef(state);auth.current=state;const client=useRef<WorldGoldClient|null>(null);if(!client.current)client.current=new WorldGoldClient({auth:()=>auth.current});
 const [read,setRead]=useState<{identity:string;value:GoldState}|null>(null),[error,setError]=useState<string|null>(null),[reading,setReading]=useState(false),[clock,setClock]=useState(Date.now),inflight=useRef<AbortController|null>(null);
 const session=economySession(state,clock),identity=session?session.address.toLowerCase()+':'+session.expiresAt:null,latest=useRef(identity);latest.current=identity;
 // A failed refresh keeps the last good ledger of the same identity on screen and names its code; a context change
 // is not a failure (the next read under the current session answers it). `reading` gives a refresh visible feedback.
 const refresh=useCallback(async()=>{if(!latest.current)return;const key=latest.current,abort=new AbortController();inflight.current?.abort();inflight.current=abort;setReading(true);
  try{const value=await client.current!.state(abort.signal);if(!abort.signal.aborted&&key===latest.current){setRead({identity:key,value});setError(null);}}
  catch(e){const code=message(e);if(!abort.signal.aborted&&key===latest.current&&code!=='CONTEXT_CHANGED')setError(code);}
  finally{if(inflight.current===abort)setReading(false);}
 },[]);
 useEffect(()=>{setRead(null);setError(null);if(identity)void refresh();return()=>inflight.current?.abort();},[identity,refresh]);
 // focus + visibilitychange on return make one read, not two that abort each other; a GOLD change always reads.
 useEffect(()=>{let last=0;const changed=()=>{setClock(Date.now());if(!document.hidden)void refresh();},passive=()=>{const t=Date.now();if(t-last<2000)return;last=t;changed();};const timer=setInterval(changed,12000);window.addEventListener('focus',passive);window.addEventListener('world:gold-changed',changed);document.addEventListener('visibilitychange',passive);return()=>{clearInterval(timer);window.removeEventListener('focus',passive);window.removeEventListener('world:gold-changed',changed);document.removeEventListener('visibilitychange',passive);};},[refresh]);
 return {client:client.current,auth,identity,data:identity&&read?.identity===identity?read.value:null,error,reading,refresh};
}
export function GoldWalletBlock({state,zh=true}:{state:AuthState;zh?:boolean}){
 const {data,error,identity,refresh}=useGold(state);if(!identity)return null;
 return <section className="gold-wallet-block"><h3>GOLD</h3>{data?<><strong>{data.available} GOLD</strong><p>{zh?'帳面':'Book'} {data.book} · {zh?'處理中保留':'Reserved'} {data.reserved}</p><small>{zh?'更新時間':'Updated'} {new Date(data.asOf).toLocaleTimeString()}</small></>:<p role="status">{error?(zh?'餘額暫時無法取得，請重試。':'Balance unavailable. Try again.'):(zh?'讀取餘額…':'Reading balance…')}</p>}
 <div><button onClick={()=>window.dispatchEvent(new Event('world:gold-open'))}>{zh?'購買 GOLD／查看紀錄':'Buy GOLD / history'}</button><button onClick={()=>void refresh()}>{zh?'更新':'Refresh'}</button></div></section>;
}
function Admin({client,data,refresh,zh}:{client:WorldGoldClient;data:GoldState;refresh:()=>Promise<void>;zh:boolean}){
 const [reason,setReason]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[product,setProduct]=useState(data.products[0]?.product??''),[gold,setGold]=useState(data.products[0]?.gold??'1'),[embeo,setEmbeo]=useState(data.products[0]?.embeo?economyTokenAmount(data.products[0].embeo!):'1'),[orderId,setOrderId]=useState(''),[caseData,setCaseData]=useState<unknown>(null);
 const utc=(n:number|null)=>n?new Date(n).toISOString().slice(0,16):'';
 const [starts,setStarts]=useState(utc(data.campaign.startsMs)),[ends,setEnds]=useState(utc(data.campaign.endsMs));
 // First version of a new service product (the price-version buttons below only publish the next version of an existing one).
 const [newProduct,setNewProduct]=useState(RESEARCH_PASS_PRODUCT),[newTitle,setNewTitle]=useState('每日通行證'),[newGold,setNewGold]=useState('100'),[newOn,setNewOn]=useState(false);
 const newExists=data.products.some(x=>x.product===newProduct);
 const p=data.products.find(p=>p.product===product),run=async(command:Record<string,unknown>)=>{if(busy)return;setBusy(true);setNotice('');try{await client.admin(command,reason);await refresh();setNotice(zh?'已完成並保留操作紀錄。':'Completed and recorded.');}catch(e){setNotice(message(e));}finally{setBusy(false);}};
 const load=async()=>{try{setCaseData(await client.request('/api/gold/admin?order_id='+encodeURIComponent(orderId)));}catch(e){setNotice(message(e));}};
 return <details className="gold-admin"><summary>{zh?'站主後台':'Administrator'}</summary><p>{zh?'沿用 World 錢包登入。改價與補帳都會保留原因、原單及操作紀錄。':'Uses World wallet sign-in. Pricing and repairs retain the original order and audit trail.'}</p>
 <label>{zh?'操作原因（必填）':'Reason (required)'}<input value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></label>
 <fieldset disabled={busy||reason.trim().length<3}><legend>{zh?'AIMarket 免費活動（UTC）':'AIMarket free trial (UTC)'}</legend><p>{data.campaign.active?(zh?'進行中':'Active'):zh?'未開放':'Inactive'}</p>
 <label>{zh?'開始時間 UTC':'Starts UTC'}<input type="datetime-local" value={starts} onChange={e=>setStarts(e.target.value)}/></label><label>{zh?'結束時間 UTC':'Ends UTC'}<input type="datetime-local" value={ends} onChange={e=>setEnds(e.target.value)}/></label>
 <button disabled={!starts||!ends} onClick={()=>void run({action:'campaign',version:data.campaign.version+1,startsMs:Date.parse(starts+'Z'),endsMs:Date.parse(ends+'Z'),stopped:false})}>{zh?'儲存／排程活動':'Save / schedule'}</button>
 <button disabled={!data.campaign.startsMs} onClick={()=>void run({action:'campaign',version:data.campaign.version+1,startsMs:data.campaign.startsMs,endsMs:data.campaign.endsMs,stopped:true})}>{zh?'立即結束活動':'End trial now'}</button></fieldset>
 <fieldset disabled={busy||reason.trim().length<3}><legend>{zh?'價格版本':'Price versions'}</legend><label>{zh?'方案':'Product'}<select value={product} onChange={e=>{setProduct(e.target.value);const next=data.products.find(p=>p.product===e.target.value);setGold(next?.gold??'1');setEmbeo(next?.embeo?economyTokenAmount(next.embeo):'1');}}>{data.products.map(p=><option key={p.id} value={p.product}>{p.title} · v{p.version}</option>)}</select></label>
 <label>GOLD<input inputMode="numeric" value={gold} onChange={e=>setGold(e.target.value)}/></label>{p?.kind==='topup'&&<label>EMBEO<input inputMode="numeric" value={embeo} onChange={e=>setEmbeo(e.target.value)}/></label>}
 <button disabled={!p||!/^[1-9][0-9]*$/.test(gold)||p.kind==='topup'&&goldPriceInputAtomic(embeo)===null} onClick={()=>p&&void run({action:'product',product:p.product,kind:p.kind,title:p.title,gold,...p.kind==='topup'?{embeo:goldPriceInputAtomic(embeo)!}:{},enabled:true,version:p.version+1})}>{zh?'發布新版價格（舊單保留原價）':'Save new price (existing quotes unchanged)'}</button>
 <button disabled={!p||p.kind!=='service'||!p.enabled} onClick={()=>p&&void run({action:'product',product:p.product,kind:p.kind,title:p.title,gold:p.gold,enabled:false,version:p.version+1})}>{zh?'停售此方案（發布停用版；已付款單照常交付）':'Stop selling (publish a disabled version; paid orders still deliver)'}</button></fieldset>
 <fieldset disabled={busy||reason.trim().length<3}><legend>{zh?'新增服務方案（第一版）':'New service product (version 1)'}</legend>
 <label>{zh?'方案代碼':'Product id'}<input value={newProduct} maxLength={64} onChange={e=>setNewProduct(e.target.value)}/></label><label>{zh?'名稱':'Title'}<input value={newTitle} maxLength={120} onChange={e=>setNewTitle(e.target.value)}/></label><label>GOLD<input inputMode="numeric" value={newGold} onChange={e=>setNewGold(e.target.value)}/></label>
 <label className="gold-purchase-ack"><input type="checkbox" checked={newOn} onChange={e=>setNewOn(e.target.checked)}/>{zh?'建立後立即開賣（預設停售，之後再用「發布新版價格」開賣）':'Sell immediately (off by default; publish a new price version later to open sales)'}</label>
 <button disabled={newExists||!/^[a-z][a-z0-9-]{0,63}$/.test(newProduct)||!newTitle.trim()||!/^[1-9][0-9]*$/.test(newGold)} onClick={()=>void run({action:'product',product:newProduct,kind:'service',title:newTitle.trim(),gold:newGold,enabled:newOn,version:1})}>{newExists?(zh?'此方案已存在':'Product already exists'):(zh?'建立第一版':'Create version 1')}</button></fieldset>
 <fieldset disabled={busy||reason.trim().length<3}><legend>{zh?'分功能暫停':'Feature controls'}</legend>{data.controls.map(c=><button key={c.feature} onClick={()=>void run({action:'control',feature:c.feature,enabled:!c.enabled,version:c.version})}>{c.feature} · {c.enabled?(zh?'暫停新單':'Pause new orders'):zh?'恢復新單':'Resume new orders'}</button>)}</fieldset>
 <fieldset disabled={busy}><legend>{zh?'異常查單與修復':'Order reconciliation'}</legend><label>{zh?'原始訂單 ID':'Original order ID'}<input value={orderId} onChange={e=>{setOrderId(e.target.value);setCaseData(null);}}/></label><button onClick={()=>void load()}>{zh?'查單':'Look up'}</button>{caseData!==null&&<pre>{JSON.stringify(caseData,null,2)}</pre>}
 <button disabled={!caseData||reason.trim().length<3} onClick={()=>void run({action:'repair-topup',orderId})}>{zh?'補足原購點差額':'Repair original topup'}</button><button disabled={!caseData||reason.trim().length<3} onClick={()=>void run({action:'refund-service',orderId})}>{zh?'依原單退回 GOLD':'Refund original GOLD'}</button></fieldset><p role="status">{notice}</p></details>;
}
export function WorldGoldPanel({state,language,onClose,onSignIn}:{state:AuthState;language:'zh'|'en';onClose:()=>void;onSignIn:()=>void}){
 const zh=language==='zh',{client,data,error,reading,identity,refresh,auth}=useGold(state),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[controller,setController]=useState<EconomyWalletController|null>(null),configRef=useRef<EconomyConfig|null>(null),[selected,setSelected]=useState<GoldOrder|null>(null),[passAck,setPassAck]=useState<string|null>(null),host=useRef<HTMLElement>(null),operation=useRef<symbol|null>(null);
 // A failed payment-settings read used to leave "continue to wallet" disabled with no explanation and no retry.
 const [configTry,setConfigTry]=useState(0),[configFailed,setConfigFailed]=useState(false),statusLine=useRef<HTMLParagraphElement>(null);
 // Provider initialization must not clear an in-flight quote lock. Only an
 // authenticated identity change invalidates the operation/request IDs.
 const currentIdentity=useRef(identity);currentIdentity.current=identity;const orderAttempts=useRef(new Map<string,string>());
 const wallet=useSyncExternalStore(controller?.subscribe??(()=>()=>{}),()=>controller?.state??EMPTY,()=>EMPTY);
 useEffect(()=>{setSelected(null);setNotice('');setBusy(false);operation.current=null;orderAttempts.current.clear();controller?.contextChanged();},[identity]);
 useEffect(()=>{setSelected(old=>{const next=old?data?.orders.find(o=>o.id===old.id)??old:null;if(next?.status==='paid'||next&&next.expires_ms<=Date.now())orderAttempts.current.delete(next.product);return next;});},[data]);
 useEffect(()=>{setController(null);configRef.current=null;setConfigFailed(false);if(!identity)return;let active=true,c:EconomyWalletController|undefined;const registry=wallets();void new EconomyClient({auth:()=>auth.current}).config().then(config=>{if(!active||!config.enabled)return;configRef.current=config;c=new EconomyWalletController({config,auth:()=>auth.current,provider:()=>registry.current(),onProviderChange:fn=>registry.subscribeProvider(fn),pending:localEconomyPending});c.restorePending();setController(c);}).catch(()=>{if(active)setConfigFailed(true);});return()=>{active=false;c?.dispose();};},[identity,configTry]);
 // The wallet's hash of this top-up's payment: the top bar shows the GOLD as being credited (pendingGoldCredit.ts) until
 // the ledger books it at finality, about 15 minutes later, also after this panel closes or the page reloads.
 // Only the payment's own hash (pendingGoldCredit.ts paymentHash); the order is read from this same book, not from
 // `selected`, which follows it one render later. A reverted or replaced payment's note goes at once.
 // After a reload the restored transaction has no plan; once its payment is confirmed (a pasted hash, say) the controller
 // names the order it paid (Swarm audit 1ac5269f, finding 6).
 const payingOrder=wallet.plan?.kind==='pay'?wallet.plan.payment.orderId:wallet.paidOrder??null,payingHash=paymentHash(wallet),failed=paymentFailed(wallet);
 // Once per payment and phase: this effect re-runs on every ledger refresh, and re-adding a note that aged out made a
 // fresh one, so the 2 h cap never ended it while the panel stayed open (Swarm audit 351b0573, finding 6). The phase is
 // in the key so a payment confirmed late (after its unmined note was dropped) still gets one note, ended by its own cap.
 const tracked=useRef(new Set<string>());
 useEffect(()=>{const o=payingOrder?data?.orders.find(o=>o.id===payingOrder):null;if(!data||!o||o.kind!=='topup'||!payingHash||o.status==='paid')return;
  const once=o.id+':'+payingHash.toLowerCase()+':'+wallet.phase;if(tracked.current.has(once))return;tracked.current.add(once);
  trackPendingCredit(data.wallet,o.id,payingHash,o.gold);},[payingOrder,payingHash,wallet.phase,data]);
 // By order while the plan is known, and by hash after a reload, where the restored transaction has no plan.
 // The note holds the hash the payment was sent with: wallet.sentHash, which differs from wallet.hash when the
 // receipt came through a pasted replacement hash.
 const sent=wallet.sentHash??wallet.hash;
 useEffect(()=>{if(!data||!failed)return;if(payingOrder)dropPendingCredit(data.wallet,payingOrder);if(sent)dropPendingCreditByHash(data.wallet,sent);},[data,payingOrder,failed,sent]);
 const mined=wallet.step==='execute'&&wallet.phase==='confirmed';
 // Both hashes: a note made after a pasted replacement was confirmed holds that hash (wallet.hash), not the sent one, and
 // left unmarked it was dropped at once by the after-expiry rule (Swarm audit 1ac5269f, finding 5).
 useEffect(()=>{if(!data||!mined)return;if(sent)markPendingCreditMined(data.wallet,sent);if(wallet.hash&&wallet.hash!==sent)markPendingCreditMined(data.wallet,wallet.hash);},[data,mined,sent,wallet.hash]);
 // Once booked, the top bar's balances refresh too (the event also makes this panel read once more).
 useEffect(()=>{if(data&&settlePendingCredits(data.wallet,data.orders))window.dispatchEvent(new Event('world:gold-changed'));},[data]);
 const pending=JSON.parse(useSyncExternalStore(subscribePendingCredit,()=>JSON.stringify(pendingCredit(data?.wallet,selected?.id)),()=>'null')) as PendingCredit|null;
 // Errors from ordering or signing are written to the status line at the end of the panel; bring it into view.
 useEffect(()=>{if(notice)statusLine.current?.scrollIntoView?.({block:'nearest'});},[notice]);
 const refreshAll=()=>{if(!controller)setConfigTry(n=>n+1);void refresh();};
 const lacks=(gold:unknown)=>{try{return !!data&&BigInt(data.available)<BigInt(String(gold));}catch{return false;}};
 useEffect(()=>{const prior=document.activeElement as HTMLElement|null;host.current?.querySelector<HTMLButtonElement>('.gold-return')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();/* like every other pane: the World's own Esc (ride boarding) must not run too */onClose();}if(e.key!=='Tab')return;const list=[...(host.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,a[href]')??[])].filter(e=>e.offsetWidth),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(prior?.isConnected)prior.focus();};},[onClose]);
 const run=async(fn:()=>Promise<unknown>)=>{if(operation.current||wallet.busy)return;const captured=identity,token=Symbol();operation.current=token;setBusy(true);setNotice('');try{await fn();if(currentIdentity.current===captured){await refresh();window.dispatchEvent(new Event('world:gold-changed'));}}catch(e){if(currentIdentity.current===captured)setNotice(message(e));}finally{if(operation.current===token){operation.current=null;if(currentIdentity.current===captured)setBusy(false);}}};
 const quote=async(product:string)=>{const captured=identity;let rid=orderAttempts.current.get(product);if(!rid){rid=economyRequestId();orderAttempts.current.set(product,rid);}try{const result=await client.quote(product,rid);const snap=await client.state();if(currentIdentity.current!==captured)throw new EconomyClientError('CONTEXT_CHANGED');const original=snap.orders.find(o=>o.id===result.orderId);if(!original)throw new EconomyClientError('INVALID_RESPONSE');setSelected(original);}catch(e){if(currentIdentity.current===captured&&e instanceof EconomyClientError&&e.code==='ORDER_EXPIRED'){orderAttempts.current.delete(product);setSelected(null);}throw e;}};
 const pay=async(o:GoldOrder)=>{if(o.product===RESEARCH_PASS_PRODUCT&&passAck!==o.id)throw new EconomyClientError('TERMS_REQUIRED');if((data as (GoldState&{localFixture?:boolean})|null)?.localFixture){await client.request('/api/local-gold/pay',{orderId:o.id});return;}if(!controller||!configRef.current||!state.session)throw new EconomyClientError('NOT_CONFIGURED');const config=configRef.current;
  const order:EconomyOrder={id:o.id,wallet:state.session.address.toLowerCase(),serviceId:o.product,currency:o.currency,amount:o.amount,status:o.status,createdMs:o.created_ms,expiresMs:o.expires_ms,paidMs:null};
  if(o.currency==='EMBEO')await controller.prepare({kind:'pay',payment:{chainId:config.chainId,contract:config.paymentContract,token:config.token,receiver:config.treasury,orderId:o.id,amount:o.amount},expiresMs:o.expires_ms,serviceTitle:o.product});
  else{const r=economyRequestId(),ch=await new EconomyClient({auth:()=>auth.current}).goldChallenge(order,r,location.origin);await controller.payGold(order,r,ch);await client.reconcile(o.id);}
 };
 return <section ref={host} role="dialog" aria-modal="true" aria-labelledby="world-gold-title" className="world-gold-panel"><header><h1 id="world-gold-title">GOLD · {zh?'購買與紀錄':'Buy & history'}</h1><button className="gold-return" onClick={onClose}>{zh?'返回世界':'Back to World'}</button></header>

 {!identity?<><p className="gold-test-note">{zh?'100 EMBEO → 1 GOLD，單向購點。GOLD 綁定錢包，不可轉讓、不可賣出，也不能兌回 EMBEO。':'100 EMBEO → 1 GOLD, one-way purchase. GOLD is wallet-bound and cannot be transferred, sold or redeemed for EMBEO.'}</p><button onClick={onSignIn}>{zh?'沿用 World 錢包登入':'Sign in with World wallet'}</button></>:<>
 {data?<><div className="gold-balance"><strong>{data.available} GOLD</strong><span>{zh?'帳面':'Book'} {data.book}</span><span>{zh?'保留':'Reserved'} {data.reserved}</span><small>{new Date(data.asOf).toISOString()}</small></div>
 {error&&<p role="status" className="gold-stale">{zh?`最新帳本暫時讀不到（代碼：${error}），以下是上次讀到的資料。`:`Could not refresh the ledger (code: ${error}); showing the last data read.`}</p>}
 {configFailed&&<p role="alert">{zh?'錢包付款設定讀取失敗，請按下方「更新餘額與狀態」重試。':'Payment settings could not be read. Press "Refresh ledger" below to retry.'}</p>}
 <GoldPurchase data={data} selected={selected} wallet={wallet} config={configRef.current} busy={busy} zh={zh} pending={pending} quote={product=>void run(()=>quote(product))} prepare={()=>selected&&void run(()=>pay(selected))} approve={()=>void run(()=>controller!.approve())} confirm={()=>void run(()=>controller!.confirm())} check={hash=>void run(()=>controller!.checkReceipt(hash))} clearUnknown={()=>void run(()=>controller!.clearUnknownAfterWalletCheck())} reconcile={()=>selected&&void run(()=>client.reconcile(selected.id))} clear={()=>setSelected(null)}/>
 <details className="gold-ledger-details"><summary>{zh?'帳本、訂單與其他館內服務':'Ledger, orders and hall services'}</summary>
 {data.deliveryReady!==true&&<p role="status">{zh?'館內付費服務尚未開放；購點不受此限制。':'Paid hall services are not available yet; this does not affect topups.'}</p>}<div className="gold-products">{data.products.filter(p=>p.enabled&&p.kind==='service').map(p=>p.product===RESEARCH_PASS_PRODUCT?<ResearchPassCard key={p.id} product={p} pass={data.researchPass} zh={zh} busy={busy||wallet.busy} insufficient={lacks(p.gold)} disabled={data.paymentsReady!==true||!data.controls.find(c=>c.feature==='service')?.enabled||data.deliveryReady!==true||lacks(p.gold)} onCreate={()=>void run(()=>quote(p.product))}/>:<article key={p.id}><h2>{p.title}</h2><p>{p.gold} GOLD</p><small>v{p.version}</small>{p.serviceable===false&&<p role="status">{zh?'此服務暫時無法提供，目前不接受新訂單。':'This service is temporarily unavailable; new orders are disabled.'}</p>}{fortuneProduct(p.product)?<a href="https://celestao.com/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{zh?'前往玄曜確認出生資料':'Review birth details in Celestial Atlas'}</a>:<button disabled={busy||wallet.busy||data.paymentsReady!==true||!data.controls.find(c=>c.feature==='service')?.enabled||data.deliveryReady!==true||p.serviceable===false} onClick={()=>void run(()=>quote(p.product))}>{zh?'建立訂單':'Create order'}</button>}</article>)}</div>
 {selected&&selected.kind==='service'&&selected.status==='pending'&&selected.product===RESEARCH_PASS_PRODUCT&&<ResearchPassConfirm order={selected} zh={zh} acknowledged={passAck===selected.id} busy={busy||wallet.busy} onAcknowledge={checked=>setPassAck(checked?selected.id:null)} onSign={()=>void run(()=>pay(selected))}/>}
 {selected&&selected.kind==='service'&&selected.status==='pending'&&selected.product!==RESEARCH_PASS_PRODUCT&&<section className="gold-confirm"><h2>{zh?'核對原始訂單':'Review original order'}</h2><code>{selected.id}</code><p>{selected.amount} GOLD · {zh?'此筆服務費用':'Service payment'}</p><button disabled={busy||wallet.busy} onClick={()=>void run(()=>pay(selected))}>{zh?'簽名確認扣點':'Sign GOLD payment'}</button></section>}
 {selected?.kind==='service'&&<div className="gold-actions">{['approve-required','reset-required'].includes(wallet.phase)&&<button disabled={wallet.busy} onClick={()=>void run(()=>controller!.approve())}>{zh?'確認指定額度授權':'Approve exact amount'}</button>}{wallet.phase==='confirm'&&<button disabled={wallet.busy} onClick={()=>void run(()=>controller!.confirm())}>{zh?'確認 EMBEO 付款':'Confirm EMBEO payment'}</button>}{wallet.hash&&<code>{wallet.hash}</code>}{['unknown','pending'].includes(wallet.phase)&&<button onClick={()=>void run(()=>controller!.checkReceipt())}>{zh?'查詢原交易':'Check original transaction'}</button>}</div>}
 <h2>{zh?'訂單與交付':'Orders & delivery'}</h2><ul className="gold-orders">{data.orders.map(o=><li key={o.id}><b>{o.product}</b> · {o.status} {o.delivery==='failed'?(zh?'待退點（尚未入帳）':'Refund pending (not credited)'):o.delivery==='refunded'?(zh?'已退點':'Refunded'):o.delivery??''}<code>{o.id}</code><button disabled={busy} onClick={()=>void run(async()=>{await client.reconcile(o.id);setSelected(o);})}>{zh?'核對原單':'Check original order'}</button>{o.result&&o.delivery==='delivered'&&<details><summary>{zh?'開啟原結果（不再扣點）':'Open saved result (no charge)'}</summary><pre>{o.result}</pre>{o.product==='research'&&<SavedResearchReport client={client} orderId={o.id} zh={zh}/>}</details>}</li>)}</ul>
 {(data.pendingRewards?.length??0)>0&&<section><h2>{zh?'待補發質押獎勵':'Pending staking rewards'}</h2><p>{zh?'以下權益尚未入帳，也未計入可用餘額；空間恢復後會依原始紀錄補發。最多顯示 100 筆。':'These entitlements are not credited or spendable. Original rewards retry when capacity is available. Up to 100 entries are shown.'}</p><ul>{data.pendingRewards!.map(r=><li key={r.id}>{new Date(r.dayStartMs).toISOString().slice(0,10)} UTC · {r.gold} GOLD</li>)}</ul></section>}
 <h2>{zh?'GOLD 紀錄（最近 100 筆）':'GOLD history (latest 100)'}</h2><ul className="gold-history">{data.history.map(h=><li key={h.id}><span>{h.kind}</span><b>{h.delta} GOLD</b><small>{new Date(h.created_ms).toISOString()}</small></li>)}</ul>
 </details>
 {data.isAdmin&&data.paymentsReady!==false&&<Admin client={client} data={data} refresh={refresh} zh={zh}/>}</>:<p role="status">{reading?(zh?'正在讀取帳本…':'Reading ledger…'):error?(zh?`帳本目前無法取得（代碼：${error}）；請按「更新餘額與狀態」重試，這不代表餘額為零。`:`Ledger unavailable (code: ${error}). Press "Refresh ledger" to retry; this does not mean a zero balance.`):(zh?'讀取帳本…':'Reading ledger…')}</p>}
 <button disabled={busy||reading} onClick={refreshAll}>{reading?(zh?'讀取中…':'Reading…'):zh?'更新餘額與狀態':'Refresh ledger'}</button></>}
 <p role="status" ref={statusLine}>{notice?goldPurchaseError(notice,zh):selected?.kind==='service'&&wallet.error?goldPurchaseError(wallet.error,zh):''}</p></section>;
}


function SavedResearchReport({client,orderId,zh}:{client:WorldGoldClient;orderId:string;zh:boolean}){
 const [document,setDocument]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
 const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const open=async()=>{if(busy)return;setBusy(true);setError(false);try{const result=await client.request('/api/gold/orders/'+orderId+'/report');if(active.current)setDocument(JSON.stringify(result.document,null,2));}catch{if(active.current)setError(true);}finally{if(active.current)setBusy(false);}};
 return <div><button disabled={busy} onClick={()=>void open()}>{zh?'查看完整原報告（不再扣點）':'Open original full report (no charge)'}</button>{error&&<p role="alert">{zh?'原報告暫時無法讀取，請稍後重試。':'The original report is unavailable. Please retry later.'}</p>}{document&&<pre>{document}</pre>}</div>;
}
