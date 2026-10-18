-- Additive recovery evidence. Historical economic rows are never rewritten.
CREATE TABLE economy_config_registry (
 config_id TEXT PRIMARY KEY, config_json TEXT NOT NULL,
 chain_id INTEGER NOT NULL CHECK(chain_id=1), token TEXT NOT NULL,
 staking_contract TEXT NOT NULL, payment_contract TEXT NOT NULL, treasury TEXT NOT NULL
);
CREATE TRIGGER economy_registry_no_change BEFORE UPDATE ON economy_config_registry
WHEN NEW.config_id<>OLD.config_id OR NEW.config_json<>OLD.config_json
BEGIN SELECT RAISE(ABORT,'ECONOMY_CONFIG_CONFLICT'); END;
CREATE TRIGGER economy_registry_no_delete BEFORE DELETE ON economy_config_registry
BEGIN SELECT RAISE(ABORT,'ECONOMY_CONFIG_CONFLICT'); END;
CREATE TABLE economy_recoveries (
 id TEXT PRIMARY KEY CHECK(length(id)=64), staking_key TEXT NOT NULL,
 from_config TEXT NOT NULL, to_config TEXT NOT NULL UNIQUE,
 horizon_ms INTEGER NOT NULL, applied_ms INTEGER NOT NULL, report_json TEXT NOT NULL,
 accepted INTEGER NOT NULL CHECK(accepted=1)
);
CREATE TRIGGER economy_recovery_no_change BEFORE UPDATE ON economy_recoveries
BEGIN SELECT RAISE(ABORT,'ECONOMY_RECOVERY_IMMUTABLE'); END;
CREATE TRIGGER economy_recovery_no_delete BEFORE DELETE ON economy_recoveries
BEGIN SELECT RAISE(ABORT,'ECONOMY_RECOVERY_IMMUTABLE'); END;
CREATE TABLE economy_config_lineage (
 ancestor_id TEXT NOT NULL, config_id TEXT NOT NULL, recovery_id TEXT NOT NULL,
 PRIMARY KEY(ancestor_id,config_id),
 FOREIGN KEY(recovery_id) REFERENCES economy_recoveries(id)
);
CREATE TRIGGER economy_lineage_no_change BEFORE UPDATE ON economy_config_lineage
BEGIN SELECT RAISE(ABORT,'ECONOMY_RECOVERY_IMMUTABLE'); END;
CREATE TRIGGER economy_lineage_no_delete BEFORE DELETE ON economy_config_lineage
BEGIN SELECT RAISE(ABORT,'ECONOMY_RECOVERY_IMMUTABLE'); END;
CREATE TABLE economy_gold_adjustments (
 journal_id TEXT PRIMARY KEY, recovery_id TEXT NOT NULL, staking_key TEXT NOT NULL,
 day_start_ms INTEGER NOT NULL, wallet TEXT NOT NULL,
 credited_before TEXT NOT NULL, entitlement TEXT NOT NULL,
 delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta>0),
 UNIQUE(staking_key,day_start_ms,wallet,entitlement),
 FOREIGN KEY(recovery_id) REFERENCES economy_recoveries(id),
 FOREIGN KEY(journal_id) REFERENCES economy_gold_journal(id)
);
CREATE TRIGGER economy_adjustment_no_change BEFORE UPDATE ON economy_gold_adjustments
BEGIN SELECT RAISE(ABORT,'ECONOMY_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER economy_adjustment_no_delete BEFORE DELETE ON economy_gold_adjustments
BEGIN SELECT RAISE(ABORT,'ECONOMY_JOURNAL_IMMUTABLE'); END;
-- Only the explicit, atomic internal recovery batch may change a binding.
DROP TRIGGER economy_reward_binding_no_change;
CREATE TRIGGER economy_reward_binding_no_change BEFORE UPDATE ON economy_reward_bindings
WHEN NEW.staking_key<>OLD.staking_key OR (NEW.config_id<>OLD.config_id AND NOT EXISTS(
 SELECT 1 FROM economy_recoveries WHERE staking_key=OLD.staking_key
 AND from_config=OLD.config_id AND to_config=NEW.config_id))
BEGIN SELECT RAISE(ABORT,'ECONOMY_CONFIG_CONFLICT'); END;
CREATE TABLE economy_payment_cases (
 event_id TEXT PRIMARY KEY, config_id TEXT NOT NULL, chain_id INTEGER NOT NULL,
 payment_contract TEXT NOT NULL, tx_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
 block_hash TEXT NOT NULL, block_number INTEGER NOT NULL, payer TEXT NOT NULL,
 order_id TEXT NOT NULL, expected_wallet TEXT, expected_amount TEXT,
 actual_amount TEXT NOT NULL, receiver TEXT NOT NULL, token TEXT NOT NULL,
 classification TEXT NOT NULL CHECK(classification IN
 ('matched','unknown-order','wrong-payer','wrong-config','wrong-currency','wrong-amount','extra-payment')),
 at_ms INTEGER NOT NULL, UNIQUE(chain_id,payment_contract,tx_hash,log_index),
 FOREIGN KEY(event_id) REFERENCES economy_chain_events(id)
);
CREATE INDEX economy_payment_cases_payer ON economy_payment_cases(payer,at_ms DESC,event_id);
CREATE INDEX economy_events_payment_block ON economy_chain_events(config_id,block_number,log_index) WHERE kind='payment';
CREATE TRIGGER economy_payment_case_no_change BEFORE UPDATE ON economy_payment_cases
BEGIN SELECT RAISE(ABORT,'ECONOMY_PAYMENT_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER economy_payment_case_no_delete BEFORE DELETE ON economy_payment_cases
BEGIN SELECT RAISE(ABORT,'ECONOMY_PAYMENT_EVIDENCE_IMMUTABLE'); END;
CREATE TABLE economy_payment_case_actions (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL, request_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('note','acknowledged-no-entitlement')),
 note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 1000),
 created_ms INTEGER NOT NULL, UNIQUE(event_id,request_id),
 FOREIGN KEY(event_id) REFERENCES economy_payment_cases(event_id)
);
CREATE TRIGGER economy_case_action_no_change BEFORE UPDATE ON economy_payment_case_actions
BEGIN SELECT RAISE(ABORT,'ECONOMY_PAYMENT_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER economy_case_action_no_delete BEFORE DELETE ON economy_payment_case_actions
BEGIN SELECT RAISE(ABORT,'ECONOMY_PAYMENT_EVIDENCE_IMMUTABLE'); END;
