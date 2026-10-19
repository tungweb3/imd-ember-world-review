import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function verifySelectedSource(){const manifest=JSON.parse(readFileSync(resolve(root,'manifests/selected-source.json'),'utf8'));const seen=new Set();
for(const r of manifest.sourceFiles){if(!r.path.startsWith('world-source/')||r.path.includes('\\')||r.path.split('/').includes('..')||seen.has(r.path))throw Error('BAD_SOURCE_PATH');const p=resolve(root,r.path),rel=relative(root,realpathSync(p));if(rel.startsWith('..')||isAbsolute(rel)||lstatSync(p).isSymbolicLink())throw Error('SOURCE_ESCAPE');const b=readFileSync(p);if(b.length!==r.bytes||createHash('sha256').update(b).digest('hex')!==r.sha256)throw Error('SOURCE_CHANGED: '+r.path);seen.add(r.path);}
for(const p of manifest.selectedTests)if(!seen.has(p)||!p.startsWith('world-source/tests/')||!p.endsWith('.test.mjs'))throw Error('BAD_TEST_SELECTION');
const aux=JSON.parse(readFileSync(resolve(root,'manifests/auxiliary-source.json'),'utf8')),adaptations=JSON.parse(readFileSync(resolve(root,'manifests/portable-adaptations.json'),'utf8'));
if(aux.worldSourceCommit!==manifest.sourceCommit)throw Error('AUXILIARY_PIN_MISMATCH');
for(const r of aux.files){if(!/^(mint|aimarket)\//.test(r.path)||r.path.includes('\\')||r.path.split('/').includes('..')||seen.has(r.path))throw Error('BAD_AUXILIARY_PATH');const p=resolve(root,r.path),rel=relative(root,realpathSync(p));if(rel.startsWith('..')||isAbsolute(rel)||lstatSync(p).isSymbolicLink())throw Error('AUXILIARY_ESCAPE');const actual=createHash('sha256').update(readFileSync(p)).digest('hex');if(actual!==r.sha256||(r.byteExact&&r.sourceSha256!==actual)||(!r.byteExact&&!adaptations.some(a=>a.path===r.path)))throw Error('AUXILIARY_CHANGED: '+r.path);seen.add(r.path);}
return {manifest,files:manifest.sourceFiles.length,auxiliaryFiles:aux.files.length};}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const {manifest,...counts}=verifySelectedSource();console.log(JSON.stringify({status:'SOURCE_BYTES_MATCH',sourceCommit:manifest.sourceCommit,...counts}));}
