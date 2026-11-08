import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// Cloudflare Workers reject fetch(...,{redirect:'error'}) with a TypeError before sending anything
// (Node accepts it, so unit tests passed while every production delivery failed). Worker code uses 'manual'.
test('Worker-side code never passes redirect:error to fetch',()=>{
 const offenders=[];
 for(const dir of ['server','worker'])for(const name of readdirSync(dir))if(name.endsWith('.ts')){
  const text=readFileSync(join(dir,name),'utf8');
  if(/redirect\s*:\s*['"]error['"]/.test(text))offenders.push(join(dir,name));
 }
 assert.deepEqual(offenders,[]);
});
