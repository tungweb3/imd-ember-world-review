import test from 'node:test';
import assert from 'node:assert/strict';
import {handleEconomyApi} from '../server/economy.ts';
import {sha256,SESSION_COOKIE} from '../server/auth.ts';
import {fixture,NOW,W} from './world-gold-audit5-fixture.mjs';

for(const mutation of ['logout','expiry','backward-clock'])test(`legacy private economy read discards late results on ${mutation}`,async()=>{
 const f=await fixture();try{
  await f.topup();const token='r'.repeat(43);
  f.db.raw.prepare('INSERT INTO sessions(token_hash,address,chain_id,created_at,expires_at,nonce,wallet_type,verification_method) VALUES(?,?,?,?,?,?,?,?)').run(await sha256(token),W,1,NOW-1,NOW+60000,'legacy-read','EOA','ECDSA');
  let at=NOW,intercepted=false;const prepare=f.db.prepare;
  f.db.prepare=sql=>{
   if(!intercepted&&sql.includes('SELECT position_id id')){
    intercepted=true;
    if(mutation==='logout')f.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(NOW);
    if(mutation==='expiry')at=NOW+60000;
    if(mutation==='backward-clock')at=NOW-1;
   }
   return prepare(sql);
  };
  const request=new Request('https://imdember.com/api/me/economy?expected_address='+W,{headers:{cookie:SESSION_COOKIE+'='+token}});
  const response=await handleEconomyApi(request,{db:f.db,config:f.config,now:()=>at,allow:async()=>true});
  assert.equal(intercepted,true);
  assert.equal(response.status,mutation==='backward-clock'?503:401);
  const body=await response.json();assert.equal(Object.hasOwn(body,'gold'),false);assert.equal(Object.hasOwn(body,'orders'),false);
 }finally{f.close();}
});
