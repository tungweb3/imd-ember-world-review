# Audit request: fixes for 521bc017, and an administrator GOLD grant

Prepared 2026-11-04. A request for review, not a claim that anything is safe. Nothing here has been verified externally, and **no real Celestao payment and no real grant has ever been made**.

## 0. Scope and identity

- World source `fd46d69ca2d59bcd442aba5cd9990f53f93870c3`, **not deployed**. Base `754ef44` is Submission23, reviewed as job 521bc017. Live is still `d5d7912`.
- **The wallet-lock test fails on purpose.** The grant changes five audited files: `server/economy-recovery.ts`, `server/world-gold-api.ts`, `server/world-gold.ts`, `src/world/WorldGoldPanel.tsx`, `src/world/worldGoldClient.ts`. Their hashes were not refreshed, so the deploy tool refuses this source until this audit is handled and the owner approves it.
- Earlier versions of those five files are public: `server/economy-recovery.ts` and `server/world-gold.ts` in Submission13, `server/world-gold-api.ts` and `src/world/worldGoldClient.ts` in Submission14, `src/world/WorldGoldPanel.tsx` in Submission19. Read `patches/` for the change.
- `migrations/0024`, `src/shared/goldGrants.ts`, `src/world/goldGrantRules.ts` and the grant tests are not on the lock list yet. That is decided when the lock is refreshed after this audit.
- **New ledger authority:** until now every GOLD credit had a paid order or a failed service behind it. A grant has neither. Please treat it as the main risk in this round.
- `wrangler.jsonc` is not in this package. The numbers taken from it are stated where used.

## 1. The administrator grant

Off unless the Worker variable `WORLD_GOLD_GRANTS` is `enabled`. It is in neither wrangler config, and the owner has not set it. The switch exists only in the application, not in the database.

- **Who:** two wallets, a subset of the three GOLD administrators, listed in `server/world-gold.ts` and again in the trigger of `migrations/0024_world_gold_grants.sql`. **One of the two is the economy treasury address** (`ECONOMY_TREASURY`), so that wallet signs in to the site to grant.
- **Limits, in the database trigger as well as the application:** 5,000 GOLD per grant, and per rolling 24 hours across both wallets 20,000 GOLD and 100 grants.
- **Book:** `world_gold_grants` is immutable and applies to `economy_gold_accounts` by trigger. It shows in `world_gold_history`. `server/economy-recovery.ts` snapshots it and counts it in the balance check.
- **Trail:** a required reason, and a `world_gold_admin_actions` row with the recipient's balance before and after.
- **Repeats:** a request id pays once per wallet and replays any number of times, even with the switch off; a replay answers `{id,replayed:true}`, and so does a request that lost the race for its id. The same wallet and amount under a new id is refused for 10 minutes, which covers an operator who lost the answer and reloaded. That rule is in the application only.
- **Recipient:** a mixed-case address must pass its checksum. Any other non-zero address is accepted, **including the granting wallet itself**. There is no second approver and no notification.
- **Authentication:** the existing administrator session (EOA, ECDSA, same origin, checked again inside the write batch). **There is no wallet signature per grant.** Sessions last 7 days, so one stolen session could grant up to about 140,000 GOLD over its life, and spend it.
- **Other gates:** a halted or replaced economy refuses grants. `world_gold_controls` does not gate them. A partly applied `0024` (missing table, trigger or view change) keeps the form closed and refuses a grant.
- **Spending:** granted GOLD is one balance with bought GOLD. It can pay for services and, when mint is open, mint. The owner chose this; the limits and the off switch are the control.
- **This is not a cap on all issuance:** any of the three administrators can still publish a `topup` product with a very large GOLD amount at a very low price.

## 2. Findings of 521bc017

| # | Severity | Finding | Now |
|---|---|---|---|
| 1 | High | Wallet sign-in callback refused by the Sec-Fetch-Site rule | Fixed: only GET and HEAD on the callback path are exempt (`app.py`). Takes effect live only when the service is released |
| 2 | Medium | All buyers share one relay address and one limit | Fixed: a signed prepare is budgeted per bridge session, a token exchange per login code; unsigned checkout traffic keeps the address budget. A token call with no bearer gets 401 unbudgeted, as before |
| 3 | Low | `0023` installs the sixth product only if the release action ran first | Fixed: a trigger installs it when the release action comes later. A row published by hand with `enabled=0` is left as it is; with `enabled=1` the release aborts |
| 4 | Low | A repeat after 15 minutes returned an expired checkout | Fixed on both sides for an unbound checkout. **Partly open**, section 4 |
| 5 | Low | Session checks spent the sign-in budget | Fixed: they use the bridge budget |
| 6 | Low | Birth data stored before World admits a checkout, kept for ever | Fixed, section 3 |
| 7 | Low | Celestao answered only after computing, and World aborts at 10 s | Fixed: answers `pending` after 8 s and keeps computing |
| 8 | Info | A reverse proxy could merge all clients | **Not changed.** `serve_production.py` sets trusted proxies from `CELESTAO_PROXY_IP`. It is private, and the Cloudflare layer was not verified, so this is a deployment check |
| 9 | Info | Expired checkout rows never removed | Fixed for rows with no order, one day after their window, so an open tab keeps reading them as expired. Rows with an order stay |
| 10 | Info | Catalogue version string not changed | **Not changed.** The release record's CHECK binds that string |
| 11 | Info | JS and Python `replace` differ | Fixed: every underscore is replaced |

## 3. Unpaid data: the design, because the first version was wrong

The first fix, `50f316f`, was reworked in `bce6bf6` after internal review found it could lose a paid order. Only a delivery tells the vault about an order, so a clock alone cannot say a run is unpaid.

- A new run carries `unadmitted=1`. World's success clears it. A run without the mark, including any written by an older version, counts as sent to World.
- An unadmitted run leaves at the next prepare by anyone after its window ends (up to 50 rows per call), or at once when the request that made it is refused. No buyer ever received its id.
- An admitted run with no order leaves 30 days after its window, and only after World has just answered a prepare. That shows Celestao can reach World, not the other way round; see section 4.
- A session that ended while World answered gets no link, and the run stays unadmitted.
- A computation keeps its attempt while it runs. After 15 minutes it is cancelled with an error log, and replaced only once it has really ended, which also covers the older case of work past the 120-second lease never delivering.

**Also changed after internal review, not from 521bc017:**

- The service's limit table held 2,048 entries and refused anyone new once full. One client rotating addresses could close the wallet routes, delivery included. A full table now drops its oldest entry, IPv6 counts by /64, and delivery has its own count. During such a flood a dropped client's count starts again.
- A cancel does not stop the annual or profile computation, which waits for its worker thread. A second computation beside it would use up the two shared engine slots, so there is none until the first ends.
- Shutdown waits at most 60 seconds for computations. An order cut off this way stays pending and is claimed again.
- A delivery the vault refuses (409) now logs `celestao_delivery_refused` with the order id.

## 4. Known and left as they are

- **World unable to deliver for over 30 days while prepares still succeed** (World to Celestao down one way, or World's job runner stopped): a paid, undelivered order can lose its birth data. Delivery then answers 409 for ever, with no refund, and the same request id could be charged again. The first successful prepare after a deployment can also remove up to 50 such old rows, so paid checkouts should be compared with the vault before release. The 409 is now logged; nothing else alerts on it, and there is no repair path.
- **Clean-up runs only on prepare,** so it waits while sales are paused or nobody buys. 30 days is longer than the earlier design's 72 hours, and the privacy text states no period.
- **Reloading the page during checkout** gives a new request id and a second payable run. A buyer who pays both is charged twice (existing).
- **A result over the vault's size limit** stays pending for ever with no automatic refund, and is computed again at each lease expiry (existing). Failed and completed runs keep their encrypted input (existing).
- **An annual or profile computation that truly hangs** keeps its order pending and an engine slot taken until it ends or the process restarts, with an error log at each delivery attempt. Two such hangs close the engine to public requests as well.
- **A quoted order that lapsed unpaid** keeps its bound checkout. A repeat of the same request id answers 200 with an `expiresAt` in the past, and quoting then gives `ORDER_EXPIRED` until a reload gives a new id. No money is lost.
- **Up to 800 expired World checkouts an hour are removed.** Celestao allows 10,800 requests an hour per peer, and World 1,200 prepares an hour per bridge session. There is no per-wallet cap on unpaid runs.
- **Rolling back and forward again:** older code does not know `unadmitted` and can give a link for a run that still carries the mark. If its order is unbound when the new version returns and the window has passed, the run is deleted.
- **Grants, irreversible:** a grant cannot be taken back, and the book has no correcting entry. Rolling the Worker back after the first grant makes recovery plans refuse, as they fail closed on an unexplained balance.
- **Grants, clock:** both limits trust `created_ms` from the Worker clock. A forward jump escapes the rolling window: after 20,000, a clock two days ahead allowed a further 5,000. Each future row then reduces the budget until its time plus 24 hours. Direct SQL with stepped `created_ms` passes the trigger too. The trigger cannot check this against a database clock without losing the tests of its window.
- **Grants, recovery size:** rows cannot be pruned, and each enters a recovery plan limited to 4 MiB. With 500-character reasons on a small fixture, 1,800 grants planned and 2,200 were refused. The count limit slows this and does not remove it.
- **`INSERT OR REPLACE`** on the grant table skips the immutability triggers on D1, leaving the balance and the book apart. No code uses it.
- From Submission23: a target date of 2099 or later gets unedited text at full price, there is no per-product sale switch on the service, and rolling back after a first sale strands paid annual orders.

## 5. Please attack

1. **Grant limits and authority:** any path past 5,000 per grant, 20,000 or 100 grants per 24 hours, or for another wallet. Include D1 batch behaviour, races, clocks, replays, session end and cross-site requests.
2. **Ledger consistency:** anything that assumes every credit has an order, and anything else that must count `world_gold_grants`. Is a session enough for this authority, given section 1, or should each grant need a wallet signature?
3. **Pay and receive after the rework:** interleavings of prepare, admit, refusal, expiry, repeat, delivery, restart and the 15-minute replacement that lose a paid order or charge twice.
4. **Retention:** can `unadmitted` be wrong in a way that deletes a run a buyer holds, or keeps data no buyer holds?
5. **Budgets:** can one buyer still close checkout for others, or can the new keys or the limit table's new behaviour be used to bypass a limit?
6. **Migrations `0023` and `0024`:** partial application, the trigger in both orders, and the view rebuild on D1.

Report severity, reproduction and fix. Not in scope: chart engines, report wording, 3D and rendering, media, AIMarket, Genesis.

## 6. Evidence

- `evidence/full_suite_fd46d69_summary.txt`: 3,904 tests, 3,898 pass, 5 skipped, 1 fail (the wallet lock, as above); type check.
- `evidence/removal_checks.txt`: each safeguard removed once.
- `evidence/celestao_side_summary.txt`: overlay and real-engine tests.
- The grant form was operated in a real browser against a stub client, before the last fixes and not with a real session.
- On local workerd D1, at this source, with `0024` applied by wrangler locally: 12 parallel grants of 5,000 could not exceed the limit, and three parallel requests with one id wrote one row.
- Internal reviews read this code and tried scenarios. They are not external verification.

## 7. Not tested

Real payment; real grant; production D1 or remote migrations; the logged-in panel with a real wallet; the release image; limiter behaviour on Cloudflare; whether `CELESTAO_PROXY_IP` gives real per-client peers; a real engine hang, which was only simulated; service timing on its server.
