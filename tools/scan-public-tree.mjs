import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {root} from './verify-source.mjs';

// This offline scanner intentionally prints paths/rule names, never matched
// secret-looking values. Human review and an all-Git-object scan remain required.
const skipped=new Set(['node_modules','.git','.rd','.wrangler','release']);
const rules={
 localWindowsPath:/(?<![A-Za-z0-9])[A-Za-z]:[\\/]/,
 userHomePath:/\/(?:Users|home)\/[A-Za-z0-9_.-]+\//,
 unrelatedAdminAllowlist:/\b(?:AIMARKET_ACTIVITY_ADMINS|ADMIN_WALLETS|OWNER_WALLETS)\b/,
 keyMaterial:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
 credentialAssignment:/(?:private[_ -]?key|api[_ -]?key|bridge[_ -]?secret|bearer[_ -]?token)\s*[:=]\s*["'](?:0x)?[A-Za-z0-9_+\/-]{24,}["']/i,
 email:/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
};
const findings=[];let files=0,bytes=0;
function visit(folder){for(const name of readdirSync(folder).sort()){
 if(skipped.has(name))continue;const path=resolve(folder,name),rel=relative(root,path).replaceAll('\\','/'),info=lstatSync(path);
 if(info.isSymbolicLink()){findings.push({path:rel,rule:'unexpectedLink'});continue;}
 if(info.isDirectory()){visit(path);continue;}
 if(!info.isFile()){findings.push({path:rel,rule:'unexpectedFileType'});continue;}
 const raw=readFileSync(path),text=raw.toString('utf8');files++;bytes+=raw.length;
 if(/(?:^|\/)(?:\.env(?:\.|$)|\.dev\.vars|.*\.private\.json$|.*\.(?:pem|key)$)/i.test(rel))findings.push({path:rel,rule:'privateFilename'});
 // Rule literals themselves are scanner policy; they are not transmitted user
 // data. All other files, including vendored compiler/source metadata, are read.
 if(rel==='tools/scan-public-tree.mjs')continue;
 for(const [rule,pattern]of Object.entries(rules))if(pattern.test(text))findings.push({path:rel,rule});
 }}
visit(root);console.log(JSON.stringify({status:findings.length?'PRIVACY_REVIEW_REQUIRED':'NO_MATCHES_IN_SELECTED_PATTERNS',files,bytes,findings,gitObjectScanPerformed:false,manualPrivacyReviewRequired:true},null,2));
if(findings.length)process.exitCode=1;
