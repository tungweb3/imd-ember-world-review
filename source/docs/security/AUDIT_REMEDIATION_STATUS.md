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
| Deployment version | the remediation deployment of 2026-09-28: Worker version `f9b68223-19f7-4318-8274-294413b81965`, source `1a0ba21`, deployed 2026-09-28 21:05 UTC; evidence: `docs/security/deploy-evidence/20260928T210413Z-1a0ba21.md`. It is no longer the running version |
| Later deployments (the team's deployment record) | as the team's deploy records list them; the evidence pages were generated from those records on 2026-09-30 and nothing in them was read from Cloudflare or verified by a review: Worker `50c688c9`, source `2da46cd`, deployed 2026-09-29 05:05 UTC, the version both Swarm re-reviews named (its bundle SHA-256 in the record, `14584fe4…`, is the one the Report rebuilt from the snapshot); evidence: `docs/security/deploy-evidence/20260929T050441Z-2da46cd.md`. Then Worker `c89f5915`, source `5398b90` (`2da46cd` + `backlog-0929` up to `3f661eb` + `perf-0929`), deployed 2026-09-29 17:25 UTC, the running version as the team states it: it carries W-1..W-3, the undici pin `202da0b` and the removal of `SIWE_PREVIOUS_STATEMENTS` (`fc533e5`), and none of A-1..A-8; evidence: `docs/security/deploy-evidence/20260929T172429Z-5398b90.md` Then Worker `1a0dd495`, source `4321bb4` (`5398b90` + `backlog-0929` up to `3b21763` + `ui-0930` up to `188f575`), deployed 2026-09-29 19:54 UTC after D1 migration `0004_index_candidates.sql` was applied (a backup export was taken first); it carries the Swarm audit 519db624 fixes A-1..A-8 and the unofficial statement; evidence: `docs/security/deploy-evidence/20260929T195417Z-4321bb4.md`. Then Worker `6e7e40cd`, source `df8ea90` (a town re-layout with larger landmarks, cable car, boat stops, gentle weather and a new Guardian Hall; no sign-in or ownership change, no migration) was live from 2026-09-30 06:48 UTC until 09:27 UTC, when the owner had the site rolled back to `1a0dd495` (`wrangler rollback`); evidence of that deploy: `docs/security/deploy-evidence/20260930T064805Z-df8ea90.md`. Then Worker `cc5cddb3`, source `007ee80` (`132228c` = the `1a0dd495` source + gentler bad weather with a calm-sky switch, a 1.5x Pepe statue, the v002 Guardian Hall at 1.3x, three more ember-boat stops and a cable car, on the live layout with no home moved; no sign-in or ownership change, no migration; the Worker bundle SHA-256 is unchanged, `1018f02a…`), deployed 2026-09-30 14:53 UTC; evidence: `docs/security/deploy-evidence/20260930T145241Z-007ee80.md`. Then Worker `3e0f4eb3`, source `a77f91b` (`3776052` + a faster retry of the first failed world read, 5 s then 15 s, and "connecting" wording while that first load is on; client only, the Worker bundle SHA-256 unchanged, no migration), deployed 2026-09-30 15:48 UTC; evidence: `docs/security/deploy-evidence/20260930T154746Z-a77f91b.md`. Then Worker `5f9e6468`, source `41ae386` (`461c3a2` + the landmarks grown in place with no home moved: the Oracle Tower 1.5x, the Archive Hall 1.35x moved 4.1 m with the east road rerouted, the launch dais 1.35x landward, the forge and the Memory Gate 1.35x taller, the hall's crown, the longhouse 1.12x, the Guardian Hall back to 1.55x; client only, the Worker bundle SHA-256 unchanged, no migration), deployed 2026-09-30 18:58 UTC; evidence: `docs/security/deploy-evidence/20260930T185800Z-41ae386.md`. Then Worker `f152cd66`, source `0d57791` (`38cf3a4` + six cable-car cabins instead of three, the mill house by the Ember Forge removed and the forge grown 1.3x landward with a yard where the mill house stood; client only, the Worker bundle SHA-256 unchanged, no migration), deployed 2026-09-30 22:20 UTC; evidence: `docs/security/deploy-evidence/20260930T221950Z-0d57791.md`. Then Worker `bbf24001` (source `2e4e830`: `0d57791` plus the Swarm audit 8c3aea2e fixes N-1..N-7; D1 migration `0005_lanes_and_subnets.sql` applied first, at about 04:09 UTC after a backup export; the Worker bundle SHA-256 changed to `018df7b3…`), deployed 2026-10-01 04:10 UTC; evidence: `docs/security/deploy-evidence/20261001T040934Z-2e4e830.md`. The running version is `bbf24001`. |
| Re-review | two Swarm re-reviews of Worker `50c688c9` (source `2da46cd`, public snapshot `b6e986be`, Worker bundle SHA-256 `14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4` as the Report rebuilt it from the snapshot), both 2026-09-29 (UTC): Report `e48d0a96` (a retest; deployment match partial) and Audit `519db624` (no report file; deployment match not assessed). Neither verified the running Worker. Both are listed on the site since Worker `1a0dd495` (the team's deployment record); this version's changes were not re-reviewed. See "Swarm retest e48d0a96" and "Swarm audit 519db624" below |
| Later review | Swarm audit `8c3aea2e` (template Audit), judged 2026-09-30 13:45 UTC, of Worker `1a0dd495` (source `4321bb4`, public snapshot `ae1d41a`, Worker bundle SHA-256 `1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c` as one of its reviewers rebuilt it from the snapshot, equal to the team's deploy record; no deployment-match verdict): 6 Low and 1 Info, N-1..N-7. Fixed in Worker `bbf24001` (source `2e4e830`, deployed 2026-10-01 04:10 UTC, after D1 migration 0005; fix commits `f65a900`, `11392d8`, `5261844`); these changes were not re-reviewed. See "Swarm audit 8c3aea2e" below |

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
fix status is as reported by the site maintainer."

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
- The recorded type and method are for audit and debugging; they grant nothing and `/api/auth/session` does not return
  them. Seat ownership is always proved with `ownerOf` on Ethereum mainnet.
- **Risk (F-2, stated, not fixed):** the contract decides who may sign for it. A contract that accepts any signature
  (some vaults, escrows, badly written wallets) lets anyone sign in as it, and if it holds a seat, anyone gets owner
  mode for that seat (today a read-only view on the player's own screen). The `CONTRACT` mark makes such sessions
  visible in D1; it does not reduce that risk. Anything that later grants more than a view to a session must not rely
  on an ERC-1271 sign-in alone.

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
| L4 per location | `CHAIN_LIMITER` keys `chain:erc1271` / `chain:erc1271:known` / `chain:erc1271:lane` (`eth_call`) | 20 a minute each | 429, fails closed |
| L5 global | challenge valve, emergency ceiling only; 20 of every 60 only for a network with no challenge in the last minute (`backlog-0929`, A-7) | 60 per 6 s (600 a minute) | 429 `SIGN_IN_BUSY` |
| House read | an NFT-index read `chain:index` refused whose answer counts no seat: its network's discovery lane, counted in D1 (`index_lanes`), then `CHAIN_LIMITER` key `chain:index:lane` (`bbf24001`, N-6) | 1 a minute per IPv4 /24 (IPv6 /48: 2, one per /64); 60 per 6 s site-wide; the key 20 a minute per location | the read stays `limited` (could not check); the key fails closed |

A missing limiter binding answers 503 on the routes that need it (off loopback). Logout and logout-all are never rate
limited. Every 429/503 of the account routes writes one JSON line (`evt`, `route`, `status`, `error`, `reason`,
`colo`, `net`, `walletType` when known); a surge line has `evt`, `route`, `reason`, `addr`, `colo`, `net`. About the
client they carry exactly `net`, a key derived from its IP (IPv4 /24 `net:a.b.c.0/24`, IPv6 /48 `net6:x:y:z::/48`,
`net:unknown` without one), and on surge lines `addr`, the address's first 6 characters (`0x` and 4 hex digits); never a
full IP or full address. Workers Logs sample invocations at 0.2 (`wrangler.jsonc` observability), so
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
  included writes).
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
