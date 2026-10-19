-- Additive local candidate. Existing stake journal remains immutable. Both
-- journals apply to ONE economy_gold_accounts row; the view is the full ledger.
CREATE TABLE world_gold_products (
 id TEXT PRIMARY KEY, product TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 kind TEXT NOT NULL CHECK(kind IN ('topup','service')), title TEXT NOT NULL,
 gold INTEGER NOT NULL CHECK(typeof(gold)='integer' AND gold>0), embeo TEXT,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), created_ms INTEGER NOT NULL,
 UNIQUE(product,version)
);
CREATE TABLE world_gold_links (
 order_id TEXT PRIMARY KEY REFERENCES economy_orders(id),
 product_id TEXT NOT NULL REFERENCES world_gold_products(id),
 kind TEXT NOT NULL CHECK(kind IN ('topup','service')),
 gold INTEGER NOT NULL CHECK(typeof(gold)='integer' AND gold>0)
);
CREATE TABLE world_gold_mints (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, auth_json TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 chain_id INTEGER NOT NULL, contract TEXT NOT NULL, chain_instance TEXT NOT NULL,
 deadline INTEGER NOT NULL, created_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('held','consumed','released')),
 evidence_json TEXT
);
CREATE TABLE world_gold_holds (
 id TEXT PRIMARY KEY REFERENCES world_gold_mints(id), wallet TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0),
 state TEXT NOT NULL CHECK(state IN ('held','consumed','released'))
);
CREATE INDEX world_gold_holds_wallet ON world_gold_holds(wallet,state);
CREATE TABLE world_gold_jobs (
 order_id TEXT PRIMARY KEY REFERENCES economy_orders(id), wallet TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','working','delivered','failed','refunded')),
 attempt TEXT, lease_ms INTEGER, result_json TEXT, failure TEXT, updated_ms INTEGER NOT NULL
);
CREATE TABLE world_gold_entries (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),
 kind TEXT NOT NULL CHECK(kind IN ('topup','service-refund','mint-payment')),
 reference TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL, created_ms INTEGER NOT NULL
);
CREATE INDEX world_gold_entries_wallet ON world_gold_entries(wallet,created_ms DESC,id DESC);
CREATE TABLE world_gold_admin_actions (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, request_id TEXT NOT NULL, action TEXT NOT NULL,
 payload TEXT NOT NULL, created_ms INTEGER NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, UNIQUE(wallet,request_id)
);
CREATE TABLE world_gold_campaigns (
 version INTEGER PRIMARY KEY CHECK(version>0), starts_ms INTEGER NOT NULL,
 ends_ms INTEGER NOT NULL CHECK(ends_ms>starts_ms), stopped INTEGER NOT NULL CHECK(stopped IN (0,1)),
 created_ms INTEGER NOT NULL, actor TEXT NOT NULL
);
CREATE TABLE world_gold_controls (
 feature TEXT PRIMARY KEY CHECK(feature IN ('topup','service','mint')), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE world_gold_write_checks(id TEXT PRIMARY KEY,accepted INTEGER NOT NULL CHECK(accepted=1),before_json TEXT);
INSERT INTO world_gold_controls(feature,enabled) VALUES('topup',1),('service',1),('mint',1);
CREATE TRIGGER world_gold_products_no_update BEFORE UPDATE ON world_gold_products BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRODUCT'); END;
CREATE TRIGGER world_gold_products_no_delete BEFORE DELETE ON world_gold_products BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PRODUCT'); END;
CREATE TRIGGER world_gold_links_no_update BEFORE UPDATE ON world_gold_links BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUOTE'); END;
CREATE TRIGGER world_gold_links_no_delete BEFORE DELETE ON world_gold_links BEGIN SELECT RAISE(ABORT,'IMMUTABLE_QUOTE'); END;
CREATE TRIGGER world_gold_admin_no_update BEFORE UPDATE ON world_gold_admin_actions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ADMIN_ACTION'); END;
CREATE TRIGGER world_gold_admin_no_delete BEFORE DELETE ON world_gold_admin_actions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_ADMIN_ACTION'); END;
CREATE TRIGGER world_gold_campaign_no_update BEFORE UPDATE ON world_gold_campaigns BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CAMPAIGN'); END;
CREATE TRIGGER world_gold_campaign_no_delete BEFORE DELETE ON world_gold_campaigns BEGIN SELECT RAISE(ABORT,'IMMUTABLE_CAMPAIGN'); END;
CREATE TRIGGER world_gold_entries_no_update BEFORE UPDATE ON world_gold_entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOURNAL'); END;
CREATE TRIGGER world_gold_entries_no_delete BEFORE DELETE ON world_gold_entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOURNAL'); END;
CREATE TRIGGER world_gold_hold_insert BEFORE INSERT ON world_gold_holds BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM world_gold_mints m WHERE m.id=NEW.id AND m.wallet=NEW.wallet AND m.amount=NEW.amount AND m.state='held')
 OR NEW.state<>'held' OR COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=NEW.wallet),0)-COALESCE((SELECT SUM(amount) FROM world_gold_holds WHERE wallet=NEW.wallet AND state='held'),0)<NEW.amount
 THEN RAISE(ABORT,'GOLD_INSUFFICIENT_OR_INVALID_HOLD') END;
END;
CREATE TRIGGER world_gold_hold_update BEFORE UPDATE ON world_gold_holds BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.wallet<>OLD.wallet OR NEW.amount<>OLD.amount OR OLD.state<>'held' OR NEW.state NOT IN ('consumed','released')
 OR NOT EXISTS(SELECT 1 FROM world_gold_mints m WHERE m.id=OLD.id AND m.state=NEW.state AND m.evidence_json IS NOT NULL)
 THEN RAISE(ABORT,'INVALID_HOLD_TRANSITION') END;
END;
CREATE TRIGGER world_gold_hold_no_delete BEFORE DELETE ON world_gold_holds BEGIN SELECT RAISE(ABORT,'IMMUTABLE_HOLD'); END;
CREATE TRIGGER world_gold_mint_update BEFORE UPDATE ON world_gold_mints BEGIN
 SELECT CASE WHEN NEW.id<>OLD.id OR NEW.wallet<>OLD.wallet OR NEW.auth_json<>OLD.auth_json OR NEW.amount<>OLD.amount OR NEW.chain_id<>OLD.chain_id OR NEW.contract<>OLD.contract OR NEW.chain_instance<>OLD.chain_instance OR NEW.deadline<>OLD.deadline OR NEW.created_ms<>OLD.created_ms OR OLD.state<>'held' OR NEW.state NOT IN ('consumed','released') OR NEW.evidence_json IS NULL
 THEN RAISE(ABORT,'INVALID_MINT_TRANSITION') END;
END;
CREATE TRIGGER world_gold_mint_no_delete BEFORE DELETE ON world_gold_mints BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MINT'); END;
-- This guard also covers OLD service debits and settlement/recovery writers.
CREATE TRIGGER world_gold_available_guard BEFORE UPDATE OF balance ON economy_gold_accounts
WHEN NEW.balance<COALESCE((SELECT SUM(amount) FROM world_gold_holds WHERE wallet=NEW.wallet AND state='held'),0)
BEGIN SELECT RAISE(ABORT,'GOLD_RESERVED'); END;
CREATE TRIGGER world_gold_entry_authority BEFORE INSERT ON world_gold_entries BEGIN
 SELECT CASE WHEN NEW.reference<>NEW.kind||':'||NEW.order_id||CASE WHEN NEW.kind='mint-payment' THEN '' ELSE ':'||CAST(NEW.delta+COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=NEW.order_id AND kind=NEW.kind),0) AS TEXT) END THEN RAISE(ABORT,'INVALID_REFERENCE') END;
 SELECT CASE WHEN NEW.kind='topup' AND NOT EXISTS(
 SELECT 1 FROM world_gold_links l JOIN economy_orders o ON o.id=l.order_id
 WHERE o.id=NEW.order_id AND l.kind='topup' AND o.status='paid' AND o.currency='EMBEO' AND o.wallet=NEW.wallet AND NEW.delta>0 AND l.gold>=NEW.delta+COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=NEW.order_id AND kind='topup'),0))
 THEN RAISE(ABORT,'TOPUP_NOT_PAID') END;
 SELECT CASE WHEN NEW.kind='service-refund' AND NOT EXISTS(
 SELECT 1 FROM world_gold_links l JOIN economy_orders o ON o.id=l.order_id JOIN world_gold_jobs j ON j.order_id=o.id
 WHERE o.id=NEW.order_id AND l.kind='service' AND o.status='paid' AND o.currency='GOLD' AND o.wallet=NEW.wallet AND j.state='failed' AND NEW.delta>0 AND l.gold>=NEW.delta+COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=NEW.order_id AND kind='service-refund'),0) AND CAST(o.amount AS INTEGER)=l.gold)
 THEN RAISE(ABORT,'REFUND_NOT_ENTITLED') END;
 SELECT CASE WHEN NEW.kind='mint-payment' AND NOT EXISTS(
 SELECT 1 FROM world_gold_mints m JOIN world_gold_holds h ON h.id=m.id
 WHERE m.id=NEW.order_id AND m.wallet=NEW.wallet AND m.state='consumed' AND h.state='consumed' AND m.amount=-NEW.delta)
 THEN RAISE(ABORT,'MINT_NOT_CONSUMED') END;
END;
CREATE TRIGGER world_gold_entry_apply AFTER INSERT ON world_gold_entries BEGIN
 INSERT INTO economy_gold_accounts(wallet,balance) VALUES(NEW.wallet,0) ON CONFLICT(wallet) DO NOTHING;
 UPDATE economy_gold_accounts SET balance=balance+NEW.delta WHERE wallet=NEW.wallet;
END;
CREATE VIEW world_gold_history AS
 SELECT id,wallet,CAST(delta AS TEXT) delta,kind,reference,created_ms FROM economy_gold_journal
 UNION ALL SELECT id,wallet,CAST(delta AS TEXT),kind,reference,created_ms FROM world_gold_entries;
