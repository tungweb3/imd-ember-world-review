-- 鼠道修仙 (Squeek Ascension) cosmetic store. Identity grants are read-only:
-- they can show the wallet's GOLD and cosmetics, never debit GOLD. Every
-- purchase is a World GOLD order the player signs on imdember.com.
-- This migration does not enable any product or payment control.
CREATE TABLE squeek_auth_codes (
 code_hash TEXT PRIMARY KEY NOT NULL,
 source_session_hash TEXT NOT NULL,
 address TEXT NOT NULL,
 code_challenge TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 token_hash TEXT,
 CHECK(expires_at>issued_at),
 CHECK((consumed_at IS NULL)=(token_hash IS NULL))
);
CREATE INDEX squeek_auth_codes_expiry ON squeek_auth_codes(expires_at);
CREATE TABLE squeek_tokens (
 token_hash TEXT PRIMARY KEY NOT NULL,
 source_session_hash TEXT NOT NULL,
 address TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 CHECK(expires_at>created_at)
);
CREATE INDEX squeek_tokens_expiry ON squeek_tokens(expires_at);

-- A separately invoked deployment action publishes the 11 approved cosmetics
-- (owner decision 2026-11-07, 200 GOLD each). It is not a wallet-admin
-- signature or a ledger entry, and it does not change any GOLD control: sales
-- also need the Worker flag SQUEEK_SALES_ENABLED=1 and the shared service control.
CREATE TABLE squeek_release_actions (
 id TEXT PRIMARY KEY,
 actor TEXT NOT NULL CHECK(actor='authorized-deployment'),
 catalogue TEXT NOT NULL CHECK(catalogue='squeek-world-1'),
 created_ms INTEGER NOT NULL CHECK(created_ms>0)
);
CREATE TRIGGER squeek_release_enable BEFORE INSERT ON squeek_release_actions BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM squeek_release_actions)
 OR EXISTS(SELECT 1 FROM world_gold_products WHERE product LIKE 'squeek-%')
 THEN RAISE(ABORT,'SQUEEK_RELEASE_BASELINE_CHANGED') END;
 INSERT INTO world_gold_products(id,product,version,kind,title,gold,embeo,enabled,created_ms) VALUES
 ('squeek-aura-frostmoon-sword-v1-v1','squeek-aura-frostmoon-sword-v1',1,'service','鼠道修仙・霜月劍意',200,NULL,1,NEW.created_ms),
 ('squeek-aura-star-river-arcane-v1-v1','squeek-aura-star-river-arcane-v1',1,'service','鼠道修仙・星河流轉',200,NULL,1,NEW.created_ms),
 ('squeek-aura-golden-body-v1-v1','squeek-aura-golden-body-v1',1,'service','鼠道修仙・不動金身',200,NULL,1,NEW.created_ms),
 ('squeek-aura-blood-moon-demon-v1-v1','squeek-aura-blood-moon-demon-v1',1,'service','鼠道修仙・血月焚魂',200,NULL,1,NEW.created_ms),
 ('squeek-glow-auspicious-cloud-v1-v1','squeek-glow-auspicious-cloud-v1',1,'service','鼠道修仙・祥雲靈環',200,NULL,1,NEW.created_ms),
 ('squeek-glow-nine-stars-v1-v1','squeek-glow-nine-stars-v1',1,'service','鼠道修仙・九星連環',200,NULL,1,NEW.created_ms),
 ('squeek-glow-fire-lotus-v1-v1','squeek-glow-fire-lotus-v1',1,'service','鼠道修仙・業火紅蓮',200,NULL,1,NEW.created_ms),
 ('squeek-sky-sakura-v1-v1','squeek-sky-sakura-v1',1,'service','鼠道修仙・櫻吹雪',200,NULL,1,NEW.created_ms),
 ('squeek-sky-fireflies-v1-v1','squeek-sky-fireflies-v1',1,'service','鼠道修仙・螢火之夜',200,NULL,1,NEW.created_ms),
 ('squeek-sky-first-snow-v1-v1','squeek-sky-first-snow-v1',1,'service','鼠道修仙・初雪',200,NULL,1,NEW.created_ms),
 ('squeek-sky-meteors-v1-v1','squeek-sky-meteors-v1',1,'service','鼠道修仙・流星雨',200,NULL,1,NEW.created_ms);
END;
CREATE TRIGGER squeek_release_no_update BEFORE UPDATE ON squeek_release_actions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RELEASE_ACTION'); END;
CREATE TRIGGER squeek_release_no_delete BEFORE DELETE ON squeek_release_actions BEGIN SELECT RAISE(ABORT,'IMMUTABLE_RELEASE_ACTION'); END;
