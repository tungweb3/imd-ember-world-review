import {useEffect,useRef,useState} from 'react';
import {INVENTORY_SLOTS} from './inventory.ts';
type Display={slot:string;title:{zh:string;en:string};kind:string;color:string};
export function PublicCabinetBlock({wallet,zh}:{wallet:string;zh:boolean}){
  const [read,setRead]=useState<{wallet:string;visible:boolean;displays:Display[]}|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),pending=useRef<AbortController|null>(null);
  useEffect(()=>{setRead(null);setError(false);setBusy(false);return()=>pending.current?.abort();},[wallet]);
  const open=async()=>{if(busy||!/^0x[0-9a-fA-F]{40}$/.test(wallet))return;const abort=new AbortController();pending.current?.abort();pending.current=abort;setBusy(true);setError(false);
    try{const r=await fetch('/api/world/collections/'+wallet.toLowerCase(),{credentials:'omit',cache:'no-store',signal:abort.signal});const s=await r.json();if(!r.ok||typeof s.visible!=='boolean'||!Array.isArray(s.displays)||s.displays.length>6||s.displays.some((d:Display)=>!INVENTORY_SLOTS.some(slot=>slot.id===d.slot&&slot.kind===d.kind)||!d.title||typeof d.title.zh!=='string'||typeof d.title.en!=='string'||d.title.zh.length>1000||d.title.en.length>1000))throw Error();
      if(!abort.signal.aborted)setRead({wallet,visible:s.visible,displays:s.displays});
    }catch{if(!abort.signal.aborted)setError(true);}finally{if(!abort.signal.aborted)setBusy(false);}
  };
  const s=read?.wallet===wallet?read:null;
  return <section><button className="secondary" disabled={busy} onClick={()=>void open()}>{zh?'查看公開收藏櫃':'View public cabinet'}</button>
    {error&&<p role="status">{zh?'目前無法查核公開展示，請稍後重試。':'The public display cannot be verified. Retry later.'}</p>}
    {s&&(s.visible?<ul>{s.displays.length?s.displays.map(d=><li key={d.slot}>{INVENTORY_SLOTS.find(slot=>slot.id===d.slot)![zh?'zh':'en']} · {d.title[zh?'zh':'en']}</li>):<li>{zh?'收藏櫃目前沒有公開物品。':'No public items in this cabinet.'}</li>}</ul>:<p>{zh?'這一戶目前沒有公開收藏展示。':'This household has no public display right now.'}</p>)}
  </section>;
}
