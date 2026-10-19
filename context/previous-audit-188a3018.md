# Audit report

> Review public commit 450507815fec44e1c496999e07da1b006861c5dd.
>
> Audit the shared GOLD remediation of job c47bc2a0-44e0-413f-a5f1-75b6922c575a. World source 7afdd097847d2cd6b5d503734566afc1b78a2c8d; copied Mint/Python inputs and portable adaptations are sealed in manifests. Review all 12 prior items plus the second-inspection hardening, across TypeScript/SQL/Python/Mint service, not Solidity alone. Read SCOPE.md, REQUIREMENTS.md, LOCAL_TESTS.md, world-source/docs/world-gold-audit5-remediation.md and the previous report. Verify independently; local passing tests are not proof of security or deployment readiness.
>
> Prioritize: (1) trial ends during network latency/clock skew must remove only trial access; holders still authenticate, nonholders/external profile receive no trial grant; malformed claims/revocation remain closed. (2) pre0014/pre0015 historical schemas and partially missing required tables return a valid plan or coded refusal, never TypeError; purchases/refunds/holds remain separate from staking corrections. (3) quote-before-pause, challenge/debit races and trusted runtime provider readiness: no new debit/job while paused/unbound, no browser/env capability forgery, but paid reconciliation/results/refunds/withdrawals continue. (4) service debit, paid state, challenge and job commit atomically, including injected job-write failure. Cron GOLD work must continue independently of RPC/config/limiter failure.
>
> (5) Delivery attempt/lease fencing, idempotency key=orderId, saved results without new charge, unknown timeout pending, structured provider-confirmed nondelivery proof stored intact, unusable UTF8/undefined/cyclic results terminal with one original refund, late workers unable to replace refunded/delivered state. (6) one overflowing/invalid old credit cannot roll back or permanently starve other wallets: per-order commit, explicit int64 capacity guard, diagnostics/cooldown, bounded repair and original-price/partial-credit once-only entitlement. The 2^53-1 per-product/order technical limit is not a total issuance cap, and valid old paid entitlements are not cancelled. (7) Mint retries compare the whole persisted wallet/amount/auth/chain/contract/instance/deadline. Strict outcome proofs and SQL mirror bind original scope, block, wallet and cost. No empty/timeout object or elapsed wall time releases a still-executable authorization. Consume/release race and replay must leave one debit and immutable before/after receipt.
>
> (8) Bounded held-order recovery must use stored bindings and the preserved chain reader, independent of memory maps. Wrong/lost/new EVM namespace remains blocked; original-chain used/revoked/expired facts permit only their valid transition. Inspect actual private EVM map-loss and same-chain backup restore tests. Injected shared ledger must refuse reset before any provider/runId/map/ledger changes. (9) transient predicate rows are cleaned atomically and excluded from recovery snapshots, while permanent admin/Mint and delivery evidence remains immutable. (10) live World session/CAS, EOA writes, origin/expected-wallet and three confirmed owners remain enforced; no arbitrary balance setter, cross-consumer spend of held funds, transaction replay or wallet-switch authority.
>
> GOLD cannot transfer, sell or redeem for EMBEO and is not an AMM/trading pair. UTC staking remains 100000 EMBEO per unit/day=>1 GOLD after a full UTC day with withdrawn units forfeiting only that day. Free/paid Mint share2222 simultaneously; one eligible free Mint with neither fee, no three-day window. Paid Mint still needs EMBEO plus shared GOLD. Treasury and original Solidity remain unchanged; game rewards/production collection rights are deferred.
>
> Explicit trust/release boundaries: treasury is also an existing administrator; versioned pricing can be economically generous but cannot rewrite old orders. Structured settlement/nondelivery evidence is an internal validation/audit contract, not cryptographic proof by itself. Trusted deployment-pinned finalized readers and authenticated real provider adapters must supply production facts; HTTP clients cannot. The bundled reader and synthetic provider/session/price tests are private fixtures. Actual AIMarket/fortune/VPS delivery, public-chain runtime/finality, persistent production namespace, real wallets, production CPU/D1 capacity and rollout/rollback/postflight are not proved. Production reviewedEconomyConfig returns null and no real delivery consumer is bound, so new service admission remains closed. No deployment is authorized.
>
> Report concrete exploits/failures with affected paths/lines, assumptions, severity, positive/negative controls and regressions. Distinguish reproduced implementation defects from explicit missing production release gates; do not count fixture success or absence of findings as a launch approval. Please verify prior-finding closure and look for new cross-boundary regressions. Return the report on the job page.

| | |
|---|---|
| Repository | https://github.com/tungweb3/imd-ember-world-review.git |
| Commit | `450507815fec44e1c496999e07da1b006861c5dd` |
| Job | `188a3018-0379-413a-bccc-79f278452e8f` |
| Judged | 2026-10-18 10:23 UTC |
| Findings | 1 medium · 7 low · 2 info |

Four agents audited the code as it is at `4505078`, each in one area (math, permissions, economics, control flow),
and a judge reproduced, merged and ranked what they found, then read the code once more itself. Nothing in the repository was changed or deployed.

## Findings

### 1. Medium: One int64-capacity wallet aborts the whole UTC staking settlement page forever and starves every other staker (capacity guard covers world_gold_entries only)

`world-source/server/economy-ledger.ts:162`

```
      statements.push(bind(db,'INSERT INTO economy_gold_journal(id,wallet,delta,kind,reference,created_ms) VALUES(?,?,?,?,?,?)',`reward:${reference}`,who,String(reward),'utc-reward',reference,nowMs));
```

Remediation L5 added the BEFORE INSERT trigger world_gold_credit_capacity on world_gold_entries (migrations/0015 line 13) so a topup/refund credit that would push economy_gold_accounts.balance past 2^63-1 fails per order with GOLD_BALANCE_CAPACITY, a world_gold_reconcile_errors row and a cooldown. The same book is also credited by the staking journal: settleEconomy pushes every completed wallet's utc-reward into economy_gold_journal at this line, and trigger economy_gold_apply (migrations/0010 lines 109-112) runs UPDATE balance=balance+NEW.delta with no capacity check. For a wallet whose book already sits at 2^63-1 the sum is promoted to REAL and CHECK(typeof(balance)='integer') on economy_gold_accounts aborts. settleEconomy commits one page (up to 32 wallets' journals, the page row, the day-progress CAS and the day-completion marker) in a single db.batch, so the abort rolls back every other wallet's reward, economy_gold_days is never written, and every later run re-selects the identical page and fails identically (lines 166-171 swallow only a version change). No reconcile_errors row, cooldown or per-wallet isolation exists on this path; the minute cron only logs gold_maintenance unavailable. The state is reachable with lawful, non-rewritten entitlements: goldAdminCommand accepts gold up to WORLD_GOLD_MAX_PRODUCT (2^53-1) per product version, and the 0015 capacity trigger deliberately lets a wallet accumulate up to exactly 2^63-1 (1024 orders of 2^53-1 plus one of 1023). The documented admin pricing power (treasury is an admin; pricing may be generous) is the only precondition; the player then stakes one 100000-EMBEO unit and from the next settled day on no wallet earns staking GOLD. This violates REQUIREMENTS 'one overflowing/invalid credit cannot permanently starve other wallets' and 'purchases remain separate from staking corrections' at the shared-book boundary 0015 left unguarded. Trust assumption stated: requires an administrator to publish a 2^53-1 GOLD product and a player to buy it 1024 times; no non-admin path reaches capacity. Fix: mirror the capacity guard for positive economy_gold_journal inserts (BEFORE INSERT WHEN NEW.delta>0 AND balance>9223372036854775807-NEW.delta RAISE GOLD_BALANCE_CAPACITY), and in settleEconomy record that wallet as owed/carried (as world_gold_reconcile_errors does) while committing the rest of the page, or settle rewards per wallet so one failing journal cannot abort the day; consider capping the admissible per-wallet book far below int64 at quote time.

**Reproduction**

Scratch node:test file using tests/d1-sqlite.mjs and tests/world-gold-audit5-fixture.mjs (all migrations incl. 0015, config chainId 1, deploymentBlock '100'). Admin publishes topup products 'maxp' gold='9007199254740991' embeo='1' and 'tail' gold='1023' embeo='1' (both accepted). Wallet X: 1024 x goldQuote('maxp') + 1 x goldQuote('tail'), each paid via ingestEconomyEvents payment events; reconcileWorldGold ten times -> failures [] and worldGoldSnapshot(X).book === '9223372036854775807'. Then ingest stake events at block 1125: X positionId '1' shares '1' and Y positionId '2' shares '1' at T=Date.UTC(2026,9,20), then an empty batch with throughTimestamp T+2*DAY. settleEconomy(db,config,{nowMs:T+2*DAY}). Expected: Y credited 1 GOLD per full day and day rows created (X recorded as owed/skipped). Actual: throws "CHECK constraint failed: typeof(balance)='integer' AND balance>=0"; SELECT COUNT(*) FROM economy_gold_journal WHERE kind='utc-reward' = 0; economy_gold_days = 0; economyWalletSnapshot(Y).gold = '0'; settleEconomy again at T+30*DAY throws identically and world_gold_reconcile_errors stays empty. Positive control in the same file: identical stakes without the topups -> X gold '2', Y gold '2', 2 day rows.

### 2. Low: Legacy catalogue GOLD orders bypass the service pause, the trusted delivery-readiness gate and durable job creation

`world-source/server/economy-ledger.ts:209`

```
  if(!linked)return false;
```

sharedServiceAdmission returns false for any GOLD-currency order without a world_gold_links row of kind 'service', so createEconomyGoldChallenge and payEconomyOrderGold skip the world_gold_controls 'service' predicate, skip the serviceReady (trusted runtime provider) requirement and insert no world_gold_jobs row for orders created through the pre-existing catalogue route (createEconomyOrder via POST /api/economy/orders with currency 'GOLD'). With any reviewed EconomyConfig whose catalogue holds a GOLD-priced entry, a player can keep being debited for GOLD services while an administrator has paused 'service' and while no delivery consumer is bound; the debit lands in economy_fulfillments with no delivery, no terminal failure path and no refund entitlement (refundGold needs a world_gold_jobs row in state 'failed'). REQUIREMENTS.md: 'Pause only new admissions by feature' and 'Service debit creates one durable job'. Assumption: today reviewedEconomyConfig returns null and the fixture catalogue is empty, so this is not reachable in the deployed Worker; it becomes reachable the moment a reviewed config with a priced GOLD catalogue entry is released, which is the stated release path. Fix: when world_gold_links exists, treat every GOLD-currency order as a service admission (apply the control predicate and the serviceReady gate), or refuse GOLD catalogue orders while the shared-GOLD schema is present and route them through goldQuote so they carry a link and a job.

**Reproduction**

Scratch node:test (d1-sqlite adapter, all migrations): config=defineEconomyConfig({chainId:1,...,catalogue:[{id:'legacy-research',titleZh:'a',titleEn:'a',gold:'3'}]}). Wallet W tops up 10 GOLD via goldQuote('pack') + ingestEconomyEvents payment event + reconcileWorldGold (book '10'). Admin: goldAdminCommand control service enabled:false version:0. Negative control: goldQuote(research, serviceReady:false) rejects SERVICE_DELIVERY_UNAVAILABLE. Then createEconomyOrder({wallet:W,serviceId:'legacy-research',currency:'GOLD'}), createEconomyGoldChallenge(...,{serviceReady:false}), payEconomyOrderGold with a valid EOA signature and serviceReady:false. Expected: FEATURE_PAUSED or SERVICE_DELIVERY_UNAVAILABLE, book stays '10'. Actual: order status 'paid', book '7', SELECT COUNT(*) FROM world_gold_jobs = 0 while world_gold_controls shows service enabled=0 version=1.

### 3. Low: Worker deployed ahead of migration 0015 silently disables all GOLD topup crediting and refunds: maintainGold guards for world_gold_jobs (0014) while reconcileWorldGold requires world_gold_reconcile_er

`world-source/worker/app.ts:158`

```
    if(!env.DB||!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_gold_jobs'").first())return;
```

The cron guard treats the presence of world_gold_jobs (created by 0014) as proof the shared-GOLD schema is complete, but reconcileWorldGold's first statement (server/world-gold.ts line 63) unconditionally LEFT JOINs world_gold_reconcile_errors and lines 65-73 write it; both exist only after 0015, and finishGoldJob writes delivery_evidence_json (also 0015). On a database that has applied 0014 but not 0015 (the deploy-code-before-migrate window D1 migrations create, and the 'pre-0015' profile the brief asks about) every minute tick throws 'no such table: world_gold_reconcile_errors', is swallowed by Promise.allSettled and logged as gold_maintenance unavailable; the player route POST /api/gold/orders/:id/reconcile (server/world-gold-api.ts) throws the same raw SQLite error and answers 503 GOLD_UNAVAILABLE. Meanwhile goldQuote and payEconomyOrderGold still accept new topups and service debits on that schema, so EMBEO paid to the treasury is not credited as GOLD and provider-failed jobs are not refunded until 0015 is applied, with no coded refusal distinguishing the schema gap from an outage. The codebase treats a deploy that ran ahead of a migration as a supported state (tests/d1-sqlite.mjs openD1(files); economy-recovery and sharedServiceAdmission probe sqlite_master first), and prior finding 2 asked for 'a valid plan or coded refusal, never a raw error' on partial schemas. No GOLD is lost (orders stay paid and immutable; crediting resumes once 0015 applies), so this is a liveness/ordering defect. Fix: guard maintainGold and the reconcile route on the newest required object (world_gold_reconcile_errors or the delivery_evidence_json column), or make reconcileWorldGold degrade/return a coded SCHEMA_INCOMPLETE failure when the table is missing, and refuse new admissions while the schema is incomplete.

**Reproduction**

Scratch node:test: db=openD1(migrationFiles().filter(n=>Number(n.slice(0,4))<15)) (0001..0014 applied, 0015 absent). goldAdminCommand product 'pack' (topup gold 10 embeo 7) succeeds; wallet W quotes pack via goldQuote; ingestEconomyEvents records the matching payment at block 100 -> economy_orders.status='paid'. reconcileWorldGold(db,NOW) -> actual: throws Error 'no such table: world_gold_reconcile_errors'; reconcileWorldGold(db,NOW,orderId) (the player route) -> same throw. createWorker({},fetch,()=>NOW,undefined,()=>undefined,{config:async()=>config}).scheduled({cron:'* * * * *'},{DB:db,ECONOMY_CHAIN_LIMITER:{limit:async()=>({success:false})}},ctx), await ctx promises -> console shows ['economy_sync {"status":"unavailable"}','gold_maintenance {"status":"unavailable"}'] and worldGoldSnapshot(W).book stays '0'. Expected: book '10' or a coded, logged skip without a raw SQLite message. Positive control: the identical sequence on openD1() with all migrations credits book '10' on the first tick (packaged Audit L9a/L9b/I10 pass on this tree).

### 4. Low: AIMarket consumer classifies an identity whose expires_at has just passed (latency/clock skew) as a malformed World response and raises BridgeUnavailable instead of denying; complete_login's source_se

`aimarket/web/world_auth.py:243`

```
            or type(expiry) is not int or expiry <= _now_ms() or expiry > _now_ms() + 7 * 86400_000 + 60_000):
```

M1 is closed for the trial claim: _identity() lines 251-254 normalise an active trial whose endsMs has passed to inactive and the holder path survives (verified: 10/10 packaged Python tests pass; session_eligible with endsMs NOW-20 and NOW returns (ADDRESS, True) with _balance True; external profile with an active trial returns (ADDRESS, False)). The same latency/skew pattern is still a hard failure one line earlier for the identity's own expiry. World's introspect answers 200 only while MIN(bridge.expires_at, session.expires_at) > World's clock, so the consumer receives expires_at <= its own _now_ms() exactly through transit latency or when AIMarket's clock runs ahead of World's. In that state _identity() raises BridgeUnavailable('invalid_world_response') from the structural check, which (a) session_eligible() (lines 366-373) does not catch, so every portal read of a session in its final skew-window milliseconds errors out as a bridge outage instead of a revoke-and-deny, leaving the world_sessions row in place, and (b) complete_login() (line 307/313) never reaches its own deny branch `if expiry <= _now_ms(): raise BridgeDenied('source_session_expired')` at line 321, which is therefore dead code for the only input that could trigger it. Expected, consistent with the trial fix and REQUIREMENTS ('fresh rechecks', 'revocation remains closed'): a clean deny, since an expired identity is not a malformed one. Impact is availability/misclassification only, bounded by the skew plus latency window per session; no access is granted. Fix: keep the type and upper-bound checks structural but let expiry <= _now_ms() raise BridgeDenied (or return the identity and let session_eligible lines 379-384 and complete_login line 321 deny it); add regressions asserting session_eligible('S'*43, require_profile='world') == (None, False) with the row removed for expires_at=NOW and NOW-1, and complete_login raising BridgeDenied('source_session_expired').

**Reproduction**

python3 -I probe in aimarket/ reusing test_world_trial.TrialTests setUp/identity/session (AIMARKET_BRIDGE_SECRET and AIMARKET_WORLD_STATE_DB set by the fixture, w._now_ms patched to NOW). Insert world_sessions(token 'S'*43, address 0xaa..aa, bridge_session 'B'*43, expires_at NOW+5000, profile 'world'). Patch _world_post to return the fixture identity with world_trial endsMs NOW+1000 and expires_at=EXP, _balance -> True. session_eligible('S'*43, require_profile='world'): EXP=NOW+1 -> ('0xaa..aa', True) [positive control]; EXP=NOW -> raises BridgeUnavailable('invalid_world_response') with the world_sessions row still present; EXP=NOW-1 -> same. begin_login('zh',ADDRESS,profile='world') then complete_login(state,flow,'C'*43,profile='world') with EXP=NOW -> raises BridgeUnavailable('invalid_world_response'), never BridgeDenied('source_session_expired'). Expected for EXP<=NOW: (None, False) with the session revoked, and BridgeDenied on login.

### 5. Low: Paid-Mint approval reuses a reserved authorization at chain time == deadline (>= instead of >), handing back a packet that can no longer be mined

`mint/service/chain.mjs:86`

```
   const existing=[...this.orders.values()].find(o=>o.status==='reserved'&&o.wallet===input.wallet&&o.auth.key===packet.key&&o.auth.deadline>=now&&o.auth.signerEpoch===signerEpoch&&o.auth.recipient===packet.expectedRecipient);
```

The copied Mint service treats a reserved paid order as reusable while o.auth.deadline>=now, where now is the latest block timestamp. The contract accepts the appearance and the PaidAuthorization only while block.timestamp<=deadline (mint/contract/contracts/EmberEvoGenesisCandidate.sol lines 155 and 192), and every block mined after 'latest' has a strictly larger timestamp, so when now==deadline the existing authorization is already unexecutable. Everywhere else the boundary is strict: reconcileOrders releases when time()>auth.deadline (line 150), reserveMintGold refuses m.deadline<=nowMs, validateMintProof and the world_gold_mint_proof trigger release only at chainTimeMs>deadline. This one comparison is off by one. Effect: a reservation retry returns a packet that reverts on chain; because the reservation is reused, no fresh GOLD reservation, signature or deadline is produced, the player's mint attempt fails APPEARANCE_EXPIRED (gas spent), reconciliation then releases the hold, and only a further approval call creates a usable order. No GOLD or EMBEO is lost and the shared ledger stays correct, so this is a boundary/liveness defect of the fixture service; it matters because this retry comparison is what the second inspection hardened and what a production adapter would copy. Fix: use o.auth.deadline>now (ideally with a margin of a few blocks' seconds) so a reused packet is always still mineable.

**Reproduction**

Private EDR, contracts npm ci and world-source viem installed; scratch node:test importing mint/service/chain.mjs. mint=await createLocalService(); mint.transaction({wallet:'B',action:'approve',submissionId:uuid}); first=(await mint.approval({wallet:'B',look:initialLook(),route:'paid'})).packet -> goldAuthorization.deadline == time()+300. mint.admin({action:'advance',seconds:300}) so time()==deadline (asserted true). second=(await mint.approval(same)).packet -> second.packetId===first.packetId (reused). mint.transaction({wallet:'B',action:'mintPaid',packet:second,submissionId:uuid}). Expected: a new reservation/packet with a future deadline or a refusal; the returned packet must be mineable. Actual: rejects with code APPEARANCE_EXPIRED stage 'reverted', and state().orders shows the order 'released'. Negative control in the same file: advance 299 seconds instead -> packet reused and mintPaid succeeds with the order 'consumed'.

### 6. Low: finishGoldJob accepts a provider result of null (or an empty string) as a delivered, chargeable result with no refund path

`world-source/server/world-gold.ts:91`

```
 if('result' in args.outcome){try{json=JSON.stringify(args.outcome.result)??null;}catch{failure='RESULT_NOT_SERIALIZABLE';}if(json===null)failure??='RESULT_NOT_SERIALIZABLE';else if(new TextEncoder().encode(json).length>16000){json=null;failure='RESULT_TOO_LARGE';}}
```

The L4 remediation makes undefined, cyclic and oversize results terminal World-storage failures with a once-only refund, but a result of null passes: JSON.stringify(null) is the string 'null' (and JSON.stringify('') is '""'), so json is non-null, the job is marked 'delivered' with result_json 'null', the GOLD debit stands, and the state is final (refundGold requires 'failed'; admin refund-service requires failed/refunded). A provider adapter that resolves {kind:'delivered',result:null} on an empty upstream body (a common HTTP-client default) therefore charges the player for nothing with no lawful refund path, the same outcome L4 was meant to close. Fix: treat null (and an empty string/object) like undefined: failure='RESULT_NOT_SERIALIZABLE' or a dedicated RESULT_EMPTY with the existing world-result-unusable evidence and refund; have runGoldServiceJobs reject delivered outcomes without a non-null result before calling finishGoldJob.

**Reproduction**

Scratch node:test with tests/world-gold-audit5-fixture.mjs: topup (book '10'), id=await f.service() (research, book '7'), a=await claimGoldJob(db,id,NOW); finishGoldJob(db,{orderId:id,attempt:a,nowMs:NOW+1,outcome:{result:null}}). Expected: terminal failure with evidence kind 'world-result-unusable' and book back to '10' (as for result:undefined). Actual: no error; SELECT state,result_json,failure FROM world_gold_jobs -> {state:'delivered',result_json:'null',failure:null}; book stays '7'; refundGold(db,id,NOW+2) rejects REFUND_NOT_ENTITLED. Negative control in the same run: a second service order finished with {result:undefined} becomes state 'refunded' failure RESULT_NOT_SERIALIZABLE.

### 7. Low: Mint proof mode is bound one-way: a proof labelled finalized-chain is accepted for a private 31337 hold by both validateMintProof and the 0015 SQL mirror, storing a false finality claim in immutable s

`world-source/server/world-gold.ts:125`

```
 if(!e||e.schema!=='ember-mint-proof-v1'||!['finalized-chain','private-chain-fixture'].includes(e.mode)||(e.mode==='private-chain-fixture'&&m.chainId!==31337)||e.orderId!==m.id||e.wallet!==m.wallet||e.gold!==m.gold||e.chainId!==m.chainId||e.contract!==m.contract||e.chainInstance!==m.chainInstance||!hash(e.blockHash)||!uint(e.blockNumber)||!Number.isSafeInteger(e.chainTimeMs)||e.chainTimeMs<=0||!uint(e.tokenId)||typeof e.revoked!=='boolean')fail('MINT_EVIDENCE_REQUIRED');
```

validateMintProof rejects mode private-chain-fixture when the stored binding is not chain 31337, and the migration 0015 trigger world_gold_mint_proof (line 36: mode='finalized-chain' OR (OLD.chain_id=31337 AND mode='private-chain-fixture')) mirrors that. Neither side enforces the converse: a proof claiming mode finalized-chain is accepted for a hold whose stored chain_id is 31337. The remediation says the ledger validates the complete original namespace and that the included reader is PRIVATE EDR ONLY, but the mode label, the only field distinguishing a deployment-pinned finalized reader from a fixture reader, does not bind to the stored namespace in the private direction. A misconfigured or mislabelled server reader (a production-mode adapter pointed at a 31337 namespace, or a fixture reader copying the production proof template) releases or consumes a private hold while recording evidence_json that asserts finality it cannot have; world_gold_mint_settlements is immutable, so the false label is permanent. orderId/wallet/gold/chainInstance are still compared, so no GOLD is created or double-spent; this is an evidence-integrity and audit-classification gap. Fix: require (e.mode==='private-chain-fixture')===(m.chainId===31337) in validateMintProof and replace the OR in the trigger with an exact per-chain mapping; add the negative case to the L6 test and the SQL guard-removal calibration.

**Reproduction**

Scratch node:test with the audit5 fixture: topup (book '10'); m={...f.mint(),chainId:31337}; reserveMintGold(db,m,NOW) (reserved '8'). settleMintGold(db,{id:m.id,chainId:31337,contract:m.contract,chainInstance:m.chainInstance,state:'released',evidence:mintProof(m,'released',{mode:'finalized-chain'})},NOW+1). Expected: MINT_EVIDENCE_REQUIRED (a 31337 binding is private-only) with reserved staying '8'. Actual: accepted; world_gold_mints shows state 'released' with json_extract(evidence_json,'$.mode')='finalized-chain', reserved '0', and world_gold_mint_settlements holds an immutable row with mode 'finalized-chain' for chain 31337. Negative control: the same proof with mode private-chain-fixture on a chainId 1 binding is rejected MINT_EVIDENCE_REQUIRED.

### 8. Low: reserveMintGold throws an uncaught TypeError instead of a coded INVALID_MINT_AUTH refusal when the Mint binding carries a non-serializable auth value

`world-source/server/world-gold.ts:102`

```
 const encoded=JSON.stringify(m.auth);if(encoded.length>16000)fail('INVALID_MINT_AUTH');
```

reserveMintGold validates id, deadline, chainId and chainInstance with coded INVALID_MINT_AUTH refusals, but the auth payload is only size-checked after JSON.stringify. JSON.stringify returns undefined for undefined, functions and symbols, so encoded.length dereferences undefined and the function escapes with a TypeError before the stored-binding retry comparison (line 104), the mint feature pause check and the hold insert run. No GOLD is moved and no hold row is written, so this is a robustness/diagnostics gap at the shared-ledger boundary the production Mint adapter is expected to call (SCOPE: adapters must supply the complete binding), not a spend bypass; only server callers reach the function and the bundled fixture adapter always passes an object. Fix: treat encoded===undefined (or typeof m.auth!=='object'||m.auth===null) as fail('INVALID_MINT_AUTH') before reading .length, and add a regression that auth undefined rejects INVALID_MINT_AUTH leaving world_gold_mints/world_gold_holds empty.

**Reproduction**

Scratch node:test with the audit5 fixture (fresh in-memory D1, all migrations, wallet W book '10'). reserveMintGold(db,{...f.mint(H(2)),auth:undefined},NOW). Expected: Error('INVALID_MINT_AUTH'). Actual: TypeError: Cannot read properties of undefined (reading 'length'). Same TypeError for auth:()=>1 and auth:Symbol('x'); world_gold_mints count stays 0. Positive control: auth:{a:1} with the same binding succeeds and an identical retry returns silently with one world_gold_mints row.

### 9. Info: Fixture runtime wires the GOLD 'mint' feature pause into every Mint approval, so pausing GOLD holds also blocks fee-free free Mints

`world-source/scripts/world-gold-local-runtime.mjs:23`

```
 mint.beforeApproval=()=>goldFeature(db,'mint');
```

LocalChainService.approval() (mint/service/chain.mjs line 71) awaits beforeApproval before it branches on packet.route (line 84), and the shared runtime binds it to goldFeature(db,'mint'). An administrator control mint enabled:false, intended to stop new GOLD hold admissions for paid Mint, therefore also rejects free-route approvals, which involve neither EMBEO nor GOLD. REQUIREMENTS.md: 'Pause only new admissions by feature' and one eligible free Mint 'without either fee'. Free/paid simultaneity holds only while the pause is off. This is private fixture wiring, not production code, but it is the reference adapter a production consumer is said to follow. Fix: call the feature check inside the paid branch (next to gold.reserve) or pass the route to beforeApproval and check only for route==='paid'.

**Reproduction**

Private EDR with contracts npm ci: r=await createGoldLocalRuntime(); goldAdminCommand(r.db,{wallet:ECONOMY_TREASURY,requestId:uuid,command:{action:'control',feature:'mint',enabled:false,version:0},reason:'review probe pause',nowMs:Date.now()}); r.mint.approval({wallet:'A',look:initialLook(),route:'free'}). Expected: a free approval packet (no GOLD involved). Actual: rejects FEATURE_PAUSED (paid approval also rejects FEATURE_PAUSED, as intended). Control: after control mint enabled:true version:1 the same free approval returns a packet with route 'free'.

### 10. Info: Release gates confirmed open, not implementation defects: reviewedEconomyConfig returns null and no delivery consumer or Mint proof reader is bound in the deployed Worker entry

`world-source/server/economy-deployment.ts:8`

```
export async function reviewedEconomyConfig():Promise<EconomyConfig|null>{return null;}
```

The deployed Worker constructs its economy dependencies with only config:reviewedEconomyConfig (worker/app.ts line 145) and no delivery provider, so hasGoldDeliveryProvider(economy.delivery) is false, serviceReady is false for every request, goldQuote for service products fails SERVICE_DELIVERY_UNAVAILABLE, sharedServiceAdmission blocks challenges and debits, and the control action cannot enable the service feature. That is the intended closed state. It also means that in production paid service jobs cannot be delivered or refunded (runGoldServiceJobs never runs), held Mint reservations cannot be settled (no reader or reconcileHeldMintGold caller exists in worker/app.ts), and the only MintProofReader in the packet is the private EDR fixture. Recorded so that passing fixture suites are not read as closure. Not proved by this review: real AIMarket/fortune/VPS delivery, public-chain finality, persistent namespace registry, real wallets, D1/CPU capacity, migration/rollback/postflight. Verified on this tree from a scratch copy with viem and the contracts lock installed (Node 24.21): tests/world-gold-audit5.test.mjs and world-gold-audit5-adversarial.test.mjs 27/27 pass including the EDR-backed L8 reset refusal; aimarket Python 10/10 pass. Prior findings M1, M2, L3, L4, L5, L6, L7, L8, L9, I10, I11 and the second-inspection hardening are closed by the cited code paths except for the residual edges reported above (settlement-journal capacity, pre-0015 reconcile, identity-expiry classification, legacy GOLD orders). Nothing in this review authorises deployment.

**Reproduction**

grep -n 'return null' world-source/server/economy-deployment.ts -> line 8; grep -n 'delivery\|reconcileHeldMintGold\|settleMintGold' world-source/worker/app.ts -> delivery appears only as the optional EconomyWorkerDeps field and the hasGoldDeliveryProvider guard; no reconcileHeldMintGold or settleMintGold call exists. createWorker(gateway) with the default economy argument then handling POST /api/gold/quote for an enabled service product by an admin EOA session returns 409 SERVICE_DELIVERY_UNAVAILABLE (packaged I11 test). Expected and actual agree (closed); recorded as a gate.

---

Judge's submission `38f4b026963f92f731ee16e153f2806f79fc0b4dc9880f449711545e320eb269`, accepted on the IdentityMD network. Acceptance means the report met the job's checks;
it is not a guarantee that the code has no other defects.
