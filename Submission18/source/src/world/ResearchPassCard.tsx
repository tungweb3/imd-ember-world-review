import {researchPassTerms,utcMinute} from './researchPassCopy.ts';
export type ResearchPassProduct={id:string;product:string;version:number;title:string;gold:string;serviceable?:boolean};
/** Sale card for the 24-hour AIMarket day pass: terms are always shown next to the price and the order button. */
export function ResearchPassCard({product,pass,zh,busy,disabled,insufficient=false,onCreate}:{product:ResearchPassProduct;pass:{active:boolean;endsMs:number}|null|undefined;zh:boolean;busy:boolean;disabled:boolean;insufficient?:boolean;onCreate:()=>void}){
 const active=!!pass?.active;
 // An order the wallet cannot pay would block a new one for its whole 15-minute life (PASS_ORDER_PENDING).
 return <article className="gold-pass" data-product={product.product}><h2>{product.title}</h2><p>{product.gold} GOLD</p><small>v{product.version}</small>
  <small className="gold-pass-terms" style={{display:'block',margin:'8px 0 12px'}}>{researchPassTerms(zh,product.gold)}</small>
  {active&&pass&&<p role="status">{zh?'通行證有效至 ':'Pass active until '}{utcMinute(pass.endsMs)}{zh?'；到期後才能再次購買。':'. You can buy another after it ends.'}</p>}
  {product.serviceable===false&&<p role="status">{zh?'此服務暫時無法提供，目前不接受新訂單。':'This service is temporarily unavailable; new orders are disabled.'}</p>}
  {insufficient&&!active&&<p role="status">{zh?`GOLD 不足：需要 ${product.gold} GOLD，請先在上方購買點數，再購買通行證。`:`Not enough GOLD: ${product.gold} GOLD is needed. Buy GOLD above first, then the pass.`}</p>}
  <button disabled={busy||disabled||active||product.serviceable===false} onClick={onCreate}>{active?(zh?'通行證有效中':'Pass active'):(zh?'建立訂單':'Create order')}</button></article>;
}
