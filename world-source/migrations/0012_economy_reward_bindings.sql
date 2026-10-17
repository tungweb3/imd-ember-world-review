-- A staking contract's reward stream cannot silently acquire a new config id.
-- No balance, journal, event, order or legacy cursor is rewritten here.
CREATE TABLE economy_reward_bindings (
  staking_key TEXT NOT NULL PRIMARY KEY CHECK(length(staking_key)>0),
  config_id TEXT NOT NULL UNIQUE CHECK(length(config_id)=64 AND config_id NOT GLOB '*[^0-9a-f]*')
);
CREATE TRIGGER economy_reward_binding_no_change BEFORE UPDATE ON economy_reward_bindings
WHEN NEW.staking_key<>OLD.staking_key OR NEW.config_id<>OLD.config_id
BEGIN SELECT RAISE(ABORT,'ECONOMY_CONFIG_CONFLICT'); END;
CREATE TRIGGER economy_reward_binding_no_delete BEFORE DELETE ON economy_reward_bindings
BEGIN SELECT RAISE(ABORT,'ECONOMY_CONFIG_CONFLICT'); END;
-- This also runs for INSERT .. ON CONFLICT DO NOTHING against legacy progress.
-- It stops an unbound legacy/competing config before any new reward is issued.
CREATE TRIGGER economy_reward_progress_binding BEFORE INSERT ON economy_day_progress
WHEN NOT EXISTS(SELECT 1 FROM economy_reward_bindings WHERE config_id=NEW.config_id)
BEGIN SELECT RAISE(ABORT,'ECONOMY_CONFIG_CONFLICT'); END;
