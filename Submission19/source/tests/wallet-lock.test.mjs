import test from 'node:test';
import assert from 'node:assert/strict';
import {currentHashes,inZone,lockBroken,lockDiff,lockMessage,readManifest,LOCKED} from '../scripts/wallet-lock.mjs';
// The wallet lock (scripts/wallet-lock.mjs): the wallet files the Swarm audits reviewed must match security/wallet-lock.json.
// The deploy tool runs this suite, so a change to one of them cannot ship until the owner approves it and the hashes are
// refreshed with a reason (the change then needs a new Swarm audit).
test('the locked wallet files match the audited version',()=>{
  const d=lockDiff(readManifest(),currentHashes());
  assert.equal(lockBroken(d),false,lockMessage(d));
});
test('the lock covers the audited wallet controller, GOLD purchase, checkouts, staking panel, sign-in and deploy tool only',()=>{
  const locked=Object.keys(readManifest().files);
  assert.deepEqual(locked.sort(),[...LOCKED].sort(),'the manifest names exactly the locked files');
  for(const p of ['src/world/economyWallet.ts','src/world/pendingGoldCredit.ts','src/world/WorldGoldPanel.tsx','src/world/GoldPurchase.tsx',
    'src/world/goldPurchaseRules.ts','src/world/worldGoldClient.ts','src/world/economyClient.ts','src/world/EconomyPane.tsx',
    'src/world/MiningPanel.tsx','src/world/CelestaoCheckout.tsx','src/world/auth.ts','src/world/siwe.ts','server/world-gold.ts',
    'server/world-gold-api.ts','server/economy-rpc.ts','server/economy-recovery.ts','server/auth.ts','scripts/deploy.mjs',
    'tests/economy-wallet-recovery.test.mjs','tests/wallet-lock.test.mjs'])
    assert.ok(inZone(p),p);
  // Not reviewed by a wallet audit, or not wallet code: free to change.
  for(const p of ['src/world/HomePanels.tsx','src/world/skin/houses.ts','src/world/publicHalls/staking-mountain.ts','worker/app.ts',
    'wrangler.jsonc','src/world/worldGold.css','integrations/celestao/celestao_world/paid.py','server/aimarket-delivery.ts',
    'src/world/goldReviewRecord.ts'])
    assert.equal(inZone(p),false,p);
});
test('a change, a removal and a newly locked file are each reported',()=>{
  const manifest={files:{'a.ts':'1','b.ts':'2'}};
  const d=lockDiff(manifest,{'a.ts':'9','c.ts':'3'});
  assert.deepEqual(d,{changed:['a.ts'],missing:['b.ts'],added:['c.ts']});
  assert.match(lockMessage(d),/改過 changed:\n  a\.ts\n不見 missing:\n  b\.ts\n新加入封鎖 new:\n  c\.ts\n/);
  assert.equal(lockBroken(lockDiff(manifest,{...manifest.files})),false);
});
