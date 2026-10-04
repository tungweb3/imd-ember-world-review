import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// The SAME evaluator selects real baseline or candidate handlers/harness. No product or legacy harness is rewritten.
const defaultRoot=resolve(fileURLToPath(new URL('../',import.meta.url)));
const selected=process.env.AUTH_R7_SOURCE?resolve(process.cwd(),process.env.AUTH_R7_SOURCE):defaultRoot;
const permitted=[defaultRoot,resolve(defaultRoot,'../baseline')];
assert.ok(permitted.some(p=>p.toLowerCase()===selected.toLowerCase()),'AUTH_R7_SOURCE selects this R7 source or baseline only');
const from=p=>pathToFileURL(resolve(selected,p)).href;
export const sourceRole=selected.toLowerCase()===defaultRoot.toLowerCase()?'candidate':'baseline';
const harness=await import(from('tests/wallet-harness.mjs'));
const auth=await import(from('src/world/auth.ts'));
const server=await import(from('server/auth.ts'));
export const {setup,newAccount,fakeImd,fakeChain}=harness;
export const {SESSION_COOKIE,FLOW_COOKIE}=server;
export const {AuthClient,statusOf}=auth;
export const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
export const tick=()=>new Promise(r=>setImmediate(r));
export async function flush(n=8){for(let i=0;i<n;i++)await tick();}
export async function until(predicate,label='event gate'){
  for(let i=0;i<500&&!predicate();i++)await new Promise(r=>setTimeout(r,2));
  assert.ok(predicate(),label+' reached');
}
export function provider(account,{beforePrompt=async()=>{}}={}){
  let current=account,observe=()=>{};const handlers=new Map(),calls=[];
  return {calls,setObserver:fn=>{observe=fn;},
    async request({method,params}){
      const signer=current;calls.push(method);observe(method);
      if(method==='eth_accounts'||method==='eth_requestAccounts')return signer?[signer.address]:[];
      if(method==='personal_sign'){
        assert.ok(signer,'a locked provider cannot sign');
        assert.equal(params[1],signer.address.toLowerCase(),'prompt remains bound to its original signer');
        await beforePrompt();return signer.signMessage({message:{raw:params[0]}});
      }
      throw new Error('unexpected wallet method '+method);
    },on:(name,fn)=>{if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn);},
    removeListener:(name,fn)=>handlers.get(name)?.delete(fn),
    switchTo(next){current=next;for(const fn of handlers.get('accountsChanged')??[])fn(next?[next.address]:[]);}};
}
export const prompts=ps=>ps.reduce((n,p)=>n+p.calls.filter(v=>v==='personal_sign').length,0);
export const connects=ps=>ps.reduce((n,p)=>n+p.calls.filter(v=>v==='eth_requestAccounts').length,0);
export function rows(w){
  const sessions=w.db.raw.prepare('SELECT nonce,address,expires_at,revoked_at FROM sessions ORDER BY rowid').all();
  const challenges=w.db.raw.prepare('SELECT nonce,used_at,invalidated_at FROM login_challenges ORDER BY rowid').all();
  return {sessions,challenges,counts:{created:sessions.length,
    live:sessions.filter(s=>s.revoked_at===null&&s.expires_at>w.clock.now()).length,
    revoked:sessions.filter(s=>s.revoked_at!==null).length,
    challenges:challenges.length,used:challenges.filter(c=>c.used_at!==null).length,
    pending:challenges.filter(c=>c.used_at===null&&c.invalidated_at===null).length,
    invalidated:challenges.filter(c=>c.invalidated_at!==null).length}};
}
export const routeEvents=(q,path)=>q.events.filter(e=>e.kind==='route'&&e.path===path);
export const logouts=q=>routeEvents(q,'/api/auth/logout');
export const clientKnowledge=q=>q.c.lifecycleSnapshot?.knowledge?.kind??(q.c.state.sessionKnown?q.c.state.session?'PRESENT':'ABSENT':'UNKNOWN');
export function snapshot(q){
  const s=q.c.lifecycleSnapshot;
  if(!s)return {availability:'legacy_NOT_AVAILABLE',state:q.c.state.phase,knowledge:{kind:clientKnowledge(q)},cleanup:'NOT_CHECKED'};
  // The documented diagnostic getter contains no tokens/signatures. Replace wallet addresses with presence flags.
  return {availability:'controller',state:s.state,knowledge:{kind:s.knowledge.kind,session:!!s.knowledge.session},
    click:s.click?{id:s.click.id,accountAtClick:!!s.click.accountAtClick,account:!!s.click.account,
      generationAtClick:s.click.generationAtClick,generation:s.click.generation,life:s.click.life,valid:s.click.valid,state:s.click.state}:null,
    cleanup:s.cleanup?{...s.cleanup}:null,retainedCount:s.retainedCount};
}
export function invariant(q){
  const s=q.c.lifecycleSnapshot;if(!s)return;
  assert.ok(s.retainedCount===0||s.retainedCount===1,'one verify flow has at most one retained owner');
  if(s.cleanup&&['RELEASED','CONSUMED'].includes(s.cleanup.status))assert.equal(s.retainedCount,0,'terminal owner has no actionable cleanup');
}
export function terminal(q,status){
  invariant(q);const s=q.c.lifecycleSnapshot;if(!s)return;
  assert.equal(s.cleanup?.status,status);assert.equal(s.retainedCount,0);
}
export function tab(w,b,p,{beforeSend=async()=>{},intercept=async(_path,r)=>r,getProvider=()=>p}={}){
  const events=[],states=[],channels=[],timerJobs=new Set();let providerChanged=()=>{},hint=null,arms=0,clears=0;
  const q={w,b,p,events,states,channels,timerJobs,get arms(){return arms;},get clears(){return clears;}};
  const mark=(name,detail={})=>{const e={kind:'event',name,order:events.length+1,at:w.clock.now(),...detail};events.push(e);return e;};
  q.mark=mark;
  const env={set:(fn,ms)=>{arms++;const job={fn,ms};timerJobs.add(job);return job;},clear:job=>{clears++;timerJobs.delete(job);},onVisible:()=>()=>{}};
  const channel=()=>{const listeners=[],ch={closed:false,messages:[],listeners,
    addEventListener:(_name,fn)=>listeners.push(fn),postMessage:v=>ch.messages.push(v),close:()=>{ch.closed=true;},
    message(){mark('CHANNEL_MESSAGE');for(const fn of listeners)fn();}};channels.push(ch);return ch;};
  q.c=new AuthClient({provider:getProvider,onProviderChange:fn=>{providerChanged=fn;return()=>{providerChanged=()=>{};}},
    now:w.clock.now,origin:b.origin,env,channel,hint:{get:()=>hint,set:v=>{hint=v;}},
    fetch:async(path,init={})=>{
      const body=init.body?JSON.parse(init.body):null;
      const e={kind:'route',order:events.length+1,at:w.clock.now(),path,method:init.method??'GET',
        nonceAssertion:!!body?.expectedNonce,addressAssertion:!!body?.expectedAddress,
        ...(body?.expectedNonce?{assertedNonce:body.expectedNonce}:{})};events.push(e);
      // Capture the request cookie at dispatch, before a network gate, like fetch; consume headers before body gates.
      const request=b.request(path,{method:e.method,body:init.body,headers:init.headers});
      await beforeSend(path,init,e);
      const r=b.keep(await b.send(request));e.status=r.status;e.setCookies=r.headers.getSetCookie().length;
      const out=await intercept(path,r,init,e);e.finished=true;return out;
    }});
  q.observeProvider=pr=>pr.setObserver(method=>{mark('WALLET_'+method,{knowledge:clientKnowledge(q)});});
  q.observeProvider(p);
  q.c.subscribe(()=>states.push({phase:q.c.state.phase,known:q.c.state.sessionKnown,session:!!q.c.state.session,knowledge:clientKnowledge(q),lifecycle:snapshot(q)}));
  q.signIn=()=>{mark('SIGN_CLICK');return q.c.signIn();};
  // Existing callers model an explicit wallet pick. Passive discovery must be stated, not inferred from object identity.
  q.notifyProvider=(reason='selection')=>{mark(reason==='selection'?'PROVIDER_SWITCH':'PROVIDER_DISCOVERY');providerChanged(reason);};
  q.restart=()=>{mark('RESTART');q.stop=q.c.start();return q.stop;};
  q.stop=q.c.start();mark('START');
  return q;
}
export async function ready(q){await until(()=>q.c.state.restored&&q.c.state.account&&!q.c.state.checking,'initial session/account resolved');}
export async function stallBody(r){
  const text=await r.clone().text();let controller,ended=false;
  const response=new Response(new ReadableStream({start(c){controller=c;}}),{status:r.status,headers:r.headers});
  return {response,finish(good=false){if(ended)return;ended=true;if(good){controller.enqueue(new TextEncoder().encode(text));controller.close();}else controller.error(new Error('synthetic body interruption'));}};
}
export function evidence(t,label,q,ps=[q.p],extra={}){
  const redact=e=>{const {assertedNonce,...safe}=e;return safe;};
  t.diagnostic('R7_LIFECYCLE '+JSON.stringify({label,sourceRole,at:q.w.clock.now(),counters:rows(q.w).counts,
    prompts:prompts(ps),connectPrompts:connects(ps),cookie:{session:q.b.jar.has(SESSION_COOKIE),flow:q.b.jar.has(FLOW_COOKIE)},
    client:{phase:q.c.state.phase,sessionKnown:q.c.state.sessionKnown,session:!!q.c.state.session,knowledge:clientKnowledge(q)},
    lifecycle:snapshot(q),events:q.events.map(redact),states:q.states,...extra}));
}
