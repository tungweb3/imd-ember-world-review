import assets from './miningAssets.json';
import type {MinerTier} from './miningRules.ts';

/** A miner's still image; once the miner runs, its film when one is listed (miningAssets.json "videos", owner-provided)
 *  and the visitor allows motion. The 3D viewer was removed on 2026-10-27 at the owner's request: a film replaces it. */
type Films=Partial<Record<'small'|'medium'|'large',{src:string}>>;
export function MinerMedia({tier,language,active=false}:{tier:MinerTier;language:'zh'|'en';active?:boolean}){
 const kind=tier==='none'?'small':tier,asset=assets.models[kind],zh=language==='zh',name=zh?{small:'小型礦機',medium:'中型礦機',large:'大型礦機'}[kind]:kind+' miner';
 const film=(assets as {videos?:Films}).videos?.[kind]?.src;
 const motion=typeof window!=='undefined'&&typeof window.matchMedia==='function'&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 return <div className="miner-media">
  <div className="miner-stage">
   {active&&film&&motion?<video src={film} poster={asset.poster} width="640" height="640" autoPlay muted loop playsInline aria-label={name}/>
    :<img src={asset.poster} width="640" height="640" alt={name} decoding="async"/>}
  </div>
 </div>;
}
