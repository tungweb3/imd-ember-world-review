import {readFileSync,readdirSync,writeFileSync,lstatSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=value=>createHash('sha256').update(value).digest('hex');
const files=['.gitignore','package.json','package-lock.json','README.md','DEPENDENCIES.md','LICENSE','interface.json'];
for(const directory of ['src','test','tools','artifacts','fixtures','baseline','vendor','LICENSES']){
  for(const name of readdirSync(resolve(root,directory)).sort()){
    const path=directory+'/'+name,info=lstatSync(resolve(root,path));
    if(!info.isFile()||info.isSymbolicLink())throw Error('NONREGULAR_PUBLIC_FILE_'+path);
    files.push(path);
  }
}
if(lstatSync(resolve(root,'evidence/public-verification.json')).isFile())files.push('evidence/public-verification.json');
const entries=files.sort().map(path=>{const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:sha(bytes)};});
for(const entry of entries){
  const bytes=readFileSync(resolve(root,entry.path));
  if(/C:[\\/]Users[\\/]|runtime\.config\.private/.test(bytes.toString('utf8')))throw Error('PRIVATE_PATH_IN_PUBLIC_FILE_'+entry.path);
}
const manifest={schema:'imd.world.economy-public-files/v1',scope:'EXPLICIT_PORTABLE_CONTRACT_PUBLIC_ALLOWLIST',files:entries,
  omitted:['node_modules/','.rd/','.cache/','evidence/local-evm.json','all machine execution stdout/stderr and private receipts'],
  manifestSelfHashExcluded:true};
writeFileSync(resolve(root,'PUBLIC_FILES.json'),JSON.stringify(manifest,null,2)+'\n');
const sums=[...entries.map(entry=>`${entry.sha256}  ${entry.path}`),`${sha(readFileSync(resolve(root,'PUBLIC_FILES.json')))}  PUBLIC_FILES.json`];
writeFileSync(resolve(root,'SHA256SUMS'),sums.join('\n')+'\n');
console.log(JSON.stringify({status:'PUBLIC_ALLOWLIST_GENERATED',files:entries.length+2,bytes:entries.reduce((sum,entry)=>sum+entry.bytes,0),manifestSha256:sha(readFileSync(resolve(root,'PUBLIC_FILES.json')))}));
