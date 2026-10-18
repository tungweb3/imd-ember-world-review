import http from 'node:http';
import {readFileSync,realpathSync} from 'node:fs';
import {resolve,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {createLocalService} from './chain.mjs';
import {MAX_REQUEST_BYTES,LocalError,parseRequest} from './schema.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const moduleNames=['appearance','policy','catalogue','approval','metadata','json'];
const routes=new Map([
 ['/',['mock/index.html','text/html; charset=utf-8']],['/app.mjs',['mock/app.mjs','text/javascript']],['/client-state.mjs',['mock/client-state.mjs','text/javascript']],['/style.css',['mock/style.css','text/css']],
 ...moduleNames.map(name=>['/lib/'+name+'.mjs',['shared-workbench/'+name+'.mjs','text/javascript']]),
 ['/vendor/ethers.min.js',['vendor/ethers.min.js','text/javascript']],
 ...['classic','explorer','mage','captain','surveyor'].map(name=>['/assets/'+name+'.png',['mock/assets/'+name+'.png','image/png']])
]);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"};
function json(res,status,data){res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function inside(path){const actual=realpathSync(resolve(root,path)),part=relative(realpathSync(root),actual);if(isAbsolute(part)||part==='..'||part.startsWith('..\\')||part.startsWith('../'))throw new LocalError('STATIC_PATH_INVALID');return actual;}
function verifyVendor(){const manifest=JSON.parse(readFileSync(inside('vendor/manifest.json'),'utf8'));if(createHash('sha256').update(readFileSync(inside('vendor/ethers.min.js'))).digest('hex')!==manifest.sha256)throw new LocalError('VENDOR_CHANGED');}
function tokenMatches(value,token){if(typeof value!=='string'||value.length!==token.length)return false;return timingSafeEqual(Buffer.from(value),Buffer.from(token));}
async function readBody(req){
 if(Number(req.headers['content-length']??0)>MAX_REQUEST_BYTES)throw new LocalError('REQUEST_TOO_LARGE');
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>MAX_REQUEST_BYTES)throw new LocalError('REQUEST_TOO_LARGE');chunks.push(chunk);}
 return parseRequest(Buffer.concat(chunks).toString('utf8'));
}
function hostAllowed(req,port){return req.headers.host===`127.0.0.1:${port}`||req.headers.host===`localhost:${port}`;}
function originAllowed(req,port){return req.headers.origin===`http://127.0.0.1:${port}`||req.headers.origin===`http://localhost:${port}`;}
export async function startServer({port=8973,service=null}={}){
 if(!Number.isInteger(port)||(port!==0&&(port<1024||port>65535)))throw new LocalError('LOCAL_PORT_INVALID');
 verifyVendor();const chain=service??await createLocalService(),sessionToken=randomBytes(32).toString('hex');let boundPort;
 const server=http.createServer(async(req,res)=>{
  let operationCalled=false;
  try{
   if(!hostAllowed(req,boundPort))throw new LocalError('LOCAL_HOST_REQUIRED');
   const url=new URL(req.url,`http://127.0.0.1:${boundPort}`);if(url.search)throw new LocalError('QUERY_NOT_ALLOWED');const path=url.pathname;
   if(req.method==='GET'&&path==='/api/state'){json(res,200,{ok:true,state:await chain.state(),sessionToken});return;}
   if(path.startsWith('/api/')){
    if(req.method!=='POST'){json(res,405,{ok:false,error:{code:'POST_REQUIRED',stage:'validation'}});return;}
    if(!originAllowed(req,boundPort))throw new LocalError('LOCAL_ORIGIN_REQUIRED');
    if(req.headers['content-type']!=='application/json')throw new LocalError('JSON_CONTENT_TYPE_REQUIRED');
    if(!tokenMatches(req.headers['x-local-session'],sessionToken))throw new LocalError('LOCAL_SESSION_REQUIRED');
    const operation={'/api/approval':'approval','/api/transaction':'transaction','/api/admin':'admin','/api/order/cancel':'cancelOrder'}[path];if(!operation)throw new LocalError('API_ROUTE_INVALID');
    const body=await readBody(req);operationCalled=true;const result=await chain[operation](body);json(res,200,{ok:true,...result});return;
   }
   if(req.method!=='GET'||!routes.has(path)){json(res,404,{ok:false,error:{code:'NOT_FOUND',stage:'validation'}});return;}
   const [file,type]=routes.get(path);res.writeHead(200,{...headers,'Content-Type':type});res.end(readFileSync(inside(file)));
  }catch(error){
   const local=error instanceof LocalError?error:new LocalError(/^[A-Z][A-Z0-9_]{1,80}$/.test(error.message)?error.message:'LOCAL_OPERATION_FAILED',operationCalled?'unknown':'validation');
   const data={ok:false,error:{code:local.code,message:local.code,stage:local.stage,receipt:local.receipt,transactionHash:local.transactionHash}};
   if(operationCalled){try{data.state=await chain.state();}catch{data.stateReadbackUnavailable=true;}}
   json(res,['reverted','unknown'].includes(local.stage)?409:local.code==='REQUEST_TOO_LARGE'?413:400,data);
  }
 });
 server.requestTimeout=10000;server.headersTimeout=10000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});boundPort=server.address().port;
 return {server,service:chain,port:boundPort,url:`http://127.0.0.1:${boundPort}/`,sessionToken,
  async close(){server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));await chain.close();}};
}
