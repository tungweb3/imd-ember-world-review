# Wallet login W1 — design v001 (2026-09-28)

Scope W1: SIWE sign-in, 7-day server sessions, ownership verification, owner mode UI, the My-wallet asset panel, and a
presence recorder. [REDACTED]
The local move flow (localStorage `ember-world-moves-v1-*`) stays local; since the H-A hardening it needs the SIWE
session and no second signature (see Amendments at the end).

Binding inputs: owner decisions 2026-09-28, security requirements of the external spec
(`wallet_spec.md` §4, §5, §8, §10–12; its one-house-per-NFT model is NOT used). [REDACTED]
Two facts: 32 holders are EIP-7702 delegated EOAs (so
ECDSA first, ERC-1271 second), and `/swarm.owners` matched on-chain `ownerOf` for all 430 agents on 2026-09-27.

## 0. Audit (what exists on main c8c41f8)

| Area | Found | W1 consequence |
|---|---|---|
| `src/world/wallet.ts` | EIP-1193 `connect` (eth_requestAccounts), `onAccountsChanged`, `savedAddress` in localStorage, `signMove` (personal_sign, hex UTF-8) | Reuse `provider/connect/onAccountsChanged`; add a `personalSign(message,address)` next to `signMove`. Client needs no crypto library. |
| `HomePanels.tsx` | `HomePanel` (connect / view by typed address / go home / move), `HouseholdBlock`, `LotPanel` | `HomePanel` body is replaced by the new `WalletPanel` (new file); `HouseholdBlock` and `LotPanel` untouched. |
| `WorldApp.tsx` | `address`/`canSign` state, silent `eth_accounts` reconnect, `myHome` = household of `address`, `scene.setMyHome(myHome,label)`, drawer kind `'home'`, 4th `world-tools` button 「我的家」 | Small edits only: drawer body, the 4th button becomes the wallet chip, the marker label depends on owner state. |
| `households.ts` | One wallet = one house; `houseSize` 1 s / 2–3 ms / 4–6 m / 7–9 l / 10+ xl; `households()` counts every seat with `agentId` and an owner, **no presence filter** | Server eligibility (24 h rule) can be smaller than the client's placement count. W1 shows the server count in the panel and leaves placement alone; [REDACTED]. Known limitation. |
| `model.ts` | Presence from `/workers` (`seat.tokenId` listed = online, only if the read is fresh and complete); owners from `/swarm.owners[tokenId]`; `agentId` from swarm seats or workers | Same definitions server-side. |
| `server/gateway.ts` | Per-isolate cached reads of `/swarm`, `/workers` (5 min, edge cached), Alchemy floor with `Authorization: Bearer` | Add one tiny public accessor `source(key)` for the cached `swarm`/`workers` samples. |
| `server/world-api.ts` | GET-only `/api/world/*`, 405 on anything else, `API_HEADERS` (no-store, nosniff, CORP same-origin, CSP none) | Untouched; new routes live in new modules and reuse `API_HEADERS`. |
| `worker/app.ts`, `index.ts` | `createWorker(gateway)` → `{fetch}`; limiters fail open; `upstreamFetch` edge-caches only keyless hosts | Dispatch new prefixes before `handleWorldApi`; add `scheduled`; inject `chainFetch` (default `upstreamFetch`). |
| `server/vite-plugin.ts` | Dev adapter for GET only | New routes answer 503 `AUTH_UNAVAILABLE` there (no D1 in Vite). Local E2E uses `wrangler dev --local`. |
| `wrangler.jsonc` | real config (not generated); `run_worker_first: ["/api/world/*"]`; limiters 4101/4102; `cpu_ms 50` | Add D1, cron, AUTH_LIMITER 4103, three run_worker_first paths. |
| `public/_headers` | CSP `img-src 'self' data: blob:`, `connect-src 'self' blob: https://api.dexscreener.com` | Add `https://nft-cdn.alchemy.com` to `img-src` only (§9). |
| Tests | `node --test tests/*.test.mjs` importing `.ts` directly; no D1, no auth | New `tests/d1-sqlite.mjs` adapter runs the real migration SQL on `node:sqlite`. |
| Dependencies | react, react-dom, three; no viem | Add `viem` (exact pin) as a server-only dependency. |

## 1. Three states (server truth, client mirrors)

| State | Proof | Grants |
|---|---|---|
| **Connected** | wallet returned an address (eth_accounts / eth_requestAccounts) | Nothing. Viewing public data (assets, the wallet's house) works with no wallet at all. |
| **Signed in** | valid `__Host-imd_session` cookie → `sessions` row, not revoked, not expired | Identity = `sessions.address`. No owner rights by itself. |
| **Owner verified** | `GET /api/me/home` for the session address: ≥1 seat whose `ownerOf` (Alchemy, latest block, ≤30 s old) == session address, that is a registered agent, and online within 24 h | Owner mode: 「我家」 marker, home actions. Zero eligible seats → signed in, no house. |

Owner mode on the client additionally requires: no wallet connected, or the connected account == session address.
A different connected account is the **mismatch** state (owner mode off, see §8).

## 2. API

All responses: `API_HEADERS` (JSON, nosniff, CORP same-origin, CSP none). Auth and `/api/me/*`: `Cache-Control: no-store`.
No `Access-Control-*` header is ever sent (same-origin only; no CORS credentials).

| Route | Auth | Success | Errors |
|---|---|---|---|
| `POST /api/auth/challenge` body `{address}` | Origin allow-list | 200 `{nonce,message,acceptUntil}` + `Set-Cookie __Host-imd_flow` | 400 `BAD_REQUEST` (JSON, content-type, size > 2 KB, address), 403 `ORIGIN_NOT_ALLOWED`, 429 `RATE_LIMITED`, 503 `AUTH_UNAVAILABLE` (no DB) |
| `POST /api/auth/verify` body `{nonce,signature}` | Origin + flow cookie | 200 `{address,expiresAt}` + `Set-Cookie __Host-imd_session`, flow cookie cleared | 400 `BAD_REQUEST` / `UNSUPPORTED_SIGNATURE` (ERC-6492 wrapper), 401 `SIGNATURE_INVALID`, 403 `ORIGIN_NOT_ALLOWED` / `FLOW_MISMATCH`, 409 `CHALLENGE_USED` (used, superseded or lost a concurrent race), 410 `CHALLENGE_EXPIRED`, 429, 503 `AUTH_UNAVAILABLE` / `VERIFY_UNAVAILABLE` (ERC-1271 needed but no RPC key, or the node could not answer: a transport or HTTP failure, a JSON-RPC error that is not a revert or an EVM halt, a malformed reply; Swarm retest W-3) |
| `GET /api/auth/session` | cookie | 200 `{signedIn:false}` (plus `expired:true` when the cookie's session ran out; a revoked, unknown or malformed cookie gets no reason: Swarm audit 8c3aea2e N-7) or `{signedIn:true,address,expiresAt}`; a dead cookie is refused, not cleared (Swarm audit 1ef8e8a6 AUD3-06: a late clear deleted a cookie another tab had just set) | 503 `AUTH_UNAVAILABLE` |
| `POST /api/auth/logout` | Origin | 204, session revoked, both cookies cleared, open challenges of this flow invalidated; idempotent | 403 `ORIGIN_NOT_ALLOWED`, 429 |
| `POST /api/auth/logout-all` | Origin, JSON, a live session | 200 `{revoked}`: every live session of the session's address revoked, its open challenges (and this flow's) invalidated, both cookies cleared; never rate limited (added 2026-09-29, swarm review F-4) | 400 `BAD_REQUEST`, 401 `AUTH_REQUIRED`/`SESSION_EXPIRED` (ends nobody, clears no cookie: AUD3-06), 403 `ORIGIN_NOT_ALLOWED` |
| `GET /api/me/home` | session | 200 `{address,seats:[{tokenId,agentId,online,lastOnlineAt,counts}],eligible,size|null,block,checkedAt}` | 401 `AUTH_REQUIRED` / `SESSION_EXPIRED` (no Set-Cookie: AUD3-06), 429, 503 `OWNERSHIP_UNAVAILABLE` (never "you own nothing") |
| `GET /api/wallet/:address/assets` | none (public chain data) | 200 `{address,seats:[{tokenId,image,agentId,online,counts}],characters:{collections:[],items:[]},fetchedAt}`, `Cache-Control: public, max-age=300` | 400 `BAD_REQUEST`, 429, 503 `OWNERSHIP_UNAVAILABLE` |

Rate limits (per client key, `rateLimitKey`): `AUTH_LIMITER` (id 4103, 20/60 s) on challenge, verify, logout and
`/api/me/home`; `API_LIMITER` + `SEAT_LIMITER` on `/api/wallet/*` (it spends Alchemy compute per new address). Unlike the
read API, the auth bucket fails **closed** when the binding throws (429); an absent binding allows only on a loopback URL
(on imdember.com it is 503). Hardening of 2026-09-28 (server/auth.ts): D1 challenge budgets per network (IPv4 /24, IPv6
/48: 30/min; since Swarm audit 8c3aea2e N-5 a /48 has 60, §16) and a global valve (60 per 6 s), 429 `SIGN_IN_BUSY`; ERC-1271 checks claim the challenge first and spend a
per-network share (3/min) and `CHAIN_LIMITER` (`chain:erc1271`, per location), 429 `CHAIN_BUSY` burns the challenge; every
NFT index read of `/api/me/home` spends `chain:index` (refused: the roster and the last stored index answer are the
candidates, ownerOf proves them, `recheck:'limited'`; Swarm audit 519db624 A-2: a refused reload used to drop that answer,
and since 2026-09-30 the answer is kept in D1, `index_candidates`, so every instance has it; a failed index read with an
answer kept is treated the same, one with none is still 503; since Swarm audit 8c3aea2e N-6 a refused read whose answer
counts no seat may take its network's discovery lane, `chain:index:lane`, §16).
2026-09-29 (swarm review F-3): the network share now gates the one `eth_getCode`, and only an address with code spends
`chain:erc1271` before `eth_call`; a "no code" answer is cached per address for 60 s (per isolate), so garbage signatures for
EOAs no longer close smart-wallet sign-in. Still open: garbage aimed at real contract addresses spends `chain:erc1271`.
Trade-off (accepted, review R-3): `eth_getCode` is bounded only by the per-/24 share, the 60 s no-code cache and the
challenge valve, no longer by the per-location `CHAIN_LIMITER` (≈600 cheap keyed reads/min at the valve's full rate from
~200 /24s; watch the Alchemy CU quota), and the EOA path never asks `CHAIN_LIMITER`, so a missing binding there does not
turn it into 503. A global `chain:code` key would bring back the F-3 lever (garbage spending it closes smart wallets).
Superseded by §15 F-3 (round 2): a per-location `chain:code` cap (180/min) now bounds `eth_getCode`, and the contract
budget is split so returning smart wallets keep their own.

## 3. SIWE message (server-built; the page checks it, then signs)

Built with viem `createSiweMessage` from server values only; the exact text is stored in `login_challenges.message`
and verified from there, so nothing the client sends back can change what was signed.

Page check before signing (swarm review F-7a, `src/world/siwe.ts` `checkSignInMessage`): the wallet is asked to
`personal_sign` only a message that is, line for line, the one this site builds: 11 lines; domain = `location.host`;
the signing account (any letter case); blank, the exact statement, blank; `URI:` = `location.origin` + `/`; Version 1;
Chain ID 1; `Nonce:` = the challenge's own nonce, 32 lowercase hex; Issued At within ±10 min of the device clock;
Expiration Time after it by at most 5 min; nothing else (no Resources, Request ID, Not Before, CR or look-alike
characters). Anything else ends the flow with the notice `message-mismatch` ("…your wallet was not asked to sign") and
the wallet is never opened. A device clock off by more than 10 min cannot sign in and sees that notice. Limits: this
guards against a wrong or tampered challenge response (a proxy, a server bug); it does not protect against script
injected into this origin, which can call the wallet provider directly.

| Field | Value |
|---|---|
| domain | host of the request `Origin`, which must be in the allow-list: `https://imdember.com`; and `http://localhost:<port>` / `http://127.0.0.1:<port>` only when the request URL's own hostname is loopback (so production can never accept them, no config needed) |
| address | `getAddress(body.address)` (EIP-55); stored lowercased |
| statement | `Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers, token or NFT approvals, or transactions.` (ASCII; the session lifetime is stated here, see Amendments F2; approvals named since 2026-09-29, §15 F-1) |
| uri | `<origin>/` |
| version / chain-id | `1` / `1` (Ethereum mainnet only; the wallet's current chain is irrelevant to a personal_sign) |
| nonce | 16 bytes from `crypto.getRandomValues`, 32 hex chars (128 bit, alphanumeric) |
| issued-at | server now |
| expiration-time | `accept_until` = issued-at + 5 minutes (amended, F2: the time the server still accepts this message) |

Challenge acceptance window: 5 minutes after issued-at (`accept_until`), enforced by the server; the message's own
Expiration Time equals it (amended F2; v001 used the 7-day session bound here, which made wallets show a 7-day expiry
for a message the server stops accepting after 5 minutes). Issuing a challenge marks every earlier unused challenge
of the same flow cookie `invalidated_at` (a late A signature after switching to B is 409).

Flow binding (login CSRF, cross-browser replay): the challenge sets `__Host-imd_flow` (random 128 bit, HttpOnly, Secure,
SameSite=Strict, Path=/, Max-Age=300); its SHA-256 is stored with the challenge; verify requires the same cookie and the
same Origin as the challenge.

Verify order: Origin → rate limit → JSON → challenge row by nonce (unknown → 409) → flow hash → not invalidated / not
used → `now < accept_until` → signature → atomic consume + session insert.

Atomic consume (one D1 `batch`, i.e. one transaction):
```sql
UPDATE login_challenges SET used_at=?now, session_hash=?hash
 WHERE nonce=?n AND used_at IS NULL AND invalidated_at IS NULL AND accept_until>?now;
INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce)
 SELECT session_hash,address,1,?now,?expires,nonce FROM login_challenges WHERE nonce=?n AND session_hash=?hash;
```
The session exists only if the insert changed one row; `sessions.nonce UNIQUE` is the second lock. N concurrent
verifies of one signature → exactly one 200, the rest 409.

## 4. Signature verification — viem, measured

Library: **viem** (exact pin 2.56.9, server only): `createSiweMessage`, `recoverMessageAddress`, `hashMessage`,
`encodeFunctionData`/`decodeFunctionResult`, `getAddress`. Not `publicClient.verifyMessage`: it always makes an RPC call
(ERC-6492 universal validator) and would put every login on Alchemy. Order:
1. ECDSA: `recoverMessageAddress(message, signature) == address` → valid (EOAs, and 7702-delegated EOAs).
2. Else ERC-1271: `eth_call` `isValidSignature(hashMessage(message), signature)` on mainnet at `latest` through Alchemy;
   magic `0x1626ba7e` → valid; no code / revert / other → 401. No key → 503 `VERIFY_UNAVAILABLE`, and so is any
   JSON-RPC error that is not the contract's own answer (a revert: code 3 or -32000 "execution reverted"; or an EVM halt
   the contract's code causes: -32000 "out of gas", "invalid opcode", "invalid jump destination", "stack
   underflow/overflow/limit reached", "write protection", "return data out of bounds" → 401), a transport or HTTP
   failure, or a malformed reply: the node failing is not a bad signature (Swarm retest W-3; the challenge is burnt like every 503).
3. ERC-6492 wrapped signatures (suffix `0x6492…6492`, undeployed smart accounts) → 400 `UNSUPPORTED_SIGNATURE`.

Measured 2026-09-28 (scratch install viem 2.56.9 / @noble/curves 1.9.1, Node 24.19, fresh test key per run):
- Worker bundle cost of the verify path: 68 KB minified, 26 KB gzip (noble-curves 33 KB, viem 23 KB, noble-hashes 10 KB).
- Warm verify (parse + validate + recover): median 3.7–4.0 ms, p95 ≤ 6.7 ms.
- **Cold first verify: 51–65 ms** — noble lazily builds the secp256k1 base-point table (window 8, ~45 ms). That alone
  would break the 50 ms cap on a fresh isolate.
- Fix: before the first recovery, `secp256k1.ProjectivePoint.BASE._setWindowSize(4)` (same noble instance viem uses):
  table 4–6 ms, cold recover 7–14 ms, warm unchanged (~5 ms). Worst first verify ≈ 20 ms in Node. A unit test pins
  that viem and the server import resolve to one `@noble/curves` copy, that `_setWindowSize` exists (fails loudly on an
  upgrade), and that a cold verify in a fresh `node` process stays under 30 ms.

Alternatives rejected: `siwe` package (pulls ethers, far heavier); hand-rolled keccak/secp256k1 (unaudited crypto);
Durable Object / external verifier (more moving parts for a 5 ms job).

## 5. Session cookie and CSRF

- `__Host-imd_session=<token>`; `Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=<until expires_at>`; no Domain.
  Token: 32 random bytes, base64url (256 bit, opaque); D1 stores only `SHA-256(token)` hex. New token on every login.
- Session valid while `revoked_at IS NULL AND expires_at > now`; absolute 7 days, no sliding renewal, no re-sign while
  valid. Logout sets `revoked_at` (server-side revocation, the cookie alone is worthless afterwards).
- CSRF: every POST requires an `Origin` header in the allow-list (missing → 403) and `Content-Type: application/json`;
  verify also needs the flow cookie. GETs change nothing, a dead cookie included: only a sign-in and the explicit logouts
  write the session cookie (AUD3-06; the server refuses a dead token on every request, checked against D1).
- Localhost: `__Host-` + `Secure` cookies are accepted on `http://localhost` / `127.0.0.1` by Chromium (secure
  context); the local E2E confirms it in headless Edge.

## 6. D1 (`DB`, database_name `imd-world`, id placeholder `00000000-0000-0000-0000-000000000000`)

`migrations/0001_wallet_login.sql` (wrangler d1 migrations format; times are epoch ms integers; addresses lowercase):
```sql
CREATE TABLE login_challenges(nonce TEXT PRIMARY KEY, address TEXT NOT NULL, origin TEXT NOT NULL,
  flow_hash TEXT NOT NULL, message TEXT NOT NULL, issued_at INTEGER NOT NULL, accept_until INTEGER NOT NULL,
  used_at INTEGER, invalidated_at INTEGER, session_hash TEXT);
CREATE INDEX login_challenges_flow ON login_challenges(flow_hash, used_at);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, address TEXT NOT NULL, chain_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, nonce TEXT NOT NULL UNIQUE);
CREATE INDEX sessions_address ON sessions(address);
CREATE TABLE seat_presence(token_id INTEGER PRIMARY KEY, owner TEXT, last_online_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL);
CREATE INDEX seat_presence_seen ON seat_presence(last_online_at);
```
Housekeeping in the cron: delete challenges with `accept_until < now − 1 day`, sessions with `expires_at < now − 1 day`,
and (since `0004`) stored index answers with `read_at < now − 8 days`. `seat_presence` is never deleted ([REDACTED]).
Tests run this exact file on `node:sqlite` through a small D1-shaped adapter (`prepare/bind/first/all/run/batch`,
batch = one transaction).

`migrations/0004_index_candidates.sql` (2026-09-30, Swarm audit 519db624 A-2 across instances; additive, applied before
the code that uses it): `index_candidates(address TEXT PRIMARY KEY, ids TEXT NOT NULL, read_at INTEGER NOT NULL)`, the
last NFT-index answer per address (a JSON array of at most 256 ids), written by every successful index read of
`/api/me/home` (an answer naming no seat deletes the row), read only when an index read is refused or fails; it only
names candidates (§7); `read_at` is when that index read began, and an older answer never replaces a newer one. D1
(measured on a local workerd D1): the upsert reads ≤ 1 row and writes 1 (2 for a new address: the row and its key), the
delete writes none (1 when it removes a row), the read reads ≤ 1; upserts are bounded by `chain:index` (20/min per
location, 864 k index reads a month: about 0.9 M rows written a month per location when the rows exist, at most about
1.7 M if every read kept a new address, and only an address the index names a seat for is kept); the prune scans the
table (a few thousand rows at most) every run and writes 1 per row it deletes.

`migrations/0005_lanes_and_subnets.sql` (2026-09-30, Swarm audit 8c3aea2e N-4..N-6; additive, to be applied before the
code that uses it): `login_challenges.sub` (the IPv6 /64 that asked for the challenge, `net6:<prefix>::/64`, NULL for
IPv4; never the host bits; it lives as long as its row), `login_challenges.called_via` (`pool` or `lane` for a claimed
contract check), and `index_lanes(net TEXT NOT NULL, sub TEXT, at INTEGER NOT NULL)` with `index_lanes_net(net, at, sub)`
and `index_lanes_at(at)`: one row per NFT-index read taken on a network's discovery lane, deleted by the cron once older
than a minute (its next run, every 15 minutes, so a row lives at most about 16 minutes). Code deployed ahead of it keeps the 0004 statements (`SCHEMA_0004`), takes no lane and never answers 503
for it. Costs: `sub` and `called_via` ride in writes that already happen (unindexed); a lane writes 3 rows and its prune
3 (§16).

## 7. Ownership and eligibility (`server/ownership.ts`)

Chain reads go through an injected `chainFetch` (default `upstreamFetch`; Authorization is set, so never edge cached).
Key only in `Authorization: Bearer`, never in a URL or an error text.

1. **Candidates** for the session address: `swarm.owners[i] == address` (gateway cache, IMD's view) ∪ Alchemy
   `getNFTsForOwner(owner, contractAddresses[]=SEAT_COLLECTION)` (catches a second-hand buyer IMD has not indexed).
   Capped at 256 ids (supply 2000; largest holder today 20). Past the cap, seats that count by rule 3 (online now, or
   seen under this owner in the last 24 h: one `seat_presence` read, made only when there is a cut) come first, then
   other registered ones, then the rest (each by id), and the view says `recheck:'partial'`, never a complete answer
   (Swarm audit 519db624 A-4: cutting by id alone could drop the only seat that counts; Swarm audit 8c3aea2e N-3: ranking
   by the roster alone could drop one that counts through its sighting); so does an index read that stopped at its
   5-page cap with pages left.
2. **Verify**: one `eth_call` to Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` `aggregate3` with
   `getBlockNumber()` + `ownerOf(id)` for each candidate (`allowFailure`), at `latest`, chunked by 200. A revert
   (burnt / nonexistent id) = not owned. Result: verified ids + the block number of the read (one atomic block).
   Policy: `latest` is fine for a reversible Web2 permission; a reorg only delays revocation by ≤ the cache age.
3. **Eligible seat** = verified owner && `agentId` known (swarm seats or workers) && (listed in the fresh `/workers`
   read now || `seat_presence.last_online_at ≥ now − 24 h`). Size = `houseSize(eligible)`; 0 → no house.
4. Cache: per address in the isolate, 30 s (LRU 512). No key, Alchemy error, or an unavailable swarm read → 503
   `OWNERSHIP_UNAVAILABLE`; nothing is cached as "owns nothing". The isolate reuses the NFT index answer for 5 min per
   address (30 s on "Check again"); the last answer is also kept in D1 (`index_candidates`, §6), dated when its index
   read began, until the cron deletes it once that read is more than 8 days old. D1's copy is read only when an index
   read is refused or fails: an index read the budget refuses, or one that fails while an answer is kept (the isolate's
   or D1's, whichever is newer), proves the roster's and that answer's candidates instead, `recheck:'limited'` (Swarm
   audit 519db624 A-2). Revocation bound after a sale: ≤ 30 s (cache) + the client re-read (panel open, focus, or
   every 60 s while owner mode is on).

**Assets** (`GET /api/wallet/:address/assets`, public): Alchemy `getNFTsForOwner` with `contractAddresses[]` =
SEAT_COLLECTION + every `CHARACTER_COLLECTIONS` contract, `withMetadata=true`, `pageSize=100`, all pages (cap 5). Seats
are annotated with agent status and `counts` (same eligibility rule, ownership taken from Alchemy's index — display only;
owner rights always come from §7.2). Cache 5 min per address per isolate + `Cache-Control: public, max-age=300`.
`CHARACTER_COLLECTIONS` lives in `src/world/collections.ts` (shared by client and Worker), `[]` today → the panel shows
「即將推出 / Coming soon」; [REDACTED].

**Images**: allow `https://nft-cdn.alchemy.com` in CSP `img-src` and render only URLs whose host is exactly that
(the Worker drops every other URL: IPFS gateways, arbitrary metadata hosts, `data:` SVG); fallback is a local seat
glyph. `<img referrerpolicy="no-referrer" loading="lazy">`. Not proxied: a proxy would spend Worker requests and CPU
per image and be an open fetcher; the CDN URL carries no key. `connect-src` is unchanged (the browser never calls
Alchemy).

**Local runs without a key**: every chain read uses `chainFetch`. Unit tests inject fixture fetches. For
`wrangler dev --local` E2E, `--var CHAIN_MOCK_OWNERS:'{"361":"0x…"}'` switches `chainFetch` to an in-memory fixture —
honoured only when the request (or cron) URL hostname is loopback, so it can never act in production. Test keys are
generated per run (`generatePrivateKey`) and never written to the repo.

## 8. Presence recorder (`server/presence.ts`, `scheduled`)

Cron `*/15 * * * *`. Reads `/workers` and `/swarm` through the gateway (edge cached 5 min). Only when `/workers` is
fresh and complete (`count == rows`, no invalid rows, same rule as `model.ts completeWorkers`): one statement upserts
every listed seat
```sql
INSERT INTO seat_presence(token_id,owner,last_online_at,updated_at)
 SELECT value->>'id', value->>'owner', ?1, ?1 FROM json_each(?2) WHERE true
 ON CONFLICT(token_id) DO UPDATE SET owner=excluded.owner,last_online_at=excluded.last_online_at,updated_at=excluded.updated_at;
```
(one bound JSON parameter, so one D1 query instead of ~430). `owner` is IMD's `swarm.owners[id]`, informational only.
A failed or partial read writes nothing (never "offline"). Every run also deletes stored index answers read more than
8 days ago (`PRUNE_INDEX`, its own statement after the batch, so a deploy ahead of `0004` never stops the rest) and
index-lane rows older than a minute (`PRUNE_INDEX_LANES`, a range of `index_lanes_at`, likewise after the batch). CPU:
parsing a 459 KB workers body 0.4–0.9 ms, the 105 KB swarm 0.1–0.2 ms, the JSON parameter 0.1 ms (Node, measured) — a
few ms per run. Writes ≈ 430 × 96/day ≈ 41 k rows/day
(IMD account's own D1).

## 9. Frontend

New modules: `src/world/walletSession.ts` (pure reducer + API calls + BroadcastChannel), `src/world/WalletPanel.tsx`,
`src/world/collections.ts`. Edits: `WorldApp.tsx` (state hook, drawer body, 4th button, marker label), `world.css`
(a few scoped rules), `wallet.ts` (`personalSign`). No viem in the client bundle (it only personal_signs the server's
text, hex-encoded UTF-8, like `signMove`).

State machine (spec 7.1):

| State | Chip / primary action (zh / en) |
|---|---|
| visitor | 連接錢包並入住 / Connect wallet |
| connected | 簽名驗證入住 / Sign in to move in |
| awaitingSignature | 請在錢包確認登入訊息 / Confirm the sign-in message in your wallet |
| verifying | 正在確認身分與 IMD 持有資格 / Checking identity and IMD seats |
| owner | 我的家 · N 位 agent / My home · N agents |
| signedInNoHouse | 已登入，目前沒有符合資格的席位 / Signed in, no eligible seat right now |
| expired | 登入已到期，請重新登入。 / Your sign-in has expired. Please sign in again. (chip: 登入已到期 / Session expired; Swarm audit 8c3aea2e N-7) |
| ownershipUnavailable | 暫時無法確認持有資格，請稍後重試 / Can't confirm seats right now, try again later |
| mismatch | 錢包已切換到 0x…；請重新簽名或登出 / Wallet switched to 0x…; sign in again or sign out |

Rules:
- Wallet prompts only from a click. One flow per click: an in-flight guard disables the button; a flow generation
  counter drops late responses. Cancel/reject → back to `connected` with 「尚未完成登入驗證，暫不能以屋主身分入住」, never
  an automatic retry.
- Load: `GET /api/auth/session` (cookie is the only truth; localStorage address is just a view hint), plus the
  existing silent `eth_accounts`. No signature on load.
- Account switch A→B (`accountsChanged`): owner mode off immediately, bump the generation (A's late verify is ignored
  client-side and 409 server-side), `POST /api/auth/logout` for A, state `connected(B)`. Wallet locked/disconnected
  while the session is valid: stay signed in.
- Tabs: `BroadcastChannel('imd-ember-auth')` posts `signed-in` / `signed-out`; receivers re-read `/api/auth/session`
  (never trust the message's address).
- Owner re-check: on panel open, window focus, and every 60 s while owner mode is on; 401 → `expired` only when the
  session ran out (`SESSION_EXPIRED`, or its `expiresAt` reached on this clock), any other 401 → signed out, worded
  「登入狀態已失效，請重新登入。」 / "You are no longer signed in. Please sign in again." (N-7, §16), 503 →
  `ownershipUnavailable` (owner mode suspended, house kept), zero eligible → `signedInNoHouse`; zero eligible from a
  read that was not complete (`recheck` `limited` or `partial`) → `ownershipUnavailable` too, worded "the on-chain check
  couldn't be completed", never "checked on chain: no seat" (Swarm audit 519db624 A-8).
- Ownership is revalidated, not real-time. The server caches an `ownerOf` proof at most 30 s per address
  (`OWNERSHIP_TTL_MS`) and the NFT index's answer 5 min (30 s on "Check again"). The page re-reads the house every 60 s
  while owner mode is on and the tab is visible (`OWNER_RECHECK_MS`), on window focus, when My wallet opens, and when the
  tab is shown again (the session and the house, at most once per 15 s, `HOME_MIN_GAP_MS`); it ends the session at its
  `expiresAt` on this device's clock (W-1). While re-checks fail (429, a lost connection) the last house answer is kept at
  most 3 min (`OWNER_STALE_MS`). So until the next successful re-check the page may briefly show a stale owner state: a
  seat sold a moment ago, or a "Log out all devices" on another device; a hidden tab keeps its last state until it is
  shown (tested: "visibility-refresh-clears-stale-owner").
- Marker: `scene.setMyHome(home, label)` gets 「我家 / My home」 only in `owner` state for the household of the session
  address; a typed or merely connected address gets 「這個錢包的家 / This wallet's home」. The label is local to this
  browser, never sent or broadcast.
- Existing move flow unchanged (still gated by a connected wallet; its note already says it is local only).

My-wallet panel (existing drawer: right sheet 420 px on desktop, bottom sheet from 15dvh on phones — modal, so it never
overlaps the onboarding HUD, speaker toggle, world-time card or minimap, which the drawer already hides):
1. Header: short address + copy, state badge (已登入 · 有效至 <date> / 未登入 / 只看).
2. Primary action for the state; above the sign button the pre-sign note 「此次簽名僅用於登入 IMD Ember World（登入有效 7 天）、
   確認錢包控制權。不收取 Gas，也不授權資產轉移、代幣或 NFT 的授權（approve）或任何交易…」 / "This signature only signs you in
   to IMD Ember World (for 7 days) and proves you control the wallet. It costs no gas and authorizes no asset transfer, token or
   NFT approval, or transaction…" (swarm review F-1: it names what the SIWE statement names). While the wallet's prompt is
   open, a two-line summary read back from the checked message (siwe.ts signInSummary, walletView.ts signingText): 「登入
   IMD Ember World · 網域 · 網路 · 錢包 · 用途：僅限登入 · 不轉移資產、不授權」 and 「錢包應顯示相同的網域；若顯示的是其他網站，
   請拒絕。」 / "Your wallet should show the same domain. If it shows another site, reject." No extra click before the wallet
   opens. It is a reminder, not a defence: a phishing page does not run this code (the wallet's own domain check is).
3. 我的家 (owner): size, eligible count, [回家] [搬家…] (existing actions), last checked time, refresh.
4. 資產 · IMD 席位: rows `#361 · 在線/離線 · 計入房子/不計入 (reason)`, tap = locate the agent; loading / 503 / empty states
   distinct ("目前未查到此錢包持有 IMD" only on a successful empty read).
5. Pepe 角色 NFT: grid from `CHARACTER_COLLECTIONS`, or 「即將推出 / Coming soon」.
6. Footer: 登出此裝置 / Log out this device and 登出所有裝置 / Log out all devices (F-4; the second opens an inline confirm that
   says this browser's other tabs follow at once and other devices on their next signed-in request; walletView.ts
   logoutView / runLogout), 換一個錢包, view-by-address form (view only, never owner).

Chip: the 4th `world-tools` button (already placed and tested on desktop and phones). Desktop label = state text or
short address + status dot; ≤700 px and coarse-landscape keep the fixed short label 「錢包 / Wallet」 + dot so the bar does
not grow into the joystick or zoom tools. Gold star (`has-home`) only in `owner`. Checked with the viewport × content
matrix (desktop, 375×812, 390×844, 700×900, landscape 844×390, short 1280×560) against production screenshots.

## 10. Config diffs

- `wrangler.jsonc`: `d1_databases: [{binding:"DB", database_name:"imd-world", database_id:"00000000-0000-0000-0000-000000000000", migrations_dir:"migrations"}]`;
  `triggers: {crons:["*/15 * * * *"]}`; ratelimit `{name:"AUTH_LIMITER", namespace_id:"4103", simple:{limit:20, period:60}}`;
  `run_worker_first: ["/api/world/*","/api/auth/*","/api/me/*","/api/wallet/*"]`.
- `public/_headers`: `img-src 'self' data: blob: https://nft-cdn.alchemy.com`.
- `package.json`: `viem` exact version.

## 11. Tests (execute the rules; real handler + real migration SQL)

`tests/auth.test.mjs`, `tests/ownership.test.mjs`, `tests/presence.test.mjs`, `tests/wallet-session.test.mjs`:
forged signature, signature by another key, message altered (domain / URI / chainId / nonce), verify from another Origin,
missing Origin, non-allowed Origin, loopback origins refused on a production URL, expired / used / superseded / unknown
challenge, replay after success, N concurrent verifies → one session, missing / foreign flow cookie, cookie flags
(`__Host-`, HttpOnly, Secure, SameSite, Path=/, no Domain, Max-Age), token stored only as hash, logout revokes (old
cookie → 401), expiry at 7 days (injected clock), no-store on auth and me, no ACAO header, rate limit 429 and
fail-closed, ERC-1271 path with a mocked `eth_call` (magic / wrong / no key → 503), ERC-6492 → 400, ownership: forged
candidates rejected by ownerOf, sold seat drops, second-hand buyer counts, offline > 24 h drops, 503 not "empty", size
from `houseSize`; recorder: partial workers read writes nothing; client reducer: one flow per click, reject → no retry,
A→B drops A, late response ignored, BroadcastChannel re-read. Local E2E in headless Edge with a mock EIP-1193 provider
signing with a fresh key.

## 12. Backend as built (2026-09-28)

Files: `migrations/0001_wallet_login.sql`, `server/d1.ts`, `server/auth.ts` (router `handleAccountApi` + SIWE + sessions),
`server/ownership.ts`, `server/presence.ts`, `server/chain-mock.ts`, `src/world/collections.ts`; small edits in
`worker/app.ts` (dispatch, limiter buckets, `chainAccess`, `scheduled`), `server/gateway.ts` (`source(key)`),
`server/vite-plugin.ts` (503 in Vite), `wrangler.jsonc`, `public/_headers`, `package.json` (`viem` 2.56.9 and
`@noble/curves` 1.9.1 pinned, one deduped copy). Tests: `tests/auth.test.mjs`, `ownership.test.mjs`, `presence.test.mjs`
on `tests/wallet-harness.mjs` + `tests/d1-sqlite.mjs` (real migration SQL on node:sqlite); every rule was also checked by
mutating the server code and seeing the matching test fail.

Choices made while building (the design left them open or they turned out different):
- Unknown nonce → 409 `CHALLENGE_USED`; a verify whose Origin differs from the challenge's → 403 `FLOW_MISMATCH`.
- The stored message is re-parsed and validated (domain, URI, chain 1, version, statement, nonce, address, lifetime)
  before the signature check. The consume re-reads the clock, so a challenge that expires during a slow ERC-1271 call
  is not taken.
- `expiresAt` = challenge `issued-at` + 7 d = the message's `expiration-time` (so the session never outlives what was
  signed; up to 5 min shorter than 7 d from the moment of login).
- ERC-1271 (superseded by §14: now `eth_getCode` first and an exact magic word): one `eth_call isValidSignature` (no `eth_getCode`; an EOA returns `0x` → 401). Without a key a signature
  that ECDSA cannot prove is 503 `VERIFY_UNAVAILABLE`, never "invalid" and never a login.
- (Buckets superseded by §14.) `GET /api/auth/session` uses the `api` bucket (fails open); challenge/verify/logout and `/api/me/home` use `auth`
  (fails closed). Logout also requires `Content-Type: application/json`.
- `/api/me/home` adds `presence` (the `/workers` state behind `online`) and a per-seat `reason`
  (`not-agent` / `offline-24h`). `/api/wallet/:a/assets` adds `complete` (false when the index had more pages than 5).
  Assets need IMD's swarm for agent ids; with the swarm unavailable the route is 503 (known limitation).
- Presence rows are dated by the roster's own time (`fetchedAt`, i.e. minus the edge cache's `Age`); `last_online_at`
  only moves forward; an unknown owner keeps the last known one.
- Loopback rules key on `request.url`. `wrangler dev` rewrites it to the route host (`https://imdember.com`) unless
  started with `--local-upstream 127.0.0.1:8792 --upstream-protocol http` (README): without it local dev behaves like
  production (localhost Origin 403, `CHAIN_MOCK_OWNERS` ignored).
- wrangler 4.92 cannot reach `scheduled` through the assets router (`/__scheduled` is served as SPA HTML,
  `/cdn-cgi/handler/scheduled` answers `exception` without entering the Worker); the cron was exercised with a
  temporary assets-free config sharing the same local D1.

Measured:
- Worker bundle (esbuild, minified, same flags before/after): 11.4 KB → 123.0 KB (gzip 4.9 KB → 44.6 KB). viem 34 KB,
  @noble/curves 32 KB, @noble/hashes 10 KB, server 24 KB, shared src (model, households, market) 16 KB. Far under the
  Workers Paid 10 MB limit.
- POST `/api/auth/verify`, whole handler on node:sqlite, fresh process (Node 24.19, this machine, idle): cold 8–9 ms
  with window 4 (23–25 ms with noble's default window 8), warm 3.2–3.8 ms. CI-style parallel runs: cold 10–20 ms.
- Presence run, 430-row / ~460 KB roster + the real 2026-09-27 swarm, parse → derive → one upsert: 3.5–6 ms (10–18 ms
  while other test files run in parallel). Real cron in `wrangler dev --local`: 467 seats written, 140 ms wall incl. the
  two api.imd.fun reads.
- Local E2E (headless Edge, mock EIP-1193 provider signing with a fresh key via a CDP binding, `wrangler dev --local`):
  challenge 200 → personal_sign → verify 200; replay 403; `document.cookie` empty; one `__Host-imd_session` cookie
  (HttpOnly, Secure, SameSite=Lax, Path=/, host-only, 7 d) accepted on http://127.0.0.1; session survives a reload
  without a new signature; `/api/me/home` 200 (mock owner of #361 and #921, both online → eligible 2, size ms);
  assets 200 with `public, max-age=300`; logout 204 → session false, `/api/me/home` 401, cookies gone; the 21st
  challenge within a minute → 429; a foreign Origin → 403; no `Access-Control-*` header anywhere; CSP img-src carries
  `https://nft-cdn.alchemy.com`.

## 13. Frontend as built (2026-09-28)

Files: `src/world/auth.ts` (AuthClient: session restore, one flow per click, account switch, BroadcastChannel
`imd-ember-auth`, owner re-check; pure `statusOf` / `statusText` / `chipText`), `src/world/WalletPanel.tsx` (chip,
My-wallet panel, `useAuth`); small edits in `WorldApp.tsx` (client + hook, chip, drawer body, 「我家 / My home」 marker
label, minimap/map star), `arrival.ts` (drawer heading 我的錢包 / My wallet), `world.css` (one scoped block). The name
`auth.ts` replaces the planned `walletSession.ts`. `HomePanel` in `HomePanels.tsx` is no longer rendered; it was deleted
in the hardening pass (its pre-F1 "connect the wallet to move" rule was dead code).

Choices:
- A click waits for the load's session read, so a reload with a live cookie never asks for a signature. A verify that
  succeeds at the server after an account switch is logged out by the client (its cookie arrives after the switch's logout).
- "Expired" is shown only when this browser's own last session ran out (a hint in localStorage: address + expiry, no
  token); a session revoked in another tab reads as signed out.
- Marker: 「我家 / My home」 only in owner state on the household of the session address in the client placement; if IMD's
  roster has not placed that wallet yet the panel says so ([REDACTED]). Other viewed wallets get
  「這個錢包的家 / This wallet's home」.
- Seat rows (superseded by §14: signed in, only the server-proven seats): the public assets list, overlaid with `/api/me/home`'s verified `counts` for the signed-in wallet.

Tests: `tests/wallet-client.test.mjs` drives AuthClient against the real Worker (harness + node:sqlite) with a fake
EIP-1193 wallet signing with a per-run key; mutation-checked (late-verify logout, click waits for restore, channel,
mismatch, generation drop). Local E2E (headless Edge + `wrangler dev --local`, mock provider, fresh keys deleted after):
first sign-in = one signature; reload = none; A→N switch = owner off at once, A's cookie 401; N = "signed in, no
eligible seat"; sign-out → 401; rejected signature = notice, one prompt only; mismatch at load; no Alchemy key =
"can't confirm seats" (503) distinct from no-seat; the local move flow still signs and moves. Tools bar vs every HUD box
over 1600×900, 1280×560, 1024×768, 701×900, 700×900, 390×844, 375×812, 844×390 (EN/zh): no overlap, no horizontal
scroll; desktop bar 30 px wider than production ("Connect wallet" vs "My home").

## 14. Review fixes and verification (2026-09-28)

Four reviews (security, spec-correctness, integration/perf) reported 18 findings; each was reproduced before it was fixed.
Every fix has an executed test on the real handler (+ node:sqlite migration) or the real AuthClient, and each was
mutation-checked (the fix reverted → its test fails).

| id | sev | outcome |
|---|---|---|
| SEC-1 / CORR-01 | high / med | Logout is never rate limited: a same-origin logout always revokes and clears both cookies (a foreign Origin is still 403 with no Set-Cookie, so another site cannot sign anyone out). `/api/me/home` reads the session before any fail-closed bucket: anonymous and cross-site reads spend only the fail-open `api` bucket (401), and a session's re-checks spend `home` keyed by `session:<hash>` (AUTH_LIMITER, 20/min per session), so they cannot starve sign-in or another owner behind the same NAT. `signOut` waits for the server: a lost or refused logout keeps the page signed in with 「登出沒有送達伺服器…」 / "Sign-out didn't reach the server…" and a retry works; a lost logout on an account switch shows a mismatch, never "signed out". |
| SEC-2 | med | ERC-1271 needs code at the address (`eth_getCode` ≠ `0x`; a 7702 `0xef0100…` delegation passes) and an answer that is exactly `0x1626ba7e` + 56 zeros. Echo contracts, the identity precompile and padded answers are 401. |
| SEC-3 / INT-2 | med | Public assets list seats from IMD's roster with no keyed Alchemy read at all. Character NFTs (once `collections.ts` lists a contract) spend a global `CHAIN_LIMITER` budget (4104, 20/min per location, one constant key, fails closed; no binding → no keyed read), are cached 5 min per address and a failure is not re-asked for 60 s. |
| SEC-4 | low | Every challenge sets a new random flow value; the incoming one only names the open challenges it supersedes. |
| CORR-02 | med | After a failed session read the click reads the session again first and never asks for a signature while it stays unknown (`session-unknown` / `rate-limited` notice). |
| CORR-03 | med | A recorded sighting counts only under the owner it was recorded for; a buyer's seat counts once it is online under the buyer (IMD's roster names the owner, so this starts once IMD indexes the sale). |
| CORR-04 / 08 | low | Signed in, the seat rows are only the server-proven seats (a sold seat disappears on the next check); "Check again" asks for a fresh index answer (`?fresh=1`); "1 agent counts". |
| CORR-05 | low | A house answer older than 3 min (`OWNER_STALE_MS`, every re-check failed) no longer grants owner mode; it returns with the next success. |
| CORR-06 | low | ERC-6492 (undeployed smart account) has its own notice; one verify only. |
| CORR-07 | low | Never seen is its own reason (`not-seen`, 「尚未記錄上線」 / "Not seen online yet"), not "offline 24h+". |
| INT-1 | med | The 60 s owner re-check pauses in hidden tabs and runs once when shown; the server keeps the NFT-index answer 5 min per address (30 s on "Check again") and still proves `ownerOf` every 30 s, so a sale shows within one successful re-check while the tab is visible. An hour of re-checks = 60 `eth_call` + 12 index calls (was 60 + 60). |
| INT-3 | med | The cold/warm verify guards compare only with noble's window-8 table built under the same load (no absolute ceiling). Trial merge with main b3c19cb: 355/355 in 7 of 7 runs, although parallel load put cold verify at 42–65 ms wall (table alone 67–78 ms). |
| INT-4 | low | `houseSize` lives in `src/world/houseSize.ts` (no imports; households.ts re-exports it); a test imports the Worker entry with a resolve hook and fails if layout.ts or households.ts load. |
| INT-5 | low | A CPU guard for a cold `/api/me/home` (20 seats, the real swarm fixture, a 430-row roster, Alchemy's answers replayed): below 2× the window-8 table under the same load (idle: 17–19 ms vs 18 ms). |
| INT-6 | low | The marked household (`walletView.markedHome`, tested) replaces the map-line edits; WorldApp's MiniMap/WorldMap lines are main's text again, and wallet-login merges main b3c19cb with no conflict (tsc and 355 tests pass). |

Local E2E after the fixes (npm run build; `wrangler dev --local` with `--local-upstream`, the chain fixture naming a fresh
test key as holder of #361 and #921; headless Edge on 9517, fresh profiles, an injected EIP-1193 provider signing through a
CDP binding; keys deleted after): true visitor = "Connect wallet"; connected = pre-sign note + public seats + Pepe
「即將推出 / Coming soon」; first sign-in = exactly one `personal_sign` → owner "My home · 2"; reload = no signature
(only `eth_accounts`), one `/api/me/home?fresh=1`; a hidden tab made 0 re-checks in 67 s and 1 when shown; a foreign page
loading `/api/me/home` 24 times got 24 × 401, then Sign out 204 and the session is gone; A → no-seat wallet: owner off at
once, A's cookie 401, the new wallet "signed in, no eligible seat"; a rejected signature = notice, one prompt; mismatch at
load; wrangler without the fixture (no key) = 503 "can't check", session kept, rows labelled "not verified"; a lost logout
keeps the session with the notice, retry signs out; expired session chip; #361 moved to another wallet = the panel shows
only #921, "My home · 1 agent"; the local move flow still signs and moves; tools bar vs every HUD box at 1600×900,
700×900, 390×844, 375×812, 844×390 (EN/zh): no overlap, no horizontal scroll. [REDACTED-INTERNAL]
[REDACTED-INTERNAL]

Still open (by design or [REDACTED]): the client places houses from IMD's swarm (a buyer IMD has not indexed is verified with no
house on the map); the server's 24 h count can be below the client's placement count; public assets need IMD's swarm (503
without it); timing guards remain timing-based (relative, best of up to five fresh processes).

## Amendments (hardening H-A, 2026-09-28)

- **Moving house (F1).** `signMove` and its personal_sign are gone: the SIWE sign-in is the only signature the client
  ever asks for. A move needs owner mode (the server-verified session and `/api/me/home` counting a seat), is recorded
  for the session's address only, asks the wallet for nothing and stores no signature (`src/world/moves.ts`). A wallet
  that is merely connected sees "sign in first". Entries saved by older builds are rewritten on read without their
  `message`/`signature`/`issued` fields, which were never trusted. Moves stay local to the browser ([REDACTED]).
- **SIWE Expiration Time (F2).** The message's Expiration Time is the challenge's `accept_until` (Issued At + 5 min),
  built server-side; verify re-checks that the stored message's Issued At / Expiration Time equal the row's
  `issued_at` / `accept_until` and still answers 410 `CHALLENGE_EXPIRED` from `accept_until` itself. The session
  lifetime (7 days from issue) is stated in the statement ("…access your home for 7 days…") and here, not as the
  message expiry. Deliberate, unchanged session properties: a fixed 7-day `__Host-imd_session` bearer cookie
  (HttpOnly, Secure, SameSite=Lax, no renewal), stored only as SHA-256; selling the seat NFT does not revoke the
  session, but `/api/me/home` reflects on-chain ownership within 30 s (`OWNERSHIP_TTL_MS`), so owner mode ends there;
  `POST /api/auth/challenge` is unauthenticated but rate-limited per IP (`AUTH_LIMITER`, fails closed) and old
  challenges are pruned by the cron (`presence.ts` housekeeping).
- **Wallet discovery (F3).** `src/world/wallet.ts WalletRegistry` implements EIP-6963 (`eip6963:requestProvider` /
  `eip6963:announceProvider`; one entry per provider object, so a second provider announcing an rdns already listed
  is added beside it, never in its place; icons only as `data:image/*` of at most 64 kB, shown through `<img>`; names
  are text, cut at 40 characters). With several wallets "My wallet" shows a chooser (icon, name, rdns; an rdns claimed
  by more than one provider is marked duplicate with a warning) and asks no wallet anything until one is picked. The
  pick is that provider object and only a click in the chooser changes it; its rdns is remembered in localStorage
  `ember-world-wallet-choice`. On a later visit the remembered rdns is used only when exactly one announced wallet has
  it: if two claim it, or it has not announced while another has, the chooser is shown instead (no fallback to
  whichever wallet announced first). With nothing remembered, one announced wallet is used directly; with none
  announced, `window.ethereum`. Every
  wallet call goes to the chosen provider (`AuthClient` deps `provider` + `onProviderChange`). Choosing another wallet
  drops an in-flight sign-in (its challenge is ended at the server; a late signature is never verified), forgets the old
  account, follows only the new wallet's `accountsChanged`, and reads its granted account silently: a different address
  shows as a mismatch, so owner mode ends until that address signs in. `accountsChanged` to another address ends the
  old session at the server (as before). `chainChanged` is deliberately not followed: the SIWE message is always
  chainId 1 and personal_sign does not depend on the wallet's chain. A verify answer naming any address other than the
  one that asked is not adopted and its cookie is logged out. The only wallet RPC methods the client calls are
  `eth_accounts`, `eth_requestAccounts` and `personal_sign` (SIWE sign-in only); it listens to `accountsChanged`.

## 15. Swarm review follow-ups, round 2 (2026-09-29; job 4bd31cfb, remediation doc v1.0)

- **F-2, wallet type and verification method.** Every new session records `wallet_type` (`EOA` | `CONTRACT`) and
  `verification_method` (`ECDSA` | `ERC1271`) (`migrations/0003_sign_in_layers.sql`, nullable; sessions from before it
  keep NULL). Audit and debugging only: nothing reads them to grant anything, `/api/auth/session` does not return them,
  and ownership is still `ownerOf`. `EOA`/`ECDSA` means the address's own key signed (a 7702-delegated EOA signing with
  its key counts; no chain read is made); `CONTRACT`/`ERC1271` means the contract at the address answered exactly the
  magic word. The ERC-1271 path fails closed in every way it can be unavailable: no key, the node down or erroring
  (503 `VERIFY_UNAVAILABLE`), a refused or throwing budget (429 `CHAIN_BUSY`), a missing binding (503
  `LIMITER_UNAVAILABLE`); none of them ever makes a session or falls back to trusting the address.
  Smart-wallet owner-mode risk (stated, not fixed): ERC-1271 lets the contract decide who may sign for it. A contract
  that accepts any signature (some vaults, escrows or badly written wallets) lets anyone sign in as it, and if it holds
  a seat, anyone gets owner mode for that seat (today: a local, read-only view). The session's `CONTRACT` mark makes such
  sessions visible in D1; it does not make them safer.
  Reminder for the Genesis Mint (not changed in this round): a World session is not consent to mint. If the Mint ever
  reuses this session, whether it needs its own explicit signature or transaction confirmation is decided by the Mint's
  own specification and review. The boundary a Mint page on this origin starts from (Swarm retest e48d0a96 G-1..G-3 and
  the S-2 checklist) is `docs/security/MINT_BOUNDARY.md`; it reviews no Mint code.
- **F-3, smart-wallet budget split (and round-1 R-3 closed).** The ERC-1271 path (`server/auth.ts verifySignature`)
  now asks, each before the read it pays for, with one check per challenge (the claim) and every refusal 429
  `CHAIN_BUSY` + burn: the claim (per /24 or /48: 10 a minute, one `eth_getCode` each); `chain:code` (180/min per
  Cloudflare location, a constant key in the `API_LIMITER` namespace, fails closed, missing binding 503); `eth_getCode`
  (no code: 401, cached 60 s); the contract check `CLAIM_CONTRACT` (per network 3 a minute, per contract address 2 a
  minute over all networks; `login_challenges.called_at` and two partial indexes, `migrations/0003`); the per-location
  `CHAIN_LIMITER` key, `chain:erc1271:known` for an address that already signed in by ERC-1271 (a kept session with
  `verification_method='ERC1271'`, up to 8 days; it skips the code read and the claim's code share) else
  `chain:erc1271` (20/min each); once an address's 2 are spent, `CLAIM_LANE` (in the same batch) still gives each
  network one check of it a minute, within the network's 3, on its own key `chain:erc1271:lane` (20/min per location;
  Swarm audit 519db624 A-1); then one `eth_call`.
  Numbers, per location: closing first-time smart-wallet sign-in takes ≥ 7 /24s aimed at ≥ 10 distinct contracts
  (before: 7 /24s, any one contract); returning smart wallets have their own key (closing it takes ≥ 7 more /24s
  aimed at ≥ 10 addresses that signed in here by ERC-1271 — which can be contracts the attacker deploys itself, e.g. one
  that accepts any signature (F-2), at the cost of gas and one first-time sign-in each, and stay "known" for 8 days); closing `chain:code` takes ≥ 18 /24s and delays only first-time smart
  wallets. Garbage from one /24 leaves its neighbours: garbage for EOAs spends only its 10 code reads (a returning
  Safe needs none), garbage at one contract only 2 of its 3 contract checks. Garbage from a few other networks no longer
  holds one contract (A-1; before, 2 garbage checks a minute from anywhere held it at 429): its owner's network keeps its
  own check while the location's `chain:erc1271:lane` lasts. Improved, not fixed: garbage from the owner's own /24 (/48)
  holds it (reason `address`), and so do ≥ 9 /24s aimed at ≥ 3 addresses every minute, which keep `chain:erc1271:lane`
  closed at a location (reason `budget_lane`). Lane checks set
  `called_at`, so the two shared keys still see ≤ 2 checks per address a minute and the numbers above hold. Alchemy:
  `eth_getCode` ≤ 10/min per /24, ≤ 180/min per location, ≤ the challenge valve (600/min) overall; `eth_call` ≤ 3/min
  per /24, ≤ 2/min per contract through the shared keys plus 1 per network through the lane, ≤ 60/min per location.
  Tests: `tests/auth.test.mjs` "ERC-1271 shares", "F-3: …" (acceptance 1–4 of the remediation doc) and "A-1: …".
- **F-5, sign-in limits in layers.** L1 per network (IPv4 /24, IPv6 /48): 30 challenges a minute, plus the ERC-1271
  shares of F-3. L2 per wallet: no challenge is refused for its address (Swarm audit 519db624 A-6 removed the
  5-a-minute per-(address, network) cooldown: a neighbour in the same /24 could use it up and keep the key holder from
  asking); ECDSA sign-in is never gated by any per-address limit. One address asked for from many networks is not blocked: from its
  20th challenge within a minute on, each challenge writes an `auth_surge` line (one line alone would usually be lost to
  the 0.2 log sampling).
  L3 per challenge: one-time nonce, burnt on any failure, one ERC-1271 check (unchanged). L4 per location: `AUTH_LIMITER`
  20/min per IP for challenges and, under `verify:`+IP keys of the same binding, 20/min for verifies, so a challenge
  flood never starves verify (no new binding); `CHAIN_LIMITER` and `chain:code` for the ERC-1271 path. L5 global: the
  challenge valve, 60 per 6 s (600/min), the emergency ceiling only (real traffic is a few a minute), 20 of them only
  for a network with no challenge in the last minute (A-7); keeping the rest shut takes 14 /24s at full share, and the
  reserve 200 further networks a minute each asking once (≥ 214 networks and ≥ 220 IPs: 14 /24s at full share take
  26 IPs, 20 one-IP /24s 20; before A-7, 20 /24s shut it for
  everyone). Every D1 count is dated when the request body has arrived, and the contract check again after its code
  read, so a body sent slowly cannot place its claims in an earlier minute (Swarm audit 519db624 A-5). Every 429/503 of
  the account routes writes one JSON line `{evt:'auth_refused', route, status, error, reason, colo, net, walletType?}`
  (reason: the refusing layer or bucket: `auth`, `verify`, `network`, `global`, `code_share`, `code_cap`,
  `network_contract`, `address`, `budget`, `budget_known`, `budget_lane`, `rpc`, `home`, `api`, `missing:<BINDING>`,
  `error`), and a surge `{evt:'auth_surge', route, reason:'address_surge', addr
  (the address's first 6 characters: '0x' and 4 hex digits), colo, net}`; since Swarm audit 1ef8e8a6 (§17), a claim kept
  counted after its key refused it writes `{evt:'index_lane_kept'|'erc1271_claim_kept', route, reason:'release_cap'|
  'release_failed', colo, net}`, at most one per claim. About the client a line carries exactly `net`, a network key
  derived from its IP (IPv4 /24, IPv6 /48, `net:unknown` without one or for text that is not an address, §17), and on
  surge lines `addr`; no line
  carries a full IP, a full address, a cookie, token, signature, message or nonce (Swarm retest W-2 wording). These are
  the lines this code writes; what Cloudflare records about an invocation on its own is not covered here. Workers Logs (observability, head sampling 0.2) keeps about one line in five, so
  monitoring reads counts as about 1/5 of the real number. D1 per
  challenge: +1 index entry written (`login_challenges_address`), ≤ 1 + 21 more rows read (≤ 30 more on a refusal);
  worst-case monthly figures in `server/auth.ts`.
- **F-1, the statement names approvals.** `SIWE_STATEMENT` (`src/world/siwe.ts`, shared by the server that builds the
  message and the page that checks it before `personal_sign`) now reads "…This does not authorize asset transfers, token
  or NFT approvals, or transactions." and keeps "for 7 days". The page accepts only this text. The server verifies the
  message it stored; the F-1 release also verified a challenge issued by the previous build (the old wording) during
  the 5 minutes it could stay open across that deploy. That allowance (`SIWE_PREVIOUS_STATEMENTS`) was removed in
  `fc533e5` (2026-09-29; in Worker `c89f5915` as the team's deployment record lists it): verify accepts only
  `SIWE_STATEMENT`; any other statement is 401 and burns the challenge. A later statement change needs such an allowance again for one release. The build live before this
  one has no page check, so its open pages sign the new statement as before; from now on a later statement change
  makes open pages refuse ("message-mismatch", nothing signed) until they are reloaded. This is defence in depth, not
  a cure for phishing: a phishing page can skip any check this page makes.
- **Page and docs (round 2).** F-1 UX: while the wallet's prompt is open, My wallet shows a summary read back from the
  checked message (§9 item 2). F-4 UX: "Log out this device" / "Log out all devices" (§9 item 6). The round-1 review
  link is replaced by a collapsed "Swarm Audit Record" / 「審查紀錄」 at the foot of My wallet in every state
  (`src/world/reviewRecord.ts` data, `src/world/auditRecord.ts` markup): scope, reviewed version and date, job and
  report, deployment match `partial`, "Previous review — current version has changed", each finding's severity and
  status. F-6: wrangler 4.143.0 (`compatibility_date` unchanged; `npm audit` 0 on 2026-09-28; the dated counts after,
  including the 3 moderate dev-only advisories of 2026-09-29 before the undici 7.29.1 pin, are in
  `docs/security/AUDIT_REMEDIATION_STATUS.md` F-6). Status of every finding, the limit
  table and the regression-test map: `docs/security/AUDIT_REMEDIATION_STATUS.md`; deployment evidence:
  `scripts/deploy-evidence.mjs`.
- **Internal re-check of round 2 (2026-09-29).** The known-smart-wallet lookup (`KNOWN_ERC1271`) and logout-all's
  revocation (`REVOKE_ALL_SESSIONS`) read through two partial indexes added to `migrations/0003` (`sessions_erc1271`,
  `sessions_live`), so an address's ECDSA or revoked sessions, however many, are never visited. A session write that
  fails for any reason but a UNIQUE race (a deploy ahead of 0003, D1 down) is a logged 503 `AUTH_UNAVAILABLE`, not a
  silent 409. The audit record says its statuses are the team's own account, not re-reviewed, and has a "Re-review:
  none yet" row (on `backlog-0929` since 2026-09-30 the row links the two Swarm re-reviews of Worker 50c688c9, Report
  e48d0a96 and Audit 519db624, whose findings follow with the team's statuses; this version was not re-reviewed). The WAF rule on the evidence page is marked as stated (not read from Cloudflare), with a rule-id field.

## 16. Swarm audit 8c3aea2e follow-ups (2026-09-30; deployed in Worker `bbf24001` on 2026-10-01, after migration 0005)

Swarm audit 8c3aea2e reviewed the code of Worker `1a0dd495` (snapshot `ae1d41a`) and reported N-1..N-7 (6 Low, 1 Info;
no transfer, forged sign-in or ownership-forgery path). Status, tests and residuals of each:
`docs/security/AUDIT_REMEDIATION_STATUS.md` "Swarm audit 8c3aea2e".

- **N-1, session reads in order** (`src/world/auth.ts`). Every `GET /api/auth/session` read takes a number
  (`sessionReads`, apart from `gen` and `homeGen`); only the newest one's answer, body or failure is applied. A read that
  applies "signed out" or another session drops the replaced session's house read (`homeGen`), and so does a sign-in as
  it begins; a 401 on the house route with no session held changes nothing; a sign-in click waits until no session read
  is running. No wallet prompt is added.
- **N-2, no prompt from a dead sign-in** (`src/world/auth.ts`). After the challenge body, the flow asks the wallet only
  while it is the live flow (`gen`) with the same provider and account; late refusals change only the live flow; the
  client's teardown ends an in-flight flow and resets its phase. A click still waiting for a session read is ended by a
  sign-out, a switch or the teardown in that wait (`5261844`). A wallet window already open cannot be closed; its answer
  is dropped.
- **N-3, the cap ranks by the counting rule** (`server/ownership.ts`, §7 item 1). One predicate, `counts()`, for the seat
  status, the cap's rank and the N-6 lane; one sighting read per proof build, only past the cap.
- **N-4, lane checks counted apart** (`server/auth.ts` `CLAIM_LANE`, `login_challenges.called_via`). Only lane checks use
  up a network's lane of an address, so the owner's own earlier shared check leaves it; a subscriber (/24, IPv6 /64) that
  made both of the address's shared checks itself takes none (F-3's "2 of its 3" holds).
- **N-5, nested IPv6 shares** (`worker/app.ts` `subnetKey`, `server/auth.ts` `NET6_SCALE`, `login_challenges.sub`). A
  /48 has twice each /24 share (60 challenges, 20 code claims, 6 contract checks, 2 lanes per address a minute) and each
  /64 in it at most one /24's ERC-1271 claims and contract checks, counted by the /64 that asked for the challenge, never
  by the verifier's address. IPv4 is unchanged; logs still carry only the /48.
- **N-6, a discovery lane** (`server/ownership.ts` `home`, `server/auth.ts` `INDEX_LANE`, `CHAIN_KEYS.indexLane`). When
  `chain:index` refused a read whose answer counts no seat, the requester's network gets one index read a minute (IPv6:
  two per /48, one per /64; at most 60 per 6 s site-wide), counted in D1 first, then on `chain:index:lane` (20/min per
  location, fails closed; no new binding). `ownerOf` proves every candidate; a refused lane stays `limited`.
- **N-7, a revocation is not an expiry** (`src/world/auth.ts`, `walletView.ts` `endedText`, `WalletPanel.tsx`, the session
  route). `AuthState.ended` (`expired` | `revoked` | `signed-out`) says why the last session ended: 「登入已到期，請重新登入。」 /
  "Your sign-in has expired. Please sign in again." only when it ran out, 「登入狀態已失效，請重新登入。」 / "You are no
  longer signed in. Please sign in again." for any other sign-out the page learns of, 「已登出。」 / "Signed out." after its
  own; never "another device" from `AUTH_REQUIRED` alone.
- **Page and docs.** The Swarm Audit Record lists this audit under "Later review" / 「之後的審查」 (Worker 1a0dd495, not
  this version) with N-1..N-7 and the team's statuses; A-1's and A-6's lines name what N-4 and N-5 change.

## 17. Swarm Report dcf922ca and Swarm audit 1ef8e8a6 follow-ups (2026-10-01; deployed in Worker `63c6c7bd`, 2026-10-02)

Swarm Report dcf922ca (a limited retest; deployment match partial) and Swarm audit 1ef8e8a6 reviewed the code of Worker
`bbf24001` (snapshot `8cad017`) and reported R-1 (Low) and #1..#9 (3 Low, 5 Info and a review record); the owner's
handoff names them R3-R1 and AUD3-01..AUD3-09. Neither reported a new high or medium finding, a forged sign-in, a
revived session, a foreign logout, foreign owner rights, other signing or an asset path; the Report kept the residuals
stated before, among them F-1/S-1, A-1, F-2 and F-8. AUD3-02 and AUD3-05 are only partly fixed (below). Status, tests,
residuals and the handoff's matrix T01..T41: `docs/security/AUDIT_REMEDIATION_STATUS.md` "Swarm reviews of Worker
bbf24001". No migration, binding or limiter key is added.

- **R3-R1, account events win over late wallet answers** (`src/world/auth.ts`). `accountChanged` counts every event
  (`accountEvents`). A connect answer, or `bind()`'s `eth_accounts` answer, awaited while an event came is applied only if
  it names the account the latest event set; otherwise the click ends with nothing set, asked or verified. A lock or
  another wallet while the signature prompt is open verifies nothing (a wallet change that fires `providerChanged` is
  ended by `gen` already; the wallet half of that check covers one that changes with no event). No prompt is ever
  opened to recover; a normal connect that announces the same account goes on.
- **AUD3-04, a confirmed logout ends older reads** (`src/world/auth.ts` `loggedOut`). A 2xx logout of this page's
  (`signOut`, the account-switch logout, `providerChanged`, `revokeAbandoned`, and since `bd4f749` the sign-in click's
  own logout of another address's session) makes every session and house read begun before it stale and ends a session
  a read showed meanwhile, unless a newer flow began since it was sent. Since `10bb630` (the team's final check,
  ADV-1/ADV-2) the click's logout, like the account switch's, names the session it ends, and its confirmation ends that
  very session (same address and expiry) even after `gen` moved on, never a newer one; and it is told to other tabs
  (`signed-out`). Since `f095642` (the team's re-check, ADVR-1) `signOut`'s logout names its session too (confirmed after
  another flow began, it still ends that session, says "Signed out." and tells the other tabs), and `revokeAbandoned`'s
  names the late session its verify returned. Since `7b2d74d` (the team's review of `066d109`, RC-1) that logout goes out
  on the verify's headers again, and the body, read on its own, names the session it ends (read after the logout was
  confirmed, it ends that very session then, nothing else).
- **AUD3-05, an answer for another address is not "unreadable"** (`refreshHome`). The held house is dropped
  (`home:'unavailable'`) and `checking` ends before the session is re-read. Until a read succeeds the panel still shows
  the held session as signed in, without owner mode (the stated residual, ADV-4), which the audit expected the page to
  stop showing: partly fixed (dropping or marking that session is the owner's choice).
- **AUD3-06, a dead cookie is refused, not cleared** (`server/auth.ts`; §2 and §5 above). The session route, the
  `/api/me/home` 401 and the logout-all 401 send no session Set-Cookie, so a late answer cannot delete a cookie another
  tab has just set. Sign-in and the explicit logouts still write it; an explicit logout answered after another tab's
  sign-in still clears that cookie (the stated residual). Since `10bb630` (ADV-3) the page tracks its own logouts (and
  an abandoned flow's verify) until handled, and a click waits for them before any challenge or connect prompt, at most
  `LOGOUT_WAIT_MS` (5 s), so its own logouts cannot clear the cookie of its next sign-in. Since `f095642` (ADVR-5) the
  wait is shown (My wallet says it waits for a log-out, its sign button off) and one that runs out asks nothing and ends
  with `logout-slow` (that log-out has not been answered); before, nothing was shown and it ended with `session-unknown`.
  Since `7b2d74d` (RC-2) that line is a state of its own (`AuthState.waiting`, shown in the notice's place), no longer
  the notice `logout-pending`, which a session or house read failing during the wait replaced.
- **AUD3-07, logout-all names an expiry** (`logoutAllRequest`, `signOut`). A 401 `SESSION_EXPIRED` sets `expired` and
  `ended:'expired'`; any other 401 names no cause. A refused logout-all re-reads the session once (the browser may hold
  another tab's new cookie) and only then says other devices were not signed out.
- **AUD3-01, a failed lane read keeps the first proof** (`server/ownership.ts` `home`). An `OwnershipUnavailable` from the
  lane's rebuild leaves the request's first proof and its sightings: 200 `limited`, never 503; the lane stays spent.
  Any other error (D1 failing, say) propagates as before: 503.
- **AUD3-02, a refused lane claim is released** (`server/auth.ts` `INDEX_LANE … RETURNING rowid`, `INDEX_LANE_RELEASE`).
  A claim whose `chain:index:lane` key refused (or failed) is dated back (out of the site-wide count at once, its network
  may claim again after 30 s) and marked `released:`, at most 20 per 6 s site-wide; past that, or if the release fails,
  it holds its network for the minute and the site-wide count for its 6 s slice, as before, and an `index_lane_kept`
  line says why. The cron prunes a released row 30 s earlier. Partly fixed: about 80 claims in one 6 s slice at one
  location (60 before) still fill the site-wide ceiling for every other location for that slice.
- **AUD3-03, a refused contract claim is released** (`server/auth.ts` `RELEASE_CONTRACT`, `RELEASE_CONTRACT_0004`,
  `SignatureGate.release`). A claim whose key did not admit the check (no `eth_call` sent) is cleared on its own nonce and
  claim time; `checked_at` and the burn stay. A check that was sent counts whatever the answer. A failed release keeps
  the claim and writes an `erc1271_claim_kept` line.
- **AUD3-08, the whole address is parsed** (`worker/app.ts` `rateLimitKey`). Canonical dotted IPv4; IPv6 with at most one
  `::` and a dotted quad only last; `::ffff:0:0/96` in either form is its IPv4; any other dotted tail stays IPv6; the
  rest of the zero /64 and anything that is not an address share `ip:unknown` (`net:unknown`). Canonical keys and the
  N-5 nesting are unchanged.
- **Assumption, not verified:** the releases of AUD3-02 and AUD3-03 assume a refused call to a Cloudflare rate-limit
  binding takes nothing from anyone (the repository's fixed-window model); the measured bounds if it does count are in
  the cost comment of `server/auth.ts` and the status doc.
- **The team's mutation check** (after `d429ec3`, not an outside review). Eleven one-check weakenings of these fixes
  passed every test, and AUD3-04 had left out the sign-in click's own logout; `bd4f749` covers that path and adds the
  tests that now fail each weakening (the status doc lists them). The other fixes' code is unchanged.
- **The team's final check** (after the merge at `125248c`, not an outside review). ADV-1..ADV-3, gaps in the sign-in
  click's logouts present since `f4272c5`, are closed in `10bb630` (`src/world/auth.ts`, nine tests; above); ADV-4 and
  the record points change four site statuses (AUD3-02 partly fixed, AUD3-04, AUD3-05 and AUD3-06). The Worker bundle
  is unchanged: the dry-run gives `a7bb8087…` at `f2db1f5`, at `125248c`, at `10bb630` and with this record.
- **The team's re-check** (after `2f5d6c1`, not an outside review). ADVR-1 (ADV-1 only partly fixed: the sign-out's and
  an abandoned flow's logouts did not name their session) and ADVR-5 (the wait showed nothing, and one that ran out gave
  the wrong reason) are closed in `f095642` (`src/world/auth.ts`, `src/world/WalletPanel.tsx`; eleven tests: three
  `ADV-n` and eight guards, seven for weakenings no test caught before (ADVR-2..ADVR-4) and one for the waiting notice's
  end); DR-1..DR-4 correct the record, AUD3-05 partly fixed among them. The Worker bundle is still `a7bb8087…` with
  that record, `066d109` (its `server/auth.ts` change is comments only).
- **The team's review of `066d109`** (not an outside review). RC-1 (a regression of `f095642` in an edge case: an
  abandoned flow's late session was logged out only after its verify body, so a body that stalled after its headers
  left that session live and held every click until its wait ran out) and RC-2 (a session or house read failing during
  the wait replaced the waiting notice, beside a sign button that was on) are closed in `7b2d74d` (`src/world/auth.ts`,
  `src/world/WalletPanel.tsx`; eleven tests: five `ADV-n`, four of them failing on `066d109` and one for a line of
  `f095642` no test covered (RC-3), and six guards, five for weakenings of `f095642` no test caught (RC-4, RC-5; M20
  among them, for which the review had found no reachable consequence) and one for the ends of the new waiting state);
  DOC-1..DOC-3 correct the record. No status on the site changes. The Worker bundle: still `a7bb8087…` (283,716 bytes) at `7b2d74d` and with its record.
- **The team's review of `13449f2`** (not an outside review). CF-1, CF-2: guards for two lines of `revokeAbandoned` (a late
  body ends only the session it names, and only after a reached logout). CF-3: `signOut`'s branch for a sign-out a newer
  flow overtook now reads the session afresh after a refused "Log out all devices" (401), as the live path does (it kept
  a session another device had ended, in owner mode, until the owner re-check). CF-4, CF-5 correct the record. Closed in
  `901420a` (three tests; the M20 guard now expects `ended: 'revoked'`). No full review followed (the owner's choice).
  No status on the site changes. The Worker bundle: still `a7bb8087…` (283,716 bytes) at `901420a`.
- **Page and docs.** The Swarm Audit Record lists both reviews under "Reviews of Worker bbf24001" / 「Worker bbf24001
  的審查」 (Worker bbf24001, not this version) with R3-R1, AUD3-01..AUD3-09 and the team's statuses.

## R4 / AUD4 amendment (2026-10-04)

Fourth-review fixes are documented in `../security/AUD4_REMEDIATION.md`; these details supersede older descriptions
above where they differ. Logout-all now requires expectedAddress to match the live cookie before any revocation or
cookie/flow change. A conflict reconciles the client and never claims a completed all-device logout.

An uncertain verify result reconciles the server session before another signature can be requested. Abandoned
verify cleanup sends the original challenge nonce as a consistency assertion against the current cookie; a newer
session of the same or another address is not selected merely because that cookie is present. Explicit logout response
arrival across tabs can still clear a newer cookie; client generation guards do not remove that browser-level boundary.

The exact shared SIWE text and the three existing wallet methods are unchanged. EOA/ECDSA World sessions can write
selected public M1 profile data without another signature; CONTRACT/ERC1271 and unknown types cannot perform those
writes under the temporary policy. A permissive ERC-1271 contract still controls its own login validity, not its house
proof. See `../security/MINT_BOUNDARY.md`: no World session is authorization for Mint or asset transactions.
