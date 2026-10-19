-- Additive, independent of activation of financial contracts. No fixture data.
CREATE TABLE world_inventory_items (
  wallet TEXT NOT NULL CHECK(wallet=lower(wallet) AND length(wallet)=42),
  item_id TEXT NOT NULL CHECK(length(item_id) BETWEEN 3 AND 98),
  definition_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  acquired_ms INTEGER NOT NULL CHECK(typeof(acquired_ms)='integer' AND acquired_ms>0),
  revoked_ms INTEGER CHECK(revoked_ms IS NULL OR typeof(revoked_ms)='integer' AND revoked_ms>0),
  PRIMARY KEY(wallet,item_id),
  UNIQUE(source_id)
);
CREATE INDEX world_inventory_active ON world_inventory_items(wallet,revoked_ms,item_id);
CREATE TABLE world_inventory_arrangements (
  wallet TEXT PRIMARY KEY CHECK(wallet=lower(wallet) AND length(wallet)=42),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
  arrangement_json TEXT NOT NULL CHECK(json_valid(arrangement_json)),
  updated_ms INTEGER NOT NULL CHECK(typeof(updated_ms)='integer' AND updated_ms>0)
);
