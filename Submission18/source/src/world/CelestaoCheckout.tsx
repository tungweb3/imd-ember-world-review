import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {createAuth,useAuth} from './WalletPanel.tsx';
import {wallets} from './wallet.ts';
import {noticeText} from './auth.ts';
import {EconomyClient,economyRequestId,economySession} from './economyClient.ts';
import {EconomyWalletController,localEconomyPending} from './economyWallet.ts';
import {CelestaoCheckoutClient,type CelestaoCheckoutState} from './celestaoCheckoutClient.ts';
import './celestaoGateway.css';
const ERRORS:Record<string,[string,string]>={AUTH_REQUIRED:['請重新登入 World 錢包。','Sign in to World again.'],ACCOUNT_MISMATCH:['這筆解讀屬於另一個錢包，請切換至原錢包。','Switch to the wallet that started this reading.'],NOT_FOUND:['這個錢包沒有這筆解讀，請回玄曜重新選擇。','This reading does not belong to this wallet. Return to Celestial Atlas.'],FEATURE_PAUSED:['館內付費服務尚未開放。','Paid hall services are not open.'],INSUFFICIENT_GOLD:['GOLD 餘額不足，請先返回 World 資產區購買點數。','Insufficient GOLD. Purchase points in World first.'],CONTEXT_CHANGED:['錢包狀態已改變，請重新確認原訂單。','Wallet context changed. Check the original order again.'],ORDER_EXPIRED:['這張未付款訂單已過期，請返回玄曜重新開始。','This unpaid quote expired. Return to Celestial Atlas to start again.']};
export default function CelestaoCheckout(){
 const query=new URLSearchParams(location.search),run=query.get('run')??'',zh=query.get('lang')!=='en',t=(a:string,b:string)=>zh?a:b;
 const valid=/^[A-Za-z0-9_-]{43}$/.test(run);
 const registry=wallets(),options=useSyncExternalStore(registry.subscribe,()=>registry.state,()=>registry.state);
 const authClient=useMemo(()=>createAuth(registry),[registry]),auth=useAuth(authClient,false),authRef=useRef(auth);authRef.current=auth;
 const client=useMemo(()=>new CelestaoCheckoutClient({auth:()=>authRef.current}),[]);
 const session=economySession(auth),identity=session?session.address+':'+session.expiresAt:'',generation=useRef(0),lock=useRef(false);
 const [data,setData]=useState<CelestaoCheckoutState|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[controller,setController]=useState<EconomyWalletController|null>(null);
 const refresh=useCallback(async()=>{if(!valid||!economySession(authRef.current))return;const g=generation.current;try{const next=await client.state(run);if(g===generation.current)setData(next);}catch(e){if(g===generation.current){setData(null);setError(e instanceof Error?e.message:'UNAVAILABLE');}}},[client,run,valid]);
 useEffect(()=>{generation.current++;lock.current=false;setBusy(false);setData(null);setError('');void refresh();let active=true,c:EconomyWalletController|undefined;
  if(identity)void new EconomyClient({auth:()=>authRef.current}).config().then(config=>{if(!active||!config.enabled)return;c=new EconomyWalletController({config,auth:()=>authRef.current,provider:()=>registry.current(),onProviderChange:fn=>registry.subscribeProvider(fn),pending:localEconomyPending});setController(c);}).catch(()=>{});
  return()=>{active=false;generation.current++;c?.dispose();setController(null);};
 },[identity,refresh,registry]);
 useEffect(()=>{if(!identity)return;const onFocus=()=>void refresh(),timer=setInterval(onFocus,data?.order?.status==='paid'?5000:15000);window.addEventListener('focus',onFocus);return()=>{clearInterval(timer);window.removeEventListener('focus',onFocus);};},[identity,refresh,data?.order?.status]);
 const operate=async(pay=false)=>{if(lock.current||!valid)return;lock.current=true;setBusy(true);setError('');const g=generation.current;
  try{const latest=await client.state(run);if(g!==generation.current)throw Error('CONTEXT_CHANGED');
   if(pay){if(!controller||!latest.order||latest.order.status!=='pending')throw Error('CONTEXT_CHANGED');const rid=economyRequestId(),challenge=await new EconomyClient({auth:()=>authRef.current}).goldChallenge(latest.order,rid,location.origin);await controller.payGold(latest.order,rid,challenge);if(controller.state.error)throw Error(controller.state.error);}
   else await client.quote(run);
  }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'UNAVAILABLE');}
  finally{if(g===generation.current){lock.current=false;setBusy(false);void refresh();}}
 };
 const returnUrl='https://celestao.com/?world_run='+encodeURIComponent(run)+'#/saved';
 return <main className="celestao-gateway-page"><section className="celestao-gateway" aria-labelledby="celestao-checkout-title"><p className="celestao-gateway-brand">IMD Ember World × {t('玄曜','Celestial Atlas')}</p><h1 id="celestao-checkout-title">{t('確認這次解讀','Review this reading')}</h1>
  <p className="celestao-gateway-note">{t('GOLD 綁定此錢包，無法轉讓、賣出或兌回。這次簽名只授權下方單筆 GOLD 費用。','GOLD is wallet-bound and cannot be transferred, sold or redeemed. Your signature authorizes only this GOLD payment.')}</p>
  {!valid?<p role="alert">{t('解讀連結無效，請返回玄曜。','Invalid reading link. Return to Celestial Atlas.')}</p>:<>
   {!identity&&<>{options.options.length>1&&<fieldset><legend>{t('選擇錢包','Choose a wallet')}</legend>{options.options.map((o,i)=><button type="button" key={i} aria-pressed={options.chosen===o} onClick={()=>registry.choose(o)}>{o.info.name}</button>)}</fieldset>}<button className="celestao-gateway-primary" disabled={!auth.sessionKnown||auth.phase!=='idle'||options.needsChoice} onClick={()=>void authClient.signIn()}>{t('登入原本的 World 錢包','Sign in to the original World wallet')}</button></>}
   {auth.notice&&<p role="status">{noticeText(auth.notice,t)}</p>}
   {data&&<><p className="celestao-gateway-address">{data.wallet}</p><h2>{zh?data.product.nameZh:data.product.nameEn}</h2>{data.product.listGold!==data.product.gold&&<p>{t('四項合計','Four systems combined')} <s>3,400 GOLD／{t('次','reading')}</s></p>}<p className="celestao-checkout-price">{data.product.listGold!==data.product.gold?t('特價','Special price')+' ':''}{Number(data.product.gold).toLocaleString('en-US')} GOLD／{t('次','reading')}</p>
    {data.order?<><p className="celestao-gateway-note">{t('原始訂單','Original order')}<br/><code>{data.order.id}</code></p>{data.order.status==='paid'?<p role="status">{data.order.delivery==='delivered'?t('報告已保存到錢包收藏。','Your report is saved to your wallet collection.'):['failed','refunded'].includes(data.order.delivery??'')?t('此筆解讀未完成，請至 World 的「購買 GOLD／查看紀錄」確認退款。','This reading did not complete. Check the original refund in the World ledger.'):t('已付款，正在產生報告；請保留原單，不需再次付款。','Paid. Your report is being prepared; keep this original order and do not pay again.')}</p>:<button className="celestao-gateway-primary" disabled={busy||!controller||!data.ready||data.order.expiresMs<=Date.now()} onClick={()=>void operate(true)}>{busy?t('正在確認原單…','Checking original order…'):t('簽名確認支付 ','Sign payment of ')+data.product.gold+' GOLD'}</button>}</>:<button className="celestao-gateway-primary" disabled={busy||!data.ready||data.expiresMs<=Date.now()} onClick={()=>void operate()}>{t('建立此筆 GOLD 訂單','Create this GOLD order')}</button>}
    <p className="celestao-gateway-note">{t('已收藏報告的重看及 PDF 匯出不另扣 GOLD。','Reopening saved reports and PDF export cost no additional GOLD.')}</p></>}
   {error&&<p role="alert">{ERRORS[error]?.[zh?0:1]??t('暫時無法確認，請稍後查詢原訂單。','Unable to confirm. Check the original order again shortly.')} <small>({error})</small></p>}
   {identity&&<button type="button" disabled={busy} onClick={()=>void refresh()}>{t('查詢原訂單','Check original order')}</button>}
  </>}
  <a className="celestao-gateway-back" href={valid?returnUrl:'https://celestao.com/'} referrerPolicy="no-referrer">{t('返回玄曜與我的收藏','Return to Celestial Atlas and my collection')}</a>
 </section></main>;
}
