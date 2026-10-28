-- Genesis paid orders (server/genesis-gold.ts): where the cron's bounded reconciliation page resumes, one row per
-- pinned deployment, so orders after a long-pending one are still reached. Holds and settlements stay in 0014's tables.
CREATE TABLE genesis_gold_cursors (
 deployment TEXT PRIMARY KEY,
 after TEXT NOT NULL,
 updated_ms INTEGER NOT NULL CHECK(typeof(updated_ms)='integer' AND updated_ms>0)
);
