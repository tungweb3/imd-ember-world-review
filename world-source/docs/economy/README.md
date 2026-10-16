# EMBEO staking, payments and wallet-bound GOLD

Candidate only. The production release adapter returns `null`. Previous World
identity audits and the original EMBEO token audit do not review this new scope.
Do not activate funds, deploy contracts, apply remote migrations or publish this
World candidate before the new official Swarm report has been read and accepted
against the exact source manifest.

## User rules

- Ethereum mainnet EMBEO, 18 decimals; 100,000 EMBEO is one whole share.
- A share held for an entire UTC calendar day earns one integer GOLD after that
  day closes. UTC midnight is 08:00 Taiwan. A midday deposit waits until the next
  full UTC day; its first reward can therefore arrive the following midnight.
- Principal can be withdrawn by its owner at any time. The portion withdrawn
  earns zero for its withdrawal day. Other eligible shares and earlier completed
  days keep their rewards. Each deposit is a separate position.
- GOLD is an internal, nontransferable wallet ledger. Display-name changes do
  not move or reset it. The reward rate is not an EMBEO/GOLD exchange price.
- Each EMBEO transaction and each GOLD payment needs an explicit confirmation.
  SIWE authenticates identity; it does not authorize spending.
- There are no production products or invented prices in this candidate.

## Authority and accounting

`EmbeoStakingVault` and `EmbeoPayments` are separate immutable, ownerless
contracts. Only the position owner can withdraw principal. Product revenue goes
to the fixed payments Treasury, never through the staking principal. Exact
sender debit, recipient credit and supply invariants reject fee/rebase behavior.

The Worker can only read the chain. It accepts continuous finalized headers and
matching successful receipts from the fixed contracts; a browser transaction
hash, claimed amount, client clock or locally stored balance cannot issue GOLD.
Whenever an obtained numeric header has the announced finalized height, its
complete identity must match that finalized head, including the optional witness.
Busy blocks are verified in receipt pages. Staged rows have no economic effect
until the whole block commits atomically. A changed stored finalized hash stops
indexing and new spending persistently; ordinary provider failures leave the
cursor unchanged. There is no public reset or unhalt endpoint.

UTC settlement uses indexed position balance checkpoints and persistent page
progress. One invocation processes at most 64 positions and 32 wallets. A
wallet's reward is issued once when its page accumulation is complete; a day is
marked complete only after all eligible positions are handled. Fully closed
positions are excluded from later days, while their earlier eligible days remain
settleable. A separate minute cron drains this work. The old fifteen-minute
presence/session cleanup and identity/NFT rate budgets are unchanged.

GOLD orders capture a server catalogue price. A fresh five-minute personal
signature binds origin, wallet, order, service, GOLD amount, request, nonce and
expiry. Debit, nonce consumption, order completion and fulfillment commit in one
D1 transaction. Existing EOA persistent-write restrictions remain in force.
Order IDs are opaque server-generated 256-bit values; the wallet/request key
still supplies idempotence. Quote and challenge writes sample the server clock
again after their reads and retain the SQL session/revocation guard.
GOLD challenge/debit requests also reject a clock earlier than the persisted
quote, and a debit cannot predate its signed challenge's issuance. This prevents
cross-request clock reversal from charging GOLD with an unreadable paid timestamp;
no timestamp is clamped or invented, and rejection occurs before any write.
An EMBEO block's whole-second timestamp can predate a same-slot quote's server milliseconds;
exact payment fulfillment does not depend on that false temporal comparison.
The client accepts that same earlier chain time on fulfilled EMBEO snapshots;
server-timed GOLD debits still cannot predate their quote. Currency and order
state fields require actual strings, without coercing JSON arrays or objects.
An EMBEO order stays receivable at its original price even if its transaction
mines after the displayed quote expiry. Receipts are reconciled idempotently.

The older member `economy_accounts` cache and local GOLD prototypes are not this
ledger and are not imported. Existing verified wallet identity binds the new
account; there is no transfer, conversion, cashout, arbitrary operator credit or
principal custody role for the existing AIMarket trial administrators.

## User interface and failure recovery

The existing staking building opens a lazy World pane at `?portal=economy`.
Geometry, roads, AIMarket, the library and the game stay at their existing base.
The World scene and background audio pause under the pane; keyboard focus is
trapped and closing restores canvas focus. No new wallet library is eager-loaded.

Wallet operations verify current deployment configuration at operation/send
boundaries and guard provider, account, network events and session changes across
asynchronous reads. Quote expiry and the spending halt are checked again after
the pending-nonce RPC, immediately before intent persistence and the wallet
prompt. Owner withdrawals retain their independent exit path.
GOLD's debit request rechecks the observed spending halt after its final session
read, before posting; a later halt does not invalidate an already completed debit.
Allowance reset, exact-amount approval and execution are separate clicks. A durable send intent
pins the pending nonce and chain, and is saved and read back before broadcasting.
A same-origin Web Lock covers this entire send boundary, including the wallet
prompt; a busy lock rejects a second tab instead of queuing another send. Missing
lock support fails closed. Unknown outcomes survive closing the pane; the client
never retries a send automatically. A wrong candidate hash cannot overwrite the
original intent. Manual reconciliation of a replacement requires the same
sender/nonce/chain and a canonical finalized receipt; a different payload is
reported as replacement, not completion of the original operation. Ordinary
wallet-returned original hashes retain their normal mined-receipt confirmation.
Hashless and legacy manual acknowledgements still require explicitly checking
wallet activity; they cannot prove absence across other devices or mempools.
Adopting another tab's intent discards the unrelated prepared plan. The
contract's owner checks remain authoritative. Position-ID lookup provides an
exit for positions outside the current 200-row view or ahead of the ledger's
sync horizon.

## Verification and release

Local gates include real isolated EVM transactions, exact ABI/bytecode checks,
actual SQLite migrations/backup restore, HTTP/session/CSRF checks, UTC boundaries,
concurrent/idempotent writes, reverted/forged receipts, busy-block staging,
bounded settlement, unknown sends and the existing full World regression suite.
These are local evidence, not a Swarm approval or a mainnet deployment.

Required external gates remain: official Swarm admission/payment and accepted
judge report covering both Solidity and the offchain ledger/client; matching
source pin and findings disposition; wallet-confirmed contract deployments;
runtime/immutable readback; remote D1 backup and additive migrations; measured
Cloudflare CPU/D1 capacity; exact versioned World build/deployment and postflight.
The read-only contract preflight also compares its obtained numeric headers with
every announced finalized header at the selected common height, and compares the
two numeric identities. This detects contradictory provider responses without
claiming a cryptographic consensus proof.
Keep the prior World version and chain evidence. Rollback the frontend/Worker if
needed, without deleting ledger data or disabling owner withdrawals.

The reviewed emitter binds an event's owner/payer to its actual contract caller.
That caller may be a forwarding contract or constructor; the outer transaction's
sender/recipient is not the event owner. Exact receipt-log matching is still
required. Such accounts may accrue GOLD, while the existing EOA-only persistent
write boundary still prevents contract-account orders and GOLD spending.

Known trust/capacity assumptions: one fixed RPC provider is trusted to return
all matching logs. Receipt/header checks do not cryptographically prove absence
of omitted events. Busy-block enumeration has a 10,000-event engineering ceiling,
not a gas-derived protocol guarantee. A legitimate block above that ceiling
would stop cursor progress; large batched receipts also need capacity testing.
Final D1 folding and real Workers 50 ms CPU performance are not established by
desktop timings. The bounded minute scheduler improves throughput but does not
promise instantaneous rewards during backlogs/outages. These must be assessed in
the official review and measured before activation.
