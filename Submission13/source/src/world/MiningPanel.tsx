import {miningGold,type MiningSnapshot,type MiningPolicy,type MinerTier} from './miningRules.ts';
import './miningPanel.css';
import {MinerMedia} from './MinerMedia.tsx';

const format=(n:bigint)=>n.toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
/** pendingShares: a mined stake the finalized ledger has not booked yet (about 15 minutes), shown in gold, display only. */
export function MiningPanel({language,policy,miner,now=Date.now(),status='ready',pendingShares=0n}:{language:'zh'|'en';policy:MiningPolicy;miner:MiningSnapshot|null;now?:number;status?:'ready'|'signed-out'|'loading'|'unsynced'|'halted';pendingShares?:bigint}){
 const zh=language==='zh',say=(a:string,b:string)=>zh?a:b,tier=miner?.tier??'none',scheduled=now<policy.effectiveDayMs,pending=pendingShares>0n;
 const names={none:say('尚無礦機','No miner yet'),small:say('小型礦機','Small miner'),medium:say('中型礦機','Medium miner'),large:say('大型礦機','Large miner')};
 const shares=miner?BigInt(miner.totalShares):null,next=shares===null?null:shares<1n?1n:shares<10n?10n:shares<100n?100n:null;
 return <section className="mining-panel" aria-labelledby="mining-title">
  <header><div><h2 id="mining-title">{say('我的礦機','My miner')}</h2><p>{say('分批質押，自動合併為一台礦機。','Every deposit contributes to one wallet miner.')}</p></div><span className="mining-state">{status==='signed-out'?say('待登入','Sign in'):status==='loading'?say('讀取中','Loading'):status==='halted'?say('同步暫停','Sync paused'):status==='unsynced'?say('等待同步','Awaiting sync'):scheduled?say('即將啟用','Scheduled'):tier==='none'?(pending?say('啟動中','Starting'):say('等待啟動','Standby')):say('開採中','Mining')}</span></header>
  <div className={'mining-main '+(tier==='none'?'mining-empty':'')}>
   <div className="mining-visual"><MinerMedia key={tier} tier={tier} language={language} active={tier!=='none'&&status==='ready'}/><strong>{names[tier]}</strong><span>{miner&&tier!=='none'?say('效率 +','Efficiency +')+miner.bonusPercent+'%':say('100,000 EMBEO 啟動小型礦機','Start with 100,000 EMBEO')}</span></div>
   <div className="mining-data"><dl>
    <div><dt>{say('總質押 EMBEO','Total staked EMBEO')}</dt><dd>{shares===null?'—':format(shares*100000n)}</dd></div>
    <div><dt>{say('預估每日產出','Estimated daily output')}</dt><dd>{miner&&status==='ready'?miningGold(BigInt(miner.dailyGoldTenths)):'—'} <small>GOLD</small></dd></div>
    <div><dt>{say('未滿整數累積','Fraction carried forward')}</dt><dd>{miner?miningGold(BigInt(miner.remainderTenths)):'—'} <small>GOLD</small></dd></div>
   </dl>{pending&&<p className="mining-pending" role="status">{say('確認中：+','Confirming: +')}{format(pendingShares*100000n)} EMBEO<small>{say('質押已上鏈，約 15 分鐘後計入礦機；從下一個完整 UTC 日開始產出 GOLD。','Your stake is on chain; it joins the miner in about 15 minutes and earns GOLD from the next complete UTC day.')}</small></p>}<p className="mining-next">{status==='signed-out'?say('登入錢包，查看自己的礦機。','Sign in to view your miner.'):status==='loading'?say('正在讀取礦機…','Reading your miner…'):status==='unsynced'?say('鏈上資料未同步，暫不顯示持倉與產出。','Holdings and output appear after chain sync.'):status==='halted'?say('產出估算已暫停，請更新帳本。','Output estimates paused. Refresh the ledger.'):next!==null&&shares!==null?say('再質押 ','Stake another ')+format((next-shares)*100000n)+' EMBEO'+say(' 可升至',' to reach ')+(next===1n?names.small:next===10n?names.medium:names.large):miner?say('已達大型礦機，繼續質押可增加產出。','Large miner reached. Further stakes increase output.'):say('目前無法讀取，請更新帳本。','Unable to read. Refresh the ledger.')}</p></div>
  </div>
  <ol className="mining-tiers" aria-label={say('礦機等級','Miner tiers')}>
   {(['small','medium','large'] as const).map((t,i)=><li key={t} aria-current={tier===t?'step':undefined}><span>{names[t]}</span><strong>{['100,000','1,000,000','10,000,000'][i]} EMBEO</strong><small>{say('效率加成','Efficiency bonus')} +{[0,10,20][i]}%</small></li>)}
  </ol>
  <p className="mining-footnote">{say('依完整 UTC 日的有效質押總量決定加成，套用至全部有效份數。當日新增或取出的部分不計；小數持續累積，滿 1 GOLD 入帳。此處為虛擬礦機，不是 NFT，也不佔家中空間。','The total kept for the complete UTC day sets the bonus for all eligible shares. New or withdrawn shares do not earn that day. Fractions carry forward until 1 GOLD can be credited. This virtual miner is not an NFT and takes no home space.')}</p>
  {scheduled&&<p className="mining-footnote">{say('加成開始：','Bonus starts: ')}{new Date(policy.effectiveDayMs).toISOString().slice(0,16).replace('T',' ')} UTC{say('；之前的獎勵維持原規則。','; earlier rewards keep the original rules.')}</p>}
 </section>;
}
