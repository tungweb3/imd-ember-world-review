import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openD1} from './d1-sqlite.mjs';
import {FORTUNE_PRODUCTS,FORTUNE_PRICING_VERSION} from '../src/shared/fortunePricing.ts';
const controls=db=>JSON.stringify(db.prepare('SELECT feature,enabled,version FROM world_gold_controls ORDER BY feature').all());
function fixture(t){const d=openD1();t.after(()=>d.raw.close());d.raw.exec("UPDATE world_gold_controls SET enabled=CASE WHEN feature='topup' THEN 1 ELSE 0 END");return d.raw;}
function enable(db,before=controls(db)){db.prepare('INSERT INTO celestao_release_actions(id,actor,catalogue,created_ms,before_json) VALUES(?,?,?,?,?)').run('synthetic-release','authorized-deployment',FORTUNE_PRICING_VERSION,1792886400000,before);}
test('release activation atomically enables exactly the approved catalogue while leaving topup, mint and all balances intact',t=>{
 const db=fixture(t);enable(db);
 assert.deepEqual(db.prepare('SELECT product,CAST(gold AS TEXT) gold,version,kind,enabled FROM world_gold_products ORDER BY product').all().map(r=>({...r})),FORTUNE_PRODUCTS.filter(p=>p.system!=='annual_ziwei').map(p=>({product:p.product,gold:p.gold,version:p.version,kind:'service',enabled:1})).sort((a,b)=>a.product.localeCompare(b.product)));
 assert.deepEqual(db.prepare('SELECT feature,enabled FROM world_gold_controls ORDER BY feature').all().map(r=>({...r})),[{feature:'mint',enabled:0},{feature:'service',enabled:1},{feature:'topup',enabled:1}]);
 for(const name of ['economy_orders','economy_gold_accounts','economy_gold_journal','world_gold_entries'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+name).get().n,0);
 assert.throws(()=>enable(db),/CELESTAO_RELEASE_BASELINE_CHANGED/);
 assert.throws(()=>db.exec("DELETE FROM celestao_release_actions"),/IMMUTABLE_RELEASE_ACTION/);
});
test('stale control snapshots and an enabled unrelated service abort the complete release without partial products or activation',t=>{
 const db=fixture(t);assert.throws(()=>enable(db,'[]'),/CELESTAO_RELEASE_BASELINE_CHANGED/);
 db.prepare("INSERT INTO world_gold_products VALUES('research-v1','research',1,'service','Unrelated',1,NULL,1,1)").run();
 assert.throws(()=>enable(db),/CELESTAO_RELEASE_BASELINE_CHANGED/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM world_gold_products WHERE product LIKE 'fortune-%'").get().n,0);
 assert.equal(db.prepare("SELECT enabled FROM world_gold_controls WHERE feature='service'").get().enabled,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM celestao_release_actions').get().n,0);
});
test('the annual product is installed by its migration only where the first five already are, exactly as the checkout accepts it',t=>{
 const db=fixture(t),sql=readFileSync(new URL('../migrations/0023_celestao_annual_ziwei.sql',import.meta.url),'utf8').match(/INSERT INTO world_gold_products[^;]+;/)[0];
 const row=()=>db.prepare("SELECT product,CAST(gold AS TEXT) gold,version,kind,enabled FROM world_gold_products WHERE product='fortune-annual-ziwei'").all().map(r=>({...r}));
 db.exec(sql);assert.deepEqual(row(),[]);
 enable(db);db.exec(sql);
 const p=FORTUNE_PRODUCTS.find(x=>x.system==='annual_ziwei');
 assert.deepEqual(row(),[{product:p.product,gold:p.gold,version:p.version,kind:'service',enabled:1}]);
});
