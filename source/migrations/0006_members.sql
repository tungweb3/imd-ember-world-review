-- 2026-10-03, Web2 account layer M1 (server/member.ts): [REDACTED]
-- [REDACTED] Additive only: new tables and indexes plus seven 'system' name rows; no existing row or
-- column is changed, and code from before this migration never names them.
-- Apply it BEFORE deploying the code that uses it: wrangler d1 migrations apply imd-world --remote, after a backup export.
-- (Code deployed ahead of it answers the member routes 503 PROFILE_UNAVAILABLE; sign-in and every other route are unchanged.)
--
-- member_id is the Web2 ownership root [REDACTED], separate from the wallet: a session's
-- verified address resolves to it through wallet_identities, and it never grants a house or NFT right. Rows are created
-- only from a live server session (POST /api/me/bootstrap), never from a connected but unsigned wallet. The sessions
-- table is not touched: the member is resolved per request, not written into the session. [REDACTED]

-- members: member_id is internal ('m_' + 32 hex); public_member_id ('u_' + 20 base32) is random and carries nothing of
-- the wallet (no address, no address hash).
CREATE TABLE members(
  member_id TEXT PRIMARY KEY,
  public_member_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- wallet_identities: the verified login wallet of a member. identity_key is the server's canonical form of
-- (chain_namespace, chain_id, normalized_address), 'eip155:1:0x<40 lowercase hex>', and is the identity's one unique key:
-- two tabs signing in for the first time race on it, and the loser's whole batch rolls back. member_id is [REDACTED]
-- UNIQUE too: V1 has one primary login wallet per member. [REDACTED]
CREATE TABLE wallet_identities(
  wallet_identity_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL UNIQUE REFERENCES members(member_id),
  identity_key TEXT NOT NULL UNIQUE,
  chain_namespace TEXT NOT NULL CHECK(chain_namespace='eip155'),
  chain_id INTEGER NOT NULL CHECK(chain_id=1),
  normalized_address TEXT NOT NULL CHECK(length(normalized_address)=42 AND substr(normalized_address,1,2)='0x'
    AND substr(normalized_address,3) NOT GLOB '*[^0-9a-f]*'),
  verified_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active')),
  created_at INTEGER NOT NULL,
  CHECK(identity_key=chain_namespace||':'||chain_id||':'||normalized_address),
  UNIQUE(chain_namespace,chain_id,normalized_address)
);

-- member_profiles: the public name. display_name is NULL until the first name (needs_name); active_name_key mirrors the
-- member's 'active' nickname_claims row and is UNIQUE as a second lock. A moderated name becomes '會員-<code>' with
-- active_name_key NULL and needs_rename (scripts/member-moderate.mjs). version counts every name change (the client
-- sends the one it saw: PROFILE_VERSION_CONFLICT otherwise). next_name_change_at: 7 days after the first name or a
-- rename. avatar_key: [REDACTED].
CREATE TABLE member_profiles(
  member_id TEXT PRIMARY KEY REFERENCES members(member_id),
  display_name TEXT,
  active_name_key TEXT UNIQUE,
  avatar_key TEXT,
  profile_state TEXT NOT NULL DEFAULT 'needs_name' CHECK(profile_state IN ('needs_name','ready','needs_rename','locked')),
  version INTEGER NOT NULL DEFAULT 0,
  name_changed_at INTEGER,
  next_name_change_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(profile_state<>'ready' OR (display_name IS NOT NULL AND active_name_key IS NOT NULL))
);

-- nickname_claims: the one authority on who holds a name key (NFKC + ASCII lowercase, src/world/memberName.ts).
-- active: a member's current name (at most one per member: nickname_claims_one_active). reserved: a member's previous
-- name, kept for that member until reserved_until (30 days); after that anyone may take it (the claim that takes it
-- deletes the row in the same batch). system: names nobody may register (no member). quarantined: a name taken away by
-- moderation; never released by a rename.
CREATE TABLE nickname_claims(
  name_key TEXT PRIMARY KEY,
  claim_type TEXT NOT NULL CHECK(claim_type IN ('active','reserved','system','quarantined')),
  member_id TEXT REFERENCES members(member_id),
  reserved_until INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((claim_type='system')=(member_id IS NULL)),
  CHECK((claim_type='reserved')=(reserved_until IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS nickname_claims_one_active ON nickname_claims(member_id) WHERE claim_type='active';
CREATE INDEX IF NOT EXISTS nickname_claims_member ON nickname_claims(member_id);

-- profile_requests: one row per name write that reached the database (success or refusal), for the retry of the same
-- request (member + request_id: the same payload gets the same answer, another payload IDEMPOTENCY_CONFLICT) and the
-- per-member write limit (5 a minute). outcome 'ok' must carry the version it produced: the success row is the first
-- statement of the write's batch and reads that version through the expected-version guard, so a stale version, a
-- cooldown or a locked profile fails this CHECK and rolls the whole batch back. Kept a day (expires_at), pruned by the
-- member's next write.
CREATE TABLE profile_requests(
  member_id TEXT NOT NULL REFERENCES members(member_id),
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  result_version INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(member_id,request_id),
  CHECK(outcome<>'ok' OR result_version IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS profile_requests_recent ON profile_requests(member_id,created_at);

-- profile_history: every name change (initial, rename, moderation), who made it ('self' or 'admin') and why; never
-- served to other members. Kept 180 days (expires_at).
CREATE TABLE profile_history(
  history_id INTEGER PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(member_id),
  actor TEXT NOT NULL CHECK(actor IN ('self','admin')),
  kind TEXT NOT NULL CHECK(kind IN ('initial','rename','moderation')),
  old_name TEXT,
  new_name TEXT,
  reason TEXT,
  version INTEGER NOT NULL,
  at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profile_history_member ON profile_history(member_id,at);

-- economy_accounts: an aggregate cache only, created at 0. [REDACTED]
CREATE TABLE economy_accounts(
  member_id TEXT PRIMARY KEY REFERENCES members(member_id),
  settled_balance INTEGER NOT NULL DEFAULT 0,
  reserved_balance INTEGER NOT NULL DEFAULT 0,
  available_balance INTEGER NOT NULL DEFAULT 0,
  ledger_version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- life_state: created 'not_started' with no timer. [REDACTED]
-- [REDACTED]
CREATE TABLE life_state(
  member_id TEXT PRIMARY KEY REFERENCES members(member_id),
  life_number INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'not_started' CHECK(state IN ('not_started','alive','dead')),
  started_at INTEGER,
  last_valid_world_entry_at INTEGER,
  death_at INTEGER,
  revive_cost_at_death INTEGER,
  revived_at INTEGER,
  new_life_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- The reserved names as 'system' claims, the database's own lock under the code's check (memberName.ts RESERVED_NAMES,
-- which also refuses their case, full-width, underscore and look-alike variants).
INSERT INTO nickname_claims(name_key,claim_type,member_id,reserved_until,reason,created_at,updated_at) VALUES
  ('admin','system',NULL,NULL,'reserved-v1',0,0),
  ('administrator','system',NULL,NULL,'reserved-v1',0,0),
  ('moderator','system',NULL,NULL,'reserved-v1',0,0),
  ('imdember','system',NULL,NULL,'reserved-v1',0,0),
  ('imdemberofficial','system',NULL,NULL,'reserved-v1',0,0),
  ('官方客服','system',NULL,NULL,'reserved-v1',0,0),
  ('管理員','system',NULL,NULL,'reserved-v1',0,0);
