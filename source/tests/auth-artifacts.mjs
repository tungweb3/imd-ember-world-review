import {mkdirSync,lstatSync,realpathSync,writeFileSync,unlinkSync,readdirSync,openSync,fstatSync,fsyncSync,closeSync,renameSync,constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,relative,isAbsolute,join,sep} from 'node:path';

const inside=(parent,path)=>{const r=relative(parent,path);return r!==''&&!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r);};
const hiddenKeys=new Set(['sourceRoot','runtimeExe','runtimeExecutable','executable','cwd']);
// These are protocol identifiers emitted by the scheduler, not filesystem paths.
const routeIds=new Set(['/api/auth/session','/api/auth/challenge','/api/auth/verify','/api/auth/logout','/api/auth/logout-all','/api/me/home','/api/me/home?fresh=1','/api/me/home/refresh']);
const absoluteStart=/(?<![A-Za-z0-9._~%+\\/-])(?:file:\/\/|[A-Za-z]:[\\/]|[\\/])/gi;
// A single-letter "scheme" is a Windows drive, even with repeated slash separators.
const networkURLs=/\b(?!file:)[A-Za-z][A-Za-z0-9+.-]+:\/\/[^\s"'<>]+/gi;
function sanitizeBare(chunk){
  absoluteStart.lastIndex=0;let match;
  while((match=absoluteStart.exec(chunk))){
    const route=[...routeIds].find(id=>chunk.startsWith(id,match.index)&&/^(?:$|[\s.,;|)"'<>])/.test(chunk.slice(match.index+id.length)));
    if(route){absoluteStart.lastIndex=match.index+route.length;continue;}
    // A bare path may contain spaces/parentheses. Its end is ambiguous: conservatively
    // remove the remainder of this freeform line segment, rather than leak its suffix.
    return chunk.slice(0,match.index)+'[local-path]'+(chunk.match(/[ \t]*$/)?.[0]??'');
  }
  return chunk;
}
function sanitizeNonURL(chunk){
  // An explicit conjunction between two absolute paths retains existing diagnostics.
  return chunk.split(/([ \t]+and[ \t]+(?=(?:file:\/\/|[A-Za-z]:[\\/]|[\\/])))/i).map(sanitizeBare).join('');
}
function sanitizeLine(line){
  // Quotes provide an explicit end to a path; later prose/identifiers remain intact.
  const quoted=line.replace(/(["'])(file:\/\/[^"'<>|]+|[A-Za-z]:[\\/][^"'<>|]+|[\\/][^"'<>|]+)\1/g,
    (match,quote,path)=>routeIds.has(path)?match:quote+'[local-path]'+quote);
  let out='',cursor=0;
  for(const match of quoted.matchAll(networkURLs)){out+=sanitizeNonURL(quoted.slice(cursor,match.index))+match[0];cursor=match.index+match[0].length;}
  return out+sanitizeNonURL(quoted.slice(cursor));
}
function sanitizeString(value){
  // Never consume another diagnostic line or a separate structured replay value.
  return value.split(/(\r\n|\n|\r)/).map(part=>/^(?:\r\n|\n|\r)$/.test(part)?part:sanitizeLine(part)).join('');
}
export function sanitizeArtifact(value){
  if(Array.isArray(value))return value.map(sanitizeArtifact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!hiddenKeys.has(key))
    .map(([key,item])=>[sanitizeString(key),sanitizeArtifact(item)]));
  if(typeof value==='string')return sanitizeString(value);
  return value;
}
// Unlike existsSync, lstat observes dangling symbolic links. Only absence is ignored.
function entry(path){try{return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const same=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino;
function regular(path){const stat=entry(path);if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw new Error('artifact output is not a regular file');return stat;}
export function createArtifactStore({sourceDir,requestedDir=process.env.AUTH_REFERENCE_ARTIFACT_DIR}={}){
  if(!sourceDir)throw new Error('artifact source directory is required');
  if(requestedDir===undefined||requestedDir==='')return {enabled:false,directory:null,write:()=>false,cleanup:()=>0};
  const source=realpathSync(resolve(sourceDir)),allowed=resolve(source,'tmp'),directory=resolve(source,requestedDir),sourceStat=entry(source);
  if(!inside(allowed,directory))throw new Error('artifacts must use a child directory of source/tmp');
  function validate(create=false){
    if(!same(sourceStat,entry(source))||realpathSync(source)!==source||!sourceStat.isDirectory())throw new Error('artifact source changed');
    const chain=[{path:source,stat:sourceStat}];let cursor=source;
    for(const component of relative(source,directory).split(sep)){
      cursor=join(cursor,component);let stat=entry(cursor);
      if(!stat&&create){try{mkdirSync(cursor);}catch(error){if(error.code!=='EEXIST')throw error;}stat=entry(cursor);}
      if(!stat){if(create)throw new Error('artifact directory disappeared');continue;}
      if(stat.isSymbolicLink()||realpathSync(cursor)!==cursor)throw new Error('artifact path cannot traverse a symlink or junction');
      if(!stat.isDirectory())throw new Error('artifact path component is not a directory');
      chain.push({path:cursor,stat});
    }
    return chain;
  }
  function file(name){
    if(!/^(?:fixed-\d+-[a-z0-9-]+|focused-\d+|core500-(?:RESULT|failure-original|failure-minimized)|audit8-90-(?:RESULT|failure-original|failure-minimized)|LATEST)\.json$/.test(name))
      throw new Error('artifact filename is outside the scheduler namespace');
    validate();const path=join(directory,name);regular(path);return path;
  }
  function unchanged(chain){
    const now=validate();
    if(now.length!==chain.length||chain.some((item,i)=>item.path!==now[i].path||!same(item.stat,now[i].stat)))throw new Error('artifact parent changed before finalization');
  }
  validate();
  return {enabled:true,directory,
    write(name,value){
      const path=file(name),chain=validate(true);regular(path);
      const temp=join(directory,`.${name}.${randomBytes(12).toString('hex')}.tmp`);
      let fd=null,tempStat=null,renamed=false;
      try{
        // Serialization may invoke caller getters: validate again after it, before any I/O.
        const body=JSON.stringify(sanitizeArtifact(value),null,2)+'\n';unchanged(chain);regular(path);
        // O_NOFOLLOW is available on POSIX; O_EXCL|O_CREAT is mandatory on Windows too.
        fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
        tempStat=fstatSync(fd);if(!tempStat.isFile()||tempStat.nlink!==1)throw new Error('artifact temporary output is not an exclusive regular file');
        unchanged(chain);
        writeFileSync(fd,body);fsyncSync(fd);closeSync(fd);fd=null;
        unchanged(chain);regular(path);
        const finalTemp=entry(temp);if(!same(tempStat,finalTemp)||!finalTemp.isFile()||finalTemp.isSymbolicLink()||finalTemp.nlink!==1)throw new Error('artifact temporary output changed');
        // Explicit policy: replace absent/regular entries by renaming the complete sibling.
        // No direct write/open of the final path, including during replacement.
        renameSync(temp,path);renamed=true;return true;
      }finally{
        if(fd!==null)closeSync(fd);
        if(!renamed&&tempStat){
          // Never follow an ancestry replacement while tidying a failed write.
          try{unchanged(chain);const stat=entry(temp);if(same(tempStat,stat)&&stat.isFile()&&!stat.isSymbolicLink())unlinkSync(temp);}catch{}
        }
      }
    },
    cleanup(){validate();if(!entry(directory))return 0;let count=0;
      for(const name of readdirSync(directory)){let path;try{path=file(name);}catch(error){if(error.message==='artifact filename is outside the scheduler namespace')continue;throw error;}
        unlinkSync(path);count++;}return count;}};
}
