import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authBudget} from '../worker/app.ts';
// AIMarket re-checks a research session on every protected read (8-10 per page load) and may not cache grants. Under
// AUTH_LIMITER's 20/min a paying day-pass user who reopened the hall within a minute was refused (full-site review).
const auth={limit:async()=>({success:true})},bridge={limit:async()=>({success:true})};

test('per-read session checks use the bridge budget; sign-in and token keys keep the auth budget',()=>{
 assert.equal(authBudget({AUTH_LIMITER:auth,BRIDGE_LIMITER:bridge},'aimarket:session:abc'),bridge);
 for(const key of ['aimarket:token:abc','aimarket:start:1.2.3.0','verify:ip:1.2.3.4','aimarket:sessionX'])assert.equal(authBudget({AUTH_LIMITER:auth,BRIDGE_LIMITER:bridge},key),auth,key);
 assert.equal(authBudget({AUTH_LIMITER:auth},'aimarket:session:abc'),auth,'without the binding (local runs) the auth budget still applies: never unthrottled');
 assert.equal(authBudget({},'aimarket:session:abc'),undefined,'no binding at all is reported, so the route fails closed');
});
test('wrangler binds BRIDGE_LIMITER with its own namespace and a budget above AUTH_LIMITER',()=>{
 const text=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
 const row=name=>{const m=text.match(new RegExp('"name": "'+name+'", "namespace_id": "(\\d+)", "simple": \\{ "limit": (\\d+), "period": 60 \\}'));assert.ok(m,name);return {ns:m[1],limit:Number(m[2])};};
 const b=row('BRIDGE_LIMITER'),a=row('AUTH_LIMITER');
 assert.ok(b.limit>a.limit&&b.limit<=180);assert.notEqual(b.ns,a.ns);
 const ids=[...text.matchAll(/"namespace_id": "(\d+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'namespace ids are unique');
});
