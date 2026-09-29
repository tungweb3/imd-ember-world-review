-- 2026-09-29, swarm review follow-ups (server/auth.ts). Additive only: nullable columns and indexes; no row is changed or
-- removed, and code from before this migration keeps working on it. Apply it BEFORE deploying the code that needs it (its
-- session INSERT names wallet_type): wrangler d1 migrations apply imd-world --remote, after a backup export. wrangler
-- records it in d1_migrations and never runs it twice (ALTER TABLE ADD COLUMN cannot be re-run).
-- F-2: how each session was proven, for audit and debugging only (ownership is still read from ownerOf, never from here):
-- wallet_type 'EOA' | 'CONTRACT', verification_method 'ECDSA' | 'ERC1271'. Sessions made before this migration keep NULL.
ALTER TABLE sessions ADD COLUMN wallet_type TEXT;
ALTER TABLE sessions ADD COLUMN verification_method TEXT;
-- Is an address a known smart wallet (server/auth.ts KNOWN_ERC1271)? A partial index of ERC-1271 sessions only, so the
-- lookup reads at most one entry and never an address's ECDSA sessions, however many there are.
CREATE INDEX IF NOT EXISTS sessions_erc1271 ON sessions(address) WHERE verification_method='ERC1271';
-- F-4 logout-all (REVOKE_ALL_SESSIONS) reads only an address's live sessions, never the ones already revoked.
CREATE INDEX IF NOT EXISTS sessions_live ON sessions(address, expires_at) WHERE revoked_at IS NULL;
-- F-3: called_at is when a claimed ERC-1271 check went on to a contract (server/auth.ts CLAIM_CONTRACT). The two partial
-- indexes hold only those rows (a few a minute), so the per-network and per-address contract shares read at most their
-- share and an ordinary challenge writes no entry in them.
ALTER TABLE login_challenges ADD COLUMN called_at INTEGER;
CREATE INDEX IF NOT EXISTS login_challenges_called_net ON login_challenges(net, called_at) WHERE called_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS login_challenges_called_address ON login_challenges(address, called_at) WHERE called_at IS NOT NULL;
-- F-5: the per-wallet challenge cooldown (per address and network) and the cross-network surge count read one address's
-- challenges of the last minute; net is in the index, so neither reads the table.
CREATE INDEX IF NOT EXISTS login_challenges_address ON login_challenges(address, issued_at, net);
