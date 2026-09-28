import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import type {Agent} from './model.ts';
import type {Home} from './households.ts';
import {useWorldText} from './i18n.tsx';
import {HouseholdBlock,SIZE_NAMES,shortAddr} from './HomePanels.tsx';
import {CHARACTER_COLLECTIONS} from './collections.ts';
import {AuthClient,statusOf,statusText,chipText,noticeText,watchOwner,type AuthState,type AuthStatus} from './auth.ts';
import {wallets,unidentifiedNote,type WalletRegistry} from './wallet.ts';
import {browserEnv} from './cadence.ts';
import {moveGate,moveHint} from './moves.ts';
import {seatRows,countsText,eligibleText,type SeatRow} from './walletView.ts';
// "My wallet" (W1, DESIGN_W1 §9): the chip in the tools bar and the drawer body. Sign-in state comes from AuthClient
// (auth.ts); the assets list is public data (GET /api/wallet/:address/assets: IMD's roster) and needs no signature. The
// drawer is modal, so nothing here overlaps the onboarding HUD, the speaker toggle, the world-time card or the minimap.

/** One client per page: same-origin fetches, the chosen wallet (EIP-6963 registry, wallet.ts), and the tabs' channel. */
export function createAuth(registry:WalletRegistry){
  return new AuthClient({fetch:(p,i)=>fetch(p,i),provider:()=>registry.current(),onProviderChange:fn=>registry.subscribe(fn),
    channel:()=>typeof BroadcastChannel==='function'?new BroadcastChannel('imd-ember-auth'):null});
}
/** Several wallets announced (EIP-6963), or the remembered one is missing: pick the one this page uses (remembered in
 *  this browser). Icons are data: images checked by wallet.ts; names are text; an rdns that more than one provider claims
 *  is flagged, since any extension can announce any name. Disabled while a sign-in waits on a wallet. */
function WalletChooser({registry,disabled}:{registry:WalletRegistry;disabled:boolean}){
  const {text}=useWorldText(),w=useSyncExternalStore(registry.subscribe,()=>registry.state);
  if(w.options.length<2&&!w.needsChoice)return null;
  return <section className="wallet-choose" aria-label={text('選擇錢包','Choose a wallet')}>
    <p className="small-note">{w.needsChoice?text('請選擇要使用的錢包：','Choose the wallet to use:'):text('使用中的錢包','Wallet in use')}</p>
    {w.duplicates.length>0&&<p className="small-note warn">{text('有兩個以上的擴充套件自稱同一個錢包，其中可能有冒牌貨：請只選你確定的那一個。','More than one extension claims the same wallet id; one may be an impostor. Only pick the one you trust.')}</p>}
    <ul>{w.options.map((o,i)=><li key={i}><button className={o===w.chosen?'chosen':''} aria-pressed={o===w.chosen} disabled={disabled} onClick={()=>registry.choose(o)}>
      {o.info.icon?<img src={o.info.icon} alt="" width={24} height={24}/>:<span className="seat-glyph" aria-hidden="true">◆</span>}
      <span><b>{o.info.name}</b><small>{o.info.rdns}{w.duplicates.includes(o.info.rdns)?text(' · 重複',' · duplicate'):''}</small></span></button></li>)}</ul>
  </section>;
}
/** The client's state, started once; re-checks the house on panel open, on window focus and every 60 s in owner mode
 *  while the tab is visible (watchOwner: a hidden tab asks nothing and re-checks once when shown again). */
export function useAuth(client:AuthClient,panelOpen:boolean):AuthState{
  const state=useSyncExternalStore(client.subscribe,()=>client.state);
  useEffect(()=>client.start(),[client]);
  const owner=statusOf(state)==='owner',signedIn=!!state.session;
  useEffect(()=>{if(panelOpen&&signedIn)void client.refreshHome();},[client,panelOpen,signedIn]);
  useEffect(()=>{if(!signedIn)return;const f=()=>void client.refreshHome();window.addEventListener('focus',f);return()=>window.removeEventListener('focus',f);},[client,signedIn]);
  useEffect(()=>owner?watchOwner(client,browserEnv()):undefined,[client,owner]);
  return state;
}
const DOT:Record<AuthStatus,string>={visitor:'none',connected:'idle',awaitingSignature:'busy',verifying:'busy',owner:'ok',signedInNoHouse:'idle',expired:'warn',ownershipUnavailable:'warn',mismatch:'warn'};
/** The 4th tools button: short state label on desktop, 「錢包 / Wallet」 on phones (CSS), a status dot, the gold star only for an owner. */
export function WalletChip({state,onOpen}:{state:AuthState;onOpen:()=>void}){
  const {text}=useWorldText(),st=statusOf(state),say=(zh:string,en:string)=>text(zh,en);
  const full=text('我的錢包','My wallet')+' · '+statusText(st,state,say);
  return <button aria-label={full} title={full} className={'wallet-chip'+(st==='owner'?' has-home':'')} data-state={st} onClick={onOpen}>
    <span aria-hidden="true">★</span><b className="chip-long">{chipText(st,state,say)}</b><b className="chip-short">{text('錢包','Wallet')}</b><i className={'wallet-dot '+DOT[st]} aria-hidden="true"/></button>;
}

type Assets={address:string;source:'imd';seats:SeatRow[];fetchedAt:number|null;
  characters:{collections:unknown[];items:{contract:string;tokenId:string;image:string|null;name:string|null}[];state:'ok'|'unavailable'}};
type AssetRead={address:string;state:'loading'|'ok'|'unavailable'|'error';data:Assets|null};
const CDN=(u:string|null)=>{try{return u&&new URL(u).host==='nft-cdn.alchemy.com'&&u.startsWith('https://')?u:null;}catch{return null;}};
/** Public assets of `address` (5 min Cache-Control; "Check again" (bump) revalidates past the browser cache, CORR-04). */
function useAssets(address:string|null,bump:number):AssetRead|null{
  const [read,setRead]=useState<AssetRead|null>(null);
  useEffect(()=>{
    if(!address){setRead(null);return;}
    let live=true;setRead(r=>({address,state:'loading',data:r?.address===address?r.data:null}));
    fetch('/api/wallet/'+address+'/assets',bump?{cache:'no-cache'}:undefined).then(async r=>{if(!live)return;
      if(r.ok)setRead({address,state:'ok',data:await r.json() as Assets});else setRead({address,state:r.status===503?'unavailable':'error',data:null});})
      .catch(()=>{if(live)setRead({address,state:'error',data:null});});
    return()=>{live=false;};
  },[address,bump]);
  return read;
}

export function WalletPanel({client,state,address,canSign,home,agents,error,onUseAddress,onForget,onTravel,onMove,onLocate}:{
  client:AuthClient;state:AuthState;address:string|null;canSign:boolean;
  /** The household to show: the owner's (signed in and verified) or the viewed wallet's, from the client's placement. */
  home:Home|null;agents:Map<string,Agent>;error:string|null;
  onUseAddress:(a:string)=>void;onForget:()=>void;onTravel:()=>void;onMove:()=>void;onLocate:(id:string)=>void}){
  const {text,zh,locale}=useWorldText(),say=(a:string,b:string)=>text(a,b),st=statusOf(state);
  const session=state.session,view=session&&st!=='mismatch'?session.address:address;
  const [bump,setBump]=useState(0),[copied,setCopied]=useState(false),assets=useAssets(view,bump);
  const me=state.home&&state.home!=='unavailable'&&session?.address===view?state.home:null;
  // Seat rows: the signed-in wallet's verified seats, or the public list (walletView.ts seatRows).
  const rows=useMemo(()=>seatRows(assets?.state==='ok'&&assets.address===view?assets.data!.seats:null,me),[assets,me,view]);
  const when=(n:number)=>new Date(n).toLocaleString(locale,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const copy=()=>{if(!view)return;void navigator.clipboard?.writeText(view).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);},()=>{});};
  const busy=st==='awaitingSignature'||st==='verifying'&&!!state.session===false;
  const registry=wallets(),found=useSyncExternalStore(registry.subscribe,()=>registry.state),hasProvider=found.any;
  const presign=<p className="small-note presign">{text('此次簽名僅用於登入 IMD Ember World（登入有效 7 天）、確認錢包控制權。不收取 Gas，也不授予 NFT 或代幣轉移權限；請確認錢包顯示的是本站登入訊息。','This signature only signs you in to IMD Ember World (for 7 days) and proves you control the wallet. It costs no gas and grants no NFT or token transfer rights. Check that your wallet shows this site’s sign-in message.')}</p>;
  // With several wallets and none chosen, the chooser comes first: no wallet is asked anything before the pick.
  const signButton=(label:string)=>found.needsChoice?null:<>{presign}<button className="primary" disabled={busy} onClick={()=>void client.signIn()}>{label}</button></>;
  const refresh=<button className="secondary" disabled={state.checking} onClick={()=>{void client.refreshHome(true,true);setBump(b=>b+1);}}>{state.checking?text('確認中…','Checking…'):text('重新確認','Check again')}</button>;
  const signOut=<button className="secondary" disabled={state.leaving} onClick={()=>void client.signOut()}>{state.leaving?text('登出中…','Signing out…'):text('登出','Sign out')}</button>;
  return <div className="wallet-panel">
    <div className="wallet-head">
      {view?<><code>{shortAddr(view)}</code><button className="wallet-copy" onClick={copy} aria-label={text('複製地址','Copy address')}>{copied?text('已複製','Copied'):text('複製','Copy')}</button></>:<span>{text('尚未連接錢包','No wallet connected')}</span>}
      <span className={'wallet-badge '+(session?'in':canSign?'connected':'view')}>{session?(st==='mismatch'?text('登入身分 ','Signed in as ')+shortAddr(session.address):text('已登入 · 有效至 ','Signed in · until ')+when(session.expiresAt)):canSign?text('已連接 · 未登入','Connected · not signed in'):view?text('只看','View only'):text('未登入','Not signed in')}</span>
    </div>
    <p className={'wallet-status '+DOT[st]} role="status"><i/>{statusText(st,state,say)}</p>
    {state.notice&&<p className="empty-state wallet-notice">{noticeText(state.notice,say)}</p>}
    <WalletChooser registry={registry} disabled={busy}/>
    {found.unidentified&&<p className="small-note">{unidentifiedNote(say)}</p>}
    {st==='visitor'&&(hasProvider?signButton(text('連接錢包並入住','Connect wallet')):<p className="small-note">{text('這個瀏覽器沒有偵測到錢包擴充功能；仍可用地址查看公開資產。','No wallet extension found in this browser. You can still view public assets by address.')}</p>)}
    {(st==='connected'||st==='expired')&&signButton(text('簽名驗證入住','Sign in to move in'))}
    {st==='mismatch'&&<>{signButton(text('用 ','Sign in as ')+shortAddr(state.account!)+text(' 重新簽名',''))}{signOut}</>}
    {busy&&<button className="primary" disabled>{statusText(st,state,say)}</button>}

    {st==='owner'&&me&&<section className="wallet-home">
      <h3>{text('我的家','My home')} · {me.size?(zh?SIZE_NAMES[me.size][0]+'屋':SIZE_NAMES[me.size][1]+' house'):''}</h3>
      <p className="small-note">{eligibleText(me.eligible,say)} · {text('確認於','checked')} {new Date(me.checkedAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}</p>
      {me.recheck==='limited'&&<p className="small-note">{text('鏈上索引查詢此刻太忙：IMD 名冊上的席位照常驗證，剛買的席位要等之後的查詢才會出現。','The NFT index is busy right now: seats on IMD’s roster are verified as usual; a seat bought just now appears on a later check.')}</p>}
      {home?<><button className="primary" onClick={onTravel}>{text('回家','Go home')}</button>
        {moveGate(state,home)==='ok'&&<button className="secondary" onClick={onMove}>{text('搬家…','Move…')}</button>}</>:
        <p className="small-note">{text('你的房子會在 IMD 名冊記上這個錢包後出現在地圖上。','Your house appears on the map once IMD’s roster lists this wallet.')}</p>}
      {refresh}
    </section>}
    {st==='signedInNoHouse'&&<><p className="empty-state">{text('已登入，目前沒有符合資格的席位：需要持有 IMD 席位，且它的 agent 在 24 小時內上線過。','Signed in, but no seat qualifies right now: a seat counts when you hold it and its agent was online in the last 24 hours.')}</p>{refresh}</>}
    {st==='ownershipUnavailable'&&<><p className="empty-state">{text('暫時無法向鏈上確認持有資格（不是沒有持有）。登入仍有效，請稍後重試。','Seat ownership can’t be checked on chain right now (this is not “you own nothing”). You are still signed in; try again later.')}</p>{refresh}</>}
    {home&&st!=='owner'&&<><HouseholdBlock home={home} agents={agents} mine={false} onLocate={onLocate}/><button className="secondary" onClick={onTravel}>{text('前往這個錢包的家','Go to this wallet’s home')}</button>
      {canSign&&(hint=>hint&&<p className="small-note">{hint==='sign-in'?text('要搬家請先簽名登入：連接錢包不足以證明你是屋主。','Sign in first to move this house: a connected wallet alone doesn’t prove you own it.'):
        hint==='no-seat'?text('要搬家，需要一個此刻符合資格的席位（持有，且 agent 在 24 小時內上線過）。','Moving needs a seat that counts right now (held, with its agent online in the last 24 hours).'):
        text('鏈上暫時無法確認你的席位，確認後才能搬家。','Moving waits until your seats can be checked on chain again.')}</p>)(moveHint(state,home))}</>}

    {view&&<section className="wallet-assets">
      <h3>{text('資產 · IMD 席位','Assets · IMD seats')}</h3>
      {rows===null?(assets?.state==='loading'||!assets?<p className="small-note">{text('讀取席位資料…','Reading seats…')}</p>:
        <p className="empty-state">{assets.state==='unavailable'?text('暫時無法讀取席位資料，請稍後重試。','Seats can’t be read right now. Try again later.'):text('資產讀取失敗，請稍後重試。','Assets could not be read. Try again later.')}</p>):
      rows.length===0?<p className="empty-state">{me?text('鏈上核實：這個錢包目前沒有 IMD 席位。','Checked on chain: this wallet holds no IMD seat right now.'):text('IMD 公開名冊目前沒有列出此錢包的席位。','IMD’s public roster lists no seat for this wallet.')}</p>:
      <ul className="seat-list">{rows.map(s=>{const img=CDN(s.image);return <li key={s.tokenId}><button onClick={()=>onLocate(s.tokenId)} aria-label={text('在世界中找到 #','Find #')+s.tokenId}>
        {img?<img src={img} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer"/>:<span className="seat-glyph" aria-hidden="true">◆</span>}
        <strong>#{s.tokenId}</strong>
        <span className={'seat-presence '+(s.online?'online':'offline')}><i/>{s.online?text('在線','Online'):text('離線','Offline')}</span>
        <span className={'seat-counts '+(s.counts?'yes':'no')}>{countsText(s,say)}</span>
      </button></li>;})}</ul>}
      {!me&&(assets?.state==='ok'||rows)&&<p className="small-note">{st==='ownershipUnavailable'?text('依 IMD 公開名冊列出，尚未經鏈上核實：鏈上查核暫時無法完成。','Listed from IMD’s public roster, not verified: the on-chain check isn’t available right now.'):
        st==='verifying'?text('依 IMD 公開名冊列出；正在向鏈上核實…','Listed from IMD’s public roster; checking on chain…'):
        text('依 IMD 公開名冊列出（不需簽名）；登入後以鏈上 ownerOf 核實。','Listed from IMD’s public roster (no signature needed); signing in verifies it with on-chain ownerOf.')}</p>}
      <h3>{text('Pepe 角色 NFT','Pepe character NFTs')}</h3>
      {CHARACTER_COLLECTIONS.length===0?<p className="coming-soon">{text('即將推出','Coming soon')}</p>:
        assets?.state==='ok'&&assets.data?(assets.data.characters.state==='unavailable'?<p className="small-note">{text('暫時無法讀取角色 NFT，請稍後重試。','Character NFTs can’t be read right now. Try again later.')}</p>:
        assets.data.characters.items.length?<ul className="character-grid">{assets.data.characters.items.map(n=>{const img=CDN(n.image);return <li key={n.contract+n.tokenId}>{img?<img src={img} alt={n.name??''} loading="lazy" referrerPolicy="no-referrer"/>:<span className="seat-glyph">◆</span>}<small>{n.name??'#'+n.tokenId}</small></li>;})}</ul>:
        <p className="small-note">{text('這個錢包還沒有 Pepe 角色。','No Pepe character in this wallet yet.')}</p>):null}
    </section>}

    {error&&<p className="empty-state">{error}</p>}
    {session&&st!=='mismatch'&&signOut}
    {!session&&address&&<button className="secondary" onClick={onForget}>{text('換一個錢包','Use another wallet')}</button>}
    {!session&&!address&&<form className="agent-search" onSubmit={e=>{e.preventDefault();const v=new FormData(e.currentTarget).get('addr');if(typeof v==='string')onUseAddress(v);}}>
      <input name="addr" placeholder="0x…" aria-label={text('錢包地址','Wallet address')} autoComplete="off"/><button type="submit">{text('用地址查看','View by address')}</button></form>}
  </div>;
}
