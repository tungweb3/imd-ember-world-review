import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {GoldReviewRecord,GOLD_REVIEW,GOLD_REVIEW_FINDINGS} from '../src/world/goldReviewRecord.ts';
// The record of the last Swarm audit of the GOLD purchase code (job f6bd50ad), at the foot of the GOLD panel in every
// state: collapsed, naming scope, version, date, job, report and the reviewed source (new tab, no referrer, no opener),
// that the statuses are the site maintainer's, and the three findings. No claim words (the rule of tests/review-record).
const render=zh=>renderToStaticMarkup(createElement(GoldReviewRecord,{zh}));
const text=html=>html.replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#x27;/g,"'").replace(/&quot;/g,'"');
const FORBIDDEN=/security certified|officially audited|100% safe|guaranteed secure|certif|audited[- ]by|badge|已認證|認證|保證安全|安全無虞|徽章|(?<!Gnosis )\bsafe(?:ly|r|st)?\b|(?<!HttpOnly, )\bsecure(?:ly)?\b|\baudited\b|\bofficial(?:ly)?\b|已審計|保證|(?<!非)官方/i;
test('the GOLD panel shows the last GOLD review: job, report, reviewed source and its three findings, with no claim words',()=>{
  const en=render(false),zh=render(true);
  assert.match(en,/^<details class="audit-record gold-review-record"><summary>GOLD payment review record<\/summary>/,'collapsed');
  assert.match(zh,/<summary>GOLD 付款審查紀錄<\/summary>/);
  const links=[...en.matchAll(/<a ([^>]*)>/g)].map(m=>m[1]);
  assert.deepEqual(links,['https://explorer.imd.fun/jobs/f6bd50ad-af0b-4191-a0de-0e322c19c667','https://api.imd.fun/jobs/f6bd50ad-af0b-4191-a0de-0e322c19c667/report.md',
    'https://github.com/tungweb3/imd-ember-world-review/tree/26fd4b55b07509cecf33196677f222e41eebdf31/Submission18'].map(u=>`href="${u}" target="_blank" rel="noreferrer noopener"`));
  for(const part of ['World source 96858bf (Worker b08f59ef, public snapshot 26fd4b5)','2026-10-27 (UTC)','This review found 3 Low and nothing of Medium or higher.',
    'fix status as reported by the site maintainer; the fixed version was not re-reviewed'])assert.ok(en.includes(part),part);
  for(const part of ['World 原始碼 96858bf（Worker b08f59ef，公開快照 26fd4b5）','這次審查找到 3 個 Low，沒有 Medium 以上的問題。','修正狀態為本站維護者自行說明'])assert.ok(zh.includes(part),part);
  assert.deepEqual(GOLD_REVIEW_FINDINGS.map(f=>f.id+' '+f.severity),['#1 Low','#2 Low','#3 Low']);
  assert.equal([...en.matchAll(/<li>/g)].length,3);
  for(const f of GOLD_REVIEW_FINDINGS){assert.match(f.status.en,/^Fixed in this version: /);assert.match(f.status.zh,/^此版本已修正：/);}
  assert.equal(GOLD_REVIEW.job,'f6bd50ad-af0b-4191-a0de-0e322c19c667');
  assert.doesNotMatch(text(en)+text(zh),FORBIDDEN);
  // In every state of the panel: outside the signed-in and ledger branches, just before the status line.
  const panel=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
  assert.match(panel,/\n <GoldReviewRecord zh=\{zh\}\/>\r?\n <p role="status" ref=\{statusLine\}>/);
});
