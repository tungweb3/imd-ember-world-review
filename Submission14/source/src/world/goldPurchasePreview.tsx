// Imported only by the local QA HTML; not a production entrypoint.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {INITIAL,type AuthState,type Provider} from './auth.ts';
import {WorldGoldPanel} from './WorldGoldPanel.tsx';
import {WalletBalanceHud} from './WalletBalanceHud.tsx';
// The top bar's GOLD cell with a fixed synthetic balance, to see the gold "+N 入帳中" note after a payment.
const hudRead={identity:'local-qa',data:{embeo:{status:'ok',atomic:'0'},staked:{status:'ok',atomic:'0'},gold:{status:'ok',available:'500'}},failed:false,refreshing:false,refresh:async()=>{}} as unknown as Parameters<typeof WalletBalanceHud>[0]['read'];
const listeners=new Map<string,Set<(...args:unknown[])=>void>>();
const post=async(path:string,body:unknown)=>{const r=await fetch('/api/local-gold/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return r.json();};
const provider:Provider={async request(args){const r=await post('rpc',args);if(r.error)throw Object.assign(Error(r.error.message),{code:r.error.code});return r.result;},on(event,fn){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},removeListener(event,fn){listeners.get(event)?.delete(fn);}};
const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'gold-purchase-local-qa',rdns:'local.gold.fixture',name:'Synthetic QA wallet',icon:''},provider}}));
window.addEventListener('eip6963:requestProvider',announce);
function Preview(){
 const [state,setState]=useState<AuthState>(INITIAL),[narrow,setNarrow]=useState(false),[id,setId]=useState('A'),[reject,setReject]=useState(false),[wrongChain,setWrongChain]=useState(false),[open,setOpen]=useState(true);
 const choose=async(next:string,r=reject,c=wrongChain)=>{const value=await post('session',{id:next,reject:r,wrongChain:c});for(const fn of listeners.get('accountsChanged')??[])fn([value.session.address]);setState({...INITIAL,account:value.session.address,session:value.session,sessionKnown:true,restored:true});setId(next);announce();};
 useEffect(()=>{void choose('A');},[]);
 return <main style={{font:'14px system-ui',color:'#f3e9c8',padding:12}}><style>{`.world-gold-panel{top:135px;bottom:12px}${narrow?'.world-gold-panel{width:360px;max-width:calc(100vw - 16px);padding:12px;box-sizing:border-box}.gold-purchase{padding:16px}.gold-quick-plans strong{font-size:17px}.gold-quick-plans button{padding:12px}.world-gold-panel h1{font-size:18px}':''}`}</style><nav style={{display:'flex',gap:12,flexWrap:'wrap'}}><button onClick={()=>void choose('A')}>測試錢包 A</button><button onClick={()=>void choose('B')}>測試錢包 B</button><button onClick={()=>{setNarrow(!narrow);}}>手機寬度 360</button><label><input type="checkbox" checked={reject} onChange={e=>{setReject(e.target.checked);void choose(id,e.target.checked);}}/>模擬拒簽</label><label><input type="checkbox" checked={wrongChain} onChange={e=>{setWrongChain(e.target.checked);void choose(id,reject,e.target.checked);}}/>錯誤網路</label><button onClick={()=>void post('finalize',{}).then(()=>window.dispatchEvent(new Event('world:gold-changed')))}>模擬最終確認與入帳</button><button onClick={()=>setOpen(true)}>開啟購點</button></nav><p>隔離驗收：合成錢包、模擬鏈上收據與本機 SQLite。沒有使用真錢包或廣播交易。</p><div style={{width:narrow?340:480,marginLeft:'auto'}}><WalletBalanceHud state={state} read={hudRead} zh onOpen={()=>setOpen(true)}/></div>{open&&<WorldGoldPanel state={state} language="zh" onClose={()=>setOpen(false)} onSignIn={()=>void choose('A')}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
