// Local fixture ledger only. The private EDR chain and this ledger share one process lifetime.
// No connection to the World D1 ledger, no real account, no minting of a transferable token.
import {reject} from './schema.mjs';
export const GOLD_TYPES={PaidAuthorization:[
 {name:'orderId',type:'bytes32'},{name:'wallet',type:'address'},
 {name:'key',type:'bytes32'},{name:'uriHash',type:'bytes32'},
 {name:'recipient',type:'address'},{name:'embeoCost',type:'uint256'},
 {name:'goldCost',type:'uint256'},{name:'deadline',type:'uint256'},
 {name:'signerEpoch',type:'uint256'}
]};
export class LocalGoldLedger {
 constructor(){this.balances=new Map([['A',10n],['B',10n],['C',0n]]);this.entries=new Map();}
 view(wallet){const book=this.balances.get(wallet);if(book===undefined)reject('WALLET_INVALID');let reserved=0n;
  for(const entry of this.entries.values())if(entry.wallet===wallet&&entry.status==='reserved')reserved+=entry.cost;
  if(reserved>book)reject('GOLD_LEDGER_CONFLICT');return {book:book.toString(),reserved:reserved.toString(),available:(book-reserved).toString()};
 }
 reserve(id,wallet,cost){if(this.entries.has(id)||typeof cost!=='bigint'||cost<=0n)reject('GOLD_RESERVATION_INVALID');
  if(BigInt(this.view(wallet).available)<cost)reject('GOLD_INSUFFICIENT');
  this.entries.set(id,{wallet,cost,status:'reserved'});
 }
 consume(id){const entry=this.entries.get(id);if(!entry)reject('GOLD_RESERVATION_MISSING');if(entry.status==='consumed')return false;
  if(entry.status!=='reserved')reject('GOLD_LEDGER_CONFLICT');const book=this.balances.get(entry.wallet);
  if(book<entry.cost)reject('GOLD_LEDGER_CONFLICT');this.balances.set(entry.wallet,book-entry.cost);entry.status='consumed';return true;
 }
 release(id){const entry=this.entries.get(id);if(!entry)reject('GOLD_RESERVATION_MISSING');if(entry.status==='released')return false;
  if(entry.status!=='reserved')reject('GOLD_LEDGER_CONFLICT');entry.status='released';return true;
 }
}
