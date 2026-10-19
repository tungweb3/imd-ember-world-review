import {sha256} from './auth.ts';
export const RESEARCH_ORIGIN='https://research.imdember.com';
export const RESEARCH_CONTEXT_HEADER='X-Ember-Research-Context';
const UPSTREAM='https://aimarket.trade',WORLD='https://imdember.com';
const COOKIES=['__Host-aim_world_flow','__Host-aim_world_holder'];
const OPAQUE=/^[A-Za-z0-9_-]{43}$/;
const STATIC=/^\/public\/(?:hero\.jpg|(?:app|holder-access|research-detail|imd-daily|new-tokens|portal-result|gate)\.js|(?:site|holder-access|research-detail|imd-daily|new-tokens|player|gate)\.css|vendor\/lightweight-charts-5\.2\.1\.js|audio\/[a-z0-9-]+\.mp3)$/;
// These fixed files contain public UI code/media, never research or session
// data. Keep the auth result path out of this cache boundary. Query versions
// are release hints rather than content hashes, so use a short bounded TTL.
function publicAssetType(path:string):readonly string[]|null {
 if(!STATIC.test(path)||path==='/public/portal-result.js')return null;
 if(path.endsWith('.js'))return ['text/javascript','application/javascript'];
 if(path.endsWith('.css'))return ['text/css'];
 if(path.endsWith('.jpg'))return ['image/jpeg'];
 if(path.endsWith('.mp3'))return ['audio/mpeg'];
 return null;
}
const FIXED=new Set(['/api/holder/status','/api/holder/world/start','/api/holder/world/callback','/api/public/overview','/api/public/quotes','/api/public/btc','/api/public/services','/api/imd-daily/preview','/api/imd-daily/latest','/api/imd-daily/history','/api/new-tokens/preview','/api/new-tokens/latest']);
export function researchCookies(raw:string):string|null {
 const selected=new Map<string,string>();
 for(const item of raw.split(';')){const at=item.indexOf('=');if(at<0)continue;const name=item.slice(0,at).trim(),value=item.slice(at+1).trim();
  if(!COOKIES.includes(name))continue;if(selected.has(name)||!OPAQUE.test(value))return null;selected.set(name,value);}
 return [...selected].sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>name+'='+value).join('; ');
}
export function researchRoute(url:URL,method:string):boolean {
 if(url.href.length>4096||/%(?:2f|5c|2e)/i.test(url.pathname)||url.pathname.includes('..'))return false;
 const path=url.pathname;
 if(method==='POST')return path==='/api/holder/logout'&&!url.search;
 if(method!=='GET'&&method!=='HEAD')return false;
 const allowed=path==='/'||path==='/portal-result'||path==='/api/owner/status'||STATIC.test(path)||FIXED.has(path)||
  /^\/api\/public\/assets\/(BTC|ETH)\/(research|chart)$/.test(path)||/^\/api\/imd-daily\/(?:\d{4}-\d{2}-\d{2}|previous\/[a-f0-9]{64})$/.test(path);
 if(!allowed)return false;
 const keys=path==='/'?['portal','lang','world_login','expected_address']:path==='/portal-result'?['lang','world_login']:STATIC.test(path)?['v']:path.endsWith('/start')?['lang','expected_address']:path.endsWith('/callback')?['lang','state','code','error']:path.endsWith('/chart')?['interval']:path.endsWith('/history')?['limit']:[];
 const seen=new Set<string>();for(const [key,value]of url.searchParams){if(!keys.includes(key)||seen.has(key)||value.length>160)return false;seen.add(key);}
 return true;
}
export async function researchContext(secret:string,method:string,path:string,query:string,at:number,cookie:string):Promise<string>{
 const payload='ember-research-proxy-v1\n'+method+'\n'+path+'\n'+query+'\n'+at+'\n'+await sha256(cookie);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload)));
 return 'v1.'+at+'.'+[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');
}
type Deps={secret?:string;fetcher?:typeof fetch;now?:()=>number;client?:string;allow?:(key:string)=>Promise<boolean>;
  // Explicit in-process HTTP fixture only; never read from production env/query.
  testConfig?:{origin:string;upstream:string;parent:string}};
function origins(deps:Deps){
 if(!deps.testConfig)return {origin:RESEARCH_ORIGIN,upstream:UPSTREAM,parent:WORLD};
 try{const values=deps.testConfig,hosts=new Set(['localhost','127.0.0.1','[::1]']);
  for(const value of [values.origin,values.upstream,values.parent]){const url=new URL(value);if(url.protocol!=='http:'||!hosts.has(url.hostname)||url.origin!==value||url.username||url.password)return null;}
  return values;
 }catch{return null;}
}
const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleAIMarketProxy(request:Request,deps:Deps):Promise<Response|null>{
 const cfg=origins(deps);if(!cfg)return reply(503,'PORTAL_UNAVAILABLE');
 const url=new URL(request.url);if(url.origin!==cfg.origin)return null;
 if(!researchRoute(url,request.method))return reply(404,'PORTAL_ROUTE_NOT_AVAILABLE');
 if(!deps.secret||deps.secret.length<32||deps.secret.length>256||/\s/.test(deps.secret)||!deps.allow)return reply(503,'PORTAL_UNAVAILABLE');
 try{if(!await deps.allow('research:'+String(deps.client??'unknown')+':'+url.pathname))return reply(429,'RATE_LIMITED');}catch{return reply(503,'PORTAL_UNAVAILABLE');}
 if(url.pathname==='/api/owner/status')return new Response(JSON.stringify({owner:false,configured:false,expires_at:null}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 const assetTypes=publicAssetType(url.pathname);
 // An asset request must not send holder cookies to the VPS, including on a
 // cache miss. This makes the cacheable body independent of visitor identity.
 const cookie=assetTypes?'':researchCookies(request.headers.get('cookie')??'');if(cookie===null)return reply(400,'BAD_COOKIE');
 let body:string|undefined;
 if(request.method==='POST'){
  if(request.headers.get('origin')!==cfg.origin||!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type')??'')||Number(request.headers.get('content-length'))>1024)return reply(403,'ORIGIN_NOT_ALLOWED');
  const reader=request.body?.getReader();if(!reader)return reply(400,'BAD_REQUEST');let size=0;const chunks:Uint8Array[]=[];
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024){await reader.cancel();return reply(400,'BAD_REQUEST');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let index=0;for(const part of chunks){bytes.set(part,index);index+=part.length;}
  try{body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);const value=JSON.parse(body);if(value===null||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length)return reply(400,'BAD_REQUEST');}catch{return reply(400,'BAD_REQUEST');}
 }
 const at=Math.floor((deps.now??Date.now)()/1000);if(!Number.isSafeInteger(at))return reply(503,'PORTAL_UNAVAILABLE');
 const headers=new Headers({'User-Agent':'AIMarket-World-Portal/1.0','Accept':request.headers.get('accept')??'*/*',
  [RESEARCH_CONTEXT_HEADER]:await researchContext(deps.secret,request.method,url.pathname,url.search.slice(1),at,cookie)});
 if(cookie)headers.set('Cookie',cookie);if(body!==undefined){headers.set('Content-Type','application/json');headers.set('Origin',cfg.origin);}
 let upstream:Response;try{upstream=await(deps.fetcher??fetch)(cfg.upstream+url.pathname+url.search,{method:request.method,headers,body,redirect:'manual'});}catch{return reply(503,'PORTAL_UNAVAILABLE');}
 const output=new Headers({'Cache-Control':'no-store, private','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-site',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors "+cfg.parent});
 const content=upstream.headers.get('content-type');if(content)output.set('Content-Type',content);
 if(assetTypes&&upstream.status===200&&assetTypes.includes((content??'').split(';')[0].trim().toLowerCase())&&!upstream.headers.has('set-cookie')&&!upstream.headers.has('location')){
  output.set('Cache-Control','public, max-age=300');output.delete('Vary');
 }
 const location=upstream.headers.get('location');if(location){
  let target:URL;try{target=new URL(location,cfg.origin);}catch{return reply(503,'PORTAL_UNAVAILABLE');}
  const issuer=target.origin===cfg.parent&&target.pathname==='/api/aimarket-auth/authorize'&&target.searchParams.get('redirect_uri')===cfg.origin+'/api/holder/world/callback';
  if(target.origin!==cfg.origin&&!issuer)return reply(503,'PORTAL_UNAVAILABLE');output.set('Location',target.href);
 }
 const raw=(upstream.headers.getSetCookie?.()??[]);const cookies=raw.length?raw:(upstream.headers.get('set-cookie')??'').split(/,(?=\s*__Host-aim_world_)/);
 for(const item of assetTypes?[]:cookies){const match=/^(__Host-aim_world_(?:flow|holder))=([A-Za-z0-9_-]*)(?:;|$)/.exec(item.trim());if(!match||match[2]&&!OPAQUE.test(match[2]))continue;
  const max=/;\s*Max-Age=(\d+)/i.exec(item);const limit=match[1].endsWith('flow')?300:3600;
  output.append('Set-Cookie',match[1]+'='+match[2]+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+(!match[2]?0:Math.min(limit,max?Number(max[1]):limit)));
 }
 return new Response(upstream.body,{status:upstream.status,headers:output});
}
