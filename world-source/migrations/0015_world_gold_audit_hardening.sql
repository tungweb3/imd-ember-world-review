-- Additive Audit remediation; 0010..0014 and their historical data are preserved.
-- This is a per-product safe-integer bound, not an economic issuance cap.
ALTER TABLE world_gold_jobs ADD COLUMN delivery_evidence_json TEXT;
CREATE TRIGGER world_gold_delivery_evidence_immutable BEFORE UPDATE ON world_gold_jobs
WHEN OLD.delivery_evidence_json IS NOT NULL AND NEW.delivery_evidence_json IS NOT OLD.delivery_evidence_json
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_DELIVERY_EVIDENCE'); END;
CREATE TRIGGER world_gold_product_safe_integer BEFORE INSERT ON world_gold_products
WHEN NEW.gold>9007199254740991
BEGIN SELECT RAISE(ABORT,'GOLD_PRODUCT_INTEGER_LIMIT'); END;
CREATE TRIGGER world_gold_link_safe_integer BEFORE INSERT ON world_gold_links
WHEN NEW.gold>9007199254740991
BEGIN SELECT RAISE(ABORT,'GOLD_PRODUCT_INTEGER_LIMIT'); END;
CREATE TRIGGER world_gold_credit_capacity BEFORE INSERT ON world_gold_entries
WHEN NEW.delta>0 AND COALESCE((SELECT balance FROM economy_gold_accounts WHERE wallet=NEW.wallet),0)>9223372036854775807-NEW.delta
BEGIN SELECT RAISE(ABORT,'GOLD_BALANCE_CAPACITY'); END;
CREATE TABLE world_gold_reconcile_errors(
 order_id TEXT PRIMARY KEY REFERENCES economy_orders(id), code TEXT NOT NULL,
 retry_ms INTEGER NOT NULL, attempts INTEGER NOT NULL CHECK(attempts>0)
);
CREATE TABLE world_gold_mint_settlements(
 order_id TEXT PRIMARY KEY REFERENCES world_gold_mints(id),
 state TEXT NOT NULL CHECK(state IN ('consumed','released')),
 evidence_json TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,
 created_ms INTEGER NOT NULL
);
CREATE TRIGGER world_gold_mint_settlements_no_update BEFORE UPDATE ON world_gold_mint_settlements
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MINT_SETTLEMENT'); END;
CREATE TRIGGER world_gold_mint_settlements_no_delete BEFORE DELETE ON world_gold_mint_settlements
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_MINT_SETTLEMENT'); END;
-- Mirror the server's bound proof predicates. Missing JSON fields must fail,
-- never pass through SQLite's three-valued NULL comparison semantics.
CREATE TRIGGER world_gold_mint_proof BEFORE UPDATE ON world_gold_mints
WHEN NOT COALESCE(
 json_valid(NEW.evidence_json)
 AND json_extract(NEW.evidence_json,'$.schema')='ember-mint-proof-v1'
 AND (json_extract(NEW.evidence_json,'$.mode')='finalized-chain' OR (OLD.chain_id=31337 AND json_extract(NEW.evidence_json,'$.mode')='private-chain-fixture'))
 AND json_extract(NEW.evidence_json,'$.orderId')=OLD.id
 AND json_extract(NEW.evidence_json,'$.wallet')=OLD.wallet
 AND json_type(NEW.evidence_json,'$.gold')='text' AND json_extract(NEW.evidence_json,'$.gold')=CAST(OLD.amount AS TEXT)
 AND json_type(NEW.evidence_json,'$.chainId')='integer' AND json_extract(NEW.evidence_json,'$.chainId')=OLD.chain_id
 AND json_extract(NEW.evidence_json,'$.contract')=OLD.contract
 AND json_extract(NEW.evidence_json,'$.chainInstance')=OLD.chain_instance
 AND json_type(NEW.evidence_json,'$.blockHash')='text' AND length(json_extract(NEW.evidence_json,'$.blockHash'))=66
 AND substr(json_extract(NEW.evidence_json,'$.blockHash'),1,2)='0x' AND substr(json_extract(NEW.evidence_json,'$.blockHash'),3) NOT GLOB '*[^0-9a-f]*'
 AND json_extract(NEW.evidence_json,'$.blockHash')<>'0x0000000000000000000000000000000000000000000000000000000000000000'
 AND json_type(NEW.evidence_json,'$.blockNumber')='text' AND length(json_extract(NEW.evidence_json,'$.blockNumber'))>0 AND json_extract(NEW.evidence_json,'$.blockNumber') NOT GLOB '*[^0-9]*'
 AND (json_extract(NEW.evidence_json,'$.blockNumber')='0' OR substr(json_extract(NEW.evidence_json,'$.blockNumber'),1,1) BETWEEN '1' AND '9')
 AND json_type(NEW.evidence_json,'$.chainTimeMs')='integer' AND json_extract(NEW.evidence_json,'$.chainTimeMs')>0 AND json_extract(NEW.evidence_json,'$.chainTimeMs')<=9007199254740991
 AND json_type(NEW.evidence_json,'$.tokenId')='text' AND length(json_extract(NEW.evidence_json,'$.tokenId'))>0 AND json_extract(NEW.evidence_json,'$.tokenId') NOT GLOB '*[^0-9]*'
 AND (json_extract(NEW.evidence_json,'$.tokenId')='0' OR substr(json_extract(NEW.evidence_json,'$.tokenId'),1,1) BETWEEN '1' AND '9')
 AND json_type(NEW.evidence_json,'$.revoked') IN ('true','false')
 AND ((NEW.state='released' AND json_extract(NEW.evidence_json,'$.tokenId')='0' AND (json_extract(NEW.evidence_json,'$.revoked')=1 OR (json_type(NEW.evidence_json,'$.revoked')='false' AND json_extract(NEW.evidence_json,'$.chainTimeMs')>OLD.deadline)))
 OR (NEW.state='consumed' AND CAST(json_extract(NEW.evidence_json,'$.tokenId') AS INTEGER)>0 AND json_type(NEW.evidence_json,'$.revoked')='false'
 AND json_type(NEW.evidence_json,'$.transactionHash')='text' AND length(json_extract(NEW.evidence_json,'$.transactionHash'))=66
 AND substr(json_extract(NEW.evidence_json,'$.transactionHash'),1,2)='0x' AND substr(json_extract(NEW.evidence_json,'$.transactionHash'),3) NOT GLOB '*[^0-9a-f]*'
 AND json_extract(NEW.evidence_json,'$.transactionHash')<>'0x0000000000000000000000000000000000000000000000000000000000000000'))
,0)
BEGIN SELECT RAISE(ABORT,'MINT_EVIDENCE_REQUIRED'); END;
