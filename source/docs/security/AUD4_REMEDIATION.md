# R4 / AUD4 remediation — World/Auth/Member M1

Date: 2026-10-04 (Taipei). This is a local implementation and regression record, not a new external audit conclusion. The fourth review examined public snapshot `6e307dea76e763936fc4ac86e54c9f5d558f58c4` (parent `8cad017fad58bac89d88fa72d530d3c56160009b`). The private repair baseline is `c491ff3c9edf9d0eb39a9233ccfff101a7c8133c`, whose deployed-source parent is `ddb10e28a867998323164e7585635efedfcf7788`.

The eight Audit findings and the Report's independent M1-R2 are nine unique fixes. Report M1-R1 shares the atomic-budget fix with AUD4-05. The exact final commits, executed totals, build hashes and changed-file list are in the accompanying remediation evidence. Production remains frozen; no remote migration or deployment is part of this work.

## Finding matrix and regression setup

All route fixtures use the actual Worker with a node:sqlite D1 adapter, synthetic sessions and fake chain/limiter responses. Client fixtures use synthetic providers and controlled response ordering. These fixtures do not establish production Cloudflare, real-wallet or complete WorldApp/browser behavior.

| ID / source | Local implementation | Regression events and expected results |
|---|---|---|
| AUD4-01 / Audit #1 / R4-01 | Bind logout-all to expected authenticated address; mismatch is 409 ACCOUNT_CONTEXT_CHANGED with no revoke or cookie/challenge changes. Client rereads session and makes no false all-devices claim. | Display A/cookie A revokes A only; display A/cookie B leaves A and B live and restores actual B or remains unknown on read failure. Absent, forged and expired cookies cannot choose authority. `aud4-auth.test.mjs`; existing F-4/cross-tab tests. |
| AUD4-02 / Audit #2 / R4-03 | Temporarily restrict persistent M1 writes and GET last-login touch to server-classified EOA/ECDSA sessions. CONTRACT/ERC1271 and unknown metadata get stable 403 CONTRACT_WRITE_NOT_ENABLED for bootstrap/PUT; login and existing-profile reads remain available. | Permissive ERC1271 contract may authenticate but creates no member/profile/history/request row or cookie via M1. Existing contract/unknown profile reads do not touch last_login. EOA writes work. `aud4-member-server.test.mjs`, `member-r4.test.mjs`, MemberPanel SSR. Legitimate smart wallets have the same explicit temporary write restriction. |
| AUD4-03 / Audit #3 / R4-09 | Separate 30-second per-network probe reservations from admitted index work. Local limiter refusals never insert admitted index_lanes rows. READY → atomic independent probe → local limiter → fresh-clock atomic admitted reservation → index read. | Original 80 refusals yield zero admitted rows/index calls; other colo buyer can discover. IPv4/IPv6 and 61 racing admissions respect 60 global/6s and network limits. Probe refusal/failure/concurrency/backoff/prune and both limiter accounting models are checked. `aud4-discovery.test.mjs`, updated AUD3-02 ownership cases and probe cron cases. |
| AUD4-04 / Audit #4 / R4-05 | Indexed request/history expiry cleanup independently scheduled; eligible writes also prune small batches. Requests eligible after one day; history after 180 days. | A member who never successfully renames still has expired refused records removed. Unexpired idempotency/current profile remain; per-table 200 cron/10 opportunistic caps, backlog draining, missing schema and storage errors checked. `aud4-member-server.test.mjs`. |
| AUD4-05 / Audit #5 + Report M1-R1 / R4-04 | 0008 BEFORE INSERT trigger atomically enforces five recorded logical attempts/member/rolling minute. Outcome insert and successful mutation share a D1 batch; same-key retries reuse saved outcome. | 6, 12 and 20 unique concurrent attempts never create more than five records. Success/refusal/cooldown/stale/no-op share budget; different members and separate IP limiter; same-key winner, conflict, retry-at-full-budget and rollback verified. Sixth new attempt returns 429 NAME_RATE_LIMITED and does not mutate profile/history. `aud4-member-server.test.mjs`, original member tests. |
| AUD4-06 / Audit #6 / R4-02 | A potentially committed verify with unreadable/invalid response remains unknown and reconciles GET session before another SIWE flow. Generation guards and nonce-conditioned abandoned cleanup remain. | Cookie installed before truncated/malformed JSON or fetch failure → one personal_sign, one session, successful readback. Failed reconciliation stays unknown; a repeated click reads again before a prompt. Confirmed absent session permits fresh flow. Account/provider switch or teardown cannot restore abandoned identity, and cleanup cannot revoke a newer session nonce. `aud4-auth.test.mjs`, existing R3-R1/N-2. |
| AUD4-07 / Audit #7 / R4-07 | Save fetch/body has 15s deadline; one automatic retry uses identical requestId/body. Unsettled operation remains pending per wallet and offers recovery rather than a new rename. Terminal handling releases saving. | Commit then lost body → same-id retry/readback exposes committed version, saving=false, one logical rename/history/cooldown mutation. Both responses lost/early IP refusal/never-ending body/account switch/return-to-same-wallet preserve prior operation. `member-r4.test.mjs`. |
| AUD4-08 / Audit #8 / R4-08 | Cooldown uses calibrated server time, rerenders/reloads at deadline and cancels timer on teardown/account change. Server remains authoritative. | Before deadline disabled; at/after deadline refreshes. Advancing client clock cannot bypass server cooldown; teardown causes no extra GET. `member-r4.test.mjs`. |
| M1-R2 / Report / R4-06 | Profile load sequence plus account generation and highest accepted member version prevent read or save responses from regressing state. | GET(v0 starts), save v1, old GET(v0 arrives) keeps v1. GET2 before GET1, late 401/error, newer GET(v2) before PUT(v1) response and switched-account responses cannot erase accepted state. `member-r4.test.mjs`. |

Tests assert status, relevant DB rows/version/history/session counts and client state. Auth uncertain-completion tests explicitly count personal_sign prompts. Member/route-only tests do not have a real provider; absence of new wallet permissions is also checked by the retained wallet-method suite and static source inspection.

## Auth consistency and uncertain completion

`expectedAddress` is a consistency assertion, not authorization. Live cookie validation precedes comparison and only its authenticated address may be revoked. Invalid expected values are 400; no live session remains 401. A 409 does not broadcast successful logout-all. Failed reconciliation leaves state unknown rather than proving sign-out.

Verify headers/cookie and response body can complete independently. The client records uncertain delivery before sending verify. A definitive non-OK response is a failed verify; potentially committed transport/body/schema failures cause session readback. During readback sign-in remains busy or unknown, and cannot request a second signature on the assumption of sign-out. Exact server-built SIWE and existing account/provider generations remain.

Abandoned verify cleanup optionally sends its challenge nonce to ordinary logout. This nonce is not authority: the server compares it with the cookie session's stored nonce. A newer session, even of the same address, returns 409 without revocation or cookie/flow changes. If a newer challenge has begun but its session has not yet been installed, cleanup revokes the abandoned session and only its original challenge flow, preserving the newer challenge's flow cookie. A pruned old challenge does not cause a newer cookie's flow to be inferred. Existing explicit logout with no nonce retains its behavior. Generation/nonce guards cannot stop the browser applying a late Set-Cookie after the request-time comparison; that cross-tab timing boundary remains explicit.

## Write policy, atomic quota and retention

See [AUD4_MEMBER_POLICY.md](AUD4_MEMBER_POLICY.md) for exact server policy, trigger/batch semantics, same-name no-op behavior, idempotency and deletion caps. The temporary policy intentionally restricts legitimate smart wallets too; it is not an EOA-signature fallback or permanent smart-wallet authorization design. Unknown/legacy session metadata cannot self-assert EOA. A future smart-wallet write rule requires a separate scoped design and review.

Expiry is deletion eligibility, not a guaranteed hard deadline. Bounded cron can accumulate backlog when sustained incoming records exceed drain capacity; monitor and size batches before production changes. Missing 0008 blocks persistent writes; reads do not silently install schema or touch last-login.

## Discovery budgets and costs

See [AUD4_DISCOVERY.md](AUD4_DISCOVERY.md). The strict admitted-work ceiling stays in atomic D1 SQL. Independent probes retain the previous 30-second network retry interval even on local refusal or binding failure, without counting refused attempts toward the admitted global ceiling. Each probe deletes at most two expired markers; cron independently deletes at most 200. Probes have no global fail-closed cap which would recreate cross-location starvation. Consequently aggregate new-network probe storage/write pressure is not a hard global DB invariant; edge/session/API limits and cleanup backlog remain operational boundaries.

The model distinguishes refused calls counted and not counted by a sliding local limiter. Production's eventually consistent limiter is not exact accounting; DB tests must not be presented as proof of its real semantics. Already-admitted index work remains charged when upstream fails, and the first ownership proof is retained.

## Required migration and deployment boundary

`0008_member_hardening.sql` applies after 0001–0006 and deliberately excludes Coin E1 migration 0007. It adds the attempt trigger, request/history expiry indices, and independent probe table/indices. Use a fresh local D1 for validation when the migration changes; applying an earlier 0008 and rerunning migration discovery is not evidence for the updated SQL.

Full-source build and sanitized-source Worker build must agree on Worker SHA-256/size for the exact repair commit. Compare with the recorded deployed Worker `acdbb2bd-8add-4b15-bfa6-a31266c83520`, 303128 bytes, SHA-256 `cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518`. A changed local bundle is expected and is not evidence that production has changed. No deployment version is invented for a dry run.

## Remaining residuals and review limits

- R3-R1's reproduced scenario remains fixed in synthetic tests; missing provider events and real-browser behavior remain limitations.
- AUD3-02's retained-refusal admitted-cap defect is locally fixed; shared/global budgets, denial-counted local availability, IPv6 network sharing, many networks and incomplete discovery candidates remain residuals.
- AUD3-05 remains partly fixed; refresh/display windows and shared cookie timing remain.
- AUD3-09 remains a review-limit record, not a bug declared fixed.
- Permissive ERC1271 contracts still define their own login truth. The new M1 policy narrows persistent writes; it does not solve their login/read trust boundary or future smart-wallet write authorization.
- Shared-origin malicious code/phishing relay remains relevant to EOA profile writes as well as login. A name is public social data, not official identity/ownership or mint eligibility.
- Production D1 concurrency/quotas, bindings, WAF, limiter counting, upstream availability, actual deployed routes and full WorldApp/real-wallet/browser integration are not established by local fixtures or dry runs.

World requests only `eth_accounts`, `eth_requestAccounts`, and `personal_sign` for exact SIWE. House authority remains authenticated address plus Ethereum mainnet ownerOf/eligibility. No Genesis Mint, Coin E1, 0007, Solidity, check-in, asset transfer/approval, Permit/Permit2, delegated permissions, session key, wallet batch or unrelated gameplay/UI redesign was introduced.

## Fifth independent Report / Audit handoff

Review the exact new sanitized commit, using public parent 6e307dea76e763936fc4ac86e54c9f5d558f58c4. Independently retest all nine IDs, including M1-R2 and both reproductions for M1-R1/AUD4-05, then retained R3/AUD3/N/ADV and Enter/Home gates. Evaluate temporary smart-wallet policy, strict DB vs infrastructure limits, idempotency, uncertain-completion event ordering and bounded cleanup. Separate reproduced facts, inferences, team claims and unavailable environment checks. Preserve partly/residual/unknown statuses. Complete output means report completion, not absence of vulnerabilities or certification.

No public push, paid job, remote migration, deployment or unfreeze is authorized by this local remediation record. Review the supplied package and exact commit before separately authorizing those actions.
