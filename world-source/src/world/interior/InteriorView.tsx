// Inside your house (docs/interiors/DESIGN_v001.md): the lazily loaded chunk. It runs the way in and out (§2: a warm iris
// from the door, the world suspended behind it and its renderer lent, the room built on it; back out, the renderer
// returned and the world resumed where it was), and the room's HUD: the way out, the window's caption, the seats (a
// list and the pager), the hover chip, notices, and the DOM twin of everything in the room (§11). Its CSS ships inside.
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type * as THREE from 'three';
import type {HouseSize} from '../houseSize.ts';
import type {AuthState} from '../auth.ts';
import type {WorldState} from '../model.ts';
import type {WorldScene} from '../scene.ts';
import type {Home} from '../households.ts';
import {useWorldText} from '../i18n.tsx';
import {InteriorRoom,type RoomItem,type SeatRow} from './room.ts';
import {caption,type SkyState,type WindowLook} from './sky.ts';
import {mockSeats} from './mockSeats.ts';
import {furnitureMode} from './slots.ts';
import {openRoom,exitRoom,BUILD_LIMIT} from './doorway.ts';
import css from './interior.css?inline';
import {InventoryClient} from '../inventoryClient.ts';
import {inventoryDisplay} from '../inventoryDisplay.ts';

// The chunk brings its own styles (inline: no stylesheet request on the way in, nothing in the world's first load).
if(typeof document!=='undefined'&&!document.getElementById('interior-css')){const s=document.createElement('style');s.id='interior-css';s.textContent=css;document.head.appendChild(s);}

type Point={x:number;y:number};
export type InteriorProps={
  /** The world: it stops and lends its renderer (suspend), takes it back (resume), and tells the sky and the door. */
  scene:Pick<WorldScene,'suspend'|'resume'|'skyState'|'doorScreen'|'borrowRenderer'>;
  /** The house walked into (null: the reviewers' preview), its size and style. */
  home:Home|null;size:HouseSize;style:'lisbon'|'timber';
  /** Mock seats drawn in the preview (null: the owner's own, MeHome.seats from the server session in `auth`). */
  preview:number|null;auth:AuthState;world:WorldState|null;
  /** A drawer (the agent card) is open over the room: keys and Esc are its. */
  covered:boolean;
  /** The page wants you out (owner mode ended, a travel from a drawer): the normal way out runs. */
  leave:boolean;
  /** Back outside with the iris open: unmount me. */
  onGone:()=>void;
  /** Open a seat's agent card; false when the public roster has no row for it. */
  onSeat:(tokenId:string)=>boolean;
  /** The room could not be built (or took too long): the world is already resumed; say so and unmount me. */
  onFailed:()=>void;
};
type Stage='closing'|'building'|'inside'|'leaving'|'back';
const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const centre=():Point=>({x:innerWidth/2,y:innerHeight/2});

/** The warm iris: `shut` closes it onto (x, y); a cross-fade under reduced motion. */
function Iris({at,shut,wait}:{at:Point;shut:boolean;wait:string|null}){
  // Open, the hole just clears the farthest corner of the screen, so the closing shows from its first frame.
  const reduced=reducedMotion(),far=Math.max(...[[0,0],[innerWidth,0],[0,innerHeight],[innerWidth,innerHeight]].map(([x,y])=>Math.hypot(x-at.x,y-at.y))),r=shut?0:far+70;
  return <div className="interior-iris" aria-hidden={!wait}>
    {reduced?<div className="interior-iris-fade" style={{opacity:shut?1:0}}/>:<div className="interior-iris-hole" style={{left:at.x-r,top:at.y-r,width:2*r,height:2*r}}/>}
    {wait&&<p role="status">{wait}</p>}
  </div>;
}

export default function InteriorView(props:InteriorProps){
  const {text,zh}=useWorldText(),host=useRef<HTMLDivElement>(null),exitRef=useRef<HTMLButtonElement>(null),room=useRef<InteriorRoom|null>(null),now=useRef(props);now.current=props;
  const [stage,setStage]=useState<Stage>('closing'),stageNow=useRef(stage);stageNow.current=stage;
  const tagRef=useRef<HTMLButtonElement>(null),place=props.style==='timber'?text('霜谷','Frosthollow'):text('燼渡','Emberford');
  /** The door on screen (the world's canvas is in place before the way in and after the way out), else the centre. */
  const door=():Point=>{const h=now.current.home,sc=now.current.scene,d=h&&sc.doorScreen(h),r=sc.borrowRenderer().domElement.getBoundingClientRect();return d?{x:r.left+d.x,y:r.top+d.y}:centre();};
  const [iris,setIris]=useState<{at:Point;shut:boolean}|null>(()=>({at:door(),shut:false}));
  const [items,setItems]=useState<RoomItem[]>([]),[rows,setRows]=useState<SeatRow[]>([]),[paging,setPaging]=useState({page:0,pages:1}),[hover,setHover]=useState<{label:string;x:number;y:number}|null>(null);
  const [toast,setToast]=useState<string|null>(null),[live,setLive]=useState(''),[sheet,setSheet]=useState(false),[look,setLook]=useState<WindowLook|null>(null),[calls,setCalls]=useState(0);
  const home=props.auth.home,seats=useMemo(()=>props.preview!==null?mockSeats(props.preview):home&&home!=='unavailable'?home.seats:[],[props.preview,home]),seatsNow=useRef(seats);seatsNow.current=seats;
  const agents=useMemo(()=>new Map((props.world?.agents??[]).map(a=>[a.tokenId,a])),[props.world]),fresh=props.world?.sources.workers.state==='fresh',liveNow=useRef({agents,fresh});liveNow.current={agents,fresh};
  const debug=useMemo(()=>import.meta.env.DEV||new URLSearchParams(location.search).get('debug')==='1',[]);
  const timers=useRef<number[]>([]),after=(fn:()=>void,ms=reducedMotion()?150:380)=>{timers.current.push(window.setTimeout(fn,ms));};
  /** Shut the iris now at `at` (from open, so it animates), or open it from shut. */
  const animate=(at:Point,toShut:boolean)=>{setIris({at,shut:!toShut});requestAnimationFrame(()=>requestAnimationFrame(()=>setIris({at,shut:toShut})));};
  const sync=()=>{const r=room.current;if(!r)return;setItems(r.items());setRows(r.seatRows());setPaging({page:r.pageIndex,pages:r.pages});};
  /** In: the iris closes onto the door, the world stops and lends its renderer, the room is built; its first frame opens
   *  the iris on it. */
  useLayoutEffect(()=>{
    animate(door(),true);
    // A room that throws while building gives the world back (INT-1); one still not drawn after BUILD_LIMIT ms too.
    let gaveUp=false;const fail=(e:unknown)=>{if(gaveUp)return;gaveUp=true;console.error('[interior]',e);room.current?.dispose();room.current=null;now.current.scene.resume();now.current.onFailed();};
    after(()=>{
      const phone=matchMedia('(pointer: coarse)').matches||innerWidth<700;setStage('building');
      const r=openRoom(now.current.scene,renderer=>{
        const r=new InteriorRoom(renderer,host.current!,{size:props.size,style:props.style,phone,reduced:reducedMotion(),zh,sky:()=>now.current.scene.skyState(),
          furniture:furnitureMode(location.search,import.meta.env.DEV)},{
          ready:()=>setStage('inside'),
          exit:()=>leave(),seat:id=>now.current.onSeat(id),say:(t,isToast)=>{if(isToast)setToast(t);setLive(t);},changed:sync,hover:setHover,
          tag:at=>{const el=tagRef.current;if(!el)return;el.style.visibility=at?'visible':'hidden';if(!at)return;   // kept whole on screen (a phone's cabinet sits at the edge)
            const hw=el.offsetWidth/2,W=host.current?.clientWidth??innerWidth,x=Math.min(Math.max(at.x,hw+6),W-hw-6);el.style.transform=`translate(${Math.round(x)}px,${Math.round(at.y)}px) translate(-50%,${at.above?'calc(-100% - 4px)':'-50%'})`;}});   // a card on the empty cabinet's glass (above it on a phone)
        try{r.setSeats(seatsNow.current,liveNow.current.agents,liveNow.current.fresh);}catch(e){r.dispose();throw e;}
        return r;},fail);
      if(!r)return;
      if(debug)(window as unknown as {__interior?:InteriorRoom}).__interior=r;   // the showcase's screenshots (DEV or ?debug=1)
      room.current=r;sync();setLook(r.windowLook);
    });
    const watchdog=window.setTimeout(()=>{if(stageNow.current==='closing'||stageNow.current==='building')fail(new Error('the room was not drawn in time'));},BUILD_LIMIT);
    const timer=setInterval(()=>{const r=room.current;if(r){setLook(r.windowLook);setCalls(r.drawCalls);}},1000);
    return()=>{gaveUp=true;clearTimeout(watchdog);clearInterval(timer);for(const t of timers.current)clearTimeout(t);if(room.current){room.current.dispose();room.current=null;now.current.scene.resume();}};
  },[]);
  /** Out: the iris closes over the room, the room gives the renderer back, the world resumes, the iris opens on the door. */
  const leave=()=>{
    if(stageNow.current!=='inside')return;setStage('leaving');setHover(null);animate(centre(),true);
    after(()=>{room.current?.dispose();room.current=null;now.current.scene.resume();const at=door();setStage('back');animate(at,false);after(()=>now.current.onGone());});
  };
  useEffect(()=>{if(props.leave)leave();},[props.leave,stage]);
  // In: the iris opens on the room's first frame, and focus goes to the way out (DESIGN §11) once it is on the page.
  useEffect(()=>{if(stage!=='inside')return;animate(centre(),false);after(()=>setIris(null));exitRef.current?.focus();},[stage]);
  /** Exit: through the room's door once inside; while it is still building, straight back (doorway.ts exitRoom). */
  const exit=()=>{const st=stageNow.current;if(st==='inside')exitRoom(room.current,now.current.scene,()=>now.current.onGone());
    else if(st==='building'){room.current?.dispose();room.current=null;exitRoom(null,now.current.scene,()=>now.current.onGone());}};
  useEffect(()=>{room.current?.setSeats(seats,agents,fresh);sync();},[seats,agents,fresh]);
  useEffect(()=>{room.current?.setLanguage(zh);sync();},[zh]);
  useEffect(()=>{if(room.current)room.current.covered=props.covered;},[props.covered,stage]);
  useEffect(()=>{
    room.current?.setCollectionDisplay(null);
    if(stage!=='inside'||props.preview!==null||!props.home)return;
    const client=new InventoryClient({auth:()=>now.current.auth}),abort=new AbortController();let active=true,reading=false;
    const refresh=async()=>{if(reading)return;reading=true;try{const state=await client.state(abort.signal);if(active)room.current?.setCollectionDisplay(inventoryDisplay(state));}catch{if(active)room.current?.setCollectionDisplay(null);}finally{reading=false;}};
    void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},60000);
    window.addEventListener('world:inventory-changed',refresh);window.addEventListener('focus',refresh);
    return()=>{active=false;abort.abort();clearInterval(timer);window.removeEventListener('world:inventory-changed',refresh);window.removeEventListener('focus',refresh);room.current?.setCollectionDisplay(null);};
  },[stage,props.preview,props.home?.owner,props.auth.session?.address,props.auth.session?.expiresAt,props.auth.account,props.auth.phase,props.auth.leaving]);
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(null),4500);return()=>clearTimeout(t);},[toast]);
  // Esc leaves (a drawer over the room takes it first; an open seat list closes first).
  useEffect(()=>{const esc=(e:KeyboardEvent)=>{if(e.key!=='Escape'||e.defaultPrevented||now.current.covered)return;if(sheet){setSheet(false);return;}exit();};addEventListener('keydown',esc);return()=>removeEventListener('keydown',esc);},[sheet]);
  const cap=look?caption(look,zh):null,go=(n:number)=>{room.current?.setPage(n);sync();},shown=stage==='building'||stage==='inside'||stage==='leaving';
  const openSeat=(id:string)=>{if(!props.onSeat(id))setToast(text('這個席位還不在公開名冊中。','This seat isn’t in the public roster yet.'));};
  return <section className={'interior'+(shown?'':' interior-away')} role="dialog" aria-modal="true" aria-label={text('我的家','Your home')} data-stage={stage} data-size={props.size} data-seats={seats.length} data-pages={paging.pages} inert={props.covered}>
    <div className="interior-canvas" ref={host} onPointerLeave={()=>setHover(null)}/>
    {shown&&<>
      <button className="interior-exit" ref={exitRef} onClick={exit}>← {text('回到','Back to ')}{place}</button>
      {props.preview!==null&&<span className="interior-badge">{text('預覽 · 模擬資料','Preview · mock data')}</span>}
      {cap&&<div className="interior-caption"><span aria-hidden="true">{cap.icon}</span><span><b>{cap.weather}</b><small>{place}{text('時間',' time')} {cap.clock}</small></span></div>}
      <div className="interior-bar">
        {props.preview===null&&<button className="interior-seats" onClick={()=>window.dispatchEvent(new Event('world:inventory-open'))}>{text('背包與收藏櫃','Inventory & cabinet')}</button>}
        <button className="interior-seats" aria-expanded={sheet} onClick={()=>setSheet(!sheet)}>{text('席位','Seats')} ({seats.length})</button>
        {paging.pages>1&&<div className="interior-pager" role="group" aria-label={text('席位牆分頁','Seat wall pages')}><button aria-label={text('上一頁','Previous page')} disabled={paging.page===0} onClick={()=>go(paging.page-1)}>‹</button><span>{paging.page+1} / {paging.pages}</span><button aria-label={text('下一頁','Next page')} disabled={paging.page>=paging.pages-1} onClick={()=>go(paging.page+1)}>›</button></div>}
      </div>
      {sheet&&<div className="interior-sheet" role="region" aria-label={text('我的席位','My seats')}>
        <div className="interior-sheet-head"><h2>{text('我的席位','My seats')} · {seats.length}</h2><button aria-label={text('關閉','Close')} onClick={()=>setSheet(false)}>×</button></div>
        {rows.length?<ul>{rows.map(r=><li key={r.tokenId} className={r.counts?'':'dim'}><button onClick={()=>openSeat(r.tokenId)}><i className={'lamp '+r.live} aria-hidden="true"/>{r.label}</button></li>)}</ul>
          :<p>{text('這個錢包目前沒有席位。','No seats in this wallet right now.')}</p>}
      </div>}
      <button className="interior-tag" ref={tagRef} tabIndex={-1} aria-hidden="true" style={{visibility:'hidden'}} onClick={()=>{room.current?.activate('pepe-cabinet:door_L+door_R');sync();}}>{text('Pepe 收藏','Pepe Collection')}<br/>{text('即將推出','Coming soon')}</button>
      {hover&&<span className="interior-chip" style={{left:hover.x,top:hover.y}}>{hover.label}</span>}
      {toast&&<p className="interior-toast" role="status">{toast}</p>}
      {debug&&<span className="interior-debug">{calls} draws</span>}
      <p className="sr-only" aria-live="polite">{live}</p>
      <ul className="sr-only" aria-label={text('房間裡的東西','Things in the room')}>{items.map(i=><li key={i.key}>
        <button aria-pressed={i.pressed} onFocus={()=>room.current?.focusItem(i.key)} onBlur={()=>room.current?.focusItem(null)} onClick={()=>{room.current?.activate(i.key);sync();}}>{i.label}</button></li>)}</ul>
    </>}
    {iris&&<Iris at={iris.at} shut={iris.shut} wait={stage==='building'?text('正在開門…','Opening the door…'):null}/>}
  </section>;
}
