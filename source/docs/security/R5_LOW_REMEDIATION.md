# R5 Audit Low remediation — World / Auth / Member M1

Date: 2026-10-04. This is the maintainer's local implementation record, not an independent closure verdict.

Baseline source: `54410b2f8dece71bdb2fd999c94feea6454ecfcd`.
Fifth public review snapshot: `357668f37c75317f79ff2266795636597a707c04`.
Audit job: https://explorer.imd.fun/jobs/e137990d-8dbc-4153-ae11-cada783827ea
Report job: https://explorer.imd.fun/jobs/0860e448-e960-43af-9a1c-5eed9019ef04

The Report's aggregate 7 locally fixed / 2 partly does not override the Audit's four new Low counterexamples.
R4-02 and R4-08 remain pending independent closure; this change supplies targeted local fixes and regressions.

| Finding | Implementation | Local regression evidence |
|---|---|---|
| LOW-1 — switch cleanup affects newer shared-cookie context | Retain the original flow nonce; automatic cleanup sends `expectedNonce`, or `expectedAddress` when only a displayed session is available. No assertion means no automatic logout. Nonce/address are consistency assertions, not authority. The server requires the matching token for revocation and preserves a different current pending flow. Successful or refused cleanup reconciles the cookie when needed; identical address/expiry is not treated as session identity. | Account/provider switches with newer B, newer same-wallet A, pending-only replacement; wrong/missing/forged/dead authority; pruned original challenge; original-flow-only cancellation; delayed completion with a new same-address/expiry session. |
| LOW-2 — teardown skips uncertain-session cleanup | Retain uncertain flow cleanup responsibility independently of UI generation. Teardown and late reconciliation perform nonce-bound cleanup. Mount lifetime guards prevent late callbacks from changing a stopped/restarted client's state, channel or timers. A valid accepted read releases retained responsibility, so normal stop does not revoke an accepted session. | Verify committed then malformed body, held/failed read, stop/restart, newer same/different wallet and pending challenge; accepted PRESENT then normal stop; confirmed ABSENT then new flow; late preflight 204 across restart. |
| LOW-3 — invalid session response becomes absence | Confirm only an object with `signedIn === false` (optional boolean `expired`), or `signedIn === true`, valid address and positive safe-integer expiry. Invalid schemas/JSON/transports leave `sessionKnown=false`; repeat clicks read again and cannot issue another challenge/signature until valid reconciliation. | Table-driven malformed/missing/wrong-type schema, invalid address/expiry, NaN/infinity wire encodings, truncated JSON, 429/503/network/timeout injection, valid PRESENT/ABSENT controls; prompt/session counts and state/order diagnostics. |
| LOW-4 — wall-clock correction extends rename cooldown | Anchor serverTime to `performance.now()` elapsed duration. A timer only triggers a server profile refresh; it cannot unlock the form. Failed/invalid refresh retains cooling and retries after 60 seconds. Timer generation/run guards reject stopped or switched callbacks. | Independent wall/monotonic clocks, forward/backward wall jumps, early/late timer callbacks, server-confirmed expiry, failed refresh and positive retry, teardown/account switch. |

## Test files and evidence interpretation

- `tests/auth-r5.test.mjs`: real Worker/routes, existing migrations and node:sqlite. Generated in-memory EOA keys actually sign server SIWE; provider/upstream fixtures are local. Diagnostics include ordered route/status/assertion/cookie-presence events, client transitions, prompt counts, created/live/revoked sessions and pending/invalidated challenges. Credentials, private keys and signatures are omitted.
- `tests/auth-r5-authority.test.mjs`: independent server authority and context-isolation controls, including actual successful verification of a preserved newer pending challenge.
- `tests/member-r5.test.mjs`: separately controlled server, wall and monotonic clocks plus deterministic timer callbacks.
- Existing auth/wallet/member suites are retained. Older tests that expected unconditional cancellation of another tab's newer same-wallet session now assert its preservation. Assertions forbidding all subsequent requests now allow authoritative GET reconciliation, while still forbidding wallet prompts/new writes. A fresh read's confirmed expiry/revocation is not erased to preserve an obsolete neutral-label expectation.

The full package test command, TypeScript check, Vite build and Wrangler dry-run are recorded against the new private commit in the accompanying build evidence. A dry-run is not a deployment and has no Cloudflare version ID. No tests are intentionally skipped.

## Authority and remaining limitations

1. A nonce alone cannot revoke a session whose token this browser no longer holds. When B replaces A's token, an A-bound cleanup refuses the request without changing B's session/challenge/cookies; A can remain live until another authorized logout or expiry. Cleanup does not acquire cross-session authority.
2. An address-only assertion cannot distinguish two sessions for the same address. Uncertain flows use the retained nonce; address fallback requires the request's live session and cleans only that session's original flow.
3. If an authorized old logout is processed before a newer session is created, its delayed `Set-Cookie` clearing headers can remove the newer browser cookie. The newer server session is not revoked. Fresh reconciliation reflects the actual cookie and withdraws stale owner evidence. Conditional request binding cannot retroactively suppress headers already emitted; this transport race remains documented and has a regression control.
4. Teardown cleanup is best effort in a still-running JavaScript context. Browser/process termination or lost requests cannot guarantee delivery. No new bounded auth-read timeout was added; timeout regressions inject rejection, not proof that an indefinitely stalled real fetch is bounded.
5. Synthetic timer delays model background/throttling behavior. Real browser/OS clock changes, suspension, real wallet UX, deployed Worker/D1 concurrency, WAF/limiter bindings, upstream availability and ERC-1271 behavior were not newly verified by these local tests.

R4-03 remains partly by smart-wallet write policy; R4-09 retains availability trade-offs; AUD3-05 remains partly; AUD3-09 remains a review-limit record. They are not relabeled fixed. No certification, zero-vulnerability or fund-safety claim follows from passing tests or completed/accepted jobs.

Scope stays World/Auth/M1. Wallet methods remain `eth_accounts`, `eth_requestAccounts`, `personal_sign`. No Genesis Mint, Solidity, Coin E1, check-in/rewards, token transaction, approval, Permit/Permit2, typed-data signing, wallet batching or delegated permissions were added. No migration was changed or applied.

This request implements local repairs only. Production and the fifth public snapshot remain unchanged until a separately recorded deployment/publication; a sixth review has not been submitted by this change. Any later public snapshot must continue to exclude private 3D models, textures/scenes, full World presentation assets, secrets, backups and private Git history.
