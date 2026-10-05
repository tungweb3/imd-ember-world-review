import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createArtifactStore} from './auth-artifacts.mjs';

function fixture(fn){
  const root=mkdtempSync(join(tmpdir(),'artifacts-audit10-'));
  const dispose=()=>{const rel=relative(resolve(tmpdir()),resolve(root));assert.ok(!isAbsolute(rel)&&/^artifacts-audit10-[^\\/]+$/.test(rel));rmSync(root,{recursive:true,force:true});};
  try{const result=fn(root);if(result?.then)return result.finally(dispose);dispose();return result;}catch(error){dispose();throw error;}
}
function persisted(root,value,name='core500-RESULT.json'){
  const store=createArtifactStore({sourceDir:root,requestedDir:'tmp/artifacts'});
  assert.equal(store.write(name,value),true);
  const bytes=readFileSync(join(store.directory,name));
  return {saved:JSON.parse(bytes),bytes};
}
const routes=['/api/auth/session','/api/auth/challenge','/api/auth/verify','/api/auth/logout','/api/auth/logout-all','/api/me/home','/api/me/home?fresh=1','/api/me/home/refresh'];
const controls={routes,url:'https://example.com/api/auth/session.log',relative:'tests/auth-artifacts.test.mjs',parent:'../fixtures/auth.json',nonce:'n1',
  actions:[{type:'start',tab:'a'}],events:[{index:0,type:'headers',id:'r1'}]};

test('A10-I3 exact persisted reviewer spaced-prefix witnesses mask the entire absolute path',()=>fixture(root=>{
  const messages=['Error at /api/auth/session private.log','Cannot read /api/auth/session (private)/x.ts','/api/auth/session dir/file.ts',
    'Cannot read "/api/auth/session private.log"','Error at /root/private directory/project.ts'];
  const {saved,bytes}=persisted(root,{nested:{errors:messages},filenames:['/api/auth/session.log','/api/auth/verify.backup','/api/me/home.private.json'],controls});
  assert.deepEqual(saved.controls,controls);
  assert.deepEqual(saved.filenames,['[local-path]','[local-path]','[local-path]']);
  assert.equal(saved.nested.errors[3],'Cannot read "[local-path]"');assert.equal(saved.nested.errors[4],'Error at [local-path]');
  assert.equal(saved.nested.errors[0],'Error at [local-path]');
  assert.equal(saved.nested.errors[1],'Cannot read [local-path]');assert.equal(saved.nested.errors[2],'[local-path]');
  assert.ok(!bytes.includes(Buffer.from('private.log'))&&!bytes.includes(Buffer.from('(private)')));
}));
test('A10-I3 persisted route-prefix spaced suffixes mask across each allowed route and whitespace form',()=>fixture(root=>{
  const paths=routes.flatMap(route=>[' ','  ','\t','\u00a0','\u2003'].flatMap(space=>['private.log','dir/file.ts','(private)/x.ts'].map(suffix=>route+space+suffix)));
  const {saved}=persisted(root,{paths});assert.deepEqual(saved.paths,paths.map(()=>'[local-path]'));
}));
test('A10-I3 persisted nested quoted and bracketed diagnostics never retain a route-prefix path fragment',()=>fixture(root=>{
  const paths=['/api/auth/session private.log','/api/auth/session dir/file.ts','/api/auth/session (private)/x.ts'];
  const diagnostics=paths.flatMap(path=>[`Error at "${path}"; relative tests/auth-artifacts.test.mjs`,`Error at '${path}'; nonce n1`,
    `Error at (${path})`,`path=${path}`,`Error at [${path}]`]);
  const {saved,bytes}=persisted(root,{nested:{deeper:{diagnostics}},pathKey:{'/api/auth/session private.log':'retained'}});
  assert.deepEqual(saved.pathKey,{'[local-path]':'retained'});
  for(const text of saved.nested.deeper.diagnostics)assert.ok(text.includes('[local-path]'));
  assert.ok(!bytes.includes(Buffer.from('/api/auth/session'))&&!bytes.includes(Buffer.from('private.log'))&&!bytes.includes(Buffer.from('(private)')));
  for(let i=0;i<paths.length;i++){
    assert.equal(saved.nested.deeper.diagnostics[i*5], 'Error at "[local-path]"; relative tests/auth-artifacts.test.mjs');
    assert.equal(saved.nested.deeper.diagnostics[i*5+1], "Error at '[local-path]'; nonce n1");
  }
}));
test('A10-I3 ambiguous bare route prose follows the conservative remainder-of-segment policy',()=>fixture(root=>{
  // A bare route followed by prose can also name a file containing spaces. Only
  // explicit token/log contexts are exempt; this does not promise perfect parsing
  // of arbitrary freeform unquoted filesystem diagnostics.
  const ambiguous=['/api/auth/session completed','Error at /api/auth/session private.log, then retry',
    '/api/auth/session, private.log','/api/auth/session; private.log','/api/auth/session | private.log'];
  const {saved}=persisted(root,{ambiguous});
  assert.deepEqual(saved.ambiguous,['[local-path]','Error at [local-path]','[local-path]','[local-path]','[local-path]']);
}));
test('A10-I3 complete protocol values HTTP status logs and explicit route listings preserve bytes',()=>fixture(root=>{
  const logs=['GET /api/me/home?fresh=1 200','POST /api/auth/verify 401','HEAD /api/auth/session 503',
    'route /api/auth/logout, then /api/auth/logout-all',...routes.map(route=>`route "${route}"`),...routes.map(route=>`route '${route}'`),
    'route /api/me/home/refresh; /api/auth/session','(/api/auth/session)'];
  const value={controls,logs};assert.deepEqual(persisted(root,value).saved,value);
}));
test('A10-I3 persisted multi-line diagnostics mask spaced paths without consuming URL or relative identity lines',()=>fixture(root=>{
  const value={message:'Error at /api/auth/session private.log\nGET /api/me/home?fresh=1 200\nrelative tests/auth-artifacts.test.mjs\nhttps://example.com/api/auth/session private.log',
    inline:'Error at /api/auth/session dir/file.ts https://example.com/api/auth/session.log',controls};
  const {saved}=persisted(root,value);
  assert.equal(saved.message,'Error at [local-path]\nGET /api/me/home?fresh=1 200\nrelative tests/auth-artifacts.test.mjs\nhttps://example.com/api/auth/session private.log');
  assert.equal(saved.inline,'Error at [local-path] https://example.com/api/auth/session.log');assert.deepEqual(saved.controls,controls);
}));
test('A10-I3 persisted exact route whitespace values remain stable while path replacements are deterministic',()=>fixture(root=>{
  const value={terminal:routes.flatMap(route=>[route,route+' ',route+'\t']),path:'Error at /api/auth/session private.log'};
  const first=persisted(root,value),second=persisted(root,value);
  assert.deepEqual(first.saved.terminal,value.terminal);assert.equal(first.saved.path,'Error at [local-path]');
  assert.deepEqual(first.bytes,second.bytes);assert.equal(createHash('sha256').update(first.bytes).digest('hex'),createHash('sha256').update(second.bytes).digest('hex'));
}));
test('A10-I3 actual saved trace preserves replay structure while masking spaced route-prefix diagnostics',()=>fixture(async root=>{
  const {runSeed}=await import('./auth-scheduler-driver.mjs'),trace=await runSeed(0,{retainTrace:true});
  assert.ok(trace.actions.length>5);assert.ok(trace.metrics.workerCalls>=2);
  const {saved}=persisted(root,{trace,diagnostics:{message:'Error at /api/auth/session (private)/x.ts'},controls},'core500-failure-original.json');
  assert.equal(saved.diagnostics.message,'Error at [local-path]');assert.deepEqual(saved.controls,controls);
  assert.deepEqual(saved.trace.actions,trace.actions);assert.deepEqual(saved.trace.events,trace.events);
  const replay=await runSeed(saved.trace.seed,{replayActions:saved.trace.actions,retainTrace:true});
  assert.equal(replay.traceDigest,trace.traceDigest);assert.deepEqual(replay.counts,trace.counts);assert.deepEqual(replay.projections,trace.projections);assert.ok(replay.metrics.workerCalls>=2);
}));
