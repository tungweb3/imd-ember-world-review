import {openD1} from './d1-sqlite.mjs';
import {defineEconomyConfig,ECONOMY_TOKEN,ECONOMY_TREASURY} from '../server/economy-config.ts';
import {ingestEconomyEvents,createEconomyGoldChallenge,payEconomyOrderGold} from '../server/economy-ledger.ts';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import * as gold from '../server/world-gold.ts';
export const NOW=Date.UTC(2026,9,18),OWNER=ECONOMY_TREASURY;
export const account=privateKeyToAccount(generatePrivateKey()),W=account.address.toLowerCase(),B='0x'+'b'.repeat(40);
export const H=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
export const rid=()=>crypto.randomUUID();
// Synthetic finalized-chain assertions for SQL unit tests only, not RPC proof.
export const mintProof=(m,state='released',patch={})=>({schema:'ember-mint-proof-v1',mode:m.chainId===31337?'private-chain-fixture':'finalized-chain',orderId:m.id,wallet:m.wallet,gold:m.gold,chainId:m.chainId,contract:m.contract.toLowerCase(),chainInstance:m.chainInstance,blockHash:H(555),blockNumber:'555',chainTimeMs:NOW,tokenId:state==='consumed'?'1':'0',revoked:state==='released',...state==='consumed'?{transactionHash:H(556)}:{},...patch});
export async function fixture(){
 const db=openD1(),config=await defineEconomyConfig({chainId:1,token:ECONOMY_TOKEN,treasury:OWNER,stakingContract:'0x'+'1'.repeat(40),paymentContract:'0x'+'2'.repeat(40),tokenDecimals:18,deploymentBlock:'100',catalogue:[]});
 const admin=command=>gold.goldAdminCommand(db,{wallet:OWNER,requestId:rid(),command,reason:'Audit regression fixture',nowMs:NOW,serviceReady:true});
 await admin({action:'product',product:'pack',kind:'topup',title:'Fixture',gold:'10',embeo:'7',enabled:true,version:1});
 await admin({action:'product',product:'research',kind:'service',title:'Fixture research',gold:'3',enabled:true,version:1});
 let block=99;
 const quote=(product='pack',wallet=W)=>gold.goldQuote({db,config,nowMs:NOW,serviceReady:true},{wallet,requestId:rid(),product});
 const paid=async id=>{const o=db.raw.prepare('SELECT * FROM economy_orders WHERE id=?').get(id),n=++block;await ingestEconomyEvents(db,config,{fromBlock:String(n),toBlock:String(n),toBlockHash:H(n),throughTimestamp:NOW+n,events:[{kind:'payment',transactionHash:H(10000+n),logIndex:0,blockNumber:String(n),blockHash:H(n),timestamp:NOW+n,wallet:o.wallet,amount:o.amount,orderId:id,token:config.token,receiver:config.treasury}]});};
 const topup=async(wallet=W)=>{const id=await quote('pack',wallet);await paid(id);await gold.reconcileWorldGold(db,NOW);return id;};
 const challenge=async id=>{const requestId=rid(),ch=await createEconomyGoldChallenge(db,config,{wallet:W,orderId:id,requestId,origin:'https://imdember.com',nowMs:NOW,serviceReady:true});return {wallet:W,orderId:id,requestId,signature:await account.signMessage({message:ch.message}),origin:'https://imdember.com',nowMs:NOW,serviceReady:true};};
 const pay=async id=>payEconomyOrderGold(db,config,await challenge(id));
 const service=async()=>{const id=await quote('research');await pay(id);await gold.reconcileWorldGold(db,NOW);return id;};
 const mint=(id=H(999))=>({id,wallet:W,auth:{wallet:W,id},gold:'8',chainId:1,contract:'0x'+'8'.repeat(40),chainInstance:'preserved-chain-instance',deadline:NOW+300000});
 const snapshot=(wallet=W)=>gold.worldGoldSnapshot(db,wallet,NOW);
 return {db,config,admin,quote,paid,topup,challenge,pay,service,mint,snapshot,close:()=>db.raw.close()};
}
