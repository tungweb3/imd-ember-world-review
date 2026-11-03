# Audit request: sixth Celestao GOLD product, and the payment path it runs on

Prepared 2026-11-04. A request for review, not a claim that anything is safe. Nothing here has been verified externally, and **no real Celestao payment has ever been made**.

## 0. Scope and identity

- World source `754ef449ab3084002689b547afe8406c00a4ded2`, **not deployed**. Base `d5d7912` is live as Worker `8ff52b03`.
- The wallet-lock test passes: 70 audited wallet files are byte-identical. **Behaviour still changes:** the catalogue is shared, so `server/world-gold.ts`, `src/world/celestaoCheckoutClient.ts` and `src/world/WorldGoldPanel.tsx` now accept a sixth product. Their unchanged text is public: the first two in Submission13, the panel in Submission19.
- Production today: release action already run, five fortune products enabled, 0 rows in `celestao_checkouts`, 0 fortune orders.

## 1. What changed

- **Catalogue:** `fortunePricing.ts` adds system `annual_ziwei`, product `fortune-annual-ziwei`, 1,000 GOLD. World's product id rule refuses underscores, so the id replaces `_` with `-`. Prices of the other five are unchanged.
- **Migration `0023`:** rebuilds `celestao_checkouts` to widen its CHECK, keeps its rows and index, then adds the product row only where the release action has already run. Product rows are immutable and the checkout accepts only version 1 at the catalogue price, so one mistyped admin form could never be repaired.
- **Celestao overlay:** `paid.py` and `bridge.py` derive the same id; `native.py` validates and computes the annual reading, from a route never mounted publicly; the collection stores and reopens it (`vault.py`, `app.py`, `web/world-wallet.js`).

## 2. Found by internal review, fixed here

| Problem | Fix | Test |
|---|---|---|
| `bridge.py` still built `fortune-annual_ziwei`, so every annual prepare failed | Same id derivation as `paid.py` | `test_prepare_checkout_expects_the_product_id_world_answers_with` |
| A birth in 1900 returned 500 at prepare | Refused as `INVALID_CHART_INPUT` | `test_a_birth_before_the_lunar_table_is_refused_as_input_not_an_error` |
| A name such as `Ann onset=1` paid for a report the reader's safety check then refused for ever | Refused before payment by a rule in the private request model; the reader's check stays as strict | `test_a_name_the_reader_would_refuse_is_refused_before_payment` |

## 3. Known and left as they are

- A paid run whose computation fails stays pending with no automatic refund (existing design). A deterministic failure would stay pending for ever.
- Rolling back after a first sale strands paid annual orders, and the old collection script cannot list them.
- There is no per-product sale switch on the Celestao service: publishing the overlay opens the sale.
- The admin "stop selling" then re-enable flow breaks any fortune product, because rows are immutable and the checkout wants version 1 (existing).
- A target date of 2099 or later, or past the last ten-year stage, gets the unedited report text at full price. Delivery still succeeds.

## 4. Please attack

1. **Pay and receive:** can a buyer pay and not receive, receive without paying, read another wallet's or another run's report, or settle one product's order with another product's receipt? Follow prepare, quote, pay, delivery and the receipt through `celestao-checkout.ts`, `celestao-delivery.ts`, `world-gold-result.ts`, `paid.py`, `bridge.py` and `vault.py`.
2. **Id mapping:** any place where `annual_ziwei` and `fortune-annual-ziwei` can disagree, including `replace('_','-')` and `fortuneProduct()` accepting either form.
3. **Migration `0023`:** on D1, can the rebuild lose rows or break the foreign key from `economy_orders` if applied with payments open, or partly apply? Can the product row appear at a wrong price or too early?
4. **Signatures between World and Celestao:** replay, wrong direction, wrong path, clock window (`celestao-protocol.ts`, `protocol.py`).
5. **Sessions and the vault:** cookie, CSRF, grant exchange, encryption binding, and whether stored reports can be read across wallets (`sessions.py`, `vault.py`, `app.py`).
6. **Input before payment:** anything accepted at prepare that must fail after payment (`native.py`).
7. **Client text:** script injection or a wrong price or product shown in `web/world-wallet.js`.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, 3D and rendering, media, AIMarket, Genesis.

## 5. Evidence

- `evidence/full_suite_754ef44_summary.txt`: 3,858 tests, 3,853 pass, 5 skipped, 0 fail; type check and wallet-lock.
- `evidence/celestao_side_summary.txt`: overlay and native tests, mutations, random charts.

## 6. Not tested

Real payment; World's logged-in payment screen; PDF export; reopening a report from a real wallet; a real D1 migration; the release image and its full deployment; the Celestao service's timing on its server.
