/** A cache is current only within its own clock domain and a finite, nonnegative elapsed interval.
 * Remote epoch timestamps must never be compared with a local monotonic timestamp. */
export function isFreshAge(now:number,stamp:number,ttl:number):boolean {
  if(!Number.isFinite(now)||!Number.isFinite(stamp)||!Number.isFinite(ttl)||ttl<=0)return false;
  const age=now-stamp;
  return Number.isFinite(age)&&age>=0&&age<ttl;
}

/** Existing gateway shared-copy policy, also used by consumers of public remote data.
 * This display/transport tolerance never applies to sessions, ownership proofs or local cache timers. */
export const PUBLIC_REMOTE_SKEW_MS=60_000;
/** Signed epoch age, preserving the producer's original timestamp. Null outside the clock-skew policy. */
export function publicRemoteAge(now:number,stamp:number):number|null {
  if(!Number.isFinite(now)||!Number.isFinite(stamp))return null;
  const age=now-stamp;
  return Number.isFinite(age)&&age>=-PUBLIC_REMOTE_SKEW_MS?age:null;
}
/** Remote public samples use the existing finite 60-second lower bound and a half-open TTL. */
export function isFreshPublicRemote(now:number,stamp:number,ttl:number):boolean {
  if(!Number.isFinite(ttl)||ttl<=0)return false;
  const age=publicRemoteAge(now,stamp);
  return age!==null&&age<ttl;
}
