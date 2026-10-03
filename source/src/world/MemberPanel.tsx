import {createContext,useContext,useEffect,useState,useSyncExternalStore} from 'react';
import {useWorldText} from './i18n.tsx';
import {checkName,isReservedName,NAME_MIN,NAME_MAX} from './memberName.ts';
import {INITIAL_MEMBER,lookupName,type MemberClient,type MemberState,type SaveError} from './member.ts';
// The player name in My wallet (the owner's 2026-09-30 decisions: asked once after the first sign-in, "not now" allowed;
// shown in My wallet and on the house; renaming needs no signature). Every rule shown here is the server's
// (memberName.ts is the same validator); the server's answer is what counts.
type Say=(zh:string,en:string)=>string;

export const MemberContext=createContext<MemberClient|null>(null);
const noClient={subscribe:()=>()=>{},get:()=>INITIAL_MEMBER};
export function useMember(client:MemberClient|null):MemberState{
  return useSyncExternalStore(client?.subscribe??noClient.subscribe,()=>client?.state??INITIAL_MEMBER,()=>client?.state??INITIAL_MEMBER);
}
/** The name to show for the house of `owner`: the signed-in member's own (from its profile, never stale) or the public
 *  one (GET /api/world/names, a minute per address, asked only once the panel stays on a house: lookupName). Null: no name yet, or none could be read. */
export function useHouseName(owner:string|null|undefined):string|null{
  const client=useContext(MemberContext),me=useMember(client),own=!!owner&&me.address===owner.toLowerCase();
  const [read,setRead]=useState<{owner:string;name:string|null}|null>(null);
  useEffect(()=>{
    if(!owner||own)return;
    return lookupName(owner,name=>setRead({owner,name}));
  },[owner,own]);
  if(!owner)return null;
  if(own)return me.view?.member.profileState==='ready'?me.view.member.displayName:null;
  return read?.owner===owner?read.name:null;
}

const reasonText=(reason:string,say:Say)=>({
  length:say(`長度要 ${NAME_MIN}–${NAME_MAX} 個字。`,`Use ${NAME_MIN}–${NAME_MAX} characters.`),
  chars:say('只能用中文、英文字母、數字與底線（不能有空白、表情符號或其他符號）。','Only Chinese characters, English letters, digits and underscores (no spaces, emoji or other symbols).'),
  controls:say('含有看不見的控制字元，請重新輸入。','It contains invisible control characters. Please type it again.'),
  shape:say('至少要有一個中文、字母或數字。','It needs at least one Chinese character, letter or digit.'),
  bytes:say('太長了。','Too long.'),type:say('請輸入名稱。','Enter a name.'),
  reserved:say('這個名稱保留給網站使用，請換一個。','This name is reserved for the site. Please choose another.')
} as Record<string,string>)[reason]??say('這個名稱不能使用。','This name can’t be used.');
/** What a refused save says: never "signature", never a reason to open the wallet. */
export function saveErrorText(e:SaveError,say:Say,when:(n:number)=>string):string{
  switch(e.code){
    case 'NAME_FORMAT_INVALID':return reasonText(e.reason??'',say);
    case 'NAME_UNAVAILABLE':return say('這個名稱已被使用或保留，請換一個。','This name is taken or reserved. Please choose another.');
    case 'NAME_CHANGE_COOLDOWN':return say('改名冷卻中','Name changes are cooling down')+(e.nextNameChangeAt?say('，下次可改名：',' until ')+when(e.nextNameChangeAt):'')+say('。','.');
    case 'NAME_RATE_LIMITED':case 'RATE_LIMITED':return say('嘗試太頻繁，請一分鐘後再試。','Too many tries. Please wait a minute.');
    case 'PROFILE_VERSION_CONFLICT':return say('你的資料剛在其他分頁更新過，已重新讀取；請確認後再送出。','Your profile changed in another tab and has been read again. Check it and send again.');
    case 'ACCOUNT_CONTEXT_CHANGED':return say('登入的錢包已經換了，這次修改未套用。','The signed-in wallet changed, so this change was not applied.');
    case 'CONTRACT_WRITE_NOT_ENABLED':return say('合約錢包仍可登入及查看世界，但目前暫時不能建立會員或修改玩家名稱；再次簽名不會開啟這項功能。','Contract wallets can still sign in and view the world, but creating a member or changing a player name is not enabled yet. Another signature will not enable it.');
    case 'SAVE_RESULT_UNKNOWN':return say('上一筆儲存結果尚未確認，請先確認結果再修改名稱。','The previous save result is still unknown. Check that result before changing your name.');
    case 'PROFILE_LOCKED':return say('名稱暫時不能修改。','Your name can’t be changed right now.');
    case 'AUTH_REQUIRED':case 'SESSION_EXPIRED':return say('登入已結束，請重新簽名登入後再取名。','Your sign-in has ended. Sign in again to set your name.');
    default:return say('暫時無法儲存，請稍後重試。','Couldn’t save right now. Please try again later.');
  }
}

/** The naming form: first name ('first'), a change ('rename'), or the change moderation asked for ('fix'). */
function NameForm({client,state,mode,onDone}:{client:MemberClient;state:MemberState;mode:'first'|'rename'|'fix';onDone?:()=>void}){
  const {text,locale}=useWorldText(),say:Say=(a,b)=>text(a,b),[value,setValue]=useState('');
  const when=(n:number)=>new Date(n).toLocaleString(locale,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const check=checkName(value),reserved=check.ok&&isReservedName(check.key),typed=value.trim().length>0;
  const local=!typed?null:!check.ok?reasonText(check.reason,say):reserved?reasonText('reserved',say):null;
  const submit=async()=>{if(!check.ok||reserved||state.saving)return;if(await client.save(value))onDone?.();};
  return <form className="member-form" onSubmit={e=>{e.preventDefault();void submit();}}>
    {mode==='first'&&<><h3>{text('大家該怎麼稱呼你？','What should everyone call you?')}</h3>
      <p className="small-note">{text('取一個玩家名稱，之後的 Ember 金幣、角色紀錄都記在你的會員帳號上。','Pick a player name. Your Ember Coins and character records will be kept on your member account.')}</p></>}
    {mode==='fix'&&<p className="empty-state wallet-notice">{text('你的名稱需要修改（目前顯示為 ','Your name needs to be changed (it shows as ')}<b>{state.view?.member.displayName}</b>{text('）。請取一個新名稱。','). Please choose a new one.')}</p>}
    <label className="member-input"><span>{mode==='rename'?text('新名稱','New name'):text('玩家名稱','Player name')}</span>
      <input value={value} disabled={state.saving||state.pendingSave} maxLength={64} autoComplete="off" spellCheck={false} aria-invalid={!!local} aria-describedby="member-rule"
        onChange={e=>{setValue(e.target.value);client.clearError();}} placeholder={text('例如 EmberCat','e.g. EmberCat')}/></label>
    <p id="member-rule" className="small-note">{text(`可用中文、英文字母、數字與底線，${NAME_MIN}–${NAME_MAX} 個字；大小寫不同也算同一個名稱。`,`Chinese characters, English letters, digits and underscores, ${NAME_MIN}–${NAME_MAX} characters; names differing only in case count as the same name.`)}</p>
    {local&&<p className="small-note warn" role="alert">{local}</p>}
    {check.ok&&!reserved&&check.display!==value&&<p className="small-note">{text('會儲存為：','Will be saved as: ')}<b>{check.display}</b></p>}
    <p className="small-note">{text('這個名稱會公開顯示在你的房子資訊與「我的錢包」，並和你的錢包地址連在一起；不需要使用真實姓名。','This name is shown publicly on your house and in My wallet, linked to your wallet address. It doesn’t need to be your real name.')}</p>
    <p className="small-note">{mode==='rename'?text('改名後 7 天內不能再次修改；舊名稱為你保留 30 天。','After a change you can’t change it again for 7 days; your old name is kept for you for 30 days.'):
      text('儲存後 7 天內不能再改名。改名不需要再簽錢包。','After saving you can’t change it for 7 days. Changing it never needs a wallet signature.')}</p>
    {state.error&&<p className="empty-state wallet-notice" role="alert">{saveErrorText(state.error,say,when)}</p>}
    <button type="submit" className="primary" disabled={!check.ok||reserved||state.saving}>{state.saving?text('儲存中…','Saving…'):mode==='rename'?text('確認修改','Change name'):text('儲存名稱','Save name')}</button>
    {mode==='first'&&<button type="button" className="secondary" disabled={state.saving} onClick={()=>client.skip()}>{text('先逛逛','Not now')}</button>}
    {mode==='rename'&&<button type="button" className="secondary" disabled={state.saving} onClick={()=>{client.clearError();onDone?.();}}>{text('取消','Cancel')}</button>}
  </form>;
}

/** My wallet's member part, for a signed-in wallet only (WalletPanel). */
export function MemberBlock({client}:{client:MemberClient}){
  const state=useMember(client),{text,locale}=useWorldText(),[editing,setEditing]=useState(false),v=state.view?.member;
  const when=(n:number)=>new Date(n).toLocaleString(locale,{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  useEffect(()=>{setEditing(false);},[state.address]);
  if(state.phase==='idle')return null;
  if(state.pendingSave)return <section className="member-block">
    <p className="empty-state wallet-notice" role="alert">{saveErrorText({code:'SAVE_RESULT_UNKNOWN'},text,when)}</p>
    {v?.displayName&&<p className="member-name"><span>{text('目前讀到的玩家名稱','Current player name')}</span><b>{v.displayName}</b></p>}
    <button className="secondary" disabled={state.saving} onClick={()=>void client.retrySave()}>{state.saving?text('確認中…','Checking…'):text('確認上次儲存結果','Check previous save')}</button>
  </section>;
  if(state.error?.code==='CONTRACT_WRITE_NOT_ENABLED')return <section className="member-block">
    {v?.displayName&&<p className="member-name"><span>{text('玩家名稱','Player name')}</span><b>{v.displayName}</b></p>}
    <p className="empty-state wallet-notice" role="alert">{saveErrorText(state.error,text,when)}</p>
    <button className="secondary" onClick={()=>void client.load()}>{text('重新讀取資料','Refresh profile')}</button>
  </section>;
  if(state.phase==='loading'&&!v)return <section className="member-block"><p className="small-note">{text('讀取玩家資料…','Reading your player profile…')}</p></section>;
  if(!v)return <section className="member-block"><p className="empty-state wallet-notice">{text('玩家資料暫時無法取得，請稍後重試。這不影響你的錢包登入。','Your player profile can’t be read right now. Try again later; your wallet sign-in is not affected.')}</p>
    <button className="secondary" onClick={()=>void client.load()}>{text('重試','Try again')}</button></section>;
  if(v.profileState==='needs_rename')return <section className="member-block"><NameForm client={client} state={state} mode="fix"/></section>;
  if(v.profileState==='needs_name'&&(!state.skipped||editing))return <section className="member-block member-welcome"><NameForm client={client} state={state} mode="first" onDone={()=>setEditing(false)}/></section>;
  if(v.profileState==='needs_name')return <section className="member-block member-row"><p className="small-note">{text('還沒有玩家名稱。','No player name yet.')}</p>
    <button className="secondary" onClick={()=>setEditing(true)}>{text('取名','Choose a name')}</button></section>;
  // Live clients notify this store at the calibrated server deadline and refresh the profile. SSR/fixtures use now.
  const cooling=state.cooling??(v.nextNameChangeAt!==null&&Date.now()<v.nextNameChangeAt);
  return <section className="member-block">
    <p className="member-name"><span>{text('玩家名稱','Player name')}</span><b>{v.displayName}</b></p>
    {v.profileState==='locked'?<p className="small-note">{text('名稱暫時不能修改。','Your name can’t be changed right now.')}</p>:
      editing?<NameForm client={client} state={state} mode="rename" onDone={()=>setEditing(false)}/>:
      <>{cooling&&<p className="small-note">{text('下次可改名：','Next change possible: ')}{when(v.nextNameChangeAt!)}</p>}
        <button className="secondary" disabled={cooling} onClick={()=>{client.clearError();setEditing(true);}}>{text('改名','Change name')}</button></>}
  </section>;
}
