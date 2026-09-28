-- Wallet login W1 (docs/wallet-login/DESIGN_W1_v001.md §6). Times are epoch ms integers; addresses are lowercase hex.
-- login_challenges: one SIWE challenge per POST /api/auth/challenge. The exact signed text lives in `message` and is
-- verified from here, never from the client. flow_hash is SHA-256 of the __Host-imd_flow cookie (login CSRF binding).
-- A challenge is consumed once: used_at + session_hash are set in the same transaction that inserts the session.
CREATE TABLE login_challenges(
  nonce TEXT PRIMARY KEY, address TEXT NOT NULL, origin TEXT NOT NULL, flow_hash TEXT NOT NULL, message TEXT NOT NULL,
  issued_at INTEGER NOT NULL, accept_until INTEGER NOT NULL, used_at INTEGER, invalidated_at INTEGER, session_hash TEXT);
CREATE INDEX login_challenges_flow ON login_challenges(flow_hash, used_at);
-- sessions: only SHA-256(token) is stored. Absolute expiry, no renewal; logout sets revoked_at. nonce UNIQUE is the
-- second lock against one challenge producing two sessions.
CREATE TABLE sessions(
  token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER, nonce TEXT NOT NULL UNIQUE);
CREATE INDEX sessions_address ON sessions(address);
-- seat_presence: the last time IMD's /workers roster listed each seat online (cron, every 15 min). Never deleted ([REDACTED]).
-- owner is IMD's swarm.owners[id] at that time, informational only (ownership is ownerOf).
CREATE TABLE seat_presence(
  token_id INTEGER PRIMARY KEY, owner TEXT, last_online_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX seat_presence_seen ON seat_presence(last_online_at);
