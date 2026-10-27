# First real-wallet top-up after the finality-credit change (2026-10-28, World be7d3b0 live)

The owner bought the `gold-100` package (10,000 EMBEO → 100 GOLD) with MetaMask (smart-account routing) on desktop Chrome.

- Order `0x0763c2f368c6a587d630b9822571f582fb2a580d675c5a3aecb41765af29de1f`.
- Transaction `0xee2b1b238214db3ca74cc99f04dba994209249bd696019f07d26b4a088147eed`, Ethereum mainnet block 26285723, status `0x1`. The transaction is sent to the wallet's own (delegated) address; its receipt carries an EMBEO `Transfer` from the wallet, exactly one `Paid` event of the payment contract with this order id, and one event emitted at the wallet's own address by its delegated code.
- Page during the wait: "正在核對入帳", "入帳中：+100 GOLD，預計 02:19 前入帳（約 15 分鐘）", and the top bar's gold "+100 入帳中".
- Ledger (D1, SELECT only): `economy_orders.status = paid`, `paid_ms` 2026-10-27 18:04:23 UTC (the block time); `world_gold_entries` row `topup:<order>:100`, `delta 100`, created 18:18:30 UTC, about 14 minutes later.
- Not exercised: the GOLD-panel recovery block (paste-hash form and acknowledgement), the learned nonce, and any renumbered, sped-up or cancelled payment.
