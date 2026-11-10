# Read-only check for finding 3 (2026-11-10)

Run against production D1 with `wrangler d1 execute --remote --command` (SELECT only):

```sql
SELECT p.product, substr(j.order_id,1,10)||'..' AS order_prefix, substr(j.wallet,1,6)||'..'||substr(j.wallet,-4) AS wallet,
       j.state, j.failure, datetime(o.paid_ms/1000,'unixepoch') AS paid_utc, datetime(j.updated_ms/1000,'unixepoch') AS job_updated_utc
FROM world_gold_jobs j JOIN economy_orders o ON o.id=j.order_id
LEFT JOIN world_gold_links l ON l.order_id=j.order_id LEFT JOIN world_gold_products p ON p.id=l.product_id
WHERE j.state IN ('queued','working') AND o.paid_ms < (CAST(strftime('%s','now') AS INTEGER)*1000 - 3600000)
ORDER BY o.paid_ms
```

Result: `"results": []`, `"changes": 0`, `"changed_db": false`. No paid service order has been waiting for more than an hour.
The operator runs this query by hand; it is not scheduled and nothing alerts on it.
