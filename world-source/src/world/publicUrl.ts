import {PUBLIC_HASHES} from './publicHashes.ts';
// The public files the world loads at startup (models, decor atlases, the Pepe frame) keep their names when their
// content changes, so the site had to serve them "max-age=0, must-revalidate": every visit asked again for each one
// (22 round trips on a repeat visit) before it could use it. A production build also copies each under /assets/ with
// its content hash in the name (scripts/hash-public.mjs, vite.config.ts), which public/_headers caches for a week like
// Vite's own hashed output, and the page loads that copy. The dev server and the tests use the plain paths.

/** The content-hashed copy's path for a public file (no leading slash), or null for a file that has none. */
export function hashedPath(path:string,hashes:Readonly<Record<string,string>>=PUBLIC_HASHES):string|null {
  const hash=hashes[path];if(!hash)return null;const dot=path.lastIndexOf('.');
  return 'assets/'+(dot>path.lastIndexOf('/')?path.slice(0,dot)+'.'+hash+path.slice(dot):path+'.'+hash);
}
const env=(import.meta as {env?:{BASE_URL?:string;PROD?:boolean}}).env;
/** Where the page loads a public file from (`path` has no leading slash): its hashed copy in a production build. */
export function publicUrl(path:string,prod=env?.PROD===true):string {return (env?.BASE_URL??'/')+((prod&&hashedPath(path))||path);}
/** The plain URL of a hashed copy's URL (what publicUrl gives without the build), or null for any other URL. A page
 *  loaded before a deploy asks for hashes the new version no longer has, and after a rollback a browser may hold the
 *  SPA index.html for a week under a hash that has come back; the plain file is always deployed and revalidated. */
export function plainUrl(url:string,hashes:Readonly<Record<string,string>>=PUBLIC_HASHES):string|null {
  const base=env?.BASE_URL??'/';
  for(const path of Object.keys(hashes))if(base+hashedPath(path,hashes)===url)return base+path;
  return null;
}
