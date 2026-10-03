import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setup,newAccount,START} from './wallet-harness.mjs';
import {MemberClient,publicName,lookupName,NAME_LOOKUP_DELAY_MS} from '../src/world/member.ts';
// The page's member client (src/world/member.ts) against the real Worker and migrations: a browser profile's cookie jar
// (wallet-harness Browser) carries the session, and a stand-in for the sign-in client says which session the page holds.
// [REDACTED] An answer for another wallet, or one that arrives after a switch, never lands; a lost answer is retried
// with the same request id; "unavailable" is never shown as "no name yet".
const DAY=86_400_000;
/** fetch as the page does it (same origin, the jar's cookie), through browser `b`; `hold` can stall or drop answers. */
function pageFetch(b,hold){
  return async(path,init={})=>{
    const h=new Headers(init.headers);h.set('origin',b.origin);if(b.jar.size)h.set('cookie',b.cookie());
    const run=async()=>b.keep(await b.send(new Request(b.base+path,{method:init.method??'GET',headers:h,body:init.body})));
    return hold?hold(path,init,run):run();
  };
}
/** The sign-in client as member.ts sees it: the session the page holds, and a way to change it. */
function session(address=null){
  const fns=new Set(),s={state:{session:address?{address:address.toLowerCase(),expiresAt:START+7*DAY}:null},subscribe:fn=>{fns.add(fn);return ()=>fns.delete(fn);},
    set(a){s.state={session:a?{address:a.toLowerCase(),expiresAt:START+7*DAY}:null};for(const f of fns)f();}};
  return s;
}
const settle=()=>new Promise(r=>setTimeout(r,0));
/** Waits for `f` (the Worker answers on later turns; under a full parallel run that can take a while), up to 10 s. */
async function until(f,label){const end=Date.now()+10_000;while(Date.now()<end){if(f())return;await new Promise(r=>setTimeout(r,2));}assert.fail('timed out: '+label);}
function storage(){const m=new Map();return {m,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v))};}

test('the member follows the session: loaded when signed in, cleared when signed out, needs_name shown as such',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  const auth=session(),c=new MemberClient(auth,{fetch:pageFetch(b),storage:storage()});c.start();
  assert.equal(c.state.phase,'idle');
  auth.set(a.address);assert.equal(c.state.phase,'loading');
  await until(()=>c.state.phase==='ready','bootstrap');
  assert.equal(c.state.view.member.profileState,'needs_name');assert.equal(c.state.view.loginWallet.address,a.address);
  auth.set(null);assert.deepEqual([c.state.phase,c.state.view],['idle',null]);
});

test('an answer for the wallet the page has left is dropped; the new wallet’s own member shows',async()=>{
  const w=setup(),a=newAccount(),bb=newAccount(),b=w.browser();await b.signIn(a);
  assert.equal((await b.post('/api/me/bootstrap')).status,200);          // A is a member: its held answer is A's profile
  let release,landed=false;const gate=new Promise(r=>release=r),held=[];
  const auth=session(),c=new MemberClient(auth,{fetch:pageFetch(b,async(path,init,run)=>{const r=await run();if(!held.length){held.push(path);await gate;landed=true;}return r;}),storage:storage()});
  c.start();auth.set(a.address);await until(()=>held.length===1,'A’s answer held');
  // While A's answer is held, the page switches to B (signed in in this same profile).
  await b.signIn(bb);auth.set(bb.address);release();
  await until(()=>c.state.phase==='ready','B loaded');
  assert.equal(c.state.view.loginWallet.address,bb.address);
  await until(()=>landed,'A’s answer returned');for(let i=0;i<5;i++)await settle();
  assert.equal(c.state.view.loginWallet.address,bb.address,'A’s late answer did not land');
});

test('signed out and in again with the same wallet: an answer of the earlier sign-in never replaces a newer one',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  let release,first=true,held=false;const gate=new Promise(r=>release=r);
  const auth=session(),c=new MemberClient(auth,{fetch:pageFetch(b,async(path,init,run)=>{const r=await run();if(first&&path==='/api/me/bootstrap'){first=false;held=true;await gate;}return r;}),storage:storage()});
  c.start();auth.set(a.address);await until(()=>held,'the first bootstrap answer (needs_name) is held');
  auth.set(null);auth.set(a.address);await until(()=>c.state.phase==='ready','second sign-in');
  assert.equal(await c.save('EmberCat'),true);
  release();for(let i=0;i<10;i++)await settle();
  assert.equal(c.state.view.member.displayName,'EmberCat','the held needs_name answer was dropped');
});

test('an answer naming another wallet than the page’s is not shown (the cookie changed under the page)',async()=>{
  const w=setup(),a=newAccount(),bb=newAccount(),b=w.browser();await b.signIn(bb);
  assert.equal((await b.post('/api/me/bootstrap')).status,200);          // the cookie's wallet (B) is a member
  let answered=0;const auth=session(a.address),c=new MemberClient(auth,{fetch:pageFetch(b,async(p,i,run)=>{const r=await run();answered++;return r;}),storage:storage()});c.start();
  await until(()=>answered===1,'the read answered');for(let i=0;i<5;i++)await settle();
  assert.equal(c.state.view,null);assert.notEqual(c.state.phase,'ready');
});

test('503 and network failures are "unavailable", never "needs a name"; a retry loads it',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  let down=true;const auth=session(a.address);
  const c=new MemberClient(auth,{fetch:pageFetch(b,(path,init,run)=>down?Promise.resolve(new Response('{"error":"PROFILE_UNAVAILABLE"}',{status:503})):run()),storage:storage()});
  c.start();await until(()=>c.state.phase!=='loading','first answer');
  assert.deepEqual([c.state.phase,c.state.view],['unavailable',null]);
  const n=new MemberClient(session(a.address),{fetch:async()=>{throw new TypeError('offline');},storage:storage()});n.start();
  await until(()=>n.state.phase!=='loading','offline');assert.equal(n.state.phase,'unavailable');
  down=false;await c.load();assert.equal(c.state.phase,'ready');assert.equal(c.state.view.member.profileState,'needs_name');
});

test('a save whose answer is lost is retried once with the same request id: saved once, one cooldown',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  let lose=true;const ids=[];
  const c=new MemberClient(session(a.address),{fetch:pageFetch(b,async(path,init,run)=>{
    if(init.method==='PUT')ids.push(JSON.parse(init.body).requestId);
    const r=await run();if(init.method==='PUT'&&lose){lose=false;throw new TypeError('connection reset');}return r;}),storage:storage(),wait:async()=>{}});
  c.start();await until(()=>c.state.phase==='ready','loaded');
  assert.equal(await c.save('EmberCat'),true);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1],'the same request id');
  assert.equal(c.state.view.member.displayName,'EmberCat');assert.equal(c.state.view.member.version,1);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM profile_history').get().n,1);
});

test('refusals: cooldown shows the server’s time, a version conflict reads the profile again, the form never asks the wallet',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  const c=new MemberClient(session(a.address),{fetch:pageFetch(b),storage:storage()});c.start();await until(()=>c.state.phase==='ready','loaded');
  assert.equal(await c.save('EmberCat'),true);
  assert.equal(await c.save('EmberMoon'),false);
  assert.deepEqual(c.state.error,{code:'NAME_CHANGE_COOLDOWN',nextNameChangeAt:START+7*DAY});
  // Another tab of the same wallet renamed meanwhile (its version is newer than this page's).
  const other=new MemberClient(session(a.address),{fetch:pageFetch(b),storage:storage()});other.start();await until(()=>other.state.phase==='ready','other');
  w.clock.advance(7*DAY);const b2=w.browser();await b2.signIn(a);b.jar=b2.jar;
  assert.equal(await other.save('FromOtherTab'),true);
  assert.equal(await c.save('FromThisTab'),false);assert.equal(c.state.error.code,'PROFILE_VERSION_CONFLICT');
  await until(()=>c.state.view.member.displayName==='FromOtherTab','re-read');
});

test('"not now" folds the card for that member on this browser only; no name is made',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  const store=storage(),c=new MemberClient(session(a.address),{fetch:pageFetch(b),storage:store});c.start();await until(()=>c.state.phase==='ready','loaded');
  c.skip();assert.equal(c.state.skipped,true);
  assert.equal(w.db.raw.prepare("SELECT profile_state FROM member_profiles").get().profile_state,'needs_name');
  const again=new MemberClient(session(a.address),{fetch:pageFetch(b),storage:store});again.start();await until(()=>again.state.phase==='ready','again');
  assert.equal(again.state.skipped,true,'remembered for this member');
  const bb=newAccount(),b2=w.browser();await b2.signIn(bb);
  const other=new MemberClient(session(bb.address),{fetch:pageFetch(b2),storage:store});other.start();await until(()=>other.state.phase==='ready','other');
  assert.equal(other.state.skipped,false,'another member still sees the card');
});

test('a page load reads with GET and creates with POST only once: an existing member spends no per-IP write budget',async()=>{
  const w=setup(),a=newAccount(),b=w.browser();await b.signIn(a);
  const seen=[];const log=(path,init,run)=>{seen.push((init.method??'GET')+' '+path);return run();};
  const first=new MemberClient(session(a.address),{fetch:pageFetch(b,log),storage:storage()});first.start();await until(()=>first.state.phase==='ready','first');
  assert.deepEqual(seen,['GET /api/me/profile','POST /api/me/bootstrap'],'a new member: 404, then created');
  seen.length=0;
  for(let i=0;i<3;i++){const c=new MemberClient(session(a.address),{fetch:pageFetch(b,log),storage:storage()});c.start();await until(()=>c.state.phase==='ready','load '+i);}
  assert.deepEqual(seen,['GET /api/me/profile','GET /api/me/profile','GET /api/me/profile']);
  assert.equal(w.db.raw.prepare('SELECT count(*) n FROM members').get().n,1);
});

test('clicking through houses asks for the name of the one the viewer stops at, not of every house passed',async()=>{
  const calls=[],get=async p=>{calls.push(p);return Response.json({name:'N'});};
  let t=5_000_000,timers=[];const fake={set:(f,ms)=>{const x={f,at:t+ms,on:true};timers.push(x);return x;},clear:x=>{x.on=false;}};
  const tick=ms=>{t+=ms;for(const x of timers)if(x.on&&x.at<=t){x.on=false;x.f();}};
  const got=[];let cancel=()=>{};
  // Ten houses, one every 300 ms (the panel cancels the last lookup when it shows the next house), then a stop.
  for(let i=0;i<10;i++){cancel();cancel=lookupName('0x'+String(i).repeat(40),n=>got.push(n),{timers:fake,now:()=>t,get});tick(300);}
  assert.equal(calls.length,0,'nothing asked while clicking through');
  tick(NAME_LOOKUP_DELAY_MS);await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(calls,['/api/world/names/0x'+'9'.repeat(40)]);assert.deepEqual(got,['N']);
  // Back to that house within the minute: answered at once from what was read.
  cancel();cancel=lookupName('0x'+'9'.repeat(40),n=>got.push(n),{timers:fake,now:()=>t,get});await new Promise(r=>setTimeout(r,0));
  assert.equal(calls.length,1);assert.deepEqual(got,['N','N']);
  // Closed before the delay: nothing is asked, nothing lands.
  cancel=lookupName('0x'+'7'.repeat(40),n=>got.push(n),{timers:fake,now:()=>t,get});cancel();tick(NAME_LOOKUP_DELAY_MS*2);
  await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,1);assert.equal(got.length,2);
});

test('public names: one read per address a minute, a bad address asks nothing, a failure is no name',async()=>{
  const calls=[],get=async p=>{calls.push(p);return Response.json({name:'EmberCat'});};
  const addr='0x'+'Ab'.repeat(20);
  assert.equal(await publicName(addr,1000,get),'EmberCat');assert.equal(await publicName(addr.toLowerCase(),2000,get),'EmberCat');
  assert.deepEqual(calls,['/api/world/names/0x'+'ab'.repeat(20)]);
  assert.equal(await publicName('0x12',3000,get),null);assert.equal(calls.length,1);
  assert.equal(await publicName(addr,1000+60_001,get),'EmberCat');assert.equal(calls.length,2,'after a minute');
  assert.equal(await publicName('0x'+'cd'.repeat(20),0,async()=>new Response('',{status:503})),null);
  assert.equal(await publicName('0x'+'ef'.repeat(20),0,async()=>{throw new Error('x');}),null);
});

function render(cases){
  return new Promise((resolve,reject)=>{const c=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/member-panel.mjs',import.meta.url))],{stdio:['pipe','pipe','pipe']});
    let out='',err='';c.stdout.on('data',d=>out+=d);c.stderr.on('data',d=>err+=d);
    c.on('close',code=>code===0?resolve(JSON.parse(out)):reject(new Error('the panel did not render ('+code+'): '+err)));c.stdin.end(JSON.stringify(cases));});
}
const view=(member,address='0x'+'ab'.repeat(20))=>({member:{publicMemberId:'u_'+'a'.repeat(20),displayName:null,profileState:'needs_name',version:0,nameChangedAt:null,nextNameChangeAt:null,...member},
  loginWallet:{chainId:1,address},economy:{available:0,reserved:0},life:{state:'not_started',lifeNumber:1},serverTime:START});
const st=(over)=>({address:'0x'+'ab'.repeat(20),phase:'ready',view:null,saving:false,error:null,skipped:false,...over});
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');

test('My wallet, as rendered: the first-name card says the name is public and tied to the wallet; each state says what it is',async()=>{
  const [first,firstEn,skipped,unavailable,ready,cooling,fix,locked,refused]=(await render([
    {state:st({view:view({})}),lang:'zh',now:START},{state:st({view:view({})}),lang:'en',now:START},
    {state:st({view:view({}),skipped:true}),lang:'zh',now:START},
    {state:st({phase:'unavailable'}),lang:'zh',now:START},
    {state:st({view:view({displayName:'EmberCat',profileState:'ready',version:1})}),lang:'zh',now:START},
    {state:st({view:view({displayName:'EmberCat',profileState:'ready',version:1,nextNameChangeAt:START+7*DAY})}),lang:'zh',now:START},
    {state:st({view:view({displayName:'會員-aaaaaa',profileState:'needs_rename',version:2})}),lang:'zh',now:START},
    {state:st({view:view({displayName:'EmberCat',profileState:'locked',version:3})}),lang:'zh',now:START},
    {state:st({view:view({}),error:{code:'NAME_UNAVAILABLE'}}),lang:'zh',now:START}])).map(text);
  assert.match(first,/大家該怎麼稱呼你/);assert.match(first,/公開顯示在你的房子資訊與「我的錢包」，並和你的錢包地址連在一起/);
  assert.match(first,/儲存後 7 天內不能再改名/);assert.match(first,/先逛逛/);assert.match(first,/2–20 個字/);
  assert.match(firstEn,/linked to your wallet address/);assert.match(firstEn,/Not now/);
  assert.match(skipped,/還沒有玩家名稱/);assert.doesNotMatch(skipped,/先逛逛/);
  assert.match(unavailable,/玩家資料暫時無法取得/);assert.doesNotMatch(unavailable,/稱呼你|取名/,'never shown as "no name yet"');
  assert.match(ready,/玩家名稱 EmberCat/);assert.match(ready,/改名/);assert.doesNotMatch(ready,/下次可改名/);
  assert.match(cooling,/下次可改名/);
  assert.match(fix,/你的名稱需要修改（目前顯示為 會員-aaaaaa ）/);
  assert.match(locked,/名稱暫時不能修改/);assert.doesNotMatch(locked,/改名 /);
  assert.match(refused,/這個名稱已被使用或保留，請換一個/);
  for(const h of [first,unavailable,ready,fix,refused])assert.doesNotMatch(h,/簽名錯誤|signature (error|failed)/i);
});

test('the house panel says whose home it is by the player name, with the short address kept below',async()=>{
  const owner='0x'+'ab'.repeat(20);
  const [named,unnamed,moderated,en]=(await render([
    {kind:'house',owner,state:st({view:view({displayName:'EmberCat',profileState:'ready',version:1})}),lang:'zh',now:START},
    {kind:'house',owner,state:st({view:view({})}),lang:'zh',now:START},
    {kind:'house',owner,state:st({view:view({displayName:'會員-aaaaaa',profileState:'needs_rename',version:2})}),lang:'zh',now:START},
    {kind:'house',owner,state:st({view:view({displayName:'EmberCat',profileState:'ready',version:1})}),lang:'en',now:START}])).map(text);
  assert.match(named,/EmberCat 的家 · 中型屋/);assert.match(named,/0xabab…abab/);
  assert.match(unnamed,/你的家 · 中型屋/);
  assert.match(moderated,/你的家 · 中型屋/);assert.doesNotMatch(moderated,/會員-/,'a name taken away is not shown on the house');
  assert.match(en,/EmberCat ’s home · Medium house/);
});
