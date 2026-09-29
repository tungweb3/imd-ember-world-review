# IMD Ember World — audit remediation status

Remediation of the Swarm review of World's wallet sign-in and home authorization (World-only; Genesis Mint out of
scope), following the remediation document v1.0 of 2026-09-29.

| | |
|---|---|
| Reviewed version | Worker `beac62be` (source `0def8cb`, Worker bundle SHA-256 `4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3`) |
| Review date | 2026-09-28 (UTC) |
| Review job | https://explorer.imd.fun/jobs/4bd31cfb-1151-497f-9b27-40e668dea372 |
| Report | https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md |
| Deployment match (review) | partial |
| Remediated in | the commits after `0def8cb` on branch `review-fixes` (`git log 0def8cb..`), which also carries the live speaker fix `6fd74f8` (merged from `main`) |
| Deployment version | Worker version `f9b68223-19f7-4318-8274-294413b81965`, source `1a0ba21`, deployed 2026-09-28 21:05 UTC; evidence: `docs/security/deploy-evidence/20260928T210413Z-1a0ba21.md` |
| Re-review | none yet; this version has not been reviewed |

This page records what changed after the review and what is still open. It does not vouch for this version: the
review applies to the reviewed version only, and the site says so ("Previous review — current version has changed").
The site's record (My wallet → Swarm Audit Record) and this page use the same data, `src/world/reviewRecord.ts`;
`tests/review-record.test.mjs` fails if the two disagree. The severities are the report's; the statuses are the IMD
team's own account, not the reviewers', and the site labels them so. The statuses are the IMD team's own account of its changes,
not the reviewers': the site heads them "Findings (from the review) · fix status as reported by the IMD team, not
re-reviewed" and shows "Re-review: none yet".

| Finding | Severity | Status on the site |
|---|---|---|
| F-1 | Medium (shared boundary) | Partly mitigated: this page checks the message before you sign and shows what you sign, but a phishing site can skip page checks — sign only when the address bar shows imdember.com; if your wallet says the request comes from another site or warns of a mismatch, reject. |
| F-2 | Low/Info | Partly addressed: sessions record the wallet type and check method, and an unavailable check always refuses; the contract’s own rules still decide who signs for it (open). |
| F-3 | Low (availability) | Improved: shares per network and per contract, and a code check before the smart-wallet budget; residual: many networks can still keep first-time smart-wallet sign-in busy at one location while the junk continues (partly open). |
| F-4 | Low | Fixed: “Log out all devices”. |
| F-5 | Low (availability) | Improved: layered limits, challenge and verify counted apart, a per-wallet cooldown; the site-wide ceiling stays as an emergency brake. Still: about 20 /24s at full rate can close new sign-ins site-wide while they keep going; browsing is unaffected (partly open). |
| F-6 | Info | Fixed: build tools updated; npm audit reports 0. |
| F-7 | Info | (a) fixed (the message is checked before signing); (b)–(e) unchanged, accepted as known. |
| F-8 | Info (shared boundary) | Open: nothing changed in World; later pages on this origin share these with World and need their own review. |

Every test command below runs from the repository root with Node 24 after `npm ci`. "Result" is the run of
2026-09-29 on the build machine. The whole suite (`npm test`) is the deploy gate: `scripts/deploy.mjs` runs it before
building and stops on any failure.

## F-1 — sign-in message can be relayed (phishing)

- **Finding:** a server-side script can fetch a real challenge for a victim's address and get it signed on a phishing
  page; the signature then yields a 7-day session. A limit of SIWE itself: the defence is the wallet's domain check.
- **Old behavior:** the page `personal_sign`ed whatever text the server returned (F-7a) and showed no summary; the
  statement did not name approvals.
- **Fix:** the page checks the message line by line before the wallet is asked (domain, URI, chain 1, account, nonce,
  Issued At / Expiration Time, exact statement; anything else: nothing is signed). While the wallet's prompt is open, My
  wallet shows a summary read back from the checked message (domain, network, wallet, purpose "sign-in only", "No asset
  transfer or approval") and "Sign only when the address bar shows imdember.com. If your wallet says the request comes
  from another site or warns of a mismatch, reject." (a relayed message names the real domain, so the domain in the
  text proves nothing; the requesting site does). Above the sign-in button, before the wallet opens, the same domain,
  network and purpose are shown, since a phone wallet's sheet can cover the page. The
  statement now reads "…This does not authorize asset transfers, token or NFT approvals, or transactions."; a challenge
  issued with the previous wording still verifies across a deploy.
- **Files changed:** `src/world/siwe.ts`, `src/world/auth.ts`, `src/world/walletView.ts`, `src/world/WalletPanel.tsx`,
  `src/world/world.css`, `server/auth.ts`, `docs/wallet-login/DESIGN_W1_v001.md`.
- **Tests added:** `tests/wallet-client.test.mjs` "the page checks the sign-in message before the wallet sees it…",
  "while the wallet asks for the signature, the page shows a summary read from the checked message, and only then";
  `tests/auth.test.mjs` "F-1: the statement names transfers, token or NFT approvals and transactions…".
- **Test command:** `node --test --test-name-pattern="F-1|checks the sign-in message|summary read from" tests/auth.test.mjs tests/wallet-client.test.mjs`
- **Result:** 3 tests, 3 pass, 0 fail.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** a phishing page does not run this page's code, so it can still ask for a real message; the
  wallet's own EIP-4361 domain check and the player are the defence. The page check guards against a wrong or tampered
  challenge response, not against script injected into this origin. The build live before this one has no page check,
  so its open pages sign the new statement as before; from now on a later statement change makes open pages refuse
  until reloaded (nothing is signed). Remove `SIWE_PREVIOUS_STATEMENTS` in a later release.

## F-2 — smart-contract wallets that accept any signature

- **Finding:** ERC-1271 lets a contract decide who signs for it; a contract that answers the magic value for any
  signature lets anyone sign in as it (owner mode for any seat it holds).
- **Old behavior:** sessions did not say how they were proved; the path's failure modes were closed but not recorded.
- **Fix:** every session records `wallet_type` (`EOA` | `CONTRACT`) and `verification_method` (`ECDSA` | `ERC1271`),
  for audit and debugging only (never returned, never used to grant anything; ownership stays `ownerOf`). Only a proven
  ECDSA or ERC-1271 signature makes a session; every way the ERC-1271 path can be unavailable is refused (no key, node
  down or erroring: 503; budget refused or throwing: 429; missing binding: 503) and never falls back to the address.
- **Files changed:** `server/auth.ts`, `migrations/0003_sign_in_layers.sql`, `docs/wallet-login/DESIGN_W1_v001.md`, `README.md`.
- **Tests added:** `tests/auth.test.mjs` "F-2: each session records EOA/ECDSA or CONTRACT/ERC1271; every way the
  ERC-1271 path can be unavailable is refused and makes no session"; `tests/presence.test.mjs` (0003 is additive).
- **Test command:** `node --test --test-name-pattern="F-2|ERC-1271 smart wallets|ERC-1271 needs code" tests/auth.test.mjs`
- **Result:** 3 tests, 3 pass, 0 fail.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** open by design of ERC-1271 — see "Smart-wallet (ERC-1271) policy" below.

## F-3 — junk signatures can use up smart-wallet checks

- **Finding:** a few /24s sending junk signatures could spend one location's `chain:erc1271` budget, so smart wallets
  there got 429 `CHAIN_BUSY`.
- **Old behavior:** any non-ECDSA signature, even for an EOA, spent the per-location budget before `eth_getCode`
  (round 1 moved the code read first).
- **Fix:** the ERC-1271 path asks, each step before the read it pays for and with one check per challenge: the claim
  (10 per /24 a minute), `chain:code` (180/min per location), `eth_getCode` (no code: 401, cached), the contract check
  (3 per /24 and 2 per contract address a minute), the location budget (`chain:erc1271:known` for an address that
  signed in by ERC-1271 before, else `chain:erc1271`), then one `eth_call`. Every refusal is 429 and burns the
  challenge; missing bindings are 503.
- **Files changed:** `server/auth.ts`, `worker/app.ts`, `migrations/0003_sign_in_layers.sql`, `wrangler.jsonc`
  (comments), `docs/wallet-login/DESIGN_W1_v001.md`, `README.md`.
- **Tests added:** `tests/auth.test.mjs` "F-3: a /24's garbage leaves its other wallets alone…", "ERC-1271 shares…",
  "P3: garbage signatures for EOAs from 7 /24s never reach chain:erc1271…".
- **Test command:** `node --test --test-name-pattern="F-3|P3|ERC-1271 shares|ERC-1271: the challenge is claimed|ERC-1271 checks spend|missing AUTH, API" tests/auth.test.mjs`
- **Result:** 6 tests, 6 pass, 0 fail.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** at least 7 /24s aimed at at least 10 different contracts can hold first-time smart-wallet sign-in
  at one location at 429 for as long as they keep going (each minute); EOAs are unaffected. Returning smart wallets
  have a budget of their own, which takes at least 7 more /24s aimed at at least 10 addresses that signed in by
  ERC-1271 in the last 8 days; those can be the attacker's own contracts (for example ones that accept any signature,
  F-2), each costing gas and one first-time sign-in. Two junk checks a minute, from
  anywhere, keep one contract address at 429 while they continue (accepted; logged with reason `address`).

## F-4 — log-out ended only this browser

- **Finding:** logout revoked only the session of the browser that asked; a stolen or forgotten session lived 7 days.
- **Old behavior:** no way to end the address's other sessions.
- **Fix:** `POST /api/auth/logout-all` revokes every live session of the session's address (sets `revoked_at`, never
  deletes a row before it expires) and its open challenges. My wallet has two actions: "Log out this device" /
  「登出此裝置」 and "Log out all devices" / 「登出所有裝置」 (the second behind an inline confirm). Other tabs of the
  browser follow at once (BroadcastChannel, then a server read), other devices on their next signed-in request. A new
  sign-in makes a new session; an old cookie never comes back to life.
- **Files changed:** `server/auth.ts`, `src/world/auth.ts`, `src/world/walletView.ts`, `src/world/WalletPanel.tsx`,
  `src/world/world.css`, `docs/wallet-login/DESIGN_W1_v001.md`.
- **Tests added:** `tests/auth.test.mjs` "logout-all: one browser ends every live session of its address on every
  device…", "logout-all needs a live session of its own…"; `tests/wallet-client.test.mjs` "Sign out on all devices:
  every browser of the address is signed out…", "My wallet: “Log out this device” ends only this browser…".
- **Test command:** `node --test --test-name-pattern="logout|Log out|Sign out on all devices" tests/auth.test.mjs tests/wallet-client.test.mjs`
- **Result:** 11 tests, 11 pass, 0 fail (includes the logout-all index test of the internal re-check below).
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** another device learns of it on its next signed-in request, not by push. "Log out all devices"
  from a browser whose own session already ended cannot act for the address; the page says so.

## F-5 — about 20 networks can close sign-in site-wide

- **Finding:** the global challenge valve (60 per 6 s) could be held shut by about 20 /24s at their full share.
- **Old behavior:** challenge and verify shared one per-IP key; no per-wallet layer; refusals were not logged.
- **Fix:** limits in layers (table below); challenge and verify have separate per-IP keys; a per-(address, network)
  cooldown; an audit line when one address is asked for from many networks; one JSON log line per 429/503 without IPs,
  full addresses, cookies, messages or nonces. The global valve stays as the emergency ceiling only.
- **Files changed:** `server/auth.ts`, `server/world-api.ts`, `worker/app.ts`, `migrations/0003_sign_in_layers.sql`,
  `wrangler.jsonc` (comments), `docs/wallet-login/DESIGN_W1_v001.md`, `README.md`.
- **Tests added:** `tests/auth.test.mjs` "F-5: a challenge flood starves neither its own verify nor anyone else…",
  "challenge budgets…" (updated).
- **Test command:** `node --test --test-name-pattern="F-5|challenge budgets|rate limits|logout is never rate limited" tests/auth.test.mjs`
- **Result:** 4 tests, 4 pass, 0 fail.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** about 20 /24s at their full share can still close new sign-ins site-wide while they keep going
  (sign-in only; browsing is unaffected). The edge WAF rule (below) is the first guard. A player who asks for one address
  more than 5 times a minute from one network waits until the minute passes. The log lines are sampled (Workers Logs
  keep about 0.2 of invocations), so monitoring reads counts as about 1/5 of the real number, and a surge writes a line
  for every challenge from the 20th on so it is not lost.

## F-6 — known advisories in build tools

- **Finding:** `npm audit`: 1 low, 4 high, all in build/dev tools reached through wrangler (esbuild's Windows dev
  server, sharp/libvips, undici); none in the deployed bundle (`npm audit --omit=dev`: 0).
- **Old behavior:** wrangler 4.92.0.
- **Fix:** wrangler 4.143.0 (same major; esbuild 0.28.1, miniflare 5.20260926.0-alpha, workerd 1.20260926.1).
  `compatibility_date` unchanged, so production semantics do not move. The Worker bundle still builds; its only change
  is esbuild's module-init helper, so the bundle hash differs from the reviewed one.
- **Files changed:** `package.json`, `package-lock.json`, `wrangler.jsonc` (comment).
- **Tests added:** none (tooling); the whole suite and the build ran on the new version.
- **Test command:** `npm audit`, `npm test`, `npm run build`
- **Result:** `npm audit`: found 0 vulnerabilities; `npm test`: all pass; `npm run build`: passes.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** build-machine supply chain in general (new advisories appear over time; re-run `npm audit` before
  a deploy).

## F-7 — other observations

- **Finding:** (a) the page signed the server's text unchecked; (b) `/api/me/home?fresh=1` can be triggered by a
  cross-site top-level navigation; (c) `style-src 'unsafe-inline'`; (d) the loopback exception reads the request URL's
  hostname; (e) a locked wallet keeps the session.
- **Old behavior:** as described.
- **Fix:** (a) fixed with F-1's page check. (b)–(e) unchanged by design and accepted: (b) spends only that session's
  own bucket and the per-location index budget, and the response cannot be read cross-site; (c) no injection point was
  found; (d) unreachable without workers.dev, which is off; (e) the session is a server fact, not the wallet's.
- **Files changed:** see F-1.
- **Tests added:** see F-1 (the page check).
- **Test command:** see F-1.
- **Result:** see F-1.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** (b)–(e) as the report describes them.

## F-8 — one origin shares headers, cookies and wallet access

- **Finding:** CSP, `__Host-` cookies, local storage and a wallet's "connected site" are per origin; a later page on
  this origin (such as a Mint page) shares them with World.
- **Old behavior / Fix:** no change in World (nothing to change today).
- **Files changed:** none. **Tests added:** none. **Test command / Result:** not applicable.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** open; any later page on this origin needs its own review (see the Genesis reminder below).

## Smart-wallet (ERC-1271) policy

- EOA and contract wallets are told apart: an ECDSA signature that recovers to the address is `EOA`/`ECDSA` (no chain
  read, including a 7702-delegated EOA signing with its own key). Anything else takes the ERC-1271 path, which needs
  code at the address and exactly the 32-byte magic word from `isValidSignature`; that is `CONTRACT`/`ERC1271`.
- ERC-6492 (undeployed smart accounts) is refused (400).
- The path fails closed: no RPC key, the node down or erroring (503 `VERIFY_UNAVAILABLE`), a refused or throwing budget
  (429 `CHAIN_BUSY`), a missing limiter binding (503 `LIMITER_UNAVAILABLE`). None of them makes a session or trusts the
  address alone. Each challenge buys at most one ERC-1271 check and is burnt on any failure.
- The recorded type and method are for audit and debugging; they grant nothing and `/api/auth/session` does not return
  them. Seat ownership is always proved with `ownerOf` on Ethereum mainnet.
- **Risk (F-2, stated, not fixed):** the contract decides who may sign for it. A contract that accepts any signature
  (some vaults, escrows, badly written wallets) lets anyone sign in as it, and if it holds a seat, anyone gets owner
  mode for that seat (today a read-only view on the player's own screen). The `CONTRACT` mark makes such sessions
  visible in D1; it does not make them safer. Anything that later grants more than a view to a session must not rely
  on an ERC-1271 sign-in alone.

## Layered sign-in limits

| Layer | What | Limit | On refusal |
|---|---|---|---|
| Edge | Cloudflare WAF rule "IMD API anti-flood" (URI path starts with `/api/`; widened from `/api/world/` on 2026-09-29; set in the dashboard, stated here, not read from Cloudflare) | 20 requests per 10 s per IP, block 10 s | edge block |
| L1 per network | challenges per IPv4 /24 or IPv6 /48 | 30 a minute | 429 `SIGN_IN_BUSY` |
| L1 per network | ERC-1271 claims (one `eth_getCode` each) | 10 a minute | 429 `CHAIN_BUSY` |
| L1 per network | ERC-1271 contract checks | 3 a minute | 429 `CHAIN_BUSY` |
| L2 per wallet | challenges for one address from one network | 5 a minute | 429 `SIGN_IN_BUSY` |
| L2 per wallet | one address from many networks | not blocked; from the 20th in a minute on, each challenge writes an `auth_surge` line | log only |
| L2 per contract | ERC-1271 contract checks per contract address (all networks) | 2 a minute | 429 `CHAIN_BUSY` |
| L3 per challenge | one-time nonce, 5-minute window, burnt on any failure; one ERC-1271 check | 1 | 401 / 409 / 410 |
| L4 per location | `AUTH_LIMITER` challenges per IP (IPv6 /64) | 20 a minute | 429, fails closed |
| L4 per location | `AUTH_LIMITER` verifies per IP (`verify:` keys) | 20 a minute | 429, fails closed |
| L4 per location | `API_LIMITER` key `chain:code` (`eth_getCode` of the ERC-1271 path) | 180 a minute | 429, fails closed |
| L4 per location | `CHAIN_LIMITER` keys `chain:erc1271` / `chain:erc1271:known` (`eth_call`) | 20 a minute each | 429, fails closed |
| L5 global | challenge valve, emergency ceiling only | 60 per 6 s (600 a minute) | 429 `SIGN_IN_BUSY` |

A missing limiter binding answers 503 on the routes that need it (off loopback). Logout and logout-all are never rate
limited. Every 429/503 of the account routes writes one JSON line (`evt`, `route`, `status`, `error`, `reason`,
`colo`, `net`, `walletType` when known). Workers Logs sample invocations at 0.2 (`wrangler.jsonc` observability), so
about one line in five is kept.

## Regression tests (remediation §7A)

| # | Requirement | Test file | Test name |
|---|---|---|---|
| 1 | F-1: a wrong domain, URI, chain or wallet never opens the signature prompt | `tests/wallet-client.test.mjs` | the page checks the sign-in message before the wallet sees it: the real server message passes, every altered one ends the flow unsigned |
| 2 | F-2: an invalid ERC-1271 answer refuses the sign-in | `tests/auth.test.mjs` | ERC-1271 smart wallets: magic value signs in, anything else is 401, no key is 503; ERC-6492 wrappers are 400 |
| 2 | F-2: an unavailable ERC-1271 path makes no session | `tests/auth.test.mjs` | F-2: each session records EOA/ECDSA or CONTRACT/ERC1271; every way the ERC-1271 path can be unavailable is refused and makes no session |
| 3 | F-3: junk signatures cannot quickly take down a location | `tests/auth.test.mjs` | F-3: a /24's garbage leaves its other wallets alone, fake addresses never reach the contract budget, returning smart wallets keep a budget of their own, EOAs never wait |
| 4 | F-4: logout-all ends the sessions on every device | `tests/auth.test.mjs` | logout-all: one browser ends every live session of its address on every device, and its open challenges; others are untouched |
| 4 | F-4: other tabs at once, other devices on their next request | `tests/wallet-client.test.mjs` | My wallet: “Log out this device” ends only this browser; “Log out all devices” asks inline, and only its confirm ends every device |
| 5 | F-5: one source cannot easily close sign-in for everyone | `tests/auth.test.mjs` | F-5: a challenge flood starves neither its own verify nor anyone else; the wallet cooldown binds only (address, network); every refusal and surge is one line without identifiers |
| 6 | a nonce is used once | `tests/auth.test.mjs` | challenge lifetime: expired 410, replayed 409, superseded 409, unknown 409 |
| 6 | a failed signature burns the challenge | `tests/auth.test.mjs` | any failed signature check burns the challenge: its own flow cannot retry it, so one challenge buys at most one ERC-1271 read |
| 7 | `/api/me/home` takes the wallet from the server session only | `tests/ownership.test.mjs` | /api/me/home answers for the session’s wallet only: an address in the query, a header or a body changes nothing |
| 7 | no session, no `/api/me` | `tests/auth.test.mjs` | only a session opens /api/me: a connected address, a forged cookie or a guessed token gets 401 |

`tests/review-record.test.mjs` checks that every test named here exists in that file. Each rule above was broken once
in the code to see its test fail, then restored.

## Deployment evidence (remediation §7B)

`node scripts/deploy-evidence.mjs deploy-records/<record>` writes `docs/security/deploy-evidence/<record>.md` from the
record `npm run deploy` leaves: source commit, record id, deploy time, Cloudflare Worker version id (when wrangler
printed one), Worker bundle SHA-256, the frontend JS/CSS/HTML SHA-256, the repository's migration files with their
SHA-256 (the remote applied list is filled in by hand from `wrangler d1 migrations list imd-world --remote`), the
limiter bindings (names, namespace ids, limits) and the WAF rule's description, marked as stated (the script does not
read Cloudflare), with its rule id filled in by hand. It copies no log text. Migration `0003_sign_in_layers.sql`
(additive) must be applied, after a backup, before this code is deployed: check that
`wrangler d1 migrations list imd-world --remote` lists it before `npm run deploy`, and sign in once on the live site
afterwards. Without it, sign-in answers a logged 503 `AUTH_UNAVAILABLE` and makes no session.

This round: backup export `pre0003` taken, `0003` applied on 2026-09-28 about 21:00 UTC and read back from `d1_migrations`
and `sqlite_master`, then `npm run deploy` (full suite passed) uploaded version `f9b68223`. Evidence page:
`docs/security/deploy-evidence/20260928T210413Z-1a0ba21.md`. [REDACTED-INTERNAL]

## Internal re-check of this round (2026-09-29, not a Swarm review)

- The known-smart-wallet lookup and logout-all's revocation read through two partial indexes added to `0003`
  (`sessions_erc1271`, `sessions_live`): an address's ECDSA or revoked sessions, however many, are never visited
  (`tests/auth.test.mjs` "the known-smart-wallet lookup and logout-all read through partial indexes…").
- A session write that fails for any reason but a UNIQUE race is a logged 503, not a silent 409 (`tests/auth.test.mjs`
  "deployed before migrations/0003…").
- The surge line is written for every challenge from the 20th on (sampled logs); the site's record says its statuses
  are the team's own and not re-reviewed; F-3 and F-5 residuals are stated as lasting while the traffic continues; the
  F-1 advice names the address bar and the wallet's request-origin warning; F-2 carries the report's "Low/Info".
- Test command: `node --test --test-name-pattern="partial indexes|before migrations/0003" tests/auth.test.mjs`;
  result: 2 tests, 2 pass, 0 fail. Whole suite (`npm test`) on this branch: 540 tests, 540 pass, 0 fail.

## Genesis Mint (not changed in this round)

Genesis Mint ([REDACTED]
[REDACTED]) was not in the review's scope and was not changed. A future design
note from the remediation document §8:

> 未來 Mint 如果沿用 World session，不應直接把 World 的登入 session 當成「使用者已授權 Mint」。Mint 仍需依 Mint 專項規格與審查決定是否需要獨立且明確的簽名／交易確認流程。

(If the Mint later reuses the World session, the World sign-in session must not be taken to mean "the user authorized
the Mint". Whether the Mint needs its own explicit signature or transaction confirmation is decided by the Mint's own
specification and review.)
