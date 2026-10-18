import {createServer} from 'vite';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createGoldLocalRuntime} from './world-gold-local-runtime.mjs';
import {handleWorldGoldApi} from '../server/world-gold-api.ts';
import {handleEconomyApi} from '../server/economy.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import {AIMARKET_ACTIVITY_ADMIN_WALLETS} from '../server/aimarket-admin.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.env.EMBER_GOLD_PREVIEW_PORT??8978);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('INVALID_LOCAL_PREVIEW_PORT');
const stateDir=resolve(root,port===8978?'../.local-shared-gold-final':'../.local-shared-gold-final-'+port);mkdirSync(stateDir,{recursive:true});
const filename=resolve(stateDir,'preview.sqlite');
if(existsSync(filename))throw Error('SAVED_FIXTURE_EXISTS_PRESERVE_CHAIN_INSTANCE');
const runtime=await createGoldLocalRuntime({filename}),origin=`http://127.0.0.1:${port}`;
const localSessions=new Map(),mintSession=randomBytes(32).toString('hex');
const cookie=req=>String(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('ember_gold_fixture='))?.slice('ember_gold_fixture='.length);
async function readBody(req){let size=0;const chunks=[];for await(const c of req){size+=c.length;if(size>16000)throw Error('BODY_TOO_LARGE');chunks.push(c);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function json(res,status,data,extra={}){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...extra});res.end(JSON.stringify(data));}
const staticFiles=new Map([['/',['mock/index.html','text/html']],['/app.mjs',['mock/app.mjs','text/javascript']],['/client-state.mjs',['mock/client-state.mjs','text/javascript']],['/style.css',['mock/style.css','text/css']],...['appearance','policy','catalogue','approval','metadata','json'].map(n=>['/lib/'+n+'.mjs',['shared-workbench/'+n+'.mjs','text/javascript']]),['/vendor/ethers.min.js',['vendor/ethers.min.js','text/javascript']],...['classic','explorer','mage','captain','surveyor'].map(n=>['/assets/'+n+'.png',['mock/assets/'+n+'.png','image/png']])]);
const plugin={name:'isolated-world-gold-fixture',enforce:'pre',configureServer(server){server.middlewares.use(async(req,res,next)=>{
 const path=new URL(req.url??'/',origin).pathname;
 if(!path.startsWith('/api/gold/')&&path!=='/api/me/gold'&&path!=='/api/me/aimarket-trial'&&!path.startsWith('/api/economy/')&&!path.startsWith('/api/local-gold/')&&!path.startsWith('/api/local-mint/')&&!path.startsWith('/local-mint/'))return next();
 try{
  if(req.headers.host!==`127.0.0.1:${port}`||req.headers.origin&&req.headers.origin!==origin)throw Error('LOCAL_ORIGIN_REQUIRED');
  if(req.method==='POST'&&(req.headers.origin!==origin||req.headers['content-type']!=='application/json'))throw Error('LOCAL_ORIGIN_REQUIRED');
  if(path.startsWith('/local-mint/')){const key=path.slice('/local-mint'.length),file=staticFiles.get(key);if(!file||req.method!=='GET')return json(res,404,{error:'NOT_FOUND'});let b=readFileSync(resolve(root,'../mint',file[0]));if(/html|javascript/.test(file[1])){let text=b.toString('utf8').replaceAll("'/lib/","'/local-mint/lib/").replaceAll("'/assets/","'/local-mint/assets/").replaceAll("'/client-state.mjs'","'/local-mint/client-state.mjs'");if(file[0].endsWith('.html'))text=text.replaceAll('href="/','href="/local-mint/').replaceAll('src="/','src="/local-mint/').replace('本頁 8973 驗證免費與付費同時開放；8958 舊版及其證據完整保留。GOLD 帳本與私有鏈僅存在本測試服務記憶體，關閉或重置即清除，非正式持久化帳本。','本頁驗證 Mint 與 World 共用持久化 GOLD 帳本。SQLite 記錄保存在本機；私有測試鏈仍在記憶體，重開機不等於恢復鏈上狀態。原 8958／8973 來源及證據保留。');if(file[0].endsWith('app.mjs'))text=text.replace('fetch(path,','fetch("/api/local-mint"+path.slice(4),');b=Buffer.from(text);}res.writeHead(200,{'content-type':file[1],'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(b);return;}
  if(path.startsWith('/api/local-mint/')){const action=path.slice('/api/local-mint/'.length);if(action==='state'&&req.method==='GET')return json(res,200,{ok:true,state:await runtime.mint.state(),sessionToken:mintSession});if(req.method!=='POST'||req.headers['x-local-session']!==mintSession)throw Error('LOCAL_SESSION_REQUIRED');const b=await readBody(req);const method={'approval':'approval','transaction':'transaction','order/cancel':'cancelOrder','admin':'admin'}[action];if(!method||method==='admin'&&b.action==='reset')throw Error('LOCAL_ACTION_FORBIDDEN');return json(res,200,{ok:true,...await runtime.mint[method](b)});}
  if(path==='/api/local-gold/session'&&req.method==='POST'){const b=await readBody(req);if(Object.keys(b).join(',')!=='id'||!['A','B','C','admin1','admin2','admin3','none'].includes(b.id))throw Error('INVALID_FIXTURE');
   const prior=cookie(req);if(prior){const old=localSessions.get(prior);if(old)await runtime.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),old.hash).run();localSessions.delete(prior);}
   if(b.id==='none')return json(res,200,{session:null},{'set-cookie':'ember_gold_fixture=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict'});
   const address=(b.id.startsWith('admin')?AIMARKET_ACTIVITY_ADMIN_WALLETS[Number(b.id.slice(-1))-1]:runtime.mint.addresses[runtime.mint.account(b.id).index]).toLowerCase(),token=randomBytes(32).toString('base64url'),hash=await sha256(token),expiresAt=Date.now()+3600000;
   await runtime.db.prepare("INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,1,?,?,?,'EOA','ECDSA')").bind(hash,address,Date.now(),expiresAt,randomBytes(16).toString('hex')).run();localSessions.set(token,{address,hash,expiresAt});return json(res,200,{session:{address,expiresAt}},{'set-cookie':`ember_gold_fixture=${token}; Path=/; HttpOnly; SameSite=Strict`});
  }
  const token=cookie(req),session=localSessions.get(token);const rawBody=req.method==='POST'?await readBody(req):null;
  if(path==='/api/local-gold/pay'){
   if(!session||session.expiresAt<=Date.now()||rawBody?.expectedAddress!==session.address||Object.keys(rawBody).sort().join(',')!=='expectedAddress,orderId')throw Error('FIXTURE_AUTH_REQUIRED');
   const order=await runtime.db.prepare('SELECT * FROM economy_orders WHERE id=? AND wallet=?').bind(rawBody.orderId,session.address).first();if(!order)throw Error('ORDER_NOT_FOUND');
   let result;if(order.currency==='EMBEO')result=await runtime.pay(order.id,session.address);else{const i=runtime.mint.addresses.findIndex(a=>a.toLowerCase()===session.address);if(i<1||i>3)throw Error('FIXTURE_WALLET_REQUIRED');const requestId=crypto.randomUUID(),nowMs=Date.now(),ch=await createEconomyGoldChallenge(runtime.db,runtime.config,{wallet:session.address,orderId:order.id,requestId,origin,nowMs,authorization:{tokenHash:session.hash}});await payEconomyOrderGold(runtime.db,runtime.config,{wallet:session.address,orderId:order.id,requestId,signature:await runtime.mint.signers[i].signMessage(ch.message),origin,nowMs:Date.now(),authorization:{tokenHash:session.hash}});await runtime.deliver(order.id);result={delivered:true};}return json(res,200,{ok:true,...result});
  }
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string'&&!['cookie','host','content-length'].includes(k))headers.set(k,v);if(session)headers.set('cookie',SESSION_COOKIE+'='+token);
  const request=new Request(origin+req.url,{method:req.method,headers,...rawBody?{body:JSON.stringify(rawBody)}:{}}),deps={db:runtime.db,config:runtime.config,allow:async()=>true,now:Date.now};
  const response=await handleWorldGoldApi(request,deps)??await handleEconomyApi(request,deps);if(!response)return json(res,404,{error:'NOT_FOUND'});const data=await response.json();if(response.ok&&(path==='/api/gold/state'||path==='/api/gold/admin')&&!new URL(req.url,origin).searchParams.has('order_id'))data.localFixture=true;json(res,response.status,data);
 }catch(e){json(res,400,{ok:false,error:{code:e.code??e.message,stage:e.stage??'validation'},...(path.startsWith('/api/local-mint/')?{state:await runtime.mint.state()}:{})});}
 });}};
const server=await createServer({root,configFile:resolve(root,'vite.config.ts'),plugins:[plugin],server:{host:'127.0.0.1',port,strictPort:true}});await server.listen();
console.log(JSON.stringify({url:origin+'/gold-local-preview.html',scope:'LOCAL_PRIVATE_CHAIN_ONLY',chainId:31337,runId:runtime.mint.runId,configId:runtime.config.id,fixtureSchemaDifference:'0013 registry chain_id 31337 in local adapter only; production SQL unchanged',productionEnabled:false}));
let closing=false;for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{if(closing)return;closing=true;await server.close();await runtime.close();process.exit(0);});
