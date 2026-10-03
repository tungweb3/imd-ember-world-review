-- AUD4 World/Auth/M1 hardening. 0007 (Coin E1) is deliberately not part of this deployment.
-- A new logical request reserves one of five per-member slots atomically with its outcome.
-- Existing keys bypass the budget guard so retries/collisions reach the PK and are re-read by the server.
CREATE TRIGGER profile_requests_write_budget
BEFORE INSERT ON profile_requests
WHEN NOT EXISTS (
  SELECT 1 FROM profile_requests WHERE member_id=NEW.member_id AND request_id=NEW.request_id
)
AND (SELECT count(*) FROM (
  SELECT 1 FROM profile_requests
  WHERE member_id=NEW.member_id AND created_at>NEW.created_at-60000
  LIMIT 5
)) >= 5
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_WRITE_RATE_LIMIT');
END;

-- Global expiry scans do not depend on a member returning to rename.
CREATE INDEX profile_requests_expiry ON profile_requests(expires_at,member_id,request_id);
CREATE INDEX profile_history_expiry ON profile_history(expires_at,history_id);

-- AUD4-03: local limiter probes have their own 30 s network backoff. They never count toward index_lanes' admitted
-- global capacity. scope_key is canonical net + separator + sub (empty for IPv4), never a nullable composite PK.
-- Allow, refusal and limiter failure all keep the probe until expiry; no release/update refund workload.
CREATE TABLE index_lane_probes(
  scope_key TEXT PRIMARY KEY,
  net TEXT NOT NULL,
  sub TEXT,
  probed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at = probed_at + 30000)
);
-- At most two current network entries read per reservation; scope_key makes this a covering read.
CREATE INDEX index_lane_probes_net ON index_lane_probes(net,expires_at,scope_key);
-- Bounded opportunistic (2) and independent cron (200) prune; no scan of unexpired scopes.
CREATE INDEX index_lane_probes_expiry ON index_lane_probes(expires_at,scope_key);
