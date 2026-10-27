# Production observations (2026-10-26 UTC, owner wallet `0x9f2c…d985`)

All reads below were read-only (D1 `SELECT`, public Ethereum RPC). Payments were made by the owner with real EMBEO on Ethereum mainnet. These are single observations, not a test campaign.

## GOLD top-ups (100 GOLD for 10,000 EMBEO each)

| # | Order (prefix) | Payment tx (prefix) | Mined (UTC) | Credited by | Notes |
|---|---|---|---|---|---|
| 1 | `0x4121e687` | `0x9c62b820` | 02:59 | finalized path | Before fast credit existed. MetaMask routed the call through its Delegation Manager (`redeemDelegations`); this exposed the receipt-matching issue fixed in `ad01fd2` (smart-account routed payments). |
| 2 | `0x127e9f2b` | `0xdaba9b08` | 10:35:35 | finalized path (~16 min) | Fast credit not deployed yet. |
| 3 | `0xacecd436` | `0xec38fd54` | 16:40:11 | finalized path | Fast credit ON. Client polls were refused with `RATE_LIMITED`: they shared the per-IP `world-gold:` budget (20/min) with ledger refreshes. Fixed in `b96738d` (own key `world-gold-fast:`). |
| 4 | `0x6cc87a12` | `0x7ce2e92b` | ~17:12 | finalized path | Server verified the receipt, then D1 refused the write: `D1_TYPE_ERROR: Type 'bigint' not supported`. The local test adapter (node:sqlite) accepted BigInt binds. Fixed in `66565c7`; the test adapter now refuses BigInt like D1. Also logged `NO_PAYMENT_FOR_ORDER` for the approval hash; the client now follows only the payment step's hash. |
| 5 | `0x64823fc0` | `0xb7b047cf` | 18:18:47 | **fast credit at 18:18:52 (about 5 s)** | Settled by the finalized path at 18:38:37 (`state=settled`, 2 fast entries: `fast-topup +100`, `fast-settle −100`). |

After #5: wallet balance 500; `economy_gold_journal + world_gold_entries + world_gold_fast_entries` for the wallet = 500 (the recovery invariant). `world_gold_fast_debts` with `amount>0`: 0. `economy_chain_state.halted_reason`: null.

Live Worker logs (`wrangler tail`, sampled) during #5 showed `gold_fast_credit` outcomes `waiting` then `credited`; no exceptions, no 429 on the fast-credit route.

## Staking (1 share = 100,000 EMBEO)

- Approval tx `0x8d5364ec…` mined 19:22:23, then the pane showed `CONTEXT_CHANGED` and never offered "Confirm stake": the wallet controller compared the session **object** and the auth client re-reads the session about once a minute with a new object (same address and expiry). Fixed in `b3118c9` (value comparison; a new sign-in or another wallet still stops the flow).
- Stake tx `0x80eda22e…` mined 20:02:35 (`Staked` from the staking contract `0xf110…eda9`). The finalized ledger booked position `#1`, 1 share, `deposited_ms` = 20:02:35, about 15 minutes later. First complete UTC day 2026-10-27; first GOLD expected 2026-10-28 00:00 UTC (not yet observed).

## Schema

Production D1 has migration `0021_world_gold_fast_credit.sql` applied (2026-10-26, after the 11:23 UTC deployment of `3cf9e16`; Time Travel bookmark taken just before: `00000bdc-00000022-00005110-bcbd097260adcabc10bf433095b22b55`); the 10 objects `fastGoldReady` requires are present. Worker secret `GOLD_FAST_CREDIT` is set to `1` (value written with `wrangler secret bulk` so it is exactly `"1"`).
