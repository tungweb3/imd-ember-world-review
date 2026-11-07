// Owner decision 2026-11-04. migrations/0024_world_gold_grants.sql enforces the same numbers in the database.
export const GOLD_GRANT_MAX=5000;
export const GOLD_GRANT_DAILY=20000;
// Rows cannot be pruned and every one enters a recovery plan, whose size is limited: keep the count bounded as well.
export const GOLD_GRANT_DAILY_COUNT=100;
export const GOLD_GRANT_WINDOW_MS=86400000;
export const GOLD_GRANT_DUPLICATE_MS=600000;
// A signed grant is good for at most this long. The page asks for half of it, which leaves room for a clock a few minutes out.
export const GOLD_GRANT_SIGNATURE_MS=600000;
export const GOLD_GRANT_SIGNATURE_ASK_MS=300000;
/** What the wallet shows and signs for one grant. The reason is JSON so it cannot add a line. No crypto here: this runs in the page too. */
export function goldGrantMessage(g:{origin:string;admin:string;to:string;gold:string;reason:string;requestId:string;expiresMs:number}){
 return ['IMD Ember World administrator GOLD grant','This creates GOLD that cannot be taken back.','Origin: '+g.origin,'Administrator: '+g.admin.toLowerCase(),'Recipient: '+g.to.toLowerCase(),'GOLD: '+g.gold,'Reason: '+JSON.stringify(g.reason).replace(/[\u0085\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')),'Request ID: '+g.requestId,'Valid until: '+new Date(g.expiresMs).toISOString(),'Valid until (ms): '+g.expiresMs].join('\n');
}
