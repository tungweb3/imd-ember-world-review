import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
// A D1-shaped adapter over node:sqlite that runs the real migrations/ files, so tests exercise the production SQL.
// batch() is one transaction (BEGIN/COMMIT, ROLLBACK on any error), as D1 documents. Values bound as undefined are null.
const dir=new URL('../migrations/',import.meta.url);
export function migrationFiles(){return readdirSync(dir).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort();}
/** Historical standalone catalogue profile, before shared GOLD existed. Keep
 * its original assertions distinct from current shared-schema route refusals. */
export function openStandaloneEconomyD1(files=migrationFiles().filter(f=>Number(f.slice(0,4))<14)){return openD1(files);}
/** `files`: the migrations to run (default all; a test of a deploy that ran ahead of a migration passes fewer). */
export function openD1(files=migrationFiles(),filename=':memory:'){
  const db=new DatabaseSync(filename);
  for(const f of files)db.exec(readFileSync(new URL(f,dir),'utf8'));
  // Production D1 refuses a BigInt bind (D1_TYPE_ERROR); node:sqlite would accept it, so the adapter refuses it too
  // (2026-10-26: fast GOLD credit passed here and failed on D1).
  const value=v=>{if(typeof v==='bigint')throw Error(`D1_TYPE_ERROR: Type 'bigint' not supported for value '${v}'`);return v===undefined?null:v;};
  const exec=(sql,args)=>{
    const s=db.prepare(sql),values=args.map(value);
    if(/^\s*(select|with)\b/i.test(sql)||/\breturning\b/i.test(sql))return {results:s.all(...values).map(r=>({...r})),success:true,meta:{changes:0}};
    const r=s.run(...values);return {results:[],success:true,meta:{changes:Number(r.changes)}};
  };
  const statement=(sql,args=[])=>({sql,args,
    bind:(...values)=>statement(sql,values),
    first:async()=>{const r=db.prepare(sql).get(...args.map(value));return r?{...r}:null;},
    all:async()=>exec(sql,args),
    run:async()=>exec(sql,args)});
  return {raw:db,
    prepare:sql=>statement(sql),
    batch:async statements=>{
      db.exec('BEGIN');
      try{const out=statements.map(s=>exec(s.sql,s.args));db.exec('COMMIT');return out;}
      catch(error){db.exec('ROLLBACK');throw error;}
    }};
}
