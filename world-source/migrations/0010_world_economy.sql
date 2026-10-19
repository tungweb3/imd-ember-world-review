-- Independent, server-authoritative GOLD. No prototype balances are imported.
-- INTEGER values are bound/read as decimal strings; CHECKs reject SQLite REAL
-- promotion at signed-64-bit overflow. D1 batch() provides atomic transactions.
CREATE TABLE economy_chain_state (
  config_id TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL CHECK(typeof(last_block)='integer' AND last_block>=0),
  last_hash TEXT NOT NULL,
  through_ms INTEGER NOT NULL CHECK(typeof(through_ms)='integer' AND through_ms>=0),
  halted_reason TEXT
);
CREATE TABLE economy_ingestions (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  accepted INTEGER NOT NULL CHECK(accepted=1),
  FOREIGN KEY(config_id) REFERENCES economy_chain_state(config_id)
);
CREATE TABLE economy_positions (
  config_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  position_key TEXT NOT NULL,
  wallet TEXT NOT NULL,
  deposited_ms INTEGER NOT NULL CHECK(typeof(deposited_ms)='integer' AND deposited_ms>=0),
  initial_shares INTEGER NOT NULL CHECK(typeof(initial_shares)='integer' AND initial_shares>0),
  remaining_shares INTEGER NOT NULL CHECK(typeof(remaining_shares)='integer' AND remaining_shares>=0),
  closed_ms INTEGER,
  PRIMARY KEY(config_id,position_id)
);
CREATE INDEX economy_positions_wallet ON economy_positions(wallet,config_id);
CREATE INDEX economy_positions_page ON economy_positions(config_id,wallet,position_id);
CREATE INDEX economy_positions_first ON economy_positions(config_id,deposited_ms);
CREATE INDEX economy_positions_ceiling ON economy_positions(config_id,position_key);
CREATE INDEX economy_positions_visible ON economy_positions(config_id,wallet,(remaining_shares>0) DESC,deposited_ms,position_id);
CREATE INDEX economy_positions_open_page ON economy_positions(config_id,wallet,position_id,position_key,deposited_ms) WHERE closed_ms IS NULL;
CREATE INDEX economy_positions_closed_end ON economy_positions(config_id,closed_ms,wallet,position_id,position_key,deposited_ms) WHERE closed_ms IS NOT NULL;
CREATE TABLE economy_position_balances (
  config_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  remaining_shares INTEGER NOT NULL CHECK(typeof(remaining_shares)='integer' AND remaining_shares>=0),
  PRIMARY KEY(config_id,position_id,at_ms,block_number,log_index)
);
CREATE TABLE economy_chain_events (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('stake','withdraw','payment')),
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL CHECK(typeof(log_index)='integer' AND log_index>=0),
  block_number INTEGER NOT NULL CHECK(typeof(block_number)='integer' AND block_number>=0),
  block_hash TEXT NOT NULL,
  at_ms INTEGER NOT NULL CHECK(typeof(at_ms)='integer' AND at_ms>=0),
  wallet TEXT NOT NULL,
  position_id TEXT,
  shares INTEGER CHECK(shares IS NULL OR (typeof(shares)='integer' AND shares>0)),
  amount TEXT NOT NULL,
  order_id TEXT,
  token TEXT,
  receiver TEXT,
  payload TEXT NOT NULL,
  UNIQUE(config_id,tx_hash,log_index),
  FOREIGN KEY(config_id) REFERENCES economy_chain_state(config_id)
);
CREATE INDEX economy_events_position_day ON economy_chain_events(config_id,position_id,at_ms,kind);
CREATE TRIGGER economy_event_no_update BEFORE UPDATE ON economy_chain_events
BEGIN SELECT RAISE(ABORT,'ECONOMY_EVENT_IMMUTABLE'); END;
CREATE TRIGGER economy_event_no_delete BEFORE DELETE ON economy_chain_events
BEGIN SELECT RAISE(ABORT,'ECONOMY_EVENT_IMMUTABLE'); END;
CREATE TRIGGER economy_event_immutable BEFORE INSERT ON economy_chain_events
WHEN EXISTS(SELECT 1 FROM economy_chain_events WHERE id=NEW.id AND payload<>NEW.payload)
BEGIN SELECT RAISE(ABORT,'ECONOMY_EVENT_CONFLICT'); END;
CREATE TRIGGER economy_event_stake AFTER INSERT ON economy_chain_events WHEN NEW.kind='stake'
BEGIN
  INSERT INTO economy_positions(config_id,position_id,position_key,wallet,deposited_ms,initial_shares,remaining_shares)
    VALUES(NEW.config_id,NEW.position_id,substr('000000000000000000000000000000000000000000000000000000000000000000000000000000'||NEW.position_id,-78),NEW.wallet,NEW.at_ms,NEW.shares,NEW.shares);
  INSERT INTO economy_position_balances(config_id,position_id,at_ms,block_number,log_index,remaining_shares)
    VALUES(NEW.config_id,NEW.position_id,NEW.at_ms,NEW.block_number,NEW.log_index,NEW.shares);
END;
CREATE TRIGGER economy_event_withdraw BEFORE INSERT ON economy_chain_events WHEN NEW.kind='withdraw'
AND NOT EXISTS(SELECT 1 FROM economy_chain_events WHERE id=NEW.id)
BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM economy_positions WHERE config_id=NEW.config_id AND position_id=NEW.position_id AND wallet=NEW.wallet AND remaining_shares>=NEW.shares AND deposited_ms<=NEW.at_ms)
    THEN RAISE(ABORT,'ECONOMY_INVALID_WITHDRAWAL') END;
END;
CREATE TRIGGER economy_event_withdraw_apply AFTER INSERT ON economy_chain_events WHEN NEW.kind='withdraw'
BEGIN
  UPDATE economy_positions SET remaining_shares=remaining_shares-NEW.shares,
    closed_ms=CASE WHEN remaining_shares=NEW.shares THEN NEW.at_ms ELSE closed_ms END WHERE config_id=NEW.config_id AND position_id=NEW.position_id;
  INSERT INTO economy_position_balances(config_id,position_id,at_ms,block_number,log_index,remaining_shares)
    SELECT NEW.config_id,NEW.position_id,NEW.at_ms,NEW.block_number,NEW.log_index,remaining_shares FROM economy_positions WHERE config_id=NEW.config_id AND position_id=NEW.position_id;
END;
CREATE TABLE economy_gold_accounts (
  wallet TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(typeof(balance)='integer' AND balance>=0)
);
CREATE TABLE economy_gold_journal (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),
  kind TEXT NOT NULL CHECK(kind IN ('utc-reward','service-payment')),
  reference TEXT NOT NULL UNIQUE,
  created_ms INTEGER NOT NULL CHECK(typeof(created_ms)='integer' AND created_ms>=0)
);
CREATE INDEX economy_gold_journal_wallet ON economy_gold_journal(wallet,created_ms DESC,id DESC);
CREATE TRIGGER economy_gold_no_update BEFORE UPDATE ON economy_gold_journal
BEGIN SELECT RAISE(ABORT,'ECONOMY_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER economy_gold_no_delete BEFORE DELETE ON economy_gold_journal
BEGIN SELECT RAISE(ABORT,'ECONOMY_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER economy_gold_apply AFTER INSERT ON economy_gold_journal
BEGIN
  INSERT INTO economy_gold_accounts(wallet,balance) VALUES(NEW.wallet,0) ON CONFLICT(wallet) DO NOTHING;
  UPDATE economy_gold_accounts SET balance=balance+NEW.delta WHERE wallet=NEW.wallet;
END;
CREATE TABLE economy_gold_days (
  config_id TEXT NOT NULL,
  day_start_ms INTEGER NOT NULL,
  completed_ms INTEGER NOT NULL,
  accepted INTEGER NOT NULL CHECK(accepted=1),
  PRIMARY KEY(config_id,day_start_ms)
);
CREATE TABLE economy_day_progress (
  config_id TEXT NOT NULL,
  day_start_ms INTEGER NOT NULL,
  position_ceiling TEXT NOT NULL,
  last_wallet TEXT NOT NULL DEFAULT '',
  last_position TEXT NOT NULL DEFAULT '',
  carry_reward TEXT NOT NULL DEFAULT '0',
  version INTEGER NOT NULL DEFAULT 0 CHECK(typeof(version)='integer' AND version>=0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  PRIMARY KEY(config_id,day_start_ms)
);
CREATE TABLE economy_settlement_pages (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  day_start_ms INTEGER NOT NULL,
  accepted INTEGER NOT NULL CHECK(accepted=1)
);
CREATE TABLE economy_orders (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  request_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('GOLD','EMBEO')),
  amount TEXT NOT NULL,
  request_payload TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid')),
  paid_ms INTEGER,
  paid_event_id TEXT UNIQUE,
  gold_request_id TEXT,
  UNIQUE(wallet,request_id)
);
CREATE INDEX economy_orders_wallet ON economy_orders(wallet,created_ms DESC,id DESC);
CREATE TRIGGER economy_order_quote_immutable BEFORE UPDATE ON economy_orders
WHEN NEW.id<>OLD.id OR NEW.config_id<>OLD.config_id OR NEW.wallet<>OLD.wallet OR NEW.request_id<>OLD.request_id OR NEW.service_id<>OLD.service_id OR NEW.currency<>OLD.currency OR NEW.amount<>OLD.amount OR NEW.request_payload<>OLD.request_payload OR NEW.created_ms<>OLD.created_ms OR NEW.expires_ms<>OLD.expires_ms OR (OLD.status='paid' AND NEW.status<>'paid')
BEGIN SELECT RAISE(ABORT,'ECONOMY_ORDER_IMMUTABLE'); END;
CREATE TABLE economy_gold_challenges (
  order_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  wallet TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  message TEXT NOT NULL,
  issued_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  consumed_ms INTEGER,
  PRIMARY KEY(order_id,request_id),
  FOREIGN KEY(order_id) REFERENCES economy_orders(id)
);
CREATE TABLE economy_fulfillments (
  order_id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  service_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  paid_ms INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES economy_orders(id)
);
-- Entitlement and debit commit with the order. This is an outbox/receipt; only
-- explicitly integrated services may consume it, and no funds admin is added.
CREATE TRIGGER economy_order_paid AFTER UPDATE OF status ON economy_orders
WHEN OLD.status='pending' AND NEW.status='paid'
BEGIN
  INSERT INTO economy_fulfillments(order_id,wallet,service_id,currency,paid_ms)
    VALUES(NEW.id,NEW.wallet,NEW.service_id,NEW.currency,NEW.paid_ms);
END;
