import test from 'node:test';
import assert from 'node:assert/strict';
import {setup,newAccount,fakeImd,fakeChain,START} from './wallet-harness.mjs';
import {AuthClient,INITIAL,statusOf,ownerAddress} from '../src/world/auth.ts';
import {enterGate,enterableHome,enterAtPress,offersEnter,interiorPreview,doorPoint,atDoor,doorLanding,DOOR_REACH,nearOwnDoor,doorOffer,blockEnter} from '../src/world/homeEntry.ts';
// Home interiors (DESIGN_v001 §1, §12 groups 5 and 8): who gets an Enter action. The owner states come from the real
// AuthClient driven against the real Worker (createWorker → handleAccountApi over the migration on node:sqlite), as in
// tests/wallet-client; the hand-built states below cover the ones a page can only reach through a wallet prompt.
const A='0x'+'a1'.repeat(20),B='0x'+'b2'.repeat(20),NOW=START,DAY=86_400_000;
const home=(address,eligible=2)=>({address,seats:[],eligible,size:'ms',block:1,checkedAt:NOW,presence:'fresh'});
const owner=(over={})=>({...INITIAL,restored:true,sessionKnown:true,session:{address:A,expiresAt:NOW+DAY},home:home(A),...over});
const lot=(o,size='ms')=>({owner:o,x:10,z:20,rotation:.5,size,agents:['1']});

test('group 5: enterGate is ok only in owner mode, for the session\'s own house',()=>{
  assert.equal(statusOf(owner(),NOW),'owner');assert.equal(enterGate(owner(),lot(A),NOW),'ok');
  assert.equal(enterGate(owner(),lot(A.toUpperCase().replace('0X','0x')),NOW),'ok','mixed-case addresses of the same wallet');
  assert.equal(enterGate(owner(),lot(B),NOW),'not-yours','another wallet\'s lot');
  assert.equal(enterGate(owner(),null,NOW),'no-house','owner mode but the house is not on the map yet');
  // Owner mode off: every other state the chip can show.
  const off={visitor:{...INITIAL},connected:{...INITIAL,account:A},signedInNoHouse:owner({home:home(A,0)}),ownershipUnavailable:owner({home:'unavailable'}),
    mismatch:owner({account:B}),verifying:owner({home:null}),awaitingSignature:owner({phase:'awaitingSignature'}),expired:{...INITIAL,expired:true}};
  for(const [name,s] of Object.entries(off)){assert.equal(statusOf(s,NOW),name,name);assert.notEqual(enterGate(s,lot(A),NOW),'ok',name);assert.equal(ownerAddress(s,NOW),null);}
  // A session that ran out here before the server said so, and a house read for another address (another tab's cookie).
  assert.equal(enterGate(owner({session:{address:A,expiresAt:NOW}}),lot(A),NOW),'expired','expiresAt ≤ now');
  assert.equal(enterGate(owner({session:{address:A,expiresAt:NOW-1}}),lot(A),NOW),'expired');
  assert.equal(enterGate(owner({home:home(B)}),lot(A),NOW),'sign-in','a home read for another address');
  assert.equal(enterGate(owner({home:home(B)}),lot(B),NOW),'sign-in','…is never a way into that address\'s house');
});

/** One tab (a cookie jar `b`) running the real AuthClient against the Worker. */
function client(w,b){const c=new AuthClient({fetch:async(path,init={})=>b.keep(await b.send(b.request(path,{method:init.method??'GET',body:init.body,headers:init.headers}))),provider:()=>null,hint:{get:()=>null,set(){}},now:w.clock.now});return {c,stop:c.start()};}
const settle=()=>new Promise(r=>setTimeout(r,20));

test('group 5: the real sign-in makes the gate ok for the owner\'s house only; a revoked session (401 from /api/me/home) closes it',async()=>{
  const acct=newAccount(),a=acct.address.toLowerCase(),other=newAccount().address.toLowerCase();
  const owners=Object.assign(Array(2000).fill('0x'+'0'.repeat(40)),{361:a,921:a,77:other});
  const w=setup({imd:fakeImd({seats:{361:'51320',921:'51311',77:'50001'},owners,online:[361,921,77]}),chain:fakeChain({owners:{361:a,921:a,77:other}})});
  const b=w.browser();assert.equal((await b.signIn(acct)).verify.status,200);
  const t=client(w,b);await settle();await settle();
  assert.equal(statusOf(t.c.state,w.clock.now()),'owner');assert.equal(ownerAddress(t.c.state,w.clock.now()),a);
  assert.equal(enterGate(t.c.state,lot(a),w.clock.now()),'ok');
  assert.equal(enterGate(t.c.state,lot(other),w.clock.now()),'not-yours','a neighbour\'s house');
  assert.equal(enterGate(t.c.state,lot(a),t.c.state.session.expiresAt),'expired','the session\'s own expiry');
  // Revoked at the server (a sign-out in another browser profile): the next house read is a 401 and owner mode ends.
  w.db.raw.prepare('UPDATE sessions SET revoked_at=?').run(w.clock.now());
  await t.c.refreshHome(true);
  assert.equal(t.c.state.session,null);assert.equal(enterGate(t.c.state,lot(a),w.clock.now()),'sign-in','stale / revoked session');
  t.stop();
  // A visitor (no cookie at all) never gets in.
  const v=client(w,w.browser());await settle();assert.equal(enterGate(v.c.state,lot(a),w.clock.now()),'sign-in');v.stop();
});

test('the door: the Enter offer appears within 1.8 m of the owner\'s door spot, in front of the house',()=>{
  const h={x:10,z:20,rotation:0,size:'m'},d=doorPoint(h);
  assert.ok(d.z>h.z&&Math.abs(d.x-h.x)<1e-9,'the door faces the house\'s +Z');
  assert.ok(atDoor(d,h)&&atDoor({x:d.x+DOOR_REACH-.01,z:d.z},h)&&!atDoor({x:d.x+DOOR_REACH+.01,z:d.z},h));
  const turned={...h,rotation:Math.PI/2},e=doorPoint(turned);assert.ok(e.x>turned.x&&Math.abs(e.z-turned.z)<1e-9,'turned houses turn their door');
  // `Go home` (the wallet panel) lands you within reach, so the door's Enter appears there, for every size and turn.
  for(const size of ['s','ms','m','l','xl'])for(const rotation of [0,.7,Math.PI,-2.2]){const q={...h,size,rotation};assert.ok(atDoor(doorLanding(q),q),`${size} ${rotation}`);}
});

test('group 8: the ?interior= preview opens only in DEV or with ?debug=1, and grants nothing',async()=>{
  assert.equal(interiorPreview('?interior=m&seats=5',false),null,'a production URL ignores it');
  assert.deepEqual(interiorPreview('?interior=m&seats=5',true),{size:'m',seats:5,style:'lisbon'});
  assert.equal(interiorPreview('?interior=m&style=timber',true).style,'timber','a Frosthollow house');assert.equal(interiorPreview('?interior=m&style=x',true).style,'lisbon');
  assert.deepEqual(interiorPreview('?interior=xl&seats=30&debug=1',false),{size:'xl',seats:30,style:'lisbon'});
  assert.equal(interiorPreview('?interior=huge&debug=1',false),null);assert.equal(interiorPreview('?debug=1',false),null);
  assert.deepEqual(interiorPreview('?interior=s&seats=-4&debug=1',false),{size:'s',seats:0,style:'lisbon'});assert.deepEqual(interiorPreview('?interior=s&seats=999&debug=1',false),{size:'s',seats:60,style:'lisbon'});
  // Its mock seats are data only: deterministic, marked, and no owner state comes with them.
  const {mockSeats,PREVIEW_OWNER}=await import('../src/world/interior/mockSeats.ts');
  const one=mockSeats(24),two=mockSeats(24);assert.deepEqual(one,two);assert.equal(one.length,24);
  assert.ok(one.some(s=>!s.counts)&&one.some(s=>s.counts&&s.online)&&one.some(s=>s.counts&&!s.online),'a mix of states');
  assert.equal(new Set(one.map(s=>s.tokenId)).size,24);
  // The preview's house belongs to nobody: even a real owner session gets no Enter action on it.
  assert.equal(enterGate(owner(),{owner:PREVIEW_OWNER},NOW),'not-yours');assert.equal(enterGate({...INITIAL},{owner:PREVIEW_OWNER},NOW),'sign-in');
});

test(`group 5: the Enter action (the door pill and the household block) is offered for the owner's own house only`,()=>{
  const homes=[lot(B,'m'),lot(A,'ms'),lot('0x'+'c3'.repeat(20),'xl')];
  assert.equal(enterableHome(owner(),homes,NOW),homes[1],`owner mode on: the session's own house`);
  assert.equal(offersEnter(homes[1],enterableHome(owner(),homes,NOW)),true);
  for(const h of [homes[0],homes[2]])assert.equal(offersEnter(h,enterableHome(owner(),homes,NOW)),false,`a neighbour's house never offers Enter`);
  // Owner mode off, a stale house read, an expired or another address's session: nothing is enterable, no block offers it.
  for(const s of [{...INITIAL},{...INITIAL,account:A},owner({home:'unavailable'}),owner({home:home(A,0)}),owner({account:B}),owner({session:{address:A,expiresAt:NOW}}),owner({home:home(B)})]){
    const e=enterableHome(s,homes,NOW);assert.equal(e,null);for(const h of homes)assert.equal(offersEnter(h,e),false);}
  assert.equal(enterableHome(owner(),[homes[0]],NOW),null,'owner mode, but the house is not on the map yet');
  // Mixed case in the placed homes (the roster's owner field) is the same wallet.
  assert.equal(enterableHome(owner(),[lot(A.toUpperCase().replace('0X','0x'))],NOW)?.owner,A.toUpperCase().replace('0X','0x'));
});

test("TEST-1: the render rules for the Enter action (the door pill, the household block, the scene's door check)",()=>{
  const homes=[lot(B,'m'),lot(A,'ms')],mine=enterableHome(owner(),homes,NOW),none=enterableHome({...INITIAL},homes,NOW);
  // The door pill: the scene says "at the door" AND there is an enterable home AND nobody is inside yet.
  assert.equal(doorOffer(true,mine,false),true);
  for(const [near,e,inside,why] of [[false,mine,false,'not at the door'],[true,none,false,'owner mode off'],[true,mine,true,'already inside']])assert.equal(doorOffer(near,e,inside),false,why);
  // The household block: only the enterable home's own block, never while inside.
  assert.equal(blockEnter(homes[1],mine,false),true);
  assert.equal(blockEnter(homes[0],mine,false),false,"a neighbour's block");assert.equal(blockEnter(homes[1],none,false),false,'owner mode off');
  assert.equal(blockEnter(homes[1],mine,true),false,'inside');assert.equal(blockEnter(null,mine,false),false,'no block open');
  // The scene's door check: within reach of the enterable home's door, on foot; never another house's door.
  const d=doorPoint(homes[1]),nb=doorPoint(homes[0]);
  assert.equal(nearOwnDoor(d,mine,false),true);assert.equal(nearOwnDoor(d,mine,true),false,'aboard a boat');
  assert.equal(nearOwnDoor(d,null,false),false,'nothing enterable');
  const far={...lot(B,'m'),x:200,z:200},farDoor=doorPoint(far);assert.equal(nearOwnDoor(farDoor,mine,false),false,"at a neighbour's door");
  assert.equal(nearOwnDoor(nb,{...mine,x:mine.x+50},false),false);
});

// Swarm retest W-1 (e48d0a96), follow-up: the Enter press re-checks the gate at press time, as startMove/confirmMove do,
// instead of trusting the enterable house memoised at the last render.
test('W-1: an Enter press opens the offered house only while enterGate is still ok at that moment',()=>{
  const s=owner({session:{address:A,expiresAt:NOW+1000}}),own=lot(A);
  assert.equal(enterableHome(s,[own],NOW),own,'offered at the last render');
  assert.equal(enterAtPress(s,own,NOW+999),own);
  for(const t of [NOW+1000,NOW+5000])assert.equal(enterAtPress(s,own,t),null,'expired at the press, before any re-render: '+(t-NOW));
  assert.equal(enterAtPress(s,null,NOW),null,'nothing offered');
  assert.equal(enterAtPress(owner({home:home(B)}),own,NOW),null,'the house read changed under the offer');
  assert.equal(enterAtPress(owner({session:null}),own,NOW),null,'signed out');
  assert.equal(enterAtPress(s,lot(B),NOW),null,"another wallet's house");
});
