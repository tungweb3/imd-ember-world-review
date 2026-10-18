import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {backup} from 'node:sqlite';
import {createGoldLocalRuntime} from '../scripts/world-gold-local-runtime.mjs';
import {openGoldDatabase} from '../scripts/world-gold-local-db.mjs';
import {goldQuote,worldGoldSnapshot,reconcileWorldGold} from '../server/world-gold.ts';
import {createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import {initialLook} from '../../mint/shared-workbench/appearance.mjs';
test('actual private EVM payment → shared persistent GOLD → paid/free Mint → service/result/refund → DB reopen and backup restore',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ember-shared-gold-')),filename=join(dir,'state.sqlite'),r=await createGoldLocalRuntime({filename});
 try{
 const W=r.mint.addresses[1].toLowerCase(),now=()=>Date.now(),quote=product=>goldQuote({db:r.db,config:r.config,nowMs:now()},{wallet:W,requestId:crypto.randomUUID(),product});
 const id=await quote('gold-pack'),receipt=await r.pay(id,W);assert.match(receipt.transactionHash,/^0x[0-9a-f]{64}$/);assert.equal((await worldGoldSnapshot(r.db,W,now())).book,'10');
 await r.scan();assert.equal((await worldGoldSnapshot(r.db,W,now())).book,'10');
 const packet=(await r.mint.approval({wallet:'A',look:initialLook(),route:'paid'})).packet;
 assert.deepEqual((await r.mint.state()).wallets.find(w=>w.id==='A').gold,{book:'10',reserved:'1',available:'9'});
 await r.reopen();assert.equal((await worldGoldSnapshot(r.db,W,now())).reserved,'1');
 await r.mint.transaction({wallet:'A',action:'approve',submissionId:crypto.randomUUID()});await r.mint.transaction({wallet:'A',action:'mintPaid',packet,submissionId:crypto.randomUUID()});
 let snap=await worldGoldSnapshot(r.db,W,now());assert.deepEqual([snap.book,snap.reserved,snap.available],['9','0','9']);
 const free=(await r.mint.approval({wallet:'A',look:{...initialLook(),hat:'beanie'},route:'free'})).packet;await r.mint.transaction({wallet:'A',action:'mintFree',packet:free,submissionId:crypto.randomUUID()});assert.equal((await worldGoldSnapshot(r.db,W,now())).book,'9');
 const buyService=async(product,outcome)=>{const orderId=await quote(product),rid=crypto.randomUUID(),ch=await createEconomyGoldChallenge(r.db,r.config,{wallet:W,orderId,requestId:rid,origin:'http://127.0.0.1:8974',nowMs:now()});const signature=await r.mint.signers[1].signMessage(ch.message);await payEconomyOrderGold(r.db,r.config,{wallet:W,orderId,requestId:rid,signature,origin:'http://127.0.0.1:8974',nowMs:now()});await r.deliver(orderId,outcome);return orderId;};
 const report=await buyService('research','success');assert.equal((await worldGoldSnapshot(r.db,W,now())).book,'6');const failed=await buyService('fortune','failure');assert.equal((await worldGoldSnapshot(r.db,W,now())).book,'6');
 await reconcileWorldGold(r.db,now());assert.equal((await worldGoldSnapshot(r.db,W,now())).orders.find(o=>o.id===report).delivery,'delivered');assert.equal((await worldGoldSnapshot(r.db,W,now())).orders.find(o=>o.id===failed).delivery,'refunded');
 const cancel=(await r.mint.approval({wallet:'A',look:{...initialLook(),hat:'captain'},route:'paid'})).packet;await r.mint.cancelOrder({wallet:'A',orderId:cancel.goldAuthorization.orderId});assert.equal((await worldGoldSnapshot(r.db,W,now())).reserved,'0');
 await backup(r.db.raw,join(dir,'backup.sqlite'));const restored=openGoldDatabase(join(dir,'backup.sqlite'));try{assert.equal((await worldGoldSnapshot(restored,W,now())).book,'6');assert.equal(restored.raw.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.raw.prepare('PRAGMA foreign_key_check').all().length,0);}finally{restored.raw.close();}
 await r.reopen();assert.equal((await worldGoldSnapshot(r.db,W,now())).book,'6');assert.equal((await r.mint.state()).totalMinted,'2');
 }finally{await r.close();}
});
