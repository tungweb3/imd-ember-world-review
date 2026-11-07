import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createAuth,useAuth} from './WalletPanel.tsx';
import {wallets} from './wallet.ts';
import {noticeText} from './auth.ts';
import {EconomyClient,economyRequestId,economySession} from './economyClient.ts';
import {EconomyWalletController,localEconomyPending} from './economyWallet.ts';
import {SqueekCheckoutClient,squeekEconomyOrder,type SqueekCheckoutState} from './squeekCheckoutClient.ts';
import {squeekCheckoutParams,squeekReturnUrl} from './squeekEntry.ts';
import './celestaoGateway.css';
const ERRORS:Record<string,[string,string]>={
 AUTH_REQUIRED:['請重新登入 World 錢包。','Sign in to World again.'],
 ACCOUNT_MISMATCH:['錢包已切換，請用原本的錢包確認。','The wallet changed. Confirm with the original wallet.'],
 ALREADY_OWNED:['你已經擁有這件外觀，不需要再買，也不會再扣 GOLD。','You already own this cosmetic. It cannot be bought again and no GOLD is taken.'],
 SALES_CLOSED:['鼠道修仙的外觀目前還沒開賣。','Squeek Ascension cosmetics are not on sale yet.'],
 FEATURE_PAUSED:['館內付費服務暫停中。','Paid services are paused.'],
 INSUFFICIENT_GOLD:['GOLD 不足。不買也能完整遊玩；想取得 GOLD 請看下方「什麼是 GOLD」。','Not enough GOLD. The game is fully playable without buying; see "What is GOLD" below.'],
 CONTEXT_CHANGED:['錢包狀態已改變，請重新確認原訂單。','Wallet context changed. Check the original order again.'],
 ORDER_EXPIRED:['這張未付款訂單已過期，沒有扣 GOLD。請回到遊戲重新購買。','This unpaid order expired and no GOLD was taken. Return to the game to buy again.'],
 IDEMPOTENCY_CONFLICT:['這個購買連結對應另一件外觀，請回到遊戲重新購買。','This purchase link belongs to another cosmetic. Return to the game and buy again.'],
 EOA_REQUIRED:['這個錢包類型不能用 GOLD 付款，請改用一般錢包登入。','This wallet type cannot pay with GOLD. Sign in with a standard wallet.']
};
export default function SqueekCheckout(){
 const {sku,requestKey,zh,valid}=squeekCheckoutParams(location.search),t=(a:string,b:string)=>zh?a:b;
 const registry=wallets(),options=useSyncExternalStore(registry.subscribe,()=>registry.state,()=>registry.state);
 const authClient=useMemo(()=>createAuth(registry),[registry]),auth=useAuth(authClient,false),authRef=useRef(auth);authRef.current=auth;
 const client=useMemo(()=>new SqueekCheckoutClient({auth:()=>authRef.current}),[]);
 const session=economySession(auth),identity=session?session.address+':'+session.expiresAt:'',generation=useRef(0),lock=useRef(false);
 const [data,setData]=useState<SqueekCheckoutState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[controller,setController]=useState<EconomyWalletController|null>(null);
 const refresh=useCallback(async()=>{if(!valid||!economySession(authRef.current))return;const g=generation.current;try{const next=await client.state(sku,requestKey);if(g===generation.current)setData(next);}catch(e){if(g===generation.current){setData(null);setError(e instanceof Error?e.message:'UNAVAILABLE');}}},[client,sku,requestKey,valid]);
 useEffect(()=>{generation.current++;lock.current=false;setBusy(false);setData(null);setError('');void refresh();let active=true,c:EconomyWalletController|undefined;
  if(identity)void new EconomyClient({auth:()=>authRef.current}).config().then(config=>{if(!active||!config.enabled)return;c=new EconomyWalletController({config,auth:()=>authRef.current,provider:()=>registry.current(),onProviderChange:fn=>registry.subscribeProvider(fn),pending:localEconomyPending});setController(c);}).catch(()=>{});
  return()=>{active=false;generation.current++;c?.dispose();setController(null);};
 },[identity,refresh,registry]);
 useEffect(()=>{if(!identity)return;const onFocus=()=>void refresh(),timer=setInterval(onFocus,15000);window.addEventListener('focus',onFocus);return()=>{clearInterval(timer);window.removeEventListener('focus',onFocus);};},[identity,refresh]);
 const operate=async(pay=false)=>{if(lock.current||!valid)return;lock.current=true;setBusy(true);setError('');const g=generation.current;
  try{const latest=await client.state(sku,requestKey);if(g!==generation.current)throw Error('CONTEXT_CHANGED');
   if(pay){if(!controller||!latest.order||latest.order.status!=='pending')throw Error('CONTEXT_CHANGED');const order=squeekEconomyOrder(latest.order,latest.item),rid=economyRequestId(),challenge=await new EconomyClient({auth:()=>authRef.current}).goldChallenge(order,rid,location.origin);await controller.payGold(order,rid,challenge);if(controller.state.error)throw Error(controller.state.error);}
   else await client.quote(sku,requestKey);
  }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'UNAVAILABLE');}
  finally{if(g===generation.current){lock.current=false;setBusy(false);void refresh();}}
 };
 const order=data?.order,name=data?(zh?data.item.nameZh:data.item.nameEn):'';
 const status=order?.status==='paid'?t('已付款，外觀已加到你的帳號。回到遊戲就能看到。','Paid. The cosmetic is on your account; return to the game to see it.')
  :order?.status==='refund_pending'?t('這筆沒有完成，系統正在退回 GOLD，外觀不會保留。','This purchase did not complete. The GOLD is being returned and the cosmetic is not kept.')
  :order?.status==='refunded'?t('這筆已退回 GOLD，外觀不保留。','This purchase was refunded; the cosmetic is not kept.')
  :order?.status==='expired'?ERRORS.ORDER_EXPIRED[zh?0:1]:'';
 return <main className="celestao-gateway-page"><section className="celestao-gateway" aria-labelledby="squeek-checkout-title"><p className="celestao-gateway-brand">IMD Ember World × {t('鼠道修仙','Squeek Ascension')}</p><h1 id="squeek-checkout-title">{t('確認購買外觀','Review this cosmetic')}</h1>
  <p className="celestao-gateway-note">{t('外觀只改變畫面，不會變強、不會多拿資源或加快進度。GOLD 綁定此錢包，無法轉讓、賣出或兌回。這次簽名只授權下方單筆 GOLD 費用，沒有手續費。','A cosmetic only changes how things look: no power, resources or speed. GOLD is wallet-bound and cannot be transferred, sold or redeemed. Your signature authorizes only this one GOLD payment; there is no fee.')}</p>
  {!valid?<p role="alert">{t('購買連結無效，請返回鼠道修仙。','Invalid purchase link. Return to Squeek Ascension.')}</p>:<>
   {!identity&&<>{options.options.length>1&&<fieldset><legend>{t('選擇錢包','Choose a wallet')}</legend>{options.options.map((o,i)=><button type="button" key={i} aria-pressed={options.chosen===o} onClick={()=>registry.choose(o)}>{o.info.name}</button>)}</fieldset>}<button className="celestao-gateway-primary" disabled={!auth.sessionKnown||auth.phase!=='idle'||options.needsChoice} onClick={()=>void authClient.signIn()}>{t('登入 World 錢包','Sign in to your World wallet')}</button></>}
   {auth.notice&&<p role="status">{noticeText(auth.notice,t)}</p>}
   {data&&<><p className="celestao-gateway-address">{data.wallet}</p><h2>{name}</h2>
    <p className="celestao-checkout-price">{Number(data.item.gold).toLocaleString('en-US')} GOLD　<small>{t('一次付款，不能重複購買','One-time payment; cannot be bought twice')}</small></p>
    <p className="celestao-gateway-note">{t('目前可用 GOLD：','Available GOLD: ')}{Number(data.balanceGold).toLocaleString('en-US')}</p>
    {order?<><p className="celestao-gateway-note">{t('原始訂單','Original order')}<br/><code>{order.orderId}</code></p>
     {status?<p role="status">{status}</p>:order.expiresAt<=Date.now()?<p role="alert">{ERRORS.ORDER_EXPIRED[zh?0:1]}</p>:<button className="celestao-gateway-primary" disabled={busy||!controller||!data.ready} onClick={()=>void operate(true)}>{busy?t('正在確認原單…','Checking original order…'):t('簽名確認支付 ','Sign payment of ')+data.item.gold+' GOLD'}</button>}</>
    :data.owned?<p role="status">{ERRORS.ALREADY_OWNED[zh?0:1]}</p>
    :!data.ready?<p role="status">{ERRORS.SALES_CLOSED[zh?0:1]}</p>
    :<button className="celestao-gateway-primary" disabled={busy} onClick={()=>void operate()}>{t('建立這筆 GOLD 訂單','Create this GOLD order')}</button>}</>}
   {error&&<p role="alert">{ERRORS[error]?.[zh?0:1]??t('暫時無法確認，請稍後查詢原訂單。','Unable to confirm. Check the original order again shortly.')} <small>({error})</small></p>}
   {identity&&<button type="button" disabled={busy} onClick={()=>void refresh()}>{t('查詢原訂單','Check original order')}</button>}
  </>}
  <p className="celestao-gateway-note"><a href={'/gold/?lang='+(zh?'zh':'en')}>{t('什麼是 GOLD？怎麼取得？','What is GOLD, and how do I get it?')}</a></p>
  <a className="celestao-gateway-back" href={squeekReturnUrl(valid?requestKey:null)} referrerPolicy="no-referrer">{t('返回鼠道修仙','Return to Squeek Ascension')}</a>
 </section></main>;
}
