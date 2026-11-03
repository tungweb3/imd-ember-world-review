-- Link one consented, validated Celestao run to one World-owned quote.
-- This migration does not enable any GOLD product or payment control.
CREATE TABLE celestao_checkouts (
 id TEXT PRIMARY KEY CHECK(length(id)=43),
 wallet TEXT NOT NULL CHECK(length(wallet)=42 AND wallet=lower(wallet)),
 product TEXT NOT NULL CHECK(product IN ('fortune-bazi','fortune-ziwei','fortune-western','fortune-human','fortune-profile')),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
 created_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL CHECK(expires_ms>created_ms),
 order_id TEXT UNIQUE REFERENCES economy_orders(id)
);
CREATE INDEX celestao_checkouts_expiry ON celestao_checkouts(expires_ms);

-- A separately invoked deployment action enables only the approved five
-- products. It is not a wallet-admin signature or a ledger entry. A single
-- INSERT and its trigger commit atomically, or change nothing on a mismatch.
CREATE TABLE celestao_release_actions (
 id TEXT PRIMARY KEY,
 actor TEXT NOT NULL CHECK(actor='authorized-deployment'),
 catalogue TEXT NOT NULL CHECK(catalogue='celestao-gold-v1-20261025'),
 created_ms INTEGER NOT NULL CHECK(created_ms>0),
 before_json TEXT NOT NULL CHECK(json_valid(before_json))
);
CREATE TRIGGER celestao_release_enable BEFORE INSERT ON celestao_release_actions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM celestao_release_actions)
 OR NEW.before_json<>(SELECT json_group_array(json_object('feature',feature,'enabled',enabled,'version',version)) FROM (SELECT feature,enabled,version FROM world_gold_controls ORDER BY feature))
 OR (SELECT COUNT(*) FROM world_gold_controls)<>3
 OR COALESCE((SELECT enabled FROM world_gold_controls WHERE feature='service'),-1)<>0
 OR COALESCE((SELECT enabled FROM world_gold_controls WHERE feature='mint'),-1)<>0
 OR COALESCE((SELECT enabled FROM world_gold_controls WHERE feature='topup'),-1)<>1
 OR EXISTS(SELECT 1 FROM world_gold_products WHERE kind='service' AND enabled=1)
 OR EXISTS(SELECT 1 FROM world_gold_products WHERE product IN ('fortune-bazi','fortune-ziwei','fortune-western','fortune-human','fortune-profile'))
 THEN RAISE(ABORT,'CELESTAO_RELEASE_BASELINE_CHANGED') END;
 INSERT INTO world_gold_products(id,product,version,kind,title,gold,embeo,enabled,created_ms) VALUES
 ('fortune-bazi-v1','fortune-bazi',1,'service','四柱八字',1000,NULL,1,NEW.created_ms),
 ('fortune-ziwei-v1','fortune-ziwei',1,'service','紫微斗數',1000,NULL,1,NEW.created_ms),
 ('fortune-western-v1','fortune-western',1,'service','西洋星盤',800,NULL,1,NEW.created_ms),
 ('fortune-human-v1','fortune-human',1,'service','人類圖',600,NULL,1,NEW.created_ms),
 ('fortune-profile-v1','fortune-profile',1,'service','完整解讀（特價）',3000,NULL,1,NEW.created_ms);
 UPDATE world_gold_controls SET enabled=1,version=version+1 WHERE feature='service';
END;
CREATE TRIGGER celestao_release_no_update BEFORE UPDATE ON celestao_release_actions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RELEASE_ACTION'); END;
CREATE TRIGGER celestao_release_no_delete BEFORE DELETE ON celestao_release_actions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RELEASE_ACTION'); END;
