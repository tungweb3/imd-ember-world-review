import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {privateKeyToAccount} from 'viem/accounts';
import {AuthReference,InvariantFailure,TEST_ORIGIN} from './auth-reference-model.mjs';

export const GENERATOR_VERSION='audit8-causal-scheduler-2';
export const sourceRoot=process.env.AUTH_REFERENCE_SOURCE?resolve(process.env.AUTH_REFERENCE_SOURCE):resolve(import.meta.dirname,'..');
const selected=p=>pathToFileURL(resolve(sourceRoot,p)).href;
const {AuthClient}=await import(selected('src/world/auth.ts'));
const {setup,START}=await import(selected('tests/wallet-harness.mjs'));
// Explicit, permanently public test identities. These are never funded or used outside this local fixture.
const accounts=Object.fromEntries(['A','B','C'].map((name,i)=>[name,privateKeyToAccount('0x'+String(i+1).padStart(64,'0'))]));
export const TEST_ADDRESSES=Object.fromEntries(Object.entries(accounts).map(([n,a])=>[n,a.address.toLowerCase()]));
const COOKIE_SESSION='__Host-imd_session',COOKIE_FLOW='__Host-imd_flow';
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function random(seed){let x=(seed+1)>>>0;return n=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)%n;};}
const tick=()=>new Promise(r=>setImmediate(r));
const rule=(ok,id,msg,detail={})=>{if(!ok)throw new InvariantFailure(id,msg,detail);};
export const KERNELS=['lost-hint','held-home-account','held-home-provider','displayed-pending','restart-cleanup',
  'lock-idle','lock-active','unknown-preflight','cancel-preflight','backward-revoked','slow-body-sibling',
  'pre-header-failure','stopped-late-headers'];

export class SchedulerDriver{
  constructor(seed,{replay=false}={}){
    this.seed=seed;this.pick=random(seed);this.replay=replay;this.w=setup();this.b=this.w.browser(TEST_ORIGIN);this.model=new AuthReference(TEST_ADDRESSES,START);
    this.tabs=new Map();this.requests=[];this.prompts=[];this.actions=[];this.events=[];this.nonces=new Map();this.flowValues=new Map();this.tokens=new Map();
    this.seq=0;this.clientOffset=0;this.fault=null;this.closed=false;this.nextSessionFault=null;this.nextVerifyBodyFault=false;
    this.metrics={workerCalls:0,dbComparisons:0,cookieComparisons:0,projectionComparisons:0,headerDeliveries:0,bodyDeliveries:0,preHeaderFailures:0};
    this.addTab('a');this.addTab('b');
  }
  fail(error){this.fault??=error;}
  mark(type,data={}){this.events.push({index:this.events.length,type,...data});}
  addTab(id){
    const handlers=new Map(),channels=[],timers=new Set();let account='A',currentProvider=0,providerChanged=()=>{},hint=null;
    const q={id,channels,timers,flows:[],account:'A',provider:0,visible:null,stopped:false};this.model.tab(id,'A');this.tabs.set(id,q);
    const makeProvider=()=>({
      async request({method,params}){
        if(method==='eth_accounts'||method==='eth_requestAccounts')return account?[accounts[account].address]:[];
        if(method!=='personal_sign')throw new Error('Unexpected wallet method '+method);
        const signer=account;try{q.driver.model.prompt(id);rule(params[1]===TEST_ADDRESSES[signer],'AUTH-I10','signature request remains bound to click account');}
        catch(error){q.driver.fail(error);throw error;}
        const p={id:'p'+(++q.driver.seq),tab:id,account:signer,gate:defer(),done:false,raw:params[0]};q.driver.prompts.push(p);q.driver.mark('prompt',{id:p.id,tab:id,account:signer});
        await p.gate.promise;return accounts[signer].signMessage({message:{raw:p.raw}});
      },on(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);},
      removeListener(name,fn){handlers.get(name)?.delete(fn);}
    });
    q.driver=this;q.providers=[makeProvider()];
    const env={set:(fn,ms)=>{const job={id:'timer'+(++this.seq),fn,ms};timers.add(job);return job;},clear:job=>timers.delete(job),
      onVisible:fn=>{q.visible=fn;return()=>{q.visible=null;};}};
    const channel=()=>{const ch={closed:false,messages:[],listeners:[],addEventListener:(_n,fn)=>ch.listeners.push(fn),
      postMessage:kind=>{try{this.model.hint(id,kind);ch.messages.push(kind);this.mark('hint-emitted',{tab:id,kind});}catch(error){this.fail(error);throw error;}},
      close:()=>{ch.closed=true;}};channels.push(ch);return ch;};
    q.c=new AuthClient({provider:()=>q.providers[currentProvider],onProviderChange:fn=>{providerChanged=fn;return()=>{providerChanged=()=>{};};},
      fetch:(path,init={})=>this.fetch(id,path,init),hint:{get:()=>hint,set:value=>{hint=value;}},now:()=>this.w.clock.now()+this.clientOffset,
      origin:TEST_ORIGIN,env,channel});
    q.accountEvent=next=>{account=next;q.account=next;for(const fn of handlers.get('accountsChanged')??[])fn(next?[accounts[next].address]:[]);};
    q.providerEvent=(next,reason='selection')=>{account=next;q.account=next;q.providers.push(makeProvider());currentProvider=q.providers.length-1;q.provider=currentProvider;providerChanged(reason);};
    q.start=()=>{q.stopped=false;q.stop=q.c.start();};return q;
  }
  aliasNonce(value){const n=this.nonces.get(value);rule(n,'HARNESS-ALIAS','unknown nonce supplied to route');return n;}
  cookieAliases(){return {session:this.b.jar.has(COOKIE_SESSION)?this.tokens.get(this.b.jar.get(COOKIE_SESSION))??'DEAD':null,
    flow:this.b.jar.has(COOKIE_FLOW)?this.flowValues.get(this.b.jar.get(COOKIE_FLOW))??'FOREIGN':null};}
  fetch(tab,path,init={}){
    const rawBody=init.body?JSON.parse(init.body):{},body={...rawBody};if(body.nonce)body.nonce=this.aliasNonce(body.nonce);
    if(body.expectedNonce)body.expectedNonce=this.aliasNonce(body.expectedNonce);if(body.address)body.address=body.address.toLowerCase();
    if(body.expectedAddress)body.expectedAddress=body.expectedAddress.toLowerCase();delete body.signature;
    let m;try{assert.deepEqual(this.cookieAliases(),this.model.jar,'request dispatch captures actual shared cookies');
      m=this.model.command(tab,path,body,this.model.jar);}catch(error){
      this.mark('rejected-command',{tab,path,body,cookie:this.cookieAliases(),invariant:error.invariant??'ASSERTION'});
      this.fail(error);return Promise.reject(error);}
    const r={id:'r'+(++this.seq),tab,path,body,model:m,request:this.b.request(path,{method:init.method??'GET',body:init.body,headers:init.headers}),
      stage:'dispatched',fetchGate:defer(),bodyGate:defer(),bodyFault:path==='/api/auth/verify'&&this.nextVerifyBodyFault,bodyApplied:false};
    if(r.bodyFault)this.nextVerifyBodyFault=false;
    if(path==='/api/auth/session'&&this.nextSessionFault){r.fault=this.nextSessionFault;this.nextSessionFault=null;}
    this.requests.push(r);this.mark('dispatch',{id:r.id,tab,path,body,cookie:{...m.cookie},life:m.life,epoch:m.epoch});return r.fetchGate.promise;
  }
  async pump(turns=3){for(let i=0;i<turns;i++)await tick();if(this.fault)throw this.fault;}
  async action(action,{record=true}={}){
    if(record)this.actions.push({...action});this.mark('action',action);const q=this.tabs.get(action.tab);
    if(action.type==='start'){this.model.start(action.tab);q.start();}
    else if(action.type==='click'){
      const c=this.model.click(action.tab),p=q.c.signIn();q.flows.push(p);p.then(()=>{if(this.model.tabs.get(action.tab).click===c)this.model.finish(action.tab);},error=>this.fail(error));
    }else if(action.type==='account'||action.type==='lock'){
      this.model.intent(action.tab,action.type,action.account);q.accountEvent(action.type==='lock'?null:action.account);
    }else if(action.type==='provider'){this.model.intent(action.tab,'provider',action.account);q.providerEvent(action.account);}
    else if(action.type==='stop'){this.model.intent(action.tab,'stop');q.stopped=true;q.stop();}
    else if(action.type==='explicit'){
      this.model.intent(action.tab,'explicit');const p=q.c.signOut();q.flows.push(p);p.catch(error=>this.fail(error));
    }else if(action.type==='hint'){
      const ch=action.old?q.channels[0]:q.channels.at(-1);for(const fn of ch.listeners)fn();
    }else if(action.type==='visible'){q.c.visible();}
    else if(action.type==='clock'){this.clientOffset+=action.client??0;this.w.clock.advance(action.server??0);this.model.now=this.w.clock.now();}
    else if(action.type==='revoke'){
      this.model.revokeAll();this.w.db.raw.prepare('UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL').run(this.w.clock.now());this.compareDb();
    }else if(action.type==='fault-session'){this.nextSessionFault=action.value;}
    else if(action.type==='fault-verify-body'){this.nextVerifyBodyFault=true;}
    else if(action.type==='prompt'){
      const p=this.prompts.find(p=>p.id===action.id);rule(p&&!p.done,'HARNESS-CAUSAL','prompt completion needs pending prompt');p.done=true;p.gate.resolve();
    }else if(action.type==='worker'){
      const r=this.requests.find(r=>r.id===action.id);rule(r?.stage==='dispatched','HARNESS-CAUSAL','worker execution follows dispatch');
      const expected=this.model.run(r.model,this.w.clock.now(),r.fault);
      if(r.fault){r.response=Response.json(expected.payload,{status:expected.status});this.mark('injected-before-worker',{id:r.id,value:r.fault});}
      else{r.response=await this.b.send(r.request);this.metrics.workerCalls++;}
      r.text=await r.response.clone().text();r.payload=r.text?JSON.parse(r.text):null;
      rule(r.response.status===expected.status,'SERVER-AUTHORITY','real Worker HTTP status differs from independent server authority law',
        {route:r.path,expected:expected.status,actual:r.response.status});
      if(r.path==='/api/auth/challenge'&&expected.status===200){this.nonces.set(r.payload.nonce,r.model.nonce);
        const line=r.response.headers.getSetCookie().find(s=>s.startsWith(COOKIE_FLOW+'='));
        rule(line,'HARNESS-ALIAS','challenge response provides flow cookie');this.flowValues.set(line.split(';')[0].slice(COOKIE_FLOW.length+1),expected.cookies[0][1]);
        rule(r.payload.acceptUntil===expected.payload.acceptUntil,'SERVER-AUTHORITY','challenge expiry is normative five minutes');
      }else if(r.path==='/api/auth/verify'&&expected.status===200){
        const line=r.response.headers.getSetCookie().find(s=>s.startsWith(COOKIE_SESSION+'='));rule(line,'HARNESS-ALIAS','successful verify provides session cookie');
        this.tokens.set(line.split(';')[0].slice(COOKIE_SESSION.length+1),r.model.session);
        rule(r.payload.address.toLowerCase()===expected.payload.address&&r.payload.expiresAt===expected.payload.expiresAt,'SERVER-AUTHORITY','verified session identity/expiry matches oracle');
      }else if(r.path==='/api/auth/session')assert.deepEqual(this.normalizeCanonical(r.payload),this.normalizeCanonical(expected.payload),'canonical GET follows reference cookie/live-row authority');
      else if(r.path.startsWith('/api/me/home')&&expected.status===200)assert.equal(r.payload.address.toLowerCase(),expected.payload.address);
      r.stage='committed';this.compareDb();this.mark('worker-result',{id:r.id,status:r.response.status,counts:this.model.counts()});
    }else if(action.type==='headers'){
      const r=this.requests.find(r=>r.id===action.id);rule(r?.stage==='committed','HARNESS-CAUSAL','headers follow server response');
      this.b.keep(r.response);this.model.headers(r.model);r.stage='headers';this.metrics.headerDeliveries++;
      assert.deepEqual(this.cookieAliases(),this.model.jar,'Set-Cookie application follows independent delivery-order jar');this.metrics.cookieComparisons++;
    }else if(action.type==='expose'){
      const r=this.requests.find(r=>r.id===action.id);rule(r?.stage==='headers','HARNESS-CAUSAL','fetch exposure follows browser headers');
      this.model.visible(r.model);
      // Logout handlers consume status rather than JSON. Their acknowledgement occurs at fetch visibility; do not
      // accidentally give a delayed empty body the authority to qualify an earlier refused cleanup attempt.
      if(r.path==='/api/auth/logout'||r.path==='/api/auth/logout-all'){r.bodyApplied=true;this.model.body(r.model,null);}
      r.stage='exposed';const wrap=()=>({status:r.response.status,ok:r.response.ok,headers:r.response.headers,clone:wrap,
        json:async()=>{await r.bodyGate.promise;
          if(!r.bodyApplied){r.bodyApplied=true;const payload=r.bodyFault?null:r.payload;this.model.body(r.model,payload);
            this.mark('body-consumed',{id:r.id,fault:!!r.bodyFault});}
          if(r.bodyFault)throw new SyntaxError('synthetic malformed JSON after successful server commit');return r.payload;}});
      r.fetchGate.resolve(wrap());
    }else if(action.type==='body'){
      const r=this.requests.find(r=>r.id===action.id);rule(r?.stage==='exposed','HARNESS-CAUSAL','body follows fetch visibility');
      r.stage='delivered';this.metrics.bodyDeliveries++;r.bodyGate.resolve();
      // 204 responses have no JSON consumer. Their effect is acknowledgement at fetch exposure, not body parsing.
      if(r.response.status===204&&!r.bodyApplied){r.bodyApplied=true;this.model.body(r.model,null);}
    }else if(action.type==='fail-before-headers'){
      const r=this.requests.find(r=>r.id===action.id);rule(r?.stage==='dispatched','HARNESS-CAUSAL','pre-header failure cannot undo committed Worker result');
      r.stage='failed';r.model.status=0;r.model.expected={status:0,payload:null,cookies:[]};this.model.visible(r.model);this.model.body(r.model,null);
      this.metrics.preHeaderFailures++;r.fetchGate.reject(new TypeError('synthetic network failure before Worker admission'));
    }else if(action.type!=='idle')throw new InvariantFailure('HARNESS-ACTION','unknown action',{action});
    await this.pump();return this;
  }
  normalizeCanonical(v){return v?.signedIn===true?{signedIn:true,address:v.address.toLowerCase(),expiresAt:v.expiresAt}:v;}
  enabled(hold=()=>false){const out=[];
    for(const r of this.requests){const type={dispatched:'worker',committed:'headers',headers:'expose',exposed:'body'}[r.stage];
      if(type&&!hold(r,type))out.push({type,id:r.id});}
    for(const p of this.prompts)if(!p.done&&!hold(p,'prompt'))out.push({type:'prompt',id:p.id});return out;
  }
  async runUntil(predicate,{hold=()=>false,limit=220,label='anchor'}={}){
    for(let i=0;i<limit;i++){await this.pump();if(predicate())return;
      const enabled=this.enabled(hold);rule(enabled.length,'HARNESS-DEADLOCK','no causal delivery can reach '+label,{pending:this.requests.filter(r=>!['delivered','failed'].includes(r.stage)).map(r=>({id:r.id,path:r.path,stage:r.stage}))});
      await this.action(enabled[this.pick(enabled.length)]);}
    throw new InvariantFailure('HARNESS-BOUND','bounded scheduler could not reach '+label);
  }
  async drain(hold=()=>false){await this.runUntil(()=>this.enabled(hold).length===0,{hold,label:'quiescence'});await this.pump(5);}
  compareDb(){
    const ss=this.w.db.raw.prepare('SELECT nonce,address,expires_at,revoked_at FROM sessions ORDER BY rowid').all(),
      cc=this.w.db.raw.prepare('SELECT nonce,address,used_at,invalidated_at,accept_until FROM login_challenges ORDER BY rowid').all(),now=this.w.clock.now();
    const counts={created:ss.length,live:ss.filter(s=>s.revoked_at===null&&s.expires_at>now).length,revoked:ss.filter(s=>s.revoked_at!==null).length,
      challenges:cc.length,used:cc.filter(c=>c.used_at!==null).length,pending:cc.filter(c=>c.used_at===null&&c.invalidated_at===null&&c.accept_until>now).length,
      unusedRows:cc.filter(c=>c.used_at===null&&c.invalidated_at===null).length,invalidated:cc.filter(c=>c.invalidated_at!==null).length};
    assert.deepEqual(counts,this.model.counts(),'real SQLite row effects equal independent authority model');
    for(const s of ss){const nonce=this.aliasNonce(s.nonce),expected=[...this.model.sessions.values()].find(s=>s.nonce===nonce);
      assert.ok(expected);assert.equal(s.address,expected.address);assert.equal(s.expires_at,expected.expiresAt);assert.equal(s.revoked_at!==null,expected.revoked);}
    this.metrics.dbComparisons++;
  }
  checkpoint(label){this.compareDb();for(const [id,q] of this.tabs){const t=this.model.tabs.get(id);if(!t.active)continue;
      const actual={knowledge:q.c.lifecycleSnapshot?.knowledge.kind??(q.c.state.sessionKnown?q.c.state.session?'PRESENT':'ABSENT':'UNKNOWN'),
        displayed:q.c.state.session?.address??null,prompts:this.prompts.filter(p=>p.tab===id).length,
        challenges:this.requests.filter(r=>r.tab===id&&r.path==='/api/auth/challenge').length,
        verifies:this.requests.filter(r=>r.tab===id&&r.path==='/api/auth/verify').length,
        hints:q.channels.reduce((n,c)=>n+c.messages.filter(s=>s==='signed-in').length,0)};
      this.model.assertProjection(id,actual);this.metrics.projectionComparisons++;}
    this.mark('checkpoint',{label,counts:this.model.counts(),tabs:[...this.tabs.keys()].map(id=>[id,this.model.projection(id)])});}
  summary(kernel){return {seed:this.seed,kernel,generator:GENERATOR_VERSION,fixtureDigest:digest({addresses:TEST_ADDRESSES,clock:START,oracle:'r8-reference-1'}),
    traceDigest:digest(this.actions),eventCount:this.actions.length,metrics:{...this.metrics},counts:this.model.counts(),
    projections:[...this.tabs.keys()].map(id=>[id,this.model.projection(id)]),coverage:[...new Set(this.actions.map(a=>a.type))].sort()};}
  trace(kernel){return {...this.summary(kernel),actions:this.actions,events:this.events};}
  async close(){if(this.closed)return;this.closed=true;
    // Do not exercise product stop cleanup during fixture disposal. Existing pending operations may be abandoned;
    // settle their artificial gates to avoid unhandled promises, then close the real in-memory SQLite database.
    for(const p of this.prompts)if(!p.done){p.done=true;p.gate.resolve();}
    for(const r of this.requests){if(!['delivered','failed'].includes(r.stage)){r.stage='failed';r.fetchGate.reject(new Error('fixture disposed'));r.bodyGate.resolve();}}
    for(const q of this.tabs.values()){q.timers.clear();for(const ch of q.channels)ch.closed=true;}
    await tick();this.w.db.raw.close();
  }
}

async function started(d,warmUnknown=false){
  const unknown=id=>Array.isArray(warmUnknown)?warmUnknown.includes(id):warmUnknown;
  if(unknown('a'))await d.action({type:'fault-session',value:503});await d.action({type:'start',tab:'a'});
  if(unknown('b'))await d.action({type:'fault-session',value:503});await d.action({type:'start',tab:'b'});
  await d.drain();d.checkpoint(warmUnknown?'initial-UNKNOWN':'initial-ABSENT');
}
const verify=d=>d.requests.find(r=>r.path==='/api/auth/verify'&&r.tab==='a');
async function signAccepted(d,tab='a'){await d.action({type:'click',tab});await d.drain();d.checkpoint('accepted-'+tab);}
export async function runSeed(seed,{replayActions=null,retainTrace=false,warmUnknown=false}={}){
  const d=new SchedulerDriver(seed),kernel=KERNELS[seed%KERNELS.length];
  try{
    if(replayActions){for(const action of replayActions)await d.action(action);await d.pump();d.checkpoint('replay-final');}
    else{
      await started(d,warmUnknown);
      if(kernel==='lost-hint'){
        await signAccepted(d); // Emitted messages intentionally never delivered to sibling.
        await d.action({type:'click',tab:'b'});await d.drain();d.checkpoint('lost-hint-sibling');
        rule(d.model.tabs.get('b').prompts===0&&d.model.counts().created===1,'AUTH-I2','missed hint alone cannot cause duplicate prompt/session');
      }else if(kernel==='held-home-account'||kernel==='held-home-provider'){
        await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>verify(d)?.stage==='exposed',{hold:(r,type)=>r.path==='/api/auth/verify'&&type==='body',label:'stalled verify body'});
        await d.action({type:'hint',tab:'a'});
        await d.runUntil(()=>d.tabs.get('a').c.state.sessionKnown&&d.tabs.get('a').c.state.session&&d.requests.some(r=>r.path.startsWith('/api/me/home')),
          {hold:(r,type)=>(r.path==='/api/auth/verify'||r.path.startsWith('/api/me/home'))&&type==='body',label:'PRESENT held home'});
        await d.action({type:kernel.endsWith('account')?'account':'provider',tab:'a',account:'B'});await d.drain();d.checkpoint('terminal-owner-context-cleanup');
        rule(d.requests.filter(r=>r.path==='/api/auth/logout').length===1,'AUTH-I5','displayed session switch needs exactly one primary cleanup');
        rule(d.model.counts().live===0,'AUTH-I1','terminal owner does not suppress address cleanup');
      }else if(kernel==='displayed-pending'){
        await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>d.requests.some(r=>r.tab==='a'&&r.path==='/api/auth/challenge'&&r.stage==='exposed'),
          {hold:(r,type)=>r.tab==='a'&&r.path==='/api/auth/challenge'&&type==='body',label:'pending challenge held'});
        await d.action({type:'click',tab:'b'});await d.drain((r,type)=>r.tab==='a'&&r.path==='/api/auth/challenge'&&type==='body');
        await d.action({type:'hint',tab:'a'});
        await d.runUntil(()=>!!d.tabs.get('a').c.state.session&&d.tabs.get('a').c.state.sessionKnown,
          {hold:(r,type)=>r.tab==='a'&&(r.path==='/api/auth/challenge'||r.path.startsWith('/api/me/home'))&&type==='body',label:'sibling PRESENT during pending click'});
        const c=d.requests.find(r=>r.tab==='a'&&r.path==='/api/auth/challenge');await d.action({type:'body',id:c.id});
        rule(d.tabs.get('a').c.lifecycleSnapshot?.click?.state==='CHALLENGE_READY'&&!!d.tabs.get('a').c.state.session,
          'HARNESS-ANCHOR','displayed-plus-pending switch must occur while original click still owns its challenge');
        await d.action({type:seed%20<10?'account':'provider',tab:'a',account:'B'});await d.drain();d.checkpoint('displayed-plus-pending');
        rule(d.requests.filter(r=>r.tab==='a'&&r.path==='/api/auth/logout').length===1,'AUTH-I5','pending cancellation does not race displayed-address cleanup');
        rule(d.model.tabs.get('a').prompts===0,'AUTH-I10','cancelled challenge never prompts');
      }else if(kernel==='restart-cleanup'){
        await d.action({type:'fault-verify-body'});await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>verify(d)?.stage==='exposed',{hold:(r,type)=>r.path==='/api/auth/verify'&&type==='body',label:'committed malformed body'});
        await d.action({type:'fault-session',value:429});await d.action({type:'body',id:verify(d).id});await d.drain();d.checkpoint('uncertain-owner');
        await d.action({type:'stop',tab:'a'});
        await d.runUntil(()=>d.requests.some(r=>r.path==='/api/auth/logout'),{hold:r=>r.path==='/api/auth/logout',label:'cleanup dispatched'});
        await d.action({type:'start',tab:'a'});await d.drain(r=>r.path==='/api/auth/logout');d.checkpoint('restarted-before-cleanup');
        // Half the seeds install B after the old server mutation but before its clear-cookie headers.
        const out=d.requests.find(r=>r.path==='/api/auth/logout');
        if(seed%20<10){await d.action({type:'worker',id:out.id});
          await d.action({type:'account',tab:'b',account:'B'});await d.drain(r=>r===out);
          await d.action({type:'click',tab:'b'});await d.drain(r=>r===out);}
        await d.drain();d.checkpoint('late-cleanup-current-life');
        rule(d.model.tabs.get('a').knowledge==='ABSENT','AUTH-I7','old cleanup forces canonical current-life cookie reconciliation');
      }else if(kernel==='lock-idle'){
        await signAccepted(d);await d.action({type:'lock',tab:'a'});await d.drain();d.checkpoint('idle-lock');
        rule(d.model.counts().live===1&&!d.requests.some(r=>r.path==='/api/auth/logout'),'INFO-1','idle wallet lock preserves committed session');
        await d.action({type:'stop',tab:'a'});await d.drain();d.checkpoint('accepted-stop-control');rule(d.model.counts().live===1,'AUTH-I1','accepted stop is not sign-out');
      }else if(kernel==='lock-active'){
        await d.action({type:'click',tab:'a'});
        if(seed%20<10){
          await d.runUntil(()=>d.prompts.length>0,{hold:(_r,type)=>type==='prompt',label:'held personal_sign'});
          await d.action({type:'lock',tab:'a'});await d.drain();d.checkpoint('lock-held-prompt');
          rule(d.model.counts().created===0,'AUTH-I10','late prompt completion cannot submit verification after lock');
        }else{
          await d.runUntil(()=>verify(d)?.stage==='exposed',{hold:(r,type)=>r.path==='/api/auth/verify'&&type==='body',label:'lock committed uncertain body'});
          await d.action({type:'lock',tab:'a'});await d.drain();d.checkpoint('lock-uncertain-commit');
          rule(d.model.counts().live===1&&!d.requests.some(r=>r.path==='/api/auth/logout'),'INFO-1','uncertain lock reconciles instead of revoking');
        }
      }else if(kernel==='unknown-preflight'){
        await d.action({type:'fault-session',value:['invalid',429,503][Math.floor(seed/10)%3]});await d.action({type:'click',tab:'a'});await d.drain();d.checkpoint('unknown-click');
        rule(d.model.tabs.get('a').prompts===0&&d.model.counts().created===0,'AUTH-I9','invalid/unavailable canonical preflight never signs');
      }else if(kernel==='cancel-preflight'){
        await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>d.requests.some(r=>r.path==='/api/auth/session'&&r.model.click),{hold:r=>r.path==='/api/auth/session'&&!!r.model.click,label:'click-owned preflight dispatched'});
        const cancel=['account','provider','stop'][Math.floor(seed/10)%3];await d.action({type:cancel,tab:'a',account:'B'});await d.drain();d.checkpoint('cancelled-preflight');
        rule(d.model.counts().created===0&&d.model.tabs.get('a').prompts===0,'AUTH-I10','old preflight cannot migrate or sign');
      }else if(kernel==='backward-revoked'){
        await signAccepted(d);await d.action({type:'clock',client:-3_600_000,server:d.pick(500)});await d.action({type:'revoke'});
        await d.action({type:'visible',tab:'a'});await d.drain();d.checkpoint('backward-visible-revocation');
        rule(d.model.tabs.get('a').displayed===null,'AUTH-I9','backward age cannot suppress canonical revoked read');
      }else if(kernel==='slow-body-sibling'){
        await d.action({type:'click',tab:'a'});
        await d.runUntil(()=>verify(d)?.stage==='exposed',{hold:(r,type)=>r.tab==='a'&&r.path==='/api/auth/verify'&&type==='body',label:'valid verify body held'});
        await d.action({type:'hint',tab:'a'});await d.drain((r,type)=>r.tab==='a'&&r.path==='/api/auth/verify'&&type==='body');
        rule(verify(d).stage==='exposed'&&d.tabs.get('a').c.state.sessionKnown,'HARNESS-ANCHOR','owner body stays held after causal PRESENT');
        await d.action({type:'click',tab:'b'});await d.drain((r,type)=>r.tab==='a'&&r.path==='/api/auth/verify'&&type==='body');
        d.checkpoint('sibling-while-valid-body-held');rule(d.model.tabs.get('b').prompts===0&&d.model.counts().created===1,
          'AUTH-I2','slow owner body plus dropped peer hint cannot create another prompt/session');
        await d.drain();d.checkpoint('late-body-cannot-revive-owner');
      }else if(kernel==='pre-header-failure'){
        await d.action({type:'click',tab:'a'});await d.runUntil(()=>d.requests.some(r=>r.path==='/api/auth/session'&&r.model.click),
          {hold:r=>r.path==='/api/auth/session'&&!!r.model.click,label:'preflight dispatch before connection failure'});
        const r=d.requests.find(r=>r.path==='/api/auth/session'&&r.model.click);await d.action({type:'fail-before-headers',id:r.id});
        await d.drain();d.checkpoint('transport-failure-UNKNOWN');rule(d.model.tabs.get('a').prompts===0,'AUTH-I9','pre-header network failure never grants signing authority');
      }else if(kernel==='stopped-late-headers'){
        await d.action({type:'click',tab:'a'});await d.runUntil(()=>verify(d)?.stage==='committed',
          {hold:(r,type)=>r.path==='/api/auth/verify'&&type==='headers',label:'server committed before browser headers'});
        await d.action({type:'stop',tab:'a'});
        await d.drain((r,type)=>r.path==='/api/auth/verify'&&type==='headers');
        rule(d.requests.some(r=>r.path==='/api/auth/logout'&&r.response?.status===409),'HARNESS-ANCHOR','pre-header nonce cleanup refusal actually reached real Worker');
        await d.drain();d.checkpoint('post-fence-cleanup-retry');
        rule(d.model.counts().live===0&&d.requests.filter(r=>r.path==='/api/auth/logout').length===2,'AUTH-I5',
          'one early refusal and one post-observation owner retry yield one effective cleanup');
      }
      // Meaningful benign control: canonical reread works without hints, explicit logout remains an authorized action.
      if(kernel==='lost-hint'&&seed%20<10){await d.action({type:'explicit',tab:'a'});await d.drain();d.checkpoint('explicit-control');}
      d.checkpoint('final');
    }
    return retainTrace?d.trace(kernel):d.summary(kernel);
  }catch(error){error.schedulerTrace={...d.trace(kernel),failure:{invariant:error.invariant??'ASSERTION',message:error.message,detail:error.detail??null}};
    throw error;}finally{await d.close();}
}

export async function minimizeFailure(trace,invariant,{maxTrials=36}={}){
  // Dependency-aware deletion: causal request IDs and stage checks reject candidates whose prerequisites were removed.
  // A deletion is retained only after the real driver reproduces the SAME invariant. Original trace is never overwritten.
  const witness=trace.failure;
  const sameFailure=error=>error.invariant===invariant&&(!witness||error.message===witness.message&&
    ['tab','key'].every(key=>witness.detail?.[key]===undefined||error.detail?.[key]===witness.detail[key]));
  let actions=trace.actions,attempts=0,invalid=0;for(let span=Math.max(1,Math.floor(actions.length/2));span>=1&&attempts<maxTrials;span=Math.floor(span/2)){
    for(let at=0;at<actions.length&&attempts<maxTrials;at+=span){const candidate=actions.slice(0,at).concat(actions.slice(at+span));attempts++;
      try{await runSeed(trace.seed,{replayActions:candidate});}catch(error){
        if(sameFailure(error)){actions=candidate;at=Math.max(-span,at-span);}
        else if(error.invariant?.startsWith('HARNESS')||!error.invariant)invalid++;
      }}
  }
  let reproduced=false;try{await runSeed(trace.seed,{replayActions:actions});}catch(error){reproduced=sameFailure(error);}
  return {...trace,actions,eventCount:actions.length,traceDigest:digest(actions),minimization:{attempts,invalid,reproduced,originalEvents:trace.actions.length}};
}
