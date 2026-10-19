import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {root} from './verify-source.mjs';
const skipDirs=new Set(['node_modules','.git','.rd','release','.wrangler','__pycache__']);
export const excludedGenerated=new Set(['contracts/artifacts/build.json','contracts/evidence/local-evm.json','contracts/evidence/public-verification.json','contracts/PUBLIC_FILES.json','contracts/SHA256SUMS']);
const manifest=JSON.parse(readFileSync(resolve(root,'manifests/export-files.json'),'utf8'));
const rules={machinePath:/(?:[A-Za-z]:[\\/](?:Users|Program Files|Windows|workspace|tmp)[\\/]|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/)/,privateKeyPEM:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,credentialAssignment:/(?:private[_ -]?key|api[_ -]?key|bridge[_ -]?secret|bearer[_ -]?token)\s*[:=]\s*["'](?:0x)?[A-Za-z0-9_+\/-]{24,}["']/i};
const findings=[];let files=0;
for(const row of manifest.files){const path=resolve(root,row.path),stat=lstatSync(path);if(stat.isSymbolicLink()||!stat.isFile()||row.path.split('/').some(p=>skipDirs.has(p))||excludedGenerated.has(row.path))throw Error('BAD_EXPORT_FILE');const bytes=readFileSync(path);if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('EXPORT_CHANGED: '+row.path);files++;
 if(row.path==='tools/scan-public-tree.mjs')continue;
 if(/(?:^|\/)(?:\.env(?:\.|$)|\.dev\.vars|.*\.private\.json$|.*\.(?:pem|key|sqlite|db|pyc)$)/i.test(row.path))findings.push({path:row.path,rule:'privateOrStateFilename'});
 const text=bytes.toString('utf8');for(const [rule,re] of Object.entries(rules))if(re.test(text)){
  // The exact, sealed upstream Ethers browser bundle contains a library fixture
  // matching this heuristic. It is not an application credential assignment.
  if(row.path==='mint/vendor/ethers.min.js'&&rule==='credentialAssignment')continue;
  findings.push({path:row.path,rule});
 }
}
console.log(JSON.stringify({status:findings.length?'REVIEW_REQUIRED':'SELECTED_PATTERNS_CLEAR',files,findings,scope:'curated export only; no Git history',limitations:'Offline heuristic plus explicit source whitelist, not proof that secrets are impossible.'},null,2));
if(findings.length)process.exitCode=1;
