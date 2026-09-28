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
| `POST /api/auth/verify` body `{nonce,signature}` | Origin + flow cookie | 200 `{address,expiresAt}` + `Set-Cookie __Host-imd_session`, flow cookie cleared | 400 `BAD_REQUEST` / `UNSUPPORTED_SIGNATURE` (ERC-6492 wrapper), 401 `SIGNATURE_INVALID`, 403 `ORIGIN_NOT_ALLOWED` / `FLOW_MISMATCH`, 409 `CHALLENGE_USED` (used, superseded or lost a concurrent race), 410 `CHALLENGE_EXPIRED`, 429, 503 `AUTH_UNAVAILABLE` / `VERIFY_UNAVAILABLE` (ERC-1271 needed but no RPC key) |
| `GET /api/auth/session` | cookie | 200 `{signedIn:false}` or `{signedIn:true,address,expiresAt}`; a dead cookie is also cleared | 503 `AUTH_UNAVAILABLE` |
| `POST /api/auth/logout` | Origin | 204, session revoked, both cookies cleared, open challenges of this flow invalidated; idempotent | 403 `ORIGIN_NOT_ALLOWED`, 429 |
| `GET /api/me/home` | session | 200 `{address,seats:[{tokenId,agentId,online,lastOnlineAt,counts}],eligible,size|null,block,checkedAt}` | 401 `AUTH_REQUIRED` / `SESSION_EXPIRED`, 429, 503 `OWNERSHIP_UNAVAILABLE` (never "you own nothing") |
| `GET /api/wallet/:address/assets` | none (public chain data) | 200 `{address,seats:[{tokenId,image,agentId,online,counts}],characters:{collections:[],items:[]},fetchedAt}`, `Cache-Control: public, max-age=300` | 400 `BAD_REQUEST`, 429, 503 `OWNERSHIP_UNAVAILABLE` |

Rate limits (per client key, `rateLimitKey`): `AUTH_LIMITER` (id 4103, 20/60 s) on challenge, verify, logout and
`/api/me/home`; `API_LIMITER` + `SEAT_LIMITER` on `/api/wallet/*` (it spends Alchemy compute per new address). Unlike the
read API, the auth bucket fails **closed** when the binding throws (429); an absent binding allows only on a loopback URL
(on imdember.com it is 503). Hardening of 2026-09-28 (server/auth.ts): D1 challenge budgets per network (IPv4 /24, IPv6
/48: 30/min) and a global valve (60 per 6 s), 429 `SIGN_IN_BUSY`; ERC-1271 checks claim the challenge first and spend a
per-network share (3/min) and `CHAIN_LIMITER` (`chain:erc1271`, per location), 429 `CHAIN_BUSY` burns the challenge; every
NFT index read of `/api/me/home` spends `chain:index` (refused: roster candidates only, `recheck:'limited'`).

## 3. SIWE message (server-built, client only signs)

Built with viem `createSiweMessage` from server values only; the exact text is stored in `login_challenges.message`
and verified from there, so nothing the client sends back can change what was signed.

| Field | Value |
|---|---|
| domain | host of the request `Origin`, which must be in the allow-list: `https://imdember.com`; and `http://localhost:<port>` / `http://127.0.0.1:<port>` only when the request URL's own hostname is loopback (so production can never accept them, no config needed) |
| address | `getAddress(body.address)` (EIP-55); stored lowercased |
| statement | `Sign in to IMD Ember World to access your home for 7 days. This does not authorize asset transfers or transactions.` (ASCII; the session lifetime is stated here, see Amendments F2) |
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
   magic `0x1626ba7e` → valid; no code / revert / other → 401. No key → 503 `VERIFY_UNAVAILABLE`.
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
  verify also needs the flow cookie. GETs change nothing (`/api/auth/session` may only clear a dead cookie).
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
Housekeeping in the cron: delete challenges with `accept_until < now − 1 day`, sessions with `expires_at < now − 1 day`.
`seat_presence` is never deleted ([REDACTED]). Tests run this exact file on `node:sqlite` through a small
D1-shaped adapter (`prepare/bind/first/all/run/batch`, batch = one transaction).

## 7. Ownership and eligibility (`server/ownership.ts`)

Chain reads go through an injected `chainFetch` (default `upstreamFetch`; Authorization is set, so never edge cached).
Key only in `Authorization: Bearer`, never in a URL or an error text.

1. **Candidates** for the session address: `swarm.owners[i] == address` (gateway cache, IMD's view) ∪ Alchemy
   `getNFTsForOwner(owner, contractAddresses[]=SEAT_COLLECTION)` (catches a second-hand buyer IMD has not indexed).
   Capped at 256 ids (supply 2000; largest holder today 20).
2. **Verify**: one `eth_call` to Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` `aggregate3` with
   `getBlockNumber()` + `ownerOf(id)` for each candidate (`allowFailure`), at `latest`, chunked by 200. A revert
   (burnt / nonexistent id) = not owned. Result: verified ids + the block number of the read (one atomic block).
   Policy: `latest` is fine for a reversible Web2 permission; a reorg only delays revocation by ≤ the cache age.
3. **Eligible seat** = verified owner && `agentId` known (swarm seats or workers) && (listed in the fresh `/workers`
   read now || `seat_presence.last_online_at ≥ now − 24 h`). Size = `houseSize(eligible)`; 0 → no house.
4. Cache: per address in the isolate, 30 s (LRU 512). No key, Alchemy error, or an unavailable swarm read → 503
   `OWNERSHIP_UNAVAILABLE`; nothing is cached as "owns nothing". Revocation bound after a sale: ≤ 30 s (cache) + the
   client re-read (panel open, focus, or every 60 s while owner mode is on).

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
A failed or partial read writes nothing (never "offline"). CPU: parsing a 459 KB workers body 0.4–0.9 ms, the 105 KB
swarm 0.1–0.2 ms, the JSON parameter 0.1 ms (Node, measured) — a few ms per run. Writes ≈ 430 × 96/day ≈ 41 k rows/day
([REDACTED-INTERNAL]).

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
| expired | 登入已到期，重新驗證後即可回家 / Session expired, sign in again to go home |
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
- Owner re-check: on panel open, window focus, and every 60 s while owner mode is on; 401 → `expired`, 503 →
  `ownershipUnavailable` (owner mode suspended, house kept), zero eligible → `signedInNoHouse`.
- Marker: `scene.setMyHome(home, label)` gets 「我家 / My home」 only in `owner` state for the household of the session
  address; a typed or merely connected address gets 「這個錢包的家 / This wallet's home」. The label is local to this
  browser, never sent or broadcast.
- Existing move flow unchanged (still gated by a connected wallet; its note already says it is local only).

My-wallet panel (existing drawer: right sheet 420 px on desktop, bottom sheet from 15dvh on phones — modal, so it never
overlaps the onboarding HUD, speaker toggle, world-time card or minimap, which the drawer already hides):
1. Header: short address + copy, state badge (已登入 · 有效至 <date> / 未登入 / 只看).
2. Primary action for the state; above the sign button the pre-sign note 「此次簽名僅用於登入 IMD Ember World、確認錢包控制權。
   不收取 Gas，也不授予 NFT 或代幣轉移權限。」 / "This signature only signs you in to IMD Ember World and proves you control the
   wallet. It costs no gas and grants no NFT or token transfer rights."
3. 我的家 (owner): size, eligible count, [回家] [搬家…] (existing actions), last checked time, refresh.
4. 資產 · IMD 席位: rows `#361 · 在線/離線 · 計入房子/不計入 (reason)`, tap = locate the agent; loading / 503 / empty states
   distinct ("目前未查到此錢包持有 IMD" only on a successful empty read).
5. Pepe 角色 NFT: grid from `CHARACTER_COLLECTIONS`, or 「即將推出 / Coming soon」.
6. Footer: 登出 / Sign out, 換一個錢包, view-by-address form (view only, never owner).

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
| INT-1 | med | The 60 s owner re-check pauses in hidden tabs and runs once when shown; the server keeps the NFT-index answer 5 min per address (30 s on "Check again") and still proves `ownerOf` every 30 s, so a sale shows within one re-check. An hour of re-checks = 60 `eth_call` + 12 index calls (was 60 + 60). |
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
