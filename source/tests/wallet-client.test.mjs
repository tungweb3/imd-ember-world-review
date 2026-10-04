import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain,windowLimiter,openLimiter,START} from './wallet-harness.mjs';
import {AuthClient,statusOf,ownerAddress,statusText,chipText,noticeText,waitingText,watchOwner,OWNER_RECHECK_MS,LOGOUT_WAIT_MS} from '../src/world/auth.ts';
import {seatRows,countsText,eligibleText,recheckNote,emptySeatsText,panelHome,houseNotes,markedHome,markerLabel,signingText,presignText,logoutView,runLogout,confirmOpen,endedText} from '../src/world/walletView.ts';
import {ERC6492_SUFFIX} from '../server/auth.ts';
import {readMoves,commitMove,moveGate,moveHint,movesKey} from '../src/world/moves.ts';
import {enterGate} from '../src/world/homeEntry.ts';
import {WalletRegistry,announced,unidentifiedNote} from '../src/world/wallet.ts';
import {checkSignInMessage,signInSummary} from '../src/world/siwe.ts';
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
 *  `drop(path)` true makes that request fail like a lost connection (fetch throws before it reaches the Worker); `now` is
 *  the page's clock (default the Worker's). */
function tab(w,b,wallet,{hint=memoryHint(),channel=null,hold=null,holdReply=null,drop=null,registry=null,rewrite=null,env,now=w.clock.now}={}){
  const calls=[],cleanups=[];
  const fetch=async(path,init={})=>{calls.push((init.method??'GET')+' '+path);
    if(path==='/api/auth/logout'){const body=JSON.parse(init.body??'{}');cleanups.push({kind:body.expectedAddress?'displayed-session':body.expectedNonce?'verify-owner':'explicit',expectedAddress:body.expectedAddress??null});}
    if(hold)await hold(path);if(drop?.(path))throw new TypeError('Failed to fetch');
    const r=await b.send(b.request(path,{method:init.method??'GET',body:init.body,headers:init.headers}));if(holdReply)await holdReply(path);b.keep(r);return rewrite?rewrite(path,r):r;};
  const client=new AuthClient({fetch,provider:registry?()=>registry.current():()=>wallet,
    onProviderChange:registry?fn=>registry.subscribeProvider?registry.subscribeProvider(fn):registry.subscribe(()=>fn('selection')):undefined,
    hint,now,origin:b.origin,channel:channel&&(()=>new BroadcastChannel(channel)),env});
  const seen=[];client.subscribe(()=>{const s=statusOf(client.state,w.clock.now());if(seen.at(-1)!==s)seen.push(s);});
  return {client,calls,cleanups,seen,hint,stop:client.start()};
}
const settle=()=>new Promise(r=>setTimeout(r,20));
/** Waits (up to 4 s) until `ok()` holds, so a busy machine (the full suite runs files in parallel) is never a failure. */
const until=async ok=>{for(let i=0;i<200&&!ok();i++)await settle();};
const posts=(calls,p)=>calls.filter(c=>c==='POST '+p).length;

test('first sign-in asks for exactly one signature, goes connect → sign → verify → owner, and a double click starts one flow',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a,921:a},chain:{361:a,921:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await settle();
  assert.equal(statusOf(t.client.state,w.clock.now()),'visitor');
  await Promise.all([t.client.signIn(),t.client.signIn(),t.client.signIn()]);
  assert.equal(wallet.signed,1);assert.equal(posts(t.calls,'/api/auth/challenge'),1);assert.equal(posts(t.calls,'/api/auth/verify'),1);
  assert.deepEqual(wallet.asked.filter(m=>m!=='eth_accounts'),['eth_requestAccounts','personal_sign'],'one wallet prompt of each kind');
  assert.deepEqual(t.seen,['visitor','connected','awaitingSignature','verifying','owner']);
  assert.equal(ownerAddress(t.client.state,w.clock.now()),a);assert.equal(t.client.state.home.eligible,2);assert.equal(t.client.state.home.size,'ms');
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
  assert.equal(statusOf(again.client.state,w.clock.now()),'owner');assert.equal(wallet.signed,1);
  assert.equal(posts(again.calls,'/api/auth/challenge'),0);assert.equal(wallet.asked.filter(m=>m==='personal_sign').length,1);
  const quiet=tab(w,b,wallet);await until(()=>quiet.calls.length>=2&&!quiet.client.state.checking);
  assert.equal(statusOf(quiet.client.state,w.clock.now()),'owner');assert.deepEqual(quiet.calls,['GET /api/auth/session','GET /api/me/home?fresh=1']);
  again.stop();quiet.stop();
});

test('a rejected signature leaves a visitor with the owner-less notice, and nothing is retried by itself',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  wallet.reject=true;const t=tab(w,b,wallet);await t.client.signIn();await settle();await settle();
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(t.client.state.notice,'sign-rejected');assert.equal(ownerAddress(t.client.state,w.clock.now()),null);
  assert.equal(wallet.asked.filter(m=>m==='personal_sign').length,1);assert.equal(posts(t.calls,'/api/auth/verify'),0);
  assert.equal(noticeText('sign-rejected',(zh)=>zh),'尚未完成登入驗證，暫不能以屋主身分入住。');
  assert.equal((await b.get('/api/me/home')).status,401);
  t.stop();
});

test('switching A → B turns owner mode off at once and ends A at the server; B is merely connected',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  const oldJar=new Map(b.jar);
  wallet.switchTo(B);
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(ownerAddress(t.client.state,w.clock.now()),null);assert.equal(t.client.state.account,B.address.toLowerCase());
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
  while(statusOf(t.client.state,w.clock.now())!=='awaitingSignature')await settle();
  wallet.switchTo(B);release();await flow;await settle();
  assert.equal(posts(t.calls,'/api/auth/verify'),0);assert.equal(statusOf(t.client.state,w.clock.now()),'connected');
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
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(t.client.state.session,null);
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false,'the late session was logged out');
  assert.equal((await b.get('/api/me/home')).status,401);
  t.stop();
});

test('a wallet with no IMD seat is signed in with no house, and a failing chain read is a different state',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();
  assert.equal(statusOf(t.client.state,w.clock.now()),'signedInNoHouse');assert.equal(t.client.state.home.eligible,0);assert.equal(ownerAddress(t.client.state,w.clock.now()),null);
  t.stop();
  const C=newAccount(),c=C.address.toLowerCase(),w2=world({swarm:{361:c},chain:{361:c}}),b2=w2.browser(),wallet2=fakeWallet(C);
  w2.chain.state.fail='http';
  const u=tab(w2,b2,wallet2);await u.client.signIn();
  assert.equal(statusOf(u.client.state,w.clock.now()),'ownershipUnavailable');assert.equal(u.client.state.home,'unavailable');assert.equal(ownerAddress(u.client.state,w.clock.now()),null);
  const say=(zh,en)=>en;
  assert.notEqual(statusText('ownershipUnavailable',u.client.state,say),statusText('signedInNoHouse',t.client.state,say));
  // The chain recovers: the refresh button (force) makes the same session an owner, with no new signature.
  w2.chain.state.fail=null;w2.clock.advance(31_000);await u.client.refreshHome(true);
  assert.equal(statusOf(u.client.state,w.clock.now()),'owner');assert.equal(wallet2.signed,1);
  u.stop();
});

test('after 7 days the session is expired, on the next check and on the next visit; signing in again needs one signature',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),hint=memoryHint();
  const t=tab(w,b,wallet,{hint});await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  w.clock.advance(7*DAY);await t.client.refreshHome(true);
  assert.equal(statusOf(t.client.state,w.clock.now()),'expired');assert.equal(ownerAddress(t.client.state,w.clock.now()),null);
  t.stop();
  const next=tab(w,w.browser(),fakeWallet(A),{hint:(()=>{const h=memoryHint();h.set({address:a,expiresAt:w.clock.now()-1});return h;})()});await settle();
  assert.equal(statusOf(next.client.state,w.clock.now()),'expired');next.stop();
  const again=tab(w,b,wallet,{hint});await settle();await again.client.signIn();
  assert.equal(statusOf(again.client.state,w.clock.now()),'owner');assert.equal(wallet.signed,2);again.stop();
});

test('tabs follow each other through the channel by re-reading the server, and a forged message changes nothing',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),name='imd-auth-test-'+Math.random();
  wallet.granted=true;                                               // the site was granted before: both tabs see the account
  const hint=memoryHint(),one=tab(w,b,wallet,{hint,channel:name}),two=tab(w,b,wallet,{hint,channel:name});await settle();
  await one.client.signIn();await settle();await settle();
  assert.equal(statusOf(two.client.state,w.clock.now()),'owner');assert.equal(wallet.signed,1);
  const forger=new BroadcastChannel(name);forger.postMessage({kind:'signed-in',address:'0x'+'1'.repeat(40)});await settle();await settle();
  assert.equal(two.client.state.session.address,a,'the address comes from the server, not the message');
  await one.client.signOut();await settle();await settle();
  assert.equal(two.client.state.session,null);assert.equal(statusOf(two.client.state,w.clock.now()),'connected');
  forger.close();one.stop();two.stop();
});

test('a visit whose wallet is on another account than the session is a mismatch until signed in again as that account',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase();
  const w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();t.stop();
  wallet.account=B;                                                   // switched while no page was open
  const u=tab(w,b,wallet);await settle();await settle();
  assert.equal(statusOf(u.client.state,w.clock.now()),'mismatch');assert.equal(ownerAddress(u.client.state,w.clock.now()),null);
  assert.match(statusText('mismatch',u.client.state,(zh,en)=>en),new RegExp(bAddr.slice(0,6)));
  await u.client.signIn();
  assert.equal(statusOf(u.client.state,w.clock.now()),'owner');assert.equal(u.client.state.session.address,bAddr);assert.equal(wallet.signed,2);
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
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  await t.client.signOut();
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner','still signed in: the server never heard the sign-out');
  assert.equal(t.client.state.notice,'signout-failed');assert.ok(b.jar.has('__Host-imd_session'));
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,true);
  lose=false;await t.client.signOut();
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(t.client.state.notice,null);assert.ok(!b.jar.has('__Host-imd_session'));
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,0);
  t.stop();
});

test('Sign out on all devices: every browser of the address is signed out, the other tab at once, the other device on its next read; a lost request keeps it and says so',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),name='imd-auth-test-'+Math.random(),hint=memoryHint();
  const laptop=w.browser(),phone=w.browser(),wallet=fakeWallet(A),phoneWallet=fakeWallet(A);
  let lose=true;const one=tab(w,laptop,wallet,{hint,channel:name,drop:p=>p==='/api/auth/logout-all'&&lose}),two=tab(w,laptop,wallet,{hint,channel:name});
  const other=tab(w,phone,phoneWallet);
  await one.client.signIn();await other.client.signIn();await settle();await settle();
  assert.deepEqual([statusOf(one.client.state,w.clock.now()),statusOf(two.client.state,w.clock.now()),statusOf(other.client.state,w.clock.now())],['owner','owner','owner']);
  await one.client.signOut(true);
  assert.deepEqual([statusOf(one.client.state,w.clock.now()),one.client.state.notice],['owner','signout-failed'],'the server never heard it: still signed in, and told so');
  lose=false;await one.client.signOut(true);await settle();await settle();
  assert.deepEqual([statusOf(one.client.state,w.clock.now()),one.client.state.notice,two.client.state.session],['connected',null,null],'this tab and its sibling (on the channel) are signed out');
  assert.equal(posts(one.calls,'/api/auth/logout-all'),2);assert.equal(posts(one.calls,'/api/auth/logout'),0);
  assert.equal(statusOf(other.client.state,w.clock.now()),'owner','the phone has not asked yet');
  // N-7: its next read finds the session revoked (AUTH_REQUIRED a week before its expiry): signed out, not "expired".
  await other.client.refreshHome(true);
  assert.deepEqual([other.client.state.session,statusOf(other.client.state,w.clock.now()),other.client.state.ended],[null,'connected','revoked'],'its next read finds the session ended: sign in again');
  await other.client.restore();assert.deepEqual([other.client.state.session,statusOf(other.client.state,w.clock.now()),other.client.state.ended],[null,'connected','revoked']);
  assert.deepEqual([...new Set([...wallet.asked,...phoneWallet.asked])].sort(),['eth_accounts','eth_requestAccounts','personal_sign']);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,0);
  one.stop();two.stop();other.stop();
});

// F-4 UX (remediation 2026-09-29): My wallet has "Log out this device" and "Log out all devices"; the second asks first,
// inline. The buttons run through walletView.ts runLogout with the real client, as the panel's clicks do.
test('My wallet: “Log out this device” ends only this browser; “Log out all devices” asks inline, and only its confirm ends every device',async ctx=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),name='imd-auth-test-'+Math.random(),hint=memoryHint();
  const laptop=w.browser(),phone=w.browser(),tablet=w.browser();
  const one=tab(w,laptop,fakeWallet(A),{hint,channel:name}),two=tab(w,laptop,fakeWallet(A),{hint,channel:name}),p=tab(w,phone,fakeWallet(A)),t=tab(w,tablet,fakeWallet(A));
  ctx.after(()=>{for(const x of [one,two,p,t])x.stop();});                        // a failed assertion must not leave a channel open
  for(const x of [one,p,t])await x.client.signIn();
  await until(()=>statusOf(two.client.state,w.clock.now())==='owner');
  const en=(zh,e)=>e,zh=z=>z,labels=v=>[v.buttons.map(b=>b.label),v.confirm&&[v.confirm.note,v.confirm.buttons.map(b=>b.label)]];
  assert.deepEqual(labels(logoutView(false,a,en)),[['Log out this device','Log out all devices'],null]);
  assert.deepEqual(labels(logoutView(false,a,zh)),[['登出此裝置','登出所有裝置'],null]);
  // A click: the button with that label in the view the panel shows now, run as the panel runs it.
  let open=false;const confirm=v=>{open=v;};
  const click=(label,client)=>{const v=logoutView(open,a,en),b=[...v.buttons,...v.confirm?.buttons??[]].find(b=>b.label===label);assert.ok(b,'no button '+label);return runLogout(b.act,client,confirm);};
  // The tablet logs out this device only: the others stay signed in at the server.
  await click('Log out this device',t.client);
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),open,posts(t.calls,'/api/auth/logout'),posts(t.calls,'/api/auth/logout-all')],['connected',false,1,0]);
  assert.deepEqual([(await phone.get('/api/me/home')).status,(await laptop.get('/api/me/home')).status],[200,200]);
  // "Log out all devices" only opens the confirm: nothing is sent, and Cancel closes it.
  await click('Log out all devices',one.client);
  assert.deepEqual([open,statusOf(one.client.state,w.clock.now()),posts(one.calls,'/api/auth/logout-all'),posts(one.calls,'/api/auth/logout')],[true,'owner',0,0]);
  const v=logoutView(open,a,en);
  assert.deepEqual(labels(v),[['Log out this device'],['This logs out '+a.slice(0,6)+'…'+a.slice(-4)+' on every browser and device, including this one. Other tabs here log out at once; other devices on their next signed-in request.',
    ['Yes, log out all devices','Cancel']]]);
  const vz=logoutView(open,a,zh);assert.deepEqual(vz.confirm.buttons.map(b=>b.label),['確定，登出所有裝置','取消']);assert.match(vz.confirm.note,/^這會結束 0x[\da-f]{4}…[\da-f]{4} 在所有瀏覽器與裝置上的登入（包括這裡）：本瀏覽器的其他分頁立即登出，其他裝置在下一次需要登入的操作時登出。$/);
  await click('Cancel',one.client);assert.deepEqual([open,statusOf(one.client.state,w.clock.now()),posts(one.calls,'/api/auth/logout-all')],[false,'owner',0]);
  // Confirmed: this tab at once, its sibling tab through the channel, the phone on its next signed-in request.
  await click('Log out all devices',one.client);await click('Yes, log out all devices',one.client);
  assert.deepEqual([open,statusOf(one.client.state,w.clock.now()),posts(one.calls,'/api/auth/logout-all')],[false,'connected',1]);
  await until(()=>two.client.state.session===null);assert.equal(two.client.state.session,null,'the other tab follows at once');
  assert.equal(statusOf(p.client.state,w.clock.now()),'owner','the phone has not asked yet');
  await p.client.refreshHome(true);assert.deepEqual([p.client.state.session,statusOf(p.client.state,w.clock.now()),p.client.state.ended],[null,'connected','revoked'],'its next signed-in request is refused (revoked, not expired: N-7)');
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,0);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions').get().n,3,'revoked, never deleted');
  // L8: a confirm left open belongs to the session it was opened for. The sibling tab opens it; the laptop logs out and
  // signs in again in that tab's still-open drawer: the confirm is closed for the new session.
  await two.client.signIn();const asked=two.client.state.session;assert.ok(confirmOpen(asked,two.client.state.session));
  await one.client.signOut();await until(()=>two.client.state.session===null);assert.equal(confirmOpen(asked,two.client.state.session),false);
  await two.client.signIn();assert.equal(statusOf(two.client.state,w.clock.now()),'owner');
  assert.equal(confirmOpen(asked,two.client.state.session),false,'a new sign-in never finds the old confirm open');
  assert.equal(logoutView(confirmOpen(asked,two.client.state.session),a,en).confirm,null);
});

// R-1: a 401 from logout-all (this browser's own cookie already dead) looked like a success while the phone stayed signed in.
test('Sign out on all devices from a browser whose sign-in already ended: this page is signed out, says other devices were not, and a fresh sign-in can do it',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),laptop=w.browser(),phone=w.browser();
  const t=tab(w,laptop,fakeWallet(A)),p=tab(w,phone,fakeWallet(A));await t.client.signIn();await p.client.signIn();
  const copy=w.browser();copy.jar.set('__Host-imd_session',laptop.jar.get('__Host-imd_session'));
  assert.equal((await copy.post('/api/auth/logout')).status,204,'whoever holds a copy of the laptop cookie ends it');
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner','the laptop page has not read since');
  await t.client.signOut(true);
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.session,t.client.state.notice],['connected',null,'signout-all-stale']);
  assert.equal((await phone.get('/api/me/home')).status,200,'the phone is still signed in, and the page no longer claims otherwise');
  assert.match(noticeText('signout-all-stale',(zh,en)=>en),/other devices were not signed out/);assert.match(noticeText('signout-all-stale',zh=>zh),/沒有登出其他裝置/);
  await t.client.signIn();await t.client.signOut(true);
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.notice],['connected',null]);
  assert.equal((await phone.get('/api/me/home')).status,401,'signed in again, it does sign the phone out');
  t.stop();p.stop();
});

test('with the sign-in bucket drained by cross-site reads (the reported attack), Sign out still revokes and a reload stays signed out',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);
  const b=w.browser(),wallet=fakeWallet(A),t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  for(let i=0;i<24;i++)await w.call(new Request('https://imdember.com/api/me/home'));   // <img src=/api/me/home> x24 from another site
  await t.client.signOut();
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(t.client.state.notice,null);t.stop();
  const reload=tab(w,b,wallet);await settle();
  assert.equal(statusOf(reload.client.state,w.clock.now()),'connected');assert.equal(reload.client.state.session,null);reload.stop();
});

test('an account switch whose logout is lost shows the old session as a mismatch, never as signed out',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet,{drop:p=>p==='/api/auth/logout'});await t.client.signIn();
  wallet.switchTo(B);assert.equal(ownerAddress(t.client.state,w.clock.now()),null,'owner mode ends at once');
  await settle();await settle();
  assert.equal(statusOf(t.client.state,w.clock.now()),'mismatch');assert.equal(t.client.state.session.address,a);
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
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');assert.equal(wallet.signed,1);assert.equal(posts(t.calls,'/api/auth/challenge'),0);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,1);
  t.stop();
});

// CORR-05: re-checks refused with 429 kept owner mode on with an arbitrarily old answer, even for a sold seat.
test('owner mode ends at the strict 3 minute stale-proof boundary, and comes back when one succeeds',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  w.chain.state.owners[361]='0x'+'9'.repeat(40);w.env.AUTH_LIMITER={limit:async()=>({success:false})};   // sold; re-checks refused
  const states=[];
  for(let m=1;m<=5;m++){w.clock.advance(OWNER_RECHECK_MS);await t.client.refreshHome();states.push(statusOf(t.client.state,w.clock.now()));}
  // v1.1 freshness has an exclusive deadline: age < ttl, rather than retaining at the exact deadline.
  assert.deepEqual(states,['owner','owner','ownershipUnavailable','ownershipUnavailable','ownershipUnavailable']);
  assert.equal(ownerAddress(t.client.state,w.clock.now()),null);assert.equal(t.client.state.session.address,a,'still signed in');
  w.env.AUTH_LIMITER=openLimiter();w.clock.advance(OWNER_RECHECK_MS);await t.client.refreshHome();
  assert.equal(statusOf(t.client.state,w.clock.now()),'signedInNoHouse');
  t.stop();
});

test('a smart wallet whose check the server\'s chain budget refused gets the busy notice, and its next click signs in',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),smart='0x'+'ab'.repeat(20);let allowed=false;wallet.signAs=A;
  w.chain.state.contracts.set(smart,()=>'0x1626ba7e');w.env.CHAIN_LIMITER={limit:async()=>({success:allowed})};
  const t=tab(w,b,{...wallet,request:async q=>q.method==='eth_requestAccounts'||q.method==='eth_accounts'?[smart]:wallet.request(q)});
  await t.client.signIn();
  assert.deepEqual([t.client.state.notice,statusOf(t.client.state,w.clock.now())],['busy','connected']);
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
  assert.equal(statusOf(u.client.state,w.clock.now()),'signedInNoHouse');u.stop();
  w.chain.state.owners[77]=c;w.clock.advance(31_000);
  const reload=tab(w,cb,cw);await settle();await settle();
  assert.equal(statusOf(reload.client.state,w.clock.now()),'owner');assert.equal(cw.signed,1);reload.stop();
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
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');
  assert.equal(moveGate(t.client.state,home,w.clock.now()),'sign-in','connected but not signed in');
  assert.equal(commitMove(store,'live',[],t.client.state,home,lot,w.clock.now()),null);assert.equal(store.writes.length,0);
  wallet.reject=false;await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  assert.equal(moveGate(t.client.state,{owner:'0x'+'c'.repeat(40)},w.clock.now()),'not-yours');assert.equal(moveGate(t.client.state,null,w.clock.now()),'no-house');
  assert.equal(commitMove(store,'live',[],t.client.state,{owner:'0x'+'c'.repeat(40),size:'s'},lot,w.clock.now()),null,'another wallet’s house');
  const asked=wallet.asked.length,calls=t.calls.length;
  const moves=commitMove(store,'live',[{owner:a,x:0,z:0,rotation:0,size:'s'}],t.client.state,home,lot,w.clock.now());
  assert.deepEqual(moves,[{owner:a,x:10,z:-4,rotation:0.5,size:'s'}]);
  assert.equal(wallet.asked.length,asked,'no wallet request for a move');assert.equal(t.calls.length,calls,'and no server request');
  assert.deepEqual(readMoves(store,'live'),moves);
  wallet.switchTo(B);
  assert.equal(moveGate(t.client.state,home,w.clock.now()),'sign-in','the switch drops owner mode at once');
  assert.equal(commitMove(store,'live',moves,t.client.state,home,{x:1,z:1,rotation:0},w.clock.now()),null);
  t.stop();
});

// W-1 (Swarm retest e48d0a96): owner mode is bounded by the session's expiresAt on this device's clock, not only by the
// server's next 401. The client runs with fake timers and visibility (`env`); everything else is the real Worker.
function fakeEnv(){const e={timers:[],shown:new Set(),set(fn,ms){const t={fn,ms,live:true};e.timers.push(t);return t;},clear(t){if(t)t.live=false;},
  onVisible(fn){e.shown.add(fn);return()=>e.shown.delete(fn);},live:()=>e.timers.filter(t=>t.live),fire(t){t.live=false;t.fn();},show(){for(const fn of e.shown)fn();}};return e;}
test('W-1: a session past its expiresAt here is not owner mode: status, move gate, move and hint refuse; the client ends it on time and re-reads the server when shown again',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),env=fakeEnv();
  const home={owner:a,size:'s'},lot={x:10,z:-4,rotation:0.5},store=memoryStore(),t=tab(w,b,wallet,{env});
  await t.client.signIn();const st=t.client.state,exp=st.session.expiresAt;assert.equal(statusOf(st,w.clock.now()),'owner');
  // The gates at the last millisecond and at expiresAt, on the same state object (nothing has told the page yet).
  assert.deepEqual([statusOf(st,exp-1),ownerAddress(st,exp-1),moveGate(st,home,exp-1)],['owner',a,'ok']);
  assert.deepEqual([statusOf(st,exp),ownerAddress(st,exp),moveGate(st,home,exp),moveHint(st,home,exp)],['expired',null,'sign-in','sign-in']);
  assert.equal(commitMove(store,'live',[],st,home,lot,exp),null);assert.equal(store.writes.length,0,'nothing stored');
  assert.equal(commitMove(store,'live',[],st,home,lot,undefined),null,'no clock given: refused');
  // The client's own timer on expiresAt: firing it ends the session here with no request and no signature.
  const armed=env.live();assert.deepEqual(armed.map(x=>x.ms),[exp-w.clock.now()]);
  const calls=t.calls.length;w.clock.set(exp);env.fire(armed[0]);
  assert.deepEqual([t.client.state.session,t.client.state.expired,statusOf(t.client.state,w.clock.now())],[null,true,'expired']);
  assert.equal(t.calls.length,calls,'ended locally');assert.equal(env.live().length,0,'no timer left');t.stop();
  // A laptop that slept past expiry: its timer never fired. Shown again, the page is expired at once and asks the server.
  w.clock.set(START);const b2=w.browser(),env2=fakeEnv(),u=tab(w,b2,fakeWallet(A),{env:env2});await u.client.signIn();
  assert.equal(statusOf(u.client.state,w.clock.now()),'owner');w.clock.advance(7*86_400_000+1);
  const before=u.calls.length;env2.show();
  assert.deepEqual([u.client.state.session,statusOf(u.client.state,w.clock.now())],[null,'expired'],'expired before any answer');
  await until(()=>u.calls.length>before&&!u.client.state.checking);await settle();
  assert.deepEqual(u.calls.slice(before),['GET /api/auth/session']);assert.equal(statusOf(u.client.state,w.clock.now()),'expired','the server agrees');
  env2.show();await settle();assert.equal(u.calls.length,before+1,'not signed in any more: shown again asks nothing');u.stop();
  // A live session: shown again re-reads the session and the house, at most once per HOME_MIN_GAP_MS; a visitor asks nothing.
  w.clock.set(START);const venv=fakeEnv(),v=tab(w,w.browser(),fakeWallet(A),{env:venv});await v.client.signIn();
  const n=v.calls.length;w.clock.advance(20_000);venv.show();await until(()=>v.calls.length>=n+2&&!v.client.state.checking);
  assert.deepEqual(v.calls.slice(n),['GET /api/auth/session','GET /api/me/home']);assert.equal(statusOf(v.client.state,w.clock.now()),'owner');
  w.clock.advance(5_000);venv.show();await settle();assert.equal(v.calls.length,n+2,'within 15 s: nothing more');v.stop();
  const env3=fakeEnv(),x=tab(w,w.browser(),fakeWallet(newAccount()),{env:env3});await settle();const m=x.calls.length;
  w.clock.advance(60_000);env3.show();await settle();assert.equal(x.calls.length,m,'a visitor');x.stop();
});

// Swarm retest e48d0a96 §15 (Codex plan §23 visibility-refresh-clears-stale-owner): a hidden tab keeps its last answer, and
// the tab shown again leaves owner mode once the server says so: after a “Log out all devices” on another browser, and
// after the seat was sold.
test('visibility-refresh-clears-stale-owner: a tab shown again after a “Log out all devices” elsewhere, or after the seat was sold, leaves owner mode',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  // (a) Another browser of A ends every device while this tab is hidden; shown again, it reads the session: signed out.
  const env=fakeEnv(),t=tab(w,w.browser(),fakeWallet(A),{env});await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  const other=w.browser();assert.equal((await other.signIn(A)).verify.status,200);
  assert.equal((await other.post('/api/auth/logout-all',{expectedAddress:A.address})).status,200);
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner','hidden: nothing has told this tab yet');
  w.clock.advance(20_000);const n=t.calls.length;env.show();
  await until(()=>t.calls.length>n&&t.client.state.session===null);await settle();
  assert.deepEqual([t.calls.slice(n),t.client.state.session,t.client.state.home,statusOf(t.client.state,w.clock.now())],[['GET /api/auth/session'],null,null,'connected']);
  t.stop();
  // (b) The seat is sold while the tab is hidden; shown again, it re-reads the session and the house: no seat counts.
  const env2=fakeEnv(),u=tab(w,w.browser(),fakeWallet(A),{env:env2});await u.client.signIn();assert.equal(statusOf(u.client.state,w.clock.now()),'owner');
  w.chain.state.owners[361]='0x'+'9'.repeat(40);w.clock.advance(31_000);
  assert.equal(statusOf(u.client.state,w.clock.now()),'owner','hidden: still the last answer');
  const m=u.calls.length;env2.show();
  await until(()=>u.calls.length>=m+2&&!u.client.state.checking);await settle();
  assert.deepEqual([u.calls.slice(m),statusOf(u.client.state,w.clock.now()),u.client.state.home.eligible,ownerAddress(u.client.state,w.clock.now())],
    [['GET /api/auth/session','GET /api/me/home'],'signedInNoHouse',0,null]);
  u.stop();
});

// Swarm retest e48d0a96 W-3, on the page (Rule 4: a temporary node failure is never shown as the player's fault): the 503
// VERIFY_UNAVAILABLE a node error gives is the "can't be checked right now" notice, not "the signature didn't match".
test('W-3 on the page: a node failure on a smart wallet’s check is “can’t be checked right now”, never a bad signature; the next click signs in with one new signature',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),smart='0x'+'ab'.repeat(20);wallet.signAs=A;
  w.chain.state.contracts.set(smart,()=>'0x1626ba7e');
  w.chain.state.intercept=method=>method==='eth_call'?Response.json({jsonrpc:'2.0',id:1,error:{code:-32000,message:'header not found'}}):null;
  const t=tab(w,b,{...wallet,request:async q=>q.method==='eth_requestAccounts'||q.method==='eth_accounts'?[smart]:wallet.request(q)});
  await t.client.signIn();
  assert.deepEqual([t.client.state.notice,t.client.state.session,statusOf(t.client.state,w.clock.now()),posts(t.calls,'/api/auth/verify'),wallet.signed],
    ['verify-unavailable',null,'connected',1,1]);
  assert.match(noticeText(t.client.state.notice,(zh,en)=>en),/signature can’t be checked right now/);assert.match(noticeText(t.client.state.notice,zh=>zh),/暫時無法驗證/);
  w.chain.state.intercept=null;await t.client.signIn();
  assert.deepEqual([t.client.state.session?.address,t.client.state.notice,wallet.signed,posts(t.calls,'/api/auth/verify')],[smart,null,2,2]);
  t.stop();
});

// Swarm retest e48d0a96 F-7(e): the session is a server fact, not the wallet's. A wallet that locks (accountsChanged with
// no account) leaves a valid session, and owner mode, alone; only a log-out ends it.
test('F-7(e): a locked wallet (accountsChanged with no account) keeps the session and owner mode; only a log-out ends it',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  const session=t.client.state.session,calls=t.calls.length;
  wallet.emit('accountsChanged',[]);await settle();
  assert.deepEqual([t.client.state.account,t.client.state.session,statusOf(t.client.state,w.clock.now()),ownerAddress(t.client.state,w.clock.now())],[null,session,'owner',a]);
  assert.deepEqual(t.calls.slice(calls),[],'no log-out, no request at all');
  assert.equal((await b.get('/api/me/home')).status,200,'the cookie still opens the house');
  await runLogout('device',t.client,()=>{});
  assert.deepEqual([t.client.state.session,statusOf(t.client.state,w.clock.now()),(await b.get('/api/me/home')).status],[null,'visitor',401]);
  t.stop();
});

// A-3 (Swarm audit 519db624): two overlapping house reads of one session share `gen`, and only the response's arrival was
// checked against the newer read, not its body. The page's fetch hands back the Worker's own answer with its body held;
// `held()` resolves once the page has that response and is reading its body.
test('A-3: an older house read whose body arrives after a newer answer is dropped: it neither undoes a sale nor a recovery',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),house={owner:a};
  let hold=null;
  const held=()=>new Promise(resolve=>{hold=resolve;});
  const t=tab(w,b,wallet,{rewrite:async(p,r)=>{if(!hold||!p.startsWith('/api/me/home'))return r;const got=hold;hold=null;
    const bytes=new Uint8Array(await r.arrayBuffer());let asked=false;
    const body=new ReadableStream({pull(c){if(asked)return;asked=true;got({status:r.status,open:()=>{c.enqueue(bytes);c.close();},fail:()=>c.error(new TypeError('network error'))});}},{highWaterMark:0});
    return new Response(body,{status:r.status,headers:r.headers});}});
  const now=()=>w.clock.now(),view=()=>[statusOf(t.client.state,now()),enterGate(t.client.state,house,now()),moveGate(t.client.state,house,now())];
  await t.client.signIn();assert.deepEqual(view(),['owner','ok','ok']);
  // (a) R1 answers 200 with the seat counting, body held; the seat is sold; R2 says eligible 0; then R1's body arrives.
  let first=held();const r1=t.client.refreshHome(true,true);first=await first;assert.equal(first.status,200);
  w.chain.state.owners[361]='0x'+'9'.repeat(40);w.clock.advance(31_000);
  await t.client.refreshHome(true,true);assert.deepEqual(view(),['signedInNoHouse','sign-in','sign-in']);
  first.open();await r1;
  assert.deepEqual([...view(),t.client.state.home.eligible,t.client.state.checking],['signedInNoHouse','sign-in','sign-in',0,false],'the older owner answer is dropped');
  // (b) R1 is a real 503 (the chain is down), body held; the chain recovers and R2 says owner; then R1's body arrives.
  w.chain.state.owners[361]=a;w.chain.state.fail='http';w.clock.advance(31_000);
  first=held();const r2=t.client.refreshHome(true,true);first=await first;assert.equal(first.status,503);
  w.chain.state.fail=null;await t.client.refreshHome(true,true);assert.deepEqual(view(),['owner','ok','ok']);
  first.open();await r2;
  assert.deepEqual([...view(),t.client.state.home.eligible,t.client.state.checking],['owner','ok','ok',1,false],'the older 503 is dropped');
  // (c) R1 answers 200, body held; R2 says owner; then R1's body fails partway (a lost connection): no 'unavailable'.
  w.clock.advance(31_000);
  first=held();const r3=t.client.refreshHome(true,true);first=await first;assert.equal(first.status,200);
  await t.client.refreshHome(true,true);assert.deepEqual(view(),['owner','ok','ok']);
  first.fail();await r3;
  assert.deepEqual([...view(),t.client.state.home.eligible,t.client.state.checking],['owner','ok','ok',1,false],'the older failed body is dropped');
  // (d) R1 answers 200 with the seat counting, body held; then the wallet switches to another account, or this browser
  // logs out (this device, or every device); then R1's body arrives: signed out stays signed out, with no house kept.
  const B=newAccount(),live=()=>w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n;
  for(const leave of ['switch','log out','log out all']){
    wallet.switchTo(A);if(!t.client.state.session)await t.client.signIn();
    assert.deepEqual(view(),['owner','ok','ok'],leave);
    first=held();const r4=t.client.refreshHome(true,true);first=await first;assert.equal(first.status,200);
    if(leave==='switch'){wallet.switchTo(B);await until(()=>live()===0);await settle();}
    else await t.client.signOut(leave==='log out all');
    first.open();await r4;
    assert.deepEqual([...view(),t.client.state.session,t.client.state.home,t.client.state.checking],['connected','sign-in','sign-in',null,null,false],leave+': the older owner answer is dropped');
  }
  t.stop();
});

// A-8 (Swarm audit 519db624): with the location's chain:index budget spent (20 throwaway sign-ins a minute) and IMD's
// roster not listing a buyer's seat yet, the house read answered no seats and recheck 'limited' with no chain read at all,
// and My wallet said "Checked on chain: this wallet holds no IMD seat right now". The texts are walletView.ts's, which
// the panel renders; the states are the real AuthClient's on the real Worker's answers.
// Since N-6 (Swarm audit 8c3aea2e) one IP no longer keeps a buyer's first discovery out: a refused read that counts no
// seat takes its network's index lane. The refused state is now N-6's residual at its stated cost: one IP spends
// chain:index and 20 other /24s take the location's 20 lanes (chain:index:lane) before V's read.
test('A-8: a house read that was refused or cut off is “the check couldn’t be completed”, never “checked on chain: no seat”',async context=>{
  const V=newAccount(),v=V.address.toLowerCase(),en=(zh,e)=>e,zh=z=>z;
  const w=setup({imd:fakeImd({seats:{361:'51320'},owners:owners(2000,{}),online:[361]}),chain:fakeChain({owners:{361:v}})});
  w.env.AUTH_LIMITER=windowLimiter(20,w.clock.now);w.env.CHAIN_LIMITER=windowLimiter(20,w.clock.now);
  for(let i=0;i<20;i++){const b=w.browser(undefined,undefined,'203.0.113.9');
    assert.equal((await b.signIn(newAccount())).verify.status,200);assert.equal((await b.get('/api/me/home')).status,200);w.clock.advance(2_500);}
  for(let k=0;k<20;k++){const b=w.browser(undefined,undefined,'100.64.'+k+'.1');
    assert.equal((await b.signIn(newAccount())).verify.status,200);assert.equal((await b.get('/api/me/home')).status,200);}
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM index_lanes').get().n,20,'the 20 other /24s took the lanes');
  const index=()=>w.chain.state.calls.filter(c=>c.url.includes('getNFTsForOwner')).length,rpc=()=>w.chain.state.calls.filter(c=>c.body).length,before=[index(),rpc()];
  const wallet=fakeWallet(V),t=tab(w,w.browser(undefined,undefined,'198.51.100.20'),wallet);await t.client.signIn();
  const me=t.client.state.home,now=w.clock.now(),house={owner:v},limitedAt={state:structuredClone(t.client.state),now};
  assert.deepEqual([me.seats,me.eligible,me.block,me.recheck,index(),rpc()],[[],0,null,'limited',...before],'refused: nothing was read on chain');
  assert.deepEqual([statusOf(t.client.state,now),ownerAddress(t.client.state,now),moveHint(t.client.state,house,now),enterGate(t.client.state,house,now)],
    ['ownershipUnavailable',null,'unverified','sign-in']);
  assert.equal(statusText('ownershipUnavailable',t.client.state,en),'Can’t confirm seats right now, try again later');
  // What My wallet shows: the house read of the wallet in view (panelHome) and its texts (houseNotes), which the panel
  // renders as they are, run on the client's own state.
  const shown=(c,at,say)=>houseNotes(statusOf(c.state,at),panelHome(c.state,c.state.session.address),say);
  assert.deepEqual([panelHome(t.client.state,v),panelHome(t.client.state,newAccount().address.toLowerCase())],[me,null],'only the signed-in wallet, while it is in view');
  assert.deepEqual(seatRows(null,me),[]);
  const unfinished='The on-chain check couldn’t be completed right now (this is not “you own nothing”), so no seat is counted yet. You are still signed in; try again later.';
  assert.deepEqual(shown(t.client,now,en),{lead:unfinished,
    note:'The NFT index is busy right now: seats on IMD’s roster are verified as usual; a seat bought just now appears on a later check.',
    empty:'No seat proven on chain yet: the check couldn’t be completed right now. Try again later.'});
  assert.deepEqual(shown(t.client,now,zh),{lead:'這次鏈上查核沒能完成（不是沒有持有），所以還沒有席位計入房子。登入仍有效，請稍後重試。',
    note:'鏈上索引查詢此刻太忙：IMD 名冊上的席位照常驗證，剛買的席位要等之後的查詢才會出現。',empty:'尚未在鏈上核實到席位：這次查核沒能完成，請稍後重試。'});
  // A complete read that finds nothing still says so: a wallet with no seat, the budget available again (the next minute).
  w.clock.set(START+60_000);
  const n=tab(w,w.browser(undefined,undefined,'198.51.100.21'),fakeWallet(newAccount()));await n.client.signIn();
  const none=n.client.state.home,noneAt={state:structuredClone(n.client.state),now:w.clock.now()};assert.deepEqual([none.recheck,statusOf(n.client.state,w.clock.now())],[undefined,'signedInNoHouse']);
  assert.deepEqual(shown(n.client,w.clock.now(),en),{lead:'Signed in, but no seat qualifies right now: a seat counts when you hold it and its agent was online in the last 24 hours.',
    note:null,empty:'Checked on chain: this wallet holds no IMD seat right now.'});
  assert.equal(emptySeatsText(null,en),'IMD’s public roster lists no seat for this wallet.');
  n.stop();
  // R8 Low5: the budget's next minute is only 10 s after V's proof (+50 s). A young limited proof is still reused.
  const recentReads=[index(),rpc()],signatures=wallet.signed,verifies=posts(t.calls,'/api/auth/verify');
  assert.equal(me.checkedAt,START+50_000);assert.equal(w.clock.now()-me.checkedAt,10_000);
  await t.client.refreshHome(true,true);
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.home.seats,t.client.state.home.recheck],['ownershipUnavailable',[],'limited']);
  assert.deepEqual([index(),rpc()],recentReads,'inside the proof TTL: no new index or ownerOf read');
  assert.equal(t.client.state.home.checkedAt,me.checkedAt);assert.equal(wallet.signed,signatures);assert.equal(posts(t.calls,'/api/auth/verify'),verifies);
  context.diagnostic(JSON.stringify({case:'A8/limited/10s',proofAge:w.clock.now()-me.checkedAt,indexReads:index()-recentReads[0],rpcReads:rpc()-recentReads[1],signatures:wallet.signed,verifyPosts:posts(t.calls,'/api/auth/verify')}));
  // Exact 30 s proof expiry (+80 s), with the budget back: #361 is discovered, with no new signature.
  w.clock.set(me.checkedAt+30_000);
  await t.client.refreshHome(true,true);assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.home.seats.map(s=>s.tokenId)],['owner',['361']]);
  assert.equal(t.client.state.home.checkedAt,w.clock.now());assert.deepEqual([index()-recentReads[0],rpc()-recentReads[1]],[1,1]);
  assert.equal(wallet.signed,signatures);assert.equal(posts(t.calls,'/api/auth/verify'),verifies);
  context.diagnostic(JSON.stringify({case:'A8/owner/30s',proofAge:w.clock.now()-me.checkedAt,indexReads:index()-recentReads[0],rpcReads:rpc()-recentReads[1],signatures:wallet.signed,verifyPosts:posts(t.calls,'/api/auth/verify')}));
  assert.deepEqual([shown(t.client,w.clock.now(),en).lead,shown(t.client,w.clock.now(),en).note],[null,null]);
  t.stop();
  // Cut off by the 256-candidate cap (A-4) with nothing counting: the same state, and the note says why.
  const P=newAccount(),p=P.address.toLowerCase(),many=Object.fromEntries(Array.from({length:257},(_,i)=>[String(1000+i),p]));
  const w2=setup({imd:fakeImd({seats:{361:'51320'},owners:owners(2000,{}),online:[361]}),chain:fakeChain({owners:many})});
  const u=tab(w2,w2.browser(),fakeWallet(P));await u.client.signIn();const cut=u.client.state.home,cutAt={state:structuredClone(u.client.state),now:w2.clock.now()};
  assert.deepEqual([cut.recheck,cut.eligible,cut.seats.length,statusOf(u.client.state,w2.clock.now())],['partial',0,256,'ownershipUnavailable']);
  const cutShown=shown(u.client,w2.clock.now(),en);
  assert.deepEqual([cutShown.lead,cutShown.note],[unfinished,'This check may not list every seat of this wallet (more than 256 candidates, or more NFT index pages than one read covers): seats that can count are checked first; the rest aren’t listed.']);
  assert.equal(recheckNote(cut.recheck,zh),'這次查核可能沒有列出這個錢包的全部席位（候選超過 256 個，或鏈上索引的頁數超過一次查詢的範圍）：先查可能計入房子的席位，其餘沒有列出。');
  u.stop();
  // My wallet itself: WalletPanel.tsx rendered with these three states (a child process compiles the .tsx with the
  // project's TypeScript and renders it: tests/fixtures/wallet-panel.mjs). The unfinished reads show the walletView texts
  // above, with the Check again button, and never "Checked on chain"; the complete empty read does say it.
  // (The Swarm Audit Record at the panel's foot quotes the old wording in A-8's title, so it is left out of these checks.)
  const [limitedEn,limitedZh,noneEn,cutEn]=(await panels([{...limitedAt,lang:'en'},{...limitedAt,lang:'zh'},{...noneAt,lang:'en'},{...cutAt,lang:'en'}]))
    .map(html=>{const at=html.indexOf('<details class="audit-record">');assert.ok(at>0);return html.slice(0,at);});
  const notes=(x,say)=>houseNotes(statusOf(x.state,x.now),panelHome(x.state,x.state.session.address),say);
  for(const [html,x,say] of [[limitedEn,limitedAt,en],[limitedZh,limitedAt,zh],[cutEn,cutAt,en]]){const n=notes(x,say);
    assert.ok(html.includes(`<p class="wallet-status warn" role="status"><i></i>${statusText('ownershipUnavailable',x.state,say)}</p>`),html.slice(0,400));
    assert.ok(html.includes(`<p class="empty-state">${n.lead}</p><p class="small-note">${n.note}</p><button class="secondary">${say('重新確認','Check again')}</button>`),html.slice(0,600));}
  for(const [html,say] of [[limitedEn,en],[limitedZh,zh]])assert.ok(html.includes(`<p class="empty-state">${notes(limitedAt,say).empty}</p>`),html.slice(0,900));
  assert.doesNotMatch(limitedEn+cutEn,/Checked on chain/);assert.doesNotMatch(limitedZh,/鏈上核實：這個錢包/);
  assert.ok(noneEn.includes(`<p class="empty-state">${notes(noneAt,en).lead}</p>`)&&noneEn.includes('<p class="empty-state">Checked on chain: this wallet holds no IMD seat right now.</p>'),noneEn.slice(0,900));
  assert.doesNotMatch(noneEn,/couldn’t be completed/);
});
// A-4's page cap on the page (Codex crosscheck review R-3): since 54c44f3 an index read stopped at its 5-page cap is
// 'partial' however few seats it named, and My wallet explained every 'partial' as "more seats than one check covers
// (256)", to an owner of two seats as well.
test('A-4: on the page, a read the NFT index cut short at its page cap says the list may be incomplete, not that the wallet names more than 256 seats',async()=>{
  const E=newAccount(),e=E.address.toLowerCase(),en=(zh,x)=>x,zh=z=>z;
  const w=setup({imd:fakeImd({seats:{1000:'77777'},owners:owners(2000,{}),online:[1000]}),chain:fakeChain({owners:{7:e,1000:e}})});
  w.chain.state.endlessPages=true;                                        // every index page names #7 and #1000 and points to one more
  const t=tab(w,w.browser(),fakeWallet(E));await t.client.signIn();
  const me=t.client.state.home,now=w.clock.now(),at={state:structuredClone(t.client.state),now};
  assert.deepEqual([me.seats.map(s=>s.tokenId),me.eligible,me.recheck,statusOf(t.client.state,now)],[['7','1000'],1,'partial','owner']);
  const note=say=>houseNotes(statusOf(t.client.state,now),panelHome(t.client.state,t.client.state.session.address),say).note;
  assert.equal(note(en),'This check may not list every seat of this wallet (more than 256 candidates, or more NFT index pages than one read covers): seats that can count are checked first; the rest aren’t listed.');
  assert.equal(note(zh),'這次查核可能沒有列出這個錢包的全部席位（候選超過 256 個，或鏈上索引的頁數超過一次查詢的範圍）：先查可能計入房子的席位，其餘沒有列出。');
  // My wallet in owner mode: that note under the house line, never the old claim.
  const [html]=await panels([{...at,lang:'en'}]);
  assert.ok(html.includes(`<p class="small-note">${note(en)}</p>`),html.slice(0,1200));
  assert.doesNotMatch(html,/names more seats than one check covers/);
  t.stop();
});
/** "My wallet" as the page renders it, one markup per {state, lang, now}: WalletPanel.tsx in a child process
 *  (tests/fixtures/wallet-panel.mjs). */
async function panels(cases){
  const {spawn}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
  return new Promise((resolve,reject)=>{const c=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/wallet-panel.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
    let out='',err='';c.stdout.setEncoding('utf8').on('data',d=>out+=d);c.stderr.setEncoding('utf8').on('data',d=>err+=d);
    c.on('exit',code=>{try{resolve(JSON.parse(out));}catch{reject(new Error('the panel did not render ('+code+'): '+err.slice(0,2000)));}});c.stdin.end(JSON.stringify(cases));});
}

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
  assert.equal(changes,1);assert.equal(single.state.needsChoice,false);assert.equal(single.current(),one,'a late second announcement cannot replace the provider already used by this page');
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

test('with several wallets, only the chosen one is asked anything; choosing another cleans displayed session and follows only its accounts',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase();
  const w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B),p=page(wa);
  wb.granted=true;install(p,wa,infoOf('Alpha','com.alpha'));install(p,wb,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,memoryStore());registry.start();
  const t=tab(w,b,null,{registry});await settle();
  assert.equal(registry.state.needsChoice,true);assert.deepEqual([wa.asked,wb.asked],[[],[]],'nothing asked before the pick');
  await t.client.signIn();assert.equal(t.client.state.notice,'no-wallet');assert.deepEqual([wa.asked,wb.asked],[[],[]]);
  pick(registry,'com.alpha');await settle();await t.client.signIn();
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');assert.equal(ownerAddress(t.client.state,w.clock.now()),a);
  assert.deepEqual(wb.asked,[],'the other wallet was never asked');assert.ok(wa.asked.includes('personal_sign'));
  pick(registry,'io.beta');await settle();
  // v1.1 provider-switch policy explicitly selects the trusted displayed session's expectedAddress.
  assert.equal(t.client.state.account,bAddr);assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(ownerAddress(t.client.state,w.clock.now()),null,'owner mode off');
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false,'old provider session is actually revoked');
  assert.deepEqual(wb.asked,['eth_accounts'],'the new wallet is read silently, never prompted');
  wa.switchTo(newAccount());assert.equal(t.client.state.account,bAddr,'the old wallet’s events are no longer followed');
  const other=newAccount();wb.switchTo(other);assert.equal(t.client.state.account,other.address.toLowerCase());
  assert.equal(t.client.state.session,null,'a switch to another address ends the old session');
  wb.switchTo(B);await settle();await t.client.signIn();
  assert.equal(ownerAddress(t.client.state,w.clock.now()),bAddr);assert.equal(wa.signed,1);assert.equal(wb.signed,1);
  t.stop();
});

test('switching wallets while a signature is pending drops that flow: the late signature is never verified and nothing is signed in',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B),p=page(null);
  install(p,wa,infoOf('Alpha','com.alpha'));install(p,wb,infoOf('Beta','io.beta'));
  const registry=new WalletRegistry(p,memoryStore());registry.start();pick(registry,'com.alpha');
  let release;wa.gate=new Promise(r=>release=r);
  const t=tab(w,b,null,{registry}),flow=t.client.signIn();
  while(statusOf(t.client.state,w.clock.now())!=='awaitingSignature')await settle();
  pick(registry,'io.beta');assert.equal(t.client.state.phase,'idle');
  release();await flow;await settle();
  assert.equal(posts(t.calls,'/api/auth/verify'),0);assert.equal(wa.signed,1,'A did sign, late');
  assert.equal(t.client.state.session,null);assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
  // Pending-only cancellation is local under v1.1; challenge expiry remains the existing server authority.
  assert.equal(posts(t.calls,'/api/auth/logout'),0,'no guessed-cookie or parallel pending cleanup');
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NULL AND used_at IS NULL').get().n,1,'unused row may remain until expiry');
  const deadline=w.db.raw.prepare('SELECT accept_until FROM login_challenges ORDER BY rowid DESC LIMIT 1').get().accept_until;
  w.clock.set(deadline);assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NULL AND used_at IS NULL AND accept_until>?').get(w.clock.now()).n,0,'expired row is not a usable pending challenge');
  t.stop();
});

test('only the address that asked can end up signed in: a wallet signing with another key, or a verify answer for another address',async()=>{
  const A=newAccount(),C=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  wallet.signAs=C;const t=tab(w,b,wallet);await t.client.signIn();
  assert.equal(t.client.state.notice,'signature-invalid');assert.equal(t.client.state.session,null);assert.equal(statusOf(t.client.state,w.clock.now()),'connected');
  // S1: that challenge is burnt at the server. Nothing retries or re-prompts by itself; the next click starts a new one.
  await settle();assert.deepEqual([wallet.signed,posts(t.calls,'/api/auth/challenge'),posts(t.calls,'/api/auth/verify')],[1,1,1]);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM login_challenges WHERE invalidated_at IS NOT NULL').get().n,1);
  assert.match(noticeText('signature-invalid',(zh,en)=>en),/discarded\. Press sign in again/);
  wallet.signAs=null;await t.client.signIn();
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.notice,wallet.signed,posts(t.calls,'/api/auth/challenge')],['owner',null,2,2]);
  t.stop();
  // The server's answer names someone else (a tampering proxy): the client does not take it and logs the cookie out.
  const b2=w.browser(),w2=fakeWallet(A),X='0x'+'9'.repeat(40);
  const u=tab(w,b2,w2,{rewrite:(path,r)=>path==='/api/auth/verify'&&r.ok?Response.json({address:X,expiresAt:w.clock.now()+DAY}):r});
  await u.client.signIn();await settle();
  assert.equal(u.client.state.session,null);assert.equal(u.client.state.notice,'failed');assert.equal(ownerAddress(u.client.state,w.clock.now()),null);
  assert.equal((await b2.get('/api/auth/session').then(r=>r.json())).signedIn,false,'the session the server made was revoked');
  u.stop();
});

// F-7a (swarm review 4bd31cfb): the page personal_signed whatever text the server returned. It now signs only the exact
// message this site builds; the messages here come from the real server (createSiweMessage) and are then altered.
test('the page checks the sign-in message before the wallet sees it: the real server message passes, every altered one ends the flow unsigned',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  const real=await w.browser().post('/api/auth/challenge',{address:A.address}).then(r=>r.json()),at=w.clock.now();
  let net=0;   // one network per signing tab below, so the variants never meet a network's 30 challenges a minute (L1)
  const ok=(m,o={})=>checkSignInMessage(m,{origin:'https://imdember.com',account:a,nonce:real.nonce,now:at,...o});
  assert.equal(ok(real.message),true,'the server\'s own message');
  for(const account of [A.address,a,'0x'+a.slice(2).toUpperCase()])assert.equal(ok(real.message,{account}),true,'any letter case: '+account);
  const local=await w.browser('http://localhost:8792','http://localhost:8792').post('/api/auth/challenge',{address:A.address}).then(r=>r.json());
  assert.equal(checkSignInMessage(local.message,{origin:'http://localhost:8792',account:a,nonce:local.nonce,now:at}),true,'local dev origin');
  assert.equal(checkSignInMessage(local.message,{origin:'https://imdember.com',account:a,nonce:local.nonce,now:at}),false,'another origin\'s message');
  for(const skew of [-9*60_000,9*60_000])assert.equal(ok(real.message,{now:at+skew}),true,'a device clock off by '+skew/60_000+' min');
  for(const skew of [-11*60_000,11*60_000])assert.equal(ok(real.message,{now:at+skew}),false,'a message from '+-skew/60_000+' min away');
  const iso=ms=>new Date(ms).toISOString(),T=real.message.match(/Issued At: (.*)/)[1];
  const variants={
    domain:m=>m.replace('imdember.com wants','evil.example wants'),lookalike:m=>m.replace('imdember.com wants','imdеmber.com wants'),
    uri:m=>m.replace('URI: https://imdember.com/','URI: https://evil.example/'),uriPath:m=>m.replace('URI: https://imdember.com/','URI: https://imdember.com/x'),
    version:m=>m.replace('Version: 1','Version: 2'),chain:m=>m.replace('Chain ID: 1','Chain ID: 11155111'),
    statement:m=>m.replace('transactions.','transactions. Also approve all transfers.'),noStatement:m=>m.replace(/\n\nSign in to[^\n]*\n/,'\n'),
    address:m=>m.replace(/0x[\da-fA-F]{40}/,B.address),nonce:m=>m.replace(/Nonce: [\da-f]{32}/,'Nonce: '+'0'.repeat(32)),
    issuedLate:m=>m.replace(/Issued At: .*/,'Issued At: '+iso(Date.parse(T)+11*60_000)).replace(/Expiration Time: .*/,'Expiration Time: '+iso(Date.parse(T)+15*60_000)),
    issuedEarly:m=>m.replace(/Issued At: .*/,'Issued At: '+iso(Date.parse(T)-11*60_000)).replace(/Expiration Time: .*/,'Expiration Time: '+iso(Date.parse(T)-7*60_000)),
    longLife:m=>m.replace(/Expiration Time: .*/,'Expiration Time: '+iso(Date.parse(T)+6*60_000)),weekLife:m=>m.replace(/Expiration Time: .*/,'Expiration Time: 2026-10-05T12:00:00.000Z'),
    backwards:m=>m.replace(/Expiration Time: .*/,'Expiration Time: '+iso(Date.parse(T)-1)),noExpiry:m=>m.replace(/\nExpiration Time: .*/,''),
    resources:m=>m+'\nResources:\n- https://evil.example/approve',requestId:m=>m+'\nRequest ID: 1',notBefore:m=>m+'\nNot Before: '+T,
    crlf:m=>m.replace(/\n/g,'\r\n'),trailing:m=>m+'\n',
    line2:m=>m.replace('\n\n','\nApprove all transfers.\n'),line4:m=>{const l=m.split('\n');l[4]='Approve all transfers.';return l.join('\n');}};
  for(const [name,alter] of Object.entries(variants)){
    assert.notEqual(alter(real.message),real.message,name+' alters the message');assert.equal(ok(alter(real.message)),false,name);
    const b=w.browser(undefined,undefined,'198.18.'+(++net)+'.1'),wallet=fakeWallet(A),t=tab(w,b,wallet,{rewrite:async(path,r)=>path==='/api/auth/challenge'&&r.ok?Response.json({...await r.json().then(v=>({...v,message:alter(v.message)}))}):r});
    await t.client.signIn();
    assert.deepEqual([t.client.state.notice,t.client.state.phase,statusOf(t.client.state,w.clock.now())],['message-mismatch','idle','connected'],name);
    assert.deepEqual([wallet.asked.includes('personal_sign'),wallet.signed,posts(t.calls,'/api/auth/verify')],[false,0,0],name+': the wallet was never asked to sign');
    t.stop();
  }
  // A nonce that is not 32 lowercase hex fails even when the field and the Nonce line agree; an origin given with a path,
  // a default port or another spelling is not this page's origin (its URI line differs).
  for(const n of ['G'.repeat(32),'f'.repeat(31),'F'.repeat(32),real.nonce+'0'])
    assert.equal(ok(real.message.replace('Nonce: '+real.nonce,'Nonce: '+n),{nonce:n}),false,'nonce '+n);
  for(const origin of ['https://imdember.com/','https://imdember.com/x','https://imdember.com:443','HTTPS://imdember.com','not a url'])assert.equal(ok(real.message,{origin}),false,origin);
  // The challenge's nonce field and its message must agree; a page served from another host never signs imdember.com's message.
  const mismatch=async(rewrite,origin)=>{const b=w.browser(origin,origin,'198.18.'+(++net)+'.1'),wallet=fakeWallet(A),t=tab(w,b,wallet,{rewrite});await t.client.signIn();t.stop();return [t.client.state.notice,wallet.signed];};
  assert.deepEqual(await mismatch(async(p,r)=>p==='/api/auth/challenge'&&r.ok?Response.json({...await r.json(),nonce:'f'.repeat(32)}):r),['message-mismatch',0]);
  assert.deepEqual(await mismatch(async(p,r)=>p==='/api/auth/challenge'&&r.ok?Response.json({...await r.json(),message:null}):r),['message-mismatch',0]);
  const c=w.browser(),cw=fakeWallet(A),other=new AuthClient({fetch:async(p,i={})=>c.keep(await c.send(c.request(p,{method:i.method??'GET',body:i.body,headers:i.headers}))),
    provider:()=>cw,hint:memoryHint(),now:w.clock.now,origin:'https://www.imdember.com'});
  const stop=other.start();await other.signIn();stop();assert.deepEqual([other.state.notice,cw.signed],['message-mismatch',0]);
  // A device clock a few minutes off still signs in, with the one signature and the wallet methods it always used.
  const b=w.browser(),wallet=fakeWallet(A),skewed=new AuthClient({fetch:async(p,i={})=>b.keep(await b.send(b.request(p,{method:i.method??'GET',body:i.body,headers:i.headers}))),
    provider:()=>wallet,hint:memoryHint(),now:()=>w.clock.now()+8*60_000,origin:'https://imdember.com'});
  const stop2=skewed.start();await skewed.signIn();stop2();
  assert.deepEqual([statusOf(skewed.state,w.clock.now()+8*60_000),wallet.signed,[...new Set(wallet.asked)].sort()],['owner',1,['eth_accounts','eth_requestAccounts','personal_sign']]);
  assert.equal(noticeText('message-mismatch',(zh,en)=>en).includes('was not asked to sign'),true);assert.ok(noticeText('message-mismatch',zh=>zh).includes('沒有請錢包簽名'));
});

// F-1 UX (remediation 2026-09-29): while the wallet's prompt is open the panel says what is being signed, read back from
// the message the page checked, and to compare the domain with the wallet's screen. No extra click, nothing else asked.
test('while the wallet asks for the signature, the page shows a summary read from the checked message, and only then',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  const watch=async(b)=>{const wallet=fakeWallet(A);let open;wallet.gate=new Promise(r=>{open=r;});const t=tab(w,b,wallet),shown=[];
    t.client.subscribe(()=>{const s=t.client.state;shown.push([s.phase,s.signing]);});
    const flow=t.client.signIn();while(!wallet.asked.includes('personal_sign'))await settle();
    const during=t.client.state;open();await flow;t.stop();return {during,after:t.client.state,shown,wallet};};
  const {during,after,shown,wallet}=await watch(w.browser());
  assert.equal(statusOf(during,w.clock.now()),'awaitingSignature');
  assert.deepEqual(during.signing,{domain:'imdember.com',network:'Ethereum',address:A.address},'from the message: its domain, chain 1 and the account line');
  assert.deepEqual(signingText(during.signing,(zh,en)=>en),['Sign in to IMD Ember World · Domain: imdember.com · Network: Ethereum · Wallet: '+A.address.slice(0,6)+'…'+A.address.slice(-4)+
    ' · Purpose: sign-in only · No asset transfer or approval','Sign only when the address bar shows imdember.com. If your wallet says the request comes from another site or warns of a mismatch, reject.']);
  const [zhLine,zhCheck]=signingText(during.signing,zh=>zh);
  for(const part of ['登入 IMD Ember World','網域：imdember.com','網路：Ethereum','用途：僅限登入','不轉移資產、不做任何授權'])assert.ok(zhLine.includes(part),part);
  assert.equal(zhCheck,'只在網址列顯示 imdember.com 時簽名；若錢包顯示請求來自其他網站或出現不符警告，請拒絕。');
  // Before the click (L9): the same facts above the button, since a phone wallet's sheet can cover the summary.
  assert.deepEqual(presignText('imdember.com',(zh,en)=>en)[1],'Domain: imdember.com · Network: Ethereum · Purpose: sign-in only');
  const [zhPre,zhWhere]=presignText('imdember.com',zh=>zh);assert.equal(zhWhere,'網域：imdember.com · 網路：Ethereum · 用途：僅限登入');
  assert.match(zhPre,/不會轉移資產、不會對代幣或 NFT 做任何授權（approve），也不會送出交易/);assert.doesNotMatch(zhPre,/授權[^；]*授權（approve）/);
  assert.match(presignText('imdember.com',(zh,en)=>en)[0],/authorizes no asset transfer, token or NFT approval, or transaction/);
  assert.deepEqual([statusOf(after,w.clock.now()),after.signing],['owner',null],'gone once the wallet answered');
  assert.equal(shown.find(([p])=>p==='awaitingSignature')[1],null,'nothing is shown before the message is back and checked');
  assert.ok(shown.every(([p,s])=>p==='awaitingSignature'||s===null),'never outside the wallet prompt');
  assert.deepEqual(wallet.asked.filter(m=>m!=='eth_accounts'),['eth_requestAccounts','personal_sign'],'no extra step: the one click opens the wallet');
  // The domain is the message's own: a local dev page's message names its host.
  const local=await watch(w.browser('http://localhost:8792','http://localhost:8792','198.18.200.1'));
  assert.equal(local.during.signing.domain,'localhost:8792');
  // Any other text has no summary: the previous statement, another chain, a missing line.
  const real=await w.browser(undefined,undefined,'198.18.201.1').post('/api/auth/challenge',{address:A.address}).then(r=>r.json());
  assert.deepEqual(signInSummary(real.message),{domain:'imdember.com',network:'Ethereum',address:A.address});
  for(const bad of [real.message.replace(/7 days\. This does not authorize asset transfers, token or NFT approvals, or transactions\./,'7 days. This does not authorize asset transfers or transactions.'),
    real.message.replace('Chain ID: 1','Chain ID: 5'),real.message.replace(/\nExpiration Time: .*/,''),real.message.replace('imdember.com wants','imdember.com  wants')]){
    assert.notEqual(bad,real.message);assert.equal(signInSummary(bad),null,bad.split('\n').find((l,i)=>l!==real.message.split('\n')[i]));}
  // A message the page refuses is never summarised either.
  const b=w.browser(undefined,undefined,'198.18.202.1'),wallet2=fakeWallet(A),t=tab(w,b,wallet2,{rewrite:async(p,r)=>p==='/api/auth/challenge'&&r.ok?Response.json({...await r.json().then(v=>({...v,message:v.message.replace('imdember.com wants','evil.example wants')}))}):r});
  const seen=[];t.client.subscribe(()=>seen.push(t.client.state.signing));await t.client.signIn();t.stop();
  assert.deepEqual([t.client.state.notice,wallet2.signed,seen.every(s=>s===null)],['message-mismatch',0,true]);
});

test('a chain switch in the wallet changes nothing: still the owner, no re-login, no wallet or server request',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  const t=tab(w,b,wallet);await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  const asked=wallet.asked.length,calls=t.calls.length;
  wallet.emit('chainChanged','0xaa36a7');wallet.emit('chainChanged','0x1');await settle();
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');assert.equal(wallet.asked.length,asked);assert.equal(t.calls.length,calls);
  await t.client.refreshHome(true);assert.equal(statusOf(t.client.state,w.clock.now()),'owner');assert.equal(wallet.signed,1);
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
  const t=tab(w,b,null,{registry});await t.client.signIn();assert.equal(ownerAddress(t.client.state,w.clock.now()),a);
  install(p,evil,infoOf('Alpha','com.alpha'))();await settle();
  assert.equal(registry.current(),legit,'the pick is a provider, not a name');assert.equal(registry.state.chosen.provider,legit);
  assert.deepEqual(registry.state.duplicates,['com.alpha']);assert.equal(registry.state.options.length,3,'both entries are listed');
  assert.equal(ownerAddress(t.client.state,w.clock.now()),a);
  await t.client.signOut();await t.client.signIn();
  assert.deepEqual(evil.asked,[],'the copy is never asked anything');assert.equal(legit.signed,2);assert.equal(ownerAddress(t.client.state,w.clock.now()),a);
  t.stop();
  // A later visit: the remembered rdns now names two providers, so nothing is used until the player picks one.
  const reload=new WalletRegistry(p,store);reload.start();
  assert.equal(reload.current(),null);assert.equal(reload.state.needsChoice,true);assert.deepEqual(reload.state.duplicates,['com.alpha']);
  const u=tab(w,w.browser(),null,{registry:reload});await settle();await u.client.signIn();
  assert.equal(u.client.state.notice,'no-wallet');assert.deepEqual(evil.asked,[]);
  reload.choose(reload.state.options.find(o=>o.provider===legit));assert.equal(reload.current(),legit);
  u.stop();
  // The page-used sole wallet remains pinned; a copy is warned/listed, never allowed to silently displace it.
  const q=page(null);install(q,legit,infoOf('Alpha','com.alpha'));const solo=new WalletRegistry(q,memoryStore());solo.start();
  assert.equal(solo.current(),legit);install(q,evil,infoOf('Alpha','com.alpha'))();
  assert.equal(solo.current(),legit);assert.equal(solo.state.needsChoice,false);assert.deepEqual(solo.state.duplicates,['com.alpha']);
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
  assert.equal(statusOf(t.client.state,w.clock.now()),'connected');assert.equal(moveHint(t.client.state,home,w.clock.now()),'sign-in');
  assert.equal(moveHint(t.client.state,other,w.clock.now()),null,'another wallet’s house');assert.equal(moveHint(t.client.state,null,w.clock.now()),null);
  wallet.reject=false;await t.client.signIn();
  assert.equal(statusOf(t.client.state,w.clock.now()),'signedInNoHouse');assert.equal(moveHint(t.client.state,home,w.clock.now()),'no-seat','signed in: not “sign in first”');
  t.stop();
  const w2=world({swarm:{361:a},chain:{361:a}}),wallet2=fakeWallet(A);w2.chain.state.fail='http';
  const u=tab(w2,w2.browser(),wallet2);await u.client.signIn();
  assert.equal(statusOf(u.client.state,w.clock.now()),'ownershipUnavailable');assert.equal(moveHint(u.client.state,home,w.clock.now()),'unverified');
  w2.chain.state.fail=null;w2.clock.advance(31_000);await u.client.refreshHome(true);
  assert.equal(statusOf(u.client.state,w.clock.now()),'owner');assert.equal(moveHint(u.client.state,home,w.clock.now()),null,'the owner gets the Move button instead');
  const B=newAccount();wallet2.switchTo(B);
  assert.equal(moveHint(u.client.state,{owner:B.address.toLowerCase()},w.clock.now()),'sign-in','a switched-to account with no session of its own');
  u.stop();
});

// Swarm audit 8c3aea2e (2026-09-30) N-1, N-2, N-7: the order of the page's own session reads and sign-in flows, and why a
// session ended. The real AuthClient on the real Worker; what is held (a body, a reply, a prompt) is the Worker's own
// answer, released in the order the finding needs.
/** Holds response bodies as A-3's rewrite does: `next()` arms the next response `match` picks and resolves, once the page
 *  reads that body, with {status, open(), fail()}: open hands over the Worker's own bytes, fail cuts the body off. */
function heldBodies(match){
  const armed=[];
  return {next:()=>new Promise(resolve=>armed.push(resolve)),
    rewrite:async(p,r)=>{if(!armed.length||!match(p))return r;const got=armed.shift(),bytes=new Uint8Array(await r.arrayBuffer());let asked=false;
      const body=new ReadableStream({pull(c){if(asked)return;asked=true;got({status:r.status,open:()=>{c.enqueue(bytes);c.close();},fail:()=>c.error(new TypeError('network error'))});}},{highWaterMark:0});
      return new Response(body,{status:r.status,headers:r.headers});}};
}
/** The accounts `wallet` was asked to personal_sign for (params[1], lowercase), in order. */
const prompts=wallet=>{const seen=[],request=wallet.request;wallet.request=async q=>{if(q.method==='personal_sign')seen.push(String(q.params[1]).toLowerCase());return request(q);};return seen;};
const SESSION=p=>p==='/api/auth/session',CHALLENGE=p=>p==='/api/auth/challenge',VERIFY=p=>p==='/api/auth/verify',HOME=p=>p.startsWith('/api/me/home');

test('N-1: an older session read whose “signed out” body arrives after a newer “signed in” is dropped: owner mode stays and nothing asks the wallet',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(SESSION);
  let r1=h.next();const t=tab(w,b,wallet,{rewrite:h.rewrite});r1=await r1;              // R1, the load read: signed out, its body on its way
  assert.equal((await b.signIn(A)).verify.status,200);                                    // another tab of this browser profile signs in
  await t.client.restore();                                                               // R2 (that tab's channel message): signed in
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.home.eligible],['owner',1]);
  r1.open();await settle();await settle();
  const s=t.client.state;
  assert.deepEqual([statusOf(s,w.clock.now()),s.session?.address,s.home?.eligible,s.sessionKnown],['owner',a,1,true],'the older “signed out” is dropped');
  assert.deepEqual(wallet.asked,['eth_accounts'],'the wallet was asked for nothing');
  t.stop();
});

test('N-1: and the reverse: an older “signed in” read that arrives after a newer “signed out” revives nothing and reads no house',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(SESSION);wallet.granted=true;
  assert.equal((await b.signIn(A)).verify.status,200);
  let r1=h.next();const t=tab(w,b,wallet,{rewrite:h.rewrite});r1=await r1;              // R1, the load read: signed in, its body on its way
  assert.equal((await b.post('/api/auth/logout')).status,204);                            // another tab of this browser profile signs out
  await t.client.restore();const n=t.calls.length;                                        // R2: signed out
  assert.deepEqual([t.client.state.session,statusOf(t.client.state,w.clock.now())],[null,'connected']);
  r1.open();await settle();await settle();
  assert.deepEqual([t.client.state.session,t.client.state.expired,statusOf(t.client.state,w.clock.now()),t.calls.slice(n)],[null,false,'connected',[]],'no session revived, no house read');
  assert.deepEqual(wallet.asked,['eth_accounts']);
  t.stop();
});

test('N-1: an older read that fails late (a lost connection, or a body cut off) after a newer answer changes nothing',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const how of ['lost','cut']){
    const b=w.browser(),wallet=fakeWallet(A),h=heldBodies(SESSION);let gate=null,lose=false,r1=how==='cut'?h.next():null;
    const t=tab(w,b,wallet,{hold:async p=>{if(how==='lost'&&SESSION(p)&&!gate)await new Promise(r=>gate=r);},drop:p=>SESSION(p)&&lose,rewrite:h.rewrite});
    if(r1)r1=await r1;else await until(()=>gate);                                         // R1, the load read, on its way
    assert.equal((await b.signIn(A)).verify.status,200);await t.client.restore();         // R2: signed in
    assert.equal(statusOf(t.client.state,w.clock.now()),'owner',how);
    if(r1)r1.fail();else{lose=true;gate();}await settle();await settle();lose=false;       // R1 fails: the connection, or its body
    const s=t.client.state;
    assert.deepEqual([statusOf(s,w.clock.now()),s.sessionKnown,s.restored,s.notice],['owner',true,true,null],how+': the older failure is dropped');
    t.stop();
  }
});

// Guard: passes on the unmodified code through `gen`; fails with `g!==this.gen` taken out of readSession's stale().
test('N-1: a switch of account or a sign-out while a session read is on its way still drops it',async()=>{
  for(const leave of ['switch','sign out']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(SESSION);wallet.granted=true;
    assert.equal((await b.signIn(A)).verify.status,200);
    const t=tab(w,b,wallet,{rewrite:h.rewrite});await until(()=>statusOf(t.client.state,w.clock.now())==='owner'&&!t.client.state.checking);
    let r1=h.next();const read=t.client.restore();r1=await r1;                             // R1: signed in, its body on its way
    if(leave==='switch'){wallet.switchTo(B);await until(()=>!b.jar.has('__Host-imd_session'));}else await t.client.signOut();
    const n=t.calls.length;r1.open();await read;await settle();
    assert.deepEqual([t.client.state.session,statusOf(t.client.state,w.clock.now()),t.calls.slice(n)],[null,'connected',[]],leave);
    assert.deepEqual(wallet.asked,['eth_accounts'],leave+': no wallet prompt');
    t.stop();
  }
});

// Guard: passes on the unmodified code (R1 is applied there); fails with the sequence guard kept and the click waiting
// only for the read in flight when it was made, or only for its own read after a failed one (R1 is dropped, the click's
// new flow kills R2, and the wallet signs, or the click says the session is unknown).
test('N-1: a sign-in click waits for the newest session read, so a live session in the cookie jar is found and nothing is signed',async ctx=>{
  for(const known of [true,false]){
    const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(SESSION),name='imd-auth-test-'+Math.random();
    let lose=!known;wallet.granted=true;                                                  // unknown: the load read is lost (CORR-02)
    const t=tab(w,b,wallet,{channel:name,rewrite:h.rewrite,drop:p=>SESSION(p)&&lose}),other=new BroadcastChannel(name);
    ctx.after(()=>{other.close();t.stop();});                                             // a failed assertion must not leave a channel open
    await until(()=>t.client.state.restored&&t.client.state.account);lose=false;
    assert.deepEqual([t.client.state.session,t.client.state.sessionKnown,statusOf(t.client.state,w.clock.now())],[null,known,'connected']);
    assert.equal((await b.signIn(A)).verify.status,200);                                  // another tab signs in and says so on the channel
    let r1=h.next(),click;                                                                // R1: signed in, its body on its way
    if(known){other.postMessage('signed-in');r1=await r1;click=t.client.signIn();}        // the channel's read; the click waits on it
    else{click=t.client.signIn();r1=await r1;}                                            // the click's own read, the session being unknown
    let r2=h.next();other.postMessage('signed-in');r2=await r2;                           // R2 begins while the click waits
    r1.open();await settle();await settle();r2.open();await click;await settle();
    assert.deepEqual([wallet.asked.filter(m=>m!=='eth_accounts'),posts(t.calls,'/api/auth/challenge'),statusOf(t.client.state,w.clock.now()),t.client.state.session?.address,t.client.state.notice],
      [[],0,'owner',a,null],known?'session known':'session unknown');
  }
});

// Guard (the mutation check found it unpinned): the sequence check right after the fetch. An older read the Worker
// answered with an error status, released after a newer “signed in”, must not mark the session unknown; fails with that
// check reduced to `g!==this.gen` (sessionKnown false and the error's notice over the owner state).
test('N-1: an older read answered late with an error status (503 or 429) after a newer “signed in” changes nothing',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const status of [503,429]){
    const b=w.browser(),wallet=fakeWallet(A);let first=true,release=null,late=false;
    const t=tab(w,b,wallet,{holdReply:async p=>{if(SESSION(p)&&first){first=false;await new Promise(r=>release=r);late=true;}},
      rewrite:(p,r)=>{if(!SESSION(p)||!late)return r;late=false;return Response.json({error:status===503?'AUTH_UNAVAILABLE':'RATE_LIMITED'},{status});}});
    await until(()=>release);                                                             // R1, the load read: answered by the Worker, held
    assert.equal((await b.signIn(A)).verify.status,200);await t.client.restore();         // R2 (another tab's channel message): signed in
    assert.equal(statusOf(t.client.state,w.clock.now()),'owner',String(status));
    release();await settle();await settle();                                              // R1 lands as a 503 (429)
    const s=t.client.state;
    assert.deepEqual([statusOf(s,w.clock.now()),s.sessionKnown,s.restored,s.notice],['owner',true,true,null],status+': the older error is dropped');
    t.stop();
  }
});

// Guard (the mutation check found it unpinned): a sign-in drops the replaced session's house read as it begins. A house
// read that starts after the click took its generation (the owner re-check, a visibility re-read) is not stale by gen;
// fails with that homeGen++ removed (A's house in the state while B's prompt is open).
test('N-1: a house read of the replaced session that lands while another address signs in changes nothing',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);
  let lose=false,holdLogout=false,gateLogout=null,holdHome=false,releaseHome=null;
  const t=tab(w,b,wallet,{drop:p=>p==='/api/auth/logout'&&lose,hold:async p=>{if(p==='/api/auth/logout'&&holdLogout){holdLogout=false;await new Promise(r=>gateLogout=r);}},
    holdReply:async p=>{if(HOME(p)&&holdHome){holdHome=false;await new Promise(r=>releaseHome=r);}}});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  lose=true;wallet.switchTo(B);                                                          // the switch's logout is lost: A's session shows as a mismatch
  await until(()=>t.client.state.session?.address===a&&!t.client.state.checking);lose=false;
  assert.equal(statusOf(t.client.state,w.clock.now()),'mismatch');
  holdLogout=true;let sign;wallet.gate=new Promise(r=>sign=r);
  const flow=t.client.signIn();await until(()=>gateLogout);                              // B's click: A's logout on its way
  holdHome=true;const h=t.client.refreshHome(true);await until(()=>releaseHome);          // a house read for A meanwhile, answered by the Worker, held
  gateLogout();await until(()=>wallet.asked.filter(m=>m==='personal_sign').length===2);  // A's session ended, B's prompt open
  assert.deepEqual([t.client.state.session,t.client.state.phase,t.client.state.home],[null,'awaitingSignature',null]);
  releaseHome();await h;await settle();
  assert.deepEqual([t.client.state.phase,t.client.state.home,t.client.state.checking],['awaitingSignature',null,false],'A’s house does not land in B’s sign-in');
  sign();await flow;
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.session?.address],['signedInNoHouse',B.address.toLowerCase()]);
  t.stop();
});

test('N-1: a house read begun for a session that a newer read then ends changes nothing when it lands (200, 429 or 401)',async()=>{
  for(const how of [200,429,401]){
    const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),mem=memoryHint(),writes=[];wallet.granted=true;
    const hint={get:mem.get,set:v=>{writes.push(v);mem.set(v);}};
    // H1 is held after the Worker answered (200, and the 429 it is rewritten to), or before it reaches the Worker (401: sent after the logout).
    let armed=false,release=null,late=false;const wait=async p=>{if(!armed||!HOME(p))return;armed=false;await new Promise(r=>release=r);late=true;};
    const t=tab(w,b,wallet,{hint,...how===401?{hold:wait}:{holdReply:wait},rewrite:(p,r)=>{if(!late||!HOME(p))return r;late=false;return how===429?Response.json({error:'RATE_LIMITED'},{status:429}):r;}});
    assert.equal((await b.signIn(A)).verify.status,200);await t.client.restore();
    await until(()=>statusOf(t.client.state,w.clock.now())==='owner'&&!t.client.state.checking);
    armed=true;const h1=t.client.refreshHome(true);await until(()=>release);
    assert.equal((await b.post('/api/auth/logout')).status,204);await t.client.restore(); // another tab signs out; this tab's channel read
    assert.deepEqual([t.client.state.session,statusOf(t.client.state,w.clock.now())],[null,'connected'],String(how));
    const n=writes.length;release();await h1;await settle();
    const s=t.client.state;
    assert.deepEqual([s.notice,s.home,s.expired,s.ended,s.checking,writes.length-n,statusOf(s,w.clock.now())],[null,null,false,'revoked',false,0,'connected'],how+': the ended session’s house read changes nothing');
    t.stop();
  }
});

test('N-2: a challenge whose body arrives after the switch to another account asks the wallet nothing and verifies nothing',async()=>{
  const A=newAccount(),B=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(CHALLENGE),signs=prompts(wallet);
  const t=tab(w,b,wallet,{rewrite:h.rewrite});await settle();
  let body=h.next();const flow=t.client.signIn();body=await body;                        // A's challenge is answered, its body on its way
  assert.equal(t.client.state.phase,'awaitingSignature');
  wallet.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();
  body.open();await flow;await settle();
  assert.deepEqual([signs,posts(t.calls,'/api/auth/verify'),t.client.state.account,t.client.state.phase,statusOf(t.client.state,w.clock.now())],[[],0,B.address.toLowerCase(),'idle','connected']);
  t.stop();
});

test('N-2: the same after a switch to another wallet with the same account, a sign-out, or the page closing: no prompt from the dead flow',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const cancel of ['wallet','sign out','close']){
    const b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(A),h=heldBodies(CHALLENGE),signs=[prompts(wa),prompts(wb)],p=page(null);
    install(p,wa,infoOf('One','com.one'));install(p,wb,infoOf('Two','io.two'));
    const registry=new WalletRegistry(p,memoryStore());registry.start();pick(registry,'com.one');
    const t=tab(w,b,null,{registry,rewrite:h.rewrite});await settle();
    let body=h.next();const flow=t.client.signIn();body=await body;
    if(cancel==='wallet')pick(registry,'io.two');else if(cancel==='sign out')await t.client.signOut();
    else{t.stop();assert.deepEqual([t.client.state.phase,t.client.state.signing],['idle',null],'the page’s teardown ends the flow');}
    body.open();await flow;await settle();
    assert.deepEqual([...signs,posts(t.calls,'/api/auth/verify')],[[],[],0],cancel);
    if(cancel!=='close'){t.stop();continue;}
    const stop=t.client.start();await t.client.signIn();stop();                           // mounted again (React Refresh, StrictMode): one flow, one signature
    assert.deepEqual([statusOf(t.client.state,w.clock.now()),wa.signed,signs[0],posts(t.calls,'/api/auth/verify')],['owner',1,[a],1]);
  }
});

test('N-2: a new sign-in started at once is untouched by the old flow’s late body or late refusal',async()=>{
  const A=newAccount(),B=newAccount(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:bAddr},chain:{361:bAddr}});
  for(const late of ['body','429']){
    const b=w.browser(),wallet=fakeWallet(A),h=heldBodies(CHALLENGE),signs=prompts(wallet);let refuse=late==='429',open;
    const t=tab(w,b,wallet,{rewrite:(p,r)=>{if(refuse&&CHALLENGE(p)){refuse=false;r=Response.json({error:'RATE_LIMITED'},{status:429});}return h.rewrite(p,r);}});await settle();
    let body=h.next();const flow1=t.client.signIn();body=await body;                     // flow 1 (A): its challenge answer is back (429 in the second run), the body on its way
    wallet.switchTo(B);wallet.gate=new Promise(r=>open=r);
    const flow2=t.client.signIn();await until(()=>signs.length===1);                     // flow 2 (B), at once: its wallet prompt is open
    body.open();await flow1;await settle();
    assert.deepEqual([t.client.state.phase,t.client.state.notice,t.client.state.signing?.address.toLowerCase(),signs],['awaitingSignature',null,bAddr,[bAddr]],late+': flow 2 as it was');
    open();await flow2;
    assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.session?.address,t.client.state.notice,wallet.signed,signs],['owner',bAddr,null,1,[bAddr]],late);
    t.stop();
  }
});

test('N-2: a wallet that locks while the challenge body is on its way is not asked to sign',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(CHALLENGE),signs=prompts(wallet);
  const t=tab(w,b,wallet,{rewrite:h.rewrite});await settle();
  let body=h.next();const flow=t.client.signIn();body=await body;
  wallet.emit('accountsChanged',[]);assert.equal(t.client.state.account,null,'locked');
  body.open();await flow;await settle();
  assert.deepEqual([signs,posts(t.calls,'/api/auth/verify'),t.client.state.phase,t.client.state.session,statusOf(t.client.state,w.clock.now())],[[],0,'idle',null,'visitor']);
  t.stop();
});

// Guard: passes on the unmodified code; fails with the check after personal_sign (`if(g!==this.gen)return;`) deleted.
test('N-2: a prompt already open when the flow is cancelled by a sign-out is answered into nothing',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A);let open;wallet.gate=new Promise(r=>open=r);
  const t=tab(w,b,wallet),flow=t.client.signIn();await until(()=>wallet.asked.includes('personal_sign'));
  await t.client.signOut();open();await flow;await settle();
  assert.deepEqual([wallet.signed,posts(t.calls,'/api/auth/verify'),t.client.state.session,statusOf(t.client.state,w.clock.now())],[1,0,null,'connected']);
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
  t.stop();
});

// Guard (the mutation check found it unpinned): a verify refusal read after the flow was cancelled and a new one began;
// fails with the refusal applied whatever the generation (flow 2 left idle with 'signature-invalid' while its prompt is open).
test('N-2: a dead flow’s verify refusal whose body lands after a new flow began leaves the new flow alone',async()=>{
  const A=newAccount(),B=newAccount(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:bAddr},chain:{361:bAddr}}),b=w.browser(),wallet=fakeWallet(A),h=heldBodies(VERIFY),signs=prompts(wallet);
  wallet.signAs=newAccount();                                                            // flow 1 (A) signs with another key: 401 SIGNATURE_INVALID
  const t=tab(w,b,wallet,{rewrite:h.rewrite});await settle();
  let body=h.next();const flow1=t.client.signIn();body=await body;                      // flow 1's refusal is back, its body on its way
  assert.deepEqual([t.client.state.phase,body.status],['verifying',401]);
  wallet.signAs=undefined;let open;wallet.gate=new Promise(r=>open=r);wallet.switchTo(B);
  const flow2=t.client.signIn();await until(()=>signs.length===2);                      // flow 2 (B): its prompt is open
  body.open();await flow1;await settle();
  assert.deepEqual([t.client.state.phase,t.client.state.notice,t.client.state.signing?.address.toLowerCase()],['awaitingSignature',null,bAddr],'flow 2 as it was');
  open();await flow2;
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.session?.address,t.client.state.notice,signs],['owner',bAddr,null,[A.address.toLowerCase(),bAddr]]);
  t.stop();
});

// A click waiting for a session read (the load's, another tab's, or its own re-read after a failed one) had taken no
// generation yet, so the page closing or a sign-out in that wait did not end it: once the read landed it asked the wallet
// (to connect, and to sign) and verified. Now the wait itself is ended by them.
test('N-2: a click still waiting for a session read is ended by the page closing or a sign-out: no prompt, no challenge, no verify',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const cancel of ['close','sign out']){
    const b=w.browser(),wallet=fakeWallet(A),signs=prompts(wallet);let hold=cancel==='close',release=null,lose=false;
    const t=tab(w,b,wallet,{holdReply:async p=>{if(hold&&SESSION(p)){hold=false;await new Promise(r=>release=r);}},drop:p=>p==='/api/auth/logout'&&lose});
    if(cancel==='sign out'){                                                             // A signed in, the wallet switched to B and that logout lost: a mismatch
      await t.client.signIn();lose=true;wallet.switchTo(B);await until(()=>t.client.state.session?.address===a&&!t.client.state.checking);lose=false;
      assert.equal(statusOf(t.client.state,w.clock.now()),'mismatch');hold=true;void t.client.restore();   // a re-read (visibility, another tab) on its way
    }
    await until(()=>release);const n=t.calls.length,asked=wallet.asked.length,signed=signs.length;   // the read: answered by the Worker, held
    const click=t.client.signIn();await settle();                                       // the click waits for it
    if(cancel==='close')t.stop();else await t.client.signOut();
    release();await click;await settle();await settle();
    assert.deepEqual([signs.slice(signed),wallet.asked.slice(asked).filter(m=>m!=='eth_accounts'),t.calls.slice(n)],[[],[],cancel==='close'?[]:['POST /api/auth/logout']],cancel);
    assert.deepEqual([t.client.state.phase,t.client.state.session,(await b.get('/api/auth/session').then(r=>r.json())).signedIn],['idle',null,false],cancel);
    if(cancel==='sign out'){assert.deepEqual([t.client.state.ended,statusOf(t.client.state,w.clock.now())],['signed-out','connected']);t.stop();}
  }
});

test('N-7: a session revoked elsewhere (AUTH_REQUIRED) a day before its expiry is signed out, not expired (the reproduction)',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),t=tab(w,w.browser(),fakeWallet(A),{env:fakeEnv()});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  w.clock.advance(6*DAY);                                                                 // a day before the session's expiresAt
  const other=w.browser();assert.equal((await other.signIn(A)).verify.status,200);
  const all=await other.post('/api/auth/logout-all',{expectedAddress:A.address});assert.deepEqual([all.status,await all.json()],[200,{revoked:2}]);
  await t.client.refreshHome(true);
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.expired,s.ended,statusOf(s,w.clock.now())],[null,null,false,'revoked','connected']);
  assert.deepEqual([endedText(s.ended,(zh,en)=>en),endedText(s.ended,zh=>zh)],['You are no longer signed in. Please sign in again.','登入狀態已失效，請重新登入。']);
  for(const say of [(zh,en)=>en,zh=>zh])assert.doesNotMatch(endedText(s.ended,say),/another device|其他裝置/);
  await t.client.restore();
  assert.deepEqual([t.client.state.session,t.client.state.expired,t.client.state.ended,statusOf(t.client.state,w.clock.now())],[null,false,'revoked','connected']);
  t.stop();
});

test('N-7: a real expiry still reads as expired: SESSION_EXPIRED, a 401 at the held session’s expiresAt, and the W-1 timer',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),en=(zh,e)=>e,zh=z=>z;
  const signedIn=async(o={})=>{w.clock.set(START);const env=fakeEnv(),t=tab(w,w.browser(),fakeWallet(A),{env,...o});await t.client.signIn();
    assert.equal(statusOf(t.client.state,w.clock.now()),'owner');return {t,env,exp:t.client.state.session.expiresAt};};
  const ended=t=>[t.client.state.session,t.client.state.expired,t.client.state.ended,statusOf(t.client.state,w.clock.now())];
  // (a) The server says SESSION_EXPIRED while the page's clock runs 5 s behind the Worker's, so the held session's
  // expiresAt is not reached here: only the server's word makes it an expiry (it read 'revoked' with that term dropped).
  const pageNow=()=>w.clock.now()-5_000,x=await signedIn({now:pageNow});w.clock.advance(7*DAY);
  assert.ok(x.exp>pageNow()&&x.exp<=w.clock.now(),'past its expiresAt on the Worker’s clock only');await x.t.client.refreshHome(true);
  assert.deepEqual(ended(x.t),[null,true,'expired','expired'],'SESSION_EXPIRED');x.t.stop();
  // (b) A 401 AUTH_REQUIRED at the held session's expiresAt: expired, from the expiry kept before the session is cleared.
  let refuse=false;const y=await signedIn({rewrite:(p,r)=>refuse&&HOME(p)?Response.json({error:'AUTH_REQUIRED'},{status:401}):r});
  w.clock.set(y.exp);refuse=true;await y.t.client.refreshHome(true);
  assert.deepEqual(ended(y.t),[null,true,'expired','expired'],'AUTH_REQUIRED at expiresAt');y.t.stop();
  // (c) The W-1 timer at expiresAt, and the status line's sentence.
  const z=await signedIn(),[timer]=z.env.live();w.clock.set(z.exp);z.env.fire(timer);
  assert.deepEqual(ended(z.t),[null,true,'expired','expired'],'the W-1 timer');
  assert.deepEqual([statusText('expired',z.t.client.state,en),statusText('expired',z.t.client.state,zh)],['Your sign-in has expired. Please sign in again.','登入已到期，請重新登入。']);
  z.t.stop();
});

test('N-7: an expiry seen through a session read is still expired: with no hint, and when the server’s clock is ahead of the page’s',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  // (a) No hint (blocked storage, or one another tab cleared); the browser drops the cookie at its Max-Age; another tab's
  // channel message makes this tab read the session: {signedIn:false}.
  const b=w.browser(),t=tab(w,b,fakeWallet(A),{env:fakeEnv(),hint:{get:()=>null,set:()=>{}}});await t.client.signIn();
  w.clock.set(t.client.state.session.expiresAt);b.jar.delete('__Host-imd_session');await t.client.restore();
  assert.deepEqual([t.client.state.session,t.client.state.expired,t.client.state.ended,statusOf(t.client.state,w.clock.now())],[null,true,'expired','expired'],'no hint');
  t.stop();
  // (b) The page's clock runs 5 s behind the Worker's: at the Worker's expiresAt the cookie is still sent, and the session
  // route says the session ran out.
  w.clock.set(START);const pageNow=()=>w.clock.now()-5_000,u=tab(w,w.browser(),fakeWallet(A),{env:fakeEnv(),now:pageNow});await u.client.signIn();
  assert.equal(statusOf(u.client.state,pageNow()),'owner');
  w.clock.set(u.client.state.session.expiresAt);await u.client.restore();
  assert.deepEqual([u.client.state.session,u.client.state.expired,u.client.state.ended,statusOf(u.client.state,pageNow())],[null,true,'expired','expired'],'the server’s clock ahead');
  u.stop();
});

test('N-7: My wallet says “Signed out.” after this page’s own sign-out and “You are no longer signed in” after a revocation, never why it cannot know',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),en=(zh,e)=>e,zh=z=>z,at=t=>({state:structuredClone(t.client.state),now:w.clock.now()});
  // Revoked: another browser logs out every device; this page's next house read is a 401 AUTH_REQUIRED.
  const r=tab(w,w.browser(),fakeWallet(A),{env:fakeEnv()});await r.client.signIn();
  const other=w.browser();assert.equal((await other.signIn(A)).verify.status,200);assert.equal((await other.post('/api/auth/logout-all',{expectedAddress:A.address})).status,200);
  await r.client.refreshHome(true);const revoked=at(r);r.stop();
  // This page's own sign-out.
  const o=tab(w,w.browser(),fakeWallet(A),{env:fakeEnv()});await o.client.signIn();await o.client.signOut();const out=at(o);o.stop();
  // Expired: the W-1 timer at expiresAt.
  const env=fakeEnv(),x=tab(w,w.browser(),fakeWallet(A),{env});await x.client.signIn();const [timer]=env.live();
  w.clock.set(x.client.state.session.expiresAt);env.fire(timer);const expired=at(x);x.stop();
  assert.deepEqual([revoked,out,expired].map(c=>[c.state.session,c.state.ended,statusOf(c.state,c.now)]),[[null,'revoked','connected'],[null,'signed-out','connected'],[null,'expired','expired']]);
  assert.deepEqual([endedText('revoked',en),endedText('signed-out',en),endedText('expired',en)],['You are no longer signed in. Please sign in again.','Signed out.','Your sign-in has expired. Please sign in again.']);
  assert.deepEqual([endedText('revoked',zh),endedText('signed-out',zh),endedText('expired',zh)],['登入狀態已失效，請重新登入。','已登出。','登入已到期，請重新登入。']);
  // The panel as the page renders it (the Swarm Audit Record at its foot is left out, as in A-8).
  const html=(await panels([revoked,out,expired].flatMap(c=>[{...c,lang:'en'},{...c,lang:'zh'}])))
    .map(h=>{const i=h.indexOf('<details class="audit-record">');assert.ok(i>0);return h.slice(0,i);});
  const [revokedEn,revokedZh,outEn,outZh,expiredEn,expiredZh]=html;
  for(const [h,end,say] of [[revokedEn,'revoked',en],[revokedZh,'revoked',zh],[outEn,'signed-out',en],[outZh,'signed-out',zh]])
    assert.ok(h.includes(`<p class="small-note" role="status">${endedText(end,say)}</p>`),end+': '+h.slice(0,600));
  for(const [h,say] of [[expiredEn,en],[expiredZh,zh]]){const line=endedText('expired',say);
    assert.ok(h.includes(`<p class="wallet-status warn" role="status"><i></i>${line}</p>`),h.slice(0,600));assert.equal(h.split(line).length,2,'said once, as the status line');}
  for(const h of html)assert.doesNotMatch(h,/another device|其他裝置/);
});

// Swarm Report dcf922ca R-1 (R3-R1) and Swarm Audit 1ef8e8a6 #4, #5, #7 (AUD3-04, AUD3-05, AUD3-07), both of the public
// snapshot 8cad017: the page's own account events, sign-outs and house reads, in the orders the reviewers found. The real
// AuthClient on the real Worker; what is held (a wallet answer, a reply, a prompt) is released in the order the finding
// needs. `ID: …` fails on f4272c5; `ID guard: …` passes there and names the mutation of the fix it kills.
/** R3-R1: holds the wallet's eth_requestAccounts answer, read when the page asked (the account then), until `answer()`;
 *  `asked` resolves once the page is waiting for it. */
function heldConnect(wallet){
  const h={};h.asked=new Promise(r=>{h.ready=r;});const request=wallet.request;
  wallet.request=async q=>{if(q.method!=='eth_requestAccounts')return request(q);const v=await request(q);return new Promise(r=>{h.answer=()=>r(v);h.ready();});};
  return h;
}
const LOGOUT=p=>p==='/api/auth/logout',SESSION_COOKIE='__Host-imd_session';
/** One gate per kind of request, armed by `arm(kind)`: the next matching request is held until `open(kind)`. */
function gates(){
  const armed=new Set(),open=new Map();
  return {arm:k=>armed.add(k),disarm:k=>armed.delete(k),held:k=>open.has(k),open:k=>{const f=open.get(k);open.delete(k);f?.();},
    wait:async(k,match,p)=>{if(!armed.has(k)||!match(p))return;armed.delete(k);await new Promise(r=>open.set(k,r));}};
}

test('R3-R1: an accountsChanged(B) that arrives while eth_requestAccounts is pending wins over the late [A]: no prompt, no challenge, no verify, B stays connected (the reproduction)',async()=>{
  const A=newAccount(),B=newAccount(),bAddr=B.address.toLowerCase(),w=world(),b=w.browser(),wallet=fakeWallet(A),held=heldConnect(wallet),signs=prompts(wallet);
  wallet.signAs=A;                                                                        // as the Report's probe: A's key would sign A's message
  const t=tab(w,b,wallet);await settle();
  const flow=t.client.signIn();await held.asked;                                         // the connect is pending (phase idle, no session)
  wallet.switchTo(B);assert.equal(t.client.state.account,bAddr);                         // the wallet says B
  held.answer();await flow;await settle();                                               // then the late answer: [A]
  const s=t.client.state;
  assert.deepEqual([signs,posts(t.calls,'/api/auth/challenge'),posts(t.calls,'/api/auth/verify'),s.account,s.session,s.notice,statusOf(s,w.clock.now())],[[],0,0,bAddr,null,null,'connected']);
  // Nothing asked the wallet again; the player's next click signs in B, with one prompt for B.
  wallet.signAs=undefined;await t.client.signIn();
  assert.deepEqual([signs,posts(t.calls,'/api/auth/verify'),t.client.state.session?.address,statusOf(t.client.state,w.clock.now())],[[bAddr],1,bAddr,'signedInNoHouse']);
  t.stop();
});

test('R3-R1: a lock (accountsChanged([])) while the connect is pending ends the click: nothing asked, no account',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),held=heldConnect(wallet),signs=prompts(wallet);
  const t=tab(w,b,wallet);await settle();
  const flow=t.client.signIn();await held.asked;
  wallet.emit('accountsChanged',[]);held.answer();await flow;await settle();
  const s=t.client.state;
  assert.deepEqual([signs,posts(t.calls,'/api/auth/challenge'),posts(t.calls,'/api/auth/verify'),s.account,s.session,statusOf(s,w.clock.now())],[[],0,0,null,null,'visitor']);
  t.stop();
});

test('R3-R1: a lock while the signature prompt is open verifies nothing',async()=>{
  const A=newAccount(),w=world(),b=w.browser(),wallet=fakeWallet(A),signs=prompts(wallet);let open;wallet.gate=new Promise(r=>open=r);
  const t=tab(w,b,wallet);await settle();
  const flow=t.client.signIn();await until(()=>signs.length===1);                       // A's prompt is open
  wallet.emit('accountsChanged',[]);assert.equal(t.client.state.account,null,'locked');
  open();await flow;await settle();                                                      // the prompt already open is answered
  const s=t.client.state;
  assert.deepEqual([wallet.signed,posts(t.calls,'/api/auth/verify'),s.phase,s.session,s.account,statusOf(s,w.clock.now())],[1,0,'idle',null,null,'visitor']);
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
  t.stop();
});

test('R3-R1: a slow eth_accounts answer that lands after a lock event changes nothing',async()=>{
  const A=newAccount(),w=world(),wallet=fakeWallet(A),request=wallet.request;let release;const held=new Promise(r=>release=r);
  wallet.granted=true;wallet.request=async q=>{const v=await request(q);if(q.method==='eth_accounts')await held;return v;};   // read [A], answered late
  const t=tab(w,w.browser(),wallet);await settle();
  wallet.emit('accountsChanged',[]);release();await settle();
  assert.deepEqual([t.client.state.account,statusOf(t.client.state,w.clock.now())],[null,'visitor']);
  t.stop();
});

// Guard (T02): fails with the check after eth_requestAccounts reduced to `seen!==this.accountEvents` (any event ends the click).
test('R3-R1 guard: a normal first connect that emits accountsChanged for the same account completes with one prompt and one verify',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),held=heldConnect(wallet),signs=prompts(wallet);
  const t=tab(w,b,wallet);await settle();
  const flow=t.client.signIn();await held.asked;
  wallet.emit('accountsChanged',[A.address]);held.answer();await flow;                  // granted: the wallet announces A, then answers [A]
  assert.deepEqual([signs,posts(t.calls,'/api/auth/challenge'),posts(t.calls,'/api/auth/verify'),t.client.state.session?.address,statusOf(t.client.state,w.clock.now())],[[a],1,1,a,'owner']);
  t.stop();
});

// Guard: fails with the same reduction, and with the answer compared with the first event of the await instead of the
// latest state (B): the latest event (A) agrees with the answer, so A signs in once.
test('R3-R1 guard: B then A while pending: the latest event (A) agrees with the answer, so A signs in once',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),held=heldConnect(wallet),signs=prompts(wallet);
  const t=tab(w,b,wallet);await settle();
  const flow=t.client.signIn();await held.asked;
  wallet.switchTo(B);wallet.switchTo(A);held.answer();await flow;
  assert.deepEqual([signs,posts(t.calls,'/api/auth/verify'),t.client.state.account,t.client.state.session?.address,statusOf(t.client.state,w.clock.now())],[[a],1,a,a,'owner']);
  t.stop();
});

// Guard (T04): fails with the `if(g!==this.gen)return;` after eth_requestAccounts removed (the late answer sets A).
test('R3-R1 guard: a sign-out, the page closing or a wallet switch while the connect is pending: the late answer sets no account and asks nothing',async()=>{
  const A=newAccount(),B=newAccount(),w=world();
  for(const cancel of ['sign out','close','wallet']){
    const b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B),held=heldConnect(wa),signs=[prompts(wa),prompts(wb)],subs=new Set();let current=wa;
    const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
    const t=tab(w,b,null,{registry});await settle();
    const flow=t.client.signIn();await held.asked;
    if(cancel==='sign out')await t.client.signOut();else if(cancel==='close')t.stop();else{current=wb;for(const fn of subs)fn();}
    held.answer();await flow;await settle();
    assert.deepEqual([t.client.state.account,...signs,posts(t.calls,'/api/auth/challenge'),posts(t.calls,'/api/auth/verify'),wb.asked],[null,[],[],0,0,cancel==='wallet'?['eth_accounts']:[]],cancel);
    if(cancel!=='close')t.stop();
  }
});

// The check after personal_sign compares the wallet too. A wallet change that fires providerChanged is caught by gen
// already; this pins the other half, a provider that changes with no event while the prompt is open (on f4272c5, and
// with that check reduced to the account alone, the signature is verified and a session made).
test('R3-R1: a wallet that changes with no provider-change event while the prompt is open verifies nothing',async()=>{
  const A=newAccount(),B=newAccount(),w=world(),b=w.browser(),wa=fakeWallet(A),wb=fakeWallet(B);let current=wa,open;wa.gate=new Promise(r=>open=r);
  const t=tab(w,b,null,{registry:{current:()=>current,subscribe:()=>()=>{}}});await settle();
  const flow=t.client.signIn();await until(()=>wa.asked.includes('personal_sign'));     // A's prompt is open
  current=wb;open();await flow;await settle();                                           // the page now sees another wallet; A's prompt is answered
  assert.deepEqual([wa.signed,posts(t.calls,'/api/auth/verify'),t.client.state.session,t.client.state.phase],[1,0,null,'idle']);
  assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,false);
  t.stop();
});

test('AUD3-04: a session read begun while this page’s sign-out is on its way, answered after it, revives nothing: “Signed out.” stays (the reproduction)',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates();
  const t=tab(w,b,fakeWallet(A),{hold:p=>g.wait('logout',LOGOUT,p),holdReply:p=>g.wait('read',SESSION,p)});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  g.arm('logout');const out=t.client.signOut();await until(()=>g.held('logout'));      // the logout on its way, not at the server yet
  g.arm('read');const read=t.client.restore();await until(()=>g.held('read'));         // a session read (another tab's message): the Worker answers A, held
  g.open('logout');await out;                                                            // the server revokes A and clears the cookie
  assert.deepEqual([t.client.state.session,t.client.state.ended],[null,'signed-out']);
  const n=t.calls.length;g.open('read');await read;await settle();await settle();
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.ended,statusOf(s,w.clock.now()),t.hint.get(),t.calls.slice(n)],[null,null,'signed-out','connected',null,[]]);
  t.stop();
});

test('AUD3-04: the same when the house read then fails or is refused: no session, house or hint of A is left',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const how of ['lost','429']){
    const b=w.browser(),g=gates();let failing=false;
    const t=tab(w,b,fakeWallet(A),{hold:p=>g.wait('logout',LOGOUT,p),holdReply:p=>g.wait('read',SESSION,p),drop:p=>failing&&how==='lost'&&HOME(p),
      rewrite:(p,r)=>failing&&how==='429'&&HOME(p)?Response.json({error:'RATE_LIMITED'},{status:429}):r});
    await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
    g.arm('logout');const out=t.client.signOut();await until(()=>g.held('logout'));
    g.arm('read');const read=t.client.restore();await until(()=>g.held('read'));
    g.open('logout');await out;failing=true;g.open('read');await read;await settle();await settle();
    const s=t.client.state;
    assert.deepEqual([s.session,s.home,s.ended,s.checking,statusOf(s,w.clock.now()),t.hint.get()],[null,null,'signed-out',false,'connected',null],how);
    t.stop();
  }
});

test('AUD3-04: an account switch’s logout and an abandoned flow’s logout end a read begun before them, and a session a read showed meanwhile',async()=>{
  for(const path of ['switch','abandon'])for(const when of ['after','before']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),name=path+', read '+when;
    const t=tab(w,b,wallet,{hold:p=>g.wait('logout',LOGOUT,p),holdReply:async p=>{await g.wait('verify',VERIFY,p);await g.wait('read',SESSION,p);}});
    if(path==='switch'){                                                                  // A signed in; the wallet switches to B: A's logout on its way
      await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
      g.arm('logout');wallet.switchTo(B);
    }else{                                                                                // A's verify is answered (A's session made), its reply held; the switch abandons the flow
      g.arm('verify');const flow=t.client.signIn();await until(()=>g.held('verify'));
      wallet.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();
      g.arm('logout');g.open('verify');await flow;                                          // the late success brings A's cookie: revoked by a second logout, on its way
    }
    await until(()=>g.held('logout'));assert.ok(b.jar.has(SESSION_COOKIE),name+': A’s cookie is still live');
    if(when==='after'){g.arm('read');void t.client.restore();await until(()=>g.held('read'));}   // a session read (another tab's message): the Worker answers A, held
    else{await t.client.restore();await until(()=>!t.client.state.checking);
      assert.deepEqual([t.client.state.session?.address,statusOf(t.client.state,w.clock.now())],[a,'mismatch'],name+': the read showed A while the logout was out');}
    const n=t.calls.length;g.open('logout');await until(()=>!b.jar.has(SESSION_COOKIE));await settle();   // the server revokes A
    if(when==='after'){g.open('read');await settle();await settle();}
    const s=t.client.state;
    assert.deepEqual([s.session,s.home,s.account,s.ended,statusOf(s,w.clock.now()),t.hint.get()],[null,null,bAddr,when==='before'?'revoked':null,'connected',null],name);
    // R5: cleanup of an abandoned generation reconciles the shared cookie. It may read, never start a new flow.
    assert.ok(t.calls.slice(n).every(c=>c==='GET /api/auth/session'),name+': only authoritative readback is allowed');
    t.stop();
  }
});

// R5 supersedes the old unconditional-logout expectation here: another tab's newer A session is a different flow,
// even when its address/expiry match the original one. Cancelling the open prompt must preserve that session.
test('AUD3-04 / R5: a provider switch cancels the old prompt but preserves another tab’s newer same-wallet session',async()=>{
  for(const when of ['after','before']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates();
    const wa=fakeWallet(A),wb=fakeWallet(B),subs=new Set();let current=wa,open;wa.gate=new Promise(r=>open=r);wb.granted=true;
    const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
    const t=tab(w,b,null,{registry,hold:p=>g.wait('logout',LOGOUT,p),holdReply:p=>g.wait('read',SESSION,p)});await settle();
    const flow=t.client.signIn();await until(()=>wa.asked.includes('personal_sign'));   // A's prompt is open
    assert.equal((await b.signIn(A)).verify.status,200);                                  // another tab of this profile signs A in
    const newerCookie=b.jar.get(SESSION_COOKIE);
    g.arm('logout');current=wb;for(const fn of subs)fn();await until(()=>g.held('logout'));   // the wallet switches to B: the flow's logout on its way
    if(when==='after'){g.arm('read');void t.client.restore();await until(()=>g.held('read'));}   // a session read: the Worker answers A, held
    else{await t.client.restore();await until(()=>!t.client.state.checking);
      assert.deepEqual([t.client.state.session?.address,statusOf(t.client.state,w.clock.now())],[a,'mismatch'],when+': the read showed A while the logout was out');}
    const n=t.calls.length;g.open('logout');await settle();                               // old nonce cannot revoke the newer A flow
    if(when==='after'){g.open('read');await settle();await settle();}
    open();await flow;await settle();                                                    // A's prompt answered late: nothing verified
    const s=t.client.state;
    assert.deepEqual([s.session?.address,s.home?.address.toLowerCase(),s.account,s.ended,statusOf(s,w.clock.now()),t.hint.get()?.address,posts(t.calls,'/api/auth/verify')],[a,a,bAddr,null,'mismatch',a,0],when);
    assert.equal(b.jar.get(SESSION_COOKIE)===newerCookie,true,when+': newer cookie unchanged');
    assert.equal((await b.get('/api/auth/session').then(r=>r.json())).signedIn,true,when+': newer session remains live');
    assert.ok(t.calls.slice(n).every(c=>c.startsWith('GET ')),when+': no automatic signature or verify');
    t.stop();
  }
});

// And for the sign-in click's own logout of another address's session (the page holds A's session, the wallet says B):
// a session read begun while that logout was on its way, answered after the click ended without signing (B's prompt
// rejected), is not applied. On f4272c5 and d429ec3 it put A back: with the house read failing the page showed A's
// session (mismatch) with no live session at the server and no cookie; with it working, a house read went out and the
// page said "no longer signed in" over the click's own outcome.
test('AUD3-04: the sign-in click’s own logout of another address’s session ends a session read begun while it was on its way, whether the house read then works or fails',async()=>{
  const out={};
  for(const house of ['works','lost']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates();
    assert.equal((await b.signIn(A)).verify.status,200);                                  // this profile holds A's session
    const wallet=fakeWallet(B);wallet.granted=true;wallet.reject=true;let failing=false;
    const t=tab(w,b,wallet,{hold:p=>g.wait('logout',LOGOUT,p),holdReply:p=>g.wait('read',SESSION,p),drop:p=>failing&&HOME(p)});
    await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch');
    assert.deepEqual([t.client.state.session?.address,t.client.state.account],[a,bAddr],house);
    g.arm('logout');const click=t.client.signIn();await until(()=>g.held('logout'));     // the click's logout of A, not at the server yet
    g.arm('read');const read=t.client.restore();await until(()=>g.held('read'));         // a session read (another tab's message): the Worker answers A, held
    failing=house==='lost';g.open('logout');await click;                                 // A revoked, the cookie cleared; B's prompt rejected
    assert.deepEqual([t.client.state.session,t.client.state.notice,statusOf(t.client.state,w.clock.now()),b.jar.has(SESSION_COOKIE)],[null,'sign-rejected','connected',false],house);
    const n=t.calls.length;g.open('read');await read;await settle();await settle();
    const s=t.client.state;
    out[house]=[s.session?.address===a?'A':s.session,s.home===null||s.home==='unavailable'?s.home:'a house',s.ended,s.notice,statusOf(s,w.clock.now()),t.hint.get()?.address===a?'A':t.hint.get(),t.calls.slice(n)];
    t.stop();
  }
  const clean=[null,null,null,'sign-rejected','connected',null,[]];
  assert.deepEqual(out,{works:clean,lost:clean});
});

// loggedOut drops house reads too (homeGen), not only session reads: a house read sent while the sign-out is on its way
// and answered after it is not applied. Fails with loggedOut's homeGen++ removed (A's house stays on a signed-out page).
test('AUD3-04: a house read sent while this page’s sign-out is on its way, answered after it, sets no house',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates();
  const t=tab(w,b,fakeWallet(A),{hold:p=>g.wait('logout',LOGOUT,p),holdReply:p=>g.wait('home',HOME,p)});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');w.clock.advance(20_000);   // past HOME_MIN_GAP_MS
  g.arm('logout');const out=t.client.signOut();await until(()=>g.held('logout'));       // the sign-out on its way
  g.arm('home');const read=t.client.restore();await until(()=>g.held('home'));         // a session read applied (A still live), its house read answered, held
  g.open('logout');await out;g.open('home');await read;await settle();
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.ended,s.checking,statusOf(s,w.clock.now()),t.hint.get()],[null,null,'signed-out',false,'connected',null]);
  t.stop();
});

// Guard (T08, handoff §6.3): fails with loggedOut's generation check removed (a superseded logout's completion drops B's
// house read and ends B's session on the page). Since ADV-3 a click no longer signs B in while A's logout is out (it
// waits for it), so B's session here is the one another tab of the profile set, and the click only re-checks its house
// (B is signed in already: nothing is asked for, so it does not wait).
test('AUD3-04 guard: an account switch’s logout answered after the new account’s house read was sent leaves that house applied and nothing checking',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates();
  const t=tab(w,b,wallet,{holdReply:async p=>{await g.wait('logout',LOGOUT,p);await g.wait('home',HOME,p);}});
  await t.client.signIn();assert.equal(t.client.state.session.address,a);
  g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));                 // A's logout: revoked at the server, its reply held
  assert.equal((await b.signIn(B)).verify.status,200);await t.client.restore();         // another tab of the profile signs B in; this page reads it
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  g.arm('home');const flow=t.client.signIn();await until(()=>g.held('home'));           // the click re-checks B's house: answered, held
  g.open('logout');await settle();                                                       // A's logout lands (its Max-Age=0 also drops B's cookie here: T13's residual)
  g.open('home');await flow;await settle();
  const s=t.client.state;
  assert.deepEqual([s.session?.address,s.checking,s.home?.seats?.map(x=>x.tokenId),statusOf(s,w.clock.now())],[bAddr,false,['921'],'owner']);
  t.stop();
});

test('AUD3-05: a house read answered for the address another tab signed in, whose session re-read is refused (429), leaves no owner mode and nothing checking (the reproduction)',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser();let refuse=false;
  const t=tab(w,b,fakeWallet(A),{rewrite:(p,r)=>refuse&&SESSION(p)?Response.json({error:'RATE_LIMITED'},{status:429}):r});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  assert.equal((await b.signIn(B)).verify.status,200);                                    // another tab of this browser profile signs in B: the cookie is B's
  refuse=true;await t.client.refreshHome(true,true);                                      // Check again: the house answers for B; the session re-read gets 429
  const s=t.client.state;
  assert.deepEqual([statusOf(s,w.clock.now()),ownerAddress(s,w.clock.now()),s.checking,s.home,s.sessionKnown],['ownershipUnavailable',null,false,'unavailable',false]);
  t.stop();
});

test('AUD3-05: the same for a 503 and a lost connection',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const how of ['503','lost']){
    const b=w.browser();let failing=false;
    const t=tab(w,b,fakeWallet(A),{drop:p=>failing&&how==='lost'&&SESSION(p),rewrite:(p,r)=>failing&&how==='503'&&SESSION(p)?Response.json({error:'AUTH_UNAVAILABLE'},{status:503}):r});
    await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
    assert.equal((await b.signIn(B)).verify.status,200);
    failing=true;await t.client.refreshHome(true,true);
    const s=t.client.state;
    assert.deepEqual([statusOf(s,w.clock.now()),ownerAddress(s,w.clock.now()),s.checking,s.home],['ownershipUnavailable',null,false,'unavailable'],how);
    t.stop();
  }
});

// Guard (T10): fails with the mismatch branch returning without restore() (the page keeps A's session, unconfirmed).
test('AUD3-05 guard: once the session read works again, Check again finds the cookie’s session (B, a mismatch with account A) and nothing stays checking',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser();let refuse=false;
  const t=tab(w,b,fakeWallet(A),{rewrite:(p,r)=>refuse&&SESSION(p)?Response.json({error:'RATE_LIMITED'},{status:429}):r});
  await t.client.signIn();assert.equal((await b.signIn(B)).verify.status,200);
  refuse=true;await t.client.refreshHome(true,true);refuse=false;
  w.clock.advance(20_000);await t.client.refreshHome(true,true);                        // Check again, the session read working
  const s=t.client.state;
  assert.deepEqual([statusOf(s,w.clock.now()),s.session?.address,s.account,s.home?.address?.toLowerCase(),s.checking,ownerAddress(s,w.clock.now())],['mismatch',bAddr,a,bAddr,false,null]);
  t.stop();
});

test('AUD3-07: “Log out all devices” on a session the server says ran out reads as expired, and still says other devices were not signed out (the reproduction)',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),pageNow=w.clock.now();
  const t=tab(w,w.browser(),fakeWallet(A),{env:fakeEnv(),now:()=>pageNow});await t.client.signIn();
  assert.equal(statusOf(t.client.state,pageNow),'owner');
  w.clock.advance(7*DAY+1);                                                               // the Worker's clock is past the expiry; the page's is not
  const n=t.calls.length;await t.client.signOut(true);
  const s=t.client.state;
  assert.deepEqual([s.session,s.expired,s.ended,s.notice,s.leaving,statusOf(s,pageNow),t.calls.slice(n)],[null,true,'expired','signout-all-stale',false,'expired',['POST /api/auth/logout-all','GET /api/auth/session']]);
  t.stop();
});

test('AUD3-07: when the follow-up session read fails (429, 503), the page still says other devices were not signed out, and a click reads the session again before it signs',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const status of [429,503]){
    w.clock.set(START);let lag=0,refuse=false;const wallet=fakeWallet(A);
    const t=tab(w,w.browser(),wallet,{env:fakeEnv(),now:()=>w.clock.now()-lag,rewrite:(p,r)=>refuse&&SESSION(p)?Response.json({error:status===429?'RATE_LIMITED':'AUTH_UNAVAILABLE'},{status}):r});
    await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
    lag=7*DAY+1;w.clock.advance(7*DAY+1);                                                 // the page's clock stays behind the Worker's
    refuse=true;const n=t.calls.length;await t.client.signOut(true);refuse=false;
    const s=t.client.state;
    assert.deepEqual([s.session,s.expired,s.ended,s.notice,s.sessionKnown,s.leaving,t.calls.slice(n)],[null,true,'expired','signout-all-stale',false,false,['POST /api/auth/logout-all','GET /api/auth/session']],String(status));
    lag=0;const m=t.calls.length;await t.client.signIn();                                  // the click: the session first, then one signature
    assert.deepEqual([t.calls.slice(m),wallet.signed,t.client.state.session?.address,statusOf(t.client.state,w.clock.now())],
      [['GET /api/auth/session','POST /api/auth/challenge','POST /api/auth/verify','GET /api/me/home'],2,a,'owner'],String(status));
    t.stop();
  }
});

// Guard (T15): fails with every 401 of logout-all read as 'expired' (a revocation, or a body nobody can read, would claim
// an expiry).
test('AUD3-07 guard: an AUTH_REQUIRED or unreadable 401 stays “other devices were not signed out” with no cause claimed',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
  for(const how of ['AUTH_REQUIRED','unreadable']){
    const laptop=w.browser(),t=tab(w,laptop,fakeWallet(A),{rewrite:(p,r)=>how==='unreadable'&&p==='/api/auth/logout-all'&&r.status===401?new Response('<html>401</html>',{status:401}):r});
    await t.client.signIn();
    const copy=w.browser();copy.jar.set(SESSION_COOKIE,laptop.jar.get(SESSION_COOKIE));
    assert.equal((await copy.post('/api/auth/logout')).status,204,'the laptop cookie is ended elsewhere');
    await t.client.signOut(true);
    const s=t.client.state;
    assert.deepEqual([s.session,s.expired,s.ended,s.notice,statusOf(s,w.clock.now())],[null,false,null,'signout-all-stale','connected'],how);
    t.stop();
  }
});

// Guard (T15): the stale logout-all answer must not replace the newer authoritative cleanup read's state;
// R5's address-bound cleanup is refused for expired A and therefore reads the confirmed expiry before the old answer.
// 'follow-up read' fails with the check after the follow-up session read removed
// (the old notice lands on the new flow's open prompt).
test('AUD3-07 guard: a logout-all answer, or its follow-up read, that lands after the account switched changes nothing of the new state',async()=>{
  for(const late of ['answer','follow-up read']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}});
    const laptop=w.browser(),wallet=fakeWallet(A),signs=prompts(wallet),g=gates();let lag=0;const now=()=>w.clock.now()-lag;
    const t=tab(w,laptop,wallet,{env:fakeEnv(),now,holdReply:async p=>{await g.wait('all',q=>q==='/api/auth/logout-all',p);await g.wait('read',SESSION,p);}});
    await t.client.signIn();
    if(late==='answer'){
      lag=7*DAY+1;w.clock.advance(7*DAY+1);                                                 // as AUD3-07's reproduction: the server says SESSION_EXPIRED
      g.arm('all');const out=t.client.signOut(true);await until(()=>g.held('all'));         // the 401 is answered, held
      wallet.switchTo(B);await until(()=>t.client.state.sessionKnown&&t.client.state.expired);await settle();
      assert.equal(posts(t.calls,'/api/auth/logout'),1,'v1.1 account-switch has its own displayed-address primary, independent of old logout-all');
      const before=t.client.state;
      assert.deepEqual([before.account,before.session,before.notice,before.expired,before.ended,statusOf(before,now())],[bAddr,null,null,true,'expired','expired'],late+': fresh read confirms expiry');
      g.open('all');await out;await settle();
      const s=t.client.state;
      assert.deepEqual([s.account,s.session,s.notice,s.expired,s.ended,s.leaving,statusOf(s,now())],[bAddr,null,null,true,'expired',false,'expired'],late);
    }else{
      const copy=w.browser();copy.jar.set(SESSION_COOKIE,laptop.jar.get(SESSION_COOKIE));assert.equal((await copy.post('/api/auth/logout')).status,204);
      g.arm('read');const out=t.client.signOut(true);
      await until(()=>g.held('read')||t.client.state.notice==='signout-all-stale');        // the follow-up read, answered and held (f4272c5 sends none)
      g.disarm('read');                                                                     // f4272c5: no follow-up read took the gate
      wallet.switchTo(B);await t.client.restore();                                          // B is merely connected; another tab's message: a newer read
      let open;wallet.gate=new Promise(r=>open=r);const flow=t.client.signIn();await until(()=>signs.length===2);   // B's click: its prompt is open
      g.open('read');await out;await settle();
      const s=t.client.state;
      assert.deepEqual([s.phase,s.notice,s.signing?.address.toLowerCase(),s.account,s.leaving],['awaitingSignature',null,bAddr,bAddr,false],late);
      open();await flow;
      assert.deepEqual([t.client.state.session?.address,t.client.state.notice,statusOf(t.client.state,w.clock.now())],[bAddr,null,'signedInNoHouse'],late);
    }
    t.stop();
  }
});

// A refused logout-all drops the house read in flight (homeGen) before its follow-up session read: when that read fails
// (429), nothing else would. Fails with that homeGen++ removed (A's house lands on the signed-out page).
test('AUD3-07: a house read in flight across a refused logout-all whose follow-up session read fails sets no house',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),laptop=w.browser(),g=gates();let refuse=false;
  const t=tab(w,laptop,fakeWallet(A),{hold:p=>g.wait('all',q=>q==='/api/auth/logout-all',p),holdReply:p=>g.wait('home',HOME,p),
    rewrite:(p,r)=>refuse&&SESSION(p)?Response.json({error:'RATE_LIMITED'},{status:429}):r});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');w.clock.advance(20_000);
  g.arm('all');const out=t.client.signOut(true);await until(()=>g.held('all'));          // logout-all on its way
  g.arm('home');const read=t.client.restore();await until(()=>g.held('home'));         // a house read answered for A, held
  const copy=w.browser();copy.jar.set(SESSION_COOKIE,laptop.jar.get(SESSION_COOKIE));
  assert.equal((await copy.post('/api/auth/logout')).status,204,'the laptop cookie is ended elsewhere');
  refuse=true;g.open('all');await out;refuse=false;                                     // 401; the follow-up session read is refused (429)
  g.open('home');await read;await settle();
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.notice,s.checking,statusOf(s,w.clock.now())],[null,null,'signout-all-stale',false,'connected']);
  t.stop();
});

// T12/T15, the page side of AUD3-06 with AUD3-07's follow-up read: a refused logout-all clears no cookie any more, so the
// one the browser holds when the 401 lands may be the one another tab of the profile has just set; this page reads it
// afresh instead of taking the 401 for "no session" (on f4272c5 the late 401's Max-Age=0 deleted that cookie, and the
// page stayed signed out over it).
test('AUD3-06: a refused logout-all (401) answered after another tab of the profile signed in leaves this page on that tab’s session, read afresh, and still says other devices were not signed out',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),laptop=w.browser(),g=gates();
  const t=tab(w,laptop,fakeWallet(A),{holdReply:p=>g.wait('all',q=>q==='/api/auth/logout-all',p)});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  const copy=w.browser();copy.jar.set(SESSION_COOKIE,laptop.jar.get(SESSION_COOKIE));
  assert.equal((await copy.post('/api/auth/logout')).status,204,'the laptop cookie is ended elsewhere');
  g.arm('all');const out=t.client.signOut(true);await until(()=>g.held('all'));          // the 401 is answered, held
  assert.equal((await laptop.signIn(A)).verify.status,200);const fresh=laptop.jar.get(SESSION_COOKIE);   // another tab of this profile signs in
  await t.client.restore();                                                              // its 'signed-in' message: this page reads the session
  g.open('all');await out;await until(()=>!t.client.state.checking);                    // then the refused logout-all lands
  const s=t.client.state;
  assert.deepEqual([statusOf(s,w.clock.now()),s.session?.address,s.notice,laptop.jar.get(SESSION_COOKIE)===fresh,(await laptop.get('/api/me/home')).status],
    ['owner',a,'signout-all-stale',true,200]);
  t.stop();
});

// The final check of 125248c (ADV-1..ADV-3, probes P13..P15). One registry-driven page: the profile holds A's session,
// the chosen wallet is on B (a mismatch), and `pickNew()` makes another wallet current (a pick, or a late EIP-6963 one).
function chosenWallets(w,b,{A,B,granted=null,...opts}){
  const wb=fakeWallet(B),wn=fakeWallet(A),subs=new Set();let current=wb;wb.granted=true;wn.granted=granted==='A';
  const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}},t=tab(w,b,null,{registry,...opts});
  return {t,wb,wn,pickNew:()=>{current=wn;for(const fn of subs)fn();},signs:()=>[...wb.asked,...wn.asked].filter(m=>m==='personal_sign').length};
}

// ADV-1 (P14): another wallet becomes current while the click's own logout of A is on its way. The click is busy, so
// providerChanged takes a generation but, with no flow yet, sends no logout and clears nothing; on 125248c (and f4272c5)
// the click's confirmed logout then skipped loggedOut (its generation was old), and the page kept A's session, house and
// hint (owner mode once the new wallet named A) after the server had revoked A.
test('ADV-1: the sign-in click’s own logout of A, confirmed after another wallet became current, ends A on the page: no session, house, hint or owner mode (the reproduction)',async()=>{
  const out={};
  for(const granted of ['none','A']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),g=gates();
    assert.equal((await b.signIn(A)).verify.status,200);                                  // this profile holds A's session
    const {t,pickNew,signs}=chosenWallets(w,b,{A,B,granted,hold:p=>g.wait('logout',LOGOUT,p)});
    await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
    g.arm('logout');const click=t.client.signIn();await until(()=>g.held('logout'));     // the click's logout of A, not at the server yet
    pickNew();await settle();                                                             // another wallet is current (none granted, or A)
    g.open('logout');await click;await settle();await settle();                           // A revoked, the cookie cleared
    const s=t.client.state;
    out[granted]=[s.session,s.home,s.checking,statusOf(s,w.clock.now()),t.hint.get(),signs(),posts(t.calls,'/api/auth/challenge'),b.jar.has(SESSION_COOKIE),
      (await b.get('/api/auth/session').then(r=>r.json())).signedIn];
    t.stop();
  }
  assert.deepEqual(out,{none:[null,null,false,'visitor',null,0,0,false,false],A:[null,null,false,'connected',null,0,0,false,false]});
});

// Guard (ADV-1): the click's confirmed logout ends only the very session it was sent for. Passes on 125248c (the old
// generation's answer was dropped); fails with the session compared by address only ('A again': another tab signed A
// in anew, a later expiresAt) or not at all ('C'). That late 204 still deletes the newer cookie in this browser (T13's
// residual, AUD3-06): this pins what the page shows.
test('ADV-1 guard: a newer session the page holds when the click’s logout of A is confirmed (A signed in anew, or C, by another tab) is left alone',async()=>{
  const out={};
  for(const newer of ['A again','C']){
    const A=newAccount(),B=newAccount(),C=newAccount(),w=world(),b=w.browser(),g=gates(),who=(newer==='C'?C:A).address.toLowerCase();
    assert.equal((await b.signIn(A)).verify.status,200);
    const {t,pickNew,signs}=chosenWallets(w,b,{A,B,holdReply:p=>g.wait('logout',LOGOUT,p)});
    await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
    const first=t.client.state.session;
    g.arm('logout');const click=t.client.signIn();await until(()=>g.held('logout'));     // A revoked at the server, the answer held
    pickNew();await settle();w.clock.advance(60_000);
    assert.equal((await b.signIn(newer==='C'?C:A)).verify.status,200);await t.client.restore();   // another tab signs in; this page reads it
    const held=t.client.state.session;assert.ok(held&&held.expiresAt!==first.expiresAt,newer);
    g.open('logout');await click;await settle();await settle();
    const s=t.client.state;
    out[newer]=[s.session?.address===who&&s.session.expiresAt===held.expiresAt,t.hint.get()?.expiresAt===held.expiresAt,signs()];
    t.stop();
  }
  assert.deepEqual(out,{'A again':[true,true,0],C:[true,true,0]});
});

// ADV-2 (P15): another tab of the profile holds A as owner; this tab's wallet is on B. The click logs A out (revoked,
// cookie cleared), then B's prompt is rejected. On 125248c the click told no other tab, so that tab stayed in owner mode
// for A until its next re-check; a sign-out and an account switch already told them.
test('ADV-2: the sign-in click’s confirmed logout of A is told to the other tabs: one that showed A as owner reads the server and leaves owner mode, B not signed in (the reproduction)',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),name='imd-auth-test-'+Math.random();
  assert.equal((await b.signIn(A)).verify.status,200);
  const wa=fakeWallet(A),wb=fakeWallet(B);wa.granted=wb.granted=true;wb.reject=true;
  const other=tab(w,b,wa,{channel:name}),me=tab(w,b,wb,{channel:name}),reads=()=>other.calls.filter(c=>c==='GET /api/auth/session').length;
  await until(()=>statusOf(other.client.state,w.clock.now())==='owner'&&statusOf(me.client.state,w.clock.now())==='mismatch'&&!me.client.state.checking);
  const n=reads();await me.client.signIn();await until(()=>other.client.state.session===null);
  const s=other.client.state;
  assert.deepEqual([me.client.state.notice,statusOf(me.client.state,w.clock.now()),s.session,statusOf(s,w.clock.now()),reads()-n,b.jar.has(SESSION_COOKIE)],
    ['sign-rejected','connected',null,'connected',1,false]);
  other.stop();me.stop();
});

// ADV-3 (P13): the account switch's logout (sent with A's cookie) is not waited for, and on 125248c the click that signs
// B in did not wait for it either. 'answer': its 204 landing after B's verify deleted B's new cookie (the page showed B
// as owner with no cookie, B's session left live at the server). 'request': reaching the server after B's verify (the
// cookie read on arrival), it revoked B's new session and left A's. Now the click asks nothing until it has answered.
test('ADV-3: an account switch’s logout still on its way when the click comes: the click waits for it, then B signs in with one prompt and one verify and keeps its cookie (the reproduction)',async()=>{
  const out={};
  for(const held of ['answer','request']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),signs=prompts(wallet);
    const gate=p=>g.wait('logout',LOGOUT,p),t=tab(w,b,wallet,held==='answer'?{holdReply:gate}:{hold:gate});
    await t.client.signIn();const aJar=new Map(b.jar);
    g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));                 // the switch's logout of A, held
    const n=t.calls.length,click=t.client.signIn();await settle();await settle();
    const waited=[t.calls.slice(n),signs.length];                                        // nothing asked while it is out
    g.open('logout');await click;await settle();
    const s=t.client.state,stale=w.browser();stale.jar=aJar;
    out[held]=[...waited,signs.map(x=>x===a?'A':x===bAddr?'B':x),posts(t.calls,'/api/auth/verify'),s.session?.address===bAddr,statusOf(s,w.clock.now()),b.jar.has(SESSION_COOKIE),
      (await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()===bAddr,(await stale.get('/api/me/home')).status];
    t.stop();
  }
  const ok=[[],1,['A','B'],2,true,'owner',true,true,401];
  assert.deepEqual(out,{answer:ok,request:ok});
});

// ADV-3: the same for this page's own sign-out (a mismatch shows "Sign in as B" beside "Log out this device"): on
// 125248c the click went ahead while the sign-out was out, and that logout's late 204 deleted B's new cookie.
test('ADV-3: a click while this page’s sign-out is on its way waits for it, then signs B in, and B keeps its cookie',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),g=gates();
  assert.equal((await b.signIn(A)).verify.status,200);
  const wallet=fakeWallet(B);wallet.granted=true;const t=tab(w,b,wallet,{holdReply:p=>g.wait('logout',LOGOUT,p)});
  await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
  g.arm('logout');const out=t.client.signOut();await until(()=>g.held('logout'));       // "Log out this device": A revoked, the answer held
  const n=t.calls.length,click=t.client.signIn();await settle();await settle();
  const waited=t.calls.slice(n);
  g.open('logout');await out;await click;await settle();
  const s=t.client.state;
  assert.deepEqual([waited,wallet.signed,posts(t.calls,'/api/auth/logout'),s.session?.address===bAddr,statusOf(s,w.clock.now()),b.jar.has(SESSION_COOKIE),
    (await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()===bAddr],[[],1,1,true,'owner',true,true]);
  t.stop();
});

// ADV-3: an abandoned flow's verify is waited for too: its late success brings A's cookie and is then logged out
// (revokeAbandoned), and either answer, landing after B's verify, would replace or delete B's cookie (on 125248c A's
// late cookie replaced B's and its logout then cleared it: the page ended signed out with B's session left live).
test('ADV-3: an abandoned flow’s verify still on its way when the click comes: the click waits until that late session is logged out, then B signs in and keeps its cookie',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),signs=prompts(wallet);
  const t=tab(w,b,wallet,{holdReply:p=>g.wait('verify',VERIFY,p)});await settle();
  g.arm('verify');const flow=t.client.signIn();await until(()=>g.held('verify'));      // A's verify: A's session made at the server, the answer held
  wallet.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();   // the switch abandons the flow
  const n=t.calls.length,click=t.client.signIn();await Promise.race([click,new Promise(r=>setTimeout(r,200))]);
  const waited=t.calls.slice(n);
  g.open('verify');await flow;await click;await settle();
  const s=t.client.state,live=w.db.raw.prepare('SELECT lower(address) a FROM sessions WHERE revoked_at IS NULL').all().map(r=>r.a===bAddr?'B':r.a===a?'A':r.a);
  assert.deepEqual([waited,signs.map(x=>x===a?'A':x===bAddr?'B':x),posts(t.calls,'/api/auth/verify'),posts(t.calls,'/api/auth/logout'),s.session?.address===bAddr,
    statusOf(s,w.clock.now()),b.jar.has(SESSION_COOKIE),(await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()===bAddr,live],
    [[],['A','B'],2,2,true,'owner',true,true,['B']]);
  t.stop();
});

// ADV-3: the wait is bounded. A logout that does not answer (a hung connection) ends the click after LOGOUT_WAIT_MS with
// nothing asked: no challenge, prompt or verify, and "that log-out hasn't been answered yet, so no signature was
// requested" (since the re-check of 2f5d6c1, ADVR-5; before, "couldn't check whether you're already signed in", which
// was not the reason). Once it has answered, the next click signs B in as usual. On 125248c the click asked for B's
// signature at once.
test('ADV-3: a logout of this page that does not answer never leads to a prompt: after LOGOUT_WAIT_MS the click ends asking nothing; once it answered, the next click signs B in',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),signs=prompts(wallet),env=fakeEnv();
  const t=tab(w,b,wallet,{env,hold:p=>g.wait('logout',LOGOUT,p)});
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));                 // the switch's logout of A: no answer
  const n=t.calls.length,asked=wallet.asked.filter(m=>m!=='eth_accounts').length,click=t.client.signIn();
  await until(()=>env.live().some(x=>x.ms===LOGOUT_WAIT_MS));const bound=env.live().find(x=>x.ms===LOGOUT_WAIT_MS);
  assert.ok(bound,'the click waits, and only so long');assert.equal(t.client.state.waiting,true);env.fire(bound);await click;await settle();
  const s=t.client.state;
  assert.deepEqual([t.calls.slice(n),signs.length,wallet.asked.filter(m=>m!=='eth_accounts').length-asked,s.phase,s.notice,s.waiting,s.session,statusOf(s,w.clock.now())],
    [[],1,0,'idle','logout-slow',false,null,'connected']);
  assert.deepEqual([noticeText('logout-slow',(zh,en)=>en),noticeText('logout-slow',zh=>zh)],['A log-out (or a cancelled sign-in) this page sent earlier hasn’t been answered yet, so no signature was requested. Try again in a moment.',
    '這個頁面先前送出的登出（或已取消的登入）還沒有得到回應，所以沒有要求簽名；請稍後再按一次。']);
  g.open('logout');await until(()=>!b.jar.has(SESSION_COOKIE));await settle();await t.client.signIn();
  assert.deepEqual([signs.map(x=>x===a?'A':x===bAddr?'B':x),statusOf(t.client.state,w.clock.now()),t.client.state.notice,b.jar.has(SESSION_COOKIE)],[['A','B'],'owner',null,true]);
  t.stop();
});

// Guard (ADV-3 with ADV-1's rule): a click waiting for the switch's logout is busy but idle, so another wallet chosen
// then takes a generation and sends no logout of its own; a read that found A before that logout reached the server
// must still end when it is confirmed (the logout names the session it ended). Passes on 125248c (the click was in its
// prompt by then, and the wallet switch's own logout ended A); fails with the switch's logout naming no session (owner
// mode for revoked A).
test('ADV-3 guard: another wallet chosen while the click waits for an account switch’s logout, after a read found A again: A ends on the page once that logout is confirmed',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates();
  const wa=fakeWallet(A),wn=fakeWallet(A),subs=new Set();let current=wa,open;wn.granted=true;
  const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
  const t=tab(w,b,null,{registry,hold:p=>g.wait('logout',LOGOUT,p)});await settle();
  await t.client.signIn();assert.equal(statusOf(t.client.state,w.clock.now()),'owner');wa.gate=new Promise(r=>open=r);
  g.arm('logout');wa.switchTo(B);await until(()=>g.held('logout'));                     // the switch's logout of A, not at the server yet
  const click=t.client.signIn();await settle();await settle();                           // the click for B (now: waits; on 125248c: B's prompt open)
  await t.client.restore();assert.equal(t.client.state.session?.address,a);              // a read (another tab's message) still finds A
  current=wn;for(const fn of subs)fn();await until(()=>t.client.state.account===a);      // another wallet, A granted, is chosen
  g.open('logout');await until(()=>!b.jar.has(SESSION_COOKIE));open();await click;await settle();await settle();
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.checking,statusOf(s,w.clock.now()),t.hint.get(),(await b.get('/api/auth/session').then(r=>r.json())).signedIn],[null,null,false,'connected',null,false]);
  t.stop();
});

// Guard (ADV-3): nothing held. After an account switch (its logout answered, or still out at the click and answering at
// once) and on a mismatch (the click logs A out itself), B signs in with one prompt for B, one challenge and one verify,
// and keeps its cookie. Passes on 125248c; fails if a click that waited for a logout does not go on once it answered.
test('ADV-3 guard: after an account switch, and on a mismatch, the click signs B in with one prompt for B, one challenge and one verify, and B keeps its cookie',async()=>{
  const out={};
  for(const path of ['switch','switch, at once','mismatch']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),signs=prompts(wallet);
    let t,aJar;
    if(path!=='mismatch'){t=tab(w,b,wallet);await t.client.signIn();aJar=new Map(b.jar);wallet.switchTo(B);
      if(path==='switch'){await until(()=>!b.jar.has(SESSION_COOKIE));await settle();}}
    else{assert.equal((await b.signIn(A)).verify.status,200);aJar=new Map(b.jar);wallet.account=B;wallet.granted=true;t=tab(w,b,wallet);
      await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);}
    const n=t.calls.length,asked=signs.length;await t.client.signIn();
    const stale=w.browser();stale.jar=aJar;
    out[path]=[signs.slice(asked).map(x=>x===bAddr?'B':x),t.calls.slice(n).filter(c=>c.startsWith('POST ')),statusOf(t.client.state,w.clock.now()),b.jar.has(SESSION_COOKIE),
      (await stale.get('/api/me/home')).status];
    t.stop();
  }
  const switched=[['B'],['POST /api/auth/challenge','POST /api/auth/verify'],'owner',true,401];
  assert.deepEqual(out,{switch:switched,'switch, at once':switched,mismatch:[['B'],['POST /api/auth/logout','POST /api/auth/challenge','POST /api/auth/verify'],'owner',true,401]});
});

// The team's re-check of 2f5d6c1 (ADVR-1..ADVR-5, probes Q1..Q12). ADV-1's rule reaches the two logouts 10bb630 left
// out (this page's own sign-out and an abandoned flow's late session): a click waiting for a logout is busy but idle, so
// another wallet chosen then takes a generation, sends no logout and clears nothing, and that logout's confirmation was
// the only thing left to end the session on the page. The holds and the wait's re-checks get guards; the wait is shown.

// ADV-1 (Q1): "Log out this device" on a mismatch (the profile holds A, the chosen wallet is on B), the click for B (it
// waits for that logout), then another wallet becomes current (none granted, or A). On 2f5d6c1 the confirmed sign-out
// returned as "a newer flow decides": A's session, house and hint stayed (owner mode once the new wallet named A), no
// "Signed out.", and another tab stayed owner for revoked A, until the next re-check.
test('ADV-1 v1.1: explicit logout and later provider switch have separate primary decisions; canonical absence ends A and peers',async()=>{
  const out={};
  for(const granted of ['none','A'])for(const held of ['answer','request']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),g=gates(),name='imd-auth-test-'+Math.random();
    assert.equal((await b.signIn(A)).verify.status,200);                                  // this profile holds A's session
    const wa=fakeWallet(A);wa.granted=true;const other=tab(w,b,wa,{channel:name}),gate=p=>g.wait('logout',LOGOUT,p);
    const {t,pickNew,signs}=chosenWallets(w,b,{A,B,granted,channel:name,...held==='answer'?{holdReply:gate}:{hold:gate}});
    await until(()=>statusOf(other.client.state,w.clock.now())==='owner'&&statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
    g.arm('logout');const out1=t.client.signOut();await until(()=>g.held('logout'));     // "Log out this device": A's logout on its way
    const click=t.client.signIn();await settle();                                         // the click for B waits for it (busy, idle)
    pickNew();await settle();                                                             // another wallet is current: the click ends
    g.open('logout');await out1;await click;await until(()=>other.client.state.session===null);   // A revoked, the cookie cleared
    assert.deepEqual(t.cleanups.map(e=>e.kind),['explicit','displayed-session'],'one primary for each distinct user lifecycle event');
    assert.deepEqual([w.db.raw.prepare('SELECT count(*) n FROM sessions').get().n,w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n],[1,0]);
    const s=t.client.state;
    out[granted+', '+held]=[s.session,s.home,s.checking,s.ended,s.leaving,s.notice,statusOf(s,w.clock.now()),t.hint.get(),signs(),posts(t.calls,'/api/auth/logout'),
      b.jar.has(SESSION_COOKIE),(await b.get('/api/auth/session').then(r=>r.json())).signedIn,statusOf(other.client.state,w.clock.now())];
    other.stop();t.stop();
  }
  // The newer provider event reads canonical absence; its view is not labelled by the superseded explicit closure.
  const done=st=>[null,null,false,'revoked',false,null,st,null,0,2,false,false,'connected'];
  assert.deepEqual(out,{'none, answer':done('visitor'),'none, request':done('visitor'),'A, answer':done('connected'),'A, request':done('connected')});
});

// ADV-1 (Q2): an abandoned flow's late session. A's verify is answered after the switch to B, so its cookie arrives and
// the page logs it out (revokeAbandoned; that logout held). The click for B waits; a read (another tab's message) shows
// that late session; another wallet, A granted, becomes current (owner mode for it); then that logout is confirmed. On
// 2f5d6c1 nothing ended it on the page: owner mode, house and hint for a session the server had revoked.
test('ADV-1: an abandoned flow’s late session, shown by a read while a click waited for its logout, ends on the page when that logout is confirmed after another wallet became current',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),g=gates();
  const wa=fakeWallet(A),wn=fakeWallet(A),subs=new Set();let current=wa;wn.granted=true;
  const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
  const t=tab(w,b,null,{registry,hold:p=>g.wait('logout',LOGOUT,p),holdReply:p=>g.wait('verify',VERIFY,p)});await settle();
  g.arm('verify');const flow=t.client.signIn();await until(()=>g.held('verify'));      // A's verify: A's session made at the server, the answer held
  wa.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();   // the switch abandons the flow (its logout, no cookie yet)
  g.arm('logout');g.open('verify');await flow;await until(()=>g.held('logout'));       // the late answer brings A's cookie; its logout on its way
  assert.ok(b.jar.has(SESSION_COOKIE),'A’s late cookie arrived');
  const click=t.client.signIn();await settle();                                         // the click for B waits for that logout
  await t.client.restore();await until(()=>!t.client.state.checking);assert.equal(t.client.state.session?.address,a,'a read shows A’s late session');
  current=wn;for(const fn of subs)fn();await until(()=>statusOf(t.client.state,w.clock.now())==='owner');   // another wallet, A granted: owner mode for it
  g.open('logout');await click;await until(()=>!b.jar.has(SESSION_COOKIE));await settle();   // the late session revoked, the cookie cleared
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.checking,statusOf(s,w.clock.now()),t.hint.get(),wa.signed+wn.signed,(await b.get('/api/auth/session').then(r=>r.json())).signedIn],
    [null,null,false,'connected',null,1,false]);
  t.stop();
});

// Guard (ADV-2, Q10): the click's confirmed logout of A is told to the other tabs even when the click has ended (another
// wallet chosen while that logout was out: ADV-1's case). Fails with the broadcast limited to a click still live.
test('ADV-2 guard: the confirmed logout of a click that another wallet ended is still told to the other tabs',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates(),name='imd-auth-test-'+Math.random();
  assert.equal((await b.signIn(A)).verify.status,200);
  const wa=fakeWallet(A);wa.granted=true;const other=tab(w,b,wa,{channel:name});
  const {t,pickNew}=chosenWallets(w,b,{A,B,channel:name,holdReply:p=>g.wait('logout',LOGOUT,p)});
  await until(()=>statusOf(other.client.state,w.clock.now())==='owner'&&statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
  g.arm('logout');const click=t.client.signIn();await until(()=>g.held('logout'));     // the click's logout of A: A revoked, the answer held
  pickNew();await settle();g.open('logout');await click;await until(()=>other.client.state.session===null);
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),statusOf(other.client.state,w.clock.now()),other.client.state.session,b.jar.has(SESSION_COOKIE)],['visitor','connected',null,false]);
  other.stop();t.stop();
});

// Guards (ADV-3, Q3, Q4, Q8): every logout the page does not wait for itself is held, so a click waits for its answer
// even when nothing else orders it before the new verify (each logout's answer held here). Each fails with its logout not
// held: the new account signs in, then that answer's Max-Age=0 deletes the new cookie (as on 125248c, for Q3 and Q4).
test('ADV-3 guard: the sign-in click’s own logout of A still out when another wallet is chosen: the next click, for that wallet’s account, waits for it, and that account keeps its cookie',async()=>{
  const A=newAccount(),B=newAccount(),C=newAccount(),c=C.address.toLowerCase(),w=world(),b=w.browser(),g=gates();
  assert.equal((await b.signIn(A)).verify.status,200);                                  // this profile holds A's session
  const wb=fakeWallet(B),wc=fakeWallet(C),subs=new Set();let current=wb;wb.granted=wc.granted=true;
  const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
  const t=tab(w,b,null,{registry,holdReply:p=>g.wait('logout',LOGOUT,p)});
  await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
  g.arm('logout');const first=t.client.signIn();await until(()=>g.held('logout'));     // the click's logout of A: A revoked, the answer held
  current=wc;for(const fn of subs)fn();await until(()=>t.client.state.account===c);    // another wallet, C granted: that click ends
  const n=t.calls.length,click=t.client.signIn();await settle();await settle();
  const waited=t.calls.slice(n);
  g.open('logout');await first;await click;await settle();
  assert.deepEqual([waited,wc.signed,t.client.state.session?.address,b.jar.has(SESSION_COOKIE),(await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()],[[],1,c,true,c]);
  t.stop();
});

test('ADV-3 v1.1: pending-only provider switch cancels locally, next click gets its own preflight and retains its cookie',async()=>{
  const B=newAccount(),C=newAccount(),bAddr=B.address.toLowerCase(),c=C.address.toLowerCase(),w=world(),b=w.browser(),g=gates();
  const wb=fakeWallet(B),wc=fakeWallet(C),subs=new Set();let current=wb,open;wb.granted=wc.granted=true;wb.gate=new Promise(r=>open=r);
  const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
  const t=tab(w,b,null,{registry,holdReply:p=>g.wait('logout',LOGOUT,p)});await until(()=>t.client.state.account===bAddr&&t.client.state.sessionKnown);
  const flow=t.client.signIn();await until(()=>wb.asked.includes('personal_sign'));     // B's prompt is open
  current=wc;for(const fn of subs)fn();await settle();assert.equal(posts(t.calls,'/api/auth/logout'),0); // no server cleanup authority before verify
  open();await flow;await until(()=>t.client.state.account===c);                       // B's prompt answered into nothing
  const n=t.calls.length;await t.client.signIn();await settle();
  assert.deepEqual([t.calls.slice(n),wb.signed,wc.signed,posts(t.calls,'/api/auth/verify'),t.client.state.session?.address,b.jar.has(SESSION_COOKIE),
    (await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()],[['GET /api/auth/session','POST /api/auth/challenge','POST /api/auth/verify','GET /api/me/home'],1,1,1,c,true,c]);
  t.stop();
});

test('ADV-3 guard: an abandoned flow’s late session whose logout is still out when the click comes: the click waits for that logout, and B keeps its cookie',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),signs=prompts(wallet);
  const t=tab(w,b,wallet,{holdReply:async p=>{await g.wait('verify',VERIFY,p);await g.wait('logout',LOGOUT,p);}});await settle();
  g.arm('verify');const flow=t.client.signIn();await until(()=>g.held('verify'));      // A's verify: A's session made at the server, the answer held
  wallet.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();await settle();   // the switch abandons the flow; its logout answered
  g.arm('logout');g.open('verify');await flow;await until(()=>g.held('logout'));       // A's late cookie; its logout revokes it, the answer held
  const n=t.calls.length,click=t.client.signIn();await settle();await settle();
  const waited=t.calls.slice(n);
  g.open('logout');await click;await settle();
  const s=t.client.state;
  assert.deepEqual([waited,signs.map(x=>x===a?'A':x===bAddr?'B':x),s.session?.address===bAddr,statusOf(s,w.clock.now()),b.jar.has(SESSION_COOKIE),
    (await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()===bAddr],[[],['A','B'],true,'owner',true,true]);
  t.stop();
});

// Guards (ADV-3, Q6, Q7, Q12): the wait is only for a click that asks for a cookie, and it is checked again whenever that
// can change. Q6 fails with every click waiting (asks() always true), Q7 with the wait not ending once a read shows the
// wallet's account signed in already, Q12 with the wait after the click's own session read reduced to that read.
test('ADV-3 guard: signed in already as the wallet’s account while this page’s logout is still out: the click re-checks the house at once and arms no wait',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),env=fakeEnv();
  const t=tab(w,b,wallet,{env,holdReply:p=>g.wait('logout',LOGOUT,p)});await settle();
  await t.client.signIn();g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, its answer held
  assert.equal((await b.signIn(B)).verify.status,200);await t.client.restore();         // another tab of the profile signs B in; this page reads it
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  const n=t.calls.length,click=t.client.signIn();await settle();await settle();
  const r=[t.calls.slice(n),env.live().some(x=>x.ms===LOGOUT_WAIT_MS),t.client.state.notice,wallet.signed];
  g.open('logout');await click;await settle();
  assert.deepEqual(r,[['GET /api/auth/session','GET /api/me/home'],false,null,1]); // every click has its own GET
  t.stop();
});

test('ADV-3 guard: a click waiting for this page’s logout goes on as soon as a read shows the wallet’s account signed in already',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),env=fakeEnv();
  const t=tab(w,b,wallet,{env,holdReply:async p=>{await g.wait('logout',LOGOUT,p);await g.wait('read',SESSION,p);}});await settle();
  await t.client.signIn();g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, its answer held
  assert.equal((await b.signIn(B)).verify.status,200);                                  // another tab of the profile signs B in
  g.arm('read');const read=t.client.restore();await until(()=>g.held('read'));         // a read (that tab's message): it answers B, held
  const n=t.calls.length,click=t.client.signIn();await settle();                       // the click waits (the read, and the logout)
  g.open('read');await read;await until(()=>t.calls.length-n===3&&!t.client.state.checking);   // ordinary home, click GET, click home
  const r=[statusOf(t.client.state,w.clock.now()),t.calls.slice(n),wallet.signed];
  g.open('logout');await click;await settle();
  assert.deepEqual(r,['owner',['GET /api/me/home?fresh=1','GET /api/auth/session','GET /api/me/home'],1]);
  t.stop();
});

test('ADV-3 guard: a click whose own session read finds the session it showed gone waits for this page’s logout before it asks for a challenge',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),signs=prompts(wallet);
  let fail=false;const t=tab(w,b,wallet,{holdReply:p=>g.wait('logout',LOGOUT,p),drop:p=>SESSION(p)&&fail&&!(fail=false)});await settle();
  await t.client.signIn();g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, its answer held
  assert.equal((await b.signIn(B)).verify.status,200);await t.client.restore();         // another tab of the profile signs B in; this page reads it
  fail=true;await t.client.restore();                                                    // a read fails: B still shown, the session unknown
  assert.deepEqual([statusOf(t.client.state,w.clock.now()),t.client.state.sessionKnown],['owner',false]);
  const copy=w.browser();copy.jar.set(SESSION_COOKIE,b.jar.get(SESSION_COOKIE));assert.equal((await copy.post('/api/auth/logout')).status,204,'B is logged out elsewhere');
  const n=t.calls.length,click=t.client.signIn();await settle();await settle();         // B shown: no wait; its session read finds none, so it waits now
  const waited=t.calls.slice(n);
  g.open('logout');await click;await settle();
  assert.deepEqual([waited,signs.map(x=>x===a?'A':x===bAddr?'B':x),statusOf(t.client.state,w.clock.now()),b.jar.has(SESSION_COOKIE),
    (await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()===bAddr],[['GET /api/auth/session'],['A','B'],'owner',true,true]);
  t.stop();
});

// ADV-3 (the re-check's ADVR-5): the wait is shown. On 2f5d6c1 a click waited up to 5 s with nothing on the page (idle,
// no notice, My wallet's sign button enabled; a second click did nothing), and a wait that ran out said "couldn't check
// whether you're already signed in", which was not the reason (the wording of that end: the next test).
test('ADV-3: while a click waits for this page’s logout, My wallet says so and its sign button is off; a second click asks nothing; once answered, B signs in and the notice goes',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),signs=prompts(wallet),en=(z,x)=>x,zh=z=>z;
  const t=tab(w,b,wallet,{holdReply:p=>g.wait('logout',LOGOUT,p)});await settle();
  await t.client.signIn();g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, its answer held
  const n=t.calls.length,click=t.client.signIn();await settle();await t.client.signIn();          // the click waits; a second click meanwhile
  const s=t.client.state,during={state:structuredClone(s),now:w.clock.now()};
  assert.deepEqual([s.phase,s.waiting,s.notice,statusOf(s,w.clock.now()),t.calls.slice(n),signs.length],['idle',true,null,'connected',[],1]);
  const pending=[waitingText(en),waitingText(zh)];
  assert.deepEqual(pending,['Waiting for a log-out (or a cancelled sign-in) this page sent earlier to be answered; your wallet is asked nothing until then.',
    '正在等這個頁面先前送出的登出（或已取消的登入）得到回應；在那之前不會向錢包要求任何東西。']);
  const [html,zhtml]=await panels([{...during,lang:'en'},{...during,lang:'zh'}]);
  for(const [page,text,label] of [[html,pending[0],'Sign in to move in'],[zhtml,pending[1],'簽名驗證入住']])
    assert.ok(page.includes(`<p class="empty-state wallet-notice">${text}</p>`)&&page.includes(`<button class="primary" disabled="">${label}</button>`),page.slice(0,1500));
  g.open('logout');await click;await settle();
  assert.deepEqual([t.client.state.waiting,t.client.state.notice,statusOf(t.client.state,w.clock.now()),signs.map(x=>x===a?'A':x===bAddr?'B':x),posts(t.calls,'/api/auth/challenge'),b.jar.has(SESSION_COOKIE)],
    [false,null,'owner',['A','B'],2,true]);
  t.stop();
});

// Guard (ADV-3): a click that waited and then finds another wallet in use (one that changed with no provider-change event)
// ends asking nothing, and leaves no "waiting" notice behind. Fails with that end keeping the notice.
test('ADV-3 guard: a click that waited for this page’s logout and then finds another wallet in use asks nothing and leaves no waiting notice',async()=>{
  const A=newAccount(),B=newAccount(),C=newAccount(),w=world(),b=w.browser(),g=gates();
  const wa=fakeWallet(A),wc=fakeWallet(C);let current=wa;wc.granted=true;
  const t=tab(w,b,null,{registry:{current:()=>current,subscribe:()=>()=>{}},holdReply:p=>g.wait('logout',LOGOUT,p)});await settle();
  await t.client.signIn();g.arm('logout');wa.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, its answer held
  const n=t.calls.length,click=t.client.signIn();await settle();
  current=wc;g.open('logout');await click;await settle();                                // the page now sees another wallet (no event); the logout answered
  assert.deepEqual([wc.asked,t.client.state.notice,!!t.client.state.waiting,t.client.state.phase],[[],null,false,'idle']);
  assert.ok(t.calls.slice(n).every(c=>c==='GET /api/auth/session'),'cleanup may reconcile, but no new challenge or signature');
  t.stop();
});

// The team's review of 066d109 (RC-1..RC-5, its probes P1b..P9b; not an outside review). RC-1: since f095642 an
// abandoned flow's late verify success read its body (to name the late session) before it sent that session's logout,
// the verify still held meanwhile. RC-2: a session or house read that failed while a click waited replaced the waiting
// notice (one notice slot), so the page said "unavailable" beside a sign button that was on and did nothing. RC-3..RC-5:
// lines of f095642 that no test pinned. Since this review the late session's logout goes out on the verify's headers and
// the wait is a field of its own (`waiting`), shown in the notice's place; `ID: …` below failed on 066d109 (except the
// RC-3 test, which passes there and fails on 2f5d6c1), and each `ID guard: …` passes there and fails under the weakening
// it names (the refused “Log out all devices” guard: its expected end changed with the review of 13449f2, CF-3).
/** My wallet's notice line, and its sign buttons (the primary ones), as rendered. */
const noticeLine=html=>(html.match(/<p class="empty-state wallet-notice">([^<]*)<\/p>/)??[])[1]??null;
const signButtons=html=>html.match(/<button class="primary"[^>]*>[^<]*<\/button>/g)??[];

// ADV-3 (RC-1): the late success of an abandoned flow is logged out on its headers, which bring its cookie. On 066d109 a
// body that stalled after them kept that logout back: A's late session stayed live at the server with its cookie in this
// browser, and the click for B waited LOGOUT_WAIT_MS and ended with 'logout-slow', asking nothing (2f5d6c1 sent it on the
// headers). The body, landing later, names the session that logout ended, and never ends B's.
test('ADV-3: an abandoned flow’s verify whose body stalls after its headers: its late session is logged out on the headers, the click for B signs B in, and the body landing later leaves B alone',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),h=heldBodies(VERIFY),env=fakeEnv(),signs=prompts(wallet);
  const t=tab(w,b,wallet,{env,holdReply:p=>g.wait('verify',VERIFY,p),rewrite:h.rewrite});await settle();
  const liveA=()=>w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL AND lower(address)=?').get(a).n;
  g.arm('verify');const pending=h.next(),flow=t.client.signIn();await until(()=>g.held('verify'));   // A's verify: A's session made at the server, the answer held
  wallet.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();   // the switch abandons the flow
  g.open('verify');const body=await Promise.race([pending,new Promise(r=>setTimeout(()=>r(null),1000))]);await settle();await settle();   // the headers land (A's late cookie), the body is held
  const onHeaders=[!!body,posts(t.calls,'/api/auth/logout'),b.jar.has(SESSION_COOKIE),liveA()];
  const n=t.calls.length,click=t.client.signIn();
  await until(()=>env.live().some(x=>x.ms===LOGOUT_WAIT_MS)||signs.length>1);const bound=env.live().find(x=>x.ms===LOGOUT_WAIT_MS);if(bound)env.fire(bound);
  await click;await settle();
  const s=t.client.state,clicked=[t.calls.slice(n),signs.map(x=>x===a?'A':x===bAddr?'B':x),s.notice,statusOf(s,w.clock.now()),s.session?.address===bAddr,b.jar.has(SESSION_COOKIE)];
  body?.open();await flow;await settle();await settle();                                 // the body lands: it names A's late session
  const u=t.client.state,after=[statusOf(u,w.clock.now()),u.session?.address===bAddr,t.hint.get()?.address===bAddr,b.jar.has(SESSION_COOKIE),
    (await b.get('/api/auth/session').then(r=>r.json())).address?.toLowerCase()===bAddr,liveA()];
  assert.deepEqual({onHeaders,clicked,after},{onHeaders:[true,2,false,0],
    clicked:[['GET /api/auth/session','POST /api/auth/challenge','POST /api/auth/verify','GET /api/me/home'],['A','B'],null,'owner',true,true],after:['owner',true,true,true,true,0]});
  t.stop();
});

// ADV-1 (RC-1): the late session's logout goes out before its body names it, so the two can land in either order. A read
// shows the late session while the click for B waits, and another wallet, A granted, becomes current (owner mode for it;
// that takes a generation, so only the named session can end). Body first: the page keeps that session until its logout
// is confirmed (a logout that fails leaves it, as for any sign-out). Logout first: it ends when the body names it. On
// 066d109 no logout went out before the body.
test('ADV-1 v1.1: later provider switch has displayed authority even while old nonce cleanup is held; either late body order stays signed out',async()=>{
  const out={};
  for(const order of ['body first','logout first']){
    const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates(),h=heldBodies(VERIFY);
    const wa=fakeWallet(A),wn=fakeWallet(A),subs=new Set();let current=wa;wn.granted=true;
    const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
    const t=tab(w,b,null,{registry,hold:p=>g.wait('late',LOGOUT,p),holdReply:p=>g.wait('verify',VERIFY,p),rewrite:h.rewrite});await settle();
    g.arm('verify');const flow=t.client.signIn();await until(()=>g.held('verify'));      // A's verify: A's session made at the server, the answer held
    wa.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle(); // the switch abandons the flow (its logout answered)
    g.arm('late');const pending=h.next();g.open('verify');                                 // the headers land (A's late cookie), the body is held
    const body=await Promise.race([pending,new Promise(r=>setTimeout(()=>r(null),1000))]);await until(()=>g.held('late'));
    const sent=g.held('late');                                                             // the late session's logout, held before the server
    const click=t.client.signIn();await settle();                                          // the click for B waits for it
    await t.client.restore();await until(()=>!t.client.state.checking);const shown=t.client.state.session?.address===a;   // a read shows A's late session
    current=wn;for(const fn of subs)fn();
    await until(()=>t.client.state.sessionKnown&&!t.client.state.session);
    assert.equal(g.held('late'),true,'old nonce request remains held');
    assert.equal(t.cleanups.filter(e=>e.kind==='displayed-session'&&e.expectedAddress===a).length,1,'new provider event uses its own displayed authority');
    assert.equal(w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL').get().n,0,'new displayed action independently ended the live session');
    const mid=[];
    if(order==='body first'){body?.open();await flow;await settle();await settle();mid.push(statusOf(t.client.state,w.clock.now()));g.open('late');}
    else{g.open('late');await until(()=>!b.jar.has(SESSION_COOKIE));await settle();body?.open();await flow;}
    await until(()=>!t.client.state.session);await click;await settle();
    const s=t.client.state;
    out[order]=[sent,shown,...mid,s.session,statusOf(s,w.clock.now()),t.hint.get(),b.jar.has(SESSION_COOKIE),(await b.get('/api/auth/session').then(r=>r.json())).signedIn];
    t.stop();
  }
  assert.deepEqual(out,{'body first':[true,true,'connected',null,'connected',null,false,false],'logout first':[true,true,null,'connected',null,false,false]});
});

// ADV-1 (RC-3), R7: a body settling after cancellation shares the switch's cleanup owner. Two sequential gates hold
// that one request before the server; a read shows the late session while a click waits, then another wallet becomes
// current. Keep the original outcome assertion and additionally forbid concurrent duplicate cleanup requests.
test('ADV-1: an abandoned flow that dies while its verify body is read: its late session, shown by a read while a click waited, ends on the page when its logout is confirmed after another wallet became current',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),g=gates(),h=heldBodies(VERIFY);
  const wa=fakeWallet(A),wn=fakeWallet(A),subs=new Set();let current=wa;wn.granted=true;
  const registry={current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}};
  const t=tab(w,b,null,{registry,hold:async p=>{await g.wait('switch',LOGOUT,p);await g.wait('late',LOGOUT,p);},rewrite:h.rewrite});await settle();
  const pending=h.next(),flow=t.client.signIn(),body=await pending;                       // A's verify: its headers in (A's cookie), its body held
  assert.ok(b.jar.has(SESSION_COOKIE),'A’s cookie came with the headers');
  g.arm('switch');wa.switchTo(B);await until(()=>g.held('switch'));                       // the switch ends the flow; its logout held before the server
  const click=t.client.signIn();await settle();                                           // the click for B waits
  g.arm('late');body.open();await flow;await settle();
  assert.equal(posts(t.calls,'/api/auth/logout'),1,'late body cannot duplicate the already-owned cleanup');
  await t.client.restore();await until(()=>!t.client.state.checking);
  assert.equal(t.client.state.session?.address,a,'a read shows A’s late session');
  current=wn;for(const fn of subs)fn();await until(()=>statusOf(t.client.state,w.clock.now())==='owner');   // another wallet, A granted: owner mode for it
  g.open('switch');await until(()=>g.held('late'));g.open('late');
  await until(()=>!b.jar.has(SESSION_COOKIE));await click;await settle();await settle();
  const s=t.client.state;
  assert.deepEqual([s.session,s.home,s.checking,statusOf(s,w.clock.now()),t.hint.get(),(await b.get('/api/auth/session').then(r=>r.json())).signedIn],[null,null,false,'connected',null,false]);
  t.stop();
});

// ADV-3 (RC-2): while a click waits, My wallet says so and its sign button is off, whatever a read does meanwhile. On
// 066d109 the wait was a notice, and a session read (another tab's message, the tab shown again) or a house read (the
// owner re-check, "Check again") that failed then replaced it: "unavailable", "too many attempts" or "did not complete"
// beside a sign button that was on and did nothing, and the same click then asked the wallet by itself. My wallet is
// rendered through tests/fixtures/wallet-panel.mjs.
test('ADV-3: a session or house read that fails while a click waits for this page’s logout (503, 429, 500) leaves My wallet saying it waits, with its sign button off; once answered, the click asks B to sign',async()=>{
  const en=(z,x)=>x,zh=z=>z,runs=[];
  for(const kind of ['session 503','session 429','house 429','house 500']){
    const [what,code]=kind.split(' '),status=Number(code),A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),g=gates();
    assert.equal((await b.signIn(A)).verify.status,200);                                  // this profile holds A's session
    const wallet=fakeWallet(B);wallet.granted=true;const signs=prompts(wallet),error={503:'AUTH_UNAVAILABLE',429:'RATE_LIMITED',500:'INTERNAL'}[status];let refuse=false;
    const t=tab(w,b,wallet,{holdReply:p=>g.wait('logout',LOGOUT,p),rewrite:(p,r)=>refuse&&(what==='session'?SESSION(p):HOME(p))?Response.json({error},{status}):r});
    await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
    g.arm('logout');const out=t.client.signOut();await until(()=>g.held('logout'));       // "Log out this device": A's logout, its answer held
    const click=t.client.signIn();await settle();                                         // the click for B waits for it
    refuse=true;if(what==='session')await t.client.restore();else{w.clock.advance(16_000);await t.client.refreshHome();}refuse=false;
    const s=t.client.state,run={kind,state:structuredClone(s),now:w.clock.now(),during:[s.notice,s.waiting,signs.length]};runs.push(run);
    g.open('logout');await out;await click;await settle();
    const u=t.client.state;run.after=[u.waiting,u.notice,statusOf(u,w.clock.now()),signs.map(x=>x===bAddr?'B':x)];
    t.stop();
  }
  const pages=await panels(runs.flatMap(r=>[{state:r.state,lang:'en',now:r.now},{state:r.state,lang:'zh',now:r.now}]));
  const seen=Object.fromEntries(runs.map((r,i)=>[r.kind,[...r.during,noticeLine(pages[2*i]),noticeLine(pages[2*i+1]),
    [...signButtons(pages[2*i]),...signButtons(pages[2*i+1])].map(x=>x.includes(' disabled=""')),r.after]]));
  const waits=notice=>[notice,true,0,waitingText(en),waitingText(zh),[true,true],[false,null,'owner',['B']]];
  assert.deepEqual(seen,{'session 503':waits('auth-unavailable'),'session 429':waits('rate-limited'),'house 429':waits('rate-limited'),'house 500':waits('failed')});
});

// Guard (ADV-3, RC-4): the waiting line is set only for a click still live. A click whose own session re-read (the
// session unknown after a lost read) is under way when a switch to another account ends it must not put the line up
// once that read lands: nothing would take it down, and My wallet would say it waits, its sign button off, until the
// wallet changed again. Fails with the line set without `live()`.
test('ADV-3 guard: on a mismatch, a click that a switch to another account ends during its own session re-read leaves no waiting line, and My wallet’s sign button on',async()=>{
  const A=newAccount(),B=newAccount(),C=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates();
  assert.equal((await b.signIn(A)).verify.status,200);                                    // this profile holds A's session
  const wallet=fakeWallet(B);wallet.granted=true;const signs=prompts(wallet);let fail=false;
  const t=tab(w,b,wallet,{holdReply:async p=>{await g.wait('read',SESSION,p);await g.wait('logout',LOGOUT,p);},drop:p=>SESSION(p)&&fail&&!(fail=false)});
  await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
  fail=true;await t.client.restore();assert.equal(t.client.state.sessionKnown,false);      // a read is lost: the session unknown
  g.arm('read');const click=t.client.signIn();await until(()=>g.held('read'));             // "Sign in as B" re-reads it first (held)
  g.arm('logout');wallet.switchTo(C);await until(()=>g.held('logout'));                   // the switch to C ends the click; its logout of A held
  g.open('read');await settle();await settle();g.open('logout');await click;await settle();
  const s=t.client.state,[html]=await panels([{state:s,lang:'en',now:w.clock.now()}]);
  assert.deepEqual([!!s.waiting,s.notice,statusOf(s,w.clock.now()),signs.length,noticeLine(html),signButtons(html)],[false,null,'connected',0,null,['<button class="primary">Sign in to move in</button>']]);
  t.stop();
});

/** A click for B waiting for an account switch's logout of A (held before the server) while a read shows A again ("Sign
 *  in as B"), then `end` ends it; My wallet, rendered before and after. The logout is answered only after that. */
async function endTheWait(end){
  const A=newAccount(),B=newAccount(),C=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),g=gates();
  const t=tab(w,b,wallet,{hold:p=>g.wait('logout',LOGOUT,p)});await settle();
  await t.client.signIn();g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, held before the server
  const click=t.client.signIn();await settle();                                            // the click for B waits for it
  await t.client.restore();await until(()=>!t.client.state.checking);                      // a read (another tab's message) still finds A: "Sign in as B"
  const view=async()=>{const s=t.client.state,[html]=await panels([{state:s,lang:'en',now:w.clock.now()}]);
    return [statusOf(s,w.clock.now()),noticeLine(html),signButtons(html).map(x=>x.includes(' disabled=""'))];};
  const before=await view();let stop=t.stop,leaving=null;
  if(end==='sign-out')leaving=t.client.signOut();else if(end==='switch')wallet.switchTo(C);else{t.stop();stop=t.client.start();}
  await until(()=>!t.client.state.leaving);await settle();await settle();
  const after=await view();
  g.open('logout');await leaving;await click;await settle();stop();
  return [...before,...after];
}
const waitingThenNot=st=>['mismatch',waitingText((z,x)=>x),[true],st,null,[false]];

// Guard (ADV-3): what ends a waiting click takes its waiting line down at once: "Log out this device" and a switch to
// another account (each takes a generation). The click is still inside its wait then (the logout it waits for is held),
// so nothing else would. Fails with either end leaving `waiting` set.
test('ADV-3 guard: “Log out this device”, or a switch to another account, while a click waits for this page’s logout takes the waiting line down at once, the sign button on',async()=>{
  assert.deepEqual({'sign-out':await endTheWait('sign-out'),switch:await endTheWait('switch')},{'sign-out':waitingThenNot('connected'),switch:waitingThenNot('connected')});
});

// ADV-3: so does the page's teardown: a client started again (React Refresh, StrictMode) shows no waiting line for the
// click the teardown ended. On 066d109 'logout-pending' stayed, the sign button off, until the wallet changed (the
// review's probe P6; not raised as a finding, since the page starts its client once outside development).
test('ADV-3: the page’s teardown while a click waits for this page’s logout takes the waiting line down: a client started again shows none, the sign button on',async()=>{
  assert.deepEqual(await endTheWait('teardown'),waitingThenNot('mismatch'));
});

// Guards (ADV-1, RC-5): a sign-out confirmed after another wallet became current says "Signed out." only when it ended
// the session it named. Another tab's newer session (C), held by then, stays with nothing said, and no "Signed out."
// shows after the wallet then names another account (which ends C here). Fails with "Signed out." set whatever
// `loggedOut` did, with `loggedOut` reporting that it applied when it did nothing, or with the wallet change leaving
// the waiting line of the click it ended.
test('ADV-1 v1.1 guard: old explicit closure never labels newer context Signed out; distinct provider switch conditionally cleans newer displayed session',async()=>{
  const A=newAccount(),B=newAccount(),C=newAccount(),D=newAccount(),c=C.address.toLowerCase(),w=world(),b=w.browser(),g=gates();
  assert.equal((await b.signIn(A)).verify.status,200);                                    // this profile holds A's session
  const {t,pickNew,wn}=chosenWallets(w,b,{A,B,holdReply:p=>g.wait('logout',LOGOUT,p)});
  await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch'&&!t.client.state.checking);
  g.arm('logout');const out=t.client.signOut();await until(()=>g.held('logout'));         // "Log out this device": A revoked, the answer held
  const click=t.client.signIn();await settle();w.clock.advance(60_000);                   // the click for B waits for it
  assert.equal((await b.signIn(C)).verify.status,200);await t.client.restore();           // another tab of the profile signs C in; this page reads it
  const held=t.client.state.session;assert.equal(held?.address,c);
  pickNew();await until(()=>t.client.state.sessionKnown&&!t.client.state.session);
  assert.equal(t.cleanups.filter(e=>e.kind==='displayed-session'&&e.expectedAddress===c).length,1,'new provider event explicitly targets displayed C, never the old A assertion');
  assert.equal(w.db.raw.prepare('SELECT revoked_at FROM sessions WHERE address=?').get(c).revoked_at!==null,true,'C revocation has the new lifecycle decision as authority');
  g.open('logout');await out;await click;await settle();        // then A's old explicit logout is answered
  const s=t.client.state,first=[s.session?.address===c&&s.session.expiresAt===held.expiresAt,s.ended,t.hint.get()?.address===c,s.leaving,s.notice,!!s.waiting];
  wn.account=D;wn.granted=true;for(const fn of wn.listeners)fn([D.address]);await settle();await settle();   // that wallet now names D: C ends on the page
  const u=t.client.state,[html]=await panels([{state:u,lang:'en',now:w.clock.now()}]);
  assert.deepEqual({first,then:[u.session,u.ended,html.includes('<p class="small-note" role="status">Signed out.</p>')]},{first:[false,'revoked',false,false,null,false],then:[null,'revoked',false]});
  t.stop();
});

// Guard (ADV-1): "Log out all devices" refused because this browser's sign-in had already ended (401: nobody was signed
// out), answered after another wallet became current while a click waited for it, says no "Signed out.": that would read
// as if the other devices were signed out (AUD3-07's point). Fails with the branch for a sign-out a newer flow overtook
// taking any answer but a 2xx as a confirmed one. Since the review of 13449f2 (CF-3) the session is then read afresh, so
// the page says what that read found: revoked (by the other device), not signed out by this page.
test('ADV-1 guard: a “Log out all devices” the server refused (this browser’s sign-in had ended), answered after another wallet became current while a click waited for it, says no “Signed out.”',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates(),ALL=p=>p==='/api/auth/logout-all';
  assert.equal((await b.signIn(A)).verify.status,200);                                    // this profile holds A's session
  const wa=fakeWallet(A),wb=fakeWallet(B),wn=fakeWallet(A),subs=new Set();let current=wa;wa.granted=wb.granted=true;
  const pick=x=>{current=x;for(const fn of subs)fn();},t=tab(w,b,null,{registry:{current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}},holdReply:p=>g.wait('all',ALL,p)});
  await until(()=>statusOf(t.client.state,w.clock.now())==='owner');
  const elsewhere=w.browser();assert.equal((await elsewhere.signIn(A)).verify.status,200);
  assert.equal((await elsewhere.post('/api/auth/logout-all',{expectedAddress:A.address})).status,200); // another device logs A out everywhere: this page does not know yet
  g.arm('all');const out=t.client.signOut(true);await until(()=>g.held('all'));           // "Log out all devices": refused (401), the answer held
  pick(wb);await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch');          // a wallet on B is chosen: "Sign in as B"
  const click=t.client.signIn();await settle();pick(wn);await settle();                   // the click waits for that answer; another wallet becomes current
  g.open('all');await out;await click;await settle();
  const s=t.client.state,[html]=await panels([{state:s,lang:'en',now:w.clock.now()}]);
  assert.deepEqual([s.ended,s.leaving,html.includes('<p class="small-note" role="status">Signed out.</p>')],['revoked',false,false]);
  t.stop();
});

// The team's review of 13449f2 (CF-1..CF-5; not an outside review). The `ID: …` test below fails on 13449f2; each `ID
// guard: …` passes there and fails under the weakening it names.
// ADV-1 (CF-3): the same refused "Log out all devices" read to its end. The live path reads the
// session after a refused logout-all (R-1, AUD3-07); the branch for a sign-out a newer flow overtook did not, so the page
// kept A's session, revoked at the server by the other device's logout-all, in owner mode with no notice until the owner
// re-check. It now reads the session too: the newest read says signed out. Nothing is asked of the wallet (the switch
// ended the click), and no "Signed out." is said (nobody was signed out by this page). Fails on 13449f2.
test('ADV-1: a “Log out all devices” the server refused, answered after another wallet became current while a click waited for it, reads the session again: the session another device ended is not kept',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),g=gates(),ALL=p=>p==='/api/auth/logout-all';
  assert.equal((await b.signIn(A)).verify.status,200);                                    // this profile holds A's session
  const wa=fakeWallet(A),wb=fakeWallet(B),wn=fakeWallet(A),subs=new Set();let current=wa;wa.granted=wb.granted=wn.granted=true;
  const asked=[prompts(wa),prompts(wb),prompts(wn)];
  const pick=x=>{current=x;for(const fn of subs)fn();},t=tab(w,b,null,{registry:{current:()=>current,subscribe:fn=>{subs.add(fn);return()=>subs.delete(fn);}},holdReply:p=>g.wait('all',ALL,p)});
  await until(()=>statusOf(t.client.state,w.clock.now())==='owner');
  const elsewhere=w.browser();assert.equal((await elsewhere.signIn(A)).verify.status,200);
  assert.equal((await elsewhere.post('/api/auth/logout-all',{expectedAddress:A.address})).status,200); // another device logs A out everywhere: this page does not know yet
  g.arm('all');const out=t.client.signOut(true);await until(()=>g.held('all'));           // "Log out all devices": refused (401), the answer held
  pick(wb);await until(()=>statusOf(t.client.state,w.clock.now())==='mismatch');          // a wallet on B is chosen: "Sign in as B"
  const click=t.client.signIn();await settle();pick(wn);await settle();await settle();    // the click waits for that answer; another wallet, A granted, becomes current
  g.open('all');await out;await click;await settle();await until(()=>!t.client.state.checking);await settle();
  const s=t.client.state,[html]=await panels([{state:s,lang:'en',now:w.clock.now()}]);
  assert.deepEqual([statusOf(s,w.clock.now()),s.session,s.home,s.ended,s.leaving,t.hint.get(),html.includes('<p class="small-note" role="status">Signed out.</p>'),
    (await b.get('/api/auth/session').then(r=>r.json())).signedIn,asked.flat()],['connected',null,null,'revoked',false,null,false,false,[]]);
  t.stop();
});

// Guards (ADV-1, the review of 13449f2: CF-1, CF-2): an abandoned flow's verify body that lands after its late logout
// ends that very session and nothing else, and only once that logout was confirmed. Its verify answered and held, the
// switch to B abandons the flow, the headers land (the late logout goes out on them), the body is held.
async function lateBody({lose=false}={}){
  const A=newAccount(),B=newAccount(),C=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),c=C.address.toLowerCase();
  const w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates(),h=heldBodies(VERIFY);
  let dropNext=false;
  const t=tab(w,b,wallet,{holdReply:p=>g.wait('verify',VERIFY,p),rewrite:h.rewrite,drop:p=>LOGOUT(p)&&dropNext&&!(dropNext=false)});await settle();
  g.arm('verify');const pending=h.next(),flow=t.client.signIn();await until(()=>g.held('verify'));   // A's verify: A's session made at the server, the answer held
  wallet.switchTo(B);await until(()=>posts(t.calls,'/api/auth/logout')===1);await settle();          // the switch abandons the flow (its logout answered)
  dropNext=lose;g.open('verify');const body=await pending;                                          // the headers land (A's late cookie), the body is held
  await until(()=>posts(t.calls,'/api/auth/logout')===2);await settle();await settle();               // the late logout: confirmed, or lost
  const liveA=()=>w.db.raw.prepare('SELECT count(*) n FROM sessions WHERE revoked_at IS NULL AND lower(address)=?').get(a).n;
  return {C,a,c,w,b,t,flow,body,liveA};
}
// CF-1: the late logout confirmed; another tab of this profile signs C in and this page reads it (wallet on B: a
// mismatch); then A's body lands. C stays. Fails with the late body's end taking the revoke's generation (which nothing
// has taken since), so ending whatever session the page holds.
test('ADV-1 guard: an abandoned flow’s verify body landing after its late logout was confirmed leaves another tab’s newer session the page holds',async()=>{
  const x=await lateBody();
  assert.equal(x.b.jar.has(SESSION_COOKIE),false,'the late logout was confirmed');
  x.w.clock.advance(60_000);assert.equal((await x.b.signIn(x.C)).verify.status,200);     // another tab of this profile signs C in
  await x.t.client.restore();await until(()=>!x.t.client.state.checking);
  const held=x.t.client.state.session;assert.equal(held?.address,x.c);
  x.body.open();await x.flow;await settle();await settle();                               // A's body lands: it names A's late session
  const s=x.t.client.state;
  assert.deepEqual([s.session,x.t.hint.get()?.address,s.ended,statusOf(s,x.w.clock.now())],[held,x.c,null,'mismatch']);
  x.t.stop();
});
// CF-2: the late logout is lost (network); a read shows A's late session (still live at the server, its cookie here);
// then the body lands. The page keeps showing it (a logout that did not reach the server ends nothing: SEC-1 / CORR-01).
// Fails with a lost late logout counted as a confirmation.
test('ADV-1 guard: an abandoned flow’s late logout that was lost: its verify body landing later leaves the still-live late session on the page',async()=>{
  const x=await lateBody({lose:true});
  await x.t.client.restore();await until(()=>!x.t.client.state.checking);
  assert.equal(x.t.client.state.session?.address,x.a,'a read shows A’s late session');
  x.body.open();await x.flow;await settle();await settle();
  const s=x.t.client.state,server=await x.b.get('/api/auth/session').then(r=>r.json());
  assert.deepEqual([s.session?.address,statusOf(s,x.w.clock.now()),server.signedIn,String(server.address).toLowerCase(),x.liveA()],[x.a,'mismatch',true,x.a,1]);
  x.t.stop();
});

// Guards (ADV-3, RC-5): the waiting line is for a click held up by this page's own logout that would ask the wallet
// something. A click waiting only for a session read (no logout out), or one whose wallet's account is signed in
// already (it asks nothing) while a logout is out, shows none. Fail with the line set for any wait, or without `asks()`.
test('ADV-3 guard: a click that waits only for a session read, with no logout of this page out, shows no waiting line',async()=>{
  const A=newAccount(),a=A.address.toLowerCase(),w=world({swarm:{361:a},chain:{361:a}}),b=w.browser(),wallet=fakeWallet(A),g=gates();
  const t=tab(w,b,wallet,{holdReply:p=>g.wait('read',SESSION,p)});await settle();
  g.arm('read');const read=t.client.restore();await until(()=>g.held('read'));            // a session read on its way (held)
  const click=t.client.signIn();await settle();
  const s=t.client.state,[html]=await panels([{state:s,lang:'en',now:w.clock.now()}]),during=[!!s.waiting,s.notice,noticeLine(html)];
  g.open('read');await read;await click;
  assert.deepEqual([during,statusOf(t.client.state,w.clock.now()),wallet.signed],[[false,null,null],'owner',1]);
  t.stop();
});

test('ADV-3 / R5 guard: an already-signed-in click asks nothing; a late old logout cookie clear is reconciled without revoking the newer session',async()=>{
  const A=newAccount(),B=newAccount(),a=A.address.toLowerCase(),bAddr=B.address.toLowerCase(),w=world({swarm:{361:a,921:bAddr},chain:{361:a,921:bAddr}}),b=w.browser(),wallet=fakeWallet(A),g=gates();
  const t=tab(w,b,wallet,{holdReply:async p=>{await g.wait('logout',LOGOUT,p);await g.wait('read',SESSION,p);}});await settle();
  await t.client.signIn();g.arm('logout');wallet.switchTo(B);await until(()=>g.held('logout'));   // the switch's logout of A, its answer held
  assert.equal((await b.signIn(B)).verify.status,200);await t.client.restore();           // another tab of the profile signs B in; this page reads it
  const newer=w.browser();newer.jar=new Map(b.jar);                                    // retain B's credential before the delayed A cookie-clear headers
  assert.equal(statusOf(t.client.state,w.clock.now()),'owner');
  g.arm('read');const read=t.client.restore();await until(()=>g.held('read'));            // another read on its way (held)
  const click=t.client.signIn();await settle();
  const s=t.client.state,[html]=await panels([{state:s,lang:'en',now:w.clock.now()}]),during=[!!s.waiting,s.notice,noticeLine(html)];
  g.open('read');await read;await click;g.open('logout');await settle();
  // The old A request already matched and revoked A before B was created. Its delayed Set-Cookie clear can still
  // delete B's browser cookie: this transport race is not revocation of B. Fresh read must reflect cookie absence.
  assert.deepEqual([during,statusOf(t.client.state,w.clock.now()),wallet.signed,b.jar.has(SESSION_COOKIE),t.client.state.session,t.client.state.home],[[false,null,null],'connected',1,false,null,null]);
  assert.equal((await newer.get('/api/auth/session').then(r=>r.json())).signedIn,true,'newer B session is still live');
  t.stop();
});
