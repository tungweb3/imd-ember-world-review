-- Let a Celestao run bind to the annual reading, the sixth paid product.
-- SQLite cannot change a CHECK in place, so the table is rebuilt with its rows.
-- celestao_release_enable stays as it was, because that one-time action has already
-- installed the first five. This product is added here rather than from the admin
-- panel because the checkout accepts only version 1 at the catalogue price and
-- product rows are immutable, so one mistyped form could never be repaired. Nobody can
-- buy it until the Celestao overlay offers it: a quote needs a run signed by that backend.
CREATE TABLE celestao_checkouts_next (
 id TEXT PRIMARY KEY CHECK(length(id)=43),
 wallet TEXT NOT NULL CHECK(length(wallet)=42 AND wallet=lower(wallet)),
 product TEXT NOT NULL CHECK(product IN ('fortune-bazi','fortune-ziwei','fortune-annual-ziwei','fortune-western','fortune-human','fortune-profile')),
 input_hash TEXT NOT NULL CHECK(length(input_hash)=64),
 created_ms INTEGER NOT NULL,
 expires_ms INTEGER NOT NULL CHECK(expires_ms>created_ms),
 order_id TEXT UNIQUE REFERENCES economy_orders(id)
);
INSERT INTO celestao_checkouts_next(id,wallet,product,input_hash,created_ms,expires_ms,order_id)
 SELECT id,wallet,product,input_hash,created_ms,expires_ms,order_id FROM celestao_checkouts;
DROP TABLE celestao_checkouts;
ALTER TABLE celestao_checkouts_next RENAME TO celestao_checkouts;
CREATE INDEX celestao_checkouts_expiry ON celestao_checkouts(expires_ms);
INSERT INTO world_gold_products(id,product,version,kind,title,gold,embeo,enabled,created_ms)
 SELECT 'fortune-annual-ziwei-v1','fortune-annual-ziwei',1,'service','流年運勢',1000,NULL,1,CAST(strftime('%s','now') AS INTEGER)*1000
 WHERE EXISTS(SELECT 1 FROM celestao_release_actions);
