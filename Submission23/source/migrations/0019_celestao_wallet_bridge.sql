-- Dedicated Celestao identity. Does not enable a product or any GOLD feature.
CREATE TABLE celestao_auth_codes (
 code_hash TEXT PRIMARY KEY NOT NULL,
 source_session_hash TEXT NOT NULL,
 address TEXT NOT NULL,
 code_challenge TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 bridge_hash TEXT,
 CHECK(expires_at>issued_at),
 CHECK((consumed_at IS NULL)=(bridge_hash IS NULL))
);
CREATE INDEX celestao_auth_codes_expiry ON celestao_auth_codes(expires_at);
CREATE TABLE celestao_bridge_sessions (
 bridge_hash TEXT PRIMARY KEY NOT NULL,
 source_session_hash TEXT NOT NULL,
 address TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 CHECK(expires_at>created_at)
);
CREATE INDEX celestao_bridge_sessions_expiry ON celestao_bridge_sessions(expires_at);
