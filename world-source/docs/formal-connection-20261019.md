# World production connection candidate

Owner instructions on 2026-10-19: complete remaining connections; keep the game
NFT allowlist empty; detailed local verification, then combined deployment and
complete backup, then publish only review-relevant code/tests/docs to GitHub and
fill Audit. Purchase rates and service prices are deliberately deferred. No
fixture price, real payment, NFT issuance, or invented inventory grant follows
from this release. The accepted external verdict, runtime activation, and cloud
backup are separate facts, recorded by the release evidence, not by this file.

## Inventory

Migration 0017 adds two independent tables and an index without touching existing
identity, housing, or financial tables. GET/POST `/api/me/inventory` use the
existing World session and expected-wallet fence. Writes require an ECDSA EOA
session and a compare-and-swap revision, and recheck session authority in SQL.
Display/publish additionally use a fresh server ownership/home result. Failed
or incomplete-negative home reads are unavailable, not a complete zero. Private
holdings remain readable when housing cannot be checked. Revoked or unknown
holdings are excluded from equipment/display references without deleting their
original evidence. Moving a display changes a reference, never ownership.

The compiled approved item catalogue and game NFT collections are currently
empty. No browser grant endpoint exists. Preview identities, starter items,
chain-31337 NFTs, arbitrary wallet airdrops, and shared model files do not become
real assets. Game issuance remains the independent game integration's trusted
server responsibility; a future definition/issuer must be explicitly installed.
Equipment persistence is not a claim that the separately developed game already
consumes the loadout for combat stats.

GET `/api/world/collections/:wallet` exposes only explicitly published slots
after a current housing proof. It never returns private bag/equipment,
provenance, financial amounts, orders, research or fortune data. House panels
request the public projection only when the visitor asks. The owner can open
the same inventory from the wallet or inside the original room; static display
frames reuse the existing renderer. New UI chunks are lazy and the original
buildings, roads, models and placement data are preserved.

## Free campaigns and the real ledger

GET/POST `/api/me/aimarket-campaign` are restricted to the three existing owner
wallets, use UTC half-open intervals and versioned, reasoned, idempotent audit
records. They cannot change prices, financial controls, balances, or external
website access. They are independent of undeployed chain contracts/prices.
The existing signed backend bridge conveys a campaign on every fresh World
session introspection; external profiles cannot use it.

The real shared D1 GOLD summary/history are readable before chain activation.
The staking balance remains explicitly not configured until real deployments
and indexing are installed. New quote/price/control admission stays closed with
no chain configuration. Verified original payments may still reconcile, and
owners may repair/refund their original proven entitlement while admission is
closed. No memory/prototype balances are copied into production.

## AIMarket delivery

`aimarket-delivery.ts` fixes the upstream to aimarket.trade and uses a distinct
request/response HMAC protocol under the existing backend research credential;
it does not reveal that credential or grant payment/admin authority to the VPS.
The provider currently supports only `research`; a configured provider is not
authority to sell an unsupported fortune service. Backend-only POST endpoints
are `/api/internal/world-gold/deliver` and `/api/internal/world-gold/read`.

The VPS module `web/world_gold_delivery.py` authenticates before storage, binds
an order to its original wallet/product, and keeps an immutable snapshot of the
first successfully delivered published IMD daily research report. The snapshot
has the receiver's original canonical SHA256/report ID. A retry or later reopen
returns that snapshot, not a later report. `/api/gold/orders/:id/report` verifies
the original paid/delivered order and caller, asks for that exact snapshot, and
rechecks the session after upstream I/O. Responses render as text, not HTML.

Unknown HTTP/network/format outcomes remain retriable, not refund proof. A
persisted oversized-document refusal is authenticated original-order
nondelivery and refunds only that order once. Lost replies after a committed
receipt retry to the same result. Reports are bounded to 900,000 UTF-8 bytes;
the World response is independently bounded. The separate VPS receipt SQLite
file is under the existing state mount with mode 0600. Existing receiver/holder
databases, Caddy, daily collectors and their timers are retained.

The initial service implementation is delivery of an already published daily
research document, not arbitrary fresh generation or a fortune adapter. The
service product/price and sale-time disclosure must be approved before paid
admission. The owner has explicitly deferred prices, so this connection does
not open paid services. Existing World research access and external teaser
policy are preserved.

## Verification and publication

Evidence must distinguish SQLite-unit, native local workerd D1, the candidate
VPS image with an isolated receiver snapshot/test credential, actual mainnet
read-only preflight, actual signed deployments, real session/browser acceptance,
production readback and cloud full-byte verification. Layout fixtures are
marked as such and do not establish real wallet holdings.

Keep failed/interrupted runs. New migrations remain additive. Do not reset or
restart R3/R4 chains to satisfy a test. A GitHub review subset excludes GLB,
textures, videos, music, raw databases, credentials and local private evidence;
it must still include all added financial/identity/inventory/campaign/delivery
sources and meaningful portable tests, exact source hashes and limitations.
