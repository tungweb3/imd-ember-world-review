// Probe: which budgets gate the keyed Alchemy reads that a caller holding nothing can cause, and what a missing limiter
// binding does. Real Worker handler (worker/app.ts createWorker via tests/wallet-harness.mjs), the harness's fake chain,
// synthetic keys, node:sqlite running migrations/0001 + 0002; no network, no real wallet.
// Usage (inside source/, after npm ci): cp ../TESTS/probes/keyed-reads-probe.mjs tests/_probe.mjs && node tests/_probe.mjs; rm tests/_probe.mjs
import {setup,newAccount,fakeChain} from './wallet-harness.mjs';
const asked=[];
const mk=(name,ok=()=>true)=>({async limit({key}){asked.push(name+'('+(key.startsWith('session:')?'session:<token-hash prefix>':key)+')');return {success:ok(key)};}});
const limiters=(chainOk)=>({API_LIMITER:mk('API'),SEAT_LIMITER:mk('SEAT'),AUTH_LIMITER:mk('AUTH'),CHAIN_LIMITER:mk('CHAIN',chainOk)});
const rpcNames=(calls)=>calls.map(x=>x.url.includes('/nft/')?'getNFTsForOwner':JSON.parse(x.body??'{}').method);
const uniq=a=>[...new Set(a)].join(',')||'-';
const status=async r=>r.status+(r.status>=400?' '+(await r.clone().json()).error:'');

// 1) anonymous: one challenge, then 5 verifies with a signature from ANOTHER synthetic key (valid ECDSA, wrong signer)
{
  const chain=fakeChain(),h=setup({chain,env:limiters()}),b=h.browser(undefined,undefined,'203.0.113.7');
  const acct=newAccount(),c=await (await b.post('/api/auth/challenge',{address:acct.address})).json();
  const bad=await newAccount().signMessage({message:c.message});
  asked.length=0;const before=chain.state.calls.length,codes=[];
  for(let i=0;i<5;i++)codes.push(await status(await b.post('/api/auth/verify',{nonce:c.nonce,signature:bad})));
  const good=await status(await b.post('/api/auth/verify',{nonce:c.nonce,signature:await acct.signMessage({message:c.message})}));
  const calls=chain.state.calls.slice(before);
  console.log('1) 5 bad verifies:',codes.join(' | '),'|| then the RIGHT signature on the same nonce:',good);
  console.log('   keyed chain calls:',calls.length,uniq(rpcNames(calls)),'| Authorization header set:',calls.every(x=>x.headers.get('authorization')==='Bearer test-alchemy-key'),'| buckets:',uniq(asked));
  const row=h.db.raw.prepare('SELECT net,checked_at IS NOT NULL AS checked,invalidated_at IS NOT NULL AS burnt,used_at FROM login_challenges WHERE nonce=?').get(c.nonce);
  console.log('   challenge row:',JSON.stringify(row));
}
// 2) a self-made session (fresh synthetic key, holds nothing) reading /api/me/home?fresh=1, CHAIN_LIMITER allowing
{
  const chain=fakeChain(),h=setup({chain,env:limiters()}),b=h.browser(undefined,undefined,'198.51.100.7');
  const s=await b.signIn(newAccount());asked.length=0;const before=chain.state.calls.length;
  const home=await b.get('/api/me/home?fresh=1'),hb=await home.clone().json();
  console.log('2) sign-in',s.verify.status,'| home',home.status,'recheck='+(hb.recheck??'-'),'| keyed chain calls:',uniq(rpcNames(chain.state.calls.slice(before))),'| buckets:',uniq(asked));
}
// 3) the same with CHAIN_LIMITER refusing chain:index
{
  const chain=fakeChain(),h=setup({chain,env:limiters(k=>k!=='chain:index')}),b=h.browser(undefined,undefined,'198.51.100.8');
  await b.signIn(newAccount());asked.length=0;const before=chain.state.calls.length;
  const home=await b.get('/api/me/home?fresh=1'),hb=await home.clone().json();
  console.log('3) chain:index refused: home',home.status,'recheck='+(hb.recheck??'-'),'seats='+hb.seats.length,'| keyed chain calls:',chain.state.calls.length-before,'| buckets:',uniq(asked));
}
// 4) the public assets route for a random address
{
  const chain=fakeChain(),h=setup({chain,env:limiters()});asked.length=0;
  const a=await h.browser().get('/api/wallet/'+newAccount().address+'/assets');
  console.log('4) assets',a.status,'| keyed chain calls:',chain.state.calls.length,'| buckets:',uniq(asked));
}
// 5) a deployment missing a limiter binding, on the production URL and on a loopback URL
{
  const h=setup({env:{...limiters(),AUTH_LIMITER:undefined}});
  const prod=await status(await h.browser().post('/api/auth/challenge',{address:newAccount().address}));
  const loop=await status(await h.browser('http://127.0.0.1:8792').post('/api/auth/challenge',{address:newAccount().address}));
  const h2=setup({env:{...limiters(),API_LIMITER:undefined}});
  const world=await status(await h2.browser().get('/api/world/snapshot'));
  console.log('5) AUTH_LIMITER missing: challenge on https://imdember.com ->',prod,'| on http://127.0.0.1:8792 ->',loop,'|| API_LIMITER missing: /api/world/snapshot ->',world);
}
