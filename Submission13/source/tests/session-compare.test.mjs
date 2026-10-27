import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL} from '../src/world/auth.ts';
import {sameSession} from '../src/world/economyClient.ts';
import {WorldGoldClient} from '../src/world/worldGoldClient.ts';
import {MemberBalancesClient} from '../src/world/memberBalancesClient.ts';
// The auth client builds a fresh session object on every routine re-read (focus, another tab, a timer). Readers used to
// compare those objects, so a read that crossed such a re-read failed as CONTEXT_CHANGED with nothing changed: the GOLD
// panel showed "ledger unavailable" and the balance HUD flickered (owner report, 2026-10-26).
const A='0x'+'a'.repeat(40),B='0x'+'b'.repeat(40),NOW=Date.UTC(2026,9,26,1),EXP=NOW+86_400_000;
const signedIn=session=>({...INITIAL,account:session.address,session,sessionKnown:true,restored:true,phase:'idle'});
const gold={wallet:A,book:'0',available:'0',reserved:'0',asOf:NOW,isAdmin:false,products:[],orders:[],history:[],campaign:{},controls:[]};
const balances={wallet:A,embeo:{status:'ok',atomic:'0',block:'1'},staked:{status:'ok',atomic:'0',block:'1'},gold:{status:'ok',available:'0',book:'0',reserved:'0'},asOf:NOW};

test('sameSession compares wallet and expiry, never object identity',()=>{
 assert.equal(sameSession({address:A,expiresAt:EXP},{address:A.toUpperCase().replace('0X','0x'),expiresAt:EXP}),true);
 assert.equal(sameSession({address:A,expiresAt:EXP},{address:B,expiresAt:EXP}),false);
 assert.equal(sameSession({address:A,expiresAt:EXP},{address:A,expiresAt:EXP+1}),false);
 for(const x of [null,undefined])assert.equal(sameSession(x,{address:A,expiresAt:EXP}),false);
});

for(const [name,make,path,body] of [
 ['GOLD ledger',deps=>new WorldGoldClient(deps),'/api/gold/state',gold],
 ['wallet balances',deps=>new MemberBalancesClient(deps),'/api/me/balances',balances],
]){
 test(`${name}: a read that crosses a routine session re-read still succeeds; a real change still fails`,async()=>{
  for(const [swap,expectOk] of [[{address:A,expiresAt:EXP},true],[{address:B,expiresAt:EXP},false],[{address:A,expiresAt:EXP+60_000},false]]){
   let state=signedIn({address:A,expiresAt:EXP});
   const fetch=async url=>{assert.ok(String(url).startsWith(path));state=signedIn({...swap});return {ok:true,status:200,json:async()=>body};};
   const client=make({auth:()=>state,fetch,now:()=>NOW});
   const read=name==='GOLD ledger'?client.state():client.read();
   if(expectOk)assert.equal((await read).wallet,A,JSON.stringify(swap));
   else await assert.rejects(read,/CONTEXT_CHANGED/,JSON.stringify(swap));
  }
 });
}
