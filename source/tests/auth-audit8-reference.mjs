// Audit8 normative extension. Imports only the independent pure policy model;
// no AuthClient, production lifecycle, planner, Worker or provider implementation.
import {AuthReference,InvariantFailure} from './auth-reference-model.mjs';
export const AUDIT8_ORACLE_VERSION='audit8-reference-1';
export class Audit8Reference extends AuthReference{
  discovery(id){
    const t=this.tabs.get(id);
    // Discovery changes wallet inventory, not an explicit authentication intent.
    // It grants no authority to clear a displayed or retained same-address session.
    this.effects.push({type:'passive-discovery',tab:id});return t;
  }
  unlock(id,account){
    const t=this.tabs.get(id),locked=t.owners.find(o=>o.status==='RETAINED'&&o.cancelReason==='lock');
    const same=locked?locked.click.account===account:t.displayed?.address===this.addresses[account];
    if(!same)return this.intent(id,'account',account);
    // Account availability returned, not a different signer. Old callbacks remain
    // fenced by the original epoch, and the lock owner keeps reconciliation duty.
    t.account=account;t.epoch++;
    this.effects.push({type:'same-account-unlock',tab:id});
  }
  requireValidSignatureCompletion(id){
    const t=this.tabs.get(id);
    if(t.prompts!==1||t.challenges!==1||t.verifies!==1||this.counts().created!==1||this.counts().live!==1)
      throw new InvariantFailure('AUDIT8-SIGNATURE-CONTINUITY','ordinary hint while valid prompt is open must not silently discard that signed challenge',
        {tab:id,prompts:t.prompts,challenges:t.challenges,verifies:t.verifies,created:this.counts().created,live:this.counts().live});
  }
}
