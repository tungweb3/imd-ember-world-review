import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FORTUNE_PRODUCTS,fortuneProduct,FORTUNE_PRICING_VERSION} from '../src/shared/fortunePricing.ts';

test('World and the Celestao backend publish the identical approved versioned catalogue',()=>{
 const catalogue=JSON.parse(readFileSync(new URL('../integrations/celestao/fortune_catalog.json',import.meta.url),'utf8'));
 assert.deepEqual(catalogue,{version:FORTUNE_PRICING_VERSION,products:FORTUNE_PRODUCTS});
});

test('the reviewed four single-system prices and complete-reading promotion use exact integer GOLD',()=>{
 assert.deepEqual(FORTUNE_PRODUCTS.map(p=>[p.system,p.gold,p.listGold]),[
  ['bazi','1000','1000'],['ziwei','1000','1000'],['annual_ziwei','1000','1000'],['western','800','800'],['human','600','600'],['profile','3000','3400']
 ]);
 const total=FORTUNE_PRODUCTS.filter(p=>!['profile','annual_ziwei'].includes(p.system)).reduce((sum,p)=>sum+BigInt(p.gold),0n);
 assert.equal(total,3400n);assert.equal(BigInt(fortuneProduct('profile').gold),3000n);
 assert.equal(total-BigInt(fortuneProduct('profile').gold),400n);
 assert.equal(fortuneProduct('fortune-profile'),fortuneProduct('profile'));
 assert.ok(Object.isFrozen(FORTUNE_PRODUCTS));for(const p of FORTUNE_PRODUCTS)assert.ok(Object.isFrozen(p));
});

test('unrecognised systems and inherited names cannot select a paid product or silently fall back to complete reading',()=>{
 for(const value of [null,undefined,0,1000,{},[],{system:'bazi'},'constructor','__proto__','toString','Bazi','bazi?gold=1','annual','fortune','research'])assert.equal(fortuneProduct(value),null);
 assert.equal(new Set(FORTUNE_PRODUCTS.map(p=>p.product)).size,6);
});

test('every product id passes the id rule the quote, the order parser and the admin form all apply',()=>{
 for(const p of FORTUNE_PRODUCTS)assert.match(p.product,/^[a-z][a-z0-9-]{0,63}$/);
 assert.equal(fortuneProduct('annual_ziwei').product,'fortune-annual-ziwei');
 assert.equal(fortuneProduct('fortune-annual-ziwei').system,'annual_ziwei');
 assert.equal(fortuneProduct('fortune-annual_ziwei'),null);
});
