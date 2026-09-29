// Deployment evidence (remediation 2026-09-29 §7B): `node scripts/deploy-evidence.mjs deploy-records/<record>` writes
// docs/security/deploy-evidence/<record>.md from the record `npm run deploy` left (scripts/deploy.mjs: manifest.json,
// SHA256SUMS, wrangler.log, worker/). It states the source commit, the record/build id, the deploy time, the Cloudflare
// Worker version id (when wrangler printed one), the Worker bundle's SHA-256, the frontend JS/CSS/HTML SHA-256, the
// migration files at that commit with their SHA-256 (the remote applied list is filled in by hand), the limiter bindings
// and the edge WAF rule's description.
// Nothing is copied from a log: every value is a structured field matched by a strict pattern (a 40-hex commit, a
// 64-hex hash, a UUID, an ISO time, a path of plain characters), so an email, a local path or any other text in the
// logs or in wrangler.jsonc's comments cannot reach the output. wrangler.jsonc is read with its comments stripped.
// No secrets are read (.dev.vars, .env and credentials are never opened) and nothing is uploaded or changed remotely.
// Options (tests): --out <dir> writes there instead of docs/security/deploy-evidence; --repo <dir> reads migrations and
// wrangler.jsonc from another checkout.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {basename,join,resolve} from 'node:path';
import {ROOT,isEntry} from './deploy.mjs';

const sha256=buf=>createHash('sha256').update(buf).digest('hex');
export const PATTERNS={commit:/^[0-9a-f]{40}$/,hash:/^[0-9a-f]{64}$/,uuid:/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  iso:/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,record:/^\d{8}T\d{6}Z-[0-9a-f]{7}(?:-dry-run)?$/,version:/^v?\d+\.\d+\.\d+$/,
  path:/^[A-Za-z0-9._/-]{1,200}$/,name:/^[A-Z][A-Z0-9_]{0,40}$/,digits:/^\d{1,12}$/};
const pick=(v,re)=>typeof v==='string'&&re.test(v)?v:null;
/** wrangler prints "Current Version ID: <uuid>" after an upload: only a line that is exactly that yields the uuid. */
export function versionIdFromLog(text){const m=/^\s*Current Version ID: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*$/m.exec(text);return m?m[1]:null;}
/** JSONC → value: // and /* *\/ comments (outside strings) and trailing commas removed, then JSON.parse. */
export function parseJsonc(text){
  let out='',i=0,str=false;
  while(i<text.length){const c=text[i],n=text[i+1];
    if(str){out+=c;if(c==='\\'){out+=n??'';i+=2;continue;}if(c==='"')str=false;i++;continue;}
    if(c==='"'){str=true;out+=c;i++;continue;}
    if(c==='/'&&n==='/'){while(i<text.length&&text[i]!=='\n')i++;continue;}
    if(c==='/'&&n==='*'){const e=text.indexOf('*/',i+2);i=e<0?text.length:e+2;continue;}
    out+=c;i++;}
  return JSON.parse(out.replace(/,(\s*[}\]])/g,'$1'));
}
/** SHA256SUMS lines ("<hash>  <path>") whose hash and path are plain; anything else is skipped. */
export function readSums(text){
  const out=new Map();for(const line of text.split('\n')){const m=/^([0-9a-f]{64}) {2}([A-Za-z0-9._/-]{1,200})\r?$/.exec(line);if(m)out.set(m[2],m[1]);}return out;
}
const git=(repo,args)=>{const r=spawnSync('git',args,{cwd:repo,encoding:'buffer'});return r.status===0?r.stdout:null;};
/** A file as of `commit` when the repo has it, else the working tree's copy (and says which). */
function sourceFiles(repo,commit){
  const atCommit=commit&&git(repo,['cat-file','-e',commit+'^{commit}'])!==null;
  if(atCommit){
    const names=String(git(repo,['ls-tree','--name-only',commit,'migrations/'])??'').split('\n').map(s=>s.trim()).filter(Boolean).map(p=>p.replace(/^migrations\//,''));
    const read=p=>git(repo,['show',commit+':'+p]);
    return {from:'commit',migrations:names.filter(n=>/\.sql$/.test(n)).sort().map(n=>({name:n,body:read('migrations/'+n)})),config:read('wrangler.jsonc')};
  }
  const dir=join(repo,'migrations'),names=existsSync(dir)?readdirSync(dir).filter(n=>/\.sql$/.test(n)).sort():[];
  return {from:'working tree',migrations:names.map(n=>({name:n,body:readFileSync(join(dir,n))})),config:existsSync(join(repo,'wrangler.jsonc'))?readFileSync(join(repo,'wrangler.jsonc')):null};
}
/** The limiter bindings of a wrangler config: names, namespace ids and limits only. */
export function limiterSummary(configText){
  const cfg=parseJsonc(configText);
  return (Array.isArray(cfg.ratelimits)?cfg.ratelimits:[]).map(r=>({name:pick(r?.name,PATTERNS.name),namespace:pick(String(r?.namespace_id??''),PATTERNS.digits),
    limit:Number.isSafeInteger(r?.simple?.limit)?r.simple.limit:null,period:Number.isSafeInteger(r?.simple?.period)?r.simple.period:null})).filter(r=>r.name);
}
/** The zone's WAF rule as the owner configured it in the dashboard (widened from /api/world/ to /api/ on 2026-09-29). It is
 *  stated here, not read from Cloudflare: the page says so, and leaves its rule id to be filled in by hand. */
export const WAF_RULE='"IMD API anti-flood": URI path starts with /api/, 20 requests per 10 s per IP, block for 10 s (Cloudflare WAF rate-limiting rule on the imdember.com zone)';

/** The evidence page for the record in `recordDir`. Throws when the record is not one deploy.mjs wrote. */
export function evidence(recordDir,{repo=ROOT}={}){
  const folder=basename(recordDir),partial=folder.endsWith('.partial'),record=folder.replace(/\.partial$/,'');
  if(!PATTERNS.record.test(record))throw new Error('not a deploy record folder name: expected <UTC time>-<commit>[-dry-run]');
  const m=JSON.parse(readFileSync(join(recordDir,'manifest.json'),'utf8'));
  if(m.kind!=='imd-world deploy record')throw new Error('manifest.json is not an imd-world deploy record');
  const commit=pick(m.commit,PATTERNS.commit);if(!commit)throw new Error('manifest.json has no valid commit');
  if(!record.includes('-'+commit.slice(0,7)))throw new Error('the folder name and the manifest name different commits');
  const sums=existsSync(join(recordDir,'SHA256SUMS'))?readSums(readFileSync(join(recordDir,'SHA256SUMS'),'utf8')):new Map();
  const workerPath=`deploy-records/${record}/worker/index.js`,worker=sums.get(workerPath)??null,manifestWorker=pick(m.worker?.main?.sha256,PATTERNS.hash);
  if(worker&&manifestWorker&&worker!==manifestWorker)throw new Error('SHA256SUMS and manifest.json disagree on worker/index.js');
  const bundle=worker??manifestWorker,onDisk=existsSync(join(recordDir,'worker','index.js'))?sha256(readFileSync(join(recordDir,'worker','index.js'))):null;
  const fromManifest=pick(m.wrangler?.versionId??undefined,PATTERNS.uuid),log=existsSync(join(recordDir,'wrangler.log'))?readFileSync(join(recordDir,'wrangler.log'),'utf8'):'';
  const versionId=fromManifest??versionIdFromLog(log);
  const front=[...sums].filter(([p])=>/^dist\/(index\.html|assets\/[A-Za-z0-9._-]+\.(js|css))$/.test(p)).sort(([a],[b])=>a<b?-1:1);
  const src=sourceFiles(repo,commit),limiters=src.config?limiterSummary(String(src.config)):[];
  const mode=m.mode==='deploy'?'deploy':'dry run (nothing uploaded)';
  const at=[pick(m.startedAt,PATTERNS.iso),pick(m.finishedAt,PATTERNS.iso)];
  const tools=Object.entries(m.tools??{}).filter(([k,v])=>/^[a-z]{2,12}$/.test(k)&&PATTERNS.version.test(String(v))).map(([k,v])=>`${k} ${v}`);
  const L=[];
  L.push(`# Deployment evidence — ${record}`,'',
    'Generated by `node scripts/deploy-evidence.mjs` from the deploy record. Values are structured fields only; no log text is copied.','',
    '| | |','|---|---|',
    `| Source commit | \`${commit}\` |`,
    `| Record / build id | \`${record}\`${partial?' (the record folder was not renamed from .partial; its files are complete)':''} |`,
    `| Frontend tree digest (dist) | ${pick(m.dist?.sha256,PATTERNS.hash)?'`'+m.dist.sha256+'`':'not recorded'} |`,
    `| Mode | ${mode} |`,
    `| Deploy started / finished (UTC) | ${at[0]??'not recorded'} / ${at[1]??'not recorded'} |`,
    `| Cloudflare Worker version id | ${versionId?'`'+versionId+'`':'not in the record'+(m.mode==='deploy'?'':' (a dry run uploads nothing)')} |`,
    `| Worker bundle (worker/index.js) SHA-256 | ${bundle?'`'+bundle+'`':'not recorded'}${bundle&&onDisk?(onDisk===bundle?' (matches the file in the record)':' (**the file in the record differs**)'):''} |`,
    `| Tests before build | ${m.tests==='passed'?'passed (npm test)':m.tests==='skipped (dry run)'?'skipped (dry run)':'not recorded'} |`,
    `| Tools | ${tools.join(', ')||'not recorded'} |`,'');
  L.push('## Frontend files (SHA-256)','','| File | SHA-256 |','|---|---|',...front.map(([p,h])=>`| \`${p}\` | \`${h}\` |`),...front.length?[]:['| (none in SHA256SUMS) | |'],'');
  L.push('## D1 migrations',`Files in the repository at ${src.from==='commit'?'the source commit':'the working tree (the commit was not found in this checkout)'}:`,'','| Migration | SHA-256 |','|---|---|',
    ...src.migrations.filter(f=>PATTERNS.path.test(f.name)&&f.body).map(f=>`| \`${f.name}\` | \`${sha256(f.body)}\` |`),'',
    'Applied on the remote database `imd-world` (fill in from `wrangler d1 migrations list imd-world --remote`, names only):','','- [ ] _pending — filled in at deploy_','');
  L.push('## Rate-limit bindings (wrangler.jsonc, comments stripped)','','| Binding | Namespace id | Limit | Period (s) |','|---|---|---|---|',
    ...limiters.map(r=>`| \`${r.name}\` | ${r.namespace??'?'} | ${r.limit??'?'} | ${r.period??'?'} |`),'',
    'Keys inside them (server/auth.ts): per client IP (`ip:`, `ip6:`), verifies under `verify:`, sessions under `session:`, and the constant keys `chain:erc1271`, `chain:erc1271:known`, `chain:index`, `chain:assets` (CHAIN_LIMITER) and `chain:code` (API_LIMITER).','');
  L.push('## Edge WAF rule','','As configured in the Cloudflare dashboard (stated, not read by this script): '+WAF_RULE+'.','',
    'Rule id (fill in from Security → WAF → Rate limiting rules):','','- [ ] _pending — filled in at deploy_','');
  return {record,text:L.join('\n')};
}

function main(){
  const args=process.argv.slice(2),opt=k=>{const i=args.indexOf(k);return i>=0?args.splice(i,2)[1]:null;};
  const out=opt('--out'),repo=opt('--repo'),dir=args[0];
  if(!dir){console.error('usage: node scripts/deploy-evidence.mjs <deploy-record-dir> [--out <dir>]');process.exit(2);}
  const {record,text}=evidence(resolve(dir),{repo:repo?resolve(repo):ROOT}),target=out?resolve(out):join(ROOT,'docs','security','deploy-evidence');
  mkdirSync(target,{recursive:true});const file=join(target,record+'.md');writeFileSync(file,text);
  console.log('wrote '+(out?record+'.md':'docs/security/deploy-evidence/'+record+'.md'));
}
if(isEntry(process.argv[1],import.meta.url))main();
