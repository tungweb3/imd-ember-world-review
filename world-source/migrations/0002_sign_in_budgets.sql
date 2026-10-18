-- 2026-09-28, sign-in budgets (server/auth.ts). Additive only: two nullable columns and three indexes; no row is changed
-- or removed, and code from before this migration keeps working on it. Apply it BEFORE deploying the code that needs it
-- (its challenge INSERT names `net`): wrangler d1 migrations apply imd-world --remote, after a backup export. wrangler
-- records it in d1_migrations and never runs it twice (ALTER TABLE ADD COLUMN cannot be re-run).
-- net: the client network that asked for the challenge (IPv4 /24, IPv6 /48; worker/app.ts networkKey). checked_at: when a
-- verify claimed the challenge for its single ERC-1271 check (server/auth.ts CLAIM_ERC1271).
ALTER TABLE login_challenges ADD COLUMN net TEXT;
ALTER TABLE login_challenges ADD COLUMN checked_at INTEGER;
-- The global runaway valve counts the challenges of the last few seconds; the cron's prune reads the old end of this range.
CREATE INDEX IF NOT EXISTS login_challenges_issued ON login_challenges(issued_at);
-- The per-network budgets (challenges per minute, ERC-1271 checks per minute) read one network's recent challenges only.
CREATE INDEX IF NOT EXISTS login_challenges_net ON login_challenges(net, issued_at);
-- The cron deletes sessions that ended a day ago without reading every live one.
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires_at);
