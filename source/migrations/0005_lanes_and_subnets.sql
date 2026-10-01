-- 2026-09-30, Swarm audit 8c3aea2e N-4..N-6 (server/auth.ts, server/ownership.ts). Additive only: two nullable columns and
-- one new table with two indexes; no row is changed or removed, and code from before this migration never names them.
-- Apply it BEFORE deploying the code that uses it: wrangler d1 migrations apply imd-world --remote, after a backup export.
-- (Code deployed ahead of it keeps the 0004 rules: its challenge INSERT and ERC-1271 claims fall back to the 0004
-- statements, and no index lane is taken.)
-- sub: the IPv6 /64 of the client that asked for the challenge (worker/app.ts subnetKey, written by INSERT_CHALLENGE;
-- NULL for IPv4, IPv4-mapped and unknown), so a /48's ERC-1271 claims and contract checks are also counted per /64 (N-5),
-- by the /64 that asked, whoever sends the verify. Never the host bits. It lives as long as its challenge row (the cron's
-- prune: at most about 25 min unused, about a day used). Not indexed: read only on the rows the per-network counts
-- already visit.
ALTER TABLE login_challenges ADD COLUMN sub TEXT;
-- called_via: 'pool' (CLAIM_CONTRACT) or 'lane' (CLAIM_LANE) for a claimed contract check, so the lane counts lane checks
-- only (N-4). NULL before this migration (counted as a lane: the old rule).
ALTER TABLE login_challenges ADD COLUMN called_via TEXT;
-- index_lanes: one row per NFT-index read taken on a network's lane (N-6, server/ownership.ts home): the network key
-- (IPv4 /24, IPv6 /48), its /64 for IPv6 (else NULL) and when. index_lanes_net serves the per-network count (covering);
-- index_lanes_at the site-wide ceiling and the cron's prune of rows older than a minute.
CREATE TABLE index_lanes(net TEXT NOT NULL, sub TEXT, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS index_lanes_net ON index_lanes(net, at, sub);
CREATE INDEX IF NOT EXISTS index_lanes_at ON index_lanes(at);
