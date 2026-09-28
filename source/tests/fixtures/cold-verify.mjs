// Child process for tests/auth.test.mjs: a fresh isolate-like process that has never used secp256k1. It creates two
// challenges for the address read from stdin, prints each message, reads the parent's signature, and times the
// POST /api/auth/verify handler. The first verify is cold (the base-point table is built inside it). Wall time is
// reported: the handler runs against in-memory SQLite with no I/O wait, so it bounds its CPU time, and Windows'
// process.cpuUsage only ticks every 15.6 ms.
import {createInterface} from 'node:readline';
import {setup} from '../wallet-harness.mjs';
const input=createInterface({input:process.stdin}),queue=[];let wake=()=>{};
input.on('line',l=>{queue.push(l);wake();});
const line=()=>new Promise(resolve=>{const take=()=>queue.length?resolve(queue.shift()):(wake=take);take();});
const w=setup(),address=await line(),out={};
for(const run of ['cold','warm']){
  const b=w.browser(),c=await (await b.post('/api/auth/challenge',{address})).json();
  process.stdout.write(JSON.stringify(c.message)+'\n');
  const request=b.request('/api/auth/verify',{method:'POST',body:{nonce:c.nonce,signature:await line()}});
  const t=performance.now(),r=await w.call(request);
  out[run]={status:r.status,ms:performance.now()-t};
}
// Yardstick under the same load: building noble's default (window 8) base-point table alone, which is what a first
// recovery would cost without the server's _setWindowSize(4).
const {secp256k1}=await import('@noble/curves/secp256k1');secp256k1.ProjectivePoint.BASE._setWindowSize(8);
const t8=performance.now();secp256k1.ProjectivePoint.BASE.multiply(3n);const tableMs=performance.now()-t8;
process.stdout.write(JSON.stringify({status:out.cold.status===200&&out.warm.status===200?200:0,coldMs:out.cold.ms,warmMs:out.warm.ms,tableMs})+'\n');
input.close();
