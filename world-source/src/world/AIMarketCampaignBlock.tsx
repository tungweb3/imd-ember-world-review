import {useEffect,useRef,useState} from 'react';
import type {AuthState} from './auth.ts';
import {economySession} from './economyClient.ts';
import {fetchAIMarketAdminStatus} from './aimarketAdmin.ts';
type Campaign={version:number;startsMs:number|null;endsMs:number|null;stopped:number;active:boolean;asOf:number};
const utc=(ms:number|null)=>ms?new Date(ms).toISOString().slice(0,16):'';
export function AIMarketCampaignBlock({state,zh}:{state:AuthState;zh:boolean}){
  const auth=useRef(state);auth.current=state;const session=economySession(state),key=session?session.address.toLowerCase()+':'+session.expiresAt:null,latest=useRef(key);latest.current=key;
  const [read,setRead]=useState<{key:string;campaign:Campaign}|null>(null),[role,setRole]=useState<string|null>(null),[error,setError]=useState(false),[busy,setBusy]=useState(false),[start,setStart]=useState(''),[end,setEnd]=useState(''),[reason,setReason]=useState('');
  const pending=useRef<AbortController|null>(null),say=(a:string,b:string)=>zh?a:b,c=read?.key===key?read.campaign:null;
  useEffect(()=>{setRead(null);setRole(null);setError(false);if(!session||!key)return;const abort=new AbortController();pending.current=abort;
    void fetchAIMarketAdminStatus(session,{signal:abort.signal}).then(async allowed=>{if(!allowed||abort.signal.aborted||latest.current!==key)return;setRole(key);
      try{const r=await fetch('/api/me/aimarket-campaign?expected_address='+session.address.toLowerCase(),{credentials:'same-origin',cache:'no-store',signal:abort.signal});const s=await r.json();if(!r.ok||s.address!==session.address.toLowerCase()||!s.campaign||!Number.isSafeInteger(s.campaign.version))throw Error();if(!abort.signal.aborted&&latest.current===key){setRead({key,campaign:s.campaign});setStart(utc(s.campaign.startsMs));setEnd(utc(s.campaign.endsMs));}}catch{if(!abort.signal.aborted&&latest.current===key)setError(true);}
    });return()=>abort.abort();
  },[key]);
  if(!key||role!==key)return null;
  const submit=async(stop=false)=>{if(busy||!c||!session)return;const identity=key,abort=new AbortController();pending.current?.abort();pending.current=abort;setBusy(true);setError(false);
    try{const startsMs=stop?c.startsMs:Date.parse(start+'Z'),endsMs=stop?c.endsMs:Date.parse(end+'Z');if(!Number.isSafeInteger(startsMs)||!Number.isSafeInteger(endsMs)||!startsMs||!endsMs||endsMs<=startsMs||reason.trim().length<3)throw Error();
      const r=await fetch('/api/me/aimarket-campaign',{method:'POST',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{'content-type':'application/json'},body:JSON.stringify({expectedAddress:session.address.toLowerCase(),requestId:crypto.randomUUID(),version:c.version+1,startsMs,endsMs,stopped:stop,reason})});const s=await r.json();
      const fresh=economySession(auth.current);if(abort.signal.aborted||!fresh||latest.current!==identity)throw Error();if(!r.ok||s.address!==fresh.address.toLowerCase()||!s.campaign)throw Error();setRead({key:identity,campaign:s.campaign});setReason('');
    }catch{if(!abort.signal.aborted&&latest.current===identity)setError(true);}finally{setBusy(false);}
  };
  return <section className="wallet-home"><h3>{say('AIMarket 免費活動後台','AIMarket free campaign')}</h3><p className="small-note">{say('僅開放 World 內研究；外站維持公開摘要。起訖均為 UTC，修改會留下站主紀錄。','World research only; the external site keeps public summaries. Times are UTC; changes are recorded.')}</p>
    {c&&<><p>{say('目前設定','Current schedule')}: {c.version===0?say('尚未設定','Not configured'):c.stopped?say('已停止','Stopped'):new Date(c.asOf).getTime()<Number(c.startsMs)?say('等待開始','Scheduled'):c.active?say('進行中','Active'):say('已結束','Ended')}</p>
      <label>{say('開始（UTC）','Start (UTC)')}<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)} disabled={busy}/></label><br/>
      <label>{say('結束（UTC）','End (UTC)')}<input type="datetime-local" value={end} onChange={e=>setEnd(e.target.value)} disabled={busy}/></label><br/>
      <label>{say('操作原因','Reason')}<input value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={busy}/></label>
      <div><button disabled={busy} onClick={()=>void submit()}>{say('儲存活動時間','Save schedule')}</button><button disabled={busy||c.version===0||!!c.stopped} onClick={()=>void submit(true)}>{say('立即結束活動','End campaign now')}</button></div></>}
    {error&&<p role="alert">{say('未完成變更。請核對 UTC 起訖及至少三字的原因，重新開啟面板確認最新設定後再試。','Change not completed. Check UTC times and a reason of at least three characters, then reopen for the current schedule.')}</p>}
  </section>;
}
