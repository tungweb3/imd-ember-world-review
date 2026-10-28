# Wallet lock (錢包封鎖區)

The wallet-related files that the Swarm audits reviewed (wallet sign-in R5-R12; wallet controller, GOLD purchase,
checkouts, staking panel and deploy tool in Submission13-18, last audit `f6bd50ad`, fixed in `7021b5b`, Worker `a92a767c`)
are locked: `LOCKED` in `scripts/wallet-lock.mjs`, hashes in `security/wallet-lock.json`. `tests/wallet-lock.test.mjs` fails
if one of them changes or is removed, and the deploy tool runs the full suite, so such a change cannot be deployed by
accident. Changing a locked file means the audit no longer covers what runs.

The lock is a warning, not a ban:
- Before editing a locked file, warn the owner in plain Chinese (「這會動到錢包封鎖區，改完必須重新送 Swarm audit」) and wait
  for their decision. The owner considers this very important.
- Once they approve: make the change, run `node scripts/wallet-lock.mjs --update --reason "what changed and who approved it"`,
  and deploy as usual. Remind them the change needs a new Swarm audit; when to send it is their call.
- Give the same warning for a change outside the lock that alters how a locked file behaves (for example the GOLD and
  checkout routes in `worker/app.ts`, or their settings in `wrangler.jsonc`).
- Never refresh the hashes just to make the test pass, and never weaken or skip `tests/wallet-lock.test.mjs`.
- `node scripts/wallet-lock.mjs` alone checks the lock.
