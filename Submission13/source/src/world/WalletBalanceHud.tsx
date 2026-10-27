import {useSyncExternalStore} from 'react';
import type {AuthState} from './auth.ts';
import {fastCrediting,subscribeFastFollow} from './fastGoldCredit.ts';
import {economyTokenAmount} from './economyClient.ts';
import type {MemberBalances} from './memberBalancesClient.ts';
import type {MemberBalancesRead} from './useMemberBalances.ts';
import './walletBalanceHud.css';

/** Group decimal strings directly; token balances must never pass through Number. */
export function balanceNumber(value:string){
 const [whole,fraction]=value.split('.');
 return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction?'.'+fraction:'');
}
export function WalletBalanceHud({state,read,zh,onOpen}:{state:AuthState;read:MemberBalancesRead;zh:boolean;onOpen:()=>void}){
 const say=(a:string,b:string)=>zh?a:b,{identity,data,failed,refreshing,refresh}=read;
 const missing=(status:string)=>status==='indexing'?say('同步中','Syncing'):status==='not-configured'?say('尚未啟用','Not enabled'):say('暫無資料','Unavailable');
 const token=(value:MemberBalances['embeo']|undefined)=>value?.status==='ok'?balanceNumber(economyTokenAmount(value.atomic)):value?missing(value.status):'—';
 const gold=data?.gold.status==='ok'?balanceNumber(data.gold.available):data?.gold?missing(data.gold.status):'—';
 // A top-up being fast-credited (fastGoldCredit.ts): shown next to the balance until the server books it.
 const crediting=useSyncExternalStore(subscribeFastFollow,()=>String(fastCrediting()),()=>'0');
 const note=!identity?(state.session&&state.account&&state.session.address.toLowerCase()!==state.account.toLowerCase()?say('錢包已切換，請重新登入','Wallet changed. Sign in again.'):say('登入後查看餘額','Sign in to view balances')):failed?say('讀取失敗，請重試','Unable to read. Try again.'):!data?say('正在讀取餘額…','Loading balances…'):say('可用餘額','Available balances');
 return <section className="wallet-balance-hud" aria-label={say('我的資產餘額','My asset balances')} title={note} data-balance-state={!identity?'signed-out':failed?'error':data?'ready':'loading'}>
  <header><h2 aria-label={say('我的餘額','My balances')}><span className="balance-heading-long">{say('我的餘額','My balances')}</span><span className="balance-heading-short" aria-hidden="true">{!identity?say('請登入','Sign in'):failed?say('讀取失敗','Read failed'):!data?say('讀取中','Loading'):'EMBEO · GOLD'}</span></h2><button type="button" onClick={onOpen} aria-label={say('查看我的錢包','Open my wallet')}><span className="balance-wallet-label">{say('錢包','Wallet')}</span><span aria-hidden="true">›</span></button></header>
  <dl>
   <div><dt title={say('錢包 EMBEO','Wallet EMBEO')} aria-label={say('錢包 EMBEO','Wallet EMBEO')}><span className="balance-label-long">{say('錢包 EMBEO','Wallet EMBEO')}</span><span className="balance-label-short" aria-hidden="true">{say('EMBEO','EMBEO')}</span></dt><dd title={token(data?.embeo)}>{token(data?.embeo)}</dd></div>
   <div><dt title={say('質押 EMBEO','Staked EMBEO')} aria-label={say('質押 EMBEO','Staked EMBEO')}><span className="balance-label-long">{say('質押 EMBEO','Staked EMBEO')}</span><span className="balance-label-short" aria-hidden="true">{say('質押','Staked')}</span></dt><dd title={token(data?.staked)}>{token(data?.staked)}</dd></div>
   <div className="balance-gold"><dt><button type="button" className="balance-gold-purchase" onClick={()=>window.dispatchEvent(new Event('world:gold-open'))} aria-label={say('購買 GOLD 與查看帳本','Buy GOLD and view ledger')}>GOLD <span aria-hidden="true">＋</span></button></dt><dd title={gold}>{gold}{crediting!=='0'&&<span className="balance-gold-crediting" role="status" title={say('入帳中','Crediting')}> +{balanceNumber(crediting)}<span className="balance-gold-crediting-word"> {say('入帳中','crediting')}</span></span>}</dd>
    {/* A visible, one-tap way to buy GOLD (the "GOLD ＋" label alone was not recognised as a button). */}
    <button type="button" className="balance-gold-buy" onClick={()=>window.dispatchEvent(new Event('world:gold-open'))}>{say('購買','Buy')}</button></div>
  </dl>
  <footer><small role="status" title={note}>{note}</small>{identity&&<button type="button" aria-label={say('更新餘額','Refresh balances')} title={say('更新餘額','Refresh balances')} disabled={refreshing} onClick={()=>void refresh()}><span aria-hidden="true">↻</span></button>}</footer>
 </section>;
}
