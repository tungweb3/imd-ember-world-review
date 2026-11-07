import {SQUEEK_API_PREFIX,SQUEEK_CLIENT_ID,SQUEEK_ISSUER,SQUEEK_REDIRECT,SQUEEK_ORIGIN,SQUEEK_REQUEST_KEY,squeekBySku} from '../shared/squeekCatalog.ts';
export {canContinueToCelestao as canContinueToSqueek} from './celestaoEntry.ts';
/** A resume link can only repeat a complete, already bounded 鼠道修仙 authorize request on World.
 * It cannot select a different redirect or an arbitrary URL. */
export function squeekResume(value:unknown):string|null{
 if(typeof value!=='string'||value.length>1800||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000- ]/.test(value))return null;
 try{const u=new URL(value,SQUEEK_ISSUER);if(u.origin!==SQUEEK_ISSUER||u.pathname!==SQUEEK_API_PREFIX+'authorize'||u.hash||u.username||u.password)return null;
  const keys=['client_id','redirect_uri','response_type','code_challenge_method','code_challenge','state','lang'];
  if(u.searchParams.size!==keys.length||keys.some(k=>u.searchParams.getAll(k).length!==1)||[...u.searchParams.keys()].some(k=>!keys.includes(k)))return null;
  if(u.searchParams.get('client_id')!==SQUEEK_CLIENT_ID||u.searchParams.get('redirect_uri')!==SQUEEK_REDIRECT||u.searchParams.get('response_type')!=='code'||u.searchParams.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(u.searchParams.get('code_challenge')??'')||!/^[A-Za-z0-9_-]{22,128}$/.test(u.searchParams.get('state')??'')||!['zh','en'].includes(u.searchParams.get('lang')??''))return null;
  return u.pathname+u.search;
 }catch{return null;}
}
/** The checkout page's own parameters. The game chooses the cosmetic and its purchase key, never the amount. */
export function squeekCheckoutParams(search:string){
 const q=new URLSearchParams(search),sku=q.get('sku')??'',requestKey=q.get('request')??'';
 return {sku,requestKey,zh:q.get('lang')!=='en',valid:!!squeekBySku(sku)&&SQUEEK_REQUEST_KEY.test(requestKey)&&q.getAll('sku').length===1&&q.getAll('request').length===1};
}
/** Back to the game, carrying only the game's own purchase key so it can look the order up. */
export function squeekReturnUrl(requestKey:string|null){
 const u=new URL(SQUEEK_REDIRECT);if(requestKey&&SQUEEK_REQUEST_KEY.test(requestKey))u.searchParams.set('world_order',requestKey);return u.origin===SQUEEK_ORIGIN?u.href:SQUEEK_REDIRECT;
}
