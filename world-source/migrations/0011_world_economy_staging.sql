-- A busy finalized block is verified in bounded receipt pages. Staged rows
-- cannot change positions, orders, balances or the fully confirmed horizon.
CREATE TABLE economy_pending_blocks (
  config_id TEXT PRIMARY KEY,
  block_number TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  through_ms INTEGER NOT NULL CHECK(typeof(through_ms)='integer' AND through_ms>=0),
  total_logs INTEGER NOT NULL CHECK(typeof(total_logs)='integer' AND total_logs>0 AND total_logs<=10000),
  digest TEXT NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0 CHECK(typeof(next_offset)='integer' AND next_offset>=0 AND next_offset<=total_logs),
  FOREIGN KEY(config_id) REFERENCES economy_chain_state(config_id)
);
CREATE TABLE economy_staged_events (
  config_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal>=0),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  PRIMARY KEY(config_id,ordinal),
  FOREIGN KEY(config_id) REFERENCES economy_pending_blocks(config_id) ON DELETE CASCADE
);
CREATE TABLE economy_stage_batches (
  id TEXT PRIMARY KEY,
  accepted INTEGER NOT NULL CHECK(accepted=1)
);
