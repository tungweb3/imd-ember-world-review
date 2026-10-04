import type {Snapshot} from './model.ts';
import {SEAT_COLLECTION} from './market.ts';
export function mockSnapshot(count=128, tick=0): Snapshot {
  const ids=Array.from({length:count},(_,i)=>String(i===0?361:i===1?921:i+10000));
  const at=Date.now(),working=ids.filter((_,i)=>(i+tick)%5===0);
  const workers=ids.map((tokenId,i)=>({seat:{tokenId,agentId:String(50000+i)},working:working.includes(tokenId)?1:0,
    daemonVersion:'demo-1',runtimes:[{id:i%3===0?'claude':'codex',premiumModel:{model:'Demo model'}}],lastHeartbeatAt:new Date(at).toISOString()}));
  const seats=Object.fromEntries(ids.map((tokenId,i)=>[tokenId,{tokenId,agentId:String(50000+i),attempts:i+8,accepted:i,failed:1,pending:7,last:new Date(at).toISOString(),working:working.includes(tokenId),queued:0}]));
  // Owner wallets indexed by token id, as the live API sends them: a few collectors hold many seats, most hold one.
  const owners:string[]=[],wallet=(n:number)=>'0x'+(0xd000+n).toString(16).padStart(40,'0');
  let w=0,left=0;for(const [i,id] of ids.entries()){if(left===0){w++;left=i<24?[12,7,4,3,2][w%5]:i%7===0?2:1;}owners[Number(id)]=wallet(w);left--;}
  // A recent-activity window like the live one: mostly joins, a few work steps (demo seats 10000+ and demo text, never a
  // real seat; happenings.ts gives demo lines no Explorer links).
  const iso=(minutesAgo:number)=>new Date(at-minutesAgo*60_000).toISOString(),job='00000000-0000-4000-8000-00000000d3e0',[s1,s2]=[ids[2]??'10002',ids[3]??'10003'].map(Number);
  const events=[
    {kind:'node',at:iso(1),tokenId:s1,step:'build_website',role:'implement',state:'working',jobId:job,objective:'Demo: restore the village memory lantern',reason:null},
    {kind:'node',at:iso(2),tokenId:s2,step:'research_report',role:'implement',state:'accepted',jobId:job,objective:'Demo: restore the village memory lantern',reason:null},
    {kind:'done',at:iso(2),jobId:job,objective:'Demo: restore the village memory lantern',state:'completed',steps:1,failure:null},
    ...ids.slice(2,2+6+tick%4).map((tokenId,i)=>({kind:'agent',at:iso(3+i),tokenId:Number(tokenId),state:'joined'}))];
  const data={swarm:{at,owners:Array.from(owners,o=>o??null),chain:{chainId:1,collection:SEAT_COLLECTION},
      health:{reachable:true,agentsOnline:count,workingNow:working.length,acceptedLastDay:2048,jobsDoneLastDay:9,oraclesDoneLastDay:12,seatsEnrolled:count,
        pendingVerification:0,pendingDeployment:0,pendingSites:0,verifierUp:true,publisherUp:true,deployerUp:true},
      counts:{launchesLive:8,sites:16,jobs:40,jobStates:{executing:1,completed:36,blocked:2,cancelled:1},tasksInProgress:1,inferenceTokens:1_000_000_000+tick*900_000},seats,events},
    workers:{count,workers},
    jobs:{jobs:[{id:job,objective:'Demo: restore the village memory lantern',template:'skill:build-website',state:'executing',updatedAt:new Date(at).toISOString()}]},
    oracle:{requests:[{id:'demo-oracle',jobId:'00000000-0000-4000-8000-00000000d3e1',question:'Demo: which ancient path leads to the Oracle Tower?',status:tick%2?'assessing':'attested',signer:tick%2?null:'demo',attestedAt:tick%2?null:new Date(at).toISOString()}]},
    publications:{items:[{id:'demo-publication',title:'Demo: the agents’ first exploration journal',types:['research'],status:'published'}]},launches:{launches:[{id:'demo-launch',launchNumber:1,status:'live',chainId:11155111}]},
    activity:{at,reachable:true,workflows:1,jobs:1,oracle:0,working:working.length,total:2,steps:Array.from({length:24},(_,h)=>40+((h*37+tick*11)%90))}};
  return {mode:'mock',sources:Object.fromEntries(Object.entries(data).map(([key,value])=>[key,{state:'fresh',data:value,url:'mock://'+key,fetchedAt:at}])) as Snapshot['sources']};
}
