import {mkdirSync,lstatSync,realpathSync,writeFileSync,unlinkSync,existsSync,readdirSync} from 'node:fs';
import {resolve,relative,isAbsolute,join,sep} from 'node:path';

const inside=(parent,path)=>{const r=relative(parent,path);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const hiddenKeys=new Set(['sourceRoot','runtimeExe','runtimeExecutable','executable','cwd']);
export function sanitizeArtifact(value){
  if(Array.isArray(value))return value.map(sanitizeArtifact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!hiddenKeys.has(key))
    .map(([key,item])=>[key,sanitizeArtifact(item)]));
  if(typeof value==='string')return value.replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|tmp)\/)[^\s"'<>|]+/g,'[local-path]');
  return value;
}
export function createArtifactStore({sourceDir,requestedDir=process.env.AUTH_REFERENCE_ARTIFACT_DIR}={}){
  if(!sourceDir)throw new Error('artifact source directory is required');
  if(requestedDir===undefined||requestedDir==='')return {enabled:false,directory:null,write:()=>false,cleanup:()=>0};
  const source=realpathSync(resolve(sourceDir)),allowed=resolve(source,'tmp'),directory=resolve(source,requestedDir);
  if(!inside(allowed,directory))throw new Error('artifacts must use a child directory of source/tmp');
  function validate(){
    if(realpathSync(source)!==source)throw new Error('artifact source changed');
    const components=relative(source,directory).split(sep);let cursor=source;
    for(const component of components){cursor=join(cursor,component);if(!existsSync(cursor))continue;
      if(lstatSync(cursor).isSymbolicLink()||realpathSync(cursor)!==cursor)throw new Error('artifact path cannot traverse a symlink or junction');
      if(!lstatSync(cursor).isDirectory())throw new Error('artifact path component is not a directory');}
  }
  function file(name){
    if(!/^(?:fixed-\d+-[a-z0-9-]+|focused-\d+|core500-(?:RESULT|failure-original|failure-minimized)|audit8-90-(?:RESULT|failure-original|failure-minimized)|LATEST)\.json$/.test(name))
      throw new Error('artifact filename is outside the scheduler namespace');
    validate();const path=join(directory,name);if(existsSync(path)&&(!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink()))throw new Error('artifact output is not a regular file');return path;
  }
  validate();
  return {enabled:true,directory,
    write(name,value){const path=file(name);mkdirSync(directory,{recursive:true});validate();writeFileSync(path,JSON.stringify(sanitizeArtifact(value),null,2)+'\n');return true;},
    cleanup(){validate();if(!existsSync(directory))return 0;let count=0;
      for(const name of readdirSync(directory)){let path;try{path=file(name);}catch(error){if(error.message==='artifact filename is outside the scheduler namespace')continue;throw error;}
        unlinkSync(path);count++;}return count;}};
}
