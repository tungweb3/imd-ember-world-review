import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {ROOT} from '../scripts/deploy.mjs';
import {parseJsonc,versionIdFromLog} from '../scripts/deploy-evidence.mjs';
// scripts/deploy-evidence.mjs run as the operator runs it (a child process, the real entry point) on fixture deploy
// records whose logs carry an email address, a local path and other log text: none of it may reach the evidence page.
// Hashes are checked against the published SHA-256 vectors ("abc", ""), never recomputed here.
const ABC='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',EMPTY='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const UUID='2a5bf0b7-1c2d-4e5f-8a9b-0c1d2e3f4a5b',EMAIL='owner.person@example.com',LOCAL='C:\\Users\\someone\\Desktop\\imd-world\\dist',LOCAL2='/home/someone/imd-world';
const git=(...a)=>spawnSync('git',a,{cwd:ROOT,encoding:'utf8'}).stdout.trim();
function put(dir,files){for(const [p,body] of Object.entries(files)){mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),body);}}
/** A record folder as scripts/deploy.mjs writes it, for `commit`, with the worker bundle "abc" and noisy logs. */
function record(base,commit,{mode='deploy',versionId=null,name}={}){
  const rec=name??'20260929T101500Z-'+commit.slice(0,7),dir=join(base,rec);
  const manifest={kind:'imd-world deploy record',mode,startedAt:'2026-09-29T10:15:00.123Z',finishedAt:'2026-09-29T10:16:02.456Z',commit,branch:'review-fixes',dirty:false,
    envFiles:[],tests:'passed',tools:{node:'v24.19.0',wrangler:'4.143.0',vite:'8.3.1',typescript:'5.9.3',note:EMAIL},config:[],wrangler:{exitCode:0,versionId},
    dist:{sha256:EMPTY,files:[]},worker:{main:{path:'worker/index.js',size:3,sha256:ABC},sha256:EMPTY,files:[]}};
  const log=['⛅️ wrangler 4.143.0','Logged in as '+EMAIL,'Reading config from '+LOCAL,'Uploaded imd-world (3.1 sec)','Deployed imd-world triggers',
    '  imdember.com (custom domain)','Current Version ID: '+UUID,'written to '+LOCAL2].join('\n');
  put(dir,{'manifest.json':JSON.stringify(manifest),'worker/index.js':'abc','wrangler.log':log,'wrangler-logs/wrangler-1.log':log+'\nemail '+EMAIL,
    'SHA256SUMS':[`${ABC}  dist/assets/index-Ab1.js`,`${EMPTY}  dist/assets/index-Cd2.css`,`${ABC}  dist/index.html`,`${EMPTY}  dist/third-party-licenses.txt`,
      `${ABC}  deploy-records/${rec}/worker/index.js`,`${EMPTY}  deploy-records/${rec}/worker/README.md`,`${ABC}  ${LOCAL}`,''].join('\n')});
  return dir;
}
const run=(dir,out,extra=[])=>spawnSync(process.execPath,['scripts/deploy-evidence.mjs',dir,'--out',out,...extra],{cwd:ROOT,encoding:'utf8',timeout:30000});

test('deploy evidence from a real deploy record: commit, id, times, version id, bundle and frontend hashes, migrations, limiters, WAF rule; no log text',()=>{
  const base=mkdtempSync(join(tmpdir(),'imd-evidence-')),out=join(base,'out');
  try{
    const head=git('rev-parse','HEAD'),dir=record(base,head),r=run(dir,out);
    assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'wrote 20260929T101500Z-'+head.slice(0,7)+'.md\n');
    const md=readFileSync(join(out,'20260929T101500Z-'+head.slice(0,7)+'.md'),'utf8');
    for(const part of ['| Source commit | `'+head+'` |','| Record / build id | `20260929T101500Z-'+head.slice(0,7)+'` |','| Mode | deploy |',
      '| Deploy started / finished (UTC) | 2026-09-29T10:15:00.123Z / 2026-09-29T10:16:02.456Z |','| Cloudflare Worker version id | `'+UUID+'` |',
      '| Worker bundle (worker/index.js) SHA-256 | `'+ABC+'` (matches the file in the record) |','| Tests before build | passed (npm test) |',
      '| `dist/assets/index-Ab1.js` | `'+ABC+'` |','| `dist/assets/index-Cd2.css` | `'+EMPTY+'` |','| `dist/index.html` | `'+ABC+'` |',
      '| `API_LIMITER` | 4101 | 180 | 60 |','| `SEAT_LIMITER` | 4102 | 60 | 60 |','| `AUTH_LIMITER` | 4103 | 20 | 60 |','| `CHAIN_LIMITER` | 4104 | 20 | 60 |',
      'As configured in the Cloudflare dashboard (stated, not read by this script): "IMD API anti-flood": URI path starts with /api/, 20 requests per 10 s per IP, block for 10 s',
      'Rule id (fill in from Security → WAF → Rate limiting rules):','- [ ] _pending — filled in at deploy_','Files in the repository at the source commit:'])
      assert.ok(md.includes(part),part);
    // The migrations of that commit, by name (their hashes are whatever the files hold; the next test pins the hashing).
    assert.deepEqual([...md.matchAll(/^\| `(\d{4}_[\w]+\.sql)` \| `[0-9a-f]{64}` \|$/gm)].map(m=>m[1]),['0001_wallet_login.sql','0002_sign_in_budgets.sql','0003_sign_in_layers.sql','0004_index_candidates.sql']);
    assert.ok(!md.includes('third-party-licenses'),'only JS, CSS and HTML are listed');
    // The limiter keys come from server/auth.ts at the record's commit: HEAD has A-1's lane key, a build before it
    // (3f661eb, the retest fixes) does not.
    const keys=k=>'and the constant keys '+k.map(x=>'`'+x+'`').join(', ')+' (CHAIN_LIMITER) and `chain:code` (API_LIMITER).';
    assert.ok(md.includes(keys(['chain:erc1271','chain:erc1271:known','chain:erc1271:lane','chain:index','chain:assets'])),'HEAD');
    const old=git('rev-parse','3f661eb'),r2=run(record(base,old),out);assert.equal(r2.status,0,r2.stderr);
    const md2=readFileSync(join(out,'20260929T101500Z-'+old.slice(0,7)+'.md'),'utf8');
    assert.ok(md2.includes(keys(['chain:erc1271','chain:erc1271:known','chain:index','chain:assets'])),md2.split('\n').find(l=>l.startsWith('Keys'))??md2);
    // None of the logs' text: the email, both local paths, the account line, wrangler's own lines, the manifest's stray note;
    // and nothing of wrangler.jsonc's comments (the real file names the Cloudflare login's email in one).
    for(const bad of [EMAIL,'example.com',LOCAL,'someone','Logged in','Uploaded','custom domain','REDACTED-EMAIL-DOMAIN','account_id','REDACTED-ACCOUNT-ID-PREFIX'])assert.ok(!md.includes(bad),bad);
    assert.doesNotMatch(md,/@|[A-Za-z]:\\|\/home\//);
  }finally{rmSync(base,{recursive:true,force:true});}
});

test('outside git the working tree is used and said so; migrations are hashed, comments and trailing commas stripped, only an exact Version ID line counts',()=>{
  const base=mkdtempSync(join(tmpdir(),'imd-evidence-')),out=join(base,'out'),repo=join(base,'repo');
  try{
    put(repo,{'migrations/0001_a.sql':'abc','migrations/0002_b.sql':'','migrations/notes.txt':EMAIL,
      'wrangler.jsonc':'// login: '+EMAIL+'\n{ "$schema": "https://example.org/x//y", /* '+LOCAL2+' */\n "ratelimits": [\n  // '+EMAIL+'\n  { "name": "AUTH_LIMITER", "namespace_id": "4103", "simple": { "limit": 20, "period": 60 } },\n  { "name": "bad name", "namespace_id": "1", "simple": { "limit": 1, "period": 1 } },\n ],\n}\n'});
    const commit='f'.repeat(40),dir=record(base,commit,{mode:'dry-run',name:'20260929T101500Z-fffffff-dry-run'});
    // Wrangler's line with anything after the uuid is not the line: no version id, and still no log text.
    writeFileSync(join(dir,'wrangler.log'),'Current Version ID: '+UUID+' by '+EMAIL+'\n');
    let r=run(dir,out,['--repo',repo]);assert.equal(r.status,0,r.stderr);
    let md=readFileSync(join(out,'20260929T101500Z-fffffff-dry-run.md'),'utf8');
    for(const part of ['Files in the repository at the working tree (the commit was not found in this checkout):','| `0001_a.sql` | `'+ABC+'` |','| `0002_b.sql` | `'+EMPTY+'` |',
      '| `AUTH_LIMITER` | 4103 | 20 | 60 |','| Cloudflare Worker version id | not in the record (a dry run uploads nothing) |','| Mode | dry run (nothing uploaded) |'])assert.ok(md.includes(part),part);
    assert.ok(!md.includes('notes.txt')&&!md.includes('bad name')&&!md.includes(EMAIL)&&!md.includes('someone'));
    assert.ok(md.includes('Keys inside them: not listed (no CHAIN_KEYS in server/auth.ts at the source commit).')&&!md.includes('chain:'),'no key is named that the checkout lacks');
    assert.equal(versionIdFromLog('x\nCurrent Version ID: '+UUID+'\ny'),UUID);assert.equal(versionIdFromLog('Current Version ID: '+UUID+'x'),null);
    assert.deepEqual(parseJsonc('{"a":"//not a comment","b":[1,2,],/* c */"c":"\\"//\\""}//e'),{a:'//not a comment',b:[1,2],c:'"//"'});
    // A record whose manifest and SHA256SUMS disagree on the bundle, or whose folder names another commit, is refused.
    const sums=join(dir,'SHA256SUMS');writeFileSync(sums,readFileSync(sums,'utf8').replace(`${ABC}  deploy-records/`,`${EMPTY}  deploy-records/`));
    r=run(dir,out,['--repo',repo]);assert.notEqual(r.status,0);assert.match(r.stderr,/disagree on worker\/index\.js/);
    const other=record(base,'e'.repeat(40),{name:'20260929T101500Z-fffffff'});r=run(other,out,['--repo',repo]);assert.notEqual(r.status,0);assert.match(r.stderr,/different commits/);
    assert.ok(!r.stderr.includes(EMAIL)&&!r.stdout.includes(EMAIL));
  }finally{rmSync(base,{recursive:true,force:true});}
});
