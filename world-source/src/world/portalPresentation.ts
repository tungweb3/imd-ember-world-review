import {RESEARCH_ORIGIN} from './aimarketEntry.ts';
/** The local fixture changes presentation origins only. It never changes server authority. */
export function researchPresentationOrigin(location:{hostname:string;port:string;search:string}):string{
 return location.hostname==='localhost'&&location.port==='5771'&&new URLSearchParams(location.search).get('debug')==='1'?'http://localhost:5772':RESEARCH_ORIGIN;
}
