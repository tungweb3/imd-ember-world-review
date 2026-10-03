// Probe: which budgets gate the keyed Alchemy reads that a caller holding nothing can cause, and what a missing limiter
// binding does. Real Worker handler (worker/app.ts createWorker via tests/wallet-harness.mjs), the harness's fake chain,
// synthetic keys, node:sqlite running this snapshot's migrations 0001 through 0006; no network, no real wallet.
// Usage (inside a copy of source/ after npm ci; see TESTS/README.md): cp ../TESTS/probes/keyed-reads-probe.mjs tests/_probe.mjs && node tests/_probe.mjs; rm tests/_probe.mjs
import {setup,newAccount,fakeChain} from './wallet-harness.mjs';
const asked=[];
const mk=(name,ok=()=>true)=>({async limit({key}){asked.push(name+'('+(key.startsWith('session:')?'session:<token-hash prefix>':key)+')');return {success:ok(key)};}});
const limiters=(chainOk,apiOk)=>({API_LIMITER:mk('API',apiOk),SEAT_LIMITER:mk('SEAT'),AUTH_LIMITER:mk('AUTH'),CHAIN_LIMITER:mk('CHAIN',chainOk)});
const rpcNames=(calls)=>calls.map(x=>x.url.includes('/nft/')?'getNFTsForOwner':JSON.parse(x.body??'{}').method);
const uniq=a=>[...new Set(a)].join(',')||'-';
const status=async r=>r.status+(r.status>=400?' '+(await r.clone().json()).error:'');
// The handler's refusal log (console.log, one JSON line per 429/503): captured here to show what a line carries.
const lines=[],log=console.log;const capture=async f=>{console.log=l=>{if(typeof l==='string'&&l.startsWith('{"evt"'))lines.push(l);else log(l);};try{return await f();}finally{console.log=log;}};

// 1) anonymous: one challenge for an EOA, then 5 verifies with a signature from ANOTHER synthetic key (valid ECDSA, wrong signer)
{
  const chain=fakeChain(),h=setup({chain,env:limiters()}),b=h.browser(undefined,undefined,'203.0.113.7');
  const acct=newAccount(),c=await (await b.post('/api/auth/challenge',{address:acct.address})).json();
  const bad=await newAccount().signMessage({message:c.message});
  asked.length=0;const before=chain.state.calls.length,codes=[];
  for(let i=0;i<5;i++)codes.push(await status(await b.post('/api/auth/verify',{nonce:c.nonce,signature:bad})));
  const good=await status(await b.post('/api/auth/verify',{nonce:c.nonce,signature:await acct.signMessage({message:c.message})}));
  const calls=chain.state.calls.slice(before);
  console.log('1) EOA, 5 bad verifies:',codes.join(' | '),'|| then the RIGHT signature on the same nonce:',good);
  console.log('   keyed chain calls:',calls.length,uniq(rpcNames(calls)),'| Authorization header set:',calls.every(x=>x.headers.get('authorization')==='Bearer test-alchemy-key'),'| buckets:',uniq(asked));
  const row=h.db.raw.prepare('SELECT net,checked_at IS NOT NULL AS checked,called_at IS NOT NULL AS called,invalidated_at IS NOT NULL AS burnt,used_at FROM login_challenges WHERE nonce=?').get(c.nonce);
  console.log('   challenge row:',JSON.stringify(row));
  // a second challenge for the same EOA, bad signature again: the isolate's "no code" answer (60 s) spares the chain and the claim
  const c2=await (await b.post('/api/auth/challenge',{address:acct.address})).json();asked.length=0;const before2=chain.state.calls.length;
  const again=await status(await b.post('/api/auth/verify',{nonce:c2.nonce,signature:await newAccount().signMessage({message:c2.message})}));
  const row2=h.db.raw.prepare('SELECT checked_at IS NOT NULL AS checked,invalidated_at IS NOT NULL AS burnt FROM login_challenges WHERE nonce=?').get(c2.nonce);
  console.log('   same EOA, next challenge, bad signature:',again,'| keyed chain calls:',chain.state.calls.length-before2,'| buckets:',uniq(asked),'| row:',JSON.stringify(row2));
}
// 1b) a contract address (the fake chain gives it code; its isValidSignature rejects): the full ERC-1271 path, once per challenge
{
  const chain=fakeChain(),h=setup({chain,env:limiters()}),b=h.browser(undefined,undefined,'203.0.113.8');
  const contract='0x'+'ab'.repeat(20);chain.state.contracts.set(contract,()=>'0xffffffff');
  const c=await (await b.post('/api/auth/challenge',{address:contract})).json();asked.length=0;const before=chain.state.calls.length;
  const codes=[];for(let i=0;i<3;i++)codes.push(await status(await b.post('/api/auth/verify',{nonce:c.nonce,signature:await newAccount().signMessage({message:c.message})})));
  const row=h.db.raw.prepare('SELECT checked_at IS NOT NULL AS checked,called_at IS NOT NULL AS called,invalidated_at IS NOT NULL AS burnt FROM login_challenges WHERE nonce=?').get(c.nonce);
  console.log('1b) contract, 3 bad verifies:',codes.join(' | '),'| keyed chain calls:',uniq(rpcNames(chain.state.calls.slice(before))),chain.state.calls.length-before,'| buckets:',uniq(asked),'| row:',JSON.stringify(row));
}
// 1c) the same contract path with 'chain:code' refused (API_LIMITER key chain:code): 429 before any keyed read, logged
{
  const chain=fakeChain(),h=setup({chain,env:limiters(undefined,k=>k!=='chain:code')}),b=h.browser(undefined,undefined,'203.0.113.9');
  const contract='0x'+'cd'.repeat(20);chain.state.contracts.set(contract,()=>'0x1626ba7e');
  const c=await (await b.post('/api/auth/challenge',{address:contract})).json();const before=chain.state.calls.length;
  const r=await capture(async()=>status(await b.post('/api/auth/verify',{nonce:c.nonce,signature:await newAccount().signMessage({message:c.message})})));
  console.log('1c) chain:code refused: verify',r,'| keyed chain calls:',chain.state.calls.length-before,'| log line:',lines.at(-1));
}
// 2) a self-made session (fresh synthetic key, holds nothing) reading /api/me/home?fresh=1, CHAIN_LIMITER allowing
{
  const chain=fakeChain(),h=setup({chain,env:limiters()}),b=h.browser(undefined,undefined,'198.51.100.7');
  asked.length=0;const s=await b.signIn(newAccount());const signInBuckets=uniq(asked);asked.length=0;const before=chain.state.calls.length;
  const home=await b.get('/api/me/home?fresh=1'),hb=await home.clone().json();
  console.log('2) sign-in',s.verify.status,'(buckets: '+signInBuckets+') | home',home.status,'recheck='+(hb.recheck??'-'),'| keyed chain calls:',uniq(rpcNames(chain.state.calls.slice(before))),'| buckets:',uniq(asked));
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
  const prod=await capture(async()=>status(await h.browser().post('/api/auth/challenge',{address:newAccount().address})));const prodLine=lines.at(-1);
  const loop=await status(await h.browser('http://127.0.0.1:8792').post('/api/auth/challenge',{address:newAccount().address}));
  const h2=setup({env:{...limiters(),API_LIMITER:undefined}});
  const world=await status(await h2.browser().get('/api/world/snapshot'));
  console.log('5) AUTH_LIMITER missing: challenge on https://imdember.com ->',prod,'| on http://127.0.0.1:8792 ->',loop,'|| API_LIMITER missing: /api/world/snapshot ->',world);
  console.log('   log line:',prodLine);
}
// 6) logout and logout-all never spend a limiter, even when every limiter refuses
{
  const h=setup({env:limiters(()=>true)}),b=h.browser(undefined,undefined,'192.0.2.10');await b.signIn(newAccount());
  const deny={limit:async()=>({success:false})};h.env.API_LIMITER=deny;h.env.AUTH_LIMITER=deny;h.env.SEAT_LIMITER=deny;h.env.CHAIN_LIMITER=deny;asked.length=0;
  const all=await status(await b.post('/api/auth/logout-all',{})),one=await status(await b.post('/api/auth/logout',{}));
  console.log('6) every limiter refusing: logout-all ->',all,'| logout ->',one);
}
