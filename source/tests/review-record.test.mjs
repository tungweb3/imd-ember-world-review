import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuditRecord} from '../src/world/auditRecord.ts';
import {REVIEW_RECORD,FINDINGS,REREVIEWED,REVIEW_CHANGED} from '../src/world/reviewRecord.ts';
// The Swarm Audit Record in "My wallet" (remediation 2026-09-29 §6), rendered to the markup the page shows: collapsed,
// the reviewed scope, version, date, job and report (new tab, no referrer, no opener), the deployment match, the
// "previous review" label, that it applies to that version only, and every finding with its severity and status; then
// the two re-reviews of Worker 50c688c9 with their own findings.
const zh=(a)=>a,en=(a,b)=>b,render=say=>renderToStaticMarkup(createElement(AuditRecord,{say}));
const JOB='https://explorer.imd.fun/jobs/4bd31cfb-1151-497f-9b27-40e668dea372';
const REPORT='https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md';
const RETEST_JOB='https://explorer.imd.fun/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad',AUDIT_JOB='https://explorer.imd.fun/jobs/519db624-a82f-4dfe-91b9-1a519d1d3dd1';
const RETEST_REPORT='https://github.com/Identity-md/research/blob/main/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad/files/artifacts/report.md';
const link=href=>`<a href="${href}" target="_blank" rel="noreferrer noopener">`;
/** The <li> texts of the n-th list: 0 the review's findings, 1 the Report's, 2 the audit's. */
const lists=html=>[...html.matchAll(/<ul>(.*?)<\/ul>/g)].map(m=>[...m[1].matchAll(/<li>(.*?)<\/li>/g)].map(x=>text(x[1])));
/** The words the remediation forbids in the UI and docs (§6), and "certified" / an audited-by badge in any form. */
export const FORBIDDEN=/security certified|officially audited|100% safe|guaranteed secure|certif|audited[- ]by|badge|已認證|認證|保證安全|安全無虞|徽章/i;
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"');

test('the Swarm Audit Record is a collapsed block naming scope, reviewed version, date, deployment match and the previous-review label',()=>{
  const html=render(en),t=text(html);
  assert.match(html,/^<details class="audit-record"><summary>Swarm Audit Record<\/summary>/,'collapsed (no open attribute), titled as the remediation names it');
  for(const part of ['Previous review — current version has changed','Reviewed scope','Wallet sign-in &amp; home authorization (World-only)',
    'Worker beac62be (source 0def8cb, bundle 4ec73351…)','2026-09-28 (UTC)','Deployment match</dt><dd>partial</dd>','This record applies to the reviewed version only.',
    `Re-review</dt><dd>${link(RETEST_JOB)}Report e48d0a96… ↗</a> · ${link(AUDIT_JOB)}Audit 519db624… ↗</a></dd>`,'Findings (from the review) · fix status as reported by the site maintainer, not re-reviewed'])
    assert.ok(html.includes(part),part);
  const z=render(zh);
  for(const part of ['<summary>審查紀錄</summary>','先前的審查 — 目前版本已變更','錢包登入與我家權限（僅 World）','2026-09-28（UTC）','此紀錄只適用於受審查的版本。',
    'Worker beac62be（原始碼 0def8cb，bundle 4ec73351…）','部署對照</dt><dd>partial（部分驗證）</dd>','審查任務','發現（出自審查）· 修正狀態為 本站維護者自行說明，尚未重新審查',
    `重新審查</dt><dd>${link(RETEST_JOB)}Report（重測） e48d0a96… ↗</a> · ${link(AUDIT_JOB)}Audit（審查） 519db624… ↗</a></dd>`])assert.ok(z.includes(part),part);
  // The statuses below are the team's own account: the heading says so, after the line that the record is of the reviewed version.
  assert.ok(html.indexOf('This record applies')<html.indexOf('as reported by the site maintainer, not re-reviewed')&&html.indexOf('not re-reviewed')<html.indexOf('<li>'));
  assert.equal(REVIEW_RECORD.rereview,undefined,'the one-field form is gone');
  assert.doesNotMatch(t+text(z),FORBIDDEN);
  assert.deepEqual([REVIEW_RECORD.worker,REVIEW_RECORD.commit,REVIEW_RECORD.date,REVIEW_RECORD.match,REVIEW_RECORD.bundle],
    ['beac62be','0def8cb','2026-09-28','partial','4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3']);
});

test('its job and report links open the real pages in a new tab with no referrer and no opener',()=>{
  const links=[...render(en).matchAll(/<a ([^>]*)>/g)].map(m=>m[1]);
  assert.deepEqual(links,[JOB,REPORT,RETEST_JOB,AUDIT_JOB,RETEST_REPORT].map(u=>`href="${u}" target="_blank" rel="noreferrer noopener"`),
    'the review’s job and report, the two re-review jobs, and the one re-review report there is (the audit published none)');
});

test('every finding F-1..F-8 is listed with the report’s severity and an honest status, “open” where it is open',()=>{
  assert.deepEqual(FINDINGS.map(f=>[f.id,f.severity]),[['F-1','Medium'],['F-2','Low/Info'],['F-3','Low'],['F-4','Low'],['F-5','Low'],['F-6','Info'],['F-7','Info'],['F-8','Info']]);
  const items=lists(render(en))[0];
  assert.equal(items.length,8);
  // F-1: in a relayed message the domain is the real one, so the advice names the address bar and the wallet's origin warning.
  assert.match(items[0],/^F-1 · Medium \(shared boundary\) — Sign-in message can be relayed \(phishing\)\. Partly mitigated: .*a phishing site can skip page checks — sign only when the address bar shows imdember\.com; if your wallet says the request comes from another site or warns of a mismatch, reject\.$/);
  assert.doesNotMatch(items.join(' '),/\): [A-Z][a-z]+( [a-z]+)?:/,'no "title: Status:" double colon');
  // F-3 and F-5: the residual holds while the junk keeps coming, and F-5's still stands (present tense).
  assert.match(items[2],/while the junk continues \(partly open\)/);assert.doesNotMatch(items[2],/for a minute/);
  assert.match(items[2],/once a contract’s 2 shared checks a minute are spent, each network still gets one while the location’s allowance for these lasts\).*keep smart-wallet sign-in busy at one location \(first-time wallets, returning ones, or one chosen address\).*junk from a smart wallet’s own network can hold it/,'F-3 after A-1');
  assert.match(items[4],/^F-5 · Low \(availability\) — About 20 networks can close sign-in site-wide\. .*about 14 \/24s at full rate plus about 200 other networks a minute can close new sign-ins site-wide while they keep going; browsing is unaffected/);
  assert.match(items[6],/^F-7 · Info — Other observations \(a–e\)\. \(a\) fixed .*; \(b\)–\(e\) unchanged/);
  assert.match(items[7],/Open: nothing changed in World; later pages on this origin share these with World/);
  for(const i of [1,2,3,4])assert.match(items[i],new RegExp('^F-'+(i+1)+' · Low'));
  for(const i of [5,6,7])assert.match(items[i],new RegExp('^F-'+(i+1)+' · Info'));
  for(const i of [1,2,4,7])assert.match(items[i],/\bopen\b/i,'F-'+(i+1)+' is still (partly) open');
  assert.match(items[3],/Fixed: “Log out all devices”/);
  // F-6: an npm audit count is true only on the day it was run, so the line dates every count it states (both languages).
  for(const line of [FINDINGS[5].status.en,FINDINGS[5].status.zh]){
    const counts=line.split(/[;；，。]|\. /).filter(part=>/npm audit/.test(part));assert.ok(counts.length>=2,line);
    for(const c of counts)assert.match(c,/\d{4}-\d\d-\d\d|當日|that day/,c);
  }
  const zhItems=lists(render(zh))[0];
  assert.match(zhItems[0],/^F-1 · Medium（共用邊界） — 登入訊息可被轉送（釣魚）。部分緩解/);assert.match(zhItems[0],/釣魚網站可以略過本頁的檢查——只在網址列是 imdember\.com 時簽名/);
  assert.match(zhItems[2],/在垃圾請求持續期間/);assert.match(zhItems[4],/仍存在：約 14 個網段持續滿額、再加上每分鐘約 200 個其他網段時，仍可暫停全站新登入/);
  assert.doesNotMatch(zhItems[7],/不受影響/,'F-8: World is not claimed to be unaffected');assert.match(zhItems[7],/會與 World 共用這些設定/);
  for(const i of [1,2,4,7])assert.match(zhItems[i],/未解決|未完全解決/,'F-'+(i+1));
});

// The two re-reviews of Worker 50c688c9 (2026-09-29 UTC): Report e48d0a96 (a retest, report.md, deployment match partial,
// the bundle it rebuilt) and Audit 519db624 (no report file, no deployment-match verdict), each with its own findings as
// it rated them and the team's status for this version, under a line saying plainly that this version was not re-reviewed.
test('the two re-reviews of Worker 50c688c9 are listed with their findings, and the page says this version was not re-reviewed',async()=>{
  assert.deepEqual({...REREVIEWED},{worker:'50c688c9',commit:'2da46cd',snapshot:'b6e986b',bundle:'14584fe4df57e7505fc38e57a3b8b99590d948051cbc3a52b3d5a9ea969ff5e4',date:'2026-09-29'});
  assert.deepEqual(REVIEW_RECORD.rereviews.map(r=>[r.job,r.kind,r.match,r.jobUrl,r.reportUrl]),
    [['e48d0a96-d3a5-42bb-859f-e0b0707fd9ad','Report','partial',RETEST_JOB,RETEST_REPORT],['519db624-a82f-4dfe-91b9-1a519d1d3dd1','Audit',null,AUDIT_JOB,null]]);
  assert.deepEqual(REVIEW_RECORD.rereviews.map(r=>r.findings.map(f=>f.id+' '+f.severity)),
    [['W-1 Info','W-2 Info','W-3 Info'],['A-1 Medium','A-2 Low','A-3 Low','A-4 Low','A-5 Low','A-6 Low','A-7 Low','A-8 Low']]);
  assert.equal(REVIEW_CHANGED,true);
  const html=render(en),z=render(zh);
  for(const part of ['<p class="small-note audit-head">Re-reviews (2026-09-29, UTC)</p>',
    '<dt>Reviewed version</dt><dd>Worker 50c688c9 (source 2da46cd, public snapshot b6e986b, bundle 14584fe4… as the Report rebuilt it)</dd>',
    '<p class="small-note audit-changed">Both re-reviews examined Worker 50c688c9, not this version; this version’s changes were not re-reviewed. The findings below are the re-reviews’; their fix status is as reported by the site maintainer.</p>',
    `Report e48d0a96… · Deployment match: partial · ${link(RETEST_REPORT)}report.md ↗</a>`,'Audit 519db624… · Deployment match: not assessed by the audit · no report file published'])
    assert.ok(html.includes(part),part);
  for(const part of ['重新審查（2026-09-29，UTC）','Worker 50c688c9（原始碼 2da46cd，公開快照 b6e986b，bundle 14584fe4…，由 Report 重建）',
    '兩次重新審查看的是 Worker 50c688c9，不是目前版本；目前版本的變更沒有經過重新審查。','Report（重測） e48d0a96… · 部署對照：partial（部分驗證）','Audit（審查） 519db624… · 部署對照：此審查未評估 · 沒有發布報告檔'])
    assert.ok(z.includes(part),part);
  // After the review's own findings, and still inside the collapsed block.
  assert.ok(html.indexOf('Re-reviews (')>html.indexOf('F-8 · Info')&&html.indexOf('A-8 · Low')<html.indexOf('</details>'));
  const [,w,a]=lists(html),[,zw,za]=lists(z);
  assert.deepEqual([w.length,a.length],[3,8]);
  assert.match(w[0],/^W-1 · Info — An expired session still counted as owner for a local move\. Fixed in this version: .*Still: a “Log out all devices” elsewhere reaches this page on its next read\.$/);
  assert.match(w[2],/^W-3 · Info — .*a node failure is 503 .*only a revert, an EVM halt the contract causes or a wrong answer is a bad signature \(401\)/);
  assert.match(a[0],/^A-1 · Medium \(availability\) — .*Improved in this version: junk from a few other networks no longer holds a smart wallet.*while the location’s 20 such checks a minute last\. Still: junk from the wallet’s own \/24 \(or \/48\) can hold it, and so can at least 9 \/24s aimed at 3 or more addresses every minute at one location \(partly open\)\.$/);
  assert.match(a[5],/^A-6 · Low \(availability\) — .*Partly fixed in this version: .*Still: two IPs in one \/24 \(or \/48\) can spend that network’s 30 challenges a minute.*\(partly open\)\.$/);
  assert.match(a[6],/^A-7 · Low \(availability\) — .*Improved in this version: 20 of every 60 challenges per 6 s .*Still: 14 \/24s at full rate plus about 200 other networks a minute can close new sign-ins while they keep going; browsing is unaffected \(partly open\)\.$/);
  // A-2: the kept index answer is in D1 now, so every instance has it (the cross-instance test in tests/ownership).
  assert.match(a[1],/^A-2 · Low \(availability\) — .*Fixed in this version: a refused or failed index read falls back to the last index answer, now kept in the database so every server instance has it, and ownerOf proves those seats again\. Still: a seat bought after both IMD’s roster and the index last listed it appears on a later check, and an answer is kept for 8 days\.$/);
  assert.match(za[1],/此版本已修正：索引查詢被拒或失敗時，改用上一次的索引答案；這份答案現在存在資料庫裡，每個伺服器執行個體都讀得到.*仍存在：.*答案保留 8 天。$/);
  assert.doesNotMatch(a[1]+za[1],/partly open|未完全解決|only by the server instance/);
  assert.match(a[7],/^A-8 · Low — A refused on-chain check was shown as “Checked on chain: this wallet holds no IMD seat right now”\. Fixed in this version: when the check could not be completed, the page says so .*no longer says the chain was checked/);
  // Every status is the team's, for this version; a residual is said where one stays (both languages).
  for(const s of [...w,...a])assert.match(s.split(' — ')[1],/\. (Fixed|Partly fixed|Improved) in this version( \(wording\))?: /,s);
  for(const s of [...zw,...za])assert.match(s,/。此版本(已修正|部分修正|已改善)/,s);
  for(const i of [0,1,3,4,5,6])assert.match(a[i],/ Still: /,'A-'+(i+1));
  for(const i of [0,1,3,4,5,6])assert.match(za[i],/仍存在：/,'A-'+(i+1));
  for(const i of [0,5,6])assert.match(za[i],/未完全解決/,'A-'+(i+1));
  for(const i of [0,5,6])assert.match(a[i],/\(partly open\)\.$/,'A-'+(i+1));
  // A status quotes only what the page really shows (「…」, “…”): every quoted piece is a string in the wallet UI.
  const {readFileSync}=await import('node:fs'),ui=['walletView.ts','auth.ts','WalletPanel.tsx'].map(f=>readFileSync(new URL('../src/world/'+f,import.meta.url),'utf8')).join('\n');
  const quoted=[...FINDINGS,...REVIEW_RECORD.rereviews.flatMap(r=>r.findings)].flatMap(f=>[...f.status.zh.matchAll(/「([^」]+)」/g),...f.status.en.matchAll(/“([^”]+)”/g)].map(m=>[f.id,m[1]]));
  assert.ok(quoted.length>0);
  for(const [id,q] of quoted)assert.ok(ui.includes(q),id+' quotes text the page does not show: '+q);
  assert.doesNotMatch(text(html)+text(z),FORBIDDEN);
});

test('My wallet shows the record in every state, before sign-in too, and no longer the old one-line link',async()=>{
  const {readFileSync}=await import('node:fs');
  const panel=readFileSync(new URL('../src/world/WalletPanel.tsx',import.meta.url),'utf8');
  const at=panel.indexOf('<AuditRecord say={say}/>');
  assert.ok(at>0&&panel.indexOf('</div>;',at)-at<40,'the last child of the panel, outside every state condition');
  assert.doesNotMatch(panel,/reviewLink|reviewNote|Security review record/);
});

// docs/security/AUDIT_REMEDIATION_STATUS.md is driven by the same data: it must state each finding's severity and the
// site's status line word for word, carry none of the forbidden words, no local path, email or wallet address, and name
// only regression tests that exist.
test('the remediation status doc agrees with the site’s record, names only real tests, and carries no forbidden word or personal detail',async()=>{
  const {readFileSync}=await import('node:fs'),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
  const doc=read('docs/security/AUDIT_REMEDIATION_STATUS.md').replace(/\r\n/g,'\n');   // a Windows checkout (core.autocrlf) gives CRLF
  for(const f of FINDINGS){
    const row=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| '+f.id+' |'));
    assert.ok(row,f.id+' has a row');
    assert.equal(row,`| ${f.id} | ${f.severity}${f.area?' ('+f.area.en+')':''} | ${f.status.en} |`,f.id);
    assert.ok(doc.includes('## '+f.id+' — '),f.id+' has its section');
  }
  for(const v of [REVIEW_RECORD.worker,REVIEW_RECORD.commit,REVIEW_RECORD.bundle,REVIEW_RECORD.date,REVIEW_RECORD.jobUrl,REVIEW_RECORD.reportUrl,'| Deployment match (review) | partial |'])assert.ok(doc.includes(v),v);
  // The re-reviews: the header row names both and the version they examined; each has its section, its job (and report,
  // if any), and every finding a row with its severity, the site's status word for word, its fix commit, a test that
  // exists under that id in the named file, and its state.
  const head=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| Re-review |'));
  for(const v of [REREVIEWED.worker,REREVIEWED.commit,REREVIEWED.bundle,'`e48d0a96`','`519db624`','deployment match partial','deployment match not assessed',"this version's changes were not re-reviewed"])assert.ok(head.includes(v),'Re-review row: '+v);
  for(const r of REVIEW_RECORD.rereviews){
    assert.ok(doc.includes('## Swarm '+(r.kind==='Report'?'retest ':'audit ')+r.job.slice(0,8)+' (2026-09-29)'),r.job);
    for(const u of [r.jobUrl,r.reportUrl].filter(Boolean))assert.ok(doc.includes(u),u);
    for(const f of r.findings){
      const row=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| '+f.id+' |'));assert.ok(row,f.id+' has a row');
      const m=row.match(/^\| ([AW]-\d) \| ([^|]+) \| ([^|]+) \| (`[0-9a-f]{7}`(?:, `[0-9a-f]{7}`)*) \| ((?:`tests\/[\w.-]+` "[AW]-\d: …"(?:, )?)+) \| ([^|]+) \|$/);
      assert.ok(m,f.id+': '+row);
      assert.deepEqual([m[2],m[3]],[f.severity+(f.area?' ('+f.area.en+')':''),f.status.en],f.id);
      // Both re-reviews' fixes are deployed, as the team's deployment record lists them: the Report's in c89f5915, the audit's in 1a0dd495.
      assert.equal(m[6],r.kind==='Report'?"deployed in `c89f5915` (the team's deployment record)":"deployed in `1a0dd495` (the team's deployment record)",f.id);
      for(const [,file,id] of m[5].matchAll(/`(tests\/[\w.-]+)` "([AW]-\d): …"/g)){assert.equal(id,f.id);assert.ok(read(file).includes("test('"+id+': '),`${f.id}: ${file}`);}
    }
  }
  // Every audit finding has its own block (Codex remediation plan §14 A and D): a heading with the site's title and label,
  // then the old and the new behavior, the abuse that no longer works, what remains ("none known" where the site names no
  // residual), the files changed and the tests, each once; every test it names exists, by the start of its name, in the
  // file named before it, and one of them carries the finding's id.
  const named=text=>{let file=null;const out=[];
    for(const [,f,name] of text.matchAll(/`(tests\/[\w.-]+)`|"([^"]+?)…"/g)){if(f){file=f;continue;}
      assert.ok(file,'a test name before any file: '+name);assert.ok(read(file).replace(/\\'/g,"'").includes("test('"+name),file+': '+name);out.push(name);}
    return out;};
  for(const f of REVIEW_RECORD.rereviews.find(r=>r.kind==='Audit').findings){
    const label=f.status.en.match(/^(Fixed|Partly fixed|Improved) in this version/)[1]+(/\(partly open\)\.$/.test(f.status.en)?' (partly open)':'');
    const head=`### ${f.id} — ${f.title.en} · ${label}`,at=doc.indexOf('\n'+head+'\n');assert.ok(at>0,head);
    const block=doc.slice(at+1,doc.indexOf('\n#',at+1)).replace(/\s+/g,' ');
    for(const field of ['Old behavior','New behavior','Abuse prevented','Remaining trade-off','Files changed','Tests'])
      assert.equal(block.split('- **'+field+':** ').length-1,1,f.id+': '+field);
    if(!/ Still: /.test(f.status.en))assert.ok(block.includes('- **Remaining trade-off:** none known.'),f.id+': none known');
    const names=named(block.slice(block.indexOf('- **Tests:** ')));assert.ok(names.some(n=>n.startsWith(f.id+': ')),f.id+': its own test');
  }
  // The Codex plans' suggested test names map to tests that exist.
  const map=doc.slice(doc.indexOf("### The Codex plans' test names"),doc.indexOf('\n## ',doc.indexOf("### The Codex plans' test names")));
  assert.equal(named(map).length,15,'every suggested name is mapped');
  // Evidence pages and the Mint boundary page the doc names exist.
  const {existsSync}=await import('node:fs'),pages=[...doc.matchAll(/`(docs\/security\/[\w./-]+\.md)`/g)].map(m=>m[1]);
  assert.ok(pages.includes('docs/security/deploy-evidence/20260929T172429Z-5398b90.md')&&pages.includes('docs/security/MINT_BOUNDARY.md'));
  for(const page of pages)assert.ok(existsSync(new URL('../'+page,import.meta.url)),page);
  const flat=doc.replace(/\s+/g,' ');
  assert.ok(flat.includes("Production facts on this page (which Worker version runs and when it was deployed, the D1 migrations applied remotely, the limiter bindings and their namespaces, the WAF rule, the secrets such as `ALCHEMY_API_KEY`, and the log sampling) are the site maintainer's deployment record. No review could read them and this page does not verify them."));
  assert.ok(flat.includes('It found no asset-transfer path (no approval, no transaction) and no session-forgery or ownership-forgery path'));
  assert.ok(flat.includes('It did not verify the live deployment, the Cloudflare bindings, WAF or upload handling, real wallets or browsers, the production RPC, the front-end code not in the snapshot, or a Worker rebuild.'));
  assert.equal(doc.match(/Deployment version:\*\* (pending — filled in at deploy|[0-9a-f]{8} \(source [0-9a-f]{7}, deployed \d{4}-\d\d-\d\d \d\d:\d\d UTC\))\./g).length,8,'every finding names its deployment version, or says it is pending');
  for(const field of ['Finding','Old behavior','Fix','Files changed','Tests added','Test command','Result','Deployment version','Residual risk'])
    assert.ok(doc.split('**'+field).length-1>=7,field+' in every finding (F-8 folds some into one line)');
  assert.doesNotMatch(doc,FORBIDDEN);
  assert.doesNotMatch(doc,/[A-Za-z]:[\\/]Users|\/home\/|@[a-z0-9-]+\.(com|net|org|io)\b|0x[0-9a-fA-F]{40}/i,'no local path, email or wallet address [REDACTED-INTERNAL]');
  // The regression-test map: every row names a test that exists, by its exact name, in that file.
  const rows=[...doc.matchAll(/^\| (\d) \| [^|]+ \| `(tests\/[\w.-]+)` \| (.+) \|$/gm)];
  assert.deepEqual([...new Set(rows.map(r=>r[1]))],['1','2','3','4','5','6','7'],'items 1-7 of §7A');
  for(const [,n,file,name] of rows){const src=read(file).replace(/\\'/g,"'");assert.ok(src.includes("test('"+name+"'"),`#${n} ${file}: ${name}`);}
  assert.ok(doc.includes('未來 Mint 如果沿用 World session，不應直接把 World 的登入 session 當成「使用者已授權 Mint」。'),'the Genesis reminder, quoted');
});

// Swarm retest e48d0a96 §17, §20 and §25 (the retest plan's optional same-origin-mint-boundary-doc-check): the boundary a
// later Mint page on this origin starts from is written down, linked from the status doc and DESIGN_W1, and claims
// nothing about a Mint.
test('the future Mint boundary is written down: G-1..G-3 and the S-2 checklist, linked from the docs, claiming nothing about a Mint',async()=>{
  const {readFileSync}=await import('node:fs'),read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  const mint=read('docs/security/MINT_BOUNDARY.md'),flat=mint.replace(/\s+/g,' ');
  assert.ok(mint.startsWith("# Future Mint boundary (outside World's scope)\n"));
  for(const h of ['## G-1 — a World session is never a Mint authorization','## G-2 — re-evaluate for Mint what World accepts','## G-3 — changes a Mint brings are reviewed separately','## S-2 — same-origin Mint checklist'])
    assert.ok(mint.includes('\n'+h+'\n'),h);
  for(const part of ['**SIWE relay (S-1','**Contracts that accept any signature (F-2):**','**Eligibility:**','its own authorization design and its own confirmation step',
    'must not treat a live World session as that consent','reviewed on its own, together with the Mint, before it ships'])assert.ok(flat.includes(part),part);
  assert.deepEqual([...mint.matchAll(/^- \[ \] (.+)$/gm)].map(m=>m[1]),['Mint-specific authorization','contract address','chain ID','transaction parameters','approvals','Permit / Permit2',
    'transaction simulation','recipient','amount / quantity','replay','smart-contract wallet behavior','session reuse','same-origin cookie exposure','CSP changes']);
  for(const part of ["nothing here reviews or changes the Mint's code",'they say nothing about a Mint','Mint needs its own dedicated review before it goes live'])assert.ok(flat.includes(part),part);
  assert.ok(!mint.includes('```'),'no code');
  assert.doesNotMatch(mint,FORBIDDEN);assert.doesNotMatch(mint,/[A-Za-z]:[\\/]Users|\/home\/|@[a-z0-9-]+\.(com|net|org|io)\b|0x[0-9a-fA-F]{40}/i,'no local path, email or wallet address [REDACTED-INTERNAL]');
  for(const doc of ['docs/security/AUDIT_REMEDIATION_STATUS.md','docs/wallet-login/DESIGN_W1_v001.md'])assert.ok(read(doc).includes('`docs/security/MINT_BOUNDARY.md`'),doc+' links it');
});
