import {useContext} from 'react';
import type {AuthState} from './auth.ts';
import {economyTokenAmount} from './economyClient.ts';
import type {MemberBalances} from './memberBalancesClient.ts';
import {MemberBalancesContext,useMemberBalances,type MemberBalancesRead} from './useMemberBalances.ts';
import './worldGold.css';
import './walletBalances.css';
export function WalletBalancesBlock({state,zh=true}:{state:AuthState;zh?:boolean}){
 const shared=useContext(MemberBalancesContext);
 return shared?<WalletBalancesView read={shared} zh={zh}/>:<StandaloneBalances state={state} zh={zh}/>;
}
function StandaloneBalances({state,zh}:{state:AuthState;zh:boolean}){return <WalletBalancesView read={useMemberBalances(state)} zh={zh}/>;}
function WalletBalancesView({read,zh}:{read:MemberBalancesRead;zh:boolean}){
 const {identity,data,failed,refresh}=read;if(!identity)return null;
 const unavailable=(s:string)=>s==='not-configured'?(zh?'尚未啟用':'Not enabled'):s==='indexing'?(zh?'同步確認中':'Confirming chain data'):(zh?'暫時無法取得':'Unavailable');
 const token=(v:MemberBalances['embeo']|undefined)=>v?.status==='ok'?economyTokenAmount(v.atomic)+' EMBEO':v?unavailable(v.status):failed?(zh?'讀取失敗，請更新':'Unable to read. Refresh.'):(zh?'讀取中…':'Loading…');
 return <section className="gold-wallet-block wallet-balances"><h3>{zh?'我的餘額':'My balances'}</h3><dl>
  <div><dt>{zh?'錢包內 EMBEO':'EMBEO in wallet'}</dt><dd>{token(data?.embeo)}</dd></div>
  <div><dt>{zh?'已質押 EMBEO':'Staked EMBEO'}</dt><dd>{token(data?.staked)}</dd>{data?.staked.status==='ok'&&<small>{zh?'已確認至':'Confirmed through'} {new Date(data.staked.throughMs!).toLocaleString()}</small>}</div>
  <div><dt>GOLD</dt><dd>{data?.gold.status==='ok'?data.gold.available+' GOLD':data?.gold?unavailable(data.gold.status):failed?(zh?'讀取失敗，請更新':'Unable to read. Refresh.'):(zh?'讀取中…':'Loading…')}</dd>{data?.gold.status==='ok'&&<small>{zh?'帳面':'Book'} {data.gold.book} · {zh?'處理中保留':'Reserved'} {data.gold.reserved}</small>}</div>
 </dl>{data&&<small>{zh?'更新時間':'Updated'} {new Date(data.asOf).toLocaleTimeString()}</small>}<div><button onClick={()=>window.dispatchEvent(new Event('world:gold-open'))}>{zh?'購買 GOLD／查看紀錄':'Buy GOLD / history'}</button><button onClick={()=>void refresh()}>{zh?'更新餘額':'Refresh balances'}</button></div></section>;
}
