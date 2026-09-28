// Child process for tests/ownership.test.mjs (INT-5): a fresh process times the first GET /api/me/home of a signed-in
// owner with production-shaped upstreams, all served as pre-built text so only the Worker's own work is timed: the real
// 2026-09-27 swarm (2000 owners), a 430-row (~460 KB) /workers roster, and Alchemy's two answers, recorded by the parent
// (a warm process) and read here from stdin. Then it builds noble's window-8 base-point table under the same load as the
// yardstick. Wall time on in-memory SQLite, like cold-verify.mjs.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setup} from '../wallet-harness.mjs';
import {sha256,SESSION_COOKIE} from '../../server/auth.ts';
export const HOLDER_SEATS=20;
/** The upstream texts and the owner, shared with the parent (which records Alchemy's answers for them). */
export function upstreams(){
  const swarm=JSON.parse(readFileSync(new URL('./swarm-2026-09-27.json',import.meta.url),'utf8'));
  const ids=Object.keys(swarm.seats).slice(0,430),pad='x'.repeat(700);
  const workers={count:ids.length,workers:ids.map(id=>({deviceKey:pad,seat:{tokenId:id,agentId:swarm.seats[id].agentId},working:0,paused:false,daemonVersion:'1.4.2',
    runtimes:[{id:'codex',premiumModel:{model:'gpt-5'}},{id:'claude'}],platform:'linux',connectedAt:'2026-09-27T00:00:00Z',lastHeartbeatAt:'2026-09-27T12:00:00Z'}))};
  // The owner holds HOLDER_SEATS registered seats (the largest real holder held 20 on 2026-09-27), all registered and online.
  const owner='0x'+'4b'.repeat(20),mine=Object.keys(swarm.seats).filter((id,i)=>i%2===0).slice(0,HOLDER_SEATS);
  swarm.owners=swarm.owners.map((o,i)=>mine.includes(String(i))?owner:o);
  return {owner,mine,text:{'/swarm':JSON.stringify(swarm),'/workers':JSON.stringify(workers)}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {owner,text}=upstreams(),recorded=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',d=>s+=d).on('end',()=>resolve(s));}));
  const imd={state:{},fetcher:async url=>new Response(text[String(url).replace('https://api.imd.fun','')]??'{}',{headers:{'content-type':'application/json'}})};
  const chain={state:{},fetcher:async(url,init={})=>new Response(recorded[String(url).startsWith('https://eth-mainnet.g.alchemy.com/nft/')?'index':'rpc'],{headers:{'content-type':'application/json'}})};
  // Node's Request/Response/Headers/crypto are JavaScript that compiles on first use (workerd's are native), so they are
  // warmed on throwaway values first; everything of the Worker's own stays cold.
  for(let i=0;i<3;i++){const q=new Request('https://x.example/p?a=1',{headers:{cookie:'a=b',origin:'https://x.example'}});new URL(q.url);
    await new Response(JSON.stringify({a:[1,{b:'c'}]}),{headers:{'content-type':'application/json'}}).json();await new Response('x'.repeat(1000)).text();
    const h=new Headers({a:'b'});h.append('set-cookie','x=y');h.getSetCookie();await crypto.subtle.digest('SHA-256',new TextEncoder().encode('x'));}
  const w=setup({imd,chain}),token='T'.repeat(43);
  w.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce) VALUES(?,?,1,?,?,?)').run(await sha256(token),owner,w.clock.now(),w.clock.now()+86_400_000,'cold');
  const t=performance.now(),r=await w.call(new Request('https://imdember.com/api/me/home',{headers:{cookie:SESSION_COOKIE+'='+token}})),homeMs=performance.now()-t;
  const home=await r.json();
  const {secp256k1}=await import('@noble/curves/secp256k1');secp256k1.ProjectivePoint.BASE._setWindowSize(8);
  const t8=performance.now();secp256k1.ProjectivePoint.BASE.multiply(3n);const tableMs=performance.now()-t8;
  process.stdout.write(JSON.stringify({status:r.status,seats:home.seats?.length??0,eligible:home.eligible,homeMs,tableMs})+'\n');
}
