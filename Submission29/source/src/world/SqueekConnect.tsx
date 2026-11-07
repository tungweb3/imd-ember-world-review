import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {createAuth,useAuth} from './WalletPanel.tsx';
import {noticeText} from './auth.ts';
import {wallets} from './wallet.ts';
import {squeekResume,canContinueToSqueek} from './squeekEntry.ts';
import {SQUEEK_REDIRECT} from '../shared/squeekCatalog.ts';
import './celestaoGateway.css';

/** Identity only: this page never creates an order or calls a payment signer.
 * The authorize endpoint rechecks the real World session cookie. */
export default function SqueekConnect(){
 const zh=new URLSearchParams(location.search).get('lang')!=='en',say=(a:string,b:string)=>zh?a:b;
 const next=squeekResume(new URLSearchParams(location.search).get('next'));
 const registry=wallets(),options=useSyncExternalStore(registry.subscribe,()=>registry.state,()=>registry.state);
 const client=useMemo(()=>createAuth(registry),[registry]),state=useAuth(client,false),[now,setNow]=useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const ready=!!next&&canContinueToSqueek(state,now),busy=state.phase!=='idle'||state.leaving||state.waiting;
 return <main className="celestao-gateway-page"><section className="celestao-gateway" aria-labelledby="squeek-connect-title">
  <p className="celestao-gateway-brand">IMD Ember World × {say('鼠道修仙','Squeek Ascension')}</p>
  <h1 id="squeek-connect-title">{say('用 World 錢包登入','Sign in with your World wallet')}</h1>
  <p>{say('登入後，鼠道修仙可以看到你的 GOLD 餘額和已擁有的外觀。','After sign-in, Squeek Ascension can see your GOLD balance and the cosmetics you own.')}</p>
  <p className="celestao-gateway-note">{say('這一步只確認身分，不會支付 GOLD 或轉移資產。每次購買都要你在 World 另外簽名確認。不登入也能完整遊玩。','This step only confirms who you are. It does not pay GOLD or move assets. Each purchase needs its own signature in World. The game is fully playable without signing in.')}</p>
  {!next?<p role="alert">{say('登入連結已失效，請返回鼠道修仙重新開始。','This sign-in link is invalid. Return to Squeek Ascension and start again.')}</p>:<>
   {(options.options.length>1||options.needsChoice)&&<fieldset disabled={busy}><legend>{say('選擇錢包','Choose a wallet')}</legend>{options.options.map((o,i)=><button key={i} type="button" aria-pressed={options.chosen===o} onClick={()=>registry.choose(o)}>{o.info.name} ({o.info.rdns})</button>)}{options.duplicates.length>0&&<p>{say('有擴充套件使用相同名稱，請確認你選擇的錢包。','Some extensions use the same name. Check which wallet you select.')}</p>}</fieldset>}
   {state.session&&<p className="celestao-gateway-address">{state.session.address}</p>}
   {state.notice&&<p role="status">{noticeText(state.notice,say)}</p>}
   {ready?<a className="celestao-gateway-primary" href={next} referrerPolicy="no-referrer" onClick={e=>{if(!canContinueToSqueek(client.state,Date.now())||squeekResume(next)===null)e.preventDefault();}}>{say('以此錢包繼續','Continue with this wallet')}</a>:<button className="celestao-gateway-primary" type="button" disabled={busy||!state.sessionKnown||options.needsChoice} onClick={()=>void client.signIn()}>{busy?say('正在確認錢包…','Checking wallet…'):!state.sessionKnown?say('正在確認登入狀態…','Checking session…'):say('連接並登入 World 錢包','Connect and sign in to World')}</button>}
  </>}
  <p className="celestao-gateway-note"><a href={'/gold/?lang='+(zh?'zh':'en')}>{say('什麼是 GOLD？','What is GOLD?')}</a></p>
  <a className="celestao-gateway-back" href={SQUEEK_REDIRECT} rel="noreferrer" referrerPolicy="no-referrer">{say('返回鼠道修仙','Return to Squeek Ascension')}</a>
 </section></main>;
}
