/** A cache is current only within its own clock domain and a finite, nonnegative elapsed interval.
 * Remote epoch timestamps must never be compared with a local monotonic timestamp. */
export function isFreshAge(now:number,stamp:number,ttl:number):boolean {
  if(!Number.isFinite(now)||!Number.isFinite(stamp)||!Number.isFinite(ttl)||ttl<=0)return false;
  const age=now-stamp;
  return Number.isFinite(age)&&age>=0&&age<ttl;
}
