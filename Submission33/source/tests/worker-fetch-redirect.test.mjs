import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';

// Cloudflare Workers reject some fetch options that Node accepts: redirect:'error' throws a TypeError before
// anything is sent (unit tests passed while every production delivery failed), and so do unsupported cache modes
// and the browser-only credentials/referrerPolicy/integrity fields. Worker code uses redirect:'manual'.
// Scope: every source file the Worker bundle can import (server/, worker/, src/shared/), at any depth.
// Browser code under src/world/ is not scanned: there redirect:'error' and cache:'no-store' are valid.
const ROOTS=['server','worker','src/shared'],EXT=/\.(ts|tsx|mts|js|mjs)$/;
const walk=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):EXT.test(name)?[path]:[];});
const files=ROOTS.flatMap(walk);
const options=(text,key)=>[...text.matchAll(new RegExp(String.raw`\b${key}\s*:\s*(['"\`])([^'"\`]*)\1`,'g'))].map(m=>m[2]);
const KNOWN=['server/celestao-delivery.ts','server/aimarket-delivery.ts','server/aimarket-proxy.ts'].map(p=>join(p));

test('the scan reaches every Worker source directory',()=>{
 for(const root of ROOTS)assert.ok(files.some(f=>f.startsWith(join(root,''))),root+' was not scanned');
 for(const known of KNOWN)assert.ok(files.includes(known),known+' was not scanned');
});
test('Worker-side code only uses redirect:manual or redirect:follow',()=>{
 const offenders=[],seen=new Set();
 for(const file of files)for(const value of options(readFileSync(file,'utf8'),'redirect')){seen.add(file);if(value!=='manual'&&value!=='follow')offenders.push(file+': redirect:'+value);}
 assert.deepEqual(offenders,[]);
 // The two delivery adapters and the AIMarket proxy keep their explicit redirect:'manual'.
 for(const known of KNOWN)assert.ok(seen.has(known),known+' lost its explicit redirect option');
});
test('Worker-side code uses no fetch option that Workers reject',()=>{
 const offenders=[];
 for(const file of files){const text=readFileSync(file,'utf8');
  for(const value of options(text,'cache'))if(value!=='no-store'&&value!=='no-cache')offenders.push(file+': cache:'+value);
  for(const key of ['credentials','referrerPolicy','integrity'])if(new RegExp(String.raw`\b${key}\s*:`).test(text))offenders.push(file+': '+key);
 }
 assert.deepEqual(offenders,[]);
});
