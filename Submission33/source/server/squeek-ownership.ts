import type {D1Database} from './d1.ts';
import {SQUEEK_PRODUCTS} from '../src/shared/squeekCatalog.ts';

/** 鼠道修仙 cosmetics are one-time purchases. For the shared GOLD payment batch: true unless this order
 * is a cosmetic the same wallet already owns through another live paid order (delivery not failed or
 * refunded). It runs inside the debit's own transaction, so two tabs or two requests for one cosmetic
 * can never both be charged. Binds one value: the order id. Any other product passes. */
export const SQUEEK_PRODUCTS_JSON=JSON.stringify(SQUEEK_PRODUCTS);
export const SQUEEK_ONE_TIME_SQL=`NOT EXISTS(SELECT 1 FROM economy_orders oa JOIN world_gold_links la ON la.order_id=oa.id JOIN world_gold_products pa ON pa.id=la.product_id
 JOIN economy_orders ob ON ob.wallet=oa.wallet AND ob.id<>oa.id AND ob.status='paid' JOIN world_gold_links lb ON lb.order_id=ob.id JOIN world_gold_products pb ON pb.id=lb.product_id AND pb.product=pa.product
 LEFT JOIN world_gold_jobs jb ON jb.order_id=ob.id
 WHERE oa.id=? AND pa.product IN (SELECT value FROM json_each('${SQUEEK_PRODUCTS_JSON}')) AND COALESCE(jb.state,'queued') NOT IN ('failed','refunded'))`;
export async function squeekOwnedElsewhere(db:D1Database,orderId:string){
 return !(await db.prepare('SELECT '+SQUEEK_ONE_TIME_SQL+' ok').bind(orderId).first<{ok:number}>())?.ok;
}
