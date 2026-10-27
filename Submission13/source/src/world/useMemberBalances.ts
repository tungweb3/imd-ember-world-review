import {createContext,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import type {AuthState} from './auth.ts';
import {EconomyClientError,economySession} from './economyClient.ts';
import {MemberBalancesClient,type MemberBalances} from './memberBalancesClient.ts';

export type MemberBalancesRead={identity:string|null;data:MemberBalances|null;failed:boolean;refreshing:boolean;refresh:()=>Promise<void>};
export const MemberBalancesContext=createContext<MemberBalancesRead|null>(null);

/** The HUD and wallet drawer share one authenticated read and one refresh timer. */
export function useMemberBalances(state:AuthState):MemberBalancesRead{
 const auth=useRef(state);auth.current=state;
 const client=useRef<MemberBalancesClient|null>(null);if(!client.current)client.current=new MemberBalancesClient({auth:()=>auth.current});
 const [clock,setClock]=useState(Date.now),[result,setResult]=useState<{key:string;data:MemberBalances}|null>(null),[failed,setFailed]=useState(false),[refreshing,setRefreshing]=useState(false);
 const inflight=useRef<AbortController|null>(null),session=economySession(state,Math.max(clock,Date.now()));
 const identity=session?session.address.toLowerCase()+':'+session.expiresAt:null,latest=useRef(identity);latest.current=identity;
 const refresh=useCallback(async()=>{
  const key=latest.current;if(!key||document.hidden)return;
  const abort=new AbortController();inflight.current?.abort();inflight.current=abort;setRefreshing(true);
  try{const data=await client.current!.read(abort.signal);if(!abort.signal.aborted&&latest.current===key){setResult({key,data});setFailed(false);}}
  // A failed refresh keeps the last good balances on screen (only the note changes), so a passing hiccup no longer
  // blanks the HUD. A context change is not a failure: the next read under the current session answers it.
  catch(e){if(!abort.signal.aborted&&latest.current===key&&!(e instanceof EconomyClientError&&e.code==='CONTEXT_CHANGED'))setFailed(true);}
  finally{if(!abort.signal.aborted&&latest.current===key)setRefreshing(false);}
 },[]);
 useEffect(()=>{setResult(null);setFailed(false);setRefreshing(false);if(identity)void refresh();return()=>inflight.current?.abort();},[identity,refresh]);
 useEffect(()=>{
  // Returning to a tab fires both focus and visibilitychange: one read, not two (the second aborted the first and both
  // spent the shared per-IP and per-location read budgets). Explicit GOLD/economy changes always read.
  let last=0;
  const update=()=>{setClock(Date.now());if(!document.hidden)void refresh();},passive=()=>{const t=Date.now();if(t-last<2000)return;last=t;update();},timer=setInterval(update,60000);
  window.addEventListener('focus',passive);window.addEventListener('world:gold-changed',update);window.addEventListener('world:economy-changed',update);document.addEventListener('visibilitychange',passive);
  return()=>{clearInterval(timer);window.removeEventListener('focus',passive);window.removeEventListener('world:gold-changed',update);window.removeEventListener('world:economy-changed',update);document.removeEventListener('visibilitychange',passive);};
 },[refresh]);
 useEffect(()=>{
  if(!session)return;
  const timer=setTimeout(()=>setClock(Date.now()),Math.min(2147483647,Math.max(0,session.expiresAt-Date.now())));
  return()=>clearTimeout(timer);
 },[session,clock]);
 return useMemo(()=>({identity,data:identity&&result?.key===identity?result.data:null,failed:!!identity&&failed,refreshing:!!identity&&refreshing,refresh}),[identity,result,failed,refreshing,refresh]);
}
