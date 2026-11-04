import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {GOLD_GRANT_WALLETS,worldGoldSnapshot} from '../server/world-gold.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from '../server/aimarket-admin.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {parseWorldGold} from '../src/world/worldGoldClient.ts';
import {getAddress} from 'viem';
import {GOLD_GRANT_DAILY,GOLD_GRANT_DAILY_COUNT,GOLD_GRANT_DUPLICATE_MS,GOLD_GRANT_MAX} from '../src/shared/goldGrants.ts';
import {createCelestaoDelivery} from '../server/celestao-delivery.ts';
import {grantAttemptFor,grantError,grantFormReady} from '../src/world/goldGrantRules.ts';

const NOW=Date.UTC(2026,9,18),DAY=86400000,ROOT='https://imdember.com',TOKEN='s'.repeat(43),RECIPIENT='0x'+'c'.repeat(40);
const [GRANT_A,THIRD_ADMIN,GRANT_B]=AIMARKET_ACTIVITY_ADMIN_WALLETS,ORDINARY='0x'+'a'.repeat(40);
let seq=0;
async function fixture(t,wallet=GRANT_A,deps={},files){
 const db=openD1(files),config=await defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,treasury:ECONOMY_TREASURY,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),deploymentBlock:'100',catalogue:[]});
 t.after(()=>db.raw.close());
 db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(await sha256(TOKEN),wallet,NOW-1,NOW+100*DAY,'grant'+(++seq),'EOA','ECDSA');
 const f={db,wallet,now:NOW,deps:{db,config,allow:async()=>true,grantsEnabled:true,...deps}};
 f.deps.now=()=>f.now;
 f.grant=async(gold='1000',to=RECIPIENT,requestId=crypto.randomUUID(),reason='Fixture tester grant',{from=wallet,token=TOKEN,origin=ROOT}={})=>{
  const response=await handleWorldGoldApi(new Request(ROOT+'/api/gold/admin',{method:'POST',headers:{origin,'content-type':'application/json',cookie:SESSION_COOKIE+'='+token},body:JSON.stringify({expectedAddress:from,requestId,reason,command:{action:'grant',wallet:to,gold}})}),f.deps);
  return {status:response.status,body:await response.json()};
 };
 f.state=async()=>(await handleWorldGoldApi(new Request(ROOT+'/api/gold/state?expected_address='+wallet,{headers:{origin:ROOT,cookie:SESSION_COOKIE+'='+TOKEN}}),f.deps)).json();
 f.book=async(address=RECIPIENT)=>(await worldGoldSnapshot(db,address,f.now)).available;
 f.count=()=>db.raw.prepare('SELECT COUNT(*) n FROM world_gold_grants').get().n;
 return f;
}
const direct=(db,{id='direct',wallet=RECIPIENT,delta=1,actor=GRANT_A,reference='admin-grant:'+id,created=NOW}={})=>db.raw.prepare("INSERT INTO world_gold_grants(id,wallet,delta,kind,reference,actor,reason,created_ms) VALUES(?,?,?,'admin-grant',?,?,'direct',?)").run(id,wallet,delta,reference,actor,created);

test('the owner chose two of the three administrators, five thousand each and twenty thousand a day',()=>{
 assert.deepEqual([...GOLD_GRANT_WALLETS].sort(),[GRANT_A,GRANT_B].sort());
 assert.equal(GRANT_B,ECONOMY_TREASURY.toLowerCase());assert.equal(GOLD_GRANT_DAILY_COUNT,100);
 assert.equal(GOLD_GRANT_MAX,5000);assert.equal(GOLD_GRANT_DAILY,20000);
});
for(const actor of [GRANT_A,GRANT_B])test('a grant from '+actor.slice(-4)+' adds spendable GOLD, shows in history and leaves a full record',async t=>{
 const f=await fixture(t,actor);
 assert.equal((await f.grant('1000',RECIPIENT.toUpperCase().replace('0X','0x'))).status,200);
 assert.equal(await f.book(),'1000');
 const snapshot=await worldGoldSnapshot(f.db,RECIPIENT,f.now);assert.deepEqual(snapshot.history.map(h=>[h.kind,h.delta]),[['admin-grant','1000']]);
 const row=f.db.raw.prepare('SELECT wallet,delta,actor,reason FROM world_gold_grants').get();assert.deepEqual({...row},{wallet:RECIPIENT,delta:1000,actor,reason:'Fixture tester grant'});
 const audit=f.db.raw.prepare('SELECT wallet,action,payload,before_json,after_json FROM world_gold_admin_actions').get();
 assert.equal(audit.wallet,actor);assert.equal(audit.action,'grant');assert.deepEqual(JSON.parse(audit.payload),[{action:'grant',wallet:RECIPIENT.toUpperCase().replace('0X','0x'),gold:'1000'},'Fixture tester grant']);
 assert.equal(JSON.parse(audit.before_json).recipientBook,null);assert.equal(JSON.parse(audit.after_json).recipientBook,'1000');
});
test('repeating a request id pays once, and reusing it for something else is refused',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();
 assert.equal((await f.grant('1000',RECIPIENT,id)).status,200);assert.equal((await f.grant('1000',RECIPIENT,id)).status,200);
 assert.equal(await f.book(),'1000');assert.equal(f.count(),1);
 const other=await f.grant('2000',RECIPIENT,id);assert.equal(other.status,409);assert.equal(other.body.error,'IDEMPOTENCY_CONFLICT');assert.equal(await f.book(),'1000');
});
test('grants stay closed until the switch is on',async t=>{
 for(const deps of [{grantsEnabled:false},{grantsEnabled:undefined}]){
  const f=await fixture(t,GRANT_A,deps),r=await f.grant();
  assert.equal(r.status,409);assert.equal(r.body.error,'FEATURE_PAUSED');assert.equal(f.count(),0);
  const state=await f.state();assert.equal(state.canGrant,undefined);assert.equal(state.grantLeft,undefined);
 }
 const worker=readFileSync(new URL('../worker/app.ts',import.meta.url),'utf8');
 assert.match(worker,/grantsEnabled:env\.WORLD_GOLD_GRANTS==='enabled',client:/);
 assert.doesNotMatch(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'),/WORLD_GOLD_GRANTS/);
});
test('the third administrator and ordinary wallets cannot grant or see the form',async t=>{
 for(const wallet of [THIRD_ADMIN,ORDINARY]){
  const f=await fixture(t,wallet),r=await f.grant();
  assert.equal(r.status,403);assert.equal(r.body.error,'ADMIN_REQUIRED');assert.equal(f.count(),0);
  assert.equal((await f.state()).canGrant,undefined);
 }
});
test('a wallet other than an EOA session cannot grant',async t=>{
 const f=await fixture(t);f.db.raw.prepare("UPDATE sessions SET wallet_type='SCA',verification_method='ERC1271'").run();
 const r=await f.grant();assert.equal(r.status,403);assert.equal(r.body.error,'EOA_REQUIRED');assert.equal(f.count(),0);
});
test('bad amounts and addresses are refused with nothing written',async t=>{
 const f=await fixture(t);
 for(const gold of ['0','-1','1.5','01','abc','','5001','999999999',1000]){const r=await f.grant(gold);assert.equal(r.status,409,String(gold));assert.equal(r.body.error,'INVALID_GRANT_AMOUNT',String(gold));}
 for(const to of ['nope','0x123','0x'+'0'.repeat(40),42]){const r=await f.grant('1',to);assert.equal(r.status,409,String(to));assert.equal(r.body.error,'INVALID_ADDRESS',String(to));}
 for(const reason of ['','ab']){const r=await f.grant('1',RECIPIENT,crypto.randomUUID(),reason);assert.equal(r.body.error,'REASON_REQUIRED');}
 assert.equal(f.count(),0);assert.equal(await f.book(),'0');
 assert.equal((await f.grant('5000')).status,200);
});
test('the daily total is shared by both wallets, counts down, and reopens only after a full day',async t=>{
 const f=await fixture(t);assert.equal((await f.state()).grantLeft,'20000');
 for(let i=0;i<3;i++)assert.equal((await f.grant('5000','0x'+String(i+1).repeat(40))).status,200);
 direct(f.db,{id:'from-the-other-wallet',actor:GRANT_B,delta:4999});
 assert.equal((await f.state()).grantLeft,'1');
 const over=await f.grant('2');assert.equal(over.status,409);assert.equal(over.body.error,'GRANT_DAILY_LIMIT');
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_admin_actions').get().n,3);
 assert.equal((await f.grant('1')).status,200);assert.equal((await f.state()).grantLeft,'0');
 f.now=NOW+DAY-1;assert.equal((await f.grant('1')).body.error,'GRANT_DAILY_LIMIT');
 f.now=NOW+DAY;assert.equal((await f.state()).grantLeft,'20000');assert.equal((await f.grant('1')).status,200);
});
test('a session ended before the write leaves nothing',async t=>{
 const f=await fixture(t),original=f.db.batch.bind(f.db);
 f.db.batch=async statements=>{f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(f.now);return original(statements);};
 const r=await f.grant();assert.notEqual(r.status,200);assert.equal(f.count(),0);assert.equal(await f.book(),'0');
});
test('the database itself refuses other wallets, oversized grants, a full day, and any edit',async t=>{
 const f=await fixture(t);
 assert.throws(()=>direct(f.db,{id:'[wallet-3]',actor:THIRD_ADMIN}),/GRANT_ACTOR_NOT_ALLOWED/);
 assert.throws(()=>direct(f.db,{id:'random',actor:ORDINARY}),/GRANT_ACTOR_NOT_ALLOWED/);
 assert.throws(()=>direct(f.db,{id:'big',delta:GOLD_GRANT_MAX+1}),/GRANT_AMOUNT_LIMIT/);
 assert.throws(()=>direct(f.db,{id:'negative',delta:-1}),/CHECK constraint/);
 assert.throws(()=>direct(f.db,{id:'zero',delta:0}),/CHECK constraint/);
 assert.throws(()=>direct(f.db,{id:'ref',reference:'admin-grant:other'}),/INVALID_REFERENCE/);
 assert.throws(()=>direct(f.db,{id:'upper',wallet:'0x'+'C'.repeat(40)}),/INVALID_ADDRESS/);
 assert.throws(()=>direct(f.db,{id:'short',wallet:'0xabc'}),/INVALID_ADDRESS/);
 assert.throws(()=>direct(f.db,{id:'not-hex',wallet:'0x'+'g'.repeat(40)}),/INVALID_ADDRESS/);
 assert.throws(()=>direct(f.db,{id:'zero-address',wallet:'0x'+'0'.repeat(40)}),/INVALID_ADDRESS/);
 f.db.raw.prepare('INSERT INTO economy_gold_accounts(wallet,balance) VALUES(?,?)').run('0x'+'d'.repeat(40),9223372036854775807n);
 assert.throws(()=>direct(f.db,{id:'capacity',wallet:'0x'+'d'.repeat(40)}),/GOLD_BALANCE_CAPACITY/);
 for(let i=0;i<4;i++)direct(f.db,{id:'full'+i,delta:GOLD_GRANT_MAX});
 assert.throws(()=>direct(f.db,{id:'over'}),/GRANT_DAILY_LIMIT/);
 assert.throws(()=>direct(f.db,{id:'rewound',created:NOW-DAY-5}),/GRANT_DAILY_LIMIT/);
 assert.equal(await f.book(),String(GOLD_GRANT_DAILY));
 assert.throws(()=>direct(f.db,{id:'almost',created:NOW+DAY-1}),/GRANT_DAILY_LIMIT/);
 direct(f.db,{id:'next-day',created:NOW+DAY});
 assert.throws(()=>f.db.raw.exec('UPDATE world_gold_grants SET delta=1'),/IMMUTABLE_JOURNAL/);
 assert.throws(()=>f.db.raw.exec('DELETE FROM world_gold_grants'),/IMMUTABLE_JOURNAL/);
});
test('the application guard answers the daily limit itself, because real D1 rewords trigger errors',async t=>{
 const f=await fixture(t);for(let i=0;i<4;i++)direct(f.db,{id:'full'+i,delta:GOLD_GRANT_MAX});
 const original=f.db.batch.bind(f.db);
 f.db.batch=async statements=>{try{return await original(statements);}catch(error){if(/GRANT_DAILY_LIMIT/.test(error.message))throw Error('D1_ERROR: trigger aborted');throw error;}};
 const r=await f.grant('1');assert.equal(r.status,409);assert.equal(r.body.error,'GRANT_DAILY_LIMIT');
});
test('with the application guard defeated, the database trigger still refuses',async t=>{
 const f=await fixture(t);for(let i=0;i<4;i++)direct(f.db,{id:'full'+i,delta:GOLD_GRANT_MAX});
 const original=f.db.prepare.bind(f.db);
 f.db.prepare=sql=>original(sql.replace('<=?',"<=?+1000000"));
 const r=await f.grant('1');assert.notEqual(r.status,200);assert.equal(f.count(),4);assert.equal(await f.book(),String(GOLD_GRANT_DAILY));
});
test('the same grant under a new request id is refused for ten minutes; other grants are not',async t=>{
 const f=await fixture(t),other='0x'+'d'.repeat(40);
 assert.equal((await f.grant('1000')).status,200);
 const again=await f.grant('1000');assert.equal(again.status,409);assert.equal(again.body.error,'GRANT_DUPLICATE_RECENT');assert.equal(await f.book(),'1000');
 assert.equal(f.db.raw.prepare('SELECT COUNT(*) n FROM world_gold_admin_actions').get().n,1);
 assert.equal((await f.grant('999')).status,200);assert.equal((await f.grant('1000',other)).status,200);
 f.now=NOW+GOLD_GRANT_DUPLICATE_MS-1;assert.equal((await f.grant('1000')).body.error,'GRANT_DUPLICATE_RECENT');
 f.now=NOW+GOLD_GRANT_DUPLICATE_MS;assert.equal((await f.grant('1000')).status,200);assert.equal(await f.book(),'2999');
 assert.equal(GOLD_GRANT_DUPLICATE_MS,600000);
});
test('a request id belongs to one wallet, and replaying one still answers with the switch off',async t=>{
 const f=await fixture(t),id=crypto.randomUUID(),token='t'.repeat(43);
 f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(await sha256(token),GRANT_B,NOW-1,NOW+DAY,'grant'+(++seq),'EOA','ECDSA');
 assert.equal((await f.grant('1000',RECIPIENT,id)).status,200);
 assert.equal((await f.grant('1001',RECIPIENT,id,'Fixture tester grant',{from:GRANT_B,token})).status,200);assert.equal(f.count(),2);
 f.deps.grantsEnabled=false;
 assert.equal((await f.grant('1000',RECIPIENT,id)).status,200);assert.equal(f.count(),2);
 assert.equal((await f.grant('5',RECIPIENT)).body.error,'FEATURE_PAUSED');
});
test('another site cannot send a grant',async t=>{
 const f=await fixture(t),r=await f.grant('1000',RECIPIENT,crypto.randomUUID(),'Fixture tester grant',{origin:'https://evil.example'});
 assert.equal(r.status,403);assert.equal(f.count(),0);
});
test('the switch on before the migration leaves the panel working and shows no form',async t=>{
 const f=await fixture(t,GRANT_A,{},migrationFiles().filter(n=>Number(n.slice(0,4))<24));
 const state=await f.state();assert.equal(state.isAdmin,true);assert.equal(state.canGrant,undefined);
 const r=await f.grant();assert.notEqual(r.status,200);
});
test('the form lists the recent grants with no reasons, so a lost answer can be checked',async t=>{
 const f=await fixture(t);
 for(let i=1;i<=12;i++){f.now=NOW+i;assert.equal((await f.grant(String(i))).status,200);}
 const {recentGrants}=await f.state();assert.equal(recentGrants.length,10);
 assert.deepEqual(Object.keys(recentGrants[0]).sort(),['actor','created_ms','gold','id','wallet']);
 assert.equal(recentGrants[0].gold,'12');assert.equal(recentGrants[0].wallet,RECIPIENT);assert.equal(recentGrants[9].gold,'3');
});
test('the form rules: a complete checked grant within the limit, and one id per grant',()=>{
 const good={to:' '+RECIPIENT+' ',gold:'5000',checked:true};assert.equal(grantFormReady(good),true);
 for(const patch of [{checked:false},{gold:'5001'},{gold:'0'},{gold:'01'},{gold:''},{gold:'1.5'},{to:'0x123'},{to:''},{to:'0x'+'0'.repeat(40)}])assert.equal(grantFormReady({...good,...patch}),false,JSON.stringify(patch));
 let n=0;const make=()=>'id'+(++n),first=grantAttemptFor({key:'',id:''},'a',make);
 assert.equal(first.id,'id1');assert.equal(grantAttemptFor(first,'a',make).id,'id1');assert.equal(grantAttemptFor(first,'b',make).id,'id2');
 assert.match(grantError('GRANT_DUPLICATE_RECENT',true),/10 分鐘/);assert.equal(grantError('OTHER',true),'OTHER');
});
test('the client accepts the grant fields and the panel offers the form only when the server says so',async t=>{
 const f=await fixture(t),state=await f.state();
 assert.equal(parseWorldGold(state,GRANT_A).canGrant,true);assert.equal(parseWorldGold(state,GRANT_A).grantLeft,'20000');
 const panel=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/\{data\.canGrant&&<fieldset/);
 assert.match(panel,/disabled=\{!grantFormReady\(\{to:grantTo,gold:grantGold,checked:grantChecked\}\)\}/);
 assert.match(panel,/grantAttempt\.current=grantAttemptFor\(grantAttempt\.current,key,economyRequestId\)/);
 assert.match(panel,/run\(\{action:'grant',wallet:to,gold:grantGold\},grantAttempt\.current\.id\)/);
 assert.match(panel,/client\.admin\(command,reason,requestId\)/);
});
test('a request that lost the race for its id gets the first result, not a refusal',async t=>{
 const f=await fixture(t),id=crypto.randomUUID(),real=f.deps.db;
 const first=await f.grant('1000',RECIPIENT,id);assert.equal(first.status,200);
 // The loser read before the winner wrote: its first look at the record finds nothing.
 let blind=true;
 f.deps.db=new Proxy(real,{get(target,key){
  if(key!=='prepare')return typeof target[key]==='function'?target[key].bind(target):target[key];
  return sql=>{
   if(blind&&sql==='SELECT payload FROM world_gold_admin_actions WHERE id=?'){blind=false;return {bind:()=>({first:async()=>null})};}
   return target.prepare(sql);
  };
 }});
 const lost=await f.grant('1000',RECIPIENT,id);assert.equal(blind,false);
 assert.equal(lost.status,200,JSON.stringify(lost.body));assert.equal(lost.body.result.replayed,true);assert.equal(lost.body.result.id,first.body.result.id);
 assert.equal(f.count(),1);assert.equal(await f.book(),'1000');
 blind=true;
 const other=await f.grant('2000',RECIPIENT,id);assert.equal(other.status,409);assert.equal(other.body.error,'IDEMPOTENCY_CONFLICT');assert.equal(f.count(),1);
});
test('a replay says what it is and carries the id',async t=>{
 const f=await fixture(t),id=crypto.randomUUID();
 const first=await f.grant('1000',RECIPIENT,id),again=await f.grant('1000',RECIPIENT,id);
 assert.equal(again.body.result.replayed,true);assert.equal(again.body.result.id,first.body.result.id);
});
test('a mixed-case address must pass its checksum, because a grant cannot be taken back',async t=>{
 const f=await fixture(t),good=getAddress('0x'+'ab12'.repeat(10));
 const flipped=good.slice(0,2)+[...good.slice(2)].map((c,i)=>i===[...good.slice(2)].findIndex(x=>/[a-fA-F]/.test(x))?(c===c.toUpperCase()?c.toLowerCase():c.toUpperCase()):c).join('');
 const bad=await f.grant('1',flipped);assert.equal(bad.status,409);assert.equal(bad.body.error,'INVALID_ADDRESS_CHECKSUM');assert.equal(f.count(),0);
 assert.equal((await f.grant('1',good)).status,200);
 assert.equal((await f.grant('2',good.toLowerCase())).status,200);
 assert.equal(grantError('INVALID_ADDRESS_CHECKSUM',true).includes('大小寫'),true);
 assert.equal(f.db.raw.prepare('SELECT DISTINCT wallet FROM world_gold_grants').all().length,1);
});
test('a halted or replaced economy accepts no grant',async t=>{
 const halted=await fixture(t),ID=halted.deps.config.id;
 const cols=halted.db.raw.prepare("SELECT name,\"notnull\" nn,type FROM pragma_table_info('economy_chain_state')").all();
 const vals=cols.map(c=>c.name==='config_id'?ID:c.name==='halted_reason'?'TEST':c.type.includes('INT')?0:'x');
 halted.db.raw.prepare('INSERT OR REPLACE INTO economy_chain_state('+cols.map(c=>c.name).join(',')+') VALUES('+cols.map(()=>'?').join(',')+')').run(...vals);
 const r=await halted.grant();assert.equal(r.status,409);assert.equal(r.body.error,'ECONOMY_HALTED');assert.equal(halted.count(),0);
 const replaced=await fixture(t);replaced.db.raw.exec('PRAGMA foreign_keys=OFF');
 replaced.db.raw.prepare("INSERT INTO economy_config_lineage(ancestor_id,config_id,recovery_id) VALUES(?,'next','r')").run(replaced.deps.config.id);
 const s=await replaced.grant();assert.equal(s.status,409);assert.equal(s.body.error,'ECONOMY_CONFIG_REPLACED');assert.equal(replaced.count(),0);
});
test('no more than a hundred grants in 24 hours, in the application and the database',async t=>{
 const f=await fixture(t);
 for(let i=0;i<100;i++)direct(f.db,{id:'n'+i});
 const r=await f.grant();assert.equal(r.status,409);assert.equal(r.body.error,'GRANT_DAILY_LIMIT');
 assert.throws(()=>direct(f.db,{id:'n100'}),/GRANT_DAILY_LIMIT/);assert.equal(f.count(),100);
 f.now=NOW+DAY;assert.equal((await f.grant()).status,200);
 // The count looks back a full day, not only at this moment.
 const late=await fixture(t);for(let i=0;i<100;i++)direct(late.db,{id:'n'+i});
 assert.throws(()=>direct(late.db,{id:'still',created:NOW+DAY-1}),/GRANT_DAILY_LIMIT/);
 direct(late.db,{id:'next-day',created:NOW+DAY});assert.equal(late.count(),101);
 const g=await fixture(t);for(let i=0;i<99;i++)direct(g.db,{id:'n'+i});assert.equal((await g.grant()).status,200);
 // The application's own guard, with the database rule out of the way.
 const h=await fixture(t);for(let i=0;i<100;i++)direct(h.db,{id:'n'+i});
 h.db.raw.exec('DROP TRIGGER world_gold_grant_authority;CREATE TRIGGER world_gold_grant_authority BEFORE INSERT ON world_gold_grants BEGIN SELECT 1; END');
 const refused=await h.grant();assert.equal(refused.status,409);assert.equal(refused.body.error,'GRANT_DAILY_LIMIT');assert.equal(h.count(),100);
 h.now=NOW+DAY;assert.equal((await h.grant()).status,200);
});
test('the database refuses a row with no id or no real reason',async t=>{
 const f=await fixture(t),put=(id,reference,reason)=>f.db.raw.prepare("INSERT INTO world_gold_grants(id,wallet,delta,kind,reference,actor,reason,created_ms) VALUES(?,?,1,'admin-grant',?,?,?,?)").run(id,RECIPIENT,reference,GRANT_A,reason,NOW);
 assert.throws(()=>put(null,'anything','a reason'),/INVALID_REFERENCE/);
 for(const reason of ['','ab','   ','x'.repeat(501)])assert.throws(()=>put('r','admin-grant:r',reason),/REASON_REQUIRED/);
 assert.equal(f.count(),0);put('r','admin-grant:r','abc');assert.equal(f.count(),1);
});
for(const part of ['DROP TRIGGER world_gold_grant_apply','DROP TRIGGER world_gold_grant_authority','DROP TRIGGER world_gold_grants_no_update','DROP TRIGGER world_gold_grants_no_delete'])test('a partly applied migration opens nothing: '+part,async t=>{
 const f=await fixture(t);f.db.raw.exec(part);
 assert.equal((await f.state()).canGrant,undefined);
 const r=await f.grant();assert.equal(r.status,503);assert.equal(r.body.error,'SCHEMA_INCOMPLETE');assert.equal(f.count(),0);
});
test('a history view without grants counts as a partly applied migration',async t=>{
 const f=await fixture(t);f.db.raw.exec("DROP VIEW world_gold_history;CREATE VIEW world_gold_history AS SELECT id,wallet,CAST(delta AS TEXT) delta,kind,reference,created_ms FROM economy_gold_journal");
 assert.equal((await f.state()).canGrant,undefined);assert.equal((await f.grant()).body.error,'SCHEMA_INCOMPLETE');
});
test('the form stays closed for a session that could not send',async t=>{
 const f=await fixture(t);assert.equal((await f.state()).canGrant,true);
 f.db.raw.prepare("UPDATE sessions SET wallet_type='CONTRACT',verification_method='ERC1271'").run();
 assert.equal((await f.state()).canGrant,undefined);
});
test('the panel locks at once against a double click, and sends the address as typed',()=>{
 const panel=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/if\(sending\.current\)return false;sending\.current=true;setBusy\(true\);/);
 assert.match(panel,/finally\{sending\.current=false;setBusy\(false\);/);
 assert.match(panel,/const to=grantTo\.trim\(\),key=/);
});
test('a delivery the vault refuses is reported, and is not treated as delivered',async t=>{
 const f=await fixture(t),wallet='0x'+'b'.repeat(40),orderId='0x'+'c'.repeat(64),errors=[],original=console.error;
 f.db.raw.exec('PRAGMA foreign_keys=OFF');
 f.db.raw.prepare("INSERT INTO economy_orders(id,config_id,wallet,request_id,service_id,currency,amount,request_payload,status,created_ms,expires_ms) VALUES(?,?,?,?,?,'GOLD',1,'[]','paid',?,?)").run(orderId,f.deps.config.id,wallet,'rid','fortune-bazi',NOW,NOW+1);
 f.db.raw.prepare("INSERT INTO celestao_checkouts(id,wallet,product,input_hash,order_id,created_ms,expires_ms) VALUES(?,?,'fortune-bazi',?,?,?,?)").run('r'.repeat(43),wallet,'h'.repeat(64),orderId,NOW,NOW+1);
 const provider=createCelestaoDelivery(f.db,'s'.repeat(64),async()=>new Response('{}',{status:409}),()=>NOW);
 console.error=(...a)=>errors.push(a);t.after(()=>{console.error=original;});
 await assert.rejects(provider.deliver({idempotencyKey:orderId,orderId,wallet,product:'fortune-bazi'}),/DELIVERY_UNAVAILABLE/);
 assert.deepEqual(errors,[['celestao_delivery_refused',orderId]]);
});
