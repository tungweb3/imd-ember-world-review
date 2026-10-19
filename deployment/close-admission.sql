-- Owner deferred retail prices; no sample products or credits may exist.
INSERT INTO world_gold_write_checks(id,accepted)
SELECT 'release-20261019-close-admission',CASE WHEN
 NOT EXISTS(SELECT 1 FROM world_gold_products)
 AND NOT EXISTS(SELECT 1 FROM economy_orders)
 AND NOT EXISTS(SELECT 1 FROM economy_gold_journal)
 AND NOT EXISTS(SELECT 1 FROM world_gold_entries)
 AND NOT EXISTS(SELECT 1 FROM world_gold_mints)
 THEN 1 ELSE 0 END;
UPDATE world_gold_controls SET enabled=0,version=version+1 WHERE enabled<>0;
DELETE FROM world_gold_write_checks WHERE id='release-20261019-close-admission';
