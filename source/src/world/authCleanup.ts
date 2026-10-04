/** Pure policy: an event selects one primary server authority. It never sees a cookie or performs I/O. */
export type CleanupReason='account-switch'|'provider-switch'|'stop'|'lock'|'explicit-signout'|'explicit-signout-all'|'preflight-mismatch'|'verify-settled';
export type CancellationReason='context-switch'|'stop'|'explicit-signout'|'lock-reconcile';
type OwnerAssertion={status:'RETAINED'|'RELEASED'|'CONSUMED';nonce:string;cancellationReason:CancellationReason|null};
export type CleanupSnapshot={displayedAddress?:string;owner?:OwnerAssertion|null;pending:boolean};
export type CleanupPlan=
  |{kind:'none'}
  |{kind:'pending-flow-local-cancel'}
  |{kind:'reconcile'}
  |{kind:'displayed-session';expectedAddress:string}
  |{kind:'verify-owner';expectedNonce:string}
  |{kind:'explicit'}
  |{kind:'explicit-all';expectedAddress?:string};
export function planCleanup(reason:CleanupReason,s:CleanupSnapshot):CleanupPlan{
  if(reason==='explicit-signout')return {kind:'explicit'};
  if(reason==='explicit-signout-all')return {kind:'explicit-all',expectedAddress:s.displayedAddress};
  const owner=s.owner?.status==='RETAINED'?s.owner:null;
  if(reason==='lock')return owner?{kind:'reconcile'}:s.pending?{kind:'pending-flow-local-cancel'}:{kind:'none'};
  if(reason==='verify-settled')return owner?owner.cancellationReason==='lock-reconcile'?{kind:'reconcile'}:
    {kind:'verify-owner',expectedNonce:owner.nonce}:{kind:'none'};
  // A trusted displayed session, including a newer session than the retained owner, is the switch's authority.
  if(reason!=='stop'&&s.displayedAddress)return {kind:'displayed-session',expectedAddress:s.displayedAddress};
  if(owner)return {kind:'verify-owner',expectedNonce:owner.nonce};
  return s.pending?{kind:'pending-flow-local-cancel'}:{kind:'none'};
}
