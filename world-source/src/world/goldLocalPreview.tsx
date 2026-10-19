// Only gold-local-preview.html imports this fixture surface. No production entry.
import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {INITIAL,type AuthState} from './auth.ts';
import {WorldGoldPanel,GoldWalletBlock} from './WorldGoldPanel.tsx';
function Preview(){
 const [state,setState]=useState<AuthState>(INITIAL),[show,setShow]=useState(true),[mint,setMint]=useState(false);
 const choose=async(id:string)=>{const r=await fetch('/api/local-gold/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})}),s=await r.json();setState({...INITIAL,account:s.session?.address??null,session:s.session,sessionKnown:true,restored:true});};
 useEffect(()=>{void choose('A');const open=()=>setShow(true);window.addEventListener('world:gold-open',open);return()=>window.removeEventListener('world:gold-open',open);},[]);
 return <main className="gold-local-preview" style={{color:'#f3e9c8',font:'16px system-ui',padding:16}}><style>{'.gold-local-preview .world-gold-panel{inset:170px 12px 12px}@media(max-width:600px){.gold-local-preview .world-gold-panel{inset:235px 8px 8px}}'}</style><nav style={{display:'flex',gap:10,flexWrap:'wrap'}}>{['A','B','C','admin1','admin2','admin3','none'].map(id=><button key={id} style={{minHeight:44}} onClick={()=>void choose(id)}>{id==='none'?'登出':id.startsWith('admin')?'測試站主 '+id.slice(-1):'測試錢包 '+id}</button>)}<button onClick={()=>setShow(true)}>GOLD 帳本</button><button onClick={()=>{setShow(false);setMint(true);}}>共用帳本 Mint</button><a href="/?mode=demo&lang=zh">本機完整 World</a></nav><p>隔離測試：31337 私有鏈與模擬身分，未使用你的真實錢包。既有 8958／8973 不受影響。</p><GoldWalletBlock state={state}/>
 {show&&<div style={{position:'relative',height:'calc(100vh - 220px)'}}><WorldGoldPanel key={state.session?.address??'none'} state={state} language="zh" onClose={()=>setShow(false)} onSignIn={()=>void choose('A')}/></div>}
 {mint&&<div style={{position:'fixed',inset:12,zIndex:1200,background:'#132a21',padding:12}}><button style={{minHeight:44}} onClick={()=>{setMint(false);window.dispatchEvent(new Event('world:gold-changed'));setShow(true);}}>返回 World GOLD 帳本</button><iframe title="共用 GOLD 的本機 Mint" src="/local-mint/" style={{border:0,width:'100%',height:'calc(100% - 50px)'}}/></div>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
