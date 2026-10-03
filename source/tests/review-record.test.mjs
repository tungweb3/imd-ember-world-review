import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuditRecord} from '../src/world/auditRecord.ts';
import {REVIEW_RECORD,FINDINGS,REREVIEWED,REVIEWED_LATER,REVIEWED_BBF,REVIEW_CHANGED} from '../src/world/reviewRecord.ts';
// The Swarm Audit Record in "My wallet" (remediation 2026-09-29 §6), rendered to the markup the page shows: collapsed,
// the reviewed scope, version, date, job and report (new tab, no referrer, no opener), the deployment match, the
// "previous review" label, that it applies to that version only, and every finding with its severity and status; then
// the two re-reviews of Worker 50c688c9, the later review of Worker 1a0dd495 and the two reviews of Worker bbf24001, each
// with its own findings.
const zh=(a)=>a,en=(a,b)=>b,render=say=>renderToStaticMarkup(createElement(AuditRecord,{say}));
const JOB='https://explorer.imd.fun/jobs/4bd31cfb-1151-497f-9b27-40e668dea372';
const REPORT='https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md';
const RETEST_JOB='https://explorer.imd.fun/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad',AUDIT_JOB='https://explorer.imd.fun/jobs/519db624-a82f-4dfe-91b9-1a519d1d3dd1';
const RETEST_REPORT='https://github.com/Identity-md/research/blob/main/jobs/e48d0a96-d3a5-42bb-859f-e0b0707fd9ad/files/artifacts/report.md';
const AUDIT3_JOB='https://explorer.imd.fun/jobs/8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b';
const AUDIT3_REPORT='https://github.com/Identity-md/research/blob/main/jobs/8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b/files/AUDIT.md';
const REPORT4_JOB='https://explorer.imd.fun/jobs/dcf922ca-68de-4cc5-bfbc-8b226008b0bf',AUDIT4_JOB='https://explorer.imd.fun/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82';
const REPORT4_REPORT='https://github.com/Identity-md/research/blob/main/jobs/dcf922ca-68de-4cc5-bfbc-8b226008b0bf/files/artifacts/report.md';
const AUDIT4_REPORT='https://github.com/Identity-md/research/blob/main/jobs/1ef8e8a6-4297-4ff8-b869-2d9b91445d82/files/AUDIT.md';
const link=href=>`<a href="${href}" target="_blank" rel="noreferrer noopener">`;
/** The <li> texts of the n-th list: 0 the review's findings, 1 the Report's, 2 the audit's, 3 the later audit's, 4 Report
 *  dcf922ca's and 5 audit 1ef8e8a6's (the reviews of Worker bbf24001). */
const lists=html=>[...html.matchAll(/<ul>(.*?)<\/ul>/g)].map(m=>[...m[1].matchAll(/<li>(.*?)<\/li>/g)].map(x=>text(x[1])));
/** The words the remediation forbids in the UI and docs (§6), "certified" / an audited-by badge in any form, and the
 *  claim words of the public-wording rule: safe, secure, audited, official, 已審計, 保證, 官方, and their -ly / -r / -st
 *  forms (safely, safer, safest, securely, officially). Not claims, so not matched: "unofficial" / 非官方 (the site's
 *  own statement), the cookie attribute Secure after HttpOnly, and the name of the Gnosis Safe wallet. */
export const FORBIDDEN=/security certified|officially audited|100% safe|guaranteed secure|certif|audited[- ]by|badge|已認證|認證|保證安全|安全無虞|徽章|(?<!Gnosis )\bsafe(?:ly|r|st)?\b|(?<!HttpOnly, )\bsecure(?:ly)?\b|\baudited\b|\bofficial(?:ly)?\b|已審計|保證|(?<!非)官方/i;
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"');

test('the Swarm Audit Record is a collapsed block naming scope, reviewed version, date, deployment match and the previous-review label',()=>{
  const html=render(en),t=text(html);
  assert.match(html,/^<details class="audit-record"><summary>Swarm Audit Record<\/summary>/,'collapsed (no open attribute), titled as the remediation names it');
  for(const part of ['Previous review — current version has changed','Reviewed scope','Wallet sign-in &amp; home authorization (World-only)',
    'Worker beac62be (source 0def8cb, bundle 4ec73351…)','2026-09-28 (UTC)','Deployment match</dt><dd>partial</dd>','This record applies to the reviewed version only.',
    `Re-review</dt><dd>${link(RETEST_JOB)}Report e48d0a96… ↗</a> · ${link(AUDIT_JOB)}Audit 519db624… ↗</a></dd>`,'Findings (from the review) · fix status as reported by the site maintainer, not re-reviewed',
    `Later review</dt><dd>${link(AUDIT3_JOB)}Audit 8c3aea2e… ↗</a></dd>`,
    `Reviews of Worker bbf24001</dt><dd>${link(REPORT4_JOB)}Report dcf922ca… ↗</a> · ${link(AUDIT4_JOB)}Audit 1ef8e8a6… ↗</a></dd>`])
    assert.ok(html.includes(part),part);
  const z=render(zh);
  for(const part of ['<summary>審查紀錄</summary>','先前的審查 — 目前版本已變更','錢包登入與我家權限（僅 World）','2026-09-28（UTC）','此紀錄只適用於受審查的版本。',
    'Worker beac62be（原始碼 0def8cb，bundle 4ec73351…）','部署對照</dt><dd>partial（部分驗證）</dd>','審查任務','發現（出自審查）· 修正狀態為 本站維護者自行說明，尚未重新審查',
    `重新審查</dt><dd>${link(RETEST_JOB)}Report（重測） e48d0a96… ↗</a> · ${link(AUDIT_JOB)}Audit（審查） 519db624… ↗</a></dd>`,
    `之後的審查</dt><dd>${link(AUDIT3_JOB)}Audit（審查） 8c3aea2e… ↗</a></dd>`,
    `Worker bbf24001 的審查</dt><dd>${link(REPORT4_JOB)}Report（重測） dcf922ca… ↗</a> · ${link(AUDIT4_JOB)}Audit（審查） 1ef8e8a6… ↗</a></dd>`])assert.ok(z.includes(part),part);
  // The statuses below are the team's own account: the heading says so, after the line that the record is of the reviewed version.
  assert.ok(html.indexOf('This record applies')<html.indexOf('as reported by the site maintainer, not re-reviewed')&&html.indexOf('not re-reviewed')<html.indexOf('<li>'));
  assert.equal(REVIEW_RECORD.rereview,undefined,'the one-field form is gone');
  assert.doesNotMatch(t+text(z),FORBIDDEN);
  // The guard reaches every claim word a status or summary could make, and none of the exempt technical uses.
  for(const bad of ['This version is safe.','Our sign-in is secure.','The site was audited.','the official IMD world','已審計','保證可用','官方紀錄',
    'The officially reviewed version.','You can sign in safely.','Cookies are stored securely.','It is safer now.','the safest wallet'])assert.match(bad,FORBIDDEN,bad);
  for(const ok of ['an unofficial community project','非官方、社群自行推動','HttpOnly, Secure, SameSite=Lax','a Gnosis Safe wallet','unaudited code'])assert.doesNotMatch(ok,FORBIDDEN,ok);
  assert.deepEqual([REVIEW_RECORD.worker,REVIEW_RECORD.commit,REVIEW_RECORD.date,REVIEW_RECORD.match,REVIEW_RECORD.bundle],
    ['beac62be','0def8cb','2026-09-28','partial','4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3']);
});

test('its job and report links open the real pages in a new tab with no referrer and no opener',()=>{
  const links=[...render(en).matchAll(/<a ([^>]*)>/g)].map(m=>m[1]);
  assert.deepEqual(links,[JOB,REPORT,RETEST_JOB,AUDIT_JOB,AUDIT3_JOB,REPORT4_JOB,AUDIT4_JOB,RETEST_REPORT,AUDIT3_REPORT,REPORT4_REPORT,AUDIT4_REPORT].map(u=>`href="${u}" target="_blank" rel="noreferrer noopener"`),
    'the review’s job and report, the two re-review jobs, the later audit’s job, the jobs of the two reviews of bbf24001, the one re-review report there is (the audit published none), the later audit’s report, and the Report’s and the audit’s of bbf24001');
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
  // A-1 and A-6 after N-4 / N-5 (the later audit): an IPv6 /48 has two lanes per address and 60 challenges a minute.
  assert.match(a[0],/each network still gets one check of it a minute \(an IPv6 \/48 two, from two of its \/64s\), which the owner’s own earlier attempt doesn’t use up/);
  assert.match(a[5],/^A-6 · Low \(availability\) — .*Partly fixed in this version: .*Still: two IPs in one \/24 can spend that network’s 30 challenges a minute \(an IPv6 \/48 has 60, which three of its \/64s can spend\).*\(partly open\)\.$/);
  assert.match(za[5],/仍存在：同一個 \/24 裡兩個 IP 就能用完該網段每分鐘 30 個 challenge（IPv6 \/48 每分鐘 60 個，其中三個 \/64 就能用完）/);
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
  const quoted=[...FINDINGS,...[...REVIEW_RECORD.rereviews,...REVIEW_RECORD.later,...REVIEW_RECORD.bbf].flatMap(r=>r.findings)].flatMap(f=>[...f.status.zh.matchAll(/「([^」]+)」/g),...f.status.en.matchAll(/“([^”]+)”/g)].map(m=>[f.id,m[1]]));
  assert.ok(quoted.length>0);
  for(const [id,q] of quoted)assert.ok(ui.includes(q),id+' quotes text the page does not show: '+q);
  assert.doesNotMatch(text(html)+text(z),FORBIDDEN);
});

// The later review of Worker 1a0dd495 (Swarm audit 8c3aea2e, 2026-09-30 UTC; report AUDIT.md, no deployment-match verdict;
// one of its reviewers rebuilt the bundle from snapshot ae1d41a): its findings N-1..N-7 as it rated them and the team's
// status for this version, after the re-reviews, under a line saying plainly that this version was not re-reviewed.
test('the later review of Worker 1a0dd495 is listed with its findings N-1..N-7, and the page says this version was not re-reviewed',()=>{
  assert.deepEqual({...REVIEWED_LATER},{worker:'1a0dd495',commit:'4321bb4',snapshot:'ae1d41a',bundle:'1018f02a98ccb7de5b91434613d5e38047925a463df8d892b6cd9439d9a2078c',date:'2026-09-30'});
  assert.deepEqual(REVIEW_RECORD.later.map(r=>[r.job,r.kind,r.match,r.jobUrl,r.reportUrl]),[['8c3aea2e-26bc-4bff-bf5d-52d10f79ec9b','Audit',null,AUDIT3_JOB,AUDIT3_REPORT]]);
  assert.deepEqual(REVIEW_RECORD.later.map(r=>r.findings.map(f=>f.id+' '+f.severity)),[['N-1 Low','N-2 Low','N-3 Low','N-4 Low','N-5 Low','N-6 Low','N-7 Info']]);
  assert.equal(REVIEW_CHANGED,true);
  const html=render(en),z=render(zh);
  for(const part of ['<p class="small-note audit-head">Later review (2026-09-30, UTC)</p>',
    '<dt>Reviewed version</dt><dd>Worker 1a0dd495 (source 4321bb4, public snapshot ae1d41a, bundle 1018f02a… as a reviewer rebuilt it)</dd>',
    '<p class="small-note audit-changed">This review examined Worker 1a0dd495, not this version; this version’s changes were not re-reviewed. The findings below are the review’s; their fix status is as reported by the site maintainer.</p>',
    `Audit 8c3aea2e… · Deployment match: not assessed by the audit · ${link(AUDIT3_REPORT)}AUDIT.md ↗</a>`])assert.ok(html.includes(part),part);
  for(const part of ['之後的審查（2026-09-30，UTC）','Worker 1a0dd495（原始碼 4321bb4，公開快照 ae1d41a，bundle 1018f02a…，由審查者重建）',
    '這次審查看的是 Worker 1a0dd495，不是目前版本；目前版本的變更沒有經過重新審查。',`Audit（審查） 8c3aea2e… · 部署對照：此審查未評估 · ${link(AUDIT3_REPORT)}AUDIT.md ↗</a>`])
    assert.ok(z.includes(part),part);
  // After the re-reviews' findings, and still inside the collapsed block.
  assert.ok(html.indexOf('Later review (')>html.indexOf('A-8 · Low')&&html.indexOf('N-7 · Info')<html.indexOf('</details>'));
  assert.equal(lists(html).length,6,'its list is the fourth; the reviews of Worker bbf24001 follow with two more');
  const n=lists(html)[3],zn=lists(z)[3];assert.deepEqual([n.length,zn.length],[7,7]);
  assert.match(n[0],/^N-1 · Low — An older session read could erase the owner state a newer one had set\. Fixed in this version: only the newest session read is applied, its body and errors included/);
  assert.match(n[1],/^N-2 · Low — A cancelled sign-in could still ask the old account to sign\. Fixed in this version: .*a cancelled flow asks nothing\. Still: a wallet window already open can’t be closed by the page; its answer is dropped\.$/);
  assert.match(n[2],/^N-3 · Low \(availability\) — .*seats that count \(online now, or seen under this owner in the last 24 hours\) are checked first, and a cut list is still marked as incomplete\. Still: seats past the cap are not listed\.$/);
  assert.match(n[3],/^N-4 · Low \(availability\) — .*the owner’s own earlier attempt no longer uses it up, and a retry or a second device gets through\. Still: junk from the wallet’s own network can hold it, as for A-1\.$/);
  assert.match(n[4],/^N-5 · Low \(availability\) — .*Improved in this version: an IPv6 \/48 gets twice a \/24’s sign-in shares, and each \/64 in it at most one \/24’s share of smart-wallet checks, counted by the \/64 that asked for the challenge\. Still: someone holding two or more \/64s of a shared \/48 can spend its shares.*\(partly open\)\.$/);
  assert.match(n[5],/^N-6 · Low \(availability\) — .*Improved in this version: .*one IP no longer keeps a new buyer’s seat from being found; ownerOf still proves every seat\. Still: 20 other networks at one location every minute can keep it refused while they go on \(partly open\)\.$/);
  // N-7 quotes the page's own two sentences (the quote check of the previous test holds it to that) and never names
  // another device: AUTH_REQUIRED alone says nothing about where the sign-out came from.
  assert.match(n[6],/^N-7 · Info — A sign-in revoked elsewhere was shown as an expired session\. Fixed in this version: a sign-in the server no longer accepts reads “You are no longer signed in\. Please sign in again\.”, and “Your sign-in has expired\. Please sign in again\.” only when it ran out\. Still: /);
  assert.match(zn[6],/此版本已修正：伺服器已不承認的登入顯示「登入狀態已失效，請重新登入。」；只有登入真的到期時才顯示「登入已到期，請重新登入。」。仍存在：/);
  assert.doesNotMatch(n[6]+zn[6],/another device|其他裝置/);
  // Every status is the team's, for this version, with a residual where one stays; only N-5 and N-6 are partly open.
  for(const s of n)assert.match(s.split(' — ')[1],/\. (Fixed|Improved) in this version: /,s);
  for(const s of zn)assert.match(s,/。此版本(已修正|已改善)：/,s);
  assert.deepEqual([n.map(s=>/ Still: /.test(s)),zn.map(s=>/仍存在：/.test(s))],[[false,true,true,true,true,true,true],[false,true,true,true,true,true,true]]);
  assert.deepEqual([n.map(s=>/\(partly open\)\.$/.test(s)),zn.map(s=>/（未完全解決）。$/.test(s))],[[false,false,false,false,true,true,false],[false,false,false,false,true,true,false]]);
  assert.doesNotMatch(text(html)+text(z),FORBIDDEN);
});

// The two reviews of Worker bbf24001 (2026-10-01 UTC): Swarm Report dcf922ca (a limited retest, report.md, deployment
// match partial, the bundle it rebuilt from snapshot 8cad017) and Swarm audit 1ef8e8a6 (AUDIT.md, no deployment-match
// verdict), with their findings under the ids of the owner's handoff (R3-R1, AUD3-01..AUD3-09) as the reviews rated them,
// and the team's status for this version, after the later review, under a line saying plainly that this version was not
// re-reviewed. AUD3-09 is the audit's review record: listed as such, with nothing fixed.
test('the two reviews of Worker bbf24001 are listed with R3-R1 and AUD3-01..AUD3-09, and the page says this version was not re-reviewed',()=>{
  assert.deepEqual({...REVIEWED_BBF},{worker:'bbf24001',commit:'2e4e830',snapshot:'8cad017',bundle:'018df7b35117bf612cd9311a800de75964b07f9d74f2c2f1ae545b26894cf62c',date:'2026-10-01'});
  assert.deepEqual(REVIEW_RECORD.bbf.map(r=>[r.job,r.kind,r.match,r.jobUrl,r.reportUrl]),
    [['dcf922ca-68de-4cc5-bfbc-8b226008b0bf','Report','partial',REPORT4_JOB,REPORT4_REPORT],['1ef8e8a6-4297-4ff8-b869-2d9b91445d82','Audit',null,AUDIT4_JOB,AUDIT4_REPORT]]);
  // The Report's one new finding (Low); the audit's "3 low · 6 info", the ninth its review record.
  assert.deepEqual(REVIEW_RECORD.bbf.map(r=>r.findings.map(f=>f.id+' '+f.severity+(f.area?' '+f.area.en:''))),
    [['R3-R1 Low'],['AUD3-01 Low availability','AUD3-02 Low availability','AUD3-03 Low availability','AUD3-04 Info','AUD3-05 Info','AUD3-06 Info availability','AUD3-07 Info','AUD3-08 Info hardening','AUD3-09 Info']]);
  assert.equal(REVIEW_CHANGED,true);
  const html=render(en),z=render(zh);
  for(const part of ['<p class="small-note audit-head">Reviews of Worker bbf24001 (2026-10-01, UTC)</p>',
    '<dt>Reviewed version</dt><dd>Worker bbf24001 (source 2e4e830, public snapshot 8cad017, bundle 018df7b3… as the Report rebuilt it)</dd>',
    '<p class="small-note audit-changed">Both reviews examined Worker bbf24001, not this version; this version’s changes were not re-reviewed. The findings below are the reviews’; their fix status is as reported by the site maintainer.</p>',
    `Report dcf922ca… · Deployment match: partial · ${link(REPORT4_REPORT)}report.md ↗</a>`,`Audit 1ef8e8a6… · Deployment match: not assessed by the audit · ${link(AUDIT4_REPORT)}AUDIT.md ↗</a>`])
    assert.ok(html.includes(part),part);
  for(const part of ['Worker bbf24001 的審查（2026-10-01，UTC）','Worker bbf24001（原始碼 2e4e830，公開快照 8cad017，bundle 018df7b3…，由 Report 重建）',
    '兩次審查看的是 Worker bbf24001，不是目前版本；目前版本的變更沒有經過重新審查。下列發現出自這兩次審查，修正狀態為 本站維護者自行說明。',
    `Report（重測） dcf922ca… · 部署對照：partial（部分驗證） · ${link(REPORT4_REPORT)}report.md ↗</a>`,`Audit（審查） 1ef8e8a6… · 部署對照：此審查未評估 · ${link(AUDIT4_REPORT)}AUDIT.md ↗</a>`])
    assert.ok(z.includes(part),part);
  // After the later review's findings, and still inside the collapsed block.
  assert.ok(html.indexOf('Reviews of Worker bbf24001 (')>html.indexOf('N-7 · Info')&&html.indexOf('AUD3-09 · Info')<html.indexOf('</details>'));
  const [,,,,r,a]=lists(html),[,,,,zr,za]=lists(z),all=[...r,...a],zall=[...zr,...za];
  assert.deepEqual([r.length,a.length,zr.length,za.length],[1,9,1,9]);
  assert.match(r[0],/^R3-R1 · Low — A wallet’s late connect answer could undo an account switch and ask the old account to sign\. Fixed in this version: .*the page keeps the account the wallet named last and ends that click: it asks the wallet nothing more and verifies nothing, and never opens a wallet window to recover; .*Still: this order of wallet events was reproduced with a test wallet, not with real wallets\.$/);
  assert.match(a[0],/^AUD3-01 · Low \(availability\) — .*the answer keeps the seats this request had already proven with ownerOf and is marked as a check not completed, never as owning nothing\. Still: the read was sent, so that network’s lane stays used for the minute\.$/);
  // AUD3-02 and AUD3-03 rest on how Cloudflare's limiter counts a refused call, which no one has checked: both say so.
  for(const i of [1,2])assert.match(a[i],/; this relies on a refused limit check costing nothing, not yet confirmed with Cloudflare( \(partly open\))?\.$/,'AUD3-0'+(i+1));
  for(const i of [1,2])assert.match(za[i],/這個做法假設被拒的限流檢查不計數，尚未向 Cloudflare 確認(（未完全解決）)?。$/,'AUD3-0'+(i+1));
  // AUD3-02 is fixed for the retry (31 s) and at the audit's 60 networks, but about 80 claims in one 6 s slice from one
  // location still fill the site-wide ceiling: partly fixed, and the site says how many.
  assert.match(a[1],/^AUD3-02 · Low \(availability\) — .*\. Partly fixed in this version: .*released: its network may claim again 30 s later, and the claim leaves the site-wide count at once\. Still: only 20 claims every 6 s are released site-wide; past that, or if a release fails, a claim holds its network for the minute as before, so about 80 claims within 6 s from one location \(60 before\) still fill the site-wide ceiling for every other location for those 6 s; /);
  assert.match(za[1],/。此版本部分修正：.*仍存在：全站每 6 秒只釋放 20 個預約.*同一據點 6 秒內約 80 個預約（以前是 60 個）仍會在那 6 秒佔滿全站上限、擋住其他據點；/);
  assert.doesNotMatch(a[1]+za[1],/counts for the minute|計滿一分鐘/,'a kept claim holds the site-wide count for its 6 s slice only');
  assert.match(a[2],/a smart-wallet check that never reached the chain is taken back.*the refused challenge stays used\. Still: a check that reached the chain counts whatever its answer/);
  // AUD3-04: the residual is a read whose answer reaches the page before the sign-out is confirmed (not one the server
  // answered before it: that is the reproduction, which the fix drops); the click's own logout ends its session even
  // after a wallet switch and is told to other tabs. AUD3-05 is partly fixed: the session the panel shows until a read
  // succeeds is what the audit expected the page to stop showing (ADV-4). AUD3-06 says the page waits for its own
  // sign-outs before a new sign-in asks anything, says so meanwhile, and names that sign-out when the wait runs out.
  assert.match(a[3],/^AUD3-04 · Info — .*no session or house read begun before it is applied, so “Signed out\.” stays; the ended sign-in leaves the page even if another wallet was chosen meanwhile, and other tabs are told\. Still: a read whose answer reaches the page before the sign-out is confirmed is shown until it is\.$/);
  assert.match(za[3],/仍存在：登出確認前已送達頁面的查詢結果，會先顯示到登出確認為止。$/);
  assert.doesNotMatch(a[3]+za[3],/a read the server answered before|伺服器已回覆的查詢/);
  assert.match(a[4],/^AUD3-05 · Info — .*\. Partly fixed in this version: .*never owner mode, and “Check again” can be pressed\. Still: until a session read succeeds, the panel keeps showing the earlier sign-in as signed in, without owner mode; the audit expected the page to stop showing it \(partly open\)\.$/);
  assert.match(za[4],/。此版本部分修正：.*也可以按「重新確認」。仍存在：在登入狀態讀取成功之前，面板仍把先前的登入顯示為已登入，但不會進入屋主模式；審查預期頁面不再這樣顯示（未完全解決）。$/);
  assert.match(a[5],/^AUD3-06 · Info \(availability\) — .*no longer clear the sign-in cookie.*the server still refuses the old one\. Before a new sign-in asks the wallet anything, the page waits for its own sign-outs to be answered \(at most 5 s, saying so meanwhile; past that it asks nothing and says that sign-out hasn’t been answered yet\), so they can’t delete that sign-in’s cookie either\. Still: an explicit sign-out whose answer arrives after another tab’s sign-in still signs that browser out/);
  assert.match(za[5],/新的登入向錢包要求任何東西之前，頁面會先等自己送出的登出得到回應（最多 5 秒，等候時會說明；逾時則不要求簽名，並說明先前的登出還沒有回應）.*仍存在：主動登出的回應若在另一個分頁登入之後才到/);
  assert.match(a[6],/^AUD3-07 · Info — .*the page says “Your sign-in has expired\. Please sign in again\.” and still that other devices were not signed out/);
  assert.match(a[7],/^AUD3-08 · Info \(hardening\) — .*Still: no real request was shown to reach this; /);
  assert.match(a[8],/^AUD3-09 · Info — Review record \(not a defect\): .*Record only, nothing to fix: .*the Report’s R3-R1 shows one for a connect still pending \(fixed in this version\)\./);
  assert.match(za[8],/^AUD3-09 · Info — 審查紀錄（不是缺陷）：.*。僅為紀錄，沒有要修正的項目：/);
  // Every status is the team's, for this version; every fix names what stays (both languages); only AUD3-02 and AUD3-05
  // are partly fixed and partly open; none claims a deployment (nothing of this round is deployed).
  const label=s=>s.split(' — ')[1].match(/\. (Fixed|Partly fixed|Improved) in this version: /)?.[1],zlabel=s=>s.match(/。此版本(已修正|部分修正|已改善)：/)?.[1];
  assert.deepEqual([all.slice(0,9).map(label),zall.slice(0,9).map(zlabel)],[['Fixed','Fixed','Partly fixed','Fixed','Fixed','Partly fixed','Fixed','Fixed','Fixed'],['已修正','已修正','部分修正','已修正','已修正','部分修正','已修正','已修正','已修正']]);
  assert.deepEqual([all.map(s=>/ Still: /.test(s)),zall.map(s=>/仍存在：/.test(s))],[[...Array(9).fill(true),false],[...Array(9).fill(true),false]]);
  const partly=Array.from({length:10},(_,i)=>i===2||i===5);
  assert.deepEqual([all.map(s=>/\(partly open\)\.$/.test(s)),zall.map(s=>/（未完全解決）。$/.test(s))],[partly,partly]);
  assert.doesNotMatch(all.join(' '),/\bdeployed\b/);
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
  // The later review (Swarm audit 8c3aea2e of Worker 1a0dd495): the header row names it, the version it examined and that
  // this branch was not re-reviewed; it has its section, job and report; every finding a row with the site's severity and
  // status word for word, its fix commit, a test that exists under that id in the named file, and its state: PARTIAL
  // where the site says partly open, else FIXED_LOCALLY, deployed in bbf24001 as the team's deployment record lists it.
  const laterRow=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| Later review |'));assert.ok(laterRow,'a Later review row');
  for(const v of [REVIEWED_LATER.worker,REVIEWED_LATER.commit,REVIEWED_LATER.snapshot,REVIEWED_LATER.bundle,REVIEWED_LATER.date,'`8c3aea2e`','these changes were not re-reviewed','`bbf24001`'])
    assert.ok(laterRow.includes(v),'Later review row: '+v);
  for(const r of REVIEW_RECORD.later){
    assert.ok(doc.includes('## Swarm audit '+r.job.slice(0,8)+' ('+REVIEWED_LATER.date+')'),r.job);
    for(const u of [r.jobUrl,r.reportUrl])assert.ok(doc.includes(u),u);
    for(const f of r.findings){
      const row=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| '+f.id+' |'));assert.ok(row,f.id+' has a row');
      const m=row.match(/^\| (N-\d) \| ([^|]+) \| ([^|]+) \| (`[0-9a-f]{7}`(?:, `[0-9a-f]{7}`)*) \| ((?:`tests\/[\w.-]+` "N-\d: …"(?:, )?)+) \| ([^|]+) \|$/);
      assert.ok(m,f.id+': '+row);
      assert.deepEqual([m[2],m[3]],[f.severity+(f.area?' ('+f.area.en+')':''),f.status.en],f.id);
      assert.equal(m[6],(/\(partly open\)\.$/.test(f.status.en)?'PARTIAL':'FIXED_LOCALLY')+": deployed in `bbf24001` (the team's deployment record)",f.id);
      for(const [,file,id] of m[5].matchAll(/`(tests\/[\w.-]+)` "(N-\d): …"/g)){assert.equal(id,f.id);assert.ok(read(file).includes("test('"+id+': '),`${f.id}: ${file}`);}
    }
  }
  // Every audit finding has its own block (Codex remediation plan §14 A and D): a heading with the site's title and label,
  // then the old and the new behavior, the abuse that no longer works, what remains ("none known" where the site names no
  // residual), the files changed and the tests, each once; every test it names exists, by the start of its name, in the
  // file named before it, and one of them carries the finding's id. The later audit's blocks also say the deployment
  // version: Worker bbf24001 (source 2e4e830), as the team's deployment record lists it.
  const named=text=>{let file=null;const out=[];
    for(const [,f,name] of text.matchAll(/`(tests\/[\w.-]+)`|"([^"]+?)…"/g)){if(f){file=f;continue;}
      assert.ok(file,'a test name before any file: '+name);assert.ok(read(file).replace(/\\'/g,"'").includes("test('"+name),file+': '+name);out.push(name);}
    return out;};
  const blocks=(findings,pending)=>{for(const f of findings){
    const label=f.status.en.match(/^(Fixed|Partly fixed|Improved) in this version/)[1]+(/\(partly open\)\.$/.test(f.status.en)?' (partly open)':'');
    const head=`### ${f.id} — ${f.title.en} · ${label}`,at=doc.indexOf('\n'+head+'\n');assert.ok(at>0,head);
    const block=doc.slice(at+1,doc.indexOf('\n#',at+1)).replace(/\s+/g,' ');
    for(const field of ['Old behavior','New behavior','Abuse prevented','Remaining trade-off','Files changed','Tests',...pending?['Deployment version']:[]])
      assert.equal(block.split('- **'+field+':** ').length-1,1,f.id+': '+field);
    if(pending)assert.ok(block.includes('- **Deployment version:** '+pending+'.'),f.id+': '+pending);
    if(!/ Still: /.test(f.status.en))assert.ok(block.includes('- **Remaining trade-off:** none known.'),f.id+': none known');
    const tests=block.slice(block.indexOf('- **Tests:** '),pending?block.indexOf('- **Deployment version:** '):undefined);
    assert.ok(named(tests).some(n=>n.startsWith(f.id+': ')),f.id+': its own test');
  }};
  blocks(REVIEW_RECORD.rereviews.find(r=>r.kind==='Audit').findings,false);
  blocks(REVIEW_RECORD.later.flatMap(r=>r.findings),'bbf24001 (source 2e4e830, deployed 2026-10-01 04:10 UTC)');
  // The two reviews of Worker bbf24001 (Swarm Report dcf922ca and Swarm audit 1ef8e8a6): a header row naming both, the
  // version they examined, that these fixes are deployed in 63c6c7bd (the team's deployment record) and not re-reviewed; their section with each job and
  // report, the two judgments side by side, the Report's 403s with the team's observation, the limiter assumption and
  // the states; every finding a row with the site's severity and status word for word, its fix commit, a test that exists
  // under that id in the named file, and its state (FIXED_LOCAL, or PARTIAL where the site says partly open, deployed in
  // 63c6c7bd; AUD3-09 RECORD_ONLY with no commit or test); a block per fix in the shape above with "Deployment version:
  // 63c6c7bd (source f36144a, …)"; AUD3-09's own heading; and the handoff's regression matrix T01..T41, every test it
  // names existing.
  const bbfRow=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| Reviews of Worker bbf24001 |'));assert.ok(bbfRow,'a Reviews of Worker bbf24001 row');
  for(const v of [REVIEWED_BBF.worker,REVIEWED_BBF.commit,REVIEWED_BBF.snapshot,REVIEWED_BBF.bundle,'`dcf922ca`','`1ef8e8a6`','deployment match partial','no deployment-match verdict',
    '`63c6c7bd`','these changes were not re-reviewed'])assert.ok(bbfRow.includes(v),'Reviews of Worker bbf24001 row: '+v);
  assert.ok(doc.includes('\n## Swarm reviews of Worker bbf24001 ('+REVIEWED_BBF.date+')\n'),'its section');
  for(const r of REVIEW_RECORD.bbf)for(const u of [r.jobUrl,r.reportUrl])assert.ok(doc.includes(u),u);
  const flatDoc=doc.replace(/\s+/g,' ');
  for(const part of ['**The two judgments, side by side.**','Cloudflare answers 403 to the Python-urllib User-Agent','**The limiter assumption (BLOCKED_EVIDENCE).**',
    "FIXED_LOCAL (the finding's reproduction tests failed on `f4272c5`","All of it is deployed in `63c6c7bd`"])assert.ok(flatDoc.includes(part),part);
  for(const f of REVIEW_RECORD.bbf.flatMap(r=>r.findings)){
    const row=doc.split(String.fromCharCode(10)).find(l=>l.startsWith('| '+f.id+' |'));assert.ok(row,f.id+' has a row');
    const m=row.match(/^\| (R3-R1|AUD3-0\d) \| ([^|]+) \| ([^|]+) \| (none|`[0-9a-f]{7}`(?:, `[0-9a-f]{7}`)*) \| (none|(?:`tests\/[\w.-]+` "(?:R3-R1|AUD3-0\d): …"(?:, )?)+) \| ([^|]+) \|$/);
    assert.ok(m,f.id+': '+row);
    assert.deepEqual([m[2],m[3]],[f.severity+(f.area?' ('+f.area.en+')':''),f.status.en],f.id);
    if(f.id==='AUD3-09'){assert.deepEqual([m[4],m[5],m[6]],['none','none','RECORD_ONLY']);continue;}
    assert.match(m[6],new RegExp('^'+(/\(partly open\)\.$/.test(f.status.en)?'PARTIAL':'FIXED_LOCAL')+": deployed in `63c6c7bd` \\(the team's deployment record"),f.id);
    for(const [,file,id] of m[5].matchAll(/`(tests\/[\w.-]+)` "(R3-R1|AUD3-0\d): …"/g)){assert.equal(id,f.id);assert.ok(read(file).includes("test('"+id+': '),`${f.id}: ${file}`);}
  }
  const fixes=REVIEW_RECORD.bbf.flatMap(r=>r.findings).filter(f=>f.id!=='AUD3-09');
  assert.equal(fixes.length,9);blocks(fixes,'63c6c7bd (source f36144a, deployed 2026-10-02 06:08 UTC)');
  const record=REVIEW_RECORD.bbf[1].findings.at(-1);
  assert.ok(doc.includes(`\n### ${record.id} — ${record.title.en} · Record only\n`),'AUD3-09 has its record-only heading');
  const matrix=doc.slice(doc.indexOf("### The handoff's regression matrix (T01..T41)"),doc.indexOf('\n## ',doc.indexOf("### The handoff's regression matrix (T01..T41)")));
  const cases=[...matrix.matchAll(/^\| (T\d\d)(?:–T(\d\d))? \|/gm)].flatMap(m=>{const a=+m[1].slice(1),b=m[2]?+m[2]:a;return Array.from({length:b-a+1},(_,i)=>a+i);});
  assert.deepEqual(cases,Array.from({length:41},(_,i)=>i+1),'every case T01..T41, in order');
  assert.ok(named(matrix).length>=40,'the matrix names the tests that hold its cases');
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
  assert.equal(doc.match(/Deployment version:\*\* (pending — filled in at deploy|[0-9a-f]{8} \(source [0-9a-f]{7}, deployed \d{4}-\d\d-\d\d \d\d:\d\d UTC\))\./g).length,24,
    'every finding names its deployment version, or says it is pending: F-1..F-8, N-1..N-7, R3-R1 and AUD3-01..AUD3-08');
  for(const field of ['Finding','Old behavior','Fix','Files changed','Tests added','Test command','Result','Deployment version','Residual risk'])
    assert.ok(doc.split('**'+field).length-1>=7,field+' in every finding (F-8 folds some into one line)');
  assert.doesNotMatch(doc,FORBIDDEN);
  const design=read('docs/wallet-login/DESIGN_W1_v001.md');assert.doesNotMatch(design.slice(design.indexOf('\n## 17. ')),FORBIDDEN,'DESIGN_W1 §17');
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
