# Production state around the fast-credit switch-off (2026-10-27 UTC)

Read-only D1 queries (`SELECT` only) on `imd-world` just before the switch-off, then `wrangler secret delete GOLD_FAST_CREDIT` on Worker `imd-world` and the deploy of World `325f040` (Worker version `c927a5ae-040e-4109-a723-853978ea3aff`, record `20261027T030604Z-325f040`).

| Query | Result |
|---|---|
| `world_gold_fast_credits` by state | `settled`: 1 (no `credited`, no `reverted`) |
| `world_gold_fast_debts` with amount > 0 | 0 |
| `economy_chain_state` | one config, `halted_reason` empty, finalized cursor at block 26281159 |
| open staking positions | 1 (the owner's wallet, 1 share, position 1) |
| `economy_chain_events` | 5 payments, 1 stake (the owner's) |
| `economy_orders` by status | paid 5, pending 5 (unpaid quotes) |
| Worker secrets after the delete | `GOLD_FAST_CREDIT` absent |

After the deploy: the live `WorldGoldPanel` chunk was byte-identical to the build, and a captured cron run ended `ok` with no exception.

Then World `64396ae` (fast-credit route and tick removed, note fixes) was deployed as Worker version `40c6477f-f6af-491c-91c8-8e6bbd35dac2` (record `20261027T033653Z-64396ae`, 3,615 tests, 0 failures). `POST /api/gold/orders/{id}/fast-credit` on imdember.com answers 404; four live JS bundles were byte-identical to the build; two captured cron runs ended `ok` with no exception and no fast-credit log.
