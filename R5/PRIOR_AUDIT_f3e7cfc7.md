# Audit report

> IMD Ember World (https://imdember.com) - re-audit after Audit 1ef8e8a6/Report dcf922ca, plus first review of member layer M1 (World only)
>
> Please read this first: this is an unofficial community project. This repository contains NO Solidity or smart contract. TypeScript Cloudflare Worker and TypeScript/React SIWE (EIP-4361) client. The team claims the World site asks only eth_accounts, eth_requestAccounts and personal_sign of server-built SIWE text: no transaction, token/NFT approval, Permit/Permit2 or typed-data signature. Verify this, including changed client code. Rate by attacker preconditions/player impact: impersonation, session revival or cross-address logout, false house rights, unintended prompts, disclosure/poisoning, and availability. Verify the claimed absence of fund-loss paths. Identify inapplicable Solidity checks.
>
> Repository: https://github.com/tungweb3/imd-ember-world-review at 6e307dea76e763936fc4ac86e54c9f5d558f58c4, as shown by READ. Its parent must be 8cad017fad58bac89d88fa72d530d3c56160009b (Audit 1ef8e8a6, Report dcf922ca). Code is in source/. Traditional Chinese root docs are team claims; code is the reference. README maps R3-R1 and AUD3-01..09 to changes and residuals. These fixes have NOT been externally re-reviewed. The member layer M1 is new and has NEVER been reviewed by Swarm.
>
> Deployment facts (team claims; Audit has no network):
> - Live Worker imd-world: acdbb2bd-8add-4b15-bfa6-a31266c83520, deployed from ddb10e28a867998323164e7585635efedfcf7788. source/ is from main c491ff3c9edf9d0eb39a9233ccfff101a7c8133c: only one status document and one added evidence page differ; neither enters a build.
> - Rebuild from sanitized source/ alone: expected Worker SHA-256 cf720c698417726ce75cd3b4740314489ed816ba98a763e74d8118b8be136518, 303,128 bytes. See DEPLOYMENT_MATCH.md/manifests.
> - D1 migrations 0001-0006, including new 0006_members.sql; sessions schema unchanged. Bindings as in source/wrangler.jsonc. Stated edge rule: over 20 /api/ requests from an IP in 10 s are blocked.
> - Recorded GET date: 2026-10-03T13:01:16Z-13:01:40Z. Report must use curl/browser User-Agent: Python-urllib got 403 last time (deployment match partial). No other block bypass; Audit stays code-only.
>
> Entry points (all paths below are inside source/):
> - worker/app.ts handleMemberApi dispatch :139 precedes server/auth.ts handleAccountApi :639, then server/world-api.ts and static assets.
> - server/auth.ts: POST /api/auth/challenge :482, verify :511, logout :603, logout-all :617; GET /api/auth/session :596; GET /api/me/home :683 (session address only; server/ownership.ts :280).
> - Public GET /api/wallet/:address/assets and /api/world/*; shared cache. Client: src/world/auth.ts signIn :280, siwe.ts checkSignInMessage, homeEntry.ts enterGate, WalletPanel.tsx, member.ts and MemberPanel.tsx.
>
> Changes since 8cad017: check each against your own expected result and look for regressions.
> - R3-R1: src/world/auth.ts accountEvents :396 guards connect/eth_accounts and wallet changes during personal_sign. Can a late answer restore, prompt or verify an older account? Only synthetic wallet ordering was tested; a wallet returning a stale account without accountsChanged is a stated limit.
> - AUD3-01: server/ownership.ts :292 preserves the first proof when lane rebuilding fails, returning limited data. Any remaining 503 or seat granted without ownerOf?
> - AUD3-02 (team: partly fixed): server/auth.ts INDEX_LANE_RELEASE :279 releases refused claims (30 s retry; at most 20 releases per 6 s globally). Stated residual: about 80 claims in one 6 s slice at one location still fill the global ceiling. Probe locally.
> - AUD3-03: server/auth.ts RELEASE_CONTRACT :297 releases a refused ERC-1271 claim. Can that buy an extra eth_call or revive a burnt challenge? AUD3-02/03 rely on refused Cloudflare limiter calls costing nothing; this is unconfirmed.
> - AUD3-04: src/world/auth.ts loggedOut :426 invalidates reads begun before this page's confirmed logout.
> - AUD3-05 (team: partly fixed): src/world/auth.ts :256 drops a mismatched house; the prior session remains displayed without owner mode until a session read succeeds. Probe this residual.
> - AUD3-06: server/auth.ts session reads, home 401 and refused logout-all send no Set-Cookie (:596). src/world/auth.ts :290 waits at most 5 s for this page's logouts before a wallet prompt. Cross-tab late explicit logout can still clear a newer cookie.
> - AUD3-07: src/world/auth.ts logoutAllRequest :434 distinguishes expired/stale and re-reads a refused logout-all, including after a newer flow.
> - AUD3-08: worker/app.ts rateLimitKey :82 parses full IPv4/IPv6, maps IPv4-mapped addresses to IPv4 and other input to ip:unknown.
> - Follow-up: src/world/auth.ts revokeAbandoned :411 logs out a late session on that verify response's headers. Can waiting/abandonment/re-read paths be held open, skipped or end in the wrong account?
>
> New, NEVER Swarm-reviewed: server/member.ts handleMemberApi :81; migration 0006. POST /api/me/bootstrap creates the session address's member; GET/PUT /api/me/profile reads/sets its name; public GET /api/world/names/:address returns name/null. Writes: DB availability, Origin, member limiter, body/session, actor context. AUTH_LIMITER member:+rateLimitKey: 20/min/IP/location, closed on error; missing binding 503. Can an unsigned/different address write, any route set/clear cookies, or M1 weaken sign-in/spend another budget? GET profile's hourly last_login_at write uses a fail-open read limiter; early PUT refusals are outside the recorded 5/member/min cap. Probe race/idempotency/version/cooldown/name claims and budget effects. node:sqlite does not verify production D1 batches. Address-to-name disclosure is intentional; what else is exposed?
>
> Re-check prior findings, stored SIWE-field equality, ERC-6492 refusal, ERC-1271 code/magic word/one check per challenge, nonce/session issuance, hashed tokens, __Host-/7-day cookies, live-session logout-all, closed write limiters, ownerOf/session address and exact client SIWE gate. That gate cannot stop injected script/phishing.
>
> Tests: follow TESTS/README.md (isolated source/ git repo, npm ci, two documented stubs). Real handler, node:sqlite, synthetic in-memory keys. New snapshot result: no stubs 161 run/157 pass/4 fail; with stubs 341/337/4 (3 withheld UI/geometry, 1 history-dependent deploy-evidence check). Focused R3-R1/AUD3/ADV: 90/90; M1 server/client 33/33; N tests: 43/43; Enter gate: group 5 3/3. Dependency check: npm audit: 0 production, 0 all vulnerabilities. Distinguish package omissions from defects. Public client imports withheld World/layout/interior code: this is NOT a complete reproducible UI or full application build.
>
> Out of scope: Genesis Mint, Coin E1/0007/check-in/economy routes, withheld 3D/art/music/placement/interior/WorldApp (hashes only). M1 zero economy/life fields are placeholders, not Coin. Fixtures/static scans do not establish complete UI or real-wallet behavior.
>
> For each finding give severity, file:line, preconditions, player impact, reproduction/argument, prior finding link, and what you could not check. AUD3-09 is a review-limit record, not a fix. This is a code review record, not a certification: do not call the site safe, secure, audited or certified.

| | |
|---|---|
| Repository | https://github.com/tungweb3/imd-ember-world-review.git |
| Commit | `6e307dea76e763936fc4ac86e54c9f5d558f58c4` |
| Job | `f3e7cfc7-0b43-473a-9c0f-6931cf278c56` |
| Judged | 2026-10-03 15:19 UTC |
| Findings | 8 low |

Four agents audited the code as it is at `6e307de`, each in one area (math, permissions, economics, control flow),
and a judge reproduced, merged and ranked what they found, then read the code once more itself. Nothing in the repository was changed or deployed.

## Findings

### 1. Low: Logout-all can revoke the cookie wallet while claiming to revoke the displayed wallet

`source/server/auth.ts:622`

```
    db.prepare(REVOKE_ALL_SESSIONS).bind(now,s.address),
```

The client confirmation names its held session address, but logoutAllRequest sends an empty body and the server revokes the address from the current cookie. Another tab can replace that cookie with wallet B while this page still displays A. In particular, the acknowledged AUD3-05 residual retains A after a mismatched home response if the subsequent session read fails. Logout-all then revokes B, reports success, and leaves A's other-device sessions live. This undermines the user's attempt to end a forgotten/stolen session. No outsider can choose an arbitrary address without a corresponding live cookie. Bind the requested address to the displayed session, reject mismatches before revoking anything, and reconcile the client. Returning an address after revocation alone does not prevent unwanted B revocations. Prior: F-4, AUD3-05/06/07; merges a5d0769d and the related display-only residual eadf088e. Limits: shared cookie harness, not real BroadcastChannel/browser timing. Prior Audit link: https://github.com/Identity-md/research/blob/main/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82/files/AUDIT.md (AUD3-05/06/07).

**Reproduction**

Real AuthClient/Worker/SQLite: tab 1 signs in A, who owns fixture seat 361 and reaches owner mode; another browser signs in A too. Have another tab of tab 1's profile sign in B, replacing the shared cookie. Return 429 for tab 1's GET /api/auth/session, advance 20 seconds, and call refreshHome(true,true). The house mismatch disables owner mode but state.session still names A and sessionKnown=false. logoutView(true,A,English) explicitly says it will log out A on every device. Call runLogout("all",client,()=>{}). Actual: 200, client ended="signed-out" and session=null; database has two live A sessions and one revoked B session; A's other browser GET /api/me/home still returns 200. Expected: revoke A only with matching authenticated context, or refuse and show that the cookie account changed.

### 2. Low: M1 extends permissive ERC-1271 sign-in to persistent public name writes

`source/server/member.ts:174`

```
  const now=(deps.now??Date.now)(),s=await readSession(request,db,now);
  if(typeof s==='string')return fail(401,s==='none'?'AUTH_REQUIRED':s);
  const m=await readMember(db,identityKey(s.address));
  if(!m||m.public_member_id!==actor)return fail(409,'ACCOUNT_CONTEXT_CHANGED');
```

M1 accepts every live session for profile writes, while readSession omits verification_method and wallet_type. For a contract whose isValidSignature accepts arbitrary signatures, anyone can create its member, publish a name against its address, and start the seven-day cooldown that blocks its controller from renaming it. This is conditional on the target contract having that behavior; it does not bypass a correctly restrictive ERC-1271 wallet or EOA verification. It expands the previously accepted F-2 view-only exposure into public state, contrary to the stated future-write boundary in source/docs/security/AUDIT_REMEDIATION_STATUS.md:251-262. Add a suitable authority check for contract-session writes, or restrict this feature until a contract-wallet write policy is agreed; blindly requiring an EOA signature would exclude ordinary smart wallets. Prior: F-2; specialist 4a197de6. Limits: no live contract or seat-holding target was identified, and no real wallet or production D1 was tested. House display additionally requires the target to hold a listed seat. No fund-loss path follows. Prior policy link: https://github.com/tungweb3/imd-ember-world-review/blob/6e307dea76e763936fc4ac86e54c9f5d558f58c4/source/docs/security/AUDIT_REMEDIATION_STATUS.md#smart-wallet-erc-1271-policy .

**Reproduction**

Real Worker and migrations through wallet-harness.setup(): set chain.state.contracts[C]=()=>"0x1626ba7e" for C=0xcccccccccccccccccccccccccccccccccccccccc (the fake RPC supplies deployed code). POST challenge for C, then verify its nonce with signature="0x"+"ab".repeat(65): 200; the session row is CONTRACT/ERC1271. POST bootstrap, then PUT profile with displayName="TrustedSeller", its expectedActorPublicId, expectedProfileVersion=0, requestId="contract-0001": 200/version 1. Anonymous GET /api/world/names/C publishes {"name":"TrustedSeller"}. A second browser signs in to C with another signature, reads version 1, and PUTs "RealName": 409 NAME_CHANGE_COOLDOWN until T+604800000. Expected under the documented F-2 boundary: this permissive sign-in alone cannot authorize a persistent public write. Actual: it does and locks subsequent renames for a week.

### 3. Low: AUD3-02 residual: refused discovery claims still consume the global lane ceiling

`source/server/auth.ts:279`

```
export const INDEX_LANE_RELEASE=`UPDATE index_lanes SET at=?5,sub='released:'||coalesce(sub,'') WHERE net=?2 AND sub IS ?3 AND at=?4 AND (?1 IS NULL OR rowid=?1)
 AND (SELECT count(*) FROM (SELECT 1 FROM index_lanes WHERE at>?6 AND at<=?5 AND +sub GLOB 'released:*' LIMIT ?7))<?7`;
```

The mitigation releases only 20 refused index-lane claims per six-second interval. Further claims rejected by an exhausted location remain counted against the 60-claim global ceiling even though no NFT-index request occurred. Four valid throwaway sessions making 20 home reads each from 80 distinct IPv4 /24 networks can fill it; 80 separate sessions are unnecessary. A buyer elsewhere whose location still has lane capacity but whose normal index budget is exhausted cannot discover a seat absent from roster/kept candidates. This temporarily removes owner-mode/Enter/Move availability, without granting any unproved seat or blocking EOA sign-in. Sustaining it needs further network slots and session read budget. Separate capacity for admitted reads from bounded refused-attempt accounting. Prior: acknowledged partial fix AUD3-02, Audit 1ef8e8a6 #2 (https://github.com/Identity-md/research/blob/main/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82/files/AUDIT.md); merges 93d64cb8 and cebd8119. Limits: production D1 RETURNING, Cloudflare location placement/consistency, WAF, and whether refused limiter calls cost budget were not tested.

**Reproduction**

In the real Worker/SQLite harness, prepare four attacker EOA sessions and one victim EOA session. Fixture chain/index says the victim owns seat 361; the swarm has its online agent but no owner listing, and there is no stored candidate. Advance 60 seconds and freeze time T=1790596860000. Set AUTH_LIMITER=windowLimiter(20,clock.now). At location A, CHAIN_LIMITER refuses chain:index and chain:index:lane. Make 80 sequential GET /api/me/home calls across distinct 10.0.i.5 /24s, round-robin over the four sessions. All 80 return limited; SQL shows 80 lane rows, 20 released and 60 retained at T. Switch to location B's limiter, which refuses chain:index but admits chain:index:lane. The victim at fresh /24 172.16.5.0/24 receives seats:[], eligible:0, recheck:"limited"; B's lane key is never called and there is no index fetch. Advance exactly 6000 ms and repeat: B's lane is called and seat 361 counts. Expected: A's refused reads do not consume otherwise usable B discovery capacity.

### 4. Low: Refused profile writes retain expired request rows indefinitely

`source/server/member.ts:181`

```
  const record=(outcome:string)=>db.prepare(`INSERT OR IGNORE INTO profile_requests(member_id,request_id,payload_hash,outcome,result_version,created_at,expires_at)
    VALUES(?1,?2,?3,?4,NULL,?5,?6)`).bind(member,requestId,hash,outcome,now,now+REQUEST_KEPT_MS).run().catch(()=>{});
```

M1 records database-reaching refusals, but deletes expired profile_requests only in the successful name-change batch at lines 222-223. recordPresence never prunes these member tables. A signed-in member that submits only unavailable names, stale versions, or cooldown-blocked changes can keep adding persistent rows; a locked member cannot reach the success cleanup at all. This defeats the one-day retention bound and increases shared database storage and index cost without a time bound. Five recorded attempts per minute allow up to 7,200 rows/day/member before other limits; no production cost or exhaustion threshold was measured. Add bounded scheduled expiry cleanup, or cleanup on refusal paths too; apply an explicit retention policy to profile_history as well. Prior: new M1; merges specialist IDs fd71e25e, 46a0e38d, 3b975f7d and abc289d4. Limits: real handler and migrations over node:sqlite, not production D1 or any external housekeeping.

**Reproduction**

Using tests/wallet-harness.mjs setup(), sign in a generated EOA and POST /api/me/bootstrap. At T=1790596800000, T+86400001, and T+172800002, PUT /api/me/profile with displayName="Admin", the returned expectedActorPublicId, expectedProfileVersion=0, and distinct requestIds retention-0000 through retention-0002. Each returns 409 NAME_UNAVAILABLE. Observed total/expired profile_requests counts: 1/0, 2/1, 3/2. Call recordPresence(w.gateway,w.db,w.clock.now()); all three rows remain. Expected: expired attempt records are reclaimed according to the one-day retention policy; actual: another refused write and the cron reclaim none. No signature/session bypass is required.

### 5. Low: Concurrent refusals exceed the five-attempt member write budget

`source/server/member.ts:190`

```
  const recent=await db.prepare('SELECT count(*) n FROM (SELECT 1 FROM profile_requests WHERE member_id=?1 AND created_at>?2 LIMIT ?3)')
    .bind(member,now-60_000,PROFILE_WRITES_PER_MINUTE).first<{n:number}>();
  if((recent?.n??0)>=PROFILE_WRITES_PER_MINUTE)return fail(429,'NAME_RATE_LIMITED',{retryAfterSeconds:60},{'Retry-After':'60'});
```

The per-member attempt count and insertion of the refusal record are separate database operations. Concurrent authenticated requests can all read a count below five and each write a distinct refusal row. Version and name-uniqueness guards in the success batch do not enforce this budget. This increases database work beyond the stated 5/member/min cap, though the independent 20/IP/min member limiter and edge limits still constrain each IP. Reserve/check the member attempt budget atomically for both successful and refused outcomes. Prior: new M1, specialist 57f523f6. Limits: node:sqlite with controlled asynchronous scheduling; real Cloudflare D1 scheduling was not tested. No change to identity, house rights, or funds was observed.

**Reproduction**

Bootstrap one signed-in EOA at version 0, with no recent profile_requests. Configure the harness AUTH_LIMITER=windowLimiter(20,w.clock.now). Send six concurrent same-origin PUT /api/me/profile requests, each displayName="Admin", the member public ID, expectedProfileVersion=0, and requestIds race-0000 through race-0005. Wrap D1 statement.first() to hold completion of the recent-count SELECT until all six queries have returned n=0, then release all completions; SQL and results are unchanged. Actual: all six return 409 NAME_UNAVAILABLE and six distinct rows are inserted. Expected: only five attempts recorded, with the sixth refused as 429 NAME_RATE_LIMITED. Six requests fit the stated edge threshold.

### 6. Low: An unreadable verify response leaves an undisclosed live session and permits another signature prompt

`source/src/world/auth.ts:351`

```
      const s=await v.json() as {address:string;expiresAt:number},session={address:String(s.address).toLowerCase(),expiresAt:s.expiresAt};
```

After successful verify headers set the session cookie, a response-body failure falls through to the generic catch at line 357. It releases the unsettled hold without invalidating sessionKnown from the earlier signed-out read. The page shows sign-in failure with session=null even though its cookie authenticates; the next click skips session reconciliation and asks for another personal_sign. An ordinary interrupted HTTP response suffices. Treat uncertain verify completion as unknown session state and reconcile before another wallet prompt, retaining abandoned-flow cleanup. Prior: CORR-02 and ADV-3/RC-1 recovery; specialist 29080397. This is distinct from the fixed R3-R1 account-event ordering. Limits: synthetic response stream, real handler/SQLite and synthetic signer; no actual browser transport or wallet tested. No fund-loss path observed. Prior Report link: https://github.com/Identity-md/research/blob/main/jobs/dcf922ca-68de-4cc5-bfbc-8b226008b0bf/files/artifacts/report.md .

**Reproduction**

With a fresh Browser jar and AuthClient wired to the real Worker, call signIn(). Let GET session return signedIn:false, then let challenge, personal_sign, and verify succeed. Apply Browser.keep(realVerifyResponse) to retain its Set-Cookie, but return HTTP 200 with those headers and a ReadableStream that errors with TypeError("Network body truncated"). Actual: signIn ends with session=null, sessionKnown=true, notice="failed"; direct GET session reports signedIn:true. Call signIn again with normal responses. Observed request sequence: session, challenge, verify, challenge, verify, home; two personal_sign calls and two unrevoked sessions. Expected: reconcile and reuse the live cookie session without a second signature.

### 7. Low: A failed profile response body leaves the naming form stuck in saving state

`source/src/world/member.ts:89`

```
      const next=await r.json() as MemberView;if(!this.mine(gen,next))return false;
```

MemberClient.save retries failures of fetch itself, but consumes a successful response body outside that recovery block. If the Worker commits the name and the response stream then fails, save rejects without clearing saving or rereading the profile. Every later save immediately returns false, and the form keeps its controls disabled. This requires only a transport failure for an ordinary signed-in player. Include body consumption in uncertain-completion recovery using the same requestId, and always release saving for the current generation on terminal failure. Prior: new M1, specialist 15198e46. Limits: real Worker/SQLite with a synthetic failed stream; production transport and withheld full UI integration were not tested.

**Reproduction**

Bootstrap a signed-in EOA at profile version 0 and start MemberClient on that session. Call save("EmberCat"). Let the real PUT /api/me/profile return 200 after committing version 1, then substitute a Response with the same status/headers whose ReadableStream errors with TypeError("Network body truncated"). Actual: save rejects, client remains saving=true/error=null/version=0, while a direct GET profile returns EmberCat/version=1. A subsequent save("EmberMoon") returns false without another PUT (total PUT count=1). Expected: retry/reconcile the committed operation or show a recoverable error and enable the form. State reset/page reload currently restores use.

### 8. Low: The rename button stays disabled after its cooldown expires

`source/src/world/MemberPanel.tsx:92`

```
  const cooling=v.nextNameChangeAt!==null;
```

MemberBlock treats any non-null nextNameChangeAt as an active cooldown. The server clears the field only in a fresh response, while MemberClient follows address changes and does not schedule a deadline refresh. Thus an open page keeps disabling rename after the seven-day deadline, including when the panel is rendered again. This affects an ordinary user who loads the panel shortly before expiry; it does not require keeping a session open for a week. Refresh at the deadline or use a server-adjusted clock and scheduled rerender, retaining server enforcement. Prior: new M1, specialist a3ae2d41. Limits: real handler/client and component fixture render, not the withheld WorldApp lifecycle; reloading recovers.

**Reproduction**

At T=1790596800000, sign in, bootstrap, and PUT "EmberCat" at version 0. At T+604799000 (one second before the seven-day deadline), obtain a fresh session and load MemberClient. It holds nextNameChangeAt=1791201600000. Advance two seconds. A direct GET /api/me/profile now returns nextNameChangeAt=null, but the existing client still holds the timestamp. Render the actual MemberBlock using tests/fixtures/member-panel.mjs with that state and now=1791201601000. Actual markup includes <button class="secondary" disabled="">Change name</button>. Expected: rename is available once the server cooldown has elapsed.

---

Judge's submission `1abb3575e441b60f4e5bc27de84ef1fa88856dfcda5b1c47709283d108f0a5cc`, accepted on the IdentityMD network. Acceptance means the report met the job's checks;
it is not a guarantee that the code has no other defects.
