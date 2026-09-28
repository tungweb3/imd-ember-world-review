import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain,windowLimiter,openLimiter} from './wallet-harness.mjs';
import {AuthClient,statusOf,ownerAddress,statusText,chipText,noticeText,watchOwner,OWNER_RECHECK_MS} from '../src/world/auth.ts';
import {seatRows,countsText,eligibleText,markedHome,markerLabel} from '../src/world/walletView.ts';
import {ERC6492_SUFFIX} from '../server/auth.ts';
import {readMoves,commitMove,moveGate,moveHint,movesKey} from '../src/world/moves.ts';
import {WalletRegistry,announced,unidentifiedNote} from '../src/world/wallet.ts';
// The browser side of sign-in (src/world/auth.ts) driven against the real Worker (createWorker → handleAccountApi over
// the real migration on node:sqlite). The wallet is a fake EIP-1193 provider that personal_signs the exact bytes it is
// handed with a key generated for this run; the cookie jar is one browser profile. Every expectation is what the server
// answered or what the wallet was asked to do, never a recomputation.
const DAY=86_400_000;
const owners=(n,map)=>Object.assign(Array(n).fill('0x'+'0'.repeat(40)),map);
function world({swarm={},online=[361,921],chain={}}={}){
  return setup({imd:fakeImd({seats:{361:'51320',921:'51311',77:'50001'},owners:owners(2000,swarm),online}),chain:fakeChain({owners:chain})});
}
/** A fake wallet: accounts it can switch between, a counter of signatures asked, rejection and a gate to hold a signature. */
function fakeWallet(account){
  const w={account,granted:false,asked:[],signed:0,reject:false,gate:null,listeners:new Set(),
    async request({method,params}){w.asked.push(method);
      if(method==='eth_accounts')return w.granted?[w.account.address]:[];
      if(method==='eth_requestAccounts'){w.granted=true;return [w.account.address];}
      if(method==='personal_sign'){const signer=w.signAs??w.account;if(!w.signAs)assert.equal(params[1].toLowerCase(),signer.address.toLowerCase());
        if(w.gate)await w.gate;if(w.reject)throw Object.assign(new Error('User rejected'),{code:4001});
        w.signed++;const sig=await signer.signMessage({message:{raw:params[0]}});return w.wrap?w.wrap(sig):sig;}
      throw new Error('unsupported '+method);},
    events:{},on(e,fn){(w.events[e]??=new Set()).add(fn);if(e==='accountsChanged')w.listeners.add(fn);},removeListener(e,fn){w.events[e]?.delete(fn);w.listeners.delete(fn);},
    emit(e,v){for(const fn of w.events[e]??[])fn(v);},
    switchTo(next){w.account=next;for(const fn of w.listeners)fn([next.address]);}};
  return w;
}
const memoryHint=()=>{let v=null;return {get:()=>v,set:x=>{v=x;}};};
/** One tab: the client wired to the Worker through a browser profile `b`; `calls` lists every request path it made.
 *  `drop(path)` true makes that request fail like a lost connection (fetch throws before it reaches the Worker). */
function tab(w,b,wallet,{hint=memoryHint(),channel=null,hold=null,holdReply=null,drop=null,registry=null,rewrite=null}={}){
  const calls=[];
  const fetch=async(path,init={})=>{calls.push((init.method??'GET')+' '+path);if(hold)await hold(path);if(drop?.(path))throw new TypeError('Failed to fetch');
    const r=await b.send(b.request(path,{method:init.method??'GET',body:init.body,headers:init.headers}));if(holdReply)await holdReply(path);b.keep(r);return rewrite?rewrite(path,r):r;};
  const client=new AuthClient({fetch,provider:registry?()=>registry.current():()=>wallet,onProviderChange:registry?fn=>registry.subscribe(fn):undefined,
    hint,now:w.clock.now,channel:channel&&(()=>new BroadcastChannel(channel))});
  const seen=[];client.subscribe(()=>{const s=statusOf(client.state);if(seen.at(-1)!==s)seen.push(s);});
  return {client,calls,seen,hint,stop:client.start()};
}
const settle=()=>new Promise(r=>setTimeout(r,20));
const posts=(calls,p)=>calls.filter(c=>c==='POST '+p).length;

test('first sign-in asks for exactly one signature, goes connect → sign → verify → owner, and a double click starts one flow',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a,921:a},chain:{361:a,921:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await settle();
  assert.equal(statusOf(t.client.state),'visitor');
  await Promise.all([t.client.signIn(),t.client.signIn(),t.client.signIn()]);
  assert.equal(wallet.signed,1);assert.equal(posts(t.calls,'/api/auth/challenge'),1);assert.equal(posts(t.calls,'/api/auth/verify'),1);
  assert.deepEqual(wallet.asked.filter(m=>m!=='eth_accounts'),['eth_requestAccounts','personal_sign'],'one wallet prompt of each kind');
  assert.deepEqual(t.seen,['visitor','connected','awaitingSignature','verifying','owner']);
  assert.equal(ownerAddress(t.client.state),a);assert.equal(t.client.state.home.eligible,2);assert.equal(t.client.state.home.size,'ms');
  assert.deepEqual(t.client.state.home.seats.map(s=>[s.tokenId,s.online,s.counts]),[['361',true,true],['921',true,true]]);
  assert.ok(b.jar.has('__Host-imd_session'));
  // Signed in already: a second click re-reads the house and signs nothing.
  await t.client.signIn();assert.equal(wallet.signed,1);assert.equal(posts(t.calls,'/api/auth/challenge'),1);
  t.stop();
});

test('a reload restores the session from the cookie with no signature and no challenge, even when the click comes first',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const first=tab(w,b,wallet);await first.client.signIn();first.stop();assert.equal(wallet.signed,1);
  const again=tab(w,b,wallet);await again.client.signIn();          // clicked before the session read came back
  assert.equal(statusOf(again.client.state),'owner');assert.equal(wallet.signed,1);
  assert.equal(posts(again.calls,'/api/auth/challenge'),0);assert.equal(wallet.asked.filter(m=>m==='personal_sign').length,1);
  const quiet=tab(w,b,wallet);await settle();
  assert.equal(statusOf(quiet.client.state),'owner');assert.deepEqual(quiet.calls,['GET /api/auth/session','GET /api/me/home?fresh=1']);
  again.stop();quiet.stop();
});

test('a rejected signature leaves a visitor with the owner-less notice, and nothing is retried by itself',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  wallet.reject=true;const t=tab(w,b,wallet);await t.client.signIn();await settle();await settle();
  assert.equal(statusOf(t.client.state),'connected');assert.equal(t.client.state.notice,'sign-rejected');assert.equal(ownerAddress(t.client.state),null);
  assert.equal(wallet.asked.filter(m=>m==='personal_sign').length,1);assert.equal(posts(t.calls,'/api/auth/verify'),0);
  assert.equal(noticeText('sign-rejected',(zh)=>zh),'尚未完成登入驗證，暫不能以屋主身分入住。');
  assert.equal((await b.get('/api/me/home')).status,401);
  t.stop();
});

test('switching A → B turns owner mode off at once and ends A at the server; B is merely connected',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state),'owner');
  const oldJar=new Map(b.jar);
  wallet.switchTo(B);
  assert.equal(statusOf(t.client.state),'connected');assert.equal(ownerAddress(t.client.state),null);assert.equal(t.client.state.account,B.address.toLowerCase());
  await settle();
  const stale=w.browser();stale.jar=oldJar;
  assert.equal((await stale.get('/api/me/home')).status,401,'A’s old cookie is revoked, not merely forgotten');
  assert.equal(wallet.signed,1,'no signature was asked for B');
  t.stop();
});

test('A’s signature arriving after the switch to B is never sent to verify',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  let release;wallet.gate=new Promise(r=>release=r);
  const t=tab(w,b,wallet),flow=t.client.signIn();
  while(statusOf(t.client.state)!=='awaitingSignature')await settle();
  wallet.switchTo(B);release();await flow;await settle();
  assert.equal(posts(t.calls,'/api/auth/verify'),0);assert.equal(statusOf(t.client.state),'connected');
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
  t.stop();
});

for(const when of ['before','after'])test(`A’s verify held ${when} the server answers, then the switch to B: dropped, and no session of A survives`,async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  let release,held;const gate=new Promise(r=>release=r),wait=async p=>{if(p==='/api/auth/verify'){held=true;await gate;}};
  // before: the logout reaches the server first and the verify is refused (409); after: the server already made A's
  // session while the logout went out without its cookie, so the client must log the late cookie out itself.
  const t=tab(w,b,wallet,when==='before'?{hold:wait}:{holdReply:wait}),flow=t.client.signIn();
  while(!held)await settle();
  wallet.switchTo(B);await settle();release();await flow;await settle();await settle();
  assert.equal(statusOf(t.client.state),'connected');assert.equal(t.client.state.session,null);
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false,'the late session was logged out');
  assert.equal((await b.get('/api/me/home')).status,401);
  t.stop();
});

test('a wallet with no IMD seat is signed in with no house, and a failing chain read is a different state',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();
  assert.equal(statusOf(t.client.state),'signedInNoHouse');assert.equal(t.client.state.home.eligible,0);assert.equal(ownerAddress(t.client.state),null);
  t.stop();
  const C=newAccount(),c=C.address.toLowerCase(),w2=world({swarm:{361:c},chain:{361:c}}),b2=w2.browser(),wallet2=fakeWallet(C);
  w2.chain.state.fail='http';
  const u=tab(w2,b2,wallet2);await u.client.signIn();
  assert.equal(statusOf(u.client.state),'ownershipUnavailable');assert.equal(u.client.state.home,'unavailable');assert.equal(ownerAddress(u.client.state),null);
  const say=(zh,en)=>en;
  assert.notEqual(statusText('ownershipUnavailable',u.client.state,say),statusText('signedInNoHouse',t.client.state,say));
  // The chain recovers: the refresh button (force) makes the same session an owner, with no new signature.
  w2.chain.state.fail=null;w2.clock.advance(31_000);await u.client.refreshHome(true);
  assert.equal(statusOf(u.client.state),'owner');assert.equal(wallet2.signed,1);
  u.stop();
});

test('after 7 days the session is expired, on the next check and on the next visit; signing in again needs one signature',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),hint=memoryHint();
  const t=tab(w,b,wallet,{hint});await t.client.signIn();assert.equal(statusOf(t.client.state),'owner');
  w.clock.advance(7*DAY);await t.client.refreshHome(true);
  assert.equal(statusOf(t.client.state),'expired');assert.equal(ownerAddress(t.client.state),null);
  t.stop();
  const next=tab(w,w.browser(),fakeWallet(A),{hint:(()=>{const h=memoryHint();h.set({address:a,expiresAt:w.clock.now()-1});return h;})()});await settle();
  assert.equal(statusOf(next.client.state),'expired');next.stop();
  const again=tab(w,b,wallet,{hint});await settle();await again.client.signIn();
  assert.equal(statusOf(again.client.state),'owner');assert.equal(wallet.signed,2);again.stop();
});

test('tabs follow each other through the channel by re-reading the server, and a forged message changes nothing',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),name='imd-auth-test-'+Math.random();
  wallet.granted=true;                                               // the site was granted before: both tabs see the account
  const hint=memoryHint(),one=tab(w,b,wallet,{hint,channel:name}),two=tab(w,b,wallet,{hint,channel:name});await settle();
  await one.client.signIn();await settle();await settle();
  assert.equal(statusOf(two.client.state),'owner');assert.equal(wallet.signed,1);
  const forger=new BroadcastChannel(name);forger.postMessage({kind:'signed-in',address:'0x'+'1'.repeat(40)});await settle();await settle();
  assert.equal(two.client.state.session.address,a,'the address comes from the server, not the message');
  await one.client.signOut();await settle();await settle();
  assert.equal(two.client.state.session,null);assert.equal(statusOf(two.client.state),'connected');
  forger.close();one.stop();two.stop();
});

test('a visit whose wallet is on another account than the session is a mismatch until signed in again as that account',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase();
  const w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();t.stop();
  wallet.account=B;                                                   // switched while no page was open
  const u=tab(w,b,wallet);await settle();await settle();
  assert.equal(statusOf(u.client.state),'mismatch');assert.equal(ownerAddress(u.client.state),null);
  assert.match(statusText('mismatch',u.client.state,(zh,en)=>en),new RegExp(bAddr.slice(0,6)));
  await u.client.signIn();
  assert.equal(statusOf(u.client.state),'owner');assert.equal(u.client.state.session.address,bAddr);assert.equal(wallet.signed,2);
  u.stop();
});

test('every state has its own chip and status wording in both languages',()=>{
  const home={eligible:3,seats:[],size:'ms'},base={account:'0x'+'a'.repeat(40),session:{address:'0x'+'a'.repeat(40),expiresAt:1},home};
  const states=['visitor','connected','awaitingSignature','verifying','owner','signedInNoHouse','expired','ownershipUnavailable','mismatch'];
  for(const lang of [(zh)=>zh,(zh,en)=>en]){
    const status=states.map(s=>statusText(s,{...base,account:'0x'+'b'.repeat(40)},lang)),chip=states.map(s=>chipText(s,base,lang));
    assert.equal(new Set(status).size,9);assert.equal(new Set(chip).size,9);
    for(const c of chip)assert.ok(c.length<=18,c);
  }
});

// SEC-1 / CORR-01: sign-out reported success while the logout was refused, so the cookie and the server session survived.
test('sign out ends the page’s session only when the server revoked it; a lost logout keeps it, says so, and a retry works',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  let lose=true;const t=tab(w,b,wallet,{drop:p=>p==='/api/auth/logout'&&lose});await t.client.signIn();
  assert.equal(statusOf(t.client.state),'owner');
  await t.client.signOut();
  assert.equal(statusOf(t.client.state),'owner','still signed in: the server never heard the sign-out');
  assert.equal(t.client.state.notice,'signout-failed');assert.ok(b.jar.has('__Host-imd_session'));
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,true);
  lose=false;await t.client.signOut();
  assert.equal(statusOf(t.client.state),'connected');assert.equal(t.client.state.notice,null);assert.ok(!b.jar.has('__Host-imd_session'));
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,0);
  t.stop();
});

test('with the sign-in bucket drained by cross-site reads (the reported attack), Sign out still revokes and a reload stays signed out',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const b=w.browser(),wallet=fakeWallet(A),t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state),'owner');
  for(let i=0;i<24;i++)await w.call(new Request('https://imdember.com/api/me/home'));   // <img src=/api/me/home> x24 from another site
  await t.client.signOut();
  assert.equal(statusOf(t.client.state),'connected');assert.equal(t.client.state.notice,null);t.stop();
  const reload=tab(w,b,wallet);await settle();
  assert.equal(statusOf(reload.client.state),'connected');assert.equal(reload.client.state.session,null);reload.stop();
});

test('an account switch whose logout is lost shows the old session as a mismatch, never as signed out',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet,{drop:p=>p==='/api/auth/logout'});await t.client.signIn();
  wallet.switchTo(B);assert.equal(ownerAddress(t.client.state),null,'owner mode ends at once');
  await settle();await settle();
  assert.equal(statusOf(t.client.state),'mismatch');assert.equal(t.client.state.session.address,a);
  t.stop();
});

// CORR-02: a failed session read at load made the next click ask for a second signature while a valid session existed.
for(const how of ['429','network'])test(`a reload whose session read fails (${how}) never asks for a signature while the session is valid`,async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const first=tab(w,b,wallet);await first.client.signIn();first.stop();assert.equal(wallet.signed,1);
  let failing=true;
  if(how==='429')w.env.API_LIMITER={limit:async()=>({success:!failing})};
  const t=tab(w,b,wallet,{drop:p=>how==='network'&&failing&&p==='/api/auth/session'});await settle();
  assert.equal(t.client.state.sessionKnown,false);
  // Still failing at the click: nothing is signed, nothing is asked of the server but the session again.
  await t.client.signIn();
  assert.equal(wallet.signed,1);assert.equal(posts(t.calls,'/api/auth/challenge'),0);
  assert.equal(t.client.state.notice,how==='429'?'rate-limited':'session-unknown');
  failing=false;await t.client.signIn();                              // the read works again: the session is found, no signature
  assert.equal(statusOf(t.client.state),'owner');assert.equal(wallet.signed,1);assert.equal(posts(t.calls,'/api/auth/challenge'),0);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,1);
  t.stop();
});

// CORR-05: re-checks refused with 429 kept owner mode on with an arbitrarily old answer, even for a sold seat.
test('owner mode ends when every re-check has failed for longer than 3 minutes, and comes back when one succeeds',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state),'owner');
  w.chain.state.owners[361]='0x'+'9'.repeat(40);w.env.AUTH_LIMITER={limit:async()=>({success:false})};   // sold; re-checks refused
  const states=[];
  for(let m=1;m<=5;m++){w.clock.advance(OWNER_RECHECK_MS);await t.client.refreshHome();states.push(statusOf(t.client.state));}
  assert.deepEqual(states,['owner','owner','owner','ownershipUnavailable','ownershipUnavailable']);
  assert.equal(ownerAddress(t.client.state),null);assert.equal(t.client.state.session.address,a,'still signed in');
  w.env.AUTH_LIMITER=openLimiter();w.clock.advance(OWNER_RECHECK_MS);await t.client.refreshHome();
  assert.equal(statusOf(t.client.state),'signedInNoHouse');
  t.stop();
});

test('a smart wallet whose check the server\'s chain budget refused gets the busy notice, and its next click signs in',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),smart='0x'+'ab'.repeat(20);let allowed=false;wallet.signAs=A;
  w.chain.state.contracts.set(smart,()=>'0x1626ba7e');w.env.CHAIN_LIMITER={limit:async()=>({success:allowed})};
  const t=tab(w,b,{...wallet,request:async q=>q.method==='eth_requestAccounts'||q.method==='eth_accounts'?[smart]:wallet.request(q)});
  await t.client.signIn();
  assert.deepEqual([t.client.state.notice,statusOf(t.client.state)],['busy','connected']);
  assert.match(noticeText('busy',(zh,en)=>en),/busy right now/);
  allowed=true;await t.client.signIn();assert.equal(t.client.state.session.address,smart);
  t.stop();
});

// CORR-06: an ERC-6492 signature (undeployed smart account) got the generic "try again".
test('an undeployed smart account gets its own notice, and one verify only',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A);wallet.wrap=sig=>sig+'00'.repeat(32)+ERC6492_SUFFIX;
  const t=tab(w,b,wallet);await t.client.signIn();
  assert.equal(t.client.state.notice,'unsupported-wallet');assert.equal(posts(t.calls,'/api/auth/verify'),1);
  assert.match(noticeText('unsupported-wallet',(zh,en)=>en),/isn’t supported/);assert.notEqual(noticeText('unsupported-wallet',zh=>zh),noticeText('failed',zh=>zh));
  t.stop();
});

// INT-1: the 60 s owner re-check kept calling /api/me/home in hidden tabs.
test('the owner re-check asks nothing while the tab is hidden and once when it is shown again',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();
  const timers=[],visible=new Set();let hidden=false;
  const env={set:(fn,ms)=>{const x={fn,ms};timers.push(x);return x;},clear:x=>{const i=timers.indexOf(x);if(i>=0)timers.splice(i,1);},
    hidden:()=>hidden,now:w.clock.now,onVisible:fn=>{visible.add(fn);return()=>visible.delete(fn);}};
  const tick=async()=>{const x=timers.shift();assert.equal(x.ms,OWNER_RECHECK_MS);w.clock.advance(x.ms);x.fn();await settle();};
  const homes=()=>t.calls.filter(c=>c==='GET /api/me/home').length,stop=watchOwner(t.client,env),start=homes();
  await tick();assert.equal(homes(),start+1,'visible: one re-check per minute');
  hidden=true;for(let i=0;i<10;i++)await tick();
  assert.equal(homes(),start+1,'ten hidden minutes: nothing');
  hidden=false;for(const fn of visible)fn();await settle();
  assert.equal(homes(),start+2,'shown again: exactly one');
  for(const fn of visible)fn();await settle();assert.equal(homes(),start+2,'a second visibility event without a due re-check asks nothing');
  stop();assert.equal(timers.length,0);assert.equal(visible.size,0);
  t.stop();
});

// CORR-04 / CORR-07 / CORR-08: the panel's rows and wording, run on what the real Worker answers.
test('My-wallet rows after a sale show only the seats the server proved, with each reason worded and the count pluralised',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a,921:a,77:a},online:[361],chain:{361:a,921:a,77:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();
  w.chain.state.owners[921]='0x'+'9'.repeat(40);w.clock.advance(30_001);await t.client.refreshHome(true);   // sold; IMD's roster still lists A
  const pub=(await (await w.call(new Request('https://imdember.com/api/wallet/'+a+'/assets'))).json()).seats;
  assert.deepEqual(pub.map(s=>s.tokenId),['77','361','921'],'the public roster still lists the sold seat');
  const rows=seatRows(pub,t.client.state.home),en=(zh,e)=>e;
  assert.deepEqual(rows.map(s=>[s.tokenId,countsText(s,en)]),[['77','Not seen online yet'],['361','Counts']]);
  assert.deepEqual(seatRows(pub,null).map(s=>s.tokenId),['77','361','921'],'signed out: the public list as it is');
  assert.equal(eligibleText(t.client.state.home.eligible,en),'1 agent counts toward the house');
  assert.equal(eligibleText(2,en),'2 agents count toward the house');assert.equal(eligibleText(1,zh=>zh),'1 位 agent 計入房子');
  assert.equal(countsText({counts:false,reason:'offline-24h'},en),'Offline 24h+');assert.equal(countsText({counts:false,reason:'not-agent'},zh=>zh),'未註冊 agent');
  t.stop();
});

// Spec B08 with the 5-minute index answer (INT-1): a seat bought after sign-in that IMD's roster does not list yet shows on
// a reload or on "Check again" (both fresh), without a new signature; the minute re-check alone waits for the index.
test('a seat bought after sign-in shows on a reload or on Check again, with no second signature',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},online:[361,921,77],chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(t.client.state.home.eligible,1);
  w.chain.state.owners[921]=a;w.clock.advance(60_000);
  await t.client.refreshHome();assert.equal(t.client.state.home.eligible,1,'the minute re-check: not yet');
  w.clock.advance(1);await t.client.refreshHome(true,true);assert.equal(t.client.state.home.eligible,2,'Check again');
  t.stop();
  const C=newAccount(),c=C.address.toLowerCase(),cb=w.browser(),cw=fakeWallet(C),u=tab(w,cb,cw);await u.client.signIn();
  assert.equal(statusOf(u.client.state),'signedInNoHouse');u.stop();
  w.chain.state.owners[77]=c;w.clock.advance(31_000);
  const reload=tab(w,cb,cw);await settle();await settle();
  assert.equal(statusOf(reload.client.state),'owner');assert.equal(cw.signed,1);reload.stop();
});

// INT-6: which household the map marks, and how.
test('the map marks the owner’s own household 「我家」 only in owner mode; otherwise the viewed wallet’s, as “this wallet’s home”',()=>{
  const home=(owner,x)=>({owner,agents:['1'],size:'s',x,z:0,rotation:0}),A='0x'+'a'.repeat(40),V='0x'+'b'.repeat(40);
  const homes=[home(A,1),home(V,2)],zh=z=>z,en=(z,e)=>e;
  assert.deepEqual(markedHome(homes,A,V),{home:homes[0],mine:true});
  assert.deepEqual(markedHome(homes,null,V),{home:homes[1],mine:false});
  assert.deepEqual(markedHome(homes,'0x'+'c'.repeat(40),V),{home:homes[1],mine:false},'an owner IMD has not placed yet');
  assert.deepEqual(markedHome(homes,null,null),{home:null,mine:false});
  assert.deepEqual([markerLabel(true,zh),markerLabel(false,zh),markerLabel(true,en),markerLabel(false,en)],['我家','這個錢包的家','My home','This wallet’s home']);
});

// Moving house (F1): the SIWE session is the only proof; the move itself asks the wallet for nothing and stores no signature.
function memoryStore(init={}){const m=new Map(Object.entries(init)),writes=[];return {writes,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>{writes.push(k);m.set(k,String(v));},peek:k=>m.get(k)};}
test('saved moves from older builds lose their message and signature on read, malformed ones are dropped, and a clean list is left alone',()=>{
  const A='0x'+'A'.repeat(40),B='0x'+'b'.repeat(40),legacy=[
    {owner:A,x:1.5,z:-2,rotation:0.25,size:'ms',issued:'2026-09-27T00:00:00Z',message:'IMD Ember World — move home…',signature:'0x'+'11'.repeat(65)},
    {owner:B,x:3,z:4,rotation:0,size:'s',message:'m',signature:'0xdead'},
    {owner:B,x:5,z:6,rotation:1,size:'m',signature:'0xbeef'},                         // the later move of B wins
    {owner:'0x123',x:1,z:1,rotation:0,size:'s'},{owner:A,x:'1',z:0,rotation:0,size:'s'},{owner:A,x:1,z:0,rotation:0,size:'huge'},
    {owner:A,x:Infinity,z:0,rotation:0,size:'s'},null,'x'];
  const store=memoryStore({[movesKey('live')]:JSON.stringify(legacy)});
  const moves=readMoves(store,'live');
  assert.deepEqual(moves,[{owner:A.toLowerCase(),x:1.5,z:-2,rotation:0.25,size:'ms'},{owner:B,x:5,z:6,rotation:1,size:'m'}]);
  const kept=store.peek(movesKey('live'));
  assert.deepEqual(JSON.parse(kept),moves,'the store is rewritten without the old fields');
  assert.ok(!/signature|message|issued/.test(kept));
  const writes=store.writes.length;assert.deepEqual(readMoves(store,'live'),moves);assert.equal(store.writes.length,writes,'a clean list is not rewritten');
  assert.deepEqual(readMoves(memoryStore({[movesKey('live')]:'{not json'}),'live'),[]);assert.deepEqual(readMoves(null,'live'),[]);
  // Opening one mode also cleans the other mode's list (it is not read until that mode is opened).
  const both=memoryStore({[movesKey('live')]:JSON.stringify(legacy),[movesKey('mock')]:JSON.stringify([{owner:B,x:1,z:1,rotation:0,size:'s',message:'m',signature:'0xabc'}])});
  assert.deepEqual(readMoves(both,'mock'),[{owner:B,x:1,z:1,rotation:0,size:'s'}]);
  for(const mode of ['live','mock'])assert.ok(!/signature|message|issued/.test(both.peek(movesKey(mode))),mode);
  assert.deepEqual(JSON.parse(both.peek(movesKey('live'))),moves,'the live list is cleaned, not emptied');
  const untouched=memoryStore();readMoves(untouched,'live');assert.deepEqual(untouched.writes,[],'absent lists are not created');
});

test('moving needs owner mode: a connected wallet, a switched account or another wallet’s house cannot move, and the move asks the wallet for nothing',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const home={owner:a,size:'s'},lot={x:10,z:-4,rotation:0.5},store=memoryStore();
  wallet.reject=true;const t=tab(w,b,wallet);await t.client.signIn();
  assert.equal(statusOf(t.client.state),'connected');
  assert.equal(moveGate(t.client.state,home),'sign-in','connected but not signed in');
  assert.equal(commitMove(store,'live',[],t.client.state,home,lot),null);assert.equal(store.writes.length,0);
  wallet.reject=false;await t.client.signIn();assert.equal(statusOf(t.client.state),'owner');
  assert.equal(moveGate(t.client.state,{owner:'0x'+'c'.repeat(40)}),'not-yours');assert.equal(moveGate(t.client.state,null),'no-house');
  assert.equal(commitMove(store,'live',[],t.client.state,{owner:'0x'+'c'.repeat(40),size:'s'},lot),null,'another wallet’s house');
  const asked=wallet.asked.length,calls=t.calls.length;
  const moves=commitMove(store,'live',[{owner:a,x:0,z:0,rotation:0,size:'s'}],t.client.state,home,lot);
  assert.deepEqual(moves,[{owner:a,x:10,z:-4,rotation:0.5,size:'s'}]);
  assert.equal(wallet.asked.length,asked,'no wallet request for a move');assert.equal(t.calls.length,calls,'and no server request');
  assert.deepEqual(readMoves(store,'live'),moves);
  wallet.switchTo(B);
  assert.equal(moveGate(t.client.state,home),'sign-in','the switch drops owner mode at once');
  assert.equal(commitMove(store,'live',moves,t.client.state,home,{x:1,z:1,rotation:0}),null);
  t.stop();
});

// EIP-6963 (F3): a page with several wallet extensions. Each fake wallet answers eip6963:requestProvider the way real ones
// do (a CustomEvent whose detail is {info, provider}); the registry and the sign-in client run as in the page.
const ICON_SVG='data:image/svg+xml;base64,PHN2Zy8+';
function page(ethereum){const t=new EventTarget();if(ethereum)t.ethereum=ethereum;return t;}
function install(target,wallet,info){
  const announce=()=>target.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:Object.freeze({info:Object.freeze(info),provider:wallet})}));
  target.addEventListener('eip6963:requestProvider',announce);return announce;
}
const infoOf=(name,rdns,icon=ICON_SVG)=>({uuid:crypto.randomUUID(),name,rdns,icon});
/** The player's click on the chooser entry with this rdns (the first one, as the page lists them). */
const pick=(r,rdns)=>r.choose(r.state.options.find(o=>o.info.rdns===rdns));

test('discovery: window.ethereum only without announcements, the single announced wallet, a choice among several remembered per browser',()=>{
  const legacy=fakeWallet(newAccount()),one=fakeWallet(newAccount()),two=fakeWallet(newAccount()),store=memoryStore();
  const bare=new WalletRegistry(page(legacy),store);bare.start();
  assert.equal(bare.current(),legacy);assert.deepEqual({...bare.state,options:bare.state.options.length},{options:0,chosen:null,needsChoice:false,duplicates:[],any:true,unidentified:true});
  assert.match(unidentifiedNote((zh,en)=>en),/didn’t identify itself \(EIP-6963\)/);assert.match(unidentifiedNote(zh=>zh),/EIP-6963/);
  const none=new WalletRegistry(page(null),store);none.start();assert.equal(none.current(),null);assert.equal(none.state.any,false);assert.equal(none.state.unidentified,false,'no wallet at all is not an unidentified one');
  const lateP=page(legacy),lateR=new WalletRegistry(lateP,store);lateR.start();assert.equal(lateR.state.unidentified,true);
  install(lateP,fakeWallet(newAccount()),infoOf('Wallet Late','com.late'))();assert.equal(lateR.state.unidentified,false,'a late announcement identifies the wallet in use');
  const p=page(legacy);install(p,one,infoOf('Wallet One','com.one'));
  const single=new WalletRegistry(p,store);single.start();assert.equal(single.state.unidentified,false,'an announced wallet is identified, whatever holds window.ethereum');
  assert.equal(single.current(),one,'an announced wallet wins over whatever holds window.ethereum');assert.equal(single.state.chosen.info.rdns,'com.one');
  const late=install(p,two,infoOf('Wallet Two','io.two'));let changes=0;single.subscribe(()=>changes++);late();
  assert.equal(changes,1);assert.equal(single.state.needsChoice,true);assert.equal(single.current(),null,'several and no choice: no wallet is used');
  late();assert.equal(changes,1,'the same announcement again changes nothing');
  pick(single,'io.two');assert.equal(single.current(),two);assert.equal(store.peek('ember-world-wallet-choice'),'io.two');
  pick(single,'org.unknown');single.choose({info:infoOf('Two','io.two'),provider:fakeWallet(newAccount())});assert.equal(single.current(),two,'only an announced wallet can be chosen');
  const reload=new WalletRegistry(p,store);reload.start();
  assert.equal(reload.current(),two,'the choice is remembered in this browser');assert.equal(reload.state.needsChoice,false);
  assert.equal(announced({info:{uuid:'u',name:'X',rdns:'a.b',icon:ICON_SVG},provider:{}}),null,'a provider without request()');
  assert.equal(announced({info:{uuid:'u',name:' ',rdns:'a.b'},provider:one}),null);assert.equal(announced({info:{uuid:'u',name:'X',rdns:'nodot'},provider:one}),null);
  for(const icon of ['javascript:alert(1)','https://evil.example/i.png','data:text/html,<script>1</script>','data:image/png;base64,'+'A'.repeat(70000)])
    assert.equal(announced({info:{uuid:'u',name:'X',rdns:'a.b',icon},provider:one}).info.icon,null,icon.slice(0,24));
  assert.equal(announced({info:{uuid:'u',name:'  Long '+'n'.repeat(80),rdns:'a.b',icon:ICON_SVG},provider:one}).info.name.length,40);
});

test('with several wallets, only the chosen one is asked anything; choosing another shows a mismatch and follows only its accounts',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase();
  const w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B),p=page(wa);
  wb.granted=true;install(p,wa,infoOf('Alpha','com.alpha'));install(p,wb,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,memoryStore());registry.start();
  const t=tab(w,b,null,{registry});await settle();
  assert.equal(registry.state.needsChoice,true);assert.deepEqual([wa.asked,wb.asked],[[],[]],'nothing asked before the pick');
  await t.client.signIn();assert.equal(t.client.state.notice,'no-wallet');assert.deepEqual([wa.asked,wb.asked],[[],[]]);
  pick(registry,'com.alpha');await settle();await t.client.signIn();
  assert.equal(statusOf(t.client.state),'owner');assert.equal(ownerAddress(t.client.state),a);
  assert.deepEqual(wb.asked,[],'the other wallet was never asked');assert.ok(wa.asked.includes('personal_sign'));
  pick(registry,'io.beta');await settle();
  assert.equal(t.client.state.account,bAddr);assert.equal(statusOf(t.client.state),'mismatch');assert.equal(ownerAddress(t.client.state),null,'owner mode off');
  assert.deepEqual(wb.asked,['eth_accounts'],'the new wallet is read silently, never prompted');
  wa.switchTo(newAccount());assert.equal(t.client.state.account,bAddr,'the old wallet’s events are no longer followed');
  const other=newAccount();wb.switchTo(other);assert.equal(t.client.state.account,other.address.toLowerCase());
  assert.equal(t.client.state.session,null,'a switch to another address ends the old session');
  wb.switchTo(B);await settle();await t.client.signIn();
  assert.equal(ownerAddress(t.client.state),bAddr);assert.equal(wa.signed,1);assert.equal(wb.signed,1);
  t.stop();
});

test('switching wallets while a signature is pending drops that flow: the late signature is never verified and nothing is signed in',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B),p=page(null);
  install(p,wa,infoOf('Alpha','com.alpha'));install(p,wb,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,memoryStore());registry.start();pick(registry,'com.alpha');
  let release;wa.gate=new Promise(r=>release=r);
  const t=tab(w,b,null,{registry}),flow=t.client.signIn();
  while(statusOf(t.client.state)!=='awaitingSignature')await settle();
  pick(registry,'io.beta');assert.equal(t.client.state.phase,'idle');
  release();await flow;await settle();
  assert.equal(posts(t.calls,'/api/auth/verify'),0);assert.equal(wa.signed,1,'A did sign, late');
  assert.equal(t.client.state.session,null);assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NULL AND used_at IS NULL').get().n,0,'A’s challenge was ended');
  t.stop();
});

test('only the address that asked can end up signed in: a wallet signing with another key, or a verify answer for another address',async()=>{
  const A=newAccount(),C=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  wallet.signAs=C;const t=tab(w,b,wallet);await t.client.signIn();
  assert.equal(t.client.state.notice,'signature-invalid');assert.equal(t.client.state.session,null);assert.equal(statusOf(t.client.state),'connected');
  // S1: that challenge is burnt at the server. Nothing retries or re-prompts by itself; the next click starts a new one.
  await settle();assert.deepEqual([wallet.signed,posts(t.calls,'/api/auth/challenge'),posts(t.calls,'/api/auth/verify')],[1,1,1]);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NOT NULL').get().n,1);
  assert.match(noticeText('signature-invalid',(zh,en)=>en),/discarded\. Press sign in again/);
  wallet.signAs=null;await t.client.signIn();
  assert.deepEqual([statusOf(t.client.state),t.client.state.notice,wallet.signed,posts(t.calls,'/api/auth/challenge')],['owner',null,2,2]);
  t.stop();
  // The server's answer names someone else (a tampering proxy): the client does not take it and logs the cookie out.
  const b2=w.browser(),w2=fakeWallet(A),X='0x'+'9'.repeat(40);
  const u=tab(w,b2,w2,{rewrite:(path,r)=>path==='/api/auth/verify'&&r.ok?Response.json({address:X,expiresAt:w.clock.now()+DAY}):r});
  await u.client.signIn();await settle();
  assert.equal(u.client.state.session,null);assert.equal(u.client.state.notice,'failed');assert.equal(ownerAddress(u.client.state),null);
  assert.equal((await b2.get('/api/auth/session').then(r=>r.json())).signedIn,false,'the session the server made was revoked');
  u.stop();
});

test('a chain switch in the wallet changes nothing: still the owner, no re-login, no wallet or server request',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state),'owner');
  const asked=wallet.asked.length,calls=t.calls.length;
  wallet.emit('chainChanged','0xaa36a7');wallet.emit('chainChanged','0x1');await settle();
  assert.equal(statusOf(t.client.state),'owner');assert.equal(wallet.asked.length,asked);assert.equal(t.calls.length,calls);
  await t.client.refreshHome(true);assert.equal(statusOf(t.client.state),'owner');assert.equal(wallet.signed,1);
  t.stop();
});

test('a click waiting on the session read never reaches a wallet that was replaced meanwhile',async()=>{
  const A=newAccount(),B=newAccount(),w=world(),b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B),p=page(null);
  install(p,wa,infoOf('Alpha','com.alpha'));install(p,wb,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,memoryStore());registry.start();pick(registry,'com.alpha');
  let release;const gate=new Promise(r=>release=r);
  const t=tab(w,b,null,{registry,hold:async path=>{if(path==='/api/auth/session')await gate;}}),flow=t.client.signIn();
  await settle();pick(registry,'io.beta');release();await flow;await settle();
  assert.deepEqual(wa.asked.filter(m=>m!=='eth_accounts'),[],'the replaced wallet is never prompted');
  assert.deepEqual(wb.asked.filter(m=>m!=='eth_accounts'),[],'nor is the new one, without a new click');
  assert.equal(posts(t.calls,'/api/auth/challenge'),0);
  t.stop();
});

test('a second provider announcing the chosen wallet’s rdns never takes over: the pick stays, the copy is flagged and never asked',async()=>{
  const A=newAccount(),E=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser();
  const legit=fakeWallet(A),other=fakeWallet(newAccount()),evil=fakeWallet(E),p=page(null),store=memoryStore();
  install(p,legit,infoOf('Alpha','com.alpha'));install(p,other,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,store);registry.start();pick(registry,'com.alpha');
  const t=tab(w,b,null,{registry});await t.client.signIn();assert.equal(ownerAddress(t.client.state),a);
  install(p,evil,infoOf('Alpha','com.alpha'))();await settle();
  assert.equal(registry.current(),legit,'the pick is a provider, not a name');assert.equal(registry.state.chosen.provider,legit);
  assert.deepEqual(registry.state.duplicates,['com.alpha']);assert.equal(registry.state.options.length,3,'both entries are listed');
  assert.equal(ownerAddress(t.client.state),a);
  await t.client.signOut();await t.client.signIn();
  assert.deepEqual(evil.asked,[],'the copy is never asked anything');assert.equal(legit.signed,2);assert.equal(ownerAddress(t.client.state),a);
  t.stop();
  // A later visit: the remembered rdns now names two providers, so nothing is used until the player picks one.
  const reload=new WalletRegistry(p,store);reload.start();
  assert.equal(reload.current(),null);assert.equal(reload.state.needsChoice,true);assert.deepEqual(reload.state.duplicates,['com.alpha']);
  const u=tab(w,w.browser(),null,{registry:reload});await settle();await u.client.signIn();
  assert.equal(u.client.state.notice,'no-wallet');assert.deepEqual(evil.asked,[]);
  reload.choose(reload.state.options.find(o=>o.provider===legit));assert.equal(reload.current(),legit);
  u.stop();
  // The only wallet, used without a pick: a copy announcing its rdns turns it into a choice, not a switch.
  const q=page(null);install(q,legit,infoOf('Alpha','com.alpha'));const solo=new WalletRegistry(q,memoryStore());solo.start();
  assert.equal(solo.current(),legit);install(q,evil,infoOf('Alpha','com.alpha'))();
  assert.equal(solo.current(),null);assert.equal(solo.state.needsChoice,true);
  // The same provider announcing again (even with a new uuid) is still one entry.
  const once=install(q,legit,infoOf('Alpha','com.alpha'));once();assert.equal(solo.state.options.length,2);
});

test('a remembered wallet that has not announced is never replaced by whichever one did: the player is asked',async()=>{
  const w=world(),mm=fakeWallet(newAccount()),early=fakeWallet(newAccount()),p=page(fakeWallet(newAccount()));
  mm.granted=early.granted=true;
  const store=memoryStore({'ember-world-wallet-choice':'io.metamask'});install(p,early,infoOf('Other','io.other'));
  const registry=new WalletRegistry(p,store);registry.start();
  assert.equal(registry.current(),null);assert.equal(registry.state.chosen,null);assert.equal(registry.state.needsChoice,true);
  const t=tab(w,w.browser(),null,{registry});await settle();await t.client.signIn();
  assert.deepEqual(early.asked,[],'the early wallet is not used');assert.equal(t.client.state.account,null);
  install(p,mm,infoOf('MetaMask','io.metamask'))();await settle();
  assert.equal(registry.current(),mm,'the remembered wallet, once it announces');assert.deepEqual(early.asked,[]);
  assert.equal(t.client.state.account,mm.account.address.toLowerCase());
  t.stop();
});

test('a replaced wallet’s late answers change nothing: a slow eth_accounts, and accountsChanged from a wallet without removeListener',async()=>{
  const w=world(),A=newAccount(),B=newAccount(),wa=fakeWallet(A),wb=fakeWallet(B),p=page(null);
  wa.granted=true;let release;const held=new Promise(r=>release=r),request=wa.request;
  wa.request=async q=>{if(q.method==='eth_accounts')await held;return request(q);};
  wa.removeListener=undefined;                                                        // optional in EIP-1193
  install(p,wa,infoOf('Alpha','com.alpha'));install(p,wb,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,memoryStore());registry.start();pick(registry,'com.alpha');
  const t=tab(w,w.browser(),null,{registry});await settle();
  pick(registry,'io.beta');await settle();assert.equal(t.client.state.account,null,'B has granted nothing');
  release();await settle();
  assert.equal(t.client.state.account,null,'A’s eth_accounts answered after the switch is dropped');
  wa.switchTo(newAccount());assert.equal(t.client.state.account,null,'A’s accountsChanged is ignored though its listener is still attached');
  const other=newAccount();wb.switchTo(other);assert.equal(t.client.state.account,other.address.toLowerCase(),'B’s are followed');
  t.stop();
});

test('under one’s own house, only an account without a session is told to sign in; a signed-in one is told why its seats do not count',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),home={owner:a},other={owner:'0x'+'c'.repeat(40)};
  const w=world(),wallet=fakeWallet(A);wallet.reject=true;const t=tab(w,w.browser(),wallet);await t.client.signIn();
  assert.equal(statusOf(t.client.state),'connected');assert.equal(moveHint(t.client.state,home),'sign-in');
  assert.equal(moveHint(t.client.state,other),null,'another wallet’s house');assert.equal(moveHint(t.client.state,null),null);
  wallet.reject=false;await t.client.signIn();
  assert.equal(statusOf(t.client.state),'signedInNoHouse');assert.equal(moveHint(t.client.state,home),'no-seat','signed in: not “sign in first”');
  t.stop();
  const w2=world({swarm:{361:a},chain:{361:a}}),wallet2=fakeWallet(A);w2.chain.state.fail='http';
  const u=tab(w2,w2.browser(),wallet2);await u.client.signIn();
  assert.equal(statusOf(u.client.state),'ownershipUnavailable');assert.equal(moveHint(u.client.state,home),'unverified');
  w2.chain.state.fail=null;w2.clock.advance(31_000);await u.client.refreshHome(true);
  assert.equal(statusOf(u.client.state),'owner');assert.equal(moveHint(u.client.state,home),null,'the owner gets the Move button instead');
  const B=newAccount();wallet2.switchTo(B);
  assert.equal(moveHint(u.client.state,{owner:B.address.toLowerCase()}),'sign-in','a switched-to account with no session of its own');
  u.stop();
});
