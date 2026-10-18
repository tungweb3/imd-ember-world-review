import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
/** Local adapter only. Same SQL and atomic batch semantics as the D1 binding. */
export function openGoldDatabase(filename=':memory:',{privateChain=false}={}){
 const raw=new DatabaseSync(filename);raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;');
 raw.exec('CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY)');
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort()){
  if(raw.prepare('SELECT name FROM _local_migrations WHERE name=?').get(name))continue;
  let sql=readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
  // Fixture schema profile only: the sealed R4 contract requires 31337. The
  // production SQL remains mainnet-only; exact-SQL tests use the default profile.
  if(privateChain&&name==='0013_economy_reconciliation.sql'){if(!sql.includes('CHECK(chain_id=1)'))throw Error('FIXTURE_SCHEMA_PROFILE_CHANGED');sql=sql.replace('CHECK(chain_id=1)','CHECK(chain_id=31337)');}
  raw.exec('BEGIN');try{raw.exec(sql);raw.prepare('INSERT INTO _local_migrations VALUES(?)').run(name);raw.exec('COMMIT');}catch(e){raw.exec('ROLLBACK');throw e;}
 }
 const exec=(sql,args)=>{const s=raw.prepare(sql);if(/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql))return {results:s.all(...args),success:true,meta:{changes:0}};const r=s.run(...args);return {results:[],success:true,meta:{changes:Number(r.changes)}};};
 const statement=(sql,args=[])=>({sql,args,bind:(...v)=>statement(sql,v),
  first:async()=>raw.prepare(sql).get(...args)??null,
  all:async()=>({results:raw.prepare(sql).all(...args),success:true,meta:{changes:0}}),
  run:async()=>exec(sql,args)});
 const db={raw,prepare:sql=>statement(sql),batch:async list=>{raw.exec('BEGIN');try{const out=list.map(s=>exec(s.sql,s.args));raw.exec('COMMIT');return out;}catch(e){raw.exec('ROLLBACK');throw e;}}};
 return db;
}
