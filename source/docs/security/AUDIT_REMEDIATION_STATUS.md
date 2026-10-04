# IMD Ember World — audit remediation status

This page preserves earlier review/deployment history. The fifth Audit's four new Low findings and the latest local
World/Auth/M1 repairs are recorded in `R5_LOW_REMEDIATION.md`; these repairs are not deployed or independently closed.
Two test references below were updated when R5 replaced unconditional newer-session cleanup with conditional reconciliation.

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
| Deployment version | the remediation deployment of 2026-09-28: Worker version `f9b68223-19f7-4318-8274-294413b81965`, source `1a0ba21`, deployed 2026-09-28 21:05 UTC; evidence: `docs/security/deploy-evidence/20260928T210413Z-1a0ba21.md`. It is no longer the running version |
| Later deployments (the team's deployment record) | as the team's deploy records list them; the evidence pages were generated from those records on 2026-09-30 and nothing in them was read from Cloudflare or verified by a review: Worker `50c688c9`, source `2da46cd`, deployed 2026-09-29 05:05 UTC, the version both Swarm re-reviews named (its bundle SHA-256 in the record, `14584fe4…`, is the one the Report rebuilt from the snapshot); evidence: `docs/security/deploy-evidence/20260929T050441Z-2da46cd.md`. Then Worker `c89f5915`, source `5398b90` (`2da46cd` + `backlog-0929` up to `3f661eb` + `perf-0929`), deployed 2026-09-29 17:25 UTC, the running version as the team states it: it carries W-1..W-3, the undici pin `202da0b` and the removal of `SIWE_PREVIOUS_STATEMENTS` (`fc533e5`), and none of A-1..A-8; evidence: `docs/security/deploy-evidence/20260929T172429Z-5398b90.md` Then Worker `1a0dd495`, source `4321bb4` (`5398b90` + `backlog-0929` up to `3b21763` + `ui-0930` up to `188f575`), deployed 2026-09-29 19:54 UTC after D1 migration `0004_index_candidates.sql` was applied (a backup export was taken first); it carries the Swarm audit 519db624 fixes A-1..A-8 and the unofficial statement; evidence: `docs/security/deploy-evidence/20260929T195417Z-4321bb4.md`. Then Worker `6e7e40cd`, source `df8ea90` (a town re-layout with larger landmarks, cable car, boat stops, gentle weather and a new Guardian Hall; no sign-in or ownership change, no migration) was live from 2026-09-30 06:48 UTC until 09:27 UTC, when the owner had the site rolled back to `1a0dd495` (`wrangler rollback`); evidence of that deploy: `docs/security/deploy-evidence/20260930T064805Z-df8ea90.md`. Then Worker `cc5cddb3`, source `007ee80` (`132228c` = the `1a0dd495` source + gentler bad weather with a calm-sky switch, a 1.5x Pepe statue, the v002 Guardian Hall at 1.3x, three more ember-boat stops and a cable car, on the live layout with no home moved; no sign-in or ownership change, no migration; the Worker bundle SHA-256 is unchanged, `1018f02a…`), deployed 2026-09-30 14:53 UTC; evidence: `docs/security/deploy-evidence/20260930T145241Z-007ee80.md`. Then Worker `3e0f4eb3`, source `a77f91b` (`3776052` + a faster retry of the first failed world read, 5 s then 15 s, and "connecting" wording while that first load is on; client only, the Worker bundle SHA-256 unchanged, no migration), deployed 2026-09-30 15:48 UTC; evidence: `docs/security/deploy-evidence/20260930T154746Z-a77f91b.md`. Then Worker `5f9e6468`, source `41ae386` (`461c3a2` + the landmarks grown in place with no home moved: the Oracle Tower 1.5x, the Archive Hall 1.35x moved 4.1 m with the east road rerouted, the launch dais 1.35x landward, the forge and the Memory Gate 1.35x taller, the hall's crown, the longhouse 1.12x, the Guardian Hall back to 1.55x; client only, the Worker bundle SHA-256 unchanged, no migration), deployed 2026-09-30 18:58 UTC; evidence: `docs/security/deploy-evidence/20260930T185800Z-41ae386.md`. Then Worker `f152cd66`, source `0d57791` (`38cf3a4` + six cable-car cabins instead of three, the mill house by the Ember Forge removed and the forge grown 1.3x landward with a yard where the mill house stood; client only, the Worker bundle SHA-256 unchanged, no migration), deployed 2026-09-30 22:20 UTC; evidence: `docs/security/deploy-evidence/20260930T221950Z-0d57791.md`. Then Worker `bbf24001` (source `2e4e830`: `0d57791` plus the Swarm audit 8c3aea2e fixes N-1..N-7; D1 migration `0005_lanes_and_subnets.sql` applied first, at about 04:09 UTC after a backup export; the Worker bundle SHA-256 changed to `018df7b3…`), deployed 2026-10-01 04:10 UTC; evidence: `docs/security/deploy-evidence/20261001T040934Z-2e4e830.md`. Then Worker `d5f52483`, source `7da33f2` (`f4272c5` + the owner's market-weather tiers of 2026-10-01, a 1-hour shower only past −5 %, fireworks under a brilliant sky; front end only, the Worker bundle `018df7b3…` unchanged, no migration), deployed 2026-10-01 11:10 UTC; evidence: `docs/security/deploy-evidence/20261001T111020Z-7da33f2.md`. Then Worker `ef1a55fb`, source `9ad115a` (`956ace0` + three more ember-boat stops, 霜谷渡口 and the stops' boat shelters of 2026-10-01/02; front end only, the Worker bundle `018df7b3…` unchanged, no migration), deployed 2026-10-01 19:10 UTC; evidence: `docs/security/deploy-evidence/20261001T191028Z-9ad115a.md`. Then Worker `8269ae53`, source `9f069dd` (`cd02dc8` + a boat stop clicked as a cable car station is, and the forge's shelter in line with its stage; front end only, the Worker bundle `018df7b3…` unchanged, no migration), deployed 2026-10-02 04:01 UTC; evidence: `docs/security/deploy-evidence/20261002T040044Z-9f069dd.md`. Then Worker `63c6c7bd`, source `f36144a` (the fixes for the two reviews of Worker `bbf24001`, R3-R1 and AUD3-01..AUD3-08, on branch `audit4-fixes` with `f86be69` merged in; the Worker bundle `a7bb8087…`, no migration; a D1 export taken first), deployed 2026-10-02 06:08 UTC; evidence: `docs/security/deploy-evidence/20261002T060718Z-f36144a.md`. Then Worker `acdbb2bd`, source `ddb10e2` (`8308efa` + the member layer M1 of 2026-10-03: a Web2 member per signed-in wallet and its public player name, new routes in `server/member.ts` (`POST /api/me/bootstrap`, `GET`/`PUT /api/me/profile`, `GET /api/world/names/:address`) answered before `server/auth.ts`, which is unchanged; D1 migration `0006_members.sql` applied first, at about 00:49 UTC after a backup export; the Worker bundle `cf720c69…`; not reviewed by Swarm), deployed 2026-10-03 00:55 UTC; evidence: `docs/security/deploy-evidence/20261003T005417Z-ddb10e2.md`. The running version is `acdbb2bd`. |
| Re-review | two Swarm re-reviews of Worker `50c688c9` (source `2da46cd`, public snapshot `b6e986be`, Worker bundle SHA-256 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4` as the Report rebuilt it from the snapshot), both 2026-09-29 (UTC): Report `e48d0a96` (a retest; deployment match partial) and Audit `519db624` (no report file; deployment match not assessed). Neither verified the running Worker. Both are listed on the site since Worker `1a0dd495` (the team's deployment record); this version's changes were not re-reviewed. See "Swarm retest e48d0a96" and "Swarm audit 519db624" below |
| Later review | Swarm audit `8c3aea2e` (template Audit), judged 2026-09-30 13:45 UTC, of Worker `1a0dd495` (source `4321bb4`, public snapshot `ae1d41a`, Worker bundle SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c` as one of its reviewers rebuilt it from the snapshot, equal to the team's deploy record; no deployment-match verdict): 6 Low and 1 Info, N-1..N-7. Fixed in Worker `bbf24001` (source `2e4e830`, deployed 2026-10-01 04:10 UTC, after D1 migration 0005; fix commits `f65a900`, `11392d8`, `5261844`); these changes were not re-reviewed before that deploy, and the two Swarm reviews of 2026-10-01 then examined Worker `bbf24001` (next row). See "Swarm audit 8c3aea2e" below |
| Reviews of Worker bbf24001 | Swarm Report `dcf922ca` (template Report, a limited retest, completed 2026-10-01 08:54 UTC; deployment match partial) and Swarm audit `1ef8e8a6` (template Audit, judged 2026-10-01 09:15 UTC; no deployment-match verdict), both of Worker `bbf24001` (source `2e4e830`, public snapshot `8cad017`, Worker bundle SHA-256 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c` as the Report rebuilt it from the snapshot, equal to the team's deploy record): R3-R1 (Low; the Report's R-1) and AUD3-01..AUD3-08 (3 Low, 5 Info; the audit's #1..#8), plus AUD3-09, the audit's review record. Fixed in Worker `63c6c7bd` (source `f36144a`, deployed 2026-10-02 06:08 UTC, as the team's deployment record lists it), AUD3-02 and AUD3-05 only partly (fix commits `7ada277`, `0b8a286`, `6611189`, `f2db1f5`, `bd4f749` after the team's mutation check, `10bb630` after the team's final check, `f095642` after the team's re-check of that, `7b2d74d` after the team's review of that re-check's record, and `901420a` after the team's review of that; `main` merged in at `125248c` and at `f36144a`); these changes were not re-reviewed. See "Swarm reviews of Worker bbf24001" below |

This page records what changed after the review and what is still open. It does not vouch for this version: the
review applies to the reviewed version only, and the site says so ("Previous review — current version has changed").
The site's record (My wallet → Swarm Audit Record) and this page use the same data, `src/world/reviewRecord.ts`;
`tests/review-record.test.mjs` fails if the two disagree. The severities are the reviewers'; the statuses are the site
maintainer's own account of its changes, not the reviewers': the site heads them "Findings (from the review) · fix status as
reported by the site maintainer, not re-reviewed". Its "Re-review" row links the two re-reviews of Worker `50c688c9`, and
their findings follow under "Both re-reviews examined Worker 50c688c9, not this version; this version’s changes were not
re-reviewed. The findings below are the re-reviews’; their fix status is as reported by the site maintainer." Its
"Later review" row links Swarm audit 8c3aea2e of Worker `1a0dd495`, whose findings follow under "This review examined
Worker 1a0dd495, not this version; this version’s changes were not re-reviewed. The findings below are the review’s; their
fix status is as reported by the site maintainer." Its "Reviews of Worker bbf24001" row links Swarm Report dcf922ca and
Swarm audit 1ef8e8a6, whose findings follow under "Both reviews examined Worker bbf24001, not this version; this version’s
changes were not re-reviewed. The findings below are the reviews’; their fix status is as reported by the site maintainer."

Production facts on this page (which Worker version runs and when it was deployed, the D1 migrations applied remotely,
the limiter bindings and their namespaces, the WAF rule, the secrets such as `ALCHEMY_API_KEY`, and the log sampling) are
the site maintainer's deployment record. No review could read them and this page does not verify them. The future Mint is
outside all of this: see `docs/security/MINT_BOUNDARY.md`.

| Finding | Severity | Status on the site |
|---|---|---|
| F-1 | Medium (shared boundary) | Partly mitigated: this page checks the message before you sign and shows what you sign, but a phishing site can skip page checks — sign only when the address bar shows imdember.com; if your wallet says the request comes from another site or warns of a mismatch, reject. |
| F-2 | Low/Info | Partly addressed: sessions record the wallet type and check method, and an unavailable check always refuses; the contract’s own rules still decide who signs for it (open). |
| F-3 | Low (availability) | Improved: shares per network and per contract (once a contract’s 2 shared checks a minute are spent, each network still gets one while the location’s allowance for these lasts), and a code check before the smart-wallet budget; residual: many networks can still keep smart-wallet sign-in busy at one location (first-time wallets, returning ones, or one chosen address), and junk from a smart wallet’s own network can hold it, while the junk continues (partly open). |
| F-4 | Low | Fixed: “Log out all devices”. |
| F-5 | Low (availability) | Improved: layered limits, challenge and verify counted apart, part of the site-wide ceiling kept for networks that have not asked in the last minute; the ceiling stays as an emergency brake. Still: about 14 /24s at full rate plus about 200 other networks a minute can close new sign-ins site-wide while they keep going; browsing is unaffected (partly open). |
| F-6 | Info | Fixed: build tools updated; npm audit reported 0 on 2026-09-28. A later advisory in a dev-only tool (undici, moderate) was patched on 2026-09-29; npm audit reported 0 again that day. None of these ship with the site. |
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
  statement now reads "…This does not authorize asset transfers, token or NFT approvals, or transactions.". The release
  that changed it also verified a challenge issued with the previous wording, for the 5 minutes one could stay open
  across that deploy; that allowance (`SIWE_PREVIOUS_STATEMENTS`) was removed in `fc533e5` (2026-09-29; in Worker
  `c89f5915` as the team's deployment record lists it), so the server verifies only the current statement.
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
  until reloaded (nothing is signed). `SIWE_PREVIOUS_STATEMENTS` is gone since `c89f5915` (the team's deployment record).

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
  F-2), each costing gas and one first-time sign-in. In the deployed version two junk checks a minute, from anywhere,
  keep one contract address at 429 while they continue; in Worker `1a0dd495` (the team's deployment record; Swarm audit 519db624 A-1)
  junk from a few other networks no longer does: once the address's 2 shared checks are spent, each network still gets
  one check of it a minute on its own key `chain:erc1271:lane` (20 a minute per location). This is an improvement, not a
  fix: the address is still held by junk from the owner's own /24 (or /48), logged with reason `address`, or by at least
  9 /24s aimed at at least 3 addresses every minute, which keep `chain:erc1271:lane` closed at one location (logged
  with reason `budget_lane`); a returning smart wallet is held that way too. Since `bbf24001` (Swarm audit
  8c3aea2e N-4 and N-5) the owner's own earlier check no longer uses up its network's lane, so a retry or
  a second device gets through, and IPv6 counts nest: a /48 has twice a /24's shares and two lanes per address, from two
  of its /64s, each /64 at most one /24's; junk from the owner's own network there means its /64 or two other /64s of its
  /48, and closing `chain:erc1271:lane` with IPv6 takes at least 5 /48s using two /64s each, at at least 2 addresses.

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
- **Result:** 12 tests, 12 pass, 0 fail on 2026-09-30 (includes the logout-all index test of the internal re-check below,
  and since `c139bae` "visibility-refresh-clears-stale-owner…", which a "Log out all devices" elsewhere starts; 11 before
  it).
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** another device learns of it on its next signed-in request, not by push. "Log out all devices"
  from a browser whose own session already ended cannot act for the address; the page says so.

## F-5 — about 20 networks can close sign-in site-wide

- **Finding:** the global challenge valve (60 per 6 s) could be held shut by about 20 /24s at their full share.
- **Old behavior:** challenge and verify shared one per-IP key; no per-wallet layer; refusals were not logged.
- **Fix:** limits in layers (table below); challenge and verify have separate per-IP keys (the per-(address, network)
  cooldown was removed after the Swarm audit, A-6, on `backlog-0929`); an audit line when one address is asked for from
  many networks; one JSON log line per 429/503 whose only client details are an IP-derived network key (IPv4 /24, IPv6
  /48) and, on surge lines, a 6-character address prefix; no full IP, full address, cookie, message or nonce. The global
  valve stays as the emergency ceiling only; on `backlog-0929` 20 of its 60 per 6 s are kept for networks that have not
  asked in the last minute (A-7).
- **Files changed:** `server/auth.ts`, `server/world-api.ts`, `worker/app.ts`, `migrations/0003_sign_in_layers.sql`,
  `wrangler.jsonc` (comments), `docs/wallet-login/DESIGN_W1_v001.md`, `README.md`.
- **Tests added:** `tests/auth.test.mjs` "F-5: a challenge flood starves neither its own verify nor anyone else…",
  "challenge budgets…" (updated).
- **Test command:** `node --test --test-name-pattern="F-5|challenge budgets|rate limits|logout is never rate limited" tests/auth.test.mjs`
- **Result:** 4 tests, 4 pass, 0 fail.
- **Deployment version:** f9b68223 (source 1a0ba21, deployed 2026-09-28 21:05 UTC).
- **Residual risk:** in the deployed version about 20 /24s at their full share can close new sign-ins site-wide while
  they keep going. In Worker `1a0dd495` (the team's deployment record; Swarm audit 519db624 A-7) 20 of the 60 challenges per 6 s are
  kept for networks that have not asked in the last minute: such a network gets its first challenge unless, on top of
  14 /24s at their full share, at least 200 other networks a minute each ask once, timed to refill the valve (at
  least 214 networks and at least 220 IPs; IPv6 /48s are cheaper to hold than IPv4 /24s, as for every per-network
  limit: since `bbf24001`, Swarm audit 8c3aea2e N-5, a /48 has twice a /24's share, so 7 /48s at full share do
  what 14 /24s do). Networks that already asked within the minute share the other 40, which 14 /24s at full share can keep full
  (before: 20 /24s, for everyone), so under such an attack a player whose first challenge was issued waits the minute
  for a second one; a refused request writes nothing, so it does not use up the first. There is no per-wallet cooldown
  any more (A-6), so a neighbour's challenges for an address never refuse its key holder; still, two IPs in one /24 can
  spend that network's 30 challenges a minute (an IPv6 /48: 30 before N-5, 60 since `bbf24001`, which three of its /64s
  can spend), and every player there waits for the minute. The D1 budgets see only the network key, by design (no full
  IP is stored), so they cannot tell hosts in one /24 apart; since `bbf24001` an IPv6 challenge row also keeps the /64
  that asked (N-5), so the ERC-1271 counts tell a /48's /64s apart, never its hosts. All
  of this is sign-in only; browsing and existing sessions are unaffected. The edge WAF rule (below) is the first guard.
  The log lines are sampled (Workers Logs keep about 0.2 of invocations), so monitoring reads counts as about 1/5 of the
  real number, and a surge writes a line for every challenge from the 20th on so it is not lost.

## F-6 — known advisories in build tools

- **Finding:** `npm audit`: 1 low, 4 high, all in build/dev tools reached through wrangler (esbuild's Windows dev
  server, sharp/libvips, undici); none in the deployed bundle (`npm audit --omit=dev`: 0).
- **Old behavior:** wrangler 4.92.0.
- **Fix:** wrangler 4.143.0 (same major; esbuild 0.28.1, miniflare 5.20260926.0-alpha, workerd 1.20260926.1).
  `compatibility_date` unchanged, so production semantics do not move. The Worker bundle still builds; its only change
  is esbuild's module-init helper, so the bundle hash differs from the reviewed one.
  Follow-up, 2026-09-29 (`202da0b`; in the build of Worker `c89f5915`, the team's deployment record): a new advisory appeared after that deploy,
  GHSA-3wwx-pv8p-q78v (undici 7.28.0–7.29.0, moderate: a WebSocket permessage-deflate error can crash the process),
  reached as wrangler → miniflare → undici 7.29.0; 3 moderate in `npm audit`, 0 with `--omit=dev`. No wrangler release
  carries a fixed undici yet (4.143.0 is the latest; `npm audit fix --force` would go back to wrangler 4.101.0), so
  `package.json` overrides undici to 7.29.1 (a patch release of the same line). The built Worker (`wrangler deploy
  --dry-run`) is byte-identical with undici 7.29.0 and 7.29.1: undici is a tool dependency, not part of the bundle.
- **Files changed:** `package.json`, `package-lock.json`, `wrangler.jsonc` (comment); follow-up: `package.json`
  (`overrides.undici`), `package-lock.json`.
- **Tests added:** none for the 2026-09-28 update (tooling); follow-up: `tests/dependencies.test.mjs` fails if the
  lockfile's undici is in the advisory's range, and fails once no dependency pins a vulnerable undici any more (then
  the exact override is removed, so it never holds a newer undici back).
- **Test command:** `npm audit`, `npm test`, `npm run build`
- **Result:** `npm audit`: found 0 vulnerabilities; `npm test`: all pass; `npm run build`: passes. Follow-up run of
  2026-09-29: `npm audit` and `npm audit --omit=dev`: found 0 vulnerabilities; `npm test`, `npm run build` and
  `wrangler deploy --dry-run` pass. Re-run 2026-09-29 18:51 UTC on `backlog-0929` (npm 11.17.0, Node 24.19.0): `npm audit`
  and `npm audit --omit=dev` both found 0 vulnerabilities (0 info, low, moderate, high and critical; 19 production and 141
  development dependencies), so the site's F-6 line still holds. Again at 19:44 UTC, after the review fixes: both 0.
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
- The recorded type and method are not ownership proof and `/api/auth/session` does not return them. AUD4 now uses
  both fields to permit persistent Member M1 writes only for `EOA`/`ECDSA`; contract or unknown types fail closed.
  Seat ownership is always proved with `ownerOf` on Ethereum mainnet.
- **Risk (F-2, stated, not fixed):** the contract decides who may sign for it. A contract that accepts any signature
  (some vaults, escrows, badly written wallets) lets anyone sign in as it, and if it holds a seat, anyone gets owner
  mode for that seat (today a read-only view on the player's own screen). The `CONTRACT` mark makes such sessions
  visible in D1; it does not reduce that login/view risk. AUD4 prevents expansion into public M1 profile writes by
  temporarily disabling them for contract sessions. EOA sessions do support selected persistent M1 writes, so World
  sessions as a whole are not read-only. See `AUD4_MEMBER_POLICY.md` and `MINT_BOUNDARY.md` for the enforced policy.

## Layered sign-in limits

| Layer | What | Limit | On refusal |
|---|---|---|---|
| Edge | Cloudflare WAF rule "IMD API anti-flood" (URI path starts with `/api/`; widened from `/api/world/` on 2026-09-29; set in the dashboard, stated here, not read from Cloudflare) | 20 requests per 10 s per IP, block 10 s | edge block |
| L1 per network | challenges per IPv4 /24 or IPv6 /48 (a /48 twice a /24's share since `bbf24001`, N-5) | 30 a minute (IPv6 /48: 60) | 429 `SIGN_IN_BUSY` |
| L1 per network | ERC-1271 claims (one `eth_getCode` each) | 10 a minute (IPv6 /48: 20) | 429 `CHAIN_BUSY` |
| L1 per network | ERC-1271 contract checks | 3 a minute (IPv6 /48: 6) | 429 `CHAIN_BUSY` |
| L1 per subscriber | IPv6 only: each /64 of a /48, counted by the /64 that asked for the challenge, whoever sends the verify (`bbf24001`, N-5); its challenges: L4 | ERC-1271 claims 10 and contract checks 3 a minute | 429 `CHAIN_BUSY` |
| L2 per wallet | one address from many networks | not blocked; from the 20th in a minute on, each challenge writes an `auth_surge` line | log only |
| L2 per contract | ERC-1271 contract checks per contract address (all networks) | 2 a minute | 429 `CHAIN_BUSY` |
| L2 per contract | once a contract's 2 are spent: one check of it per network (its own key, below; `backlog-0929`, A-1); only lane checks use it up, and a /24 (IPv6 /64) that made both shared checks itself takes none (`bbf24001`, N-4) | 1 a minute (IPv6 /48: 2, from two /64s) | 429 `CHAIN_BUSY` |
| L3 per challenge | one-time nonce, 5-minute window, burnt on any failure; one ERC-1271 check | 1 | 401 / 409 / 410 |
| L4 per location | `AUTH_LIMITER` challenges per IP (IPv6 /64) | 20 a minute | 429, fails closed |
| L4 per location | `AUTH_LIMITER` verifies per IP (`verify:` keys) | 20 a minute | 429, fails closed |
| L4 per location | `API_LIMITER` key `chain:code` (`eth_getCode` of the ERC-1271 path) | 180 a minute | 429, fails closed |
| L4 per location | `CHAIN_LIMITER` keys `chain:erc1271` / `chain:erc1271:known` / `chain:erc1271:lane` (`eth_call`) | 20 a minute each | 429, fails closed; the D1 claim of a check the key refused (no `eth_call` sent) is released, the challenge still burnt (AUD3-03, since `63c6c7bd`) |
| L5 global | challenge valve, emergency ceiling only; 20 of every 60 only for a network with no challenge in the last minute (`backlog-0929`, A-7) | 60 per 6 s (600 a minute) | 429 `SIGN_IN_BUSY` |
| House read | an NFT-index read `chain:index` refused whose answer counts no seat: its network's discovery lane, counted in D1 (`index_lanes`), then `CHAIN_LIMITER` key `chain:index:lane` (`bbf24001`, N-6) | 1 a minute per IPv4 /24 (IPv6 /48: 2, one per /64); 60 per 6 s site-wide; the key 20 a minute per location | the read stays `limited` (could not check); the key fails closed; a claim the key refused is released (out of the site-wide count at once, its network may claim again after 30 s; at most 20 releases per 6 s site-wide, past that it holds its network for the minute and the site-wide count for its 6 s slice (partly open: about 80 claims in one 6 s slice at one location still fill the site-wide ceiling); AUD3-02, since `63c6c7bd`); a lane read that fails keeps the request's first proof, `limited` (AUD3-01, since `63c6c7bd`) |

A missing limiter binding answers 503 on the routes that need it (off loopback). Logout and logout-all are never rate
limited. Every 429/503 of the account routes writes one JSON line (`evt`, `route`, `status`, `error`, `reason`,
`colo`, `net`, `walletType` when known); a surge line has `evt`, `route`, `reason`, `addr`, `colo`, `net`; a claim kept
counted after its key refused it (AUD3-02, AUD3-03; since `63c6c7bd`) writes one `index_lane_kept` or `erc1271_claim_kept`
line with `evt`, `route`, `reason`, `colo`, `net`. About the client they carry exactly `net`, a key derived from its IP
(IPv4 /24 `net:a.b.c.0/24`, IPv6 /48 `net6:x:y:z::/48`, `net:unknown` without one or, since AUD3-08 (`63c6c7bd`), for
text that is not a client address), and on surge lines `addr`, the address's first 6 characters (`0x` and 4 hex
digits); never a full IP or full address. Workers Logs sample invocations at 0.2 (`wrangler.jsonc` observability), so
about one line in five is kept. Since `bbf24001` (N-5) an IPv6 challenge row also keeps the /64 prefix that asked
for it (`net6:x:y:z:w::/64`, never the host bits, never in a log line) for the row's life: about 25 minutes unused,
about a day used.

## Regression tests (remediation §7A)

| # | Requirement | Test file | Test name |
|---|---|---|---|
| 1 | F-1: a wrong domain, URI, chain or wallet never opens the signature prompt | `tests/wallet-client.test.mjs` | the page checks the sign-in message before the wallet sees it: the real server message passes, every altered one ends the flow unsigned |
| 2 | F-2: an invalid ERC-1271 answer refuses the sign-in | `tests/auth.test.mjs` | ERC-1271 smart wallets: magic value signs in, anything else is 401, no key is 503; ERC-6492 wrappers are 400 |
| 2 | F-2: an unavailable ERC-1271 path makes no session | `tests/auth.test.mjs` | F-2: each session records EOA/ECDSA or CONTRACT/ERC1271; every way the ERC-1271 path can be unavailable is refused and makes no session |
| 3 | F-3: junk signatures cannot quickly take down a location | `tests/auth.test.mjs` | F-3: a /24's garbage leaves its other wallets alone, fake addresses never reach the contract budget, returning smart wallets keep a budget of their own, EOAs never wait |
| 4 | F-4: logout-all ends the sessions on every device | `tests/auth.test.mjs` | logout-all: one browser ends every live session of its address on every device, and its open challenges; others are untouched |
| 4 | F-4: other tabs at once, other devices on their next request | `tests/wallet-client.test.mjs` | My wallet: “Log out this device” ends only this browser; “Log out all devices” asks inline, and only its confirm ends every device |
| 5 | F-5: one source cannot easily close sign-in for everyone | `tests/auth.test.mjs` | F-5: a challenge flood starves neither its own verify nor anyone else; no neighbour can refuse a player's challenges; every refusal and surge is one line whose only client details are a network key and, on surges, a 6-character address prefix |
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

Worker `bbf24001` (Swarm audit 8c3aea2e; source `2e4e830`, deployed 2026-10-01 04:10 UTC) adds `migrations/0005_lanes_and_subnets.sql` (additive:
`login_challenges.sub` and `login_challenges.called_via`, table `index_lanes` with two indexes) and one constant key in
the existing `CHAIN_LIMITER` binding, `chain:index:lane`; no binding is added, so there are still four. `0005` was
applied on 2026-10-01 at about 04:09 UTC, after a backup export and before the deploy (`wrangler d1 migrations apply imd-world --remote`;
`wrangler d1 migrations list imd-world --remote` then answered "No migrations to apply", and the table and both columns were read back); code deployed ahead of it keeps the 0004 rules, takes no
index lane and never answers 503 for it (`tests/auth.test.mjs` "N-5 (deployed ahead of 0005)…",
`tests/ownership.test.mjs` "N-6 (deployed ahead of 0005)…", `tests/presence.test.mjs` "0005 is additive…"). An evidence
page lists the migrations and the limiter keys of its own commit, so the evidence page of `2e4e830` names both
(`tests/deploy-evidence.test.mjs`).

The fixes for the two reviews of Worker `bbf24001` (R3-R1, AUD3-01..AUD3-08; Worker `63c6c7bd`) need no migration,
no binding and no new limiter key: their statements use the `0004` and `0005` tables as they are (`RETURNING rowid`,
conditional updates), and code deployed ahead of `0005` keeps the `0004` rules as before. They were deployed in
`63c6c7bd` (2026-10-02 06:08 UTC) after a D1 export, with no migration applied.

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

## Swarm retest e48d0a96 (2026-09-29)

A limited Swarm retest, job https://explorer.imd.fun/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad, 2026-09-29 15:00–15:12
UTC, of the public review snapshot `b6e986be` and the live front-end files; the Worker then running (`50c688c9`, source
`2da46cd`), D1, the limiter bindings, the WAF rule and the log sampling were the team's statements, not verified by it,
and no real wallet was tested. Its report is https://github.com/Identity-md/research/blob/main/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad/files/artifacts/report.md
(in Chinese). It rebuilt the Worker bundle from the snapshot (SHA-256
`14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4`, as the team's deploy record lists it) and rated
the deployment match partial. The retest says itself that it gives no overall verdict on the site. It found no path
to a transfer, an approval, a transaction or an EOA session without that EOA's signature. Its verdicts, in its words
shortened:

- F-1: partly improved; the relay is not fixed (a relayed signature of a real challenge still got a 7-day session).
- F-2: the recorded fields and fail-closed refusals hold; a JSON-RPC error from `eth_call` was 401, not 503 (W-3); a
  contract that accepts any signature still signs in as itself.
- F-3: the old junk-signature path is fixed (EOA junk never reaches `chain:erc1271`); the residual stands, and the
  thresholds are local results, not hard guarantees at the edge (per-location, eventually consistent limiters).
- F-4: fixed; other devices learn of logout-all only at their next request.
- F-5: the layers are in place and the site-wide residual stands; "no IP" in the log wording was imprecise (W-2).
- F-6: partly; on the retest's day `npm audit` was 3 moderate (undici via wrangler's dev tooling), 0 with
  `--omit=dev`, while the site's record said 0. The pin in `202da0b` is in the build of Worker `c89f5915` (the team's
  deployment record); `npm audit` was 0 again on 2026-09-29 (also at 18:51 UTC, with and without `--omit=dev`).
- F-7: (a) fixed; (b)–(e) remain as stated.
- F-8: unchanged; the same-origin boundary remains.

Its three new observations, all Info, and their state: their fixes are in Worker `c89f5915` (source `5398b90`, deployed
2026-09-29 17:25 UTC), as the team's deployment record lists it; not re-reviewed. "Status on the site" is the site's line
word for word (`src/world/reviewRecord.ts`), the site maintainer's own account, not re-reviewed:

| Finding | Severity | Status on the site | Fix commit | Test (`npm test`) | State |
|---|---|---|---|---|---|
| W-1 | Info | Fixed in this version: owner mode, the move and the Enter press compare the session’s expiry with this device’s clock. Still: a “Log out all devices” elsewhere reaches this page on its next read. | `84b9127`, `3f661eb` | `tests/wallet-client.test.mjs` "W-1: …", `tests/home-entry.test.mjs` "W-1: …" | deployed in `c89f5915` (the team's deployment record) |
| W-2 | Info | Fixed in this version (wording): the logs carry a network key derived from the IP (IPv4 /24, IPv6 /48) and, on surge lines, a 6-character address prefix; the logs are unchanged. | `7202bdd` | `tests/auth.test.mjs` "W-2: …" | deployed in `c89f5915` (the team's deployment record) |
| W-3 | Info | Fixed in this version: a node failure is 503 (can’t check now); only a revert, an EVM halt the contract causes or a wrong answer is a bad signature (401). Either way the challenge is burnt and no session is made. | `8283c81`, `3f661eb` | `tests/auth.test.mjs` "W-3: …" | deployed in `c89f5915` (the team's deployment record) |

- **W-1** (an expired session still counted as owner for a local move, localStorage only): owner status, the move gate
  and the move compare the session's `expiresAt` with this device's clock, and the Enter press re-checks it at the press
  (`enterAtPress`, `3f661eb`); the client ends the session at its expiry and re-reads the server when the tab is shown
  again (at most once per 15 s); a remote logout-all still reaches this page only on its next read. Owner mode is
  revalidated, not live (DESIGN_W1 §9): `ownerOf` is cached at most 30 s on the server, and the page re-checks every 60 s
  while visible, on focus, when My wallet opens and when the tab is shown again, so until the next successful re-check it
  may show a sale, or a logout-all on another device, late; a hidden tab stays as it was until shown.
- **W-2** (the refusal logs were described as having "no IP"): wording only, logs unchanged: they carry an IP-derived
  network key (IPv4 /24, IPv6 /48) and, on surge lines, a 6-character address prefix.
- **W-3** (a JSON-RPC error from a contract wallet's `eth_call` was 401 `SIGNATURE_INVALID`): only a revert (code 3, or
  -32000 "execution reverted") or a non-magic answer is 401, and so are the EVM halts a contract causes (`3f661eb`:
  -32000 "out of gas", "invalid opcode", "invalid jump destination", "stack underflow/overflow/limit reached", "write
  protection", "return data out of bounds"); any other JSON-RPC error, a transport or HTTP failure or a malformed reply
  is 503 `VERIFY_UNAVAILABLE`, the challenge burnt, no session.

## Swarm audit 519db624 (2026-09-29)

A Swarm audit (template Audit, five seats: four specialists and a judge, all accepted), job
https://explorer.imd.fun/jobs/519db624-a82f-4dfe-91b9-1a519d1d3dd1, 2026-09-29 14:54–15:24 UTC, of the public review
snapshot `b6e986be`, the source of the Worker then running, `50c688c9` (`2da46cd`); no report file was published for it, so
the job page is its record, and it gave no deployment-match verdict. Its judge recorded 8 deduplicated findings, each
reproduced against the Worker handler with real migrations on SQLite: 1 Medium and 7 Low, all availability or display.
It found no asset-transfer path (no approval, no transaction) and no session-forgery or ownership-forgery path; it
agreed that a relayed real signature (F-1) and a contract that accepts any signature (F-2) are limits of SIWE itself.
It did not verify the live deployment, the Cloudflare bindings, WAF or upload handling, real wallets or browsers, the
production RPC, the front-end code not in the snapshot, or a Worker rebuild. It is a record of that version's review,
not a statement about this version.

"Status on the site" is the site's line word for word (`src/world/reviewRecord.ts`): the site maintainer's own account of
this version, not re-reviewed. The fixes are in Worker `1a0dd495`, as the team's deployment record lists it; the lines of
A-1 and A-6 also name what N-4 and N-5 (Swarm audit 8c3aea2e, below) change in Worker `bbf24001` (the team's deployment record).

| Finding | Severity | Status on the site | Fix commit | Test (`npm test`) | State |
|---|---|---|---|---|---|
| A-1 | Medium (availability) | Improved in this version: junk from a few other networks no longer holds a smart wallet — once its 2 shared checks a minute are spent, each network still gets one check of it a minute (an IPv6 /48 two, from two of its /64s), which the owner’s own earlier attempt doesn’t use up, while the location’s 20 such checks a minute last. Still: junk from the wallet’s own /24 (or /48) can hold it, and so can at least 9 /24s aimed at 3 or more addresses every minute at one location (partly open). | `1307b87` | `tests/auth.test.mjs` "A-1: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-2 | Low (availability) | Fixed in this version: a refused or failed index read falls back to the last index answer, now kept in the database so every server instance has it, and ownerOf proves those seats again. Still: a seat bought after both IMD’s roster and the index last listed it appears on a later check, and an answer is kept for 8 days. | `84a3a50`, `878799c`, `29cf00e` | `tests/ownership.test.mjs` "A-2: …", `tests/presence.test.mjs` "A-2: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-3 | Low | Fixed in this version: an older house read is dropped after its body arrives too, so it can’t undo a newer answer. | `4ca6acc` | `tests/wallet-client.test.mjs` "A-3: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-4 | Low (availability) | Fixed in this version: past the 256-candidate cap, seats that can count are checked first, and a cut list is marked as incomplete, never shown as a complete answer. Still: seats past the cap are not listed. | `ca35ba4`, `54c44f3`, `9e27e5b` | `tests/ownership.test.mjs` "A-4: …", `tests/wallet-client.test.mjs` "A-4: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-5 | Low (availability) | Fixed in this version: sign-in counts are dated when the request body has arrived. Still: the per-IP limit is asked when a request starts, so one IP can finish several minutes’ worth of slow requests together; what they cost stays within the per-network shares. | `3b351e2` | `tests/auth.test.mjs` "A-5: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-6 | Low (availability) | Partly fixed in this version: there is no per-wallet cooldown, so a neighbour’s challenges never refuse a player’s own. Still: two IPs in one /24 can spend that network’s 30 challenges a minute (an IPv6 /48 has 60, which three of its /64s can spend), and every player there waits the minute; sign-in only (partly open). | `bd47d2f` | `tests/auth.test.mjs` "A-6: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-7 | Low (availability) | Improved in this version: 20 of every 60 challenges per 6 s are kept for networks that have not asked in the last minute. Still: 14 /24s at full rate plus about 200 other networks a minute can close new sign-ins while they keep going; browsing is unaffected (partly open). | `bd47d2f` | `tests/auth.test.mjs` "A-7: …" | deployed in `1a0dd495` (the team's deployment record) |
| A-8 | Low | Fixed in this version: when the check could not be completed, the page says so and asks to try again later; it no longer says the chain was checked and the wallet holds no seat. | `34b97b3`, `04de387` | `tests/wallet-client.test.mjs` "A-8: …" | deployed in `1a0dd495` (the team's deployment record) |

Each finding below gives the old behavior, the new behavior, the abuse that no longer works, what remains, the files
changed and the tests that show it (Codex remediation plan §14 A and D). Each heading ends with the site's label for it
(`src/world/reviewRecord.ts`; `tests/review-record.test.mjs` checks both). Docs changed with them: `README.md`,
`docs/wallet-login/DESIGN_W1_v001.md`, this page and the site's record.

### A-1 — Two junk checks a minute could keep a chosen smart wallet from signing in · Improved (partly open)

- **Old behavior:** a contract address's 2 checks a minute were shared by every network and charged before the signature
  was known, so two junk verifies a minute from anywhere held a chosen smart wallet's sign-in at 429 (the F-3 residual).
- **New behavior:** once the address's 2 shared checks are spent, the challenge's own network still gets one check of it a
  minute, within its 3, on its own per-location key `chain:erc1271:lane` (20 a minute), never the two shared keys, so those
  still see at most 2 checks per address a minute.
- **Abuse prevented:** junk from a few other networks (the audit's case: one /24, two verifies a minute) no longer holds a
  smart wallet whose owner signs in from another network, first-time or returning.
- **Remaining trade-off:** improved, not fixed. Junk from the owner's own /24 (or /48) holds it (logged: `address`), and so
  do at least 9 /24s aimed at at least 3 addresses every minute, which keep `chain:erc1271:lane` closed at one location
  (logged: `budget_lane`); 8 such /24s, or 9 aimed at 2 addresses, do not (both run in the tests). Since
  `bbf24001` (N-4, N-5) only lane checks use the lane up, so the owner's own earlier check leaves it
  for a retry or a second device, and an IPv6 /48 has two lanes per address, from two of its /64s: there the own-network
  junk is from the owner's /64 or two other /64s of its /48, and the siege takes at least 5 /48s using two /64s each.
- **Files changed:** `server/auth.ts`, `wrangler.jsonc` (comment), `scripts/deploy-evidence.mjs` (the new key; since
  `7c49317` an evidence page lists the keys of its own commit).
- **Tests:** `tests/auth.test.mjs` "A-1: garbage from a few other networks no longer holds a chosen smart wallet…", "A-1:
  the residual at its stated cost…"; the shares themselves: "ERC-1271 shares…", "F-3: a /24's garbage leaves its other
  wallets alone…".

### A-2 — A refused index read dropped the stored seat list, so a newly bought seat left the house · Fixed

- **Old behavior:** `Cache.get` replaced an expired entry before loading and deleted it when the load failed, so a refused
  `chain:index` read left no stored index answer, and a seat only the index named (bought after IMD's roster last listed
  it) dropped out of the house: no seats, `recheck: 'limited'`.
- **New behavior:** a failed reload puts back the last good value with its own age, and every successful index read also
  keeps its answer in D1 (`migrations/0004_index_candidates.sql`, table `index_candidates`: one upsert of at most 256 ids
  ranked as in A-4, never over a newer answer; an answer naming no seat deletes the row, so a throwaway address writes
  nothing). An answer is dated when its index read began, not when its request did (since `29cf00e`: a request held
  before its index read dated its later answer before one read meanwhile, and the older one was kept). It is read only
  when an index read is refused or fails; the newer of it and the instance's own answer names the candidates, which
  `ownerOf` proves as always (`recheck: 'limited'`). A failed index read now falls back the same way when an answer is
  kept; with none it is still 503. The cron deletes answers read more than 8 days ago (a day past a session's 7). No
  ownership proof is reused past its 30 s.
- **Abuse prevented:** spending a location's `chain:index` budget (20 throwaway sign-ins a minute) no longer takes a real
  owner's newly bought seat out of the house, on any server instance.
- **Remaining trade-off:** a seat bought after both IMD's roster and the index last listed it appears on a later check
  (since `bbf24001`, N-6: a refused read that counts no seat takes its network's discovery lane,
  so one network spending `chain:index` no longer hides such a seat; 20 other networks taking their lanes at the
  location still do); an owner whose last index read is more than 8 days old has only the roster while the index is refused; another instance
  sees a new answer once its D1 write (after the reply) has landed. The migration is additive and must be applied before
  this code is deployed (`wrangler d1 migrations apply imd-world --remote`, after a backup export); a deploy ahead of it
  keeps the per-instance answer only, and neither the house read nor the cron fails for it (tested).
- **Files changed:** `server/ownership.ts`, `server/presence.ts` (the cron's prune), `migrations/0004_index_candidates.sql`,
  `server/auth.ts` (the clock for the index read's date, and the D1 cost comment).
- **Tests:** `tests/ownership.test.mjs` "A-2: a refused index reload keeps the last index answer as candidates…", "A-2:
  another server instance…", "A-2: a kept index answer is dated when its index read began…", "deployed before
  migrations/0004…"; `tests/presence.test.mjs` "A-2: the cron deletes index answers read more than 8 days ago…".

### A-3 — An older house read could restore owner mode after a newer one ended it · Fixed

- **Old behavior:** two overlapping house reads of one session share `gen`, and only the response's arrival was compared
  with the newer read, so an older answer whose body came last restored owner mode, the Enter gate and the local move after
  a sale.
- **New behavior:** both generations (`gen` and `homeGen`) are checked after every await that precedes a state change, the
  JSON body and the error body included; an account switch and both log-outs bump `gen`.
- **Abuse prevented:** a slow or held older answer can no longer undo a newer one: not a sale, not a recovery, not an
  account switch or a log-out.
- **Remaining trade-off:** none known.
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "A-3: an older house read whose body arrives after a newer answer is dropped…"
  (a sale, a recovery, a body that fails, and an account switch and both log-outs while the older body is held).

### A-4 — Past 256 candidate seats, the only seat that counts could be left unchecked · Fixed

- **Old behavior:** the 256-candidate cap cut by token id before any eligibility check and said nothing, so one more low-id
  seat sent to a large holder pushed the only counting seat out, and the answer read as a complete "no house".
- **New behavior:** candidates are ranked before the cap (seats whose agent the live roster shows online, then other
  registered ones, then the rest, each by id); a cut list is `recheck: 'partial'` in `/api/me/home`, never a complete
  answer, and so (since `54c44f3`) is an index read that stopped at its 5-page cap with pages left. My wallet's note for
  `partial` names both causes (since `9e27e5b`; it said "more seats than one check covers (256)", also to an owner of
  two). The cost stays at most 256 `ownerOf` in two `eth_call`s.
- **Abuse prevented:** sending a holder unregistered seats no longer hides its counting seat, and a cut or stopped list is
  never shown as a checked "no seat" (A-8).
- **Remaining trade-off:** seats past the cap are not listed, nor counted when more than 256 could count. The rank used
  the live roster only, so a seat that counted through its owner's sighting in the last 24 hours ranked with the seats
  that cannot count (N-3); since `bbf24001` the cut follows the counting rule itself.
- **Files changed:** `server/ownership.ts`, `src/world/auth.ts` (comment), `src/world/walletView.ts` (the `partial` note).
- **Tests:** `tests/ownership.test.mjs` "A-4: past the 256-candidate cap…", "A-4: under the cap a read is complete…" (100,
  256, 257, 258, 301 and 600 candidates, and an index stopped at its page cap), "one address: ownership is read once per
  30 s…" (230 candidates, a complete answer); `tests/wallet-client.test.mjs` "A-4: on the page, a read the NFT index cut
  short at its page cap…" (My wallet's note for it).

### A-5 — Slow request bodies dated smart-wallet checks into earlier minutes · Fixed

- **Old behavior:** the clock was read when the request began, so challenge and verify bodies held open and finished
  together dated their D1 counts into earlier minutes, past the per-minute shares, and a verify begun before its
  challenge's end passed the expiry check.
- **New behavior:** challenge and verify read the clock once the body has arrived, and the contract check again after its
  code read.
- **Abuse prevented:** holding bodies open no longer multiplies the per-minute contract checks (3 per /24, 2 per address)
  or the challenge shares, and a verify that finishes after its challenge's 5 minutes is 410 with no chain read.
- **Remaining trade-off:** the per-IP limiter (`AUTH_LIMITER`) is asked when the request starts, so one IP can hold bodies
  open and finish several minutes' worth together; what they cost stays bounded by the D1 shares, counted when they arrive.
  Cloudflare's own handling of slow uploads was not checked.
- **Files changed:** `server/auth.ts`.
- **Tests:** `tests/auth.test.mjs` "A-5: a challenge or verify whose body arrives late is counted when it arrives…".

### A-6 — A network neighbour could spend a player’s sign-in allowance · Partly fixed (partly open)

- **Old behavior:** the per-(address, network) cooldown, 5 challenges a minute, counted every challenge naming the address
  from the /24, whoever asked; and two IPs of one /24 fill its 30 a minute.
- **New behavior:** the per-wallet cooldown is removed; one address asked for from many networks is still logged
  (`auth_surge`, from its 20th challenge in a minute on).
- **Abuse prevented:** a neighbour's unsigned challenges for an address never refuse its key holder.
- **Remaining trade-off:** two IPs in one /24 can spend that network's 30 challenges a minute, and every player there waits
  for the minute (sign-in only; existing sessions are unaffected); the D1 budgets see only the network key, by design (no
  full IP is stored), so they cannot tell hosts in one /24 apart. An IPv6 /48 was one such network; since
  `bbf24001` (N-5) it has 60 challenges a minute, which three of its /64s can spend.
- **Files changed:** `server/auth.ts`.
- **Tests:** `tests/auth.test.mjs` "A-6: a neighbour's challenges for a player's address never refuse that player…", "F-5:
  a challenge flood starves neither its own verify nor anyone else…".

### A-7 — About 20 networks could keep the site-wide sign-in ceiling full · Improved (partly open)

- **Old behavior:** the site-wide valve (60 challenges per 6 s) admitted first come first served, so about 20 /24s (40
  IPs) at their full share kept it full, refusing every new sign-in, also from networks that had not asked.
- **New behavior:** 20 of the 60 per 6 s are kept for networks that have not asked in the last minute; networks that asked
  share the other 40. The valve stays the emergency ceiling (600 a minute).
- **Abuse prevented:** 20 /24s at full share (the audit's schedule) no longer keep a network that has not asked from its
  first challenge.
- **Remaining trade-off:** 14 /24s at full share plus 20 other networks per 6 s (about 200 a minute), each asking once and
  timed to refill the valve, keep such a network out while they go on (at least 214 networks and 220 IPs; IPv6 /48s are
  cheaper to hold than IPv4 /24s: since `bbf24001`, N-5, a /48 has twice a /24's share, so 7 /48s do what 14
  /24s do); 13 /24s, or 19 networks per 6 s, do not (both run in the tests). Networks that asked
  within the minute share the other 40, which 14 /24s can keep full, so under such an attack a player whose first
  challenge was issued waits the minute for a second one (Retry-After 60); a refused request writes nothing. Browsing and
  existing sessions are unaffected.
- **Files changed:** `server/auth.ts`.
- **Tests:** `tests/auth.test.mjs` "A-7: while 20 networks keep the valve full…", "challenge budgets: a network gets
  NETWORK_CHALLENGE_BUDGET a minute…".

### A-8 — A refused on-chain check was shown as “Checked on chain: this wallet holds no IMD seat right now” · Fixed

- **Old behavior:** with the location's `chain:index` budget spent and IMD's roster not listing a buyer's seat yet, the
  house read answered no seats and `recheck: 'limited'` with no chain read, and My wallet said "Checked on chain: this
  wallet holds no IMD seat right now".
- **New behavior:** a read that counted no seat but was not complete (`limited`, or `partial` from A-4) is the "can't
  confirm seats right now" state; the panel says "The on-chain check couldn’t be completed right now (this is not “you
  own nothing”), so no seat is counted yet. You are still signed in; try again later." and, under an empty list, "No seat
  proven on chain yet: the check couldn’t be completed right now. Try again later.", with the reason. The panel takes the
  house read and these texts from `walletView.ts` (`panelHome`, `houseNotes`, `04de387`).
- **Abuse prevented:** spending the index budget no longer makes the page tell a real owner that the chain was checked and
  the wallet holds no seat.
- **Remaining trade-off:** none known.
- **Files changed:** `src/world/auth.ts` (`statusOf`), `src/world/walletView.ts`, `src/world/WalletPanel.tsx`.
- **Tests:** `tests/wallet-client.test.mjs` "A-8: a house read that was refused or cut off…" (since `1969dc5` it renders
  the real panel, `tests/fixtures/wallet-panel.mjs`, instead of reading its source; since `11392d8` its refused read is
  N-6's residual: one IP spends `chain:index` and 20 other /24s take the location's index lanes first).

Test command: `node --test --test-name-pattern="A-[1-8]:" tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/wallet-client.test.mjs`;
result on 2026-09-30: 14 tests, 14 pass, 0 fail (A-1 two; A-2 four: one instance, two instances over one D1, the date of
a kept answer, the cron's 8 days; A-4 three: the cap, the other sizes, the page cap's note on the page). Each test failed
on the code before its fix, and each fix was broken once in the code to see its test fail, then restored.

Whole suite (Codex remediation plan §14 C): `npm test` on `backlog-0929` on 2026-09-30, with the code and tests of
`9e27e5b` (the last commit that changes either; the commit that adds this line changes only docs, which the record tests
read, and the suite was run on it too): 648 tests, 648 pass, 0 fail, 0 skipped, 0 cancelled. There were no failures
before the change and none after it; this checkout holds every file the tests read, so none was skipped for want of
one. `npx tsc --noEmit` is clean and `npm run build` passes (its one warning is the usual chunk-size note).

### Review of the Codex crosscheck (2026-09-30, not a Swarm review)

Two internal reviews of the A-2 change (`878799c`) and the crosscheck commits (`54c44f3` to `ff45c13`) found seven small
issues; each was confirmed here and closed:

- A2-R1: a kept index answer was dated when its request began, so a request held before its index read (a slow roster
  read) lost its later answer to an older one read meanwhile, and a refused read elsewhere lost a seat only the later
  answer named. It is now dated when the index read begins (`29cf00e`; the A-2 block above).
- A2-R2: the D1 cost comments, now measured on a local workerd D1: a delete that removes a row writes 1 (not 2), the
  prune writes 1 per row it deletes, and a new address writes 2, so the A-2 table writes about 0.9 M rows a month per
  location when its rows exist and at most about 1.7 M (not "≤ 0.9 M"); `server/auth.ts`, `server/ownership.ts`,
  DESIGN_W1 §6.
- R-1: DESIGN_W1 §7 said the index answer is kept 5 min in D1; the isolate reuses it for 5 min, and D1 keeps it until
  the cron deletes it past 8 days.
- R-2: the F-4 command selects 12 tests since `c139bae`; its result above says so.
- R-3: My wallet explained every `partial` read as "more seats than one check covers (256)", also the index's page cap
  on a wallet of two seats; the note names both causes (`9e27e5b`; the A-4 block above).
- R-4: the A-4 block named the 230-candidate case under the wrong tests; it names the test that holds it.
- R-5: the whole-suite line called `5ea39c7` the last code or test change, but it changed only docs; the line above
  names the commit whose code and tests were run.

### The Codex plans' test names

The two Codex plans suggest test file names; the tests keep the finding ids instead:

| Codex plan | Suggested name | Test here |
|---|---|---|
| audit §11 | auth-erc1271-cross-network-address-budget | `tests/auth.test.mjs` "A-1: garbage from a few other networks…" |
| audit §11 | ownership-cache-preserves-candidates-on-limited-refresh | `tests/ownership.test.mjs` "A-2: a refused index reload keeps the last index answer as candidates…" |
| audit §11 | auth-client-discards-stale-home-response | `tests/wallet-client.test.mjs` "A-3: an older house read whose body arrives after a newer answer is dropped…" |
| audit §11 | wallet-panel-limited-check-not-no-seat | `tests/wallet-client.test.mjs` "A-8: a house read that was refused or cut off…" |
| audit §11 | auth-verify-refreshes-clock-after-body | `tests/auth.test.mjs` "A-5: a challenge or verify whose body arrives late…" |
| audit §11 | auth-challenge-neighbor-cannot-starve-wallet | `tests/auth.test.mjs` "A-6: a neighbour's challenges for a player's address never refuse that player…" |
| audit §11 | auth-global-challenge-fairness | `tests/auth.test.mjs` "A-7: while 20 networks keep the valve full…" |
| audit §11 | ownership-candidate-cap-incomplete | `tests/ownership.test.mjs` "A-4: past the 256-candidate cap…" |
| retest §23 | expired-session-status-not-owner, expired-session-move-denied, expired-session-commit-move-no-write | `tests/wallet-client.test.mjs` "W-1: a session past its expiresAt here is not owner mode…" |
| retest §23 | rpc-transport-error-not-signature-invalid, erc1271-invalid-magic-still-401, erc1271-valid-magic-success, no-session-issued-on-rpc-unavailable | `tests/auth.test.mjs` "W-3: a contract wallet's eth_call failing at the node is 503 VERIFY_UNAVAILABLE…" |
| retest §23 | visibility-refresh-clears-stale-owner | `tests/wallet-client.test.mjs` "visibility-refresh-clears-stale-owner: a tab shown again…" |
| retest §23 (optional) | global-login-fairness | `tests/auth.test.mjs` "A-7: while 20 networks keep the valve full…" |
| retest §23 (optional) | same-origin-mint-boundary-doc-check | `tests/review-record.test.mjs` "the future Mint boundary is written down…" |
| retest Rule 4 | (the page's notice for W-3) | `tests/wallet-client.test.mjs` "W-3 on the page: a node failure on a smart wallet’s check…" |
| retest F-7(e) | (a locked wallet keeps the session) | `tests/wallet-client.test.mjs` "F-7(e): a locked wallet…" |

## Swarm audit 8c3aea2e (2026-09-30)

A Swarm audit (template Audit, five seats, all accepted: four specialists, one each for math, permissions, economics and
control flow, and a judge who reproduced, merged and ranked their findings), job
https://explorer.imd.fun/jobs/8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b, judged 2026-09-30 13:45 UTC, of the public review
snapshot `ae1d41a`, whose code is that of Worker `1a0dd495` (source `4321bb4`) as the team stated it to the reviewers.
Its report is https://github.com/Identity-md/research/blob/main/jobs/8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b/files/AUDIT.md.
One specialist rebuilt the Worker bundle from the snapshot alone and got SHA-256
`1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c`, the one in the team's deploy record of `1a0dd495`;
the judge's report gives no deployment-match verdict. The judge recorded 7 findings, each reproduced on the unmodified
code (the real handler or the real AuthClient, the real migrations on SQLite, synthetic keys, fixture chain and
limiters): 6 Low and 1 Info, all availability or display. It found no asset-transfer path, no way to sign in as an
address without its key, to revive or end another's session, or to get owner rights for seats that are not one's own;
two of the specialists wrote that each of A-1..A-8 and W-1..W-3 behaves as documented. Four of the seven extend fixes of
the previous round (N-1 and N-2: A-3; N-3: A-4; N-4: A-1). The judge did not adopt one specialist's claim that spending
the upstream (Alchemy) quota would take the whole site to 503; only the first-discovery denial (N-6) was kept. As the
team reads the submissions, the reviewers did not verify the live deployment or the Cloudflare configuration, the
upstream quota, real wallets or browsers, or front-end code not in the snapshot. It is a record of that version's
review, not a statement about these fixes.

"Status on the site" is the site's line word for word (`src/world/reviewRecord.ts`, "Later review"): the site
maintainer's own account of the fixes now in Worker `bbf24001`, not re-reviewed. The state is the team's own, in the terms of the
Codex handoff that the owner forwarded: FIXED_LOCALLY (the finding's reproduction test failed on the unmodified code, it
passes with the fix, and so does the whole suite) or PARTIAL (the reproduced case is fixed; a stated residual stays).
All seven are deployed in Worker `bbf24001` (source `2e4e830`, deployed 2026-10-01 04:10 UTC), as the team's deployment record lists it, after
migration `0005_lanes_and_subnets.sql` was applied to the production database; the states above are what the tests showed
before the deploy, and none of it was re-reviewed.

| Finding | Severity | Status on the site | Fix commit | Test (`npm test`) | State |
|---|---|---|---|---|---|
| N-1 | Low | Fixed in this version: only the newest session read is applied, its body and errors included, so an older answer can’t undo a newer one; a sign-in click waits for the newest read. | `f65a900` | `tests/wallet-client.test.mjs` "N-1: …" | FIXED_LOCALLY: deployed in `bbf24001` (the team's deployment record) |
| N-2 | Low | Fixed in this version: once the sign-in message arrives, the page checks that the flow, the wallet and the account are unchanged before asking the wallet; a cancelled flow asks nothing. Still: a wallet window already open can’t be closed by the page; its answer is dropped. | `f65a900`, `5261844` | `tests/wallet-client.test.mjs` "N-2: …" | FIXED_LOCALLY: deployed in `bbf24001` (the team's deployment record) |
| N-3 | Low (availability) | Fixed in this version: past the 256-candidate cap, seats that count (online now, or seen under this owner in the last 24 hours) are checked first, and a cut list is still marked as incomplete. Still: seats past the cap are not listed. | `11392d8` | `tests/ownership.test.mjs` "N-3: …" | FIXED_LOCALLY: deployed in `bbf24001` (the team's deployment record) |
| N-4 | Low (availability) | Fixed in this version: the fallback check counts only fallback checks, so the owner’s own earlier attempt no longer uses it up, and a retry or a second device gets through. Still: junk from the wallet’s own network can hold it, as for A-1. | `11392d8` | `tests/auth.test.mjs` "N-4: …" | FIXED_LOCALLY: deployed in `bbf24001` (the team's deployment record) |
| N-5 | Low (availability) | Improved in this version: an IPv6 /48 gets twice a /24’s sign-in shares, and each /64 in it at most one /24’s share of smart-wallet checks, counted by the /64 that asked for the challenge. Still: someone holding two or more /64s of a shared /48 can spend its shares, and sign-in there waits the minute (partly open). | `11392d8`, `5261844` | `tests/auth.test.mjs` "N-5: …", `tests/worker.test.mjs` "N-5: …" | PARTIAL: deployed in `bbf24001` (the team's deployment record) |
| N-6 | Low (availability) | Improved in this version: when an index read is refused and no seat counts yet, the requester’s network still gets one index read a minute of its own, so one IP no longer keeps a new buyer’s seat from being found; ownerOf still proves every seat. Still: 20 other networks at one location every minute can keep it refused while they go on (partly open). | `11392d8` | `tests/ownership.test.mjs` "N-6: …", `tests/presence.test.mjs` "N-6: …" | PARTIAL: deployed in `bbf24001` (the team's deployment record) |
| N-7 | Info | Fixed in this version: a sign-in the server no longer accepts reads “You are no longer signed in. Please sign in again.”, and “Your sign-in has expired. Please sign in again.” only when it ran out. Still: when this device’s clock runs behind the server’s, a sign-in that ran out in that gap can read as no longer signed in; both ask you to sign in again. | `f65a900` | `tests/wallet-client.test.mjs` "N-7: …", `tests/auth.test.mjs` "N-7: …" | FIXED_LOCALLY: deployed in `bbf24001` (the team's deployment record) |

Test command: `node --test --test-name-pattern="^N-" tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/presence.test.mjs tests/worker.test.mjs`;
result on 2026-10-01 (Node 24.19.0): 43 tests, 43 pass, 0 fail. Each finding's reproduction test failed on the unmodified
code (the failure is in its block below); a guard test, which passes on the unmodified code and pins a case the fix must
not break, was run once against a mutation of the fix (a line reverted or a term dropped) and failed then. Whole suite:
`npm test` at `11392d8` on 2026-10-01: 765 tests, 765 pass, 0 fail, 0 skipped, 0 cancelled (before the fixes: 726, all
passing); with this record and its test added, 766 tests, 766 pass, 0 fail, 0 skipped, 0 cancelled; `npx tsc --noEmit`
is clean. One earlier whole run on the busy build machine failed only the presence
recorder's CPU-time test (its fastest of five runs took 41 ms against a 25 ms bound, with the other test files running
in parallel); run alone it took 17 ms, and the next whole runs passed. These are fixture results: they say nothing
about the production WAF, limiters, D1 or real wallets.

The team's own review of these fixes (a security read and a mutation check, not an outside review) led to commit
`5261844`. It found two gaps: a sign-in click still waiting for a session read was not ended by a sign-out or the page's
teardown in that wait (N-2; the unmodified code has the same gap), and code deployed ahead of `0005` gave an IPv6 /48
the new 60 challenges a minute instead of the 0004 rule's 30 (N-5). Each now has a test that failed before the change.
Five rules of the fixes that no N test pinned (each survived its mutation) now have a test that fails under it: N-1's
sequence check right after the session fetch and its house read dropped as a sign-in begins, N-2's guard on a dead
flow's late verify refusal, N-6's lane only for a read the budget refused (not one that failed), and N-7's
`SESSION_EXPIRED` term with the page's clock behind the server's. `npm test` at `5261844`: 771 tests, 771 pass, 0 fail,
0 skipped, 0 cancelled; `npx tsc --noEmit` is clean.

Open choices for the owner: the IPv6 scale of 2; keeping the /64 prefix on IPv6 challenge rows (about 25
minutes unused, about a day used); the discovery lane (index reads at a location can rise from 20 to 40 a minute, only
while 20 networks take lanes there) and its site-wide ceiling of 600 a minute; the session route's `expired: true`; the
expired sentence replacing the status line's; ending an in-flight sign-in when the page closes. Migration `0005` and the
deploy itself need the owner's go-ahead.

### N-1 — An older session read could erase the owner state a newer one had set · Fixed

- **Old behavior:** overlapping session reads (the page load's, and the one a `signed-in` message from another tab
  starts) shared only the flow generation, so an older `{signedIn:false}` whose body arrived last cleared the session
  and house the newer read had set: owner mode, Enter and the move went away with a live cookie, and the next sign-in
  click could ask for a signature it did not need.
- **New behavior:** every session read takes a number (`sessionReads`, apart from `gen` and `homeGen`); only the newest
  read's answer, body, error or failure is applied, checked after the fetch, after the body and in the failure path. A
  read that applies "signed out" or another session also drops the house read begun for the session it replaces, and
  so does a sign-in as it begins; a 401 on the house route with no session held changes nothing. A sign-in click waits
  until no session read is running, before and after its own re-read. Nothing asks the wallet to repair state.
- **Abuse prevented:** a delayed or held older session answer (an ordinary sign-in in another tab, a slow network) no
  longer ends a newer session's owner mode or leads to an unneeded signature.
- **Remaining trade-off:** none known. By design (CORR-02), when the newest read itself fails the session is unknown
  until the next read, and a click reads it again before any signature; a click waits as long as other tabs keep
  starting session reads, and signs nothing meanwhile.
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "N-1: an older session read whose “signed out” body arrives after a newer “signed in” is dropped…"
  (the reproduction; on the unmodified code it ended `visitor` with no session, not `owner`), "N-1: and the reverse…",
  "N-1: an older read that fails late…", "N-1: a house read begun for a session that a newer read then ends…" (200, 429
  and 401), and four guards: "N-1: a switch of account or a sign-out while a session read is on its way…", "N-1: a
  sign-in click waits for the newest session read…", "N-1: an older read answered late with an error status (503 or 429)…"
  and "N-1: a house read of the replaced session that lands while another address signs in…" (these two from the team's
  mutation check, `5261844`: each fails with its check reduced to `gen`, or its `homeGen` bump removed).
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### N-2 — A cancelled sign-in could still ask the old account to sign · Fixed

- **Old behavior:** the sign-in flow checked its generation before the challenge body was read but not after, so an
  account switch, a switch to another wallet with the same account, a sign-out or the page closing while the body was on
  its way still opened `personal_sign` for the old account on the old wallet. The text was this site's own sign-in
  message, and a later check stopped the verify: no arbitrary signing and no sign-in, but an unwanted prompt that could
  disturb a new flow.
- **New behavior:** after the body the flow goes on only while it is the live flow, with the same wallet and the same
  account; that check comes right before the message check (F-7a, kept), the signing summary and the prompt, with no
  await in between. A wallet that locks mid-flow ends the flow quietly. A late challenge or verify refusal changes state
  only for the live flow, and the client's teardown ends an in-flight flow and resets its phase. A click still waiting
  for a session read (the load's, another tab's, or its own re-read) is ended by a sign-out, an account or wallet switch
  or the teardown in that wait, and then asks and reads nothing (`5261844`, from the team's review; the unmodified code
  had the same gap). No AbortController: an answer that has already arrived is judged by the state alone.
- **Abuse prevented:** a cancelled sign-in makes no wallet prompt and no verify, and cannot change a new flow's state.
- **Remaining trade-off:** a wallet window already open when the flow is cancelled cannot be closed by the page; its
  answer is dropped and never verified.
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "N-2: a challenge whose body arrives after the switch to another account…" (the reproduction; on the
  unmodified code one `personal_sign` for the old account), "N-2: the same after a switch to another wallet with the same
  account…", "N-2: a new sign-in started at once…", "N-2: a wallet that locks while the challenge body is on its way…",
  "N-2: a click still waiting for a session read is ended by the page closing or a sign-out…" (on `cd47077`, closing:
  a connect and a sign prompt, a second session read, a challenge and a verify; a sign-out: a sign prompt for the other
  account, a challenge and a verify), and the guards "N-2: a prompt already open when the flow is cancelled by a
  sign-out…" and "N-2: a dead flow’s verify refusal whose body lands after a new flow began…" (from the mutation check:
  it fails with the refusal applied whatever the generation).
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### N-3 — Past 256 candidate seats, a seat that counts through a recent sighting could be left unchecked · Fixed

- **Old behavior:** past the 256-candidate cap, candidates were ranked by registration and the live roster's online status
  only; the owner-bound 24-hour sightings that decide counting were read after the cut. So 256 lower-numbered registered
  seats that could not count pushed out a higher one seen under its owner an hour ago: no seat counted, `partial`, owner
  mode off. The answer kept in D1 (A-2) was cut the same way.
- **New behavior:** one predicate decides counting in the seat status, in the cap's rank and in the N-6 lane: a registered
  agent online now, or seen under this owner in the last 24 hours, ranks first, then other registered seats, then the
  rest, each by id. Only when there is a cut, one sighting read per proof build (primary-key reads of the registered
  candidates not online now) ranks both cuts, the one kept in D1 and the one proven; without a database, or when that
  read fails, the roster order stays (A-4). The 24-hour rule, the house sizes, `partial` and `ownerOf` on every selected
  seat are unchanged.
- **Abuse prevented:** sending a large holder more registered seats that cannot count no longer hides a seat that counts
  through a recent sighting.
- **Remaining trade-off:** seats past the cap are not listed, and when more than 256 could count, the ones past it are
  not counted (the house is then at its largest size anyway); the answer says `partial`.
- **Files changed:** `server/ownership.ts`.
- **Tests:** `tests/ownership.test.mjs` "N-3: past the 256-candidate cap, a seat that counts through its owner’s sighting in the last 24 h is
  still checked…" (the reproduction; on the unmodified code `[256,false,0,null,'partial']` where
  `[256,true,1,'s','partial']` was expected), "N-3: the cut follows the counting rule exactly…", "N-3: the ranking read
  happens only past the cap…", "N-3: the answer kept in D1 is cut the same way…".
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### N-4 — The owner’s own earlier check used up A-1’s fallback check, so one junk verify could block a retry · Fixed

- **Old behavior:** A-1's lane was refused whenever the network had checked the address within the minute, its own shared
  check included. After the owner's first attempt, one garbage verify from any other network spent the address's second
  shared check, and the owner's retry, or a second device after a sign-in, got 429 `CHAIN_BUSY` (reason `address`) for
  the rest of the minute.
- **New behavior:** each contract check records how it was admitted (`login_challenges.called_via`, `pool` or `lane`,
  migration `0005`; a row from before it counts as a lane), and the lane counts lane checks only: one per /24 and
  address a minute, for IPv6 two per /48 from two of its /64s (N-5). A subscriber (the /24; for IPv6 the challenge's
  /64) that itself made both of the address's shared checks this minute takes no lane of it, so garbage at one contract
  still spends only 2 of a network's 3 checks (F-3); this narrows the team's first design, whose lane term alone would
  have given such a /24 a third. The lane stays within the network's shares and on `chain:erc1271:lane`, never the two shared keys;
  no read or write is added (the column rides in the claim's UPDATE, unindexed).
- **Abuse prevented:** one garbage verify from another network no longer keeps an owner's retry or second device out.
- **Remaining trade-off:** junk from the owner's own /24 still holds it: two garbage verifies there spend the address's
  shared checks, or one takes the lane (IPv6: from its /64, or from two other /64s of its /48; logged `address`). The
  lane siege still takes at least 9 /24s at 3 or more addresses (IPv6: 5 /48s using two /64s each, at 2 or more) every
  minute at one location. Before `0005` is applied the old rule holds.
- **Files changed:** `server/auth.ts`, `migrations/0005_lanes_and_subnets.sql`.
- **Tests:** `tests/auth.test.mjs` "N-4: an owner’s own earlier check no longer uses up its lane…" (the reproduction; on the unmodified
  code the retry got 429 `CHAIN_BUSY` `address` instead of 200, and so did the second device), "N-4: the lane stays one
  per /24 and address a minute…" (guards: racing verifies, verifies sent from other networks, and the same-/24 residual),
  "N-4: each contract check records how it was admitted…", "N-4/N-5: an IPv6 /48 makes at most two lane checks…",
  "N-4/N-5: the lane siege for IPv6 is at its stated cost…"; "F-3: a /24's garbage leaves its other wallets alone…" and
  the A-1 tests are unchanged but for A-1 (e)'s query-plan binds.
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### N-5 — Separate IPv6 subscribers in one /48 shared one set of smart-wallet sign-in shares · Improved (partly open)

- **Old behavior:** every IPv6 client of one /48 was one network for the D1 shares (30 challenges, 10 code claims, 3
  contract checks a minute), while the per-IP limiter keys IPv6 by /64. Four subscribers on four /64s of one /48, each
  signing in with its own smart wallet in one minute, got 200, 200, 200 and 429 `network_contract`, and one /64 could
  spend its neighbours' shares.
- **New behavior:** the allocation model is stated: a /64 is a subscriber (a mobile connection or a home line; privacy
  addresses rotate only the low 64 bits), a /48 the unit an operator or a tunnel broker hands out. The shares nest: a
  /48 gets 2 times each /24 share (60 challenges, 20 code claims, 6 contract checks, 2 lanes per address a minute) and
  each /64 in it at most one /24's ERC-1271 claims and contract checks (its challenges: `AUTH_LIMITER`'s 20 a minute),
  counted by the /64 that asked for the challenge (`login_challenges.sub`, written at issue from `worker/app.ts`
  `subnetKey`), never by the address that sends the verify. IPv4 is unchanged, and log lines still carry only the /48.
- **Abuse prevented:** one /64 can no longer spend its /48's shares for its neighbours, whichever address sends the
  verifies; rotating host bits inside a /64 gains nothing, and rotating /64s stays within the /48's two shares.
- **Remaining trade-off:** partly open. Whoever can ask from two or more /64s of a shared /48 (a residential /56 or /60,
  a phone that reconnects, a tunnel-broker /48) can spend its shares, 60 challenges, 20 code reads and 6 contract checks
  a minute, and sign-in there waits the minute. The /64 level of challenges is per location (`AUTH_LIMITER`), so one /64
  whose traffic reaches three locations in a minute could ask for all 60. Each /48 counts as two /24s in the site-wide
  bounds (the valve's regular part: 7 /48s; `chain:code`: 9). Every IPv6 challenge row now keeps its /64 prefix (never
  the host bits, never logged) for the row's life, about 25 minutes unused and about a day used; challenges issued in
  the 5 minutes before a deploy carry none. Before `0005` is applied the old rules hold, a /48's 30 challenges a minute
  included (`5261844`: the challenge's fallback had kept the new 60). IPv6 reads per claim rise
  (the D1 cost lines in `server/auth.ts`).
- **Files changed:** `worker/app.ts`, `server/auth.ts`, `migrations/0005_lanes_and_subnets.sql`.
- **Tests:** `tests/auth.test.mjs` "N-5: four smart wallets on four /64s of one /48 sign in within a minute…" (the reproduction; on the
  unmodified code `[200,200,200,'429 CHAIN_BUSY network_contract']`), "N-5: one /64 cannot spend its /48’s shares for
  its neighbours…", "N-5: rotating /64s inside one /48 is still bounded…", "N-5: IPv4 is unchanged…", "N-5 (deployed
  ahead of 0005)…" (since `5261844` it also asks 31 challenges from 31 /64s of one /48 before `0005`: on `cd47077` all 31
  were accepted, now the 31st is 429 `SIGN_IN_BUSY`, reason `network`); `tests/worker.test.mjs` "N-5: the subscriber key
  is the IPv6 /64 inside the /48 network key…".
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### N-6 — One IP could use up NFT-index discovery at a location and keep a new buyer’s seat from being found · Improved (partly open)

- **Old behavior:** every NFT-index read of `/api/me/home` spends the location's `chain:index` (20 a minute), which any
  throwaway sign-in can spend. One IP's 20 sign-ins a minute spent it all, and a buyer whose seat only the index named
  (the roster behind, nothing kept in D1) got no seat, `limited`, owner mode off, every minute while that went on.
- **New behavior:** a discovery lane. When `chain:index` refused a read whose answer counts no seat (N-3's predicate),
  the requester's network may make one index read a minute of its own: counted in D1 first (`index_lanes`, migration
  `0005`; one a minute per /24, per /48 two and one per /64; at most 60 per 6 s site-wide), then charged to the new
  `CHAIN_LIMITER` key `chain:index:lane` (20 a minute per location, fails closed; no new binding). Its answer is kept like
  any index read (A-2), so that owner needs no lane again. `ownerOf` proves every candidate, nothing the client sends is
  one, and a refused lane stays `limited`: could not check, never owns nothing. An answer that already counts a seat
  takes no lane, and neither does a read that failed (an Alchemy error) rather than being refused. Each cron run (every
  15 minutes) deletes lane rows older than a minute, so the table holds at most about 16 minutes of lanes (about 9,600
  rows at the site-wide ceiling); only the last minute's rows are counted. Ordinary traffic costs nothing; a lane taken
  writes 3 rows and its prune 3 more (a network taking its lane every minute of a month: about 259 k rows, about $0.26;
  a /48 twice that), and the site-wide ceiling bounds all lanes at about 155 M rows a month (about $105 past the
  included writes). These are the figures of `bbf24001`; since `63c6c7bd` AUD3-02 releases a claim its key refused, which
  raises the site-wide bound to about 233 M rows a month and the table to about 12.8 k rows (its block below).
- **Abuse prevented:** one IP, or one network, spending `chain:index` no longer keeps a new buyer's first seat discovery
  out.
- **Remaining trade-off:** partly open. 20 other networks at one location (IPv6: 10 /48s using two /64s each) that take
  their lanes every minute, on top of the spent main key, still keep a refused read out while they go on, and so does
  anyone on the buyer's own /24 (or /64, or two other /64s of its /48) who takes that network's lane first; site-wide,
  600 lanes a minute close the lane at every location whose main key is also spent. An owner who already counts a seat
  and bought one only the index names is shown `limited` with the smaller count until the main key frees (A-2's rule).
  Index reads at a location can rise from 20 to 40 a minute, only while 20 networks take lanes there. Before `0005` is
  applied there is no lane.
- **Files changed:** `server/ownership.ts`, `server/auth.ts`, `server/presence.ts`, `migrations/0005_lanes_and_subnets.sql`,
  `wrangler.jsonc` (comment), `scripts/deploy-evidence.mjs` unchanged (it lists the new key from `CHAIN_KEYS`).
- **Tests:** `tests/ownership.test.mjs` "N-6: one IP’s throwaway sign-ins no longer keep a new buyer from their first seat discovery…" (the
  reproduction; on the unmodified code `ownershipUnavailable` in each of three minutes), "N-6: the lane is for a refused
  read that counts no seat…", "N-6: one lane per network a minute…", "N-6: twenty other networks can still keep a
  refused read out at one location…", "N-6: the lanes have a site-wide ceiling…", "N-6: an index read that failed (the
  budget allowed it) takes no lane…" (a guard from the mutation check: it fails with the lane allowed for any `limited`
  read), "N-6 (deployed ahead of 0005)…"; `tests/presence.test.mjs`
  "N-6: the cron deletes index-lane rows older than a minute…"; `tests/wallet-client.test.mjs` "A-8: a house read that was refused or cut off…"
  (now set up as this residual).
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### N-7 — A sign-in revoked elsewhere was shown as an expired session · Fixed

- **Old behavior:** every 401 on the house route while a session was held set "expired", so a "Log out all devices" on
  another device (the server answers `AUTH_REQUIRED` for a revoked session) made this page say the session had expired,
  a day before it would. Owner rights were removed correctly; only the stated reason was wrong.
- **New behavior:** "expired" means the session ran out: a 401 `SESSION_EXPIRED`, the held session's `expiresAt` reached
  on this clock (read before the session is cleared), or `GET /api/auth/session` answering
  `{signedIn:false,expired:true}`, which the route now does for an expired cookie only (a revoked, forged, malformed or
  missing cookie still gets exactly `{signedIn:false}`; the house route already answered `SESSION_EXPIRED` for that same
  cookie). Any other sign-out the page learns of is a revocation. My wallet words them (`walletView.ts` `endedText`):
  「登入已到期，請重新登入。」 / “Your sign-in has expired. Please sign in again.” for an expiry (also the status line),
  「登入狀態已失效，請重新登入。」 / “You are no longer signed in. Please sign in again.” for a revocation, and 「已登出。」 /
  “Signed out.” after this page's own sign-out. Nothing claims another device from `AUTH_REQUIRED` alone.
- **Abuse prevented:** a session ended on purpose elsewhere (a "Log out all devices", a stolen session its owner ended)
  is no longer shown as a routine expiry.
- **Remaining trade-off:** `AUTH_REQUIRED` has several causes, so the page says only that the sign-in is no longer valid,
  not why. When this device's clock runs behind the server's and the browser has already dropped the cookie, a read in
  that gap sees a plain signed-out answer and calls a session that ran out no longer valid; the window equals the clock
  difference, and both sentences ask to sign in again.
- **Files changed:** `src/world/auth.ts`, `src/world/walletView.ts`, `src/world/WalletPanel.tsx`, `server/auth.ts` (the
  session route), `docs/wallet-login/DESIGN_W1_v001.md`.
- **Tests:** `tests/wallet-client.test.mjs` "N-7: a session revoked elsewhere (AUTH_REQUIRED) a day before its expiry…" (the reproduction; on the
  unmodified code `expired: true` and the `expired` state), "N-7: a real expiry still reads as expired…" (its
  `SESSION_EXPIRED` case runs with the page’s clock 5 s behind the Worker’s, so only the server’s word makes it an
  expiry), "N-7: an expiry seen through a session read is still expired…", "N-7: My wallet says “Signed out.” after
  this page’s own sign-out…",
  and "Sign out on all devices…" (the other device is now signed out, not expired); `tests/auth.test.mjs` "N-7: the session route names an
  expiry only for a session that ran out…".
- **Deployment version:** bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC).

### The Codex handoff's regression matrix

The owner forwarded an engineering handoff from Codex (in Chinese) that numbers these findings #1..#7 and lists cases
each fix must cover (its §12). Its cases and the tests that hold them:

| Handoff | Its cases | Tests here |
|---|---|---|
| #1 (N-1) | old signed-out after new signed-in; old error or parse failure; a newer sign-out over an older sign-in; account switch and sign-out | `tests/wallet-client.test.mjs` "N-1: an older session read whose “signed out” body arrives after a newer “signed in” is dropped…", "N-1: and the reverse…", "N-1: an older read that fails late…", "N-1: an older read answered late with an error status (503 or 429)…", "N-1: a switch of account or a sign-out while a session read is on its way…" |
| #2 (N-2) | late challenge after a switch: 0 prompts, 0 verifies; same account on another wallet, sign-out, cancel; a prompt already open | `tests/wallet-client.test.mjs` "N-2: a challenge whose body arrives after the switch to another account…", "N-2: the same after a switch to another wallet with the same account…", "N-2: a prompt already open when the flow is cancelled by a sign-out…", "N-2: a click still waiting for a session read is ended by the page closing or a sign-out…", "N-2: a new sign-in started at once…" |
| #3 (N-3) | 257 candidates keep the seat seen an hour ago; over 24 hours, another owner's sighting, online now, ownership changed | `tests/ownership.test.mjs` "N-3: past the 256-candidate cap, a seat that counts through its owner’s sighting in the last 24 h is still checked…", "N-3: the cut follows the counting rule exactly…" |
| #4 (N-4) | an earlier pool attempt leaves the lane; second device, control, same-network residual, racing claims, bounds | `tests/auth.test.mjs` "N-4: an owner’s own earlier check no longer uses up its lane…", "N-4: the lane stays one per /24 and address a minute…" |
| #5 (N-5) | separate /64s not shut out by one another; host rotation, several /64s, IPv4 unchanged, bounded cost | `tests/auth.test.mjs` "N-5: four smart wallets on four /64s of one /48 sign in within a minute…", "N-5: one /64 cannot spend its /48’s shares for its neighbours…", "N-5: rotating /64s inside one /48 is still bounded…", "N-5: IPv4 is unchanged…" |
| #6 (N-6) | a new owner with nothing kept and the roster behind; kept candidates or not, one location, concurrent reads, recovery | `tests/ownership.test.mjs` "N-6: one IP’s throwaway sign-ins no longer keep a new buyer from their first seat discovery…", "N-6: the lane is for a refused read that counts no seat…", "N-6: one lane per network a minute…", "N-6: twenty other networks can still keep a refused read out at one location…", "N-6: an index read that failed (the budget allowed it) takes no lane…" |
| #7 (N-7) | `AUTH_REQUIRED` before expiry is not expired; a real `SESSION_EXPIRED`, `expiresAt` reached, a 401 with no session held | `tests/wallet-client.test.mjs` "N-7: a session revoked elsewhere (AUTH_REQUIRED) a day before its expiry…", "N-7: a real expiry still reads as expired…", "N-1: a house read begun for a session that a newer read then ends…" |

Advice weighed and not adopted, and why: a per-network share of `chain:index` (it cuts ordinary traffic, and 7
networks close it), a flat /64 for IPv6 (a /48 holder would get 65,536 shares), a new rate-limit binding (D1 counts are
global and exact), an AbortController (an answer already arrived must be judged by state anyway), and closing a wallet
window already open (the page cannot).

## Swarm reviews of Worker bbf24001 (2026-10-01)

Two Swarm reviews read the public review snapshot `8cad017`, whose code is that of Worker `bbf24001` (source `2e4e830`),
the running version when both reviews ran, as the team's deployment record lists it (from 2026-10-01 11:10 UTC the
running versions were front-end changes with the same Worker bundle `018df7b3…`: `d5f52483`, `ef1a55fb`, `8269ae53`; from 2026-10-02 06:08 UTC it was `63c6c7bd`, with these fixes, and since 2026-10-03 00:55 UTC it is `acdbb2bd`, which adds the member layer to them; the snapshot's
`source/` comes from `f4272c5`, which differs from `2e4e830` only in docs, one test and an evidence page, as the team
stated it to the reviewers):

- **Swarm Report `dcf922ca`** (template Report, one seat, accepted; a limited retest), job
  https://explorer.imd.fun/jobs/dcf922ca-68de-4cc5-bfbc-8b226008b0bf, completed 2026-10-01 08:54 UTC, report
  https://github.com/Identity-md/research/blob/main/jobs/dcf922ca-68de-4cc5-bfbc-8b226008b0bf/files/artifacts/report.md
  (in Traditional Chinese). It re-ran the N-1..N-7 cases: N-1, N-3, N-4 and N-7 fixed for their cases; N-2 fixed for the
  audit's case but not as broadly as the team's claim (its one new finding, R-1, here R3-R1, Low); N-5 and N-6 partly,
  with the residuals as stated. It rebuilt the Worker bundle from the snapshot alone (`wrangler deploy --dry-run`):
  280,605 bytes, SHA-256 `018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c`, the one in the team's deploy
  record. Deployment match **partial**: its five one-off production GETs (the page, two scripts, the stylesheet and the
  session route) all got 403, so the live files, headers and wallet-method counts were not compared, and the running
  Worker, D1 `0005`, the bindings and the WAF rule stay unverified. The team's observation, which no review checked:
  Cloudflare answers 403 to the Python-urllib User-Agent such a script sends, while browsers and curl get 200 from the
  same URLs.
- **Swarm audit `1ef8e8a6`** (template Audit, five submissions from four seats, all accepted: four specialists, one each
  for math, permissions, economics and control flow, and a judge who reproduced, merged and ranked their findings; seat
  #2 did both math and permissions), job
  https://explorer.imd.fun/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82, judged 2026-10-01 09:15 UTC, report
  https://github.com/Identity-md/research/blob/main/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82/files/AUDIT.md. Nine
  entries, "3 low · 6 info": AUD3-01..AUD3-03 Low, AUD3-04..AUD3-08 Info, and AUD3-09, the judge's record of what was
  checked and what could not be (not a defect). Each finding was reproduced on the unmodified code (the real handler or
  the real AuthClient, the real migrations on node:sqlite, synthetic keys, fixture chain and limiters). It gives no
  deployment-match verdict and did not rebuild the bundle.

Neither review reported a new finding rated high or medium. The Report also re-checked earlier findings and kept their
residuals as the earlier records state them, among them the medium ones and those at a shared boundary: F-1/S-1
(Medium, shared boundary: a phishing site can relay the sign-in message), A-1 (Medium, availability: partly fixed), F-2
(Low/Info: a smart-contract wallet that accepts any signature lets anyone sign in as it) and F-8/S-2 (Info, shared
boundary: open); the others are Low or Info (A-2, A-4's 256-candidate cap, A-5, A-6, A-7, W-1, W-2, F-3, F-5 and F-7
(b)–(e) among them). Beyond those, neither found a way to sign in as an
address without its key, to revive a revoked session at the server, to end another address's sessions, to get owner
rights for seats that are not one's own, to make the page sign anything but the site's own sign-in text, or an
asset-transfer path. The new findings are about availability or what the page shows, except R3-R1, which ended in a
wallet prompt asking the previous account to sign the site's own sign-in text and, with that account's signature, in a
session for it. The ids are those of the owner's engineering handoff (in Chinese): R3-R1 is the Report's R-1, AUD3-0n
the audit's #n. As the team reads the submissions, neither verified the live deployment, the Cloudflare configuration
(bindings, the limiters' behaviour, the WAF), production D1, the upstream quota, real wallets or browsers, or front-end
code not in the snapshot. It is a record of that version's review, not a statement about these fixes.

**The two judgments, side by side.** AUD3-09 says the audit found no path from a cancelled, switched or torn-down flow to
`personal_sign` or a verify; the Report's R-1 shows one at the same commit, for a connect still pending with no session
and the flow idle (`eth_requestAccounts` answered for A after `accountsChanged(B)`). Both are kept as they are: the
audit's statement covers the N-2 orderings it tried, the Report's counterexample an earlier await. The Report's probe
asserts the bug, so its exit 0 means "reproduced": run on `f4272c5` before the fixes it reproduced (one prompt for A, one
verify, A signed in); run on `f2db1f5` its result assertion (the second; the first, that the wallet is on B, holds
before and after) fails (no prompt, no verify, B connected). It is not a test
here (it pins the old behaviour); the `R3-R1` tests are. Its N-2 control (a switch during the challenge body: no prompt,
no verify) is the case of the `N-2` tests, which pass.

"Status on the site" is the site's line word for word (`src/world/reviewRecord.ts`, "Reviews of Worker bbf24001"): the
site maintainer's own account of these fixes, not re-reviewed. The state uses the handoff's terms: FIXED_LOCAL (the
finding's reproduction tests failed on `f4272c5`, pass with the fix, and so does the whole suite; local runs only),
RESIDUAL (a stated limit that stays, pinned by a test), BLOCKED_EVIDENCE (needs a real wallet, production or
Cloudflare's own answer, none of which this round used), RECORD_ONLY (not a defect); AUD3-02's and AUD3-05's rows are
PARTIAL, as in the later review's table: AUD3-02's reproduced cases are fixed locally, and a stated residual stays (here
measured, not pinned by a test); AUD3-05's reproduction, run as the audit wrote it, meets its expected result for the
house, `checking` and owner mode, not for the session the panel shows (pinned only implicitly: both AUD3-05
reproduction tests expect the status `ownershipUnavailable`, which the page shows only while it still holds that
session). All of it is deployed in `63c6c7bd` (source `f36144a`, 2026-10-02 06:08 UTC, the team's deployment record), and no D1 migration was needed (the
fixes use `RETURNING rowid` and conditional statements on the `0004`/`0005` tables).

| Finding | Severity | Status on the site | Fix commit | Test (`npm test`) | State |
|---|---|---|---|---|---|
| R3-R1 | Low | Fixed in this version: when the wallet switches or locks while the page waits for it to connect, or while its signature window is open, the page keeps the account the wallet named last and ends that click: it asks the wallet nothing more and verifies nothing, and never opens a wallet window to recover; the next click starts from the current account. Still: this order of wallet events was reproduced with a test wallet, not with real wallets. | `7ada277` | `tests/wallet-client.test.mjs` "R3-R1: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record); the real-wallet event order BLOCKED_EVIDENCE |
| AUD3-01 | Low (availability) | Fixed in this version: if the lane’s own index read, or the ownerOf check after it, fails, the answer keeps the seats this request had already proven with ownerOf and is marked as a check not completed, never as owning nothing. Still: the read was sent, so that network’s lane stays used for the minute. | `6611189` | `tests/ownership.test.mjs` "AUD3-01: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record) |
| AUD3-02 | Low (availability) | Partly fixed in this version: a lane claim the location’s limit refused made no read, so it is released: its network may claim again 30 s later, and the claim leaves the site-wide count at once. Still: only 20 claims every 6 s are released site-wide; past that, or if a release fails, a claim holds its network for the minute as before, so about 80 claims within 6 s from one location (60 before) still fill the site-wide ceiling for every other location for those 6 s; this relies on a refused limit check costing nothing, not yet confirmed with Cloudflare (partly open). | `6611189` | `tests/ownership.test.mjs` "AUD3-02: …" | PARTIAL: deployed in `63c6c7bd` (the team's deployment record); the audit's two cases FIXED_LOCAL (T20, T22, and T23 at its 60 networks); about 80 claims in one 6 s slice at one location still fill the site-wide ceiling (60 before; measured, not pinned); the limiter assumption BLOCKED_EVIDENCE |
| AUD3-03 | Low (availability) | Fixed in this version: a smart-wallet check that never reached the chain is taken back, so the owner’s retries are refused only while the limit itself refuses, and a new sign-in gets through once it has room; the refused challenge stays used. Still: a check that reached the chain counts whatever its answer; this relies on a refused limit check costing nothing, not yet confirmed with Cloudflare. | `6611189` | `tests/auth.test.mjs` "AUD3-03: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record); the limiter assumption BLOCKED_EVIDENCE |
| AUD3-04 | Info | Fixed in this version: once the server confirms this page’s sign-out (also the one an account switch or the sign-in button sends), no session or house read begun before it is applied, so “Signed out.” stays; the ended sign-in leaves the page even if another wallet was chosen meanwhile, and other tabs are told. Still: a read whose answer reaches the page before the sign-out is confirmed is shown until it is. | `7ada277`, `bd4f749`, `10bb630`, `f095642`, `7b2d74d` | `tests/wallet-client.test.mjs` "AUD3-04: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record) |
| AUD3-05 | Info | Partly fixed in this version: when the house read answers for another address (another tab signed in with another wallet), the page drops the house it held and ends the check before it reads the session again; if that read fails it shows “Can’t confirm seats right now, try again later”, never owner mode, and “Check again” can be pressed. Still: until a session read succeeds, the panel keeps showing the earlier sign-in as signed in, without owner mode; the audit expected the page to stop showing it (partly open). | `7ada277` | `tests/wallet-client.test.mjs` "AUD3-05: …" | PARTIAL: deployed in `63c6c7bd` (the team's deployment record); the handoff's T09 and T10 FIXED_LOCAL; the session the panel shows until a session read succeeds stays (ADV-4) |
| AUD3-06 | Info (availability) | Fixed in this version: answers that only report that there is no live sign-in (the session read, the house read, a refused “Log out all devices”) no longer clear the sign-in cookie, so they can’t delete one another tab has just set; the server still refuses the old one. Before a new sign-in asks the wallet anything, the page waits for its own sign-outs to be answered (at most 5 s, saying so meanwhile; past that it asks nothing and says that sign-out hasn’t been answered yet), so they can’t delete that sign-in’s cookie either. Still: an explicit sign-out whose answer arrives after another tab’s sign-in still signs that browser out, and an ended sign-in’s cookie now stays in the browser until it expires. | `0b8a286`, `10bb630`, `f095642`, `7b2d74d` | `tests/auth.test.mjs` "AUD3-06: …", `tests/wallet-client.test.mjs` "AUD3-06: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record); T13 RESIDUAL (pinned) for another tab's sign-in, this page's own FIXED_LOCAL (`10bb630`; the wait shown since `f095642`, also while a read fails since `7b2d74d`) |
| AUD3-07 | Info | Fixed in this version: when the server says this browser’s sign-in ran out, the page says “Your sign-in has expired. Please sign in again.” and still that other devices were not signed out; it then reads the session again, so a sign-in another tab has just made is found. Still: when this device’s clock runs behind the server’s and the browser has already dropped the cookie, the page can’t tell that it ran out, as for N-7. | `7ada277` | `tests/wallet-client.test.mjs` "AUD3-07: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record) |
| AUD3-08 | Info (hardening) | Fixed in this version: the whole client address is parsed; an IPv4 address written in IPv6 form counts as that IPv4, other IPv6 stays IPv6, and text that is not a client address shares one small allowance. Still: no real request was shown to reach this; were Cloudflare to send a form this rejects, those clients would share that allowance. | `f2db1f5` | `tests/worker.test.mjs` "AUD3-08: …", `tests/auth.test.mjs` "AUD3-08: …" | FIXED_LOCAL: deployed in `63c6c7bd` (the team's deployment record; hardening: no production path was shown) |
| AUD3-09 | Info | Record only, nothing to fix: the audit found no path from a cancelled, switched or closed sign-in to a signature or a verify, and the Report’s R3-R1 shows one for a connect still pending (fixed in this version). What it could not check (the live deployment, real Cloudflare limits and database, real wallets and browsers) is still unchecked. | none | none | RECORD_ONLY |

Test command: `node --test --test-name-pattern="^(R3-R1|AUD3-)" tests/wallet-client.test.mjs tests/auth.test.mjs tests/ownership.test.mjs tests/worker.test.mjs`;
result on 2026-10-01 (Node 24.19.0), at `bd4f749`: 56 tests, 56 pass, 0 fail. With the N tests
(`--test-name-pattern="^(N-|R3-R1|AUD3-)"`, `tests/presence.test.mjs` added): 99 tests, 99 pass, 0 fail. The same at
`10bb630` and with its record (`2f5d6c1`): 56 and 99, all passing; with the final check's tests
(`--test-name-pattern="^(R3-R1|AUD3-|ADV-)"`, the first four files), 65 tests, 65 pass; with the re-check's
(`f095642`, and with its record `066d109`), 76 tests, 76 pass; with the review of that record's (`7b2d74d`, and
its record `13449f2`), 87 tests, 87 pass; with the review of `13449f2` (`901420a`, and with this record), 90 tests,
90 pass (56 and 99 unchanged: no new test carries those ids). The tests are of three kinds
(the team's design, not a Swarm requirement): 40 named `ID: …` are reproductions or new behaviour, and each failed on
`f4272c5` (the failure is in its block below); 14 named `ID guard: …` pass on `f4272c5`, pin a case the fix must not
break, and each was run once against its named mutation of the fix (a check removed or loosened) and failed then; 2
named `ID residual: …` pin a measured bound of the limiter assumption below (they fail on `f4272c5`, where the bound is
different). All 14 guards, the T08 one rewritten in `10bb630` included, still pass on `f4272c5` (rerun with the
`2f5d6c1` record). The final check's nine tests (`10bb630`, below) follow the same split against `125248c`: six named `ADV-n: …`
failed there, and three named `ADV-n guard: …` pass there (one of them, on a wallet chosen while the click waits, fails
on `f4272c5`, before `bd4f749`). The re-check's eleven (`f095642`, below) follow it against `2f5d6c1`: three named
`ADV-n: …` failed there (and so did one changed assertion of a `10bb630` test), and eight named `ADV-n guard: …` pass
there and fail under their named weakenings. The eleven of the review of `066d109` (`7b2d74d`, below) follow it against
`066d109`: four named `ADV-n: …` failed there; a fifth, `ADV-1: …`, passes there (it pins a line of `f095642` no test
covered) and fails on `2f5d6c1` and with that line weakened; six named `ADV-n guard: …` pass there and fail under
their named weakenings. Whole suite (`npm test`) at each fix commit on 2026-10-01: `7ada277` 879 tests, 879
pass; `0b8a286` 884, 884 pass; `6611189` 906, 906 pass; `f2db1f5` 908, 908 pass; 0 fail, 0 skipped, 0 cancelled each
(before them, `f4272c5`: 861, all passing); with this record and its test added (`2dfee42`), 909 tests, 909 pass; with
the follow-up `bd4f749` (below), 918 tests, 918 pass. `npx tsc --noEmit` is clean and `npm run build` passes at
`bd4f749` (its one warning is the usual chunk-size note). After `main` was merged in at `125248c` (`956ace0`, the
`d5f52483` deploy), before this round's last code: 928 tests, 928 pass, `npx tsc --noEmit` clean, `npm run build`
passing (the team's run). With `10bb630` (the final check, below), 937 tests, 937 pass; with its record (`2f5d6c1`),
937 tests, 937 pass; `npx tsc --noEmit` clean and `npm run build` passing there. With `f095642` (the re-check, below),
run in a scratch copy of that commit: 948 tests, 947 pass; the other, a deploy-evidence test that reads two older
commits (`132228c`, `3f661eb`) from the repository's history, failed only because the copy's throwaway git history has
none. With its record (`066d109`), in the worktree: 948 tests, 948 pass, 0 fail, 0 skipped, 0 cancelled; `npx tsc --noEmit`
clean and `npm run build` passing. With `7b2d74d` (the review of `066d109`, below) and with its record (`13449f2`), in the
worktree on 2026-10-02: 959 tests, 959 pass, 0 fail, 0 skipped, 0 cancelled; `npx tsc --noEmit` clean and `npm run build`
passing. With `901420a` (the review of `13449f2`, below) and with this record, in the worktree on 2026-10-02: 962 tests,
962 pass, 0 fail, 0 skipped, 0 cancelled; `npx tsc --noEmit` clean and `npm run build` passing.
`npx wrangler deploy --dry-run --outdir <tmp>` at `f2db1f5`, with a one-line `dist/index.html` as the Report did: a
Worker bundle of 283,716 bytes, SHA-256 `a7bb8087202252ea5a4ab41b75754b53eee0a6a078f4607f3af07dfd3c24d488`, a local
build that nothing was compared with or deployed from. The same bytes at `125248c` (the team's run after the merge, from
the worktree with its built `dist/`) and at `10bb630` and `2f5d6c1` (rerun for that record the same way): 283,716
bytes, SHA-256 `a7bb8087…`, the same bindings. Between `f2db1f5` and `2f5d6c1` the only change to a file the Worker
bundles is the merge's `src/world/market.ts` (the weather tiers, the shower and their labels), none of it in what the
Worker takes from that file (`MARKET_URL`, `SEAT_COLLECTION`, `selectMarket`, `selectFloor`, `withUsd`);
`src/world/auth.ts` (`bd4f749`, `10bb630`, `f095642`, `7b2d74d`, `901420a`), `src/world/WalletPanel.tsx` (`f095642`, `7b2d74d`) and
`src/world/reviewRecord.ts` are page code that the Worker entry (`worker/index.ts`) does not load. The re-check's record
(`066d109`) changed comments only in `server/auth.ts`, which the Worker bundles: rerun the same way with it, the bundle
was the same 283,716 bytes, SHA-256 `a7bb8087…`, with the same bindings (the comments do not reach it). `7b2d74d` and
its record change page code, tests and docs only: rerun the same way at `7b2d74d` with its record (2026-10-02, from the worktree with its built `dist/`),
the bundle is the same 283,716 bytes, SHA-256 `a7bb8087…`, with the same bindings. So do `901420a` and this record: rerun
the same way at `901420a` (2026-10-02), the same 283,716 bytes, SHA-256 `a7bb8087…`, the same bindings. These are fixture results: they say nothing about the production WAF, limiters, D1 or
real wallets.

**The limiter assumption (BLOCKED_EVIDENCE).** AUD3-02's and AUD3-03's releases let a network ask a refusing location
key again. That costs nothing if a refused call to a Cloudflare rate-limit binding takes nothing from anyone, as the
repository's model has it (`windowLimiter`: a fixed 60 s window in which a refused call changes nothing); it has not
been checked against Cloudflare. If the binding counted refused calls in a sliding minute, re-asks could keep a closed
key closed with fewer networks. Measured through the Worker under such a model (a `slidingLimiter`, in the two
`residual` tests): after 20 networks close a location's `chain:index:lane`, 10 /24s re-asking every 30 s keep a buyer's
lane out for 3 minutes and 9 do not (before the release, 20 were needed); after 7 /24s close `chain:erc1271`, 6 /24s
each sending one garbage verify every 6 s keep a first-time smart wallet out for 3 minutes and 5 do not (under the fixed
window none do; on `f4272c5` the owner waited until 75 s in both models, its own retries having spent its address's
share). The fallbacks, if refused calls are shown to count: AUD3-02 with a 54 s retry (the per-network rate stays near
the old one and released claims still leave the site-wide count at once, but the 31 s retry of the audit's case is
lost); AUD3-03 with a released claim marked `called_via='refused'` and still counted in the network shares (at most 3
asks a minute per /24 again, but the audit's own sequence then waits the minute). The choice is the owner's.

The team's own review of the design before the fixes (a critique, not an outside review) changed it in eight places,
among them: AUD3-02's release capped site-wide (20 per 6 s) with a 30 s retry instead of 6 s and a marker on released
rows; a failed release logged in both AUD3-02 and AUD3-03; a refused logout-all re-reads the session instead of dropping
reads (the AUD3-06 page test, which failed on the first draft); a logout completion that a newer flow overtook does
nothing (the AUD3-04 guard, which failed on the first draft); AUD3-08 takes a dotted quad only as the final piece and sends
the zero /64 to the unknown key; and the tests split into reproductions, guards and residual pins.

**The team's mutation check of the fixes (2026-10-01, after `d429ec3`; not an outside review).** Each fix was weakened
one check at a time (a statement removed, a condition loosened) and the four test files run against every version.
Eleven weakenings left every test passing: `loggedOut` not dropping house reads; `providerChanged`'s logout not calling
`loggedOut`; a refused logout-all not dropping house reads; the check after the signature without its wallet half; a
catch-all in the lane's rebuild; `INDEX_LANE` no longer counting a released row as its /64's own; the claim kept when
the budget throws `LimiterMissing`; a lane claim whose time is not recorded (its release then matches nothing); and
three loosenings of the address parser (fewer than eight groups with no `::`, a second `::`, a mapped prefix of four
zero groups). It also found a path AUD3-04 had left out: the sign-in click's own logout of another address's session
(the AUD3-04 block). `bd4f749` covers that path, adds nine tests and five address strings to the AUD3-08 reproduction,
and each of the twelve weakenings now fails a test of its finding. The fix code of R3-R1, AUD3-01..AUD3-03, AUD3-07 and
AUD3-08 was unchanged, and so was every status the site showed at `bd4f749`.

**The team's final check (2026-10-01, after the merge at `125248c`; not an outside review).** One more independent pass
over the code and the record then, with its own probes through the real AuthClient and Worker, found three gaps in the
sign-in click's logouts (ADV-1..ADV-3; each on `f4272c5` too, none a regression), a status that said more than the code
does (ADV-4, AUD3-05) and seven points in the record. `10bb630` (`src/world/auth.ts` and its tests only) closes
ADV-1..ADV-3: the click's confirmed logout ends the very session it logged out even when another wallet became current
meanwhile, and tells the other tabs (the AUD3-04 block); and the click waits for this page's own logouts before it asks
the wallet anything, at most 5 s (the AUD3-06 block). Each part of that fix the team reverted on its own then failed the
test meant for it; seven other weakenings failed no test (the re-check below). With its record (`2f5d6c1`) four
statuses on the site changed: AUD3-02 is partly fixed (about 80 claims in one 6 s slice at one location still fill the
site-wide ceiling, measured again for that record), AUD3-04 and AUD3-06 describe `10bb630`, and AUD3-05 names what
stays. That record also scopes the "high or medium" sentence above to new findings, counts the audit's seats, dates the running
version, words AUD3-04's residual by when an answer reaches the page, records the runs after the merge, and widens the
words `tests/review-record.test.mjs` refuses in the record and these docs.

**The team's re-check of the final check's fixes (2026-10-01, after `2f5d6c1`; not an outside review).** Another
independent pass over `10bb630` and its record, with its own probes (Q1..Q12, the real AuthClient over the real Worker,
the cookie attached when the page sends) and a sweep of one-line weakenings of the new code, found nine points.
ADVR-1: ADV-1 was only partly fixed. `signOut`'s and `revokeAbandoned`'s logouts did not name the session they end, and
`10bb630`'s wait made that reachable: a click waiting for such a logout is busy but idle, so another wallet chosen then
takes a generation and clears nothing, and "Log out this device", confirmed, left owner mode for revoked A (the AUD3-04
block). ADVR-2..ADVR-4: seven weakenings of `10bb630` failed no test (the click's, `providerChanged`'s and
`revokeAbandoned`'s logouts not held; the wait not ending once a read shows the wallet's account signed in; the wait
after the click's own session read reduced to that read; the click's broadcast limited to a live click; and every click
waiting, which only a race with the real 5 s timer caught). ADVR-5: the wait showed nothing, and one that ran out said
"couldn't check whether you're already signed in" (the AUD3-06 block). DR-1..DR-4, this record: the limiter table still
said AUD3-02's kept claims count "for the minute"; the words `tests/review-record.test.mjs` refuses let their -ly, -r
and -st forms through (it refuses them now); AUD3-05 kept the label "Fixed" while its own reproduction met its expected
result only in part; and the residuals the Report kept read as if four were all. `f095642` (`src/world/auth.ts`,
`src/world/WalletPanel.tsx`, `tests/wallet-client.test.mjs`) closes ADVR-1 and ADVR-5 and adds eleven tests: three
`ADV-n: …` that failed on `2f5d6c1` and eight `ADV-n guard: …` that pass there and pin the seven weakenings and the
waiting notice's end (the three on the holds also fail on `125248c`, which did not wait). The team's sweep at `f095642`:
22 one-line weakenings (those seven, three more of the holds and the wait, and twelve of the new code), each failing at
least one test of `tests/wallet-client.test.mjs` (every click waiting now fails three tests besides the timing one, two
of them on a fake timer); one more, `loggedOut` reporting whether it ended a session rather than whether it applied,
changed nothing (its only reader runs after a newer flow began, where the two agree), so the code now says the latter.
With this record two statuses on the site change: AUD3-05 is partly fixed (partly open), and AUD3-06 says the wait is
shown and how it ends; the limiter table's AUD3-02 row, the Report's residuals (here and in DESIGN_W1 §17), AUD3-05's
block and the refused words follow DR-1..DR-4, and the comments of `server/auth.ts` that said "counts for the minute"
say what a kept claim holds (comments only).

**The team's review of the re-check's fixes (2026-10-02, after `066d109`; not an outside review).** Another
independent pass over `f095642` and its record, with its own probes (P1..P9: the real AuthClient over the real Worker,
My wallet rendered) and a sweep of one-line weakenings of `f095642`'s code (M01..M28), found eight points. RC-1, a regression
of `f095642` in an edge case: to name the late session, an abandoned flow's late verify success read its body before it
sent that session's logout, the verify still held meanwhile; a body that stalled after its headers (which had already
set the late cookie) left that session live at the server with its cookie in this browser, and every sign-in click
waited 5 s and ended with `logout-slow`, asking nothing (`2f5d6c1` sent that logout on the headers). RC-2: the waiting
notice shared the page's one notice, so a session read (503, 429) or a house read (429, any other failure) that failed
while a click waited replaced it: the page said "unavailable", "too many attempts" or "did not complete" beside a sign
button that was on and did nothing, and the same click asked the wallet by itself once the logout was answered (not a
regression: `2f5d6c1` showed no wait at all). RC-3..RC-5: lines of `f095642` that no test pinned (an abandoned flow
that dies while its verify body is read; the waiting notice's `live()`, logout and `asks()` conditions; "Signed out."
for an overtaken sign-out only when it ended its session, and what `loggedOut` reports), and two weakenings for which
the review found no reachable consequence. DOC-1..DOC-3, the record: DESIGN_W1 §17 counted all eight guards of
`f095642` as pinning weakenings no test caught (seven do; the eighth pins the waiting notice's end); this page called
AUD3-05's residual "not pinned by a test", while both reproductions pin it implicitly; and it said the Report's probe
fails its first assertion on `f2db1f5` (the first holds; the second, its result, fails). `7b2d74d`
(`src/world/auth.ts`, `src/world/WalletPanel.tsx`, `tests/wallet-client.test.mjs`) closes RC-1 and RC-2. The late
session's logout goes out on the verify's headers again and takes over the verify's hold; the body, read on its own,
names the session that logout ends: read before the logout is confirmed, the confirmation ends it (as at `f095642`);
read after, that very session (address and expiry) ends on the page then, and nothing else. The wait is a state of its
own (`waiting`): set while a click waits for this page's logout and would ask the wallet, cleared when the wait ends and
by whatever ends the click (a sign-out, an account or wallet switch, the page's teardown), and shown in the notice's
place, with My wallet's sign button off, whatever a read's notice says meanwhile. The teardown's part also covers the
review's probe P6 (on `066d109` a client started again kept `logout-pending`; not raised as a finding, as the page
starts its client once outside development). Eleven tests: four `ADV-n: …` that failed on `066d109`, one `ADV-1: …`
for RC-3, and six guards, five of them for weakenings of `f095642` (M05..M07, M20, M21, M25) and one for the ends of the
waiting state; and three changed assertions of `f095642` tests, which read `waiting` where they read
`logout-pending` ("ADV-3: a logout of this page that does not answer…", "ADV-3: while a click waits for this page’s
logout, My wallet says so…", "ADV-3 guard: a click that waited for this page’s logout and then finds another wallet in
use…"). One point differs from the review: it found no reachable consequence for M20 (`signOut`'s branch for an
overtaken sign-out taking any truthy answer as confirmed), and the team found one: "Log out all devices" refused because
this browser's sign-in had ended (401: nobody was signed out), answered after another wallet became current while a
click waited, would say "Signed out.", as if the other devices were (AUD3-07's point); a guard now pins it. M15 stays
equivalent in reachable behaviour: its line runs only for a verify that names another address than the one its
challenge was asked for, and the Worker's verify answers the challenge's own address. The team's sweep at `7b2d74d`: 30 one-line weakenings of the new code and of the lines the review named, each run
against the five client test files (257 tests); 28 fail at least one test: the waiting state set without `live()`,
without the logout condition or without `asks()` (the review's M05..M07), or never (M04); its clear when the wait ends,
at the teardown (two ways), in `providerChanged` (M03's place), in `signOut` and in `accountChanged`; a fresh page
waiting; My wallet's sign button on while waiting (M28), no waiting line, a notice shown before it, and its English
(M26) and Chinese texts; the late session's logout sent after its body (as at `066d109`) or naming no session (M13), a
session given outright ignored, the body not naming it, a body after the confirmation ending nothing, one before it
ending the session at once, the confirmation not recorded, and a late body clearing whatever the page holds; the
abandoned flow that dies during its body naming no session (M14); and M20, M21, M25. Two change nothing a page can show
and are recorded as equivalent: the waiting state written again on every pass of the wait (the same value), and M15
(above). No status on the site
changes: AUD3-06's "saying so meanwhile" now holds while a read fails too, and no other status speaks to these points.
One new residual (the AUD3-04 block): if an abandoned flow's verify body never arrives (a connection cut after its
headers) and its logout is confirmed only after a newer flow began, a late session a read had shown stays on the page,
revoked at the server, until the page's next read (in owner mode the owner re-check, within 60 s; otherwise the next
session read: the tab shown again, another tab's message, a click; corrected by the team's review of `13449f2`, CF-4).

The team's review of `13449f2` (not an outside review; CF-1..CF-5) confirmed RC-1..RC-5 and DOC-1..DOC-3 closed with no
new regression (the review's probes P1..P15 and the earlier probes rerun; the Report's probe still fails its result
assertion; the 30-line sweep reproduced: 28 fail a test, the two equivalents survive) and found five minor points, closed
in `901420a` and this record. CF-1 and CF-2: two lines of `revokeAbandoned` no test pinned, a late body after a confirmed
logout ending whatever session the page holds by then (the revoke's generation in place of the session it names), and a
lost late logout counted as a confirmation (a body landing later would end a session still live at the server, against
SEC-1 / CORR-01). Two guards pin them: "ADV-1 guard: an abandoned flow’s verify body landing after its late logout was
confirmed…" and "ADV-1 guard: an abandoned flow’s late logout that was lost…". CF-3: M20's scenario read to its end: a
"Log out all devices" refused (401) and answered after another wallet became current while a click waited kept the
session another device had ended, in owner mode, with no notice, until the owner re-check; reachable since `10bb630`,
and not recorded. Since `901420a` that branch reads the session afresh, as the live path does (the AUD3-07 block); "ADV-1:
a “Log out all devices” the server refused, answered after another wallet became current while a click waited for it,
reads the session again…" fails on `13449f2`, and the M20 guard now expects that read's end (`ended: 'revoked'`, still
no "Signed out."). CF-4: the residual above named a 60 s bound that holds only in owner mode (corrected above and in the
AUD3-04 block). CF-5: a test comment said every `ID: …` test of the review of `066d109` failed on `066d109`; the RC-3
test passes there and fails on `2f5d6c1` (corrected). The team's check of `901420a`: each of four lines (the late body
ending only the session it names, the confirmation only after a reached logout, the new re-read, and M20's `ok===true`)
weakened once in a scratch copy fails at least one test of `tests/wallet-client.test.mjs`. No full review followed
`901420a` (the owner's choice); the team's own check is the one above. No status on the site changes.

Still open and outside this round (BLOCKED_EVIDENCE; each needs the owner's authorization): a real-wallet run of R3-R1's
event order (T16); Cloudflare's treatment of refused rate-limit calls (above); after a deploy, that production D1 returns
the `RETURNING` row or `meta.changes` for `INDEX_LANE` (without either, the claim is taken as no lane and its row stays
for the minute); and the running Worker, D1 `0005`, the bindings, the WAF rule and the live files and headers (T41). The
Report's five 403s are not a known WAF problem, and the site's protection is not to be lowered for a reader.

Open choices for the owner: six existing assertions changed (the four AUD3-06 ones, which no fix can keep, and two
AUD3-08 `::1` ones that follow T34's "no shared zero bucket"; the alternative is to keep `::` and `::1` in the zero /64
and record that as a deviation from T34); AUD3-02's D1 cost (site-wide at most about 233 M rows written a month against
about 155 M) and a refusing lane key asked twice a minute per network instead of once; the two limiter fallbacks above;
R3-R1 ends the click with no notice (the page shows the new account as connected): add one?; AUD3-03's neighbour case (a
`chain:code` refusal still spends its code share; not reported; left as is); AUD3-08 sends dotted quads with leading
zeros (`01.2.3.4`) to the unknown key rather than normalising them; AUD3-02's release cap (20 per 6 s site-wide), which
sets the 80 claims that still fill the site-wide ceiling (a higher cap costs more D1 writes); AUD3-05's session shown
until a read succeeds: drop it, or mark it unconfirmed, once the house answers for another address (AUD3-05 stays partly
fixed until then; dropping it changes what the two AUD3-05 reproduction tests expect, `ownershipUnavailable`, which
the page shows only while it holds that session); one assertion of a `10bb630` test changed with the wait's notice
(`logout-slow` for `session-unknown`), and three of `f095642` tests with the waiting state (`waiting` for the notice
`logout-pending`); and the deploy itself.

### R3-R1 — A wallet’s late connect answer could undo an account switch and ask the old account to sign · Fixed

- **Old behavior:** with no session and the flow idle, `signIn` awaited `eth_requestAccounts` and checked only `gen`
  afterwards, and `accountChanged` in that state did not bump `gen`. So an `accountsChanged(B)` that came while the
  connect was pending was overwritten by the late `[A]`: the account went back to A, the Worker issued A's challenge, the
  N-2 check found the account unchanged (A), and the wallet was asked to sign A's message; with A's signature, A signed
  in. The text was this site's own sign-in message, and nothing signed in without A's key.
- **New behavior:** `accountChanged` bumps a counter (`accountEvents`) first, before any early return, so a repeat and a
  lock count too. After `eth_requestAccounts` the answer is applied only if no account event came during the await, or
  the latest one names the same account; otherwise the click ends with no account set, no challenge, no prompt, no verify
  and no notice, and the state keeps what the latest event set (B, or none for a lock). `bind()`'s `eth_accounts` answer
  is dropped the same way. After `personal_sign`, a lock or another wallet while the prompt was open verifies nothing (as
  the N-2 check before the prompt already did; another wallet that announces itself is ended by `gen` already, and the
  wallet half of this check covers one that changes with no event). The page never opens a wallet prompt to recover;
  the next click starts from the current account. A normal connect that announces the account it has just granted
  (T02) goes on.
- **Abuse prevented:** an account switch while the wallet is connecting can no longer bring back the previous account's
  sign-in prompt or its verify.
- **Remaining trade-off:** a wallet that answers `eth_requestAccounts` with a stale account and never emits
  `accountsChanged` cannot be told from a normal connect (the page still asks only that account to sign the site's own
  text); the event order of real wallets is not verified (BLOCKED_EVIDENCE, T16); a wallet that changes account while
  connecting needs a second click, and the page says nothing about it (an open choice).
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "R3-R1: an accountsChanged(B) that arrives while eth_requestAccounts is pending wins over the late [A]…"
  (the reproduction; on `f4272c5` one prompt for A, one verify and A signed in; it then checks that the next click signs
  in B with one prompt), "R3-R1: a lock (accountsChanged([])) while the connect is pending ends the click…", "R3-R1: a
  lock while the signature prompt is open verifies nothing…" (on `f4272c5` one verify), "R3-R1: a slow eth_accounts answer that lands after a lock event changes nothing…",
  "R3-R1: a wallet that changes with no provider-change event while the prompt is open verifies nothing…" (`bd4f749`; on
  `f4272c5`, and with the check after the signature reduced to the account, one verify and a session made), and the guards "R3-R1 guard: a normal first connect that emits accountsChanged for the same account…" (T02; fails with
  the check reduced to "any event ends the click"), "R3-R1 guard: B then A while pending…" (fails under the same
  mutation) and "R3-R1 guard: a sign-out, the page closing or a wallet switch while the connect is pending…" (T04; fails
  with the `gen` check after `eth_requestAccounts` removed).
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-01 — A failed index read on the discovery lane answered 503 and dropped the seats already proven · Fixed

- **Old behavior:** when `chain:index` refused a read whose answer counted no seat, `home()` took the network's lane and
  rebuilt the proof with the budget forced open, unguarded. If that index read failed (an HTTP error, a timeout, a
  malformed body) with nothing kept for the address, `proof()` threw `OwnershipUnavailable` and the route answered 503
  `OWNERSHIP_UNAVAILABLE`, dropping the first proof (refused, so `limited`) that ownerOf had already made for the same
  request; the same request with the lane refused, or before `0005`, answered 200 `limited` with the seat.
- **New behavior:** the rebuild and its sightings read replace the request's proof only together, and only when both
  succeed. An `OwnershipUnavailable` from the rebuild (its index read, or the ownerOf after it) leaves the first proof and
  its sightings, so the answer is 200 with the seats and their reasons, `recheck:'limited'` (could not check, never "owns
  nothing"). Any other error propagates as before. No refund: the lane row and the key unit stay spent, because the read
  was sent.
- **Abuse prevented:** whoever spends a location's `chain:index` (N-6's premise) can no longer have an upstream failure
  on a player's lane read turn the seats ownerOf had proven into "can't confirm seats".
- **Remaining trade-off:** a lane read that fails still spends that network's lane for the minute, so a second refused
  read there in that minute stays `limited`.
- **Files changed:** `server/ownership.ts`.
- **Tests:** `tests/ownership.test.mjs` "AUD3-01: a lane read that fails (502) keeps the request’s first proof…" (the
  reproduction; on `f4272c5` 503 `OWNERSHIP_UNAVAILABLE`; its controls, the lane key refused and a 0001–0004 database,
  answer 200 `limited`), "AUD3-01: the same for a timeout and for a malformed index body…", "AUD3-01: a lane delta whose new-candidate ownerOf read fails keeps the first proof…",
  and the guards "AUD3-01 guard: a first proof that cannot be made is still 503 and asks no lane…" (fails if `home()` also
  carries on past a failed first proof) and "AUD3-01 guard: an error other than OwnershipUnavailable in the lane rebuild…"
  (`bd4f749`; D1 failing on the rebuild's sightings read is 503; fails with a catch-all in the rebuild).
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-02 — A lane claim the location’s limit then refused still used up the network’s lane and the site-wide ceiling · Partly fixed (partly open)

- **Old behavior:** the house route's lane wrote its `index_lanes` row (`INDEX_LANE`, D1 first) and only then asked
  `chain:index:lane`; a refused or throwing key left the row although no read was made. The network then waited out the
  minute even when the key had room seconds later (the audit's case: still refused in D1 at 31 s, the key not asked), and
  unread rows from one location counted toward the site-wide 60 per 6 s: 60 throwaway networks at location A kept a buyer
  at location B out (B's key never asked) while only 20 reads were made.
- **New behavior:** D1 stays the first guard (so one network's concurrent claims still ask the key once), and
  `INDEX_LANE` returns its row id. A claim the key did not admit (refused, or its binding failed) is released by
  `INDEX_LANE_RELEASE`, one conditional statement on exactly that row (by its id, else by its own net, sub and at, which
  no other row can share): dated back to `at − 60 s + 30 s` (`INDEX_LANE_RETRY_MS`), so it leaves the site-wide count at
  once and its network's count 30 s after the claim, and marked (`'released:'` before its sub, still its /64's own row),
  while fewer than 20 (`INDEX_LANE_RELEASES`) released rows sit in its 6 s slice site-wide. Past that cap, or if the
  release fails, the row holds its network for the minute and the site-wide count for its 6 s slice, as before (fail
  closed), and one `index_lane_kept` line (reason `release_cap` or `release_failed`) says why. An admitted claim keeps
  its row (AUD3-01: no refund).
- **Abuse prevented:** a refusal of the location key no longer holds a buyer's network for the rest of the minute (while
  the release cap has room), and at the audit's 60 networks claims that bought no read no longer fill the site-wide
  ceiling for other locations; about 80 still do (below).
- **Remaining trade-off:** the site-wide ceiling still fills from one location, with more claims than before. Only 20
  claims per 6 s are released site-wide, so the 21st refused claim in a 6 s slice already passes the cap, and refused
  claims past it, or whose release fails, hold their network for the minute and the site-wide ceiling for their 6 s
  slice, as before. About 80 claims in one 6 s slice at one location (20 read, 20 released, 40 kept: 60 counted rows;
  before the fix, 60 claims) keep a buyer at every other location out for that slice, refused in D1 with its location's
  key never asked, as in the audit's second case: measured by rerunning that reproduction with 60, 70, 79, 80 and 100
  networks (up to 79 the buyer at B gets its seat; at 80 and 100 it is refused, and 6 s later it gets it), not pinned by
  a test. Kept up for a minute that takes about 700 /24s at one location (IPv6: about half as many /48s, each using two
  /64s), since a read or kept claim holds its network for the minute and a released one for 30 s, against 600 before
  (arithmetic, not measured). A network whose claim met a refusing key can claim again only after 30 s, so a refusing
  key is asked at most twice a minute per network slot (before: once); 20 other networks taking a location's lane every
  minute still keep it refused there (N-6's stated residual). The D1 cost rises: site-wide at most about 5,400 rows
  written a minute, about 233 M a month (about 155 M before), and per /24 while its location's key refuses at most 18
  rows a minute (the "home" item of the cost comment in `server/auth.ts`). The release rests on the limiter assumption
  above (BLOCKED_EVIDENCE), and on production D1 returning the `RETURNING` row or `meta.changes` (unverified; with
  neither, the claim is taken as no lane and its row stays for the minute).
- **Files changed:** `server/auth.ts`, `server/presence.ts` (comment: a released row is pruned 30 s earlier).
- **Tests:** `tests/ownership.test.mjs` "AUD3-02: a refused local key reserves no admitted row; the separate probe gate allows retry after 30 s…"
  (the reproduction, the audit's first case; on `f4272c5` still `limited` at 31 s with the key not asked), "AUD3-02: 40 local refusals reserve nothing after 20 admitted reads; another location can admit a buyer…" (the
  reproduction, the audit's second case, at its 60 networks; on `f4272c5` the buyer at B refused in D1, B's key asked 0
  times; at 80 networks the ceiling fills again, above), "AUD3-02: a key that throws makes no admitted reservation or index read and keeps the 30 s probe backoff…",
  "AUD3-02: two /64s race and the key admits one; only its admitted row counts for the minute…", "AUD4-03: a D1 reservation that returns changes 1 without a RETURNING row still admits; a local refusal writes no admitted row…",
  "AUD4-03: a D1 reservation that returns changes 1 without a RETURNING row still admits; a local refusal writes no admitted row…", "AUD4-03: 100 refused /24s reserve zero admitted rows in both rounds, without a release/update refund workload…",
  "AUD4-03: preflight and atomic reservation both use covering network/global indexes…" (the reads the cost comment states), the guards "AUD4-03: a refusing key is asked at most twice/minute per network slot even if the home binding allows every read…" (fails with a release that leaves no
  retry wait, and with a 6 s retry), "AUD4-03: a refused /64 waits 30 s before probing again and leaves its /48 neighbour’s other probe slot…"
  (`bd4f749`, T36: one /64 reads at 0 s and 1 s, its neighbour in the /48 at 2 s, each asks the key once; fails with
  `INDEX_LANE`'s `'released:'||sub` term dropped: the first /64 asks twice and its neighbour is refused in D1) and
  "AUD3-02 guard: one admitted lane operation is up to NFT_PAGE_CAP (5) index pages…"
  (the handoff's point that an index operation is not one HTTP request; fails with the page cap raised), and the
  residual pin "AUD4-03 residual (denials count)…". Every N-6 test is unchanged.
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-03 — A smart-wallet check the location’s limit refused still used up the address’s shared checks, so the owner’s own retries kept it out · Fixed

- **Old behavior:** `verifySignature` claimed the contract check in D1 (`called_at`, `called_via` `pool` or `lane`) and
  then asked the location key (`chain:erc1271`, `:known` or `:lane`). When the key refused, the answer was 429
  `CHAIN_BUSY` and the challenge burnt, but the claim stayed, counting toward the address's two shared checks, the
  network's and the /64's shares and the lane's own count. A smart-wallet owner at a saturated location spent its own
  address's share with its first two attempts; the third was refused for `address`, and 5 s after the key had room it was
  still refused, with no `eth_call` ever made, until the minute passed.
- **New behavior:** a claim whose key did not admit the check (refused, its binding failed, or the binding missing,
  which still answers 503) is released before the answer: `RELEASE_CONTRACT` (before `0005`, `RELEASE_CONTRACT_0004`)
  sets `called_at` and `called_via` back to NULL on this nonce only, and only while `called_at` is still this claim's
  time. `checked_at` stays and the challenge is burnt as before, so the nonce can never be claimed or consumed again. A
  claim whose `eth_call` was sent counts whatever the answer (a W-3 503, a revert, a wrong word): no free retry. A
  release that fails leaves the claim counted (the old behaviour) and writes one `erc1271_claim_kept` line. The `eth_call`
  bounds are unchanged: a check is admitted only with its claim in place and the key's yes.
- **Abuse prevented:** a refusing key no longer turns a smart-wallet owner's own retries into a lock on its address for
  the rest of the minute.
- **Remaining trade-off:** a check whose `eth_call` was sent and failed still counts (deliberately); the code-share claim
  (`checked_at`) of a challenge whose `chain:code` key refused is still spent (a looser bound, 10 a minute per /24, not
  reported; releasing it would touch the one-check-per-challenge lock); a released claim no longer caps its network's
  claims, so releases are bounded by the challenges a verify needs (30 a minute per /24, the valve site-wide: at most about
  78 M rows written a month were every challenge at the valve one); the limiter assumption above (BLOCKED_EVIDENCE).
- **Files changed:** `server/auth.ts`.
- **Tests:** `tests/auth.test.mjs` "AUD3-03: an ERC-1271 check the location key refused leaves no claim…" (the
  reproduction, the audit's own sequence; on `f4272c5` the third attempt refused for `address`, 2 `pool` rows, and 429
  `address` 5 s later with no `eth_call`), "AUD3-03: the same on a database before 0005…", "AUD3-03: of two claims of one address, the one whose key refused is released…",
  "AUD3-03: a release that fails keeps the claim counted…", "AUD3-03: the release reads one row, by the challenge’s nonce…",
  "AUD3-03: a lane check (CLAIM_LANE) the lane key refused is released…" (`bd4f749`; the lane half: X's two shared
  checks spent by garbage from another /24, the owner's lane check refused by `chain:erc1271:lane`; on `f4272c5` the lane
  claim stayed and 5 s later the owner was refused for `address`), "AUD3-03: a missing CHAIN_LIMITER binding at the budget is 503 and leaves no contract claim…"
  (`bd4f749`; on `f4272c5` the claim stayed), the guard "AUD3-03 guard: a check whose eth_call was sent and failed (node error, 503) stays counted…" (T28; fails with
  a release in the unavailable path), and the residual pin "AUD3-03 residual (a limiter that counts refused calls)…".
  The N-4, N-5, A-1 and F-3 tests are unchanged.
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-04 — A session read begun during this page’s sign-out could show the ended sign-in again · Fixed

- **Old behavior:** `signOut` bumped `gen` before its POST and applied the result without invalidating anything, so a
  session read begun while the logout was on its way (another tab's message, the tab shown again, a re-read after a house
  mismatch) carried the current `gen` and the newest number. Answered before the revocation and landing after it, it wrote
  session A back and read the house: the page ended at "You are no longer signed in" instead of "Signed out.", or, when
  that house read failed, kept showing session A, its hint and "can't confirm seats" with no cookie and no live session
  left. The logouts an account switch, a wallet switch and an abandoned flow send had the same window, and so did the
  sign-in click's own logout of another address's session (the page holding A's, the wallet saying B), which the first
  fix (`7ada277`) left out and the team's mutation check found: a read begun while that logout was on its way and
  answered after the click ended without signing (B's prompt rejected) put A back, on `d429ec3` as on `f4272c5`. With the
  house read failing the page showed A's session (a mismatch) and its hint with no live session at the server and no
  cookie; with it working, a house read went out and the page said "no longer signed in" over the click's own outcome.
  The team's final check after the merge found two more gaps in that last path, on `f4272c5` as on `125248c` (ADV-1,
  ADV-2): when another wallet became current while the click's logout of A was on its way, the confirmed logout skipped
  `loggedOut` (the click's generation was old), so the page kept A's session, house and hint, and owner mode once the
  new wallet named A, after the server had revoked A (until the next owner re-check, 60 s); and a click that then ended
  without a new session (B's prompt rejected) told no other tab, so another tab of the profile kept showing A as owner.
  The team's re-check of `2f5d6c1` (ADVR-1) found the same gap in two more logouts, `signOut`'s and `revokeAbandoned`'s,
  and `10bb630`'s wait made it easier to reach: a click waiting for such a logout is busy but idle, so another wallet
  chosen then takes a generation, sends no logout and clears nothing. "Log out this device" confirmed after that left
  A's session, house and hint (owner mode once the new wallet named A), with no "Signed out." and other tabs not told;
  an abandoned flow's late session that a read had shown stayed the same way once its logout was confirmed.
- **New behavior:** `loggedOut(g)`: when this page's logout is confirmed (2xx: revoked, cookie cleared), every session
  and house read begun before it is stale (`sessionReads++`, `homeGen++`), and a session a read showed meanwhile ends;
  called from `signOut`, the account-switch logout, `providerChanged`, `revokeAbandoned` and (since `bd4f749`) the
  sign-in click's logout of another address's session, with the click's own generation. If a newer flow began since
  the logout was sent (`gen` moved), the completion does nothing: that flow's own `gen++` already ended the older reads,
  and later reads belong to the new session. A logout that did not reach the server, or a refused logout-all,
  invalidates nothing (the page reads again instead). Since `10bb630` the click's logout, like the account switch's,
  names the session it ends: once confirmed, it ends that very session on the page (same address and expiry), with its
  house, its hint and any read begun before, even if `gen` has moved on; a newer session the page holds is left alone.
  And the click's confirmed logout is told to the other tabs (`signed-out`), as `signOut` and the account switch already
  did. Since `f095642` `signOut`'s logout names the session it ends too, and when it is confirmed after another flow
  began it still ends that very session on the page (with "Signed out.") and tells the other tabs; `revokeAbandoned`'s
  names the late session its verify returned (`{address, expiresAt}`), so that session ends on the page once its logout
  is confirmed, even after a read showed it and another wallet became current. Since `7b2d74d` (the team's review of
  `066d109`, RC-1) that logout goes out on the verify's headers, as before `f095642`, and the body, read on its own,
  names the session it ends: read before the logout is confirmed, the confirmation ends it; read after, that very
  session ends on the page then, and nothing else.
- **Abuse prevented:** none by another party (it needs the player's own read racing their own sign-out); on a shared
  computer, "Log out this device" no longer leaves the page looking signed in.
- **Remaining trade-off:** a read whose answer reaches the page before this page's logout is confirmed is applied (it
  was true then) and ends when the logout is confirmed; another device learns of a sign-out on its next read (W-1); a
  wallet switch's logout sent during a flow does not name a session a read showed during that flow, as the account
  switch's, the click's, the sign-out's and an abandoned flow's now do (a narrower path: two wallet switches, another
  tab's sign-in and a read; not tested, not changed); since `7b2d74d`, when an abandoned flow's verify body never
  arrives (a connection cut after its headers) and its logout is confirmed only after a newer flow began, a late session
  a read had shown stays on the page until its next read (in owner mode the owner re-check, within 60 s; otherwise the
  next session read), while the server has
  revoked it and the cookie is cleared.
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "AUD3-04: a session read begun while this page’s sign-out is on its way, answered after it, revives nothing…"
  (the reproduction; on `f4272c5` session A came back, then `revoked`), "AUD3-04: the same when the house read then fails or is refused…"
  (on `f4272c5` session A and its hint stayed), "AUD3-04: an account switch’s logout and an abandoned flow’s logout end a read begun before them…",
  "AUD3-04 / R5: a provider switch cancels the old prompt but preserves another tab’s newer same-wallet session…"
  (R5 supersedes the earlier `bd4f749` unconditional-logout expectation: a different nonce for the same wallet must survive), "AUD3-04: the sign-in click’s own logout of another address’s session ends a session read begun while it was on its way…"
  (`bd4f749`; on `d429ec3` and `f4272c5` `revoked` with a house read sent, or with the house read lost A's session,
  `mismatch`, and A's hint), "AUD3-04: a house read sent while this page’s sign-out is on its way, answered after it, sets no house…"
  (`bd4f749`; on `f4272c5`, and with `loggedOut`'s `homeGen++` removed, A's house on a signed-out page), and the guard
  "AUD3-04 guard: an account switch’s logout answered after the new account’s house read was sent…" (fails with
  `loggedOut` applied whatever the generation: the new account's house dropped and the check left running; since
  `10bb630` the new account's session there is one another tab set, as a click no longer signs in while this page's
  logout is out). Since `10bb630`: "ADV-1: the sign-in click’s own logout of A, confirmed after another wallet became current…"
  (the reproduction; on `125248c` the page kept session A, its house and hint, and owner mode once the new wallet named
  A), "ADV-2: the sign-in click’s confirmed logout of A is told to the other tabs…" (on `125248c` the other tab stayed
  owner for A), and the guards "ADV-1 guard: a newer session the page holds when the click’s logout of A is confirmed…"
  (fails with the session compared by address only) and "ADV-3 guard: another wallet chosen while the click waits for an account switch’s logout…"
  (fails with the account switch's logout not naming the session it ended). Since `f095642` (current v1.1 successor control): "ADV-1 v1.1: explicit logout and later provider switch have separate primary decisions…"
  (on `2f5d6c1` session A, its house and hint, no "Signed out.", and the other tab owner for A; it fails with any of
  the new end's three parts removed: ending the session, "Signed out.", telling the other tabs), "ADV-1: an abandoned flow’s late session, shown by a read while a click waited for its logout…"
  (on `2f5d6c1` owner mode for the revoked late session; it fails with that session not named, or its verify body not
  read), and the guard "ADV-2 guard: the confirmed logout of a click that another wallet ended is still told to the other tabs…"
  (fails with the broadcast limited to a live click). Since `7b2d74d` (the team's review of `066d109`; current v1.1 successor control): "ADV-1 v1.1: later provider switch has displayed authority even while old nonce cleanup is held…"
  (on `066d109` no logout went out before the body; it fails with a body that lands after the confirmation ending
  nothing, or with one that lands before it ending the session at once), "ADV-1: an abandoned flow that dies while its verify body is read…"
  (passes on `066d109`; on `2f5d6c1`, and with that logout naming no session, owner mode for the revoked late session),
  and the guards (current v1.1 successor control) "ADV-1 v1.1 guard: old explicit closure never labels newer context Signed out…"
  (fails with "Signed out." set whatever `loggedOut` did, with `loggedOut` reporting that it applied when it did
  nothing, or with another wallet leaving the waiting line of the click it ended) and "ADV-1 guard: a “Log out all devices” the server refused (this browser’s sign-in had ended)…"
  (fails with that branch taking any answer but a 2xx as a confirmed sign-out).
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-05 — A house answer for another address left the previous owner view and a check that never ended · Partly fixed (partly open)

- **Old behavior:** when `GET /api/me/home` answered for another address than the held session (another tab of the
  profile had signed in with another wallet), `refreshHome` handed over to a session re-read and returned without
  touching the house or `checking`. If that re-read failed (429, 503, a lost connection), the page kept session A, A's
  house, owner mode and `checking:true` ("Check again" disabled) while every server answer was for B, until a later read
  succeeded.
- **New behavior:** an answer for another address contradicts the held identity, so it is not taken as "unreadable for
  now": the held house is dropped (`home:'unavailable'`) and the check ends before the session is re-read. A re-read that
  works shows the cookie's session (B: a mismatch with account A, or its own house); one that fails leaves "can't
  confirm seats" with the existing notice, never owner mode, and "Check again" enabled. CORR-05's rule (`homeOkAt`) is
  unchanged.
- **Abuse prevented:** none by another party; the page no longer shows owner mode for a session the browser no longer
  holds.
- **Remaining trade-off:** until a session read succeeds, the panel keeps showing the earlier session as signed in, its
  address and its expiry, without owner mode and with "can't confirm seats", while the cookie and the server session are
  the other address's: the page does not drop a session it could not read. Run exactly as the audit wrote it, the
  reproduction meets its expected result ("the page no longer claims A's session or house and checking is false") for
  the house, `checking` and owner mode, not for the session shown (the team's final check, ADV-4). The site named this
  since `2f5d6c1` but still called the finding fixed; since the team's re-check of that record (DR-3), as AUD3-02 for
  its larger case, it calls it partly fixed (partly open). Dropping the held session, or marking it unconfirmed, once
  the house answers for another address is an open choice for the owner (above); the handoff's T09 and T10, which ask
  for the house, `checking` and owner mode, are met. Both reproduction tests pin that residual implicitly: they expect
  the status `ownershipUnavailable`, which the page shows only while it still holds that session, so dropping it changes
  what they expect (the team's review of `066d109`, DOC-2).
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "AUD3-05: a house read answered for the address another tab signed in, whose session re-read is refused (429)…"
  (the reproduction; on `f4272c5` `owner` with `checking:true`), "AUD3-05: the same for a 503 and a lost connection…",
  and the guard "AUD3-05 guard: once the session read works again, Check again finds the cookie’s session…" (fails with
  the mismatch branch returning without the re-read).
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-06 — A late signed-out answer could delete the sign-in cookie another tab had just set · Fixed

- **Old behavior:** the session route, the `/api/me/home` 401 and the logout-all 401 answered a dead cookie (revoked,
  expired, unknown) with `Set-Cookie __Host-imd_session=; Max-Age=0`. A browser applies Set-Cookie by name in arrival
  order, so such an answer, sent with the dead cookie and landing after another tab of the profile had signed in,
  deleted the fresh cookie: both tabs were signed out on their next request, and the new session stayed live at the
  server for up to 7 days with no holder. This page's own sign-in did not wait for its own logouts either (the team's
  final check, ADV-3, on `f4272c5` as on `125248c`): an account switch's logout, sent with A's cookie, whose 204 landed
  after the next click's verify deleted B's new cookie; the page showed B as owner with no cookie, B's session stayed
  live at the server with no holder, and the next re-check said "no longer signed in".
- **New behavior:** answers that only report "no live session" send no session Set-Cookie; the server keeps refusing the
  dead token on every request (it is checked against D1 each time). Sign-in (verify 200) and the explicit logouts
  (logout 204, a successful logout-all) still write the cookie. On the page, a refused logout-all no longer means "no
  session": the page reads the session afresh (AUD3-07), so a sign-in another tab has just made is found. Since
  `10bb630` (ADV-3) every logout this page sends (the account switch's, the wallet switch's, an abandoned flow's,
  `signOut`'s and logout-all's, and the click's own) is tracked until its handler has run, and so is an abandoned flow's
  verify until its late session is logged out. Before a challenge or a connect prompt the click waits until none is out,
  except when the wallet's account is already signed in (nothing is asked then); the wait is capped at
  `LOGOUT_WAIT_MS` (5 s), and one still out then ends the click, asking nothing; the next click waits again. Since
  `f095642` (the team's re-check, ADVR-5) the wait is shown: My wallet says "Waiting for a log-out (or a cancelled
  sign-in) this page sent earlier to be answered; your wallet is asked nothing until then." and its sign button is off;
  a wait that runs out ends with the notice `logout-slow` ("… hasn’t been answered yet, so no signature was requested.
  Try again in a moment."). `10bb630` showed nothing while it waited (idle, the button on, a second click dropped) and
  ended with `session-unknown` ("Couldn’t check whether you’re already signed in…"), which was not the reason. At
  `f095642` that line was a notice (`logout-pending`), which a session or house read failing meanwhile replaced (the
  team's review of `066d109`, RC-2); since `7b2d74d` it is a state of its own (`waiting`), shown in the notice's place,
  so the page says so for the whole wait, and it ends with the wait or with whatever ends the click (a sign-out, an
  account or wallet switch, the page's teardown). Also since `7b2d74d` an abandoned flow's late session is logged out on
  its verify's headers again (RC-1, the AUD3-04 block): a body that stalls after them no longer holds every click until
  its wait runs out.
- **Abuse prevented:** none by another party; a slow read sent with a dead cookie no longer signs out a browser that has
  just signed in again.
- **Remaining trade-off:** an explicit log-out (this device's, an account switch's, an abandoned flow's) whose answer
  lands after another tab's sign-in still deletes that new cookie (T13, pinned by a guard; this tab cannot see another
  tab's requests), and that session lives on at the server until it expires; this page's own next sign-in now waits for
  them up to 5 s (saying so; no wallet phase), and past that asks nothing; a dead cookie now stays in the browser until its own
  Max-Age (at most the session's 7 days), each later read costing the one-row session lookup.
- **Files changed:** `server/auth.ts`, `docs/wallet-login/DESIGN_W1_v001.md`; `src/world/auth.ts` (`10bb630`, `f095642`,
  `7b2d74d`), `src/world/WalletPanel.tsx` (`f095642`, `7b2d74d`).
- **Tests:** `tests/auth.test.mjs` "AUD3-06: a late signed-out answer for a revoked cookie (session read, house 401, logout-all 401)…"
  (the reproduction; on `f4272c5` each held answer carried `Max-Age=0` and the jar lost the fresh cookie), "AUD3-06: the same for an expired cookie (SESSION_EXPIRED)…",
  "AUD3-06: on the page, a session read sent with a dead cookie that lands after another tab’s sign-in…", the guard
  "AUD3-06 guard: an explicit log-out whose answer lands after another tab’s sign-in still clears that cookie…" (T13;
  fails with the clear dropped from the logout 204); `tests/wallet-client.test.mjs` "AUD3-06: a refused logout-all (401) answered after another tab of the profile signed in…"
  (T12; on `f4272c5`, and with either half of the fix alone, the page ends `connected` over the other tab's sign-in).
  Four existing assertions that pinned the clear now pin its absence (an open choice): `tests/auth.test.mjs` "logout-all:
  one browser ends every live session…", "logout-all needs a live session of its own…", "sessions end at 7 days (absolute, no renewal); a dead cookie is refused, not cleared…"
  (renamed; its title said the cookie was cleared) and "N-7: the session route names an expiry only for a session that ran out…"
  (its bodies unchanged). Since `10bb630`, `tests/wallet-client.test.mjs` "ADV-3: an account switch’s logout still on its way when the click comes…"
  (the reproduction, the switch's logout held at its answer and at its request; on `125248c` B's cookie deleted and B
  left live at the server), "ADV-3: a click while this page’s sign-out is on its way…", "ADV-3: an abandoned flow’s verify still on its way when the click comes…"
  (on `125248c` the page ended signed out with B's session left live), "ADV-3: a logout of this page that does not answer never leads to a prompt…"
  (a fake timer: after `LOGOUT_WAIT_MS` no challenge, prompt or verify; once it answered, the next click signs B in), and
  the guard "ADV-3 guard: after an account switch, and on a mismatch, the click signs B in with one prompt for B…"
  (one challenge and one verify, and B keeps its cookie; fails with a click that waited not going on). Since `f095642`
  (the team's re-check of `2f5d6c1`): "ADV-3: while a click waits for this page’s logout, My wallet says so and its sign button is off…"
  (on `2f5d6c1` no notice and the button on; My wallet rendered through `tests/fixtures/wallet-panel.mjs`), one changed
  assertion in "ADV-3: a logout of this page that does not answer never leads to a prompt…" (`logout-pending` while it
  waits, then `logout-slow` instead of `session-unknown`; since `7b2d74d` the state `waiting` in place of that notice),
  and eight guards that pass on `2f5d6c1`, each failing under
  the weakening named after it: "ADV-3 guard: the sign-in click’s own logout of A still out when another wallet is chosen…"
  (that logout not held; on `125248c`, which did not wait, the new account signed in and then lost its cookie), (current v1.1 successor control) "ADV-3 v1.1: pending-only provider switch cancels locally…"
  (`providerChanged`'s logout not held; the same on `125248c`), "ADV-3 guard: an abandoned flow’s late session whose logout is still out when the click comes…"
  (`revokeAbandoned`'s logout not held; the same on `125248c`), "ADV-3 guard: signed in already as the wallet’s account while this page’s logout is still out…"
  (every click waiting; a fake timer, so no real 5 s decides it), "ADV-3 guard: a click waiting for this page’s logout goes on as soon as a read shows the wallet’s account signed in already…"
  (the wait not ending then), "ADV-3 guard: a click whose own session read finds the session it showed gone waits for this page’s logout…"
  (the wait after that read reduced to the read), "ADV-3 guard: a click that waited for this page’s logout and then finds another wallet in use…"
  (the waiting notice left behind), and the ADV-2 guard in the AUD3-04 block. Since `7b2d74d` (the team's review of `066d109`): "ADV-3: an abandoned flow’s verify whose body stalls after its headers…"
  (on `066d109` A's late session stayed live with its cookie and the click ended with `logout-slow`), "ADV-3: a session or house read that fails while a click waits for this page’s logout (503, 429, 500)…"
  (on `066d109` the read's notice beside a sign button that was on; My wallet rendered), "ADV-3: the page’s teardown while a click waits for this page’s logout…"
  (on `066d109` a client started again kept `logout-pending`), and the guards "ADV-3 guard: on a mismatch, a click that a switch to another account ends during its own session re-read…"
  (the line set without `live()`), "ADV-3 guard: “Log out this device”, or a switch to another account, while a click waits for this page’s logout…"
  (either end leaving `waiting` set), "ADV-3 guard: a click that waits only for a session read, with no logout of this page out…"
  (the line set for any wait) and "ADV-3 / R5 guard: an already-signed-in click asks nothing…"
  (retains the `asks()` waiting-line control; R5 additionally confirms that delayed old cookie-clear headers are reconciled
  without revoking the newer server session); the panel test above and the guard on another wallet in use read `waiting` since then.
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-07 — Log out all devices on a sign-in that had run out did not say it had expired · Fixed

- **Old behavior:** the server's logout-all 401 tells `SESSION_EXPIRED` from `AUTH_REQUIRED`, but `logoutAllRequest()`
  mapped every 401 to "stale" without reading the code, and `signOut` then wrote `expired:false, ended:null`: an expiry
  the server reported (reachable when this device's clock runs behind the server's; otherwise the W-1 timer ends the
  session first) read as neither expired, revoked nor signed out, and the hint that could recover the cause was cleared.
- **New behavior:** `logoutAllRequest()` returns `true` (2xx), `'expired'` (401 `SESSION_EXPIRED`), `'stale'` (any other
  401: `AUTH_REQUIRED`, or a body that cannot be read) or `false`. On a 401, `signOut` signs the page out with
  `expired:true, ended:'expired'` only for `'expired'` (`AUTH_REQUIRED` names no cause), marks the session unknown and
  re-reads it once (nothing was revoked, and the cookie the browser holds may be another tab's new one: AUD3-06). Only if
  no newer flow began during either await does it set the "other devices were not signed out" notice, after that read,
  so a failed read (429, 503) cannot hide it; and the next click reads the session before it signs (CORR-02). Since
  `901420a` (the team's review of `13449f2`, CF-3) a refused logout-all answered after a newer flow began (another wallet
  chosen while a click waited for it) reads the session afresh too; that path sets no notice (the newer flow decides).
- **Abuse prevented:** none by another party; a sign-in that ran out reads as expired, as N-7 intends, and a refused
  logout-all never looks like a success.
- **Remaining trade-off:** when the browser has already dropped an expired cookie (none is sent), logout-all answers
  `AUTH_REQUIRED` and the page cannot say "expired" (N-7's clock residual); a refused logout-all costs one session read.
- **Files changed:** `src/world/auth.ts`.
- **Tests:** `tests/wallet-client.test.mjs` "AUD3-07: “Log out all devices” on a session the server says ran out reads as expired…"
  (the reproduction; on `f4272c5` `expired:false, ended:null`, `connected`, no follow-up read), "AUD3-07: when the follow-up session read fails (429, 503)…"
  (on `f4272c5` no follow-up read, and the click asked for a challenge at once), "AUD3-07: a house read in flight across a refused logout-all whose follow-up session read fails sets no house…"
  (`bd4f749`; on `f4272c5`, and with the 401 path's `homeGen++` removed, A's house on a signed-out page), and the guards "AUD3-07 guard: an AUTH_REQUIRED or unreadable 401 stays…"
  (fails with every 401 read as `'expired'`) and "AUD3-07 guard: a logout-all answer, or its follow-up read, that lands after the account switched…"
  (fails with either `gen` check removed). Since `901420a`: "ADV-1: a “Log out all devices” the server refused, answered after another wallet became current while a click waited for it, reads the session again…"
  (fails on `13449f2`, where the page kept the session another device ended, in owner mode).
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-08 — Unusual address text could be rate-limited as an unrelated network · Fixed

- **Old behavior:** `rateLimitKey` took any trailing dotted quad as IPv4 (`64:ff9b::192.0.2.33`, `2001:db8::1.2.3.4` and
  `1.2.3.4.5` were keyed as an IPv4 /24), missed the hex form of an IPv4-mapped address (`::ffff:cb00:7101` shared one
  zero /64 with `::1` and `::`, which as a /48 also got the doubled IPv6 share), and gave any other text a key of its
  own. Every D1 share, the challenge's /64 and the limiter keys are built on it.
- **New behavior:** the whole text is parsed (`quad`, `ipv6`): a canonical dotted IPv4 (no leading zeros, each part at
  most 255); an IPv6 address with 1–4 hex digits a group, at most one `::` and a dotted quad only as the final piece.
  `::ffff:0:0/96` in hex or dotted form is that IPv4; any other IPv6 with a dotted tail stays the IPv6 /64 it is; the rest
  of the zero /64 (`::`, `::1`, `::a.b.c.d`) and any text that is not an address (a zone id, extra or missing parts,
  leading zeros, spaces) is `ip:unknown`, the key a missing header gets (`net:unknown`): one bounded allowance, never a
  bucket per string. Canonical IPv4 and IPv6 keys and the N-5 /64 and /48 nesting are unchanged; only
  `cf-connecting-ip` is read, and no dependency is added.
- **Abuse prevented:** hardening; no production request was shown to reach this (Cloudflare sends dotted IPv4 and
  compressed IPv6). Were one to, non-canonical text could no longer be keyed as an unrelated network or as a fresh
  bucket per string.
- **Remaining trade-off:** were Cloudflare to send a form this parser rejects, those clients would share the one unknown
  allowance (per location for the limiter, one network's 30 challenges a minute in D1); NAT64 addresses (`64:ff9b::/96`)
  are keyed as the IPv6 /64 they are, not as the IPv4 inside; local development with `cf-connecting-ip: ::1` is
  `ip:unknown`.
- **Files changed:** `worker/app.ts`.
- **Tests:** `tests/worker.test.mjs` "AUD3-08: address text is keyed by its real family…" (the reproduction; on
  `f4272c5` for example `1.2.3.4.5` gave `ip:2.3.4.5` and `::ffff:cb00:7101` gave `ip6:0:0:0:0::/64`; since `bd4f749` its
  unknown list also holds `1:2:3:4:5:6:7`, `beef`, `dead:beef`, `1:2:3:4:5:6:7:8::1::2` and `0:0:0:0:1:ffff:cb00:7101`,
  so the parser's group count, its one `::` and its five zero groups before `ffff` each fail it when loosened);
  `tests/auth.test.mjs` "AUD3-08: through the Worker, an IPv4-mapped hex client’s challenge row is its IPv4 /24…" (on
  `f4272c5` the 21 invalid texts got 21 keys). Two existing `::1` assertions now expect the unknown key (T34; an open
  choice): `tests/worker.test.mjs` "rate limits key IPv6 clients by their /64…" and "the sign-in budgets key a client by its network…".
- **Deployment version:** 63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC).

### AUD3-09 — Review record (not a defect): what the audit checked and what it could not check · Record only

Info, RECORD_ONLY: nothing to fix, no test. The judge's coverage statement: N-1..N-7 verified by reading the code and by
runs (but for the sign-out ordering, AUD3-04); the standing checks confirmed in code (the SIWE message re-read from D1
with every field compared, ERC-6492 refused, ERC-1271 only for an address with code and only the exact magic word, one
check per challenge, a failed check burning the challenge, one session per nonce, the token stored as SHA-256, `__Host-`
cookies, the 7-day absolute expiry, logout-all only by a live session and only for its own address, the limiters failing
closed with a missing binding as 503, `/api/me/home` from the session address only); the Solidity checklists not
applicable (there is no Solidity here); and what it could not check: the live deployment and the dry-run hash, real
Cloudflare limiters, real D1, real Alchemy, real wallets and browsers, the withheld client files, the team's private
history and Genesis Mint. It stands beside R3-R1 unreconciled (above), and its "could not check" list stays open, now
with the limiter question.

### The handoff's regression matrix (T01..T41)

The statuses below remain the historical AUD3 record. Discovery test references are refreshed to their current
AUD4 equivalents (separate probe/admitted rows); the old release algorithm and its outcomes are superseded by
AUD4_REMEDIATION.md. Historical rows do not assert that the removed release implementation still executes.

The owner's engineering handoff (in Chinese) lists the cases these fixes must cover (its §10, T01..T41). Its cases, the
tests that hold them and their state:

| Handoff | Case | Tests here | State |
|---|---|---|---|
| T01 | a pending connect, account event B, the late answer A | `tests/wallet-client.test.mjs` "R3-R1: an accountsChanged(B) that arrives while eth_requestAccounts is pending…", "R3-R1: a lock (accountsChanged([])) while the connect is pending…" | FIXED_LOCAL |
| T02 | a normal first connect with a same-account event | `tests/wallet-client.test.mjs` "R3-R1 guard: a normal first connect that emits accountsChanged for the same account…" | FIXED_LOCAL (guard) |
| T03 | a late challenge body after a switch (N-2) | `tests/wallet-client.test.mjs` "N-2: a challenge whose body arrives after the switch to another account…", "R3-R1: a wallet that changes with no provider-change event while the prompt is open…" | unchanged; the open prompt FIXED_LOCAL |
| T04 | a sign-out, teardown or wallet switch during the connect | `tests/wallet-client.test.mjs` "R3-R1 guard: a sign-out, the page closing or a wallet switch while the connect is pending…" | FIXED_LOCAL (guard) |
| T05 | N-1's orderings | `tests/wallet-client.test.mjs` "N-1: an older session read whose “signed out” body arrives after a newer “signed in” is dropped…" | unchanged |
| T06 | a read begun during the sign-out, landing after it | `tests/wallet-client.test.mjs` "AUD3-04: a session read begun while this page’s sign-out is on its way…", "AUD3-04: a house read sent while this page’s sign-out is on its way…" | FIXED_LOCAL |
| T07 | T06 with the house read 429 or lost | `tests/wallet-client.test.mjs` "AUD3-04: the same when the house read then fails or is refused…" | FIXED_LOCAL |
| T08 | the switch and abandon logouts (and the wallet switch's and the sign-in click's own) | `tests/wallet-client.test.mjs` "AUD3-04: an account switch’s logout and an abandoned flow’s logout…", "AUD3-04 guard: an account switch’s logout answered after the new account’s house read was sent…", "AUD3-04 / R5: a provider switch cancels the old prompt but preserves another tab’s newer same-wallet session…", "AUD3-04: the sign-in click’s own logout of another address’s session…", "ADV-1: the sign-in click’s own logout of A, confirmed after another wallet became current…", "ADV-1: an abandoned flow’s late session, shown by a read while a click waited for its logout…" | FIXED_LOCAL |
| T09 | a house answer for B, the re-read 429, 503 or lost | `tests/wallet-client.test.mjs` "AUD3-05: a house read answered for the address another tab signed in…", "AUD3-05: the same for a 503 and a lost connection…" | FIXED_LOCAL |
| T10 | recovery after T09 | `tests/wallet-client.test.mjs` "AUD3-05 guard: once the session read works again…" | FIXED_LOCAL (guard) |
| T11 | a late session read after a new verify | `tests/auth.test.mjs` "AUD3-06: a late signed-out answer for a revoked cookie…", "AUD3-06: on the page, a session read sent with a dead cookie…" | FIXED_LOCAL |
| T12 | a late house 401 or logout-all 401 | `tests/auth.test.mjs` "AUD3-06: a late signed-out answer for a revoked cookie…", "AUD3-06: the same for an expired cookie…"; `tests/wallet-client.test.mjs` "AUD3-06: a refused logout-all (401) answered after another tab of the profile signed in…" | FIXED_LOCAL |
| T13 | an explicit logout racing a new verify | `tests/auth.test.mjs` "AUD3-06 guard: an explicit log-out whose answer lands after another tab’s sign-in…"; `tests/wallet-client.test.mjs` "ADV-3: an account switch’s logout still on its way when the click comes…", "ADV-3: a click while this page’s sign-out is on its way…", "ADV-3 guard: the sign-in click’s own logout of A still out when another wallet is chosen…", "ADV-3 v1.1: pending-only provider switch cancels locally…", "ADV-3 guard: an abandoned flow’s late session whose logout is still out when the click comes…" | RESIDUAL (pinned) for another tab's sign-in; this page's own next sign-in FIXED_LOCAL (`10bb630`; its holds pinned since `f095642`) |
| T14 | logout-all `SESSION_EXPIRED`, the page's clock behind | `tests/wallet-client.test.mjs` "AUD3-07: “Log out all devices” on a session the server says ran out…" | FIXED_LOCAL |
| T15 | `AUTH_REQUIRED`, an unreadable body, a late answer | `tests/wallet-client.test.mjs` "AUD3-07 guard: an AUTH_REQUIRED or unreadable 401…", "AUD3-07 guard: a logout-all answer, or its follow-up read…", "AUD3-07: when the follow-up session read fails…", "AUD3-07: a house read in flight across a refused logout-all…" | FIXED_LOCAL |
| T16 | real browsers' and wallets' event order | none possible here | BLOCKED_EVIDENCE |
| T17 | the lane's index read 502 | `tests/ownership.test.mjs` "AUD3-01: a lane read that fails (502) keeps the request’s first proof…" | FIXED_LOCAL |
| T18 | a timeout or a malformed body | `tests/ownership.test.mjs` "AUD3-01: the same for a timeout and for a malformed index body…" | FIXED_LOCAL |
| T19 | the first proof unavailable, ownerOf uncertain | `tests/ownership.test.mjs` "AUD3-01: a lane delta whose new-candidate ownerOf read fails…", "AUD3-01 guard: a first proof that cannot be made…", "AUD3-01 guard: an error other than OwnershipUnavailable in the lane rebuild…" | FIXED_LOCAL |
| T20 | the key refuses after the claim | `tests/ownership.test.mjs` "AUD3-02: a refused local key reserves no admitted row; the separate probe gate allows retry after 30 s…" | FIXED_LOCAL |
| T21 | the key throws or its binding is missing | `tests/ownership.test.mjs` "AUD3-02: a key that throws makes no admitted reservation or index read and keeps the 30 s probe backoff…"; `tests/auth.test.mjs` "on imdember.com a missing AUTH, API, SEAT or CHAIN limiter binding…", "AUD3-03: a missing CHAIN_LIMITER binding at the budget is 503…" | FIXED_LOCAL |
| T22 | refused at 0 s, free at 31 s | `tests/ownership.test.mjs` "AUD3-02: a refused local key reserves no admitted row; the separate probe gate allows retry after 30 s…" | FIXED_LOCAL; the limiter assumption BLOCKED_EVIDENCE |
| T23 | unread rows at A, a buyer at B, a cost ceiling kept | `tests/ownership.test.mjs` "AUD3-02: 40 local refusals reserve nothing after 20 admitted reads; another location can admit a buyer…", "AUD4-03: 100 refused /24s reserve zero admitted rows in both rounds, without a release/update refund workload…" | PARTIAL: FIXED_LOCAL at the audit's 60 networks, the cost ceiling kept; about 80 claims in one 6 s slice at one location still fill the site-wide ceiling for every other location (60 before; measured, not pinned) |
| T24 | concurrent claims, one released | `tests/ownership.test.mjs` "AUD3-02: two /64s race and the key admits one; only its admitted row counts for the minute…", "N-6: one lane per network a minute, even when claims race…"; `tests/auth.test.mjs` "AUD3-03: of two claims of one address…" | FIXED_LOCAL |
| T25 | the release fails | `tests/ownership.test.mjs` "AUD4-03: a D1 reservation that returns changes 1 without a RETURNING row still admits; a local refusal writes no admitted row…"; `tests/auth.test.mjs` "AUD3-03: a release that fails keeps the claim counted…" | FIXED_LOCAL |
| T26 | a contract check refused by the key, no eth_call | `tests/auth.test.mjs` "AUD3-03: an ERC-1271 check the location key refused leaves no claim…", "AUD3-03: a lane check (CLAIM_LANE) the lane key refused is released…" | FIXED_LOCAL |
| T27 | 5 s later, a fresh challenge | `tests/auth.test.mjs` "AUD3-03: an ERC-1271 check the location key refused leaves no claim…", "AUD3-03: a lane check (CLAIM_LANE) the lane key refused is released…" | FIXED_LOCAL; the limiter assumption BLOCKED_EVIDENCE |
| T28 | sent, then failed | `tests/auth.test.mjs` "AUD3-03 guard: a check whose eth_call was sent and failed…"; `tests/ownership.test.mjs` "AUD3-01: a lane read that fails (502) keeps the request’s first proof…" | FIXED_LOCAL (guard) |
| T29 | replay, races, ERC-1271 and ECDSA | `tests/auth.test.mjs` "concurrent verifies of one signature create exactly one session…", "ERC-1271: the challenge is claimed before any read…" | unchanged |
| T30 | N-4's pool and lane | `tests/auth.test.mjs` "N-4: an owner’s own earlier check no longer uses up its lane…" | unchanged |
| T31 | migrations 0001–0004 against 0001–0005 | `tests/auth.test.mjs` "AUD3-03: the same on a database before 0005…", "N-5 (deployed ahead of 0005)…"; `tests/ownership.test.mjs` "N-6 (deployed ahead of 0005)…" | FIXED_LOCAL; 0004 recorded apart |
| T32 | endless pages: operations are not HTTP requests | `tests/ownership.test.mjs` "AUD3-02 guard: one admitted lane operation is up to NFT_PAGE_CAP (5) index pages…" | guard |
| T33 | canonical keys | `tests/worker.test.mjs` "rate limits key IPv6 clients by their /64…", "the sign-in budgets key a client by its network…" | unchanged but for `::1` (T34) |
| T34 | IPv4-mapped forms, dotted tails, no shared zero bucket | `tests/worker.test.mjs` "AUD3-08: address text is keyed by its real family…" | FIXED_LOCAL |
| T35 | invalid text | `tests/auth.test.mjs` "AUD3-08: through the Worker, an IPv4-mapped hex client’s challenge row…"; `tests/worker.test.mjs` "AUD3-08: address text is keyed by its real family…" | FIXED_LOCAL |
| T36 | /64 rotation | `tests/auth.test.mjs` "N-5: rotating /64s inside one /48 is still bounded…"; `tests/ownership.test.mjs` "AUD4-03: a refused /64 waits 30 s before probing again and leaves its /48 neighbour’s other probe slot…" | unchanged; the released lane row's nesting pinned (guard) |
| T37–T39 | N-3, A-2 and A-4; the standing checks; the shared cache | `tests/ownership.test.mjs` "N-3: past the 256-candidate cap…", "A-2: a refused index reload keeps the last index answer as candidates…"; `tests/auth.test.mjs` "forged signature, another key, and every altered message field are refused (401)…"; `tests/worker.test.mjs` "the Worker keeps a per-location shared copy of the snapshot…" | unchanged |
| T40 | the whole suite, types, the Worker build | `npm test`, `npx tsc --noEmit`, `npm run build`, `npx wrangler deploy --dry-run` (results above) | passing locally |
| T41 | the live source, 0005, assets and headers | none (nothing deployed, nothing read from production) | BLOCKED_EVIDENCE |
| – | the limiter's treatment of refused calls | `tests/ownership.test.mjs` "AUD4-03 residual (denials count)…"; `tests/auth.test.mjs` "AUD3-03 residual (a limiter that counts refused calls)…" | BLOCKED_EVIDENCE (pinned under both models) |

Advice weighed and not adopted, and why: reading the counts, asking the key and only then inserting the lane row (one
network's concurrent reads would each pass the read and spend a key unit, so one network could close a location's lane
key that now takes 20); the audit's plain `DELETE` of a refused lane row (it lets a network re-ask a refusing key on every
house read, with no site-wide bound, and it would change two N-6 guards); refunding a lane whose read was sent (the read
may have cost upstream); turning the Report's probe into a test (it asserts the old behaviour); and reading production
(not authorized in this round).

## R4 / AUD4 and Member M1 remediation (local, 2026-10-04)

The current local remediation supersedes the earlier implementation descriptions for the nine findings from fourth
Audit/Report snapshot `6e307de`. See [AUD4_REMEDIATION.md](AUD4_REMEDIATION.md) for the finding matrix and retained
residuals, [AUD4_MEMBER_POLICY.md](AUD4_MEMBER_POLICY.md) for contract-write/quota/retention policy, and
[AUD4_DISCOVERY.md](AUD4_DISCOVERY.md) for independent probes and admitted capacity. Historical review statuses above
describe their own snapshots and are not rewritten into whole-site guarantees. New source is not deployed; 0008 is
required before persistent M1 writes. Exact local commits, tests and rebuild fingerprints accompany this remediation.

## Genesis Mint (not changed in this round)

Genesis Mint ([REDACTED]
[REDACTED]) was not in the review's scope and was not changed. A future design
note from the remediation document §8:

> 未來 Mint 如果沿用 World session，不應直接把 World 的登入 session 當成「使用者已授權 Mint」。Mint 仍需依 Mint 專項規格與審查決定是否需要獨立且明確的簽名／交易確認流程。

(If the Mint later reuses the World session, the World sign-in session must not be taken to mean "the user authorized
the Mint". Whether the Mint needs its own explicit signature or transaction confirmation is decided by the Mint's own
specification and review.)

The boundary a Mint page on this origin starts from, written down from the Swarm retest e48d0a96 (G-1: a World session is
never a Mint authorization; G-2: SIWE relay, contracts that accept any signature and eligibility re-evaluated for Mint;
G-3: CSP, cookie, storage, wallet-method and transaction-flow changes reviewed separately; the S-2 checklist), is
`docs/security/MINT_BOUNDARY.md`. It reviews no Mint code; Mint needs its own dedicated review before it goes live.
