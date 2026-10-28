// Wallet lock: the wallet-related files that the Swarm audits reviewed are frozen at the audited version (last audit
// f6bd50ad, fixed in 7021b5b). Changing one of them means the audit no longer covers what runs, so it needs a new audit.
// security/wallet-lock.json holds the SHA-256 of every file in LOCKED; tests/wallet-lock.test.mjs fails when any of them
// changes or disappears, and scripts/deploy.mjs runs the full suite, so such a change cannot be deployed by accident.
// Line endings are normalised (CRLF -> LF) so a checkout setting does not count.
//
// It is a warning, not a ban. Once the owner approves a change, refresh the hashes with a reason (it is appended to the
// manifest's unlock history) and deploy as usual; the change then needs a new Swarm audit, when the owner decides:
//   node scripts/wallet-lock.mjs --update --reason "what changed and who approved it"
// `node scripts/wallet-lock.mjs` alone only checks.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
export const MANIFEST='security/wallet-lock.json';
// Only files that a published audit reviewed (public review repo: source/ for the wallet sign-in audits R5-R12,
// Submission13-18 for the wallet, GOLD and staking audits e4a57f91 .. f6bd50ad), limited to wallet code and its tests.
// Styles, media and the shared worker/app.ts and wrangler.jsonc are left out.
export const LOCKED=[
  // Wallet sign-in (R5-R12)
  'migrations/0001_wallet_login.sql','server/auth.ts','src/world/auth.ts','src/world/authCleanup.ts','src/world/authLifecycle.ts',
  'src/world/siwe.ts','src/world/wallet.ts','src/world/walletView.ts','src/world/WalletPanel.tsx',
  'tests/aud4-auth.test.mjs','tests/auth-artifacts.mjs','tests/auth-artifacts.test.mjs','tests/auth-audit10.test.mjs',
  'tests/auth-audit8-causal.test.mjs','tests/auth-audit8-causes.mjs','tests/auth-audit8-reference.mjs','tests/auth-audit8.test.mjs',
  'tests/auth-audit9.test.mjs','tests/auth-lifecycle-model.test.mjs','tests/auth-r5-authority.test.mjs','tests/auth-r5.test.mjs',
  'tests/auth-r7-authority.test.mjs','tests/auth-r7-fixtures.mjs','tests/auth-r7-lifecycle.test.mjs','tests/auth-r8.test.mjs',
  'tests/auth-reference-model.mjs','tests/auth-reference-scheduler.test.mjs','tests/auth-scheduler-driver.mjs','tests/auth-v11.test.mjs',
  'tests/auth.test.mjs','tests/fixtures/wallet-panel.mjs','tests/wallet-client.test.mjs','tests/wallet-harness.mjs',
  // Wallet controller, GOLD purchase, checkouts, staking panel and balances (Submission13-18)
  'migrations/0021_world_gold_fast_credit.sql','server/economy-recovery.ts','server/economy-rpc.ts','server/world-gold-api.ts',
  'server/world-gold-fast.ts','server/world-gold.ts','src/world/AIMarketPane.tsx','src/world/CelestaoCheckout.tsx',
  'src/world/celestaoCheckoutClient.ts','src/world/EconomyPane.tsx','src/world/economyClient.ts','src/world/economyWallet.ts',
  'src/world/GoldPurchase.tsx','src/world/goldPurchasePreview.tsx','src/world/goldPurchaseRules.ts','src/world/memberBalancesClient.ts',
  'src/world/MiningPanel.tsx','src/world/pendingGoldCredit.ts','src/world/ResearchPassCard.tsx','src/world/useMemberBalances.ts',
  'src/world/WalletBalanceHud.tsx','src/world/WalletBalancesBlock.tsx','src/world/worldGoldClient.ts','src/world/WorldGoldPanel.tsx',
  'tests/economy-client.test.mjs','tests/economy-pane.test.mjs','tests/economy-wallet-recovery.test.mjs','tests/gold-purchase-ui.test.mjs',
  'tests/mining-panel.test.mjs','tests/pending-gold-credit.test.mjs','tests/research-pass-ui.test.mjs','tests/session-compare.test.mjs',
  'tests/world-gold-fast.test.mjs',
  // Deploy tool (Submission14-18)
  'scripts/deploy.mjs','tests/deploy.test.mjs',
  // The lock itself, so it cannot be loosened quietly
  'scripts/wallet-lock.mjs','tests/wallet-lock.test.mjs',
];
export const inZone=path=>LOCKED.includes(path);
export const digest=buf=>createHash('sha256').update(buf.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
export function currentHashes(root=ROOT){
  const files={};for(const p of LOCKED)if(existsSync(join(root,p)))files[p]=digest(readFileSync(join(root,p)));
  return files;
}
export const readManifest=(root=ROOT)=>JSON.parse(readFileSync(join(root,MANIFEST),'utf8'));
/** Differences between the manifest and the working tree: changed, missing and newly locked files. */
export function lockDiff(manifest,now){
  const locked=manifest.files;
  return {
    changed:Object.keys(locked).filter(p=>p in now&&now[p]!==locked[p]).sort(),
    missing:Object.keys(locked).filter(p=>!(p in now)).sort(),
    added:Object.keys(now).filter(p=>!(p in locked)).sort(),
  };
}
export const lockBroken=d=>d.changed.length+d.missing.length+d.added.length>0;
export function lockMessage(d){
  const list=(t,a)=>a.length?t+'\n'+a.map(p=>'  '+p).join('\n')+'\n':'';
  return '錢包封鎖區的檔案和審計過的版本不同（wallet lock broken）。\n'+list('改過 changed:',d.changed)+list('不見 missing:',d.missing)+list('新加入封鎖 new:',d.added)+
    '這些檔案經過 Swarm 審計。要改請先問擁有者；同意後可以照常修改和部署，但這次改動需要重新送 Swarm audit。同意後執行\n'+
    '  node scripts/wallet-lock.mjs --update --reason "改了什麼、誰同意的"\n';
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const args=process.argv.slice(2),now=currentHashes();
  if(args[0]==='--update'){
    const reason=args[1]==='--reason'?String(args[2]||'').trim():'';
    if(!reason){console.error('--update needs --reason "what changed and who approved it"');process.exit(2);}
    const old=existsSync(join(ROOT,MANIFEST))?readManifest():null;
    const d=old?lockDiff(old,now):{changed:[],missing:[],added:Object.keys(now)};
    const head=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
    const manifest={...(old||{}),files:now,unlocks:[...(old?.unlocks||[]),{date:new Date().toISOString(),head,reason,...d}]};
    writeFileSync(join(ROOT,MANIFEST),JSON.stringify(manifest,null,2)+'\n');
    console.log('wallet lock updated: '+Object.keys(now).length+' files; '+d.changed.length+' changed, '+d.missing.length+' missing, '+d.added.length+' new.');
    if(d.changed.length)console.log('提醒：封鎖區有改動，可以照常部署，但這次改動需要重新送 Swarm audit。');
  }else{
    const d=lockDiff(readManifest(),now);
    if(lockBroken(d)){console.error(lockMessage(d));process.exit(1);}
    console.log('wallet lock ok: '+Object.keys(now).length+' files match the audited version.');
  }
}
