import {isWorking,type Agent} from './model.ts';
import type {Home,HouseSize} from './households.ts';
import type {HomePose} from './layout.ts';
import {useWorldText} from './i18n.tsx';
import {walletUrl} from './links.ts';

export const SIZE_NAMES:Record<HouseSize,[string,string]>={s:['小型','Small'],ms:['中小型','Small-medium'],m:['中型','Medium'],l:['大型','Large'],xl:['超大型','Extra large']};
export const shortAddr=(a:string)=>a.slice(0,6)+'…'+a.slice(-4);
const toLodge=(p:{x:number;z:number})=>Math.round(Math.hypot(p.x-6,p.z-31));

/** One household (wallet): its agents, house size, and whether it is the viewer's. */
/** onEnter: only for the signed-in owner's own house (homeEntry.ts offersEnter); nobody else gets an Enter action. */
export function HouseholdBlock({home,agents,mine,onLocate,onEnter}:{home:Home;agents:Map<string,Agent>;mine:boolean;onLocate:(id:string)=>void;onEnter?:()=>void}){
  const {text,zh}=useWorldText(),size=SIZE_NAMES[home.size];
  return <section className="household">
    <h3>{mine?text('你的家','Your home'):text('這一戶','This household')} · {zh?size[0]:size[1]}{text('屋',' house')}</h3>
    <p className="small-note">{text('錢包','Wallet')} {walletUrl(home.owner)?<a href={walletUrl(home.owner)!} target="_blank" rel="noreferrer" aria-label={text('在 IMD Explorer 查看這個錢包','This wallet on IMD Explorer')}><code>{shortAddr(home.owner)}</code> ↗</a>:<code>{shortAddr(home.owner)}</code>} · {home.agents.length} {text('位 agent 同住','agents live here')} · {text('離守印者聚落','from the lodge')} {toLodge(home)} m</p>
    <ul className="household-agents">{home.agents.map(id=>{const a=agents.get(id);return <li key={id}><button onClick={()=>onLocate(id)}>
      <i className={a?.presence==='online'?(isWorking(a)?'working':'online'):'offline'}/>#{id}<small>{a?.runtimes.join(' / ')||''}</small></button></li>;})}</ul>
    {onEnter&&<button className="primary" onClick={onEnter}>{text('進入我的家','Enter your home')}</button>}
  </section>;
}

/** Confirm a move to the selected free lot. */
export function LotPanel({lot,home,error,onMove,onCancel}:{lot:HomePose;home:Home;error:string|null;onMove:()=>void;onCancel:()=>void}){
  const {text,zh}=useWorldText(),size=SIZE_NAMES[home.size];
  return <>
    <p>{text('把你的','Move your ')}{zh?size[0]:size[1].toLowerCase()}{text('屋搬到這塊地？',' house to this lot?')}</p>
    <dl className="agent-details"><dt>{text('離守印者聚落','From the lodge')}</dt><dd>{toLodge(lot)} m</dd><dt>{text('現在的家','Current home')}</dt><dd>{toLodge(home)} m</dd></dl>
    <p className="small-note">{text('你已用錢包簽名登入並確認為屋主，搬家不需要再簽名，也不是交易。原本的地會變回空地。','You are signed in and confirmed as the owner, so moving needs no further signature and is not a transaction. Your old lot becomes open ground.')}</p>
    <p className="small-note">{text('注意：共用的住處登記後端還沒上線，這次搬家只在你的瀏覽器生效，其他人暫時看不到。','Note: the shared home registry is not live yet, so this move only shows in your browser; other players don’t see it yet.')}</p>
    <button className="primary" onClick={onMove}>{text('搬到這裡','Move here')}</button>
    <button className="secondary" onClick={onCancel}>{text('取消','Cancel')}</button>
    {error&&<p className="empty-state">{error}</p>}
  </>;
}
