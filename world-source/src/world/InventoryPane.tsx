import {useCallback,useEffect,useRef,useState} from 'react';
import type {AuthState} from './auth.ts';
import {InventoryClient} from './inventoryClient.ts';
import {INVENTORY_SLOTS,type InventorySnapshot,type InventoryCommand,type InventoryKind} from './inventory.ts';
import './inventory.css';

export function InventoryPane({state,zh,onClose}:{state:AuthState;zh:boolean;onClose:()=>void}){
  const auth=useRef(state);auth.current=state;const client=useRef<InventoryClient|null>(null);if(!client.current)client.current=new InventoryClient({auth:()=>auth.current});
  const [read,setRead]=useState<{key:string;value:InventorySnapshot}|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[tick,setTick]=useState(0),[tab,setTab]=useState<'bag'|'equipment'|'displays'>('bag');
  const [filter,setFilter]=useState<'all'|InventoryKind>('all'),pending=useRef<AbortController|null>(null),host=useRef<HTMLElement>(null),operation=useRef(false),key=client.current.identity(),latest=useRef(key);latest.current=key;
  const say=(a:string,b:string)=>zh?a:b,data=read?.key===key?read.value:null;
  const refresh=useCallback(async()=>{if(operation.current)return;const identity=client.current!.identity();if(!identity)return;
    const abort=new AbortController();pending.current?.abort();pending.current=abort;
    try{const value=await client.current!.state(abort.signal);if(!abort.signal.aborted&&latest.current===identity){setRead({key:identity,value});setError(null);}}
    catch(e){if(!abort.signal.aborted&&latest.current===identity){setRead(null);setError((e as Error).message);}}
  },[]);
  useEffect(()=>{setRead(null);setError(null);void refresh();return()=>pending.current?.abort();},[key,refresh]);
  useEffect(()=>{const prior=document.activeElement as HTMLElement|null;host.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}if(e.key==='Tab'){const buttons=[...(host.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)')??[])];if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0]?.focus();}}};
    document.addEventListener('keydown',escape,true);const timer=setInterval(()=>setTick(t=>t+1),1000);
    const focus=()=>void refresh();window.addEventListener('focus',focus);
    return()=>{clearInterval(timer);document.removeEventListener('keydown',escape,true);window.removeEventListener('focus',focus);if(prior?.isConnected)prior.focus();};
  },[onClose,refresh]);
  useEffect(()=>{if(tick>0&&tick%60===0&&!document.hidden)void refresh();},[tick,refresh]);
  const command=async(c:InventoryCommand)=>{if(!data||operation.current||!key)return;operation.current=true;setBusy(true);setError(null);const identity=key,abort=new AbortController();pending.current?.abort();pending.current=abort;
    try{const value=await client.current!.command(data.revision,c,abort.signal);if(!abort.signal.aborted&&latest.current===identity){setRead({key:identity,value});window.dispatchEvent(new Event('world:inventory-changed'));}}
    catch(e){if(!abort.signal.aborted&&latest.current===identity)setError((e as Error).message);}
    finally{operation.current=false;setBusy(false);}
  };
  const kinds:Record<string,[string,string]>={all:['全部','All'],weapon:['武器','Weapons'],armor:['護甲','Armor'],tool:['道具','Tools'],trophy:['戰利品','Trophies'],nft:['NFT','NFT']};
  return <div className="inventory-layer"><section className="inventory-pane" role="dialog" aria-modal="true" aria-label={say('背包與家中收藏','Inventory and home collection')} ref={host}>
    <header><h2>{say('背包與家中收藏','Inventory and home collection')}</h2><button onClick={onClose}>{say('返回世界','Back to World')}</button></header>
    {!key?<p role="status">{say('請先使用 World 錢包登入。','Sign in with your World wallet first.')}</p>:<>
      <p className="inventory-note">{say('背包、配裝與家中展示共用同一份持有資料。NFT 僅開放核准的遊戲系列，目前尚未發行。','Inventory, equipment and displays reference the same holdings. Only approved game NFTs are supported; none are issued yet.')}</p>
      <div className="inventory-controls"><nav>{(['bag','equipment','displays'] as const).map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t==='bag'?say('背包','Inventory'):t==='equipment'?say('配裝','Equipment'):say('家中展示','Home display')}</button>)}</nav><button disabled={busy} onClick={()=>void refresh()}>{say('重新讀取','Refresh')}</button></div>
      {error&&<p role="alert">{error==='REVISION_CONFLICT'?say('另一個分頁已更新配置，請重新讀取後再操作。','Another tab changed the arrangement. Refresh before trying again.'):error==='HOME_REQUIRED'?say('目前沒有符合資格的住宅；物品仍保留。','No eligible home; your items are retained.'):say('暫時無法完成操作，請重新讀取；不會自動重送。','The operation could not be completed. Refresh; it will not be resent automatically.')}</p>}
      {!data&&!error&&<p role="status">{say('讀取收藏…','Reading collection…')}</p>}
      {data&&<>
        <p className="inventory-note">{say('住宅','Home')}：{data.home.state==='eligible'?say('已確認','Verified'):data.home.state==='none'?say('目前無資格','No eligible home'):say('暫時無法查核，展示暫停','Check unavailable; display paused')} · {say('保存版本','Saved revision')} {data.revision}</p>
        {tab==='bag'&&<><select aria-label={say('物品分類','Item category')} value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v[zh?0:1]}</option>)}</select><div className="inventory-items">{data.items.filter(i=>filter==='all'||i.definition.kind===filter).map(item=><article key={item.id}><h3>{item.definition.title[zh?'zh':'en']}</h3><p>{item.definition.description[zh?'zh':'en']}</p><small>{say('取得來源','Source')}: {item.source}</small><div>{(['weapon','armor','tool'] as const).map(slot=>item.definition.kind===slot&&<button key={slot} disabled={busy} onClick={()=>void command({type:'equip',slot,itemId:item.id})}>{say('裝備','Equip')}</button>)}{INVENTORY_SLOTS.filter(s=>s.kind===item.definition.kind).map(s=><button key={s.id} disabled={busy||data.home.state!=='eligible'} onClick={()=>void command({type:'display',slot:s.id,itemId:item.id})}>{say('放入','Place in ')}{s[zh?'zh':'en']}</button>)}</div></article>)}</div>{!data.items.some(i=>filter==='all'||i.definition.kind===filter)&&<p>{say('這個分類還沒有已取得的物品。遊戲正式發放後會出現在這裡。','No owned items in this category yet. Verified game grants will appear here.')}</p>}</>}
        {tab==='equipment'&&(['weapon','armor','tool'] as const).map(slot=>{const item=data.items.find(i=>i.id===data.equipment[slot]);return <article className="inventory-slot" key={slot}><span>{kinds[slot][zh?0:1]}</span><b>{item?.definition.title[zh?'zh':'en']??say('空欄位','Empty')}</b>{item&&<button disabled={busy} onClick={()=>void command({type:'equip',slot,itemId:null})}>{say('卸下','Unequip')}</button>}</article>;})}
        {tab==='displays'&&<>{INVENTORY_SLOTS.map(slot=>{const item=data.items.find(i=>i.id===data.displays[slot.id]);return <article className="inventory-slot" key={slot.id}><span>{slot[zh?'zh':'en']}</span><b>{item?.definition.title[zh?'zh':'en']??say('等待收藏','Empty')}</b>{item&&<button disabled={busy||data.home.state!=='eligible'} onClick={()=>void command({type:'display',slot:slot.id,itemId:null})}>{say('收回展示','Remove display')}</button>}</article>;})}<button disabled={busy||!data.published&&data.home.state!=='eligible'} onClick={()=>void command({type:'publish',enabled:!data.published})}>{data.published?say('停止公開展示','Unpublish display'):say('公開展示收藏櫃','Publish cabinet display')}</button><p className="inventory-note">{say('公開後只分享展示格，訪客看不到私人背包、配裝、GOLD 或訂單。','Publishing shares only display slots. Visitors cannot see private inventory, equipment, GOLD or orders.')}</p></>}
      </>}
    </>}
  </section></div>;
}
