-- Forward-only remediation of Audit job 188a3018. Historical migrations and
-- immutable journals/quotes remain unchanged. No production migration is run.
CREATE TRIGGER economy_gold_credit_capacity BEFORE INSERT ON economy_gold_journal
WHEN NEW.delta>0 AND COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=NEW.wallet),0)>9223372036854775807-NEW.delta
BEGIN SELECT RAISE(ABORT,'GOLD_BALANCE_CAPACITY'); END;

-- A processed UTC day can have outstanding wallet entitlements. They are not
-- spendable/book GOLD until the exact original journal is committed. One row
-- per original config/day/wallet; no caller can alter its economic identity.
CREATE TABLE economy_gold_reward_entitlements(
 id TEXT PRIMARY KEY, config_id TEXT NOT NULL, day_start_ms INTEGER NOT NULL,
 wallet TEXT NOT NULL, delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND delta>0),
 reference TEXT NOT NULL UNIQUE, created_ms INTEGER NOT NULL,
 settled_ms INTEGER, retry_ms INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempts)='integer' AND attempts>=0),
 CHECK(typeof(day_start_ms)='integer' AND day_start_ms>=0 AND day_start_ms%86400000=0),
 CHECK(reference=config_id||':'||CAST(day_start_ms AS TEXT)||':'||wallet),
 CHECK(id='reward:'||reference), UNIQUE(config_id,day_start_ms,wallet)
);
CREATE INDEX economy_gold_reward_pending ON economy_gold_reward_entitlements(settled_ms,retry_ms,id);
CREATE INDEX economy_gold_reward_wallet ON economy_gold_reward_entitlements(wallet,settled_ms,day_start_ms);
CREATE TRIGGER economy_gold_reward_no_delete BEFORE DELETE ON economy_gold_reward_entitlements
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REWARD_ENTITLEMENT'); END;
CREATE TRIGGER economy_gold_reward_update BEFORE UPDATE ON economy_gold_reward_entitlements
WHEN NEW.id<>OLD.id OR NEW.config_id<>OLD.config_id OR NEW.day_start_ms<>OLD.day_start_ms
 OR NEW.wallet<>OLD.wallet OR NEW.delta<>OLD.delta OR NEW.reference<>OLD.reference OR NEW.created_ms<>OLD.created_ms
 OR (OLD.settled_ms IS NOT NULL AND NEW.settled_ms IS NOT OLD.settled_ms)
 OR (NEW.settled_ms IS NOT NULL AND NOT EXISTS(SELECT 1 FROM economy_gold_journal j
      WHERE j.id=OLD.id AND j.reference=OLD.reference AND j.wallet=OLD.wallet AND j.delta=OLD.delta AND j.kind='utc-reward'))
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REWARD_ENTITLEMENT'); END;
CREATE TRIGGER economy_gold_reward_insert BEFORE INSERT ON economy_gold_reward_entitlements
WHEN NEW.settled_ms IS NOT NULL OR NEW.retry_ms<>0 OR NEW.attempts<>0
BEGIN SELECT RAISE(ABORT,'INVALID_REWARD_ENTITLEMENT'); END;
CREATE TRIGGER economy_gold_reward_apply AFTER INSERT ON economy_gold_reward_entitlements
BEGIN
 INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms)
 SELECT NEW.id,NEW.wallet,NEW.delta,'utc-reward',NEW.reference,NEW.created_ms
 WHERE COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=NEW.wallet),0)<=9223372036854775807-NEW.delta;
 UPDATE economy_gold_reward_entitlements SET settled_ms=NEW.created_ms
 WHERE id=NEW.id AND EXISTS(SELECT 1 FROM economy_gold_journal WHERE id=NEW.id AND reference=NEW.reference AND wallet=NEW.wallet AND delta=NEW.delta AND kind='utc-reward');
END;

-- An old recovery binary does not snapshot or subtract pending entitlements.
-- Refuse its unversioned new plans while owed rows exist, rather than let a
-- rollback tool compensate a share-day which the current queue will also pay.
CREATE TRIGGER economy_gold_reward_recovery_version BEFORE INSERT ON economy_recoveries
WHEN EXISTS(SELECT 1 FROM economy_gold_reward_entitlements WHERE settled_ms IS NULL)
 AND NOT COALESCE(json_valid(NEW.report_json) AND json_extract(NEW.report_json,'$.pendingRewardsAccounted')=1,0)
BEGIN SELECT RAISE(ABORT,'RECOVERY_REWARD_SCHEMA_REQUIRED'); END;

-- The original complete proof predicate remains. Add its missing reverse
-- namespace/mode restriction without rewriting immutable historical evidence.
CREATE TRIGGER world_gold_mint_proof_mode BEFORE UPDATE ON world_gold_mints
WHEN NOT COALESCE((OLD.chain_id=31337 AND json_extract(NEW.evidence_json,'$.mode')='private-chain-fixture')
 OR (OLD.chain_id<>31337 AND json_extract(NEW.evidence_json,'$.mode')='finalized-chain'),0)
BEGIN SELECT RAISE(ABORT,'MINT_EVIDENCE_REQUIRED'); END;
