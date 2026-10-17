-- AIMarket read-only SSO. Opaque authorization codes and bridge sessions are stored only as SHA-256.
-- Each bridge remains tied to its original World session; introspection rechecks expiry/revocation every time.
CREATE TABLE aimarket_auth_codes(
  code_hash TEXT PRIMARY KEY,
  source_session_hash TEXT NOT NULL,
  address TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  bridge_hash TEXT
);
CREATE INDEX aimarket_auth_codes_expiry ON aimarket_auth_codes(expires_at);
CREATE TABLE aimarket_bridge_sessions(
  bridge_hash TEXT PRIMARY KEY,
  source_session_hash TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX aimarket_bridge_sessions_expiry ON aimarket_bridge_sessions(expires_at);
