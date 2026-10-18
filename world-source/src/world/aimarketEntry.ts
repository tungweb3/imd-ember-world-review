import type {AuthState} from './auth.ts';

export const AIMARKET_ORIGIN='https://aimarket.trade';
export const RESEARCH_ORIGIN='https://research.imdember.com';
export const AIMARKET_AUTH_CHANNEL='ember-world-aimarket-auth-v1';
export function aimarketPortalFrame(language:'zh'|'en'){return RESEARCH_ORIGIN+'/?portal=world&lang='+language;}
export function aimarketPortalStart(state:AuthState,now:number,language:'zh'|'en'):string|null {
  if(!canContinueToAIMarket(state,now)||!/^0x[0-9a-fA-F]{40}$/.test(state.session!.address))return null;
  const url=new URL('/api/holder/world/start',RESEARCH_ORIGIN);
  url.searchParams.set('lang',language);url.searchParams.set('expected_address',state.session!.address.toLowerCase());return url.href;
}
export type ResearchOpenResult='opened'|'blocked'|'login-required'|'activation-required';
/** The enclosing World creates the popup, so it cannot inherit iframe sandbox flags.
 * Re-read the current World session and transient browser activation for every click;
 * a frame message supplies neither identity, navigation target nor authority. */
export function openAIMarketAccess(state:AuthState,now:number,language:'zh'|'en',active:boolean,open:(url:string,name:string,features:string)=>unknown):ResearchOpenResult {
  const start=aimarketPortalStart(state,now,language);
  if(!start)return 'login-required';
  if(!active)return 'activation-required';
  // A new name also avoids reusing an already-open legacy sandboxed popup.
  try{return open(start,'ember-world-research-access-v2','popup,width=540,height=700')?'opened':'blocked';}
  catch{return 'blocked';}
}
export function aimarketEntry(language:'zh'|'en') {return '/aimarket/?lang='+language;}
// This is a UI guard. The issuer reads the real HttpOnly World session again.
export function canContinueToAIMarket(state:AuthState,now:number):boolean {
  return Number.isFinite(now)&&state.sessionKnown&&!!state.session&&state.session.expiresAt>now&&
    state.phase==='idle'&&!state.leaving&&!state.waiting&&
    (!state.account||state.account.toLowerCase()===state.session.address.toLowerCase());
}
export function aimarketStart(state:AuthState,now:number,language:'zh'|'en'):string|null {
  if(!canContinueToAIMarket(state,now)||!/^0x[0-9a-fA-F]{40}$/.test(state.session!.address))return null;
  const url=new URL('/api/holder/world/start',AIMARKET_ORIGIN);
  url.searchParams.set('lang',language);url.searchParams.set('expected_address',state.session!.address.toLowerCase());
  return url.href;
}
