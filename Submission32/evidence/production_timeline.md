# Production timeline of the stuck order (UTC, 2026-11-08)

| Time | Event | Source |
|---|---|---|
| 13:42:17 | Celestao reading created for `fortune-annual-ziwei`; the vault wrote its prepared run | D1 `celestao_checkouts`; vault file mtime |
| 13:42:46 | 1,000 GOLD paid in World; delivery job queued | D1 `economy_orders.paid_ms` |
| 13:43 to 15:43 | The job was claimed every minute and never reached Celestao: no request in the Celestao or Caddy logs, the vault file not written again | D1 `world_gold_jobs.updated_ms`; container and Caddy logs (read only) |
| 15:11:16 | A one-off `wrangler dev --remote` probe Worker called `fetch(..., {redirect:'error'})` the same way World does: after 0 ms, "TypeError: Invalid redirect value, must be one of "follow" or "manual"", nothing sent | probe output |
| 15:38:36 to 15:44:16 | World `deba7cc` deployed (Worker version `200a0240`), full suite first | deploy record |
| 15:44:34 | The job became `delivered` (one cron pass after the deploy) | D1 `world_gold_jobs` |
| 15:51:52 to 15:58:01 | The same commit deployed again (Worker version `c9a77feb`, live now); identical code | deploy record |

After the fix, production D1 holds exactly one GOLD service job (this one, `delivered`), no job in `queued` or `working`, and no AI Market job.
