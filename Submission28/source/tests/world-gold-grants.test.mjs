import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {GOLD_GRANT_WALLETS,recoverGrantSigner,worldGoldSnapshot} from '../server/world-gold.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from '../server/aimarket-admin.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {parseWorldGold} from '../src/world/worldGoldClient.ts';
import {getAddress} from 'viem';
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {createHash} from 'node:crypto';
import {GOLD_GRANT_DAILY,GOLD_GRANT_DAILY_COUNT,GOLD_GRANT_DUPLICATE_MS,GOLD_GRANT_MAX,GOLD_GRANT_SIGNATURE_ASK_MS,GOLD_GRANT_SIGNATURE_MS,goldGrantMessage} from '../src/shared/goldGrants.ts';
import {createCelestaoDelivery} from '../server/celestao-delivery.ts';
import {grantAttemptFor,grantError,grantFormReady,signedGrantCommand,withinGrantLeft} from '../src/world/goldGrantRules.ts';

const NOW=Date.UTC(2026,9,18),DAY=86400000,ROOT='https://imdember.com',TOKEN='s'.repeat(43),RECIPIENT='0x'+'c'.repeat(40);
const [GRANT_A,THIRD_ADMIN,GRANT_B]=AIMARKET_ACTIVITY_ADMIN_WALLETS,ORDINARY='0x'+'a'.repeat(40);
let seq=0;
async function fixture(t,wallet=GRANT_A,deps={},files){
 const db=openD1(files),config=await defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,tokenDecimals:18,treasury:ECONOMY_TREASURY,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),deploymentBlock:'100',catalogue:[]});
 t.after(()=>db.raw.close());
 db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run(await sha256(TOKEN),wallet,NOW-1,NOW+100*DAY,'grant'+(++seq),'EOA','ECDSA');
 // The grant wallets are real, so no test holds their keys. This stands in for the wallet and for recovery: like real
 // recovery, a signature over any other text yields some other address. The real path is tested below without this.
 const signed=new Map();
 const f={db,wallet,now:NOW,deps:{db,config,allow:async()=>true,grantsEnabled:true,recoverGrantSigner:async({message,signature})=>{const s=signed.get(signature);return s&&s.message===message?s.signer:'0x'+'9'.repeat(40);},...deps}};
 f.deps.now=()=>f.now;
 f.sign=(message,signer=wallet)=>{const signature='0x'+createHash('sha512').update(message+signer).digest('hex').padEnd(130,'0').slice(0,130);signed.set(signature,{message,signer});return signature;};
 f.signed=(over={})=>{const g={origin:ROOT,admin:wallet,to:RECIPIENT,gold:'1000',reason:'Fixture tester grant',requestId:'',expiresMs:f.now+300000,...over};return {expiresMs:g.expiresMs,signature:f.sign(goldGrantMessage(g),g.admin)};};
 f.post=async(command,requestId=crypto.randomUUID(),reason='Fixture tester grant')=>{const response=await handleWorldGoldApi(new Request(ROOT+'/api/gold/admin',{method:'POST',headers:{origin:ROOT,'content-type':'application/json',cookie:SESSION_COOKIE+'='+TOKEN},body:JSON.stringify({expectedAddress:wallet,requestId,reason,command})}),f.deps);return {status:response.status,body:await response.json()};};
 f.grant=async(gold='1000',to=RECIPIENT,requestId=crypto.randomUUID(),reason='Fixture tester grant',{from=wallet,token=TOKEN,origin=ROOT}={})=>{
  const response=await handleWorldGoldApi(new Request(ROOT+'/api/gold/admin',{method:'POST',headers:{origin,'content-type':'application/json',cookie:SESSION_COOKIE+'='+token},body:JSON.stringify({expectedAddress:from,requestId,reason,command:{action:'grant',wallet:to,gold,...f.signed({admin:from,to:String(to),gold:String(gold),reason:String(reason),requestId:String(requestId)})}})}),f.deps);
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
 assert.equal((await f.grant('1000',RECIPIENT)).status,200);
 assert.equal(await f.book(),'1000');
 const snapshot=await worldGoldSnapshot(f.db,RECIPIENT,f.now);assert.deepEqual(snapshot.history.map(h=>[h.kind,h.delta]),[['admin-grant','1000']]);
 const row=f.db.raw.prepare('SELECT wallet,delta,actor,reason FROM world_gold_grants').get();assert.deepEqual({...row},{wallet:RECIPIENT,delta:1000,actor,reason:'Fixture tester grant'});
 const audit=f.db.raw.prepare('SELECT wallet,action,payload,before_json,after_json FROM world_gold_admin_actions').get();
 assert.equal(audit.wallet,actor);assert.equal(audit.action,'grant');{const [cmd,why,proof]=JSON.parse(audit.payload);assert.deepEqual(cmd,{action:'grant',wallet:RECIPIENT,gold:'1000'});assert.equal(why,'Fixture tester grant');assert.equal(proof.expiresMs,NOW+300000);assert.match(proof.signature,/^0x[0-9a-f]{130}$/);}
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
test('the form asks for no signature above what is left in the last 24 hours (audit 447bb70d)',()=>{
 const good={to:RECIPIENT,gold:'2',checked:true};
 assert.equal(grantFormReady({...good,left:'1',count:'96'}),false);assert.equal(grantFormReady({...good,gold:'1',left:'1',count:'96'}),true);
 assert.equal(grantFormReady({...good,left:'20000',count:'0'}),false);assert.equal(grantFormReady({...good,left:'0',count:'5'}),false);
 assert.equal(grantFormReady({...good,gold:'5000',left:'5000',count:'1'}),true);assert.equal(grantFormReady({...good,gold:'4999',left:'04999',count:'1'}),true);
 assert.equal(grantFormReady(good),true,'no allowance read: the server still checks');assert.equal(grantFormReady({...good,left:'?',count:''}),true);
 assert.equal(withinGrantLeft('19999','20000','100'),true);assert.equal(withinGrantLeft('6000','20000','100'),true,'above one grant is grantFormReady\'s job');assert.equal(withinGrantLeft('20000','19999','100'),false);
 for(const zh of [true,false])assert.doesNotMatch(grantError('GRANT_DAILY_LIMIT',zh),/已達|is reached/);
 const panel=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/!withinGrantLeft\(grantGold,data\.grantLeft,data\.grantsLeft\)&&<small role="status">/);
});
test('the client accepts the grant fields and the panel offers the form only when the server says so',async t=>{
 const f=await fixture(t),state=await f.state();
 assert.equal(parseWorldGold(state,GRANT_A).canGrant,true);assert.equal(parseWorldGold(state,GRANT_A).grantLeft,'20000');
 const panel=readFileSync(new URL('../src/world/WorldGoldPanel.tsx',import.meta.url),'utf8');
 assert.match(panel,/\{data\.canGrant&&<fieldset/);
 assert.match(panel,/disabled=\{!grantFormReady\(\{to:grantTo,gold:grantGold,checked:grantChecked,left:data\.grantLeft,count:data\.grantsLeft\}\)\|\|data\.grantLeft==='0'\|\|!signGrant\}/);
 assert.match(panel,/grantAttempt\.current=grantAttemptFor\(grantAttempt\.current,key,economyRequestId\)/);
 assert.match(panel,/run\(\(\)=>signedGrantCommand\(\{[^}]*\}\),id\)/);
 assert.match(panel,/signedGrantCommand\(\{origin:location\.origin,admin:data\.wallet,to,gold:grantGold,reason,requestId:id,now:Date\.now\(\),sign:signGrant\}\)/);
 assert.match(panel,/client\.admin\(typeof command==='function'\?await command\(\):command,reason,requestId\)/);
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
 f.now+=1;const lost=await f.grant('1000',RECIPIENT,id);assert.equal(blind,false);
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

// Audit 37a926e3
test('the session cookie alone creates no GOLD: every grant carries the wallet signature over what it does',async t=>{
 const f=await fixture(t),send=(over={},id=crypto.randomUUID())=>f.post({action:'grant',wallet:RECIPIENT,gold:'1000',...f.signed({requestId:id}),...over},id);
 for(const missing of ['signature','expiresMs']){const id=crypto.randomUUID(),cmd={action:'grant',wallet:RECIPIENT,gold:'1000',...f.signed({requestId:id})};delete cmd[missing];const r=await f.post(cmd,id);assert.equal(r.status,400);assert.equal(r.body.error,'BAD_REQUEST');}
 for(const signature of ['',null,'0x12','0x'+'g'.repeat(130)]){const r=await send({signature});assert.equal(r.status,409);assert.equal(r.body.error,'GRANT_SIGNATURE_REQUIRED');}
 for(const expiresMs of ['1',1.5,null]){const r=await send({expiresMs});assert.equal(r.body.error,'GRANT_SIGNATURE_REQUIRED');}
 assert.equal(f.count(),0);
});
test('a signature is good only for its own recipient, amount, reason, request id, administrator, site and time',async t=>{
 const f=await fixture(t),other='0x'+'d'.repeat(40);
 const tamper=async(signedOver,sent={},reason='Fixture tester grant')=>{const id=sent.requestId??crypto.randomUUID(),proof=f.signed({requestId:id,...signedOver});return f.post({action:'grant',wallet:sent.to??RECIPIENT,gold:sent.gold??'1000',...proof},id,reason);};
 for(const [over,sent,reason] of [[{to:other}],[{gold:'999'}],[{reason:'Another reason here'}],[{requestId:'another-request-id-0001'}],[{origin:'https://evil.example'}],[{admin:GRANT_B}]]){
  const r=await tamper(over,sent,reason);assert.equal(r.status,409,JSON.stringify(over));assert.equal(r.body.error,'INVALID_GRANT_SIGNATURE',JSON.stringify(over));
 }
 const id=crypto.randomUUID(),message=goldGrantMessage({origin:ROOT,admin:GRANT_A,to:RECIPIENT,gold:'1000',reason:'Fixture tester grant',requestId:id,expiresMs:NOW+300000});
 const another=await f.post({action:'grant',wallet:RECIPIENT,gold:'1000',expiresMs:NOW+300000,signature:f.sign(message,GRANT_B)},id);assert.equal(another.body.error,'INVALID_GRANT_SIGNATURE');
 const named=crypto.randomUUID(),forOther=await f.post({action:'grant',wallet:RECIPIENT,gold:'1000',expiresMs:NOW+300000,signature:f.sign(goldGrantMessage({origin:ROOT,admin:GRANT_B,to:RECIPIENT,gold:'1000',reason:'Fixture tester grant',requestId:named,expiresMs:NOW+300000}),GRANT_A)},named);assert.equal(forOther.body.error,'INVALID_GRANT_SIGNATURE');
 assert.equal(GOLD_GRANT_SIGNATURE_MS,600000);
 assert.equal(f.count(),0);
 for(const expiresMs of [NOW,NOW-1,NOW+GOLD_GRANT_SIGNATURE_MS+1]){const r=await tamper({expiresMs});assert.equal(r.status,409,String(expiresMs));assert.equal(r.body.error,'GRANT_SIGNATURE_EXPIRED',String(expiresMs));}
 assert.equal(f.count(),0);
 assert.equal((await tamper({expiresMs:NOW+GOLD_GRANT_SIGNATURE_MS})).status,200);assert.equal(f.count(),1);
 const late=crypto.randomUUID(),old=f.signed({requestId:late,to:other});f.now+=300000;const r=await f.post({action:'grant',wallet:other,gold:'1000',...old},late);assert.equal(r.body.error,'GRANT_SIGNATURE_EXPIRED');
});
test('the real recovery takes a real signature and nothing else, and production never replaces it',async t=>{
 const key=generatePrivateKey(),account=privateKeyToAccount(key),message=goldGrantMessage({origin:ROOT,admin:account.address,to:RECIPIENT,gold:'1000',reason:'Fixture tester grant',requestId:'request-id-0000000001',expiresMs:NOW+1});
 const signature=await account.signMessage({message});
 assert.equal(await recoverGrantSigner({message,signature}),account.address);
 assert.notEqual(await recoverGrantSigner({message:message+' ',signature}),account.address);
 const f=await fixture(t,GRANT_A,{recoverGrantSigner:undefined}),id=crypto.randomUUID(),real=await account.signMessage({message:goldGrantMessage({origin:ROOT,admin:GRANT_A,to:RECIPIENT,gold:'1000',reason:'Fixture tester grant',requestId:id,expiresMs:NOW+300000})});
 const refused=await f.post({action:'grant',wallet:RECIPIENT,gold:'1000',expiresMs:NOW+300000,signature:real},id);assert.equal(refused.status,409);assert.equal(refused.body.error,'INVALID_GRANT_SIGNATURE');
 const garbage=crypto.randomUUID(),r=await f.post({action:'grant',wallet:RECIPIENT,gold:'1000',expiresMs:NOW+300000,signature:'0x'+'0'.repeat(130)},garbage);assert.equal(r.body.error,'INVALID_GRANT_SIGNATURE');
 assert.equal(f.count(),0);
 for(const file of ['../worker/app.ts','../server/vite-plugin.ts'])assert.doesNotMatch(readFileSync(new URL(file,import.meta.url),'utf8'),/recoverGrantSigner/);
});
test('a grant completes through real recovery of a real signature, and the expiry it signed is the one it must send',async t=>{
 // The real wallets' keys are not here: the only stand-in is the step that says this test key is that wallet, and it answers checksummed as recovery does.
 const account=privateKeyToAccount(generatePrivateKey());
 const f=await fixture(t,GRANT_A,{recoverGrantSigner:async signed=>{const a=await recoverGrantSigner(signed);return a===account.address?getAddress(GRANT_A):a;}}),expiresMs=NOW+300000;
 const signatureFor=(id,reason='Fixture tester grant')=>account.signMessage({message:goldGrantMessage({origin:ROOT,admin:GRANT_A,to:RECIPIENT,gold:'1000',reason,requestId:id,expiresMs})});
 const later=crypto.randomUUID(),moved=await f.post({action:'grant',wallet:RECIPIENT,gold:'1000',expiresMs:expiresMs+1,signature:await signatureFor(later)},later);assert.equal(moved.body.error,'INVALID_GRANT_SIGNATURE');assert.equal(f.count(),0);
 const id=crypto.randomUUID(),r=await f.post({action:'grant',wallet:RECIPIENT,gold:'1000',expiresMs,signature:await signatureFor(id)},id);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(f.count(),1);assert.equal(await f.book(),'1000');
});
test('what the panel builds is accepted by the server as it stands, for any reason it allows',async t=>{
 const f=await fixture(t);
 for(const [i,reason] of ['  前後有空白 的原因  ','測試 🎉 emoji','quote " back\\slash','line\nbreak\u2028here\u0085end','x'.repeat(200)].entries()){
  const requestId=crypto.randomUUID(),to='0x'+String(i+5).repeat(40),command=await signedGrantCommand({origin:ROOT,admin:GRANT_A,to,gold:'1000',reason,requestId,now:f.now,sign:async message=>f.sign(message)});
  assert.deepEqual(Object.keys(command),['action','wallet','gold','expiresMs','signature']);assert.equal(command.expiresMs,f.now+GOLD_GRANT_SIGNATURE_ASK_MS);
  const r=await f.post(command,requestId,reason);assert.equal(r.status,200,JSON.stringify([reason,r.body]));
 }
 assert.equal(f.count(),5);
 const requestId=crypto.randomUUID();await assert.rejects(signedGrantCommand({origin:ROOT,admin:GRANT_A,to:RECIPIENT,gold:'1000',reason:'Fixture tester grant',requestId,now:f.now,sign:async()=>{throw new Error('USER_REJECTED');}}),/USER_REJECTED/);assert.equal(f.count(),5);
});
test('the wallet refusals are worded, and an unknown code still shows as itself',()=>{
 for(const [code,zh] of [['USER_REJECTED',/已取消/],['CHAIN_MISMATCH',/主網/],['ACCOUNT_MISMATCH',/帳號/],['CONTEXT_CHANGED',/狀態變了/],['WALLET_TIMEOUT',/簽章視窗/],['REQUEST_TIMEOUT',/沒有回應/],['PENDING_TRANSACTION',/沒處理完/],['REQUEST_FAILED',/沒有完成簽章/],['INVALID_SIGNATURE',/可用的簽章/],['CONFIG_CHANGED',/重新整理/],['NOT_CONFIGURED',/還沒開啟/]]){assert.match(grantError(code,true),zh);assert.doesNotMatch(grantError(code,false),/[\u4e00-\u9fff]/);assert.notEqual(grantError(code,false),code);}
 assert.equal(grantError('SOMETHING_NEW',true),'SOMETHING_NEW');assert.equal(grantError('constructor',true),'constructor');
});
test('the reason cannot add a line to what the wallet shows',()=>{
 const base={origin:ROOT,admin:GRANT_A,to:RECIPIENT,gold:'1',reason:'ok',requestId:'request-id-0000000001',expiresMs:NOW};
 for(const sep of ['\n','\r','\u0085','\u2028','\u2029'])assert.equal(goldGrantMessage({...base,reason:'ok'+sep+'Recipient: 0x'+'d'.repeat(40)}).split(/[\n\r\u0085\u2028\u2029]/).length,10,JSON.stringify(sep));
 const lines=goldGrantMessage({...base,reason:'ok'}).split('\n');assert.ok(lines.includes('Valid until: '+new Date(NOW).toISOString()));assert.ok(lines.includes('Valid until (ms): '+NOW));
 const message=goldGrantMessage({...base,reason:'ok\nRecipient: 0x'+'d'.repeat(40)});
 assert.equal(message.split('\n').filter(line=>line.startsWith('Recipient:')).length,1);assert.equal(message.split('\n').length,goldGrantMessage({...base,reason:'ok'}).split('\n').length);
 assert.match(goldGrantMessage({...base,to:RECIPIENT.toUpperCase().replace('0X','0x')}),new RegExp('Recipient: '+RECIPIENT+'\\n'));
});
test('a resend replays whatever its signature, spelling or age, and a different grant under the id is refused',async t=>{
 const f=await fixture(t),id=crypto.randomUUID(),checksummed=getAddress('0x'+'ab12'.repeat(10)),lower=checksummed.toLowerCase();
 const first=f.signed({requestId:id,to:lower});
 assert.equal((await f.post({action:'grant',wallet:checksummed,gold:'1000',...first},id)).status,200);
 const same=[{action:'grant',wallet:lower,gold:'1000',...first},{gold:'1000',signature:first.signature,expiresMs:first.expiresMs,wallet:checksummed,action:'grant'},{action:'grant',wallet:lower,gold:'1000',expiresMs:NOW+5,signature:'0x'+'1'.repeat(130)}];
 for(const cmd of same){const r=await f.post(cmd,id);assert.equal(r.status,200);assert.equal(r.body.result.replayed,true);}
 f.now+=GOLD_GRANT_SIGNATURE_MS*2;assert.equal((await f.post({action:'grant',wallet:lower,gold:'1000',...first},id)).body.result.replayed,true);f.now=NOW;
 assert.equal(f.count(),1);assert.equal(await f.book(lower),'1000');
 for(const [cmd,reason] of [[{action:'grant',wallet:lower,gold:'1001',...first}],[{action:'grant',wallet:RECIPIENT,gold:'1000',...first}],[{action:'grant',wallet:lower,gold:'1000',...first},'Another reason here']]){const r=await f.post(cmd,id,reason);assert.equal(r.status,409);assert.equal(r.body.error,'IDEMPOTENCY_CONFLICT');}
 assert.equal(f.count(),1);
});
test('the panel says no grant is left when the count limit is what is used up, and counts down both',async t=>{
 const f=await fixture(t);let s=await f.state();assert.equal(s.grantLeft,'20000');assert.equal(s.grantsLeft,'100');
 direct(f.db,{id:'first',delta:7});s=await f.state();assert.equal(s.grantLeft,'19993');assert.equal(s.grantsLeft,'99');
 for(let i=0;i<99;i++)direct(f.db,{id:'n'+i});s=await f.state();assert.equal(s.grantLeft,'0');assert.equal(s.grantsLeft,'0');
 f.now+=DAY+1;s=await f.state();assert.equal(s.grantLeft,'20000');assert.equal(s.grantsLeft,'100');
});
test('anything but all-lowercase must pass the checksum, including all-uppercase',async t=>{
 const f=await fixture(t),good=getAddress('0x'+'ab12'.repeat(10)),upper='0x'+good.slice(2).toUpperCase(),lower=good.toLowerCase();
 assert.notEqual(good,upper);
 for(const wrong of [upper,good.replace(/[a-f]/,c=>c.toUpperCase())]){const r=await f.grant('1',wrong);assert.equal(r.status,409,wrong);assert.equal(r.body.error,'INVALID_ADDRESS_CHECKSUM',wrong);}
 assert.equal(f.count(),0);
 assert.equal((await f.grant('1',good)).status,200);assert.equal((await f.grant('2',lower)).status,200);assert.equal(await f.book(lower),'3');
});
test('a recipient known to be a contract wallet is refused, an unknown or ordinary one is not',async t=>{
 const f=await fixture(t),contract='0x'+'d'.repeat(40),ordinary='0x'+'e'.repeat(40),old='0x'+'f'.repeat(40);
 const session=(address,type,method)=>f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,?,?)').run('h'+(++seq),address,NOW-1,NOW+DAY,'grant'+seq,type,method);
 session(contract,'CONTRACT','ERC1271');session(ordinary,'EOA','ECDSA');session(old,null,null);
 const mixed='0x'+'4'.repeat(40);session(mixed,'EOA','ERC1271');assert.equal((await f.grant('5000',mixed)).body.error,'RECIPIENT_NOT_EOA');
 const r=await f.grant('5000',contract);assert.equal(r.status,409);assert.equal(r.body.error,'RECIPIENT_NOT_EOA');assert.equal(await f.book(contract),'0');assert.equal(f.count(),0);
 assert.equal((await f.grant('1',ordinary)).status,200);assert.equal((await f.grant('1',old)).status,200);assert.equal((await f.grant('1','0x'+'3'.repeat(40))).status,200);
 assert.match(grantError('RECIPIENT_NOT_EOA',true),/合約錢包/);
});
test('the send form stays closed when no economy config is loaded',async t=>{
 const f=await fixture(t,GRANT_A,{config:null}),s=await f.state();assert.equal(s.canGrant,undefined);assert.equal(s.grantLeft,undefined);assert.equal(s.grantsLeft,undefined);
 assert.equal((await f.grant()).status,503);
});
test('every signature refusal reads as a sentence',()=>{
 for(const code of ['GRANT_SIGNATURE_EXPIRED','INVALID_GRANT_SIGNATURE','GRANT_SIGNATURE_REQUIRED'])for(const zh of [true,false])assert.notEqual(grantError(code,zh),code);
});
