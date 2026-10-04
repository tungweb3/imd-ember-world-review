# R8 v1.1 targeted closure — local candidate

Date: 2026-10-04. User submission label: **seventh Swarm Audit / Report**. This label does not rename prior R7/R8 implementation records. The finding reference is public `c4f451b015abdaced6c35a717b29f5bb1cb351c0`. The local repair parent is `f9a34cba0876306287b35aff0176e9dc38942624`. Exact new private/public commits and changed-file manifests are supplied by the delivery/publication receipts; no private Git history accompanies the public review source.

Recommendation: ready to prepare a **targeted offline external review** of the measured candidate. Production parity and the external verdict are outstanding. No `WORLD_SECURITY_BASELINE_v1` has been established. No paid job, deployment or wallet operation is asserted by this document.

## Finding disposition

| Item | Implemented behavior | Local evidence |
|---|---|---|
| LOW-1 terminal owner | RELEASED/CONSUMED have no nonce authority. Account/provider context change still selects the displayed address. Same address and expiry, or an old request in flight, do not identify the current session. | auth-r8 and auth-v11 real Worker/SQLite; retained old nonce plus newer same-address/same-expiry row control |
| LOW-2 accepted PRESENT / sibling | Acceptance precedes optional home I/O. Hint emission is at most once; a missed hint cannot substitute for the next click's own canonical read. | independent lost-hint and slow-body-sibling traces; zero sibling prompt/challenge/verify after observing matching PRESENT |
| LOW-3 pending vs displayed | Pure event planner selects one primary decision. Pending challenge cancellation is local; displayed expectedAddress cannot be replaced by stale pending/retained nonce. Distinct events can have independent requests. | displayed-pending real trace and account/provider controls; no competing pending nonce POST |
| LOW-4 restart | Detached old cleanup schedules a current-life canonical reread when idle. It cannot directly install old UI or write through the stopped channel. | restart-cleanup traces, newer-session row preservation and late clear-cookie controls |
| LOW-5 ownership | Discovery and cryptographic deadlines are independent. Existing positive/negative results retain one 30-second epoch/block; unseen IDs get bounded deltas; failed new IDs wait for that epoch's deadline. | 28 new ownership controls; repeated refused refresh x20 costs one RPC; index@0/proof@31/fresh@32 costs two total RPCs |
| LOW-6 freshness | Shared finite, nonnegative, exclusive-TTL helper covers Auth/home/public names, scoped bridge retries, polling classification and ownership caches. Future quote/floor stamps cannot be current. | freshness-v11, auth-r8 backward sold/revoked/refused cases, actual proof completion clocks |
| INFO-1 wallet lock | Preserve accepted session. Cancel an unfinished click; reconcile uncertain verify after its response fence. A later valid canonical read can resolve the owner after an initial 503. | idle/active lock independent traces and lock-503/recovery/stop real regression |
| INFO-2 market numbers | Runtime quote/floor boundary rejects non-finite prices/derived figures. Invalid optional fields become absent; finite negative changes remain valid. | fallback/wire overflow/floor USD and parsed-future-floor normalization controls |

The report verdict matrix is bookkeeping, not another defect. These are local dispositions that the external reviewer must independently confirm, not eight predeclared Swarm closures.

## Independent evaluator

`tests/auth-reference-model.mjs` has no imports. It describes normative observable policy and abstract credential identities separately from production controller state. The driver executes the selected real AuthClient, actual Worker handlers and migrations over `node:sqlite`; synthetic providers/upstreams/clocks permit controlled transport.

Transport steps distinguish dispatch with captured cookies, Worker/DB commit, browser headers/Set-Cookie, fetch visibility and body completion. Exact comparisons cover canonical knowledge, displayed address, prompt/challenge/verify/hint counts, conditional cleanup command types, cookie aliases, live/revoked session rows and pending/used/invalidated challenge rows. Worker execution is one scheduler step, not an exhaustive D1 internal scheduler.

Final integration measured **500/500 seeded schedules**, 13 causal kernels, **428 distinct normalized action digests**, 3,572 real Worker executions, 5,477 SQLite comparisons, 3,649 cookie comparisons and 3,402 client projection comparisons. Thirty-eight traces execute transport failure before headers. Fixed/calibration tests and no-op seeds are not added to the 500 count.

The unchanged oracle/driver also rejects three targeted frozen-parent client intents: missing own-click preflight (AUTH-I3), competing pending nonce cleanup (AUTH-I5), and uncertain lock auto-logout (INFO-1). Original failure actions and bounded minimized actions were actually replayed against the parent and reproduce the same invariant/witness. Deletion minimization has a 36-trial limit; it is not a proof of globally smallest trace. Candidate full-action replay succeeds. A later test-file change only extended provenance input enumeration; it did not change policy/driver semantics.

## Required fixed ordering matrix

| Required case | Executable control |
|---|---|
| PRESENT, held home, account switch | auth-r8; reference kernel held-home-account |
| PRESENT, held home, provider switch | auth-r8; held-home-provider |
| Slow valid verify body, sibling stale ABSENT | slow-body-sibling, headers accepted before held body and sibling explicit click |
| Displayed session plus pending nonce, switch | displayed-pending asserts a live CHALLENGE_READY click at the switch; auth-v11 same-address retained-owner control |
| Stop, cleanup in flight, restart | auth-r8/R5 cross-life controls; restart-cleanup |
| Refused fresh index budget x20 | ownership-v11 checks exact budget/index/RPC counts and preserved proof deadline |
| Backward clock, sold seat | auth-r8 real owner poll; ownership-v11 proof TTL and completion-clock controls |
| Backward clock, revoked session | auth-r8 real owner poll; backward-revoked |
| Lock, no active click | lock-idle; committed row survives lock and stop |
| Lock, active click | lock-active; prompt cancellation and uncertain post-fence reconciliation; failed-read recovery in auth-v11 |
| Missed signed-in hint | lost-hint; sibling explicitly clicks with stale local ABSENT and observes canonical PRESENT before any prompt |

AUTH-I1..I7 and I9..I10 have real client trace/fixed controls. AUTH-I8/I11/I12 retain actual server authority/concurrency controls in auth.test, auth-r7-authority and R5/R7/R8 fixtures; the bounded scheduler additionally calibrates dead-cookie and newer-pending laws. OWN-I1..I3 have exact block/time/call-count controls; OWN-I4 uses the real periodic client poll; OWN-I5 retains server home/roster/name authority regressions.

## Integration and calibration results

- Private complete project: `node --test --test-reporter=tap --test-concurrency=3 tests/*.test.mjs` — **1,528 passed, zero failed/skipped/cancelled/todo** on Node v24.19.0.
- `tsc --noEmit` and Vite production build — exit 0. The existing large frontend chunk warning remains; no performance claim is made from a successful build.
- Final compilation/test input manifest covers 337 scoped files; hashes agree before/after the final gates. Source documents are separately reviewed and frozen in the commit.
- Ownership final focused suite including discovery and record consistency: **139/139**. Same new 28-control evaluator on frozen f9: **8 passed / 20 expected failures**.
- Scoped freshness suite plus existing related regressions: **51/51**. Same new 9-control evaluator on frozen f9: **3 passed / 6 expected failures**.
- Independent oracle controls reject illegal UNKNOWN prompts, missing click receipts, duplicate prompts/hints, stale UI projection and terminal nonce resurrection; valid controls pass.

The first complete suite was **1,525/1,527**. It found a real slow-discovery regression: an old epoch was tested using the request's earlier clock after the lane waited. The fix re-evaluates epoch validity using the completion-side clock, reproves at latest after expiry, and preserves eligible=1 plus actual D1/index/proof timestamps at T+60s. An added sold-seat control holds discovery across proof expiry. The second failure was stale documented test-name references; only those references changed. Both failure logs are retained privately; the full suite above was rerun after the fixes.

Independent review also found and closed lock-503 recovery and old same-address nonce suppression. Intermediate passes from the rejected suppression version are historical, not final-source evidence. Public filtered tests are recorded separately; these private totals are team measurements, not claims that withheld frontend/3D files were reviewed publicly.

## Preserved boundaries and limits

Server Auth and World API files, wallet discovery, headers, package lock/config and seven migrations remain unchanged against f9. Wallet request methods remain eth_accounts, eth_requestAccounts and exact SIWE personal_sign; HTTP POST is separately an API method. No Genesis/Mint/Solidity/Coin0007/rewards/new API or 3D feature change is included.

The source boundary check covers 250 unchanged product files. One pre-existing clone checkout difference is CRLF vs LF in the unrelated playerBody file; normalized text is identical and no 3D/body change is made by this patch. Model binaries remain byte-identical locally and are excluded from the public review package.

See `docs/security/AUTH_STATE_MACHINE.md`, `OWNERSHIP_FRESHNESS.md`, `docs/security/FRESHNESS_BOUNDARIES.md` and proposed `docs/security/SECURITY_BASELINE_LIMITS.md`. A GET is not a cross-tab atomic lock; late authorized cookie clearing, process termination, auth transport deadlines, persistent upstream/cross-isolate capacity, physical OS/providers and production configuration remain bounded or unmeasured as documented. Passing tests and external completion are not certification, endorsement, fund-safety proof or zero-vulnerability evidence.
