import {getAddress,isAddressEqual,recoverMessageAddress,hashMessage,encodeFunctionData} from 'viem';
import {createSiweMessage,parseSiweMessage,validateSiweMessage} from 'viem/siwe';
import {secp256k1} from '@noble/curves/secp256k1';
import type {D1Database} from './d1.ts';
import type {WaitUntil} from './gateway.ts';
import {API_HEADERS,LimiterMissing} from './world-api.ts';
import {rpc,OwnershipUnavailable,type ChainAccess,type Ownership} from './ownership.ts';
import {SIWE_STATEMENT} from '../src/world/siwe.ts';
// Wallet sign-in (SIWE, EIP-4361), sessions, and the account routes (DESIGN_W1 §2–§5). The server builds and stores
// the exact message; the page checks it line for line before the wallet sees it (src/world/siwe.ts, F-7a) and then only
// personal_signs it, so nothing it sends back can change what was signed.
// Routes: POST /api/auth/challenge|verify|logout|logout-all, GET /api/auth/session, GET /api/me/home, GET /api/wallet/:a/assets.
// Every response carries API_HEADERS (no-store unless stated) and never an Access-Control-* header (same origin only).

// Cold start: noble builds the secp256k1 base-point table on the first recovery; its default window (8) costs ~45 ms,
// which a fresh isolate cannot afford under cpu_ms 50. Window 4 costs 4–6 ms and leaves a warm recovery unchanged.
// This must be the same @noble/curves instance viem uses (tests/auth.test.mjs pins that and the cold time).
secp256k1.ProjectivePoint.BASE._setWindowSize(4);

export const PRODUCTION_ORIGINS:readonly string[]=['https://imdember.com'];
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
export const FLOW_COOKIE='__Host-imd_flow',SESSION_COOKIE='__Host-imd_session';
/** A challenge is accepted this long after issue, and its SIWE Expiration Time says exactly that (the wallet shows it); a
 *  session lives SESSION_TTL_MS from the challenge's issue (absolute, no renewal), which the statement states in words. */
export const CHALLENGE_TTL_MS=5*60_000,SESSION_TTL_MS=7*86_400_000;
export const BODY_LIMIT=2048;
/** Sign-in limits in layers (review F-5, 2026-09-29; Swarm audit 519db624 A-1, A-5–A-7; Swarm audit 8c3aea2e N-4, N-5),
 *  each a share of the one below it, so no single place can close sign-in for everyone; availability first: a few
 *  networks must never lock ordinary players out of sign-in.
 *   L1 per network: NETWORK_CHALLENGE_BUDGET challenges and the ERC-1271 shares below per /24. An IPv6 /48 (the unit an
 *     operator or a tunnel broker hands out) gets NET6_SCALE (2) times each, and each /64 in it (a subscriber: the /64
 *     that asked for the challenge, `sub`, recorded at issue, N-5) at most one /24's ERC-1271 claims and contract checks
 *     (its challenges: L4's 20 a minute). Every ERC-1271 count is the challenge's network and /64, whoever sends the
 *     verify, so rotating host bits gains nothing and rotating /64s stays within the /48's two shares.
 *   L2 per wallet: no challenge is refused for its address (A-6: a per-(address, network) cooldown let a neighbour in the
 *     /24 use up the key holder's challenges). One address asked for from many networks is logged: from the ADDRESS_SURGE-th
 *     challenge for it within a minute on, each writes an audit line (Workers Logs keep a 0.2 sample of invocations, so a
 *     surge must not rest on one line).
 *   L3 per challenge: a one-time nonce, burnt on any failed check, and at most one ERC-1271 check (the claim).
 *   L4 per location (Cloudflare rate-limit bindings, worker/app.ts): AUTH_LIMITER 20/min per IP (IPv6 /64) for
 *     challenges and, under separate 'verify:' keys, 20/min per IP for verifies, so a challenge flood from one place never
 *     starves its own or anyone's verify; CHAIN_LIMITER and 'chain:code' for the ERC-1271 path.
 *   L5 global: CHALLENGE_BUDGET per CHALLENGE_BUDGET_WINDOW_MS, the emergency ceiling only (600/min; real traffic is a few
 *     a minute), asked last; FRESH_NETWORK_RESERVE of it only for a network with no challenge in the last minute (A-7).
 *  Every 429/503 of these routes, and every challenge of a surge, writes one JSON line (handleAccountApi: evt, route, status,
 *  error, reason, colo, net, walletType when known), and so does a claim kept counted after its key refused it (Swarm audit
 *  1ef8e8a6: erc1271_claim_kept, reason release_failed, AUD3-03; evt, route, reason, colo, net, at most one per claim;
 *  AUD4-03 index refusals no longer reserve rows or need release logs). About the client they carry exactly: `net`, a key
 *  derived from its IP (IPv4 /24, IPv6 /48, 'net:unknown' without one), and on auth_surge lines `addr`, the address's
 *  first 6 characters ('0x' and 4 hex digits). Never a full IP, a full address, a cookie, token, signature, message or
 *  nonce. IPv6 challenge rows also keep the /64 prefix that asked (`sub`: never the host bits, never logged), as long as
 *  the row lives (about 25 min unused, about a day used).
 *   NETWORK_CHALLENGE_BUDGET challenges per NETWORK_WINDOW_MS from one client network (IPv4 /24, IPv6 /48 twice that;
 *     worker/app.ts networkKey), the first check, so one network gets a small share and its refused requests read at most
 *     that many rows.
 *   CHALLENGE_BUDGET per CHALLENGE_BUDGET_WINDOW_MS across all clients (600/min in 6 s slices, so each count reads at most
 *     60 index entries): the runaway valve. A network that asked within the last NETWORK_WINDOW_MS is admitted only below
 *     CHALLENGE_BUDGET - FRESH_NETWORK_RESERVE (40), which CHALLENGE_BUDGET_NETWORKS (14) /24s (7 IPv6 /48s) at their full
 *     share keep closed; a network that has not asked is admitted below CHALLENGE_BUDGET, so keeping its first challenge out also
 *     takes FRESH_NETWORKS (200) further networks every minute, each asking once and timed to refill the slice. Fewer can
 *     close it only for the seconds their bursts overlap, and otherwise a refusal lands only on the networks that spent
 *     their share. A refusal writes nothing, so a refused network stays fresh. Real traffic is a few challenges a minute.
 *   The ERC-1271 path (a signature ECDSA cannot prove; verifySignature), each step before the keyed read it pays for, one
 *   check per challenge (the claim), any refusal 429 CHAIN_BUSY and the challenge burnt:
 *   - ERC1271_CODE_SHARE claims per NETWORK_WINDOW_MS from one network (L1: 20 per /48, 10 per /64), each at most one
 *     eth_getCode, and then
 *     'chain:code' (CODE_CAP per minute per Cloudflare location, the API_LIMITER namespace, fails closed; a missing
 *     binding is 503): the cheap read that tells an EOA from a contract. "No code" is 401 and cached per address for
 *     NO_CODE_TTL_MS, and never reaches the two steps below, so garbage for EOAs or made-up addresses costs nothing there.
 *   - ERC1271_NETWORK_SHARE contract checks per minute from one network (L1: 6 per /48, 3 per /64) and
 *     ERC1271_ADDRESS_SHARE per contract address (all networks; CLAIM_CONTRACT), then the per-location CHAIN_LIMITER key:
 *     'chain:erc1271:known' for an address that already signed in by ERC-1271 (a session of it is still kept: up to 8
 *     days; it skips the code read and its share, since it had code), else 'chain:erc1271'. Once the address's share is
 *     spent, the network may still make lane checks of that address (CLAIM_LANE, A-1, N-4): one a minute per /24, two
 *     per /48 from two of its /64s. Only lane checks use them up (called_via), so the network's own shared check, such
 *     as its owner's first attempt, leaves the lane; a /24 (IPv6: /64) that made both of the address's shared checks
 *     itself takes none. Within its contract share and on its own key 'chain:erc1271:lane', never the two above. Then
 *     one eth_call.
 *   What that buys, per Cloudflare location (review F-3 and round-1 R-3, 2026-09-29; for IPv6, N-5: a /48 is worth two
 *   /24s, a /64 one): closing first-time smart-wallet sign-in through 'chain:erc1271' (20/min) takes >= 7 /24s (IPv6:
 *   >= 7 /64s over >= 4 /48s) at their full contract share aimed at >= 10 distinct contract addresses (before: 7 /24s,
 *   any one address); lane checks leave that unchanged, since they spend the address's share too (called_at), so the two
 *   keys above still see <= 2 checks per address a minute. Garbage aimed at one address from a few other networks no
 *   longer holds it (A-1): its owner's network keeps a check of its own, which the owner's own earlier attempt no longer
 *   spends (N-4: a retry, or a second device after its sign-in). It is still held by garbage from the owner's own /24
 *   (two verifies that spend the address's shared checks, or one that takes the lane; IPv6: from its /64, or from two
 *   other /64s of its /48; logged: 'address'), or where >= 9 /24s (IPv6: >= 5 /48s using two /64s each, at >= 2
 *   addresses) every minute keep 'chain:erc1271:lane' (20/min) closed: 20 lane checks need their addresses' shares spent
 *   too, 20 + 2 x 3 checks at 3 per /24 (logged: 'budget_lane'; each more address held costs 2 more checks a minute).
 *   Returning smart wallets have a budget of their own: closing 'chain:erc1271:known' takes >= 7 /24s (IPv6 as above)
 *   aimed at >= 10 addresses that signed in here by ERC-1271 in the last 8 days. Those can be the attacker's own: a
 *   contract that accepts any signature (F-2) costs its gas and one first-time sign-in, and stays "known" for 8 days; the
 *   quantity of networks and the limits above still apply. Closing 'chain:code' (180/min) takes >= 18 /24s (9 /48s) of
 *   garbage and delays only first-time smart wallets. One /24's own garbage (IPv6: one /64's) leaves its neighbours in
 *   it: garbage for EOAs spends only its 10 code reads, garbage at one contract only 2 of its 3 contract checks. Alchemy
 *   cost stays bounded: eth_getCode <= 10/min per /24 (20 per /48, 10 per /64), <= 180/min per location and never more
 *   than the challenge valve (600/min in all); eth_call <= 3/min per /24 (6 per /48, 3 per /64), <= 2/min per contract
 *   address through the first two keys plus 1 per /24 (2 per /48) through the lane, and <= 60/min per location (three
 *   keys). These eth_call bounds hold with AUD3-03's release: a check is admitted only with its D1 claim in place and the
 *   key's yes, and a claim stays counted once its check was admitted, whatever the eth_call answers.
 *   ERC-1271 contract claims whose key refused (or failed) are released (AUD3-03), giving back their D1 called share.
 *   Index refusals instead retain a separate 30 s probe marker and never take an admitted D1 share (AUD4-03); there
 *   is no INDEX_LANE release. Neither can refund a Cloudflare token if that limiter counted the denied call. Actual
 *   production denial accounting is unverified. windowLimiter counts every call but uses a fixed 60 s boundary;
 *   a denial-counted sliding model can keep a closed key closed. Measured through the Worker: 10 /24s re-asking
 *   'chain:index:lane' every 30 s keep a buyer out for 3 minutes (9 do not; AUD4-03 preserves that backoff), and 6 /24s
 *   each sending one garbage verify every 6 s keep a first-time smart wallet out of a closed 'chain:erc1271' for
 *   3 minutes (5 do not; under the fixed window none do, and the owner signs in once the minute is over). Re-asks
 *   are bounded: a refusing index key at most twice a minute per network slot (the separate probe gate); a refusing
 *   ERC-1271 key by a /24's challenges and code
 *   share (up to 10 a minute for first-time addresses, 30 for known ones, before: 3).
 *  Every count is dated when the request body has arrived (A-5), and the contract check again after its code read.
 *  Refusals are 429 SIGN_IN_BUSY (challenge) and 429 CHAIN_BUSY (ERC-1271), both Retry-After 60. The first flood guard is
 *  the zone's Cloudflare WAF rate-limiting rule "IMD API anti-flood" (URI path starts with /api/, 20 per 10 s per IP; set in
 *  the dashboard, not in this repository); these are the backstop behind it.
 *  D1 cost (rows as D1 bills them: every index entry a write changes is one more row written):
 *   challenge: 1 batch. INSERT…SELECT reads at most the network's limit + CHALLENGE_BUDGET + 1 index entries (≤ 91, an
 *     IPv6 /48 ≤ 121: the network's count, the valve's count and one entry to tell whether the network is fresh) and
 *     writes 1 row + 5 index entries (nonce, flow, issued, net, address) = 6 (`sub` is in the row, unindexed); the surge
 *     count reads ≤ 21. A refusal also reads ≤ 30 (IPv6 ≤ 60) to name its reason. A browser that brings an earlier flow
 *     also supersedes its open challenges (reads its flow entries, writes 1 per open one, usually 0–1). Before
 *     migrations/0005 the batch fails at once (D1 rolls it back: nothing read or written) and INSERT_CHALLENGE_0004 runs
 *     at the 0004 limit (an IPv6 /48 as one /24: 30).
 *   verify (ECDSA): 1 SELECT by nonce (1 read); success is 1 batch: the challenge UPDATE (1 row + the flow entry, used_at
 *     is in it = 2) and the session INSERT…SELECT (reads 1, writes 1 row + 5 index entries = 6: token_hash, nonce, address,
 *     expires, live; an ERC-1271 session + sessions_erc1271 = 7). A failure writes 1 (burn).
 *   verify (ERC-1271): + at most 1 read (KNOWN_ERC1271: the partial index sessions_erc1271 holds only ERC-1271 sessions,
 *     so an address's ECDSA sessions, however many, are never read), the claim (1 write;
 *     reads the network's challenges of the last 6 min, ≤ 180, IPv6 ≤ 360, and counts the /64's on those same rows), for a
 *     contract CLAIM_CONTRACT and CLAIM_LANE in one batch (whichever claims writes 1 row + up to 2 partial index entries = 3,
 *     called_via in that row; reads ≤ 5 and ≤ 9, IPv6 ≤ 20 and ≤ 30: the lane and /64 terms read the network's ≤ 3 (6)
 *     checks and their rows), and on failure the burn (1). Before migrations/0005 the claim fails once (rolled back:
 *     nothing read or written) and the request keeps the 0004 statements. A contract claim whose key then refused (or
 *     failed) is released (AUD3-03, RELEASE_CONTRACT or RELEASE_CONTRACT_0004: reads 1, writes 3). A released claim no
 *     longer caps its network's claims, so these are bounded by the challenges a verify needs: per /24 its 30 a minute
 *     (IPv6 /48 60) and, for an address not known, its code share of 10 (each also one eth_getCode, bounded as above);
 *     site-wide by the valve (600 a minute: at most about 78 M rows written a month were every challenge at the valve one).
 *   home (/api/me/home): the session (1 read) and the proven seats' sightings; each chain:index read keeps its answer
 *     (server/ownership.ts KEEP_INDEX: reads ≤ 1, writes 1, 2 for a new address; an answer naming no seat deletes, which
 *     writes none, 1 when it removes a row), and a refused or failed one reads it (≤ 1). At chain:index’s 20 a minute
 *     per location (864 k index reads a month) that is about 0.9 M rows written a month per location when the rows
 *     exist, at most about 1.7 M if every read kept a new address (only an address the index names a seat for is kept,
 *     so each new one takes a seat); the cron's prune scans that small table and writes 1 per row it deletes. A refused
 *     read whose answer counts no seat preflights its network's index lane (AUD4-03, INDEX_LANE_READY: reads ≤ 2
 *     covering index_lanes_net entries and ≤ 60 index_lanes_at entries). A location limiter refusal stops here, with
 *     no admitted-lane writes or release query. Local admission repeats both bounded checks in atomic INDEX_LANE: ≤ 62 more
 *     reads, writes 3 when it reserves the row and its two index entries, none if a racing claim took the capacity.
 *     Between preflight and the local key, a separate atomic probe gate (0008 index_lane_probes) keeps the 30 s net
 *     backoff. Its batch deletes at most two expired scopes (≤ 2 expiry entries, 2 PK row lookups, 8 entries written)
 *     and reserves one probe (≤ 2 covering net entries and 1 PK row; ≤ 4 entries written). Allows/refusals/failures
 *     all keep this marker; no refund. Every gate writes at most 12 entries, never a global refused-attempt counter.
 *     A lane taken adds one index operation (≤ 5 pages, KEEP_INDEX as above) and one sightings read. The cron (every
 *     15 min) deletes its row once older than a minute (3 more). Under that cron schedule, the table holds about
 *     16 minutes of reservations: ≤ INDEX_LANE_BUDGET x 10 x 16 = 9,600 rows at the ceiling. Counts read only recent
 *     indexed entries. Site-wide, ≤ 600 reservations a minute, no release updates: reservation plus eventual prune
 *     writes ≤ 3,600 rows a minute for admitted reservations and their prune. Refused probes write zero admitted
 *     rows. Their separate marker expires at 30 s, reclaimed by two-row opportunistic prune or independent cron
 *     prune of at most 200 scopes (≤ 800 entries written). Distinct-network input/storage has no global hard cap;
 *     imposing a global probe cap would make other locations' availability depend on refusals again.
 *     A racing D1 refusal may have spent a local token; refused limiter calls may count too (external unknown).
 *     The modeled location ceiling remains 20 normal + 20 lane operations a minute; Cloudflare's permissive,
 *     eventually consistent limiter is not an exact accounting guarantee. D1 alone strictly caps lane reservations.
 *   So a successful sign-in writes about 13 rows and reads about 5–91; the cron later deletes the challenge (5) and the
 *   expired session (6; 5 if it was revoked), and each cron run (96 a day) reads the challenges older than 10 min still kept (used ones, 1 day).
 *  Worst case at the valve, sustained for a whole 30-day month (600/min = 25.9 M challenges), on Workers Paid (50 M rows
 *  written included, then $1.00 per million; 25 bn rows read included, then $0.001 per million): challenges left unused
 *  cost 12 rows written each (issue + prune) = 311 M, about $261/month; if every one became a throwaway ECDSA session, 26
 *  each = 673 M, about $623/month. Revoking a session writes 1 row + 1 index entry (it leaves sessions_live). Reads stay within the included 25 bn: ≤ 113 per accepted challenge (2.9 bn; IPv6 ≤ 143, 3.7 bn) plus the
 *  cron's reads of a day of used challenges (≤ 864 k per run, 96 runs a day: 2.5 bn); a refused request reads ≤ 142
 *  (IPv6 ≤ 202; 20,000 refused a minute all month would add about 123 bn, IPv6 175 bn: with the two above, about $103,
 *  IPv6 about $156, past the included reads). Were every challenge at the valve an IPv6 one whose verify claims an
 *  ERC-1271 check, the claims would read 600/min x 360 rows, about 9.3 bn a month (IPv4 4.7 bn).
 *  Sessions kept at that rate (8 days) are about 6.9 M rows, about 2 GB (5 GB included). None of this is reachable
 *  without CHALLENGE_BUDGET_NETWORKS /24s (7 IPv6 /48s) at their full share plus FRESH_NETWORKS other networks asking once
 *  a minute each (at least 214 networks and 220 IPs at AUTH_LIMITER's rate, which also covers the sessions' verifies: 14
 *  /24s at 30 a minute take 26 IPs, 20 one-IP /24s at 20 take 20). */
export const NETWORK_CHALLENGE_BUDGET=30,NETWORK_WINDOW_MS=60_000,CHALLENGE_BUDGET=60,CHALLENGE_BUDGET_WINDOW_MS=6_000,FRESH_NETWORK_RESERVE=20;
export const ADDRESS_SURGE=20;
export const ERC1271_CODE_SHARE=10,ERC1271_NETWORK_SHARE=3,ERC1271_ADDRESS_SHARE=2,CODE_CAP=180;
/** Swarm audit 8c3aea2e N-5: an IPv6 network key (/48) holds many subscribers (/64s), so every per-network share above is
 *  NET6_SCALE times the /24's for a /48, and each /64 in it (the challenge's `sub`) gets at most one /24's share of the
 *  ERC-1271 claims and contract checks (its challenges: AUTH_LIMITER's 20 a minute, below a /24's 30). IPv4: scale 1. */
export const NET6_SCALE=2;
export const netScale=(net:string|null|undefined)=>net?.startsWith('net6:')?NET6_SCALE:1;
/** /24s at full share that keep the valve's regular part (all but the reserve) closed: 14. */
export const CHALLENGE_BUDGET_NETWORKS=Math.ceil((CHALLENGE_BUDGET-FRESH_NETWORK_RESERVE)*NETWORK_WINDOW_MS/CHALLENGE_BUDGET_WINDOW_MS/NETWORK_CHALLENGE_BUDGET);
/** Networks a minute, each asking once, that keep the reserve closed as well: 200. */
export const FRESH_NETWORKS=FRESH_NETWORK_RESERVE*NETWORK_WINDOW_MS/CHALLENGE_BUDGET_WINDOW_MS;
/** The challenge row, written only within both budgets: one statement, so the counts and the insert are one atomic
 *  step. ?9/?11 are the window starts; each inner LIMIT caps its matches at its budget. Network (L1: ?10, the /24's
 *  share times netScale) first, then the valve (L5), of which ?13 (FRESH_NETWORK_RESERVE) is kept for a network with no
 *  challenge since ?9 (A-7; the EXISTS reads at most one entry). ?14 is the IPv6 /64 that asked (N-5; null otherwise),
 *  stored for the ERC-1271 counts. Not a derived table: SQLite pushed the valve term into it and counted the valve twice. */
export const INSERT_CHALLENGE=`INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net,sub)
 SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?14 WHERE (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?8 AND issued_at>?9 LIMIT ?10))<?10
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE issued_at>?11 LIMIT ?12))<?12-?13*EXISTS(SELECT 1 FROM login_challenges WHERE net=?8 AND issued_at>?9)`;
/** Code deployed ahead of migrations/0005 (no `sub` column: SCHEMA_0004) writes the challenge with this, the 0004 text. */
export const INSERT_CHALLENGE_0004=`INSERT INTO login_challenges(nonce,address,origin,flow_hash,message,issued_at,accept_until,net)
 SELECT ?1,?2,?3,?4,?5,?6,?7,?8 WHERE (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?8 AND issued_at>?9 LIMIT ?10))<?10
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE issued_at>?11 LIMIT ?12))<?12-?13*EXISTS(SELECT 1 FROM login_challenges WHERE net=?8 AND issued_at>?9)`;
/** The error a statement naming migrations/0005's columns gets from a database before it; the request then runs the
 *  0004 statements (the rules before 0005). Any other error is rethrown. */
export const SCHEMA_0004=/(?:no such column: |has no column named )(?:sub|called_via)\b/i;
const errorText=(e:unknown)=>String((e as {message?:unknown})?.message);
/** After a refusal: was it the network (L1, ?3 its limit)? Otherwise the valve (L5). For the log line only. */
const REFUSAL_REASON='SELECT count(*)>=?3 net FROM (SELECT 1 FROM login_challenges WHERE net=?1 AND issued_at>?2 LIMIT ?3)';
/** How many challenges this address got in the last minute, from any network (at most ?3). */
const ADDRESS_COUNT='SELECT count(*) n FROM (SELECT 1 FROM login_challenges WHERE address=?1 AND issued_at>?2 LIMIT ?3)';
/** A verify that needs ERC-1271 claims its challenge before any keyed read (checked_at: at most one check per challenge,
 *  also when verifies race), only while the challenge's network made fewer than ?6 claims since ?5 (?4 bounds the index
 *  range: a challenge checked since ?5 was issued at most CHALLENGE_TTL_MS before) and, for IPv6, the challenge's /64
 *  (?8, row.sub) fewer than ?9 (N-5: counted on the same rows, in one pass; with LIMIT ?6 at the /48's limit, exact
 *  whenever the /48 is under it), unless ?7 is 1 (a known smart wallet, which makes no code read). BURN_UNCLAIMED, in
 *  the same batch, burns it when the share refused, so a busy budget never leaves an open challenge behind. */
export const CLAIM_ERC1271=`UPDATE login_challenges SET checked_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL
 AND (?7=1 OR (SELECT count(*)<?6 AND (?8 IS NULL OR total(sub=?8)<?9) FROM (SELECT sub FROM login_challenges WHERE net=?3 AND issued_at>?4 AND checked_at>?5 LIMIT ?6)))`;
/** A claimed challenge whose address has code (or is a known smart wallet) takes one contract check (called_at), only
 *  while its network made fewer than ?5 (the /24's share times netScale), for IPv6 its /64 (?8, row.sub) fewer than ?9,
 *  and its address fewer than ?7 since ?4 (partial indexes on called_at, migrations/0003, so each count reads at most
 *  its share; the /64 term is a separate count on the network's entries, so the first stays a covering read).
 *  called_via='pool' says how it was admitted (N-4). */
export const CLAIM_CONTRACT=`UPDATE login_challenges SET called_at=?1,called_via='pool' WHERE nonce=?2 AND called_at IS NULL
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 LIMIT ?5))<?5
 AND (?8 IS NULL OR (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 AND +sub=?8 LIMIT ?9))<?9)
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE address=?6 AND called_at>?4 LIMIT ?7))<?7`;
/** A-1, N-4: when CLAIM_CONTRACT refused, the challenge's own network may still make lane checks of that address, ?9 a
 *  minute (netScale: one per /24; two per /48, never two from one /64, the challenge's ?7), within its shares ?5 and
 *  (IPv6) ?8, charged to 'chain:erc1271:lane' and never to the shared keys, so garbage from a few other networks cannot
 *  hold a chosen contract (many can: the NETWORK_CHALLENGE_BUDGET comment). Only lane checks use up the lane (called_via
 *  not 'pool'; NULL, from before migrations/0005, counts as a lane), so one earlier shared check of the address from the
 *  network, such as its owner's first attempt, leaves it (N-4). But a subscriber (the /24; for IPv6 the challenge's /64)
 *  that made ?10 (ERC1271_ADDRESS_SHARE) checks of the address this minute, its whole shared allowance, takes no lane of
 *  it: garbage at one contract still spends only 2 of that subscriber's 3 contract checks (F-3), and two garbage checks
 *  from the owner's own /24 still hold it (the residual). In CLAIM_CONTRACT's batch, so it claims only what that left
 *  (called_at IS NULL). +address keeps the lane term on login_challenges_called_net: the network's checks (at most ?5
 *  entries) and their rows, read once for all three counts. */
export const CLAIM_LANE=`UPDATE login_challenges SET called_at=?1,called_via='lane' WHERE nonce=?2 AND called_at IS NULL
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 LIMIT ?5))<?5
 AND (?7 IS NULL OR (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 AND +sub=?7 LIMIT ?8))<?8)
 AND (SELECT total(lane)<?9 AND total(lane AND own)=0 AND total(own)<?10 FROM
  (SELECT called_via IS NOT 'pool' lane,sub IS ?7 own FROM login_challenges WHERE net=?3 AND called_at>?4 AND +address=?6 LIMIT ?5))`;
/** The three claims as they were before migrations/0005 (no sub, no called_via), for code deployed ahead of it: the
 *  request switches to these on SCHEMA_0004 and binds them as before (scale 1: a /48 is one /24's share). */
export const CLAIM_ERC1271_0004=`UPDATE login_challenges SET checked_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL
 AND (?7=1 OR (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND issued_at>?4 AND checked_at>?5 LIMIT ?6))<?6)`;
export const CLAIM_CONTRACT_0004=`UPDATE login_challenges SET called_at=?1 WHERE nonce=?2 AND called_at IS NULL
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 LIMIT ?5))<?5
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE address=?6 AND called_at>?4 LIMIT ?7))<?7`;
export const CLAIM_LANE_0004=`UPDATE login_challenges SET called_at=?1 WHERE nonce=?2 AND called_at IS NULL
 AND (SELECT count(*) FROM (SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 LIMIT ?5))<?5
 AND NOT EXISTS(SELECT 1 FROM login_challenges WHERE net=?3 AND called_at>?4 AND +address=?6)`;
/** N-6: the index lanes' site-wide ceiling, INDEX_LANE_BUDGET per INDEX_LANE_WINDOW_MS (600 a minute, counted in 6 s
 *  slices like the challenge valve, so a refused claim reads at most 60 entries of index_lanes_at). */
export const INDEX_LANE_BUDGET=60,INDEX_LANE_WINDOW_MS=6_000;
/** N-6 / AUD4-03: a lane spends admitted work only. ?5 per minute (one per /24, two per /48 and never two from one
 *  /64 ?2), at most ?7 site-wide since ?6. Keep the 'released:' term for rows left by an older deployment. Each check
 *  reads at most ?5 covering index_lanes_net entries and ?7 index_lanes_at entries. */
const INDEX_LANE_ELIGIBILITY=`(SELECT count(*)<?5 AND total(sub IS ?2 OR sub IS 'released:'||?2)=0 FROM (SELECT sub FROM index_lanes WHERE net=?1 AND at>?4 LIMIT ?5))
 AND (SELECT count(*) FROM (SELECT 1 FROM index_lanes WHERE at>?6 LIMIT ?7))<?7`;
/** A bounded, read-only preflight, to avoid probing a location key for an already-spent network or global window.
 *  Not a reservation: the atomic INSERT must repeat both checks after the location limiter admits the request. */
export const INDEX_LANE_READY=`SELECT 1 ready WHERE ${INDEX_LANE_ELIGIBILITY}`;
export const INDEX_LANE=`INSERT INTO index_lanes(net,sub,at) SELECT ?1,?2,?3 WHERE ${INDEX_LANE_ELIGIBILITY} RETURNING rowid AS id`;
/** AUD4-03: a probe is separate from admitted work. At most one per /24 or /64, two per /48, every 30 s, regardless
 *  of whether the location key allows, refuses or fails. No global probe cap that could starve other locations. */
export const INDEX_PROBE_BACKOFF_MS=30_000,INDEX_PROBE_OPPORTUNISTIC_PRUNE=2,INDEX_PROBE_CRON_PRUNE=200;
/** ?1 now; ?2 hard-clamped batch size. Covering expiry read, then at most ?2 PK lookups/deletions (four B-tree entries
 *  per row: table, text PK, net index, expiry index). INDEXED BY fails closed instead of scanning a missing index. */
export const INDEX_PROBE_PRUNE=`DELETE FROM index_lane_probes WHERE scope_key IN
 (SELECT scope_key FROM index_lane_probes INDEXED BY index_lane_probes_expiry WHERE expires_at<=?1 ORDER BY expires_at,scope_key LIMIT ?2)`;
/** ?1 canonical scope, ?2 net, ?3 sub, ?4 current time, ?5 expiry, ?6 netScale. One atomic UPSERT; reads at most two
 *  covering network entries and one PK row. Expired same-scope rows can be replaced even if prune chose other rows. */
export const INDEX_PROBE=`INSERT INTO index_lane_probes(scope_key,net,sub,probed_at,expires_at) SELECT ?1,?2,?3,?4,?5
 WHERE (SELECT count(*)<?6 AND total(scope_key IS ?1)=0 FROM
  (SELECT scope_key FROM index_lane_probes INDEXED BY index_lane_probes_net WHERE net=?2 AND expires_at>?4 LIMIT ?6))
 ON CONFLICT(scope_key) DO UPDATE SET net=excluded.net,sub=excluded.sub,probed_at=excluded.probed_at,expires_at=excluded.expires_at
 WHERE index_lane_probes.expires_at<=excluded.probed_at RETURNING scope_key`;
const PROBE_SCHEMA_MISSING=/no such (?:table|index):\s*(?:main\.)?index_lane_probes(?:_net|_expiry)?\b/i;
/** Independent cron cleanup: missing migration/index is a fixed status, not a leaked SQL error. Storage failures
 *  propagate to the caller's fixed unavailable log. The caller cannot raise the per-call deletion cap above 200. */
export async function pruneIndexProbes(db:D1Database,now:number,limit=INDEX_PROBE_CRON_PRUNE):Promise<
 {status:'cleaned';deleted:number}|{status:'schema_unavailable'}>{
  const cap=Number.isFinite(limit)?Math.max(0,Math.min(INDEX_PROBE_CRON_PRUNE,Math.trunc(limit))):INDEX_PROBE_CRON_PRUNE;
  try{return {status:'cleaned',deleted:(await db.prepare(INDEX_PROBE_PRUNE).bind(now,cap).run()).meta.changes??0};}
  catch(e){if(PROBE_SCHEMA_MISSING.test(errorText(e)))return {status:'schema_unavailable'};throw e;}
}
/** Prune at most two expired scopes, then atomically reserve this probe. Missing 0008 or D1 failure gives no lane;
 *  keeping a reservation whose result was unreadable is conservative. Local outcomes never refund the marker. */
async function reserveIndexProbe(db:D1Database,net:string,sub:string|null,now:number){
  if(!Number.isFinite(now))return false;
  const scope=net+'|'+(sub??'');
  const [,r]=await db.batch([db.prepare(INDEX_PROBE_PRUNE).bind(now,INDEX_PROBE_OPPORTUNISTIC_PRUNE),
    db.prepare(INDEX_PROBE).bind(scope,net,sub,now,now+INDEX_PROBE_BACKOFF_MS,netScale(net))]);
  return r.results?.[0]?.scope_key===scope||r.meta.changes===1;
}
/** After CLAIM_CONTRACT and CLAIM_LANE refused: was it the address's share (and this network's check of it)? (Else the
 *  network's.) For the log line only. */
const ADDRESS_CONTRACT_CHECKS='SELECT count(*) n FROM (SELECT 1 FROM login_challenges WHERE address=?1 AND called_at>?2 LIMIT ?3)';
/** Is this address a known smart wallet (an ERC-1271 session of it is kept)? sessions_erc1271 (migrations/0003) is a
 *  partial index of ERC-1271 sessions only, so this reads at most one entry and never the address's ECDSA sessions (SR2-1:
 *  through sessions_address it visited every session of the address, once per racing verify). */
export const KNOWN_ERC1271="SELECT 1 k FROM sessions WHERE address=?1 AND verification_method='ERC1271' LIMIT 1";
/** logout-all's revocation: sessions_live (address, expires_at WHERE revoked_at IS NULL) holds only live sessions, so
 *  sessions already revoked are never visited. */
export const REVOKE_ALL_SESSIONS='UPDATE sessions SET revoked_at=?1 WHERE address=?2 AND revoked_at IS NULL AND expires_at>?1';
/** AUD3-03 (Swarm audit 1ef8e8a6 #3): a contract claim (CLAIM_CONTRACT or CLAIM_LANE) whose location key then refused (or
 *  failed) never reached the chain, so it is taken back: the network's, the /64's and the address's counts and the lane
 *  count only checks that were made. This challenge's claim only (its nonce ?1 and its called_at ?2); checked_at stays
 *  (its one check per challenge is spent) and the challenge is burnt as before, so the nonce never opens again. A claim
 *  whose eth_call was sent keeps counting, whatever the answer. Reads 1, writes 3 (the row and its two partial index
 *  entries, login_challenges_called_net and login_challenges_called_address). */
export const RELEASE_CONTRACT='UPDATE login_challenges SET called_at=NULL,called_via=NULL WHERE nonce=?1 AND called_at=?2';
/** The same before migrations/0005 (no called_via). */
export const RELEASE_CONTRACT_0004='UPDATE login_challenges SET called_at=NULL WHERE nonce=?1 AND called_at=?2';
const BURN_UNCLAIMED='UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL AND checked_at IS NULL';
/** The statement lives with the page's own message check (src/world/siwe.ts), so both read one text. Challenges carry
 *  SIWE_STATEMENT and verify accepts only it. (The F-1 release also accepted the earlier wording for the CHALLENGE_TTL_MS
 *  a challenge issued before that deploy could stay open; that window closed on 2026-09-28, so the allowance is gone. A
 *  later statement change must add such an allowance again for one release, or open challenges fail with 401.) */
export {SIWE_STATEMENT};
/** ERC-6492 wrapped signatures (undeployed smart accounts) end with this magic suffix; they are refused. */
export const ERC6492_SUFFIX='6492'.repeat(16);
/** ERC-1271's answer, ABI-encoded: bytes4 0x1626ba7e as exactly one 32-byte word (SEC-2: a prefix match let an address
 *  that echoes its calldata, like the identity precompile 0x…04, sign in with any signature). */
export const ERC1271_MAGIC_WORD='0x1626ba7e'+'0'.repeat(56);
const ERC1271=[{type:'function',name:'isValidSignature',stateMutability:'view',inputs:[{name:'hash',type:'bytes32'},{name:'signature',type:'bytes'}],outputs:[{name:'',type:'bytes4'}]}] as const;
/** 'auth': challenges per client IP; 'verify': verifies per client IP (the same binding, other keys); 'home': /api/me/home per session (key given); 'chain': the budgets of keyed Alchemy
 *  reads a session from any throwaway key can cause (constant keys, CHAIN_KEYS; per Cloudflare location, not global);
 *  'code': the ERC-1271 path's eth_getCode cap (CODE_CAP, CHAIN_KEYS.code, in the API_LIMITER namespace). These fail
 *  CLOSED; 'api' and 'seat' fail open. */
export type Bucket='auth'|'verify'|'api'|'seat'|'home'|'chain'|'code';
/** The CHAIN_LIMITER keys, one budget each (20/min per Cloudflare location): the ERC-1271 eth_call a sign-in with a
 *  non-ECDSA signature needs for an address that has code (erc1271) or already signed in that way (erc1271Known), a lane
 *  check once the address's shared checks are spent (erc1271Lane, CLAIM_LANE), every
 *  NFT index read /api/me/home makes (any throwaway key can sign in, so a session proves nothing about ownership; ownerOf
 *  is read only for candidates IMD's roster or the index named, which a throwaway address has none of), an index read
 *  taken on a network's lane once that is refused (indexLane, INDEX_LANE, N-6), and the public assets route's character
 *  list. `code` is the 'code' bucket's key (API_LIMITER namespace, CODE_CAP). */
export const CHAIN_KEYS={erc1271:'chain:erc1271',erc1271Known:'chain:erc1271:known',erc1271Lane:'chain:erc1271:lane',index:'chain:index',indexLane:'chain:index:lane',assets:'chain:assets',code:'chain:code'} as const;
export type AccountDeps={
  /** D1 (absent in the Vite dev server: every auth and /api/me route answers 503 AUTH_UNAVAILABLE). */
  db?:D1Database;now?:()=>number;
  /** Rate-limit check, keyed by the client IP unless `key` is given. 'auth', 'home' and 'chain' fail CLOSED when the check
   *  throws; 'api' and 'seat' fail open like the read API. Logout is never limited (SEC-1: revoking must always work). */
  allow?:(bucket:Bucket,key?:string)=>boolean|Promise<boolean>;
  chain:ChainAccess;ownership:Ownership;waitUntil?:WaitUntil;
  /** The client's network (worker/app.ts networkKey) the D1 sign-in budgets count by; absent: 'net:unknown'. */
  client?:string;
  /** Its IPv6 /64 (worker/app.ts subnetKey; null for IPv4 and unknown), N-5: written on the challenge row it asks for,
   *  and counted by the home route's index lane (N-6). verify never reads it: the row's own is the one that counts. */
  sub?:string|null;
  /** This isolate's "no code here" answers (verifySignature); absent: none are kept. */
  noCode?:NoCodeCache;
  /** The Cloudflare location (request.cf.colo) for the log lines, and where they go (default console.log). */
  colo?:string;log?:(line:string)=>void;
};
/** What a refusal was about, for its log line (handleAccountApi); kept beside the Response, never sent. */
type Note={reason:string;walletType?:'EOA'|'CONTRACT'};
const NOTES=new WeakMap<Response,Note>();
const noted=(r:Response,note:Note)=>{NOTES.set(r,note);return r;};

/** The request's Origin when it may sign in or write: https://imdember.com, or a loopback http origin when the request
 *  itself was made to a loopback host (local dev), so production can never accept a localhost origin. */
export function allowedOrigin(request:Request):string|null{
  const origin=request.headers.get('origin');
  if(!origin)return null;
  if(PRODUCTION_ORIGINS.includes(origin))return origin;
  try{
    const o=new URL(origin);
    return o.protocol==='http:'&&o.origin===origin&&LOOPBACK.has(o.hostname)&&LOOPBACK.has(new URL(request.url).hostname)?origin:null;
  }catch{return null;}
}
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const random=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function sha256(text:string):Promise<string>{return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))));}
export function readCookie(request:Request,name:string):string|null{
  for(const part of (request.headers.get('cookie')??'').split(';')){const at=part.indexOf('=');if(at>0&&part.slice(0,at).trim()===name)return part.slice(at+1).trim();}
  return null;
}
/** __Host- cookies: Secure, Path=/, no Domain. HttpOnly always. */
const setCookie=(name:string,value:string,maxAgeS:number,sameSite:'Strict'|'Lax')=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${Math.max(0,Math.floor(maxAgeS))}`;
const clearFlow=()=>setCookie(FLOW_COOKIE,'',0,'Strict'),clearSession=()=>setCookie(SESSION_COOKIE,'',0,'Lax');
function reply(status:number,body:unknown,cookies:string[]=[],extra:Record<string,string>={}):Response{
  const headers=new Headers({...API_HEADERS,...extra});for(const c of cookies)headers.append('Set-Cookie',c);
  return new Response(body===null?null:JSON.stringify(body),{status,headers});
}
const fail=(status:number,code:string,cookies:string[]=[],extra:Record<string,string>={})=>reply(status,{error:code},cookies,extra);
/** A binding missing from a production deployment (LimiterMissing) is not a refusal: it propagates, and the route
 *  answers 503 LIMITER_UNAVAILABLE for every bucket (S2: a config slip must not leave sign-in unthrottled). */
async function permit(deps:AccountDeps,bucket:Bucket,key?:string):Promise<boolean>{
  if(!deps.allow)return true;
  try{return (await deps.allow(bucket,key))!==false;}catch(e){if(e instanceof LimiterMissing)throw e;return bucket==='api'||bucket==='seat';}
}
/** The clock (deps.now in tests). challenge and verify read it after the body (A-5: a body sent slowly must not date its
 *  claims into earlier minutes), the contract claim again after eth_getCode, the consume again at the end. */
const clock=(deps:AccountDeps)=>(deps.now??Date.now)();
/** A JSON object body of at most BODY_LIMIT bytes with Content-Type application/json, else null. Reads no further. */
async function readJson(request:Request):Promise<Record<string,unknown>|null>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return null;
  if(Number(request.headers.get('content-length'))>BODY_LIMIT||!request.body)return null;
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>BODY_LIMIT){await reader.cancel().catch(()=>{});return null;}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}
  try{const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));return v&&typeof v==='object'&&!Array.isArray(v)?v:null;}catch{return null;}
}

/** Addresses whose eth_getCode just answered "no code" (lowercase → until, ms), per isolate (createWorker makes one). A
 *  garbage signature for such an address is 401 with no D1 claim and no keyed read (F-3). NO_CODE_TTL_MS keeps it brief:
 *  an address that gains code meanwhile (a 7702 delegation, a counterfactual account deployed) waits at most that long. */
export type NoCodeCache=Map<string,number>;
export const NO_CODE_TTL_MS=60_000,NO_CODE_CACHE_MAX=4096;
export type SignatureGate={
  /** Did this address already sign in by ERC-1271 (a session of it is kept)? Then it had code: no code read is made. */
  known:()=>Promise<boolean>;
  /** The claim (CLAIM_ERC1271): one check per challenge, and the network's code share unless known; before any read. */
  share:(known:boolean)=>Promise<'ok'|'busy'|'used'>;
  /** The per-location 'chain:code' cap, asked before eth_getCode (not for a known address). */
  code:()=>Promise<boolean>;
  /** The contract check, for an address with code: CLAIM_CONTRACT (the network's, its /64's and the address's shares),
   *  else CLAIM_LANE (per network and address a minute: one per /24, two per /48 from two /64s). */
  contract:()=>Promise<'pool'|'lane'|false>;
  /** The per-location chain:erc1271 budget (known: chain:erc1271:known; a lane check: chain:erc1271:lane), asked last,
   *  before eth_call. */
  budget:(known:boolean,lane:boolean)=>Promise<boolean>;
  /** AUD3-03: the contract claim taken back when its budget did not admit the check (no eth_call was sent). */
  release?:()=>Promise<void>;noCode?:NoCodeCache;now:number};
/** How a signature was proven (F-2), kept on the session for audit and debugging only: 'ECDSA' is the address's own key
 *  (wallet_type 'EOA'; an EIP-7702 delegated EOA signs this way too, and no chain read is made), 'ERC1271' the contract at
 *  the address answered the magic word (wallet_type 'CONTRACT'). Ownership is always ownerOf, never this. */
export type Verification='ECDSA'|'ERC1271';
export const WALLET_TYPES:Readonly<Record<Verification,'EOA'|'CONTRACT'>>={ECDSA:'EOA',ERC1271:'CONTRACT'};
/** ECDSA first (EOAs, EIP-7702 delegated EOAs; no RPC), then ERC-1271 isValidSignature on mainnet at latest, only for
 *  an address with code (precompiles and plain EOAs have none; a 7702 delegation's 0xef0100… counts) or one that already
 *  signed in that way (it had code; if it has none now, eth_call answers 0x and that is 401), and only when the
 *  answer is exactly the magic word. 'unavailable': ERC-1271 was needed but there is no key or the node could not be read
 *  (a transport or HTTP failure, a malformed reply, or a JSON-RPC error other than a revert: W-3). A revert or any
 *  answer but the magic word is 'invalid'.
 *  Fail closed (F-2): no key, a node error, a refused or broken budget, or a missing binding is never a sign-in, and the
 *  address alone is never trusted: only 'ECDSA' or 'ERC1271' make a session.
 *  F-3 (swarm review 4bd31cfb): in order, a cached "no code" is 401 at once (absent gate: 'busy'); the claim (one check
 *  per challenge); for an address not known, 'chain:code' then eth_getCode, and no code is 401 (cached); the contract
 *  shares, else the network's lane (A-1); the location budget; eth_call. Numbers: the NETWORK_CHALLENGE_BUDGET comment. */
export async function verifySignature(message:string,signature:`0x${string}`,address:`0x${string}`,chain:ChainAccess,
  gate?:SignatureGate):Promise<Verification|'invalid'|'unavailable'|'busy'|'used'>{
  try{if(isAddressEqual(await recoverMessageAddress({message,signature}),address))return 'ECDSA';}catch{/* not an ECDSA signature */}
  if(!gate)return 'busy';
  const key=address.toLowerCase(),cache=gate.noCode;
  if((cache?.get(key)??-Infinity)>gate.now)return 'invalid';
  const known=await gate.known(),go=await gate.share(known);if(go!=='ok')return go;
  if(!known){
    if(!await gate.code())return 'busy';                                             // LimiterMissing propagates (503)
    try{
      const code=await rpc(chain,'eth_getCode',[address,'latest']);
      if(code.error!==undefined||typeof code.result!=='string'||!/^0x(?:[\da-fA-F]{2})*$/.test(code.result))return 'unavailable';
      if(code.result.length<=2){
        if(cache){cache.delete(key);if(cache.size>=NO_CODE_CACHE_MAX)cache.delete(cache.keys().next().value!);cache.set(key,gate.now+NO_CODE_TTL_MS);}
        return 'invalid';}
    }catch(e){if(e instanceof OwnershipUnavailable)return 'unavailable';return 'invalid';}
  }
  const c=await gate.contract();if(!c)return 'busy';
  // AUD3-03: a claim whose budget did not admit the check (refused, or LimiterMissing, which then propagates: 503) is
  // taken back before the answer; one that was admitted counts whatever the eth_call answers.
  let admitted=false;try{admitted=await gate.budget(known,c==='lane');}finally{if(!admitted)await gate.release?.();}
  if(!admitted)return 'busy';
  try{
    const data=encodeFunctionData({abi:ERC1271,functionName:'isValidSignature',args:[hashMessage(message),signature]});
    const {result,error}=await rpc(chain,'eth_call',[{to:address,data},'latest']);
    if(error!==undefined)return reverted(error)?'invalid':'unavailable';             // W-3: a node's failure is not a bad signature
    if(typeof result!=='string'||!/^0x(?:[\da-fA-F]{2})*$/.test(result))return 'unavailable';
    return result.toLowerCase()===ERC1271_MAGIC_WORD?'ERC1271':'invalid';
  }catch(e){if(e instanceof OwnershipUnavailable)return 'unavailable';return 'invalid';}
}
/** W-3 (Swarm retest e48d0a96): the JSON-RPC errors that are the contract's own answer, 401 "invalid": an execution revert
 *  (EIP-1474 code 3, or geth's -32000 "execution reverted" for a revert without data) or an EVM halt the contract's code
 *  causes (-32000 "out of gas", "invalid opcode", "invalid jump destination", "stack underflow/overflow/limit reached",
 *  "write protection", "return data out of bounds"). Any other error object (rate limit, internal error, missing state,
 *  timeout, an unlisted -32000 message) is taken as the node failing, so the check could not be made: 503. */
const EVM_HALT=/^(?:execution reverted|out of gas|invalid opcode|invalid jump destination|stack (?:underflow|overflow|limit reached)|write protection|return data out of bounds)\b/i;
export const reverted=(e:unknown)=>{const {code,message}=(e&&typeof e==='object'?e:{}) as {code?:unknown;message?:unknown};
  return code===3||(code===-32000&&typeof message==='string'&&EVM_HALT.test(message));};
export type Session={address:string;expiresAt:number;tokenHash:string;walletType:string|null;verificationMethod:string|null};
/** The live session of this request, or why there is none ('none': no cookie). */
export async function readSession(request:Request,db:D1Database,now:number):Promise<Session|'none'|'AUTH_REQUIRED'|'SESSION_EXPIRED'>{
  const token=readCookie(request,SESSION_COOKIE);
  if(!token)return 'none';
  if(!/^[\w-]{43}$/.test(token))return 'AUTH_REQUIRED';
  const tokenHash=await sha256(token);
  const row=await db.prepare('SELECT address,expires_at,revoked_at,wallet_type,verification_method FROM sessions WHERE token_hash=?1').bind(tokenHash)
    .first<{address:string;expires_at:number;revoked_at:number|null;wallet_type:string|null;verification_method:string|null}>();
  if(!row||row.revoked_at!==null)return 'AUTH_REQUIRED';
  if(row.expires_at<=now)return 'SESSION_EXPIRED';
  return {address:row.address,expiresAt:row.expires_at,tokenHash,walletType:row.wallet_type,verificationMethod:row.verification_method};
}

/** `now` is when the route began; challenge and verify take their own after the body. */
type Ctx={request:Request;deps:AccountDeps;db:D1Database;now:number;origin:string};
async function challenge({request,deps,db,origin}:Ctx):Promise<Response>{
  const body=await readJson(request),now=clock(deps),raw=body?.address;
  if(typeof raw!=='string'||!/^0x[\da-fA-F]{40}$/.test(raw))return fail(400,'BAD_REQUEST');
  // The flow value is always new (SEC-4: a value the client brings is never adopted); the one it brings, if any, only
  // names the open challenges this one supersedes, so a late signature for an earlier account is 409.
  const address=getAddress(raw),kept=readCookie(request,FLOW_COOKIE),flow=hex(random(16));
  const flowHash=await sha256(flow),nonce=hex(random(16)),acceptUntil=now+CHALLENGE_TTL_MS;
  const message=createSiweMessage({domain:new URL(origin).host,address,statement:SIWE_STATEMENT,uri:origin+'/',version:'1',chainId:1,
    nonce,issuedAt:new Date(now),expirationTime:new Date(acceptUntil)});
  // The earlier challenges of this flow are superseded only when this one was written (a refused request changes nothing).
  const net=deps.client??'net:unknown',lower=address.toLowerCase();let limit=NETWORK_CHALLENGE_BUDGET*netScale(net);
  const supersede=kept&&/^[\da-f]{32}$/.test(kept)?[db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL AND EXISTS(SELECT 1 FROM login_challenges WHERE nonce=?3)')
    .bind(now,await sha256(kept),nonce)]:[];
  const write=(sql:string,...sub:unknown[])=>db.batch([
    db.prepare(sql).bind(nonce,lower,origin,flowHash,message,now,acceptUntil,net,now-NETWORK_WINDOW_MS,limit,now-CHALLENGE_BUDGET_WINDOW_MS,CHALLENGE_BUDGET,FRESH_NETWORK_RESERVE,...sub),
    db.prepare(ADDRESS_COUNT).bind(lower,now-NETWORK_WINDOW_MS,ADDRESS_SURGE+1),...supersede]);
  // N-5: the row records the /64 that asked (sub). Before migrations/0005 that column is missing, the batch rolled back
  // (nothing read or written), and the 0004 INSERT writes the challenge instead, at the 0004 limit (scale 1: a /48 is
  // one /24's 30, like the ERC-1271 claims then), which the refusal's reason below counts by too.
  const [insert,surge]=await write(INSERT_CHALLENGE,deps.sub??null).catch(e=>{if(!SCHEMA_0004.test(errorText(e)))throw e;limit=NETWORK_CHALLENGE_BUDGET;return write(INSERT_CHALLENGE_0004);});
  if(insert.meta.changes!==1){
    const why=await db.prepare(REFUSAL_REASON).bind(net,now-NETWORK_WINDOW_MS,limit).first<{net:number}>();
    return noted(fail(429,'SIGN_IN_BUSY',[],{'Retry-After':'60'}),{reason:why?.net?'network':'global'});
  }
  // One address asked for from many networks (no challenge is refused for its address, A-6, so this is only logged):
  // every challenge from the ADDRESS_SURGE-th on writes a line (the count reads at most ADDRESS_SURGE+1 entries).
  if(Number((surge.results[0] as {n?:number}|undefined)?.n)>=ADDRESS_SURGE)audit(deps,{evt:'auth_surge',route:'/api/auth/challenge',reason:'address_surge',addr:lower.slice(0,6)});
  return reply(200,{nonce,message,acceptUntil},[setCookie(FLOW_COOKIE,flow,CHALLENGE_TTL_MS/1000,'Strict')]);
}
async function verify({request,deps,db,origin}:Ctx):Promise<Response>{
  const body=await readJson(request),now=clock(deps),nonce=body?.nonce,signature=body?.signature;
  if(typeof nonce!=='string'||!/^[\da-f]{32}$/.test(nonce)||typeof signature!=='string'||!/^0x(?:[\da-fA-F]{2})+$/.test(signature))return fail(400,'BAD_REQUEST');
  const row=await db.prepare('SELECT * FROM login_challenges WHERE nonce=?1').bind(nonce).first<{nonce:string;address:string;origin:string;flow_hash:string;message:string;
    issued_at:number;accept_until:number;used_at:number|null;invalidated_at:number|null;net:string|null;sub?:string|null}>();
  if(!row)return fail(409,'CHALLENGE_USED');
  const flow=readCookie(request,FLOW_COOKIE);
  if(!flow||await sha256(flow)!==row.flow_hash||row.origin!==origin)return fail(403,'FLOW_MISMATCH');
  if(row.used_at!==null||row.invalidated_at!==null)return fail(409,'CHALLENGE_USED');
  if(now>=row.accept_until)return fail(410,'CHALLENGE_EXPIRED');
  // From here only the browser holding this challenge's flow cookie gets an answer, and every failed check burns the
  // challenge (one write): a bad signature cannot be retried against it. The ERC-1271 path claims it first (CLAIM_ERC1271),
  // so one challenge buys at most one keyed check even when verifies race or a burn fails, and a refused share or
  // chain:erc1271 budget (429 CHAIN_BUSY; at most the one eth_getCode read) burns it too: the client always starts a fresh challenge, so nobody could use an open one.
  const why:Note={reason:''};
  const burn=async(status:number,code:string,extra:Record<string,string>={})=>{
    await db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,nonce).run();
    return noted(fail(status,code,[],extra),why);};
  if(signature.toLowerCase().endsWith(ERC6492_SUFFIX))return burn(400,'UNSUPPORTED_SIGNATURE');
  // The stored text is re-read as SIWE and checked against the row (domain, URI, chain, nonce, address, and its Issued
  // At / Expiration Time against issued_at / accept_until, so the message never claims a longer life than is accepted).
  const address=getAddress(row.address),parsed=parseSiweMessage(row.message);
  if(!validateSiweMessage({message:parsed,address,domain:new URL(row.origin).host,nonce:row.nonce,time:new Date(now)})||
    parsed.uri!==row.origin+'/'||parsed.chainId!==1||parsed.version!=='1'||parsed.statement!==SIWE_STATEMENT||
    parsed.issuedAt?.getTime()!==row.issued_at||parsed.expirationTime?.getTime()!==row.accept_until)return burn(401,'SIGNATURE_INVALID');
  // Every ERC-1271 count is the challenge's: its network and, for IPv6, the /64 that asked for it (row.sub, N-5), never
  // the verifying request's address (only the flow cookie ties a verify to its challenge). Before migrations/0005 the
  // first claim fails with SCHEMA_0004 and this request keeps the 0004 statements (scale 1): the rules before 0005.
  const sub=row.sub??null,scale=netScale(row.net);let before0005=false,claimedAt=0;
  const gate:SignatureGate={now,noCode:deps.noCode,
    known:async()=>!!await db.prepare(KNOWN_ERC1271).bind(row.address).first(),
    share:async known=>{
      const claim=(sql:string,...shares:unknown[])=>db.batch([db.prepare(sql).bind(now,nonce,row.net,now-NETWORK_WINDOW_MS-CHALLENGE_TTL_MS,now-NETWORK_WINDOW_MS,...shares),
        db.prepare(BURN_UNCLAIMED).bind(now,nonce)]);
      const [claimed,burnt]=await claim(CLAIM_ERC1271,ERC1271_CODE_SHARE*scale,known?1:0,sub,ERC1271_CODE_SHARE)
        .catch(e=>{if(!SCHEMA_0004.test(errorText(e)))throw e;before0005=true;return claim(CLAIM_ERC1271_0004,ERC1271_CODE_SHARE,known?1:0);});
      why.reason='code_share';return claimed.meta.changes===1?'ok':burnt.meta.changes===1?'busy':'used';},
    code:async()=>{why.reason='code_cap';return permit(deps,'code',CHAIN_KEYS.code);},
    contract:async()=>{
      const t=clock(deps);why.walletType='CONTRACT';
      const [pool,lane]=await db.batch(before0005?[
        db.prepare(CLAIM_CONTRACT_0004).bind(t,nonce,row.net,t-NETWORK_WINDOW_MS,ERC1271_NETWORK_SHARE,row.address,ERC1271_ADDRESS_SHARE),
        db.prepare(CLAIM_LANE_0004).bind(t,nonce,row.net,t-NETWORK_WINDOW_MS,ERC1271_NETWORK_SHARE,row.address)]:[
        db.prepare(CLAIM_CONTRACT).bind(t,nonce,row.net,t-NETWORK_WINDOW_MS,ERC1271_NETWORK_SHARE*scale,row.address,ERC1271_ADDRESS_SHARE,sub,ERC1271_NETWORK_SHARE),
        db.prepare(CLAIM_LANE).bind(t,nonce,row.net,t-NETWORK_WINDOW_MS,ERC1271_NETWORK_SHARE*scale,row.address,sub,ERC1271_NETWORK_SHARE,scale,ERC1271_ADDRESS_SHARE)]);
      if(pool.meta.changes===1){claimedAt=t;return 'pool';}if(lane.meta.changes===1){claimedAt=t;return 'lane';}
      const held=await db.prepare(ADDRESS_CONTRACT_CHECKS).bind(row.address,t-NETWORK_WINDOW_MS,ERC1271_ADDRESS_SHARE).first<{n:number}>();
      why.reason=(held?.n??0)>=ERC1271_ADDRESS_SHARE?'address':'network_contract';return false;},
    budget:(known,lane)=>{why.reason=lane?'budget_lane':known?'budget_known':'budget';
      return permit(deps,'chain',lane?CHAIN_KEYS.erc1271Lane:known?CHAIN_KEYS.erc1271Known:CHAIN_KEYS.erc1271);},
    // AUD3-03: this nonce's claim, if still the one made at claimedAt; a release that fails leaves it counted (as before
    // AUD3-03: the answer stays 429 and the challenge burnt) and writes one line.
    release:async()=>{try{await db.prepare(before0005?RELEASE_CONTRACT_0004:RELEASE_CONTRACT).bind(nonce,claimedAt).run();}
      catch{audit(deps,{evt:'erc1271_claim_kept',route:'/api/auth/verify',reason:'release_failed'});}}};
  const check=await verifySignature(row.message,signature as `0x${string}`,address,deps.chain,gate);
  if(check==='used')return fail(409,'CHALLENGE_USED');
  if(check==='busy')return burn(429,'CHAIN_BUSY',{'Retry-After':'60'});
  if(check==='unavailable'){why.reason='rpc';return burn(503,'VERIFY_UNAVAILABLE');}
  if(check!=='ECDSA'&&check!=='ERC1271')return burn(401,'SIGNATURE_INVALID');   // 'invalid', or anything that is not a proof
  // Atomic consume: the session row exists only if this transaction took the challenge; concurrent verifies of one
  // signature all pass the checks above, but only one UPDATE matches (sessions.nonce UNIQUE is the second lock). The
  // clock is read again: an ERC-1271 check can take seconds, and a challenge that expired meanwhile is not consumed.
  const at=clock(deps),token=base64url(random(32)),hash=await sha256(token),expiresAt=row.issued_at+SESSION_TTL_MS;
  let taken=false;
  try{
    const [, insert]=await db.batch([
      db.prepare('UPDATE login_challenges SET used_at=?1,session_hash=?2 WHERE nonce=?3 AND used_at IS NULL AND invalidated_at IS NULL AND accept_until>?1').bind(at,hash,nonce),
      db.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) SELECT session_hash,address,1,?1,?2,nonce,?5,?6 FROM login_challenges WHERE nonce=?3 AND session_hash=?4')
        .bind(at,expiresAt,nonce,hash,WALLET_TYPES[check],check)]);
    taken=insert.meta.changes===1;
  }catch(e){
    // Only a lost race is 409. Any other error (a schema without migrations/0003's columns, D1 down) is rethrown: the
    // batch rolled back, and the route answers a logged 503 AUTH_UNAVAILABLE, never a silent "press sign in again".
    if(!/UNIQUE constraint failed/i.test(String((e as {message?:unknown})?.message)))throw e;
  }
  if(!taken)return fail(409,'CHALLENGE_USED');
  return reply(200,{address,expiresAt},[setCookie(SESSION_COOKIE,token,(expiresAt-at)/1000,'Lax'),clearFlow()]);
}
/** The caller's own session. A cookie whose session ran out says so (expired: true; Swarm audit 8c3aea2e N-7: the page
 *  tells an expiry from a revocation by this, not by its own clock alone); a revoked, unknown, malformed or missing one
 *  gets no reason. Nothing new is revealed: /api/me/home and logout-all answer SESSION_EXPIRED for that same cookie.
 *  AUD3-06 (Swarm audit 1ef8e8a6 #6): a dead cookie is refused, not cleared. A browser applies Set-Cookie by name in
 *  arrival order, so a clear sent with a dead cookie and answered after another tab signed in deleted the new cookie;
 *  the server refuses the dead token on every request anyway (checked against D1 each time). Only sign-in and the
 *  explicit logouts write the session cookie. */
async function session({request,db,now}:Omit<Ctx,'origin'>):Promise<Response>{
  const s=await readSession(request,db,now);
  if(s==='none')return reply(200,{signedIn:false});
  if(typeof s==='string')return reply(200,s==='SESSION_EXPIRED'?{signedIn:false,expired:true}:{signedIn:false});
  return reply(200,{signedIn:true,address:getAddress(s.address),expiresAt:s.expiresAt});
}
/** Revokes the session server-side and every open challenge of this browser flow; idempotent. */
async function logout({request,db,deps}:Ctx):Promise<Response>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return fail(400,'BAD_REQUEST');
  const token=readCookie(request,SESSION_COOKIE),flow=readCookie(request,FLOW_COOKIE),writes=[];
  const body=await readJson(request);
  if(!body)return fail(400,'BAD_REQUEST');
  const now=clock(deps);
  if(body.expectedNonce!==undefined&&body.expectedAddress!==undefined)return fail(400,'BAD_REQUEST');
  let flowHash=flow?await sha256(flow):null,clearFlowCookie=true;
  // AUD4-06 abandoned-flow cleanup is conditional on its challenge, not whichever cookie a newer tab installed.
  // The nonce is a consistency assertion only: revocation needs the matching live session token. With no session token,
  // the original flow cookie can only cancel its own pending challenge. A conflict changes no cookie or flow.
  if(body.expectedNonce!==undefined){
    const nonce=body.expectedNonce;
    if(typeof nonce!=='string'||! /^[\da-f]{32}$/.test(nonce))return fail(400,'BAD_REQUEST');
    const matches=token?await db.prepare(`SELECT 1 matched,
      (SELECT flow_hash FROM login_challenges WHERE nonce=?2) flow_hash FROM sessions
      WHERE token_hash=?1 AND nonce=?2 AND revoked_at IS NULL AND expires_at>?3`)
      .bind(await sha256(token),nonce,now).first<{matched:number;flow_hash:string|null}>():null;
    if(!matches){
      // Before verification there may be no session cookie yet. The original flow cookie can only cancel its own
      // still-pending nonce, never a session or a replacement flow. A supplied session token never falls back here.
      // An empty/malformed cookie is still a supplied token: it must not acquire pending-only authority.
      if(token!==null||!flowHash)return fail(409,'ACCOUNT_CONTEXT_CHANGED');
      const pending=await db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE nonce=?2 AND flow_hash=?3 AND used_at IS NULL AND invalidated_at IS NULL AND accept_until>?1')
        .bind(now,nonce,flowHash).run();
      if(pending.meta.changes!==1)return fail(409,'ACCOUNT_CONTEXT_CHANGED');
      return reply(204,null,[clearFlow()]);
    }
    // Another tab may already have a newer challenge but not yet a newer session. Clean only the abandoned
    // challenge's original flow, and never clear a different current flow cookie. A pruned old challenge is safe
    // to skip: the token still names the one session being revoked, but no old flow is inferred from a new cookie.
    clearFlowCookie=typeof matches.flow_hash==='string'&&matches.flow_hash===flowHash;
    flowHash=matches.flow_hash;
  }else if(body.expectedAddress!==undefined){
    // R5: an automatic switch without a retained flow nonce asserts the displayed account. The live request cookie
    // remains the authority; an address alone cannot revoke it. Only that session's original challenge flow is ended.
    const address=body.expectedAddress;
    if(typeof address!=='string'||!/^0x[\da-fA-F]{40}$/.test(address))return fail(400,'BAD_REQUEST');
    const s=await readSession(request,db,now);
    if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
    if(address.toLowerCase()!==s.address.toLowerCase())return fail(409,'ACCOUNT_CONTEXT_CHANGED');
    const own=await db.prepare(`SELECT c.flow_hash FROM sessions s
      LEFT JOIN login_challenges c ON c.nonce=s.nonce WHERE s.token_hash=?1`).bind(s.tokenHash).first<{flow_hash:string|null}>();
    clearFlowCookie=typeof own?.flow_hash==='string'&&own.flow_hash===flowHash;
    flowHash=own?.flow_hash??null;
  }
  if(token)writes.push(db.prepare('UPDATE sessions SET revoked_at=?1 WHERE token_hash=?2 AND revoked_at IS NULL').bind(now,await sha256(token)));
  if(flowHash)writes.push(db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,flowHash));
  if(writes.length)await db.batch(writes);
  return reply(204,null,[clearSession(),...clearFlowCookie?[clearFlow()]:[]]);
}
/** Sign out everywhere (F-4): this request's live session names the address; every live session of it is revoked, and
 *  every open challenge for it (its index range: only the last CHALLENGE_TTL_MS can still be open) and of this flow is
 *  invalidated. Only a valid session can ask, so nobody can end another address's sessions; a dead or forged cookie is
 *  401 and changes nothing, its cookie included (AUD3-06: the browser may hold a cookie another tab has just set by the
 *  time this answer lands). Never limited, like logout: it only ends the caller's own address. D1: reads the address's
 *  live sessions (sessions_live) and at most the challenges of the last 5 min; writes 1 + 1 index entry per session ended. */
async function logoutAll({request,db,deps}:Ctx):Promise<Response>{
  if(!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??''))return fail(400,'BAD_REQUEST');
  // AUD4-01: the body asserts the account the confirmation named, never authority to revoke it. The request's
  // live cookie must name that same address. A stale page holding A with B's cookie changes neither account nor flow.
  // Read time again after the bounded body, so a slow request cannot act with an already-expired session.
  const body=await readJson(request),now=clock(deps),s=await readSession(request,db,now),flow=readCookie(request,FLOW_COOKIE);
  if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
  const expected=body?.expectedAddress;
  if(typeof expected!=='string'||!/^0x[\da-fA-F]{40}$/.test(expected))return fail(400,'BAD_REQUEST');
  if(expected.toLowerCase()!==s.address.toLowerCase())return fail(409,'ACCOUNT_CONTEXT_CHANGED');
  const [ended]=await db.batch([
    db.prepare(REVOKE_ALL_SESSIONS).bind(now,s.address),
    db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE issued_at>?3 AND address=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,s.address,now-CHALLENGE_TTL_MS),
    ...flow?[db.prepare('UPDATE login_challenges SET invalidated_at=?1 WHERE flow_hash=?2 AND used_at IS NULL AND invalidated_at IS NULL').bind(now,await sha256(flow))]:[]]);
  return reply(200,{revoked:ended.meta.changes},[clearSession(),clearFlow()]);
}

export const ACCOUNT_PREFIXES:readonly string[]=['/api/auth/','/api/me/','/api/wallet/'];
const ASSETS_ROUTE=/^\/api\/wallet\/(0x[\da-fA-F]{40})\/assets$/;
const POSTS:Record<string,(ctx:Ctx)=>Promise<Response>>={'/api/auth/challenge':challenge,'/api/auth/verify':verify,'/api/auth/logout':logout,'/api/auth/logout-all':logoutAll};
/** One JSON line (F-5 monitoring): the event, the route, why, the Cloudflare location and the client's network key
 *  (derived from its IP: IPv4 /24, IPv6 /48; never the full IP), plus what the caller adds (a surge line's 6-character
 *  address prefix); nothing else about the request. */
function audit(deps:AccountDeps,fields:Record<string,unknown>){
  try{(deps.log??console.log)(JSON.stringify({...fields,colo:deps.colo??null,net:deps.client??'net:unknown'}));}catch{/* logging never fails a request */}
}
/** Returns null when the path is not an account route (the caller continues with the read API or static assets). Every
 *  429 and 503 it answers is logged once (audit): reason is the refusing layer or bucket, walletType when known. */
export async function handleAccountApi(request:Request,deps:AccountDeps):Promise<Response|null>{
  const {pathname}=new URL(request.url);
  if(!ACCOUNT_PREFIXES.some(p=>pathname.startsWith(p)))return null;
  const r=await accountRoute(request,deps,pathname);
  if(r.status===429||r.status===503){
    const note=NOTES.get(r),error=await r.clone().json().then(b=>(b as {error?:string}).error,()=>undefined);
    audit(deps,{evt:'auth_refused',route:ASSETS_ROUTE.test(pathname)?'/api/wallet/:address/assets':pathname,status:r.status,error,
      reason:note?.reason||error,...note?.walletType?{walletType:note.walletType}:{}});
  }
  return r;
}
async function accountRoute(request:Request,deps:AccountDeps,pathname:string):Promise<Response>{
  const now=clock(deps),db=deps.db;
  try{
    const post=POSTS[pathname];
    if(post){
      if(request.method!=='POST')return fail(405,'METHOD_NOT_ALLOWED',[],{Allow:'POST'});
      if(!db)return fail(503,'AUTH_UNAVAILABLE');
      const origin=allowedOrigin(request);
      if(!origin)return fail(403,'ORIGIN_NOT_ALLOWED');
      // Logout (one or all) is never limited: it only ever revokes, and a limiter others can drain must not keep a session alive.
      // Challenge and verify spend separate keys (L4), so a challenge flood from one IP never starves its verifies.
      const bucket=post===verify?'verify':'auth';
      if(post!==logout&&post!==logoutAll&&!await permit(deps,bucket))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:bucket});
      return await post({request,deps,db,now,origin});
    }
    const assets=ASSETS_ROUTE.exec(pathname);
    if(pathname!=='/api/auth/session'&&pathname!=='/api/me/home'&&!assets)return fail(404,'UNKNOWN_ROUTE');
    if(request.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED',[],{Allow:'GET'});
    if(assets){
      if(!await permit(deps,'api')||!await permit(deps,'seat'))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'api'});
      const budget=()=>permit(deps,'chain',CHAIN_KEYS.assets);
      try{return reply(200,await deps.ownership.assets(assets[1],{chain:deps.chain,db,now,waitUntil:deps.waitUntil,budget,clock:()=>clock(deps)}),[],{'Cache-Control':'public, max-age=300'});}
      catch(e){if(e instanceof LimiterMissing)throw e;return fail(503,'OWNERSHIP_UNAVAILABLE');}
    }
    if(!db)return fail(503,'AUTH_UNAVAILABLE');
    if(pathname==='/api/auth/session'){
      if(!await permit(deps,'api'))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'api'});
      return await session({request,deps,db,now});
    }
    // /api/me/home: the session first, so anonymous or cross-site reads (which carry no Lax cookie) spend only the
    // fail-open read bucket and never the sign-in bucket; a session's re-checks are limited per session, not per IP. A
    // dead cookie is 401 with no Set-Cookie (AUD3-06: refused, not cleared, as the session route).
    if(!await permit(deps,'api'))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'api'});
    const s=await readSession(request,db,now);
    if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
    if(!await permit(deps,'home','session:'+s.tokenHash.slice(0,32)))return noted(fail(429,'RATE_LIMITED',[],{'Retry-After':'60'}),{reason:'home'});
    const fresh=new URL(request.url).searchParams.get('fresh')==='1',budget=()=>permit(deps,'chain',CHAIN_KEYS.index);
    // AUD4-03: preflight the bounded network/global counts, atomically reserve a separate 30 s network probe, ask the
    // local limiter, then atomically reserve admitted
    // work in D1. A local refusal (or failure) writes no admitted lane row, so it cannot fill another location's ceiling.
    // The preflight is advisory: races must still pass INDEX_LANE with a fresh clock after the limiter. A race lost
    // then may spend a local token but sends no index read. Probe backoff counts allows/refusals/failures alike,
    // independently of admitted capacity and with no refund; Cloudflare's actual counting is still unknown.
    // D1 errors (including before migration 0005) give no lane. Missing limiter remains 503. Once reserved, no refund
    // for a sent/failed index read (AUD3-01); absent both RETURNING and changes also fails closed, keeping any row.
    const lane=async()=>{const net=deps.client??'net:unknown',sub=deps.sub??null;let t=clock(deps);
      if(!Number.isFinite(t)||t<now)return false;
      // Every awaited boundary may change temporal authority. Invalid/rolled-back samples never reach D1 or the
      // local key; a probe already reserved at a finite time retains its original conservative 30 s backoff.
      const sample=()=>{const next=clock(deps);if(!Number.isFinite(next)||next<t)return false;t=next;return true;};
      try{if(!await db.prepare(INDEX_LANE_READY).bind(net,sub,t,t-NETWORK_WINDOW_MS,netScale(net),t-INDEX_LANE_WINDOW_MS,INDEX_LANE_BUDGET).first())return false;}
      catch{return false;}
      if(!sample())return false;
      try{if(!await reserveIndexProbe(db,net,sub,t))return false;}
      catch{return false;}
      if(!sample())return false;
      if(!await permit(deps,'chain',CHAIN_KEYS.indexLane))return false;
      if(!sample())return false;
      try{const r=await db.prepare(INDEX_LANE).bind(net,sub,t,t-NETWORK_WINDOW_MS,netScale(net),t-INDEX_LANE_WINDOW_MS,INDEX_LANE_BUDGET).run();
        return typeof r.results?.[0]?.id==='number'||r.meta.changes===1;}
      catch{return false;}};
    try{return reply(200,await deps.ownership.home(s.address,{chain:deps.chain,db,now,waitUntil:deps.waitUntil,budget,lane,clock:()=>clock(deps)},fresh));}
    catch(e){if(e instanceof LimiterMissing)throw e;return fail(503,'OWNERSHIP_UNAVAILABLE');}
  }catch(e){return e instanceof LimiterMissing?noted(fail(503,'LIMITER_UNAVAILABLE'),{reason:'missing:'+e.binding}):noted(fail(503,'AUTH_UNAVAILABLE'),{reason:'error'});}
}
