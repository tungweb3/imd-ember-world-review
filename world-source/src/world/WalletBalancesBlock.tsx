import {useCallback,useEffect,useRef,useState} from 'react';
import type {AuthState} from './auth.ts';
import {economySession,economyTokenAmount} from './economyClient.ts';
import {MemberBalancesClient,type MemberBalances} from './memberBalancesClient.ts';
import './worldGold.css';
import './walletBalances.css';
export function WalletBalancesBlock({state,zh=true}:{state:AuthState;zh?:boolean}){
 const auth=useRef(state);auth.current=state;const client=useRef<MemberBalancesClient|null>(null);if(!client.current)client.current=new MemberBalancesClient({auth:()=>auth.current});
 const [clock,setClock]=useState(Date.now),[result,setResult]=useState<{key:string;data:MemberBalances}|null>(null),[failed,setFailed]=useState(false),inflight=useRef<AbortController|null>(null);
 const session=economySession(state,clock),identity=session?session.address.toLowerCase()+':'+session.expiresAt:null,latest=useRef(identity);latest.current=identity;
 const refresh=useCallback(async()=>{const key=latest.current;if(!key)return;const abort=new AbortController();inflight.current?.abort();inflight.current=abort;
  try{const data=await client.current!.read(abort.signal);if(!abort.signal.aborted&&latest.current===key){setResult({key,data});setFailed(false);}}
  catch{if(!abort.signal.aborted&&latest.current===key){setResult(null);setFailed(true);}}
 },[]);
 useEffect(()=>{setResult(null);setFailed(false);if(identity)void refresh();return()=>inflight.current?.abort();},[identity,refresh]);
 useEffect(()=>{const update=()=>{setClock(Date.now());if(!document.hidden)void refresh();};const timer=setInterval(update,30000);window.addEventListener('focus',update);window.addEventListener('world:gold-changed',update);window.addEventListener('world:economy-changed',update);document.addEventListener('visibilitychange',update);return()=>{clearInterval(timer);window.removeEventListener('focus',update);window.removeEventListener('world:gold-changed',update);window.removeEventListener('world:economy-changed',update);document.removeEventListener('visibilitychange',update);};},[refresh]);
 if(!identity)return null;const data=result?.key===identity?result.data:null;
 const unavailable=(s:string)=>s==='not-configured'?(zh?'尚未啟用':'Not enabled'):s==='indexing'?(zh?'同步確認中':'Confirming chain data'):(zh?'暫時無法取得':'Unavailable');
 const token=(v:MemberBalances['embeo']|undefined)=>v?.status==='ok'?economyTokenAmount(v.atomic)+' EMBEO':v?unavailable(v.status):failed?(zh?'讀取失敗，請更新':'Unable to read. Refresh.'):(zh?'讀取中…':'Loading…');
 return <section className="gold-wallet-block wallet-balances"><h3>{zh?'我的餘額':'My balances'}</h3><dl>
  <div><dt>{zh?'錢包內 EMBEO':'EMBEO in wallet'}</dt><dd>{token(data?.embeo)}</dd></div>
  <div><dt>{zh?'已質押 EMBEO':'Staked EMBEO'}</dt><dd>{token(data?.staked)}</dd>{data?.staked.status==='ok'&&<small>{zh?'已確認至':'Confirmed through'} {new Date(data.staked.throughMs!).toLocaleString()}</small>}</div>
  <div><dt>GOLD</dt><dd>{data?.gold.status==='ok'?data.gold.available+' GOLD':data?.gold?unavailable(data.gold.status):failed?(zh?'讀取失敗，請更新':'Unable to read. Refresh.'):(zh?'讀取中…':'Loading…')}</dd>{data?.gold.status==='ok'&&<small>{zh?'帳面':'Book'} {data.gold.book} · {zh?'處理中保留':'Reserved'} {data.gold.reserved}</small>}</div>
 </dl>{data&&<small>{zh?'更新時間':'Updated'} {new Date(data.asOf).toLocaleTimeString()}</small>}<div><button onClick={()=>window.dispatchEvent(new Event('world:gold-open'))}>{zh?'購點與帳本':'GOLD & ledger'}</button><button onClick={()=>void refresh()}>{zh?'更新餘額':'Refresh balances'}</button></div></section>;
}
