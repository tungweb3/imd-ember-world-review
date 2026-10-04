// Normative oracle for the R8 v1.1 policy. Deliberately no production imports, not even lifecycle/status helpers.
// Abstract identities are not address/expiry tuples. Opaque production values are bound to these identities only
// in the driver; expected authority, transitions and row counts are calculated here from input events.
export const ORACLE_VERSION='r8-reference-1';
export const TEST_ORIGIN='https://imdember.com';
export const CHALLENGE_LIFE=300_000,SESSION_LIFE=604_800_000;
export class InvariantFailure extends Error{
  constructor(id,message,detail={}){super(`${id}: ${message}`);this.name='InvariantFailure';this.invariant=id;this.detail=detail;}
}
const requireRule=(yes,id,message,detail)=>{if(!yes)throw new InvariantFailure(id,message,detail);};
export function canonical(payload,status=200){
  if(status!==200||!payload||typeof payload!=='object'||Array.isArray(payload))return {kind:'UNKNOWN'};
  if(payload.signedIn===false&&(payload.expired===undefined||typeof payload.expired==='boolean'))return {kind:'ABSENT'};
  if(payload.signedIn===true&&typeof payload.address==='string'&&/^0x[\da-fA-F]{40}$/.test(payload.address)
    &&Number.isSafeInteger(payload.expiresAt)&&payload.expiresAt>0)return {kind:'PRESENT',address:payload.address.toLowerCase(),expiresAt:payload.expiresAt};
  return {kind:'UNKNOWN'};
}
export class AuthReference{
  constructor(addresses,now){this.addresses=addresses;this.now=now;this.jar={session:null,flow:null};this.tabs=new Map();
    this.sessions=new Map();this.challenges=new Map();this.requests=new Map();this.sequence=0;this.effects=[];this.comparisons=0;}
  tab(id,account='A'){this.tabs.set(id,{id,account,provider:0,active:false,life:0,epoch:0,read:0,knowledge:'UNKNOWN',displayed:null,
    click:null,owners:[],plans:[],prompts:0,challenges:0,verifies:0,hints:0,outHints:0});return this.tabs.get(id);}
  start(id){const t=this.tabs.get(id);t.active=true;t.life++;t.epoch++;t.click=null;}
  click(id){const t=this.tabs.get(id);if(t.click?.valid)return null;
    const c={id:++this.sequence,tab:id,account:t.account,provider:t.provider,life:t.life,epoch:t.epoch,valid:true,preflight:null,prompts:0,
      challenge:null,owner:null};t.click=c;return c;}
  finish(id){const c=this.tabs.get(id).click;if(c)c.valid=false;this.tabs.get(id).click=null;}
  intent(id,reason,account){const t=this.tabs.get(id),click=t.click,displayed=t.displayed;
    const retained=t.owners.find(o=>o.status==='RETAINED');
    if(reason==='lock'&&!click&&!retained){t.account=null;return;}
    let kind='none',target=null;
    if(reason==='explicit'){kind='explicit';}
    else if(reason==='explicit-all'){kind='explicit-all';target=displayed?.address??null;}
    else if(reason==='lock'){kind=retained?'reconcile':click?'pending-flow-local-cancel':'none';}
    else if(reason==='stop'){if(retained){kind='verify-owner';target=retained.nonce;}}
    else if(displayed){kind='displayed-session';target=displayed.address;}
    else if(retained){kind='verify-owner';target=retained.nonce;}
    else if(click){kind='pending-flow-local-cancel';}
    t.plans.push({eventId:++this.sequence,reason,kind,target,dispatches:0});
    if(click)click.valid=false;
    for(const owner of t.owners)if(owner.status==='RETAINED')owner.cancelReason=reason;
    t.click=null;t.epoch++;
    if(reason==='stop'){t.active=false;t.life++;return;}
    if(reason==='account'||reason==='lock')t.account=account??null;
    if(reason==='provider'){t.provider++;t.account=account??null;}
    if(reason==='account'&&displayed&&account&&this.addresses[account]!==displayed.address)t.displayed=null;
    // Cancelling an unsigned prompt changes no shared auth context. Preserve its already canonical knowledge on
    // LOCK; a retained verify is uncertain and must reconcile. Account/provider changes invalidate evidence.
    if(reason==='lock'?!!retained:click||retained||displayed&&(reason==='account'||reason==='provider'))t.knowledge='UNKNOWN';
  }
  liveClick(t,c=t.click){return !!c?.valid&&t.active&&c.life===t.life&&c.epoch===t.epoch&&c.provider===t.provider&&c.account===t.account;}
  command(id,path,body,cookie){
    const t=id==='external'?null:this.tabs.get(id),r={id:++this.sequence,tab:id,path,body,cookie:{...cookie},epoch:t?.epoch,life:t?.life,
      click:t?.click??null,status:null,expected:null,visible:false,bodyApplied:false};
    if(path==='/api/auth/session'){r.read=++t.read;}
    if(path==='/api/auth/challenge'&&t){
      const c=t.click;requireRule(this.liveClick(t,c),'AUTH-I10','challenge needs the original live click');
      requireRule(c.preflight?.kind==='ABSENT','AUTH-I3','challenge needs this click own canonical ABSENT read',{tab:id});
      requireRule(t.knowledge==='ABSENT','AUTH-I9','UNKNOWN/PRESENT cannot open a challenge');
      requireRule(!c.challenge,'AUTH-I3','one click cannot request two challenges');c.challenge=r.id;t.challenges++;
    }
    if(path==='/api/auth/verify'&&t){const c=t.click;
      requireRule(this.liveClick(t,c),'AUTH-I10','verify needs original live click');
      requireRule(c.prompts===1&&!c.owner,'AUTH-I10','one verified intent needs one prompt');
      const owner={nonce:body.nonce,click:c,status:'RETAINED',cancelReason:null,responseVisible:false,fence:null,attempts:0,effective:0};
      c.owner=owner;t.owners.push(owner);t.verifies++;t.knowledge='UNKNOWN';r.owner=owner;
    }
    if(path==='/api/auth/logout'||path==='/api/auth/logout-all'){
      r.cleanup=body.expectedNonce?'verify-owner':body.expectedAddress?'displayed-session':'explicit';
      if(t){const plan=t.plans.at(-1);
        if(body.expectedNonce){const o=t.owners.find(o=>o.nonce===body.expectedNonce);
          requireRule(o,'AUTH-I5','pending challenge cancellation is local; it cannot dispatch a competing nonce cleanup');
          requireRule(o?.status==='RETAINED','AUTH-I1','terminal or unknown nonce cannot acquire cleanup authority');
          requireRule(o.cancelReason!=='lock','INFO-1','wallet lock reconciles uncertain verification without automatic logout');
          requireRule(plan?.kind!=='displayed-session','AUTH-I5','displayed address plan cannot also dispatch nonce cleanup');
          requireRule(o.attempts<2,'AUTH-I5','bounded conditional retry per retained responsibility');o.attempts++;r.cleanupOwner=o;r.cleanupObserved=o.responseVisible;
        }else if(body.expectedAddress){
          // A click replacing an already-present other address has the same conditional address authority law.
          const clickReplacement=this.liveClick(t)&&t.displayed?.address===body.expectedAddress;
          requireRule(plan?.kind==='displayed-session'||plan?.kind==='explicit-all'||clickReplacement,'AUTH-I5','address cleanup needs a displayed-context plan');
          if(!clickReplacement){requireRule(plan.target===body.expectedAddress,'AUTH-I11','cleanup targets original displayed address');
            requireRule(plan.dispatches===0,'AUTH-I5','one primary address request per lifecycle event');plan.dispatches++;}
        }else requireRule(plan?.kind==='explicit','AUTH-I5','unconditional logout requires explicit sign-out intent');
      }
    }
    this.requests.set(r.id,r);this.effects.push({type:'command',tab:id,path,cleanup:r.cleanup??null});return r;
  }
  prompt(id){const t=this.tabs.get(id),c=t.click;
    requireRule(this.liveClick(t,c),'AUTH-I10','late prompt cannot migrate wallet context');
    requireRule(c.preflight?.kind==='ABSENT'&&t.knowledge==='ABSENT','AUTH-I9','prompt requires fresh canonical ABSENT');
    requireRule(c.prompts===0,'AUTH-I10','one explicit click has at most one personal_sign');
    c.prompts++;t.prompts++;this.effects.push({type:'prompt',tab:id,click:c.id});
  }
  run(r,now,fault){
    this.now=now;const cookie=r.cookie,s=cookie.session&&this.sessions.get(cookie.session),live=s&&!s.revoked&&s.expiresAt>now;
    const fail=(status,error)=>({status,payload:{error},cookies:[]});let out;
    if(fault&&r.path==='/api/auth/session')out={status:fault==='invalid'?200:Number(fault),payload:fault==='invalid'?{signedIn:'yes'}:{error:'AUTH_UNAVAILABLE'},cookies:[]};
    else if(r.path==='/api/auth/session')out={status:200,payload:live?{signedIn:true,address:s.address,expiresAt:s.expiresAt}:{signedIn:false,...s&&s.expiresAt<=now?{expired:true}:{}},cookies:[]};
    else if(r.path==='/api/auth/challenge'){
      const n='N'+(this.challenges.size+1),f='F'+(this.challenges.size+1);
      for(const c of this.challenges.values())if(c.flow===cookie.flow&&!c.used&&!c.invalid)c.invalid=true;
      const c={nonce:n,flow:f,address:r.body.address.toLowerCase(),issuedAt:now,acceptUntil:now+CHALLENGE_LIFE,used:false,invalid:false};
      this.challenges.set(n,c);r.nonce=n;out={status:200,payload:{nonce:n,acceptUntil:c.acceptUntil},cookies:[['flow',f]]};
    }else if(r.path==='/api/auth/verify'){
      const c=this.challenges.get(r.body.nonce);
      if(!c)out=fail(409,'CHALLENGE_USED');
      else if(cookie.flow!==c.flow)out=fail(403,'FLOW_MISMATCH');
      else if(c.used||c.invalid)out=fail(409,'CHALLENGE_USED');
      else if(now>=c.acceptUntil)out=fail(410,'CHALLENGE_EXPIRED');
      else{c.used=true;const id='S'+(this.sessions.size+1),ss={id,nonce:c.nonce,address:c.address,expiresAt:c.issuedAt+SESSION_LIFE,revoked:false};
        this.sessions.set(id,ss);r.session=id;out={status:200,payload:{address:ss.address,expiresAt:ss.expiresAt},cookies:[['session',id],['flow',null]]};}
    }else if(r.path==='/api/auth/logout'||r.path==='/api/auth/logout-all'){
      let targetFlow=cookie.flow,clearFlow=true,allowed=true;
      if(r.body.expectedNonce){const n=r.body.expectedNonce,c=this.challenges.get(n);
        if(!live||s.nonce!==n){
          if(cookie.session!==null||!c||c.flow!==cookie.flow||c.used||c.invalid||c.acceptUntil<=now){out=fail(409,'ACCOUNT_CONTEXT_CHANGED');allowed=false;}
          else{c.invalid=true;out={status:204,payload:null,cookies:[['flow',null]]};allowed=false;}
        }else{targetFlow=c?.flow??null;clearFlow=targetFlow===cookie.flow;}
      }else if(r.body.expectedAddress){
        if(!live){out=fail(401,!cookie.session?'AUTH_REQUIRED':s?.expiresAt<=now?'SESSION_EXPIRED':'AUTH_REQUIRED');allowed=false;}
        else if(s.address!==r.body.expectedAddress.toLowerCase()){out=fail(409,'ACCOUNT_CONTEXT_CHANGED');allowed=false;}
        else{targetFlow=this.challenges.get(s.nonce)?.flow??null;clearFlow=targetFlow===cookie.flow;}
      }
      if(allowed){if(s)s.revoked=true;
        for(const c of this.challenges.values())if(c.flow===targetFlow&&!c.used&&!c.invalid)c.invalid=true;
        out={status:204,payload:null,cookies:[['session',null],...clearFlow?[['flow',null]]:[]]};}
      if(r.cleanupOwner&&out.status===204){r.cleanupOwner.effective++;
        requireRule(r.cleanupOwner.effective<=1,'AUTH-I5','one responsibility has at most one effective cleanup');}
    }else if(r.path.startsWith('/api/me/home'))out=live?{status:200,payload:{address:s.address},cookies:[]}:fail(401,'AUTH_REQUIRED');
    else throw new InvariantFailure('HARNESS-ROUTE','unmodelled route',{path:r.path});
    r.expected=out;r.status=out.status;return out;
  }
  headers(r){for(const [kind,value] of r.expected.cookies)this.jar[kind]=value;}
  visible(r){r.visible=true;if(r.owner){r.owner.responseVisible=true;r.owner.fence=this.tabs.get(r.tab).read;}
    // Failed session reads do not parse their body. Receipt of the status already means UNKNOWN.
    if(r.path==='/api/auth/session'&&r.status!==200){const t=this.tabs.get(r.tab);
      if(t.active&&r.epoch===t.epoch&&r.life===t.life&&r.read===t.read){t.knowledge='UNKNOWN';
        if(r.click&&this.liveClick(t,r.click))r.click.preflight={kind:'UNKNOWN',request:r.id};}}
  }
  body(r,payload=r.expected.payload){if(r.bodyApplied)return;r.bodyApplied=true;const t=this.tabs.get(r.tab);if(!t)return;
    const current=t.active&&r.epoch===t.epoch&&r.life===t.life;
    if(r.path==='/api/auth/session'){
      const owner=t.owners.find(o=>o.status==='RETAINED'&&o.click.life===t.life&&(o.click.epoch===t.epoch||o.cancelReason==='lock'));
      if(!current||r.read!==t.read||owner&&(!owner.responseVisible||r.read<=owner.fence))return;
      const k=canonical(payload,r.status);t.knowledge=k.kind;
      if(k.kind==='PRESENT'){t.displayed={address:k.address,expiresAt:k.expiresAt};if(owner)owner.status='RELEASED';}
      else if(k.kind==='ABSENT'){t.displayed=null;if(owner)owner.status='RELEASED';}
      if(r.click&&this.liveClick(t,r.click))r.click.preflight={...k,request:r.id};
    }else if(r.path==='/api/auth/verify'){
      if(r.status!==200){r.owner.status='RELEASED';return;}
      if(current&&this.liveClick(t,r.click)&&payload&&typeof payload.address==='string'&&Number.isSafeInteger(payload.expiresAt)){
        requireRule(payload.address.toLowerCase()===this.addresses[r.click.account],'AUTH-I10','verify names original signer');
        if(r.owner.status==='RETAINED'){r.owner.status='RELEASED';t.displayed={address:payload.address.toLowerCase(),expiresAt:payload.expiresAt};t.knowledge='PRESENT';}
      }
    }else if(r.path==='/api/auth/logout'||r.path==='/api/auth/logout-all'){
      if(r.cleanupOwner&&r.cleanupOwner.status==='RETAINED'&&(r.status===204||r.cleanupObserved))r.cleanupOwner.status='CONSUMED';
      if(current&&r.status===204&&r.cleanup==='explicit'){t.displayed=null;t.knowledge='ABSENT';}
    }else if(r.path.startsWith('/api/me/home')&&current&&r.status===401){t.displayed=null;t.knowledge='UNKNOWN';}
  }
  hint(id,kind){const t=this.tabs.get(id);requireRule(t.active,'AUTH-I6','stopped client cannot broadcast');
    if(kind==='signed-in'){
      const o=[...t.owners].reverse().find(o=>o.status==='RELEASED'&&!o.hinted&&o.click.life===t.life&&(o.click.epoch===t.epoch||o.cancelReason==='lock'));
      requireRule(o&&t.knowledge==='PRESENT','AUTH-I2','signed-in is only a hint after accepted canonical evidence');o.hinted=true;t.hints++;
    }else if(kind==='signed-out')t.outHints++;
    else throw new InvariantFailure('HARNESS-HINT','unmodelled hint');
  }
  revokeAll(){for(const s of this.sessions.values())s.revoked=true;}
  counts(){const ss=[...this.sessions.values()],cc=[...this.challenges.values()];return {created:ss.length,live:ss.filter(s=>!s.revoked&&s.expiresAt>this.now).length,
    revoked:ss.filter(s=>s.revoked).length,challenges:cc.length,used:cc.filter(c=>c.used).length,
    pending:cc.filter(c=>!c.used&&!c.invalid&&c.acceptUntil>this.now).length,unusedRows:cc.filter(c=>!c.used&&!c.invalid).length,
    invalidated:cc.filter(c=>c.invalid).length};}
  projection(id){const t=this.tabs.get(id);return {knowledge:t.knowledge,displayed:t.displayed?.address??null,prompts:t.prompts,
    challenges:t.challenges,verifies:t.verifies,hints:t.hints};}
  assertProjection(id,actual){const expected=this.projection(id);for(const key of Object.keys(expected))
    requireRule(actual[key]===expected[key],'REFERENCE-PROJECTION',`${id} ${key} differs`,{key,expected:expected[key],actual:actual[key]});this.comparisons++;}
}
