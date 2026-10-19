# Audit report

> Review public commit e5ca6e5ac90a9e78b4739a242995121e791cff92.
>
> Re-audit remediation of job188a3018-0379-413a-bccc-79f278452e8f, previously public450507815fec44e1c496999e07da1b006861c5dd / World7afdd097847d2cd6b5d503734566afc1b78a2c8d. New private World41ca333db50696a0a2f4c886d6fe7171637908cc. Source/auxiliary hashes, explicit portable adaptations, original report and both diffs are included. No publication, paid submission, production migration or deployment is implied.
>
> D01: SQL guards every positive journal before int64 addition. Staking records immutable original share-day entitlements; capped rewards remain owed outside book/reserved/available, without blocking peers/page progress. Bounded retry credits once. Recovery counts issued and owed separately; SQL rejects old recovery plans unaware of pending rewards. Test1025 legitimate current-price orders reaching exact cap, plus historical0014 paid quote/indexer ->0015/16 ->owed ->recovery/backup ->retry without twice-issued rewards.
> D02: shared mode refuses unlinked legacy GOLD catalogue admission/payment. Current linked services require product/control/trusted provider/result-contract gates; debit/paid/challenge/job commit atomically. Historical paid-no-job cases remain read-only inventory, not invented delivery or blanket refunds.
> D03: uncached readiness checks112 reviewed SQL objects including37 tables/244 columns and every required trigger/index/view. Test old/partial schemas, removed guards and same-order resume after forward migration. World financial POST refuses even pre0014; no deployed standalone fallback. Historic standalone tests retain their original assertions/profile explicitly.
> D04: ordinary expired bridge identity cleanly denies/revokes, distinct from malformed response/outage. Resample after response and slow balance read; external profile never receives World trial rights.
> D05: paid auth reuse requires latest time strictly before deadline and complete original wallet/cost/key/URI/epoch/recipient/domain/run binding. At equality refuse a dead packet without releasing an executable hold. Missing/delayed required original-chain proof stays held. Private EVM covers deadline-1 actual mint, equality/+1 and pending proof.
> D06: reviewed research/fortune result contracts reject null/empty/malformed/oversize/unsafe Unicode; explained zero/false/no-signal remains valid. Deterministic unusable output attempts original refund once; unknown timeout remains pending with the same key. Unknown schema/provider refuses new charge. Fresh claim/finish clocks fence expired leases.
> D07: application and SQL enforce31337/private-edr vs public/finalized-chain in both directions alongside the full proof predicate. Label changes cannot promote private evidence. Calibrate by removing guards; real public finality remains unproved.
> D08: lossless JSON auth rejects undefined/functions/symbols/cycles/BigInt/accessors/custom serialization/nonfinite/depth/UTF8 overflow with typed INVALID_MINT_AUTH before writes. Recorded order/wallet/cost and actual wrapped packet/anchor/domain bindings must match. Stored JSON is not cryptographic or public-chain proof.
> D09: paid-only approval pause leaves eligible free Mint executable without EMBEO/GOLD and allows existing paid-hold settlement. Original contract eligibility, one-free-per-wallet and shared2222 concurrent free/paid supply remain unchanged; no3-day window.
> D10: real provider/VPS/result-contract integration, finalized public Mint reader/persistent original namespace, actual wallets/runtime, production CPU/D1 limits, formal catalogue/prices and migration/rollback/postflight remain explicit unverified release gates. reviewedEconomyConfig stays disabled; fixture success is not production integration.
>
> Additional reproduced defect: payment time went stale during schema/admission I/O; resample original deadlines immediately before atomic spend. Independently examine every credit source (purchase, stake/owed, refund, admin, Mint release, recovery), old/new payment entry, schema/guard removal, UTC days, expiry equality, lease/timeout, concurrency/crash/replay, read-only historical inventory and immutable before/after evidence.
>
> Start with world-source/docs/world-gold-audit6-remediation.md, runbook and release-gates, context/T01-T22-evidence.md and evidence/packet-validation.json. Three complete flows and sanitized before/after failures are included. Per LOCAL_TESTS.md run source verification, selected financial tests, original Solidity30 and Python18. Full World build/regression evidence is separate from this selected packet; dependencies reuse exact locks, not a claimed fresh download. GOLD is nontransferable/nonredeemable; no AMM/trading pair. Test prices are not formal prices. Passing local checks does not imply zero remaining findings or production safety.

| | |
|---|---|
| Repository | https://github.com/tungweb3/imd-ember-world-review.git |
| Commit | `e5ca6e5ac90a9e78b4739a242995121e791cff92` |
| Job | `d6268e87-a268-48c7-87ec-fa243452f308` |
| Judged | 2026-10-18 18:04 UTC |
| Findings | 2 medium · 1 low · 1 info |

Four agents audited the code as it is at `e5ca6e5`, each in one area (math, permissions, economics, control flow),
and a judge reproduced, merged and ranked what they found, then read the code once more itself. Nothing in the repository was changed or deployed.

## Findings

### 1. Medium: Shared mode still admits and collects payment for unlinked legacy EMBEO catalogue service orders that can never be delivered or refunded

`world-source/server/economy-ledger.ts:256`

```
  if(shared&&args.currency==='GOLD')throw new EconomyConflict('LEGACY_GOLD_ORDER_UNSUPPORTED');
```

D-02 closed the legacy catalogue route in shared mode only for currency GOLD. createEconomyOrder (reached from POST /api/economy/orders in server/economy.ts) refuses a shared-DB catalogue order when args.currency==='GOLD' but still inserts one priced from config.catalogue for currency 'EMBEO' (lines 257-264). That order has no world_gold_links row, so none of the shared-mode gates apply: the world_gold_controls 'service' pause, the serviceReady requirement and the result-contract check in sharedServiceAdmission (lines 212-221) are only consulted on the GOLD challenge/debit path, and goldQuote's product/control predicate is bypassed because the order never passes through goldQuote. When the player pays the EMBEO quote on-chain, ingestEconomyEvents marks it paid and the 0010 trigger economy_order_paid writes economy_fulfillments. reconcileWorldGold ignores it (no link), runGoldServiceJobs never sees it (no world_gold_jobs row), refundGold and the admin refund-service action both refuse it, and nothing in the packet consumes economy_fulfillments. Real EMBEO reaches the treasury for a service that cannot be delivered or refunded while the service feature is paused, violating REQUIREMENTS.md 'Service debit creates one durable job' and 'Pause only new admissions by feature'. Precondition (trust assumption): a reviewed EconomyConfig whose catalogue carries an entry with an embeo price. reviewedEconomyConfig is null today and the fixture catalogue is empty, but a formal catalogue is the stated D10 release path, and the guard that is meant to close this door is asymmetric. Fix: in shared mode refuse every catalogue service admission regardless of currency (e.g. throw LEGACY_ORDER_UNSUPPORTED when shared, or require config.catalogue to be empty when world_gold tables exist) and route EMBEO purchases only through goldQuote topup products so they carry a link and a bounded entitlement.

**Reproduction**

Scratch node script against world-source with its exact lock installed (all migrations through 0016 via tests/d1-sqlite.mjs openD1()). config=defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,treasury:ECONOMY_TREASURY,stakingContract:0x11..,paymentContract:0x22..,tokenDecimals:18,deploymentBlock:'100',catalogue:[{id:'legacy-research',titleZh:'a',titleEn:'a',gold:'3',embeo:'5'}]}); W=0xaa..aa. Negative control: createEconomyOrder({wallet:W,requestId:'s'*20,serviceId:'legacy-research',currency:'GOLD',nowMs:NOW}) -> throws LEGACY_GOLD_ORDER_UNSUPPORTED (observed). Then goldAdminCommand control {feature:'service',enabled:false,version:0} -> world_gold_controls.service.enabled=0 (observed), and serviceReady is never supplied. createEconomyOrder({wallet:W,requestId:'e'*20,serviceId:'legacy-research',currency:'EMBEO',nowMs:NOW}) -> Expected: refused (LEGACY_*_UNSUPPORTED / FEATURE_PAUSED / SERVICE_DELIVERY_UNAVAILABLE) before any quote is issued, as for GOLD. Actual (observed): returns {currency:'EMBEO',amount:'5',status:'pending'}. ingestEconomyEvents with the matching payment event at block 100 (payer W, amount '5', token/treasury from config) -> economy_orders.status='paid' (observed). reconcileWorldGold(db,NOW+200) -> {processed:0,failures:[],rewards:[]}; COUNT world_gold_links for the order = 0; COUNT world_gold_jobs = 0; COUNT economy_fulfillments = 1. refundGold(db,id,NOW+300) -> REFUND_NOT_ENTITLED; goldAdminCommand refund-service for the id -> 'CHECK constraint failed: accepted=1' (refused). EMBEO collected, no job, no delivery, no refund path.

### 2. Medium: Result contract accepts any non-blank bare string, so deterministic provider error text is stored as a paid delivered result with no refund path

`world-source/server/world-gold-result.ts:10`

```
 if(text(v))return true;
```

D-06 states the research/fortune result contracts reject null/empty/malformed documents and that a deterministic unusable output triggers one original-price refund. usableDocument() short-circuits to true for every string whose trim() is non-empty, before any structural check. A trusted provider adapter that resolves {kind:'delivered',result:<upstream body text>} on a non-JSON upstream failure (the common HTTP-client default) therefore delivers the literal error text ('error', 'Internal Server Error') as the paid report: finishGoldJob marks the job 'delivered' with result_json '"error"', the GOLD debit stands, refundGold rejects (state is not 'failed') and the administrator refund-service check (state IN ('failed','refunded')) also rejects, so no operator path exists short of direct SQL. The object form of the same contract is stricter (report/content text or explained ok/no-signal status), so the bare-string branch is the only shape that admits an undifferentiated error payload. inspectWorldGoldExceptions re-runs encodeGoldResult on delivered rows and therefore classifies such rows as clean (0 'delivered-result-needs-review' rows). This is the same charge-for-nothing outcome the previous audit's null-result finding closed, reached through a different accepted value. Fix: restrict the bare-string branch to the historical fixture read path (inspection reader) and refuse it for new deliveries, or require a minimum documented shape (e.g. object with report/content or explained status) in runGoldServiceJobs/finishGoldJob so a bare string becomes RESULT_UNUSABLE with the existing one-time refund.

**Reproduction**

Scratch node script importing tests/world-gold-audit5-fixture.mjs (all migrations). f=await fixture(); await f.topup() (book '10'); id=await f.service() (research, book '7'); a=await claimGoldJob(db,id,NOW); await finishGoldJob(db,{orderId:id,attempt:a,nowMs:NOW+1,outcome:{result:'error'}}). Expected: terminal failure RESULT_UNUSABLE with evidence kind 'world-result-unusable', state 'refunded' and book back to '10' (as for result null, '' or ' '). Actual (observed on this tree): SELECT state,result_json,failure FROM world_gold_jobs WHERE order_id=id -> {state:'delivered',result_json:'"error"',failure:null}; book stays '7'; refundGold(db,id,NOW+2) -> REFUND_NOT_ENTITLED. Same with result:'Internal Server Error' -> {state:'delivered',result_json:'"Internal Server Error"'}, refund REFUND_NOT_ENTITLED. inspectWorldGoldExceptions(db) -> 'delivered-result-needs-review' rows: []. Positive controls in the same run: result:' ' and result:null -> state 'refunded', failure 'RESULT_UNUSABLE', book restored.

### 3. Low: reserveMintGold checks the auth deadline only against the caller-supplied stale time and never resamples or SQL-guards it before the atomic hold insert

`world-source/server/world-gold.ts:112`

```
 if(!/^0x[0-9a-f]{64}$/.test(m.id)||!Number.isSafeInteger(m.deadline)||m.deadline<=nowMs||!Number.isSafeInteger(m.chainId)||m.chainId<1||typeof m.chainInstance!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(m.chainInstance))fail('INVALID_MINT_AUTH');
```

reserveMintGold evaluates m.deadline<=nowMs once using the caller's nowMs. After that it awaits requireWorldGoldSchema, the existing-order SELECT, encodeMintAuth and goldFeature(db,'mint'), then runs a db.batch that INSERTs world_gold_mints and the 'held' world_gold_holds row. Neither the batch nor the 0014 world_gold_hold_insert trigger (which checks only mint existence, state and available balance) nor any 0015/0016 trigger carries a deadline predicate; the only deadline SQL is the release predicate. Unlike goldQuote (line 50), claimGoldJob, finishGoldJob and payEconomyOrderGold, which were given a now() resampler in this remediation specifically for the 'stale payment time after schema/admission I/O' defect, this function takes no fresh clock. So an auth that is already dead by the time the rows are written is inserted as a 'held' mint plus hold, reserving the wallet's GOLD until a trusted original-namespace proof reader later releases it (D05 says equality must be refused without creating a hold). Mitigating facts that keep this low: in the supplied integration (mint/service/chain.mjs approval) the deadline is chain time + 300 s and the local runtime passes chain time read immediately before the call, so ~300 s of I/O stall would be needed, and the stale hold is eventually released by reconcileHeldMintGold once chainTimeMs > deadline. Fix: accept now?:()=>number, resample right before db.batch and refuse when deadline<=fresh, and add a SQL guard in the same batch (e.g. check(db,'?<deadline',fresh) or INSERT ... SELECT ... WHERE ?<deadline) so a removed application guard is also caught.

**Reproduction**

Scratch node script importing tests/world-gold-audit5-fixture.mjs. f=await fixture(); await f.topup() (book '10'). Wrap the D1 shim so the controls SELECT used by goldFeature ('SELECT enabled FROM world_gold_controls WHERE feature=?') resolves after a 20 ms delay, simulating one slow D1 round-trip. start=Date.now(); deadline=start+10; m={id:H(4242),wallet:W,auth:{wallet:W,id:H(4242)},gold:'8',chainId:1,contract:0x88..,chainInstance:'preserved-chain-instance',deadline}. reserveMintGold(slowDb,m,start). Expected: no row written; the call refuses once real time reaches the deadline (INVALID_MINT_AUTH / MINT_AUTH_EXPIRED), matching the equality control. Actual (observed): call resolves ('ACCEPTED'); Date.now()-deadline after the call = 21 ms (deadline already passed when the batch ran); world_gold_mints row {state:'held',deadline} and world_gold_holds row {state:'held',amount:8} exist; worldGoldSnapshot -> book '10', reserved '8', available '2'. Control in the same run: reserveMintGold(db,{...m,id:H(4243)},deadline) with nowMs equal to the deadline -> INVALID_MINT_AUTH, showing only the caller-supplied sample is checked.

### 4. Info: goldQuote idempotent retry returns an already-expired pending order id instead of ORDER_EXPIRED, unlike createEconomyOrder

`world-source/server/world-gold.ts:44`

```
 if(old){const link=await st(db,'SELECT p.product FROM world_gold_links l JOIN world_gold_products p ON p.id=l.product_id WHERE l.order_id=?',old.id).first<{product:string}>();if(link?.product!==args.product)fail('IDEMPOTENCY_CONFLICT');return old.id;}
```

The retry branch of goldQuote returns old.id without reading status or expires_ms against the clock. The legacy createEconomyOrder path for the identical situation throws ORDER_EXPIRED (economy-ledger.ts line 255), and every downstream step (createEconomyGoldChallenge, payEconomyOrderGold) refuses the expired pending order. A client that retries POST /api/gold/quote with its stored requestId after the 15-minute window receives HTTP 200 {orderId} for an order it can never pay; the only recovery is a new requestId, which the response does not signal. No GOLD or EMBEO moves and no duplicate quote is created, so this is a liveness/consistency inconsistency of the new shared quote entry, not a loss. Fix: in the old-request branch select status and expires_ms and fail('ORDER_EXPIRED') when status='pending' and expires_ms<=fresh clock, mirroring createEconomyOrder.

**Reproduction**

Scratch node script with tests/world-gold-audit5-fixture.mjs. f=await fixture(); r=rid(); id=await goldQuote({db,config,nowMs:NOW,serviceReady:true},{wallet:W,requestId:r,product:'research'}) -> economy_orders {status:'pending',expires_ms:NOW+900000}. goldQuote({db,config,nowMs:NOW+900000,serviceReady:true},{wallet:W,requestId:r,product:'research'}). Expected: ORDER_EXPIRED, as createEconomyOrder(db,config,{wallet:W,requestId:r,serviceId:'research',currency:'GOLD',nowMs:NOW+900000}) throws for the same stored order (observed: ORDER_EXPIRED). Actual (observed): the same order id is returned. The subsequent createEconomyGoldChallenge(db,config,{wallet:W,orderId:id,requestId:rid(),origin:'https://imdember.com',nowMs:NOW+900000,serviceReady:true}) throws ORDER_EXPIRED. Negative control: at nowMs NOW+899999 the same id is returned (true) and is still payable.

---

Judge's submission `313f6442d9215f68cb047601d500a6239bb725e201398381641d9773c3f7ae7f`, accepted on the IdentityMD network. Acceptance means the report met the job's checks;
it is not a guarantee that the code has no other defects.
