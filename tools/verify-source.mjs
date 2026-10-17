import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function verifySelectedSource(){
 const manifest=JSON.parse(readFileSync(resolve(root,'manifests/selected-source.json'),'utf8'));
 if(!Array.isArray(manifest.sourceFiles)||!Array.isArray(manifest.selectedTests)||manifest.fullWorkerTestsIncluded!==false||manifest.wholeWorldIncluded!==false)throw Error('INVALID_SELECTED_MANIFEST');
 const seen=new Set();let bytes=0;
 for(const row of manifest.sourceFiles){
  if(typeof row.path!=='string'||!row.path.startsWith('world-source/')||row.path.includes('\\')||row.path.split('/').includes('..')||isAbsolute(row.path)||seen.has(row.path))throw Error('UNSAFE_MANIFEST_PATH');
  const path=resolve(root,row.path),real=realpathSync(path),rel=relative(root,real);
  if(rel.startsWith('..')||isAbsolute(rel)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw Error('SOURCE_LINK_OR_ESCAPE');
  const raw=readFileSync(path);if(raw.length!==row.bytes||createHash('sha256').update(raw).digest('hex')!==row.sha256)throw Error('SELECTED_SOURCE_CHANGED: '+row.path);
  seen.add(row.path);bytes+=raw.length;
 }
 for(const path of manifest.selectedTests)if(!seen.has(path)||!/^world-source\/tests\/economy-[a-z0-9-]+\.test\.mjs$/.test(path)||path.endsWith('/economy-worker.test.mjs'))throw Error('INVALID_TEST_SELECTION');
 if(new Set(manifest.selectedTests).size!==manifest.selectedTests.length)throw Error('DUPLICATE_TEST_SELECTION');
 return {manifest,files:seen.size,bytes};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const checked=verifySelectedSource();console.log(JSON.stringify({status:'SELECTED_SOURCE_BYTES_MATCH',files:checked.files,bytes:checked.bytes,sourceCommit:checked.manifest.sourceCommit,selectedTests:checked.manifest.selectedTests.length,wholeWorldIncluded:false}));
}
