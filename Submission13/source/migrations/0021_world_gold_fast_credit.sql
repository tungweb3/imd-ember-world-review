-- GOLD fast credit (owner decision 2026-10-26): an EMBEO top-up is credited once its Paid event is in a block on
-- the canonical chain (about 12 s), instead of after finality (about 15 min). The finalized indexer stays the only
-- authority for economy_orders.status and for every existing journal: nothing here changes them. A fast credit is
-- its own journal. When the finalized indexer marks the order paid, the ordinary top-up entry is written and the fast
-- credit is settled with an equal negative entry in the same batch (net zero). If the finalized cursor passes the
-- credit's block and the order is still unpaid, the credit is reverted; GOLD already spent becomes a debt that blocks
-- GOLD spending until later credits repay it. Invariant: balance = journal + world entries + fast entries.
CREATE TABLE world_gold_fast_credits (
 order_id TEXT PRIMARY KEY REFERENCES economy_orders(id), wallet TEXT NOT NULL,
 gold INTEGER NOT NULL CHECK(typeof(gold)='integer' AND gold>0),
 tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL CHECK(typeof(log_index)='integer' AND log_index>=0),
 block_number INTEGER NOT NULL CHECK(typeof(block_number)='integer' AND block_number>=0), block_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('credited','settled','reverted')),
 created_ms INTEGER NOT NULL, updated_ms INTEGER NOT NULL,
 UNIQUE(tx_hash,log_index)
);
CREATE INDEX world_gold_fast_credits_state ON world_gold_fast_credits(state,block_number);
CREATE TABLE world_gold_fast_entries (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta<>0),
 kind TEXT NOT NULL CHECK(kind IN ('fast-topup','fast-settle','fast-revert','fast-debt-collect')),
 reference TEXT NOT NULL UNIQUE, order_id TEXT NOT NULL, created_ms INTEGER NOT NULL
);
CREATE INDEX world_gold_fast_entries_wallet ON world_gold_fast_entries(wallet,created_ms DESC,id DESC);
CREATE TABLE world_gold_fast_debts (
 order_id TEXT PRIMARY KEY REFERENCES world_gold_fast_credits(order_id), wallet TEXT NOT NULL,
 amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>=0), created_ms INTEGER NOT NULL
);
CREATE INDEX world_gold_fast_debts_wallet ON world_gold_fast_debts(wallet,amount);

CREATE TRIGGER world_gold_fast_entries_no_update BEFORE UPDATE ON world_gold_fast_entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOURNAL'); END;
CREATE TRIGGER world_gold_fast_entries_no_delete BEFORE DELETE ON world_gold_fast_entries BEGIN SELECT RAISE(ABORT,'IMMUTABLE_JOURNAL'); END;
CREATE TRIGGER world_gold_fast_credits_no_delete BEFORE DELETE ON world_gold_fast_credits BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FAST_CREDIT'); END;
CREATE TRIGGER world_gold_fast_debts_no_delete BEFORE DELETE ON world_gold_fast_debts BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FAST_DEBT'); END;

-- A fast credit is created only for a pending EMBEO top-up of the same wallet and exact quoted GOLD.
CREATE TRIGGER world_gold_fast_credit_insert BEFORE INSERT ON world_gold_fast_credits BEGIN
 SELECT CASE WHEN NEW.state<>'credited' OR NEW.updated_ms<>NEW.created_ms OR NOT EXISTS(
  SELECT 1 FROM economy_orders o JOIN world_gold_links l ON l.order_id=o.id
  WHERE o.id=NEW.order_id AND o.wallet=NEW.wallet AND o.status='pending' AND o.currency='EMBEO' AND l.kind='topup' AND l.gold=NEW.gold)
 THEN RAISE(ABORT,'FAST_CREDIT_NOT_ELIGIBLE') END;
END;
-- While credited, only the observed inclusion may move (a reorg re-included the same transaction). Settling needs the
-- order paid by the finalized indexer; reverting needs it still unpaid. Settled and reverted are terminal.
CREATE TRIGGER world_gold_fast_credit_update BEFORE UPDATE ON world_gold_fast_credits BEGIN
 SELECT CASE WHEN NEW.order_id<>OLD.order_id OR NEW.wallet<>OLD.wallet OR NEW.gold<>OLD.gold OR NEW.tx_hash<>OLD.tx_hash OR NEW.created_ms<>OLD.created_ms
  OR OLD.state<>'credited' OR NEW.updated_ms<OLD.updated_ms
  OR (NEW.state='credited' AND NEW.log_index=OLD.log_index AND NEW.block_number=OLD.block_number AND NEW.block_hash=OLD.block_hash)
  OR (NEW.state<>'credited' AND (NEW.log_index<>OLD.log_index OR NEW.block_number<>OLD.block_number OR NEW.block_hash<>OLD.block_hash))
  OR (NEW.state='settled' AND NOT EXISTS(SELECT 1 FROM economy_orders WHERE id=NEW.order_id AND status='paid'))
  OR (NEW.state='reverted' AND NOT EXISTS(SELECT 1 FROM economy_orders WHERE id=NEW.order_id AND status='pending'))
 THEN RAISE(ABORT,'INVALID_FAST_CREDIT_TRANSITION') END;
END;
CREATE TRIGGER world_gold_fast_debt_insert BEFORE INSERT ON world_gold_fast_debts BEGIN
 SELECT CASE WHEN NEW.amount<=0 OR NOT EXISTS(SELECT 1 FROM world_gold_fast_credits WHERE order_id=NEW.order_id AND wallet=NEW.wallet AND state='reverted' AND gold>=NEW.amount)
 THEN RAISE(ABORT,'INVALID_FAST_DEBT') END;
END;
-- A debt only shrinks, and only through its own collect entry (below).
CREATE TRIGGER world_gold_fast_debt_update BEFORE UPDATE ON world_gold_fast_debts BEGIN
 SELECT CASE WHEN NEW.order_id<>OLD.order_id OR NEW.wallet<>OLD.wallet OR NEW.created_ms<>OLD.created_ms OR NEW.amount>=OLD.amount
  OR NOT EXISTS(SELECT 1 FROM world_gold_fast_entries WHERE order_id=NEW.order_id AND kind='fast-debt-collect' AND reference='fast-debt-collect:'||NEW.order_id||':'||CAST(NEW.amount AS TEXT) AND delta=NEW.amount-OLD.amount)
 THEN RAISE(ABORT,'INVALID_FAST_DEBT_TRANSITION') END;
END;

CREATE TRIGGER world_gold_fast_entry_capacity BEFORE INSERT ON world_gold_fast_entries
WHEN NEW.delta>0 AND COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=NEW.wallet),0)>9223372036854775807-NEW.delta
BEGIN SELECT RAISE(ABORT,'GOLD_BALANCE_CAPACITY'); END;
CREATE TRIGGER world_gold_fast_entry_authority BEFORE INSERT ON world_gold_fast_entries BEGIN
 SELECT CASE WHEN NEW.kind='fast-topup' AND (NEW.reference<>'fast-topup:'||NEW.order_id OR NOT EXISTS(
  SELECT 1 FROM world_gold_fast_credits f JOIN economy_orders o ON o.id=f.order_id
  WHERE f.order_id=NEW.order_id AND f.wallet=NEW.wallet AND f.state='credited' AND f.gold=NEW.delta AND o.status='pending'))
 THEN RAISE(ABORT,'FAST_TOPUP_NOT_CREDITED') END;
 -- Settling requires the ordinary top-up entry for the full quote already written in this batch.
 SELECT CASE WHEN NEW.kind='fast-settle' AND (NEW.reference<>'fast-settle:'||NEW.order_id OR NOT EXISTS(
  SELECT 1 FROM world_gold_fast_credits f WHERE f.order_id=NEW.order_id AND f.wallet=NEW.wallet AND f.state='settled' AND -f.gold=NEW.delta
   AND EXISTS(SELECT 1 FROM world_gold_fast_entries WHERE reference='fast-topup:'||f.order_id)
   AND COALESCE((SELECT SUM(delta) FROM world_gold_entries WHERE order_id=f.order_id AND kind='topup'),0)=f.gold))
 THEN RAISE(ABORT,'FAST_SETTLE_NOT_ENTITLED') END;
 SELECT CASE WHEN NEW.kind='fast-revert' AND (NEW.reference<>'fast-revert:'||NEW.order_id OR NEW.delta>=0 OR NOT EXISTS(
  SELECT 1 FROM world_gold_fast_credits f WHERE f.order_id=NEW.order_id AND f.wallet=NEW.wallet AND f.state='reverted' AND f.gold>=-NEW.delta
   AND EXISTS(SELECT 1 FROM world_gold_fast_entries WHERE reference='fast-topup:'||f.order_id)))
 THEN RAISE(ABORT,'FAST_REVERT_NOT_ENTITLED') END;
 SELECT CASE WHEN NEW.kind='fast-debt-collect' AND (NEW.delta>=0 OR NOT EXISTS(
  SELECT 1 FROM world_gold_fast_debts d WHERE d.order_id=NEW.order_id AND d.wallet=NEW.wallet AND d.amount>=-NEW.delta
   AND NEW.reference='fast-debt-collect:'||d.order_id||':'||CAST(d.amount+NEW.delta AS TEXT)))
 THEN RAISE(ABORT,'FAST_DEBT_NOT_OWED') END;
END;
CREATE TRIGGER world_gold_fast_entry_apply AFTER INSERT ON world_gold_fast_entries BEGIN
 INSERT INTO economy_gold_accounts(wallet,balance) VALUES(NEW.wallet,0) ON CONFLICT(wallet) DO NOTHING;
 UPDATE economy_gold_accounts SET balance=balance+NEW.delta WHERE wallet=NEW.wallet;
 UPDATE world_gold_fast_debts SET amount=amount+NEW.delta WHERE NEW.kind='fast-debt-collect' AND order_id=NEW.order_id;
END;

-- An outstanding debt blocks new GOLD spending (service payments and mint holds); credits still repay it.
CREATE TRIGGER world_gold_fast_debt_blocks_payment BEFORE INSERT ON economy_gold_journal
WHEN NEW.kind='service-payment' AND EXISTS(SELECT 1 FROM world_gold_fast_debts WHERE wallet=NEW.wallet AND amount>0)
BEGIN SELECT RAISE(ABORT,'GOLD_DEBT_OUTSTANDING'); END;
CREATE TRIGGER world_gold_fast_debt_blocks_hold BEFORE INSERT ON world_gold_holds
WHEN EXISTS(SELECT 1 FROM world_gold_fast_debts WHERE wallet=NEW.wallet AND amount>0)
BEGIN SELECT RAISE(ABORT,'GOLD_DEBT_OUTSTANDING'); END;

-- History shows a fast credit when it happens; the later settle pair (top-up entry + fast-settle) is bookkeeping only.
DROP VIEW world_gold_history;
CREATE VIEW world_gold_history AS
 SELECT id,wallet,CAST(delta AS TEXT) delta,kind,reference,created_ms FROM economy_gold_journal
 UNION ALL SELECT e.id,e.wallet,CAST(e.delta AS TEXT),e.kind,e.reference,e.created_ms FROM world_gold_entries e
  WHERE NOT (e.kind='topup' AND EXISTS(SELECT 1 FROM world_gold_fast_credits f WHERE f.order_id=e.order_id AND f.state='settled'))
 UNION ALL SELECT id,wallet,CAST(delta AS TEXT),CASE kind WHEN 'fast-topup' THEN 'topup' ELSE kind END,reference,created_ms FROM world_gold_fast_entries
  WHERE kind<>'fast-settle';
