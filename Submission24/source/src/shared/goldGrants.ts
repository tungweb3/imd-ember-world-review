// Owner decision 2026-11-04. migrations/0024_world_gold_grants.sql enforces the same numbers in the database.
export const GOLD_GRANT_MAX=5000;
export const GOLD_GRANT_DAILY=20000;
// Rows cannot be pruned and every one enters a recovery plan, whose size is limited: keep the count bounded as well.
export const GOLD_GRANT_DAILY_COUNT=100;
export const GOLD_GRANT_WINDOW_MS=86400000;
export const GOLD_GRANT_DUPLICATE_MS=600000;
