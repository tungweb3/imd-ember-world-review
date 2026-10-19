import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react';
import type {AuthState} from './auth.ts';
import {noticeText,statusOf} from './auth.ts';
import {wallets} from './wallet.ts';
import {aimarketPortalFrame,openAIMarketAccess,canContinueToAIMarket,RESEARCH_ORIGIN} from './aimarketEntry.ts';
import {researchMessage,researchSessionChanged} from './aimarketMessages.ts';
import {researchPresentationOrigin} from './portalPresentation.ts';
import {fetchAIMarketAdminStatus,type AIMarketAdminStatus} from './aimarketAdmin.ts';
import {fetchAIMarketTrialStatus,type AIMarketTrial} from './aimarketTrial.ts';
import './aimarketPane.css';

export type AIMarketPaneProps={state:AuthState;onSignIn:()=>void;language:'zh'|'en';onLanguage?:(language:'zh'|'en')=>void;onClose?:()=>void};
export function AIMarketPane({state,onSignIn,language,onLanguage,onClose}:AIMarketPaneProps){
 const zh=language==='zh',say=(a:string,b:string)=>zh?a:b;
 const researchOrigin=researchPresentationOrigin(location);
 const registry=wallets(),options=useSyncExternalStore(registry.subscribe,()=>registry.state,()=>registry.state);
 const host=useRef<HTMLElement>(null),frame=useRef<HTMLIFrameElement>(null);
 const [clock,setClock]=useState(Date.now),[loaded,setLoaded]=useState(false),[slow,setSlow]=useState(false),[revision,setRevision]=useState(0),[popupNotice,setPopupNotice]=useState<'blocked'|'activation-required'|null>(null),[access,setAccess]=useState<boolean|null>(null);
 const authenticated=canContinueToAIMarket(state,clock),busy=state.phase!=='idle'||state.waiting||state.leaving;
 const sessionIdentity=authenticated?`${state.session!.address.toLowerCase()}:${state.session!.expiresAt}`:null,previousIdentity=useRef<string|null>(null);
 const [admin,setAdmin]=useState<(AIMarketAdminStatus&{identity:string})|null>(null);
 const [trial,setTrial]=useState<(AIMarketTrial&{identity:string})|null>(null);
 const inTrial=authenticated&&trial?.identity===sessionIdentity&&trial.active&&trial.endsMs!==null&&trial.endsMs>clock;
 const isAdmin=authenticated&&admin?.identity===sessionIdentity&&admin.expiresAt>clock;
 const reload=useCallback(()=>{setLoaded(false);setSlow(false);setAccess(null);setRevision(n=>n+1);},[]);
 const context=useCallback(()=>frame.current?.contentWindow?.postMessage({type:'ember-world:session-context',version:1,language,address:authenticated?state.session!.address:null,authenticated},researchOrigin),[authenticated,state.session?.address,language,researchOrigin]);
 const openAccess=useCallback(()=>{
  const result=openAIMarketAccess(state,Date.now(),language,navigator.userActivation?.isActive===true,(url,name,features)=>window.open(url.replace(RESEARCH_ORIGIN,researchOrigin),name,features));
  setPopupNotice(result==='blocked'||result==='activation-required'?result:null);
  if(result!=='opened')host.current?.querySelector<HTMLElement>('.aimarket-primary')?.focus();
 },[state,language,researchOrigin]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),5000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{
  setAdmin(null);if(!sessionIdentity||!state.session)return;
  const controller=new AbortController(),identity=sessionIdentity;let active=true;
  void fetchAIMarketAdminStatus(state.session,{signal:controller.signal}).then(result=>{
   if(active&&!controller.signal.aborted)setAdmin(result?{...result,identity}:null);
  });
  return()=>{active=false;controller.abort();};
 },[sessionIdentity]);
 useEffect(()=>{setTrial(null);if(!sessionIdentity||!state.session)return;const identity=sessionIdentity,session=state.session,abort=new AbortController();let active=true;
  const read=()=>void fetchAIMarketTrialStatus(session,{signal:abort.signal}).then(value=>{if(active&&!abort.signal.aborted)setTrial(value?{...value,identity}:null);});read();const timer=setInterval(read,5000);
  return()=>{active=false;abort.abort();clearInterval(timer);};
 },[sessionIdentity]);
 useEffect(()=>{
  if(researchSessionChanged(previousIdentity.current,sessionIdentity))frame.current?.contentWindow?.postMessage({type:'ember-world:session-changed',version:1},researchOrigin);
  previousIdentity.current=sessionIdentity;context();setAccess(null);
 },[context,sessionIdentity,researchOrigin]);
 useEffect(()=>{const receive=(event:MessageEvent)=>{
  const message=researchMessage(event.data,event.origin,researchOrigin,event.source,frame.current?.contentWindow);if(!message)return;
  if(message.type==='ember-aimarket:ready'){setLoaded(true);setSlow(false);context();}
  else if(message.type==='ember-aimarket:access')setAccess(authenticated?message.eligible:false);
  else if(message.type==='ember-aimarket:login-required')setAccess(false);
  else if(message.type==='ember-aimarket:request-access')openAccess();
  else onClose?.();
 };window.addEventListener('message',receive);return()=>window.removeEventListener('message',receive);},[authenticated,context,onClose,openAccess,researchOrigin]);
 useEffect(()=>{if(loaded)return;const timer=setTimeout(()=>setSlow(true),15000);return()=>clearTimeout(timer);},[loaded,revision]);
 useEffect(()=>{if(!onClose)return;const prior=document.activeElement as HTMLElement|null;host.current?.querySelector<HTMLElement>('.aimarket-return')?.focus();
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();return;}if(event.key!=='Tab')return;
   const list=[...(host.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],iframe')??[])].filter(el=>el.offsetWidth&&el.offsetHeight);const first=list[0],last=list.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  };document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);if(prior?.isConnected)prior.focus();};
 },[onClose]);
 return <section ref={host} className={'aimarket-pane'+(onClose?' aimarket-pane-modal':'')} role={onClose?'dialog':undefined} aria-modal={onClose?true:undefined} aria-labelledby="aimarket-pane-title">
  <header className="aimarket-pane-header"><div className="aimarket-pane-brand"><span>Ember World</span><h1 id="aimarket-pane-title">{say('AIMarket 觀研館','AIMarket research hall')}</h1></div>
   <div className="aimarket-pane-actions">{onLanguage&&<button onClick={()=>onLanguage(zh?'en':'zh')}>{zh?'EN':'中文'}</button>}{onClose?<button className="aimarket-return" onClick={onClose}>{say('返回世界','Back to World')}</button>:<a className="aimarket-return" href={'/?lang='+language}>{say('返回世界','Back to World')}</a>}</div>
  </header>
  <div className="aimarket-pane-access" aria-live="polite"><div><p>{authenticated?say('沿用 World 錢包登入','Using your World wallet login'):statusOf(state,clock)==='mismatch'?say('錢包已切換，請以目前錢包登入 World。','Your wallet changed. Sign in to World with the current wallet.'):say('先看研究摘要，在 World 登入後確認研究資格。','Browse the summaries, then sign in to World to check research access.')}</p>
   <small>{inTrial?say('免費研究體驗進行中；結束時間 UTC：','Free research trial active; ends UTC: ')+new Date(trial!.endsMs!).toISOString():access===true?say('研究資格已確認。','Research access confirmed.'):say('完整研究需至少 100 萬枚 EMBEO（含）；這裡不會要求付款。','Full research requires at least 1,000,000 EMBEO. No payment is requested here.')}</small></div>
   {authenticated?(access===true?<span className="aimarket-unlocked">{say('已解鎖研究','Research unlocked')}</span>:<button className="aimarket-primary" onClick={openAccess}>{say('確認研究資格','Check research access')}</button>):<div className="aimarket-pane-signin">{options.needsChoice&&<div className="aimarket-wallets">{options.options.map((option,index)=><button key={index} disabled={busy} onClick={()=>registry.choose(option)}>{option.info.name}</button>)}</div>}<button className="aimarket-primary" disabled={busy||options.needsChoice||!state.sessionKnown} onClick={onSignIn}>{busy?say('登入中…','Signing in…'):say('登入 World 錢包','Sign in to World')}</button></div>}
   {state.notice&&<p role="status">{noticeText(state.notice,say)}</p>}{popupNotice&&<p role="status">{popupNotice==='activation-required'?say('請點上方「確認研究資格」繼續。','Select “Check research access” above to continue.'):say('登入視窗沒有開啟，請允許此網站的彈出視窗後再按一次。','The sign-in window did not open. Allow popups for this site, then try again.')}</p>}
   {isAdmin&&<button onClick={()=>window.dispatchEvent(new Event('world:gold-open'))}>{say('站主後台：免費活動起訖','Admin: free-trial schedule')}</button>}
  </div>
  {slow&&<div className="aimarket-pane-slow" role="status"><span>{say('觀研館暫時無法載入，可以重新載入研究頁或返回世界。','The research hall could not load. Reload research or return to the World.')}</span><button onClick={reload}>{say('重讀研究頁','Reload research')}</button></div>}
  <iframe key={revision} ref={frame} className="aimarket-research-frame" title={say('AIMarket 研究內容','AIMarket research')} src={aimarketPortalFrame(language).replace(RESEARCH_ORIGIN,researchOrigin)} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" onLoad={context}/>
 </section>;
}
