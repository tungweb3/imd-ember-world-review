# Audit11 two-row closure matrix

Frozen source `3a1ea7d0cabd40aaf1bd171d64fa64edeb6a2548`; prior public `35ace952824ebf711fd9fa6cb7ea1cc83b75cd6a`; selected manifest SHA-256 `194c8f033c38294110613ce889fc8da8b63e4c99c603607af957c5882a3d0c42`. Final public identity is the containing immutable checkout's `git rev-parse HEAD`. TEAM source evidence is bounded PASS; external Audit12 and release readiness remain UNKNOWN. This candidate is not deployed.

| ID | Severity | Reproduced | Minimal fix | Regression | Full suite | Final |
|---|---|---|---|---|---|---|
| A11-L1 scheduled non-finite presence/session cleanup | Low | YES, same evaluator baseline assertions | [Entry guard](../../source/worker/app.ts), frozen source `3a1ea7d0cabd40aaf1bd171d64fa64edeb6a2548` | [Scheduled regression](../../source/tests/scheduled-audit11.test.mjs), 13/13 | Supported 728/728; private 1778/1778; fresh 728/728 | TEAM CLOSED BOUNDED; external UNKNOWN |
| A11-I1 scheduled non-finite index-probe prune | Info | YES, probe deletion and independent lane refund 1→2 | [Same entry guard](../../source/worker/app.ts), frozen source `3a1ea7d0cabd40aaf1bd171d64fa64edeb6a2548` | 13/13 plus independent offline 1/1; live 30s backoff unchanged | Supported 728/728; private 1778/1778; fresh 728/728 | TEAM CLOSED BOUNDED; external UNKNOWN |

A11-L1: all three invalid sample positions preserve exact rows in sessions, login challenges, presence, member requests/history and index tables; zero SQL/task/source work, readable signed-in session, advancing finite cutoff/cap controls and +10m/+60m recovery.

A11-I1: live finite probe timestamps remain unchanged, +1ms request does not reacquire the lane, finite normal expiry resumes. The independent offline fixture separately demonstrates the actual baseline backoff refund; the combined online-presence fixture alone is not claimed to prove that extra lane call.

The six earlier Audit10/Report10 issues are previously closed and unchanged. They are context only, not additional closure rows. See [actual validated stream hashes/counts](TEST_RESULTS.json).
