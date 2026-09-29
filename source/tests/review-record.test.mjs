import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AuditRecord} from '../src/world/auditRecord.ts';
import {REVIEW_RECORD,FINDINGS} from '../src/world/reviewRecord.ts';
// The Swarm Audit Record in "My wallet" (remediation 2026-09-29 §6), rendered to the markup the page shows: collapsed,
// the reviewed scope, version, date, job and report (new tab, no referrer, no opener), the deployment match, the
// "previous review" label, that it applies to that version only, and every finding with its severity and status.
const zh=(a)=>a,en=(a,b)=>b,render=say=>renderToStaticMarkup(createElement(AuditRecord,{say}));
const JOB='https://explorer.imd.fun/jobs/4bd31cfb-1151-497f-9b27-40e668dea372';
const REPORT='https://github.com/Identity-md/research/blob/main/jobs/4bd31cfb-1151-497f-9b27-40e668dea372/files/artifacts/report.md';
/** The words the remediation forbids in the UI and docs (§6), and "certified" / an audited-by badge in any form. */
export const FORBIDDEN=/security certified|officially audited|100% safe|guaranteed secure|certif|audited[- ]by|badge|已認證|認證|保證安全|安全無虞|徽章/i;
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"');

test('the Swarm Audit Record is a collapsed block naming scope, reviewed version, date, deployment match and the previous-review label',()=>{
  const html=render(en),t=text(html);
  assert.match(html,/^<details class="audit-record"><summary>Swarm Audit Record<\/summary>/,'collapsed (no open attribute), titled as the remediation names it');
  for(const part of ['Previous review — current version has changed','Reviewed scope','Wallet sign-in &amp; home authorization (World-only)',
    'Worker beac62be (source 0def8cb, bundle 4ec73351…)','2026-09-28 (UTC)','Deployment match</dt><dd>partial</dd>','This record applies to the reviewed version only.',
    'Re-review</dt><dd>none yet</dd>','Findings (from the review) · fix status as reported by the IMD team, not re-reviewed'])
    assert.ok(html.includes(part),part);
  const z=render(zh);
  for(const part of ['<summary>審查紀錄</summary>','先前的審查 — 目前版本已變更','錢包登入與我家權限（僅 World）','2026-09-28（UTC）','此紀錄只適用於受審查的版本。',
    'Worker beac62be（原始碼 0def8cb，bundle 4ec73351…）','部署對照</dt><dd>partial（部分驗證）</dd>','審查任務','重新審查</dt><dd>尚未進行</dd>','發現（出自審查）· 修正狀態為 IMD 團隊自行說明，尚未重新審查'])assert.ok(z.includes(part),part);
  // The statuses below are the team's own account: the heading says so, after the line that the record is of the reviewed version.
  assert.ok(html.indexOf('This record applies')<html.indexOf('as reported by the IMD team, not re-reviewed')&&html.indexOf('not re-reviewed')<html.indexOf('<li>'));
  assert.equal(REVIEW_RECORD.rereview,null);
  assert.doesNotMatch(t+text(z),FORBIDDEN);
  assert.deepEqual([REVIEW_RECORD.worker,REVIEW_RECORD.commit,REVIEW_RECORD.date,REVIEW_RECORD.match,REVIEW_RECORD.bundle],
    ['beac62be','0def8cb','2026-09-28','partial','4ec73351afbcc9af133fd487d7e2d33c1df6713bfa1aced881f412d38e0eccf3']);
});

test('its job and report links open the real pages in a new tab with no referrer and no opener',()=>{
  const links=[...render(en).matchAll(/<a ([^>]*)>/g)].map(m=>m[1]);
  assert.deepEqual(links,[`href="${JOB}" target="_blank" rel="noreferrer noopener"`,`href="${REPORT}" target="_blank" rel="noreferrer noopener"`]);
});

test('every finding F-1..F-8 is listed with the report’s severity and an honest status, “open” where it is open',()=>{
  assert.deepEqual(FINDINGS.map(f=>[f.id,f.severity]),[['F-1','Medium'],['F-2','Low/Info'],['F-3','Low'],['F-4','Low'],['F-5','Low'],['F-6','Info'],['F-7','Info'],['F-8','Info']]);
  const items=[...render(en).matchAll(/<li>(.*?)<\/li>/g)].map(m=>text(m[1]));
  assert.equal(items.length,8);
  // F-1: in a relayed message the domain is the real one, so the advice names the address bar and the wallet's origin warning.
  assert.match(items[0],/^F-1 · Medium \(shared boundary\) — Sign-in message can be relayed \(phishing\)\. Partly mitigated: .*a phishing site can skip page checks — sign only when the address bar shows imdember\.com; if your wallet says the request comes from another site or warns of a mismatch, reject\.$/);
  assert.doesNotMatch(items.join(' '),/\): [A-Z][a-z]+( [a-z]+)?:/,'no "title: Status:" double colon');
  // F-3 and F-5: the residual holds while the junk keeps coming, and F-5's still stands (present tense).
  assert.match(items[2],/while the junk continues \(partly open\)/);assert.doesNotMatch(items[2],/for a minute/);
  assert.match(items[4],/^F-5 · Low \(availability\) — About 20 networks can close sign-in site-wide\. .*about 20 \/24s at full rate can close new sign-ins site-wide while they keep going; browsing is unaffected/);
  assert.match(items[6],/^F-7 · Info — Other observations \(a–e\)\. \(a\) fixed .*; \(b\)–\(e\) unchanged/);
  assert.match(items[7],/Open: nothing changed in World; later pages on this origin share these with World/);
  for(const i of [1,2,3,4])assert.match(items[i],new RegExp('^F-'+(i+1)+' · Low'));
  for(const i of [5,6,7])assert.match(items[i],new RegExp('^F-'+(i+1)+' · Info'));
  for(const i of [1,2,4,7])assert.match(items[i],/\bopen\b/i,'F-'+(i+1)+' is still (partly) open');
  assert.match(items[3],/Fixed: “Log out all devices”/);
  const zhItems=[...render(zh).matchAll(/<li>(.*?)<\/li>/g)].map(m=>text(m[1]));
  assert.match(zhItems[0],/^F-1 · Medium（共用邊界） — 登入訊息可被轉送（釣魚）。部分緩解/);assert.match(zhItems[0],/釣魚網站可以略過本頁的檢查——只在網址列是 imdember\.com 時簽名/);
  assert.match(zhItems[2],/在垃圾請求持續期間/);assert.match(zhItems[4],/仍存在：約 20 個網段持續以滿額發送時，仍可暫停全站新登入/);
  assert.doesNotMatch(zhItems[7],/不受影響/,'F-8: World is not claimed to be unaffected');assert.match(zhItems[7],/會與 World 共用這些設定/);
  for(const i of [1,2,4,7])assert.match(zhItems[i],/未解決|未完全解決/,'F-'+(i+1));
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
