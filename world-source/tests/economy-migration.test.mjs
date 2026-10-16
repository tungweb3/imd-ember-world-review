import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtempSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {openD1,migrationFiles} from './d1-sqlite.mjs';
import {readSession,sha256,SESSION_COOKIE} from '../server/auth.ts';
const NOW=Date.UTC(2026,9,16),W='0x'+'a'.repeat(40),TOKEN='b'.repeat(43);

test('new schema preserves verified login and old data; pre-migration SQLite backup really restores independently',async()=>{
 const previous=migrationFiles().filter(f=>!/^001[01]_/.test(f)),db=openD1(previous),folder=mkdtempSync(join(tmpdir(),'ember-economy-migration-'));
 let restored;
 try{
  const tokenHash=await sha256(TOKEN);
  db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(tokenHash,W,1,NOW-1,NOW+60000,'migration-fixture-session','EOA','ECDSA');
  const before=db.raw.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),oldEconomyNames=db.raw.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'economy_%' ORDER BY name").all();
  const filename=join(folder,'before-economy.sqlite');await backup(db.raw,filename);
  db.raw.exec('BEGIN');try{for(const f of migrationFiles().filter(f=>/^001[01]_/.test(f)))db.raw.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));db.raw.exec('COMMIT');}catch(e){db.raw.exec('ROLLBACK');throw e;}
  assert.deepEqual(db.raw.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),before);
  for(const table of ['economy_gold_accounts','economy_gold_journal','economy_chain_events','economy_pending_blocks'])assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  const session=await readSession(new Request('https://imdember.com/api/me/economy',{headers:{cookie:SESSION_COOKIE+'='+TOKEN}}),db,NOW);assert.equal(session.address,W);assert.equal(session.verificationMethod,'ECDSA');
  restored=new DatabaseSync(filename,{readOnly:true});assert.deepEqual(restored.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),before);assert.deepEqual(restored.prepare("SELECT name FROM sqlite_schema WHERE name LIKE 'economy_%' ORDER BY name").all(),oldEconomyNames);
  assert.ok(restored.prepare('PRAGMA integrity_check').get().integrity_check==='ok');assert.ok(db.raw.prepare('PRAGMA integrity_check').get().integrity_check==='ok');
 }finally{restored?.close();db.raw.close();assert.ok(realpathSync(folder).toLowerCase().startsWith((realpathSync(tmpdir())+sep).toLowerCase()));assert.ok(folder.includes('ember-economy-migration-'));rmSync(folder,{recursive:true,force:true});}
});
