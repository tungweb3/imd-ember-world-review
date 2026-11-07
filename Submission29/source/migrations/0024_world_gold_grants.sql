-- Administrator GOLD grants. A grant has no order or payment behind it, so it has its own immutable book,
-- and the limits live here as well, so a fault in the application cannot move past them. The window trusts created_ms, which comes from the Worker clock.
CREATE TABLE world_gold_grants (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL,
 delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta>0),
 kind TEXT NOT NULL CHECK(kind='admin-grant'),
 reference TEXT NOT NULL UNIQUE, actor TEXT NOT NULL, reason TEXT NOT NULL,
 created_ms INTEGER NOT NULL CHECK(typeof(created_ms)='integer' AND created_ms>0)
);
CREATE INDEX world_gold_grants_recent ON world_gold_grants(created_ms);
CREATE INDEX world_gold_grants_wallet ON world_gold_grants(wallet,created_ms DESC,id DESC);
CREATE TRIGGER world_gold_grants_no_update BEFORE UPDATE ON world_gold_grants BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOURNAL'); END;
CREATE TRIGGER world_gold_grants_no_delete BEFORE DELETE ON world_gold_grants BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOURNAL'); END;
CREATE TRIGGER world_gold_grant_authority BEFORE INSERT ON world_gold_grants BEGIN
 SELECT CASE WHEN NEW.actor NOT IN ('0x[REDACTED-GRANT-WALLET-1]','0x[REDACTED-GRANT-WALLET-2]') THEN RAISE(ABORT,'GRANT_ACTOR_NOT_ALLOWED') END;
 SELECT CASE WHEN NEW.reference IS NOT 'admin-grant:'||NEW.id THEN RAISE(ABORT,'INVALID_REFERENCE') END;
 SELECT CASE WHEN length(trim(NEW.reason))<3 OR length(NEW.reason)>500 THEN RAISE(ABORT,'REASON_REQUIRED') END;
 SELECT CASE WHEN NEW.wallet NOT GLOB '0x*' OR length(NEW.wallet)<>42 OR substr(NEW.wallet,3) GLOB '*[^0-9a-f]*' OR NEW.wallet='0x0000000000000000000000000000000000000000' THEN RAISE(ABORT,'INVALID_ADDRESS') END;
 SELECT CASE WHEN NEW.delta>5000 THEN RAISE(ABORT,'GRANT_AMOUNT_LIMIT') END;
 -- Counts every grant newer than the window's start, so a clock set back cannot reopen it.
 SELECT CASE WHEN NEW.delta+COALESCE((SELECT SUM(delta) FROM world_gold_grants WHERE created_ms>NEW.created_ms-86400000),0)>20000 THEN RAISE(ABORT,'GRANT_DAILY_LIMIT') END;
 SELECT CASE WHEN (SELECT COUNT(*) FROM world_gold_grants WHERE created_ms>NEW.created_ms-86400000)>=100 THEN RAISE(ABORT,'GRANT_DAILY_LIMIT') END;
 SELECT CASE WHEN COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=NEW.wallet),0)>9223372036854775807-NEW.delta THEN RAISE(ABORT,'GOLD_BALANCE_CAPACITY') END;
END;
CREATE TRIGGER world_gold_grant_apply AFTER INSERT ON world_gold_grants BEGIN
 INSERT INTO economy_gold_accounts(wallet,balance) VALUES(NEW.wallet,0) ON CONFLICT(wallet) DO NOTHING;
 UPDATE economy_gold_accounts SET balance=balance+NEW.delta WHERE wallet=NEW.wallet;
END;
DROP VIEW world_gold_history;
CREATE VIEW world_gold_history AS
 SELECT id,wallet,CAST(delta AS TEXT) delta,kind,reference,created_ms FROM economy_gold_journal
 UNION ALL SELECT e.id,e.wallet,CAST(e.delta AS TEXT),e.kind,e.reference,e.created_ms FROM world_gold_entries e
  WHERE NOT (e.kind='topup' AND EXISTS(SELECT 1 FROM world_gold_fast_credits f WHERE f.order_id=e.order_id AND f.state='settled'))
 UNION ALL SELECT id,wallet,CAST(delta AS TEXT),CASE kind WHEN 'fast-topup' THEN 'topup' ELSE kind END,reference,created_ms FROM world_gold_fast_entries
  WHERE kind<>'fast-settle'
 UNION ALL SELECT id,wallet,CAST(delta AS TEXT),kind,reference,created_ms FROM world_gold_grants;
