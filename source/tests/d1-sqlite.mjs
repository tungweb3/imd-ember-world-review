import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
// A D1-shaped adapter over node:sqlite that runs the real migrations/ files, so tests exercise the production SQL.
// batch() is one transaction (BEGIN/COMMIT, ROLLBACK on any error), as D1 documents. Values bound as undefined are null.
const dir=new URL('../migrations/',import.meta.url);
export function migrationFiles(){return readdirSync(dir).filter(f=>/^\d{4}_.+\.sql$/.test(f)).sort();}
/** `files`: the migrations to run (default all; a test of a deploy that ran ahead of a migration passes fewer). */
export function openD1(files=migrationFiles()){
  const db=new DatabaseSync(':memory:');
  for(const f of files)db.exec(readFileSync(new URL(f,dir),'utf8'));
  const exec=(sql,args)=>{
    const s=db.prepare(sql),values=args.map(v=>v===undefined?null:v);
    if(/^\s*(select|with)\b/i.test(sql)||/\breturning\b/i.test(sql))return {results:s.all(...values).map(r=>({...r})),success:true,meta:{changes:0}};
    const r=s.run(...values);return {results:[],success:true,meta:{changes:Number(r.changes)}};
  };
  const statement=(sql,args=[])=>({sql,args,
    bind:(...values)=>statement(sql,values),
    first:async()=>{const r=db.prepare(sql).get(...args.map(v=>v===undefined?null:v));return r?{...r}:null;},
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
